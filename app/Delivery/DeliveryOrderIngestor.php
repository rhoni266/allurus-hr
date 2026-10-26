<?php

namespace App\Delivery;

use App\Billing\{PricingEngine, PricingException};
use App\Database\Timestamps;
use App\Kitchen\{Kitchen, KitchenPresence};
use App\Models\{DeliveryConnection, DeliveryOrder, Order, OrderItem, OrderVoid, Payment, TaxRule};
use App\Sync\{Facts, StockLedger, Voids};
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Turns a normalised platform order into a normal Allurus order. Runs in a queue job with
 * the connection's tenant entered.
 *
 *  - Never drops an order. Unmapped items and modifiers, missing tax rules and totals that
 *    disagree become attention_reasons on the delivery order; the kitchen still sees every
 *    line under the name the platform sent.
 *  - orders keeps our own pricing identity (PricingEngine, tender 'card': no cash rounding),
 *    so voids, refunds, reports and the sync verifier work unchanged. The platform's figures
 *    (fees, platform discounts, commission, total) stay on delivery_orders and are compared,
 *    never "fixed".
 *  - Idempotent on (connection, external order id), under a lock, so two workers handling
 *    two webhook events for one order create it once.
 */
final class DeliveryOrderIngestor
{
    public function ingest(DeliveryConnection $c, DeliveryOrderData $d, array $rawPayload): DeliveryOrder
    {
        return DB::transaction(function () use ($c, $d, $rawPayload) {
            TenantContext::applyToTransaction();
            $this->lock($c, $d->externalOrderId);

            if ($existing = DeliveryOrder::where('connection_id', $c->id)->where('external_order_id', $d->externalOrderId)->first()) {
                return $existing;
            }

            $reasons = [];
            $mappings = $c->menuMappings()->with('variant.product')
                ->whereIn('external_item_id', array_map(fn ($i) => $i->externalItemId, $d->items))->get()->keyBy('external_item_id');
            $modMaps = $c->modifierMappings()->get()->keyBy('external_modifier_id');
            $defaultTax = $c->settings['default_tax_code'] ?? 'EXEMPT';

            $lines = [];
            foreach ($d->items as $item) {
                $map = $mappings[$item->externalItemId] ?? null;
                if (! $map) {
                    $reasons[] = ['kind' => 'unmapped_item', 'external_item_id' => $item->externalItemId, 'name' => $item->name];
                }
                $mods = [];
                foreach ($item->modifiers as $m) {
                    $mm = $modMaps[$m->externalModifierId] ?? null;
                    if (! $mm) {
                        $reasons[] = ['kind' => 'unmapped_modifier', 'external_modifier_id' => $m->externalModifierId, 'name' => $m->name];
                    }
                    $mods[] = ['modifier_id' => $mm?->modifier_id, 'name' => $m->name, 'qty' => $m->qty, 'price_delta_sen' => $m->priceDeltaSen * $m->qty];
                }
                $lines[] = [
                    'id' => (string) Str::uuid7(), 'map' => $map, 'name' => $item->name, 'qty_milli' => $item->qty * 1000,
                    'unit_price_sen' => $item->unitPriceSen, 'modifiers' => $mods, 'notes' => $item->notes,
                    'tax_code' => $map?->variant?->product?->tax_code ?? $defaultTax,
                ];
            }

            // SST breakdown from OUR engine on the platform's prices; merchant-funded discount only
            $priced = $this->price($lines, $d, $reasons);
            if ($priced['subtotal_sen'] !== $d->itemsTotalSen) {
                $reasons[] = ['kind' => 'totals_mismatch', 'platform_items_total_sen' => $d->itemsTotalSen, 'computed_sen' => $priced['subtotal_sen']];
            }

            $orderId = (string) Str::uuid7();
            $at = $d->placedAt;
            DB::table('order_ids')->insert(['id' => $orderId, 'tenant_id' => TenantContext::require(), 'occurred_at' => $at->format(Timestamps::FORMAT)]);

            $paid = $d->paymentMode === 'platform_collected';
            $order = Order::create([
                'id' => $orderId, 'outlet_id' => $c->outlet_id, 'terminal_id' => null, 'staff_id' => null,
                'receipt_no' => 'DLV-'.strtoupper(substr($c->provider, 0, 3)).'-'.($d->shortCode ?? substr($d->externalOrderId, -8)),
                'channel' => $c->provider, 'status' => $paid ? 'paid' : 'open',
                'subtotal_sen' => $priced['subtotal_sen'], 'discount_sen' => $priced['discount_sen'],
                'service_charge_sen' => 0, 'tax_sen' => $priced['tax_sen'], 'rounding_sen' => 0, 'total_sen' => $priced['total_sen'],
                'tax_breakdown' => $priced['tax_breakdown'], 'tender' => 'card',
                'created_offline' => false, 'occurred_at' => $at, 'synced_at' => now(),
            ]);

            $stock = [];
            foreach ($lines as $n => $l) {
                $variant = $l['map']?->variant;
                OrderItem::create([
                    'id' => $l['id'], 'order_id' => $orderId, 'variant_id' => $variant?->id,
                    'name_snapshot' => $l['name'], 'qty_milli' => $l['qty_milli'],
                    'unit_price_sen' => $l['unit_price_sen'], 'catalog_price_sen' => $l['map']?->deliveryPriceSen() ?? $l['unit_price_sen'],
                    'price_row_version' => $variant?->row_version ?? 0, 'modifiers' => $l['modifiers'],
                    'net_sen' => $priced['lines'][$n]['net_sen'], 'tax_code' => $l['tax_code'],
                    'kds_status' => 'new', 'occurred_at' => $at,
                ]);
                if ($variant && $variant->product?->track_stock !== false) {
                    $stock[$variant->id] = ($stock[$variant->id] ?? 0) - $l['qty_milli'];
                }
            }
            foreach (StockLedger::move(TenantContext::require(), $c->outlet_id, $stock, 'sale', $orderId, $at) as $neg) {
                $reasons[] = ['kind' => $neg['kind']] + $neg['detail'];
            }

            if ($paid) {
                Payment::create([
                    'id' => (string) Str::uuid7(), 'order_id' => $orderId, 'method' => 'platform_collected',
                    'gateway' => $c->provider, 'gateway_ref' => $d->externalOrderId,
                    'amount_sen' => $priced['total_sen'], 'status' => 'succeeded', 'occurred_at' => $at,
                ]);
            }

            // Zero-touch: accept without a cashier only if the outlet opted in AND someone in
            // the kitchen can see the ticket now. Otherwise it waits for a person (and, in
            // week 3, auto-reject at accept_by), and says why.
            $accept = $c->auto_accept && KitchenPresence::isListening(TenantContext::require(), $c->outlet_id);
            if ($c->auto_accept && ! $accept) {
                $reasons[] = ['kind' => 'auto_accept_skipped', 'reason' => 'kitchen_not_listening'];
            }

            $delivery = DeliveryOrder::create([
                'outlet_id' => $c->outlet_id, 'connection_id' => $c->id, 'order_id' => $orderId,
                'provider' => $c->provider, 'external_order_id' => $d->externalOrderId, 'short_code' => $d->shortCode,
                'status' => $accept ? 'accepted' : 'received', 'accepted_at' => $accept ? now() : null, 'accepted_by' => $accept ? 'auto' : null,
                'fulfilment' => $d->fulfilment, 'payment_mode' => $d->paymentMode,
                'items_total_sen' => $d->itemsTotalSen, 'delivery_fee_sen' => $d->deliveryFeeSen,
                'platform_discount_sen' => $d->platformDiscountSen, 'merchant_discount_sen' => $d->merchantDiscountSen,
                'commission_sen' => $d->commissionSen, 'platform_total_sen' => $d->platformTotalSen,
                'customer' => $d->customer, 'notes' => $d->notes,
                'placed_at' => $d->placedAt, 'accept_by' => $d->acceptBy, 'pickup_eta' => $d->pickupEta,
                'needs_attention' => $reasons !== [], 'attention_reasons' => $reasons, 'raw_payload' => $rawPayload,
            ]);

            if ($accept) {
                // unmapped lines go to the kitchen too, under the platform's name
                Kitchen::fire($order, 'delivery', $order->receipt_no, array_map(fn ($l) => [
                    'name' => $l['name'], 'qty_milli' => $l['qty_milli'], 'notes' => $l['notes'],
                    'modifiers' => array_map(fn ($m) => $m['qty'] > 1 ? "{$m['qty']}x {$m['name']}" : $m['name'], $l['modifiers']),
                ], $lines), $d->notes);
                DeliveryStatusOutbox::queue($delivery, 'accepted', ['by' => 'auto']);   // the platform must be told (week 3 sends it)
            }

            return $delivery;
        });
    }

    /**
     * The platform cancelled: void the internal order through the same path as a terminal
     * void (stock back, payments netted to zero), with no staff actor. A cancellation for
     * an order we never received is recorded as ignored by the caller.
     */
    public function cancel(DeliveryConnection $c, string $externalOrderId, string $reason = 'cancelled by platform'): ?DeliveryOrder
    {
        return DB::transaction(function () use ($c, $externalOrderId, $reason) {
            TenantContext::applyToTransaction();
            $this->lock($c, $externalOrderId);

            $do = DeliveryOrder::where('connection_id', $c->id)->where('external_order_id', $externalOrderId)->first();
            if (! $do) {
                return null;
            }
            if ($do->order_id && ! OrderVoid::where('order_id', $do->order_id)->exists()) {
                Voids::apply(Facts::order($do->order_id), (string) Str::uuid7(), null, null, $reason, now()->toImmutable());
            }
            $do->update(['status' => 'cancelled']);

            return $do;
        });
    }

    private function price(array $lines, DeliveryOrderData $d, array &$reasons): array
    {
        $input = [
            'tender' => 'card',   // platform-collected: no cash rounding
            'tax_rules' => TaxRule::forPricing($d->placedAt),
            'lines' => array_map(fn ($l) => [
                'id' => $l['id'], 'qty_milli' => $l['qty_milli'], 'unit_price_sen' => $l['unit_price_sen'], 'tax_code' => $l['tax_code'],
                'modifiers' => array_map(fn ($m) => ['price_delta_sen' => $m['price_delta_sen']], $l['modifiers']),
            ], $lines),
        ];
        if ($d->merchantDiscountSen > 0) {
            $input['order_discount'] = ['amount_sen' => $d->merchantDiscountSen];
        }

        try {
            return PricingEngine::price($input);
        } catch (PricingException $e) {
            // e.g. a tax code with no rule in force: keep the order, untaxed, and say why
            $reasons[] = ['kind' => 'pricing_failed', 'reason' => $e->reason, 'message' => $e->getMessage()];
            foreach ($input['lines'] as &$l) {
                $l['tax_code'] = 'UNTAXED';
            }
            $input['tax_rules'] = ['UNTAXED' => ['rate_bps' => 0, 'version' => 0]];

            return PricingEngine::price($input);
        }
    }

    /** One worker per (connection, external order) at a time. */
    private function lock(DeliveryConnection $c, string $externalOrderId): void
    {
        DB::statement('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ["delivery:{$c->id}:{$externalOrderId}"]);
    }
}

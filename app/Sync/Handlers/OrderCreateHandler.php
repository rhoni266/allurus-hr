<?php

namespace App\Sync\Handlers;

use App\Models\{OfflineSyncQueue, Order, OrderItem, Payment, ProductVariant, StockMovement, SyncConflict};
use App\Database\Timestamps;
use App\Kitchen\Kitchen;
use App\Pricing\PriceResolver;
use App\Sync\{Facts, MutationHandler, MutationRejected, Outcome, StockLedger};
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\{DB, Validator};

/**
 * A completed sale is a fact: it is always stored as sent. Drift against the current
 * catalogue becomes sync_conflicts rows for HQ, never a rejection.
 */
class OrderCreateHandler implements MutationHandler
{
    /** Methods that can legitimately complete without connectivity. */
    private const OFFLINE_METHODS = ['cash'];

    public function __construct(private PriceResolver $prices) {}

    public function handle($terminal, array $p, OfflineSyncQueue $queue): Outcome
    {
        $p = $this->validate($p);
        $o = $p['order'];
        $tenantId = TenantContext::require();
        $occurredAt = CarbonImmutable::parse($o['occurred_at'])->utc();

        // Domain idempotency that works across partitions. 0 rows = already stored
        // (e.g. resent under a new client_seq after an outbox rebuild).
        // Query-builder bindings use 'Y-m-d H:i:s', so pass the full instant explicitly.
        $inserted = DB::table('order_ids')->insertOrIgnore([
            'id' => $o['id'], 'tenant_id' => $tenantId, 'occurred_at' => $occurredAt->format(Timestamps::FORMAT),
        ]);
        if ($inserted === 0) {
            return Outcome::applied(['order_id' => $o['id'], 'note' => 'already_exists']);
        }

        $order = Order::create([
            'id'                 => $o['id'],
            'outlet_id'          => $terminal->outlet_id,
            'terminal_id'        => $terminal->id,
            'receipt_no'         => $o['receipt_no'],
            'channel'            => $o['channel'] ?? 'pos',
            'status'             => $o['status'],
            'staff_id'           => $o['staff_id'],
            'customer_id'        => $o['customer_id'] ?? null,
            'table_id'           => $o['table_id'] ?? null,
            'subtotal_sen'       => $o['subtotal_sen'],
            'discount_sen'       => $o['discount_sen'] ?? 0,
            'service_charge_sen' => $o['service_charge_sen'] ?? 0,
            'tax_sen'            => $o['tax_sen'],
            'rounding_sen'       => $o['rounding_sen'] ?? 0,
            'total_sen'          => $o['total_sen'],
            'tax_breakdown'      => $o['tax_breakdown'] ?? [],
            'tender'             => $o['tender'] ?? 'cash',
            'service_charge_tax_code' => $o['service_charge_tax_code'] ?? null,
            'created_offline'    => (bool) ($o['created_offline'] ?? true),
            'occurred_at'        => $occurredAt,
            'synced_at'          => now(),
        ]);

        $variants = ProductVariant::withTrashed()
            ->whereIn('id', collect($p['items'])->pluck('variant_id')->unique())
            ->get()->keyBy('id');

        // Compare against the price the terminal *should* have shown at the time of sale,
        // overrides included, so outlets with regional pricing don't raise false conflicts.
        $live = $variants->reject->trashed();
        $catalog = $this->prices->resolveMany($live, $terminal->outlet_id, $terminal->outlet?->region_code, $occurredAt);

        $conflicts = [];
        $stockDeltas = [];

        foreach ($p['items'] as $item) {
            $variant = $variants->get($item['variant_id']);
            $catalogPrice = $catalog[$item['variant_id']] ?? null;

            OrderItem::create([
                'id'                => $item['id'],
                'order_id'          => $order->id,
                'variant_id'        => $item['variant_id'],
                'name_snapshot'     => $item['name'],
                'qty_milli'         => $item['qty_milli'],
                'unit_price_sen'    => $item['unit_price_sen'],
                'catalog_price_sen' => $catalogPrice ?? $item['unit_price_sen'],
                'price_row_version' => $item['price_row_version'],
                'modifiers'         => $item['modifiers'] ?? [],
                'net_sen'           => $item['net_sen'] ?? null,     // priced output: what refunds are based on
                'tax_code'          => $item['tax_code'] ?? null,
                'occurred_at'       => $occurredAt,
            ]);

            if (! $variant || $variant->trashed()) {
                $conflicts[] = ['kind' => 'product_deleted', 'detail' => ['variant_id' => $item['variant_id'], 'item_id' => $item['id']]];
            } elseif ($variant->product?->type === 'service_timed') {
                // charged by elapsed time, not the catalogue price; session.end audits the amount
            } elseif ($catalogPrice !== null && $catalogPrice !== (int) $item['unit_price_sen'] && ! ($item['price_manual'] ?? false)) {
                // Compare prices, not row_versions: versions bump on any edit (e.g. a rename)
                // and an override's version is unrelated to the variant's.
                $conflicts[] = ['kind' => 'price_mismatch', 'detail' => [
                    'variant_id'        => $variant->id,
                    'item_id'           => $item['id'],
                    'charged_sen'       => (int) $item['unit_price_sen'],
                    'catalog_sen'       => $catalogPrice,
                    'terminal_version'  => $item['price_row_version'],
                    'server_version'    => $variant->row_version,
                ]];
            }

            if ($variant && $variant->product?->track_stock !== false) {
                $stockDeltas[$variant->id] = ($stockDeltas[$variant->id] ?? 0) - $item['qty_milli'];
            }
        }

        $conflicts = array_merge(
            $conflicts,
            StockLedger::move($tenantId, $terminal->outlet_id, $stockDeltas, 'sale', $order->id, $occurredAt),
            Facts::staffConflicts($o['staff_id'], [], 'sale'),   // any active staff may sell
        );

        foreach ($p['payments'] as $pay) {
            Payment::create([
                'id'          => $pay['id'],
                'order_id'    => $order->id,
                'method'      => $pay['method'],
                'gateway'     => $pay['gateway'] ?? null,
                'gateway_ref' => $pay['gateway_ref'] ?? null,
                'amount_sen'  => $pay['amount_sen'],
                'status'      => 'succeeded',
                'occurred_at' => $pay['occurred_at'],
            ]);

            // Online-only methods shouldn't appear in an offline sale; store it, flag it.
            if (($o['created_offline'] ?? true) && ! in_array($pay['method'], self::OFFLINE_METHODS, true)) {
                $conflicts[] = ['kind' => 'offline_noncash_payment', 'detail' => ['payment_id' => $pay['id'], 'method' => $pay['method']]];
            }
        }

        // Kitchen: only when the till asked for it. A sale that reaches us long after it was
        // rung up (the outlet was offline) is recorded as a 'late' ticket, never printed: the
        // kitchen would be cooking a meal that was served, or abandoned, hours ago.
        if ($o['send_to_kitchen'] ?? false) {
            $late = $occurredAt->lt(now()->subSeconds(config('pos.kitchen.fresh_seconds')));
            Kitchen::fire($order, 'terminal', $o['receipt_no'], array_map(fn ($i) => [
                'name' => $i['name'], 'qty_milli' => $i['qty_milli'], 'notes' => $i['kitchen_notes'] ?? null,
                'modifiers' => array_values(array_filter(array_map(fn ($m) => is_array($m) ? ($m['name'] ?? null) : null, $i['modifiers'] ?? []))),
            ], $p['items']), $o['kitchen_notes'] ?? null, $late);
            if ($late) {
                $conflicts[] = ['kind' => 'kitchen_ticket_late', 'detail' => ['order_id' => $order->id,
                    'occurred_at' => $occurredAt->toIso8601String(), 'received_at' => now()->toIso8601String()]];
            }
        }

        foreach ($conflicts as $c) {
            SyncConflict::create(['queue_id' => $queue->id, 'kind' => $c['kind'], 'detail' => $c['detail']]);
        }

        $result = ['order_id' => $order->id, 'conflicts' => array_values(array_unique(array_column($conflicts, 'kind')))];

        return $conflicts ? Outcome::conflict($result) : Outcome::applied($result);
    }


    private function validate(array $p): array
    {
        $v = Validator::make($p, [
            'order.id'                 => ['required', 'uuid'],
            'order.receipt_no'         => ['required', 'string', 'max:64'],
            'order.status'             => ['required', 'in:paid,open,void'],
            'order.staff_id'           => ['required', 'uuid'],
            'order.subtotal_sen'       => ['required', 'integer'],
            'order.tax_sen'            => ['required', 'integer'],
            'order.total_sen'          => ['required', 'integer'],
            'order.occurred_at'        => ['required', 'date'],
            'items'                    => ['required', 'array', 'min:1'],
            'items.*.id'               => ['required', 'uuid', 'distinct'],
            'items.*.variant_id'       => ['required', 'uuid'],
            'items.*.name'             => ['required', 'string', 'max:255'],
            // Integer milli-units only: a decimal or float qty is a terminal bug, not a rounding choice.
            'items.*.qty_milli'        => ['required', 'integer', 'min:1', 'max:1000000000'],
            'items.*.unit_price_sen'   => ['required', 'integer'],
            'items.*.price_row_version'=> ['required', 'integer', 'min:0'],
            'items.*.net_sen'          => ['nullable', 'integer', 'min:0'],
            'items.*.tax_code'         => ['nullable', 'string', 'max:32'],
            'order.tender'             => ['nullable', 'string', 'max:16'],
            'order.send_to_kitchen'    => ['sometimes', 'boolean'],
            'order.kitchen_notes'      => ['nullable', 'string', 'max:500'],
            'items.*.kitchen_notes'    => ['nullable', 'string', 'max:255'],
            'payments'                 => ['present', 'array'],
            'payments.*.id'            => ['required', 'uuid', 'distinct'],
            'payments.*.method'        => ['required', 'string', 'max:32'],
            'payments.*.amount_sen'    => ['required', 'integer'],
            'payments.*.occurred_at'   => ['required', 'date'],
        ]);

        // Throws ValidationException -> push controller stores 'rejected'.
        $v->validate();

        // Laravel's 'integer' also passes "2000" and 2000.0; quantities must be real JSON integers.
        foreach ($p['items'] as $i => $item) {
            if (! is_int($item['qty_milli'])) {
                throw new MutationRejected('invalid_qty', ['item' => $i, 'qty_milli' => $item['qty_milli']]);
            }
        }

        // The totals must add up; a terminal that sends inconsistent money is buggy.
        $o = $p['order'];
        $expected = $o['subtotal_sen'] - ($o['discount_sen'] ?? 0) + ($o['service_charge_sen'] ?? 0)
            + $o['tax_sen'] + ($o['rounding_sen'] ?? 0);
        if ($expected !== $o['total_sen']) {
            throw new MutationRejected('total_mismatch', ['expected_sen' => $expected, 'total_sen' => $o['total_sen']]);
        }

        return $p;
    }
}

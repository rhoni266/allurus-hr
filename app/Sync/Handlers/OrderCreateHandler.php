<?php

namespace App\Sync\Handlers;

use App\Models\{OfflineSyncQueue, Order, OrderItem, Payment, ProductVariant, StockMovement, SyncConflict};
use App\Database\Timestamps;
use App\Pricing\PriceResolver;
use App\Sync\{MutationHandler, MutationRejected, Outcome};
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
                'qty'               => $item['qty'],
                'unit_price_sen'    => $item['unit_price_sen'],
                'catalog_price_sen' => $catalogPrice ?? $item['unit_price_sen'],
                'price_row_version' => $item['price_row_version'],
                'modifiers'         => $item['modifiers'] ?? [],
                'occurred_at'       => $occurredAt,
            ]);

            if (! $variant || $variant->trashed()) {
                $conflicts[] = ['kind' => 'product_deleted', 'detail' => ['variant_id' => $item['variant_id'], 'item_id' => $item['id']]];
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
                $stockDeltas[$variant->id] = ($stockDeltas[$variant->id] ?? 0) - (float) $item['qty'];
            }
        }

        foreach ($stockDeltas as $variantId => $delta) {
            StockMovement::create([
                'outlet_id' => $terminal->outlet_id, 'variant_id' => $variantId,
                'reason' => 'sale', 'qty_delta' => $delta,
                'ref_id' => $order->id, 'occurred_at' => $occurredAt,
            ]);
        }
        $conflicts = array_merge($conflicts, $this->applyStock($tenantId, $terminal->outlet_id, $stockDeltas));

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

        foreach ($conflicts as $c) {
            SyncConflict::create(['queue_id' => $queue->id, 'kind' => $c['kind'], 'detail' => $c['detail']]);
        }

        $result = ['order_id' => $order->id, 'conflicts' => array_values(array_unique(array_column($conflicts, 'kind')))];

        return $conflicts ? Outcome::conflict($result) : Outcome::applied($result);
    }

    /**
     * Upsert the stock projection: decrement() on a missing row silently does nothing.
     * Locks rows in variant_id order so concurrent orders can't deadlock on each other.
     *
     * @return list<array{kind:string,detail:array}>
     */
    private function applyStock(string $tenantId, string $outletId, array $deltas): array
    {
        if (! $deltas) {
            return [];
        }
        ksort($deltas);

        $rows = [];
        foreach ($deltas as $variantId => $delta) {
            $rows[] = ['tenant_id' => $tenantId, 'outlet_id' => $outletId, 'variant_id' => $variantId, 'on_hand' => $delta];
        }

        DB::table('stock_levels')->upsert(
            $rows,
            ['outlet_id', 'variant_id'],
            ['on_hand' => DB::raw('stock_levels.on_hand + excluded.on_hand')],
        );

        // Never block revenue on inventory drift; just raise it.
        return DB::table('stock_levels')
            ->where('outlet_id', $outletId)
            ->whereIn('variant_id', array_keys($deltas))
            ->where('on_hand', '<', 0)
            ->get(['variant_id', 'on_hand'])
            ->map(fn ($r) => ['kind' => 'negative_stock', 'detail' => ['variant_id' => $r->variant_id, 'on_hand' => (float) $r->on_hand]])
            ->all();
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
            'items.*.qty'              => ['required', 'numeric', 'gt:0'],
            'items.*.unit_price_sen'   => ['required', 'integer'],
            'items.*.price_row_version'=> ['required', 'integer', 'min:0'],
            'payments'                 => ['present', 'array'],
            'payments.*.id'            => ['required', 'uuid', 'distinct'],
            'payments.*.method'        => ['required', 'string', 'max:32'],
            'payments.*.amount_sen'    => ['required', 'integer'],
            'payments.*.occurred_at'   => ['required', 'date'],
        ]);

        // Throws ValidationException -> push controller stores 'rejected'.
        $v->validate();

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

<?php

namespace App\Sync\Handlers;

use App\Billing\{PricingEngine, PricingException};
use App\Models\{OfflineSyncQueue, Order, OrderItem, OrderRefund, OrderRefundLine, Payment};
use App\Sync\{Facts, MutationHandler, MutationRejected, Outcome, StockLedger};
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * order.refund — give back part of a sale, line by line, as new rows (rule 4): the refund
 * and its lines, negative 'refunded' payments, and 'refund' stock movements for lines that
 * go back on the shelf. orders.status becomes 'partially_refunded' or 'refunded'.
 *
 * The terminal computes the amount with PricingEngine::refund (cumulative, so pieces add
 * up to the sale exactly). The server recomputes it from the stored line pricing; the
 * terminal's amount stands (the cash already left the drawer), a difference is flagged.
 *
 * Flags, never rejections: refund_amount_mismatch, over_refund (e.g. two terminals
 * refunding the same line offline), unauthorized_refund (not owner/manager),
 * offline_noncash_payment. Rejected: refunds of a voided order (the void already gave
 * everything back) and of orders synced without line pricing.
 */
class OrderRefundHandler implements MutationHandler
{
    public const ROLES = ['owner', 'manager'];

    public function handle($terminal, array $p, OfflineSyncQueue $queue): Outcome
    {
        Validator::make($p, [
            'refund_id'              => ['required', 'uuid'],
            'order_id'               => ['required', 'uuid'],
            'staff_id'               => ['required', 'uuid'],
            'reason'                 => ['required', 'string', 'max:255'],
            'occurred_at'            => ['required', 'date'],
            'refund_sen'             => ['required', 'integer', 'min:0'],
            'lines'                  => ['required', 'array', 'min:1'],
            'lines.*.item_id'        => ['required', 'uuid', 'distinct'],
            'lines.*.qty_milli'      => ['required', 'integer', 'min:1'],
            'lines.*.restock'        => ['required', 'boolean'],
            'payments'               => ['present', 'array'],
            'payments.*.id'          => ['required', 'uuid', 'distinct'],
            'payments.*.method'      => ['required', 'string', 'max:32'],
            'payments.*.amount_sen'  => ['required', 'integer', 'min:1'],
        ])->validate();
        foreach ([...array_column($p['lines'], 'qty_milli'), $p['refund_sen'], ...array_column($p['payments'], 'amount_sen')] as $n) {
            if (! is_int($n)) {
                throw new MutationRejected('invalid_amount', ['value' => $n]);
            }
        }
        $at = CarbonImmutable::parse($p['occurred_at'])->utc();

        $order = Facts::order($p['order_id']);   // locked: concurrent refunds see each other

        if (OrderRefund::whereKey($p['refund_id'])->exists()) {
            return Outcome::applied(['refund_id' => $p['refund_id'], 'note' => 'already_exists']);
        }
        if ($order->status === 'void') {
            throw new MutationRejected('order_voided', ['order_id' => $order->id]);
        }

        $items = OrderItem::where('order_id', $order->id)->get()->keyBy('id');
        if ($items->contains(fn (OrderItem $i) => $i->net_sen === null || $i->tax_code === null)) {
            throw new MutationRejected('order_not_refundable', ['order_id' => $order->id, 'why' => 'no line pricing']);
        }
        foreach ($p['lines'] as $l) {
            if (! $items->has($l['item_id'])) {
                throw new MutationRejected('unknown_line', ['item_id' => $l['item_id']]);
            }
        }

        $already = OrderRefundLine::where('order_id', $order->id)->get()
            ->groupBy('item_id')->map(fn ($g) => (int) $g->sum('qty_milli'))->all();

        // What the server would refund for the part that is still refundable
        $conflicts = [];
        $refundable = [];
        foreach ($p['lines'] as $l) {
            $left = $items[$l['item_id']]->qty_milli - min($already[$l['item_id']] ?? 0, $items[$l['item_id']]->qty_milli);
            if ($l['qty_milli'] > $left) {
                $conflicts[] = ['kind' => 'over_refund', 'detail' => ['item_id' => $l['item_id'], 'requested_milli' => $l['qty_milli'], 'refundable_milli' => $left]];
            }
            if (min($l['qty_milli'], $left) > 0) {
                $refundable[$l['item_id']] = min($l['qty_milli'], $left);
            }
        }
        $cappedAlready = array_map(fn ($id) => min($already[$id], $items[$id]->qty_milli), array_combine(array_keys($already), array_keys($already)));
        try {
            $server = $refundable ? PricingEngine::refund($this->original($order, $items), $cappedAlready, $refundable)['refund_sen'] : 0;
        } catch (PricingException $e) {
            throw new MutationRejected($e->reason, ['message' => $e->getMessage()]);
        }

        $refund = OrderRefund::create([
            'id' => $p['refund_id'], 'order_id' => $order->id, 'terminal_id' => $terminal->id, 'staff_id' => $p['staff_id'],
            'reason' => $p['reason'], 'refund_sen' => $p['refund_sen'], 'server_refund_sen' => $server,
            'spec_version' => $p['spec_version'] ?? PricingEngine::SPEC_VERSION, 'occurred_at' => $at,
        ]);

        $restock = [];
        foreach ($p['lines'] as $l) {
            $item = $items[$l['item_id']];
            OrderRefundLine::create(['refund_id' => $refund->id, 'order_id' => $order->id, 'item_id' => $item->id,
                'variant_id' => $item->variant_id, 'qty_milli' => $l['qty_milli'], 'restock' => (bool) $l['restock']]);
            if ($l['restock'] && $this->stockTracked($order->id, $item->variant_id)) {
                $restock[$item->variant_id] = ($restock[$item->variant_id] ?? 0) + $l['qty_milli'];
            }
        }
        $conflicts = array_merge($conflicts, StockLedger::move(TenantContext::require(), $order->outlet_id, $restock, 'refund', $order->id, $at));

        foreach ($p['payments'] as $pay) {
            Payment::create(['id' => $pay['id'], 'order_id' => $order->id, 'method' => $pay['method'],
                'amount_sen' => -$pay['amount_sen'], 'status' => 'refunded', 'occurred_at' => $at]);
            if ($pay['method'] !== 'cash') {
                $conflicts[] = ['kind' => 'offline_noncash_payment', 'detail' => ['payment_id' => $pay['id'], 'method' => $pay['method']]];
            }
        }
        if (($paidOut = array_sum(array_column($p['payments'], 'amount_sen'))) !== $p['refund_sen'] || $p['refund_sen'] !== $server) {
            $conflicts[] = ['kind' => 'refund_amount_mismatch', 'detail' => ['refund_sen' => $p['refund_sen'], 'paid_out_sen' => $paidOut, 'server_sen' => $server]];
        }

        // projection: fully refunded once every unit of every line has gone back
        $after = OrderRefundLine::where('order_id', $order->id)->get()->groupBy('item_id')->map(fn ($g) => (int) $g->sum('qty_milli'));
        $full = $items->every(fn (OrderItem $i) => ($after[$i->id] ?? 0) >= $i->qty_milli);
        $order->forceFill(['status' => $full ? 'refunded' : 'partially_refunded'])->save();

        return Facts::outcome(
            $queue,
            array_merge($conflicts, Facts::staffConflicts($p['staff_id'], self::ROLES, 'refund')),
            ['refund_id' => $refund->id, 'refund_sen' => $p['refund_sen'], 'server_refund_sen' => $server, 'status' => $order->status],
        );
    }

    /** The sale as PricingEngine::refund needs it, from what order.create stored. */
    private function original(Order $order, $items): array
    {
        return [
            'tender' => $order->tender, 'total_sen' => $order->total_sen,
            'service_charge_sen' => $order->service_charge_sen, 'service_charge_tax_code' => $order->service_charge_tax_code,
            'lines' => $items->map(fn (OrderItem $i) => ['id' => $i->id, 'qty_milli' => $i->qty_milli, 'net_sen' => $i->net_sen, 'tax_code' => $i->tax_code])->values()->all(),
            'tax_breakdown' => $order->tax_breakdown,
        ];
    }

    /** Only items whose sale moved stock come back to stock (timed products never did). */
    private function stockTracked(string $orderId, string $variantId): bool
    {
        return \App\Models\StockMovement::where('ref_id', $orderId)->where('variant_id', $variantId)->where('reason', 'sale')->exists();
    }
}

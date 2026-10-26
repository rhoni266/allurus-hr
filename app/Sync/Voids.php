<?php

namespace App\Sync;

use App\Kitchen\Kitchen;
use App\Models\{Order, OrderVoid, Payment, StockMovement};
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * Voiding an order, shared by order.void (a terminal) and platform cancellations (cloud):
 * an order_voids fact, stock returned (minus what refunds already returned), payments
 * netted to zero per method, orders.status = 'void' as a projection. The caller holds the
 * order lock (Facts::order) and has checked there is no void yet.
 */
final class Voids
{
    /** @return int sen reversed */
    public static function apply(Order $order, string $voidId, ?string $terminalId, ?string $staffId, string $reason, CarbonImmutable $at): int
    {
        OrderVoid::create([
            'id' => $voidId, 'order_id' => $order->id, 'terminal_id' => $terminalId,
            'staff_id' => $staffId, 'reason' => $reason, 'occurred_at' => $at,
        ]);
        $order->forceFill(['status' => 'void'])->save();

        // give back what the sale took and refunds haven't already returned, per variant
        $returned = StockMovement::where('ref_id', $order->id)->whereIn('reason', ['sale', 'refund'])->get()
            ->groupBy('variant_id')->map(fn ($g) => -(int) $g->sum('qty_delta_milli'))->all();
        StockLedger::move(TenantContext::require(), $order->outlet_id, $returned, 'void', $order->id, $at);

        // payments net to zero per method, counting anything already refunded
        $reversed = 0;
        foreach (Payment::where('order_id', $order->id)->get()->groupBy('method') as $method => $pays) {
            $net = (int) $pays->sum('amount_sen');
            if ($net > 0) {
                Payment::create([
                    'id' => (string) Str::uuid7(), 'order_id' => $order->id, 'method' => $method,
                    'amount_sen' => -$net, 'status' => 'reversed', 'occurred_at' => $at,
                ]);
                $reversed += $net;
            }
        }

        // stop the kitchen: a fired ticket is cancelled and a CANCELLED slip printed
        Kitchen::cancel($order->id);

        return $reversed;
    }
}

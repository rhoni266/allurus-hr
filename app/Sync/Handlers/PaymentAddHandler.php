<?php

namespace App\Sync\Handlers;

use App\Models\{OfflineSyncQueue, Payment};
use App\Sync\{Facts, MutationHandler, MutationRejected, Outcome};
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;

/**
 * payment.add — a payment on an existing order: settling an open tab, a second tender,
 * "pay later". The order becomes 'paid' once its payments cover the total.
 *
 * Offline is cash only (rule 9): anything else is stored and flagged. Over-payment is
 * stored and flagged too (the cash is already in the drawer). Paying a voided order is
 * flagged. The payment id is the domain idempotency key.
 */
class PaymentAddHandler implements MutationHandler
{
    private const OFFLINE_METHODS = ['cash'];

    public function handle($terminal, array $p, OfflineSyncQueue $queue): Outcome
    {
        Validator::make($p, [
            'payment_id'  => ['required', 'uuid'],
            'order_id'    => ['required', 'uuid'],
            'method'      => ['required', 'string', 'max:32'],
            'amount_sen'  => ['required', 'integer', 'min:1'],
            'staff_id'    => ['required', 'uuid'],
            'occurred_at' => ['required', 'date'],
        ])->validate();
        if (! is_int($p['amount_sen'])) {
            throw new MutationRejected('invalid_amount', ['amount_sen' => $p['amount_sen']]);
        }

        $order = Facts::order($p['order_id']);   // locked, so concurrent payments total correctly

        if (Payment::whereKey($p['payment_id'])->exists()) {
            return Outcome::applied(['payment_id' => $p['payment_id'], 'note' => 'already_exists']);
        }

        Payment::create([
            'id' => $p['payment_id'], 'order_id' => $order->id, 'method' => $p['method'],
            'amount_sen' => $p['amount_sen'], 'status' => 'succeeded',
            'occurred_at' => CarbonImmutable::parse($p['occurred_at'])->utc(),
        ]);

        $paid = (int) Payment::where('order_id', $order->id)->sum('amount_sen');
        $conflicts = Facts::staffConflicts($p['staff_id'], [], 'payment');

        if ($order->status === 'void') {
            $conflicts[] = ['kind' => 'payment_on_void_order', 'detail' => ['order_id' => $order->id, 'payment_id' => $p['payment_id']]];
        } elseif ($paid >= $order->total_sen && $order->status === 'open') {
            $order->forceFill(['status' => 'paid'])->save();
        }
        if ($order->status !== 'void' && $paid > $order->total_sen) {
            $conflicts[] = ['kind' => 'overpaid', 'detail' => ['order_id' => $order->id, 'paid_sen' => $paid, 'total_sen' => $order->total_sen]];
        }
        if (($p['offline'] ?? true) && ! in_array($p['method'], self::OFFLINE_METHODS, true)) {
            $conflicts[] = ['kind' => 'offline_noncash_payment', 'detail' => ['payment_id' => $p['payment_id'], 'method' => $p['method']]];
        }

        return Facts::outcome($queue, $conflicts, ['order_id' => $order->id, 'paid_sen' => $paid, 'status' => $order->status]);
    }
}

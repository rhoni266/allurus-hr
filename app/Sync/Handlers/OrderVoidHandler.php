<?php

namespace App\Sync\Handlers;

use App\Models\{OfflineSyncQueue, OrderVoid};
use App\Sync\{Facts, MutationHandler, Outcome, Voids};
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;

/**
 * order.void — reverses a completed sale with new rows, never by editing it (rule 4):
 * an order_voids fact, 'void' stock movements returning what the sale took, and negative
 * 'reversed' payment rows so the order's payments net to zero. orders.status becomes
 * 'void' as a projection.
 *
 * Done offline, so it is never refused for who did it: a void by a cashier is recorded
 * and flagged `unauthorized_void`. A second void of the same order (two terminals) is a
 * no-op flagged `duplicate_void`. An order that hasn't synced yet means "retry".
 */
class OrderVoidHandler implements MutationHandler
{
    public const ROLES = ['owner', 'manager'];

    public function handle($terminal, array $p, OfflineSyncQueue $queue): Outcome
    {
        Validator::make($p, [
            'void_id'     => ['required', 'uuid'],
            'order_id'    => ['required', 'uuid'],
            'staff_id'    => ['required', 'uuid'],
            'reason'      => ['required', 'string', 'max:255'],
            'occurred_at' => ['required', 'date'],
        ])->validate();
        $at = CarbonImmutable::parse($p['occurred_at'])->utc();

        $order = Facts::order($p['order_id']);   // locked; DependencyMissing if not synced yet

        if ($existing = OrderVoid::where('order_id', $order->id)->first()) {
            if ($existing->id === $p['void_id']) {
                return Outcome::applied(['order_id' => $order->id, 'note' => 'already_voided']);
            }
            return Facts::outcome($queue, [['kind' => 'duplicate_void', 'detail' => [
                'order_id' => $order->id, 'kept_void_id' => $existing->id, 'ignored_void_id' => $p['void_id'],
            ]]], ['order_id' => $order->id, 'note' => 'already_voided']);
        }

        $reversed = Voids::apply($order, $p['void_id'], $terminal->id, $p['staff_id'], $p['reason'], $at);

        return Facts::outcome(
            $queue,
            Facts::staffConflicts($p['staff_id'], self::ROLES, 'void'),
            ['order_id' => $order->id, 'reversed_sen' => $reversed],
        );
    }
}

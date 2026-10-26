<?php

namespace App\Delivery;

use App\Kitchen\Kitchen;
use App\Models\{DeliveryOrder, OrderVoid};
use App\Sync\{Facts, Voids};
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Accepting or rejecting a platform order: by a person on a terminal, by auto-accept at
 * ingest, or by auto-reject at the deadline. Each is one transaction under the same
 * per-order lock as ingest and cancel, and queues the status for the platform in it.
 *
 * Repeating the same decision is a no-op (changed = false). The other decision, or either
 * one on a cancelled order, is refused: a received order can go one way only.
 */
final class DeliveryOrderActions
{
    /** @return array{status: string, changed: bool} */
    public function accept(DeliveryOrder $order, string $by): array
    {
        return $this->locked($order, function (DeliveryOrder $do) use ($by) {
            if ($do->status === 'accepted') {
                return ['status' => 'accepted', 'changed' => false];
            }
            if ($do->status !== 'received') {
                throw new DeliveryActionRefused($do->status);
            }

            $do->update(['status' => 'accepted', 'accepted_at' => now(), 'accepted_by' => $by]);
            $sale = Facts::order($do->order_id);
            Kitchen::fire($sale, 'delivery', $sale->receipt_no, $do->kitchen_lines ?? [], $do->notes);
            DeliveryStatusOutbox::queue($do, 'accepted', ['by' => $by]);

            return ['status' => 'accepted', 'changed' => true];
        });
    }

    /**
     * Turn the order down: the platform is told, and our sale is voided (stock back,
     * payments netted to zero) through the same path as any void.
     *
     * @return array{status: string, changed: bool}
     */
    public function reject(DeliveryOrder $order, string $by, string $reason, ?string $terminalId = null, ?string $staffId = null): array
    {
        return $this->locked($order, function (DeliveryOrder $do) use ($by, $reason, $terminalId, $staffId) {
            if ($do->status === 'rejected') {
                return ['status' => 'rejected', 'changed' => false];
            }
            if ($do->status !== 'received') {
                throw new DeliveryActionRefused($do->status);
            }

            $do->update(['status' => 'rejected', 'rejected_at' => now(), 'rejected_by' => $by, 'reject_reason' => $reason]);
            if ($do->order_id && ! OrderVoid::where('order_id', $do->order_id)->exists()) {
                Voids::apply(Facts::order($do->order_id), (string) Str::uuid7(), $terminalId, $staffId,
                    "delivery rejected: {$reason}", now()->toImmutable());
            }
            DeliveryStatusOutbox::queue($do, 'rejected', ['by' => $by, 'reason' => $reason]);

            return ['status' => 'rejected', 'changed' => true];
        });
    }

    private function locked(DeliveryOrder $order, callable $fn): array
    {
        return DB::transaction(function () use ($order, $fn) {
            TenantContext::applyToTransaction();
            DeliveryOrderIngestor::lockOrder($order->connection_id, $order->external_order_id);

            return $fn(DeliveryOrder::whereKey($order->id)->firstOrFail());   // re-read under the lock
        });
    }
}

<?php

namespace App\Delivery;

use App\Database\Timestamps;
use App\Jobs\PushDeliveryStatus;
use App\Models\DeliveryOrder;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Status changes the platform must hear about (accepted, rejected, ...), written in the same
 * transaction as the change, so a crash can't accept an order without queuing the news.
 * After commit a PushDeliveryStatus job sends them at once; `delivery:tick` retries anything
 * a failed or lost job left behind.
 */
final class DeliveryStatusOutbox
{
    public static function queue(DeliveryOrder $order, string $status, array $context = []): string
    {
        $id = (string) Str::uuid7();
        $now = now()->format(Timestamps::FORMAT);
        $tenantId = TenantContext::require();
        DB::table('delivery_status_outbox')->insert([
            'id' => $id, 'tenant_id' => $tenantId, 'delivery_order_id' => $order->id,
            'status' => $status, 'context' => json_encode($context), 'next_attempt_at' => $now,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::afterCommit(fn () => PushDeliveryStatus::dispatch($tenantId, $order->id));

        return $id;
    }

    /**
     * The kitchen moved a delivery order's ticket from $from to $to: queue what the platform
     * must hear. `preparing` only if the kitchen actually said so; `ready` once the ticket
     * reaches ready or is bumped straight past it. Only for an order we accepted and the
     * platform hasn't cancelled. Caller holds the per-order delivery lock.
     *
     * @return list<string> the statuses queued
     */
    public static function kitchen(DeliveryOrder $order, string $from, string $to, array $context = []): array
    {
        if ($order->status !== 'accepted') {
            return [];
        }
        $rank = \App\Kitchen\Kitchen::RANK;
        $queued = [];
        if ($to === 'preparing') {
            $queued[] = 'preparing';
        }
        if ($rank[$from] < $rank['ready'] && $rank[$to] >= $rank['ready']) {
            $queued[] = 'ready';
        }
        foreach ($queued as $status) {
            self::queue($order, $status, $context);
        }

        return $queued;
    }
}

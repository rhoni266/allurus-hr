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
}

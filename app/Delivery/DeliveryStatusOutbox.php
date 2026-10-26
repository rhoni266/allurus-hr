<?php

namespace App\Delivery;

use App\Database\Timestamps;
use App\Models\DeliveryOrder;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Status changes the platform must hear about (accepted, preparing, ready, ...), written in
 * the same transaction as the change, so a crash can't accept an order without queuing the
 * news. Sending them (PushDeliveryStatus, strictly ordered per order, retried) is delivery
 * week 3; until then rows wait here.
 */
final class DeliveryStatusOutbox
{
    public static function queue(DeliveryOrder $order, string $status, array $context = []): string
    {
        $id = (string) Str::uuid7();
        $now = now()->format(Timestamps::FORMAT);
        DB::table('delivery_status_outbox')->insert([
            'id' => $id, 'tenant_id' => TenantContext::require(), 'delivery_order_id' => $order->id,
            'status' => $status, 'context' => json_encode($context), 'next_attempt_at' => $now,
            'created_at' => $now, 'updated_at' => $now,
        ]);

        return $id;
    }
}

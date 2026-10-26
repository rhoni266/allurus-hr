<?php

namespace App\Jobs;

use App\Delivery\DeliveryStatusPusher;
use App\Tenancy\TenantContext;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

/**
 * Sends a delivery order's queued statuses to the platform right after they commit.
 * Failures are handled inside the pusher (backoff, give up, flag); the job itself runs once.
 * delivery:tick picks up anything due that this job didn't finish.
 */
class PushDeliveryStatus implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 1;

    public function __construct(public string $tenantId, public string $deliveryOrderId)
    {
        $this->onQueue('delivery');
    }

    public function handle(DeliveryStatusPusher $pusher): void
    {
        TenantContext::enter($this->tenantId);
        try {
            $pusher->push($this->deliveryOrderId);
        } finally {
            TenantContext::leave();
        }
    }
}

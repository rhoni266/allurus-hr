<?php

namespace App\Jobs;

use App\Delivery\{DeliveryEventType, DeliveryOrderIngestor, InvalidDeliveryPayload, ProviderRegistry};
use App\Models\{DeliveryConnection, DeliveryWebhookEvent};
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\{InteractsWithQueue, SerializesModels};
use Illuminate\Bus\Queueable;

/**
 * Processes one stored delivery webhook event. Carries tenant_id and enters it first
 * (scope + RLS). A payload that can't be normalised is marked failed and not retried (a
 * retry would fail the same way; the raw body is kept for replay once the adapter is
 * fixed). Anything else is retried with backoff.
 */
class ProcessDeliveryEvent implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;
    public array $backoff = [5, 15, 60, 180];

    public function __construct(public string $eventId, public string $tenantId) {}

    public function handle(ProviderRegistry $providers, DeliveryOrderIngestor $ingestor): void
    {
        TenantContext::enter($this->tenantId);
        try {
            $event = DeliveryWebhookEvent::findOrFail($this->eventId);
            if ($event->status === 'processed') {
                return;
            }
            $c = DeliveryConnection::findOrFail($event->connection_id);
            $driver = $providers->get($event->provider);
            $payload = json_decode($event->raw_body, true);

            try {
                $status = match ($driver->eventType($payload)) {
                    DeliveryEventType::OrderCreated => $ingestor->ingest($c, $driver->normalize($payload), $payload) ? 'processed' : 'failed',
                    DeliveryEventType::OrderCancelled => $ingestor->cancel($c, $driver->externalOrderId($payload)) ? 'processed' : 'ignored',
                    DeliveryEventType::Ignore => 'ignored',
                };
            } catch (InvalidDeliveryPayload $e) {
                $event->update(['status' => 'failed', 'error' => $e->getMessage(), 'processed_at' => now()]);
                return;
            }

            $event->update(['status' => $status, 'error' => null, 'processed_at' => now()]);
        } catch (\Throwable $e) {
            DeliveryWebhookEvent::whereKey($this->eventId)->update(['status' => 'failed', 'error' => mb_substr($e->getMessage(), 0, 1000)]);
            throw $e;   // retried by the queue; surfaces in Horizon
        } finally {
            TenantContext::leave();
        }
    }
}

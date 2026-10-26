<?php

namespace App\Http\Controllers\Api;

use App\Delivery\ProviderRegistry;
use App\Jobs\ProcessDeliveryEvent;
use App\Models\{DeliveryConnection, DeliveryStoreRoute, DeliveryWebhookEvent};
use App\Tenancy\TenantContext;
use Illuminate\Http\{JsonResponse, Request};
use Illuminate\Support\Facades\{DB, Log};
use Illuminate\Support\Str;

/**
 * POST /api/v1/webhooks/delivery/{provider} — public, rate-limited, outside auth and
 * ResolveTenant: the tenant comes from the external store id, via delivery_store_routes
 * (no RLS), never from anything the caller asserts about itself.
 *
 *  1. route (provider, store) -> tenant; load the connection under that tenant
 *  2. verify the signature on the RAW body. Unknown store, inactive connection and bad
 *     signature all get the same 401, and nothing is stored (no store enumeration)
 *  3. store the event once (global unique on provider + event id), ack fast, process on
 *     the queue. A duplicate is acknowledged so the platform stops retrying.
 */
class DeliveryWebhookController
{
    public function __invoke(Request $request, string $provider, ProviderRegistry $providers): JsonResponse
    {
        $driver = $providers->get($provider);   // 404 for unknown (or, in production, the fixture) provider
        $raw = $request->getContent();
        $payload = json_decode($raw, true);
        if (! is_array($payload)) {
            return response()->json(['ok' => false], 400);
        }

        $storeRef = $driver->storeRef($request, $payload);
        $route = $storeRef ? DeliveryStoreRoute::where('provider', $provider)->where('external_store_id', $storeRef)->first() : null;
        if (! $route) {
            return $this->refuse($provider, $storeRef, $request);
        }

        TenantContext::enter($route->tenant_id);
        try {
            $c = DeliveryConnection::find($route->connection_id);
            if (! $c || ! $c->receivesOrders() || ! $driver->verifySignature($raw, $request, $c)) {
                return $this->refuse($provider, $storeRef, $request);
            }

            $eventId = $driver->eventId($payload, $raw);
            $id = (string) Str::uuid7();
            $inserted = DB::transaction(function () use ($id, $route, $provider, $c, $eventId, $driver, $payload, $raw) {
                TenantContext::applyToTransaction();
                $n = DB::table('delivery_webhook_events')->insertOrIgnore([
                    'id' => $id, 'tenant_id' => $route->tenant_id, 'provider' => $provider, 'connection_id' => $c->id,
                    'event_id' => $eventId, 'event_type' => $driver->eventType($payload)->value, 'raw_body' => $raw,
                ]);
                $c->forceFill(['last_event_at' => now()])->saveQuietly();

                return $n;
            });

            if ($inserted === 0) {
                return response()->json(['ok' => true, 'duplicate' => true]);
            }

            ProcessDeliveryEvent::dispatch($id, $route->tenant_id)->onQueue('delivery');

            return response()->json(['ok' => true]);
        } finally {
            TenantContext::leave();
        }
    }

    private function refuse(string $provider, ?string $storeRef, Request $request): JsonResponse
    {
        Log::warning('delivery.webhook.rejected', ['provider' => $provider, 'store_ref' => $storeRef, 'ip' => $request->ip()]);

        return response()->json(['ok' => false], 401);
    }
}

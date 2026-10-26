<?php

namespace App\Delivery\Providers;

use App\Delivery\Contracts\DeliveryProvider;
use App\Delivery\{DeliveryEventType, DeliveryItemData, DeliveryModifierData, DeliveryOrderData, DeliveryPushFailed, InvalidDeliveryPayload};
use App\Database\Timestamps;
use App\Models\{DeliveryConnection, DeliveryMenuMapping, DeliveryOrder};
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * A made-up provider with a deliberately ordinary contract, so the whole pipeline is
 * built and tested before any partner sandbox exists. NOT registered in production.
 *
 *   POST /api/v1/webhooks/delivery/fixture
 *   X-Fixture-Signature: hex(hmac_sha256(raw body, connection webhook_secret))
 *   {"event_id", "type": "order.created|order.cancelled|...", "store_id", "order": {...}}
 *
 * Real adapters (Deliverect, Grab...) replace exactly this class, nothing else.
 */
final class FixtureProvider implements DeliveryProvider
{
    /** Outbound calls, recorded for tests. */
    public array $sent = [];

    /**
     * Test hook: called before each outbound call; throw from it to simulate the platform
     * failing. The simulator uses services.fixture_delivery.fail_rate instead, and reads
     * services.fixture_delivery.log (one JSON line per call that reached the "platform").
     */
    public ?\Closure $before = null;

    public function key(): string
    {
        return 'fixture';
    }

    public function storeRef(Request $request, array $payload): ?string
    {
        return is_string($payload['store_id'] ?? null) ? $payload['store_id'] : null;
    }

    public function verifySignature(string $rawBody, Request $request, DeliveryConnection $c): bool
    {
        $sig = (string) $request->header('X-Fixture-Signature', '');

        return $c->webhook_secret !== null && $sig !== ''
            && hash_equals(hash_hmac('sha256', $rawBody, $c->webhook_secret), $sig);
    }

    public function eventId(array $payload, string $rawBody): string
    {
        return is_string($payload['event_id'] ?? null) ? $payload['event_id'] : 'sha256:'.hash('sha256', $rawBody);
    }

    public function eventType(array $payload): DeliveryEventType
    {
        return match ($payload['type'] ?? null) {
            'order.created' => DeliveryEventType::OrderCreated,
            'order.cancelled' => DeliveryEventType::OrderCancelled,
            default => DeliveryEventType::Ignore,
        };
    }

    public function externalOrderId(array $payload): string
    {
        return (string) ($payload['order']['id'] ?? throw new InvalidDeliveryPayload('order.id missing'));
    }

    public function normalize(array $payload): DeliveryOrderData
    {
        $o = $payload['order'] ?? throw new InvalidDeliveryPayload('order missing');
        $time = fn (?string $s) => $s === null ? null : CarbonImmutable::parse($s)->utc();

        $items = [];
        foreach ($o['items'] ?? [] as $i) {
            $mods = [];
            foreach ($i['modifiers'] ?? [] as $m) {
                $mods[] = new DeliveryModifierData((string) $m['id'], (string) $m['name'], self::int($m, 'qty', 1), self::int($m, 'price_sen', 0));
            }
            $items[] = new DeliveryItemData((string) $i['id'], (string) $i['name'], self::int($i, 'qty'), self::int($i, 'unit_price_sen'), $mods, $i['notes'] ?? null);
        }
        if (! $items) {
            throw new InvalidDeliveryPayload('an order needs at least one item');
        }

        return new DeliveryOrderData(
            externalOrderId: (string) ($o['id'] ?? throw new InvalidDeliveryPayload('order.id missing')),
            shortCode: $o['short_code'] ?? null,
            fulfilment: $o['fulfilment'] ?? 'delivery',
            paymentMode: $o['payment_mode'] ?? 'platform_collected',
            placedAt: $time($o['placed_at'] ?? throw new InvalidDeliveryPayload('placed_at missing')),
            acceptBy: $time($o['accept_by'] ?? null),
            pickupEta: $time($o['pickup_eta'] ?? null),
            items: $items,
            itemsTotalSen: self::int($o, 'items_total_sen'),
            deliveryFeeSen: self::int($o, 'delivery_fee_sen', 0),
            platformDiscountSen: self::int($o, 'platform_discount_sen', 0),
            merchantDiscountSen: self::int($o, 'merchant_discount_sen', 0),
            commissionSen: isset($o['commission_sen']) ? self::int($o, 'commission_sen') : null,
            platformTotalSen: self::int($o, 'total_sen'),
            notes: $o['notes'] ?? null,
            customer: isset($o['customer']) ? array_intersect_key($o['customer'], array_flip(['first_name', 'phone_suffix'])) : null,
        );
    }

    public function pushStatus(DeliveryConnection $c, DeliveryOrder $o, string $status, array $context = []): void
    {
        $this->call(['status', $o->external_order_id, $status, $context], $c);
    }

    public function setStoreOpen(DeliveryConnection $c, bool $open, string $reason): void
    {
        $this->call(['store', $c->external_store_id, $open, $reason], $c);
    }

    /**
     * Fails before the "platform" sees the call, or (half the simulated failures) after it,
     * as when a response is lost: the caller retries a call that already took effect.
     */
    private function call(array $entry, DeliveryConnection $c): void
    {
        if ($this->before) {
            ($this->before)($entry);
        }
        $failRate = (float) config('services.fixture_delivery.fail_rate', 0);
        $fail = $failRate > 0 && mt_rand() / mt_getrandmax() < $failRate;
        if ($fail && mt_rand(0, 1) === 0) {
            throw new DeliveryPushFailed('fixture: platform unavailable');
        }

        $this->sent[] = $entry;
        if ($log = config('services.fixture_delivery.log')) {
            file_put_contents($log, json_encode(['store' => $c->external_store_id, 'call' => $entry, 'at' => now()->format(Timestamps::FORMAT)])."\n", FILE_APPEND | LOCK_EX);
        }

        if ($fail) {
            throw new DeliveryPushFailed('fixture: response lost');
        }
    }

    public function setItemAvailability(DeliveryConnection $c, DeliveryMenuMapping $m, bool $available): void
    {
        $this->sent[] = ['availability', $m->external_item_id, $available];
    }

    public function pushMenu(DeliveryConnection $c, Collection $mappings): void
    {
        $this->sent[] = ['menu', $mappings->count()];
    }

    /** Money and counts must be JSON integers (sen, units): never floats. */
    private static function int(array $a, string $k, ?int $default = null): int
    {
        $v = $a[$k] ?? $default;
        if (! is_int($v)) {
            throw new InvalidDeliveryPayload("{$k} must be an integer");
        }

        return $v;
    }
}

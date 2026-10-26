<?php

namespace App\Delivery\Contracts;

use App\Delivery\{DeliveryEventType, DeliveryOrderData};
use App\Models\{DeliveryConnection, DeliveryMenuMapping, DeliveryOrder};
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * One platform or aggregator. Everything provider-specific (payload shape, signature
 * scheme, store identification, status API) lives behind this; the controller, ingestor
 * and status outbox are provider-agnostic.
 */
interface DeliveryProvider
{
    public function key(): string;

    /** The external store this webhook is for (header, path or body field). */
    public function storeRef(Request $request, array $payload): ?string;

    /** Authenticity over the RAW body. Must compare with hash_equals(). */
    public function verifySignature(string $rawBody, Request $request, DeliveryConnection $c): bool;

    /** Stable id for dedupe; a hash of the body if the provider sends none. */
    public function eventId(array $payload, string $rawBody): string;

    public function eventType(array $payload): DeliveryEventType;

    /** @throws \App\Delivery\InvalidDeliveryPayload */
    public function normalize(array $payload): DeliveryOrderData;

    /** For cancellations, which may carry less than a full order. */
    public function externalOrderId(array $payload): string;

    // Weeks 3-4 (status outbox, menu push); declared now so adapters are written against the whole contract.
    public function pushStatus(DeliveryConnection $c, DeliveryOrder $o, string $status, array $context = []): void;

    public function setItemAvailability(DeliveryConnection $c, DeliveryMenuMapping $m, bool $available): void;

    public function pushMenu(DeliveryConnection $c, Collection $mappings): void;
}

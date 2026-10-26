<?php

namespace App\Delivery;

use Carbon\CarbonImmutable;

/** The unified internal shape every provider normalises its order payload into. Money in sen. */
final class DeliveryOrderData
{
    /** @param list<DeliveryItemData> $items */
    public function __construct(
        public readonly string $externalOrderId,
        public readonly ?string $shortCode,
        public readonly string $fulfilment,          // delivery | pickup
        public readonly string $paymentMode,         // platform_collected | cash_on_delivery
        public readonly CarbonImmutable $placedAt,
        public readonly ?CarbonImmutable $acceptBy,
        public readonly ?CarbonImmutable $pickupEta,
        public readonly array $items,
        public readonly int $itemsTotalSen,
        public readonly int $deliveryFeeSen,
        public readonly int $platformDiscountSen,
        public readonly int $merchantDiscountSen,
        public readonly ?int $commissionSen,
        public readonly int $platformTotalSen,
        public readonly ?string $notes,
        public readonly ?array $customer,            // minimised: first name, phone suffix
    ) {}
}

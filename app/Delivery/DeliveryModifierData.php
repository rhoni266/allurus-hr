<?php

namespace App\Delivery;

final class DeliveryModifierData
{
    public function __construct(
        public readonly string $externalModifierId,
        public readonly string $name,
        public readonly int $qty,
        public readonly int $priceDeltaSen,          // per unit of the item
    ) {}
}

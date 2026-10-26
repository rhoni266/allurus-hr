<?php

namespace App\Delivery;

final class DeliveryItemData
{
    /** @param list<DeliveryModifierData> $modifiers */
    public function __construct(
        public readonly string $externalItemId,
        public readonly string $name,
        public readonly int $qty,                    // whole units, as platforms send them
        public readonly int $unitPriceSen,           // per unit, excluding modifiers
        public readonly array $modifiers = [],
        public readonly ?string $notes = null,
    ) {}
}

<?php

namespace App\Delivery;

/** Accept or reject asked of an order that is past that point (cancelled, rejected, accepted). */
final class DeliveryActionRefused extends \RuntimeException
{
    public function __construct(public readonly string $currentStatus)
    {
        parent::__construct("Delivery order is {$currentStatus}.");
    }
}

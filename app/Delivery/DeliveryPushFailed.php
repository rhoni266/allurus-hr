<?php

namespace App\Delivery;

/**
 * A call to the platform didn't go through. Transient (timeout, 5xx, rate limit) is retried
 * with backoff; permanent (the platform refuses: order already cancelled, store unknown)
 * is not, and the delivery order is flagged for a person.
 */
final class DeliveryPushFailed extends \RuntimeException
{
    public function __construct(string $message, public readonly bool $permanent = false, ?\Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }
}

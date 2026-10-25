<?php

namespace App\Billing;

/** Pricing input rejected. `reason` is one of the error codes in spec/pricing/SPEC.md. */
final class PricingException extends \InvalidArgumentException
{
    public function __construct(public readonly string $reason, string $detail = '')
    {
        parent::__construct($detail === '' ? $reason : "{$reason}: {$detail}");
    }
}

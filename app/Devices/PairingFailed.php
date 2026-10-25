<?php

namespace App\Devices;

final class PairingFailed extends \RuntimeException
{
    public function __construct(public readonly string $reason)
    {
        parent::__construct($reason);
    }
}

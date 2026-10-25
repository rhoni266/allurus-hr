<?php

namespace App\Simulator;

/** The server refused this device: it was revoked (maybe with a wipe) or is retiring. */
final class DeviceRevoked extends \RuntimeException
{
    public function __construct(public readonly string $reason, public readonly bool $wipe)
    {
        parent::__construct($reason.($wipe ? ' (wipe requested)' : ''));
    }
}

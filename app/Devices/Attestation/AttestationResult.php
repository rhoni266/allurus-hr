<?php

namespace App\Devices\Attestation;

final class AttestationResult
{
    private function __construct(public readonly bool $passed, public readonly string $reason, public readonly ?string $platform = null) {}

    public static function pass(string $platform): self { return new self(true, 'ok', $platform); }

    public static function fail(string $reason, ?string $platform = null): self { return new self(false, $reason, $platform); }
}

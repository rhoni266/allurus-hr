<?php

namespace App\Sync;

final class Outcome
{
    private function __construct(
        public readonly string $status,   // applied | conflict
        public readonly array $result = [],
    ) {}

    public static function applied(array $result = []): self { return new self('applied', $result); }

    /** Accepted and stored, but flagged for HQ review. */
    public static function conflict(array $result = []): self { return new self('conflict', $result); }
}

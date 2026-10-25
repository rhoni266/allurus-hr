<?php

namespace App\Models\Concerns;

/** Common settings for terminal/server-generated UUIDv7 keys. */
trait UuidModel
{
    use PreciseTimestamps;

    public function getIncrementing(): bool { return false; }
    public function getKeyType(): string { return 'string'; }
}

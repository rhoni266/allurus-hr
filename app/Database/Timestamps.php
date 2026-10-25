<?php

namespace App\Database;

final class Timestamps
{
    /** Full instant for timestamptz: microseconds + offset. Laravel's default drops both. */
    public const FORMAT = 'Y-m-d H:i:s.uP';
}

<?php

namespace App\Models\Concerns;

use App\Database\Timestamps;

/**
 * Laravel's default 'Y-m-d H:i:s' drops both the offset and the microseconds. For
 * timestamptz that means a device time can shift by the session zone and two sales in
 * the same second lose their order. Write the full instant instead.
 */
trait PreciseTimestamps
{
    public function getDateFormat(): string
    {
        return Timestamps::FORMAT;
    }
}

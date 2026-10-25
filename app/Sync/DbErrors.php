<?php

namespace App\Sync;

use Illuminate\Database\QueryException;

final class DbErrors
{
    /** SQLSTATEs that mean "try again later", not "this mutation is bad". */
    private const TRANSIENT = [
        '40001', // serialization_failure
        '40P01', // deadlock_detected
        '55P03', // lock_not_available
        '57014', // query_canceled (statement_timeout)
        '57P01', // admin_shutdown
        '53300', // too_many_connections
    ];

    public static function isTransient(\Throwable $e): bool
    {
        if (! $e instanceof QueryException) {
            return $e instanceof \PDOException && self::isTransientState((string) $e->getCode());
        }

        return self::isTransientState((string) ($e->errorInfo[0] ?? $e->getCode()));
    }

    private static function isTransientState(string $state): bool
    {
        // Class 08 = connection exceptions
        return in_array($state, self::TRANSIENT, true) || str_starts_with($state, '08');
    }
}

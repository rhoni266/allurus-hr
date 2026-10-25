<?php

namespace App\Tenancy;

use Illuminate\Support\Facades\DB;

final class TenantContext
{
    private static ?string $tenantId = null;

    public static function set(string $id): void { self::$tenantId = $id; }
    public static function id(): ?string { return self::$tenantId; }
    public static function clear(): void { self::$tenantId = null; }

    public static function require(): string
    {
        return self::$tenantId ?? throw new \RuntimeException('Tenant context not set.');
    }

    /**
     * Set the RLS tenant for the current DB transaction only (SET LOCAL semantics).
     * Call as the first statement inside every DB::transaction so this stays correct
     * under PgBouncer transaction pooling, where session-level settings leak.
     */
    public static function applyToTransaction(): void
    {
        DB::statement("SELECT set_config('app.tenant_id', ?, true)", [self::require()]);
    }
}

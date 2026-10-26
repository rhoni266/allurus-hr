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
     * Enter a tenant outside an HTTP request (queue jobs, CLI, webhooks resolved by route):
     * both the app-level scope AND the Postgres setting RLS reads. set() alone leaves RLS
     * hiding every row. Always pair with leave() in a finally.
     *
     * Nests: leave() restores whatever was entered before, so a job that runs inline inside
     * another (sync queue, afterCommit dispatch) doesn't strip the outer job's tenant.
     */
    public static function enter(string $id): void
    {
        self::$stack[] = self::$tenantId;
        self::set($id);
        DB::statement("SELECT set_config('app.tenant_id', ?, false)", [$id]);
    }

    public static function leave(): void
    {
        $previous = array_pop(self::$stack);
        DB::statement("SELECT set_config('app.tenant_id', ?, false)", [$previous ?? '']);
        $previous === null ? self::clear() : self::set($previous);
    }

    /** @var list<?string> tenants to restore on leave() */
    private static array $stack = [];

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

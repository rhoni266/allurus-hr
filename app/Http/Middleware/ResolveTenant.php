<?php

namespace App\Http\Middleware;

use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Support\Facades\DB;

/**
 * Must run AFTER auth:sanctum. Tenant comes from the authenticated token, never a header.
 *
 * The session-level set_config here covers plain reads outside transactions on a
 * dedicated connection. Under PgBouncer transaction pooling, rely on
 * TenantContext::applyToTransaction() inside each transaction instead.
 */
class ResolveTenant
{
    public function handle($request, Closure $next)
    {
        $user = $request->user();
        abort_unless($user && $user->tenant_id, 403, 'No tenant.');

        TenantContext::set($user->tenant_id);
        DB::statement("SELECT set_config('app.tenant_id', ?, false)", [$user->tenant_id]);

        try {
            return $next($request);
        } finally {
            DB::statement("SELECT set_config('app.tenant_id', '', false)");
            TenantContext::clear();
        }
    }
}

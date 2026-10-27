<?php

namespace App\Http\Controllers;

use App\Dashboard\DashboardData;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Http\Request;

/**
 * GET /dashboard/{tenant}?range=24h|7d|all — the back-office dashboard, read-only.
 *
 * There are no HQ users yet, so access is a signed, expiring link from
 * `php artisan pos:dashboard-link <slug>` (the same idea as CLI pairing codes). The tenant
 * id is part of what is signed: changing it breaks the signature. Only `range` may change.
 * Off in production unless POS_DASHBOARD_ENABLED=true.
 */
class DashboardController
{
    public function __invoke(Request $request, string $tenant)
    {
        abort_unless(config('pos.dashboard.enabled'), 404);
        if (! $request->hasValidSignatureWhileIgnoring(['range'], false)) {
            return response()->view('dashboard-expired', [], 403);
        }
        $t = Tenant::find($tenant) ?? abort(404);
        $range = array_key_exists((string) $request->query('range'), DashboardData::RANGES) ? $request->query('range') : '24h';

        TenantContext::enter($t->id);
        try {
            $data = DashboardData::load($t->id, $range);
        } finally {
            TenantContext::leave();
        }

        return response()->view('dashboard', ['tenant' => $t, 'range' => $range, 'd' => $data, 'request' => $request])
            ->header('Cache-Control', 'no-store')
            ->header('Referrer-Policy', 'no-referrer');
    }
}

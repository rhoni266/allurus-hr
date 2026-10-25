<?php

namespace App\Http\Middleware;

use App\Models\StaffSession;
use Closure;
use Illuminate\Http\Request;

/**
 * Requires a signed-in staff member on this terminal. Runs after ResolveTenant.
 *
 *   ->middleware('staff')                  any active staff
 *   ->middleware('staff:owner,manager')    only these roles
 *
 * The session must belong to the calling terminal: a session token copied to another
 * device (even in the same tenant) is refused.
 */
class RequireStaffSession
{
    public function handle(Request $request, Closure $next, string ...$roles)
    {
        $token = $request->header('X-Staff-Session');
        abort_unless(is_string($token) && $token !== '', 401, 'Staff sign-in required.');

        $session = StaffSession::with('staff')
            ->where('token_hash', hash('sha256', $token))
            ->where('terminal_id', $request->user()->id)
            ->whereNull('revoked_at')
            ->where('expires_at', '>', now())
            ->first();

        abort_unless($session && $session->staff?->is_active, 401, 'Staff session invalid or expired.');
        abort_if($roles && ! in_array($session->staff->role, $roles, true), 403, 'Not allowed for this role.');

        if (! $session->last_used_at || $session->last_used_at->lt(now()->subMinute())) {
            $session->forceFill(['last_used_at' => now()])->save();
        }

        $request->attributes->set('staff', $session->staff);
        $request->attributes->set('staff_session', $session);

        return $next($request);
    }
}

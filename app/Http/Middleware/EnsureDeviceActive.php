<?php

namespace App\Http\Middleware;

use App\Devices\DeviceLifecycle;
use App\Models\Terminal;
use Closure;
use Illuminate\Http\Request;

/**
 * Runs after auth:sanctum on every device route. Refusals carry a machine-readable
 * reason so the device knows what to do:
 *
 *   403 {"error":"device_revoked","wipe":true}   erase local data, then POST devices/wipe-confirm
 *   403 {"error":"device_revoked","wipe":false}  stop; show "this device was removed"
 *   403 {"error":"device_retiring"}              only sync/push (pre-cutoff backlog) and devices/retired
 */
class EnsureDeviceActive
{
    private const RETIRING_ALLOWED = ['sync.push', 'devices.retired'];

    public function __construct(private DeviceLifecycle $lifecycle) {}

    public function handle(Request $request, Closure $next)
    {
        /** @var Terminal $t */
        $t = $this->lifecycle->expireIfDue($request->user());
        $route = $request->route()?->getName();

        if ($t->status === Terminal::REVOKED) {
            $wipe = $t->wipe_requested_at !== null;
            if ($route === 'devices.wipe-confirm' && $wipe) {
                return $next($request);
            }
            return response()->json(['error' => 'device_revoked', 'wipe' => $wipe && $t->wipe_confirmed_at === null], 403);
        }

        if ($t->status === Terminal::RETIRING && ! in_array($route, self::RETIRING_ALLOWED, true)) {
            return response()->json(['error' => 'device_retiring', 'cutoff' => $t->retire_requested_at->toIso8601String()], 403);
        }

        return $next($request);
    }
}

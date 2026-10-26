<?php

namespace App\Http\Controllers\Api;

use App\Devices\PairingService;
use App\Models\{Outlet, Staff};
use Illuminate\Http\Request;

/**
 * POST /api/v1/devices/pairing-codes — an owner or manager, signed in on a paired
 * terminal, issues a code for another device. Managers can pair devices only for
 * their own outlet; owners for any outlet of their tenant.
 */
class PairingCodeController
{
    public function __invoke(Request $request, PairingService $pairing)
    {
        /** @var Staff $staff */
        $staff = $request->attributes->get('staff');
        $data = $request->validate(['outlet_id' => ['nullable', 'uuid'], 'kind' => ['nullable', 'in:terminal,kitchen']]);

        $outletId = $data['outlet_id'] ?? $request->user()->outlet_id;
        if ($staff->role === 'manager' && $staff->outlet_id !== null && $outletId !== $staff->outlet_id) {
            abort(403, 'Managers can pair devices for their own outlet only.');
        }

        // TenantScope: another tenant's outlet id simply isn't found
        $outlet = Outlet::find($outletId) ?? abort(404, 'Unknown outlet.');
        $kind = $data['kind'] ?? 'terminal';
        $issued = $pairing->issue($outlet, $staff->id, $kind);

        return response()->json([
            'code'       => $issued['code'],
            'kind'       => $kind,
            'outlet_id'  => $outlet->id,
            'expires_at' => $issued['expires_at']->toIso8601String(),
        ], 201);
    }
}

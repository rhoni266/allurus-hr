<?php

namespace App\Http\Controllers\Api;

use App\Devices\{PairingFailed, PairingService};
use Illuminate\Http\Request;

/** POST /api/v1/devices/register — public, rate-limited. Trades a one-time code for a device token. */
class DeviceRegisterController
{
    public function __invoke(Request $request, PairingService $pairing)
    {
        $data = $request->validate([
            'code'               => ['required', 'string', 'max:32'],
            'device_fingerprint' => ['required', 'string', 'min:16', 'max:255'],
            'name'               => ['nullable', 'string', 'max:64'],
        ]);

        try {
            ['terminal' => $t, 'token' => $token] = $pairing->redeem($data['code'], $data['device_fingerprint'], $data['name'] ?? null);
        } catch (PairingFailed $e) {
            return response()->json(['error' => $e->reason], $e->reason === 'device_registered_elsewhere' ? 409 : 422);
        }

        return response()->json([
            'token'    => $token,   // shown once; store it in the device keystore
            'terminal' => ['id' => $t->id, 'name' => $t->name, 'tenant_id' => $t->tenant_id, 'outlet_id' => $t->outlet_id],
            'next'     => ['pull' => '/api/v1/sync/pull?cursor=0'],
        ], 201);
    }
}

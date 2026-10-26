<?php

namespace App\Http\Controllers\Api;

use App\Devices\{PairingFailed, PairingService};
use App\Devices\Attestation\Attestation;
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
            'attestation'        => ['nullable', 'array'],
        ]);

        // Refuse rooted / jailbroken / emulated devices before they get a token.
        // Checked before the code, so a refused device doesn't burn the pairing code.
        // Kitchen devices (a print node may be a Raspberry Pi, which can't attest) are exempt
        // unless pos.attestation.kitchen_required: they hold no sales, cash or credentials.
        $kitchen = $pairing->kindOf($data['code']) === 'kitchen';
        if (Attestation::required() && (! $kitchen || config('pos.attestation.kitchen_required'))) {
            $att = Attestation::check($data['attestation'] ?? null);
            if (! $att->passed) {
                return response()->json(['error' => 'attestation_failed', 'reason' => $att->reason], 422);
            }
        }

        try {
            ['terminal' => $t, 'token' => $token] = $pairing->redeem($data['code'], $data['device_fingerprint'], $data['name'] ?? null);
        } catch (PairingFailed $e) {
            return response()->json(['error' => $e->reason], $e->reason === 'device_registered_elsewhere' ? 409 : 422);
        }

        return response()->json([
            'token'    => $token,   // shown once; store it in the device keystore
            'terminal' => ['id' => $t->id, 'name' => $t->name, 'kind' => $t->kind, 'tenant_id' => $t->tenant_id, 'outlet_id' => $t->outlet_id],
            'next'     => ['pull' => '/api/v1/sync/pull?cursor=0'],
        ], 201);
    }
}

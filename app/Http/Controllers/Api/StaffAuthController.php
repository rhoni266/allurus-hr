<?php

namespace App\Http\Controllers\Api;

use App\Models\{Staff, StaffSession};
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Hash, RateLimiter};
use Illuminate\Support\Str;

/**
 * Staff sign-in on a paired terminal (terminal bearer token required, tenant from it).
 *
 * A 4-digit PIN has only 10,000 values, so guessing is throttled twice: per staff member on
 * this terminal, and per terminal across all staff (stops spraying one PIN at everyone).
 */
class StaffAuthController
{
    public const SESSION_HOURS = 12;            // one shift
    public const MAX_PER_STAFF = 5;
    public const MAX_PER_TERMINAL = 15;
    public const LOCKOUT_SECONDS = 900;

    // Checked against for unknown staff ids, so response time doesn't reveal which ids exist.
    private static ?string $dummyHash = null;

    public function login(Request $request)
    {
        $data = $request->validate([
            'staff_id' => ['required', 'uuid'],
            'pin'      => ['required', 'string', 'regex:/^\d{4,8}$/'],
        ]);
        $terminal = $request->user();

        $staffKey = "pin:{$terminal->id}:{$data['staff_id']}";
        $terminalKey = "pin:{$terminal->id}";
        foreach ([[$staffKey, self::MAX_PER_STAFF], [$terminalKey, self::MAX_PER_TERMINAL]] as [$key, $max]) {
            if (RateLimiter::tooManyAttempts($key, $max)) {
                return response()->json(['error' => 'too_many_attempts', 'retry_after' => RateLimiter::availableIn($key)], 429);
            }
        }

        $staff = Staff::find($data['staff_id']);   // TenantScope: another tenant's staff isn't found
        $ok = $staff
            ? $staff->checkPin($data['pin']) && ($staff->outlet_id === null || $staff->outlet_id === $terminal->outlet_id)
            : Hash::check($data['pin'], self::$dummyHash ??= Hash::make(Str::random(16))) && false;

        if (! $ok) {
            RateLimiter::hit($staffKey, self::LOCKOUT_SECONDS);
            RateLimiter::hit($terminalKey, self::LOCKOUT_SECONDS);
            return response()->json(['error' => 'invalid_credentials'], 401);
        }

        RateLimiter::clear($staffKey);

        $token = Str::random(48);
        $session = StaffSession::create([
            'terminal_id' => $terminal->id,
            'staff_id'    => $staff->id,
            'token_hash'  => hash('sha256', $token),
            'expires_at'  => CarbonImmutable::now()->addHours(self::SESSION_HOURS),
        ]);

        return response()->json([
            'session_token' => $token,   // send as X-Staff-Session
            'expires_at'    => $session->expires_at->toIso8601String(),
            'staff'         => $this->staffJson($staff),
        ], 201);
    }

    public function me(Request $request)
    {
        return response()->json(['staff' => $this->staffJson($request->attributes->get('staff'))]);
    }

    public function logout(Request $request)
    {
        $request->attributes->get('staff_session')->forceFill(['revoked_at' => now()])->save();

        return response()->noContent();
    }

    private function staffJson(Staff $s): array
    {
        return ['id' => $s->id, 'name' => $s->name, 'role' => $s->role, 'outlet_id' => $s->outlet_id];
    }
}

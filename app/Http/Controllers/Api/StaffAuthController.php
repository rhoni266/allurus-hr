<?php

namespace App\Http\Controllers\Api;

use App\Devices\Attestation\Attestation;
use App\Models\{Staff, StaffCredential, StaffSession};
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB, Hash, RateLimiter};
use Illuminate\Support\Str;

/**
 * Staff sign-in on a paired terminal (terminal bearer token required, tenant from it).
 *
 * A 4-digit PIN has only 10,000 values, so guessing is throttled twice: per staff member on
 * this terminal, and per terminal across all staff (stops spraying one PIN at everyone).
 *
 * An online sign-in can also issue an offline credential for this staff member on this
 * terminal (docs/offline-pin-signin.md, option C): permission, not a secret. The device
 * derives and seals the PIN verifier itself with a hardware key; the server only says
 * how (KDF parameters), for how long, and for which pin_version.
 */
class StaffAuthController
{
    public const SESSION_HOURS = 12;            // one shift
    public const MAX_PER_STAFF = 5;
    public const MAX_PER_TERMINAL = 15;
    public const LOCKOUT_SECONDS = 900;

    /** What the device must use to derive the verifier it seals (sent with each credential). */
    public const KDF = ['alg' => 'argon2id', 'memory_kib' => 65536, 'iterations' => 3, 'parallelism' => 1, 'salt_bytes' => 16];

    // Checked against for unknown staff ids, so response time doesn't reveal which ids exist.
    private static ?string $dummyHash = null;

    public function login(Request $request)
    {
        $data = $request->validate([
            'staff_id'    => ['required', 'uuid'],
            'pin'         => ['required', 'string', 'regex:/^\d{4,8}$/'],
            'attestation' => ['nullable', 'array'],
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

        // Right PIN, but too short for an owner/manager (e.g. a promoted cashier): a manager
        // or the CLI must set a 6-digit one first. No session, no offline credential.
        if ($staff->needsLongerPin()) {
            return response()->json(['error' => 'pin_change_required', 'min_length' => Staff::minPinLength($staff->role)], 403);
        }

        $token = Str::random(48);
        $session = StaffSession::create([
            'terminal_id' => $terminal->id,
            'staff_id'    => $staff->id,
            'token_hash'  => hash('sha256', $token),
            'expires_at'  => CarbonImmutable::now()->addHours(self::SESSION_HOURS),
        ]);

        return response()->json([
            'session_token'      => $token,   // send as X-Staff-Session
            'expires_at'         => $session->expires_at->toIso8601String(),
            'staff'              => $this->staffJson($staff),
            'offline_credential' => $this->offlineCredential($staff, $terminal, $data['attestation'] ?? null),
        ], 201);
    }

    /** POST auth/pin — change your own PIN. Revokes your offline credentials and other sessions. */
    public function changePin(Request $request)
    {
        $data = $request->validate(['current_pin' => ['required', 'string'], 'new_pin' => ['required', 'string']]);
        /** @var Staff $staff */
        $staff = $request->attributes->get('staff');

        if (! $staff->checkPin($data['current_pin'])) {
            return response()->json(['error' => 'invalid_credentials'], 401);
        }

        return $this->setPin($staff, $data['new_pin'], keepSession: $request->attributes->get('staff_session')->id);
    }

    /**
     * POST staff/{id}/pin — an owner or manager sets someone else's PIN (forgotten, or a
     * promotion needs 6 digits). Managers: cashiers/kitchen at their own outlet only.
     */
    public function resetPin(Request $request, string $id)
    {
        $data = $request->validate(['new_pin' => ['required', 'string']]);
        /** @var Staff $actor */
        $actor = $request->attributes->get('staff');
        $target = Staff::find($id) ?? abort(404, 'Unknown staff member.');

        if ($actor->role === 'manager'
            && (in_array($target->role, Staff::LONG_PIN_ROLES, true) || ($actor->outlet_id && $target->outlet_id !== $actor->outlet_id))) {
            abort(403, 'Managers can reset PINs only for cashiers and kitchen staff at their outlet.');
        }

        return $this->setPin($target, $data['new_pin']);
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

    /**
     * Only issued to an attested device when attestation is required (decision 4: refuse
     * rooted devices). Returns null plus the reason otherwise; online sign-in still works.
     */
    private function offlineCredential(Staff $staff, $terminal, ?array $attestation): array
    {
        if (Attestation::required() || $attestation) {
            $att = Attestation::check($attestation);
            if (! $att->passed) {
                return ['issued' => false, 'reason' => $att->reason];
            }
        }

        $now = CarbonImmutable::now();
        $c = StaffCredential::create([
            'outlet_id' => $terminal->outlet_id, 'staff_id' => $staff->id, 'terminal_id' => $terminal->id,
            'pin_version' => $staff->pin_version, 'issued_at' => $now,
            'expires_at' => $now->addDays(StaffCredential::OFFLINE_WINDOW_DAYS),
        ]);

        return [
            'issued' => true, 'id' => $c->id, 'pin_version' => $c->pin_version,
            'issued_at' => $c->issued_at->toIso8601String(), 'expires_at' => $c->expires_at->toIso8601String(),
            'kdf' => self::KDF,
        ];
    }

    private function setPin(Staff $staff, string $pin, ?string $keepSession = null)
    {
        try {
            $staff->setPin($pin);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => 'invalid_pin', 'message' => $e->getMessage()], 422);
        }

        DB::transaction(function () use ($staff, $keepSession) {
            $staff->save();   // pin_version bump -> trigger revokes offline credentials
            StaffSession::where('staff_id', $staff->id)->whereNull('revoked_at')
                ->when($keepSession, fn ($q) => $q->where('id', '!=', $keepSession))
                ->update(['revoked_at' => now()]);
        });

        return response()->json(['staff' => $this->staffJson($staff), 'pin_version' => $staff->pin_version]);
    }

    private function staffJson(Staff $s): array
    {
        return ['id' => $s->id, 'name' => $s->name, 'role' => $s->role, 'outlet_id' => $s->outlet_id];
    }
}

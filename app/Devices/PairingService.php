<?php

namespace App\Devices;

use App\Models\{DevicePairingCode, Outlet, StaffSession, Terminal};
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Pairing a POS device with an outlet:
 *  1. a manager (CLI/HQ, or an owner/manager signed in on a paired terminal) issues a
 *     one-time code for an outlet;
 *  2. the new device redeems it once, within the TTL, and receives a Sanctum token with
 *     the single ability `pos:terminal`. The tenant comes from the code, never the device.
 */
final class PairingService
{
    public const TTL_MINUTES = 15;

    // No 0/O, 1/I/L: codes get read aloud and typed on a tablet.
    private const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    private const LENGTH = 8;   // 31^8 ~ 8.5e11; with the TTL and the rate limit, not guessable

    /** @return array{code: string, expires_at: CarbonImmutable, id: string} plaintext code, shown once */
    public function issue(Outlet $outlet, ?string $issuedByStaffId = null): array
    {
        $code = '';
        for ($i = 0; $i < self::LENGTH; $i++) {
            $code .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
        }

        $row = DevicePairingCode::create([
            'id' => (string) Str::uuid7(),     // not BelongsToTenant, so no automatic id
            'tenant_id' => $outlet->tenant_id,
            'outlet_id' => $outlet->id,
            'code_hash' => self::hash($code),
            'expires_at' => CarbonImmutable::now()->addMinutes(self::TTL_MINUTES),
            'issued_by_staff_id' => $issuedByStaffId,
        ]);

        return ['code' => substr($code, 0, 4).'-'.substr($code, 4), 'expires_at' => $row->expires_at, 'id' => $row->id];
    }

    /**
     * Redeem a code. Unknown, used and expired codes fail identically, so the response
     * can't be used to probe which codes exist.
     *
     * @return array{terminal: Terminal, token: string}
     * @throws PairingFailed
     */
    public function redeem(string $code, string $fingerprint, ?string $name = null): array
    {
        return DB::transaction(function () use ($code, $fingerprint, $name) {
            $row = DevicePairingCode::where('code_hash', self::hash($code))->lockForUpdate()->first();
            if (! $row || $row->used_at !== null || $row->expires_at->isPast()) {
                throw new PairingFailed('invalid_or_expired_code');
            }

            $terminal = Terminal::where('device_fingerprint', $fingerprint)->lockForUpdate()->first();
            if ($terminal && $terminal->tenant_id !== $row->tenant_id) {
                // a device belongs to one merchant; moving it is an explicit unpair at the old one
                throw new PairingFailed('device_registered_elsewhere');
            }

            TenantContext::set($row->tenant_id);
            TenantContext::applyToTransaction();
            try {
                if ($terminal) {
                    // Re-pairing (wiped tablet, moved outlet): the old credentials die here.
                    $terminal->tokens()->delete();
                    StaffSession::where('terminal_id', $terminal->id)->whereNull('revoked_at')->update(['revoked_at' => now()]);
                    $terminal->forceFill([
                        'outlet_id' => $row->outlet_id, 'name' => $name ?? $terminal->name, 'paired_at' => now(),
                        // a retired / revoked / wiped device comes back as a fresh one
                        'status' => Terminal::ACTIVE, 'retire_requested_at' => null, 'revoked_at' => null,
                        'wipe_requested_at' => null, 'wipe_confirmed_at' => null, 'revoked_by_staff_id' => null,
                        'revoke_reason' => null, 'outbox_pending' => null,
                    ])->save();
                } else {
                    $terminal = Terminal::create([
                        'tenant_id' => $row->tenant_id, 'outlet_id' => $row->outlet_id,
                        'name' => $name ?? 'Terminal', 'device_fingerprint' => $fingerprint, 'paired_at' => now(),
                    ]);
                }

                $row->forceFill(['used_at' => now(), 'used_by_terminal_id' => $terminal->id])->save();
                $token = $terminal->createToken('device', ['pos:terminal'])->plainTextToken;
            } finally {
                TenantContext::clear();
            }

            return ['terminal' => $terminal, 'token' => $token];
        });
    }

    /** Case, spaces and dashes don't matter: "abcd efgh" == "ABCD-EFGH". */
    public static function hash(string $code): string
    {
        return hash('sha256', preg_replace('/[^A-Z0-9]/', '', strtoupper($code)));
    }
}

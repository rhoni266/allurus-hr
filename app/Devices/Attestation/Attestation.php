<?php

namespace App\Devices\Attestation;

use Illuminate\Support\Facades\Cache;

/**
 * Entry point for device attestation:
 *
 *   1. POST /api/v1/attestation/challenge  -> one-time nonce (5 min)
 *   2. the device gets a platform token bound to that nonce
 *   3. it sends {platform, nonce, token} with devices/register or auth/login
 *
 * Each nonce works once, so a captured token can't be replayed.
 */
final class Attestation
{
    private const DRIVERS = [
        'play_integrity' => PlayIntegrityAttestation::class,
        'app_attest'     => AppAttestAttestation::class,
        'dev'            => DevAttestation::class,
    ];

    public static function required(): bool
    {
        return (bool) config('pos.attestation.required');
    }

    public static function challenge(): array
    {
        $nonce = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $ttl = (int) config('pos.attestation.challenge_ttl_seconds');
        Cache::put("attest:{$nonce}", true, $ttl);

        return ['nonce' => $nonce, 'expires_in' => $ttl];
    }

    /** @param array{platform?:string, nonce?:string, token?:string}|null $att */
    public static function check(?array $att): AttestationResult
    {
        if (! $att || ! isset($att['platform'], $att['nonce'], $att['token'])) {
            return AttestationResult::fail('attestation_missing');
        }
        if (! Cache::pull("attest:{$att['nonce']}")) {   // single use
            return AttestationResult::fail('unknown_or_used_challenge', $att['platform']);
        }

        $driver = match ($att['platform']) {
            'android' => config('pos.attestation.android'),
            'ios'     => config('pos.attestation.ios'),
            default   => null,
        };
        if (! isset(self::DRIVERS[$driver])) {
            return AttestationResult::fail('unsupported_platform', $att['platform']);
        }
        if ($driver === 'dev' && app()->environment('production')) {
            return AttestationResult::fail('dev_attestation_in_production', $att['platform']);
        }

        return app(self::DRIVERS[$driver])->verify((string) $att['token'], $att['nonce']);
    }
}

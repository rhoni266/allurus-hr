<?php

namespace App\Devices\Attestation;

use Illuminate\Support\Facades\Http;

/**
 * Android: Google Play Integrity. The device requests a token with the server's nonce;
 * the server asks Google to decode it and checks the verdict:
 *
 *   requestDetails.nonce            == our one-time challenge
 *   requestDetails.requestPackageName == our app
 *   requestDetails.timestampMillis  is recent
 *   appIntegrity.appRecognitionVerdict == PLAY_RECOGNIZED   (our unmodified app)
 *   deviceIntegrity.deviceRecognitionVerdict ∋ MEETS_DEVICE_INTEGRITY  (not rooted/emulated)
 *
 * Fails closed on any HTTP error, missing field or unexpected value.
 *
 * Not yet exercised against Google itself: tests fake the decode response. Before go-live,
 * replace the static access token with one minted from the service-account key and run
 * one real device through it.
 */
final class PlayIntegrityAttestation implements AttestationVerifier
{
    public function verify(string $token, string $nonce): AttestationResult
    {
        $cfg = config('pos.attestation.play_integrity');
        if (empty($cfg['access_token'])) {
            return AttestationResult::fail('not_configured', 'android');
        }

        try {
            $res = Http::withToken($cfg['access_token'])->acceptJson()->timeout(10)
                ->post("https://playintegrity.googleapis.com/v1/{$cfg['package_name']}:decodeIntegrityToken", ['integrity_token' => $token]);
        } catch (\Throwable) {
            return AttestationResult::fail('verifier_unreachable', 'android');
        }
        if (! $res->successful()) {
            return AttestationResult::fail('verifier_rejected', 'android');
        }

        $p = $res->json('tokenPayloadExternal') ?? [];
        $req = $p['requestDetails'] ?? [];
        $ageMs = (int) (microtime(true) * 1000) - (int) ($req['timestampMillis'] ?? 0);

        return match (true) {
            ! hash_equals($nonce, (string) ($req['nonce'] ?? '')) => AttestationResult::fail('nonce_mismatch', 'android'),
            ($req['requestPackageName'] ?? null) !== $cfg['package_name'] => AttestationResult::fail('wrong_app', 'android'),
            $ageMs < 0 || $ageMs > $cfg['max_age_seconds'] * 1000 => AttestationResult::fail('stale', 'android'),
            ($p['appIntegrity']['appRecognitionVerdict'] ?? null) !== 'PLAY_RECOGNIZED' => AttestationResult::fail('app_integrity', 'android'),
            ! in_array('MEETS_DEVICE_INTEGRITY', $p['deviceIntegrity']['deviceRecognitionVerdict'] ?? [], true) => AttestationResult::fail('device_integrity', 'android'),
            default => AttestationResult::pass('android'),
        };
    }
}

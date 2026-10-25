<?php

namespace App\Devices\Attestation;

/**
 * For tests, the simulator and local development only: a verdict signed with APP_KEY,
 * so the whole attestation path (challenge, nonce binding, refusal) runs without Google
 * or Apple. Refused outright in production by Attestation.
 *
 * Token: base64url(json {nonce, verdict}) "." base64url(hmac_sha256(payload, APP_KEY))
 * verdict: MEETS_DEVICE_INTEGRITY passes; anything else (e.g. ROOTED) fails.
 */
final class DevAttestation implements AttestationVerifier
{
    public static function token(string $nonce, string $verdict = 'MEETS_DEVICE_INTEGRITY'): string
    {
        $payload = self::b64(json_encode(['nonce' => $nonce, 'verdict' => $verdict]));

        return $payload.'.'.self::b64(hash_hmac('sha256', $payload, config('app.key'), true));
    }

    public function verify(string $token, string $nonce): AttestationResult
    {
        [$payload, $sig] = array_pad(explode('.', $token, 2), 2, '');
        if (! hash_equals(self::b64(hash_hmac('sha256', $payload, config('app.key'), true)), $sig)) {
            return AttestationResult::fail('bad_signature', 'dev');
        }
        $claims = json_decode(base64_decode(strtr($payload, '-_', '+/')), true);
        if (! is_array($claims) || ! hash_equals($nonce, (string) ($claims['nonce'] ?? ''))) {
            return AttestationResult::fail('nonce_mismatch', 'dev');
        }

        return ($claims['verdict'] ?? null) === 'MEETS_DEVICE_INTEGRITY'
            ? AttestationResult::pass('dev')
            : AttestationResult::fail('device_integrity', 'dev');
    }

    private static function b64(string $bin): string
    {
        return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
    }
}

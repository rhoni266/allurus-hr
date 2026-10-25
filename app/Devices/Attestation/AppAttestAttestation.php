<?php

namespace App\Devices\Attestation;

/**
 * iOS: Apple App Attest. NOT IMPLEMENTED — fails closed, so with attestation required no
 * iOS device can pair or get offline credentials until it is.
 *
 * To implement: decode the CBOR attestation object, verify the x5c chain to Apple's App
 * Attestation root CA, check the nonce = SHA256(authData || SHA256(challenge)) extension,
 * the RP ID hash = SHA256(teamId.bundleId), counter = 0 and aaguid (production vs
 * development), then store the key id + public key for later assertions.
 */
final class AppAttestAttestation implements AttestationVerifier
{
    public function verify(string $token, string $nonce): AttestationResult
    {
        return AttestationResult::fail('not_implemented', 'ios');
    }
}

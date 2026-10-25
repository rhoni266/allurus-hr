<?php

namespace App\Devices\Attestation;

interface AttestationVerifier
{
    /**
     * Verify a platform attestation token bound to $nonce (a one-time server challenge).
     * Must fail closed: anything unverifiable is a failure, never a pass.
     */
    public function verify(string $token, string $nonce): AttestationResult;
}

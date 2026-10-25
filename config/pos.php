<?php

return [
    // POST /api/v1/devices/register attempts per minute per IP.
    'pairing_per_minute' => (int) env('POS_PAIRING_PER_MINUTE', 10),

    // Refuse rooted / jailbroken / emulated devices (docs/offline-pin-signin.md, decision 4).
    // When required, pairing needs a passing attestation and offline credentials are only
    // issued to attested devices. Defaults are production-safe: required, real drivers.
    'attestation' => [
        'required' => (bool) env('POS_ATTESTATION_REQUIRED', true),
        'android'  => env('POS_ATTESTATION_ANDROID', 'play_integrity'),   // play_integrity | dev
        'ios'      => env('POS_ATTESTATION_IOS', 'app_attest'),           // app_attest | dev
        'challenge_ttl_seconds' => 300,

        'play_integrity' => [
            'package_name' => env('POS_ANDROID_PACKAGE', 'my.allurus.pos'),
            // OAuth access token for a service account with the Play Integrity API enabled.
            // Production should mint this from the service-account key; see PlayIntegrityAttestation.
            'access_token' => env('POS_PLAY_INTEGRITY_ACCESS_TOKEN'),
            'max_age_seconds' => 300,
        ],
    ],
];

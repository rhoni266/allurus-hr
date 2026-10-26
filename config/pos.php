<?php

return [
    // POST /api/v1/devices/register attempts per minute per IP.
    'pairing_per_minute' => (int) env('POS_PAIRING_PER_MINUTE', 10),

    // Refuse rooted / jailbroken / emulated devices (docs/offline-pin-signin.md, decision 4).
    // When required, pairing needs a passing attestation and offline credentials are only
    // issued to attested devices. Defaults are production-safe: required, real drivers.
    'attestation' => [
        'required' => (bool) env('POS_ATTESTATION_REQUIRED', true),
        // Kitchen devices (KDS, print nodes) hold no sales, cash or credentials, and a print
        // node may be a board that can't attest, so by default they pair without it.
        'kitchen_required' => (bool) env('POS_ATTESTATION_KITCHEN_REQUIRED', false),
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

    // Kitchen (docs/web-ordering-and-auto-accept.md).
    'kitchen' => [
        // A kitchen device counts as listening if it heartbeat within this many seconds.
        'presence_seconds' => (int) env('POS_KITCHEN_PRESENCE_SECONDS', 60),
        // A terminal sale sent to the kitchen that reaches the server later than this
        // (device time) gets a 'late' ticket: recorded, not printed, flagged.
        'fresh_seconds' => (int) env('POS_KITCHEN_FRESH_SECONDS', 900),
    ],

    // Delivery week 3 (docs/delivery-integration.md).
    'delivery' => [
        // Seconds to wait before each retry of a status the platform didn't take; after the
        // last one the row is given up and the order flagged status_push_failed.
        'push_backoff' => array_map('intval', explode(',', env('POS_DELIVERY_PUSH_BACKOFF', '5,15,30,60,120,300,600,1800'))),
        // Reject an unaccepted order this long before the platform's accept deadline, so our
        // answer arrives before the platform gives up (and penalises the store) on its own.
        'reject_margin_seconds' => (int) env('POS_DELIVERY_REJECT_MARGIN_SECONDS', 20),
        // The watchdog pauses an auto-accepting store once its kitchen has been quiet this long.
        'pause_after_seconds' => (int) env('POS_DELIVERY_PAUSE_AFTER_SECONDS', 120),
    ],
];

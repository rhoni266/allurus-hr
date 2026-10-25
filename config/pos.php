<?php

return [
    // POST /api/v1/devices/register attempts per minute per IP.
    'pairing_per_minute' => (int) env('POS_PAIRING_PER_MINUTE', 10),
];

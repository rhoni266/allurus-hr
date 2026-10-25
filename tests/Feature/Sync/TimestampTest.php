<?php

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

// Regression: found by sim:run clock-skew. Timestamps were written as 'Y-m-d H:i:s'
// (no offset, no microseconds) and read in the server's Asia/Kuala_Lumpur zone,
// so every synced sale landed 8 hours early.

it('stores the device occurred_at as the exact instant', function (string $sent) {
    // DB session in a non-UTC zone, like the Windows installer default
    DB::statement("SET timezone = 'Asia/Kuala_Lumpur'");
    $w = world();
    actAsTerminal($w->terminal);

    $m = orderMutation($w, order: ['occurred_at' => $sent]);
    $m['payload']['payments'][0]['occurred_at'] = $sent;
    push($m)->assertOk();

    asTenant($w->tenant->id);
    $want = CarbonImmutable::parse($sent);
    foreach (['orders', 'order_items', 'payments', 'stock_movements', 'order_ids'] as $table) {
        $stored = DB::table($table)->selectRaw("to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US') t")->value('t');
        expect($stored)->toBe($want->utc()->format('Y-m-d\TH:i:s.u'), $table);
    }
})->with([
    'utc with micros'   => '2026-10-20T10:30:30.861395Z',
    'local offset'      => '2026-10-20T18:30:30.000123+08:00',
]);

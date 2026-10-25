<?php

/**
 * Runs spec/time-billing/vectors.json against app/Billing/TimeBilling.php. No framework.
 *
 *   php spec/time-billing/run.php       # exit 0 = all pass
 */

require __DIR__.'/../../app/Billing/PricingException.php';
require __DIR__.'/../../app/Billing/PricingEngine.php';
require __DIR__.'/../../app/Billing/TimeBilling.php';

use App\Billing\{PricingException, TimeBilling};

$spec = json_decode(file_get_contents(__DIR__.'/vectors.json'), true, flags: JSON_THROW_ON_ERROR);
if ($spec['spec_version'] !== TimeBilling::SPEC_VERSION) {
    fwrite(STDERR, "spec_version mismatch: vectors {$spec['spec_version']}, engine ".TimeBilling::SPEC_VERSION."\n");
    exit(1);
}

$failed = 0;
foreach ($spec['cases'] as $case) {
    $in = $case['input'];
    try {
        $r = TimeBilling::charge($in['rate'], $in['elapsed_seconds'], $in['paused_seconds']);
        $problems = isset($case['expected_error'])
            ? ["expected error {$case['expected_error']}, got amount {$r['amount_sen']}"]
            : array_values(array_filter(array_map(
                fn ($k, $v) => ($r[$k] ?? null) === $v ? null : "{$k}: expected ".json_encode($v).', got '.json_encode($r[$k] ?? null),
                array_keys($case['expected']), $case['expected'],
            )));
    } catch (PricingException $e) {
        $problems = ($case['expected_error'] ?? null) === $e->reason ? [] : ["unexpected error: {$e->getMessage()}"];
    }

    echo ($problems ? 'FAIL' : 'ok  ')." {$case['name']}\n";
    foreach ($problems as $p) {
        echo "     {$p}\n";
    }
    $failed += $problems ? 1 : 0;
}

$n = count($spec['cases']);
echo "\n".($n - $failed)."/{$n} vectors pass (time-billing spec v{$spec['spec_version']})\n";
exit($failed ? 1 : 0);

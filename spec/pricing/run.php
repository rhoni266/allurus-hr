<?php

/**
 * Runs spec/pricing/vectors.json against app/Billing/PricingEngine.php. No framework.
 *
 *   php spec/pricing/run.php            # exit 0 = all pass
 *
 * `expected` is a subset match: only the keys a vector lists are compared.
 * Every non-error case is also checked against the spec's invariants.
 */

require __DIR__.'/../../app/Billing/PricingException.php';
require __DIR__.'/../../app/Billing/PricingEngine.php';

use App\Billing\{PricingEngine, PricingException};

$spec = json_decode(file_get_contents(__DIR__.'/vectors.json'), true, flags: JSON_THROW_ON_ERROR);

if ($spec['spec_version'] !== PricingEngine::SPEC_VERSION) {
    fwrite(STDERR, "spec_version mismatch: vectors {$spec['spec_version']}, engine ".PricingEngine::SPEC_VERSION."\n");
    exit(1);
}

/** Paths where $actual differs from the keys present in $expected. */
function diff(mixed $expected, mixed $actual, string $path = ''): array
{
    if (! is_array($expected)) {
        return $expected === $actual ? [] : ["{$path}: expected ".json_encode($expected).', got '.json_encode($actual)];
    }
    if (! is_array($actual)) {
        return ["{$path}: expected array, got ".json_encode($actual)];
    }
    if (array_is_list($expected) && count($expected) !== count($actual)) {
        return ["{$path}: expected ".count($expected).' items, got '.count($actual)];
    }
    $out = [];
    foreach ($expected as $k => $v) {
        $out = [...$out, ...(array_key_exists($k, $actual) ? diff($v, $actual[$k], "{$path}.{$k}") : ["{$path}.{$k}: missing"])];
    }
    return $out;
}

function invariants(array $r): array
{
    $bad = [];
    if ($r['total_sen'] !== $r['subtotal_sen'] - $r['discount_sen'] + $r['service_charge_sen'] + $r['tax_sen'] + $r['rounding_sen']) {
        $bad[] = 'total != subtotal - discount + service_charge + tax + rounding';
    }
    if (array_sum(array_column($r['lines'], 'net_sen')) !== $r['subtotal_sen'] - $r['discount_sen']) {
        $bad[] = 'sum(net) != subtotal - discount';
    }
    if ($r['rounding_sen'] < -2 || $r['rounding_sen'] > 2) {
        $bad[] = 'rounding outside -2..2';
    }
    return $bad;
}

$failed = 0;
foreach ($spec['cases'] as $case) {
    try {
        $result = PricingEngine::price($case['input']);
        $problems = isset($case['expected_error'])
            ? ["expected error {$case['expected_error']}, got total {$result['total_sen']}"]
            : [...diff($case['expected'], $result), ...invariants($result)];
    } catch (PricingException $e) {
        $problems = ($case['expected_error'] ?? null) === $e->reason ? [] : ["unexpected error: {$e->getMessage()}"];
    }

    if ($problems) {
        $failed++;
        echo "FAIL {$case['name']}\n";
        foreach ($problems as $p) {
            echo "     {$p}\n";
        }
    } else {
        echo "ok   {$case['name']}\n";
    }
}

foreach ($spec['refund_cases'] ?? [] as $case) {
    try {
        $r = PricingEngine::refund($spec['refund_originals'][$case['original']], $case['already_refunded'], $case['refund']);
        $problems = isset($case['expected_error'])
            ? ["expected error {$case['expected_error']}, got refund {$r['refund_sen']}"]
            : diff($case['expected'], $r);
        if (! $problems && $r['refund_sen'] !== $r['net_sen'] + $r['service_charge_sen'] + array_sum(array_column($r['tax_breakdown'], 'amount_sen')) + $r['rounding_sen']) {
            $problems[] = 'refund != net + service + tax + rounding';
        }
    } catch (PricingException $e) {
        $problems = ($case['expected_error'] ?? null) === $e->reason ? [] : ["unexpected error: {$e->getMessage()}"];
    }

    echo ($problems ? 'FAIL' : 'ok  ')." refund: {$case['name']}\n";
    foreach ($problems as $p) {
        echo "     {$p}\n";
    }
    $failed += $problems ? 1 : 0;
}

$n = count($spec['cases']) + count($spec['refund_cases'] ?? []);
echo "\n".($n - $failed)."/{$n} vectors pass (spec v{$spec['spec_version']})\n";
exit($failed ? 1 : 0);

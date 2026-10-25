<?php

use App\Billing\{PricingEngine, PricingException};

function pricingVectors(): array
{
    $spec = json_decode(file_get_contents(__DIR__.'/../../spec/pricing/vectors.json'), true, flags: JSON_THROW_ON_ERROR);

    return collect($spec['cases'])->mapWithKeys(fn ($c) => [$c['name'] => [$c]])->all();
}

/** Assert every key present in $expected matches $actual (subset match, like run.php). */
function expectSubset(array $expected, array $actual, string $path = ''): void
{
    foreach ($expected as $k => $v) {
        expect($actual)->toHaveKey($k);
        if (! is_array($v)) {
            expect($actual[$k])->toBe($v, "{$path}.{$k}");
            continue;
        }
        if (array_is_list($v)) {
            expect($actual[$k])->toHaveCount(count($v));
        }
        expectSubset($v, $actual[$k], "{$path}.{$k}");
    }
}

it('matches the spec version of the vectors', function () {
    $spec = json_decode(file_get_contents(__DIR__.'/../../spec/pricing/vectors.json'), true);
    expect($spec['spec_version'])->toBe(PricingEngine::SPEC_VERSION);
});

it('passes golden vector', function (array $case) {
    if (isset($case['expected_error'])) {
        expect(fn () => PricingEngine::price($case['input']))
            ->toThrow(fn (PricingException $e) => expect($e->reason)->toBe($case['expected_error']));
        return;
    }

    expectSubset($case['expected'], PricingEngine::price($case['input']));
})->with(pricingVectors());

it('holds the spec invariants for 2,000 random baskets', function () {
    mt_srand(20261025);
    $codes = ['EXEMPT' => 0, 'SST_SALES' => 1000, 'SST_SERVICE' => 800, 'SST_SERVICE_FNB' => 600];
    $rules = array_map(fn ($bps) => ['rate_bps' => $bps, 'version' => 1], $codes);

    for ($n = 0; $n < 2000; $n++) {
        $lines = [];
        foreach (range(1, mt_rand(1, 6)) as $i) {
            $line = ['id' => "L{$i}", 'qty_milli' => mt_rand(1, 5000), 'unit_price_sen' => mt_rand(0, 20000),
                'tax_code' => array_rand($codes)];
            if (mt_rand(0, 3) === 0) {
                $line['discount'] = mt_rand(0, 1) ? ['percent_bps' => mt_rand(0, 10000)] : ['amount_sen' => mt_rand(0, 5000)];
            }
            $lines[] = $line;
        }
        $in = ['tender' => mt_rand(0, 1) ? 'cash' : 'card', 'tax_rules' => $rules, 'lines' => $lines];
        if (mt_rand(0, 2) === 0) {
            $in['order_discount'] = mt_rand(0, 1) ? ['percent_bps' => mt_rand(0, 10000)] : ['amount_sen' => mt_rand(0, 10000)];
        }
        if (mt_rand(0, 2) === 0) {
            $in['service_charge'] = ['rate_bps' => 1000, 'tax_code' => mt_rand(0, 1) ? 'SST_SERVICE' : null];
        }

        $r = PricingEngine::price($in);

        expect($r['total_sen'])->toBe($r['subtotal_sen'] - $r['discount_sen'] + $r['service_charge_sen'] + $r['tax_sen'] + $r['rounding_sen'])
            ->and(array_sum(array_column($r['lines'], 'net_sen')))->toBe($r['subtotal_sen'] - $r['discount_sen'])
            ->and(min(array_column($r['lines'], 'net_sen')))->toBeGreaterThanOrEqual(0)
            ->and($r['rounding_sen'])->toBeGreaterThanOrEqual(-2)->toBeLessThanOrEqual(2);
        if ($in['tender'] === 'cash') {
            expect($r['total_sen'] % 5)->toBe(0);
        } else {
            expect($r['rounding_sen'])->toBe(0);
        }
    }
});

it('passes time-billing golden vector', function (array $case) {
    $in = $case['input'];
    if (isset($case['expected_error'])) {
        expect(fn () => App\Billing\TimeBilling::charge($in['rate'], $in['elapsed_seconds'], $in['paused_seconds']))
            ->toThrow(fn (PricingException $e) => expect($e->reason)->toBe($case['expected_error']));
        return;
    }
    expect(App\Billing\TimeBilling::charge($in['rate'], $in['elapsed_seconds'], $in['paused_seconds']))->toMatchArray($case['expected']);
})->with(fn () => collect(json_decode(file_get_contents(__DIR__.'/../../spec/time-billing/vectors.json'), true)['cases'])
    ->mapWithKeys(fn ($c) => [$c['name'] => [$c]])->all());

it('passes refund golden vector', function (array $case, array $originals) {
    $run = fn () => PricingEngine::refund($originals[$case['original']], $case['already_refunded'], $case['refund']);
    if (isset($case['expected_error'])) {
        expect($run)->toThrow(fn (PricingException $e) => expect($e->reason)->toBe($case['expected_error']));
        return;
    }
    expectSubset($case['expected'], $run());
})->with(function () {
    $spec = json_decode(file_get_contents(__DIR__.'/../../spec/pricing/vectors.json'), true);

    return collect($spec['refund_cases'])->mapWithKeys(fn ($c) => [$c['name'] => [$c, $spec['refund_originals']]])->all();
});

it('refunds in random pieces always add up to exactly what was paid (1,000 sales)', function () {
    mt_srand(424242);
    $rules = ['EXEMPT' => ['rate_bps' => 0, 'version' => 1], 'SST_SALES' => ['rate_bps' => 1000, 'version' => 1], 'SST_SERVICE' => ['rate_bps' => 800, 'version' => 1]];

    for ($n = 0; $n < 1000; $n++) {
        $lines = [];
        foreach (range(1, mt_rand(1, 4)) as $i) {
            $lines[] = ['id' => "L{$i}", 'qty_milli' => mt_rand(1, 6) * 500, 'unit_price_sen' => mt_rand(0, 5000), 'tax_code' => array_rand($rules)]
                + (mt_rand(0, 3) === 0 ? ['discount' => ['percent_bps' => mt_rand(0, 3000)]] : []);
        }
        $in = ['tender' => mt_rand(0, 1) ? 'cash' : 'card', 'tax_rules' => $rules, 'lines' => $lines]
            + (mt_rand(0, 1) ? ['service_charge' => ['rate_bps' => 1000, 'tax_code' => mt_rand(0, 1) ? 'SST_SERVICE' : null]] : [])
            + (mt_rand(0, 2) === 0 ? ['order_discount' => ['amount_sen' => mt_rand(0, 2000)]] : []);
        $sale = PricingEngine::price($in);
        $original = ['tender' => $in['tender'], 'total_sen' => $sale['total_sen'], 'service_charge_sen' => $sale['service_charge_sen'],
            'service_charge_tax_code' => $in['service_charge']['tax_code'] ?? null, 'tax_breakdown' => $sale['tax_breakdown'],
            'lines' => array_map(fn ($l, $p) => ['id' => $l['id'], 'qty_milli' => $l['qty_milli'], 'net_sen' => $p['net_sen'], 'tax_code' => $l['tax_code']], $lines, $sale['lines'])];

        // refund every line back in random-sized pieces, in random order
        $already = [];
        $refunded = 0;
        while (true) {
            $left = array_filter(array_map(fn ($l) => $l['qty_milli'] - ($already[$l['id']] ?? 0), array_column($original['lines'], null, 'id')));
            if (! $left) {
                break;
            }
            $id = array_rand($left);
            $q = min($left[$id], mt_rand(1, 3) * 250);
            $r = PricingEngine::refund($original, $already, [$id => $q]);
            expect($r['refund_sen'])->toBeGreaterThanOrEqual(-2);   // cash rounding can step one piece back by a few sen
            $refunded += $r['refund_sen'];
            $already[$id] = ($already[$id] ?? 0) + $q;
        }

        expect($refunded)->toBe($sale['total_sen']);
    }
});

it('rejects floats anywhere money or quantity is expected', function () {
    expect(fn () => PricingEngine::price([
        'tender' => 'card', 'tax_rules' => ['EXEMPT' => ['rate_bps' => 0, 'version' => 1]],
        'lines' => [['id' => 'L1', 'qty_milli' => 1000, 'unit_price_sen' => 3.5, 'tax_code' => 'EXEMPT']],
    ]))->toThrow(PricingException::class);
});

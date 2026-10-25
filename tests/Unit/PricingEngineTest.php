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

it('rejects floats anywhere money or quantity is expected', function () {
    expect(fn () => PricingEngine::price([
        'tender' => 'card', 'tax_rules' => ['EXEMPT' => ['rate_bps' => 0, 'version' => 1]],
        'lines' => [['id' => 'L1', 'qty_milli' => 1000, 'unit_price_sen' => 3.5, 'tax_code' => 'EXEMPT']],
    ]))->toThrow(PricingException::class);
});

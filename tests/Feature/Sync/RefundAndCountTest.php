<?php

use App\Billing\PricingEngine;
use App\Models\{Order, OrderRefund, Payment, ProductVariant, StockCountLine, StockMovement};
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

const RULES = ['EXEMPT' => ['rate_bps' => 0, 'version' => 1], 'SST_SERVICE' => ['rate_bps' => 800, 'version' => 1]];

/**
 * An order.create priced by PricingEngine, as the terminal sends it.
 * $lines: [[variant, qty_milli, tax_code], ...]
 */
function pricedSale(object $w, int $seq, array $lines, ?string $occurredAt = null): array
{
    $in = ['tender' => 'cash', 'tax_rules' => RULES, 'lines' => [], 'service_charge' => ['rate_bps' => 1000, 'tax_code' => 'SST_SERVICE']];
    foreach ($lines as [$variant, $qty, $code]) {
        $in['lines'][] = ['id' => (string) Str::uuid7(), 'qty_milli' => $qty, 'unit_price_sen' => $variant->base_price_sen, 'tax_code' => $code];
    }
    $priced = PricingEngine::price($in);
    $at = $occurredAt ?? now()->subHour()->toIso8601String();

    $m = orderMutation($w, $seq, order: [
        'subtotal_sen' => $priced['subtotal_sen'], 'discount_sen' => $priced['discount_sen'], 'service_charge_sen' => $priced['service_charge_sen'],
        'tax_sen' => $priced['tax_sen'], 'rounding_sen' => $priced['rounding_sen'], 'total_sen' => $priced['total_sen'],
        'tax_breakdown' => $priced['tax_breakdown'], 'tender' => 'cash', 'service_charge_tax_code' => 'SST_SERVICE', 'occurred_at' => $at,
    ]);
    $m['payload']['items'] = array_map(fn ($l, $p, $src) => [
        'id' => $p['id'], 'variant_id' => $src[0]->id, 'name' => 'x', 'qty_milli' => $l['qty_milli'], 'unit_price_sen' => $l['unit_price_sen'],
        'price_row_version' => $src[0]->row_version, 'net_sen' => $p['net_sen'], 'tax_code' => $l['tax_code'],
    ], $in['lines'], $priced['lines'], $lines);
    $m['payload']['payments'][0]['amount_sen'] = $priced['total_sen'];
    $m['payload']['payments'][0]['occurred_at'] = $at;
    $m['client_created_at'] = $at;
    $m['original'] = [   // what the terminal keeps to price refunds later (not sent)
        'tender' => 'cash', 'total_sen' => $priced['total_sen'], 'service_charge_sen' => $priced['service_charge_sen'],
        'service_charge_tax_code' => 'SST_SERVICE', 'tax_breakdown' => $priced['tax_breakdown'],
        'lines' => array_map(fn ($l, $p) => ['id' => $p['id'], 'qty_milli' => $l['qty_milli'], 'net_sen' => $p['net_sen'], 'tax_code' => $l['tax_code']], $in['lines'], $priced['lines']),
    ];

    return $m;
}

/** order.refund for $refund (item id => qty_milli), amount from PricingEngine unless given. */
function refundOf(array $sale, array $refund, array $already, string $staffId, int $seq, ?int $amount = null, bool $restock = true): array
{
    $amount ??= PricingEngine::refund($sale['original'], $already, $refund)['refund_sen'];

    return ['id' => (string) Str::uuid7(), 'client_seq' => $seq, 'type' => 'order.refund', 'client_created_at' => now()->toIso8601String(),
        'payload' => [
            'refund_id' => (string) Str::uuid7(), 'order_id' => $sale['payload']['order']['id'], 'staff_id' => $staffId,
            'reason' => 'returned', 'occurred_at' => now()->toIso8601String(), 'refund_sen' => $amount,
            'lines' => array_map(fn ($id, $q) => ['item_id' => $id, 'qty_milli' => $q, 'restock' => $restock], array_keys($refund), $refund),
            'payments' => $amount > 0 ? [['id' => (string) Str::uuid7(), 'method' => 'cash', 'amount_sen' => $amount]] : [],
        ]];
}

function countOf(string $staffId, int $seq, array $counts, ?string $at = null): array
{
    return ['id' => (string) Str::uuid7(), 'client_seq' => $seq, 'type' => 'stock.count', 'client_created_at' => $at ?? now()->toIso8601String(),
        'payload' => ['count_id' => (string) Str::uuid7(), 'staff_id' => $staffId, 'counted_at' => $at ?? now()->toIso8601String(),
            'lines' => array_map(fn ($vid, $c) => ['variant_id' => $vid, 'counted_milli' => $c], array_keys($counts), $counts)]];
}

function strip(array $m): array
{
    unset($m['original']);

    return $m;
}

beforeEach(function () {
    $this->w = world();
    seedStock($this->w, 50_000);
    $this->manager = staffMember($this->w, 'manager', '111111');
    $this->cashier = staffMember($this->w, 'cashier', '2222');
    $this->w->cashier = $this->cashier;
    asTenant($this->w->tenant->id);
    $this->tea = ProductVariant::create(['product_id' => $this->w->product->id, 'sku' => 'TEH', 'base_price_sen' => 420])->refresh();
    DB::table('stock_levels')->insert(['tenant_id' => $this->w->tenant->id, 'outlet_id' => $this->w->outlet->id, 'variant_id' => $this->tea->id, 'on_hand_milli' => 50_000]);
    actAsTerminal($this->w->terminal);

    // 3 x Kopi (service tax) + 2 x Teh (exempt), 10% taxed service charge, cash
    $this->sale = pricedSale($this->w, 1, [[$this->w->variant, 3000, 'SST_SERVICE'], [$this->tea, 2000, 'EXEMPT']]);
    push(strip($this->sale))->assertJsonPath('results.0.status', 'applied');
    [$this->kopi, $this->teh] = array_column($this->sale['payload']['items'], 'id');
    $this->total = $this->sale['payload']['order']['total_sen'];
});

describe('order.refund', function () {
    it('refunds one unit of a line: money back, stock back, order partially refunded', function () {
        $m = refundOf($this->sale, [$this->kopi => 1000], [], $this->manager->id, 2);

        push($m)->assertJsonPath('results.0.status', 'applied')
            ->assertJsonPath('results.0.result.server_refund_sen', $m['payload']['refund_sen'])
            ->assertJsonPath('results.0.result.status', 'partially_refunded');

        asTenant($this->w->tenant->id);
        expect((int) Payment::where('order_id', $this->sale['payload']['order']['id'])->sum('amount_sen'))->toBe($this->total - $m['payload']['refund_sen'])
            ->and(onHandMilli($this->w))->toBe(50_000 - 3000 + 1000);
    });

    it('refunded in three pieces, gives back exactly what was paid', function () {
        $r1 = refundOf($this->sale, [$this->kopi => 1000], [], $this->manager->id, 2);
        $r2 = refundOf($this->sale, [$this->kopi => 2000], [$this->kopi => 1000], $this->manager->id, 3);
        $r3 = refundOf($this->sale, [$this->teh => 2000], [$this->kopi => 3000], $this->manager->id, 4);

        push($r1, $r2, $r3)->assertJsonPath('results.2.result.status', 'refunded');

        expect($r1['payload']['refund_sen'] + $r2['payload']['refund_sen'] + $r3['payload']['refund_sen'])->toBe($this->total);
        asTenant($this->w->tenant->id);
        expect((int) Payment::where('order_id', $this->sale['payload']['order']['id'])->sum('amount_sen'))->toBe(0)
            ->and(Order::find($this->sale['payload']['order']['id'])->status)->toBe('refunded')
            ->and(OrderRefund::whereColumn('refund_sen', '<>', 'server_refund_sen')->count())->toBe(0);
    });

    it('returns nothing to stock for a line that is not restocked', function () {
        push(refundOf($this->sale, [$this->kopi => 1000], [], $this->manager->id, 2, restock: false))->assertOk();

        asTenant($this->w->tenant->id);
        expect(onHandMilli($this->w))->toBe(50_000 - 3000);
    });

    it("keeps the terminal's amount when it differs, and flags it", function () {
        $m = refundOf($this->sale, [$this->kopi => 1000], [], $this->manager->id, 2, amount: 999);

        push($m)->assertJsonPath('results.0.result.conflicts', ['refund_amount_mismatch']);
        asTenant($this->w->tenant->id);
        expect(OrderRefund::first())->refund_sen->toBe(999)->server_refund_sen->not->toBe(999);
    });

    it('flags a line refunded twice (two terminals, offline) but records the cash given', function () {
        $a = refundOf($this->sale, [$this->teh => 2000], [], $this->manager->id, 2);
        $b = refundOf($this->sale, [$this->teh => 2000], [], $this->manager->id, 3);   // didn't know about $a

        $res = push($a, $b)->json('results');
        expect($res[1]['result']['conflicts'])->toContain('over_refund')->toContain('refund_amount_mismatch')
            ->and($res[1]['result']['server_refund_sen'])->toBe(0);
        asTenant($this->w->tenant->id);
        expect((int) Payment::where('status', 'refunded')->sum('amount_sen'))->toBe(-2 * $a['payload']['refund_sen']);
    });

    it('flags a refund by a cashier', function () {
        push(refundOf($this->sale, [$this->kopi => 1000], [], $this->cashier->id, 2))
            ->assertJsonPath('results.0.result.conflicts', ['unauthorized_refund']);
    });

    it('rejects refunding a voided order', function () {
        push(['id' => (string) Str::uuid7(), 'client_seq' => 2, 'type' => 'order.void', 'client_created_at' => now()->toIso8601String(),
            'payload' => ['void_id' => (string) Str::uuid7(), 'order_id' => $this->sale['payload']['order']['id'], 'staff_id' => $this->manager->id,
                'reason' => 'x', 'occurred_at' => now()->toIso8601String()]]);

        push(refundOf($this->sale, [$this->kopi => 1000], [], $this->manager->id, 3))
            ->assertJsonPath('results.0.status', 'rejected')->assertJsonPath('results.0.result.error', 'order_voided');
    });

    it('voids only what is left after a partial refund', function () {
        push(refundOf($this->sale, [$this->kopi => 1000], [], $this->manager->id, 2));
        push(['id' => (string) Str::uuid7(), 'client_seq' => 3, 'type' => 'order.void', 'client_created_at' => now()->toIso8601String(),
            'payload' => ['void_id' => (string) Str::uuid7(), 'order_id' => $this->sale['payload']['order']['id'], 'staff_id' => $this->manager->id,
                'reason' => 'x', 'occurred_at' => now()->toIso8601String()]])->assertOk();

        asTenant($this->w->tenant->id);
        expect((int) Payment::where('order_id', $this->sale['payload']['order']['id'])->sum('amount_sen'))->toBe(0)   // not negative
            ->and(onHandMilli($this->w))->toBe(50_000);                                                              // not 51,000
    });

    it('is idempotent on the refund id', function () {
        $m = refundOf($this->sale, [$this->kopi => 1000], [], $this->manager->id, 2);
        push($m);
        [$m['client_seq'], $m['id']] = [3, (string) Str::uuid7()];   // rebuilt outbox: new mutation, same refund/count
        push($m)->assertJsonPath('results.0.result.note', 'already_exists');

        asTenant($this->w->tenant->id);
        expect(OrderRefund::count())->toBe(1);
    });

    it('rejects refunding an order synced without line pricing', function () {
        $plain = orderMutation($this->w, 2);
        push($plain);
        $m = refundOf($this->sale, [$this->kopi => 1000], [], $this->manager->id, 3, amount: 100);
        $m['payload']['order_id'] = $plain['payload']['order']['id'];
        $m['payload']['lines'][0]['item_id'] = $plain['payload']['items'][0]['id'];

        push($m)->assertJsonPath('results.0.result.error', 'order_not_refundable');
    });

    it('waits for an order that has not synced', function () {
        $later = pricedSale($this->w, 9, [[$this->w->variant, 1000, 'SST_SERVICE']]);

        push(refundOf($later, [$later['payload']['items'][0]['id'] => 1000], [], $this->manager->id, 2))->assertJsonPath('results.0.status', 'retry');
    });
});

describe('stock.count', function () {
    it('sets on-hand to the count and records the variance', function () {
        $m = countOf($this->manager->id, 2, [$this->w->variant->id => 40_000]);   // books say 47,000: 7 units missing

        push($m)->assertJsonPath('results.0.status', 'applied')
            ->assertJsonPath('results.0.result.lines.0', ['variant_id' => $this->w->variant->id, 'expected_milli' => 47_000, 'delta_milli' => -7000]);
        asTenant($this->w->tenant->id);
        expect(onHandMilli($this->w))->toBe(40_000);
    });

    it("absorbs a sale made before the count that syncs after it", function () {
        push(countOf($this->manager->id, 2, [$this->w->variant->id => 40_000], now()->toIso8601String()));
        // an offline terminal rang this up 10 minutes BEFORE the count; the count already saw it
        $late = pricedSale($this->w, 3, [[$this->w->variant, 2000, 'SST_SERVICE']], now()->subMinutes(10)->toIso8601String());

        push(strip($late))->assertOk();

        asTenant($this->w->tenant->id);
        expect(onHandMilli($this->w))->toBe(40_000)
            ->and(StockMovement::where('ref_id', $late['payload']['order']['id'])->orderBy('reason')->pluck('qty_delta_milli', 'reason')->all())
            ->toBe(['count_absorbed' => 2000, 'sale' => -2000]);
    });

    it('applies a sale made after the count normally', function () {
        push(countOf($this->manager->id, 2, [$this->w->variant->id => 40_000], now()->subMinute()->toIso8601String()));
        push(strip(pricedSale($this->w, 3, [[$this->w->variant, 2000, 'SST_SERVICE']], now()->toIso8601String())));

        asTenant($this->w->tenant->id);
        expect(onHandMilli($this->w))->toBe(38_000);
    });

    it('counts against the books as they stood at count time, not now', function () {
        // a sale AFTER the count time that synced BEFORE the count was pushed
        $countAt = now()->subMinutes(5)->toIso8601String();
        push(strip(pricedSale($this->w, 2, [[$this->w->variant, 1000, 'SST_SERVICE']], now()->toIso8601String())));   // books now 46,000

        push(countOf($this->manager->id, 3, [$this->w->variant->id => 45_000], $countAt))
            ->assertJsonPath('results.0.result.lines.0.expected_milli', 47_000);   // the 1,000 sold later is not in it

        asTenant($this->w->tenant->id);
        expect(onHandMilli($this->w))->toBe(44_000);   // 45,000 counted, then the later sale
    });

    it('flags a count by a cashier', function () {
        push(countOf($this->cashier->id, 2, [$this->w->variant->id => 47_000]))->assertJsonPath('results.0.result.conflicts', ['unauthorized_stocktake']);
    });

    it('is idempotent and rejects unknown items', function () {
        $m = countOf($this->manager->id, 2, [$this->w->variant->id => 40_000]);
        push($m);
        [$m['client_seq'], $m['id']] = [3, (string) Str::uuid7()];   // rebuilt outbox: new mutation, same refund/count
        push($m)->assertJsonPath('results.0.result.note', 'already_exists');

        push(countOf($this->manager->id, 4, [(string) Str::uuid7() => 1]))->assertJsonPath('results.0.result.error', 'unknown_variant');
        asTenant($this->w->tenant->id);
        expect(StockCountLine::count())->toBe(1)->and(onHandMilli($this->w))->toBe(40_000);
    });
});

it('isolates refunds and stock counts between tenants, including raw SQL', function () {
    push(refundOf($this->sale, [$this->kopi => 1000], [], $this->manager->id, 2));
    push(countOf($this->manager->id, 3, [$this->w->variant->id => 40_000]));
    world();

    foreach (['order_refunds', 'order_refund_lines', 'stock_counts', 'stock_count_lines'] as $table) {
        expect(DB::table($table)->count())->toBe(0, $table);
    }
    asTenant($this->w->tenant->id);
    expect(DB::table('order_refunds')->count())->toBe(1)->and(DB::table('stock_counts')->count())->toBe(1);
});

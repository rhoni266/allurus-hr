<?php

use App\Billing\TimeBilling;
use App\Models\{OfflineSyncQueue, Order, OrderVoid, Payment, Product, ProductVariant, StockMovement, SyncConflict, TimeSession};
use App\Sync\DependencyMissing;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

function mutation(string $type, int $clientSeq, array $payload, ?string $createdAt = null): array
{
    return ['id' => (string) Str::uuid7(), 'client_seq' => $clientSeq, 'type' => $type,
        'client_created_at' => $createdAt ?? now()->toIso8601String(), 'payload' => $payload];
}

function voidOf(string $orderId, string $staffId, int $seq, ?string $voidId = null, ?string $at = null): array
{
    return mutation('order.void', $seq, ['void_id' => $voidId ?? (string) Str::uuid7(), 'order_id' => $orderId,
        'staff_id' => $staffId, 'reason' => 'customer changed mind', 'occurred_at' => $at ?? now()->toIso8601String()], $at);
}

function paymentFor(string $orderId, string $staffId, int $seq, int $amount, string $method = 'cash', ?string $id = null): array
{
    return mutation('payment.add', $seq, ['payment_id' => $id ?? (string) Str::uuid7(), 'order_id' => $orderId, 'method' => $method,
        'amount_sen' => $amount, 'staff_id' => $staffId, 'occurred_at' => now()->toIso8601String()]);
}

function adjustment(string $variantId, string $staffId, int $seq, int $delta, string $reason = 'waste', ?string $id = null): array
{
    return mutation('stock.adjust', $seq, ['adjustment_id' => $id ?? (string) Str::uuid7(), 'variant_id' => $variantId,
        'delta_milli' => $delta, 'reason' => $reason, 'staff_id' => $staffId, 'occurred_at' => now()->toIso8601String()]);
}

const SNOOKER_RATE = ['rate_sen' => 1500, 'unit_minutes' => 60, 'min_minutes' => 30, 'round_to' => 15, 'round' => 'up'];

function sessionEnd(object $w, string $staffId, int $seq, int $elapsed, int $paused = 0, ?int $amount = null, array $rate = SNOOKER_RATE, ?string $id = null): array
{
    $end = now()->startOfSecond();
    $charge = TimeBilling::charge($rate, $elapsed, $paused);

    return mutation('session.end', $seq, [
        'session_id' => $id ?? (string) Str::uuid7(), 'resource_id' => (string) Str::uuid7(), 'staff_id' => $staffId,
        'started_at' => $end->copy()->subSeconds($elapsed)->toIso8601String(), 'ended_at' => $end->toIso8601String(),
        'paused_seconds' => $paused, 'rate_snapshot' => $rate,
        'billed_minutes' => $charge['billed_minutes'], 'amount_sen' => $amount ?? $charge['amount_sen'],
        'spec_version' => TimeBilling::SPEC_VERSION,
    ]);
}

function conflictKinds(): array
{
    return SyncConflict::orderBy('created_at')->pluck('kind')->all();
}

beforeEach(function () {
    $this->w = world();
    seedStock($this->w, 10_000);
    $this->manager = staffMember($this->w, 'manager', '1111');
    $this->cashier = staffMember($this->w, 'cashier', '2222');
    $this->w->cashier = $this->cashier;
    actAsTerminal($this->w->terminal);

    // one paid sale of 2 units, RM7.00, to correct
    $this->sale = orderMutation($this->w, 1);
    push($this->sale)->assertJsonPath('results.0.status', 'applied');
    $this->orderId = $this->sale['payload']['order']['id'];
});

describe('order.void', function () {
    it('reverses the sale with new rows: void fact, stock back, payments net to zero', function () {
        push(voidOf($this->orderId, $this->manager->id, 2))->assertJsonPath('results.0.status', 'applied')
            ->assertJsonPath('results.0.result.reversed_sen', 700);

        asTenant($this->w->tenant->id);
        expect(Order::find($this->orderId)->status)->toBe('void')
            ->and(OrderVoid::where('order_id', $this->orderId)->count())->toBe(1)
            ->and(onHandMilli($this->w))->toBe(10_000)
            ->and(StockMovement::where('ref_id', $this->orderId)->orderBy('reason')->pluck('qty_delta_milli', 'reason')->all())
            ->toBe(['sale' => -2000, 'void' => 2000])
            ->and((int) Payment::where('order_id', $this->orderId)->sum('amount_sen'))->toBe(0)
            ->and(Order::find($this->orderId)->total_sen)->toBe(700);   // the sale itself is untouched
    });

    it('records a cashier void done offline but flags it', function () {
        push(voidOf($this->orderId, $this->cashier->id, 2))
            ->assertJsonPath('results.0.status', 'conflict')
            ->assertJsonPath('results.0.result.conflicts', ['unauthorized_void']);

        asTenant($this->w->tenant->id);
        expect(Order::find($this->orderId)->status)->toBe('void');
    });

    it('applies only the first of two voids for the same order', function () {
        push(voidOf($this->orderId, $this->manager->id, 2));
        push(voidOf($this->orderId, $this->manager->id, 3))
            ->assertJsonPath('results.0.status', 'conflict')
            ->assertJsonPath('results.0.result.conflicts', ['duplicate_void']);

        asTenant($this->w->tenant->id);
        expect(onHandMilli($this->w))->toBe(10_000)   // stock returned once, not twice
            ->and((int) Payment::where('order_id', $this->orderId)->sum('amount_sen'))->toBe(0);
    });

    it('treats the same void resent under a new client_seq as already done', function () {
        $voidId = (string) Str::uuid7();
        push(voidOf($this->orderId, $this->manager->id, 2, $voidId));

        push(voidOf($this->orderId, $this->manager->id, 3, $voidId))
            ->assertJsonPath('results.0.status', 'applied')->assertJsonPath('results.0.result.note', 'already_voided');
    });

    it('waits for an order another terminal has not synced yet, then applies', function () {
        $later = orderMutation($this->w, 99);
        $laterId = $later['payload']['order']['id'];

        push(voidOf($laterId, $this->manager->id, 2))
            ->assertJsonPath('results.0.status', 'retry')
            ->assertJsonPath('results.0.result.waiting_for', ['entity' => 'order', 'id' => $laterId]);
        asTenant($this->w->tenant->id);
        expect(OfflineSyncQueue::where('client_seq', 2)->exists())->toBeFalse();   // nothing stored

        actAsTerminal($this->w->terminal);
        push($later)->assertOk();
        push(voidOf($laterId, $this->manager->id, 2))->assertJsonPath('results.0.status', 'applied');
    });

    it('gives up waiting after the deadline and rejects for review', function () {
        $old = now()->subHours(DependencyMissing::WAIT_HOURS + 1)->toIso8601String();

        push(voidOf((string) Str::uuid7(), $this->manager->id, 2, at: $old))
            ->assertJsonPath('results.0.status', 'rejected')->assertJsonPath('results.0.result.error', 'dependency_missing');
    });

    it("can't touch another tenant's order", function () {
        $other = world();
        actAsTerminal($other->terminal);

        push(voidOf($this->orderId, staffMember($other, 'manager', '1111')->id, 1))->assertJsonPath('results.0.status', 'retry');

        asTenant($this->w->tenant->id);
        expect(Order::find($this->orderId)->status)->toBe('paid');
    });
});

describe('payment.add', function () {
    beforeEach(function () {
        $this->tab = orderMutation($this->w, 10, order: ['status' => 'open']);
        $this->tab['payload']['payments'] = [];
        push($this->tab)->assertOk();
        $this->tabId = $this->tab['payload']['order']['id'];
    });

    it('settles an open tab in two payments', function () {
        push(paymentFor($this->tabId, $this->cashier->id, 11, 300))->assertJsonPath('results.0.result.status', 'open');
        push(paymentFor($this->tabId, $this->cashier->id, 12, 400))
            ->assertJsonPath('results.0.status', 'applied')->assertJsonPath('results.0.result.status', 'paid');

        asTenant($this->w->tenant->id);
        expect(Order::find($this->tabId)->status)->toBe('paid')
            ->and((int) Payment::where('order_id', $this->tabId)->sum('amount_sen'))->toBe(700);
    });

    it('keeps an over-payment but flags it', function () {
        push(paymentFor($this->tabId, $this->cashier->id, 11, 800))
            ->assertJsonPath('results.0.status', 'conflict')->assertJsonPath('results.0.result.conflicts', ['overpaid']);
    });

    it('flags a non-cash payment made offline', function () {
        push(paymentFor($this->tabId, $this->cashier->id, 11, 700, 'duitnow_qr'))
            ->assertJsonPath('results.0.result.conflicts', ['offline_noncash_payment']);
    });

    it('flags a payment on a voided order', function () {
        push(voidOf($this->tabId, $this->manager->id, 11));
        push(paymentFor($this->tabId, $this->cashier->id, 12, 700))
            ->assertJsonPath('results.0.result.conflicts', ['payment_on_void_order']);
    });

    it('is idempotent on the payment id', function () {
        $id = (string) Str::uuid7();
        push(paymentFor($this->tabId, $this->cashier->id, 11, 300, id: $id));
        push(paymentFor($this->tabId, $this->cashier->id, 12, 300, id: $id))->assertJsonPath('results.0.result.note', 'already_exists');

        asTenant($this->w->tenant->id);
        expect((int) Payment::where('order_id', $this->tabId)->sum('amount_sen'))->toBe(300);
    });

    it('waits for an order that has not synced', function () {
        push(paymentFor((string) Str::uuid7(), $this->cashier->id, 11, 100))->assertJsonPath('results.0.status', 'retry');
    });

    it('rejects a string amount', function () {
        $m = paymentFor($this->tabId, $this->cashier->id, 11, 100);
        $m['payload']['amount_sen'] = '100';

        push($m)->assertJsonPath('results.0.status', 'rejected')->assertJsonPath('results.0.result.error', 'invalid_amount');
    });
});

describe('stock.adjust', function () {
    it('lets any staff log waste, as a delta with the adjustment id as movement id', function () {
        $id = (string) Str::uuid7();
        push(adjustment($this->w->variant->id, $this->cashier->id, 2, -500, 'waste', $id))->assertJsonPath('results.0.status', 'applied');

        asTenant($this->w->tenant->id);
        expect(onHandMilli($this->w))->toBe(10_000 - 2000 - 500)
            ->and(StockMovement::whereKey($id)->value('reason'))->toBe('waste');
    });

    it('flags a correction by a cashier but still applies it', function () {
        push(adjustment($this->w->variant->id, $this->cashier->id, 2, 3000, 'adjust'))
            ->assertJsonPath('results.0.status', 'conflict')->assertJsonPath('results.0.result.conflicts', ['unauthorized_adjustment']);

        asTenant($this->w->tenant->id);
        expect(onHandMilli($this->w))->toBe(10_000 - 2000 + 3000);
    });

    it('lets a manager transfer stock in and out', function () {
        push(adjustment($this->w->variant->id, $this->manager->id, 2, 4000, 'transfer_in'),
            adjustment($this->w->variant->id, $this->manager->id, 3, -1000, 'transfer_out'))->assertOk();

        asTenant($this->w->tenant->id);
        expect(onHandMilli($this->w))->toBe(10_000 - 2000 + 3000);
    });

    it('rejects waste that adds stock', function () {
        push(adjustment($this->w->variant->id, $this->manager->id, 2, 500, 'waste'))
            ->assertJsonPath('results.0.status', 'rejected')->assertJsonPath('results.0.result.error', 'invalid_qty');
    });

    it("rejects another tenant's variant", function () {
        $foreign = world()->variant->id;
        actAsTerminal($this->w->terminal);

        push(adjustment($foreign, $this->manager->id, 2, -100))
            ->assertJsonPath('results.0.status', 'rejected')->assertJsonPath('results.0.result.error', 'unknown_variant');
    });

    it('is idempotent on the adjustment id', function () {
        $id = (string) Str::uuid7();
        push(adjustment($this->w->variant->id, $this->manager->id, 2, -500, 'waste', $id));
        push(adjustment($this->w->variant->id, $this->manager->id, 3, -500, 'waste', $id))->assertJsonPath('results.0.result.note', 'already_exists');

        asTenant($this->w->tenant->id);
        expect(onHandMilli($this->w))->toBe(10_000 - 2000 - 500);
    });

    it('flags an adjustment that takes stock negative', function () {
        push(adjustment($this->w->variant->id, $this->manager->id, 2, -9000, 'adjust'))
            ->assertJsonPath('results.0.result.conflicts', ['negative_stock']);
    });
});

describe('session.end', function () {
    it('stores a session whose amount matches TimeBilling', function () {
        $m = sessionEnd($this->w, $this->cashier->id, 2, elapsed: 3661);   // 61:01 -> 75 min -> RM18.75

        push($m)->assertJsonPath('results.0.status', 'applied')->assertJsonPath('results.0.result.amount_sen', 1875);

        asTenant($this->w->tenant->id);
        expect(TimeSession::find($m['payload']['session_id']))
            ->amount_sen->toBe(1875)->server_amount_sen->toBe(1875)->billed_minutes->toBe(75);
    });

    it("keeps the terminal's amount when it differs, and flags it", function () {
        $m = sessionEnd($this->w, $this->cashier->id, 2, elapsed: 3661, amount: 1500);

        push($m)->assertJsonPath('results.0.status', 'conflict')
            ->assertJsonPath('results.0.result.conflicts', ['session_amount_mismatch']);

        asTenant($this->w->tenant->id);
        expect(TimeSession::find($m['payload']['session_id']))->amount_sen->toBe(1500)->server_amount_sen->toBe(1875);
    });

    it('bills from the rate frozen at start, not the current catalogue rate', function () {
        asTenant($this->w->tenant->id);
        Product::create(['name' => 'Snooker', 'type' => 'service_timed', 'track_stock' => false,
            'time_billing' => ['rate_sen' => 9900] + SNOOKER_RATE]);   // HQ raised the rate mid-session
        actAsTerminal($this->w->terminal);

        push(sessionEnd($this->w, $this->cashier->id, 2, elapsed: 2700))->assertJsonPath('results.0.status', 'applied');
    });

    it('rejects a session that ends before it starts', function () {
        $m = sessionEnd($this->w, $this->cashier->id, 2, elapsed: 600);
        [$m['payload']['started_at'], $m['payload']['ended_at']] = [$m['payload']['ended_at'], $m['payload']['started_at']];

        push($m)->assertJsonPath('results.0.status', 'rejected')->assertJsonPath('results.0.result.error', 'invalid_duration');
    });

    it('rejects a pause longer than the session', function () {
        $m = sessionEnd($this->w, $this->cashier->id, 2, elapsed: 600);
        $m['payload']['paused_seconds'] = 900;

        push($m)->assertJsonPath('results.0.status', 'rejected')->assertJsonPath('results.0.result.error', 'invalid_duration');
    });

    it('is idempotent on the session id', function () {
        $id = (string) Str::uuid7();
        push(sessionEnd($this->w, $this->cashier->id, 2, elapsed: 1200, id: $id));
        push(sessionEnd($this->w, $this->cashier->id, 3, elapsed: 1200, id: $id))->assertJsonPath('results.0.result.note', 'already_exists');

        asTenant($this->w->tenant->id);
        expect(TimeSession::count())->toBe(1);
    });
});

it('flags an order rung up by unknown staff, but keeps the sale', function () {
    push(orderMutation($this->w, 50, order: ['staff_id' => (string) Str::uuid7()]))
        ->assertJsonPath('results.0.status', 'conflict')->assertJsonPath('results.0.result.conflicts', ['unknown_staff']);
});

it('does not price-check timed products against the catalogue', function () {
    asTenant($this->w->tenant->id);
    $p = Product::create(['name' => 'Snooker', 'type' => 'service_timed', 'track_stock' => false, 'time_billing' => SNOOKER_RATE]);
    $v = ProductVariant::create(['product_id' => $p->id, 'sku' => 'SNK', 'base_price_sen' => 1500])->refresh();
    actAsTerminal($this->w->terminal);

    $m = orderMutation($this->w, 60, item: ['variant_id' => $v->id, 'unit_price_sen' => 1875, 'qty_milli' => 1000, 'price_row_version' => $v->row_version]);
    push($m)->assertJsonPath('results.0.status', 'applied');
});

it('isolates order_voids and time_sessions between tenants, including raw SQL', function () {
    push(voidOf($this->orderId, $this->manager->id, 2));
    push(sessionEnd($this->w, $this->cashier->id, 3, elapsed: 1200));
    $b = world();   // tenant B active

    foreach (['order_voids', 'time_sessions'] as $table) {
        expect(DB::table($table)->count())->toBe(0, $table);
    }
    expect(fn () => DB::transaction(fn () => DB::table('order_voids')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $this->w->tenant->id, 'order_id' => (string) Str::uuid7(),
        'terminal_id' => $b->terminal->id, 'staff_id' => $this->manager->id, 'reason' => 'x', 'occurred_at' => now(),
    ])))->toThrow(\Illuminate\Database\QueryException::class, 'row-level security');

    asTenant($this->w->tenant->id);
    expect(DB::table('order_voids')->count())->toBe(1)->and(DB::table('time_sessions')->count())->toBe(1);
});

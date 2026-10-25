<?php

use App\Models\{OfflineSyncQueue, Order, OrderItem, Payment, PriceOverride, StockMovement, SyncConflict};
use App\Sync\Handlers\OrderCreateHandler;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->w = world();
    seedStock($this->w, 10);
    actAsTerminal($this->w->terminal);
});

it('applies an offline sale end to end', function () {
    $m = orderMutation($this->w);

    push($m)->assertOk()->assertJsonPath('results.0.status', 'applied');

    asTenant($this->w->tenant->id);
    $orderId = $m['payload']['order']['id'];
    expect(Order::find($orderId))->total_sen->toBe(700)
        ->and(OrderItem::where('order_id', $orderId)->count())->toBe(1)
        ->and(Payment::where('order_id', $orderId)->count())->toBe(1)
        ->and((float) StockMovement::where('ref_id', $orderId)->value('qty_delta'))->toBe(-2.0)
        ->and(OfflineSyncQueue::find($m['id'])->status)->toBe('applied');
});

it('decrements existing stock', function () {
    push(orderMutation($this->w))->assertOk();

    asTenant($this->w->tenant->id);
    expect((float) DB::table('stock_levels')->where('variant_id', $this->w->variant->id)->value('on_hand'))->toBe(8.0);
});

it('creates the stock_levels row when none exists instead of silently skipping', function () {
    DB::table('stock_levels')->delete();

    push(orderMutation($this->w))->assertOk();

    asTenant($this->w->tenant->id);
    $onHand = DB::table('stock_levels')->where('variant_id', $this->w->variant->id)->value('on_hand');
    expect((float) $onHand)->toBe(-2.0);
});

it('flags negative stock without blocking the sale', function () {
    seedStock($this->w, 1);

    push(orderMutation($this->w))
        ->assertJsonPath('results.0.status', 'conflict')
        ->assertJsonPath('results.0.result.conflicts', ['negative_stock']);
});

it('is idempotent on replay of the same mutation', function () {
    $m = orderMutation($this->w);

    $first = push($m)->json('results.0');
    $second = push($m)->json('results.0');

    asTenant($this->w->tenant->id);
    expect($second)->toBe($first)
        ->and(Order::count())->toBe(1)
        ->and(StockMovement::count())->toBe(1);
});

it('does not duplicate an order resent under a new client_seq', function () {
    $m1 = orderMutation($this->w, 1);
    $m2 = orderMutation($this->w, 2, order: ['id' => $m1['payload']['order']['id']]);

    push($m1);
    push($m2)->assertJsonPath('results.0.result.note', 'already_exists');

    asTenant($this->w->tenant->id);
    expect(Order::count())->toBe(1);
});

it('accepts a stale-price sale as-is and flags price_mismatch', function () {
    $stale = $this->w->variant->row_version;
    $this->w->variant->update(['base_price_sen' => 400]);

    $m = orderMutation($this->w, item: ['unit_price_sen' => 350, 'price_row_version' => $stale]);
    push($m)->assertJsonPath('results.0.status', 'conflict')
        ->assertJsonPath('results.0.result.conflicts', ['price_mismatch']);

    asTenant($this->w->tenant->id);
    $item = OrderItem::first();
    expect($item->unit_price_sen)->toBe(350)          // what the customer paid stands
        ->and($item->catalog_price_sen)->toBe(400)
        ->and(SyncConflict::first()->detail)->toMatchArray(['charged_sen' => 350, 'catalog_sen' => 400]);
});

it('does not flag a version bump that did not change the price', function () {
    $stale = $this->w->variant->row_version;
    $this->w->variant->update(['sku' => 'RENAMED']);

    push(orderMutation($this->w, item: ['price_row_version' => $stale]))
        ->assertJsonPath('results.0.status', 'applied');
});

it('resolves outlet overrides before deciding on a mismatch', function () {
    PriceOverride::create([
        'variant_id' => $this->w->variant->id, 'scope' => 'outlet',
        'scope_key' => $this->w->outlet->id, 'price_sen' => 300,
    ]);

    push(orderMutation($this->w, item: ['unit_price_sen' => 300]))
        ->assertJsonPath('results.0.status', 'applied');
});

it('accepts a sale of a product deleted centrally while offline', function () {
    $this->w->variant->delete();

    push(orderMutation($this->w))
        ->assertJsonPath('results.0.status', 'conflict')
        ->assertJsonPath('results.0.result.conflicts', ['product_deleted']);
});

it('flags non-cash payments in an offline sale', function () {
    $m = orderMutation($this->w);
    $m['payload']['payments'][0]['method'] = 'duitnow_qr';

    push($m)->assertJsonPath('results.0.result.conflicts', ['offline_noncash_payment']);
});

it('rejects inconsistent totals, stores the rejection, and replays it', function () {
    $m = orderMutation($this->w, order: ['total_sen' => 1]);

    push($m)->assertJsonPath('results.0.status', 'rejected')
        ->assertJsonPath('results.0.result.error', 'total_mismatch');
    push($m)->assertJsonPath('results.0.status', 'rejected');

    asTenant($this->w->tenant->id);
    expect(Order::count())->toBe(0)
        ->and(OfflineSyncQueue::find($m['id'])->status)->toBe('rejected');
});

it('does not block later mutations behind a rejected one', function () {
    $bad = orderMutation($this->w, 1);
    $bad['type'] = 'order.teleport';
    $good = orderMutation($this->w, 2);

    $res = push($good, $bad)->json('results'); // sent out of order on purpose

    expect(array_column($res, 'client_seq'))->toBe([1, 2])
        ->and(array_column($res, 'status'))->toBe(['rejected', 'applied']);
});

it('rejects a client_seq reused for a different mutation', function () {
    push(orderMutation($this->w, 1));

    push(orderMutation($this->w, 1))
        ->assertJsonPath('results.0.status', 'rejected')
        ->assertJsonPath('results.0.result.error', 'client_seq_reused');
});

it('retries rather than permanently rejecting on an unexpected server bug', function () {
    app()->bind(OrderCreateHandler::class, fn () => new class implements \App\Sync\MutationHandler {
        public function handle($t, array $p, $q): \App\Sync\Outcome { throw new LogicException('oops'); }
    });

    push(orderMutation($this->w))
        ->assertJsonPath('results.0.status', 'retry')
        ->assertJsonPath('results.0.result.error', 'server_error');
});

it('stamps the order with the authenticated terminal, not the payload', function () {
    $m = orderMutation($this->w);
    $m['payload']['order']['outlet_id'] = (string) \Illuminate\Support\Str::uuid7();

    push($m)->assertOk();

    asTenant($this->w->tenant->id);
    expect(Order::first())
        ->outlet_id->toBe($this->w->outlet->id)
        ->terminal_id->toBe($this->w->terminal->id);
});

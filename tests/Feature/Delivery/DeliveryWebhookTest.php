<?php

use App\Models\{DeliveryConnection, DeliveryMenuMapping, DeliveryModifierMapping, DeliveryOrder, DeliveryWebhookEvent,
    Modifier, Order, OrderItem, Payment, ProductVariant, StockMovement, SyncChange, TaxRule};
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

const SECRET = 'whsec_test_0123456789';

/** A recorded fixture payload for $w's store, optionally edited. */
function deliveryPayload(object $w, string $name = 'order_created', ?callable $edit = null): array
{
    $p = json_decode(str_replace('{{STORE_ID}}', $w->storeId, file_get_contents(__DIR__."/../../Fixtures/delivery/fixture/{$name}.json")), true);

    return $edit ? $edit($p) : $p;
}

/** POST it as the platform would: raw JSON body, HMAC over exactly those bytes. */
function deliver(array|string $payload, ?string $secret = SECRET, string $provider = 'fixture'): \Illuminate\Testing\TestResponse
{
    $raw = is_string($payload) ? $payload : json_encode($payload);
    app('auth')->forgetGuards();
    test()->flushHeaders();

    return test()->call('POST', "/api/v1/webhooks/delivery/{$provider}", server: array_filter([
        'CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json',
        'HTTP_X_FIXTURE_SIGNATURE' => $secret === null ? null : hash_hmac('sha256', $raw, $secret),
    ]), content: $raw);
}

/** A tenant with a connected store, a mapped kopi (+ modifier) and a mapped teh. */
function deliveryWorld(): object
{
    $w = world();
    seedStock($w, 10_000);
    TaxRule::firstOrCreate(['code' => 'SST_SERVICE_FNB', 'version' => 1],
        ['rate_bps' => 600, 'effective_from' => '2018-09-01', 'description' => 'test', 'source' => 'test']);
    TaxRule::firstOrCreate(['code' => 'EXEMPT', 'version' => 1],
        ['rate_bps' => 0, 'effective_from' => '2018-09-01', 'description' => 'test', 'source' => 'test']);

    asTenant($w->tenant->id);
    $w->product->update(['tax_code' => 'SST_SERVICE_FNB']);
    $w->teh = ProductVariant::create(['product_id' => $w->product->id, 'sku' => 'TEH-'.Str::random(4), 'base_price_sen' => 420])->refresh();
    DB::table('stock_levels')->insert(['tenant_id' => $w->tenant->id, 'outlet_id' => $w->outlet->id, 'variant_id' => $w->teh->id, 'on_hand_milli' => 10_000]);
    $w->storeId = 'store-'.Str::random(8);
    $w->connection = DeliveryConnection::create([
        'outlet_id' => $w->outlet->id, 'provider' => 'fixture', 'external_store_id' => $w->storeId,
        'webhook_secret' => SECRET, 'credentials' => ['api_key' => 'k_live_secret'], 'status' => 'active',
    ]);
    $w->kopiMap = DeliveryMenuMapping::create(['outlet_id' => $w->outlet->id, 'connection_id' => $w->connection->id,
        'variant_id' => $w->variant->id, 'external_item_id' => 'ext-kopi', 'markup_bps' => 2000]);
    DeliveryMenuMapping::create(['outlet_id' => $w->outlet->id, 'connection_id' => $w->connection->id,
        'variant_id' => $w->teh->id, 'external_item_id' => 'ext-teh', 'price_sen' => 500]);
    $mod = Modifier::create(['modifier_group_id' => (string) Str::uuid7(), 'name' => 'Extra shot', 'price_delta_sen' => 150]);
    DeliveryModifierMapping::create(['connection_id' => $w->connection->id, 'modifier_id' => $mod->id, 'external_modifier_id' => 'ext-extra-shot']);

    return $w;
}

beforeEach(fn () => $this->w = deliveryWorld());

describe('webhook security', function () {
    it('rejects a bad signature with 401 and stores nothing', function () {
        deliver(deliveryPayload($this->w), 'wrong-secret')->assertUnauthorized()->assertExactJson(['ok' => false]);
        deliver(deliveryPayload($this->w), null)->assertUnauthorized();

        asTenant($this->w->tenant->id);
        expect(DeliveryWebhookEvent::count())->toBe(0)->and(DeliveryOrder::count())->toBe(0);
    });

    it('answers an unknown store exactly like a bad signature', function () {
        deliver(deliveryPayload($this->w, edit: fn ($p) => ['store_id' => 'nope'] + $p))->assertUnauthorized()->assertExactJson(['ok' => false]);
    });

    it('refuses a connection that is not active or paused', function () {
        asTenant($this->w->tenant->id);
        $this->w->connection->update(['status' => 'pending']);

        deliver(deliveryPayload($this->w))->assertUnauthorized();
    });

    it('rejects a malformed body with 400 and an unknown provider with 404', function () {
        deliver('{not json')->assertStatus(400);
        deliver(deliveryPayload($this->w), provider: 'grab')->assertNotFound();
    });

    it("can't create rows in the tenant that owns the store by signing with another tenant's secret", function () {
        $other = deliveryWorld();   // its own connection, its own secret
        asTenant($other->tenant->id);
        $other->connection->update(['webhook_secret' => 'whsec_other']);

        deliver(deliveryPayload($this->w), 'whsec_other')->assertUnauthorized();

        foreach ([$this->w, $other] as $t) {
            asTenant($t->tenant->id);
            expect(DeliveryOrder::count())->toBe(0);
        }
    });

    it('keeps credentials and the webhook secret encrypted at rest and out of JSON', function () {
        asTenant($this->w->tenant->id);
        $row = DB::table('delivery_connections')->where('id', $this->w->connection->id)->first();

        expect($row->webhook_secret)->not->toContain(SECRET)->and($row->credentials)->not->toContain('k_live_secret')
            ->and($this->w->connection->fresh()->toArray())->not->toHaveKeys(['webhook_secret', 'credentials'])
            ->and($this->w->connection->fresh()->webhook_secret)->toBe(SECRET);
    });
});

describe('ingestion', function () {
    it('turns a platform order into a normal Allurus order', function () {
        deliver(deliveryPayload($this->w))->assertOk()->assertExactJson(['ok' => true]);

        asTenant($this->w->tenant->id);
        $do = DeliveryOrder::sole();
        $order = Order::find($do->order_id);

        expect($do)->status->toBe('received')->short_code->toBe('AB12')->needs_attention->toBeFalse()
            ->items_total_sen->toBe(1600)->platform_total_sen->toBe(1800)
            ->and($do->customer)->toBe(['first_name' => 'Aina', 'phone_suffix' => '4321'])   // address never stored
            // our identity: 1600 - 100 merchant discount = 1500; 6% = 90; card -> no rounding
            ->and($order)->channel->toBe('fixture')->terminal_id->toBeNull()->staff_id->toBeNull()->status->toBe('paid')
            ->and([$order->subtotal_sen, $order->discount_sen, $order->tax_sen, $order->rounding_sen, $order->total_sen])->toBe([1600, 100, 90, 0, 1590])
            ->and($order->occurred_at->format('Y-m-d\TH:i:s.u'))->toBe('2026-10-26T04:30:00.123456')
            ->and(OrderItem::where('order_id', $order->id)->orderBy('name_snapshot')->get()->map->only(['name_snapshot', 'qty_milli', 'catalog_price_sen'])->all())
            ->toBe([['name_snapshot' => 'Kopi Ais', 'qty_milli' => 2000, 'catalog_price_sen' => 420], ['name_snapshot' => 'Teh Tarik', 'qty_milli' => 1000, 'catalog_price_sen' => 500]])
            ->and(Payment::where('order_id', $order->id)->sole())->method->toBe('platform_collected')->amount_sen->toBe(1590)
            ->and(onHandMilli($this->w))->toBe(8000)
            ->and(DB::table('order_ids')->where('id', $order->id)->exists())->toBeTrue();   // voids/refunds can find it
    });

    it('acknowledges a duplicate event without a second order', function () {
        deliver(deliveryPayload($this->w))->assertOk();
        deliver(deliveryPayload($this->w))->assertOk()->assertJson(['duplicate' => true]);

        asTenant($this->w->tenant->id);
        expect(Order::count())->toBe(1)->and(DeliveryWebhookEvent::count())->toBe(1);
    });

    it('creates the order once even if it arrives under two different event ids', function () {
        deliver(deliveryPayload($this->w))->assertOk();
        deliver(deliveryPayload($this->w, edit: fn ($p) => ['event_id' => 'evt_retry'] + $p))->assertOk()->assertExactJson(['ok' => true]);

        asTenant($this->w->tenant->id);
        expect(Order::count())->toBe(1)->and(DeliveryOrder::count())->toBe(1)->and(DeliveryWebhookEvent::count())->toBe(2);
    });

    it('never drops an order with an unmapped item or modifier: it is flagged and still has every line', function () {
        deliver(deliveryPayload($this->w, edit: function ($p) {
            $p['order']['items'][] = ['id' => 'ext-unknown', 'name' => 'Mystery Cake', 'qty' => 1, 'unit_price_sen' => 900,
                'modifiers' => [['id' => 'ext-no-map', 'name' => 'Candles', 'qty' => 1, 'price_sen' => 0]]];
            $p['order']['items_total_sen'] = 2500;
            return $p;
        }))->assertOk();

        asTenant($this->w->tenant->id);
        $do = DeliveryOrder::sole();
        expect($do->needs_attention)->toBeTrue()
            ->and(array_column($do->attention_reasons, 'kind'))->toBe(['unmapped_item', 'unmapped_modifier'])
            ->and(OrderItem::where('order_id', $do->order_id)->where('name_snapshot', 'Mystery Cake')->sole()->variant_id)->toBeNull()
            ->and(onHandMilli($this->w))->toBe(8000);   // the unmapped cake moves no stock
    });

    it('flags totals that disagree, keeping both figures', function () {
        deliver(deliveryPayload($this->w, edit: fn ($p) => array_replace_recursive($p, ['order' => ['items_total_sen' => 1700]])))->assertOk();

        asTenant($this->w->tenant->id);
        // toEqual: jsonb stores object keys in its own order
        expect(DeliveryOrder::sole()->attention_reasons)->toEqual([['kind' => 'totals_mismatch', 'platform_items_total_sen' => 1700, 'computed_sen' => 1600]]);
    });

    it('keeps an order whose tax rule is missing, untaxed and flagged', function () {
        asTenant($this->w->tenant->id);
        $this->w->product->update(['tax_code' => 'SST_NOT_A_RULE']);

        deliver(deliveryPayload($this->w))->assertOk();

        asTenant($this->w->tenant->id);
        expect(DeliveryOrder::sole()->attention_reasons[0]['kind'])->toBe('pricing_failed')
            ->and(Order::sole()->tax_sen)->toBe(0);
    });

    it('marks an unparseable order failed for replay, without retrying it', function () {
        deliver(deliveryPayload($this->w, edit: fn ($p) => array_replace_recursive($p, ['order' => ['total_sen' => 18.5]])))->assertOk();

        asTenant($this->w->tenant->id);
        expect(DeliveryWebhookEvent::sole())->status->toBe('failed')->error->toContain('total_sen')
            ->and(DeliveryOrder::count())->toBe(0);
    });

    it('feeds delivery orders to that outlet\'s terminals without the raw payload', function () {
        deliver(deliveryPayload($this->w))->assertOk();
        actAsTerminal($this->w->terminal);

        $rows = collect($this->getJson('/api/v1/sync/pull?cursor=0')->json('changes'))->where('entity', 'delivery_order');

        expect($rows)->toHaveCount(1)
            ->and($rows->first()['data'])->toHaveKey('short_code')->not->toHaveKey('raw_payload');
    });
});

describe('cancellation', function () {
    it('voids the internal order through the normal void path', function () {
        deliver(deliveryPayload($this->w))->assertOk();
        deliver(deliveryPayload($this->w, 'order_cancelled'))->assertOk();

        asTenant($this->w->tenant->id);
        $do = DeliveryOrder::sole();
        expect($do->status)->toBe('cancelled')
            ->and(Order::find($do->order_id)->status)->toBe('void')
            ->and((int) Payment::where('order_id', $do->order_id)->sum('amount_sen'))->toBe(0)
            ->and(onHandMilli($this->w))->toBe(10_000)
            ->and(DB::table('order_voids')->where('order_id', $do->order_id)->value('staff_id'))->toBeNull();
    });

    it('ignores a cancellation for an order never received', function () {
        deliver(deliveryPayload($this->w, 'order_cancelled'))->assertOk();

        asTenant($this->w->tenant->id);
        expect(DeliveryWebhookEvent::sole()->status)->toBe('ignored');
    });
});

it('isolates every delivery table between tenants, including raw SQL', function () {
    deliver(deliveryPayload($this->w))->assertOk();
    world();   // another tenant active

    foreach (['delivery_connections', 'delivery_menu_mappings', 'delivery_modifier_mappings', 'delivery_orders', 'delivery_webhook_events'] as $table) {
        expect(DB::table($table)->count())->toBe(0, $table);
    }
    expect(fn () => DB::transaction(fn () => DB::table('delivery_orders')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $this->w->tenant->id, 'outlet_id' => $this->w->outlet->id,
        'connection_id' => $this->w->connection->id, 'provider' => 'fixture', 'external_order_id' => 'x', 'status' => 'received',
        'fulfilment' => 'delivery', 'payment_mode' => 'platform_collected', 'items_total_sen' => 0, 'platform_total_sen' => 0,
        'placed_at' => now(), 'raw_payload' => '{}',
    ])))->toThrow(\Illuminate\Database\QueryException::class, 'row-level security');
});

it('routes webhooks only through the trigger-maintained route table', function () {
    asTenant($this->w->tenant->id);
    $this->w->connection->update(['external_store_id' => 'renamed-store']);

    expect(DB::table('delivery_store_routes')->where('connection_id', $this->w->connection->id)->value('external_store_id'))->toBe('renamed-store');
    deliver(deliveryPayload($this->w))->assertUnauthorized();   // the old store id no longer routes
});

it('does not offer the fixture provider in production', function () {
    app()->detectEnvironment(fn () => 'production');
    app()->forgetInstance(App\Delivery\ProviderRegistry::class);

    deliver(deliveryPayload($this->w))->assertNotFound();
});

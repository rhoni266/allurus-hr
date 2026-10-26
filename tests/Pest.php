<?php

use App\Billing\PricingEngine;
use App\Models\{DeliveryConnection, DeliveryMenuMapping, DeliveryModifierMapping, Modifier, Outlet, Product, ProductVariant, TaxRule, Tenant, Terminal};
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\{DatabaseTruncation, RefreshDatabase};
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

pest()->extend(Tests\TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');

// Tests that need real top-level transactions (e.g. rollback after a deadlock):
// RefreshDatabase's wrapping transaction would turn them into savepoints, and Laravel
// does not roll a savepoint back on a concurrency error.
pest()->extend(Tests\TestCase::class)
    ->use(DatabaseTruncation::class)
    ->in('Integration');

function seedStock(object $w, int $onHandMilli): void
{
    DB::table('stock_levels')->upsert(
        [['tenant_id' => $w->tenant->id, 'outlet_id' => $w->outlet->id, 'variant_id' => $w->variant->id, 'on_hand_milli' => $onHandMilli]],
        ['outlet_id', 'variant_id'],
        ['on_hand_milli'],
    );
}

function onHandMilli(object $w): ?int
{
    $v = DB::table('stock_levels')->where('variant_id', $w->variant->id)->value('on_hand_milli');

    return $v === null ? null : (int) $v;
}

/**
 * Enter a tenant for test setup/assertions: app-level scope + Postgres RLS setting.
 * Call again after each request, because ResolveTenant clears both on the way out.
 */
function asTenant(string $tenantId): void
{
    TenantContext::set($tenantId);
    DB::statement("SELECT set_config('app.tenant_id', ?, false)", [$tenantId]);
}

/** A tenant with one outlet, one paired terminal and one stocked product. */
function world(string $region = 'KL'): object
{
    $tenant = Tenant::create(['name' => 'T '.Str::random(4), 'slug' => Str::random(10), 'business_type' => 'fnb']);
    asTenant($tenant->id);

    $outlet = Outlet::create(['name' => 'Main', 'region_code' => $region]);
    $terminal = Terminal::create([
        'tenant_id' => $tenant->id, 'outlet_id' => $outlet->id,
        'name' => 'T1', 'device_fingerprint' => Str::random(16),
    ]);

    $product = Product::create(['name' => 'Kopi O']);
    // refresh: row_version is maintained by DB default/trigger, not by the model
    $variant = ProductVariant::create(['product_id' => $product->id, 'sku' => 'KOPI-'.Str::random(4), 'base_price_sen' => 350])->refresh();

    return (object) compact('tenant', 'outlet', 'terminal', 'product', 'variant');
}

function actAsTerminal(Terminal $terminal, array $abilities = ['pos:terminal']): void
{
    Sanctum::actingAs($terminal, $abilities);
}

/** A complete, internally consistent order.create mutation. */
function orderMutation(object $w, int $clientSeq = 1, array $item = [], array $order = []): array
{
    $qtyMilli = $item['qty_milli'] ?? 2000;
    $price = $item['unit_price_sen'] ?? 350;
    $subtotal = PricingEngine::divHalfUp($qtyMilli * $price, 1000);
    $orderId = $order['id'] ?? (string) Str::uuid7();
    $at = $order['occurred_at'] ?? now()->subHour()->toIso8601String();

    return [
        'id'                => (string) Str::uuid7(),
        'client_seq'        => $clientSeq,
        'type'              => 'order.create',
        'client_created_at' => $at,
        'payload'           => [
            'order' => array_merge([
                'id'           => $orderId,
                'receipt_no'   => 'OUT1-T1-'.str_pad((string) $clientSeq, 6, '0', STR_PAD_LEFT),
                'status'       => 'paid',
                'staff_id'     => ($w->cashier ??= staffMember($w, 'cashier', '2222'))->id,
                'subtotal_sen' => $subtotal,
                'discount_sen' => 0,
                'tax_sen'      => 0,
                'rounding_sen' => 0,
                'total_sen'    => $subtotal,
                'occurred_at'  => $at,
            ], $order),
            'items' => [array_merge([
                'id'                => (string) Str::uuid7(),
                'variant_id'        => $w->variant->id,
                'name'              => 'Kopi O',
                'qty_milli'         => $qtyMilli,
                'unit_price_sen'    => $price,
                'price_row_version' => $w->variant->row_version,
            ], $item)],
            'payments' => [[
                'id' => (string) Str::uuid7(), 'method' => 'cash',
                'amount_sen' => $subtotal, 'occurred_at' => $at,
            ]],
        ],
    ];
}

/** Make the next request with a real bearer token (forgets the guard's cached user first). */
function asDevice(string $token): \Tests\TestCase
{
    app('auth')->forgetGuards();

    return test()->withToken($token);
}

function staffMember(object $w, string $role = 'cashier', string $pin = '2222', string|false|null $outletId = false): App\Models\Staff
{
    asTenant($w->tenant->id);
    $s = (new App\Models\Staff([
        'name' => ucfirst($role).' '.Str::random(3), 'role' => $role,
        'outlet_id' => $outletId === false ? $w->outlet->id : $outletId,
    ]))->setPin($pin);
    $s->save();

    return $s;
}

/** Signs a staff member in on $w's terminal; returns the X-Staff-Session token. */
function signIn(object $w, App\Models\Staff $staff, string $pin = '2222'): string
{
    actAsTerminal($w->terminal);

    return test()->postJson('/api/v1/auth/login', ['staff_id' => $staff->id, 'pin' => $pin])->assertCreated()->json('session_token');
}

function push(array ...$mutations)
{
    return test()->postJson('/api/v1/sync/push', ['mutations' => $mutations]);
}

// ---- delivery platforms (tests/Feature/Delivery, tests/Feature/Kitchen)

const SECRET = 'whsec_test_0123456789';

/** A recorded fixture payload for $w's store, optionally edited. */
function deliveryPayload(object $w, string $name = 'order_created', ?callable $edit = null): array
{
    $p = json_decode(str_replace('{{STORE_ID}}', $w->storeId, file_get_contents(__DIR__."/Fixtures/delivery/fixture/{$name}.json")), true);

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


<?php

use App\Models\{Outlet, Product, ProductVariant, Tenant, Terminal};
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

function seedStock(object $w, float $onHand): void
{
    DB::table('stock_levels')->upsert(
        [['tenant_id' => $w->tenant->id, 'outlet_id' => $w->outlet->id, 'variant_id' => $w->variant->id, 'on_hand' => $onHand]],
        ['outlet_id', 'variant_id'],
        ['on_hand'],
    );
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
    $qty = $item['qty'] ?? 2;
    $price = $item['unit_price_sen'] ?? 350;
    $subtotal = (int) round($qty * $price);
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
                'staff_id'     => (string) Str::uuid7(),
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
                'qty'               => $qty,
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

function push(array ...$mutations)
{
    return test()->postJson('/api/v1/sync/push', ['mutations' => $mutations]);
}

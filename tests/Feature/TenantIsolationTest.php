<?php

use App\Models\{Order, ProductVariant};
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

it('hides another tenant\'s rows from Eloquent and from raw SQL (RLS)', function () {
    $a = world();
    actAsTerminal($a->terminal);
    push(orderMutation($a))->assertOk();

    $b = world();   // leaves tenant B active

    expect(Order::count())->toBe(0)
        ->and(ProductVariant::find($a->variant->id))->toBeNull()
        // raw queries bypass TenantScope; RLS is the second wall
        ->and(DB::table('orders')->count())->toBe(0)
        ->and(DB::table('product_variants')->where('id', $a->variant->id)->exists())->toBeFalse();

    asTenant($a->tenant->id);
    expect(DB::table('orders')->count())->toBe(1);
});

it('blocks writes into another tenant even via raw SQL (WITH CHECK)', function () {
    $a = world();
    $b = world();   // tenant B active

    expect(fn () => DB::transaction(fn () => DB::table('product_variants')->insert([
        'id' => (string) \Illuminate\Support\Str::uuid7(), 'tenant_id' => $a->tenant->id,
        'product_id' => $a->product->id, 'sku' => 'SNEAKY', 'base_price_sen' => 1,
    ])))->toThrow(\Illuminate\Database\QueryException::class, 'row-level security');
});

it('returns no rows at all when no tenant is set (fail closed)', function () {
    world();
    TenantContext::clear();
    DB::statement("SELECT set_config('app.tenant_id', '', false)");

    expect(ProductVariant::count())->toBe(0)
        ->and(DB::table('product_variants')->count())->toBe(0);
});

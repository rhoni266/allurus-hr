<?php

use App\Models\{ProductVariant, SyncChange};
use Illuminate\Support\Facades\DB;

// Regression: found by sim:run stale-price. Eloquent increment() skips saving/saved
// events, so a model-hook feed never told terminals about the new price.

it('records a change and bumps row_version on increment()', function () {
    $w = world();
    $before = SyncChange::count();

    $w->variant->increment('base_price_sen', 100);

    expect(SyncChange::count())->toBe($before + 1)
        ->and(SyncChange::latest('seq')->first())->entity->toBe('variant')->op->toBe('upsert')->row_version->toBe(2)
        ->and(ProductVariant::find($w->variant->id)->row_version)->toBe(2);
});

it('records changes made with the query builder and raw SQL', function () {
    $w = world();
    $before = SyncChange::count();

    DB::table('product_variants')->where('id', $w->variant->id)->update(['base_price_sen' => 999]);
    DB::update('UPDATE products SET name = ? WHERE id = ?', ['Renamed', $w->product->id]);

    expect(SyncChange::count())->toBe($before + 2)
        ->and(SyncChange::orderByDesc('seq')->limit(2)->pluck('entity')->all())->toBe(['product', 'variant']);
});

it('records soft deletes as tombstones', function () {
    $w = world();

    $w->variant->delete();

    expect(SyncChange::latest('seq')->first())->entity->toBe('variant')->op->toBe('delete');
});

it('routes outlet overrides to that outlet only', function () {
    $w = world();

    \App\Models\PriceOverride::create(['variant_id' => $w->variant->id, 'scope' => 'outlet', 'scope_key' => $w->outlet->id, 'price_sen' => 1]);
    \App\Models\PriceOverride::create(['variant_id' => $w->variant->id, 'scope' => 'region', 'scope_key' => 'KL', 'price_sen' => 2]);

    expect(SyncChange::where('entity', 'price_override')->orderBy('seq')->pluck('outlet_id')->all())->toBe([$w->outlet->id, null]);
});

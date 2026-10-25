<?php

use App\Models\{PriceOverride, Product};
use Illuminate\Support\Facades\DB;

it('returns changes in seq order with hydrated data', function () {
    $w = world();
    actAsTerminal($w->terminal);

    $res = $this->getJson('/api/v1/sync/pull?cursor=0')->assertOk();

    // product then variant, exactly as written
    expect($res->json('changes.*.entity'))->toBe(['product', 'variant'])
        ->and($res->json('changes.1.data.base_price_sen'))->toBe(350)
        ->and($res->json('has_more'))->toBeFalse();

    $seqs = $res->json('changes.*.seq');
    expect($seqs)->toBe(collect($seqs)->sort()->values()->all())
        ->and($res->json('next_cursor'))->toBe(end($seqs));
});

it('keeps seq order across interleaved entity types', function () {
    $w = world();
    // product, variant, product, variant ... grouping by entity would reorder these
    $p2 = Product::create(['name' => 'Teh Tarik']);
    $w->variant->update(['base_price_sen' => 380]);
    actAsTerminal($w->terminal);

    $changes = $this->getJson('/api/v1/sync/pull?cursor=0')->json('changes');

    expect(array_column($changes, 'entity'))->toBe(['product', 'variant', 'product', 'variant'])
        ->and($changes[2]['id'])->toBe($p2->id);
});

it('pages with has_more and next_cursor', function () {
    $w = world();
    Product::create(['name' => 'Extra']);
    actAsTerminal($w->terminal);

    $page1 = $this->getJson('/api/v1/sync/pull?cursor=0&limit=2')->assertOk();
    expect($page1->json('changes'))->toHaveCount(2)->and($page1->json('has_more'))->toBeTrue();

    $page2 = $this->getJson('/api/v1/sync/pull?limit=2&cursor='.$page1->json('next_cursor'))->assertOk();
    expect($page2->json('changes'))->toHaveCount(1)
        ->and($page2->json('changes.0.data.name'))->toBe('Extra')
        ->and($page2->json('has_more'))->toBeFalse();
});

it('sends a tombstone for a variant deleted after its upsert was recorded', function () {
    $w = world();
    $w->variant->delete();
    actAsTerminal($w->terminal);

    $variantChanges = collect($this->getJson('/api/v1/sync/pull?cursor=0')->json('changes'))
        ->where('entity', 'variant')->values();

    // the old upsert can't be hydrated any more, so it goes out as a delete too
    expect($variantChanges->pluck('op')->all())->toBe(['delete', 'delete'])
        ->and($variantChanges->pluck('data')->filter()->all())->toBe([]);
});

it('only sends outlet overrides to that outlet', function () {
    $w = world();
    PriceOverride::create(['variant_id' => $w->variant->id, 'scope' => 'outlet', 'scope_key' => (string) \Illuminate\Support\Str::uuid7(), 'price_sen' => 300]);
    PriceOverride::create(['variant_id' => $w->variant->id, 'scope' => 'outlet', 'scope_key' => $w->outlet->id, 'price_sen' => 320]);
    PriceOverride::create(['variant_id' => $w->variant->id, 'scope' => 'region', 'scope_key' => 'KL', 'price_sen' => 340]);
    actAsTerminal($w->terminal);

    $prices = collect($this->getJson('/api/v1/sync/pull?cursor=0')->json('changes'))
        ->where('entity', 'price_override')->pluck('data.price_sen')->all();

    expect($prices)->toBe([320, 340]);
});

it('demands a full resync when the cursor is behind the prune watermark', function () {
    $w = world();
    DB::table('sync_watermarks')->insert(['tenant_id' => $w->tenant->id, 'pruned_through_seq' => 1000]);
    actAsTerminal($w->terminal);

    $this->getJson('/api/v1/sync/pull?cursor=10')->assertOk()->assertJson(['full_resync_required' => true]);
});

it("never returns another tenant's changes", function () {
    $a = world();
    $b = world();
    actAsTerminal($b->terminal);

    $ids = collect($this->getJson('/api/v1/sync/pull?cursor=0')->json('changes'))->pluck('id');

    expect($ids)->toContain($b->variant->id)
        ->not->toContain($a->variant->id)
        ->not->toContain($a->product->id);
});

it('rejects tokens without the pos:terminal ability', function () {
    $w = world();
    actAsTerminal($w->terminal, ['hq:read']);

    $this->getJson('/api/v1/sync/pull')->assertForbidden();
});

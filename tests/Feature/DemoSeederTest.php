<?php

use App\Billing\PricingEngine;
use App\Models\{Product, ProductVariant, Staff, SyncChange, TaxRule, Tenant};
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Database\Seeders\DemoSeeder;
use Illuminate\Support\Facades\DB;

beforeEach(fn () => $this->seed(DemoSeeder::class));

$cafe = fn () => DemoSeeder::id('tenant:demo-cafe');
$snooker = fn () => DemoSeeder::id('tenant:demo-snooker');

it('creates both demo tenants with fixed ids', function () use ($cafe, $snooker) {
    expect(Tenant::pluck('slug', 'id')->all())->toBe([$cafe() => 'demo-cafe', $snooker() => 'demo-snooker'])
        // UUIDv5 is deterministic: same name -> same id on every machine
        ->and(DemoSeeder::id('tenant:demo-cafe'))->toBe($cafe())
        ->and(substr($cafe(), 14, 1))->toBe('5');
});

it('is safe to run twice', function () {
    $this->seed(DemoSeeder::class);

    expect(Tenant::count())->toBe(2)->and(TaxRule::count())->toBe(6);
});

it('gives each tenant staff with PINs 111111 / 2222 / 3333', function () use ($cafe, $snooker) {
    foreach ([$cafe(), $snooker()] as $tenant) {
        asTenant($tenant);
        $staff = Staff::orderBy('name')->get();
        expect($staff)->toHaveCount(3);
        foreach (['111111', '2222', '3333'] as $pin) {
            expect($staff->filter->checkPin($pin))->toHaveCount(1, "tenant {$tenant} pin {$pin}");
        }
    }
});

it('keeps the two demo tenants isolated', function () use ($cafe, $snooker) {
    asTenant($cafe());
    $cafeProducts = Product::pluck('name')->all();
    asTenant($snooker());
    $snookerProducts = Product::pluck('name')->all();

    expect($cafeProducts)->toContain('Kopi O')->not->toContain('Snooker Table (per hour)')
        ->and($snookerProducts)->toContain('Snooker Table (per hour)')->not->toContain('Kopi O')
        ->and(DB::table('products')->count())->toBe(count($snookerProducts));   // RLS: raw SQL sees only the active tenant
});

it('feeds the catalogue to terminals through the change feed', function () use ($cafe) {
    asTenant($cafe());

    expect(SyncChange::where('entity', 'variant')->count())->toBe(ProductVariant::count())
        ->and(SyncChange::where('entity', 'price_override')->count())->toBe(1)
        ->and(SyncChange::where('entity', 'modifier')->count())->toBe(3);
});

it('picks the tax rule version in force on a date', function () {
    expect(TaxRule::forPricing(CarbonImmutable::parse('2024-02-29'))['SST_SERVICE'])->toBe(['rate_bps' => 600, 'version' => 1])
        ->and(TaxRule::forPricing(CarbonImmutable::parse('2024-03-01'))['SST_SERVICE'])->toBe(['rate_bps' => 800, 'version' => 2]);
});

it('prices a demo café basket end to end from seeded data', function () use ($cafe) {
    asTenant($cafe());
    $variant = fn (string $key) => ProductVariant::findOrFail(DemoSeeder::id("variant:cafe:{$key}"));

    $r = PricingEngine::price([
        'tender' => 'cash',
        'tax_rules' => TaxRule::forPricing(CarbonImmutable::parse('2026-10-25')),
        'lines' => [
            ['id' => 'nasi', 'qty_milli' => 1000, 'unit_price_sen' => $variant('nasi-lemak')->base_price_sen, 'tax_code' => 'SST_SERVICE_FNB'],
            ['id' => 'kopi', 'qty_milli' => 2000, 'unit_price_sen' => $variant('kopi-o')->base_price_sen, 'tax_code' => 'SST_SERVICE_FNB',
                'modifiers' => [['price_delta_sen' => 150]]],
        ],
        'service_charge' => ['rate_bps' => Tenant::find($cafe())->settings['service_charge_bps'], 'tax_code' => 'SST_SERVICE_FNB'],
    ]);

    // 1290 + 2 x (350 + 150) = 2290; service charge 229; tax 6% of 2519 = 151.14 -> 151; 2670 cash -> 2670
    expect($r)->toMatchArray(['subtotal_sen' => 2290, 'service_charge_sen' => 229, 'tax_sen' => 151, 'total_sen' => 2670]);
});

it('refuses to run in production', function () {
    app()->detectEnvironment(fn () => 'production');

    expect(fn () => (new DemoSeeder)->run())->toThrow(RuntimeException::class, 'never run in production');
});

afterEach(fn () => TenantContext::clear());

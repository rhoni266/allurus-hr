<?php

namespace App\Simulator\Server;

use App\Devices\PairingService;
use App\Models\{Outlet, PriceOverride, Product, ProductVariant, Staff, TaxRule, Tenant};
use App\Simulator\World;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Server-side ("HQ") actions the simulator performs directly against the sim database. */
final class Hq
{
    public static function enter(string $tenantId): void
    {
        TenantContext::set($tenantId);
        DB::statement("SELECT set_config('app.tenant_id', ?, false)", [$tenantId]);
    }

    /** Within a transaction, so the feed trigger's advisory lock covers the commit (as in production). */
    public static function write(callable $fn): mixed
    {
        return DB::transaction(function () use ($fn) {
            TenantContext::applyToTransaction();
            return $fn();
        });
    }

    public static function provision(string $label, int $terminals = 1, int $variants = 12, int $stock = 100000): World
    {
        $tenant = Tenant::create(['name' => "Sim {$label}", 'slug' => 'sim-'.$label.'-'.Str::lower(Str::random(6)), 'business_type' => 'fnb']);
        self::enter($tenant->id);

        return self::write(function () use ($tenant, $label, $terminals, $variants, $stock) {
            $outlet = Outlet::create(['name' => 'Main', 'region_code' => 'KL']);

            // mixed tax codes so the per-code tax breakdown is exercised through sync
            $codes = array_keys(self::TAX_RULES);
            $variantIds = [];
            foreach (range(1, $variants) as $i) {
                $p = Product::create(['name' => "Product {$i}", 'tax_code' => $codes[$i % count($codes)]]);
                $v = ProductVariant::create(['product_id' => $p->id, 'sku' => "SKU-{$i}", 'base_price_sen' => 250 + 37 * $i]);
                $variantIds[] = $v->id;
            }
            // exercise both override scopes in the local price engine
            PriceOverride::create(['variant_id' => $variantIds[0], 'scope' => 'region', 'scope_key' => 'KL', 'price_sen' => 199]);
            PriceOverride::create(['variant_id' => $variantIds[1], 'scope' => 'outlet', 'scope_key' => $outlet->id, 'price_sen' => 155]);

            DB::table('stock_levels')->insert(array_map(fn ($vid) => [
                'tenant_id' => $tenant->id, 'outlet_id' => $outlet->id, 'variant_id' => $vid, 'on_hand_milli' => $stock * 1000,
            ], $variantIds));

            // Devices aren't created here: each gets a one-time code and pairs itself over
            // HTTP (Scenarios::pairAll), exactly as a real terminal does.
            $pairing = app(PairingService::class);
            $terms = [];
            foreach (range(1, $terminals) as $i) {
                $terms[] = ['name' => "T{$i}", 'code' => $pairing->issue($outlet)['code']];
            }

            $staff = [];
            foreach (['cashier' => self::CASHIER_PIN, 'manager' => self::MANAGER_PIN] as $role => $pin) {
                $s = (new Staff(['name' => 'Sim '.ucfirst($role), 'role' => $role, 'outlet_id' => $outlet->id]))->setPin($pin);
                $s->save();
                $staff[$role] = ['id' => $s->id, 'pin' => $pin];
            }

            // a timed resource (snooker table), charged through session.end; not stocked
            $table = Product::create(['name' => 'Snooker Table', 'type' => 'service_timed', 'tax_code' => 'SST_SERVICE',
                'track_stock' => false, 'time_billing' => self::SNOOKER_RATE]);
            $timed = ProductVariant::create(['product_id' => $table->id, 'sku' => 'SNOOKER-1', 'base_price_sen' => self::SNOOKER_RATE['rate_sen']]);

            return new World($tenant->id, $outlet->id, 'KL', $terms, $variantIds, $stock * 1000,
                taxRules: self::taxRules(),
                serviceCharge: ['rate_bps' => 1000, 'tax_code' => 'SST_SERVICE'],
                staff: $staff,
                timedVariantId: $timed->id);
        });
    }

    public const CASHIER_PIN = '2222';
    public const MANAGER_PIN = '111111';
    public const SNOOKER_RATE = ['rate_sen' => 1500, 'unit_minutes' => 60, 'min_minutes' => 30, 'round_to' => 15, 'round' => 'up'];

    /** Sim-only rates (test data, not legal rates). */
    private const TAX_RULES = ['EXEMPT' => 0, 'SST_SALES' => 1000, 'SST_SERVICE' => 800];

    /** Ensure the national rules exist in the sim DB and return them in PricingEngine shape. */
    private static function taxRules(): array
    {
        foreach (self::TAX_RULES as $code => $bps) {
            TaxRule::firstOrCreate(['code' => $code, 'version' => 1],
                ['rate_bps' => $bps, 'effective_from' => '2000-01-01', 'description' => "sim {$code}", 'source' => 'simulator']);
        }

        return TaxRule::forPricing(now());
    }
}

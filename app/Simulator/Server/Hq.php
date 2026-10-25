<?php

namespace App\Simulator\Server;

use App\Models\{Outlet, PriceOverride, Product, ProductVariant, Tenant, Terminal as TerminalModel};
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

            $variantIds = [];
            foreach (range(1, $variants) as $i) {
                $p = Product::create(['name' => "Product {$i}"]);
                $v = ProductVariant::create(['product_id' => $p->id, 'sku' => "SKU-{$i}", 'base_price_sen' => 250 + 37 * $i]);
                $variantIds[] = $v->id;
            }
            // exercise both override scopes in the local price engine
            PriceOverride::create(['variant_id' => $variantIds[0], 'scope' => 'region', 'scope_key' => 'KL', 'price_sen' => 199]);
            PriceOverride::create(['variant_id' => $variantIds[1], 'scope' => 'outlet', 'scope_key' => $outlet->id, 'price_sen' => 155]);

            DB::table('stock_levels')->insert(array_map(fn ($vid) => [
                'tenant_id' => $tenant->id, 'outlet_id' => $outlet->id, 'variant_id' => $vid, 'on_hand' => $stock,
            ], $variantIds));

            $terms = [];
            foreach (range(1, $terminals) as $i) {
                $t = TerminalModel::create([
                    'tenant_id' => $tenant->id, 'outlet_id' => $outlet->id,
                    'name' => "T{$i}", 'device_fingerprint' => "sim-{$label}-{$i}-".Str::random(8),
                ]);
                $terms[] = ['id' => $t->id, 'name' => "T{$i}", 'token' => $t->createToken('sim', ['pos:terminal'])->plainTextToken];
            }

            return new World($tenant->id, $outlet->id, 'KL', $terms, $variantIds, $stock);
        });
    }
}

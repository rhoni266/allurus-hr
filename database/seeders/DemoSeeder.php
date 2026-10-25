<?php

namespace Database\Seeders;

use App\Models\{Modifier, Outlet, PriceOverride, Product, ProductVariant, Staff, TaxRule, Tenant, Terminal};
use App\Tenancy\TenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Ramsey\Uuid\Uuid;

/**
 * Two demo tenants with fixed UUIDv5 IDs, so links, tests and terminal fixtures can
 * reference them across reseeds:
 *   - Kopi Kita Café (F&B, two outlets, regional pricing, modifiers)
 *   - Cue Masters Snooker (time-billed tables + drinks)
 *
 * Demo staff PINs per tenant: 1111 owner, 2222 cashier, 3333 kitchen/cashier.
 *
 *   php artisan migrate:fresh --seed --seeder=DemoSeeder
 *
 * Never run in production. Safe to re-run: tenants that already exist are skipped.
 */
class DemoSeeder extends Seeder
{
    /** Namespace for every demo UUIDv5. Changing it changes every demo ID. */
    public const NS = '6f1d6a2e-5c3b-4e8a-9b0d-a11e0d5e0000';

    public static function id(string $name): string
    {
        return Uuid::uuid5(self::NS, $name)->toString();
    }

    public function run(): void
    {
        if (app()->environment('production')) {
            throw new \RuntimeException('DemoSeeder must never run in production.');
        }

        $this->taxRules();
        $this->tenant('demo-cafe', $this->cafe(...));
        $this->tenant('demo-snooker', $this->snooker(...));
    }

    /**
     * Illustrative rules so demo baskets price end to end. NOT a statement of current law:
     * confirm every rate and its scope with the Royal Malaysian Customs Department (MySST)
     * before go-live, and record where in `source`.
     */
    private function taxRules(): void
    {
        $rules = [
            ['EXEMPT', 1, 0, '2018-09-01', null, 'Not subject to SST'],
            ['SST_SALES', 1, 1000, '2018-09-01', null, 'Sales tax, general rate'],
            ['SST_SALES_5', 1, 500, '2018-09-01', null, 'Sales tax, reduced rate'],
            ['SST_SERVICE', 1, 600, '2018-09-01', '2024-03-01', 'Service tax'],
            ['SST_SERVICE', 2, 800, '2024-03-01', null, 'Service tax (rate change 1 Mar 2024)'],
            ['SST_SERVICE_FNB', 1, 600, '2018-09-01', null, 'Service tax, food & beverage'],
        ];

        foreach ($rules as [$code, $version, $bps, $from, $to, $desc]) {
            TaxRule::query()->firstOrCreate(
                ['code' => $code, 'version' => $version],
                ['id' => self::id("tax:{$code}:{$version}"), 'rate_bps' => $bps, 'effective_from' => $from,
                 'effective_to' => $to, 'description' => $desc, 'source' => 'DEMO DATA - verify with RMCD'],
            );
        }
    }

    private function tenant(string $slug, callable $build): void
    {
        $id = self::id("tenant:{$slug}");
        if (Tenant::whereKey($id)->exists()) {
            $this->command?->warn("  {$slug} already seeded, skipping");
            return;
        }

        DB::transaction(function () use ($id, $build) {
            TenantContext::set($id);
            DB::statement("SELECT set_config('app.tenant_id', ?, true)", [$id]);
            try {
                $build($id);
            } finally {
                TenantContext::clear();
            }
        });
        $this->command?->info("  seeded {$slug}");
    }

    private function cafe(string $tenantId): void
    {
        Tenant::create(['id' => $tenantId, 'name' => 'Kopi Kita Café', 'slug' => 'demo-cafe', 'business_type' => 'fnb',
            'sst_registration_no' => 'DEMO-SST-0001', 'settings' => ['service_charge_bps' => 1000]]);

        $bangsar = $this->outlet('cafe:bangsar', 'Kopi Kita Bangsar', 'KL');
        $kuantan = $this->outlet('cafe:kuantan', 'Kopi Kita Kuantan', 'PHG');
        $this->terminal($tenantId, $bangsar, 'cafe:bangsar:t1', 'Bangsar Counter');
        $this->terminal($tenantId, $kuantan, 'cafe:kuantan:t1', 'Kuantan Counter');

        $kopi = $this->item('cafe:kopi-o', 'Kopi O', 350, 'SST_SERVICE_FNB', kds: 'bar', stock: false);
        $this->item('cafe:teh-tarik', 'Teh Tarik', 400, 'SST_SERVICE_FNB', kds: 'bar', stock: false);
        $this->item('cafe:nasi-lemak', 'Nasi Lemak Ayam', 1290, 'SST_SERVICE_FNB', kds: 'kitchen', stock: false);
        $this->item('cafe:kaya-toast', 'Roti Bakar Kaya', 550, 'SST_SERVICE_FNB', kds: 'kitchen', stock: false);
        $water = $this->item('cafe:water', 'Mineral Water 500ml', 200, 'SST_SERVICE_FNB', stock: true);

        // regional pricing: Kopi O is cheaper in Pahang
        PriceOverride::create(['id' => self::id('cafe:override:kopi-o:phg'), 'variant_id' => $kopi,
            'scope' => 'region', 'scope_key' => 'PHG', 'price_sen' => 320]);

        $group = self::id('cafe:modgroup:addons');
        DB::table('modifier_groups')->insert(['id' => $group, 'tenant_id' => $tenantId, 'name' => 'Add-ons',
            'min_select' => 0, 'max_select' => 3, 'created_at' => now(), 'updated_at' => now()]);
        foreach ([['extra-shot', 'Extra shot', 150], ['oat-milk', 'Oat milk', 100], ['less-sugar', 'Less sugar', 0]] as [$key, $name, $delta]) {
            Modifier::create(['id' => self::id("cafe:mod:{$key}"), 'modifier_group_id' => $group, 'name' => $name, 'price_delta_sen' => $delta]);
        }

        $this->stock($tenantId, [$bangsar, $kuantan], [$water => 240]);
        $this->staff([['owner', 'Aisyah (Owner)', '1111', null], ['cashier', 'Ravi (Cashier)', '2222', $bangsar], ['kitchen', 'Mei Ling (Kitchen)', '3333', $bangsar]], 'cafe');
    }

    private function snooker(string $tenantId): void
    {
        Tenant::create(['id' => $tenantId, 'name' => 'Cue Masters Snooker', 'slug' => 'demo-snooker', 'business_type' => 'service',
            'sst_registration_no' => 'DEMO-SST-0002']);

        $outlet = $this->outlet('snooker:kuantan', 'Cue Masters Kuantan', 'PHG');
        $this->terminal($tenantId, $outlet, 'snooker:kuantan:t1', 'Front Desk');

        // time-billed: rate per hour, 30 min minimum, rounded up to 15 min (see TimeBilling)
        $this->item('snooker:table', 'Snooker Table (per hour)', 1500, 'SST_SERVICE', type: 'service_timed', stock: false,
            timeBilling: ['rate_sen' => 1500, 'unit_minutes' => 60, 'min_minutes' => 30, 'round_to' => 15, 'round' => 'up']);
        $this->item('snooker:pool', 'Pool Table (per hour)', 1000, 'SST_SERVICE', type: 'service_timed', stock: false,
            timeBilling: ['rate_sen' => 1000, 'unit_minutes' => 60, 'min_minutes' => 30, 'round_to' => 15, 'round' => 'up']);
        $drink = $this->item('snooker:100plus', '100PLUS 500ml', 300, 'SST_SALES_5', stock: true);
        $chips = $this->item('snooker:chips', 'Potato Chips', 250, 'SST_SALES', stock: true);

        $this->stock($tenantId, [$outlet], [$drink => 96, $chips => 40]);
        $this->staff([['owner', 'Farid (Owner)', '1111', null], ['cashier', 'Siti (Cashier)', '2222', $outlet], ['cashier', 'Kumar (Cashier)', '3333', $outlet]], 'snooker');
    }

    // ---------------------------------------------------------------- helpers

    private function outlet(string $key, string $name, string $region): string
    {
        return Outlet::create(['id' => self::id("outlet:{$key}"), 'name' => $name, 'region_code' => $region])->id;
    }

    private function terminal(string $tenantId, string $outletId, string $key, string $name): void
    {
        // Paired later via the device-pairing flow; no token is issued here.
        Terminal::create(['id' => self::id("terminal:{$key}"), 'tenant_id' => $tenantId, 'outlet_id' => $outletId,
            'name' => $name, 'device_fingerprint' => "demo:{$key}"]);
    }

    /** One product with a single default variant. Returns the variant id. */
    private function item(string $key, string $name, int $priceSen, string $taxCode, string $type = 'standard',
        ?string $kds = null, bool $stock = true, ?array $timeBilling = null): string
    {
        $product = Product::create(['id' => self::id("product:{$key}"), 'name' => $name, 'type' => $type, 'tax_code' => $taxCode,
            'track_stock' => $stock, 'kds_station' => $kds, 'time_billing' => $timeBilling]);

        return ProductVariant::create(['id' => self::id("variant:{$key}"), 'product_id' => $product->id,
            'sku' => strtoupper(str_replace([':', '-'], '_', $key)), 'base_price_sen' => $priceSen])->id;
    }

    /** @param array<string,int> $onHand variant id => whole units */
    private function stock(string $tenantId, array $outletIds, array $onHand): void
    {
        foreach ($outletIds as $outletId) {
            foreach ($onHand as $variantId => $units) {
                DB::table('stock_levels')->insert(['tenant_id' => $tenantId, 'outlet_id' => $outletId, 'variant_id' => $variantId,
                    'on_hand_milli' => $units * 1000, 'low_stock_threshold_milli' => intdiv($units, 4) * 1000]);
            }
        }
    }

    private function staff(array $people, string $prefix): void
    {
        foreach ($people as [$role, $name, $pin, $outletId]) {
            (new Staff(['id' => self::id("staff:{$prefix}:{$pin}"), 'outlet_id' => $outletId, 'name' => $name, 'role' => $role]))
                ->setPin($pin)->save();
        }
    }
}

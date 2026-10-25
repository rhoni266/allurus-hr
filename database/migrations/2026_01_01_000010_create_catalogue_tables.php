<?php

use App\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const TABLES = ['products', 'product_variants', 'price_overrides', 'modifier_groups', 'modifiers', 'combo_items'];

    public function up(): void
    {
        Schema::create('products', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('category_id')->nullable()->index();
            $t->string('name');
            $t->string('type')->default('standard');      // standard | combo | service_timed | modifier_only
            $t->string('tax_code')->default('SST_SALES');
            $t->boolean('has_variants')->default(false);
            $t->boolean('track_stock')->default(true);
            $t->string('kds_station')->nullable();
            $t->jsonb('time_billing')->nullable();
            $t->unsignedBigInteger('row_version')->default(1);
            $t->timestampsTz();
            $t->softDeletesTz();
        });

        Schema::create('product_variants', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('product_id')->index();
            $t->string('sku');
            $t->string('barcode')->nullable()->index();
            $t->jsonb('options')->default('{}');
            $t->bigInteger('base_price_sen');
            $t->bigInteger('cost_sen')->default(0);
            $t->unsignedBigInteger('row_version')->default(1);
            $t->timestampsTz();
            $t->softDeletesTz();                           // sold-offline-then-archived must still resolve
            $t->unique(['tenant_id', 'sku']);
        });

        Schema::create('price_overrides', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('variant_id')->index();
            $t->string('scope');                            // region | outlet
            $t->string('scope_key');
            $t->bigInteger('price_sen');
            $t->timestampTz('valid_from')->nullable();
            $t->timestampTz('valid_to')->nullable();
            $t->unsignedBigInteger('row_version')->default(1);
            $t->timestampsTz();
        });

        Schema::create('modifier_groups', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->string('name');
            $t->unsignedSmallInteger('min_select')->default(0);
            $t->unsignedSmallInteger('max_select')->default(1);
            $t->timestampsTz();
        });

        Schema::create('modifiers', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('modifier_group_id')->index();
            $t->string('name');
            $t->bigInteger('price_delta_sen')->default(0);
            $t->uuid('consumes_variant_id')->nullable();
            $t->bigInteger('consumes_qty_milli')->nullable();   // qty x 1000
            $t->unsignedBigInteger('row_version')->default(1);
            $t->timestampsTz();
        });

        Schema::create('combo_items', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('combo_product_id')->index();
            $t->uuid('component_variant_id');
            $t->bigInteger('qty_milli')->default(1000);          // qty x 1000
            $t->uuid('slot_group_id')->nullable();
        });

        foreach (self::TABLES as $table) {
            Rls::enable($table);
        }
    }

    public function down(): void
    {
        foreach (array_reverse(self::TABLES) as $table) {
            Schema::dropIfExists($table);
        }
    }
};

<?php

use App\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const TABLES = ['order_refunds', 'order_refund_lines', 'stock_counts', 'stock_count_lines'];

    public function up(): void
    {
        // What PricingEngine::refund needs to refund a line exactly: each line's net after
        // discounts and its tax code, plus how the sale was tendered and how its service
        // charge was taxed. Stored from the terminal's priced output at order.create.
        DB::statement('ALTER TABLE order_items ADD COLUMN net_sen bigint, ADD COLUMN tax_code varchar(32)');
        DB::statement("ALTER TABLE orders ADD COLUMN tender varchar(16) NOT NULL DEFAULT 'cash', ADD COLUMN service_charge_tax_code varchar(32)");
        DB::statement('ALTER TABLE orders ALTER COLUMN status TYPE varchar(24)');   // 'partially_refunded' is 18

        // A refund is a new fact (rule 4): lines given back, money given back, stock
        // returned for lines that go back on the shelf. orders.status is a projection.
        Schema::create('order_refunds', function (Blueprint $t) {
            $t->uuid('id')->primary();                  // generated on the terminal
            $t->uuid('tenant_id')->index();
            $t->uuid('order_id')->index();
            $t->uuid('terminal_id');
            $t->uuid('staff_id');
            $t->string('reason', 255);
            $t->bigInteger('refund_sen');                // what the terminal paid out; never rewritten
            $t->bigInteger('server_refund_sen');         // PricingEngine::refund recomputed here, for audit
            $t->unsignedSmallInteger('spec_version');
            $t->timestampTz('occurred_at', 6);
            $t->timestampTz('created_at', 6)->useCurrent();
        });
        Schema::create('order_refund_lines', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('refund_id')->index();
            $t->uuid('order_id')->index();
            $t->uuid('item_id')->index();
            $t->uuid('variant_id');
            $t->bigInteger('qty_milli');
            $t->boolean('restock');                      // false: damaged / consumed, nothing back on the shelf
        });

        // A stocktake is an anchor: "at counted_at there were exactly counted_milli". The
        // stocktake movement is counted - expected, where expected is the stock as it stood
        // at counted_at. Movements dated before the count that sync later are already in
        // the physical count, so StockLedger cancels them ('count_absorbed').
        Schema::create('stock_counts', function (Blueprint $t) {
            $t->uuid('id')->primary();                   // generated on the terminal
            $t->uuid('tenant_id')->index();
            $t->uuid('outlet_id');
            $t->uuid('terminal_id');
            $t->uuid('staff_id');
            $t->timestampTz('counted_at', 6);
            $t->timestampTz('created_at', 6)->useCurrent();
        });
        Schema::create('stock_count_lines', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('count_id')->index();
            $t->uuid('outlet_id');
            $t->uuid('variant_id');
            $t->bigInteger('counted_milli');
            $t->bigInteger('expected_milli');            // the books at counted_at, when the count was applied
            $t->bigInteger('delta_milli');               // counted - expected: shrinkage, found stock
            $t->timestampTz('counted_at', 6);
            $t->index(['outlet_id', 'variant_id', 'counted_at']);
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
        DB::statement('ALTER TABLE orders DROP COLUMN tender, DROP COLUMN service_charge_tax_code');
        DB::statement('ALTER TABLE order_items DROP COLUMN net_sen, DROP COLUMN tax_code');
    }
};

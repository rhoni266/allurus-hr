<?php

use App\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * High-volume tables are range-partitioned on occurred_at. Only a DEFAULT partition is
 * created here; monthly partitions are managed by pg_partman (or a scheduled job) in
 * production. Schema builder can't express PARTITION BY, hence raw SQL.
 */
return new class extends Migration
{
    private const PARTITIONED = ['orders', 'order_items', 'payments', 'stock_movements'];

    public function up(): void
    {
        Schema::create('stock_levels', function (Blueprint $t) {
            $t->uuid('tenant_id')->index();
            $t->uuid('outlet_id');
            $t->uuid('variant_id');
            $t->decimal('on_hand', 14, 3)->default(0);    // projection of stock_movements
            $t->decimal('low_stock_threshold', 14, 3)->nullable();
            $t->primary(['outlet_id', 'variant_id']);
        });

        DB::statement(<<<'SQL'
            CREATE TABLE stock_movements (
                id          uuid           NOT NULL,
                tenant_id   uuid           NOT NULL,
                outlet_id   uuid           NOT NULL,
                variant_id  uuid           NOT NULL,
                reason      varchar(32)    NOT NULL,
                qty_delta   numeric(14,3)  NOT NULL,
                ref_id      uuid,
                occurred_at timestamptz    NOT NULL,
                created_at  timestamptz    NOT NULL DEFAULT now(),
                PRIMARY KEY (id, occurred_at)
            ) PARTITION BY RANGE (occurred_at)
        SQL);
        DB::statement('CREATE INDEX stock_movements_lookup ON stock_movements (tenant_id, outlet_id, variant_id, occurred_at)');

        DB::statement(<<<'SQL'
            CREATE TABLE orders (
                id                 uuid         NOT NULL,
                tenant_id          uuid         NOT NULL,
                outlet_id          uuid         NOT NULL,
                terminal_id        uuid         NOT NULL,
                receipt_no         varchar(64)  NOT NULL,
                channel            varchar(16)  NOT NULL DEFAULT 'pos',
                status             varchar(16)  NOT NULL,
                table_id           uuid,
                customer_id        uuid,
                staff_id           uuid         NOT NULL,
                subtotal_sen       bigint       NOT NULL,
                discount_sen       bigint       NOT NULL DEFAULT 0,
                service_charge_sen bigint       NOT NULL DEFAULT 0,
                tax_sen            bigint       NOT NULL DEFAULT 0,
                rounding_sen       smallint     NOT NULL DEFAULT 0,
                total_sen          bigint       NOT NULL,
                tax_breakdown      jsonb        NOT NULL DEFAULT '[]',
                created_offline    boolean      NOT NULL DEFAULT false,
                occurred_at        timestamptz  NOT NULL,
                synced_at          timestamptz,
                created_at         timestamptz  NOT NULL DEFAULT now(),
                PRIMARY KEY (id, occurred_at),
                UNIQUE (tenant_id, receipt_no, occurred_at)
            ) PARTITION BY RANGE (occurred_at)
        SQL);
        DB::statement('CREATE INDEX orders_outlet_time ON orders (tenant_id, outlet_id, occurred_at)');

        DB::statement(<<<'SQL'
            CREATE TABLE order_items (
                id                uuid          NOT NULL,
                tenant_id         uuid          NOT NULL,
                order_id          uuid          NOT NULL,
                variant_id        uuid          NOT NULL,
                name_snapshot     varchar(255)  NOT NULL,
                qty               numeric(10,3) NOT NULL,
                unit_price_sen    bigint        NOT NULL,
                catalog_price_sen bigint        NOT NULL,
                price_row_version bigint        NOT NULL,
                modifiers         jsonb         NOT NULL DEFAULT '[]',
                kds_status        varchar(16),
                occurred_at       timestamptz   NOT NULL,
                PRIMARY KEY (id, occurred_at)
            ) PARTITION BY RANGE (occurred_at)
        SQL);
        DB::statement('CREATE INDEX order_items_order ON order_items (order_id)');

        DB::statement(<<<'SQL'
            CREATE TABLE payments (
                id              uuid         NOT NULL,
                tenant_id       uuid         NOT NULL,
                order_id        uuid         NOT NULL,
                method          varchar(32)  NOT NULL,
                gateway         varchar(32),
                gateway_ref     varchar(128),
                amount_sen      bigint       NOT NULL,
                status          varchar(16)  NOT NULL,
                gateway_payload jsonb,
                occurred_at     timestamptz  NOT NULL,
                PRIMARY KEY (id, occurred_at)
            ) PARTITION BY RANGE (occurred_at)
        SQL);
        DB::statement('CREATE INDEX payments_order ON payments (order_id)');
        DB::statement('CREATE INDEX payments_gateway_ref ON payments (gateway_ref)');

        foreach (self::PARTITIONED as $table) {
            DB::statement("CREATE TABLE {$table}_default PARTITION OF {$table} DEFAULT");
            Rls::enable($table);
        }
        Rls::enable('stock_levels');
    }

    public function down(): void
    {
        foreach (array_reverse(self::PARTITIONED) as $table) {
            DB::statement("DROP TABLE IF EXISTS {$table} CASCADE");
        }
        Schema::dropIfExists('stock_levels');
    }
};

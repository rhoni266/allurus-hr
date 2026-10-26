<?php

use App\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Third-party delivery, week 1 (docs/delivery-integration.md): connections, menu
 * mappings, delivery orders, inbound webhook events, status outbox.
 */
return new class extends Migration
{
    private const RLS_TABLES = [
        'delivery_connections', 'delivery_menu_mappings', 'delivery_modifier_mappings',
        'delivery_orders', 'delivery_webhook_events', 'delivery_status_outbox',
    ];

    public function up(): void
    {
        // Cloud-created orders (delivery platforms) have no terminal and no cashier; a
        // platform cancellation has no staff member. Unmapped delivery items have no variant.
        DB::statement('ALTER TABLE orders ALTER COLUMN terminal_id DROP NOT NULL, ALTER COLUMN staff_id DROP NOT NULL');
        DB::statement('ALTER TABLE order_items ALTER COLUMN variant_id DROP NOT NULL');
        DB::statement('ALTER TABLE order_voids ALTER COLUMN terminal_id DROP NOT NULL, ALTER COLUMN staff_id DROP NOT NULL');
        DB::statement('ALTER TABLE order_refund_lines ALTER COLUMN variant_id DROP NOT NULL');

        Schema::create('delivery_connections', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('outlet_id')->index();
            $t->string('provider', 32);                   // fixture | deliverect | grab | foodpanda | shopee ...
            $t->string('mode', 16)->default('aggregator'); // direct | aggregator
            $t->string('external_store_id');
            $t->text('credentials')->nullable();          // encrypted:array
            $t->text('webhook_secret')->nullable();       // encrypted
            $t->string('status', 16)->default('pending'); // pending | active | paused | error
            $t->boolean('auto_accept')->default(false);
            $t->unsignedSmallInteger('default_prep_minutes')->default(15);
            $t->unsignedSmallInteger('accept_timeout_seconds')->default(180);
            $t->timestampTz('last_event_at', 6)->nullable();
            $t->timestampTz('last_menu_sync_at', 6)->nullable();
            $t->jsonb('settings')->default('{}');         // e.g. default_tax_code for unmapped items
            $t->timestampsTz(6);
            $t->unique(['provider', 'external_store_id']);
        });

        // A webhook arrives before any tenant is known, and RLS (FORCE, no BYPASSRLS) hides
        // every connection row until one is. This narrow table routes (provider, external
        // store) to the tenant, with no RLS and no secrets, like terminals and pairing codes.
        // It is maintained by a trigger on delivery_connections, never by application code.
        Schema::create('delivery_store_routes', function (Blueprint $t) {
            $t->uuid('connection_id')->primary();
            $t->uuid('tenant_id');
            $t->string('provider', 32);
            $t->string('external_store_id');
            $t->unique(['provider', 'external_store_id']);
        });
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION delivery_route_sync() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    DELETE FROM delivery_store_routes WHERE connection_id = OLD.id;
                    RETURN NULL;
                END IF;
                INSERT INTO delivery_store_routes (connection_id, tenant_id, provider, external_store_id)
                VALUES (NEW.id, NEW.tenant_id, NEW.provider, NEW.external_store_id)
                ON CONFLICT (connection_id) DO UPDATE
                   SET tenant_id = EXCLUDED.tenant_id, provider = EXCLUDED.provider, external_store_id = EXCLUDED.external_store_id;
                RETURN NULL;
            END $$;
        SQL);
        DB::statement('CREATE TRIGGER delivery_connections_route AFTER INSERT OR UPDATE OR DELETE ON delivery_connections FOR EACH ROW EXECUTE FUNCTION delivery_route_sync()');

        Schema::create('delivery_menu_mappings', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('outlet_id');                         // routes the feed row to that outlet's terminals
            $t->uuid('connection_id');
            $t->uuid('variant_id');
            $t->string('external_item_id');
            $t->string('external_sku')->nullable();
            $t->bigInteger('price_sen')->nullable();       // explicit delivery price wins
            $t->integer('markup_bps')->nullable();         // else base + markup
            $t->boolean('is_listed')->default(true);
            $t->boolean('is_available')->default(true);
            $t->string('sync_status', 16)->default('pending');
            $t->timestampTz('last_synced_at', 6)->nullable();
            $t->unsignedBigInteger('row_version')->default(1);
            $t->timestampsTz(6);
            $t->unique(['connection_id', 'variant_id']);
            $t->index(['connection_id', 'external_item_id']);
        });

        Schema::create('delivery_modifier_mappings', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('connection_id');
            $t->uuid('modifier_id');
            $t->string('external_modifier_id');
            $t->string('external_group_id')->nullable();
            $t->bigInteger('price_delta_sen')->nullable();
            $t->boolean('is_available')->default(true);
            $t->timestampsTz(6);
            $t->unique(['connection_id', 'modifier_id']);
            $t->index(['connection_id', 'external_modifier_id']);
        });

        // Platform figures live here; the linked orders row keeps our own pricing identity.
        Schema::create('delivery_orders', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('outlet_id')->index();
            $t->uuid('connection_id')->index();
            $t->uuid('order_id')->nullable()->index();
            $t->string('provider', 32);
            $t->string('external_order_id');
            $t->string('short_code', 32)->nullable();
            $t->string('status', 16);                      // received | accepted | preparing | ready | picked_up | delivered | cancelled | rejected
            $t->string('fulfilment', 16);                  // delivery | pickup
            $t->string('payment_mode', 24);                // platform_collected | cash_on_delivery
            $t->bigInteger('items_total_sen');
            $t->bigInteger('delivery_fee_sen')->default(0);
            $t->bigInteger('platform_discount_sen')->default(0);
            $t->bigInteger('merchant_discount_sen')->default(0);
            $t->bigInteger('commission_sen')->nullable();
            $t->bigInteger('payout_estimate_sen')->nullable();
            $t->bigInteger('platform_total_sen');
            $t->jsonb('customer')->nullable();             // minimal (PDPA): first name, phone suffix
            $t->text('notes')->nullable();
            $t->timestampTz('placed_at', 6);
            $t->timestampTz('accept_by', 6)->nullable();
            $t->timestampTz('pickup_eta', 6)->nullable();
            $t->boolean('needs_attention')->default(false);
            $t->jsonb('attention_reasons')->default('[]');
            $t->jsonb('raw_payload');
            $t->unsignedBigInteger('row_version')->default(1);
            $t->timestampsTz(6);
            $t->unique(['connection_id', 'external_order_id']);
            $t->index(['tenant_id', 'outlet_id', 'status']);
        });

        // Stored only after the signature checks out, under the connection's tenant, so it
        // can be RLS'd. Dedupe is global: the unique index sees across tenants.
        Schema::create('delivery_webhook_events', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->string('provider', 32);
            $t->uuid('connection_id')->index();
            $t->string('event_id');
            $t->string('event_type', 32)->nullable();
            $t->longText('raw_body');
            $t->string('status', 16)->default('received'); // received | processed | failed | ignored
            $t->text('error')->nullable();
            $t->timestampTz('received_at', 6)->useCurrent();
            $t->timestampTz('processed_at', 6)->nullable();
            $t->unique(['provider', 'event_id']);
        });

        Schema::create('delivery_status_outbox', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('delivery_order_id')->index();
            $t->string('status', 16);
            $t->jsonb('context')->nullable();
            $t->unsignedSmallInteger('attempts')->default(0);
            $t->timestampTz('next_attempt_at', 6)->nullable();
            $t->timestampTz('sent_at', 6)->nullable();
            $t->text('last_error')->nullable();
            $t->timestampsTz(6);
            $t->index(['sent_at', 'next_attempt_at']);
        });

        foreach (self::RLS_TABLES as $table) {
            Rls::enable($table);
        }

        // Terminals learn about delivery orders and menu mappings through the normal feed
        // (routed by outlet_id), as the safety net behind the real-time push.
        foreach (['delivery_orders' => 'delivery_order', 'delivery_menu_mappings' => 'delivery_menu_mapping'] as $table => $entity) {
            DB::statement("CREATE TRIGGER {$table}_row_version BEFORE UPDATE ON {$table} FOR EACH ROW EXECUTE FUNCTION sync_bump_row_version()");
            DB::statement("CREATE TRIGGER {$table}_sync_change AFTER INSERT OR UPDATE OR DELETE ON {$table} FOR EACH ROW EXECUTE FUNCTION sync_record_change('{$entity}')");
        }
    }

    public function down(): void
    {
        foreach (array_reverse(self::RLS_TABLES) as $table) {
            Schema::dropIfExists($table);
        }
        Schema::dropIfExists('delivery_store_routes');
        DB::unprepared('DROP FUNCTION IF EXISTS delivery_route_sync()');
    }
};

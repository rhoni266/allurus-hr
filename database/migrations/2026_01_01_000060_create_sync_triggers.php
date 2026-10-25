<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The change feed lives in Postgres, not in Eloquent events. Model hooks miss
 * increment()/decrement(), query-builder updates, imports and raw SQL; a missed feed
 * row means terminals silently keep a stale price forever. Triggers can't be bypassed.
 */
return new class extends Migration
{
    /** table => entity name sent to terminals */
    private const SYNCABLE = [
        'products'         => 'product',
        'product_variants' => 'variant',
        'price_overrides'  => 'price_override',
        'modifiers'        => 'modifier',
    ];

    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            -- OR REPLACE: migrate:fresh drops tables but not functions
            CREATE OR REPLACE FUNCTION sync_bump_row_version() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                NEW.row_version := OLD.row_version + 1;
                RETURN NEW;
            END $$;

            CREATE OR REPLACE FUNCTION sync_record_change() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                j      jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
                op     text  := 'upsert';
                outlet uuid  := NULL;
            BEGIN
                -- soft delete (deleted_at set) and hard delete both become tombstones
                IF TG_OP = 'DELETE' OR (j ? 'deleted_at' AND j->>'deleted_at' IS NOT NULL) THEN
                    op := 'delete';
                END IF;

                -- outlet-specific rows go only to that outlet's terminals
                IF TG_TABLE_NAME = 'price_overrides' AND j->>'scope' = 'outlet' THEN
                    outlet := (j->>'scope_key')::uuid;
                ELSIF j ? 'outlet_id' AND j->>'outlet_id' IS NOT NULL THEN
                    outlet := (j->>'outlet_id')::uuid;   -- e.g. staff assigned to one outlet
                END IF;

                -- Serialise feed writers per tenant until commit, so seq order == commit
                -- order and a pull cursor can never skip a row that commits late.
                PERFORM pg_advisory_xact_lock(hashtextextended('sync_changes:' || (j->>'tenant_id'), 0));

                INSERT INTO sync_changes (tenant_id, outlet_id, entity, entity_id, op, row_version)
                VALUES ((j->>'tenant_id')::uuid, outlet, TG_ARGV[0], (j->>'id')::uuid, op, (j->>'row_version')::bigint);

                RETURN NULL;
            END $$;
        SQL);

        foreach (self::SYNCABLE as $table => $entity) {
            DB::statement("CREATE TRIGGER {$table}_row_version BEFORE UPDATE ON {$table} FOR EACH ROW EXECUTE FUNCTION sync_bump_row_version()");
            DB::statement("CREATE TRIGGER {$table}_sync_change AFTER INSERT OR UPDATE OR DELETE ON {$table} FOR EACH ROW EXECUTE FUNCTION sync_record_change('{$entity}')");
        }
    }

    public function down(): void
    {
        foreach (array_keys(self::SYNCABLE) as $table) {
            DB::statement("DROP TRIGGER IF EXISTS {$table}_sync_change ON {$table}");
            DB::statement("DROP TRIGGER IF EXISTS {$table}_row_version ON {$table}");
        }
        DB::unprepared('DROP FUNCTION IF EXISTS sync_record_change(); DROP FUNCTION IF EXISTS sync_bump_row_version();');
    }
};

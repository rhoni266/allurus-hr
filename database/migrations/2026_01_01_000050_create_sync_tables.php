<?php

use App\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const RLS_TABLES = ['sync_changes', 'sync_watermarks', 'offline_sync_queues', 'sync_conflicts', 'order_ids'];

    public function up(): void
    {
        // Pull-side change feed. Writers take a per-tenant advisory lock before inserting
        // (see SyncChange::record), so within a tenant seq order == commit order and a
        // cursor can never skip a row that commits late.
        Schema::create('sync_changes', function (Blueprint $t) {
            $t->bigIncrements('seq');
            $t->uuid('tenant_id');
            $t->uuid('outlet_id')->nullable();          // null = all outlets
            $t->string('entity');
            $t->uuid('entity_id');
            $t->string('op');                           // upsert | delete
            $t->unsignedBigInteger('row_version');
            $t->timestampTz('created_at')->useCurrent();
            $t->index(['tenant_id', 'seq']);
        });

        // Highest seq pruned per tenant. A cursor below this must full-resync.
        Schema::create('sync_watermarks', function (Blueprint $t) {
            $t->uuid('tenant_id')->primary();
            $t->unsignedBigInteger('pruned_through_seq')->default(0);
            $t->timestampTz('updated_at')->useCurrent();
        });

        // Push-side inbox: idempotency + audit.
        Schema::create('offline_sync_queues', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('terminal_id');
            $t->unsignedBigInteger('client_seq');
            $t->string('type');
            $t->jsonb('payload');
            $t->string('status');                       // applied | conflict | rejected
            $t->jsonb('result')->nullable();
            $t->timestampTz('client_created_at', 6);
            $t->timestampTz('processed_at', 6)->nullable();
            $t->timestampTz('received_at', 6)->useCurrent();
            $t->unique(['terminal_id', 'client_seq']);
        });

        Schema::create('sync_conflicts', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('queue_id')->index();
            $t->string('kind');                         // price_mismatch | negative_stock | product_deleted | offline_noncash_payment
            $t->jsonb('detail');
            $t->string('resolution')->nullable();
            $t->timestampsTz();
        });

        // orders is partitioned on (id, occurred_at), so it cannot enforce a unique id.
        // This narrow unpartitioned table does, and makes order.create idempotent.
        Schema::create('order_ids', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->timestampTz('occurred_at', 6);   // Laravel's default precision is 0 (whole seconds)
        });

        foreach (self::RLS_TABLES as $table) {
            Rls::enable($table);
        }
    }

    public function down(): void
    {
        foreach (array_reverse(self::RLS_TABLES) as $table) {
            Schema::dropIfExists($table);
        }
    }
};

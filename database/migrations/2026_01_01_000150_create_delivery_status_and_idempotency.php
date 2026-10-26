<?php

use App\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\{DB, Schema};

/**
 * Delivery week 3: status back to the platform, manual accept/reject, auto-reject, and the
 * kitchen watchdog. Plus Idempotency-Key storage for non-sync POSTs (CLAUDE.md conventions).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('delivery_status_outbox', function (Blueprint $t) {
            $t->timestampTz('gave_up_at', 6)->nullable();   // permanent failure or out of retries: a person must look
            $t->index(['delivery_order_id', 'created_at']);
        });

        Schema::table('delivery_orders', function (Blueprint $t) {
            $t->timestampTz('rejected_at', 6)->nullable();
            $t->string('rejected_by', 64)->nullable();       // 'auto' or a staff id
            $t->string('reject_reason', 255)->nullable();
            // what the kitchen ticket shows, kept at ingest so a manual accept fires the same
            // ticket auto-accept would (item notes aren't on order_items)
            $t->jsonb('kitchen_lines')->nullable();
        });

        Schema::table('delivery_connections', function (Blueprint $t) {
            $t->timestampTz('paused_at', 6)->nullable();
            $t->string('pause_reason', 32)->nullable();      // kitchen_quiet (watchdog; resumes itself) | manual
            $t->timestampTz('kitchen_quiet_since', 6)->nullable();   // first watchdog tick that found nobody listening
        });

        // One stored response per (device, key). Replays get the same answer; the same key
        // with a different body is refused.
        Schema::create('idempotency_keys', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('scope');                                // the calling device
            $t->string('key', 128);
            $t->char('request_hash', 64);
            $t->unsignedSmallInteger('status_code')->nullable();   // null = still running
            $t->jsonb('response')->nullable();
            $t->timestampTz('created_at', 6)->useCurrent();
            $t->unique(['tenant_id', 'scope', 'key']);
        });
        Rls::enable('idempotency_keys');
    }

    public function down(): void
    {
        Schema::dropIfExists('idempotency_keys');
        Schema::table('delivery_connections', fn (Blueprint $t) => $t->dropColumn(['paused_at', 'pause_reason', 'kitchen_quiet_since']));
        Schema::table('delivery_orders', fn (Blueprint $t) => $t->dropColumn(['rejected_at', 'rejected_by', 'reject_reason', 'kitchen_lines']));
        Schema::table('delivery_status_outbox', function (Blueprint $t) {
            $t->dropIndex(['delivery_order_id', 'created_at']);
            $t->dropColumn('gave_up_at');
        });
    }
};

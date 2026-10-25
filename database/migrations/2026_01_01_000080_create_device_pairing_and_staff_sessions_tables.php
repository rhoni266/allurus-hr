<?php

use App\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // One-time codes a manager hands to a new device. Like `terminals`, there is no
        // RLS and no TenantScope: a code is redeemed before any tenant is known. Only the
        // SHA-256 of the code is stored, and the code itself is unguessable and short-lived.
        Schema::create('device_pairing_codes', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('outlet_id');
            $t->char('code_hash', 64)->unique();
            $t->timestampTz('expires_at', 6);
            $t->timestampTz('used_at', 6)->nullable();
            $t->uuid('used_by_terminal_id')->nullable();
            $t->uuid('issued_by_staff_id')->nullable();   // null = issued from the CLI / HQ
            $t->timestampTz('created_at', 6)->useCurrent();
            $t->foreign('outlet_id')->references('id')->on('outlets')->cascadeOnDelete();
        });

        Schema::table('terminals', function (Blueprint $t) {
            $t->timestampTz('paired_at', 6)->nullable();
        });

        // A staff member signed in on one terminal. Sent as X-Staff-Session next to the
        // terminal's bearer token; the tenant still comes only from the terminal token.
        Schema::create('staff_sessions', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('terminal_id')->index();
            $t->uuid('staff_id')->index();
            $t->char('token_hash', 64)->unique();
            $t->timestampTz('expires_at', 6);
            $t->timestampTz('revoked_at', 6)->nullable();
            $t->timestampTz('last_used_at', 6)->nullable();
            $t->timestampTz('created_at', 6)->useCurrent();
        });
        Rls::enable('staff_sessions');
    }

    public function down(): void
    {
        Schema::dropIfExists('staff_sessions');
        Schema::table('terminals', fn (Blueprint $t) => $t->dropColumn('paired_at'));
        Schema::dropIfExists('device_pairing_codes');
    }
};

<?php

use App\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenants', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('name');
            $t->string('slug')->unique();
            $t->string('business_type');
            $t->string('database_mode')->default('shared');
            $t->string('sst_registration_no')->nullable();
            $t->string('tin')->nullable();
            $t->string('currency', 3)->default('MYR');
            $t->jsonb('settings')->default('{}');
            $t->timestampsTz();
            $t->softDeletesTz();
        });

        Schema::create('outlets', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('parent_outlet_id')->nullable();
            $t->string('name');
            $t->string('region_code')->nullable();
            $t->boolean('sst_applicable')->default(true);
            $t->jsonb('settings')->default('{}');
            $t->timestampsTz();
            $t->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
        });

        // No RLS on terminals: Sanctum resolves the device before any tenant is known.
        // TenantScope is not applied to the Terminal model for the same reason.
        Schema::create('terminals', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('outlet_id')->index();
            $t->string('name');
            $t->string('device_fingerprint')->unique();
            $t->unsignedBigInteger('last_pull_cursor')->default(0);
            $t->timestampTz('last_seen_at')->nullable();
            $t->timestampsTz();
            $t->foreign('outlet_id')->references('id')->on('outlets')->cascadeOnDelete();
        });

        Rls::enable('outlets');
    }

    public function down(): void
    {
        Schema::dropIfExists('terminals');
        Schema::dropIfExists('outlets');
        Schema::dropIfExists('tenants');
    }
};

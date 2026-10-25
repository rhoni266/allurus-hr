<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('terminals', function (Blueprint $t) {
            // active -> retiring -> revoked, or active -> revoked. Re-pairing returns to active.
            $t->string('status', 16)->default('active');
            $t->timestampTz('retire_requested_at', 6)->nullable();   // sales after this are refused
            $t->timestampTz('revoked_at', 6)->nullable();
            $t->timestampTz('wipe_requested_at', 6)->nullable();
            $t->timestampTz('wipe_confirmed_at', 6)->nullable();
            $t->uuid('revoked_by_staff_id')->nullable();            // null = CLI / HQ
            $t->string('revoke_reason', 255)->nullable();
            $t->unsignedInteger('outbox_pending')->nullable();      // reported on every push
        });
    }

    public function down(): void
    {
        Schema::table('terminals', fn (Blueprint $t) => $t->dropColumn([
            'status', 'retire_requested_at', 'revoked_at', 'wipe_requested_at', 'wipe_confirmed_at',
            'revoked_by_staff_id', 'revoke_reason', 'outbox_pending',
        ]));
    }
};

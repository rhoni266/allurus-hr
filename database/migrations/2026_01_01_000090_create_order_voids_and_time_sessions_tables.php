<?php

use App\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The void is the fact; orders.status = 'void' is only a projection of it.
        // One void per order: a second void (e.g. from another terminal) is a conflict.
        Schema::create('order_voids', function (Blueprint $t) {
            $t->uuid('id')->primary();                    // generated on the terminal
            $t->uuid('tenant_id')->index();
            $t->uuid('order_id')->unique();
            $t->uuid('terminal_id');
            $t->uuid('staff_id');
            $t->string('reason', 255);
            $t->timestampTz('occurred_at', 6);
            $t->timestampTz('created_at', 6)->useCurrent();
        });

        // Snooker / karaoke / gaming. Only the end of a session is synced, carrying its
        // whole timeline and the rate snapshot frozen at start (spec/time-billing).
        Schema::create('time_sessions', function (Blueprint $t) {
            $t->uuid('id')->primary();                    // generated on the terminal
            $t->uuid('tenant_id')->index();
            $t->uuid('outlet_id')->index();
            $t->uuid('terminal_id');
            $t->uuid('resource_id');                      // the table / room / PC
            $t->uuid('variant_id')->nullable();           // the timed product it was billed as
            $t->uuid('order_id')->nullable();             // the order that charged it, if any
            $t->uuid('staff_id');
            $t->timestampTz('started_at', 6);
            $t->timestampTz('ended_at', 6);
            $t->unsignedInteger('paused_seconds')->default(0);
            $t->jsonb('rate_snapshot');
            $t->unsignedInteger('billed_minutes');
            $t->bigInteger('amount_sen');                 // what the terminal charged; never rewritten
            $t->bigInteger('server_amount_sen');          // TimeBilling recomputed here, for audit
            $t->unsignedSmallInteger('spec_version');
            $t->timestampTz('created_at', 6)->useCurrent();
        });

        Rls::enable('order_voids');
        Rls::enable('time_sessions');
    }

    public function down(): void
    {
        Schema::dropIfExists('time_sessions');
        Schema::dropIfExists('order_voids');
    }
};

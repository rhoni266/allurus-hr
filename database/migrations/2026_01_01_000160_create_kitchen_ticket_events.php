<?php

use App\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * KDS bumps (sync mutation ticket.status). Each tap on a KDS screen or till is an
 * append-only event; kitchen_tickets.status is its projection and only moves forward
 * (new -> preparing -> ready -> bumped), whatever order screens sync in.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('kitchen_ticket_events', function (Blueprint $t) {
            $t->uuid('id')->primary();                            // client-generated: the domain idempotency key
            $t->uuid('tenant_id')->index();
            $t->uuid('outlet_id');
            $t->uuid('ticket_id')->index();
            $t->string('status', 16);                             // preparing | ready | bumped
            $t->timestampTz('occurred_at', 6);                    // device clock
            $t->uuid('device_id');
            $t->uuid('staff_id')->nullable();                     // KDS screens usually have nobody signed in
            $t->uuid('queue_id');
            $t->boolean('applied');                               // false: the ticket was already there, or cancelled
            $t->timestampTz('created_at', 6);
        });
        Rls::enable('kitchen_ticket_events');

        // server time each step was first reached (the platform hears about it then)
        Schema::table('kitchen_tickets', function (Blueprint $t) {
            $t->timestampTz('preparing_at', 6)->nullable();
            $t->timestampTz('ready_at', 6)->nullable();
            $t->timestampTz('bumped_at', 6)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('kitchen_tickets', fn (Blueprint $t) => $t->dropColumn(['preparing_at', 'ready_at', 'bumped_at']));
        Schema::dropIfExists('kitchen_ticket_events');
    }
};

<?php

use App\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\{DB, Schema};

/**
 * Kitchen side (docs/web-ordering-and-auto-accept.md, step 1).
 *
 * A kitchen ticket and each print job are rows in the change feed; the Reverb broadcast is
 * only a doorbell telling KDS screens and print nodes to pull. A device that missed the
 * bell catches up on its next cursor pull, so a ticket can't be lost to a dropped socket.
 */
return new class extends Migration
{
    private const RLS_TABLES = ['printers', 'kitchen_tickets', 'print_jobs'];

    public function up(): void
    {
        // Kitchen devices (KDS screens, print nodes) pair like terminals but get pos:kitchen.
        // They heartbeat; KitchenPresence reads it to decide whether auto-accept is safe.
        Schema::table('terminals', function (Blueprint $t) {
            $t->string('kind', 16)->default('terminal');          // terminal | kitchen
            $t->timestampTz('last_heartbeat_at', 6)->nullable();  // server clock
            $t->jsonb('heartbeat')->nullable();                   // {kds: bool, printers: [{id, status}]}
            $t->index(['outlet_id', 'kind', 'last_heartbeat_at']);
        });
        Schema::table('device_pairing_codes', function (Blueprint $t) {
            $t->string('kind', 16)->default('terminal');          // what the redeemed device becomes
        });

        // A physical printer on the outlet's LAN. The cloud never connects to it: a print
        // node on the same network does (outbound only). No credentials here.
        Schema::create('printers', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('outlet_id')->index();
            $t->string('name', 64);
            $t->string('role', 16)->default('kitchen');           // kitchen | receipt
            $t->jsonb('connection')->default('{}');               // e.g. {"type":"tcp","host":"192.168.1.50","port":9100}
            $t->boolean('is_active')->default(true);
            $t->unsignedBigInteger('row_version')->default(1);
            $t->timestampsTz(6);
        });

        // One ticket per order (unique order_id), whatever the source, so a replayed webhook
        // or a resent sync mutation can't put a second ticket on the pass.
        Schema::create('kitchen_tickets', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('outlet_id')->index();
            $t->uuid('order_id')->unique();
            $t->string('source', 16);                             // terminal | delivery | web | qr
            $t->string('station', 32)->default('main');           // stations aren't routed yet
            $t->string('status', 16)->default('new');             // new | preparing | ready | bumped | cancelled | late
            $t->string('label', 64);                              // receipt no. or platform short code
            $t->jsonb('lines');                                   // [{name, qty_milli, modifiers: [name], notes}]
            $t->text('notes')->nullable();
            $t->timestampTz('fired_at', 6);
            $t->timestampTz('cancelled_at', 6)->nullable();
            $t->unsignedBigInteger('row_version')->default(1);
            $t->timestampsTz(6);
            $t->index(['outlet_id', 'status']);
        });

        // What a print node must print. Delivery is at-least-once (feed + doorbell); the node
        // dedupes by job id and acks, so a crash means neither a lost nor a double ticket.
        Schema::create('print_jobs', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('outlet_id')->index();
            $t->uuid('printer_id')->index();
            $t->uuid('ticket_id')->nullable()->index();
            $t->string('kind', 16);                               // kitchen | kitchen_cancel | receipt
            $t->jsonb('payload');                                 // layout spec, rendered by the server
            $t->string('status', 16)->default('queued');          // queued | printed | failed
            $t->unsignedSmallInteger('attempts')->default(0);
            $t->uuid('reprint_of')->nullable();
            $t->timestampTz('printed_at', 6)->nullable();
            $t->uuid('printed_by_device_id')->nullable();
            $t->text('last_error')->nullable();
            $t->unsignedBigInteger('row_version')->default(1);
            $t->timestampsTz(6);
            $t->index(['outlet_id', 'status']);
        });
        // one original job per (ticket, printer, kind); reprints are separate rows
        DB::statement('CREATE UNIQUE INDEX print_jobs_once ON print_jobs (ticket_id, printer_id, kind) WHERE reprint_of IS NULL');

        foreach (self::RLS_TABLES as $table) {
            Rls::enable($table);
        }
        foreach (['printers' => 'printer', 'kitchen_tickets' => 'kitchen_ticket', 'print_jobs' => 'print_job'] as $table => $entity) {
            DB::statement("CREATE TRIGGER {$table}_row_version BEFORE UPDATE ON {$table} FOR EACH ROW EXECUTE FUNCTION sync_bump_row_version()");
            DB::statement("CREATE TRIGGER {$table}_sync_change AFTER INSERT OR UPDATE OR DELETE ON {$table} FOR EACH ROW EXECUTE FUNCTION sync_record_change('{$entity}')");
        }

        // who decided to accept a delivery order: 'auto' or a staff id (manual accept, week 3)
        Schema::table('delivery_orders', function (Blueprint $t) {
            $t->timestampTz('accepted_at', 6)->nullable();
            $t->string('accepted_by', 64)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('delivery_orders', fn (Blueprint $t) => $t->dropColumn(['accepted_at', 'accepted_by']));
        foreach (array_reverse(self::RLS_TABLES) as $table) {
            Schema::dropIfExists($table);
        }
        Schema::table('device_pairing_codes', fn (Blueprint $t) => $t->dropColumn('kind'));
        Schema::table('terminals', function (Blueprint $t) {
            $t->dropIndex(['outlet_id', 'kind', 'last_heartbeat_at']);
            $t->dropColumn(['kind', 'last_heartbeat_at', 'heartbeat']);
        });
    }
};

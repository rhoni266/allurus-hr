<?php

use App\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Offline sign-in, option C of docs/offline-pin-signin.md (server side).
 *
 * A staff_credentials row is *permission* for one staff member to sign in offline on one
 * terminal until expires_at. It holds no secret: the PIN verifier is created and sealed
 * on the device with a non-exportable hardware key and never leaves it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('staff', function (Blueprint $t) {
            $t->unsignedInteger('pin_version')->default(1);   // bumped on every PIN change
            $t->unsignedSmallInteger('pin_length')->nullable(); // owners/managers need 6+
        });

        Schema::create('staff_credentials', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('outlet_id')->index();                   // routes it to that outlet's terminals
            $t->uuid('staff_id')->index();
            $t->uuid('terminal_id')->index();
            $t->unsignedInteger('pin_version');               // the PIN it was issued for
            $t->timestampTz('issued_at', 6);
            $t->timestampTz('expires_at', 6);
            $t->timestampTz('revoked_at', 6)->nullable();
            $t->string('revoke_reason', 32)->nullable();      // staff_deactivated | pin_changed
            $t->unsignedBigInteger('row_version')->default(1);
            $t->timestampsTz();
        });
        Rls::enable('staff_credentials');

        // Terminals learn about issued and revoked credentials through the normal feed
        // (no secrets in the row), so a revoked credential is deleted on the next pull.
        DB::statement('CREATE TRIGGER staff_credentials_row_version BEFORE UPDATE ON staff_credentials FOR EACH ROW EXECUTE FUNCTION sync_bump_row_version()');
        DB::statement("CREATE TRIGGER staff_credentials_sync_change AFTER INSERT OR UPDATE OR DELETE ON staff_credentials FOR EACH ROW EXECUTE FUNCTION sync_record_change('staff_credential')");

        // Deactivation or a PIN change revokes every credential of that staff member, in the
        // database, so a raw-SQL or bulk update can't leave live credentials behind (the
        // same lesson as the change feed: never rely on model events for invariants).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION revoke_staff_credentials() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                reason text := CASE WHEN OLD.is_active AND NOT NEW.is_active THEN 'staff_deactivated' ELSE 'pin_changed' END;
                outer_tenant text := current_setting('app.tenant_id', true);
            BEGIN
                -- the app role is subject to RLS even here, so act as the row's tenant for
                -- this statement, then restore whatever the caller had
                PERFORM set_config('app.tenant_id', NEW.tenant_id::text, true);
                -- clock_timestamp(), not now(): now() is the *transaction start*, which in a long
                -- transaction predates the change and makes earlier offline sign-ins look stale
                UPDATE staff_credentials SET revoked_at = clock_timestamp(), revoke_reason = reason, updated_at = clock_timestamp()
                 WHERE staff_id = NEW.id AND revoked_at IS NULL;
                PERFORM set_config('app.tenant_id', COALESCE(outer_tenant, ''), true);
                RETURN NULL;
            END $$;
        SQL);
        DB::statement(<<<'SQL'
            CREATE TRIGGER staff_revoke_credentials AFTER UPDATE ON staff FOR EACH ROW
            WHEN ((OLD.is_active AND NOT NEW.is_active) OR OLD.pin_version <> NEW.pin_version)
            EXECUTE FUNCTION revoke_staff_credentials()
        SQL);
    }

    public function down(): void
    {
        DB::statement('DROP TRIGGER IF EXISTS staff_revoke_credentials ON staff');
        DB::unprepared('DROP FUNCTION IF EXISTS revoke_staff_credentials()');
        Schema::dropIfExists('staff_credentials');
        Schema::table('staff', fn (Blueprint $t) => $t->dropColumn(['pin_version', 'pin_length']));
    }
};

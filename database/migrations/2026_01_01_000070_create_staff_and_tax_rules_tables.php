<?php

use App\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('staff', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->index();
            $t->uuid('outlet_id')->nullable()->index();    // null = all outlets
            $t->string('name');
            $t->string('role');                             // owner | manager | cashier | kitchen
            $t->string('pin_hash');                         // never the PIN itself
            $t->boolean('is_active')->default(true);
            $t->unsignedBigInteger('row_version')->default(1);
            $t->timestampsTz();
        });
        Rls::enable('staff');

        // Terminals need the staff list (not the PIN hashes) for the login screen.
        // Same triggers as the catalogue (migration 000060). Deactivation is an upsert
        // with is_active = false, so a device drops the person on its next pull.
        DB::statement('CREATE TRIGGER staff_row_version BEFORE UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION sync_bump_row_version()');
        DB::statement("CREATE TRIGGER staff_sync_change AFTER INSERT OR UPDATE OR DELETE ON staff FOR EACH ROW EXECUTE FUNCTION sync_record_change('staff')");

        // National tax rules: shared by every tenant, so no tenant_id and no RLS.
        // Rates are data (CLAUDE.md rule 8). Each change is a new version with an effective date;
        // the version used is stored on every order's tax_breakdown.
        Schema::create('tax_rules', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('code');                             // SST_SALES | SST_SERVICE | ... | EXEMPT
            $t->unsignedInteger('version');
            $t->unsignedInteger('rate_bps');                // 800 = 8%
            $t->date('effective_from');
            $t->date('effective_to')->nullable();           // exclusive
            $t->string('description');
            $t->string('source')->nullable();               // where the rate was confirmed
            $t->timestampsTz();
            $t->unique(['code', 'version']);
            $t->index(['code', 'effective_from']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tax_rules');
        Schema::dropIfExists('staff');
    }
};

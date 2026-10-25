<?php

namespace App\Database;

use Illuminate\Support\Facades\DB;

final class Rls
{
    /**
     * Tenant isolation policy. FORCE makes it apply to the table owner too, because the
     * app role owns the schema. USING filters reads; WITH CHECK guards writes.
     */
    public static function enable(string $table): void
    {
        DB::statement("ALTER TABLE {$table} ENABLE ROW LEVEL SECURITY");
        DB::statement("ALTER TABLE {$table} FORCE ROW LEVEL SECURITY");
        DB::statement(<<<SQL
            CREATE POLICY tenant_isolation ON {$table}
            USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
            WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        SQL);
    }
}

<?php

namespace App\Console\Commands;

use App\Models\{Staff, StaffSession, Tenant};
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Set a staff member's PIN from the CLI: the way back in for an owner with no other
 * owner around (e.g. a 4-digit owner PIN from before the 6-digit rule).
 *
 *   php artisan pos:staff-pin demo-cafe                 # list staff
 *   php artisan pos:staff-pin demo-cafe <staff-id> --pin=123456
 */
class PosStaffPin extends Command
{
    protected $signature = 'pos:staff-pin {tenant : tenant slug} {staff? : staff id} {--pin= : the new PIN}';

    protected $description = "Set a staff member's PIN (revokes their sessions and offline credentials)";

    public function handle(): int
    {
        $tenant = Tenant::where('slug', $this->argument('tenant'))->first()
            ?? tap(null, fn () => $this->error('Unknown tenant slug.'));
        if (! $tenant) {
            return self::FAILURE;
        }

        TenantContext::set($tenant->id);
        DB::statement("SELECT set_config('app.tenant_id', ?, false)", [$tenant->id]);
        try {
            if (! $this->argument('staff')) {
                $this->table(['Staff id', 'Name', 'Role', 'Active', 'Needs 6-digit PIN'], Staff::orderBy('name')->get()
                    ->map(fn (Staff $s) => [$s->id, $s->name, $s->role, $s->is_active ? 'yes' : 'no', $s->needsLongerPin() ? 'yes' : ''])->all());
                return self::SUCCESS;
            }

            $staff = Staff::find($this->argument('staff'));
            if (! $staff || ! $this->option('pin')) {
                $this->error($staff ? 'Pass --pin.' : "No staff member with that id in {$tenant->slug}.");
                return self::FAILURE;
            }

            try {
                $staff->setPin($this->option('pin'));
            } catch (\InvalidArgumentException $e) {
                $this->error($e->getMessage());
                return self::FAILURE;
            }
            DB::transaction(function () use ($staff) {
                $staff->save();
                StaffSession::where('staff_id', $staff->id)->whereNull('revoked_at')->update(['revoked_at' => now()]);
            });
            $this->info("PIN set for {$staff->name}; sessions and offline credentials revoked.");

            return self::SUCCESS;
        } finally {
            DB::statement("SELECT set_config('app.tenant_id', '', false)");
            TenantContext::clear();
        }
    }
}

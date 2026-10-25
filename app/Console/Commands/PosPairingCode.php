<?php

namespace App\Console\Commands;

use App\Devices\PairingService;
use App\Models\{Outlet, Tenant};
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Issue a one-time pairing code from the CLI, until the HQ dashboard exists.
 *
 *   php artisan pos:pairing-code demo-cafe            # lists outlets
 *   php artisan pos:pairing-code demo-cafe <outlet-id>
 */
class PosPairingCode extends Command
{
    protected $signature = 'pos:pairing-code {tenant : tenant slug} {outlet? : outlet id}';

    protected $description = 'Issue a one-time code to pair a POS device with an outlet';

    public function handle(PairingService $pairing): int
    {
        $tenant = Tenant::where('slug', $this->argument('tenant'))->first();
        if (! $tenant) {
            $this->error('Unknown tenant slug.');
            return self::FAILURE;
        }

        TenantContext::set($tenant->id);
        DB::statement("SELECT set_config('app.tenant_id', ?, false)", [$tenant->id]);

        try {
            if (! $this->argument('outlet')) {
                $this->table(['Outlet id', 'Name', 'Region'], Outlet::orderBy('name')->get(['id', 'name', 'region_code'])->toArray());
                $this->line('Pass an outlet id to issue a code.');
                return self::SUCCESS;
            }

            $outlet = Outlet::find($this->argument('outlet'));
            if (! $outlet) {
                $this->error("No outlet with that id in {$tenant->slug}.");
                return self::FAILURE;
            }

            $issued = $pairing->issue($outlet);
            $this->info("Pairing code for {$outlet->name}: {$issued['code']}");
            $this->line('Valid once, until '.$issued['expires_at']->toDateTimeString().' UTC.');

            return self::SUCCESS;
        } finally {
            DB::statement("SELECT set_config('app.tenant_id', '', false)");
            TenantContext::clear();
        }
    }
}

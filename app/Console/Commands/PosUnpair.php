<?php

namespace App\Console\Commands;

use App\Devices\DeviceLifecycle;
use App\Models\{Tenant, Terminal};
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Take a device out of service from the CLI, until the HQ dashboard exists.
 *
 *   php artisan pos:unpair demo-cafe                          # list devices
 *   php artisan pos:unpair demo-cafe <terminal-id> --retire   # replacing it: let it sync its backlog
 *   php artisan pos:unpair demo-cafe <terminal-id> --wipe     # lost / stolen: refuse and erase
 *   php artisan pos:unpair demo-cafe <terminal-id>            # refuse, keep its data
 */
class PosUnpair extends Command
{
    protected $signature = 'pos:unpair {tenant : tenant slug} {terminal? : terminal id}
        {--retire : let it push sales made before now, then revoke}
        {--wipe : revoke and tell the device to erase its local data}
        {--reason= : recorded on the device}';

    protected $description = 'Retire or revoke (and optionally wipe) a paired POS device';

    public function handle(DeviceLifecycle $lifecycle): int
    {
        $tenant = Tenant::where('slug', $this->argument('tenant'))->first();
        if (! $tenant) {
            $this->error('Unknown tenant slug.');
            return self::FAILURE;
        }
        if ($this->option('retire') && $this->option('wipe')) {
            $this->error('--retire keeps data until the backlog syncs; use --wipe alone to erase.');
            return self::INVALID;
        }

        TenantContext::set($tenant->id);
        DB::statement("SELECT set_config('app.tenant_id', ?, false)", [$tenant->id]);
        try {
            $devices = Terminal::where('tenant_id', $tenant->id);

            if (! $this->argument('terminal')) {
                $this->table(['Terminal id', 'Name', 'Status', 'Last seen', 'Unsynced'], $devices->orderBy('name')->get()
                    ->map(fn ($t) => [$t->id, $t->name, $t->status, $t->last_seen_at?->diffForHumans() ?? 'never', $t->outbox_pending ?? '?'])->all());
                return self::SUCCESS;
            }

            $t = $devices->whereKey($this->argument('terminal'))->first();
            if (! $t) {
                $this->error("No device with that id in {$tenant->slug}.");
                return self::FAILURE;
            }

            if ($this->option('wipe') && $t->outbox_pending) {
                $this->warn("{$t->name} last reported {$t->outbox_pending} unsynced mutation(s); a wipe destroys them.");
            }

            $t = $this->option('retire')
                ? $lifecycle->retire($t, null, $this->option('reason'))
                : $lifecycle->revoke($t, (bool) $this->option('wipe'), null, $this->option('reason'));

            $this->info("{$t->name}: {$t->status}".($t->wipe_requested_at ? ', wipe requested' : ''));

            return self::SUCCESS;
        } finally {
            DB::statement("SELECT set_config('app.tenant_id', '', false)");
            TenantContext::clear();
        }
    }
}

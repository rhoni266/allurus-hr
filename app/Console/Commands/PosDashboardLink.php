<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\URL;

/**
 * A signed, expiring link to one tenant's dashboard, until HQ users exist.
 *
 *   php artisan pos:dashboard-link              # lists tenants
 *   php artisan pos:dashboard-link demo-cafe    # valid 12 hours
 *   php artisan pos:dashboard-link demo-cafe --hours=1
 *
 * Anyone holding the link can read that tenant's dashboard until it expires: treat it like
 * a password. The signature is relative, so it works on localhost and 127.0.0.1 alike.
 */
class PosDashboardLink extends Command
{
    protected $signature = 'pos:dashboard-link {tenant? : tenant slug} {--hours=12 : how long the link works}';

    protected $description = 'Print a signed, expiring link to a tenant\'s back-office dashboard';

    public function handle(): int
    {
        if (! config('pos.dashboard.enabled')) {
            $this->error('The dashboard is disabled (POS_DASHBOARD_ENABLED).');
            return self::FAILURE;
        }
        if (! $slug = $this->argument('tenant')) {
            $this->table(['Slug', 'Name', 'Type'], Tenant::orderBy('created_at')->get(['slug', 'name', 'business_type'])->toArray());
            $this->line('Pass a slug to get a link.');
            return self::SUCCESS;
        }
        $tenant = Tenant::where('slug', $slug)->first();
        if (! $tenant) {
            $this->error('Unknown tenant slug. Run without arguments to list tenants.');
            return self::FAILURE;
        }

        $hours = max(1, min(168, (int) $this->option('hours')));
        $path = URL::temporarySignedRoute('dashboard', now()->addHours($hours), ['tenant' => $tenant->id], absolute: false);
        $this->info("Dashboard for {$tenant->name} (valid {$hours} h):");
        $this->line(rtrim(config('app.url'), '/').$path);
        $this->line('Start the server first: php artisan serve');

        return self::SUCCESS;
    }
}

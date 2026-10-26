<?php

namespace App\Providers;

use App\Delivery\ProviderRegistry;
use App\Delivery\Providers\FixtureProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Delivery adapters. Real ones (aggregator first, then direct Grab) are added here;
        // the fixture provider exists for tests and local work only, never in production.
        $this->app->singleton(ProviderRegistry::class, fn ($app) => new ProviderRegistry(array_filter([
            $app->environment('production') ? null : $app->make(FixtureProvider::class),
        ])));
        $this->app->singleton(FixtureProvider::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Public pairing endpoint: codes are unguessable, but don't let anyone try.
        RateLimiter::for('pairing', fn (Request $r) => Limit::perMinute(config('pos.pairing_per_minute'))->by($r->ip()));
        // Platforms burst at lunch; this only stops floods from one source.
        RateLimiter::for('delivery-webhooks', fn (Request $r) => Limit::perMinute(600)->by($r->route('provider').'|'.$r->ip()));
    }
}

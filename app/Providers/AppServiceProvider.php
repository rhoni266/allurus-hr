<?php

namespace App\Providers;

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
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Public pairing endpoint: codes are unguessable, but don't let anyone try.
        RateLimiter::for('pairing', fn (Request $r) => Limit::perMinute(config('pos.pairing_per_minute'))->by($r->ip()));
    }
}

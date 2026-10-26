<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\{Artisan, Schedule};

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Delivery platforms: status retries, auto-reject, kitchen watchdog (app/Console/Commands/DeliveryTick.php).
Schedule::command('delivery:tick')->everyFifteenSeconds()->withoutOverlapping();

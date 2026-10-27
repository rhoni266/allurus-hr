<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

// signed link from `php artisan pos:dashboard-link <slug>` (no HQ users yet)
Route::get('/dashboard/{tenant}', \App\Http\Controllers\DashboardController::class)->whereUuid('tenant')->name('dashboard');

<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

// web till: a browser working as one paired terminal (TillController); online only
Route::controller(\App\Http\Controllers\TillController::class)->prefix('till')->group(function () {
    Route::get('/', 'show')->name('till');
    Route::post('pair', 'pair')->middleware('throttle:pairing');
    Route::post('login', 'login');
    Route::post('logout', 'logout');
    Route::post('forget', 'forget');
    Route::post('quote', 'quote');
    Route::post('checkout', 'checkout');
});

// signed link from `php artisan pos:dashboard-link <slug>` (no HQ users yet)
Route::get('/dashboard/{tenant}', \App\Http\Controllers\DashboardController::class)->whereUuid('tenant')->name('dashboard');

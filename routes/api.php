<?php

use App\Http\Controllers\Api\{SyncPullController, SyncPushController};
use App\Http\Middleware\ResolveTenant;
use Illuminate\Support\Facades\Route;

// Order matters: authenticate first, then derive the tenant from the token.
Route::prefix('v1')
    ->middleware(['auth:sanctum', 'abilities:pos:terminal', ResolveTenant::class])
    ->group(function () {
        Route::get('sync/pull', SyncPullController::class);
        Route::post('sync/push', SyncPushController::class);
    });

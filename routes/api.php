<?php

use App\Http\Controllers\Api\{DeviceRegisterController, PairingCodeController, StaffAuthController, SyncPullController, SyncPushController};
use App\Http\Middleware\ResolveTenant;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    // Public: a new device trades a one-time code for its token.
    Route::post('devices/register', DeviceRegisterController::class)->middleware('throttle:pairing');

    // Order matters: authenticate the device first, then derive the tenant from its token.
    Route::middleware(['auth:sanctum', 'abilities:pos:terminal', ResolveTenant::class])->group(function () {
        Route::get('sync/pull', SyncPullController::class);
        Route::post('sync/push', SyncPushController::class);

        Route::post('auth/login', [StaffAuthController::class, 'login']);

        Route::middleware('staff')->group(function () {
            Route::get('auth/me', [StaffAuthController::class, 'me']);
            Route::post('auth/logout', [StaffAuthController::class, 'logout']);
            Route::post('devices/pairing-codes', PairingCodeController::class)->middleware('staff:owner,manager');
        });
    });
});

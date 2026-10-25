<?php

use App\Http\Controllers\Api\{DeviceAdminController, DeviceRegisterController, DeviceSelfController, PairingCodeController, StaffAuthController, SyncPullController, SyncPushController};
use App\Http\Middleware\{EnsureDeviceActive, ResolveTenant};
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    // Public: a new device trades a one-time code for its token.
    Route::post('devices/register', DeviceRegisterController::class)->middleware('throttle:pairing');

    // Order matters: authenticate the device, derive the tenant from its token, then refuse
    // retired/revoked devices (with the tenant set, so their staff sessions can be revoked).
    Route::middleware(['auth:sanctum', 'abilities:pos:terminal', ResolveTenant::class, EnsureDeviceActive::class])->group(function () {
        Route::get('sync/pull', SyncPullController::class)->name('sync.pull');
        Route::post('sync/push', SyncPushController::class)->name('sync.push');

        Route::post('devices/wipe-confirm', [DeviceSelfController::class, 'wipeConfirm'])->name('devices.wipe-confirm');
        Route::post('devices/retired', [DeviceSelfController::class, 'retired'])->name('devices.retired');

        Route::post('auth/login', [StaffAuthController::class, 'login'])->name('auth.login');

        Route::middleware('staff')->group(function () {
            Route::get('auth/me', [StaffAuthController::class, 'me']);
            Route::post('auth/logout', [StaffAuthController::class, 'logout']);

            Route::middleware('staff:owner,manager')->group(function () {
                Route::post('devices/pairing-codes', PairingCodeController::class);
                Route::get('devices', [DeviceAdminController::class, 'index']);
                Route::post('devices/{id}/unpair', [DeviceAdminController::class, 'unpair'])->whereUuid('id');
            });
        });
    });
});

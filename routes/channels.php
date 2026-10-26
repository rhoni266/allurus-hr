<?php

use App\Models\Terminal;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\Broadcast;

/*
 * Private channels, authorised at POST /api/v1/broadcasting/auth with the device's own
 * token (bootstrap/app.php: auth:sanctum, ResolveTenant, EnsureDeviceActive). The tenant
 * and outlet come from the token, never from the request.
 */

// The kitchen doorbell (App\Kitchen\KitchenTicketChanged): any active device of that outlet.
Broadcast::channel('outlet.{outletId}.kitchen', function ($device, string $outletId) {
    return $device instanceof Terminal
        && $device->status === Terminal::ACTIVE
        && $device->tenant_id === TenantContext::id()
        && $device->outlet_id === $outletId;
});

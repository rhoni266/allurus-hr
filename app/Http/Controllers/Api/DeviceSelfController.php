<?php

namespace App\Http\Controllers\Api;

use App\Devices\DeviceLifecycle;
use Illuminate\Http\Request;

/** Calls a device makes about itself while being taken out of service. */
class DeviceSelfController
{
    /** POST devices/wipe-confirm — the device erased its local data. Its token dies here. */
    public function wipeConfirm(Request $request, DeviceLifecycle $lifecycle)
    {
        $lifecycle->confirmWipe($request->user());

        return response()->noContent();
    }

    /** POST devices/retired — a retiring device's outbox is empty; finish revoking it. */
    public function retired(Request $request, DeviceLifecycle $lifecycle)
    {
        $t = $lifecycle->finishRetire($request->user());

        return response()->json(['status' => $t->status]);
    }
}

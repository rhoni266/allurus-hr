<?php

namespace App\Http\Controllers\Api;

use App\Delivery\{DeliveryActionRefused, DeliveryOrderActions};
use App\Models\{DeliveryOrder, Staff, Terminal};
use Illuminate\Http\Request;

/**
 * A person on a terminal accepts or rejects a platform order that wasn't auto-accepted.
 * Any signed-in staff member may (it's the cashier's job at the pass); the order must be
 * at this terminal's outlet. Both need an Idempotency-Key.
 *
 *   POST delivery-orders/{id}/accept
 *   POST delivery-orders/{id}/reject   {reason}
 *
 * 200 {id, status, changed}; 409 {error: "delivery_order_not_pending", status} when it has
 * already gone the other way or the platform cancelled it.
 */
class DeliveryOrderController
{
    public function accept(Request $request, string $id, DeliveryOrderActions $actions)
    {
        return $this->act($request, $id, fn (DeliveryOrder $do, Staff $staff) => $actions->accept($do, $staff->id));
    }

    public function reject(Request $request, string $id, DeliveryOrderActions $actions)
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:255']]);

        return $this->act($request, $id, fn (DeliveryOrder $do, Staff $staff) => $actions->reject($do, $staff->id, $data['reason'], $request->user()->id, $staff->id));
    }

    private function act(Request $request, string $id, callable $fn)
    {
        /** @var Terminal $terminal */
        $terminal = $request->user();
        // TenantScope + RLS: another tenant's order isn't found; another outlet's is refused too
        $do = DeliveryOrder::where('id', $id)->where('outlet_id', $terminal->outlet_id)->first();
        if (! $do) {
            return response()->json(['error' => 'unknown_delivery_order'], 404);
        }

        try {
            $result = $fn($do, $request->attributes->get('staff'));
        } catch (DeliveryActionRefused $e) {
            return response()->json(['error' => 'delivery_order_not_pending', 'status' => $e->currentStatus], 409);
        }

        return response()->json(['id' => $do->id] + $result);
    }
}

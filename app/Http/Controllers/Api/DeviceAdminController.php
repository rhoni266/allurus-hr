<?php

namespace App\Http\Controllers\Api;

use App\Devices\DeviceLifecycle;
use App\Models\{Staff, Terminal};
use App\Tenancy\TenantContext;
use Illuminate\Http\Request;

/**
 * Device management by an owner or manager signed in on a paired terminal. Terminals are
 * not tenant-scoped (Sanctum resolves them before a tenant exists), so every query here
 * filters by tenant explicitly. Managers see and manage only their own outlet's devices.
 */
class DeviceAdminController
{
    public function index(Request $request)
    {
        return response()->json(['devices' => $this->visible($request)->orderBy('name')->get()->map(fn (Terminal $t) => [
            'id' => $t->id, 'name' => $t->name, 'outlet_id' => $t->outlet_id, 'status' => $t->status,
            'last_seen_at' => $t->last_seen_at?->toIso8601String(),
            'outbox_pending' => $t->outbox_pending,     // unsynced work a wipe would destroy
            'wipe_requested' => $t->wipe_requested_at !== null, 'wipe_confirmed' => $t->wipe_confirmed_at !== null,
            'this_device' => $t->id === $request->user()->id,
        ])]);
    }

    public function unpair(Request $request, string $id, DeviceLifecycle $lifecycle)
    {
        $data = $request->validate([
            'mode'   => ['required', 'in:retire,revoke'],
            'wipe'   => ['boolean'],
            'reason' => ['nullable', 'string', 'max:255'],
        ]);
        abort_if($data['mode'] === 'retire' && ($data['wipe'] ?? false), 422, 'A retiring device keeps its data until its backlog is synced; revoke to wipe.');

        $target = $this->visible($request)->whereKey($id)->first() ?? abort(404, 'Unknown device.');
        $staffId = $request->attributes->get('staff')->id;

        $t = $data['mode'] === 'retire'
            ? $lifecycle->retire($target, $staffId, $data['reason'] ?? null)
            : $lifecycle->revoke($target, (bool) ($data['wipe'] ?? false), $staffId, $data['reason'] ?? null);

        return response()->json(['id' => $t->id, 'status' => $t->status, 'wipe_requested' => $t->wipe_requested_at !== null]);
    }

    private function visible(Request $request)
    {
        /** @var Staff $staff */
        $staff = $request->attributes->get('staff');

        return Terminal::query()
            ->where('tenant_id', TenantContext::require())
            ->when($staff->role === 'manager' && $staff->outlet_id, fn ($q) => $q->where('outlet_id', $staff->outlet_id));
    }
}

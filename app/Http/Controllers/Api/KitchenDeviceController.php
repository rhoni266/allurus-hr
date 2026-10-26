<?php

namespace App\Http\Controllers\Api;

use App\Models\{Printer, PrintJob, Terminal};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * For KDS screens and print nodes (pos:kitchen), and terminals acting as a print bridge.
 *
 *   POST kitchen/heartbeat            {kds: bool, printers: [{id, status}]}  every ~20 s
 *   POST kitchen/print-jobs/{id}/ack  {result: printed|failed, error?}
 *
 * Print jobs reach the device through sync/pull (entity print_job); the device prints,
 * remembers the job id, then acks. Acks are idempotent, so a node that crashed between
 * printing and acking just acks again on restart.
 */
class KitchenDeviceController
{
    private const PRINTER_STATUSES = ['ok', 'paper_out', 'offline', 'error'];

    public function heartbeat(Request $request)
    {
        /** @var Terminal $device */
        $device = $request->user();
        $data = $request->validate([
            'kds'               => ['sometimes', 'boolean'],
            'printers'          => ['sometimes', 'array', 'max:32'],
            'printers.*.id'     => ['required', 'uuid'],
            'printers.*.status' => ['required', 'in:'.implode(',', self::PRINTER_STATUSES)],
        ]);

        // Only this outlet's printers count; their role comes from the server, not the device.
        $known = Printer::where('outlet_id', $device->outlet_id)->where('is_active', true)
            ->whereIn('id', array_column($data['printers'] ?? [], 'id'))->pluck('role', 'id');
        $printers = [];
        foreach ($data['printers'] ?? [] as $p) {
            if (isset($known[$p['id']])) {
                $printers[] = ['id' => $p['id'], 'status' => $p['status'], 'role' => $known[$p['id']]];
            }
        }

        $device->forceFill([
            'last_heartbeat_at' => now(), 'last_seen_at' => now(),
            'heartbeat' => ['kds' => (bool) ($data['kds'] ?? false), 'printers' => $printers],
        ])->save();

        return response()->json(['ok' => true, 'server_time' => now()->toIso8601String(), 'printers' => count($printers)]);
    }

    public function ack(Request $request, string $id)
    {
        /** @var Terminal $device */
        $device = $request->user();
        $data = $request->validate(['result' => ['required', 'in:printed,failed'], 'error' => ['nullable', 'string', 'max:500']]);

        return DB::transaction(function () use ($device, $data, $id) {
            \App\Tenancy\TenantContext::applyToTransaction();
            // TenantScope + RLS: another tenant's job isn't found; another outlet's is refused too
            $job = PrintJob::where('id', $id)->where('outlet_id', $device->outlet_id)->lockForUpdate()->first();
            if (! $job) {
                return response()->json(['error' => 'unknown_print_job'], 404);
            }
            if ($job->status === 'printed') {
                return response()->json(['id' => $job->id, 'status' => 'printed', 'duplicate' => true]);
            }

            $job->update($data['result'] === 'printed'
                ? ['status' => 'printed', 'printed_at' => now(), 'printed_by_device_id' => $device->id, 'attempts' => $job->attempts + 1, 'last_error' => null]
                : ['status' => 'failed', 'attempts' => $job->attempts + 1, 'last_error' => $data['error'] ?? null]);

            return response()->json(['id' => $job->id, 'status' => $job->status, 'duplicate' => false]);
        });
    }
}

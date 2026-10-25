<?php

namespace App\Http\Controllers\Api;

use App\Models\{OfflineSyncQueue, SyncConflict, Terminal};
use App\Sync\{DbErrors, DependencyMissing, MutationHandlerRegistry, MutationRejected, OfflineAuth, Outcome};
use Carbon\CarbonImmutable;
use App\Tenancy\TenantContext;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB, Log};
use Illuminate\Validation\ValidationException;

/**
 * Per-mutation statuses returned to the terminal:
 *   applied | conflict  -> stored; terminal marks acked
 *   rejected            -> stored; terminal holds it for manager review, carries on
 *   retry               -> NOT stored; terminal resends later with backoff. Transient DB
 *                          errors, server bugs, and mutations waiting for an order that
 *                          hasn't synced yet (result.waiting_for)
 */
class SyncPushController
{
    // Default Laravel name for unique(['terminal_id', 'client_seq']).
    private const QUEUE_UNIQUE = 'offline_sync_queues_terminal_id_client_seq_unique';

    public function __construct(private MutationHandlerRegistry $handlers) {}

    public function __invoke(Request $request)
    {
        $data = $request->validate([
            'mutations'                     => ['required', 'array', 'min:1', 'max:100'],
            'mutations.*.id'                => ['required', 'uuid'],
            'mutations.*.client_seq'        => ['required', 'integer', 'min:1'],
            'mutations.*.type'              => ['required', 'string', 'max:64'],
            'mutations.*.payload'           => ['required', 'array'],
            'mutations.*.client_created_at' => ['required', 'date'],
            'mutations.*.auth'              => ['nullable', 'array'],
            'mutations.*.auth.mode'         => ['required_with:mutations.*.auth', 'in:online,offline'],
            'mutations.*.auth.credential_id'=> ['required_if:mutations.*.auth.mode,offline', 'nullable', 'uuid'],
            'mutations.*.auth.signed_in_at' => ['required_if:mutations.*.auth.mode,offline', 'nullable', 'date'],
            'outbox_pending'                => ['nullable', 'integer', 'min:0'],   // shown in the device list
        ]);

        $terminal = $request->user();

        $results = collect($data['mutations'])
            ->sortBy('client_seq')
            ->map(fn (array $m) => $this->processOne($terminal, $m))
            ->values();

        // The device counts its outbox before sending, so this batch is included: subtract
        // what just settled, leaving what is still unsynced on the device right now.
        $pending = $terminal->outbox_pending;
        if (isset($data['outbox_pending'])) {
            $pending = max(0, $data['outbox_pending'] - $results->where('status', '!=', 'retry')->count());
        }
        $terminal->forceFill(['last_seen_at' => now(), 'outbox_pending' => $pending])->save();

        return response()->json(['results' => $results]);
    }

    private function processOne($terminal, array $m): array
    {
        // Idempotent replay: anything stored is final.
        if ($stored = $this->stored($terminal, $m)) {
            return $stored;
        }

        // A retiring device may sync its backlog, but nothing it did after the cutoff.
        // Device clock: a tampered clock could backdate; that's why stolen devices are
        // revoked (nothing accepted at all), not retired.
        if ($terminal->status === Terminal::RETIRING
            && CarbonImmutable::parse($m['client_created_at'])->gt($terminal->retire_requested_at)) {
            return $this->reject($terminal, $m, 'device_retired', ['cutoff' => $terminal->retire_requested_at->toIso8601String()]);
        }

        try {
            // attempts: 3 lets Laravel retry the whole closure on deadlock/serialization errors.
            return DB::transaction(function () use ($terminal, $m) {
                TenantContext::applyToTransaction();

                // Insert the queue row first: a concurrent duplicate push fails here
                // on the unique index instead of applying the mutation twice.
                $queue = OfflineSyncQueue::create([
                    'id'                => $m['id'],
                    'terminal_id'       => $terminal->id,
                    'client_seq'        => $m['client_seq'],
                    'type'              => $m['type'],
                    'payload'           => $m['payload'],
                    'status'            => 'applied',
                    'client_created_at' => $m['client_created_at'],
                ]);

                $outcome = $this->handlers->for($m['type'])->handle($terminal, $m['payload'], $queue);

                // Who authorised it offline, checked the same way for every mutation type.
                // Skipped for domain duplicates (already flagged when first applied).
                if (! isset($outcome->result['note']) && $auth = OfflineAuth::conflicts($terminal, $m)) {
                    foreach ($auth as $c) {
                        SyncConflict::create(['queue_id' => $queue->id, 'kind' => $c['kind'], 'detail' => $c['detail']]);
                    }
                    $kinds = array_values(array_unique([...($outcome->result['conflicts'] ?? []), ...array_column($auth, 'kind')]));
                    $outcome = Outcome::conflict(['conflicts' => $kinds] + $outcome->result);
                }

                $queue->update([
                    'status'       => $outcome->status,
                    'result'       => $outcome->result ?: null,
                    'processed_at' => now(),
                ]);

                return $this->ack($m, $outcome->status, $outcome->result ?: null);
            }, attempts: 3);
        } catch (UniqueConstraintViolationException $e) {
            if (str_contains($e->getMessage(), self::QUEUE_UNIQUE)) {
                // A concurrent retry of this mutation committed first; return its outcome.
                return $this->stored($terminal, $m) ?? $this->ack($m, 'retry', null);
            }
            // Any other unique violation (e.g. duplicate item id) is a bad payload.
            return $this->reject($terminal, $m, 'duplicate_key', ['message' => $this->short($e)]);
        } catch (DependencyMissing $e) {
            // e.g. a void for an order another, still-offline terminal rang up: wait for it,
            // but not forever (device clock, so skew only shifts the deadline)
            if (CarbonImmutable::parse($m['client_created_at'])->lt(now()->subHours(DependencyMissing::WAIT_HOURS))) {
                return $this->reject($terminal, $m, 'dependency_missing', ['entity' => $e->entity, 'id' => $e->id]);
            }
            return $this->ack($m, 'retry', ['waiting_for' => ['entity' => $e->entity, 'id' => $e->id]]);
        } catch (MutationRejected $e) {
            return $this->reject($terminal, $m, $e->reason, $e->detail);
        } catch (ValidationException $e) {
            return $this->reject($terminal, $m, 'invalid_payload', $e->errors());
        } catch (\Throwable $e) {
            if (DbErrors::isTransient($e)) {
                Log::warning('sync.push.transient', ['mutation' => $m['id'], 'error' => $this->short($e)]);
                return $this->ack($m, 'retry', null);
            }

            // Unknown server error: don't permanently reject a sale for our own bug.
            // Log loudly and let the terminal retry; fixing the bug drains the backlog.
            Log::error('sync.push.failed', ['mutation' => $m['id'], 'type' => $m['type'], 'error' => $e->getMessage()]);
            return $this->ack($m, 'retry', ['error' => 'server_error']);
        }
    }

    private function stored($terminal, array $m): ?array
    {
        $q = OfflineSyncQueue::where('terminal_id', $terminal->id)
            ->where('client_seq', $m['client_seq'])
            ->first();

        if (! $q) {
            return null;
        }

        // Same client_seq with a different mutation id means the terminal's outbox is corrupt.
        if ($q->id !== $m['id']) {
            return $this->ack($m, 'rejected', ['error' => 'client_seq_reused', 'stored_id' => $q->id]);
        }

        return $this->ack($m, $q->status, $q->result);
    }

    private function reject($terminal, array $m, string $reason, array $detail): array
    {
        $result = ['error' => $reason, 'detail' => $detail];

        DB::transaction(function () use ($terminal, $m, $result) {
            TenantContext::applyToTransaction();

            OfflineSyncQueue::query()->insertOrIgnore([
                'id'                => $m['id'],
                'tenant_id'         => TenantContext::require(),
                'terminal_id'       => $terminal->id,
                'client_seq'        => $m['client_seq'],
                'type'              => $m['type'],
                'payload'           => json_encode($m['payload']),
                'status'            => 'rejected',
                'result'            => json_encode($result),
                'client_created_at' => $m['client_created_at'],
                'processed_at'      => now(),
            ]);
        });

        // If a concurrent push stored an outcome first, that one wins.
        return $this->stored($terminal, $m) ?? $this->ack($m, 'rejected', $result);
    }

    private function ack(array $m, string $status, ?array $result): array
    {
        return ['id' => $m['id'], 'client_seq' => $m['client_seq'], 'status' => $status, 'result' => $result];
    }

    private function short(\Throwable $e): string
    {
        return mb_substr($e->getMessage(), 0, 300);
    }
}

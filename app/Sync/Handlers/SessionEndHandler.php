<?php

namespace App\Sync\Handlers;

use App\Billing\{PricingException, TimeBilling};
use App\Models\{OfflineSyncQueue, TimeSession};
use App\Sync\{Facts, MutationHandler, MutationRejected, Outcome};
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;

/**
 * session.end — a finished timed session (snooker table, karaoke room) with its whole
 * timeline and the rate snapshot frozen at start, so a central rate change never alters
 * a session that was already running.
 *
 * The server recomputes the charge with TimeBilling. The terminal's amount stands (the
 * customer paid it); a difference is flagged `session_amount_mismatch` for audit.
 */
class SessionEndHandler implements MutationHandler
{
    public function handle($terminal, array $p, OfflineSyncQueue $queue): Outcome
    {
        Validator::make($p, [
            'session_id'     => ['required', 'uuid'],
            'resource_id'    => ['required', 'uuid'],
            'variant_id'     => ['nullable', 'uuid'],
            'order_id'       => ['nullable', 'uuid'],
            'staff_id'       => ['required', 'uuid'],
            'started_at'     => ['required', 'date'],
            'ended_at'       => ['required', 'date'],
            'paused_seconds' => ['required', 'integer', 'min:0'],
            'rate_snapshot'  => ['required', 'array'],
            'billed_minutes' => ['required', 'integer', 'min:0'],
            'amount_sen'     => ['required', 'integer', 'min:0'],
            'spec_version'   => ['required', 'integer'],
        ])->validate();

        if (TimeSession::whereKey($p['session_id'])->exists()) {
            return Outcome::applied(['session_id' => $p['session_id'], 'note' => 'already_exists']);
        }

        $start = CarbonImmutable::parse($p['started_at'])->utc();
        $end = CarbonImmutable::parse($p['ended_at'])->utc();
        try {
            $server = TimeBilling::charge($p['rate_snapshot'], TimeBilling::elapsedSeconds($start, $end), $p['paused_seconds']);
        } catch (PricingException $e) {
            // an impossible timeline or a malformed rate is a terminal bug, not a sale to keep
            throw new MutationRejected($e->reason, ['message' => $e->getMessage()]);
        }

        TimeSession::create([
            'id' => $p['session_id'], 'outlet_id' => $terminal->outlet_id, 'terminal_id' => $terminal->id,
            'resource_id' => $p['resource_id'], 'variant_id' => $p['variant_id'] ?? null, 'order_id' => $p['order_id'] ?? null,
            'staff_id' => $p['staff_id'], 'started_at' => $start, 'ended_at' => $end, 'paused_seconds' => $p['paused_seconds'],
            'rate_snapshot' => $p['rate_snapshot'], 'billed_minutes' => $p['billed_minutes'], 'amount_sen' => $p['amount_sen'],
            'server_amount_sen' => $server['amount_sen'], 'spec_version' => $p['spec_version'],
        ]);

        $conflicts = Facts::staffConflicts($p['staff_id'], [], 'session');
        if ($server['amount_sen'] !== $p['amount_sen'] || $server['billed_minutes'] !== $p['billed_minutes']) {
            $conflicts[] = ['kind' => 'session_amount_mismatch', 'detail' => [
                'session_id' => $p['session_id'],
                'charged_sen' => $p['amount_sen'], 'server_sen' => $server['amount_sen'],
                'charged_minutes' => $p['billed_minutes'], 'server_minutes' => $server['billed_minutes'],
                'terminal_spec_version' => $p['spec_version'], 'server_spec_version' => TimeBilling::SPEC_VERSION,
            ]];
        }

        return Facts::outcome($queue, $conflicts, ['session_id' => $p['session_id'], 'amount_sen' => $p['amount_sen']]);
    }
}

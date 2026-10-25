<?php

namespace App\Devices;

use App\Models\{StaffSession, Terminal};
use Illuminate\Support\Facades\DB;

/**
 * Taking a device out of service. Two different needs:
 *
 *  retire  — decommissioning / replacing a tablet. Its outbox may still hold real sales,
 *            so it may keep pushing mutations made BEFORE the retire for RETIRE_GRACE_HOURS
 *            (anything later is rejected `device_retired`); pull, sign-in and everything
 *            else are refused. It becomes revoked when it reports its outbox is empty, or
 *            when the grace period runs out.
 *
 *  revoke  — lost or stolen. Refused immediately, everything. With $wipe, every refusal
 *            tells the device to erase its local data; it confirms, and only then are its
 *            tokens deleted. Unsynced sales on a wiped device are lost: that is the price
 *            of a wipe, which is why the device list shows each device's outbox_pending.
 *
 * Tokens are deliberately kept until then: with the token gone, the device would only get
 * a bare 401 and could never learn that it should wipe.
 */
final class DeviceLifecycle
{
    public const RETIRE_GRACE_HOURS = 72;

    public function retire(Terminal $t, ?string $staffId, ?string $reason): Terminal
    {
        if ($t->status !== Terminal::ACTIVE) {
            return $t;   // retiring stays retiring; revoked can't go back to retiring
        }

        return $this->apply($t, [
            'status' => Terminal::RETIRING, 'retire_requested_at' => now(),
            'revoked_by_staff_id' => $staffId, 'revoke_reason' => $reason,
        ]);
    }

    public function revoke(Terminal $t, bool $wipe, ?string $staffId, ?string $reason): Terminal
    {
        return $this->apply($t, [
            'status' => Terminal::REVOKED, 'revoked_at' => $t->revoked_at ?? now(),
            'wipe_requested_at' => $wipe ? ($t->wipe_requested_at ?? now()) : $t->wipe_requested_at,
            'revoked_by_staff_id' => $staffId, 'revoke_reason' => $reason ?? $t->revoke_reason,
        ]);
    }

    /** The retiring device says its outbox is empty. */
    public function finishRetire(Terminal $t): Terminal
    {
        return $t->status === Terminal::RETIRING ? $this->apply($t, ['status' => Terminal::REVOKED, 'revoked_at' => now()]) : $t;
    }

    /** The device erased its local data; now its credentials can die. */
    public function confirmWipe(Terminal $t): void
    {
        DB::transaction(function () use ($t) {
            $t->forceFill(['wipe_confirmed_at' => now()])->save();
            $t->tokens()->delete();
        });
    }

    /** Lazily applied on each request: a retiring device past its grace period is revoked. */
    public function expireIfDue(Terminal $t): Terminal
    {
        if ($t->status === Terminal::RETIRING && $t->retire_requested_at->lt(now()->subHours(self::RETIRE_GRACE_HOURS))) {
            return $this->apply($t, ['status' => Terminal::REVOKED, 'revoked_at' => now()]);
        }

        return $t;
    }

    private function apply(Terminal $t, array $fields): Terminal
    {
        return DB::transaction(function () use ($t, $fields) {
            $t->forceFill($fields)->save();
            // nobody stays signed in on a device that is going away
            StaffSession::where('terminal_id', $t->id)->whereNull('revoked_at')->update(['revoked_at' => now()]);

            return $t;
        });
    }
}

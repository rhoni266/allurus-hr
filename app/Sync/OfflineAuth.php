<?php

namespace App\Sync;

use App\Models\{StaffCredential, Terminal};
use Carbon\CarbonImmutable;

/**
 * Checks the `auth` a terminal attaches to each mutation (docs/offline-pin-signin.md, C):
 *
 *   {"mode": "online"}                                       signed in with the server
 *   {"mode": "offline", "credential_id": ..., "signed_in_at": ...}
 *
 * Offline actions are never refused (rule 4); these only produce flags for HQ:
 *   offline_credential_unknown  no such credential for this staff member on this terminal
 *   offline_credential_stale    the offline sign-in happened after the credential expired or
 *                               was revoked (staff deactivated, PIN changed)
 *   offline_manager_action      a void or stock correction authorised offline (decision 3:
 *                               allowed, always flagged for review)
 */
final class OfflineAuth
{
    /** @return list<array{kind:string,detail:array}> */
    public static function conflicts(Terminal $terminal, array $m): array
    {
        $auth = $m['auth'] ?? null;
        if (($auth['mode'] ?? 'online') !== 'offline') {
            return [];
        }

        $p = $m['payload'];
        $actor = $p['staff_id'] ?? $p['order']['staff_id'] ?? null;
        $signedIn = CarbonImmutable::parse($auth['signed_in_at'])->utc();
        $conflicts = [];

        $cred = StaffCredential::find($auth['credential_id']);   // TenantScope + RLS
        if (! $cred || $cred->terminal_id !== $terminal->id || $cred->staff_id !== $actor) {
            $conflicts[] = ['kind' => 'offline_credential_unknown', 'detail' => ['credential_id' => $auth['credential_id'], 'staff_id' => $actor]];
        } elseif (! $cred->validAt($signedIn)) {
            $conflicts[] = ['kind' => 'offline_credential_stale', 'detail' => [
                'credential_id' => $cred->id, 'staff_id' => $actor, 'signed_in_at' => $signedIn->toIso8601String(),
                'why' => $cred->revoked_at !== null && $signedIn->gte($cred->revoked_at) ? ($cred->revoke_reason ?? 'revoked') : 'expired',
            ]];
        }

        $managerAction = in_array($m['type'], ['order.void', 'order.refund', 'stock.count'], true)
            || ($m['type'] === 'stock.adjust' && ($p['reason'] ?? null) !== 'waste');
        if ($managerAction) {
            $conflicts[] = ['kind' => 'offline_manager_action', 'detail' => ['type' => $m['type'], 'staff_id' => $actor]];
        }

        return $conflicts;
    }
}

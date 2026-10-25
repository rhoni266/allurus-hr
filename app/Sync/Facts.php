<?php

namespace App\Sync;

use App\Models\{OfflineSyncQueue, Order, Staff, SyncConflict};
use Illuminate\Support\Facades\DB;

/** Lookups shared by mutation handlers. */
final class Facts
{
    /**
     * The order, row-locked. Uses order_ids for its occurred_at so Postgres touches one
     * partition instead of all of them.
     *
     * @throws DependencyMissing if the order hasn't been synced (yet)
     */
    public static function order(string $orderId): Order
    {
        $at = DB::table('order_ids')->where('id', $orderId)->value('occurred_at')
            ?? throw new DependencyMissing('order', $orderId);

        return Order::where('id', $orderId)->where('occurred_at', $at)->lockForUpdate()->firstOrFail();
    }

    /**
     * Conflicts (never rejections) for an action done by $staffId offline: unknown or
     * inactive staff, or a role not in $roles. Empty $roles = any active staff.
     *
     * @return list<array{kind:string,detail:array}>
     */
    public static function staffConflicts(?string $staffId, array $roles, string $action): array
    {
        $staff = $staffId ? Staff::find($staffId) : null;
        if (! $staff || ! $staff->is_active) {
            return [['kind' => 'unknown_staff', 'detail' => ['staff_id' => $staffId, 'action' => $action]]];
        }
        if ($roles && ! in_array($staff->role, $roles, true)) {
            return [['kind' => "unauthorized_{$action}", 'detail' => ['staff_id' => $staffId, 'role' => $staff->role]]];
        }

        return [];
    }

    /** Store the conflicts against the queue row and return applied / conflict. */
    public static function outcome(OfflineSyncQueue $queue, array $conflicts, array $result): Outcome
    {
        foreach ($conflicts as $c) {
            SyncConflict::create(['queue_id' => $queue->id, 'kind' => $c['kind'], 'detail' => $c['detail']]);
        }
        $result['conflicts'] = array_values(array_unique(array_column($conflicts, 'kind')));

        return $conflicts ? Outcome::conflict($result) : Outcome::applied($result);
    }
}

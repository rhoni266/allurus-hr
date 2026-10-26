<?php

namespace App\Kitchen;

use App\Database\Timestamps;
use App\Models\Terminal;

/**
 * Is anyone in this outlet's kitchen able to see a new ticket right now? True when an
 * active device there heartbeat recently and reported a live KDS screen or a kitchen
 * printer that's ok (not out of paper, not offline). Auto-accept depends on this: an
 * order accepted into a kitchen nobody is watching is a promise nobody keeps.
 */
final class KitchenPresence
{
    public static function isListening(string $tenantId, string $outletId): bool
    {
        $since = now()->subSeconds(config('pos.kitchen.presence_seconds'))->format(Timestamps::FORMAT);

        return Terminal::where('tenant_id', $tenantId)->where('outlet_id', $outletId)
            ->where('status', Terminal::ACTIVE)
            ->where('last_heartbeat_at', '>=', $since)
            ->where(fn ($q) => $q->whereRaw("(heartbeat->>'kds')::boolean IS TRUE")
                // bound, not inline: '?' inside SQL would be taken for a placeholder
                ->orWhereRaw('jsonb_path_exists(heartbeat, ?::jsonpath)', ['$.printers[*] ? (@.status == "ok" && @.role == "kitchen")']))
            ->exists();
    }
}

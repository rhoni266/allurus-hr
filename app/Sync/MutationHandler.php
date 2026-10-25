<?php

namespace App\Sync;

use App\Models\OfflineSyncQueue;

interface MutationHandler
{
    /**
     * Runs inside the push transaction. Throw MutationRejected for a permanent,
     * business-level failure; any DB error bubbles up and is classified by the caller.
     */
    public function handle($terminal, array $payload, OfflineSyncQueue $queue): Outcome;
}

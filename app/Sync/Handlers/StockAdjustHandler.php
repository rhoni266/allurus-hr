<?php

namespace App\Sync\Handlers;

use App\Models\{OfflineSyncQueue, ProductVariant, StockMovement};
use App\Sync\{Facts, MutationHandler, MutationRejected, Outcome, StockLedger};
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;

/**
 * stock.adjust — a signed delta, never an absolute count (rule 5): other terminals keep
 * selling the same item, so only the server knows the real on-hand figure. A stocktake
 * count therefore has to become a delta on the server; that's a separate mutation, not this.
 *
 * Waste can be logged by any staff; corrections and transfers need an owner or manager
 * (flagged, not refused, when done offline by someone else). The adjustment id is also the
 * movement id, which makes it idempotent at the domain level.
 */
class StockAdjustHandler implements MutationHandler
{
    public const REASONS = ['adjust', 'waste', 'transfer_in', 'transfer_out'];
    public const ROLES = ['owner', 'manager'];

    public function handle($terminal, array $p, OfflineSyncQueue $queue): Outcome
    {
        Validator::make($p, [
            'adjustment_id' => ['required', 'uuid'],
            'variant_id'    => ['required', 'uuid'],
            'delta_milli'   => ['required', 'integer', 'not_in:0'],
            'reason'        => ['required', 'in:'.implode(',', self::REASONS)],
            'staff_id'      => ['required', 'uuid'],
            'note'          => ['nullable', 'string', 'max:255'],
            'occurred_at'   => ['required', 'date'],
        ])->validate();
        if (! is_int($p['delta_milli'])) {
            throw new MutationRejected('invalid_qty', ['delta_milli' => $p['delta_milli']]);
        }
        $direction = match ($p['reason']) { 'waste', 'transfer_out' => -1, 'transfer_in' => 1, default => 0 };
        if ($direction !== 0 && $p['delta_milli'] * $direction < 0) {
            throw new MutationRejected('invalid_qty', ['reason' => $p['reason'], 'delta_milli' => $p['delta_milli']]);
        }

        // TenantScope: a variant from another tenant isn't found -> can't be attributed
        $variant = ProductVariant::withTrashed()->find($p['variant_id'])
            ?? throw new MutationRejected('unknown_variant', ['variant_id' => $p['variant_id']]);

        if (StockMovement::whereKey($p['adjustment_id'])->exists()) {
            return Outcome::applied(['adjustment_id' => $p['adjustment_id'], 'note' => 'already_exists']);
        }

        $conflicts = StockLedger::move(
            TenantContext::require(), $terminal->outlet_id, [$variant->id => $p['delta_milli']], $p['reason'], null,
            CarbonImmutable::parse($p['occurred_at'])->utc(), [$variant->id => $p['adjustment_id']],
        );
        if ($variant->trashed()) {
            $conflicts[] = ['kind' => 'product_deleted', 'detail' => ['variant_id' => $variant->id]];
        }
        $conflicts = array_merge($conflicts, Facts::staffConflicts($p['staff_id'], $p['reason'] === 'waste' ? [] : self::ROLES, 'adjustment'));

        return Facts::outcome($queue, $conflicts, ['adjustment_id' => $p['adjustment_id']]);
    }
}

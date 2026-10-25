<?php

namespace App\Sync\Handlers;

use App\Models\{OfflineSyncQueue, ProductVariant, StockCount, StockCountLine};
use App\Sync\{Facts, MutationHandler, MutationRejected, Outcome, StockLedger};
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;
use Ramsey\Uuid\Uuid;

/**
 * stock.count — a stocktake: "at counted_at, this outlet physically had exactly N".
 *
 * The terminal sends counts, never deltas: it can't know what other terminals sold.
 * The server turns each count into a 'stocktake' movement of counted − expected, where
 * expected is the stock as the books stood at counted_at (StockLedger::onHandAt). The
 * count then anchors the item: any movement dated before counted_at that syncs later is
 * already in the physical count, and StockLedger cancels it.
 *
 * Counting needs an owner or manager (flagged, not refused, otherwise).
 */
class StockCountHandler implements MutationHandler
{
    public const ROLES = ['owner', 'manager'];

    public function handle($terminal, array $p, OfflineSyncQueue $queue): Outcome
    {
        Validator::make($p, [
            'count_id'               => ['required', 'uuid'],
            'staff_id'               => ['required', 'uuid'],
            'counted_at'             => ['required', 'date'],
            'lines'                  => ['required', 'array', 'min:1'],
            'lines.*.variant_id'     => ['required', 'uuid', 'distinct'],
            'lines.*.counted_milli'  => ['required', 'integer', 'min:0'],
        ])->validate();
        foreach ($p['lines'] as $l) {
            if (! is_int($l['counted_milli'])) {
                throw new MutationRejected('invalid_qty', ['variant_id' => $l['variant_id']]);
            }
        }

        if (StockCount::whereKey($p['count_id'])->exists()) {
            return Outcome::applied(['count_id' => $p['count_id'], 'note' => 'already_exists']);
        }

        $at = CarbonImmutable::parse($p['counted_at'])->utc();
        $outlet = $terminal->outlet_id;
        $variantIds = array_column($p['lines'], 'variant_id');
        $known = ProductVariant::withTrashed()->whereIn('id', $variantIds)->pluck('id')->all();   // TenantScope
        if ($unknown = array_diff($variantIds, $known)) {
            throw new MutationRejected('unknown_variant', ['variant_ids' => array_values($unknown)]);
        }

        StockLedger::lock($outlet, $variantIds);   // nobody moves these items until we commit

        StockCount::create(['id' => $p['count_id'], 'outlet_id' => $outlet, 'terminal_id' => $terminal->id,
            'staff_id' => $p['staff_id'], 'counted_at' => $at]);

        $deltas = [];
        $lines = [];
        foreach ($p['lines'] as $l) {
            $expected = StockLedger::onHandAt($outlet, $l['variant_id'], $at);
            $delta = $l['counted_milli'] - $expected;
            StockCountLine::create(['count_id' => $p['count_id'], 'outlet_id' => $outlet, 'variant_id' => $l['variant_id'],
                'counted_milli' => $l['counted_milli'], 'expected_milli' => $expected, 'delta_milli' => $delta, 'counted_at' => $at]);
            $deltas[$l['variant_id']] = $delta;
            $lines[] = ['variant_id' => $l['variant_id'], 'expected_milli' => $expected, 'delta_milli' => $delta];
        }

        // one stocktake movement per item, dated at the count, with a stable id per (count, item)
        $ids = array_map(fn ($vid) => Uuid::uuid5(Uuid::NAMESPACE_URL, "stock.count:{$p['count_id']}:{$vid}")->toString(),
            array_combine(array_keys($deltas), array_keys($deltas)));
        $conflicts = StockLedger::move(TenantContext::require(), $outlet, $deltas, 'stocktake', $p['count_id'], $at, $ids);

        return Facts::outcome($queue, array_merge($conflicts, Facts::staffConflicts($p['staff_id'], self::ROLES, 'stocktake')),
            ['count_id' => $p['count_id'], 'lines' => $lines]);
    }
}

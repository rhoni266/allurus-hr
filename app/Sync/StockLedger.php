<?php

namespace App\Sync;

use App\Database\Timestamps;
use App\Models\{StockCountLine, StockMovement};
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * The only way stock changes: append signed milli-unit movements to the ledger and
 * upsert the stock_levels projection in the same transaction (CLAUDE.md rule 5).
 * Negative stock is allowed and reported back as conflicts, never refused.
 *
 * Stocktakes: a count at T is the truth at T. A movement dated before T that only syncs
 * after the count was applied (an offline terminal's sale) is already reflected in the
 * physical count, so it is recorded and immediately cancelled with a `count_absorbed`
 * movement; on-hand is unchanged. Every writer locks each (outlet, variant) it touches,
 * in a fixed order, so a count and a late sale can't interleave.
 */
final class StockLedger
{
    /**
     * @param array<string,int> $deltas variant_id => signed qty_milli
     * @param array<string,string> $movementIds optional variant_id => movement id (for domain idempotency)
     * @return list<array{kind:string,detail:array}> negative_stock conflicts
     */
    public static function move(string $tenantId, string $outletId, array $deltas, string $reason, ?string $refId,
        CarbonInterface $occurredAt, array $movementIds = []): array
    {
        $deltas = array_filter($deltas, fn (int $d) => $d !== 0);
        if (! $deltas) {
            return [];
        }
        ksort($deltas);
        self::lock($outletId, array_keys($deltas));

        // already in a count taken after this movement happened?
        $absorbed = $reason === 'stocktake' ? [] : array_flip(StockCountLine::query()
            ->where('outlet_id', $outletId)->whereIn('variant_id', array_keys($deltas))
            ->where('counted_at', '>', $occurredAt->format(Timestamps::FORMAT))->distinct()->pluck('variant_id')->all());

        foreach ($deltas as $variantId => $delta) {
            StockMovement::create(array_filter([
                'id' => $movementIds[$variantId] ?? null,
                'outlet_id' => $outletId, 'variant_id' => $variantId, 'reason' => $reason,
                'qty_delta_milli' => $delta, 'ref_id' => $refId, 'occurred_at' => $occurredAt,
            ], fn ($v) => $v !== null));

            if (isset($absorbed[$variantId])) {
                StockMovement::create([
                    'outlet_id' => $outletId, 'variant_id' => $variantId, 'reason' => 'count_absorbed',
                    'qty_delta_milli' => -$delta, 'ref_id' => $refId, 'occurred_at' => $occurredAt,
                ]);
            }
        }

        $applied = array_diff_key($deltas, $absorbed);
        if (! $applied) {
            return [];
        }

        DB::table('stock_levels')->upsert(
            array_map(fn ($vid, $d) => ['tenant_id' => $tenantId, 'outlet_id' => $outletId, 'variant_id' => $vid, 'on_hand_milli' => $d],
                array_keys($applied), $applied),
            ['outlet_id', 'variant_id'],
            ['on_hand_milli' => DB::raw('stock_levels.on_hand_milli + excluded.on_hand_milli')],
        );

        // only report a variant this movement took (or kept) below zero
        return DB::table('stock_levels')
            ->where('outlet_id', $outletId)
            ->whereIn('variant_id', array_keys(array_filter($applied, fn ($d) => $d < 0)))
            ->where('on_hand_milli', '<', 0)
            ->get(['variant_id', 'on_hand_milli'])
            ->map(fn ($r) => ['kind' => 'negative_stock', 'detail' => ['variant_id' => $r->variant_id, 'on_hand_milli' => (int) $r->on_hand_milli]])
            ->all();
    }

    /** What the books said at $at: on-hand now, minus every movement dated after $at. */
    public static function onHandAt(string $outletId, string $variantId, CarbonInterface $at): int
    {
        $now = (int) DB::table('stock_levels')->where('outlet_id', $outletId)->where('variant_id', $variantId)->value('on_hand_milli');
        $since = (int) StockMovement::where('outlet_id', $outletId)->where('variant_id', $variantId)
            ->where('occurred_at', '>', $at->format(Timestamps::FORMAT))->sum('qty_delta_milli');   // full precision binding

        return $now - $since;
    }

    /** Transaction-scoped locks on (outlet, variant), always taken in sorted order. */
    public static function lock(string $outletId, array $variantIds): void
    {
        sort($variantIds);
        foreach ($variantIds as $vid) {
            DB::statement('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ["stock:{$outletId}:{$vid}"]);
        }
    }
}

<?php

namespace App\Sync;

use App\Models\StockMovement;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * The only way stock changes: append signed milli-unit movements to the ledger and
 * upsert the stock_levels projection in the same transaction (CLAUDE.md rule 5).
 * Negative stock is allowed and reported back as conflicts, never refused.
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
        ksort($deltas);   // lock rows in a fixed order so concurrent writers can't deadlock

        foreach ($deltas as $variantId => $delta) {
            StockMovement::create(array_filter([
                'id' => $movementIds[$variantId] ?? null,
                'outlet_id' => $outletId, 'variant_id' => $variantId, 'reason' => $reason,
                'qty_delta_milli' => $delta, 'ref_id' => $refId, 'occurred_at' => $occurredAt,
            ], fn ($v) => $v !== null));
        }

        DB::table('stock_levels')->upsert(
            array_map(fn ($vid, $d) => ['tenant_id' => $tenantId, 'outlet_id' => $outletId, 'variant_id' => $vid, 'on_hand_milli' => $d],
                array_keys($deltas), $deltas),
            ['outlet_id', 'variant_id'],
            ['on_hand_milli' => DB::raw('stock_levels.on_hand_milli + excluded.on_hand_milli')],
        );

        // only report a variant this movement took (or kept) below zero
        return DB::table('stock_levels')
            ->where('outlet_id', $outletId)
            ->whereIn('variant_id', array_keys(array_filter($deltas, fn ($d) => $d < 0)))
            ->where('on_hand_milli', '<', 0)
            ->get(['variant_id', 'on_hand_milli'])
            ->map(fn ($r) => ['kind' => 'negative_stock', 'detail' => ['variant_id' => $r->variant_id, 'on_hand_milli' => (int) $r->on_hand_milli]])
            ->all();
    }
}

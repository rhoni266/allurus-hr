<?php

namespace App\Http\Controllers\Api;

use App\Models\{Modifier, PriceOverride, Product, ProductVariant, Staff, SyncChange};
use App\Tenancy\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SyncPullController
{
    private const ENTITIES = [
        'product'        => Product::class,
        'variant'        => ProductVariant::class,
        'price_override' => PriceOverride::class,
        'modifier'       => Modifier::class,
        'staff'          => Staff::class,     // for the login screen; pin_hash is $hidden, never sent
    ];

    public function __invoke(Request $request)
    {
        $terminal = $request->user();
        $tenantId = TenantContext::require();
        $cursor   = max(0, (int) $request->integer('cursor', 0));
        $limit    = max(1, min((int) $request->integer('limit', 500), 1000));

        // Per-tenant prune watermark, not a global min(seq): other tenants' rows create gaps.
        $prunedThrough = (int) DB::table('sync_watermarks')
            ->where('tenant_id', $tenantId)
            ->value('pruned_through_seq');

        if ($cursor < $prunedThrough) {
            return response()->json(['full_resync_required' => true]);
        }

        // SyncChange carries TenantScope, so this is tenant-filtered.
        $changes = SyncChange::query()
            ->where('seq', '>', $cursor)
            ->where(fn ($q) => $q->whereNull('outlet_id')->orWhere('outlet_id', $terminal->outlet_id))
            ->orderBy('seq')
            ->limit($limit + 1)
            ->get();

        $hasMore = $changes->count() > $limit;
        $changes = $changes->take($limit)->values();

        // Hydrate upserts in bulk per entity (no N+1).
        $models = [];
        foreach ($changes->where('op', 'upsert')->groupBy('entity') as $entity => $rows) {
            $class = self::ENTITIES[$entity] ?? null;
            if ($class) {
                $models[$entity] = $class::whereIn('id', $rows->pluck('entity_id')->unique())->get()->keyBy('id');
            }
        }

        // Emit in seq order so parents and children apply in the order they changed.
        $payload = [];
        foreach ($changes as $row) {
            if (! isset(self::ENTITIES[$row->entity])) {
                continue;
            }
            $data = $row->op === 'upsert' ? ($models[$row->entity][$row->entity_id] ?? null) : null;

            $payload[] = [
                'seq'         => $row->seq,
                'entity'      => $row->entity,
                'id'          => $row->entity_id,
                // Upsert whose row has since been (soft-)deleted: send a tombstone.
                'op'          => $row->op === 'upsert' && $data === null ? 'delete' : $row->op,
                'row_version' => $row->row_version,
                'data'        => $data,
            ];
        }

        return response()->json([
            'changes'     => $payload,
            // Cursor advances over skipped (unknown-entity) rows too.
            'next_cursor' => $changes->last()?->seq ?? $cursor,
            'has_more'    => $hasMore,
        ]);
    }
}

<?php

namespace App\Simulator\Server;

use App\Simulator\{LocalStore, World};
use Illuminate\Support\Facades\DB;

/**
 * Invariants that must hold after any chaos run, comparing terminal SQLite files with Postgres.
 * Each check returns [name, ok, detail].
 */
final class Verifier
{
    private array $checks = [];

    /** @param array<string, LocalStore> $stores terminal name => store */
    public function __construct(private World $world, private array $stores)
    {
        Hq::enter($world->tenantId);
    }

    public function checks(): array
    {
        return $this->checks;
    }

    public function passed(): bool
    {
        return collect($this->checks)->every(fn ($c) => $c[1]);
    }

    public function check(string $name, bool $ok, string $detail = ''): self
    {
        $this->checks[] = [$name, $ok, $detail];
        return $this;
    }

    /** The full ledger check: every local sale on the server exactly once, money and stock exact. */
    public function salesLedger(int $expectedRejected = 0): self
    {
        $localOrders = [];
        $localTotal = 0;
        $soldQty = [];
        $localQtyMilli = 0;
        $movementLines = 0;
        $outboxTotal = 0;
        $stuck = 0;
        $rejected = 0;

        foreach ($this->stores as $store) {
            foreach ($store->all('SELECT id, total_sen FROM orders') as $o) {
                $localOrders[$o['id']] = true;
                $localTotal += (int) $o['total_sen'];
            }
            foreach ($store->all('SELECT order_id, variant_id, SUM(qty_milli) q FROM order_items GROUP BY order_id, variant_id') as $l) {
                $soldQty[$l['variant_id']] = ($soldQty[$l['variant_id']] ?? 0) + (int) $l['q'];
                $movementLines++;
            }
            $localQtyMilli += (int) $store->scalar('SELECT COALESCE(SUM(qty_milli), 0) FROM order_items');
            $outboxTotal += (int) $store->scalar('SELECT COUNT(*) FROM outbox');
            $stuck += (int) $store->scalar("SELECT COUNT(*) FROM outbox WHERE status IN ('pending','sent')");
            $rejected += (int) $store->scalar("SELECT COUNT(*) FROM outbox WHERE status = 'rejected'");
            // atomicity: no local sale without its outbox row (and vice versa)
            $orphans = (int) $store->scalar("SELECT COUNT(*) FROM orders o WHERE NOT EXISTS (SELECT 1 FROM outbox x WHERE x.type = 'order.create' AND json_extract(x.payload, '$.order.id') = o.id)");
            $this->check("local atomicity [{$store->path}]", $orphans === 0, "{$orphans} orders without outbox row");
        }

        $terminalIds = array_column($this->world->terminals, 'id');
        $serverIds = DB::table('orders')->whereIn('terminal_id', $terminalIds)->pluck('id')->all();
        $serverSet = array_fill_keys($serverIds, true);

        $missing = count(array_diff_key($localOrders, $serverSet));
        $extra = count(array_diff_key($serverSet, $localOrders));
        $dupes = count($serverIds) - count($serverSet);

        $this->check('outbox drained', $stuck === 0, "{$stuck} pending/sent")
            ->check('rejections', $rejected === $expectedRejected, "{$rejected} rejected (expected {$expectedRejected})")
            ->check('every sale on server exactly once', $missing === 0 && $extra === 0 && $dupes === 0,
                sprintf('local=%d server=%d missing=%d extra=%d dupes=%d', count($localOrders), count($serverIds), $missing, $extra, $dupes))
            ->check('queue rows = outbox rows', ($q = DB::table('offline_sync_queues')->whereIn('terminal_id', $terminalIds)->count()) === $outboxTotal,
                "server={$q} local={$outboxTotal}");

        $serverTotal = (int) DB::table('orders')->whereIn('terminal_id', $terminalIds)->sum('total_sen');
        $this->check('revenue matches to the sen', $serverTotal === $localTotal, "server={$serverTotal} local={$localTotal}");

        $movements = DB::table('stock_movements')->where('reason', 'sale')->where('tenant_id', $this->world->tenantId)->count();
        $this->check('one stock movement per order line', $movements === $movementLines, "server={$movements} expected={$movementLines}");

        $serverQty = (int) DB::table('order_items')->whereIn('order_id', array_keys($localOrders))->sum('qty_milli');
        $this->check('quantities match to the milli-unit', $serverQty === $localQtyMilli, "server={$serverQty} local={$localQtyMilli}");

        // every stored order must still satisfy the pricing spec's identity
        $broken = DB::table('orders')->whereIn('terminal_id', $terminalIds)
            ->whereRaw('total_sen <> subtotal_sen - discount_sen + service_charge_sen + tax_sen + rounding_sen')->count();
        $this->check('stored totals satisfy the pricing identity', $broken === 0, "{$broken} orders don't add up");

        // integers on both sides: exact equality, no tolerance
        $bad = [];
        $levels = DB::table('stock_levels')->where('outlet_id', $this->world->outletId)->pluck('on_hand_milli', 'variant_id');
        foreach ($this->world->variantIds as $vid) {
            $expected = $this->world->initialStockMilli - ($soldQty[$vid] ?? 0);
            if ((int) ($levels[$vid] ?? 0) !== $expected) {
                $bad[] = substr($vid, -6).': '.($levels[$vid] ?? 'missing')." != {$expected}";
            }
        }
        $this->check('stock on hand exact', ! $bad, $bad ? implode('; ', array_slice($bad, 0, 3)) : count($this->world->variantIds).' variants');

        return $this;
    }

    /** After a final pull, the terminal's catalogue must equal the server's. */
    public function catalogueConverged(LocalStore $store): self
    {
        $server = DB::table('product_variants')->where('tenant_id', $this->world->tenantId)
            ->get(['id', 'base_price_sen', 'row_version', 'deleted_at'])->keyBy('id');
        $local = collect($store->all('SELECT id, base_price_sen, row_version, deleted FROM variants'))->keyBy('id');

        $diff = [];
        foreach ($server as $id => $s) {
            $l = $local[$id] ?? null;
            $want = $s->deleted_at ? 'deleted' : "{$s->base_price_sen}@v{$s->row_version}";
            $got = ! $l ? 'missing' : ($l['deleted'] ? 'deleted' : "{$l['base_price_sen']}@v{$l['row_version']}");
            if ($want !== $got) {
                $diff[] = substr($id, -6).": server {$want}, local {$got}";
            }
        }

        return $this->check('catalogue converged', ! $diff, $diff ? count($diff).' differ, e.g. '.$diff[0] : $server->count().' variants identical');
    }

    public function conflictCount(string $kind): int
    {
        return DB::table('sync_conflicts')->where('kind', $kind)->count();
    }
}

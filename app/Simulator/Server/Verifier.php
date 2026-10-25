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

    /**
     * The full ledger check across every terminal's SQLite file: every sale, void, payment,
     * adjustment and session on the server exactly once; money, stock and statuses exact.
     */
    public function salesLedger(int $expectedRejected = 0): self
    {
        $localOrders = [];
        $localStatus = [];
        $localTotal = 0;
        $lines = [];          // order_id => [variant_id => qty_milli], across all terminals
        $localQtyMilli = 0;
        $localPayments = [];  // order_id => cash taken, across all terminals
        $voided = [];         // distinct orders voided anywhere (a second void is a no-op)
        $adjusted = [];
        $adjustments = 0;
        $sessions = 0;
        $sessionSen = 0;
        $outboxTotal = 0;
        $stuck = 0;
        $rejected = 0;

        foreach ($this->stores as $store) {
            foreach ($store->all('SELECT id, total_sen, status FROM orders') as $o) {
                $localOrders[$o['id']] = true;
                $localStatus[$o['id']] = $o['status'];
                $localTotal += (int) $o['total_sen'];
            }
            foreach ($store->all('SELECT order_id, variant_id, SUM(qty_milli) q FROM order_items GROUP BY order_id, variant_id') as $l) {
                $lines[$l['order_id']][$l['variant_id']] = (int) $l['q'];
            }
            foreach ($store->all('SELECT order_id, SUM(amount_sen) s FROM payments GROUP BY order_id') as $p) {
                $localPayments[$p['order_id']] = ($localPayments[$p['order_id']] ?? 0) + (int) $p['s'];
            }
            foreach ($store->all('SELECT DISTINCT order_id FROM voids') as $v) {
                $voided[$v['order_id']] = true;
            }
            foreach ($store->all('SELECT variant_id, delta_milli FROM adjustments') as $a) {
                $adjusted[$a['variant_id']] = ($adjusted[$a['variant_id']] ?? 0) + (int) $a['delta_milli'];
                $adjustments++;
            }
            $sessions += (int) $store->scalar('SELECT COUNT(*) FROM sessions');
            $sessionSen += (int) $store->scalar('SELECT COALESCE(SUM(amount_sen), 0) FROM sessions');
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

        // ledger rows: one per stocked (order, variant) sold, again per voided order, one per
        // adjustment. Timed products (snooker tables) aren't stocked, so they write none.
        $stocked = array_flip($this->world->variantIds);
        $stockedLines = fn (?array $byVariant) => count(array_intersect_key($byVariant ?? [], $stocked));
        $saleLines = array_sum(array_map($stockedLines, $lines));
        $voidLines = array_sum(array_map(fn ($o) => $stockedLines($lines[$o] ?? null), array_keys($voided)));
        $movements = DB::table('stock_movements')->where('tenant_id', $this->world->tenantId)->count();
        $this->check('one ledger row per line, void and adjustment', $movements === $saleLines + $voidLines + $adjustments,
            "server={$movements} expected={$saleLines}+{$voidLines}+{$adjustments}");

        // payments: everything taken, minus what voids gave back (each voided order once)
        $expectedPaid = array_sum($localPayments) - array_sum(array_map(fn ($o) => $localPayments[$o] ?? 0, array_keys($voided)));
        $serverPaid = (int) DB::table('payments')->whereIn('order_id', array_keys($localOrders))->sum('amount_sen');
        $this->check('payments net to the sen', $serverPaid === $expectedPaid, "server={$serverPaid} expected={$expectedPaid}");

        // status: void if voided anywhere, else what the terminal that rang it up says
        $serverStatus = DB::table('orders')->whereIn('terminal_id', $terminalIds)->pluck('status', 'id');
        $wrong = collect($localStatus)->filter(fn ($s, $id) => ($serverStatus[$id] ?? null) !== (isset($voided[$id]) ? 'void' : $s));
        $this->check('order statuses (paid / open / void)', $wrong->isEmpty(),
            $wrong->isEmpty() ? count($voided).' void, '.$serverStatus->filter(fn ($s) => $s === 'open')->count().' open'
                : $wrong->count().' wrong, e.g. '.$wrong->keys()->first());
        $this->check('one void fact per voided order', ($v = DB::table('order_voids')->count()) === count($voided), "server={$v} local=".count($voided));

        $serverSessions = DB::table('time_sessions')->whereIn('terminal_id', $terminalIds);
        $this->check('sessions and their charges', (clone $serverSessions)->count() === $sessions && (int) $serverSessions->sum('amount_sen') === $sessionSen,
            "{$sessions} sessions, {$sessionSen} sen");

        $serverQty = (int) DB::table('order_items')->whereIn('order_id', array_keys($localOrders))->sum('qty_milli');
        $this->check('quantities match to the milli-unit', $serverQty === $localQtyMilli, "server={$serverQty} local={$localQtyMilli}");

        // every stored order must still satisfy the pricing spec's identity
        $broken = DB::table('orders')->whereIn('terminal_id', $terminalIds)
            ->whereRaw('total_sen <> subtotal_sen - discount_sen + service_charge_sen + tax_sen + rounding_sen')->count();
        $this->check('stored totals satisfy the pricing identity', $broken === 0, "{$broken} orders don't add up");

        // integers on both sides: exact equality, no tolerance
        $bad = [];
        $levels = DB::table('stock_levels')->where('outlet_id', $this->world->outletId)->pluck('on_hand_milli', 'variant_id');
        $net = $adjusted;
        foreach ($lines as $orderId => $byVariant) {
            foreach ($byVariant as $vid => $q) {
                $net[$vid] = ($net[$vid] ?? 0) - $q + (isset($voided[$orderId]) ? $q : 0);
            }
        }
        foreach ($this->world->variantIds as $vid) {
            $expected = $this->world->initialStockMilli + ($net[$vid] ?? 0);
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

    public function expectConflicts(string $kind, int $expected): self
    {
        $n = $this->conflictCount($kind);

        return $this->check("{$kind} flagged", $n === $expected, "{$n} of {$expected}");
    }
}

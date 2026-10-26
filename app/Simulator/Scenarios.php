<?php

namespace App\Simulator;

use App\Models\{OrderItem, ProductVariant};
use App\Simulator\Server\{Hq, ServerPool, Verifier};
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\Pool;
use Illuminate\Support\Facades\{DB, Http};
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Process\Process;

final class Scenarios
{
    public const NAMES = [
        'offline-day', 'flaky-network', 'crash-mid-sync', 'clock-skew',
        'stale-price', 'concurrent-terminals', 'duplicate-race', 'cursor-race',
        'void-storm', 'open-tabs', 'stock-adjust', 'snooker-sessions',
        'lost-device', 'retire-device', 'offline-signin', 'refunds', 'stocktake',
        'print-node',
    ];

    public function __construct(
        private ServerPool $pool,
        private string $dir,
        private int $seed,
        private int $orders,
        private OutputInterface $out,
    ) {}

    public function run(string $name): Verifier
    {
        return $this->{lcfirst(str_replace(' ', '', ucwords(str_replace('-', ' ', $name))))}($name);
    }

    // ------------------------------------------------------------------ scenarios

    /** A full trading day with no connectivity, then one reconnect. */
    private function offlineDay(string $name): Verifier
    {
        [$world, $t] = $this->setup($name);
        $t->pull();
        $t->sell($this->orders);
        $this->say("sold {$this->orders} offline, outbox={$t->pendingCount()}; reconnecting");
        $t->sync();

        return (new Verifier($world, ['T1' => $t->store]))->salesLedger()->catalogueConverged($t->store);
    }

    /** Requests and responses lost at random while selling and syncing in bursts. */
    private function flakyNetwork(string $name): Verifier
    {
        [$world, $t] = $this->setup($name, chaos: new Chaos(dropRequest: 0.25, dropResponse: 0.25, seed: $this->seed));
        $t->pull();
        foreach (range(1, 10) as $_) {
            $t->sell(30);
            $t->sync();
        }
        $c = $t->client;
        $this->say("requests={$c->requests} dropped_req={$c->droppedRequests} dropped_resp={$c->droppedResponses}");

        return (new Verifier($world, ['T1' => $t->store]))
            ->check('chaos actually fired', $c->droppedResponses > 5 && $c->droppedRequests > 5, "{$c->droppedResponses} lost responses")
            ->salesLedger()->catalogueConverged($t->store);
    }

    /** Process killed (a) inside a sale and (b) after the server applied a batch but before acks were saved. */
    private function crashMidSync(string $name): Verifier
    {
        [$world, , $worldPath] = $this->setup($name, inProcess: false);
        $url = $this->pool->url(0);

        $this->terminalProc($worldPath, ['--fresh-store', '--pull', '--sell=300'], $url)->mustRun();

        $kill = $this->terminalProc($worldPath, ['--sell=1', '--crash-mid-sale'], $url);
        $kill->run();

        $crashes = 0;
        for ($run = 0; $run < 40; $run++) {
            $p = $this->terminalProc($worldPath, ['--sync', '--crash-after-pushes=2', '--seed='.($this->seed + $run)], $url);
            $p->run();
            if ($p->getExitCode() === 0) {
                break;
            }
            $crashes++;
        }
        $this->say("killed mid-sale (exit {$kill->getExitCode()}), then {$crashes} kills mid-sync");

        $store = new LocalStore(dirname($worldPath).'/T1.sqlite');

        return (new Verifier($world, ['T1' => $store]))
            ->check('mid-sale kill left no trace', $kill->getExitCode() === 137 && (int) $store->scalar('SELECT COUNT(*) FROM orders') === 300,
                'exit='.$kill->getExitCode().' orders='.$store->scalar('SELECT COUNT(*) FROM orders'))
            ->check('mid-sync kills happened', $crashes >= 3, "{$crashes} kills")
            ->salesLedger()->catalogueConverged($store);
    }

    /** One device 3 days slow, another 2 hours fast. Sales keep the device's time. */
    private function clockSkew(string $name): Verifier
    {
        $world = $this->world($name, terminals: 2);
        $slow = $this->terminal($world, 'T1', clockOffset: -3 * 86400);
        $fast = $this->terminal($world, 'T2', clockOffset: 2 * 3600);
        foreach ([$slow, $fast] as $t) {
            $t->pull();
            $t->sell(100);
            $t->sync();
        }

        $v = new Verifier($world, ['T1' => $slow->store, 'T2' => $fast->store]);
        $mismatch = 0;
        foreach ([$slow, $fast] as $t) {
            $server = DB::table('orders')->whereIn('id', array_column($t->store->all('SELECT id FROM orders'), 'id'))->pluck('occurred_at', 'id');
            foreach ($t->store->all('SELECT id, occurred_at FROM orders') as $o) {
                if (! CarbonImmutable::parse($server[$o['id']])->equalTo(CarbonImmutable::parse($o['occurred_at']))) {
                    $mismatch++;
                }
            }
        }
        $skew = DB::table('orders')->where('terminal_id', $world->terminal('T1')['id'])
            ->selectRaw('round(avg(extract(epoch from synced_at - occurred_at)) / 3600) h')->value('h');

        return $v->check('device occurred_at preserved exactly', $mismatch === 0, "{$mismatch} differ; T1 avg skew {$skew}h (server does not flag skew yet)")
            ->salesLedger();
    }

    /** HQ reprices one item and deletes another while the terminal is offline and selling both. */
    private function stalePrice(string $name): Verifier
    {
        [$world, $t] = $this->setup($name);
        $t->pull();
        [$repriced, $deleted] = [$world->variantIds[2], $world->variantIds[3]];
        $oldPrice = (int) $t->store->scalar('SELECT base_price_sen FROM variants WHERE id = ?', [$repriced]);

        Hq::enter($world->tenantId);
        Hq::write(function () use ($repriced, $deleted) {
            ProductVariant::findOrFail($repriced)->increment('base_price_sen', 100);
            ProductVariant::findOrFail($deleted)->delete();
        });

        foreach (range(1, 5) as $_) {
            $t->ringUp([['variant_id' => $repriced, 'qty_milli' => 1000], ['variant_id' => $deleted, 'qty_milli' => 1000]]);
        }
        $t->sync();

        $v = new Verifier($world, ['T1' => $t->store]);
        $charged = OrderItem::where('variant_id', $repriced)->pluck('unit_price_sen')->unique()->values()->all();

        return $v->check('price_mismatch flagged per stale line', ($n = $v->conflictCount('price_mismatch')) === 5, "{$n} of 5")
            ->check('product_deleted flagged per line', ($n = $v->conflictCount('product_deleted')) === 5, "{$n} of 5")
            ->check('customer price stands', $charged === [$oldPrice], 'stored '.json_encode($charged)." vs paid {$oldPrice}")
            ->salesLedger()->catalogueConverged($t->store);
    }

    /** Four terminals on four server processes, same outlet and SKUs, pushing at once. */
    private function concurrentTerminals(string $name): Verifier
    {
        $world = $this->world($name, terminals: 4);
        $worldPath = $this->worldPath($name);

        $procs = [];
        foreach ($world->terminals as $i => $term) {
            $p = $this->terminalProc($worldPath, ['--fresh-store', '--pull', '--sell=200', '--sync', '--drop-resp=0.1', '--seed='.($this->seed + $i)], $this->pool->url($i), $term['name']);
            $p->start();
            $procs[$term['name']] = $p;
        }
        foreach ($procs as $p) {
            $p->wait();
        }

        $stats = collect($procs)->map(fn (Process $p) => json_decode(last(explode("\n", trim($p->getOutput()))), true) ?? []);
        $this->say('retry results from server: '.$stats->sum('retry_results').', transport failures: '.$stats->sum('transport_failures'));

        $stores = collect($world->terminals)->mapWithKeys(fn ($t) => [$t['name'] => new LocalStore(dirname($worldPath)."/{$t['name']}.sqlite")])->all();

        return (new Verifier($world, $stores))
            ->check('all terminal processes succeeded', collect($procs)->every(fn (Process $p) => $p->getExitCode() === 0),
                collect($procs)->map(fn (Process $p) => $p->getExitCode())->implode(','))
            ->salesLedger();
    }

    /** The same batch hits two server processes at the same instant (retry racing the original). */
    private function duplicateRace(string $name): Verifier
    {
        [$world, $t] = $this->setup($name);
        $t->pull();
        $t->sell(200);

        $me = $world->terminal('T1');
        $mismatched = 0;
        $racedRetries = 0;
        $rows = $t->store->all("SELECT * FROM outbox ORDER BY client_seq");
        foreach (array_chunk($rows, Terminal::BATCH) as $batch) {
            $mutations = array_map(fn ($r) => [
                'id' => $r['id'], 'client_seq' => (int) $r['client_seq'], 'type' => $r['type'],
                'payload' => json_decode($r['payload'], true), 'client_created_at' => $r['created_at'],
            ], $batch);

            [$a, $b] = Http::pool(fn (Pool $pool) => [
                $pool->baseUrl($this->pool->url(0))->withToken($me['token'])->acceptJson()->timeout(60)->post('/api/v1/sync/push', ['mutations' => $mutations]),
                $pool->baseUrl($this->pool->url(1))->withToken($me['token'])->acceptJson()->timeout(60)->post('/api/v1/sync/push', ['mutations' => $mutations]),
            ]);
            foreach ($a->json('results') as $i => $ra) {
                $rb = $b->json("results.{$i}");
                if ($ra['status'] === 'retry' || $rb['status'] === 'retry') {
                    $racedRetries++;
                } elseif ($ra['status'] !== $rb['status'] || $ra['result'] != $rb['result']) {
                    $mismatched++;
                }
            }
        }
        // the terminal itself still believes nothing was acked; its normal sync must converge
        $t->sync();
        $this->say("raced 200 mutations across 2 servers; {$racedRetries} told to retry");

        return (new Verifier($world, ['T1' => $t->store]))
            ->check('both racers got the same outcome', $mismatched === 0, "{$mismatched} mismatched")
            ->salesLedger();
    }

    /** HQ edits with long-held transactions in parallel, while the terminal pulls continuously. */
    private function cursorRace(string $name): Verifier
    {
        [$world, $t] = $this->setup($name);
        $t->pull();

        $churners = [];
        foreach (range(1, 4) as $i) {
            $p = new Process([PHP_BINARY, 'artisan', 'sim:churn', '--tenant='.$world->tenantId, '--rounds=40', '--seed='.($this->seed + $i)], base_path(), ['DB_DATABASE' => \App\Console\Commands\SimRun::DATABASE]);
            $p->setTimeout(300);
            $p->start();
            $churners[] = $p;
        }

        $pulls = 0;
        while (collect($churners)->contains(fn (Process $p) => $p->isRunning())) {
            $t->pull();
            $pulls++;
            usleep(15_000);
        }
        $failed = collect($churners)->filter(fn (Process $p) => $p->getExitCode() !== 0);
        $t->pull();
        $this->say("{$pulls} pulls during 160 concurrent HQ edits");

        return (new Verifier($world, ['T1' => $t->store]))
            ->check('churn processes succeeded', $failed->isEmpty(), $failed->map(fn ($p) => mb_substr($p->getErrorOutput(), 0, 200))->implode(' | '))
            ->catalogueConverged($t->store);
    }

    /**
     * order.void. T1 sells offline all along. T2 sells and syncs, then voids: 10 of its own
     * orders as manager, 3 as cashier (flagged), and 5 of T1's orders that the server hasn't
     * seen yet, which must wait (retry) without blocking anything. T1 then voids 2 of
     * those same 5 itself and syncs first, so T2's 2 overlapping voids become duplicates.
     */
    private function voidStorm(string $name): Verifier
    {
        $world = $this->world($name, terminals: 2);
        $t1 = $this->terminal($world, 'T1', server: 0);
        $t2 = $this->terminal($world, 'T2', server: 1);
        $t1->pull();
        $t2->pull();

        $t1Orders = $t1->sell(80);
        $t2Orders = $t2->sell(60);
        $t2->sync();

        foreach (array_slice($t2Orders, 0, 10) as $id) {
            $t2->voidOrder($id, 'manager');
        }
        foreach (array_slice($t2Orders, 10, 3) as $id) {
            $t2->voidOrder($id, 'cashier');
        }
        $crossTerminal = array_slice($t1Orders, 0, 5);
        foreach ($crossTerminal as $id) {
            $t2->voidOrder($id, 'manager');
        }
        $t2->sell(5);   // must still sync past the waiting voids

        $drained = $t2->drain(maxRounds: 6);
        $waiting = $t2->pendingCount();
        $sold = (int) $t2->store->scalar("SELECT COUNT(*) FROM outbox WHERE type = 'order.create' AND status = 'acked'");
        $this->say("while T1 is offline, T2 has {$waiting} voids waiting and {$sold}/65 sales through");

        foreach (array_slice($crossTerminal, 0, 2) as $id) {
            $t1->voidOrder($id, 'manager');
        }
        $t1->sync();
        $t2->sync();

        return (new Verifier($world, ['T1' => $t1->store, 'T2' => $t2->store]))
            ->check('cross-terminal voids waited, sales did not', ! $drained && $waiting === 5 && $sold === 65, "waiting={$waiting} sales={$sold}/65")
            ->expectConflicts('unauthorized_void', 3)
            ->expectConflicts('duplicate_void', 2)
            ->salesLedger();
    }

    /** payment.add. Open tabs settled later in one or two payments, over a flaky network. */
    private function openTabs(string $name): Verifier
    {
        [$world, $t] = $this->setup($name, chaos: new Chaos(dropRequest: 0.15, dropResponse: 0.15, seed: $this->seed));
        $t->pull();

        $tabs = [];
        foreach (range(1, 60) as $i) {
            [$lines, $discount] = $t->randomBasket();
            $id = $t->ringUp($lines, $discount, paidSen: 0);
            $total = (int) $t->store->scalar('SELECT total_sen FROM orders WHERE id = ?', [$id]);
            if ($i % 2 === 0 && $total > 1) {   // half the tabs paid a deposit up front
                $t->addPayment($id, intdiv($total, 2));
            }
            $tabs[$id] = $total;
        }
        $t->sync();
        $open = DB::table('orders')->whereIn('id', array_keys($tabs))->where('status', 'open')->count();

        $overpaid = 0;
        foreach ($tabs as $id => $total) {
            $due = $total - (int) $t->store->scalar('SELECT COALESCE(SUM(amount_sen), 0) FROM payments WHERE order_id = ?', [$id]);
            $extra = $overpaid < 5 && $due > 0 ? 100 : 0;   // five customers leave a tip in the drawer
            $overpaid += $extra ? 1 : 0;
            if ($due > 3) {
                $t->addPayment($id, intdiv($due, 3));
                $due -= intdiv($due, 3);
            }
            if ($due + $extra > 0) {
                $t->addPayment($id, $due + $extra);
            }
        }
        $t->sync();
        $this->say("{$open} tabs open after the first sync, settled with ".$t->store->scalar('SELECT COUNT(*) FROM payments').' payments');

        return (new Verifier($world, ['T1' => $t->store]))
            ->check('tabs were open before settling', $open === 60, "{$open} of 60")
            ->expectConflicts('overpaid', 5)
            ->salesLedger();
    }

    /** stock.adjust. Three terminals sell and adjust the same items, then push at once. */
    private function stockAdjust(string $name): Verifier
    {
        $world = $this->world($name, terminals: 3);
        $worldPath = $this->worldPath($name);

        $procs = [];
        foreach ($world->terminals as $i => $term) {
            $p = $this->terminalProc($worldPath, ['--fresh-store', '--pull', '--sell=100', '--adjust=60', '--sync', '--drop-resp=0.1', '--seed='.($this->seed + 10 + $i)],
                $this->pool->url($i), $term['name']);
            $p->start();
            $procs[$term['name']] = $p;
        }
        foreach ($procs as $p) {
            $p->wait();
        }

        $stores = collect($world->terminals)->mapWithKeys(fn ($t) => [$t['name'] => new LocalStore(dirname($worldPath)."/{$t['name']}.sqlite")])->all();
        $unauthorized = collect($stores)->sum(fn (LocalStore $s) => (int) $s->scalar("SELECT COUNT(*) FROM adjustments WHERE staff_role = 'cashier' AND reason <> 'waste'"));
        $this->say('180 adjustments across 3 terminals, '.$unauthorized.' corrections by a cashier');

        return (new Verifier($world, $stores))
            ->check('all terminal processes succeeded', collect($procs)->every(fn (Process $p) => $p->getExitCode() === 0),
                collect($procs)->map(fn (Process $p) => $p->getExitCode() ?: mb_substr($p->getErrorOutput(), 0, 200))->implode(','))
            ->expectConflicts('unauthorized_adjustment', $unauthorized)
            ->salesLedger();
    }

    /**
     * session.end. Snooker tables billed offline on a device whose clock is an hour slow,
     * mixed with bar sales. Three sessions are charged wrongly on purpose: the server keeps
     * the charged amount, recomputes with TimeBilling, and flags exactly those three.
     */
    private function snookerSessions(string $name): Verifier
    {
        $world = $this->world($name);
        $t = $this->terminal($world, 'T1', clockOffset: -3600);
        $t->pull();

        $chaos = Chaos::none($this->seed + 7);
        foreach (range(1, 50) as $i) {
            $elapsed = $chaos->int(0, 4 * 3600);
            $t->endSession($world->timedVariantId, $elapsed, $chaos->int(0, intdiv($elapsed, 3)), tamperSen: $i % 16 === 0 ? 50 : 0);   // 16, 32, 48
            if ($i % 2 === 0) {
                $t->sell(1);
            }
        }
        $t->sync();

        $diverged = DB::table('time_sessions')->whereColumn('amount_sen', '<>', 'server_amount_sen')->count();
        $this->say('50 sessions, '.$t->store->scalar('SELECT SUM(amount_sen) FROM sessions').' sen charged');

        return (new Verifier($world, ['T1' => $t->store]))
            ->check('server recomputed every session', $diverged === 3, "{$diverged} differ from TimeBilling (3 tampered)")
            ->expectConflicts('session_amount_mismatch', 3)
            ->salesLedger();
    }

    /**
     * Revoke + wipe. T1 syncs 30 sales, then rings up 25 more offline and goes missing. A
     * manager on T2 revokes it with a wipe. When T1 next connects it is refused, erases
     * itself and confirms; its token then stops working. The 25 unsynced sales are lost:
     * that's the documented price of a wipe. T2 carries on untouched.
     */
    private function lostDevice(string $name): Verifier
    {
        $world = $this->world($name, terminals: 2);
        $t1 = $this->terminal($world, 'T1', server: 0);
        $t2 = $this->terminal($world, 'T2', server: 1);
        $t1->pull();
        $t2->pull();
        $t1->sell(30);
        $t1->sync();
        $t1->sell(25);   // never synced

        $manager = $this->signIn($world, 'T2', 1, 'manager');
        $t1Id = $world->terminal('T1')['id'];
        $listed = collect($manager->get('/api/v1/devices')->json('devices'))->firstWhere('id', $t1Id);
        $unpair = $manager->post("/api/v1/devices/{$t1Id}/unpair", ['mode' => 'revoke', 'wipe' => true, 'reason' => 'lost']);

        $t1->sync();   // comes back online: refused, wipes, confirms
        $afterWipe = Http::baseUrl($this->pool->url(0))->withToken($world->terminal('T1')['token'])->acceptJson()->get('/api/v1/sync/pull')->status();

        $t2->sell(5);
        $t2->sync();
        $this->say("HQ saw T1 with {$listed['outbox_pending']} unsynced at last contact (it had 25 by the time it went missing); now {$t1->deviceState}");

        return (new Verifier($world, ['T2' => $t2->store]))
            ->check('manager revoked it with a wipe', $unpair->status() === 200 && $unpair->json('wipe_requested') === true, "HTTP {$unpair->status()}")
            ->check('device list showed the backlog as of last contact', $listed['outbox_pending'] === 0, "{$listed['outbox_pending']} (the 25 came after)")
            ->check('device erased itself and confirmed', $t1->deviceState === 'wiped' && $t1->store->isEmpty(), $t1->deviceState)
            ->check('its token is dead after the wipe', $afterWipe === 401, "pull -> HTTP {$afterWipe}")
            ->check('server kept only what had synced', ($n = DB::table('orders')->where('terminal_id', $t1Id)->count()) === 30, "{$n} of T1's orders (30 synced, 25 lost)")
            ->check('wipe recorded', DB::table('terminals')->where('id', $t1Id)->whereNotNull('wipe_confirmed_at')->exists())
            ->check('other terminal unaffected', $t2->deviceState === 'active' && $t2->pendingCount() === 0, $t2->deviceState);
    }

    /**
     * Retire. T1 has 40 unsynced sales when a manager retires it (it's being replaced).
     * It then rings up 5 more. On reconnect it may push the 40 (applied) but not the 5
     * (rejected device_retired); pull is refused; it reports done and ends up revoked,
     * without a wipe.
     */
    private function retireDevice(string $name): Verifier
    {
        $world = $this->world($name, terminals: 2);
        $t1 = $this->terminal($world, 'T1', server: 0);
        $t1->pull();
        $t1->sell(40);

        $t1Id = $world->terminal('T1')['id'];
        $retire = $this->signIn($world, 'T2', 1, 'manager')->post("/api/v1/devices/{$t1Id}/unpair", ['mode' => 'retire', 'reason' => 'replaced']);
        usleep(20_000);
        $t1->sell(5);   // after the cutoff

        $t1->sync();
        $refused = (int) $t1->store->scalar("SELECT COUNT(*) FROM outbox WHERE status = 'rejected' AND json_extract(result, '$.error') = 'device_retired'");
        $status = DB::table('terminals')->where('id', $t1Id)->value('status');
        $this->say("backlog synced, {$refused} post-cutoff sales refused, device {$t1->deviceState}");

        return (new Verifier($world, ['T1' => $t1->store]))
            ->check('manager retired it', $retire->status() === 200 && $retire->json('status') === 'retiring', "HTTP {$retire->status()}")
            ->check('post-cutoff sales refused', $refused === 5, "{$refused} of 5")
            ->check('device reported done and is revoked, not wiped', $t1->deviceState === 'revoked' && $status === 'revoked' && ! $t1->store->isEmpty(), "{$t1->deviceState} / {$status}")
            ->salesLedger(expectedRejected: 5);   // the 40 backlog sales arrive exactly once
    }

    /**
     * Offline sign-in (option C). The outlet loses its network for the day. The cashier
     * signs in offline and sells 20; the manager signs in offline and voids 3 (allowed,
     * flagged). Meanwhile HQ resets the cashier's PIN, which revokes their credential, but
     * the device can't know: the cashier signs in offline again and sells 10 more. On
     * reconnect every sale is kept; exactly those 10 are flagged stale and the 3 voids are
     * flagged as offline manager actions. After the next pull the device itself refuses
     * the revoked credential.
     */
    private function offlineSignin(string $name): Verifier
    {
        $world = $this->world($name);
        $t = $this->terminal($world, 'T1');
        $t->pull();

        $okCashier = $t->signInOffline('cashier');
        $sales = $t->sell(20);
        $okManager = $t->signInOffline('manager');
        foreach (array_slice($sales, 0, 3) as $id) {
            $t->voidOrder($id, 'manager');
        }

        Hq::enter($world->tenantId);
        Hq::write(fn () => \App\Models\Staff::findOrFail($world->staff['cashier']['id'])->setPin('7777')->save());
        usleep(20_000);

        $t->signInOffline('cashier');   // the device hasn't heard about the reset
        $t->sell(10);

        $t->sync();
        $refusedAfterPull = ! $t->signInOffline('cashier');
        $stillManager = $t->signInOffline('manager');
        $this->say('30 sales and 3 voids made offline; HQ reset the cashier PIN mid-day');

        return (new Verifier($world, ['T1' => $t->store]))
            ->check('offline sign-in worked with the network down', $okCashier && $okManager)
            ->expectConflicts('offline_credential_stale', 10)
            ->expectConflicts('offline_manager_action', 3)
            ->check('device refuses the revoked credential after pulling', $refusedAfterPull && $stillManager,
                'cashier refused: '.json_encode($refusedAfterPull).', manager still ok: '.json_encode($stillManager))
            ->salesLedger();   // nothing rejected: offline actions are flagged, never refused
    }

    /**
     * order.refund. 60 sales (discounts, service charge, mixed tax), then partial refunds
     * line by line over a flaky network: 15 orders refunded in three pieces until nothing
     * is left, 10 refunded partly, 3 of those by a cashier (flagged), some lines not
     * restocked. Every fully refunded order must have given back exactly what was paid,
     * and the server must agree with every amount.
     */
    private function refunds(string $name): Verifier
    {
        [$world, $t] = $this->setup($name, chaos: new Chaos(dropRequest: 0.1, dropResponse: 0.15, seed: $this->seed));
        $t->pull();
        $orders = $t->sell(60);
        $t->sync();

        $chaos = Chaos::none($this->seed + 3);
        $lines = fn (string $order) => array_column($t->store->all('SELECT id, qty_milli FROM order_items WHERE order_id = ?', [$order]), 'qty_milli', 'id');
        $full = array_slice($orders, 0, 15);
        foreach ($full as $order) {
            $left = $lines($order);
            foreach ([1, 2, 3] as $piece) {
                $now = [];
                foreach ($left as $item => $q) {
                    $take = $piece === 3 ? $q : intdiv($q, 3 - $piece + 1);   // a third, half of the rest, the rest
                    if ($take > 0) {
                        $now[$item] = $take;
                        $left[$item] -= $take;
                    }
                }
                if ($now) {
                    $t->refundOrder($order, $now, restock: $chaos->int(0, 4) > 0);
                }
            }
        }
        foreach (array_slice($orders, 15, 10) as $i => $order) {
            $item = array_key_first($lines($order));
            $t->refundOrder($order, [$item => 250], role: $i < 3 ? 'cashier' : 'manager');
        }
        $t->sync();

        $short = collect($full)->filter(fn ($o) => (int) $t->store->scalar('SELECT SUM(refund_sen) FROM refunds WHERE order_id = ?', [$o])
            !== (int) $t->store->scalar('SELECT total_sen FROM orders WHERE id = ?', [$o]))->count();
        $disagree = DB::table('order_refunds')->whereColumn('refund_sen', '<>', 'server_refund_sen')->count();
        $this->say($t->store->scalar('SELECT COUNT(*) FROM refunds').' refunds, '.$t->store->scalar('SELECT -SUM(amount_sen) FROM payments WHERE amount_sen < 0').' sen given back');

        return (new Verifier($world, ['T1' => $t->store]))
            ->check('fully refunded orders gave back exactly what was paid', $short === 0, "{$short} of 15 off by a sen or more")
            ->check('server agrees with every refund amount', $disagree === 0, "{$disagree} differ")
            ->expectConflicts('unauthorized_refund', 3)
            ->salesLedger();
    }

    /**
     * stock.count. T1 sells all morning with no network. T2 sells and syncs. A manager on
     * T2 counts the shelf (which already reflects T1's sales, and 3 units that walked out).
     * T1 sells more after the count, then reconnects. T1's pre-count sales must not come
     * off the counted stock again; its post-count sales must. Final stock must equal what
     * is physically on the shelf.
     */
    private function stocktake(string $name): Verifier
    {
        $world = $this->world($name, terminals: 2);
        $t1 = $this->terminal($world, 'T1', server: 0);
        $t2 = $this->terminal($world, 'T2', server: 1);
        $t1->pull();
        $t2->pull();

        $sold = function (Terminal $t, array $orders): array {
            $q = [];
            foreach ($orders as $o) {
                foreach ($t->store->all('SELECT variant_id, qty_milli FROM order_items WHERE order_id = ?', [$o]) as $l) {
                    $q[$l['variant_id']] = ($q[$l['variant_id']] ?? 0) + (int) $l['qty_milli'];
                }
            }
            return $q;
        };

        $t1PreOrders = $t1->sell(40);             // offline
        $t1Before = $sold($t1, $t1PreOrders);
        $t2Sold = $sold($t2, $t2->sell(20));
        $t2->sync();

        // the shelf: what really happened, plus shrinkage the books never saw
        $shrink = [$world->variantIds[3] => 3000, $world->variantIds[7] => 3000];
        $shelf = [];
        foreach ($world->variantIds as $vid) {
            $shelf[$vid] = $world->initialStockMilli - ($t1Before[$vid] ?? 0) - ($t2Sold[$vid] ?? 0) - ($shrink[$vid] ?? 0);
        }
        usleep(5_000);
        $t2->countStock($shelf, 'manager');
        $t2->sync();
        usleep(5_000);

        $t1After = $sold($t1, $t1->sell(15));   // still offline, after the count
        $t1->sync();

        $levels = DB::table('stock_levels')->where('outlet_id', $world->outletId)->pluck('on_hand_milli', 'variant_id');
        $wrong = collect($world->variantIds)->filter(fn ($vid) => (int) $levels[$vid] !== $shelf[$vid] - ($t1After[$vid] ?? 0));
        $variance = (int) DB::table('stock_count_lines')->sum('delta_milli');
        $expectedVariance = -array_sum($shrink) - array_sum($t1Before);   // the books at count time missed both
        $absorbed = DB::table('stock_movements')->where('reason', 'count_absorbed')->pluck('ref_id');
        // exactly one cancelled movement per (order, item) T1 rang up before the count; none after
        $t1PreLines = collect($t1PreOrders)->sum(fn ($o) => (int) $t1->store->scalar('SELECT COUNT(DISTINCT variant_id) FROM order_items WHERE order_id = ?', [$o]));
        $absorbedOnlyPre = $absorbed->every(fn ($ref) => in_array($ref, $t1PreOrders, true));
        $absorbed = $absorbed->count();
        $this->say("count variance {$variance} milli (6,000 shrinkage + T1's unsynced sales); {$absorbed} late movements absorbed");

        return (new Verifier($world, ['T1' => $t1->store, 'T2' => $t2->store]))
            ->check('stock equals the shelf, minus sales after the count', $wrong->isEmpty(), $wrong->count().' of '.count($world->variantIds).' differ')
            ->check('count variance = shrinkage + sales the books had not seen yet', $variance === $expectedVariance, "{$variance} vs {$expectedVariance}")
            ->check("T1's pre-count sales were absorbed, post-count ones were not", $absorbed === $t1PreLines && $absorbedOnlyPre,
                "{$absorbed} absorbed, {$t1PreLines} pre-count lines".($absorbedOnlyPre ? '' : ', some post-count!'))
            ->salesLedger(stock: false);
    }

    /**
     * Zero-touch kitchen. A print node pairs over HTTP without attestation (kitchen devices
     * are exempt, even with attestation required). The till sends 40 sales to the kitchen;
     * 18 delivery orders arrive by webhook and are auto-accepted because the node is
     * heartbeating. The node prints while being power-cut at each dangerous point (after
     * marking a job, after printing it, before acking) and losing 30% of its ack responses.
     * There is no Reverb here, so it never hears a doorbell: everything arrives by pull.
     * Then the node goes quiet and 5 more orders arrive, which must not be accepted.
     *
     * Every job must print exactly once, or (power cut mid-print) be reported
     * print_uncertain for a person to check. Nothing may print twice or vanish.
     */
    private function printNode(string $name): Verifier
    {
        $world = $this->world($name);
        $k = Hq::kitchen($world);
        $url = $this->pool->url(0);
        $dir = dirname($this->worldPath($name));

        $reg = Http::baseUrl($url)->acceptJson()->post('/api/v1/devices/register',
            ['code' => $k['code'], 'device_fingerprint' => "sim:{$world->tenantId}:node", 'name' => 'Print node']);
        if ($reg->status() !== 201) {
            throw new \RuntimeException("print node pairing failed: HTTP {$reg->status()} ".$reg->body());
        }
        foreach (['node.sqlite', 'node.sqlite-wal', 'node.sqlite-shm'] as $f) {
            @unlink("{$dir}/{$f}");
        }
        $paper = new Paper("{$dir}/paper.txt");
        $chaos = new Chaos(dropResponse: 0.3, seed: $this->seed);
        $boot = fn () => new PrintNode($url, $reg->json('token'), $k['printer_id'], "{$dir}/node.sqlite", $paper, $chaos);
        $node = $boot();
        $node->heartbeat();

        // the till's sales, verified on their own before platform orders join the outlet
        $t = $this->terminal($world, 'T1');
        $t->sendToKitchen = true;
        $t->pull();
        $t->sell(40);
        $t->sync();
        $v = (new Verifier($world, ['T1' => $t->store]))->salesLedger();

        $n = 0;
        $deliver = function () use (&$n, $url, $k, $world): int {
            $n++;
            $item = $k['items'][$n % 3];
            $qty = 1 + $n % 2;
            $raw = json_encode(['event_id' => "evt-{$world->tenantId}-{$n}", 'type' => 'order.created', 'store_id' => $k['store_id'], 'order' => [
                'id' => "SIM-{$n}", 'short_code' => sprintf('S%03d', $n), 'fulfilment' => 'delivery', 'payment_mode' => 'platform_collected',
                'placed_at' => now()->toIso8601ZuluString('microsecond'),
                'items' => [['id' => $item['id'], 'name' => $item['name'], 'qty' => $qty, 'unit_price_sen' => $item['price_sen']]],
                'items_total_sen' => $qty * $item['price_sen'], 'delivery_fee_sen' => 500, 'total_sen' => $qty * $item['price_sen'] + 500,
                'customer' => ['first_name' => 'Sim', 'phone_suffix' => '0000'],
            ]]);

            return Http::baseUrl($url)->acceptJson()->withHeaders(['X-Fixture-Signature' => hash_hmac('sha256', $raw, $k['secret'])])
                ->withBody($raw, 'application/json')->post('/api/v1/webhooks/delivery/fixture')->status();
        };

        $crashes = ['after_mark' => 0, 'after_print' => 0, 'before_ack' => 0];
        $dropped = 0;
        $webhookFailures = 0;
        for ($round = 0; $round < 60; $round++) {
            $crashAt = $round < 6 ? PrintNode::CRASH_POINTS[$round % 3] : null;
            if ($round < 6) {
                foreach (range(1, 3) as $_) {
                    $node->heartbeat();   // presence is a 2 s window in the sim
                    $webhookFailures += $deliver() === 200 ? 0 : 1;
                }
            }
            $node->heartbeat();
            $fresh = $node->pull();
            try {
                $node->printAll($crashAt, crashOnJob: $chaos->int(1, 3));
                $node->ackAll();
            } catch (NodeCrashed) {
                $crashes[$crashAt]++;
                $dropped += $node->droppedAcks;
                $node = $boot();   // power back: same files, new process
            }
            if ($round >= 6 && $fresh === 0 && $node->pending() === 0) {
                break;
            }
        }
        $dropped += $node->droppedAcks;

        // the node goes quiet; orders arriving now must wait for a person
        usleep(3_000_000);   // > POS_KITCHEN_PRESENCE_SECONDS (2) on the sim servers
        foreach (range(1, 5) as $_) {
            $webhookFailures += $deliver() === 200 ? 0 : 1;
        }

        Hq::enter($world->tenantId);
        $jobs = DB::table('print_jobs')->get(['id', 'status', 'last_error'])->keyBy('id');
        $tally = $paper->tally();
        $printed = $jobs->where('status', 'printed');
        $uncertain = $jobs->where('status', 'failed')->where('last_error', 'print_uncertain');
        $midPrint = $crashes['after_mark'] + $crashes['after_print'];
        $accepted = DB::table('delivery_orders')->where('status', 'accepted')->where('accepted_by', 'auto')->count();
        $waiting = DB::table('delivery_orders')->where('status', 'received')->whereRaw("attention_reasons @> '[{\"kind\":\"auto_accept_skipped\"}]'")->count();
        $tickets = DB::table('kitchen_tickets')->selectRaw('source, count(*) n')->groupBy('source')->pluck('n', 'source');
        $this->say(sprintf('%d jobs: %d printed, %d uncertain; crashes %s; %d acks lost', $jobs->count(), $printed->count(), $uncertain->count(),
            json_encode($crashes), $dropped));

        return $v
            ->check('print node paired without attestation', $reg->json('terminal.kind') === 'kitchen')
            ->check('webhooks all acknowledged', $webhookFailures === 0, "{$webhookFailures} failed")
            ->check('a ticket for every kitchen sale and accepted order', (int) ($tickets['terminal'] ?? 0) === 40 && (int) ($tickets['delivery'] ?? 0) === 18,
                json_encode($tickets))
            ->check('auto-accepted only while the kitchen listened', $accepted === 18 && $waiting === 5, "{$accepted} accepted, {$waiting} left for a person")
            ->check('chaos fired at every crash point', min($crashes) >= 1 && $dropped >= 3, json_encode($crashes)." / {$dropped} lost acks")
            ->check('nothing printed twice', $tally === [] || max($tally) === 1, 'max '.($tally ? max($tally) : 0))
            ->check('every job printed or reported uncertain', $printed->count() + $uncertain->count() === $jobs->count() && $jobs->count() === 58,
                "{$printed->count()} + {$uncertain->count()} of {$jobs->count()}")
            ->check('printed jobs are on paper exactly once', $printed->every(fn ($j) => ($tally[$j->id] ?? 0) === 1))
            ->check('only a mid-print power cut leaves a job uncertain', $uncertain->count() === $midPrint, "{$uncertain->count()} uncertain, {$midPrint} mid-print cuts")
            ->check('no paper the server does not know about', collect(array_keys($tally))->every(fn ($id) => $jobs->has($id)));
    }

    /** A staff member signs in on one of the world's terminals; returns a ready HTTP client. */
    private function signIn(World $world, string $terminal, int $server, string $role): \Illuminate\Http\Client\PendingRequest
    {
        $token = $world->terminal($terminal)['token'];
        $session = Http::baseUrl($this->pool->url($server))->withToken($token)->acceptJson()
            ->post('/api/v1/auth/login', ['staff_id' => $world->staff[$role]['id'], 'pin' => $world->staff[$role]['pin'],
                'attestation' => $this->attestation($server)])
            ->throw()->json('session_token');

        return Http::baseUrl($this->pool->url($server))->withToken($token)->withHeader('X-Staff-Session', $session)->acceptJson();
    }

    // ------------------------------------------------------------------ helpers

    /** @return array{0: World, 1: ?Terminal, 2: string} */
    private function setup(string $name, ?Chaos $chaos = null, bool $inProcess = true): array
    {
        $world = $this->world($name);

        return [$world, $inProcess ? $this->terminal($world, 'T1', chaos: $chaos) : null, $this->worldPath($name)];
    }

    private function world(string $name, int $terminals = 1): World
    {
        $world = $this->pairAll(Hq::provision($name, $terminals));
        $world->save($this->worldPath($name));

        return $world;
    }

    /**
     * Each terminal proves it isn't rooted (attestation bound to a fresh challenge), redeems
     * its one-time code over HTTP, then the cashier and manager sign in by PIN on it, each
     * getting an offline credential, as on a real device. Pairing and login are
     * online-only; selling isn't.
     */
    private function pairAll(World $world): World
    {
        $paired = [];
        foreach ($world->terminals as $i => $t) {
            $http = fn () => Http::baseUrl($this->pool->url($i))->acceptJson();
            $res = $http()->post('/api/v1/devices/register', [
                'code' => $t['code'], 'device_fingerprint' => "sim:{$world->tenantId}:{$t['name']}", 'name' => $t['name'],
                'attestation' => $this->attestation($i),
            ]);
            if ($res->status() !== 201) {
                throw new \RuntimeException("pairing {$t['name']} failed: HTTP {$res->status()} ".$res->body());
            }

            $credentials = [];
            foreach (['cashier', 'manager'] as $role) {
                $login = $http()->withToken($res->json('token'))->post('/api/v1/auth/login', [
                    'staff_id' => $world->staff[$role]['id'], 'pin' => $world->staff[$role]['pin'], 'attestation' => $this->attestation($i),
                ]);
                if ($login->status() !== 201 || ! $login->json('offline_credential.issued')) {
                    throw new \RuntimeException("{$role} login on {$t['name']} failed: HTTP {$login->status()} ".$login->body());
                }
                $credentials[$role] = $login->json('offline_credential.id');
            }

            $paired[] = ['name' => $t['name'], 'id' => $res->json('terminal.id'), 'token' => $res->json('token'), 'credentials' => $credentials];
        }

        return $world->withTerminals($paired);
    }

    /** What the device's platform attestation would produce (dev verdict signer). */
    private function attestation(int $server): array
    {
        $nonce = Http::baseUrl($this->pool->url($server))->acceptJson()->post('/api/v1/attestation/challenge')->throw()->json('nonce');

        return ['platform' => 'android', 'nonce' => $nonce, 'token' => \App\Devices\Attestation\DevAttestation::token($nonce)];
    }

    private function worldPath(string $name): string
    {
        return $this->dir.DIRECTORY_SEPARATOR.$name.DIRECTORY_SEPARATOR.'world.json';
    }

    private function terminal(World $world, string $name, ?Chaos $chaos = null, int $clockOffset = 0, int $server = 0): Terminal
    {
        $chaos ??= Chaos::none($this->seed);
        $me = $world->terminal($name);
        $store = LocalStore::fresh(dirname($this->worldPath($this->nameOf($world))).DIRECTORY_SEPARATOR."{$name}.sqlite");

        return new Terminal($world, $me, $store, new SyncClient($this->pool->url($server), $me['token'], $chaos), $chaos, $clockOffset);
    }

    private function nameOf(World $world): string
    {
        foreach (self::NAMES as $n) {
            if (is_file($p = $this->worldPath($n)) && str_contains(file_get_contents($p), $world->tenantId)) {
                return $n;
            }
        }
        throw new \LogicException('world not saved');
    }

    private function terminalProc(string $worldPath, array $args, string $url, string $name = 'T1'): Process
    {
        $p = new Process(array_merge([PHP_BINARY, 'artisan', 'sim:terminal', "--world={$worldPath}", "--name={$name}", "--url={$url}"], $args), base_path());
        $p->setTimeout(600);

        return $p;
    }

    private function say(string $msg): void
    {
        $this->out->writeln("   <fg=gray>{$msg}</>");
    }
}

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

    // ------------------------------------------------------------------ helpers

    /** @return array{0: World, 1: ?Terminal, 2: string} */
    private function setup(string $name, ?Chaos $chaos = null, bool $inProcess = true): array
    {
        $world = $this->world($name);

        return [$world, $inProcess ? $this->terminal($world, 'T1', chaos: $chaos) : null, $this->worldPath($name)];
    }

    private function world(string $name, int $terminals = 1): World
    {
        $world = Hq::provision($name, $terminals);
        $world->save($this->worldPath($name));

        return $world;
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

<?php

namespace App\Console\Commands;

use App\Simulator\{Chaos, LocalStore, SyncClient, Terminal, World};
use Illuminate\Console\Command;

/**
 * One simulated POS terminal process. Run directly, or spawned by sim:run so it can be
 * killed mid-flight. Prints a JSON stats line last.
 *
 *   php artisan sim:terminal --world=storage/sim/x/world.json --name=T1 --url=http://127.0.0.1:8100 --pull --sell=50 --sync
 */
class SimTerminal extends Command
{
    protected $signature = 'sim:terminal
        {--world= : world.json written by sim:run}
        {--name=T1 : terminal name in the world}
        {--url=http://127.0.0.1:8100 : API base URL}
        {--store= : SQLite path (default: next to world.json)}
        {--fresh-store : wipe the local database first}
        {--pull : pull the catalogue before selling}
        {--sell=0 : number of sales to ring up (offline)}
        {--sync : drain the outbox and pull to head}
        {--clock-offset=0 : device clock skew in seconds}
        {--drop-req=0 : probability a request is lost}
        {--drop-resp=0 : probability a response is lost after the server applied it}
        {--crash-after-pushes= : hard-exit after N push responses, before saving acks}
        {--crash-mid-sale : hard-exit inside the sale transaction}
        {--seed=1 : RNG seed}';

    protected $description = 'Run a simulated offline-first POS terminal against the sync API';

    public function handle(): int
    {
        $world = World::load($this->option('world'));
        $me = $world->terminal($this->option('name'));
        $storePath = $this->option('store') ?: dirname($this->option('world')).DIRECTORY_SEPARATOR."{$me['name']}.sqlite";

        $chaos = new Chaos(
            (float) $this->option('drop-req'),
            (float) $this->option('drop-resp'),
            $this->option('crash-after-pushes') !== null ? (int) $this->option('crash-after-pushes') : null,
            (int) $this->option('seed'),
        );
        $store = $this->option('fresh-store') ? LocalStore::fresh($storePath) : new LocalStore($storePath);
        $client = new SyncClient($this->option('url'), $me['token'], $chaos);
        $terminal = new Terminal($world, $me, $store, $client, $chaos, (int) $this->option('clock-offset'));

        $ok = true;
        if ($this->option('pull')) {
            $ok = $terminal->pull();
        }
        if ($ok && ($n = (int) $this->option('sell')) > 0) {
            $terminal->sell($n, (bool) $this->option('crash-mid-sale'));
        }
        if ($ok && $this->option('sync')) {
            $ok = $terminal->sync();
        }

        $this->line(json_encode($terminal->stats + [
            'ok' => $ok,
            'pending' => $terminal->pendingCount(),
            'requests' => $client->requests,
            'dropped_requests' => $client->droppedRequests,
            'dropped_responses' => $client->droppedResponses,
        ]));

        return $ok ? self::SUCCESS : self::FAILURE;
    }
}

<?php

namespace App\Console\Commands;

use App\Simulator\Scenarios;
use App\Simulator\Server\ServerPool;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\{Artisan, DB};

/**
 *   php artisan sim:run                 # every scenario
 *   php artisan sim:run crash-mid-sync  # just one
 *   php artisan sim:run --orders=5000   # bigger offline backlog
 */
class SimRun extends Command
{
    public const DATABASE = 'allurus_sim';

    protected $signature = 'sim:run
        {scenarios?* : scenario names (default: all)}
        {--orders=1000 : sales in the offline-day backlog}
        {--servers=4 : API server processes}
        {--port=8100 : first server port}
        {--seed=42 : base RNG seed}';

    protected $description = 'Run chaos scenarios: simulated terminals against real API servers on the sim database';

    /** Point this process at the throwaway sim database. Refuses anything else. */
    public static function useSimDatabase(): void
    {
        config(['database.connections.pgsql.database' => self::DATABASE]);
        DB::purge('pgsql');
        DB::setDefaultConnection('pgsql');
    }

    public function handle(): int
    {
        $names = $this->argument('scenarios') ?: Scenarios::NAMES;
        if ($unknown = array_diff($names, Scenarios::NAMES)) {
            $this->error('Unknown scenario(s): '.implode(', ', $unknown).'. Known: '.implode(', ', Scenarios::NAMES));
            return self::INVALID;
        }

        self::useSimDatabase();
        $this->info('Resetting '.self::DATABASE.' ...');
        Artisan::call('migrate:fresh', ['--force' => true, '--database' => 'pgsql']);

        $pool = new ServerPool((int) $this->option('port'), (int) $this->option('servers'), [
            'DB_CONNECTION' => 'pgsql', 'DB_DATABASE' => self::DATABASE, 'APP_ENV' => 'local', 'APP_DEBUG' => 'false',
            'LOG_LEVEL' => 'warning',
        ]);
        $this->info("Starting {$this->option('servers')} API servers from port {$this->option('port')} ...");
        $pool->start();

        $scenarios = new Scenarios($pool, storage_path('sim'), (int) $this->option('seed'), (int) $this->option('orders'), $this->output);
        $summary = [];

        try {
            foreach ($names as $name) {
                $this->newLine();
                $this->line("<options=bold>▶ {$name}</>");
                $t0 = microtime(true);
                try {
                    $verifier = $scenarios->run($name);
                    $checks = $verifier->checks();
                } catch (\Throwable $e) {
                    $checks = [['scenario completed', false, get_class($e).': '.$e->getMessage()]];
                }
                $secs = round(microtime(true) - $t0, 1);

                foreach ($checks as [$check, $ok, $detail]) {
                    $this->line(sprintf('   %s %-38s %s', $ok ? '<fg=green>✔</>' : '<fg=red>✘</>', $check, $detail));
                }
                $passed = collect($checks)->every(fn ($c) => $c[1]);
                $summary[] = [$name, $passed ? '<fg=green>PASS</>' : '<fg=red>FAIL</>', count($checks), "{$secs}s"];
            }
        } finally {
            $pool->stop();
        }

        $this->newLine();
        $this->table(['Scenario', 'Result', 'Checks', 'Time'], $summary);

        return collect($summary)->every(fn ($r) => str_contains($r[1], 'PASS')) ? self::SUCCESS : self::FAILURE;
    }
}

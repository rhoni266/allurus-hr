<?php

namespace App\Console\Commands;

use App\Models\ProductVariant;
use App\Simulator\Chaos;
use App\Simulator\Server\Hq;
use Illuminate\Console\Command;

/**
 * HQ catalogue churn: price edits whose transactions stay open for a random while after
 * the change-feed row is written. Several of these in parallel is exactly the setup in
 * which a naive bigserial cursor skips late-committing rows.
 */
class SimChurn extends Command
{
    protected $signature = 'sim:churn {--tenant=} {--rounds=50} {--max-hold-ms=80} {--seed=1}';

    protected $description = 'Simulate concurrent HQ catalogue edits (sim database only)';

    public function handle(): int
    {
        SimRun::useSimDatabase();
        Hq::enter($this->option('tenant'));
        $chaos = Chaos::none((int) $this->option('seed'));
        $ids = ProductVariant::pluck('id')->all();

        for ($i = 0; $i < (int) $this->option('rounds'); $i++) {
            Hq::write(function () use ($chaos, $ids) {
                $v = ProductVariant::findOrFail($chaos->pick($ids));
                $v->update(['base_price_sen' => $v->base_price_sen + $chaos->int(1, 9)]);
                usleep($chaos->int(0, (int) $this->option('max-hold-ms')) * 1000);   // hold the tx open
            });
        }

        return self::SUCCESS;
    }
}

<?php

use App\Models\{OfflineSyncQueue, Order};
use App\Sync\{MutationHandler, Outcome};
use App\Sync\Handlers\OrderCreateHandler;
use Illuminate\Database\QueryException;

function failingWith(string $sqlState): MutationHandler
{
    $pdo = new PDOException("sqlstate {$sqlState}");
    $pdo->errorInfo = [$sqlState, 0, 'simulated'];

    return new class($pdo) implements MutationHandler {
        public function __construct(private PDOException $e) {}
        public function handle($t, array $p, $q): Outcome
        {
            Order::query()->getConnection()->select('select 1');   // do some work first
            throw new QueryException('pgsql', 'select 1', [], $this->e);
        }
    };
}

it('asks the terminal to retry on a deadlock and stores nothing', function (string $state) {
    $w = world();
    actAsTerminal($w->terminal);
    app()->bind(OrderCreateHandler::class, fn () => failingWith($state));

    $m = orderMutation($w);
    push($m)->assertOk()->assertJsonPath('results.0.status', 'retry');

    asTenant($w->tenant->id);
    expect(OfflineSyncQueue::find($m['id']))->toBeNull();

    // Once the database recovers, the same mutation applies normally.
    app()->offsetUnset(OrderCreateHandler::class);
    actAsTerminal($w->terminal);
    push($m)->assertJsonPath('results.0.status', 'conflict');   // no stock row seeded -> negative_stock
})->with(['deadlock' => '40P01', 'serialization' => '40001', 'connection' => '08006']);

<?php

namespace App\Simulator;

use Illuminate\Support\Facades\Http;

/** HTTP transport to /api/v1/sync/*, with chaos injected at the network boundary. */
final class SyncClient
{
    public int $requests = 0;
    public int $droppedRequests = 0;
    public int $droppedResponses = 0;
    public int $pushResponses = 0;

    public function __construct(
        private string $baseUrl,
        private string $token,
        private Chaos $chaos,
    ) {}

    /** @return list<array{id:string,client_seq:int,status:string,result:?array}> */
    public function push(array $mutations): array
    {
        $body = $this->send(fn ($http) => $http->post('/api/v1/sync/push', ['mutations' => $mutations]));
        $this->pushResponses++;

        return $body['results'];
    }

    public function pull(int $cursor, int $limit = 500): array
    {
        return $this->send(fn ($http) => $http->get('/api/v1/sync/pull', ['cursor' => $cursor, 'limit' => $limit]));
    }

    private function send(callable $call): array
    {
        $this->requests++;

        if ($this->chaos->chance($this->chaos->dropRequest)) {
            $this->droppedRequests++;
            throw new TransportFailure('chaos: request dropped');
        }

        try {
            $res = $call(Http::baseUrl($this->baseUrl)->withToken($this->token)->acceptJson()->timeout(30));
        } catch (\Illuminate\Http\Client\ConnectionException $e) {
            throw new TransportFailure($e->getMessage(), previous: $e);
        }

        // The server has done the work at this point; losing the response is the nasty case.
        if ($this->chaos->chance($this->chaos->dropResponse)) {
            $this->droppedResponses++;
            throw new TransportFailure('chaos: response dropped');
        }

        if (! $res->successful()) {
            throw new TransportFailure("HTTP {$res->status()}: ".mb_substr($res->body(), 0, 300));
        }

        return $res->json() ?? throw new TransportFailure('Non-JSON response: '.mb_substr($res->body(), 0, 300));
    }
}

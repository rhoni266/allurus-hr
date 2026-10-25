<?php

namespace App\Simulator\Server;

use Symfony\Component\Process\Process;

/**
 * N independent `php -S` API servers on consecutive ports, all on the sim database.
 * php -S handles one request at a time, so real concurrency needs several of them.
 */
final class ServerPool
{
    /** @var list<Process> */
    private array $procs = [];

    public function __construct(private int $basePort, private int $count, private array $env) {}

    public function url(int $i): string
    {
        return 'http://127.0.0.1:'.($this->basePort + ($i % $this->count));
    }

    public function start(): void
    {
        $server = base_path('vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php');

        for ($i = 0; $i < $this->count; $i++) {
            // server.php resolves index.php from the working directory, so run from public/
            $p = new Process([PHP_BINARY, '-S', '127.0.0.1:'.($this->basePort + $i), '-t', public_path(), $server], public_path(), $this->env);
            $p->setTimeout(null);
            $p->start();
            $this->procs[] = $p;
        }

        foreach (range(0, $this->count - 1) as $i) {
            $this->waitReady($this->url($i), $this->procs[$i]);
        }
    }

    public function stop(): void
    {
        foreach ($this->procs as $p) {
            $p->stop(1);
        }
        $this->procs = [];
    }

    private function waitReady(string $url, Process $p): void
    {
        $deadline = microtime(true) + 15;
        while (microtime(true) < $deadline) {
            if (! $p->isRunning()) {
                throw new \RuntimeException("Server {$url} exited: ".$p->getErrorOutput());
            }
            $ctx = stream_context_create(['http' => ['timeout' => 1, 'ignore_errors' => true]]);
            $body = @file_get_contents("{$url}/up", false, $ctx);
            if ($body !== false && str_contains($http_response_header[0] ?? '', '200')) {
                return;
            }
            usleep(100_000);
        }
        throw new \RuntimeException("Server {$url} not ready");
    }
}

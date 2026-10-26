<?php

namespace App\Simulator;

/**
 * The kitchen printer's output: what physically came out, in order. Kept outside the print
 * node's storage, because that's the point: the node can lose track of what it printed,
 * the paper can't.
 */
final class Paper
{
    public function __construct(private string $path)
    {
        file_put_contents($path, '');
    }

    public function print(string $jobId): void
    {
        file_put_contents($this->path, $jobId."\n", FILE_APPEND | LOCK_EX);
    }

    /** @return array<string, int> job id => times printed */
    public function tally(): array
    {
        return array_count_values(array_filter(explode("\n", file_get_contents($this->path))));
    }
}

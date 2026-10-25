<?php

namespace App\Simulator;

use Random\Engine\Mt19937;
use Random\Randomizer;

/** Seeded fault injection, so a failing chaos run can be replayed exactly. */
final class Chaos
{
    private Randomizer $rng;

    public function __construct(
        public readonly float $dropRequest = 0.0,   // request never reaches the server
        public readonly float $dropResponse = 0.0,  // server processed it, terminal never hears back
        public readonly ?int $crashAfterPushes = null, // hard-exit after N push responses, before acks are saved
        int $seed = 1,
    ) {
        $this->rng = new Randomizer(new Mt19937($seed));
    }

    public static function none(int $seed = 1): self
    {
        return new self(seed: $seed);
    }

    public function chance(float $p): bool
    {
        return $p > 0 && $this->rng->nextFloat() < $p;
    }

    public function int(int $min, int $max): int
    {
        return $this->rng->getInt($min, $max);
    }

    public function pick(array $items): mixed
    {
        return $items[$this->rng->pickArrayKeys($items, 1)[0]];
    }
}

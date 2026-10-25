<?php

namespace App\Sync;

/** Permanent rejection: stored, returned on every replay, held on the terminal for manager review. */
final class MutationRejected extends \RuntimeException
{
    public function __construct(public readonly string $reason, public readonly array $detail = [])
    {
        parent::__construct($reason);
    }
}

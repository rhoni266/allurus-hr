<?php

namespace App\Sync;

/**
 * The mutation refers to something the server hasn't received yet, typically an order
 * rung up on another terminal that is still offline. The push controller answers `retry`
 * and stores nothing, until the mutation is older than WAIT_HOURS; then it is rejected
 * for manager review instead of retrying forever.
 */
final class DependencyMissing extends \RuntimeException
{
    public const WAIT_HOURS = 72;

    public function __construct(public readonly string $entity, public readonly string $id)
    {
        parent::__construct("{$entity} {$id} not synced yet");
    }
}

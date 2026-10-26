<?php

namespace App\Delivery;

use App\Delivery\Contracts\DeliveryProvider;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

final class ProviderRegistry
{
    /** @var array<string, DeliveryProvider> */
    private array $providers = [];

    /** @param iterable<DeliveryProvider> $providers */
    public function __construct(iterable $providers)
    {
        foreach ($providers as $p) {
            $this->providers[$p->key()] = $p;
        }
    }

    public function get(string $key): DeliveryProvider
    {
        return $this->providers[$key] ?? throw new NotFoundHttpException('Unknown delivery provider.');
    }
}

<?php

namespace App\Simulator;

/** Everything a simulated terminal needs to know about its server-side world. Serialisable. */
final class World
{
    public function __construct(
        public readonly string $tenantId,
        public readonly string $outletId,
        public readonly string $region,
        /** @var list<array{id:string,name:string,token:string}> */
        public readonly array $terminals,
        /** @var list<string> */
        public readonly array $variantIds,
        public readonly int $initialStockMilli,
        /**
         * PricingEngine `tax_rules` input. Stand-in until national tax rules get their own
         * pull path; the real terminal will receive them by sync.
         */
        public readonly array $taxRules,
        /** PricingEngine `service_charge` input, or null for none. */
        public readonly ?array $serviceCharge = null,
    ) {}

    public function terminal(string $name): array
    {
        foreach ($this->terminals as $t) {
            if ($t['name'] === $name) {
                return $t;
            }
        }
        throw new \InvalidArgumentException("No terminal {$name}");
    }

    public function save(string $path): void
    {
        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0777, true);
        }
        file_put_contents($path, json_encode(get_object_vars($this), JSON_PRETTY_PRINT));
    }

    public static function load(string $path): self
    {
        $d = json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);

        return new self(...$d);
    }
}

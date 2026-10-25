<?php

namespace App\Simulator;

/** Everything a simulated terminal needs to know about its server-side world. Serialisable. */
final class World
{
    public function __construct(
        public readonly string $tenantId,
        public readonly string $outletId,
        public readonly string $region,
        /** @var list<array{name:string, code?:string, id?:string, token?:string}> code before pairing; id + token after */
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
        /** The cashier who signs in and rings up sales: ['id' => ..., 'pin' => ...] */
        public readonly ?array $staff = null,
    ) {}

    /** @param list<array{name:string,id:string,token:string}> $terminals */
    public function withTerminals(array $terminals): self
    {
        $d = get_object_vars($this);
        $d['terminals'] = $terminals;

        return new self(...$d);
    }

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

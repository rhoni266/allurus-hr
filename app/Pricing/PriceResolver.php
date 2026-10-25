<?php

namespace App\Pricing;

use App\Models\{PriceOverride, ProductVariant};
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;

/**
 * Server-side twin of the terminal's price lookup. Precedence: outlet override >
 * region override > variant base price. Must match the shared spec / golden vectors.
 */
class PriceResolver
{
    /**
     * @param Collection<string, ProductVariant> $variants keyed by id
     * @return array<string, int> variant_id => price_sen at $at
     */
    public function resolveMany(Collection $variants, string $outletId, ?string $regionCode, CarbonInterface $at): array
    {
        $overrides = PriceOverride::query()
            ->whereIn('variant_id', $variants->keys())
            ->where(function ($q) use ($outletId, $regionCode) {
                $q->where(fn ($q) => $q->where('scope', 'outlet')->where('scope_key', $outletId));
                if ($regionCode !== null) {
                    $q->orWhere(fn ($q) => $q->where('scope', 'region')->where('scope_key', $regionCode));
                }
            })
            ->where(fn ($q) => $q->whereNull('valid_from')->orWhere('valid_from', '<=', $at))
            ->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>', $at))
            ->get()
            ->groupBy('variant_id');

        $prices = [];
        foreach ($variants as $id => $variant) {
            $forVariant = $overrides->get($id, collect());
            $override = $forVariant->firstWhere('scope', 'outlet') ?? $forVariant->firstWhere('scope', 'region');
            $prices[$id] = (int) ($override?->price_sen ?? $variant->base_price_sen);
        }

        return $prices;
    }
}

<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** National tax rule (not tenant-scoped). Rates are data; never hard-code them. */
class TaxRule extends Model
{
    use HasUuids, UuidModel {
        UuidModel::getIncrementing insteadof HasUuids;
        UuidModel::getKeyType insteadof HasUuids;
    }

    protected $guarded = [];
    protected $casts = ['rate_bps' => 'integer', 'version' => 'integer', 'effective_from' => 'date', 'effective_to' => 'date'];

    /**
     * The rules in force on $date, shaped as PricingEngine's `tax_rules` input:
     * ['SST_SERVICE' => ['rate_bps' => 800, 'version' => 2], ...]
     */
    public static function forPricing(CarbonInterface $date): array
    {
        $day = $date->toDateString();

        return static::query()
            ->where('effective_from', '<=', $day)
            ->where(fn ($q) => $q->whereNull('effective_to')->orWhere('effective_to', '>', $day))
            ->orderBy('code')->orderByDesc('version')
            ->get()
            ->unique('code')
            ->mapWithKeys(fn (self $r) => [$r->code => ['rate_bps' => $r->rate_bps, 'version' => $r->version]])
            ->all();
    }
}

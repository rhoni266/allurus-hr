<?php

namespace App\Models;

use App\Billing\PricingEngine;
use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DeliveryMenuMapping extends Model
{
    use BelongsToTenant, UuidModel;

    protected $guarded = [];
    protected $casts = ['price_sen' => 'integer', 'markup_bps' => 'integer', 'is_listed' => 'boolean', 'is_available' => 'boolean'];

    public function variant(): BelongsTo { return $this->belongsTo(ProductVariant::class, 'variant_id')->withTrashed(); }
    public function connection(): BelongsTo { return $this->belongsTo(DeliveryConnection::class, 'connection_id'); }

    /** What the customer pays on the platform: explicit price, else base + markup, else base. */
    public function deliveryPriceSen(): int
    {
        if ($this->price_sen !== null) {
            return $this->price_sen;
        }
        $base = $this->variant->base_price_sen;

        return $this->markup_bps !== null ? PricingEngine::divHalfUp($base * (10000 + $this->markup_bps), 10000) : $base;
    }
}

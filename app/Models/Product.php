<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Product extends Model
{
    use BelongsToTenant, SoftDeletes, UuidModel;

    protected $guarded = [];
    protected $casts = ['time_billing' => 'array', 'has_variants' => 'boolean', 'track_stock' => 'boolean'];

    public function variants(): HasMany
    {
        return $this->hasMany(ProductVariant::class);
    }
}

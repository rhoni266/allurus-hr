<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

class PriceOverride extends Model
{
    use BelongsToTenant, UuidModel;

    protected $guarded = [];
    protected $casts = ['price_sen' => 'integer', 'valid_from' => 'immutable_datetime', 'valid_to' => 'immutable_datetime'];
}

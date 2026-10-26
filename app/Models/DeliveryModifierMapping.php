<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

class DeliveryModifierMapping extends Model
{
    use BelongsToTenant, UuidModel;

    protected $guarded = [];
    protected $casts = ['price_delta_sen' => 'integer', 'is_available' => 'boolean'];
}

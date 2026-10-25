<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

class OrderItem extends Model
{
    use BelongsToTenant, UuidModel;

    public $timestamps = false;
    protected $guarded = [];
    protected $casts = [
        'modifiers'         => 'array',
        'qty_milli'         => 'integer',
        'net_sen'           => 'integer',
        'unit_price_sen'    => 'integer',
        'catalog_price_sen' => 'integer',
        'occurred_at'       => 'immutable_datetime',
    ];
}

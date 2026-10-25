<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

class StockCountLine extends Model
{
    use BelongsToTenant, UuidModel;

    public $timestamps = false;
    protected $guarded = [];
    protected $casts = ['counted_milli' => 'integer', 'expected_milli' => 'integer', 'delta_milli' => 'integer', 'counted_at' => 'immutable_datetime'];
}

<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

/** Stock ledger (source of truth). stock_levels is a projection of it. */
class StockMovement extends Model
{
    use BelongsToTenant, UuidModel;

    public $timestamps = false;
    protected $guarded = [];
    protected $casts = ['occurred_at' => 'immutable_datetime', 'qty_delta_milli' => 'integer'];
}

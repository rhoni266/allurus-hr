<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

class OrderRefundLine extends Model
{
    use BelongsToTenant, UuidModel;

    public $timestamps = false;
    protected $guarded = [];
    protected $casts = ['qty_milli' => 'integer', 'restock' => 'boolean'];
}

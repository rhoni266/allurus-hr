<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

class Payment extends Model
{
    use BelongsToTenant, UuidModel;

    public $timestamps = false;
    protected $guarded = [];
    protected $casts = ['gateway_payload' => 'array', 'amount_sen' => 'integer', 'occurred_at' => 'immutable_datetime'];
}

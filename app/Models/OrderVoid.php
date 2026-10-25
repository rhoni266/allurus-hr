<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

class OrderVoid extends Model
{
    use BelongsToTenant, UuidModel;

    const UPDATED_AT = null;

    protected $guarded = [];
    protected $casts = ['occurred_at' => 'immutable_datetime'];
}

<?php

namespace App\Models;

use App\Models\Concerns\PreciseTimestamps;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

class SyncConflict extends Model
{
    use BelongsToTenant, PreciseTimestamps;

    public $incrementing = false;
    protected $keyType = 'string';
    protected $guarded = [];
    protected $casts = ['detail' => 'array'];
}

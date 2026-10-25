<?php

namespace App\Models;

use App\Models\Concerns\PreciseTimestamps;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

class OfflineSyncQueue extends Model
{
    use BelongsToTenant, PreciseTimestamps;

    public $timestamps = false;
    public $incrementing = false;
    protected $keyType = 'string';
    protected $guarded = [];

    protected $casts = [
        'payload'           => 'array',
        'result'            => 'array',
        'client_created_at' => 'immutable_datetime',
        'processed_at'      => 'immutable_datetime',
    ];
}

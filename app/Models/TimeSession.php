<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

class TimeSession extends Model
{
    use BelongsToTenant, UuidModel;

    const UPDATED_AT = null;

    protected $guarded = [];
    protected $casts = [
        'rate_snapshot' => 'array', 'started_at' => 'immutable_datetime', 'ended_at' => 'immutable_datetime',
        'paused_seconds' => 'integer', 'billed_minutes' => 'integer', 'amount_sen' => 'integer', 'server_amount_sen' => 'integer',
    ];
}

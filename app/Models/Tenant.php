<?php

namespace App\Models;

use App\Models\Concerns\PreciseTimestamps;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Tenant extends Model
{
    use HasUuids, SoftDeletes, PreciseTimestamps;

    protected $guarded = [];
    protected $casts = ['settings' => 'array'];
}

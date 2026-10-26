<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

/** A printer on an outlet's LAN, driven by a print node there; the cloud never connects to it. */
class Printer extends Model
{
    use BelongsToTenant, UuidModel;

    protected $guarded = [];
    protected $casts = ['connection' => 'array', 'is_active' => 'boolean'];
}

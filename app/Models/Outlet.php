<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

class Outlet extends Model
{
    use BelongsToTenant, UuidModel;

    protected $guarded = [];
    protected $casts = ['settings' => 'array', 'sst_applicable' => 'boolean'];
}

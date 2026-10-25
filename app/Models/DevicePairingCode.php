<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use Illuminate\Database\Eloquent\Model;

/**
 * Deliberately NOT tenant-scoped (no BelongsToTenant, no RLS): it is redeemed by an
 * unauthenticated device, before a tenant is known. Look it up only by code_hash.
 */
class DevicePairingCode extends Model
{
    use UuidModel;

    public $timestamps = false;
    protected $guarded = [];
    protected $casts = ['expires_at' => 'immutable_datetime', 'used_at' => 'immutable_datetime', 'created_at' => 'immutable_datetime'];
}

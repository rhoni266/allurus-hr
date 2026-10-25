<?php

namespace App\Models;

use App\Models\Concerns\PreciseTimestamps;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

/**
 * A paired POS device. Authenticates with a Sanctum token carrying `pos:terminal`.
 * Deliberately NOT tenant-scoped: it is looked up during auth, before a tenant is known.
 */
class Terminal extends Authenticatable
{
    use HasApiTokens, HasUuids, PreciseTimestamps;

    protected $guarded = [];
    protected $casts = ['last_seen_at' => 'immutable_datetime'];

    public function outlet(): BelongsTo
    {
        return $this->belongsTo(Outlet::class);
    }

    public function newUniqueId(): string
    {
        return (string) \Illuminate\Support\Str::uuid7();
    }
}

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
    protected $casts = [
        'last_seen_at' => 'immutable_datetime', 'paired_at' => 'immutable_datetime',
        'retire_requested_at' => 'immutable_datetime', 'revoked_at' => 'immutable_datetime',
        'wipe_requested_at' => 'immutable_datetime', 'wipe_confirmed_at' => 'immutable_datetime',
        'outbox_pending' => 'integer',
        'last_heartbeat_at' => 'immutable_datetime', 'heartbeat' => 'array',
    ];

    public const KIND_TERMINAL = 'terminal';
    public const KIND_KITCHEN = 'kitchen';   // KDS screen or print node: pos:kitchen, no sales

    public const ACTIVE = 'active';
    public const RETIRING = 'retiring';
    public const REVOKED = 'revoked';

    public function outlet(): BelongsTo
    {
        return $this->belongsTo(Outlet::class);
    }

    public function newUniqueId(): string
    {
        return (string) \Illuminate\Support\Str::uuid7();
    }
}

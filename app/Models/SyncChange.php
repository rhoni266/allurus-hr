<?php

namespace App\Models;

use App\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Model;

/**
 * Read model for the pull feed. Rows are written only by the sync_record_change()
 * Postgres trigger (migration 000060), never from PHP.
 */
class SyncChange extends Model
{
    public $timestamps = false;
    protected $guarded = [];
    protected $primaryKey = 'seq';

    protected static function booted(): void
    {
        // Tenant scope only; seq is a bigint so BelongsToTenant's uuid key logic doesn't apply.
        static::addGlobalScope(new TenantScope);
    }
}

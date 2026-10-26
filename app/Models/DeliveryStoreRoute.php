<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Read-only routing row: (provider, external store) -> tenant + connection. No RLS and no
 * secrets; written only by the delivery_route_sync trigger. Look it up only by
 * (provider, external_store_id).
 */
class DeliveryStoreRoute extends Model
{
    public $timestamps = false;
    public $incrementing = false;
    protected $primaryKey = 'connection_id';
    protected $keyType = 'string';
    protected $guarded = ['*'];
}

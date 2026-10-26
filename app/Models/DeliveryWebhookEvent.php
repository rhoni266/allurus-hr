<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

/** An inbound webhook, stored only after its signature checked out. */
class DeliveryWebhookEvent extends Model
{
    use BelongsToTenant, UuidModel;

    public $timestamps = false;
    protected $guarded = [];
    protected $casts = ['received_at' => 'immutable_datetime', 'processed_at' => 'immutable_datetime'];
}

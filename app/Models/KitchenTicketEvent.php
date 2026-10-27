<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

/** One KDS tap (ticket.status). Append-only; kitchen_tickets.status is the projection. */
class KitchenTicketEvent extends Model
{
    use BelongsToTenant, UuidModel;

    public const UPDATED_AT = null;

    protected $guarded = [];
    protected $casts = ['occurred_at' => 'immutable_datetime', 'applied' => 'boolean'];
}

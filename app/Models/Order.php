<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Partitioned on occurred_at; id is generated on the terminal. Append-mostly. */
class Order extends Model
{
    use BelongsToTenant, UuidModel;

    const UPDATED_AT = null;

    protected $guarded = [];
    protected $casts = [
        'tax_breakdown'   => 'array',
        'created_offline' => 'boolean',
        'occurred_at'     => 'immutable_datetime',
        'synced_at'       => 'immutable_datetime',
    ];

    public function items(): HasMany { return $this->hasMany(OrderItem::class); }
    public function payments(): HasMany { return $this->hasMany(Payment::class); }
}

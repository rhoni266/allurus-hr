<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** The platform's view of an order (fees, commission, raw payload); orders holds ours. */
class DeliveryOrder extends Model
{
    use BelongsToTenant, UuidModel;

    protected $guarded = [];
    protected $hidden = ['raw_payload'];   // never sent to terminals; audit/replay only
    protected $casts = [
        'customer' => 'array', 'attention_reasons' => 'array', 'raw_payload' => 'array', 'needs_attention' => 'boolean',
        'placed_at' => 'immutable_datetime', 'accept_by' => 'immutable_datetime', 'pickup_eta' => 'immutable_datetime',
        'items_total_sen' => 'integer', 'platform_total_sen' => 'integer',
    ];

    public function connection(): BelongsTo { return $this->belongsTo(DeliveryConnection::class, 'connection_id'); }
    public function order(): BelongsTo { return $this->belongsTo(Order::class); }
}

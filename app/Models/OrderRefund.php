<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class OrderRefund extends Model
{
    use BelongsToTenant, UuidModel;

    const UPDATED_AT = null;

    protected $guarded = [];
    protected $casts = ['refund_sen' => 'integer', 'server_refund_sen' => 'integer', 'occurred_at' => 'immutable_datetime'];

    public function lines(): HasMany
    {
        return $this->hasMany(OrderRefundLine::class, 'refund_id');
    }
}

<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** What the kitchen must make for one order. A feed row; the broadcast only rings the bell. */
class KitchenTicket extends Model
{
    use BelongsToTenant, UuidModel;

    protected $guarded = [];
    protected $casts = ['lines' => 'array', 'fired_at' => 'immutable_datetime', 'cancelled_at' => 'immutable_datetime',
        'preparing_at' => 'immutable_datetime', 'ready_at' => 'immutable_datetime', 'bumped_at' => 'immutable_datetime'];

    public function printJobs(): HasMany { return $this->hasMany(PrintJob::class, 'ticket_id'); }
}

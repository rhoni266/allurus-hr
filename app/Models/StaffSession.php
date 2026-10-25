<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StaffSession extends Model
{
    use BelongsToTenant, UuidModel;

    public $timestamps = false;
    protected $guarded = [];
    protected $hidden = ['token_hash'];
    protected $casts = [
        'expires_at' => 'immutable_datetime', 'revoked_at' => 'immutable_datetime',
        'last_used_at' => 'immutable_datetime', 'created_at' => 'immutable_datetime',
    ];

    public function staff(): BelongsTo
    {
        return $this->belongsTo(Staff::class);
    }
}

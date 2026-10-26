<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

/** One thing for one printer to print, acked by the print node that printed it. */
class PrintJob extends Model
{
    use BelongsToTenant, UuidModel;

    protected $guarded = [];
    protected $casts = ['payload' => 'array', 'printed_at' => 'immutable_datetime', 'attempts' => 'integer'];
}

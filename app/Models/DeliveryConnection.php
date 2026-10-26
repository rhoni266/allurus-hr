<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\{BelongsTo, HasMany};

/**
 * One outlet's store on one delivery platform or aggregator. Credentials and the webhook
 * secret are encrypted at rest (APP_KEY) and never serialised. Its (provider,
 * external_store_id) is mirrored into delivery_store_routes by a trigger, so a webhook can
 * find the tenant before RLS lets it see this row.
 */
class DeliveryConnection extends Model
{
    use BelongsToTenant, UuidModel;

    protected $guarded = [];
    protected $hidden = ['credentials', 'webhook_secret'];
    protected $casts = [
        'credentials' => 'encrypted:array', 'webhook_secret' => 'encrypted', 'settings' => 'array',
        'auto_accept' => 'boolean', 'last_event_at' => 'immutable_datetime', 'last_menu_sync_at' => 'immutable_datetime',
        'paused_at' => 'immutable_datetime', 'kitchen_quiet_since' => 'immutable_datetime',
    ];

    public function menuMappings(): HasMany { return $this->hasMany(DeliveryMenuMapping::class, 'connection_id'); }
    public function modifierMappings(): HasMany { return $this->hasMany(DeliveryModifierMapping::class, 'connection_id'); }
    public function outlet(): BelongsTo { return $this->belongsTo(Outlet::class); }

    /** Accepting orders (paused stores still receive orders already placed). */
    public function receivesOrders(): bool
    {
        return in_array($this->status, ['active', 'paused'], true);
    }
}

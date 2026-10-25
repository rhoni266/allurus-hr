<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;

/**
 * Permission to sign in offline on one terminal until expires_at. No secret here: the PIN
 * verifier is sealed on the device by a hardware key (docs/offline-pin-signin.md, option C).
 * Revoked by a database trigger on deactivation or PIN change.
 */
class StaffCredential extends Model
{
    use BelongsToTenant, UuidModel;

    public const OFFLINE_WINDOW_DAYS = 7;

    protected $guarded = [];
    protected $casts = [
        'issued_at' => 'immutable_datetime', 'expires_at' => 'immutable_datetime', 'revoked_at' => 'immutable_datetime',
        'pin_version' => 'integer',
    ];

    /**
     * Was an offline sign-in at $at (device clock) covered by this credential?
     * Deliberately no "before issue" check: the device can't hold a credential before it
     * was issued, so that would only ever catch clock skew between device and server.
     * Expiry and revocation remain clock-sensitive; see the clock-skew gap in CLAUDE.md.
     */
    public function validAt(CarbonInterface $at): bool
    {
        return $at->lte($this->expires_at) && ($this->revoked_at === null || $at->lt($this->revoked_at));
    }
}

<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Hash;

class Staff extends Model
{
    use BelongsToTenant, UuidModel;

    /** Roles that can void and correct stock: their PIN is worth guessing, so 6+ digits. */
    public const LONG_PIN_ROLES = ['owner', 'manager'];

    protected $table = 'staff';
    protected $guarded = [];
    protected $hidden = ['pin_hash', 'pin_length'];
    protected $casts = ['is_active' => 'boolean', 'pin_version' => 'integer', 'pin_length' => 'integer'];

    public static function minPinLength(string $role): int
    {
        return in_array($role, self::LONG_PIN_ROLES, true) ? 6 : 4;
    }

    /**
     * Set (or change) the PIN. Changing it bumps pin_version, which revokes this person's
     * offline credentials via a database trigger.
     *
     * @throws \InvalidArgumentException when the PIN is too short for the role
     */
    public function setPin(string $pin): static
    {
        $min = self::minPinLength($this->role);
        if (! preg_match('/^\d{'.$min.',8}$/', $pin)) {
            throw new \InvalidArgumentException("A {$this->role} PIN must be {$min} to 8 digits.");
        }

        $this->pin_hash = Hash::make($pin);
        $this->pin_length = strlen($pin);
        if ($this->exists) {
            $this->pin_version = ($this->pin_version ?? 1) + 1;
        }

        return $this;
    }

    public function checkPin(string $pin): bool
    {
        return $this->is_active && Hash::check($pin, $this->pin_hash);
    }

    /** e.g. a cashier promoted to manager still has a 4-digit PIN */
    public function needsLongerPin(): bool
    {
        return ($this->pin_length ?? 0) < self::minPinLength($this->role);
    }
}

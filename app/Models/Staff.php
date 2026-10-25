<?php

namespace App\Models;

use App\Models\Concerns\UuidModel;
use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Hash;

class Staff extends Model
{
    use BelongsToTenant, UuidModel;

    protected $table = 'staff';
    protected $guarded = [];
    protected $hidden = ['pin_hash'];
    protected $casts = ['is_active' => 'boolean'];

    public function setPin(string $pin): static
    {
        $this->pin_hash = Hash::make($pin);

        return $this;
    }

    public function checkPin(string $pin): bool
    {
        return $this->is_active && Hash::check($pin, $this->pin_hash);
    }
}

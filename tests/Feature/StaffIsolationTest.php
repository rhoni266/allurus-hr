<?php

use App\Models\Staff;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

it('keeps staff isolated between tenants via scope and RLS', function () {
    $a = world();
    $aStaff = (new Staff(['name' => 'A cashier', 'role' => 'cashier']))->setPin('2222');
    $aStaff->save();

    $b = world();   // tenant B active

    expect(Staff::find($aStaff->id))->toBeNull()
        ->and(DB::table('staff')->where('id', $aStaff->id)->exists())->toBeFalse()
        ->and(fn () => DB::transaction(fn () => DB::table('staff')->insert([
            'id' => (string) Str::uuid7(), 'tenant_id' => $a->tenant->id,
            'name' => 'Sneaky', 'role' => 'owner', 'pin_hash' => 'x', 'created_at' => now(), 'updated_at' => now(),
        ])))->toThrow(\Illuminate\Database\QueryException::class, 'row-level security');

    asTenant($a->tenant->id);
    expect(Staff::find($aStaff->id))->not->toBeNull();
});

it('stores a hash, never the PIN, and checks it', function () {
    world();
    $s = (new Staff(['name' => 'X', 'role' => 'cashier']))->setPin('1111');
    $s->save();

    $raw = DB::table('staff')->where('id', $s->id)->value('pin_hash');
    expect($raw)->not->toContain('1111')
        ->and($s->fresh()->checkPin('1111'))->toBeTrue()
        ->and($s->fresh()->checkPin('1112'))->toBeFalse()
        ->and($s->toArray())->not->toHaveKey('pin_hash');

    $s->update(['is_active' => false]);
    expect($s->fresh()->checkPin('1111'))->toBeFalse();
});

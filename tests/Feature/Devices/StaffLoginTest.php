<?php

use App\Http\Controllers\Api\StaffAuthController;
use App\Models\{StaffSession, Terminal};
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->w = world();
    $this->staff = staffMember($this->w, 'cashier', '2222');
    actAsTerminal($this->w->terminal);
});

function login(string $staffId, string $pin): \Illuminate\Testing\TestResponse
{
    return test()->postJson('/api/v1/auth/login', ['staff_id' => $staffId, 'pin' => $pin]);
}

it('signs in with the right PIN and the session identifies the staff member', function () {
    $token = login($this->staff->id, '2222')->assertCreated()
        ->assertJsonPath('staff.id', $this->staff->id)->assertJsonMissingPath('staff.pin_hash')
        ->json('session_token');

    $this->withHeader('X-Staff-Session', $token)->getJson('/api/v1/auth/me')
        ->assertOk()->assertJsonPath('staff.role', 'cashier');

    asTenant($this->w->tenant->id);
    expect(DB::table('staff_sessions')->value('token_hash'))->toBe(hash('sha256', $token));   // hash only
});

it('signs out', function () {
    $token = login($this->staff->id, '2222')->json('session_token');

    $this->withHeader('X-Staff-Session', $token)->postJson('/api/v1/auth/logout')->assertNoContent();
    $this->withHeader('X-Staff-Session', $token)->getJson('/api/v1/auth/me')->assertUnauthorized();
});

it('gives one answer for a wrong PIN, an unknown staff id and another tenant\'s staff', function () {
    $foreign = staffMember(world(), 'cashier', '2222');
    actAsTerminal($this->w->terminal);

    login($this->staff->id, '9999')->assertUnauthorized()->assertExactJson(['error' => 'invalid_credentials']);
    login((string) Str::uuid7(), '2222')->assertUnauthorized()->assertExactJson(['error' => 'invalid_credentials']);
    login($foreign->id, '2222')->assertUnauthorized()->assertExactJson(['error' => 'invalid_credentials']);
});

it('locks a staff member on this terminal after 5 wrong PINs, even against the right one', function () {
    foreach (range(1, StaffAuthController::MAX_PER_STAFF) as $_) {
        login($this->staff->id, '0000')->assertUnauthorized();
    }

    login($this->staff->id, '2222')->assertStatus(429)->assertJsonPath('error', 'too_many_attempts');

    $this->travel(StaffAuthController::LOCKOUT_SECONDS + 1)->seconds();
    login($this->staff->id, '2222')->assertCreated();
});

it('stops one PIN being sprayed across every staff member on a terminal', function () {
    $others = collect(range(1, 4))->map(fn () => staffMember($this->w, 'cashier', '5555'));
    actAsTerminal($this->w->terminal);

    $attempts = 0;
    foreach ($others as $s) {
        foreach (range(1, 4) as $_) {   // under the per-staff limit each time
            if ($attempts++ < StaffAuthController::MAX_PER_TERMINAL) {
                login($s->id, '1234')->assertUnauthorized();
            }
        }
    }

    login($this->staff->id, '2222')->assertStatus(429);
});

it('refuses staff assigned to a different outlet, but lets all-outlet staff in', function () {
    $elsewhere = staffMember($this->w, 'cashier', '4444', App\Models\Outlet::create(['name' => 'Other', 'region_code' => 'KL'])->id);
    $owner = staffMember($this->w, 'owner', '111111', null);
    actAsTerminal($this->w->terminal);

    login($elsewhere->id, '4444')->assertUnauthorized();
    login($owner->id, '111111')->assertCreated();
});

it('ends sessions when the staff member is deactivated', function () {
    $token = login($this->staff->id, '2222')->json('session_token');

    asTenant($this->w->tenant->id);
    $this->staff->update(['is_active' => false]);
    actAsTerminal($this->w->terminal);

    $this->withHeader('X-Staff-Session', $token)->getJson('/api/v1/auth/me')->assertUnauthorized();
    login($this->staff->id, '2222')->assertUnauthorized();
});

it('expires sessions after a shift', function () {
    $token = login($this->staff->id, '2222')->json('session_token');

    $this->travelTo(now()->addHours(StaffAuthController::SESSION_HOURS)->addMinute());
    actAsTerminal($this->w->terminal);

    $this->withHeader('X-Staff-Session', $token)->getJson('/api/v1/auth/me')->assertUnauthorized();
});

it('refuses a session token copied to another terminal in the same tenant', function () {
    $token = login($this->staff->id, '2222')->json('session_token');

    $other = Terminal::create(['tenant_id' => $this->w->tenant->id, 'outlet_id' => $this->w->outlet->id,
        'name' => 'T2', 'device_fingerprint' => Str::random(24)]);
    actAsTerminal($other);

    $this->withHeader('X-Staff-Session', $token)->getJson('/api/v1/auth/me')->assertUnauthorized();
});

it('keeps staff sessions isolated between tenants, including via raw SQL', function () {
    login($this->staff->id, '2222')->assertCreated();
    $b = world();   // tenant B active

    expect(StaffSession::count())->toBe(0)
        ->and(DB::table('staff_sessions')->count())->toBe(0)
        ->and(fn () => DB::transaction(fn () => DB::table('staff_sessions')->insert([
            'id' => (string) Str::uuid7(), 'tenant_id' => $this->w->tenant->id, 'terminal_id' => $b->terminal->id,
            'staff_id' => $this->staff->id, 'token_hash' => str_repeat('a', 64), 'expires_at' => now()->addHour(),
        ])))->toThrow(\Illuminate\Database\QueryException::class, 'row-level security');
});

it('sends the staff list to terminals without PIN hashes, routed by outlet', function () {
    $other = App\Models\Outlet::create(['name' => 'Other', 'region_code' => 'KL']);
    staffMember($this->w, 'cashier', '4444', $other->id);
    $owner = staffMember($this->w, 'owner', '111111', null);
    actAsTerminal($this->w->terminal);

    $staff = collect($this->getJson('/api/v1/sync/pull?cursor=0')->json('changes'))->where('entity', 'staff');

    expect($staff->pluck('id')->all())->toBe([$this->staff->id, $owner->id])   // not the other outlet's cashier
        ->and($staff->pluck('data')->flatMap(fn ($d) => array_keys($d))->unique()->all())->not->toContain('pin_hash')
        ->and(json_encode($staff->all()))->not->toContain('$2y$');
});

<?php

use App\Devices\PairingService;
use App\Models\{DevicePairingCode, Outlet, StaffSession, Terminal};
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

function issueCode(object $w, ?Outlet $outlet = null): string
{
    asTenant($w->tenant->id);

    return app(PairingService::class)->issue($outlet ?? $w->outlet)['code'];
}

function register(string $code, ?string $fingerprint = null): \Illuminate\Testing\TestResponse
{
    app('auth')->forgetGuards();

    return test()->postJson('/api/v1/devices/register', [
        'code' => $code, 'device_fingerprint' => $fingerprint ?? 'device-'.Str::random(24), 'name' => 'Counter 2',
    ]);
}

beforeEach(fn () => $this->w = world());

it('pairs a new device and the token works for sync', function () {
    $res = register(issueCode($this->w))->assertCreated();

    $terminal = Terminal::find($res->json('terminal.id'));
    expect($terminal)->tenant_id->toBe($this->w->tenant->id)->outlet_id->toBe($this->w->outlet->id)->name->toBe('Counter 2')
        ->and($terminal->paired_at)->not->toBeNull()
        ->and($terminal->tokens()->first()->abilities)->toBe(['pos:terminal']);   // nothing else

    asDevice($res->json('token'))->getJson('/api/v1/sync/pull?cursor=0')->assertOk()
        ->assertJsonPath('changes.0.entity', 'product');
});

it('accepts the code in any case, with or without the dash', function () {
    $code = issueCode($this->w);

    register(strtolower(str_replace('-', ' ', $code)))->assertCreated();
});

it('uses a code once only', function () {
    $code = issueCode($this->w);
    register($code)->assertCreated();

    register($code)->assertStatus(422)->assertExactJson(['error' => 'invalid_or_expired_code']);
});

it('rejects an expired code', function () {
    $code = issueCode($this->w);
    $this->travel(PairingService::TTL_MINUTES + 1)->minutes();

    register($code)->assertStatus(422)->assertExactJson(['error' => 'invalid_or_expired_code']);
});

it('gives the same answer for an unknown code, so codes cannot be probed', function () {
    register('ABCD-EFGH')->assertStatus(422)->assertExactJson(['error' => 'invalid_or_expired_code']);
});

it('stores only a hash of the code', function () {
    $code = issueCode($this->w);
    $plain = str_replace('-', '', $code);

    $row = DB::table('device_pairing_codes')->first();
    expect(json_encode($row))->not->toContain($plain)
        ->and($row->code_hash)->toBe(hash('sha256', $plain));
});

it('re-pairing a device revokes its old token and staff sessions', function () {
    $fingerprint = 'device-'.Str::random(24);
    $first = register(issueCode($this->w), $fingerprint)->json();

    // a staff member signed in on the old pairing
    $staff = staffMember($this->w);
    asDevice($first['token'])->postJson('/api/v1/auth/login', ['staff_id' => $staff->id, 'pin' => '2222'])->assertCreated();

    asTenant($this->w->tenant->id);   // the request cleared it on the way out
    $other = Outlet::create(['name' => 'Second', 'region_code' => 'KL']);
    $second = register(issueCode($this->w, $other), $fingerprint)->assertCreated()->json();

    expect($second['terminal']['id'])->toBe($first['terminal']['id'])          // same device row
        ->and($second['terminal']['outlet_id'])->toBe($other->id);
    asDevice($first['token'])->getJson('/api/v1/sync/pull')->assertUnauthorized();
    asDevice($second['token'])->getJson('/api/v1/sync/pull')->assertOk();

    asTenant($this->w->tenant->id);
    expect(StaffSession::whereNull('revoked_at')->count())->toBe(0);
});

it("won't take over a device paired to another merchant, and leaves the code unused", function () {
    $fingerprint = 'device-'.Str::random(24);
    register(issueCode($this->w), $fingerprint)->assertCreated();

    $other = world();
    $code = issueCode($other);
    register($code, $fingerprint)->assertStatus(409)->assertExactJson(['error' => 'device_registered_elsewhere']);

    expect(DevicePairingCode::where('code_hash', PairingService::hash($code))->value('used_at'))->toBeNull();
});

it('rate-limits the public pairing endpoint', function () {
    foreach (range(1, 10) as $_) {
        register('ZZZZ-ZZZZ')->assertStatus(422);
    }
    register('ZZZZ-ZZZZ')->assertStatus(429);
});

describe('issuing codes from a terminal', function () {
    it('lets a manager issue a code for their outlet, and the code pairs', function () {
        $session = signIn($this->w, staffMember($this->w, 'manager', '111111'), '111111');

        $code = $this->withHeader('X-Staff-Session', $session)->postJson('/api/v1/devices/pairing-codes')
            ->assertCreated()->assertJsonPath('outlet_id', $this->w->outlet->id)->json('code');

        expect($code)->toMatch('/^[A-Z2-9]{4}-[A-Z2-9]{4}$/');
        register($code)->assertCreated()->assertJsonPath('terminal.outlet_id', $this->w->outlet->id);
    });

    it('refuses cashiers', function () {
        $session = signIn($this->w, staffMember($this->w, 'cashier'));

        $this->withHeader('X-Staff-Session', $session)->postJson('/api/v1/devices/pairing-codes')->assertForbidden();
    });

    it('refuses without a staff session', function () {
        actAsTerminal($this->w->terminal);

        $this->postJson('/api/v1/devices/pairing-codes')->assertUnauthorized();
    });

    it('keeps managers to their own outlet but lets owners choose', function () {
        $other = Outlet::create(['name' => 'Second', 'region_code' => 'KL']);

        $manager = signIn($this->w, staffMember($this->w, 'manager', '111111'), '111111');
        $this->withHeader('X-Staff-Session', $manager)->postJson('/api/v1/devices/pairing-codes', ['outlet_id' => $other->id])->assertForbidden();

        $owner = signIn($this->w, staffMember($this->w, 'owner', '333333', null), '333333');
        $this->withHeader('X-Staff-Session', $owner)->postJson('/api/v1/devices/pairing-codes', ['outlet_id' => $other->id])
            ->assertCreated()->assertJsonPath('outlet_id', $other->id);
    });

    it("can't issue a code for another tenant's outlet", function () {
        $foreign = world()->outlet;
        $owner = signIn($this->w, staffMember($this->w, 'owner', '333333', null), '333333');

        $this->withHeader('X-Staff-Session', $owner)->postJson('/api/v1/devices/pairing-codes', ['outlet_id' => $foreign->id])->assertNotFound();
    });
});

it('issues a code from the CLI', function () {
    $this->artisan('pos:pairing-code', ['tenant' => $this->w->tenant->slug, 'outlet' => $this->w->outlet->id])
        ->expectsOutputToContain('Pairing code for Main:')
        ->assertSuccessful();

    expect(DevicePairingCode::count())->toBe(1);
});

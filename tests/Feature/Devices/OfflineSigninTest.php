<?php

use App\Devices\Attestation\{AppAttestAttestation, Attestation, DevAttestation, PlayIntegrityAttestation};
use App\Models\{Staff, StaffCredential, StaffSession, SyncChange};
use Illuminate\Support\Facades\{DB, Http};
use Illuminate\Support\Str;

/** A fresh challenge + dev attestation token for it. */
function attest(string $verdict = 'MEETS_DEVICE_INTEGRITY', string $platform = 'android'): array
{
    $nonce = Attestation::challenge()['nonce'];

    return ['platform' => $platform, 'nonce' => $nonce, 'token' => DevAttestation::token($nonce, $verdict)];
}

function loginWith(object $w, Staff $s, string $pin, ?array $attestation = null): \Illuminate\Testing\TestResponse
{
    app('auth')->forgetGuards();
    test()->flushHeaders();
    actAsTerminal($w->terminal);

    return test()->postJson('/api/v1/auth/login', array_filter(['staff_id' => $s->id, 'pin' => $pin, 'attestation' => $attestation]));
}

/** An order.create signed in offline with $credentialId at $signedInAt. */
function offlineSale(object $w, int $seq, string $credentialId, string $signedInAt, ?string $staffId = null): array
{
    $m = orderMutation($w, $seq, order: $staffId ? ['staff_id' => $staffId] : []);
    $m['auth'] = ['mode' => 'offline', 'credential_id' => $credentialId, 'signed_in_at' => $signedInAt];

    return $m;
}

beforeEach(function () {
    config(['pos.attestation.required' => true]);
    $this->w = world();
    seedStock($this->w, 100_000);
    $this->cashier = staffMember($this->w, 'cashier', '2222');
    $this->w->cashier = $this->cashier;
});

describe('PIN rules', function () {
    it('needs 6 digits for owners and managers, 4 for cashiers', function () {
        asTenant($this->w->tenant->id);
        expect(fn () => (new Staff(['name' => 'M', 'role' => 'manager']))->setPin('1234'))->toThrow(InvalidArgumentException::class)
            ->and(fn () => (new Staff(['name' => 'O', 'role' => 'owner']))->setPin('12345'))->toThrow(InvalidArgumentException::class)
            ->and((new Staff(['name' => 'M', 'role' => 'manager']))->setPin('123456')->pin_length)->toBe(6)
            ->and((new Staff(['name' => 'C', 'role' => 'cashier']))->setPin('1234')->pin_length)->toBe(4);
    });

    it('asks a promoted cashier with a 4-digit PIN to get a 6-digit one, without a session', function () {
        asTenant($this->w->tenant->id);
        $this->cashier->update(['role' => 'manager']);

        loginWith($this->w, $this->cashier, '2222', attest())->assertForbidden()
            ->assertJson(['error' => 'pin_change_required', 'min_length' => 6]);
        asTenant($this->w->tenant->id);
        expect(StaffSession::count())->toBe(0);
    });

    it('lets staff change their own PIN, revoking offline credentials and other sessions', function () {
        $first = loginWith($this->w, $this->cashier, '2222', attest())->json();
        $second = loginWith($this->w, $this->cashier, '2222', attest())->json();

        test()->withHeader('X-Staff-Session', $second['session_token'])
            ->postJson('/api/v1/auth/pin', ['current_pin' => '2222', 'new_pin' => '9876'])->assertOk()->assertJsonPath('pin_version', 2);

        asTenant($this->w->tenant->id);
        expect(StaffCredential::whereNull('revoked_at')->count())->toBe(0)
            ->and(StaffCredential::pluck('revoke_reason')->unique()->all())->toBe(['pin_changed'])
            ->and(StaffSession::whereNull('revoked_at')->count())->toBe(1);   // only the one that changed it
        loginWith($this->w, $this->cashier, '9876')->assertCreated();
    });

    it('lets a manager reset a cashier PIN but not another manager', function () {
        $manager = staffMember($this->w, 'manager', '111111');
        $other = staffMember($this->w, 'manager', '222222');
        $session = loginWith($this->w, $manager, '111111', attest())->json('session_token');

        test()->withHeader('X-Staff-Session', $session)->postJson("/api/v1/staff/{$this->cashier->id}/pin", ['new_pin' => '5555'])->assertOk();
        test()->withHeader('X-Staff-Session', $session)->postJson("/api/v1/staff/{$other->id}/pin", ['new_pin' => '333333'])->assertForbidden();
        test()->withHeader('X-Staff-Session', $session)->postJson("/api/v1/staff/{$this->cashier->id}/pin", ['new_pin' => '12'])
            ->assertStatus(422)->assertJsonPath('error', 'invalid_pin');
    });

    it('sets a PIN from the CLI', function () {
        $this->artisan('pos:staff-pin', ['tenant' => $this->w->tenant->slug, 'staff' => $this->cashier->id, '--pin' => '8888'])
            ->expectsOutputToContain('PIN set for')->assertSuccessful();

        loginWith($this->w, $this->cashier, '8888')->assertCreated();
    });
});

describe('issuing offline credentials', function () {
    it('issues a 7-day credential to an attested device, with the KDF to seal it', function () {
        $c = loginWith($this->w, $this->cashier, '2222', attest())->assertCreated()->json('offline_credential');

        expect($c)->toMatchArray(['issued' => true, 'pin_version' => 1])
            ->and($c['kdf']['alg'])->toBe('argon2id')
            ->and(now()->diffInDays($c['expires_at'], absolute: true))->toEqualWithDelta(7, 0.01)
            ->and($c)->not->toHaveKey('pin_hash');
    });

    it('signs in online but issues nothing to a rooted device', function () {
        loginWith($this->w, $this->cashier, '2222', attest('ROOTED'))->assertCreated()
            ->assertJsonPath('offline_credential', ['issued' => false, 'reason' => 'device_integrity']);
    });

    it('issues nothing without attestation when it is required', function () {
        loginWith($this->w, $this->cashier, '2222')->assertCreated()
            ->assertJsonPath('offline_credential.issued', false)->assertJsonPath('offline_credential.reason', 'attestation_missing');
    });

    it('refuses a replayed attestation', function () {
        $att = attest();
        loginWith($this->w, $this->cashier, '2222', $att)->assertJsonPath('offline_credential.issued', true);

        loginWith($this->w, $this->cashier, '2222', $att)->assertJsonPath('offline_credential.reason', 'unknown_or_used_challenge');
    });

    it('sends credentials and their revocation to terminals, with no secrets', function () {
        $id = loginWith($this->w, $this->cashier, '2222', attest())->json('offline_credential.id');
        asTenant($this->w->tenant->id);
        $this->cashier->update(['is_active' => false]);

        actAsTerminal($this->w->terminal);
        $rows = collect($this->getJson('/api/v1/sync/pull?cursor=0')->json('changes'))->where('entity', 'staff_credential')->values();

        expect($rows)->toHaveCount(2)                                   // issued, then revoked
            ->and($rows[1]['data']['revoked_at'])->not->toBeNull()
            ->and($rows[1]['data']['revoke_reason'])->toBe('staff_deactivated')
            ->and(json_encode($rows))->not->toContain('$2y$')
            ->and($rows[0]['id'])->toBe($id);
    });
});

describe('pairing requires attestation', function () {
    beforeEach(function () {
        asTenant($this->w->tenant->id);
        $this->code = app(App\Devices\PairingService::class)->issue($this->w->outlet)['code'];
    });

    $register = fn (string $code, ?array $att) => test()->postJson('/api/v1/devices/register',
        array_filter(['code' => $code, 'device_fingerprint' => 'dev-'.Str::random(24), 'attestation' => $att]));

    it('pairs an attested device', function () use ($register) {
        $register($this->code, attest())->assertCreated();
    });

    it('refuses a rooted device and leaves the code usable', function () use ($register) {
        $register($this->code, attest('ROOTED'))->assertStatus(422)->assertJson(['error' => 'attestation_failed', 'reason' => 'device_integrity']);
        $register($this->code, attest())->assertCreated();
    });

    it('refuses a device that sends no attestation', function () use ($register) {
        $register($this->code, null)->assertStatus(422)->assertJsonPath('reason', 'attestation_missing');
    });

    it('hands out one-time challenges', function () {
        $a = $this->postJson('/api/v1/attestation/challenge')->assertOk()->json('nonce');
        $b = $this->postJson('/api/v1/attestation/challenge')->json('nonce');
        expect($a)->not->toBe($b)->and(strlen($a))->toBeGreaterThan(40);
    });
});

describe('mutations signed in offline', function () {
    beforeEach(function () {
        $c = loginWith($this->w, $this->cashier, '2222', attest())->json('offline_credential');
        $this->cred = $c['id'];
        actAsTerminal($this->w->terminal);
    });

    it('accepts a sale under a valid credential without flags', function () {
        push(offlineSale($this->w, 1, $this->cred, now()->toIso8601String()))->assertJsonPath('results.0.status', 'applied');
    });

    it('flags a sale signed in after the 7-day window', function () {
        push(offlineSale($this->w, 1, $this->cred, now()->addDays(8)->toIso8601String()))
            ->assertJsonPath('results.0.status', 'conflict')->assertJsonPath('results.0.result.conflicts', ['offline_credential_stale']);
    });

    it('flags offline sign-ins after deactivation, but not those before it', function () {
        $before = now()->toIso8601String();
        $this->travel(1)->minutes();
        // deactivated by raw SQL, bypassing Eloquent: the trigger must still revoke the credential
        asTenant($this->w->tenant->id);
        expect(DB::update('UPDATE staff SET is_active = false WHERE id = ?', [$this->cashier->id]))->toBe(1);
        $this->travel(1)->minutes();
        actAsTerminal($this->w->terminal);

        $res = push(offlineSale($this->w, 1, $this->cred, $before), offlineSale($this->w, 2, $this->cred, now()->toIso8601String()))->json('results');

        expect($res[0]['result']['conflicts'])->toBe(['unknown_staff'])   // the person is gone now; the sign-in was fine
            ->and($res[1]['result']['conflicts'])->toBe(['unknown_staff', 'offline_credential_stale']);
        asTenant($this->w->tenant->id);
        expect(StaffCredential::find($this->cred)->revoke_reason)->toBe('staff_deactivated');
    });

    it("flags a credential used by someone else or on another terminal", function () {
        $other = staffMember($this->w, 'cashier', '4444');
        actAsTerminal($this->w->terminal);

        push(offlineSale($this->w, 1, $this->cred, now()->toIso8601String(), $other->id))
            ->assertJsonPath('results.0.result.conflicts', ['offline_credential_unknown']);
        push(offlineSale($this->w, 2, (string) Str::uuid7(), now()->toIso8601String()))
            ->assertJsonPath('results.0.result.conflicts', ['offline_credential_unknown']);
    });

    it('flags manager actions authorised offline, even by a manager', function () {
        $manager = staffMember($this->w, 'manager', '111111');
        $mcred = loginWith($this->w, $manager, '111111', attest())->json('offline_credential.id');
        actAsTerminal($this->w->terminal);
        $sale = orderMutation($this->w, 1);
        push($sale);

        $void = ['id' => (string) Str::uuid7(), 'client_seq' => 2, 'type' => 'order.void', 'client_created_at' => now()->toIso8601String(),
            'payload' => ['void_id' => (string) Str::uuid7(), 'order_id' => $sale['payload']['order']['id'], 'staff_id' => $manager->id,
                'reason' => 'x', 'occurred_at' => now()->toIso8601String()],
            'auth' => ['mode' => 'offline', 'credential_id' => $mcred, 'signed_in_at' => now()->toIso8601String()]];

        push($void)->assertJsonPath('results.0.status', 'conflict')->assertJsonPath('results.0.result.conflicts', ['offline_manager_action']);
    });

    it('does not flag the same actions done online', function () {
        push(orderMutation($this->w, 1) + ['auth' => ['mode' => 'online']])->assertJsonPath('results.0.status', 'applied');
    });

    it('rejects an offline auth without its credential', function () {
        $m = orderMutation($this->w, 1) + ['auth' => ['mode' => 'offline']];

        push($m)->assertUnprocessable();
    });
});

it('isolates staff credentials between tenants, including raw SQL', function () {
    loginWith($this->w, $this->cashier, '2222', attest())->assertCreated();
    $b = world();

    expect(DB::table('staff_credentials')->count())->toBe(0)
        ->and(fn () => DB::transaction(fn () => DB::table('staff_credentials')->insert([
            'id' => (string) Str::uuid7(), 'tenant_id' => $this->w->tenant->id, 'outlet_id' => $b->outlet->id,
            'staff_id' => $this->cashier->id, 'terminal_id' => $b->terminal->id, 'pin_version' => 1,
            'issued_at' => now(), 'expires_at' => now()->addDay(),
        ])))->toThrow(\Illuminate\Database\QueryException::class, 'row-level security');
});

describe('attestation drivers', function () {
    function playResponse(array $override = []): array
    {
        return ['tokenPayloadExternal' => array_replace_recursive([
            'requestDetails' => ['requestPackageName' => 'my.allurus.pos', 'nonce' => 'N0NCE', 'timestampMillis' => (int) (microtime(true) * 1000)],
            'appIntegrity' => ['appRecognitionVerdict' => 'PLAY_RECOGNIZED'],
            'deviceIntegrity' => ['deviceRecognitionVerdict' => ['MEETS_DEVICE_INTEGRITY']],
        ], $override)];
    }

    beforeEach(fn () => config(['pos.attestation.play_integrity.access_token' => 'test-token', 'pos.attestation.play_integrity.package_name' => 'my.allurus.pos']));

    it('passes a genuine Play Integrity verdict', function () {
        Http::fake(['playintegrity.googleapis.com/*' => Http::response(playResponse())]);

        expect((new PlayIntegrityAttestation)->verify('tok', 'N0NCE')->passed)->toBeTrue();
        Http::assertSent(fn ($r) => str_contains($r->url(), 'my.allurus.pos:decodeIntegrityToken') && $r['integrity_token'] === 'tok');
    });

    it('fails Play Integrity on a rooted device, wrong nonce, wrong app, or stale token', function (array $override, string $reason) {
        Http::fake(['playintegrity.googleapis.com/*' => Http::response(playResponse($override))]);

        $r = (new PlayIntegrityAttestation)->verify('tok', 'N0NCE');
        expect($r->passed)->toBeFalse()->and($r->reason)->toBe($reason);
    })->with([
        'rooted'  => [['deviceIntegrity' => ['deviceRecognitionVerdict' => ['MEETS_BASIC_INTEGRITY']]], 'device_integrity'],
        'nonce'   => [['requestDetails' => ['nonce' => 'OTHER']], 'nonce_mismatch'],
        'app'     => [['requestDetails' => ['requestPackageName' => 'evil.app']], 'wrong_app'],
        'resigned'=> [['appIntegrity' => ['appRecognitionVerdict' => 'UNRECOGNIZED_VERSION']], 'app_integrity'],
        'stale'   => [['requestDetails' => ['timestampMillis' => 1]], 'stale'],
    ]);

    it('fails closed when Google is unreachable or not configured', function () {
        Http::fake(['playintegrity.googleapis.com/*' => Http::response('', 500)]);
        expect((new PlayIntegrityAttestation)->verify('tok', 'N0NCE')->reason)->toBe('verifier_rejected');

        config(['pos.attestation.play_integrity.access_token' => null]);
        expect((new PlayIntegrityAttestation)->verify('tok', 'N0NCE')->reason)->toBe('not_configured');
    });

    it('fails closed for App Attest until it is implemented', function () {
        expect((new AppAttestAttestation)->verify('tok', 'N0NCE')->passed)->toBeFalse();
    });

    it('refuses the dev driver in production', function () {
        app()->detectEnvironment(fn () => 'production');

        expect(Attestation::check(attest())->reason)->toBe('dev_attestation_in_production');
    });
});

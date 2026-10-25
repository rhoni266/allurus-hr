<?php

use App\Devices\{DeviceLifecycle, PairingService};
use App\Models\{Order, Outlet, StaffSession, Terminal};
use Illuminate\Support\Str;

/** A second, really paired device in $w's outlet (or $outlet): [Terminal, token]. */
function pairDevice(object $w, ?Outlet $outlet = null): array
{
    asTenant($w->tenant->id);
    $code = app(PairingService::class)->issue($outlet ?? $w->outlet)['code'];
    ['terminal' => $t, 'token' => $token] = app(PairingService::class)->redeem($code, 'dev-'.Str::random(24), 'Tablet');

    return [$t, $token];
}

/** Request as the manager's own terminal with a staff session. */
function asAdmin(object $w, string $session): \Tests\TestCase
{
    app('auth')->forgetGuards();
    test()->flushHeaders();
    actAsTerminal($w->terminal);

    return test()->withHeader('X-Staff-Session', $session);
}

/** Request as a device with its real bearer token. */
function asTarget(string $token): \Tests\TestCase
{
    app('auth')->forgetGuards();
    test()->flushHeaders();

    return test()->withToken($token);
}

beforeEach(function () {
    $this->w = world();
    [$this->target, $this->token] = pairDevice($this->w);
    $this->manager = staffMember($this->w, 'manager', '111111');
    $this->session = signIn($this->w, $this->manager, '111111');
});

it('lists the devices with their status and unsynced backlog', function () {
    // 7 in the outbox when sending, 1 of them in this batch and settled -> 6 still on the device
    asTarget($this->token)->postJson('/api/v1/sync/push', ['mutations' => [orderMutation($this->w)], 'outbox_pending' => 7])->assertOk();

    $devices = collect(asAdmin($this->w, $this->session)->getJson('/api/v1/devices')->assertOk()->json('devices'))->keyBy('id');

    expect($devices[$this->target->id])->toMatchArray(['status' => 'active', 'outbox_pending' => 6, 'this_device' => false])
        ->and($devices[$this->w->terminal->id]['this_device'])->toBeTrue();
});

describe('revoke', function () {
    it('refuses everything at once and, with wipe, tells the device to erase itself', function () {
        $cashier = staffMember($this->w, 'cashier', '2222');
        asTarget($this->token)->postJson('/api/v1/auth/login', ['staff_id' => $cashier->id, 'pin' => '2222'])->assertCreated();

        asAdmin($this->w, $this->session)->postJson("/api/v1/devices/{$this->target->id}/unpair", ['mode' => 'revoke', 'wipe' => true, 'reason' => 'stolen'])
            ->assertOk()->assertJson(['status' => 'revoked', 'wipe_requested' => true]);

        foreach ([['getJson', '/api/v1/sync/pull'], ['postJson', '/api/v1/sync/push'], ['postJson', '/api/v1/auth/login']] as [$verb, $url]) {
            asTarget($this->token)->{$verb}($url)->assertForbidden()->assertExactJson(['error' => 'device_revoked', 'wipe' => true]);
        }
        asTenant($this->w->tenant->id);
        expect(StaffSession::where('terminal_id', $this->target->id)->whereNull('revoked_at')->count())->toBe(0);
    });

    it('accepts nothing from a revoked device, not even sales made before', function () {
        asAdmin($this->w, $this->session)->postJson("/api/v1/devices/{$this->target->id}/unpair", ['mode' => 'revoke'])->assertOk();

        asTarget($this->token)->postJson('/api/v1/sync/push', ['mutations' => [orderMutation($this->w)]])->assertForbidden();

        asTenant($this->w->tenant->id);
        expect(Order::count())->toBe(0);
    });

    it('deletes the token only once the device confirms the wipe', function () {
        asAdmin($this->w, $this->session)->postJson("/api/v1/devices/{$this->target->id}/unpair", ['mode' => 'revoke', 'wipe' => true])->assertOk();

        asTarget($this->token)->postJson('/api/v1/devices/wipe-confirm')->assertNoContent();

        asTarget($this->token)->getJson('/api/v1/sync/pull')->assertUnauthorized();
        expect($this->target->fresh()->wipe_confirmed_at)->not->toBeNull()
            ->and($this->target->tokens()->count())->toBe(0);
    });

    it('without wipe, says so and refuses a wipe confirmation', function () {
        asAdmin($this->w, $this->session)->postJson("/api/v1/devices/{$this->target->id}/unpair", ['mode' => 'revoke'])->assertOk();

        asTarget($this->token)->getJson('/api/v1/sync/pull')->assertExactJson(['error' => 'device_revoked', 'wipe' => false]);
        asTarget($this->token)->postJson('/api/v1/devices/wipe-confirm')->assertForbidden();
    });
});

describe('retire', function () {
    beforeEach(function () {
        asTenant($this->w->tenant->id);
        seedStock($this->w, 10_000);
        $this->before = orderMutation($this->w, 1);   // rung up an hour ago, not yet synced
        asAdmin($this->w, $this->session)->postJson("/api/v1/devices/{$this->target->id}/unpair", ['mode' => 'retire', 'reason' => 'replaced'])
            ->assertOk()->assertJson(['status' => 'retiring']);
    });

    it('lets the device push its backlog but refuses anything after the cutoff', function () {
        $after = orderMutation($this->w, 2, order: ['occurred_at' => now()->addMinute()->toIso8601String()]);

        $res = asTarget($this->token)->postJson('/api/v1/sync/push', ['mutations' => [$this->before, $after]])->assertOk();

        expect($res->json('results.0.status'))->toBe('applied')
            ->and($res->json('results.1.status'))->toBe('rejected')
            ->and($res->json('results.1.result.error'))->toBe('device_retired');
    });

    it('refuses pull and sign-in while retiring', function () {
        asTarget($this->token)->getJson('/api/v1/sync/pull')->assertForbidden()->assertJsonPath('error', 'device_retiring');
        asTarget($this->token)->postJson('/api/v1/auth/login', ['staff_id' => $this->manager->id, 'pin' => '111111'])->assertForbidden();
    });

    it('becomes revoked when the device reports its outbox is empty', function () {
        asTarget($this->token)->postJson('/api/v1/devices/retired')->assertOk()->assertJson(['status' => 'revoked']);

        asTarget($this->token)->postJson('/api/v1/sync/push', ['mutations' => [$this->before]])->assertForbidden();
    });

    it('becomes revoked by itself after the grace period', function () {
        $this->travel(DeviceLifecycle::RETIRE_GRACE_HOURS + 1)->hours();

        asTarget($this->token)->postJson('/api/v1/sync/push', ['mutations' => [$this->before]])
            ->assertForbidden()->assertJsonPath('error', 'device_revoked');
        expect($this->target->fresh()->status)->toBe('revoked');
    });

    it("can't be combined with a wipe", function () {
        [$other] = pairDevice($this->w);
        asAdmin($this->w, $this->session)->postJson("/api/v1/devices/{$other->id}/unpair", ['mode' => 'retire', 'wipe' => true])->assertStatus(422);
    });
});

describe('who may unpair', function () {
    it('refuses cashiers', function () {
        $session = signIn($this->w, staffMember($this->w, 'cashier', '2222'));

        asAdmin($this->w, $session)->postJson("/api/v1/devices/{$this->target->id}/unpair", ['mode' => 'revoke'])->assertForbidden();
    });

    it("keeps managers to their own outlet's devices, owners see all", function () {
        asTenant($this->w->tenant->id);
        [$elsewhere] = pairDevice($this->w, Outlet::create(['name' => 'Other', 'region_code' => 'KL']));

        asAdmin($this->w, $this->session)->postJson("/api/v1/devices/{$elsewhere->id}/unpair", ['mode' => 'revoke'])->assertNotFound();

        $owner = signIn($this->w, staffMember($this->w, 'owner', '333333', null), '333333');
        asAdmin($this->w, $owner)->postJson("/api/v1/devices/{$elsewhere->id}/unpair", ['mode' => 'revoke'])->assertOk();
    });

    it("can't see or touch another tenant's device", function () {
        $other = world();
        [$foreign] = pairDevice($other);

        asAdmin($this->w, $this->session)->postJson("/api/v1/devices/{$foreign->id}/unpair", ['mode' => 'revoke'])->assertNotFound();
        expect(collect(asAdmin($this->w, $this->session)->getJson('/api/v1/devices')->json('devices'))->pluck('id'))->not->toContain($foreign->id)
            ->and($foreign->fresh()->status)->toBe('active');
    });
});

it('brings a revoked device back as new when it is paired again', function () {
    asAdmin($this->w, $this->session)->postJson("/api/v1/devices/{$this->target->id}/unpair", ['mode' => 'revoke', 'wipe' => true])->assertOk();

    asTenant($this->w->tenant->id);
    $code = app(PairingService::class)->issue($this->w->outlet)['code'];
    $new = app(PairingService::class)->redeem($code, $this->target->device_fingerprint);

    expect($new['terminal']->id)->toBe($this->target->id)
        ->and($new['terminal']->fresh())->status->toBe('active')->wipe_requested_at->toBeNull();
    asTarget($new['token'])->getJson('/api/v1/sync/pull')->assertOk();
    asTarget($this->token)->getJson('/api/v1/sync/pull')->assertUnauthorized();   // the old token died with the re-pair
});

it('revokes and wipes from the CLI, warning about unsynced work', function () {
    $this->target->forceFill(['outbox_pending' => 12])->save();

    $this->artisan('pos:unpair', ['tenant' => $this->w->tenant->slug, 'terminal' => $this->target->id, '--wipe' => true, '--reason' => 'lost'])
        ->expectsOutputToContain('12 unsynced mutation(s)')
        ->expectsOutputToContain('revoked, wipe requested')
        ->assertSuccessful();

    expect($this->target->fresh())->status->toBe('revoked')->revoke_reason->toBe('lost');
});

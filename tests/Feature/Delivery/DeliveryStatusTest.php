<?php

use App\Delivery\{DeliveryPushFailed, DeliveryStatusOutbox, ProviderRegistry};
use App\Models\{DeliveryConnection, DeliveryOrder, KitchenTicket, Outlet, OrderVoid, Terminal};
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

function fixtureProvider(): App\Delivery\Providers\FixtureProvider
{
    return app(ProviderRegistry::class)->get('fixture');
}

/** Status calls the "platform" received, as [external order id, status, context]. */
function pushedStatuses(): array
{
    return array_values(array_map(fn ($s) => array_slice($s, 1), array_filter(fixtureProvider()->sent, fn ($s) => $s[0] === 'status')));
}

function outbox(): \Illuminate\Support\Collection
{
    return DB::table('delivery_status_outbox')->orderBy('created_at')->get();
}

/** A KDS at $w's outlet that heartbeats right now. */
function kdsListening(object $w): Terminal
{
    asTenant($w->tenant->id);

    return Terminal::create(['tenant_id' => $w->tenant->id, 'outlet_id' => $w->outlet->id, 'name' => 'KDS', 'kind' => 'kitchen',
        'device_fingerprint' => Str::random(20), 'last_heartbeat_at' => now(), 'heartbeat' => ['kds' => true, 'printers' => []]]);
}

/** The fixture order, due for acceptance $seconds from now (null: no accept_by at all). */
function orderDueIn(object $w, ?int $seconds = 180, string $id = 'FX-ORDER-1001'): array
{
    return deliveryPayload($w, edit: function ($p) use ($seconds, $id) {
        $p['event_id'] = "evt-{$id}";
        $p['order']['id'] = $id;
        $p['order']['placed_at'] = now()->toIso8601ZuluString('microsecond');
        $p['order']['accept_by'] = $seconds === null ? null : now()->addSeconds($seconds)->toIso8601ZuluString('microsecond');
        return $p;
    });
}

function tick(): void
{
    test()->artisan('delivery:tick')->assertSuccessful();
}

/** POST as a signed-in cashier on $w's terminal. */
function asCashier(object $w, string $key): \Tests\TestCase
{
    $w->cashierSession ??= signIn($w, $w->cashier ??= staffMember($w));
    actAsTerminal($w->terminal);

    return test()->withHeaders(['X-Staff-Session' => $w->cashierSession, 'Idempotency-Key' => $key]);
}

beforeEach(fn () => $this->w = deliveryWorld());

describe('pushing statuses', function () {
    it('tells the platform at once when an order is auto-accepted', function () {
        kdsListening($this->w);
        $this->w->connection->update(['auto_accept' => true]);
        deliver(orderDueIn($this->w))->assertOk();

        asTenant($this->w->tenant->id);
        expect(pushedStatuses())->toBe([['FX-ORDER-1001', 'accepted', ['by' => 'auto']]])
            ->and(outbox()->sole())->sent_at->not->toBeNull()->attempts->toBe(1);
    });

    it('backs off after a transient failure and is sent by the tick once due', function () {
        kdsListening($this->w);
        $this->w->connection->update(['auto_accept' => true]);
        $fails = 1;
        fixtureProvider()->before = function () use (&$fails) { if ($fails-- > 0) { throw new DeliveryPushFailed('503'); } };

        deliver(orderDueIn($this->w))->assertOk();
        asTenant($this->w->tenant->id);
        expect(outbox()->sole())->sent_at->toBeNull()->attempts->toBe(1)->last_error->toBe('503');

        tick();   // not due yet
        expect(pushedStatuses())->toBe([]);

        $this->travel(config('pos.delivery.push_backoff')[0] + 1)->seconds();
        tick();
        asTenant($this->w->tenant->id);
        expect(pushedStatuses())->toBe([['FX-ORDER-1001', 'accepted', ['by' => 'auto']]])
            ->and(outbox()->sole())->sent_at->not->toBeNull()->attempts->toBe(2)->last_error->toBeNull();
    });

    it('never lets a later status overtake an earlier one that is backing off', function () {
        kdsListening($this->w);
        $this->w->connection->update(['auto_accept' => true]);
        $down = true;
        fixtureProvider()->before = function () use (&$down) { if ($down) { throw new DeliveryPushFailed('timeout'); } };
        deliver(orderDueIn($this->w))->assertOk();

        asTenant($this->w->tenant->id);
        DB::transaction(function () { TenantContext::applyToTransaction(); DeliveryStatusOutbox::queue(DeliveryOrder::sole(), 'ready'); });
        $down = false;
        tick();   // 'accepted' is still backing off, so 'ready' must wait behind it
        expect(pushedStatuses())->toBe([]);

        $this->travel(config('pos.delivery.push_backoff')[0] + 1)->seconds();
        tick();
        expect(array_column(pushedStatuses(), 1))->toBe(['accepted', 'ready']);
    });

    it('gives up on a permanent refusal, flags the order, and still sends what follows', function () {
        kdsListening($this->w);
        $this->w->connection->update(['auto_accept' => true]);
        fixtureProvider()->before = function ($call) { if ($call[2] === 'accepted') { throw new DeliveryPushFailed('order already cancelled', permanent: true); } };
        deliver(orderDueIn($this->w))->assertOk();

        asTenant($this->w->tenant->id);
        DB::transaction(function () { TenantContext::applyToTransaction(); DeliveryStatusOutbox::queue(DeliveryOrder::sole(), 'ready'); });
        tick();

        asTenant($this->w->tenant->id);
        $rows = outbox();
        expect($rows[0])->gave_up_at->not->toBeNull()->last_error->toBe('order already cancelled')
            ->and($rows[1])->sent_at->not->toBeNull()
            ->and(DeliveryOrder::sole())->needs_attention->toBeTrue()
            // jsonb reorders keys, so compare as a map
            ->and(collect(DeliveryOrder::sole()->attention_reasons)->firstWhere('kind', 'status_push_failed'))
                ->toEqual(['kind' => 'status_push_failed', 'status' => 'accepted', 'error' => 'order already cancelled']);
    });

    it('gives up after the last backoff step', function () {
        config(['pos.delivery.push_backoff' => [1, 1]]);
        kdsListening($this->w);
        $this->w->connection->update(['auto_accept' => true]);
        fixtureProvider()->before = fn () => throw new DeliveryPushFailed('down');
        deliver(orderDueIn($this->w))->assertOk();

        foreach (range(1, 3) as $_) {
            $this->travel(2)->seconds();
            tick();
        }
        asTenant($this->w->tenant->id);
        expect(outbox()->sole())->gave_up_at->not->toBeNull()->attempts->toBe(3)
            ->and(collect(DeliveryOrder::sole()->attention_reasons)->pluck('kind'))->toContain('status_push_failed');
    });
});

describe('manual accept and reject', function () {
    it('lets a cashier accept: kitchen ticket with the platform notes, platform told, replay-safe', function () {
        deliver(orderDueIn($this->w))->assertOk();
        asTenant($this->w->tenant->id);
        $do = DeliveryOrder::sole();
        expect($do->status)->toBe('received');

        $first = asCashier($this->w, 'k-accept-1')->postJson("/api/v1/delivery-orders/{$do->id}/accept")
            ->assertOk()->assertExactJson(['id' => $do->id, 'status' => 'accepted', 'changed' => true]);
        asCashier($this->w, 'k-accept-1')->postJson("/api/v1/delivery-orders/{$do->id}/accept")
            ->assertOk()->assertHeader('Idempotent-Replayed', 'true')->assertExactJson($first->json());
        asCashier($this->w, 'k-accept-2')->postJson("/api/v1/delivery-orders/{$do->id}/accept")
            ->assertOk()->assertJson(['changed' => false]);

        asTenant($this->w->tenant->id);
        $ticket = KitchenTicket::sole();
        expect($do->fresh())->status->toBe('accepted')->accepted_by->toBe($this->w->cashier->id)
            ->and($ticket->lines[0])->toMatchArray(['name' => 'Kopi Ais', 'notes' => 'less sugar', 'modifiers' => ['Extra shot']])
            ->and($ticket->notes)->toBe('Call on arrival')
            ->and(pushedStatuses())->toBe([['FX-ORDER-1001', 'accepted', ['by' => $this->w->cashier->id]]]);
    });

    it('lets a cashier reject: sale voided, stock back, platform told; then nothing else', function () {
        deliver(orderDueIn($this->w))->assertOk();
        asTenant($this->w->tenant->id);
        $do = DeliveryOrder::sole();

        asCashier($this->w, 'k-rej')->postJson("/api/v1/delivery-orders/{$do->id}/reject", ['reason' => 'out of kopi'])
            ->assertOk()->assertJson(['status' => 'rejected', 'changed' => true]);
        asCashier($this->w, 'k-acc')->postJson("/api/v1/delivery-orders/{$do->id}/accept")
            ->assertStatus(409)->assertExactJson(['error' => 'delivery_order_not_pending', 'status' => 'rejected']);

        asTenant($this->w->tenant->id);
        $void = OrderVoid::sole();
        expect($do->fresh())->status->toBe('rejected')->reject_reason->toBe('out of kopi')->rejected_by->toBe($this->w->cashier->id)
            ->and($void)->order_id->toBe($do->order_id)->staff_id->toBe($this->w->cashier->id)->terminal_id->toBe($this->w->terminal->id)
            ->and(onHandMilli($this->w))->toBe(10_000)   // the two kopi came back
            ->and((int) DB::table('payments')->where('order_id', $do->order_id)->sum('amount_sen'))->toBe(0)
            ->and(KitchenTicket::count())->toBe(0)
            ->and(pushedStatuses())->toBe([['FX-ORDER-1001', 'rejected', ['by' => $this->w->cashier->id, 'reason' => 'out of kopi']]]);

        // the platform's own cancellation afterwards doesn't overwrite our answer
        deliver(deliveryPayload($this->w, 'order_cancelled'))->assertOk();
        asTenant($this->w->tenant->id);
        expect($do->fresh()->status)->toBe('rejected')->and(OrderVoid::count())->toBe(1);
    });

    it("can't reject what was auto-accepted", function () {
        kdsListening($this->w);
        $this->w->connection->update(['auto_accept' => true]);
        deliver(orderDueIn($this->w))->assertOk();
        asTenant($this->w->tenant->id);
        $id = DeliveryOrder::sole()->id;   // before asCashier: its sign-in request clears the tenant

        asCashier($this->w, 'k1')->postJson("/api/v1/delivery-orders/{$id}/reject", ['reason' => 'x'])
            ->assertStatus(409)->assertJson(['status' => 'accepted']);
    });

    it('requires an Idempotency-Key and refuses one reused for a different request', function () {
        deliver(orderDueIn($this->w))->assertOk();
        asTenant($this->w->tenant->id);
        $id = DeliveryOrder::sole()->id;

        asCashier($this->w, 'k')->withHeaders(['Idempotency-Key' => ''])->postJson("/api/v1/delivery-orders/{$id}/accept")
            ->assertStatus(428)->assertJson(['error' => 'idempotency_key_required']);
        asCashier($this->w, 'same')->postJson("/api/v1/delivery-orders/{$id}/reject", ['reason' => 'busy'])->assertOk();
        asCashier($this->w, 'same')->postJson("/api/v1/delivery-orders/{$id}/reject", ['reason' => 'something else'])
            ->assertStatus(422)->assertJson(['error' => 'idempotency_key_reused']);
    });

    it("needs a staff sign-in, and can't touch another outlet's or tenant's order", function () {
        deliver(orderDueIn($this->w))->assertOk();
        asTenant($this->w->tenant->id);
        $id = DeliveryOrder::sole()->id;

        actAsTerminal($this->w->terminal);
        test()->withHeaders(['Idempotency-Key' => 'n'])->postJson("/api/v1/delivery-orders/{$id}/accept")->assertUnauthorized();

        // a terminal at another outlet of the same tenant
        asTenant($this->w->tenant->id);
        $other = Outlet::create(['name' => 'Second', 'region_code' => 'KL']);
        $elsewhere = (object) ['tenant' => $this->w->tenant, 'outlet' => $other,
            'terminal' => Terminal::create(['tenant_id' => $this->w->tenant->id, 'outlet_id' => $other->id, 'name' => 'T9', 'device_fingerprint' => Str::random(16)])];
        asCashier($elsewhere, 'x')->postJson("/api/v1/delivery-orders/{$id}/accept")->assertNotFound();

        $stranger = world();
        asCashier($stranger, 'y')->postJson("/api/v1/delivery-orders/{$id}/accept")->assertNotFound();

        asTenant($this->w->tenant->id);
        expect(DeliveryOrder::sole()->status)->toBe('received');
    });
});

describe('auto-reject', function () {
    it('rejects an unaccepted order just before the platform deadline', function () {
        deliver(orderDueIn($this->w, 60))->assertOk();

        tick();
        asTenant($this->w->tenant->id);
        expect(DeliveryOrder::sole()->status)->toBe('received');

        $this->travel(60 - config('pos.delivery.reject_margin_seconds') + 1)->seconds();
        tick();
        asTenant($this->w->tenant->id);
        expect(DeliveryOrder::sole())->status->toBe('rejected')->rejected_by->toBe('auto')->reject_reason->toBe('not_accepted_in_time')
            ->and(OrderVoid::count())->toBe(1)
            ->and(pushedStatuses())->toBe([['FX-ORDER-1001', 'rejected', ['by' => 'auto', 'reason' => 'not_accepted_in_time']]]);
    });

    it("uses the store's accept timeout when the platform gives no deadline", function () {
        asTenant($this->w->tenant->id);
        $this->w->connection->update(['accept_timeout_seconds' => 120]);
        deliver(orderDueIn($this->w, null))->assertOk();

        $this->travel(90)->seconds();
        tick();
        asTenant($this->w->tenant->id);
        expect(DeliveryOrder::sole()->status)->toBe('received');

        $this->travel(15)->seconds();   // 105 s: inside the 20 s margin of 120
        tick();
        asTenant($this->w->tenant->id);
        expect(DeliveryOrder::sole()->status)->toBe('rejected');
    });

    it('leaves accepted orders alone', function () {
        deliver(orderDueIn($this->w, 60))->assertOk();
        asTenant($this->w->tenant->id);
        $id = DeliveryOrder::sole()->id;
        asCashier($this->w, 'k')->postJson("/api/v1/delivery-orders/{$id}/accept")->assertOk();

        $this->travel(5)->minutes();
        tick();
        asTenant($this->w->tenant->id);
        expect(DeliveryOrder::sole()->status)->toBe('accepted')->and(OrderVoid::count())->toBe(0);
    });
});

describe('kitchen watchdog', function () {
    beforeEach(function () {
        asTenant($this->w->tenant->id);
        $this->w->connection->update(['auto_accept' => true]);
        $this->storeCalls = fn () => array_values(array_map(fn ($s) => [$s[2], $s[3]], array_filter(fixtureProvider()->sent, fn ($s) => $s[0] === 'store')));
        $this->conn = fn () => (function () { asTenant($this->w->tenant->id); return $this->w->connection->fresh(); })();
    });

    it('pauses an auto-accepting store once the kitchen has been quiet long enough, and reopens it', function () {
        tick();   // first silence: starts the clock
        expect(($this->conn)())->status->toBe('active')->kitchen_quiet_since->not->toBeNull();

        $this->travel(config('pos.delivery.pause_after_seconds') - 5)->seconds();
        tick();
        expect(($this->conn)()->status)->toBe('active');

        $this->travel(10)->seconds();
        tick();
        expect(($this->conn)())->status->toBe('paused')->pause_reason->toBe('kitchen_quiet')->paused_at->not->toBeNull()
            ->and(($this->storeCalls)())->toBe([[false, 'kitchen_quiet']]);

        kdsListening($this->w);
        tick();
        expect(($this->conn)())->status->toBe('active')->pause_reason->toBeNull()->kitchen_quiet_since->toBeNull()
            ->and(($this->storeCalls)())->toBe([[false, 'kitchen_quiet'], [true, 'kitchen_back']]);
    });

    it('forgets a short silence', function () {
        tick();
        $this->travel(30)->seconds();
        kdsListening($this->w);
        tick();
        expect(($this->conn)()->kitchen_quiet_since)->toBeNull();
    });

    it("doesn't watch a store that isn't auto-accepting, unless asked to", function () {
        $this->w->connection->update(['auto_accept' => false]);
        tick();
        $this->travel(10)->minutes();
        tick();
        expect(($this->conn)()->status)->toBe('active');

        asTenant($this->w->tenant->id);
        $this->w->connection->update(['settings' => ['pause_when_kitchen_quiet' => true]]);
        tick();
        $this->travel(10)->minutes();
        tick();
        expect(($this->conn)()->status)->toBe('paused');
    });

    it('never reopens a store paused by hand', function () {
        $this->w->connection->update(['status' => 'paused', 'pause_reason' => 'manual']);
        kdsListening($this->w);
        tick();
        expect(($this->conn)())->status->toBe('paused')->pause_reason->toBe('manual')
            ->and(($this->storeCalls)())->toBe([]);
    });

    it('changes nothing when the platform call fails, and retries next tick', function () {
        tick();
        $this->travel(10)->minutes();
        fixtureProvider()->before = fn () => throw new DeliveryPushFailed('platform down');
        tick();
        expect(($this->conn)()->status)->toBe('active');

        fixtureProvider()->before = null;
        tick();
        expect(($this->conn)()->status)->toBe('paused');
    });
});

describe('isolation', function () {
    it('keeps idempotency keys per tenant, including against raw SQL', function () {
        deliver(orderDueIn($this->w))->assertOk();
        asTenant($this->w->tenant->id);
        $id = DeliveryOrder::sole()->id;
        asCashier($this->w, 'k')->postJson("/api/v1/delivery-orders/{$id}/accept")->assertOk();

        $b = world();   // tenant B active
        expect(DB::table('idempotency_keys')->count())->toBe(0);
        expect(fn () => DB::transaction(fn () => DB::table('idempotency_keys')->insert([
            'id' => (string) Str::uuid7(), 'tenant_id' => $this->w->tenant->id, 'scope' => (string) Str::uuid7(), 'key' => 'x', 'request_hash' => str_repeat('0', 64),
        ])))->toThrow(\Illuminate\Database\QueryException::class, 'row-level security');

        asTenant($this->w->tenant->id);
        expect(DB::table('idempotency_keys')->count())->toBe(1);
    });

    it('restores the outer tenant when tenant contexts nest (a job run inline inside another)', function () {
        $b = world();
        TenantContext::enter($this->w->tenant->id);
        TenantContext::enter($b->tenant->id);
        TenantContext::leave();

        expect(TenantContext::id())->toBe($this->w->tenant->id)
            ->and(DB::selectOne("SELECT current_setting('app.tenant_id') AS t")->t)->toBe($this->w->tenant->id);
        TenantContext::leave();
    });
});

<?php

use App\Kitchen\KitchenTicketChanged;
use App\Models\{DeliveryOrder, KitchenTicket, KitchenTicketEvent, Outlet, SyncConflict};
use Illuminate\Support\Facades\{DB, Event};
use Illuminate\Support\Str;

/** A ticket.status mutation (one KDS tap). */
function bump(string $ticketId, string $status, int $clientSeq = 1, array $edit = []): array
{
    return [
        'id' => (string) Str::uuid7(), 'client_seq' => $clientSeq, 'type' => 'ticket.status',
        'client_created_at' => now()->toIso8601String(),
        'payload' => array_merge(['event_id' => (string) Str::uuid7(), 'ticket_id' => $ticketId, 'status' => $status,
            'occurred_at' => now()->toIso8601String()], $edit),
    ];
}

function pushAs(string $token, array ...$mutations): \Illuminate\Testing\TestResponse
{
    return asDevice($token)->postJson('/api/v1/sync/push', ['mutations' => $mutations]);
}

/** A till sale sent to the kitchen; returns its ticket. */
function tillTicket(object $w, int $clientSeq = 1): KitchenTicket
{
    actAsTerminal($w->terminal);
    $m = orderMutation($w, $clientSeq);
    $m['payload']['order']['send_to_kitchen'] = true;
    $m['payload']['order']['occurred_at'] = $m['client_created_at'] = now()->toIso8601String();
    $res = push($m)->assertOk();
    expect($res->json('results.0.status'))->toBeIn(['applied', 'conflict'], json_encode($res->json('results.0')));
    asTenant($w->tenant->id);

    return KitchenTicket::where('order_id', $m['payload']['order']['id'])->sole();
}

/** An auto-accepted platform order (its ticket fired, 'accepted' already told). */
function acceptedDelivery(object $w): KitchenTicket
{
    kdsListening($w);
    $w->connection->update(['auto_accept' => true]);
    deliver(deliveryPayload($w))->assertOk();
    asTenant($w->tenant->id);

    return KitchenTicket::where('order_id', DeliveryOrder::sole()->order_id)->sole();
}

describe('ticket.status', function () {
    it('moves a ticket through preparing, ready and bumped from a KDS', function () {
        $w = world();
        $ticket = tillTicket($w);
        [, $kds] = kitchenDevice($w);

        pushAs($kds, bump($ticket->id, 'preparing', 1))->assertOk()
            ->assertJsonPath('results.0.status', 'applied')->assertJsonPath('results.0.result.moved', true);
        pushAs($kds, bump($ticket->id, 'ready', 2), bump($ticket->id, 'bumped', 3))->assertOk()
            ->assertJsonPath('results.1.result.status', 'bumped');

        asTenant($w->tenant->id);
        $ticket->refresh();
        expect($ticket->status)->toBe('bumped')
            ->and($ticket->preparing_at)->not->toBeNull()->and($ticket->ready_at)->not->toBeNull()->and($ticket->bumped_at)->not->toBeNull()
            ->and(KitchenTicketEvent::where('applied', true)->count())->toBe(3);
    });

    it('never moves a ticket backwards; the stale tap is stored, not flagged', function () {
        $w = world();
        $ticket = tillTicket($w);
        [, $pass] = kitchenDevice($w, name: 'Pass');
        [, $line] = kitchenDevice($w, name: 'Line');

        pushAs($pass, bump($ticket->id, 'ready'))->assertOk();
        // the line screen was offline: its earlier "preparing" arrives after "ready"
        pushAs($line, bump($ticket->id, 'preparing', edit: ['occurred_at' => now()->subMinute()->toIso8601String()]))->assertOk()
            ->assertJsonPath('results.0.status', 'applied')->assertJsonPath('results.0.result.moved', false)
            ->assertJsonPath('results.0.result.status', 'ready');

        asTenant($w->tenant->id);
        expect($ticket->refresh()->status)->toBe('ready')
            ->and(KitchenTicketEvent::count())->toBe(2)->and(KitchenTicketEvent::where('applied', false)->count())->toBe(1)
            ->and(SyncConflict::where('kind', '!=', 'negative_stock')->count())->toBe(0);   // the sale's own flag aside
    });

    it('lets a busy pass bump straight from new', function () {
        $w = world();
        $ticket = tillTicket($w);
        [, $kds] = kitchenDevice($w);

        pushAs($kds, bump($ticket->id, 'bumped'))->assertOk()->assertJsonPath('results.0.result.moved', true);
        asTenant($w->tenant->id);
        expect($ticket->refresh())->status->toBe('bumped')->preparing_at->toBeNull()->ready_at->toBeNull();
    });

    it('is idempotent on the event id and on (device, client_seq)', function () {
        $w = world();
        $ticket = tillTicket($w);
        [, $kds] = kitchenDevice($w);
        $m = bump($ticket->id, 'ready');

        pushAs($kds, $m)->assertOk();
        pushAs($kds, $m)->assertOk()->assertJsonPath('results.0.status', 'applied');   // lost response, same row
        $again = bump($ticket->id, 'ready', 2, ['event_id' => $m['payload']['event_id']]);   // re-queued under a new seq
        pushAs($kds, $again)->assertOk()->assertJsonPath('results.0.result.note', 'already_exists');

        asTenant($w->tenant->id);
        expect(KitchenTicketEvent::count())->toBe(1);
    });

    it('rings the outlet doorbell when a ticket moves, and not when it does not', function () {
        $w = world();
        $ticket = tillTicket($w);
        [, $kds] = kitchenDevice($w);
        Event::fake([KitchenTicketChanged::class]);

        pushAs($kds, bump($ticket->id, 'ready', 1), bump($ticket->id, 'preparing', 2))->assertOk();

        Event::assertDispatchedTimes(KitchenTicketChanged::class, 1);
        Event::assertDispatched(KitchenTicketChanged::class, fn ($e) => $e->broadcastAs() === 'ticket.ready');
    });

    it('stores a tap on a cancelled ticket without reviving it', function () {
        $w = world();
        $ticket = tillTicket($w);
        [, $kds] = kitchenDevice($w);
        asTenant($w->tenant->id);
        DB::transaction(fn () => App\Kitchen\Kitchen::cancel($ticket->order_id));

        pushAs($kds, bump($ticket->id, 'bumped'))->assertOk()
            ->assertJsonPath('results.0.result.moved', false)->assertJsonPath('results.0.result.ticket_cancelled', true);
        asTenant($w->tenant->id);
        expect($ticket->refresh()->status)->toBe('cancelled');
    });

    it('can be pushed by a till too, and flags an unknown staff member', function () {
        $w = world();
        $ticket = tillTicket($w);
        actAsTerminal($w->terminal);

        push(bump($ticket->id, 'ready', 2, ['staff_id' => (string) Str::uuid7()]))->assertOk()
            ->assertJsonPath('results.0.status', 'conflict')->assertJsonPath('results.0.result.conflicts', ['unknown_staff']);
        asTenant($w->tenant->id);
        expect($ticket->refresh()->status)->toBe('ready');   // flagged, never refused
    });

    it('rejects an unknown ticket, another outlet\'s ticket and a bad status, without blocking later taps', function () {
        $w = world();
        $ticket = tillTicket($w);
        asTenant($w->tenant->id);
        $other = Outlet::create(['name' => 'Second', 'region_code' => 'KL']);
        [, $elsewhere] = kitchenDevice($w, $other);
        [, $kds] = kitchenDevice($w);

        pushAs($elsewhere, bump($ticket->id, 'ready'))->assertOk()->assertJsonPath('results.0.result.error', 'wrong_outlet');
        pushAs($kds, bump((string) Str::uuid7(), 'ready', 1), bump($ticket->id, 'cooking', 2), bump($ticket->id, 'ready', 3))->assertOk()
            ->assertJsonPath('results.0.result.error', 'unknown_ticket')
            ->assertJsonPath('results.1.result.error', 'invalid_payload')
            ->assertJsonPath('results.2.status', 'applied');
    });
});

describe('telling the platform', function () {
    beforeEach(fn () => $this->w = deliveryWorld());

    it('pushes preparing and ready for a delivery order, in order, after accepted', function () {
        $ticket = acceptedDelivery($this->w);
        [, $kds] = kitchenDevice($this->w);

        pushAs($kds, bump($ticket->id, 'preparing', 1))->assertOk()->assertJsonPath('results.0.result.platform', ['preparing']);
        pushAs($kds, bump($ticket->id, 'ready', 2), bump($ticket->id, 'bumped', 3))->assertOk()
            ->assertJsonPath('results.0.result.platform', ['ready'])
            ->assertJsonMissingPath('results.1.result.platform');   // bumped is ours; the driver pickup is the platform's

        asTenant($this->w->tenant->id);
        expect(array_column(pushedStatuses(), 1))->toBe(['accepted', 'preparing', 'ready'])
            ->and(pushedStatuses()[2][2])->toBe(['ticket_id' => $ticket->id])
            ->and(outbox()->whereNull('sent_at')->count())->toBe(0);
    });

    it('tells the platform ready once when the pass bumps straight past it, and no preparing it never said', function () {
        $ticket = acceptedDelivery($this->w);
        [, $kds] = kitchenDevice($this->w);

        pushAs($kds, bump($ticket->id, 'bumped', 1), bump($ticket->id, 'ready', 2))->assertOk();

        expect(array_column(pushedStatuses(), 1))->toBe(['accepted', 'ready']);
    });

    it('queues ready behind an accepted that is still backing off', function () {
        $down = true;
        fixtureProvider()->before = function () use (&$down) { if ($down) { throw new App\Delivery\DeliveryPushFailed('503'); } };
        $ticket = acceptedDelivery($this->w);
        [, $kds] = kitchenDevice($this->w);

        pushAs($kds, bump($ticket->id, 'ready'))->assertOk();
        expect(pushedStatuses())->toBe([]);

        $down = false;
        $this->travel(config('pos.delivery.push_backoff')[0] + 1)->seconds();
        tick();
        expect(array_column(pushedStatuses(), 1))->toBe(['accepted', 'ready']);
    });

    it('says nothing to the platform once it has cancelled the order', function () {
        $ticket = acceptedDelivery($this->w);
        deliver(deliveryPayload($this->w, 'order_cancelled'))->assertOk();
        [, $kds] = kitchenDevice($this->w);

        pushAs($kds, bump($ticket->id, 'ready'))->assertOk()->assertJsonPath('results.0.result.moved', false);

        expect(array_column(pushedStatuses(), 1))->toBe(['accepted']);
    });

    it('says nothing to the platform for a till sale', function () {
        $ticket = tillTicket($this->w);
        [, $kds] = kitchenDevice($this->w);

        pushAs($kds, bump($ticket->id, 'ready'))->assertOk()->assertJsonMissingPath('results.0.result.platform');
        asTenant($this->w->tenant->id);
        expect(outbox())->toHaveCount(0);
    });
});

describe('tenant isolation', function () {
    it('hides ticket events from other tenants, in Eloquent and raw SQL, and blocks cross-tenant writes and taps', function () {
        $a = world();
        $ticket = tillTicket($a);
        [, $kds] = kitchenDevice($a);
        pushAs($kds, bump($ticket->id, 'ready'))->assertOk();

        $b = world();   // tenant B active
        [, $bKds] = kitchenDevice($b);
        expect(KitchenTicketEvent::count())->toBe(0)->and(DB::table('kitchen_ticket_events')->count())->toBe(0);
        expect(fn () => DB::transaction(fn () => DB::table('kitchen_ticket_events')->insert([
            'id' => (string) Str::uuid7(), 'tenant_id' => $a->tenant->id, 'outlet_id' => $a->outlet->id, 'ticket_id' => $ticket->id,
            'status' => 'bumped', 'occurred_at' => now(), 'device_id' => (string) Str::uuid7(), 'queue_id' => (string) Str::uuid7(),
            'applied' => true, 'created_at' => now(),
        ])))->toThrow(\Illuminate\Database\QueryException::class, 'row-level security');
        // B's KDS can't see A's ticket, so it can't bump it
        pushAs($bKds, bump($ticket->id, 'bumped'))->assertOk()->assertJsonPath('results.0.result.error', 'unknown_ticket');

        asTenant($a->tenant->id);
        expect(DB::table('kitchen_ticket_events')->count())->toBe(1)->and($ticket->refresh()->status)->toBe('ready');
    });
});

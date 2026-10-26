<?php

use App\Devices\PairingService;
use App\Kitchen\{KitchenPresence, KitchenTicketChanged};
use App\Models\{DeliveryOrder, KitchenTicket, Outlet, Printer, PrintJob, SyncConflict, Terminal};
use Illuminate\Support\Facades\{DB, Event};
use Illuminate\Support\Str;

/** A paired kitchen device (KDS / print node) at $outlet, with a real pos:kitchen token. */
function kitchenDevice(object $w, ?Outlet $outlet = null, string $name = 'Pass'): array
{
    asTenant($w->tenant->id);
    $d = Terminal::create(['tenant_id' => $w->tenant->id, 'outlet_id' => ($outlet ?? $w->outlet)->id, 'name' => $name,
        'device_fingerprint' => Str::random(20), 'kind' => Terminal::KIND_KITCHEN]);

    return [$d, $d->createToken('device', ['pos:kitchen'])->plainTextToken];
}

function printerAt(object $w, string $role = 'kitchen', ?Outlet $outlet = null): Printer
{
    asTenant($w->tenant->id);

    return Printer::create(['outlet_id' => ($outlet ?? $w->outlet)->id, 'name' => ucfirst($role), 'role' => $role,
        'connection' => ['type' => 'tcp', 'host' => '192.168.1.50', 'port' => 9100]]);
}

function heartbeat(string $token, array $body): \Illuminate\Testing\TestResponse
{
    return asDevice($token)->postJson('/api/v1/kitchen/heartbeat', $body);
}

/** A kitchen at $w's outlet that is listening: a print node reporting an ok kitchen printer. */
function liveKitchen(object $w): object
{
    $w->printer = printerAt($w);
    [$w->node, $w->nodeToken] = kitchenDevice($w);
    heartbeat($w->nodeToken, ['printers' => [['id' => $w->printer->id, 'status' => 'ok']]])->assertOk();
    asTenant($w->tenant->id);

    return $w;
}

function channelAuth(string $token, string $outletId): \Illuminate\Testing\TestResponse
{
    return asDevice($token)->postJson('/api/v1/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => "private-outlet.{$outletId}.kitchen"]);
}

describe('kitchen devices', function () {
    it('pairs a kitchen device with pos:kitchen only, without attestation by default', function () {
        config(['pos.attestation.required' => true]);
        $w = world();
        asTenant($w->tenant->id);
        $code = app(PairingService::class)->issue($w->outlet, kind: 'kitchen')['code'];

        $res = test()->postJson('/api/v1/devices/register', ['code' => $code, 'device_fingerprint' => 'pi-'.Str::random(16), 'name' => 'Print node'])
            ->assertCreated()->assertJsonPath('terminal.kind', 'kitchen');
        $token = $res->json('token');

        expect(DB::table('personal_access_tokens')->where('tokenable_id', $res->json('terminal.id'))->value('abilities'))->toBe('["pos:kitchen"]');
        // a kitchen device can't sell, sign staff in or issue codes
        asDevice($token)->postJson('/api/v1/sync/push', ['mutations' => []])->assertForbidden();
        asDevice($token)->postJson('/api/v1/auth/login', ['staff_id' => (string) Str::uuid7(), 'pin' => '1111'])->assertForbidden();
        asDevice($token)->getJson('/api/v1/sync/pull')->assertOk();
    });

    it('still requires attestation for kitchen devices when configured', function () {
        config(['pos.attestation.required' => true, 'pos.attestation.kitchen_required' => true]);
        $w = world();
        asTenant($w->tenant->id);
        $code = app(PairingService::class)->issue($w->outlet, kind: 'kitchen')['code'];

        test()->postJson('/api/v1/devices/register', ['code' => $code, 'device_fingerprint' => 'pi-'.Str::random(16)])
            ->assertStatus(422)->assertJsonPath('error', 'attestation_failed');
    });

    it('shows a kitchen device only kitchen rows from its own outlet', function () {
        $w = world();
        staffMember($w);   // a staff feed row, which a KDS must not see
        $mine = printerAt($w);
        asTenant($w->tenant->id);
        $other = Outlet::create(['name' => 'Second', 'region_code' => 'KL']);
        printerAt($w, outlet: $other);
        [, $token] = kitchenDevice($w);

        $changes = asDevice($token)->getJson('/api/v1/sync/pull')->assertOk()->json('changes');

        expect(collect($changes)->pluck('entity')->unique()->values()->all())->toBe(['printer'])
            ->and(collect($changes)->pluck('id')->all())->toBe([$mine->id]);
    });
});

describe('presence', function () {
    it('listens when a print node reports an ok kitchen printer, and not otherwise', function () {
        $w = world();
        $kitchen = printerAt($w);
        $receipt = printerAt($w, 'receipt');
        [, $token] = kitchenDevice($w);
        $listening = function () use ($w) { asTenant($w->tenant->id); return KitchenPresence::isListening($w->tenant->id, $w->outlet->id); };

        expect($listening())->toBeFalse();   // never heartbeat

        heartbeat($token, ['printers' => [['id' => $receipt->id, 'status' => 'ok']]])->assertOk();
        expect($listening())->toBeFalse();   // a receipt printer doesn't cook

        heartbeat($token, ['printers' => [['id' => $kitchen->id, 'status' => 'paper_out']]])->assertOk();
        expect($listening())->toBeFalse();

        heartbeat($token, ['printers' => [['id' => $kitchen->id, 'status' => 'ok']]])->assertOk();
        expect($listening())->toBeTrue();

        $this->travel(config('pos.kitchen.presence_seconds') + 1)->seconds();
        expect($listening())->toBeFalse();   // gone quiet
    });

    it('counts a live KDS screen without a printer', function () {
        $w = world();
        [, $token] = kitchenDevice($w);
        heartbeat($token, ['kds' => true])->assertOk();

        asTenant($w->tenant->id);
        expect(KitchenPresence::isListening($w->tenant->id, $w->outlet->id))->toBeTrue();
    });

    it("ignores printers that aren't this outlet's, and devices that are revoked or elsewhere", function () {
        $w = world();
        asTenant($w->tenant->id);
        $other = Outlet::create(['name' => 'Second', 'region_code' => 'KL']);
        $foreign = printerAt($w, outlet: $other);
        [, $token] = kitchenDevice($w);

        heartbeat($token, ['printers' => [['id' => $foreign->id, 'status' => 'ok']]])->assertOk()->assertJsonPath('printers', 0);
        asTenant($w->tenant->id);
        expect(KitchenPresence::isListening($w->tenant->id, $w->outlet->id))->toBeFalse();

        // a KDS at the other outlet doesn't make this one listen; a revoked one doesn't count at all
        [, $elsewhere] = kitchenDevice($w, $other);
        heartbeat($elsewhere, ['kds' => true])->assertOk();
        [$d, $here] = kitchenDevice($w);
        heartbeat($here, ['kds' => true])->assertOk();
        $d->forceFill(['status' => Terminal::REVOKED])->save();

        asTenant($w->tenant->id);
        expect(KitchenPresence::isListening($w->tenant->id, $w->outlet->id))->toBeFalse()
            ->and(KitchenPresence::isListening($w->tenant->id, $other->id))->toBeTrue();
    });
});

describe('zero-touch delivery', function () {
    beforeEach(function () {
        $this->w = deliveryWorld();
        $this->w->connection->update(['auto_accept' => true]);
    });

    it('auto-accepts when the kitchen is listening, fires the ticket and rings the bell', function () {
        Event::fake([KitchenTicketChanged::class]);
        $w = liveKitchen($this->w);
        printerAt($w, 'receipt');   // gets nothing: kitchen tickets go to kitchen printers

        deliver(deliveryPayload($w, edit: function ($p) {
            $p['order']['items'][] = ['id' => 'ext-unknown', 'name' => 'Nasi Lemak Special', 'qty' => 1, 'unit_price_sen' => 0];
            return $p;
        }))->assertOk();

        asTenant($w->tenant->id);
        $do = DeliveryOrder::sole();
        $ticket = KitchenTicket::sole();
        $job = PrintJob::sole();

        expect($do)->status->toBe('accepted')->accepted_by->toBe('auto')->accepted_at->not->toBeNull()
            ->and($ticket)->order_id->toBe($do->order_id)->source->toBe('delivery')->status->toBe('new')->notes->toBe('Call on arrival')
            ->and(collect($ticket->lines)->pluck('name')->all())->toBe(['Kopi Ais', 'Teh Tarik', 'Nasi Lemak Special'])   // unmapped still cooked
            ->and($ticket->lines[0])->toMatchArray(['qty_milli' => 2000, 'modifiers' => ['Extra shot'], 'notes' => 'less sugar'])
            ->and($job)->printer_id->toBe($w->printer->id)->kind->toBe('kitchen')->status->toBe('queued')
            ->and($job->payload)->not->toHaveKey('total_sen')->and(json_encode($job->payload))->not->toContain('Aina')
            ->and(DB::table('delivery_status_outbox')->where('delivery_order_id', $do->id)->pluck('status')->all())->toBe(['accepted']);

        Event::assertDispatched(KitchenTicketChanged::class, fn ($e) => $e->ticketId === $ticket->id && $e->change === 'new'
            && $e->broadcastOn()[0]->name === "private-outlet.{$w->outlet->id}.kitchen" && $e->broadcastWith() === ['ticket_id' => $ticket->id]);
    });

    it("doesn't auto-accept into a kitchen nobody is watching, and says why", function () {
        deliver(deliveryPayload($this->w))->assertOk();

        asTenant($this->w->tenant->id);
        $do = DeliveryOrder::sole();
        expect($do)->status->toBe('received')->accepted_at->toBeNull()->needs_attention->toBeTrue()
            ->and($do->attention_reasons)->toContain(['kind' => 'auto_accept_skipped', 'reason' => 'kitchen_not_listening'])
            ->and(KitchenTicket::count())->toBe(0)->and(DB::table('delivery_status_outbox')->count())->toBe(0);
    });

    it('leaves orders for a person when auto-accept is off', function () {
        $w = liveKitchen($this->w);
        $w->connection->update(['auto_accept' => false]);
        deliver(deliveryPayload($w))->assertOk();

        asTenant($w->tenant->id);
        expect(DeliveryOrder::sole())->status->toBe('received')->needs_attention->toBeFalse()
            ->and(KitchenTicket::count())->toBe(0);
    });

    it('fires once for a replayed webhook or the same order under a new event id', function () {
        $w = liveKitchen($this->w);
        deliver(deliveryPayload($w))->assertOk();
        deliver(deliveryPayload($w))->assertOk()->assertJson(['duplicate' => true]);
        deliver(deliveryPayload($w, edit: fn ($p) => ['event_id' => 'evt_again'] + $p))->assertOk();

        asTenant($w->tenant->id);
        expect(KitchenTicket::count())->toBe(1)->and(PrintJob::count())->toBe(1)
            ->and(DB::table('delivery_status_outbox')->count())->toBe(1);
    });

    it('prints a CANCELLED slip when the platform cancels an accepted order', function () {
        $w = liveKitchen($this->w);
        deliver(deliveryPayload($w))->assertOk();
        deliver(deliveryPayload($w, 'order_cancelled'))->assertOk();

        asTenant($w->tenant->id);
        expect(KitchenTicket::sole())->status->toBe('cancelled')->cancelled_at->not->toBeNull()
            ->and(PrintJob::orderBy('created_at')->pluck('kind')->all())->toBe(['kitchen', 'kitchen_cancel'])
            ->and(PrintJob::where('kind', 'kitchen_cancel')->sole()->payload['title'])->toBe('CANCELLED');
    });
});

describe('terminal sales', function () {
    it('fires a ticket when the till asks, once, even if the mutation is resent', function () {
        $w = world();
        printerAt($w);
        $m = orderMutation($w, order: ['send_to_kitchen' => true, 'kitchen_notes' => 'table 4', 'occurred_at' => now()->subMinutes(2)->toIso8601String()],
            item: ['kitchen_notes' => 'no ice', 'modifiers' => [['name' => 'Less sugar', 'price_delta_sen' => 0]]]);
        actAsTerminal($w->terminal);
        push($m)->assertOk();
        push(array_merge($m, ['id' => (string) Str::uuid7(), 'client_seq' => 2]))->assertOk();   // resent under a new seq

        asTenant($w->tenant->id);
        $t = KitchenTicket::sole();
        expect($t)->source->toBe('terminal')->status->toBe('new')->label->toBe($m['payload']['order']['receipt_no'])->notes->toBe('table 4')
            ->and($t->lines[0])->toMatchArray(['name' => 'Kopi O', 'qty_milli' => 2000, 'modifiers' => ['Less sugar'], 'notes' => 'no ice'])
            ->and(PrintJob::count())->toBe(1);
    });

    it("doesn't send a sale to the kitchen unless asked", function () {
        $w = world();
        printerAt($w);
        actAsTerminal($w->terminal);
        push(orderMutation($w))->assertOk();

        asTenant($w->tenant->id);
        expect(KitchenTicket::count())->toBe(0);
    });

    it('records a late ticket for a sale synced hours after it was rung up: not printed, flagged, sale kept', function () {
        $w = world();
        printerAt($w);
        actAsTerminal($w->terminal);
        $res = push(orderMutation($w, order: ['send_to_kitchen' => true, 'occurred_at' => now()->subHours(3)->toIso8601String()]))->assertOk();

        asTenant($w->tenant->id);
        expect($res->json('results.0.status'))->toBe('conflict')
            ->and(KitchenTicket::sole()->status)->toBe('late')
            ->and(PrintJob::count())->toBe(0)
            ->and(SyncConflict::pluck('kind')->all())->toContain('kitchen_ticket_late')
            ->and(DB::table('orders')->count())->toBe(1);
    });

    it('cancels the ticket when the sale is voided', function () {
        $w = world();
        printerAt($w);
        $manager = staffMember($w, 'manager', '111111');
        $sale = orderMutation($w, order: ['send_to_kitchen' => true, 'occurred_at' => now()->subMinute()->toIso8601String()]);
        actAsTerminal($w->terminal);
        push($sale)->assertOk();
        push(['id' => (string) Str::uuid7(), 'client_seq' => 2, 'type' => 'order.void', 'client_created_at' => now()->toIso8601String(),
            'payload' => ['void_id' => (string) Str::uuid7(), 'order_id' => $sale['payload']['order']['id'], 'staff_id' => $manager->id,
                'reason' => 'wrong table', 'occurred_at' => now()->toIso8601String()]])->assertOk();

        asTenant($w->tenant->id);
        expect(KitchenTicket::sole()->status)->toBe('cancelled')
            ->and(PrintJob::pluck('kind')->sort()->values()->all())->toBe(['kitchen', 'kitchen_cancel']);
    });
});

describe('print jobs', function () {
    beforeEach(function () {
        $this->w = deliveryWorld();
        $this->w->connection->update(['auto_accept' => true]);
        liveKitchen($this->w);
        deliver(deliveryPayload($this->w))->assertOk();
        asTenant($this->w->tenant->id);
        $this->job = PrintJob::sole();
    });

    it('reaches the print node through the feed', function () {
        $changes = asDevice($this->w->nodeToken)->getJson('/api/v1/sync/pull')->assertOk()->json('changes');
        $job = collect($changes)->firstWhere('entity', 'print_job');

        expect($job['id'])->toBe($this->job->id)->and($job['data']['payload']['label'])->toBe('DLV-FIX-AB12')
            ->and(collect($changes)->pluck('entity')->unique()->sort()->values()->all())->toBe(['kitchen_ticket', 'print_job', 'printer']);
    });

    it('acks idempotently: printed once, a repeat ack is a no-op', function () {
        $ack = fn (string $result) => asDevice($this->w->nodeToken)->postJson("/api/v1/kitchen/print-jobs/{$this->job->id}/ack", ['result' => $result, 'error' => 'paper jam']);

        $ack('failed')->assertOk()->assertJson(['status' => 'failed', 'duplicate' => false]);
        $ack('printed')->assertOk()->assertJson(['status' => 'printed', 'duplicate' => false]);
        $ack('printed')->assertOk()->assertJson(['status' => 'printed', 'duplicate' => true]);
        $ack('failed')->assertOk()->assertJson(['status' => 'printed', 'duplicate' => true]);   // a late failure can't undo a print

        asTenant($this->w->tenant->id);
        expect($this->job->fresh())->status->toBe('printed')->attempts->toBe(2)->printed_by_device_id->toBe($this->w->node->id)->last_error->toBeNull();
    });

    it("can't ack another outlet's or another tenant's job", function () {
        asTenant($this->w->tenant->id);
        [, $elsewhere] = kitchenDevice($this->w, Outlet::create(['name' => 'Second', 'region_code' => 'KL']));
        $stranger = world();
        [, $foreign] = kitchenDevice($stranger);

        foreach ([$elsewhere, $foreign] as $token) {
            asDevice($token)->postJson("/api/v1/kitchen/print-jobs/{$this->job->id}/ack", ['result' => 'printed'])->assertNotFound();
        }
        asTenant($this->w->tenant->id);
        expect($this->job->fresh()->status)->toBe('queued');
    });
});

describe('channel authorisation', function () {
    it("lets an outlet's devices listen to its kitchen channel and nobody else", function () {
        $w = world();
        [, $kds] = kitchenDevice($w);
        $till = $w->terminal->createToken('device', ['pos:terminal'])->plainTextToken;
        asTenant($w->tenant->id);
        $other = Outlet::create(['name' => 'Second', 'region_code' => 'KL']);
        $stranger = world();
        [, $foreign] = kitchenDevice($stranger);

        expect(channelAuth($kds, $w->outlet->id)->assertOk()->json('auth'))->toStartWith('test-key:');
        channelAuth($till, $w->outlet->id)->assertOk();
        channelAuth($kds, $other->id)->assertForbidden();
        channelAuth($foreign, $w->outlet->id)->assertForbidden();

        app('auth')->forgetGuards();
        test()->flushHeaders()->postJson('/api/v1/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => "private-outlet.{$w->outlet->id}.kitchen"])
            ->assertUnauthorized();
    });

    it('refuses a revoked device', function () {
        $w = world();
        [$d, $kds] = kitchenDevice($w);
        $d->forceFill(['status' => Terminal::REVOKED, 'revoked_at' => now()])->save();

        channelAuth($kds, $w->outlet->id)->assertForbidden()->assertJsonPath('error', 'device_revoked');
    });
});

describe('tenant isolation', function () {
    it('hides kitchen rows from other tenants, in Eloquent and raw SQL, and blocks cross-tenant writes', function () {
        $a = deliveryWorld();
        $a->connection->update(['auto_accept' => true]);
        liveKitchen($a);
        deliver(deliveryPayload($a))->assertOk();

        $b = world();   // tenant B active
        expect(Printer::count())->toBe(0)->and(KitchenTicket::count())->toBe(0)->and(PrintJob::count())->toBe(0);
        foreach (['printers', 'kitchen_tickets', 'print_jobs'] as $table) {
            expect(DB::table($table)->count())->toBe(0);
        }
        expect(fn () => DB::transaction(fn () => DB::table('printers')->insert([
            'id' => (string) Str::uuid7(), 'tenant_id' => $a->tenant->id, 'outlet_id' => $a->outlet->id, 'name' => 'Sneaky',
        ])))->toThrow(\Illuminate\Database\QueryException::class, 'row-level security');

        asTenant($a->tenant->id);
        expect(DB::table('printers')->count())->toBe(1)->and(DB::table('kitchen_tickets')->count())->toBe(1)->and(DB::table('print_jobs')->count())->toBe(1);
    });
});

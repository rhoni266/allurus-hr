<?php

namespace App\Sync\Handlers;

use App\Delivery\{DeliveryOrderIngestor, DeliveryStatusOutbox};
use App\Kitchen\Kitchen;
use App\Models\{DeliveryOrder, KitchenTicket, KitchenTicketEvent, OfflineSyncQueue};
use App\Sync\{Facts, MutationHandler, MutationRejected, Outcome};
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;

/**
 * ticket.status — a KDS screen (or a till without one) marks a kitchen ticket preparing,
 * ready or bumped. Pushed by kitchen devices as well as tills, offline-first like any
 * mutation: the screen keeps working through an outage and syncs its taps afterwards.
 *
 * The event is stored as a fact; the ticket status is a forward-only projection, so a
 * stale or duplicate tap from a second screen is stored but changes nothing (not a
 * conflict: two screens on one pass is normal). For a delivery order the platform is told
 * `preparing` / `ready` through the status outbox. The event id is the domain idempotency key.
 */
class TicketStatusHandler implements MutationHandler
{
    public function handle($terminal, array $p, OfflineSyncQueue $queue): Outcome
    {
        Validator::make($p, [
            'event_id'    => ['required', 'uuid'],
            'ticket_id'   => ['required', 'uuid'],
            'status'      => ['required', 'in:preparing,ready,bumped'],
            'occurred_at' => ['required', 'date'],
            'staff_id'    => ['nullable', 'uuid'],
        ])->validate();

        if (KitchenTicketEvent::whereKey($p['event_id'])->exists()) {
            return Outcome::applied(['event_id' => $p['event_id'], 'note' => 'already_exists']);
        }

        // TenantScope + RLS: another tenant's ticket isn't found. Tickets are made on the
        // server, so a device only knows ones that exist; another outlet's is a device bug.
        $ticket = KitchenTicket::find($p['ticket_id']) ?? throw new MutationRejected('unknown_ticket', ['ticket_id' => $p['ticket_id']]);
        if ($ticket->outlet_id !== $terminal->outlet_id) {
            throw new MutationRejected('wrong_outlet', ['ticket_id' => $ticket->id]);
        }

        // Same lock order as ingest / cancel / accept (delivery lock, then the ticket), so a
        // platform cancellation and a bump can't deadlock or interleave.
        $delivery = $ticket->source === 'delivery' ? DeliveryOrder::where('order_id', $ticket->order_id)->first() : null;
        if ($delivery) {
            DeliveryOrderIngestor::lockOrder($delivery->connection_id, $delivery->external_order_id);
            $delivery->refresh();
        }
        $ticket = KitchenTicket::whereKey($ticket->id)->lockForUpdate()->firstOrFail();

        $from = $ticket->status;
        $moved = Kitchen::advance($ticket, $p['status']);
        KitchenTicketEvent::create([
            'id' => $p['event_id'], 'outlet_id' => $ticket->outlet_id, 'ticket_id' => $ticket->id, 'status' => $p['status'],
            'occurred_at' => CarbonImmutable::parse($p['occurred_at'])->utc(), 'device_id' => $terminal->id,
            'staff_id' => $p['staff_id'] ?? null, 'queue_id' => $queue->id, 'applied' => $moved,
        ]);

        $told = $moved && $delivery ? DeliveryStatusOutbox::kitchen($delivery, $from, $p['status'], ['ticket_id' => $ticket->id]) : [];
        $conflicts = isset($p['staff_id']) ? Facts::staffConflicts($p['staff_id'], [], 'bump') : [];

        return Facts::outcome($queue, $conflicts, array_filter([
            'ticket_id' => $ticket->id, 'status' => $ticket->status, 'moved' => $moved,
            'platform' => $told ?: null, 'ticket_cancelled' => $from === 'cancelled' ?: null,
        ], fn ($v) => $v !== null));
    }
}

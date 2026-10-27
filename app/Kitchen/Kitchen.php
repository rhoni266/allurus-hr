<?php

namespace App\Kitchen;

use App\Models\{KitchenTicket, Order, Printer, PrintJob};
use Illuminate\Support\Facades\DB;

/**
 * Sending an order to the kitchen, whatever its source (terminal sale, delivery platform,
 * later web and QR orders). Runs inside the caller's transaction:
 *
 *  - one kitchen_tickets row per order (idempotent: a second call returns the first ticket);
 *  - one print job per active kitchen printer at the outlet;
 *  - after commit, a doorbell on outlet.{id}.kitchen. The rows reach KDS screens and print
 *    nodes through the change feed either way; the bell only makes it immediate.
 */
final class Kitchen
{
    /**
     * @param list<array{name: string, qty_milli: int, modifiers?: list<string>, notes?: ?string}> $lines
     * @param bool $late the order reached the server too late to cook: record the ticket, don't print it
     */
    public static function fire(Order $order, string $source, string $label, array $lines, ?string $notes = null, bool $late = false): KitchenTicket
    {
        if ($existing = KitchenTicket::where('order_id', $order->id)->first()) {
            return $existing;
        }

        $ticket = KitchenTicket::create([
            'outlet_id' => $order->outlet_id, 'order_id' => $order->id, 'source' => $source,
            'status' => $late ? 'late' : 'new', 'label' => $label, 'notes' => $notes, 'fired_at' => now(),
            'lines' => array_map(fn ($l) => [
                'name' => $l['name'], 'qty_milli' => $l['qty_milli'],
                'modifiers' => array_values($l['modifiers'] ?? []), 'notes' => $l['notes'] ?? null,
            ], $lines),
        ]);

        if (! $late) {
            self::print($ticket, 'kitchen');
            self::ring($ticket, 'new');
        }

        return $ticket;
    }

    /**
     * The order was voided or the platform cancelled it: tell the kitchen to stop. A ticket
     * that was printed gets a CANCELLED slip on the same printers.
     */
    public static function cancel(string $orderId): ?KitchenTicket
    {
        $ticket = KitchenTicket::where('order_id', $orderId)->lockForUpdate()->first();
        if (! $ticket || in_array($ticket->status, ['cancelled', 'late'], true)) {
            return $ticket;
        }

        $ticket->update(['status' => 'cancelled', 'cancelled_at' => now()]);
        self::print($ticket, 'kitchen_cancel');
        self::ring($ticket, 'cancelled');

        return $ticket;
    }

    /** How far along a ticket is. A late ticket wasn't printed, but the kitchen may still make it. */
    public const RANK = ['new' => 0, 'late' => 0, 'preparing' => 1, 'ready' => 2, 'bumped' => 3];

    /**
     * A KDS tap (ticket.status). $ticket must be row-locked by the caller. The status only
     * moves forward: two screens, or an offline screen syncing late, can't send a ready
     * ticket back to preparing. Skipping steps is fine (new -> bumped on a busy pass).
     *
     * @return bool whether the ticket moved
     */
    public static function advance(KitchenTicket $ticket, string $status): bool
    {
        if ($ticket->status === 'cancelled' || self::RANK[$status] <= self::RANK[$ticket->status]) {
            return false;
        }

        $ticket->update(['status' => $status, "{$status}_at" => now()]);
        self::ring($ticket, $status);

        return true;
    }

    private static function print(KitchenTicket $ticket, string $kind): void
    {
        $printers = Printer::where('outlet_id', $ticket->outlet_id)->where('role', 'kitchen')->where('is_active', true)->get();
        foreach ($printers as $p) {
            PrintJob::create([
                'outlet_id' => $ticket->outlet_id, 'printer_id' => $p->id, 'ticket_id' => $ticket->id, 'kind' => $kind,
                'payload' => self::layout($ticket, $kind),
            ]);
        }
    }

    /**
     * A device-neutral layout; the print node turns it into ESC/POS for its printer.
     * Prices and customer details are deliberately absent: the kitchen doesn't need them.
     */
    private static function layout(KitchenTicket $ticket, string $kind): array
    {
        return [
            'title' => $kind === 'kitchen_cancel' ? 'CANCELLED' : 'KITCHEN',
            'label' => $ticket->label,
            'source' => $ticket->source,
            'fired_at' => $ticket->fired_at->toIso8601String(),
            'lines' => $ticket->lines,
            'notes' => $ticket->notes,
        ];
    }

    /** After commit, so a device that pulls on the bell is sure to find the rows. */
    private static function ring(KitchenTicket $ticket, string $change): void
    {
        $event = new KitchenTicketChanged($ticket->tenant_id, $ticket->outlet_id, $ticket->id, $change);
        // A broadcaster that's down must not fail the order: devices still get the rows by pull.
        DB::afterCommit(fn () => rescue(fn () => event($event), report: true));
    }
}

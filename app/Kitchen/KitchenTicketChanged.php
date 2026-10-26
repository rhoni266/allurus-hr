<?php

namespace App\Kitchen;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;

/**
 * The doorbell: "a kitchen ticket at your outlet changed, pull now". It carries only the
 * ticket id, never the order (no prices, no customer). KDS screens and print nodes render
 * from what they pull, so a missed bell costs seconds, not a ticket.
 *
 * Queued (ShouldBroadcast, not Now): a slow or unreachable Reverb must not hold up the
 * order that rang it.
 */
final class KitchenTicketChanged implements ShouldBroadcast
{
    public function __construct(
        public string $tenantId,
        public string $outletId,
        public string $ticketId,
        public string $change,   // new | cancelled
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel("outlet.{$this->outletId}.kitchen")];
    }

    public function broadcastAs(): string
    {
        return "ticket.{$this->change}";
    }

    public function broadcastWith(): array
    {
        return ['ticket_id' => $this->ticketId];
    }
}

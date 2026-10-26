<?php

namespace App\Delivery;

use App\Database\Timestamps;
use App\Models\DeliveryOrder;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Sends one delivery order's queued statuses to its platform, oldest first, never two at
 * once (a session advisory lock per order; a second worker just leaves). A transient
 * failure stops the queue for that order, so a later status can't overtake an earlier one,
 * and is retried after pos.delivery.push_backoff. A permanent failure, or running out of
 * retries, gives the row up and flags the order status_push_failed for a person.
 *
 * Runs with the tenant entered (PushDeliveryStatus, delivery:tick). No transaction is held
 * open across the call to the platform.
 */
final class DeliveryStatusPusher
{
    public function __construct(private ProviderRegistry $providers) {}

    /** @return int rows the platform took */
    public function push(string $deliveryOrderId): int
    {
        $key = "delivery-status:{$deliveryOrderId}";
        if (! DB::selectOne('SELECT pg_try_advisory_lock(hashtextextended(?, 0)) AS ok', [$key])->ok) {
            return 0;   // another worker is on this order
        }

        try {
            $sent = 0;
            while ($row = $this->next($deliveryOrderId)) {
                if ($row->next_attempt_at !== null && CarbonImmutable::parse($row->next_attempt_at)->isFuture()) {
                    break;   // backing off; delivery:tick comes back for it
                }
                $order = DeliveryOrder::with('connection')->findOrFail($deliveryOrderId);
                try {
                    $this->providers->get($order->provider)
                        ->pushStatus($order->connection, $order, $row->status, json_decode($row->context ?? '{}', true) ?? []);
                } catch (DeliveryPushFailed $e) {
                    if ($e->permanent) {
                        $this->giveUp($row, $order, $e->getMessage());
                        continue;   // the next status may still be valid (e.g. a later rejection)
                    }
                    $this->retryLater($row, $order, $e->getMessage());
                    break;
                } catch (\Throwable $e) {
                    report($e);
                    $this->retryLater($row, $order, mb_substr($e->getMessage(), 0, 500));
                    break;
                }

                $this->update($row->id, ['sent_at' => $this->now(), 'attempts' => $row->attempts + 1, 'last_error' => null]);
                $sent++;
            }

            return $sent;
        } finally {
            DB::statement('SELECT pg_advisory_unlock(hashtextextended(?, 0))', [$key]);
        }
    }

    private function next(string $deliveryOrderId): ?object
    {
        return DB::table('delivery_status_outbox')->where('delivery_order_id', $deliveryOrderId)
            ->whereNull('sent_at')->whereNull('gave_up_at')->orderBy('created_at')->orderBy('id')->first();
    }

    private function retryLater(object $row, DeliveryOrder $order, string $error): void
    {
        $attempts = $row->attempts + 1;
        $backoff = config('pos.delivery.push_backoff');
        if ($attempts > count($backoff)) {
            $this->giveUp($row, $order, $error, $attempts);
            return;
        }
        $this->update($row->id, ['attempts' => $attempts, 'last_error' => $error,
            'next_attempt_at' => now()->addSeconds($backoff[$attempts - 1])->format(Timestamps::FORMAT)]);
    }

    private function giveUp(object $row, DeliveryOrder $order, string $error, ?int $attempts = null): void
    {
        $this->update($row->id, ['gave_up_at' => $this->now(), 'attempts' => $attempts ?? $row->attempts + 1, 'last_error' => $error]);
        $order->update([
            'needs_attention' => true,
            'attention_reasons' => [...$order->attention_reasons, ['kind' => 'status_push_failed', 'status' => $row->status, 'error' => $error]],
        ]);
    }

    private function update(string $id, array $values): void
    {
        DB::table('delivery_status_outbox')->where('id', $id)->update($values + ['updated_at' => $this->now()]);
    }

    private function now(): string
    {
        return now()->format(Timestamps::FORMAT);
    }
}

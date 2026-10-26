<?php

namespace App\Console\Commands;

use App\Database\Timestamps;
use App\Delivery\{DeliveryActionRefused, DeliveryOrderActions, DeliveryStatusPusher, DeliveryWatchdog};
use App\Models\{DeliveryConnection, DeliveryOrder, DeliveryStoreRoute};
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * The delivery heartbeat, scheduled every 15 seconds (routes/console.php). For every tenant
 * with a delivery store:
 *
 *  1. sends queued statuses that are due (a push job failed, was lost, or is backing off);
 *  2. rejects orders nobody accepted, pos.delivery.reject_margin_seconds before the
 *     platform's deadline (accept_by, else placed_at + the store's accept timeout);
 *  3. runs the kitchen watchdog (pause / reopen the store).
 *
 * One tenant's failure is reported and doesn't stop the others.
 */
class DeliveryTick extends Command
{
    protected $signature = 'delivery:tick';

    protected $description = 'Retry delivery statuses, auto-reject unaccepted orders, pause stores with a quiet kitchen';

    public function handle(DeliveryStatusPusher $pusher, DeliveryOrderActions $actions, DeliveryWatchdog $watchdog): int
    {
        $totals = ['pushed' => 0, 'rejected' => 0, 'paused' => 0, 'resumed' => 0];

        // delivery_store_routes has no RLS: it is how a tenant-less process finds them
        foreach (DeliveryStoreRoute::query()->distinct()->pluck('tenant_id') as $tenantId) {
            TenantContext::enter($tenantId);
            try {
                $totals['pushed'] += $this->pushDue($pusher);
                $totals['rejected'] += $this->rejectOverdue($actions);
                foreach (DeliveryConnection::whereIn('status', ['active', 'paused'])->get() as $c) {
                    try {
                        if ($r = $watchdog->check($c)) {
                            $totals[$r]++;
                        }
                    } catch (\Throwable $e) {
                        report($e);   // platform unreachable: the next tick tries again
                    }
                }
            } catch (\Throwable $e) {
                report($e);
            } finally {
                TenantContext::leave();
            }
        }

        if ($this->output->isVerbose()) {
            $this->line(json_encode($totals));
        }

        return self::SUCCESS;
    }

    private function pushDue(DeliveryStatusPusher $pusher): int
    {
        $due = DB::table('delivery_status_outbox')->whereNull('sent_at')->whereNull('gave_up_at')
            ->where('next_attempt_at', '<=', now()->format(Timestamps::FORMAT))
            ->distinct()->pluck('delivery_order_id');

        return $due->sum(fn ($id) => $pusher->push($id));
    }

    private function rejectOverdue(DeliveryOrderActions $actions): int
    {
        $margin = config('pos.delivery.reject_margin_seconds');
        $overdue = DeliveryOrder::where('delivery_orders.status', 'received')
            ->join('delivery_connections as c', 'c.id', '=', 'delivery_orders.connection_id')
            ->whereRaw("COALESCE(delivery_orders.accept_by, delivery_orders.placed_at + make_interval(secs => c.accept_timeout_seconds)) - make_interval(secs => ?) <= ?",
                [$margin, now()->format(Timestamps::FORMAT)])
            ->select('delivery_orders.*')->get();

        $n = 0;
        foreach ($overdue as $do) {
            try {
                $n += $actions->reject($do, 'auto', 'not_accepted_in_time')['changed'] ? 1 : 0;
            } catch (DeliveryActionRefused) {
                // accepted or cancelled since we looked
            }
        }

        return $n;
    }
}

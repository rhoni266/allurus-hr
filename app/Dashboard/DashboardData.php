<?php

namespace App\Dashboard;

use App\Database\Timestamps;
use Illuminate\Support\Facades\DB;

/**
 * Read-only figures for the back-office dashboard, for one tenant. Call with the tenant
 * entered (TenantContext::enter): every query is also filtered by tenant_id explicitly, so
 * the scope and RLS are two walls here as everywhere else. Money stays integer sen.
 */
final class DashboardData
{
    /** range key => hours back (null = all time) */
    public const RANGES = ['24h' => 24, '7d' => 168, 'all' => null];

    public const ONLINE_SECONDS = 300;

    public static function load(string $tenantId, string $range = '24h'): array
    {
        $hours = self::RANGES[$range] ?? 24;
        $from = $hours === null ? null : now()->subHours($hours)->format(Timestamps::FORMAT);
        $t = fn (string $table) => DB::table($table)->where("{$table}.tenant_id", $tenantId);
        $since = fn ($q, string $col) => $from === null ? $q : $q->where($col, '>=', $from);

        $orders = $since($t('orders'), 'orders.occurred_at');
        $live = (clone $orders)->where('orders.status', '!=', 'void');
        $sales = (clone $live)->selectRaw('count(*) AS n, coalesce(sum(total_sen), 0) AS total')->first();
        $refunds = $since($t('order_refunds'), 'occurred_at')->selectRaw('count(*) AS n, coalesce(sum(refund_sen), 0) AS total')->first();

        $kitchenInRange = $since($t('kitchen_tickets'), 'fired_at');
        $readySecs = (clone $kitchenInRange)->whereNotNull('ready_at')
            ->selectRaw('avg(extract(epoch FROM ready_at - fired_at))::int AS s')->value('s');

        return [
            'kpis' => [
                'sales_n' => (int) $sales->n,
                'sales_sen' => (int) $sales->total,
                'refunds_n' => (int) $refunds->n,
                'refunds_sen' => (int) $refunds->total,
                'net_sen' => (int) $sales->total - (int) $refunds->total,
                'voids_n' => $since($t('order_voids'), 'occurred_at')->count(),
                'avg_ticket_sen' => (int) $sales->n > 0 ? intdiv((int) $sales->total, (int) $sales->n) : 0,
                'ready_seconds' => $readySecs === null ? null : (int) $readySecs,
            ],
            'channels' => (clone $live)->groupBy('channel')
                ->selectRaw('channel, count(*) AS n, sum(total_sen) AS total')->orderByDesc('total')->get(),
            'payments' => $since($t('payments'), 'occurred_at')->groupBy('method')
                ->selectRaw('method, count(*) AS n, sum(amount_sen) AS total')->orderByDesc('total')->get(),
            'recent_orders' => (clone $orders)->leftJoin('terminals', 'terminals.id', '=', 'orders.terminal_id')
                ->orderByDesc('orders.occurred_at')->limit(12)
                ->get(['orders.receipt_no', 'orders.channel', 'orders.status', 'orders.total_sen', 'orders.occurred_at', 'terminals.name AS terminal']),
            // the kitchen board is "now", whatever the range
            'kitchen_open' => $t('kitchen_tickets')->whereIn('status', ['new', 'preparing', 'ready'])
                ->orderBy('fired_at')->limit(30)->get(['label', 'source', 'status', 'lines', 'fired_at']),
            'kitchen_counts' => (clone $kitchenInRange)->groupBy('status')->selectRaw('status, count(*) AS n')->pluck('n', 'status'),
            'delivery_orders' => $since($t('delivery_orders'), 'placed_at')->orderByDesc('placed_at')->limit(10)
                ->get(['provider', 'external_order_id', 'short_code', 'status', 'platform_total_sen', 'needs_attention', 'placed_at', 'accepted_by']),
            'delivery_counts' => $since($t('delivery_orders'), 'placed_at')->groupBy('status')->selectRaw('status, count(*) AS n')->pluck('n', 'status'),
            'status_outbox' => [
                'waiting' => $t('delivery_status_outbox')->whereNull('sent_at')->whereNull('gave_up_at')->count(),
                'given_up' => $t('delivery_status_outbox')->whereNotNull('gave_up_at')->count(),
            ],
            'stores' => $t('delivery_connections')->orderBy('provider')->get(['provider', 'external_store_id', 'status', 'auto_accept', 'pause_reason']),
            'devices' => $t('terminals')->orderBy('kind')->orderBy('name')
                ->get(['name', 'kind', 'status', 'last_seen_at', 'last_heartbeat_at', 'outbox_pending']),
            'flags' => $since($t('sync_conflicts'), 'created_at')->groupBy('kind')->selectRaw('kind, count(*) AS n')->orderByDesc('n')->get(),
            'rejected' => $since($t('offline_sync_queues'), 'received_at')->where('status', 'rejected')->count(),
        ];
    }

    /** 123456 -> "RM 1,234.56"; integer arithmetic only. */
    public static function rm(int $sen): string
    {
        $sign = $sen < 0 ? '-' : '';
        $abs = abs($sen);

        return sprintf('%sRM %s.%02d', $sign, number_format(intdiv($abs, 100)), $abs % 100);
    }
}

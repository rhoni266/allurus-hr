@php
    use App\Dashboard\DashboardData;
    use Carbon\CarbonImmutable;
    $rm = fn ($sen) => DashboardData::rm((int) $sen);
    $myt = fn ($ts) => $ts ? CarbonImmutable::parse($ts)->setTimezone('Asia/Kuala_Lumpur') : null;
    $ago = function ($ts) {
        if (! $ts) { return 'never'; }
        $s = max(0, (int) CarbonImmutable::parse($ts)->diffInSeconds(now(), true));
        return match (true) { $s < 60 => "{$s}s ago", $s < 3600 => intdiv($s, 60).'m ago', $s < 86400 => intdiv($s, 3600).'h ago', default => intdiv($s, 86400).'d ago' };
    };
    $mins = fn (?int $s) => $s === null ? '—' : ($s < 60 ? "{$s}s" : intdiv($s, 60).'m '.str_pad((string) ($s % 60), 2, '0', STR_PAD_LEFT).'s');
    $k = $d['kpis'];
    $rangeLabel = ['24h' => 'Last 24 hours', '7d' => 'Last 7 days', 'all' => 'All time'][$range];
    $board = collect($d['kitchen_open'])->groupBy('status');
    $maxPay = max(1, (int) collect($d['payments'])->max('total'));
    $maxChan = max(1, (int) collect($d['channels'])->max('total'));
    $online = fn ($dev) => ($dev->last_seen_at && CarbonImmutable::parse($dev->last_seen_at)->gt(now()->subSeconds(DashboardData::ONLINE_SECONDS)))
        || ($dev->last_heartbeat_at && CarbonImmutable::parse($dev->last_heartbeat_at)->gt(now()->subSeconds(DashboardData::ONLINE_SECONDS)));
@endphp
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="20">
<meta name="robots" content="noindex">
<title>{{ $tenant->name }} · Allurus POS</title>
<style>
:root{--bg:#f5f6f8;--card:#fff;--ink:#16181d;--mute:#6b7280;--line:#e5e7eb;--accent:#0f766e;--accent-soft:#ccfbf1;--warn:#b45309;--warn-soft:#fef3c7;--bad:#b91c1c;--bad-soft:#fee2e2;--ok:#15803d;--ok-soft:#dcfce7;--blue:#1d4ed8;--blue-soft:#dbeafe}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--ink:#e8eaee;--mute:#9aa3b2;--line:#262b35;--accent:#2dd4bf;--accent-soft:#0f2f2c;--warn:#fbbf24;--warn-soft:#3a2d0c;--bad:#f87171;--bad-soft:#3b1414;--ok:#4ade80;--ok-soft:#10301b;--blue:#93c5fd;--blue-soft:#14233f}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1280px;margin:0 auto;padding:20px 16px 48px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:18px}
h1{font-size:20px;margin:0}
.sub{color:var(--mute);font-size:13px}
.tabs{display:flex;gap:4px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:3px}
.tabs a{padding:6px 12px;border-radius:7px;color:var(--mute);text-decoration:none;font-weight:500}
.tabs a.on{background:var(--accent-soft);color:var(--accent)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.kpi,.card{background:var(--card);border:1px solid var(--line);border-radius:12px}
.kpi{padding:14px 16px}
.kpi .l{color:var(--mute);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.kpi .v{font-size:24px;font-weight:650;margin-top:4px;font-variant-numeric:tabular-nums}
.kpi .s{color:var(--mute);font-size:12px}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}
.c8{grid-column:span 8}.c4{grid-column:span 4}.c6{grid-column:span 6}.c12{grid-column:span 12}
@media (max-width:980px){.c8,.c4,.c6{grid-column:span 12}}
.card{padding:16px;min-width:0}
.card h2{font-size:14px;margin:0 0 12px;display:flex;justify-content:space-between;align-items:center}
.card h2 small{color:var(--mute);font-weight:400}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th{text-align:left;color:var(--mute);font-weight:500;font-size:12px;padding:6px 8px;border-bottom:1px solid var(--line)}
td{padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
tr:last-child td{border-bottom:0}
td.r,th.r{text-align:right}
.scroll{overflow-x:auto}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:500;background:var(--line);color:var(--mute)}
.p-ok{background:var(--ok-soft);color:var(--ok)}.p-warn{background:var(--warn-soft);color:var(--warn)}.p-bad{background:var(--bad-soft);color:var(--bad)}.p-blue{background:var(--blue-soft);color:var(--blue)}.p-acc{background:var(--accent-soft);color:var(--accent)}
.board{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
@media (max-width:640px){.board{grid-template-columns:1fr}}
.col{background:var(--bg);border-radius:10px;padding:8px;min-height:120px}
.col h3{margin:2px 4px 8px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--mute);display:flex;justify-content:space-between}
.tk{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:8px}
.tk b{font-size:13px}.tk .m{color:var(--mute);font-size:12px}
.tk ul{margin:4px 0 0;padding-left:16px;font-size:12px}
.bar{height:8px;border-radius:4px;background:var(--accent);margin-top:4px}
.row{display:flex;justify-content:space-between;gap:8px;font-variant-numeric:tabular-nums}
.list>div{padding:8px 0;border-bottom:1px solid var(--line)}.list>div:last-child{border-bottom:0}
.empty{color:var(--mute);padding:10px 0}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:var(--mute)}.dot.on{background:var(--ok)}
footer{margin-top:24px;color:var(--mute);font-size:12px}
</style>
</head>
<body>
<div class="wrap">
<header>
    <div>
        <h1>{{ $tenant->name }}</h1>
        <div class="sub">{{ ['fnb' => 'F&B', 'retail' => 'Retail', 'service' => 'Services'][$tenant->business_type] ?? $tenant->business_type }} · {{ $rangeLabel }} · updated {{ $myt(now())->format('H:i:s') }} MYT · refreshes every 20 s</div>
    </div>
    <nav class="tabs">
        @foreach (['24h' => '24 hours', '7d' => '7 days', 'all' => 'All time'] as $key => $label)
            <a href="{{ $request->fullUrlWithQuery(['range' => $key]) }}" class="{{ $range === $key ? 'on' : '' }}">{{ $label }}</a>
        @endforeach
    </nav>
</header>

<section class="kpis">
    <div class="kpi"><div class="l">Net sales</div><div class="v">{{ $rm($k['net_sen']) }}</div><div class="s">after {{ $rm($k['refunds_sen']) }} refunded</div></div>
    <div class="kpi"><div class="l">Orders</div><div class="v">{{ number_format($k['sales_n']) }}</div><div class="s">{{ $k['voids_n'] }} voided</div></div>
    <div class="kpi"><div class="l">Average order</div><div class="v">{{ $rm($k['avg_ticket_sen']) }}</div><div class="s">gross {{ $rm($k['sales_sen']) }}</div></div>
    <div class="kpi"><div class="l">Refunds</div><div class="v">{{ $k['refunds_n'] }}</div><div class="s">{{ $rm($k['refunds_sen']) }}</div></div>
    <div class="kpi"><div class="l">Kitchen: fired → ready</div><div class="v">{{ $mins($k['ready_seconds']) }}</div><div class="s">average, {{ (int) ($d['kitchen_counts']['bumped'] ?? 0) }} bumped</div></div>
    <div class="kpi"><div class="l">Needs a look</div><div class="v">{{ collect($d['flags'])->sum('n') + $d['rejected'] }}</div><div class="s">{{ collect($d['flags'])->sum('n') }} flags · {{ $d['rejected'] }} rejected</div></div>
</section>

<div class="grid">
    <section class="card c8">
        <h2>Kitchen now <small>{{ collect($d['kitchen_open'])->count() }} open tickets</small></h2>
        <div class="board">
            @foreach (['new' => 'New', 'preparing' => 'Preparing', 'ready' => 'Ready'] as $status => $label)
                <div class="col">
                    <h3><span>{{ $label }}</span><span>{{ count($board[$status] ?? []) }}</span></h3>
                    @forelse ($board[$status] ?? [] as $tk)
                        <div class="tk">
                            <div class="row"><b>{{ $tk->label }}</b><span class="pill {{ $tk->source === 'delivery' ? 'p-blue' : 'p-acc' }}">{{ $tk->source }}</span></div>
                            <div class="m">fired {{ $ago($tk->fired_at) }}</div>
                            <ul>
                                @foreach (array_slice(json_decode($tk->lines, true) ?? [], 0, 4) as $line)
                                    <li>{{ rtrim(rtrim(sprintf('%d.%03d', intdiv($line['qty_milli'], 1000), $line['qty_milli'] % 1000), '0'), '.') }} × {{ $line['name'] }}@if (! empty($line['notes'])) <span class="m">— {{ $line['notes'] }}</span>@endif</li>
                                @endforeach
                            </ul>
                        </div>
                    @empty
                        <div class="empty">Nothing here</div>
                    @endforelse
                </div>
            @endforeach
        </div>
    </section>

    <section class="card c4">
        <h2>Delivery <small>{{ collect($d['delivery_counts'])->sum() }} orders</small></h2>
        @forelse ($d['stores'] as $s)
            <div class="row" style="margin-bottom:8px">
                <span>{{ ucfirst($s->provider) }} <span class="sub">{{ $s->external_store_id }}</span></span>
                <span class="pill {{ $s->status === 'active' ? 'p-ok' : ($s->status === 'paused' ? 'p-warn' : 'p-bad') }}">{{ $s->status }}{{ $s->pause_reason ? ' · '.$s->pause_reason : '' }}</span>
            </div>
        @empty
            <div class="empty">No delivery platforms connected.</div>
        @endforelse
        <div class="row" style="margin:6px 0 12px">
            @foreach (['received' => 'p-warn', 'accepted' => 'p-ok', 'rejected' => 'p-bad', 'cancelled' => ''] as $st => $cls)
                <span class="pill {{ $cls }}">{{ $st }} {{ (int) ($d['delivery_counts'][$st] ?? 0) }}</span>
            @endforeach
        </div>
        <div class="list">
            @forelse ($d['delivery_orders'] as $o)
                <div class="row">
                    <span><b>{{ $o->short_code ?? $o->external_order_id }}</b> <span class="sub">{{ $ago($o->placed_at) }}{{ $o->accepted_by === 'auto' ? ' · auto' : '' }}</span>@if ($o->needs_attention) <span class="pill p-warn">attention</span>@endif</span>
                    <span>{{ $rm($o->platform_total_sen) }} <span class="pill {{ ['accepted' => 'p-ok', 'received' => 'p-warn', 'rejected' => 'p-bad'][$o->status] ?? '' }}">{{ $o->status }}</span></span>
                </div>
            @empty
                <div class="empty">No delivery orders in this period.</div>
            @endforelse
        </div>
        <div class="sub" style="margin-top:10px">Status updates to platforms: {{ $d['status_outbox']['waiting'] }} waiting · <span style="{{ $d['status_outbox']['given_up'] ? 'color:var(--bad)' : '' }}">{{ $d['status_outbox']['given_up'] }} given up</span></div>
    </section>

    <section class="card c8">
        <h2>Recent orders <small>{{ $rangeLabel }}</small></h2>
        <div class="scroll">
        <table>
            <thead><tr><th>Receipt</th><th>Time (MYT)</th><th>Channel</th><th>Terminal</th><th>Status</th><th class="r">Total</th></tr></thead>
            <tbody>
            @forelse ($d['recent_orders'] as $o)
                <tr>
                    <td>{{ $o->receipt_no }}</td>
                    <td>{{ $myt($o->occurred_at)->format('d M H:i') }}</td>
                    <td>{{ str_replace('_', ' ', $o->channel) }}</td>
                    <td>{{ $o->terminal ?? '—' }}</td>
                    <td><span class="pill {{ ['paid' => 'p-ok', 'open' => 'p-warn', 'void' => 'p-bad', 'refunded' => 'p-bad', 'partially_refunded' => 'p-warn'][$o->status] ?? '' }}">{{ str_replace('_', ' ', $o->status) }}</span></td>
                    <td class="r">{{ $rm($o->total_sen) }}</td>
                </tr>
            @empty
                <tr><td colspan="6" class="empty">No orders in this period.</td></tr>
            @endforelse
            </tbody>
        </table>
        </div>
    </section>

    <section class="card c4">
        <h2>Payments <small>by method</small></h2>
        <div class="list">
            @forelse ($d['payments'] as $p)
                <div>
                    <div class="row"><span>{{ ucfirst(str_replace('_', ' ', $p->method)) }} <span class="sub">{{ $p->n }}</span></span><span>{{ $rm($p->total) }}</span></div>
                    <div class="bar" style="width:{{ max(2, intdiv(max(0, (int) $p->total) * 100, $maxPay)) }}%"></div>
                </div>
            @empty
                <div class="empty">No payments in this period.</div>
            @endforelse
        </div>
        <h2 style="margin-top:18px">Channels</h2>
        <div class="list">
            @forelse ($d['channels'] as $c)
                <div>
                    <div class="row"><span>{{ str_replace('_', ' ', $c->channel) }} <span class="sub">{{ $c->n }}</span></span><span>{{ $rm($c->total) }}</span></div>
                    <div class="bar" style="width:{{ max(2, intdiv(max(0, (int) $c->total) * 100, $maxChan)) }}%;background:var(--blue)"></div>
                </div>
            @empty
                <div class="empty">No sales in this period.</div>
            @endforelse
        </div>
    </section>

    <section class="card c8">
        <h2>Devices <small>{{ count($d['devices']) }} paired</small></h2>
        <div class="scroll">
        <table>
            <thead><tr><th>Device</th><th>Kind</th><th>Status</th><th>Last seen</th><th class="r">Unsynced</th></tr></thead>
            <tbody>
            @forelse ($d['devices'] as $dev)
                <tr>
                    <td><span class="dot {{ $online($dev) ? 'on' : '' }}"></span>{{ $dev->name }}</td>
                    <td>{{ $dev->kind === 'kitchen' ? 'kitchen' : 'till' }}</td>
                    <td><span class="pill {{ ['active' => 'p-ok', 'retiring' => 'p-warn', 'revoked' => 'p-bad'][$dev->status] ?? '' }}">{{ $dev->status }}</span></td>
                    <td>{{ $ago(max($dev->last_seen_at, $dev->last_heartbeat_at)) }}</td>
                    <td class="r" style="{{ $dev->outbox_pending > 0 ? 'color:var(--warn);font-weight:600' : '' }}">{{ (int) $dev->outbox_pending }}</td>
                </tr>
            @empty
                <tr><td colspan="5" class="empty">No devices paired yet. Run php artisan pos:pairing-code.</td></tr>
            @endforelse
            </tbody>
        </table>
        </div>
    </section>

    <section class="card c4">
        <h2>Flags for review <small>{{ $rangeLabel }}</small></h2>
        <div class="list">
            @forelse ($d['flags'] as $f)
                <div class="row"><span>{{ str_replace('_', ' ', $f->kind) }}</span><span class="pill p-warn">{{ $f->n }}</span></div>
            @empty
                <div class="empty">Nothing flagged.</div>
            @endforelse
            @if ($d['rejected'])
                <div class="row"><span>rejected mutations</span><span class="pill p-bad">{{ $d['rejected'] }}</span></div>
            @endif
        </div>
    </section>
</div>

<footer>Read-only. This link is signed and expires; get a new one with <code>php artisan pos:dashboard-link {{ $tenant->slug }}</code>. Anyone with the link can see this page.</footer>
</div>
</body>
</html>

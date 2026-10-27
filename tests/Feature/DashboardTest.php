<?php

use App\Dashboard\DashboardData;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\{Artisan, URL};

function dashboardUrl(object $w, int $minutes = 60): string
{
    return URL::temporarySignedRoute('dashboard', now()->addMinutes($minutes), ['tenant' => $w->tenant->id], absolute: false);
}

/** Two paid sales (7.00 each) on $w's terminal, one of them sent to the kitchen. */
function twoSales(object $w): void
{
    actAsTerminal($w->terminal);
    $a = orderMutation($w, 1);
    $a['payload']['order']['send_to_kitchen'] = true;
    $a['payload']['order']['occurred_at'] = $a['client_created_at'] = now()->toIso8601String();
    push($a, orderMutation($w, 2))->assertOk();
    TenantContext::clear();
}

it('shows a tenant its own figures through a signed link', function () {
    $w = world();
    twoSales($w);

    $this->get(dashboardUrl($w))->assertOk()
        ->assertSee($w->tenant->name)
        ->assertSee('RM 14.00')            // 2 × 2 kopi at 3.50
        ->assertSee('OUT1-T1-000001')
        ->assertSee('Kitchen now')
        ->assertHeader('Cache-Control', 'no-store, private');
});

it('refuses a link that is unsigned, tampered with or expired', function () {
    $w = world();
    $b = world();
    $url = dashboardUrl($w);

    $this->get("/dashboard/{$w->tenant->id}")->assertForbidden()->assertSee('invalid or has expired');
    $this->get(str_replace($w->tenant->id, $b->tenant->id, $url))->assertForbidden();   // another tenant: signature breaks
    $this->get($url.'&extra=1')->assertForbidden();
    $this->travel(61)->minutes();
    $this->get($url)->assertForbidden();
});

it('lets only the range change without breaking the signature', function () {
    $w = world();
    twoSales($w);
    $url = dashboardUrl($w);

    foreach (['7d', 'all', 'nonsense'] as $range) {
        $this->get("{$url}&range={$range}")->assertOk()->assertSee('RM 14.00');
    }
});

it('never shows another tenant\'s data, and leaves no tenant context behind', function () {
    $a = world();
    twoSales($a);
    $b = world();
    TenantContext::clear();

    $this->get(dashboardUrl($b))->assertOk()->assertSee($b->tenant->name)
        ->assertDontSee('OUT1-T1-000001')->assertDontSee('RM 14.00')->assertDontSee($a->tenant->name);
    expect(TenantContext::id())->toBeNull()
        ->and(DB::selectOne("SELECT current_setting('app.tenant_id', true) AS t")->t)->toBe('');
});

it('counts sales, refunds-free net, the kitchen board and devices', function () {
    $w = world();
    twoSales($w);
    TenantContext::enter($w->tenant->id);
    try {
        $d = DashboardData::load($w->tenant->id, '24h');
    } finally {
        TenantContext::leave();
    }

    expect($d['kpis'])->toMatchArray(['sales_n' => 2, 'sales_sen' => 1400, 'net_sen' => 1400, 'avg_ticket_sen' => 700, 'voids_n' => 0])
        ->and(collect($d['kitchen_open'])->pluck('status')->all())->toBe(['new'])
        ->and(collect($d['devices'])->pluck('name')->all())->toBe(['T1'])
        ->and((int) collect($d['payments'])->firstWhere('method', 'cash')->total)->toBe(1400);
});

it('is off when disabled', function () {
    $w = world();
    config(['pos.dashboard.enabled' => false]);

    $this->get(dashboardUrl($w))->assertNotFound();
    expect(Artisan::call('pos:dashboard-link', ['tenant' => $w->tenant->slug]))->toBe(1);
});

it('formats sen as ringgit with integer arithmetic', function () {
    expect(DashboardData::rm(0))->toBe('RM 0.00')
        ->and(DashboardData::rm(5))->toBe('RM 0.05')
        ->and(DashboardData::rm(123456789))->toBe('RM 1,234,567.89')
        ->and(DashboardData::rm(-1050))->toBe('-RM 10.50');
});

it('prints a working link from the CLI', function () {
    $w = world();
    TenantContext::clear();

    Artisan::call('pos:dashboard-link', ['tenant' => $w->tenant->slug, '--hours' => 2]);
    $link = collect(preg_split('/\R/', Artisan::output()))->first(fn ($l) => str_contains($l, '/dashboard/'));

    expect($link)->toStartWith(rtrim(config('app.url'), '/').'/dashboard/'.$w->tenant->id);
    $this->get(parse_url($link, PHP_URL_PATH).'?'.parse_url($link, PHP_URL_QUERY))->assertOk()->assertSee($w->tenant->name);
});

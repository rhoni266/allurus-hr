<?php

use App\Devices\PairingService;
use App\Models\{KitchenTicket, TaxRule, Terminal};
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** $w with a 6% tax rule for its product, a cashier (PIN 2222), and a fresh terminal pairing code. */
function tillWorld(): object
{
    $w = world();
    TaxRule::firstOrCreate(['code' => 'SST_SALES', 'version' => 1],
        ['rate_bps' => 600, 'effective_from' => '2018-09-01', 'description' => 'test', 'source' => 'test']);
    $w->cashier = staffMember($w);
    asTenant($w->tenant->id);
    $w->code = app(PairingService::class)->issue($w->outlet)['code'];
    TenantContext::clear();

    return $w;
}

/** Pair this test "browser" and sign the cashier in. */
function tillReady(object $w): void
{
    test()->postJson('/till/pair', ['code' => $w->code, 'name' => 'Front'])->assertOk();
    test()->postJson('/till/login', ['staff_id' => $w->cashier->id, 'pin' => '2222'])->assertOk()->assertJsonPath('staff.id', $w->cashier->id);
}

function kopi(object $w, int $qtyMilli = 2000): array
{
    return ['lines' => [['variant_id' => $w->variant->id, 'qty_milli' => $qtyMilli]]];
}

it('pairs a browser through devices/register and shows the pairing screen until then', function () {
    $w = tillWorld();
    $this->get('/till')->assertOk()->assertSee('Pair this browser as a till');

    $this->postJson('/till/pair', ['code' => $w->code, 'name' => 'Front'])->assertOk();

    $t = Terminal::where('name', 'Front')->sole();
    expect($t->kind)->toBe('terminal')->and($t->tenant_id)->toBe($w->tenant->id)
        ->and(DB::table('personal_access_tokens')->where('tokenable_id', $t->id)->value('abilities'))->toBe('["pos:terminal"]');
    $this->postJson('/till/pair', ['code' => $w->code])->assertStatus(422);   // single use
});

it('refuses a kitchen code, and pairing when attestation is required', function () {
    $w = tillWorld();
    asTenant($w->tenant->id);
    $kitchen = app(PairingService::class)->issue($w->outlet, kind: 'kitchen')['code'];
    TenantContext::clear();

    $this->postJson('/till/pair', ['code' => $kitchen])->assertStatus(422)->assertJsonPath('error', 'not_a_till_code');
    config(['pos.attestation.required' => true]);
    $this->postJson('/till/pair', ['code' => $w->code])->assertStatus(422)->assertJsonPath('error', 'attestation_failed');
});

it('signs staff in through auth/login, with its lockout', function () {
    $w = tillWorld();
    $this->postJson('/till/pair', ['code' => $w->code])->assertOk();

    foreach (range(1, 5) as $_) {
        $this->postJson('/till/login', ['staff_id' => $w->cashier->id, 'pin' => '9999'])->assertStatus(401);
    }
    $this->postJson('/till/login', ['staff_id' => $w->cashier->id, 'pin' => '2222'])->assertStatus(429);
});

it('prices on the server and sells through sync/push as an order.create', function () {
    $w = tillWorld();
    tillReady($w);

    $q = $this->postJson('/till/quote', kopi($w))->assertOk();
    expect($q->json())->toMatchArray(['subtotal_sen' => 700, 'tax_sen' => 42, 'rounding_sen' => -2, 'total_sen' => 740]);   // 7.42 cash-rounded to 7.40

    $orderId = (string) Str::uuid7();
    $res = $this->postJson('/till/checkout', kopi($w) + ['order_id' => $orderId, 'tendered_sen' => 1000, 'send_to_kitchen' => true])->assertOk();
    expect($res->json())->toMatchArray(['total_sen' => 740, 'change_sen' => 260, 'tender' => 'cash'])
        ->and($res->json('receipt_no'))->toMatch('/^W[0-9A-F]{5}-000001$/');

    asTenant($w->tenant->id);
    $q = DB::table('offline_sync_queues')->sole();
    expect($q->type)->toBe('order.create')->and($q->client_seq)->toBe(1)->and($q->status)->toBeIn(['applied', 'conflict']);
    $order = DB::table('orders')->where('id', $orderId)->sole();
    expect($order)->total_sen->toBe(740)->staff_id->toBe($w->cashier->id)->created_offline->toBeFalse()
        ->and((int) DB::table('payments')->where('order_id', $orderId)->sum('amount_sen'))->toBe(740)
        ->and(KitchenTicket::where('order_id', $orderId)->exists())->toBeTrue();
});

it('takes card without cash rounding, and refuses too little cash', function () {
    $w = tillWorld();
    tillReady($w);

    $this->postJson('/till/checkout', kopi($w) + ['order_id' => (string) Str::uuid7(), 'tendered_sen' => 700])
        ->assertStatus(422)->assertJsonPath('error', 'not_enough_cash');
    $flags = $this->postJson('/till/checkout', kopi($w) + ['order_id' => (string) Str::uuid7(), 'tender' => 'card'])
        ->assertOk()->assertJsonPath('total_sen', 742)->json('flags');
    expect($flags)->not->toContain('offline_noncash_payment');   // an online card sale is fine
});

it('stores a retried checkout once, under the first receipt number', function () {
    $w = tillWorld();
    tillReady($w);
    $body = kopi($w) + ['order_id' => (string) Str::uuid7()];

    $first = $this->postJson('/till/checkout', $body)->assertOk()->json('receipt_no');
    $this->postJson('/till/checkout', $body)->assertOk()->assertJsonPath('receipt_no', $first)->assertJsonPath('duplicate', true);
    $this->postJson('/till/checkout', kopi($w) + ['order_id' => (string) Str::uuid7()])->assertOk()->assertJsonPath('receipt_no', str_replace('000001', '000003', $first));

    asTenant($w->tenant->id);
    expect(DB::table('orders')->count())->toBe(2);
});

it('needs a paired device and a signed-in staff member', function () {
    $w = tillWorld();
    $this->postJson('/till/quote', kopi($w))->assertStatus(409)->assertJsonPath('error', 'not_paired');

    $this->postJson('/till/pair', ['code' => $w->code])->assertOk();
    $this->postJson('/till/checkout', kopi($w) + ['order_id' => (string) Str::uuid7()])->assertStatus(401)->assertJsonPath('error', 'staff_signed_out');
});

it('drops the device from the session once it is revoked', function () {
    $w = tillWorld();
    tillReady($w);
    Terminal::where('name', 'Front')->update(['status' => Terminal::REVOKED, 'revoked_at' => now()]);

    $this->postJson('/till/quote', kopi($w))->assertStatus(409);
    $this->get('/till')->assertOk()->assertSee('Pair this browser as a till');
});

it('shows a till only its own tenant\'s products and staff', function () {
    $other = tillWorld();
    $other->product->update(['name' => 'Other tenant secret blend']);
    $w = tillWorld();
    tillReady($w);

    $this->get('/till')->assertOk()->assertSee('Kopi O')->assertSee($w->cashier->name)
        ->assertDontSee('Other tenant secret blend')->assertDontSee($other->cashier->name);
    $this->postJson('/till/quote', ['lines' => [['variant_id' => $other->variant->id, 'qty_milli' => 1000]]])
        ->assertStatus(422)->assertJsonPath('error', 'unknown_product');
    expect(TenantContext::id())->toBeNull();
});

it('is off when disabled', function () {
    config(['pos.web_till.enabled' => false]);
    $this->get('/till')->assertNotFound();
});

<?php

namespace App\Http\Controllers;

use App\Models\Terminal;
use App\Till\{TillApi, TillSale};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * The web till (/till): a browser page that works as one paired POS terminal, for demos and
 * testing until the tablet app exists. Online only.
 *
 * The browser never holds the device token or prices anything. This controller keeps the
 * token in the server-side session and talks to the real API through TillApi: pairing
 * (devices/register), PIN sign-in (auth/login, with its lockout), and every sale as an
 * order.create mutation through sync/push, priced by PricingEngine. So a web-till sale is
 * stored, flagged, ticketed and counted exactly like a tablet's.
 *
 * Off in production unless POS_WEB_TILL_ENABLED=true. Pairing still obeys attestation:
 * with pos.attestation.required a browser can't attest, so it can't pair.
 */
class TillController
{
    private const S = 'till';

    public function show(Request $request)
    {
        abort_unless(config('pos.web_till.enabled'), 404);
        $t = $this->device($request);

        return response()->view('till', [
            'state' => [
                'device' => $t ? ['id' => $t->id, 'name' => $t->name, 'receipt_prefix' => TillSale::receiptNo($t, 0)] : null,
                'staff' => $t ? $request->session()->get(self::S.'.staff') : null,
                'roster' => $t ? TillSale::staff($t) : [],
                'catalogue' => $t ? TillSale::catalogue($t) : [],
                'recent' => $t ? TillSale::recent($t) : [],
            ],
        ])->header('Cache-Control', 'no-store');
    }

    public function pair(Request $request)
    {
        abort_unless(config('pos.web_till.enabled'), 404);
        $data = $request->validate(['code' => ['required', 'string', 'max:32'], 'name' => ['nullable', 'string', 'max:40']]);

        $res = TillApi::call('POST', 'devices/register', [
            'code' => strtoupper(trim($data['code'])), 'name' => ($data['name'] ?? '') ?: 'Web till',
            'device_fingerprint' => 'web-till:'.Str::random(40),
        ]);
        if ($res['status'] !== 201) {
            return response()->json(['error' => $res['body']['error'] ?? 'pairing_failed', 'reason' => $res['body']['reason'] ?? null], $res['status']);
        }
        if ($res['body']['terminal']['kind'] !== 'terminal') {
            return response()->json(['error' => 'not_a_till_code'], 422);   // a kitchen code: wrong page
        }

        $request->session()->regenerate();
        $request->session()->put(self::S, ['token' => $res['body']['token']]);

        return response()->json(['ok' => true]);
    }

    public function login(Request $request)
    {
        $t = $this->deviceOrFail($request);
        $data = $request->validate(['staff_id' => ['required', 'uuid'], 'pin' => ['required', 'string', 'max:8']]);

        $res = TillApi::call('POST', 'auth/login', $data, $this->token($request));
        if ($res['status'] !== 201) {
            return response()->json($res['body'] + ['error' => 'sign_in_failed'], $res['status']);
        }
        // The offline credential in the response is ignored: a browser can't seal a verifier.
        $request->session()->put(self::S.'.staff_session', $res['body']['session_token']);
        $request->session()->put(self::S.'.staff', $res['body']['staff']);

        return response()->json(['staff' => $res['body']['staff']]);
    }

    public function logout(Request $request)
    {
        $this->deviceOrFail($request);
        TillApi::call('POST', 'auth/logout', [], $this->token($request), $request->session()->get(self::S.'.staff_session'));
        $request->session()->forget([self::S.'.staff_session', self::S.'.staff']);

        return response()->json(['ok' => true]);
    }

    /** Forget the device in this browser (it stays paired on the server; unpair it there). */
    public function forget(Request $request)
    {
        $request->session()->forget(self::S);

        return response()->json(['ok' => true]);
    }

    public function quote(Request $request)
    {
        $t = $this->deviceOrFail($request);
        $data = $this->cart($request);
        try {
            $q = TillSale::quote($t, $data['lines'], $data['tender']);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        return response()->json($this->summary($q));
    }

    public function checkout(Request $request)
    {
        $t = $this->deviceOrFail($request);
        $data = $this->cart($request) + $request->validate([
            'order_id' => ['required', 'uuid'],
            'tendered_sen' => ['nullable', 'integer', 'min:0'],
            'send_to_kitchen' => ['boolean'],
        ]);

        // the staff session must still be good (expired, revoked, staff deactivated)
        $me = TillApi::call('GET', 'auth/me', [], $this->token($request), $request->session()->get(self::S.'.staff_session'));
        if ($me['status'] !== 200) {
            $request->session()->forget([self::S.'.staff_session', self::S.'.staff']);
            return response()->json(['error' => 'staff_signed_out'], 401);
        }

        try {
            $q = TillSale::quote($t, $data['lines'], $data['tender']);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }
        $total = $q['priced']['total_sen'];
        $tendered = $data['tender'] === 'cash' ? (int) ($data['tendered_sen'] ?? $total) : $total;
        if ($tendered < $total) {
            return response()->json(['error' => 'not_enough_cash', 'total_sen' => $total], 422);
        }

        // one sale at a time per device, so two tabs can't take the same client_seq
        $lock = "web-till:{$t->id}";
        DB::selectOne('SELECT pg_advisory_lock(hashtextextended(?, 0))', [$lock]);
        try {
            $seq = TillSale::nextSeq($t);
            $payload = TillSale::orderCreate($t, $me['body']['staff']['id'], $data['order_id'], $q, $data['tender'], (bool) ($data['send_to_kitchen'] ?? false), $seq);
            $res = TillApi::call('POST', 'sync/push', ['mutations' => [[
                'id' => (string) Str::uuid7(), 'client_seq' => $seq, 'type' => 'order.create',
                'payload' => $payload, 'client_created_at' => $payload['order']['occurred_at'], 'auth' => ['mode' => 'online'],
            ]], 'outbox_pending' => 1], $this->token($request));
        } finally {
            DB::selectOne('SELECT pg_advisory_unlock(hashtextextended(?, 0))', [$lock]);
        }

        $result = $res['body']['results'][0] ?? null;
        if ($res['status'] !== 200 || ! in_array($result['status'] ?? null, ['applied', 'conflict'], true)) {
            return response()->json(['error' => 'sale_not_stored', 'detail' => $result ?? $res['body']], $res['status'] === 200 ? 422 : $res['status']);
        }

        return response()->json($this->summary($q) + [
            // a retried checkout (same order id) gets the receipt number the sale was stored with
            'receipt_no' => TillSale::receiptOf($t, $data['order_id']) ?? $payload['order']['receipt_no'],
            'order_id' => $data['order_id'],
            'tender' => $data['tender'],
            'tendered_sen' => $tendered,
            'change_sen' => $tendered - $total,
            'flags' => $result['result']['conflicts'] ?? [],
            'duplicate' => ($result['result']['note'] ?? null) === 'already_exists',
            'recent' => TillSale::recent($t),
        ]);
    }

    // ------------------------------------------------------------------ helpers

    private function cart(Request $request): array
    {
        return $request->validate([
            'lines' => ['required', 'array', 'min:1', 'max:'.TillSale::MAX_LINES],
            'lines.*.variant_id' => ['required', 'uuid'],
            'lines.*.qty_milli' => ['required', 'integer', 'min:1', 'max:1000000'],
            'tender' => ['sometimes', 'in:'.implode(',', TillSale::TENDERS)],
        ]) + ['tender' => 'cash'];
    }

    private function summary(array $q): array
    {
        $p = $q['priced'];

        return [
            'lines' => array_map(fn ($l, $pl) => ['variant_id' => $l['variant_id'], 'name' => $l['name'], 'qty_milli' => $l['qty_milli'],
                'unit_price_sen' => $l['price_sen'], 'net_sen' => $pl['net_sen']], $q['lines'], $p['lines']),
            'subtotal_sen' => $p['subtotal_sen'], 'discount_sen' => $p['discount_sen'], 'tax_sen' => $p['tax_sen'],
            'rounding_sen' => $p['rounding_sen'], 'total_sen' => $p['total_sen'], 'tax_breakdown' => $p['tax_breakdown'],
        ];
    }

    private function token(Request $request): ?string
    {
        return $request->session()->get(self::S.'.token');
    }

    /** The paired device behind this browser session, if its token is still valid. */
    private function device(Request $request): ?Terminal
    {
        $token = $this->token($request);
        $t = $token ? PersonalAccessToken::findToken($token)?->tokenable : null;
        if (! $t instanceof Terminal || $t->kind !== Terminal::KIND_TERMINAL || $t->status !== Terminal::ACTIVE) {
            if ($token) {
                $request->session()->forget(self::S);   // unpaired, revoked or re-paired elsewhere
            }
            return null;
        }

        return $t;
    }

    private function deviceOrFail(Request $request): Terminal
    {
        abort_unless(config('pos.web_till.enabled'), 404);

        return $this->device($request) ?? abort(response()->json(['error' => 'not_paired'], 409));
    }
}

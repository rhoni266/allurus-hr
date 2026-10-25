<?php

namespace App\Simulator;

use App\Billing\{PricingEngine, TimeBilling};
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * Reference implementation of the terminal's offline-first behaviour:
 *  - every sale writes order rows + an outbox row in ONE local transaction
 *  - push drains the outbox in client_seq order, idempotently, with backoff
 *  - pull applies catalogue changes and the new cursor in ONE local transaction
 */
final class Terminal
{
    public const BATCH = 50;

    public array $stats = ['sold' => 0, 'pushed_batches' => 0, 'transport_failures' => 0, 'retry_results' => 0, 'pulled_changes' => 0, 'resyncs' => 0];

    private string $staffId;

    public function __construct(
        private World $world,
        private array $me,            // ['id','name','token']
        public readonly LocalStore $store,
        public readonly SyncClient $client,
        private Chaos $chaos,
        private int $clockOffsetSeconds = 0,
    ) {
        // the cashier signed in by PIN when the device was paired (Scenarios::pairAll)
        $this->staffId = $world->staff['cashier']['id'] ?? $store->get('staff_id') ?? tap((string) Str::uuid7(), fn ($id) => $store->put('staff_id', $id));
    }

    public function now(): CarbonImmutable
    {
        return CarbonImmutable::now()->addSeconds($this->clockOffsetSeconds);
    }

    // ---------------------------------------------------------------- selling

    private const QTY_MILLI = [250, 500, 1000, 1000, 1000, 1500, 2000, 3000];   // includes weighed / half portions

    /**
     * Ring up $count random sales from the local catalogue. Works with no network.
     * Baskets mix fractional quantities, line discounts and order discounts so every
     * PricingEngine path goes through sync. $crashMidSale hard-exits inside the SQLite
     * transaction, to prove sales are atomic.
     */
    public function sell(int $count, bool $crashMidSale = false): array
    {
        $ids = [];
        for ($i = 0; $i < $count; $i++) {
            [$lines, $orderDiscount] = $this->randomBasket();
            $ids[] = $this->ringUp($lines, $orderDiscount, $crashMidSale);
        }

        return $ids;
    }

    /** @return array{0: list<array>, 1: ?array} lines and order discount */
    public function randomBasket(): array
    {
        // timed products are charged through sessions (endSession), not rung up as items
        $variants = $this->store->all(
            "SELECT v.id FROM variants v JOIN products p ON p.id = v.product_id WHERE v.deleted = 0 AND COALESCE(p.type, 'standard') <> 'service_timed'"
        ) ?: throw new \RuntimeException('Local catalogue empty: pull first.');

        $lines = [];
        foreach (range(1, $this->chaos->int(1, 3)) as $_) {
            $line = ['variant_id' => $this->chaos->pick($variants)['id'], 'qty_milli' => $this->chaos->pick(self::QTY_MILLI)];
            if ($this->chaos->int(1, 5) === 1) {
                $line['discount'] = $this->chaos->int(0, 1)
                    ? ['percent_bps' => $this->chaos->pick([500, 1000, 1500])]
                    : ['amount_sen' => $this->chaos->int(50, 300)];
            }
            $lines[] = $line;
        }
        $orderDiscount = $this->chaos->int(1, 6) === 1
            ? ($this->chaos->int(0, 1) ? ['percent_bps' => 1000] : ['amount_sen' => $this->chaos->int(100, 500)])
            : null;

        return [$lines, $orderDiscount];
    }

    /**
     * $count random stock adjustments over $variantIds: waste and transfers out (down),
     * transfers in (up), corrections either way. Mostly by the manager; 1 in 8 corrections
     * by the cashier, which the server flags as unauthorized_adjustment.
     */
    public function adjustRandomly(int $count, array $variantIds): void
    {
        for ($i = 0; $i < $count; $i++) {
            $reason = $this->chaos->pick(['waste', 'waste', 'adjust', 'adjust', 'transfer_in', 'transfer_out']);
            $size = $this->chaos->pick([250, 500, 1000, 2000, 5000]);
            $delta = match ($reason) { 'waste', 'transfer_out' => -$size, 'transfer_in' => $size, default => $this->chaos->int(0, 1) ? $size : -$size };
            $role = $reason === 'waste' || $this->chaos->int(1, 8) === 1 ? 'cashier' : 'manager';
            $this->adjustStock($this->chaos->pick($variantIds), $delta, $reason, $role);
        }
    }

    /**
     * Price a basket with PricingEngine (CLAUDE.md rule 7: pricing lives in one place) and
     * record it. Offline means cash, so the 5-sen cash rounding always applies (rule 9).
     *
     * $paidSen < total leaves an open tab (settled later with addPayment); null pays in full.
     * A line's unit_price_sen, when given, replaces the catalogue price (timed sessions).
     *
     * @param list<array{variant_id:string, qty_milli:int, discount?:array, unit_price_sen?:int}> $lines
     */
    public function ringUp(array $lines, ?array $orderDiscount = null, bool $crashMidSale = false, ?int $paidSen = null, ?string $orderId = null): string
    {
        $at = $this->now()->toIso8601ZuluString('microsecond');
        $orderId ??= (string) Str::uuid7();

        $catalogue = [];
        $input = ['tender' => 'cash', 'tax_rules' => $this->world->taxRules, 'lines' => []];
        foreach ($lines as $i => $line) {
            $catalogue[$i] = $this->lookup($line['variant_id']);
            if (isset($line['unit_price_sen'])) {
                $catalogue[$i]['price_sen'] = $line['unit_price_sen'];
            }
            $input['lines'][] = array_filter([
                'id' => (string) Str::uuid7(),
                'qty_milli' => $line['qty_milli'],
                'unit_price_sen' => $catalogue[$i]['price_sen'],
                'tax_code' => $catalogue[$i]['tax_code'],
                'discount' => $line['discount'] ?? null,
            ], fn ($v) => $v !== null);
        }
        if ($orderDiscount) {
            $input['order_discount'] = $orderDiscount;
        }
        if ($this->world->serviceCharge) {
            $input['service_charge'] = $this->world->serviceCharge;
        }

        $priced = PricingEngine::price($input);

        $paid = min($paidSen ?? $priced['total_sen'], $priced['total_sen']);
        $status = $paid >= $priced['total_sen'] ? 'paid' : 'open';

        return $this->store->transaction(function (\PDO $db) use ($input, $priced, $catalogue, $lines, $at, $orderId, $crashMidSale, $paid, $status) {
            $seq = (int) ($this->store->get('receipt_seq', '0')) + 1;
            $this->store->put('receipt_seq', (string) $seq);
            // outlet + terminal prefix: two terminals can never collide, even offline
            $receipt = sprintf('OUT1-%s-%06d', $this->me['name'], $seq);

            $items = [];
            foreach ($priced['lines'] as $i => $p) {
                $items[] = [
                    'id' => $p['id'], 'variant_id' => $lines[$i]['variant_id'], 'name' => $catalogue[$i]['name'],
                    'qty_milli' => $input['lines'][$i]['qty_milli'],
                    'unit_price_sen' => $catalogue[$i]['price_sen'],          // catalogue price, before discounts
                    'price_row_version' => $catalogue[$i]['row_version'],
                    'tax_code' => $catalogue[$i]['tax_code'],
                    'gross_sen' => $p['gross_sen'], 'discount_sen' => $p['line_discount_sen'] + $p['order_discount_sen'], 'net_sen' => $p['net_sen'],
                ];
            }

            $order = [
                'id' => $orderId, 'receipt_no' => $receipt, 'status' => $status, 'channel' => 'pos',
                'staff_id' => $this->staffId, 'subtotal_sen' => $priced['subtotal_sen'], 'discount_sen' => $priced['discount_sen'],
                'service_charge_sen' => $priced['service_charge_sen'], 'tax_sen' => $priced['tax_sen'],
                'rounding_sen' => $priced['rounding_sen'], 'total_sen' => $priced['total_sen'],
                'tax_breakdown' => $priced['tax_breakdown'], 'pricing_spec_version' => $priced['spec_version'],
                'created_offline' => true, 'occurred_at' => $at,
            ];
            $total = $priced['total_sen'];

            $db->prepare('INSERT INTO orders (id, receipt_no, total_sen, status, occurred_at) VALUES (?, ?, ?, ?, ?)')
                ->execute([$orderId, $receipt, $total, $status, $at]);
            $payments = $paid > 0 ? [['id' => (string) Str::uuid7(), 'method' => 'cash', 'amount_sen' => $paid, 'occurred_at' => $at]] : [];
            foreach ($payments as $pay) {
                $db->prepare('INSERT INTO payments (id, order_id, method, amount_sen) VALUES (?, ?, ?, ?)')
                    ->execute([$pay['id'], $orderId, 'cash', $pay['amount_sen']]);
            }
            foreach ($items as $it) {
                $db->prepare('INSERT INTO order_items (id, order_id, variant_id, qty_milli, unit_price_sen, net_sen) VALUES (?, ?, ?, ?, ?, ?)')
                    ->execute([$it['id'], $orderId, $it['variant_id'], $it['qty_milli'], $it['unit_price_sen'], $it['net_sen']]);
            }

            if ($crashMidSale) {
                exit(137);   // simulated kill -9: SQLite must roll the whole sale back
            }

            $payload = [
                'order' => $order,
                'items' => $items,
                'payments' => $payments,
            ];
            $this->enqueue($db, 'order.create', $payload, $at);

            $this->stats['sold']++;

            return $orderId;
        });
    }

    // ---------------------------------------------------------------- corrections & other mutations
    // Each writes its local fact and its outbox row in ONE SQLite transaction, like a sale.

    /** order.void. $orderId may be another terminal's order (looked up online, voided here). */
    public function voidOrder(string $orderId, string $role = 'manager', ?string $voidId = null): string
    {
        $voidId ??= (string) Str::uuid7();
        $at = $this->now()->toIso8601ZuluString('microsecond');

        $this->store->transaction(function (\PDO $db) use ($orderId, $role, $voidId, $at) {
            $db->prepare('INSERT INTO voids (id, order_id, staff_role) VALUES (?, ?, ?)')->execute([$voidId, $orderId, $role]);
            $db->prepare("UPDATE orders SET status = 'void' WHERE id = ?")->execute([$orderId]);
            $this->enqueue($db, 'order.void', ['void_id' => $voidId, 'order_id' => $orderId, 'staff_id' => $this->staffIdFor($role),
                'reason' => 'sim', 'occurred_at' => $at], $at);
        });
        $this->stats['voids'] = ($this->stats['voids'] ?? 0) + 1;

        return $voidId;
    }

    /** payment.add: cash towards an open tab (offline = cash only). */
    public function addPayment(string $orderId, int $amountSen): string
    {
        $id = (string) Str::uuid7();
        $at = $this->now()->toIso8601ZuluString('microsecond');

        $this->store->transaction(function (\PDO $db) use ($orderId, $amountSen, $id, $at) {
            $db->prepare('INSERT INTO payments (id, order_id, method, amount_sen) VALUES (?, ?, ?, ?)')->execute([$id, $orderId, 'cash', $amountSen]);
            $paid = (int) $this->store->scalar('SELECT SUM(amount_sen) FROM payments WHERE order_id = ?', [$orderId]);
            $db->prepare("UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'open' AND total_sen <= ?")->execute([$orderId, $paid]);
            $this->enqueue($db, 'payment.add', ['payment_id' => $id, 'order_id' => $orderId, 'method' => 'cash',
                'amount_sen' => $amountSen, 'staff_id' => $this->staffIdFor('cashier'), 'occurred_at' => $at], $at);
        });

        return $id;
    }

    /** stock.adjust: a signed milli-unit delta, never a count. */
    public function adjustStock(string $variantId, int $deltaMilli, string $reason, string $role = 'manager'): string
    {
        $id = (string) Str::uuid7();
        $at = $this->now()->toIso8601ZuluString('microsecond');

        $this->store->transaction(function (\PDO $db) use ($variantId, $deltaMilli, $reason, $role, $id, $at) {
            $db->prepare('INSERT INTO adjustments (id, variant_id, delta_milli, reason, staff_role) VALUES (?, ?, ?, ?, ?)')
                ->execute([$id, $variantId, $deltaMilli, $reason, $role]);
            $this->enqueue($db, 'stock.adjust', ['adjustment_id' => $id, 'variant_id' => $variantId, 'delta_milli' => $deltaMilli,
                'reason' => $reason, 'staff_id' => $this->staffIdFor($role), 'occurred_at' => $at], $at);
        });

        return $id;
    }

    /**
     * End a timed session that ran for $elapsed seconds (ending now on the device clock):
     * charge it with TimeBilling from the rate frozen at start, push session.end, and ring
     * the charge up as an order line. $tamperSen simulates a terminal that charged wrongly.
     */
    public function endSession(string $variantId, int $elapsedSeconds, int $pausedSeconds = 0, int $tamperSen = 0): string
    {
        $rate = json_decode((string) $this->store->scalar(
            'SELECT p.time_billing FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?', [$variantId]), true)
            ?? throw new \RuntimeException("variant {$variantId} is not a timed product");
        $charge = TimeBilling::charge($rate, $elapsedSeconds, $pausedSeconds);
        $amount = $charge['amount_sen'] + $tamperSen;

        $end = $this->now()->startOfSecond();
        $sessionId = (string) Str::uuid7();
        $orderId = (string) Str::uuid7();

        $this->store->transaction(function (\PDO $db) use ($variantId, $rate, $charge, $amount, $end, $elapsedSeconds, $pausedSeconds, $sessionId, $orderId, $tamperSen) {
            $db->prepare('INSERT INTO sessions (id, order_id, amount_sen, billed_minutes, tampered) VALUES (?, ?, ?, ?, ?)')
                ->execute([$sessionId, $orderId, $amount, $charge['billed_minutes'], $tamperSen !== 0 ? 1 : 0]);
            $this->enqueue($db, 'session.end', [
                'session_id' => $sessionId, 'resource_id' => $variantId, 'variant_id' => $variantId, 'order_id' => $orderId,
                'staff_id' => $this->staffIdFor('cashier'),
                'started_at' => $end->subSeconds($elapsedSeconds)->toIso8601ZuluString(), 'ended_at' => $end->toIso8601ZuluString(),
                'paused_seconds' => $pausedSeconds, 'rate_snapshot' => $rate,
                'billed_minutes' => $charge['billed_minutes'], 'amount_sen' => $amount, 'spec_version' => TimeBilling::SPEC_VERSION,
            ], $end->toIso8601ZuluString('microsecond'));
        });

        // charged as one line priced at the session amount (service charge and tax apply as usual)
        $this->ringUp([['variant_id' => $variantId, 'qty_milli' => 1000, 'unit_price_sen' => $amount]], orderId: $orderId);

        return $sessionId;
    }

    private function enqueue(\PDO $db, string $type, array $payload, string $at): void
    {
        $db->prepare('INSERT INTO outbox (id, type, payload, created_at, auth) VALUES (?, ?, ?, ?, ?)')
            ->execute([(string) Str::uuid7(), $type, json_encode($payload), $at, json_encode($this->auth)]);
    }

    // ---------------------------------------------------------------- offline sign-in

    /** How the current actions are authorised; attached to every outbox row. */
    private array $auth = ['mode' => 'online'];

    /**
     * Sign $role in with no network, using the offline credential issued at the last online
     * sign-in on this device (option C). Refused if the device has learned, through pull,
     * that the credential was revoked or has expired. A device that hasn't synced since a
     * revocation still lets the person in; the server flags it afterwards.
     */
    public function signInOffline(string $role): bool
    {
        $id = $this->me['credentials'][$role] ?? null;
        $row = $id ? ($this->store->all('SELECT revoked_at, expires_at FROM credentials WHERE id = ?', [$id])[0] ?? null) : null;
        if (! $id || ($row && ($row['revoked_at'] !== null || CarbonImmutable::parse($row['expires_at'])->lt($this->now())))) {
            return false;
        }

        $this->auth = ['mode' => 'offline', 'credential_id' => $id, 'signed_in_at' => $this->now()->toIso8601ZuluString('microsecond')];
        $this->staffId = $this->world->staff[$role]['id'];

        return true;
    }

    public function signInOnline(string $role): void
    {
        $this->auth = ['mode' => 'online'];
        $this->staffId = $this->world->staff[$role]['id'];
    }

    private function staffIdFor(string $role): string
    {
        return $this->world->staff[$role]['id'] ?? $this->staffId;
    }

    /**
     * Catalogue facts for one variant. Price follows the local twin of PriceResolver:
     * outlet override > region override > base.
     */
    private function lookup(string $variantId): array
    {
        $v = $this->store->all(
            'SELECT v.base_price_sen, v.row_version, p.name, p.tax_code FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?',
            [$variantId],
        )[0];
        $overrides = $this->store->all('SELECT scope, scope_key, price_sen FROM price_overrides WHERE variant_id = ?', [$variantId]);

        $pick = fn (string $scope, string $key) => collect($overrides)->first(fn ($o) => $o['scope'] === $scope && $o['scope_key'] === $key);
        $o = $pick('outlet', $this->world->outletId) ?? $pick('region', $this->world->region);

        return [
            'price_sen' => (int) ($o['price_sen'] ?? $v['base_price_sen']),
            'row_version' => (int) $v['row_version'],
            'name' => $v['name'],
            'tax_code' => $v['tax_code'],
        ];
    }

    // ---------------------------------------------------------------- sync

    /** Push until the outbox is drained, then pull to head. Gives up after $maxRounds failures. */
    /** active | retiring | revoked | wiped, as last learned from the server */
    public string $deviceState = 'active';

    /**
     * Push until the outbox is drained, then pull to head. Gives up after $maxRounds failures.
     *
     * If the server says this device was taken out of service, behave as the real app must:
     *  - revoked with wipe: erase the local database, confirm the wipe, stop;
     *  - revoked without wipe: stop;
     *  - retiring: push is still allowed for the backlog; once the outbox is empty, tell
     *    the server we're done (devices/retired) and stop.
     */
    public function sync(int $maxRounds = 500): bool
    {
        try {
            return $this->drain($maxRounds) && $this->pull($maxRounds);
        } catch (DeviceRevoked $e) {
            return $this->onRevoked($e);
        }
    }

    private function onRevoked(DeviceRevoked $e): bool
    {
        if ($e->reason === 'device_retiring') {
            $this->deviceState = 'retiring';
            if ($this->pendingCount() === 0 && $this->client->lifecycle('devices/retired') === 200) {
                $this->deviceState = 'revoked';
            }
            return false;
        }

        $this->deviceState = 'revoked';
        if ($e->wipe) {
            $this->store->wipe();
            if ($this->client->lifecycle('devices/wipe-confirm') === 204) {
                $this->deviceState = 'wiped';
            }
        }

        return false;
    }

    public function pendingCount(): int
    {
        return (int) $this->store->scalar("SELECT COUNT(*) FROM outbox WHERE status IN ('pending', 'sent')");
    }

    /**
     * Push until the outbox is drained. A round that acks nothing (network down, or only
     * mutations still waiting for another terminal's order) counts as a failure; after
     * $maxRounds such rounds in a row it gives up and returns false.
     */
    public function drain(int $maxRounds = 500): bool
    {
        $failures = 0;
        while ($this->pendingCount() > 0) {
            if ($failures >= $maxRounds) {
                return false;
            }
            try {
                $acked = $this->pushOnce();
            } catch (TransportFailure) {
                $this->stats['transport_failures']++;
                $acked = 0;
            }
            $failures = $acked > 0 ? 0 : $failures + 1;
            if ($acked === 0) {
                $this->backoff($failures);
            }
        }

        return true;
    }

    /**
     * One batch, oldest first. 'sent' rows are resent as-is: the server dedupes by
     * (terminal, client_seq). Rows the server told to wait (retry) sit out until
     * not_before, so later mutations aren't stuck behind them (no head-of-line blocking).
     *
     * @return int rows acked or rejected (i.e. settled) this round
     */
    public function pushOnce(): int
    {
        $now = (int) (microtime(true) * 1000);
        $rows = $this->store->all(
            "SELECT * FROM outbox WHERE status IN ('pending', 'sent') AND (not_before IS NULL OR not_before <= ?) ORDER BY client_seq LIMIT ".self::BATCH,
            [$now],
        );
        if (! $rows) {
            return 0;
        }

        $ids = array_column($rows, 'client_seq');
        $in = implode(',', array_map('intval', $ids));
        $this->store->db->exec("UPDATE outbox SET status = 'sent', attempts = attempts + 1 WHERE client_seq IN ({$in})");

        $results = $this->client->push(array_map(fn ($r) => array_filter([
            'id' => $r['id'], 'client_seq' => (int) $r['client_seq'], 'type' => $r['type'],
            'payload' => json_decode($r['payload'], true), 'client_created_at' => $r['created_at'],
            'auth' => $r['auth'] ? json_decode($r['auth'], true) : null,
        ], fn ($v) => $v !== null), $rows), $this->pendingCount());
        $this->stats['pushed_batches']++;

        if ($this->chaos->crashAfterPushes !== null && $this->client->pushResponses >= $this->chaos->crashAfterPushes) {
            exit(137);   // server applied the batch; we die before recording the acks
        }

        $attempts = array_column($rows, 'attempts', 'client_seq');

        return $this->store->transaction(function (\PDO $db) use ($results, $attempts, $now) {
            $st = $db->prepare('UPDATE outbox SET status = ?, result = ?, not_before = ? WHERE client_seq = ? AND id = ?');
            $settled = 0;
            foreach ($results as $r) {
                $local = match ($r['status']) {
                    'applied', 'conflict' => 'acked',
                    'rejected'            => 'rejected',   // held for manager review; never blocks the rest
                    default               => 'pending',    // 'retry'
                };
                $notBefore = null;
                if ($local === 'pending') {
                    $this->stats['retry_results']++;
                    // back off this row only (sim-fast: 50 ms doubling, capped at ~3 s)
                    $notBefore = $now + 50 * (2 ** min((int) ($attempts[$r['client_seq']] ?? 1), 6));
                } else {
                    $settled++;
                }
                $st->execute([$local, json_encode($r['result']), $notBefore, $r['client_seq'], $r['id']]);
            }

            return $settled;
        });
    }

    public function pull(int $maxRounds = 500): bool
    {
        $failures = 0;
        do {
            try {
                $page = $this->client->pull((int) $this->store->get('pull_cursor', '0'));
            } catch (TransportFailure) {
                $this->stats['transport_failures']++;
                if (++$failures >= $maxRounds) {
                    return false;
                }
                $this->backoff($failures);
                $page = ['has_more' => true];
                continue;
            }

            if (! empty($page['full_resync_required'])) {
                $this->resetCatalogue();
                $page['has_more'] = true;
                continue;
            }

            $this->applyChanges($page['changes'], (int) $page['next_cursor']);
        } while ($page['has_more']);

        return true;
    }

    private function applyChanges(array $changes, int $nextCursor): void
    {
        $this->store->transaction(function (\PDO $db) use ($changes, $nextCursor) {
            foreach ($changes as $c) {
                $d = $c['data'];
                match ([$c['entity'], $c['op']]) {
                    ['product', 'upsert'] => $db->prepare('INSERT OR REPLACE INTO products (id, name, type, tax_code, track_stock, time_billing, row_version, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
                        ->execute([$d['id'], $d['name'], $d['type'], $d['tax_code'], (int) $d['track_stock'],
                            $d['time_billing'] === null ? null : json_encode($d['time_billing']), $d['row_version']]),
                    ['variant', 'upsert'] => $db->prepare('INSERT OR REPLACE INTO variants (id, product_id, sku, base_price_sen, row_version, deleted) VALUES (?, ?, ?, ?, ?, 0)')
                        ->execute([$d['id'], $d['product_id'], $d['sku'], $d['base_price_sen'], $d['row_version']]),
                    ['price_override', 'upsert'] => $db->prepare('INSERT OR REPLACE INTO price_overrides (id, variant_id, scope, scope_key, price_sen, row_version) VALUES (?, ?, ?, ?, ?, ?)')
                        ->execute([$d['id'], $d['variant_id'], $d['scope'], $d['scope_key'], $d['price_sen'], $d['row_version']]),
                    ['modifier', 'upsert'] => $db->prepare('INSERT OR REPLACE INTO modifiers (id, data) VALUES (?, ?)')
                        ->execute([$d['id'], json_encode($d)]),
                    // tombstones
                    ['product', 'delete'] => $db->prepare('UPDATE products SET deleted = 1 WHERE id = ?')->execute([$c['id']]),
                    ['variant', 'delete'] => $db->prepare('UPDATE variants SET deleted = 1 WHERE id = ?')->execute([$c['id']]),
                    ['price_override', 'delete'] => $db->prepare('DELETE FROM price_overrides WHERE id = ?')->execute([$c['id']]),
                    ['modifier', 'delete'] => $db->prepare('DELETE FROM modifiers WHERE id = ?')->execute([$c['id']]),
                    ['staff_credential', 'upsert'] => $db->prepare('INSERT OR REPLACE INTO credentials (id, staff_id, expires_at, revoked_at) VALUES (?, ?, ?, ?)')
                        ->execute([$d['id'], $d['staff_id'], $d['expires_at'], $d['revoked_at']]),
                    default => null,
                };
                $this->stats['pulled_changes']++;
            }
            // cursor moves in the same transaction as the data it covers
            $this->store->put('pull_cursor', (string) $nextCursor);
        });
    }

    private function resetCatalogue(): void
    {
        $this->stats['resyncs']++;
        $this->store->transaction(function (\PDO $db) {
            foreach (['products', 'variants', 'price_overrides', 'modifiers'] as $t) {
                $db->exec("DELETE FROM {$t}");
            }
            $this->store->put('pull_cursor', '0');
        });
    }

    private function backoff(int $failures): void
    {
        // exponential with full jitter; kept tiny so the simulation runs fast
        $capMs = min(400, 10 * (2 ** min($failures, 6)));
        usleep($this->chaos->int(0, $capMs) * 1000);
    }
}

<?php

namespace App\Simulator;

use App\Billing\PricingEngine;
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
        $this->staffId = $store->get('staff_id') ?? tap((string) Str::uuid7(), fn ($id) => $store->put('staff_id', $id));
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
    public function sell(int $count, bool $crashMidSale = false): void
    {
        $variants = $this->store->all('SELECT id FROM variants WHERE deleted = 0');
        if (! $variants) {
            throw new \RuntimeException('Local catalogue empty: pull first.');
        }

        for ($i = 0; $i < $count; $i++) {
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

            $this->ringUp($lines, $orderDiscount, $crashMidSale);
        }
    }

    /**
     * Price a basket with PricingEngine (CLAUDE.md rule 7: pricing lives in one place) and
     * record it. Offline means cash, so the 5-sen cash rounding always applies (rule 9).
     *
     * @param list<array{variant_id:string, qty_milli:int, discount?:array}> $lines
     */
    public function ringUp(array $lines, ?array $orderDiscount = null, bool $crashMidSale = false): string
    {
        $at = $this->now()->toIso8601ZuluString('microsecond');
        $orderId = (string) Str::uuid7();

        $catalogue = [];
        $input = ['tender' => 'cash', 'tax_rules' => $this->world->taxRules, 'lines' => []];
        foreach ($lines as $i => $line) {
            $catalogue[$i] = $this->lookup($line['variant_id']);
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

        return $this->store->transaction(function (\PDO $db) use ($input, $priced, $catalogue, $lines, $at, $orderId, $crashMidSale) {
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
                'id' => $orderId, 'receipt_no' => $receipt, 'status' => 'paid', 'channel' => 'pos',
                'staff_id' => $this->staffId, 'subtotal_sen' => $priced['subtotal_sen'], 'discount_sen' => $priced['discount_sen'],
                'service_charge_sen' => $priced['service_charge_sen'], 'tax_sen' => $priced['tax_sen'],
                'rounding_sen' => $priced['rounding_sen'], 'total_sen' => $priced['total_sen'],
                'tax_breakdown' => $priced['tax_breakdown'], 'pricing_spec_version' => $priced['spec_version'],
                'created_offline' => true, 'occurred_at' => $at,
            ];
            $total = $priced['total_sen'];

            $db->prepare('INSERT INTO orders (id, receipt_no, total_sen, occurred_at) VALUES (?, ?, ?, ?)')
                ->execute([$orderId, $receipt, $total, $at]);
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
                'payments' => [['id' => (string) Str::uuid7(), 'method' => 'cash', 'amount_sen' => $total, 'occurred_at' => $at]],
            ];
            $db->prepare('INSERT INTO outbox (id, type, payload, created_at) VALUES (?, ?, ?, ?)')
                ->execute([(string) Str::uuid7(), 'order.create', json_encode($payload), $at]);

            $this->stats['sold']++;

            return $orderId;
        });
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
    public function sync(int $maxRounds = 500): bool
    {
        return $this->drain($maxRounds) && $this->pull($maxRounds);
    }

    public function pendingCount(): int
    {
        return (int) $this->store->scalar("SELECT COUNT(*) FROM outbox WHERE status IN ('pending', 'sent')");
    }

    public function drain(int $maxRounds = 500): bool
    {
        $failures = 0;
        while ($this->pendingCount() > 0) {
            if ($failures >= $maxRounds) {
                return false;
            }
            try {
                $this->pushOnce();
                $failures = 0;
            } catch (TransportFailure) {
                $this->stats['transport_failures']++;
                $failures++;
                $this->backoff($failures);
            }
        }

        return true;
    }

    /** One batch. 'sent' rows are resent as-is: the server dedupes by (terminal, client_seq). */
    public function pushOnce(): void
    {
        $rows = $this->store->all(
            "SELECT * FROM outbox WHERE status IN ('pending', 'sent') ORDER BY client_seq LIMIT ".self::BATCH
        );
        if (! $rows) {
            return;
        }

        $ids = array_column($rows, 'client_seq');
        $in = implode(',', array_map('intval', $ids));
        $this->store->db->exec("UPDATE outbox SET status = 'sent', attempts = attempts + 1 WHERE client_seq IN ({$in})");

        $results = $this->client->push(array_map(fn ($r) => [
            'id' => $r['id'], 'client_seq' => (int) $r['client_seq'], 'type' => $r['type'],
            'payload' => json_decode($r['payload'], true), 'client_created_at' => $r['created_at'],
        ], $rows));
        $this->stats['pushed_batches']++;

        if ($this->chaos->crashAfterPushes !== null && $this->client->pushResponses >= $this->chaos->crashAfterPushes) {
            exit(137);   // server applied the batch; we die before recording the acks
        }

        $this->store->transaction(function (\PDO $db) use ($results) {
            $st = $db->prepare('UPDATE outbox SET status = ?, result = ? WHERE client_seq = ? AND id = ?');
            foreach ($results as $r) {
                $local = match ($r['status']) {
                    'applied', 'conflict' => 'acked',
                    'rejected'            => 'rejected',   // held for manager review; never blocks the rest
                    default               => 'pending',    // 'retry'
                };
                if ($local === 'pending') {
                    $this->stats['retry_results']++;
                }
                $st->execute([$local, json_encode($r['result']), $r['client_seq'], $r['id']]);
            }
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
                    ['product', 'upsert'] => $db->prepare('INSERT OR REPLACE INTO products (id, name, tax_code, track_stock, row_version, deleted) VALUES (?, ?, ?, ?, ?, 0)')
                        ->execute([$d['id'], $d['name'], $d['tax_code'], (int) $d['track_stock'], $d['row_version']]),
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

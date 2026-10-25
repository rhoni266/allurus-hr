<?php

namespace App\Billing;

/**
 * The one place an order is priced. Implements spec/pricing/SPEC.md and must pass every
 * case in spec/pricing/vectors.json; the terminal's port must pass the same vectors.
 *
 * Integer-only: money in sen, quantity in qty_milli. Framework-free on purpose, so
 * spec/pricing/run.php can execute it without booting Laravel.
 */
final class PricingEngine
{
    public const SPEC_VERSION = 2;   // v2: refunds

    /** @return array<string, mixed> see SPEC.md "Algorithm" for every field */
    public static function price(array $in): array
    {
        $lines = $in['lines'] ?? [];
        if (! is_array($lines) || $lines === []) {
            throw new PricingException('no_lines');
        }
        $rules = $in['tax_rules'] ?? [];

        // 1-3: gross and line discount
        $out = [];
        foreach (array_values($lines) as $i => $l) {
            $qty = self::int($l['qty_milli'] ?? null, 'invalid_qty', "line {$i}");
            if ($qty <= 0) {
                throw new PricingException('invalid_qty', "line {$i}");
            }
            $code = $l['tax_code'] ?? null;
            if (! is_string($code) || ! isset($rules[$code])) {
                throw new PricingException('unknown_tax_code', "line {$i}: ".var_export($code, true));
            }

            $unit = self::int($l['unit_price_sen'] ?? null, 'negative_unit_price', "line {$i}");
            foreach ($l['modifiers'] ?? [] as $m) {
                $unit += self::int($m['price_delta_sen'] ?? 0, 'negative_unit_price', "line {$i} modifier");
            }
            if ($unit < 0) {
                throw new PricingException('negative_unit_price', "line {$i}");
            }

            $gross = self::divHalfUp($qty * $unit, 1000);
            $lineDiscount = isset($l['discount']) ? self::discount($l['discount'], $gross, "line {$i}") : 0;

            $out[] = [
                'id' => $l['id'] ?? (string) $i,
                'tax_code' => $code,
                'gross_sen' => $gross,
                'line_discount_sen' => $lineDiscount,
                'order_discount_sen' => 0,
                'net_sen' => $gross - $lineDiscount,
            ];
        }

        // 4: order discount, allocated by largest remainder so per-line tax bases sum exactly
        $netSum = array_sum(array_column($out, 'net_sen'));
        $orderDiscount = isset($in['order_discount']) ? self::discount($in['order_discount'], $netSum, 'order') : 0;
        if ($orderDiscount > 0) {
            foreach (self::allocate($orderDiscount, array_column($out, 'net_sen')) as $i => $share) {
                $out[$i]['order_discount_sen'] = $share;
                $out[$i]['net_sen'] -= $share;
            }
        }
        $net = $netSum - $orderDiscount;

        // 5: service charge on the discounted subtotal
        $serviceCharge = 0;
        $scCode = null;
        if (isset($in['service_charge'])) {
            $sc = $in['service_charge'];
            $bps = self::int($sc['rate_bps'] ?? null, 'invalid_service_charge', 'rate_bps');
            $scCode = $sc['tax_code'] ?? null;
            if ($bps < 0 || $bps > 10000 || ($scCode !== null && ! isset($rules[$scCode]))) {
                throw new PricingException('invalid_service_charge');
            }
            $serviceCharge = self::divHalfUp($net * $bps, 10000);
        }

        // 6: tax once per code on the aggregated base
        $bases = [];
        foreach ($out as $l) {
            $bases[$l['tax_code']] = ($bases[$l['tax_code']] ?? 0) + $l['net_sen'];
        }
        if ($scCode !== null && $serviceCharge > 0) {
            $bases[$scCode] = ($bases[$scCode] ?? 0) + $serviceCharge;
        }
        ksort($bases, SORT_STRING);

        $breakdown = [];
        foreach ($bases as $code => $base) {
            $rate = self::int($rules[$code]['rate_bps'] ?? null, 'unknown_tax_code', $code);
            $breakdown[] = [
                'code' => $code,
                'rate_bps' => $rate,
                'rule_version' => self::int($rules[$code]['version'] ?? null, 'unknown_tax_code', $code),
                'base_sen' => $base,
                'amount_sen' => self::divHalfUp($base * $rate, 10000),
            ];
        }
        $tax = array_sum(array_column($breakdown, 'amount_sen'));

        // 7-8: totals and Malaysian 5-sen cash rounding
        $subtotal = array_sum(array_column($out, 'gross_sen'));
        $discount = array_sum(array_column($out, 'line_discount_sen')) + $orderDiscount;
        $preRound = $subtotal - $discount + $serviceCharge + $tax;
        $total = ($in['tender'] ?? null) === 'cash' ? intdiv($preRound + 2, 5) * 5 : $preRound;

        return [
            'spec_version' => self::SPEC_VERSION,
            'lines' => array_map(fn ($l) => array_diff_key($l, ['tax_code' => 1]), $out),
            'subtotal_sen' => $subtotal,
            'discount_sen' => $discount,
            'service_charge_sen' => $serviceCharge,
            'tax_breakdown' => $breakdown,
            'tax_sen' => $tax,
            'rounding_sen' => $total - $preRound,
            'total_sen' => $total,
        ];
    }

    /**
     * Refund part of a priced sale (SPEC.md "Refunds"). Cumulative, so any sequence of
     * partial refunds adds up to exactly what was paid.
     *
     * @param array $original the sale: tender, total_sen, service_charge_sen, service_charge_tax_code, lines, tax_breakdown
     * @param array<string,int> $alreadyRefunded line id => qty_milli refunded before
     * @param array<string,int> $refund line id => qty_milli to refund now
     */
    public static function refund(array $original, array $alreadyRefunded, array $refund): array
    {
        $lines = array_column($original['lines'], null, 'id');

        foreach ($refund as $id => $q) {
            if (! isset($lines[$id])) {
                throw new PricingException('unknown_line', (string) $id);
            }
            if (! is_int($q) || $q <= 0) {
                throw new PricingException('invalid_qty', (string) $id);
            }
        }
        $after = $alreadyRefunded;
        foreach ($refund as $id => $q) {
            $after[$id] = ($after[$id] ?? 0) + $q;
            if ($after[$id] > $lines[$id]['qty_milli']) {
                throw new PricingException('over_refund', (string) $id);
            }
        }

        $before = self::refundedAmount($original, $alreadyRefunded);
        $now = self::refundedAmount($original, $after);

        $tax = [];
        foreach ($now['tax'] as $code => $t) {
            $tax[] = ['code' => $code, 'rate_bps' => $t['rate_bps'], 'rule_version' => $t['rule_version'],
                'amount_sen' => $t['amount_sen'] - $before['tax'][$code]['amount_sen']];
        }
        $out = [];
        foreach ($refund as $id => $q) {
            $out[] = ['id' => (string) $id, 'qty_milli' => $q, 'net_sen' => $now['lines'][$id] - ($before['lines'][$id] ?? 0)];
        }

        $refundSen = $now['total'] - $before['total'];
        $net = $now['net'] - $before['net'];
        $sc = $now['sc'] - $before['sc'];

        return [
            'spec_version' => self::SPEC_VERSION,
            'refund_sen' => $refundSen,
            'net_sen' => $net,
            'service_charge_sen' => $sc,
            'tax_breakdown' => $tax,
            'rounding_sen' => $refundSen - $net - $sc - array_sum(array_column($tax, 'amount_sen')),
            'lines' => $out,
        ];
    }

    /** F(q) of the refund spec: the amount for having refunded quantities $q. */
    private static function refundedAmount(array $o, array $q): array
    {
        $full = true;
        foreach ($o['lines'] as $l) {
            $full = $full && ($q[$l['id']] ?? 0) === $l['qty_milli'];
        }

        $lines = [];
        foreach ($o['lines'] as $l) {
            $lines[$l['id']] = $full ? $l['net_sen'] : self::divHalfUp($l['net_sen'] * ($q[$l['id']] ?? 0), $l['qty_milli']);
        }
        $net = array_sum($lines);
        $netTotal = array_sum(array_column($o['lines'], 'net_sen'));
        $sc = $full ? $o['service_charge_sen'] : ($netTotal > 0 ? self::divHalfUp($o['service_charge_sen'] * $net, $netTotal) : 0);

        $tax = [];
        foreach ($o['tax_breakdown'] as $t) {
            $base = 0;
            foreach ($o['lines'] as $l) {
                $base += $l['tax_code'] === $t['code'] ? $lines[$l['id']] : 0;
            }
            $base += ($o['service_charge_tax_code'] ?? null) === $t['code'] ? $sc : 0;
            $amount = $full ? $t['amount_sen'] : ($t['base_sen'] > 0 ? self::divHalfUp($t['amount_sen'] * $base, $t['base_sen']) : 0);
            $tax[$t['code']] = ['rate_bps' => $t['rate_bps'], 'rule_version' => $t['rule_version'], 'amount_sen' => $amount];
        }

        $pre = $net + $sc + array_sum(array_column($tax, 'amount_sen'));
        $total = $full ? $o['total_sen'] : (($o['tender'] ?? null) === 'cash' ? intdiv($pre + 2, 5) * 5 : $pre);

        return ['lines' => $lines, 'net' => $net, 'sc' => $sc, 'tax' => $tax, 'total' => $total];
    }

    /** Round half up for n >= 0, d > 0, without floats. */
    public static function divHalfUp(int $n, int $d): int
    {
        return intdiv(2 * $n + $d, 2 * $d);
    }

    private static function discount(mixed $d, int $base, string $where): int
    {
        $hasPct = is_array($d) && array_key_exists('percent_bps', $d);
        $hasAmt = is_array($d) && array_key_exists('amount_sen', $d);
        if ($hasPct === $hasAmt) {
            throw new PricingException('invalid_discount', "{$where}: exactly one of percent_bps, amount_sen");
        }

        if ($hasPct) {
            $bps = self::int($d['percent_bps'], 'invalid_discount', $where);
            if ($bps < 0 || $bps > 10000) {
                throw new PricingException('invalid_discount', "{$where}: percent_bps out of range");
            }
            return self::divHalfUp($base * $bps, 10000);
        }

        $amount = self::int($d['amount_sen'], 'invalid_discount', $where);
        if ($amount < 0) {
            throw new PricingException('invalid_discount', "{$where}: negative amount");
        }
        return min($amount, $base);
    }

    /**
     * Split $total across $weights proportionally: floors first, then one sen each to the
     * largest remainders, ties to the lower index. Shares always sum to $total.
     *
     * @param list<int> $weights
     * @return list<int>
     */
    private static function allocate(int $total, array $weights): array
    {
        $sum = array_sum($weights);
        if ($sum <= 0) {
            return array_fill(0, count($weights), 0);
        }

        $shares = [];
        $remainders = [];
        foreach ($weights as $i => $w) {
            $shares[$i] = intdiv($total * $w, $sum);
            $remainders[$i] = ($total * $w) % $sum;
        }

        $order = array_keys($weights);
        usort($order, fn ($a, $b) => [$remainders[$b], $a] <=> [$remainders[$a], $b]);
        for ($k = 0, $left = $total - array_sum($shares); $k < $left; $k++) {
            $shares[$order[$k]]++;
        }

        return $shares;
    }

    private static function int(mixed $v, string $reason, string $where): int
    {
        if (! is_int($v)) {
            throw new PricingException($reason, "{$where}: expected integer, got ".get_debug_type($v));
        }
        return $v;
    }
}

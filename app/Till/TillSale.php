<?php

namespace App\Till;

use App\Billing\{PricingEngine, PricingException};
use App\Models\{Outlet, ProductVariant, Staff, TaxRule, Terminal};
use App\Pricing\PriceResolver;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * What the web till's "device" knows and does: its catalogue, pricing a cart with
 * PricingEngine (never the browser's numbers), and building the order.create mutation the
 * same way the simulator terminal does. Reads run with the terminal's tenant entered and
 * left again, never across a TillApi call (ResolveTenant clears the context on its way out).
 */
final class TillSale
{
    public const TENDERS = ['cash', 'card'];
    public const MAX_LINES = 50;

    /** @return list<array{variant_id: string, name: string, price_sen: int, tax_code: string, row_version: int}> */
    public static function catalogue(Terminal $t): array
    {
        return self::as($t, function () use ($t) {
            $variants = ProductVariant::with('product')
                ->whereHas('product', fn ($q) => $q->whereNull('deleted_at')->whereNotIn('type', ['service_timed', 'modifier_only']))
                ->get()->keyBy('id');
            $outlet = Outlet::findOrFail($t->outlet_id);
            $prices = app(PriceResolver::class)->resolveMany($variants, $outlet->id, $outlet->region_code, now());

            return $variants->map(fn (ProductVariant $v) => [
                'variant_id' => $v->id,
                'name' => $v->product->name.(self::optionLabel($v) ? ' · '.self::optionLabel($v) : ''),
                'price_sen' => $prices[$v->id],
                'tax_code' => $v->product->tax_code,
                'row_version' => (int) $v->row_version,
            ])->sortBy('name')->values()->all();
        });
    }

    /** Staff who may sign in on this till: name and role only, never anything PIN-derived. */
    public static function staff(Terminal $t): array
    {
        return self::as($t, fn () => Staff::where('is_active', true)
            ->where(fn ($q) => $q->whereNull('outlet_id')->orWhere('outlet_id', $t->outlet_id))
            ->orderBy('name')->get(['id', 'name', 'role'])->toArray());
    }

    /**
     * Price a cart. $cart: [{variant_id, qty_milli}] from the browser; prices, tax codes and
     * names come from the catalogue here.
     *
     * @return array{lines: list<array>, priced: array}
     * @throws \InvalidArgumentException for an empty cart or an unknown product
     */
    public static function quote(Terminal $t, array $cart, string $tender = 'cash'): array
    {
        if ($cart === [] || count($cart) > self::MAX_LINES) {
            throw new \InvalidArgumentException('empty_cart');
        }
        $catalogue = collect(self::catalogue($t))->keyBy('variant_id');
        $taxRules = self::as($t, fn () => TaxRule::forPricing(now()));

        $lines = [];
        foreach ($cart as $c) {
            $item = $catalogue[$c['variant_id']] ?? throw new \InvalidArgumentException('unknown_product');
            $lines[] = $item + ['id' => (string) Str::uuid7(), 'qty_milli' => (int) $c['qty_milli']];
        }

        try {
            $priced = PricingEngine::price(['tender' => $tender, 'tax_rules' => $taxRules, 'lines' => array_map(fn ($l) => [
                'id' => $l['id'], 'qty_milli' => $l['qty_milli'], 'unit_price_sen' => $l['price_sen'], 'tax_code' => $l['tax_code'],
            ], $lines)]);
        } catch (PricingException $e) {
            throw new \InvalidArgumentException("pricing_failed: {$e->reason}");
        }

        return ['lines' => $lines, 'priced' => $priced];
    }

    /** The order.create payload for a quoted cart, paid in full by $tender. */
    public static function orderCreate(Terminal $t, string $staffId, string $orderId, array $quote, string $tender, bool $toKitchen, int $seq): array
    {
        $p = $quote['priced'];
        $at = now()->toIso8601ZuluString('microsecond');
        $items = [];
        foreach ($p['lines'] as $i => $pl) {
            $l = $quote['lines'][$i];
            $items[] = [
                'id' => $pl['id'], 'variant_id' => $l['variant_id'], 'name' => $l['name'], 'qty_milli' => $l['qty_milli'],
                'unit_price_sen' => $l['price_sen'], 'price_row_version' => $l['row_version'], 'tax_code' => $l['tax_code'],
                'gross_sen' => $pl['gross_sen'], 'discount_sen' => $pl['line_discount_sen'] + $pl['order_discount_sen'], 'net_sen' => $pl['net_sen'],
            ];
        }

        return [
            'order' => [
                'id' => $orderId, 'receipt_no' => self::receiptNo($t, $seq), 'status' => 'paid', 'channel' => 'pos',
                'staff_id' => $staffId, 'subtotal_sen' => $p['subtotal_sen'], 'discount_sen' => $p['discount_sen'],
                'service_charge_sen' => $p['service_charge_sen'], 'tax_sen' => $p['tax_sen'],
                'rounding_sen' => $p['rounding_sen'], 'total_sen' => $p['total_sen'],
                'tax_breakdown' => $p['tax_breakdown'], 'pricing_spec_version' => $p['spec_version'],
                'tender' => $tender, 'service_charge_tax_code' => null,
                'created_offline' => false,   // the web till is online by definition
                'occurred_at' => $at, 'send_to_kitchen' => $toKitchen,
            ],
            'items' => $items,
            'payments' => [['id' => (string) Str::uuid7(), 'method' => $tender, 'amount_sen' => $p['total_sen'], 'occurred_at' => $at]],
        ];
    }

    /** Next client_seq for this device: one past the highest the server has stored. */
    public static function nextSeq(Terminal $t): int
    {
        return self::as($t, fn () => (int) DB::table('offline_sync_queues')->where('terminal_id', $t->id)->max('client_seq') + 1);
    }

    /** This device's last few sales, newest first. */
    public static function recent(Terminal $t, int $limit = 8): array
    {
        return self::as($t, fn () => DB::table('orders')->where('tenant_id', $t->tenant_id)->where('terminal_id', $t->id)
            ->orderByDesc('occurred_at')->limit($limit)->get(['id', 'receipt_no', 'status', 'total_sen', 'tender', 'occurred_at'])->all());
    }

    public static function receiptOf(Terminal $t, string $orderId): ?string
    {
        return self::as($t, fn () => DB::table('order_ids')->where('id', $orderId)->exists()
            ? DB::table('orders')->where('tenant_id', $t->tenant_id)->where('id', $orderId)->value('receipt_no') : null);
    }

    /** W + the device's last 5 hex digits: two tills never share a receipt number. */
    public static function receiptNo(Terminal $t, int $seq): string
    {
        return sprintf('W%s-%06d', strtoupper(substr(str_replace('-', '', $t->id), -5)), $seq);
    }

    private static function optionLabel(ProductVariant $v): string
    {
        return implode(' ', array_map('strval', array_values((array) ($v->options ?? []))));
    }

    private static function as(Terminal $t, callable $fn): mixed
    {
        TenantContext::enter($t->tenant_id);
        try {
            return $fn();
        } finally {
            TenantContext::leave();
        }
    }
}

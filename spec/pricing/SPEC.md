# Allurus pricing spec — version 2

v2 adds **Refunds** (below). Pricing a sale is unchanged from v1.

The single definition of how an order is priced. `app/Billing/PricingEngine.php` (PHP) and the terminal's port (Dart/TS) must both pass every case in `vectors.json`. To change behaviour: edit the vectors first, bump `spec_version` here, in `vectors.json` and in every implementation, then update the code.

All arithmetic is **integer**. Money is sen. Quantity is `qty_milli` (qty × 1000). No floats, no decimals, anywhere.

## Rounding primitive

`div_half_up(n, d)` for `n ≥ 0, d > 0` = `floor((2n + d) / (2d))` — round half away from zero. Every rounding below uses it unless stated otherwise.

## Input

```jsonc
{
  "tender": "cash",                     // "cash" applies 5-sen rounding; anything else does not
  "tax_rules": { "SST_SERVICE": { "rate_bps": 800, "version": 3 } },  // code -> rule; rates are DATA
  "lines": [{
    "id": "L1",
    "qty_milli": 2000,                  // > 0
    "unit_price_sen": 450,              // per unit, before modifiers
    "tax_code": "SST_SERVICE",          // must exist in tax_rules
    "modifiers": [{ "price_delta_sen": 150 }],   // optional; per unit; may be negative
    "discount": { "percent_bps": 1500 }          // optional; OR { "amount_sen": 200 } (line total)
  }],
  "order_discount": { "amount_sen": 100 },       // optional; OR { "percent_bps": 1000 }
  "service_charge": { "rate_bps": 1000, "tax_code": "SST_SERVICE" }  // optional; tax_code may be null
}
```

## Algorithm

1. **Effective unit price** = `unit_price_sen + Σ modifiers.price_delta_sen`. Must be ≥ 0.
2. **Line gross** = `div_half_up(qty_milli × effective_unit, 1000)`.
3. **Line discount**: `percent_bps` → `div_half_up(gross × bps, 10000)`; `amount_sen` → `min(amount, gross)`. `line_net₀ = gross − line_discount`.
4. **Order discount** on `S = Σ line_net₀`: `percent_bps` → `div_half_up(S × bps, 10000)`; `amount_sen` → `min(amount, S)`.
   **Allocate** it to lines by largest remainder, weighted by `line_net₀`: each line gets `floor(D × wᵢ / S)`; the leftover sen go one each to the lines with the largest remainder `(D × wᵢ) mod S`, ties broken by lower line index. If `S = 0`, nothing is allocated. `line_net = line_net₀ − order_discountᵢ`.
5. **Service charge** = `div_half_up(Σ line_net × rate_bps, 10000)`.
6. **Tax**, per tax code: `base = Σ line_net` of lines with that code, plus the service charge if `service_charge.tax_code` is that code. `amount = div_half_up(base × rate_bps, 10000)` — computed once per code on the aggregated base, not per line. The breakdown lists every code used by a line, plus the service-charge code when the service charge is > 0, sorted by code (byte order). Each entry carries the rule's `version` as `rule_version`.
7. `subtotal = Σ gross`, `discount = Σ line_discount + order_discount`, `tax = Σ amounts`, `pre_round = subtotal − discount + service_charge + tax`.
8. **Cash rounding** (tender `cash` only): `total = floor((pre_round + 2) / 5) × 5`. Last digit 1, 2, 6, 7 rounds down; 3, 4, 8, 9 rounds up. `rounding = total − pre_round` (−2…+2). Other tenders: `rounding = 0`.

Invariants every implementation must hold: `total = subtotal − discount + service_charge + tax + rounding`; `Σ line_net = subtotal − discount`.

## Errors

Raise with exactly these codes: `no_lines`, `invalid_qty`, `unknown_tax_code`, `negative_unit_price`, `invalid_discount` (both or neither key, negative, or `percent_bps` > 10000), `invalid_service_charge` (negative or > 10000 bps, or unknown tax code).

## Refunds (v2)

Refunding part of a sale must never drift: refunded in any number of pieces, the pieces add up to exactly what was paid. So a refund is **cumulative**: the amount for everything refunded so far, minus the amount for what had been refunded before.

### Input

```jsonc
{
  "original": {                     // the sale as priced (from its priced output)
    "tender": "cash",
    "total_sen": 2230,              // what was paid, rounding included
    "service_charge_sen": 0, "service_charge_tax_code": null,
    "lines": [{ "id": "X", "qty_milli": 1000, "net_sen": 900, "tax_code": "SST_SALES" }],
    "tax_breakdown": [{ "code": "SST_SALES", "rate_bps": 1000, "rule_version": 1, "base_sen": 900, "amount_sen": 90 }]
  },
  "already_refunded": { "X": 0 },   // qty_milli per line, from earlier refunds
  "refund": { "X": 500 }            // qty_milli per line, this refund
}
```

### Algorithm

`F(q)`, the amount for having refunded `q` (qty_milli per line):

1. If every line is refunded in full: `F = total_sen`, and each component equals the original (net per line, service charge, tax per code). This returns rounding and all.
2. Otherwise, per line `net_i = div_half_up(net_sen_i × q_i, qty_milli_i)`; `NET = Σ net_i`.
3. Service charge: `sc = div_half_up(service_charge_sen × NET, Σ original net_sen)` (0 if that sum is 0).
4. Tax, per code `c` in the original breakdown: `base = Σ net_i of lines with code c` (+ `sc` if `c` is the service-charge tax code); `amount_c = div_half_up(amount_sen_c × base, base_sen_c)` (0 if `base_sen_c` is 0).
5. `pre = NET + sc + Σ amount_c`; tender `cash` → `total = floor((pre + 2) / 5) × 5`, else `total = pre`.

The refund is `F(already + refund) − F(already)`, component by component. Output: `refund_sen`, `net_sen`, `service_charge_sen`, `rounding_sen` (= refund − net − service − tax), `tax_breakdown` (per code: `code`, `rate_bps`, `rule_version`, `amount_sen`), `lines` (per refunded line: `id`, `qty_milli`, `net_sen`).

### Errors

`unknown_line`, `invalid_qty` (refund qty ≤ 0 or not an integer), `over_refund` (already + refund > sold).

Tax refunded in proportion follows the original sale's rule versions. Confirm credit-note treatment with RMCD before go-live.

## Not in v2

Tax-inclusive prices, combos, vouchers, per-line rounding modes. Add them as new vectors and a new spec version.

Tax rates in `vectors.json` are test data only. Production rates come from versioned `tax_rules` rows and must be confirmed with the Royal Malaysian Customs Department.

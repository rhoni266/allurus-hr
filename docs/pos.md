# Point of sale (POS)

A till for cafés, restaurants and any other business: order, table, kitchen, payment, shift, receipt, stock and Finance. It runs in the browser on a phone or tablet. Card tap will run in the Android shell (phase 3).

Try it: **https://allurus.my/app?demo=banafsha** (once deployed), or open `app.html?demo=banafsha` locally. The demo password is the same as the other demos (see `demo-accounts.md`). The outlet manager's demo PIN for voids, refunds and large discounts is **2468**.

| Login | POS role | Lands on |
|---|---|---|
| `nur.banafsha@banafsha.com.my` | Owner (manager) | Dashboard, plus every POS page |
| `siti.hajar@banafsha.com.my` | Outlet manager | POS, stock, time |
| `aiman.zulkifli@banafsha.com.my` | Cashier | Till |
| `rahim.musa@banafsha.com.my` | Kitchen | Kitchen display |

## Files

| File | What |
|---|---|
| `js/pos-rules.js` | Pure rules: sen arithmetic, totals, 5-sen cash rounding, split payments, the provider adapter and mock SoftPOS, shifts, stock movements, receipt numbers, offline merge, roles, daily sales and the Finance entries. Runs in Node and, later, in Cloud Functions. |
| `js/pos.js` | Screens: Till, Tables, Kitchen display, Shift & cash, Menu & settings, Sales reports. |
| `js/seed-banafsha.js` | Demo company Banafsha Café Sdn Bhd. |
| `tests/pos.test.js`, `tests/banafsha.test.js` | Tests. |
| `docs/pci-scope.md` | Why card data never reaches us. |

## Data (phase 1, local demo)

`state.pos = { outlets, categories, modifierGroups, items, combos, tables, orders, payments, shifts, refunds, audit, seq, queue }`. Money is whole sen. Rates are basis points, set per outlet and per item tax code. Ingredients and stock movements are in the existing Operations stock list (`state.ops.items` and `state.ops.moves`). Finance entries go to `state.finance.txns` with `source: 'pos'`.

POS is **not** synced to the cloud yet. The generic bucket sync would let any member write it, which is not acceptable for payments. Cloud use waits for the `tenants/{t}/pos_*` collections and the rules in the proposed diff, plus the `recordPayment` Cloud Function.

## Settings to confirm per outlet

Sample values are in the demo only. Nothing is hardcoded:

- tax codes and rates;
- service charge (on or off, rate, dine-in only, whether it is taxed);
- SST registration number;
- cashier discount limit;
- whether stock comes off when sent or when paid;
- payment methods;
- receipt header and footer;
- the word used for items ("Menu item", "Product", "Service").

## LHDN MyInvois (prepared, not built)

We already keep:

- per receipt: receipt number, date and time, lines, quantities, unit prices, tax per tax code, discount and total;
- per outlet: the outlet and the company's SST number.

Still missing for e-invoicing:

- the company TIN and the MSIC code on the outlet;
- a classification code per menu item;
- a buyer TIN, ID type and ID number when a customer asks for an e-invoice;
- the monthly consolidated e-invoice for receipts where the customer didn't ask, and a scheduled function to submit it;
- a link from a receipt to its MyInvois UUID and status.

`js/einvoice-rules.js` and `js/myinvois.js` can be reused for this.

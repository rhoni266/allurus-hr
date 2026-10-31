# Inventory Ledger, Recipes, Purchases and Open Containers (Addendum to WASTE-SPEC.md)

Read `WASTE-SPEC.md` first. This addendum extends it. Build on what already exists in `pos/` (the `Waste` and `StockMovements` tabs, `unit | cost | track_stock | kind` on Products, `loadSampleIngredients`). Do not rebuild those. Study the current `Code.gs` and report what exists before proposing changes.

## Goal
Inventory must be **calculated from movements**, never typed into a stock cell. On-hand for every ingredient is:

```
on_hand = opening
        + purchases received
        - sales usage (via recipe)
        - waste per dish (via recipe)
        - waste per ingredient
        +/- stocktake adjustments
```

Also track **open containers** (a bottle of caramel syrup, a bag of beans) so a second person opening the same item is caught, shelf life after opening is controlled, and usage can be measured per container.

## The movement types (one ledger: `StockMovements`)
| reason_type | Meaning | Qty sign |
|---|---|---|
| `purchase` | Goods received | + |
| `sale_usage` | Ingredients used by a paid sale, from the recipe | - |
| `sale_usage_reversal` | A void put the usage back (only if the dish was **not** made yet) | + |
| `waste_dish` | A made dish thrown away (remake, quality low, returned). Ingredients taken out via the recipe | - |
| `waste_ingredient` | Raw stock lost (spoiled, expired, expired_after_open, spilled, broken, other) | - |
| `waste_reversal` | Correction of a waste entry | + |
| `stocktake_adjustment` | Counted correction, reason required | +/- |
| `container_open` | A sealed pack becomes an open container. Total volume does not change | 0 (state change) |
| `container_finish` | An open container is empty | 0 (state change) |
| `stock_in` / `adjustment` | Keep existing behaviour; map to `purchase` and `stocktake_adjustment` as agreed with me | |

Every row has `movement_id`, `datetime`, `ingredient_id`, `change_qty` (in the ingredient's **base unit**), `reason_type`, `ref_id` (sale_id, waste_id, purchase_id, count_id, container_id), `balance_after`, `unit_cost`, `value`, `staff_name`, `device_id`. `balance_after` must always equal the recomputed balance (test it).

## Cancelled orders and dish waste: the timing rule
- Cancelled or voided **before** the dish is made: no ingredients were used. Reverse the sale usage, no waste.
- Cancelled, returned or remade **after** it was made: the sale usage stays, **and** a `waste_dish` entry records the ingredients lost. Remaking a dish therefore consumes the ingredients twice, correctly: once for the first (wasted) dish, once for the replacement.
- A dish-waste entry needs a reason: `cancelled_after_made`, `quality_low`, `wrong_order`, `customer_returned`, `remake`, `dropped`, `staff_meal`, `other` (note required for `other`).
- Add a "made" marker on the order (bar/kitchen ticket button "Made"). Voiding an order that is marked made must ask: "Was it already made? Log as waste?"
- Waste per dish, per ingredient, voids and discounts are four different reports. Do not mix them.

## Recipes
New tab `Recipes`: `recipe_id | menu_product_id | ingredient_id | qty | unit | note`
- One row per ingredient per menu item. Quantities in the ingredient's base unit (g, ml, pcs).
- A menu item with no recipe deducts nothing and shows a warning ("no recipe: stock not tracked for this dish"). A menu item that is itself a stocked product (a packaged croissant) can deduct its own stock, as today. Decide with me how the two coexist and show the options.
- Recipe screen (manager only): add/edit rows, show the **recipe cost** and the margin against the selling price.
- Server computes usage and cost. The client never sends quantities for recipe usage.
- Modifiers (extra shot, oat milk, less sugar) are a later phase. List them as future ideas, but design so a modifier can carry its own recipe lines.

## Purchases
New tab `Purchases`: `purchase_id | datetime | supplier | invoice_no | ingredient_id | pack_qty | pack_size | base_unit | total_qty | pack_cost | line_cost | batch_no | expiry_date | received_by | status`
- Receive stock in packs (1 bottle = 750 ml, 1 carton = 24 pcs). The server converts to base units: `total_qty = pack_qty x pack_size`.
- `purchase_id` is client-generated, idempotent. A retry never duplicates.
- Costing: **weighted average cost** per ingredient, updated on each purchase (`new_avg = (old_value + line_cost) / (old_qty + total_qty)`). Store the average on the ingredient and the cost used on each movement. FIFO is a future idea.
- Reverse a wrong purchase with a reversal row, never by editing.
- Screens: Receive stock (supplier, invoice no, lines, expiry), purchase history, and a low-stock/reorder list (reorder level per ingredient).
- No supplier ordering or purchase orders yet.

## Ingredients: new setup fields
On Products where `kind = ingredient` (add columns at the end, never shift existing ones):
`pack_size | pack_unit | base_unit | reorder_level | open_shelf_life_days | max_open_containers | track_open`
- `max_open_containers` default 1 (for caramel syrup at one bar), configurable per ingredient.
- `track_open` TRUE only for items that are opened in packs (syrups, sauces, beans, milk cartons). Dry/unit items (cups, lids) skip it.

## Open containers (the "double open" problem)
New tab `OpenContainers`:
`container_id | ingredient_id | size | opened_at | opened_by | use_by | status | est_remaining | finished_at | discarded_reason | note | station`
- `status`: `open`, `finished`, `discarded`.
- **Principle:** the ingredient total is the accounting truth. Container records are for control, shelf life and variance. A second open container never corrupts the ingredient total.
- **Open action:** `openContainer({ container_id, ingredient_id, station, reason })`
  - Needs a sealed pack in stock. Sealed = total on hand minus the sum of open containers' remaining. If none, reject with a clear message.
  - If open containers for this ingredient already reach `max_open_containers`, the till shows a **warning**, not a silent block: "Caramel syrup is already open since 08:10 by Aini, about 400 ml left. Open another?" The staff member must pick a reason: `first_finished`, `other_station`, `first_contaminated`, `first_expired`, `other` (note). The server re-checks and stores the reason, and the manager report lists these events.
  - `use_by = opened_at + open_shelf_life_days`.
- **Usage allocation:** sale usage is allocated to the **oldest open container first** (FIFO), per ingredient. Keep `est_remaining` as `size - allocated usage`, floored at 0. If usage exceeds the oldest container, roll to the next and flag "container overrun".
- **Finish:** `finishContainer({ container_id })` marks it empty. Compare `size` against allocated usage. Store `variance = size - allocated_usage` (positive = more left in the real bottle than the recipes explain, negative = used more than recipes explain, i.e. over-pouring or spills). Report this per container and per ingredient.
- **Discard with remainder:** `discardContainer({ container_id, reason, remaining_estimate })` is a waste_ingredient entry for the remaining quantity, reason `expired_after_open`, `spilled`, `contaminated` or `other`.
- **Use-by alerts:** on the Stock screen, containers past or near `use_by` show red/amber. Opened but past `use_by` while still `open` appears at the top of the manager report.
- Everything is idempotent by id. Open/finish/discard each write a movement row (`container_open`, `container_finish`, or a `waste_ingredient` row).

## Stocktake (count)
New tab `StockCounts`: `count_id | datetime | ingredient_id | counted_qty | expected_qty | variance | variance_value | counted_by | note | status`
- Count screen: list ingredients, enter counted sealed packs and, for open containers, an estimate of what is left (0, 25, 50, 75, 100 percent of the bottle, or a number).
- Server computes `expected_qty` from the ledger, `variance`, and its value. On confirm, write a `stocktake_adjustment` movement. A reason is required when the variance is larger than a threshold set in Script Properties (`COUNT_VARIANCE_PERCENT`, default 5).
- Report: theoretical vs counted, with the largest variances at the top.

## Reports (manager only)
- **Stock:** on hand (sealed + open), value, below reorder level, nearest expiry, open containers with use-by.
- **Usage vs theoretical:** by ingredient and period: purchases, sales usage, dish waste, ingredient waste, adjustments, closing. The closing figure must equal on-hand (add a reconciliation check, show any difference in red).
- **Waste:** per dish vs per ingredient, by reason, by staff, by item, as a % of sales. Staff view is for training, shown to managers only.
- **Double-open events** and **container variance**.
- **Recipe cost and margin** per menu item.
- Daily summary additions: waste split (dish / ingredient), purchases received today, ingredients below reorder level.

## Backend rules (same as the rest of `pos/`)
- All writes inside `LockService` and idempotent by client id. Prices, costs, recipe usage and balances come from the server.
- Never edit or delete past ledger rows. Corrections are reversals.
- Money as integer sen in code, RM with 2 decimals in the Sheet. Quantities in base units. Round only at the edges, store enough precision for grams/ml (3 decimals).
- Roles later (Allurus): cashier logs waste and opens containers; only manager sees costs, receives purchases, edits recipes, reverses, counts stock.
- Apps Script limits: with several hundred sales a day and recipes, `StockMovements` will grow quickly. Use batch writes (`setValues` once per sale), avoid reading whole tabs repeatedly inside loops, and add a CSV export + monthly archive note to the README. Tell me if performance becomes a problem; that is a signal to move to the proper database.

## Phase 2 (design only, same rules as WASTE-SPEC.md)
Extend `docs/pos-waste-integration.md` with Firestore collections for recipes, purchases, open containers, stock counts and movements, all written only by Cloud Functions, keyed by client ids. Show how they map to the existing Allurus inventory module and where Allurus lacks fields (unit conversion, pack size, average cost, batches/expiry, containers). Show the Allurus admin POS dashboard additions: usage vs theoretical, container variance, double-open events, expiry risk, purchase cost trend. Do not build or deploy without my go-ahead.

## Tests (before saying it works)
- Purchase of 2 x 750 ml syrup adds 1500 ml, updates weighted average cost, idempotent on retry.
- A sale of a recipe item deducts each ingredient once; void before made reverses it; void after made keeps usage and logs `waste_dish`.
- Recipe item with no recipe: no deduction and a visible warning.
- Open a second container while one is open: warning and reason required; ingredient total unchanged; usage allocates to the oldest first.
- Open with no sealed pack in stock: rejected.
- Finish a container: variance computed. Discard with remainder: waste entry for the remainder.
- Use-by flags past-date containers.
- Stocktake: variance computed, adjustment written, balance after equals the count.
- `balance_after` equals the recomputed balance after any mix of purchase, sale, void, dish waste, ingredient waste, open, finish, count.
- Tampered qty/cost/unit in any request is ignored. Bad input is rejected with clear messages.
- Existing sales, void, and waste tests still pass. Update the README with the new tabs, the `setup` change, and the redeploy steps.

## Working style
- First: study report plus your proposal for the new tabs, columns and how recipes interact with the stocked menu items already in `Products`. Wait for my OK before changing `Code.gs`.
- Build in this order: `Code.gs` + tests, `api.js`, then screens. After each step tell me exactly what to do in the Sheet and how to redeploy.
- Ask me before adding any library or paid service, and before anything is committed, deployed or written to production data. Keep `pos/config.js` out of git.

## Questions to ask me first
1. Do I stock **dishes** (croissants) and **ingredients** (milk) in the same list, or should menu items with recipes be fully ingredient-driven?
2. How many open containers per ingredient per bar are normal (1 or 2)? Which items need open tracking, and what is the open shelf life for each?
3. Should "Made" be tapped by the bar/kitchen, or assumed once the order is paid?
4. What variance percentage should trigger a manager alert on a stocktake?
5. Which units do I buy in for my main ingredients (pack sizes), and do I have supplier invoices I can enter in the first week?

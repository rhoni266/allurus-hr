# POS waste in Allurus: Phase 2 design

**Status: design only. Nothing in this document is built, deployed or written to production until it is approved.**
Date 31/10/2026. Phase 1 (the trial in `pos/`, Google Sheets + Apps Script) is live and tested.

## 1. What carries over from the trial

- **Same data.** The trial's tabs become per-tenant Firestore collections with the same field names and the same ids. Only `pos/api.js` and the backend change.
- **Same rules:**
  - Money is in integer sen in code, and cost comes from the server.
  - Waste is a stock movement: nothing is ever deleted, and a reversal is new rows.
  - Staff meals are kept out of waste cost and % and reported on their own line.
  - Card numbers are refused in any free text.
- **Allurus patterns reused:**
  - The `pos_*` collections under `tenants/{t}`, and `posRole` on `users/{uid}` (manager, cashier, waiter, kitchen).
  - Cloud Function-only writes, like payments, refunds, shifts and audit today (`functions/pos-core.js`).
  - `working(t)` and `canRead(t)` subscription checks, plus the `features.json` catalogue.

## 2. Decision needed: how POS products link to inventory

Allurus inventory today (`state.ops.items` / `moves`) tracks **raw materials and packaging**. Stock on hand is calculated as `opening + Σ moves`, and value uses `lastPrice`. The earlier Allurus POS menu already has a per-portion recipe (`pos_menu[].recipe = [{ itemId, qty }]`), and `pos-rules.js stockMoves()` deducts it.

You chose "both" for waste: a whole product, and an ingredient. That works with either option below. What has to be decided is **what a sale deducts**.

| | **A. One-to-one** (each POS product is one inventory item) | **B. Recipes** (a sale deducts its ingredients) |
|---|---|---|
| How | `inventoryItemId` on each product. Selling a croissant takes 1 croissant off. | Each menu item has `recipe: [{ inventoryItemId, qty }]`. A latte takes 0.2 l milk and 0.018 kg beans off. |
| Good for | Bought-in goods: pastries, cakes, bottled drinks. | Made-to-order drinks and food, which is most of a café. |
| Waste of a whole product | Takes the item off. | Takes its recipe's ingredients off, priced at ingredient cost. |
| Waste of an ingredient | Takes the item off. | Takes the item off. |
| Cost accuracy | Only as good as the product's cost. | True cost per dish, which follows ingredient prices. |
| Work to set up | Low: map each product once. | Medium: write a recipe per drink. Usage per gram is only as good as the recipe. |
| Risks | Drinks can't be tracked at all. | A wrong recipe makes stock drift; this needs a weekly stocktake. |
| Already in Allurus | `ops.items` | `pos_menu.recipe` and `stockMoves()`; `recipes` / `auto-deduct` are in the catalogue as "planned" |

**My recommendation is a mix, set per product:**
- `stockMode: 'item'` (option A) for bought-in goods.
- `stockMode: 'recipe'` (option B) for made drinks and food.
- `stockMode: 'none'` for anything untracked.

This is what the trial does today: bought-in goods have stock, drinks are untracked, and ingredients are their own rows. **Please choose A, B or the mix before I build.**

## 3. Data model (Firestore, per tenant)

Every doc id below is the id the client makes. A record re-sent from the offline queue or a retry lands on the same document and cannot duplicate.

**`tenants/{t}/pos_waste/{wasteId}`** holds one document per entry, which is the trial's lines grouped:

```
{ wasteId, outletId, createdAt (server timestamp), datetime (ISO +08:00, as the till saw it),
  staffUid, staffName, deviceId,
  status: 'logged' | 'reversed',
  lines: [{ lineNo, productId, inventoryItemId, name, qty, unit, unitCostSen | null, costSen | null, reason, note }],
  totalCostSen, costMissing: bool, staffMeal: bool,          // staffMeal = every line is staff_meal
  reversedAt, reversedBy, reverseReason }                    // set only by reverseWaste
```

- **Lines live inside the entry document**, at most 50, so one entry is one atomic write.
- **Reversals:** the trial's separate `reversal` rows become the `reversed*` fields here, plus `waste_reversal` stock movements. That keeps the trail without a second document.
- **The migration script** writes trial reversal rows into those fields (section 7).

**`tenants/{t}/pos_stock_movements/{movementId}`** holds the inventory trail:

```
{ movementId, outletId, createdAt, datetime, inventoryItemId, productId, name,
  changeQty, unit, reasonType: 'sale'|'void_return'|'waste'|'waste_reversal'|'stock_in'|'adjustment',
  refId (orderId / wasteId / note), balanceAfter, staffUid, staffName, deviceId }
```

- **Ids:**
  - for a sale or waste, a deterministic `${refId}-${inventoryItemId}-${reasonType}` (the same idea as `pos-rules.js stockMoves`)
  - for stock in or adjust, the client's `movementId`
- **One trail, not two.** `ops.moves` stays the trail the Operations screens read. Each function also adds a matching `ops.moves` entry (`{ id: movementId, itemId, date, qty, ref, note }`), so stock on hand and purchase orders keep working unchanged.
- **Data model of an existing module:** `pos_stock_movements` is where reasons, balances and staff live. Adding to `ops.moves` from the server changes how the Operations data is written, so it needs your OK (Rules section of the original brief).

**`tenants/{t}/pos_stock/{inventoryItemId}`** holds `{ onHand, updatedAt }`. It's the running balance the functions keep inside a transaction, so `balanceAfter` is exact, and it's checked against `opening + Σ ops.moves` nightly. With one outlet there is one doc per item. `multi-outlet` later turns the key into `{outletId}_{itemId}`.

**Product fields** (on `pos_menu` items):
- `unit`, `costSen` (null if unknown), `kind: 'menu'|'ingredient'`
- `stockMode`, `inventoryItemId` or `recipe`

Ingredients are the existing `ops.items`; they are not copied into `pos_menu`.

**Indexes:**
- `pos_waste` on (`outletId`, `datetime`), and on (`status`, `datetime`)
- `pos_stock_movements` on (`inventoryItemId`, `datetime`)

## 4. Writes and security

**Who may do what** (your answer: as in the brief):

| Action | cashier | waiter / kitchen | manager / admin with `pos` | plain employee |
|---|---|---|---|---|
| Log waste (`logWaste`) | ✅ | ❌ | ✅ | ❌ |
| See waste **cost** | ❌ | ❌ | ✅ | ❌ |
| See today's waste list | own entries, no cost | ❌ | all, with cost | ❌ |
| Reverse waste | ❌ | ❌ | ✅ | ❌ |
| Stock in / adjust | ❌ | ❌ | ✅ | ❌ |
| Dashboard, staff view | ❌ | ❌ | ✅ | ❌ |

**Cost can't be hidden by rules.** Firestore can't hide one field of a document from one role. So:
- cashiers get **no read** on `pos_waste` and `pos_stock_movements`;
- the `logWaste` result they receive has no cost;
- their own entries for today come from a callable `posWasteToday`, which drops the cost fields.

Managers read the collections directly.

**Callable functions** (in `functions/pos-core.js`, the same wrapper as `posRecordPayment`):
- `posLogWaste({ tenantId, outletId, wasteId, items, staffName })`
- `posReverseWaste({ tenantId, wasteId, reason })`
- `posStockAdjust({ tenantId, movementId, inventoryItemId, changeQty, reasonType, note })`
- `posWasteToday({ tenantId, outletId })`, read-only

**Each function:**
1. Checks the caller: signed in, a member of `tenantId`, not disabled, `posRole` allowed for the action, and `working(t)`.
2. Checks the input shape:
   - ids `^[A-Za-z0-9-]{8,64}$`
   - at most 50 lines, quantity rules by unit, reasons from the list
   - "other" needs a note
   - no text that looks like a card number
3. Runs one transaction, with all reads before any writes (the fake-Firestore tests already enforce this):
   - if the doc id exists, return it (idempotent)
   - read prices and costs from `pos_menu` / `ops.items`, never from the request
   - update `pos_stock`, then write the entry, the movements and an audit entry
4. Writes the audit entry to `pos_audit/{id}`: `{ action, by (uid, empId), at, ref, before: { onHand… }, after: { onHand… }, reason }`.

Logs carry ids and status only.

**Rules diff** (shown for approval, not applied):

```diff
       match /pos_audit/{id} { allow read: if onTill(['manager']) && canRead(t); allow write: if false; }
+      // Waste and the stock trail: written only by Cloud Functions (posLogWaste, posReverseWaste, posStockAdjust).
+      // Managers read them (they carry cost); cashiers get their own entries without cost through posWasteToday.
+      match /pos_waste/{id} { allow read: if onTill(['manager']) && canRead(t); allow write: if false; }
+      match /pos_stock_movements/{id} { allow read: if onTill(['manager']) && canRead(t); allow write: if false; }
+      match /pos_stock/{id} { allow read: if onTill(['manager']) && canRead(t); allow write: if false; }
```

- The `ops.*` bucket rules stay as they are. The functions write with the Admin SDK.
- **To decide:** once POS stock is on, should managers still be able to change `ops.moves` by hand in Operations? I'd lock "stock adjust" in Operations to the same function, so there is one trail. That changes an existing module, so it needs your OK.

**Billing.** Cloud Functions need the **Blaze plan**; the project is still on Spark. Before any deploy:
- upgrade at console.firebase.google.com/project/allurus-hr/usage/details;
- set a **budget alert** (for example RM 50/month at 50%, 90% and 100%);
- keep `maxInstances: 20`.

I will not deploy.

## 5. Allurus admin dashboard: POS section

- **Where:** a **POS** route group in `app.html`, built like the other modules (`js/pos-dashboard.js`, `install(ctx)` registering a view).
- **Shown when:**
  - the company has the feature (`AllurusFeatures.has('pos')`, plus `pos_waste` for the waste cards);
  - the user is a manager or admin with `pos`.
- **Superadmin:** sees a tenant's dashboard only through the existing superadmin "open company" pattern, one tenant at a time. Queries are always under `tenants/{t}/…`, with no collection-group queries, so nothing crosses tenants.

**Cards and charts** (using the existing chart style):
- **Sales:** today / week / month, orders, average order value, payment mix, top and bottom items, voids.
- **Waste:**
  - waste cost and **waste % of sales**
  - waste by reason, by item and by staff (staff view: managers only, framed as "for training")
  - staff meals on their own line
- **Stock:**
  - on hand vs reorder level (`AllurusOpsRules.stockLevels`), and stock value (on hand × cost)
  - a feed of the latest 50 stock movements, with reason and who made each change

**Filters:** outlet, date range (today, 7 days, month, custom) and staff. **Export:** CSV of the current view, using the existing `csv` helper with the formula guard.

**Insights:** plain rules, no AI guesses. Each has a threshold in outlet settings:
- "Waste was X% of sales this week (limit Y%)." Off by default, because you chose no alert in the trial.
- "Item Z was wasted on 3 days in a row."
- "N items are below their reorder level."
- "N waste lines have no cost: waste cost is incomplete."

**States and format:**
- loading, empty ("No waste logged in this period") and error with retry;
- mobile layout at 390 px;
- DD/MM/YYYY, RM x.xx, Asia/Kuala_Lumpur days (`pos-rules.js klDay`).

**Feature flags** go in `seed/features.json`, industry F&B, all `planned` until built:
- `pos_waste`: "Waste log at the till", dependsOn `pos`, `stock`
- `pos_inventory_link`: "POS stock linked to inventory", dependsOn `pos`, `stock`
- the existing `auto-deduct` and `recipes` keys cover option B

Turning them on per company goes through the existing superadmin feature matrix. `npm run seed` writes the live catalogue, so it runs only with your go-ahead.

## 6. Reports

- **Daily:** waste cost, % of sales, top reasons, top wasted items, staff meals.
- **Weekly:**
  - waste % for each day (line chart)
  - items wasted on 3 or more days
  - staff view, for managers only
- **Inventory:**
  - stock value (on hand × cost)
  - low-stock list against reorder levels
  - movement history per item, filterable and exportable to CSV

## 7. Migration from the trial: `pos/tools/migrate-sheet-to-firestore.js`

- **Input:** the CSVs exported from the trial: `Products`, `Sales`, `SaleItems`, `Waste`, `StockMovements`.
- **Arguments:** `--tenant <id> --outlet <id> --dir <csv folder>`, plus `--project` (no default).
- **Dry run by default.** It prints what it would write. Writing needs `--commit`.
- **`--commit` against `allurus-hr`** also requires typing the tenant id at a prompt. It is **never run against production without your explicit go-ahead**; test it on the Firebase emulator first.

**Ids and conversion:**
- **Same ids:**
  - `sale_id` becomes `pos_orders/{id}`, which also gets a matching `pos_payments` record
  - `waste_id` becomes `pos_waste/{id}`, with lines grouped by `line_no`
  - `movement_id` becomes `pos_stock_movements/{id}`
  - writes use `set` with merge off, and a doc that already exists with the same content is skipped, so running it twice is safe
- **Conversion:**
  - RM to sen with `Math.round(x * 100)`
  - blank cost becomes `null` and `costMissing: true`
  - `datetime` is kept, and `createdAt` is set to it
  - `rev-<id>` reversal rows set `reversedAt`, `reverseReason` and `status` on the original entry
- **Products:** mapped to `pos_menu` items and `ops.items` using a mapping CSV you fill in (`product_id → inventoryItemId`). The script won't guess.
- **Reconciliation report:**
  - per tab: rows read, rows written, skipped (already there), rejected (with reason)
  - totals: sales RM, waste RM, staff-meal RM, and the sum of `change_qty` per item
  - a check that each item's last `balance_after` equals its stock in Products
  - a non-zero exit if anything doesn't reconcile

## 8. Option: stay on Google Sheets for the trial

Phase 2 is not required to keep trading. The trial can stay on Sheets + Apps Script as long as it fits:

| | Stay on Sheets | Move to Allurus (this document) |
|---|---|---|
| Cost | Free (Google account) | Blaze plan: usually a few RM/month at one café's volume, set a budget alert |
| Logins and roles | None: one shared key in `config.js`, readable by anyone with the page | Real staff logins, `posRole`, cost hidden from cashiers |
| Allurus dashboard | No. Use the Today screen and the Sheet itself | Yes, with sales, waste and stock together |
| Limits | Apps Script quotas (about 20k calls/day, 6 min per call); a Sheet slows past roughly 50k rows; 1-2 devices | Firestore scale, many devices and outlets |
| Data safety | Daily Drive backup trigger; anyone with the key can write | Rules, audit, server-only writes |

**Staying is reasonable while:**
- there is one outlet with 1-2 devices
- the link stays private
- there is no real customer data

**Move when** you need any of these:
- staff logins
- more devices
- the Allurus dashboard
- a few months of rows (the Sheet gets slow)

Because the field names and ids already match, the migration in section 7 works whenever you decide. Waiting costs nothing except the trial's security limits.

## 9. Build order once approved

1. **Product link (section 2):** your choice of A, B or the mix, plus the `ops.moves` question. Then the rules diff, which you approve before it goes in.
2. **Functions:** `pos-core.js` waste and stock functions, with fake-Firestore tests, including reads before writes, idempotency, the roles table and the reconcile check.
3. **Till:** `pos/api.js` switches from Apps Script to the callables. The screens don't change.
4. **Dashboard:** the dashboard view, plus the catalogue keys in `seed/features.json`.
5. **Migration:** the script, tested on the emulator (needs Java 11+, not on this machine yet).
6. **Deploy:** after Blaze and a budget alert, and only with your approval for each phase.

## 10. Out of scope: future ideas

Supplier ordering and purchase orders from the POS, recipe and ingredient costing beyond option B, barcode scanning, photo evidence of waste, automatic forecasting of prep quantities, waste per outlet with transfers (`multi-outlet`), and near-expiry alerts (`batch-expiry`).

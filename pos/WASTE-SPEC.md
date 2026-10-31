# Waste Management for Cafe POS, linked to Allurus Inventory (Instructions for Claude Code)

## Goal
Let cafe staff **log waste at the till** (spoiled milk, dropped latte, expired croissants, remake, staff meal, etc.) in two phases:

1. **Trial (now):** works in the existing `pos/` app with the Google Sheets + Apps Script backend. Stock goes down, waste is recorded, and the daily summary shows waste cost.
2. **Later:** the same data flows into **Allurus Inventory** so an **Allurus admin** sees POS sales, waste and stock together on one dashboard, with proper roles, audit and Firestore rules.

Build phase 1 so phase 2 is a change of `api.js` and the backend only (same rule as the rest of `pos/`).

## First, study before coding (do not skip)
1. Read the existing Allurus inventory module in this repo (collections, field names, stock movement logic, permissions, UI). Summarise in 10 lines what exists: items, units, locations/outlets, stock movements, costs, reorder levels.
2. Read the earlier POS Firestore rules work (`tenants/{t}/pos_*`, `posRole`, Cloud Function-only writes for payments/refunds/shifts/audit). Waste must follow the same pattern.
3. Report gaps: what inventory fields do I need that Allurus does not have yet (e.g. cost per unit, ingredient/recipe link)? Ask me before inventing a new inventory model.

## Principles
- **Waste is a stock movement**, not a deleted sale. Never edit or delete past rows; corrections are new rows (a reversal).
- **Money as integer sen** in code, RM with 2 decimals in the Sheet. Timezone Asia/Kuala_Lumpur, DD/MM/YYYY on screen.
- **Cost comes from the server**, never from the client (same as prices). Use the product's `cost` column (add it, see below). If cost is blank, record qty and flag `cost_missing`.
- **No personal data, no card data.** Staff are identified by a short `staff_name` / later their Allurus user id.
- Waste is not the same as a **void** (a cancelled sale) or a **discount**. Keep them separate in reports.
- Do not add libraries or paid services without asking me.

## Phase 1: Google Sheet changes

### Products tab: add columns (append at the end so nothing shifts)
`unit | cost | track_stock`
- `unit`: pcs, cup, g, ml, kg, l (text).
- `cost`: cost per unit in RM. Blank means unknown.
- `track_stock`: TRUE/FALSE (a blank `stock` already means "not tracked"; keep that rule working and set this column consistently).

### New tab `Waste`
`waste_id | datetime | product_id | name | qty | unit | unit_cost | cost | reason | note | staff_name | device_id | status | reverses_waste_id`
- `waste_id`: client-generated UUID so a retry never duplicates (idempotent, same as `sale_id`).
- `reason` is one of: `spoiled`, `expired`, `dropped`, `wrong_order`, `remake`, `overproduction`, `staff_meal`, `sample`, `other`. `other` requires a note.
- `status`: `logged` or `reversed`.

### New tab `StockMovements` (the inventory trail)
`movement_id | datetime | product_id | name | change_qty | reason_type | ref_id | balance_after | staff_name | device_id`
- `reason_type`: `sale`, `waste`, `void_return`, `waste_reversal`, `stock_in`, `adjustment`.
- Write one row for every stock change from now on (sales, voids, waste, manual edits through the app). `ref_id` is the `sale_id` or `waste_id`. This table is what Allurus Inventory will import.
- Keep existing sales and void behaviour unchanged. Add the movement rows around it.
- Add a `stock_in` and `adjustment` action (with reason) so stock changes are never made by typing into the Sheet.

### Apps Script actions (all POST, same key rules as today)
- `logWaste`: `{ waste_id, items: [{ product_id, qty, reason, note }], staff_name, device_id }`
  - Lock first. If `waste_id` exists, return the saved record (idempotent).
  - Validate: product exists and is active or tracked, qty is a positive number (whole number unless unit is g/ml/kg/l), reason is allowed, note present for `other`, no card-number-looking text in notes.
  - Look up `unit_cost` from Products. Compute `cost`. Reduce stock if tracked, write a movement row. Warn (do not block) if stock goes negative.
  - Limit one waste entry to a sensible size (for example qty <= 999 and <= 50 lines).
- `reverseWaste`: `{ waste_id, reason }` marks the row `reversed`, puts the stock back, writes a `waste_reversal` movement. Reason required. A second call does nothing.
- `getWaste`: `{ date_from, date_to }` returns rows plus totals by reason and by product.
- `getDailySummary` (extend): add `waste_cost`, `waste_count`, `waste_by_reason`, and `waste_percent_of_sales` (waste cost divided by sales for the day, guard against zero).
- `saveProduct` (extend): accept `unit`, `cost`, `track_stock`.
- `stockAdjust`: `{ product_id, change_qty, reason_type: 'stock_in'|'adjustment', note }` (reason required for adjustments).

## Phase 1: POS screens (`index.html`, `style.css`, `app.js`)
Add a **Waste** tab next to Till / Today / Products.
1. **Log waste** screen: product search/grid (same grid as the till), qty stepper, reason chips (large tap targets, min 44px), optional note, staff name remembered on this device. A "Log waste" button that is disabled while saving. On failure keep the form and the same `waste_id`, show "Not saved. Try again", retry safely.
2. **Today's waste list:** each entry with time, item, qty, reason, cost, and a **Reverse** button (asks for a reason). Reversed rows are struck through.
3. **Daily summary:** add a "Waste" card: total waste cost, number of entries, top 3 reasons, waste as a percent of sales.
4. **Products screen:** show and edit unit, cost, track stock. Show a gentle warning for products without a cost ("cost missing, waste cost will be incomplete").
5. **Stock screen (small):** list of tracked items with stock, low-stock highlight, and Stock in / Adjust buttons.
6. Keep every backend call in `api.js` (`logWaste()`, `reverseWaste()`, `getWaste()`, `stockAdjust()`). `app.js` never calls the URL directly.
7. Receipts and bar tickets are unchanged.

## Phase 1: tests (run before saying it works)
- Log waste for a tracked product: stock drops once, a `Waste` row and a `StockMovements` row exist, cost = qty x unit cost.
- Tap Log twice quickly, and resend the same `waste_id`: only one record.
- Tampered cost or unit_cost in the request is ignored.
- Bad qty (0, negative, text, fractional for pcs), unknown product, unknown reason, `other` without note: all rejected with a clear message.
- Reverse a waste entry: stock restored, status `reversed`, second reverse does nothing.
- Sales, voids and the daily summary still behave exactly as before. Existing unit tests still pass; add tests for the waste functions.
- `StockMovements.balance_after` always equals the product's stock after the change (check after a mix of sale, waste, void, adjust).
- Update the README: setup changes (new columns and tabs, run `setup()` again, redeploy a new version), and a CSV export note for `Waste` and `StockMovements`.
- Tell me the exact steps to update my Sheet and redeploy (Deploy > Manage deployments > edit > New version).

## Phase 2: integrate with Allurus (design now, build after I approve)
Do **not** build this until I say so. Write `docs/pos-waste-integration.md` covering:

### Data model (Firestore, per tenant, follow the existing `pos_*` conventions)
- `tenants/{t}/pos_waste/{waste_id}`: same fields as the Sheet, plus `outletId`, `staffUid`, `createdAt` (server timestamp).
- `tenants/{t}/pos_stock_movements/{movement_id}` and a link to Allurus inventory items (`inventoryItemId` on each product). Decide with me whether POS products map one-to-one to inventory items or to recipes (ingredients deducted per sale). Ask me, show both options with pros and cons.
- Doc id = the client `waste_id` / `movement_id`, so a re-synced offline record cannot duplicate.

### Writes and security
- Waste, stock movements, payments, refunds and audit entries are written **only by Cloud Functions** (callable `logWaste`, `reverseWaste`, `stockAdjust`). Clients never write these collections directly.
- Roles from the existing `posRole`: cashier can log waste; only manager/admin can reverse, adjust stock, or see cost. Plain employees get no access. Show the rules diff before I deploy anything.
- Each function checks tenant membership, role, input shape, and idempotency, and writes an audit entry (who, what, when, before/after).
- This needs the Blaze plan for Functions. Remind me of that and of budget alerts; do not deploy.

### Allurus admin dashboard
- Add a **POS** section to the Allurus admin app (tenant-scoped, role-gated; superadmin sees per tenant only through the existing superadmin patterns, no cross-tenant leaks).
- Cards and charts: sales today / week / month, orders, average order value, payment mix, top and bottom items, **waste cost and waste % of sales**, waste by reason, waste by item, waste by staff, stock on hand vs reorder level, stock movements feed, voids.
- Filters: outlet, date range, staff. Export CSV.
- Insights as plain rules, not AI guesses: "Waste % above X% this week", "Item Y wasted 3 days in a row", "Stock below reorder level".
- Loading, empty and error states. Mobile-friendly. DD/MM/YYYY, RM, Asia/Kuala_Lumpur.
- Feature flag in the existing superadmin feature matrix (industry: F&B) so POS, Waste and Inventory link can be switched on per company.

### Migration from the trial
- Write a script `pos/tools/migrate-sheet-to-firestore.js` (dry-run by default, `--commit` to write) that reads the exported CSVs (`Products`, `Sales`, `SaleItems`, `Waste`, `StockMovements`) and writes Firestore with the same ids, idempotently. Print a reconciliation report: counts and totals per tab vs what was written.
- Never run against production without my explicit go-ahead.

## Reports to show
- **Daily:** waste cost, % of sales, top reasons, top wasted items.
- **Weekly:** trend of waste % per day, items with repeated waste, staff-level view (for training, not blame; show it to managers only).
- **Inventory:** stock value (stock x cost), low stock list, movement history per item.

## Out of scope for now
Supplier ordering, purchase orders, recipe/ingredient costing, barcode scanning, photo evidence of waste, automatic forecasting. List them as future ideas at the end of the doc only.

## Working style
- Small steps. After each step tell me what to do (Sheet changes, redeploy, test).
- Start with the study report and your proposal for the new columns/tabs. Wait for my OK before changing `Code.gs`.
- Then build Phase 1 in this order: `Code.gs` + tests, `api.js`, then screens.
- Ask me before adding any library or paid service, and before anything is committed, deployed or written to production data.
- Keep `pos/config.js` out of git (it holds the key). Check `git status` before any commit.

## Questions to ask me first
1. Is waste logged per **product** (a whole latte) or per **ingredient** (200 ml milk)? Allurus inventory may track ingredients.
2. Which roles may log waste, reverse it, and see costs?
3. One outlet or several? Do I need per-outlet stock?
4. Do I want a daily waste limit alert (for example waste above 5% of sales)?
5. Should staff meals be tracked as waste or as a separate reason with its own report?

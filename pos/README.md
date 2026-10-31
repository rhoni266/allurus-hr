# Cafe POS (trial run)

A simple web till for one cafe. The backend is one Google Sheet plus a Google Apps Script web app: no Firebase and no paid plan. It is built so that moving to Supabase/Postgres later only means replacing `api.js` and the backend.

Status: **all 3 steps built** (backend, `api.js`, screens). Test checklist passed against the real Sheet on 31/10/2026.

## Running the till

- `config.js` is git-ignored. Copy `config.example.js` to `config.js` and fill in `API_URL` and `SECRET_KEY`.
- Run it locally: from this folder, `python -m http.server 5173`, then open http://127.0.0.1:5173. On a phone or tablet, use any static host that isn't public (see Security limits).
- **Screens:**
  - **Till:** menu, cart, notes, discount, Dine-in/Takeaway, table, pay, receipt, bar ticket.
  - **Today:** totals, payment methods, top items, sales list with reprint, void and CSV download.
  - **Products:** add, edit, deactivate.
- **If a save fails:** the cart stays and the payment stays open with "Not saved. Try again", and the retry reuses the same `sale_id`. "Check & close" asks the server whether the sale was saved before it lets the cart change.

## Setup (about 10 minutes)

1. **Create the Sheet.** Go to sheets.google.com and create a blank spreadsheet, for example "Cafe POS".
2. **Add the script.** In the Sheet, open Extensions > Apps Script. Delete what is in `Code.gs` and paste in all of [apps-script/Code.gs](apps-script/Code.gs). Save.
3. **Create the tabs.** In the script editor, pick `setup` in the function list and click Run. Allow the permissions Google asks for; they are your own account and your own Sheet. You now have the tabs `Products`, `Sales` and `SaleItems`, each with a header row.
4. **Optional: load the sample menu.** Run `loadSampleMenu`. This adds 10 items whose names end in "(sample)". Deactivate them (`active` = FALSE) before real trading.
5. **Set the secret key.** Open Project Settings (gear icon) > Script Properties > Add property:
   - `SECRET_KEY`: a long random value, at least 20 characters. You'll put the same value in `config.js`.
   - Optional: `SST_PERCENT` (default 0), `SERVICE_PERCENT` (default 0, charged on dine-in only), `LOW_STOCK` (default 5).
6. **Deploy as a web app.** Click Deploy > New deployment > type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click Deploy and copy the **Web app URL** (it ends in `/exec`). It goes into `config.js` in step 2.
7. **Install the daily backup.** Run `installBackupTrigger` once. Every night between 2 and 3 am it copies the whole Sheet into the Drive folder "Cafe POS backups" and keeps the newest 30 copies. You can run `backupSheet` by hand at any time.

**After you change `Code.gs`:** use Deploy > Manage deployments > edit (pencil) > Version: **New version**. That keeps the same URL. A "New deployment" gives you a new URL.

**Check it works:** open the Web app URL in a browser. You should see `{"ok":true,"data":{"service":"cafe-pos"}}`.

## How the backend behaves

- **All calls are POST.** The body is a JSON string sent as `text/plain`, so the browser doesn't send a CORS preflight. The body holds `{ key, action, data }`. GET only returns the health check, so the key never appears in a URL or in browser history.
- **Actions:** `getProducts`, `getDailySummary`, `getSale`, `createSale`, `voidSale`, `saveProduct`. Each returns `{ ok: true, data }` or `{ ok: false, error }`. A wrong key gets the generic "Not allowed".
- **Prices come from the server.** It ignores any price the till sends, looks up each price in `Products` and works out the totals itself. It rejects unknown or inactive products and any quantity that isn't a whole number above 0.
- **No double sales.** The till makes the `sale_id` before the first attempt. If the same `sale_id` arrives again, for example on a retry after a timeout, the server returns the sale it already saved and doesn't write it again. Every write runs under a script lock that waits up to 10 seconds.
- **Totals:**
  - discount (RM or %, capped at the subtotal)
  - service charge (dine-in only)
  - SST on (subtotal − discount + service)
  - cash only: the total is rounded to the nearest 5 sen (1–2 sen down, 3–4 sen up)

  Inside the code all money is whole sen. The Sheet shows RM with 2 decimals.
- **Stock:**
  - A sale reduces stock.
  - A blank `stock` means the item isn't tracked (good for drinks).
  - Low or negative stock gives a warning and never blocks the sale.
- **Receipt numbers:**
  - Format `R000001`, from the sale's row in `Sales`.
  - That works because rows are never deleted: a void only marks the sale.
  - **Don't delete or sort rows in `Sales`.** Use a filter view to look at the data.
- **Void:**
  - A reason is required.
  - It sets `status = void`, records the reason in `void_reason` and puts the stock back.
  - Voided sales are left out of the daily summary.
- **Card data:**
  - Nothing that looks like a card number (13–19 digits) is accepted in a note, table number or reason.
  - Card payments are only recorded as "card", taken on your separate terminal.
- **Dates:** `datetime` is stored as ISO text in Malaysia time, for example `2026-10-31T14:05:00+08:00`. The screens show DD/MM/YYYY.

**Two changes from your brief:**
- `Sales` has an extra last column, `void_reason`. The void reason had to be stored somewhere.
- Reads also use POST, so the key never appears in a URL.

## Tests

Run `node --test pos/tests/*.test.js` from the repo root. The tests run `Code.gs` against a fake Sheet and cover:
- totals and rounding
- double-submit, the same sale saved once
- a tampered price
- a card number in a note
- void
- a wrong key
- product edits

They don't replace the in-browser checklist, which comes after step 3.

## Waste and stock (added 31/10/2026)

**Updating an existing Sheet:**
1. Paste the new `Code.gs` and save.
2. Run `setup`. It:
   - adds `unit | cost | track_stock | kind` to the end of Products and fills `pcs`, `menu` and TRUE/FALSE on current rows
   - creates the `Waste` and `StockMovements` tabs
   - writes an opening-balance movement for every tracked item
3. Fill in `cost`.
4. Deploy > Manage deployments > edit > New version.
5. Optional: run `loadSampleIngredients` (milk, beans, cream marked "(sample)").

**Screens:**
- **Waste:** tap items, set quantities, pick a reason (Other needs a note), enter your name (remembered on this device), then Log waste. Today's list has Reverse.
- **Stock:** tracked items and ingredients, stock value, low stock in orange and negative in red, Stock in and Adjust.
- **Products:** unit, cost, kind (menu item or ingredient) and track stock.
- **Today:** a Waste card with cost, entries, % of sales, top reasons and staff meals.

**Rules:**
- **Cost:** cost comes from Products, never from the till. Blank cost logs the quantity and flags it as `cost_missing`.
- **Units:** cost is to the sen, so keep ingredients in kg or l (milk RM 8.00 per l), not g or ml. pcs and cup are whole numbers; g, ml, kg and l allow 3 decimals.
- **Staff meals** are logged like waste, but they are left out of waste cost and % and shown on their own line.
- **No retyping stock.** Stock is never typed over: Products only sets starting stock, and all later changes are Stock in or Adjust with a reason. Every change (sale, void, waste, reversal, stock in, adjustment) writes a `StockMovements` row whose `balance_after` equals the new stock. Don't edit the stock column in the Sheet by hand.
- **Never deleted.** A waste entry is never deleted. Reverse marks its lines `reversed` and adds `reversal` rows (`waste_id` `rev-<id>`, negative qty and cost, `reverses_waste_id` set) with the reason in `note`.
- **No duplicates.** `waste_id` (one per entry; `line_no` per row) and the Stock in/Adjust `movement_id` are made by the till, so a retry never counts twice.

## Inventory ledger: recipes, purchases, open containers, stocktakes (added 31/10/2026)

Details are in [INVENTORY-LEDGER-SPEC.md](INVENTORY-LEDGER-SPEC.md). Stock is calculated from the `StockMovements` ledger: opening + purchases − sales usage − dish waste − ingredient waste ± stocktake adjustments. The `stock` column is the server's running total of that ledger, and `getStockReport` / `getUsageReport` check that the two agree.

**Updating an existing Sheet:**
1. Paste the new `Code.gs` and save.
2. Run `setup`. It:
   - adds new columns to the end of Products, Sales, Waste and StockMovements
   - creates `Recipes`, `Purchases`, `OpenContainers` and `StockCounts`
   - fills `base_unit`, `max_open_containers` (1) and `track_open` (FALSE) on existing products

   Nothing existing moves.
3. Optional: add Script Property `COUNT_VARIANCE_PERCENT` (default 5).
4. Deploy > Manage deployments > edit > New version.
5. Optional: run `loadSampleIngredients`. It adds milk (ml), beans (g), caramel syrup (ml) and takeaway cups, with packs, reorder levels and open tracking.

**How it works:**
- **What a sale takes from stock.** A menu item takes **itself** if it tracks stock (a croissant), **plus** every recipe row (a paper bag, or milk and beans for a latte). An item with neither is sold with a "no recipe" warning. Recipes are per serving, in the ingredient's unit, and an item can't be in its own recipe.
- **Made.** A paid order counts as made. Voiding asks whether it was made:
  - **no** puts all the usage back
  - **yes** keeps the usage, moves it to dish waste and logs a Waste entry `void-<sale_id>` with reason `cancelled_after_made`
- **Two kinds of waste:**
  - Waste of a menu item is **dish waste**: it takes out what a sale would, at dish cost.
  - Waste of an ingredient is **ingredient waste**.
  - They are reported separately, and voids and discounts stay in their own reports.
- **Purchases:**
  - Received in packs. The server works out the quantity from the product's pack size and keeps a **weighted average cost** to 6 decimals per base unit.
  - A wrong delivery is reversed, never edited.
- **Open containers:**
  - Opening one needs a sealed pack in stock.
  - When the station already has `max_open_containers` open, the till shows who opened it, when and how much is left, and asks for a reason.
  - Recipe usage is put against the oldest open container first. **Finish** gives the variance (size − recipe usage). **Discard** logs the rest as ingredient waste.
- **Stocktake:**
  - The server works out the expected quantity, the variance and its value, then writes an adjustment so stock equals the count.
  - A line more than `COUNT_VARIANCE_PERCENT` off needs a reason.
- **Cost precision:** money is whole sen. Unit cost is RM to 6 decimals per base unit (syrup RM 0.053333 per ml), so ingredients can now be kept in g and ml. Existing kg/l ingredients keep their unit, because a unit can't change while stock is tracked.
- **Until the new screens are in:**
  - A void from the current till counts as "not made".
  - The Waste screen still offers all reasons; the server refuses ones that don't fit (for example "quality low" on milk).

**Size and speed:**
- A sale reads Products and Recipes once.
- With several hundred sales a day and recipes, `StockMovements` grows by about 1,000–2,000 rows a day. Once a month, export it to CSV, then use File > Make a copy to keep an archive. If calls start taking more than about 3 seconds, that is the signal to move to the database (see `docs/pos-waste-integration.md`).

## Security limits (please read)

- **The key is visible.** It sits in `config.js`, so anyone who opens the page can read it and then read or write your Sheet. It is only good enough for a short trial.
- **Keep the link private.** Don't share it publicly, and don't put real customer data (names, phone numbers) in the Sheet.
- **If the key leaks:** change `SECRET_KEY` in Script Properties and in `config.js`.
- **Before real use:** the move to Supabase should add real staff logins.

## Export to CSV for Supabase

1. For each tab: File > Download > Comma-separated values (.csv). This downloads the current tab only.
2. Import in this order: **Products**, then **Sales**, then **SaleItems**, because SaleItems points at both.
3. **Money columns are RM decimals** (`12.90`), not sen. Either import them as `numeric(10,2)`, or multiply by 100 into integer sen columns.
4. `datetime` is ISO text with `+08:00`; import it as `timestamptz`.
5. `stock` blank = not tracked, so map it to NULL.
6. Also export **Waste** and **StockMovements**, importing them after Products. In Waste, the key is (`waste_id`, `line_no`), and `cost` and `unit_cost` are RM decimals (blank = unknown). In StockMovements, `change_qty` and `balance_after` are numbers with up to 3 decimals.
6. The column names already match the planned tables. After the move, only `api.js` and the backend change.

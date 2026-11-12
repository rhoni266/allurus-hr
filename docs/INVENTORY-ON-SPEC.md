# Allurus: turn on Inventory (Stock & purchasing) for real companies, starting with Major Far East (Instructions for the coding agent)

## Owner's decision (12 Nov 2026)
- Major Far East needs an **inventory of items**: what they have, how many, where, and what to reorder.
- **Not linked to production yet.** The daily production entry (commission) stays separate. Linking production to stock is a later step.

## What exists (confirm in the code)
- `js/ops.js` + `js/ops-rules.js` already have **Stock & purchasing**:
  - items (code, name, unit, opening stock, reorder level, vendor, last price, sell price);
  - stock moves; purchase orders and receiving; stock levels (`O.stockLevels`); low-stock alerts; 30-day usage.
- Data buckets `ops.*` and their rules (`operations` area) exist in `cloud-map.js` and `firestore.rules`.
- **But it only appears when the workspace has `state.ops`, which only the demo seeds create** (`seed-majorfe.js` etc.). A real company has no way to switch it on. Major Far East's live sidebar has no Operations group. That's the gap.

## What to build

### 1. Switch it on per company
- **Settings → Modules** (new card, Owner or Settings area): **Inventory (Stock & purchasing)**: On/Off. Leave Production orders, Sales & delivery and Machines as separate switches, **off**, marked "coming later" if they aren't ready for real companies.
- Turning Inventory on creates an **empty** `ops` structure (`items`, `moves`, `pos` and the rest empty, with `seq` counters) in the company's cloud workspace, through the normal save path into the `ops.*` buckets. Turning it off hides the pages but **never deletes** data.
- For Major Far East: turn it on (I'll press the switch, or use `node scripts/set-addon.js inventory "Major Far East"` if you make it an add-on. Pick one, explain in the log).
- Check the **rules** let the Owner and the `operations` area read/write the `ops.*` buckets in a real company (not just the demo), and that staff without the area can't. Add rules tests.

### 2. Getting the items in (most important for a real company)
- **Import items from Excel/CSV** (reuse the import tool and its quote-stripping fix): Code, Name, Unit, Category, Location/shelf, Opening quantity, Reorder level, Cost price, Selling price, Supplier. Preview first, show errors per row, skip duplicates by Code, then import. Opening quantities go in as one "Opening stock" move dated the import day.
- A **template file** to download, with the columns and two example rows.
- **Add item** by hand (the existing item form), with **Category** and **Location** added if missing.

### 3. Day-to-day
- **Stock list:** search, filter by category/location/low stock, quantity on hand, reorder level, value at cost. Low stock in amber with the reorder suggestion.
- **Stock in / out / adjust** for one item: quantity, reason (Received, Used, Sold, Damaged, Count correction, Returned), note, date. Every change is a move: never edit the quantity directly. Who and when are recorded.
- **Stock count (stock take):** a sheet of all items (or one category/location), type the counted quantity, review the differences, post as "Count correction" moves with one note.
- **Purchase orders → Receive** (existing): keep. Receiving adds stock. If Bills exist for the same supplier, offer "Create bill from this PO" if it's easy. Otherwise list it as a later step.
- **Item history:** every move with running balance.
- **Reports:** stock on hand and value (CSV), moves for a date range (CSV), low stock list.

### 4. Who sees it
- `operations` area (Owner always). Staff without it see nothing of inventory.
- Ready-made role **"Store / warehouse"** if it isn't already there: Operations only. A storekeeper (e.g. "faizol ghazali – Storekeeper") can then be given just that.
- Phone: admins with the area get Inventory in the launcher. The stock list works at 390px (cards instead of a wide table) with large ± buttons for stock in/out.

### 5. Not now
- No link to the daily production entry (owner's decision). Production orders, recipes/BOM, sales & delivery, machines stay off for real companies.
- No POS stock link.

## Tests
- Unit: stock levels from moves (opening, in, out, adjust, count correction); value at cost; low-stock rule; import parsing (quoted cells, duplicates, bad numbers).
- Rules: a real (non-demo) company can read/write `ops.*` with the area, not without it; staff can't.
- **Cloud mode on the emulator, not only the demo** (lesson from v3.48):
  - switch on;
  - import 10 items;
  - stock in/out;
  - a count with differences;
  - a PO received;
  - CSV export;
  - switch off hides the pages and keeps the data.
- `npm test` and `npm run test:rules` pass.

## Working style
Follow `RUN-ALL-SPECS.md`. Branch `claude/inventory-on`. Back up the live rules if they change; deploy order rules, then hosting. Tell me the switch-on step for Major Far East and the template file location.

## Update 12 Nov 2026, 13:41: go live now, keep it ready for COGS later
- **Priority: ship it.** Finish what's already on `claude/inventory-on`, run the tests, merge, and give me the deploy commands (rules, then hosting) plus the switch-on step for Major Far East. Anything in this spec that isn't done yet (e.g. "Create bill from this PO") goes in the log as a later step. Don't hold the release for it.
- **COGS comes later** (the owner will link production cost to stock when he has the figures). Small thing to do **now** so the history is usable then, without having to rebuild it:
  - every stock move that **adds** stock records `unitCost` (RM per unit): "Opening stock" from the item's cost price, "Received" from the PO line price, manual stock-in from an optional "Cost per unit" field (default the item's cost price);
  - stock-out moves don't need a cost yet. Don't build a costing method (average/FIFO) now. Just store the figure;
  - the moves CSV gets a "Unit cost" column.
- Still no link to the daily production entry.

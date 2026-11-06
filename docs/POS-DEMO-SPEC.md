# Allurus POS: Public Demo on allurus.my (Instructions for the coding agent)

## Goal
Put the **latest cafe POS** (the `pos/` folder, which the owner runs locally at `http://127.0.0.1:5173`) on the Allurus website as a **demo anyone can try from a web link**, with no sign-in and no setup:

- **Link:** `https://allurus.my/demo/pos`, plus "Try the POS demo" buttons on the website.
- Opens the full till (Checkout, Waste, Stock, Today, Products) filled with a sample cafe.
- Everything runs **in the visitor's browser only**. Nothing goes to Google Sheets or Firebase, and nothing is shared between visitors.
- Same Allurus look as the rest of the site (`DESIGN-STANDARD-SPEC.md`: teal and champagne, Inter; no lime).

## What exists today (owner's review, 6 Nov 2026; confirm in the code)
- `pos/` is a static app: `index.html`, `app.js`, `api.js`, `style.css`, `config.js` (git-ignored), fonts and tests. The backend is Google Apps Script plus a Google Sheet (`apps-script/Code.gs`). `api.js` posts `{ key, action, data }` to `API_URL` with `SECRET_KEY` from `config.js`.
- Actions the app calls: `getProducts`, `getDailySummary`, `getSale`, `createSale`, `voidSale`, `saveProduct`, `stockAdjust`, `stockCount`, `getWaste`, `logWaste`, `reverseWaste`, `getPurchases`, `receivePurchase`, `reversePurchase`, `getRecipes`, `saveRecipe`, `getContainers`, `openContainer`, `finishContainer`, `discardContainer`, plus `newSaleId`.
- `firebase.json` ignores `pos/**`, so `allurus.my/pos/` is "Page Not Found" today. Keep the real till off the public site: `config.js` holds the secret key, and anyone who could read it could write to the Sheet.
- On the owner's laptop on 6 Nov, `127.0.0.1:5173` showed **"Could not load the menu"** (the Apps Script call came back but the menu did not load). Check this separately: wrong key, an old deployment, or a `Code.gs` change that was not redeployed as a new version. Note what you find in the log. It does not block the demo.
- The HR app has a **different POS module** (`js/pos.js`, `pos-rules.js`, `functions/pos-core.js`, area `pos`). The owner says the `pos/` cafe till is the latest. Demo the `pos/` till. Don't delete the other one. In the log, write 5 lines on how the two differ and which one new clients should get.

## What to build

### 1. A demo backend that runs in the browser
- Add `pos/api-demo.js` with **the same functions and the same `{ ok, data }` / `{ ok, error }` answers** as `api.js`, for every action above.
- It must behave like `Code.gs`. Move the money and stock logic (prices from products, sen rounding, SST and service charge, discounts, cash rounding, receipt numbers, the same `sale_id` saved only once, void, stock movement, recipes and dish cost, waste, purchases, containers, low stock) into **one shared pure file** used by both `Code.gs` and the demo. If Apps Script makes sharing hard, copy it at build time with a script, plus a test that both copies are identical. Don't write the logic twice by hand.
- Store demo data in `localStorage` under `allurus_pos_demo_v1`, with a `try/catch` and an in-memory fallback (private windows).
- Add a small delay (150 to 300 ms) so it feels like a real till, and allow a "simulate offline" switch only if the app already has offline handling to show.

### 2. Demo mode switch
- Demo mode is on when the page is opened at `/demo/pos` (or `/pos/?demo=1`), **or** when there is no `config.js`.
- In demo mode the page **never loads `config.js`** and never calls `script.google.com`. Add a Content-Security-Policy for the demo route with `connect-src 'self'` so it cannot by accident.
- `api.js` stays as it is for real cafes. The app picks `PosApi` or the demo API at start-up, in one place.

### 3. Sample cafe ("Kopi Demo")
Fictional cafe, fictional staff names, prices in RM, Asia/Kuala_Lumpur time:
- 20 to 25 menu items in 4 to 5 categories (coffee, tea, food, desserts, add-ons), some with recipes so dish cost shows;
- stock items with units, 3 of them low stock, one open container;
- **past sales for today and the last 7 days**, so Today, top items and payment methods already show numbers;
- a few waste entries and one received purchase;
- SST 0% by default, with service charge 10% on dine-in as an example.
Keep the seed in `pos/demo/seed.js`, made from a fixed random seed so it is the same for every visitor. Dates move with today's date.

### 4. Demo screen details
- A thin banner across the top: "Demo: everything stays in this browser. Nothing is real." with **Reset demo** (back to the sample cafe, after a confirm) and **Get Allurus** (opens the website contact or sign-up page in the same tab).
- Receipts and bar tickets print with "DEMO – BUKAN RESIT SEBENAR / NOT A REAL RECEIPT".
- Payments are simulated: cash with change, card and QR just mark the sale paid. No real payment screen or card fields, ever.
- The business name shows as "Kopi Demo". The cashier shows as a demo name.
- Works on desktop, tablet (1024×768, landscape and portrait) and phone (390px): big tap targets, no horizontal scroll.
- English and Bahasa Malaysia labels, matching how the till already labels things. Add a language switch only if the till already has one.

### 5. Hosting on allurus.my
- Serve the `pos/` app files on Firebase Hosting **without `config.js`, `apps-script/`, `tests/`, `*.md` or `tools/`**. Change the `pos/**` ignore in `firebase.json` to only those exclusions, or copy the needed files into a `demo/pos/` folder at deploy time. Choose the simpler one and write the choice in the log.
- Clean URL: `/demo/pos` must load the till with working asset paths. Use absolute paths or a `<base href>`, and a rewrite or redirect in `firebase.json`.
- Add a test (in `npm test`) that fails if a deployed file contains `SECRET_KEY` with a value, a `script.google.com/macros` URL, or a file named `config.js` under the public demo path.
- Root `sw.js`: make sure it does not cache the demo with old versions. Bump the cache version.
- Page title "Allurus POS demo", the Allurus favicon, and a description and preview image (`og-image`) for when the link is shared on WhatsApp.

### 6. Links on the website
- Landing page (`index.html`, `site/js/...`): a **"Try the POS demo"** button in the POS / F&B part (industries, module showcase, hero switcher, wherever POS is shown) and in the main nav or footer under "Demo". Open it in a new tab.
- Wording in `site/js/i18n.js` in English and Bahasa Malaysia.
- If the HR app demo picker (`?demo=...`) lists demo companies, add a "Cafe POS" card that links to `/demo/pos`.

### 7. Look
Apply `DESIGN-STANDARD-SPEC.md` to the POS screens in this task (teal and champagne on the Allurus dark theme, Inter self-hosted, the Allurus logo; remove lime and Manrope). When the design-standard step runs later, POS is already done.

## Tests (run before saying it's done)
- `pos/tests` pass. Add tests that run the **same cases against `Code.gs` logic and the demo API**: totals with discount, SST and service charge, rounding, the same `sale_id` twice, void, stock after a sale, recipe usage, waste and reverse, purchase receive and reverse.
- Demo opens at `/demo/pos` in the PR preview with **no network calls except to allurus.my** (check the network list).
- Sell 3 items as dine-in with a discount, pay cash, print the receipt, void it, log waste, adjust stock, add a product. Then reload: the data is still there. Reset demo: back to the sample cafe.
- Two different browsers show separate data.
- Private window works (in-memory fallback).
- The deployed files have no secret key, no Apps Script URL, no `config.js` (new test).
- Screens at 1440px, 1024px and 390px look right. Take screenshots for the log.
- The "Try the POS demo" buttons work in English and BM.
- `npm test` passes.

## Working style
Follow `RUN-ALL-SPECS.md` (full permission, hard stops, safety steps, log). One pull request. Write the preview link in `docs/AUTOPILOT-LOG.md` so the owner can try the demo before it goes live.

# Cafe POS design system

**What it is:** the Allurus dark theme (teal + champagne, DESIGN-STANDARD-SPEC.md) over a soft gradient, a floating pill nav, a floating icon rail and tinted cards. It's built for touchscreens.

**Where it lives:**
- [style.css](../style.css): the tokens, then the components.
- [index.html](../index.html): the shell.
- `app.js`: small helpers that put the classes on (`kpi()`, `svg()`, `tint()`, `announce()`).

**Constraints:** no framework, no build step and no icon or chart library. Icons are inline SVG, and the charts are CSS.

## Tokens (`:root` in style.css)

| Token | Value | Use |
|---|---|---|
| `--bg-0` | `#0e0f12` Obsidian | page base, under the fixed gradient (`body::before`) |
| `--surface` / `-2` / `-3` | white at 5% / 8% / 12% | glass card / raised, hover / pressed |
| `--border` / `-2` | white at 8% / 16% | hairlines / inputs and ghost buttons |
| `--text`, `--text-muted` | `#f5f5f7`, white at 72% | body / labels |
| `--accent`, `--accent-hover`, `--accent-ink` | `#2bb3a3` Teal, `#5fd0c2`, `#0e0f12` | Pay, primary, active tab, success, change due |
| `--gold` | `#e8cc93` Champagne | highlights; not used as a background (fails contrast with white text) |
| `--ok` | `#4cc98a` | reserved for a success state (not currently drawn anywhere) |
| `--danger` | `#ff7a6b` | void, reverse, negative stock, errors |
| `--warn` | `#f2b35b` | low stock, use-by soon, missing cost |
| `--info` | `#6c9dff` | third chart series |
| `--tint-teal/deep-teal/slate/obsidian` | `#147d73 / #0b5f59 / #4b5160 / #262a31` | product tiles by category; stat cards |
| `--r-card / --r-tile / --r-pill` | 18 / 18 / 999px | cards and tiles / buttons, inputs, chips |
| `--tap / --tap-xl` | 48 / 56px | minimum tap target / qty ± and sheet actions; Pay is 64px |
| `--glass` | `blur(20px) saturate(130%)` | **only** on the shell, the cart, cards and sheets, never on tiles |
| `--ease` | `cubic-bezier(.2,.8,.2,1)` | all motion, 120–200ms |

**Font:** `Inter`, bundled at `fonts/inter-latin-wght-normal.woff2` (variable font, weights 400–700, Latin, 47 KB, OFL 1.1 in `fonts/OFL.txt`, from Google Fonts), so it works offline — same font family as the website and HR app, per DESIGN-STANDARD-SPEC.md, but its own file so POS stays usable with no network at all. Money uses `tabular-nums`.

## Shell
- **Top bar** `.top`: a floating pill holding the logo tile, the business name and the `.pillnav` tabs. A sliding teal `.nav-thumb` moves to the active tab. On the right are the online chip `#netChip` and the staff chip `#staffChip` (name on this device and the clock).
- **Icon rail** `.rail`: a floating capsule with the same 5 screens plus a **Reduce effects** toggle. That toggle adds `.reduce-effects` to `<html>`, which turns off blur, shadows and animation for slow tablets, and is remembered on the device. The rail hides below 1000px.
- **Offline strip** `#offline`: coral glass, shown when the browser reports offline.
- **Page header** `.page-head`: a two-line `h1` (second line muted) followed by `.kpis`, which are `kpi(icon, value, caption, 'good'|'alert')` chips. Each screen fills its own: `sumKpis`, `wasteKpis`, `stockKpis`, `prodKpis`. Checkout has no header (full-bleed).

## Components (class → use)
- **Buttons** `button` / `.primary` (teal) / `.ghost` / `.danger`. On press they scale to .97, and colour changes take under 100ms. Focus shows a 2px teal outline.
- **Pills and segmented controls:**
  - `.chips` holds the category filters; the active one is teal.
  - `.seg` is a segmented control (Takeaway or Dine-in).
  - `.methods` holds the payment methods in the sheet.
  - `.reasons` and `.pct` are chip grids in sheets.
- **Product tile** `.item.t0–t3`:
  - The tint follows the order categories first appear in. Name (2-line clamp), price and stock hint.
  - `.out` dims the tile and adds an "Out" badge; it stays tappable, and the server warns.
  - `.lowdot` marks low stock. `.ingr` (dashed border) marks an ingredient. `.pop` plays on add.
- **Cart** `.cart`:
  - Glass and sticky. Only `.lines` scrolls, so the total and Pay never leave the screen.
  - Each line uses `.qty` 56px round steppers. The total `.grand` is 32px, and `#pay` is 64px teal showing the amount.
  - Below 1000px, a floating `.cart-bar` ("3 items · RM 24.50 · View cart") jumps to the cart.
- **Sheets** `.modal > .sheet`: a centred glass sheet that becomes a bottom sheet under 768px. Destructive actions confirm with a `.danger` button (clear order, void, reverse, discard).
- **Numpad** `.numpad`: 12 keys, 60px tall, feeding `#recv` in the cash payment.
- **Paid state** `.done-check`: a teal check and "Paid RM x" above the receipt.
- **Tables** `.scroll > table`: glass strip rows with rounded ends. `tr.void` is struck through, `tr.low`/`.near` are amber, and `tr.neg`/`.past` are coral. Status is always text plus colour.
- **Stat cards** `.cards > div`: tinted teal, deep teal, slate, obsidian in turn, with a highlight; 32px numbers.
- **Charts:**
  - `.bars` shows sales by hour as teal columns over a faint track.
  - `.hbars` shows the payment mix in teal, coral, blue and amber.
  - Both are drawn from data Today already loads.
- **Forms** `.form-grid`, `.line-card`, `.choice` (big radio rows), and `.qtyin` for quantity fields.
- **Toast** `.toast`, and the live region `#live`, which announces "Item added" / "Paid" to screen readers.

## Keys
- `F1` opens Checkout.
- `F2` opens Pay when the cart has items.
- `/` focuses the search.
- `Esc` closes a sheet, except while a payment is saving or unresolved.

## Responsive
- **≥1200px:** cart 400px.
- **1000–1199px:** cart 340px and smaller tiles. Checked at 1366 and 1024 wide.
- **<1000px:** no rail; the nav shows icons only; the cart stacks under the grid, with the floating total bar.
- **<768px:** the top bar spans the full width and the tabs fill a row; sheets slide up from the bottom; tiles are 2 across. Checked at 390 wide.
- **Print:** the gradient and shell are hidden, and the receipt prints black on white at 72mm.

## Public demo (`/demo/pos`)
See `../../docs/POS-DEMO-SPEC.md`. In demo mode `demo/demo-ui.js` adds a sticky banner above `.top` (Reset demo,
Get Allurus) and `app.js`'s `demoWatermark()` prints "DEMO – BUKAN RESIT SEBENAR / NOT A REAL RECEIPT" on every
receipt and bar ticket. No other screen changes: the demo runs the same HTML/CSS/JS as a real till, against
`shared/pos-core.js` through a localStorage `Host` (`demo/local-host.js`) instead of the Sheet.

## Not done (left out on purpose)
- **No logic changed.** API calls, IDs and the data flow are as before.
- **Screens the brief names that don't exist in this POS:** Orders board, Customers, Login/PIN, Shifts and cash drawer, Hold/resume, the customer picker, barcode scanning, the daily-target donut. Each would be a new feature, not a restyle.
- **No light theme,** because the app didn't have one.

# Allurus: macOS-style grid interface (Instructions for the coding agent)

## Goal
Restyle the Allurus web app (HR app `/app`, POS `/pos`, superadmin, the small pages) to look and feel like a **macOS app**:
- a window with a translucent sidebar;
- a toolbar with segmented controls and a rounded search field;
- a **grid of widget cards** on the home screen;
- a **Launchpad-style grid** of every module;
- list + inspector screens.

Keep the Allurus brand from `DESIGN-STANDARD-SPEC.md`: teal #0F766E, deep teal #0B5F59, champagne #D9B66F, obsidian #16181D, slate #5F636B, mist #F5F5F7, Inter font. **Look only: no feature, data, rules or text-meaning changes.**

**Reference mockup (owner's Design canvas, 9 Nov 2026): "Allurus macOS-style UI"**, three artboards:
1. **Home: widget grid.** Sidebar with sections (Workspace, People, Business, Admin); toolbar (greeting, Today/Week/Month segmented control, search, primary button); a 4-column grid of cards (Staff, Attendance today with a stacked bar, Waiting for you with Approve/Decline, Next payroll, POS sales today, Claims this month, This week strip, Quick actions).
2. **All apps: launcher grid.** Dark backdrop, search pill, 6-column grid of rounded-square module icons with labels and red count badges, page dots, a dock of favourites.
3. **Employees: list + inspector.** Toolbar (back, title with count, filter segmented control, search, Add), table with avatar + name + role, selected row in teal, right-hand inspector (avatar, status chip, Profile/Payslips/Access buttons, facts list with masked IC and bank, leave balance bar).
The owner will share the canvas link with you, or ask the owner for screenshots. Match it closely. Numbers in it are demo data.

This **replaces the "Shape, spacing, motion" and "Components" parts of `DESIGN-STANDARD-SPEC.md`**. Its colours, font, tokens, token file, contrast and style-check rules still apply. If the design standard is not done yet, do both in one branch: `claude/design-standard`.

## The macOS design language (what to build)

### Window and layout
- App shell = one "window": radius 14px, 1px border `rgba(22,24,29,.10)`, large soft shadow, on a muted desktop background (light: #DCE3E2; dark: #0E0F12 with a subtle teal tint). On phones (< 768px) the window fills the screen: no outer margin, no radius, and the sidebar becomes a bottom tab bar plus a "More" sheet.
- Window controls (three dots) only as decoration in the sidebar header on desktop, `aria-hidden`. They do nothing. Leave them out on phones and in POS.
- **Sidebar** 220–240px: translucent (`rgba(243,244,246,.82)` + `backdrop-filter: blur(30px)`, solid fallback), company switcher at top, section headings 11px semibold slate, items 30px high, 16px line icons, **selected item = teal fill + white text**, small count badges (pill). Collapsible to icons only.
- **Toolbar** under the window top: title (and subtitle), **segmented controls** (grey track, white selected pill), rounded search field (`⌘K` / `Ctrl K` opens a command search), one primary teal button. Height 52–56px, wraps on narrow screens.
- **Inspector** (right panel, 300–360px) for list screens: Employees, Leave, Claims, Invoices, Stock items, POS products. Opens on row select; on phones it becomes a full-screen sheet.

### Grid system
- Content uses CSS grid: `repeat(4, minmax(0,1fr))` on desktop ≥ 1280px, 2 columns from 768px, 1 column below. Gap 16px, page padding 20px.
- **Widgets**: white cards, radius 16px, 1px border `rgba(22,24,29,.07)`, tiny shadow, padding 18px. Sizes: 1×1, 2×1 (`grid-column: span 2`), 1×2 (`grid-row: span 2`), 2×2. Each widget: small slate label, one big number (tabular figures), one line of context, an optional mini chart or action.
- **Home** (per role, following the role-access areas): Owner/HR see Staff, Attendance, Waiting for you, Payroll, Claims, This week, Quick actions. Finance sees Finance and Claims widgets. POS managers see POS sales. Employees see their own: leave balance, next payslip, check-in, my requests. **No widget shows data the person's areas don't allow.**
- **Edit widgets**: "Edit" in the toolbar lets the person hide, show and reorder widgets (drag, or move up/down buttons for keyboard). Saved per user, per device (`localStorage`, try/catch).

### Launcher ("All apps")
- Reached from a grid icon in the sidebar header and from `⌘K`/`Ctrl K`. Full-window overlay with a dark translucent backdrop.
- 6-column grid (4 on tablet, 3 on phone) of 84px rounded-square icons (radius ≈ 22.5%), label under each, red count badge for items waiting.
- Icon tiles use **brand colours only**: teal, deep teal, champagne (with an obsidian glyph), obsidian, slate, mist. Glyphs are our own line icons. **Don't use Apple's icons, SF Symbols, the Apple logo or Apple app names**, and no lime.
- Only modules the person can open (`can(area)` and company features) appear.
- Search filters the grid. Arrow keys move, Enter opens, Esc closes.
- A **dock** of up to 6 favourites at the bottom (the person can pin and unpin). On phones it is the bottom tab bar.

### Controls (same everywhere)
- Buttons: primary teal fill, secondary white with border, plain (text only), destructive red. Height 30px desktop, 44px phone. Radius 8px.
- Segmented control, switch (teal when on), checkbox, radio, popup menu (select), stepper, date picker, search field, text field: all in the macOS proportions shown in the mockup.
- Tables: header 12px slate, rows 44px, no zebra, hover tint, **selected row teal with white text**, tabular numbers, sticky header, horizontal scroll box on small screens.
- Sheets (dialogs) slide down from the top of the window on desktop, bottom sheets on phone. Toasts small and rounded at the bottom.
- Context menu on right-click / long-press for row actions: Open, Edit, Approve/Decline where relevant.
- Focus ring: 3px teal at 40%. Every control reachable by keyboard.

### Type and colour
- Inter, with `system-ui, -apple-system` as fallbacks. On a Mac that shows Apple's system font legally. **Don't bundle or link SF Pro** (its licence only allows use on Apple platforms).
- Sizes: title 17px bold, body 13px, labels 12px, small 11px (only for headings or badges, contrast-checked). Big numbers 22–34px bold, letter-spacing -0.02em.
- Status colours from the design standard (ok #17804A, warn #A05F00, bad #B3261E, info #2F6AD0), each with a soft background chip.
- **Dark mode**: same layout, obsidian window, translucent dark sidebar, teal tint #2BB3A3 for selection. It follows the system setting, with a manual switch in Settings.

### Motion
- 150–220ms ease-out. Launcher fades and scales from 0.98. Sheets slide. Respect `prefers-reduced-motion` (no movement, only fades).

## POS
POS keeps its own big-touch layout (product grid, ticket on the right). Apply the same window style, segmented controls, teal selection, card radius and colours. Tap targets stay at least 56px. Dark is still the POS default.

## Build steps
1. Study `css/styles.css`, `css/glass.css`, `pos/style.css` and the render functions in `js/app.js` that build the shell (sidebar, top bar, page header) and the dashboard. Write the plan in `docs/AUTOPILOT-LOG.md` (owner's permission in `RUN-ALL-SPECS.md`).
2. Tokens first (`/brand/tokens.css`): add `--radius-window: 14px`, `--radius-card: 16px`, `--radius-control: 8px`, `--sidebar-bg`, `--window-bg`, `--desktop-bg`, `--selection`, `--on-selection`, and the shadow tokens. Light and dark.
3. **App shell**: window, sidebar (sections from the existing nav, filtered by `can()`), toolbar component (title, segmented control, search, primary action). One shared function, used by every page.
4. **Home widget grid**: build widgets from the data each page already has. Don't add new data queries if the current state already has the numbers. Respect areas.
5. **Launcher + dock + ⌘K search.**
6. **List + inspector** for Employees first, then Leave, Claims, Invoices, Stock, POS products.
7. Controls restyle (buttons, fields, tables, sheets, toasts) through shared CSS classes. No per-page one-off styles.
8. POS, superadmin and the small pages (join, sign-in, activate, privacy, terms) get the same tokens and controls. The sign-in page = one centred window card on the desktop background.
9. Bump the `sw.js` cache version and `?v=` numbers.

## Tests and checks
- `npm test` passes, including the design-standard style check (no lime, no Manrope, no raw colours outside tokens).
- Screenshots, light and dark, at 1440px, 1024px and 390px: Home, All apps, Employees (with inspector), Leave, Payroll, Settings → Team access, POS till, sign-in. Put them side by side with the mockup in the PR description.
- Keyboard: Tab through the sidebar, toolbar and a table; open and close the launcher with ⌘K/Ctrl K and Esc; arrow keys in the launcher; focus ring visible everywhere.
- Contrast: every text/background pair at least 4.5:1, including white on the teal selection and slate labels on the sidebar.
- A Finance-only user's Home shows no HR widgets, and their launcher shows no HR modules. An Employee sees only their own widgets.
- Nothing else changes: sign-in, add employee, leave request, payroll run, POS sale all still work in the preview.

## Working style
Follow `RUN-ALL-SPECS.md` (full permission, hard stops, safety steps, log). One branch, small commits, pull request with screenshots. Merge after `npm test` passes and the preview looks like the mockup.

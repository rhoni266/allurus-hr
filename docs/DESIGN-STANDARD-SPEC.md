# Allurus: One Design Standard for Every Website, App and Branch (Instructions for the coding agent)

## Goal
Every Allurus screen must look like one product: same colours, same font, same logo, same buttons, cards, forms, tables and spacing. This covers the website, the HR app, POS, superadmin, every small page, emails, PDFs and every git branch. Change **only the look**. Do not change features, data, rules, text meaning or behaviour.

## What I found (owner's review, 5 Nov 2026; confirm by reading the code)
Today there are **three different looks and three fonts**:

| Part | File(s) | Font | Main accent | Look |
|---|---|---|---|---|
| Website `allurus.my` | `site/css/tokens.css`, `site/css/site.css` | Inter (Google Fonts) | Teal #0F766E + Champagne #D9B66F | Light glass. **Follows the brand kit.** |
| Superadmin | `site/css/superadmin.css` | System font (SF) + Inter loaded | Teal | Light, own token names |
| HR app `/app` | `css/styles.css` **then** `css/glass.css` | `glass.css` switches to **Manrope** | `glass.css` adds **lime #C6F432** (logo square, avatar, first KPI card, "Hired" column, drag outline) and olive/brick/blue tints | Glass, dark by default per its comment |
| Small pages: `join`, `signup`, `activate`, `privacy`, `terms`, `auth/action` | `css/styles.css` only (versions v3.13 to v3.15) | System font | Teal | Different from the app after sign-in, because they don't load `glass.css` |
| POS `/pos` | `pos/style.css` | Manrope (bundled) | **Lime #C6F432** | Dark glass. **Not on brand at all.** |
| `design-system.html` | `css/styles.css?v=2.2` | System | Teal | Out of date |
| `brand.html` | inline | System (SF) | Teal + Champagne | Brand kit page |

Also: each part has its own token names (`--brand` / `--accent` / `--teal`, `--fg` / `--text`, `--line` / `--border`) and its own `theme-color`.

## The standard (source of truth)
Use the **Allurus brand kit** (`brand.html`, `site/css/tokens.css`). **Lime (#C6F432) is removed everywhere.**

### Colours
| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand` | #0F766E Allurus Teal | #2BB3A3 (teal tint for dark) | Primary buttons, links, active nav, focus |
| `--brand-hover` | #0B5F59 Deep Teal | #5FD0C2 | Hover, pressed |
| `--brand-soft` | rgba(15,118,110,.10) | rgba(43,179,163,.16) | Selected rows, chips |
| `--on-brand` | #FFFFFF | #0E0F12 | Text on brand colour |
| `--gold` | #D9B66F Champagne (lines, big figures, logo arc) | #E8CC93 | Highlights, money totals, premium badge |
| `--gold-text` | #85662C (small text on white, AA) | #E8CC93 | Small gold text |
| `--fg` | #16181D Obsidian | #F5F5F7 | Main text |
| `--fg-2` | #5F636B Slate | rgba(245,245,247,.72) | Secondary text |
| `--fg-3` | #8A8F98 (3.3:1, large text and icons only) | rgba(245,245,247,.56) | Hints, placeholders |
| `--bg` | #F5F5F7 Mist | #0E0F12 | Page background |
| `--surface` | #FFFFFF (or white glass .72) | #16181D / rgba(255,255,255,.05) | Cards |
| `--surface-2` | #F9F9FB | #1B1E24 | Inputs, nested panels |
| `--line` | rgba(22,24,29,.08) | rgba(255,255,255,.08) | Borders |
| `--line-strong` | rgba(22,24,29,.14) | rgba(255,255,255,.16) | Input borders |
| `--ok` | #17804A (today's #1D8A50 is only 4.4:1 on white) | #4CC98A | Approved, paid, present |
| `--warn` | #A05F00 (today's #B26B00 is only 4.2:1 on white) | #F2B35B | Pending, late |
| `--bad` | #B3261E | #FF7A6B | Rejected, error, delete |
| `--info` | #2F6AD0 | #6C9DFF | Info notices |
Each status colour also has a `-soft` background (10 to 16% alpha). Every text/background pair must pass **WCAG AA (4.5:1 normal text, 3:1 large text and icons)**; check them with a script and list the results.

**Card tints** (kanban columns, dashboard tiles, POS category tiles): replace lime/olive/brick/blue with **Teal, Deep Teal, Slate, Champagne, Obsidian**. White text must pass 4.5:1 on each (Champagne uses Obsidian text).

**Charts:** series order Teal, Champagne, Slate, Deep Teal, Info blue, then soft tints. No lime, no coral line.

### Font
- **Inter** for everything (website already uses it). Remove Manrope and system-font-only stacks.
- **Self-host** Inter (woff2, variable or 400/500/600/700) in one place, for example `/brand/fonts/`, with its licence file. Do not load Google Fonts on the app or POS (POS must work offline; fewer outside calls also helps privacy). The website can move to the same self-hosted file.
- Fallback stack: `"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- Numbers in tables, payroll and POS totals: `font-variant-numeric: tabular-nums`.

### Shape, spacing, motion
- Radius: cards 18px, small controls 12px, pills 999px. (Pick one set; today there are 14/18/20/24/26/28.) Website hero sections may keep larger radii only if they use the same tokens.
- Spacing scale 4/8/12/16/20/24/32/48. Control height 40px (app), tap targets at least 48px (POS 56px for the main buttons).
- One shadow pair (`--shadow`, `--shadow-lg`), one easing and duration. Respect `prefers-reduced-motion`.
- Glass (blur) is allowed on top bars, nav and dialogs only, with a solid fallback when `backdrop-filter` is not supported. Body cards are solid so text stays readable.

### Logo
- Use only `site/assets/logo.svg` and `logo-mark.svg` (teal square, white A, champagne arc). Remove the lime `.logo-sq` square and any other made-up marks.
- Same favicon, apple-touch icon, manifest icons and `theme-color` (#F5F5F7 light, #0E0F12 dark) on every page.
- Wordmark: "ALLURUS", weight 600, wide letter-spacing, as in the logo file. Product names under it in Slate: "HR", "POS", "Finance".

### Light and dark
- Both themes use the same tokens above. **Light is the default** for the website, HR app and small pages. POS may default to **dark** for counter use, but it must be the Allurus dark (Obsidian + teal tint + champagne), the same dark as the HR app.
- The theme switch (`ux-theme` in the app) keeps working; remember the choice per device.

### Components (same look everywhere)
Buttons (primary teal, secondary outline, ghost, danger), inputs/selects/date pickers, checkboxes and switches, cards, tables (header style, zebra off, row hover, tabular numbers), badges/status chips, tabs, sidebar/top nav, icon rail, dialogs, toasts, empty states, loading skeletons, avatars (teal-soft background, teal initials; no lime), progress bars (teal), pagination, file upload, the sign-in and join screens.

## How to build it
1. **One token file:** create `/brand/tokens.css` (colours, font, radius, spacing, shadow, light and dark) and `/brand/fonts/`. Every surface loads it first: website, `app.html`, all small pages, `superadmin.html`, `pos/index.html`, `design-system.html`, `brand.html`.
2. **Rename tokens to one set** (`--brand`, `--fg`, `--line`, ...). Map the old names to the new ones for one release so nothing breaks, then remove the old names.
3. **No raw colours** in component CSS or inline styles in JS (`app.js`, `pos/app.js`, `site/js/...`): only `var(--token)`. Find every hard-coded hex/rgb, including in SVG charts and templates, and replace it.
4. **HR app:** merge `glass.css` into the standard (keep its layout ideas: pill nav, icon rail, rounded cards) and remove lime, Manrope and off-brand tints. Small pages (join, signup, activate, privacy, terms, auth action) must look the same as the app sign-in screen.
5. **POS:** restyle `pos/style.css` onto the tokens. Keep big tap targets and offline fonts. Check the till, order screen, payment, receipts preview, reports and settings.
6. **Superadmin:** move onto the same tokens and components.
7. **Outside the browser:** emails (invites, notifications, password reset; plain HTML with inline colours from the tokens), PDFs (payslips, EA forms, letters, invoices, reports), POS printed receipts (black only, logo optional), the WhatsApp/link preview image (`og-image.png`), and the website screenshots in `site/assets/shots/`. **Retake** the screenshots after the change (they show the old look).
8. **Update** `design-system.html` and `docs/design-system.md` (HR and POS) to show the final tokens and every component in light and dark. This is the page I will check.
9. Bump the `sw.js` cache version and all `?v=` numbers so phones don't keep the old look.

## All branches (important)
Open branches today (check with `git branch -a` and `git log main..<branch>`): `claude/bulk-ic-invite`, `claude/open-join`, `claude/join-key`, `claude/support-access`, `claude/one-domain`, `claude/ic-staff-login`, `claude/landing-screenshots`, `claude/firebase-hosting`.

**Do not restyle each branch separately.** That makes the same change eight times and causes merge conflicts.
1. First give me a table: branch, what it holds, already in `main` or not, last commit date, and whether it touches CSS or UI.
2. With my OK, merge the finished branches into `main` (each by pull request, tests passing) and close the old ones that are already merged or no longer needed. Do not delete any branch with unmerged work without asking me.
3. Then make **one** branch `claude/design-standard` from the latest `main` and do all the work there.
4. After it is merged, **rebase every branch that is still open onto `main`** and fix any style conflicts, so all branches use the same standard.
5. Add a **style check to `npm test`** so no future branch can drift. It should fail when:
   - a hex/rgb colour appears outside `/brand/tokens.css` (allow a short list of exceptions such as emails and PDFs, which use generated values from the tokens);
   - `#C6F432` / lime, Manrope, or any font other than Inter appears;
   - a page does not load `/brand/tokens.css`;
   - any text/background token pair fails WCAG AA.
   The GitHub Action already runs `npm test` before deploy, so this protects `main` and every pull request.

## Tests and checks (before saying it's done)
- `npm test` passes, including the new style check. POS tests pass.
- Screenshots in light and dark, desktop (1440px) and phone (390px), of: website home, sign-in, join page, HR dashboard, employees, leave, payroll, payslip, claims, attendance, settings/team access, superadmin, POS till, POS payment, POS reports. Put them side by side with the current look in one page, so I can compare.
- No lime, no Manrope, no off-brand colour visible anywhere (search the code and look at the screenshots).
- Contrast results for every token pair listed.
- Nothing else changes: same buttons in the same places, same text, same data. Spot-check sign-in, add employee, leave request, payroll run, POS sale and refund in the preview.
- Pages still work offline where they did before (POS, app shell).

## Working style
- Small steps. After each step tell me what to open to see it.
- **Do not commit to `main`, merge, push or deploy without my go-ahead.** Pull request, preview link, screenshots, test result, then wait.
- Do not change `firestore.rules`, Cloud Functions or data. This task needs none.
- Ask me before adding any library or paid service. (Inter is free, SIL Open Font Licence.)

## Questions for me (suggested answer first)
1. Default theme: light for website and HR app, dark for POS? (suggest yes)
2. Keep the glass look (translucent bars, rounded cards) or go flat? (suggest keep glass on bars and dialogs only)
3. Font: Inter everywhere? (suggest yes)
4. Merge or close the open branches first, then restyle once? (suggest yes)

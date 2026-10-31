# Allurus HR design system (glass)

The app's look lives in two stylesheets, loaded in this order by `app.html`:

1. `css/styles.css`: layout, components and the original light/dark tokens.
2. `css/glass.css`: the glass theme. Tokens, background, shell, and restyled components. Delete this line from `app.html` to get the previous look back.

Dark is the default. Light is the same design with a pale gradient. People can still choose Light, Dark or Automatic, an accent colour, density, text size and more contrast under **Settings → My account → Appearance**. Lime is the default accent; the older accents (teal, ocean and others) remain available.

## Tokens (`css/glass.css`)

| Token | Dark | Use |
|---|---|---|
| `--bg-grad` | slate-blue glow → charcoal → near-black | page background (fixed) |
| `--surface` | `rgba(255,255,255,.045)` | glass card |
| `--surface-2` | `rgba(255,255,255,.075)` | raised, hover |
| `--panel` | `#1b1f23` | solid surface for modals, drawers, menus, toasts and sticky table cells |
| `--line`, `--line-strong` | white 8% / 16% | hairline borders |
| `--fg`, `--fg-2`, `--fg-3` | `#f2f3f1`, white 72%, white 58% | text, secondary, captions (all pass 4.5:1) |
| `--brand` | `#c6f432` (light theme: `#4a6b00`) | lime: primary buttons, active states, positive data |
| `--on-brand` | `#10130a` | text on lime |
| `--bad` | `#ff6b57` | coral: negative values, the line chart, alerts |
| `--ok` | lime | approved |
| `--info` | `#6c9dff` | info badges, second bar series |
| `--tint-blue`, `--tint-olive`, `--tint-brick`, `--tint-stone` | `#46607a`, `#56652a`, `#7a4034`, `#62625e` | tinted cards and pipeline stages; white text passes 4.5:1 on all four |
| `--radius`, `--radius-sm`, `--radius-pill` | 26px, 16px, 999px | cards, inner tiles, pills |
| `--blur` | `blur(20px) saturate(130%)` | glass backdrop |
| `--ease`, `--dur` | `cubic-bezier(.2,.8,.2,1)`, .2s | motion |

**Font:** Manrope (variable, 400 to 800). It is self-hosted at `assets/fonts/manrope-latin.woff2` under the SIL Open Font License, with system fonts as fallback.

## Shell

- **Top bar (floating):** lime logo tile, then the **pill nav** with one tab per section (the route groups: Overview, Workforce, Time, Finance and so on). The active tab's highlight slides between tabs. On the right are round search, notifications, theme, help and sign-out buttons, and the **avatar**.
- **Icon rail (floating, left):** the pages in the current section, then Settings, Help and All pages. Each icon has a tooltip and an `aria-label`. Hidden below 1024px.
- **Drawer:** the full page list, pinned pages, view switch and sign out. Opened from the avatar, the menu button or the rail's grid icon.
- **Phones (<768px):** the bottom tab bar replaces the pill nav.

Built in `renderShellNav()` (`js/app.js`), using `#pillnav`, `#rail` and `#me-btn` in `app.html`.

## Page header

Every page keeps its `.page-head` markup. After each render, `decorateHead()` (`js/app.js`):

- puts the `h1` on two lines, split where the halves are closest in length;
- adds up to three **key-number chips** (`.kpis > .kpi-chip`: round icon, bold value, small caption) from `pageKpis(route)` on Dashboard, Employees, Departments, Recruitment, Time off, Attendance, Payroll and Claims. Values come from the app's own data.

Actions stay on the right, and the primary one is the lime pill. On phones the chips become a horizontally scrolling row.

## Components (CSS classes)

| Component | Class |
|---|---|
| Glass card | `.card` |
| Tinted card | `.tint-blue`, `.tint-olive`, `.tint-brick`, `.tint-stone` |
| Lime highlight tile | `.lime` |
| Buttons | `.btn`, `.btn-primary` (lime), `.btn-ghost`, `.btn-icon` (round), `.btn-danger`, `.btn-ok` |
| Segmented control | `.seg > button.on` |
| Filter chips | `.chip`, `.chip.on` |
| Status | `.pill.ok`, `.pill.warn`, `.pill.bad`, `.pill.info`. Always with text, never colour alone |
| Inputs | `.input`, `.select` (pill), `textarea` (rounded) |
| Tables | plain rows that highlight on hover; muted header |
| Charts (hand-written SVG) | `.chart .line` / `.area` coral; `.b-present` lime; `.b-remote` blue; dashed `.grid-line` |
| Pipeline | `.kcol[data-stage]` tinted by stage; `.kcard` lifts and scales while dragged; `.kzone[data-zone=reject]` is the "Not progressing" drop zone |

The move-back and move-forward buttons on each candidate card are the keyboard alternative to dragging. "Not progressing" is also on the candidate's own page.

## Dashboard tints

Set in CSS by widget id, so they follow the cards wherever someone arranges them:

- `live`: stone
- `off`: blue
- `approvals`: brick
- `upcoming`: olive
- the first key-number card: lime

## Motion and accessibility

- Transitions take 150 to 250ms. Pages rise 8px on navigation only, not when saving. Cards lift 2px on hover; buttons press to `scale(.98)`.
- The reduced-motion setting (or the system preference) turns all animation off.
- Focus ring: 2px lime outline, 2px offset.
- All icon-only buttons have `aria-label`.

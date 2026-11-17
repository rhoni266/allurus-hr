# Allurus: Owner overview, the whole company on one page (Instructions for the coding agent)

## Goal
A new **Overview** page for the Owner (and Admin managers): the whole company on one screen with charts, including a **daily production graph**. It must match the owner's mockup **`docs/mockups/OwnerOverview.dc.html`** (canvas "Allurus macOS-style UI", third row). Demo numbers in the mockup are made up. The real page uses the company's own data.

## Where it lives
- Sidebar → Overview → **"Owner overview"** (first item for Owners). Also a tile in the Ctrl K launcher.
- Who sees what: **Owner** sees everything. Anyone else sees only the blocks their areas allow (`can(area)`):

| Block | Needs area |
|---|---|
| Staff, Attendance, By department | people or time |
| Production, Production commission | operations or payroll (and `prodCommission` on) |
| Payroll cost, payroll KPI | payroll |
| Money in/out, Overdue invoices | finance |
| Needs you, Coming up | each line only if its area is allowed |

- Desktop: a 4-column grid as in the mockup. Tablet: 2 columns. Phone: 1 column (admins on phones), with the charts kept and scrolling sideways inside their card if needed.

## Blocks (top to bottom, same as the mockup)
1. **KPI row** (6 tiles): Staff (active, on leave, change this month); Attendance today (% of staff due who checked in, vs the same weekday last week); Production this month (units, vs the same number of working days last month, days entered and missing); Payroll this month (estimate until finalised, vs last month, pay day); Money in this month (POS + invoices paid, vs last month); Overdue invoices (amount, customers, oldest). Up/down colours only for real good/bad changes (green #17804A / red #B3261E). Neutral changes in slate.
2. **Daily production chart** (3 columns wide): last 30 days, one teal bar per day (units), a 7-day average line, a y-axis with 3–4 round ticks, and a few date labels. **Hover** a day: date, units, 7-day average, pool, share per person, staff who checked in. A missing day says "Not entered yet". A closed day says "Closed". Data: the saved production days (`prodDays`) and the attendance counts. Hidden when `prodCommission` is off.
3. **Production commission card**: month-to-date total, average per person per day, best day, days entered, **days missing an entry** (amber, with the date), link to Production.
4. **Attendance chart** (2 columns): last 14 working days, stacked bars per day: Present, Late, On leave, Absent. Legend, and hover shows the numbers.
5. **Payroll cost** (2 columns): last 6 months, one horizontal stacked bar per month: Basic, Overtime, Production commission, Employer EPF/SOCSO/EIS/HRD. Total on the right. The current month is marked "estimate" until finalised.
6. **Money in and out** (2 columns): last 6 months, two bars per month (in = POS sales + invoices paid; out = payroll + bills paid), with a one-line net summary under it.
7. **Needs you**: approvals waiting (by type), statutory payments due (EPF, SOCSO, EIS, PCB by the 15th; HRD levy), low stock, overdue invoices, production not entered. Each line is a link to the page that fixes it.
8. **Coming up**: next 5 dated events: statutory deadline, people back from leave, payroll check/finalise date, pay day, probation ends, public holidays.
9. **By department table**: staff, attendance %, leave days, overtime hours, commission, payroll cost. This is also the **table view** of the charts (accessibility: every chart has its numbers in text).

**Period switch** in the toolbar: This month / Last 3 months / This year. It changes the KPI comparisons, the commission card, the table and the ranges of the charts that are by day (production: 30 / 90 days; attendance: 14 / 60 working days, weekly bars beyond 30). **Export PDF** prints the page through a print stylesheet (A4 landscape, no sidebar).

## Charts: rules (from the dataviz check, already validated)
- **Plain HTML/CSS + one inline SVG for lines. No chart library.**
- Colour order for categories, validated for colour-blind readers and contrast on white (all checks passed): **teal #00917F, gold #B5852A, blue #2F6AD0, rust #B4532F**, always in this order and always the same meaning on the page:
  - attendance: Present = teal, Late = gold, On leave = blue, Absent = rust;
  - payroll: Basic = teal, Overtime = gold, Commission = blue, Employer statutory = rust;
  - money: In = teal, Out = gold.
  These are chart colours only. Keep the brand teal #0F766E for buttons and selection.
- Bars: rounded 4px at the data end, 2px gap between bars and between stacked segments, y starts at 0, gridlines faint.
- **One y-axis per chart.** Never two scales on one chart: payroll and production stay separate charts.
- Every chart with 2 or more series has a legend. Values and labels use the text colours, not the series colour.
- Hover tooltips on every bar (date or month, each value, total). Keyboard: bars can be focused with Tab, and the tooltip shows on focus.
- `role="img"` with a written summary (`aria-label`) on each chart, plus the department table.
- **Dark mode**: same layout. For dark, re-check the four colours against the dark surface with the dataviz validator (`node scripts/validate_palette.js "<hexes>" --mode dark`) and use lighter steps where needed. Don't just reuse the light ones.

## Data and speed
- Build everything from data the app already loads for an Owner (employees, check-ins, leave, payroll runs, prodDays, invoices, POS daily totals, stock). **No new Firestore reads for each chart.** Compute once per render, memoised by month.
- Missing data shows an empty state ("No production entered this month"), never a broken chart or `NaN`.
- Money in whole sen in calculations, shown as RM with 2 decimals in tables and rounded in chart labels.

## Tests
- Unit: the functions that build each chart's data (30-day production with 7-day average, missing vs closed days; attendance stacks; payroll stacks with the commission line; money in/out; KPI deltas), with fixed fixtures.
- Per area: a Finance-only admin sees money blocks only; HR sees people blocks; the Owner sees everything; `prodCommission` off hides production.
- Visual: screenshot at 1440 and 390 in the PR description, next to the mockup.
- `npm test` passes, including the design-style check.

## Working style
Follow `RUN-ALL-SPECS.md`. Branch `claude/owner-overview`. Preview with `/app?demo=majorfe` first, then merge and deploy after the owner checks the preview. (The owner runs the `firebase deploy` commands if the harness blocks them.)

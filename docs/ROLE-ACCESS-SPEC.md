# Allurus HR: Role Access with Tick Boxes (Instructions for the coding agent)

## Goal
An admin decides what each staff member can open: either pick a **ready-made role** (Finance, HR, Payroll, ...) or **tick the exact areas**. A small company with one admin gives that person everything (Owner). Each role sees only its own work: Finance sees the books but not the workforce. HR sees the workforce but not bills or supplies.

## What exists today (confirm by reading the code)
- `js/app.js` around line 446: `AREAS` (people, time, payroll, claims, finance, talent, operations, pos, settings), `TEMPLATES` (owner, hr, payroll, finance, operations, outlet, manager), `templateOf`, `can(area)`, `ROUTE_AREA` (which page belongs to which area).
- Settings → Team access: a **dropdown** of templates per person (`data-acc-role`, `options()`, `setRole()`). "Custom" only shows if someone already has an odd mix. **There are no tick boxes.**
- `firestore.rules`: `perms` list on `users/{uid}`; `hasArea`, `inArea`, `readsClass`, `bucketArea`, `writesBucket` enforce areas on the server. `grantable()`: you can only give areas you have yourself; only an Owner (no `perms` list) can make another Owner.
- POS has its own `posRole` (manager, cashier, waiter, kitchen).

So this is mostly **a UI change plus checks**. Keep the existing data shape (`roles`, `perms`, `posRole`) unless the study shows a real problem.

## First, study (short)
1. List every page and action, and the area it needs (`ROUTE_AREA`, every `can(...)` call). Find pages or buttons with **no area check** and list them.
2. For each area, list which Firestore buckets it reads and writes (`bucketClass`, `bucketArea`). Point out any data a role can still **read** that it should not, for example a Finance user reading staff records, salaries or IC numbers through the default class `'m'`, the directory or exports. Hiding the menu is not enough; the server must refuse.
3. Write the summary and your plan into `docs/AUTOPILOT-LOG.md` (owner's permission in `RUN-ALL-SPECS.md`), then build.

## What to build

### 1. Areas (plain names on screen)
| Area key | Name on screen | Covers |
|---|---|---|
| `people` | Staff records | Employees, onboarding, assets, org chart, announcements, HR reports |
| `time` | Attendance and leave | Check-ins, schedules, leave, overtime |
| `payroll` | Payroll | Payroll runs, payslips, statutory files, pay changes, loans |
| `claims` | Claims | Staff claims |
| `talent` | Hiring and performance | Recruitment, appraisals, training, grievances |
| `finance` | Finance | Books, invoices, bills, suppliers/contacts, budget, tax, finance reports |
| `operations` | Stock and operations | Stock, purchasing, supplies, production, deliveries, machines |
| `pos` | Point of sale | Till, tables, kitchen, menu, sales |
| `settings` | Company settings and team access | Company settings and giving access to others |

Group them on screen as **Workforce** (Staff records, Attendance and leave, Payroll, Claims, Hiring and performance), **Business** (Finance, Stock and operations, Point of sale) and **Admin** (Company settings and team access). Hide areas the company does not use (`AllurusFeatures`), as `can()` already does.

### 2. Ready-made roles (keep these, check the areas)
- **Owner**: everything, including giving Owner. This is the one-admin company.
- **HR admin**: Staff records, Attendance and leave, Payroll, Claims, Hiring and performance, Company settings. **No Finance, no Stock/operations, no POS.**
- **Payroll**: Staff records, Attendance and leave, Payroll, Claims.
- **Finance**: Finance, Claims (to pay them). **No Staff records, Attendance, Payroll detail, Hiring.**
- **Operations**: Stock and operations.
- **Outlet manager**: Point of sale, Stock and operations, Attendance and leave.
- **Admin manager**: everything except Hiring and performance, and except giving Owner.
- **Employee**: no admin areas; only their own app (payslips, leave, claims, check-in).

### 3. Tick boxes (the new part)
- In Team access, each person's row gets an **Access** button that opens a panel:
  - a role picker at the top (the roles above, plus **Custom**);
  - **tick boxes** for every area, grouped Workforce / Business / Admin, each with its one-line "Covers" text;
  - choosing a role ticks its boxes; changing any tick switches the picker to **Custom** (or back to the role whose ticks match, using `templateOf`);
  - an **All areas** tick to tick everything (this is still not Owner; Owner is chosen from the picker);
  - a short summary: "Can open: Finance, Claims. Cannot open: staff records, payroll, attendance, hiring, stock, POS."
- The same panel is used when **inviting** someone (email or IC), so the access is set before they join.
- Only areas the admin has themselves can be ticked; others are shown greyed out with "You don't have this area". Only an Owner can choose Owner. (Matches `grantable()` in the rules.)
- Works for **IC staff too** (no email). An IC person can be made HR, Finance, etc. Check that the rules allow `setRole` for accounts with `via == 'ic'` / `'open'` after they have joined. If they don't, fix it in the rules.
- POS: when Point of sale is ticked, show the POS role (manager, cashier, waiter, kitchen).

### 4. Safety rules
- **Never leave the company with no Owner.** The last Owner cannot be lowered, disabled or removed. Show "Make someone else Owner first."
- An admin cannot remove their own Company settings area or lower themselves by mistake. Ask "You will lose access to this screen. Continue?". Block it if they are the last Owner.
- Changes apply **at once**. A person who loses an area is moved off that page on their next action, and the server refuses their reads and writes straight away.
- Every change goes in the audit log: who changed whose access, from what to what, when.
- The person gets an in-app notice: "Your access changed: you can now open Finance."

### 5. Close the gaps from the study
- Every page and action in the list from study step 1 must check `can(area)`. Add the missing checks.
- Every bucket must belong to the right area on the server. If a role can read data it should not (for example Finance reading staff IC numbers or salaries, or HR reading bills or supplier prices), fix `firestore.rules`. Follow the safety steps in `RUN-ALL-SPECS.md`: back up the live rules, run the rules tests, then publish.
- Exports, reports, search and the dashboard must follow the same areas (no salary totals on a Finance user's dashboard, no sales figures on an HR user's dashboard).

## Tests (run before saying it works)
- Rules tests (`tests-rules/`) for each role: **Finance** cannot read or write staff records, payroll, attendance, leave or hiring, and can read/write the books and bills. **HR admin** cannot read or write bills, invoices, suppliers or stock, and can read/write staff, leave, payroll and claims. Same style for Payroll, Operations, Outlet manager, Admin manager, Employee and Owner.
- Custom ticks: tick only Claims, and the person sees and can use Claims only. Untick it, and access is refused at once.
- Giving: a non-Owner cannot give an area they don't have, or give Owner. Last-Owner protection works.
- IC staff member made Finance: it works, and they sign in with IC and see Finance.
- One-admin company: the founder is Owner and sees everything (no change from today).
- Menu, dashboard cards, search, exports and reports follow the ticks.
- Existing tests pass (`npm test`, `npm run test:rules`).

## Working style
Follow `RUN-ALL-SPECS.md` (full permission, hard stops, safety steps, log).

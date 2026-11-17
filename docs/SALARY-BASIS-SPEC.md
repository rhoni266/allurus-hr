# Allurus: salary entered as monthly by default (setting), monthly only at Major Far East (Instructions for the coding agent)

## Owner's decision (12 Nov 2026)
- **Salaries are typed and shown as monthly by default** everywhere: employee form, import, profile, Team access, payroll.
- A **company setting** lets a company choose **Yearly** instead.
- **Major Far East: monthly only.** The setting is locked to Monthly there.

## Why (found 12 Nov)
In the November 2026 draft payroll at Major Far East, Nadia's gross is **RM166.67** and Fouzer's **RM191.67**. Those are exactly RM2,000 and RM2,300 ÷ 12: HR typed monthly salaries into a field the app treats as **yearly**. Many crew have **RM0.00** (no salary). **November must not be approved until this is fixed.**

## How to build it (no risky data model change)
- **Keep the stored field as it is** (yearly `salary`, as today). Payroll, EPF, SOCSO, PCB, reports and payslips don't change.
- Add a company setting **`settings.salaryBasis` = `'monthly'` (default) | `'yearly'`**.
- Everywhere a person **types or reads** a salary, convert at the edge, in whole sen so nothing drifts: monthly shown = yearly ÷ 12; monthly saved = monthly × 12. Write unit tests for round-trips such as RM2,345.55 and RM1,700.00.
- Labels always say the basis: "Basic salary (monthly) / Gaji pokok (bulanan)" or "(yearly / tahunan)". Under the field, show the other one in grey: "= RM24,000 a year" or "= RM2,000 a month".
- **Import:** the salary column is read in the company's basis, and the preview shows "Monthly salary". The column mapping can choose "monthly" or "yearly" for this one file.
- **Settings → Payroll → "Salaries are entered as": Monthly / Yearly.** Owner or Payroll area. Changing it only changes how salaries are typed and shown: stored values stay the same, and the help text says so.
- **Major Far East:** the switch shows "Monthly (fixed for this company)". Lock it with a per-company add-on `salaryMonthlyOnly`, switched on by superadmin with `node scripts/set-addon.js salaryMonthlyOnly "Major Far East"` (check first, then `--yes`). The rules refuse `salaryBasis: 'yearly'` while the add-on is on.
- The **per-trip pay WIP branch** (`claude/per-trip-pay-wip`) changes the field to monthly in storage. **Don't merge it as is.** When it's picked up later, build it on this approach.

## Fix the existing Major Far East records (dry run first)
`scripts/fix-salary-basis.js "<company>"`:
- Lists every active employee with: name, stored yearly salary, the monthly it means today, and a **suggestion**:
  - **"Looks like a monthly figure typed as yearly"** when the yearly value is between RM1 and RM20,400 (below the minimum wage of RM1,700 × 12) → proposed yearly = value × 12;
  - **"No salary"** when it's 0 or empty → HR must fill it in;
  - otherwise "OK".
- Prints names only to the screen and the log, never ICs.
- `--yes --only <id,id,…>` applies the × 12 fix **only to the people HR confirms**. Never all at once by default. Each change goes in the audit log ("salary corrected from RM2,000/yr to RM24,000/yr, monthly basis fix").
- After fixing, the November draft must be recalculated: **Discard draft**, then rebuild.

## Payroll safety checks (all companies)
Before **Approve and pay**, warn (and require a tick to continue) when any employee on the run has:
- **no salary**, and isn't a per-day / per-trip / hourly worker;
- a **monthly salary below the minimum wage** for a full-time worker. Keep the figure as a setting (**RM1,700**, the current national minimum wage). It's under government review, so don't hard-code it in several places;
- a salary that changed by more than 50% since last month.

## Tests
- Unit: monthly↔yearly conversion round-trips in sen; labels per basis; import in each basis.
- Settings: switch Monthly/Yearly; Major Far East locked (UI and rules test).
- Fix script: dry run lists the right suggestions; `--yes --only` changes only those people; audit lines written.
- Payroll checks: each warning fires; approval needs the tick.
- `npm test` and `npm run test:rules` pass.

## Working style
Follow `RUN-ALL-SPECS.md`. Deploy order if rules change: rules, then hosting. Run the fix-script **dry run for Major Far East and show me the list** before anything is changed.

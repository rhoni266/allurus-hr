# Allurus: Daily Production Commission (Major Far East only) (Instructions for the coding agent)

## Owner's decision (11 Nov 2026)
Major Far East pays a **daily production commission**:
1. An admin keys in the day's **total production** (units).
2. **Pool = units × rate per unit (RM).** The pool is **split equally** among the staff who **attended** that day.
3. **Attended = checked in that day** (any check-in counts, including late or half day). Staff **on leave** or **absent** get nothing.
4. Only staff in the **departments** chosen in Settings take part (for example Production).
5. Each person's commissions for the month are **added to their salary** in payroll.

Example: 2,000 units × RM0.05 = RM100.00 pool ÷ 25 staff who checked in = **RM4.00 each**.

**Only Major Far East** has this feature. Every other company never sees it.

## First, study (short, write it in `docs/AUTOPILOT-LOG.md`)
1. How attendance check-ins are stored per person per day (phone check-in, kiosk, HR corrections) and how approved leave (full and half day) is stored.
2. How payroll builds a payslip: where allowances, overtime and other earnings are added, how EPF, SOCSO, EIS, PCB and HRD levy pick up each earning type, and how a payroll month is finalised/locked.
3. How company-specific features are switched on (`AllurusFeatures`, industry extras, superadmin tenant override with audit).
4. Department field on employees.
Then build.

## What to build

### 1. Switch it on for Major Far East only
- Feature key `prodCommission`, off for everyone. Turn it on for Major Far East through the existing superadmin tenant override (audited), and log it.
- When off: no menu item, no Settings card, no payslip line, nothing in the launcher, no rules access.

### 2. Settings → Production commission (Owner, or the `payroll` area)
- **Rate per unit (RM)**: up to 4 decimals (for example 0.05 or 0.0025).
- **Unit name**: pcs / kg / cartons / free text, shown everywhere ("2,000 pcs").
- **Departments that take part**: pick from the company's departments (multi-select). People with no department are left out and listed so HR can fix them.
- **Who may key in production**: the `operations` area or the `payroll` area (both by default).
- A rate change applies to days saved **after** the change. Each saved day keeps the rate it used.
- Show a worked example under the fields, using today's settings.

### 3. Daily production entry (new page "Production", in the Operations/People group)
- Pick a date (default today; past dates allowed back to the start of the current unlocked payroll month; no future dates). Type **total units** (whole number, or up to 2 decimals when the unit is kg). Optional note.
- **Live preview before saving:**
  - pool (RM), number of staff who attended, share per person (RM);
  - the **list of who gets it** (name, department, first check-in time);
  - the **list of who doesn't** and why ("On leave (annual)", "No check-in", "Not in a commission department", "Not yet started / already left").
- **Save** stores the day: date, units, rate, pool, the attendee ids, the share, who saved it and when.
- One entry per day. Editing it later recalculates and is logged (old and new values).
- **Attendance changes after saving** (a late check-in correction approved by HR, a leave cancelled): the day shows "Attendance changed since this was saved: recalculate", and one tap updates it. Payroll always uses the latest saved version.
- Month view: a calendar/list with each day's units, pool, attendees, share and status (saved / changed since / missing). Days with check-ins but no production entry are marked "No production entered".

### 4. Who counts as attended (one pure, unit-tested function)
`attendedForCommission({ employee, date, checkins, leaves, settings })` → `{ ok: true } | { ok: false, reason }`
- employee active on that date (started on or before, not left before);
- department is in the chosen list;
- has **at least one check-in** that date (phone, kiosk, or an HR-approved correction);
- **not on approved full-day leave** that date (if both exist, leave wins, and the day is flagged for HR);
- half-day leave + a check-in → counts (owner's rule: any check-in counts);
- no check-in → doesn't count, whatever the reason.

### 5. Money (integer sen, no floating point)
- Pool in sen = round-half-up(units × rate × 100).
- Share in sen = floor(pool ÷ attendees).
- Remainder (a few sen) is **not paid out**. Show it on the day ("RM0.02 not shared out").
- 0 attendees → pool not paid, day flagged.

### 6. Payroll
- New earning type **"Production commission / Komisen pengeluaran"**: each person's sum of daily shares in the payroll month, with the number of days (for example "RM84.00 (21 days)").
- Shown on the payslip as its own line, and in the payroll run table, totals and exports (bank file, payroll summary, EA form total earnings).
- **Statutory treatment** (default; make it the earning type's settings so the accountant can change it):
  - **EPF: yes.** EPF's guidance lists commission and incentive as wages.
  - **SOCSO and EIS: yes.** Commission is wages for PERKESO.
  - **PCB: yes,** as normal monthly remuneration.
  - **HRD levy:** follow how the payroll already treats commission. If unclear, include it, and note it in the log for the accountant.
  - **Not** part of the overtime hourly rate or leave pay unless the owner or accountant says so (write this in the log).
- When the payroll month is **finalised**, the month's production days lock (no more edits). A later correction goes in as an adjustment in the next open month, with a note.
- Payroll checks: warn before finalising if any working day in the month has check-ins but no production entry, or has "attendance changed since saved".

### 7. Staff see their own
- Phone Home and Payslips: a card "Production commission this month: RM84.00 · 21 days". Tap → list of days with units, their share, and the days missed with the reason ("On leave", "No check-in").
- Staff see only their own share, the day's total units and the number of people who shared it. Never the names of others.

### 8. Reports
- Month report: per person (days, total RM), per department, per day. CSV export (payroll area only).

### 9. Data and rules
- Per day: an admin-only record with the attendee list (for example `tenants/{t}/prodDays/{yyyy-mm-dd}`), and a staff-readable summary without names (units, pool, attendee count, share).
- Each person's monthly total goes into the payroll data the way other earnings do.
- Rules:
  - write the day only with the `operations` or `payroll` area, while `prodCommission` is on and the month isn't locked;
  - staff read only the summary;
  - nobody can delete a day (to remove one, set units to 0 with a note);
  - every change goes in the audit log.
- Back up the live rules before publishing (`RUN-ALL-SPECS.md`). Add `tests-rules/` cases.

## Tests
- Unit, the share function:
  - 2,000 × RM0.05 = RM100.00 ÷ 25 = RM4.00 each, remainder 0;
  - 1,000 × RM0.05 = RM50.00 ÷ 3 = RM16.66 each, RM0.02 not shared;
  - rate 0.0025 × 12,345 units (rounding);
  - 0 attendees.
- Unit, the attended function: late check-in counts; half-day leave + check-in counts; full-day leave excluded (and flagged if a check-in exists); no check-in excluded; other department excluded; no department excluded; started tomorrow or left yesterday excluded; kiosk and HR-corrected check-ins count.
- Payroll: the commission line appears with days; EPF, SOCSO, EIS and PCB are calculated on basic + commission; finalising locks the days; an edit after lock is refused, and the adjustment goes to the next month.
- Recalculate: a correction approved after saving → "changed since saved" → recalculate updates the shares and the payroll preview.
- Feature off (any other company): no menu, settings, payslip line or rules access (UI test + rules test).
- Staff view shows only their own share; rules refuse the attendee list to staff.
- `npm test` and `npm run test:rules` pass. Emulator end-to-end: key in a day for a test copy of Major Far East with 5 test staff (3 checked in, 1 on leave, 1 absent), check the shares, then run payroll.

## Working style
Follow `RUN-ALL-SPECS.md` (full permission, hard stops, safety steps, log). One branch `claude/prod-commission`. Run on a **test company first**. Switch it on for the real Major Far East only after the owner checks the preview with real numbers. The statutory defaults above must be confirmed by Major Far East's accountant before the first real payroll with commission.

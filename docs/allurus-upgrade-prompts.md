# Allurus HR upgrade prompts for Claude Code

How to use: open Claude Code in the `rhoni266/allurus-hr` repo. Paste the **Master context** once at the start of each session, then paste **one phase prompt**. Run one phase per session, review it, commit, then start the next. The phases are ordered by priority (from the Info-Tech gap analysis).

---

## Master context (paste first, every session)

```
You are working on Allurus HR (repo rhoni266/allurus-hr), a Malaysian HRMS SaaS prototype.

Architecture you must follow:
- Plain HTML, CSS and JavaScript. No build step, no framework, no new npm dependencies unless I approve. Vendor libraries go in js/vendor/ with their licence file.
- index.html is the shell. js/app.js holds views, routing (ROLES nav arrays and VIEWS), actions (data-act handlers) and settings. Every view reads from the single `state` object, saved to localStorage through save()/commit(). Keep that pattern so a backend can replace localStorage later.
- js/utils.js holds dates and payroll maths (EPF, SOCSO, EIS, PCB). js/seed.js holds demo data (Lumen & Co.). js/finance.js, js/claims.js, js/tax.js, js/receipt.js, js/face.js, js/geo-map.js, js/experience.js hold their own areas.
- Roles: super, admin (Company Admin), employee, auditor. Respect what each role can see.
- Styling: use the existing tokens and components in css/styles.css and design-system.html. Light and dark mode, mobile bottom sheets, accessible labels, focus handling, reduce-motion. Match the existing tone: short, friendly, plain English.
- Currency MYR, locale en-MY. Malaysian statutory rules apply.

Rules for every change:
1. Before coding, read the files you will touch and tell me your plan in 5–10 bullets. Then build it.
2. Add new state fields with safe defaults and a migration in load() so existing browsers' saved data still works.
3. Extend js/seed.js so the demo shows the new feature with realistic Malaysian data.
4. Add the feature to the ⌘K command palette, the Help tips and the insights/"Focus for today" list where it makes sense.
5. Put pure logic (calculations, rules, file builders) in a module with no DOM access and add unit tests in tests/*.test.js (node --test, no dependencies). Run `npm test` and make it pass.
6. Never invent official government file formats or rates. Where an official spec is needed (KWSP, PERKESO, LHDN, bank files, MyInvois), build it behind one clearly named function with a comment `// FORMAT: verify against <official source> before production` and make the rate tables editable in Settings.
7. Update README.md: add the feature to the right section and the project structure.
8. Finish with a short summary: what changed, files touched, how to try it in the demo, and anything left to verify.
```

---

## Phase 1 — Leave management upgrade

```
Upgrade Time off to match a full Malaysian e-Leave module.

Build:
- Leave types managed in Settings: name, days per year, paid/unpaid, needs attachment (yes/no), half-day allowed, carry-forward limit and expiry month, gender/eligibility, pro-rate for new joiners. Seed Malaysian defaults: Annual, Sick (MC), Hospitalisation, Maternity (98 days), Paternity (7 days), Compassionate, Replacement, Unpaid, Emergency.
- Public holidays: a per-company holiday calendar with Malaysian national holidays plus a state selector (Terengganu default for the seed company). Holidays and weekends are not counted as leave days. Allow per-state weekend (Fri–Sat for Kelantan/Terengganu/Kedah option).
- Half-day leave (AM/PM).
- Attachment upload (MC photo or PDF) on apply, shown to approvers.
- Approval chain up to 3 levels: L1 (department head), L2 (optional), final (HR). Configurable per department. Backup approver per approver for when they are on leave. Show the chain and who is next on each request.
- While approving: show who else in the same department is off on those dates and the applicant's balance.
- Leave calendar: month view of everyone's approved and pending leave, filter by department.
- Daily leave alert: on the admin/manager dashboard, a "Who's off today" card; plus an insight when someone in their team is off tomorrow.
- Carry-forward job at year end (run manually from Settings in the demo) with expiry.
- Approved unpaid leave feeds payroll as an unpaid deduction (basic / working days × days).

Tests: day counting with weekends, state weekends and holidays, half days, pro-rating, carry-forward and expiry, unpaid deduction.
```

---

## Phase 2 — Overtime, shifts, rosters and lateness

```
Add a time-attendance rules engine and rostering, feeding payroll.

Build:
- Working patterns in Settings: name, start/end, break, grace minutes for lateness, working days. Unlimited patterns. Assign a pattern per employee or per department. "Flexible" pattern with core hours.
- Rosters: an Admin "Schedule" page with a week grid (people × days). Click a cell to assign a shift or off day; copy last week; rotating roster templates. Warn on overlaps and on days below a minimum headcount. Employees see their roster on Home and My attendance.
- Auto-shift: if an employee has no fixed shift, pick the pattern whose start is closest to their check-in time.
- Lateness and early-out minutes per day from check-in/out vs shift. Show them on Attendance and the employee view.
- Overtime rules (Settings): OT 1.0, 1.5 (normal day), 2.0 (rest day), 3.0 (public holiday) per Malaysian Employment Act defaults; flat-rate OT option; early OT before shift; offset OT against lateness; rounding (e.g. to 15 or 30 min); minimum and maximum OT per day and per month (warn above 104 hours/month); different rate after midnight; dinner-break deduction; require pre-approval.
- Requests: employees request OT, lateness waiver or attendance correction from My attendance with a reason; manager/HR approves (reuse the Phase 1 approval chain if it exists).
- Daily allowances: attendance, meal, transport, shift and custom allowances with rules (full / partial / forfeit when late or absent), weekday/weekend/holiday rates.
- Payroll: approved OT (hourly rate = monthly basic ÷ 26 ÷ normal hours, editable) and allowances appear on the payroll run and payslip, flagged as taxable/EPF-able per settings.
- Audit trail: every manual edit of an attendance record keeps who, when, old and new values. Batch edit ("global change") for a date range.

Tests: lateness, early-out, OT for each day type, rounding, caps, offset, auto-shift choice, allowance forfeits, OT pay amount.
```

---

## Phase 3 — Statutory outputs, payslips and bank files

```
Turn payroll results into the documents and files a Malaysian company must produce.

Build (each behind its own builder function, unit-tested, with FORMAT comments per the master rules):
- Payslip PDF/print view for each employee and a "download all" for admin. Employees can download theirs from Payslips on mobile.
- Statutory export page on Payroll after a run is approved: KWSP (EPF) contribution file, PERKESO SOCSO + EIS file, LHDN PCB (CP39) file, HRD Corp levy summary. Each with a preview table, totals that reconcile with the payroll run, and a CSV/TXT download.
- Bank salary file: a generic GIRO/IBG CSV (name, IC, bank, account number, amount, reference). Add bank and account number fields to the employee record with validation. Allow per-bank templates later.
- Year-end: EA form (Borang EA) per employee for the year, generated from the year's payroll, printable, visible to the employee under Payslips; Form E (company return) summary for HR; CP8D data export.
- Event forms: CP22 (new employee, within 30 days of joining) and CP21/CP22A (employee leaving) prompts and printable forms, triggered from the employee lifecycle with dashboard reminders.
- Reminders: insights before the 15th for statutory payments, and for EA by end of February.

Tests: every file builder against seeded payroll data; totals reconcile; EA figures equal the sum of the year's payslips.
```

---

## Phase 4 — General expense claims

```
Extend Medical claims into a general Claims module, keeping the existing medical flow and OCR.

Build:
- Claim categories managed in Settings (custom templates): Travel, Mileage, Meals, Parking & toll, Accommodation, Phone, Training, Entertainment, Medical (existing), Other. Each has limits (per claim, per month, per year), receipt required, taxable or not, GL category for the books, and optional fields.
- Mileage: distance × rate per km (editable, seed RM0.60/km for car, RM0.30 for motorcycle), from/to fields.
- Multi-line claims: one claim with several receipts/items, each scanned with the existing js/receipt.js OCR.
- Approval chain up to 3 levels (reuse Phase 1 if present), approver sees receipts side by side and remaining limits.
- HR can edit amounts or receipt numbers with a logged reason.
- Approved claims go to the next payroll as reimbursements or are paid now; post to the books under each category's GL account.
- Reports: claims by employee, category, department and month, CSV export.

Rename the menu to "Claims" with Medical as one category; keep old medical claim data working through a migration.
```

---

## Phase 5 — Check-in hardening and kiosk mode

```
Close the remaining gaps in check-in.

Build:
- Fake-GPS heuristics in the browser: flag positions with impossible speed since the last fix, accuracy of exactly 0 or suspiciously round, identical coordinates repeated across days, and a large mismatch with the device time zone. Flagged check-ins go to the existing HR review queue with the reason.
- Offline check-in: if the network is down, save the check-in (time, GPS, selfie) in an outbox in localStorage/IndexedDB and sync when back online; mark it "captured offline". Add a simple service worker so the check-in page opens offline.
- Kiosk mode: a tablet page (admin turns it on for a device) where many staff check in one after another with face recognition against their reference photos, no password. Show the matched name and a 3-second confirm. Supervisor kiosk: a supervisor checks in team members on their own phone, with a selfie of each.
- Optional project/job selection at check-in (needed for Phase 9 project costing).

Keep the existing face-api flow, phone registration and PDPA consent. Tests for the heuristics and outbox sync logic.
```

---

## Phase 6 — Notifications, reminders and announcements

```
Add a notification centre.

Build:
- A bell in the top bar with unread count and a list; each item links to the page. Notifications for: request submitted/approved/rejected (leave, claims, OT), payroll paid, payslip ready, new announcement, roster changed, check-in flagged.
- Email-ready: a notifications outbox (state.outbox) with subject and body for each event, plus a per-user preference (in-app, email, both, off). No real sending yet; add a clear hook function where an email/push provider will plug in.
- Web push stub: request permission and show local browser notifications when the tab is open.
- Reminders engine (daily run on load): probation confirmation due, contract end, passport/work permit expiry (add these fields to the employee), birthdays and work anniversaries, statutory deadlines, unsubmitted appraisals.
- Announcements: admin posts an announcement or policy (rich text, optional attachment, target departments), employees see it on Home and must acknowledge policies; admin sees who acknowledged.
```

---

## Phase 7 — Performance appraisal upgrade

```
Upgrade Performance to a full appraisal module.

Build:
- Appraisal templates in Settings: sections (KPIs, competencies, values), questions with weights and rating scales (1–5 or custom), comment fields. Assign a template to a review cycle and to departments or people.
- Review cycle flow: HR launches a cycle → employee self-evaluation (save draft, submit) → L1 manager scores each item → optional L2 → HR final. Reminders for overdue steps.
- Optional 360° peer feedback (choose up to N peers, anonymous summary).
- Weighted final score and grade bands.
- Manager recommendations: increment %, bonus months, promotion; HR approves or edits; approved results create pending changes that apply to the employee's salary from an effective date and appear in payroll.
- Goals: SMART goals with progress updates and check-ins through the cycle.
- Reports: score distribution by department, completion status.

Tests for weighted scoring, grade bands and applying approved increments to payroll.
```

---

## Phase 8 — Onboarding, offboarding and HR admin

```
Add the HR admin tools.

Build:
- Employee record additions: IC/passport, nationality, work permit, emergency contact, bank details (if not added in Phase 3), education, employment history, career history (promotions, transfers, increments with dates). Employees can request edits to their own personal details; HR approves.
- Onboarding: when a candidate is hired (existing recruitment "Onboard" button) or an employee is added, create an onboarding checklist from a template (documents to collect, accounts to create, assets to issue, training to assign) with owners and due dates. Same for offboarding (asset return, final pay, CP21/CP22A from Phase 3, exit interview).
- Asset register: assets issued to staff (laptop, phone, access card, vehicle) with serial, value, issue and return dates; also staff loans and insurance records.
- Organisation chart generated from departments and a "reports to" field, printable.
- Letter templates with placeholders (offer, confirmation, increment, warning, transfer, resignation acceptance), generate and print per employee, saved in the employee's documents.
- Employee documents tab (uploads with expiry dates feeding Phase 6 reminders).
```

---

## Phase 9 — Reports library, project costing

```
Add reporting and project costing.

Build:
- Reports page for Company Admin with a library of ready reports: headcount by department, joiners and leavers, turnover rate, payroll summary and variance month on month, statutory contributions, OT by person and department, lateness and absenteeism, leave taken and balances, claims by category, birthdays, confirmations due. Each with filters (date range, department, employee), a table, a simple chart using the existing chart style, and CSV/print export.
- Custom report writer: pick a data source (employees, attendance, leave, payroll, claims), choose columns, filters, grouping and sort; save the report definition for reuse.
- Project costing: projects → job groups → jobs (3 levels), target hours and budget per job. Time per job from check-in (Phase 5) or manual timesheets. Labour cost from each person's hourly cost including employer EPF/SOCSO/EIS. Reports: monthly man-hours, wages by project, target vs actual hours, budget vs actual cost.

Tests for report aggregations and labour cost maths.
```

---

## Phase 10 — LHDN e-Invoicing readiness

```
Make Allurus invoices e-Invoice ready, without connecting to the live LHDN API yet.

Build:
- Company settings: TIN, BRN/SSM, SST number, MSIC code, business activity description, address in structured fields.
- Customer and supplier records: TIN, BRN, ID type, address, email, contact; validation of required fields.
- Invoice, credit note, debit note and refund note types; self-billed invoice option for bills.
- An e-Invoice document builder that maps an Allurus invoice into the MyInvois document structure (JSON), with a validation step listing missing mandatory fields. FORMAT comment per master rules (LHDN MyInvois SDK).
- Invoice status fields ready for the API: Draft, Submitted, Valid, Rejected, Cancelled, with a UUID and validation link placeholder, and a 72-hour cancellation window rule.
- A clear integration stub `submitToMyInvois(doc)` with notes on the OAuth client-credentials flow, to be implemented server-side later.

Tests: builder output for seeded invoices, validation of missing fields, cancellation window.
```

---

## Phase 11 — Recruitment, training, scheduling extras

```
Extend talent features.

Build:
- Recruitment: job requisition approval, job post templates, a public careers page per company (shareable link) with an application form, offer letter templates (generate from the candidate), interview scheduling with interviewers and scorecards, hiring analytics (time to hire, source, stage conversion). Leave job-board posting (Indeed, MyFutureJobs) as an integration stub.
- Training / LMS: courses with modules (text, video link, PDF), quizzes with pass mark, assign mandatory courses by department or role, completion certificates (printable), certificate expiry tracking feeding reminders, training requests with approval, HRD Corp claimable flag per course.
- Grievance: employees raise a ticket (option to stay anonymous to the department), assigned grievance manager, status flow and SLA, summary report.
- Meeting room booking: rooms, calendar view, conflict check, "My bookings".
```

---

## Separate project — production backend (do this before real customers)

```
Plan (do not build yet) the move from localStorage to a real backend for Allurus HR.

Read the whole repo first, then write docs/backend-plan.md covering:
- Recommended stack (compare Supabase/Postgres vs Node/NestJS + Postgres) for a small Malaysian SaaS team.
- Database schema for every entity in `state`, with tenant_id on every table and row-level security.
- Auth: email/password with server-side hashing, magic link, optional SSO, roles and permissions matching super/admin/employee/auditor, removal of password hashes from js/seed.js.
- API layer replacing save()/load(), migration path view by view, and how to keep the demo mode.
- File storage for selfies, MCs and receipts with retention (selfies 30 days) and PDPA consent records.
- Server-side jobs: payroll calculation, statutory files, reminders, email/push sending, MyInvois submission.
- Security: encryption at rest, audit log, backups and disaster recovery, path to ISO 27001 / SOC 2.
- Billing with Stripe for the Super Admin plans.
- A phased migration plan with effort estimates.
```

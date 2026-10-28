# Allurus HR

People operations SaaS for growing companies: a minimal, Apple-style HRMS with three roles.

| Role | Who | What they can do |
|---|---|---|
| **Super Admin** | You, the Allurus owner | See every subscribed company on a world map, MRR and ARR, plans, invoices, trials, past-due and suspended accounts. Change plans and seats, suspend or reactivate a company, mark invoices paid, open any company's workspace. |
| **Company Admin** | HR at a customer company | Dashboard, employees, departments, onboarding and offboarding, assets and loans, an org chart, letters, attendance, time-off approvals, payroll with payslips and CSV export, a recruitment pipeline with drag and drop, appraisals with goals and 360° feedback, and company settings. |
| **Employee** | Staff at a customer company | Time clock with location-stamped check-in and check-out, attendance history, time-off requests and balances, payslips, profile, goals, and the company directory. |

## The demo company

Open the app with `?demo` (for example `https://allurus.my/app?demo`) to show **Seri Maju Digital Sdn Bhd**, a sample Kuantan software and digital agency with 19 staff, Malaysian payroll, a Terengganu leave calendar, clients, bills and an external auditor. The sign-in screen has one-click buttons to explore it as the HR admin (Aisyah Rahman), a manager (Arjun Pillai), an employee (Daniel Lim) or the auditor, with no password. Everything stays in that browser; nothing touches the cloud. To start the sample over, use **Settings → Reset demo workspace** as the HR admin.

A second demo company, **Suria Enterprise**, opens with `?demo=suria`. It is a made-up cili boh factory in Muar, Johor, with 28 staff on two shifts, a Monday-to-Saturday week, three months of attendance, leave, claims and payroll, and the **Operations** module: stock and purchasing, production batches, deliveries, and machines. Switch between the two companies on the sign-in card. Each company keeps its own copy in the browser, and a reset affects only the company you are in. Its logins and a 10-minute walkthrough are in [`docs/demo-accounts-suria.md`](docs/demo-accounts-suria.md).

A third, **Major Far East Sdn Bhd** (`?demo=majorfe`), is a made-up hardware and building materials wholesaler in Kepong, Kuala Lumpur, with three logins: the admin (Owner), the HR admin, and a warehouse supervisor. The supervisor is an employee who can also open the stock page. When a purchase order is approved, he gets a notification that opens that order, so he knows what is coming and when. See [`docs/demo-accounts-majorfe.md`](docs/demo-accounts-majorfe.md).

## Signing in

Everyone signs in with email and password. The sidebar's view picker shows only the views an account is allowed to use.

| Account | Role |
|---|---|
| `superadmin@allurus.com` | Platform owner: Super Admin, plus every company view |
| `aisyah.rahman@serimaju.com.my` | HR admin and employee |
| `grace.ng@serimaju.com.my` | Finance and employee |
| `nurul.aina@serimaju.com.my` | Payroll and employee |
| `arjun.pillai@serimaju.com.my` | Employee who approves his team (manager) |
| `daniel.lim@serimaju.com.my` | Employee |
| `meiling@tanpartners.com.my` | Auditor (external accounting firm, read-only books, verifies reports) |

### Roles

One login per person, by work email. Everyone has the employee app. A **role template** adds parts of the company console: **Owner** (everything, including the books and who has access), **HR admin** (people, time, payroll, claims, hiring, settings; sees salaries), **Payroll** (staff records, time, payroll, claims) or **Finance** (the books and claims; no staff records or payroll detail). Managers need no role: being an approver in the leave settings gives them Approvals. People with a role start in their console on a computer and in the employee app on a phone, and switch from the menu under their name. Nobody can approve their own request, and in the cloud nobody can give access they don't have themselves. The founder who registers a company is its Owner.

The demo password and a walkthrough for each role are in [`docs/demo-accounts.md`](docs/demo-accounts.md). Change it under **Settings → Your account**. Companies that register create their own admin account, and that account gets the Company Admin and Employee views.

> Passwords are stored as SHA-256 hashes, but this is still a front-end demo: the hashes ship inside `js/seed.js`, so anyone can download them and try to guess the password offline, and short passwords fall quickly. Use real server-side authentication before handling real employee data.

## Finance & Accounting

For SMEs that don't want to hire an accounts clerk: the books keep themselves, and the external auditor verifies each month.

- **Overview**: cash in bank, profit this month, what customers owe and what you owe, money in and out by month, and auditor sign-off status.
- **Bookkeeping**: every entry in and out. Paid invoices, paid bills and payroll post automatically. Match entries to the bank statement.
- **Invoices** (receivables) and **Bills** (payables), with SST.
- **Budget**: monthly budget against actual spending per category.
- **Reports & audit**: each closed month gets a profit and loss, cash summary, SST summary, payroll summary, and month-end receivables and payables. The admin submits it; the auditor (`auditor@allurus.com`) verifies it or asks for changes. Verified months are locked, and every step is kept in an audit trail.
- **Tax (LHDN)**: every expense is matched to a Section 33(1) deduction category from its description. It flags entries that need a decision: trip purpose, business share of home-office rent or utilities, capital legal fees or renovations. Personal spending such as groceries and family holidays is never suggested as a business deduction. Export for your tax agent.

**Scan a receipt** (Finance overview and Bookkeeping): photograph or upload a receipt and it is read on the device with Tesseract (Apache-2.0, `js/vendor/ocr`). The shop, date, receipt number, items, SST and total come out as a list, and every item gets a suggested category that you can change, one by one or all at once. Personal-looking items (groceries, family holidays) are left out unless ticked. Saving adds one book entry per category, shares the SST across them, and keeps the receipt photo for your auditor. If the items don't add up to the receipt total, you're told to check them.

Employees get **Tax reliefs**: personal receipts tracked against LHDN relief caps (Lifestyle RM2,500, Sports RM1,000, Medical RM10,000, Education RM7,000, Parents' medical RM8,000). Employees can **scan receipts** too: each item is matched to a relief (a book to Lifestyle, a badminton racket to Sports, rice to "not a relief"). A **BE form helper** takes their income, PCB and EPF from their payslips and estimates chargeable income and tax.

The tax features use keyword matching and the rates in `js/tax.js`. They help prepare records; they are not tax advice. Check caps and rates for the current year of assessment with LHDN or your tax agent.

## Operations: stock, production, deliveries and machines

For a company that makes, sells and delivers a product. It shows only in a workspace with operations data (the Suria Enterprise demo), under a new console area, **operations**. It has two role templates: *Operations*, and *Admin manager* (everything except hiring and appraisals).

- **Operations today** is the admin manager's first page. It shows:
  - manpower by department, with overtime this month;
  - stock, with days of cover at the last 30 days' usage;
  - production today and this week, and any batch on QC hold;
  - deliveries and the cash collected;
  - money in, with aging and the top 5 debtors;
  - money out: bills overdue and due this week;
  - machines that are down, services due and downtime;
  - staff and company documents expiring within 30 days.

  The owner also sees the month so far: sales, output, raw materials bought and payroll cost.
- **Stock & purchasing**: a *Coming in* list of the orders on their way. When a purchase order is approved, everyone who looks after the store (the operations area, or the stock page only) is told what is coming and when, with a link that opens the order; from the employee app it switches them to their stock view. Stock on hand from an opening count plus every movement in and out. Items at or below their reorder level are flagged, with *Make PO*. A purchase order goes Draft → Approved (by someone other than the person who raised it) → Sent → Partial / Received → Billed. The vendor bill goes to Finance.
- **Production**: products with a recipe per batch. *Plan a batch* checks the stock. *Record output* takes the raw materials off stock and sets the expiry. A batch can be put on QC hold, then released or rejected. Finished goods are tracked by batch, and each batch shows which deliveries it went to.
- **Sales & delivery**: a sales order makes a delivery order, picked from the batch that expires first. Batches on hold or past expiry are never picked. Drivers get **My deliveries** on their phone: stops in order, *Delivered* with a photo, who received the goods and the cash collected. With the finance area, delivery creates the invoice at once (paid, if the cash covers it). A driver's delivery waits for the office to invoice it with one click.
- **Machines & maintenance**: machines and vehicles, with preventive maintenance every so many days or running hours, whichever comes first. Anyone can report a breakdown from a phone, with a photo. The technician marks it fixed, and the parts can go to a Finance bill. Company licences (halal, MeSTI, council), road tax and insurance go into the daily expiry reminders.

The rules are in `js/ops-rules.js` (no DOM), with tests in `tests/ops.test.js`. The screens are in `js/ops.js`.

In the cloud, operations data is readable only by admins with the operations area, except for:
- machines, products and breakdowns, which every member can read. Without the operations area, a member can add a breakdown report but not change one;
- each driver's delivery orders, which have their own bucket that only that driver can read and update.

The page limits for the storekeeper, technician and sales executive (`opsScope`) are in the menus only.

## Experience (2026 SaaS standards)

| Standard | In Allurus |
|---|---|
| Personalization | Preferences are saved per account: theme, accent, density, text size, pinned pages and dashboard layout. The app reopens on the page you last used. The "Focus for today" list and command suggestions adapt to your role and the time of day. |
| Emotional design | Friendly greetings, birthday wishes, gentle nudges to take leave, and small celebrations when you check in, pay payroll or clear your approvals. |
| Feedback | Toasts confirm every action, and decisions and deletes have **Undo**. Missing fields are flagged inline. KPI numbers count up when a page opens. |
| Display modes | Light, dark or automatic theme, six accent colours, comfortable or compact density, larger text and more contrast. |
| Mobile UX | A bottom tab bar (your pins or the role's main pages, plus More), forms that open as bottom sheets, and large touch targets. |
| User engagement | A setup checklist per role with a progress ring, a short guided tour, and Help with tips for the page you're on (press **?**). |
| Customization | Admins and employees can rearrange their dashboard: drag cards, choose S/M/L/Full widths, hide and restore cards, or reset. Keyboard move buttons work as well. |
| Data handling | A live "Who's in now" card and a Live indicator update when data changes in another tab. Automated insights cover approvals, payroll cost trends, overdue invoices, attendance against the 7-day average, leave balances and the employee's money plan. |
| Accessibility | A skip link, focus moves to the page heading on navigation, modals keep focus inside them, every icon button is labelled, `aria-current` marks the current page, and reduce-motion is respected. |
| Layout | A clear hierarchy: a welcome card, key numbers, then detail cards on a 12-column grid. |
| Navigation & search | A command palette (**⌘K**, **Ctrl+K** or **/**) to search people, pages and actions such as "check in", "run payroll" or "dark mode". |
| Design consistency | Shared tokens and components, documented live in [`design-system.html`](design-system.html). |

## Leave (e-Leave)

A full Malaysian leave module under **Time off** (admin), **My time off** and **Approvals** (employees who approve).

- **Leave types** (Settings → Leave types): name, days a year, paid or unpaid, needs an MC or document, half days, carry-forward limit and expiry month, who can take it (gender, married), minimum service, and pro-rating for new joiners. The defaults follow Employment Act 1955 minimums:
  - Annual: 8, 12 or 16 days by years of service.
  - Sick (MC): 14, 18 or 22 days by years of service.
  - Hospitalisation: 60 days, including sick days already taken.
  - Maternity: 98 consecutive days.
  - Paternity: 7 consecutive days, for married men with 12 months' service.
  - Also: Compassionate, Replacement (days granted by HR), Unpaid, and Emergency (taken from annual).
  - The demo company gives more annual leave: 14, 16 or 20 days.
- **Public holidays and rest days**: each company has a state and a holiday calendar. The demo company is in Terengganu, with Friday–Saturday rest days.
  - Kedah, Kelantan and Terengganu default to Friday–Saturday rest days. Attendance and dashboards use the same work week.
  - National holidays and Terengganu's state holidays are built in for 2026. When a holiday falls on a rest day, the next working day becomes a replacement holiday.
  - You can switch any holiday off and add your own company holidays.
  - Rest days and holidays are never counted as leave. Maternity and paternity count calendar days.
- **Applying**: full day or half day (AM/PM), a live day count that shows the days not counted and the balance after, and a photo or PDF upload (MC) where the type needs one.
- **Approvals**: up to three steps per department: L1 (department head), an optional L2, then HR. Each approver has a backup who decides while they're on leave. Self-approval steps are skipped.
  - Each request shows its chain and who's next.
  - Reviewing shows the MC, the balance before and after, and who else in the department is off on those dates. Declining needs a note, and decisions can be undone.
- **Calendar**: a month view of approved and pending leave for everyone, filtered by department, with rest days and holidays marked. Managers get a team calendar.
- **Dashboards**: a "Who's off today" card (company-wide for HR, team-wide for managers) with tomorrow's absences. Insights cover approvals waiting, someone off tomorrow, managers covering for an absent approver, and carried days about to lapse.
- **Year-end carry forward** (Settings → Year-end carry forward): previews and moves unused days up to each type's limit into next year, with an expiry date. Carried days are used first, and any left after expiry lapse. In the demo you can run it any time.
- **Unpaid leave in payroll**: approved unpaid days in the month are deducted as basic pay ÷ divisor × days, before EPF, SOCSO, EIS and PCB. The divisor is working days in the month (default), 26, or days in the month. It shows on the payslip and in the payroll export.

The leave rules (day counting, holidays, entitlements, balances, carry forward, approval chains, the unpaid deduction) are in `js/leave-rules.js`, with tests in `tests/leave.test.js`. **Check the built-in holiday dates against the official gazette** (kabinet.gov.my and the State Secretary) before using them for payroll: Islamic holidays can move by a day. Check the entitlements against the Employment Act 1955 and your contracts.

## Time attendance and rostering

- **Working patterns** (Settings → Working patterns): name, start and end, break, grace minutes for lateness and working days, as many as you like. A **Flexible** pattern has a window, core hours and hours a day. Set a pattern per department, or per person on their profile. **Auto-shift**: someone with no pattern gets the one whose start is closest to their check-in.
- **Schedule** (admin): a week grid of people × days. Click a cell to set a shift or a day off, **Copy last week**, or **Apply rotation** from a rotating roster (Settings → Rotating rosters; staggering starts each person a week further on). It warns on shifts that run into the next one, on shifts during approved leave, and on days below the team's minimum on shift. Staff see their roster on Home (My shifts) and My attendance.
- **Lateness, early-out and overtime** per day, from check-in and check-out against the shift, on Attendance and My attendance.
- **Overtime rules** (Settings → Overtime rules), defaulting to the Employment Act 1955: 1.5× on normal days; rest days 1.0× up to normal hours and 2.0× beyond; public holidays 2.0× up to normal hours and 3.0× beyond. Also: a different rate after midnight, a flat ringgit rate instead, early overtime before the shift, offsetting late minutes, rounding (15 or 30 minutes, down or nearest), a minimum and maximum per day and per month (warning above 104 hours), a dinner-break deduction, pre-approval, and a wage limit for who gets overtime.
- **Requests**: from My attendance, staff ask for overtime, a lateness waiver or an attendance correction, with a reason. They go through the same approval chain as leave (department L1 → L2 → HR, with backups) and show on Approvals and on the admin Attendance page. An approved correction updates the record.
- **Daily allowances** (Settings → Daily allowances): attendance, meal, transport, shift and custom. Each has a working-day, rest-day and holiday rate, and pays in full, in part or nothing when someone is late or absent.
- **Payroll**: approved overtime (hourly rate = monthly basic ÷ 26 ÷ normal hours, both editable) and the month's allowances are added to the pay run and payslip. Each line is flagged for EPF, SOCSO/EIS and tax as set in Settings; by default overtime is not EPF wages.
- **Audit trail**: every manual change to an attendance record (the pencil on Attendance, status buttons, clear, mark present, approved corrections) keeps who, when, and the old and new values. **Batch edit** changes a date range for everyone, a team or one person in one go, with a reason.

Try it: sign in as admin and open **Schedule**, then pick Engineering. Mon–Thu are below the minimum because Arjun is on leave. On **Attendance**, approve Amirul's overtime (go to the previous day to see it tagged), then run October payroll and open his payslip. Sign in as employee (Daniel) to see My shifts and to make a request. As backup for Arjun, Daniel can approve Jason's overtime under Approvals.

The rules are in `js/attendance-rules.js` (no DOM), with tests in `tests/attendance.test.js`. **Check the overtime rates, the 26-day divisor, the 104-hour limit and the EPF/SOCSO/PCB treatment of overtime and allowances** against the Employment Act 1955, KWSP, PERKESO and LHDN guidance before paying real wages.

## Notifications, reminders and announcements

- **Bell** in the top bar: the unread count, and a list where each item opens its page. Choose All or Unread, or Mark all read. On a phone the list opens as a bottom sheet; Escape closes it.
- **Events**:
  - leave, claim, overtime, lateness-waiver and correction requests: submitted (to the next approver, and the backup while they're away), next step, approved and declined (to the person);
  - payroll paid (HR) and payslip ready (everyone in the run);
  - new announcement or policy, and policy reminders;
  - roster changed (each person whose shifts changed);
  - flagged check-ins (HR).
- **Preferences** (Settings → Notifications, for everyone): for each category (requests, pay, announcements, roster, check-ins, reminders) choose in the app, by email, both or off.
- **Email-ready**: every email-routed notification is queued in `state.outbox` with a subject and body. Admins can preview them under Settings → Email outbox. Nothing is sent yet: plug a sender into `AllurusNotify.providers.email` (and `providers.push`) in `js/notify.js`; queued emails go out once it returns true.
- **Browser notifications**: turn them on under Settings → Notifications. New notifications caused by someone else pop up while Allurus is open, including changes made in another tab; clicking one opens the page.
- **Daily reminders** run once a day when the app loads, without repeating:
  - probation confirmation (30 days ahead), contract end (30), work permit (90) and passport expiry (180);
  - birthdays and work anniversaries;
  - statutory deadlines and CP22/CP22A;
  - appraisals not submitted (each person, plus one summary for HR).

  New employee fields: probation end, confirmed on, contract end, nationality, passport and work permit numbers and expiry dates. Reviews have a due date.
- **Announcements** (admin → Announcements):
  - Post an announcement or a policy with simple formatting (bold, italic, underline, lists, links; everything else is stripped), an optional attachment (PDF or image, up to 1 MB) and target departments.
  - Employees see them on Home and under Announcements.
  - Policies must be acknowledged with a tick box. Admins see how many have, who has, and can remind the rest.

Try it: sign in as admin and open the bell (statutory deadlines, CP22/CP22A, appraisals, Nurul's probation, Hilmi's contract, permit and passport, Nadia's birthday). Post a policy to Engineering, then sign in as Daniel: he has a 6-year work anniversary, the new policy to acknowledge, and his payslip notifications.

The rules (messages, preferences, delivery and reminders) are in `js/notify-rules.js` (no DOM), with tests in `tests/notify.test.js`.

## e-Invoice (LHDN MyInvois), ready to connect

- **Company details** (Settings → e-Invoice): TIN, BRN/SSM, SST and tourism tax numbers, MSIC code and business activity, phone and email, and the registered address in structured fields (lines, postcode, city, state code, country). A badge shows what is still missing.
- **Customers and suppliers** (Finance → Customers & suppliers): registered name, TIN, ID type (BRN, MyKad, passport, army ID) and number, SST, structured address, contact person, phone and email. Wrong formats are refused; missing e-Invoice details are allowed but flagged. Foreign buyers and suppliers use LHDN's general TINs (shown on the form). Existing invoice customers and bill suppliers became contacts in the migration.
- **Document types**: invoices, credit notes and debit notes (which change what an unpaid invoice is owed) and refund notes (money paid back on a paid invoice, posted to the books as negative income). Bills can be marked **self-billed**, so the company issues the e-Invoice with the vendor as supplier (self-billed invoice, type 11).
- **Builder**: `AllurusEInvoiceRules.build()` maps an invoice, note or self-billed bill into the MyInvois JSON document (UBL 2.1: parties with TIN, BRN, SST and TTX, addresses, tax totals, lines with classification and unit codes, billing reference for notes). Line taxes always add up to the document tax.
- **Check before submitting**: each invoice has an e-Invoice panel. *Check and view JSON* lists every missing mandatory field by section (document, lines, supplier, buyer) with a link to fix it, plus warnings (for example an issue date more than 72 hours ago), and lets you download the JSON.
- **Statuses ready for the API**: Draft (not submitted), Submitted, Valid, Rejected (with LHDN's error codes) and Cancelled, with the UUID, submission ID, long ID, times and the validation-link placeholder. A valid e-Invoice can be cancelled only within 72 hours of validation; after that the app points to a credit note.
- **Integration stub**: `AllurusMyInvois.submitToMyInvois(doc)` in `js/myinvois.js` does not call LHDN. It explains what a server needs and documents the OAuth 2.0 client-credentials sign-in, document signing (version 1.1), submission, polling, document details and cancellation. A server plugs in through `AllurusMyInvois.transport`. Until then the demo can simulate a valid or rejected answer; simulated documents are labelled Demo.

The rules are in `js/einvoice-rules.js` (no DOM), with tests in `tests/einvoice.test.js` (builder output for every seeded invoice, the credit note and the self-billed bill; missing fields; the cancellation window). **The code lists (document types, states, tax types, classifications, general TINs), the document structure and the validation-link pattern carry `FORMAT: verify against the LHDN MyInvois SDK` comments. Check them at sdk.myinvois.hasil.gov.my before going live.** Digital signatures and the client secret belong on a server, never in the browser.

## Reports and project costing

- **HR reports** (Insights → HR reports): a library of ready reports, each with a date range (plus quick picks), department and employee filters, a table with totals, a chart in the app's style, and CSV or print (save as PDF):
  - People: headcount by department (on the end date, with joiners and leavers), joiners and leavers, turnover rate (leavers ÷ average of start and end headcount, by month and annualised).
  - Pay: payroll summary with month-on-month variance (gross, deductions, net, employer contributions and cost), statutory contributions (EPF, SOCSO and EIS employee and employer, PCB, zakat, HRD levy).
  - Time: overtime by person or department (from attendance and the overtime rules), lateness and absenteeism, leave taken by person or type with this year's annual balance.
  - Money and dates: claims by category, birthdays, confirmations due.
- **Custom report writer**: pick a data source (employees, attendance, leave, payroll or claims), tick the columns, add filters (is, contains, more or less than, empty), group by a field with totals, averages, lowest or highest, and sort. Save the definition to reuse it; saved reports sit under Custom in the library.
- **Project costing** (Insights → Project costing): projects → job groups → jobs, each job with target hours and a budget. Time comes from check-ins, where people pick a project or job (the picker lists jobs under each project), split across the projects picked during the day, and from timesheets (HR logs time for anyone; staff use Me → Timesheet). A timesheet for a day replaces that day's check-in time, so nothing is counted twice, and a day can't go over 24 hours.
- **Labour cost**: hours × each person's hourly cost = (monthly basic + employer EPF + SOCSO + EIS) ÷ standard hours (working days × normal hours from the overtime settings, 26 × 8 = 208 by default). The month's pay run is used when there is one; otherwise it is estimated from salary.
- **Costing reports**: monthly man-hours by project, wages by project, target vs actual hours per job, budget vs actual cost per job, and hourly cost by person, with CSV and print. Jobs over target or budget are flagged on the project page and in Focus for today.

The aggregations are in `js/report-rules.js` and the costing maths in `js/costing-rules.js` (both without DOM), with tests in `tests/reports.test.js` and `tests/costing.test.js`. Project cost here is labour only; materials and other costs are not included.

## HR admin: employee file, onboarding, assets, org chart and letters

- **Employee file** (open anyone under Employees): tabs for Summary, Personal, Career, Documents, Assets and Checklists. Personal holds IC or passport, nationality and work permit, home address, personal email, emergency contact, bank and statutory numbers, education and previous employment.
- **Career history**: joined, promotions, transfers and increments with dates. Changing the job title, department or salary in the employee form adds an entry automatically, and so does an appraisal increment or promotion when it takes effect. HR can add or remove entries by hand.
- **Detail change requests**: employees ask to change their phone, personal email, address, marital status, emergency contact or salary bank account from Profile. HR sees them at the top of Employees, approves or declines with a reply, and both sides are notified. Job, pay and statutory numbers are only changed by HR.
- **Onboarding and offboarding**: adding an employee (including Onboard on a hired candidate) creates a checklist from the template: documents to collect, accounts to create, assets to issue and training, each with an owner (HR, IT, payroll, the manager or the employee) and a due date counted from the start date. Start offboarding sets the last day and reason and creates the leaver checklist: resignation letter, CP22A/CP21 (links to the payroll form), handover, exit interview notes, asset return (done once everything is back), account closure, final pay and certificate of service. Owners see their tasks under Approvals and on the home page; overdue tasks are reminded weekly. Templates and the IT and payroll owners are under Settings.
- **Assets, loans and insurance**: an asset register (laptops, phones, access cards, vehicles and more) with tag, serial, value, purchase, issue and return dates and history, plus a CSV export; staff loans with equal monthly instalments, extra repayments and balances; insurance policies with insurer, cover, premium and expiry. Assets still held by leavers are flagged.
- **Org chart**: built from each person's "Reports to", filterable by department (managers above are kept for context) and printable.
- **Letters**: templates for offer, confirmation, increment, warning, transfer and resignation acceptance, with `{{placeholders}}` (employee, manager, company, signatory, dates and amounts). Generate one from an employee's Documents tab, edit the wording, then save it to their documents and print or save as PDF. Unknown placeholders are refused when you save a template; empty ones show as [placeholder] in the letter. Have a lawyer check warning and termination wording.
- **Documents**: photos (resized) and PDFs up to 700 KB, with a type and optional expiry date. HR and the employee are reminded 60 days before a document expires; insurance policy expiry is reminded too.

The rules (edit requests, checklists, org tree, loans, letters, career history and expiry) are in `js/hr-rules.js` (no DOM), with tests in `tests/hr.test.js`. Loans are records only: payroll does not deduct the instalments yet. Documents are stored in the browser with the rest of the demo data, so keep uploads small until there is a server.

## Talent: recruitment, training, grievances and meeting rooms

- **Requisitions** (Recruitment → Requisitions, or “Request a hire” for managers under Approvals): title, department, type, headcount, salary range, reason and why it's needed. It goes through the department's approval chain (the same one as leave), then HR. Approval opens the role with text from the chosen job post template.
- **Job posts and the careers page**: job post templates (Settings → Recruitment templates) fill the role's “About”, “What you will do”, “What you bring” and “What we offer”. Ticking “Show on the careers page” publishes it at a public, no-sign-in link per company: `#careers/<company id>` (Recruitment → Jobs and careers page → Copy link). The application form asks for name, email, phone, a link, a note, where they heard of you, and PDPA consent; it rejects duplicate applications and lands the candidate in Applied with the source “Careers page”. *In this demo the careers page saves to the same browser's storage, so it only works on the device the company uses. Going live needs a backend endpoint for applications.*
- **Candidates**: open a card for stage dates, interviews, scorecards and offers; move forward, or mark “Not progressing”. Every stage change records its date (used for time to hire).
- **Interviews**: date, time, in person (with a meeting room booking) or video/phone, and interviewers. The form warns when an interviewer is on leave or has another interview then, and blocks a clashing room. Interviewers get a notification and fill in a 1–5 scorecard per area (Settings) with a recommendation under Approvals.
- **Offer letters**: pick a template, set salary, start date, probation and reply-by date; the letter fills `{{placeholders}}` from the candidate and role, can be edited, is saved on the candidate and prints or saves as PDF. Mark it Accepted (moves to Hired, ready to Onboard) or Declined.
- **Hiring analytics**: candidates and hires in a date range, average and median time to hire (applied → hired), candidates and hire rate by source, and stage conversion (how many reached each stage, and the share from the stage before).
- **Job boards**: `postToJobBoard(board, job)` in `js/recruit.js` is a stub for Indeed, MyFutureJobs (PERKESO) and JobStreet. It returns “not connected” and the screen offers “Copy job text” to paste into each portal. `// FORMAT: verify` notes describe what each integration needs.
- **Training** (Talent → Training): courses with modules (text, a video link or a PDF link), an optional quiz with a pass mark (written as `Q:` lines with `*` marking the right option), hours, provider, certificate validity in months, and an **HRD Corp claimable** flag with the fee. Courses can be mandatory for everyone, chosen departments or job titles containing a word (for example “Manager”).
- **Compliance**: a matrix of people × mandatory courses (current, expiring with days left, in progress, not started, overdue, expired), filter by department, CSV, and “Assign what's missing”, which enrols new joiners and assigns renewals for certificates expiring within 60 days. A renewal assigned early does not hide a certificate that is still valid.
- **Certificates**: passing the quiz (or finishing every module when there is no quiz) issues a numbered certificate, printable as PDF. Expiry dates feed the daily reminders (60, 14 and 0 days, to HR and the employee) and insights.
- **Training requests**: staff ask for external courses or events (provider, dates, fee, HRD Corp claimable) from My training. Requests go through the approval chain; HR can mark them attended. Apply for HRD Corp grants on the HRD Corp portal before the course starts; Allurus only keeps the flag.
- **Grievances** (Talent → Grievances; staff use “Raise a concern”): category, priority, subject and details, with an option to keep their name from their department. Concerns go to the grievance managers in turn (Settings). Status flow New → Acknowledged → Investigating → Resolved → Closed (resolving needs a written outcome; a resolved case can be reopened). SLA days to acknowledge and resolve per priority are editable in Settings; the list shows days left or days over. Anonymous cases show “Anonymous” even to grievance managers until one reveals the name, which is recorded on the case. Internal notes are hidden from the raiser. The summary report (by category, status and priority, SLA met, average days to resolve) and its CSV contain no names.
- **Meeting rooms** (Company → Meeting rooms): rooms with seats, location and equipment; a day calendar per room (tap an empty hour to book); a booking form that checks clashes, seats and past times as you type and suggests free rooms; My bookings; HR adds rooms and can cancel any booking (the owner is told). Interview room bookings show in gold.

The rules (hiring analytics, application checks, scorecards, slot and room conflicts, interview clashes, mandatory courses, quiz scoring, course status and certificate expiry, compliance, grievance SLAs and summary) are in `js/talent-rules.js` (no DOM), with tests in `tests/talent.test.js`.

## Appraisals and goals

- **Templates** (Settings → Appraisal templates): sections for KPIs, competencies and values, each with a weight; questions with their own weight and an optional comment box; a 1–5 scale or a custom one (for example 1–4 or 0–10). Assign a template to departments or to named people; otherwise the cycle's template is used. A sales template comes with the demo.
- **Grade bands** (Settings → Grade bands): the score a grade starts at, plus the guideline increment % and bonus months. These are company policy, not statutory rates, and you can edit them.
- **Review cycles**: HR launches a cycle (Performance → Launch a cycle) with the template, the period, a due date for each step, an optional second manager (L2), optional 360° feedback with a limit on how many peers, the month increments take effect, and the payroll month the bonus is paid in. You can include everyone or chosen departments.
- **Flow**: the employee does a self-review (save a draft, then submit) → L1 manager scores each item → optional L2 (the manager's manager) → HR final → completed. Someone without a manager goes straight from self-review to HR. Overdue steps are flagged, HR can remind people one at a time or all together, and a weekly reminder goes to whoever is holding an overdue step.
- **Scoring**: each rating is put on a 5-point scale, weighted within its section, then the sections are weighted. The grade comes from the bands. Managers see the employee's self-ratings and comments while they score, and the live score and band as they go.
- **Recommendations**: the manager's increment %, bonus months and promotion are prefilled from the band. L2 can adjust them, and HR approves or edits them at the final step, or sends the appraisal back with a note.
- **Pay changes**: approving creates scheduled changes (Performance → Pay changes). Payroll uses the salary in effect for each month: the increment counts from its effective month, the bonus is added to the chosen month's pay run (labelled on the payslip and handled like any other bonus in the pay calculation), and on the effective date the new salary and job title are written to the employee. Re-running an older month still uses the salary at that time.
- **360° feedback**: employees ask up to the cycle's limit of colleagues. Answers are combined, comments are shown without names, and nothing is shown until at least two people have answered.
- **Goals**: SMART goals (what, how it's measured, target, due date, why, weight) with check-ins that record progress, status and a note. Weighted goal progress shows on the appraisal and the home page.
- **Reports**: score distribution by grade and by department, completion by step, and a CSV export.

The rules (scoring, grades, the flow, 360° summaries, goals and pay changes) are in `js/appraisal-rules.js` (no DOM), with tests in `tests/appraisal.test.js`. One limit to know about: editing a template while a cycle is running changes the questions for appraisals already in progress.

## Payroll: EPF, SOCSO, EIS, PCB and HRD Corp

For Malaysian companies (currency MYR), every payslip works out the compulsory deductions:

- **EPF (KWSP)**: 11% employee; 13% employer up to RM5,000 wages, 12% above. Rounded up to the next ringgit.
- **SOCSO (PERKESO)**: 0.5% employee, 1.75% employer, on PERKESO's RM100 wage bands up to RM6,000.
- **EIS**: 0.2% each, same bands and ceiling.
- **PCB (monthly tax deduction)**: estimated from the LHDN resident tax bands, with the RM9,000 individual relief and up to RM4,000 EPF relief. Bonuses are taxed on the extra tax they cause. The admin can switch to a flat percent instead.
- **Zakat** through payroll (set on the employee) is deducted and offsets the PCB.
- **HRD Corp levy**: 1%, 0.5% or none, paid by the employer on basic pay.
- Staff aged 60 and over follow the senior rules: no employee EPF, 4% employer EPF, employer-only SOCSO, no EIS.

The payroll page shows what goes to **KWSP, PERKESO, LHDN and HRD Corp**, due by the 15th of the next month. Employer contributions are recorded in the books with the wages. Rates are editable under **Settings → Statutory deductions**. The figures are estimates, so check them against the official contribution tables and the LHDN PCB calculator before you pay.

## Payroll documents and statutory files

- **Payslips**: every payslip has **Print or save as PDF**. Admins can **Print all payslips** for a month, one per page. Staff save theirs from **Payslips** (on a phone: Share → Save as PDF). This uses the browser's print, so there is no PDF library.
- **Statutory files** (Payroll → Statutory files, once a run is paid): KWSP (EPF), PERKESO (SOCSO and EIS), LHDN PCB (CP39) and the HRD Corp levy. Each has:
  - a preview table;
  - totals checked against the pay run;
  - a list of missing IDs, with a Fix link;
  - a CSV download and **Mark as submitted**.

  The due date (the 15th of the next month) and the total to pay are shown at the top.
- **Bank file** (Payroll → Bank file): a generic GIRO / IBG CSV with name, IC, bank, account number, amount and reference. People with missing or invalid bank details are held back and listed; the file plus held-back amounts equal net pay. Bank-specific templates plug into `BANK_TEMPLATES` in `js/statutory.js`.
- **Year-end** (Payroll → Year-end and forms):
  - **Borang EA** per employee from the year's paid payslips, printable singly or all at once. **Issue to staff** shows it under the employee's Payslips.
  - **Form E** summary for HR.
  - **CP8D** CSV.
- **Joiners and leavers**: adding an employee prompts for **CP22** (due within 30 days of starting). Setting a last day prompts for **CP22A**, or **CP21** when they are leaving Malaysia (due 30 days before the last day). Both have printable forms, Mark as submitted, and dashboard reminders.
- **Employee record**: IC or passport number, EPF number, SOCSO number, income tax number, bank and account number, last day and reason for leaving. IC numbers (12 digits starting with a valid birth date) and account numbers are validated.
- **Company registration numbers** (Settings → Statutory registration): SSM, EPF employer number, SOCSO employer code, LHDN E number, HRD Corp MyCoID, address and the authorised officer.
- **Reminders** in Focus for today:
  - statutory payments within 14 days of the 15th, and when overdue;
  - an unpaid previous month;
  - EA by the end of February;
  - Form E and CP8D by 31 March;
  - each CP22, CP22A or CP21 due.

Try it: sign in as admin and go to Payroll. Go back to September, then open **Statutory files**: September's PCB is overdue in the demo. Then open **Bank file** (Hilmi is held back for missing bank details) and **Year-end and forms**: issue the EA forms, and open Nurul's CP22 and Iman's CP22A. Sign in as Daniel to save a payslip as PDF and view the EA under Payslips.

The builders are in `js/statutory.js` (no DOM), with tests in `tests/statutory.test.js` run against the seeded payroll. **None of the files claim to be the official upload layouts.** Each builder carries a `FORMAT: verify against …` comment. Check the KWSP, PERKESO, LHDN (CP39, EA, Form E, CP8D, CP22, CP22A, CP21) and HRD Corp specifications and your bank's bulk payment template before submitting anything real.

## Claims

Employees claim work costs and medical bills under **Finance → Claims**; admins review them under **Finance & Accounting → Claims**.

- **Categories** (Settings → Claim categories): Travel, Mileage, Meals, Parking & toll, Accommodation, Phone, Training, Entertainment, Medical and Other, plus your own. Each has:
  - limits per claim, per month and per year (0 = no limit);
  - whether a receipt is required;
  - whether it is **taxable**;
  - the **GL category** it posts to in the books;
  - optional fields (purpose, from/to, city, nights, attendees).
- **Mileage**: distance × the company rate per km, seeded at RM0.60 for a car and RM0.30 for a motorcycle (editable), with from/to fields.
- **Multi-item claims**: one claim can hold several items, for example a trip with mileage, toll and a client lunch. Each item has its own category, date, merchant, receipt number, amount and receipt photo; the photo is read by the receipt scanner to fill the shop, date and amount. Limits are worked out across the items and shown as you type.
- **Medical** is one category. Its medical types keep their own yearly and per-claim limits and family cover (Settings → Medical benefits).
- **Approvals** use the same chain as leave: department L1 → L2 → HR, with backups while someone is on leave and an admin override. The approver sees every receipt side by side, what each item is allowed under the limits, and what the person has left this month and year.
- **HR corrections**: HR can correct an amount, approved amount, receipt number or merchant. A reason is required, and who, when, and the old and new values are kept on the claim.
- **Payment**:
  - Approved claims go to the **next payroll**. Non-taxable claims are reimbursed on top of net pay; taxable categories are added to gross pay, so PCB and Borang EA include them.
  - HR can also **Pay now**.
  - Either way the cost posts to the books under each category's GL account.
- **Reports** (Claims → Reports): claimed and approved amounts by employee, category, department or month for a year, with CSV export.
- **Old data**: medical claims saved by earlier versions are migrated into one-item Medical claims when the app loads.

Try it: sign in as admin and open **Claims**. Review Kevin's client visit (three items with receipts), correct the lunch amount with a reason, then approve twice (for Ravi, then as HR). Pay Ravi's KL roadshow now and check Bookkeeping. Run October payroll to see Michelle's taxable gym claim in gross pay. Sign in as Daniel and make a claim with mileage and a meal.

The rules are in `js/claims-rules.js` (no DOM), with tests in `tests/claims.test.js`; the seeded claims are also checked against payroll and the books in `tests/statutory.test.js`. **Check which reimbursements are taxable perquisites** with LHDN or your tax agent; the mileage rates are a company policy, not statutory rates.

## Employee finance

An employee's **Finance** menu holds **Payslips** (with every deduction itemised, and what the company pays on top), **Claims**, **Tax reliefs** and the **Financial planner**.

The planner starts from a regular month's take-home pay and adds any other income. The employee lists:

- what they must pay (loans, rent, bills), ticking the loans;
- their living costs;
- their savings.

It then shows:

- where the salary goes, from tax and contributions down to what's left to spend, as a month and a day figure;
- a checklist of bills to tick off as they're paid;
- their debt service ratio, which banks check before approving loans;
- an emergency fund target and a 50/30/20 check;
- their EPF growth.

## Selfie check-in

Employees check in with **Check in with selfie** on their Home screen:

1. The app reads the phone's GPS position. It must be inside the company's check-in zone. The default radius is 50 m. For Allurus HQ the point is 3°46'11.4"N 103°13'28.4"E.
2. The employee takes a selfie with the front camera.
3. The admin sees the selfie, the time and the distance from the check-in point on the **Attendance** page.

### Check-in location

Check-ins are measured only from the **check-in point** in Settings → Check-in location (latitude, longitude and radius). The **head office city** just places the company on the Allurus map. If no check-in point is set, check-ins are blocked (“Your admin hasn’t set a check-in location yet”) and Settings shows a warning. The coordinates field saves as you type or paste; no Enter needed.

- **Map picker** (Leaflet with OpenStreetMap tiles, no API key): tap the map to drop the pin, drag it to fine-tune, or search for a place. The circle shows the radius and updates as you type it. Moving the pin updates the coordinates field (6 decimals), and editing the field moves the pin. **Use my location** puts the pin at the phone's GPS position.
- **Coordinates field**: accepts `4.238203, 103.419428` or `3°46'11.4"N 103°13'28.4"E`. Values are stored as numbers, and invalid input shows an error next to the field.
- **Distance**: the Haversine formula in metres. A check-in counts if it is within the radius, plus up to 20 m to allow for GPS accuracy. When a check-in is refused, the employee sees how far away they are, the check-in point, their position and a small map.
- **Field staff**: an admin can let individual people (for example sales) check in from anywhere: open the person under **Employees** and turn on **Check in from anywhere**. The selfie, face check and phone lock still apply; only the location rule is lifted. Their GPS position is still saved with each check-in when the phone shares it, so HR can see where they were. Employees can't change this themselves. Like the check-in point, it travels to staff phones through the setup link (or `field` in `AllurusSeed.published`).
- **Staff phones**: in demo mode every browser keeps its own copy of the company. So that every phone still checks in against the point the demo admin sets, that point (coordinates, radius, name and field staff only) is also kept in the cloud database at `demoZones/<demo company>`. Phones pick it up when the app opens, when they come back to it, and every minute; when it changes they say so. This needs the `demoZones` rule in `firestore.rules` to be published. Until then, and offline, the **Copy setup link** in Settings still sets a phone's point. Phones start from the point published in `js/seed.js` (`AllurusSeed.published`). In cloud mode the settings are shared live anyway.

Run the unit tests for coordinate parsing and the zone check with `npm test` (Node 18 or later, no dependencies).

### Making sure it's really them

Logging in isn't enough on its own, because people can share passwords. Each check-in also confirms the phone and the face:

- **One phone per person.** An employee's first check-in registers that phone. Checking in from any other phone needs HR approval, so a friend's phone with the right password is blocked. A registered phone can't check in for anyone else.
- **Face check.** At the first check-in the employee agrees to the face check, and that selfie becomes their reference photo, which HR confirms. Every later selfie is compared with it on the phone using face-api (MIT, `js/vendor/face`). The selfie never leaves the device for this check. A clear mismatch must be retaken; after two tries the check-in is kept but flagged for HR. Selfies with no face, or with two faces, are refused.
- **Live camera only.** Uploading a saved photo is blocked unless HR turns this off.
- HR reviews new reference photos, phone requests and flagged check-ins under **Attendance → Check-ins, phones and faces to review**, with the reference and selfie side by side.

All three can be switched off under **Settings → Check-in location**. Faces are biometric data under Malaysia's PDPA, so the app asks for consent before enrolling a face. A photo or video of the employee held up to the camera can still fool the face check. Stopping that needs a liveness check, such as a server-side service like AWS Rekognition Face Liveness, once there is a backend.

Admins set the zone under **Settings → Check-in location**: paste coordinates from Google Maps or tap **Use my location**, then set the radius. You can also allow remote check-in, which still needs a selfie. Selfies are kept for 30 days.

GPS and the camera need HTTPS, such as the GitHub Pages site. The claude.ai preview link blocks both, so employees can't check in there.

Clients can **Register company** from the sign-in screen. That creates a new workspace on a 14-day trial, optionally filled with a sample team.

### Fake GPS, offline, kiosk and supervisor check-in

- **Fake-GPS checks** run on the phone at every check-in and flag (never block) a fix that has:
  - an impossible speed since this phone's last fix (over 300 km/h across more than 2 km);
  - an accuracy of exactly 0 m, or a whole number of 3 m or less;
  - coordinates rounded to 4 or fewer decimals;
  - exactly the same coordinates as on another day;
  - a device time zone more than 2.5 hours away from what the longitude implies.

  Flagged check-ins go to the review card on Attendance with the reasons; HR clicks **Looks fine** once checked. The thresholds are in `LIMITS` in `js/checkin-rules.js`.
- **Offline check-in**: every check-in is saved straight away and queued in an outbox on the device (`localStorage`). With no connection it is marked **Captured offline**, and the phone shows how many are waiting. When the phone reconnects (and every 30 seconds) the outbox sends them in order, with a growing wait after failures, and marks them synced. A small service worker (`sw.js`) keeps a copy of the app and the face-check models after the first visit, so the check-in page opens offline. It only runs over HTTPS or on localhost.
- **Kiosk**: Settings → Kiosks, supervisors and projects → **Make this device a kiosk** turns a tablet into a check-in kiosk.
  - Staff tap **Check in or out** and look at the camera; the face is matched against every **confirmed** reference photo on the tablet.
  - The kiosk shows the name with a 3-second countdown and **Not me**, then checks the person in, or out if they're already in. Two people who look too alike, or nobody close enough, means try again.
  - No password is needed. **Exit kiosk** needs an admin email and password.
- **Supervisor check-in**: department heads and approvers can **Check in a team member** from Home or My attendance. They take a photo of that person, which is compared with that person's reference photo; the supervisor's GPS and phone are recorded. Only people who already agreed to the face check, on their own phone, can be checked in this way.
- **Projects and jobs**: an optional or required project picker at check-in (also on the kiosk and supervisor check-in), with projects managed in Settings, for project costing later.

Try it: sign in as admin. On Attendance, Faizal's check-in is flagged (1 m accuracy and coordinates repeated from an earlier day); Amirul was checked in by Ravi, and Mei's was captured offline. In Settings, make this browser a kiosk (exit with `admin@allurus.com` / `1234abcd`). Sign in as Daniel with the network off to see an offline check-in sync when you reconnect.

The rules are in `js/checkin-rules.js` (no DOM), with tests in `tests/checkin.test.js`. The heuristics catch common mock-location apps, not a determined attacker; there is no server yet to send check-ins to, so in the demo "synced" means sent to the shared check-in log (on the published link) or accepted locally.

## Open it in VS Code for the Web (vscode.dev)

No build step is needed. The project is plain HTML, CSS and JavaScript.

1. Put this folder in a GitHub repository (or download it).
2. Go to **https://vscode.dev**. Choose **Open Remote Repository** and pick your GitHub repo, or choose **Open Folder** for a local copy.
   Shortcut: on any GitHub repo page, press `.` to open it in github.dev.
3. Install the **Live Preview** extension (Microsoft), right-click `index.html` and choose **Show Preview**.

To run it on your own computer, open a terminal in this folder and run `npx serve .` or `python3 -m http.server`. Then visit http://localhost:8000.

## Put it online for clients

To publish it on its own domain (https://allurus.my) with Firebase Hosting, follow [`docs/deploy-firebase-hosting.md`](docs/deploy-firebase-hosting.md): `firebase.json` and `.firebaserc` are set up, and pushes to `main` deploy automatically once the GitHub secret is added.

- **GitHub Pages:** Repo → Settings → Pages → Deploy from branch `main` / root. Netlify or Vercel also work: drag the folder in.
- Over HTTPS, check-in uses the device's real GPS location. The browser asks for permission first. If permission is refused, the app falls back to the city implied by the device's time zone and labels the location "approx.".

## Project structure

```
index.html          App shell: sign-in screen, sidebar, top bar
brand.html          Brand kit: logo, palette, type, usage rules
design-system.html  Live tokens and components
tests/              Unit tests (npm test): check-in geometry, leave rules, time attendance rules, statutory files, claims, check-in rules, notifications, appraisals, HR admin, reports, project costing, e-Invoice, talent, operations, the Suria demo
css/styles.css      Design tokens (light and dark) and all components
js/utils.js         Dates, payroll math (EPF, SOCSO, EIS, PCB), city table, location helpers
js/seed.js          Demo data: the Seri Maju Digital Sdn Bhd workspace and 14 subscribed companies; the demo company registry
js/seed-suria.js    Demo data: Suria Enterprise, a cili boh factory in Muar (?demo=suria)
js/seed-majorfe.js  Demo data: Major Far East Sdn Bhd, a hardware wholesaler in Kepong (?demo=majorfe)
js/ops-rules.js     Operations rules: stock, purchase orders, recipes, oldest-expiry-first picking, maintenance, aging
js/ops.js           Operations screens: stock, production, sales and delivery, machines, Operations today
js/geo-map.js       Check-in map picker, preview and place search (Leaflet, OpenStreetMap, Nominatim)
js/experience.js    Preferences, ⌘K palette, dashboards, setup, tour, help, live updates
js/leave-rules.js   Leave rules (no DOM): types, states, holidays, day counts, balances, carry forward, approval chains, unpaid pay
js/leave.js         Leave screens: apply, approvals, calendar, balances, leave settings
js/attendance-rules.js  Time rules (no DOM): patterns, auto-shift, lateness, overtime, caps, allowances, rosters, audit diff
js/roster.js        Schedule page, time settings, overtime/waiver/correction requests, audit trail, batch edit, payroll lines
js/statutory.js     Statutory builders (no DOM): payslip data, KWSP/PERKESO/CP39/HRD files, bank file, EA, Form E, CP8D, CP22/CP22A/CP21, reminders, ID checks
js/payroll-docs.js  Payroll tabs for statutory files, bank file and year-end; printable payslips and forms
js/checkin-rules.js Check-in rules (no DOM): fake-GPS heuristics, kiosk face matching, offline outbox sync
js/kiosk.js         Kiosk tablet, supervisor check-in, offline outbox, projects at check-in, flagged check-in review
sw.js               Service worker: keeps a copy of the app so check-in opens offline
js/notify-rules.js  Notification rules (no DOM): messages, preferences, delivery, daily reminders
js/notify.js        Bell and list, email outbox and provider hook, browser notifications, reminders run, announcements
js/appraisal-rules.js  Appraisal rules (no DOM): weighted scores, grade bands, flow, 360° summary, goals, pay changes
js/einvoice-rules.js e-Invoice rules (no DOM): document types and codes, MyInvois JSON builder, validation, statuses, 72-hour window
js/myinvois.js      MyInvois integration stub (submitToMyInvois) with the server-side OAuth and submission notes
js/einvoice.js      e-Invoice company settings, customers and suppliers, invoice and self-billed bill e-Invoice panels
js/report-rules.js  Report aggregations (no DOM): headcount, turnover, payroll variance, statutory totals, custom report engine
js/costing-rules.js Project costing maths (no DOM): job tree, splitting check-in time, timesheets, hourly labour cost, roll-ups
js/reports.js       HR reports library and custom report writer
js/costing.js       Projects, job groups and jobs, timesheets, costing reports
js/talent-rules.js  Talent rules (no DOM): hiring analytics, applications, scorecards, room and interview clashes, courses, quizzes, certificates, grievance SLAs
js/recruit.js       Requisitions, pipeline, interviews and scorecards, offer letters, analytics, job-board stub, public careers page
js/lms.js           Training: courses, modules and quizzes, mandatory compliance, certificates, training requests
js/grievance.js     Grievances: raise a concern, case handling with SLA, anonymity, summary report
js/rooms.js         Meeting rooms: day calendar, bookings with conflict check, my bookings, room admin
js/hr-rules.js      HR admin rules (no DOM): edit requests, checklists, org tree, loans, letters, career history, expiry
js/hr.js            Employee file tabs, change requests, onboarding/offboarding, assets/loans/insurance, org chart, letters, documents
js/appraisal.js     Templates and bands, review cycles, self/manager/HR scoring, goals, 360°, reports, pay changes
js/claims-rules.js  Claims rules (no DOM): categories, mileage, limits, edits, payroll split, GL rows, reports, migration
js/claims.js        Claims screens: multi-item claims with receipt scanning, approvals, corrections, reports, settings
js/planner.js       Employee financial planner
js/app.js           Views, routing per role, actions, registration, shared-link sync, Team access
js/cloud.js         Cloud mode: Firebase sign-in, invites, live sync (loaded only when configured)
js/cloud-map.js     How a workspace is split into Firestore documents, and the record-by-record merge
js/firebase-config.js  Firebase web config (null = demo mode)
firestore.rules     Who may read and write what in the cloud
js/vendor/          jsVectorMap (MIT) for the Super Admin world map; Leaflet 1.9.4 (BSD-2) for the check-in map
assets/             logo.svg, logo-mark.svg
docs/backend-plan.md  Plan for replacing localStorage with a backend (not built yet)
```

## Brand

| Name | Hex | Use |
|---|---|---|
| Allurus Teal | `#0F766E` | Primary: buttons, links, logo tile |
| Deep Teal | `#0B5F59` | Hover and pressed states |
| Champagne | `#D9B66F` | Accent: crossbar, highlights |
| Obsidian | `#16181D` | Text, dark surfaces |
| Slate | `#5F636B` | Secondary text |
| Mist | `#F5F5F7` | Background |

## How data is stored (read this before going live)

Allurus runs in one of two modes:

- **Demo mode** (the default, while `js/firebase-config.js` is `null`): each browser keeps its own copy in `localStorage`. A leave request made on one phone never reaches another device. When the app runs as a claude.ai artifact, company sign-ups and check-ins are also written to the artifact's shared database, so the owner sees them in the Super Admin console.
- **Cloud mode** (a Firebase config in `js/firebase-config.js`, which is set for the `allurus-hr` project; add `?demo` to the address to get demo mode instead): real sign-in with Firebase Authentication, and one shared, live copy of each company in Cloud Firestore. Changes reach every signed-in device within about a second, and Firestore keeps a copy on the device so offline check-ins and requests are sent when back online.

Setup takes about ten minutes on Firebase's free plan: see [`docs/firebase-setup.md`](docs/firebase-setup.md). In cloud mode:

- A company admin **registers the company**; HR invites staff under **Settings → Team access**; each person chooses **First time here? Set up your account**, confirms their email and signs in. Forgotten passwords are reset by email.
- **Who sees what is enforced on Google's servers** by [`firestore.rules`](firestore.rules): companies never see each other; payroll, finance, loans and pay changes are for Company Admins only; each employee gets their own full record and payslips, and only a directory card (name, role, team, contact) for colleagues; financial plans and tax reliefs are private to their owner. Employees can change only their registered phones and face reference on their own record.
- Records are merged one by one, so two people changing different records at the same time both keep their change. Photos and files are stored once and fetched only when shown.
- `js/cloud-map.js` lays out the documents and merges them (unit-tested in `tests/cloud.test.js`); `js/cloud.js` does sign-in and syncing.

Still to do before a full production launch (see [`docs/backend-plan.md`](docs/backend-plan.md)): manager-only visibility for team leave and claims, server-side payroll and statutory filing, the cloud list of companies in the Super Admin console, and Stripe billing.

# Allurus HR

People operations SaaS for growing companies: a minimal, Apple-style HRMS with three roles.

| Role | Who | What they can do |
|---|---|---|
| **Super Admin** | You, the Allurus owner | See every subscribed company on a world map, MRR and ARR, plans, invoices, trials, past-due and suspended accounts. Change plans and seats, suspend or reactivate a company, mark invoices paid, open any company's workspace. |
| **Company Admin** | HR at a customer company | Dashboard, employees, departments, attendance, time-off approvals, payroll with payslips and CSV export, a recruitment pipeline with drag and drop, performance reviews, and company settings. |
| **Employee** | Staff at a customer company | Time clock with location-stamped check-in and check-out, attendance history, time-off requests and balances, payslips, profile, goals, and the company directory. |

## Signing in

Everyone signs in with email and password. The sidebar's view picker shows only the views an account is allowed to use.

| Account | Views |
|---|---|
| `superadmin@allurus.com` | Super Admin, Company Admin, Employee, Auditor |
| `admin@allurus.com` | Company Admin, Employee |
| `emp@allurus.com` | Employee |
| `auditor@allurus.com` | Auditor (external accounting firm, read-only books, verifies reports) |

The demo password for all three is in your private notes. Change it under **Settings → Your account**. Companies that register create their own admin account, and that account gets the Company Admin and Employee views.

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

Try it: sign in as admin and open **Schedule**, then pick Engineering. Mon–Thu are below the minimum because Omar is on leave. On **Attendance**, approve Mateo's overtime (go to the previous day to see it tagged), then run October payroll and open his payslip. Sign in as employee (Daniel) to see My shifts and to make a request. As backup for Omar, Daniel can approve Ethan's overtime under Approvals.

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

Try it: sign in as admin and open the bell (statutory deadlines, CP22/CP22A, appraisals, Nurul's probation, Samuel's contract, permit and passport, Hana's birthday). Post a policy to Engineering, then sign in as Daniel: he has a 6-year work anniversary, the new policy to acknowledge, and his payslip notifications.

The rules (messages, preferences, delivery and reminders) are in `js/notify-rules.js` (no DOM), with tests in `tests/notify.test.js`.

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

Try it: sign in as admin and go to Payroll. Go back to September, then open **Statutory files**: September's PCB is overdue in the demo. Then open **Bank file** (Samuel is held back for missing bank details) and **Year-end and forms**: issue the EA forms, and open Nurul's CP22 and Julian's CP22A. Sign in as Daniel to save a payslip as PDF and view the EA under Payslips.

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

Try it: sign in as admin and open **Claims**. Review Lucas's client visit (three items with receipts), correct the lunch amount with a reason, then approve twice (for Noah, then as HR). Pay Noah's KL roadshow now and check Bookkeeping. Run October payroll to see Leila's taxable gym claim in gross pay. Sign in as Daniel and make a claim with mileage and a meal.

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
- **Staff phones**: in this demo every browser keeps its own copy of the settings (localStorage), so an admin's change never reaches other phones by itself. Phones start from the point published in `js/seed.js` (`AllurusSeed.published`); when HR moves the check-in point, either update that and bump `at`, or use **Copy setup link** to send staff a link that sets it on their phone. A real deployment would load this from a server.

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

Try it: sign in as admin. On Attendance, Yusuf's check-in is flagged (1 m accuracy and coordinates repeated from an earlier day); Mateo was checked in by Noah, and Mei's was captured offline. In Settings, make this browser a kiosk (exit with `admin@allurus.com` / `1234abcd`). Sign in as Daniel with the network off to see an offline check-in sync when you reconnect.

The rules are in `js/checkin-rules.js` (no DOM), with tests in `tests/checkin.test.js`. The heuristics catch common mock-location apps, not a determined attacker; there is no server yet to send check-ins to, so in the demo "synced" means sent to the shared check-in log (on the published link) or accepted locally.

## Open it in VS Code for the Web (vscode.dev)

No build step is needed. The project is plain HTML, CSS and JavaScript.

1. Put this folder in a GitHub repository (or download it).
2. Go to **https://vscode.dev**. Choose **Open Remote Repository** and pick your GitHub repo, or choose **Open Folder** for a local copy.
   Shortcut: on any GitHub repo page, press `.` to open it in github.dev.
3. Install the **Live Preview** extension (Microsoft), right-click `index.html` and choose **Show Preview**.

To run it on your own computer, open a terminal in this folder and run `npx serve .` or `python3 -m http.server`. Then visit http://localhost:8000.

## Put it online for clients

- **GitHub Pages:** Repo → Settings → Pages → Deploy from branch `main` / root. Netlify or Vercel also work: drag the folder in.
- Over HTTPS, check-in uses the device's real GPS location. The browser asks for permission first. If permission is refused, the app falls back to the city implied by the device's time zone and labels the location "approx.".

## Project structure

```
index.html          App shell: sign-in screen, sidebar, top bar
brand.html          Brand kit: logo, palette, type, usage rules
design-system.html  Live tokens and components
tests/              Unit tests (npm test): check-in geometry, leave rules, time attendance rules, statutory files, claims, check-in rules, notifications
css/styles.css      Design tokens (light and dark) and all components
js/utils.js         Dates, payroll math (EPF, SOCSO, EIS, PCB), city table, location helpers
js/seed.js          Demo data: the Lumen & Co. workspace and 14 subscribed companies
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
js/claims-rules.js  Claims rules (no DOM): categories, mileage, limits, edits, payroll split, GL rows, reports, migration
js/claims.js        Claims screens: multi-item claims with receipt scanning, approvals, corrections, reports, settings
js/planner.js       Employee financial planner
js/app.js           Views, routing per role, actions, registration, shared-link sync
js/vendor/          jsVectorMap (MIT) for the Super Admin world map; Leaflet 1.9.4 (BSD-2) for the check-in map
assets/             logo.svg, logo-mark.svg
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

This is a working **front-end prototype**. Each browser keeps its own data in `localStorage`. When the app runs as a claude.ai artifact, company sign-ups and check-ins are also written to the artifact's shared database, so the owner sees them in the Super Admin console.

A production version needs:
1. **A backend and database** (for example Supabase, Firebase, or Node/NestJS with Postgres). Each company's data gets a `tenant_id`.
2. **Real authentication** (email and password, magic links or SSO) with role-based access, replacing the demo role picker.
3. **Billing** (Stripe) for plans and invoices.
4. **Server-side payroll rules** for each country, plus audit logs.

The code is organized so each view reads from a single `state` object, which makes swapping `localStorage` for API calls straightforward.

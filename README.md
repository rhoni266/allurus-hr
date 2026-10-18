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

## Medical claims

Employees claim medical costs under **Finance → Medical claims**. They choose the type and who it was for, then snap or upload the receipt; the clinic, date and total are read from it. They can see how much they have left of each limit.

HR reviews each claim next to its receipt. The suggested approval amount is capped at the per-claim limit and the yearly balance, and a rejection needs a reason. Approved claims are added to the **next payroll** as a tax-free reimbursement and shown on the payslip, or HR can **pay now**. Either way the cost goes into the books as *Staff benefits*.

The claim policy is set per company: switch medical claims on or off, switch each claim type on or off, and set its yearly and per-claim limits, family cover, the receipt requirement and an eligibility period. The default types are typical for a Malaysian SME: outpatient GP, specialist, dental, optical, health screening, hospitalisation, maternity, vaccination, physiotherapy, traditional and complementary medicine, mental health, pre-employment check-up and other. HR can add their own.

## Employee finance

An employee's **Finance** menu holds **Payslips** (with every deduction itemised, and what the company pays on top), **Medical claims**, **Tax reliefs** and the **Financial planner**.

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

### Making sure it's really them

Logging in isn't enough on its own, because people can share passwords. Each check-in also confirms the phone and the face:

- **One phone per person.** An employee's first check-in registers that phone. Checking in from any other phone needs HR approval, so a friend's phone with the right password is blocked. A registered phone can't check in for anyone else.
- **Face check.** At the first check-in the employee agrees to the face check, and that selfie becomes their reference photo, which HR confirms. Every later selfie is compared with it on the phone using face-api (MIT, `js/vendor/face`). The selfie never leaves the device for this check. A clear mismatch must be retaken; after two tries the check-in is kept but flagged for HR. Selfies with no face, or with two faces, are refused.
- **Live camera only.** Uploading a saved photo is blocked unless HR turns this off.
- HR reviews new reference photos, phone requests and flagged check-ins under **Attendance → Phones and faces to review**, with the reference and selfie side by side.

All three can be switched off under **Settings → Check-in location**. Faces are biometric data under Malaysia's PDPA, so the app asks for consent before enrolling a face. A photo or video of the employee held up to the camera can still fool the face check. Stopping that needs a liveness check, such as a server-side service like AWS Rekognition Face Liveness, once there is a backend.

Admins set the zone under **Settings → Check-in location**: paste coordinates from Google Maps or tap **Use my location**, then set the radius. You can also allow remote check-in, which still needs a selfie. Selfies are kept for 30 days.

GPS and the camera need HTTPS, such as the GitHub Pages site. The claude.ai preview link blocks both, so employees can't check in there.

Clients can **Register company** from the sign-in screen. That creates a new workspace on a 14-day trial, optionally filled with a sample team.

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
css/styles.css      Design tokens (light and dark) and all components
js/utils.js         Dates, payroll math (EPF, SOCSO, EIS, PCB), city table, location helpers
js/seed.js          Demo data: the Lumen & Co. workspace and 14 subscribed companies
js/claims.js        Medical claims: policy, employee claims, HR review
js/planner.js       Employee financial planner
js/app.js           Views, routing per role, actions, registration, shared-link sync
js/vendor/          jsVectorMap (MIT) for the Super Admin world map
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

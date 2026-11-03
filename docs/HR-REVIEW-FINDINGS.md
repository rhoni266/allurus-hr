# Allurus HR: Detailed Review (client's-eye view)

Date: 3 Nov 2026. Reviewer: Claude. Read-only review; nothing was changed in your code.

## What I checked
- Read from the laptop copy of `allurus-hr`: `firestore.rules`, `firebase.json`, `js/cloud-map.js`, `js/utils.js` (payroll maths), `js/statutory.js`, the `*-rules.js` files, `functions/`, `scripts/`, `README.md`, `privacy.html`, `terms.html`, and the demo accounts doc.
- Ran the automated tests (`node --test tests/*.test.js`): **255 of 258 pass**. Details in section 6.
- Looked at the live site `allurus.my`. Its text loads from the database after the page opens, so I could only read part of it.
- **Not checked:** I did not click through every screen in the running app, did not run the Firestore rules tests (they need the Firebase emulator), and did not check the git history. Items marked "verify" are things I could not prove from the code alone.

## Summary
The foundations are better than most early products: server-enforced invoice locking, audited superadmin changes, trial and expiry rules, password rules with a breach check, and a large test suite. The invoice work from `INVOICE-SPEC.md` (units, Draft editable, Sent locks, Duplicate) is already in the rules and code.

The problems are in four areas. **Fix 1 and 2 before any real client enters real staff data.**

| # | Area | Severity |
|---|---|---|
| 1 | Any employee can read, and write, most company data directly in the database | High |
| 2 | Any employee can list every photo and file (selfies, face photos, IC, MC) | High |
| 3 | Payroll maths does not match the official rules in several ways | High |
| 4 | No server jobs: no emails, no scheduled reminders, no backups | High (feature gap) |
| 5 to 12 | Docs, privacy, public forms, kiosk, security headers, directory data, secrets, one fragile test | Medium and low |

---

## 1. Employees can see and change other people's data (High)

**What I found (confirmed in code).** The database rules give every record a "read class". Only a few lists are restricted (payroll, finance, loans, insurance, operations, saved reports). Every other list defaults to class `m`, which means **every member of the company can read it, and every member can write it**. See `bucketClass`, `readsClass` and `writesBucket` in `firestore.rules`, and the comment in `js/cloud-map.js`: "other buckets are for every member (leave, claims, attendance…)".

These lists are in that default group, because they are used in the app and appear in no restricted list: `leaves`, `claims`, `attendance`, `grievances`, `candidates`, `requisitions`, `letters`, `appraisals`, `reviews`, `announcements`, `assets`, and `settings` and `statutory` (for reading).

**What this means.** The screens hide these from staff, but the database does not. A staff member who opens the browser's developer tools could:
- read colleagues' claims (including medical claims), leave and MC details;
- read **who raised an "anonymous" grievance** (the raiser's `empId` is stored in the record; the anonymity is only on screen);
- read appraisal scores and pay-rise recommendations, candidate records and offer details, and HR letters (including warning letters);
- **write** to these lists: approve their own leave or claim, change attendance times, edit a grievance.

The README says the same about operations: "The page limits … are in the menus only."

**Suggested fix.**
1. Give each sensitive list its own read class: grievances, candidates, requisitions, letters and appraisal results readable by admins with the right area only. This is the same pattern already used for driver deliveries.
2. Split employee-owned records (leave requests, claims, attendance, goals) per person, readable by that person, their approvers and HR.
3. Make approval a controlled change: only an approver (not the requester) may change `status` to approved. This can be written as rules, or as Cloud Functions (needs Blaze).
4. Add rules tests for each (employee A cannot read employee B's claim; cannot approve their own).

## 2. Photos and files are readable by every employee (High)

**What I found (confirmed).** `blobs/{id}` rule: `allow read: if member(t) && canRead(t)`. That includes **listing the whole collection**. Blobs hold selfies, face reference photos, receipts, MC photos, and uploaded documents (README and `cloud-map.js`).

**What this means.** Any member can list and download every colleague's face reference photo (biometric data under PDPA), IC copies, MC and medical receipts.

**Suggested fix.** Store an owner and read class on each blob. Let a person read their own, and let HR/finance read by area. The blob id is a hash of the content, so you cannot rely on "nobody can guess it" once listing is allowed. Block `list` and allow `get` only.

## 3. Payroll maths versus the official rules (High, verify with an adviser)

The README says the payroll figures are estimates. For a product sold to Malaysian employers, these gaps matter:

| Item | What the code does | Concern |
|---|---|---|
| Foreign workers | `payCalc` in `js/utils.js` has no nationality input at all. Every worker gets Malaysian EPF 11%/13%, SOCSO and EIS. | EPF became mandatory for non-Malaysian employees from October 2025 (public reports say 2% employer, 2% employee). Foreign workers also have different SOCSO treatment and are outside EIS. The Suria factory demo suggests this is your target market. Verify the exact current rates with KWSP/PERKESO. |
| PCB (monthly tax) | Annualises the month's salary, allows only the RM9,000 personal relief and up to RM4,000 EPF. | No spouse or child reliefs, no TP1 declaration from the employee, no year-to-date tracking, no category. An employer can be liable for under-deducting. LHDN publishes the official computerised PCB method; the code should follow it. |
| EPF amount | `Math.ceil(wage × 11%)`. | KWSP's contribution table works by wage bands for lower wages, so the table amount can differ from a straight percentage by a few ringgit. Verify against the current KWSP table. |
| SOCSO wages | Overtime is excluded from SOCSO wages by default. | Verify whether overtime counts as wages for SOCSO. |
| Unpaid leave | Default divisor is working days in the month. | The Employment Act daily rate uses 26 days. Verify, and set 26 as the default if confirmed. |
| CP38 | Always 0. | If LHDN orders extra deductions for an employee, payroll will under-deduct. |
| HRD Corp levy | 1% of basic pay for all staff. | The levy base normally covers Malaysian employees only; verify. |

What is correct as far as I can tell: EPF employer 13% up to RM5,000 and 12% above; senior (60+) EPF employer 4%; SOCSO 0.5%/1.75% on RM100 bands to the RM6,000 ceiling, rounded up to 5 sen; EIS 0.2% each; resident tax bands; the RM400 rebate; Employment Act leave minimums (8/12/16 annual, 14/18/22 sick, 60 hospitalisation, 98 maternity, 7 paternity); overtime 1.5x/2x/3x; the 104-hour monthly overtime warning; filing dates (15th, EA by end Feb, Form E and CP8D by 31 March).

**Suggested fix.** Treat payroll as "estimate" in the product and contracts until it has been checked by a payroll specialist or compared against the official calculators using at least 20 sample employees. Add a nationality/worker-type field and an employee tax-relief declaration.

## 4. Nothing runs on a server yet (High as a feature gap)

- **Emails:** notifications are queued in `state.outbox` and nothing sends them (README: "Nothing is sent yet"). Payslip-ready, approval-needed and reminder emails do not exist.
- **Reminders:** the daily reminders run in the browser when someone opens the app. If nobody opens it, nothing fires.
- **Cloud Functions:** `functions/index.js` has only three POS functions (record payment, void/refund, shift). They need the Blaze plan to deploy. Without Blaze, the cloud POS cannot take payments, because the rules forbid browsers from writing payments.
- **Backups and retention:** I found no scheduled export or automatic deletion 90 days after a subscription ends, which the privacy notice promises.

**Suggested fix.** This is the strongest reason to fix the Google billing problem (or move to a service that avoids it). Plan the first functions: send email, nightly reminders, nightly backup export, retention clean-up.

## 5. Docs do not match the code (Medium)

- README says "this is still a front-end demo" and passwords are SHA-256 hashes in `js/seed.js`. The cloud version uses Firebase sign-in. The hashes are for the demo only.
- README says new companies get a **14-day** trial; the rules and the Terms say **30 days**.
- README says clients can "Register company"; the rules support both invite-only and self-signup.

Update the README so buyers and your coding agent are not misled.

## 6. Tests

- 255 of 258 pass in my run.
- `activation.test.js` and `catalog.test.js` failed only because I had not copied `js/vendor/common-passwords.txt` and `seed/features.json`. Not real failures.
- **One real fragile test:** `tests/einvoice.test.js`, "a self-billed bill puts the vendor as supplier…". It passes the fixed date `2026-10-19` as "today", but the seed data is built from the real current date. Since 19 Oct the seeded bill is dated "in the future", so the test fails. Fix the test to use the same `today` as the seed.
- I did not run `npm run test:rules` (needs the Firebase emulator and Java). Ask the agent to run it and send the result.

## 7. Public forms and the demo (Medium)

- `demoZones` can be **written by anyone without signing in** (for demo ids `serimaju`, `suria`, `majorfe`, `banafsha`), within value limits. Anyone could move the demo check-in point. If `banafsha` is a real prospect's workspace, remove it from this list.
- `enquiries` and `leads` accept public submissions with size limits but no rate limit or bot check. Add Firebase App Check or a captcha before launching ads.

## 8. Kiosk exit (Medium, verify)

`exitKiosk()` in `js/kiosk.js` checks the typed admin email and password against a local `accounts` list and a SHA-256 hash. That is the demo mechanism. In cloud mode the list may be empty, so nobody can exit the kiosk, or it may hold weak hashes. Ask the agent to test it in cloud mode and use a proper re-sign-in.

## 9. Security headers (Medium)

`firebase.json` sets good basics (HSTS, nosniff, referrer policy) but **no Content-Security-Policy**. The app builds HTML in about 36 places with `innerHTML` (and about 153 `esc()` calls, so most is escaped). Add a CSP and have the agent audit every `innerHTML` that includes user text. The announcement editor has its own sanitiser (`notify.js`); include it in the audit.

## 10. Privacy and terms (Medium; needs a lawyer)

- Both documents are marked **Draft**.
- The Privacy Notice is in English only. The PDPA expects notices in Malay and English.
- It does not mention face/biometric data, the 30-day selfie retention in the README, a contact for data requests beyond one email, or a breach process. The PDPA was amended in 2024 (breach notification and data protection officer duties came into force in 2025). Ask a Malaysian lawyer to review.
- Staff directory shows every member **full date of birth, gender, phone and registered phone IDs** (`DIRECTORY_FIELDS` in `cloud-map.js`). Consider day and month only, and drop `devices`.

## 11. Secrets and ownership (check)

- `js/firebase-config.js` says the Firebase project is owned by **rhoni.ent@gmail.com**. Confirm who that is and who controls billing. This may relate to your Google billing issue.
- `scripts/serviceAccount.json` exists on the laptop. It is listed in `.gitignore` (good). Confirm it was never committed: `git log --all -- scripts/serviceAccount.json`. If it ever was, create a new key and delete the old one. I did not open the file.
- `allurus-hr.zip` and `.env` files are ignored too; check no zip containing the service account was shared.

## 12. Smaller points

- Marketing site: parts load from the database after the page opens. Check in a normal browser that Modules, Industries and "Where we are today" show content, and that the brand name is the same everywhere ("Allurus" or "Allurus Enterprise").
- The README says selfies are kept for 30 days, but I found no automatic deletion (see section 4).
- Loans are records only: payroll does not deduct instalments (README).
- Job boards, bank file formats, KWSP/PERKESO/LHDN file layouts and MyInvois are all "ready to connect" stubs. None submit anything yet. The e-invoice phase dates for your clients depend on their revenue; check with LHDN.
- Editing an appraisal template while a cycle is running changes questions mid-cycle (README says so).

---

## Questions for you (answer later, then we fix)

1. **Who is rhoni.ent@gmail.com?** Is that you, a partner, or the company? Who owns the Google/Firebase billing account?
2. **First target clients:** factory or wholesale (foreign workers likely), cafe, or office? This decides how soon foreign-worker payroll is needed.
3. **Is `banafsha` a real prospect?** If yes, its demo workspace should not be publicly writable.
4. **Staff privacy:** should employees ever see each other's leave? (A team calendar is useful, but reasons and MC are private.)
5. **Anonymous grievances:** who should be able to see the raiser's identity: nobody, one named person, or the grievance managers when revealed?
6. **Approvals:** are you happy to wait for Blaze to enforce approvals on the server, or should the first fix be rules only (no Blaze)?
7. **Payroll accuracy:** do you have a payroll accountant who can check 20 sample payslips against the official calculators before the first client?
8. **PCB:** will clients supply TP1 forms (spouse, children, reliefs), or should Allurus ask employees to enter them?
9. **Unpaid leave divisor:** default to 26 days (Employment Act) or to calendar working days?
10. **Overtime and SOCSO:** do you want overtime counted in SOCSO wages by default?
11. **Languages:** English only, or also Bahasa Malaysia for the app and privacy notice?
12. **Backups:** how often, who may restore, and how long should deleted data be kept?
13. **Was `serviceAccount.json` ever committed or shared?**
14. **Who is the DPO** (data protection contact) for Allurus, and who answers staff data requests?

## Suggested order of work
1. Fix the read/write rules for the default group (section 1) and blobs (section 2), with rules tests.
2. Fix the fragile e-invoice test and update the README (sections 5 and 6).
3. Resolve Blaze, then add the first Cloud Functions: email, reminders, backup (section 4).
4. Payroll accuracy: nationality field, TP1, official PCB method, checked by an adviser (section 3).
5. Privacy notice in two languages, kiosk exit, CSP, App Check (sections 7 to 10).

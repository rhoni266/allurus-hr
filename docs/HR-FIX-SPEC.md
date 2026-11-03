# Allurus HR: Fix Spec 1 (Instructions for the coding agent)

Read `docs/HR-REVIEW-FINDINGS.md` first. It lists what was found and why. This file says what to do about it, using the owner's answers below.

## CURRENT SCOPE (read this first)
**Do only Task 8 (staff invitation by link, initiated by the admin only) for now.** Do not start Tasks 0 to 7 until the owner says so. Task 8 touches the sign-up rules, so follow its security and test requirements. Everything else in this file is background for later.

## Owner's decisions (final unless the owner changes them)
1. The Firebase project owner (rhoni.ent@gmail.com) is the owner. Billing is the owner's.
2. First clients: a factory and **Major Far East Sdn Bhd** (hardware and building materials wholesaler, Kepong). Expect foreign workers and mixed-nationality staff.
3. `banafsha` is a demo workspace, not a real client.
4. Employees **may see who is on leave and when** (team calendar), but never the reason, MC, notes or attachments.
5. **Anonymous grievances:** only HR (the grievance managers) can ever see the raiser's name, and only after a deliberate "Reveal". When HR reveals the name, the **raiser is told** (a notification saying HR revealed their name, by whom and when), and the reveal stays in the case history.
6. Approvals must be enforced on the server. Do the part that rules can do now (no Blaze needed), and do the rest with Cloud Functions when Blaze works. Tell me honestly which parts need functions.
7. A payroll accountant will check payslips later. Until then payroll stays labelled "estimate".
8. TP1 (employee tax declaration) comes later.
9. Unpaid-leave divisor: keep the current default (working days in the month) but make it a clear company setting. Add a note: "Employment Act daily rate uses monthly wages ÷ 26. Confirm with your accountant." Do not change the default without asking.
10. Overtime in SOCSO wages: make it an **optional company setting** (default off), with a short help text.
11. **Everything user-facing is bilingual: English and Bahasa Malaysia** (privacy notice, terms, staff app labels over time). Start with the legal pages and the sign-in / sign-up screens, then plan the rest.
12. **Backups every midnight, Malaysia time (Asia/Kuala_Lumpur).**
13. Unknown whether `scripts/serviceAccount.json` was ever committed. See Task 0.
14. There is no data protection officer (DPO) yet. Leave a clear placeholder and tell the owner what to fill in. Do not invent a name.
15. **Exception for Major Far East:** its crew are low-labor staff, many without email. Staff invitations must **not** depend on email for this company. The admin sends each person a **registration link** (for example by WhatsApp) and the person registers from it. Other companies keep the email invitation. See Task 8.

## Rules of work (same as before)
- **Study first, then ask.** Summarise in 10 lines what exists for each task, show a short plan, and wait for my OK before changing code.
- Small steps. After each step tell me exactly what to run and what to look at.
- Do **not** commit, push, deploy rules, or deploy functions without my go-ahead. Show me the rules diff before I publish.
- Do not add a library or paid service without asking. Cloud Functions need the Blaze plan; remind me and do not deploy.
- Money stays integer sen in code, DD/MM/YYYY, Asia/Kuala_Lumpur.
- No real staff data exists yet, so migration can be done carefully on test data. Still write a **dry-run first** for any data move, and keep the old buckets as a backup until I approve removal.

## Task 0: Safety check (do first, 5 minutes)
1. Run: `git log --all --oneline -- scripts/serviceAccount.json` and `git log --all --oneline -- "*service-account*.json"`. Report the output to me.
2. If anything is listed, tell me; I will create a new key in Firebase and delete the old one. If nothing is listed, say so.
3. Confirm `allurus-hr.zip` and `scripts/serviceAccount.json` are not inside any folder that is deployed to hosting (`firebase.json` ignore list) and not in the GitHub repo. Report.

## Task 1: Stop employees reading and writing each other's data (High)
**Problem.** Lists not named in `bucketClass` default to class `m` (every member reads and writes). See `firestore.rules` (`bucketClass`, `readsClass`, `writesBucket`) and `js/cloud-map.js`.

**Target access (agree the table with me before coding):**

| Data | Who reads | Who writes |
|---|---|---|
| Leave requests | the employee, their approvers (L1/L2/backup), HR (people or time area) | the employee creates a pending request; only an allowed approver or HR changes the decision |
| Team leave calendar | all members, **a separate safe copy** with name, dates and type group only | derived from leave; no reason or attachment |
| Claims and receipts | the employee, their approvers, claims area (HR/finance) | the employee creates and edits only while pending; approvers decide; HR corrects with a reason |
| Attendance | the employee, their manager, time area. A separate safe "who is in now" view for the dashboard if needed | check-in by the employee (own record only); corrections by approvers/HR |
| Grievances | grievance managers (HR) only; the raiser reads their own case without the internal notes | the raiser creates; managers update |
| Candidates, requisitions, offers | talent area; interviewers read only the candidates assigned to them | talent area; interviewers write only their own scorecard |
| HR letters | people area; the employee reads their own letters | people area |
| Appraisals and reviews | the person (own), their manager chain, talent area. 360 feedback stays anonymous | per the appraisal flow |
| Assets | people area; the employee reads their own | people area |
| Settings | split: a member-visible part (company name, work week, holidays, leave types, claim categories) and an admin-only part (bank and DuitNow details, statutory numbers, approver rules, kiosk settings) | settings area |
| Statutory bucket | payroll area | payroll area |
| Announcements | all members | HR / settings area |

**How.**
- Use the existing pattern for driver deliveries (per-owner buckets such as `ops.dos~<empId>`) for per-person data. Propose the exact bucket layout and how `js/cloud.js` loads it for approvers and HR (some people need several owners' buckets).
- Requests carry `requesterId`; the rules must stop the requester changing `status`, `approver`, `decidedBy`, `approvedAmount` or any server-owned field on their own record.
- Be honest about limits: Firestore rules allow only a few `get()` lookups per request. Tell me what the rules can enforce (requester cannot approve; only a listed approver or HR can decide) and what needs Cloud Functions (checking the whole approval chain, step order, backups of the decision). Build the rules part first. Mark the function part as "needs Blaze".
- Add `tests-rules/` tests for every row of the table: employee A cannot read employee B's claim, leave, grievance, appraisal, letter; cannot approve their own leave or claim; cannot change attendance of someone else; cannot list `settings` admin part; HR/approvers can. Run them with the emulator and show me the result.
- Update `js/cloud-map.js` and `firestore.rules` together (the file header says they must match) and update `tests/cloud.test.js`.

## Task 2: Photos and files (High)
- `blobs` must not be listable by every member. Give each blob an owner and a read class (the person who it belongs to, plus the area that needs it: HR for IC and documents, claims for receipts, MC for the approvers, attendance review for selfies and face photos).
- Allow `get` of a single blob only where the rules can prove access; deny `list`.
- Face reference photos and selfies: readable only by the person and HR (time area). Keep the 30-day selfie retention; the delete job comes with Task 6 (needs functions).
- Add rules tests: a normal employee cannot read or list another person's selfie, face photo, IC copy or MC.

## Task 3: Anonymous grievances (decision 5)
- The case stores the raiser, but only grievance managers/HR may ever see the name, only after "Reveal".
- Revealing: ask for a reason, record who and when in the case history, and **send the raiser a notification** ("HR revealed your name on case GR-…, on <date>, by <name>. Reason: …"). The raiser sees it in their own view.
- Anonymous means the department and the manager never see the name.
- The raiser must not be able to read internal notes. Test that.
- Show the owner in the final report how a reveal looks to both sides.

## Task 4: Team leave calendar and directory privacy (decision 4)
- Build the safe calendar copy (name, dates, half-day flag, leave group such as "Leave" / "Off"; no reason, no attachment, no sick/medical label if the owner prefers; ask me which labels to show).
- Directory: show colleagues the **day and month of birthday only** (no year), no `devices`. Ask me whether gender should be hidden from colleagues (likely yes).

## Task 5: Payroll: foreign workers and options (High, but do after Tasks 1 to 3)
Keep the label "Estimate. Check with your accountant" on payroll screens and files until I say the accountant has checked.
1. Add a worker type to the employee record: Malaysian citizen, permanent resident, non-citizen (foreign worker), with nationality and passport/permit already present.
2. Study the current KWSP, PERKESO and HRD Corp rules for **non-citizen employees** and for permanent residents (mandatory EPF for non-citizens began October 2025; SOCSO, EIS and levy treatment differ). Report the rules you found with sources and the date you checked, **and ask me before coding**. Do not guess a rate.
3. Make `payCalc` take the worker type. Add tests (one payslip per type).
4. Add the company setting "Overtime counts as SOCSO wages" (default off) with help text.
5. Make the unpaid-leave divisor setting visible with the note in decision 9. Do not change the default.
6. PCB: do not change the method yet. Write a short plan for replacing the estimate with the official LHDN computerised method, with TP1 inputs, and list the data needed. Wait for the accountant.
7. Check the EPF amount against the official KWSP contribution table for the wage bands and report any differences for sample wages (for example RM1,000 to RM6,000 in RM250 steps).

## Task 6: Server jobs (needs Blaze; plan now, build when Blaze works)
Write a short design only until I confirm Blaze works:
- **Midnight backup** (Asia/Kuala_Lumpur): scheduled Firestore export to a Cloud Storage bucket in Singapore, keep 30 daily backups, delete older. State the expected monthly cost.
- **Email sender** for notifications, payslip-ready, approval-needed, invitations (propose a service; ask before adding one).
- **Daily reminders** as a scheduled function (today they run only when someone opens the app).
- **Retention**: delete selfies after 30 days; delete a company's data 90 days after its subscription ends, as the Privacy Notice says.
- **Approval enforcement** parts that rules cannot do (Task 1).
- The POS payment functions already exist; list what is needed to deploy them.

## Task 7: Documents, privacy and small fixes
1. **README.md**: fix the demo-only statements (cloud sign-in is real; demo hashes are for demo only), the trial length (30 days, as in the rules and Terms), and how companies are created. Keep it short and true.
2. **Privacy Notice and Terms**: make both **bilingual (English and Bahasa Malaysia)**. Keep "Draft" on them. Add: face/biometric data and consent, selfie retention (30 days), what is stored on Google Cloud and where (region), how to make a data request, how a data breach will be handled, and a placeholder **"Data Protection Officer: <to be appointed by Allurus>"** with `hello@allurus.my` as the contact until I name someone. Do not claim legal compliance; tell me a Malaysian lawyer must review.
3. **Fragile test**: `tests/einvoice.test.js` "a self-billed bill…" uses the fixed date `2026-10-19`. Use the same "today" as the seed so it does not rot. Run the whole suite and show me the result.
4. **Public forms**: `demoZones`, `enquiries`, `leads` accept public writes. Keep `demoZones` for the demos, but propose App Check or a captcha, and a simple rate limit. Ask me before enabling App Check.
5. **Kiosk exit**: test "Exit kiosk" in **cloud mode**. It checks a local accounts list and a SHA-256 hash (`js/kiosk.js`). Report whether it works, and propose a proper re-sign-in with the admin's Firebase account.
6. **Content-Security-Policy**: propose a CSP header for `firebase.json` that does not break the app (Firebase SDK, Leaflet/OpenStreetMap, face and OCR models). Audit every `innerHTML` that includes user text. Show me the plan first.
7. Remove the stale statement in the README that selfies are deleted automatically until Task 6 is built, or say "planned".

## Task 8: Registration by link, no email (Major Far East exception, decision 15)
**Today.** An invitation is keyed by work email; joining needs that email confirmed (`invites/{email}`, `verified()` in `firestore.rules`, `js/activate.js`, `js/invite-rules.js`). That does not work for staff without email.

**Goal.** A per-company setting `inviteMode`: `email` (today's behaviour, default) or `link`. For `link` companies:
1. The admin picks an employee record and taps **Create registration link**. The app shows the link with **Copy** and **Send by WhatsApp** (a `wa.me` link with a ready message). No email is sent.
2. The link holds a long random single-use token (at least 128 bits). The database stores only its hash. It is tied to **one employee record**, expires (propose 7 days), can be **resent as a new link** (the old one stops working) and **revoked**. Record who created it and when.
3. The person opens the link, sees the company name and their own name, and creates a login. Propose the login ID: phone number or staff number (no email needed) plus a password. Reuse the password rules (`js/password-rules.js`) but explain them in simple words, in English and Bahasa Malaysia.
4. After registering, the token is used up. The person gets the employee app (check-in, leave, payslips, claims). They keep their face-check and phone rules as today.
5. **Password reset without email:** the admin issues a new reset link for that person (same token rules, audited). Staff can also change their password inside the app while signed in.
6. Shared phones: one login per person, but a phone may be used by several people one after another. Make sign-out easy and do not keep sessions open by default on a shared device. Ask the owner.
7. A person who only checks in at the **kiosk** or through a **supervisor check-in** may not need a login at all. Say so in the settings help text so the admin does not create accounts for people who do not need them.

**Security requirements (do not weaken):**
- The token cannot be guessed, is single use, expires, and is rate-limited. Anyone holding the link can register as that employee, so the link must be sent only to that person. Show this warning to the admin.
- The person's company, roles, permissions and employee record come from the **invitation**, never from the browser (as today).
- Firebase email/password sign-in needs an email-shaped ID. If you use a generated internal address (for example `<staffno>@<company>.login.allurus.my`), it must never be shown as a real email, never used to send mail, and must not allow signing up through the normal self-signup. Study alternatives (phone sign-in costs SMS and may need Blaze) and **recommend one with its cost and risk before coding.**
- The rules today require a verified email to create a profile. Explain how the link flow proves identity instead (token hash check in rules, or a Cloud Function that creates the account, which needs Blaze). Tell me which parts need Blaze.
- Add `tests-rules/` tests: a wrong, expired, revoked or reused token is refused; a valid token creates only the profile it was issued for; the new user cannot become admin; one token cannot register two people.
- Audit entries for: link created, resent, revoked, used, password reset.
- Notifications for people without email go **in the app**; email routing is off for them.

**Work email becomes optional (owner's decision).** The employee form must no longer require a work email. Today it is `required` in `js/app.js` (the add and edit employee form, near the `f-email` field), and the bulk-invite action refuses people without one ("they need a work email and no active account", near line 3153 of `js/app.js`). Change this as follows:
- Work email is **optional** for every company. If it is filled in, validate the format and keep it **unique within the company** (no duplicates). If it is empty, there is no uniqueness check.
- Email-mode companies: a person with no email simply cannot receive an email invitation; show "Add an email or use a registration link". Link-mode companies do not need email at all.
- **Find every place the email is used as an identifier or a requirement** and fix it. Known places to start: `tax reliefs` and `taxProfiles` are stored **by email** (`js/cloud-map.js` `personalFields` / `applyPersonal`, and `key()` in `js/tax.js`), so a person without email would lose their tax data. Re-key them by **employee id** with a migration (dry-run first; keep the old email-keyed copy until I approve). Also check: `users` and `invites` documents, the directory (`DIRECTORY_FIELDS`), notification routing to email (`js/notify.js`, `js/notify-rules.js`), the import tool (`js/import/`), reports and CSV exports, payslip and EA forms, and the demo/seed accounts. List each place and what you changed.
- Notifications for people with no email go **in the app only**. Email-routed events are skipped for them without errors.
- Tests: add an employee with no email; create their link; register; see payslips; set tax reliefs; get a notification in the app. Add a duplicate-email test (two people with the same email are refused; two people with no email are allowed).
- Show me the list of places before coding.

**Owner's answers (final):**
1. **Login ID = the person's IC number** (changed by the owner from the phone number). Take it from the IC already on the employee record and validate it with the existing `validIC` check in `js/statutory.js`. Refuse two active logins with the same IC in one company. If the IC is missing or invalid, the admin fixes the record before creating the link. A changed IC is changed by the admin with an audit entry.
   - **Foreign workers have no MyKad.** Ask the owner whether non-citizens log in with their **passport number** (the record already has `idType` passport). Support both types if the owner agrees.
   - The IC is personal data and is guessable (birth date plus place code), so the **password is the only secret**. Therefore: (a) never put the IC in the link, the WhatsApp message text, URLs, page titles or logs; (b) show a **generic** error ("ID or password is wrong") that does not reveal whether an ID exists; (c) add attempt limits / temporary lockout and tell me what Firebase Authentication already provides; (d) at registration the person must **type their IC**, and it must match the record, in addition to holding the link; (e) mask the IC on screen after login (last 4 digits); (f) explain to the owner that the internal sign-in name Firebase stores will contain the IC (visible only to the Firebase project owner) and propose how to reduce that (for example a company-scoped internal name rather than showing it anywhere in the app).
   - Mobile phone numbers are not used for login.
2. **A link lasts 7 days.** The admin can create links for many people at once from the staff list (a bulk action), then send each person their own link.
3. **All Major Far East crew get a login.** HR must see **who has not registered yet**: add a **Registration tracker** on the staff list and on the admin dashboard with a status per person: *No link yet*, *Link sent* (with the date), *Link expired*, *Registered* (with the date). One tap to resend or create a new link, and a filter "Not registered". Show the count ("12 of 40 registered"). Daily reminder to HR in the app while anyone is outstanding.
4. Check the IC numbers on the Major Far East records for missing, invalid and duplicate values and show HR a list to fix before links are created. (Phone numbers are still needed on the record so HR can send the link by WhatsApp.)

Still to decide with the owner while you study: shared phones (point 6 above) and whether a person with no smartphone should use the kiosk only. Ask these in one batch when you present your plan.

## Tests to run before saying done (each task)
- `npm test` and `npm run test:rules`, with the output pasted.
- For access changes: two test employees plus one approver and one HR in the emulator; show the allowed and the refused attempts.
- For the grievance reveal: screenshots or a clear description of what the raiser and HR each see.
- Existing tests still pass. Invoice rules and tests are not touched by this spec.

## Questions to ask the owner (batch them, do not ask one by one)
1. Which leave labels may colleagues see on the team calendar: just "Off", or leave type (annual, sick)?
2. Hide gender in the staff directory?
3. How long to keep daily backups (default 30 days)?
4. Who is the grievance manager list today (names or roles)?
5. For Major Far East and the factory: what worker types will you have first (Malaysian, PR, foreign)?
6. Which email service do you prefer, or should I propose one?

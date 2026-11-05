# Autopilot log (run order in docs/RUN-ALL-SPECS.md)

## Summary (read first)
- **Live now:** `main` at c651945 (cache v3.36) is on allurus.my, and the live Firestore rules are the same as `firestore.rules` on `main`. They were published by the owner on 5 Nov 2026, 10:14 UTC. Work email optional, Import fix, Bulk invite by IC, Company join page, Join key and Support access are all already on `main`.
- **Run stopped after step 0.** The live sign-up path no longer has the safeguards the specs require (see "Security gaps"). Fixing it means undoing commits the owner made on 4 and 5 Nov, and that is the owner's decision.
- **Check first:** the three security gaps below. Close **Open registration** for every real company, or set a join key, until they are fixed.

## 2026-11-05, step 0: branch tidy-up
Branch table, compared with `origin/main` (c651945):

| Branch | Not in main | Status |
|---|---|---|
| claude/bulk-ic-invite, claude/demo-company, claude/demo-zone-sync, claude/firebase-cloud, claude/firebase-hosting, claude/join-key, claude/location-help, claude/major-fareast, claude/one-domain, claude/open-join, claude/role-access, claude/suria-demo, claude/topbar-signout, claude/support-access | 0 commits | Fully merged, safe to delete |
| claude/statutory-claim-guide | 1 commit, an equal change is already in main | Safe to delete |
| claude/ic-staff-login | 1 commit (9 files) | Left in place; probably replaced by c19944e on main, check before deleting |
| claude/pcb-cp38-foreign-workers | 1 commit (4 files) | Left in place, unmerged |
| claude/landing-screenshots | 1 commit (12 images) | Left in place, unmerged |
| claude/upgrade-prompts | 1 commit (1 doc) | Left in place, unmerged |
| allurus-pos | 17 commits, no common history with main | Left in place |
| **claude/pos-wip** (new) | 1 commit | The other session's uncommitted `pos/` work, committed as-is. Not merged. |

I didn't delete any branches: the GitHub CLI isn't installed on this laptop, so I couldn't close branches or open pull requests.

Tests: `npm test` gives 326 passed, 0 failed. `npm run test:rules` **could not run**, because Java is not installed and the Firestore emulator needs it.

Rules backup: the live rules are saved to `docs/rules-backup/firestore.rules.2026-11-05`. They are identical to `firestore.rules` on main.

## Hard stops hit
1. **Blaze plan (hard stop 3).** Billing is off for project `allurus-hr`, and no Cloud Functions are deployed. Without them there is no server-side join check and no server-side lockout for wrong PINs. **Owner:** turn on Blaze if you want these.
2. **PIN without lockout (hard stop 7).** The spec says not to offer the 6-digit PIN without a per-account lockout on the server. `main` offers it anyway (commits 504c9cd and 8a02ee1), and it is live.
3. **Superadmin claim (hard stop 4).** I didn't set it. The owner runs `node scripts/set-superadmin.js <email>` from the repo root.

## Security gaps on live main (decision needed from the owner)
1. **Auto-approve with company code + IC (09259e0, 9f5ebb7).** While Open registration is on and no join key is set, the live rules let anyone who knows the company code and a person's IC register as that person, linked straight to their employee record. The spec requires the last 4 digits of the phone number and an HR notice or approval. An IC number is not secret.
2. **PIN saved on the phone (00e9341, the "never log out" change).** `js/cloud.js` saves the staff password or PIN in plain text in `localStorage` (`allurus_staff_session.pin`) and uses it to sign back in silently. Anyone with the phone, or any script on the page, can read it. Firebase already keeps the user signed in without storing the password.
3. **staffKeys can be read by anyone (3168864).** `staffKeys` allows `get` without sign-in and now holds `empId` and `name`. Anyone who knows a company ID and an IC can look up that person's name.
4. Phone binding (c651945) is checked only in the browser, so it can be bypassed. It is still worth having as a convenience.

Suggested fix, for the owner to approve: go back to "pending until HR approves" or add the phone last-4 check in the rules; remove the saved PIN; drop `empId` and `name` from staffKeys; hide the PIN option until Blaze and a lockout exist.

## Not done, and why
- Steps 1 to 4: already merged and live, so there was nothing to merge. I didn't check them against the specs in detail, because the gaps above come first.
- Step 5 (design standard): the run order says to start it only after steps 0 to 4 are merged and checked.
- Pull requests and preview checks: not possible without the `gh` CLI. **Owner:** run `winget install GitHub.cli`, then `gh auth login`.
- Rules tests: **Owner:** install Java (for example `winget install EclipseAdoptium.Temurin.21.JDK`).

## 2026-11-05, Role access with tick boxes (docs/ROLE-ACCESS-SPEC.md)
Pull request: https://github.com/rhoni266/allurus-hr/pull/12 (branch `claude/role-ticks`). **Not merged.**
Tests: `npm test` 326/326, `npm run test:rules` 123/123 (new `tests-rules/roles.rules.test.js`), run with a portable Java kept outside the repo.

### Study
- Admin pages with no area check: `settings` (its admin parts already check the Settings area, so it is left open for personal settings), `dashboard`, `guide` (information only, left open).
- Dashboard: Finance saw the attendance rate, who's on leave and open roles. Fixed: these tiles now need the matching area.
- Search: every admin saw every admin action (for example "Run payroll" for Finance). Fixed: actions follow the area of the page they open; person search opens the full profile only with Staff records or Payroll.
- Server: staff records, payslips, payroll, finance, stock, hiring, attendance and per-person documents are already refused to roles without the area (now covered by tests).
- **Gap left open (needs a migration, hard stop 5):** about 20 lists use read class `'m'` (every member reads **and writes** them): `reviews`, `goals`, `cycles` (read), `rosters`, `leaveCredits`, `leaveCarry`, `attAudit`, `assets`, `checklists`, `courses`, `enrolments`, `trainingRequests`, `costing.*` (project labour costs), `projects`, `rooms`, `bookings`, `announcements`, `notifications`, `outbox`, `jobs`. So Finance can read appraisals and any employee could overwrite them. Staff also use many of these for their own records, so the fix is to split them per person like attendance (`u:<area>:<empId>`) and move the existing data. That needs a dry-run migration and the owner's approval. Not done in this run.

### Built
- Team access: an **Access** button per person opens a panel with a role picker (Employee, the ready-made roles, Custom), tick boxes grouped Workforce, Business and Admin with what each covers, **All areas** (not Owner), a "Can open / Cannot open" summary and the POS role.
- Ticks switch the picker to the matching role or Custom. Areas you don't have are greyed out ("You don't have this area"), and Owner can only be given by an Owner.
- Last Owner: the panel and "Turn off access" both refuse with "Make someone else Owner first". The rules already make this safe: nobody can change their own access, and only an Owner can change an Owner.
- "An admin removes their own Settings area": not possible, because your own row has no Access button and the rules refuse changes to your own profile.
- Changes apply at once. The server refuses straight away (tested), and the person's app reloads with the new menu and shows "Your access changed". Each change gets an activity-log line (who, whose access, from what, to what) and the person gets an in-app notice.
- Invites: access chosen before an email invitation goes onto the invitation. **IC staff get their access after they register.** Decision: the join page lets anyone with code + IC register, so letting HR or Finance access ride on that path would let a stranger who knows the IC register into that role.
- Bugs fixed: `access()` in `js/cloud.js` turned any unknown role name into Owner. The old dropdown overwrote Team access's `pending()` method, which lists people waiting for approval.
- Rules: a person can no longer set their own `posRole` when creating their account (an invited person could have made themselves POS manager). A self-update must actually change `deviceId`, which fixes the failing activation test.
- Cache v3.37.

### Why not merged or published
- The Access panel only works signed in to the real cloud. Checking it on the preview means signing in as an admin, and I don't enter passwords. **Owner:** open the PR preview, sign in as an Owner, and try the Access panel on a test person (give Custom > Claims only, check, then untick it). Then merge PR #12.
- After merging, publish the rules: `firebase deploy --only firestore:rules` (live backup: `docs/rules-backup/firestore.rules.2026-11-05`). Check sign-in, add employee, a leave request and the join page.

## 2026-11-06, Bug fix: registration phone not saved to the employee record
Pull request: https://github.com/rhoni266/allurus-hr/pull/13 (branch `claude/join-phone`). **Not merged.**
Tests: `npm test` 329/329 (new `tests/phone.test.js`), `npm run test:rules` 111/111 (new `tests-rules/join-phone.rules.test.js`).

- Confirmed: the phone went only to `users/{uid}.phone`, and the whole save sat in one try/catch, so a failed save still showed "Pendaftaran Berjaya!". The personal link (`/join?k=`) uses the same steps and is fixed the same way. Email activation (`activate.js`) doesn't ask for a phone.
- Now the phone is normalised and checked on screen ("No. telefon tidak sah"; Skip still works). It is written to `people/{empId}.phone` only when that is empty. If HR already has a different phone, the new one goes to `phoneNew` with the date, and HR presses **Use it** or **Keep old** in the profile or in Team access.
- Saves are separate steps, each tried twice. If one fails, the person sees "Akaun dibuat tetapi maklumat belum disimpan. Sila maklumkan HR." and a note for HR (`tenants/{t}/joinIssues/{uid}`, no IC or phone) appears in Team access under "Registration problems", with an activity-log line.
- Team access also shows "Phone from registration" on a registered person's row until it is on their record.
- Rules: a person may set only their own empty `phone`, or `phoneNew` + `phoneNewAt`, in a valid shape (01… with 10 to 12 digits, or + and a country code up to 16 characters). No other field and no one else's record. `joinIssues` can be created only by that staff sign-in for its own company.
- **Hard stop 5, migration of people already registered:** `node scripts/migrate-join-phones.js` (dry run, counts only). Result on 6 Nov: **1 company, 3 registered people, 3 records would get their phone filled, 0 differ, 0 invalid.** **Owner:** check this, then run `node scripts/migrate-join-phones.js --apply` after PR #13 is merged and its rules are published.
- Not tested in a browser: reaching step 2 of the join page needs a real company code and IC on the live site. Only the code paths and the rules are tested. **Owner:** after merging, register a test person on the preview with a phone, then with Skip, and check Employees → their profile.
- Cache v3.38. PR #12 uses v3.37, so whichever merges second needs its version raised to v3.39.
- After merging: publish the rules (`firebase deploy --only firestore:rules`; the live backup is `docs/rules-backup/firestore.rules.2026-11-05`, or save a fresh one first if the rules changed since).

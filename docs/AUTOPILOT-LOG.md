# Autopilot log (run order in docs/RUN-ALL-SPECS.md)

## Summary (read first)
- **Live now:** `main` at c651945 (cache v3.36) is on allurus.my, and the live Firestore rules are the same as `firestore.rules` on `main`. They were published by the owner on 5 Nov 2026, 10:14 UTC. Work email optional, Import fix, Bulk invite by IC, Company join page, Join key and Support access are all already on `main`.
- **Run stopped after step 0.** The live sign-up path no longer has the safeguards the specs require (see "Security gaps"). Fixing it means undoing commits the owner made on 4 and 5 Nov, and that is the owner's decision.
- **Check first:** the three security gaps below. Close **Open registration** for every real company, or set a join key, until they are fixed.
- **2026-11-06: step 6, the POS public demo, was done separately** (branch `claude/pos-demo`, from `main`, not from this `claude/autopilot-log` branch's unmerged `role-ticks`/`join-phone` work) because the owner asked for it directly. It touches `pos/`, `firebase.json`, `sw.js` and the website's industries/footer only — no Firestore rules, no sign-up flow — so it doesn't depend on or resolve the security gaps above. See its own entry near the bottom of this file.

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

## 2026-11-06, POS public demo (docs/POS-DEMO-SPEC.md)
Branch `claude/pos-demo`, from `main` at c651945 (not from `claude/pos-wip`, which is left untouched per the run order). No PR opened: the `gh` CLI isn't installed here, same gap earlier entries note. **Owner:** `git push origin claude/pos-demo`, then open a PR at `https://github.com/rhoni266/allurus-hr/compare/main...claude/pos-demo`.
Tests: `npm test` 372/372 (29 original POS tests unchanged, plus new `pos/tests/demo-parity.test.js` (7), `demo-seed.test.js` (6), `demo-no-secrets.test.js` (3), `core-parity.test.js` (1)).

### What it is
`https://allurus.my/demo/pos` opens the full cafe till — Checkout, Waste, Stock, Today, Products — filled with a made-up cafe ("Kopi Demo"), entirely in the visitor's browser. Nothing reaches Google Sheets, Firebase or any server; two different browsers, or the same browser after **Reset demo**, see different (or fresh) data.

### How it was built
- **One shared engine, not two.** `pos/apps-script/Code.gs`'s money/stock/recipe/waste/purchase logic (everything except the HTTP layer and the script-editor admin functions) moved into `pos/shared/pos-core.js`, which picks its storage backend at load time: the real Google Sheet when `SpreadsheetApp` exists, or a `PosHost` the caller supplies otherwise. `apps-script/PosCore.gs` is a synced copy (`npm run sync-pos-core`; Apps Script needs the `.gs` extension) — `core-parity.test.js` fails the build if the two drift. This was the only way to meet the spec's "don't write the logic twice by hand": Code.gs's tests all still pass unchanged (29/29), and `demo-parity.test.js` runs the same cases (discount, SST, service charge, rounding, duplicate sale_id, void, recipe usage, waste + reversal, purchase + reversal) through both backends and checks they agree.
- **The demo backend** (`pos/demo/local-host.js`) is a `PosHost` backed by `localStorage` (key `allurus_pos_demo_v1`), with an in-memory fallback if `localStorage` throws (private windows). `pos/api-demo.js` gives `app.js` the exact same `window.PosApi` surface as the real `api.js`, with a 150-300ms delay so it still feels like a server.
- **The sample cafe** (`pos/demo/seed.js`) calls the real functions (`saveProduct_`, `saveRecipe_`, `createSale_`, `logWaste_`, `receivePurchase_`, `openContainer_`) rather than writing rows by hand, so every number it produces is something the real backend would also have computed. 23 menu items, 5 categories, most with recipes; 15 ingredients, several ending up below reorder after a believable week of sales (checked: none go negative); a week of backdated sales plus today's; a few waste entries; one delivery; one open container. A fixed PRNG seed makes it the same for every visitor; only the anchor date moves with today.
- **Demo-mode switch:** `pos/index.html`'s bootstrap script turns demo mode on at `/demo/pos`, at `/pos/?demo=1`, or whenever `config.js` fails to load (so a fresh checkout with no `config.js` gets the demo instead of a dead till) — and in demo mode `api.js` and `config.js` are never even requested (checked in a real browser: the network tab shows only the demo files, no `script.google.com`). `demo/demo-ui.js` adds the banner (Reset demo, Get Allurus) and sets `window.POS_CONFIG` since no `config.js` runs. `app.js` prints "DEMO – BUKAN RESIT SEBENAR / NOT A REAL RECEIPT" on receipts and bar tickets when `window.POS_DEMO_MODE` is set.
- **Hosting:** `firebase.json`'s `pos/**` ignore narrowed to just `pos/config.js`, `pos/apps-script/**`, `pos/tests/**`, `pos/tools/**`, `pos/docs/**` (config.js is also git-ignored, so it was never going to reach a git-based deploy either way — this matters for a local `firebase deploy`, which sweeps the filesystem, not git). Added the `/demo/pos` rewrite, a `Content-Security-Policy: connect-src 'self'` header on `/demo/pos` and `/pos`, and a `<base href="/pos/">` in `index.html` so relative asset paths still resolve once the page is reached by a path other than local dev's `/`. `pos/tests/demo-no-secrets.test.js` checks firebase.json's ignore list and scans every file it would actually serve for a real Apps Script URL or a filled-in `SECRET_KEY`.
- **Found and fixed along the way:** `sw.js`'s service worker cached *any* navigation under the `app.html` key — a visitor at `/demo/pos` would have silently overwritten the HR app's own offline shell with the POS page. Narrowed to `/` and `/app`; bumped to v3.37.
- **Restyled onto DESIGN-STANDARD-SPEC.md** (teal/champagne, self-hosted Inter in place of lime/Manrope — fetched from Google Fonts' own CSS2 API and bundled, so POS stays fully offline-capable) per the spec's own item 7, so the later `claude/design-standard` branch doesn't need to touch POS again. Checked in a browser across all 5 menu-category tints, the payment sheet and Products — no lime or Manrope left (grepped the whole `pos/` tree, not just style.css). Did **not** build the shared `/brand/tokens.css` file or a contrast-ratio script; those are that later branch's job across the whole site, and POS already matches the values it will define.
- **Links added:** "Try the POS demo" on the website's F&B industry card and detail dialog (`site/js/components/industries.js`, EN/BM via `site/js/i18n.js`), a footer "Demo" column, and a "Cafe POS" card in the HR app's own demo-company picker (`js/app.js`) — a plain link, not one of the `demo-company` toggle buttons, since those switch the HR app's own seed data and the cafe till is a separate static app.

### The two POS modules (owner's question)
- `pos/` (this one) is a single-outlet, Google-Sheet-backed till built specifically for F&B: it has real recipes and dish cost, an ingredient-level stock ledger, open-container tracking, waste logging and purchases with weighted-average cost — none of which the other module has yet.
- `js/pos.js` + `js/pos-rules.js` + `functions/pos-core.js` is the HR app's own POS, Firestore-backed and multi-tenant: any device signs into the same company's live data, and it already shares the HR app's roles, staff accounts and (per `pos-rules.js`) is meant to post sales straight to Finance — none of which `pos/` does.
- Card payments: `pos/` has no payment integration at all (cash/QR/card/e-wallet are just recorded labels); the HR app's POS already models "Card (terminal)" as a real payment outcome (approved/declined, last 4, approval code), with tap and QR flagged for phases 2–3.
- **Owner's own words call `pos/` "the latest," and this run agrees for day-to-day cafe operations:** its inventory/recipe/waste depth is what an actual kopitiam or café needs, so new F&B clients should be shown `pos/` (now the public demo, `/demo/pos`).
- A client already deep in the HR/payroll platform who wants a lightweight till tied to their existing staff logins, with everything in one Firestore workspace, is better served by the HR app's own POS today — `pos/` has no accounts, roles or multi-outlet sync at all. Closing that inventory/recipe gap in the HR module, or porting `pos-core.js`'s logic into it, is future work, not something this run touched.

### "Could not load the menu" (owner's laptop, 6 Nov)
Not reproduced or fixed: it needs the owner's live Apps Script deployment and Script Properties, which aren't reachable from here. The code path it would go through (`getProducts_` via `doPost`) is unchanged by the `pos-core.js` split — all 29 original tests, which exercise that exact path, still pass — so this is very unlikely to be a code regression from this run. Likely causes, to check on the laptop: `SECRET_KEY` in `config.js` not matching the Script Properties value, an old Apps Script deployment that was never redeployed as a new version after an edit, or a missing `Products` tab (`setup()` not run). Not a blocker for the demo, which runs its own backend.

### Decisions made on the owner's behalf (per RUN-ALL-SPECS.md's "decide yourself")
- "Copy files at deploy time" vs. "change the ignore list" (POS-DEMO-SPEC.md's own two options): chose the ignore list — fewer moving parts, and `pos/` already had no secrets outside the git-ignored `config.js`.
- No "simulate offline" switch: the spec made this conditional ("only if the app already has offline handling to show"), and while the till does have offline handling, adding a demo-only toggle for it felt like a feature add past the brief's actual ask; skipped.
- No language switch added: the real till has none today, and the spec says to add one "only if the till already has one."
- Kept the header logo as a plain lettermark tile (now teal, not lime) rather than importing `site/assets/logo-mark.svg`: that file's path only resolves once POS is actually deployed under `/pos/`, and getting it wrong in local dev felt worse than leaving it for `claude/design-standard`, which touches logos everywhere at once.

### Not done, and why
- **No real Firebase deploy was checked.** No deploy access here. Verified instead by reading the resulting `firebase.json`/`sw.js`, and by running the demo stack against a local static server (which has no routing, so `/demo/pos` and the `<base href>` rewrite couldn't be exercised end to end — only the regex and the file layout were checked directly). **Owner:** once the PR's preview channel deploys, open `<preview-url>/demo/pos` and check the network tab shows only requests to the preview's own origin.
- **Screenshots at 1024px and 390px:** the browser automation available here couldn't resize the window below its host display's own size (requests to resize were accepted but had no effect — `window.innerWidth` stayed 1280 regardless). 1440px wasn't reachable either, for the same reason; the 1280px screenshots taken are included below as the closest available stand-in for "desktop." The responsive CSS itself (breakpoints at 1199/999/767px) is untouched by this run (only colours and the font changed), so this is a low-risk gap, but **Owner:** please check 1024 and 390 on a real device or the browser's own responsive mode before calling this done.
- **No WCAG contrast-ratio check script.** DESIGN-STANDARD-SPEC.md asks for one; it's listed under that spec's own later `claude/design-standard` step, not this one.
- Private-window (in-memory) fallback and "two different browsers see separate data" are true by construction (ordinary `localStorage`, scoped per browser profile) and were checked by reading `local-host.js`, not by opening a second real browser profile here.

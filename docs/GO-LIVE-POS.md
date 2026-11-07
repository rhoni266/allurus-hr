# Go live: Allurus POS (runbook for the coding agent)

**Owner's instruction (7 Nov 2026): put the POS live now.** This is the owner's explicit go-ahead to merge into `main`, push, let GitHub Actions deploy allurus.my, and publish `firestore.rules`, following the steps below. Hard stops in `RUN-ALL-SPECS.md` still apply (no deleting data, no secrets in the repo, no messages to real people). You don't need the `gh` CLI: merge locally and `git push origin main`.

Do the steps in order. Don't skip step 1: real money moves through POS.

## Step 1: fix these before anything goes live
The owner's review on 7 Nov found these on `claude/pos-live` + `main`:

1. **Anyone can make themselves POS manager.** The `users/{uid}` **create** rule (open join, staff IC join and invite activation) doesn't stop the new profile from containing `posRole`. Someone who registers through the open join page can write `posRole: 'manager'`, and `Router.gs` (`effectivePosRole_`) then trusts it. Fix: on create, `!('posRole' in request.resource.data)` (this fix is already on `claude/role-ticks`; take it from there). Add a rules test for each create path.
2. **Endless trial.** The `addons.pos` trial rule lets a Settings admin write a new 30-day trial again and again, and could also overwrite an `active` (paid) status with `trial`. Fix: allowed only when `resource.data.get('addons', {}).get('pos', null) == null`. Add rules tests: start once OK; second start refused; overwrite active refused; superadmin extend OK.
3. **Provision double-click.** `provisionCompany_` checks the registry and appends without a lock, so two quick clicks can make two Sheets. Wrap the check, create and append in `LockService.getScriptLock()` (short wait, then check the registry again). Test it.
4. **PIN and password saved on the phone** (`AUTOPILOT-LOG.md` security gap 2): remove `pin` from `saveStaffSession` in `js/join.js` and any cookie that holds it, and stop silent sign-in from a stored PIN. Firebase already keeps people signed in. Clear the old stored value on next load.
5. **staffKeys name leak** (gap 3): stop putting `name` (and `empId`, if the join flow doesn't need it before sign-in) in `staffKeys` readable without sign-in.
6. Until open-join gap 1 (code + IC only) is fixed, the Access panel must **not** let anyone give a POS role to an account with `via == 'open'`. Show "This person joined with code + IC. Give POS access after HR confirms them." Enforce it in the rules too (the profile update rule refuses `posRole` when `via == 'open'` and `pending` was never cleared by HR).

`npm test` and `npm run test:rules` must pass (Java portable, as before).

## Step 2: a way for admins to start the trial (no big app.js work)
- New page **`/pos/start`** inside the `pos/` app (not in `app.js`): sign in with the normal Allurus sign-in, check the person is Owner or has the Settings area, show the Start POS trial form (outlet name, SST yes/no + rate + number, service charge, receipt header/footer, sample menu or empty). It calls `AllurusPosTrial.start(...)`: provision the Sheet first, then write `addons.pos`. Then show "Give your staff a POS role" (link to `/app#settings`, Team access) and "Open the till" (`/pos`).
- If the company already has POS: go straight to "Open the till".
- In `app.js` add only **one link** for admins: in Settings (near Team access) a card "Point of sale" with "Start POS trial" or "Open POS", linking to `/pos/start` or `/pos`. Just markup in the existing settings render, no new rendering system.
- Test `/pos/start` with the fake server, like `apps-script-server.test.js`.

## Step 3: merge and deploy the website and rules
1. Before merging, back up the live rules: `docs/rules-backup/firestore.rules.2026-11-07`.
2. Merge into `main` in this order, running `npm test` after each: `claude/role-ticks` (if its preview check with an Owner account passes; otherwise cherry-pick only its rules fixes), `claude/join-phone` (if done), `claude/pos-demo`, `claude/pos-live` (with steps 1 and 2). Resolve conflicts, keeping both sides' fixes.
3. `git push origin main`. GitHub Actions runs `npm test` and deploys hosting. Watch the run until it finishes green.
4. `firebase deploy --only firestore:rules`. Then check on allurus.my: sign-in, add employee, a leave request, the join page, `/demo/pos`, `/pos` (sign-in gate shows).
5. If anything breaks: put the backup rules back (`firebase deploy --only firestore:rules` from the backup) and `git revert` the merge, then push.

## Step 4: deploy the Apps Script server (needs the owner's Google account)
Claude (in the owner's Chrome) or the owner does this. The agent prepares and writes the exact values in the log.
1. In the chosen Google account's Drive: create folders **Allurus POS clients** and **Allurus POS backups**, and a Sheet **Allurus POS Registry** with a tab named `Registry` and header row `tenantId | spreadsheetId | outletName | createdAt | createdByUid | status | lastSaleAt`.
2. script.google.com → New project **Allurus POS Server**. Add files `Router.gs`, `Provision.gs`, `Backup.gs`, `PosCore.gs` (from `pos/apps-script-server/`, after `npm run sync-pos-core`). Add `appsscript.json` with time zone `Asia/Kuala_Lumpur`, web app settings, and only the scopes needed (spreadsheets, drive, script.external_request, script.scriptapp). The agent writes this file into `pos/apps-script-server/appsscript.json`.
3. Script Properties: `FIREBASE_API_KEY` (from `js/firebase-config.js`), `FIREBASE_PROJECT_ID` = `allurus-hr`, `REGISTRY_ID`, `CLIENTS_FOLDER_ID`, `BACKUPS_FOLDER_ID`.
4. Deploy → New deployment → Web app → Execute as **Me**, Who has access **Anyone**. The owner approves Google's permission screen himself.
5. Run `installTriggers` once (nightly backup).
6. Open the `/exec` URL in a browser: it must show `{"ok":true,"data":{"service":"allurus-pos-server"}}`.
7. Put the `/exec` URL into `window.ALLURUS_POS_SERVER` in `js/firebase-config.js`, commit, push. The site redeploys.
8. After any later change to the server files: Manage deployments → edit → **New version** (same URL).

## Step 5: test it live with a test company (not a real client)
1. Use a test company (`isTest`) and its Owner account (the owner signs in; the agent doesn't type passwords).
2. `/pos/start` → start trial with the sample menu. Check: one Sheet in "Allurus POS clients", one Registry row, `addons.pos` trial with an end date 30 days ahead.
3. Give a test employee the cashier role. Sign in at `/pos` as that cashier: sell 3 items, print the receipt. Check the rows in the Sheet and the Audit tab.
4. As cashier, try a void: refused. As Owner (manager): void works.
5. A second test company cannot see the first company's sales.
6. Superadmin sets the test trial end date in the past: reads work, sales are refused with "Your POS trial has ended".
7. Run `backupAll` once: a copy appears in "Allurus POS backups/<tenantId>".
8. Note the time per sale from the Apps Script Executions page (median and slowest of 20 sales) in the log. That is the first real speed number.

## Step 6: open it to clients
- Write in the log: what is live, the `/exec` URL, the test results, the speed numbers, and anything still missing (Close day → Finance, superadmin usage list, waiter/kitchen roles).
- Update the privacy notice wording (POS data stored in Google Sheets on Google's servers, Allurus as processor). The owner approves the text before it is published.
- Only after step 5 passes: tell the owner it is ready for the first real client.

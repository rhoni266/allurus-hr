# Allurus POS Server: deployed (7 Nov 2026, 10:09 MYT)

GO-LIVE-POS.md **step 4 is done** (by Claude in the owner's Chrome, owner approved Google's permission screen).

| Item | Value |
|---|---|
| Google account (owner) | rhoni.ent@gmail.com |
| Apps Script project | "Allurus POS Server": https://script.google.com/home/projects/14mTHMi2i_kJxImLrflRFnPHpGQti7Bk_0LrsG1vigJSX-T3vtmX8WPb6/edit |
| Web app URL (`/exec`) | https://script.google.com/macros/s/AKfycbxgCJliuxFxZhuFOPz51nV8EhmZzdEyM8TDHi3vsKxvlKDYrbq1hitV0uFAoFlkcCf9bw/exec |
| Deployment | Version 1, "Allurus POS Server v1", Execute as Me, Who has access: Anyone |
| Drive | folders "Allurus POS clients" and "Allurus POS backups", Sheet "Allurus POS Registry" (tab `Registry`, header row) |
| Script Properties | FIREBASE_API_KEY, FIREBASE_PROJECT_ID (allurus-hr), REGISTRY_ID, CLIENTS_FOLDER_ID, BACKUPS_FOLDER_ID (set by `setupServer()`) |
| Trigger | `nightlyBackup`, daily at 02:00 Asia/Kuala_Lumpur |

## Files in the project
`Code.gs` (= `pos/apps-script-server/Router.gs`), `Provision.gs`, `Backup.gs`, `PosCore.gs`, `Setup.gs`. PosCore.gs and Backup.gs came from `origin/claude/pos-live` unchanged. Router.gs and Provision.gs include two fixes Claude made (also written to the laptop copies in `pos/apps-script-server/`):
1. **`json_()` was missing.** It only existed in the single-cafe `Code.gs`, so `doGet`/`doPost` would have thrown on every request. Add a test that loads the server files **without** `apps-script/Code.gs` and calls `doPost` through a fake `ContentService`.
2. **Provision lock.** `provisionCompany_` now takes `LockService.getScriptLock()` around the registry check, Sheet creation and registry append (`provisionLocked_`). Add a test.

`pos/apps-script-server/Setup.gs` is new (one-time setup; safe to re-run). Commit it with the others.

## Checked after deploy (anonymous calls, no Google cookies)
- `GET /exec` → `{"ok":true,"data":{"service":"allurus-pos-server"}}`
- POST `getProducts` with a fake token → "Not allowed"; `provision` with a fake token → "Not allowed"; no token → "Not allowed"; no tenantId → "Missing tenantId".
- About 2 seconds per call (most of it the Firebase token check). A full sale will be slower; measure in GO-LIVE-POS.md step 5.

## For the agent
- **Don't** put this URL into `js/firebase-config.js` (`window.ALLURUS_POS_SERVER`) until GO-LIVE-POS.md **steps 1 to 3 are merged and the rules are published**. The server trusts `posRole` from `users/{uid}`, so the self-assigned `posRole` hole must be closed first.
- Any later change to the server files: update the project files, then Deploy → Manage deployments → edit → Version: **New version** (keeps the same URL). The owner or Claude can do this in Chrome; or use clasp.
- Opening the `/exec` URL in a Chrome with several Google accounts signed in can show "Page not found" (Google adds `/u/N/` to the URL). That's a browser quirk. Test with `fetch(..., { credentials: 'omit' })` or a private window.

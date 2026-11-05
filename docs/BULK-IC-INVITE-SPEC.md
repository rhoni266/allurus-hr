# Allurus HR: Bulk Invite by IC (Instructions for the coding agent)

## Goal
Let an admin invite **many staff at once** by IC link, instead of one person at a time. This extends the existing IC invitation (**Settings → Team access**, `teamAccess` in `js/app.js`, `staffInvite` in `js/cloud.js`, rules `staffInvites`, `staffKeys`, `joinLinks`, `companyCodes`). Do not change how a single IC invite works, and do not change the sign-in flow.

Today the "Invite all N" button counts only people **with an email** (`inviteAll`, `bulk`). People with no email and a valid IC can only be invited one by one ("Invite with IC").

## First, study before coding (do not skip)
1. Read `teamAccess` in `js/app.js` (`status`, `icStatus`, `icInvite`, `showLink`, `bulk`, `inviteAll`), `staffInvite` / `staffReset` / `companyCode` in `js/cloud.js`, and the staff rules in `firestore.rules`.
2. Summarise in 10 lines how one IC invite works now: what is written, what the link contains, and what limits apply (Firestore writes per second, rules lookups).
3. Say whether bulk can be built **without changing `firestore.rules`**. If it needs a rules change, show me the diff and wait for my OK. Do not publish rules.
4. Show me a short plan and a sketch of the results screen. Wait for my OK before coding.

## What to build

### 1. Entry points
- On **Settings → Team access**: a button **"Invite all with IC (N)"** next to the existing one, where N is the number of people who are eligible (see below). Hide it when N is 0.
- On the **Employees** list: when rows are selected (`ui.empSel` already exists), a bulk action **"Invite selected by IC"**. It applies the same eligibility rules to the selection.

### 2. Who is eligible
A person is **eligible** when all are true:
- active employee, not the signed-in admin;
- **no work email** and a **valid 12-digit IC** (`byIc` / `AllurusCloudMap.validIc`);
- status is "not invited" (`none`), or the previous link is **expired** (they get a new link). Anyone already **invited** (link still valid) or **joined** is left alone.

Build this as a **pure function** (for example `AllurusInvite.icEligibility(employees, statusOf)`) returning `{ invite: [...], skipped: [{ emp, reason }] }`, so it can be unit tested. Reasons must be plain words: "Has an email: use Send invitation", "IC missing", "IC not valid", "Already invited (link still valid)", "Already joined", "Access turned off".

### 3. Confirm screen
Before sending, show a confirm window:
- "Make join links for **N** people?" with the first 8 names and "and M more".
- A **Skipped** section: who and why (collapsed if long), with a link "Fix these first" that opens the Employees list filtered to those people.
- Remind: "Links last 7 days. Send each link only to that person."
- Confirm button: "Make N links".

### 4. Making the links
- Create them **one at a time in order** (not all in parallel), calling the same `staffInvite` used for one person. Show a progress bar "12 of 40".
- Continue after a failure; do not stop the whole batch. Keep a list of failures with the reason.
- Make it **idempotent**: a double click or retry must not make a second invite or a second link for the same person. If you cannot guarantee it, disable the button while running and re-check status before each person.
- Allow **Cancel** between people; people already done stay done.
- Write one audit/log line per person (the existing `log(...)` style) and one summary line ("Bulk IC invite: 38 made, 2 skipped, 0 failed"). **Never write the link itself to logs, the console or analytics.**

### 5. Results screen (shown right after the batch)
A table: **Name · Phone · Status · Action**.
- Action per row: **Send on WhatsApp** (the same `wa.me` link and message as `showLink`) and **Copy link**. Rows without a phone show "No phone" and keep **Copy link**.
- Browsers block many pop-ups, so do **not** auto-open WhatsApp tabs. One tap per person.
- Row status changes to "Sent" after the admin taps WhatsApp or Copy (this is only a reminder on screen, saved in memory for this window).
- Buttons at the top: **Copy all** (one text block: name, phone, link per line, with the warning below), and **Close**.
- Warning on screen: "These links let someone join as that person. Send each link only to that person. Close this window when done; links are not shown again. You can make a new link any time."
- Do not offer CSV or file download of the links.
- The links are held only in memory while the window is open. After closing, the admin uses **Make a new link** per person to get a fresh one (a new link stops the old one).

### 6. Registration tracker (so HR can see who has not joined)
- At the top of Team access: a summary line, for example **"23 of 40 registered"**, plus counts for *Not invited*, *Link sent*, *Link expired*, *Joined*.
- A **filter** chip row: All · Not invited · Link sent · Expired · Joined. Same filter available on the Employees list if easy.
- A bulk action **"Make new links for expired (N)"** using the same flow as section 4.
- A daily in-app reminder to HR while anyone is "Link sent" for more than 3 days or "Expired" (use the existing notification system; in-app only).

## Rules and limits
- Admin only (same permission as the existing Team access).
- Only for people with **no work email**. Email people keep the existing "Invite all" flow.
- No change to sign-in, passwords, roles or what a joined person can see.
- Keep it fast on 100 staff. Tell me the number of writes per invite and the expected time for 100.
- Everything user-facing in English now, with strings kept in one place so Bahasa Malaysia can be added.

## Tests (run before saying it works)
- Unit tests for `icEligibility`: no email + valid IC (eligible); has email; missing IC; invalid IC; already invited; expired (eligible); joined; disabled; the signed-in admin; inactive employee.
- Bulk of 10: 8 eligible, 2 skipped. 8 links are made, each unique; the 2 skipped show the right reason.
- One person fails (for example a simulated write error): the rest still finish and the failure is listed.
- Double click on confirm: no duplicate invites.
- Cancel half way: the done ones stay valid, the rest stay "not invited".
- No link appears in the log, the console or any saved record other than the invite itself.
- Counts and filters match the table. "Make new links for expired" only touches expired people.
- Existing tests still pass (`npm test`). If `firestore.rules` changes, add `tests-rules/` tests and run `npm run test:rules`.
- Try it in a real (non-demo) test company with the dummy staff file `DUMMY-staff-for-live-import.xlsx` (10 dummy staff with fake ICs), and tell me exactly how to repeat it.

## Working style
- Small steps. After each step tell me what to run or open to see it.
- Do not commit, push, merge or deploy without my go-ahead. Open a pull request, give me the preview link and the test result, and wait.
- If `firestore.rules` changes, show me the diff first and do not publish it.
- Bump the cache version in `sw.js` in the same change.
- Ask me before adding any library or paid service.

## Questions to ask me first
1. Should "Copy all" include phone numbers, or names and links only?
2. Reminder to HR after how many days of "Link sent"? (I suggest 3.)
3. Should bulk also be possible from the Employees list for people **with** an email, or keep that on the existing button?

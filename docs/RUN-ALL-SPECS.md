# Allurus: Full-Access Run Order (owner's standing permission for the coding agent)

The owner is away and gives you **full permission to finish all of this without waiting for him**. This file **replaces the "Working style" and "Questions for me" sections** in each spec listed below. Where a spec says "wait for my OK", "show me first" or "ask me", **decide yourself**, write down what you decided, and carry on.

Owner: rhoni.ent@gmail.com. Date given: 5 Nov 2026. Status: development, no paying clients yet.

## What you may do without asking
- Read, change and add code, tests and docs anywhere in `allurus-hr` (including `pos/`).
- Create branches, commit, push, open pull requests, **merge into `main` when all tests pass**, and let the GitHub Action deploy the website/app.
- Merge finished branches and close branches that are already fully merged into `main`.
- Change and **publish `firestore.rules`** and **deploy Cloud Functions**, with the safety steps below.
- Answer every "Questions for me" with the **suggested answer** in that spec (listed again below).
- Add free, open-source libraries or fonts (with licence file) when a spec needs them.

## Hard stops (still not allowed, even with full access)
Do the preparation, write down the decision needed in the log, skip that piece and continue with the rest:
1. **No deleting data** (Firestore documents, users, uploaded files) and **no deleting a branch that has commits not in `main`**.
2. **No secrets in the repo**: no passwords, join keys (for example the Major Far East join key), API keys, service-account files. Never write the join key the owner chose anywhere in code, tests, docs or logs.
3. **No paid services or plan changes.** If something needs the Firebase Blaze plan (Cloud Functions) and the project is not on it, stop that part and log it.
4. **No setting the superadmin claim** on any account. Give the owner the exact command in the log; he runs it himself.
5. **No real-person data migration for real.** Dry-run scripts are fine; running a migration that changes or moves stored data waits for the owner.
6. **No sending** emails, WhatsApp or other messages to real people.
7. If a security safeguard in a spec cannot be built (for example a server-side PIN lockout), **leave that feature out** as the spec says. Do not ship it without the safeguard.

## Safety steps for every merge and deploy
- `npm test` passes (and `npm run test:rules` when rules change; POS tests when `pos/` changes). Fix flaky date-based tests rather than skipping them.
- Open the pull-request preview link and check the screens the spec names, in light and dark, desktop and phone.
- **Before publishing `firestore.rules`:** save the current live rules to `docs/rules-backup/firestore.rules.<date>` and commit it, so it can be put back in one step. Then publish, and check sign-in, add employee, leave request and the join page on the live site right away. If anything breaks, put the backup back.
- Bump the `sw.js` cache version and the `?v=` numbers in every change that ships CSS or JS.
- One feature per pull request, with a clear title. Squash-merge.

## Run order
Do them in this order. Finish, merge and check each one before starting the next.

0. **Branch tidy-up.** Make the branch table (`git branch -a`, `git log main..<branch>`). Merge finished branches by pull request (tests passing) and close the ones that are fully merged. Leave unmerged work in place and list it. Do not touch the other session's uncommitted `pos/` work. If it is still uncommitted, put it on its own branch `claude/pos-wip` and do not merge it.
1. **Import fix + work email optional** (`WORK-EMAIL-OPTIONAL-SPEC.md`, plus the `importFieldMap.js` change already made on the laptop: Work email no longer required in Import). Tax-relief re-keying: build it with the email fallback and a dry-run script only (hard stop 5).
2. **Bulk invite by IC** (`BULK-IC-INVITE-SPEC.md`). Much of it already exists ("Invite all with IC"). Check it against the spec, finish what is missing, and test.
3. **Company join page, join key and PIN** (`OPEN-JOIN-LINK-SPEC.md`). Needs server-side checks. If Cloud Functions are not available (Blaze), build and test it on a branch but do not merge, and log it.
4. **Support access for superadmin** (`SUPPORT-ACCESS-SPEC.md`). Hard stop 4 applies to setting the claim.
5. **Role access with tick boxes** (`ROLE-ACCESS-SPEC.md`). Includes rules fixes so each role sees only its own data.
6. **POS public demo** (`POS-DEMO-SPEC.md`): `allurus.my/demo/pos`, runs in the browser only, POS restyled to the design standard.
7. **One design standard** (`DESIGN-STANDARD-SPEC.md`). **Do this last**, after 0 to 6 are merged, on one branch `claude/design-standard`. Afterwards rebase any branch still open onto `main`.

Not in this run: tasks 0 to 7 of `HR-FIX-SPEC.md` (the owner has not approved them yet).

## Answers to the spec questions (use these)
- **WORK-EMAIL-OPTIONAL:** Staff list shows "No email" in grey. Yes, warn HR when a person has neither an email nor a registration link.
- **BULK-IC-INVITE:** "Copy all" includes names and phone numbers. Remind HR after 3 days of "Link sent". Bulk email invite stays on the existing button.
- **OPEN-JOIN-LINK:** Second check = last 4 digits of phone on file (people with no phone: join key + IC, and HR gets a notice for each). Open registration turns off after 7 days. "Allow 6-digit PIN" ON for Major Far East, plain crew roles only, and only if the server-side lockout works. HR gets a notice for every registration.
- **SUPPORT-ACCESS:** Default grant 7 days. Pay and ID data hidden unless the client turns on the second switch.
- **ROLE-ACCESS:** Keep the ready-made roles as listed in the spec. Finance keeps Claims. Notify the person when their access changes.
- **DESIGN-STANDARD:** Light by default for website and HR app, dark for POS. Glass only on top bars, nav and dialogs. Inter everywhere. Tidy branches first, restyle once.

## Keep the owner informed
Keep one file `docs/AUTOPILOT-LOG.md`, committed after each step:
- date and time, step, pull request link, what was merged/deployed, test result;
- every decision you made on the owner's behalf and why;
- every hard stop hit, with exactly what the owner must do (for example "turn on Blaze", "run this command to set superadmin", "approve the migration dry-run output");
- anything you left out and why.
At the end, write a short summary at the top of the log: what is live now, what is waiting for the owner, and what to check first.

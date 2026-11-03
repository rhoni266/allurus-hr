# Allurus HR: Company Join Link (company code + IC, then create password or 6-digit PIN)

## Goal
Add a second way for no-email staff to register. Today HR makes one personal link per person (7 days). New: HR shares **one company join page** (for example `allurus.my/join`) in the staff WhatsApp group. Each person opens it and does this:

1. Types the **company code** and their own **IC number**.
2. Is taken **straight to "Create your password"**, where they can choose a normal password **or a 6-digit PIN**.
3. Is signed in. Next time they sign in with company code + IC + password/PIN (same as now).

Keep the existing personal link, "Invite with IC", "Invite all with IC" and the tracker working. This is an addition, not a replacement. Do not change roles or what a joined person can see.

## First, study before coding (do not skip)
1. Read how a personal join link works today (`staffInvite`, `joinLinks`, `staffKeys`, `companyCodes` in `js/cloud.js`, `AllurusCloudMap.staffEmail`, the rules for those collections). Summarise in 10 lines.
2. Say **where the account is created** (browser or a Cloud Function). The open join page must be checked on the **server**, not in the browser. If this needs Cloud Functions, tell me, because the Firebase project must be on the Blaze plan first.
3. Say whether this needs a `firestore.rules` change. Show me the diff and wait for my OK. Do not publish rules.
4. Show a short plan and a sketch of the 3 screens. Wait for my OK before coding.

## The security problem (read this)
With a personal link, only the right person has the link. With one shared page, **anyone who knows a colleague's company code and IC could register as that colleague first**. IC numbers are not secret (they are on photocopies, forms, group chats). So IC alone is not enough proof.

Build the join check like this (default, please confirm in the questions):

- **Second check: last 4 digits of the phone number HR has on file** for that person (the Phone field in the employee record). Staff know their own number; a stranger does not. If a person has no phone on file, they cannot use the open page; HR gives them a personal link instead.
- **HR switch:** the open join page works only while HR has turned **"Open registration"** ON in Team access. HR chooses how long (default 7 days, then it turns itself off). The page shows "Registration is closed. Ask your HR" when off.
- **Generic errors only.** Wrong code, wrong IC, wrong phone digits, already registered, no such person: all show the same message, "We could not match these details. Check with HR." Never say which part was wrong, and never confirm that an IC exists.
- **Limits, enforced on the server:** max 5 failed tries per IC, then locked 15 minutes (doubling each time), plus a limit per device/IP. HR sees "Locked after too many tries" in the tracker and can unlock.
- **One registration only.** After a person registers, the same details cannot register again. Reset is done by HR with the existing "Reset sign-in".
- **Never** put the IC in the URL, link, logs, console, analytics or error text. Mask the IC on screen after it is typed (show last 4 only).
- Only people who are **active, have no work email, and have a valid IC** can join this way. Email people keep the email invitation.
- Log an audit line per registration (who, when; never the IC, password, PIN or link).
- Optional extra (ask me): HR gets an in-app notice "Siti registered" and can press "This is not them" to disable the account.

## Create password or PIN
- After matching, show one screen: "Create your password" with a choice **Password** or **6-digit PIN**.
- **PIN** = exactly 6 digits, numeric keypad (`inputmode="numeric"`), typed twice. Firebase accepts a 6-character password, so a 6-digit PIN can be stored as the password. Study and confirm this works with the current sign-in; if it does not, tell me before building.
- **Password** = at least 8 characters, typed twice.
- Reject easy PINs: 000000, 111111, 123456, 654321, repeated or sequential digits, and any PIN that matches the person's birth date from the IC (YYMMDD or DDMMYY) or the last 6 digits of the IC or phone.
- **Brute-force warning:** a 6-digit PIN has only 1,000,000 combinations and the IC is not secret. A PIN is only safe if wrong tries are limited **on the server per account**. If you cannot guarantee a server-side per-account lockout for sign-in with a PIN, **do not offer the PIN**, and tell me what is needed (for example a sign-in Cloud Function, Firebase App Check, or the Identity Platform lockout setting).
- **Roles:** a PIN is allowed only for plain staff/crew roles. Admin, HR, payroll, finance and any role that can see other people's pay or IC must use a real password. Show: "Your role needs a password."
- Company setting **"Allow 6-digit PIN"** in Settings (default OFF; I will turn it ON for Major Far East).
- The sign-in screen needs no change in layout: the same field accepts the password or the PIN. Say "Password or PIN" on the label for staff who joined with a PIN. Keyboard should open numeric when the company allows PIN.
- "Forgot password/PIN" for these staff = HR presses **Reset sign-in**; the person then uses the join page again (with HR's "Open registration" on, or a personal link).

## Admin side (Settings → Team access)
- New card **"Company join page"**: shows the address, the company code, a switch **Open registration (on until <date>)**, **Copy join message** and **Share on WhatsApp**.
- Join message text (editable): "Join {company} on Allurus: {address}. You will need the company code {code}, your IC number and the phone number HR has for you. Registration closes on {date}."
- The existing tracker ("23 of 40 registered", Not invited, Link sent, Expired, Registered) must count people who join through the open page as **Registered**, and people not yet registered as **Not registered** (the old "Not invited" wording can stay; show both clearly).
- A person who has a personal link and also uses the open page: the open page wins and the personal link is cancelled. No duplicate accounts. Make this idempotent.
- Turning "Open registration" OFF immediately stops new joins. People already registered are not affected.

## Tests (run before saying it works)
- Correct code + IC + phone last 4 → reaches Create password → account made → signed in; later sign-in with code + IC + password works.
- Same with a 6-digit PIN (when the company allows it). PIN not offered when the setting is off or the role is admin/HR/payroll/finance.
- Wrong code, wrong IC, wrong phone digits, unknown person, already registered, email person, inactive person: all give the identical generic message and identical response time (roughly).
- 5 wrong tries on one IC → locked; correct details also refused while locked; HR can unlock.
- Registration OFF or expired → closed message, no matching attempted.
- Weak PINs rejected (000000, 123456, birth date, last 6 of IC).
- Two people open the page at the same time, and one person double-taps: one account only.
- Personal link person who then uses the open page: one account, old link stops working.
- IC, password, PIN and join data never appear in URL, logs, console, analytics, audit lines or error messages.
- Tracker counts and the existing "Invite all with IC" still work. `npm test` passes. If rules change, add `tests-rules/` tests and run `npm run test:rules`.
- Try in a real (non-demo) test company with `DUMMY-staff-for-live-import.xlsx` (add fake phone numbers first) and tell me exactly how to repeat it.

## Working style
- Small steps. After each step say exactly what to run or open.
- Do not commit, push, merge or deploy without my go-ahead. Open a pull request, give me the preview link and test result, and wait.
- Show any `firestore.rules` or Cloud Functions change first. Do not publish them.
- Bump the cache version in `sw.js` in the same change.
- Ask before adding any library or paid service.

## Questions for me (suggested answer first)
1. Second check = last 4 digits of phone on file? (suggest yes). Or IC only with HR approving each person afterwards? Or IC only (not recommended)?
2. Open registration auto-off after 7 days? (suggest yes)
3. PIN: ON for Major Far East, plain crew only? (suggest yes)
4. Should HR get a notice each time someone registers? (suggest yes)

# Allurus: everyone may use a laptop, but only ONE phone per person (Instructions for the coding agent)

## Owner's decision (10 Nov 2026, 22:38). This replaces "staff use phones only" in DEVICE-RULES-SPEC.md
1. **Every account (staff and admin roles) can sign in on a laptop/PC.** No more "Please use your phone" for staff by default.
2. **On phones it stays strict: each person can use Allurus on one phone only, their registered phone.** Any other phone is refused until HR approves it, and approving a new phone retires the old one.

Tablets count as computers: allowed, no check-in.

## What exists (confirm in the code)
- `js/device-rules.js` (`AllurusDevice.kind()`, `policy()`, `allowed()`), live since 10 Nov: staff on computers are blocked when `tenants/{t}.staffDevices.phonesOnly` is not `false` (default on). There's a per-person `allowComputer` exception.
- Check-in phones: each employee record has `devices` (with `status` `pending` / `approved`), and HR approves "New phone for check-in" (also in the new phone Approvals list). `M.SELF_FIELDS = ['devices', 'face']` lets a person write their own `devices`.
- Read how the device id is made and stored on the phone, and how check-in uses it. Write a 10-line summary in `docs/AUTOPILOT-LOG.md` before changing anything.

## Changes

### 1. Laptops for everyone
- `policy()`: `phonesOnly` now defaults to **off**. Existing companies with no value → off. A company that explicitly set it on keeps it (none should have, but don't override an explicit `true`).
- Settings → Security: the "Staff use Allurus on phones only" switch stays but is off by default. Its help text: "Off: staff can sign in on a laptop or PC too. Check-in still only works on their registered phone."
- Keep the "Please use your phone" screen and the `allowComputer` exception working for companies that switch the rule on.

### 2. One phone per person (all accounts, admins included)
New pure function in `js/device-rules.js`, unit-tested: `phoneAccess({ device, thisPhoneId, devices, policy })` → `'ok' | 'first' | 'pending' | 'other'`.
- **Not a phone** (computer or tablet) → `ok`. No phone check, and **no check-in button** on computers and tablets (check-in is phone only; the kiosk is separate).
- **A phone, and this phone is the person's approved phone** → `ok`.
- **A phone, and the person has no approved phone yet** → `first`. Register it. With the company setting "Approve a person's first phone automatically" (default **on**) it is approved at once and HR gets an in-app notice "Siti registered her phone". With the setting off it is `pending` until HR approves.
- **A phone that is pending** → `pending`. Show "Waiting for HR to approve this phone / Menunggu kelulusan HR untuk telefon ini" with Sign out. Nothing else loads.
- **Any other phone** (the person already has an approved phone, and this isn't it) → `other`. Show "This isn't your registered phone / Ini bukan telefon berdaftar anda", the registered phone's name and last-used date (for example "Samsung A15 · used 2 Nov"), a button **"Use this phone instead"** (adds this phone as `pending` and notifies HR), and Sign out. Nothing else loads.

### 3. HR side
- Approving a new phone (Approvals list, or the person's profile → Phones) makes it the **only** approved phone: the old one is set to `retired` with the date, never deleted. The old phone is refused on its next load.
- Profile → Phones: the approved phone (name, registered date, last used), pending requests, retired ones, **Remove phone** (lost or stolen: the person can then register a new one, following the first-phone setting).
- Who approves: anyone with the `people` or `time` area, but **never their own phone**. An admin's new phone is approved by another admin. **If the person is the only Owner**: they approve their own new phone only after typing their password again (Firebase reauthentication), and the Owner gets an in-app notice plus an email (if they have email) "Your Allurus phone was changed".
- Audit log line for every register, approve, decline, retire and remove: who, whose phone, when, phone name. **Never** log the device id itself.

### 4. Rules (important)
- Today `SELF_FIELDS` lets a person write their own `devices` list. **Make sure a person can't approve their own phone or retire someone else's.** A person may only:
  - **add** one `pending` phone (or, with "Approve first phone automatically" on and no phone yet, add their first one as `approved`);
  - update `lastUsed` on their own approved phone.
  Status changes (`approved`, `retired`, `removed`) are written only by people with the `people`/`time` area, and never on their own record (except the sole-Owner case, which the app gates with reauthentication).
- If the `devices` list sits inside an encoded bucket the rules can't inspect field by field, move the approval decision to a separate per-person doc the rules can check (for example `tenants/{t}/phones/{empId}`). Show the plan in the log, then build it.
- Back up the live rules to `docs/rules-backup/` before publishing. Add `tests-rules/` cases for everything above.

### 5. Not affected
- `/pos` (tills run on tablets, PCs and shared phones; POS access follows the POS role).
- The attendance kiosk (shared device, face match).
- `/join` and `/activate`: registering on any device. The first phone that later signs in becomes the registered phone.
- Superadmin and support access.

### 6. Honest limits (put this in the Settings help text and the docs)
- The phone is recognised by an id saved in the phone's browser. **Clearing the browser's data, switching browser, or reinstalling the app looks like a new phone** and needs HR's approval again. Tell staff to use one browser and add Allurus to the home screen.
- Someone very technical could copy that id. This rule stops casual sharing (signing in on a friend's phone, buddy check-ins), not a determined attacker. What anyone can see is still controlled by their role and the Firestore rules.

## Tests
- Unit: `phoneAccess()` for every case: computer, tablet, first phone with auto on and off, pending, approved, other, retired, removed.
- Emulator end-to-end:
  - staff on a laptop → normal app (setting off), no check-in button;
  - first phone → registered, HR notified;
  - second phone → "This isn't your registered phone", "Use this phone instead" → pending → HR approves → new phone works and the old phone is refused;
  - Remove phone → next phone registers;
  - an admin can't approve their own phone; the sole Owner can after reauthentication;
  - a person can't write `approved` or `retired` on their own record (rules test);
  - a company with phones-only explicitly on still blocks staff on laptops.
- `/pos`, kiosk, `/join`, `/activate` unaffected.
- `npm test` and `npm run test:rules` pass.

## Working style
- The owner's go-ahead covers building, testing, merging and deploying this one change, following `RUN-ALL-SPECS.md`: back up the live rules first, then tests, merge, publish rules, deploy, and check live without typing real passwords.
- **Before deploying, check how many people would be refused on their next phone sign-in** (people with an approved phone who have been using a different phone). Use a read-only script with the admin key, counts only, no names in the log. If more than a handful, tell the owner first: HR may need to approve phones in bulk.
- Bump `sw.js`. Write everything in `docs/AUTOPILOT-LOG.md`.

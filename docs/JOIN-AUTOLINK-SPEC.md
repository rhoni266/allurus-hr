# Allurus: join page: PIN twice, then straight in (auto-linked) (Instructions for the coding agent)

## Owner's decision (12 Nov 2026)
1. Every new sign-up on the join page types the **6-digit PIN twice** (create + confirm) so a typo can't lock them out.
2. When the company has **auto-approve on** ("Pendaftaran Auto Aktif"), a new staff sign-up is **linked to their own employee record automatically** and goes **straight into the app**: no HR approval step, no second sign-in.

Today auto-approve creates the sign-in with an **empty** employee link, so the person lands on "Your sign-in isn't linked to your staff record yet" until HR picks the record. That is what this changes.

## 1. PIN twice
- Step 3 ("Cipta 6 Angka PIN"): two fields, "PIN" and "Masukkan semula PIN / Confirm PIN", numeric keypad, both hidden with a shared "Tunjuk / Show".
- The button stays disabled until both have 6 digits. If they differ: "PIN tidak sama. Sila cuba lagi. / PINs don't match." Clear the confirm field only.
- Keep the existing weak-PIN rules (000000, 123456, birth date from IC, …).
- Same on the personal join link and on "Reset sign-in" (new PIN).

## 2. Auto-link without HR, safely
The sign-up key (`staffKeys/<tenant>~<IC>`) is readable **before** sign-in, so it must keep holding **no name and no employee id** (gap 3, 2026-11-07). The link has to come from somewhere only the right new account can read:

- New collection **`staffLinks/{tenantId}~{IC}`** = `{ empId, gen, updatedAt }`.
  - **Written** only by HR/admins with the People area. Keep it in step with employee records in the same place the v3.56 IC clean-up runs: create/update when a record gets an IC, delete when the IC is removed or changed, or the employee is removed. Same safety rules: skip when two records share the IC; mass-drop guard.
  - **Read** only by the signed-in staff account made from that IC: rules check that `request.auth.token.email` starts with `<IC>.<lowercase tenantId>.g` (the staff email pattern from `AllurusCloudMap.staffEmail`) and the doc id is `<tenantId>~<IC>`. Nobody else can read it, and it can't be listed.
- Join flow after the account is created (still in the join page, still signed in):
  1. read `staffLinks/<tenant>~<IC>`;
  2. if it exists, write `empId` to the person's own `users/{uid}`. Rules allow a staff account to set its **own** `empId` **once** (from empty), **only** to the value in its `staffLinks` doc (`get()` in the rule), and only while `tenants/{t}` has auto-approve on;
  3. also set the sign-in's display name from the linked record after linking (read via the person's own access).
- **No auto-link (falls back to HR approval as today)** when:
  - auto-approve is off;
  - there's no `staffLinks` doc (IC on no record, or on two records);
  - the record already has another sign-in (an email sign-in, or another IC sign-in) — check with a field kept on the link doc, e.g. `hasSignIn: true`, maintained by the same sync;
  - the record belongs to an admin role.
- Run `AllurusCloudMap.linkProblem` before writing, as the approval does.

## 3. Straight into the app
- After the link is written, go **directly to `/app`, already signed in**: the person's staff screen (simple screen at Major Far East), with a one-time toast "Selamat datang, <first name>!". No "Klik di sini untuk log masuk", no second PIN entry.
- The one-phone rule registers this phone as their first phone (staff only; admins still need approval).
- If linking failed or wasn't allowed: still go into the app, and show the "waiting" screen with the new wording: **"Akaun anda sedang menunggu kelulusan HR / Your account is waiting for HR approval"**, not "not linked".
- If the IC already has a sign-in and the PIN is right: sign in and go straight in (linked or waiting), never "Akaun dengan No. IC ini sudah wujud". Wrong PIN → "PIN salah. Lupa PIN? Minta HR tekan Reset sign-in."

## 4. Keep HR in control
- HR gets an in-app notice for every auto-linked sign-up: "<name> registered and was linked automatically (IC ••••1234, phone <model>)", with **"This isn't them"**, which removes the link, disables the sign-in and logs it.
- Team access shows "Linked automatically · <date>" on those rows.
- Audit log line for each auto-link (no full IC).

## 5. Honest risk (put it in the Settings help for auto-approve)
With auto-approve on, anyone who knows a worker's **company code and IC** can register as that worker before the worker does, and then see that worker's own payslips and leave. They never get admin access. Ways to reduce this, already in place or listed:
- HR's notice with "This isn't them";
- the one-phone rule;
- the face check (turn it on for check-in);
- optional: ask the last 4 digits of the phone number HR has on file (from `OPEN-JOIN-LINK-SPEC.md`) when the record has a phone.

Offer that last one as a setting, **"Also ask the last 4 digits of the phone on file"**, default on when the record has a phone.

## Tests
- Unit: PIN match/mismatch, weak PIN, the email-prefix check used by the rules.
- Rules: a staff account reads only its own `staffLinks` doc; can't list them; can set its own `empId` once, only to the linked value, only when auto-approve is on; can't change it afterwards; an admin record is never auto-linked.
- E2E (emulator, real cloud mode, not the demo):
  - new IC with a unique record → PIN twice → lands in their own staff screen, linked, no second sign-in;
  - IC on two records → waiting screen;
  - record already has an email sign-in → waiting screen;
  - auto-approve off → waiting screen;
  - existing sign-in + right PIN → straight in;
  - wrong PIN → message;
  - "This isn't them" → disabled;
  - an unlinked account never sees anyone else's record.
- `npm test` and `npm run test:rules` pass.

## Working style
Follow `RUN-ALL-SPECS.md`. Back up the live rules before publishing (this needs a rules change). Give me the two deploy commands in order (rules, then hosting). Test in the **real cloud mode on the emulator**, not only the demo (lesson from v3.48).

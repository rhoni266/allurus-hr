# Bug fix: phone number typed at first registration is not saved to the employee record

## The bug (found by the owner's review, 6 Nov 2026; confirm in the code)
On the company join page (`js/join.js`), step 2 asks "Sila masukkan No. Telefon anda / Enter your phone number". The number is kept in `ctx.staff.phone` and written **only** to the sign-in profile `users/{uid}` (field `phone`, around line 417).

HR never sees it, because:
- the employee record HR reads is `tenants/{t}/people/{empId}` (and the `directory` bucket), and nothing copies the phone there;
- `M.SELF_FIELDS` in `js/cloud-map.js` is `['devices', 'face']`, so a staff member cannot write `phone` to their own record, and the rules refuse it too;
- nothing in `app.js` or `cloud.js` reads `users/{uid}.phone`.

Also, the whole save block (`users`, `staffKeys`, invite clean-up) sits inside one `try { … } catch (e) { console.warn(…) }`. **If any write fails, the person still sees "Pendaftaran Berjaya!"** and nobody knows.

Check the personal link path (`/join?k=…`, `via: 'ic'`) and the email activation path (`activate.js`) for the same problem.

## The fix
1. **Save the phone to the employee record.** After the account is created, write the phone to `people/{empId}.phone` (and so to the directory), **only when the record has no phone yet**.
   - Rules: allow a signed-in staff member to set **only** `phone` on **their own** people record (`empId` from their profile), **only if** the current value is empty or missing, with a format check (Malaysian mobile, 10 to 12 digits after normalising, or `+` and country code for foreign workers, max 16 characters). No other field may change.
   - Use the same encoding the record uses for its other fields (`M.enc`, blobs).
2. **If HR already has a different phone on file,** don't overwrite it. Save the new one as `phoneNew` (with date) on the record. HR sees "New phone from registration: 01X-XXX XXXX. Use it / Keep old" in the employee profile and in the Team access tracker. Only HR changes `phone`.
3. **Normalise** the number before saving: strip spaces and dashes, `01…` stays as typed, `+601…` → `01…` for Malaysian numbers, other countries keep `+` and the country code. Show it formatted (`012-345 6789`).
4. **Validate on screen:** if the number is not valid, show "No. telefon tidak sah / Phone number not valid" and stay on the step. Skip stays allowed.
5. **No silent success.** Split the save into steps with separate error handling. If the profile or phone save fails, retry once. If it still fails, show "Akaun dibuat tetapi maklumat belum disimpan. Sila maklumkan HR. / Account created but details not saved. Please tell HR." and write an activity-log entry for HR. Never show the success screen when the profile write failed.
6. **Existing people already registered:** write a small **dry-run** script that lists `users` docs with `via` `'open'` or `'ic'` that have a `phone` while their employee record has none (or a different one). Show the counts in the log. **Copying them for real is hard stop 5:** wait for the owner. Until then, HR can see the phone from registration in Team access → registered person's row (read it from the profile).
7. Keep the phone **out** of logs, the console and analytics (it is personal data under PDPA). The activity log may say "Phone added at registration" without the number.

## Tests
- Register with a phone, employee record empty → record has the phone and HR sees it in Employees and the profile.
- Register with a phone, record already has a different phone → `phone` unchanged, `phoneNew` set, HR sees the choice. "Use it" replaces the phone; "Keep old" clears `phoneNew`.
- Skip the phone step → nothing written, no error.
- Invalid phone → stays on step 2 with the message.
- Rules: a staff member cannot change their own phone when one is set, cannot write any other field, and cannot write someone else's record.
- Simulated failed profile write → error screen, not success; log entry for HR.
- Same checks on the personal link path and the email activation path, if they ask for a phone.
- `npm test` and `npm run test:rules` pass.

## Working style
Follow `RUN-ALL-SPECS.md`. One pull request. Bump the `sw.js` cache version. Back up the live rules before publishing the rules change.

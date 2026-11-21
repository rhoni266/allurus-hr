# scripts/set-link.js: fix which employee record one sign-in is linked to

Written for the 11 Nov 2026 incident, when a worker's IC sign-in was linked to HR admin Nadia's record and showed her data.

It changes **one field on one sign-in**: `users/{uid}.empId`, and sets the sign-in's display name to the record's name.
It deletes nothing and does not touch the employee record.

## Before you run it

- It runs against **production** (project `allurus-hr`) with a service-account key, so it reads and writes live data.
- Put the key at `scripts/serviceAccount.json` (git-ignored), or set `GOOGLE_APPLICATION_CREDENTIALS`.
  Firebase console → Project settings → Service accounts → Generate new private key.
- `npm install` once, so `firebase-admin` is there.

## Use

```
node scripts/set-link.js "<company name or id>" <sign-in uid> <employee record id>          # check only
node scripts/set-link.js "<company name or id>" <sign-in uid> <employee record id> --yes    # change it
```

1. Run it **without** `--yes` first. It prints the company, the sign-in (IC or email, roles, name), who it is linked to now, and who it
   will link to. Nothing is written.
2. Read "linked now to" and "will link to". If "will link to" is the right person, run it again with `--yes`.
3. The person signs out and in again (or reloads twice).

`<sign-in uid>` and the record id can be found with `scripts/list-unlinked-signins.js` and `scripts/check-ic-link.js`.

## Warning about `--yes`

`--yes` **writes to the live user record immediately**, with no confirmation prompt and no undo. Write down the old `empId` printed under
"linked now to" before you run it, so it can be put back by hand.

Built-in stops (it exits without changing anything): the company or sign-in is not found; the sign-in belongs to another company; the
employee record does not exist; **the sign-in is an admin** (change admins by hand). If it prints "other sign-in(s) are also linked to that
record", look at that before going on: two sign-ins on one record is usually how the problem started.

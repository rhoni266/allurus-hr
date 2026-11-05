# Autopilot log (run order in docs/RUN-ALL-SPECS.md)

## Summary (read first)
- **Live now:** `main` at c651945 (cache v3.36) is on allurus.my, and the live Firestore rules are the same as `firestore.rules` on `main`. They were published by the owner on 5 Nov 2026, 10:14 UTC. Work email optional, Import fix, Bulk invite by IC, Company join page, Join key and Support access are all already on `main`.
- **Run stopped after step 0.** The live sign-up path no longer has the safeguards the specs require (see "Security gaps"). Fixing it means undoing commits the owner made on 4 and 5 Nov, and that is the owner's decision.
- **Check first:** the three security gaps below. Close **Open registration** for every real company, or set a join key, until they are fixed.

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

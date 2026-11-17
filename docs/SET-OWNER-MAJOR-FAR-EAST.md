# Set Hafidz Rosali as Owner of Major Far East

**Owner's instruction (9 Nov 2026):** make **Hafidz Rosali** the **Owner** of the company **Major Far East**.

Right now nobody in Major Far East is Owner. Only an Owner can choose "Owner" in **Settings → Team access**, so it can't be done in the app. It has to be done from the server side with `scripts/set-owner.js` (already on the laptop), which uses the Firebase admin key `scripts/serviceAccount.json`.

## What "Owner" means in Allurus
- An Owner is a `users/{uid}` profile in that company with `admin` in `roles` and **no `perms` list**. The rules check `owner() = !('perms' in me())`.
- An Owner can open **every** area (staff, payroll, finance, stock, POS, settings), give or remove access for anyone, and make other people Owner.
- If the company was never claimed (`tenants/{t}.owner` is empty), the script also records Hafidz as the company owner.
- Nothing else changes and nothing is deleted.

## Steps

### Step 1: check only (changes nothing)
```
cd "C:\Users\UMPSA Advanced\allurus-hr"
node scripts/set-owner.js "Major Far East" "Hafidz"
```
It prints:
- the company found and its tenantId;
- who is Owner now (expected: **NONE**);
- the account it matched for Hafidz (name, sign-in, uid, current roles);
- exactly what it will change.

### Step 2: make the change
Only if step 1 found **one** company named Major Far East and **one** account that is **Hafidz Rosali**:
```
node scripts/set-owner.js "Major Far East" "Hafidz" --yes
```
Expected last line: `Done: Hafidz Rosali is now Owner of Major Far East … He should reload allurus.my (or sign out and in).`

### Step 3: check
- Hafidz reloads allurus.my. He sees every area, and **Settings → Team access** offers "Owner" in the Access dropdown.
- Run step 1 again: "Owners now" lists Hafidz.

## If step 1 says something else

| Message | What to do |
|---|---|
| "More than one company matches" | Run again with the exact tenantId it lists, for example `node scripts/set-owner.js <tenantId> "Hafidz"`. |
| "No Allurus sign-in … matches" | Hafidz has no account yet. An admin with Team access invites him (email or IC), he finishes joining, then run step 1 again. If the company is unclaimed, the output says which email becomes Owner automatically when it is activated at allurus.my/activate. |
| "More than one account matches" | Use his email or 12-digit IC instead of "Hafidz". |
| "still waiting for HR approval (pending)" | Approve his account first (Team access, or `node scripts/approve-pending.js`), then run again. |
| "turned off (disabled)" | Turn his account back on in Team access first. |
| "He is already an Owner" | Nothing to do. |
| "firebase-admin is not installed" | Run `npm install` in the `allurus-hr` folder, then again. |
| "No service-account key" | `scripts/serviceAccount.json` is missing. Firebase console → Project settings → Service accounts → Generate new private key, save it as `scripts/serviceAccount.json`. Never commit or share it. |

## Afterwards (recommended)
1. **Add a second Owner** (for example a director) in Team access, so the company is never left without an Owner again. The app doesn't yet stop one Owner from lowering another.
2. **Password, not PIN.** If Hafidz signs in with company code + IC and a 6-digit PIN, ask him to change to a proper password (at least 8 characters). An Owner sees all staff data and payroll.
3. Tell Hafidz what he can do now: invite staff, give access (HR admin, Payroll, Finance, …), approve leave and claims, run payroll, and turn on POS.

## For the coding agent
- The owner has approved this specific change: Hafidz Rosali → Owner of Major Far East.
- Run step 1 and put its output in `docs/AUTOPILOT-LOG.md` (no IC numbers or emails in the log: name and uid only).
- Run step 2 only if step 1 matched exactly one company that is clearly Major Far East and exactly one account that is clearly Hafidz Rosali, and he is not pending or disabled. Otherwise stop and write in the log what step 1 said.
- Don't change anyone else's access.
- Commit `scripts/set-owner.js` (new) with a short test using a fake Firestore, like the other script tests if there are any.

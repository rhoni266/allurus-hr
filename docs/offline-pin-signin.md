# Offline staff PIN sign-in — proposal

Status: **decided — option C. Server side built; terminal (Flutter) side not started.**

Decisions (2026-10-25):
1. Offline window: **7 days** (`StaffCredential::OFFLINE_WINDOW_DAYS`).
2. Owners and managers need **6-digit PINs** (`Staff::LONG_PIN_ROLES`); a shorter one gets `403 pin_change_required` at sign-in.
3. Manager actions offline are **allowed and always flagged** (`offline_manager_action`).
4. **Rooted devices are refused**: pairing needs a passing attestation and offline credentials are only issued to attested devices (`pos.attestation.required`, on by default).

What exists on the server: `staff_credentials` (no secrets, synced to the outlet's terminals), credential issuance in the login response (with the KDF parameters), revocation by a Postgres trigger on deactivation or PIN change, `auth` on every mutation with `offline_credential_unknown` / `offline_credential_stale` / `offline_manager_action` flags, PIN change (`POST auth/pin`), manager PIN reset (`POST staff/{id}/pin`), `php artisan pos:staff-pin`, and attestation (`POST attestation/challenge`; drivers: Play Integrity, App Attest *stub that fails closed*, dev). Covered by `tests/Feature/Devices/OfflineSigninTest.php` and the `offline-signin` simulator scenario.

One deviation from the proposal below: there is no "signed in before the credential was issued" check, because device and server clocks differ; it would only ever catch clock skew.

The original proposal follows.

---

## The problem in one paragraph

A terminal that is offline can only check a PIN against something stored on the terminal. A 4-digit PIN has 10,000 values, a 6-digit PIN 1,000,000. Whatever is stored, if an attacker can copy it off the device they can try every PIN on their own hardware, with no lockout. A bcrypt hash at cost 12 falls to a single consumer GPU in seconds for 4 digits and minutes for 6; Argon2id with a large memory cost buys you minutes to hours, not safety. **No hash of a short PIN survives an offline attack.** Two things can actually help: making the stored data useless *off* the device, and limiting what a guessed PIN is good for.

## Who we are defending against

| Threat | How likely | What a guessed PIN gives them | What already limits it |
|---|---|---|---|
| A colleague guessing another's PIN at the counter | High | Ringing sales / voids under someone else's name | App lockout (5 tries); server flags `unauthorized_void` etc. |
| A cashier using a manager's PIN for voids or adjustments | **Highest real risk** (internal fraud) | Voids and stock corrections attributed to the manager | Same, plus the audit trail; *not* stopped by any crypto |
| Stolen device, data extracted on a rooted phone/laptop | Low–medium | Staff PINs, which people **reuse for bank cards and phones** | Remote revoke/wipe (built): the server already refuses everything from that device |
| Stolen device used offline to fake sales | Low | Fake sales that later sync | Revoke: nothing from a revoked device is accepted |

The stolen-device case is less about the POS than about the staff: a cracked PIN is often their personal PIN too. That is the main reason not to put a crackable verifier on every device.

## Options

### A. No offline sign-in (today)
Staff sign in while online; the session survives network loss for 12 hours.
- **For:** nothing PIN-derived leaves the server. Simplest. Nothing to crack.
- **Against:** if the internet is down when the shift starts, or staff change mid-shift during an outage, nobody new can sign in. In practice staff then share whoever is signed in, which destroys attribution (worse than a weaker PIN check).

### B. Sync every staff member's PIN hash to every device
- **For:** works offline for anyone, anywhere. Easy to build.
- **Against:** every device carries every staff PIN of the outlet, crackable in seconds once extracted. Rejected.

### C. Per-device offline credential, sealed by a hardware key — **recommended**
1. When a staff member signs in **online** on a terminal, the server returns (in the login response) permission to create an *offline credential* on that device, with an expiry (e.g. 7 days) and a credential id.
2. The terminal derives `v = Argon2id(PIN, random salt)` and stores only `HMAC(device_key, v)`, where `device_key` lives in the Android Keystore (StrongBox/TEE) or iOS Secure Enclave and **cannot be exported**. The copied database is useless off the device: each guess needs that physical device's key, at its speed, while the attacker holds it.
3. Offline sign-in checks the PIN against the sealed verifier. Lockout: 5 failures locks that staff member on that device until an online sign-in; 15 failures device-wide disables offline sign-in entirely.
4. Only people who signed in online on *this* device recently can sign in offline on it. A credential expires after the offline window and is refreshed by every online sign-in. Nothing is synced for anyone else.
5. Every mutation made under an offline sign-in carries `auth: {mode: "offline", credential_id, signed_in_at}`. The server keeps the sale (rule 4) and flags `offline_credential_stale` when the credential had expired, was issued before a PIN change, or the staff member was deactivated.
6. Deactivating a staff member or changing their PIN invalidates their credentials: the next pull deletes them locally, and the server flags anything signed with them afterwards.

- **For:** works through outages for the people actually on shift; nothing useful leaks if the database is copied; fraud attribution stays intact; revocation and staleness are visible to HQ.
- **Against:** real native work (keystore APIs on Android and iOS, Argon2id on device). On a **rooted** device the attacker can drive the keystore and reset the app's lockout counter, so the guarding becomes "slow, on-device" rather than "impossible"; we accept this because a rooted, stolen device is revoked anyway. A first sign-in on a brand-new device still needs the network.

### D. Add-on for manager actions: online-only or a one-time approval code
Voids and stock corrections are where a guessed manager PIN pays off. Options: (i) allow them offline only with a 6-digit manager PIN; (ii) require them online; (iii) a manager's phone shows a time-based approval code (TOTP, seed per manager per outlet, known to the server) that the cashier types in. (iii) works offline and can't be replayed, at the cost of a phone app.

## Trade-offs at a glance

| | A. Online only | B. Synced hashes | **C. Sealed per-device** | C + D(iii) |
|---|---|---|---|---|
| Sign-in during an outage | ✗ (12 h sessions only) | ✓ anyone | ✓ recent staff on this device | ✓ |
| PINs exposed if a DB is copied | none | **all, in seconds** | none usable off-device | none |
| Guessing a colleague's PIN at the till | 5 tries | 5 tries | 5 tries | 5 tries; manager actions need the code |
| Attribution survives outages | ✗ (shared logins) | ✓ | ✓ | ✓ |
| Server can flag stale/revoked use | n/a | weak | ✓ `offline_credential_stale` | ✓ |
| Build effort | done | small | medium (native keystore) | medium + phone app |

## Recommendation

Build **C**, require **6-digit PINs for owners and managers** (cashiers may keep 4), and allow manager actions offline under C but always flagged as offline-authorised so HQ can review them. Add D(iii) later if voids turn out to be abused.

## Decisions needed

1. **Offline window:** how long a credential lasts without an online sign-in. Suggest 7 days (covers a long weekend outage); 24 h is safer but will lock people out more often.
2. **Manager PIN length:** 6 digits for owner/manager? (Suggested yes; it multiplies guessing effort by 100.)
3. **Manager actions offline:** allowed under C and flagged (suggested), online only, or approval code (D)?
4. **Rooted/jailbroken devices:** refuse to run (Play Integrity / App Attest) or accept the weaker on-device guarantee? Suggest refusing in production via MDM policy.

## What building C involves

- **Server:** `offline_credential` block in the login response (id, expiry); a `staff_credentials` table (id, staff, terminal, issued_at, expires_at, revoked_at, pin_version) with RLS; `pin_version` on `staff` bumped on PIN change; `auth` field validated on every mutation; `offline_credential_stale` flag; credential revocations in the pull feed.
- **Terminal (Flutter):** keystore/Secure Enclave key generation, Argon2id, sealed verifier storage in SQLCipher, offline sign-in screen with lockout, `auth` on every outbox row.
- **Tests/simulator:** an `offline-signin` scenario: sign in online, go offline, sign in offline, deactivate the staff member at HQ while the device is still offline, reconnect, and check the flags.

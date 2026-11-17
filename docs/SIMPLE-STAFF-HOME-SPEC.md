# Allurus: Simple staff phone screen (Major Far East only) (Instructions for the coding agent)

## Owner's decision (12 Nov 2026)
For **Major Far East staff on a phone**, the main screen shows **only three things**, top to bottom:
1. **Check in.** One big button first. After checking in, the same card shows the person's **attendance pattern**: on time, late, absent and short hours, as meters.
2. **Apply leave**, with the **leave balance** shown.
3. **Payslip**, to download, print or share. **Payslip PDFs are protected with a password = the person's IC number.**

**Admin can switch these off in Settings.** Every other company keeps the current phone Home. Admin roles keep their own phone screens (Today, Approvals, People, Me).

## Switches (Settings → Staff app, Owner or Settings area)
- **"Simple staff screen"**: on for Major Far East (turn it on with `node scripts/set-addon.js simpleStaffHome "Major Far East"`, check first, then `--yes`), off for everyone else. Off = the normal phone Home.
- **"Protect payslip PDFs with the IC number"**: default on where the simple screen is on. Off = PDFs without a password.
- Both stored on the tenant, readable by staff (the app needs them), writable only by Owner/Settings (rules + test). Changes go in the audit log.

## The screen (phone, staff without an admin role)
Top: company name, the person's name, today's date. No widgets, no menus beyond the three blocks and a small **Me** link (profile, sign out, language). The bottom tab bar is **hidden** in simple mode.

### 1. Check in (first block)
- **Before checking in:** one large teal button **"Check in / Daftar masuk"** (at least 64px tall, full width). Under it, today's shift ("08:00–17:00") and the zone line ("Inside Major Far East office zone"). It uses the existing check-in (registered phone, zone, selfie, face check if on). Errors stay plain: "Outside the zone", "This isn't your registered phone".
- **After checking in:** the button becomes **"Check out / Daftar keluar"** with "In since 07:52". Under it, the **attendance pattern** for **this month to date**:

  | Meter | Shows | Counts |
  |---|---|---|
  | **On time / Tepat masa** | "18 of 20 days" + bar | working days checked in at or before shift start + grace (company setting) |
  | **Late / Lewat** | "2 days · 23 min" + bar | days checked in after start + grace; total minutes late |
  | **Absent / Tidak hadir** | "1 day" + bar | working days with no check-in and no approved leave or holiday |
  | **Short hours / Jam kurang** | "1 day · 1h 10m" + bar | days with check-out before shift end, or worked hours below the shift length (minus break) |

  - Use the **existing attendance rules** (`js/attendance-rules.js`), not new maths. Leave days and public holidays are excluded from all four. Today counts only after check-out (for short hours) or after shift start + grace (for late).
  - Meter colours follow the chart palette in `OWNER-OVERVIEW-SPEC.md`, but meaning is **always in text too** (numbers and labels), never colour alone. Red is not used for the person's own record: use the status amber for late/short and slate for absent, so it reads as information, not a telling-off.
  - Tap the card → this month's day-by-day list (date, in, out, status). A month switch shows last month.
- **Checked out:** "Done for today · 07:52–17:06", and the meters.

### 2. Apply leave
- A card with the **balances** first: "Annual: 10 days left · Medical: 14 days left" (the leave types the person is entitled to, from the existing leave rules), and anything pending ("1 request waiting").
- One button **"Apply leave / Mohon cuti"** → the existing leave form, simplified: type, from, to, half day, reason, attachment for medical. Shows the days it will use and the balance after.
- After sending: "Sent to HR" and the request appears under the button with its status.

### 3. Payslip
- The **latest payslip** month ("October 2026 · Net RM1,842.50") with a button **"Download payslip / Muat turun slip gaji"**, plus "Older payslips" (list of months).
- The button makes the **same payslip PDF** the app already produces (`js/payroll-docs.js`), then:
  - **protected with a password = the person's IC number, 12 digits, no dashes** (foreign workers: passport number as recorded, upper case);
  - on the phone it opens the share sheet (Print, Save to Files, WhatsApp to self), using the Web Share API with the file, falling back to a download.
- Under the button, one line: "The PDF password is your IC number, without dashes / Kata laluan PDF ialah No. IC anda tanpa sengkang." Never show the IC itself on screen or in the file name.
- File name: `Payslip-2026-10-<first name>.pdf` (no IC, no company id).

## PDF password: how
- Encrypt in the browser. **AES (128 or 256) only.** Don't use 40-bit RC4. Check what the current PDF code uses. If the library can't do AES, add a small, free (MIT/Apache), well-known library that can, with its licence file, and say which one in the log. No outside service: the PDF and the IC never leave the phone.
- User password = IC. Owner password = a random value made per file and not stored (so nobody can remove protection with a known owner password). Allow printing and copying for the user.
- Payslips downloaded by HR/admins on a computer follow the same switch. Bulk download (HR) puts each PDF under that person's IC.
- If a person has **no IC on record**, show "Ask HR to add your IC to download your payslip" and don't make an unprotected file (when the switch is on).

**Write this in the Settings help text, honestly:** an IC-number password stops casual opening of a forwarded or lost PDF. It is not strong protection, because ICs are widely known. Inside the app, payslips are still protected by the person's sign-in.

## Not affected
- Admin roles on phones (their tabs stay), computers (normal app), POS, kiosk.
- Notifications still arrive (a small bell in the top bar) but there's no feed on the screen.
- Other companies: no change unless the switch is turned on.

## Tests
- Unit: the four meters with fixtures (on time with grace, late minutes, absent excluding leave and holidays, short hours with breaks, today's partial day, month boundaries).
- Unit: the payslip file name, the password rule (IC without dashes; passport; missing IC → refused).
- PDF: the encrypted file opens with the IC and not without it, and is AES. Check with `qpdf --show-encryption` in a test, or the library's own reader.
- Switch off → the normal phone Home; password switch off → plain PDF.
- Rules: staff can read the switches but not change them.
- Phone e2e (390×844): check in → meters appear; apply leave → balance shown, request sent; download payslip → share sheet/file; Bahasa Malaysia labels.
- `npm test`, `npm run test:rules` pass.

## Working style
Follow `RUN-ALL-SPECS.md`. Branch `claude/simple-staff-home`. Preview with the Major Far East demo (`/app?demo=majorfe`, as a staff member on a phone-sized window), then merge. Give me the deploy commands (the owner runs `firebase deploy`) and the `set-addon` switch-on command.

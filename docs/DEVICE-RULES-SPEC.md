# Allurus: who can use which device (Instructions for the coding agent)

## Owner's decision (10 Nov 2026)
- **Admin roles** (Owner, HR admin, Payroll, Finance, Operations, Outlet manager, Admin manager, Custom: anyone with `admin` in `roles`) can sign in on a **laptop/PC and on a phone**.
- **Employees** (no admin role) use Allurus on a **phone only**. On a laptop or PC they see "Please use your phone" and nothing else.

Mockups: the owner's Design canvas "Allurus macOS-style UI", second row:
- **Employee on phone: Home**: check-in card, leave and payslip widgets, quick actions, my requests, bottom tabs Home/Leave/Payslips/Claims/Me.
- **Admin on phone: Approvals**: Today/Approvals/People/Me tabs, approve or decline leave, claims, overtime and devices.
- **Employee on a laptop**: the "Please use your phone" window, in English and BM, with a QR code to `allurus.my/app` and Sign out.

Build the phone screens in the same style as `MACOS-STYLE-UI-SPEC.md` (brand colours, Inter, cards radius 18px on phone, 44px+ tap targets).

## Rules

### 1. What counts as a phone
One function, `AllurusDevice.kind()` in a small pure file (for example `js/device-rules.js`), returning `'phone' | 'tablet' | 'computer'`:
- `navigator.userAgentData?.mobile === true` → phone;
- otherwise, user agent with `iPhone`, `iPod`, or `Android` + `Mobile` → phone;
- otherwise, `iPad`, `Android` without `Mobile`, or a Mac user agent with touch (`navigator.maxTouchPoints > 1`, iPadOS) → tablet;
- a phone asking for the "desktop site" (desktop user agent, but touch and a short screen side ≤ 500 CSS px) → phone;
- everything else → computer.

Unit-test it with a table of real user-agent strings (iPhone Safari, iPhone "desktop site", Android Chrome, Samsung Internet, iPad, Android tablet, Windows Chrome, Mac Safari, ChromeOS).

**Tablets** count as computers for this rule (blocked for employees), unless the company setting "Staff may also use tablets" is on (default off).

### 2. Where the rule applies
- `allurus.my/app` (the HR app) after sign-in, as soon as the profile is known, **before any company data is loaded or shown**.
- Applies to people **without** `admin` in `roles`.
- **Not** to:
  - `/pos`: POS roles follow their own access, and the till runs on tablets and PCs;
  - the attendance **kiosk** mode (`js/kiosk.js`), which is a shared device, not a personal sign-in;
  - superadmin;
  - `/join` and `/activate`: registering on any device is fine, and after registering on a computer the success screen says "Now open allurus.my/app on your phone".

### 3. What an employee on a computer sees
The "Please use your phone" screen from the mockup:
- title "Please use your phone" / "Sila guna telefon anda";
- one line on how to sign in on the phone (company code + IC, or email);
- a **real QR code** for `https://allurus.my/app`, made in the browser by a small open-source QR library (licence file added; ask the owner only if it isn't free/open source), no outside service;
- "No phone? Ask HR to allow this computer for you.";
- **Sign out** button.

No menus, no data, no notifications in the background. Don't load the workspace at all.

### 4. Company setting and exceptions
- **Settings → Security → "Staff use Allurus on phones only"**: default **ON** for every company (owner's decision), Owner or Settings area can switch it off.
- **"Staff may also use tablets"**: default off.
- **Per-person exception** in the Access panel (Team access): "Allow this person on a computer" (for staff without a smartphone, or office staff without admin access). Logged in the audit log (who allowed whom, when).
- The setting and exceptions are stored on the tenant / employee record and read with the profile. Rules: only Owner or the Settings area may change them.

### 5. Admin roles on a phone
- Phone layout, bottom tabs **Today, Approvals, People, Me** (mockup), plus a **More** sheet that opens the module launcher (only modules their areas allow).
- **Approvals**: leave, claims, overtime and new check-in devices in one list, with a segmented filter, Approve/Decline at 44px, and the person is notified as now.
- **People**: search staff and open a profile (masked IC and bank, as on desktop).
- Heavy screens (payroll run, imports, reports export, Team access, Settings, finance ledgers) still open on the phone, with a small note at the top: "Easier on a laptop or PC". Nothing is blocked for admins.
- An admin is also an employee: **Me** has their own leave, payslips, claims and check-in.

### 6. Employee phone app
- Tabs **Home, Leave, Payslips, Claims, Me**.
- **Home**: check-in card (uses the existing registered-phone check-in), annual leave and next payslip widgets, quick actions (Apply leave, New claim, Payslips, Overtime), My requests with status chips.
- Bahasa Malaysia and English. Greeting by time of day.
- Add to home screen: the existing PWA (`sw.js`, manifest) shows "Install Allurus" once on the second visit.

### 7. Honest limits (write this in the docs, don't oversell it)
- Device detection happens in the browser. Someone who knows how can make a computer pretend to be a phone. This rule is a **policy and convenience**, not a security wall: what a person can **see** is still decided by their role and the Firestore rules.
- For a stricter version later (owner to decide): staff may sign in only on their **registered check-in phone**. Not in this task.

## Tests
- `AllurusDevice.kind()` table test (section 1).
- Employee + computer + setting on → "Please use your phone", no workspace data requests (check the network log in a test with the Firebase emulator or a mock), Sign out works.
- Employee + phone → phone app.
- Employee + tablet → blocked when "tablets" is off, allowed when on.
- Employee with "Allow on a computer" → normal app on the computer.
- Setting off → employees use any device.
- Admin roles on computer → macOS-style workspace. On phone → Today/Approvals/People/Me + More.
- `/pos`, kiosk, `/join`, `/activate`, superadmin unaffected.
- BM and EN text, QR code opens `https://allurus.my/app`.
- `npm test`, `npm run test:rules` (setting and exception fields) pass.

## Working style
Follow `RUN-ALL-SPECS.md` (full permission, hard stops, safety steps, log). Build after `MACOS-STYLE-UI-SPEC.md`, or together on its branch. One pull request with phone and computer screenshots.

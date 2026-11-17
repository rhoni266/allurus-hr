# Phone home attendance spec

Scope: the employee home screen on phone only. Do not change the admin console, payroll or other modules.
Read first: `docs/SIMPLE-STAFF-HOME-SPEC.md`, `js/simple-home-rules.js`, `js/attendance-rules.js`, `docs/design-system.md`.

## 1. Today status (under the clock-in button)
- Pill: **On time** (green), **Late by X min** (amber), **Not clocked in yet**, **Absent**, **On leave**, **Rest day**, **Public holiday**.
- Next to it, the clock-in time in 12-hour format, e.g. "Clocked in 8:42 am".
- Show the hours-worked line only after clock-in.

## 2. Last 7 days (Mon–Sun)
- Each day gets a dot, the day letter and a word under it: On time, Late, Absent, Leave, Rest day, Holiday.
- Rest days and holidays are hollow rings.
- Screen-reader label on each dot: the full date and the status.
- Under the row: this month's On time / Late / Absent counts.
- Tapping the block opens the existing attendance history.

## 3. Rules
- Use the existing `attendance-rules.js` and each shift pattern's own grace setting. Don't add new rule code or hard-code a grace period.
- Absent only on a scheduled working day, after the shift has ended, with no clock-in and no approved leave.
- Overnight shifts count for the day they started.
- Timezone: Asia/Kuala_Lumpur.
- Employees see only their own record.

## 4. Shift tests
- Add tests for an overnight shift (22:00–06:00) and a late-ending shift (12:00–21:00): which day the punch counts for, late, and absent.
- Fix `attendance-rules.js` if any of them fail.

## 5. UI
- EN and BM, light and dark, 390px, following `docs/design-system.md`.
- No text smaller than 11px on the employee phone screens (fix the 9–10px sizes in `css/styles.css`).
- BM: write leave days as "2 hari", not "2 h", and keep "· 2 hari" on one line next to long statuses.

## 6. Major Far East: BM by default
- Add a company setting: default language for the employee app.
- Set it to BM for Major Far East; other companies stay on EN.
- Employees can switch to EN themselves, and their choice is remembered.

## 7. CLAUDE.md
Create `CLAUDE.md` in the repo root:
- Focus: HR employee phone work only for now.
- Follow `docs/design-system.md`.
- Run `npm test` before each commit.
- Never deploy unless the user says so.
- Screenshots only for UI changes: 390px, light + dark, EN. BM only if the text changed.
- Never use `git push --force`.
- Report format, max 10 lines: what was done + commit hash, tests, and numbered decisions with your recommendation.

## 8. Check and release
1. Run `npm test`. Everything must pass.
2. Check in `?demo=suria` (employee) and `?demo=majorfe` (employee, BM).
3. Commit, then a normal `git push`. Never `--force`.
4. `firebase deploy --only hosting`.
5. Open https://allurus.my/app at phone width and confirm it loads.
6. Report in max 10 lines.

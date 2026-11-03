# Allurus HR: Work Email Optional for Employees (Instructions for the coding agent)

## Goal
Remove the requirement that a new employee must have a **work email**. Nothing else changes in this task. Do not touch the invitation flow, IC login, payroll, security rules or any other item in `HR-FIX-SPEC.md`.

Reason: some companies (for example Major Far East) have crew without email.

## What is known (confirm by reading the code)
- `js/app.js`, add/edit employee form: the field `f-email` ("Work email") is `required`.
- `js/app.js`, bulk invite (near line 3153): people without a work email are refused ("they need a work email and no active account").
- Tax reliefs and tax profiles are stored **by email**: `personalFields` / `applyPersonal` in `js/cloud-map.js`, and `key()` in `js/tax.js`. A person without email would lose these.

## First, study before coding (do not skip)
1. Find **every place** where the employee's email is used as a key, an identifier, a requirement or a destination: forms and validation, the staff list and profile, directory (`DIRECTORY_FIELDS`), `users` and `invites`, notifications and the email outbox (`js/notify.js`, `js/notify-rules.js`), the import tool (`js/import/`), reports and CSV exports, payslips, EA forms, tax data, the demo and seed accounts.
2. Summarise in 10 lines what you found and what each place should do when there is no email.
3. Show me the list and your plan. Wait for my OK before changing code.

## Changes
1. **Work email is optional** in the add and edit employee forms. Remove `required` and the "Work email" asterisk or hint that says it is mandatory.
2. If an email **is** entered: check the format, and keep it **unique within the company**. If it is **empty**: no format or duplicate check, and two people may both have no email.
3. Existing employees keep their email as it is. Nothing is deleted.
4. **Invitation by email** still needs an email. For a person without one, show "Add an email, or use a registration link" instead of the error. Do not build the registration link here.
5. **Notifications** for a person with no email are shown in the app only. Email-routed events are skipped for them without errors or retries.
6. **Tax reliefs and tax profiles:** re-key by **employee id** instead of email, so people without email keep their data. Keep reading the old email-keyed copy as a fallback until I approve removing it. Write a **dry-run migration script first** (what would move, nothing changed) and show me the output before running it for real.
7. Anywhere an email is displayed (profile, directory, letters, payslips, exports) show a blank or a dash when there is none, never "undefined" or "null".
8. Fix any other place from the study where a missing email would crash, be blocked or collide (for example two empty emails treated as duplicates).

## Out of scope
Registration links, IC or phone login, password reset without email, security rules changes, privacy documents, payroll. Those are in `HR-FIX-SPEC.md` and wait for my go-ahead.

## Tests (run before saying it works)
- Add an employee with no email: it saves. Edit it: it saves.
- Add two employees with no email: both save. Add two with the same email: the second is refused with a clear message.
- An employee with no email: appears in lists, profile, directory, payslips, EA form and CSV without errors or "undefined".
- That employee can have tax reliefs and a tax profile saved and read back (keyed by id). A person who had email-keyed data before still sees it.
- Notifications for that employee appear in the app and no email is queued for them.
- Bulk invite skips people without email with a clear note, and still invites the others.
- Existing tests still pass (`npm test`), including `tests/cloud.test.js` and the tax, hr and notify tests. Add tests for the above.

## Working style
- Small steps. After each step tell me exactly what to run or open to see it.
- Do not commit, push or deploy without my go-ahead. Show any rules diff before I publish (this task should not need one; tell me if it does).
- Ask me before adding any library or paid service.

## Questions to ask me first
1. Should the staff list show "No email" as grey text, or just leave it blank?
2. Should HR see a warning when a person has neither an email nor a registration link, once the link feature exists?

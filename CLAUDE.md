# Allurus HR: working rules

- **Focus:** HR employee phone work only for now. Do not change the admin console, payroll or other modules unless the task says so.
- Follow `docs/design-system.md`.
- Run `npm test` before each commit.
- Never deploy unless the user says so.
- Screenshots only for UI changes: 390px, light + dark, EN. BM only if the text changed.
- Never use `git push --force`.
- **Report format, max 10 lines:** what was done + commit hash, tests, and numbered decisions with your recommendation.
- Run `npm run release` before every deploy (it sets the `sw.js` cache, `APP_VERSION` and every `?v=` in `app.html` from the `package.json` version; bump that version first).
- Never mint tokens or act as a real customer account without asking the user first.

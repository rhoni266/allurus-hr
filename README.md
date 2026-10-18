# Allurus HR

People operations SaaS for growing companies: a minimal, Apple-style HRMS with three roles.

| Role | Who | What they can do |
|---|---|---|
| **Super Admin** | You, the Allurus owner | See every subscribed company on a world map, MRR and ARR, plans, invoices, trials, past-due and suspended accounts. Change plans and seats, suspend or reactivate a company, mark invoices paid, open any company's workspace. |
| **Company Admin** | HR at a customer company | Dashboard, employees, departments, attendance, time-off approvals, payroll with payslips and CSV export, a recruitment pipeline with drag and drop, performance reviews, and company settings. |
| **Employee** | Staff at a customer company | Time clock with location-stamped check-in and check-out, attendance history, time-off requests and balances, payslips, profile, goals, and the company directory. |

Clients can **Register company** from the sign-in screen. That creates a new workspace on a 14-day trial, optionally filled with a sample team.

## Open it in VS Code for the Web (vscode.dev)

No build step is needed. The project is plain HTML, CSS and JavaScript.

1. Put this folder in a GitHub repository (or download it).
2. Go to **https://vscode.dev**. Choose **Open Remote Repository** and pick your GitHub repo, or choose **Open Folder** for a local copy.
   Shortcut: on any GitHub repo page, press `.` to open it in github.dev.
3. Install the **Live Preview** extension (Microsoft), right-click `index.html` and choose **Show Preview**.

To run it on your own computer, open a terminal in this folder and run `npx serve .` or `python3 -m http.server`. Then visit http://localhost:8000.

## Put it online for clients

- **GitHub Pages:** Repo → Settings → Pages → Deploy from branch `main` / root. Netlify or Vercel also work: drag the folder in.
- Over HTTPS, check-in uses the device's real GPS location. The browser asks for permission first. If permission is refused, the app falls back to the city implied by the device's time zone and labels the location "approx.".

## Project structure

```
index.html          App shell: sign-in screen, sidebar, top bar
brand.html          Brand kit: logo, palette, type, usage rules
css/styles.css      Design tokens (light and dark) and all components
js/utils.js         Dates, money math, city table, location helpers
js/seed.js          Demo data: the Lumen & Co. workspace and 14 subscribed companies
js/app.js           Views, routing per role, actions, registration, shared-link sync
js/vendor/          jsVectorMap (MIT) for the Super Admin world map
assets/             logo.svg, logo-mark.svg
```

## Brand

| Name | Hex | Use |
|---|---|---|
| Allurus Teal | `#0F766E` | Primary: buttons, links, logo tile |
| Deep Teal | `#0B5F59` | Hover and pressed states |
| Champagne | `#D9B66F` | Accent: crossbar, highlights |
| Obsidian | `#16181D` | Text, dark surfaces |
| Slate | `#5F636B` | Secondary text |
| Mist | `#F5F5F7` | Background |

## How data is stored (read this before going live)

This is a working **front-end prototype**. Each browser keeps its own data in `localStorage`. When the app runs as a claude.ai artifact, company sign-ups and check-ins are also written to the artifact's shared database, so the owner sees them in the Super Admin console.

A production version needs:
1. **A backend and database** (for example Supabase, Firebase, or Node/NestJS with Postgres). Each company's data gets a `tenant_id`.
2. **Real authentication** (email and password, magic links or SSO) with role-based access, replacing the demo role picker.
3. **Billing** (Stripe) for plans and invoices.
4. **Server-side payroll rules** for each country, plus audit logs.

The code is organized so each view reads from a single `state` object, which makes swapping `localStorage` for API calls straightforward.

# Allurus HR: moving from localStorage to a real backend

Status: **plan only, nothing built yet.** Written against the repo at version 3.2 (commit `3294c4f`).
Read with: `README.md` ("How data is stored"), `js/app.js` (`load()`, `save()`, `commit()`, `WS_KEYS`),
`js/seed.js`, and the no-DOM rules modules (`js/*-rules.js`, `js/statutory.js`, `js/utils.js`).

Items marked **⚠ verify** are legal, regulatory or vendor facts to confirm with an adviser or the vendor's current
documentation before relying on them. Effort figures are estimates for planning, not quotes.

---

## 1. Where we are today

What the code does now, and why each point matters for the backend:

| Today | Where | What it means for the backend |
|---|---|---|
| The whole app state is one JSON object, saved to `localStorage['allurus-hr-v7']` on every `commit()`. | `js/app.js` `load()` / `save()` / `commit()` | Every write is "save everything". We need per-record writes, and the server has to enforce rules the browser enforces today. |
| Other companies' data sits in the same object under `state.workspaces[tenantId]`. `switchWorkspace()` swaps 43 top-level keys (`WS_KEYS`). | `js/app.js` | Tenancy is a client-side convention. On a server it becomes `tenant_id` plus row-level security. |
| Passwords are checked in the browser against unsalted SHA-256 of `email:password`. The hashes for the demo accounts ship in `js/seed.js`. | `js/seed.js` `accounts`, `U.hashPassword`, `js/app.js` sign-in and change-password, `js/kiosk.js` | This is not authentication, because anyone can read and edit localStorage. Sign-in moves to the server, and the hashes come out of the seed (§4.5). |
| Roles (`super`, `admin`, `employee`, `auditor`) only decide what each screen shows. | `ROLE_ROUTES`, `routes()` | Hiding a screen is not access control. Permissions must be enforced in the database (§4.3). |
| Selfies, face reference photos and descriptors, MCs, claim receipts, employee documents and announcement attachments are stored as data URLs inside the state. | `writeCheckin`, `e.face`, `leaves[].attachment`, `claims[].lines[].img`, `documents[].file`, `announcements[].attachment` | These move to private object storage with retention rules. Face descriptors are biometric data (§6). |
| Selfies are pruned after 30 days by `pruneSelfies()`, but only when someone checks in on that browser. | `js/app.js` | Retention has to run as a scheduled server job. |
| Check-ins captured offline wait in an outbox in localStorage and sync later. The kiosk has its own device key. | `js/kiosk.js`, `js/checkin-rules.js`, `sw.js` | Keep the outbox (move it to IndexedDB), and add idempotency keys and server-side timestamps. |
| Reminders, notification de-duplication keys and the email outbox run in the browser on first load each day. | `js/notify.js` `runReminders()`, `state.outbox`, `state.notifyKeys` | These become scheduled server jobs plus a real email and push provider. `providers.email` / `providers.push` are already the plug-in point. |
| Payroll, statutory files, EA forms, MyInvois JSON and reports are computed in the browser. The rules are pure modules that already run under Node (the test suite proves it). | `js/utils.js`, `js/statutory.js`, `js/einvoice-rules.js`, `js/report-rules.js`, etc. | We can reuse the same code on the server. That makes a JavaScript/TypeScript backend the natural fit. |
| When published as a claude.ai artifact, registrations and check-ins are mirrored to a shared artifact database. | `connectCloud()`, `cloudWrite()` | This is a demo-only channel. Replace it in live mode and keep it in demo mode. |
| Monthly finance reports are fingerprinted and locked once the auditor verifies them. | `js/finance.js` `fingerprint()`, `lockedMsg` | Locks must be enforced by the database (a trigger), not by the UI. |
| Tax reliefs (`state.reliefs`) and the financial planner (`state.plans`) are personal to an employee, keyed by email or employee ID. | `js/tax.js`, `js/planner.js` | These are the employee's private data. The employer must not be able to read them (§3.4). |

---

## 2. Recommended stack

### 2.1 Options compared

The scores below are judgements for a team of 2–3 developers that also runs support.

| Criterion | **A. Supabase** (managed Postgres, Auth, Storage, Realtime, Edge Functions) | **B. Node/NestJS + Postgres** (self-run on AWS: RDS, S3, ECS/Fargate, SES) |
|---|---|---|
| Time to first production tenant | **Fast.** Auth, storage, realtime, RLS and the admin dashboard come built in. | Slower. Auth, file signing, realtime and admin tooling all need building or integrating. |
| Fit with the current "views read one `state`" pattern | **Good.** supabase-js can fill `state` from tables, and Realtime replaces the `storage` event sync. | Good, but you write the REST/GraphQL layer and the change feed yourself. |
| Enforcing tenancy and roles | **RLS is the primary mechanism**, and every client path goes through it. | Usually enforced in service code (guards). RLS is possible but often skipped, so one bug can leak tenants. |
| Data residency | Regions include Singapore; there is no Malaysian region today **⚠ verify**. | AWS has a Malaysia region (ap-southeast-5) **⚠ verify service coverage**, so all data can stay in Malaysia. |
| Long-running and stateful work (payroll for 1,000 staff, MyInvois signing with certificates, PDF generation, virus scanning) | Edge Functions have short time limits, so a separate small worker is needed anyway. | Native: workers and queues live in the same codebase. |
| Lock-in | Low to moderate. Data is plain Postgres. Auth and storage APIs are the parts you would have to port. | Low. |
| Operations burden | Low: patching, backups and PITR are managed (PITR is a paid add-on **⚠ verify**). | High: patching, backups, secrets, scaling, observability and on-call are all yours. |
| Enterprise SSO (SAML) | Available on paid tiers **⚠ verify plan and pricing**. | Use a library or a hosted IdP broker (e.g. WorkOS, Auth0). |
| Cost at 0–50 tenants | Low and predictable (one Pro project per environment). | Higher fixed cost (RDS Multi-AZ, NAT gateway, Fargate, load balancer). |
| Compliance evidence (SOC 2 / ISO 27001) | You inherit the vendor's reports for the platform layer and own the application layer. | You inherit AWS's reports for the infrastructure and own everything above it. |

### 2.2 Recommendation

**Start with option A: Supabase Postgres as the system of record, plus one small TypeScript worker service.**

- **Supabase** handles Postgres with RLS, Auth (email/password, magic link, SAML later), Storage (private buckets) and Realtime (live updates across devices).
- **The worker** is Node 20 + TypeScript, deployed as one container on Fly.io, Render or AWS Fargate in Singapore. It consumes a Postgres-backed queue (`pgmq` / Supabase Queues, or `pg-boss`). It runs payroll, statutory files, PDFs, email and push, MyInvois, Stripe webhooks, retention purges and virus scanning.
- **Shared rules.** Turn `js/*-rules.js`, `js/statutory.js`, `js/einvoice-rules.js` and the maths in `js/utils.js` into one package that both the browser (no build step, still `window.X` globals) and the worker load. The browser keeps them for instant previews; the server re-runs them as the authority.
- **Keep everything portable.** Write migrations as plain SQL, put workflow logic in Postgres functions and the worker rather than vendor-only features, and isolate Auth/Storage calls behind `js/store/` (§5). A later move to option B is then a port of auth and storage, not a rewrite.

**When to choose option B instead, or switch to it later:** if early customers (government-linked companies, banks, large enterprises) contractually require Malaysian data residency, or ask for single-tenant or VPC deployment. The schema, RLS policies and worker carry over unchanged to RDS in ap-southeast-5. NestJS then replaces Supabase Auth and Storage with Cognito or a self-hosted auth service, and S3.

### 2.3 Environments

| | Dev | Staging | Production |
|---|---|---|---|
| Supabase project | local (`supabase start`, Docker) | separate project | separate project, Pro plan, PITR on |
| Worker | local | 1 instance | 2 instances (HA) |
| Data | seed (demo company) | anonymised seed only, **never production data** | real |
| Email | captured (Mailpit) | provider sandbox | provider live |
| Stripe / MyInvois | test mode / LHDN sandbox (preprod) | test mode / LHDN sandbox | live / LHDN production |

Infrastructure is code: SQL migrations (`supabase/migrations/*.sql`), worker Dockerfile, Terraform for DNS, worker and buckets, and GitHub Actions for CI (tests, RLS tests, migration dry-run).

---

## 3. Database schema

### 3.1 Conventions

- Every tenant-owned table has `tenant_id uuid not null references tenants(id)`. The primary key is `id uuid default gen_random_uuid()`, and every unique constraint includes `tenant_id`.
- **The browser's IDs (`e1`, `c3`, `rq4`…) become UUIDs.** Keep a `legacy_id text` column on imported rows so demo exports can be imported (§5.6).
- Every table has `created_at timestamptz default now()`, `created_by uuid` (auth user), `updated_at`, and `version int` (optimistic locking: an update must send the version it read).
- Money is `numeric(14,2)` in MYR, and rates are `numeric(7,4)`. Calendar dates are `date`, instants are `timestamptz`, and the tenant time zone defaults to `Asia/Kuala_Lumpur`. **"Today" is decided by the server, not the device.**
- Enumerations are `text` with `check` constraints, so the values stay readable and match the strings used in the JS.
- Nested lists the UI always reads and writes as a whole (quiz questions, checklist template tasks, `extraLines`) stay `jsonb`, with a JSON schema check. Anything that is queried, filtered, approved or reported on becomes rows.
- Sensitive columns (`*_enc bytea`) use application-level envelope encryption (§8.1). A `*_hash` blind index (HMAC) is stored where look-ups are needed (e.g. IC number).
- Soft delete (`deleted_at`) is used only where history matters (employees, assets). Everything else is hard-deleted, with the audit log as the record.

### 3.2 Approval chains (shared)

Leaves, claims, time requests, requisitions and training requests each carry a `chain` array today, built by `AllurusLeaveRules.buildChain`. Normalise these into one table, so RLS can answer "is this person the next approver?" with a join:

```sql
create table approval_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  subject_type text not null check (subject_type in ('leave','claim','time_request','requisition','training_request')),
  subject_id uuid not null,
  seq smallint not null,                       -- 1, 2, 3 in chain order
  level text not null check (level in ('L1','L2','Final')),
  label text not null,
  approver_id uuid references employees(id),
  backup_id uuid references employees(id),
  status text not null check (status in ('pending','approved','rejected','skipped','cancelled')),
  acted_by uuid references employees(id),
  acted_as text check (acted_as in ('approver','backup','admin')),
  acted_at timestamptz,
  note text,
  unique (tenant_id, subject_type, subject_id, seq)
);
create index on approval_steps (tenant_id, approver_id) where status = 'pending';
```

The steps are built by a Postgres function that runs the same logic as `buildChain`. Decisions go through `rpc_decide(subject_type, subject_id, approve, note)`. It checks `canAct` (approver, or backup while the approver is on leave, or an admin for the Final step), updates the step and the subject's status atomically, and queues notifications.

### 3.3 Platform, identity and tenancy

| Table | Columns (beyond the conventions) | Replaces |
|---|---|---|
| `tenants` | name, legal_name, city, lat, lng, industry, country, status (`Trial`/`Active`/`Past due`/`Suspended`/`Cancelled`), plan_id, seats, joined_on, last_active_on, time_zone, data_region | `platform.tenants[]` |
| `plans` | code, name, price_per_seat, currency, max_seats, features jsonb, stripe_price_id, active | `platform.plans[]` |
| `subscriptions` | tenant_id, stripe_customer_id, stripe_subscription_id, status, seats, current_period_end, cancel_at, trial_end | (new; feeds `platform.mrr`) |
| `platform_invoices` | tenant_id, stripe_invoice_id, month, amount, currency, status, hosted_url, einvoice_status | `platform.invoices[]` |
| `mrr_snapshots` | month, value | `platform.mrr[]` (derived nightly) |
| `users` (= `auth.users` plus a `profiles` table) | email, name, mfa_enrolled, last_sign_in_at | `accounts[]` without `hash` |
| `memberships` | user_id, tenant_id, roles text[] (`admin`,`employee`,`auditor`), employee_id, status, invited_by, invited_at | `accounts[].roles/tenantId/empId` |
| `platform_staff` | user_id, role (`super`,`support`,`billing`) | the `super` role |
| `support_access_grants` | tenant_id, staff_user_id, granted_by, reason, starts_at, expires_at | (new, §4.3) |
| `devices` | tenant_id, employee_id (nullable for kiosks), kind (`phone`,`kiosk`), device_uid, name, status (`pending`,`approved`,`revoked`), added_on, auto, kiosk_token_hash | `employees[].devices[]`, kiosk config |
| `tenant_settings` | tenant_id, key (`company`,`checkin`,`leave`,`time`,`claims`,`statutory`,`employer`,`appraisal`,`hr`,`einvoice`,`recruit`,`grievance`,`training`,`notify`,`appearance`), value jsonb, schema_version | `settings.*` |
| `statutory_rate_tables` | tenant_id (null = platform default), kind (`epf`,`socso`,`eis`,`pcb`,`hrdf`), effective_from, payload jsonb, source_note | `U.STATUTORY`, `settings.statutory` (rates stay editable, now effective-dated) |

`tenant_settings` stays JSON because each section is read and written whole by its settings card. Parts that are queried get their own tables:

- `leave_types`
- `holidays`
- `dept_approval_chains`
- `work_patterns`
- `claim_categories`
- `appraisal_templates`
- `grade_bands`
- `checklist_templates`
- `letter_templates`
- `job_post_templates`
- `offer_templates`
- `scorecard_criteria`
- `checkin_zones`
- `projects_at_checkin`

### 3.4 Every entity in `state`, mapped to tables

Every table below carries `tenant_id` except where marked **personal** (owned by a user, not readable by the employer) or **platform**.

| `state` key | Table(s) | Key columns / notes |
|---|---|---|
| `session` | (none; it becomes the auth session) | The JWT carries `sub`. The active tenant and role are chosen in the UI and checked against `memberships`. |
| `accounts` | `users`, `memberships` | No password data in our tables (§4). |
| `workspaces` | (gone) | Each tenant is just rows with its own `tenant_id`. |
| `platform` | **platform**: `tenants`, `plans`, `subscriptions`, `platform_invoices`, `mrr_snapshots` | §9 |
| `settings` | `tenant_settings` + the normalised tables in §3.3 | |
| `departments` | `departments` | name, lead_id → employees, color, about, duties |
| `employees` | `employees`, `employee_addresses`, `employee_emergency_contacts`, `employee_education`, `employee_prior_employment`, `career_events` | Core: first, last, job_title (today's `role`), dept_id, manager_id, salary, start_on, end_on, location, birthday, work_email, personal_email, phone, type, status, gender, married, time_pattern_id, probation_end, confirmed_on, contract_end, nationality, cp22_filed_on, leaver_filed_on, leave_reason. **Encrypted:** `ic_enc`+`ic_hash`, `passport_no_enc`, `permit_no_enc`, `epf_no_enc`, `socso_no_enc`, `tax_no_enc`, `bank_code`, `account_no_enc`. Expiries (passport, permit) stay plain dates so reminders can query them. |
| `employees[].face` | `face_enrolments` | employee_id, photo_object (storage path), descriptor_enc (biometric), status (`pending`,`confirmed`,`rejected`), enrolled_on, consent_id → `consents` |
| `employees[].devices` | `devices` | |
| `leaves` | `leave_requests` + `approval_steps` | employee_id, leave_type_id, from_on, to_on, half (`am`/`pm`/null), days numeric(5,1), reason, status, attachment_object |
| `leaveCarry` | `leave_carry` | year, employee_id, days |
| `leaveCredits` | `leave_credits` | employee_id, days, granted_on, reason |
| `attendance` (`{day: {empId: rec}}`) | `attendance_days` + `checkin_events` | `attendance_days`: employee_id, day, status (`present`/`remote`/`leave`/…), first_in, last_in, out, project_id, job_id, reviewed_by, reviewed_at. `checkin_events` (append-only): kind (`in`/`out`), device_time, **server_time**, offline, via (`self`/`kiosk`/`supervisor`), by_id, lat, lng, accuracy, source, inside, zone_snapshot jsonb, flags text[], face_result, face_sim, upload, device_id, selfie_object, idempotency_key unique |
| `rosters` (`{day: {empId: patternId}}`) | `roster_assignments` | employee_id, day, pattern_id |
| `timeRequests` | `time_requests` + `approval_steps` | kind (`ot`/`waiver`/`correction`), day, from_t, to_t, minutes, reason, status |
| `attAudit` | `attendance_audit` | day, employee_id, by_id, changes jsonb, note, batch_id (append-only) |
| `payroll` (`{month: run}`) | `payroll_runs`, `payroll_items`, `payroll_item_lines` | Run: month, status (`Draft`/`Approved`/`Paid`), paid_on, rules_version, inputs_hash. Item: employee_id, base, unpaid, unpaid_days, bonus, gross, epf_wage, socso_wage, tax, epf, socso, eis, zakat, er_epf, er_socso, er_eis, hrdf, er_cost, claims, net, claim_gl jsonb. Lines: key (`ot`, allowance code, claim id), label, amount. Paid runs are locked by a trigger. |
| `statutory` | `statutory_filings` | month, kind (`epf`,`socso`,`pcb`,`hrdf`,`ea`,`form_e`,`cp8d`,`cp22`,`cp22a`,`cp21`), filed_on, file_object, checksum, by_id |
| `payChanges` | `pay_changes` | employee_id, source, ref, cycle_id, type, from_amount, to_amount, pct, effective_on, status |
| `claims` | `claims`, `claim_lines`, `claim_edits` + `approval_steps` | Claim: employee_id, title, status, submitted_on, paid_in_month, approved_total. Line: category_id, date, merchant, receipt_no, amount, approved, receipt_object, notes, fields jsonb, sub |
| `finance.txns` | `ledger_txns` | date, description, type, category, amount, tax, ref, source, reconciled |
| `finance.invoices` | `invoices`, `invoice_items`, `einvoice_documents` | Invoice: no, type (`invoice`/`credit`/`debit`/`refund`), ref_invoice_id, contact_id, issue_on, due_on, tax_rate, status, paid_on. `einvoice_documents`: status, uuid, long_id, submission_uid, submitted_at, validated_at, cancelled_at, errors jsonb, history jsonb, payload_object |
| `finance.bills` | `bills` (+ `einvoice_documents` for self-billed) | supplier contact_id, ref, category, issue_on, due_on, amount, tax, status, paid_on, self_billed, self_no |
| `finance.contacts` | `contacts` | kind, name, tin, id_type, id_no, sst, email, phone, contact_name, address jsonb |
| `finance.budgets` / `reports` / `settings` | `budgets` (category, amount), `finance_reports` (month, status, snapshot jsonb, fingerprint, trail jsonb), `tenant_settings['finance']` | A verified `finance_reports` row locks its month's `ledger_txns`, `invoices` and `bills` with a trigger. |
| `projects` | `projects` | code, name, client, active |
| `costing` | `job_groups`, `cost_jobs`, `timesheets` | targets, budgets; timesheet: employee_id, day, project_id, job_id, hours, note |
| `savedReports` | `saved_reports` | owner_id, name, definition jsonb (the custom report spec) |
| `cycles`, `reviews`, `goals` | `review_cycles`, `reviews`, `review_scores`, `peer_feedback`, `goals`, `goal_checkins` | Peer feedback rows have `anonymous` and are only readable in aggregate (RLS + view). |
| `editRequests` | `profile_change_requests` | employee_id, changes jsonb (before/after per field), note, status, decided_by |
| `checklists` | `checklists`, `checklist_tasks` | kind (`onboarding`/`offboarding`), template_id, anchor_on; task: title, assignee_id, due_on, done_on |
| `assets` | `assets`, `asset_movements` | tag, type, name, serial, value, bought_on, holder_id; movements replace `history[]` |
| `loans` | `staff_loans` | employee_id, purpose, amount, months, start_month, extra jsonb, approved_by |
| `insurance` | `insurance_policies` | name, insurer, policy_no, sum_insured, premium, start_on, end_on, covers |
| `documents` | `employee_documents` | employee_id, title, category, expiry_on, file_object, uploaded_by |
| `announcements` | `announcements`, `announcement_acks` | kind (`news`/`policy`), title, html (sanitised server-side), depts uuid[], pinned, attachment_object; acks: employee_id, acked_at |
| `notifications` | `notifications` | recipient_user_id, type, category, icon, title, body, href, read_at, from_id, dedupe_key (unique per recipient) |
| `outbox` | `email_outbox` | to_email, to_user_id, type, subject, body, status (`queued`/`sent`/`failed`/`bounced`), provider_id, attempts, last_error, sent_at |
| `notifyKeys`, `reminderRun` | (gone) | Replaced by unique `dedupe_key` on notifications and a `job_runs` table. |
| (preferences) | `notification_prefs` | user_id, category, channel |
| `jobs` | `job_openings` | title, dept_id, location, type, opened_on, closes_on, requisition_id, headcount, salary_min, salary_max, published, description jsonb, boards jsonb |
| `candidates` | `candidates`, `candidate_stage_events`, `interviews`, `interview_panel`, `scorecards`, `offers` | Candidate: job_id, name, email, phone, link, note, source, stage, rejected_on, hired_on, converted_employee_id, consent_id. Stage events replace `stageDates`. A scorecard is unique per (interview, interviewer). |
| `requisitions` | `requisitions` + `approval_steps` | |
| `courses` | `courses`, `course_modules` | quiz jsonb (questions with answer index: **never sent to the learner**, see below), mandatory jsonb, valid_months, hrdc_claimable, hrdc_fee |
| `enrolments` | `enrolments`, `quiz_attempts` | done_module_ids uuid[], completed_at, cert_no (unique per tenant), expires_on |
| `trainingRequests` | `training_requests` + `approval_steps` | |
| `grievances` | `grievances`, `grievance_events`, `grievance_reveals` | `raiser_id` is readable only by the raiser and by grievance managers after a reveal (§4.3). Events carry `internal boolean`. |
| `rooms`, `bookings` | `rooms`, `room_bookings` | A Postgres exclusion constraint (`tstzrange` overlap, `where status <> 'Cancelled'`) makes double bookings impossible even under races. |
| `activity` | `activity_feed` | the human-readable feed (not the audit log) |
| `reliefs` | **personal** `tax_relief_receipts` | user_id, year, date, description, amount, category, confirmed, receipt_object. No `tenant_id` access for admins. |
| `taxProfiles` | **personal** `tax_profiles` | user_id, payload jsonb |
| `plans` (financial planner) | **personal** `finance_plans` | user_id, items jsonb, paid jsonb |
| (new) | `consents`, `privacy_notices`, `data_subject_requests`, `breach_register`, `retention_policies` | §6 |
| (new) | `audit_log`, `job_runs`, `files` | §7, §8 |

The careers application form (today a localStorage write) becomes a public, rate-limited endpoint that inserts into `candidates`. It never reads the table.

Quiz answers today are in the course object the employee's browser holds, so a learner could read them. The backend serves questions without the `answer` field and scores attempts in `rpc_submit_quiz`.

### 3.5 Example DDL with RLS

```sql
create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  employee_id uuid not null references employees(id),
  leave_type_id uuid not null references leave_types(id),
  from_on date not null, to_on date not null check (to_on >= from_on),
  half text check (half in ('am','pm')),
  days numeric(5,1) not null,
  reason text,
  attachment_object text,           -- storage path in bucket 'leave-docs'
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected','Cancelled')),
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz, version int not null default 1
);
alter table leave_requests enable row level security;
alter table leave_requests force row level security;

-- Helpers (security definer, stable). current_tenant() comes from the JWT claim set at sign-in / tenant switch.
--   current_tenant() uuid, current_employee() uuid, has_role(text) bool,
--   is_pending_approver(subject_type, subject_id) bool, manages(employee_id) bool

create policy leave_read on leave_requests for select using (
  tenant_id = current_tenant() and (
    has_role('admin')
    or employee_id = current_employee()
    or is_pending_approver('leave', id)
    or manages(employee_id)                       -- team calendar
  ));
create policy leave_insert_self on leave_requests for insert with check (
  tenant_id = current_tenant() and employee_id = current_employee() and status = 'Pending');
-- No direct UPDATE for non-admins: decisions and cancellations go through rpc_decide / rpc_cancel_leave.
create policy leave_admin_write on leave_requests for update using (tenant_id = current_tenant() and has_role('admin'));
```

The same pattern applies to every table. The policy matrix lives in `supabase/policies/*.sql` and is tested with pgTAP: for each role, check what it can and cannot read or write, including cross-tenant attempts.

---

## 4. Authentication, roles and permissions

### 4.1 Sign-in methods

| Method | How | Notes |
|---|---|---|
| Email + password | Supabase Auth: bcrypt hashing on the server, a password strength rule (min 10 characters, a breached-password check), and lockout and rate limits. | The browser never hashes or compares passwords. |
| Magic link | Supabase Auth OTP email. The link expires in 15 minutes and is single use. | The default for employees who rarely sign in. It also completes invitations. |
| MFA | TOTP. **Required for `admin`, `auditor` and all platform staff**, optional for employees. | |
| SSO (optional, per tenant) | SAML 2.0 / OIDC (Microsoft Entra ID, Google Workspace) **⚠ verify plan tier**. Domain verification, plus just-in-time membership mapped to the `employee` role. | Admins can require SSO for their domain. |
| Kiosk | The device is registered by an admin, who generates a pairing code. The kiosk gets a long-lived **device token** (hashed in `devices.kiosk_token_hash`) whose only permission is `rpc_kiosk_checkin`. | Replaces the kiosk password set-up in `js/kiosk.js`. |
| Careers page | Anonymous, with Cloudflare Turnstile (or hCaptcha) and per-IP rate limiting on the edge function. | |

Sessions use short-lived JWTs (1 hour) with refresh-token rotation. Signing out everywhere revokes refresh tokens. The active tenant is a custom JWT claim set by `rpc_switch_tenant(tenant_id)`, which checks `memberships`.

### 4.2 Roles

| Role | Scope | Can |
|---|---|---|
| `super` (platform staff) | The platform | Manage tenants, plans, billing, health, MRR. **No tenant HR data** unless a support grant is active (§4.3). |
| `admin` (Company Admin) | One tenant | Everything in the tenant, except other people's personal tax reliefs and planner. Anonymous grievance identities need a recorded reveal. |
| `employee` | One tenant | Their own records. As a relationship, also their team (manager), requests where they are the pending approver or covering backup, interviews they sit on, grievances assigned to them (grievance manager), their own checklist tasks. |
| `auditor` | One tenant, time-boxed | Read-only finance (ledger, invoices, bills, tax deductions, reports). Write only to `finance_reports` verification (verify or request changes). |

Under the hood, roles map to **permissions** (e.g. `payroll.approve`, `employees.read_sensitive`, `grievance.manage`). The RLS helpers check permissions, so finer-grained custom roles can be added later without rewriting policies. HR officer, payroll officer and department head are the likely first requests.

### 4.3 Sensitive-access rules (enforced in the database)

- **Sensitive employee fields** (IC, passport, bank, tax, EPF/SOCSO numbers) are decrypted only by `rpc_employee_sensitive(id)`. It requires `employees.read_sensitive` (admin, or the employee themself) and writes an `audit_log` entry for every read.
- **Payroll** amounts are visible to the employee for their own payslip and to admins; managers do not see them.
- **Grievances**: the raiser sees their case without internal events. Grievance managers see cases assigned to them (admins see all), with `raiser_id` masked by a view for anonymous cases. `rpc_reveal_grievance_raiser(id, reason)` inserts into `grievance_reveals` and unmasks the name for that manager only. The summary report reads from a view with no identifying columns.
- **360° peer feedback** is readable only in aggregate, and only once at least `peerMin` responses exist.
- **Personal data** (`tax_relief_receipts`, `tax_profiles`, `finance_plans`) is readable only where `user_id = auth.uid()`.
- **Platform staff support access**: a tenant admin grants `support_access_grants` for 1–72 hours. While a grant is active, the staff member's JWT carries the tenant with a read-only `support` role. Every query is logged and the tenant admin is notified.
- **Locks**: paid payroll runs, verified finance months and validated e-Invoices are immutable through triggers. Corrections create new documents (credit notes, adjustment runs).

### 4.4 Invitations and joiners

- An admin adds an employee, which creates a pending `membership` and sends an invite email with a magic link. On first sign-in the user links to the membership.
- New-company registration (`newWorkspace()` today) becomes `rpc_register_company`. It creates the tenant, the admin membership, the default settings and a Stripe trial customer, all in one transaction.

### 4.5 Removing password hashes from `js/seed.js`

1. Delete `hash` from every entry in `accounts` in `js/seed.js`, and the comment about SHA-256.
2. **Demo mode sign-in becomes "pick a demo persona"**: Company Admin (Amara), Employee (Daniel), Auditor, Super Admin. No password is involved. A small "Demo, data stays in this browser" banner stays.
3. Delete `U.hashPassword` and `U.sha256js` from `js/utils.js` once no caller remains. The callers are the sign-in, change-password and registration paths in `js/app.js` and kiosk set-up in `js/kiosk.js`; each is removed in demo mode or replaced by Supabase Auth in live mode.
4. Hide the change-password UI and the "registration password" field in demo mode.
5. Bump `STORE_KEY` so old browsers drop stored hashes. Add a `load()` migration that deletes any `accounts[].hash` it finds.
6. Add a CI grep check that fails the build if a 64-hex-character `hash:` appears in `js/`.

---

## 5. API layer: replacing `save()` / `load()`

### 5.1 Principle

**Views keep reading the single `state` object.** We change how `state` is filled and how changes leave the browser.

```
            ┌───────────── js/store/index.js (AllurusStore) ─────────────┐
 views ──▶  │ state (cache)   bootstrap()   command(name, payload)   subscribe() │
            └──────────┬──────────────────────────────┬──────────────────┘
                       │ demo driver                  │ live driver
                localStorage + seed.js          supabase-js (vendored) → Postgres (RLS)
                (today's behaviour)             + RPCs + Realtime + Storage
```

- `bootstrap()` replaces `load()`. The live driver fetches what the current role may see (RLS decides) and assembles today's `state` shape, so views need no changes. For large tables (attendance, check-ins, ledger, notifications), it loads a window (e.g. the last 60 days) and pages older data on demand.
- `command(name, payload)` replaces "mutate `state` then `commit()`". The demo driver applies the mutation locally, exactly as today. The live driver calls an RPC or edge function, then patches `state` with the returned rows. `commit(msg, activity)` keeps its signature: it awaits the command, then re-renders and shows the toast. On failure it rolls back and shows an error.
- `subscribe()` replaces the `storage`-event listener. Realtime channels (one per tenant, filtered by RLS) patch `state` and re-render the current view.
- **Writes are commands, not raw table writes**, wherever a rule or workflow applies. Examples: `leave.apply`, `approval.decide`, `checkin.record`, `payroll.approve`, `claim.submit`, `grievance.raise`, `room.book`, `quiz.submit`, `invoice.issue`, `einvoice.submit`. Plain CRUD with RLS is fine for simple master data (rooms, assets, departments, templates).
- Every command carries an **idempotency key** (UUID made by the client), so retries and the offline outbox never double-apply.
- Optimistic concurrency: updates send `version`. On a conflict the UI shows "This changed while you were editing" and reloads the record.

### 5.2 Where code changes

- New: `js/store/index.js`, `js/store/demo.js`, `js/store/live.js`, and `js/vendor/supabase-js/` (MIT licence file; a new dependency, **needs your approval**).
- `js/app.js`: `load()`/`save()` move into the demo driver, `commit()` awaits the store, and `WS_KEYS`/`switchWorkspace()` disappear in live mode.
- Each module's `ACTIONS` change from "mutate and commit" to `ctx.command(...)`. This is mechanical per action and can be done module by module.
- `js/config.js` (new, non-secret): `{ mode: 'demo' | 'live', supabaseUrl, supabaseAnonKey, sentryDsn }`. GitHub Pages ships `mode: 'demo'`.

### 5.3 Migration order, view by view

Do each step behind the live driver while the demo driver keeps working; a module is "done" when its tests pass against both drivers.

| Step | Routes / views | Tables | Commands | Notes |
|---|---|---|---|---|
| 1 | Sign-in, role switch, Settings → account | users, memberships, tenants, tenant_settings | `auth.*`, `tenant.switch` | Demo personas. MFA for admins. |
| 2 | Employees, Departments, Directory, Profile, Org chart | employees (+ child tables), departments, profile_change_requests | `employee.upsert`, `profile.request`, `profile.decide` | Sensitive fields via RPC. |
| 3 | Settings cards (company, leave, time, claims, statutory, employer, notify) | tenant_settings + normalised tables | `settings.save(section)` | |
| 4 | Home / Dashboard check-in, My attendance, Attendance, Kiosk | attendance_days, checkin_events, devices, face_enrolments, checkin_zones | `checkin.record`, `checkin.review`, `device.approve`, `face.confirm` | Server-side time, signed selfie uploads, offline outbox to IndexedDB. |
| 5 | Schedule, time requests, batch edit | roster_assignments, time_requests, attendance_audit | `roster.set`, `time.request`, `attendance.batch_edit` | |
| 6 | Time off, My time off, Approvals | leave_requests, approval_steps, leave_types, holidays, leave_carry, leave_credits | `leave.apply/cancel`, `approval.decide` | First user of `approval_steps`. |
| 7 | Claims, My claims | claims, claim_lines, approval_steps | `claim.submit/correct/decide/pay` | Receipt OCR stays in the browser; the image goes to storage. |
| 8 | Payroll, Payslips, statutory files, year-end | payroll_runs/items/lines, statutory_filings, pay_changes | `payroll.prepare` (worker), `payroll.approve`, `payroll.mark_paid`, `statutory.generate` | Server-authoritative (§7.1). |
| 9 | Finance (overview, books, invoices, bills, budget, tax, reports & audit), Contacts, e-Invoice | ledger_txns, invoices, bills, contacts, budgets, finance_reports, einvoice_documents | `invoice.*`, `bill.*`, `report.submit/verify`, `einvoice.submit/cancel` | Locks via triggers. MyInvois in the worker. |
| 10 | Performance, Appraisal & goals | review_cycles, reviews, review_scores, peer_feedback, goals, goal_checkins | `cycle.launch`, `review.submit`, `review.final` | |
| 11 | Onboarding, Assets & loans, Letters, Documents, Announcements | checklists, assets, staff_loans, insurance_policies, employee_documents, announcements | … | |
| 12 | Recruitment, Careers page, Training, Grievances, Meeting rooms | §3.4 talent tables | `requisition.*`, `application.submit` (public), `interview.*`, `offer.*`, `quiz.submit`, `grievance.*`, `room.book` | |
| 13 | HR reports, Project costing, Timesheet, saved reports | read models over the tables above, saved_reports, timesheets | `report.run` (server for large ranges) | `js/report-rules.js` runs in the browser over fetched rows, or in the worker for big tenants. |
| 14 | Notifications bell, preferences, outbox (admin) | notifications, notification_prefs, email_outbox | `notification.read` | Delivery fully server-side (§7). |
| 15 | Super Admin: overview, companies, plans & billing | platform tables | `tenant.*`, `billing.*` | Stripe (§9). |
| 16 | Tax reliefs, Financial planner | personal tables | `relief.*`, `plan.*` | User-scoped, last because it carries the lowest risk. |

### 5.4 Keeping the demo mode

- `mode: 'demo'` (GitHub Pages and the claude.ai artifact) uses the demo driver: today's localStorage + `seed.js`, personas instead of passwords, and the `cloud` artifact channel kept as is.
- The live build uses the same HTML/JS with `mode: 'live'`. **Seed data never ships to live tenants.** `seed.js` loads only in demo mode (a dynamic script tag in `index.html` based on config).
- A "Try the demo" button on the live sign-in page links to the demo site. Demo data can never reach the live database, because there is no code path from the demo driver to the API.
- The tests keep running the pure rules against the seed. New RLS and API tests run against a local Supabase loaded with the same seed (converted by the importer in §5.6).

### 5.5 Offline check-in

- The outbox moves from localStorage to IndexedDB. Each item holds the payload, the photo blob, the device time and an idempotency key. `sw.js` keeps the app shell offline as today.
- On reconnect the outbox uploads the selfie (signed upload URL), then calls `checkin.record` with `offline: true`. The server keeps both `device_time` and `server_time`, re-runs the `js/checkin-rules.js` heuristics, and flags gaps beyond a threshold for HR review.

### 5.6 Importing demo data (pilot customers)

`tools/import-state.ts` reads an exported `state` JSON (add "Export my data" to the demo's Settings → Data). It maps legacy IDs to UUIDs, uploads data-URL files to storage, converts `chain` arrays to `approval_steps`, and inserts everything in one transaction per tenant. It is idempotent on `legacy_id`.

---

## 6. File storage, retention and PDPA

### 6.1 Buckets

All buckets are private. Access is through signed URLs (60 seconds for viewing, 5 minutes for upload), issued by RPCs that apply the same rules as the owning row.

| Bucket | Contents | Max size / types | Retention (proposed **⚠ verify with counsel**) |
|---|---|---|---|
| `selfies` | Check-in selfies (`checkin_events.selfie_object`) | 300 KB, JPEG/WebP; EXIF stripped on upload | **30 days**, then the object is deleted and the reference nulled by the nightly job. Flagged check-ins under open review are kept until the review closes, then 30 days. |
| `face-references` | Reference photo per employee (biometric) | 300 KB | While employed and consent stands. Deleted within 30 days of consent withdrawal or the end of employment. The descriptor is deleted at the same time. |
| `leave-docs` | MCs and other leave documents | 2 MB, JPEG/PNG/PDF | Employment + 7 years (aligned with payroll records). |
| `receipts` | Claim and tax-relief receipts | 2 MB | 7 years from the claim's payroll month (Income Tax Act record-keeping **⚠ verify**). Personal relief receipts are kept until the user deletes them. |
| `employee-docs` | Contracts, certificates, permits, letters | 5 MB | Employment + 7 years. |
| `statutory` | Generated KWSP/PERKESO/CP39/HRD files, EA, Form E, payslip PDFs | — | 7 years. |
| `einvoice` | Submitted JSON, validation results | — | 7 years. |
| `recruitment` | CVs (future), offer letters | 5 MB | Unsuccessful candidates: 12 months, unless they consented to longer. Hired candidates move to employee-docs. |
| `announcements` | Attachments | 5 MB | Until deleted. |
| `exports` | Data exports, DSAR packages, backups manifests | — | 7 days. |

Every upload goes through: type sniffing (the declared type must match the bytes), a size limit, image re-encoding (which strips EXIF and GPS), PDF virus scanning in the worker (ClamAV), and then the object is marked `clean` in a `files` table. Unscanned files cannot be downloaded.

### 6.2 PDPA consent and data-subject records

The PDPA amendments of 2024 brought in breach notification, a data protection officer requirement, data portability, biometric data as sensitive data, and changed cross-border transfer rules **⚠ verify current text and commencement dates**. Design for all of these now:

| Table | Purpose |
|---|---|
| `privacy_notices` | tenant_id, purpose, version, language (EN/BM), body, published_at |
| `consents` | tenant_id, subject_type (`employee`/`candidate`/`user`), subject_id, purpose (`face_check`, `careers_application`, `marketing_email`, …), notice_id + version, granted_at, withdrawn_at, method (`checkbox`/`signature`), ip, user_agent |
| `data_subject_requests` | type (`access`/`correction`/`portability`/`withdrawal`/`deletion`), subject, received_at, due_on, status, handled_by, export_object |
| `breach_register` | detected_at, description, data_types, subjects_count, contained_at, reported_to_commissioner_at, notified_subjects_at |
| `retention_policies` | tenant-overridable retention per category, within platform minimums and maximums |

- **Face check:** the consent screen in `js/app.js` (`ci-consent`) writes a `consents` row (purpose `face_check`) before enrolment. Withdrawing it deletes the reference and descriptor and turns off face matching for that person; selfies continue unless the tenant disables them.
- **Careers page:** the PDPA checkbox writes a `consents` row linked to the candidate (replacing `consentAt`).
- **DSAR export** reuses the importer's mapping in reverse: a ZIP of JSON and files, generated by the worker.
- **Cross-border transfer:** document where data lives (Supabase region, worker region, email provider, Stripe) in the tenant DPA, and keep the option of an ap-southeast-5 deployment (§2.2).

---

## 7. Server-side jobs

**Runtime:** the TypeScript worker plus a Postgres queue (`pgmq` or `pg-boss`), with schedules from `pg_cron`. Every job writes `job_runs` (name, tenant, started, finished, status, error, input hash), uses idempotency keys, retries with back-off, sends repeated failures to a dead-letter queue, and alerts on failure.

### 7.1 Payroll calculation

- `payroll.prepare(tenant, month)` gathers inputs: employees, pay changes in effect, unpaid leave, approved overtime and allowances from attendance, approved claims, zakat, and the statutory rate tables effective that month. It runs the **same** `U.payCalc` / `js/statutory.js` code as the browser and writes a `Draft` run with `rules_version` (git SHA of the rules package) and `inputs_hash`.
- The browser may preview edits instantly, but **`payroll.approve` re-runs the calculation on the server** and refuses if the result differs from what the approver saw. Approved runs are immutable; corrections are adjustment runs.
- Rates stay editable in Settings (now `statutory_rate_tables`, effective-dated) as required. A rates change applies to runs prepared after its `effective_from`.
- Golden tests: today's `tests/statutory.test.js` cases plus a fixture set of seeded payrolls must produce identical results in the browser and the worker.

### 7.2 Statutory files and documents

`statutory.generate(run, kind)` produces KWSP, PERKESO (SOCSO/EIS), CP39, HRD levy and bank files, plus EA, Form E, CP8D, CP22, CP22A and CP21. It uses the existing builders, with their `// FORMAT: verify against <official source>` comments kept and the same tests. The outputs are stored in `statutory`, checksummed and logged in `statutory_filings`. Payslip PDFs are rendered with headless Chromium from the existing printable HTML, or with a PDF library, and are cached.

### 7.3 Reminders

`reminders.daily` runs per tenant at 07:00 in the tenant's time zone (today it's the browser's `runReminders()`). It checks:

- probation, contract, passport and permit expiry
- document and insurance expiry
- training certificate expiry
- appraisal steps due
- statutory deadlines
- overdue checklist tasks
- grievance SLA breaches

It reuses `js/notify-rules.js` `reminders()` and de-duplicates through the `notifications.dedupe_key` unique index. Hourly jobs cover SLA escalations and interview reminders 24 hours before the interview.

### 7.4 Email and push

- **Email:** `email_outbox` rows are created inside the same transaction as the event (the transactional outbox pattern). The worker sends them through the provider: Amazon SES (Singapore), Postmark or Resend. Bounce and complaint webhooks update the status. SPF, DKIM and DMARC are set up on the sending domain. Templates are bilingual (EN/BM) later.
- **Push:** Web Push with VAPID through `sw.js`. Subscriptions go in a `push_subscriptions` table. `js/notify.js` `providers.push` becomes "register the subscription"; the sending happens on the server.
- In-app notifications are inserted by the same events and arrive live over Realtime.

### 7.5 MyInvois submission

- Per-tenant MyInvois client ID and secret, and for document version 1.1 the signing certificate, are stored encrypted (KMS-wrapped) and are **only ever decrypted in the worker**.
- `einvoice.submit(document)`:
  1. Build the document with `js/einvoice-rules.js`.
  2. Validate it.
  3. Sign it (v1.1).
  4. Sign in to MyInvois with OAuth 2.0 client credentials (tokens cached).
  5. `POST documentsubmissions`.
  6. Store `submissionUid`.
  7. Poll until Valid or Invalid.
  8. Store `uuid`, `longId`, the validation link and any errors.

  These are the steps already written up in `js/myinvois.js` **⚠ verify each endpoint and limit against the LHDN SDK**.
- `einvoice.cancel` runs within the 72-hour window (`canCancel` stays the rule). The job respects API rate limits with a per-tenant token bucket, and replaces the demo's `AllurusMyInvois.transport`.
- Allurus's own subscription invoices to tenants also go through this pipeline (§9).

### 7.6 Other scheduled jobs

| Job | Schedule | What it does |
|---|---|---|
| `retention.selfies` | Nightly | Delete selfies older than 30 days (not under review). |
| `retention.general` | Weekly | Apply `retention_policies`: candidates, exports, leavers' biometric data. |
| `mrr.snapshot` | Monthly | Write `mrr_snapshots`. |
| `seats.sync` | Nightly and on change | Sync active employee counts to Stripe quantities. |
| `backup.verify` | Weekly | Restore the latest backup to a scratch database and run checks. |
| `audit.export` | Daily | Copy the day's audit log to immutable storage. |
| `tenant.health` | Daily | Last active date, failed jobs, storage usage, for the Super Admin. |

---

## 8. Security

### 8.1 Encryption

- **In transit:** TLS 1.2+ everywhere, HSTS, and certificate pinning not needed. The site sets a strict Content-Security-Policy (`default-src 'self'`, script sources limited to self plus the Supabase domain, no `unsafe-eval`). The app already uses `data-act` delegation rather than inline handlers, which makes this feasible.
- **At rest:** managed Postgres and storage disks are AES-256 encrypted by the provider.
- **Application level:** columns holding IC, passport, permit, EPF, SOCSO, tax and bank numbers, plus face descriptors and MyInvois secrets, use **envelope encryption**. Each tenant has a data key (AES-256-GCM), wrapped by a master key in a KMS (AWS KMS or Google Cloud KMS), and decryption happens only in RPCs or the worker. Deleting a tenant's data key crypto-shreds all its encrypted fields, including in backups.
- Secrets live in the platform's secret store, never in the repo. Only the anon key is public, and it is safe by design because RLS applies.

### 8.2 Audit log

- `audit_log`: id, tenant_id, at, actor_user_id, actor_role, via (`ui`/`api`/`worker`/`support`), action, table_name, row_id, before jsonb, after jsonb (sensitive fields redacted to "changed"), ip, user_agent, request_id.
- It is written by generic triggers on all tenant tables plus explicit entries for sensitive reads (§4.3), sign-ins, exports, reveals and support access. It is append-only: no UPDATE or DELETE grants, and a hash chain (each row stores a hash of the previous one) makes tampering evident.
- Admins see their tenant's log under Settings → Audit (searchable and exportable). The existing `attAudit` and finance report trails become filtered views of it.

### 8.3 Backups and disaster recovery

| Target | Value |
|---|---|
| RPO (data loss tolerated) | ≤ 5 minutes (PITR) |
| RTO (time to restore service) | ≤ 4 hours |

- Managed PITR, plus a daily logical dump (`pg_dump`, encrypted) copied to a separate cloud account and region. Storage objects are replicated nightly to that account.
- Quarterly restore drill, recorded with timings. A runbook covers losing the region, a corrupted tenant (point-in-time restore of one tenant via logical replay into a scratch database, then copying rows back), leaked keys, and a provider outage.
- Status page and incident communication templates. PDPA breach notification steps are linked to `breach_register`.

### 8.4 Application security

- Dependencies are kept minimal (vendored, licences recorded) and scanned with Dependabot and `npm audit` for the worker.
- RLS policy tests run in CI. A test asserts that every table has RLS enabled and forced.
- Rate limits on sign-in, magic-link requests, the careers page and exports.
- External penetration test before general availability, then yearly.
- Admin MFA is required. Login alerts are sent for new devices.
- Logging and monitoring: Sentry for front-end and worker errors (PII scrubbed), structured logs with request IDs, and alerts on authentication anomalies and job failures.

### 8.5 Path to ISO 27001 and SOC 2

| When | Step |
|---|---|
| Phase 0–1 | Name a security owner and a DPO. Write a risk register, an asset inventory, an access control policy, a secure development policy and an incident response plan. Run quarterly access reviews. Keep a vendor register (Supabase, worker host, email, Stripe) with their SOC 2 / ISO reports. |
| Before GA | Penetration test, backup drill evidence, a security awareness training record, and published security and privacy pages. |
| GA + 0–3 months | Adopt a compliance automation tool (Vanta, Drata or Secureframe) to collect evidence continuously. |
| GA + 3–6 months | **SOC 2 Type I** (point in time), useful for regional enterprise buyers. |
| GA + 6–12 months | **SOC 2 Type II** (3–6 month observation window) and/or an **ISO 27001** certification audit (Stage 1 + Stage 2) by an accredited body. Malaysian enterprises and GLCs often ask for ISO 27001 specifically. |

The controls above (MFA, RLS, encryption, audit log, backups, change management through PRs and CI, vendor reviews) are the evidence these audits ask for, so most of the cost is documentation and the observation period.

---

## 9. Billing with Stripe (Super Admin plans)

Stripe supports Malaysian businesses, including card payments and FPX **⚠ verify current payment methods and fees**.

- **Products and prices:** one product per plan in `plans` (Starter, Growth, etc.), with a per-seat recurring price in monthly and annual variants. The demo prices plans in USD; decide on MYR pricing for Malaysian customers. `plans.stripe_price_id` links them.
- **Seats** are the subscription `quantity` and follow active employees (`seats.sync`), with proration. Options are true-up monthly or block seats; decide this as a product question.
- **Sign-up:** `rpc_register_company` creates the Stripe customer and a trial subscription (no card at first, or card required, again a product decision). Stripe Checkout collects the payment method, and the **Customer Portal** lets the tenant admin update cards, download invoices and change plans.
- **Webhooks** (to the worker, signature-verified, idempotent on `event.id`):

  | Webhook | Updates |
  |---|---|
  | `customer.subscription.*` | `subscriptions` |
  | `invoice.paid` / `invoice.payment_failed` | `platform_invoices` and tenant status (`Active` / `Past due`) |
  | `customer.subscription.deleted` | `Cancelled` |

- **Dunning:** retries by Stripe Smart Retries. In-app banners while `Past due`. After N days, `Suspended`: read-only access with exports still allowed, never silent deletion. Data is deleted after the contractual period, with notice.
- **Tax and e-Invoice:** Allurus must charge and report SST where applicable **⚠ verify SST registration and rate for SaaS with a tax adviser**. Stripe invoices are not MyInvois e-Invoices, so on `invoice.paid` the worker builds an e-Invoice for the tenant (buyer = tenant's TIN from `tenant_settings['einvoice']`) and submits it through §7.5.
- **The Super Admin console** reads `tenants`, `subscriptions`, `platform_invoices` and `mrr_snapshots`. MRR comes from Stripe data, replacing the seeded numbers.

---

## 10. Phased migration plan and estimates

**Assumptions:** 2 full-stack developers (JS/TS + SQL) full time, plus a part-time designer/QA (~0.3 FTE) and a part-time compliance owner. Estimates are in **developer-weeks**, with a likely range. Add 15–20% contingency for the parts with outside dependencies (LHDN sandbox access, SSO customers, auditors).

| Phase | Scope | Exit criteria | Dev-weeks |
|---|---|---|---|
| **0. Foundations** | Supabase projects (dev/stage/prod), migrations repo, CI with pgTAP, worker skeleton and queue, `js/config.js`, `js/store/` with the demo driver (no behaviour change), rules packaged for browser and Node, Sentry. **Remove password hashes from seed (§4.5).** | Demo works unchanged. CI runs JS tests and RLS tests. | 4–6 |
| **1. Identity and tenancy** | Auth (password, magic link, MFA for admins), memberships, tenant switch, invitations, company registration, employees, departments, settings, sensitive-field encryption, audit log triggers | A real tenant can sign in, invite staff and edit employees. Cross-tenant tests pass. | 6–8 |
| **2. Time** | Check-in with signed selfie uploads, server time, offline outbox in IndexedDB, kiosk device tokens, face enrolment with consent records, attendance review, rosters, time requests, leave with `approval_steps`, holidays, selfie retention job | A pilot company runs attendance and leave for a month. | 7–9 |
| **3. Money** | Claims (receipts to storage), payroll prepare/approve on the worker, statutory files, payslip PDFs, bank file, finance ledger, invoices and bills, auditor verification locks | Parallel run: one pilot payroll matches the browser calculation to the sen for 2 consecutive months. | 8–11 |
| **4. Notifications and jobs** | Email provider, outbox, bounce handling, Web Push, daily reminders, SLA escalations, job monitoring | No reminder runs in the browser in live mode. | 3–4 |
| **5. Talent and HR admin** | Appraisals, goals, onboarding, assets, loans, letters, documents, announcements, recruitment with the public careers endpoint, training with server-scored quizzes, grievances with reveal logging, meeting rooms with the exclusion constraint, reports and costing | Every route works in live mode. | 8–10 |
| **6. e-Invoice live** | MyInvois credentials vault, signing, submit, poll, cancel, rate limits, LHDN sandbox certification run | Sandbox submissions validate. Production switch is per tenant. | 3–5 |
| **7. Billing** | Stripe products, checkout, portal, webhooks, seat sync, dunning, Super Admin console on real data, e-Invoice for Allurus's own invoices | A test-mode tenant goes trial → paid → past due → recovered. | 3–4 |
| **8. Hardening and launch** | Penetration test and fixes, DR drill, DSAR tooling, privacy notices (EN/BM), retention jobs, status page, data import tool for demo users, load test (500 staff × 22 workdays of check-ins in one month) | Go-live checklist signed off. | 4–6 |
| **Total** | | | **46–63 dev-weeks** |

**Calendar time** with 2 developers is about 6–8 months to general availability, and 4.5–6 months with 3 developers. Phases 4 and 6 can run in parallel with 3 and 5.

**Suggested pilot:** after Phase 2, run one friendly company on live attendance and leave while payroll stays on its current system. Start a parallel payroll run in Phase 3 before switching payroll.

### Decisions needed from you

1. Approve **Supabase + TypeScript worker** (option A), or ask for Malaysian residency from day one (option B on AWS ap-southeast-5).
2. Approve vendoring **supabase-js** into `js/vendor/` (MIT licence), and choose an email provider.
3. Pricing: MYR or USD, per-seat true-up rules, and whether a card is required for the trial.
4. Retention periods in §6.1, to be confirmed with Malaysian employment and data-protection counsel.
5. Whether admins may see salaries of other admins (a likely request for an HR officer role).

---

## Appendix A: what stays exactly as it is

- No build step for the front end: plain HTML, CSS and JS, `index.html` as the shell, views reading `state`, `data-act` actions.
- The no-DOM rules modules and their `node --test` tests (they gain a second runtime, they don't change).
- `// FORMAT: verify against <official source>` comments on every government file format, and statutory rates editable in Settings.
- Demo mode on GitHub Pages and the claude.ai artifact.

## Appendix B: risks

| Risk | Mitigation |
|---|---|
| RLS mistakes leak data between tenants | Policy tests per table and role in CI, a test that RLS is enabled on every table, a security review of every migration, and a penetration test. |
| Browser and server payroll results drift | One shared rules package, golden-file tests, server recompute on approve, `rules_version` stored on runs. |
| Large tenants make `bootstrap()` slow | Windowed loading, pagination, server-side reports for long ranges, indexes on `(tenant_id, day)` and similar. |
| LHDN API changes or sandbox delays | Keep the transport isolated, keep simulation in demo, and track SDK release notes. |
| Vendor outage (Supabase) | Status monitoring, offline check-in outbox, DR runbook, portable SQL. |
| Biometric data under PDPA | Explicit consent records, on-device matching kept, encrypted descriptors, short retention, and the option to run without face check. |

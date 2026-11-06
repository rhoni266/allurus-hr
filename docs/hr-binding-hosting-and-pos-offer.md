# Binding the POS to Allurus HR: database, hosting and the website offer

Status: **plan, nothing built yet.** Written 6 November 2026 against `rhoni266/allurus-hr` `main` at `c651945` and this branch (`allurus-pos`).

This covers three things you asked for:

1. bind the POS to the allurus-hr database;
2. host it with allurus-hr;
3. change the allurus.my website to offer the POS.

One decision has to come first (§1), because allurus-hr already has POS work of its own.

---

## 1. First decision: there are three POS projects

| | **A. Laravel POS** (this branch, `allurus-pos`) | **B. In-app POS** (allurus-hr `main`: `js/pos.js`, `functions/pos-core.js`) | **C. Cafe POS trial** (allurus-hr `main`: `pos/`) |
|---|---|---|---|
| Runs on | Laravel 13 + PostgreSQL 17 (row-level security) | Inside the HR app; Firestore `tenants/{t}/pos_*` + 3 Cloud Functions | One Google Sheet + Apps Script |
| Offline | Yes: offline-first tills with an outbox, chaos-tested (20 simulator scenarios) | Local demo only; "POS is not synced to the cloud yet" (`docs/pos.md`) | No |
| Built | Sync engine, pricing engine with golden vectors, devices and PIN sign-in, voids/refunds/stocktake, kitchen tickets, KDS, print nodes, delivery platforms, dashboard, web till; 313 tests | Till, tables, kitchen display, shifts, menu, reports (Banafsha Café demo); server-side payments, void/refund, shifts | Till, today's sales, products, waste, inventory ledger |
| Tied into HR | Not yet (this plan) | Yes: HR users and roles, Operations stock, Finance entries | No |

**Recommendation:** make **A** the POS product and the engine every till talks to. Keep HR as the system of record for companies, people, billing and the books, and connect the two as in §2.

- Retire **C** once A is hosted. It was a trial.
- **B** has the HR integration and a polished in-app till, but no cloud sync and no offline story. Either:
  - retire it, and carry its good ideas (tables, shifts, Finance entries, the MyInvois checklist in `docs/pos.md`) into A; or
  - keep it as the demo only.

  Running two live POS engines would mean two pricing engines, two sets of money rules and two places sales can be. Don't.

> **Decision 1:** A as the product, B retired or demo-only, C retired? Everything below assumes yes.

---

## 2. Binding to the allurus-hr database

### 2.1 Link the two, don't merge them

The HR "database" is Cloud Firestore (project `allurus-hr`). The POS must stay on PostgreSQL. Moving it into Firestore would throw away what the POS rules rest on:

- row-level security as the second tenant wall;
- one ACID transaction per sale;
- stock as a ledger of deltas;
- partitioned sales tables;
- the idempotent, offline-first sync design.

So **"bind" means each system owns its own data, and they are joined by IDs and a small set of one-way feeds:**

| Data | Owner | Direction | How |
|---|---|---|---|
| Company (tenant), plan, subscription status | HR | HR → POS | POS `tenants.hr_tenant_id` = HR `tenants/{t}` id. HR billing status (`effectiveStatus`) is copied to the POS tenant. |
| Outlets | HR (Operations / Settings) | HR → POS | POS `outlets.hr_outlet_id` |
| People who use the till | HR employees | HR → POS | POS `staff.hr_emp_id`. Name, role, active flag. Deactivating in HR deactivates in the POS, which already revokes offline credentials through its trigger. |
| **PINs** | **POS only** | never | HR `users/{uid}.posPin` must not be copied. CLAUDE.md: never sync anything PIN-derived. Staff set their PIN on the till. |
| Menu, prices, tax codes | POS | none (POS back office) | Later, if wanted, HR Operations items → POS products. |
| Stock at outlets | POS (`stock_movements`) | POS → HR, summary | Daily on-hand per outlet into HR Operations, read-only. One owner per stock item, never two. |
| Sales | POS | POS → HR | A daily sales summary per outlet posts to HR Finance (`finance.txns`, `source: 'pos'`): sales by tax code, SST, rounding, payment method, voids/refunds. Totals only. |
| Back-office sign-in | HR (Firebase Auth) | HR → POS | §2.3 |

### 2.2 How the feeds work

**HR → POS: provisioning and staff**

- A Cloud Function in allurus-hr calls new **server-to-server** endpoints on the POS:
  - `POST /api/v1/hq/tenants` (create or update a company and its outlets);
  - `POST /api/v1/hq/staff` (upsert or deactivate employees);
  - `POST /api/v1/hq/tenants/{id}/status`.
- Each call is signed with HMAC over the raw body plus a timestamp: the same pattern as the delivery webhooks, verified on the raw body and deduplicated by event id.
- **The tenant comes from the signed body's `hr_tenant_id` mapped on the server, never from a header** (rule 2).
- Triggers:
  - a company enables the POS add-on;
  - an employee is created, changed or deactivated;
  - billing status changes.
- A nightly full reconcile catches anything a trigger missed.

**POS → HR: sales and stock summaries**

- A scheduled job in the POS posts the day's summary per outlet once the outlet's day closes, to an HR callable function `posDailySummary` (or written with a Firebase service account).
- It is idempotent on `(hr_tenant_id, outlet, business date)`.
- A day that was already posted and then changes (a late offline sale, a refund) is posted as a **correction entry**, never an edit. This matches rule 4 and the HR auditor lock: verified months are locked in HR.

**Subscription status**

- Suspended or expired in HR means the POS refuses new pairings and new staff sign-ins.
- **Sales already rung up offline are still accepted when they sync** (rules 4 and 6: never refuse a completed sale). HR B's `canTrade` blocks new orders in the cloud. A's tills can only enforce that while online.

### 2.3 One sign-in for owners and managers

Today the POS dashboard is a signed link from the CLI (no HQ users). Replace it with HR's Firebase Auth:

- The HR app opens `pos.allurus.my/hq` with a Firebase **ID token**.
- Laravel verifies the token: Google's public keys, audience `allurus-hr`, not expired, email verified. It then looks up the HR user's tenant and roles from Firestore with the Admin SDK and starts a POS back-office session.
- Owner and Admin manager get the full POS back office; Finance gets sales reports; others get nothing.
- Till staff still sign in on the till by PIN (devices and PINs stay POS-side).

### 2.4 POS changes for the binding

- **Migration:**
  - `tenants.hr_tenant_id` (unique); `outlets.hr_outlet_id`; `staff.hr_emp_id`;
  - an `hq_events` table (event id, received, applied) for dedupe;
  - an `hr_postings` table (tenant, outlet, business date, version, posted at).
- `app/Hq/`: HMAC verification, `TenantProvisioner`, `StaffSync`, `DailySummary`, `FirebaseIdToken`.
- Tests:
  - signature (bad, replayed, stale);
  - tenant isolation;
  - a deactivated employee is revoked;
  - a late sale gives a correction, not an edit;
  - an ID token from another project is refused.
- A simulator scenario where HR events and till sales interleave under chaos.

**allurus-hr changes** (on a branch, see §4.1):
- functions `posProvision`, `posStaffSync` and `posDailySummary`;
- a "POS" switch in company settings;
- Firestore rules for the summary entries.

---

## 3. Hosting with allurus-hr

### 3.1 What Firebase Hosting can and can't do here

allurus-hr is static files on **Firebase Hosting** (site `allurus-enterprise`, domain allurus.my) plus Cloud Functions.

**Firebase Hosting cannot run PHP**, so the POS needs a server. The cleanest place is the **same Google Cloud project (`allurus-hr`)**: one bill, one console, one set of service accounts, and Functions ↔ POS calls stay inside Google.

| Piece | Service | Notes |
|---|---|---|
| Laravel API, till, back office | **Cloud Run** service `allurus-pos` | Container built from this repo. Min instances ≥ 1 so tills don't wait for a cold start. |
| Database | **Cloud SQL for PostgreSQL 17** | Private IP. App connects as `allurus_app` (`NOBYPASSRLS`). Migrations run as the owner role. Automated backups and point-in-time recovery on. |
| Queue + scheduler | A second Cloud Run service (or a small VM) running `queue:work` and `schedule:work` | `delivery:tick` runs **every 15 s**. Cloud Scheduler's minimum is 1 minute, so it can't drive it alone. |
| Kitchen doorbell (Reverb WebSockets) | Its own Cloud Run service, or a hosted Pusher-compatible service | Devices already fall back to pulling, so the doorbell may come later. |
| Cache / locks | Database driver first; Memorystore Redis later if needed | |
| Secrets | **Secret Manager** | APP_KEY, DB password, HMAC secret, Play Integrity key, delivery secrets. |
| Domain | **`pos.allurus.my`** → Cloud Run | See 3.2. |
| Region | `asia-southeast1` (Singapore), or a Malaysia region if your project has one | Check data-residency expectations with customers. |

### 3.2 Use a subdomain, not `allurus.my/pos`

A Firebase Hosting rewrite to Cloud Run would put the POS under `allurus.my/pos`. That route has known limits:

- Hosting forwards only the `__session` cookie;
- requests time out after 60 seconds;
- no WebSockets;
- Laravel would need a path prefix.

Tablets and print nodes need none of that friction. So:

- `pos.allurus.my` → Cloud Run directly (Cloud Run domain mapping or a load balancer with a managed certificate);
- the website and HR app link to it.

Also: `allurus.my/pos/**` is currently in Hosting's `ignore` list because of the Sheets trial (C), so nothing collides.

### 3.3 Before go-live

- `POS_ATTESTATION_REQUIRED=true` (default).
- iOS can't pair until the App Attest verifier exists.
- Play Integrity with real credentials.
- `POS_WEB_TILL_ENABLED=false` and `POS_DASHBOARD_ENABLED=false` in production (the defaults when `APP_ENV=production`). The real back office is §2.3.
- `FixtureProvider` must not be registered.
- Confirm SST rates with RMCD (rule 8).
- Load test sync push. Run the full `sim:run` against a staging copy.

### 3.4 Cost

Cloud SQL, two always-on Cloud Run services and egress make this a monthly cost. allurus-hr is already on the pay-as-you-go plan (it deploys Cloud Functions).

I haven't priced it. Size a small Cloud SQL instance and two minimum-1 Cloud Run services in the Google Cloud pricing calculator for your region before committing.

### 3.5 Deploy

- A `Dockerfile` (PHP 8.4 FPM + nginx, or FrankenPHP).
- A GitHub Actions workflow on `allurus-pos`:
  1. tests;
  2. build;
  3. push to Artifact Registry;
  4. deploy to a **staging** Cloud Run service;
  5. migrate;
  6. promote to production by hand.
- A staging Cloud SQL database for `sim:run`.

---

## 4. The website: offering the POS on allurus.my

### 4.1 Where the change goes

The website is allurus-hr `main` (`index.html`, `site/js/config/site.js`, `site/js/i18n.js`). **So far I've been told never to touch `main` of allurus-hr.** So:

- this change goes on a branch (`claude/pos-offer`) as a pull request for you to review and merge;
- nothing is pushed to `main`.

> **Decision 2:** OK to open that PR on allurus-hr?

### 4.2 Be honest about status

The site promises: *"Everything marked Live works today in our demo."* So until A is hosted (§3) the POS is **"rolling"**, not "live".

### 4.3 Changes

1. **`site/js/config/site.js`**
   - Add a module to `MODULES`:
     ```js
     { id: "pos", status: "rolling", connects: ["operations", "finance", "hr"],
       shots: [["13-pos-till", "shot_pos_till"], ["14-pos-kitchen", "shot_pos_kds"], ["15-pos-dashboard", "shot_pos_dash"]],
       careful: ["care_pos_offline", "care_pos_card", "care_pos_tax"] },
     ```
   - Add `"road_pos"` to `ROADMAP.rolling`.
   - The F&B and Retail industry packs already list POS bullets (`ind_fnb_1`, `ind_retail_1`). Add `"pos"` to their `uses` once it is live.
2. **`site/js/i18n.js`**: English and Bahasa Melayu keys (draft copy in 4.4).
3. **Screenshots** `site/assets/shots/13…15`: from the web till, a KDS and the dashboard, using made-up demo data like the existing shots.
4. **Nav / hero:** the "Modules" tab gets a POS tab automatically from `MODULES`. Optionally, a hero tile "Point of sale" linking to `#modules`.
5. **Pricing:** the site shows "Pricing & contact" without figures. If you want a POS price on the site (e.g. per outlet per month, plus per extra till or KDS), **give me the numbers**. I won't make them up. Otherwise the POS goes through the existing "Book a demo" form.
6. **SEO:** add "point of sale" to the JSON-LD `description` once live.

### 4.4 Draft copy

English:

- **Module name:** Point of sale
- **Lead:** A till that keeps selling when the internet drops, and puts every sale straight into your stock and your books.
- **Points:**
  - Works offline: sales are saved on the tablet and sync when the connection is back, never lost or doubled.
  - Kitchen tickets on a screen or a kitchen printer; mark orders preparing, ready and done.
  - GrabFood, foodpanda and ShopeeFood orders in the same queue. Accept them automatically when the kitchen is ready, or by hand.
  - Staff sign in with a PIN. Voids, refunds and stock counts by the wrong person are flagged for you, not blocked.
  - SST worked out per item, with 5-sen cash rounding; each day's sales go into Finance.
  - Owners see sales, kitchen times, delivery orders and every till's status in one dashboard.
- **Good to know:**
  - `care_pos_offline`: Offline, the till takes cash only; e-wallets and online banking need a connection.
  - `care_pos_card`: Card payments go through your bank's card terminal for now; tap-on-phone is planned.
  - `care_pos_tax`: Tax rates are set per company; confirm your SST registration and rates with RMCD.
- **Roadmap item** `road_pos`: Point of sale with kitchen display and delivery platforms.

Bahasa Melayu (draft; **please have a native speaker check before publishing**):

- **Nama modul:** Sistem jualan (POS)
- **Ringkasan:** Kaunter jualan yang terus berfungsi walaupun internet terputus, dan setiap jualan terus masuk ke stok dan akaun anda.
- **Perkara utama:**
  - Berfungsi tanpa internet: jualan disimpan di tablet dan diselaraskan apabila sambungan kembali, tidak hilang atau berganda.
  - Tiket dapur pada skrin atau pencetak dapur; tandakan pesanan sedang disediakan, siap dan selesai.
  - Pesanan GrabFood, foodpanda dan ShopeeFood dalam barisan yang sama, diterima secara automatik apabila dapur bersedia, atau secara manual.
  - Kakitangan log masuk dengan PIN. Pembatalan, bayaran balik dan kiraan stok oleh orang yang salah ditandakan untuk semakan anda, bukan disekat.
  - SST dikira bagi setiap item, dengan pembundaran tunai 5 sen; jualan harian terus ke modul Kewangan.
  - Pemilik melihat jualan, masa dapur, pesanan penghantaran dan status setiap kaunter dalam satu papan pemuka.
- **Perlu diketahui:**
  - Tanpa internet, kaunter hanya menerima tunai; e-dompet dan perbankan dalam talian memerlukan sambungan.
  - Bayaran kad melalui terminal kad bank anda buat masa ini; bayaran sentuh pada telefon dirancang.
  - Kadar cukai ditetapkan bagi setiap syarikat; sahkan pendaftaran dan kadar SST anda dengan JKDM.
- **Pelan hala tuju:** Sistem jualan dengan paparan dapur dan platform penghantaran.

**Check before publishing:**
- **Delivery platforms:** naming GrabFood, foodpanda and ShopeeFood is only true once real adapters exist. Today only a test provider does (`docs/delivery-integration.md`). Until then use "delivery platforms (coming)".
- **Tap-on-phone:** "tap-on-phone is planned" is only true if it is on your roadmap.

---

## 5. Order of work

1. You decide 1 and 2, and give prices (§4.3.5) if you want them shown.
2. **Website PR** (small, independent): the POS module as "rolling", copy, screenshots. It can merge before anything is hosted.
3. **Hosting, staging first:**
   - Dockerfile and GitHub Actions;
   - Cloud SQL and Cloud Run in `allurus-hr`;
   - `pos.allurus.my` on staging, then production.
4. **Binding, POS side:** the HQ endpoints, mapping columns, Firebase ID-token sign-in and daily summary, with tests and a simulator scenario.
5. **Binding, HR side:** the provisioning and staff-sync functions, the POS switch in settings, and Finance posting from the daily summary.
6. **Go-live:** a pilot outlet. The module goes from "rolling" to "live" on the website, and `pos` is added to the F&B and Retail packs' `uses`.
7. Retire the Sheets trial (C). Retire B or freeze it as the demo.

## 6. Decisions and inputs needed

| # | Question | Default if you say nothing |
|---|---|---|
| 1 | A as the POS product; B retired or demo-only; C retired? | A, B demo-only, C retired |
| 2 | May I open a website PR on allurus-hr (not push to `main`)? | No PR until you say yes |
| 3 | `pos.allurus.my`, or a path under allurus.my? | `pos.allurus.my` |
| 4 | Region | `asia-southeast1` |
| 5 | POS prices to publish? | None; "Book a demo" |
| 6 | Who owns outlet stock: POS or HR Operations? | POS; HR gets a read-only summary |
| 7 | Business-day close time per outlet (for the daily Finance posting) | 04:00 local |

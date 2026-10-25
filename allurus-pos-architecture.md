# Allurus POS: Architecture & Implementation Steps

> **Note (added when this doc was committed):** this is the original design. Where the code deliberately differs, the code and `CLAUDE.md` win. In particular: the change feed is written by Postgres triggers, not the `Syncable` model hooks in §5.2; pull cursors rely on a per-tenant advisory lock and a prune watermark; push returns `retry` (not `rejected`) for transient or server-side errors; and timestamps are stored with microseconds and offset. See "Learned the hard way" in `CLAUDE.md`.

Multi-tenant, offline-first, omnichannel POS for the Malaysian market.
Stack: Laravel (API/back-office) · Vue/React SPA · Flutter/React Native terminal with SQLite · PostgreSQL · Redis.

---

## 1. High-Level Architecture

```
                   ┌─────────────────────────────┐
                   │  HQ Dashboard (Vue/React)   │
                   └──────────────┬──────────────┘
                                  │ REST (Sanctum, tenant-scoped)
┌──────────────────┐   HTTPS   ┌──▼───────────────────────────┐   ┌──────────────┐
│ POS Terminal     │◄─────────►│ Laravel API                  │◄─►│ PostgreSQL   │
│ SQLite (local)   │  /sync/*  │  - Tenant middleware + scope │   │ (RLS)        │
│ outbox + cursor  │           │  - Sync engine               │   └──────────────┘
└──────────────────┘           │  - Payment webhooks          │   ┌──────────────┐
┌──────────────────┐           │  - Horizon queues            │◄─►│ Redis        │
│ KDS / QR ordering│◄─────────►│  - Reverb (websockets)       │   └──────────────┘
└──────────────────┘           └──────────────────────────────┘
```

### Tenancy model (avoid bloat)

- **Default: single database, `tenant_id` on every row + PostgreSQL Row-Level Security.** Cheapest to run, simple migrations, and one schema to evolve across thousands of merchants.
- **Enterprise upgrade path: schema-per-tenant or dedicated DB** for large franchises that need isolation (route via `tenants.database_mode`).
- **Hierarchy:** `tenants` (merchant/brand) → `outlets` (branches/franchisees) → `terminals` (devices).
- **Bloat control:**
  - Partition `orders`, `order_items`, `payments`, `stock_movements` by month (`PARTITION BY RANGE (created_at)`).
  - Keep product catalogue lean: one `products` row per sellable concept, variants in `product_variants`, regional prices in `price_overrides`.
  - Use JSONB only for truly variable attributes (modifiers snapshot, gateway payloads).
  - Archive partitions older than 24 months to cold storage; keep aggregates in `daily_sales_summaries`.

### Key design rules

1. **All IDs are UUIDv7** (time-ordered). Terminals generate IDs offline, so there are no collisions and no server round-trip.
2. **Money is stored as integer sen** (`bigint`), never float.
3. **Orders are append-mostly.** Corrections are new rows (refund/void), not edits, which makes sync conflict-free for sales data.
4. **Server is the source of truth for catalogue/prices/permissions. The terminal is the source of truth for sales it created.**

---

## 2. Database Schema (Laravel Migrations)

### 2.1 Tenants, outlets, terminals

```php
// 2026_01_01_000001_create_tenancy_tables.php
Schema::create('tenants', function (Blueprint $t) {
    $t->uuid('id')->primary();
    $t->string('name');
    $t->string('slug')->unique();
    $t->string('business_type');               // retail | fnb | service | hybrid
    $t->string('database_mode')->default('shared'); // shared | schema | dedicated
    $t->string('sst_registration_no')->nullable();
    $t->string('tin')->nullable();             // for MyInvois e-invoicing
    $t->string('currency', 3)->default('MYR');
    $t->jsonb('settings')->default('{}');
    $t->timestampsTz();
    $t->softDeletesTz();
});

Schema::create('outlets', function (Blueprint $t) {
    $t->uuid('id')->primary();
    $t->uuid('tenant_id')->index();
    $t->uuid('parent_outlet_id')->nullable();  // franchise grouping
    $t->string('name');
    $t->string('region_code')->nullable();     // drives regional pricing
    $t->boolean('sst_applicable')->default(true);
    $t->jsonb('settings')->default('{}');
    $t->timestampsTz();
    $t->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
});

Schema::create('terminals', function (Blueprint $t) {
    $t->uuid('id')->primary();
    $t->uuid('tenant_id')->index();
    $t->uuid('outlet_id')->index();
    $t->string('name');
    $t->string('device_fingerprint')->unique();
    $t->unsignedBigInteger('last_pull_cursor')->default(0);
    $t->timestampTz('last_seen_at')->nullable();
    $t->timestampsTz();
});
```

### 2.2 Products (matrix inventory, F&B modifiers, time-based items)

```php
Schema::create('products', function (Blueprint $t) {
    $t->uuid('id')->primary();
    $t->uuid('tenant_id')->index();
    $t->uuid('category_id')->nullable()->index();
    $t->string('name');
    $t->string('type');                         // standard | combo | service_timed | modifier_only
    $t->string('tax_code')->default('SST_SALES'); // SST_SALES | SST_SERVICE | EXEMPT
    $t->boolean('has_variants')->default(false);
    $t->boolean('track_stock')->default(true);
    $t->string('kds_station')->nullable();      // kitchen | bar | dessert
    $t->jsonb('time_billing')->nullable();      // {unit:"minute", rate_sen:1500, min_minutes:30, rounding:"up_15"}
    $t->unsignedBigInteger('row_version')->default(1); // monotonically bumped on change
    $t->timestampsTz();
    $t->softDeletesTz();
});

Schema::create('product_variants', function (Blueprint $t) {  // size/colour matrix
    $t->uuid('id')->primary();
    $t->uuid('tenant_id')->index();
    $t->uuid('product_id')->index();
    $t->string('sku')->index();
    $t->string('barcode')->nullable()->index();
    $t->jsonb('options');                        // {"size":"M","color":"Navy"}
    $t->bigInteger('base_price_sen');
    $t->bigInteger('cost_sen')->default(0);
    $t->unsignedBigInteger('row_version')->default(1);
    $t->timestampsTz();
    $t->unique(['tenant_id', 'sku']);
});

Schema::create('price_overrides', function (Blueprint $t) {   // regional / outlet pricing
    $t->uuid('id')->primary();
    $t->uuid('tenant_id')->index();
    $t->uuid('variant_id')->index();
    $t->string('scope');                         // region | outlet
    $t->string('scope_key');                     // region_code or outlet uuid
    $t->bigInteger('price_sen');
    $t->timestampTz('valid_from')->nullable();
    $t->timestampTz('valid_to')->nullable();
    $t->unsignedBigInteger('row_version')->default(1);
    $t->timestampsTz();
});

Schema::create('modifier_groups', function (Blueprint $t) {
    $t->uuid('id')->primary();
    $t->uuid('tenant_id')->index();
    $t->string('name');
    $t->unsignedSmallInteger('min_select')->default(0);
    $t->unsignedSmallInteger('max_select')->default(1);
    $t->timestampsTz();
});

Schema::create('modifiers', function (Blueprint $t) {
    $t->uuid('id')->primary();
    $t->uuid('tenant_id')->index();
    $t->uuid('modifier_group_id')->index();
    $t->string('name');
    $t->bigInteger('price_delta_sen')->default(0);
    $t->uuid('consumes_variant_id')->nullable();  // modifier-level inventory deduction
    $t->decimal('consumes_qty', 10, 3)->nullable();
    $t->timestampsTz();
});

Schema::create('combo_items', function (Blueprint $t) {
    $t->uuid('id')->primary();
    $t->uuid('tenant_id')->index();
    $t->uuid('combo_product_id')->index();
    $t->uuid('component_variant_id');
    $t->decimal('qty', 10, 3)->default(1);
    $t->uuid('slot_group_id')->nullable();        // "choose 1 drink"
});
```

### 2.3 Inventory

```php
Schema::create('stock_levels', function (Blueprint $t) {
    $t->uuid('tenant_id');
    $t->uuid('outlet_id');
    $t->uuid('variant_id');
    $t->decimal('on_hand', 14, 3)->default(0);    // derived cache
    $t->decimal('low_stock_threshold', 14, 3)->nullable();
    $t->primary(['outlet_id', 'variant_id']);
    $t->index('tenant_id');
});

// Ledger = source of truth; stock_levels is a projection. Partition by month.
Schema::create('stock_movements', function (Blueprint $t) {
    $t->uuid('id');
    $t->uuid('tenant_id');
    $t->uuid('outlet_id');
    $t->uuid('variant_id');
    $t->string('reason');                         // sale | refund | po_receive | adjust | transfer | waste
    $t->decimal('qty_delta', 14, 3);              // signed
    $t->uuid('ref_id')->nullable();               // order_id / po_id
    $t->timestampTz('occurred_at');
    $t->timestampTz('created_at')->useCurrent();
    $t->primary(['id', 'occurred_at']);
});

Schema::create('suppliers', function (Blueprint $t) { /* id, tenant_id, name, contact... */ });
Schema::create('purchase_orders', function (Blueprint $t) { /* id, tenant_id, outlet_id, supplier_id, status, expected_at */ });
Schema::create('purchase_order_lines', function (Blueprint $t) { /* po_id, variant_id, qty_ordered, qty_received, cost_sen */ });
```

### 2.4 Orders, payments, tables, time sessions

```php
Schema::create('orders', function (Blueprint $t) {
    $t->uuid('id');                                // generated ON THE TERMINAL
    $t->uuid('tenant_id');
    $t->uuid('outlet_id');
    $t->uuid('terminal_id');
    $t->string('receipt_no');                      // outlet-prefix + terminal-prefix + local seq: OUT1-T2-000123
    $t->string('channel');                         // pos | qr | online | grab
    $t->string('status');                          // open | paid | void | refunded
    $t->uuid('table_id')->nullable();
    $t->uuid('customer_id')->nullable();
    $t->uuid('staff_id');
    $t->bigInteger('subtotal_sen');
    $t->bigInteger('discount_sen')->default(0);
    $t->bigInteger('service_charge_sen')->default(0);
    $t->bigInteger('tax_sen')->default(0);
    $t->smallInteger('rounding_sen')->default(0); // Malaysia 5-sen rounding
    $t->bigInteger('total_sen');
    $t->jsonb('tax_breakdown')->default('[]');     // [{code:"SST_SERVICE",rate:8,base:...,amount:...}]
    $t->boolean('created_offline')->default(false);
    $t->timestampTz('occurred_at');                // device clock (client time)
    $t->timestampTz('synced_at')->nullable();      // server time
    $t->timestampTz('created_at')->useCurrent();
    $t->primary(['id', 'occurred_at']);            // partition key must be in PK
    $t->unique(['tenant_id', 'receipt_no', 'occurred_at']);
    $t->index(['tenant_id', 'outlet_id', 'occurred_at']);
});
// DB::statement('... PARTITION BY RANGE (occurred_at)') via raw SQL + pg_partman

Schema::create('order_items', function (Blueprint $t) {
    $t->uuid('id');
    $t->uuid('tenant_id');
    $t->uuid('order_id')->index();
    $t->uuid('variant_id');
    $t->string('name_snapshot');                   // freeze name/price at time of sale
    $t->decimal('qty', 10, 3);
    $t->bigInteger('unit_price_sen');              // price actually charged
    $t->bigInteger('catalog_price_sen');           // price per catalogue when sold (audit)
    $t->unsignedBigInteger('price_row_version');   // which version the terminal used
    $t->jsonb('modifiers')->default('[]');
    $t->string('kds_status')->nullable();          // new | preparing | ready | served
    $t->timestampTz('occurred_at');
    $t->primary(['id', 'occurred_at']);
});

Schema::create('payments', function (Blueprint $t) {
    $t->uuid('id');
    $t->uuid('tenant_id');
    $t->uuid('order_id')->index();
    $t->string('method');                          // cash | card | fpx | duitnow_qr | grabpay | tng
    $t->string('gateway')->nullable();             // hitpay | ipay88 | revenue_monster ...
    $t->string('gateway_ref')->nullable()->index();
    $t->bigInteger('amount_sen');
    $t->string('status');                          // pending | succeeded | failed | refunded
    $t->jsonb('gateway_payload')->nullable();
    $t->timestampTz('occurred_at');
    $t->primary(['id', 'occurred_at']);
});

Schema::create('dining_tables', function (Blueprint $t) {
    $t->uuid('id')->primary();
    $t->uuid('tenant_id')->index();
    $t->uuid('outlet_id')->index();
    $t->string('label');
    $t->string('qr_token')->unique();              // signed token for QR ordering
    $t->unsignedSmallInteger('seats')->default(4);
    $t->jsonb('layout')->nullable();               // x,y,shape for floor-plan editor
});

Schema::create('table_assignments', function (Blueprint $t) { /* table_id, order_id, merged_from jsonb */ });
Schema::create('bill_splits', function (Blueprint $t) { /* order_id, split_no, item_ids jsonb, amount_sen, payment_id */ });

Schema::create('time_sessions', function (Blueprint $t) {  // snooker / karaoke / gaming
    $t->uuid('id')->primary();
    $t->uuid('tenant_id')->index();
    $t->uuid('outlet_id')->index();
    $t->uuid('resource_id');                       // table/room/PC
    $t->uuid('order_id')->nullable();
    $t->timestampTz('started_at');
    $t->timestampTz('paused_at')->nullable();
    $t->unsignedInteger('paused_seconds')->default(0);
    $t->timestampTz('ended_at')->nullable();
    $t->jsonb('rate_snapshot');                    // rate frozen at start, so central changes don't alter a running session
    $t->bigInteger('amount_sen')->nullable();
    $t->string('status');                          // running | paused | ended | billed
});
```

### 2.5 Sync tables

```php
// Server-side change feed: one row per change to any syncable entity (pull side)
Schema::create('sync_changes', function (Blueprint $t) {
    $t->bigIncrements('seq');                      // the pull cursor
    $t->uuid('tenant_id');
    $t->uuid('outlet_id')->nullable();             // null = all outlets
    $t->string('entity');                          // product | variant | price_override | modifier | staff | tax_rule ...
    $t->uuid('entity_id');
    $t->string('op');                              // upsert | delete
    $t->unsignedBigInteger('row_version');
    $t->timestampTz('created_at')->useCurrent();
    $t->index(['tenant_id', 'seq']);
});

// Server-side inbox: idempotency + audit for terminal pushes (push side)
Schema::create('offline_sync_queues', function (Blueprint $t) {
    $t->uuid('id')->primary();                     // = client mutation id
    $t->uuid('tenant_id')->index();
    $t->uuid('terminal_id')->index();
    $t->unsignedBigInteger('client_seq');          // monotonic per terminal
    $t->string('type');                            // order.create | order.void | payment.add | stock.adjust | session.end
    $t->jsonb('payload');
    $t->string('status')->default('pending');      // pending | applied | rejected | conflict
    $t->jsonb('result')->nullable();               // server-side adjustments / conflict info
    $t->timestampTz('client_created_at');
    $t->timestampTz('processed_at')->nullable();
    $t->timestampTz('received_at')->useCurrent();
    $t->unique(['terminal_id', 'client_seq']);     // idempotency
});

Schema::create('sync_conflicts', function (Blueprint $t) {  // surfaced to HQ for review
    $t->uuid('id')->primary();
    $t->uuid('tenant_id')->index();
    $t->uuid('queue_id');
    $t->string('kind');                            // price_mismatch | negative_stock | product_deleted | tax_rule_changed
    $t->jsonb('detail');
    $t->string('resolution')->nullable();
    $t->timestampsTz();
});
```

On the **terminal (SQLite)** mirror: `products`, `variants`, `price_overrides`, `modifiers`, `staff`, `tax_rules`, local `orders*`, plus:

```sql
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,          -- uuid, becomes server queue id
  client_seq INTEGER NOT NULL,  -- AUTOINCREMENT, per terminal
  type TEXT NOT NULL,
  payload TEXT NOT NULL,        -- JSON
  status TEXT DEFAULT 'pending',-- pending | sent | acked | rejected
  attempts INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT); -- pull_cursor, last_success_at
```

---

## 3. Offline-Sync Strategy

### 3.1 Principles

| Data class | Direction | Owner | Strategy |
|---|---|---|---|
| Catalogue, prices, staff, tax rules, discounts | Server → terminal | Server | **Pull** via cursor (`sync_changes.seq`), server always wins |
| Sales (orders, items, payments, voids) | Terminal → server | Terminal | **Push** via outbox, append-only, idempotent, never rejected for price drift |
| Stock | Both | Server-computed | Terminals push **movements (deltas)**, never absolute counts |
| Time sessions | Terminal → server | Terminal | Start/end events pushed, rate snapshot frozen at start |

### 3.2 Push (terminal → server)

1. Every business action writes domain rows **and** an `outbox` row in **one SQLite transaction**.
2. A background worker sends batches (max ~50, ordered by `client_seq`) to `POST /api/v1/sync/push`.
3. Server processes each mutation inside its own DB transaction:
   - Look up `(terminal_id, client_seq)` in `offline_sync_queues`. If it exists, return the stored result (idempotent replay).
   - Apply the mutation (insert order, items, payments, stock movements).
   - Record `applied` or `conflict` and return a per-mutation ack.
4. Terminal marks acked rows as `acked` and prunes them after a retention window. Unacked rows are retried with exponential backoff and jitter.
5. If a mutation fails validation, the server answers `rejected` with a reason. The terminal keeps it for manager review and **continues** with later mutations (no head-of-line blocking) unless they depend on it.

### 3.3 Pull (server → terminal)

1. Terminal calls `GET /api/v1/sync/pull?cursor=<last_seq>&limit=500`.
2. Server returns `sync_changes` rows after the cursor, hydrated with current entity data, plus `next_cursor` and `has_more`.
3. Terminal applies changes in a transaction, then stores the new cursor. Deletes are tombstones.
4. If the terminal is too far behind (cursor older than the retention of `sync_changes`), the server returns `full_resync_required` and the terminal rebuilds from a snapshot endpoint.
5. Websocket (Reverb) pushes a lightweight "changes available" ping so online terminals pull within seconds. Polling every 30–60 s is the fallback.

### 3.4 Conflict resolution: "price changed centrally while the terminal was offline"

**Rule: a completed sale is a fact. The customer already paid the price on the screen.** The server never rewrites it.

- Each `order_item` records `unit_price_sen` (charged), `catalog_price_sen` (server price at sync time) and `price_row_version` (version the terminal used).
- On push, if `price_row_version` is older than the server's current version:
  - The order is **accepted as-is**.
  - A `sync_conflicts` row (`price_mismatch`) is created with the delta, so HQ reports can show "sold at stale price" and finance can audit.
  - Optional tenant policy: reject only if the charged price is **below cost** or below a configured floor, flagging for manager approval without blocking the sale.
- Open (unpaid) tabs on the terminal re-price on next pull **only if** the cashier or tenant policy allows. Default: keep the price shown when the item was added.

Other conflicts:

| Conflict | Resolution |
|---|---|
| Stock goes negative after sync | Accept the sale, allow negative, raise `negative_stock` alert. Never block revenue for inventory drift |
| Product deleted/archived centrally while sold offline | Accept (name snapshot is stored), mark `product_deleted` conflict |
| Tax rule changed | Terminal-calculated tax stands for the sale. Rule version is stored in `tax_breakdown` for audit |
| Same entity edited on two terminals (e.g. customer profile) | Field-level last-writer-wins on server time, with `row_version` check. Sales data is never in this class |
| Terminal clock wrong | Use `occurred_at` for ordering/reporting but compare to `received_at`. If skew is over 10 min, flag the device and use the server-corrected time for partitioning |
| Duplicate receipt numbers | Receipt numbers are prefixed per outlet and terminal, so collisions are structurally impossible. The unique index is a safety net |
| Offline card/e-wallet payments | Only **cash** and pre-authorised methods work offline. Online-only methods (FPX, DuitNow QR, TNG) are disabled offline. Show cash/"pay later" |

### 3.5 Offline features checklist

- Local pricing engine: the same tax/discount/rounding algorithm runs on terminal and server (share a spec and golden test vectors across PHP and Dart/TS to prevent drift).
- Pre-downloaded discount rules and vouchers (voucher redemption offline = mark pending, validated on sync).
- Receipt printing: ESC/POS from local data, with a "reprint" flag. Receipt QR/e-invoice link filled after sync.
- Encrypted SQLite (SQLCipher) and a device-bound token, with offline login using a cached salted PIN hash and capped offline duration.
- Health indicator: pending outbox count, last sync time, and a manual "Sync now".

---

## 4. API Structure (REST, versioned, tenant-scoped)

Auth: Laravel Sanctum. Terminals use device tokens with ability `pos:terminal`. Dashboard users use SPA tokens with RBAC abilities. Tenant is resolved from the token, **never from a client-supplied header**.

```
# Auth / device
POST   /api/v1/auth/login                       staff login (PIN or password)
POST   /api/v1/devices/register                 pair terminal (one-time code)
POST   /api/v1/devices/heartbeat

# Sync (terminal)
GET    /api/v1/sync/bootstrap                   full snapshot for first run
GET    /api/v1/sync/pull?cursor=&limit=
POST   /api/v1/sync/push                        batch of mutations
GET    /api/v1/sync/status

# Catalogue (HQ)
apiResource /api/v1/products, /categories, /variants, /modifier-groups, /price-overrides
POST   /api/v1/products/import                  CSV/Excel
GET    /api/v1/inventory/levels?outlet_id=
POST   /api/v1/inventory/adjustments
apiResource /api/v1/suppliers, /purchase-orders
POST   /api/v1/purchase-orders/{id}/receive
GET    /api/v1/inventory/alerts/low-stock

# Orders / F&B
GET    /api/v1/orders                           filters: outlet, date, channel, status
POST   /api/v1/orders/{id}/void                 (online mgmt; offline via sync mutation)
POST   /api/v1/orders/{id}/refund
GET/POST /api/v1/tables, /tables/{id}/merge, /tables/{id}/transfer
POST   /api/v1/orders/{id}/split
GET    /api/v1/kds/tickets?station=             + websocket channel kds.{outlet}.{station}
PATCH  /api/v1/kds/tickets/{id}                 status: preparing | ready | served

# Public QR ordering (signed table token, rate-limited, no staff auth)
GET    /api/v1/qr/{token}/menu
POST   /api/v1/qr/{token}/orders

# Time-based billing
POST   /api/v1/sessions                         start
POST   /api/v1/sessions/{id}/pause|resume|end
GET    /api/v1/sessions/{id}/quote              live amount

# Payments
POST   /api/v1/payments/intents                 create gateway payment (FPX/DuitNow/GrabPay/TNG)
POST   /api/v1/webhooks/payments/{gateway}      public, signature-verified
GET    /api/v1/payments/{id}

# Reporting (HQ)
GET    /api/v1/reports/sales?group_by=outlet|day|product
GET    /api/v1/reports/payments | /tax/sst | /staff | /inventory-valuation
GET    /api/v1/dashboard/realtime

# Admin
apiResource /api/v1/outlets, /terminals, /staff, /roles
GET    /api/v1/sync/conflicts   PATCH /api/v1/sync/conflicts/{id}

# Omnichannel hooks
POST   /api/v1/integrations/{provider}/connect  (Shopify, WooCommerce, GrabFood)
POST   /api/v1/webhooks/ecommerce/{provider}    inbound orders / stock
```

Notes:
- Use **API Resources + cursor pagination** everywhere. Send `ETag` on catalogue endpoints.
- Use **Idempotency-Key** header on every non-sync POST (payments, refunds).
- Rate limit per tenant and per device, with a stricter limit on public QR endpoints.

---

## 5. Core Laravel Code

### 5.1 Multi-tenant scope + trait

```php
// app/Tenancy/TenantContext.php
namespace App\Tenancy;

final class TenantContext
{
    private static ?string $tenantId = null;

    public static function set(string $id): void { self::$tenantId = $id; }
    public static function id(): ?string { return self::$tenantId; }
    public static function require(): string
    {
        return self::$tenantId ?? throw new \RuntimeException('Tenant context not set.');
    }
    public static function clear(): void { self::$tenantId = null; }
}
```

```php
// app/Tenancy/TenantScope.php
namespace App\Tenancy;

use Illuminate\Database\Eloquent\{Builder, Model, Scope};

class TenantScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        // Fail closed: no tenant context = no rows (never "all rows")
        $tenantId = TenantContext::id();
        if ($tenantId === null) {
            $builder->whereRaw('1 = 0');
            return;
        }
        $builder->where($model->qualifyColumn('tenant_id'), $tenantId);
    }
}
```

```php
// app/Tenancy/BelongsToTenant.php
namespace App\Tenancy;

use Illuminate\Support\Str;

trait BelongsToTenant
{
    public static function bootBelongsToTenant(): void
    {
        static::addGlobalScope(new TenantScope);

        static::creating(function ($model) {
            $model->tenant_id ??= TenantContext::require();
            if (empty($model->{$model->getKeyName()}) && $model->getKeyType() === 'string') {
                $model->{$model->getKeyName()} = (string) Str::uuid7();
            }
        });
    }
}
```

```php
// app/Http/Middleware/ResolveTenant.php
namespace App\Http\Middleware;

use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Support\Facades\DB;

class ResolveTenant
{
    public function handle($request, Closure $next)
    {
        $user = $request->user();                    // Sanctum user or terminal device
        abort_unless($user && $user->tenant_id, 403, 'No tenant.');

        TenantContext::set($user->tenant_id);

        // Defence in depth: Postgres RLS reads this setting
        DB::statement("SELECT set_config('app.tenant_id', ?, false)", [$user->tenant_id]);

        try {
            return $next($request);
        } finally {
            DB::statement("SELECT set_config('app.tenant_id', '', false)");
            TenantContext::clear();
        }
    }
}
```

Postgres RLS (second wall; protects against a forgotten scope or raw query):

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON orders
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- App connects as a non-superuser role WITHOUT BYPASSRLS. Repeat per tenant table.
```

> With pooled connections (PgBouncer transaction mode) use `set_config(..., true)` inside a transaction, or `SET LOCAL`. Test this early.
> In queue jobs, always pass `tenant_id` and call `TenantContext::set()` at the start of `handle()`.

### 5.2 Sync change feed (pull side)

```php
// app/Models/Concerns/Syncable.php
namespace App\Models\Concerns;

use App\Models\SyncChange;

trait Syncable
{
    public static function bootSyncable(): void
    {
        static::saving(fn ($m) => $m->row_version = ($m->row_version ?? 0) + 1);

        static::saved(fn ($m) => SyncChange::record($m, 'upsert'));
        static::deleted(fn ($m) => SyncChange::record($m, 'delete'));
    }

    abstract public function syncEntity(): string; // 'product' | 'variant' | ...
    public function syncOutletId(): ?string { return null; }
}
```

```php
// app/Models/SyncChange.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SyncChange extends Model
{
    public $timestamps = false;
    protected $guarded = [];
    protected $primaryKey = 'seq';

    public static function record(Model $m, string $op): void
    {
        static::create([
            'tenant_id'   => $m->tenant_id,
            'outlet_id'   => $m->syncOutletId(),
            'entity'      => $m->syncEntity(),
            'entity_id'   => $m->getKey(),
            'op'          => $op,
            'row_version' => $m->row_version,
        ]);
    }
}
```

```php
// app/Http/Controllers/Api/SyncPullController.php
namespace App\Http\Controllers\Api;

use App\Models\{SyncChange, Product, ProductVariant, PriceOverride, Modifier};
use Illuminate\Http\Request;

class SyncPullController
{
    private const ENTITIES = [
        'product'        => Product::class,
        'variant'        => ProductVariant::class,
        'price_override' => PriceOverride::class,
        'modifier'       => Modifier::class,
    ];

    public function __invoke(Request $request)
    {
        $terminal = $request->user();                       // terminal device model
        $cursor   = (int) $request->integer('cursor', 0);
        $limit    = min((int) $request->integer('limit', 500), 1000);

        $minSeq = SyncChange::min('seq') ?? 0;
        if ($cursor > 0 && $cursor < $minSeq - 1) {
            return response()->json(['full_resync_required' => true]);
        }

        $changes = SyncChange::query()
            ->where('seq', '>', $cursor)
            ->where(fn ($q) => $q->whereNull('outlet_id')->orWhere('outlet_id', $terminal->outlet_id))
            ->orderBy('seq')
            ->limit($limit + 1)
            ->get();                                         // TenantScope applied via ->where tenant below

        $hasMore = $changes->count() > $limit;
        $changes = $changes->take($limit);

        // Hydrate upserts in bulk per entity (avoid N+1)
        $payload = [];
        foreach ($changes->groupBy('entity') as $entity => $rows) {
            $class = self::ENTITIES[$entity] ?? null;
            if (! $class) continue;
            $upsertIds = $rows->where('op', 'upsert')->pluck('entity_id');
            $models = $class::whereIn('id', $upsertIds)->get()->keyBy('id');

            foreach ($rows as $row) {
                $payload[] = [
                    'seq'    => $row->seq,
                    'entity' => $entity,
                    'id'     => $row->entity_id,
                    'op'     => $row->op,
                    'data'   => $row->op === 'upsert' ? $models[$row->entity_id] ?? null : null,
                ];
            }
        }

        return response()->json([
            'changes'     => $payload,
            'next_cursor' => $changes->last()?->seq ?? $cursor,
            'has_more'    => $hasMore,
        ]);
    }
}
```

> `SyncChange` needs the `tenant_id` filter: add `use BelongsToTenant;` (UUID key trait adjusted for the `seq` bigint key) or `->where('tenant_id', TenantContext::require())`.

### 5.3 Sync push controller (idempotent, per-mutation transactions)

```php
// app/Http/Controllers/Api/SyncPushController.php
namespace App\Http\Controllers\Api;

use App\Models\OfflineSyncQueue;
use App\Sync\MutationHandlerRegistry;
use App\Tenancy\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB, Log};
use Illuminate\Database\UniqueConstraintViolationException;

class SyncPushController
{
    public function __construct(private MutationHandlerRegistry $handlers) {}

    public function __invoke(Request $request)
    {
        $data = $request->validate([
            'mutations'                    => ['required', 'array', 'min:1', 'max:100'],
            'mutations.*.id'               => ['required', 'uuid'],
            'mutations.*.client_seq'       => ['required', 'integer', 'min:1'],
            'mutations.*.type'             => ['required', 'string'],
            'mutations.*.payload'          => ['required', 'array'],
            'mutations.*.client_created_at'=> ['required', 'date'],
        ]);

        $terminal = $request->user();
        $results  = [];

        // Process strictly in client order
        $mutations = collect($data['mutations'])->sortBy('client_seq');

        foreach ($mutations as $m) {
            $results[] = $this->processOne($terminal, $m);
        }

        $terminal->forceFill(['last_seen_at' => now()])->save();

        return response()->json(['results' => $results]);
    }

    private function processOne($terminal, array $m): array
    {
        // 1) Idempotency: have we seen this (terminal, client_seq)?
        $existing = OfflineSyncQueue::where('terminal_id', $terminal->id)
            ->where('client_seq', $m['client_seq'])
            ->first();

        if ($existing && $existing->status !== 'pending') {
            return $this->ack($m, $existing->status, $existing->result);
        }

        try {
            return DB::transaction(function () use ($terminal, $m, $existing) {
                $queue = $existing ?? OfflineSyncQueue::create([
                    'id'                => $m['id'],
                    'terminal_id'       => $terminal->id,
                    'client_seq'        => $m['client_seq'],
                    'type'              => $m['type'],
                    'payload'           => $m['payload'],
                    'client_created_at' => $m['client_created_at'],
                ]);

                $handler = $this->handlers->for($m['type']);   // throws on unknown type
                $outcome = $handler->handle($terminal, $m['payload'], $queue);
                // $outcome = ['status' => 'applied'|'conflict'|'rejected', 'result' => [...]]

                $queue->update([
                    'status'       => $outcome['status'],
                    'result'       => $outcome['result'] ?? null,
                    'processed_at' => now(),
                ]);

                return $this->ack($m, $outcome['status'], $outcome['result'] ?? null);
            });
        } catch (UniqueConstraintViolationException) {
            // Concurrent retry won the race: re-read stored outcome
            $q = OfflineSyncQueue::where('terminal_id', $terminal->id)
                ->where('client_seq', $m['client_seq'])->first();
            return $this->ack($m, $q?->status ?? 'pending', $q?->result);
        } catch (\Throwable $e) {
            Log::error('sync.push.failed', ['mutation' => $m['id'], 'error' => $e->getMessage()]);
            // Don't poison the queue: mark rejected with reason for manager review
            OfflineSyncQueue::updateOrCreate(
                ['terminal_id' => $terminal->id, 'client_seq' => $m['client_seq']],
                [
                    'id' => $m['id'], 'type' => $m['type'], 'payload' => $m['payload'],
                    'client_created_at' => $m['client_created_at'],
                    'status' => 'rejected', 'result' => ['error' => $e->getMessage()],
                    'processed_at' => now(),
                ]
            );
            return $this->ack($m, 'rejected', ['error' => 'processing_failed']);
        }
    }

    private function ack(array $m, string $status, ?array $result): array
    {
        return ['id' => $m['id'], 'client_seq' => $m['client_seq'], 'status' => $status, 'result' => $result];
    }
}
```

### 5.4 `order.create` mutation handler (conflict detection)

```php
// app/Sync/Handlers/OrderCreateHandler.php
namespace App\Sync\Handlers;

use App\Models\{Order, OrderItem, Payment, ProductVariant, SyncConflict, StockMovement};
use Illuminate\Support\Facades\DB;

class OrderCreateHandler implements MutationHandler
{
    public function handle($terminal, array $p, $queue): array
    {
        // Idempotent at the domain level too: order id comes from the terminal
        if (Order::where('id', $p['order']['id'])->exists()) {
            return ['status' => 'applied', 'result' => ['note' => 'already_exists']];
        }

        $conflicts = [];

        $order = Order::create([
            'id'              => $p['order']['id'],
            'outlet_id'       => $terminal->outlet_id,
            'terminal_id'     => $terminal->id,
            'receipt_no'      => $p['order']['receipt_no'],
            'channel'         => $p['order']['channel'] ?? 'pos',
            'status'          => $p['order']['status'],
            'staff_id'        => $p['order']['staff_id'],
            'subtotal_sen'    => $p['order']['subtotal_sen'],
            'discount_sen'    => $p['order']['discount_sen'],
            'service_charge_sen' => $p['order']['service_charge_sen'] ?? 0,
            'tax_sen'         => $p['order']['tax_sen'],
            'rounding_sen'    => $p['order']['rounding_sen'] ?? 0,
            'total_sen'       => $p['order']['total_sen'],
            'tax_breakdown'   => $p['order']['tax_breakdown'],
            'created_offline' => true,
            'occurred_at'     => $p['order']['occurred_at'],
            'synced_at'       => now(),
        ]);

        $variants = ProductVariant::withTrashed()
            ->whereIn('id', collect($p['items'])->pluck('variant_id'))
            ->get()->keyBy('id');

        foreach ($p['items'] as $item) {
            $variant = $variants[$item['variant_id']] ?? null;
            $currentPrice = $variant?->base_price_sen;  // + override resolution via PriceResolver in real code

            OrderItem::create([
                'id'                 => $item['id'],
                'order_id'           => $order->id,
                'variant_id'         => $item['variant_id'],
                'name_snapshot'      => $item['name'],
                'qty'                => $item['qty'],
                'unit_price_sen'     => $item['unit_price_sen'],      // what customer actually paid
                'catalog_price_sen'  => $currentPrice ?? $item['unit_price_sen'],
                'price_row_version'  => $item['price_row_version'],
                'modifiers'          => $item['modifiers'] ?? [],
                'occurred_at'        => $p['order']['occurred_at'],
            ]);

            // Conflict detection (never blocks the sale)
            if (! $variant || $variant->trashed()) {
                $conflicts[] = ['kind' => 'product_deleted', 'detail' => ['variant_id' => $item['variant_id']]];
            } elseif ($variant->row_version > $item['price_row_version']
                      && $currentPrice !== $item['unit_price_sen']) {
                $conflicts[] = ['kind' => 'price_mismatch', 'detail' => [
                    'variant_id' => $variant->id,
                    'charged_sen' => $item['unit_price_sen'],
                    'catalog_sen' => $currentPrice,
                ]];
            }

            // Stock ledger: delta, not absolute
            if ($variant) {
                StockMovement::create([
                    'outlet_id' => $terminal->outlet_id, 'variant_id' => $variant->id,
                    'reason' => 'sale', 'qty_delta' => -$item['qty'],
                    'ref_id' => $order->id, 'occurred_at' => $p['order']['occurred_at'],
                ]);
                DB::table('stock_levels')
                    ->where(['outlet_id' => $terminal->outlet_id, 'variant_id' => $variant->id])
                    ->decrement('on_hand', $item['qty']);
            }
        }

        foreach ($p['payments'] as $pay) {
            Payment::create([
                'id' => $pay['id'], 'order_id' => $order->id, 'method' => $pay['method'],
                'amount_sen' => $pay['amount_sen'], 'status' => 'succeeded',
                'occurred_at' => $pay['occurred_at'],
            ]);
        }

        foreach ($conflicts as $c) {
            SyncConflict::create(['queue_id' => $queue->id, 'kind' => $c['kind'], 'detail' => $c['detail']]);
        }

        return [
            'status' => $conflicts ? 'conflict' : 'applied',   // conflict = accepted but flagged
            'result' => ['order_id' => $order->id, 'conflicts' => array_column($conflicts, 'kind')],
        ];
    }
}
```

### 5.5 Time-based billing calculator

```php
// app/Billing/TimeBilling.php
namespace App\Billing;

use Carbon\CarbonImmutable;

final class TimeBilling
{
    /** $rate = ['rate_sen'=>1500,'unit_minutes'=>60,'min_minutes'=>30,'round_to'=>15,'round'=>'up'] */
    public static function amountSen(array $rate, CarbonImmutable $start, CarbonImmutable $end, int $pausedSeconds = 0): int
    {
        $seconds = max(0, $end->diffInSeconds($start) - $pausedSeconds);
        $minutes = (int) ceil($seconds / 60);
        $minutes = max($minutes, $rate['min_minutes'] ?? 0);

        $step = $rate['round_to'] ?? 1;
        $minutes = ($rate['round'] ?? 'up') === 'up'
            ? (int) (ceil($minutes / $step) * $step)
            : (int) (floor($minutes / $step) * $step);

        return (int) round($minutes * ($rate['rate_sen'] / ($rate['unit_minutes'] ?? 60)));
    }
}
```

The rate is **snapshotted into `time_sessions.rate_snapshot` at start**, so a central rate change doesn't alter a session already running offline.

### 5.6 Malaysian tax (SST) and rounding

```php
// app/Billing/MyTax.php
namespace App\Billing;

final class MyTax
{
    /**
     * Rates must live in a versioned `tax_rules` table synced to terminals, NOT hard-coded.
     * Malaysia's SST rates and scope have changed (service tax 6% -> 8% on most services from 1 Mar 2024;
     * sales tax 5%/10%). Verify current scope/rates with the Royal Malaysian Customs Department (MySST)
     * before go-live and make each rule date-effective.
     */
    public static function compute(int $baseSen, array $rule): array
    {
        $tax = (int) round($baseSen * $rule['rate_bps'] / 10000);
        return ['code' => $rule['code'], 'rate_bps' => $rule['rate_bps'], 'base_sen' => $baseSen,
                'amount_sen' => $tax, 'rule_version' => $rule['version']];
    }

    /** Malaysian cash rounding to nearest 5 sen. Applies to the cash total only. */
    public static function roundCash(int $totalSen): array
    {
        $rounded = (int) (round($totalSen / 5) * 5);
        return ['total_sen' => $rounded, 'rounding_sen' => $rounded - $totalSen];
    }
}
```

Also plan for **MyInvois (LHDN e-invoicing)**: store `tin`, buyer TIN, and submit/consolidate via a queued job after sync. This is a compliance requirement, so build it as its own module (`einvoice_submissions` table).

### 5.7 Payment webhook (FPX / DuitNow QR / GrabPay / TNG)

```php
// routes/api.php (outside auth:sanctum, outside ResolveTenant)
Route::post('/v1/webhooks/payments/{gateway}', PaymentWebhookController::class)
    ->middleware('throttle:webhooks');

// app/Http/Controllers/Api/PaymentWebhookController.php
class PaymentWebhookController
{
    public function __invoke(Request $request, string $gateway, GatewayRegistry $gateways)
    {
        $driver = $gateways->driver($gateway);                 // HitPay, iPay88, RevenueMonster...

        // 1) Verify signature on the RAW body, constant-time compare
        abort_unless($driver->verifySignature($request->getContent(), $request->headers->all()), 401);

        // 2) Dedupe by gateway event id
        $event = $driver->parse($request);
        if (WebhookEvent::where('gateway', $gateway)->where('event_id', $event->id)->exists()) {
            return response()->json(['ok' => true]);
        }

        // 3) Persist raw event, ack fast, process async (tenant resolved from the payment record)
        WebhookEvent::create(['gateway' => $gateway, 'event_id' => $event->id, 'payload' => $request->all()]);
        ProcessPaymentWebhook::dispatch($gateway, $event->id)->onQueue('payments');

        return response()->json(['ok' => true]);
    }
}
```

`ProcessPaymentWebhook` looks up `payments.gateway_ref`, sets `TenantContext` from that row, marks the payment `succeeded`/`failed`, closes the order, and broadcasts to the terminal so it can print the receipt. Add a **reconciliation job** that polls the gateway for `pending` payments older than N minutes (webhooks do get lost).

---

## 6. F&B / Retail / Omnichannel Notes

- **KDS routing:** on order submit, split items by `products.kds_station` into `kds_tickets` and broadcast on `private-kds.{outlet}.{station}`. KDS app is a thin websocket client with local fallback over LAN (terminal acts as a local relay) for offline kitchens.
- **QR ordering:** table QR holds a signed, expiring `qr_token`. Orders land as `channel=qr`, `status=open`, and attach to the table's open order. Staff confirms or auto-accepts per outlet setting.
- **Split bill:** by item, by equal share, or by custom amount, creating child `bill_splits` rows, each with its own payment, and the parent closes when all are paid.
- **Combo/modifier inventory:** on sale, expand combos into component variants and modifiers into `consumes_variant_id` and write one `stock_movement` per component.
- **Low-stock alerts:** a scheduled job (or DB trigger on `stock_levels`) compares `on_hand` to `low_stock_threshold` and notifies via mail/WhatsApp/push.
- **Purchase orders:** draft → sent → partially_received → received. Receiving writes `stock_movements(reason=po_receive)` and updates `cost_sen` (weighted average).
- **E-commerce sync:** webhook in (Shopify/Woo orders become `channel=online` orders), outbound stock push via a queued, rate-limited job. Use the stock ledger as the single source for availability.

---

## 7. Implementation Roadmap (solo dev / small team)

### Phase 1: Foundation (Weeks 1–6)
- Laravel project, Postgres, Redis, Horizon, Sanctum, Pest tests, CI.
- Tenancy (`tenants/outlets/terminals`), `TenantScope`, RLS, RBAC (roles, permissions, staff PIN).
- Product catalogue (products, variants, categories, price overrides), HQ dashboard skeleton, CSV import.
- Device registration and pairing.
- **Exit criteria:** two tenants cannot see each other's data (automated isolation tests).

### Phase 2: Core POS + Offline Sync Engine (Weeks 7–14), the riskiest phase
- Terminal app with SQLite, product grid, cart, discounts, cash payment, ESC/POS receipt printing.
- Outbox, push/pull endpoints, cursor, idempotency, conflict table, and the shared pricing/tax engine with golden test vectors.
- Chaos testing: airplane mode mid-sale, duplicate pushes, app kill during sync, clock skew, 5,000-order backlog.
- **Exit criteria:** a full trading day offline syncs with zero duplicates or lost orders.

### Phase 3: Malaysian Payments + Compliance (Weeks 15–19)
- Payment gateway abstraction and one gateway first (e.g. HitPay or Revenue Monster), then FPX, DuitNow QR, GrabPay, TNG.
- Webhooks, reconciliation job, refunds, SST rule engine, 5-sen rounding, shift open/close and cash-up.
- MyInvois e-invoice module (start early as it has external dependencies).
- **Exit criteria:** sandbox end-to-end for each method, including webhook replay and loss.

### Phase 4: Vertical Modules (Weeks 20–28)
- **F&B:** tables/floor plan, modifiers, combos, KDS, QR ordering, split bill.
- **Retail:** matrix variants, barcodes, stock transfers, suppliers and POs, low-stock alerts, stocktake.
- **Time-based:** resource board, start/pause/stop, rate cards, live quote.
- Ship each vertical to one pilot merchant as soon as it's ready, rather than waiting for all three.

### Phase 5: Enterprise, Analytics & Scale (Weeks 29–36)
- HQ multi-outlet/franchise reporting, regional pricing rollout, real-time dashboard (Reverb), exports.
- E-commerce integrations (Shopify/Woo), loyalty/CRM, customer receipts via WhatsApp/email.
- Table partitioning and archiving, read replica for reports, `daily_sales_summaries`, audit log, backup/restore drills.
- Load test (target: 1,000 terminals pushing at peak), observability (Sentry, Telescope in staging, Grafana), security review and PDPA checks, app-store/device rollout (MDM), onboarding wizard.

---

## 8. Risks & Decisions to Make Early

| Risk | Mitigation |
|---|---|
| Pricing logic drift between PHP and the terminal | One written spec and shared test vectors run in both languages in CI |
| Offline tax/rule changes | Version every tax rule and store `rule_version` on each order |
| Payment loss between gateway and POS | Webhook dedupe plus reconciliation poller plus manual "check status" button |
| Scope creep ("everything for everyone") | Pilot one vertical per phase, feature-flag the rest per tenant (`tenants.settings.features`) |
| Hardware fragmentation (printers, scanners, cash drawers) | Pick 2 supported printer models and one terminal OS first |
| Terminal data theft | SQLCipher, remote wipe flag on `terminals`, short offline login window |
| Choosing Flutter vs React Native | Pick the one your team already ships. Flutter has stronger printer/USB plugin coverage. Use WatermelonDB only if on RN |

---

## 9. Suggested Next Steps

1. Create the repo and run the Phase 1 migrations above.
2. Write the tenant isolation tests first.
3. Build the shared pricing/tax spec and its test vectors before any UI.
4. Prototype the sync loop (outbox, push, pull) with a CLI terminal simulator before building the Flutter UI.

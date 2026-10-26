# Third-party delivery (GrabFood, Foodpanda, ShopeeFood)

Addendum to `allurus-pos-architecture.md`. Goal: no more "tablet hell". A delivery order reaches the cloud, becomes a normal Allurus order, and appears on the terminal and KDS within seconds; kitchen status flows back to the platform.

Status: **week 1 built** against a fixture provider (schema, provider contract, webhook, ingestion, cancellation). **Week 2's kitchen half is built** (auto-accept gated on kitchen presence, kitchen tickets, print jobs, Reverb doorbell: `docs/web-ordering-and-auto-accept.md` §7); the terminal "new order" UI and weeks 3–5 are not started. This is the original addendum, corrected to match the codebase; the corrections are listed at the end.

> **Verify before building adapters.** No platform's current API, partner terms, fees or Malaysian availability has been checked. Grab, Foodpanda and ShopeeFood APIs are partner-gated; aggregators (Deliverect, Klikit, Otter) have their own onboarding. Partner/sandbox access is the critical path, not engineering.

## 1. Direct APIs vs aggregator

| | Direct (each platform) | Aggregator (Deliverect, Klikit, Otter) |
|---|---|---|
| Time to first live order | Slow: approval and certification per platform | Faster: one integration, one certification |
| Build / maintenance | High: 3+ APIs, auth schemes, menu formats | Low: one normalised payload; aggregator absorbs churn |
| Recurring cost | None to a third party | Aggregator fees; model into pricing |
| Control and latency | Full; fastest status updates | Limited to what the aggregator exposes; extra hop |
| Risk | Platform deprecations land on you | Aggregator outage or pricing change lands on you |

**Decision:** a `DeliveryProvider` interface; ship the **aggregator adapter first**, add a **direct GrabFood adapter** when volume justifies it. Everything downstream is provider-agnostic: a new adapter is one class plus a line in `AppServiceProvider`.

## 2. Flow (as built)

```
Platform / aggregator
  │ POST /api/v1/webhooks/delivery/{provider}     public, rate-limited, outside auth + ResolveTenant
  ▼
DeliveryWebhookController
  1. provider->storeRef() → delivery_store_routes (no RLS) → tenant + connection
  2. TenantContext::enter(tenant); load connection (RLS); must be active|paused
  3. provider->verifySignature(RAW body)   — unknown store / inactive / bad signature: same 401, nothing stored
  4. insertOrIgnore delivery_webhook_events (unique provider+event_id, global) → duplicate? 200 {duplicate:true}
  5. dispatch ProcessDeliveryEvent(event, tenant) on queue "delivery"; 200
  ▼
ProcessDeliveryEvent  — TenantContext::enter() first (scope AND RLS)
  OrderCreated   → provider->normalize() → DeliveryOrderIngestor::ingest()
  OrderCancelled → DeliveryOrderIngestor::cancel() → App\Sync\Voids::apply() (same path as order.void)
  unparseable    → event 'failed', not retried (raw body kept for replay)
  ▼
orders + order_items + order_ids + payment(platform_collected) + StockLedger::move + delivery_orders
  ▼
change feed (trigger) → terminals pull delivery_order rows (safety net behind the push in week 2)
```

## 3. Rules the code enforces

* **Tenant from the store, never the caller.** `delivery_store_routes` is the only pre-tenant lookup: no RLS, no secrets, written **only** by the `delivery_route_sync` trigger on `delivery_connections`. Every other delivery table is a tenant table with RLS.
* **Signature on the raw bytes, compared with `hash_equals()`.** Nothing is stored for an unverified request; unknown store, inactive connection and bad signature are indistinguishable (no store enumeration).
* **Credentials and webhook secret are encrypted at rest** (`encrypted` casts, APP_KEY) and `$hidden`.
* **Idempotent twice:** on the event (`provider + event_id`, global unique index — it sees across tenants despite RLS) and on the order (`connection + external_order_id`, under an advisory lock, so two event ids for one order create it once).
* **Never drop an order.** Unmapped items/modifiers, a missing tax rule, totals that disagree and negative stock become `delivery_orders.attention_reasons` (`needs_attention = true`). Unmapped lines are kept with `variant_id = null` under the platform's name, and move no stock.
* **Two sets of figures, never "fixed".** `orders` keeps our identity (`total = subtotal − discount + service + tax + rounding`): lines at the platform's prices, merchant-funded discount only, SST from `PricingEngine::price()` with `TaxRule::forPricing()`, tender `card` (no cash rounding). The platform's figures (items total, delivery fee, platform discount, commission, total) live on `delivery_orders`. `totals_mismatch` when the platform's items total differs from ours. The `platform_collected` payment equals our total; reconciliation is against the platform payout, not the till.
* **Integer-only.** Platform `qty` (whole units) becomes `qty_milli`; any non-integer money or quantity in a payload is a normalisation failure.
* **PDPA:** only `first_name` and `phone_suffix` of the customer are kept; `raw_payload` is `$hidden` and never synced to terminals.
* **Cloud orders have no terminal or cashier** (`orders.terminal_id`/`staff_id` nullable); platform cancellations have no staff actor, so they raise no `unauthorized_void`.
* **The fixture provider is not registered in production** (`AppServiceProvider`).

## 4. Schema (migration `2026_01_01_000130`)

`delivery_connections` (encrypted credentials/secret, status, auto_accept, prep/accept timeouts, settings incl. `default_tax_code` for unmapped items) · `delivery_store_routes` (trigger-maintained) · `delivery_menu_mappings` (variant → external item, explicit price or markup, availability; has `outlet_id` + `row_version`, in the feed) · `delivery_modifier_mappings` · `delivery_orders` (platform figures, attention reasons, raw payload; in the feed, routed by outlet) · `delivery_webhook_events` · `delivery_status_outbox` (for week 3). All `timestampTz(…, 6)`.

## 5. Provider contract

`App\Delivery\Contracts\DeliveryProvider`: `key`, `storeRef`, `verifySignature(raw, request, connection)`, `eventId`, `eventType`, `normalize` → `DeliveryOrderData` (items → `DeliveryItemData`, modifiers → `DeliveryModifierData`), `externalOrderId`, and for later weeks `pushStatus`, `setItemAvailability`, `pushMenu`. Payload fixtures live under `tests/Fixtures/delivery/<provider>/`; each real adapter commits one recorded sandbox payload per event type.

## 6. Remaining plan

1. **Week 2 — real-time:** Reverb (`ShouldBroadcastNow` on `private-outlet.{id}.delivery`), terminal "new delivery order" UI, KDS tickets through the same path as dine-in. *Depends on the F&B module (KDS) and Reverb, neither built yet.* The terminal's cursor pull of `delivery_order` is already the safety net.
2. **Week 3 — status back to the platform:** `DeliveryStatusService` → `delivery_status_outbox` → `PushDeliveryStatus` job (strictly ordered, retried); accept/reject endpoints (`Idempotency-Key`); KDS status → preparing/ready; `AutoRejectIfUnaccepted`; heartbeat watchdog that pauses the store when no terminal is connected.
3. **Week 4 — menu:** mapping UI (HQ), push menu/price/availability, availability off when `stock_levels.on_hand_milli` hits zero, "unmapped items seen in orders" report from `attention_reasons`.
4. **Weeks 5–6:** aggregator adapter against its sandbox, pilot one merchant on one platform; then a second platform or direct Grab.

**Exit criteria:** a sandbox order appears on the terminal and KDS in under 3 s; status changes reach the platform; a replayed webhook creates no duplicate; an order with an unmapped item still shows up, clearly flagged.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Partner access and sandboxes | Apply early; calendar-time risk |
| Different signature/retry schemes | Isolated per adapter; fixture-tested |
| Order arrives while no terminal is connected | Auto-pause, manager alert, missed-orders banner (week 3) |
| Menu drift | `sync_status`, reconcile job, unmapped-in-orders report |
| Accept deadline missed | Auto-reject job, countdown, `auto_accept` for trusted outlets |
| Totals disagree | Flag, never fix |
| PDPA | Minimal customer data, role-restricted, purge after a retention window (not yet built) |
| SST on delivery fees / platform-funded discounts | Confirm with an accountant before go-live |

## 8. Corrections to the original draft

| Draft | As built | Why |
|---|---|---|
| `DeliveryConnection::withoutGlobalScopes()` in the webhook | `delivery_store_routes` (no RLS, trigger-maintained) | RLS still hides every row with no tenant set: every webhook would have been 401 |
| `TenantContext::set()` in jobs | `TenantContext::enter()` / `leave()` | `set()` alone doesn't set `app.tenant_id`, so RLS hides all rows |
| `Syncable` / `syncEntity()` | `row_version` + feed triggers | The feed is Postgres triggers (model hooks miss raw SQL) |
| `qty`, `-$l['qty']` | `qty_milli` | Rule 1; there is no `qty` column |
| `PricingEngine::calculate`, `mulDivRound`, `discount: {type: fixed}`, `payment_method` | `price()`, `divHalfUp()`, `order_discount: {amount_sen}`, `tender: 'card'`, `TaxRule::forPricing()` | The engine's real API |
| `StockMovement::record` | `StockLedger::move()` | Per-item locks, stocktake absorption, negative-stock flags |
| `terminal_id`/`staff_id` null on a NOT NULL column | Columns made nullable; cancellation via `Voids::apply` with no actor | Cloud orders have neither |
| No `order_ids` row, no `net_sen`/`tax_code` | Both written | Otherwise voids, refunds and `payment.add` can't find or price the order |
| `orders.total_sen` = platform total | `orders` keeps our identity; platform figures on `delivery_orders` | Reports and the sync verifier rely on the identity |
| check-then-create in the ingestor | Advisory lock per (connection, external order) | Two workers would race |
| `timestampTz` default precision, `datetime` casts | `(…, 6)`, `PreciseTimestamps`, immutable casts | Second-precision timestamps lose ordering |
| Store unverified events (`signature_valid` column) | Only verified events are stored, under the tenant | Lets the events table have RLS; nothing stored for forged requests |

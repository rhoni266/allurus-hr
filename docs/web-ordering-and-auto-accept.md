# Web ordering (BYOD + table QR) and zero-touch delivery auto-accept

Status: **step 1 built** (kitchen tickets, print jobs, kitchen devices, presence, gated auto-accept, Reverb doorbell, simulator print node); see §7 for how it differs from the sketches below. Steps 2–5 not started. Answers the four questions of the brief, corrected against the codebase and `CLAUDE.md`; corrections to the brief are listed in §6.

## 0. Three principles the brief skips

1. **A WebSocket message is a doorbell, not the delivery.** Reverb drops messages whenever a screen sleeps, Wi-Fi blips or a worker restarts. Every kitchen ticket and print job is a database row in the change feed; the broadcast only says "pull now". A KDS or print node that missed it catches up through its normal cursor pull on reconnect. This is the same rule the sync engine already follows.
2. **"Accepted" is a promise to a customer, so the server may only make it when someone will cook.** Auto-accept is gated on proof that the outlet's kitchen is listening (a recent heartbeat from a KDS or print node). Otherwise it falls back to manual accept and the auto-pause/auto-reject plan from delivery week 3. An order accepted into a dark kitchen is worse than a rejected one.
3. **Web clients are untrusted, online-only devices.** A personal phone in a browser can't be attested, has no SQLCipher store and no hardware key. It therefore gets no offline sign-in and no cash, and the server prices its orders. That is the reverse of terminal orders, which are facts the server records and flags (rule 4).

## 1. Web client authentication

Three kinds of caller, three credentials. None of them are JWTs. A JWT can't be revoked before it expires, and the device lifecycle (`retire`, `revoke`, `wipe`) and PIN-change revocation depend on revoking at once. Sanctum's opaque, hashed, revocable tokens already do this.

| | Terminal (exists) | Staff BYOD web client | Customer at a table |
|---|---|---|---|
| Who it is | A paired, attested device | A paired **browser**, then a staff PIN session | Nobody: a seat at a table |
| Credential | Sanctum token, ability `pos:terminal` | Sanctum token, ability `pos:web`, in an `HttpOnly; Secure; SameSite=Strict` cookie (not `localStorage`, which XSS can read), plus `X-Staff-Session` | `table_session` token, opaque, hashed, short-lived |
| How it's obtained | Pairing code + attestation | Pairing code from a manager. Attestation isn't possible, so the device is registered as `kind = web` | Scanning the table QR **while the table is open** |
| Tenant from | Token → terminal | Token → device | QR slug → `table_routes` (pre-tenant, trigger-maintained, like `delivery_store_routes`) |
| Lifetime | Until unpaired | Device: until unpaired. Staff session: shorter than a terminal's (e.g. 4 h) | Until the bill closes, or 3 h at most |
| Offline | Yes | **No.** No offline credentials (they need attestation) | No |
| Can do | Everything by role | Take orders, send to kitchen, view tables. **Not** cash, voids, refunds, stock or pairing | Read the menu, add items to *its own* table's bill, call staff, pay online |

### Staff BYOD

- **Registration:** a browser registers like a device (`POST devices/register`). It gets `kind = web`, a nullable `attestation`, and a token with only `pos:web`. The ability set is a subset: middleware refuses `pos:web` on cash payments, `order.void`, `order.refund`, `stock.*`, `session.end` and `devices/pairing-codes`. These go through the terminal or a manager on a terminal.
- **Sign-in and lockout:** staff sign in with the same PIN flow and lockout (5 per staff per device, 15 per device). The session is bound to the browser device.
- **PIN length:** a 4-digit cashier PIN typed into a web page on an unmanaged phone is weak. Require 6+ digits for any staff member who signs in on a web device, enforced at login on `kind = web`, the same mechanism as `pin_change_required`.
- **Orders are online writes, not sync mutations:** `POST /api/v1/orders` with an `Idempotency-Key` and a client UUID (rule 3). The server prices it with `PricingEngine::price()` and `PriceResolver`, and the price shown to the waiter comes back from the server. Any terminal at the outlet receives it through the feed, and the kitchen through §3.
- **Revoking a lost phone:** the existing `revoke` path. It needs no wipe flow, because a web device holds no sales.

### Customer QR

- **What the QR contains:** a URL with the table's public slug, `/t/{slug}`. It is **not a secret**: anyone can photograph it and order from home. So:
  - The slug only works while the table has an **open dining session**: staff seated it, or the outlet runs "open seating" during set hours.
  - Scanning creates a `table_session` token, bound to that dining session, that dies when the bill closes.
  - Optionally, a 4-digit code shown on the table's printed bill or a small display must be typed on the first scan. This stops orders from someone who isn't at the table.
- **Confirmation:** customer orders go to the kitchen only after one of the following, a per-outlet setting:
  - a waiter confirms them (the default);
  - the customer has paid online first;
  - the outlet trusts the table.

  Prank orders cost real food.
- **Limits:** rate limit by session and by IP. A session can only see and write its own table's bill. Customer orders carry `source = qr` and no `staff_id`.
- **Payment:** online methods (FPX, DuitNow QR) through the existing webhook rules (rule 10), or "pay at counter".
- **PDPA:** collect nothing about the customer unless they opt in (for example, a phone number for a loyalty programme).

New tables (all RLS'd except `table_routes`): `dining_tables`, `table_routes`, `dining_sessions`, `table_sessions` (token hash only), plus `orders.source` (`terminal | web | qr | delivery`).

## 2. Auto-accept (delivery)

**The webhook controller doesn't change.** Rule 10: verify, dedupe, ack, queue. If item mapping and broadcasting ran inside the HTTP request, a slow database would make the platform time out and retry, and that's how duplicate tickets happen. Auto-accept belongs in `ProcessDeliveryEvent`, after ingestion commits.

```php
// app/Delivery/DeliveryOrderIngestor.php — inside ingest(), in the same transaction as the order
$accept = $connection->auto_accept && KitchenPresence::isListening($outletId);   // heartbeat < 60 s
$delivery = DeliveryOrder::create([
    // ... as today
    'status'           => $accept ? 'accepted' : 'received',
    'accepted_at'      => $accept ? now() : null,
    'accepted_by'      => $accept ? 'auto' : null,          // audit: who decided
]);
if ($accept) {
    Kitchen::fire($order, source: 'delivery');               // kitchen_tickets + print_jobs rows (§3, §4)
    DeliveryStatusService::queue($delivery, 'accepted');     // delivery_status_outbox → platform (week 3)
}
// a needs_attention order is still accepted: the kitchen ticket shows the platform's
// item name for unmapped lines, and the flag stays for the manager
```

Notes:
- **The platform must be told.** Setting `accepted` in our database means nothing to Grab. The status outbox (`delivery_status_outbox`, already in the schema) carries it, retried and strictly ordered. Its `PushDeliveryStatus` job is delivery week 3.
- **No live kitchen means no auto-accept.** The order stays `received`: the terminal alerts, and `AutoRejectIfUnaccepted` fires at `accept_by`. Better still, the heartbeat watchdog pauses the store on the platform before this happens.
- **Idempotency:** `Kitchen::fire` creates one ticket per order (unique `order_id` on `kitchen_tickets`). A replayed event finds the existing order and fires nothing.
- **Bypassing the cashier is fine:** delivery orders already have no terminal or staff actor.

## 3. Kitchen tickets and broadcasting

The fact is a row; the event is the doorbell.

```php
// kitchen_tickets: id, tenant_id, outlet_id, order_id (unique), station, source, status
// (new|preparing|ready|bumped), lines jsonb (name, qty_milli, modifiers, notes), row_version
// → RLS + feed triggers, entity 'kitchen_ticket', routed by outlet_id

class OrderAutoAcceptedToKitchen implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    public function __construct(public string $tenantId, public string $outletId, public string $ticketId) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel("outlet.{$this->outletId}.kitchen")];
    }

    public function broadcastAs(): string { return 'ticket.new'; }

    public function broadcastWith(): array
    {
        return ['ticket_id' => $this->ticketId];   // a doorbell: no customer data, no prices
    }
}
```

- **`ShouldDispatchAfterCommit`:** if the event were broadcast inside the transaction, a KDS could pull before the row is visible, find nothing and wait for a bell that never rings again.
- **Queued, not `ShouldBroadcastNow`:** a slow or down Reverb must not slow ingestion or fail the job. Reverb on the same host adds milliseconds.
- **Channel authorisation:** `routes/channels.php` authorises `outlet.{id}.kitchen` only for a device token whose terminal or device belongs to that outlet. It uses `ResolveTenant` from the token, never a header. Kitchen devices (KDS screens, print nodes) are paired devices with ability `pos:kitchen`.
- **The KDS client** (Flutter or a web KDS) uses Echo or `pusher_channels`. On `ticket.new` it calls the feed pull, the same `GET sync/pull` with entity `kitchen_ticket`, and renders. It also pulls on a timer (e.g. 15 s) and on every reconnect, so a missed bell costs seconds, not a lost order. Bumping a ticket is a mutation (`ticket.bump`), and that is how KDS status reaches the platform as preparing/ready.

```js
echo.private(`outlet.${outletId}.kitchen`)
    .listen('.ticket.new', () => pullFeed());   // never render from the message itself
```

## 4. The local printer problem

The cloud can't open a connection into a restaurant's LAN (NAT, no fixed IP, and port forwarding would be a security hole). So every option is the **printer side dialling out**:

| Option | How | Hardware | Verdict |
|---|---|---|---|
| **A. Print node** (recommended) | A small paired device on the LAN (cheap Android box or Raspberry Pi running our agent; or the POS terminal itself) holds the Reverb connection + cursor pull of `print_jobs`, prints ESC/POS to `ip:9100` / USB, acks | One per outlet, or reuse the terminal | Works with any ESC/POS printer; offline-tolerant; one code path |
| **B. Cloud-polling printers** | Printers with built-in cloud polling (Star CloudPRNT, Epson Server Direct Print) poll an HTTPS URL of ours for jobs | None extra, but specific printer models | Good for small sites; **verify the vendor protocols and model support** before committing |
| C. Terminal prints everything | The terminal app receives tickets and prints | None | Fails exactly when the terminal is off, asleep or mid-crash. Fine as a fallback, not the plan |

Print jobs, whichever option:
- **Rows:** `print_jobs` holds `id, outlet_id, printer_id, kind (kitchen|receipt|label), ticket_id, payload, status (queued|sent|printed|failed), attempts`. They are feed-routed by outlet. The payload is pre-rendered by the server (ESC/POS bytes or a layout spec), so each node doesn't need its own templates.
- **At-least-once delivery, deduplicated on the node.** The node keeps the job ids it has printed and acks after printing. A job it sees again after a crash is **not reprinted** unless a manager asks, and a manual reprint is stamped `REPRINT`. Missing a ticket loses an order; printing it twice wastes food. Ack-and-dedupe avoids both.
- **Heartbeat:** the node heartbeats every ~20 s and reports printer status (paper out, offline). That heartbeat is what `KitchenPresence::isListening()` reads in §2. A paper-out printer counts as "not listening" unless a KDS is live.
- **Fallbacks:** jobs not printed within N seconds alert the terminal and the manager, and the KDS shows them.
- **Simulator:** gets a print-node scenario: kill the node mid-batch, restart it, and assert every ticket printed exactly once.

## 5. Build order (proposed)

1. **Kitchen core, server only:**
   - `kitchen_tickets` and `print_jobs` (RLS, feed, isolation tests);
   - kitchen devices (`pos:kitchen`), heartbeat, `KitchenPresence`;
   - `Kitchen::fire` for terminal, web and delivery orders;
   - install Reverb, plus channel authorisation;
   - auto-accept in the ingestor, gated on presence;
   - a simulator print node and scenario.
2. **Delivery week 3 (status outbox):** without it, auto-accept never reaches the platform. Use the fixture provider's `pushStatus` until there is a sandbox.
3. **Staff BYOD:** web device kind, `pos:web` ability set, online `POST orders` priced by the server, 6-digit PIN for web sign-in.
4. **Table QR:** tables, dining sessions, table sessions, the confirmation setting, online payment.
5. **Clients:** the PWA (waiter and customer views of one app) and the KDS UI. These are front-end work, after the API is stable.

## 6. Corrections to the brief

| Brief | Proposed | Why |
|---|---|---|
| Map items, accept and broadcast in the webhook controller | Controller unchanged (verify, dedupe, ack, queue); accept in `ProcessDeliveryEvent` after commit | Rule 10; slow requests cause platform retries and duplicate tickets |
| Always force `Accepted` | Per-connection `auto_accept` **and** a live kitchen heartbeat; otherwise manual / auto-reject | Accepting into a dark kitchen breaks a promise to the customer |
| Accept in our DB | Also queue the status to the platform (`delivery_status_outbox`) | The platform only knows what we tell it |
| Fire the order onto the KDS over WebSockets | Ticket rows in the feed; the broadcast is a doorbell; the client pulls | WebSockets lose messages; a ticket must never be lost |
| Staff JWTs | Sanctum opaque tokens (revocable), browser registered as a `web` device, `HttpOnly` cookie | Revoke and PIN change must take effect immediately |
| BYOD = another POS | Online-only and restricted (no cash, voids, refunds, stock or offline) | Unattested devices can't hold offline credentials or cash facts |
| Table-scoped token in the QR | QR = public slug; short-lived token only while the table is open; optional table code; waiter confirmation by default | A photographed QR would otherwise allow ordering from anywhere, forever |
| Web orders sync like terminal sales | Server prices web and QR orders; terminal sales stay recorded-and-flagged | Untrusted clients don't get to state prices |
| Cloud triggers the printer | Printer side dials out (print node or cloud-polling printer); ack and dedupe | NAT; inbound connections to a LAN are a security hole |

## 7. Step 1 as built

| Sketch above | As built | Why |
|---|---|---|
| `OrderAutoAcceptedToKitchen`, `ShouldDispatchAfterCommit` | `App\Kitchen\KitchenTicketChanged` (`ticket.new` / `ticket.cancelled`), queued `ShouldBroadcast`, sent from `DB::afterCommit` inside `rescue()` | One doorbell for every ticket source and for cancellations; a broadcaster that is down must never fail the order |
| `Kitchen::fire` for delivery only | Also terminal sales with `order.send_to_kitchen`, and `Voids::apply` cancels the ticket (CANCELLED slip) for terminal voids and platform cancellations alike | Food for a cancelled order must stop |
| — | A terminal sale that syncs more than `pos.kitchen.fresh_seconds` (15 min, device time) after it was rung up gets a `late` ticket: recorded, not printed, flagged `kitchen_ticket_late` | Printing a meal hours after the outlet was offline would cook food nobody is waiting for |
| Kitchen devices `pos:kitchen` | Pairing codes carry a `kind`; kitchen devices are exempt from attestation unless `pos.attestation.kitchen_required` | A print node may be a board that can't attest; it holds no sales, cash or credentials |
| Print node dedupes by job id | The node marks a job `printing` before sending it to the printer. A power cut mid-print is reported `failed: print_uncertain`, never reprinted automatically | The only window where the node can't know whether paper came out; a person decides |
| — | Kitchen devices pull only `kitchen_ticket`, `print_job`, `printer` | A KDS has no business with staff lists or the catalogue |

Endpoints: `POST kitchen/heartbeat`, `POST kitchen/print-jobs/{id}/ack`, `POST broadcasting/auth` (all under `/api/v1`, device token). Simulator: `print-node` (crashes at every point, lost acks, no doorbell, kitchen going quiet).

Not done in step 1: stations and routing by station, ticket bump/status mutations from the KDS, reprint, "job not printed within N seconds" alerts, a real Reverb server in the simulator, manual accept for non-auto-accepted delivery orders (delivery week 3). Installing Reverb downgraded Guzzle 8 → 7 (Reverb 1.12 needs `guzzlehttp/psr7` 2.x).

# Allurus HR — Inventory stock-out ticket (spec, v1)

**Product:** `js/ops.js` + `js/ops-rules.js` — added to the existing Operations stock module.

## Requirement
When a user taps **Stock out** for an item, open a **stock-out ticket** instead of a direct quantity change:
- The ticket is **appointed by an individual (employee) or by role** and **by department** (both required).
- Mobile: e.g. role "painter" in department "operations" gets a big **+ Stock paint** button to create the ticket.
- **Admin receives the request** (notification), so the ticket is **not** a direct stock change.

## Confirmed decisions
1. Ticket does **not** change stock until admin approves. Existing `moveModal` direct movement stays for immediate stock out (admin/staff area).
2. Notification goes to **all accounts with operations area** (`opsPeople`).
3. Department is a **dropdown** from a flexible list — any inventory item's category/location, not hardcoded.

## Data model (firestore `ops.stockOuts`)
```js
stockOut = {
  id: string,
  itemId: string,
  ticketNo: string,          // e.g. STO-261126-001
  requesterType: 'individual' | 'role',
  staffId: string | null,    // if individual
  role: string | null,       // if role
  department: string,        // required, dropdown (flexible list)
  qty: number,               // positive
  unit: string,
  reason: string,            // from MOVE_KINDS (Used, Sold, Damaged, Count correction, Returned, Other)
  note: string,              // optional
  status: 'pending' | 'approved' | 'rejected' | 'received',
  by: string,                // empId who created
  at: string,
  createdAt: timestamp,
}
```

## Flow
1. **Stock list (phone):** each item card shows large ± buttons. Tapping **− Stock out** opens the ticket modal.
2. **Ticket modal** (mobile-first, one screen):
   - Item name + current on-hand (read-only)
   - Quantity + reason (existing `moveModal` fields)
   - Requester type: `Individual` / `Role`
   - If Individual: staff dropdown (person)
   - If Role: role text (e.g. "painter")
   - Department: dropdown (flexible list, e.g. "operations")
   - Note (optional)
   - Submit creates ticket (status `pending`) + notifies all admin.
3. **Admin view:** list of pending stock-out tickets (tab in the stock screen).
4. Admin **approve / reject** action updates status; no stock change on the ticket.

## Rules
- `department` required, non-empty.
- `requesterType` set; `staffId` required if individual; `role` required if role.
- `qty > 0` (positive).
- Ticket never changes stock.
- Per design system: 390px phone, big buttons, one-screen per flow.

## Tests (`tests/inventory.test.js`, new)
- Create ticket with `requester_type: 'role'`, `role: 'painter'`, `department: 'operations'` → stored with `staff_id: null`, `role: 'painter'`, `status: 'pending'`.
- Create with `requester_type: 'individual'`, `staffId`, `department` → stored with `role: null`, `status: 'pending'`.
- Reject: missing `department`, missing `requester_type`, `qty <= 0` → error.
- Admin receives notification on create.

## Files to change
- `js/ops-rules.js`: `makeStockOut`, `STOCK_OUT_REASONS`
- `js/ops.js`: ticket list, ticket modal, save, notify
- `tests/inventory.test.js`: unit tests
- `docs/INVENTORY-ON-SPEC.md`: note ticket + assignment

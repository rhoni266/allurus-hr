// docs/INVENTORY-ON-SPEC.md, pure rules: stock levels from moves (opening, in, out, adjust, count correction), value at cost, the low-stock rule,
// item history with a running balance, a stock count, import parsing (quoted cells, duplicates, bad numbers), CSV rows. Fake items only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sb = { window: {} }; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'ops-rules.js'), 'utf8'), sb);
const O = sb.window.AllurusOpsRules;
const plain = (x) => JSON.parse(JSON.stringify(x));
const ids = (() => { let n = 0; return () => `m${++n}`; })();

const items = [
  { id: 'i1', code: 'HW-001', name: 'Cement 50kg', unit: 'bag', opening: 100, reorder: 40, lastPrice: 18.5, price: 24, category: 'Building', location: 'A1' },
  { id: 'i2', code: 'HW-002', name: 'Nails 3in', unit: 'pack', opening: 0, reorder: 20, lastPrice: 6.2, price: 9.5 },
  { id: 'i3', code: 'HW-003', name: 'Paint 5L', unit: 'tin', opening: 10, reorder: 0, lastPrice: 0, price: 80 },
];
const mv = (itemId, qty, date, kind = 'Received') => ({ id: ids(), itemId, qty, date, kind });

test('stock levels from moves: opening plus in, out, adjustments and count corrections; low when at or below the reorder level', () => {
  const moves = [mv('i1', 30, '2026-11-01'), mv('i1', -75, '2026-11-02', 'Sold'), mv('i1', -3, '2026-11-03', 'Damaged'), mv('i1', 2, '2026-11-04', 'Count correction'), mv('i2', 25, '2026-11-01')];
  const lv = Object.fromEntries(plain(O.stockLevels(items, moves, [])).map((x) => [x.id, x]));
  assert.equal(lv.i1.onHand, 54); assert.equal(lv.i1.low, false);
  assert.equal(lv.i2.onHand, 25); assert.equal(lv.i2.low, false);
  assert.equal(O.onHand(items[0], moves, '2026-11-02'), 55, 'as of a date');
  const lo = O.stockLevels(items, [mv('i1', -62, '2026-11-02', 'Sold')], []).find((x) => x.id === 'i1');
  assert.equal(lo.onHand, 38); assert.equal(lo.low, true, '38 is at or below 40');
  assert.equal(O.onHand({ id: 'x', opening: 0.1 }, [{ itemId: 'x', qty: 0.2, date: '2026-11-01' }]), 0.3, 'no floating point drift');
});

test('value at cost and at selling price; unpriced items are counted, not hidden', () => {
  const lv = O.stockLevels(items, [], []);
  const v = O.stockValue(plain(lv));
  assert.equal(v.cost, 1850);                  // 100 × 18.50; nails 0 on hand; paint has no cost
  assert.equal(v.selling, 100 * 24 + 10 * 80);
  assert.equal(v.unpriced, 1, 'paint is on hand with no cost price');
  assert.equal(O.stockValue([{ onHand: -5, lastPrice: 10, price: 12 }]).cost, 0, 'negative stock is not valued');
});

test('low-stock list: what is low, what is on order, and what to order', () => {
  const lv = O.stockLevels(items, [mv('i1', -70, '2026-11-02', 'Sold')], []);
  const low = plain(O.lowList(lv));
  assert.deepEqual(low.map((x) => x.code), ['HW-001', 'HW-002'], 'cement 30 ≤ 40, nails 0 ≤ 20');
  assert.equal(low[0].suggest, 50, 'back to twice the reorder level: 2×40 − 30');
  assert.deepEqual(plain(O.lowCsvRows(lv))[0], ['Code', 'Name', 'Unit', 'On hand', 'Reorder level', 'On order', 'Suggested order']);
});

test('a stock move from what was typed: direction and reason must agree, the sign comes from the direction', () => {
  const m = (o) => O.makeMove({ itemId: 'i1', date: '2026-11-12', by: 'e1', at: 't', ...o });
  assert.equal(m({ direction: 'in', qty: 10, kind: 'Received' }).move.qty, 10);
  assert.equal(m({ direction: 'out', qty: 4, kind: 'Used' }).move.qty, -4);
  assert.equal(m({ direction: 'out', qty: 1.5, kind: 'Damaged' }).move.qty, -1.5);
  assert.equal(m({ direction: 'adjust', qty: -2, kind: 'Count correction' }).move.qty, -2);
  assert.equal(m({ direction: 'adjust', qty: 3, kind: 'Adjustment' }).move.qty, 3);
  assert.equal(m({ direction: 'in', qty: 10, kind: 'Sold' }).ok, false, 'Sold takes stock out');
  assert.equal(m({ direction: 'out', qty: 10, kind: 'Received' }).ok, false);
  assert.equal(m({ direction: 'adjust', qty: 3, kind: 'Received' }).ok, false);
  assert.equal(m({ direction: 'in', qty: 0, kind: 'Received' }).ok, false, 'no quantity');
  assert.equal(m({ direction: 'in', qty: -5, kind: 'Received' }).ok, false, 'positive only for in and out');
  assert.equal(m({ direction: 'in', qty: 5, kind: 'Nonsense' }).ok, false);
  assert.equal(O.makeMove({ direction: 'in', qty: 5, kind: 'Received' }).ok, false, 'an item is needed');
  const r = m({ direction: 'in', qty: 5, kind: 'Received', note: 'x'.repeat(500) }).move; assert.equal(r.note.length, 200); assert.equal(r.by, 'e1'); assert.equal(r.kind, 'Received');
});

test('item history: opening stock, every move with the balance after it, in date order', () => {
  const moves = [mv('i1', -20, '2026-11-05', 'Sold'), mv('i1', 50, '2026-11-02'), mv('i2', 9, '2026-11-03'), mv('i1', -5, '2026-11-05', 'Damaged')];
  const h = plain(O.history(items[0], moves));
  assert.equal(h.opening, 100);
  assert.deepEqual(h.rows.map((r) => [r.date, r.qty, r.balance]), [['2026-11-02', 50, 150], ['2026-11-05', -20, 130], ['2026-11-05', -5, 125]]);
  assert.equal(h.onHand, 125);
  assert.equal(h.onHand, O.onHand(items[0], moves));
});

test('stock count: differences only, blanks not counted, posted as Count correction moves with one note', () => {
  const lv = plain(O.stockLevels(items, [], []));
  const plan = plain(O.countPlan(lv, { i1: '98', i2: '', i3: 10, nonexistent: '5' }));
  assert.equal(plan.lines.length, 2, 'the blank is skipped');
  assert.deepEqual(plan.differences.map((l) => [l.code, l.system, l.counted, l.diff]), [['HW-001', 100, 98, -2]]);
  const moves = plain(O.countMoves(plan, { date: '2026-11-12', note: 'Year-end count', by: 'e1', at: 't', ids }));
  assert.equal(moves.length, 1); assert.equal(moves[0].qty, -2); assert.equal(moves[0].kind, 'Count correction'); assert.equal(moves[0].note, 'Year-end count');
  assert.equal(O.countMoves(plain(O.countPlan(lv, { i1: 100 })), { date: 'd' }).length, 0, 'nothing to post when the count agrees');
});

// ---- import ----
const sheet = [
  ['Item list: Major Far East'], [],
  ['Code', 'Name', 'Unit', 'Category', 'Location', 'Opening quantity', 'Reorder level', 'Cost price', 'Selling price', 'Supplier'],
  ['HW-001', '"Cement 50kg bag"', 'bag', 'Building', 'Rack A1', '120', '40', 'RM 18.50', '24', 'Ah Seng Hardware'],
  ['“HW-002”', 'Steel nails, 3 inch', '', '', '', 60, 20, 6.2, 9.5, ''],
  ['HW-001', 'Cement again', 'bag', '', '', 5, 1, 1, 1, ''],            // a duplicate inside the file
  ['HW-009', 'Existing one', 'pcs', '', '', 1, 1, 1, 1, ''],            // already in the list
  ['HW-010', 'Bad quantity', 'pcs', '', '', 'many', 1, 1, 1, ''],
  ['HW-011', '', 'pcs', '', '', 1, 1, 1, 1, ''],
  ['', '', '', '', '', '', '', '', '', ''],
  ['HW-012', 'Negative reorder', 'pcs', '', '', 1, -3, 1, 1, ''],
  ['HW-013', 'Fine and cheap', 'kg', 'Fasteners', 'B2', '2.5', '', '', '', 'New Supplier'],
];
test('import: header row found under a title, quoted cells cleaned, RM and commas read, unit defaults to pcs', () => {
  const p = plain(O.parseItems(sheet, ['HW-009']));
  assert.equal(p.headerRow, 2);
  assert.deepEqual(p.items.map((x) => x.code), ['HW-001', 'HW-002', 'HW-013']);
  const a = p.items[0]; assert.equal(a.name, 'Cement 50kg bag'); assert.equal(a.cost, 18.5); assert.equal(a.opening, 120); assert.equal(a.supplier, 'Ah Seng Hardware'); assert.equal(a.row, 4);
  assert.equal(p.items[1].code, 'HW-002', 'curly quotes around the code are removed'); assert.equal(p.items[1].unit, 'pcs');
  assert.equal(p.items[2].opening, 2.5); assert.equal(p.items[2].reorder, 0);
});
test('import: duplicates by code are skipped (in the file and against the list), bad rows are reported by row, empty rows ignored', () => {
  const p = plain(O.parseItems(sheet, ['hw-009']));
  assert.deepEqual(p.skipped.map((x) => [x.row, x.code]), [[6, 'HW-001'], [7, 'HW-009']], 'case-insensitive');
  assert.deepEqual(p.errors.map((x) => x.row), [8, 9, 11]);
  assert.match(p.errors[0].message, /Opening quantity “many” isn’t a number/);
  assert.match(p.errors[1].message, /no name/);
  assert.match(p.errors[2].message, /Reorder level can’t be negative/);
});
test('import: other header names (Malay, SKU, UOM), a missing Code or Name column, and an empty sheet', () => {
  const m = plain(O.parseItems([['Kod', 'Nama', 'UOM', 'Kuantiti', 'Harga kos'], ['A1', 'Paku', 'kotak', '10', '3.5']]));
  assert.equal(m.items[0].code, 'A1'); assert.equal(m.items[0].unit, 'kotak'); assert.equal(m.items[0].opening, 10); assert.equal(m.items[0].cost, 3.5);
  assert.deepEqual(plain(O.parseItems([['Foo', 'Bar'], ['1', '2']]).missing), ['Code', 'Name']);
  assert.deepEqual(plain(O.parseItems([]).items), []);
  assert.deepEqual(plain(O.parseItems([['Code', 'Name'], ['A', 'B']]).items.map((x) => x.unit)), ['pcs']);
});
test('the template has the ten columns and two example rows that import cleanly', () => {
  assert.deepEqual(plain(O.TEMPLATE_HEAD), ['Code', 'Name', 'Unit', 'Category', 'Location', 'Opening quantity', 'Reorder level', 'Cost price', 'Selling price', 'Supplier']);
  const p = plain(O.parseItems([O.TEMPLATE_HEAD, ...O.TEMPLATE_ROWS]));
  assert.equal(p.items.length, 2); assert.equal(p.errors.length, 0);
});

// ---- reports ----
test('reports: stock on hand and value, and moves for a date range', () => {
  const moves = [mv('i1', -10, '2026-11-03', 'Sold'), mv('i1', 5, '2026-11-09'), mv('i2', 3, '2026-12-01')];
  const lv = plain(O.stockLevels(items, moves, []));
  const rows = plain(O.stockCsvRows(lv, () => 'S'));
  assert.equal(rows[0][5], 'On hand'); assert.equal(rows[1][0], 'HW-001'); assert.equal(rows[1][5], 95); assert.equal(rows[1][10], '1757.50');
  const mrows = plain(O.movesCsvRows(items, moves, '2026-11-01', '2026-11-30', (x) => x));
  assert.equal(mrows.length, 3, 'header and two moves in November'); assert.deepEqual(mrows[1].slice(0, 5), ['2026-11-03', 'HW-001', 'Cement 50kg', 'Sold', -10]);
});
test('the module has an empty starting shape with every list and the number counters', () => {
  const e = plain(O.emptyOps());
  ['items', 'moves', 'pos', 'products', 'batches', 'orders', 'dos', 'machines', 'maint', 'breakdowns', 'licences'].forEach((k) => assert.deepEqual(e[k], [], k));
  assert.deepEqual(e.seq, {});
});

// ---- wiring ----
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
test('the template file in docs/templates matches the app’s template (ten columns, two example rows)', () => {
  const file = read('docs/templates/inventory-items-template.csv').replace(/^﻿/, '').trim().split(/\r?\n/);
  assert.equal(file[0], O.TEMPLATE_HEAD.join(','));
  assert.equal(file.length, 3);
  assert.ok(file[1].startsWith('HW-001,Cement 50kg bag,bag,Building materials,Rack A1,120,40,18.5,24,Ah Seng Hardware'));
});
test('the switch: Inventory is on only when switched on (a company with stock data stays on unless switched off); off keeps the data', () => {
  const ops = read('js/ops.js');
  assert.match(ops, /const modOn = \(\) => st\(\)\.settings\?\.modules\?\.inventory;/);
  assert.match(ops, /const has = \(\) => modOn\(\) === true \|\| \(!!st\(\)\.ops && modOn\(\) !== false\);/);
  assert.match(ops, /function setInventory\(on\) \{[\s\S]*?inventory: !!on \};[\s\S]*?if \(on\) ops\(\);/, 'turning on creates the empty structure; turning off changes only the flag');
  assert.ok(!/function setInventory[\s\S]{0,400}(delete |= \[\]|\.filter\()/.test(ops), 'turning it off never deletes anything');
  const app = read('js/app.js');
  assert.match(app, /'mod-inventory': \(_, v\) => \{ if \(!\(can\('operations'\) && can\('settings'\)\)/, 'needs the Settings and Operations areas');
  assert.match(app, /operations: \{ label: 'Store \/ warehouse'/, 'the storekeeper role');
});
test('every change of quantity goes through a movement: no screen edits a quantity directly', () => {
  const ops = read('js/ops.js');
  assert.ok(!/\.opening\s*=\s*(?!0\b)/.test(ops.replace(/\/\/.*$/gm, '').replace(/opening: 0/g, '')), 'no assignment to an item’s opening quantity');
  assert.match(ops, /O\.makeMove\(\{ itemId: id, direction/);
  assert.match(ops, /O\.countMoves\(plan,/);
});

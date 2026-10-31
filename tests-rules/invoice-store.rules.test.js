// The real js/invoice-store.js against the emulator: every change it makes passes firestore.rules, and what the
// rules refuse comes back as a clear error. The list is reloaded from the emulator after each change, as the live
// listener in js/cloud.js does.   npm run test:rules
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDocs, collection, writeBatch, serverTimestamp } = require('firebase/firestore');

let env;
const T = 'co1';
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const today = new Date().toISOString().slice(0, 10);

// One person's app: the store with a cloud that writes to the emulator as them.
function app(uid) {
  const db = env.authenticatedContext(uid, { email: `${uid}@co1.my`, email_verified: true }).firestore();
  const state = { finance: { invoices: [], contacts: [], txns: [] } };
  // (Arrays rebuilt here: the store runs in a sandbox, and Firestore only takes this realm's arrays.)
  const forWrite = (v) => (v && v.__now ? serverTimestamp() : Array.isArray(v) ? Array.from(v, forWrite)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, forWrite(x)])) : v);
  const cloud = {
    live: true, profile: { uid },
    async invoiceWrite(ops) {
      const b = writeBatch(db);
      ops.forEach(({ op, path: p, data }) => { const ref = doc(db, `tenants/${T}/${p}`); if (op === 'delete') b.delete(ref); else if (op === 'update') b.update(ref, forWrite(data)); else b.set(ref, forWrite(data)); });
      try { await b.commit(); return { ok: true }; } catch (e) { return { error: /PERMISSION_DENIED|permission-denied/i.test(String(e.code || e.message)) ? 'changed' : 'failed' }; }
    },
  };
  const sb = { window: {}, console };
  vm.createContext(sb);
  sb.U = { today: () => today, addDays, monthKey: (d) => d.slice(0, 7) };
  for (const f of ['invoice-rules.js', 'invoice-store.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sb);
  const toasts = [];
  const ctx = { state, account: () => ({ email: `${uid}@co1.my`, name: uid }), me: () => null, fullName: () => uid, toast: (m) => toasts.push(m), commit: () => {} };
  const store = sb.window.AllurusInvoiceStore.install(ctx, () => cloud);
  // What the live listener does: the list as the server has it.
  const reload = async () => { const s = await getDocs(collection(db, `tenants/${T}/invoices`)); state.finance.invoices = s.docs.map((d) => { const x = d.data(); Object.keys(x).forEach((k) => { if (x[k]?.toMillis) x[k] = x[k].toMillis(); }); return { id: d.id, ...x }; }); };
  const audit = async () => (await getDocs(collection(db, `tenants/${T}/invoiceAudit`))).docs.map((d) => d.data().action);
  return { store, state, reload, audit, find: (id) => state.finance.invoices.find((i) => i.id === id) };
}
const draft = (o = {}) => ({ customer: 'Kedai Ali', issue: today, due: addDays(today, 30), taxRate: 8, items: [{ desc: 'Rice 5kg bag', qty: 12.5, unit: 'kg', price: 4.2 }, { desc: 'Cups', qty: 3, unit: 'pcs', price: 1 }], ...o });

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-invstore', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Co 1', status: 'active' });
    await setDoc(doc(db, 'users/fin'), { tenantId: T, roles: ['admin', 'employee'], perms: ['finance'], empId: 'e1' });
    await setDoc(doc(db, 'users/fin2'), { tenantId: T, roles: ['admin', 'employee'], perms: ['finance'], empId: 'e2' });
  });
});
test.after(async () => { await env.cleanup(); });

test('the whole life of an invoice passes the rules: draft, edits, send, part and full payment, credit note', async () => {
  const a = app('fin');
  const c = await a.store.createDraft(draft()); assert.ok(c.ok, JSON.stringify(c)); await a.reload();
  for (const name of ['Kedai Ali Sdn Bhd', 'Kedai Ali']) { const r = await a.store.saveDraft(c.id, { ...draft(), customer: name }); assert.ok(r.ok, JSON.stringify(r)); await a.reload(); }
  assert.equal(a.find(c.id).v, 3); assert.equal(a.find(c.id).status, 'Draft');
  assert.ok((await a.store.send(c.id)).ok); await a.reload();
  assert.equal(a.find(c.id).status, 'Sent');
  const locked = await a.store.saveDraft(c.id, { customer: 'X' });
  assert.equal(locked.error, 'locked');
  assert.ok((await a.store.pay(c.id, 20, today)).ok); await a.reload();
  assert.equal(a.find(c.id).status, 'Partially paid');
  const note = await a.store.issueNote({ type: 'credit', ref: c.id, no: `CN-${today.slice(0, 7).replace('-', '')}-0001`, customer: 'Kedai Ali', issue: today, due: today, items: [{ desc: 'Adjustment', qty: 1, unit: 'unit', price: 5 }], taxRate: 8, reason: 'Damaged bag' }, c.id, { adjust: -5.4 });
  assert.ok(note.ok, JSON.stringify(note)); await a.reload();
  const due = a.find(c.id); const left = Math.round((((12.5 * 4.2 + 3) * 1.08) - 5.4 - 20) * 100) / 100;
  assert.ok((await a.store.pay(c.id, left, today)).ok); await a.reload();
  assert.equal(a.find(c.id).status, 'Paid', JSON.stringify(due));
  assert.ok((await a.store.setEinvoice(c.id, { status: 'Valid' })).ok);
  assert.deepEqual((await a.audit()).sort(), ['issue', 'pay', 'pay', 'send'].sort());
});

test('void and duplicate pass the rules; a draft deletes and frees its number', async () => {
  const a = app('fin');
  const c = await a.store.createDraft(draft()); await a.reload();
  await a.store.send(c.id); await a.reload();
  assert.equal((await a.store.void(c.id, 'no')).error, 'invalid');
  assert.ok((await a.store.void(c.id, 'Wrong customer')).ok); await a.reload();
  assert.equal(a.find(c.id).status, 'Void');
  const d = await a.store.duplicate(c.id); assert.ok(d.ok, JSON.stringify(d)); await a.reload();
  const copy = a.find(d.id);
  assert.equal(copy.status, 'Draft'); assert.equal(copy.duplicatedFrom.no, a.find(c.id).no); assert.equal(copy.items[0].unit, 'kg');
  assert.ok((await a.store.remove(d.id)).ok); await a.reload();
  assert.equal(a.find(d.id), undefined);
  const again = await a.store.createDraft(draft()); assert.ok(again.ok, 'the freed number can be used again');
  assert.deepEqual((await a.audit()).sort(), ['delete', 'duplicate', 'send', 'void'].sort());
});

test('a delivery invoice, issued at delivery with cash collected, passes the rules', async () => {
  const a = app('fin');
  const inv = a.store.issueDelivered({ no: 'INV-2610-0001', customer: 'Kedai Ali', contactId: 'c1', issue: today, due: today, items: [{ desc: 'Bread', qty: 10, unit: 'pcs', price: 3 }], taxRate: 0, category: 'Product sales', einvoice: { status: 'Draft' } }, 30, today);
  await new Promise((r) => setTimeout(r, 800)); await a.reload();
  assert.equal(a.find(inv.id)?.status, 'Paid');
});

test('two people on the same draft: the out-of-date save is refused with "This invoice changed. Reload."', async () => {
  const a = app('fin'), b = app('fin2');
  const c = await a.store.createDraft(draft()); await a.reload(); await b.reload();
  assert.ok((await b.store.saveDraft(c.id, { ...draft(), customer: 'From fin2' })).ok);
  const stale = await a.store.saveDraft(c.id, { ...draft(), customer: 'From fin, out of date' });
  assert.equal(stale.error, 'changed'); assert.equal(stale.message, 'This invoice changed. Reload.');
  await a.reload(); assert.equal(a.find(c.id).customer, 'From fin2');
  assert.ok((await a.store.saveDraft(c.id, { ...draft(), customer: 'After reload' })).ok, 'after reloading, the save goes through');
});

test('sending an invoice someone else just sent is refused', async () => {
  const a = app('fin'), b = app('fin2');
  const c = await a.store.createDraft(draft()); await a.reload(); await b.reload();
  assert.ok((await b.store.send(c.id)).ok);
  assert.equal((await a.store.send(c.id)).error, 'changed');
});

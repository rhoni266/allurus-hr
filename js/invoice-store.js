// Invoice changes: the only way invoices are created or changed (Finance screens, deliveries, the e-Invoice panel).
// Every change is checked with js/invoice-rules.js first, then:
//   • demo: applied in this browser (with an audit entry in finance.invoiceAudit), and saved;
//   • cloud: one Firestore batch to tenants/{t}/invoices/{id}, with its audit entry and its number (invoiceNos).
//     firestore.rules checks the same things again, so nothing gets past the server either. A refused save means
//     someone changed the invoice first (or it was sent meanwhile): { error: 'changed' }.
// Each method returns a promise of { ok, id? } or { error, message }.
window.AllurusInvoiceStore = (function () {
  'use strict';
  const NOW = { __now: true };   // "server time" in a write; the time of the change in the demo
  const MESSAGES = {
    changed: 'This invoice changed. Reload.',
    busy: 'Already working on it.',
    offline: 'You’re offline. Try again when you’re connected.',
    failed: 'That didn’t save. Try again.',
  };

  function install(ctx, cloud) {
    const R = window.AllurusInvoiceRules;
    const fin = () => ctx.state.finance;
    const list = () => fin().invoices;
    const byId = (id) => list().find((x) => x.id === id);
    const live = () => !!(cloud() && cloud().live);
    const uid = () => cloud()?.profile?.uid || ctx.account()?.email || 'demo';
    const who = () => { const e = ctx.me && ctx.me(); return e ? ctx.fullName(e) : (ctx.account()?.name || ''); };
    const newId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const ver = (inv) => Number(inv.v) || 1;
    const stamp = (v) => ({ v, updatedBy: uid(), updatedAt: NOW });
    const fail = (error, message) => ({ error, message: message || MESSAGES[error] || error });
    const busy = new Set(), recent = new Map();
    // A copy is made once per tap: the same invoice duplicated again within 2 seconds is a double tap.
    const repeated = (key) => { if (!key.startsWith('dup:')) return false; const t = recent.get(key) || 0; recent.set(key, Date.now()); return Date.now() - t < 2000; };

    // An audit entry: who did what to which invoice, with the status before and after.
    const auditOp = (inv, action, after, extra = {}) => {
      const id = newId('a');
      return { id, op: { op: 'set', path: `invoiceAudit/${id}`, data: { action, invoiceId: inv.id, no: inv.no, before: inv.status || '', after, actorUid: uid(), actorName: who(), at: NOW, ...extra } } };
    };

    // Demo: the same writes, applied to this browser's copy.
    const time = (v) => (v && v.__now ? Date.now() : v);
    function applyLocal(ops) {
      const f = fin();
      ops.forEach(({ op, path, data }) => {
        const [coll, id] = path.split('/');
        const fixed = data ? Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, time(v)])) : null;
        if (coll === 'invoices') {
          const i = f.invoices.findIndex((x) => x.id === id);
          if (op === 'delete') { if (i >= 0) f.invoices.splice(i, 1); }
          else if (op === 'update') { if (i >= 0) Object.assign(f.invoices[i], fixed); }
          else if (i >= 0) f.invoices[i] = { id, ...fixed }; else f.invoices.push({ id, ...fixed });
        } else if (coll === 'invoiceAudit' && op === 'set') {
          f.invoiceAudit = [{ id, ...fixed }, ...(f.invoiceAudit || [])].slice(0, 500);
        }
      });
    }
    // One change, once at a time per key (a double tap does nothing the second time).
    async function run(key, ops, msg, activity) {
      if (busy.has(key) || repeated(key)) return fail('busy');
      busy.add(key);
      try {
        if (live()) {
          const r = await cloud().invoiceWrite(ops);
          if (r.error) return fail(r.error);
          if (msg) ctx.toast(msg);
          return { ok: true };
        }
        applyLocal(ops);
        ctx.commit(msg, activity);
        return { ok: true };
      } finally { busy.delete(key); }
    }

    // ---------- Drafts ----------
    function createDraft(d) {
      const errs = R.draftErrors(d); if (errs.length) return Promise.resolve(fail('invalid', errs.join('. ')));
      const id = newId('i'), no = R.nextNo(list(), 'INV', U.monthKey(d.issue));
      const doc = { type: 'invoice', no, status: 'Draft', customer: d.customer, contactId: d.contactId || '', email: d.email || '', issue: d.issue, due: d.due,
        items: d.items, taxRate: d.taxRate, notes: d.notes || '', currency: d.currency || 'MYR', paidOn: '', payments: [], einvoice: { status: 'Draft' },
        ...(d.duplicatedFrom ? { duplicatedFrom: d.duplicatedFrom } : {}), ...(d.category ? { category: d.category } : {}),
        createdBy: uid(), createdAt: NOW, ...stamp(1) };
      const ops = [{ op: 'set', path: `invoices/${id}`, data: doc }, { op: 'set', path: `invoiceNos/${no}`, data: { invoiceId: id } }];
      if (d.duplicatedFrom) { const a = auditOp({ id, no, status: '' }, 'duplicate', 'Draft', { from: d.duplicatedFrom.no }); doc.lastAuditId = a.id; ops.push(a.op); }
      rememberUnits(d.items);
      return run(d.duplicatedFrom ? `dup:${d.duplicatedFrom.id}` : `new:${no}`, ops, d.duplicatedFrom ? `Copied to ${no}, a new draft` : `${no} saved as a draft`,
        d.duplicatedFrom ? `Invoice ${d.duplicatedFrom.no} duplicated as ${no}` : `Invoice ${no} created for ${d.customer}`).then((r) => (r.ok ? { ...r, id, no } : r));
    }
    function saveDraft(id, patch) {
      const inv = byId(id); if (!inv) return Promise.resolve(fail('changed'));
      if (!R.canEdit(inv)) return Promise.resolve(fail('locked', `${inv.no} is ${inv.status.toLowerCase()} and can’t be edited. Duplicate it or issue a credit note.`));
      const next = { ...inv, ...patch }, errs = R.draftErrors(next); if (errs.length) return Promise.resolve(fail('invalid', errs.join('. ')));
      const allowed = ['customer', 'contactId', 'email', 'issue', 'due', 'items', 'taxRate', 'notes', 'currency', 'einvoice', 'category'];
      const data = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
      rememberUnits(data.items);
      return run(`inv:${id}`, [{ op: 'update', path: `invoices/${id}`, data: { ...data, ...stamp(ver(inv) + 1) } }], `${inv.no} saved`);
    }
    function remove(id) {
      const inv = byId(id); if (!inv) return Promise.resolve(fail('changed'));
      if (!R.canDelete(inv)) return Promise.resolve(fail('locked', 'Only a draft can be deleted. Void a sent invoice instead.'));
      const a = auditOp(inv, 'delete', 'Deleted');
      return run(`inv:${id}`, [{ op: 'delete', path: `invoices/${id}` }, { op: 'delete', path: `invoiceNos/${inv.no}` }, a.op], `${inv.no} deleted`, `Draft invoice ${inv.no} deleted`);
    }

    // ---------- Status changes (each one audited) ----------
    function send(id) {
      const inv = byId(id); if (!inv) return Promise.resolve(fail('changed'));
      if (!R.canSend(inv)) return Promise.resolve(fail('locked', `${inv.no} is already ${inv.status.toLowerCase()}.`));
      const errs = R.draftErrors(inv); if (errs.length) return Promise.resolve(fail('invalid', errs.join('. ')));
      const a = auditOp(inv, 'send', 'Sent');
      return run(`inv:${id}`, [{ op: 'update', path: `invoices/${id}`, data: { status: 'Sent', sentAt: NOW, sentBy: uid(), ...stamp(ver(inv) + 1), lastAuditId: a.id } }, a.op],
        `${inv.no} marked as sent. It’s now locked.`, `Invoice ${inv.no} sent to ${inv.customer}`);
    }
    function pay(id, amount, date) {
      const inv = byId(id); if (!inv) return Promise.resolve(fail('changed'));
      const r = R.pay(inv, amount, date, uid()); if (r.error) return Promise.resolve(fail('invalid', r.error));
      const a = auditOp(inv, 'pay', r.status, { amount: Number(amount) });
      return run(`inv:${id}`, [{ op: 'update', path: `invoices/${id}`, data: { status: r.status, payments: r.payments, paidOn: r.paidOn, ...stamp(ver(inv) + 1), lastAuditId: a.id } }, a.op]).then((x) => (x.ok ? { ...x, status: r.status } : x));
    }
    function voidIt(id, reason) {
      const inv = byId(id), why = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!inv) return Promise.resolve(fail('changed'));
      if (!R.canVoid(inv)) return Promise.resolve(fail('locked', (inv.payments || []).length ? 'This invoice has payments. Issue a credit or refund note instead.' : 'Only a sent invoice can be voided.'));
      if (why.length < 3) return Promise.resolve(fail('invalid', 'Give a reason for voiding'));
      const a = auditOp(inv, 'void', 'Void', { reason: why });
      return run(`inv:${id}`, [{ op: 'update', path: `invoices/${id}`, data: { status: 'Void', voidReason: why, voidedAt: NOW, voidedBy: uid(), ...stamp(ver(inv) + 1), lastAuditId: a.id } }, a.op],
        `${inv.no} voided`, `Invoice ${inv.no} voided: ${why}`);
    }
    function duplicate(id) {
      const inv = byId(id); if (!inv) return Promise.resolve(fail('changed'));
      const today = U.today(), copy = R.duplicate(inv, { id: '', no: '', today, dueDays: 30, addDays: U.addDays });
      const c = (fin().contacts || []).find((x) => x.id === inv.contactId);
      if (c && Number(c.terms) > 0) copy.due = U.addDays(today, Number(c.terms));
      return createDraft(copy);
    }

    // ---------- Notes, deliveries, e-Invoice ----------
    // A credit, debit or refund note (issued final), and its effect on the invoice it is for.
    function issueNote(note, parentId, parentPatch) {
      const parent = byId(parentId), id = newId('i'), a = auditOp({ id, no: note.no, status: '' }, 'issue', 'Issued', { type: note.type, for: parent?.no || '' });
      const doc = { ...note, status: 'Issued', paidOn: '', payments: [], einvoice: { status: 'Draft' }, createdBy: uid(), createdAt: NOW, ...stamp(1), lastAuditId: a.id };
      const ops = [{ op: 'set', path: `invoices/${id}`, data: doc }, { op: 'set', path: `invoiceNos/${note.no}`, data: { invoiceId: id } }, a.op];
      if (parent && parentPatch) ops.push({ op: 'update', path: `invoices/${parentId}`, data: { ...parentPatch, ...stamp(ver(parent) + 1) } });
      return run(`note:${parentId}`, ops).then((r) => (r.ok ? { ...r, id } : r));
    }
    // A delivery's invoice: issued (sent) at delivery, with any cash collected as a payment.
    function issueDelivered(inv, cash, date) {
      const id = newId('i'), a = auditOp({ id, no: inv.no, status: '' }, 'send', 'Sent', { source: 'delivery' });
      let doc = { ...inv, type: 'invoice', status: 'Sent', paidOn: '', payments: [], sentAt: NOW, sentBy: uid(), createdBy: uid(), createdAt: NOW, ...stamp(1), lastAuditId: a.id };
      if (cash > 0) { const r = R.pay(doc, Math.min(cash, R.totals(doc).due), date, uid()); if (!r.error) doc = { ...doc, ...r }; }
      const ops = [{ op: 'set', path: `invoices/${id}`, data: doc }, { op: 'set', path: `invoiceNos/${inv.no}`, data: { invoiceId: id } }, a.op];
      if (live()) cloud().invoiceWrite(ops).then((r) => { if (r.error) ctx.toast(`Couldn’t save invoice ${inv.no}. ${MESSAGES[r.error] || ''}`, 'error'); });
      else applyLocal(ops);
      return { id, ...doc, updatedAt: Date.now(), createdAt: Date.now(), sentAt: Date.now() };
    }
    function setEinvoice(id, einvoice) {
      const inv = byId(id); if (!inv) return Promise.resolve(fail('changed'));
      return run(`einv:${id}`, [{ op: 'update', path: `invoices/${id}`, data: { einvoice, ...stamp(ver(inv) + 1) } }]);
    }
    // The last unit used for each item, so the next invoice suggests it.
    function rememberUnits(items) { if (items) fin().unitMemo = R.rememberUnits(fin().unitMemo, items); }

    return { createDraft, saveDraft, remove, send, pay, void: voidIt, duplicate, issueNote, issueDelivered, setEinvoice, MESSAGES, live };
  }
  return { install, NOW };
})();

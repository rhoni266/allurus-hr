// Stock requests on the phone and in the admin console: Minta stok, Kelulusan stok, Serahan stok, Pulangan, Permintaan saya, Barang dipegang, and
// Settings → Inventori → Kebenaran. Rules are in js/stock-rules.js (AllurusStockRules) and firestore.rules (one document per request).
// In the cloud each step is one batch (the request + its audit entry), so the server refuses anything out of turn. In the demo it is local.
window.AllurusStockReq = (function () {
  'use strict';
  const R = window.AllurusStockRules;
  const NOW = { __now: true };
  // Words, English and Bahasa Malaysia. The staff phone follows the person's own language (ctx.lang()).
  const TXT = {
    en: { ask: 'Request stock', mine: 'My requests', held: 'Items I hold', approve: 'Stock approvals', hand: 'Stock handover', back: 'Returns', requests: 'Stock requests', empty: 'Nothing here.',
      item: 'Item', qty: 'Quantity', reason: 'Reason', note: 'Note', photo: 'Photo (optional)', send: 'Send request', available: 'available', yes: 'Approve', no: 'Reject', why: 'Why', handBtn: 'Hand over', takePhoto: 'Photo of the items handed over (required)',
      got: 'Received', cancel: 'Cancel', due: 'Return by', who: 'Who', sent: 'Request sent', none: 'No item is open for you to request yet. Ask the admin.',
      pill: { waiting: 'Waiting', ready: 'Ready to collect', handed: 'Handed over', rejected: 'Rejected', cancelled: 'Cancelled', toreturn: 'To return', late: 'Late', returned: 'Returned', lost: 'Lost' },
      cond: { Baik: 'Good', Rosak: 'Damaged', Hilang: 'Lost' }, confirmRecv: 'Confirm you received it' },
    bm: { ask: 'Minta stok', mine: 'Permintaan saya', held: 'Barang dipegang', approve: 'Kelulusan stok', hand: 'Serahan stok', back: 'Pulangan', requests: 'Permintaan stok', empty: 'Tiada.',
      item: 'Barang', qty: 'Kuantiti', reason: 'Sebab', note: 'Catatan', photo: 'Gambar (pilihan)', send: 'Hantar permintaan', available: 'ada', yes: 'Lulus', no: 'Tolak', why: 'Sebab', handBtn: 'Serah', takePhoto: 'Gambar barang yang diserahkan (wajib)',
      got: 'Terima', cancel: 'Batal', due: 'Pulang sebelum', who: 'Siapa', sent: 'Permintaan dihantar', none: 'Belum ada barang yang boleh anda minta. Tanya admin.',
      pill: { waiting: 'Menunggu', ready: 'Sedia diambil', handed: 'Diserahkan', rejected: 'Ditolak', cancelled: 'Dibatalkan', toreturn: 'Perlu dipulang', late: 'Lewat', returned: 'Dipulangkan', lost: 'Hilang' },
      cond: { Baik: 'Baik', Rosak: 'Rosak', Hilang: 'Hilang' }, confirmRecv: 'Sahkan anda sudah terima' },
  };
  const PILL_TONE = { waiting: 'warn', ready: 'info', handed: 'ok', rejected: 'bad', cancelled: '', toreturn: 'info', late: 'bad', returned: 'ok', lost: 'bad' };

  function install(ctx, h) {
    const { ops, item, actor, opsPeople, notify, first, qty, T, esc, icon, emp } = h;
    const st = () => ctx.state;
    const lang = () => (ctx.role() === 'employee' && ctx.lang && ctx.lang() === 'bm' ? 'bm' : 'en');
    const t = () => TXT[lang()];
    const cloud = () => { const c = ctx.fire?.(); return c && c.live ? c : null; };
    const reqs = () => { if (!Array.isArray(st().stockRequests)) st().stockRequests = []; return st().stockRequests; };
    const me = () => ctx.me();
    const employees = () => ctx.activeEmployees();
    const settings = () => ({ approverRule: { depts: [], roles: [], people: [] }, keeperRule: { depts: [], roles: [], people: [] }, autoCancelDays: 2, ...(st().settings?.stock || {}) });
    // Who is appointed: from the stored document in the cloud (what the rules read), worked out here in the demo.
    const roles = () => (cloud() || st().stockRoles?.approvers ? { approvers: [], keepers: [], autoCancelDays: 2, ...(st().stockRoles || {}) } : R.rolesDoc(settings(), employees()));
    const isApprover = () => !!me() && roles().approvers.includes(me().id);
    const isKeeper = () => !!me() && roles().keepers.includes(me().id);
    const days = () => roles().autoCancelDays || 2;
    // The items: in the cloud the catalog (no costs) that staff may read; in the demo built from the stock list.
    const baseOf = (it) => ctx.opsBase ? ctx.opsBase(it) : 0;
    const catalog = () => (cloud() || (st().stockCatalog || []).length ? (st().stockCatalog || []) : (ops().items || []).map((i) => R.catalogEntry(i, h.baseOf(i), employees())));
    const entry = (id) => catalog().find((c) => c.id === id);
    const avail = (id) => R.available(entry(id)?.base ?? 0, reqs(), id);
    const iso = () => new Date().toISOString();
    const todayStr = () => T();
    const pill = (r) => { const k = R.pillOf(r, todayStr()); return `<span class="pill ${PILL_TONE[k] || ''}">${esc(t().pill[k])}</span>`; };
    const who = (r) => ctx.fullName(emp(r.empId)) || '—';

    // ---------- Writing: one batch in the cloud (request + audit), local in the demo ----------
    const FIELDS = { approve: ['status', 'approvedQty', 'decidedBy', 'decidedAt', 'decisionNote'], reject: ['status', 'decidedBy', 'decidedAt', 'decisionNote'], hand: ['status', 'handedQty', 'handedBy', 'handedAt', 'handPhoto'],
      receive: ['receivedAt'], return: ['status', 'condition', 'returnedQty', 'returnedBy', 'returnedAt', 'returnPhoto', 'lost'], cancel: ['status', 'cancelledAt', 'cancelNote'], expire: ['status', 'cancelledAt', 'cancelNote'] };
    const TIME = new Set(['decidedAt', 'handedAt', 'returnedAt', 'receivedAt', 'cancelledAt']);
    const uid = () => cloud()?.profile?.uid || '';
    async function save(action, before, after, created) {
      const c = cloud();
      if (!c) { const i = reqs().findIndex((x) => x.id === after.id); if (i < 0) reqs().push(after); else reqs()[i] = after; ctx.log?.(`Stock request ${after.no}: ${action}`); return { ok: true }; }
      const v = (Number(before?.v) || 0) + 1, local = { ...after, v };
      const audit = { op: 'set', path: `stockAudit/${after.id}~${v}`, data: { actorUid: uid(), actor: actor(), requestId: after.id, action, at: NOW } };
      let main;
      if (created) {
        const { id, ...rest } = local; main = { op: 'set', path: `stockRequests/${after.id}`, data: { ...rest, createdBy: uid(), createdAt: NOW, updatedBy: uid(), updatedAt: NOW } };
      } else {
        const data = Object.fromEntries(FIELDS[action].map((k) => [k, TIME.has(k) ? NOW : (after[k] ?? null)]));
        main = { op: 'update', path: `stockRequests/${after.id}`, data: { ...data, v, updatedBy: uid(), updatedAt: NOW } };
      }
      const res = await c.recordWrite([main, audit]);
      if (res.error) { ctx.toast(res.error === 'changed' ? 'That was changed or is not yours to do. Reload.' : 'That didn’t save. Try again.', 'error'); return res; }
      const i = reqs().findIndex((x) => x.id === after.id); if (i < 0) reqs().push(local); else reqs()[i] = local;
      return { ok: true };
    }
    const go = (fn) => { fn().catch((e) => ctx.toast(e.message || 'That didn’t save. Try again.', 'error')); };
    const done = (msg) => { ctx.closeOverlay?.(); ctx.save?.(); ctx.render(); if (msg) ctx.toast(msg); };
    const readPhoto = (input, hint) => { let data = null; input.addEventListener('change', async (ev) => { const f = ev.target.files?.[0]; if (!f) return; try { data = (await ctx.leave.readAttachment(f)).data; if (hint) hint.textContent = '✓'; } catch (e) { ctx.toast(e.message, 'error'); } }); return () => data; };
    const nextNo = () => { const d = todayStr(), n = reqs().filter((r) => String(R.when(r.at)).slice(0, 10) === d).length + 1; return R.no(d, n); };
    const people = (ids) => [...new Set(ids)].filter(Boolean);

    // ---------- Minta stok ----------
    function askModal(itemId) {
      const e = me(), mineItems = catalog().filter((c) => (c.allowed || []).includes(e?.id));
      if (!mineItems.length) { ctx.openModal({ title: t().ask, submit: null, body: `<p class="muted">${esc(t().none)}</p>` }); return; }
      ctx.openModal({
        title: t().ask, submit: t().send,
        body: `<div class="form-grid"><div class="field full"><label for="sq-i">${esc(t().item)}</label><select class="select" id="sq-i" name="itemId" required><option value="">—</option>${mineItems.map((c) => `<option value="${esc(c.id)}" ${c.id === itemId ? 'selected' : ''}>${esc(c.name)} (${qty(avail(c.id))} ${esc(c.unit)} ${esc(t().available)})</option>`).join('')}</select></div>
          <div class="field"><label for="sq-q">${esc(t().qty)}</label><input class="input input-lg num" id="sq-q" name="qty" type="number" min="0" step="0.001" inputmode="decimal" required></div>
          <div class="field"><label for="sq-r">${esc(t().reason)}</label><select class="select" id="sq-r" name="reason">${R.REASONS.map((x) => `<option>${esc(x)}</option>`).join('')}</select></div>
          <div class="field full"><label for="sq-n">${esc(t().note)}</label><input class="input" id="sq-n" name="note" maxlength="200"></div>
          <div class="field full"><label for="sq-p">${esc(t().photo)}</label><input class="input" id="sq-p" type="file" accept="image/*" capture="environment"><span class="field-hint" id="sq-ph"></span></div></div>`,
        onSubmit(d) {
          const en = entry(d.itemId), r = R.make({ entry: en, qty: Number(d.qty), reason: d.reason, note: d.note, photo: photo(), emp: { id: e.id, dept: e.dept, role: e.role }, by: actor(), at: iso(), id: h.uid('sq'), no: nextNo() });
          if (!r.ok) { ctx.toast(r.error, 'error'); return false; }
          go(async () => { const res = await save('ask', null, r.request, true); if (!res.ok) return;
          notify('stock.ask', { no: r.request.no, qty: qty(r.request.qty, r.request.unit), item: r.request.itemName.toLowerCase(), who: ctx.fullName(emp(e.id)), href: '#my-stock' }, people(roles().approvers).filter((x) => x !== e.id), { from: e.id });
          done(t().sent);});
        },
      });
      const photo = readPhoto(ctx.$('#sq-p'), ctx.$('#sq-ph'));
    }

    // ---------- Permintaan saya + Barang dipegang ----------
    const row = (r, right = '') => `<li class="so-ticket"><div class="so-top"><strong class="ticket-id">${esc(r.no)}</strong>${pill(r)}</div>
      <div class="so-what"><b>${qty(r.status === 'Diluluskan' ? r.approvedQty : r.status === 'Diserahkan' || r.status === 'Dipulangkan' ? r.handedQty : r.qty)} ${esc(r.unit)}</b> ${esc(r.itemName)}</div>
      <div class="person-sub">${esc(who(r))} · ${esc(U.fmtDate(String(R.when(r.at)).slice(0, 10), { day: 'numeric', month: 'short' }))}${r.decisionNote ? ` · “${esc(r.decisionNote)}”` : ''}${R.dueOn(r) && r.status === 'Diserahkan' ? ` · ${esc(t().due)} ${esc(R.dueOn(r))}` : ''}</div>${right}</li>`;
    function mineModal() {
      const e = me(), mine = reqs().filter((r) => r.empId === e.id).sort((a, b) => String(R.when(b.at)).localeCompare(String(R.when(a.at))));
      const heldList = R.held(reqs(), e.id), acts = (r) => {
        const b = [];
        if (r.status === 'Diserahkan' && !r.receivedAt) b.push(`<button class="btn btn-sm btn-primary" data-act="sr-receive" data-id="${r.id}">${esc(t().got)}</button>`);
        if (r.status === 'Diminta' || r.status === 'Diluluskan') b.push(`<button class="btn btn-sm" data-act="sr-cancel" data-id="${r.id}">${esc(t().cancel)}</button>`);
        return b.length ? `<div class="row-actions so-acts">${b.join('')}</div>` : '';
      };
      ctx.openModal({ title: t().mine, submit: null, body: `${heldList.length ? `<h3 class="lv-h">${esc(t().held)}</h3><ul class="so-list">${heldList.map((r) => row(r)).join('')}</ul>` : ''}<h3 class="lv-h">${esc(t().mine)}</h3>${mine.length ? `<ul class="so-list">${mine.map((r) => row(r, acts(r))).join('')}</ul>` : `<p class="muted">${esc(t().empty)}</p>`}` });
    }
    async function receive(id) { const r = reqs().find((x) => x.id === id), x = R.receive(r, { by: me().id, at: iso() }); if (!x.ok) { ctx.toast(x.error, 'error'); return; } if ((await save('receive', r, x.request)).ok) { notify('stock.received', { no: r.no, who: ctx.fullName(emp(me().id)), item: r.itemName.toLowerCase(), href: '#ops-stock' }, people(opsPeople()), { from: me().id }); done(); mineModal(); } }
    async function cancelReq(id) { const r = reqs().find((x) => x.id === id), x = R.cancel(r, { by: me().id, at: iso() }); if (!x.ok) { ctx.toast(x.error, 'error'); return; } if ((await save('cancel', r, x.request)).ok) { done(); mineModal(); } }

    // ---------- Kelulusan stok (the approver) ----------
    const toApprove = () => reqs().filter((r) => r.status === 'Diminta' && r.empId !== me()?.id);
    function approveModal() {
      const list = toApprove(), pic = (r) => (r.photo ? `<img src="${r.photo}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;margin-top:6px">` : '');
      ctx.openModal({ title: t().approve, submit: null, body: list.length ? `<ul class="so-list">${list.map((r) => `<li class="so-ticket"><div class="so-top"><strong>${esc(who(r))}</strong>${pill(r)}</div><div class="so-what"><b>${qty(r.qty)} ${esc(r.unit)}</b> ${esc(r.itemName)} <span class="faint">· ${esc(r.reason)}</span></div>
        <div class="person-sub">${esc(ctx.dept ? (ctx.dept(emp(r.empId)?.dept)?.name || '') : '')} · ${qty(avail(r.itemId))} ${esc(r.unit)} ${esc(t().available)}${r.note ? ` · “${esc(r.note)}”` : ''}</div>${pic(r)}
        <div class="so-acts"><input class="input num" id="ap-q-${r.id}" type="number" min="0" step="0.001" value="${r.qty}" style="max-width:96px" aria-label="${esc(t().qty)}"><button class="btn btn-sm btn-primary" data-act="sr-approve" data-id="${r.id}">${esc(t().yes)}</button><button class="btn btn-sm" data-act="sr-reject" data-id="${r.id}">${esc(t().no)}</button></div></li>`).join('')}</ul>` : `<p class="muted">${esc(t().empty)}</p>` });
    }
    async function approve(id) {
      const r = reqs().find((x) => x.id === id), q = ctx.$(`#ap-q-${id}`)?.value;
      const x = R.decide(r, 'approve', { by: me().id, qty: q, availableQty: avail(r.itemId), at: iso() }); if (!x.ok) { ctx.toast(x.error, 'error'); return; }
      if (!(await save('approve', r, x.request)).ok) return;
      notify('stock.approved', { no: r.no, qty: qty(x.request.approvedQty, r.unit), item: r.itemName.toLowerCase(), href: '#my-stock' }, [r.empId], { from: me().id });
      notify('stock.ready', { no: r.no, qty: qty(x.request.approvedQty, r.unit), item: r.itemName.toLowerCase(), who: who(r), href: '#my-stock' }, people(roles().keepers).filter((k) => k !== r.empId), { from: me().id });
      done(); approveModal();
    }
    function rejectAsk(id) {
      ctx.openModal({ title: t().no, submit: t().no, body: `<div class="field"><label for="rj-w">${esc(t().why)}</label><input class="input" id="rj-w" name="note" required maxlength="200" autofocus></div>`,
        onSubmit(d) {
          const r = reqs().find((x) => x.id === id), x = R.decide(r, 'reject', { by: me().id, note: d.note, at: iso() }); if (!x.ok) { ctx.toast(x.error, 'error'); return false; }
          go(async () => { if (!(await save('reject', r, x.request)).ok) return;
          notify('stock.rejected', { no: r.no, item: r.itemName.toLowerCase(), note: x.request.decisionNote, href: '#my-stock' }, [r.empId], { from: me().id }); done(); approveModal();});
        } });
    }

    // ---------- Serahan stok + Pulangan (the storekeeper) ----------
    const toHand = () => reqs().filter((r) => r.status === 'Diluluskan' && r.empId !== me()?.id);
    const toTake = () => reqs().filter((r) => r.status === 'Diserahkan' && r.returnable);
    function handModal() {
      const a = toHand(), b = toTake();
      ctx.openModal({ title: t().hand, submit: null, body: `${a.length ? `<ul class="so-list">${a.map((r) => row(r, `<div class="so-acts"><button class="btn btn-sm btn-primary" data-act="sr-hand" data-id="${r.id}">${esc(t().handBtn)}</button></div>`)).join('')}</ul>` : `<p class="muted">${esc(t().empty)}</p>`}
        <h3 class="lv-h">${esc(t().back)}</h3>${b.length ? `<ul class="so-list">${b.map((r) => row(r, `<div class="so-acts"><button class="btn btn-sm btn-primary" data-act="sr-back" data-id="${r.id}">${esc(t().back)}</button></div>`)).join('')}</ul>` : `<p class="muted">${esc(t().empty)}</p>`}` });
    }
    function handAsk(id) {
      const r = reqs().find((x) => x.id === id);
      ctx.openModal({ title: `${t().handBtn} · ${r.itemName}`, submit: t().handBtn,
        body: `<div class="form-grid"><div class="field"><label for="hd-q">${esc(t().qty)} (${esc(r.unit)})</label><input class="input input-lg num" id="hd-q" name="qty" type="number" min="0" step="0.001" value="${r.approvedQty}" required></div>
          <div class="field full"><label for="hd-p">${esc(t().takePhoto)}</label><input class="input" id="hd-p" type="file" accept="image/*" capture="environment" required><span class="field-hint" id="hd-ph"></span></div></div>`,
        onSubmit(d) {
          const x = R.handOver(r, { by: me().id, qty: d.qty, photo: photo(), at: iso() }); if (!x.ok) { ctx.toast(x.error, 'error'); return false; }
          go(async () => { if (!(await save('hand', r, x.request)).ok) return;
          const names = r.itemName.toLowerCase();
          notify('stock.handed', { no: r.no, qty: qty(x.request.handedQty, r.unit), item: names, href: '#my-stock' }, [r.empId], { from: me().id });
          notify('stock.handedAdmin', { no: r.no, qty: qty(x.request.handedQty, r.unit), item: names, who: who(r), by: ctx.fullName(emp(me().id)), href: '#ops-stock' }, people(opsPeople()).filter((o) => o !== me().id), { from: me().id });
          const it = item(r.itemId), left = it ? R.onHand(entry(r.itemId)?.base ?? 0, reqs(), r.itemId) : null;
          if (it && left != null && left <= (Number(it.reorder) || 0) && it.reorder > 0) notify('stock.low', { item: it.name, left: qty(left, it.unit), href: '#ops-stock' }, people(opsPeople()), { from: me().id });
          done(); handModal();});
        } });
      const photo = readPhoto(ctx.$('#hd-p'), ctx.$('#hd-ph'));
    }
    function backAsk(id) {
      const r = reqs().find((x) => x.id === id);
      ctx.openModal({ title: `${t().back} · ${r.itemName}`, submit: t().back,
        body: `<div class="form-grid"><div class="field full"><label for="bk-c">Baik / Rosak / Hilang</label><select class="select" id="bk-c" name="condition">${R.CONDITIONS.map((c) => `<option value="${c}">${esc(t().cond[c])}</option>`).join('')}</select></div>
          <div class="field"><label for="bk-q">${esc(t().qty)} (${esc(r.unit)})</label><input class="input num" id="bk-q" name="qty" type="number" min="0" step="0.001" value="${r.handedQty}"></div>
          <div class="field full"><label for="bk-p">${esc(t().photo)}</label><input class="input" id="bk-p" type="file" accept="image/*" capture="environment"><span class="field-hint" id="bk-ph"></span></div></div>`,
        onSubmit(d) {
          const x = R.giveBack(r, { by: me().id, condition: d.condition, qty: d.qty, photo: photo() || '', at: iso() }); if (!x.ok) { ctx.toast(x.error, 'error'); return false; }
          go(async () => { if (!(await save('return', r, x.request)).ok) return;
          if (x.request.lost) notify('stock.lost', { no: r.no, item: r.itemName.toLowerCase(), who: who(r), href: '#ops-stock' }, people(opsPeople()), { from: me().id });
          done(); handModal();});
        } });
      const photo = readPhoto(ctx.$('#bk-p'), ctx.$('#bk-ph'));
    }

    // ---------- Time: cancel what nobody collected, remind about what is late ----------
    let sweeping = false;
    async function sweep() {
      if (sweeping || !me() || !(isApprover() || isKeeper() || ctx.can('operations'))) return;
      const old = R.expired(reqs(), iso(), days()); if (!old.length) return;
      sweeping = true;
      try {
        for (const r of old) { const x = R.cancel(r, { auto: true, at: iso() }); if (x.ok && (await save('expire', r, x.request)).ok) notify('stock.expired', { no: r.no, item: r.itemName.toLowerCase(), href: '#my-stock' }, [r.empId], { from: me().id }); }
        ctx.save?.(); ctx.render();
      } finally { sweeping = false; }
    }
    const lateList = () => reqs().filter((r) => R.isLate(r, todayStr()));

    // ---------- What goes on a person's home ----------
    const count = (n) => (n ? ` (${n})` : '');
    function homeBits(kind) {
      const e = me(); if (!e) return '';
      setTimeout(sweep, 0);
      const can = catalog().some((c) => (c.allowed || []).includes(e.id));
      const mine = reqs().filter((r) => r.empId === e.id), open = mine.filter((r) => ['Diminta', 'Diluluskan', 'Diserahkan'].includes(r.status) && !(r.status === 'Diserahkan' && !r.returnable && r.receivedAt)).length;
      const wide = kind === 'simple' ? ' ss-wide' : '', big = (act, ic, label, primary) => `<button type="button" class="btn${primary ? ' btn-primary' : ''}${wide}" data-act="${act}">${icon(ic)}${esc(label)}</button>`;
      const bits = [
        can ? big('sr-ask', 'box', t().ask, true) : '',
        mine.length ? big('sr-mine', 'list', `${t().mine}${count(open)}`, false) : '',
        isApprover() ? big('sr-approvals', 'check', `${t().approve}${count(toApprove().length)}`, toApprove().length > 0) : '',
        isKeeper() ? big('sr-handover', 'box', `${t().hand}${count(toHand().length + toTake().length)}`, toHand().length > 0) : '',
      ].filter(Boolean);
      return bits.join('');
    }
    const pendingCount = () => reqs().filter((r) => r.status === 'Diminta').length;

    // ---------- Admin: all requests, with filters ----------
    const af = { status: '', q: '', dept: '' };
    function adminList() {
      const all = [...reqs()].sort((a, b) => (a.status === 'Diminta' ? 0 : 1) - (b.status === 'Diminta' ? 0 : 1) || String(R.when(b.at)).localeCompare(String(R.when(a.at))));
      const stats = ['', 'Diminta', 'Diluluskan', 'Diserahkan', 'Dipulangkan', 'Ditolak', 'Dibatalkan'];
      const list = all.filter((r) => (!af.status || r.status === af.status) && (!af.q || `${r.no} ${r.itemName} ${who(r)}`.toLowerCase().includes(af.q.toLowerCase())) && (!af.dept || r.dept === af.dept));
      const depts = [...new Set(all.map((r) => r.dept).filter(Boolean))];
      const bits = homeBits('admin');
      return `${bits ? `<div class="actions" style="margin:0 0 10px;flex-wrap:wrap">${bits}</div>` : ''}<div class="inv-filters"><input class="input" id="sr-q" type="search" placeholder="Search person, item, number" value="${esc(af.q)}"><select class="select" id="sr-st" aria-label="Status">${stats.map((s) => `<option value="${s}" ${af.status === s ? 'selected' : ''}>${s || 'All statuses'}</option>`).join('')}</select>${depts.length ? `<select class="select" id="sr-dp" aria-label="Department"><option value="">All departments</option>${depts.map((d) => `<option value="${esc(d)}" ${af.dept === d ? 'selected' : ''}>${esc(ctx.dept?.(d)?.name || d)}</option>`).join('')}</select>` : ''}</div>
        ${list.length ? `<div class="card"><ul class="so-list">${list.map((r) => row(r, `${r.handPhoto ? `<div class="so-acts"><button class="btn btn-sm btn-ghost" data-act="sr-photo" data-id="${r.id}">Photo</button></div>` : ''}${r.lost ? '<div class="person-sub" style="color:var(--bad)">Lost: flagged for the admin.</div>' : ''}`)).join('')}</ul></div>` : `<div class="card"><div class="empty"><strong>No stock requests</strong>Requests from staff show here.</div></div>`}`;
    }
    function bindAdmin() {
      const rerender = () => ctx.render();
      ctx.$('#sr-q')?.addEventListener('change', (e) => { af.q = e.target.value; rerender(); });
      ctx.$('#sr-st')?.addEventListener('change', (e) => { af.status = e.target.value; rerender(); });
      ctx.$('#sr-dp')?.addEventListener('change', (e) => { af.dept = e.target.value; rerender(); });
    }

    // ---------- Settings → Inventori → Kebenaran ----------
    function settingsCard() {
      const s = settings(), r = roles(), nm = (ids) => ids.map((i) => first(i)).join(', ') || '—';
      const rule = (x) => [...(x.depts || []).map((d) => ctx.dept?.(d)?.name || d), ...(x.roles || []), ...(x.people || []).map(first)].join(', ') || 'Nobody yet';
      return `<div class="card"><div class="card-head"><h3>Inventori · Kebenaran</h3></div>
        <p class="field-hint">Appoint by department, by job title or by person. Anyone can have both roles; nobody can approve or hand over their own request.</p>
        <div class="field"><label>Pelulus (approver)</label><div class="person-sub">${esc(rule(s.approverRule))}. Now: ${esc(nm(r.approvers))}</div><button class="btn btn-sm" data-act="sr-appoint" data-v="approverRule">Change</button></div>
        <div class="field"><label>Penjaga stor (storekeeper)</label><div class="person-sub">${esc(rule(s.keeperRule))}. Now: ${esc(nm(r.keepers))}</div><button class="btn btn-sm" data-act="sr-appoint" data-v="keeperRule">Change</button></div>
        <div class="field"><label>Cancel an approved request not collected after (days)</label><div class="person-sub">${s.autoCancelDays} days</div><button class="btn btn-sm" data-act="sr-days">Change</button></div></div>`;
    }
    function appointModal(which) {
      const s = settings(), x = s[which] || { depts: [], roles: [], people: [] }, deps = st().departments || [];
      const title = which === 'approverRule' ? 'Pelulus (approver)' : 'Penjaga stor (storekeeper)';
      ctx.openModal({ title, submit: 'Save',
        body: `<div class="form-grid"><div class="field full"><span class="label-like">Departments</span>${deps.map((d) => `<label class="check"><input type="checkbox" name="dept" value="${esc(d.id)}" ${(x.depts || []).includes(d.id) ? 'checked' : ''}><span>${esc(d.name)}</span></label>`).join('') || '<span class="faint">No departments.</span>'}</div>
          <div class="field full"><label for="ap-r">Job titles (comma separated)</label><input class="input" id="ap-r" name="roles" value="${esc((x.roles || []).join(', '))}" placeholder="Storekeeper, Supervisor"></div>
          <div class="field full"><span class="label-like">People</span>${employees().map((e) => `<label class="check"><input type="checkbox" name="person" value="${esc(e.id)}" ${(x.people || []).includes(e.id) ? 'checked' : ''}><span>${esc(ctx.fullName(e))}</span></label>`).join('')}</div></div>`,
        onSubmit(d) {
          const picks = (n) => ctx.$$(`.modal input[name=${n}]:checked`).map((i) => i.value);
          st().settings.stock = { ...settings(), [which]: { depts: picks('dept'), roles: String(d.roles || '').split(',').map((v) => v.trim()).filter(Boolean), people: picks('person') } };
          ctx.commit('Appointment saved', `Stock ${which === 'approverRule' ? 'approvers' : 'storekeepers'} changed`); syncSoon();
        } });
    }
    function daysModal() {
      ctx.openModal({ title: 'Not collected', submit: 'Save', body: `<div class="field"><label for="dy">Days</label><input class="input num" id="dy" name="days" type="number" min="1" max="30" value="${settings().autoCancelDays}"></div>`,
        onSubmit(d) { st().settings.stock = { ...settings(), autoCancelDays: Math.max(1, Math.min(30, Math.round(Number(d.days) || 2))) }; ctx.commit('Saved'); syncSoon(); } });
    }

    // ---------- Keeping the appointments and the catalog up to date (admins with the Operations area, cloud only) ----------
    let timer = null;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    function syncSoon() { clearTimeout(timer); timer = setTimeout(sync, 600); }
    async function sync() {
      const c = cloud(); if (!c || !ctx.can('operations')) return;
      const want = R.rolesDoc(settings(), employees()), have = st().stockRoles || {};
      const wantRoles = { approverRule: want.approverRule, keeperRule: want.keeperRule, approvers: want.approvers, keepers: want.keepers, autoCancelDays: want.autoCancelDays };
      const wr = [];
      if (!same(wantRoles, { approverRule: have.approverRule, keeperRule: have.keeperRule, approvers: have.approvers, keepers: have.keepers, autoCancelDays: have.autoCancelDays })) wr.push({ op: 'set', path: 'stockRoles/current', data: wantRoles });
      const haveCat = new Map((st().stockCatalog || []).map((x) => [x.id, x]));
      (ops().items || []).forEach((i) => {
        const e = R.catalogEntry(i, h.baseOf(i), employees()), old = haveCat.get(i.id), strip = ({ id, ...rest }) => rest;
        if (!old || !same(strip(e), strip({ ...old, id: i.id }))) wr.push({ op: 'set', path: `stockCatalog/${i.id}`, data: strip(e) });
      });
      if (!wr.length) return;
      const res = await c.recordWrite(wr);
      if (!res.error) { wr.forEach((w) => { if (w.path === 'stockRoles/current') st().stockRoles = w.data; else { const id = w.path.split('/')[1], list = st().stockCatalog || (st().stockCatalog = []), i = list.findIndex((x) => x.id === id); const row2 = { id, ...w.data }; if (i < 0) list.push(row2); else list[i] = row2; } }); }
    }

    // ---------- Old "Minta stok" tickets (ops.stockOuts) become requests in status Diminta ----------
    async function migrate() {
      const old = (ops().stockOuts || []).filter((x) => !x.moved); if (!old.length || !ctx.can('operations')) return;
      for (const tk of old) {
        const rq = R.fromTicket(tk, ops().items); rq.id = tk.id; rq.migrated = true; rq.v = 0;
        if (reqs().some((x) => x.id === rq.id)) { tk.moved = true; continue; }
        if ((await save('ask', null, rq, true)).ok) tk.moved = true;
      }
      ctx.save?.();
    }

    const actions = {
      'sr-ask': (id) => askModal(id), 'sr-mine': () => mineModal(), 'sr-approvals': () => approveModal(), 'sr-handover': () => handModal(),
      'sr-receive': (id) => receive(id), 'sr-cancel': (id) => cancelReq(id), 'sr-approve': (id) => approve(id), 'sr-reject': (id) => rejectAsk(id),
      'sr-hand': (id) => handAsk(id), 'sr-back': (id) => backAsk(id), 'sr-appoint': (_, v) => appointModal(v), 'sr-days': () => daysModal(),
      'sr-photo': (id) => { const r = reqs().find((x) => x.id === id); ctx.openModal({ title: r.no, submit: null, body: `<img src="${r.handPhoto}" alt="" style="width:100%;border-radius:12px">` }); },
    };
    return { actions, homeBits, adminList, bindAdmin, settingsCard, sweep, sync: syncSoon, migrate, isApprover, isKeeper, pendingCount, toApprove, toHand, toTake, lateList, askModal, catalog, reqs, roles, count: () => ({ approve: toApprove().length, hand: toHand().length + toTake().length }) };
  }
  return { install, TXT };
})();

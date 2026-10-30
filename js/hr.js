// HR admin tools: the employee file (personal details, education, employment and career history, documents,
// assets), personal-detail change requests, onboarding and offboarding checklists, the asset register with staff
// loans and insurance, the org chart, and letters from templates. The rules live in js/hr-rules.js (AllurusHRRules).
window.AllurusHR = (function () {
  'use strict';
  const H = window.AllurusHRRules;
  let ctx = null;
  const st = () => ctx.state;
  const esc = (s) => ctx.esc(s);
  const icon = (n) => ctx.icon(n);
  const T = () => U.today();
  const cfg = () => st().settings.hr;
  const arr = (k) => (st()[k] = st()[k] || []);
  const emp = (id) => ctx.emp(id);
  const nameOf = (id) => (emp(id) ? ctx.fullName(emp(id)) : '—');
  const firstOf = (id) => emp(id)?.first || 'HR';
  const fmt = (d, o = { day: 'numeric', month: 'short', year: 'numeric' }) => (d ? U.fmtDate(d, o) : '—');
  // Letters use the Malaysian long date: 1 November 2026.
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const long = (d) => (d ? `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : '');
  const hrId = () => st().settings.leave?.hr || 'e1';
  const actor = () => (ctx.role() === 'admin' ? ctx.account()?.empId || hrId() : ctx.me()?.id);
  const notify = (type, data, to, opts) => ctx.notify?.event(type, data, to, opts);
  const deptName = (id) => ctx.dept(id)?.name || '';
  const ui = { tab: 'onboarding', assetTab: 'assets', orgDept: 'all', assetQ: '' };
  const left = (d) => U.daysBetween ? U.daysBetween(T(), d) : Math.round((U.parse(d) - U.parse(T())) / 864e5);
  const expiryPill = (d) => { if (!d) return '<span class="faint">No expiry</span>'; const n = left(d); return `<span class="pill ${n < 0 ? 'bad' : n <= 60 ? 'warn' : ''}">${n < 0 ? `Expired ${fmt(d)}` : `Expires ${fmt(d)}`}</span>`; };
  const reopen = (fn) => setTimeout(fn, 0);

  // ---------- Employee record ----------
  const docsOf = (empId) => arr('documents').filter((d) => d.empId === empId).sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  const assetsOf = (empId) => arr('assets').filter((a) => a.holder === empId);
  const loansOf = (empId) => arr('loans').filter((l) => l.empId === empId);
  const policiesOf = (empId) => arr('insurance').filter((p) => p.covers === 'all' || (p.covers || []).includes(empId));
  const listsOf = (empId) => arr('checklists').filter((l) => l.empId === empId);
  function addCareer(empId, entries) {
    const e = emp(empId); if (!e || !entries.length) return;
    e.career = [...(e.career || []), ...entries.map((x) => ({ id: U.uid('cr'), by: actor() || '', ...x }))];
  }
  // Called by app.js after the employee form saves.
  function onCreated(e) {
    addCareer(e.id, H.careerChanges(null, e, T(), { deptName }));
    startChecklist(e.id, 'onboarding', e.start || T());
  }
  function afterEdit(before, e) {
    addCareer(e.id, H.careerChanges(before, e, T(), { deptName }));
    if (e.endDate && e.endDate !== before.endDate && !listsOf(e.id).some((l) => l.kind === 'offboarding')) { startChecklist(e.id, 'offboarding', e.endDate); return `Offboarding checklist started.`; }
    return '';
  }
  function remove(empId) {
    ['documents', 'checklists', 'editRequests', 'loans'].forEach((k) => { st()[k] = arr(k).filter((x) => x.empId !== empId); });
    arr('assets').filter((a) => a.holder === empId).forEach((a) => returnAsset(a, 'Removed with the employee record'));
  }

  // ---------- Profile drawer tabs ----------
  const TABS = [['summary', 'Summary'], ['personal', 'Personal'], ['career', 'Career'], ['documents', 'Documents'], ['assets', 'Assets'], ['checklists', 'Checklists']];
  const tabBar = (e, tab) => `<div class="seg hr-tabs" role="tablist" aria-label="Employee file">${TABS.map(([k, l]) => `<button role="tab" data-act="hr-ptab" data-id="${e.id}" data-v="${k}" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>`;
  const sec = (title, body, action = '') => `<div class="drawer-section"><div class="hr-sec-head"><h4>${title}</h4>${action}</div>${body}</div>`;
  const kv = (pairs) => `<dl class="kv">${pairs.map(([k, v]) => `<dt>${k}</dt><dd>${v || '—'}</dd>`).join('')}</dl>`;
  const mask = (n) => (n ? `····${String(n).slice(-4)}` : '');
  function tabBody(e, tab) {
    if (tab === 'personal') {
      const em = e.emergency || {};
      return sec('Identity', kv([['ID', esc(e.idType === 'passport' ? `Passport ${e.passportNo || e.ic || ''}` : e.ic ? `MyKad ${e.ic}` : '')], ['Nationality', esc(e.nationality)], ['Passport', e.passportNo ? `${esc(e.passportNo)} · ${expiryPill(e.passportExpiry)}` : ''], ['Work permit', e.permitNo ? `${esc(e.permitNo)} · ${expiryPill(e.permitExpiry)}` : ''], ['Date of birth', fmt(e.birthday)]]), `<button class="btn btn-sm" data-act="edit-emp" data-id="${e.id}">${icon('edit')}Edit</button>`)
        + sec('Contact and emergency', kv([['Personal email', esc(e.personalEmail)], ['Phone', esc(e.phone)], ['Home address', esc(e.address)], ['Emergency contact', em.name ? `${esc(em.name)} (${esc(em.relation || 'contact')}) · ${esc(em.phone || '')}` : '']]), `<button class="btn btn-sm" data-act="hr-personal" data-id="${e.id}">${icon('edit')}Edit</button>`)
        + sec('Bank and statutory', kv([['Bank', e.bank ? `${esc(e.bank)} ${mask(e.accountNo)}` : ''], ['EPF', esc(e.epfNo)], ['SOCSO', esc(e.socsoNo)], ['Income tax', esc(e.taxNo)]]))
        + sec('Education', (e.education || []).length ? `<ul class="hr-list">${e.education.map((x, i) => `<li><div><strong>${esc(x.level)}${x.field ? `, ${esc(x.field)}` : ''}</strong><div class="person-sub">${esc(x.institution)}${x.year ? ` · ${esc(x.year)}` : ''}</div></div><button class="btn btn-sm btn-icon btn-ghost" data-act="hr-row-del" data-id="${e.id}" data-v="education:${i}" aria-label="Remove ${esc(x.level)}">${icon('trash')}</button></li>`).join('')}</ul>` : '<p class="faint">None added.</p>', `<button class="btn btn-sm" data-act="hr-edu" data-id="${e.id}">${icon('plus')}Add</button>`)
        + sec('Previous employment', (e.employment || []).length ? `<ul class="hr-list">${e.employment.map((x, i) => `<li><div><strong>${esc(x.role)}</strong>, ${esc(x.company)}<div class="person-sub">${esc(x.from || '')} – ${esc(x.to || '')}</div></div><button class="btn btn-sm btn-icon btn-ghost" data-act="hr-row-del" data-id="${e.id}" data-v="employment:${i}" aria-label="Remove ${esc(x.company)}">${icon('trash')}</button></li>`).join('')}</ul>` : '<p class="faint">None added.</p>', `<button class="btn btn-sm" data-act="hr-job" data-id="${e.id}">${icon('plus')}Add</button>`);
    }
    if (tab === 'career') return sec('Career history', careerList(e, true), `<button class="btn btn-sm" data-act="hr-career" data-id="${e.id}">${icon('plus')}Add entry</button>`);
    if (tab === 'documents') return sec('Documents', docList(docsOf(e.id), true), `<div class="row-actions"><button class="btn btn-sm" data-act="hr-letter" data-id="${e.id}">${icon('doc')}Letter</button><button class="btn btn-sm btn-primary" data-act="hr-doc-up" data-id="${e.id}">${icon('plus')}Upload</button></div>`);
    if (tab === 'assets') {
      const a = assetsOf(e.id), l = loansOf(e.id), p = policiesOf(e.id);
      return sec('Assets issued', a.length ? `<ul class="hr-list">${a.map((x) => `<li><div><strong>${esc(x.name)}</strong> <span class="tag">${esc(x.type)}</span><div class="person-sub">${esc(x.tag)}${x.serial ? ` · S/N ${esc(x.serial)}` : ''} · issued ${fmt(x.issued)}</div></div><button class="btn btn-sm" data-act="hr-asset-return" data-id="${x.id}" data-v="${e.id}">Return</button></li>`).join('')}</ul>` : '<p class="faint">Nothing issued.</p>', `<button class="btn btn-sm" data-act="hr-asset-issue" data-id="" data-v="${e.id}">${icon('plus')}Issue</button>`)
        + sec('Staff loans', l.length ? loanRows(l) : '<p class="faint">No loans.</p>', `<button class="btn btn-sm" data-act="hr-loan" data-id="" data-v="${e.id}">${icon('plus')}Add loan</button>`)
        + sec('Insurance cover', p.length ? `<ul class="hr-list">${p.map((x) => `<li><div><strong>${esc(x.name)}</strong><div class="person-sub">${esc(x.insurer)} · ${esc(x.policyNo)} · sum insured ${ctx.money(x.sum)}</div></div>${expiryPill(x.end)}</li>`).join('')}</ul>` : '<p class="faint">Not covered by any policy on record.</p>');
    }
    if (tab === 'checklists') {
      const ls = listsOf(e.id);
      return sec('Onboarding and offboarding', ls.length ? ls.map((l) => listCard(l)).join('') : '<p class="faint">No checklists.</p>', `<div class="row-actions">${ls.some((l) => l.kind === 'onboarding') ? '' : `<button class="btn btn-sm" data-act="hr-start" data-id="${e.id}" data-v="onboarding">Start onboarding</button>`}${ls.some((l) => l.kind === 'offboarding') ? '' : `<button class="btn btn-sm" data-act="hr-offboard" data-id="${e.id}">Start offboarding</button>`}</div>`);
    }
    return '';
  }
  function careerList(e, admin) {
    const list = H.careerSorted(e.career);
    if (!list.length) return '<p class="faint">No history yet.</p>';
    const what = (x) => x.type === 'increment' || x.type === 'adjustment' ? `${ctx.money(x.from)} → <strong>${ctx.money(x.to)}</strong> a year${x.pct ? ` (${x.pct > 0 ? '+' : ''}${x.pct}%)` : ''}` : x.type === 'joined' ? `Joined as <strong>${esc(x.to)}</strong>${x.note ? `, ${esc(x.note)}` : ''}` : x.from ? `${esc(x.from)} → <strong>${esc(x.to)}</strong>` : `<strong>${esc(x.to || '')}</strong>`;
    return `<ol class="hr-timeline">${list.map((x) => `<li><span class="hr-dot hr-${x.type}"></span><div class="grow"><div class="hr-tl-head"><strong>${H.CAREER[x.type] || 'Note'}</strong><span class="faint num">${fmt(x.date)}</span></div><div>${what(x)}</div>${x.type !== 'joined' && x.note ? `<div class="person-sub">${esc(x.note)}</div>` : ''}</div>${admin && x.id ? `<button class="btn btn-sm btn-icon btn-ghost" data-act="hr-career-del" data-id="${e.id}" data-v="${x.id}" aria-label="Remove entry">${icon('trash')}</button>` : ''}</li>`).join('')}</ol>`;
  }
  function docList(list, admin) {
    if (!list.length) return '<p class="faint">No documents yet.</p>';
    return `<ul class="hr-list">${list.map((d) => `<li><div class="grow"><button class="link-btn" data-act="hr-doc-view" data-id="${d.id}"><strong>${esc(d.title)}</strong></button><div class="person-sub">${d.letter ? 'Letter' : `${esc(d.category)} · ${esc((d.file?.name || '').split('.').pop().toUpperCase())}`} · ${d.letter ? 'issued' : 'added'} ${fmt(d.uploaded, { day: 'numeric', month: 'short', year: 'numeric' })}${d.by && d.by === d.empId ? ' by the employee' : ''}</div></div>${d.expiry ? expiryPill(d.expiry) : ''}${admin ? `<button class="btn btn-sm btn-icon btn-ghost" data-act="hr-doc-del" data-id="${d.id}" aria-label="Delete ${esc(d.title)}">${icon('trash')}</button>` : ''}</li>`).join('')}</ul>`;
  }
  const loanRows = (l) => `<ul class="hr-list">${l.map((x) => { const b = H.loanBalance(x, U.monthKey(T())); return `<li><div class="grow"><strong>${esc(x.purpose)}</strong> · ${ctx.money(x.amount, 2)}<div class="person-sub">${ctx.money(H.loanSchedule(x)[0].amount, 2)} a month × ${x.months} from ${U.fmtMonth(x.start, { month: 'short', year: 'numeric' })}</div><div class="hr-bar"><div class="progress"><i style="width:${(b.paid / x.amount) * 100}%"></i></div><span class="num">${b.settled ? 'Settled' : `${ctx.money(b.balance, 2)} left`}</span></div></div></li>`; }).join('')}</ul>`;

  // ---------- Personal details forms (HR) ----------
  function personalForm(id) {
    const e = emp(id), em = e.emergency || {};
    ctx.openModal({
      title: `Contact details · ${e.first}`, submit: 'Save',
      body: `<div class="form-grid"><div class="field"><label for="hp-email">Personal email</label><input class="input" id="hp-email" name="personalEmail" type="email" value="${esc(e.personalEmail || '')}"></div>
        <div class="field"><label for="hp-phone">Phone</label><input class="input" id="hp-phone" name="phone" value="${esc(e.phone || '')}"></div>
        <div class="field full"><label for="hp-addr">Home address</label><textarea class="textarea" id="hp-addr" name="address" rows="2">${esc(e.address || '')}</textarea></div>
        <div class="field"><label for="hp-en">Emergency contact</label><input class="input" id="hp-en" name="emergency.name" value="${esc(em.name || '')}"></div>
        <div class="field"><label for="hp-er">Relationship</label><input class="input" id="hp-er" name="emergency.relation" value="${esc(em.relation || '')}" placeholder="Spouse, parent, sibling"></div>
        <div class="field"><label for="hp-ep">Their phone</label><input class="input" id="hp-ep" name="emergency.phone" value="${esc(em.phone || '')}"></div></div>`,
      onSubmit(d) { Object.assign(e, H.applyRequest(e, H.diffRequest(e, d))); ctx.commit('Details saved', `${ctx.fullName(e)}’s contact details were updated`); reopen(() => ctx.openProfile(id, 'personal')); },
    });
  }
  function rowForm(id, kind) {
    const e = emp(id), edu = kind === 'education';
    ctx.openModal({
      title: edu ? 'Add education' : 'Add previous employment', size: 'sm', submit: 'Add',
      body: edu ? `<div class="form-grid"><div class="field"><label for="ed-l">Qualification</label><select class="select" id="ed-l" name="level">${['SPM', 'STPM', 'Diploma', 'Bachelor’s degree', 'Master’s degree', 'PhD', 'Professional certificate', 'Other'].map((x) => `<option>${x}</option>`).join('')}</select></div>
        <div class="field"><label for="ed-f">Field of study</label><input class="input" id="ed-f" name="field" placeholder="Computer Science"></div>
        <div class="field full"><label for="ed-i">Institution</label><input class="input" id="ed-i" name="institution" required placeholder="Universiti Malaysia Pahang"></div>
        <div class="field"><label for="ed-y">Year completed</label><input class="input num" id="ed-y" name="year" type="number" min="1950" max="2100"></div></div>`
        : `<div class="form-grid"><div class="field full"><label for="jb-c">Company</label><input class="input" id="jb-c" name="company" required></div>
        <div class="field full"><label for="jb-r">Job title</label><input class="input" id="jb-r" name="role" required></div>
        <div class="field"><label for="jb-f">From</label><input class="input" id="jb-f" name="from" type="month"></div>
        <div class="field"><label for="jb-t">To</label><input class="input" id="jb-t" name="to" type="month"></div></div>`,
      onSubmit(d) { e[kind] = [...(e[kind] || []), d]; ctx.commit('Added'); reopen(() => ctx.openProfile(id, 'personal')); },
    });
  }
  function careerForm(id) {
    const e = emp(id);
    ctx.openModal({
      title: `Career entry · ${e.first}`, size: 'sm', submit: 'Add',
      body: `<div class="form-grid"><div class="field"><label for="ca-t">Type</label><select class="select" id="ca-t" name="type">${Object.entries(H.CAREER).filter(([k]) => k !== 'joined').map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
        <div class="field"><label for="ca-d">Date</label><input class="input" id="ca-d" name="date" type="date" required value="${T()}"></div>
        <div class="field"><label for="ca-f">From</label><input class="input" id="ca-f" name="from" placeholder="Previous title, department or salary"></div>
        <div class="field"><label for="ca-to">To</label><input class="input" id="ca-to" name="to" required></div>
        <div class="field full"><label for="ca-n">Note</label><input class="input" id="ca-n" name="note"></div></div>
        <p class="faint">Changes to job title, department or salary in the employee form are added here automatically.</p>`,
      onSubmit(d) {
        const money = ['increment', 'adjustment'].includes(d.type), x = { ...d, from: money ? +d.from || 0 : d.from, to: money ? +d.to || 0 : d.to };
        if (money && x.from) x.pct = Math.round(((x.to - x.from) / x.from) * 10000) / 100;
        addCareer(id, [x]); ctx.commit('Career entry added'); reopen(() => ctx.openProfile(id, 'career'));
      },
    });
  }

  // ---------- Documents ----------
  const CATS = ['IC or passport', 'Work permit', 'Certificate', 'Contract', 'Letter', 'Medical', 'Other'];
  const MAX_PDF = 700 * 1024;
  function readFile(file) {
    return new Promise((resolve, reject) => {
      if (file.type.startsWith('image/')) {
        const img = new Image(), url = URL.createObjectURL(file);
        img.onload = () => { const k = Math.min(1, 1400 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve({ name: file.name.replace(/\.\w+$/, '') + '.jpg', type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.7) }); };
        img.onerror = () => reject(new Error('That image couldn’t be read'));
        img.src = url;
      } else if (file.type === 'application/pdf') {
        if (file.size > MAX_PDF) { reject(new Error('PDFs up to 700 KB can be stored in this demo. Try a photo of the page instead.')); return; }
        const r = new FileReader(); r.onload = () => resolve({ name: file.name, type: file.type, data: r.result }); r.onerror = () => reject(new Error('That file couldn’t be read')); r.readAsDataURL(file);
      } else reject(new Error('Upload a photo or a PDF'));
    });
  }
  function uploadForm(empId, self = false) {
    let file = null;
    ctx.openModal({
      title: self ? 'Add a document' : `Upload for ${firstOf(empId)}`, submit: 'Save document',
      body: `<div class="form-grid"><div class="field full"><label for="dc-file">File (photo or PDF)</label><input class="input" id="dc-file" type="file" accept="image/*,application/pdf" required><span class="field-hint" id="dc-hint">Photos are resized; PDFs up to 700 KB.</span></div>
        <div class="field full"><label for="dc-t">Title</label><input class="input" id="dc-t" name="title" required placeholder="Degree certificate"></div>
        <div class="field"><label for="dc-c">Type</label><select class="select" id="dc-c" name="category">${CATS.map((c) => `<option>${c}</option>`).join('')}</select></div>
        <div class="field"><label for="dc-e">Expires (optional)</label><input class="input" id="dc-e" name="expiry" type="date"><span class="field-hint">HR is reminded 60 days before.</span></div></div>`,
      onSubmit(d) {
        if (!file) { ctx.toast('Choose a file first', 'error'); return false; }
        arr('documents').push({ id: U.uid('doc'), empId, title: d.title.trim(), category: d.category, expiry: d.expiry || '', file, uploaded: T(), by: actor() || '' });
        if (self) notify('profile.document', { who: ctx.fullName(emp(empId)), title: d.title.trim(), href: '#employees' }, 'hr');
        ctx.commit('Document saved', `${d.title.trim()} was added to ${ctx.fullName(emp(empId))}’s documents`);
        if (!self) reopen(() => ctx.openProfile(empId, 'documents'));
      },
    });
    const inp = ctx.$('#dc-file');
    inp.addEventListener('change', async () => {
      const f = inp.files[0]; if (!f) return;
      try { file = await readFile(f); ctx.$('#dc-hint').textContent = `${f.name} ready (${Math.round(file.data.length * 0.75 / 1024)} KB).`; const t = ctx.$('#dc-t'); if (!t.value) t.value = f.name.replace(/\.\w+$/, '').replace(/[-_]+/g, ' '); }
      catch (err) { file = null; inp.value = ''; ctx.toast(err.message, 'error'); }
    });
  }
  function viewDoc(id) {
    const d = arr('documents').find((x) => x.id === id); if (!d) return;
    const self = ctx.role() === 'employee';
    if (self && d.empId !== ctx.me().id) return;
    if (d.letter) { ctx.docs.preview(d.title, letterHtml(d.letter, emp(d.empId)), `${d.title} ${nameOf(d.empId)}`); return; }
    if (d.file?.type === 'application/pdf') {
      const bin = atob(d.file.data.split(',')[1]), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      window.open(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), '_blank', 'noopener');
      return;
    }
    ctx.openModal({ title: d.title, size: 'lg', submit: null, body: `<p class="muted">${esc(nameOf(d.empId))} · ${esc(d.category)}${d.expiry ? ` · ${expiryPill(d.expiry)}` : ''}</p>${d.file?.data ? `<img class="hr-doc-img" src="${d.file.data}" alt="${esc(d.title)}">` : '<p class="faint">No file attached.</p>'}` });
  }

  // ---------- Letters ----------
  function letterData(e, extra = {}) {
    const s = st().settings, er = s.employer || {}, mgr = emp(e.manager);
    return {
      'employee.name': ctx.fullName(e), 'employee.first': e.first, 'employee.role': e.role, 'employee.department': deptName(e.dept),
      'employee.id_no': e.ic || e.passportNo || '', 'employee.address': e.address || '', 'employee.start_date': long(e.start),
      'employee.salary_monthly': ctx.money(e.salary / 12, 2), 'employee.probation_end': e.probationEnd ? long(e.probationEnd) : '',
      'manager.name': mgr ? ctx.fullName(mgr) : '', 'company.name': s.company, 'company.address': er.address || '',
      'signatory.name': er.signatory || '', 'signatory.title': er.signatoryTitle || '', today: long(T()), ...extra,
    };
  }
  function letterHtml(l, e) {
    const s = st().settings, er = s.employer || {};
    const paras = l.body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    return `<article class="doc letter"><header class="doc-head"><div><div class="doc-co">${esc(s.company.toUpperCase())}</div><div class="doc-sub">${esc(er.address || '')}${er.ssm ? ` · ${esc(er.ssm)}` : ''}</div></div></header>
      <p class="letter-date">${esc(l.date ? long(l.date) : long(T()))}</p>
      <p class="letter-to">${esc(e ? ctx.fullName(e) : '')}${e?.address ? `<br>${esc(e.address)}` : ''}</p>
      <p><strong>${esc(l.subject)}</strong></p>${paras}
      <p class="letter-sign">Yours sincerely,<br><br><br>${esc(er.signatory || '')}<br>${esc(er.signatoryTitle || '')}<br>${esc(s.company)}</p>
      ${l.ack ? `<p class="letter-ack">I acknowledge receipt of this letter.<br><br>Signature: ______________________ &nbsp; Date: ____________<br>${esc(e ? ctx.fullName(e) : '')}</p>` : ''}</article>`;
  }
  function suggestions(e, tplId) {
    const nextMonth = `${U.addMonths(U.monthKey(T()), 1)}-01`;
    const inc = arr('payChanges').filter((c) => c.empId === e.id && c.type === 'salary').pop();
    return {
      effective_date: long(tplId === 'offer' ? e.start : tplId === 'confirmation' ? e.confirmedOn || e.probationEnd || T() : inc && tplId === 'increment' ? inc.effective : nextMonth),
      increment_pct: inc ? inc.pct : '', new_salary_monthly: inc ? ctx.money(inc.to / 12, 2) : '',
      new_role: e.role, new_department: deptName(e.dept), last_day: e.endDate ? long(e.endDate) : '', reason: '',
    };
  }
  function letterForm(empId) {
    const e = emp(empId), tpls = cfg().letters;
    let tpl = tpls[0], touched = false;
    const asks = () => tpl.asks.map((k) => `<div class="field"><label for="lt-${k}">${esc(H.PLACEHOLDERS[k] || k)}</label><input class="input" id="lt-${k}" data-ask="${k}" value="${esc(suggestions(e, tpl.id)[k] ?? '')}"></div>`).join('');
    const values = () => Object.fromEntries(ctx.$$('[data-ask]').map((x) => [x.dataset.ask, x.value.trim()]));
    const draw = () => { if (touched) return; const data = letterData(e, values()); ctx.$('#lt-subject').value = H.fill(tpl.subject, data); ctx.$('#lt-body').value = H.fill(tpl.body, data); };
    ctx.openModal({
      title: `Letter for ${ctx.fullName(e)}`, size: 'lg', submit: 'Save and preview',
      body: `<div class="form-grid"><div class="field full"><label for="lt-tpl">Template</label><select class="select" id="lt-tpl">${tpls.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
        <div class="form-grid full" id="lt-asks" style="grid-column:1/-1">${asks()}</div>
        <div class="field full"><label for="lt-subject">Subject</label><input class="input" id="lt-subject" name="subject" required></div>
        <div class="field full"><label for="lt-body">Letter</label><textarea class="textarea hr-letter-body" id="lt-body" name="body" rows="12" required></textarea><span class="field-hint">Anything in [square brackets] still needs filling in. Edits here only change this letter.</span></div></div>`,
      onSubmit(d) {
        if (/\[[\w.]+\]/.test(d.body + d.subject) && !confirm('Some placeholders are still empty. Save anyway?')) return false;
        const letter = { templateId: tpl.id, subject: d.subject.trim(), body: d.body.trim(), date: T(), ack: tpl.id === 'warning' };
        const doc = { id: U.uid('doc'), empId, title: tpl.name, category: 'Letter', expiry: '', letter, uploaded: T(), by: actor() || '' };
        arr('documents').push(doc);
        ctx.commit(`${tpl.name} saved to ${e.first}’s documents`, `${tpl.name} issued to ${ctx.fullName(e)}`);
        reopen(() => viewDoc(doc.id));
      },
    });
    ctx.$('#lt-tpl').addEventListener('change', (ev) => { tpl = tpls.find((t) => t.id === ev.target.value); touched = false; ctx.$('#lt-asks').innerHTML = asks(); draw(); });
    ctx.$('#lt-asks').addEventListener('input', draw);
    ['#lt-body', '#lt-subject'].forEach((s) => ctx.$(s).addEventListener('input', () => { touched = true; }));
    draw();
  }

  // ---------- Checklists ----------
  const ownerIds = (e) => ({ hr: hrId(), it: cfg().it || hrId(), payroll: cfg().payroll || hrId(), manager: e.manager || hrId(), employee: e.id });
  function startChecklist(empId, kind, anchor) {
    const e = emp(empId); if (!e) return null;
    const l = H.buildChecklist(kind === 'onboarding' ? cfg().onboarding : cfg().offboarding, { empId, anchor, owners: ownerIds(e), id: U.uid(kind === 'onboarding' ? 'onb' : 'off'), created: T() });
    st().checklists = [...arr('checklists').filter((x) => !(x.empId === empId && x.kind === kind)), l];
    const by = {};
    l.tasks.forEach((x) => { if (x.assignee) (by[x.assignee] = by[x.assignee] || []).push(x); });
    Object.entries(by).forEach(([to, tasks]) => notify('task.assigned', { who: ctx.fullName(e), kind, count: tasks.length, first: tasks.sort((a, b) => a.due.localeCompare(b.due))[0].title, date: tasks[0].due, href: to === hrId() ? '#onboarding' : to === e.id ? '#my-profile' : '#my-approvals' }, to));
    return l;
  }
  const isAuto = (l, x) => (x.kind === 'form' && l.kind === 'offboarding' && !!emp(l.empId)?.leaverFiled) || (x.kind === 'asset' && l.kind === 'offboarding' && !assetsOf(l.empId).length && !!x.done);
  function taskExtra(l, x) {
    const e = emp(l.empId); if (!e) return '';
    if (l.kind === 'offboarding' && x.kind === 'form') return ctx.role() === 'admin' ? `<button type="button" class="link-btn" data-act="pd-form" data-id="${e.id}">${e.leaverFiled ? 'View' : 'Prepare'} ${e.leaveReason === 'abroad' ? 'CP21' : 'CP22A'}</button>` : '';
    if (l.kind === 'offboarding' && x.kind === 'asset') { const a = assetsOf(e.id); return a.length ? `<span class="faint">${a.length} still held: ${a.map((y) => esc(y.name)).join(', ')}</span>` : '<span class="faint">Nothing held.</span>'; }
    if (l.kind === 'offboarding' && x.kind === 'pay') return ctx.role() === 'admin' ? `<a class="link-btn" href="#payroll">Open payroll</a>` : '';
    if (l.kind === 'offboarding' && x.kind === 'interview') return `<button type="button" class="link-btn" data-act="hr-exit" data-id="${l.id}">${l.exit ? 'View notes' : 'Record notes'}</button>`;
    if (l.kind === 'onboarding' && x.kind === 'asset' && ctx.role() === 'admin') return `<button type="button" class="link-btn" data-act="hr-asset-issue" data-id="" data-v="${e.id}">Issue an asset</button>`;
    return '';
  }
  function listCard(l) {
    const p = H.progress(l), e = emp(l.empId), late = l.tasks.filter((x) => !x.done && x.due < T()).length;
    return `<div class="hr-cl"><div class="hr-cl-head"><div><strong>${l.kind === 'onboarding' ? 'Onboarding' : 'Offboarding'}</strong> <span class="faint">${l.kind === 'onboarding' ? 'starts' : 'last day'} ${fmt(l.anchor, { day: 'numeric', month: 'short' })}</span></div><button class="btn btn-sm" data-act="hr-list" data-id="${l.id}">Open</button></div>
      <div class="hr-bar"><div class="progress"><i style="width:${p.pct}%"></i></div><span class="num">${p.done}/${p.total}</span></div>${late ? `<span class="tag bad">${late} overdue</span>` : p.complete ? '<span class="tag ok">Done</span>' : ''}${e ? '' : ''}</div>`;
  }
  function openList(id, mineOnly = false) {
    const l = arr('checklists').find((x) => x.id === id); if (!l) return;
    const e = emp(l.empId), me = actor(), admin = ctx.role() === 'admin';
    const tasks = l.tasks.filter((x) => admin || !mineOnly || x.assignee === me);
    const groups = Object.keys(H.KINDS).filter((k) => tasks.some((x) => x.kind === k));
    const p = H.progress(l);
    ctx.openModal({
      title: `${l.kind === 'onboarding' ? 'Onboarding' : 'Offboarding'} · ${nameOf(l.empId)}`, size: 'lg', submit: null,
      body: `<p class="muted">${l.kind === 'onboarding' ? `Starts ${long(l.anchor)}` : `Last day ${long(l.anchor)}${e?.leaveReason ? ` · ${esc(AllurusStatutory.REASONS[e.leaveReason] || '')}` : ''}`}. ${p.done} of ${p.total} done.</p>
        <div class="hr-bar" style="margin-bottom:12px"><div class="progress"><i style="width:${p.pct}%"></i></div><span class="num">${p.pct}%</span></div>
        ${groups.map((k) => `<h4 class="lv-h">${H.KINDS[k]}</h4><ul class="hr-tasks">${tasks.filter((x) => x.kind === k).map((x) => { const can = admin || x.assignee === me; const late = !x.done && x.due < T(); return `<li class="${x.done ? 'done' : ''}">
          <label class="check"><input type="checkbox" data-hr-task="${x.id}" ${x.done ? 'checked' : ''} ${can ? '' : 'disabled'}><span>${esc(x.title)}</span></label>
          <div class="hr-task-meta"><span>${esc(H.OWNERS[x.owner])}: ${esc(firstOf(x.assignee))}</span><span class="${late ? 'bad-text' : ''}">${x.done ? `Done ${fmt(x.doneAt, { day: 'numeric', month: 'short' })}` : `Due ${fmt(x.due, { day: 'numeric', month: 'short' })}${late ? ' · overdue' : ''}`}</span>${taskExtra(l, x)}</div></li>`; }).join('')}</ul>`).join('')}
        ${admin ? `<div class="ci-actions" style="justify-content:flex-start"><button type="button" class="btn btn-sm btn-ghost" data-act="hr-list-del" data-id="${l.id}">${icon('trash')}Remove checklist</button></div>` : ''}`,
    });
    ctx.$$('[data-hr-task]').forEach((cb) => cb.addEventListener('change', () => {
      const x = l.tasks.find((y) => y.id === cb.dataset.hrTask);
      if (cb.checked && l.kind === 'offboarding' && x.kind === 'asset' && assetsOf(l.empId).length) { cb.checked = false; ctx.toast('Mark the assets as returned first', 'error'); return; }
      Object.assign(x, { done: cb.checked, doneAt: cb.checked ? T() : '', doneBy: cb.checked ? actor() : '' });
      ctx.save(); openList(id, mineOnly);
      ctx.toast(cb.checked ? 'Task done' : 'Task reopened');
    }));
  }
  function offboardForm(empId) {
    const e = empId ? emp(empId) : null;
    ctx.openModal({
      title: e ? `Offboard ${e.first}` : 'Start offboarding', size: 'sm', submit: 'Start offboarding',
      body: `<div class="form-grid" style="grid-template-columns:1fr">${e ? '' : `<div class="field"><label for="of-e">Employee</label><select class="select" id="of-e" name="empId" required>${ctx.activeEmployees().filter((x) => !listsOf(x.id).some((l) => l.kind === 'offboarding')).map((x) => `<option value="${x.id}">${esc(ctx.fullName(x))}</option>`).join('')}</select></div>`}
        <div class="field"><label for="of-d">Last day of work</label><input class="input" id="of-d" name="endDate" type="date" required value="${e?.endDate || U.addDays(T(), 30)}"></div>
        <div class="field"><label for="of-r">Reason</label><select class="select" id="of-r" name="leaveReason">${Object.entries(AllurusStatutory.REASONS).map(([k, l]) => `<option value="${k}" ${e?.leaveReason === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
        <p class="faint">Sets the last day on their record, so LHDN form reminders and final pay follow.</p>`,
      onSubmit(d) {
        const x = emp(empId || d.empId);
        Object.assign(x, { endDate: d.endDate, leaveReason: d.leaveReason, leaverFiled: '' });
        startChecklist(x.id, 'offboarding', d.endDate);
        ctx.commit(`Offboarding started for ${x.first}`, `Offboarding started for ${ctx.fullName(x)}, last day ${fmt(d.endDate)}`);
      },
    });
  }
  function exitForm(id) {
    const l = arr('checklists').find((x) => x.id === id), x = l.exit || {};
    ctx.openModal({
      title: `Exit interview · ${nameOf(l.empId)}`, submit: 'Save notes',
      body: `<div class="form-grid"><div class="field"><label for="ex-d">Date</label><input class="input" id="ex-d" name="date" type="date" value="${x.date || T()}"></div>
        <div class="field"><label for="ex-why">Main reason for leaving</label><select class="select" id="ex-why" name="why">${['Career growth', 'Pay and benefits', 'Manager', 'Workload', 'Relocation', 'Personal or family', 'Further study', 'Other'].map((o) => `<option ${x.why === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
        <div class="field"><label for="ex-again">Would they work here again?</label><select class="select" id="ex-again" name="again">${['Yes', 'Maybe', 'No'].map((o) => `<option ${x.again === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
        <div class="field full"><label for="ex-n">Notes</label><textarea class="textarea" id="ex-n" name="notes" rows="4">${esc(x.notes || '')}</textarea></div></div><p class="faint">Kept with the checklist; only HR sees it.</p>`,
      onSubmit(d) { l.exit = d; const t = l.tasks.find((y) => y.kind === 'interview'); if (t && !t.done) Object.assign(t, { done: true, doneAt: T(), doneBy: actor() }); ctx.commit('Exit interview saved'); reopen(() => openList(id)); },
    });
  }
  function onboardingView() {
    const lists = arr('checklists').filter((l) => l.kind === ui.tab && emp(l.empId));
    const open = lists.filter((l) => !H.progress(l).complete).sort((a, b) => a.anchor.localeCompare(b.anchor)), done = lists.filter((l) => H.progress(l).complete);
    const late = H.overdueTasks(arr('checklists').filter((l) => emp(l.empId)), T());
    const week = arr('checklists').filter((l) => emp(l.empId)).flatMap((l) => l.tasks).filter((x) => !x.done && x.due >= T() && x.due <= U.addDays(T(), 7));
    const row = (l) => { const e = emp(l.empId), p = H.progress(l), next = l.tasks.filter((x) => !x.done).sort((a, b) => a.due.localeCompare(b.due))[0], n = l.tasks.filter((x) => !x.done && x.due < T()).length; return `<tr class="clickable" data-act="hr-list" data-id="${l.id}"><td>${ctx.person(e)}</td><td class="num">${fmt(l.anchor)}</td><td><div class="hr-bar"><div class="progress"><i style="width:${p.pct}%"></i></div><span class="num">${p.done}/${p.total}</span></div></td><td class="hide-sm">${next ? `${esc(next.title)}<div class="person-sub">${esc(firstOf(next.assignee))} · due ${fmt(next.due, { day: 'numeric', month: 'short' })}</div>` : '<span class="faint">—</span>'}</td><td>${n ? `<span class="tag bad">${n} overdue</span>` : p.complete ? '<span class="tag ok">Done</span>' : ''}</td></tr>`; };
    const table = (ls) => `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>${ui.tab === 'onboarding' ? 'Starts' : 'Last day'}</th><th>Progress</th><th class="hide-sm">Next task</th><th></th></tr></thead><tbody>${ls.map(row).join('')}</tbody></table>${ls.length ? '' : `<div class="empty"><strong>No ${ui.tab} in progress</strong>${ui.tab === 'onboarding' ? 'Adding an employee or onboarding a hired candidate starts one.' : 'Start one when someone resigns.'}</div>`}</div>`;
    return `<div class="page-head"><div><div class="eyebrow">Workforce</div><h1>Onboarding and offboarding</h1><p class="sub">Checklists for joiners and leavers, with an owner and a due date for every task.</p></div>
        <div class="actions"><button class="btn" data-act="hr-goto-settings" data-v="hr-checklists">${icon('sliders')}Templates</button><button class="btn btn-primary" data-act="${ui.tab === 'onboarding' ? 'add-emp' : 'hr-offboard'}">${icon('plus')}${ui.tab === 'onboarding' ? 'Add an employee' : 'Start offboarding'}</button></div></div>
      <div class="seg" role="tablist" aria-label="Checklists">${[['onboarding', 'Onboarding'], ['offboarding', 'Offboarding']].map(([k, l]) => `<button role="tab" data-act="hr-tab" data-v="${k}" class="${ui.tab === k ? 'on' : ''}" aria-selected="${ui.tab === k}">${l} <span class="faint">${arr('checklists').filter((x) => x.kind === k && emp(x.empId) && !H.progress(x).complete).length}</span></button>`).join('')}</div>
      <div class="grid g-3 keep-2"><div class="card kpi"><div class="kpi-label">In progress</div><div class="kpi-value">${open.length}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--bad)"></span>Overdue tasks</div><div class="kpi-value">${late.length}</div><div class="kpi-foot">${late.length ? esc([...new Set(late.map((x) => firstOf(x.assignee)))].join(', ')) : 'All on time'}</div></div>
        <div class="card kpi"><div class="kpi-label">Due in the next 7 days</div><div class="kpi-value">${week.length}</div></div></div>
      <div class="card card-flush">${table(open)}</div>
      ${done.length ? `<details class="card card-flush hr-done"><summary class="card-head" style="padding:14px 18px">Completed (${done.length})</summary>${table(done)}</details>` : ''}`;
  }
  // Tasks assigned to an employee (as manager, IT, payroll or about themselves).
  function myTasksCard(empId) {
    const lists = arr('checklists').filter((l) => emp(l.empId) && l.tasks.some((x) => x.assignee === empId && !x.done));
    if (!lists.length) return '';
    return `<div class="card"><div class="card-head"><h3>Onboarding and offboarding tasks</h3><span class="hint">${lists.reduce((s, l) => s + l.tasks.filter((x) => x.assignee === empId && !x.done).length, 0)} open</span></div><div class="list">
      ${lists.map((l) => { const mine = l.tasks.filter((x) => x.assignee === empId && !x.done).sort((a, b) => a.due.localeCompare(b.due)); return `<div class="list-item">${ctx.avatar(nameOf(l.empId), 'sm')}<div class="grow"><div class="person-name">${l.empId === empId ? `Your ${l.kind}` : `${esc(nameOf(l.empId))} · ${l.kind}`}</div><div class="person-sub" style="white-space:normal">${esc(mine[0].title)}${mine.length > 1 ? ` and ${mine.length - 1} more` : ''} · due ${fmt(mine[0].due, { day: 'numeric', month: 'short' })}${mine[0].due < T() ? ' <span class="tag bad">Overdue</span>' : ''}</div></div><button class="btn btn-sm" data-act="hr-my-list" data-id="${l.id}">Open</button></div>`; }).join('')}</div></div>`;
  }

  // ---------- Asset register, loans and insurance ----------
  const TYPES = ['Laptop', 'Phone', 'Access card', 'Vehicle', 'Monitor', 'Tablet', 'Other'];
  function returnAsset(a, note = '') {
    a.history = [...(a.history || []), { empId: a.holder, issued: a.issued, returned: T(), note }];
    Object.assign(a, { holder: '', issued: '', returned: T() });
    // A leaver who has returned everything has their asset task done.
    arr('checklists').filter((l) => l.kind === 'offboarding' && l.empId === a.history[a.history.length - 1].empId && !assetsOf(l.empId).length).forEach((l) => l.tasks.filter((x) => x.kind === 'asset' && !x.done).forEach((x) => Object.assign(x, { done: true, doneAt: T(), doneBy: actor() })));
  }
  function assetForm(id, holder = '') {
    const a = id ? arr('assets').find((x) => x.id === id) : { type: 'Laptop', holder };
    const n = arr('assets').length + 1;
    ctx.openModal({
      title: id ? `Edit ${a.name}` : holder ? `Issue an asset to ${firstOf(holder)}` : 'Add an asset', submit: id ? 'Save' : 'Add',
      body: `<div class="form-grid">${holder && !id && arr('assets').some((x) => !x.holder) ? `<div class="field full"><label for="as-pick">From the store</label><select class="select" id="as-pick" name="pick"><option value="">A new asset (fill in below)</option>${arr('assets').filter((x) => !x.holder).map((x) => `<option value="${x.id}">${esc(x.tag)} · ${esc(x.name)}</option>`).join('')}</select></div>` : ''}
        <div class="field"><label for="as-type">Type</label><select class="select" id="as-type" name="type">${TYPES.map((t) => `<option ${a.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label for="as-tag">Asset tag</label><input class="input" id="as-tag" name="tag" value="${esc(a.tag || `AL-${String(n).padStart(4, '0')}`)}"></div>
        <div class="field full"><label for="as-name">Make and model</label><input class="input" id="as-name" name="name" value="${esc(a.name || '')}" placeholder="MacBook Air 13 M3"></div>
        <div class="field"><label for="as-sn">Serial number</label><input class="input" id="as-sn" name="serial" value="${esc(a.serial || '')}"></div>
        <div class="field"><label for="as-val">Value (${esc(st().settings.currency)})</label><input class="input num" id="as-val" name="value" type="number" min="0" step="1" value="${a.value ?? ''}"></div>
        <div class="field"><label for="as-bought">Bought on</label><input class="input" id="as-bought" name="bought" type="date" value="${a.bought || ''}"></div>
        <div class="field"><label for="as-holder">Issued to</label><select class="select" id="as-holder" name="holder"><option value="">In store</option>${ctx.activeEmployees().map((e) => `<option value="${e.id}" ${a.holder === e.id ? 'selected' : ''}>${esc(ctx.fullName(e))}</option>`).join('')}</select></div>
        <div class="field"><label for="as-issued">Issued on</label><input class="input" id="as-issued" name="issued" type="date" value="${a.issued || T()}"></div>
        <div class="field full"><label for="as-note">Notes</label><input class="input" id="as-note" name="notes" value="${esc(a.notes || '')}" placeholder="Condition, accessories, plate number"></div></div>`,
      onSubmit(d) {
        if (d.pick) { const s = arr('assets').find((x) => x.id === d.pick); Object.assign(s, { holder, issued: d.issued || T(), returned: '' }); ctx.commit(`${s.name} issued to ${firstOf(holder)}`); reopen(() => ctx.openProfile(holder, 'assets')); return; }
        if (!d.name.trim()) { ctx.toast('Add the make and model', 'error'); return false; }
        const x = { tag: d.tag.trim(), type: d.type, name: d.name.trim(), serial: d.serial.trim(), value: Math.max(0, +d.value || 0), bought: d.bought, notes: d.notes.trim() };
        if (id) {
          if (a.holder && d.holder !== a.holder) returnAsset(a, 'Reassigned');
          Object.assign(a, x, d.holder ? { holder: d.holder, issued: d.issued || T(), returned: '' } : {});
        } else arr('assets').push({ id: U.uid('as'), ...x, holder: d.holder, issued: d.holder ? d.issued || T() : '', returned: '', history: [] });
        ctx.commit(id ? 'Asset saved' : d.holder ? `${x.name} issued to ${firstOf(d.holder)}` : 'Asset added', d.holder && (!id || d.holder !== a.holder) ? `${x.name} (${x.tag}) issued to ${nameOf(d.holder)}` : null);
        if (holder) reopen(() => ctx.openProfile(holder, 'assets'));
      },
    });
  }
  function loanForm(id, empId = '') {
    const l = id ? arr('loans').find((x) => x.id === id) : { empId, start: U.addMonths(U.monthKey(T()), 1), months: 12 };
    ctx.openModal({
      title: id ? 'Edit staff loan' : 'Add a staff loan', size: 'sm', submit: id ? 'Save' : 'Add loan',
      body: `<div class="form-grid" style="grid-template-columns:1fr 1fr"><div class="field full"><label for="ln-e">Employee</label><select class="select" id="ln-e" name="empId">${ctx.activeEmployees().map((e) => `<option value="${e.id}" ${l.empId === e.id ? 'selected' : ''}>${esc(ctx.fullName(e))}</option>`).join('')}</select></div>
        <div class="field full"><label for="ln-p">Purpose</label><input class="input" id="ln-p" name="purpose" required value="${esc(l.purpose || '')}" placeholder="Computer loan"></div>
        <div class="field"><label for="ln-a">Amount</label><input class="input num" id="ln-a" name="amount" type="number" min="1" step="1" required value="${l.amount ?? ''}"></div>
        <div class="field"><label for="ln-m">Months</label><input class="input num" id="ln-m" name="months" type="number" min="1" max="120" required value="${l.months}"></div>
        <div class="field full"><label for="ln-s">First repayment</label><input class="input" id="ln-s" name="start" type="month" required value="${l.start}"></div></div>
        <p class="faint">Equal monthly instalments, no interest. Deduct them in payroll as agreed in writing with the employee.</p>`,
      onSubmit(d) {
        const x = { empId: d.empId, purpose: d.purpose.trim(), amount: Math.max(1, +d.amount || 0), months: Math.max(1, Math.round(+d.months || 1)), start: d.start };
        if (id) Object.assign(l, x); else arr('loans').push({ id: U.uid('loan'), ...x, extra: [], approved: T(), by: actor() });
        ctx.commit(id ? 'Loan saved' : 'Loan added', id ? null : `Staff loan of ${ctx.money(x.amount)} recorded for ${nameOf(x.empId)}`);
        if (empId) reopen(() => ctx.openProfile(empId, 'assets'));
      },
    });
  }
  function repayForm(id) {
    const l = arr('loans').find((x) => x.id === id), b = H.loanBalance(l, U.monthKey(T()));
    ctx.openModal({
      title: `Extra repayment · ${l.purpose}`, size: 'sm', submit: 'Record',
      body: `<p class="muted">${esc(nameOf(l.empId))} has ${ctx.money(b.balance, 2)} left.</p><div class="form-grid"><div class="field"><label for="rp-a">Amount</label><input class="input num" id="rp-a" name="amount" type="number" min="1" step="0.01" required value="${b.balance}"></div><div class="field"><label for="rp-m">Month</label><input class="input" id="rp-m" name="month" type="month" value="${U.monthKey(T())}"></div></div>`,
      onSubmit(d) { l.extra = [...(l.extra || []), { month: d.month, amount: Math.min(b.balance, Math.max(0, +d.amount || 0)) }]; ctx.commit('Repayment recorded'); },
    });
  }
  function policyForm(id) {
    const p = id ? arr('insurance').find((x) => x.id === id) : { covers: 'all', start: T(), end: U.addDays(U.addMonths(T().slice(0, 7), 12) + '-01', -1) };
    ctx.openModal({
      title: id ? `Edit ${p.name}` : 'Add an insurance policy', submit: id ? 'Save' : 'Add policy',
      body: `<div class="form-grid"><div class="field full"><label for="in-n">Policy</label><input class="input" id="in-n" name="name" required value="${esc(p.name || '')}" placeholder="Group hospitalisation and surgical"></div>
        <div class="field"><label for="in-i">Insurer</label><input class="input" id="in-i" name="insurer" required value="${esc(p.insurer || '')}"></div>
        <div class="field"><label for="in-no">Policy number</label><input class="input" id="in-no" name="policyNo" value="${esc(p.policyNo || '')}"></div>
        <div class="field"><label for="in-s">Sum insured (each)</label><input class="input num" id="in-s" name="sum" type="number" min="0" value="${p.sum ?? ''}"></div>
        <div class="field"><label for="in-p">Annual premium</label><input class="input num" id="in-p" name="premium" type="number" min="0" step="0.01" value="${p.premium ?? ''}"></div>
        <div class="field"><label for="in-st">Start</label><input class="input" id="in-st" name="start" type="date" value="${p.start || ''}"></div>
        <div class="field"><label for="in-en">Expiry</label><input class="input" id="in-en" name="end" type="date" required value="${p.end || ''}"><span class="field-hint">HR is reminded 60 days before.</span></div>
        <div class="field full"><label for="in-c">Covers</label><select class="select" id="in-c" name="who"><option value="all" ${p.covers === 'all' ? 'selected' : ''}>All staff</option><option value="some" ${p.covers !== 'all' ? 'selected' : ''}>Chosen people</option></select></div>
        <div class="field full" id="in-people" ${p.covers === 'all' ? 'hidden' : ''}><label for="in-pp">People</label><select class="select" id="in-pp" multiple size="5">${ctx.activeEmployees().map((e) => `<option value="${e.id}" ${p.covers !== 'all' && (p.covers || []).includes(e.id) ? 'selected' : ''}>${esc(ctx.fullName(e))}</option>`).join('')}</select></div></div>`,
      onSubmit(d) {
        const x = { name: d.name.trim(), insurer: d.insurer.trim(), policyNo: d.policyNo.trim(), sum: +d.sum || 0, premium: +d.premium || 0, start: d.start, end: d.end, covers: d.who === 'all' ? 'all' : [...ctx.$('#in-pp').selectedOptions].map((o) => o.value) };
        if (id) Object.assign(p, x); else arr('insurance').push({ id: U.uid('ins'), ...x });
        ctx.commit(id ? 'Policy saved' : 'Policy added');
      },
    });
    ctx.$('#in-c').addEventListener('change', (ev) => { ctx.$('#in-people').hidden = ev.target.value === 'all'; });
  }
  function assetsView() {
    const tabs = `<div class="seg" role="tablist" aria-label="Register">${[['assets', 'Assets'], ['loans', 'Staff loans'], ['insurance', 'Insurance']].map(([k, l]) => `<button role="tab" data-act="hr-atab" data-v="${k}" class="${ui.assetTab === k ? 'on' : ''}" aria-selected="${ui.assetTab === k}">${l}</button>`).join('')}</div>`;
    const head = (sub, btn) => `<div class="page-head"><div><div class="eyebrow">Workforce</div><h1>Assets, loans and insurance</h1><p class="sub">${sub}</p></div><div class="actions">${btn}</div></div>`;
    if (ui.assetTab === 'loans') {
      const ls = arr('loans').filter((l) => emp(l.empId)), mk = U.monthKey(T());
      const out = ls.reduce((s, l) => s + H.loanBalance(l, mk).balance, 0), monthly = ls.filter((l) => !H.loanBalance(l, mk).settled).reduce((s, l) => s + (H.loanSchedule(l).find((x) => x.month === mk)?.amount || 0), 0);
      return head('Staff loans with their monthly instalments and what is left to pay.', `<button class="btn btn-primary" data-act="hr-loan" data-id="">${icon('plus')}Add a loan</button>`) + tabs
        + `<div class="grid g-3 keep-2"><div class="card kpi"><div class="kpi-label">Loans</div><div class="kpi-value">${ls.length}</div></div><div class="card kpi"><div class="kpi-label">Outstanding</div><div class="kpi-value num">${ctx.compactMoney(out)}</div></div><div class="card kpi"><div class="kpi-label">Due this month</div><div class="kpi-value num">${ctx.compactMoney(monthly)}</div></div></div>
        <div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Employee</th><th>Purpose</th><th class="r">Amount</th><th class="r hide-sm">Monthly</th><th>Paid</th><th></th></tr></thead><tbody>
        ${ls.map((l) => { const b = H.loanBalance(l, mk); return `<tr><td>${ctx.person(emp(l.empId))}</td><td>${esc(l.purpose)}<div class="person-sub">${U.fmtMonth(l.start, { month: 'short', year: 'numeric' })} · ${l.months} months</div></td><td class="r num">${ctx.money(l.amount, 2)}</td><td class="r num hide-sm">${ctx.money(H.loanSchedule(l)[0].amount, 2)}</td><td><div class="hr-bar"><div class="progress"><i style="width:${(b.paid / l.amount) * 100}%"></i></div><span class="num">${b.settled ? 'Settled' : ctx.money(b.balance, 2) + ' left'}</span></div></td>
          <td><div class="row-actions">${b.settled ? '' : `<button class="btn btn-sm" data-act="hr-repay" data-id="${l.id}">Repay</button>`}<button class="btn btn-sm btn-icon btn-ghost" data-act="hr-loan" data-id="${l.id}" aria-label="Edit loan">${icon('edit')}</button></div></td></tr>`; }).join('')}</tbody></table>${ls.length ? '' : '<div class="empty"><strong>No staff loans</strong></div>'}</div></div>`;
    }
    if (ui.assetTab === 'insurance') {
      const ps = [...arr('insurance')].sort((a, b) => a.end.localeCompare(b.end));
      return head('Company insurance policies, who they cover, and when they expire.', `<button class="btn btn-primary" data-act="hr-policy" data-id="">${icon('plus')}Add a policy</button>`) + tabs
        + `<div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Policy</th><th class="hide-sm">Insurer</th><th>Covers</th><th class="r hide-sm">Sum insured</th><th class="r hide-sm">Premium</th><th>Expiry</th><th></th></tr></thead><tbody>
        ${ps.map((p) => `<tr><td><strong>${esc(p.name)}</strong><div class="person-sub">${esc(p.policyNo)}</div></td><td class="hide-sm">${esc(p.insurer)}</td><td>${p.covers === 'all' ? 'All staff' : `${p.covers.length} ${p.covers.length === 1 ? 'person' : 'people'}<div class="person-sub">${esc(p.covers.slice(0, 3).map(firstOf).join(', '))}</div>`}</td><td class="r num hide-sm">${ctx.money(p.sum)}</td><td class="r num hide-sm">${ctx.money(p.premium, 2)}</td><td>${expiryPill(p.end)}</td><td><div class="row-actions"><button class="btn btn-sm btn-icon btn-ghost" data-act="hr-policy" data-id="${p.id}" aria-label="Edit ${esc(p.name)}">${icon('edit')}</button></div></td></tr>`).join('')}</tbody></table>${ps.length ? '' : '<div class="empty"><strong>No policies yet</strong></div>'}</div></div>`;
    }
    const q = ui.assetQ.toLowerCase(), all = arr('assets');
    const list = all.filter((a) => !q || `${a.tag} ${a.name} ${a.serial} ${a.type} ${nameOf(a.holder)}`.toLowerCase().includes(q)).sort((a, b) => a.tag.localeCompare(b.tag));
    const leavers = all.filter((a) => a.holder && emp(a.holder)?.endDate);
    return head('Everything issued to staff, with serial numbers, values and dates.', `<button class="btn" data-act="hr-asset-csv">${icon('download')}Export CSV</button><button class="btn btn-primary" data-act="hr-asset-issue" data-id="">${icon('plus')}Add an asset</button>`) + tabs
      + `<div class="grid g-4 keep-2"><div class="card kpi"><div class="kpi-label">Assets</div><div class="kpi-value">${all.length}</div></div><div class="card kpi"><div class="kpi-label">Issued</div><div class="kpi-value">${all.filter((a) => a.holder).length}</div><div class="kpi-foot">${all.filter((a) => !a.holder).length} in store</div></div>
        <div class="card kpi"><div class="kpi-label">Total value</div><div class="kpi-value num">${ctx.compactMoney(all.reduce((s, a) => s + (a.value || 0), 0))}</div></div><div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--warn)"></span>Held by leavers</div><div class="kpi-value">${leavers.length}</div><div class="kpi-foot">${leavers.length ? esc([...new Set(leavers.map((a) => firstOf(a.holder)))].join(', ')) : 'None'}</div></div></div>
      <div class="card card-flush"><div class="toolbar"><label class="sr-only" for="as-q">Search assets</label><input class="input" id="as-q" type="search" placeholder="Search tag, model, serial or person" value="${esc(ui.assetQ)}" style="flex:1;min-width:200px"></div>
        <div class="table-wrap"><table><thead><tr><th>Asset</th><th class="hide-sm">Serial</th><th class="r hide-sm">Value</th><th>Holder</th><th class="hide-sm">Issued</th><th></th></tr></thead><tbody>
        ${list.map((a) => `<tr><td><strong>${esc(a.name)}</strong> <span class="tag">${esc(a.type)}</span><div class="person-sub">${esc(a.tag)}${a.notes ? ` · ${esc(a.notes)}` : ''}</div></td><td class="hide-sm num muted">${esc(a.serial || '—')}</td><td class="r num hide-sm">${ctx.money(a.value || 0)}</td>
          <td>${a.holder ? `${ctx.person(emp(a.holder))}${emp(a.holder)?.endDate ? `<span class="tag warn">Leaving ${fmt(emp(a.holder).endDate, { day: 'numeric', month: 'short' })}</span>` : ''}` : `<span class="pill">In store</span>${a.returned ? `<div class="person-sub">Returned ${fmt(a.returned)}</div>` : ''}`}</td><td class="hide-sm num muted">${a.holder ? fmt(a.issued) : '—'}</td>
          <td><div class="row-actions">${a.holder ? `<button class="btn btn-sm" data-act="hr-asset-return" data-id="${a.id}">Return</button>` : ''}<button class="btn btn-sm btn-icon btn-ghost" data-act="hr-asset-edit" data-id="${a.id}" aria-label="Edit ${esc(a.name)}">${icon('edit')}</button></div></td></tr>`).join('')}</tbody></table>${list.length ? '' : '<div class="empty"><strong>No assets match</strong></div>'}</div></div>`;
  }

  // ---------- Org chart ----------
  function orgHtml(forPrint = false) {
    const people = st().employees.filter((e) => e.status !== 'Inactive');
    let tree = H.orgTree(people);
    if (ui.orgDept !== 'all') {
      // Keep each person in the department, plus the managers above them for context.
      const keep = new Set(), byId = Object.fromEntries(people.map((e) => [e.id, e]));
      people.filter((e) => e.dept === ui.orgDept).forEach((e) => { let x = e, n = 0; while (x && !keep.has(x.id) && n++ < 50) { keep.add(x.id); x = byId[x.manager]; } });
      const prune = (ns) => ns.filter((n) => keep.has(n.emp.id)).map((n) => ({ ...n, children: prune(n.children) }));
      tree = prune(tree);
    }
    const admin = ctx.role() === 'admin' && !forPrint;
    const card = (n) => { const e = n.emp, d = ctx.dept(e.dept); return `<div class="org-card ${ui.orgDept !== 'all' && e.dept !== ui.orgDept ? 'dim' : ''}" style="--dc:${d?.color || 'var(--brand)'}" ${admin ? `role="button" tabindex="0" data-act="view-emp" data-id="${e.id}"` : ''}>${forPrint ? '' : ctx.avatar(ctx.fullName(e), 'sm')}<div><div class="org-name">${esc(ctx.fullName(e))}</div><div class="org-role">${esc(e.role)}</div><div class="org-dept">${esc(d?.name || '')}${n.children.length ? ` · ${n.size} ${n.size === 1 ? 'report' : 'in team'}` : ''}</div></div></div>`; };
    const ul = (ns) => (ns.length ? `<ul>${ns.map((n) => `<li>${card(n)}${ul(n.children)}</li>`).join('')}</ul>` : '');
    return `<div class="org">${ul(tree)}</div>`;
  }
  function orgView() {
    return `<div class="page-head"><div><div class="eyebrow">${ctx.role() === 'admin' ? 'Workforce' : 'Company'}</div><h1>Organisation chart</h1><p class="sub">Who reports to whom, from each person’s “Reports to” on their record.</p></div>
        <div class="actions"><label class="sr-only" for="org-dept">Department</label><select class="select" id="org-dept"><option value="all">Whole company</option>${st().departments.map((d) => `<option value="${d.id}" ${ui.orgDept === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select><button class="btn" data-act="hr-org-print">${icon('download')}Print</button></div></div>
      <div class="card">${orgHtml()}</div>`;
  }

  // ---------- Change requests ----------
  const pendingReqs = () => arr('editRequests').filter((r) => r.status === 'Pending' && emp(r.empId));
  function requestForm() {
    const e = ctx.me(), em = e.emergency || {}, open = pendingReqs().find((r) => r.empId === e.id);
    if (open) { ctx.toast('You already have a change waiting for HR', 'info'); return; }
    ctx.openModal({
      title: 'Request a change to my details', submit: 'Send to HR',
      body: `<p class="muted" style="margin-bottom:10px">HR checks the change before it goes on your record. Job, pay and statutory numbers are changed by HR.</p><div class="form-grid">
        <div class="field"><label for="rq-phone">Phone</label><input class="input" id="rq-phone" name="phone" value="${esc(e.phone || '')}"></div>
        <div class="field"><label for="rq-pe">Personal email</label><input class="input" id="rq-pe" name="personalEmail" type="email" value="${esc(e.personalEmail || '')}"></div>
        <div class="field full"><label for="rq-addr">Home address</label><textarea class="textarea" id="rq-addr" name="address" rows="2">${esc(e.address || '')}</textarea></div>
        <div class="field"><label for="rq-m">Marital status</label><select class="select" id="rq-m" name="married"><option value="false" ${e.married ? '' : 'selected'}>Single</option><option value="true" ${e.married ? 'selected' : ''}>Married</option></select></div>
        <div class="field full form-sep"><span class="eyebrow">Emergency contact</span></div>
        <div class="field"><label for="rq-en">Name</label><input class="input" id="rq-en" name="emergency.name" value="${esc(em.name || '')}"></div>
        <div class="field"><label for="rq-er">Relationship</label><input class="input" id="rq-er" name="emergency.relation" value="${esc(em.relation || '')}"></div>
        <div class="field"><label for="rq-ep">Phone</label><input class="input" id="rq-ep" name="emergency.phone" value="${esc(em.phone || '')}"></div>
        <div class="field full form-sep"><span class="eyebrow">Bank account for salary</span></div>
        <div class="field"><label for="rq-b">Bank</label><select class="select" id="rq-b" name="bank"><option value="">Not set</option>${AllurusStatutory.BANKS.map((b) => `<option ${e.bank === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></div>
        <div class="field"><label for="rq-a">Account number</label><input class="input" id="rq-a" name="accountNo" inputmode="numeric" value="${esc(e.accountNo || '')}"></div>
        <div class="field full"><label for="rq-note">Note for HR (optional)</label><input class="input" id="rq-note" name="note" placeholder="Moved house in October"></div></div>`,
      onSubmit(d) {
        d.married = d.married === 'true';
        const changes = H.diffRequest(e, d);
        if (!changes.length) { ctx.toast('Nothing has changed', 'error'); return false; }
        if (changes.some((c) => c.field === 'accountNo') && d.accountNo && !AllurusStatutory.validAccount(d.accountNo, d.bank || e.bank)) { ctx.toast('That account number doesn’t look right for the bank', 'error'); return false; }
        const r = { id: U.uid('rq'), empId: e.id, changes, note: d.note.trim(), at: T(), status: 'Pending' };
        arr('editRequests').push(r);
        notify('profile.request', { who: ctx.fullName(e), fields: changes.map((c) => c.label.toLowerCase()).join(', '), href: '#employees' }, 'hr', { from: e.id });
        ctx.commit('Sent to HR. You’ll be notified when it’s done.');
      },
    });
  }
  const show = (c, v) => (c.field === 'accountNo' ? mask(v) : typeof v === 'boolean' || v === 'true' || v === 'false' ? (String(v) === 'true' ? 'Married' : 'Single') : esc(v) || '<span class="faint">empty</span>');
  function reviewRequest(id) {
    const r = arr('editRequests').find((x) => x.id === id), e = emp(r.empId);
    ctx.openModal({
      title: `Detail change · ${ctx.fullName(e)}`, submit: null,
      body: `<p class="muted">Asked ${fmt(r.at)}${r.note ? `: “${esc(r.note)}”` : '.'}</p><div class="table-wrap"><table><thead><tr><th>Field</th><th>Now</th><th>Change to</th></tr></thead><tbody>${r.changes.map((c) => `<tr><td>${esc(c.label)}</td><td class="muted">${show(c, c.from)}</td><td><strong>${show(c, c.to)}</strong></td></tr>`).join('')}</tbody></table></div>
        <div class="field" style="margin-top:12px"><label for="rq-reply">Reply (needed to decline)</label><input class="input" id="rq-reply"></div>
        <div class="ci-actions" style="justify-content:flex-end"><button type="button" class="btn" data-act="hr-req-decide" data-id="${r.id}" data-v="no">Decline</button><button type="button" class="btn btn-primary" data-act="hr-req-decide" data-id="${r.id}" data-v="yes">${icon('check')}Approve and update</button></div>`,
    });
  }
  function decide(id, yes) {
    const r = arr('editRequests').find((x) => x.id === id), e = emp(r.empId), reply = ctx.$('#rq-reply')?.value.trim() || '';
    if (!yes && !reply) { ctx.toast('Say why, so they know what to fix', 'error'); ctx.$('#rq-reply')?.focus(); return; }
    if (yes) Object.assign(e, H.applyRequest(e, r.changes));
    Object.assign(r, { status: yes ? 'Approved' : 'Declined', by: actor(), decidedAt: T(), reply });
    notify('profile.decided', { approved: yes, note: reply, href: '#my-profile' }, e.id);
    ctx.closeOverlay();
    ctx.commit(yes ? `${e.first}’s details updated` : 'Request declined', yes ? `${ctx.fullName(e)}’s personal details were updated on request` : null);
  }
  function requestsCard() {
    const list = pendingReqs();
    if (!list.length) return '';
    return `<div class="card"><div class="card-head"><h3>Detail changes to approve</h3><span class="hint">${list.length}</span></div><div class="list">${list.map((r) => `<div class="list-item">${ctx.avatar(nameOf(r.empId), 'sm')}<div class="grow"><div class="person-name">${esc(nameOf(r.empId))}</div><div class="person-sub">${esc(r.changes.map((c) => c.label).join(', '))} · ${fmt(r.at, { day: 'numeric', month: 'short' })}</div></div><button class="btn btn-sm btn-primary" data-act="hr-req" data-id="${r.id}">Review</button></div>`).join('')}</div></div>`;
  }

  // ---------- Employee self-service (Profile page) ----------
  function myProfileCards(e) {
    const em = e.emergency || {}, r = arr('editRequests').filter((x) => x.empId === e.id).sort((a, b) => b.at.localeCompare(a.at))[0];
    const a = assetsOf(e.id), l = loansOf(e.id), lists = listsOf(e.id).filter((x) => !H.progress(x).complete);
    return `<div class="card"><div class="card-head"><h3>My personal details</h3><button class="btn btn-sm btn-primary" data-act="hr-req-new">${icon('edit')}Request a change</button></div>
        ${r?.status === 'Pending' ? `<div class="lock-banner">${icon('clock')}<span>Waiting for HR: ${esc(r.changes.map((c) => c.label.toLowerCase()).join(', '))}. <button class="link-btn" data-act="hr-req-cancel" data-id="${r.id}">Cancel</button></span></div>` : r?.status === 'Declined' && r.decidedAt >= U.addDays(T(), -14) ? `<div class="lock-banner warn">${icon('x')}<span>HR declined your last change${r.reply ? `: “${esc(r.reply)}”` : '.'}</span></div>` : ''}
        ${kv([['Phone', esc(e.phone)], ['Personal email', esc(e.personalEmail)], ['Home address', esc(e.address)], ['Emergency contact', em.name ? `${esc(em.name)} (${esc(em.relation || '')}) · ${esc(em.phone || '')}` : ''], ['Salary account', e.bank ? `${esc(e.bank)} ${mask(e.accountNo)}` : ''], ['ID', esc(e.ic || e.passportNo || '')]])}</div>
      ${lists.length ? `<div class="card"><div class="card-head"><h3>My ${lists[0].kind}</h3></div>${lists.map((x) => listCard({ ...x, id: x.id })).join('').replace(/data-act="hr-list"/g, 'data-act="hr-my-list"')}</div>` : ''}
      <div class="card"><div class="card-head"><h3>My documents</h3><button class="btn btn-sm" data-act="hr-doc-mine">${icon('plus')}Add</button></div>${docList(docsOf(e.id), false)}</div>
      <div class="card"><div class="card-head"><h3>Issued to me</h3></div>${a.length ? `<ul class="hr-list">${a.map((x) => `<li><div><strong>${esc(x.name)}</strong> <span class="tag">${esc(x.type)}</span><div class="person-sub">${esc(x.tag)}${x.serial ? ` · S/N ${esc(x.serial)}` : ''} · since ${fmt(x.issued)}</div></div></li>`).join('')}</ul>` : '<p class="faint">Nothing issued.</p>'}${l.length ? `<h4 class="lv-h">Staff loans</h4>${loanRows(l)}` : ''}</div>
      <div class="card"><div class="card-head"><h3>My career</h3></div>${careerList(e, false)}</div>`;
  }

  // ---------- Settings ----------
  function settingsCards() {
    const tpl = (t) => `<div class="hr-tpl"><div class="hr-tpl-head"><strong>${esc(t.name)}</strong><span class="faint">${t.items.length} tasks</span><button class="btn btn-sm" data-act="hr-tpl-edit" data-v="${t.kind}">${icon('edit')}Edit</button></div>
      <ul class="hr-tpl-list">${t.items.map((x) => `<li><span>${esc(x.title)}</span><span class="faint">${esc(H.OWNERS[x.owner])} · ${x.day === 0 ? 'on the day' : x.day < 0 ? `${-x.day} days before` : `${x.day} days after`}</span></li>`).join('')}</ul></div>`;
    const sel = (k, label) => `<div class="settings-row"><div><div class="label">${label}</div><div class="desc">Gets the ${k === 'it' ? 'account and laptop' : 'final pay'} tasks.</div></div><select class="select" data-hr-owner="${k}" style="width:auto"><option value="">HR (${esc(firstOf(hrId()))})</option>${ctx.activeEmployees().map((e) => `<option value="${e.id}" ${cfg()[k] === e.id ? 'selected' : ''}>${esc(ctx.fullName(e))}</option>`).join('')}</select></div>`;
    return `<div class="card" id="hr-checklists"><div class="card-head"><h3>Onboarding and offboarding checklists</h3><a class="hint" href="#onboarding">Open checklists</a></div>
        ${sel('it', 'IT owner')}${sel('payroll', 'Payroll owner')}<div class="grid g-2" style="margin-top:12px">${tpl(cfg().onboarding)}${tpl(cfg().offboarding)}</div></div>
      <div class="card card-flush" id="hr-letters"><div class="card-head" style="padding-bottom:6px"><h3>Letter templates</h3><button class="btn btn-sm" data-act="hr-ltpl" data-id="">${icon('plus')}Add a template</button></div>
        <div class="table-wrap"><table><thead><tr><th>Template</th><th class="hide-sm">Asks for</th><th></th></tr></thead><tbody>${cfg().letters.map((l) => `<tr><td><strong>${esc(l.name)}</strong><div class="person-sub">${esc(l.subject)}</div></td><td class="hide-sm muted">${esc(l.asks.map((k) => H.PLACEHOLDERS[k]).join(', ') || '—')}</td><td><div class="row-actions"><button class="btn btn-sm" data-act="hr-ltpl" data-id="${l.id}">Edit</button>${l.builtin ? '' : `<button class="btn btn-sm btn-icon btn-ghost" data-act="hr-ltpl-del" data-id="${l.id}" aria-label="Remove ${esc(l.name)}">${icon('trash')}</button>`}</div></td></tr>`).join('')}</tbody></table></div>
        <p class="disclaimer" style="margin:0 18px 16px">${icon('pin')}<span>These are company letters, not legal advice. Have an employment lawyer check warning and termination wording against the Employment Act 1955 and your contracts.</span></p></div>`;
  }
  function bindSettings() {
    ctx.$$('[data-hr-owner]').forEach((el) => el.addEventListener('change', () => { cfg()[el.dataset.hrOwner] = el.value; ctx.commit('Checklist owner saved'); }));
  }
  function templateForm(kind) {
    const t = JSON.parse(JSON.stringify(kind === 'onboarding' ? cfg().onboarding : cfg().offboarding));
    const draw = () => { ctx.$('#ct-items').innerHTML = t.items.map((x, i) => `<div class="hr-ct-row"><input class="input" data-i="${i}" data-f="title" value="${esc(x.title)}" aria-label="Task ${i + 1}"><select class="select" data-i="${i}" data-f="kind" aria-label="Kind">${Object.entries(H.KINDS).map(([k, l]) => `<option value="${k}" ${x.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select><select class="select" data-i="${i}" data-f="owner" aria-label="Owner">${Object.entries(H.OWNERS).map(([k, l]) => `<option value="${k}" ${x.owner === k ? 'selected' : ''}>${l}</option>`).join('')}</select><input class="input num" type="number" data-i="${i}" data-f="day" value="${x.day}" aria-label="Days from ${kind === 'onboarding' ? 'start' : 'last day'}" title="Days from the ${kind === 'onboarding' ? 'start date' : 'last day'} (negative = before)"><button type="button" class="btn btn-sm btn-icon btn-ghost" data-del="${i}" aria-label="Remove task">${icon('trash')}</button></div>`).join(''); };
    const pull = () => ctx.$$('#ct-items [data-i]').forEach((el) => { const x = t.items[+el.dataset.i]; x[el.dataset.f] = el.dataset.f === 'day' ? Math.round(+el.value || 0) : el.value; });
    ctx.openModal({
      title: `${kind === 'onboarding' ? 'Onboarding' : 'Offboarding'} template`, size: 'lg', submit: 'Save template',
      body: `<p class="muted">Days count from the ${kind === 'onboarding' ? 'start date' : 'last day'}: −7 is a week before, 30 is a month after. Changes apply to new checklists.</p><div class="hr-ct-head"><span>Task</span><span>Kind</span><span>Owner</span><span>Day</span><span></span></div><div id="ct-items" class="hr-ct"></div><button type="button" class="btn btn-sm" id="ct-add">${icon('plus')}Add a task</button>`,
      onSubmit() { pull(); t.items = t.items.filter((x) => x.title.trim()); if (!t.items.length) { ctx.toast('Keep at least one task', 'error'); return false; } t.items.forEach((x) => { x.id = x.id || U.uid('t'); }); cfg()[kind] = t; ctx.commit('Template saved'); },
    });
    draw();
    ctx.$('#ct-add').addEventListener('click', () => { pull(); t.items.push({ id: '', title: '', kind: 'other', owner: 'hr', day: 0 }); draw(); ctx.$(`#ct-items [data-i="${t.items.length - 1}"]`).focus(); });
    ctx.$('#ct-items').addEventListener('click', (ev) => { const b = ev.target.closest('[data-del]'); if (!b) return; pull(); t.items.splice(+b.dataset.del, 1); draw(); });
  }
  function letterTemplateForm(id) {
    const orig = id ? cfg().letters.find((l) => l.id === id) : null;
    ctx.openModal({
      title: orig ? `Edit ${orig.name}` : 'New letter template', size: 'lg', submit: 'Save template',
      body: `<div class="form-grid"><div class="field"><label for="lx-n">Name</label><input class="input" id="lx-n" name="name" required value="${esc(orig?.name || '')}"></div>
        <div class="field"><label for="lx-s">Subject</label><input class="input" id="lx-s" name="subject" required value="${esc(orig?.subject || '')}"></div>
        <div class="field full"><label for="lx-b">Letter</label><textarea class="textarea hr-letter-body" id="lx-b" name="body" rows="12" required>${esc(orig?.body || 'Dear {{employee.name}},\n\n')}</textarea></div>
        <div class="field full"><span class="label-like">Placeholders (click to insert)</span><div class="chips hr-ph">${Object.entries(H.PLACEHOLDERS).map(([k, l]) => `<button type="button" class="chip" data-ph="${k}" title="${esc(l)}">{{${k}}}</button>`).join('')}</div></div></div>`,
      onSubmit(d) {
        const bad = H.unknownPlaceholders(d.subject + d.body);
        if (bad.length) { ctx.toast(`Unknown placeholder: {{${bad[0]}}}`, 'error'); return false; }
        const fixed = ['employee.', 'manager.', 'company.', 'signatory.', 'today'];
        const asks = H.placeholdersIn(d.subject + d.body).filter((k) => !fixed.some((f) => k.startsWith(f)));
        const x = { name: d.name.trim(), subject: d.subject.trim(), body: d.body, asks };
        if (orig) Object.assign(orig, x); else cfg().letters.push({ id: U.uid('lt'), builtin: false, ...x });
        ctx.commit('Letter template saved');
      },
    });
    const ta = ctx.$('#lx-b');
    ctx.$$('[data-ph]').forEach((b) => b.addEventListener('click', () => { const s = ta.selectionStart, v = `{{${b.dataset.ph}}}`; ta.setRangeText(v, s, ta.selectionEnd, 'end'); ta.focus(); }));
  }

  // ---------- Reminders and insights ----------
  // Documents and policies with an expiry date, for the daily reminders in js/notify.js.
  const expiringItems = () => [
    ...arr('documents').filter((d) => d.expiry && emp(d.empId) && emp(d.empId).status !== 'Inactive').map((d) => ({ id: d.id, empId: d.empId, title: d.title, expiry: d.expiry })),
    ...arr('insurance').map((p) => ({ id: p.id, empId: '', title: `${p.name} (${p.insurer})`, expiry: p.end })),
  ];
  function runReminders() {
    const week = Math.floor((U.parse(T()) - U.parse('2020-01-06')) / 6048e5), by = {};
    H.overdueTasks(arr('checklists').filter((l) => emp(l.empId)), T()).forEach((x) => { (by[x.assignee] = by[x.assignee] || []).push(x); });
    Object.entries(by).forEach(([to, xs]) => notify('task.overdue', { count: xs.length, first: xs[0].title, who: nameOf(xs[0].empId), href: to === hrId() ? '#onboarding' : '#my-approvals' }, to, { from: 'system', self: true, key: `tasks:${to}:${week}` }));
  }
  function insights() {
    const out = [];
    if (ctx.role() === 'admin') {
      const r = pendingReqs();
      if (r.length) out.push({ tone: 'info', icon: 'edit', title: `${r.length} detail change${r.length === 1 ? '' : 's'} to approve`, detail: r.slice(0, 3).map((x) => firstOf(x.empId)).join(', '), action: { label: 'Review', act: 'hr-req', id: r[0].id }, prio: 2 });
      const late = H.overdueTasks(arr('checklists').filter((l) => emp(l.empId)), T());
      if (late.length) out.push({ tone: 'warn', icon: 'userplus', title: `${late.length} onboarding or offboarding task${late.length === 1 ? ' is' : 's are'} overdue`, detail: [...new Set(late.map((x) => nameOf(x.empId)))].slice(0, 3).join(', '), action: { label: 'Open', href: '#onboarding' }, prio: 2 });
      const held = arr('assets').filter((a) => a.holder && emp(a.holder)?.endDate && emp(a.holder).endDate <= U.addDays(T(), 14));
      if (held.length) out.push({ tone: 'warn', icon: 'box', title: `${held.length} asset${held.length === 1 ? '' : 's'} to collect from leavers`, detail: held.slice(0, 3).map((a) => `${a.name} (${firstOf(a.holder)})`).join(', '), action: { label: 'Assets', href: '#assets' }, prio: 2 });
      const exp = H.expiring(expiringItems(), T(), 30);
      if (exp.length) out.push({ tone: exp[0].left < 0 ? 'bad' : 'warn', icon: 'doc', title: `${exp.length} document${exp.length === 1 ? '' : 's'} or polic${exp.length === 1 ? 'y' : 'ies'} expiring within 30 days`, detail: exp.slice(0, 2).map((x) => `${x.title}${x.empId ? ` (${firstOf(x.empId)})` : ''}`).join(', '), action: x0(exp[0]), prio: 1 });
    }
    if (ctx.role() === 'employee') {
      const me = ctx.me().id, mine = arr('checklists').filter((l) => emp(l.empId)).flatMap((l) => l.tasks.filter((x) => x.assignee === me && !x.done).map((x) => ({ ...x, l })));
      if (mine.length) out.push({ tone: mine.some((x) => x.due < T()) ? 'warn' : 'info', icon: 'userplus', title: `${mine.length} onboarding or offboarding task${mine.length === 1 ? '' : 's'} for you`, detail: mine.slice(0, 2).map((x) => x.title).join(', '), action: { label: 'Open', act: 'hr-my-list', id: mine[0].l.id }, prio: 2 });
    }
    return out;
  }
  const x0 = (x) => (x.empId ? { label: 'Open', act: 'view-emp', id: x.empId } : { label: 'Insurance', href: '#assets' });

  function install(c) {
    ctx = c;
    ctx.VIEWS.onboarding = onboardingView;
    ctx.VIEWS.assets = assetsView;
    ctx.AFTER.assets = () => { const q = ctx.$('#as-q'); q?.addEventListener('input', () => { ui.assetQ = q.value; const pos = q.selectionStart; ctx.render(); const n = ctx.$('#as-q'); n.focus(); n.setSelectionRange(pos, pos); }); };
    ctx.VIEWS['org-chart'] = orgView;
    ctx.AFTER['org-chart'] = () => { ctx.$('#org-dept')?.addEventListener('change', (ev) => { ui.orgDept = ev.target.value; ctx.render(); }); };
    Object.assign(ctx.ACTIONS, {
      'hr-ptab': (id, v) => ctx.openProfile(id, v),
      'hr-personal': (id) => personalForm(id),
      'hr-edu': (id) => rowForm(id, 'education'),
      'hr-job': (id) => rowForm(id, 'employment'),
      'hr-row-del': (id, v) => { const [k, i] = v.split(':'); emp(id)[k].splice(+i, 1); ctx.save(); ctx.openProfile(id, 'personal'); ctx.toast('Removed'); },
      'hr-career': (id) => careerForm(id),
      'hr-career-del': (id, v) => { const e = emp(id); e.career = (e.career || []).filter((x) => x.id !== v); ctx.save(); ctx.openProfile(id, 'career'); ctx.toast('Entry removed'); },
      'hr-doc-up': (id) => uploadForm(id),
      'hr-doc-mine': () => uploadForm(ctx.me().id, true),
      'hr-doc-view': (id) => viewDoc(id),
      'hr-doc-del': (id) => { const d = arr('documents').find((x) => x.id === id); st().documents = arr('documents').filter((x) => x.id !== id); ctx.save(); ctx.openProfile(d.empId, 'documents'); ctx.toast('Document deleted'); },
      'hr-letter': (id) => letterForm(id),
      'hr-tab': (_, v) => { ui.tab = v; ctx.render(); },
      'hr-list': (id) => openList(id),
      'hr-my-list': (id) => openList(id, true),
      'hr-list-del': (id) => { st().checklists = arr('checklists').filter((x) => x.id !== id); ctx.closeOverlay(); ctx.commit('Checklist removed'); },
      'hr-start': (id, v) => { const e = emp(id); startChecklist(id, v, v === 'onboarding' ? (e.start > T() ? e.start : T()) : e.endDate || T()); ctx.save(); ctx.openProfile(id, 'checklists'); ctx.toast('Checklist started'); },
      'hr-offboard': (id) => offboardForm(id || ''),
      'hr-exit': (id) => exitForm(id),
      'hr-atab': (_, v) => { ui.assetTab = v; ctx.render(); },
      'hr-asset-issue': (id, v) => assetForm('', v || ''),
      'hr-asset-edit': (id) => assetForm(id),
      'hr-asset-return': (id, v) => { const a = arr('assets').find((x) => x.id === id), who = a.holder; returnAsset(a); ctx.commit(`${a.name} returned`, `${a.name} (${a.tag}) returned by ${nameOf(who)}`); if (v) reopen(() => ctx.openProfile(v, 'assets')); },
      'hr-asset-csv': () => ctx.downloadCSV('assets.csv', [['Tag', 'Type', 'Asset', 'Serial', 'Value', 'Bought', 'Holder', 'Issued', 'Notes'], ...arr('assets').map((a) => [a.tag, a.type, a.name, a.serial, a.value, a.bought, a.holder ? nameOf(a.holder) : 'In store', a.issued, a.notes])]),
      'hr-loan': (id, v) => loanForm(id, v || ''),
      'hr-repay': (id) => repayForm(id),
      'hr-policy': (id) => policyForm(id),
      'hr-org-print': () => ctx.docs.printDocs(`<article class="doc org-print"><header class="doc-head"><div><div class="doc-co">${esc(st().settings.company.toUpperCase())}</div><div class="doc-sub">Organisation chart${ui.orgDept !== 'all' ? ` · ${esc(deptName(ui.orgDept))}` : ''} · ${long(T())}</div></div></header>${orgHtml(true)}</article>`, `Org chart ${st().settings.company}`),
      'hr-req-new': () => requestForm(),
      'hr-req-cancel': (id) => { st().editRequests = arr('editRequests').filter((x) => x.id !== id); ctx.commit('Request cancelled'); },
      'hr-req': (id) => reviewRequest(id),
      'hr-req-decide': (id, v) => decide(id, v === 'yes'),
      'hr-tpl-edit': (_, v) => templateForm(v),
      'hr-ltpl': (id) => letterTemplateForm(id),
      'hr-ltpl-del': (id) => { cfg().letters = cfg().letters.filter((l) => l.id !== id); ctx.commit('Template removed'); },
      'hr-goto-settings': (_, v) => { window.AllurusSettingsGo(v); },
    });
    return { TABS, tabBar, tabBody, onCreated, afterEdit, remove, addCareer, requestsCard, myProfileCards, myTasksCard, settingsCards, bindSettings, expiringItems, runReminders, insights, startChecklist, pendingCount: () => pendingReqs().length, openList,
      overdueCount: () => H.overdueTasks(arr('checklists').filter((l) => emp(l.empId)), T()).length,
      hasTasks: (id) => !!id && arr('checklists').some((l) => emp(l.empId) && l.empId !== id && l.tasks.some((x) => x.assignee === id && !x.done)) };
  }
  return { install };
})();

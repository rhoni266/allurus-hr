// Check-in extras: fake-GPS flags, the offline outbox (with the service worker so the page opens offline), the
// kiosk tablet (face recognition against reference photos, no password), supervisor check-in of team members on
// the supervisor's phone, and the optional project or job picked at check-in. The rules live in
// js/checkin-rules.js (AllurusCheckinRules); the employee's own selfie check-in stays in js/app.js.
window.AllurusKiosk = (function () {
  'use strict';
  const C = window.AllurusCheckinRules;
  const KIOSK_KEY = 'allurus-kiosk', OUTBOX_KEY = 'allurus-outbox', FIX_KEY = 'allurus-last-fix';
  let ctx = null, ck = null;
  const st = () => ctx.state;
  const esc = (s) => ctx.esc(s);
  const T = () => U.today();
  const cfg = () => st().settings.checkin;
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } };
  const online = () => navigator.onLine !== false;

  // ---------- Fake-GPS heuristics ----------
  function gpsCheck(e, loc) {
    if (!loc || loc.lat == null) return [];
    const history = Object.entries(st().attendance).map(([day, recs]) => ({ day, r: recs[e.id] })).filter((x) => x.r?.loc?.lat != null).map((x) => ({ day: x.day, lat: x.r.loc.lat, lng: x.r.loc.lng }));
    const tzOffsetMin = -new Date().getTimezoneOffset();
    return C.gpsFlags({ fix: { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracyRaw ?? loc.accuracy, t: Date.now() }, last: read(FIX_KEY, null), history, day: T(), tzOffsetMin });
  }
  const rememberFix = (loc) => { if (loc?.lat != null) write(FIX_KEY, { lat: loc.lat, lng: loc.lng, t: Date.now() }); };

  // ---------- Offline outbox ----------
  const outbox = () => read(OUTBOX_KEY, []);
  // Every check-in is queued for the server, so one taken without a connection still arrives later.
  function queue(e, day, rec, via) {
    const id = `${day}|${e.id}|${rec.lastIn || rec.in}|${via}`;
    const payload = { company: st().settings.company, empId: e.id, employee: ctx.fullName(e), day, time: rec.lastIn || rec.in, out: rec.out || '', mode: rec.s, via, lat: rec.loc?.lat ?? null, lng: rec.loc?.lng ?? null, accuracy: rec.loc?.accuracy ?? null, label: rec.loc?.zone || rec.loc?.label || '', flags: (rec.flags || []).map((f) => f.code), face: rec.face?.result || '', project: rec.project || '', offline: !!rec.offline, capturedAt: new Date().toISOString() };
    write(OUTBOX_KEY, C.enqueue(outbox(), { id, payload, offline: !!rec.offline, capturedAt: payload.capturedAt }));
    // HR hears about check-ins that need a look.
    const reasons = [...(rec.flags || []).map((f) => f.reason), ...(['mismatch', 'unavailable'].includes(rec.face?.result) ? [rec.face.result === 'mismatch' ? 'The face didn’t match the reference photo.' : 'The face check couldn’t run.'] : []), ...(rec.upload ? ['Uploaded photo instead of the live camera.'] : [])];
    if (reasons.length) ctx.notify?.event('checkin.flagged', { who: ctx.fullName(e), reason: reasons.join(' '), href: '#attendance' }, 'hr', { from: e.id });
    sync();
  }
  let syncing = false;
  // Sends waiting check-ins to the shared check-in log (the server, once there is one) and marks them synced.
  async function sync(force = false) {
    if (syncing || !outbox().length) return;
    syncing = true;
    try {
      const r = await C.syncOutbox(outbox(), async (x) => {
        if (!online()) throw new Error('Offline');
        if (ck.cloudOn()) { const ok = await ck.cloudWrite('checkins', { ...x.payload, mode: x.payload.mode, time: x.payload.capturedAt }); if (!ok) throw new Error('The server did not accept it'); }
        return true;
      }, { online: online(), force });
      write(OUTBOX_KEY, r.box);
      if (r.sent.length) {
        let changed = false;
        r.sent.forEach((id) => { const [day, empId] = id.split('|'); const rec = st().attendance[day]?.[empId]; if (rec?.offline && !rec.syncedAt) { rec.syncedAt = new Date().toISOString(); changed = true; } });
        if (changed) { ctx.save(); if (!document.querySelector('#overlay-root form') && !kioskOn()) ctx.render(); }
        ctx.toast(`${r.sent.length} check-in${r.sent.length === 1 ? '' : 's'} synced`);
      }
    } finally { syncing = false; }
  }
  const waitingFor = (empId) => outbox().filter((x) => !empId || x.payload.empId === empId);
  function syncBanner(empId) {
    const n = waitingFor(empId).length;
    if (!n) return '';
    return `<div class="sync-note" role="status">${ctx.icon('clock')}<span>${n} check-in${n === 1 ? '' : 's'} ${online() ? 'sending…' : 'saved on this phone. They’ll sync when you’re back online.'}</span></div>`;
  }
  function offlineBar() {
    let bar = document.getElementById('offline-bar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'offline-bar'; bar.className = 'offline-bar'; bar.setAttribute('role', 'status'); document.body.appendChild(bar); }
    bar.hidden = online();
    bar.textContent = 'You’re offline. Check-ins are saved on this device and sync when you’re back online.';
  }

  // ---------- Projects ----------
  const projects = () => (st().projects || []).filter((p) => p.active !== false);
  const projectMode = () => cfg().projects || 'off';
  const projectOf = (id) => (st().projects || []).find((p) => p.id === id);
  // Projects with jobs list each job (value "project|job") under the project; others are picked as a whole.
  const jobsOf = (pid) => { const c = st().costing || {}; return (c.groups || []).filter((g) => g.projectId === pid).flatMap((g) => (c.jobs || []).filter((j) => j.groupId === g.id && j.active !== false).map((j) => ({ ...j, group: g }))); };
  const projectOptions = (cur) => projects().map((p) => { const js = jobsOf(p.id); return js.length ? `<optgroup label="${esc(p.code)} · ${esc(p.name)}"><option value="${p.id}" ${cur === p.id ? 'selected' : ''}>${esc(p.code)} · general</option>${js.map((j) => `<option value="${p.id}|${j.id}" ${cur === `${p.id}|${j.id}` ? 'selected' : ''}>${esc(j.code || '')} ${esc(j.group.name)} · ${esc(j.name)}</option>`).join('')}</optgroup>` : `<option value="${p.id}" ${cur === p.id ? 'selected' : ''}>${esc(p.code)} · ${esc(p.name)}</option>`; }).join('');
  const projectField = (id = 'ci-project', cur = '') => (projectMode() === 'off' || !projects().length ? '' : `<div class="field ci-project"><label for="${id}">Project or job${projectMode() === 'required' ? '' : ' (optional)'}</label><select class="select" id="${id}"><option value="">${projectMode() === 'required' ? 'Choose a project' : 'None'}</option>${projectOptions(cur)}</select></div>`);
  // Reads the picked project; false when one is required and missing.
  function pickedProject(id = 'ci-project') {
    const v = document.getElementById(id)?.value || '';
    if (!v && projectMode() === 'required' && projects().length) { ctx.toast('Choose the project or job you’re working on', 'error'); document.getElementById(id)?.focus(); return false; }
    return v;
  }
  const projectTag = (r) => (r?.project && projectOf(r.project) ? `<span class="tag" title="${esc(projectOf(r.project).name)}">${esc(projectOf(r.project).code)}</span>` : '');

  // ---------- HR review ----------
  // Flagged check-ins in the last week that HR hasn't marked as looked at.
  function flagged() {
    const out = [], from = U.addDays(T(), -7);
    Object.entries(st().attendance).filter(([d]) => d >= from).forEach(([day, recs]) => Object.entries(recs).forEach(([empId, r]) => {
      if (r.reviewed) return;
      const reasons = [...(r.flags || []).map((f) => f.reason)];
      if (r.face?.result === 'mismatch') reasons.push('The face didn’t match the reference photo.');
      if (r.face?.result === 'unavailable') reasons.push('The face check couldn’t run.');
      if (r.upload) reasons.push('Uploaded photo instead of the live camera.');
      if (reasons.length && ctx.emp(empId)) out.push({ day, empId, r, reasons });
    }));
    return out.sort((a, b) => b.day.localeCompare(a.day));
  }
  const viaText = (r) => (r.via === 'kiosk' ? `kiosk${r.device?.name ? ` (${r.device.name.replace(/^Kiosk: /, '')})` : ''}` : r.via === 'supervisor' ? `by ${ctx.emp(r.by)?.first || 'a supervisor'}` : '');
  function reviewItems() {
    return flagged().map(({ day, empId, r, reasons }) => `<div class="list-item">${ck.selfieThumb(empId, day, r)}<div class="grow"><div class="person-name">${esc(ctx.fullName(ctx.emp(empId)))} <span class="faint">· ${U.fmtDate(day, { weekday: 'short', day: 'numeric', month: 'short' })}, ${r.lastIn || r.in}${viaText(r) ? ` · ${esc(viaText(r))}` : ''}${r.offline ? ' · captured offline' : ''}</span></div>
      <ul class="flag-list">${reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><button class="btn btn-sm" data-act="ck-ok" data-id="${empId}" data-v="${day}">Looks fine</button></div>`).join('');
  }

  // ---------- Kiosk ----------
  const kioskId = () => read(KIOSK_KEY, null);
  const kioskOf = (id) => (cfg().kiosks || []).find((k) => k.id === id);
  const kioskOn = () => !!(kioskId() && kioskOf(kioskId()));
  const kui = { stage: 'idle', match: null, timer: null, stream: null, frame: null, error: '', last: null };
  const faceReady = () => window.AllurusFace?.load();
  const kioskPeople = () => ctx.activeEmployees().filter((e) => e.face?.descriptor?.length && e.face.status === 'confirmed').map((e) => ({ id: e.id, descriptor: e.face.descriptor }));
  function kioskHtml() {
    const k = kioskOf(kioskId()), z = ck.zone(), m = kui.match, e = m && ctx.emp(m.id), rec = e && st().attendance[T()]?.[e.id];
    const act = e ? C.kioskAction(rec) : 'in';
    const today = Object.values(st().attendance[T()] || {}).filter((r) => r.via === 'kiosk').length;
    const panel = {
      idle: `<button class="btn btn-primary kiosk-go" data-act="ck-scan">${ctx.icon('camera')}Check in or out</button><p class="muted">Tap, then look at the camera.</p>`,
      loading: `<div class="ci-status"><span class="spinner" aria-hidden="true"></span><div><strong>Getting ready</strong><p class="muted">Loading face recognition on this tablet.</p></div></div>`,
      scan: `<div class="ci-status"><span class="spinner" aria-hidden="true"></span><div><strong>Looking…</strong><p class="muted">Face the camera, one person at a time.</p></div></div>`,
      match: e ? `<div class="kiosk-hi">${kui.frame ? `<img src="${kui.frame}" alt="">` : ''}<div><div class="kpi-label">${act === 'out' ? 'Checking out' : 'Checking in'}</div><strong>${esc(ctx.fullName(e))}</strong><div class="muted">${esc(e.role)}${m.result === 'weak' ? ' · weak match, HR will review' : ''}</div></div></div>
        ${act === 'in' ? projectField('k-project') : ''}
        <div class="kiosk-count" aria-live="polite"><span id="k-count">3</span></div>
        <div class="ci-actions"><button class="btn" data-act="ck-cancel">Not me</button><button class="btn btn-primary" data-act="ck-confirm">${ctx.icon('check')}${act === 'out' ? 'Check out' : 'Check in'} now</button></div>` : '',
      done: kui.last ? `<div class="kiosk-done">${ctx.icon('check')}<strong>${esc(kui.last.text)}</strong></div>` : '',
      error: `<div class="ci-problem">${ctx.icon('pin')}<div><strong>${esc(kui.error)}</strong><p class="muted">Try again, or check in on your own phone.</p></div></div><div class="ci-actions"><button class="btn btn-primary" data-act="ck-scan">Try again</button></div>`,
    }[kui.stage];
    return `<div class="kiosk-wrap"><header class="kiosk-head"><div class="kiosk-brand">${ctx.LOGO_MARK}<div><strong>${esc(st().settings.company)}</strong><span>${esc(k?.label || 'Kiosk')} · ${esc(z.label || '')}</span></div></div>
        <div class="kiosk-clock" id="k-clock">${ck.nowHM()}</div><button class="btn btn-ghost btn-sm" data-act="ck-exit">Exit kiosk</button></header>
      <main class="kiosk-main"><div class="kiosk-cam"><video id="k-video" playsinline autoplay muted></video></div>
        <div class="kiosk-panel" aria-live="polite">${panel}</div></main>
      <footer class="kiosk-foot">${online() ? '' : '<span class="tag warn">Offline: check-ins sync later</span> '}${today} kiosk check-ins today. Face recognition runs on this tablet. Only staff who agreed to the face check, with a reference photo confirmed by HR, can use it.</footer></div>`;
  }
  function renderKiosk() {
    const root = document.getElementById('kiosk-root');
    root.hidden = false; document.getElementById('login').hidden = true; document.querySelector('.app').hidden = true;
    root.innerHTML = kioskHtml();
    if (kui.stream) { const v = document.getElementById('k-video'); v.srcObject = kui.stream; v.play().catch(() => {}); }
    else startCamera();
    if (kui.stage === 'match') countdown();
    clearInterval(kui.clock); kui.clock = setInterval(() => { const c = document.getElementById('k-clock'); if (c) c.textContent = ck.nowHM(); else clearInterval(kui.clock); }, 5000);
  }
  async function startCamera() {
    try {
      kui.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
      const v = document.getElementById('k-video'); if (v) { v.srcObject = kui.stream; await v.play(); }
    } catch (e) { Object.assign(kui, { stage: 'error', error: 'The camera isn’t available on this tablet' }); renderKiosk(); }
  }
  const stopKiosk = () => { clearTimeout(kui.timer); clearInterval(kui.clock); kui.stream?.getTracks().forEach((t) => t.stop()); Object.assign(kui, { stream: null, stage: 'idle', match: null }); document.getElementById('kiosk-root').hidden = true; };
  async function scan() {
    clearTimeout(kui.timer);
    const v = document.getElementById('k-video');
    if (!v || !v.videoWidth) { Object.assign(kui, { stage: 'error', error: 'The camera isn’t ready yet' }); renderKiosk(); return; }
    const big = ck.squareCanvas(v, v.videoWidth, v.videoHeight, true, 480);
    kui.frame = ck.squareCanvas(v, v.videoWidth, v.videoHeight, true, 320).toDataURL('image/jpeg', 0.72);
    kui.stage = 'loading'; renderKiosk();
    try { await faceReady(); } catch (e) { Object.assign(kui, { stage: 'error', error: 'Face recognition couldn’t load on this tablet' }); renderKiosk(); return; }
    kui.stage = 'scan'; renderKiosk();
    let faces;
    try { faces = await AllurusFace.describe(big); } catch (e) { Object.assign(kui, { stage: 'error', error: 'Face recognition couldn’t run' }); renderKiosk(); return; }
    if (!faces.length) { Object.assign(kui, { stage: 'error', error: 'No face found. Stand in front of the camera.' }); renderKiosk(); return; }
    if (faces.length > 1) { Object.assign(kui, { stage: 'error', error: 'One person at a time, please' }); renderKiosk(); return; }
    const m = C.bestMatch(faces[0].descriptor, kioskPeople(), AllurusFace.distance, { match: AllurusFace.MATCH, weak: AllurusFace.WEAK });
    if (m.result === 'none') { Object.assign(kui, { stage: 'error', error: 'We don’t recognise you. Ask HR to confirm your reference photo.' }); renderKiosk(); return; }
    if (m.result === 'ambiguous') { Object.assign(kui, { stage: 'error', error: 'Not sure who you are. Remove glasses or a mask and try again.' }); renderKiosk(); return; }
    Object.assign(kui, { stage: 'match', match: m });
    renderKiosk();
  }
  // Three seconds to say "Not me"; then the check-in is saved.
  function countdown() {
    let n = 3;
    clearTimeout(kui.timer);
    const tick = () => {
      const el = document.getElementById('k-count'); if (!el || kui.stage !== 'match') return;
      el.textContent = n;
      if (n-- <= 0) { confirmKiosk(); return; }
      kui.timer = setTimeout(tick, 1000);
    };
    tick();
    document.getElementById('k-project')?.addEventListener('change', () => countdown());
  }
  function confirmKiosk() {
    clearTimeout(kui.timer);
    const m = kui.match, e = m && ctx.emp(m.id); if (!e) return;
    const day = T(), t = ck.nowHM(), rec = st().attendance[day]?.[e.id], k = kioskOf(kioskId()), z = ck.zone();
    let text;
    if (C.kioskAction(rec) === 'out') {
      rec.out = t; text = `Bye ${e.first}, checked out at ${t}`;
    } else {
      const project = pickedProject('k-project'); if (project === false) { countdown(); return; }
      const r = ck.write(e, { mode: 'present', time: t, photo: kui.frame, loc: { lat: z.lat, lng: z.lng, accuracy: null, source: 'kiosk', inside: true, m: 0, zone: z.label, label: k?.label || 'Kiosk' }, face: { result: m.result, sim: AllurusFace.similarity(m.d) }, device: { id: ck.deviceId(), name: `Kiosk: ${k?.label || 'tablet'}` }, via: 'kiosk', project, offline: !online() });
      queue(e, day, r, 'kiosk');
      text = `Welcome, ${e.first}. Checked in at ${t}`;
    }
    ctx.save();
    Object.assign(kui, { stage: 'done', match: null, last: { text } });
    renderKiosk();
    kui.timer = setTimeout(() => { kui.stage = 'idle'; renderKiosk(); }, 2500);
  }
  function exitKiosk() {
    ctx.openModal({
      title: 'Exit kiosk mode', size: 'sm', submit: 'Exit',
      body: `<p class="muted" style="margin-bottom:12px">An admin signs in to turn this tablet back into a normal device.</p><div class="form-grid"><div class="field full"><label for="kx-email">Admin email</label><input class="input" id="kx-email" name="email" type="email" required autocomplete="username"></div><div class="field full"><label for="kx-pw">Password</label><input class="input" id="kx-pw" name="pw" type="password" required autocomplete="current-password"></div></div>`,
      onSubmit(d) {
        const a = st().accounts.find((x) => x.email === d.email.trim().toLowerCase() && x.roles.includes('admin'));
        U.hashPassword(d.email.trim().toLowerCase(), d.pw).then((h) => {
          if (!a || a.hash !== h) { ctx.toast('That isn’t an admin email and password', 'error'); return; }
          write(KIOSK_KEY, null); ctx.closeOverlay(); stopKiosk(); ctx.render(); ctx.toast('Kiosk mode is off on this device');
        });
        return false;
      },
    });
  }

  // ---------- Supervisor check-in ----------
  const isSupervisor = (e) => !!e && cfg().supervisor !== false && (ctx.leave?.myDepts(e.id).length > 0 || st().departments.some((d) => d.lead === e.id));
  const team = (e) => { const depts = new Set([...(ctx.leave?.myDepts(e.id) || []), ...st().departments.filter((d) => d.lead === e.id).map((d) => d.id)]); return ctx.activeEmployees().filter((x) => x.id !== e.id && depts.has(x.dept)).sort((a, b) => a.first.localeCompare(b.first)); };
  const sv = { member: null, loc: null, photo: null, canvas: null, face: null, stream: null };
  const svStop = () => { sv.stream?.getTracks().forEach((t) => t.stop()); sv.stream = null; };
  const svStep = (html) => { const b = document.getElementById('sv-body'); if (b) b.innerHTML = html; return !!b; };
  function supervisor() {
    const me = ctx.me(), list = team(me), recs = st().attendance[T()] || {};
    Object.assign(sv, { member: null, loc: null, photo: null, canvas: null, face: null });
    ctx.openModal({ title: 'Check in a team member', size: 'sm', submit: null, body: `<div id="sv-body"><p class="muted" style="margin-bottom:10px">For team members without their phone. Take a photo of them; it’s checked against their reference photo, with your location.</p>
      <div class="list">${list.map((x) => { const r = recs[x.id]; return `<div class="list-item">${ctx.avatar(ctx.fullName(x), 'sm')}<div class="grow"><div class="person-name">${esc(ctx.fullName(x))}</div><div class="person-sub">${r?.in ? `In since ${r.lastIn || r.in}` : r?.s === 'leave' ? 'On leave' : x.face ? 'Not checked in' : 'No face check yet: they check in once on their own phone first'}</div></div>${!r?.in && r?.s !== 'leave' && x.face?.descriptor ? `<button class="btn btn-sm btn-primary" data-act="sv-pick" data-id="${x.id}">Check in</button>` : ''}</div>`; }).join('') || '<div class="empty">No one in your team.</div>'}</div></div>` });
    document.querySelector('#overlay-root .modal-foot').hidden = true;
  }
  async function svPick(id) {
    sv.member = ctx.emp(id);
    svStep(`<div class="ci-status"><span class="spinner" aria-hidden="true"></span><div><strong>Noting your location</strong><p class="muted">Your phone’s position is saved with ${esc(sv.member.first)}’s check-in.</p></div></div>`);
    const z = ck.zone(), loc = await U.locate({ gpsOnly: true });
    if (!document.getElementById('sv-body')) return;
    sv.loc = loc ? { ...loc, ...(z.source === 'checkin' ? U.checkZone(loc, z) : {}) } : null;
    faceReady()?.catch(() => {});
    svStep(`<p class="muted">Point the camera at ${esc(sv.member.first)}, in good light.</p><div class="ci-cam"><video id="sv-video" playsinline autoplay muted></video></div>
      <div class="ci-actions"><button class="btn" data-act="close-overlay">Cancel</button><button class="btn btn-primary" data-act="sv-shoot" id="sv-shoot" disabled>${ctx.icon('camera')}Take photo</button></div>`);
    try {
      sv.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
      const v = document.getElementById('sv-video'); if (!v) { svStop(); return; }
      v.srcObject = sv.stream; await v.play(); document.getElementById('sv-shoot').disabled = false;
    } catch (e) { svStop(); svStep(`<div class="ci-problem">${ctx.icon('camera')}<div><strong>Allow the camera</strong><p class="muted">Supervisor check-in needs a live photo of the team member.</p></div></div><div class="ci-actions"><button class="btn" data-act="close-overlay">Close</button></div>`); }
  }
  async function svShoot() {
    const v = document.getElementById('sv-video'); if (!v?.videoWidth) return;
    sv.canvas = ck.squareCanvas(v, v.videoWidth, v.videoHeight, false, 480);
    sv.photo = ck.squareCanvas(v, v.videoWidth, v.videoHeight, false, 320).toDataURL('image/jpeg', 0.72);
    svStop();
    svStep(`<div class="ci-status"><span class="spinner" aria-hidden="true"></span><div><strong>Checking it’s ${esc(sv.member.first)}</strong></div></div>`);
    try {
      await faceReady();
      const faces = await AllurusFace.describe(sv.canvas);
      if (faces.length !== 1) { svStep(`<div class="ci-problem">${ctx.icon('pin')}<div><strong>${faces.length ? 'One person at a time' : 'No face found'}</strong><p class="muted">Take the photo again with only ${esc(sv.member.first)} in it.</p></div></div><div class="ci-actions"><button class="btn btn-primary" data-act="sv-pick" data-id="${sv.member.id}">Try again</button></div>`); return; }
      const d = AllurusFace.distance(faces[0].descriptor, sv.member.face.descriptor);
      sv.face = { result: AllurusFace.verdict(d), sim: AllurusFace.similarity(d) };
    } catch (e) { sv.face = { result: 'unavailable', sim: null }; }
    const ok = sv.face.result === 'match';
    svStep(`<div class="ci-cam"><img class="ci-photo" src="${sv.photo}" alt="Photo of ${esc(sv.member.first)}"></div>
      <div class="ci-where ${ok ? 'ok' : sv.face.result === 'mismatch' ? 'bad' : ''}">${ctx.icon(ok ? 'check' : 'pin')}<span>${ok ? `Matches ${esc(sv.member.first)}’s reference photo (${sv.face.sim}%)` : sv.face.result === 'weak' ? `Weak match (${sv.face.sim}%). HR will review it.` : sv.face.result === 'mismatch' ? `Doesn’t look like ${esc(sv.member.first)}. HR will review it.` : 'The face check couldn’t run. HR will review it.'}</span></div>
      ${sv.loc ? '' : `<div class="ci-where">${ctx.icon('pin')}<span>Your location wasn’t available. HR will see that.</span></div>`}
      ${projectField('sv-project')}
      <div class="ci-actions"><button class="btn" data-act="sv-pick" data-id="${sv.member.id}">Retake</button><button class="btn btn-primary" data-act="sv-confirm">${ctx.icon('check')}Check in ${esc(sv.member.first)}</button></div>`);
  }
  function svConfirm() {
    const e = sv.member, me = ctx.me(); if (!e || !sv.photo) return;
    const project = pickedProject('sv-project'); if (project === false) return;
    const z = ck.zone(), L = sv.loc, t = ck.nowHM();
    const flags = [...gpsCheck(me, L)];
    if (!L) flags.push({ code: 'no-location', reason: 'The supervisor’s phone did not share a location.' });
    else if (z.source === 'checkin' && L.inside === false && !ck.isField(me)) flags.push({ code: 'outside', reason: `Checked in by a supervisor ${U.fmtDist(L.m)} from ${z.label}, outside the check-in zone.` });
    const loc = L ? { lat: L.lat, lng: L.lng, accuracy: L.accuracy, source: 'gps', m: L.m ?? null, inside: L.inside ?? null, zone: z.label, label: L.label } : null;
    const r = ck.write(e, { mode: 'present', time: t, photo: sv.photo, loc, face: sv.face, device: { id: ck.deviceId(), name: `${ck.deviceName()} (${me.first}’s phone)` }, via: 'supervisor', by: me.id, project, flags, offline: !online() });
    rememberFix(L);
    queue(e, T(), r, 'supervisor');
    ctx.closeOverlay();
    ctx.commit(`${e.first} checked in at ${t}`, `${ctx.fullName(me)} checked in ${ctx.fullName(e)} with a photo (supervisor check-in)`);
  }

  // ---------- Settings ----------
  function settingsCard() {
    const ks = cfg().kiosks || [], here = ck.deviceId(), mode = projectMode();
    const seg = (act, cur, opts) => `<div class="seg">${opts.map(([v, l]) => `<button type="button" data-act="${act}" data-v="${v}" class="${cur === v ? 'on' : ''}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
    return `<div class="card" id="ck-kiosks"><div class="card-head"><h3>Kiosks, supervisors and projects</h3></div>
      <div class="settings-row"><div><div class="label">Kiosk tablets</div><div class="desc">A shared tablet at the entrance. Staff check in one after another by face, with no password. Turn this device into a kiosk to start.</div></div><button class="btn" data-act="ck-make-kiosk">${ctx.icon('camera')}Make this device a kiosk</button></div>
      ${ks.length ? `<div class="list" style="margin-bottom:8px">${ks.map((k) => `<div class="list-item"><div class="grow"><div class="person-name">${esc(k.label)}${k.id === here ? ' <span class="tag">This device</span>' : ''}</div><div class="person-sub">Added ${U.fmtDate(k.added)}</div></div><button class="btn btn-sm btn-ghost" data-act="ck-kiosk-del" data-id="${k.id}">Remove</button></div>`).join('')}</div>` : ''}
      <div class="settings-row"><div><div class="label">Supervisor check-in</div><div class="desc">Department heads and approvers can check in team members on their own phone, with a photo of each person.</div></div>${seg('ck-sup', cfg().supervisor === false ? 'off' : 'on', [['off', 'Off'], ['on', 'On']])}</div>
      <div class="settings-row"><div><div class="label">Project or job at check-in</div><div class="desc">Ask which project people are working on, for project costing later.</div></div>${seg('ck-proj-mode', mode, [['off', 'Off'], ['optional', 'Optional'], ['required', 'Required']])}</div>
      ${mode !== 'off' ? `<div class="table-wrap"><table class="policy"><thead><tr><th>Code</th><th>Project or job</th><th class="hide-sm">Client</th><th>Active</th></tr></thead><tbody>
        ${(st().projects || []).map((p) => `<tr class="${p.active === false ? 'off' : ''}"><td><input class="input" data-proj="${p.id}" data-f="code" value="${esc(p.code)}" style="width:110px" aria-label="Project code"></td><td><input class="input" data-proj="${p.id}" data-f="name" value="${esc(p.name)}" aria-label="Project name"></td><td class="hide-sm"><input class="input" data-proj="${p.id}" data-f="client" value="${esc(p.client || '')}" aria-label="Client"></td><td><input type="checkbox" data-proj="${p.id}" data-f="active" ${p.active !== false ? 'checked' : ''} aria-label="${esc(p.name)} active"></td></tr>`).join('')}</tbody></table></div>
        <div style="margin-top:10px"><button class="btn btn-sm" data-act="ck-proj-add">${ctx.icon('plus')}Add a project</button></div>` : ''}</div>`;
  }
  function bindSettings() {
    ctx.$$('[data-proj]').forEach((el) => el.addEventListener('change', () => {
      const p = projectOf(el.dataset.proj); if (!p) return;
      p[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value.trim() || p[el.dataset.f];
      ctx.commit('Project saved');
    }));
  }

  // ---------- Install ----------
  function install(c, checkinCtx) {
    ctx = c; ck = checkinCtx;
    window.addEventListener('online', () => { offlineBar(); sync(true); });
    window.addEventListener('offline', offlineBar);
    setInterval(() => sync(), 30000);
    setTimeout(() => { offlineBar(); sync(); }, 1500);
    // A small service worker caches the app so the check-in page opens without a connection.
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* not allowed here (for example inside a sandboxed preview) */ });
    }
    Object.assign(ctx.ACTIONS, {
      'ck-ok': (empId, day) => { const r = st().attendance[day]?.[empId]; if (!r) return; r.reviewed = { by: ctx.account()?.name || 'HR', at: new Date().toISOString() }; ctx.commit('Marked as reviewed', `${ctx.fullName(ctx.emp(empId))}’s check-in on ${U.fmtDate(day)} was reviewed`); },
      'ck-scan': () => scan(),
      'ck-cancel': () => { clearTimeout(kui.timer); Object.assign(kui, { stage: 'idle', match: null }); renderKiosk(); },
      'ck-confirm': () => confirmKiosk(),
      'ck-exit': () => exitKiosk(),
      'ck-make-kiosk': () => ctx.openModal({
        title: 'Make this device a kiosk', size: 'sm', submit: 'Start kiosk',
        body: `<p class="muted" style="margin-bottom:12px">This device will show only the kiosk until an admin signs in to exit. Put it at the entrance, on a stand, with the camera at face height.</p><div class="form-grid"><div class="field full"><label for="kk-label">Name</label><input class="input" id="kk-label" name="label" required value="Front entrance"></div></div>`,
        onSubmit(d) {
          const id = ck.deviceId();
          cfg().kiosks = [...(cfg().kiosks || []).filter((k) => k.id !== id), { id, label: d.label.trim(), added: T() }];
          write(KIOSK_KEY, id);
          ctx.commit('Kiosk mode is on', `${d.label.trim()} was set up as a check-in kiosk`);
        },
      }),
      'ck-kiosk-del': (id) => { cfg().kiosks = (cfg().kiosks || []).filter((k) => k.id !== id); if (kioskId() === id) write(KIOSK_KEY, null); ctx.commit('Kiosk removed'); },
      'ck-sup': (_, v) => { cfg().supervisor = v === 'on'; ctx.commit(v === 'on' ? 'Supervisor check-in on' : 'Supervisor check-in off'); },
      'ck-proj-mode': (_, v) => { cfg().projects = v; ctx.commit('Saved'); },
      'ck-proj-add': () => { st().projects = [...(st().projects || []), { id: U.uid('pj'), code: `PRJ-${String((st().projects || []).length + 1).padStart(3, '0')}`, name: 'New project', client: '', active: true }]; ctx.commit('Project added'); },
      'sv-open': () => supervisor(),
      'sv-pick': (id) => svPick(id),
      'sv-shoot': () => svShoot(),
      'sv-confirm': () => svConfirm(),
    });
    return {
      gpsCheck, rememberFix, queue, sync, syncBanner, outbox, projectField, pickedProject, projectTag, projectOf,
      flagged, reviewItems, kioskOn, renderKiosk, stopKiosk, isSupervisor, viaText, settingsCard, bindSettings,
    };
  }

  return { install };
})();

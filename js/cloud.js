// Allurus cloud: sign-in (Firebase Authentication) and live shared data (Cloud Firestore).
// Loaded by app.js only when js/firebase-config.js holds a Firebase web config; otherwise the app stays in demo
// mode with everything in this browser. The document layout and merging live in js/cloud-map.js; the security
// rules that enforce who sees what are in firestore.rules.
//
// How it works:
//   • Sign-in is email and password. A company admin registers the company; HR invites staff under
//     Settings → Team access; a staff member then sets their password with "First time here?" and confirms their email.
//   • On sign-in the workspace is read from the cloud and replaces this browser's copy. From then on every change
//     here is sent within a second, and every change elsewhere arrives live, record by record.
//   • Firestore keeps a copy on the device, so check-ins and requests made offline are sent when back online.
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const [{ initializeApp }, Auth, FS] = await Promise.all([
  import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
]);
const M = window.AllurusCloudMap;
const app = window.AllurusApp;
const fb = initializeApp(window.ALLURUS_FIREBASE);
const auth = Auth.getAuth(fb);
let db;
try { db = FS.initializeFirestore(fb, { localCache: FS.persistentLocalCache({ tabManager: FS.persistentMultipleTabManager() }) }); }
catch (e) { db = FS.getFirestore(fb); }

const { doc, collection, query, where, getDoc, getDocs, setDoc, deleteField, onSnapshot, writeBatch, serverTimestamp } = FS;
const lower = (s) => String(s || '').trim().toLowerCase();
const AUTH_MSG = {
  'auth/invalid-credential': 'That email and password don’t match an Allurus account.',
  'auth/wrong-password': 'That email and password don’t match an Allurus account.',
  'auth/user-not-found': 'That email and password don’t match an Allurus account.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/too-many-requests': 'Too many tries. Wait a few minutes, or reset your password.',
  'auth/email-already-in-use': 'That email already has an Allurus account. Sign in instead, or reset your password.',
  'auth/weak-password': 'Use at least 8 characters for your password.',
  'auth/network-request-failed': 'You seem to be offline. Check your connection and try again.',
  'auth/requires-recent-login': 'For your security, sign out and in again, then change your password.',
};
const authMsg = (e) => AUTH_MSG[e?.code] || 'Something went wrong. Please try again.';

// ---------- Sync state ----------
const S = {
  profile: null,      // { uid, email, name, tenantId, roles, empId }
  admin: false,
  perms: null,        // the person's areas (role template); null = every area, like an Owner
  base: new Map(),    // doc path → fields as the server last had them
  meta: new Map(),    // bucket path → { t, r }
  unsubs: [],
  live: false,        // initial read done and the workspace adopted
  timer: null, pushing: false, again: false,
  blobs: new Map(),   // blob id → data: URL
  sentBlobs: new Set(),
  blocked: new Set(), // paths the rules refused this session
  warned: new Set(),
};
const T = () => `tenants/${S.profile.tenantId}`;
// What this person may see and change, from their role template (see js/cloud-map.js and firestore.rules).
const can = (area) => M.has(S.admin, S.perms, area);
const seePeople = () => M.seesPeople(S.admin, S.perms);
const seePay = () => M.seesPayroll(S.admin, S.perms);
const fam = (path) => path.split('/')[2]; // buckets | people | payslips | personal
const tail = (path) => path.split('/').slice(3).join('/');

// ---------- Local documents: what this person's copy says, for the documents they may write ----------
function localDocs(onBlob) {
  const st = app.state, out = new Map(), p = S.profile;
  const put = (path, fields, meta) => out.set(path, { fields, meta });
  const buckets = M.bucketsOf(st, app.WS_KEYS, onBlob);
  Object.entries(buckets).forEach(([id, b]) => { if (M.canWrite(id, S.admin, S.perms, p.empId)) put(`${T()}/buckets/${id}`, b.f, { t: b.t, r: b.r }); });
  if (seePay()) {
    const payFields = {}; Object.keys(st.payroll || {}).forEach((m) => { payFields[m] = M.enc(st.payroll[m], onBlob); });
    put(`${T()}/buckets/payroll`, payFields, { t: 'o', r: M.readClass('payroll') });
    (st.employees || []).forEach((e) => put(`${T()}/payslips/${e.id}`, M.payslipFields(st.payroll, e.id)));
  }
  if (can('people')) put(`${T()}/buckets/directory`, M.directoryFields(st.employees || [], onBlob), { t: 'a', r: 'm' });
  if (seePeople()) {
    (st.employees || []).forEach((e, i) => put(`${T()}/people/${e.id}`, M.personFields(e, i, onBlob)));
  } else {
    // Only the person's own phones and face reference; everything else on their record is HR's to change.
    const path = `${T()}/people/${p.empId}`, mine = (st.employees || []).find((e) => e.id === p.empId);
    const base = S.base.get(path);
    if (mine && base) {
      const f = { ...base };
      M.SELF_FIELDS.forEach((k) => { if (mine[k] === undefined) delete f[k]; else f[k] = M.enc(mine[k], onBlob); });
      put(path, f);
    }
  }
  put(`${T()}/personal/${p.empId}`, M.personalFields(st, p.empId, p.email));
  return out;
}

// ---------- Applying documents to the workspace ----------
const lookup = (id) => S.blobs.get(id);
// Employees from the documents: admins get everyone's full record; others get the directory, with their own
// full record in their place. `over` replaces any document's fields (a merge that isn't on the server yet).
function employeesFrom(over = new Map()) {
  const p = S.profile, f = (path) => (over.has(path) ? over.get(path) : S.base.get(path));
  if (seePeople()) {
    const people = [...new Set([...S.base.keys(), ...over.keys()])].filter((k) => fam(k) === 'people').map(f).filter((x) => x && Object.keys(x).length);
    people.sort((a, b) => (+(a['~o'] || 0)) - (+(b['~o'] || 0)));
    return people.map((x) => M.personFrom(x, lookup));
  }
  const dir = M.directoryFrom(f(`${T()}/buckets/directory`) || {}, lookup);
  const own = f(`${T()}/people/${p.empId}`);
  return M.employeesFor(dir, own && Object.keys(own).length ? M.personFrom(own, lookup) : null);
}
function applyDoc(path, fields) {
  const st = app.state, f = fam(path), id = tail(path), p = S.profile;
  if (f === 'buckets') {
    if (id === 'directory') {
      // Colleagues' cards changed; keep this person's own record as it is here.
      if (seePeople()) return;
      const own = (st.employees || []).find((e) => e.id === p.empId);
      st.employees = M.employeesFor(M.directoryFrom(fields, lookup), own || null);
      return;
    }
    if (id === 'payroll') { if (seePay()) { st.payroll = {}; Object.keys(fields).forEach((m) => { st.payroll[m] = M.dec(fields[m], lookup); }); } return; }
    const meta = S.meta.get(path); if (!meta) return;
    M.applyBucket(st, id, meta.t, fields, lookup);
  } else if (f === 'people') {
    const list = st.employees || (st.employees = []);
    const i = list.findIndex((e) => e.id === id);
    if (!Object.keys(fields).length) { if (i >= 0 && seePeople()) list.splice(i, 1); return; }
    const e = M.personFrom(fields, lookup);
    if (i >= 0) list[i] = seePeople() ? e : { ...list[i], ...e };
    else { const at = Math.min(list.length, +(fields['~o'] || list.length)); list.splice(at, 0, e); }
  }
  else if (f === 'payslips') { if (!seePay() && id === p.empId) st.payroll = M.payrollFrom(fields); }
  else if (f === 'personal') M.applyPersonal(st, fields, p.empId, p.email);
}
// Bucket documents keep their fields under "f"; the others are flat.
const fieldsOf = (path, data) => (fam(path) === 'buckets' ? (data?.f || {}) : Object.fromEntries(Object.entries(data || {})));
function stringify(fields) { const o = {}; Object.keys(fields).forEach((k) => { const v = fields[k]; o[k] = typeof v === 'string' ? v : JSON.stringify(v); }); return o; }

// ---------- Reading: listeners ----------
function listen(ready) {
  const p = S.profile, t = T();
  // Only what this person may read: the rules refuse a query that could return anything else.
  const sources = [
    query(collection(db, `${t}/buckets`), where('r', 'in', M.readable(S.admin, S.perms, p.empId))),
    // Admins with the operations area also read every driver's deliveries (read class 'd:<empId>').
    ...(can('operations') ? [query(collection(db, `${t}/buckets`), where('r', '>=', 'd:'), where('r', '<', 'd;'))] : []),
    seePeople() ? collection(db, `${t}/people`) : doc(db, `${t}/people/${p.empId}`),
    seePay() ? collection(db, `${t}/payslips`) : doc(db, `${t}/payslips/${p.empId}`),
    doc(db, `${t}/personal/${p.empId}`),
  ];
  let pending = sources.length;
  const first = new Set();
  sources.forEach((src, i) => {
    const onData = (changes) => {
      if (!first.has(i)) { first.add(i); changes.forEach(([path, data]) => { if (data) { S.base.set(path, stringify(fieldsOf(path, data))); if (fam(path) === 'buckets') S.meta.set(path, { t: data.t, r: data.r }); } }); if (--pending === 0) ready(); return; }
      remote(changes);
    };
    const onErr = (e) => { console.warn('[Allurus cloud] listener', e.code || e); if (!first.has(i)) { first.add(i); if (--pending === 0) ready(); } };
    const unsub = src.type === 'document'
      ? onSnapshot(src, (snap) => onData([[snap.ref.path, snap.exists() ? snap.data() : null]]), onErr)
      : onSnapshot(src, (snap) => onData(snap.docChanges().map((c) => [c.doc.ref.path, c.type === 'removed' ? null : c.doc.data()])), onErr);
    S.unsubs.push(unsub);
  });
}
// Changes from elsewhere: merge each document with ours, apply, and send anything of ours still pending.
let inbox = [], inboxTimer = null;
function remote(changes) {
  inbox.push(...changes);
  if (!S.live) return; // kept until the workspace is ready
  clearTimeout(inboxTimer); inboxTimer = setTimeout(drain, 60);
}
function drain() {
  if (!S.live || !inbox.length) return;
  const changes = inbox; inbox = [];
  const local = localDocs();
  let applied = false, resend = false;
  changes.forEach(([path, data]) => {
    const remoteF = data ? stringify(fieldsOf(path, data)) : {};
    if (data && fam(path) === 'buckets') S.meta.set(path, { t: data.t, r: data.r });
    const baseF = S.base.get(path) || {};
    const mine = local.get(path)?.fields || baseF;
    const merged = M.merge3(baseF, mine, remoteF);
    S.base.set(path, remoteF);
    if (!M.sameFields(merged, mine)) { applyDoc(path, merged); applied = true; }
    if (!M.sameFields(merged, remoteF) && local.has(path)) resend = true;
  });
  if (applied) app.refresh();
  if (resend) changed();
}

// ---------- Writing ----------
function changed() {
  if (!S.live) return;
  clearTimeout(S.timer); S.timer = setTimeout(push, 500);
}
async function push() {
  if (!S.live) return;
  if (S.pushing) { S.again = true; return; }
  S.pushing = true;
  try {
    const found = new Map();
    const local = localDocs((id, data) => { if (id) found.set(id, data); else warnOnce('toolarge', 'A photo or file is too large to share (over 1 MB), so only this device has it.'); });
    found.forEach((data, id) => S.blobs.set(id, data));
    const writes = [];
    local.forEach(({ fields, meta }, path) => {
      if (S.blocked.has(path)) return;
      const d = M.diff(S.base.get(path), fields);
      if (d.empty) return;
      if (M.docBytes(fields) > 950000) { warnOnce(path, 'Some records are too large to share yet, so they stay on this device. Remove old photos or attachments.'); return; }
      writes.push({ path, fields, meta, d });
    });
    // Admins also remove people who were deleted.
    S.base.forEach((f, path) => { if (((fam(path) === 'people' && seePeople()) || (fam(path) === 'payslips' && seePay())) && !local.has(path) && Object.keys(f).length) writes.push({ path, fields: {}, meta: null, d: M.diff(f, {}), remove: true }); });
    if (!writes.length) return;
    // Files first, so a record never points at a photo that isn't there yet.
    const need = new Set();
    writes.forEach((w) => Object.keys(w.d.set).forEach((k) => { const v = w.d.set[k]; let i = v.indexOf(M.MARK); while (i >= 0) { const id = v.slice(i + M.MARK.length).match(/^[0-9a-z]+/)?.[0]; if (id && id !== 'toolarge') need.add(id); i = v.indexOf(M.MARK, i + 1); } }));
    await Promise.all([...need].filter((id) => !S.sentBlobs.has(id) && S.blobs.has(id)).map(async (id) => {
      try { await setDoc(doc(db, `${T()}/blobs/${id}`), { d: S.blobs.get(id), at: serverTimestamp() }); } catch (e) { /* already there: blobs are create-only */ }
      S.sentBlobs.add(id);
    }));
    for (let i = 0; i < writes.length; i += 400) {
      const batch = writeBatch(db);
      writes.slice(i, i + 400).forEach((w) => {
        const ref = doc(db, w.path);
        if (w.remove) { batch.delete(ref); return; }
        const patch = {}; Object.assign(patch, w.d.set); w.d.del.forEach((k) => { patch[k] = deleteField(); });
        if (fam(w.path) === 'buckets') batch.set(ref, { t: w.meta.t, r: w.meta.r, f: patch }, { merge: true });
        else batch.set(ref, patch, { merge: true });
      });
      try {
        // What the server holds is learned only from the listeners, never assumed from a write, so an update
        // that arrives late can't make an edit of ours look like the server's and be undone.
        await batch.commit();
      } catch (e) {
        console.warn('[Allurus cloud] write refused', e.code || e);
        if (e.code === 'permission-denied') {
          // Find which documents the rules refused, undo them here, and stop retrying them this session.
          for (const w of writes.slice(i, i + 400)) {
            try { const b = writeBatch(db); const patch = { ...w.d.set }; w.d.del.forEach((k) => { patch[k] = deleteField(); }); if (w.remove) b.delete(doc(db, w.path)); else b.set(doc(db, w.path), fam(w.path) === 'buckets' ? { t: w.meta.t, r: w.meta.r, f: patch } : patch, { merge: true }); await b.commit(); }
            catch (e2) { S.blocked.add(w.path); applyDoc(w.path, S.base.get(w.path) || {}); }
          }
          app.refresh();
          warnOnce('denied', 'Some changes need HR or an admin, so they weren’t saved.');
        } else warnOnce('offline', 'Couldn’t reach the server. Your changes are kept and will be sent when you’re back online.');
      }
    }
  } finally {
    S.pushing = false;
    if (S.again) { S.again = false; changed(); }
  }
}
function warnOnce(key, msg) { if (S.warned.has(key)) return; S.warned.add(key); app.toast(msg, 'error'); }

// ---------- Photos and files shown on screen ----------
// Records point at "cloudblob:<id>"; fetch each one the first time it appears on screen.
async function blob(id) {
  if (S.blobs.has(id)) return S.blobs.get(id);
  if (!S.profile || id === 'toolarge') return null;
  try { const snap = await getDoc(doc(db, `${T()}/blobs/${id}`)); const d = snap.exists() ? snap.data().d : null; if (d) { S.blobs.set(id, d); S.sentBlobs.add(id); } return d; }
  catch (e) { return null; }
}
async function resolve(v) { return typeof v === 'string' && v.startsWith(M.MARK) ? (await blob(v.slice(M.MARK.length))) || '' : v; }
function fixElement(el) {
  ['src', 'href'].forEach((a) => {
    const v = el.getAttribute(a); if (!v || !v.startsWith(M.MARK)) return;
    el.setAttribute(a, 'data:image/gif;base64,R0lGODlhAQABAAAAACw='); // a blank pixel while it loads
    blob(v.slice(M.MARK.length)).then((d) => { if (d) el.setAttribute(a, d); else el.setAttribute('alt', 'File not available on this device'); });
  });
}
new MutationObserver((list) => {
  list.forEach((m) => {
    if (m.type === 'attributes') { fixElement(m.target); return; }
    m.addedNodes.forEach((n) => { if (n.nodeType !== 1) return; if (n.matches?.('[src^="cloudblob:"],[href^="cloudblob:"]')) fixElement(n); n.querySelectorAll?.('[src^="cloudblob:"],[href^="cloudblob:"]').forEach(fixElement); });
  });
}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href'] });

// ---------- Starting and stopping ----------
async function start(profile) {
  stop();
  S.profile = profile; S.admin = profile.roles.includes('admin'); S.perms = Array.isArray(profile.perms) ? profile.perms : null;
  await new Promise((ready) => listen(ready));
  // Build the workspace from what the server has, on a blank company.
  const ws = app.blankWorkspace();
  ws.plans = {}; ws.reliefs = {}; ws.taxProfiles = {};
  const apply = (path) => {
    const f = S.base.get(path), fm = fam(path), id = tail(path);
    if (fm === 'buckets') {
      if (id === 'payroll') { if (seePay()) { ws.payroll = {}; Object.keys(f).forEach((m) => { ws.payroll[m] = M.dec(f[m], lookup); }); } return; }
      if (id === 'directory') return;
      const meta = S.meta.get(path); if (meta) M.applyBucket(ws, id, meta.t, f, lookup);
    } else if (fm === 'payslips' && !seePay() && id === profile.empId) ws.payroll = M.payrollFrom(f);
    else if (fm === 'personal') M.applyPersonal(ws, f, profile.empId, profile.email);
  };
  [...S.base.keys()].forEach(apply);
  ws.employees = employeesFrom();
  app.adoptCloud(ws, profile);
  await loadFeatures(profile.tenantId);
  S.live = true;
  app.refresh(true);
  drain();    // anything that arrived while loading
  changed();  // send what the app filled in on load (new defaults), and nothing else
}
// Industry features (set by superadmin at allurus.my/superadmin): which areas of the app this company has.
// Only companies with industries set are affected; for everyone else window.AllurusFeatures stays null and every
// area shows as before. Effective = features linked to the company's industries + its extras − its removals.
async function loadFeatures(tenantId) {
  window.AllurusFeatures = null;
  try {
    const t = await getDoc(doc(db, `tenants/${tenantId}`));
    const ids = (t.exists() && Array.isArray(t.data().industryIds)) ? t.data().industryIds.slice(0, 10) : [];
    if (!ids.length) return;
    const [cat, links, overrides, feats] = await Promise.all([
      import('/site/js/lib/catalog.js'),
      getDocs(query(collection(db, 'industryFeatures'), where('industryId', 'in', ids))),
      getDocs(query(collection(db, 'tenantFeatureOverrides'), where('tenantId', '==', tenantId))),
      getDocs(collection(db, 'features')),
    ]);
    const featuresByKey = Object.fromEntries(feats.docs.map((d) => [d.id, { key: d.id, ...d.data() }]));
    const eff = cat.effectiveFeatures({ industryIds: ids, links: links.docs.map((d) => d.data()), overrides: overrides.docs.map((d) => d.data()), featuresByKey });
    window.AllurusFeatures = { keys: eff.keys, source: eff.source, has: (k) => eff.keys.has(k), area: (a) => cat.areaAllowed(a, eff, true) };
  } catch (e) { console.warn('[Allurus cloud] industry features', e); window.AllurusFeatures = null; }   // on failure, show everything
}
function stop() {
  S.unsubs.forEach((u) => { try { u(); } catch (e) { /* already closed */ } });
  Object.assign(S, { unsubs: [], live: false, base: new Map(), meta: new Map(), blocked: new Set(), warned: new Set() });
  clearTimeout(S.timer);
}

// Who this person is in Allurus. Joining from an invite needs a confirmed email, so nobody can claim
// someone else's invite by registering their address first.
async function profileFor(user) {
  const uref = doc(db, `users/${user.uid}`);
  let snap = await getDoc(uref);
  if (snap.exists()) return { uid: user.uid, ...snap.data() };
  const email = lower(user.email);
  let inv;
  try { inv = await getDoc(doc(db, `invites/${email}`)); } catch (e) { inv = null; }
  if (!inv?.exists()) return { error: 'no-invite' };
  if (!user.emailVerified) {
    await user.reload();
    if (!auth.currentUser.emailVerified) { try { await Auth.sendEmailVerification(auth.currentUser); } catch (e) { /* sent recently */ } return { error: 'unverified' }; }
    await auth.currentUser.getIdToken(true);
  }
  const i = inv.data();
  const prof = { email, name: i.name || email, tenantId: i.tenantId, roles: i.roles, empId: i.empId, joinedAt: serverTimestamp() };
  if (Array.isArray(i.perms)) prof.perms = i.perms;
  await setDoc(uref, prof);
  return { uid: user.uid, ...prof };
}

// ---------- Public API used by app.js ----------
const api = {
  on: true,
  get live() { return S.live; },
  get profile() { return S.profile; },
  changed,
  resolve,
  // For tests and support: what's waiting to be sent.
  _debug: () => ({ live: S.live, pushing: S.pushing, admin: S.admin, pending: [...localDocs().entries()].filter(([p, d]) => !M.diff(S.base.get(p), d.fields).empty).map(([p, d]) => [p, M.diff(S.base.get(p), d.fields)]), blocked: [...S.blocked] }),
  async signIn(email, password) {
    try {
      const cred = await Auth.signInWithEmailAndPassword(auth, lower(email), password);
      const prof = await profileFor(cred.user);
      if (prof.error === 'no-invite') { await Auth.signOut(auth); return { error: 'There’s no Allurus workspace for this email yet. Ask HR to invite you, or register your company.' }; }
      if (prof.error === 'unverified') { await Auth.signOut(auth); return { error: `Confirm your email first. We’ve sent a link to ${lower(email)}; open it, then sign in again.` }; }
      await start(prof);
      return { ok: true, profile: prof };
    } catch (e) { console.warn('[Allurus cloud] sign-in', e); return { error: authMsg(e) }; }
  },
  // First time for an invited employee: create their password and send the confirmation email.
  async activate(email, password) {
    try {
      const cred = await Auth.createUserWithEmailAndPassword(auth, lower(email), password);
      await Auth.sendEmailVerification(cred.user);
      await Auth.signOut(auth);
      return { ok: true };
    } catch (e) { return { error: authMsg(e) }; }
  },
  async resetPassword(email) {
    try { await Auth.sendPasswordResetEmail(auth, lower(email)); return { ok: true }; } catch (e) { return { error: authMsg(e) }; }
  },
  // A new company: the founder's sign-in, the company record, their profile, then the whole workspace.
  async register(d, ws) {
    try {
      const email = lower(d.email);
      const cred = await Auth.createUserWithEmailAndPassword(auth, email, d.password);
      const tref = doc(collection(db, 'tenants'));
      await setDoc(tref, { owner: cred.user.uid, name: d.name, industry: d.industry || '', city: d.city || '', country: d.country || '', plan: d.plan || '', seats: d.seats || 0, admin: email, createdAt: serverTimestamp() });
      const prof = { email, name: d.adminName, tenantId: tref.id, roles: ['admin', 'employee'], empId: 'e1', joinedAt: serverTimestamp() };
      await setDoc(doc(db, `users/${cred.user.uid}`), prof);
      try { await Auth.sendEmailVerification(cred.user); } catch (e) { /* optional for founders */ }
      // Send the new workspace as it is, then sign in to it like any other time.
      S.profile = { uid: cred.user.uid, ...prof }; S.admin = true; S.perms = null; S.live = true;
      app.adoptCloud(ws, S.profile);
      await push();
      S.live = false;
      await start(S.profile);
      return { ok: true, profile: S.profile };
    } catch (e) { console.warn('[Allurus cloud] register', e); return { error: authMsg(e) }; }
  },
  async signOut() { stop(); S.profile = null; await Auth.signOut(auth); },
  async changePassword(current, next) {
    try {
      const u = auth.currentUser;
      await Auth.reauthenticateWithCredential(u, Auth.EmailAuthProvider.credential(u.email, current));
      await Auth.updatePassword(u, next);
      return { ok: true };
    } catch (e) { return { error: e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password' ? 'Your current password is not right.' : authMsg(e) }; }
  },
  // ----- Team access (Settings, admins) -----
  async access() {
    const tid = S.profile.tenantId;
    const [inv, users] = await Promise.all([
      getDocs(query(collection(db, 'invites'), where('tenantId', '==', tid))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, 'users'), where('tenantId', '==', tid))).catch(() => ({ docs: [] })),
    ]);
    return { invites: inv.docs.map((d) => ({ email: d.id, ...d.data() })), users: users.docs.map((d) => ({ uid: d.id, ...d.data() })) };
  },
  // template: 'employee', or a role template from app.js ('owner', 'hr', 'payroll', 'finance').
  async invite(emp, template = 'employee') {
    const email = lower(emp.email);
    if (!email) return { error: `${emp.first} has no work email. Add one on their profile first.` };
    try {
      await setDoc(doc(db, `invites/${email}`), { tenantId: S.profile.tenantId, empId: emp.id, name: `${emp.first} ${emp.last}`.trim(), ...access(template), invitedBy: S.profile.email, invitedAt: serverTimestamp() });
      return { ok: true };
    } catch (e) { return { error: e.code === 'permission-denied' ? 'You can only give access you have yourself.' : 'Couldn’t save the invite. Check your connection.' }; }
  },
  async setRole(uid, template) {
    try { await setDoc(doc(db, `users/${uid}`), access(template, true), { merge: true }); return { ok: true }; }
    catch (e) { return { error: 'Couldn’t change access. You can only give access you have yourself, and not change your own.' }; }
  },
  async revoke(email, uid) {
    try { await FS.deleteDoc(doc(db, `invites/${lower(email)}`)); if (uid) await FS.deleteDoc(doc(db, `users/${uid}`)); return { ok: true }; }
    catch (e) { return { error: 'Couldn’t remove access.' }; }
  },
};
window.AllurusCloud = api;
// Roles and areas for a template, as stored on an invite or a profile. An Owner has no list (every area).
function access(template, update) {
  const t = window.AllurusAccess?.TEMPLATES?.[template];
  const roles = template === 'employee' ? ['employee'] : ['admin', 'employee'];
  if (template !== 'employee' && t && template !== 'owner') return { roles, perms: t.perms.slice() };
  return update ? { roles, perms: deleteField() } : { roles }; // no list: every area (Owner), or none (Employee)
}

// A returning visitor whose sign-in is still valid: reconnect to their workspace.
let firstAuth = true;
Auth.onAuthStateChanged(auth, async (user) => {
  // "Log out" on the landing page (allurus.my) links to /app?signout: sign out here, then go back to the landing page.
  if (/[?&]signout\b/.test(location.search)) {
    try { await Auth.signOut(auth); } catch (e) { /* already signed out */ }
    try { localStorage.removeItem('allurus-hr-cloud-v1'); } catch (e) { /* storage unavailable */ }
    location.replace('/'); return;
  }
  const sess = app.state.session;
  if (!firstAuth) return;
  firstAuth = false;
  if (user && sess.cloud?.uid === user.uid && sess.account) {
    try { const prof = await profileFor(user); if (!prof.error) { await start(prof); app.cloudReady(); return; } } catch (e) { console.warn('[Allurus cloud] resume', e); }
  }
  if (user && sess.cloud?.uid !== user.uid) await Auth.signOut(auth);
  app.cloudReady(sess.cloud && !user ? 'signed-out' : null);
});

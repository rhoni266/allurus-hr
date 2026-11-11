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

const { doc, collection, query, where, getDoc, getDocs, setDoc, updateDoc, deleteField, onSnapshot, writeBatch, serverTimestamp } = FS;
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
const BLOCKED_MSG = {
  expired: 'Your company’s subscription has expired. Please contact your admin.',
  suspended: 'Your company’s Allurus account is suspended. Please contact your admin, or Allurus at hello@allurus.my.',
  cancelled: 'Your company’s Allurus account has been cancelled. Please contact your admin.',
};

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
  Object.entries(buckets).forEach(([id, b]) => {
    if (M.canWrite(id, S.admin, S.perms, p.empId)) put(`${T()}/buckets/${id}`, b.f, { t: b.t, r: b.r });
    // Grievances, candidates and hiring requests are for the talent area: a staff member's entry there can't be sent.
    else if (M.TALENT.includes(id) && Object.keys(b.f).some((k) => k !== '~ord')) warnOnce('talent', 'Grievances, hiring requests and interview scorecards can’t be sent from a staff account yet. Please ask HR to enter it.');
  });
  // A per-person bucket whose last record was removed is emptied (it no longer comes out of bucketsOf).
  S.base.forEach((f, path) => {
    const id = tail(path);
    if (fam(path) === 'buckets' && M.ownerOf(id) && !out.has(path) && Object.keys(f).length && M.canWrite(id, S.admin, S.perms, p.empId)) put(path, {}, { t: S.meta.get(path)?.t || 's', r: M.readClass(id) });
  });
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
  if (!p.support) put(`${T()}/personal/${p.empId}`, M.personalFields(st, p.empId, p.email));   // support never has a plan of its own here
  return out;
}

// ---------- Applying documents to the workspace ----------
const lookup = (id) => S.blobs.get(id);
// Employees from the documents: admins get everyone's full record; others get the directory, with their own
// full record in their place. `over` replaces any document's fields (a merge that isn't on the server yet).
// Support without the client's pay-and-ID switch sees those fields masked (and never sends them: push).
function masked(e) {
  const sup = S.profile?.support;
  if (sup && !sup.pay) M.PAY_ID.forEach((k) => { if (e[k] !== undefined && e[k] !== '' && e[k] !== null) e[k] = k === 'ic' || k === 'passportNo' ? `••••${String(e[k]).slice(-4)}` : null; });
  return e;
}
function employeesFrom(over = new Map()) {
  const p = S.profile, f = (path) => (over.has(path) ? over.get(path) : S.base.get(path));
  if (seePeople()) {
    const people = [...new Set([...S.base.keys(), ...over.keys()])].filter((k) => fam(k) === 'people').map(f).filter((x) => x && Object.keys(x).length);
    people.sort((a, b) => (+(a['~o'] || 0)) - (+(b['~o'] || 0)));
    return people.map((x) => masked(M.personFrom(x, lookup)));
  }
  const dir = M.directoryFrom(f(`${T()}/buckets/directory`) || {}, lookup);
  if (!p.empId && p.email) {
    const found = dir.find((e) => e.email && e.email.toLowerCase() === p.email.toLowerCase());
    if (found?.id) p.empId = found.id;
  }
  const own = p.empId ? f(`${T()}/people/${p.empId}`) : null;
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
    const e = masked(M.personFrom(fields, lookup));
    if (i >= 0) list[i] = seePeople() ? e : { ...list[i], ...e };
    else { const at = Math.min(list.length, +(fields['~o'] || list.length)); list.splice(at, 0, e); }
  }
  else if (f === 'payslips') { if (!seePay() && id === p.empId) st.payroll = M.payrollFrom(fields); }
  else if (f === 'personal') M.applyPersonal(st, fields, p.empId, p.email);
}
// Bucket documents keep their fields under "f"; the others are flat.
// _support: the support log entry a support write named (firestore.rules supportLogged); not part of the record.
const fieldsOf = (path, data) => (fam(path) === 'buckets' ? (data?.f || {}) : Object.fromEntries(Object.entries(data || {}).filter(([k]) => k !== '_support')));
function stringify(fields) { const o = {}; Object.keys(fields).forEach((k) => { const v = fields[k]; o[k] = typeof v === 'string' ? v : JSON.stringify(v); }); return o; }

// ---------- Reading: listeners ----------
function listen(ready) {
  const p = S.profile, t = T();
  // Support without the pay-and-ID switch: no payroll or per-person document classes, payslips or personal plan
  // (the rules refuse a whole query that could return one, so asking would hide everything else too).
  const supNoPay = !!(p.support && !p.support.pay);
  const classes = M.readable(S.admin, S.perms, p.empId).filter((r) => !(supNoPay && (r === 'p' || r.startsWith('u:people:'))) && !(p.support && r.startsWith('u:') && r.endsWith(':e1')));
  // Only what this person may read: the rules refuse a query that could return anything else.
  const sources = [
    query(collection(db, `${t}/buckets`), where('r', 'in', classes)),
    // Admins with the operations area also read every driver's deliveries (read class 'd:<empId>').
    ...(can('operations') ? [query(collection(db, `${t}/buckets`), where('r', '>=', 'd:'), where('r', '<', 'd;'))] : []),
    // Admins with the area of a per-person list (documents, change requests) read every person's bucket.
    ...M.ownedAreas(S.admin, S.perms).filter((a) => !(supNoPay && a === 'people')).map((a) => query(collection(db, `${t}/buckets`), where('r', '>=', `u:${a}:`), where('r', '<', `u:${a};`))),
    ...(seePeople() ? [collection(db, `${t}/people`)] : (p.empId ? [doc(db, `${t}/people/${p.empId}`)] : [])),
    ...(p.support ? (p.support.pay ? [collection(db, `${t}/payslips`)] : []) : [seePay() ? collection(db, `${t}/payslips`) : (p.empId ? doc(db, `${t}/payslips/${p.empId}`) : null)].filter(Boolean)),
    ...(p.support ? [] : (p.empId ? [doc(db, `${t}/personal/${p.empId}`)] : [])),
  ];
  let pending = sources.length;
  const first = new Set();
  sources.forEach((src, i) => {
    const onData = (changes) => {
      if (!first.has(i)) { first.add(i); changes.forEach(([path, data]) => { if (data) { S.base.set(path, stringify(fieldsOf(path, data))); if (fam(path) === 'buckets') S.meta.set(path, { t: data.t, r: data.r }); } }); if (--pending === 0) ready(); return; }
      remote(changes);
    };
    const onErr = (e) => {
      console.warn('[Allurus cloud] listener', e.code || e);
      // Support never writes over a company it couldn't load in full: back to read-only.
      if (p.support?.edit) { p.support.edit = false; p.viewOnly = true; S.supportDowngraded = true; }
      if (!first.has(i)) { first.add(i); if (--pending === 0) ready(); }
    };
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
  // Superadmin viewing a company, or an expired company's admin (read-only until they pay): nothing is sent.
  if (!S.live || S.profile?.viewOnly || S.profile?.billingOnly) return;
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
    // Support mode: pay and ID fields keep the server's values unless the client allowed them; nothing is removed;
    // and each document goes with its own entry in the client's support log (firestore.rules supportLogged).
    const sup = S.profile?.support;
    if (sup) {
      for (let j = writes.length - 1; j >= 0; j--) {
        const w = writes[j];
        if (w.remove) { writes.splice(j, 1); warnOnce('sup-remove', 'Support can’t delete records. Ask the client to remove them.'); continue; }
        // Only lists that came from the server (a new employee record is fine): never fill a list support couldn't read.
        if (fam(w.path) !== 'people' && !S.base.has(w.path)) { writes.splice(j, 1); continue; }
        if (fam(w.path) === 'people' && !sup.pay) {
          const base = S.base.get(w.path) || {};
          M.PAY_ID.forEach((k) => { if (base[k] !== undefined) w.fields[k] = base[k]; else delete w.fields[k]; });
          w.d = M.diff(base, w.fields);
          if (w.d.empty) writes.splice(j, 1);
        }
      }
      if (!writes.length) return;
    }
    const step = sup ? 200 : 400;
    for (let i = 0; i < writes.length; i += step) {
      const batch = writeBatch(db);
      writes.slice(i, i + step).forEach((w) => {
        const ref = doc(db, w.path);
        if (w.remove) { batch.delete(ref); return; }
        const patch = {}; Object.assign(patch, w.d.set); w.d.del.forEach((k) => { patch[k] = deleteField(); });
        if (sup) {
          const rel = w.path.split('/').slice(2).join('/'), logRef = doc(collection(db, `${T()}/supportLog`));
          batch.set(logRef, { kind: 'change', actorUid: S.profile.uid, actorEmail: S.profile.email, at: serverTimestamp(), path: rel,
            label: `${rel.split('/')[0] === 'people' ? 'Employee record' : 'List'} ${rel.split('/').slice(1).join('/')}: by Allurus support`,
            changes: M.supportChanges(S.base.get(w.path), { ...(S.base.get(w.path) || {}), ...w.d.set, ...Object.fromEntries(w.d.del.map((k) => [k, undefined])) }), pay: !!sup.pay });
          if (fam(w.path) === 'buckets') { batch.set(ref, { t: w.meta.t, r: w.meta.r, f: patch, _support: logRef.id }, { merge: true }); return; }
          batch.set(ref, { ...patch, _support: logRef.id }, { merge: true }); return;
        }
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
    pruneStaffKeys();
  }
}
// When HR removes or changes an employee's IC (or removes the employee), the old IC's sign-up key, its pending personal join link and
// invitation are deleted, so a removed IC can no longer register (incident 2026-11-12). Needs the Settings area (the rules' delete
// condition) and the People area (a complete employee list). A sudden drop of many ICs at once is treated as a bad load, not as edits.
async function pruneStaffKeys() {
  try {
    if (!S.live || !S.admin || !S.icSeen || S.profile?.viewOnly || !can('settings') || !can('people')) return;
    const emps = app.state?.employees; if (!Array.isArray(emps)) return;
    const tid = S.profile.tenantId, stale = M.staleIcs(S.icSeen, emps), now = M.icMap(emps);
    if (stale.length > 5 && stale.length > Object.keys(S.icSeen).length / 2) { console.warn('[Allurus cloud] IC keys: too many removed at once, left alone'); S.icSeen = now; return; }
    const failed = new Set();
    for (const ic of stale) {
      const key = `staffKeys/${tid}~${ic}`;
      try {
        const inv = await getDoc(doc(db, `staffInvites/${tid}~${ic}`)).catch(() => null);
        const b = writeBatch(db);
        if (inv?.exists()) { if (inv.data().link) b.delete(doc(db, `joinLinks/${inv.data().link}`)); b.delete(doc(db, `staffInvites/${tid}~${ic}`)); }
        b.delete(doc(db, key));
        await b.commit();
      } catch (e) { failed.add(ic); console.warn('[Allurus cloud] IC key removal', e?.code); }
    }
    // What we remember is the current picture, except ICs we could not remove yet (tried again at the next change).
    S.icSeen = { ...now };
    failed.forEach((ic) => { S.icSeen["retry:" + ic] = ic; });   // a removal that failed is tried again at the next change
  } catch (e) { console.warn('[Allurus cloud] pruneStaffKeys', e?.code || e?.message); }
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
// ---------- One phone per person (docs/ONE-PHONE-SPEC.md) ----------
// tenants/{t}/phones/{empId}: { active: {id,name,added,lastUsed,auto}, pending: {id,name,added,requested}, retired: [...] }.
// Until a company's records are moved there (scripts/migrate-phones.js), an older registered phone still counts:
// the check-in list on the person's own record, or the sign-in binding on their account.
const todayISO = () => new Date().toISOString().slice(0, 10);
const phoneRef = (empId, t = S.profile?.tenantId) => doc(db, `tenants/${t}/phones/${empId}`);
const publicPhone = (d) => ({ name: d.name || 'Phone', added: d.added || '', lastUsed: d.lastUsed || '' });
async function legacyPhones(profile) {
  const out = [];
  // Not profile.deviceId: that was the old sign-in lock, set on whatever device the person registered or signed in on
  // (often a laptop, or WhatsApp's in-app browser on an iPhone), so it would wrongly refuse their real first phone.
  // Only check-in phones HR approved (people/{empId}.devices) count as an existing registered phone.
  try {
    const p = await getDoc(doc(db, `tenants/${profile.tenantId}/people/${profile.empId}`));
    const raw = p.exists() ? p.data().devices : null;
    const list = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    (Array.isArray(list) ? list : []).filter((d) => d && d.id && d.status === 'approved').forEach((d) => { if (!out.some((x) => x.id === d.id)) out.push({ id: d.id, name: d.name || 'Registered phone', status: 'approved', added: d.added || '', legacy: true }); });
  } catch (e) { /* no older list to read */ }
  return out;
}
function phoneList(d) {
  if (!d) return [];
  return [...(d.active ? [{ ...d.active, status: 'approved' }] : []), ...(d.pending ? [{ ...d.pending, status: 'pending' }] : []), ...(d.retired || []).map((r) => ({ ...r, status: 'retired' }))];
}
// → null (carry on) or { mode: 'pending' | 'other', info } for the blocked screen.
async function phoneGate(profile, company) {
  const Dv = window.AllurusDevice;
  if (!Dv || profile.viewOnly || profile.support || !profile.empId || Dv.here() !== 'phone') return null;
  const pol = Dv.policy(company || {}), me = M.getDeviceId(), name = M.getDeviceName(), today = todayISO(), ref = phoneRef(profile.empId, profile.tenantId);
  S.phone = { id: me, name };
  let snap = null;
  try { snap = await getDoc(ref); } catch (e) { console.warn('[Allurus cloud] phone record', e?.code); return null; }   // can't read it: don't lock anyone out
  const data = snap?.exists() ? snap.data() : null;
  let devices = phoneList(data);
  if (!data) devices = await legacyPhones(profile);
  const res = Dv.phoneAccess({ device: 'phone', thisPhoneId: me, devices, policy: pol });
  const reg = devices.find((d) => d.status === 'approved');
  if (res === 'ok') {
    try {
      if (data?.active?.id === me) { if (data.active.lastUsed !== today) await updateDoc(ref, { 'active.lastUsed': today }); }
      else if (!data) await setDoc(ref, { active: { id: me, name, added: reg?.added || today, lastUsed: today, auto: true }, pending: null, retired: [] });   // move an older registration here
    } catch (e) { /* best effort */ }
    return null;
  }
  if (res === 'first') {
    try {
      if (Dv.firstPhoneStatus({ policy: pol, roles: profile.roles }) === 'approved') {
        const a = { id: me, name, added: today, lastUsed: today, auto: true };
        if (data) await updateDoc(ref, { active: a, pending: null }); else await setDoc(ref, { active: a, pending: null, retired: [] });
        S.phone.registered = true; return null;
      }
      const p = { id: me, name, added: today, requested: today };
      if (data) await updateDoc(ref, { pending: p }); else await setDoc(ref, { active: null, pending: p, retired: [] });
      return { mode: 'pending', info: publicPhone(p) };
    } catch (e) { console.warn('[Allurus cloud] register phone', e?.code); return { mode: 'pending', info: publicPhone({ name }) }; }
  }
  if (res === 'pending') return { mode: 'pending', info: publicPhone(data?.pending || { name }) };
  return { mode: 'other', info: publicPhone(reg || {}) };   // 'other'
}

async function start(profile) {
  stop();
  S.profile = profile; S.admin = profile.roles.includes('admin'); S.perms = Array.isArray(profile.perms) ? profile.perms : null;
  // Trial and subscription status (firestore.rules enforces the same): staff of an expired or suspended company
  // are stopped here with a message; its admins get the company read-only, with Billing and Export.
  const B = window.AllurusBilling;
  let company = null;
  try { const c = await getDoc(doc(db, `tenants/${profile.tenantId}`)); company = c.exists() ? { id: c.id, ...c.data() } : null; } catch (e) { company = null; }
  window.AllurusCompany = company;
  const eff = B.effective(company || {}), acc = B.access(eff, S.admin);
  if (!profile.viewOnly && !profile.support && acc === 'none') { app.companyBlocked(eff, company); throw Object.assign(new Error('company-blocked'), { blocked: eff }); }
  if (!profile.viewOnly && !profile.support && acc !== 'full') profile.billingOnly = true;
  // Staff use Allurus on a phone (docs/DEVICE-RULES-SPEC.md): on a computer they get "Please use your phone",
  // before any of the company's data is read. Admins, support and the kiosk are not affected.
  const Dv = window.AllurusDevice;
  if (Dv && !profile.viewOnly && !profile.support && !Dv.allowed(profile, Dv.here(), company)) {
    app.deviceBlocked(company); throw Object.assign(new Error('device-blocked'), { device: true });
  }
  // One phone per person (docs/ONE-PHONE-SPEC.md): on a phone, only the registered phone gets in; the first phone
  // registers itself; any other waits for HR. Computers and tablets are not checked. Nothing loads until it's ok.
  const gate = await phoneGate(profile, company);
  if (gate) { app.phoneBlocked(gate); throw Object.assign(new Error('phone-blocked'), { device: true }); }
  await new Promise((ready) => listen(ready));
  if (can('finance')) await listenInvoices();
  await Promise.all(Object.keys(REQ).map(listenRequests));
  window.AllurusAddons = { simpleStaffHome: company?.addons?.simpleStaffHome === true };   // read by the app (js/app.js staffApp)
  if (company?.addons?.prodCommission === true && !profile.viewOnly) await listenProd();
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
  if (S.invoices) { ws.finance = ws.finance || {}; ws.finance.invoices = S.invoices; }
  Object.keys(REQ).forEach((c) => { ws[REQ[c].key] = requestsNow(c); });
  if (S.prodOn) { ws.prod = { days: { ...S.prodDays }, locks: { ...S.prodLocks } }; ws.prodShares = { ...S.prodShares }; }
  app.adoptCloud(ws, profile);
  // Auto-sync staffKeys for all employees so any employee in the database can auto sign up
  if (S.admin && (can('people') || can('settings'))) {
    api.syncAllStaffKeys(ws.employees);
    S.icSeen = M.icMap(ws.employees);   // what each person's IC was, to spot a removed or changed one later
  }
  // Listen to own user profile: if disabled by admin or session terminated, sign out
  if (profile.uid) {
    S.unsubs.push(onSnapshot(doc(db, `users/${profile.uid}`), (snap) => {
      if (!snap.exists()) return;
      const u = snap.data();
      if (u.disabled) {
        console.warn('[Allurus cloud] user disabled by admin');
        api.signOut().then(() => {
          clearStaffSession();
          location.hash = '';
          location.reload();
        });
      }
    }));
  }
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
    // Industries with no feature links yet (catalogue not seeded): don't hide anything.
    if (!links.docs.some((d) => d.data().linked !== false)) return;
    const featuresByKey = Object.fromEntries(feats.docs.map((d) => [d.id, { key: d.id, ...d.data() }]));
    const eff = cat.effectiveFeatures({ industryIds: ids, links: links.docs.map((d) => d.data()), overrides: overrides.docs.map((d) => d.data()), featuresByKey });
    window.AllurusFeatures = { keys: eff.keys, source: eff.source, has: (k) => eff.keys.has(k), area: (a) => cat.areaAllowed(a, eff, true) };
  } catch (e) { console.warn('[Allurus cloud] industry features', e); window.AllurusFeatures = null; }   // on failure, show everything
}
// Invoices: one document each in tenants/{t}/invoices (firestore.rules locks sent ones), for admins with the
// finance area. Changes are written by js/invoice-store.js through api.invoiceWrite; this keeps the list live.
const plainTime = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v);
function invoiceFrom(d) { const x = d.data({ serverTimestamps: 'estimate' }), o = { id: d.id }; Object.keys(x).forEach((k) => { o[k] = plainTime(x[k]); }); return o; }
function listenInvoices() {
  return new Promise((ready) => {
    let first = true;
    S.unsubs.push(onSnapshot(collection(db, `${T()}/invoices`), (snap) => {
      S.invoices = snap.docs.map(invoiceFrom).sort((a, b) => String(a.issue).localeCompare(String(b.issue)) || String(a.no).localeCompare(String(b.no)));
      if (first) { first = false; ready(); return; }
      if (S.live && app.state.finance) { app.state.finance.invoices = S.invoices; app.refresh(); }
    }, (e) => { console.warn('[Allurus cloud] invoices', e.code || e); if (first) { first = false; ready(); } }));
  });
}
// Requests kept one document each, written by js/leave-store.js through api.recordWrite:
//   leaves (+ the safe calendar copy leaveCal): HR (time or people area) reads every request; anyone else reads
//     their own, the ones they approve, and the calendar copy of the rest (shown as "Off": no type, reason or MC).
//   claims: the claims or payroll area reads every claim; anyone else their own and the ones they approve.
//   timeRequests (overtime, attendance corrections): the time area reads all; anyone else as for claims.
const REQ = {
  leaves: { key: 'leaves', hrAreas: ['time', 'people'], calColl: 'leaveCal' },
  claims: { key: 'claims', hrAreas: ['claims', 'payroll'] },
  timeRequests: { key: 'timeRequests', hrAreas: ['time'] },
};
const RQ = {};
const docFrom = (d) => { const x = d.data({ serverTimestamps: 'estimate' }), o = { id: d.id }; Object.keys(x).forEach((k) => { o[k] = plainTime(x[k]); }); return o; };
function requestsNow(coll) {
  const q = RQ[coll];
  if (q.hr) return [...q.all.values()];
  const full = new Map([...q.mine, ...q.appr]);
  const others = [...q.cal].filter(([id]) => !full.has(id)).map(([id, c]) => ({ id, empId: c.empId, type: 'off', from: c.from, to: c.to, half: c.half || '', status: c.status, days: 0, chain: [], masked: true }));
  return [...full.values(), ...others];
}
function listenRequests(coll) {
  const t = T(), emp = S.profile.empId, cfg = REQ[coll];
  const q = RQ[coll] = { hr: cfg.hrAreas.some((a) => can(a)), all: new Map(), mine: new Map(), appr: new Map(), cal: new Map() };
  const sources = q.hr ? [['all', collection(db, `${t}/${coll}`)]]
    : [['mine', query(collection(db, `${t}/${coll}`), where('empId', '==', emp))], ['appr', query(collection(db, `${t}/${coll}`), where('approverIds', 'array-contains', emp))],
      ...(cfg.calColl ? [['cal', collection(db, `${t}/${cfg.calColl}`)]] : [])];
  return new Promise((ready) => {
    let pending = sources.length;
    const done = new Set();
    sources.forEach(([key, src]) => {
      S.unsubs.push(onSnapshot(src, (snap) => {
        q[key] = new Map(snap.docs.map((d) => [d.id, key === 'cal' ? d.data() : docFrom(d)]));
        if (!done.has(key)) { done.add(key); if (--pending === 0) ready(); return; }
        if (S.live) { app.state[cfg.key] = requestsNow(coll); app.refresh(); }
      }, (e) => { console.warn('[Allurus cloud]', coll, key, e.code || e); if (!done.has(key)) { done.add(key); if (--pending === 0) ready(); } }));
    });
  });
}
// Firestore can't store undefined; the store marks "server time" as { __now: true }.
const forWrite = (v) => (v && v.__now ? serverTimestamp() : Array.isArray(v) ? v.map(forWrite)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, forWrite(x)])) : v);

// ---------- Daily production commission (docs/PRODUCTION-COMMISSION-SPEC.md) ----------
// prodDays/{date}: the day, with its attendee list (admins with the operations or payroll area); prodShares/{date~empId}:
// one person's own share (they read only theirs); prodLocks/{yyyy-mm}: a finalised payroll month. Only where the company
// has the addon (tenants/{t}.addons.prodCommission).
function listenProd() {
  const t = T(), emp = S.profile.empId, entry = can('operations') || can('payroll');
  Object.assign(S, { prodOn: true, prodDays: {}, prodLocks: {}, prodShares: {} });
  const src = entry
    ? [['prodDays', collection(db, `${t}/prodDays`)], ['prodLocks', collection(db, `${t}/prodLocks`)]]
    : [['prodShares', query(collection(db, `${t}/prodShares`), where('empId', '==', emp))]];
  const push = () => { if (S.live) { app.state.prod = { days: { ...S.prodDays }, locks: { ...S.prodLocks } }; app.state.prodShares = { ...S.prodShares }; app.refresh(); } };
  return new Promise((ready) => {
    let pending = src.length; const done = new Set();
    src.forEach(([key, q]) => {
      S.unsubs.push(onSnapshot(q, (snap) => {
        S[key] = Object.fromEntries(snap.docs.map((d) => [d.id, key === 'prodLocks' ? true : docFrom(d)]));
        if (!done.has(key)) { done.add(key); if (--pending === 0) ready(); return; }
        push();
      }, (e) => { console.warn('[Allurus cloud] production', key, e.code || e); if (!done.has(key)) { done.add(key); if (--pending === 0) ready(); } }));
    });
  });
}

function stop() {
  S.unsubs.forEach((u) => { try { u(); } catch (e) { /* already closed */ } });
  Object.assign(S, { unsubs: [], live: false, base: new Map(), meta: new Map(), blocked: new Set(), warned: new Set(), invoices: null });
  clearTimeout(S.timer);
}

// Who this person is in Allurus. Joining from an invite needs a confirmed email, so nobody can claim
// someone else's invite by registering their address first.
async function profileFor(user) {
  const uref = doc(db, `users/${user.uid}`);
  let snap = await getDoc(uref);
  if (snap.exists()) return snap.data().disabled ? { error: 'disabled' } : { uid: user.uid, ...snap.data() };
  const email = lower(user.email);
  let inv;
  try { inv = await getDoc(doc(db, `invites/${email}`)); } catch (e) { inv = null; }
  if (!inv?.exists()) return { error: 'no-invite' };
  if (!window.AllurusInvite.usable(inv.data())) return { error: 'expired' };
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
  // One invoice change as one batch: [{ op: 'set' | 'update' | 'delete', path: 'invoices/<id>' | 'invoiceNos/<no>' |
  // 'invoiceAudit/<id>', data }]. Refused by the rules → 'changed' (someone saved or sent it first).
  // The same for other records kept one document each (leave): photos and files in them (an MC) are stored as
  // blobs first, so the record holds only a reference, as in the shared lists.
  async recordWrite(ops) {
    if (!S.live || S.profile?.viewOnly || S.profile?.billingOnly) return { error: 'failed' };
    // Leave requests, claims, time requests and invoices keep their own approval checks; support doesn't change them.
    if (S.profile?.support) { warnOnce('sup-records', 'Support can’t change leave requests, claims, time requests or invoices. Ask the client.'); return { error: 'failed' }; }
    const found = new Map();
    const out = ops.map((o) => (o.data ? { ...o, data: M.extract(o.data, (id, d) => { if (id) found.set(id, d); else warnOnce('toolarge', 'A photo or file is too large to share (over 1 MB), so only this device has it.'); }) } : o));
    for (const [id, d] of found) {
      if (S.sentBlobs.has(id)) continue;
      try { await setDoc(doc(db, `${T()}/blobs/${id}`), { d, at: serverTimestamp() }); } catch (e) { /* already there: blobs are create-only */ }
      S.blobs.set(id, d); S.sentBlobs.add(id);
    }
    return api.invoiceWrite(out);
  },
  async invoiceWrite(ops) {
    if (!S.live || S.profile?.viewOnly || S.profile?.billingOnly || S.profile?.support) return { error: 'failed' };
    const b = writeBatch(db);
    ops.forEach(({ op, path, data }) => {
      const ref = doc(db, `${T()}/${path}`);
      if (op === 'delete') b.delete(ref); else if (op === 'update') b.update(ref, forWrite(data)); else b.set(ref, forWrite(data));
    });
    try { await b.commit(); return { ok: true }; }
    catch (e) { console.warn('[Allurus cloud] invoice write', e.code || e); return { error: e.code === 'permission-denied' || e.code === 'not-found' ? 'changed' : e.code === 'unavailable' ? 'offline' : 'failed' }; }
  },
  // For tests and support: what's waiting to be sent.
  _debug: () => ({ live: S.live, pushing: S.pushing, admin: S.admin, pending: [...localDocs().entries()].filter(([p, d]) => !M.diff(S.base.get(p), d.fields).empty).map(([p, d]) => [p, M.diff(S.base.get(p), d.fields)]), blocked: [...S.blocked] }),
  async signIn(email, password) {
    try {
      const cred = await Auth.signInWithEmailAndPassword(auth, lower(email), password);
      const prof = await profileFor(cred.user);
      if (prof.error === 'no-invite') { await Auth.signOut(auth); return { error: 'There’s no Allurus workspace for this email yet. Ask your HR admin to invite you.' }; }
      if (prof.error === 'expired') { await Auth.signOut(auth); return { error: 'Your invitation has expired. Ask your HR admin to send a new one.' }; }
      if (prof.error === 'disabled') { await Auth.signOut(auth); return { error: 'Your access to Allurus has been turned off. Contact your HR admin.' }; }
      if (prof.pending) { await Auth.signOut(auth); return { error: 'Your registration is waiting for HR to approve it. Try again once HR has checked it.' }; }
      if (prof.error === 'unverified') { await Auth.signOut(auth); return { error: `Confirm your email first. We’ve sent a link to ${lower(email)}; open it, then sign in again.` }; }

      // Which phone may be used is decided in start() (phoneGate), for everyone, on phones only.

      await start(prof);
      return { ok: true, profile: prof };
    } catch (e) {
      if (e?.device) return { deviceBlocked: true };   // "Please use your phone" is showing; still signed in, so Sign out works
      if (e?.blocked) { await Auth.signOut(auth); return { error: BLOCKED_MSG[e.blocked] || BLOCKED_MSG.expired, blocked: e.blocked }; }
      console.warn('[Allurus cloud] sign-in', e?.code); return { error: authMsg(e) };
    }
  },
  // ----- Billing (company admins): plans, bank details, payment proof, invoices -----
  async billing() {
    const tid = S.profile.tenantId;
    const [plans, cfg, pays, invs, co] = await Promise.all([
      getDocs(collection(db, 'plans')).catch(() => ({ docs: [] })),
      getDoc(doc(db, 'config/billing')).catch(() => null),
      getDocs(query(collection(db, 'payments'), where('tenantId', '==', tid))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, 'invoices'), where('tenantId', '==', tid))).catch(() => ({ docs: [] })),
      getDoc(doc(db, `tenants/${tid}`)).catch(() => null),
    ]);
    if (co?.exists()) window.AllurusCompany = { id: co.id, ...co.data() };
    return {
      company: window.AllurusCompany, config: cfg?.exists() ? cfg.data() : {},
      plans: plans.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.active !== false),
      payments: pays.docs.map((d) => { const x = d.data(); return { id: d.id, ...x, proof: undefined }; }).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)),
      invoices: invs.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.issuedAt?.seconds || 0) - (a.issuedAt?.seconds || 0)),
    };
  },
  async submitPayment(p) {
    try {
      await setDoc(doc(collection(db, 'payments')), { tenantId: S.profile.tenantId, planId: p.planId, months: p.months, amountMyr: p.amountMyr, reference: p.reference, method: p.method,
        proof: p.proof, proofName: String(p.proofName || 'proof').slice(0, 119), proofType: p.proofType || '', status: 'submitted', submittedBy: lower(auth.currentUser.email), createdAt: serverTimestamp() });
      return { ok: true };
    } catch (e) { return { error: e.code === 'permission-denied' ? 'Only your company’s admins can send payment proof.' : 'Couldn’t send it. Check your connection and try again.' }; }
  },
  // First-time sign-in happens on allurus.my/activate (js/activate.js), from the invitation email.
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
  // Signs out of everything: Firebase Auth, the Firestore offline cache (it holds the last person's documents), the
  // remembered staff session, any stored PIN and the local copy of the workspace. Reload the page afterwards.
  async signOut() {
    stop(); S.profile = null; clearStaffSession();
    try { await Auth.signOut(auth); } catch (e) { /* already signed out */ }
    window.AllurusSession?.clearLocal();
    await window.AllurusSession?.clearFirestoreCache(FS, db);
  },
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
  // Send (or resend) an invitation: the invites/{email} record with a 7-day expiry, then Firebase emails the
  // person a one-time sign-in link to allurus.my/activate?c=<company>. Never automatic: an admin presses the button.
  async invite(emp, template = 'employee') {
    const email = lower(emp.email);
    if (!email) return { error: `${emp.first} has no email. Add an email, or use a registration link.` };
    const I = window.AllurusInvite, expiresAt = I.expiry();
    try {
      await setDoc(doc(db, `invites/${email}`), { tenantId: S.profile.tenantId, empId: emp.id, name: `${emp.first} ${emp.last}`.trim(), company: String(app.state.settings?.company || '').slice(0, 120), ...access(template), invitedBy: S.profile.email, invitedAt: serverTimestamp(), sentAt: serverTimestamp(), expiresAt: FS.Timestamp.fromDate(expiresAt) });
    } catch (e) { return { error: e.code === 'permission-denied' ? 'You can only give access you have yourself.' : 'Couldn’t save the invite. Check your connection.' }; }
    try {
      await Auth.sendSignInLinkToEmail(auth, email, { url: I.link(location.origin, S.profile.tenantId), handleCodeInApp: true });
      return { ok: true, emailed: true, expiresAt };
    } catch (e) {
      console.warn('[Allurus cloud] invitation email', e?.code);
      return { ok: true, emailed: false, expiresAt, error: e?.code === 'auth/operation-not-allowed' ? 'The invitation is saved, but email sign-in links are turned off for this project (Firebase console → Authentication → Sign-in method → Email link).' : 'The invitation is saved, but the email couldn’t be sent. Try Resend.' };
    }
  },
  // Cancel a pending invitation (or the old one when the email changes): the link stops working.
  async cancelInvite(email) {
    try { await FS.deleteDoc(doc(db, `invites/${lower(email)}`)); return { ok: true }; } catch (e) { return { error: 'Couldn’t cancel the invitation.' }; }
  },
  // ----- One phone per person (docs/ONE-PHONE-SPEC.md) -----
  // "Use this phone instead": ask HR (the person's own request). An older registration is moved into the new record
  // first, so approving the request retires it.
  // One production day and each person's own share record, in one batch (firestore.rules: prodDays, prodShares).
  async prodSave(day, shares) {
    if (!S.live || S.profile?.viewOnly || S.profile?.support) return { ok: false, error: 'This account can’t save production.' };
    try {
      const b = writeBatch(db);
      b.set(doc(db, `${T()}/prodDays/${day.date}`), forWrite(day));
      shares.forEach((s) => b.set(doc(db, `${T()}/prodShares/${s.date}~${s.empId}`), forWrite(s)));
      await b.commit();
      return { ok: true };
    } catch (e) {
      console.warn('[Allurus cloud] production save', e.code || e);
      return { ok: false, error: e.code === 'permission-denied' ? 'That day can’t be saved: its month may be finalised, or you don’t have the Operations or Payroll area.' : 'Couldn’t save. Check your connection and try again.' };
    }
  },
  async prodLock(month) { return setDoc(doc(db, `${T()}/prodLocks/${month}`), { month, by: S.profile.uid, at: serverTimestamp() }); },
  async phoneRequest() {
    const p = S.profile; if (!p?.empId || !S.phone) return { error: 'Not signed in.' };
    const ref = phoneRef(p.empId), today = todayISO(), ask = { id: S.phone.id, name: S.phone.name, added: today, requested: today };
    try {
      const s = await getDoc(ref);
      if (!s.exists()) {
        const old = (await legacyPhones(p))[0];
        if (old) await setDoc(ref, { active: { id: old.id, name: old.name, added: old.added || '', lastUsed: '', auto: true }, pending: null, retired: [] });
        else await setDoc(ref, { active: null, pending: ask, retired: [] });
        if (old) await updateDoc(ref, { pending: ask });
      } else await updateDoc(ref, { pending: ask });
      return { ok: true };
    } catch (e) { console.warn('[Allurus cloud] phone request', e?.code); return { error: 'Couldn’t send the request. Check your connection and try again.' }; }
  },
  // HR: everyone's phone records (the people or time area), for the Approvals list and each person's Phones panel.
  async phonesAll() {
    const r = await getDocs(collection(db, `${T()}/phones`)).catch(() => ({ docs: [] }));
    return r.docs.map((d) => ({ empId: d.id, ...d.data() }));
  },
  async phoneApprove(empId) {
    try {
      const ref = phoneRef(empId), s = await getDoc(ref), d = s.exists() ? s.data() : null;
      if (!d?.pending) return { error: 'There’s no request to approve.' };
      const retired = [...(d.retired || []), ...(d.active ? [{ ...d.active, retiredOn: todayISO(), why: 'replaced' }] : [])].slice(-30);
      await updateDoc(ref, { active: { id: d.pending.id, name: d.pending.name, added: todayISO(), lastUsed: '', auto: false }, pending: null, retired });
      return { ok: true, name: d.pending.name };
    } catch (e) { return { error: e?.code === 'permission-denied' ? 'You can’t approve your own phone. Ask another admin.' : 'Couldn’t approve. Reload and try again.' }; }
  },
  async phoneDecline(empId) {
    try { await updateDoc(phoneRef(empId), { pending: null }); return { ok: true }; }
    catch (e) { return { error: e?.code === 'permission-denied' ? 'You can’t decline your own request.' : 'Couldn’t decline. Reload and try again.' }; }
  },
  // Lost or stolen: retire the registered phone, so the person can register a new one.
  async phoneRemove(empId) {
    try {
      const ref = phoneRef(empId), s = await getDoc(ref), d = s.exists() ? s.data() : null;
      let retired = d?.retired || [];
      if (d?.active) retired = [...retired, { ...d.active, retiredOn: todayISO(), why: 'removed' }].slice(-30);
      if (!d) { await setDoc(ref, { active: null, pending: null, retired: [] }); return { ok: true }; }   // (older registration only: see migrate-phones)
      await updateDoc(ref, { active: null, retired });
      return { ok: true };
    } catch (e) { return { error: e?.code === 'permission-denied' ? 'You can’t change your own phone. Ask another admin.' : 'Couldn’t remove it. Reload and try again.' }; }
  },
  // The only Owner approving their own new phone: type the password again first (the rules also need the sign-in to
  // be under 5 minutes old).
  async phoneApproveSelf(password) {
    try {
      const u = auth.currentUser;
      await Auth.reauthenticateWithCredential(u, Auth.EmailAuthProvider.credential(u.email, password));
      await u.getIdToken(true);
    } catch (e) { return { error: 'That password isn’t right.' }; }
    return api.phoneApprove(S.profile.empId);
  },
  phoneId: () => S.phone?.id || '',
  // Which devices staff use (docs/DEVICE-RULES-SPEC.md): the company rule, and one person allowed on a computer.
  async setStaffDevices(p) {
    const staffDevices = { phonesOnly: p.phonesOnly === true, tablets: p.tablets === true, autoFirst: p.autoFirst !== false };
    try {
      await setDoc(doc(db, `tenants/${S.profile.tenantId}`), { staffDevices }, { merge: true });
      window.AllurusCompany = { ...(window.AllurusCompany || {}), staffDevices };
      return { ok: true };
    } catch (e) { return { error: e?.code === 'permission-denied' ? 'Only the Owner or someone with the Settings area can change this.' : 'Couldn’t save. Check your connection.' }; }
  },
  async setAllowComputer(uid, on) {
    try { await setDoc(doc(db, `users/${uid}`), { allowComputer: !!on }, { merge: true }); return { ok: true }; }
    catch (e) { return { error: 'Couldn’t change that. You need the Settings area, and can’t change your own.' }; }
  },
  // Turn someone's access off or back on. Off blocks them at once (firestore.rules: member()).
  async setDisabled(uid, disabled) {
    try { await setDoc(doc(db, `users/${uid}`), { disabled: !!disabled }, { merge: true }); return { ok: true }; }
    catch (e) { return { error: 'Couldn’t change their access. You need the Settings area, and can’t change your own.' }; }
  },
  async setRole(uid, template) {
    try { await setDoc(doc(db, `users/${uid}`), access(template, true), { merge: true }); return { ok: true }; }
    catch (e) { return { error: 'Couldn’t change access. You can only give access you have yourself, and not change your own.' }; }
  },
  // Reset/unbind an employee's device (HR action when employee changes their phone)
  async resetStaffDevice(empId, ic, uid) {
    const tid = S.profile?.tenantId;
    if (!tid) return { error: 'No tenant' };
    try {
      const ops = [];
      if (uid) {
        ops.push(setDoc(doc(db, `users/${uid}`), { deviceId: '' }, { merge: true }).catch(() => {}));
      } else if (empId) {
        const snap = await getDocs(query(collection(db, 'users'), where('tenantId', '==', tid), where('empId', '==', empId))).catch(() => ({ docs: [] }));
        snap.docs.forEach((d) => {
          ops.push(setDoc(doc(db, `users/${d.id}`), { deviceId: '' }, { merge: true }).catch(() => {}));
        });
      }
      if (ic && M.validIc(ic)) {
        const key = M.staffKey(tid, ic);
        ops.push(setDoc(doc(db, `staffKeys/${key}`), { deviceId: '' }, { merge: true }).catch(() => {}));
      }
      await Promise.all(ops);
      return { ok: true };
    } catch (e) {
      console.warn('[Allurus cloud] resetStaffDevice', e);
      return { error: 'Gagal menetapkan semula peranti.' };
    }
  },
  // Bind an employee's device explicitly
  async bindStaffDevice(empId, ic, devId, uid) {
    const tid = S.profile?.tenantId;
    if (!tid || !devId) return { error: 'Invalid params' };
    try {
      const ops = [];
      if (uid) {
        ops.push(setDoc(doc(db, `users/${uid}`), { deviceId: devId }, { merge: true }).catch(() => {}));
      } else if (empId) {
        const snap = await getDocs(query(collection(db, 'users'), where('tenantId', '==', tid), where('empId', '==', empId))).catch(() => ({ docs: [] }));
        snap.docs.forEach((d) => {
          ops.push(setDoc(doc(db, `users/${d.id}`), { deviceId: devId }, { merge: true }).catch(() => {}));
        });
      }
      if (ic && M.validIc(ic)) {
        const key = M.staffKey(tid, ic);
        ops.push(setDoc(doc(db, `staffKeys/${key}`), { deviceId: devId }, { merge: true }).catch(() => {}));
      }
      await Promise.all(ops);
      return { ok: true };
    } catch (e) {
      console.warn('[Allurus cloud] bindStaffDevice', e);
      return { error: 'Gagal memautkan peranti.' };
    }
  },
  // ----- Staff with no work email: IC sign-in (firestore.rules: staffInvites, staffKeys, joinLinks, companyCodes) -----
  // Company code + IC + password → the made-up email for that IC's current sign-in generation.
  async signInIC(code, ic, password) {
    const nope = { error: 'That company code, IC and password don’t match. Check them, or ask HR for a new join link.' };
    if (!M.validIc(ic)) return { error: 'Enter your 12-digit IC number.' };
    try {
      const c = await getDoc(doc(db, `companyCodes/${lower(code)}`));
      if (!c.exists()) return nope;
      const tid = c.data().tenantId;
      const kKey = M.staffKey(tid, ic);
      const kRef = doc(db, `staffKeys/${kKey}`);
      const k = await getDoc(kRef);
      if (!k.exists()) return nope;

      const devId = (M.getDeviceId ? M.getDeviceId() : (localStorage.getItem('allurus_device_id') || 'dev-unsaved'));
      const kData = k.data();

      const email = M.staffEmail(ic, tid, kData.gen);
      const res = await api.signIn(email, password);
      if (res.ok) {
        saveStaffSession({
          email,
          tenantId: tid,
          code: lower(code),
          deviceId: devId
        });
      }
      return res.ok ? res : { ...res, error: /email|invite/i.test(res.error || '') ? nope.error : res.error };
    } catch (e) { console.warn('[Allurus cloud] IC sign-in', e?.code); return { error: authMsg(e) }; }
  },
  // The company's sign-in code, made the first time someone is invited by IC.
  async companyCode() {
    const tid = S.profile.tenantId;
    if (app.state.settings?.staffCode) return app.state.settings.staffCode;
    for (let i = 0; i < 5; i++) {
      const code = M.companyCode(app.state.settings?.company);
      const ref = doc(db, `companyCodes/${code}`);
      const had = await getDoc(ref).catch(() => null);
      if (had?.exists()) { if (had.data().tenantId === tid) return code; continue; }
      try { await setDoc(ref, { tenantId: tid }); return code; } catch (e) { /* taken meanwhile */ }   // the caller keeps it in settings.staffCode
    }
    return '';
  },
  // Invite (or give a new link to) someone by IC. gen: keep the current sign-in generation, or bump it to reset.
  async staffInvite(emp, { reset = false } = {}) {
    if (!M.validIc(emp.ic)) return { error: `${emp.first} has no valid 12-digit IC on their profile.` };
    const tid = S.profile.tenantId, key = M.staffKey(tid, emp.ic);
    try {
      const code = await api.companyCode();
      if (!code) return { error: 'Couldn’t make a company code. Try again.' };
      const [old, k] = await Promise.all([getDoc(doc(db, `staffInvites/${key}`)).catch(() => null), getDoc(doc(db, `staffKeys/${key}`)).catch(() => null)]);
      const was = old?.exists() ? old.data() : null;
      // The current generation is the higher of the invitation's and the sign-in key's (the open join page and
      // "This is not them" move only the key).
      const cur = Math.max(Number(was?.gen) || 0, Number(k?.exists() ? k.data().gen : 0) || 0);
      const gen = cur + (reset || !cur ? 1 : 0);
      const link = M.joinSecret(crypto.getRandomValues(new Uint8Array(32)));
      const expiresAt = FS.Timestamp.fromDate(window.AllurusInvite.expiry());
      const b = writeBatch(db);
      b.set(doc(db, `staffInvites/${key}`), { tenantId: tid, ic: M.icDigits(emp.ic), empId: emp.id, gen, link, expiresAt, invitedBy: S.profile.email, invitedAt: serverTimestamp() });
      b.set(doc(db, `staffKeys/${key}`), { tenantId: tid, gen });
      b.set(doc(db, `joinLinks/${link}`), { tenantId: tid, company: String(app.state.settings?.company || '').slice(0, 120), code, gen, empId: emp.id, name: String(emp.first || '').slice(0, 60), expiresAt });
      if (was?.link) b.delete(doc(db, `joinLinks/${was.link}`));
      await b.commit();
      return { ok: true, url: `${location.origin}/join?k=${link}`, code, expiresAt: expiresAt.toDate() };
    } catch (e) { console.warn('[Allurus cloud] staff invite', e?.code); return { error: e?.code === 'permission-denied' ? 'You need the Settings area to invite people.' : 'Couldn’t save the invitation. Check your connection.' }; }
  },
  // For a bulk invite: read the invitation fresh, just before. True if they have none or it has expired (so a
  // retry or a second window never makes a second link for someone whose link still works).
  async staffNeedsLink(emp) {
    const s = await getDoc(doc(db, `staffInvites/${M.staffKey(S.profile.tenantId, emp.ic)}`));
    return !s.exists() || !window.AllurusInvite.usable(s.data());
  },
  // ----- Allurus support access (the client's own admins): the grant and the log -----
  async supportGrant() {
    const g = await getDoc(doc(db, `${T()}/support/grant`)).catch(() => null);
    const d = g?.exists() ? g.data() : {}, now = Date.now(), live = (x) => (x && x.toMillis() > now ? x.toDate() : null);
    return { until: live(d.until), payUntil: live(d.payUntil) };
  },
  // days: 1, 7 or 30 (null turns it off); pay: also allow pay and ID data, for the same time (needs edits on).
  async setSupportGrant(days, pay) {
    const until = days ? FS.Timestamp.fromMillis(Date.now() + days * 864e5 - 60e3) : null;
    try {
      await setDoc(doc(db, `${T()}/support/grant`), { until, payUntil: until && pay ? until : null, by: S.profile.uid, at: serverTimestamp() });
      return { ok: true, until: until ? until.toDate() : null };
    } catch (e) { return { error: e?.code === 'permission-denied' ? 'You need the Settings area to change support access.' : 'Couldn’t save. Check your connection.' }; }
  },
  async supportLog() {
    const r = await getDocs(query(collection(db, `${T()}/supportLog`), FS.orderBy('at', 'desc'), FS.limit(200))).catch(() => ({ docs: [] }));
    return r.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
  // ----- The open join page (allurus.my/join): Open registration on or off, approve, "This is not them" -----
  async openRegistration(on, days = 7) {
    const code = await api.companyCode();
    if (!code) return { error: 'Couldn’t make a company code. Try again.' };
    const until = on ? FS.Timestamp.fromMillis(Date.now() + Math.min(31, Math.max(1, days)) * 864e5 - 60e3) : null;
    try {
      const b = writeBatch(db);
      b.set(doc(db, `companyCodes/${code}`), { tenantId: S.profile.tenantId, openUntil: until, company: String(app.state.settings?.company || '').slice(0, 120) }, { merge: true });   // keeps the join key's salt
      if (on && Array.isArray(app.state.employees)) {
        app.state.employees.filter((e) => e && e.ic).forEach((e) => {
          const ic = M.icDigits(e.ic);
          if (M.validIc(ic)) {
            // No name or empId here: staffKeys is readable without signing in, for the IC check before auth
            // (gap 3/5, owner's 2026-11-07 review) - neither is needed before sign-in; approve() matches the
            // account to its employee by IC, not by this field.
            b.set(doc(db, `staffKeys/${S.profile.tenantId}~${ic}`), {
              tenantId: S.profile.tenantId,
              gen: 1,
              empId: deleteField(),
              name: deleteField()
            }, { merge: true });
          }
        });
      }
      await b.commit();
      return { ok: true, code, until: until ? until.toDate() : null };
    } catch (e) { return { error: e?.code === 'permission-denied' ? 'You need the Settings area for this.' : 'Couldn’t save. Check your connection.' }; }
  },
  async syncStaffKey(emp) {
    if (!S.profile?.tenantId || !emp?.ic) return;
    const ic = M.icDigits(emp.ic);
    if (!M.validIc(ic)) return;
    const tid = S.profile.tenantId;
    const key = `${tid}~${ic}`;
    if (S.icSeen && emp.id && !(emp.id in S.icSeen)) S.icSeen[emp.id] = ic;   // remember a new person's IC, so changing it later removes this key
    try {
      const k = await getDoc(doc(db, `staffKeys/${key}`)).catch(() => null);
      const gen = k?.exists() ? (Number(k.data().gen) || 1) : 1;
      // No name or empId here: staffKeys is readable without signing in, for the IC check before auth (gap 3/5).
      await setDoc(doc(db, `staffKeys/${key}`), {
        tenantId: tid,
        gen,
        empId: deleteField(),
        name: deleteField()
      }, { merge: true });
    } catch (e) { console.warn('[Allurus cloud] syncStaffKey', e); }
  },
  async syncAllStaffKeys(employees = app.state?.employees) {
    if (!S.profile?.tenantId || !Array.isArray(employees)) return;
    const tid = S.profile.tenantId;
    const b = writeBatch(db);
    let count = 0;
    employees.forEach((e) => {
      if (e?.ic) {
        const ic = M.icDigits(e.ic);
        if (M.validIc(ic)) {
          // No name or empId here: staffKeys is readable without signing in, for the IC check before auth (gap 3/5).
          b.set(doc(db, `staffKeys/${tid}~${ic}`), {
            tenantId: tid,
            gen: 1,
            empId: deleteField(),
            name: deleteField()
          }, { merge: true });
          count++;
        }
      }
    });
    if (count > 0) {
      try { await b.commit(); } catch (e) { console.warn('[Allurus cloud] syncAllStaffKeys', e); }
    }
  },
  async openStatus() {
    const code = app.state.settings?.staffCode;
    if (!code) return { code: '', until: null, hasKey: false };
    const c = await getDoc(doc(db, `companyCodes/${code}`)).catch(() => null);
    const u = c?.exists() ? c.data().openUntil : null;
    return { code, until: u && u.toMillis() > Date.now() ? u.toDate() : null, hasKey: !!(c?.exists() && c.data().salt) };
  },
  // The company join key: a new random salt each time, and only the salted hash is saved (joinKeys/{company},
  // which no browser can read). The salt goes on the public company code so the join page can hash what's typed.
  async setJoinKey(key) {
    const code = await api.companyCode();
    if (!code) return { error: 'Couldn’t make a company code. Try again.' };
    try {
      const salt = M.newSalt(crypto.getRandomValues(new Uint8Array(16))), hash = await M.joinKeyHash(salt, key);
      const b = writeBatch(db);
      b.set(doc(db, `joinKeys/${S.profile.tenantId}`), { salt, hash });
      b.set(doc(db, `companyCodes/${code}`), { salt }, { merge: true });
      await b.commit();
      return { ok: true, code };
    } catch (e) { console.warn('[Allurus cloud] join key', e?.code); return { error: e?.code === 'permission-denied' ? 'You need the Settings area for this.' : 'Couldn’t save the key. Check your connection.' }; }
  },
  async removeJoinKey() {
    const code = app.state.settings?.staffCode;
    try {
      const b = writeBatch(db);
      b.delete(doc(db, `joinKeys/${S.profile.tenantId}`));
      if (code) b.set(doc(db, `companyCodes/${code}`), { salt: deleteField() }, { merge: true });
      await b.commit();
      return { ok: true };
    } catch (e) { return { error: 'Couldn’t remove the key. Check your connection.' }; }
  },
  // Approve someone who registered on the open page as this employee: their profile gets the employee and is no
  // longer pending; the sign-in key is set to their generation; any personal link for that IC stops working.
  async approveOpen(u, emp) {
    let users = [];
    try { users = (await getDocs(query(collection(db, 'users'), where('tenantId', '==', S.profile.tenantId)))).docs.map((d) => ({ uid: d.id, ...d.data() })); } catch (e) { return { error: 'Couldn’t check the existing sign-ins. Nothing was changed. Reload and try again.' }; }
    const bad = M.approvalProblem({ signInIc: String(u.email || '').split('.')[0], emp, employees: app.state.employees, users, uid: u.uid });
    if (bad) return { error: bad + ' Nothing was changed.' };
    const key = M.staffKey(S.profile.tenantId, emp.ic), gen = Number((u.email.match(/\.g(\d+)@/) || [])[1]) || 1;
    try {
      const old = await getDoc(doc(db, `staffInvites/${key}`)).catch(() => null);
      const b = writeBatch(db);
      b.update(doc(db, `users/${u.uid}`), { pending: false, empId: emp.id, ...(u.keyProof ? { keyProof: deleteField() } : {}) });
      b.set(doc(db, `staffKeys/${key}`), { tenantId: S.profile.tenantId, gen });
      if (old?.exists()) { if (old.data().link) b.delete(doc(db, `joinLinks/${old.data().link}`)); b.delete(doc(db, `staffInvites/${key}`)); }
      await b.commit();
      return { ok: true };
    } catch (e) { console.warn('[Allurus cloud] approve', e?.code); return { error: 'Couldn’t approve. Reload and try again.' }; }
  },
  // "This is not them": turn that account off and move the IC to the next generation, so the real person can
  // register again (on the open page or with a personal link).
  async rejectOpen(u, ic) {
    const key = M.staffKey(S.profile.tenantId, ic), gen = Number((u.email.match(/\.g(\d+)@/) || [])[1]) || 1;
    try {
      const old = await getDoc(doc(db, `staffInvites/${key}`)).catch(() => null);
      const b = writeBatch(db);
      b.update(doc(db, `users/${u.uid}`), { disabled: true });
      b.set(doc(db, `staffKeys/${key}`), { tenantId: S.profile.tenantId, gen: gen + 1 });
      if (old?.exists()) { if (old.data().link) b.delete(doc(db, `joinLinks/${old.data().link}`)); b.delete(doc(db, `staffInvites/${key}`)); }
      await b.commit();
      return { ok: true };
    } catch (e) { console.warn('[Allurus cloud] reject', e?.code); return { error: 'Couldn’t turn that account off. Reload and try again.' }; }
  },
  // Reset sign-in: a new generation and link; their old account stops working at once.
  async staffReset(emp, uid) {
    const res = await api.staffInvite(emp, { reset: true });
    if (res.ok && uid) { const d = await api.setDisabled(uid, true); if (d.error) return { ...res, warn: d.error }; }
    return res;
  },
  // Remove access: the invitation, link and key go; their profile is turned off.
  async staffRemove(emp, uid) {
    const key = M.staffKey(S.profile.tenantId, emp.ic);
    try {
      const [old, k] = await Promise.all([getDoc(doc(db, `staffInvites/${key}`)).catch(() => null), getDoc(doc(db, `staffKeys/${key}`)).catch(() => null)]);
      const b = writeBatch(db);
      if (old?.data()?.link) b.delete(doc(db, `joinLinks/${old.data().link}`));
      b.delete(doc(db, `staffInvites/${key}`));
      // Keep the key one generation on (not deleted): their old account's email is used up, so a later invite or
      // open registration must make a new one.
      const cur = Math.max(Number(old?.data()?.gen) || 0, Number(k?.exists() ? k.data().gen : 0) || 0);
      if (cur) b.set(doc(db, `staffKeys/${key}`), { tenantId: S.profile.tenantId, gen: cur + 1 });
      await b.commit();
      if (uid) { const d = await api.setDisabled(uid, true); if (d.error) return d; }
      return { ok: true };
    } catch (e) { return { error: 'Couldn’t remove access.' }; }
  },
  // Notes from the join page when a new account's details couldn't be saved (no IC or phone in them).
  async joinIssues() {
    const r = await getDocs(collection(db, `${T()}/joinIssues`)).catch(() => ({ docs: [] }));
    return r.docs.map((d) => ({ uid: d.id, ...d.data() }));
  },
  async clearJoinIssue(uid) { await FS.deleteDoc(doc(db, `${T()}/joinIssues/${uid}`)).catch(() => {}); },
  async staffInvites() {
    const r = await getDocs(query(collection(db, 'staffInvites'), where('tenantId', '==', S.profile.tenantId))).catch(() => ({ docs: [] }));
    return r.docs.map((d) => ({ id: d.id, ...d.data(), link: undefined }));
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

// Persistent staff session helpers ("Never Log Out" policy). Firebase Auth's own browser persistence (not this
// record) is what keeps someone signed in across reloads; this just remembers who/which device for UX (device
// mismatch warnings, etc). It must never hold the PIN or password itself - security gap 2, 2026-11-07 review.
function getStaffSession() {
  let sess = null;
  try {
    const raw = localStorage.getItem('allurus_staff_session');
    if (raw) sess = JSON.parse(raw);
  } catch (e) {}
  if (!sess) {
    try {
      const m = document.cookie.match(/(?:^|;\s*)allurus_staff_token=([^;]+)/);
      if (m) sess = JSON.parse(decodeURIComponent(m[1]));
    } catch (e) {}
  }
  if (sess && ('pin' in sess || 'ic' in sess)) {
    // Migrate away a PIN saved before the 2026-11-07 security fix, and the IC number (it sat in a ten-year cookie).
    delete sess.pin; delete sess.ic;
    saveStaffSession(sess);
  }
  return sess;
}
function saveStaffSession(sess) {
  try {
    localStorage.setItem('allurus_staff_session', JSON.stringify(sess));
    document.cookie = `allurus_staff_token=${encodeURIComponent(JSON.stringify(sess))}; max-age=315360000; path=/; SameSite=Lax`;
  } catch (e) {}
}
function clearStaffSession() {
  try { window.AllurusSession ? window.AllurusSession.clearLocal() : (localStorage.removeItem('allurus_staff_session'), document.cookie = 'allurus_staff_token=; max-age=0; path=/; SameSite=Lax'); } catch (e) {}
}

// A returning visitor whose sign-in is still valid: reconnect to their workspace.
let firstAuth = true;
Auth.onAuthStateChanged(auth, async (user) => {
  // "Log out" on the landing page (allurus.my) links to /app?signout: sign out here, then go back to the landing page.
  if (/[?&]signout\b/.test(location.search)) {
    try { await Auth.signOut(auth); } catch (e) { /* already signed out */ }
    clearStaffSession();
    window.AllurusSession?.clearLocal();
    await window.AllurusSession?.clearFirestoreCache(FS, db);
    location.replace('/'); return;
  }
  const sess = app.state.session;
  if (!firstAuth) return;
  firstAuth = false;

  // Staff sign-in persistence is Firebase Auth's own (browser local persistence) - it survives reloads on its
  // own, so there is no stored password/PIN to re-authenticate with here. We only check the remembered device
  // still matches, as a UX warning; the actual access decision is Firebase Auth's session, checked by the rules.
  if (!user) {
    const staffSess = getStaffSession();
    const curDev = (M.getDeviceId ? M.getDeviceId() : (localStorage.getItem('allurus_device_id') || 'dev-unsaved'));
    if (staffSess?.deviceId && curDev && curDev !== 'dev-unsaved' && staffSess.deviceId !== curDev) {
      console.warn('[Allurus cloud] stored staff session is for a different device');
      clearStaffSession();
    }
  }

  // Superadmin opening a company from allurus.my/superadmin (/app?view=<company>): read-only, nothing is sent.
  const viewId = new URLSearchParams(location.search).get('view');
  if (user && viewId) {
    try {
      const tok = await user.getIdTokenResult(true);
      if (tok.claims.role === 'superadmin') {
        const t = await getDoc(doc(db, `tenants/${viewId}`));
        if (t.exists()) {
          // The company's grant: edits until `until`, pay and ID data until `payUntil` (its own admins set it).
          const g = await getDoc(doc(db, `tenants/${viewId}/support/grant`)).catch(() => null);
          const now = Date.now(), gd = g?.exists() ? g.data() : {};
          const edit = !!(gd.until && gd.until.toMillis() > now), pay = !!(gd.payUntil && gd.payUntil.toMillis() > now);
          const sup = { edit, pay, until: edit ? gd.until.toMillis() : null };
          // Support sees no payroll or per-person documents unless pay is allowed (the rules refuse them anyway).
          const areas = ['people', 'time', 'claims', 'finance', 'talent', 'operations', 'settings', ...(pay ? ['payroll'] : [])];
          const prof = { uid: user.uid, email: lower(user.email), name: 'Allurus support', tenantId: viewId, roles: ['admin', 'employee'], empId: 'e1', viewOnly: !edit, support: sup, perms: areas };
          // Every visit is in the client's support log, read-only ones too; the client's admins get a notice.
          try { await setDoc(doc(collection(db, `tenants/${viewId}/supportLog`)), { kind: 'session', actorUid: user.uid, actorEmail: lower(user.email), at: serverTimestamp(), label: edit ? 'Support session started (editing allowed)' : 'Support session started (read-only)', pay }); }
          catch (e) { console.warn('[Allurus cloud] support log', e?.code); app.toast('Couldn’t write the support log, so this company opens read-only.', 'error'); prof.viewOnly = true; sup.edit = false; }
          await start(prof); app.cloudViewOnly(t.data().name || viewId, sup); return;
        }
      }
    } catch (e) { console.warn('[Allurus cloud] superadmin view', e?.code); }
    app.toast('You can’t view that company.', 'error');
  }
  // Straight from allurus.my/activate: they're signed in with their new password; open their workspace.
  if (user && /[?&]activated\b/.test(location.search)) {
    history.replaceState(null, '', location.pathname + location.hash);
    try {
      const prof = await profileFor(user);
      if (!prof.error) {
        // The first admin of a company the superadmin opened: claim it and lay down its empty workspace, once.
        const tref = doc(db, `tenants/${prof.tenantId}`), t = await getDoc(tref).catch(() => null);
        // A company that signed itself up (allurus.my/signup) is already theirs; it gets the same empty workspace.
        const d = t?.exists() ? t.data() : null, mine = d && lower(d.admin) === lower(user.email);
        const unclaimed = mine && d.owner == null, selfNew = mine && d.owner === user.uid && d.createdVia === 'self_signup' && !d.workspaceReady;
        if (unclaimed || selfNew) {
          if (unclaimed) await setDoc(tref, { owner: user.uid }, { merge: true });
          const ws = app.firstWorkspace({ name: d.name, email: lower(user.email), adminName: d.adminName || prof.name || user.email, city: d.city || undefined, phone: d.phone || '' });
          S.profile = { ...prof }; S.admin = true; S.perms = null; S.live = true;
          app.adoptCloud(ws, S.profile); await push(); S.live = false;
          if (selfNew) await setDoc(tref, { workspaceReady: true }, { merge: true }).catch(() => {});
        }
        await start(prof); app.cloudSignedIn(); return;
      }
    } catch (e) { if (e?.device) return; console.warn('[Allurus cloud] after activation', e?.code); }
  }
  if (user) {
    try {
      const prof = await profileFor(user);
      if (prof.error === 'disabled') {
        clearStaffSession();
        await Auth.signOut(auth);
        app.cloudReady('signed-out');
        return;
      }
      if (!prof.error) {
        // Which phone may be used is decided in start() (phoneGate), for everyone, on phones only.
        await start(prof);
        app.cloudSignedIn();
        return;
      }
    } catch (e) {
      if (e?.blocked || e?.device) return;
      console.warn('[Allurus cloud] resume', e?.code || e?.message);
    }
  }
  app.cloudReady('signed-out');
});

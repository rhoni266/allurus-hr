// How a company's workspace is laid out in the cloud database (Firebase Firestore), and how two copies are merged.
// Pure functions with no DOM or network access, so they can be unit-tested in Node. js/cloud.js does the I/O.
//
// Layout under tenants/{tenantId}/:
//   buckets/{id}    Most of the workspace. One document per top-level key (leaves, claims, settings…), with one
//                   field per record, so two people editing different records never overwrite each other.
//                   Attendance gets one document per month with one field per person per day. Finance and
//                   costing get one document per list. Each document says who may read it in field `r`:
//                   'm' every member of the company, 'a' admins only (payroll, finance, loans…).
//   people/{empId}  The full employee record, one field per property. Admins and the person themselves only.
//                   Everyone else sees the `directory` bucket: name, role, team and contact details, no pay or IC.
//   payslips/{empId} That person's lines from each payroll run. Admins write; admins and the person read.
//   personal/{empId} The employee's own financial plan and tax reliefs. Only the person.
//   blobs/{hash}    Photos and files (selfies, receipts, MCs), stored once and fetched only when shown.
//
// Operations (stock, production, sales, machines) are buckets "ops.<list>" for admins with the operations area,
// except machines, products and breakdowns, which every member reads (anyone may report a breakdown). Delivery
// orders are split by driver, "ops.dos~<empId>", so a driver reads and updates only their own deliveries.
(function (root) {
  'use strict';

  // ---------- Access (kept in step with firestore.rules) ----------
  // Who may read a bucket, in its field `r`: 'm' every member, 'a' any Company Admin, 'p' admins with the payroll
  // area, 'f' admins with the finance area, 'o' admins with the operations area, 'd:<empId>' that driver and admins
  // with the operations area. Writing needs an admin with the bucket's area; other buckets are for every member
  // (leave, claims, attendance…). `perms` is a person's list of areas; null means every area (Owner).
  const PAYROLL = ['payroll', 'payChanges', 'loans', 'insurance'];
  const ADMIN_ONLY = ['savedReports', 'importData'];
  const WRITE_AREA = { settings: 'settings', departments: 'people', directory: 'people', statutory: 'payroll', cycles: 'talent', importData: 'people' };
  const isFinance = (b) => b === 'finance' || b.startsWith('finance.');
  const isOps = (b) => b === 'ops' || b.startsWith('ops.');
  const OPS_SHARED = ['ops.machines', 'ops.products', 'ops.breakdowns'];
  // The driver whose deliveries a bucket holds ("ops.dos~e26" → "e26"), or ''.
  const driverOf = (b) => (b.startsWith('ops.dos~') ? b.slice(8) : '');
  const readClass = (b) => (PAYROLL.includes(b) ? 'p' : isFinance(b) ? 'f' : ADMIN_ONLY.includes(b) ? 'a' : driverOf(b) ? `d:${driverOf(b)}` : isOps(b) && !OPS_SHARED.includes(b) ? 'o' : 'm');
  const has = (admin, perms, area) => !!admin && (!perms || perms.includes(area));
  const writeArea = (b) => (PAYROLL.includes(b) ? 'payroll' : isFinance(b) ? 'finance' : isOps(b) && b !== 'ops.breakdowns' ? 'operations' : WRITE_AREA[b] || (ADMIN_ONLY.includes(b) ? 'admin' : ''));
  // Whether a person may write a bucket. empId lets a driver update their own deliveries. Breakdowns are open to
  // every member, but the rules let someone without the operations area only add new reports.
  function canWrite(b, admin, perms, empId = '') {
    const a = writeArea(b);
    if (!a) return true;
    if (driverOf(b) && driverOf(b) === empId) return true;
    return a === 'admin' ? !!admin : has(admin, perms, a);
  }
  // The read classes a person may query. Admins with the operations area also read every driver's deliveries,
  // with a second query on the 'd:' range (see js/cloud.js).
  const readable = (admin, perms, empId = '') => ['m', ...(admin ? ['a'] : []), ...(has(admin, perms, 'payroll') ? ['p'] : []), ...(has(admin, perms, 'finance') ? ['f'] : []), ...(has(admin, perms, 'operations') ? ['o'] : []), ...(empId ? [`d:${empId}`] : [])];
  // Full staff records (pay, bank, IC) are for admins with the people or payroll area; payslips for payroll.
  const seesPeople = (admin, perms) => has(admin, perms, 'people') || has(admin, perms, 'payroll');
  const seesPayroll = (admin, perms) => has(admin, perms, 'payroll');
  // Kept for older callers: admin-only buckets are every class other than 'm'.
  const isAdminRead = (b) => readClass(b) !== 'm';
  const isAdminWrite = (b) => !!writeArea(b);

  // Keys stored outside the buckets, and keys whose children each get their own bucket.
  const SPECIAL = new Set(['employees', 'payroll', 'plans']);
  const NAMESPACE = new Set(['finance', 'costing', 'ops']);
  // Lists split into one bucket per owner: the list → the record field that names the owner.
  const SPLIT = { 'ops.dos': 'driverId' };
  const MONTHLY = new Set(['attendance']);
  // Per-person display choices that must not follow the company around.
  const LOCAL_SETTINGS = new Set(['theme']);

  // What colleagues may see of each other. Pay, bank, IC, tax and face data stay in people/{empId}.
  const DIRECTORY_FIELDS = ['id', 'first', 'last', 'role', 'dept', 'location', 'email', 'phone', 'status', 'manager', 'start', 'type', 'birthday', 'gender', 'timePattern', 'endDate', 'devices'];
  // What an employee may change on their own record from their phone: their registered phones and face reference.
  const SELF_FIELDS = ['devices', 'face'];

  // ---------- Canonical JSON (sorted keys), so equal data always compares equal ----------
  function stable(v) {
    if (v === undefined) return undefined;
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : stable(x))).join(',') + ']';
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }

  // ---------- Photos and files ----------
  // Long data: URLs move to blobs/{hash}; the record keeps a short "cloudblob:<hash>" marker.
  const BLOB_MIN = 2000, BLOB_MAX = 1000000, MARK = 'cloudblob:';
  // 53-bit string hash (cyrb53), run twice with different seeds for a 106-bit id. Not cryptographic; it only
  // names content. The rules make blobs create-only, so a collision can't overwrite someone's photo.
  function cyrb53(str, seed) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  const blobId = (data) => cyrb53(data, 1) + cyrb53(data, 7) + data.length.toString(36);
  const isBlobData = (s) => typeof s === 'string' && s.length >= BLOB_MIN && s.startsWith('data:');
  // A copy of v with large data: URLs replaced by markers; each found file is reported to onBlob(id, data).
  function extract(v, onBlob) {
    if (typeof v === 'string') {
      if (!isBlobData(v)) return v;
      if (v.length > BLOB_MAX) { onBlob(null, v); return MARK + 'toolarge'; }
      const id = blobId(v); onBlob(id, v); return MARK + id;
    }
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => extract(x, onBlob));
    const o = {}; for (const k of Object.keys(v)) o[k] = extract(v[k], onBlob); return o;
  }
  // Put known files back in place of their markers; unknown ones stay as markers until fetched.
  function restore(v, lookup) {
    if (typeof v === 'string') return v.startsWith(MARK) ? (lookup(v.slice(MARK.length)) ?? v) : v;
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = restore(v[i], lookup); return v; }
    for (const k of Object.keys(v)) v[k] = restore(v[k], lookup);
    return v;
  }
  const enc = (v, onBlob) => stable(extract(v, onBlob || (() => {})));
  const dec = (s, lookup) => restore(JSON.parse(s), lookup || (() => undefined));

  // ---------- Workspace → documents ----------
  const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const isIdArray = (a) => Array.isArray(a) && a.every((x) => isPlain(x) && (typeof x.id === 'string' || typeof x.id === 'number'));
  const fieldKey = (k) => String(k);
  // A list: one field per record plus "~ord", the ids in order, kept apart so that adding a record at the top
  // doesn't count as a change to every other record. A list of plain values is one "_" field.
  const ORD = '~ord';
  function arrayFields(a, onBlob) {
    const f = {};
    if (isIdArray(a)) { a.forEach((x) => { f[fieldKey(x.id)] = enc(x, onBlob); }); f[ORD] = stable(a.map((x) => fieldKey(x.id))); }
    else f._ = enc(a, onBlob);
    return f;
  }
  // Records in "~ord" order; any the order doesn't list yet go first (new records are usually added at the top).
  function arrayFrom(fields, lookup) {
    if (fields._ !== undefined) return dec(fields._, lookup);
    const ord = fields[ORD] ? JSON.parse(fields[ORD]) : [];
    const ids = Object.keys(fields).filter((k) => k !== ORD);
    const listed = new Set(ord);
    const order = [...ids.filter((k) => !listed.has(k)), ...ord.filter((k) => fields[k] !== undefined)];
    return order.map((k) => dec(fields[k], lookup));
  }
  function objectFields(o, onBlob, skip) {
    const f = {};
    Object.keys(o).forEach((k) => { if (o[k] !== undefined && !(skip && skip.has(k))) f[fieldKey(k)] = enc(o[k], onBlob); });
    return f;
  }

  // Every bucket for a workspace: id → { t: type, r: read class, f: { field: canonical string } }.
  // Types: 'a' list, 'o' object, 'm' month of attendance, 'n' plain values of a namespace, 'v' top-level values,
  // 's' one owner's share of a split list (SPLIT).
  function bucketsOf(ws, keys, onBlob) {
    const out = {};
    const put = (id, t, f) => { out[id] = { t, r: readClass(id), f }; };
    const meta = {};
    keys.forEach((k) => {
      if (SPECIAL.has(k)) return;
      const v = ws[k];
      if (v === undefined) return;
      if (NAMESPACE.has(k) && isPlain(v)) {
        const plain = {};
        Object.keys(v).forEach((p) => {
          const by = SPLIT[`${k}.${p}`];
          if (Array.isArray(v[p]) && by) {
            const groups = {};
            v[p].forEach((x) => { const o = String((isPlain(x) && x[by]) || '_'); (groups[o] = groups[o] || []).push(x); });
            Object.keys(groups).forEach((o) => put(`${k}.${p}~${o}`, 's', arrayFields(groups[o], onBlob)));
          } else if (Array.isArray(v[p])) put(`${k}.${p}`, 'a', arrayFields(v[p], onBlob));
          else if (v[p] !== undefined) plain[p] = enc(v[p], onBlob);
        });
        put(k, 'n', plain);
      } else if (MONTHLY.has(k) && isPlain(v)) {
        const months = {};
        Object.keys(v).forEach((date) => {
          const day = v[date]; if (!isPlain(day)) return;
          const m = date.slice(0, 7);
          months[m] = months[m] || {};
          Object.keys(day).forEach((emp) => { if (day[emp] !== undefined) months[m][`${date}|${emp}`] = enc(day[emp], onBlob); });
        });
        Object.keys(months).forEach((m) => put(`${k}~${m}`, 'm', months[m]));
      } else if (Array.isArray(v)) put(k, 'a', arrayFields(v, onBlob));
      else if (isPlain(v)) put(k, 'o', objectFields(v, onBlob, k === 'settings' ? LOCAL_SETTINGS : null));
      else meta[k] = enc(v, onBlob);
    });
    put('_meta', 'v', meta);
    return out;
  }

  // Apply one bucket's fields to a workspace (in place).
  function applyBucket(ws, id, t, fields, lookup) {
    const keys = Object.keys(fields);
    if (t === 'a') {
      const k = id.includes('.') ? id.split('.') : [id];
      const arr = arrayFrom(fields, lookup);
      if (k.length === 2) { ws[k[0]] = isPlain(ws[k[0]]) ? ws[k[0]] : {}; ws[k[0]][k[1]] = arr; } else ws[id] = arr;
    } else if (t === 's') {
      // One owner's records replace that owner's records in the list; everyone else's stay.
      const [path, who] = id.split('~'), [k, p] = path.split('.'), by = SPLIT[path];
      ws[k] = isPlain(ws[k]) ? ws[k] : {};
      const rest = (Array.isArray(ws[k][p]) ? ws[k][p] : []).filter((x) => String((isPlain(x) && x[by]) || '_') !== who);
      ws[k][p] = [...rest, ...arrayFrom(fields, lookup)];
    } else if (t === 'o') {
      const keep = id === 'settings' && isPlain(ws.settings) ? Object.fromEntries([...LOCAL_SETTINGS].filter((x) => ws.settings[x] !== undefined).map((x) => [x, ws.settings[x]])) : {};
      const o = {}; keys.forEach((f) => { o[f] = dec(fields[f], lookup); });
      ws[id] = { ...o, ...keep };
    } else if (t === 'n') {
      ws[id] = isPlain(ws[id]) ? ws[id] : {};
      keys.forEach((f) => { ws[id][f] = dec(fields[f], lookup); });
    } else if (t === 'm') {
      const [k, m] = id.split('~');
      ws[k] = isPlain(ws[k]) ? ws[k] : {};
      Object.keys(ws[k]).forEach((date) => { if (date.slice(0, 7) === m) delete ws[k][date]; });
      keys.forEach((f) => { const [date, emp] = f.split('|'); (ws[k][date] = ws[k][date] || {})[emp] = dec(fields[f], lookup); });
    } else if (t === 'v') keys.forEach((f) => { ws[f] = dec(fields[f], lookup); });
  }

  // ---------- People, payslips and personal documents ----------
  // A person's full record, one field per property, plus "~o" for their place in the list.
  function personFields(e, order, onBlob) { const f = objectFields(e, onBlob); f['~o'] = String(order); return f; }
  function personFrom(fields, lookup) { const e = {}; Object.keys(fields).forEach((k) => { if (k !== '~o') e[k] = dec(fields[k], lookup); }); return e; }
  // The directory as a list, in the order the admin keeps employees.
  const directoryFrom = (fields, lookup) => arrayFrom(fields || {}, lookup);
  const directoryEntry = (e) => Object.fromEntries(DIRECTORY_FIELDS.filter((k) => e[k] !== undefined).map((k) => [k, e[k]]));
  function directoryFields(employees, onBlob) { return arrayFields(employees.map(directoryEntry), onBlob); }
  // Employees as one person sees them: everyone's directory card, with their own full record in its place.
  function employeesFor(directoryArr, own) {
    const list = (directoryArr || []).map((d) => (own && d.id === own.id ? { ...d, ...own } : { ...d }));
    if (own && !list.some((d) => d.id === own.id)) list.push({ ...own });
    return list;
  }
  // One person's lines from every payroll run: month → { ...run without other people's lines, items: [theirs] }.
  function payslipFields(payroll, empId) {
    const f = {};
    Object.keys(payroll || {}).forEach((m) => {
      const run = payroll[m]; if (!isPlain(run)) return;
      const mine = (run.items || []).filter((x) => x.empId === empId);
      if (!mine.length) return;
      const { items, ...rest } = run;
      f[m] = stable({ ...rest, items: mine });
    });
    return f;
  }
  function payrollFrom(fields) { const p = {}; Object.keys(fields || {}).forEach((m) => { p[m] = JSON.parse(fields[m]); }); return p; }
  function personalFields(state, empId, email) {
    const f = {};
    if (state.plans && state.plans[empId] !== undefined) f.plan = stable(state.plans[empId]);
    if (email && state.reliefs && state.reliefs[email] !== undefined) f.reliefs = stable(state.reliefs[email]);
    if (email && state.taxProfiles && state.taxProfiles[email] !== undefined) f.tax = stable(state.taxProfiles[email]);
    return f;
  }
  function applyPersonal(state, fields, empId, email) {
    state.plans = { ...(state.plans || {}) }; state.reliefs = { ...(state.reliefs || {}) }; state.taxProfiles = { ...(state.taxProfiles || {}) };
    if (fields.plan !== undefined) state.plans[empId] = JSON.parse(fields.plan);
    if (email && fields.reliefs !== undefined) state.reliefs[email] = JSON.parse(fields.reliefs);
    if (email && fields.tax !== undefined) state.taxProfiles[email] = JSON.parse(fields.tax);
  }

  // ---------- Merging ----------
  // Three-way merge of one document's fields. base: what the server had when we last heard; local: ours now;
  // remote: what the server has now. A field we haven't changed since base takes the server's value (including a
  // delete); a field we changed keeps ours, to be sent next. Returns the merged fields.
  function merge3(base, local, remote) {
    const out = {};
    const keys = new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remote || {})]);
    keys.forEach((k) => {
      if (k === ORD) return;
      const b = base?.[k], l = local?.[k], r = remote?.[k];
      const v = l === b ? r : l;
      if (v !== undefined) out[k] = v;
    });
    // The order: ours if we reordered, else the server's; either way it lists exactly the records that remain.
    const lo = local?.[ORD], bo = base?.[ORD], ro = remote?.[ORD];
    const pick = lo !== undefined && lo !== bo ? lo : (ro !== undefined ? ro : lo);
    if (pick !== undefined) {
      const ord = JSON.parse(pick).filter((id) => out[id] !== undefined), seen = new Set(ord);
      const fresh = Object.keys(out).filter((k) => k !== '_' && !seen.has(k));
      if (out._ === undefined) out[ORD] = stable([...fresh, ...ord]);
    }
    return out;
  }
  // The changes to send: fields set or changed, and fields removed, comparing local with what the server has.
  function diff(base, local) {
    const set = {}, del = [];
    Object.keys(local || {}).forEach((k) => { if (local[k] !== base?.[k]) set[k] = local[k]; });
    Object.keys(base || {}).forEach((k) => { if (local?.[k] === undefined) del.push(k); });
    return { set, del, empty: !Object.keys(set).length && !del.length };
  }
  const sameFields = (a, b) => diff(a, b).empty;
  // Rough size of a document in bytes, to stay under Firestore's 1 MiB limit.
  const docBytes = (f) => Object.keys(f).reduce((s, k) => s + k.length + (f[k] || '').length + 2, 0);

  root.AllurusCloudMap = {
    PAYROLL, WRITE_AREA, isAdminRead, isAdminWrite, readClass, canWrite, writeArea, readable, driverOf, isOps, SPLIT, seesPeople, seesPayroll, has, DIRECTORY_FIELDS, SELF_FIELDS, MARK, BLOB_MAX,
    stable, blobId, extract, restore, enc, dec, bucketsOf, applyBucket, arrayFrom, personFields, personFrom, directoryEntry, directoryFields, directoryFrom,
    employeesFor, payslipFields, payrollFrom, personalFields, applyPersonal, merge3, diff, sameFields, docBytes,
  };
})(typeof window !== 'undefined' ? window : globalThis);

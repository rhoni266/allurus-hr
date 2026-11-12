// End to end, in REAL cloud mode, against the Firebase emulators (Auth + Firestore, project demo-allurus-e2e; nothing leaves this machine):
// a staff sign-in that is not linked to an employee record must see only the "not linked" screen and never another person's record.
// Incident 2026-11-11/12: me() fell back to the first employee (HR admin Nadia) because the guard tested cloud.db, which is always null
// in the real workspace; the demo never showed it.
//
//   npm run test:e2e-cloud           (needs Microsoft Edge or Chrome installed; Playwright drives it)
//   OLD=1 npm run test:e2e-cloud     serves the pre-fix guard (cloud.db): the test must FAIL, which proves it can catch the bug
const path = require('path'), fs = require('fs'), http = require('http');
const root = path.join(__dirname, '..');
const req = (m) => require(path.join(root, 'node_modules', m));
const { chromium } = (() => { try { return require(process.env.PW || path.join(root, 'node_modules', 'playwright-core')); } catch (e) { console.error('playwright-core is not installed (npm install), or set PW to a Playwright path.'); process.exit(2); } })();
const { initializeTestEnvironment } = req('@firebase/rules-unit-testing');
const { doc, setDoc } = req('firebase/firestore');
const P = 'demo-allurus-e2e', AUTH = 'http://' + (process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099');
const [FSH, FSP] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const CONFIG = `window.ALLURUS_FIREBASE = { apiKey: 'fake-api-key', authDomain: '127.0.0.1', projectId: '${P}', appId: 'e2e' };`;
const OLD = !!process.env.OLD;
const srv = http.createServer((q, r) => {
  let f = decodeURIComponent(q.url.split('?')[0]);
  if (f === '/js/firebase-config.js') { r.writeHead(200, { 'Content-Type': 'text/javascript' }); r.end(CONFIG); return; }
  const fbm = f.match(/^\/__fb\/(firebase-[a-z-]+\.js)$/);
  if (fbm) { r.writeHead(200, { 'Content-Type': 'text/javascript' }); r.end(fs.readFileSync(path.join(root, 'node_modules', 'firebase', fbm[1]), 'utf8').replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[0-9.]+\//g, '/__fb/')); return; }
  if (f === '/' || f === '/app') f = '/app.html';
  const p = path.join(root, f); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; }
  let body = fs.readFileSync(p);
  if (f === '/js/cloud.js') body = Buffer.from(String(body).replace(/const SDK = 'https:\/\/www\.gstatic\.com\/firebasejs\/[0-9.]+';/, "const SDK = '/__fb';")
    .replace('catch (e) { db = FS.getFirestore(fb); }', `catch (e) { db = FS.getFirestore(fb); }\nAuth.connectAuthEmulator(auth, '${AUTH}', { disableWarnings: true }); FS.connectFirestoreEmulator(db, '${FSH}', ${FSP});`));
  if (f === '/js/app.js' && OLD) body = Buffer.from(String(body).replace('const unlinked = () => CLOUD &&', 'const unlinked = () => !!cloud.db &&').replace('(CLOUD ? { id: UNLINKED_ID', '(cloud.db ? { id: UNLINKED_ID'));
  r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(body);
}).listen(0);
const base = () => `http://127.0.0.1:${srv.address().port}`;
const results = []; const ok = (n, pass, info = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${info ? '  — ' + info : ''}`); };
const j = async (url, body, headers = {}) => (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })).json();
async function account(email, pw) {
  const u = await j(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, { email, password: pw, returnSecureToken: true });
  await j(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${P}/accounts:update`, { localId: u.localId, emailVerified: true }, { Authorization: 'Bearer owner' });
  return u.localId;
}
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, permissions: ['geolocation'], geolocation: { latitude: 4.2335, longitude: 103.4475 },
  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' };

(async () => {
  const env = await initializeTestEnvironment({ projectId: P, firestore: { host: FSH, port: Number(FSP), rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
  const admin = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const local = (ctx) => ctx.route(() => true, (r) => { const h = new URL(r.request().url()).hostname; return h === '127.0.0.1' || h === 'localhost' ? r.continue() : r.abort(); });

  // The demo company, laid out the way the cloud keeps it (as tests-e2e/ and the device e2e do).
  const dctx = await b.newContext({ viewport: { width: 1366, height: 860 } }); await local(dctx);
  const demo = await dctx.newPage();
  await demo.goto(`${base()}/app.html?demo`); await demo.waitForSelector('[data-act=demo-as]');
  const ws = await demo.evaluate(() => {
    const st = window.AllurusApp.state, M = window.AllurusCloudMap, keys = window.AllurusApp.WS_KEYS;
    const staff = st.employees.filter((e) => e.id !== 'e1' && e.status === 'Active');
    return { buckets: M.bucketsOf(st, keys, () => {}), dir: M.directoryFields(st.employees, () => {}), people: st.employees.map((e, i) => [e.id, M.personFields(e, i, () => {})]), name: st.settings.company,
      staffId: staff[0].id, staffFirst: staff[0].first, firstName: `${st.employees[0].first}`, allNames: st.employees.map((e) => `${e.first} ${e.last}`.trim()), firstId: st.employees[0].id };
  });
  await dctx.close();
  const mk = async (email, name, empId, via) => {
    const uid = await account(email, 'Crew-Pass-2026!');
    await admin((db) => setDoc(doc(db, `users/${uid}`), { tenantId: 'co1', email, name, roles: ['employee'], empId, pending: false, ...(via ? { via } : {}) }));
    return uid;
  };
  const ownUid = await account('owner@co1.test', 'Owner-Pass-2026!');
  await admin(async (db) => {
    await setDoc(doc(db, 'tenants/co1'), { owner: ownUid, name: ws.name, admin: 'owner@co1.test', status: 'active' });
    await setDoc(doc(db, `users/${ownUid}`), { tenantId: 'co1', email: 'owner@co1.test', name: 'Owner', roles: ['admin', 'employee'], empId: ws.firstId });
    for (const [id, x] of Object.entries(ws.buckets)) await setDoc(doc(db, `tenants/co1/buckets/${id}`), { t: x.t, r: x.r, f: x.f });
    await setDoc(doc(db, 'tenants/co1/buckets/directory'), { t: 'a', r: 'm', f: ws.dir });
    for (const [id, f] of ws.people) await setDoc(doc(db, `tenants/co1/people/${id}`), f);
  });
  await mk('linked@co1.test', 'Linked Crew', ws.staffId);
  await mk('empty@co1.test', 'Empty Link', '', 'open');         // a join-page sign-in that nobody has linked yet
  await mk('gone@co1.test', 'Gone Link', 'e-deleted-1');          // linked to a record that no longer exists

  async function signIn(email) {
    const ctx = await b.newContext({ ...PHONE, serviceWorkers: 'block' }); await local(ctx);
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base()}/app.html`); await page.waitForSelector('#login-form', { timeout: 20000 }); await page.waitForTimeout(2500); await page.waitForSelector('#login-form');
    await page.fill('#login-email', email); await page.fill('#login-password', 'Crew-Pass-2026!');
    await page.click('#login-form [type=submit]'); await page.waitForTimeout(6000);
    const state = await page.evaluate(() => ({ text: document.body.innerText, appHidden: !!document.querySelector('.app')?.hidden, me: (() => { try { const m = window.AllurusApp.me(); return { id: m.id, first: m.first, unlinked: !!m.unlinked }; } catch (e) { return { err: String(e) }; } })() }));
    return { ctx, page, errors, ...state };
  }

  for (const [email, label] of [['empty@co1.test', 'a sign-in with no employee link'], ['gone@co1.test', 'a sign-in linked to a record that does not exist']]) {
    const s = await signIn(email);
    const othersSeen = ws.allNames.filter((n) => n && s.text.toLowerCase().includes(n.toLowerCase()));
    ok(`${label}: the "not linked" screen (EN + BM) with Sign out`, /isn.t linked to your staff record/.test(s.text) && /belum dipautkan/i.test(s.text) && /Sign out/.test(s.text), s.text.replace(/\s+/g, ' ').slice(0, 90));
    ok('…the workspace is hidden (no menus, no pages)', s.appHidden);
    ok('…me() is an empty placeholder, not the first employee or anyone else', s.me.id === '__unlinked__' && s.me.unlinked === true && s.me.id !== ws.firstId, JSON.stringify(s.me));
    ok('…no employee name from the company appears on the screen', othersSeen.length === 0, othersSeen.slice(0, 3).join(', '));
    ok('…no page errors', !s.errors.length, s.errors.slice(0, 2).join(' | '));
    await s.ctx.close();
  }
  // Control: a properly linked sign-in is unaffected.
  const ok1 = await signIn('linked@co1.test');
  ok('control: a linked staff sign-in gets its own record (me() is that person) and the app', ok1.me.id === ws.staffId && !ok1.me.unlinked && !ok1.appHidden && !/isn.t linked/.test(ok1.text), JSON.stringify(ok1.me));
  await ok1.ctx.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed${OLD ? ' (OLD guard served: failures here are the point)' : ''}`);
  await b.close().catch(() => {}); srv.close(); await env.cleanup().catch(() => {});
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

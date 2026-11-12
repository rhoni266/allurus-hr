// docs/JOIN-AUTOLINK-SPEC.md, end to end in REAL cloud mode against the Firebase emulators (Auth + Firestore; nothing leaves this machine):
// the real join page, the real app, cloud.js and firestore.rules. HR's app keeps staffLinks in step (the test waits for it); a new sign-up
// links itself and goes straight into the app; every case that must wait for HR does.
//   npm run test:e2e-join        (needs Microsoft Edge or Chrome installed)
const path = require('path'), fs = require('fs'), http = require('http');
const root = path.join(__dirname, '..');
const req = (m) => require(path.join(root, 'node_modules', m));
const { chromium } = (() => { try { return require(process.env.PW || path.join(root, 'node_modules', 'playwright-core')); } catch (e) { console.error('playwright-core is not installed (npm install), or set PW.'); process.exit(2); } })();
const { initializeTestEnvironment } = req('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, updateDoc, collection, Timestamp } = req('firebase/firestore');
const P = 'demo-allurus-e2e', AUTH = 'http://' + (process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099');
const [FSH, FSP] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const CONFIG = `window.ALLURUS_FIREBASE = { apiKey: 'fake-api-key', authDomain: '127.0.0.1', projectId: '${P}', appId: 'e2e' };`;
const srv = http.createServer((q, r) => {
  let f = decodeURIComponent(q.url.split('?')[0]);
  if (f === '/js/firebase-config.js') { r.writeHead(200, { 'Content-Type': 'text/javascript' }); r.end(CONFIG); return; }
  const fbm = f.match(/^\/__fb\/(firebase-[a-z-]+\.js)$/);
  if (fbm) { r.writeHead(200, { 'Content-Type': 'text/javascript' }); r.end(fs.readFileSync(path.join(root, 'node_modules', 'firebase', fbm[1]), 'utf8').replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[0-9.]+\//g, '/__fb/')); return; }
  if (f === '/' || f === '/app') f = '/app.html';
  if (f === '/join') f = '/join.html';
  const p = path.join(root, f); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; }
  let body = fs.readFileSync(p);
  if (f === '/js/cloud.js') body = Buffer.from(String(body).replace(/const SDK = 'https:\/\/www\.gstatic\.com\/firebasejs\/[0-9.]+';/, "const SDK = '/__fb';")
    .replace('catch (e) { db = FS.getFirestore(fb); }', `catch (e) { db = FS.getFirestore(fb); }\nAuth.connectAuthEmulator(auth, '${AUTH}', { disableWarnings: true }); FS.connectFirestoreEmulator(db, '${FSH}', ${FSP});`));
  if (f === '/js/join.js') body = Buffer.from(String(body).replace(/const SDK = 'https:\/\/www\.gstatic\.com\/firebasejs\/[0-9.]+';/, "const SDK = '/__fb';")
    .replace('const auth = Auth.getAuth(fb), db = FS.getFirestore(fb);', `const auth = Auth.getAuth(fb), db = FS.getFirestore(fb);\nAuth.connectAuthEmulator(auth, '${AUTH}', { disableWarnings: true }); FS.connectFirestoreEmulator(db, '${FSH}', ${FSP});`));
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, permissions: ['geolocation'], geolocation: { latitude: 4.2335, longitude: 103.4475 },
  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' };
const IC = { aina: '900101015551', budi: '900202025552', dup: '900303035553', eka: '900404045554', fiq: '900505055555' };

(async () => {
  const env = await initializeTestEnvironment({ projectId: P, firestore: { host: FSH, port: Number(FSP), rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
  const admin = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const local = (ctx) => ctx.route(() => true, (r) => { const h = new URL(r.request().url()).hostname; return h === '127.0.0.1' || h === 'localhost' ? r.continue() : r.abort(); });

  // The demo company, laid out the way the cloud keeps it, with five staff who have an IC and a phone and no email, and the switch on.
  const dctx = await b.newContext({ viewport: { width: 1366, height: 860 } }); await local(dctx);
  const demo = await dctx.newPage();
  await demo.goto(`${base()}/app.html?demo`); await demo.waitForSelector('[data-act=demo-as]');
  const ws = await demo.evaluate((IC) => {
    const st = window.AllurusApp.state, M = window.AllurusCloudMap, keys = window.AllurusApp.WS_KEYS;
    const set = (id, o) => Object.assign(st.employees.find((e) => e.id === id), { status: 'Active', email: '', ...o });
    set('e2', { first: 'Aina', last: 'Rahman', ic: IC.aina, phone: '+60123450001' });
    set('e3', { first: 'Budi', last: 'Santoso', ic: IC.budi, phone: '+60123450002' });
    set('e4', { first: 'Cik', last: 'Dua', ic: IC.dup, phone: '+60123450003' });
    set('e5', { first: 'Dewi', last: 'Dua', ic: IC.dup, phone: '+60123450004' });
    set('e6', { first: 'Eka', last: 'Email', ic: IC.eka, phone: '+60123450005', email: 'eka@co1.test' });
    set('e7', { first: 'Fiq', last: 'Final', ic: IC.fiq, phone: '+60123450006' });
    st.settings.joinAutoLink = true;
    return { buckets: M.bucketsOf(st, keys, () => {}), dir: M.directoryFields(st.employees, () => {}), people: st.employees.map((e, i) => [e.id, M.personFields(e, i, () => {})]), name: st.settings.company, firstId: st.employees[0].id };
  }, IC);
  await dctx.close();
  const ownUid = await account('owner@co1.test', 'Owner-Pass-2026!');
  const ekaUid = await account('eka@co1.test', 'Eka-Pass-2026!');
  await admin(async (db) => {
    await setDoc(doc(db, 'tenants/co1'), { owner: ownUid, name: ws.name, admin: 'owner@co1.test', status: 'active' });
    await setDoc(doc(db, `users/${ownUid}`), { tenantId: 'co1', email: 'owner@co1.test', name: 'Owner', roles: ['admin', 'employee'], empId: ws.firstId });
    await setDoc(doc(db, `users/${ekaUid}`), { tenantId: 'co1', email: 'eka@co1.test', name: 'Eka Email', roles: ['employee'], empId: 'e6' });   // e6 already has a sign-in
    await setDoc(doc(db, 'companyCodes/co1code'), { tenantId: 'co1', company: ws.name, openUntil: Timestamp.fromMillis(Date.now() + 7 * 864e5) });
    for (const [id, x] of Object.entries(ws.buckets)) await setDoc(doc(db, `tenants/co1/buckets/${id}`), { t: x.t, r: x.r, f: x.f });
    await setDoc(doc(db, 'tenants/co1/buckets/directory'), { t: 'a', r: 'm', f: ws.dir });
    for (const [id, f] of ws.people) await setDoc(doc(db, `tenants/co1/people/${id}`), f);
  });

  // HR's app is open: it keeps the sign-up keys and staffLinks in step.
  const octx = await b.newContext({ viewport: { width: 1366, height: 860 }, serviceWorkers: 'block' }); await local(octx);
  const owner = await octx.newPage(), ownErrors = [];
  owner.on('pageerror', (e) => ownErrors.push(String(e.stack || e.message).split(String.fromCharCode(10)).slice(0, 3).join(' <- ')));
  await owner.goto(`${base()}/app.html`); await owner.waitForSelector('#login-form', { timeout: 20000 }); await owner.waitForTimeout(2000);
  await owner.fill('#login-email', 'owner@co1.test'); await owner.fill('#login-password', 'Owner-Pass-2026!'); await owner.click('#login-form [type=submit]');
  await owner.waitForSelector('#nav a, .sidebar a', { timeout: 30000 });
  let links = {};
  for (let i = 0; i < 20; i++) { await sleep(1500); links = await admin(async (db) => Object.fromEntries((await getDocs(collection(db, 'staffLinks'))).docs.map((d) => [d.id.split('~')[1], d.data()]))); if (Object.keys(links).length >= 4) break; }
  ok('HR\'s app writes staffLinks: one per record with a unique IC (and none for the shared IC or the admin)', IC.aina in links && IC.budi in links && IC.eka in links && IC.fiq in links && !(IC.dup in links) && !Object.values(links).some((l) => l.empId === ws.firstId || l.empId === 'e4' || l.empId === 'e5'), `${Object.keys(links).length} documents`);
  ok('…with the record id, no name, the phone ending, and hasSignIn only where a sign-in exists', links[IC.aina]?.empId === 'e2' && links[IC.aina]?.phone4 === '0001' && links[IC.aina]?.hasSignIn === false && links[IC.eka]?.hasSignIn === true && !('name' in (links[IC.aina] || {})), JSON.stringify({ aina: links[IC.aina] && { e: links[IC.aina].empId, p: links[IC.aina].phone4, h: links[IC.aina].hasSignIn }, eka: links[IC.eka] && links[IC.eka].hasSignIn }));
  const keyDoc = await admin((db) => getDoc(doc(db, `staffKeys/co1~${IC.aina}`)));
  ok('…the sign-up key itself still holds no name and no employee id', keyDoc.exists() && !('empId' in keyDoc.data()) && !('name' in keyDoc.data()), JSON.stringify(Object.keys(keyDoc.data() || {})));

  // One walk through the join page. Returns the page after it has moved on.
  async function join(ic, phone, pin, pin2 = pin) {
    const ctx = await b.newContext({ ...PHONE, serviceWorkers: 'block' }); await local(ctx);
    const page = await ctx.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base()}/join?c=co1code`); await page.waitForSelector('#ic-in', { timeout: 20000 });
    await page.fill('#ic-in', ic); await page.click('#go-ic');
    await page.waitForSelector('#phone-in', { timeout: 15000 });
    await page.fill('#phone-in', phone); await page.click('#go-phone');
    await page.waitForSelector('#pin-in', { timeout: 10000 });
    await page.fill('#pin-in', pin); await page.fill('#pin2-in', pin2);
    return { ctx, page, errors };
  }
  const afterSubmit = async (page) => { await page.click('#go-pin'); await page.waitForURL(/\/app/, { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(7000); return page.evaluate(() => ({ text: document.body.innerText, me: (() => { try { const m = window.AllurusApp.me(); return { id: m.id, first: m.first }; } catch (e) { return { err: String(e) }; } })(), login: !!document.querySelector('#login-form') && !document.querySelector('#login')?.hidden })); };
  const userOf = async (ic) => admin(async (db) => { const q = (await getDocs(collection(db, 'users'))).docs.filter((d) => String(d.data().email || '').startsWith(ic + '.')); return q[0] ? { uid: q[0].id, ...q[0].data() } : null; });

  // A. A new IC with its own record: PIN twice, linked, straight into the app.
  let s = await join(IC.aina, '0123450001', '482915', '482916');
  await s.page.click('#go-pin'); await s.page.waitForTimeout(600);
  ok('Two different PINs: "PINs don\'t match", only the confirm box is cleared, and the button is off again', await s.page.evaluate(() => /PIN tidak sama/.test(document.getElementById('err-pin').innerText) && document.getElementById('pin2-in').value === '' && document.getElementById('pin-in').value === '482915' && document.getElementById('go-pin').disabled));
  await s.page.fill('#pin2-in', '482915');
  let r = await afterSubmit(s.page);
  const aina = await userOf(IC.aina);
  ok('New sign-up (unique record): linked to its own record, with the automatic-link stamp', aina?.empId === 'e2' && !!aina?.autoLinkedAt && aina?.name === 'Aina Rahman', JSON.stringify({ empId: aina?.empId, name: aina?.name, stamp: !!aina?.autoLinkedAt }));
  ok('…goes straight into the app as that person (me() is their record), no second sign-in', r.me.id === 'e2' && !/Akaun anda sedang menunggu/.test(r.text) && !r.login, JSON.stringify(r.me));
  ok('…and never sees another person\'s record: the app shows Aina, not the first employee', r.me.first === 'Aina' && r.me.id !== ws.firstId);
  ok('…no page errors', !s.errors.length, s.errors.slice(0, 2).join(' | '));
  const phoneA = s;   // kept open: this is Aina's phone, used again below (the one-phone rule knows it)

  // B. The IC is on two records: HR decides.
  s = await join(IC.dup, '0123450003', '135790'); r = await afterSubmit(s.page);
  const dup = await userOf(IC.dup);
  ok('IC on two records: no link; the waiting screen (BM + EN)', dup && !dup.empId && /Akaun anda sedang menunggu kelulusan HR/.test(r.text) && /Your account is waiting for HR approval/.test(r.text), (r.text || '').replace(/\s+/g, ' ').slice(0, 80));
  ok('…and it shows no one\'s record', r.me.unlinked !== false && r.me.id !== ws.firstId, JSON.stringify(r.me)); await s.ctx.close();

  // C. The record already has an email sign-in.
  s = await join(IC.eka, '0123450005', '246801'); r = await afterSubmit(s.page);
  const eka = await userOf(IC.eka);
  ok('Record already has an email sign-in: no link; waiting screen', eka && !eka.empId && /menunggu kelulusan HR/.test(r.text)); await s.ctx.close();

  // D. The company turns the automatic link off.
  await admin((db) => updateDoc(doc(db, 'tenants/co1/buckets/settings'), { 'f.joinAutoLink': 'false' }));
  s = await join(IC.fiq, '0123450006', '357913'); r = await afterSubmit(s.page);
  const fiq = await userOf(IC.fiq);
  ok('Automatic link switched off: no link; waiting screen', fiq && !fiq.empId && /menunggu kelulusan HR/.test(r.text)); await s.ctx.close();
  await admin((db) => updateDoc(doc(db, 'tenants/co1/buckets/settings'), { 'f.joinAutoLink': 'true' }));

  // E. Wrong phone ending: HR has +…0002 on file for Budi.
  s = await join(IC.budi, '0123459999', '468024'); r = await afterSubmit(s.page);
  const budi = await userOf(IC.budi);
  ok('Phone typed does not end like the phone on file: no link; waiting screen', budi && !budi.empId && /menunggu kelulusan HR/.test(r.text)); await s.ctx.close();

  // F. Existing sign-in: the right PIN goes straight in; a wrong PIN gets a plain message.
  // Same phone as before (Aina's own): the join page never reuses a sign-in, so sign out first, then register again with the same IC.
  s = phoneA;
  await s.page.goto(`${base()}/join?c=co1code`); await s.page.waitForSelector('#so', { timeout: 20000 });
  ok('Joining on a phone that is still signed in: Sign out is offered first (join never reuses a sign-in)', /signed in as Aina/.test(await s.page.evaluate(() => document.body.innerText)));
  await s.page.click('#so'); await s.page.waitForSelector('#ic-in', { timeout: 20000 });
  await s.page.fill('#ic-in', IC.aina); await s.page.click('#go-ic'); await s.page.waitForSelector('#phone-in', { timeout: 15000 });
  await s.page.fill('#phone-in', '0123450001'); await s.page.click('#go-phone'); await s.page.waitForSelector('#pin-in', { timeout: 10000 });
  await s.page.fill('#pin-in', '999999'); await s.page.fill('#pin2-in', '999999');
  await s.page.click('#go-pin'); await s.page.waitForTimeout(4000);
  const wrong = await s.page.evaluate(() => ({ err: document.getElementById('err-pin')?.innerText || '', url: location.pathname }));
  ok('Existing sign-in, wrong PIN: "PIN salah. Lupa PIN? Minta HR tekan Reset sign-in." and stays on the page', /PIN salah\. Lupa PIN\? Minta HR tekan Reset sign-in\./.test(wrong.err) && wrong.url === '/join', wrong.err.slice(0, 70));
  ok('…never "Akaun dengan No. IC ini sudah wujud"', !/sudah wujud/.test(wrong.err));
  await s.page.fill('#pin-in', '482915'); await s.page.fill('#pin2-in', '482915');
  r = await afterSubmit(s.page);
  ok('Existing sign-in, right PIN: straight into the app as the same person', r.me.id === 'e2' && !r.login, JSON.stringify(r.me) + ' · ' + String(r.text || '').split(/\s+/).join(' ').slice(0, 100)); await s.ctx.close();

  // G. HR sees it and can say "This isn't them".
  await owner.evaluate(() => { location.hash = 'settings/users'; }); await owner.waitForTimeout(1500);
  await owner.reload(); await owner.waitForSelector('#nav a, .sidebar a', { timeout: 30000 }); await owner.evaluate(() => { location.hash = 'settings/users'; });
  await owner.waitForSelector('[data-act=acc-auto-no]', { timeout: 30000 }).catch(() => {});
  const hr = await owner.evaluate(() => ({ btn: !!document.querySelector('[data-act=acc-auto-no]'), card: /Linked automatically \(/.test(document.body.innerText), row: /Linked automatically ·/.test(document.body.innerText), act: (window.AllurusApp.state.activity || []).some((a) => /Linked automatically on the join page/.test(a.text || '')), full: /900101015551/.test(document.body.innerText) }));
  ok('HR: "Linked automatically" card with This isn\'t them, the row note, an audit line, and no full IC on screen', hr.btn && hr.card && hr.act && !hr.full, JSON.stringify(hr));
  if (hr.btn) {
    await owner.click('[data-act=acc-auto-no]'); await owner.waitForTimeout(600);
    await owner.click('.modal [type=submit], [role=dialog] [type=submit]'); await owner.waitForTimeout(3500);
  }
  const after = await userOf(IC.aina);
  ok('"This isn\'t them": the link is removed and the sign-in is turned off', after && after.disabled === true && !after.empId, JSON.stringify({ disabled: after?.disabled, empId: after?.empId }));
  const key2 = await admin((db) => getDoc(doc(db, `staffKeys/co1~${IC.aina}`)));
  ok('…and the IC moves to the next sign-in generation, so the real person can register again', key2.exists() && key2.data().gen >= 2, 'gen ' + key2.data()?.gen);
  ok('…no page errors in HR\'s app', !ownErrors.length, ownErrors.slice(0, 2).join(' | '));

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await b.close().catch(() => {}); srv.close(); await env.cleanup().catch(() => {});
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

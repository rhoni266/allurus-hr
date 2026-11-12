// docs/INVENTORY-ON-SPEC.md in REAL cloud mode against the Firebase emulators (Auth + Firestore; nothing leaves this machine): a real company with no
// inventory data switches Inventory on, imports 10 items, moves and counts stock, receives a purchase order, exports CSV, switches it off (pages
// hidden, data kept) and on again; a storekeeper sees stock and nothing of payroll.   npm run test:e2e-inventory
const path = require('path'), fs = require('fs'), http = require('http'), os = require('os');
const root = path.join(__dirname, '..');
const req = (m) => require(path.join(root, 'node_modules', m));
const { chromium } = (() => { try { return require(process.env.PW || path.join(root, 'node_modules', 'playwright-core')); } catch (e) { console.error('playwright-core is not installed (npm install), or set PW.'); process.exit(2); } })();
const { initializeTestEnvironment } = req('@firebase/rules-unit-testing');
const { doc, setDoc, getDocs, collection } = req('firebase/firestore');
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
  const p = path.join(root, f); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; }
  let body = fs.readFileSync(p);
  if (f === '/js/cloud.js') body = Buffer.from(String(body).replace(/const SDK = 'https:\/\/www\.gstatic\.com\/firebasejs\/[0-9.]+';/, "const SDK = '/__fb';")
    .replace('catch (e) { db = FS.getFirestore(fb); }', `catch (e) { db = FS.getFirestore(fb); }\nAuth.connectAuthEmulator(auth, '${AUTH}', { disableWarnings: true }); FS.connectFirestoreEmulator(db, '${FSH}', ${FSP});`));
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
const PW = 'Pass-Word-2026!';

(async () => {
  const env = await initializeTestEnvironment({ projectId: P, firestore: { host: FSH, port: Number(FSP), rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
  const admin = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const local = (ctx) => ctx.route(() => true, (r) => { const h = new URL(r.request().url()).hostname; return h === '127.0.0.1' || h === 'localhost' ? r.continue() : r.abort(); });

  // A real company that has never had inventory: the demo's people and finance, with no stock data at all.
  const dctx = await b.newContext({ viewport: { width: 1366, height: 860 } }); await local(dctx);
  const demo = await dctx.newPage();
  await demo.goto(`${base()}/app.html?demo`); await demo.waitForSelector('[data-act=demo-as]');
  const ws = await demo.evaluate(() => {
    const st = window.AllurusApp.state, M = window.AllurusCloudMap, keys = window.AllurusApp.WS_KEYS;
    delete st.ops; if (st.settings.modules) delete st.settings.modules;
    const act = st.employees.filter((e) => e.status === 'Active' && e.id !== 'e1');
    return { buckets: M.bucketsOf(st, keys, () => {}), dir: M.directoryFields(st.employees, () => {}), people: st.employees.map((e, i) => [e.id, M.personFields(e, i, () => {})]), name: st.settings.company, firstId: st.employees[0].id, storeId: act[0].id, plainId: act[1].id, storeFirst: act[0].first, nBuckets: Object.keys(M.bucketsOf(st, keys, () => {})).filter((k) => k.startsWith('ops')).length };
  });
  await dctx.close();
  ok('Setup: the company has no inventory data (no ops.* buckets)', ws.nBuckets === 0);
  const ownUid = await account('owner@co1.test', PW), storeUid = await account('store@co1.test', PW), plainUid = await account('plain@co1.test', PW);
  await admin(async (db) => {
    await setDoc(doc(db, 'tenants/co1'), { owner: ownUid, name: ws.name, admin: 'owner@co1.test', status: 'active' });
    await setDoc(doc(db, `users/${ownUid}`), { tenantId: 'co1', email: 'owner@co1.test', name: 'Owner', roles: ['admin', 'employee'], empId: ws.firstId });
    await setDoc(doc(db, `users/${storeUid}`), { tenantId: 'co1', email: 'store@co1.test', name: 'Storekeeper', roles: ['admin', 'employee'], perms: ['operations'], empId: ws.storeId });
    await setDoc(doc(db, `users/${plainUid}`), { tenantId: 'co1', email: 'plain@co1.test', name: 'Plain', roles: ['employee'], empId: ws.plainId });
    for (const [id, x] of Object.entries(ws.buckets)) await setDoc(doc(db, `tenants/co1/buckets/${id}`), { t: x.t, r: x.r, f: x.f });
    await setDoc(doc(db, 'tenants/co1/buckets/directory'), { t: 'a', r: 'm', f: ws.dir });
    for (const [id, f] of ws.people) await setDoc(doc(db, `tenants/co1/people/${id}`), f);
  });

  async function signIn(email, device = { viewport: { width: 1366, height: 860 } }) {
    const ctx = await b.newContext({ ...device, serviceWorkers: 'block', acceptDownloads: true }); await local(ctx);
    const page = await ctx.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base()}/app.html`); await page.waitForSelector('#login-form', { timeout: 20000 }); await page.waitForTimeout(2000);
    await page.fill('#login-email', email); await page.fill('#login-password', PW); await page.click('#login-form [type=submit]');
    await page.waitForSelector('#nav a, .sidebar a', { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(2500);
    return { ctx, page, errors };
  }
  const navText = (p) => p.evaluate(() => [...document.querySelectorAll('#nav a, .sidebar a')].map((a) => a.textContent.trim()).join('|'));
  const go = async (p, h) => { await p.evaluate(() => { location.hash = 'dashboard'; }); await p.waitForTimeout(200); await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(1200); };
  const bucketFields = async (name) => admin(async (db) => { const s = (await getDocs(collection(db, 'tenants/co1/buckets'))).docs.find((d) => d.id === name); return s ? Object.keys(s.data().f || {}).filter((k) => !k.startsWith('~')) : null; });
  const items = (p) => p.evaluate(() => (window.AllurusApp.state.ops?.items || []).length);

  // ---- 1. switch on ----
  const o = await signIn('owner@co1.test'), p = o.page;
  ok('Before: no Stock & purchasing in the sidebar', !/Stock/.test(await navText(p)), (await navText(p)).slice(0, 80));
  await go(p, 'settings/modules');
  const mod = await p.evaluate(() => document.body.innerText);
  ok('Settings → Modules: Inventory (Stock & purchasing) On/Off, with the others marked "Coming later"', /Inventory \(Stock & purchasing\)/.test(mod) && (mod.match(/Coming later/g) || []).length === 3);
  await p.click('[data-act=mod-inventory][data-v=on]'); await p.waitForTimeout(1500);
  ok('Turned on: "Stock & purchasing" appears in the sidebar', /Stock/.test(await navText(p)), (await navText(p)).slice(0, 120));
  await go(p, 'ops-stock');
  const empty = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('…the stock page starts empty with "Import items" and "Add item"', /No items yet/.test(empty) && !!(await p.$('[data-act=ops-import]')) && !!(await p.$('[data-act=ops-item-new]')));
  let saved = null; for (let i = 0; i < 10 && !saved; i++) { await sleep(1000); saved = await admin(async (db) => { const s = (await getDocs(collection(db, 'tenants/co1/buckets'))).docs.find((d) => d.id === 'settings'); return s && (s.data().f || {}).modules; }); }
  ok('…the switch is saved with the company settings (so it survives a reload)', /"inventory":true/.test(saved || ''), String(saved));

  // ---- 2. import 10 items ----
  const csv = [
    'Code,Name,Unit,Category,Location,Opening quantity,Reorder level,Cost price,Selling price,Supplier',
    'HW-001,"""Cement 50kg bag""",bag,Building,Rack A1,120,40,18.50,24,Ah Seng Hardware',
    'HW-002,Steel nails 3 inch,pack,Fasteners,Rack B2,60,20,6.2,9.5,Ah Seng Hardware',
    'HW-003,Paint 5L white,tin,Paint,Rack C1,30,10,45,69,Warna Trading',
    'HW-004,Paint brush 4 inch,pcs,Paint,Rack C2,80,25,3.5,6,Warna Trading',
    'HW-005,Sand 1 tonne,load,Building,Yard,12,4,90,130,',
    'HW-006,Door hinge,pair,Fittings,Rack D1,200,50,2.2,4.5,',
    'HW-007,Floor tile 60x60,box,Tiles,Rack E1,45,15,38,58,Jubin Seramik',
    'HW-008,Wire 2.5mm roll,roll,Electrical,Rack F1,18,6,120,165,',
    'HW-009,Safety helmet,pcs,Safety,Rack G1,25,10,12,19,',
    'HW-010,Gloves pair,pair,Safety,Rack G2,90,30,2.8,5,',
    'HW-001,Cement again,bag,,,1,1,1,1,',                 // a duplicate: skipped
    'HW-011,Bad quantity,pcs,,,lots,1,1,1,',                // a bad number: reported
  ].join('\n');
  const file = path.join(os.tmpdir(), 'inv-items-e2e.csv'); fs.writeFileSync(file, csv);
  await p.click('[data-act=ops-import]'); await p.waitForSelector('#inv-file', { state: 'attached' });
  await p.setInputFiles('#inv-file', file); await p.waitForSelector('[data-act=ops-import-go]', { timeout: 20000 });
  const prev = await p.evaluate(() => document.getElementById('inv-preview').innerText.replace(/\s+/g, ' '));
  ok('Import preview: 10 ready, 1 skipped (duplicate code), 1 with a problem (row 13), the quoted name cleaned', /10 items? ready to import/.test(prev) && /1 skipped/.test(prev) && /1 with a problem/.test(prev) && /Row 13/.test(prev) && /Opening quantity “lots” isn’t a number/.test(prev) && /Cement 50kg bag/.test(prev) && !/"Cement/.test(prev), prev.slice(0, 160));
  await p.click('[data-act=ops-import-go]'); await p.waitForTimeout(1500);
  ok('Imported: 10 items in the stock list, with the stock value in the header', (await items(p)) === 10 && /stock worth RM\s?[\d,]+ at cost/.test(await p.evaluate(() => document.querySelector('#view').innerText)));
  let got = null; for (let i = 0; i < 15; i++) { await sleep(1000); const f = await bucketFields('ops.items'), m = await bucketFields('ops.moves'); if (f && f.length >= 10 && m && m.length >= 10) { got = { items: f.length, moves: m.length }; break; } }
  ok('…saved to the cloud: 10 items and 10 "Opening stock" movements in the ops.* buckets', !!got, JSON.stringify(got));
  const sup = await p.evaluate(() => window.AllurusApp.state.finance.contacts.filter((c) => ['Ah Seng Hardware', 'Warna Trading', 'Jubin Seramik'].includes(c.name) && c.kind === 'supplier').length);
  ok('…the three suppliers named in the file are in Finance', sup >= 3, String(sup));

  // ---- 3. stock in / out ----
  const cement = await p.evaluate(() => window.AllurusApp.state.ops.items.find((i) => i.code === 'HW-001').id);
  await p.click(`[data-inv-row][data-act=ops-item][data-id="${cement}"]`); await p.waitForTimeout(500);
  await p.click('.modal [data-act=ops-move][data-v=out], [role=dialog] [data-act=ops-move][data-v=out]'); await p.waitForSelector('#mv-q');
  await p.fill('#mv-q', '25'); await p.selectOption('#mv-k', 'Sold'); await p.fill('#mv-n', 'Counter sale'); await p.click('.modal [type=submit], [role=dialog] [type=submit]'); await p.waitForTimeout(700);
  await p.click(`[data-inv-row][data-act=ops-item][data-id="${cement}"]`); await p.waitForTimeout(400);
  await p.click('.modal [data-act=ops-move][data-v=in], [role=dialog] [data-act=ops-move][data-v=in]'); await p.waitForSelector('#mv-q');
  await p.fill('#mv-q', '10'); await p.selectOption('#mv-k', 'Returned'); await p.click('.modal [type=submit], [role=dialog] [type=submit]'); await p.waitForTimeout(700);
  const st1 = await p.evaluate((id) => { const s = window.AllurusApp.state.ops, ms = s.moves.filter((m) => m.itemId === id); return { onHand: s.items.find((i) => i.id === id).opening + ms.reduce((a, m) => a + m.qty, 0), moves: ms.map((m) => [m.kind, m.qty, !!m.by, !!m.at]) }; }, cement);
  ok('Stock out 25 (Sold) and in 10 (Returned): on hand 120 − 25 + 10 = 105, every change a movement with who and when', st1.onHand === 105 && JSON.stringify(st1.moves) === JSON.stringify([['Opening stock', 120, true, true], ['Sold', -25, true, true], ['Returned', 10, true, true]]), JSON.stringify(st1));
  await p.click(`[data-inv-row][data-act=ops-item][data-id="${cement}"]`); await p.waitForTimeout(400);
  const hist = await p.evaluate(() => (document.querySelector('.inv-history')?.innerText || '').replace(/\s+/g, ' '));
  ok('Item history lists them newest first with the running balance and the opening stock', /Returned/.test(hist) && /Sold/.test(hist) && /Counter sale/.test(hist) && /105/.test(hist) && /Opening stock.*\+120\s+120/.test(hist), hist.slice(0, 160));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // ---- 4. a count with differences ----
  await p.click('[data-act=ops-count]'); await p.waitForSelector('[data-count]');
  const ids = await p.evaluate(() => window.AllurusApp.state.ops.items.filter((i) => ['HW-002', 'HW-003', 'HW-004'].includes(i.code)).map((i) => [i.code, i.id]));
  const idOf = Object.fromEntries(ids);
  await p.fill(`[data-count="${idOf['HW-002']}"]`, '58'); await p.fill(`[data-count="${idOf['HW-003']}"]`, '31'); await p.fill(`[data-count="${idOf['HW-004']}"]`, '80');
  await p.click('.modal [type=submit], [role=dialog] [type=submit]'); await p.waitForTimeout(900);
  const rev = await p.evaluate(() => (document.querySelector('.modal, [role=dialog]')?.innerText || '').replace(/\s+/g, ' '));
  ok('Stock count: 3 counted, 2 differences (−2 and +1); the one that agrees is not listed', /3 items? counted/.test(rev) && /2 with a difference/.test(rev) && /-2/.test(rev) && /\+1/.test(rev) && !/Paint brush/.test(rev.split('Difference')[1] || ''), rev.slice(0, 170));
  await p.click('.modal [type=submit], [role=dialog] [type=submit]'); await p.waitForTimeout(900);
  const cm = await p.evaluate(() => window.AllurusApp.state.ops.moves.filter((m) => m.kind === 'Count correction').map((m) => m.qty).sort((a, b) => a - b));
  ok('…posted as two "Count correction" movements (−2 and +1)', JSON.stringify(cm) === JSON.stringify([-2, 1]), JSON.stringify(cm));

  // ---- 5. a purchase order received ----
  await go(p, 'ops-stock');
  await p.click('[data-act=ops-po-new]'); await p.waitForSelector('#po-lines');
  const nails = idOf['HW-002'];
  await p.selectOption('#po-lines [data-f=itemId]', nails); await p.fill('#po-lines [data-f=qty]', '50'); await p.fill('#po-lines [data-f=price]', '6');
  await p.click('.modal [type=submit], [role=dialog] [type=submit]'); await p.waitForTimeout(900);
  await p.click('[data-act=ops-po-approve]'); await p.waitForTimeout(800);
  await p.click('[data-act=ops-po-send]'); await p.waitForTimeout(800);
  await p.click('[data-act=ops-po-receive]'); await p.waitForSelector('[name=q0]');
  await p.fill('[name=q0]', '50'); await p.click('.modal [type=submit], [role=dialog] [type=submit]'); await p.waitForTimeout(1200);
  const po = await p.evaluate((id) => { const s = window.AllurusApp.state.ops; const it = s.items.find((i) => i.id === id); const onHand = it.opening + s.moves.filter((m) => m.itemId === id).reduce((a, m) => a + m.qty, 0); return { status: s.pos[0].status, onHand, recv: s.moves.some((m) => m.itemId === id && m.ref === s.pos[0].no && m.qty === 50) }; }, nails);
  ok('A purchase order raised, approved, sent and received: stock goes up by 50 (60 − 2 counted + 50 = 108) and the PO is Billed', po.onHand === 108 && po.recv && po.status === 'Billed', JSON.stringify(po));

  const uc = await p.evaluate(() => { const s = window.AllurusApp.state.ops, by = Object.fromEntries(s.items.map((i) => [i.id, i])); const add = s.moves.filter((m) => m.qty > 0); return { missing: add.filter((m) => m.unitCost == null && m.kind !== 'Count correction').length, opening: s.moves.filter((m) => m.kind === 'Opening stock').every((m) => m.unitCost > 0) && s.moves.find((m) => m.kind === 'Opening stock' && by[m.itemId].code === 'HW-001').unitCost === 18.5, returned: s.moves.find((m) => m.kind === 'Returned')?.unitCost, received: s.moves.find((m) => m.kind === 'Received')?.unitCost, out: s.moves.filter((m) => m.qty < 0).every((m) => !('unitCost' in m)) }; });
  ok('Unit cost is saved on stock added: opening stock from the item cost, a manual stock-in from the default (18.50), the PO line price (6.00); none on stock out', uc.missing === 0 && uc.opening && uc.returned === 18.5 && uc.received === 6 && uc.out, JSON.stringify(uc));

  // ---- 6. CSV export ----
  await p.click('[data-act=ops-reports]'); await p.waitForTimeout(400);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('[data-act=ops-report][data-v=stock]')]);
  const csvOut = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  ok('CSV: stock on hand and value: a header and 10 items, with the new quantities', csvOut.length === 11 && /^"?Code"?,"?Name"?/.test(csvOut[0]) && csvOut.some((l) => /HW-001/.test(l) && /105/.test(l)) && csvOut.some((l) => /HW-002/.test(l) && /108/.test(l)), `${csvOut.length} lines · ${dl.suggestedFilename()}`);
  const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('[data-act=ops-report][data-v=moves]')]);
  const mcsv = fs.readFileSync(await dl2.path(), 'utf8').split(String.fromCharCode(10)).map((l) => l.replace(String.fromCharCode(13), '')).filter(Boolean);
  ok('CSV: stock movements have a "Unit cost" column, filled for stock added (18.50 for the cement opening stock) and blank for stock out', /Unit cost/.test(mcsv[0]) && mcsv.some((l) => /HW-001/.test(l) && /Opening stock/.test(l) && /18\.50/.test(l)) && mcsv.some((l) => /"Sold"/.test(l) && !/18\.50/.test(l)), mcsv[0]);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  await go(p, 'ops-today');
  ok('"Operations today" opens for an inventory-only company (low stock, nothing about production)', (await p.evaluate(() => document.querySelector('#view h1')?.innerText || '')).length > 0 && !o.errors.length, o.errors.slice(0, 1).join(''));

  // ---- 7. reload: the data came back from the cloud ----
  await sleep(2500); await p.reload(); await p.waitForSelector('#nav a, .sidebar a', { timeout: 30000 }); await p.waitForTimeout(3500);
  await go(p, 'ops-stock');
  ok('After a reload the stock is still there (read back from the cloud): 10 items, cement 105', (await items(p)) === 10 && (await p.evaluate(() => { const s = window.AllurusApp.state.ops; const it = s.items.find((i) => i.code === 'HW-001'); return it.opening + s.moves.filter((m) => m.itemId === it.id).reduce((a, m) => a + m.qty, 0); })) === 105);

  // ---- 8. switch off hides the pages and keeps the data; on again brings them back ----
  await go(p, 'settings/modules');
  await p.click('[data-act=mod-inventory][data-v=off]'); await p.waitForTimeout(1500);
  ok('Switched off: "Stock & purchasing" is gone from the sidebar', !/Stock/.test(await navText(p)), (await navText(p)).slice(0, 100));
  await go(p, 'ops-stock');
  ok('…and the stock page does not open', !/Stock &amp; purchasing|Stock & purchasing/.test(await p.evaluate(() => document.querySelector('#view h1')?.innerText || '')));
  await sleep(2500);
  const kept = await bucketFields('ops.items');
  ok('…but nothing was deleted: the 10 items are still in the cloud', kept && kept.length === 10, String(kept && kept.length));
  await go(p, 'settings/modules'); await p.click('[data-act=mod-inventory][data-v=on]'); await p.waitForTimeout(1200); await go(p, 'ops-stock');
  ok('Switched on again: all 10 items are back', (await items(p)) === 10 && /Stock/.test(await navText(p)));
  ok('…no page errors for the owner', !o.errors.length, o.errors.slice(0, 2).join(' | '));
  await sleep(2000);

  // ---- 9. the storekeeper and a plain employee ----
  const s = await signIn('store@co1.test');
  const sn = await navText(s.page);
  ok('Storekeeper (Operations area only): sees Stock & purchasing', /Stock/.test(sn), sn.slice(0, 120));
  ok('…and nothing of payroll, employees, finance or invoices in the menu', !/Payroll|Employees|Books|Invoices|Bills/.test(sn), sn.slice(0, 160));
  await go(s.page, 'settings');
  ok('…and the company sections of Settings (check-in, payroll, modules) are not shown to them', !/Check-in & attendance|Salaries are entered as|Modules/.test(await s.page.evaluate(() => document.querySelector('#view').innerText)));
  await go(s.page, 'ops-stock');
  const sv = await s.page.evaluate(() => ({ n: window.AllurusApp.state.ops?.items?.length || 0, add: !!document.querySelector('[data-act=ops-item-new]') }));
  ok('…can open the stock list (10 items) and manage it', sv.n === 10 && sv.add, JSON.stringify(sv));
  await go(s.page, 'payroll');
  ok('…and cannot open payroll', !/Payroll/.test(await s.page.evaluate(() => document.querySelector('#view h1')?.innerText || '')));
  const pl = await signIn('plain@co1.test');
  ok('A plain employee sees nothing of inventory', !/Stock/.test(await navText(pl.page)) && !(await pl.page.evaluate(() => !!window.AllurusApp.state.ops?.items?.length)));
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await b.close().catch(() => {}); srv.close(); await env.cleanup().catch(() => {});
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

// One-tap selfie check-in: the rules (js/onetap-rules.js) and the places in the app that must never fail silently.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const load = (f, name) => { const sb = { window: {} }; sb.window = sb; vm.createContext(sb); vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sb); return sb[name]; };
const OT = load('js/onetap-rules.js', 'AllurusOneTap');
const CR = load('js/checkin-rules.js', 'AllurusCheckinRules');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const box = (x = 100, y = 100, w = 200, h = 240) => ({ x, y, width: w, height: h });

test('an auto punch happens when the place and a steady face are both OK', () => {
  const tr = OT.steadyTracker();
  assert.equal(tr.look(0, box()), 0);
  let s = tr.look(300, box(102, 101)); assert.equal(s, 300);
  assert.deepEqual({ ...OT.decide({ loc: 'ok', camera: 'ok', steadyMs: s, cameraAt: 0, now: 300 }) }, { action: 'wait', status: 'face-ok' }, 'not yet: 0.3 s');
  s = tr.look(750, box(101, 100)); assert.equal(s, 750);
  assert.deepEqual({ ...OT.decide({ loc: 'ok', camera: 'ok', steadyMs: s, cameraAt: 0, now: 750 }) }, { action: 'punch', status: 'face-ok' });
});
test('the face has to be steady: a face that jumps about starts the 0.7 s again; losing it resets', () => {
  const tr = OT.steadyTracker();
  tr.look(0, box()); tr.look(400, box());
  assert.equal(tr.look(800, box(400, 100)), 0, 'jumped far: counting starts again');
  assert.equal(tr.look(1000, box(402, 100)), 200);
  assert.equal(tr.look(1100, null), 0, 'no single face');
  assert.equal(tr.look(1200, box()), 0);
});
test('no punch while the place is not OK, however steady the face is', () => {
  for (const loc of ['pending', 'outside', 'denied', 'error']) assert.notEqual(OT.decide({ loc, camera: 'ok', steadyMs: 5000, cameraAt: 0, now: 5000 }).action, 'punch', loc);
  assert.deepEqual({ ...OT.decide({ loc: 'outside', camera: 'ok', steadyMs: 5000, cameraAt: 0, now: 5000 }) }, { action: 'blocked', status: 'outside' }, 'outside the geofence is a stop with a message, never a punch');
  assert.equal(OT.decide({ loc: 'denied', camera: 'pending' }).status, 'loc-denied');
  assert.equal(OT.decide({ loc: 'ok', camera: 'denied' }).status, 'cam-denied');
  assert.equal(OT.decide({ loc: 'pending', camera: 'ok', steadyMs: 5000, cameraAt: 0, now: 5000 }).status, 'locating', 'the face waits for the place');
});
test('the manual photo button appears after 8 s without a steady face, and only once the place is OK', () => {
  assert.equal(OT.NO_FACE_MS, 8000);
  assert.equal(OT.decide({ loc: 'ok', camera: 'ok', steadyMs: 0, cameraAt: 1000, now: 8999 }).action, 'wait');
  assert.deepEqual({ ...OT.decide({ loc: 'ok', camera: 'ok', steadyMs: 0, cameraAt: 1000, now: 9000 }) }, { action: 'manual', status: 'no-face' });
  assert.equal(OT.decide({ loc: 'pending', camera: 'ok', steadyMs: 0, cameraAt: 1000, now: 20000 }).action, 'wait', 'no manual photo before the place is known');
  assert.equal(OT.decide({ loc: 'ok', camera: 'ok', steadyMs: 800, cameraAt: 1000, now: 20000 }).action, 'punch', 'a face that shows up late still punches by itself');
});
test('a double tap saves one punch; the same type again inside a minute is refused', () => {
  const g = OT.guard();
  assert.equal(g.tryStart('in', 1000).ok, true);
  assert.deepEqual({ ...g.tryStart('in', 1050) }, { ok: false, why: 'busy' }, 'extra taps while a punch is being made');
  g.saved('in', 1200);
  assert.deepEqual({ ...g.tryStart('in', 30000) }, { ok: false, why: 'again' }, 'the same type inside 1 minute');
  assert.equal(g.tryStart('out', 30000).ok, true, 'the other type is fine');
  g.saved('out', 31000);
  assert.equal(g.tryStart('in', 1200 + OT.DOUBLE_MS).ok, true, 'a minute later is fine');
  const f = OT.guard(); f.tryStart('in', 0); f.failed(); assert.equal(f.tryStart('in', 10).ok, true, 'a failed punch can be tried again at once');
});
test('in or out follows the day’s record across several sessions', () => {
  assert.equal(OT.nextKind(undefined), 'in');
  assert.equal(OT.nextKind({ s: 'present', in: '08:00', out: '' }), 'out');
  assert.equal(OT.nextKind({ s: 'present', in: '08:00', out: '10:00' }), 'in', 'back after stepping out');
  assert.equal(OT.nextKind({ s: 'present', in: '08:00', out: '', lastIn: '10:30', history: [{ in: '08:00', out: '10:00' }] }), 'out');
  assert.equal(OT.nextKind({ s: 'present', in: '08:00', out: '12:00', lastIn: '10:30', history: [{ in: '08:00', out: '10:00' }] }), 'in', 'a third session');
  assert.equal(OT.nextKind({ s: 'leave', in: '' }), 'in');
});
test('the offline queue keeps the original time and syncs later, in order', async () => {
  let q = [];
  q = CR.enqueue(q, { id: 'd|e1|08:02|self|', payload: { time: '08:02', capturedAt: '2026-11-19T00:02:11.000Z' }, offline: true, capturedAt: '2026-11-19T00:02:11.000Z' });
  q = CR.enqueue(q, { id: 'd|e1|08:02|self|12:00', payload: { time: '08:02', out: '12:00', capturedAt: '2026-11-19T04:00:09.000Z' }, offline: true, capturedAt: '2026-11-19T04:00:09.000Z' });
  assert.equal(q.length, 2, 'the check-out is its own entry, not mistaken for the check-in still waiting');
  const sent = [];
  const off = await CR.syncOutbox(q, async (x) => { sent.push(x); return true; }, { online: false });
  assert.equal(off.sent.length, 0); assert.equal(off.box.length, 2, 'offline: nothing is sent and nothing is lost');
  const on = await CR.syncOutbox(off.box, async (x) => { sent.push(x); return true; }, { online: true });
  assert.deepEqual(sent.map((x) => x.payload.capturedAt), ['2026-11-19T00:02:11.000Z', '2026-11-19T04:00:09.000Z'], 'the time they were taken, in the order they were taken');
  assert.equal(on.box.length, 0);
  const kiosk = src('js/kiosk.js');
  assert.ok(kiosk.includes("cloudWrite('checkins', { ...x.payload, mode: x.payload.mode, time: x.payload.capturedAt })"), 'what reaches the server carries the captured time');
  assert.ok(kiosk.includes("const id = `${day}|${e.id}|${rec.lastIn || rec.in}|${via}|${rec.out || ''}`"));
});
test('the app: one tap, no confirm step, the punch time is the photo time, a tick only once saved', () => {
  const app = src('js/app.js');
  const rv = app.indexOf('function ciReview()');
  assert.ok(app.slice(rv, rv + 200).includes('if (ci.auto) { ciAutoSave(); return; }'), 'after the photo (and the face check) it saves by itself');
  assert.ok(app.includes("'check-out': () => checkIn('present')"), 'check-out is the same one tap flow');
  assert.ok(app.includes('const kind = AllurusOneTap.nextKind(myRecord(wd))'), 'in or out comes from the record');
  assert.ok(app.includes("if ($('#ci-body')) return;"), 'a tap while a check-in is open does nothing');
  const g = app.slice(app.indexOf('function otGrab()'), app.indexOf('async function ciOneTap()'));
  assert.ok(g.includes('ci.takenAt = nowHM()'));
  assert.ok(app.includes('time = ci.takenAt || nowHM()'), 'the saved time is when the photo was taken');
  const save = app.slice(app.indexOf('async function ciAutoSave()'), app.indexOf('function otDone('));
  assert.ok(save.indexOf('fire().settle(8000)') < save.indexOf('otDone(offline)'), 'the tick comes after the server has the punch');
  assert.ok(save.includes('if (!res.ok) { otGuard.failed(); otSaveFailed(res.reason); return; }'), 'a failed save is an error screen, not a tick');
  assert.ok(app.includes('const gd = otGuard.tryStart(kind, Date.now())'), 'double punch guard');
  const loc = app.slice(app.indexOf('async function ciOneTap()'), app.indexOf('// Saves the punch the moment'));
  assert.match(loc, /otLocate\(\)\.then[\s\S]*otCamera\(\)\.then/, 'location and camera are started together, neither awaiting the other');
});
test('every failure on the one-tap screen says something, in BM and EN', () => {
  const app = src('js/app.js');
  const o = app.slice(app.indexOf('const OT = {'), app.indexOf('const OTt = '));
  for (const k of ['locating', 'locOk', 'faceWait', 'faceOk', 'noFace', 'takePhoto', 'retry', 'outside', 'locDenied', 'locDeniedHow', 'camDenied', 'camDeniedHow', 'offline', 'waiting', 'failed', 'doneIn', 'doneOut'])
    assert.equal((o.match(new RegExp(`\\b${k}:`, 'g')) || []).length, 2, `${k} in both languages`);
  assert.ok(o.includes("locating: 'Mengesan lokasi…', locOk: 'Lokasi OK', faceWait: 'Hadapkan muka ke kamera', faceOk: 'Muka dikesan'"));
  assert.ok(o.includes("noFace: 'Muka tidak dikesan'") && o.includes("takePhoto: 'Ambil gambar'") && o.includes("retry: 'Cuba lagi'"));
  assert.ok(o.includes('outside: (m, l) => `Anda di luar kawasan (${m} dari ${l})`'));
  assert.ok(o.includes("offline: 'Tiada internet. Punch disimpan dan akan dihantar bila online.'"));
  const block = app.slice(app.indexOf('async function ciOneTap()'), app.indexOf('function otDone('));
  for (const st of ['outside', 'loc-denied', 'loc-error', 'cam-denied']) assert.ok(block.includes(`'${st}'`), `${st} has a screen`);
});
test('the face detector for one-tap is the existing js/face.js, small detector only', () => {
  const face = src('js/face.js');
  assert.ok(face.includes('function loadDetector()') && face.includes('nets.tinyFaceDetector.loadFromUri(BASE); return fa;') && face.includes('async function live(video'));
  assert.match(src('app.html'), /js\/onetap-rules\.js\?v=/);
});
test('cloud.settle tells the phone whether the server took the attendance write', () => {
  const c = src('js/cloud.js');
  assert.ok(c.includes('async settle(ms = 8000)') && c.includes("S.pushErr = e.code || 'failed'"));
  assert.ok(c.includes("reason: S.pushErr === 'permission-denied' ? 'denied' : 'offline'"));
});

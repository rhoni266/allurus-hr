// Unit tests for the check-in rules: fake-GPS heuristics, kiosk face matching and the offline outbox.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'checkin-rules.js'), 'utf8'), sandbox);
const C = sandbox.window.AllurusCheckinRules;
const codes = (flags) => flags.map((f) => f.code).join(',');

// A normal fix at the Kemaman office, Malaysia (UTC+8).
const T0 = Date.parse('2026-10-19T08:55:00+08:00');
const good = { lat: 4.238217, lng: 103.419441, accuracy: 14, t: T0 };
const MY = 480;

test('a normal fix raises no flags', () => {
  assert.equal(C.gpsFlags({ fix: good, tzOffsetMin: MY, day: '2026-10-19' }).length, 0);
  assert.equal(C.gpsFlags({ fix: { ...good, accuracy: 4.7 }, tzOffsetMin: MY }).length, 0);
});

test('impossible speed since the last fix', () => {
  // Kuala Lumpur 20 minutes ago → Kemaman now: about 235 km in 20 min.
  const last = { lat: 3.139003, lng: 101.686855, t: T0 - 20 * 60000 };
  const f = C.gpsFlags({ fix: good, last, tzOffsetMin: MY });
  assert.equal(codes(f), 'speed');
  assert.match(f[0].reason, /km\/h/);
  // The same trip over 4 hours is a normal drive.
  assert.equal(C.gpsFlags({ fix: good, last: { ...last, t: T0 - 4 * 3600000 }, tzOffsetMin: MY }).length, 0);
  // GPS drift of a few hundred metres in a minute is ignored.
  assert.equal(C.gpsFlags({ fix: good, last: { lat: 4.236, lng: 103.4194, t: T0 - 60000 }, tzOffsetMin: MY }).length, 0);
  // A last fix from the future is ignored.
  assert.equal(C.gpsFlags({ fix: good, last: { ...last, t: T0 + 1000 }, tzOffsetMin: MY }).length, 0);
});

test('accuracy of exactly 0, or suspiciously small and round', () => {
  assert.equal(codes(C.gpsFlags({ fix: { ...good, accuracy: 0 }, tzOffsetMin: MY })), 'accuracy-zero');
  assert.equal(codes(C.gpsFlags({ fix: { ...good, accuracy: 1 }, tzOffsetMin: MY })), 'accuracy-round');
  assert.equal(codes(C.gpsFlags({ fix: { ...good, accuracy: 3 }, tzOffsetMin: MY })), 'accuracy-round');
  assert.equal(C.gpsFlags({ fix: { ...good, accuracy: 3.2 }, tzOffsetMin: MY }).length, 0);
  assert.equal(C.gpsFlags({ fix: { ...good, accuracy: 35 }, tzOffsetMin: MY }).length, 0);
});

test('round coordinates look typed in', () => {
  assert.equal(codes(C.gpsFlags({ fix: { ...good, lat: 4.2382, lng: 103.4194 }, tzOffsetMin: MY })), 'round-coords');
  // One coordinate happening to end in zeros is normal.
  assert.equal(C.gpsFlags({ fix: { ...good, lat: 4.2382 }, tzOffsetMin: MY }).length, 0);
  assert.equal(C.decimals(103.419441), 6);
  assert.equal(C.decimals(4), 0);
});

test('identical coordinates repeated on another day', () => {
  const history = [{ day: '2026-10-12', lat: 4.238217, lng: 103.419441 }, { day: '2026-10-15', lat: 4.238301, lng: 103.419502 }];
  const f = C.gpsFlags({ fix: good, history, day: '2026-10-19', tzOffsetMin: MY });
  assert.equal(codes(f), 'repeat');
  assert.match(f[0].reason, /2026-10-12/);
  // The same day (checking in again after lunch) doesn't count.
  assert.equal(C.gpsFlags({ fix: good, history: [{ day: '2026-10-19', lat: good.lat, lng: good.lng }], day: '2026-10-19', tzOffsetMin: MY }).length, 0);
});

test('device time zone far from the position', () => {
  // A phone set to London time (UTC+1) reporting a fix in Terengganu.
  const f = C.gpsFlags({ fix: good, tzOffsetMin: 60 });
  assert.equal(codes(f), 'timezone');
  // Malaysia's UTC+8 is about an hour ahead of its longitude; that's fine.
  assert.equal(C.gpsFlags({ fix: good, tzOffsetMin: 480 }).length, 0);
  assert.equal(C.gpsFlags({ fix: { ...good, lat: 1.352083, lng: 103.819836 }, tzOffsetMin: 480 }).length, 0);
  // Unknown device offset: not checked.
  assert.equal(C.gpsFlags({ fix: good }).length, 0);
});

test('several flags at once, and no fix means no flags', () => {
  const f = C.gpsFlags({ fix: { lat: 4.24, lng: 103.42, accuracy: 0, t: T0 }, tzOffsetMin: -300 });
  assert.equal(codes(f), 'accuracy-zero,round-coords,timezone');
  assert.equal(C.gpsFlags({ fix: { lat: null, lng: null } }).length, 0);
  assert.equal(C.gpsFlags({ fix: null }).length, 0);
});

test('kiosk matching: clear match, weak, ambiguous and unknown', () => {
  const dist = (a, b) => Math.abs(a[0] - b[0]);
  const people = [{ id: 'a', descriptor: [0.1] }, { id: 'b', descriptor: [0.5] }, { id: 'c', descriptor: [0.9] }, { id: 'x', descriptor: null }];
  assert.equal(C.bestMatch([0.12], people, dist).result, 'match');
  assert.equal(C.bestMatch([0.12], people, dist).id, 'a');
  // 0.55 from b, 0.55+ from others: weak but clear.
  const weak = C.bestMatch([1.45], people, dist);
  assert.equal(weak.result, 'weak');
  assert.equal(weak.id, 'c');
  // Halfway between a and b: ambiguous.
  assert.equal(C.bestMatch([0.3], people, dist).result, 'ambiguous');
  // Far from everyone.
  const none = C.bestMatch([5], people, dist);
  assert.equal(none.result, 'none');
  assert.equal(none.id, null);
  assert.equal(C.bestMatch([0.1], [], dist).result, 'none');
});

test('kiosk toggles between check-in and check-out', () => {
  assert.equal(C.kioskAction(null), 'in');
  assert.equal(C.kioskAction({ s: 'present', in: '08:55', out: '' }), 'out');
  assert.equal(C.kioskAction({ s: 'present', in: '08:55', out: '13:00' }), 'in');
  assert.equal(C.kioskAction({ s: 'leave', in: '' }), 'in');
});

test('outbox: queue without duplicates', () => {
  let box = C.enqueue([], { id: 'c1', payload: { t: 1 } });
  box = C.enqueue(box, { id: 'c1', payload: { t: 2 } });
  box = C.enqueue(box, { id: 'c2', payload: { t: 3 } });
  assert.equal(box.length, 2);
  assert.equal(box[0].payload.t, 1);
  assert.equal(box[0].attempts, 0);
});

test('outbox: sends in order, stops at the first failure, keeps the rest', async () => {
  const box = ['a', 'b', 'c'].reduce((b, id) => C.enqueue(b, { id }), []);
  const seen = [];
  const r = await C.syncOutbox(box, async (x) => { seen.push(x.id); if (x.id === 'b') throw new Error('Network down'); return true; }, { now: 1000 });
  assert.equal(seen.join(), 'a,b');
  assert.equal(r.sent.join(), 'a');
  assert.equal(r.failed, 'b');
  assert.equal(r.box.map((x) => x.id).join(), 'b,c');
  assert.equal(r.box[0].attempts, 1);
  assert.equal(r.box[0].lastError, 'Network down');
  // Too soon to retry: nothing is sent.
  const again = await C.syncOutbox(r.box, async () => true, { now: 2000 });
  assert.equal(again.sent.length, 0);
  // After the back-off, everything goes.
  const later = await C.syncOutbox(r.box, async () => true, { now: 1000 + C.retryDelay(1) });
  assert.equal(later.sent.join(), 'b,c');
  assert.equal(later.box.length, 0);
});

test('outbox: offline does nothing, false counts as a failure, force skips the back-off', async () => {
  const box = C.enqueue([], { id: 'a' });
  let called = 0;
  const off = await C.syncOutbox(box, async () => { called++; return true; }, { online: false });
  assert.equal(called, 0);
  assert.equal(off.box.length, 1);
  const no = await C.syncOutbox(box, async () => false, { now: 10 });
  assert.equal(no.failed, 'a');
  assert.equal(no.box[0].attempts, 1);
  const forced = await C.syncOutbox(no.box, async () => true, { now: 11, force: true });
  assert.equal(forced.sent.join(), 'a');
});

test('retry delay grows and is capped', () => {
  assert.equal(C.retryDelay(1), 5000);
  assert.equal(C.retryDelay(2), 10000);
  assert.equal(C.retryDelay(3), 20000);
  assert.equal(C.retryDelay(20), 300000);
});

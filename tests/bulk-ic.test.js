// Bulk invite by IC: who is eligible, the tracker counts, the reminder, and the one-at-a-time runner (failures,
// cancel, double click). Fake people and fake ICs only. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'invite-rules.js'), 'utf8'), sandbox);
const I = sandbox.window.AllurusInvite;
const T = I.IC_TEXT;

const ic = (n) => `9001011400${String(n).padStart(2, '0')}`;
const P = (id, o = {}) => ({ id, first: `P${id}`, last: 'Test', status: 'Active', email: '', ic: ic(Number(id.slice(1)) || 0), phone: '0123456789', ...o });
const ids = (list) => Array.from(list, (x) => (x.emp || x).id);

test('eligibility: no email + valid IC, expired; everyone else skipped with the reason', () => {
  const people = [
    P('e1'),                                       // eligible
    P('e2', { email: 'a@x.my' }),                  // has an email
    P('e3', { ic: '' }),                           // IC missing
    P('e4', { ic: '1234' }),                       // IC not valid
    P('e5'),                                       // already invited
    P('e6'),                                       // expired: eligible
    P('e7'),                                       // joined
    P('e8'),                                       // access off
    P('e9'),                                       // the signed-in admin
    P('e10', { status: 'Inactive' }),              // not active
  ];
  const st = { e5: 'invited', e6: 'expired', e7: 'joined', e8: 'disabled' };
  const r = I.icEligibility(people, (e) => ({ key: st[e.id] || 'none' }), 'e9');
  assert.deepEqual(ids(r.invite), ['e1', 'e6']);
  const why = Object.fromEntries(Array.from(r.skipped, (s) => [s.emp.id, s.reason]));
  assert.deepEqual(why, { e2: T.hasEmail, e3: T.noIc, e4: T.badIc, e5: T.invited, e7: T.joined, e8: T.disabled, e9: T.self, e10: T.inactive });
  assert.equal(T.hasEmail, 'Has an email: use Send invitation');
  assert.equal(T.invited, 'Already invited (link still valid)');
});

test('tracker counts only IC staff, and the reminder finds late and expired links', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  const people = [P('e1'), P('e2'), P('e3'), P('e4'), P('e5'), P('e6', { email: 'x@y.my' }), P('e7', { ic: '' })];
  const st = { e1: { key: 'joined' }, e2: { key: 'invited', sentAt: now - 4 * 864e5 }, e3: { key: 'invited', sentAt: now - 864e5 }, e4: { key: 'expired' } };
  const of = (e) => st[e.id] || { key: 'none' };
  assert.deepEqual({ ...I.icCounts(people, of) }, { total: 5, none: 1, invited: 2, expired: 1, joined: 1, disabled: 0 });
  const r = I.icReminder(people, of, now, 3);
  assert.deepEqual(ids(r.late), ['e2']);
  assert.deepEqual(ids(r.expired), ['e4']);
  assert.equal(r.due, true);
  assert.equal(I.icReminder([P('e1')], () => ({ key: 'joined' }), now).due, false);
});

// A fake cloud: one invitation per IC (doc id), a new link each time, like js/cloud.js staffInvite.
function fakeCloud({ failFor = [] } = {}) {
  const invites = new Map(), links = new Set();
  let n = 0;
  return {
    invites, links,
    async make(e) {
      await new Promise((r) => setTimeout(r, 1));
      if (failFor.includes(e.id)) return { error: 'Simulated write error' };
      const was = invites.get(e.ic); if (was) links.delete(was);
      const url = `https://allurus.my/join?k=${String(++n).padStart(32, 'k')}`;
      invites.set(e.ic, url); links.add(url);
      return { ok: true, url, code: 'co123' };
    },
    async recheck(e) { return !invites.has(e.ic); },
  };
}

test('a bulk of 10: 8 eligible get 8 unique links; 2 skipped with the right reason', async () => {
  const people = Array.from({ length: 10 }, (_, i) => P(`e${i + 1}`));
  people[3].email = 'has@mail.my'; people[7].ic = '12';
  const el = I.icEligibility(people, () => ({ key: 'none' }));
  assert.equal(el.invite.length, 8);
  assert.deepEqual(Array.from(el.skipped, (s) => s.reason), [T.hasEmail, T.badIc]);
  const cloud = fakeCloud(), seen = [];
  const r = await I.icBatch().run(el.invite, { make: cloud.make, recheck: cloud.recheck, progress: (i, n) => seen.push(`${i} of ${n}`) });
  assert.equal(r.made.length, 8);
  assert.equal(new Set(Array.from(r.made, (m) => m.url)).size, 8);
  assert.equal(cloud.invites.size, 8);
  assert.equal(seen.at(-1), '8 of 8');
});

test('one failure: the rest still finish and the failure is listed', async () => {
  const people = Array.from({ length: 5 }, (_, i) => P(`e${i + 1}`));
  const cloud = fakeCloud({ failFor: ['e2'] });
  const r = await I.icBatch().run(people, { make: cloud.make, recheck: cloud.recheck });
  assert.deepEqual(ids(r.made), ['e1', 'e3', 'e4', 'e5']);
  assert.deepEqual(Array.from(r.failed, (f) => [f.emp.id, f.reason]), [['e2', 'Simulated write error']]);
});

test('double click: the second run is refused and no one gets a second invitation', async () => {
  const people = Array.from({ length: 4 }, (_, i) => P(`e${i + 1}`));
  const cloud = fakeCloud(), batch = I.icBatch();
  const [a, b] = await Promise.all([batch.run(people, cloud), batch.run(people, cloud)]);
  assert.equal(a.made.length, 4);
  assert.equal(b.busy, true);
  assert.equal(cloud.links.size, 4);
  // A retry afterwards finds them all invited already and makes nothing.
  const again = await batch.run(people, cloud);
  assert.equal(again.made.length, 0);
  assert.equal(again.skipped.length, 4);
  assert.equal(cloud.links.size, 4);
});

test('cancel half way: done ones stay valid, the rest stay not invited', async () => {
  const people = Array.from({ length: 6 }, (_, i) => P(`e${i + 1}`));
  const cloud = fakeCloud();
  let done = 0;
  const r = await I.icBatch().run(people, { ...cloud, stop: () => done >= 3, progress: (i) => { done = i; } });
  assert.equal(r.cancelled, true);
  assert.deepEqual(ids(r.made), ['e1', 'e2', 'e3']);
  assert.equal(r.left, 3);
  assert.deepEqual([...cloud.invites.keys()], [ic(1), ic(2), ic(3)]);
});

test('copy all: warning first, then name, phone and link per line', () => {
  const t = I.icCopyAll([{ name: 'A Test', phone: '0123', url: 'u1' }, { name: 'B Test', phone: '', url: 'u2' }]);
  const lines = t.split('\n');
  assert.equal(lines[0], T.warn);
  assert.equal(lines[2], 'A Test · 0123 · u1');
  assert.equal(lines[3], 'B Test · No phone · u2');
});

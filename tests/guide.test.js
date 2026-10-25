// Tests for the Statutory & Claim Guide: the reference data is complete, the search finds what an admin would type,
// and the page renders every row. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['utils', 'tax', 'guide']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), sandbox, { filename: f + '.js' });
}
const G = sandbox.AllurusGuide;
const T = sandbox.AllurusTax;
const all = [...G.HRD, ...G.LHDN, ...G.employerRows()];

test('every row has an item, a limit, a source and a valid level', () => {
  assert.ok(G.HRD.length >= 20 && G.LHDN.length >= 15);
  all.forEach((r) => {
    assert.ok(r.group && r.item && r.limit && r.src, `incomplete row: ${r.item}`);
    assert.ok(['official', 'check'].includes(r.level), `bad level: ${r.item}`);
  });
  const keys = all.map((r) => `${r.group}|${r.item}`);
  assert.equal(new Set(keys).size, keys.length, 'duplicate rows');
});

test('the HRD Corp rows carry the Allowable Cost Matrix figures', () => {
  const find = (s) => G.HRD.find((r) => r.item.includes(s));
  assert.match(find('General course fee, in-house').limit, /RM10,500 per day.*RM6,000 per half day/);
  assert.match(find('General course fee, local public').limit, /RM1,750 per person per day.*RM1,000/);
  assert.match(find('Meal allowance, in-house').limit, /RM100 per person per day.*RM50/);
  assert.match(find('under 100 km').limit, /RM250/);
  assert.match(find('100 km or more').limit, /RM500/);
  assert.match(find('Overseas daily allowance').limit, /RM1,500/);
  assert.match(find('Consumable').limit, /RM100 per group/);
  assert.match(find('E-learning').limit, /RM875/);
  assert.match(find('Minimum attendance').limit, /75%/);
  assert.ok(G.HRD.every((r) => r.level === 'official'));
});

test('the LHDN rows carry the PCB reliefs and the employer deduction rules', () => {
  const find = (s) => G.LHDN.find((r) => r.item.includes(s));
  assert.equal(find('Individual relief').limit, 'RM9,000');
  assert.equal(find('Spouse relief').limit, 'RM4,000');
  assert.match(find('Child relief').limit, /RM2,000/);
  assert.match(find('EPF and approved').limit, /RM4,000/);
  const employer = G.employerRows();
  assert.equal(employer.length, T.BUSINESS.length);
  assert.ok(employer.length >= 7);
  // The reliefs list matches the caps the Tax page uses.
  T.RELIEFS.forEach((rel) => assert.ok(G.LHDN.some((r) => r.limit.includes(rel.cap.toLocaleString('en-US'))), `missing relief cap ${rel.name}`));
});

test('search needs every word, ignores case and can be narrowed by category', () => {
  const hrd = G.HRD;
  const meal = G.filterRows(hrd, { q: 'meal' });
  assert.ok(meal.some((r) => r.item.includes('Meal allowance')));
  assert.equal(G.filterRows(hrd, { q: 'MEAL allowance RM100' }).length >= 1, true);
  assert.equal(G.filterRows(hrd, { q: 'meal zzzxyz' }).length, 0);
  assert.equal(G.filterRows(hrd, { q: '  ' }).length, hrd.length);
  const air = G.filterRows(hrd, { q: 'airfare' });
  assert.ok(air.length >= 1 && air.every((r) => /air/i.test(`${r.item} ${r.notes} ${r.limit}`)));
  const travel = G.filterRows(hrd, { group: 'Travel and transport' });
  assert.ok(travel.length >= 2 && travel.every((r) => r.group === 'Travel and transport'));
  assert.equal(G.filterRows(hrd, { q: 'meal', group: 'Travel and transport' }).length, 0);
  assert.ok(G.groupsOf(hrd).includes('Meals'));
  const lhdn = G.SETS.lhdn.rows();
  assert.ok(G.filterRows(lhdn, { q: 'parking' }).length >= 1);
  assert.ok(G.filterRows(lhdn, { q: 'spouse' }).length >= 1);
});

test('the page renders a row for every item and a search box', () => {
  const VIEWS = {}, AFTER = {}, ACTIONS = {};
  G.install({ VIEWS, AFTER, ACTIONS, esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), icon: () => '', $: () => null, $$: () => [], render() {} });
  const html = VIEWS.guide();
  assert.match(html, /Statutory &amp; Claim Guide/);
  assert.match(html, /id="guide-q"/);
  assert.equal((html.match(/<tr data-g=/g) || []).length, G.HRD.length);
  assert.match(html, /Official source/);
  ACTIONS['guide-tab'](null, 'lhdn');
  const lhdn = VIEWS.guide();
  assert.equal((lhdn.match(/<tr data-g=/g) || []).length, G.LHDN.length + G.employerRows().length);
  assert.match(lhdn, /Section 33\(1\)/);
});

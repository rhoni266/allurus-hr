// Industry and feature catalogue: effective features, dependency warnings, finder scoring, compare table.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const seedF = require('../seed/features.json');
const seedI = require('../seed/industries.json');
const seedR = require('../seed/finderRules.json');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'site', 'js', 'lib', 'catalog.js')).href);
const featuresByKey = Object.fromEntries(seedF.features.map((f) => [f.key, f]));
const links = seedI.industries.flatMap((i) => i.features.map((f, n) => ({ industryId: i.slug, featureId: f.key, linked: true, showPublic: true, isHeadline: !!f.headline, customLabel: f.label || '', order: n })));
const rules = seedR.questions.flatMap((q) => q.options.map((o) => ({ questionId: q.id, optionId: o.id, reason: o.reason, points: o.points })));

test('seed data is consistent: every link, dependency and finder slug exists', () => {
  const slugs = new Set(seedI.industries.map((i) => i.slug));
  for (const l of links) assert.ok(featuresByKey[l.featureId], `unknown feature ${l.featureId} on ${l.industryId}`);
  for (const f of seedF.features) for (const d of f.dependsOn || []) assert.ok(featuresByKey[d], `${f.key} depends on unknown ${d}`);
  for (const r of rules) for (const s of Object.keys(r.points)) assert.ok(slugs.has(s), `finder points for unknown industry ${s}`);
  assert.equal(seedI.industries.length, 9);
  for (const i of seedI.industries) assert.equal(i.features.filter((f) => f.headline).length, 3, `${i.slug} should have 3 headline features`);
});

test('effective features: industry links + extras − removals, with dependencies', async () => {
  const { effectiveFeatures } = await load();
  const e = effectiveFeatures({ industryIds: ['fleet'], links, featuresByKey, overrides: [] });
  assert.ok(e.keys.has('trips') && e.keys.has('vehicles'));
  assert.equal(e.keys.has('pos'), false);
  const withPos = effectiveFeatures({ industryIds: ['fleet'], links, featuresByKey, overrides: [{ featureId: 'pos', mode: 'add' }, { featureId: 'maintenance', mode: 'remove' }] });
  assert.equal(withPos.source.pos, 'extra');
  assert.equal(withPos.source.stock, 'dependency');      // pos needs stock and receipts
  assert.equal(withPos.source.receipts, 'dependency');
  assert.equal(withPos.keys.has('maintenance'), false);
  assert.ok(withPos.removed.has('maintenance'));
});

test('unlinked (soft-deleted) links and archived features do not count', async () => {
  const { effectiveFeatures } = await load();
  const off = links.map((l) => (l.industryId === 'fleet' && l.featureId === 'trips' ? { ...l, linked: false } : l));
  const fk = { ...featuresByKey, vehicles: { ...featuresByKey.vehicles, archived: true } };
  const e = effectiveFeatures({ industryIds: ['fleet'], links: off, featuresByKey: fk });
  assert.equal(e.keys.has('vehicles'), false);
  assert.equal(e.source.trips, 'dependency');   // unlinked, but fuel-tolls still needs it
});

test('POS to Fleet and logistics: dependency warning lists what is missing', async () => {
  const { missingDependencies } = await load();
  assert.deepEqual(missingDependencies('pos', 'fleet', links, featuresByKey).sort(), ['receipts', 'stock']);
  assert.deepEqual(missingDependencies('pos', 'fnb', links, featuresByKey), []);
});

test('areas only switch off for companies that have an industry', async () => {
  const { areaAllowed, effectiveFeatures } = await load();
  const withAreas = [...links, { industryId: 'tuition', featureId: 'area.finance', linked: true }];
  const e = effectiveFeatures({ industryIds: ['tuition'], links: withAreas, featuresByKey });
  assert.equal(areaAllowed('finance', e, true), true);
  assert.equal(areaAllowed('operations', e, true), false);
  assert.equal(areaAllowed('operations', e, false), true);   // no industry set: nothing changes
  assert.equal(areaAllowed('settings', e, true), true);
});

test('finder: a café owner lands on F&B, with reasons and a second match', async () => {
  const { scoreFinder } = await load();
  const r = scoreFinder({ q1: 'walkin', q2: 'orders', q3: 'small' }, rules, seedI.industries);
  assert.equal(r[0].industry.slug, 'fnb');
  assert.ok(r[0].reasons.length >= 2);
  assert.equal(r[1].industry.slug, 'retail');
  assert.equal(scoreFinder({ q1: 'move', q2: 'vehicles', q3: 'mid' }, rules, seedI.industries)[0].industry.slug, 'fleet');
  assert.equal(scoreFinder({ q1: 'book', q2: 'invoices', q3: 'small' }, rules, seedI.industries)[0].industry.slug, 'tuition');
});

test('compare table and public lists hide core area features and use custom labels', async () => {
  const { compareMatrix, industryFeatures } = await load();
  const withArea = [...links, { industryId: 'fnb', featureId: 'area.payroll', linked: true, showPublic: true }];
  const { rows, cols } = compareMatrix(seedI.industries, withArea, featuresByKey);
  assert.equal(cols.length, 9);
  assert.ok(!rows.some((f) => f.key.startsWith('area.')));
  const fnb = industryFeatures('fnb', links, featuresByKey, { publicOnly: true });
  assert.equal(fnb[0].label, 'Tablet POS for tables, takeaway and delivery');
});

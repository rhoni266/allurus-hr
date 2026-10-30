// Unit tests for the Head office place search: matching, short names, grouping, labels, manual entries and old
// saved values. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of ['utils.js', 'places-rules.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sandbox);
const P = sandbox.window.AllurusPlaces;
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'js', 'vendor', 'places-my.json'), 'utf8'));
const idx = P.index(data, sandbox.window.U.CITIES);
const plain = (x) => JSON.parse(JSON.stringify(x));
const find = (q) => plain(P.search(idx, q));
const labels = (q, level) => (find(q).find((g) => g.level === level)?.items || []).map((i) => i.label);

test('"kema" suggests Kemaman (district) and its towns', () => {
  assert.ok(labels('kema', 'district').includes('Kemaman District, Terengganu, Malaysia'), JSON.stringify(find('kema')));
  assert.ok(labels('chukai', 'city').includes('Cukai, Terengganu, Malaysia'), 'Chukai is GeoNames’ Cukai');
});

test('"terengganu" gives the state first; "malaysia" gives the country', () => {
  const g = find('terengganu');
  assert.equal(g[0].level, 'state'); assert.equal(g[0].items[0].label, 'Terengganu, Malaysia');
  assert.equal(find('malaysia')[0].items[0].label, 'Malaysia');
  assert.equal(find('malaysia')[0].items[0].countryCode, 'MY');
});

test('short and Malay/English names: KL, JB, Penang, W.P., Melaka/Malacca; case and accents ignored', () => {
  assert.equal(find('kl')[0].items[0].city || find('kl')[0].items[0].state, 'Kuala Lumpur');
  assert.match(labels('jb', 'city')[0], /^Johor Bahru, Johor, Malaysia$/);
  assert.equal(labels('penang', 'state')[0], 'Pulau Pinang, Malaysia');
  assert.equal(labels('W.P. Putrajaya', 'state')[0], 'Putrajaya, Malaysia');
  assert.equal(labels('malacca', 'state')[0], 'Melaka, Malaysia');
  assert.ok(labels('SÃO PAULO', 'city').concat(labels('sao paulo', 'city')).some((l) => /São Paulo, Brazil/.test(l)));
});

test('Malaysia ranks first; one character shows nothing', () => {
  assert.equal(find('k').length, 0);
  const all = find('ku').flatMap((g) => g.items);
  assert.equal(all[0].countryCode, 'MY');
});

test('a made-up town is saved by hand: plain text, at most 100 characters, not on the map yet', () => {
  const m = plain(P.manual('  Kampung   Sri <b>Bahagia</b> 2 '));
  assert.equal(m.label, 'Kampung Sri Bahagia 2'); assert.equal(m.level, 'manual'); assert.equal(m.source, 'manual'); assert.equal(P.onMap(m), false);
  assert.equal(P.manual('x'.repeat(300)).label.length, 100);
  assert.equal(P.manual('<script>alert(1)</script>').label, 'alert(1)');
  assert.equal(P.manual('   '), null);
  assert.equal(find('Kampung Tak Wujud Langsung').length, 0, 'nothing found, so the field offers Use "…"');
});

test('old saved values still display and map', () => {
  const kl = plain(P.fromLegacy('Kuala Lumpur', idx));
  assert.equal(kl.label, 'Kuala Lumpur, Malaysia'); assert.equal(kl.level, 'city'); assert.ok(P.onMap(kl));
  assert.equal(plain(P.fromLegacy('Kuantan', idx)).label, 'Kuantan, Pahang, Malaysia');
  assert.equal(plain(P.fromLegacy('London', idx)).label, 'London, United Kingdom');
  assert.equal(plain(P.fromLegacy('Somewhere odd', idx)).level, 'manual');
  assert.equal(P.officeName(kl), 'Kuala Lumpur', 'the old plain field keeps working');
});

test('saving and reloading keeps the same value; states and countries place the marker at their centre', () => {
  const v = find('terengganu')[0].items[0];
  const back = JSON.parse(JSON.stringify(v));
  assert.deepEqual(back, v); assert.ok(P.onMap(back));
  assert.equal(P.officeName(back), 'Terengganu');
  const district = find('kemaman').find((g) => g.level === 'district').items[0];
  assert.equal(district.state, 'Terengganu'); assert.ok(P.onMap(district));
});

test('the dataset is small and credited', () => {
  assert.ok(fs.statSync(path.join(__dirname, '..', 'js', 'vendor', 'places-my.json')).size < 200 * 1024);
  assert.match(data.source, /GeoNames.*CC BY 4\.0/);
  assert.equal(data.states.length, 16);
});

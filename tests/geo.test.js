// Unit tests for check-in geometry: coordinate parsing, Haversine distance and the zone check.
// Run with: npm test   (or: node --test tests/*.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {}, navigator: {}, Intl, TextEncoder, crypto: globalThis.crypto };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8'), sandbox);
const U = sandbox.window.U;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('parses decimal coordinates', () => {
  const r = U.parseCoordsDetailed('4.238203, 103.419428');
  assert.equal(r.ok, true); assert.equal(r.lat, 4.238203); assert.equal(r.lng, 103.419428);
  for (const s of ['4.238203,103.419428', '4.238203 103.419428', '(4.238203, 103.419428)', '  4.238203 ,  103.419428  ', '4.238203; 103.419428']) {
    const p = U.parseCoords(s); assert.ok(p, s); assert.equal(p.lat, 4.238203); assert.equal(p.lng, 103.419428);
  }
  const neg = U.parseCoords('-33.868820, -151.209296');
  assert.equal(neg.lat, -33.86882); assert.equal(neg.lng, -151.209296);
});

test('rounds to 6 decimals and stores numbers', () => {
  const p = U.parseCoords('3.12345678, 101.98765432');
  assert.equal(typeof p.lat, 'number'); assert.equal(p.lat, 3.123457); assert.equal(p.lng, 101.987654);
});

test('parses degrees-minutes-seconds in the format Google Maps shows', () => {
  const p = U.parseCoords(`3°46'11.4"N 103°13'28.4"E`);
  near(p.lat, 3.769833); near(p.lng, 103.224556);
});

test('parses DMS variants: typographic quotes, commas, prefix hemisphere, lng first, S/W', () => {
  near(U.parseCoords('3°46′11.4″N, 103°13′28.4″E').lat, 3.769833);
  near(U.parseCoords(`N 3°46'11.4" E 103°13'28.4"`).lng, 103.224556);
  const swapped = U.parseCoords(`103°13'28.4"E 3°46'11.4"N`);
  near(swapped.lat, 3.769833); near(swapped.lng, 103.224556);
  const sw = U.parseCoords(`33°52'7.8"S 151°12'33.5"W`);
  assert.ok(sw.lat < 0 && sw.lng < 0);
  near(U.parseCoords(`4°14'17.5"N 103°25'10.0"E`).lat, 4.238194);
  near(U.parseCoords('3°46.19\'N 103°13.473\'E').lat, 3.769833, 1e-5);
});

test('rejects invalid coordinates with a helpful message', () => {
  const cases = [
    ['', /Enter/],
    ['Kuantan', /aren’t valid/],
    ['4.238203', /aren’t valid/],
    ['103.419428, 4.238203', /Latitude must be between -90 and 90/],
    ['4.2, 200', /Longitude must be between -180 and 180/],
    ['91, 10', /Latitude/],
    [`3°46'11.4"N 4°13'28.4"N`, /one latitude/],
    [`3°61'11.4"N 103°13'28.4"E`, /below 60/],
    ['1,2,3', /aren’t valid/],
    [`3°46'11.4"N 103°13'28.4"E near the mosque`, /aren’t valid/],
    [`3°46'11.4" 103°13'28.4"`, /aren’t valid/],
  ];
  for (const [input, msg] of cases) {
    const r = U.parseCoordsDetailed(input);
    assert.equal(r.ok, false, `should reject ${JSON.stringify(input)}`);
    assert.match(r.error, msg, `message for ${JSON.stringify(input)}`);
    assert.equal(U.parseCoords(input), null);
  }
});

test('Haversine distance in meters', () => {
  near(U.distanceM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }), 111195, 15);
  assert.equal(Math.round(U.distanceM({ lat: 4.238203, lng: 103.419428 }, { lat: 4.238203, lng: 103.419428 })), 0);
  const kuantan = U.distanceM({ lat: 4.238203, lng: 103.419428 }, { lat: 3.8077, lng: 103.3260 });
  assert.ok(kuantan > 48000 && kuantan < 50000, `pin to Kuantan centre ≈ 49 km, got ${kuantan}`);
  near(U.distanceM({ lat: 3.769833, lng: 103.224556 }, { lat: 3.770283, lng: 103.224556 }), 50, 0.5);
});

test('zone uses the saved check-in point, never the head office city, when one is saved', () => {
  const settings = { company: 'Allurus', office: 'Kuantan', checkin: { label: 'Allurus HQ', lat: 4.238203, lng: 103.419428, radius: 50 } };
  const z = U.resolveZone(settings);
  assert.equal(z.source, 'checkin'); assert.equal(z.lat, 4.238203); assert.equal(z.lng, 103.419428); assert.equal(z.radius, 50);
  assert.equal(U.checkZone({ lat: 4.238203, lng: 103.419428, accuracy: 10 }, z).inside, true, 'at the pin passes');
  const centre = U.checkZone({ lat: 3.8077, lng: 103.3260, accuracy: 10 }, z);
  assert.equal(centre.inside, false, 'Kuantan city centre fails'); assert.ok(centre.m > 48000);
});

test('zone falls back to the head office city only when no check-in point is saved', () => {
  for (const checkin of [{}, { lat: null, lng: null }, { lat: '', lng: '' }, { lat: NaN, lng: 103 }, undefined]) {
    const z = U.resolveZone({ company: 'Acme', office: 'Kuantan', checkin });
    assert.equal(z.source, 'office'); assert.equal(z.lat, 3.808); assert.equal(z.lng, 103.326); assert.equal(z.radius, 50);
  }
});

test('radius boundary and GPS slack', () => {
  const z = U.resolveZone({ office: 'Kuantan', checkin: { lat: 3.769833, lng: 103.224556, radius: 50 } });
  const at = (m, accuracy) => U.checkZone({ lat: 3.769833 + m / 111195, lng: 103.224556, accuracy }, z);
  assert.equal(at(45, 5).inside, true);
  assert.equal(at(60, 0).inside, false, 'no slack without an accuracy reading');
  assert.equal(at(60, 15).inside, true, '10 m outside with ±15 m accuracy counts');
  assert.equal(at(80, 500).inside, false, 'slack is capped at 20 m');
  assert.equal(at(80, 500).slack, U.GPS_SLACK_M);
});

test('radius is clamped to 10–5000 m', () => {
  assert.equal(U.resolveZone({ checkin: { lat: 1, lng: 1, radius: 3 } }).radius, 10);
  assert.equal(U.resolveZone({ checkin: { lat: 1, lng: 1, radius: 99999 } }).radius, 5000);
  assert.equal(U.resolveZone({ checkin: { lat: 1, lng: 1 } }).radius, 50);
});

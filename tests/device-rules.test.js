// Which device is this, and may this person use it (js/device-rules.js). Real user-agent strings.  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/device-rules.js');

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  // iPhone Safari "Request desktop website": a Mac user agent, but touch and a phone-sized screen.
  iphoneDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  chromeos: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

test('kind(): phones, tablets and computers from real browsers', () => {
  const cases = [
    [{ ua: UA.iphone, touch: 5, short: 393 }, 'phone'],
    [{ ua: UA.iphoneDesktop, touch: 5, short: 393 }, 'phone'],
    [{ ua: UA.androidChrome, touch: 5, short: 384, mobile: true }, 'phone'],
    [{ ua: UA.androidChrome, touch: 5, short: 384 }, 'phone'],                 // no userAgentData (older browser)
    [{ ua: UA.samsung, touch: 5, short: 412 }, 'phone'],
    [{ ua: UA.ipad, touch: 5, short: 820 }, 'tablet'],
    [{ ua: UA.ipadOS, touch: 5, short: 820 }, 'tablet'],
    [{ ua: UA.androidTablet, touch: 10, short: 800, mobile: false }, 'tablet'],
    [{ ua: UA.windows, touch: 0, short: 1080, mobile: false }, 'computer'],
    [{ ua: UA.windows, touch: 10, short: 1080, mobile: false }, 'computer'],   // a touch-screen laptop
    [{ ua: UA.mac, touch: 0, short: 900 }, 'computer'],
    [{ ua: UA.chromeos, touch: 0, short: 768, mobile: false }, 'computer'],
  ];
  for (const [env, want] of cases) assert.equal(D.kind(env), want, `${env.ua.slice(13, 40)} → ${want}`);
});

test('allowed(): everyone on a computer by default; the phones-only setting, tablets and the per-person exception still work when on', () => {
  const emp = { roles: ['employee'] }, adm = { roles: ['admin', 'employee'] }, on = { staffDevices: { phonesOnly: true } };
  // Default (no setting): laptops for everyone.
  for (const d of ['phone', 'tablet', 'computer']) { assert.equal(D.allowed(emp, d, {}), true, d); assert.equal(D.allowed(adm, d, {}), true, d); }
  assert.equal(D.policy({}).phonesOnly, false);
  assert.equal(D.policy({ staffDevices: { phonesOnly: true } }).phonesOnly, true);          // an explicit "on" is kept
  // Phones-only explicitly on: staff are blocked on computers and tablets, admins never.
  assert.equal(D.allowed(adm, 'computer', on), true);
  assert.equal(D.allowed(emp, 'phone', on), true);
  assert.equal(D.allowed(emp, 'computer', on), false);
  assert.equal(D.allowed(emp, 'tablet', on), false);
  assert.equal(D.allowed(emp, 'tablet', { staffDevices: { phonesOnly: true, tablets: true } }), true);
  assert.equal(D.allowed({ ...emp, allowComputer: true }, 'computer', on), true);
  assert.equal(D.allowed(null, 'computer', on), true);
});

test('phoneAccess(): computers and tablets are not checked; one registered phone per person', () => {
  const P = (o) => D.phoneAccess({ device: 'phone', thisPhoneId: 'me', devices: [], policy: D.policy({}), ...o });
  const dev = (id, status) => ({ id, name: id, status, added: '2026-11-01' });
  // Not a phone: ok, whatever the list says.
  for (const device of ['computer', 'tablet']) assert.equal(D.phoneAccess({ device, thisPhoneId: 'me', devices: [dev('x', 'approved')] }), 'ok');
  assert.equal(P({ devices: [dev('me', 'approved')] }), 'ok');                                   // their approved phone
  assert.equal(P({ devices: [] }), 'first');                                                     // no phone yet
  assert.equal(P({ devices: [], policy: D.policy({ staffDevices: { autoFirst: false } }) }), 'first');   // same answer; the caller registers it pending
  assert.equal(P({ devices: [dev('me', 'pending')] }), 'pending');                               // asked, waiting
  assert.equal(P({ devices: [dev('old', 'approved')] }), 'other');                               // they have another phone
  assert.equal(P({ devices: [dev('old', 'approved'), dev('me', 'pending')] }), 'pending');
  assert.equal(P({ devices: [dev('old', 'approved'), dev('me', 'retired')] }), 'other');         // a retired phone is refused
  assert.equal(P({ devices: [dev('me', 'retired'), dev('new', 'approved')] }), 'other');
  assert.equal(P({ devices: [dev('me', 'retired')] }), 'first');                                 // HR removed the other: register again
  assert.equal(P({ devices: [dev('me', 'removed')] }), 'first');
  assert.equal(P({ devices: [dev('old', 'removed')] }), 'first');
  assert.equal(P({ devices: undefined }), 'first');
  assert.equal(D.policy({}).autoFirst, true);
  assert.equal(D.policy({ staffDevices: { autoFirst: false } }).autoFirst, false);
});

test('the screen’s words in English and Bahasa Malaysia, and the QR address', () => {
  assert.equal(D.TEXT.en.title, 'Please use your phone');
  assert.equal(D.TEXT.ms.title, 'Sila guna telefon anda');
  for (const l of ['en', 'ms']) for (const k of ['how', 'scan', 'none', 'out', 'joined', 'phonePending', 'phoneOther', 'phoneUse', 'phoneAsked']) assert.ok(D.TEXT[l][k], `${l}.${k}`);
  assert.equal(D.APP_URL, 'https://allurus.my/app');
});

test('the one-phone screens use the owner’s words', () => {
  assert.equal(D.TEXT.en.phoneOther, 'This isn’t your registered phone');
  assert.equal(D.TEXT.ms.phoneOther, 'Ini bukan telefon berdaftar anda');
  assert.equal(D.TEXT.en.phonePending, 'Waiting for HR to approve this phone');
  assert.equal(D.TEXT.ms.phonePending, 'Menunggu kelulusan HR untuk telefon ini');
});

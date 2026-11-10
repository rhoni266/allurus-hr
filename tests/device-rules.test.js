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

test('allowed(): admins anywhere; employees on phones; the company setting and the per-person exception', () => {
  const emp = { roles: ['employee'] }, adm = { roles: ['admin', 'employee'] };
  assert.equal(D.allowed(adm, 'computer', {}), true);
  assert.equal(D.allowed(adm, 'phone', {}), true);
  assert.equal(D.allowed(emp, 'phone', {}), true);
  assert.equal(D.allowed(emp, 'computer', {}), false);                     // on by default
  assert.equal(D.allowed(emp, 'tablet', {}), false);
  assert.equal(D.allowed(emp, 'tablet', { staffDevices: { tablets: true } }), true);
  assert.equal(D.allowed(emp, 'computer', { staffDevices: { tablets: true } }), false);
  assert.equal(D.allowed(emp, 'computer', { staffDevices: { phonesOnly: false } }), true);
  assert.equal(D.allowed({ ...emp, allowComputer: true }, 'computer', {}), true);
  assert.equal(D.allowed(null, 'computer', {}), true);                      // nobody signed in yet: the sign-in page
});

test('the screen’s words in English and Bahasa Malaysia, and the QR address', () => {
  assert.equal(D.TEXT.en.title, 'Please use your phone');
  assert.equal(D.TEXT.ms.title, 'Sila guna telefon anda');
  for (const l of ['en', 'ms']) for (const k of ['how', 'scan', 'none', 'out', 'joined']) assert.ok(D.TEXT[l][k], `${l}.${k}`);
  assert.equal(D.APP_URL, 'https://allurus.my/app');
});

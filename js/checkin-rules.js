// Check-in rules: fake-GPS heuristics, kiosk face matching, and the offline outbox. Pure functions with no DOM
// access, unit tested in tests/checkin.test.js. Heuristics only flag a check-in for HR to look at; they never block
// one, because real phones occasionally produce odd fixes too.
window.AllurusCheckinRules = (function () {
  'use strict';
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const distanceM = (a, b) => {
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const decimals = (n) => { const s = String(n); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
  const hasFix = (p) => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng) && p.lat !== null && p.lng !== null;

  // Thresholds; each is a judgment call, not an official rule.
  const LIMITS = {
    maxKmh: 300, // faster than a car or train between two fixes
    minJumpM: 2000, // ignore small jumps (GPS drift, the next building)
    maxAccuracyRound: 3, // a whole-number accuracy this small is rare on real phones
    roundDecimals: 4, // both coordinates with this many decimals or fewer look typed in
    tzSlackMin: 150, // device clock offset vs what the longitude suggests
  };

  /**
   * Reasons a GPS fix looks faked. fix = { lat, lng, accuracy, t } (t in ms); last = this phone's previous fix
   * ({ lat, lng, t }); history = earlier check-ins [{ day, lat, lng }]; day = today; tzOffsetMin = the device's UTC
   * offset in minutes (e.g. 480 for Malaysia). Returns [{ code, reason }].
   */
  function gpsFlags({ fix, last = null, history = [], day = '', tzOffsetMin = null, limits = LIMITS }) {
    const out = [];
    if (!hasFix(fix)) return out;
    const L = { ...LIMITS, ...limits };
    if (hasFix(last) && last.t && fix.t && fix.t > last.t) {
      const m = distanceM(last, fix), h = (fix.t - last.t) / 3600000;
      const kmh = m / 1000 / h;
      if (m >= L.minJumpM && kmh > L.maxKmh) out.push({ code: 'speed', reason: `Moved ${(m / 1000).toFixed(1)} km in ${Math.max(1, Math.round(h * 60))} min since this phone’s last fix (about ${Math.round(kmh)} km/h).` });
    }
    if (fix.accuracy === 0) out.push({ code: 'accuracy-zero', reason: 'The phone reported a GPS accuracy of exactly 0 m, which real GPS never does.' });
    else if (Number.isInteger(fix.accuracy) && fix.accuracy > 0 && fix.accuracy <= L.maxAccuracyRound) out.push({ code: 'accuracy-round', reason: `The phone reported a suspiciously precise accuracy of exactly ${fix.accuracy} m.` });
    if (decimals(fix.lat) <= L.roundDecimals && decimals(fix.lng) <= L.roundDecimals) out.push({ code: 'round-coords', reason: `The position ${fix.lat}, ${fix.lng} is suspiciously round, as if typed in.` });
    const same = history.find((h) => h.day !== day && hasFix(h) && +h.lat === +fix.lat && +h.lng === +fix.lng);
    if (same) out.push({ code: 'repeat', reason: `Exactly the same coordinates as the check-in on ${same.day}. Real GPS readings always differ slightly.` });
    if (tzOffsetMin != null) {
      const expected = fix.lng * 4; // the sun moves 15° an hour: 4 minutes per degree
      const diff = Math.abs(tzOffsetMin - expected);
      if (diff > L.tzSlackMin) out.push({ code: 'timezone', reason: `The phone’s clock is set to UTC${tzOffsetMin >= 0 ? '+' : '−'}${Math.abs(tzOffsetMin / 60)}, far from the time zone at this position (about UTC${expected >= 0 ? '+' : '−'}${Math.abs(Math.round(expected / 60))}).` });
    }
    return out;
  }

  // ---------- Kiosk face matching ----------
  /**
   * Finds who is in front of the kiosk. people = [{ id, descriptor }]; distance(a, b) compares descriptors.
   * A match needs to be under `match`, and clearly closer than the next person (by `gap`), or it's ambiguous.
   * Returns { result: 'match' | 'weak' | 'ambiguous' | 'none', id, d, next }.
   */
  function bestMatch(descriptor, people, distance, { match = 0.5, weak = 0.6, gap = 0.05 } = {}) {
    const scored = people.filter((p) => p.descriptor?.length).map((p) => ({ id: p.id, d: distance(descriptor, p.descriptor) })).sort((a, b) => a.d - b.d);
    if (!scored.length) return { result: 'none', id: null, d: null, next: null };
    const [best, next] = scored;
    const out = { id: best.id, d: +best.d.toFixed(3), next: next ? +next.d.toFixed(3) : null };
    if (best.d > weak) return { ...out, result: 'none', id: null };
    if (next && next.d - best.d < gap) return { ...out, result: 'ambiguous' };
    return { ...out, result: best.d <= match ? 'match' : 'weak' };
  }
  // In or out at the kiosk: a person who is checked in and not out is checking out.
  const kioskAction = (rec) => (rec?.in && !rec.out && rec.s !== 'leave' ? 'out' : 'in');

  // ---------- Offline outbox ----------
  // Check-ins wait here until they reach the server. Entries are { id, payload, capturedAt, offline, attempts }.
  function enqueue(box, entry) {
    if ((box || []).some((x) => x.id === entry.id)) return box;
    return [...(box || []), { attempts: 0, lastError: '', ...entry }];
  }
  // Wait longer after each failed attempt: 5 s, 10 s, 20 s … up to 5 minutes.
  const retryDelay = (attempts) => Math.min(300000, 5000 * 2 ** Math.max(0, attempts - 1));
  const due = (x, now) => !x.attempts || !x.lastTry || now - x.lastTry >= retryDelay(x.attempts);
  /**
   * Sends waiting entries in the order they were captured. Stops at the first failure so the order is kept, and
   * leaves the rest queued. send(entry) resolves when the server has it and rejects (or returns false) otherwise.
   * Returns { box, sent: [ids], failed: id | null }.
   */
  async function syncOutbox(box, send, { now = Date.now(), online = true, force = false } = {}) {
    const sent = [];
    let rest = [...(box || [])];
    if (!online) return { box: rest, sent, failed: null };
    while (rest.length) {
      const x = rest[0];
      if (!force && !due(x, now)) break;
      let ok = false, err = '';
      try { ok = (await send(x)) !== false; } catch (e) { err = e?.message || 'Could not send'; }
      if (!ok) {
        rest = [{ ...x, attempts: (x.attempts || 0) + 1, lastTry: now, lastError: err || 'Could not send' }, ...rest.slice(1)];
        return { box: rest, sent, failed: x.id };
      }
      sent.push(x.id);
      rest = rest.slice(1);
    }
    return { box: rest, sent, failed: null };
  }

  return { LIMITS, distanceM, decimals, gpsFlags, bestMatch, kioskAction, enqueue, retryDelay, syncOutbox };
})();

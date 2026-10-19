// Shared helpers: dates, formatting, ids and payroll math.
window.U = (function () {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1); };
  const today = () => iso(new Date());
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const isWeekend = (s) => { const g = parse(s).getDay(); return g === 0 || g === 6; };
  const lastWorkday = (s) => { let x = s; while (isWeekend(x)) x = addDays(x, -1); return x; };
  const workdaysBetween = (a, b) => { let n = 0, x = a; while (x <= b) { if (!isWeekend(x)) n++; x = addDays(x, 1); } return n; };
  const monthKey = (s) => s.slice(0, 7);
  const addMonths = (mk, n) => { const [y, m] = mk.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const monthEnd = (mk) => { const [y, m] = mk.split('-').map(Number); return iso(new Date(y, m, 0)); };
  const fmtDate = (s, opts = { month: 'short', day: 'numeric', year: 'numeric' }) => s ? parse(s).toLocaleDateString('en-US', opts) : '—';
  const fmtMonth = (mk, opts = { month: 'long', year: 'numeric' }) => parse(mk + '-01').toLocaleDateString('en-US', opts);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p) => (p || '') + Math.random().toString(36).slice(2, 9);
  const rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const round2 = (n) => Math.round(n * 100) / 100;
  // ---------- Malaysian statutory payroll ----------
  // Resident tax bands used for YA2023 to YA2025, for the monthly tax deduction (PCB/MTD) estimate.
  const TAX_BANDS = [[5000, 0], [20000, 1], [35000, 3], [50000, 6], [70000, 11], [100000, 19], [400000, 25], [600000, 26], [2000000, 28], [Infinity, 30]];
  function residentTax(chargeable) {
    let tax = 0, lower = 0;
    for (const [upper, rate] of TAX_BANDS) {
      if (chargeable > lower) tax += ((Math.min(chargeable, upper) - lower) * rate) / 100;
      lower = upper;
    }
    if (chargeable <= 35000) tax -= 400;
    return round2(Math.max(0, tax));
  }
  // Company defaults, editable in Settings. Rates follow KWSP, PERKESO and HRD Corp rules for Malaysian employees.
  const STATUTORY = { on: true, epfEe: 11, epfEr: 13, epfErHigh: 12, socso: true, eis: true, pcb: 'lhdn', hrdf: 1 };
  const statutory = (settings) => ({ ...STATUTORY, ...(settings.statutory || {}) });
  const ageOn = (birthday, day) => {
    if (!birthday || !/^\d{4}-/.test(birthday)) return 30;
    const [y, m, d] = birthday.split('-').map(Number), [ty, tm, td] = day.split('-').map(Number);
    return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
  };
  // SOCSO and EIS use RM100 wage bands up to the RM6,000 ceiling; contributions are worked out on the band's midpoint.
  const bandWage = (w) => (w <= 0 ? 0 : w > 5900 ? 5950 : Math.floor((w - 0.01) / 100) * 100 + 50);
  const sen5 = (n) => Math.ceil(round2(n) * 20) / 20;
  // PCB estimate: yearly tax on the annualised salary (self relief RM9,000, EPF relief up to RM4,000),
  // plus the extra tax caused by any bonus, rounded up to 5 sen. Below RM10 nothing is deducted.
  function mtd(base, bonus, epfMonth, epfBonus) {
    const yearly = (inc, epf) => residentTax(Math.max(0, inc - Math.min(epf, 4000) - 9000));
    const normal = yearly(base * 12, epfMonth * 12) / 12;
    const extra = bonus ? yearly(base * 12 + bonus, epfMonth * 12 + epfBonus) - yearly(base * 12, epfMonth * 12) : 0;
    const t = Math.ceil((normal + extra) * 20) / 20;
    return t < 10 ? 0 : round2(t);
  }
  // Monthly payslip from an annual salary. `e` (the employee) gives the age and zakat; `day` is the pay date.
  const payCalc = (salary, bonus, settings, e = null, day = today()) => {
    const base = round2(salary / 12);
    bonus = Number(bonus) || 0;
    const gross = round2(base + bonus);
    const st = statutory(settings);
    if (settings.currency !== 'MYR' || !st.on) {
      const tax = round2(gross * settings.taxRate / 100);
      const benefits = round2(gross * settings.benefitsRate / 100);
      return { base, bonus, gross, tax, benefits, epf: 0, socso: 0, eis: 0, zakat: 0, erEpf: 0, erSocso: 0, erEis: 0, hrdf: 0, erCost: 0, net: round2(gross - tax - benefits) };
    }
    const senior = ageOn(e?.birthday, day) >= 60;
    // EPF is rounded up to the next ringgit. From 60, employees stop contributing and employers pay 4%.
    const epfOf = (w) => (senior ? 0 : Math.ceil((w * st.epfEe) / 100));
    const epf = epfOf(gross);
    const erEpf = Math.ceil((gross * (senior ? 4 : gross <= 5000 ? st.epfEr : st.epfErHigh)) / 100);
    const bw = bandWage(gross);
    // SOCSO: employment injury plus invalidity (1.75% employer, 0.5% employee); from 60 only injury, paid by the employer (1.25%).
    const socso = st.socso && !senior ? sen5(bw * 0.005) : 0;
    const erSocso = st.socso ? sen5(bw * (senior ? 0.0125 : 0.0175)) : 0;
    // EIS: 0.2% each, for employees aged 18 to 60.
    const eis = st.eis && !senior ? sen5(bw * 0.002) : 0;
    const erEis = eis;
    const zakat = round2(Number(e?.zakat) || 0);
    const pcbRaw = st.pcb === 'flat' ? round2((gross * settings.taxRate) / 100) : mtd(base, bonus, epfOf(base), epf - epfOf(base));
    // Zakat paid through payroll reduces the tax deduction ringgit for ringgit.
    const tax = round2(Math.max(0, pcbRaw - zakat));
    // HRD Corp levy is on basic pay, paid by the employer only.
    const hrdf = round2((base * (Number(st.hrdf) || 0)) / 100);
    const benefits = round2(epf + socso + eis);
    return { base, bonus, gross, tax, benefits, epf, socso, eis, zakat, erEpf, erSocso, erEis, hrdf, erCost: round2(erEpf + erSocso + erEis + hrdf), net: round2(gross - tax - benefits - zakat) };
  };
  // City table for office locations, the platform map and the time-zone fallback for check-in.
  const CITIES = [
    ['London', 'United Kingdom', 51.507, -0.128, 'Europe/London'], ['Manchester', 'United Kingdom', 53.481, -2.243],
    ['New York', 'United States', 40.713, -74.006, 'America/New_York'], ['Chicago', 'United States', 41.878, -87.630, 'America/Chicago'],
    ['San Francisco', 'United States', 37.775, -122.419, 'America/Los_Angeles'], ['Austin', 'United States', 30.267, -97.743],
    ['Toronto', 'Canada', 43.653, -79.383, 'America/Toronto'], ['Vancouver', 'Canada', 49.283, -123.121, 'America/Vancouver'],
    ['Mexico City', 'Mexico', 19.433, -99.133, 'America/Mexico_City'], ['São Paulo', 'Brazil', -23.551, -46.633, 'America/Sao_Paulo'],
    ['Paris', 'France', 48.857, 2.352, 'Europe/Paris'], ['Berlin', 'Germany', 52.520, 13.405, 'Europe/Berlin'],
    ['Madrid', 'Spain', 40.417, -3.704, 'Europe/Madrid'], ['Barcelona', 'Spain', 41.385, 2.173], ['Milan', 'Italy', 45.464, 9.190, 'Europe/Rome'],
    ['Amsterdam', 'Netherlands', 52.368, 4.904, 'Europe/Amsterdam'], ['Stockholm', 'Sweden', 59.329, 18.069, 'Europe/Stockholm'],
    ['Warsaw', 'Poland', 52.230, 21.012, 'Europe/Warsaw'], ['Istanbul', 'Turkey', 41.008, 28.978, 'Europe/Istanbul'],
    ['Cairo', 'Egypt', 30.044, 31.236, 'Africa/Cairo'], ['Nairobi', 'Kenya', -1.292, 36.822, 'Africa/Nairobi'],
    ['Lagos', 'Nigeria', 6.524, 3.379, 'Africa/Lagos'], ['Johannesburg', 'South Africa', -26.204, 28.047, 'Africa/Johannesburg'],
    ['Dubai', 'United Arab Emirates', 25.205, 55.271, 'Asia/Dubai'], ['Abu Dhabi', 'United Arab Emirates', 24.454, 54.377],
    ['Riyadh', 'Saudi Arabia', 24.713, 46.675, 'Asia/Riyadh'], ['Jeddah', 'Saudi Arabia', 21.486, 39.192],
    ['Doha', 'Qatar', 25.285, 51.531, 'Asia/Qatar'], ['Kuwait City', 'Kuwait', 29.376, 47.977, 'Asia/Kuwait'],
    ['Karachi', 'Pakistan', 24.861, 67.010, 'Asia/Karachi'], ['Lahore', 'Pakistan', 31.520, 74.358], ['Islamabad', 'Pakistan', 33.684, 73.048],
    ['Mumbai', 'India', 19.076, 72.878, 'Asia/Kolkata'], ['Bengaluru', 'India', 12.972, 77.595], ['Delhi', 'India', 28.614, 77.209],
    ['Dhaka', 'Bangladesh', 23.810, 90.413, 'Asia/Dhaka'], ['Singapore', 'Singapore', 1.352, 103.820, 'Asia/Singapore'],
    ['Kuala Lumpur', 'Malaysia', 3.139, 101.687, 'Asia/Kuala_Lumpur'], ['Kuantan', 'Malaysia', 3.808, 103.326], ['Jakarta', 'Indonesia', -6.208, 106.846, 'Asia/Jakarta'],
    ['Manila', 'Philippines', 14.600, 120.984, 'Asia/Manila'], ['Hong Kong', 'Hong Kong', 22.320, 114.169, 'Asia/Hong_Kong'],
    ['Shanghai', 'China', 31.230, 121.474, 'Asia/Shanghai'], ['Tokyo', 'Japan', 35.676, 139.650, 'Asia/Tokyo'],
    ['Seoul', 'South Korea', 37.567, 126.978, 'Asia/Seoul'], ['Sydney', 'Australia', -33.869, 151.209, 'Australia/Sydney'],
    ['Melbourne', 'Australia', -37.814, 144.963, 'Australia/Melbourne'], ['Auckland', 'New Zealand', -36.848, 174.763, 'Pacific/Auckland'],
  ].map(([name, country, lat, lng, tz]) => ({ name, country, lat, lng, tz }));
  const city = (name) => CITIES.find((c) => c.name === name);
  const distanceKm = (a, b) => {
    const R = 6371, rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const nearestCity = (p) => CITIES.reduce((best, c) => (distanceKm(p, c) < distanceKm(p, best) ? c : best), CITIES[0]);
  // Best-effort device location: GPS/Wi-Fi first, then the city implied by the device time zone.
  // With { gpsOnly: true } it resolves null instead of guessing from the time zone.
  const locate = (opts = {}) => new Promise((resolve) => {
    const fallback = () => {
      if (opts.gpsOnly) return resolve(null);
      let tz = '';
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* no Intl */ }
      const c = CITIES.find((x) => x.tz === tz);
      if (c) resolve({ lat: c.lat, lng: c.lng, label: `${c.name}, ${c.country}`, source: 'timezone', accuracy: 50000 });
      else resolve({ lat: null, lng: null, label: tz ? tz.split('/').pop().replace(/_/g, ' ') : 'Unknown', source: 'timezone', accuracy: null });
    };
    if (!navigator.geolocation) return fallback();
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; fallback(); } }, opts.gpsOnly ? 14000 : 8000);
    try {
      navigator.geolocation.getCurrentPosition((pos) => {
        if (done) return; done = true; clearTimeout(timer);
        const p = { lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) };
        const c = nearestCity(p), km = distanceKm(p, c);
        resolve({ ...p, label: km < 60 ? `Near ${c.name}, ${c.country}` : `${km.toFixed(0)} km from ${c.name}`, source: 'gps', accuracy: Math.round(pos.coords.accuracy) });
      }, () => { if (!done) { done = true; clearTimeout(timer); fallback(); } }, opts.gpsOnly ? { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 } : { enableHighAccuracy: false, timeout: 7000, maximumAge: 300000 });
    } catch (e) { if (!done) { done = true; clearTimeout(timer); fallback(); } }
  });

  // ---------- Check-in geometry ----------
  // Parses "3.769833, 103.224556" or degrees-minutes-seconds such as 3°46'11.4"N 103°13'28.4"E.
  // Returns { ok: true, lat, lng } with numbers rounded to 6 decimals, or { ok: false, error }.
  const COORD_HINT = 'Use 3.769833, 103.224556 or 3°46\'11.4"N 103°13\'28.4"E.';
  function parseCoordsDetailed(str) {
    const s = String(str ?? '').trim()
      .replace(/[″“”]/g, '"').replace(/[′‘’]/g, "'").replace(/''/g, '"').replace(/[º˚]/g, '°');
    if (!s) return { ok: false, error: 'Enter the check-in coordinates.' };
    const range = (lat, lng) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: `Those coordinates aren’t valid. ${COORD_HINT}` };
      if (Math.abs(lat) > 90) return { ok: false, error: `Latitude must be between -90 and 90 (got ${lat}). Check the order: latitude first, then longitude.` };
      if (Math.abs(lng) > 180) return { ok: false, error: `Longitude must be between -180 and 180 (got ${lng}).` };
      return { ok: true, lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
    };
    const dec = s.match(/^\(?\s*([-+]?\d+(?:\.\d+)?)\s*[,;\s]\s*([-+]?\d+(?:\.\d+)?)\s*\)?$/);
    if (dec) return range(+dec[1], +dec[2]);
    // Hemisphere letters come either all before the numbers ("N 3°46'…") or all after them ("3°46'…N").
    const num = `(\\d+(?:\\.\\d+)?)\\s*°\\s*(?:(\\d+(?:\\.\\d+)?)\\s*'\\s*)?(?:(\\d+(?:\\.\\d+)?)\\s*"\\s*)?`;
    const prefix = /^[NSEW]/i.test(s);
    const re = new RegExp(prefix ? `([NSEW])\\s*${num}` : `${num}([NSEW])`, 'gi');
    const parts = [...s.matchAll(re)].map((m) => (prefix ? [m[0], m[1], m[2], m[3], m[4], undefined] : [m[0], undefined, m[1], m[2], m[3], m[4]]));
    const rest = s.replace(re, '').replace(/[\s,;]/g, '');
    if (parts.length !== 2 || rest) return { ok: false, error: `Those coordinates aren’t valid. ${COORD_HINT}` };
    const conv = (m) => {
      const min = +m[3] || 0, sec = +m[4] || 0;
      if (min >= 60 || sec >= 60) return null;
      const hemi = (m[1] || m[5]).toUpperCase();
      const v = (+m[2] + min / 60 + sec / 3600) * (hemi === 'S' || hemi === 'W' ? -1 : 1);
      return { v, isLat: hemi === 'N' || hemi === 'S' };
    };
    const a = conv(parts[0]), b = conv(parts[1]);
    if (!a || !b) return { ok: false, error: 'Minutes and seconds must be below 60.' };
    if (a.isLat === b.isLat) return { ok: false, error: 'Give one latitude (N or S) and one longitude (E or W).' };
    return a.isLat ? range(a.v, b.v) : range(b.v, a.v);
  }
  const parseCoords = (str) => { const r = parseCoordsDetailed(str); return r.ok ? { lat: r.lat, lng: r.lng } : null; };
  const hasCoords = (p) => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  // Haversine great-circle distance in meters.
  const distanceM = (a, b) => distanceKm(a, b) * 1000;
  // GPS readings wobble; a reading this close outside the circle (at most) still counts as inside.
  const GPS_SLACK_M = 20;
  // The one place that decides where check-in is measured from: the saved check-in point,
  // or, only when none is saved, the head office city centre (flagged so Settings can warn).
  function resolveZone(settings) {
    const c = settings.checkin || {};
    const radius = Math.min(5000, Math.max(10, Math.round(Number(c.radius) || 50)));
    const label = c.label || `${settings.company || 'Company'} office`;
    if (hasCoords(c)) return { ...c, label, radius, lat: +c.lat, lng: +c.lng, source: 'checkin' };
    const city = CITIES.find((x) => x.name === settings.office) || CITIES[0];
    return { ...c, label, radius, lat: city.lat, lng: city.lng, source: 'office', city: `${city.name}, ${city.country}` };
  }
  // Apply the check-in point published with the app (AllurusSeed.published) to a browser's copy of the
  // settings, unless this browser has a newer point (set here by HR, or from a newer setup link).
  // Returns true when it changed something.
  function applyPublishedZone(settings, pub) {
    if (!settings || !pub || !hasCoords(pub)) return false;
    if (String(settings.company || '').toLowerCase() !== String(pub.company || '').toLowerCase()) return false;
    const c = settings.checkin || (settings.checkin = {});
    if (hasCoords(c) && c.setAt && c.setAt >= pub.at) return false;
    Object.assign(c, { label: c.setAt ? c.label || pub.label : pub.label, lat: pub.lat, lng: pub.lng, radius: pub.radius || c.radius || 50, setAt: pub.at });
    return true;
  }
  // Distance from a GPS position to the zone centre, and whether it counts as inside.
  function checkZone(pos, zone) {
    const m = Math.round(distanceM(pos, zone));
    const slack = Math.min(Math.max(0, Number(pos.accuracy) || 0), GPS_SLACK_M);
    return { m, inside: m <= zone.radius + slack, slack };
  }
  const fmtCoords = (p) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
  const fmtDist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

  // SHA-256 of "email:password" for the demo sign-in. Uses Web Crypto, with a small JS fallback.
  function sha256js(str) {
    const K = [], H = [];
    const isPrime = (n) => { for (let f = 2; f * f <= n; f++) if (n % f === 0) return false; return true; };
    for (let n = 2, k = 0; k < 64; n++) if (isPrime(n)) { if (k < 8) H[k] = (Math.pow(n, 1 / 2) * 2 ** 32) | 0; K[k++] = (Math.pow(n, 1 / 3) * 2 ** 32) | 0; }
    const bytes = new TextEncoder().encode(str), l = bytes.length;
    const words = new Array(((l + 9 + 63) >> 6) << 4).fill(0);
    for (let i = 0; i < l; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    words[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
    words[words.length - 1] = l * 8;
    const ror = (x, n) => (x >>> n) | (x << (32 - n));
    for (let j = 0; j < words.length; j += 16) {
      const w = words.slice(j, j + 16);
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        if (i >= 16) {
          const w15 = w[i - 15], w2 = w[i - 2];
          w[i] = (w[i - 16] + (ror(w15, 7) ^ ror(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (ror(w2, 17) ^ ror(w2, 19) ^ (w2 >>> 10))) | 0;
        }
        const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
    }
    return H.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
  }
  async function hashPassword(email, password) {
    const msg = `${String(email).trim().toLowerCase()}:${password}`;
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { return sha256js(msg); }
  }

  return { parseCoords, parseCoordsDetailed, hasCoords, distanceM, resolveZone, applyPublishedZone, checkZone, GPS_SLACK_M, fmtCoords, fmtDist, hashPassword, sha256js, CITIES, city, distanceKm, nearestCity, locate, pad, iso, parse, today, addDays, isWeekend, lastWorkday, workdaysBetween, monthKey, addMonths, monthEnd, fmtDate, fmtMonth, esc, uid, rng, round2, payCalc, residentTax, statutory, STATUTORY, ageOn };
})();

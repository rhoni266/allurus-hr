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
  // Monthly payslip from an annual salary.
  const payCalc = (salary, bonus, settings) => {
    const base = round2(salary / 12);
    const gross = round2(base + (Number(bonus) || 0));
    const tax = round2(gross * settings.taxRate / 100);
    const benefits = round2(gross * settings.benefitsRate / 100);
    return { base, bonus: Number(bonus) || 0, gross, tax, benefits, net: round2(gross - tax - benefits) };
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
    ['Kuala Lumpur', 'Malaysia', 3.139, 101.687, 'Asia/Kuala_Lumpur'], ['Jakarta', 'Indonesia', -6.208, 106.846, 'Asia/Jakarta'],
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
  const locate = () => new Promise((resolve) => {
    const fallback = () => {
      let tz = '';
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* no Intl */ }
      const c = CITIES.find((x) => x.tz === tz);
      if (c) resolve({ lat: c.lat, lng: c.lng, label: `${c.name}, ${c.country}`, source: 'timezone', accuracy: 50000 });
      else resolve({ lat: null, lng: null, label: tz ? tz.split('/').pop().replace(/_/g, ' ') : 'Unknown', source: 'timezone', accuracy: null });
    };
    if (!navigator.geolocation) return fallback();
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; fallback(); } }, 8000);
    try {
      navigator.geolocation.getCurrentPosition((pos) => {
        if (done) return; done = true; clearTimeout(timer);
        const p = { lat: +pos.coords.latitude.toFixed(4), lng: +pos.coords.longitude.toFixed(4) };
        const c = nearestCity(p), km = distanceKm(p, c);
        resolve({ ...p, label: km < 60 ? `Near ${c.name}, ${c.country}` : `${km.toFixed(0)} km from ${c.name}`, source: 'gps', accuracy: Math.round(pos.coords.accuracy) });
      }, () => { if (!done) { done = true; clearTimeout(timer); fallback(); } }, { enableHighAccuracy: false, timeout: 7000, maximumAge: 300000 });
    } catch (e) { if (!done) { done = true; clearTimeout(timer); fallback(); } }
  });

  return { CITIES, city, distanceKm, nearestCity, locate, pad, iso, parse, today, addDays, isWeekend, lastWorkday, workdaysBetween, monthKey, addMonths, monthEnd, fmtDate, fmtMonth, esc, uid, rng, round2, payCalc };
})();

// Head office place search: Malaysia's cities and towns, districts and states (js/vendor/places-my.json, GeoNames,
// CC BY 4.0) plus other countries' main cities (U.CITIES), matched ignoring case and accents, with Malay and English
// names and short forms (KL, JB, Pulau Pinang = Penang, W.P.). Pure (no DOM), unit tested in tests/places.test.js.
// The saved value: { label, level, city, district, state, country, countryCode, lat, lng, source, updatedAt }.
window.AllurusPlaces = (function () {
  'use strict';
  const MAX = 100;
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\bw\s*\.?\s*p\s*\.?(?=\s|$)/g, 'wp').replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const COUNTRY_CODES = { Malaysia: 'MY', Singapore: 'SG', Indonesia: 'ID', Thailand: 'TH', Brunei: 'BN', Philippines: 'PH', 'United Kingdom': 'GB', 'United States': 'US', Australia: 'AU',
    China: 'CN', India: 'IN', Japan: 'JP', 'Hong Kong': 'HK', 'United Arab Emirates': 'AE', 'Saudi Arabia': 'SA', Qatar: 'QA', Pakistan: 'PK', Bangladesh: 'BD', 'South Korea': 'KR',
    'New Zealand': 'NZ', Canada: 'CA', Germany: 'DE', France: 'FR', Netherlands: 'NL', Spain: 'ES', Italy: 'IT', Sweden: 'SE', Poland: 'PL', Turkey: 'TR', Egypt: 'EG', Kenya: 'KE',
    Nigeria: 'NG', 'South Africa': 'ZA', Mexico: 'MX', Brazil: 'BR', Kuwait: 'KW' };

  // One searchable list from the dataset and the world city table.
  function index(data, world = []) {
    const out = [];
    const add = (o, names) => out.push({ ...o, keys: [...new Set(names.filter(Boolean).map(norm))] });
    if (data) {
      const [cName, cCode, cLat, cLng, cAlias] = data.country;
      add({ level: 'country', country: cName, countryCode: cCode, lat: cLat, lng: cLng, weight: 5 }, [cName, ...cAlias]);
      data.states.forEach(([name, lat, lng, alias]) => add({ level: 'state', state: name, country: cName, countryCode: cCode, lat, lng, weight: 4 }, [name, ...alias, ...(['Kuala Lumpur', 'Putrajaya', 'Labuan'].includes(name) ? [`Wilayah Persekutuan ${name}`, `WP ${name}`] : [])]));
      data.districts.forEach(([name, si, lat, lng, alias]) => add({ level: 'district', district: name, state: data.states[si][0], country: cName, countryCode: cCode, lat, lng, weight: 3 }, [name, `${name} district`, `daerah ${name}`, ...alias]));
      data.places.forEach(([name, si, di, lat, lng, pop, alias]) => add({ level: 'city', city: name, district: di >= 0 ? data.districts[di][0] : '', state: data.states[si][0], country: cName, countryCode: cCode, lat, lng, pop, weight: 1 }, [name, ...alias]));
    }
    const countries = new Map();
    world.filter((c) => c.country !== 'Malaysia').forEach((c) => {
      add({ level: 'city', city: c.name, state: '', country: c.country, countryCode: COUNTRY_CODES[c.country] || '', lat: c.lat, lng: c.lng, pop: 0, weight: 0 }, [c.name]);
      if (!countries.has(c.country)) countries.set(c.country, c);
    });
    countries.forEach((c, name) => add({ level: 'country', country: name, countryCode: COUNTRY_CODES[name] || '', lat: c.lat, lng: c.lng, weight: 0 }, [name]));
    return out;
  }

  // How well one entry matches: an exact name or short form, the start of the name, the start of a word, or inside it.
  function score(entry, q) {
    let best = 0;
    for (const k of entry.keys) {
      const s = k === q ? 100 : k.startsWith(q) ? 80 - Math.min(20, k.length - q.length) / 2 : ` ${k}`.includes(` ${q}`) ? 60 : q.length >= 3 && k.includes(q) ? 40 : 0;
      if (s > best) best = s;
    }
    if (!best) return 0;
    // Bigger areas (country, state, district) and bigger towns rank higher among equally good matches.
    return best + (entry.countryCode === 'MY' ? 15 : 0) + entry.weight * 3 + (entry.pop ? Math.min(6, Math.log10(entry.pop + 1)) - 2 : 0);
  }
  const LEVELS = ['city', 'district', 'state', 'country'];
  const P_label = (e) => label(toValue(e));
  // Suggestions for what's typed (2 characters or more), best first, grouped by level.
  function search(idx, text, { perLevel = 5 } = {}) {
    const q = norm(text);
    if (q.length < 2) return [];
    const hits = idx.map((e) => ({ e, s: score(e, q) })).filter((h) => h.s > 0).sort((a, b) => b.s - a.s);
    // A label shown once only (Kuala Lumpur is both a city and a federal territory: the better match stays).
    const shown = new Set(hits.map((h) => h.e).filter((e, i, a) => a.findIndex((x) => P_label(x) === P_label(e)) === i));
    const groups = LEVELS.map((level) => ({ level, items: hits.filter((h) => h.e.level === level && shown.has(h.e)).slice(0, perLevel).map((h) => toValue(h.e)) })).filter((g) => g.items.length);
    // The group holding the best match comes first; Malaysia's levels keep their natural order otherwise.
    const top = hits[0]?.e.level;
    return groups.sort((a, b) => (a.level === top ? -1 : b.level === top ? 1 : LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level)));
  }

  // The label shown and saved: "City, State, Malaysia" · "District, State, Malaysia" · "State, Malaysia" · "Malaysia".
  function label(v) {
    if (!v) return '';
    if (v.level === 'manual') return v.label || '';
    const parts = v.level === 'country' ? [v.country] : v.level === 'state' ? [v.state, v.country] : v.level === 'district' ? [`${v.district} District`, v.state, v.country] : [v.city, v.state && v.state !== v.city ? v.state : '', v.country];
    return parts.filter(Boolean).join(', ');
  }
  function toValue(e, source = 'list') {
    const v = { level: e.level, city: e.city || '', district: e.district || '', state: e.state || '', country: e.country || '', countryCode: e.countryCode || '', lat: e.lat ?? null, lng: e.lng ?? null, source };
    return { label: label(v), ...v };
  }
  // Typed by hand: plain text only, at most 100 characters; placed on the map later by a pin.
  function manual(text) {
    const t = String(text ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX);
    return t ? { label: t, level: 'manual', city: '', district: '', state: '', country: '', countryCode: '', lat: null, lng: null, source: 'manual' } : null;
  }
  // An older saved value (settings.office, e.g. "Kuala Lumpur") as the new structure.
  function fromLegacy(office, idx) {
    if (!office) return null;
    if (typeof office === 'object' && office.level) return office;
    const q = norm(office);
    const exact = idx.filter((e) => e.keys.includes(q) && e.level === 'city').sort((a, b) => (b.countryCode === 'MY') - (a.countryCode === 'MY') || (b.pop || 0) - (a.pop || 0))[0];
    return exact ? toValue(exact) : manual(office);
  }
  // The old plain field (settings.office) that other parts of the app still read: the city or place name.
  const officeName = (v) => (v ? v.city || (v.level === 'district' ? v.district : v.level === 'state' ? v.state : v.level === 'country' ? v.country : v.label) : '');
  const onMap = (v) => !!v && Number.isFinite(v.lat) && Number.isFinite(v.lng);
  return { MAX, norm, index, search, label, toValue, manual, fromLegacy, officeName, onMap, LEVELS };
})();

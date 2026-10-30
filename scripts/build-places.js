// Builds js/vendor/places-my.json (Malaysia's states, districts, cities and towns, for the Head office field) from
// a GeoNames Malaysia extract. GeoNames data: CC BY 4.0 (https://www.geonames.org/, see js/vendor/PLACES-LICENSE.md).
//   1. Download https://download.geonames.org/export/dump/MY.zip (unzip MY.txt), admin1CodesASCII.txt, admin2Codes.txt
//   2. node scripts/build-places.js <folder with those files>
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('Usage: node scripts/build-places.js <folder with MY.txt, admin1CodesASCII.txt, admin2Codes.txt>'); process.exit(1); }
const rows = (f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));

// Malaysian names first, the English or older name as an alias.
const STATE_NAME = { Malacca: 'Melaka', Penang: 'Pulau Pinang' };
const STATE_ALIAS = {
  'Kuala Lumpur': ['KL', 'WP Kuala Lumpur', 'W.P. Kuala Lumpur', 'Wilayah Persekutuan Kuala Lumpur', 'Federal Territory of Kuala Lumpur'],
  Putrajaya: ['WP Putrajaya', 'W.P. Putrajaya', 'Wilayah Persekutuan Putrajaya'], Labuan: ['WP Labuan', 'W.P. Labuan', 'Wilayah Persekutuan Labuan'],
  'Pulau Pinang': ['Penang', 'Pinang', 'PP'], Melaka: ['Malacca'], 'Negeri Sembilan': ['N. Sembilan', 'NS', 'N9'], Terengganu: ['Trengganu', 'Tganu'],
  Kelantan: [], Selangor: ['Sel', 'Selangor Darul Ehsan'], Johor: ['Johore', 'Johor Darul Takzim'], Pahang: ['Pahang Darul Makmur'],
  Kedah: ['Kedah Darul Aman'], Perak: ['Perak Darul Ridzuan'], Perlis: [], Sabah: [], Sarawak: [],
};
const PLACE_ALIAS = {
  'Kuala Lumpur': ['KL'], 'Johor Bahru': ['JB', 'Johor Baru'], 'Kota Kinabalu': ['KK'], 'Petaling Jaya': ['PJ'], 'Kuala Terengganu': ['KT'],
  'George Town': ['Georgetown', 'Penang'], 'Shah Alam': [], 'Subang Jaya': ['SJ'], 'Alor Setar': ['Alor Star'], 'Kota Bharu': ['KB', 'Kota Baru'],
  'Seri Iskandar': [], Melaka: ['Malacca', 'Malacca City', 'Bandar Melaka'], Cukai: ['Chukai'], 'Kuching': [], 'Ipoh': [], 'Seremban': [], 'Kuantan': [],
  Putrajaya: [], Cyberjaya: [], 'Bandar Baru Bangi': ['Bangi'], Klang: ['Kelang'], 'Sungai Petani': ['SP'],
};
const latin = (s) => /^[\p{Script=Latin}\d\s.'’()\-/&]+$/u.test(s);
const r4 = (n) => Math.round(Number(n) * 1e4) / 1e4;

const admin1 = new Map(rows('admin1CodesASCII.txt').filter((r) => r[0].startsWith('MY.')).map((r) => [r[0].split('.')[1], STATE_NAME[r[1]] || r[1]]));
const admin2 = new Map(rows('admin2Codes.txt').filter((r) => r[0].startsWith('MY.')).map((r) => [r[0], r[1].replace(/^(Daerah|District of)\s+/i, '').replace(/\s+District$/i, '')]));
const all = rows('MY.txt');

const states = [], stateIdx = new Map();
for (const [code, name] of admin1) {
  const g = all.find((r) => r[7] === 'ADM1' && r[10] === code) || all.find((r) => r[6] === 'P' && r[10] === code && /^PPLA$|^PPLC$/.test(r[7]));
  stateIdx.set(code, states.length);
  states.push([name, g ? r4(g[4]) : null, g ? r4(g[5]) : null, STATE_ALIAS[name] || []]);
}
const districts = [], distIdx = new Map();
for (const r of all.filter((x) => x[6] === 'A' && x[7] === 'ADM2')) {
  const key = `MY.${r[10]}.${r[11]}`, name = admin2.get(key) || r[1].replace(/^(Daerah|District of)\s+/i, '').replace(/\s+District$/i, '');
  if (!stateIdx.has(r[10]) || distIdx.has(key)) continue;
  distIdx.set(key, districts.length);
  districts.push([name, stateIdx.get(r[10]), r4(r[4]), r4(r[5]), []]);
}
// Towns: every state and district seat, plus populated places of at least 1,000 people.
const KEEP = new Set(['PPLC', 'PPLA', 'PPLA2', 'PPLA3', 'PPLG']);
const places = [];
const seen = new Set();
for (const r of all.filter((x) => x[6] === 'P' && x[7] && x[7].startsWith('PPL') && !['PPLX', 'PPLH', 'PPLQ', 'PPLW'].includes(x[7]))) {
  const pop = Number(r[14]) || 0;
  if (!KEEP.has(r[7]) && pop < 1000) continue;
  if (!stateIdx.has(r[10])) continue;
  const name = r[1].trim(), key = `${name}|${r[10]}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const alts = [...new Set(String(r[3] || '').split(',').map((a) => a.trim()).filter((a) => a && a !== name && a.length <= 40 && latin(a)))].slice(0, 4);
  places.push([name, stateIdx.get(r[10]), distIdx.has(`MY.${r[10]}.${r[11]}`) ? distIdx.get(`MY.${r[10]}.${r[11]}`) : -1, r4(r[4]), r4(r[5]), pop, [...new Set([...(PLACE_ALIAS[name] || []), ...alts])]]);
}
places.sort((a, b) => b[5] - a[5]);
const out = { v: 1, source: 'GeoNames (geonames.org), CC BY 4.0', built: new Date().toISOString().slice(0, 10), country: ['Malaysia', 'MY', 4.2105, 101.9758, ['Malaysia', 'MY', 'MAS', 'Malaya']], states, districts, places };
const file = path.join(__dirname, '..', 'js', 'vendor', 'places-my.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(`states ${states.length}, districts ${districts.length}, places ${places.length}, ${Math.round(fs.statSync(file).size / 1024)} KB`);

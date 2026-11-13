// npm run release: set the service-worker cache name, APP_VERSION and every ?v= in app.html from package.json "version".
// "3.65.0" becomes 3.65 (major.minor). Bump package.json first (npm version minor --no-git-tag-version), then run this.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const full = require(path.join(root, 'package.json')).version;
const m = /^(\d+)\.(\d+)/.exec(full || '');
if (!m) { console.error('package.json has no "version" like 3.65.0'); process.exit(1); }
const v = `${m[1]}.${m[2]}`;
const edit = (file, re, to, what) => {
  const p = path.join(root, file), s = fs.readFileSync(p, 'utf8'), hits = (s.match(re) || []).length;
  if (!hits) { console.error(`Could not find ${what} in ${file}`); process.exit(1); }
  fs.writeFileSync(p, s.replace(re, to));
  console.log(`${file}: ${what} -> ${v} (${hits})`);
};
edit('sw.js', /const CACHE = 'allurus-v[\d.]+'/, `const CACHE = 'allurus-v${v}'`, 'CACHE');
edit('js/app.js', /const APP_VERSION = '[\d.]+'/, `const APP_VERSION = '${v}'`, 'APP_VERSION');
edit('app.html', /\?v=\d+(\.\d+)*(?=["'])/g, `?v=${v}`, 'every ?v=');

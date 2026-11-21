const fs = require('fs');
const path = '/d/dev/allurus-hr/js/ops.js';

// Read the file
const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

// Fix line 123 (index 122)
let line = lines[122];
const start = line.indexOf('`', 10);
const nextBacktick = line.indexOf('`', start + 1);
const thirdBacktick = line.indexOf('`', nextBacktick + 1);

// The nested template literal content
let nested = line.substring(nextBacktick + 1, thirdBacktick);

// Escape backslashes and single quotes
nested = nested.replace(/\/g, '\\');
nested = nested.replace(/'/g, "\'");

// Create a fixed version
const fixedNested = "'" + nested + "'";
const fixedLine = line.substring(0, nextBacktick) + fixedNested + line.substring(thirdBacktick + 1);

lines[122] = fixedLine;
fs.writeFileSync(path, lines.join('\n'));

console.log('Fixed line 123');

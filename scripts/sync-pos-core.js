// Cafe POS: the backend (apps-script/Code.gs) and the browser demo (pos/api-demo.js) share one business-logic
// file, pos/shared/pos-core.js. Apps Script needs a .gs extension, so this copies it byte for byte into
// apps-script/PosCore.gs; paste both files into the Apps Script project (see pos/README.md).
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'pos', 'shared', 'pos-core.js');
const dest = path.join(__dirname, '..', 'pos', 'apps-script', 'PosCore.gs');
fs.copyFileSync(src, dest);

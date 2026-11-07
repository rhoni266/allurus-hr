// Cafe POS: the single-cafe backend (apps-script/Code.gs), the central multi-company server
// (apps-script-server/Router.gs) and the browser demo (pos/api-demo.js) all share one business-logic file,
// pos/shared/pos-core.js. Apps Script needs a .gs extension, so this copies it byte for byte into both Apps
// Script projects' PosCore.gs; paste the whole folder's files into each project (see pos/README.md and
// docs/POS-LIVE-APPSCRIPT-SPEC.md).
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'pos', 'shared', 'pos-core.js');
[
  path.join(__dirname, '..', 'pos', 'apps-script', 'PosCore.gs'),
  path.join(__dirname, '..', 'pos', 'apps-script-server', 'PosCore.gs'),
].forEach((dest) => fs.copyFileSync(src, dest));

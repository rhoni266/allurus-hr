// pos/shared/pos-core.js is the one copy of the business logic. apps-script/PosCore.gs must be an exact copy of it
// (Apps Script needs the .gs extension; run `npm run sync-pos-core` after editing pos-core.js). This fails loudly if
// someone edits one and forgets the other, instead of the two quietly drifting apart.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('apps-script/PosCore.gs is byte for byte the same as shared/pos-core.js', () => {
  const core = fs.readFileSync(path.join(__dirname, '..', 'shared', 'pos-core.js'), 'utf8');
  const copy = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'PosCore.gs'), 'utf8');
  assert.equal(copy, core, 'Run `npm run sync-pos-core` and commit the result.');
});

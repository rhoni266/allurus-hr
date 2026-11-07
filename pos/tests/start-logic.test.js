// pos/start-logic.js: the access and already-on checks behind pos/start.html (GO-LIVE-POS.md step 2), the same
// shape as Provision.gs's own check and the server's posTrialOrActive_ - so the page never shows a form or a
// button the server would refuse anyway.
const test = require('node:test');
const assert = require('node:assert/strict');
const StartLogic = require('../start-logic.js');

test('canStartPosTrial: an Owner or a Settings admin only', () => {
  assert.equal(StartLogic.canStartPosTrial({ roles: ['admin', 'employee'] }), true); // Owner: no perms list
  assert.equal(StartLogic.canStartPosTrial({ roles: ['admin', 'employee'], perms: ['settings'] }), true);
  assert.equal(StartLogic.canStartPosTrial({ roles: ['admin', 'employee'], perms: ['payroll'] }), false);
  assert.equal(StartLogic.canStartPosTrial({ roles: ['employee'] }), false);
  assert.equal(StartLogic.canStartPosTrial(null), false);
});

test('posAlreadyOn: true once addons.pos has any status (trial or active); false otherwise', () => {
  assert.equal(StartLogic.posAlreadyOn(null), false);
  assert.equal(StartLogic.posAlreadyOn({}), false);
  assert.equal(StartLogic.posAlreadyOn({ addons: {} }), false);
  assert.equal(StartLogic.posAlreadyOn({ addons: { pos: { status: 'trial' } } }), true);
  assert.equal(StartLogic.posAlreadyOn({ addons: { pos: { status: 'active' } } }), true);
});

// pos/start.js's access and state checks, pulled out so they're testable without a browser or Firebase SDK
// (pos/tests/start-logic.test.js). Mirrors Provision.gs's own check and Router.gs's posTrialOrActive_, so the
// page's gate never shows a form the server would refuse anyway.
(function (root) {
  'use strict';

  /** Same check as Provision.gs's provisionCompany_: an Owner, or an admin with the Settings area. */
  function canStartPosTrial(profile) {
    if (!profile || !Array.isArray(profile.roles) || profile.roles.indexOf('admin') < 0) return false;
    var isOwner = !Array.isArray(profile.perms);
    return isOwner || profile.perms.indexOf('settings') >= 0;
  }

  /** Whether this tenant doc already has a POS addon on it (trial started or active) - the page shows "Open the
   * till" instead of the Start form once this is true, matching firestore.rules' once-only trial-start rule. */
  function posAlreadyOn(company) {
    var pos = company && company.addons && company.addons.pos;
    return !!(pos && pos.status);
  }

  var API = { canStartPosTrial: canStartPosTrial, posAlreadyOn: posAlreadyOn };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.AllurusPosStartLogic = API;
})(typeof window !== 'undefined' ? window : globalThis);

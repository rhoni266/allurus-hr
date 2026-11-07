// Starting (and, for a superadmin, extending) a company's cafe-POS trial (POS-LIVE-FLOW-SPEC.md section 1).
// Pure enough to unit test (tests/pos-trial.test.js): trialPayload() has no Firestore calls in it at all.
//
// NOT YET WIRED INTO A SCREEN. The "Try Allurus POS" dashboard card and "Start POS trial" dialog
// (POS-LIVE-FLOW-SPEC.md section 1) are still to build; until then an Owner or Settings admin starts a trial from
// the browser console: `await AllurusPosTrial.start(db, doc, setDoc, tenantId, uid)`. Logged in
// docs/AUTOPILOT-LOG.md as the next step.
(function (root) {
  'use strict';
  var Billing = root.AllurusBilling; // trialEnd() - same 30-day Malaysia-time math as the company's own trial

  /** The addons.pos value a "Start POS trial" write sets, matching firestore.rules' validated shape exactly. */
  function trialPayload(uid, now) {
    now = now || Date.now();
    return { status: 'trial', startedBy: uid, startedAt: new Date(now), trialEndsAt: Billing.trialEnd(now) };
  }

  var API = {
    trialPayload: trialPayload,
    // db/doc/setDoc: the Firestore v9 modular functions already imported by js/cloud.js (FS.doc, FS.updateDoc).
    // Call with an Owner or a Settings-area admin signed in; firestore.rules checks the rest.
    start: function (updateDoc, tenantDocRef, uid) {
      return updateDoc(tenantDocRef, { addons: { pos: trialPayload(uid) } });
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.AllurusPosTrial = API;
})(typeof window !== 'undefined' ? window : globalThis);

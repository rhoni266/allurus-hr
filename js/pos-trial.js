// Starting (and, for a superadmin, extending) a company's cafe-POS trial (POS-LIVE-FLOW-SPEC.md section 1,
// POS-LIVE-APPSCRIPT-SPEC.md section 4: client POS data is a Google Sheet via the central Apps Script server, not
// Firestore). Pure enough to unit test (tests/pos-trial.test.js): trialPayload() has no network calls in it.
//
// NOT YET WIRED INTO A SCREEN. The "Try Allurus POS" dashboard card and "Start POS trial" dialog
// (POS-LIVE-FLOW-SPEC.md section 1) are still to build; until then an Owner or Settings admin starts a trial from
// the browser console:
//   await AllurusPosTrial.start({ apiUrl: window.ALLURUS_POS_SERVER, idToken: await auth.currentUser.getIdToken(),
//     tenantId, uid, updateDoc, tenantDocRef, data: { outletName: 'My Cafe', sampleMenu: true } })
// Logged in docs/AUTOPILOT-LOG.md as the next step.
(function (root) {
  'use strict';
  var Billing = root.AllurusBilling; // trialEnd() - same 30-day Malaysia-time math as the company's own trial
  var fetchFn = root.fetch; // overridable (tests pass their own)

  /** The addons.pos value a "Start POS trial" write sets, matching firestore.rules' validated shape exactly. */
  function trialPayload(uid, now) {
    now = now || Date.now();
    return { status: 'trial', startedBy: uid, startedAt: new Date(now), trialEndsAt: Billing.trialEnd(now) };
  }

  /**
   * Calls the central Apps Script server's 'provision' action (pos/apps-script-server/Provision.gs): creates the
   * company's Google Sheet (or returns the existing one - safe to call twice). Same POST shape as pos/api-live.js.
   */
  function provision(opts) {
    return opts.fetch(opts.apiUrl, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ idToken: opts.idToken, tenantId: opts.tenantId, action: 'provision', data: opts.data || {} })
    }).then(function (res) { return res.text(); }).then(function (text) {
      var body = JSON.parse(text);
      if (!body.ok) throw new Error(body.error || 'Could not start the POS trial');
      return body.data; // { spreadsheetId, created }
    });
  }

  var API = {
    trialPayload: trialPayload,
    provision: provision,
    /**
     * The whole "Start POS trial" flow: provision the company's Sheet, then set addons.pos on the tenant doc.
     * opts: { apiUrl, idToken, tenantId, uid, data (outletName/sstRegistered/... - see Provision.gs),
     *         updateDoc, tenantDocRef, fetch? } - updateDoc/tenantDocRef: the Firestore v9 modular function and
     * doc ref js/cloud.js already has (FS.updateDoc, FS.doc(db, 'tenants', tenantId)). Call with an Owner or a
     * Settings-area admin signed in; firestore.rules checks the addons.pos write, Provision.gs checks the rest.
     */
    start: function (opts) {
      var doFetch = opts.fetch || fetchFn;
      return provision({ apiUrl: opts.apiUrl, idToken: opts.idToken, tenantId: opts.tenantId, data: opts.data, fetch: doFetch })
        .then(function (provisioned) {
          return opts.updateDoc(opts.tenantDocRef, { addons: { pos: trialPayload(opts.uid) } }).then(function () { return provisioned; });
        });
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.AllurusPosTrial = API;
})(typeof window !== 'undefined' ? window : globalThis);

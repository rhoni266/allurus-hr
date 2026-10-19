// MyInvois integration stub. Allurus builds and checks e-Invoice documents in the browser (js/einvoice-rules.js),
// but submitting them to LHDN must happen on a server, because it needs the company's client secret and, for
// document version 1.1, its digital signing certificate. Until that server exists, submitToMyInvois() reports
// that it is not connected, and the demo can simulate LHDN's answer so the statuses can be tried out.
window.AllurusMyInvois = (function () {
  'use strict';

  /*
   * How the server-side integration should work (FORMAT: verify every endpoint, field and limit against the LHDN
   * MyInvois SDK at sdk.myinvois.hasil.gov.my before production):
   *
   * 1. Sign in with OAuth 2.0 client credentials (the company's own ERP client, or an intermediary acting for it):
   *      POST {identity base}/connect/token
   *      Content-Type: application/x-www-form-urlencoded
   *      client_id=…&client_secret=…&grant_type=client_credentials&scope=InvoicingAPI
   *    An intermediary also sends the header onbehalfof: <taxpayer TIN>. Cache the access_token until it expires
   *    (expires_in seconds); never send the client secret to the browser.
   * 2. (Version 1.1) Sign the document: canonicalise the JSON, hash it, sign with the company certificate and add
   *    UBLExtensions and Signature to the document.
   * 3. Submit, up to the SDK's batch and size limits:
   *      POST {api base}/api/v1.0/documentsubmissions
   *      { "documents": [ { "format": "JSON", "documentHash": "<SHA-256 hex of the document>",
   *                         "codeNumber": "<invoice number>", "document": "<base64 of the document JSON>" } ] }
   *    The reply has submissionUid, acceptedDocuments [{ uuid, invoiceCodeNumber }] and rejectedDocuments
   *    [{ invoiceCodeNumber, error }].
   * 4. Poll GET /api/v1.0/documentsubmissions/{submissionUid} until each document is Valid or Invalid, then read
   *    GET /api/v1.0/documents/{uuid}/details for longId, validation results and dateTimeValidated.
   * 5. Cancel within 72 hours of validation:
   *      PUT /api/v1.0/documents/state/{uuid}/state   { "status": "cancelled", "reason": "…" }
   * 6. Store uuid, longId, submissionUid and the times on the Allurus invoice; print the validation link as a QR
   *    code on the invoice. Respect the API rate limits and retry with back-off.
   */

  // A server can plug in here: AllurusMyInvois.transport = async (doc, meta) => ({ ok, submissionUid, uuid, … }).
  let transport = null;

  /**
   * Submits a built e-Invoice document. Returns { ok, status, … }. Without a transport it does not call anything
   * and returns { ok: false, connected: false } so the screen can explain what is needed.
   */
  async function submitToMyInvois(doc, meta = {}) {
    if (typeof transport !== 'function') {
      return { ok: false, connected: false, message: 'Allurus is not connected to MyInvois yet. A server needs the company’s MyInvois client ID and secret (and a signing certificate for version 1.1).' };
    }
    return transport(doc, meta);
  }
  /** Cancels a valid e-Invoice within 72 hours. Same stub rules as submitToMyInvois. */
  async function cancelOnMyInvois(uuid, reason) {
    if (typeof transport !== 'function') return { ok: false, connected: false, message: 'Not connected to MyInvois yet.' };
    return transport({ cancel: uuid, reason }, { action: 'cancel' });
  }
  // Demo only: what LHDN might answer, so the statuses, UUID and validation link can be tried without the API.
  function simulate({ valid = true, now = new Date().toISOString(), seed = '' } = {}) {
    // A small deterministic generator: different salts give different IDs for the same document and time.
    let h = 2166136261;
    for (const ch of `${seed}|${now}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const rand = (n, salt) => { let x = (h ^ Math.imul(salt + 1, 2654435761)) >>> 0; return Array.from({ length: n }, () => { x = Math.imul(x ^ (x >>> 15), 2246822507) >>> 0; x = (x ^ (x >>> 13)) >>> 0; return 'ABCDEFGHJKMNPQRSTVWXYZ0123456789'[x % 32]; }).join(''); };
    if (!valid) return { ok: true, simulated: true, status: 'Rejected', submissionUid: rand(26, 1), submittedAt: now, errors: [{ code: 'CF321', message: 'Simulated: the buyer TIN does not match the ID number (example of an LHDN validation error).' }] };
    return { ok: true, simulated: true, status: 'Valid', submissionUid: rand(26, 1), uuid: rand(26, 2), longId: rand(40, 3), submittedAt: now, validatedAt: now };
  }

  return {
    submitToMyInvois, cancelOnMyInvois, simulate,
    get connected() { return typeof transport === 'function'; },
    set transport(fn) { transport = fn; },
  };
})();

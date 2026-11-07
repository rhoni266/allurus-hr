// The Allurus POS Server's web app URL (pos/apps-script-server/, POS-LIVE-APPSCRIPT-SPEC.md): one Apps Script
// project, deployed as a web app, that holds every company's POS Google Sheet. Not a secret - every call needs a
// valid Allurus sign-in (the server checks the caller's Firebase ID token itself) - so this is committed, the
// same as js/firebase-config.js.
//
// PLACEHOLDER: the owner deploys pos/apps-script-server/ (Deploy > New deployment > Web app) and pastes the
// resulting /exec URL in here. Until then this stays null and /pos shows "POS server not configured" instead of
// a dead till (see pos/api-live.js).
window.ALLURUS_POS_SERVER = null;

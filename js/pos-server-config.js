// The Allurus POS Server's web app URL (pos/apps-script-server/, POS-LIVE-APPSCRIPT-SPEC.md): one Apps Script
// project, deployed as a web app, that holds every company's POS Google Sheet. Not a secret - every call needs a
// valid Allurus sign-in (the server checks the caller's Firebase ID token itself) - so this is committed, the
// same as js/firebase-config.js.
//
// Deployed 2026-11-07 (docs/POS-SERVER-DEPLOYED.md): "Allurus POS Server" v1, Execute as Me, Who has access:
// Anyone. Any later change to the server files needs a new version at this same URL (Deploy > Manage deployments
// > edit > Version: New version) - this value doesn't change then.
window.ALLURUS_POS_SERVER = 'https://script.google.com/macros/s/AKfycbxgCJliuxFxZhuFOPz51nV8EhmZzdEyM8TDHi3vsKxvlKDYrbq1hitV0uFAoFlkcCf9bw/exec';

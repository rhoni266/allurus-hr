// Shared Firebase Admin setup for the scripts in this folder. Uses a service-account key kept on this computer only:
// scripts/serviceAccount.json (git-ignored), or the path in GOOGLE_APPLICATION_CREDENTIALS.
// Get the key: Firebase console → Project settings → Service accounts → Generate new private key.
const fs = require('fs');
const path = require('path');

function admin() {
  let lib;
  try { lib = require('firebase-admin'); } catch (e) {
    console.error('firebase-admin is not installed. Run: npm install');
    process.exit(1);
  }
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'serviceAccount.json');
  if (!fs.existsSync(keyPath)) {
    console.error(`No service-account key at ${keyPath}.\nFirebase console → Project settings → Service accounts → Generate new private key, then save it as scripts/serviceAccount.json.`);
    process.exit(1);
  }
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  if (key.project_id !== 'allurus-hr') console.warn(`Warning: this key is for project ${key.project_id}, not allurus-hr.`);
  if (!lib.apps.length) lib.initializeApp({ credential: lib.credential.cert(key) });
  return lib;
}

module.exports = { admin };

// Copy this file to config.js and fill in the two values from the Apps Script setup.
// config.js is git-ignored so your key never gets committed.
window.POS_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/PASTE_YOUR_DEPLOYMENT_ID/exec', // Deploy > Web app URL
  SECRET_KEY: 'PASTE_THE_SAME_VALUE_AS_SCRIPT_PROPERTY_SECRET_KEY',

  BUSINESS_NAME: 'My Cafe',
  RECEIPT_FOOTER: 'Thank you! See you again.',
  // Shown on screen only. The server's Script Properties (SST_PERCENT, SERVICE_PERCENT) decide what is charged,
  // so keep these the same.
  SST_PERCENT: 0,
  SERVICE_PERCENT: 0, // dine-in only
  DEVICE_ID: 'till-1',
  CURRENCY: 'RM',
  TIMEZONE: 'Asia/Kuala_Lumpur',
  TIMEOUT_MS: 20000 // Apps Script usually answers in 1-2 s; give slow networks room
};

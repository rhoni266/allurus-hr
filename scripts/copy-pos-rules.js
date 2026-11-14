// Before deploying functions: the server uses the same POS rules as the browser (js/pos-rules.js).
const fs = require('fs');
const path = require('path');
for (const f of ['pos-rules.js', 'ledger-rules.js']) fs.copyFileSync(path.join(__dirname, '..', 'js', f), path.join(__dirname, '..', 'functions', f));   // ledger-rules.js: the balance rule for general entries

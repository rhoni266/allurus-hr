// Before deploying functions: the server uses the same POS rules as the browser (js/pos-rules.js).
const fs = require('fs');
const path = require('path');
fs.copyFileSync(path.join(__dirname, '..', 'js', 'pos-rules.js'), path.join(__dirname, '..', 'functions', 'pos-rules.js'));

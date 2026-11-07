/** One-time setup for the Allurus POS Server (GO-LIVE-POS.md step 4). Run setupServer() once from the editor.
 * Safe to run again: it reuses the folders, registry and settings it already made. */
function setupServer() {
  var props = PropertiesService.getScriptProperties();
  function folder(key, name) {
    var id = props.getProperty(key);
    if (id) { try { DriveApp.getFolderById(id); return id; } catch (e) {} }
    var it = DriveApp.getFoldersByName(name);
    var f = it.hasNext() ? it.next() : DriveApp.createFolder(name);
    props.setProperty(key, f.getId());
    return f.getId();
  }
  folder('CLIENTS_FOLDER_ID', 'Allurus POS clients');
  folder('BACKUPS_FOLDER_ID', 'Allurus POS backups');
  var ss = null, regId = props.getProperty('REGISTRY_ID');
  if (regId) { try { ss = SpreadsheetApp.openById(regId); } catch (e) { ss = null; } }
  if (!ss) { ss = SpreadsheetApp.create('Allurus POS Registry'); props.setProperty('REGISTRY_ID', ss.getId()); }
  var sh = ss.getSheetByName('Registry');
  if (!sh) { sh = ss.getSheets()[0]; sh.setName('Registry'); }
  var head = ['tenantId', 'spreadsheetId', 'outletName', 'createdAt', 'createdByUid', 'status', 'lastSaleAt'];
  if (sh.getLastRow() === 0) { sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold'); sh.setFrozenRows(1); }
  if (!props.getProperty('FIREBASE_PROJECT_ID')) props.setProperty('FIREBASE_PROJECT_ID', 'allurus-hr');
  // The Allurus web app's public Firebase Web API key (the same one in js/firebase-config.js).
  if (!props.getProperty('FIREBASE_API_KEY')) props.setProperty('FIREBASE_API_KEY', 'AIzaSyCfMGQRT4zjtjJk4oyU3olxlfq-iU8_7EQ');
  installTriggers();
  console.log('Allurus POS Server ready. Registry: ' + ss.getUrl());
}

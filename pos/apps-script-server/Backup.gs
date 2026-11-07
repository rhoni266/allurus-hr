/**
 * Nightly backup of every company's POS Sheet (POS-LIVE-APPSCRIPT-SPEC.md section 6): copies each into Drive
 * folder "Allurus POS backups/<tenantId>", keeps the newest 30. Runs in batches with a saved position (a Script
 * Property) so one run stays comfortably under the 6-minute execution limit and the daily trigger-time budget,
 * continuing where it left off the next night if the registry is large.
 *
 * Run installTriggers() once from the script editor (or ask clasp to run it after a push). Run backupAll()
 * directly from the editor to force a backup right now, bypassing the batch/position machinery (anyBatchSize).
 */

var BACKUP_BATCH_SIZE = 25; // companies per run; tune once there's a real registry to measure against
var BACKUP_POSITION_KEY = 'BACKUP_POSITION';
var BACKUP_KEEP = 30;

/** The nightly trigger's handler. Backs up BACKUP_BATCH_SIZE companies starting where the last run left off. */
function nightlyBackup() { backupBatch_(BACKUP_BATCH_SIZE); }

/** From the script editor: backs up every company in the registry in one call (fine for a small registry; for a
 * large one prefer letting nightlyBackup() work through it over a few nights, or raise BACKUP_BATCH_SIZE). */
function backupAll() { backupBatch_(Infinity); }

function backupBatch_(limit) {
  var folderId = PropertiesService.getScriptProperties().getProperty('BACKUPS_FOLDER_ID');
  if (!folderId) { console.error('BACKUPS_FOLDER_ID not set; skipping backup'); return; }
  var rows = RegistryHost.rows().filter(function (r) { return r.status !== 'removed'; });
  if (!rows.length) return;
  var pos = Number(PropertiesService.getScriptProperties().getProperty(BACKUP_POSITION_KEY) || 0) % rows.length;
  var done = 0;
  var missed = [];
  while (done < Math.min(limit, rows.length)) {
    var row = rows[pos];
    try { backupOne_(row, folderId); } catch (e) { console.error('backup failed for ' + row.tenantId + ': ' + e); missed.push(row.tenantId); }
    pos = (pos + 1) % rows.length;
    done++;
    if (pos === 0) break; // one full lap of the registry; don't wrap around and start a second lap in one run
  }
  PropertiesService.getScriptProperties().setProperty(BACKUP_POSITION_KEY, String(pos));
  if (missed.length) console.error('companies not backed up this run: ' + missed.join(', '));
}

function backupOne_(row, rootFolderId) {
  var root = DriveApp.getFolderById(rootFolderId);
  var it = root.getFoldersByName(row.tenantId);
  var folder = it.hasNext() ? it.next() : root.createFolder(row.tenantId);
  var src = DriveApp.getFileById(row.spreadsheetId);
  src.makeCopy(row.outletName + ' backup ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmm'), folder);
  var files = [];
  var f = folder.getFiles();
  while (f.hasNext()) files.push(f.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(BACKUP_KEEP).forEach(function (x) { x.setTrashed(true); });
}

/** Run once (or again after a code change; it clears any existing backupSheet trigger first). */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'nightlyBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('nightlyBackup').timeBased().everyDays(1).atHour(2).inTimezone(TZ).create();
}

/**
 * النسخة الاحتياطية اليومية لشجرة العائلة إلى Google Drive
 * Daily backup of the family tree to the owner's own Google Drive.
 *
 * Where it runs: Google Apps Script, inside YOUR Google account (script.google.com). Nothing here is secret:
 * the address and the key below are the public ones of the site (js/config.js). The secret is the BACKUP TOKEN,
 * which you keep only in Project settings -> Script properties -> BACKUP_TOKEN (see supabase/019_backup.sql).
 *
 * What it does every day (backupNow):
 *   1. asks the database for the backup (read-only: backup_export(token)),
 *   2. writes it to a NEW file in the Drive folder FOLDER_NAME,
 *   3. only then moves the older backup files to the Drive trash (Drive empties its trash after 30 days).
 * If anything fails (no connection, a revoked token, an empty answer) nothing is deleted: the last good file stays.
 * The same call is also a daily visit to the database, which keeps a free Supabase project from being paused.
 */

const SUPABASE_URL = 'https://dkepvzpayquwgmkabutx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kSHO3_NvVdi-E1xvJGIzTA_-9XW9uIs'; // the public key of the site
const FOLDER_NAME = 'نسخ شجرة آل هرموش الاحتياطية';
const FILE_PREFIX = 'نسخة-الشجرة-';
const KEEP = 7; // how many backup files to keep: the newest 7 (a week). 1 would keep only the newest.

function backupNow() {
  const raw = PropertiesService.getScriptProperties().getProperty('BACKUP_TOKEN');
  if (!raw) throw new Error('BACKUP_TOKEN is not set (Project settings -> Script properties).');
  // a copy often carries a space, a line break or quotation marks: they are removed
  const token = raw.replace(/[\s"'“”‘’]/g, '');
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    throw new Error('BACKUP_TOKEN is not a token of 64 letters and digits (yours has ' + token.length + '). Copy it again from the result of make_backup_token.');
  }

  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/backup_export', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
    payload: JSON.stringify({ p_token: token }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('The backup was refused: HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));

  const text = res.getContentText();
  const data = JSON.parse(text);
  if (!data || data.format !== 'family-tree-export' || !Array.isArray(data.persons) || data.persons.length === 0) {
    throw new Error('The answer is not a backup of a tree with people: nothing was changed.');
  }

  const folder = getFolder_();
  const stamp = Utilities.formatDate(new Date(), 'Etc/UTC', "yyyy-MM-dd'_'HH-mm'_UTC'");
  const file = folder.createFile(FILE_PREFIX + stamp + '.json', text, 'application/json');

  // the older ones go only after the new one is safely written
  const old = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(FILE_PREFIX) === 0 && f.getId() !== file.getId()) old.push(f);
  }
  old.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  old.slice(Math.max(0, KEEP - 1)).forEach(function (f) { f.setTrashed(true); });

  console.log('Backup saved: ' + file.getName() + ' (' + data.persons.length + ' persons, ' + (data.marriages || []).length + ' marriages)');
}

/** Run once: the backup then runs by itself every day (around 3 a.m. of the script's time zone). */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'backupNow') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backupNow').timeBased().everyDays(1).atHour(3).create();
  console.log('The daily backup is set.');
}

function getFolder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

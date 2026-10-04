// The daily backup: the document the database hands out must stay importable by the program, and the scripts must
// keep carrying only public values. (The database side is tested by supabase/019_test.sql.)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FORMAT, VERSION, fromJson } from '../js/transfer.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const sql = read('supabase/019_backup.sql');
const gs = read('tools/backup/drive-backup.gs');
const wf = read('.github/workflows/keepalive.yml');

// the SQL names the same format and version as the program
assert.ok(sql.includes(`'format', '${FORMAT}'`), 'the backup has the format of the program');
assert.ok(new RegExp(`'version', ${VERSION}[^0-9]`).test(sql), 'the backup has the version of the program');
assert.ok(gs.includes(`'${FORMAT}'`), 'the script checks the same format');

// a document shaped like the one backup_export returns is read by the importer (the extra part is ignored)
const doc = {
  format: FORMAT,
  version: VERSION,
  exportedAt: '2026-10-04T03:00:00Z',
  treeName: 'شجرة',
  persons: [
    { id: 'a', first_name: 'جد', last_name: 'هرموش', gender: 'male', father_id: null, mother_id: null, birth_date: '1900', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', photo_url: null },
    { id: 'b', first_name: 'ابن', last_name: 'هرموش', gender: 'male', father_id: 'a', mother_id: null, birth_date: '1930', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', photo_url: null },
  ],
  marriages: [{ id: 'm', person_a: 'a', person_b: 'c', marriage_date: null, status: 'married', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }],
  extra: { members: [], comments: [], messages: [], card_info: [], branch_grants: [], tree: { name: 'شجرة' } },
};
const model = fromJson(JSON.stringify(doc));
assert.equal(model.persons.length, 2);
assert.equal(model.persons[1].father_key, 'a');
assert.equal(model.marriages.length, 1);

// nothing secret is written in the script or in the workflow: only the public address and key of the site
for (const [name, text] of [['script', gs], ['workflow', wf]]) {
  assert.ok(!/service_role|sb_secret|password|BACKUP_TOKEN\s*=\s*['"][0-9a-f]{20,}/i.test(text), `no secret in the ${name}`);
}
assert.ok(/getProperty\('BACKUP_TOKEN'\)/.test(gs), 'the token is read from the script properties');
assert.ok(/KEEP\s*=\s*1\b/.test(gs), 'the default keeps only the newest backup, as asked');
assert.ok(/setTrashed\(true\)/.test(gs) && gs.indexOf('createFile') < gs.indexOf('setTrashed'), 'the old files go only after the new one is written');
assert.ok(/cron: '\d+ \d+ \* \* \*'/.test(wf), 'the workflow runs daily');

console.log('BACKUP OK');

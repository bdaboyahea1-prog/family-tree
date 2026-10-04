// The daily backup: the document the database hands out must stay importable by the program, and the scripts must
// keep carrying only public values. (The database side is tested by supabase/019_test.sql.)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FORMAT, VERSION, fromJson, planImport, cleanSettings } from '../js/transfer.js';

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
assert.ok(/KEEP *= *7[^0-9]/.test(gs), 'the script keeps a week of backups (the user chose 7)');
assert.ok(/setTrashed\(true\)/.test(gs) && gs.indexOf('createFile') < gs.indexOf('setTrashed'), 'the old files go only after the new one is written');
assert.ok(/cron: '\d+ \d+ \* \* \*'/.test(wf), 'the workflow runs daily');

// the information tables of the women's cards come back too: tied to the NEW id of the woman; rows about a man, of an unknown kind or without a name are left out
const withInfo = {
  ...doc,
  persons: [...doc.persons, { id: 'c', first_name: 'أم', last_name: 'هرموش', gender: 'female', father_id: null, mother_id: null }],
  extra: {
    ...doc.extra,
    card_info: [
      { id: 'i1', person_id: 'c', kind: 'son', first_name: 'ماجد', last_name: 'الحربي', birth_date: '1970', is_deceased: false, birth_country: 'SA', phone: '+000 111 222 777', email: 'not-an-email', notes: 'ملاحظة' },
      { id: 'i2', person_id: 'c', kind: 'daughter', first_name: 'سلمى', death_date: '2020', is_deceased: true },
      { id: 'i3', person_id: 'a', kind: 'son', first_name: 'رجل' }, // about a man
      { id: 'i4', person_id: 'c', kind: 'cousin', first_name: 'قريب' }, // an unknown kind
      { id: 'i5', person_id: 'c', kind: 'spouse', first_name: '' }, // no name
      { id: 'i6', person_id: 'zzz', kind: 'son', first_name: 'تائه' }, // her card is not in the file
    ],
  },
};
let counter = 0;
const plan = planImport(fromJson(JSON.stringify(withInfo)), () => `id${++counter}`);
assert.equal(plan.stats.persons, 3);
assert.equal(plan.infoRows.length, 2, 'two usable information rows');
assert.equal(plan.stats.info, 2);
assert.ok(plan.infoRows.every((r) => r.person_id === 'id3'), 'tied to the new id of the woman');
assert.equal(plan.infoRows[0].email, null, 'an invalid e-mail is dropped, the row stays');
assert.equal(plan.infoRows[0].phone, '+000 111 222 777');
assert.equal(plan.infoRows[1].is_deceased, true);
assert.ok(plan.warnings.some((w) => w.includes('أُهمل')), 'the skipped rows are reported');
// a file without the information part (the older backups, GEDCOM) still imports as before
assert.equal(planImport(fromJson(JSON.stringify(doc))).infoRows.length, 0);

// the settings of the tree in the backup (extra.tree) come back: only valid keys, only what the admin may write
const settingsDoc = {
  ...doc,
  extra: { ...doc.extra, tree: { name: ' شجرة آل هرموش ', about: { intro: 'نبذة' }, female_card_mode: 'info', public_page: true, public_show_living: false, default_look: { cardStyle: 'portrait' }, created_at: '2026-01-01' } },
};
const sp = planImport(fromJson(JSON.stringify(settingsDoc)));
assert.deepEqual(sp.settings, { name: 'شجرة آل هرموش', about: { intro: 'نبذة' }, female_card_mode: 'info', public_page: true, public_show_living: false, default_look: { cardStyle: 'portrait' } });
assert.equal(sp.stats.settings, 6, 'created_at is not a setting');
// bad values are dropped one by one; a null look / about means «none» and is kept
assert.deepEqual(cleanSettings({ name: '', female_card_mode: 'everyone', public_page: 'yes', about: [], default_look: null }), { default_look: null });
assert.deepEqual(cleanSettings({ name: 'x'.repeat(101), about: null }), { about: null });
assert.deepEqual(cleanSettings(null), {});
assert.deepEqual(cleanSettings({ default_look: { big: 'y'.repeat(2500) } }), {}, 'a look that is too big is dropped');
// an older backup without the settings imports as before
assert.deepEqual(planImport(fromJson(JSON.stringify({ ...doc, extra: undefined }))).settings, {});
// the daily backup of the database carries the same keys the importer reads
for (const key of ['name', 'about', 'female_card_mode', 'public_page', 'public_show_living', 'default_look']) assert.ok(sql.includes(`'${key}'`), `019_backup.sql carries ${key}`);

console.log('BACKUP OK');

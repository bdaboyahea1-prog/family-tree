// The nickname ("اللقب المشتهر به"): found by the search, written in the Excel files, kept by the backups.
import assert from 'node:assert/strict';
import { buildIndex, search, layout, buildHierarchy, SIZE } from '../js/tree.js';
import { personCells, PERSON_HEAD, treeSheets } from '../js/exports.js';
import { toJson, fromJson, toGedcom, fromGedcom, planImport } from '../js/transfer.js';

let n = 0;
const P = (id, first, o = {}) => ({
  id, first_name: first, last_name: 'الراشد', gender: 'male', father_id: null, mother_id: null, birth_date: null, birth_place: null,
  residence_country: null, residence_city: null, is_deceased: false, death_date: null, notes: null, created_at: String(++n).padStart(4, '0'), ...o,
});
const persons = [
  P('a', 'عبدالله', { nickname: 'أبو محمد' }),
  P('b', 'خالد', { father_id: 'a', nickname: 'الحاج' }),
  P('c', 'سعيد', { father_id: 'a' }),
];
const ix = buildIndex(persons, []);

// ---------- search ----------
assert.deepEqual(search(ix, 'أبو محمد').map((p) => p.id), ['a'], 'the nickname finds the person');
assert.deepEqual(search(ix, 'الحاج').map((p) => p.id), ['b']);
assert.deepEqual(search(ix, 'سعيد').map((p) => p.id), ['c'], 'a person without one is still found by name');

// ---------- Excel ----------
assert.equal(PERSON_HEAD[2], 'اللقب المشتهر به');
assert.equal(personCells(persons[0])[2], 'أبو محمد');
assert.equal(personCells(persons[2])[2], '', 'no nickname: an empty cell');
assert.equal(PERSON_HEAD.length, personCells(persons[0]).length);
const sheets = treeSheets(ix, persons);
const head = sheets[0].rows[0];
assert.ok(head.includes('اللقب المشتهر به'), 'the list of people has the column');
const col = head.indexOf('اللقب المشتهر به');
assert.equal(sheets[0].rows[1][col], 'أبو محمد');
assert.equal(sheets[0].widths.length, head.length, 'one width per column');

// ---------- the backup file (JSON) ----------
const json = toJson(persons, []);
assert.equal(json.persons[0].nickname, 'أبو محمد');
assert.equal(json.persons[2].nickname, null);
const model = fromJson(JSON.stringify(json));
let seq = 0;
const plan = planImport(model, () => 'n' + ++seq);
const byName = (rows, name) => rows.find((r) => r.first_name === name);
assert.equal(byName(plan.personRows, 'عبدالله').nickname, 'أبو محمد', 'it survives a restore');
assert.ok(!('nickname' in byName(plan.personRows, 'سعيد')), 'empty: the key is not sent at all');
const longJson = JSON.parse(JSON.stringify(json));
longJson.persons[0].nickname = 'ن'.repeat(150);
const longPlan = planImport(fromJson(JSON.stringify(longJson)), () => 'l' + ++seq);
assert.equal(byName(longPlan.personRows, 'عبدالله').nickname.length, 100, 'cut to the limit of the database');

// ---------- GEDCOM ----------
const ged = toGedcom(persons, []);
assert.ok(/\r?\n2 NICK أبو محمد\r?\n/.test(ged), 'written under the NAME');
const back = fromGedcom(ged);
const gm = back.persons;
assert.equal(gm.find((p) => p.first_name === 'عبدالله').nickname, 'أبو محمد');
assert.equal(gm.find((p) => p.first_name === 'سعيد').nickname, null);

// ---------- the card is as tall as the layout says ----------
const root = buildHierarchy(ix, 'a', new Set());
const small = layout(root, { size: SIZE });
const tall = layout(root, { size: { ...SIZE, cardH: SIZE.cardH + 46 } });
assert.equal(small.cards[0].h, SIZE.cardH);
assert.equal(tall.cards[0].h, SIZE.cardH + 46);
assert.equal(tall.cards[1].y - tall.cards[0].y, SIZE.cardH + 46 + SIZE.vGap, 'the rows move apart by the taller card');

console.log('NICKNAME OK');

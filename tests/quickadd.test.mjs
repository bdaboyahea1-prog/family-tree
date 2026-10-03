import assert from 'node:assert/strict';
import { buildIndex } from '../js/tree.js';
import { planQuickAdd, linkNewSpouse, cleanName, blankRow, blankExtra, rowFromInfo, spouseKindLabel } from '../js/quickadd.js';

const mk = (id, first, o = {}) => ({ id, first_name: first, last_name: 'الراشد', gender: 'male', father_id: null, mother_id: null, birth_date: null, created_at: id, ...o });
const people = [mk('f', 'يحيى'), mk('w1', 'نهى', { gender: 'female', last_name: 'زرابة' }), mk('w2', 'سعاد', { gender: 'female', last_name: null }), mk('m', 'فاطمة', { gender: 'female', last_name: 'مكية' }), mk('lone', 'علي')];
const marriages = [
  { id: 'x1', person_a: 'f', person_b: 'w1', created_at: '1' },
  { id: 'x2', person_a: 'lone', person_b: 'm', created_at: '2' },
  { id: 'x3', person_a: 'lone', person_b: 'w2', created_at: '3' },
];
const ix = buildIndex(people, marriages);
const man = ix.byId.get('f'); // one wife
const row = (kind, name, birth = '', death = '', other = '') => ({ kind, name, birth, death, other });

// ---------- names ----------
assert.equal(cleanName('  علي   الراشد ', 'الراشد'), 'علي', 'inherited family name is dropped');
assert.equal(cleanName('الراشد', 'الراشد'), 'الراشد', 'a name that IS the family name stays');
assert.equal(cleanName('عبد الله', 'الراشد'), 'عبد الله', 'a two-word given name is kept whole');
assert.equal(cleanName('نهى زرابة', null), 'نهى زرابة');
assert.equal(spouseKindLabel(man), 'زوجة');
assert.equal(spouseKindLabel(ix.byId.get('m')), 'زوج');
assert.deepEqual(blankRow(), { kind: 'son', name: '', birth: '', death: '', other: '', extra: null, photo: null, id: null });

// ---------- a man with one wife: children get her as their mother ----------
let r = planQuickAdd(ix, man, [row('son', 'عبد الله', '2016-03-01'), row('daughter', 'تولين الراشد', '2019'), row('son', '', '', '')]);
assert.deepEqual(r.errors, []);
assert.equal(r.items.length, 2, 'the empty line is skipped');
const NO_DETAILS = { birth_place: null, birth_country: null, birth_province: null, birth_city: null, residence_country: null, residence_province: null, residence_city: null, phone: null, email: null, notes: null };
assert.deepEqual(r.items[0], { row: 1, kind: 'son', id: null, photo: null, marriage: false, otherRow: null, person: { first_name: 'عبد الله', last_name: 'الراشد', gender: 'male', birth_date: '2016-03-01', is_deceased: false, death_date: null, ...NO_DETAILS, father_id: 'f', mother_id: 'w1' } });
assert.equal(r.items[1].person.first_name, 'تولين', 'the inherited family name is stripped');
assert.equal(r.items[1].person.gender, 'female');
assert.equal(r.items[1].person.mother_id, 'w1');

// a death date makes them deceased
r = planQuickAdd(ix, man, [row('son', 'خالد', '1950', '2010')]);
assert.equal(r.items[0].person.is_deceased, true);
assert.equal(r.items[0].person.death_date, '2010');

// ---------- a man with two wives: the line must say which ----------
const two = ix.byId.get('lone');
r = planQuickAdd(ix, two, [row('son', 'أ')]);
assert.deepEqual(r.items[0].person.mother_id, null, 'no wife chosen -> unknown mother');
r = planQuickAdd(ix, two, [row('son', 'أ', '', '', 'w2'), row('daughter', 'ب', '', '', 'm')]);
assert.deepEqual(r.items.map((i) => i.person.mother_id), ['w2', 'm']);
r = planQuickAdd(ix, two, [row('son', 'أ', '', '', 'w1')]);
assert.deepEqual(r.errors, [{ row: 1, message: 'اختر الأم من القائمة' }], 'only his own wives are accepted');

// ---------- a woman's card: father from the husband, no family name inherited ----------
const woman = ix.byId.get('w1');
r = planQuickAdd(ix, woman, [row('daughter', 'سلمى', '2020')]);
assert.equal(r.items[0].person.last_name, null);
assert.equal(r.items[0].person.mother_id, 'w1');
assert.equal(r.items[0].person.father_id, 'f', 'her only husband');

// ---------- wives ----------
r = planQuickAdd(ix, man, [row('spouse', 'منى زرابة', '1991')]);
assert.equal(r.items[0].marriage, true);
assert.equal(r.items[0].person.gender, 'female');
assert.equal(r.items[0].person.last_name, null);
assert.equal(r.items[0].person.first_name, 'منى زرابة');
r = planQuickAdd(ix, woman, [row('spouse', 'محمد')]);
assert.equal(r.items[0].person.gender, 'male', 'a husband for a woman');

// a person with nobody yet: a wife and children in the same table -> the children take her
const single = ix.byId.get('m');
const alone = buildIndex([mk('p', 'سالم')], []);
const sp = alone.byId.get('p');
r = planQuickAdd(alone, sp, [row('son', 'ابن أول'), row('spouse', 'هدى'), row('daughter', 'ابنة')]);
assert.deepEqual(r.items.map((i) => i.row), [2, 1, 3], 'wives first, then in typed order');
assert.deepEqual(r.items.map((i) => i.otherRow), [null, 2, 2]);
const ids = new Map([[2, 'NEW']]);
assert.equal(linkNewSpouse(r.items[1], sp, ids).mother_id, 'NEW');
assert.equal(linkNewSpouse(r.items[1], sp, ids).father_id, 'p');
assert.deepEqual(linkNewSpouse(r.items[0], sp, ids), r.items[0].person, 'a wife line is returned unchanged');
// two wives typed and no choice -> no automatic mother
r = planQuickAdd(alone, sp, [row('spouse', 'أ'), row('spouse', 'ب'), row('son', 'ج')]);
assert.equal(r.items.find((i) => i.row === 3).otherRow, null);

// ---------- mistakes ----------
r = planQuickAdd(ix, man, [row('son', '', '2010'), row('daughter', 'ب', 'x'.repeat(41)), row('', 'ج'), row('son', 'ن'.repeat(101))]);
assert.deepEqual(r.errors.map((e) => [e.row, e.message]), [[1, 'الاسم مطلوب'], [2, 'التاريخ أطول من المسموح'], [3, 'اختر القرابة'], [4, 'الاسم أطول من المسموح']]);
assert.deepEqual(r.items, []);
r = planQuickAdd(ix, man, [row('son', 'أ'), row('spouse', 'ب')], { canChild: false, canSpouse: true });
assert.deepEqual(r.errors.map((e) => e.row), [1]);
assert.equal(r.items.length, 1);
r = planQuickAdd(ix, man, [row('spouse', 'ب')], { canSpouse: false });
assert.ok(r.errors[0].message.includes('زوجة'));
assert.deepEqual(planQuickAdd(ix, man, []), { items: [], errors: [] });
assert.deepEqual(planQuickAdd(ix, man, [blankRow(), blankRow('daughter')]), { items: [], errors: [] }, 'only empty lines: nothing to do');

// ---------- every detail of a card ----------
{
  const x = { ...blankExtra(), last_name: ' العتيبي ', phone: '+49 170 1234567', email: 'Ali@Example.com', notes: ' ملاحظة ', birth_place: 'مستشفى الأسد', birth_country: 'SY', birth_province: 'اللاذقية', birth_city: 'جبلة', residence_country: 'DE', residence_province: 'Berlin', residence_city: 'Berlin' };
  const blob = { fake: 'photo' };
  const r2 = planQuickAdd(ix, man, [{ ...blankRow('daughter'), name: 'ريم', birth: '1990', extra: x, photo: blob }]);
  assert.deepEqual(r2.errors, []);
  const p = r2.items[0].person;
  assert.equal(p.last_name, 'العتيبي', 'a typed family name wins over the father\'s');
  assert.equal(p.phone, '+49 170 1234567');
  assert.equal(p.email, 'ali@example.com', 'e-mail in lower case');
  assert.equal(p.notes, 'ملاحظة');
  assert.deepEqual([p.birth_country, p.birth_province, p.birth_city, p.birth_place], ['SY', 'اللاذقية', 'جبلة', 'مستشفى الأسد']);
  assert.deepEqual([p.residence_country, p.residence_province, p.residence_city], ['DE', 'Berlin', 'Berlin']);
  assert.equal(r2.items[0].photo, blob, 'the photo travels with its line');
  // "deceased" without a date
  const r3 = planQuickAdd(ix, man, [{ ...blankRow(), name: 'قديم', extra: { ...blankExtra(), deceased: true } }]);
  assert.equal(r3.items[0].person.is_deceased, true);
  assert.equal(r3.items[0].person.death_date, null);
  // a line that has only details (no name) is a mistake, not an empty line
  const r4 = planQuickAdd(ix, man, [{ ...blankRow(), extra: { ...blankExtra(), phone: '+49 170 1234567' } }]);
  assert.deepEqual(r4.errors, [{ row: 1, message: 'الاسم مطلوب' }]);
  const r5 = planQuickAdd(ix, man, [{ ...blankRow(), extra: blankExtra() }]);
  assert.deepEqual(r5, { items: [], errors: [] }, 'untouched details do not count');
  // bad details
  const bad = (extra) => planQuickAdd(ix, man, [{ ...blankRow(), name: 'ن', extra: { ...blankExtra(), ...extra } }]).errors.map((e) => e.message);
  assert.deepEqual(bad({ phone: '0111abc' }), ['رقم الهاتف غير صالح']);
  assert.deepEqual(bad({ email: 'x@' }), ['البريد الإلكتروني غير صالح']);
  assert.deepEqual(bad({ notes: 'ن'.repeat(2001) }), ['الملاحظات أطول من المسموح']);
  assert.deepEqual(bad({ last_name: 'ن'.repeat(101) }), ['اللقب أطول من المسموح']);
}

// ---------- the information table of a woman ----------
{
  const woman = ix.byId.get('m'); // فاطمة: married to lone, two husbands' wives... only the card matters here
  const rows = [
    { ...blankRow('son'), name: 'عمر', birth: '2010', extra: { ...blankExtra(), birth_city: 'جبلة', birth_country: 'SY' } },
    { ...blankRow('daughter'), name: 'ليلى', death: '2015' },
    { ...blankRow('spouse'), name: 'سعيد' },
    blankRow(),
  ];
  const r = planQuickAdd(ix, woman, rows, { mode: 'info' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.items.map((i) => i.row), [1, 2, 3], 'in typed order: no marriages, no spouses first');
  assert.ok(r.items.every((i) => !i.marriage && i.otherRow === null && i.photo === null));
  const a = r.items[0].person;
  assert.equal(a.person_id, 'm');
  assert.equal(a.kind, 'son');
  assert.equal(a.first_name, 'عمر');
  assert.equal(a.last_name, null, 'no family name inherited from a woman');
  assert.equal('father_id' in a || 'mother_id' in a || 'gender' in a, false, 'an information row has no parents and no gender');
  assert.equal(a.birth_city, 'جبلة');
  assert.equal(r.items[1].person.is_deceased, true);
  assert.equal(r.items[2].person.kind, 'spouse');
  // a man's last name is not copied in info mode, and the permissions are the same
  assert.equal(planQuickAdd(ix, man, [{ ...blankRow(), name: 'علي' }], { mode: 'info' }).items[0].person.last_name, null);
  assert.deepEqual(planQuickAdd(ix, woman, [blankRow('son')].map((x) => ({ ...x, name: 'أ' })), { mode: 'info', canChild: false }).errors.map((e) => e.row), [1]);
  // editing a saved row keeps its id
  const saved = { id: 'r1', kind: 'daughter', first_name: 'ريم', last_name: 'س', birth_date: '2001', death_date: null, is_deceased: false, phone: '+49 170 1234567', email: null, notes: 'ن', birth_place: null, birth_country: 'SY', birth_province: null, birth_city: 'جبلة', residence_country: null, residence_province: null, residence_city: null };
  const back = rowFromInfo(saved);
  assert.equal(back.id, 'r1');
  assert.equal(back.name, 'ريم');
  assert.equal(back.extra.birth_city, 'جبلة');
  const again = planQuickAdd(ix, woman, [back], { mode: 'info' });
  assert.equal(again.items[0].id, 'r1');
  assert.equal(again.items[0].person.last_name, 'س');
  assert.equal(again.items[0].person.phone, '+49 170 1234567');
  assert.equal(again.items[0].person.birth_country, 'SY');
  // deceased flag round trip: a row marked deceased without a date stays deceased
  assert.equal(rowFromInfo({ ...saved, is_deceased: true }).extra.deceased, true);
  assert.equal(rowFromInfo({ ...saved, is_deceased: true, death_date: '2020' }).extra.deceased, false, 'the date says it');
}
console.log('QUICKADD OK');

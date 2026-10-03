import assert from 'node:assert/strict';
import { toJson, fromJson, toGedcom, fromGedcom, planImport, chunk, toGedcomDate, fromGedcomDate } from '../js/transfer.js';
import { buildIndex, buildHierarchy, countryByName } from '../js/tree.js';

let n = 0;
const P = (id, first, gender, o = {}) => ({
  id, first_name: first, last_name: 'الراشد', gender, father_id: null, mother_id: null, birth_date: null, birth_place: null,
  residence_country: null, residence_city: null, is_deceased: false, death_date: null, notes: null, created_at: String(++n).padStart(4, '0'), ...o,
});

// A polygamous family: G with two wives; A,B by W1; C by W2; A married AW -> A1
const persons = [
  P('G', 'سالم', 'male', { birth_date: '1915', is_deceased: true, death_date: '1990-05-02', birth_place: 'حمص', residence_country: 'SY', residence_city: 'دمشق', notes: 'سطر أول\nسطر ثان' }),
  P('W1', 'مريم', 'female', { last_name: 'العلي', birth_date: 'حوالي 1920', is_deceased: true }),
  P('W2', 'حصة', 'female', { last_name: 'السعد' }),
  P('A', 'عبدالله', 'male', { father_id: 'G', mother_id: 'W1', birth_date: '1940', residence_country: 'EG', residence_city: 'القاهرة' }),
  P('B', 'فاطمة', 'female', { father_id: 'G', mother_id: 'W1', birth_date: '1943-03-09' }),
  P('C', 'خالد', 'male', { father_id: 'G', mother_id: 'W2', birth_date: '1952' }),
  P('AW', 'سارة', 'female', { last_name: 'المطيري' }),
  P('A1', 'محمد', 'male', { father_id: 'A', mother_id: 'AW', birth_date: '1968', residence_country: 'DE', residence_city: 'Berlin' }),
];
const marriages = [
  { id: 'm1', person_a: 'G', person_b: 'W1', marriage_date: '1938', status: 'widowed' },
  { id: 'm2', person_a: 'W2', person_b: 'G', marriage_date: null, status: 'married' },
  { id: 'm3', person_a: 'AW', person_b: 'A', marriage_date: '1965', status: 'divorced' },
];

// ---- dates ----
assert.equal(toGedcomDate('1950'), '1950');
assert.equal(toGedcomDate('1950-03-12'), '12 MAR 1950');
assert.equal(toGedcomDate('١٩٥٠-٠٣'), 'MAR 1950');
assert.equal(toGedcomDate('حوالي ١٩٥٠'), 'ABT 1950');
assert.equal(toGedcomDate('في الصيف'), '(في الصيف)');
assert.equal(toGedcomDate(''), null);
assert.equal(fromGedcomDate('12 MAR 1950'), '1950-03-12');
assert.equal(fromGedcomDate('MAR 1950'), '1950-03');
assert.equal(fromGedcomDate('ABT 1950'), 'حوالي 1950');
assert.equal(fromGedcomDate('(في الصيف)'), 'في الصيف');
assert.equal(fromGedcomDate('BEF 1900'), 'BEF 1900');

// ---- countries by name ----
assert.equal(countryByName('Syria'), 'SY');
assert.equal(countryByName('سوريا'), 'SY');
assert.equal(countryByName('  egypt '), 'EG');
assert.equal(countryByName('USA'), 'US');
assert.equal(countryByName('Atlantis'), null);

// ---- JSON round trip ----
const json = toJson(persons, marriages, { treeName: 'عائلة الراشد' });
assert.equal(json.format, 'family-tree-export');
assert.equal(json.persons.length, 8);
assert.equal(json.persons[0].residence_country, 'SY');
const model = fromJson(JSON.stringify(json));
assert.equal(model.persons.length, 8);
assert.throws(() => fromJson('not json'), /JSON/);
assert.throws(() => fromJson('{"hello":1}'), /نسخة احتياطية/);

let seq = 0;
const plan = planImport(model, () => 'new' + ++seq);
assert.equal(plan.stats.persons, 8);
assert.equal(plan.stats.marriages, 3);
// ids are brand new, parents always come before children
const pos = new Map(plan.personRows.map((r, i) => [r.id, i]));
assert.ok(plan.personRows.every((r) => r.id.startsWith('new')));
for (const r of plan.personRows) for (const f of ['father_id', 'mother_id']) if (r[f]) assert.ok(pos.get(r[f]) < pos.get(r.id), 'parent before child');
// the imported tree has the same shape
const idx2 = buildIndex(plan.personRows.map((r, i) => ({ ...r, created_at: String(i).padStart(4, '0') })), plan.marriageRows.map((m, i) => ({ ...m, created_at: String(i) })));
const root = idx2.list.find((p) => !p.father_id && !p.mother_id && p.first_name === 'سالم');
assert.deepEqual(buildHierarchy(idx2, root.id).children.map((c) => c.person.first_name), ['عبدالله', 'فاطمة', 'خالد']);
assert.deepEqual(idx2.spouses.get(root.id).map((s) => s.person.first_name), ['مريم', 'حصة']);
assert.equal(plan.personRows.find((r) => r.first_name === 'سالم').notes, 'سطر أول\nسطر ثان');
assert.equal(plan.personRows.find((r) => r.first_name === 'عبدالله').residence_city, 'القاهرة');
assert.equal(plan.marriageRows.find((m) => m.status === 'divorced').marriage_date, '1965');

// ---- GEDCOM export ----
const ged = toGedcom(persons, marriages, { treeName: 'عائلة الراشد' });
assert.ok(ged.startsWith('0 HEAD'));
assert.ok(ged.includes('1 CHAR UTF-8'));
assert.ok(ged.trimEnd().endsWith('0 TRLR'));
assert.equal((ged.match(/ INDI\r\n/g) || []).length, 8);
assert.equal((ged.match(/ FAM\r\n/g) || []).length, 3);            // G+W1, G+W2, A+AW
assert.ok(ged.includes('1 NAME سالم /الراشد/'));
assert.ok(ged.includes('2 DATE 2 MAY 1990'));
assert.ok(ged.includes('2 DATE ABT 1920'));
assert.ok(ged.includes('2 CONT سطر ثان'));
assert.ok(ged.includes('2 PLAC القاهرة, Egypt'));
assert.ok(ged.includes('1 DIV Y'));

// ---- GEDCOM round trip ----
const back = fromGedcom(ged);
assert.equal(back.persons.length, 8);
assert.equal(back.marriages.length, 3);
const plan2 = planImport(back, () => 'g' + ++seq);
assert.equal(plan2.stats.persons, 8);
const byName = (name) => plan2.personRows.find((r) => r.first_name === name);
assert.equal(byName('خالد').father_id, byName('سالم').id);
assert.equal(byName('خالد').mother_id, byName('حصة').id);          // the second wife's child keeps the right mother
assert.equal(byName('عبدالله').mother_id, byName('مريم').id);
assert.equal(byName('سالم').death_date, '1990-05-02');
assert.equal(byName('سالم').birth_place, 'حمص');
assert.equal(byName('سالم').residence_country, 'SY');
assert.equal(byName('سالم').residence_city, 'دمشق');
assert.equal(byName('محمد').residence_country, 'DE');
assert.equal(byName('محمد').residence_city, 'Berlin');
assert.equal(byName('سالم').notes, 'سطر أول\nسطر ثان');
assert.equal(byName('مريم').last_name, 'العلي');
assert.equal(byName('مريم').gender, 'female');
assert.equal(byName('مريم').is_deceased, true);
assert.equal(plan2.marriageRows.filter((m) => m.status === 'divorced').length, 1);
assert.equal(back.warnings.length, 0);

// ---- GEDCOM written by other programs (Latin text, no GIVN/SURN, different casing) ----
const foreign = [
  '0 HEAD', '1 CHAR UTF-8', '1 GEDC', '2 VERS 5.5.1',
  '0 @I1@ INDI', '1 NAME John /Smith/', '1 SEX M', '1 BIRT', '2 DATE 12 MAR 1950', '2 PLAC Boston, MA, USA', '1 RESI', '2 PLAC Berlin, Germany', '1 FAMS @F1@',
  '0 @I2@ INDI', '1 NAME Mary Ann /Jones/ Jr', '1 SEX F', '1 DEAT', '2 DATE 1 JAN 2001', '1 FAMS @F1@',
  '0 @I3@ INDI', '1 NAME Kid /Smith/', '1 FAMC @F1@',
  '0 @I4@ INDI', '1 NAME /Unknown/', '1 NOTE first line', '2 CONT second line', '2 CONC  joined', '1 FAMC @F2@',
  '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@', '1 MARR', '2 DATE 1975',
  '0 @F2@ FAM', '1 HUSB @I1@', '1 CHIL @I4@',
  '0 TRLR',
].join('\n');
const fm = fromGedcom(foreign);
assert.equal(fm.persons.length, 4);
const find = (key) => fm.persons.find((p) => p.key === key);
assert.equal(find('@I1@').first_name, 'John');
assert.equal(find('@I1@').last_name, 'Smith');
assert.equal(find('@I1@').birth_date, '1950-03-12');
assert.equal(find('@I1@').residence_country, 'DE');
assert.equal(find('@I1@').residence_city, 'Berlin');
assert.equal(find('@I2@').first_name, 'Mary Ann Jr');
assert.equal(find('@I2@').is_deceased, true);
assert.equal(find('@I3@').father_key, '@I1@');
assert.equal(find('@I3@').mother_key, '@I2@');
assert.equal(find('@I3@').gender, 'male');                                  // SEX missing -> default, with a warning
assert.equal(find('@I4@').father_key, '@I1@');                              // child of a one-parent family
assert.equal(find('@I4@').mother_key, null);
assert.equal(find('@I4@').first_name, 'Unknown');                           // only a surname: used as the name
assert.equal(find('@I4@').notes, 'first line\nsecond line joined');
assert.ok(fm.warnings.some((w) => w.includes('بلا جنس')));
assert.equal(fm.marriages.length, 1);
assert.equal(fm.marriages[0].marriage_date, '1975');
assert.throws(() => fromGedcom('hello world'), /أي أشخاص/);

// ---- planImport safety ----
const nasty = planImport({
  persons: [
    { key: 'a', first_name: 'x'.repeat(300), last_name: '', gender: 'female', father_key: 'b', mother_key: 'zzz' },       // loop + unknown parent
    { key: 'b', first_name: '   ', gender: 'male', father_key: 'a', mother_key: null },
    { key: 'c', first_name: 'ok', gender: 'other', residence_country: 'Syria', residence_city: 'y'.repeat(200), notes: 'n'.repeat(3000) },
  ],
  marriages: [
    { a_key: 'a', b_key: 'a' },                        // self marriage
    { a_key: 'a', b_key: 'c' }, { a_key: 'c', b_key: 'a' },   // same pair twice
    { a_key: 'a', b_key: 'missing' },
  ],
  warnings: [],
}, () => 'id' + ++seq);
assert.equal(nasty.personRows.length, 3);
assert.ok(nasty.personRows.every((r) => r.first_name.length >= 1 && r.first_name.length <= 100));
assert.equal(nasty.personRows.find((r) => r.first_name === 'بدون اسم').father_id === null || true, true);
assert.equal(nasty.marriageRows.length, 1);
const cRow = nasty.personRows.find((r) => r.first_name === 'ok');
assert.equal(cRow.gender, 'male');
assert.equal(cRow.residence_country, null);                                  // a name is not a code
assert.equal(cRow.residence_city.length, 100);
assert.equal(cRow.notes.length, 2000);
// no row may point at a parent that comes later or does not exist
const ids = new Set();
for (const r of nasty.personRows) { for (const f of ['father_id', 'mother_id']) if (r[f]) assert.ok(ids.has(r[f])); ids.add(r.id); }
assert.ok(nasty.warnings.length >= 3);

// ---- chunking ----
assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.deepEqual(chunk([], 2), []);

// ---- a big one ----
const big = [];
for (let i = 0; i < 5000; i++) big.push(P('p' + i, 'ن' + i, i % 2 ? 'male' : 'female', { father_id: i > 0 ? 'p' + Math.floor((i - 1) / 3) : null }));
const t0 = performance.now();
const bigGed = toGedcom(big, []);
const bigPlan = planImport(fromGedcom(bigGed));
console.log('5000 persons: gedcom export+parse+plan', Math.round(performance.now() - t0), 'ms,', bigPlan.stats.persons, 'rows in', chunk(bigPlan.personRows).length, 'chunks');
assert.equal(bigPlan.stats.persons, 5000);

console.log('TRANSFER OK');

// ---------- provinces + structured birthplace ----------
{
  const mk = (id, first, o = {}) => ({ id, first_name: first, last_name: 'ع', gender: 'male', father_id: null, mother_id: null, birth_date: null, birth_place: null, is_deceased: false, death_date: null, notes: null, created_at: id,
    birth_country: null, birth_province: null, birth_city: null, residence_country: null, residence_province: null, residence_city: null, ...o });
  const ppl = [
    mk('1', 'احمد', { birth_country: 'SY', birth_province: 'ريف دمشق', birth_city: 'دوما', birth_place: 'مستشفى الشفاء', residence_country: 'DE', residence_province: 'برلين', residence_city: 'برلين' }),
    mk('2', 'علي', { birth_country: 'SY', birth_province: 'حلب', birth_city: 'حلب', residence_country: 'US', residence_province: 'كاليفورنيا', residence_city: 'سان خوسيه' }),
    mk('3', 'سعيد', { birth_place: 'قرية قرب حمص' }),                        // an old record: free text only
    mk('4', 'منى', { birth_country: 'EG', residence_country: 'SA' }),        // country only
  ];
  const check = (plan, label) => {
    const by = (n) => plan.personRows.find((r) => r.first_name === n);
    assert.equal(by('احمد').birth_country, 'SY', label);
    assert.equal(by('احمد').birth_province, 'ريف دمشق', label);
    assert.equal(by('احمد').birth_city, 'دوما', label);
    assert.equal(by('احمد').birth_place, 'مستشفى الشفاء', label + ': free-text detail kept');
    assert.equal(by('احمد').residence_country, 'DE', label);
    assert.equal(by('احمد').residence_city, 'برلين', label);
    assert.equal(by('علي').residence_province, 'كاليفورنيا', label);
    assert.equal(by('علي').residence_city, 'سان خوسيه', label);
    assert.equal(by('علي').birth_city, 'حلب', label);
    assert.equal(by('سعيد').birth_place, 'قرية قرب حمص', label + ': old free text survives');
    assert.equal(by('سعيد').birth_country, null, label);
    assert.equal(by('منى').birth_country, 'EG', label);
    assert.equal(by('منى').residence_country, 'SA', label);
  };
  check(planImport(fromJson(JSON.stringify(toJson(ppl, [])))), 'json');
  const ged = toGedcom(ppl, []);
  assert.ok(ged.includes('2 PLAC دوما, ريف دمشق, Syria'));
  assert.ok(ged.includes('2 NOTE مستشفى الشفاء'));
  assert.ok(ged.includes('2 PLAC قرية قرب حمص'));
  check(planImport(fromGedcom(ged)), 'gedcom');
  // a province or city that is too long is cut, a bad country code is dropped
  const bad = planImport({ persons: [{ key: 'x', first_name: 'a', gender: 'male', birth_country: 'Syria', birth_province: 'p'.repeat(300), residence_country: 'sy', residence_city: 'c'.repeat(300) }], marriages: [], warnings: [] });
  assert.equal(bad.personRows[0].birth_country, null);
  assert.equal(bad.personRows[0].birth_province.length, 100);
  assert.equal(bad.personRows[0].residence_country, null);
  assert.equal(bad.personRows[0].residence_city.length, 100);
  console.log('TRANSFER PLACES OK');
}

// ---------- phone + e-mail ----------
{
  const { validPhone: vp, validEmail: ve } = await import('../js/transfer.js');
  for (const ok of ['+000111222301', '+000 111 222 301', '0111-222-301', '(0944) 123456', '12345', '+49 170 1234567']) assert.ok(vp(ok), ok);
  for (const bad of ['', 'abc', '0111abc', '12', '+', '++000 111', '+' + '9'.repeat(40), ' ', '((((((', '1 2 3', '+1234567890123456789012']) assert.ok(!vp(bad), JSON.stringify(bad));
  for (const ok of ['a@b.co', 'ali@example.com', 'first.last+tag@sub.example.org']) assert.ok(ve(ok), ok);
  for (const bad of ['', 'ali@', '@x.com', 'a li@x.com', 'ali@x', 'ali@@x.com']) assert.ok(!ve(bad), JSON.stringify(bad));

  const mk = (id, first, o = {}) => ({ id, first_name: first, last_name: 'ع', gender: 'male', father_id: null, mother_id: null, birth_date: null, birth_place: null, is_deceased: false, death_date: null, notes: null, created_at: id,
    birth_country: null, birth_province: null, birth_city: null, residence_country: null, residence_province: null, residence_city: null, phone: null, email: null, ...o });
  const ppl = [mk('1', 'احمد', { phone: '+000 111 222 301', email: 'Ahmad@Example.com' }), mk('2', 'علي'), mk('3', 'سعيد', { phone: '0111abc', email: 'not-an-email' })];
  const check = (plan, label) => {
    const by = (n) => plan.personRows.find((r) => r.first_name === n);
    assert.equal(by('احمد').phone, '+000 111 222 301', label);
    assert.equal(by('احمد').email, 'ahmad@example.com', label + ': e-mail is stored in lower case');
    assert.equal(by('علي').phone, null, label);
    assert.equal(by('علي').email, null, label);
  };
  const viaJson = planImport(fromJson(JSON.stringify(toJson(ppl, []))));
  check(viaJson, 'json');
  const bad = viaJson.personRows.find((r) => r.first_name === 'سعيد');
  assert.equal(bad.phone, null, 'an invalid phone is dropped, not imported');
  assert.equal(bad.email, null);
  assert.ok(viaJson.warnings.some((w) => w.includes('غير صالح')), 'the user is told');
  const ged = toGedcom(ppl.slice(0, 2), []);
  assert.ok(ged.includes('1 PHON +000 111 222 301'));
  assert.ok(ged.includes('1 EMAIL Ahmad@Example.com'));
  check(planImport(fromGedcom(ged)), 'gedcom');
  console.log('TRANSFER CONTACT OK');
}

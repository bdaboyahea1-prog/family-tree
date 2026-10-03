import assert from 'node:assert/strict';
import { buildIndex, buildHierarchy, layout, fatherLine, motherLine } from '../js/tree.js';
import { personSheets, treeSheets, personCells, siblingsOf, siblingLabel, PERSON_HEAD, fatherSideName, motherSideName } from '../js/exports.js';
import { buildXlsx, unzip } from '../js/xlsx.js';

const mk = (id, first, o = {}) => ({ id, first_name: first, last_name: 'الراشد', gender: 'male', father_id: null, mother_id: null, birth_date: null, birth_place: null, is_deceased: false, death_date: null, notes: null,
  birth_country: null, birth_province: null, birth_city: null, residence_country: null, residence_province: null, residence_city: null, phone: null, email: null, created_at: id, ...o });
// father line: g1 -> g2 -> g3 -> me.  mother line: mg -> mf -> m (my mother) -> me
const people = [
  mk('g1', 'سالم', { birth_date: '1900' }),
  mk('g2', 'عبدالله', { father_id: 'g1', birth_date: '1930', phone: '+000 111 222 302' }),
  mk('g3', 'أحمد', { father_id: 'g2', mother_id: 'gm', birth_date: '1960' }),
  mk('gm', 'هدى', { gender: 'female', birth_date: '1935' }),
  mk('mg', 'جاسم', { birth_date: '1910' }),
  mk('mf', 'خالد', { father_id: 'mg', birth_date: '1938' }),
  mk('m', 'ليلى', { gender: 'female', father_id: 'mf', birth_date: '1965' }),
  mk('me', 'يوسف', { father_id: 'g3', mother_id: 'm', birth_date: '1990', birth_country: 'SY', birth_city: 'جبلة', residence_country: 'DE', residence_city: 'Berlin', email: 'me@example.com', notes: 'ملاحظة' }),
  mk('w2', 'سعاد', { gender: 'female', birth_date: '1992' }),
  mk('m2', 'منى', { gender: 'female', birth_date: '1991' }),
  mk('k1', 'رامي', { father_id: 'me', mother_id: 'm2', birth_date: '2015' }),
  mk('k2', 'سلمى', { gender: 'female', father_id: 'me', mother_id: 'w2', birth_date: '2018' }),
];
const marriages = [
  { id: 'x1', person_a: 'm', person_b: 'g3', marriage_date: '1988', status: 'married', created_at: '1' },
  { id: 'x2', person_a: 'me', person_b: 'm2', marriage_date: '2012', status: 'divorced', created_at: '2' },
  { id: 'x3', person_a: 'me', person_b: 'w2', marriage_date: null, status: 'married', created_at: '3' },
];
const ix = buildIndex(people, marriages);
const me = ix.byId.get('me');

// ---------- ancestor lines ----------
assert.deepEqual(fatherLine(ix, me).map((p) => p.id), ['g3', 'g2', 'g1'], 'father first, the first ancestor last');
assert.deepEqual(motherLine(ix, me).map((p) => p.id), ['m', 'mf', 'mg'], 'mother, then her father line');
assert.deepEqual(fatherLine(ix, ix.byId.get('g1')), []);
assert.deepEqual(motherLine(ix, ix.byId.get('g1')), []);
const loop = buildIndex([mk('a', 'A', { father_id: 'b' }), mk('b', 'B', { father_id: 'a' })], []);
assert.equal(fatherLine(loop, loop.byId.get('a')).length, 1, 'a loop in the data cannot hang');

assert.deepEqual([1, 2, 3, 4].map(fatherSideName), ['الأب', 'الجد الأول', 'الجد الثاني', 'الجد الثالث']);
assert.equal(fatherSideName(12), 'الجد 11', 'after the tenth it is a plain number');
assert.deepEqual([1, 2, 3].map(motherSideName), ['الأم', 'الجد الأول (جهة الأم)', 'الجد الثاني (جهة الأم)']);

// ---------- one person ----------
const sheets = personSheets(ix, me);
assert.deepEqual(sheets.map((s) => s.name), ['بطاقة الشخص', 'الأجداد', 'الإخوة', 'الزوجات', 'الأبناء']);
for (const s of sheets) {
  const width = s.rows[0].length;
  assert.ok(s.rows.every((r) => r.length === width), `${s.name}: every row has ${width} cells`);
  assert.equal(s.widths.length, width, `${s.name}: one width per column`);
}
const card = new Map(sheets[0].rows.slice(1));
assert.equal(card.get('الاسم الكامل'), 'يوسف الراشد');
assert.equal(card.get('البريد الإلكتروني'), 'me@example.com');
assert.equal(card.get('الأب'), 'أحمد الراشد');
assert.equal(card.get('الأم'), 'ليلى الراشد');
assert.equal(card.get('عدد الزوجات'), 2);
assert.equal(card.get('عدد الأبناء'), 2);
assert.ok(String(card.get('مكان الميلاد')).includes('جبلة'));
assert.ok(String(card.get('الإقامة')).includes('Berlin'));

assert.deepEqual(
  sheets[1].rows.slice(1).map((r) => [r[0], r[1], r[2], r[3]]),
  [
    ['جهة الأب', 1, 'الأب', 'أحمد الراشد'],
    ['جهة الأب', 2, 'الجد الأول', 'عبدالله الراشد'],
    ['جهة الأب', 3, 'الجد الثاني', 'سالم الراشد'],
    ['جهة الأم', 1, 'الأم', 'ليلى الراشد'],
    ['جهة الأم', 2, 'الجد الأول (جهة الأم)', 'خالد الراشد'],
    ['جهة الأم', 3, 'الجد الثاني (جهة الأم)', 'جاسم الراشد'],
  ],
  'ancestors are listed from the closest one up: the father, then the first grandfather, the second …',
);
const g2row = sheets[1].rows.find((r) => r[3] === 'عبدالله الراشد');
assert.equal(g2row[3 + PERSON_HEAD.indexOf('الهاتف')], '+000 111 222 302', 'the ancestor phone is there');
assert.equal(g2row[g2row.length - 1], '', 'no mother recorded for the grandfather');
const g3row = sheets[1].rows.find((r) => r[3] === 'أحمد الراشد');
assert.equal(g3row[g3row.length - 1], 'هدى الراشد', 'an ancestor mother is named');

const wives = sheets[3].rows.slice(1);
assert.deepEqual(wives.map((r) => [r[0], r[1], r[2], r[3]]), [['الزوجة الأولى', 'منفصلان', '2012', 'منى الراشد'], ['الزوجة الثانية', 'متزوجان', '', 'سعاد الراشد']]);
assert.deepEqual(wives.map((r) => r[r.length - 2]), [1, 1], 'children shared with each wife');
assert.deepEqual(wives.map((r) => r[r.length - 1]), ['بطاقة في الشجرة', 'بطاقة في الشجرة']);
const kids = sheets[4].rows.slice(1);
assert.deepEqual(kids.map((r) => [r[0], r[1], r[2], r[r.length - 2], r[r.length - 1]]), [[1, 'رامي الراشد', 'ذكر', 'منى الراشد', 'بطاقة في الشجرة'], [2, 'سلمى الراشد', 'أنثى', 'سعاد الراشد', 'بطاقة في الشجرة']]);

// someone with no relatives still gets valid sheets
const lone = personSheets(ix, ix.byId.get('g1'));
assert.equal(lone[1].rows.length, 1, 'only the header when no ancestors');
assert.equal(lone[3].name, 'الزوجات');
assert.equal(lone[2].rows.length, 1, 'no brothers or sisters: only the header');
assert.equal(personSheets(ix, ix.byId.get('gm'))[3].name, 'الأزواج', 'a woman has husbands');

// ---------- the people on the screen ----------
const res = layout(buildHierarchy(ix, 'g1'), { rtl: true });
const shown = res.cards.map((c) => ix.byId.get(c.personId));
assert.deepEqual(shown.map((p) => p.id), ['g1', 'g2', 'g3', 'me', 'k1', 'k2'], 'drawing order = depth first');
const gen = new Map(res.cards.map((c) => [c.personId, c.node.depth + 1]));
const branch = new Map([['g2', 'فرع عبدالله'], ['g3', 'فرع عبدالله'], ['me', 'فرع عبدالله'], ['k1', 'فرع عبدالله'], ['k2', 'فرع عبدالله']]);
const t = treeSheets(ix, shown, { gen, branch, info: [['الشجرة', 'عائلة الراشد'], ['عدد الأشخاص', shown.length]] });
assert.deepEqual(t.map((s) => s.name), ['الشجرة المعروضة', 'الزيجات', 'عن الملف']);
for (const s of t) {
  const width = s.rows[0].length;
  assert.ok(s.rows.every((r) => r.length === width), `${s.name}: every row has ${width} cells`);
  assert.equal(s.widths.length, width, `${s.name}: one width per column`);
}
const main = t[0].rows;
assert.equal(main.length, 1 + shown.length);
const meRow = main.find((r) => r[1] === 'يوسف الراشد');
assert.equal(meRow[0], 4, 'generation');
assert.equal(meRow[3], 'أحمد الراشد');
assert.equal(meRow[4], 'ليلى الراشد');
assert.equal(meRow[5], 'منى الراشد، سعاد الراشد', 'wives joined');
assert.equal(meRow[6], 2, 'children');
assert.equal(meRow[7], 'فرع عبدالله');
assert.ok(main[0].indexOf('الهاتف') > 7);
const marr = t[1].rows;
assert.equal(marr.length, 1 + 4, 'four marriages: g2+gm (implied by their child), g3+m, me+m2, me+w2');
const summary = marr.slice(1).map((r) => [r[0], r[2], r[3]].join('|')).sort();
assert.deepEqual(summary, [
  'أحمد الراشد|ليلى الراشد|متزوجان',
  'عبدالله الراشد|هدى الراشد|',
  'يوسف الراشد|سعاد الراشد|متزوجان',
  'يوسف الراشد|منى الراشد|منفصلان',
].sort());

// the people of a branch only: a marriage with someone outside is still listed once, with the outsider's details
const part = treeSheets(ix, [me, ix.byId.get('k1')], {});
assert.equal(part[1].rows.length, 1 + 2);
assert.equal(part[0].rows[1][0], '', 'no generation given -> empty cell');

// ---------- the whole thing becomes a real file ----------
const bytes = buildXlsx([...sheets, ...t.map((s) => ({ ...s, name: 'ش-' + s.name }))]);
const files = unzip(bytes);
assert.ok(files.every((f) => f.crcOk));
assert.equal(files.filter((f) => f.name.startsWith('xl/worksheets/')).length, 8);
assert.equal(PERSON_HEAD.length, personCells(me).length);

// ---------- brothers and sisters ----------
{
  const mkp = (id, first, o = {}) => mk(id, first, o);
  const fam = buildIndex([
    mkp('f', 'الأب', { birth_date: '1950' }),
    mkp('mo', 'الأم', { gender: 'female', birth_date: '1955' }),
    mkp('mo2', 'الأم الثانية', { gender: 'female', birth_date: '1960' }),
    mkp('f2', 'زوج الأم', { birth_date: '1948' }),
    mkp('me2', 'أنا', { father_id: 'f', mother_id: 'mo', birth_date: '1980' }),
    mkp('full', 'شقيق', { father_id: 'f', mother_id: 'mo', birth_date: '1978' }),
    mkp('sis', 'شقيقة', { gender: 'female', father_id: 'f', mother_id: 'mo', birth_date: '1985' }),
    mkp('hf', 'أخ لأب', { father_id: 'f', mother_id: 'mo2', birth_date: '1990' }),
    mkp('hm', 'أخت لأم', { gender: 'female', father_id: 'f2', mother_id: 'mo', birth_date: '1970' }),
    mkp('other', 'غريب', { father_id: 'f2', mother_id: 'mo2', birth_date: '1975' }),
    mkp('only', 'وحيد'),
  ], []);
  const me2 = fam.byId.get('me2');
  const sibs = siblingsOf(fam, me2);
  assert.deepEqual(sibs.map((s) => [s.person.id, s.kind]), [['hm', 'mother'], ['full', 'both'], ['sis', 'both'], ['hf', 'father']], 'oldest first, the half ones with their side, nobody twice, not myself');
  assert.deepEqual(siblingsOf(fam, fam.byId.get('only')), [], 'no parents, no siblings');
  assert.deepEqual([['male', 'both'], ['female', 'both'], ['male', 'father'], ['female', 'father'], ['male', 'mother'], ['female', 'mother']].map(([g, k]) => siblingLabel(g, k)), ['أخ شقيق', 'أخت شقيقة', 'أخ لأب', 'أخت لأب', 'أخ لأم', 'أخت لأم']);

  const sh = personSheets(fam, me2);
  assert.equal(sh[2].name, 'الإخوة');
  const rows = sh[2].rows;
  assert.deepEqual(rows[0].slice(0, 2), ['الرقم', 'الصلة']);
  assert.equal(rows.length, 1 + 4);
  assert.ok(rows.every((r) => r.length === rows[0].length) && sh[2].widths.length === rows[0].length);
  assert.deepEqual(rows.slice(1).map((r) => [r[0], r[1], r[2], r[r.length - 3], r[r.length - 2], r[r.length - 1]]), [
    [1, 'أخت لأم', 'أخت لأم الراشد', 'زوج الأم الراشد', 'الأم الراشد', 'بطاقة في الشجرة'],
    [2, 'أخ شقيق', 'شقيق الراشد', 'الأب الراشد', 'الأم الراشد', 'بطاقة في الشجرة'],
    [3, 'أخت شقيقة', 'شقيقة الراشد', 'الأب الراشد', 'الأم الراشد', 'بطاقة في الشجرة'],
    [4, 'أخ لأب', 'أخ لأب الراشد', 'الأب الراشد', 'الأم الثانية الراشد', 'بطاقة في الشجرة'],
  ]);
  // the sons / daughters that the mother wrote in her information table are brothers and sisters as well
  const motherInfo = [
    { id: 'i1', kind: 'daughter', first_name: 'ريم', last_name: null, birth_date: '2001', death_date: null, is_deceased: false, birth_country: null, birth_province: null, birth_city: null, birth_place: null, residence_country: null, residence_province: null, residence_city: null, phone: null, email: null, notes: null },
    { id: 'i2', kind: 'spouse', first_name: 'زوج', last_name: null, birth_date: null, death_date: null, is_deceased: false, birth_country: null, birth_province: null, birth_city: null, birth_place: null, residence_country: null, residence_province: null, residence_city: null, phone: null, email: null, notes: null },
  ];
  const withInfo = personSheets(fam, me2, [], motherInfo)[2].rows;
  assert.equal(withInfo.length, 1 + 5, 'one more row: her daughter (a husband is not a sibling)');
  assert.deepEqual([withInfo[5][0], withInfo[5][1], withInfo[5][2], withInfo[5][withInfo[5].length - 2], withInfo[5][withInfo[5].length - 1]], [5, 'أخت لأم', 'ريم', 'الأم الراشد', 'جدول المعلومات']);
}

// ---------- a woman's information table is exported with her children ----------
{
  const woman = ix.byId.get('m');
  const infoBlank = { last_name: null, birth_date: null, death_date: null, is_deceased: false, birth_country: null, birth_province: null, birth_city: null, birth_place: null, residence_country: null, residence_province: null, residence_city: null, phone: null, email: null, notes: null };
  const base = personSheets(ix, woman);
  assert.equal(base[4].rows.slice(1).length, 1, 'her child with a card');
  const info = [
    { ...infoBlank, id: 'r1', kind: 'son', first_name: 'عمر', last_name: 'س', birth_date: '2010', birth_country: 'SY', birth_city: 'جبلة', phone: '+49 170 1234567', notes: 'ملاحظة' },
    { ...infoBlank, id: 'r2', kind: 'daughter', first_name: 'ريم', death_date: '2020', is_deceased: true },
    { ...infoBlank, id: 'r3', kind: 'spouse', first_name: 'سعيد', birth_date: '1985' },
  ];
  const s = personSheets(ix, woman, info);
  for (const sh of s) {
    const width = sh.rows[0].length;
    assert.ok(sh.rows.every((r) => r.length === width), `${sh.name}: every row has ${width} cells`);
    assert.equal(sh.widths.length, width, `${sh.name}: one width per column`);
  }
  const card2 = new Map(s[0].rows.slice(1));
  assert.equal(card2.get('عدد الأبناء'), 3, 'cards + information rows');
  assert.equal(card2.get('منهم مسجَّلون كمعلومات فقط (دون بطاقات)'), 2);
  const kids2 = s[4].rows.slice(1);
  assert.deepEqual(kids2.map((r) => [r[0], r[1], r[2], r[r.length - 1]]), [
    [1, 'يوسف الراشد', 'ذكر', 'بطاقة في الشجرة'],
    [2, 'عمر س', 'ذكر', 'جدول المعلومات'],
    [3, 'ريم', 'أنثى', 'جدول المعلومات'],
  ], 'the children of the information table follow the cards');
  const omar = kids2[1];
  assert.equal(omar[PERSON_HEAD.indexOf('الهاتف') + 1], '+49 170 1234567');
  assert.ok(String(omar[PERSON_HEAD.indexOf('مكان الميلاد') + 1]).includes('جبلة'));
  assert.equal(kids2[2][PERSON_HEAD.indexOf('الحالة') + 1], 'متوفى');
  const husbands = s[3].rows.slice(1);
  assert.equal(husbands.length, 2, 'her husband with a card, then the one of the information table');
  assert.equal(husbands[0][husbands[0].length - 1], 'بطاقة في الشجرة');
  assert.deepEqual([husbands[1][0], husbands[1][3], husbands[1][husbands[1].length - 1]], ['معلومات فقط', 'سعيد', 'جدول المعلومات']);
  // the tree on the screen: an extra sheet with the information rows of the women shown
  const ts = treeSheets(ix, [woman, ix.byId.get('me')], { infoRows: new Map([['m', info]]) });
  assert.deepEqual(ts.map((x) => x.name), ['الشجرة المعروضة', 'الزيجات', 'أبناء النساء (معلومات)', 'عن الملف']);
  const infoSheet = ts[2];
  assert.equal(infoSheet.rows.length, 1 + 3);
  assert.deepEqual(infoSheet.rows.slice(1).map((r) => [r[0], r[1], r[2]]), [['ليلى الراشد', 'ابن', 'عمر س'], ['ليلى الراشد', 'ابنة', 'ريم'], ['ليلى الراشد', 'زوج', 'سعيد']]);
  assert.ok(infoSheet.rows.every((r) => r.length === infoSheet.widths.length));
  // the wife of a man on the screen counts, a man's own id does not
  const ts2 = treeSheets(ix, [ix.byId.get('me')], { infoRows: new Map([['w2', info], ['me', info]]) });
  assert.equal(ts2.find((x) => x.name === 'أبناء النساء (معلومات)').rows.length, 1 + 3);
  assert.equal(treeSheets(ix, [ix.byId.get('me')], { infoRows: new Map([['me', info]]) }).some((x) => x.name === 'أبناء النساء (معلومات)'), false, 'nothing for a man');
  assert.equal(treeSheets(ix, [woman]).some((x) => x.name === 'أبناء النساء (معلومات)'), false, 'no sheet when there is nothing to list');
}
console.log('EXPORTS OK');

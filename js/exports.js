// What goes into the Excel files: plain tables (arrays of rows), turned into a file by xlsx.js.
//   personSheets   everything about one person: the card, the ancestors, the wives / husbands, the children
//   treeSheets     the people drawn on the screen, one row each, plus their marriages
import { fullName, birthText, residenceText, fatherLine, motherLine, spouseLabel, commonChildren, yearOf } from './tree.js';

const GENDER = { male: 'ذكر', female: 'أنثى' };
const MARRIAGE = { married: 'متزوجان', divorced: 'منفصلان', widowed: 'ترمّل' };

/** The columns every list of people has (see personCells). */
export const PERSON_HEAD = ['الاسم الكامل', 'الجنس', 'اللقب المشتهر به', 'تاريخ الميلاد', 'مكان الميلاد', 'الإقامة', 'الحالة', 'تاريخ الوفاة', 'الهاتف', 'البريد الإلكتروني', 'ملاحظات'];
const PERSON_WIDTHS = [26, 8, 18, 14, 28, 28, 9, 14, 18, 26, 36];

export const personCells = (p) => [
  fullName(p),
  GENDER[p.gender] || '',
  p.nickname || '',
  p.birth_date || '',
  birthText(p),
  residenceText(p),
  p.is_deceased ? 'متوفى' : 'حي',
  p.is_deceased || p.death_date ? p.death_date || '' : '',
  p.phone || '',
  p.email || '',
  p.notes || '',
];

const ORDINAL = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];
/**
 * Ancestors are numbered from the closest one: n = 1 is the father, n = 2 the first grandfather (the
 * father's father), n = 3 the second grandfather … On the mother's side n = 1 is the mother and n = 2 the
 * first grandfather (the mother's father).
 */
export const fatherSideName = (n) => (n === 1 ? 'الأب' : `الجد ${ORDINAL[n - 2] ?? n - 1}`);
export const motherSideName = (n) => (n === 1 ? 'الأم' : `الجد ${ORDINAL[n - 2] ?? n - 1} (جهة الأم)`);

const nameOf = (index, id) => {
  const p = index.byId.get(id);
  return p ? fullName(p) : '';
};

const SOURCE_CARD = 'بطاقة في الشجرة';
const SOURCE_INFO = 'جدول المعلومات';
const INFO_KIND = { son: 'ابن', daughter: 'ابنة', spouse: 'زوج' };

/** A row of a woman's information table as a person-like record, so the same columns can be written for it. */
export const infoAsPerson = (r, parent) => ({
  ...r,
  gender: r.kind === 'son' ? 'male' : r.kind === 'daughter' ? 'female' : parent.gender === 'male' ? 'female' : 'male',
});

/** Brothers and sisters: everyone who shares the father or the mother, oldest first. kind = 'both' | 'father' | 'mother'. */
export function siblingsOf(index, p) {
  const seen = new Set([p.id]);
  const out = [];
  const add = (c) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    const sameFather = !!p.father_id && c.father_id === p.father_id;
    const sameMother = !!p.mother_id && c.mother_id === p.mother_id;
    out.push({ person: c, kind: sameFather && sameMother ? 'both' : sameFather ? 'father' : 'mother' });
  };
  for (const c of index.kids.get(p.father_id) || []) add(c);
  for (const c of index.kids.get(p.mother_id) || []) add(c);
  return out.sort((a, b) => (yearOf(a.person.birth_date) ?? 9999) - (yearOf(b.person.birth_date) ?? 9999));
}

/** "أخ شقيق" / "أخت لأب" / "أخ لأم" … */
export const siblingLabel = (gender, kind) => {
  const male = gender === 'male';
  return `${male ? 'أخ' : 'أخت'} ${kind === 'both' ? (male ? 'شقيق' : 'شقيقة') : kind === 'father' ? 'لأب' : 'لأم'}`;
};

/**
 * Sheets for one person.
 * infoRows: the rows of her information table (sons / daughters / husband written as information, not as cards):
 * they are listed together with the cards, marked with their source.
 * motherInfo: the information rows of this person's mother: her sons / daughters there are brothers and sisters too.
 */
export function personSheets(index, p, infoRows = [], motherInfo = []) {
  const infoKids = infoRows.filter((r) => r.kind !== 'spouse');
  const infoSpouses = infoRows.filter((r) => r.kind === 'spouse');
  const father = index.byId.get(p.father_id);
  const mother = index.byId.get(p.mother_id);
  const spouses = index.spouses.get(p.id) || [];
  const kids = index.kids.get(p.id) || [];
  const cells = personCells(p);

  const card = [['الحقل', 'القيمة'], ...PERSON_HEAD.map((k, i) => [k, cells[i]])];
  card.push(['الأب', father ? fullName(father) : ''], ['الأم', mother ? fullName(mother) : ''], [p.gender === 'male' ? 'عدد الزوجات' : 'عدد الأزواج', spouses.length], ['عدد الأبناء', kids.length + infoKids.length]);
  if (infoKids.length) card.push(['منهم مسجَّلون كمعلومات فقط (دون بطاقات)', infoKids.length]);

  // ancestors, the closest first
  const ancestorHead = ['الجهة', 'الترتيب (1 = الأقرب)', 'الصلة بالشخص', ...PERSON_HEAD, 'الأم'];
  const ancestors = [ancestorHead];
  const addLine = (side, line, relation) => {
    line.forEach((a, i) => {
      ancestors.push([side, i + 1, relation(i + 1), ...personCells(a), nameOf(index, a.mother_id)]);
    });
  };
  addLine('جهة الأب', fatherLine(index, p), fatherSideName);
  addLine('جهة الأم', motherLine(index, p), motherSideName);

  // brothers and sisters (the half ones too), then the sons / daughters their mother wrote in her information table
  const siblingSheet = [['الرقم', 'الصلة', ...PERSON_HEAD, 'الأب', 'الأم', 'المصدر']];
  const sibs = siblingsOf(index, p);
  sibs.forEach(({ person, kind }, i) => {
    siblingSheet.push([i + 1, siblingLabel(person.gender, kind), ...personCells(person), nameOf(index, person.father_id), nameOf(index, person.mother_id), SOURCE_CARD]);
  });
  motherInfo
    .filter((r) => r.kind !== 'spouse')
    .forEach((r, i) => {
      const as = infoAsPerson(r, mother || { gender: 'female' });
      siblingSheet.push([sibs.length + i + 1, siblingLabel(as.gender, 'mother'), ...personCells(as), '', mother ? fullName(mother) : '', SOURCE_INFO]);
    });

  const spouseSheet = [['الترتيب', 'حالة الزواج', 'تاريخ الزواج', ...PERSON_HEAD, 'عدد الأبناء المشتركين', 'المصدر']];
  spouses.forEach((s, i) => {
    spouseSheet.push([spouseLabel(p, i, spouses.length), s.marriage ? MARRIAGE[s.marriage.status] || '' : '', s.marriage?.marriage_date || '', ...personCells(s.person), commonChildren(index, p.id, s.person.id).length, SOURCE_CARD]);
  });
  for (const r of infoSpouses) spouseSheet.push(['معلومات فقط', '', '', ...personCells(infoAsPerson(r, p)), '', SOURCE_INFO]);

  const kidSheet = [['الرقم', ...PERSON_HEAD, p.gender === 'male' ? 'الأم' : 'الأب', 'المصدر']];
  kids.forEach((c, i) => {
    kidSheet.push([i + 1, ...personCells(c), nameOf(index, p.gender === 'male' ? c.mother_id : c.father_id), SOURCE_CARD]);
  });
  infoKids.forEach((r, i) => {
    kidSheet.push([kids.length + i + 1, ...personCells(infoAsPerson(r, p)), '', SOURCE_INFO]);
  });

  return [
    { name: 'بطاقة الشخص', rows: card, widths: [26, 50] },
    { name: 'الأجداد', rows: ancestors, widths: [12, 12, 16, ...PERSON_WIDTHS, 22] },
    { name: 'الإخوة', rows: siblingSheet, widths: [7, 16, ...PERSON_WIDTHS, 22, 22, 16] },
    { name: p.gender === 'male' ? 'الزوجات' : 'الأزواج', rows: spouseSheet, widths: [16, 14, 14, ...PERSON_WIDTHS, 14, 16] },
    { name: 'الأبناء', rows: kidSheet, widths: [7, ...PERSON_WIDTHS, 22, 16] },
  ];
}

/**
 * Sheets for the people shown on the screen.
 *   persons  the people, in drawing order (the root first)
 *   gen      id -> generation number (1 = the first generation of the whole tree)
 *   branch   id -> name of the branch they belong to ('' for none)
 *   info     [[label, value], …] shown on the last sheet (tree name, date, …)
 *   infoRows Map: woman's id -> her information rows; the ones of the shown women (and their wives) get a sheet
 */
export function treeSheets(index, persons, { gen = new Map(), branch = new Map(), info = [], infoRows = new Map() } = {}) {
  const shown = new Set(persons.map((p) => p.id));
  const head = ['الجيل', 'الاسم الكامل', 'الجنس', 'الأب', 'الأم', 'الزوجات / الأزواج', 'عدد الأبناء', 'الفرع', ...PERSON_HEAD.slice(2)];
  const rows = [head];
  for (const p of persons) {
    const sp = index.spouses.get(p.id) || [];
    const c = personCells(p);
    rows.push([
      gen.get(p.id) ?? '',
      c[0],
      c[1],
      nameOf(index, p.father_id),
      nameOf(index, p.mother_id),
      sp.map((s) => fullName(s.person)).join('، '),
      (index.kids.get(p.id) || []).length,
      branch.get(p.id) || '',
      ...c.slice(2),
    ]);
  }

  const marriageRows = [['الشخص', 'الصلة', 'الزوج / الزوجة', 'حالة الزواج', 'تاريخ الزواج', ...PERSON_HEAD.slice(1), 'عدد الأبناء المشتركين']];
  const done = new Set();
  for (const p of persons) {
    const sp = index.spouses.get(p.id) || [];
    sp.forEach((s, i) => {
      const key = [p.id, s.person.id].sort().join('|');
      if (shown.has(s.person.id) && done.has(key)) return; // both are listed: one row is enough
      done.add(key);
      const c = personCells(s.person);
      marriageRows.push([fullName(p), spouseLabel(p, i, sp.length), c[0], s.marriage ? MARRIAGE[s.marriage.status] || '' : '', s.marriage?.marriage_date || '', ...c.slice(1), commonChildren(index, p.id, s.person.id).length]);
    });
  }

  // the information tables of the women on the screen (and of the wives of the men on it)
  const women = [];
  const seenWomen = new Set();
  for (const p of persons) {
    for (const q of [p, ...(index.spouses.get(p.id) || []).map((s) => s.person)]) {
      if (q.gender === 'female' && !seenWomen.has(q.id)) {
        seenWomen.add(q.id);
        women.push(q);
      }
    }
  }
  const infoList = [['الأم / الزوجة', 'القرابة', ...PERSON_HEAD]];
  for (const w of women) for (const r of infoRows.get(w.id) || []) infoList.push([fullName(w), INFO_KIND[r.kind] || r.kind, ...personCells(infoAsPerson(r, w))]);
  const infoSheet = infoList.length > 1 ? [{ name: 'أبناء النساء (معلومات)', rows: infoList, widths: [24, 10, ...PERSON_WIDTHS] }] : [];

  return [
    { name: 'الشجرة المعروضة', rows, widths: [7, 26, 8, 22, 22, 34, 9, 18, 18, 14, 28, 28, 9, 14, 18, 26, 36] },
    { name: 'الزيجات', rows: marriageRows, widths: [24, 16, 24, 14, 14, 8, 18, 14, 28, 28, 9, 14, 18, 26, 36, 14] },
    ...infoSheet,
    { name: 'عن الملف', rows: [['البند', 'القيمة'], ...info], widths: [24, 50] },
  ];
}

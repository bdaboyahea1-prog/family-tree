// The quick-add table: several sons / daughters / wives (or husbands) typed in one go, with every
// detail a card can hold. This module only turns the typed rows into the records to save; the page
// does the saving.
//   mode "cards": people (and marriages) that become cards in the tree
//   mode "info":  rows of the information table of a woman's card (they never become cards)
import { validPhone, validEmail } from './transfer.js';

export const KIND_LABEL = { son: 'ابن', daughter: 'ابنة' };
/** "زوجة" on a man's card, "زوج" on a woman's. */
export const spouseKindLabel = (parent) => (parent.gender === 'male' ? 'زوجة' : 'زوج');

const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const orNull = (s) => collapse(s) || null;

/** "علي الراشد" typed under a father called الراشد is just "علي": the family name is inherited anyway. */
export function cleanName(typed, inheritedLast) {
  const name = collapse(typed);
  const last = collapse(inheritedLast);
  if (last && name.length > last.length + 1 && name.endsWith(' ' + last)) return name.slice(0, -(last.length + 1));
  return name;
}

/** The extra details of a row (everything below the four main columns). */
export const blankExtra = () => ({
  last_name: '', phone: '', email: '', notes: '', deceased: false,
  birth_place: '', birth_country: null, birth_province: null, birth_city: null,
  residence_country: null, residence_province: null, residence_city: null,
});
export const blankRow = (kind = 'son') => ({ kind, name: '', birth: '', death: '', other: '', extra: null, photo: null, id: null });

const extraTouched = (x) => !!x && Object.entries(x).some(([k, v]) => (k === 'deceased' ? v === true : typeof v === 'string' ? collapse(v) !== '' : v != null));
const isBlank = (r) => !collapse(r.name) && !collapse(r.birth) && !collapse(r.death) && !extraTouched(r.extra) && !r.photo;

/** The columns of the extra details that go into a record (same names as the person columns). */
function detailColumns(x, birthDate) {
  const e = x || blankExtra();
  return {
    birth_place: orNull(e.birth_place),
    birth_country: e.birth_country || null,
    birth_province: orNull(e.birth_province),
    birth_city: orNull(e.birth_city),
    residence_country: e.residence_country || null,
    residence_province: orNull(e.residence_province),
    residence_city: orNull(e.residence_city),
    phone: orNull(e.phone),
    email: orNull(e.email)?.toLowerCase() ?? null,
    notes: orNull(e.notes),
  };
}

/**
 * rows: [{ kind: 'son' | 'daughter' | 'spouse', name, birth, death, other, extra, photo, id }]
 *   other = id of the other parent, only needed when the person has several wives / husbands
 *   extra = see blankExtra()   photo = a Blob (cards only)   id = the id of an information row being edited
 * Returns { items, errors }.
 *   items:  [{ row, kind, id, person, photo, marriage, otherRow }] with the spouses first
 *           row = the line number (1 = first line), person = the values to insert,
 *           marriage = true for a wife / husband (to be linked to `parent` after the insert),
 *           otherRow = for a child without a chosen other parent: the line of the wife added in the same table
 *           In mode "info" `person` is the information row ({ person_id, kind, ... }) and nothing else is set.
 *   errors: [{ row, message }]  nothing should be saved while there are errors
 */
export function planQuickAdd(index, parent, rows, { canChild = true, canSpouse = true, mode = 'cards' } = {}) {
  const items = [];
  const errors = [];
  const info = mode === 'info';
  const male = parent.gender === 'male';
  const spouses = index.spouses.get(parent.id) || [];
  const spouseIds = new Set(spouses.map((s) => s.person.id));
  const spouseRows = info ? [] : rows.map((r, i) => (r.kind === 'spouse' && !isBlank(r) ? i + 1 : null)).filter(Boolean);

  rows.forEach((r, i) => {
    const row = i + 1;
    if (isBlank(r)) return;
    const fail = (message) => errors.push({ row, message });
    const isChild = r.kind === 'son' || r.kind === 'daughter';
    if (!isChild && r.kind !== 'spouse') return fail('اختر القرابة');
    if (isChild && !canChild) return fail('لا تملك صلاحية إضافة أبناء لهذه البطاقة');
    if (r.kind === 'spouse' && !canSpouse) return fail(`لا تملك صلاحية إضافة ${spouseKindLabel(parent)} لهذه البطاقة`);

    const x = r.extra || blankExtra();
    const birth = collapse(r.birth);
    const death = collapse(r.death);
    const inherited = !info && isChild && male ? collapse(parent.last_name) || null : null;
    const last = orNull(x.last_name) || inherited;
    const name = cleanName(r.name, last);
    if (!name) return fail('الاسم مطلوب');
    if (name.length > 100) return fail('الاسم أطول من المسموح');
    if (birth.length > 40 || death.length > 40) return fail('التاريخ أطول من المسموح');
    if (last && last.length > 100) return fail('اللقب أطول من المسموح');
    const cols = detailColumns(x);
    if (cols.phone && !validPhone(cols.phone)) return fail('رقم الهاتف غير صالح');
    if (cols.email && !validEmail(cols.email)) return fail('البريد الإلكتروني غير صالح');
    if (cols.notes && cols.notes.length > 2000) return fail('الملاحظات أطول من المسموح');

    const deceased = !!death || x.deceased === true;
    const common = { first_name: name, last_name: last, birth_date: birth || null, is_deceased: deceased, death_date: death || null, ...cols };

    if (info) {
      items.push({ row, kind: r.kind, id: r.id || null, person: { person_id: parent.id, kind: r.kind, ...common }, photo: null, marriage: false, otherRow: null });
      return;
    }

    const person = { ...common, gender: r.kind === 'son' ? 'male' : r.kind === 'daughter' ? 'female' : male ? 'female' : 'male' };
    let otherId = null;
    let otherRow = null;
    if (isChild) {
      if (r.other) {
        if (!spouseIds.has(r.other)) return fail(`اختر ${male ? 'الأم' : 'الأب'} من القائمة`);
        otherId = r.other;
      } else if (spouses.length === 1) {
        otherId = spouses[0].person.id;
      } else if (!spouses.length && spouseRows.length === 1) {
        otherRow = spouseRows[0]; // the wife typed on another line of this table
      }
      person.father_id = male ? parent.id : otherId;
      person.mother_id = male ? otherId : parent.id;
    }
    items.push({ row, kind: r.kind, id: null, person, photo: r.photo || null, marriage: r.kind === 'spouse', otherRow });
  });

  items.sort((a, b) => (b.marriage ? 1 : 0) - (a.marriage ? 1 : 0) || a.row - b.row); // spouses first, then in typed order
  return { items, errors };
}

/** Fills in the other parent of children who take the wife added in the same table, once her id is known. */
export function linkNewSpouse(item, parent, newIdByRow) {
  if (item.otherRow == null) return item.person;
  const id = newIdByRow.get(item.otherRow) ?? null;
  const male = parent.gender === 'male';
  return { ...item.person, father_id: male ? parent.id : id, mother_id: male ? id : parent.id };
}

/** A saved information row -> the editable row it becomes when the user presses "edit". */
export function rowFromInfo(r) {
  return {
    kind: r.kind,
    name: r.first_name || '',
    birth: r.birth_date || '',
    death: r.death_date || '',
    other: '',
    photo: null,
    id: r.id,
    extra: {
      last_name: r.last_name || '', phone: r.phone || '', email: r.email || '', notes: r.notes || '',
      deceased: !!r.is_deceased && !r.death_date, birth_place: r.birth_place || '',
      birth_country: r.birth_country || null, birth_province: r.birth_province || null, birth_city: r.birth_city || null,
      residence_country: r.residence_country || null, residence_province: r.residence_province || null, residence_city: r.residence_city || null,
    },
  };
}

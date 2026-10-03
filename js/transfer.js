// Backup / exchange: export and import a tree as JSON (our own format) or GEDCOM 5.5.1
// (the format every genealogy program understands). Pure functions, no DOM, no network.
import { toLatinDigits, countryName, countryByName, placeOf } from './tree.js';

export const FORMAT = 'family-tree-export';
export const VERSION = 1;

// Same limits as the database columns
const LIMITS = { first_name: 100, last_name: 100, nickname: 100, birth_date: 40, birth_place: 100, death_date: 40, notes: 2000, residence_city: 100, residence_province: 100, birth_city: 100, birth_province: 100 };

/** Same rules as the database checks on persons.phone / persons.email. */
export const validPhone = (v) => {
  const t = String(v ?? '').trim();
  const digits = t.replace(/\D/g, '').length;
  return /^\+?[0-9(][0-9 ()-]{3,24}$/.test(t) && digits >= 4 && digits <= 20;
};
export const validEmail = (v) => {
  const t = String(v ?? '').trim();
  return t.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t);
};

const clip = (v, max) => {
  const t = String(v ?? '').trim();
  return t ? t.slice(0, max) : null;
};

// ====================================================================
// JSON
// ====================================================================

/** The whole tree as a plain object (photos are not included: they live in private storage). */
export function toJson(persons, marriages, meta = {}) {
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    treeName: meta.treeName ?? null,
    persons: persons.map((p) => ({
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name ?? null,
      nickname: p.nickname ?? null,
      gender: p.gender,
      father_id: p.father_id ?? null,
      mother_id: p.mother_id ?? null,
      birth_date: p.birth_date ?? null,
      birth_place: p.birth_place ?? null,
      birth_country: p.birth_country ?? null,
      birth_province: p.birth_province ?? null,
      birth_city: p.birth_city ?? null,
      residence_country: p.residence_country ?? null,
      residence_province: p.residence_province ?? null,
      residence_city: p.residence_city ?? null,
      phone: p.phone ?? null,
      email: p.email ?? null,
      is_deceased: !!p.is_deceased,
      death_date: p.death_date ?? null,
      notes: p.notes ?? null,
    })),
    marriages: marriages.map((m) => ({
      person_a: m.person_a,
      person_b: m.person_b,
      marriage_date: m.marriage_date ?? null,
      status: m.status ?? 'married',
    })),
  };
}

/** Parse our JSON export into the neutral import model (see planImport). */
export function fromJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('الملف ليس JSON صالحًا');
  }
  if (!data || data.format !== FORMAT || !Array.isArray(data.persons)) {
    throw new Error('هذا الملف ليس نسخة احتياطية من هذا البرنامج');
  }
  const warnings = [];
  const persons = data.persons.map((p) => ({
    key: String(p.id),
    first_name: p.first_name,
    last_name: p.last_name,
    nickname: p.nickname,
    gender: p.gender,
    father_key: p.father_id ? String(p.father_id) : null,
    mother_key: p.mother_id ? String(p.mother_id) : null,
    birth_date: p.birth_date,
    birth_place: p.birth_place,
    birth_country: p.birth_country,
    birth_province: p.birth_province,
    birth_city: p.birth_city,
    residence_country: p.residence_country,
    residence_province: p.residence_province,
    residence_city: p.residence_city,
    phone: p.phone,
    email: p.email,
    is_deceased: p.is_deceased,
    death_date: p.death_date,
    notes: p.notes,
  }));
  const marriages = (data.marriages || []).map((m) => ({
    a_key: String(m.person_a),
    b_key: String(m.person_b),
    marriage_date: m.marriage_date,
    status: m.status,
  }));
  return { persons, marriages, warnings };
}

// ====================================================================
// GEDCOM export
// ====================================================================

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Free text ("1950", "1950-03-12", "حوالي 1950") -> a GEDCOM DATE value, or null. */
export function toGedcomDate(text) {
  const t = toLatinDigits(text).trim();
  if (!t) return null;
  let m;
  if ((m = t.match(/^(\d{4})$/))) return m[1];
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || 'JAN'} ${m[1]}`;
  if ((m = t.match(/^(\d{4})-(\d{1,2})$/))) return `${MONTHS[Number(m[2]) - 1] || 'JAN'} ${m[1]}`;
  if ((m = t.match(/^(?:حوالي|نحو|تقريبا|تقريباً|about|abt|ca\.?)\s*(\d{4})$/i))) return `ABT ${m[1]}`;
  return `(${t.replace(/[()]/g, '')})`; // GEDCOM "date phrase": keeps the original words
}

/** GEDCOM DATE value -> the free text we store. */
export function fromGedcomDate(value) {
  const t = String(value ?? '').trim();
  if (!t) return null;
  let m;
  if ((m = t.match(/^\((.*)\)$/))) return m[1];
  if ((m = t.match(/^(\d{4})$/))) return m[1];
  if ((m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/))) {
    const mi = MONTHS.indexOf(m[2].toUpperCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  if ((m = t.match(/^([A-Za-z]{3})\s+(\d{4})$/))) {
    const mi = MONTHS.indexOf(m[1].toUpperCase());
    if (mi >= 0) return `${m[2]}-${String(mi + 1).padStart(2, '0')}`;
  }
  if ((m = t.match(/^(?:ABT|CAL|EST)\s+(\d{4})$/i))) return `حوالي ${m[1]}`;
  return t;
}

function pushText(out, level, tag, text) {
  const lines = String(text).split(/\r?\n/);
  out.push(`${level} ${tag} ${lines[0]}`.trimEnd());
  for (const extra of lines.slice(1)) out.push(`${level + 1} CONT ${extra}`.trimEnd());
}

/** GEDCOM 5.5.1 text (UTF-8). Families are built from marriages and from children's parents. */
export function toGedcom(persons, marriages, meta = {}) {
  const byId = new Map(persons.map((p) => [p.id, p]));
  const indiRef = new Map(persons.map((p, i) => [p.id, `@I${i + 1}@`]));

  // families keyed "husband|wife"
  const fams = new Map();
  const fam = (h, w) => {
    const key = `${h || ''}|${w || ''}`;
    if (!fams.has(key)) fams.set(key, { h, w, marriage: null, kids: [] });
    return fams.get(key);
  };
  for (const m of marriages) {
    const a = byId.get(m.person_a);
    const b = byId.get(m.person_b);
    if (!a || !b) continue;
    const [h, w] = a.gender === 'female' && b.gender === 'male' ? [b, a] : [a, b];
    fam(h.id, w.id).marriage = m;
  }
  for (const p of persons) {
    if ((p.father_id && byId.has(p.father_id)) || (p.mother_id && byId.has(p.mother_id))) {
      fam(byId.has(p.father_id) ? p.father_id : null, byId.has(p.mother_id) ? p.mother_id : null).kids.push(p);
    }
  }
  const famList = [...fams.values()];
  famList.forEach((f, i) => (f.ref = `@F${i + 1}@`));

  const asSpouse = new Map();
  const asChild = new Map();
  for (const f of famList) {
    for (const id of [f.h, f.w]) if (id) (asSpouse.get(id) || asSpouse.set(id, []).get(id)).push(f.ref);
    for (const k of f.kids) (asChild.get(k.id) || asChild.set(k.id, []).get(k.id)).push(f.ref);
  }

  const out = ['0 HEAD', '1 SOUR FAMILYTREEAPP', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8'];
  if (meta.treeName) out.push(`1 NOTE ${String(meta.treeName).replace(/\r?\n/g, ' ')}`);

  for (const p of persons) {
    out.push(`0 ${indiRef.get(p.id)} INDI`);
    out.push(`1 NAME ${p.first_name || ''} /${p.last_name || ''}/`);
    out.push(`2 GIVN ${p.first_name || ''}`);
    if (p.last_name) out.push(`2 SURN ${p.last_name}`);
    if (p.nickname) out.push(`2 NICK ${p.nickname}`);
    out.push(`1 SEX ${p.gender === 'female' ? 'F' : 'M'}`);
    const bd = toGedcomDate(p.birth_date);
    // GEDCOM places are "most specific, ..., country": free-text detail, city, province, country
    const gedPlace = (kind) => {
      const { country, province, city } = placeOf(p, kind);
      const parts = [city, province, country ? countryName(country, 'en') : ''].filter(Boolean);
      return parts.filter((x, i) => x.toLowerCase() !== (parts[i - 1] ?? '').toLowerCase());
    };
    const structured = gedPlace('birth');
    const birthPlace = structured.length ? structured.join(', ') : p.birth_place || '';
    if (bd || birthPlace) {
      out.push('1 BIRT');
      if (bd) out.push(`2 DATE ${bd}`);
      if (birthPlace) out.push(`2 PLAC ${birthPlace}`);
      if (structured.length && p.birth_place) pushText(out, 2, 'NOTE', p.birth_place); // the free-text detail
    }
    const place = gedPlace('residence').join(', ');
    if (place) {
      out.push('1 RESI');
      out.push(`2 PLAC ${place}`);
    }
    if (p.is_deceased || p.death_date) {
      const dd = toGedcomDate(p.death_date);
      if (dd) {
        out.push('1 DEAT');
        out.push(`2 DATE ${dd}`);
      } else out.push('1 DEAT Y');
    }
    if (p.phone) out.push(`1 PHON ${p.phone}`);
    if (p.email) out.push(`1 EMAIL ${p.email}`);
    if (p.notes) pushText(out, 1, 'NOTE', p.notes);
    for (const f of asChild.get(p.id) || []) out.push(`1 FAMC ${f}`);
    for (const f of asSpouse.get(p.id) || []) out.push(`1 FAMS ${f}`);
  }

  for (const f of famList) {
    out.push(`0 ${f.ref} FAM`);
    if (f.h) out.push(`1 HUSB ${indiRef.get(f.h)}`);
    if (f.w) out.push(`1 WIFE ${indiRef.get(f.w)}`);
    if (f.marriage) {
      const md = toGedcomDate(f.marriage.marriage_date);
      if (md) {
        out.push('1 MARR');
        out.push(`2 DATE ${md}`);
      } else out.push('1 MARR Y');
      if (f.marriage.status === 'divorced') out.push('1 DIV Y');
    }
    for (const k of f.kids) out.push(`1 CHIL ${indiRef.get(k.id)}`);
  }
  out.push('0 TRLR');
  return out.join('\r\n') + '\r\n';
}

// ====================================================================
// GEDCOM import
// ====================================================================

/** Lines -> [{ level, xref, tag, value }], joining CONT / CONC continuation lines. */
function parseLines(text) {
  const rows = [];
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n|\r/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/);
    if (!m) continue;
    const row = { level: Number(m[1]), xref: m[2] || null, tag: m[3].toUpperCase(), value: (m[4] ?? '').trim() };
    const prev = rows[rows.length - 1];
    if (prev && (row.tag === 'CONT' || row.tag === 'CONC') && row.level === prev.level + 1) {
      prev.value += (row.tag === 'CONT' ? '\n' : '') + (m[4] ?? '');
    } else rows.push(row);
  }
  return rows;
}

/** Group flat rows into records: [{ xref, tag, value, children: [...] }] (recursive). */
function buildRecords(rows) {
  const root = { level: -1, children: [] };
  const stack = [root];
  for (const r of rows) {
    const node = { ...r, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= r.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root.children;
}

const sub = (node, tag) => node.children.find((c) => c.tag === tag);
const subs = (node, tag) => node.children.filter((c) => c.tag === tag);

function parseName(indi) {
  const nameNode = sub(indi, 'NAME');
  if (!nameNode) return { first: '', last: '' };
  let first = sub(nameNode, 'GIVN')?.value || '';
  let last = sub(nameNode, 'SURN')?.value || '';
  if (!first && !last) {
    const m = nameNode.value.match(/^(.*?)\s*\/(.*?)\/\s*(.*)$/);
    if (m) {
      first = [m[1], m[3]].filter(Boolean).join(' ').trim();
      last = m[2].trim();
    } else first = nameNode.value.trim();
  }
  return { first, last };
}

/**
 * "Damascus, Damascus Governorate, Syria" -> { city: "Damascus", province: "Damascus Governorate", country: "SY" }.
 * The last part must be a country we recognise; before it comes "... , city, province" (extra leading
 * parts are ignored). If the last part is not a country the whole text is kept as `whole`, never lost.
 */
function parsePlace(value) {
  const parts = String(value || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return { city: null, province: null, country: null, whole: null };
  const country = countryByName(parts[parts.length - 1]);
  if (!country) return { city: null, province: null, country: null, whole: parts.join(', ') };
  const rest = parts.slice(0, -1);
  return {
    country,
    whole: null,
    city: rest.length >= 2 ? rest[rest.length - 2] : (rest[0] ?? null),
    province: rest.length >= 2 ? rest[rest.length - 1] : null,
  };
}

/** Parse GEDCOM text into the neutral import model (see planImport). */
export function fromGedcom(text) {
  const records = buildRecords(parseLines(text));
  const indis = records.filter((r) => r.tag === 'INDI' && r.xref);
  const fams = records.filter((r) => r.tag === 'FAM' && r.xref);
  if (!indis.length) throw new Error('لم أجد أي أشخاص في الملف. تأكد أنه ملف GEDCOM بترميز UTF-8');

  const warnings = [];
  const persons = new Map();
  for (const indi of indis) {
    const { first, last } = parseName(indi);
    const sex = (sub(indi, 'SEX')?.value || '').trim().toUpperCase().charAt(0);
    const birt = sub(indi, 'BIRT');
    const deat = sub(indi, 'DEAT');
    const resi = subs(indi, 'RESI').at(-1); // the last residence listed is the most recent
    const home = parsePlace(sub(resi || { children: [] }, 'PLAC')?.value);
    const homeWhole = home.whole; // a residence we cannot split still ends up in the city field
    const born = parsePlace(sub(birt || { children: [] }, 'PLAC')?.value);
    persons.set(indi.xref, {
      key: indi.xref,
      first_name: first || last || 'بدون اسم',
      last_name: first ? last : '',
      nickname: sub(sub(indi, 'NAME') || { children: [] }, 'NICK')?.value || sub(indi, 'NICK')?.value || null,
      gender: sex === 'F' ? 'female' : sex === 'M' ? 'male' : null,
      father_key: null,
      mother_key: null,
      birth_date: fromGedcomDate(sub(birt || { children: [] }, 'DATE')?.value),
      // a birthplace we could not split stays whole in the free-text field; otherwise the detail is the BIRT note
      birth_place: born.country ? sub(birt || { children: [] }, 'NOTE')?.value || null : born.whole,
      birth_country: born.country,
      birth_province: born.province,
      birth_city: born.city,
      residence_country: home.country,
      residence_province: home.province,
      residence_city: home.country ? home.city : homeWhole,
      phone: sub(indi, 'PHON')?.value || null,
      email: sub(indi, 'EMAIL')?.value || null,
      is_deceased: !!deat,
      death_date: fromGedcomDate(sub(deat || { children: [] }, 'DATE')?.value),
      notes: subs(indi, 'NOTE').map((n) => n.value).filter(Boolean).join('\n') || null,
    });
  }

  const marriages = [];
  let multiParent = 0;
  for (const f of fams) {
    const h = sub(f, 'HUSB')?.value;
    const w = sub(f, 'WIFE')?.value;
    const hp = persons.get(h);
    const wp = persons.get(w);
    if (hp && !hp.gender) hp.gender = 'male';
    if (wp && !wp.gender) wp.gender = 'female';
    if (hp && wp) {
      const marr = sub(f, 'MARR');
      marriages.push({
        a_key: h,
        b_key: w,
        marriage_date: fromGedcomDate(sub(marr || { children: [] }, 'DATE')?.value),
        status: sub(f, 'DIV') ? 'divorced' : 'married',
      });
    }
    for (const c of subs(f, 'CHIL')) {
      const child = persons.get(c.value);
      if (!child) continue;
      if (child.father_key || child.mother_key) {
        multiParent++; // adopted / step families: keep the first one
        continue;
      }
      child.father_key = hp ? h : null;
      child.mother_key = wp ? w : null;
    }
  }
  if (multiParent) warnings.push(`${multiParent} شخصًا له أكثر من عائلة أصل في الملف؛ أُخذت العائلة الأولى فقط.`);

  const noSex = [...persons.values()].filter((p) => !p.gender);
  for (const p of noSex) p.gender = 'male';
  if (noSex.length) warnings.push(`${noSex.length} شخصًا بلا جنس محدد في الملف أُعطوا «ذكر» مؤقتًا؛ راجعهم بعد الاستيراد.`);

  return { persons: [...persons.values()], marriages, warnings };
}

// ====================================================================
// turning a parsed file into rows to insert
// ====================================================================

/**
 * Builds the rows to insert, with brand-new ids, parents ordered before children (so a
 * bulk insert never points at a row that does not exist yet) and values cut to the
 * database limits.
 * @returns {{ personRows: object[], marriageRows: object[], warnings: string[], stats: object }}
 */
export function planImport(model, newId = () => globalThis.crypto.randomUUID()) {
  const warnings = [...(model.warnings || [])];
  const byKey = new Map();
  for (const p of model.persons) byKey.set(p.key, p);
  const idOf = new Map([...byKey.keys()].map((k) => [k, newId()]));

  // order: a person is placed after their parents; a parent loop is cut
  const order = [];
  const state = new Map(); // key -> 1 visiting, 2 done
  let cut = 0;
  const visit = (key) => {
    if (state.get(key) === 2) return;
    state.set(key, 1);
    const p = byKey.get(key);
    for (const f of ['father_key', 'mother_key']) {
      const pk = p[f];
      if (!pk || !byKey.has(pk)) {
        p[f] = null;
        continue;
      }
      if (state.get(pk) === 1) {
        p[f] = null; // loop
        cut++;
        continue;
      }
      visit(pk);
    }
    state.set(key, 2);
    order.push(key);
  };
  for (const key of byKey.keys()) visit(key);
  if (cut) warnings.push(`${cut} رابط أبوّة دائري أُهمل.`);

  let truncated = 0;
  const cl = (v, f) => {
    const t = clip(v, 10000);
    if (t && t.length > LIMITS[f]) truncated++;
    return clip(v, LIMITS[f]);
  };

  const personRows = order.map((key) => {
    const p = byKey.get(key);
    return {
      id: idOf.get(key),
      first_name: cl(p.first_name, 'first_name') || 'بدون اسم',
      last_name: cl(p.last_name, 'last_name'),
      ...(p.nickname ? { nickname: cl(p.nickname, 'nickname') } : {}), // left out when empty, so a restore works before supabase/014 is run
      gender: p.gender === 'female' ? 'female' : 'male',
      father_id: p.father_key ? idOf.get(p.father_key) : null,
      mother_id: p.mother_key ? idOf.get(p.mother_key) : null,
      birth_date: cl(p.birth_date, 'birth_date'),
      birth_place: cl(p.birth_place, 'birth_place'),
      birth_country: /^[A-Z]{2}$/.test(String(p.birth_country || '')) ? p.birth_country : null,
      birth_province: cl(p.birth_province, 'birth_province'),
      birth_city: cl(p.birth_city, 'birth_city'),
      residence_country: /^[A-Z]{2}$/.test(String(p.residence_country || '')) ? p.residence_country : null,
      residence_province: cl(p.residence_province, 'residence_province'),
      residence_city: cl(p.residence_city, 'residence_city'),
      phone: validPhone(p.phone) ? String(p.phone).trim() : null,
      email: validEmail(p.email) ? String(p.email).trim().toLowerCase() : null,
      is_deceased: !!p.is_deceased,
      death_date: p.is_deceased ? cl(p.death_date, 'death_date') : null,
      notes: cl(p.notes, 'notes'),
    };
  });
  if (truncated) warnings.push(`${truncated} حقلًا نصيًا قُصّ ليناسب الحد الأقصى.`);
  const badContact = model.persons.filter((p) => (p.phone && !validPhone(p.phone)) || (p.email && !validEmail(p.email))).length;
  if (badContact) warnings.push(`${badContact} شخصًا لديهم رقم هاتف أو بريد غير صالح، فأُهمل هذا الحقل وحده.`);

  const seen = new Set();
  const marriageRows = [];
  let skipped = 0;
  for (const m of model.marriages) {
    const a = idOf.get(m.a_key);
    const b = idOf.get(m.b_key);
    const pair = [a, b].sort().join('|');
    if (!a || !b || a === b || seen.has(pair)) {
      skipped++;
      continue;
    }
    seen.add(pair);
    marriageRows.push({
      person_a: a,
      person_b: b,
      marriage_date: cl(m.marriage_date, 'death_date'),
      status: ['married', 'divorced', 'widowed'].includes(m.status) ? m.status : 'married',
    });
  }
  if (skipped) warnings.push(`${skipped} سجل زواج أُهمل (مكرر أو ناقص).`);

  return {
    personRows,
    marriageRows,
    warnings,
    stats: { persons: personRows.length, marriages: marriageRows.length },
  };
}

/** Split rows into chunks (each request to the database stays small). */
export function chunk(rows, size = 400) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

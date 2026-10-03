// Pure family-tree logic: no DOM, no network. Runs in the browser and in plain node (tests).
//
// The chart is PATRILINEAL: a person hangs under their father. Wives are not cards in the
// chart; they live in the husband's details (see spouses / commonChildren). A child whose
// father is unknown hangs under the mother instead, so nobody is ever lost.
//
// Data shape (same as the database):
//   person   { id, first_name, last_name, gender: 'male'|'female', father_id, mother_id,
//              birth_date, death_date, is_deceased, created_at, ... }
//   marriage { id, person_a, person_b, status, marriage_date, created_at }

export const SIZE = { cardW: 172, cardH: 64, hGap: 18, vGap: 68 };

// Height of one "الزوجة الأولى : ..." line under a card, and the gap above the first line.
export const LINE_H = 26; // one wife written under the card: a frame 22px high and a gap of 4px
export const LINES_PAD = 4;
/** How many branch colours the chart cycles through (.br0 … .br7 in style.css). */
export const BRANCH_COUNT = 8;
/** Horizontal design: gap between generation columns, and between stacked siblings. */
const COL_GAP = 64;
const SIB_GAP = 30;
/** Vertical design: padding above and below the cards of a generation band. */
const ROW_PAD = 14;
/** Fan design: radius of the centre disc (the root), width of one generation ring, gap between rings. */
const FAN_CORE = 54;
const FAN_RING = 104;
const FAN_GAP = 4;
/** Natural-tree design: length of the trunk drawn under the root. */
const TRUNK = 90;

const GENERATIONS = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];
/** 0 -> "الأول", 1 -> "الثاني" … (numbers after the tenth) */
export const generationName = (n) => GENERATIONS[n] ?? String(n + 1);

// Colours that tell a person's wives apart in the details panel.
export const SPOUSE_COLORS = ['#c9822b', '#8a5fb3', '#2a8c8c', '#b5527a', '#6b8e23'];

// ---------- text helpers ----------

export function toLatinDigits(s) {
  return String(s ?? '').replace(/[٠-٩۰-۹]/g, (d) => {
    const c = d.charCodeAt(0);
    return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
  });
}

/** First 4-digit year found in free text ("1950", "حوالي ١٩٥٠", "12/03/1950"), or null. */
export function yearOf(text) {
  const m = toLatinDigits(text).match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

/** Lower-case, strip diacritics and unify Arabic letter variants so search is forgiving. */
export function normalize(s) {
  return (
    toLatinDigits(s)
      .toLowerCase()
      // letters that do not decompose: so "Straße", "Ørsted", "Łódź" and the Turkish dotless "ı" match their plain spelling
      .replace(/ß/g, 'ss')
      .replace(/æ/g, 'ae')
      .replace(/œ/g, 'oe')
      .replace(/ø/g, 'o')
      .replace(/[łŀ]/g, 'l')
      .replace(/đ/g, 'd')
      .replace(/ı/g, 'i')
      // accents: "İstanbul", "München", "Köln", "Şanlıurfa" -> "istanbul", "munchen", "koln", "sanliurfa".
      // (Arabic hamza forms decompose here too, and the Arabic rules below give the same result as before.)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// ---------- places ----------
// A person's current residence is stored as an ISO country code ("SY") + a free-text city,
// so people can be grouped by country and city whatever the spelling used.

const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ ' +
  'CA CD CF CG CH CI CK CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ ' +
  'MR MS MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA ' +
  'RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TL TM TN TO TR TT ' +
  'TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

const NAME_OVERRIDES = { ar: { PS: 'فلسطين' }, en: { PS: 'Palestine' } };
const displayNames = {};
/** Country name for an ISO code in the given language ("SY" -> "سوريا"). Falls back to the code. */
export function countryName(code, locale = 'ar') {
  if (!code) return '';
  if (NAME_OVERRIDES[locale]?.[code]) return NAME_OVERRIDES[locale][code];
  try {
    displayNames[locale] ||= new Intl.DisplayNames([locale], { type: 'region' });
    return displayNames[locale].of(code) || code;
  } catch {
    return code;
  }
}

let byNameMap = null;
/** "Syria" / "سوريا" / "syria" -> "SY", or null. Used when importing files from other programs. */
export function countryByName(name) {
  if (!byNameMap) {
    byNameMap = new Map();
    for (const locale of ['ar', 'en']) for (const code of COUNTRY_CODES) byNameMap.set(normalize(countryName(code, locale)), code);
    for (const [alias, code] of [['usa', 'US'], ['united states of america', 'US'], ['uk', 'GB'], ['england', 'GB'], ['great britain', 'GB'], ['palestine', 'PS'], ['uae', 'AE'], ['russia', 'RU'], ['syrian arab republic', 'SY'], ['مصر', 'EG'], ['الامارات', 'AE']]) {
      byNameMap.set(normalize(alias), code);
    }
  }
  return byNameMap.get(normalize(name)) || null;
}

/**
 * A country shown in both languages: "سوريا (Syria)". Used wherever a country is displayed
 * (pickers, filters, results); provinces and cities stay in their own language.
 */
export function countryLabel(code) {
  if (!code) return '';
  const ar = countryName(code, 'ar');
  const en = countryName(code, 'en');
  return ar && en && ar !== en ? `${ar} (${en})` : ar || en || code;
}

/** [{ code, name }] for the country <select>: mixed names, sorted by the Arabic name. */
export function countryList(locale = 'ar') {
  return COUNTRY_CODES.map((code) => ({ code, name: countryLabel(code), sort: countryName(code, locale) })).sort((a, b) => a.sort.localeCompare(b.sort, locale));
}

// A place is three fields: country (ISO code), province (governorate / state, free text chosen
// from a list where we have one) and city. There are two of them per person: where they live now
// ("residence") and where they were born ("birth"; birth_place stays as extra free-text detail).
const PLACE_FIELDS = {
  residence: ['residence_country', 'residence_province', 'residence_city'],
  birth: ['birth_country', 'birth_province', 'birth_city'],
};

/** { country: 'SY' | '', province: 'دمشق' | '', city: '...' | '' } for one of the two places. */
export function placeOf(p, kind = 'residence') {
  const [c, pr, ci] = PLACE_FIELDS[kind];
  return { country: p[c] || '', province: String(p[pr] || '').trim(), city: String(p[ci] || '').trim() };
}

/** "دمشق، سوريا": city, province, country (a part is left out when it repeats the previous one, e.g. city = province). */
export function placeText(p, kind = 'residence') {
  const { country, province, city } = placeOf(p, kind);
  const parts = [city, province, countryLabel(country)].filter(Boolean);
  return parts.filter((x, i) => normalize(x) !== normalize(parts[i - 1] ?? '')).join('، ');
}

export const residenceText = (p) => placeText(p, 'residence');

/** Where born: the structured place plus the free-text detail that older records hold. */
export function birthText(p) {
  return [placeText(p, 'birth'), p.birth_place].filter(Boolean).join(' — ');
}

export function fullName(p) {
  return [p.first_name, p.last_name].filter(Boolean).join(' ');
}

/** A date written without a four-digit year ("حوالي الستينات", "85") is still shown, as it was written. */
const asWritten = (v) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 16 ? `${t.slice(0, 15)}…` : t;
};

/**
 * The name written on a card: the first name, then the father's first name, then the family: "عبد الله يحيى هرموش".
 * With no father on record it is just "first name + family". The father's name is not repeated when the first name
 * already ends with it ("عبد الله يحيى" for a son of يحيى), but a son with the same name as his father keeps both.
 */
export function cardName(index, p) {
  const first = String(p.first_name || '').trim();
  const dad = String(index.byId.get(p.father_id)?.first_name || '').trim();
  const dadNorm = normalize(dad);
  const firstNorm = normalize(first);
  const already = dadNorm && firstNorm !== dadNorm && (firstNorm.endsWith(' ' + dadNorm) || firstNorm === dadNorm + ' ');
  return [first, dad && !already ? dad : '', String(p.last_name || '').trim()].filter(Boolean).join(' ').replace(/\s+/g, ' ');
}

export function lifeSpan(p) {
  const b = yearOf(p.birth_date);
  const d = yearOf(p.death_date);
  if (p.is_deceased || d) {
    const from = b ?? (asWritten(p.birth_date) || null);
    const to = d ?? (asWritten(p.death_date) || null);
    return from || to ? `${from ?? '؟'} – ${to ?? '؟'}` : 'متوفى';
  }
  return b ? String(b) : asWritten(p.birth_date);
}

// ---------- index ----------

function byBirth(a, b) {
  const ya = yearOf(a.birth_date);
  const yb = yearOf(b.birth_date);
  if (ya != null && yb != null && ya !== yb) return ya - yb;
  if (ya != null && yb == null) return -1;
  if (ya == null && yb != null) return 1;
  return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
}

/**
 * Builds lookups once per data change.
 *   byId      id -> person
 *   kids      parentId -> [children by either parent]   (oldest first)
 *   lineKids  parentId -> [children drawn under this parent]  (father's line; mother if no father)
 *   spouses   id -> [{ person, marriage|null }]  (explicit marriages first, then co-parents)
 *   keys      id -> normalized search text (own name + father + mother)
 */
export function buildIndex(persons, marriages = []) {
  const list = [...persons].sort(byBirth);
  const byId = new Map(list.map((p) => [p.id, p]));

  const push = (map, k, v) => {
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(v);
  };

  const kids = new Map();
  const lineKids = new Map();
  for (const p of list) {
    for (const pid of [p.father_id, p.mother_id]) if (pid && byId.has(pid)) push(kids, pid, p);
    const lp = byId.get(p.father_id) || byId.get(p.mother_id);
    if (lp) push(lineKids, lp.id, p);
  }

  const spouses = new Map();
  const link = (a, b, marriage) => {
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!spouses.has(x)) spouses.set(x, []);
      const existing = spouses.get(x).find((s) => s.person.id === y);
      if (existing) {
        if (marriage && !existing.marriage) existing.marriage = marriage;
      } else {
        spouses.get(x).push({ person: byId.get(y), marriage: marriage ?? null });
      }
    }
  };
  const ms = [...marriages].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  for (const m of ms) {
    if (byId.has(m.person_a) && byId.has(m.person_b)) link(m.person_a, m.person_b, m);
  }
  for (const p of list) {
    if (p.father_id && p.mother_id && byId.has(p.father_id) && byId.has(p.mother_id)) {
      link(p.father_id, p.mother_id, null);
    }
  }

  // a man with two wives or more: his children are drawn in groups, the first wife's children first, then the second's ...
  // (the children of an unknown mother last); within a group the oldest first. Everybody else keeps the order of birth.
  for (const [pid, arr] of lineKids) {
    const sp = spouses.get(pid);
    if (!sp || sp.length < 2 || byId.get(pid).gender !== 'male') continue;
    const rank = (c) => {
      const i = sp.findIndex((s) => s.person.id === c.mother_id);
      return i < 0 ? sp.length : i;
    };
    arr.sort((a, b) => rank(a) - rank(b) || byBirth(a, b));
  }

  const keys = new Map();
  for (const p of list) {
    const f = byId.get(p.father_id);
    const m = byId.get(p.mother_id);
    // name + father + mother, plus where they live / were born, so "دمشق" or "سوريا" find people too
    const places = ['residence', 'birth'].flatMap((k) => {
      const { country, province, city } = placeOf(p, k);
      return [city, province, countryName(country, 'ar'), countryName(country, 'en')];
    });
    const contact = [p.email, p.phone, String(p.phone || '').replace(/\D/g, '')]; // so a phone number or an e-mail finds the person
    keys.set(p.id, normalize([fullName(p), p.nickname, f && f.first_name, m && m.first_name, ...places, p.birth_place, ...contact].filter(Boolean).join(' ')));
  }

  return { list, byId, kids, lineKids, spouses, keys };
}

/**
 * People grouped by place: country -> province -> city, with counts. `kind` is 'residence' or 'birth'.
 * Spelling variants of the same name are merged (normalize()); the most common spelling is shown.
 * Returns [{ code, name, count,
 *            provinces: [{ key, name, count, cities: [{ key, name, count }] }],
 *            cities:    [{ key, name, count }]   // every city of the country, whatever its province
 *          }]   biggest first; code '' = "country not set" (always last).
 */
export function placeStats(index, kind = 'residence') {
  const make = () => ({ count: 0, spellings: new Map() });
  const bump = (map, name) => {
    const key = normalize(name);
    if (!map.has(key)) map.set(key, make());
    const e = map.get(key);
    e.count++;
    e.spellings.set(name, (e.spellings.get(name) || 0) + 1);
  };
  const countries = new Map();
  for (const p of index.list) {
    const { country, province, city } = placeOf(p, kind);
    if (!country && !province && !city) continue;
    if (!countries.has(country)) countries.set(country, { count: 0, provinces: new Map(), cities: new Map(), cityByProvince: new Map() });
    const c = countries.get(country);
    c.count++;
    if (province) {
      bump(c.provinces, province);
      const pk = normalize(province);
      if (!c.cityByProvince.has(pk)) c.cityByProvince.set(pk, new Map());
      if (city) bump(c.cityByProvince.get(pk), city);
    }
    if (city) bump(c.cities, city);
  }
  const best = (e) => [...e.spellings.entries()].sort((x, y) => y[1] - x[1])[0][0];
  const list = (map) =>
    [...map.entries()]
      .map(([key, e]) => ({ key, name: best(e), count: e.count }))
      .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name, 'ar'));
  return [...countries.entries()]
    .map(([code, c]) => ({
      code,
      name: code ? countryLabel(code) : 'بلد غير محدد',
      count: c.count,
      provinces: list(c.provinces).map((pv) => ({ ...pv, cities: list(c.cityByProvince.get(pv.key) || new Map()) })),
      cities: list(c.cities),
    }))
    .sort((a, b) => (a.code === '') - (b.code === '') || b.count - a.count || a.name.localeCompare(b.name, 'ar'));
}

/** A place filter: null/undefined = any. { country: null|''|'SY', provinceKey, cityKey, none }. */
function matchPlace(p, kind, f) {
  if (!f) return true;
  const { country, province, city } = placeOf(p, kind);
  if (f.none) return !country && !province && !city; // nothing recorded yet
  if (f.country != null) {
    if (country !== f.country) return false;
    if (f.country === '' && !province && !city) return false; // "country not set" = something recorded, but no country
  }
  if (f.provinceKey != null && normalize(province) !== f.provinceKey) return false;
  if (f.cityKey != null && normalize(city) !== f.cityKey) return false;
  return true;
}

/**
 * The search page: every filter is optional and they all combine.
 *   query      words that must all appear in the name / parents / any place
 *   residence  place filter for where they live now   (see matchPlace)
 *   birth      place filter for where they were born
 *   gender     null | 'male' | 'female'
 *   status     null | 'living' | 'deceased'
 *   sort       'name' (default) | 'age' (oldest first)
 */
export function filterPersons(index, { query = '', residence = null, birth = null, gender = null, status = null, sort = 'name' } = {}) {
  const tokens = normalize(query).split(' ').filter(Boolean);
  const out = index.list.filter((p) => {
    if (gender && p.gender !== gender) return false;
    if (status === 'deceased' && !p.is_deceased) return false;
    if (status === 'living' && p.is_deceased) return false;
    if (!matchPlace(p, 'residence', residence) || !matchPlace(p, 'birth', birth)) return false;
    if (tokens.length) {
      const key = index.keys.get(p.id);
      if (!tokens.every((t) => key.includes(t))) return false;
    }
    return true;
  });
  if (sort === 'name') out.sort((a, b) => fullName(a).localeCompare(fullName(b), 'ar'));
  else if (sort === 'age') out.sort((a, b) => (yearOf(a.birth_date) ?? 9999) - (yearOf(b.birth_date) ?? 9999));
  return out;
}

const ORD_F = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة'];
const ORD_M = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];

/** "الزوجة" for a single wife, "الزوجة الثانية" when there are several ("الزوج ..." for a woman). */
export function spouseLabel(person, i, total) {
  const wife = person.gender === 'male';
  const base = wife ? 'الزوجة' : 'الزوج';
  if (total < 2) return base;
  const ord = (wife ? ORD_F : ORD_M)[i];
  return ord ? `${base} ${ord}` : `${base} ${i + 1}`;
}

/** Lines shown under a card: ["الزوجة الأولى : مريم", "الزوجة الثانية : حصة"]. */
export function spouseLines(index, person) {
  const sp = index.spouses.get(person.id) || [];
  return sp.map((s, i) => `${spouseLabel(person, i, sp.length)} : ${fullName(s.person)}`);
}

/** Children shared by two people (either way round). */
export function commonChildren(index, aId, bId) {
  return (index.kids.get(aId) || []).filter((c) => c.father_id === bId || c.mother_id === bId);
}

/** Who this person hangs under in the chart: the father, else the mother, else nobody. */
export function lineParent(index, p) {
  return index.byId.get(p.father_id) || index.byId.get(p.mother_id) || null;
}

/** Persons matching every word of the query (used by the search box and pickers). */
export function search(index, query, { limit = 20, filter } = {}) {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const out = [];
  for (const p of index.list) {
    if (filter && !filter(p)) continue;
    const key = index.keys.get(p.id);
    if (tokens.every((t) => key.includes(t))) {
      out.push(p);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** "محمد أحمد — ابن أحمد (1950)" — enough context to tell namesakes apart. */
export function describe(index, p) {
  const father = index.byId.get(p.father_id);
  const y = yearOf(p.birth_date);
  return (
    fullName(p) +
    (father ? ` — ${p.gender === 'male' ? 'ابن' : 'ابنة'} ${father.first_name}` : '') +
    (y ? ` (${y})` : '')
  );
}

// ---------- walking the graph ----------

/** id + everyone above it in the chart (follows lineParent). */
export function lineAncestorsOf(index, id) {
  const seen = new Set();
  let cur = index.byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = lineParent(index, cur);
  }
  return seen;
}

/** id + every descendant. line=true follows only what the chart draws under each person. */
export function descendantsOf(index, id, { line = false } = {}) {
  const map = line ? index.lineKids : index.kids;
  const seen = new Set([id]);
  const stack = [id];
  while (stack.length) {
    for (const c of map.get(stack.pop()) || []) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        stack.push(c.id);
      }
    }
  }
  return seen;
}

/** The oldest person above `id` in the chart. */
export function topAncestor(index, id) {
  const chain = lineAncestorsOf(index, id);
  let top = null;
  for (const x of chain) top = x; // Set keeps insertion order: last one added is the top
  return top;
}

/** The person with no ancestors and the biggest line below them (males win ties). */
export function defaultRoot(index) {
  let best = null;
  let bestN = -1;
  for (const p of index.list) {
    if (lineParent(index, p)) continue;
    const n = descendantsOf(index, p.id, { line: true }).size;
    if (n > bestN || (n === bestN && p.gender === 'male' && best.gender !== 'male')) {
      best = p;
      bestN = n;
    }
  }
  return best ? best.id : index.list[0]?.id ?? null;
}

// ---------- hierarchy + layout ----------

/**
 * Descendant tree from `rootId`, one node per person, children oldest first.
 * node = { id, person, depth, children, totalKids, collapsed }
 */
/**
 * Which wife of a man (in the order of his wives) is this child's mother? -1 when he has fewer than two wives,
 * when the child does not hang under him, or when the mother is not one of his wives.
 */
export function wifeIndex(index, fatherId, child) {
  const father = index.byId.get(fatherId);
  const sp = father && father.gender === 'male' ? index.spouses.get(fatherId) : null;
  if (!sp || sp.length < 2 || child.father_id !== fatherId) return -1;
  return sp.findIndex((s) => s.person.id === child.mother_id);
}

export function buildHierarchy(index, rootId, collapsed = new Set(), { hide = null } = {}) {
  const { byId, lineKids } = index;
  if (!byId.has(rootId)) return null;
  const placed = new Set();

  const make = (id, depth, wife = -1) => {
    placed.add(id);
    // `hide(person)` leaves people out together with everyone drawn under them (the root itself is always drawn)
    const all = hide ? (lineKids.get(id) || []).filter((c) => !hide(c)) : lineKids.get(id) || [];
    const node = { id, person: byId.get(id), depth, children: [], totalKids: all.length, collapsed: false, wife }; // wife: which of the father's wives is the mother (-1: none to show)
    if (!all.length) return node;
    if (collapsed.has(id)) {
      node.collapsed = true;
      return node;
    }
    for (const c of all) if (!placed.has(c.id)) node.children.push(make(c.id, depth + 1, wifeIndex(index, id, c)));
    return node;
  };

  return make(rootId, 0);
}

/** Collapse deep generations automatically when the tree is big. */
export function autoCollapse(index, rootId, { depth = 3, limit = 150 } = {}) {
  const out = new Set();
  const root = buildHierarchy(index, rootId);
  if (!root) return out;
  let total = 0;
  const count = (n) => {
    total++;
    n.children.forEach(count);
  };
  count(root);
  if (total <= limit) return out;
  const walk = (n) => {
    if (n.depth >= depth && n.children.length) out.add(n.id);
    else n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/**
 * Positions every card. Returns { cards, edges, bounds, rows, orientation }.
 * Cards:  { personId, x, y, w, h, lines, extra, node }   (lines = text drawn under the card)
 * Edges:  vertical   { x1, y1, busY, x2, y2, branch, depth }  drawn as  M x1,y1 V busY H x2 V y2
 *         horizontal { x1, y1, busX, x2, y2, branch }  drawn as  M x1,y1 H busX V y2 H x2
 * Rows:   vertical design only: { depth, top, h } of every generation band
 * Other designs (orientation 'fan' | 'tree') are described at layoutFan / layoutTreeShape.
 * With rtl the whole drawing is mirrored so the eldest child is on the right
 * (horizontal: the root is on the right and the generations grow to the left).
 * `lines(personId) -> string[]` is optional; every generation row is made tall enough for
 * its longest list so connectors never cross the text.
 * Every node also gets `branch`: -1 for the root, and for everyone below the index (0, 1, 2 …)
 * of the root's child they descend from, so a whole branch can share a colour. A child of the
 * root with nobody below them is no branch (-1), but still uses up their index so colours stay put.
 */
export function layout(root, { rtl = true, size = SIZE, lines = null, orientation = 'vertical' } = {}) {
  if (orientation === 'horizontal') return layoutHorizontal(root, { rtl, size, lines });
  if (orientation === 'fan') return layoutFan(root, { rtl });
  if (orientation === 'tree') return layoutTreeShape(root, { rtl, size });
  const { cardW, cardH, hGap, vGap, head = 0 } = size; // head: the part of a card that rises above its top edge (counted in cardH)
  const cards = [];
  const edges = [];
  const rowExtra = [];

  const measure = (n, branch) => {
    n.branch = branch;
    n.lines = lines ? lines(n.id) : [];
    n.extra = n.lines.length ? n.lines.length * LINE_H + LINES_PAD : 0;
    rowExtra[n.depth] = Math.max(rowExtra[n.depth] || 0, n.extra);
    let kidsW = 0;
    n.children.forEach((c, i) => {
      kidsW += measure(c, n.depth === 0 ? (c.totalKids ? i % BRANCH_COUNT : -1) : branch);
    });
    if (n.children.length) kidsW += hGap * (n.children.length - 1);
    n.kidsW = kidsW;
    n.subW = Math.max(cardW, kidsW);
    return n.subW;
  };

  measure(root, -1);
  const rowTop = [0];
  for (let d = 1; d < rowExtra.length; d++) rowTop[d] = rowTop[d - 1] + cardH + rowExtra[d - 1] + vGap;
  const rows = rowTop.map((top, depth) => ({ depth, top: top - ROW_PAD, h: cardH + rowExtra[depth] + 2 * ROW_PAD }));

  // A parent sits midway between its first and last child card. That stays inside the
  // parent's own subtree block, so neighbours in the same row can never overlap.
  const place = (n, left) => {
    n.y = rowTop[n.depth];
    const card = { personId: n.id, x: 0, y: n.y, w: cardW, h: cardH, lines: n.lines, extra: n.extra, node: n };
    cards.push(card); // parents are pushed before their children, so cards[0] is the root

    let cx = left + (n.subW - n.kidsW) / 2;
    for (const c of n.children) {
      place(c, cx);
      cx += c.subW + hGap;
    }
    const kids = n.children;
    n.x = kids.length ? (kids[0].x + kids[kids.length - 1].x) / 2 : left + (n.subW - cardW) / 2;
    card.x = n.x;

    const busY = n.y + cardH + rowExtra[n.depth] + vGap / 2;
    for (const c of kids) edges.push({ x1: n.x + cardW / 2, y1: n.y + cardH + n.extra, busY, x2: c.x + cardW / 2, y2: c.y, branch: c.branch, depth: n.depth, wife: c.wife });
  };

  place(root, 0);

  if (rtl) {
    for (const c of cards) c.x = -(c.x + c.w);
    for (const e of edges) {
      e.x1 = -e.x1;
      e.x2 = -e.x2;
    }
  }
  return { cards, edges, bounds: boundsOf(cards), rows, orientation: 'vertical', head };
}

function boundsOf(cards) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cards) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + c.w);
    maxY = Math.max(maxY, c.y + c.h + c.extra);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Same tree turned on its side: one column per generation, siblings stacked top to bottom. */
function layoutHorizontal(root, { rtl, size, lines }) {
  const { cardW, cardH, head = 0 } = size;
  const mid = head + (cardH - head) / 2; // the middle of the card itself, not of the part that rises above it
  const cards = [];
  const edges = [];

  const measure = (n, branch) => {
    n.branch = branch;
    n.lines = lines ? lines(n.id) : [];
    n.extra = n.lines.length ? n.lines.length * LINE_H + LINES_PAD : 0;
    n.own = cardH + n.extra; // the card and the wives written under it
    let kidsH = 0;
    n.children.forEach((c, i) => {
      kidsH += measure(c, n.depth === 0 ? (c.totalKids ? i % BRANCH_COUNT : -1) : branch);
    });
    if (n.children.length) kidsH += SIB_GAP * (n.children.length - 1);
    n.kidsH = kidsH;
    n.subH = Math.max(n.own, kidsH);
    return n.subH;
  };
  measure(root, -1);

  const place = (n, top) => {
    n.x = n.depth * (cardW + COL_GAP);
    const card = { personId: n.id, x: n.x, y: 0, w: cardW, h: cardH, lines: n.lines, extra: n.extra, node: n };
    cards.push(card);

    let cy = top + (n.subH - n.kidsH) / 2;
    for (const c of n.children) {
      place(c, cy);
      cy += c.subH + SIB_GAP;
    }
    const kids = n.children;
    const ideal = kids.length ? (kids[0].y + kids[kids.length - 1].y) / 2 : top + (n.subH - n.own) / 2;
    n.y = Math.min(Math.max(ideal, top), top + n.subH - n.own); // never leave its own block
    card.y = n.y;

    for (const c of kids) {
      edges.push({ x1: n.x + cardW, y1: n.y + mid, busX: n.x + cardW + COL_GAP / 2, x2: c.x, y2: c.y + mid, branch: c.branch, wife: c.wife });
    }
  };
  place(root, 0);

  if (rtl) {
    for (const c of cards) c.x = -(c.x + c.w);
    for (const e of edges) {
      e.x1 = -e.x1;
      e.busX = -e.busX;
      e.x2 = -e.x2;
    }
  }
  return { cards, edges, bounds: boundsOf(cards), rows: null, orientation: 'horizontal', head };
}

/** [inner, outer] radius of generation ring `d` (d >= 1) in the fan design. */
export const fanRadii = (d) => {
  const r0 = FAN_CORE + FAN_GAP + (d - 1) * FAN_RING;
  return [r0, r0 + FAN_RING - FAN_GAP];
};
export const FAN_ROOT_RADIUS = FAN_CORE;

/** Point at distance r from the centre and `deg` degrees (0 = right, 90 = up), in screen coordinates. */
export const polar = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [r * Math.cos(a), -r * Math.sin(a)];
};

/**
 * Half-circle fan: the root is a disc in the centre, every generation is a ring around it, and each person
 * gets a slice of their parent's slice, as wide as the number of people (leaves) below them.
 * Returns { cards, edges: [], sectors, bounds, rows: null, orientation: 'fan' } where a sector is
 * { personId, node, depth, a0, a1, r0, r1 } (angles in degrees, a0 < a1). With rtl the eldest child is on the right.
 * `cards` are tiny boxes at the middle of each slice so centring on a person still works.
 */
function layoutFan(root, { rtl }) {
  const cards = [];
  const sectors = [];
  let maxDepth = 0;
  const weigh = (n, branch) => {
    n.branch = branch;
    n.lines = [];
    n.extra = 0;
    maxDepth = Math.max(maxDepth, n.depth);
    let leaves = 0;
    n.children.forEach((c, i) => {
      leaves += weigh(c, n.depth === 0 ? (c.totalKids ? i % BRANCH_COUNT : -1) : branch);
    });
    n.leaves = Math.max(1, leaves);
    return n.leaves;
  };
  weigh(root, -1);

  const place = (n, f0, f1) => {
    const [a0, a1] = rtl ? [180 * f0, 180 * f1] : [180 * (1 - f1), 180 * (1 - f0)];
    const [r0, r1] = n.depth === 0 ? [0, FAN_CORE] : fanRadii(n.depth);
    const [mx, my] = n.depth === 0 ? [0, 0] : polar((r0 + r1) / 2, (a0 + a1) / 2);
    cards.push({ personId: n.id, x: mx - 4, y: my - 4, w: 8, h: 8, lines: [], extra: 0, node: n });
    sectors.push({ personId: n.id, node: n, depth: n.depth, a0, a1, r0, r1 });
    let f = f0;
    for (const c of n.children) {
      const share = ((f1 - f0) * c.leaves) / n.leaves;
      place(c, f, f + share);
      f += share;
    }
  };
  place(root, 0, 1);

  const rMax = maxDepth ? fanRadii(maxDepth)[1] : FAN_CORE;
  const bounds = { minX: -rMax, maxX: rMax, minY: -rMax, maxY: FAN_CORE, w: 2 * rMax, h: rMax + FAN_CORE };
  return { cards, edges: [], sectors, bounds, rows: null, orientation: 'fan' };
}

/**
 * The classic layout turned upside down: the root stands at the bottom on a trunk and the generations
 * branch upwards, with curved boughs that get thinner with every generation.
 * Edges: { x1, y1, x2, y2, w, branch } (parent's top -> child's bottom, w = thickness); trunk: { x, y, h }.
 * Wives are not written under the cards in this design (they stay in the side panel).
 */
function layoutTreeShape(root, { rtl, size }) {
  const res = layout(root, { rtl, size, lines: null, orientation: 'vertical' });
  const bottom = res.bounds.maxY;
  const flip = (y, h = 0) => bottom - y - h;
  for (const c of res.cards) c.y = flip(c.y, c.h);
  for (const e of res.edges) {
    e.y1 = flip(e.y1);
    e.y2 = flip(e.y2);
    e.w = Math.max(2.5, 11 - e.depth * 2.6);
    delete e.busY;
  }
  const top = res.cards[0];
  const bounds = boundsOf(res.cards);
  bounds.maxY += TRUNK;
  bounds.h += TRUNK;
  return { cards: res.cards, edges: res.edges, bounds, rows: null, trunk: { x: top.x + top.w / 2, y: top.y + top.h, h: TRUNK }, orientation: 'tree', head: res.head };
}

/** Everyone above `p` on the father's side: father, grandfather … up to the first ancestor on record (father first). */
export function fatherLine(index, p) {
  const out = [];
  const seen = new Set([p.id]);
  for (let cur = index.byId.get(p.father_id); cur && !seen.has(cur.id); cur = index.byId.get(cur.father_id)) {
    out.push(cur);
    seen.add(cur.id);
  }
  return out;
}

/** The mother's side: the mother first, then her father, grandfather … (empty when no mother is on record). */
export function motherLine(index, p) {
  const m = index.byId.get(p.mother_id);
  return m ? [m, ...fatherLine(index, m)] : [];
}

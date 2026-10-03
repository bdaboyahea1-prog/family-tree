import assert from 'node:assert/strict';
import {
  buildIndex, buildHierarchy, layout, autoCollapse, defaultRoot, topAncestor, lineAncestorsOf,
  descendantsOf, commonChildren, lineParent, spouseLabel, spouseLines, search, yearOf, normalize, lifeSpan,
  LINE_H, LINES_PAD, SIZE,
} from '../js/tree.js';

let n = 0;
const P = (id, first, gender, o = {}) => ({ id, first_name: first, last_name: 'الأحمد', gender, father_id: null, mother_id: null, birth_date: null, death_date: null, is_deceased: false, created_at: String(++n).padStart(4, '0'), ...o });

// G has wives W1, W2.  Children: A,B (W1)  C (W2)  E (unknown mother).
// D is a child of W2 alone (father not recorded).  A married AW -> A1, A2.
// Daughter E married H (outside the family) -> E1 (father H). E also has E2 with no recorded father.
const persons = [
  P('G', 'أحمد', 'male', { birth_date: '1920' }),
  P('W1', 'فاطمة', 'female', { birth_date: '1925' }),
  P('W2', 'خديجة', 'female', { birth_date: '1930' }),
  P('A', 'محمد', 'male', { father_id: 'G', mother_id: 'W1', birth_date: '1945' }),
  P('B', 'علي', 'male', { father_id: 'G', mother_id: 'W1', birth_date: '1948' }),
  P('C', 'عمر', 'male', { father_id: 'G', mother_id: 'W2', birth_date: '1955' }),
  P('D', 'سارة', 'female', { mother_id: 'W2', birth_date: '1940' }),
  P('E', 'هدى', 'female', { father_id: 'G', birth_date: '1950' }),
  P('AW', 'مريم', 'female', { birth_date: '1950', last_name: 'العلي' }),
  P('A1', 'خالد', 'male', { father_id: 'A', mother_id: 'AW', birth_date: '1975' }),
  P('A2', 'منى', 'female', { father_id: 'A', mother_id: 'AW', birth_date: '1978' }),
  P('H', 'ناصر', 'male', { birth_date: '1948', last_name: 'الحربي' }),
  P('E1', 'هند', 'female', { father_id: 'H', mother_id: 'E', birth_date: '1975' }),
  P('E2', 'فهد', 'male', { mother_id: 'E', birth_date: '1980' }),
];
const marriages = [
  { id: 'm1', person_a: 'G', person_b: 'W1', created_at: '1' },
  { id: 'm2', person_a: 'W2', person_b: 'G', created_at: '2' },
];
const idx = buildIndex(persons, marriages);

// ---- spouses, common children ----
assert.deepEqual(idx.spouses.get('G').map((s) => s.person.id), ['W1', 'W2']);
assert.deepEqual(idx.spouses.get('A').map((s) => s.person.id), ['AW']);      // implied by shared children
assert.deepEqual(idx.spouses.get('E').map((s) => s.person.id), ['H']);
assert.deepEqual(commonChildren(idx, 'G', 'W1').map((c) => c.id), ['A', 'B']);
assert.deepEqual(commonChildren(idx, 'G', 'W2').map((c) => c.id), ['C']);
assert.deepEqual(commonChildren(idx, 'W1', 'G').map((c) => c.id), ['A', 'B']);
assert.deepEqual(commonChildren(idx, 'E', 'H').map((c) => c.id), ['E1']);

// ---- wife labels ----
const G = idx.byId.get('G');
assert.equal(spouseLabel(G, 0, 1), 'الزوجة');
assert.deepEqual([0, 1, 2, 3].map((i) => spouseLabel(G, i, 4)), ['الزوجة الأولى', 'الزوجة الثانية', 'الزوجة الثالثة', 'الزوجة الرابعة']);
assert.equal(spouseLabel(G, 10, 12), 'الزوجة 11');
assert.equal(spouseLabel(idx.byId.get('E'), 1, 2), 'الزوج الثاني');
assert.deepEqual(spouseLines(idx, G), ['الزوجة الأولى : فاطمة الأحمد', 'الزوجة الثانية : خديجة الأحمد']);
assert.deepEqual(spouseLines(idx, idx.byId.get('A')), ['الزوجة : مريم العلي']);
assert.deepEqual(spouseLines(idx, idx.byId.get('B')), []);

// ---- line parent: father, else mother ----
assert.equal(lineParent(idx, idx.byId.get('A')).id, 'G');
assert.equal(lineParent(idx, idx.byId.get('D')).id, 'W2');
assert.equal(lineParent(idx, idx.byId.get('E1')).id, 'H');     // father wins over mother
assert.equal(lineParent(idx, idx.byId.get('G')), null);

// ---- the chart is patrilineal ----
const h = buildHierarchy(idx, 'G');
assert.deepEqual(h.children.map((c) => c.id), ['A', 'B', 'C', 'E']);        // G has two wives: by mother (first wife's A and B, the second wife's C), the child of an unknown mother last
const eNode = h.children.find((c) => c.id === 'E');
assert.deepEqual(eNode.children.map((c) => c.id), ['E2']);                    // child with no recorded father hangs under mother
const ids = [];
const walk = (x) => { ids.push(x.id); x.children.forEach(walk); };
walk(h);
for (const gone of ['W1', 'W2', 'AW', 'H', 'E1', 'D']) assert.ok(!ids.includes(gone), gone + ' must not be in this chart');
assert.deepEqual([...ids].sort(), ['A', 'A1', 'A2', 'B', 'C', 'E', 'E2', 'G']);

assert.deepEqual(buildHierarchy(idx, 'H').children.map((c) => c.id), ['E1']);
assert.equal(topAncestor(idx, 'E1'), 'H');
assert.equal(topAncestor(idx, 'A1'), 'G');
assert.equal(topAncestor(idx, 'E2'), 'G');
assert.equal(topAncestor(idx, 'AW'), 'AW');
assert.deepEqual([...lineAncestorsOf(idx, 'A1')], ['A1', 'A', 'G']);
assert.equal(descendantsOf(idx, 'G', { line: true }).size, 8);
assert.equal(descendantsOf(idx, 'E').size, 3);                                // E, E1, E2 by either parent
assert.equal(defaultRoot(idx), 'G');

// ---- layout ----
const noOverlap = (L, rtl) => {
  const rows = new Map();
  for (const c of L.cards) { if (!rows.has(c.y)) rows.set(c.y, []); rows.get(c.y).push(c); }
  for (const cs of rows.values()) {
    cs.sort((a, b) => a.x - b.x);
    for (let i = 1; i < cs.length; i++) assert.ok(cs[i].x >= cs[i - 1].x + cs[i - 1].w, `overlap rtl=${rtl}`);
  }
};
for (const rtl of [false, true]) {
  const L = layout(h, { rtl });
  noOverlap(L, rtl);
  assert.equal(L.cards.length, 8);
  assert.equal(L.edges.length, 7);
}
const R = layout(h, { rtl: true });
const x = (id) => R.cards.find((c) => c.personId === id).x;
assert.ok(x('A') > x('B') && x('B') > x('C') && x('C') > x('E'), 'children of the first wife on the right, then the second wife, an unknown mother last');

const L0 = layout(h, { rtl: false });
const gx = L0.cards.find((c) => c.personId === 'G');
const kx = h.children.map((c) => L0.cards.find((k) => k.personId === c.id));
const mid = (Math.min(...kx.map((k) => k.x)) + Math.max(...kx.map((k) => k.x + k.w))) / 2;
assert.ok(Math.abs(gx.x + gx.w / 2 - mid) < 1, 'parent centred over children');

// ---- layout with wife lines under the cards ----
const lines = (id) => spouseLines(idx, idx.byId.get(id));
const W = layout(h, { rtl: true, lines });
const gc = W.cards.find((c) => c.personId === 'G');
assert.deepEqual(gc.lines.length, 2);
assert.equal(gc.extra, 2 * LINE_H + LINES_PAD);
const ac = W.cards.find((c) => c.personId === 'A');
assert.equal(ac.extra, LINE_H + LINES_PAD);
const bc = W.cards.find((c) => c.personId === 'B');
assert.equal(bc.extra, 0);
// row 1 is pushed down by exactly the extra height of row 0 (+ row 1's own extra does not matter for row 1's top)
assert.equal(ac.y, SIZE.cardH + gc.extra + SIZE.vGap);
assert.equal(ac.y, bc.y);                                   // same generation = same top, whatever each card carries
// edges from a card start BELOW its own text and the bus sits below the tallest text of the row
const eG = W.edges.filter((e) => Math.abs(e.x1 - (gc.x + gc.w / 2)) < 1e-6);
assert.equal(eG.length, 4);
for (const e of eG) { assert.equal(e.y1, gc.y + gc.h + gc.extra); assert.ok(e.busY > e.y1 && e.busY < e.y2); }
noOverlap(W, true);
// bounds include the text of the last row
const maxBottom = Math.max(...W.cards.map((c) => c.y + c.h + c.extra));
assert.equal(W.bounds.maxY, maxBottom);
// without lines nothing changes
assert.equal(layout(h, { rtl: true, lines: null }).cards.every((c) => c.extra === 0), true);

// ---- collapse ----
const hc = buildHierarchy(idx, 'G', new Set(['A']));
const a = hc.children.find((c) => c.id === 'A');
assert.equal(a.collapsed, true); assert.equal(a.totalKids, 2); assert.equal(a.children.length, 0);
assert.equal(autoCollapse(idx, 'G').size, 0);

// ---- cousin marriage: each person once ----
const p2 = [...persons, P('X', 'س', 'male', { father_id: 'G', mother_id: 'W1' }), P('Y', 'ص', 'female', { father_id: 'G', mother_id: 'W2' }), P('Z', 'ع', 'male', { father_id: 'X', mother_id: 'Y' })];
const idx2 = buildIndex(p2, marriages);
const seen = [];
const walk2 = (nd) => { seen.push(nd.id); nd.children.forEach(walk2); };
walk2(buildHierarchy(idx2, 'G'));
assert.equal(new Set(seen).size, seen.length, 'each person placed once');
assert.ok(seen.includes('Z') && seen.includes('Y'));

// ---- a parent loop must not hang ----
const li = buildIndex([P('L1', 'a', 'male', { father_id: 'L2' }), P('L2', 'b', 'male', { father_id: 'L1' })]);
assert.ok(topAncestor(li, 'L1'));
buildHierarchy(li, 'L1');

// ---- search & helpers ----
assert.ok(search(idx, 'محمد').some((p) => p.id === 'A'));
assert.ok(search(idx, 'فاطمه').some((p) => p.id === 'W1'));
assert.ok(search(idx, 'خالد احمد').some((p) => p.id === 'A1'));
assert.equal(yearOf('حوالي ١٩٥٠'), 1950);
assert.equal(normalize('أَحْمَدُ'), 'احمد');
assert.equal(lifeSpan({ birth_date: '1950', death_date: '2020', is_deceased: true }), '1950 – 2020');
assert.equal(lifeSpan({ is_deceased: true }), 'متوفى');
assert.equal(lifeSpan({ birth_date: '1985' }), '1985');
assert.equal(lifeSpan({}), '', 'a living person with no date: nothing');
assert.equal(lifeSpan({ birth_date: 'حوالي الستينات' }), 'حوالي الستينات', 'a date without a year is shown as it was written');
assert.equal(lifeSpan({ birth_date: '85', is_deceased: true, death_date: '2010' }), '85 – 2010', 'a year and a loose date side by side');
assert.equal(lifeSpan({ birth_date: '  ' }), '');
assert.equal(lifeSpan({ birth_date: 'x'.repeat(40) }).length, 16, 'long text is cut');

// ---- performance ----
const big = [P('R', 'جذر', 'male')];
let frontier = ['R'];
let k = 0;
for (let g = 0; g < 6 && big.length < 5000; g++) {
  const next = [];
  for (const f of frontier) for (let i = 0; i < 5 && big.length < 5000; i++) { const id = 'n' + k++; big.push(P(id, 'ن' + id, i % 2 ? 'male' : 'female', { father_id: f, birth_date: String(1900 + g * 25 + i) })); next.push(id); }
  frontier = next;
}
const t0 = performance.now();
const bi = buildIndex(big, []);
const root = defaultRoot(bi);
const bl = layout(buildHierarchy(bi, root, autoCollapse(bi, root)), { lines: (id) => spouseLines(bi, bi.byId.get(id)) });
console.log('5000 persons ->', bl.cards.length, 'cards,', Math.round(performance.now() - t0), 'ms');
console.log('ALL OK');

// ---------- places ----------
{
  const { countryName, countryList, placeOf, placeText, residenceText, birthText, placeStats, filterPersons, buildIndex: bx, search: sx } = await import('../js/tree.js');
  assert.equal(countryName('SY'), 'سوريا');
  assert.equal(countryName('EG'), 'مصر');
  assert.equal(countryName('PS'), 'فلسطين');
  assert.equal(countryName('SY', 'en'), 'Syria');
  const { countryLabel } = await import('../js/tree.js');
  assert.equal(countryLabel('SY'), 'سوريا (Syria)');
  assert.equal(countryLabel('PS'), 'فلسطين (Palestine)');
  assert.equal(countryLabel('DE'), 'ألمانيا (Germany)');
  assert.equal(countryLabel(''), '');
  assert.equal(countryName(''), '');
  const list = countryList();
  assert.ok(list.length > 200 && list.every((c) => /^[A-Z]{2}$/.test(c.code)), 'country list');
  assert.ok(list.some((c) => c.code === 'SY' && c.name === 'سوريا (Syria)'));

  const mk = (id, first, o = {}) => ({ id, first_name: first, last_name: 'ع', gender: 'male', father_id: null, mother_id: null, birth_date: null, created_at: id, is_deceased: false, ...o });
  const R = (country, province, city) => ({ residence_country: country, residence_province: province, residence_city: city });
  const B = (country, province, city, detail) => ({ birth_country: country, birth_province: province, birth_city: city, birth_place: detail ?? null });

  // text
  assert.deepEqual(placeOf(mk('x', 'a', R('SY', ' ريف دمشق ', 'دوما'))), { country: 'SY', province: 'ريف دمشق', city: 'دوما' });
  assert.equal(placeText(mk('x', 'a', R('SY', 'ريف دمشق', 'دوما'))), 'دوما، ريف دمشق، سوريا (Syria)');
  assert.equal(placeText(mk('x', 'a', R('SY', 'دمشق', 'دمشق'))), 'دمشق، سوريا (Syria)', 'city = province is shown once');
  assert.equal(residenceText(mk('x', 'a', R('SY', null, null))), 'سوريا (Syria)');
  assert.equal(residenceText(mk('x', 'a')), '');
  assert.equal(placeText(mk('x', 'a', B('EG', 'القاهرة', 'حلوان')), 'birth'), 'حلوان، القاهرة، مصر (Egypt)');
  assert.equal(birthText(mk('x', 'a', B('EG', 'القاهرة', 'حلوان', 'مستشفى الدمرداش'))), 'حلوان، القاهرة، مصر (Egypt) — مستشفى الدمرداش');
  assert.equal(birthText(mk('x', 'a', { birth_place: 'حمص' })), 'حمص', 'old records keep working');

  const people = [
    mk('1', 'احمد', { ...R('SY', 'دمشق', 'دمشق'), ...B('SY', 'حمص', 'حمص') }),
    mk('2', 'علي', { ...R('SY', 'دمشق', 'دمشق'), ...B('SY', 'دمشق', 'دمشق'), gender: 'male' }),
    mk('3', 'سعيد', { ...R('SY', 'ريف دمشق', 'دوما'), ...B('SY', 'ريف دمشق', 'دوما') }),
    mk('4', 'منى', { ...R('EG', 'القاهرة', 'القاهرة'), ...B('SY', 'حلب', 'حلب'), gender: 'female' }),
    mk('5', 'هدى', { ...R('EG', 'القاهرة', 'القاهره'), gender: 'female' }),                  // same city, another spelling
    mk('6', 'كريم', { ...R('DE', 'برلين', 'برلين'), ...B('SY', 'حلب', 'حلب') }),
    mk('7', 'نور', { residence_city: 'باريس' }),                                           // a city with no country
    mk('8', 'بلا', {}),
    mk('9', 'مولود', { birth_place: 'طرطوس' }),                                             // legacy free text only
  ];
  const ix = bx(people, []);

  // stats: country -> province -> city
  const res = placeStats(ix, 'residence');
  assert.deepEqual(res.map((c) => [c.code, c.count]), [['SY', 3], ['EG', 2], ['DE', 1], ['', 1]]);
  const sy = res.find((c) => c.code === 'SY');
  assert.deepEqual(sy.provinces.map((p) => [p.name, p.count]), [['دمشق', 2], ['ريف دمشق', 1]]);
  assert.deepEqual(sy.provinces[1].cities.map((c) => [c.name, c.count]), [['دوما', 1]]);
  assert.deepEqual(sy.cities.map((c) => c.name).sort(), ['دمشق', 'دوما']);
  const eg = res.find((c) => c.code === 'EG');
  assert.equal(eg.provinces.length, 1);
  assert.equal(eg.cities.length, 1, 'القاهرة / القاهره are one city');
  assert.equal(eg.cities[0].count, 2);
  assert.equal(res.find((c) => c.code === '').name, 'بلد غير محدد');
  const born = placeStats(ix, 'birth');
  assert.deepEqual(born.map((c) => [c.code, c.count]), [['SY', 5]]);
  assert.deepEqual(born[0].provinces.map((p) => p.name).sort(), ['حلب', 'حمص', 'دمشق', 'ريف دمشق'].sort());

  // search box finds every kind of place
  const ids = (q) => sx(ix, q).map((p) => p.id).sort();
  assert.deepEqual(ids('دوما'), ['3']);
  assert.deepEqual(ids('ريف دمشق'), ['3']);
  assert.deepEqual(ids('حلب'), ['4', '6'], 'birth places are searchable');
  assert.deepEqual(ids('طرطوس'), ['9'], 'legacy birth_place is searchable');
  assert.deepEqual(ids('مصر'), ['4', '5']);
  assert.deepEqual(ids('Egypt'), ['4', '5'], 'the English country name finds people too');
  assert.deepEqual(ids('syria'), ['1', '2', '3', '4', '6', '9'].filter((x) => ix.byId.get(x) && (placeOf(ix.byId.get(x), 'residence').country === 'SY' || placeOf(ix.byId.get(x), 'birth').country === 'SY')));
  assert.deepEqual(ids('احمد دمشق'), ['1']);

  // filters
  const f = (x) => filterPersons(ix, x).map((p) => p.id).sort();
  assert.equal(f({}).length, 9);
  assert.deepEqual(f({ residence: { country: 'SY' } }), ['1', '2', '3']);
  assert.deepEqual(f({ residence: { country: 'EG' } }), ['4', '5']);
  assert.deepEqual(f({ residence: { country: '' } }), ['7'], 'country not set = something recorded, no country');
  assert.deepEqual(f({ residence: { none: true } }), ['8', '9'], 'nothing recorded');
  const dam = sy.provinces.find((p) => p.name === 'دمشق').key;
  assert.deepEqual(f({ residence: { country: 'SY', provinceKey: dam } }), ['1', '2']);
  assert.deepEqual(f({ residence: { country: 'SY', provinceKey: sy.provinces[1].key, cityKey: sy.cities.find((c) => c.name === 'دوما').key } }), ['3']);
  assert.deepEqual(f({ birth: { country: 'SY' } }), ['1', '2', '3', '4', '6']);
  assert.deepEqual(f({ birth: { country: 'SY', provinceKey: born[0].provinces.find((p) => p.name === 'حلب').key } }), ['4', '6']);
  // "born in Syria AND living in Germany / Egypt"
  assert.deepEqual(f({ birth: { country: 'SY' }, residence: { country: 'DE' } }), ['6']);
  assert.deepEqual(f({ birth: { country: 'SY' }, residence: { country: 'EG' } }), ['4']);
  assert.deepEqual(f({ birth: { country: 'SY' }, residence: { country: 'EG' }, gender: 'male' }), []);
  assert.deepEqual(f({ query: 'منى', birth: { country: 'SY' } }), ['4']);
  assert.deepEqual(f({ residence: { country: 'SY' }, status: 'living', gender: 'female' }), []);
  console.log('PLACES OK');
}
// ---------- accents are ignored ----------
{
  const { normalize: nz, buildIndex: bn, search: sn } = await import('../js/tree.js');
  assert.equal(nz('İstanbul'), 'istanbul');
  assert.equal(nz('Istanbul'), 'istanbul');
  assert.equal(nz('Şanlıurfa'), 'sanliurfa');
  assert.equal(nz('München'), 'munchen');
  assert.equal(nz('Köln'), 'koln');
  assert.equal(nz('Straße'), 'strasse');
  assert.equal(nz('Île-de-France'), 'ile-de-france');
  assert.equal(nz('Göteborg'), 'goteborg');
  assert.equal(nz('Skåne län'), 'skane lan');
  assert.equal(nz('Zürich'), 'zurich');
  assert.equal(nz('Łódź'), 'lodz');
  // Arabic keeps working exactly as before
  assert.equal(nz('أَحْمَدُ'), 'احمد');
  assert.equal(nz('مُؤَسَّسَة'), 'موسسه');
  assert.equal(nz('إسطنبول'), 'اسطنبول');
  assert.equal(nz('القاهرة'), 'القاهره');
  assert.equal(nz('ئ'), 'ي');
  assert.equal(nz('١٢٣ abc'), '123 abc');
  const mkp = (id, first, o = {}) => ({ id, first_name: first, last_name: 'X', gender: 'male', father_id: null, mother_id: null, birth_date: null, created_at: id, ...o });
  const ixa = bn([mkp('1', 'Ali', { residence_country: 'TR', residence_province: 'İstanbul', residence_city: 'Üsküdar' }), mkp('2', 'Omar', { residence_country: 'DE', residence_province: 'Bayern', residence_city: 'München' })], []);
  assert.deepEqual(sn(ixa, 'istanbul').map((p) => p.id), ['1']);
  assert.deepEqual(sn(ixa, 'uskudar').map((p) => p.id), ['1']);
  assert.deepEqual(sn(ixa, 'munchen').map((p) => p.id), ['2']);
  assert.deepEqual(sn(ixa, 'München').map((p) => p.id), ['2']);
  assert.deepEqual(sn(ixa, 'bayern').map((p) => p.id), ['2']);
  console.log('ACCENTS OK');
}
// ---------- contact details are searchable ----------
{
  const { buildIndex: bc, search: sc } = await import('../js/tree.js');
  const mkc = (id, first, o = {}) => ({ id, first_name: first, last_name: 'X', gender: 'male', father_id: null, mother_id: null, birth_date: null, created_at: id, ...o });
  const ixc = bc([mkc('1', 'Ali', { phone: '+000 111 222 301', email: 'ali@example.com' }), mkc('2', 'Omar', { phone: '(0944) 123456' }), mkc('3', 'Sara')], []);
  assert.deepEqual(sc(ixc, 'ali@example.com').map((p) => p.id), ['1']);
  assert.deepEqual(sc(ixc, '111').map((p) => p.id), ['1']);
  assert.deepEqual(sc(ixc, '000111222301').map((p) => p.id), ['1'], 'digits only');
  assert.deepEqual(sc(ixc, '0944123456').map((p) => p.id), ['2'], 'digits only, brackets ignored');
  assert.deepEqual(sc(ixc, 'example').map((p) => p.id), ['1']);
  console.log('CONTACT SEARCH OK');
}
// ---------- branches, generation bands, horizontal design ----------
{
  const { buildIndex: bi, buildHierarchy: bh, layout: lay, generationName: gn, BRANCH_COUNT: BC } = await import('../js/tree.js');
  const mkb = (id, first, father) => ({ id, first_name: first, last_name: 'X', gender: 'male', father_id: father, mother_id: null, birth_date: null, created_at: id });
  const ixb = bi([mkb('r', 'R', null), mkb('a', 'A', 'r'), mkb('b', 'B', 'r'), mkb('c', 'C', 'r'), mkb('a1', 'A1', 'a'), mkb('a2', 'A2', 'a'), mkb('b1', 'B1', 'b'), mkb('b11', 'B11', 'b1')], []);
  const withLines = (id) => (id === 'a' ? ['الزوجة الأولى: س', 'الزوجة الثانية: ص'] : id === 'b1' ? ['الزوجة: ع'] : []);
  for (const orientation of ['vertical', 'horizontal']) {
    const res = lay(bh(ixb, 'r'), { rtl: true, orientation, lines: withLines });
    const by = new Map(res.cards.map((c) => [c.personId, c]));
    assert.equal(res.cards[0].personId, 'r', orientation + ': root first');
    assert.equal(by.get('r').node.branch, -1);
    assert.deepEqual(['a', 'b', 'c'].map((i) => by.get(i).node.branch), [0, 1, -1], orientation + ': a childless child of the root is no branch');
    assert.equal(by.get('a1').node.branch, 0);
    assert.equal(by.get('a2').node.branch, 0);
    assert.equal(by.get('b11').node.branch, 1, 'a branch colours the whole line below it');
    assert.equal(res.edges.length, 7);
    for (const e of res.edges) assert.ok(e.branch < BC && (e.branch >= 0 || e.branch === -1), 'every edge carries its branch');
    assert.equal(res.edges.filter((e) => e.branch === -1).length, 1, 'only the edge to the childless child is neutral');
    const boxes = res.cards.map((c) => [c.x, c.y, c.x + c.w, c.y + c.h + c.extra]);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [p, q] = [boxes[i], boxes[j]];
        assert.ok(!(p[0] < q[2] && q[0] < p[2] && p[1] < q[3] && q[1] < p[3]), `${orientation}: cards ${res.cards[i].personId} and ${res.cards[j].personId} overlap`);
      }
    }
    assert.equal(res.orientation, orientation);
  }
  const hz = lay(bh(ixb, 'r'), { rtl: true, orientation: 'horizontal' });
  const hy = new Map(hz.cards.map((c) => [c.personId, c]));
  assert.equal(hz.rows, null);
  assert.ok(hy.get('r').x > hy.get('a').x && hy.get('a').x > hy.get('a1').x, 'rtl: the root is on the right, children to its left');
  assert.equal(hy.get('a').x, hy.get('b').x, 'one column per generation');
  assert.ok(hy.get('a').y < hy.get('b').y && hy.get('b').y < hy.get('c').y, 'eldest on top');
  for (const e of hz.edges) assert.ok(e.x2 < e.x1 && e.busX < e.x1 && e.busX > e.x2, 'edges run leftwards');
  const hl = lay(bh(ixb, 'r'), { rtl: false, orientation: 'horizontal' });
  assert.ok(new Map(hl.cards.map((c) => [c.personId, c])).get('a1').x > 0, 'ltr: children to the right');
  const vt = lay(bh(ixb, 'r'), { rtl: true, lines: withLines });
  assert.equal(vt.rows.length, 4, 'one band per generation');
  assert.equal(vt.orientation, 'vertical');
  for (const r of vt.rows) {
    const inRow = vt.cards.filter((c) => c.node.depth === r.depth);
    for (const c of inRow) assert.ok(c.y >= r.top && c.y + c.h + c.extra <= r.top + r.h, 'cards stay inside their band');
  }
  assert.ok(vt.rows[0].top + vt.rows[0].h <= vt.rows[1].top, 'bands do not touch');
  const many = [mkb('r', 'R', null), ...Array.from({ length: 11 }, (_, i) => mkb('k' + i, 'K' + i, 'r')), ...Array.from({ length: 11 }, (_, i) => mkb('g' + i, 'G' + i, 'k' + i))];
  const mres = lay(bh(bi(many, []), 'r'), { rtl: true });
  assert.deepEqual(mres.cards.filter((c) => c.node.depth === 1).map((c) => c.node.branch), [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2], 'colours cycle after eight branches');
  assert.deepEqual([0, 1, 2, 9, 10].map(gn), ['الأول', 'الثاني', 'الثالث', 'العاشر', '11']);
  console.log('DESIGNS OK');
}
// ---------- fan and natural-tree designs ----------
{
  const { buildIndex: bi, buildHierarchy: bh, layout: lay, fanRadii, FAN_ROOT_RADIUS, polar } = await import('../js/tree.js');
  const mkf = (id, first, father) => ({ id, first_name: first, last_name: 'X', gender: 'male', father_id: father, mother_id: null, birth_date: null, created_at: id });
  const ixf = bi([mkf('r', 'R', null), mkf('a', 'A', 'r'), mkf('b', 'B', 'r'), mkf('c', 'C', 'r'), mkf('a1', 'A1', 'a'), mkf('a2', 'A2', 'a'), mkf('a3', 'A3', 'a'), mkf('b1', 'B1', 'b'), mkf('b11', 'B11', 'b1')], []);
  const close = (x, y, msg) => assert.ok(Math.abs(x - y) < 1e-9, `${msg}: ${x} vs ${y}`);

  for (const rtl of [true, false]) {
    const fan = lay(bh(ixf, 'r'), { rtl, orientation: 'fan' });
    assert.equal(fan.orientation, 'fan');
    assert.deepEqual(fan.edges, []);
    assert.equal(fan.cards[0].personId, 'r', 'root first');
    assert.equal(fan.cards.length, fan.sectors.length);
    const sec = new Map(fan.sectors.map((x) => [x.personId, x]));
    close(sec.get('r').r1, FAN_ROOT_RADIUS, 'root disc');
    // 6 leaves (a1 a2 a3 b11 c ... a's three kids, b's chain end b11, c) = 5 leaves: a1 a2 a3 b11 c
    const unit = 180 / 5;
    close(sec.get('a').a1 - sec.get('a').a0, 3 * unit, 'a: 3 leaves');
    close(sec.get('b').a1 - sec.get('b').a0, unit, 'b: 1 leaf (a chain)');
    close(sec.get('b11').a1 - sec.get('b11').a0, unit, 'a chain keeps the width of its parent');
    close(sec.get('c').a1 - sec.get('c').a0, unit, 'c: 1 leaf');
    // the whole half circle is used, with no gaps and no overlaps between siblings
    const sibs = ['a', 'b', 'c'].map((i) => sec.get(i)).sort((x, y) => x.a0 - y.a0);
    close(sibs[0].a0, 0, 'starts at 0');
    close(sibs[2].a1, 180, 'ends at 180');
    close(sibs[0].a1, sibs[1].a0, 'no gap');
    close(sibs[1].a1, sibs[2].a0, 'no gap');
    // eldest child (a) is on the right for rtl, on the left otherwise
    assert.equal(sibs[0].personId, rtl ? 'a' : 'c');
    // children stay inside their parent's slice and one ring further out
    for (const x of fan.sectors) {
      if (x.depth === 0) continue;
      const par = fan.sectors.find((y) => y.node.children.includes(x.node));
      assert.ok(x.a0 >= par.a0 - 1e-9 && x.a1 <= par.a1 + 1e-9, `${x.personId} inside ${par.personId}`);
      assert.deepEqual([x.r0, x.r1], fanRadii(x.depth));
    }
    assert.ok(fanRadii(2)[0] > fanRadii(1)[1], 'rings do not touch');
    // the card box sits on the middle of its slice
    for (const c of fan.cards) {
      const x = sec.get(c.personId);
      if (x.depth === 0) continue;
      const [mx, my] = polar((x.r0 + x.r1) / 2, (x.a0 + x.a1) / 2);
      close(c.x + 4, mx, 'card x');
      close(c.y + 4, my, 'card y');
    }
    assert.ok(fan.bounds.minY < 0 && fan.bounds.minX === -fan.bounds.maxX, 'symmetric, root disc at the bottom centre');
    assert.equal(sec.get('b11').node.branch, 1);
  }
  // a lone root is just the disc
  const lonely = lay(bh(bi([mkf('x', 'X', null)], []), 'x'), { orientation: 'fan' });
  assert.equal(lonely.sectors.length, 1);
  assert.equal(lonely.bounds.w, 2 * FAN_ROOT_RADIUS);

  const tr = lay(bh(ixf, 'r'), { rtl: true, orientation: 'tree', lines: () => ['ignored'] });
  assert.equal(tr.orientation, 'tree');
  const bt = new Map(tr.cards.map((c) => [c.personId, c]));
  assert.ok(bt.get('r').y > bt.get('a').y && bt.get('a').y > bt.get('a1').y, 'the root is at the bottom, generations grow upwards');
  assert.equal(bt.get('r').extra, 0, 'no wives lines in this design');
  assert.ok(tr.trunk.y >= bt.get('r').y + bt.get('r').h - 1e-9 && tr.trunk.h > 0, 'trunk under the root');
  close(tr.trunk.x, bt.get('r').x + bt.get('r').w / 2, 'trunk under the middle of the root');
  assert.ok(tr.bounds.maxY >= tr.trunk.y + tr.trunk.h - 1e-9, 'the bounds include the trunk');
  for (const e of tr.edges) assert.ok(e.y2 < e.y1, 'a bough runs from the parent up to its child');
  const widthOf = (childId) => tr.edges.find((e) => Math.abs(e.y2 - (bt.get(childId).y + bt.get(childId).h)) < 1e-9 && e.x2 === bt.get(childId).x + bt.get(childId).w / 2).w;
  assert.ok(widthOf('a') > widthOf('a1') && widthOf('b1') > widthOf('b11'), 'boughs get thinner');
  const flat = lay(bh(ixf, 'r'), { rtl: true });
  assert.equal(new Map(flat.cards.map((c) => [c.personId, c])).get('a').x, bt.get('a').x, 'same left-right order as the classic layout');
  console.log('FAN AND TREE OK');
}
console.log('TREE TESTS DONE');

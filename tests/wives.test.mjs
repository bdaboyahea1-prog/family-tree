// A man with several wives: his children are drawn in groups by mother, and each wife has a number (so a colour).
import assert from 'node:assert/strict';
import { buildIndex, buildHierarchy, wifeIndex, layout, spouseLines, SIZE, LINE_H, LINES_PAD } from '../js/tree.js';
import { FACTORY_LOOK, cleanLook } from '../js/look.js';

let n = 0;
const P = (id, gender, o = {}) => ({ id, first_name: id, last_name: 'x', gender, father_id: null, mother_id: null, birth_date: null, created_at: String(++n).padStart(3, '0'), ...o });
const M = (a, b, i) => ({ id: `m${i}`, person_a: a, person_b: b, status: 'married', created_at: String(i).padStart(3, '0') });

// F has three wives, married in the order W1, W2, W3; the children are not in the order of their mothers
const persons = [
  P('F', 'male', { birth_date: '1920' }), P('W1', 'female'), P('W2', 'female'), P('W3', 'female'),
  P('k1', 'male', { father_id: 'F', mother_id: 'W2', birth_date: '1960' }),
  P('k2', 'female', { father_id: 'F', mother_id: 'W1', birth_date: '1965' }),
  P('k3', 'male', { father_id: 'F', mother_id: 'W3', birth_date: '1962' }),
  P('k4', 'male', { father_id: 'F', mother_id: 'W1', birth_date: '1950' }),
  P('k5', 'male', { father_id: 'F', mother_id: null, birth_date: '1955' }), // the mother is not known
  P('k6', 'male', { father_id: 'F', mother_id: 'W2', birth_date: '1970' }),
];
const ix = buildIndex(persons, [M('F', 'W1', 1), M('F', 'W2', 2), M('F', 'W3', 3)]);
const ids = (arr) => arr.map((c) => c.id);

assert.deepEqual(ix.spouses.get('F').map((s) => s.person.id), ['W1', 'W2', 'W3']);
assert.deepEqual(ids(ix.lineKids.get('F')), ['k4', 'k2', 'k1', 'k6', 'k3', 'k5'], 'first wife\'s children, then the second\'s, then the third\'s; an unknown mother last; the oldest first inside a group');
assert.deepEqual(ids(ix.kids.get('F')), ['k4', 'k5', 'k1', 'k3', 'k2', 'k6'], 'the plain list of children stays in the order of birth');

// ---------- the number of the wife ----------
assert.deepEqual(['k4', 'k2', 'k1', 'k6', 'k3', 'k5'].map((id) => wifeIndex(ix, 'F', ix.byId.get(id))), [0, 0, 1, 1, 2, -1]);
const h = buildHierarchy(ix, 'F', new Set());
assert.deepEqual(h.children.map((c) => c.wife), [0, 0, 1, 1, 2, -1], 'every child node knows its mother\'s number');
assert.equal(h.wife, -1, 'the root has none');

// ---------- the drawing carries it ----------
const v = layout(h, { size: SIZE });
assert.deepEqual(v.edges.map((e) => e.wife), [0, 0, 1, 1, 2, -1], 'a line has the number of the mother of the child it reaches');
const side = layout(h, { size: SIZE, orientation: 'horizontal' });
assert.deepEqual(side.edges.map((e) => e.wife), [0, 0, 1, 1, 2, -1]);

// ---------- one wife, or none: nothing changes ----------
const one = buildIndex([P('A', 'male'), P('B', 'female'), P('a1', 'male', { father_id: 'A', mother_id: 'B', birth_date: '1980' }), P('a2', 'male', { father_id: 'A', mother_id: 'B', birth_date: '1970' })], [M('A', 'B', 1)]);
assert.deepEqual(ids(one.lineKids.get('A')), ['a2', 'a1'], 'one wife: the order of birth');
assert.equal(buildHierarchy(one, 'A').children.every((c) => c.wife === -1), true, 'one wife: no colours');
assert.equal(wifeIndex(one, 'A', one.byId.get('a1')), -1);

// ---------- a woman with two husbands keeps her order, and gets no wife numbers ----------
const two = buildIndex([P('H1', 'male'), P('H2', 'male'), P('Z', 'female'),
  P('z1', 'male', { father_id: 'H2', mother_id: 'Z', birth_date: '1990' }), P('z2', 'male', { father_id: 'H1', mother_id: 'Z', birth_date: '1980' })], [M('H1', 'Z', 1), M('H2', 'Z', 2)]);
assert.deepEqual(ids(two.kids.get('Z')), ['z2', 'z1']);
assert.equal(wifeIndex(two, 'Z', two.byId.get('z1')), -1, 'only a man\'s wives are numbered');

// ---------- the lines of the wives are 26px apiece, in a frame of their own ----------
assert.equal(LINE_H, 26);
const withLines = layout(buildHierarchy(ix, 'F', new Set()), { size: SIZE, lines: (id) => (id === 'F' ? spouseLines(ix, ix.byId.get('F')) : []) });
assert.equal(withLines.cards[0].extra, 3 * LINE_H + LINES_PAD, 'room under the card for the three wives');
assert.deepEqual(spouseLines(ix, ix.byId.get('F')).map((l) => l.split(' : ')[0]), ['الزوجة الأولى', 'الزوجة الثانية', 'الزوجة الثالثة']);

// ---------- the look option ----------
assert.equal(FACTORY_LOOK.wifeColors, true, 'on by default');
assert.deepEqual(cleanLook({ wifeColors: false }), { wifeColors: false });
assert.deepEqual(cleanLook({ wifeColors: 'off' }), {});

console.log('WIVES OK');

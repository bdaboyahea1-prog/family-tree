// The look of the tree: factory <- the tree's default <- my own choices; and leaving women out of the drawing.
import assert from 'node:assert/strict';
import { FACTORY_LOOK, LOOK_KEYS, cleanLook, resolveLook, legacyLook } from '../js/look.js';
import { buildIndex, buildHierarchy } from '../js/tree.js';

// ---------- the factory look is the one the family designed ----------
assert.equal(FACTORY_LOOK.cardStyle, 'portrait');
assert.equal(FACTORY_LOOK.design, 'classic');
assert.equal(FACTORY_LOOK.showFemales, true, 'women are shown unless somebody turns them off');
assert.deepEqual(Object.keys(FACTORY_LOOK).sort(), [...LOOK_KEYS].sort(), 'every key has a factory value');
assert.throws(() => {
  'use strict';
  FACTORY_LOOK.design = 'fan';
}, TypeError, 'the factory look cannot be changed by accident');

// ---------- cleaning ----------
assert.deepEqual(cleanLook({ design: 'fan', curves: false, evil: 1, cardStyle: 'nope', theme: 'dark' }), { design: 'fan', curves: false, theme: 'dark' }, 'unknown keys and bad values are dropped');
assert.deepEqual(cleanLook({ showFemales: 'no', bands: 1, showWives: false }), { showWives: false }, 'a flag must be a real true / false');
assert.deepEqual(cleanLook(null), {});
assert.deepEqual(cleanLook('x'), {});
assert.deepEqual(cleanLook([1, 2]), {});
assert.deepEqual(cleanLook(undefined), {});
assert.deepEqual(cleanLook({ __proto__: { design: 'fan' } }), {}, 'inherited keys do not count');
assert.deepEqual(cleanLook({ cardStyle: 'pill', design: 'tree' }), { cardStyle: 'pill', design: 'tree' });

// ---------- resolving ----------
assert.deepEqual(resolveLook(null, null), { ...FACTORY_LOOK });
assert.equal(resolveLook({ cardStyle: 'soft' }, null).cardStyle, 'soft', 'the default of the tree is what a new member sees');
assert.equal(resolveLook({ cardStyle: 'soft' }, { cardStyle: 'pill' }).cardStyle, 'pill', 'my own choice wins');
const both = resolveLook({ cardStyle: 'soft', design: 'fan' }, { cardStyle: 'pill' });
assert.deepEqual([both.cardStyle, both.design], ['pill', 'fan'], 'a key I never touched follows the default');
assert.equal(resolveLook({ theme: 'dark' }, {}).theme, 'dark');
assert.equal(resolveLook({ design: 'weird' }, { curves: 'x' }).design, 'classic', 'a damaged record falls back to the factory value');
assert.deepEqual(resolveLook({ showFemales: false }, { showFemales: true }).showFemales, true, 'a member may turn women back on for themselves');

// ---------- what an older version kept in the browser ----------
const store = (o) => (k) => o[k] ?? null;
assert.deepEqual(legacyLook(store({})), {}, 'nothing kept: nothing to carry over');
assert.deepEqual(legacyLook(store({ 'ft.design': 'tree', 'ft.wives': '0', 'ft.years': '1', 'ft.cardstyle': 'dark', 'ft.theme': 'light' })),
  { design: 'tree', showWives: false, showYears: true, cardStyle: 'dark', theme: 'light' });
assert.equal(legacyLook(store({ 'ft.design': 'bands' })).design, 'classic', 'the old "bands" design is the classic one');
assert.deepEqual(legacyLook(store({ 'ft.design': 'junk', 'ft.wives': 'maybe' })), {}, 'bad old values are ignored');

// ---------- leaving women out ----------
let n = 0;
const P = (id, gender, o = {}) => ({ id, first_name: id, last_name: 'x', gender, father_id: null, mother_id: null, birth_date: null, created_at: String(++n).padStart(3, '0'), ...o });
const ix = buildIndex([
  P('g', 'male'),
  P('s1', 'male', { father_id: 'g' }), P('d1', 'female', { father_id: 'g' }), P('s2', 'male', { father_id: 'g' }),
  P('k1', 'male', { father_id: 's1' }), P('k2', 'female', { father_id: 's1' }),
  P('x', 'male', { father_id: 'd1' }), // a son drawn under his mother (no father on record)
], []);
const names = (h) => {
  const out = [];
  const walk = (node) => (out.push(node.id), node.children.forEach(walk));
  walk(h);
  return out.sort();
};
const all = buildHierarchy(ix, 'g', new Set());
assert.deepEqual(names(all), ['d1', 'g', 'k1', 'k2', 's1', 's2', 'x']);
const men = buildHierarchy(ix, 'g', new Set(), { hide: (p) => p.gender === 'female' });
assert.deepEqual(names(men), ['g', 'k1', 's1', 's2'], 'women and what hangs under them are left out');
assert.equal(men.totalKids, 2, 'the count of children counts only those shown');
assert.equal(men.children[0].totalKids, 1);
assert.deepEqual(names(buildHierarchy(ix, 'g', new Set(), {})), names(all), 'no option: nothing changes');
assert.equal(buildHierarchy(ix, 'd1', new Set(), { hide: (p) => p.gender === 'female' }).id, 'd1', 'the root is always drawn, even a woman');
assert.equal(buildHierarchy(ix, 'nope', new Set(), { hide: () => true }), null);

console.log('LOOK OK');

// The name on a card: first name + father's first name + family ("عبد الله يحيى هرموش").
import assert from 'node:assert/strict';
import { buildIndex, cardName, fullName } from '../js/tree.js';
import { FACTORY_LOOK, cleanLook } from '../js/look.js';

let n = 0;
const P = (id, first, o = {}) => ({ id, first_name: first, last_name: 'هرموش', gender: 'male', father_id: null, mother_id: null, birth_date: null, created_at: String(++n).padStart(3, '0'), ...o });
const ix = buildIndex([
  P('y', 'يحيى'),
  P('a', 'عبد الله', { father_id: 'y' }), // the son of يحيى
  P('f', 'فاطمة', { father_id: 'y', gender: 'female' }), // a daughter: the same pattern
  P('o', 'سالم'), // no father on record
  P('same', 'يحيى', { father_id: 'y' }), // a son with his father's name
  P('typed', 'عبد الرحمن يحيى', { father_id: 'y' }), // somebody already wrote the father's name in the first name
  P('typed2', 'عبد الرحمن  يَحْيَى', { father_id: 'y' }), // ... with other spaces and vowel marks
  P('nofam', 'خالد', { father_id: 'y', last_name: null }),
  P('onlyid', 'ليلى', { father_id: 'ghost' }), // the father is not in the tree
  P('trail', 'يحيى ', { father_id: 'y' }),
], []);
const name = (id) => cardName(ix, ix.byId.get(id));

assert.equal(name('a'), 'عبد الله يحيى هرموش', 'first name, father, family: the example of the family');
assert.equal(name('f'), 'فاطمة يحيى هرموش', 'a daughter is written the same way');
assert.equal(name('o'), 'سالم هرموش', 'no father on record: the plain name');
assert.equal(name('same'), 'يحيى يحيى هرموش', 'a son named like his father keeps both names');
assert.equal(name('typed'), 'عبد الرحمن يحيى هرموش', 'the father\'s name already written in the first name is not repeated');
assert.equal(name('typed2'), 'عبد الرحمن يَحْيَى هرموش', 'also with other spaces and vowel marks (the text is kept as it was typed)');
assert.equal(name('nofam'), 'خالد يحيى', 'no family name: first name and father');
assert.equal(name('onlyid'), 'ليلى هرموش', 'a father who is not in the tree gives nothing to write');
assert.equal(name('y'), 'يحيى هرموش', 'the head of the family');
assert.equal(name('trail'), 'يحيى يحيى هرموش', 'spaces around a name do not matter');
assert.equal(fullName(ix.byId.get('a')), 'عبد الله هرموش', 'the plain name is still available (lists, exports)');

// ---------- the look option ----------
assert.equal(FACTORY_LOOK.tripleName, true, 'on by default');
assert.deepEqual(cleanLook({ tripleName: false }), { tripleName: false });
assert.deepEqual(cleanLook({ tripleName: 'no' }), {});

console.log('CARD NAME OK');

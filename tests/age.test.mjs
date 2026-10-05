// The age on a card: from a birth date written as free text, as of this month (the living) or at death (the dead).
import assert from 'node:assert/strict';
import { ageOf, parseDate, isDead } from '../js/tree.js';

const now = new Date(2026, 9, 5); // 5 October 2026
const age = (p) => ageOf(p, now);

// reading the dates
assert.deepEqual(parseDate('1946'), { y: 1946, m: null, d: null });
assert.deepEqual(parseDate('1946-03'), { y: 1946, m: 3, d: null });
assert.deepEqual(parseDate('1946-03-12'), { y: 1946, m: 3, d: 12 });
assert.deepEqual(parseDate('12/03/1946'), { y: 1946, m: 3, d: 12 }, 'day first');
assert.deepEqual(parseDate('03/1946'), { y: 1946, m: 3, d: null });
assert.deepEqual(parseDate('١٩٤٦-٠٣-١٢'), { y: 1946, m: 3, d: 12 }, 'Arabic digits');
assert.deepEqual(parseDate('حوالي 1950'), { y: 1950, m: null, d: null });
assert.equal(parseDate('الستينات'), null);
assert.equal(parseDate(null), null);
assert.deepEqual(parseDate('1946-13-40'), { y: 1946, m: null, d: null }, 'an impossible month is ignored, the year stays');

// the living: as of this month
assert.deepEqual(age({ birth_date: '1946' }), { n: 80, exact: false }, 'only the year: this year minus that year');
assert.deepEqual(age({ birth_date: '1946-03' }), { n: 80, exact: true });
assert.deepEqual(age({ birth_date: '1946-11' }), { n: 79, exact: true }, 'the birthday month has not come yet');
assert.deepEqual(age({ birth_date: '1946-10-20' }), { n: 80, exact: true }, 'the birthday month counts, as of this month');
assert.deepEqual(age({ birth_date: '12/03/1946' }), { n: 80, exact: true });
assert.deepEqual(age({ birth_date: '١٩٤٦' }), { n: 80, exact: false });
assert.deepEqual(age({ birth_date: 'حوالي 1950' }), { n: 76, exact: false });
assert.equal(age({ birth_date: 'الستينات' }), null, 'no year: no age');
assert.equal(age({ birth_date: null }), null);
assert.equal(age({ birth_date: '2030' }), null, 'born in the future: nothing');
assert.equal(age({ birth_date: '1800' }), null, 'impossibly old: nothing');
assert.deepEqual(age({ birth_date: '2026-10' }), { n: 0, exact: true }, 'a baby of this month');

// the dead: the age at death
assert.deepEqual(age({ birth_date: '1943', death_date: '2019', is_deceased: true }), { n: 76, exact: false });
assert.deepEqual(age({ birth_date: '1943-05-10', death_date: '2019-03-01', is_deceased: true }), { n: 75, exact: true }, 'died before the birthday month');
assert.deepEqual(age({ birth_date: '1943-05-10', death_date: '2019-05-02', is_deceased: true }), { n: 75, exact: true }, 'died in the month, before the day');
assert.deepEqual(age({ birth_date: '1943-05-10', death_date: '2019-05-12', is_deceased: true }), { n: 76, exact: true });
assert.equal(age({ birth_date: '1943', is_deceased: true }), null, 'marked dead without a year of death: no number');
assert.deepEqual(age({ birth_date: '1943', death_date: '2019' }), { n: 76, exact: false }, 'a death year alone makes a person dead');
assert.equal(age({ birth_date: '1950', death_date: '1940', is_deceased: true }), null, 'died before being born: nothing');

assert.equal(isDead({ is_deceased: true }), true);
assert.equal(isDead({ death_date: '2001' }), true);
assert.equal(isDead({ birth_date: '1990' }), false);

console.log('AGE OK');

// The search box over a long list (country, province, city): what it finds, and in which order.
import assert from 'node:assert/strict';
import { filterChoices } from '../js/searchselect.js';
import { countryList } from '../js/tree.js';
import { provincesOf, citiesOf } from '../js/places-data.js';

const countries = countryList().map((c) => ({ value: c.code, text: c.name }));
const codes = (q) => filterChoices(countries, q).map((c) => c.value);

// ---------- nothing typed: the whole list, as it is ----------
assert.deepEqual(filterChoices(countries, ''), countries);
assert.deepEqual(filterChoices(countries, '   '), countries);
assert.notEqual(filterChoices(countries, ''), countries, 'a copy: the caller may change it');

// ---------- countries ----------
assert.equal(codes('سعود')[0], 'SA', '«سعود» finds السعودية although the name starts with «ال»');
assert.equal(codes('مصر')[0], 'EG');
assert.equal(codes('تركيا')[0], 'TR');
assert.equal(codes('المان')[0], 'DE', 'a typed «ال» is fine too');
assert.equal(codes('المانيا')[0], 'DE', 'the hamza of «ألمانيا» does not have to be typed');
assert.ok(codes('سوريا').includes('SY'));
assert.deepEqual(codes('ظظظظ'), [], 'nothing matches: an empty answer, not an error');
assert.ok(filterChoices(countries, 'ا').length > 100, 'one letter keeps most of the list');
assert.ok(codes('عرب').length >= 1 && codes('عرب').every((c) => countries.find((x) => x.value === c)), 'only choices of the list come back');

// ---------- the order: starts with, then a word starts with, then anywhere ----------
const sample = [
  { value: 'a', text: 'قرية عمان' },
  { value: 'b', text: 'عمان' },
  { value: 'c', text: 'سلطنة عمان' },
  { value: 'd', text: 'بعمان' },
];
assert.deepEqual(filterChoices(sample, 'عمان').map((c) => c.value), ['b', 'a', 'c', 'd'], 'starts with, then a word starts with (in their order), then inside a word');

// ---------- Latin names: accents and capitals do not matter ----------
const latin = [{ value: '1', text: 'İstanbul' }, { value: '2', text: 'München' }, { value: '3', text: 'Şanlıurfa' }, { value: '4', text: 'Köln' }];
assert.deepEqual(filterChoices(latin, 'istanbul').map((c) => c.value), ['1']);
assert.deepEqual(filterChoices(latin, 'MUNCHEN').map((c) => c.value), ['2']);
assert.deepEqual(filterChoices(latin, 'sanli').map((c) => c.value), ['3']);
assert.deepEqual(filterChoices(latin, 'koln').map((c) => c.value), ['4']);

// ---------- a real list of cities ----------
const province = provincesOf('TR').find((p) => (citiesOf('TR', p) || []).length > 5);
const cities = citiesOf('TR', province).map((t) => ({ value: t, text: t }));
for (const c of cities) assert.ok(filterChoices(cities, c.text).some((x) => x.value === c.value), `${c.text} is found by its own name`);

console.log('SEARCH SELECT OK');

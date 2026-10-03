import assert from 'node:assert/strict';
import { PLACES, provincesOf, citiesOf } from '../js/places-data.js';
import { WORLD } from '../js/places-world.js';
import { countryName } from '../js/tree.js';

// official numbers of first-level divisions
const EXPECTED = { SY: 14, EG: 27, SA: 13, IQ: 18, JO: 12, LB: 8, PS: 16, YE: 22, SD: 18, LY: 22, TN: 24, DZ: 58, MA: 12,
  KW: 6, BH: 4, QA: 8, AE: 7, OM: 11, TR: 81, DE: 16, US: 51, CA: 13, GB: 4, FR: 13, SE: 21, NL: 12, AU: 8 };
for (const [code, n] of Object.entries(EXPECTED)) {
  assert.ok(PLACES[code], `missing ${code}`);
  assert.equal(Object.keys(PLACES[code]).length, n, `${code} (${countryName(code)}) has ${Object.keys(PLACES[code]).length} provinces, expected ${n}`);
}

let cities = 0;
for (const [code, provinces] of Object.entries(PLACES)) {
  assert.notEqual(countryName(code), code, `${code} is not a country code we know`);
  const names = Object.keys(provinces);
  assert.equal(new Set(names).size, names.length, `${code}: duplicate province`);
  for (const [prov, list] of Object.entries(provinces)) {
    assert.ok(prov.trim() === prov && prov.length > 0 && prov.length <= 100, `${code}: bad province name "${prov}"`);
    assert.ok(Array.isArray(list) && list.length > 0, `${code}/${prov}: no cities`);
    for (const c of list) assert.ok(typeof c === 'string' && c.trim() === c && c.length > 0 && c.length <= 100, `${code}/${prov}: bad city "${c}"`);
    const dedup = citiesOf(code, prov);
    assert.equal(new Set(dedup).size, dedup.length);
    cities += dedup.length;
  }
}
// an Arabic-only check: Arab countries must not contain Latin letters
for (const code of ['SY', 'EG', 'SA', 'IQ', 'JO', 'LB', 'PS', 'YE', 'SD', 'LY', 'TN', 'DZ', 'MA', 'KW', 'BH', 'QA', 'AE', 'OM']) {
  for (const [prov, list] of Object.entries(PLACES[code])) for (const x of [prov, ...list]) assert.ok(!/[A-Za-z]/.test(x), `${code}: Latin letters in "${x}"`);
}
// the English world lists
const worldCountries = Object.keys(WORLD);
assert.ok(worldCountries.length > 180, 'world coverage: ' + worldCountries.length);
for (const code of worldCountries) {
  assert.ok(!PLACES[code], `${code} is in both lists: the Arabic one must win`);
  assert.notEqual(countryName(code), code, `${code} is not a country code we know`);
  const list = WORLD[code];
  assert.ok(Array.isArray(list) && list.length > 0, `${code}: empty list`);
  assert.equal(new Set(list).size, list.length, `${code}: duplicates`);
  for (const x of list) assert.ok(typeof x === 'string' && x.trim() === x && x.length > 0 && x.length <= 100, `${code}: bad name "${x}"`);
}
assert.equal(WORLD.JP.length, 47);
assert.ok(WORLD.JP.includes('Tokyo'));
assert.equal(WORLD.IN.length, 36);
assert.ok(WORLD.BR.includes('São Paulo') || WORLD.BR.includes('Sao Paulo'));
assert.ok(WORLD.RU.length > 70);
// every country is reachable through provincesOf, and the Arabic list wins where both exist
assert.deepEqual(provincesOf('JP').slice(0, 2), WORLD.JP.slice(0, 2));
assert.equal(provincesOf('SY')[0], 'دمشق');
assert.equal(citiesOf('JP', 'Tokyo'), null, 'no city lists for the English countries: typed');
const covered = new Set([...Object.keys(PLACES), ...worldCountries]);
console.log('countries with a province list:', covered.size);
assert.ok(covered.size > 220);
assert.equal(provincesOf('ZZ'), null);
assert.equal(citiesOf('SY', 'لا يوجد'), null);
assert.ok(citiesOf('SY', 'دمشق').includes('دمشق'));
assert.ok(citiesOf('SY', 'ريف دمشق').includes('دوما'));
// local-language names
assert.ok(citiesOf('TR', 'İstanbul').includes('Fatih'));
assert.deepEqual(citiesOf('TR', 'Ankara').slice(0, 2), ['Ankara', 'Çankaya']);
assert.ok(provincesOf('TR').includes('Şanlıurfa') && provincesOf('TR').includes('Hatay') && !provincesOf('TR').some((x) => /[\u0600-\u06FF]/.test(x)), 'Turkey is in Turkish');
assert.ok(provincesOf('DE').includes('Bayern') && provincesOf('DE').includes('Nordrhein-Westfalen') && !provincesOf('DE').includes('Bavaria'));
assert.ok(citiesOf('DE', 'Bayern').includes('München') && citiesOf('DE', 'Nordrhein-Westfalen').includes('Köln'));
assert.ok(provincesOf('FR').includes('Île-de-France') && citiesOf('FR', 'Île-de-France').includes('Paris'));
assert.ok(provincesOf('SE').includes('Skåne län') && citiesOf('SE', 'Västra Götalands län').includes('Göteborg'));
assert.ok(provincesOf('NL').includes('Noord-Holland') && citiesOf('NL', 'Zuid-Holland').includes('Den Haag'));
assert.ok(provincesOf('US').includes('California') && provincesOf('US').includes('District of Columbia'));
assert.ok(provincesOf('CA').includes('Québec') && citiesOf('CA', 'Québec').includes('Montréal'));
assert.ok(provincesOf('GB').includes('England'));
// only the Arab world is written in Arabic: no other list has Arabic letters
const ARABIC = /[\u0600-\u06FF]/;
const ARAB_COUNTRIES = new Set(['SY', 'EG', 'SA', 'IQ', 'JO', 'LB', 'PS', 'YE', 'SD', 'LY', 'TN', 'DZ', 'MA', 'KW', 'BH', 'QA', 'AE', 'OM', 'SO', 'MR', 'DJ', 'KM']);
for (const [code, provinces] of Object.entries(PLACES)) {
  const hasArabic = Object.entries(provinces).some(([pr, cs]) => ARABIC.test(pr) || cs.some((c) => ARABIC.test(c)));
  assert.equal(hasArabic, ARAB_COUNTRIES.has(code), `${code}: Arabic names only for Arab countries`);
}
console.log(`PLACES DATA OK: ${Object.keys(PLACES).length} countries, ${Object.values(PLACES).reduce((n, p) => n + Object.keys(p).length, 0)} provinces, ${cities} cities`);

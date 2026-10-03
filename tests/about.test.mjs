import assert from 'node:assert/strict';
import { cleanAbout, aboutParagraphs, ABOUT_FIELDS } from '../js/about.js';
import fs from 'node:fs';

assert.equal(cleanAbout(null), null);
assert.equal(cleanAbout({}), null);
assert.equal(cleanAbout({ name: '   ' }), null);
assert.deepEqual(cleanAbout({ name: ' علي ', phone: '+1 555 000', evil: '<script>', extra: 5 }), { name: 'علي', phone: '+1 555 000' });
assert.equal(cleanAbout({ text: 'x'.repeat(5000) }).text.length, 2000);
assert.equal(cleanAbout({ name: 'n'.repeat(500) }).name.length, 200);
assert.deepEqual(ABOUT_FIELDS, ['name', 'place', 'greeting', 'text', 'phone', 'email']);
assert.deepEqual(aboutParagraphs({ text: 'أولى\n\nثانية\n  \n\nثالثة' }), ['أولى', 'ثانية', 'ثالثة']);
assert.deepEqual(aboutParagraphs(null), []);

// the published repository must not contain anyone's real contact details: scan every text file
// (a Syrian mobile number in any spelling, and any gmail address)
import path from 'node:path';
const root = new URL('..', import.meta.url);
const skip = new Set(['.git', '.claude', 'node_modules']);
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (skip.has(e.name)) return [];
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
const SYRIAN_MOBILE = /(?:\+|00)?963[\s-]?\(?0?\)?[\s-]?9\d{2}[\s-]?\d{3}[\s-]?\d{3}/;
let scanned = 0;
for (const file of walk(new URL('.', root).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' '))) {
  if (!/\.(js|mjs|html|css|sql|md|json|txt)$/i.test(file) || file.endsWith('places-world.js')) continue;
  const text = fs.readFileSync(file, 'utf8');
  scanned++;
  assert.ok(!SYRIAN_MOBILE.test(text), `${file} contains a real-looking Syrian mobile number`);
  assert.ok(!/[\w.+-]+@gmail\.com/i.test(text), `${file} contains a gmail address`);
}
assert.ok(scanned > 25, `the scan must really read the project (${scanned} files)`);
console.log('ABOUT OK');

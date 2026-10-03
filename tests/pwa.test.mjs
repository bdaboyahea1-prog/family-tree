// The app on the phone: the manifest, the icons it names, the service worker, and the links in the page.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf-8');

// ---------- the manifest ----------
const m = JSON.parse(read('manifest.webmanifest'));
assert.equal(m.display, 'standalone', 'opens like an app, without the browser bars');
assert.equal(m.dir, 'rtl');
assert.equal(m.lang, 'ar');
assert.ok(m.name && m.short_name && m.short_name.length <= 24, 'a name, and one for under the icon (the family chose «شجرة العائلة آل هرموش»; a launcher may cut a long one)');
assert.equal(m.start_url, './', 'relative: the site lives in a sub-folder (/family-tree/)');
assert.equal(m.scope, './');
assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
assert.ok(m.description.length > 10);

// ---------- the icons: they exist, are real PNG files, and have the size the manifest says ----------
const png = (file) => {
  const b = readFileSync(path.join(root, file));
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} is a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)]; // width, height from the IHDR block
};
const sizes = new Set();
for (const icon of m.icons) {
  assert.ok(existsSync(path.join(root, icon.src)), `${icon.src} exists`);
  const [w, h] = png(icon.src);
  assert.equal(`${w}x${h}`, icon.sizes, `${icon.src} is ${icon.sizes}`);
  sizes.add(icon.sizes + ':' + icon.purpose);
}
assert.ok(sizes.has('192x192:any') && sizes.has('512x512:any'), 'the two sizes Chrome asks for');
assert.ok(sizes.has('512x512:maskable'), 'a maskable icon, so Android can cut it to its own shape');
assert.deepEqual(png('icons/apple-touch-icon.png'), [180, 180]);

// ---------- the page links them ----------
const html = read('index.html');
assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
assert.match(html, /name="theme-color" content="#2f6f4f"/);
assert.match(html, /name="apple-mobile-web-app-capable"/);

// ---------- the service worker never touches what is not ours ----------
const sw = read('sw.js');
assert.match(sw, /url\.origin !== self\.location\.origin\) return/, 'other addresses (database, sign-in, fonts) are left to the browser');
assert.match(sw, /req\.method !== 'GET'\) return/, 'only reads are handled');
assert.match(sw, /cache: 'no-cache'/, 'the server is asked every time: a published update is not hidden by an old copy');
assert.match(sw, /caches\.delete/, 'a new version drops the old copies');
assert.ok(!/localStorage|indexedDB|supabase/i.test(sw), 'nothing about the family or the sign-in is stored here');

// ---------- the app registers it, and offers the installation ----------
const app = read('js/app.js');
assert.match(app, /serviceWorker\.register\('sw\.js'\)/);
assert.match(app, /beforeinstallprompt/);

console.log('PWA OK');

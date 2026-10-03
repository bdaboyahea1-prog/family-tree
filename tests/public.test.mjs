import assert from 'node:assert/strict';
import { checkDoc, docExt, isTrackCode, cleanTrackCode, validateJoin, submitArgs, whatsappLink, inviteMessage, openInviteMessage, whatsappShare, teaserYears, peopleCountText, DOC_MAX_BYTES, FAMILY } from '../js/public.js';

const file = (type = 'application/pdf', size = 1000) => ({ type, size, name: 'x' });

// ---------- the proof document ----------
assert.equal(checkDoc(file()), null);
assert.equal(checkDoc(file('image/jpeg', DOC_MAX_BYTES)), null, 'exactly 5 MB is fine');
assert.ok(checkDoc(file('image/jpeg', DOC_MAX_BYTES + 1)).includes('5'), 'too big');
assert.ok(checkDoc(file('text/html')), 'a web page is not a document');
assert.ok(checkDoc(file('application/zip')));
assert.ok(checkDoc(file('image/png', 0)), 'empty');
assert.ok(checkDoc(null), 'required');
assert.equal(docExt(file('image/jpeg')), 'jpg');
assert.equal(docExt(file('application/pdf')), 'pdf');
assert.equal(docExt(file('image/webp')), 'webp');
assert.equal(docExt(file('text/html')), null);

// ---------- the secret tracking code ----------
assert.ok(isTrackCode('0123456789abcdef0123456789abcdef'));
assert.ok(isTrackCode(' 0123456789ABCDEF0123456789abcdef '), 'spaces and capitals from copying are fine');
assert.ok(!isTrackCode('0123456789abcdef'), 'too short');
assert.ok(!isTrackCode('g123456789abcdef0123456789abcdef'));
assert.ok(!isTrackCode(''));
assert.equal(cleanTrackCode(' 0123 4567 89AB  CDEF 0123456789abcdef0123 '), '0123456789abcdef0123456789abcdef0123');

// ---------- the form ----------
const good = { full_name: '  أحمد   خالد ', relation: 'أنا حفيد علي، ووالدي يحيى من الفرع الأكبر', country: 'DE', city: ' Berlin ', phone: '+49 170 1234567', email: ' Ahmad@Example.COM ', consent: true, file: file() };
let r = validateJoin(good);
assert.deepEqual(r.errors, {});
assert.deepEqual(r.clean, { full_name: 'أحمد خالد', relation: 'أنا حفيد علي، ووالدي يحيى من الفرع الأكبر', country: 'DE', city: 'Berlin', phone: '+49 170 1234567', email: 'ahmad@example.com' });
const args = submitArgs({ treeId: 't1', clean: r.clean, file: good.file, hp: '' });
assert.deepEqual(args, { p_tree: 't1', p_full_name: 'أحمد خالد', p_relation: 'أنا حفيد علي، ووالدي يحيى من الفرع الأكبر', p_country: 'DE', p_city: 'Berlin', p_phone: '+49 170 1234567', p_email: 'ahmad@example.com', p_doc_ext: 'pdf', p_hp: '' });
assert.ok(!('p_user' in args), 'no account is involved');

const bad = (patch) => Object.keys(validateJoin({ ...good, ...patch }).errors).sort();
assert.deepEqual(bad({ full_name: ' ' }), ['full_name']);
assert.deepEqual(bad({ full_name: 'ن'.repeat(121) }), ['full_name']);
assert.deepEqual(bad({ relation: 'قصير' }), ['relation']);
assert.deepEqual(bad({ relation: 'ن'.repeat(1501) }), ['relation']);
assert.deepEqual(bad({ country: '' }), ['country']);
assert.deepEqual(bad({ country: 'syria' }), ['country']);
assert.deepEqual(bad({ city: '  ' }), [], 'the city is optional');
assert.deepEqual(bad({ city: 'ن'.repeat(101) }), ['city']);
assert.deepEqual(bad({ phone: '0945abc' }), ['phone']);
assert.deepEqual(bad({ phone: '' }), [], 'the phone is optional');
assert.deepEqual(bad({ phone: '   ' }), [], 'only spaces is the same as nothing');
assert.deepEqual(bad({ email: '' }), [], 'the e-mail is optional');
assert.deepEqual(bad({ phone: '', email: '' }), [], 'neither: the tracking code is the only way back');
assert.deepEqual(bad({ email: 'nope' }), ['email']);
assert.deepEqual(bad({ file: null }), [], 'the document is optional');
assert.deepEqual(bad({ file: undefined }), []);
assert.deepEqual(bad({ file: file('text/plain') }), ['file']);
assert.deepEqual(bad({ consent: false }), ['consent']);
assert.deepEqual(bad({ full_name: '', phone: '12ab', file: file('text/plain') }), ['file', 'full_name', 'phone'], 'every mistake is reported at once');
assert.deepEqual(bad({ file: file('image/png', 0) }), ['file'], 'a given document must still be a proper one');
const noDoc = submitArgs({ treeId: 't1', clean: { ...r.clean, city: '' }, file: null });
assert.equal(noDoc.p_doc_ext, '', 'no document: the server opens the request at once');
assert.equal(noDoc.p_city, '');
const noContact = validateJoin({ ...good, phone: '', email: '' });
assert.deepEqual(noContact.errors, {});
const noContactArgs = submitArgs({ treeId: 't1', clean: noContact.clean, file: null });
assert.equal(noContactArgs.p_phone, '');
assert.equal(noContactArgs.p_email, '', 'the server turns empty text into null');

// ---------- the public cards ----------
assert.equal(teaserYears({ birth_year: 1890, death_year: 1960 }), '1890 – 1960');
assert.equal(teaserYears({ birth_year: 1925, death_year: null }), '1925 – ؟');
assert.equal(teaserYears({ birth_year: null, death_year: 1990 }), '؟ – 1990');
assert.equal(teaserYears({ birth_year: null, death_year: null }), '');
assert.equal(teaserYears(null), '');
assert.deepEqual([1, 2, 3, 10, 11, 120].map(peopleCountText), ['شخص واحد', 'شخصان', '3 أشخاص', '10 أشخاص', '11 شخصًا', '120 شخصًا']);
assert.equal(FAMILY, 'هرموش');
// ---------- WhatsApp and the message to the accepted person ----------
assert.equal(whatsappLink('+49 170 1234567', 'مرحبا').startsWith('https://wa.me/491701234567?text='), true);
assert.equal(whatsappLink('0049 170 1234567', 'x').startsWith('https://wa.me/491701234567?text='), true, '00 prefix = +');
assert.equal(whatsappLink('+963 9XX', 'x'), null, 'too short to be a number');
assert.equal(whatsappLink('0945 000 111', 'x'), null, 'a local number has no country: no link');
assert.equal(whatsappLink('', 'x'), null);
assert.ok(decodeURIComponent(whatsappLink('+49 170 1234567', 'سطر 1' + String.fromCharCode(10) + 'سطر 2').split('text=')[1]).includes('سطر 2'));
const msg = inviteMessage('أحمد', 'https://example.com/#/join/abc');
assert.ok(msg.includes('أحمد') && msg.includes('https://example.com/#/join/abc') && msg.includes(FAMILY));
// ---------- a link that is not tied to an e-mail ----------
const om = openInviteMessage('https://example.com/#/join/abc', 'أحمد');
assert.ok(om.includes('https://example.com/#/join/abc') && om.includes('أحمد') && om.includes(FAMILY));
assert.ok(om.includes('مرة واحدة') && om.includes('ببريدك'), 'says it works once and that the person uses their own e-mail');
assert.ok(!openInviteMessage('u').includes('undefined') && !openInviteMessage('u', '').includes('، ،'), 'no label: the greeting is still clean');
assert.ok(openInviteMessage('u').startsWith('السلام عليكم،'));
assert.equal(whatsappShare('مرحبا').startsWith('https://wa.me/?text='), true);
assert.equal(decodeURIComponent(whatsappShare('سطر 1 & 2').split('text=')[1]), 'سطر 1 & 2');
console.log('PUBLIC OK');

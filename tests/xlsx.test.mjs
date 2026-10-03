import assert from 'node:assert/strict';
import { buildXlsx, unzip, crc32, columnName, sheetName, xmlEscape } from '../js/xlsx.js';

// crc32 of "123456789" is the standard check value
assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);

assert.deepEqual([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName), ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
assert.equal(xmlEscape('a<b>&"c"\u0001\u0008x'), 'a&lt;b&gt;&amp;&quot;c&quot;x');

const taken = new Set();
assert.equal(sheetName('الأجداد', taken), 'الأجداد');
assert.equal(sheetName('الأجداد', taken), 'الأجداد 2', 'names are unique');
assert.equal(sheetName('a/b[c]:d*e?f' + String.fromCharCode(92) + 'g', new Set()), 'a b c d e f g');
assert.equal(sheetName('x'.repeat(50), new Set()).length, 31);
assert.equal(sheetName('   ', new Set()), 'ورقة');

const bytes = buildXlsx([
  { name: 'الأشخاص', rows: [['الاسم', 'الميلاد', 'الهاتف'], ['سالم <الراشد> & "ابنه"', 1915, '+000 111 222 303'], ['', null, '0944']], widths: [30, 10, 20] },
  { name: 'ثانية', rows: [['عمود']] },
]);
const files = unzip(bytes);
const names = files.map((f) => f.name);
assert.deepEqual(names, ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
assert.ok(files.every((f) => f.crcOk), 'every part has a matching crc');
const text = (n) => new TextDecoder().decode(files.find((f) => f.name === n).data);
const s1 = text('xl/worksheets/sheet1.xml');
assert.ok(s1.includes('rightToLeft="1"'), 'right-to-left sheet');
assert.ok(s1.includes('state="frozen"'), 'header row frozen');
assert.ok(s1.includes('<c r="B2" s="2"><v>1915</v></c>'), 'numbers stay numbers');
assert.ok(s1.includes('+000 111 222 303'), 'a phone number stays text');
assert.ok(s1.includes('سالم &lt;الراشد&gt; &amp; &quot;ابنه&quot;'), 'text is escaped');
assert.ok(!s1.includes('r="A3"') && !s1.includes('r="B3"'), 'empty cells are left out');
assert.ok(s1.includes('<col min="1" max="1" width="30" customWidth="1"/>'));
assert.ok(text('xl/workbook.xml').includes('<sheet name="الأشخاص" sheetId="1" r:id="rId1"/>'));
assert.ok(text('[Content_Types].xml').includes('/xl/worksheets/sheet2.xml'));
assert.throws(() => buildXlsx([]), /at least one sheet/);

// a big sheet still round-trips
const big = Array.from({ length: 3000 }, (_, i) => [`شخص ${i}`, i, 'x'.repeat(20)]);
const bigFiles = unzip(buildXlsx([{ name: 'كبيرة', rows: [['اسم', 'رقم', 'نص'], ...big] }]));
assert.ok(bigFiles.every((f) => f.crcOk));
assert.ok(new TextDecoder().decode(bigFiles[5].data).includes('<row r="3001">'));
console.log('XLSX OK');

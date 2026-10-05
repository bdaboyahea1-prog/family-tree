// The looks of a card: ten of them, measured by what a card holds; the layout leaves room for the part that rises above a card.
import assert from 'node:assert/strict';
import { CARD_STYLES, DEFAULT_CARD_STYLE, isCardStyle, cardMetrics } from '../js/cardstyles.js';
import { buildIndex, buildHierarchy, layout, SIZE } from '../js/tree.js';

// ---------- the list ----------
assert.equal(CARD_STYLES.length, 10);
assert.equal(new Set(CARD_STYLES.map((s) => s.id)).size, 10, 'every look has its own id');
assert.ok(CARD_STYLES.every((s) => s.label && s.note && s.w > 100), 'a name, a few words and a width each');
assert.equal(DEFAULT_CARD_STYLE, 'portrait', 'the look the family chose is the default');
assert.ok(isCardStyle('portrait') && isCardStyle('pill') && !isCardStyle('nope') && !isCardStyle(null));
assert.deepEqual(CARD_STYLES.map((s) => s.id), ['flat', 'header', 'portrait', 'soft', 'leaf', 'id', 'minimal', 'dark', 'medal', 'pill'], 'the order of the mock-ups');

// ---------- the measures ----------
const all = { nick: true, acts: true, years: true };
for (const s of CARD_STYLES) {
  const full = cardMetrics(s.id, all);
  const bare = cardMetrics(s.id, { nick: false, acts: false, years: false });
  assert.ok(full.cardH >= bare.cardH, `${s.id}: more content, not a shorter card`);
  assert.ok(full.cardH > full.head + 40, `${s.id}: a card is at least 40px tall`);
  assert.equal(full.cardW, s.w);
  if (s.id !== 'pill') {
    assert.ok(cardMetrics(s.id, { ...all, nick: false }).cardH < full.cardH, `${s.id}: a nickname line takes room`);
    const noButtons = cardMetrics(s.id, { ...all, acts: false }).cardH;
    if (s.id === 'medal') assert.equal(noButtons, full.cardH, 'medal: the buttons sit beside the figure and take no height');
    else assert.ok(noButtons < full.cardH, `${s.id}: the two buttons take room`);
    assert.ok(cardMetrics(s.id, { ...all, years: false }).cardH <= full.cardH, `${s.id}: and the years`);
  }
}
assert.equal(cardMetrics('portrait', all).head, 26, 'the figure rises 26px above the card');
assert.ok(CARD_STYLES.filter((s) => s.id !== 'portrait').every((s) => cardMetrics(s.id, all).head === 0), 'only that look has a part above the card');
assert.deepEqual(cardMetrics('pill', all), { cardW: 260, cardH: 52, head: 0 });
assert.deepEqual(cardMetrics('nonsense', all), cardMetrics(DEFAULT_CARD_STYLE, all), 'an unknown name falls back to the default look');
assert.ok(cardMetrics('portrait', { ...all, nick: false, acts: false, years: false }).cardH >= 26 + 36 + 8 + 30, 'name, strip and room for the figure');

// ---------- the layout leaves room for the part that rises above ----------
let n = 0;
const P = (id, o = {}) => ({ id, first_name: id, last_name: 'x', gender: 'male', father_id: null, mother_id: null, birth_date: null, created_at: String(++n).padStart(3, '0'), ...o });
const ix = buildIndex([P('a'), P('b', { father_id: 'a' }), P('c', { father_id: 'a' })], []);
const root = buildHierarchy(ix, 'a', new Set());
const m = cardMetrics('portrait', all);
const size = { ...SIZE, ...m };
const v = layout(root, { size });
assert.equal(v.head, 26);
assert.equal(v.cards[0].h, m.cardH, 'a card box counts the part above the card');
assert.equal(v.cards[1].y - v.cards[0].y, m.cardH + SIZE.vGap, 'rows are apart by the whole box');
assert.equal(v.edges[0].y1, v.cards[0].y + m.cardH, 'a line leaves the foot of the parent card');
assert.equal(v.edges[0].y2, v.cards[1].y, 'and reaches the top of the box of the child, which is the top of the figure');
assert.equal(v.cards[0].w, 172);

const h = layout(root, { size, orientation: 'horizontal' });
const mid = m.head + (m.cardH - m.head) / 2;
assert.equal(h.head, 26);
assert.equal(h.edges[0].y1, h.cards[0].y + mid, 'sideways, a line meets the middle of the card itself');
assert.equal(h.edges[0].y2, h.cards.find((c) => c.personId === 'b').y + mid);

const plain = layout(root, { size: SIZE });
assert.equal(plain.head, 0, 'without the option nothing changes');
assert.equal(plain.edges[0].y1, plain.cards[0].y + SIZE.cardH);

const wide = layout(root, { size: { ...SIZE, ...cardMetrics('pill', all) } });
assert.equal(wide.cards[0].w, 260);
assert.equal(wide.cards[0].h, 52);

console.log('CARD STYLES OK');

// the age bubble needs room above the card: the card box grows by what is missing, and never shrinks
import { AGE_HEAD } from '../js/cardstyles.js';
for (const s of CARD_STYLES) {
  const plain = cardMetrics(s.id, { nick: false, acts: true, years: true });
  const withAge = cardMetrics(s.id, { nick: false, acts: true, years: true, age: true });
  assert.ok(withAge.head >= AGE_HEAD, `${s.id}: room for the bubble above the card`);
  assert.equal(withAge.cardH - withAge.head, plain.cardH - plain.head, `${s.id}: the card itself keeps its height`);
  assert.ok(withAge.head >= plain.head && withAge.cardH >= plain.cardH, `${s.id}: nothing shrinks`);
}
console.log('CARD STYLES AGE OK');

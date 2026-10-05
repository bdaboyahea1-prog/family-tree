// The looks a person's card can have. One card structure (see chart.js) drawn ten ways: every look is its own block
// of CSS in css/style.css ([data-card="<id>"] .card) and its own measures here. A look decides how tall (and wide)
// a card is, because the layout needs the same size for every card of the tree.
//
// A card holds: the figure (avatar), the name, the nickname (when anybody in the tree has one), the years, and the
// two buttons "إضافة" and "عرض" (when they are on). The measures below add up the parts that are present.

const NAME = 36; // the name: up to two lines
const NICK = 16; // the nickname line
const YEARS = 25; // the years as a pill
const ACTS = 32; // the row of the two buttons

/**
 * id        the value saved in the settings
 * label     the name shown in the settings
 * note      a few words about it
 * w         card width
 * head      the part of the card that rises above its top edge (the figure that sticks out), counted in its height
 * body(o)   the height of the card itself without that part; o = { nick, acts, years }
 */
export const CARD_STYLES = [
  { id: 'flat', label: 'نظيفة مسطحة', note: 'شريط جانبي رفيع بلون الجنس', w: 172, head: 0, body: (o) => Math.max(72, 20 + NAME + (o.nick ? NICK : 0) + (o.years ? YEARS : 0) + (o.acts ? ACTS : 0)) },
  { id: 'header', label: 'رأس ملوّن', note: 'الاسم على شريط ملوّن في الأعلى', w: 172, head: 0, body: (o) => 46 + 8 + (o.nick ? NICK : 0) + (o.years ? YEARS : 0) + (o.acts ? ACTS : 0) + 10 },
  { id: 'portrait', label: 'صورة بارزة وشريط سنوات', note: 'الأيقونة تبرز من أعلى البطاقة، والسنوات في شريط ملوّن (الافتراضي)', w: 172, head: 26, body: (o) => 30 + NAME + (o.nick ? NICK : 0) + (o.acts ? ACTS - 2 : 0) + (o.years ? 28 : 8) },
  { id: 'soft', label: 'ناعمة مستديرة', note: 'زوايا دائرية جدًا وأزرار مستديرة', w: 172, head: 0, body: (o) => 24 + NAME + (o.nick ? NICK : 0) + (o.years ? YEARS : 0) + (o.acts ? 36 : 0) },
  { id: 'leaf', label: 'ورقة شجر', note: 'زوايا بشكل ورقة وخضرة هادئة', w: 172, head: 0, body: (o) => Math.max(72, 20 + NAME + (o.nick ? NICK : 0) + (o.years ? YEARS : 0) + (o.acts ? ACTS : 0)) },
  { id: 'id', label: 'بطاقة هوية', note: 'مربع الأيقونة على الجانب والسنوات في سطر', w: 172, head: 0, body: (o) => 16 + NAME + (o.nick ? NICK : 0) + (o.years ? 35 : 0) + (o.acts ? 30 : 0) },
  { id: 'minimal', label: 'بسيطة بخط سفلي', note: 'بلا إطار، والسنوات بلون الجنس', w: 172, head: 0, body: (o) => 14 + NAME + (o.nick ? NICK : 0) + (o.years ? 24 : 0) + (o.acts ? 26 : 0) },
  { id: 'dark', label: 'داكنة أنيقة', note: 'خلفية داكنة وسنوات ذهبية', w: 172, head: 0, body: (o) => Math.max(72, 20 + NAME + (o.nick ? NICK : 0) + (o.years ? YEARS : 0) + (o.acts ? ACTS : 0)) },
  { id: 'medal', label: 'وسام', note: 'أيقونة بحلقة وسنوات في شريط أسفل البطاقة', w: 172, head: 0, body: (o) => 10 + 46 + 6 + NAME + (o.nick ? NICK : 0) + (o.years ? 31 : 8) },
  { id: 'pill', label: 'مدمجة للأشجار الكبيرة', note: 'سطر واحد قصير، تناسب الشجرة الكبيرة', w: 260, head: 0, body: () => 52 },
];

export const DEFAULT_CARD_STYLE = 'portrait';

export const isCardStyle = (id) => CARD_STYLES.some((s) => s.id === id);

/** The size of every card for a look: { cardW, cardH, head }. cardH counts the part that rises above the top edge. */
/** The room above a card for the age bubble (the looks whose figure rises higher already have more). */
export const AGE_HEAD = 22;

export function cardMetrics(id, { nick = false, acts = true, years = true, age = false } = {}) {
  const s = CARD_STYLES.find((x) => x.id === id) || CARD_STYLES.find((x) => x.id === DEFAULT_CARD_STYLE);
  const head = Math.max(s.head, age ? AGE_HEAD : 0);
  return { cardW: s.w, cardH: head + s.body({ nick, acts, years }), head };
}

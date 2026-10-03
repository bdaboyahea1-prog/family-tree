// "About the designer": the (i) button in the top bar.
//
// The text itself (name, a few lines, phone, e-mail) is NOT stored in this file, on purpose: this
// code is published openly, while the text is stored in the database (trees.about) where only
// the members of the tree can read it and only the admin can edit it (from the dialog itself).
export const ABOUT_TITLE = 'عن مصمم التطبيق';

/** Shape of trees.about: { name, place, greeting, text, phone, email }. All parts are optional. */
export const ABOUT_FIELDS = ['name', 'place', 'greeting', 'text', 'phone', 'email'];

/** Keep only the known string fields, trimmed and cut to a sane length; null if nothing is left. */
export function cleanAbout(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const k of ABOUT_FIELDS) {
    const v = String(raw[k] ?? '').trim();
    if (v) out[k] = v.slice(0, k === 'text' ? 2000 : 200);
  }
  return Object.keys(out).length ? out : null;
}

/** The body text as paragraphs (blank line = new paragraph). */
export function aboutParagraphs(about) {
  return String(about?.text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

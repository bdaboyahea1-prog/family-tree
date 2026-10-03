// The public page and the join request: the checks and the shapes of the data (no DOM here).
import { validPhone, validEmail } from './transfer.js';

/** The family the public page is about (also written in index.html, where search engines read it). */
export const FAMILY = 'هرموش';

export const DOC_MAX_BYTES = 5 * 1024 * 1024;
export const DOC_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** null when the file is fine, else what is wrong with it. */
export function checkDoc(file) {
  if (!file) return 'ارفع صورة الوثيقة أو ملف PDF';
  if (!DOC_TYPES[file.type]) return 'نوع الملف غير مقبول: ارفع صورة (JPG أو PNG أو WebP) أو ملف PDF';
  if (file.size > DOC_MAX_BYTES) return 'الملف أكبر من 5 ميغابايت';
  if (file.size === 0) return 'الملف فارغ';
  return null;
}

/** The extension the server is told about ("pdf"): it builds the one path where this document may be uploaded. */
export const docExt = (file) => DOC_TYPES[file.type] || null;

/** The secret code of a request: 32 hex characters. */
export const isTrackCode = (code) => /^[0-9a-f]{32}$/.test(String(code || '').trim().toLowerCase());
export const cleanTrackCode = (code) => String(code || '').replace(/\s+/g, '').toLowerCase();

/**
 * values: { full_name, relation, country, city, phone, email, consent, file }
 * The city and the document are optional (but a document that is given must be acceptable).
 * Returns { errors: { field: message }, clean } where clean = the fields as the database wants them.
 */
export function validateJoin(values) {
  const errors = {};
  const v = {
    full_name: collapse(values.full_name),
    relation: collapse(values.relation),
    country: values.country || '',
    city: collapse(values.city),
    phone: collapse(values.phone),
    email: collapse(values.email).toLowerCase(),
  };
  if (v.full_name.length < 2) errors.full_name = 'اكتب اسمك الكامل';
  else if (v.full_name.length > 120) errors.full_name = 'الاسم أطول من المسموح';
  if (v.relation.length < 15) errors.relation = 'اشرح صلتك بالعائلة: اسم والدك وجدّك والفرع الذي تنتمي إليه (15 حرفًا على الأقل)';
  else if (v.relation.length > 1500) errors.relation = 'الشرح أطول من المسموح (1500 حرف)';
  if (!/^[A-Z]{2}$/.test(v.country)) errors.country = 'اختر البلد الذي تقيم فيه';
  if (v.city.length > 100) errors.city = 'اسم المدينة أطول من المسموح';
  // the phone and the e-mail are optional: without both, the person follows the request with the tracking code
  if (v.phone && !validPhone(v.phone)) errors.phone = 'رقم الهاتف غير صالح: أرقام فقط، ويجوز + في البداية';
  if (v.email && !validEmail(v.email)) errors.email = 'البريد الإلكتروني غير صالح';
  const docError = values.file ? checkDoc(values.file) : null; // no document is fine
  if (docError) errors.file = docError;
  if (!values.consent) errors.consent = 'يلزم الموافقة على الشرط الأخير';
  return { errors, clean: v };
}

/** The arguments of submit_join_request() (supabase/011). `hp` is the hidden field robots fill. */
export function submitArgs({ treeId, clean, file, hp = '' }) {
  return {
    p_tree: treeId,
    p_full_name: clean.full_name,
    p_relation: clean.relation,
    p_country: clean.country,
    p_city: clean.city,
    p_phone: clean.phone,
    p_email: clean.email,
    p_doc_ext: file ? docExt(file) : '', // '' = no document
    p_hp: hp,
  };
}

/**
 * wa.me link to message the applicant: only when the phone has its country code ("+49 170…" or "0049 170…");
 * a local number cannot be turned into a WhatsApp address. null when it cannot.
 */
export function whatsappLink(phone, text) {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  const international = raw.startsWith('+') ? digits : raw.startsWith('00') ? digits.slice(2) : '';
  if (international.length < 8) return null;
  return `https://wa.me/${international}?text=${encodeURIComponent(text)}`;
}

/** What the admin sends to an accepted applicant. */
export const inviteMessage = (name, url) =>
  `السلام عليكم ${name}،
تمت الموافقة على طلبك للانضمام إلى شجرة عائلة ${FAMILY}.
افتح الرابط التالي وأنشئ حسابك بنفس بريدك الإلكتروني الذي كتبته في الاستمارة:
${url}
الرابط خاص بك ويُستخدم مرة واحدة.`;

/** What the admin sends with a link that is not tied to an e-mail (supabase/013). `label` = who it is for, if he wrote one. */
export const openInviteMessage = (url, label = '') =>
  `السلام عليكم${label ? ` ${label}` : ''}،
أدعوك إلى شجرة عائلة ${FAMILY}.
افتح الرابط التالي وأنشئ حسابك ببريدك الإلكتروني الخاص بك لتدخل الشجرة:
${url}
الرابط خاص بك ويعمل مرة واحدة فقط، فلا تشاركه مع غيرك.`;

/** A WhatsApp link that opens the contact picker (the admin chooses the person; no phone number is needed). */
export const whatsappShare = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** "1890 – 1960" for a card of the public teaser ('' when nothing is known; a living person has no years). */
export function teaserYears(card) {
  if (!card || (!card.birth_year && !card.death_year)) return '';
  return `${card.birth_year ?? '؟'} – ${card.death_year ?? '؟'}`;
}

/** How many people the page may say the tree has: "أكثر من 20" style numbers are not used, the exact count is fine. */
export const peopleCountText = (n) => (n === 1 ? 'شخص واحد' : n === 2 ? 'شخصان' : n >= 3 && n <= 10 ? `${n} أشخاص` : `${n} شخصًا`);

export const JOIN_STATUS = { draft: 'غير مكتمل', pending: 'قيد المراجعة', approved: 'تمت الموافقة', rejected: 'لم تتم الموافقة', cancelled: 'ملغى' };

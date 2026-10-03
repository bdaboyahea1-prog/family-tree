// Family tree web app: auth, data loading, editing, sharing. Talks to Supabase directly;
// all permission checks are enforced by Row Level Security in the database (supabase/schema.sql).
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import {
  buildIndex, buildHierarchy, layout, autoCollapse, defaultRoot, topAncestor, lineAncestorsOf,
  lineParent, commonChildren, descendantsOf, search, describe, fullName, lifeSpan, SPOUSE_COLORS,
  spouseLabel, spouseLines, countryList, countryLabel, residenceText, birthText, placeOf, placeStats, filterPersons,
  fatherLine, motherLine, polar, SIZE, cardName,
} from './tree.js';
import { PhotoStore, compressImage } from './photos.js';
import { provincesOf, citiesOf } from './places-data.js';
import { ABOUT_TITLE, cleanAbout, aboutParagraphs } from './about.js';
import { toJson, fromJson, toGedcom, fromGedcom, planImport, chunk, validPhone, validEmail } from './transfer.js';
import { Chart, makeCard } from './chart.js';
import { CARD_STYLES, cardMetrics } from './cardstyles.js';
import { FACTORY_LOOK, cleanLook, resolveLook, legacyLook } from './look.js';
import { genderIcon } from './gender.js';
import { buildXlsx, XLSX_MIME } from './xlsx.js';
import { personSheets, treeSheets, fatherSideName, motherSideName } from './exports.js';
import { groupChanges, sideEffects, deletedGroups } from './history.js';
import { planQuickAdd, linkNewSpouse, blankRow, blankExtra, rowFromInfo, spouseKindLabel } from './quickadd.js';
import { FAMILY, validateJoin, submitArgs, isTrackCode, cleanTrackCode, whatsappLink, inviteMessage, openInviteMessage, whatsappShare, teaserYears, peopleCountText, JOIN_STATUS } from './public.js';
import { makePermissions, rightsText, FLAGS, FLAG_LABEL } from './permissions.js';
import { demoPersons, demoMarriages, makeFakeSb, demoAbout } from './demo.js';

// Sample family, nothing is saved anywhere:
//   #/demo         read only
//   #/demo-edit    an editor: shows the editing forms
//   #/demo-branch  a reader who was given the branch of "عبدالله" with add + edit + grant
//   #/demo-admin   the admin: sharing / invitation / branch dialogs run against a fake in-memory backend
// #/offline: the copy of the tree kept on this device, opened with no connection (read only, through the same screens as the sample)
const OFFLINE = location.hash === '#/offline';
const DEMO = location.hash.startsWith('#/demo') || OFFLINE;
const DEMO_ROLE = { '#/demo-edit': 'editor', '#/demo-admin': 'admin' }[location.hash] || 'viewer';
const DEMO_GRANTS = new Map(location.hash === '#/demo-branch' ? [['a', { add: true, edit: true, delete: false, grant: true }]] : []);
const DEMO_LANDING = location.hash === '#/demo-landing'; // the front page with a make-believe public tree and visitor
const FAKE_BACKEND = location.hash === '#/demo-admin' || location.hash === '#/demo-branch';
const SVGNS = 'http://www.w3.org/2000/svg';
const app = document.getElementById('app');

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice just won't be remembered */
  }
}

/** @type {import('@supabase/supabase-js').SupabaseClient} */
let sb = null;

const state = {
  user: null,
  profile: null,
  memberships: [], // [{ role, tree: { id, name } }]
  treeId: null,
  role: null,
  persons: new Map(),
  marriages: new Map(),
  index: null,
  layout: null,
  rootId: null,
  selectedId: null,
  grants: new Map(), // branch heads granted to this user (viewers only): personId -> { add, edit, delete, grant }
  perms: null,
  names: null, // user id -> display name of the members of this tree
  namesTree: null,
  inboxTimer: null,
  activeSpouse: null, // spouse whose children are highlighted for the selected person
  // the look of the tree (js/look.js): the factory look <- what the admin chose for everybody <- what I chose for myself
  ...FACTORY_LOOK,
  theme: ['auto', 'light', 'dark'].includes(safeGet('ft.themecache') ?? safeGet('ft.theme')) ? safeGet('ft.themecache') ?? safeGet('ft.theme') : 'auto', // remembered only so a page load does not flash the wrong colours
  lookDefault: {}, // the choices of the tree admin (trees.default_look)
  lookMine: {}, // my own choices (profiles.look)
  offlineAt: null, // when the copy that is open without a connection was made
  quickTable: safeGet('ft.quick') === '1', // the quick-add table next to a card (off until switched on)
  quickFor: null, // the person the quick-add table is open for
  quickMode: 'cards', // 'cards' = the table adds cards; 'info' = it writes the information table of a woman
  info: new Map(), // woman's id -> her information rows (sons / daughters written as information, not as cards)
  collapsed: new Set(),
  channel: null,
};
let chart = null;
let ui = {};
/** @type {PhotoStore|null} signed-URL cache for the private photo bucket (not used in the demo pages) */
let photos = null;

/** Light / dark: "auto" leaves it to the device (no data-theme attribute). */
/** A phone held upright (the same width as the css of the phone: bottom bar, simpler cards). */
const isPhone = () => !!window.matchMedia?.('(max-width: 600px)').matches;

/** Is the screen dark right now: chosen "dark", or "auto" on a device that is set to dark. */
const isDarkNow = () => state.theme === 'dark' || (state.theme === 'auto' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
let syncThemeBtn = () => {}; // set when the toolbar is drawn: the sun / moon button

function applyTheme() {
  if (state.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = state.theme;
  remember('ft.themecache', state.theme); // so the next page load starts in the right colours
  syncThemeBtn();
}
applyTheme();
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => syncThemeBtn()); // "auto" follows the device

// ====================================================================
// small DOM helpers
// ====================================================================

function h(tag, props, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'value') node.value = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) node.append(kid);
  return node;
}

/**
 * node.replaceChildren(...kids) that skips the null / false a `cond && h(...)` leaves in the list
 * (the DOM would write them as the words "null" and "false").
 */
function put(node, ...kids) {
  node.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false && k !== true));
}

const ICONS = {
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  history: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
  menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
  parents: '<circle cx="12" cy="4" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 6v4"/><path d="M5 17v-2a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2"/>',
  child: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-1a7 7 0 0 1 14 0v1"/>',
  tree: '<path d="M12 3v6"/><path d="M5 13V9h14v4"/><path d="M12 9v4"/><circle cx="5" cy="17" r="3"/><circle cx="12" cy="17" r="3"/><circle cx="19" cy="17" r="3"/>',
};
function icon(name) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'icon');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name];
  return s;
}

/** Closes every open dialog and brings a card into view, selected. */
function goToCard(id) {
  if (!state.index?.byId.has(id)) return;
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  focusPerson(id);
}

/** A person's name as a link that takes you to their card (for "branch of ..." texts). */
const branchLink = (p) => h('button', { class: 'link-btn branch-link', type: 'button', title: 'الانتقال إلى هذا الفرع', onclick: () => goToCard(p.id), text: fullName(p) });

/** A small button: icon + visible text (so nobody has to guess what an icon does). */
const miniBtn = (name, text, onclick, { danger = false, title = text } = {}) =>
  h('button', { class: `mini-btn${danger ? ' danger' : ''}`, type: 'button', title, 'aria-label': title, onclick }, icon(name), text);

let toastTimer;
function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), isErr ? 5000 : 2800);
}

// ====================================================================
// the back button of the phone
// ====================================================================
// A dialog, the search page and the card panel are "layers" over the main screen. Opening one adds an entry to the history, so the back
// button closes the top layer (and shows what was under it) instead of leaving the app. On the main screen the first press only says
// so, and a second press leaves. Only touch screens (phones, tablets) do this: a computer keeps the normal behaviour of the browser.
//
// Every entry we add carries its depth ({ ftLayer: k }); the entry of the main screen carries { ftHome: true }. After any step through
// the history the stack of layers is brought to the depth of the entry where the person landed: that is all "back" has to do.

const TOUCH = !!window.matchMedia?.('(pointer: coarse), (max-width: 600px)').matches;
const HOME_STATE = { ftHome: true };
const backLayers = []; // the layers that are open, the top one last: { close, gone, k }
let selfUntil = 0; // until when a step through the history is one we took ourselves (a layer closed by its own button)
let homeLeft = false; // the entry of the main screen was used up by a press of "back" (the hint is showing)
let homeTimer = null;
const depthOf = (st) => (typeof st?.ftLayer === 'number' ? st.ftLayer : 0);

/** A layer was opened: it gets one history entry. `close` closes it (it is called when "back" removes the entry). */
function backPush(close) {
  if (!TOUCH) return null;
  const layer = { close, gone: false, k: depthOf(history.state) + 1 };
  backLayers.push(layer);
  history.pushState({ ftLayer: layer.k }, '');
  return layer;
}

/** The layers on top that are already closed give their entries back (one step through the history). */
function backTrim() {
  if (!backLayers.at(-1)?.gone) return false;
  while (backLayers.at(-1)?.gone) backLayers.pop();
  const delta = depthOf(history.state) - (backLayers.at(-1)?.k ?? 0);
  if (delta <= 0) return false;
  selfUntil = performance.now() + 500;
  history.go(-delta);
  return true;
}

/** A layer was closed by something other than "back" (its own button). Its entry is given back a moment later, so that a layer
 *  opened in the same breath (a menu item that opens a dialog) is not mixed up with it. */
function backRelease(layer) {
  if (!layer || layer.gone) return;
  layer.gone = true;
  setTimeout(backTrim, 0);
}

function restoreHome() {
  clearTimeout(homeTimer);
  if (!homeLeft || backLayers.length) return;
  homeLeft = false;
  history.pushState(HOME_STATE, ''); // the next press of "back" shows the hint again
}

window.addEventListener('popstate', () => {
  if (!TOUCH || !ui?.viewport?.isConnected) return; // not the main screen (sign-in, front page): the browser does what it does
  const ours = performance.now() < selfUntil;
  selfUntil = 0;
  const wasEmpty = backLayers.length === 0;
  const depth = depthOf(history.state);
  let closed = false;
  while (backLayers.length && backLayers.at(-1).k > depth) {
    const layer = backLayers.pop();
    if (!layer.gone) {
      layer.gone = true;
      layer.close();
      closed = true;
    }
  }
  if (ours) return void (backLayers.length || restoreHome());
  if (closed) return void setTimeout(() => backTrim() || restoreHome(), 30); // (a step taken inside popstate itself is dropped by the browser)
  if (wasEmpty && depth === 0 && !history.state?.ftHome) {
    // the main screen: the first press tells, the second one leaves (nothing is under this entry any more)
    toast('اضغط «رجوع» مرة أخرى للخروج');
    homeLeft = true;
    clearTimeout(homeTimer);
    homeTimer = setTimeout(restoreHome, 2500);
  }
});

if (TOUCH) {
  // the entry of the main screen is added at the first touch (a browser skips entries that a page adds before the person did anything)
  const arm = () => {
    if (!ui?.viewport?.isConnected) return;
    removeEventListener('pointerup', arm, true);
    removeEventListener('click', arm, true);
    if (!history.state?.ftHome && !history.state?.ftLayer) history.pushState(HOME_STATE, '');
  };
  addEventListener('pointerup', arm, true);
  addEventListener('click', arm, true);
}

/** The card panel is a layer while a card is chosen. */
let panelLayer = null;
function syncPanelLayer(open) {
  if (open && !panelLayer) {
    panelLayer = backPush(() => {
      panelLayer = null;
      select(null);
      chart?.setSelected(null);
      renderPanel();
    });
  } else if (!open && panelLayer) {
    const layer = panelLayer;
    panelLayer = null;
    backRelease(layer);
  }
}

function friendly(err) {
  const m = String(err?.message || err || '');
  const map = [
    [/invalid login credentials/i, 'البريد الإلكتروني أو كلمة المرور غير صحيحة'],
    [/already registered|already been registered/i, 'هذا البريد مسجّل مسبقًا، جرّب تسجيل الدخول'],
    [/password should be at least|weak password/i, 'كلمة المرور قصيرة، استخدم 6 أحرف على الأقل'],
    [/email not confirmed/i, 'لم يتم تأكيد البريد الإلكتروني بعد'],
    [/rate limit|too many/i, 'محاولات كثيرة، انتظر قليلًا ثم أعد المحاولة'],
    [/unable to validate email|invalid format|invalid email/i, 'صيغة البريد الإلكتروني غير صحيحة'],
    [/access_requests_one_pending/i, 'لديك طلب قائم على هذه البطاقة بانتظار القرار'],
    [/(column|relation|table).*nickname.*(does not exist|schema cache)|could not find the .*nickname/i, 'لم تُنفَّذ بعدُ خطوة قاعدة البيانات 014 (اللقب المشتهر به). نفّذها من SQL Editor ثم أعد المحاولة.'],
    [/(column|relation|table).*(default_look|\blook\b).*(does not exist|schema cache)|could not find the .*(default_look|look)/i, 'لم تُنفَّذ بعدُ خطوة قاعدة البيانات 015 (الشكل الافتراضي). نفّذها من SQL Editor ثم أعد المحاولة.'],
    [/persons_nickname_check/i, 'اللقب المشتهر به أطول من المسموح (100 حرف)'],
    [/persons_phone_check/i, 'رقم الهاتف غير صالح: أرقام فقط، ويجوز + في البداية ومسافات وأقواس وشرطات'],
    [/persons_email_check/i, 'البريد الإلكتروني غير صالح'],
    [/trees_about_check/i, 'النص أطول من المسموح'],
    [/female cards cannot hold branches/i, 'قاعدة هذه الشجرة لا تسمح بإضافة بطاقة تحت بطاقة امرأة. أضف الابن من بطاقة أبيه، أو غيّر القاعدة من الإعدادات (للمدير).'],
    [/(column|relation|table).*(female_card_mode|card_info).*(does not exist|schema cache)|could not find the .*(female_card_mode|card_info)/i, 'لم تُنفَّذ بعدُ خطوة قاعدة البيانات 009 (بطاقات الإناث). نفّذها من SQL Editor ثم أعد المحاولة.'],
    [/too many join requests/i, 'وصلت طلبات كثيرة الآن، حاول بعد قليل أو غدًا.'],
    [/join requests are closed/i, 'استمارة الانضمام مغلقة حاليًا. يدخل الشجرة من وصلته دعوة من مدير الشجرة.'],
    [/request already open/i, 'لديك طلب قيد المراجعة بهذا البريد. تابعه برقم المتابعة الذي وصلك.'],
    [/already a member/i, 'هذا البريد عضو في الشجرة بالفعل. سجّل دخولك.'],
    [/too many open invitations/i, 'عندك 30 رابطًا مفتوحًا لم يُستخدم بعد. ألغِ بعضها أو انتظر استخدامها ثم أنشئ رابطًا جديدًا.'],
    [/invite already used/i, 'استُخدمت الدعوة بالفعل، فلا يمكن تغيير البريد الآن.'],
    [/request not found/i, 'لا يوجد طلب مقبول بهذا الرقم.'],
    [/document missing/i, 'لم يصل ملف الوثيقة. أعد المحاولة.'],
    [/invalid document type/i, 'نوع الملف غير مقبول: ارفع صورة (JPG أو PNG أو WebP) أو ملف PDF'],
    [/join_requests_one_pending|duplicate key.*join_requests/i, 'لديك طلب انضمام قيد المراجعة بالفعل.'],
    [/(column|relation|table).*(public_page|public_show_living|join_requests).*(does not exist|schema cache)|could not find the .*(public_page|public_show_living|join_requests)/i, 'لم تُنفَّذ بعدُ خطوة قاعدة البيانات 010 (الصفحة العامة وطلبات الانضمام). نفّذها من SQL Editor ثم أعد المحاولة.'],
    [/exceeded the maximum allowed size|payload too large/i, 'الملف أكبر من 5 ميغابايت'],
    [/mime type|invalid_mime/i, 'نوع الملف غير مقبول: ارفع صورة (JPG أو PNG أو WebP) أو ملف PDF'],
    [/row-level security|permission denied|PGRST116|no rows/i, 'ليست لديك صلاحية لهذا الإجراء، أو لم يعد العنصر موجودًا'],
    [/duplicate key|already exists/i, 'هذا العنصر مسجّل مسبقًا'],
    [/at least one admin/i, 'يجب أن يبقى مدير واحد على الأقل في الشجرة'],
    [/invite is for another email/i, 'هذه الدعوة مخصصة لبريد إلكتروني آخر. سجّل الدخول بالبريد الذي وصلته عليه الدعوة.'],
    [/invalid or disabled invite/i, 'رابط الدعوة غير صالح أو سبق استخدامه أو أُلغي'],
    [/invalid email/i, 'البريد الإلكتروني غير صالح'],
    [/choose at least one right/i, 'اختر صلاحية واحدة على الأقل'],
    [/not allowed to grant/i, 'لا تملك صلاحية منح هذه الحقوق على هذه البطاقة'],
    [/reader role/i, 'يجب أن يكون العضو بدور «قارئ» لتُمنح له صلاحية فرع'],
    [/nothing to revoke|given by someone else/i, 'لا يمكنك تغيير هذه الصلاحية، فقد منحها غيرك'],
    [/admins only/i, 'هذا الإجراء للمدير فقط'],
    [/not allowed to create trees/i, 'لا يمكنك إنشاء شجرة جديدة. يدخل أفراد العائلة بدعوة من مدير الشجرة.'],
    [/only readers can request access/i, 'طلب الصلاحية لأعضاء الشجرة بدور «قارئ» فقط'],
    [/too many pending requests/i, 'لديك 5 طلبات بانتظار القرار، انتظر الرد عليها أو ألغِ بعضها'],
    [/too many (reports|comments)/i, 'أرسلت الكثير في وقت قصير، حاول بعد قليل'],
    [/request already decided/i, 'سبق اتخاذ قرار في هذا الطلب'],
    [/not allowed to (decide|handle)/i, 'لا تملك صلاحية البت في هذا الأمر'],
    [/write what is wrong/i, 'اكتب ما هو الخطأ'],
    [/members only/i, 'هذا الإجراء لأعضاء الشجرة فقط'],
    [/not authorized|error sending|smtp|sending confirmation/i, 'تعذّر إرسال رسالة التأكيد: لم تُفعَّل بعدُ خدمة البريد في المشروع. جرّب «المتابعة بحساب Google» أو اطلب من المدير.'],
    [/provider is not enabled|unsupported provider/i, 'الدخول بحساب Google غير مفعّل بعد'],
    [/changed since/i, 'تغيّر هذا العنصر بعد ذلك، لذلك لا يمكن التراجع الآن. تراجع أولًا عن التغييرات الأحدث ثم أعد المحاولة.'],
    [/change not found/i, 'لم يعد هذا التغيير موجودًا في السجل'],
    [/tree limit reached/i, 'وصلت إلى الحد الأقصى من الأشجار'],
    [/failed to fetch|networkerror|load failed/i, 'تعذّر الاتصال بالإنترنت'],
  ];
  for (const [re, text] of map) if (re.test(m)) return text;
  return m || 'حدث خطأ غير متوقع';
}

const orNull = (s) => {
  const t = String(s ?? '').trim();
  return t ? t : null;
};
const ROLE_LABEL = { admin: 'مدير', editor: 'محرّر', viewer: 'قارئ' };
const STATUS_LABEL = { married: 'متزوجان', divorced: 'منفصلان', widowed: 'ترمّل' };

// ====================================================================
// dialogs
// ====================================================================

function modal(title, body, { onclose, backdropClose = true } = {}) {
  const dlg = h(
    'dialog',
    { class: 'modal' },
    h(
      'div',
      { class: 'modal-head' },
      h('h2', { text: title }),
      miniBtn('x', 'إغلاق', () => dlg.close()),
    ),
    h('div', { class: 'modal-body' }, body),
  );
  const layer = backPush(() => dlg.close());
  const closeDialog = dlg.close.bind(dlg);
  dlg.close = (...a) => (closeDialog(...a), backRelease(layer));
  dlg.addEventListener('close', () => {
    backRelease(layer);
    dlg.remove();
    if (onclose) onclose();
  });
  if (backdropClose) dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function choose(title, options, message) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      dlg.close();
      resolve(v);
    };
    const body = h(
      'div',
      { class: 'stack' },
      message && h('p', { class: 'muted', text: message }),
      options.map((o) => h('button', { class: 'btn' + (o.danger ? ' danger' : ''), type: 'button', onclick: () => finish(o.value), text: o.label })),
    );
    const dlg = modal(title, body, { onclose: () => finish(null) });
  });
}

async function confirmBox(title, message, okLabel = 'تأكيد', danger = false) {
  return (await choose(title, [{ label: okLabel, value: true, danger }, { label: 'إلغاء', value: false }], message)) === true;
}

/** Search-and-pick dialog. Resolves with a person id or null. */
function pickPerson({ title, filter }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      dlg.close();
      resolve(v);
    };
    const input = h('input', { type: 'search', placeholder: 'ابحث بالاسم…', 'aria-label': 'بحث بالاسم' });
    const list = h('ul', { class: 'list' });
    const show = () => {
      const res = search(state.index, input.value, { limit: 30, filter });
      put(list, 
        ...(res.length
          ? res.map((p) => h('li', {}, h('button', { class: 'btn block', type: 'button', onclick: () => finish(p.id), text: describe(state.index, p) })))
          : [h('li', { class: 'muted', text: input.value.trim() ? 'لا توجد نتائج' : 'اكتب جزءًا من الاسم' })]),
      );
    };
    input.addEventListener('input', show);
    const dlg = modal(title, h('div', { class: 'stack' }, input, list), { onclose: () => finish(null) });
    show();
    input.focus();
  });
}

let fieldSeq = 0;
function field(label, input) {
  const id = `f${++fieldSeq}`;
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id, text: label }), input);
}

// ---------- place pickers: country -> province -> city ----------

const OTHER = '__other__';

/**
 * One field that is a drop-down when we have a list ("غير ذلك (اكتب)" at the end turns it into a text
 * box) and a plain text box otherwise. Text boxes suggest names already used in the tree.
 */
function chooser(label) {
  const seq = ++fieldSeq;
  const sel = h('select', { 'aria-label': label });
  const txt = h('input', { type: 'text', maxlength: 100, autocomplete: 'off', list: `sg${seq}`, 'aria-label': label });
  const dl = h('datalist', { id: `sg${seq}` });
  const node = h('div', { class: 'field' }, h('label', { for: `ch${seq}`, text: label }), sel, txt, dl);
  sel.id = `ch${seq}`;
  const api = { node, onChange: () => {} };

  /**
   * options: list to choose from (null = free text only); suggestions: hints for the text box;
   * value: what to show; disabled: message shown instead of a box until something else is chosen.
   */
  api.set = ({ options = null, suggestions = [], value = '', disabled = '' }) => {
    put(dl, ...[...new Set(suggestions)].slice(0, 150).map((s) => h('option', { value: s })));
    if (disabled) {
      sel.hidden = true;
      txt.hidden = false;
      txt.disabled = true;
      txt.value = '';
      txt.placeholder = disabled;
      return;
    }
    txt.disabled = false;
    txt.placeholder = 'اكتب الاسم';
    if (options && options.length) {
      sel.hidden = false;
      put(sel, 
        h('option', { value: '', text: '— اختر —' }),
        ...options.map((o) => h('option', { value: o, text: o })),
        h('option', { value: OTHER, text: 'غير ذلك (اكتب)' }),
      );
      if (!value) {
        sel.value = '';
        txt.hidden = true;
        txt.value = '';
      } else if (options.includes(value)) {
        sel.value = value;
        txt.hidden = true;
        txt.value = '';
      } else {
        sel.value = OTHER; // a value we have no list entry for (older record, or typed by someone)
        txt.hidden = false;
        txt.value = value;
      }
    } else {
      sel.hidden = true;
      txt.hidden = false;
      txt.value = value || '';
    }
  };
  api.get = () => {
    if (!sel.hidden) return sel.value === OTHER ? txt.value.trim() || null : sel.value || null;
    return txt.disabled ? null : txt.value.trim() || null;
  };
  sel.addEventListener('change', () => {
    txt.hidden = sel.value !== OTHER;
    if (sel.value === OTHER) txt.focus();
    api.onChange('select');
  });
  txt.addEventListener('input', () => api.onChange('text'));
  return api;
}

/**
 * Country, then province, then city. Each list depends on the one before it; the lists come from
 * places-data.js and places we have no list for fall back to text boxes. `kind` is 'residence' or
 * 'birth' (only used to suggest names that the tree already contains).
 * init = { country, province, city }.  get() -> { country, province, city } (each or null).
 */
function placePicker(kind, init = {}) {
  const country = h(
    'select',
    { 'aria-label': 'البلد' },
    h('option', { value: '', text: '— غير محدد —' }),
    countryList().map((c) => h('option', { value: c.code, text: c.name })),
  );
  country.value = init.country || '';
  const province = chooser('المحافظة / المنطقة');
  const city = chooser('المدينة');
  const countryField = h('div', { class: 'field' }, h('label', { text: 'البلد' }), country);

  const seen = () => placeStats(state.index, kind).find((c) => c.code === (country.value || ''));

  const fillProvince = (value) => {
    const code = country.value;
    const known = seen();
    province.set({
      options: code ? provincesOf(code) : null,
      suggestions: (known?.provinces || []).map((p) => p.name),
      value,
      disabled: code ? '' : 'اختر البلد أولًا',
    });
  };
  const fillCity = (value) => {
    const code = country.value;
    const prov = province.get();
    const known = seen();
    const list = code && prov ? citiesOf(code, prov) : null;
    // a province is needed first whenever we know the country's provinces
    const needProvince = code && provincesOf(code) && !prov;
    const seenCities = prov
      ? known?.provinces.find((p) => p.name === prov)?.cities || []
      : known?.cities || [];
    city.set({
      options: list,
      suggestions: seenCities.map((c) => c.name),
      value,
      disabled: !code ? 'اختر البلد أولًا' : needProvince ? 'اختر المحافظة أولًا' : '',
    });
  };

  country.addEventListener('change', () => {
    fillProvince('');
    fillCity('');
  });
  province.onChange = (source) => fillCity(source === 'select' ? '' : city.get() || '');
  fillProvince(init.province || '');
  fillCity(init.city || '');

  return {
    node: h('div', { class: 'place-picker' }, countryField, province.node, city.node),
    get: () => ({ country: country.value || null, province: province.get(), city: city.get() }),
  };
}

/**
 * Where they live now: by default the same as the birth place (one choice less to fill in);
 * "عنوان سكن مختلف" reveals the pickers for another address.
 * v = values with birth_* and residence_* ; returns { nodes, get() -> { country, province, city } }.
 */
function residenceFields(birthPicker, v) {
  const triple = (c, pr, ci) => ({ country: c || '', province: String(pr || '').trim(), city: String(ci || '').trim() });
  const b0 = triple(v.birth_country, v.birth_province, v.birth_city);
  const r0 = triple(v.residence_country, v.residence_province, v.residence_city);
  let sameAsBirth = (!r0.country && !r0.province && !r0.city) || (b0.country === r0.country && b0.province === r0.province && b0.city === r0.city);
  const homePicker = placePicker('residence', sameAsBirth ? {} : { country: v.residence_country, province: v.residence_province, city: v.residence_city });
  const sameBtn = h('button', { type: 'button', text: 'نفس مكان الميلاد' });
  const diffBtn = h('button', { type: 'button', text: 'عنوان سكن مختلف' });
  const homeBox = h('div', {}, homePicker.node);
  const sameNote = h('p', { class: 'muted small-note', text: 'سيُسجَّل مكان السكن الحالي مثل مكان الميلاد المكتوب أعلاه. اختر «عنوان سكن مختلف» إن كان يسكن في مكان آخر.' });
  const syncHome = () => {
    sameBtn.setAttribute('aria-pressed', String(sameAsBirth));
    diffBtn.setAttribute('aria-pressed', String(!sameAsBirth));
    homeBox.hidden = sameAsBirth;
    sameNote.hidden = !sameAsBirth;
  };
  sameBtn.addEventListener('click', () => ((sameAsBirth = true), syncHome()));
  diffBtn.addEventListener('click', () => ((sameAsBirth = false), syncHome()));
  syncHome();
  const toggle = h('div', { class: 'seg full', role: 'group', 'aria-label': 'مكان السكن الحالي' }, sameBtn, diffBtn);
  return { nodes: [toggle, sameNote, homeBox], get: () => (sameAsBirth ? birthPicker : homePicker).get() };
}

/**
 * Everything below the four main columns of a quick-add line: the same details a card has.
 * init = blankExtra()-shaped values.  get() -> the same shape;  photo() -> a shrunk image or null.
 */
function detailsEditor(init, { photo = false } = {}) {
  const x = { ...blankExtra(), ...init };
  const last = h('input', { type: 'text', maxlength: 100, value: x.last_name || '', autocomplete: 'off', placeholder: 'يُملأ تلقائيًا لأبناء الرجل' });
  const phone = h('input', { type: 'tel', inputmode: 'tel', dir: 'ltr', maxlength: 25, autocomplete: 'off', value: x.phone || '', placeholder: '+963 9XX XXX XXX' });
  const email = h('input', { type: 'email', inputmode: 'email', dir: 'ltr', maxlength: 254, autocomplete: 'off', value: x.email || '', placeholder: 'name@example.com' });
  const notes = h('textarea', { maxlength: 2000, value: x.notes || '' });
  const birthDetail = h('input', { type: 'text', maxlength: 100, value: x.birth_place || '', autocomplete: 'off', placeholder: 'مثال: اسم المستشفى أو القرية (اختياري)' });
  const birthPicker = placePicker('birth', { country: x.birth_country, province: x.birth_province, city: x.birth_city });
  const home = residenceFields(birthPicker, x);
  const deceased = h('input', { type: 'checkbox', id: `qd${++fieldSeq}` });
  deceased.checked = !!x.deceased;

  let blob = null;
  let photoField = null;
  if (photo && photos) {
    const input = h('input', { type: 'file', accept: 'image/*' });
    const note = h('small', { class: 'muted', text: 'تُصغَّر الصورة تلقائيًا قبل الرفع، ولا يراها إلا أعضاء الشجرة.' });
    input.addEventListener('change', async () => {
      const f = input.files[0];
      blob = null;
      if (!f) return;
      try {
        blob = await compressImage(f);
        note.textContent = 'تم اختيار الصورة وتصغيرها.';
      } catch (ex) {
        input.value = '';
        note.textContent = friendly(ex);
      }
    });
    photoField = h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'الصورة' }), input, note);
  }

  const node = h(
    'div',
    { class: 'quick-details' },
    h('div', { class: 'row' }, field('اللقب / العائلة', last), field('رقم الهاتف', phone)),
    field('البريد الإلكتروني', email),
    h('div', { class: 'section-title', text: 'مكان الميلاد' }),
    birthPicker.node,
    field('تفاصيل إضافية عن مكان الميلاد', birthDetail),
    h('div', { class: 'section-title', text: 'مكان الإقامة الحالي' }),
    home.nodes,
    h('label', { class: 'check', for: deceased.id }, deceased, 'متوفى (حتى دون تاريخ وفاة)'),
    photoField,
    field('ملاحظات', notes),
  );
  return {
    node,
    get: () => {
      const b = birthPicker.get();
      const r = home.get();
      return {
        last_name: last.value, phone: phone.value, email: email.value, notes: notes.value, deceased: deceased.checked, birth_place: birthDetail.value,
        birth_country: b.country, birth_province: b.province, birth_city: b.city, residence_country: r.country, residence_province: r.province, residence_city: r.city,
      };
    },
    photo: () => blob,
  };
}

/**
 * Add / edit person dialog.
 * other: { label, options:[{id,name}], selected, placeholder } -> extra "other parent" select.
 * onSubmit(values, otherId, extras) may throw; the message is shown in the dialog.
 *   extras = { photo: Blob|null (a new photo, already shrunk), removePhoto: boolean }
 */
function openPersonForm({ title, person = null, defaults = {}, lockGender = false, other = null, note = null, onSubmit }) {
  const v = { ...defaults, ...(person || {}) };
  let gender = v.gender || '';
  const seq = ++fieldSeq;
  const err = h('div', { class: 'error', role: 'alert' });

  const first = h('input', { type: 'text', required: true, maxlength: 100, value: v.first_name || '', autocomplete: 'off' });
  const last = h('input', { type: 'text', maxlength: 100, value: v.last_name || '', autocomplete: 'off', placeholder: 'العائلة أو القبيلة (اختياري)' });
  const nickname = h('input', { type: 'text', maxlength: 100, value: v.nickname || '', autocomplete: 'off', placeholder: 'مثال: أبو علي، الحاج… (اختياري)' });
  const birth = h('input', { type: 'text', maxlength: 40, value: v.birth_date || '', placeholder: 'مثال: 1950 أو 1950-03-12', autocomplete: 'off' });
  const birthDetail = h('input', { type: 'text', maxlength: 100, value: v.birth_place || '', autocomplete: 'off', placeholder: 'مثال: اسم المستشفى أو القرية (اختياري)' });
  const birthPicker = placePicker('birth', { country: v.birth_country, province: v.birth_province, city: v.birth_city });
  const home = residenceFields(birthPicker, v);
  const death = h('input', { type: 'text', maxlength: 40, value: v.death_date || '', placeholder: 'مثال: 2020', autocomplete: 'off' });
  const notes = h('textarea', { maxlength: 2000, value: v.notes || '' });
  // optional contact details (visible to the members of the tree)
  const phone = h('input', { type: 'tel', inputmode: 'tel', dir: 'ltr', maxlength: 25, autocomplete: 'off', value: v.phone || '', placeholder: '+963 9XX XXX XXX', title: 'أرقام فقط، ويجوز + في البداية ومسافات وأقواس وشرطات' });
  const email = h('input', { type: 'email', inputmode: 'email', dir: 'ltr', maxlength: 254, autocomplete: 'off', value: v.email || '', placeholder: 'name@example.com' });
  const deceased = h('input', { type: 'checkbox', id: `pf-dec${seq}` });
  deceased.checked = !!v.is_deceased;
  const deathField = field('تاريخ الوفاة', death);
  deathField.hidden = !deceased.checked;
  deceased.addEventListener('change', () => (deathField.hidden = !deceased.checked));

  // photo (only where storage exists)
  let photoBlob = null;
  let previewUrl = null;
  const preview = h('div', { class: 'photo-preview' });
  const showPreview = (url) => {
    put(preview, url ? h('img', { src: url, alt: '' }) : h('span', { class: 'muted', text: 'بلا صورة' }));
  };
  const currentUrl = person?.photo_url ? photos?.url(person.photo_url) : null;
  showPreview(currentUrl);
  const photoInput = h('input', { type: 'file', accept: 'image/*' });
  const removeBox = person?.photo_url ? h('input', { type: 'checkbox', id: `pf-rm${seq}` }) : null;
  photoInput.addEventListener('change', async () => {
    err.textContent = '';
    const f = photoInput.files[0];
    if (!f) return;
    try {
      photoBlob = await compressImage(f);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(photoBlob);
      showPreview(previewUrl);
      if (removeBox) removeBox.checked = false;
    } catch (ex) {
      photoBlob = null;
      photoInput.value = '';
      err.textContent = friendly(ex);
    }
  });
  const photoField = photos
    ? h(
        'div',
        { class: 'field' },
        h('span', { class: 'lbl', text: 'الصورة' }),
        h('div', { class: 'photo-row' }, preview, h('div', { class: 'stack' }, photoInput, removeBox && h('label', { class: 'check', for: removeBox.id }, removeBox, 'حذف الصورة الحالية'))),
        h('small', { class: 'muted', text: 'تُصغَّر الصورة تلقائيًا قبل الرفع، ولا يراها إلا أعضاء الشجرة.' }),
      )
    : null;

  const radio = (value, label) => {
    const r = h('input', { type: 'radio', name: 'gender', value, required: true, disabled: lockGender });
    r.checked = gender === value;
    r.addEventListener('change', () => (gender = value));
    return h('label', {}, r, label);
  };

  let otherSel = null;
  if (other) {
    otherSel = h('select', {}, h('option', { value: '', text: other.placeholder || 'غير محدد' }), other.options.map((o) => h('option', { value: o.id, text: o.name })));
    otherSel.value = other.selected || '';
  }

  const save = h('button', { class: 'btn primary', type: 'submit', text: 'حفظ' });
  const form = h(
    'form',
    { novalidate: false },
    h('div', { class: 'row' }, field('الاسم الأول', first), field('اللقب / العائلة', last)),
    field('اللقب المشتهر به', nickname),
    h('small', { class: 'muted', text: 'إن كتبتَه ظهر تحت الاسم في البطاقة.' }),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'الجنس' }), h('div', { class: 'radios' }, radio('male', 'ذكر'), radio('female', 'أنثى'))),
    other && field(other.label, otherSel),
    note && h('p', { class: 'muted', text: note }),
    field('تاريخ الميلاد', birth),
    h('div', { class: 'section-title', text: 'معلومات التواصل (اختيارية)' }),
    h('div', { class: 'row' }, field('رقم الهاتف', phone), field('البريد الإلكتروني', email)),
    h('div', { class: 'section-title', text: 'مكان الميلاد' }),
    birthPicker.node,
    field('تفاصيل إضافية عن مكان الميلاد', birthDetail),
    h('div', { class: 'section-title', text: 'مكان الإقامة الحالي' }),
    home.nodes,
    h('label', { class: 'check', for: deceased.id }, deceased, 'متوفى'),
    deathField,
    photoField,
    field('ملاحظات', notes),
    err,
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close(), text: 'إلغاء' }), save),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    save.disabled = true;
    try {
      const values = {
        first_name: first.value.trim(),
        last_name: orNull(last.value),
        ...(orNull(nickname.value) || v.nickname ? { nickname: orNull(nickname.value) } : {}), // only when used (or being cleared): keeps working before supabase/014 is run
        gender,
        birth_date: orNull(birth.value),
        birth_place: orNull(birthDetail.value),
        birth_country: birthPicker.get().country,
        birth_province: birthPicker.get().province,
        birth_city: birthPicker.get().city,
        residence_country: home.get().country,
        residence_province: home.get().province,
        residence_city: home.get().city,
        phone: orNull(phone.value),
        email: orNull(email.value)?.toLowerCase() ?? null,
        is_deceased: deceased.checked,
        death_date: deceased.checked ? orNull(death.value) : null,
        notes: orNull(notes.value),
      };
      if (!values.first_name) throw new Error('الاسم الأول مطلوب');
      if (values.phone && !validPhone(values.phone)) throw new Error('رقم الهاتف غير صالح: أرقام فقط، ويجوز + في البداية');
      if (values.email && !validEmail(values.email)) throw new Error('البريد الإلكتروني غير صالح');
      await onSubmit(values, otherSel ? otherSel.value || null : null, { photo: photoBlob, removePhoto: !!removeBox?.checked });
      dlg.close();
    } catch (ex) {
      err.textContent = friendly(ex);
      save.disabled = false;
    }
  });

  const dlg = modal(title, form, { backdropClose: false, onclose: () => previewUrl && URL.revokeObjectURL(previewUrl) });
  first.focus();
}

// ====================================================================
// screens: loading / auth / start
// ====================================================================

function mount(...nodes) {
  put(app, ...nodes);
}
const loadingScreen = (msg = 'جارٍ التحميل…') => h('div', { class: 'loading', text: msg });

function brand() {
  return h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('tree')), h('span', { class: 'name', text: 'شجرة العائلة' }));
}

/**
 * The invitation link a visitor opened, kept in localStorage (not sessionStorage) so it survives:
 *  - the round trip to Google and back,
 *  - the confirmation e-mail link, which opens in a new tab.
 */
const pendingJoin = {
  get: () => safeGet('ft.join'),
  set(code) {
    try {
      localStorage.setItem('ft.join', code);
    } catch {
      /* private mode: the link just has to be opened again after signing in */
    }
  },
  clear() {
    try {
      localStorage.removeItem('ft.join');
    } catch {
      /* ignore */
    }
  },
};

/** Is "Sign in with Google" switched on in the Supabase project? (Only then is the button shown.) */
async function googleEnabled() {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } });
    const j = await r.json();
    return !!j?.external?.google;
  } catch {
    return false;
  }
}

// ====================================================================
// the front door: the public page, and the request to join the family
// ====================================================================

let teaserCache; // undefined: not asked yet, null: there is no public page
/** What a stranger may know (supabase/010): the top ancestor and his first row. null when the page is off. */
async function loadTeaser(force = false) {
  if (teaserCache !== undefined && !force) return teaserCache;
  try {
    const { data, error } = await sb.rpc('public_teaser');
    teaserCache = error ? null : data || null;
  } catch {
    teaserCache = null;
  }
  return teaserCache;
}

/** Signed out: the public page, or the sign-in screen for someone who opened an invitation link. */
function showFront() {
  if (pendingJoin.get()) showAuth();
  else showLanding();
}

/** One person of the public page: name and years. */
function teaserCardNode(card, big = false) {
  const years = teaserYears(card);
  return h(
    'div',
    { class: `tcard ${card.gender}${big ? ' big' : ''}` },
    h('div', { class: 'avatar' }, genderIcon(card.gender)),
    h('div', { class: 'txt' }, h('div', { class: 'nm', text: card.name }), years && h('div', { class: 'yr', text: years })),
  );
}

/**
 * Curved lines from the top ancestor down to each of his children (the same curves as the tree), in the colour of the
 * branch. Drawn behind the cards from where the cards really are, so it follows any width of the screen.
 */
function drawTeaserLines(mini) {
  if (!mini?.isConnected) return;
  const root = mini.querySelector('.tcard.big');
  const kids = [...mini.querySelectorAll('.tree-mini-kids .tcard')];
  let svg = mini.querySelector('svg.tm-lines');
  if (!root || !kids.length) return svg?.remove();
  if (!svg) {
    svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'tm-lines');
    svg.setAttribute('aria-hidden', 'true');
    mini.prepend(svg);
  }
  const box = mini.getBoundingClientRect();
  const r = root.getBoundingClientRect();
  const px = r.left + r.width / 2 - box.left;
  const py = r.bottom - box.top;
  svg.setAttribute('width', box.width);
  svg.setAttribute('height', box.height);
  svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  svg.replaceChildren(
    ...kids.map((k, i) => {
      const q = k.getBoundingClientRect();
      const cx = q.left + q.width / 2 - box.left;
      const cy = q.top - box.top;
      const my = (py + cy) / 2;
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', `M${px.toFixed(1)} ${py.toFixed(1)}C${px.toFixed(1)} ${my.toFixed(1)} ${cx.toFixed(1)} ${my.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)}`);
      path.style.stroke = `var(--br${i % 8})`;
      return path;
    }),
  );
}

/** The top ancestor and his first row, drawn into `box` (drawn again, in place, whenever the data changes). */
function paintTeaser(box, teaser) {
  box._ro?.disconnect();
  if (!teaser?.root) return put(box);
  const mini = h('div', { class: 'tree-mini' }, teaserCardNode(teaser.root, true), teaser.children.length > 0 && h('div', { class: 'tree-mini-kids' }, teaser.children.map((c) => teaserCardNode(c))));
  put(
    box,
    h(
      'section',
      { class: 'teaser', 'aria-label': 'الجد الأكبر وأبناؤه' },
      h('h2', { text: 'الجد الأكبر وأبناؤه' }),
      mini,
      teaser.hidden_children > 0 && h('p', { class: 'muted small-note', text: 'ويضم الصف الأول أفرادًا آخرين لا تُعرض أسماؤهم في الصفحة العامة.' }),
    ),
  );
  requestAnimationFrame(() => drawTeaserLines(mini));
  setTimeout(() => drawTeaserLines(mini), 60); // (a page that is not on the screen yet gets no animation frame)
  setTimeout(() => drawTeaserLines(mini), 600); // after the fonts arrived
  if (typeof ResizeObserver !== 'undefined') {
    box._ro = new ResizeObserver(() => drawTeaserLines(mini)); // a new width of the screen, a font that arrived late
    box._ro.observe(mini);
  }
}

/** A big tree with nothing in it: blurred boxes only. The rest of the family is not on this page, not even blurred. */
function lockedTree() {
  return h('div', { class: 'ghost', 'aria-hidden': 'true' }, [1, 3, 6, 9].map((n) => h('div', { class: 'ghost-row' }, Array.from({ length: n }, () => h('span', { class: 'ghost-card' })))));
}

function fullTreeNotice(canRequest) {
  const dlg = modal(
    'الشجرة الكاملة لأعضاء العائلة',
    h(
      'div',
      {},
      h('p', { text: `يطّلع على الشجرة الكاملة أعضاء العائلة فقط. سجّل دخولك إن كنت عضوًا، أو اطلب الانضمام إن كنت من عائلة ${FAMILY}.` }),
      h(
        'div',
        { class: 'modal-foot' },
        h('button', { class: 'btn', type: 'button', text: 'تسجيل الدخول', onclick: () => (dlg.close(), showAuth({ plain: true })) }),
        canRequest && h('button', { class: 'btn primary', type: 'button', text: 'اطلب الانضمام للعائلة', onclick: () => (dlg.close(), startJoin()) }),
      ),
    ),
  );
}

/** "Request to join": the form is a page of its own, no account needed. */
async function startJoin() {
  const teaser = teaserCache === undefined ? await loadTeaser() : teaserCache;
  if (!teaser) return toast('الانضمام الآن بدعوة من مدير الشجرة', true);
  showJoinPage(teaser);
}

/** The page everybody sees before signing in (the same text is in index.html for search engines). */
async function showLanding() {
  const teaser = await loadTeaser(true);
  const open = !!teaser;
  const code = savedTrack();
  const mine = code ? await loadJoinStatus(code) : null; // the request this browser sent earlier
  const requestBtn = (cls = 'btn') => open && h('button', { class: cls, type: 'button', onclick: startJoin, text: 'اطلب الانضمام للعائلة' });
  const fullBtn = () => h('button', { class: 'btn primary', type: 'button', onclick: () => fullTreeNotice(open), text: 'اطّلع على كامل الشجرة' });

  const top = h('div', { class: 'teaser-box' });
  const countNode = h('span', { class: 'muted' });
  const paintCount = (t) => {
    countNode.textContent = t?.people_count > 0 ? `تضم الشجرة ${peopleCountText(t.people_count)}` : '';
    countNode.hidden = !countNode.textContent;
  };
  paintTeaser(top, teaser);
  paintCount(teaser);
  // what the page shows follows the database: asked again while the page stays open, and when the tab comes back to the front
  let shown = JSON.stringify(teaser);
  const refresh = async () => {
    if (!top.isConnected) {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      return;
    }
    const t = await loadTeaser(true);
    const now = JSON.stringify(t);
    if (now === shown) return;
    shown = now;
    paintTeaser(top, t);
    paintCount(t);
  };
  const onVisible = () => document.visibilityState === 'visible' && refresh();
  const timer = setInterval(refresh, 120000);
  document.addEventListener('visibilitychange', onVisible);

  mount(
    h(
      'main',
      { class: 'landing' },
      h(
        'header',
        { class: 'land-top' },
        brand(),
        h(
          'div',
          { class: 'land-actions' },
          (open || code) && h('button', { class: 'btn small', type: 'button', onclick: askTrackCode, text: 'لدي رقم متابعة' }),
          h('button', { class: 'btn small', type: 'button', onclick: () => showAuth({ plain: true }), text: 'تسجيل الدخول للأعضاء' }),
        ),
      ),
      h(
        'section',
        { class: 'hero' },
        h('h1', { text: `شجرة عائلة ${FAMILY}` }),
        h('p', { class: 'lead', text: `هذه صفحة شجرة عائلة ${FAMILY}. إن كنت من العائلة فيمكنك طلب الانضمام إلى الشجرة لتطّلع على أفرادها وتضيف فرعك وبياناته، من أي مكان في العالم.` }),
      ),
      mine &&
        h(
          'section',
          { class: 'my-request' },
          h('strong', { text: `طلبك للانضمام: ${JOIN_STATUS[mine.status] || mine.status}` }),
          h('button', { class: 'btn small', type: 'button', text: mine.status === 'approved' && mine.invite_code ? 'أنشئ حسابك الآن' : mine.needs_email ? 'اكتب بريدك لإنشاء حسابك' : 'تفاصيل طلبي', onclick: () => showTrackPage(code) }),
        ),
      top,
      h(
        'section',
        { class: 'locked' },
        lockedTree(),
        h(
          'div',
          { class: 'lock-overlay' },
          icon('lock'),
          h('strong', { text: 'باقي الشجرة لأعضاء العائلة فقط' }),
          countNode,
          h('div', { class: 'cta' }, fullBtn(), requestBtn()),
        ),
      ),
      h(
        'section',
        { class: 'how' },
        h('h2', { text: `إذا كنت من عائلة ${FAMILY}` }),
        open
          ? [
              h('p', { text: 'يمكنك الانضمام إلى شجرة العائلة. يراجع مدير الشجرة كل طلب، وبعد الموافقة تطّلع على الشجرة كاملة وتضيف فرعك وبياناته.' }),
              h('ol', {}, [
                'اضغط «اطلب الانضمام للعائلة» واملأ الاستمارة: اسمك الكامل، وصلتك بالعائلة، وبلد إقامتك (والمدينة والهاتف والبريد اختيارية). لا حاجة إلى حساب.',
                `يُفضَّل أن ترفق وثيقة تثبت أنك من عائلة ${FAMILY}، مثل هوية أو ورقة رسمية فيها اسم العائلة (صورة أو PDF حتى 5 ميغابايت). وهي اختيارية، لكنها تسرّع المراجعة.`,
                'بعد الإرسال تحصل على «رقم متابعة» احتفظ به: يكفي وحده لتعرف حالة طلبك من أي جهاز، حتى لو لم تكتب هاتفًا ولا بريدًا. يصل طلبك إلى مدير الشجرة فيوافق عليه أو يرفضه.',
                'عند الموافقة يظهر لك في صفحة المتابعة رابط لإنشاء حسابك (وتكتب بريدك هناك إن لم تكن كتبته في الاستمارة)، ثم تدخل الشجرة.',
              ].map((t) => h('li', { text: t }))),
              h('p', { class: 'muted', text: 'خصوصيتك: لا يرى الوثيقة إلا مدير الشجرة، وتُحذف بعد قرار المراجعة.' }),
              h('div', { class: 'cta start' }, requestBtn('btn primary')),
            ]
          : h('p', { text: 'الانضمام إلى الشجرة الآن بدعوة من مدير الشجرة. إن وصلتك دعوة فافتح الرابط الذي أُرسل إليك.' }),
      ),
      h('footer', { class: 'land-foot muted' }, 'الشجرة الكاملة وبيانات الأفراد لا تُعرض إلا لأعضاء العائلة بعد موافقة مدير الشجرة. ', h('a', { href: 'privacy.html', text: 'سياسة الخصوصية' })),
    ),
  );
}

// ---------- asking to join, without an account (supabase/011) ----------

const TRACK_KEY = 'ft.track';
/** The secret tracking code this browser was given when it sent a request. */
const savedTrack = () => {
  const c = cleanTrackCode(safeGet(TRACK_KEY));
  return isTrackCode(c) ? c : null;
};

async function loadJoinStatus(code) {
  try {
    const { data, error } = await sb.rpc('join_status', { p_code: code });
    return error ? null : data || null;
  } catch {
    return null;
  }
}

/** A small card page (like the sign-in screen) with a way back. */
function cardPage(...kids) {
  const back = () => (state.user ? showStart() : showLanding());
  mount(
    h(
      'div',
      { class: 'center' },
      h('div', { class: 'auth-card wide' }, brand(), ...kids, h('div', { class: 'divider' }, h('button', { class: 'link-btn', type: 'button', onclick: back, text: state.user ? '← العودة' : '← العودة إلى الصفحة الرئيسية' }))),
    ),
  );
}

/** "لدي رقم متابعة": type the code of an earlier request. */
function askTrackCode() {
  const input = h('input', { type: 'text', dir: 'ltr', autocomplete: 'off', placeholder: 'رقم المتابعة (32 حرفًا)', 'aria-label': 'رقم المتابعة' });
  const err = h('div', { class: 'error', role: 'alert' });
  const go = h('button', { class: 'btn primary', type: 'submit', text: 'تتبّع الطلب' });
  const form = h('form', {}, field('رقم المتابعة الذي ظهر لك بعد إرسال الطلب', input), err, h('div', { class: 'modal-foot' }, go));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = cleanTrackCode(input.value);
    if (!isTrackCode(code)) return (err.textContent = 'الرقم غير صحيح: هو 32 حرفًا وأرقامًا (0-9 و a-f).');
    go.disabled = true;
    const st = await loadJoinStatus(code);
    if (!st) {
      err.textContent = 'لا يوجد طلب بهذا الرقم.';
      go.disabled = false;
      return;
    }
    remember(TRACK_KEY, code);
    dlg.close();
    showTrackPage(code);
  });
  const dlg = modal('تتبّع طلب الانضمام', form);
}

/** Approved: the person writes the e-mail the account will be made with (none in the form, or a wrong one). */
function claimEmailForm(code, { change = false } = {}) {
  const email = h('input', { type: 'email', inputmode: 'email', dir: 'ltr', maxlength: 254, autocomplete: 'email', required: true, placeholder: 'name@example.com' });
  const err = h('div', { class: 'error', role: 'alert' });
  const go = h('button', { class: 'btn primary block', type: 'submit', text: change ? 'تغيير البريد' : 'إنشاء الدعوة لهذا البريد' });
  const form = h('form', {}, field('بريدك الإلكتروني', email), err, go);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    go.disabled = true;
    const { error } = await sb.rpc('claim_join_invite', { p_code: code, p_email: email.value.trim() });
    if (error) {
      err.textContent = friendly(error);
      go.disabled = false;
      return;
    }
    showTrackPage(code);
  });
  return form;
}

/** The state of a request: waiting, refused (with the reason), or accepted (with the link to create the account). */
async function showTrackPage(code, { justSent = false } = {}) {
  cardPage(h('p', { class: 'muted', text: 'جارٍ التحميل…' }));
  const st = await loadJoinStatus(code);
  const codeBox = h(
    'div',
    { class: 'track-code' },
    h('div', { class: 'muted', text: 'رقم المتابعة (احتفظ به: به تعرف حالة طلبك من أي جهاز)' }),
    h('code', { dir: 'ltr', text: code }),
    h('button', { class: 'btn small', type: 'button', text: 'نسخ', onclick: () => copyText(code) }),
  );
  const refresh = h('button', { class: 'btn', type: 'button', text: 'تحديث الحالة', onclick: () => showTrackPage(code) });
  const again = h('button', { class: 'btn primary block', type: 'button', text: 'تقديم طلب جديد', onclick: startJoin });

  if (!st) {
    return cardPage(h('h2', { text: 'لا يوجد طلب بهذا الرقم' }), h('p', { class: 'muted', text: 'ربما كُتب الرقم خطأ.' }), h('button', { class: 'btn block', type: 'button', text: 'إدخال رقم آخر', onclick: askTrackCode }));
  }
  const facts = h('dl', { class: 'dl' }, [['الاسم', st.full_name], st.contact_email && ['البريد', st.contact_email], ['تاريخ الإرسال', fmtDate(st.created_at)]].filter(Boolean).map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v || '—' })]));

  // approved, but the form had no e-mail: the person writes the one the account will be made with
  if (st.status === 'approved' && st.needs_email) {
    return cardPage(
      h('h2', { text: 'تمت الموافقة على طلبك' }),
      h('p', { text: `أهلًا بك في عائلة ${FAMILY}. لم تكتب بريدًا في الاستمارة، فاكتب هنا البريد الذي تريد إنشاء حسابك به. تُنشأ لك دعوة خاصة بهذا البريد وحده.` }),
      claimEmailForm(code),
      facts,
    );
  }

  if (st.status === 'approved' && st.invite_code) {
    return cardPage(
      h('h2', { text: 'تمت الموافقة على طلبك' }),
      h('p', { text: `أهلًا بك في عائلة ${FAMILY}. أنشئ حسابك الآن ببريدك الإلكتروني نفسه (${st.contact_email}) لتدخل الشجرة.` }),
      h('button', {
        class: 'btn primary block',
        type: 'button',
        text: 'أنشئ حسابك الآن',
        onclick: () => {
          pendingJoin.set(st.invite_code);
          showAuth({ signup: true, email: st.contact_email, notice: `أنشئ حسابًا بالبريد ${st.contact_email} بالضبط، فالدعوة خاصة بهذا البريد.` });
        },
      }),
      st.claimed && h('details', { class: 'claim-change' }, h('summary', { text: 'كتبتُ البريد خطأً؟ غيّره' }), claimEmailForm(code, { change: true })),
      facts,
    );
  }
  if (st.status === 'approved' && st.registered) {
    return cardPage(
      h('h2', { text: 'حسابك جاهز' }),
      h('p', { text: 'تم إنشاء حسابك والانضمام إلى الشجرة. سجّل دخولك.' }),
      h('button', { class: 'btn primary block', type: 'button', text: 'تسجيل الدخول', onclick: () => (remember(TRACK_KEY, ''), showAuth({ email: st.contact_email, plain: true })) }),
    );
  }
  if (st.status === 'approved') {
    return cardPage(h('h2', { text: 'تمت الموافقة' }), h('p', { text: 'لم يعد رابط الدعوة صالحًا. اطلب من مدير الشجرة دعوة جديدة على بريدك.' }), facts);
  }
  if (st.status === 'rejected') {
    return cardPage(
      h('h2', { text: 'لم تتم الموافقة على طلبك' }),
      st.decision_note && h('div', { class: 'notice', text: `سبب القرار: ${st.decision_note}` }),
      h('p', { class: 'muted', text: 'يمكنك تقديم طلب جديد بمعلومات أوضح أو وثيقة أخرى.' }),
      again,
      facts,
    );
  }
  if (st.status === 'draft') {
    return cardPage(h('h2', { text: 'طلبك لم يكتمل' }), h('p', { class: 'muted', text: 'لم تصل الوثيقة المرفقة، فلم يُفتح الطلب للمراجعة. قدّم الطلب من جديد.' }), again);
  }
  cardPage(
    justSent && h('div', { class: 'notice', text: 'وصل طلبك إلى مدير الشجرة.' }),
    h('h2', { text: 'طلبك قيد المراجعة' }),
    h('p', { class: 'muted', text: 'سيراجع مدير الشجرة طلبك. عند الموافقة يظهر لك هنا ما يلزم لإنشاء حسابك، وقد يتواصل معك المدير على هاتفك أو بريدك إن كتبتهما.' }),
    !st.contact_email && h('div', { class: 'notice', text: 'لا بريد في طلبك، لذلك ارجع إلى هذه الصفحة بنفسك لمعرفة القرار: اضغط «لدي رقم متابعة» في أعلى الصفحة الرئيسية واكتب الرقم الظاهر أدناه.' }),
    codeBox,
    facts,
    refresh,
  );
}

/** The form: no account. The visitor sends the form, uploads the document to the path the server gave, and confirms. */
function showJoinPage(teaser, defaults = {}) {
  const errors = h('ul', { class: 'form-errors', role: 'alert' });
  const name = h('input', { type: 'text', maxlength: 120, autocomplete: 'name', value: defaults.name || state.profile?.display_name || '' });
  const relation = h('textarea', { maxlength: 1500, rows: 4, placeholder: 'مثال: أنا أحمد بن يحيى بن علي، من فرع ... وجدّي الأكبر ...' });
  const country = h('select', {}, h('option', { value: '', text: '— اختر البلد —' }), countryList().map((c) => h('option', { value: c.code, text: c.name })));
  const city = h('input', { type: 'text', maxlength: 100, autocomplete: 'off', placeholder: 'المدينة' });
  const phone = h('input', { type: 'tel', inputmode: 'tel', dir: 'ltr', maxlength: 25, autocomplete: 'tel', placeholder: '+963 9XX XXX XXX' });
  const email = h('input', { type: 'email', inputmode: 'email', dir: 'ltr', maxlength: 254, autocomplete: 'email', value: defaults.email || state.user?.email || '' });
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf' });
  const consent = h('input', { type: 'checkbox', id: `jc${++fieldSeq}` });
  const hp = h('input', { type: 'text', tabindex: '-1', autocomplete: 'off', name: 'website' }); // robots fill this, people never see it
  const send = h('button', { class: 'btn primary block', type: 'submit', text: 'إرسال الطلب' });
  const progress = h('div', { class: 'muted', role: 'status' });

  const form = h(
    'form',
    { class: 'join-form', novalidate: true },
    h('p', { class: 'muted', text: `إن كنت من عائلة ${FAMILY} فاملأ الاستمارة التالية. لا حاجة إلى حساب: يصل طلبك إلى مدير الشجرة ليوافق عليه أو يرفضه، وبعد الموافقة تنشئ حسابك.` }),
    field('الاسم الكامل', name),
    field('صلتك بالعائلة', relation),
    h('div', { class: 'row' }, field('بلد الإقامة', country), field('المدينة (اختياري)', city)),
    h('div', { class: 'row' }, field('رقم الهاتف (اختياري)', phone), field('البريد الإلكتروني (اختياري)', email)),
    h('small', { class: 'muted', text: 'الهاتف والبريد اختياريان. بالهاتف (مع رمز الدولة مثل +963…) يراسلك المدير على واتساب، وبالبريد تُنشأ لك دعوة حسابك. وإن لم تكتب أيًّا منهما فتتابع طلبك برقم المتابعة الذي يظهر لك بعد الإرسال، فاحتفظ به.' }),
    field('إثبات أنك من العائلة (هوية أو ورقة رسمية) — اختياري', file),
    h('small', { class: 'muted', text: 'ليس إلزاميًا، لكن إرفاقه يسهّل على المدير التحقق ويسرّع القرار. صورة (JPG أو PNG أو WebP) أو ملف PDF حتى 5 ميغابايت، ويظهر اسم العائلة فيها بوضوح.' }),
    h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', { text: 'اترك هذا الحقل فارغًا' }), hp),
    h('label', { class: 'check', for: consent.id }, consent, 'أوافق أن يطّلع مدير الشجرة على بياناتي (والوثيقة إن أرفقتها) لغرض التحقق فقط، وأن تُحذف الوثيقة بعد قرار المراجعة.'),
    errors,
    progress,
    send,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errors.replaceChildren();
    const { errors: bad, clean } = validateJoin({
      full_name: name.value, relation: relation.value, country: country.value, city: city.value,
      phone: phone.value, email: email.value, consent: consent.checked, file: file.files[0] || null,
    });
    if (Object.keys(bad).length) {
      put(errors, Object.values(bad).map((m) => h('li', { text: m })));
      return errors.scrollIntoView?.({ block: 'nearest' });
    }
    send.disabled = true;
    const doc = file.files[0];
    try {
      progress.textContent = 'جارٍ إرسال الطلب…';
      const { data: sub, error } = await sb.rpc('submit_join_request', submitArgs({ treeId: teaser.tree_id, clean, file: doc, hp: hp.value }));
      if (error) throw error;
      if (doc && sub.path) {
        // the document goes to the one path the server gave, then the request is confirmed (opened to the admin)
        progress.textContent = 'جارٍ رفع الوثيقة…';
        const up = await sb.storage.from('join-docs').upload(sub.path, doc, { contentType: doc.type, upsert: false });
        if (up.error) throw up.error;
        const conf = await sb.rpc('confirm_join_doc', { p_id: sub.id, p_code: sub.code });
        if (conf.error) throw conf.error;
      }
      remember(TRACK_KEY, sub.code);
      showTrackPage(sub.code, { justSent: true });
    } catch (ex) {
      progress.textContent = '';
      put(errors, h('li', { text: friendly(ex) }));
      send.disabled = false;
    }
  });
  cardPage(h('h2', { class: 'join-title', text: `طلب الانضمام إلى شجرة عائلة ${FAMILY}` }), form);
}

/** On the start screen of a signed-in person who is not a member: a way to the same form. */
async function fillStartJoin(box) {
  const teaser = await loadTeaser(true);
  if (!teaser) return;
  put(
    box,
    h('h2', { class: 'join-title', text: `هل أنت من عائلة ${FAMILY}؟` }),
    h('p', { class: 'muted', text: 'قدّم طلب انضمام ليراجعه مدير الشجرة.' }),
    h('button', { class: 'btn primary block', type: 'button', text: 'اطلب الانضمام للعائلة', onclick: () => showJoinPage(teaser) }),
    h('div', { class: 'divider', text: '— أو لديك رابط دعوة —' }),
  );
  box.hidden = false;
}

/** Delete the document from storage once the request is over, then forget its path. */
async function dropJoinDoc(id, path) {
  if (path) await sb.storage.from('join-docs').remove([path]);
  await sb.rpc('forget_join_doc', { p_id: id });
}

function showAuth({ signup = false, notice = null, email: prefill = '', plain = false } = {}) {
  // an account is made only with an invitation (a link, or an accepted request): the plain sign-in has no "new account".
  // plain = the person pressed "sign in" on purpose, so an invitation kept from earlier does not bring the tab back
  const pending = plain ? null : pendingJoin.get();
  const canSignup = signup || !!pending;
  let mode = signup ? 'signup' : 'login';

  const name = h('input', { type: 'text', autocomplete: 'name', maxlength: 80 });
  const email = h('input', { type: 'email', autocomplete: 'email', required: true, inputmode: 'email', value: prefill });
  const pass = h('input', { type: 'password', required: true, minlength: 6, autocomplete: 'current-password' });
  const pass2 = h('input', { type: 'password', minlength: 6, autocomplete: 'new-password' });
  const nameField = field('الاسم', name);
  const pass2Field = field('تأكيد كلمة المرور', pass2); // only when making an account: typed twice so a typing mistake does not lock the person out
  const err = h('div', { class: 'error', role: 'alert' });
  const submit = h('button', { class: 'btn primary block', type: 'submit' });
  const tabLogin = h('button', { type: 'button', role: 'tab', text: 'تسجيل الدخول' });
  const tabSignup = h('button', { type: 'button', role: 'tab', text: 'حساب جديد' });
  const card = h('div', { class: 'auth-card' });
  const googleBox = h('div', { hidden: true });

  const render = () => {
    tabLogin.setAttribute('aria-selected', String(mode === 'login'));
    tabSignup.setAttribute('aria-selected', String(mode === 'signup'));
    nameField.hidden = mode !== 'signup';
    name.required = mode === 'signup';
    pass2Field.hidden = mode !== 'signup';
    pass2.required = mode === 'signup';
    pass2.value = '';
    pass.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    submit.textContent = mode === 'signup' ? 'إنشاء الحساب' : 'دخول';
    err.textContent = '';
  };
  tabLogin.onclick = () => ((mode = 'login'), render());
  tabSignup.onclick = () => ((mode = 'signup'), render());

  /** Shown after a sign-up when the project requires e-mail confirmation. */
  const showConfirm = (addr) => {
    const msg = h('div', { class: 'error', role: 'status' });
    const resend = h('button', {
      class: 'btn block',
      type: 'button',
      text: 'إعادة إرسال الرسالة',
      onclick: async () => {
        resend.disabled = true;
        msg.className = 'error';
        const { error } = await sb.auth.resend({ type: 'signup', email: addr });
        msg.textContent = error ? friendly(error) : 'أُعيد إرسال الرسالة. تفقّد أيضًا مجلد الرسائل غير المرغوبة.';
        if (!error) msg.className = 'muted';
        setTimeout(() => (resend.disabled = false), 30000); // do not hammer the mail limit
      },
    });
    put(card, 
      brand(),
      h('h2', { text: 'تحقق من بريدك' }),
      h('p', { text: `أرسلنا رسالة تأكيد إلى ${addr}. افتحها واضغط الرابط فيها، ثم ارجع هنا وسجّل الدخول.` }),
      pending && h('p', { class: 'muted', text: 'دعوتك محفوظة في هذا المتصفح. إن فتحت رابط التأكيد من جهاز آخر فافتح رابط الدعوة مرة أخرى بعد تسجيل الدخول.' }),
      resend,
      msg,
      h('div', { class: 'divider' }, h('button', { class: 'link-btn', type: 'button', onclick: () => showAuth(), text: 'رجوع إلى تسجيل الدخول' })),
    );
  };

  const form = h('form', {}, nameField, field('البريد الإلكتروني', email), field('كلمة المرور', pass), pass2Field, err, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (mode === 'signup' && pass.value !== pass2.value) {
      err.textContent = 'كلمتا المرور غير متطابقتين. أعد كتابتهما.';
      pass2.value = '';
      pass2.focus();
      return;
    }
    submit.disabled = true;
    try {
      if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({
          email: email.value.trim(),
          password: pass.value,
          options: { data: { full_name: name.value.trim() } },
        });
        if (error) throw error;
        // with e-mail confirmation on, an already registered address comes back as a user with no identities
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error('User already registered');
        if (!data.session) showConfirm(email.value.trim());
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
        if (error) throw error;
      }
    } catch (ex) {
      err.textContent = friendly(ex);
    }
    submit.disabled = false;
  });

  put(
    card, // put(): the notices below are null when there is nothing to say, and append() would print "null"
    brand(),
    h('p', { class: 'lead', text: 'شجرة عائلة مشتركة، يضيف فيها كل فرد من عائلته من أي مكان.' }),
    pending && h('div', { class: 'notice', text: 'وصلتك دعوة للانضمام إلى شجرة عائلة. سجّل دخولك أو أنشئ حسابًا ببريدك للمتابعة. وإن كانت الدعوة مخصصة لبريد معيّن فيجب أن يكون هو البريد الذي وصلته عليه.' }),
    notice && h('div', { class: 'notice', text: notice }),
    googleBox,
    canSignup ? h('div', { class: 'tabs', role: 'tablist' }, tabLogin, tabSignup) : h('h2', { class: 'auth-title', text: 'تسجيل دخول الأعضاء' }),
    form,
    !canSignup && h('p', { class: 'muted small-note', text: 'الحساب الجديد لا يُنشأ إلا بدعوة من مدير الشجرة. إن لم تكن عضوًا فاطلب الانضمام من الصفحة الرئيسية.' }),
    h('div', { class: 'divider' }, h('button', { class: 'link-btn', type: 'button', onclick: showLanding, text: '← العودة إلى الصفحة الرئيسية' })),
  );

  render();
  mount(h('div', { class: 'center' }, card));

  // the Google button appears only if the provider is switched on in Supabase
  googleEnabled().then((on) => {
    if (!on) return;
    googleBox.hidden = false;
    googleBox.append(
      h('button', {
        class: 'btn block',
        type: 'button',
        text: 'المتابعة بحساب Google',
        onclick: async () => {
          const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
          if (error) err.textContent = friendly(error);
        },
      }),
      h('div', { class: 'divider', text: '— أو بالبريد —' }),
    );
  });
}

function showStart(msg) {
  const code = h('input', { type: 'text', placeholder: 'ألصق رابط الدعوة هنا', autocomplete: 'off', dir: 'ltr' });
  const treeName = h('input', { type: 'text', maxlength: 100, placeholder: 'مثال: عائلة الراشد', autocomplete: 'off' });
  const err = h('div', { class: 'error', role: 'alert' });

  const joinBtn = h('button', { class: 'btn primary block', type: 'submit', text: 'انضمام' });
  const joinForm = h('form', {}, field('لديّ رابط دعوة', code), joinBtn);
  joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = code.value.match(/[0-9a-f]{16}/i);
    err.textContent = '';
    joinBtn.disabled = true;
    try {
      const { data, error } = await sb.rpc('join_tree', { p_code: (m ? m[0] : code.value).trim().toLowerCase() });
      if (error) throw error;
      localStorage.setItem('ft.tree', data);
      await boot();
    } catch (ex) {
      err.textContent = friendly(ex);
      joinBtn.disabled = false;
    }
  });

  const createBtn = h('button', { class: 'btn block', type: 'submit', text: 'إنشاء شجرة جديدة' });
  const createForm = h('form', {}, field('أو ابدأ شجرة جديدة', treeName), createBtn);
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!treeName.value.trim()) return (err.textContent = 'اكتب اسمًا للشجرة');
    err.textContent = '';
    createBtn.disabled = true;
    try {
      const { data, error } = await sb.rpc('create_tree', { p_name: treeName.value });
      if (error) throw error;
      localStorage.setItem('ft.tree', data);
      await boot();
    } catch (ex) {
      err.textContent = friendly(ex);
      createBtn.disabled = false;
    }
  });

  // a request to join the family (only when the tree has its public page on)
  const joinBox = h('div', { class: 'join-box' });
  joinBox.hidden = true;
  fillStartJoin(joinBox);

  // Only a tree admin (or the very first user) may start a tree; everyone else waits for an invitation.
  const createBox = h('div', {}, h('div', { class: 'divider', text: '— أو —' }), createForm);
  const noInvite = h('p', { class: 'muted', text: 'يدخل أفراد العائلة بدعوة من مدير الشجرة. اطلب منه دعوة على بريدك الإلكتروني، ثم افتح الرابط الذي سيرسله لك.' });
  put(createBox, noInvite);
  sb.rpc('can_create_tree').then(({ data }) => {
    if (data === true) put(createBox, h('div', { class: 'divider', text: '— أو —' }), createForm);
  });

  mount(
    h(
      'div',
      { class: 'center' },
      h(
        'div',
        { class: 'auth-card' },
        brand(),
        h('p', { class: 'lead', text: `أهلًا ${state.profile?.display_name || ''}. لم تنضم إلى أي شجرة بعد.` }),
        msg && h('div', { class: 'notice', text: msg }),
        joinBox,
        joinForm,
        createBox,
        err,
        h('div', { class: 'divider' }, h('button', { class: 'link-btn', type: 'button', onclick: signOut, text: 'تسجيل الخروج' })),
      ),
    ),
  );
}

// ====================================================================
// boot / session
// ====================================================================

function readHash() {
  const m = location.hash.match(/^#\/join\/([0-9a-f]{8,64})/i);
  if (!m) return false;
  pendingJoin.set(m[1].toLowerCase());
  history.replaceState(null, '', location.pathname + location.search);
  return true;
}

async function boot() {
  mount(loadingScreen());
  try {
    const { data: profile } = await sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
    state.profile = profile;

    let notice = null;
    const code = pendingJoin.get();
    if (code) {
      pendingJoin.clear();
      const { data, error } = await sb.rpc('join_tree', { p_code: code });
      if (error) notice = friendly(error);
      else localStorage.setItem('ft.tree', data);
    }

    // the columns added by migrations 009 / 010 may not exist yet: fall back to the older set
    let ms = null;
    let error = null;
    for (const cols of ['id, name, about, female_card_mode, public_page, public_show_living, default_look', 'id, name, about, female_card_mode, public_page, public_show_living', 'id, name, about, female_card_mode', 'id, name, about']) {
      ({ data: ms, error } = await sb.from('tree_members').select(`role, tree:trees(${cols})`).eq('user_id', state.user.id));
      if (!error || !/female_card_mode|public_page|public_show_living|default_look/.test(error.message)) break;
    }
    if (error) throw error;
    state.memberships = (ms || []).filter((m) => m.tree);
    if (!state.memberships.length) {
      dropSnapshot(); // no longer a member of any tree: nothing of it stays on this device
      return showStart(notice);
    }

    const last = localStorage.getItem('ft.tree');
    const m = state.memberships.find((x) => x.tree.id === last) || state.memberships[0];
    await openTree(m.tree.id);
    if (notice) toast(notice, true);
    else if (code) toast('تم انضمامك إلى الشجرة');
  } catch (ex) {
    if (hasSnapshot()) return goOffline(); // the server cannot be reached: the copy kept on this device
    mount(h('div', { class: 'center' }, h('div', { class: 'auth-card' }, brand(), h('p', { class: 'error', text: friendly(ex) }), h('button', { class: 'btn block', onclick: () => location.reload(), text: 'إعادة المحاولة' }))));
  }
}

async function signOut() {
  if (DEMO) {
    history.replaceState(null, '', location.pathname);
    return location.reload();
  }
  await dropSnapshot(); // a copy of the family must not stay on a device whose owner signed out
  await sb.auth.signOut();
}

function teardownTree() {
  syncPanelLayer(false);
  if (state.channel) sb.removeChannel(state.channel);
  state.channel = null;
  chart = null;
  ui = {};
  state.persons = new Map();
  state.marriages = new Map();
  state.grants = new Map();
  state.perms = null;
  state.names = null;
  clearInterval(state.inboxTimer);
  state.index = null;
  state.layout = null;
  state.selectedId = null;
  state.rootId = null;
  state.collapsed = new Set();
}

// ====================================================================
// tree data
// ====================================================================

async function fetchAll(table, treeId) {
  const out = [];
  const page = 1000; // PostgREST caps a response at 1000 rows
  for (let from = 0; ; from += page) {
    const { data, error } = await sb.from(table).select('*').eq('tree_id', treeId).order('created_at').order('id').range(from, from + page - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < page) break;
  }
  return out;
}

// ---------- reading without a connection ----------
// After a successful load the tree is kept on this device (IndexedDB). With no connection the app opens that copy, for reading
// only. Signing out deletes it, and it is never opened without the sign-in of this browser.

const OFFLINE_KEY = 'ft.snap';
const idb = {
  open: () =>
    new Promise((resolve, reject) => {
      const r = indexedDB.open('family-tree', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }),
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const q = fn(db.transaction('kv', mode).objectStore('kv'));
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
  },
  get: (k) => idb.run('readonly', (s) => s.get(k)),
  set: (k, v) => idb.run('readwrite', (s) => s.put(v, k)),
  del: (k) => idb.run('readwrite', (s) => s.delete(k)),
};
let offlineSnap = null;
const offlineWanted = () => safeGet('ft.offline') !== '0'; // the person can switch the copy off (settings)
/** Who is signed in in this browser (read from the stored session; nothing is asked of the network). */
function authUserId() {
  try {
    for (const k of Object.keys(localStorage)) if (/^sb-.*-auth-token$/.test(k)) return JSON.parse(localStorage.getItem(k))?.user?.id ?? null;
  } catch {
    /* an unreadable session is no session */
  }
  return null;
}
/** A copy exists and it is the copy of the person signed in here (the flag holds that person's id). */
const hasSnapshot = () => {
  const id = safeGet(OFFLINE_KEY);
  return !!id && id === authUserId();
};
const goOffline = () => {
  history.replaceState(null, '', location.pathname + location.search + '#/offline');
  location.reload();
};
const leaveOffline = () => {
  history.replaceState(null, '', location.pathname + location.search);
  location.reload();
};
async function dropSnapshot() {
  remember(OFFLINE_KEY, '');
  try {
    await idb.del('snapshot');
  } catch {
    /* nothing was kept */
  }
}

async function saveSnapshot() {
  if (DEMO || !offlineWanted() || !state.user || !state.treeId || !state.persons.size) return;
  try {
    const t = currentTree();
    await idb.set('snapshot', {
      v: 1,
      savedAt: Date.now(),
      userId: state.user.id,
      displayName: state.profile?.display_name || null,
      treeId: state.treeId,
      tree: { id: t.id, name: t.name, about: t.about ?? null, female_card_mode: t.female_card_mode ?? 'full', default_look: t.default_look ?? null },
      lookMine: state.lookMine,
      persons: [...state.persons.values()],
      marriages: [...state.marriages.values()],
      info: [...state.info.values()].flat(),
    });
    remember(OFFLINE_KEY, state.user.id);
  } catch {
    /* no room, or storage blocked: there is simply no offline copy */
  }
}
let snapTimer = null;
const scheduleSnapshot = () => {
  if (DEMO) return;
  clearTimeout(snapTimer);
  snapTimer = setTimeout(saveSnapshot, 15000); // a burst of changes (and every fold or unfold of the tree) is kept once
};
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && !DEMO && saveSnapshot());

async function loadTreeData() {
  if (OFFLINE) {
    state.persons = new Map(offlineSnap.persons.map((p) => [p.id, p]));
    state.marriages = new Map(offlineSnap.marriages.map((m) => [m.id, m]));
    state.info = new Map();
    for (const r of offlineSnap.info || []) setInfo(r);
    return;
  }
  if (DEMO) {
    state.persons = new Map(demoPersons.map((p) => [p.id, p]));
    state.marriages = new Map(demoMarriages.map((m) => [m.id, m]));
    await loadInfo();
    return;
  }
  const [persons, marriages] = await Promise.all([fetchAll('persons', state.treeId), fetchAll('marriages', state.treeId)]);
  state.persons = new Map(persons.map((p) => [p.id, p]));
  state.marriages = new Map(marriages.map((m) => [m.id, m]));
  await loadInfo();
}

/** The information rows of the women's cards (the table of migration 009; missing table = no rows). */
async function loadInfo() {
  state.info = new Map();
  if (!hasBackend()) return;
  try {
    const { data, error } = await sb.from('card_info').select('*').eq('tree_id', state.treeId);
    if (error) return;
    for (const r of data || []) setInfo(r);
  } catch {
    /* no information table yet */
  }
}

function setInfo(row) {
  const list = (state.info.get(row.person_id) || []).filter((r) => r.id !== row.id);
  list.push(row);
  list.sort((x, y) => String(x.created_at ?? '').localeCompare(String(y.created_at ?? '')));
  state.info.set(row.person_id, list);
}

/** Branch heads granted to me. Tolerates the table not existing yet (migration not run). */
async function loadGrants() {
  if (DEMO) return (state.grants = new Map(DEMO_GRANTS));
  const { data, error } = await sb
    .from('branch_grants')
    .select('person_id, can_add, can_edit, can_delete, can_grant')
    .eq('tree_id', state.treeId)
    .eq('user_id', state.user.id);
  if (error) console.warn('branch_grants unavailable:', error.message);
  state.grants = new Map(
    (data || []).map((g) => [g.person_id, { add: g.can_add, edit: g.can_edit, delete: g.can_delete, grant: g.can_grant }]),
  );
}

async function openTree(id) {
  teardownTree();
  photos = DEMO ? null : new PhotoStore(sb);
  const m = state.memberships.find((x) => x.tree.id === id);
  state.treeId = id;
  state.role = m.role;
  loadLook(m.tree);
  localStorage.setItem('ft.tree', id);
  mountMain(m.tree.name);
  try {
    await Promise.all([loadTreeData(), loadGrants()]);
  } catch (ex) {
    if (!DEMO && hasSnapshot()) return goOffline(); // the tree cannot be loaded now: the copy kept on this device
    toast(friendly(ex), true);
    ui.loading.textContent = 'تعذّر تحميل الشجرة';
    return;
  }
  ui.loading.remove();
  if (!DEMO) subscribe();
  if (!DEMO) saveSnapshot();

  rebuild();
  refreshInbox();
  state.inboxTimer = setInterval(refreshInbox, 120000);
  const saved = localStorage.getItem('ft.root.' + id);
  if (saved && saved !== state.rootId && state.index.byId.has(saved)) setRoot(saved, { focus: false });
  chart.focusTop();
}

function subscribe() {
  const ch = sb.channel('tree-' + state.treeId);
  for (const table of ['persons', 'marriages']) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      if (!chart) return;
      const map = table === 'persons' ? state.persons : state.marriages;
      if (payload.eventType === 'DELETE') {
        if (payload.old?.id) map.delete(payload.old.id);
      } else if (payload.new?.tree_id === state.treeId) {
        map.set(payload.new.id, payload.new);
      }
      scheduleRebuild();
    });
  }
  ch.subscribe();
  state.channel = ch;
}

let rebuildQueued = false;
function scheduleRebuild() {
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => {
    rebuildQueued = false;
    if (chart) rebuild();
  });
}

const ORIENTATION = { classic: 'vertical', horizontal: 'horizontal', fan: 'fan', tree: 'tree' };

/** Card size: it depends on the look and on what a card holds (a nickname line when anybody has one, the years, the two buttons). */
function cardSize() {
  const nick = [...state.persons.values()].some((p) => p.nickname);
  return { ...SIZE, ...cardMetrics(state.cardStyle, { nick, acts: state.cardButtons, years: state.showYears }) };
}

function rebuild() {
  const idx = (state.index = buildIndex([...state.persons.values()], [...state.marriages.values()]));
  state.perms = makePermissions({ role: state.role, userId: state.user?.id, grants: state.grants, index: idx });
  if (!idx.list.length) {
    state.rootId = null;
  } else if (!idx.byId.has(state.rootId)) {
    state.rootId = defaultRoot(idx);
    state.collapsed = autoCollapse(idx, state.rootId);
  }
  const hideFemales = !state.showFemales; // the male line only: women and what hangs under them are left out
  const hier = state.rootId ? buildHierarchy(idx, state.rootId, state.collapsed, hideFemales ? { hide: (p) => p.gender === 'female' } : {}) : null;
  state.layout = hier
    ? layout(hier, {
        rtl: true,
        size: cardSize(),
        orientation: ORIENTATION[state.design],
        // wives are written under the cards of the two card designs only
        lines: state.showWives && !hideFemales && (state.design === 'classic' || state.design === 'horizontal') ? (id) => spouseLines(idx, idx.byId.get(id)) : null,
      })
    : null;
  if (state.layout) state.layout.genOffset = lineAncestorsOf(idx, state.rootId).size - 1; // generations above the root
  if (state.selectedId && !idx.byId.has(state.selectedId)) state.selectedId = null;
  chart.configure({ bands: state.bands && state.design === 'classic', colors: state.branchColors, years: state.showYears, curves: state.curves, actions: state.cardButtons, cardStyle: state.cardStyle, wifeColors: state.wifeColors && state.showFemales });
  chart.render(state.layout, state.selectedId);
  scheduleSnapshot();
  syncPhotos();
  ui.empty.hidden = idx.list.length > 0;
  ui.zoom.hidden = idx.list.length === 0;
  renderPanel();
}

function setRoot(id, { focus = true } = {}) {
  state.rootId = id;
  state.collapsed = autoCollapse(state.index, id);
  localStorage.setItem('ft.root.' + state.treeId, id);
  rebuild();
  if (focus) chart.focusTop();
}

/** Make sure a person is drawn: switch root / expand branches as needed. */
function revealPerson(id) {
  if (chart.has(id)) return;
  const up = lineAncestorsOf(state.index, id);
  if (!up.has(state.rootId)) {
    state.rootId = topAncestor(state.index, id);
    state.collapsed = autoCollapse(state.index, state.rootId);
  }
  for (const a of up) state.collapsed.delete(a);
  rebuild();
}

function sheetInset() {
  return window.innerWidth <= 760 && !ui.panel.hidden ? ui.panel.offsetHeight : 0;
}

function select(id) {
  if (state.selectedId !== id) state.activeSpouse = null;
  state.selectedId = id;
}

function focusPerson(id) {
  select(id);
  revealPerson(id);
  rebuild();
  chart.centerOn(id, { insetBottom: sheetInset() });
  if (!chart.has(id) && !state.showFemales && state.index.byId.get(id)?.gender === 'female') toast('بطاقتها مخفية الآن. فعّل «إظهار الإناث» من الإعدادات.');
}

/**
 * Open someone from a list in the panel. A wife who married in has no place of her own in the
 * chart (her children hang under her husband), so she only gets her details panel; everyone
 * else is brought into view.
 */
function openPerson(id) {
  const p = state.index.byId.get(id);
  if (chart.has(id) || lineParent(state.index, p) || state.index.lineKids.has(id)) return focusPerson(id);
  select(id);
  chart.setSelected(id);
  renderPanel();
}

function onSelect(id) {
  const again = !!id && id === state.selectedId; // tapping the card that is already chosen
  select(id);
  chart.setSelected(id);
  renderPanel();
  // a woman's information table was closed with its button: tapping her card brings it back
  const p = again && state.index.byId.get(id);
  if (p && state.quickFor !== id && showsInfoTable(p)) openQuick(p, 'info', { focus: false });
}

// ---------- search & filter page ----------

/** Downloads text as a file (started by the user's click). */
function downloadText(filename, text, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Arabic plural for a result count: لا نتائج / نتيجة واحدة / نتيجتان / 3 نتائج / 27 نتيجة */
function resultsText(n) {
  if (n === 0) return 'لا نتائج';
  if (n === 1) return 'نتيجة واحدة';
  if (n === 2) return 'نتيجتان';
  return `${n} ${n <= 10 ? 'نتائج' : 'نتيجة'}`;
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/**
 * A full page to find people by name and by place. There are two places to filter on, where they
 * live now and where they were born, each as country -> province -> city, and the two combine
 * (for example: born in Syria AND living in Germany) with gender / living / sorting.
 * Every filter combines with the others; a result opens that person in the chart.
 */
function openSearchPage() {
  const idx = state.index;
  const blank = () => ({ country: null, provinceKey: null, cityKey: null, none: false });
  const f = { query: '', residence: blank(), birth: blank(), gender: null, status: null, sort: 'name' };
  const KIND = { residence: 'الإقامة الحالية', birth: 'مكان الميلاد' };
  const stats = { residence: placeStats(idx, 'residence'), birth: placeStats(idx, 'birth') };
  const noPlace = {
    residence: filterPersons(idx, { residence: { none: true } }).length,
    birth: filterPersons(idx, { birth: { none: true } }).length,
  };
  let kind = 'residence'; // which of the two places the chips below are editing
  let shown = 100;

  const page = h('div', { class: 'page', role: 'dialog', 'aria-label': 'البحث والتصفية' });
  const layer = backPush(() => close());
  const close = () => {
    backRelease(layer);
    page.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);

  const select = (label, options, onChange) => {
    const s = h('select', { 'aria-label': label }, options.map(([v, t]) => h('option', { value: v, text: t })));
    s.addEventListener('change', () => onChange(s.value));
    return s;
  };
  const again = () => ((shown = 100), render());
  const name = h('input', { type: 'search', placeholder: 'اكتب اسمًا أو مكانًا…', autocomplete: 'off', 'aria-label': 'بحث بالاسم أو المكان' });
  name.addEventListener('input', () => ((f.query = name.value), again()));
  const genderSel = select('الجنس', [['', 'الجنس: الكل'], ['male', 'ذكور'], ['female', 'إناث']], (v) => ((f.gender = v || null), again()));
  const statusSel = select('الحالة', [['', 'الحالة: الكل'], ['living', 'أحياء'], ['deceased', 'متوفون']], (v) => ((f.status = v || null), again()));
  const sortSel = select('الترتيب', [['name', 'الترتيب: الاسم'], ['age', 'الترتيب: الأكبر سنًا']], (v) => ((f.sort = v), render()));

  const chip = (label, count, pressed, onClick) =>
    h('button', { class: 'chip', type: 'button', 'aria-pressed': String(pressed), onclick: onClick }, label, count != null && h('b', { text: String(count) }));
  const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'نوع المكان' });
  const activeBar = h('div', { class: 'chips' });
  const countryChips = h('div', { class: 'chips' });
  const provinceChips = h('div', { class: 'chips' });
  const cityChips = h('div', { class: 'chips' });
  const provinceBox = h('div', {}, h('div', { class: 'section-title', text: 'المحافظة / المنطقة' }), provinceChips);
  const cityBox = h('div', {}, h('div', { class: 'section-title', text: 'المدينة' }), cityChips);
  const summary = h('div', { class: 'results-head' });
  const list = h('div', { class: 'stack' });
  const moreBox = h('div', { style: 'text-align:center' });

  const groupText = (k) => {
    const g = f[k];
    if (g.none) return 'بلا مكان مسجّل';
    if (g.country === null) return '';
    const c = stats[k].find((x) => x.code === g.country);
    const parts = [c ? c.name : countryLabel(g.country)];
    if (g.provinceKey) parts.push(c?.provinces.find((p) => p.key === g.provinceKey)?.name);
    if (g.cityKey) parts.push(c?.cities.find((x) => x.key === g.cityKey)?.name);
    return parts.filter(Boolean).join(' › ');
  };

  const reset = () => {
    Object.assign(f, { query: '', residence: blank(), birth: blank(), gender: null, status: null, sort: 'name' });
    name.value = '';
    genderSel.value = statusSel.value = '';
    sortSel.value = 'name';
    again();
  };

  const go = (id) => {
    close();
    focusPerson(id);
  };

  const row = (p) => {
    const av = h('div', { class: 'avatar', style: `--gender:var(--${p.gender})` });
    const src = photos?.url(p.photo_url);
    if (src) av.append(h('img', { src, alt: '' }));
    else av.append(genderIcon(p.gender));
    const home = residenceText(p);
    const born = birthText(p);
    const bits = [home && `يسكن: ${home}`, born && `المولد: ${born}`, lifeSpan(p), p.is_deceased ? 'متوفى' : null].filter(Boolean);
    return h(
      'button',
      { class: 'result', type: 'button', onclick: () => go(p.id) },
      av,
      h('span', { class: 'who-line' }, h('strong', { text: describe(idx, p) }), bits.length > 0 && h('small', { text: bits.join(' · ') })),
    );
  };

  const exportCsv = (rows) => {
    const head = ['الاسم', 'اللقب', 'الجنس', 'تاريخ الميلاد', 'بلد الميلاد', 'محافظة الميلاد', 'مدينة الميلاد', 'بلد الإقامة', 'محافظة الإقامة', 'مدينة الإقامة', 'الهاتف', 'البريد الإلكتروني', 'الحالة'];
    const lines = rows.map((p) => {
      const b = placeOf(p, 'birth');
      const r = placeOf(p, 'residence');
      return [p.first_name, p.last_name, p.gender === 'male' ? 'ذكر' : 'أنثى', p.birth_date, countryLabel(b.country), b.province, b.city, countryLabel(r.country), r.province, r.city, p.phone, p.email, p.is_deceased ? 'متوفى' : 'على قيد الحياة'].map(csvCell).join(',');
    });
    downloadText('نتائج-البحث.csv', '﻿' + [head.map(csvCell).join(','), ...lines].join('\r\n'), 'text/csv');
  };

  function render() {
    const g = f[kind];
    const st = stats[kind];

    // which place are we editing, and what is selected in each
    put(tabs, 
      ...['residence', 'birth'].map((k) =>
        h('button', { type: 'button', role: 'tab', 'aria-pressed': String(kind === k), onclick: () => ((kind = k), render()) }, KIND[k], groupText(k) && h('b', { text: ' •' })),
      ),
    );
    const active = ['residence', 'birth'].filter((k) => groupText(k));
    activeBar.hidden = !active.length;
    put(activeBar, 
      ...active.map((k) =>
        h('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', title: 'إلغاء هذا الشرط', onclick: () => ((f[k] = blank()), again()) }, `${KIND[k]}: ${groupText(k)}`, h('b', { text: '✕' })),
      ),
    );

    // country
    const setCountry = (code) => {
      f[kind] = { ...blank(), country: g.country === code && !g.none ? null : code };
      again();
    };
    put(countryChips, 
      chip('الكل', null, g.country === null && !g.none, () => ((f[kind] = blank()), again())),
      ...st.map((c) => chip(c.name, c.count, g.country === c.code && !g.none, () => setCountry(c.code))),
      noPlace[kind] > 0 && chip('بلا مكان مسجّل', noPlace[kind], g.none, () => ((f[kind] = { ...blank(), none: !g.none }), again())),
    );

    // province and city of the chosen country
    const cs = g.country !== null && !g.none ? st.find((c) => c.code === g.country) : null;
    provinceBox.hidden = !cs || !cs.provinces.length;
    if (cs && cs.provinces.length) {
      put(provinceChips, 
        chip(`كل ${cs.name}`, cs.count, g.provinceKey === null, () => ((g.provinceKey = null), (g.cityKey = null), again())),
        ...cs.provinces.map((pv) => chip(pv.name, pv.count, g.provinceKey === pv.key, () => ((g.provinceKey = g.provinceKey === pv.key ? null : pv.key), (g.cityKey = null), again()))),
      );
    }
    const cities = cs ? (g.provinceKey ? cs.provinces.find((pv) => pv.key === g.provinceKey)?.cities || [] : cs.cities) : [];
    cityBox.hidden = !cities.length;
    if (cities.length) {
      put(cityChips, 
        chip('كل المدن', null, g.cityKey === null, () => ((g.cityKey = null), again())),
        ...cities.map((c) => chip(c.name, c.count, g.cityKey === c.key, () => ((g.cityKey = g.cityKey === c.key ? null : c.key), again()))),
      );
    }

    const rows = filterPersons(idx, { query: f.query, residence: f.residence, birth: f.birth, gender: f.gender, status: f.status, sort: f.sort });
    put(summary, 
      h('span', { class: 'grow', text: resultsText(rows.length) }),
      h('button', { class: 'btn small', type: 'button', onclick: reset, text: 'مسح التصفية' }),
      rows.length > 0 && h('button', { class: 'btn small', type: 'button', onclick: () => exportCsv(rows), text: 'تنزيل القائمة (CSV)' }),
    );
    put(list, ...(rows.length ? rows.slice(0, shown).map(row) : [h('div', { class: 'empty-note', text: 'لا توجد نتائج. غيّر التصفية أو امسحها.' })]));
    put(moreBox, rows.length > shown ? h('button', { class: 'btn', type: 'button', onclick: () => ((shown += 200), render()), text: `عرض المزيد (${rows.length - shown})` }) : '');
  }

  page.append(
    h('div', { class: 'page-head' }, h('button', { class: 'btn small', type: 'button', title: 'رجوع إلى الشجرة', 'aria-label': 'رجوع إلى الشجرة', onclick: close }, icon('x'), 'رجوع'), h('h1', { text: 'البحث والتصفية' })),
    h(
      'div',
      { class: 'page-body' },
      h(
        'div',
        { class: 'page-inner' },
        h('div', { class: 'filters' }, h('div', { class: 'field' }, name), h('div', { class: 'field' }, genderSel), h('div', { class: 'field' }, statusSel), h('div', { class: 'field' }, sortSel)),
        h('div', {}, h('div', { class: 'section-title', text: 'المكان' }), tabs, activeBar, countryChips),
        provinceBox,
        cityBox,
        summary,
        list,
        moreBox,
      ),
    ),
  );
  document.body.append(page);
  render();
  name.focus();
}

// ---------- about the designer (stored in the database: members only, edited by the admin) ----------

const currentTree = () => state.memberships.find((m) => m.tree.id === state.treeId)?.tree;

function aboutView(about, canEdit, onEdit) {
  if (!about) {
    return h(
      'div',
      { class: 'about' },
      h('p', { class: 'muted', text: 'لم تُكتب بعدُ نبذة عن المصمم.' }),
      canEdit && h('button', { class: 'btn primary', type: 'button', onclick: onEdit, text: 'كتابة النبذة' }),
    );
  }
  const row = (label, href, text) => h('a', { class: 'contact', href }, h('span', { class: 'muted', text: label }), h('span', { class: 'ltr', text }));
  const contacts = [about.phone && row('الهاتف', `tel:${about.phone.replace(/[^+\d]/g, '')}`, about.phone), about.email && row('البريد الإلكتروني', `mailto:${about.email}`, about.email)].filter(Boolean);
  return h(
    'div',
    { class: 'about' },
    (about.name || about.place) &&
      h(
        'div',
        { class: 'about-head' },
        h('div', { class: 'avatar about-avatar', text: (about.name || '?').charAt(0) }),
        h('div', {}, about.name && h('h3', { text: about.name }), about.place && h('div', { class: 'muted', text: about.place })),
      ),
    about.greeting && h('p', { class: 'about-greeting', text: about.greeting }),
    ...aboutParagraphs(about).map((t) => h('p', { text: t })),
    contacts.length > 0 && h('div', { class: 'section-title', text: 'للتواصل' }),
    contacts.length > 0 && h('div', { class: 'contacts' }, ...contacts),
    canEdit && h('div', { class: 'modal-foot', style: 'justify-content:flex-start' }, h('button', { class: 'btn small', type: 'button', onclick: onEdit, text: 'تعديل النبذة' })),
  );
}

function openAbout() {
  const tree = currentTree();
  const canEdit = state.role === 'admin' && hasBackend();
  const body = h('div', {});
  const dlg = modal(ABOUT_TITLE, body);
  const show = () => put(body, aboutView(cleanAbout(tree?.about), canEdit, edit));

  function edit() {
    const cur = cleanAbout(tree?.about) || {};
    const input = (key, label, props = {}) => {
      const i = h('input', { type: 'text', maxlength: 200, value: cur[key] || '', autocomplete: 'off', ...props });
      return { i, node: field(label, i) };
    };
    const name = input('name', 'الاسم');
    const place = input('place', 'المكان', { placeholder: 'مثال: المدينة، المحافظة، البلد' });
    const greeting = input('greeting', 'التحية', { placeholder: 'مثال: السلام عليكم ورحمة الله وبركاته' });
    const text = h('textarea', { maxlength: 2000, rows: 6, value: cur.text || '', placeholder: 'اكتب النبذة. اترك سطرًا فارغًا بين الفقرات.' });
    const phone = input('phone', 'الهاتف', { type: 'tel', dir: 'ltr', placeholder: '+000 000 000 000' });
    const email = input('email', 'البريد الإلكتروني', { type: 'email', dir: 'ltr', placeholder: 'name@example.com' });
    const err = h('div', { class: 'error', role: 'alert' });
    const save = h('button', { class: 'btn primary', type: 'submit', text: 'حفظ' });
    const form = h(
      'form',
      {},
      h('p', { class: 'muted small-note', text: 'تظهر هذه النبذة لأعضاء هذه الشجرة فقط، ولا تُنشر مع الموقع.' }),
      name.node,
      place.node,
      greeting.node,
      field('النبذة', text),
      h('div', { class: 'row' }, phone.node, email.node),
      err,
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'button', onclick: show, text: 'إلغاء' }), save),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      save.disabled = true;
      try {
        const about = cleanAbout({ name: name.i.value, place: place.i.value, greeting: greeting.i.value, text: text.value, phone: phone.i.value, email: email.i.value });
        const { data, error } = await sb.from('trees').update({ about }).eq('id', state.treeId).select('about');
        if (error) throw error;
        if (Array.isArray(data) && data.length === 0) throw new Error('permission denied');
        tree.about = about;
        show();
        toast('تم حفظ النبذة');
      } catch (ex) {
        err.textContent = friendly(ex);
        save.disabled = false;
      }
    });
    put(body, form);
    name.i.focus();
  }

  show();
  return dlg;
}

// ---------- settings ----------

// ---------- the look: factory <- what the admin chose for everybody <- what I chose for myself ----------

let lookTimer = null;
const lookKey = () => `ft.look.${state.user?.id || 'demo'}`;
/** The admin's choices are the tree's default (and what the admin sees); everybody else has choices of their own. */
const isLookAdmin = () => state.role === 'admin' && hasBackend();

/** Take the default of this tree and my own choices, and put the result on the screen. */
function loadLook(tree) {
  state.lookDefault = cleanLook(tree?.default_look);
  let mine = state.profile?.look;
  if (mine == null) {
    try {
      mine = JSON.parse(localStorage.getItem(lookKey()) || 'null'); // kept in this browser (also when the database has no place for it yet)
    } catch {
      mine = null;
    }
  }
  if (mine == null) mine = legacyLook(safeGet); // the choices an older version kept in this browser, one by one
  state.lookMine = cleanLook(mine);
  applyLook();
}

function applyLook() {
  Object.assign(state, resolveLook(state.lookDefault, isLookAdmin() ? null : state.lookMine));
  // On a phone, when neither the admin nor the person chose a shape of the tree, it is drawn sideways (generations as columns):
  // the better fit for a tall screen. A choice, by anybody, is always kept.
  if (isPhone() && !('design' in state.lookDefault) && !('design' in (isLookAdmin() ? {} : cleanLook(state.lookMine)))) state.design = 'horizontal';
  state.theme = cleanLook(state.lookMine).theme ?? 'auto'; // light / dark is a matter of the person's own eyes and device: never taken from the default
  applyTheme(); // (remembers it in 'ft.themecache', not in 'ft.theme': that one is the choice an older version kept, read once by legacyLook)
}

async function saveDefaultLook() {
  if (!sb || !state.treeId) return;
  const { error } = await sb.from('trees').update({ default_look: state.lookDefault }).eq('id', state.treeId);
  if (error) return toast(friendly(error), true);
  const t = currentTree();
  if (t) t.default_look = { ...state.lookDefault };
}

function saveMyLook() {
  try {
    localStorage.setItem(lookKey(), JSON.stringify(state.lookMine));
  } catch {
    /* storage unavailable: the choice stays for this visit only */
  }
  if (!hasBackend() || !state.user) return;
  clearTimeout(lookTimer);
  lookTimer = setTimeout(async () => {
    const { error } = await sb.from('profiles').update({ look: state.lookMine }).eq('id', state.user.id);
    if (!error && state.profile) state.profile.look = { ...state.lookMine }; // (before supabase/015 the choices stay in this browser)
  }, 500);
}

/** A choice of the look is remembered where it belongs: the admin's for the whole tree, everybody else's for themselves. */
function changeLook(key, value) {
  if (isLookAdmin() && key !== 'theme') {
    state.lookDefault = { ...state.lookDefault, [key]: value };
    clearTimeout(lookTimer);
    lookTimer = setTimeout(saveDefaultLook, 500);
  } else {
    state.lookMine = { ...state.lookMine, [key]: value };
    saveMyLook();
  }
}

/** Change one thing of the look. `focus`: a new shape of the tree, so bring the whole tree back into view. */
function setLook(key, value, { focus = false } = {}) {
  if (state[key] === value) return;
  state[key] = value;
  changeLook(key, value);
  applyTheme();
  if (key === 'theme') return; // nothing to draw again: only the colours change
  if (focus) {
    rebuild();
    chart.focusTop();
  } else {
    chart.keepInPlace(state.selectedId && chart.has(state.selectedId) ? state.selectedId : state.rootId, rebuild);
  }
}
const setShowWives = (on) => setLook('showWives', on);
const setShowFemales = (on) => setLook('showFemales', on);
const setWifeColors = (on) => setLook('wifeColors', on);
const setTripleName = (on) => setLook('tripleName', on);

/** The name of a person as the card and the panel show it: with the father's name when that look is on. */
function displayName(p) {
  return state.tripleName && state.index ? cardName(state.index, p) : fullName(p);
}
const setBranchColors = (on) => setLook('branchColors', on);
const setShowYears = (on) => setLook('showYears', on);
const setCurves = (on) => setLook('curves', on);
const setCardButtons = (on) => setLook('cardButtons', on);
const setBands = (on) => setLook('bands', on);
const setTheme = (theme) => setLook('theme', theme);
const setDesign = (design) => setLook('design', design, { focus: true });
const setCardStyle = (id) => setLook('cardStyle', id);

/** "العودة إلى الافتراضي": a member drops their own choices; the admin takes the default of the tree back to the factory look. */
async function resetLook(reopen) {
  const admin = isLookAdmin();
  const ok = await confirmBox(
    'العودة إلى الافتراضي',
    admin ? 'يعود الشكل الافتراضي للشجرة كلها إلى الشكل الأصلي. ومن خصّص شكلًا لنفسه يبقى شكله.' : 'تعود كل خيارات الشكل عندك إلى الشكل الافتراضي الذي حدده مدير الشجرة.',
    'العودة إلى الافتراضي',
  );
  if (!ok) return;
  if (admin) {
    state.lookDefault = {};
    await saveDefaultLook();
  } else {
    state.lookMine = {};
    saveMyLook();
  }
  applyLook();
  rebuild();
  chart.focusTop();
  reopen?.();
  toast('عاد الشكل إلى الافتراضي');
}

/** The ten looks of a card, each drawn by the real card code and CSS (so a preview is exactly what the tree will show). */
function cardStyleChooser() {
  const sample = { first_name: 'أحمد', last_name: 'الراشد', nickname: 'أبو جريش', gender: 'male', birth_date: '1946', death_date: '2019', is_deceased: true };
  const list = h('div', { class: 'cs-grid', role: 'radiogroup', 'aria-label': 'شكل البطاقة' });
  const options = new Map();
  const sync = () => {
    for (const [id, o] of options) o.setAttribute('aria-checked', String(id === state.cardStyle));
  };
  CARD_STYLES.forEach((st, i) => {
    const m = cardMetrics(st.id, { nick: true, acts: true, years: true });
    const k = 0.62; // the preview is a little smaller than the real card
    const thumb = h('div', { class: 'cs-thumb', 'data-card': st.id, 'aria-hidden': 'true', style: `height:${Math.round(m.cardH * k) + 8}px` });
    const card = makeCard(sample, { actions: true, canAdd: true, name: 'أحمد يحيى الراشد' });
    card.style.cssText = `left:50%;top:${m.head}px;width:${m.cardW}px;height:${m.cardH - m.head}px;transform:translateX(-50%) scale(${k});transform-origin:50% ${-m.head}px;`;
    thumb.append(card);
    thumb.inert = true; // the buttons drawn inside are only a picture
    const o = h(
      'div',
      {
        class: 'cs-opt',
        role: 'radio',
        tabindex: '0',
        onclick: () => (setCardStyle(st.id), sync()),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCardStyle(st.id);
            sync();
          }
        },
      },
      thumb,
      h('strong', { text: `${i + 1} · ${st.label}` }),
      h('span', { class: 'muted', text: st.note }),
    );
    options.set(st.id, o);
    list.append(o);
  });
  sync();
  return list;
}

function setQuickTable(on) {
  state.quickTable = on;
  remember('ft.quick', on ? '1' : '0');
  if (!on) closeQuick();
  renderPanel(); // the button appears / disappears on the open card
}

/** The switches of the public page, and what a visitor gets to see (so the admin knows before anyone does). */
function publicPageSection() {
  const t = currentTree();
  const preview = h('div', { class: 'public-preview' });
  const paint = async () => {
    const teaser = await loadTeaser(true);
    if (!teaser) return put(preview, h('p', { class: 'muted', text: 'الصفحة العامة متوقفة: لا يرى الزوار أي اسم، ولا يمكنهم تقديم طلب انضمام.' }));
    const names = [teaser.root, ...(teaser.children || [])].filter(Boolean);
    put(
      preview,
      h('p', { class: 'muted', text: names.length ? `يرى الزوار هذه الأسماء فقط (${teaser.people_count} في الشجرة، وبقية الأفراد غير ظاهرين):` : 'يرى الزوار نص الصفحة فقط، دون أي اسم.' }),
      names.length > 0 && h('div', { class: 'chips' }, names.map((c, i) => h('span', { class: 'chip', text: `${i === 0 ? 'الجد الأكبر: ' : ''}${c.name}${teaserYears(c) ? ` (${teaserYears(c)})` : ''}` }))),
      teaser.hidden_children > 0 && h('p', { class: 'muted small-note', text: `${teaser.hidden_children} من الصف الأول مخفيون (أحياء).` }),
    );
  };
  const set = async (patch) => {
    await run(async () => {
      const { error } = await sb.from('trees').update(patch).eq('id', state.treeId);
      if (error) throw error;
      Object.assign(currentTree(), patch);
      toast('تم الحفظ');
      await paint();
    });
  };
  paint();
  return h(
    'div',
    {},
    h('div', { class: 'section-title', text: 'الصفحة العامة وطلبات الانضمام' }),
    h(
      'ul',
      { class: 'settings' },
      settingRow({
        title: 'تفعيل الصفحة العامة',
        desc: 'يراها كل من يزور الموقع: الجد الأكبر وأبناؤه المباشرون (الاسم والسنوات فقط)، ويظهر زر «اطلب الانضمام للعائلة». لا يرى الزائر غير ذلك.',
        checked: !!t.public_page,
        onChange: (on, input) => set({ public_page: on }).then(() => (input.checked = !!currentTree().public_page)),
      }),
      settingRow({
        title: 'إظهار الأحياء في الصفحة العامة',
        desc: 'متوقف افتراضيًا: لا يظهر في الصفحة العامة إلا المتوفون. فعّله فقط إن وافق من يظهر اسمه.',
        checked: !!t.public_show_living,
        onChange: (on, input) => set({ public_show_living: on }).then(() => (input.checked = !!currentTree().public_show_living)),
      }),
    ),
    preview,
    h('div', { class: 'modal-foot', style: 'justify-content:flex-start' }, h('button', { class: 'btn small', type: 'button', text: 'نسخ رابط الصفحة العامة', onclick: () => copyText(`${location.origin}${location.pathname}`) })),
  );
}

const FEMALE_MODES = [
  ['full', 'السماح بالإضافة الكاملة', 'تضيف بطاقة المرأة ابنًا أو ابنة كأي بطاقة رجل، ويظهر كل منهم بطاقة في الشجرة.'],
  ['info', 'السماح بإضافة معلومات فقط', 'تُسجَّل معلومات أبناء المرأة في جدول بجانب بطاقتها (القرابة والاسم والتواريخ والمكان وغيرها) دون أن تظهر لهم بطاقات في الشجرة.'],
  ['none', 'عدم السماح', 'لا تُقبل أي إضافة عن أبناء المرأة: لا بطاقات ولا جدول معلومات.'],
];

/** The tree-wide rule for women's cards: the admin picks it, every member sees which one is on. */
function femaleModeChooser() {
  const admin = state.role === 'admin';
  const list = h('div', { class: 'designs', role: 'radiogroup', 'aria-label': 'قاعدة بطاقات الإناث' });
  const buttons = new Map();
  const sync = () => {
    for (const [id, b] of buttons) b.setAttribute('aria-checked', String(id === femaleMode()));
  };
  for (const [id, title, desc] of FEMALE_MODES) {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'design-opt',
        role: 'radio',
        disabled: !admin,
        onclick: async () => {
          await setFemaleMode(id);
          sync();
        },
      },
      h('span', { class: 'design-text' }, h('strong', { text: title }), h('span', { class: 'muted', text: desc })),
    );
    buttons.set(id, b);
    list.append(b);
  }
  sync();
  return h(
    'div',
    {},
    list,
    h('p', { class: 'muted small-note', text: admin ? 'هذه قاعدة للعائلة كلها وتسري على كل الأعضاء. في الوضعين الثاني والثالث تمنع قاعدة البيانات غير المدير من إضافة بطاقة تحت بطاقة امرأة.' : 'هذه قاعدة للعائلة كلها يضبطها مدير الشجرة.' }),
  );
}

async function setFemaleMode(mode) {
  if (mode === femaleMode()) return;
  await run(async () => {
    const { error } = await sb.from('trees').update({ female_card_mode: mode }).eq('id', state.treeId);
    if (error) throw error;
    currentTree().female_card_mode = mode;
    closeQuick();
    rebuild();
    toast('تم حفظ القاعدة');
    const open = state.selectedId && state.index.byId.get(state.selectedId); // the woman whose card is open now
    if (open && showsInfoTable(open)) openQuick(open, 'info', { focus: false });
  });
}

// Thumbnails are fixed markup (no user data): small shapes in the current accent colour.
const THUMB = (inner) => `<svg viewBox="0 0 64 44" width="64" height="44" fill="currentColor" stroke="currentColor" stroke-width="1.2">${inner}</svg>`;
function fanThumb() {
  const cx = 32;
  const cy = 42;
  const pt = (r, deg) => polar(r, deg).map((v, i) => (i ? cy + v : cx + v).toFixed(1));
  const slice = (r0, r1, a0, a1) => {
    const [x1, y1] = pt(r1, a0);
    const [x2, y2] = pt(r1, a1);
    const [x3, y3] = pt(r0, a1);
    const [x4, y4] = pt(r0, a0);
    return `M${x1} ${y1}A${r1} ${r1} 0 0 0 ${x2} ${y2}L${x3} ${y3}A${r0} ${r0} 0 0 1 ${x4} ${y4}Z`;
  };
  const parts = [`<circle cx="${cx}" cy="${cy}" r="8" stroke="none"/>`];
  for (const a0 of [0, 60, 120]) parts.push(`<path fill-opacity="0.2" d="${slice(11, 20, a0 + 1.5, a0 + 58.5)}"/>`);
  for (const a0 of [0, 36, 72, 108, 144]) parts.push(`<path fill-opacity="0.4" d="${slice(23, 31, a0 + 1.5, a0 + 34.5)}"/>`);
  return THUMB(parts.join(''));
}
const DESIGNS = [
  {
    id: 'classic',
    title: 'عمودية كلاسيكية',
    desc: 'مخطط البطاقات: الجد في الأعلى وتحته الأبناء ثم الأحفاد.',
    thumb: THUMB('<rect x="24" y="3" width="16" height="8" rx="2"/><rect x="3" y="26" width="16" height="8" rx="2"/><rect x="24" y="26" width="16" height="8" rx="2"/><rect x="45" y="26" width="16" height="8" rx="2"/><path fill="none" d="M32 11V19M11 19H53M11 19V26M32 19V26M53 19V26"/>'),
  },
  {
    id: 'horizontal',
    title: 'أفقية',
    desc: 'تنمو من اليمين إلى اليسار: الجد على اليمين وتتفرع الأجيال نحو اليسار.',
    thumb: THUMB('<rect x="46" y="18" width="16" height="8" rx="2"/><rect x="22" y="3" width="16" height="8" rx="2"/><rect x="22" y="18" width="16" height="8" rx="2"/><rect x="22" y="33" width="16" height="8" rx="2"/><path fill="none" d="M46 22H42M42 7V37M42 7H38M42 22H38M42 37H38"/>'),
  },
  {
    id: 'fan',
    title: 'مروحة نصف دائرية',
    desc: 'الجد في المركز وكل جيل حلقة حوله. تناسب الطباعة والعائلات الصغيرة. اضغط على الشريحة المحددة مرة ثانية لطيّ فرعها.',
    thumb: fanThumb(),
  },
  {
    id: 'tree',
    title: 'شجرة طبيعية',
    desc: 'جذع وأغصان: الجد في الأسفل والأجيال أوراق في الأعلى، وهي أجمل للعرض والتذكار.',
    thumb: THUMB('<path fill="none" stroke-width="4" d="M32 43V31"/><path fill="none" d="M32 31C32 25 14 25 14 17M32 31C32 25 50 25 50 17M32 31V13"/><rect x="6" y="10" width="16" height="8" rx="4"/><rect x="24" y="5" width="16" height="8" rx="4"/><rect x="42" y="10" width="16" height="8" rx="4"/>'),
  },
];

/** A group of buttons of which exactly one is pressed: [[value, label], …] */
function choiceGroup(label, options, current, onPick) {
  const seg = h('div', { class: 'seg full', role: 'group', 'aria-label': label });
  const buttons = new Map();
  const sync = (value) => {
    for (const [v, b] of buttons) b.setAttribute('aria-pressed', String(v === value));
  };
  for (const [value, text] of options) {
    const b = h('button', { type: 'button', text, onclick: () => (onPick(value), sync(value)) });
    buttons.set(value, b);
    seg.append(b);
  }
  sync(current);
  return seg;
}

function designChooser() {
  const list = h('div', { class: 'designs', role: 'radiogroup', 'aria-label': 'شكل الشجرة' });
  const buttons = new Map();
  const sync = () => {
    for (const [id, b] of buttons) b.setAttribute('aria-checked', String(id === state.design));
  };
  DESIGNS.forEach((d, i) => {
    const thumb = h('span', { class: 'thumb', 'aria-hidden': 'true' });
    thumb.innerHTML = d.thumb;
    const b = h(
      'button',
      {
        type: 'button',
        class: 'design-opt',
        role: 'radio',
        onclick: () => {
          setDesign(d.id);
          sync();
        },
      },
      thumb,
      h('span', { class: 'design-text' }, h('strong', { text: `${i + 1} · ${d.title}` }), h('span', { class: 'muted', text: d.desc })),
    );
    buttons.set(d.id, b);
    list.append(b);
  });
  sync();
  return list;
}

function settingRow({ title, desc, checked, onChange }) {
  const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch', id: `st${++fieldSeq}` });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked, input));
  return h(
    'li',
    { class: 'setting' },
    h('label', { class: 'setting-text', for: input.id }, h('strong', { text: title }), h('span', { class: 'muted', text: desc })),
    input,
  );
}

// ---------- invitations (always for ONE e-mail address, single use) ----------

/** The invitation the admin just created, shown once at the top of the dialog. */
let lastInviteResult = null;

function mailtoOpenInvite(url, label) {
  return `mailto:?subject=${encodeURIComponent('دعوة للانضمام إلى شجرة العائلة')}&body=${encodeURIComponent(openInviteMessage(url, label))}`;
}

function mailtoInvite(email, url, what) {
  const subject = encodeURIComponent('دعوة للانضمام إلى شجرة العائلة');
  const body = encodeURIComponent(
    `تمت دعوتك إلى شجرة العائلة.\n${what}\n\nافتح الرابط التالي وسجّل الدخول بنفس هذا البريد (${email}):\n${url}\n\nالرابط مخصص لهذا البريد فقط ويُستخدم مرة واحدة.`,
  );
  return `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
}

function inviteResultNode(r, { whatsapp = null } = {}) {
  const input = h('input', { type: 'text', readonly: true, value: r.url, dir: 'ltr', 'aria-label': 'رابط الدعوة' });
  input.addEventListener('focus', () => input.select());
  const open = !r.email; // a link that is not tied to an e-mail (supabase/013)
  const wa = whatsapp || (open ? whatsappShare(openInviteMessage(r.url, r.label)) : null);
  return h(
    'div',
    { class: 'notice' },
    h('strong', { text: 'تم إنشاء الدعوة' }),
    h('p', {
      text: open
        ? `هذا رابط لشخص واحد${r.label ? ` (${r.label})` : ''} لا يرتبط ببريد: أول من يفتحه وينشئ حسابه ببريده الخاص يدخل الشجرة بدور «قارئ»، ثم ينتهي الرابط. أرسله للشخص المقصود وحده، فمن يصل إليه أولًا يستخدمه.`
        : `هي مخصصة للبريد ${r.email} وحده: لا يعمل الرابط إلا إذا سجّل الشخص الدخول بهذا البريد، وينتهي بعد أول استخدام. أرسله له الآن.`,
    }),
    input,
    h(
      'div',
      { class: 'modal-foot', style: 'justify-content:flex-start' },
      h('button', { class: 'btn small primary', type: 'button', onclick: () => copyText(r.url), text: 'نسخ الرابط' }),
      h('a', { class: 'btn small', href: open ? mailtoOpenInvite(r.url, r.label) : mailtoInvite(r.email, r.url, r.what), text: 'إرسال بالبريد' }),
      wa && h('a', { class: 'btn small', href: wa, target: '_blank', rel: 'noopener', text: 'إرسال عبر واتساب' }),
    ),
  );
}

/** The same as inviteWhat(), with the branch name as a link. */
function inviteWhatNode(iv) {
  const branch = iv.branch_person_id ? state.index.byId.get(iv.branch_person_id) : null;
  if (!branch) return inviteWhat(iv);
  return ['فرع «', branchLink(branch), `»: ${rightsText({ add: iv.can_add, edit: iv.can_edit, delete: iv.can_delete, grant: iv.can_grant })}`];
}

/** What an invitation gives, in words. */
function inviteWhat(iv) {
  const branch = iv.branch_person_id ? state.index.byId.get(iv.branch_person_id) : null;
  return branch
    ? `فرع «${fullName(branch)}»: ${rightsText({ add: iv.can_add, edit: iv.can_edit, delete: iv.can_delete, grant: iv.can_grant })}`
    : `${ROLE_LABEL[iv.role]} في الشجرة كلها`;
}

function inviteRow(iv, refresh, nameOf = null) {
  const used = iv.uses >= iv.max_uses;
  const pending = iv.enabled && !used;
  const who = used && iv.used_by && nameOf ? nameOf(iv.used_by) : null; // who joined with it
  const status = used ? `استُخدمت${who ? ` بواسطة ${who}` : ''}` : pending ? 'بانتظار القبول' : 'مُلغاة';
  const what = inviteWhat(iv);
  const open = !iv.email; // a link that is not tied to an e-mail
  const url = inviteUrl(iv.code);
  return h(
    'li',
    {},
    h('span', { class: 'grow' }, h('strong', { text: open ? `رابط بلا بريد${iv.label ? ` — ${iv.label}` : ''}` : iv.email }), h('small', { class: 'muted', style: 'display:block' }, inviteWhatNode(iv), ` · ${status}`)),
    pending && h('button', { class: 'btn small', type: 'button', onclick: () => copyText(url), text: 'نسخ الرابط' }),
    pending && open && h('a', { class: 'btn small', href: whatsappShare(openInviteMessage(url, iv.label)), target: '_blank', rel: 'noopener', text: 'واتساب' }),
    pending && h('a', { class: 'btn small', href: open ? mailtoOpenInvite(url, iv.label) : mailtoInvite(iv.email, url, what), text: 'بريد' }),
    pending &&
      h('button', {
        class: 'btn small danger',
        type: 'button',
        text: 'إلغاء',
        onclick: () =>
          run(async () => {
            const { error } = await sb.from('tree_invites').update({ enabled: false }).eq('code', iv.code);
            if (error) throw error;
            await refresh();
          }),
      }),
  );
}

/**
 * Invite people and hand out rights on the branch under this person.
 * Admin: any card. A reader holding the "grant" right: only cards below theirs, and only the
 * rights they hold. The rules themselves live in the database (supabase/003_*.sql).
 */
async function openBranchAccess(person) {
  lastInviteResult = null;
  const body = h('div', {}, h('p', { class: 'muted', text: 'جارٍ التحميل…' }));
  modal(`دعوة وصلاحيات فرع ${fullName(person)}`, body);
  await renderBranchAccess(body, person);
}

async function renderBranchAccess(body, person) {
  try {
    const name = fullName(person);
    const allowed = state.perms.delegableFlags(person); // the rights I may pass on here
    if (!allowed) throw new Error('not allowed to grant');
    const [mem, gr, inv] = await Promise.all([
      sb.from('tree_members').select('user_id, role, profile:profiles(display_name)').eq('tree_id', state.treeId).order('joined_at'),
      sb.from('branch_grants').select('user_id, can_add, can_edit, can_delete, can_grant, created_by').eq('tree_id', state.treeId).eq('person_id', person.id),
      sb.from('tree_invites').select('*').eq('tree_id', state.treeId).eq('branch_person_id', person.id).order('created_at'),
    ]);
    for (const r of [mem, gr, inv]) if (r.error) throw r.error;
    const nameOf = (uid) => mem.data.find((m) => m.user_id === uid)?.profile?.display_name || 'بدون اسم';
    const refresh = () => renderBranchAccess(body, person);

    // rights to give: shared by "invite a new person" and "give to an existing member"
    const seq = ++fieldSeq;
    const boxes = {};
    const rightsRow = h(
      'div',
      { class: 'rights' },
      FLAGS.map((f) => {
        const cb = h('input', { type: 'checkbox', id: `rg${seq}${f}` });
        cb.checked = allowed[f] && (f === 'add' || f === 'edit');
        cb.disabled = !allowed[f];
        boxes[f] = cb;
        return h('label', { class: 'right', for: cb.id, title: allowed[f] ? '' : 'لا تملك هذه الصلاحية لتمنحها' }, cb, FLAG_LABEL[f]);
      }),
    );
    const rpcArgs = (extra) => ({ p_tree: state.treeId, p_person: person.id, p_add: boxes.add.checked, p_edit: boxes.edit.checked, p_delete: boxes.delete.checked, p_grant: boxes.grant.checked, ...extra });

    // --- invite a new person by e-mail
    const email = h('input', { type: 'email', required: true, placeholder: 'البريد الإلكتروني للشخص المدعو', autocomplete: 'off', dir: 'ltr', 'aria-label': 'البريد الإلكتروني' });
    const inviteForm = h('form', { class: 'inline-form' }, email, h('button', { class: 'btn primary small', type: 'submit', text: 'إنشاء الدعوة' }));
    inviteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      run(async () => {
        const { data: code, error } = await sb.rpc('create_branch_invite', { p_tree: state.treeId, p_person: person.id, p_email: email.value, p_add: boxes.add.checked, p_edit: boxes.edit.checked, p_delete: boxes.delete.checked, p_grant: boxes.grant.checked });
        if (error) throw error;
        const addr = email.value.trim().toLowerCase();
        lastInviteResult = { email: addr, url: inviteUrl(code), what: inviteWhat({ branch_person_id: person.id, ...Object.fromEntries(FLAGS.map((f) => [`can_${f}`, boxes[f].checked])) }) };
        await refresh();
      });
    });

    // --- give rights to someone who already is a reader of the tree
    const granted = new Set(gr.data.map((g) => g.user_id));
    const candidates = mem.data.filter((m) => m.role === 'viewer' && !granted.has(m.user_id) && m.user_id !== state.user.id);
    const pick = h('select', { 'aria-label': 'عضو' }, candidates.map((m) => h('option', { value: m.user_id, text: m.profile?.display_name || 'بدون اسم' })));
    const giveForm = h('form', { class: 'inline-form' }, pick, h('button', { class: 'btn small', type: 'submit', text: 'منح الصلاحية' }));
    giveForm.addEventListener('submit', (e) => {
      e.preventDefault();
      run(async () => {
        const { error } = await sb.rpc('grant_branch', rpcArgs({ p_user: pick.value }));
        if (error) throw error;
        toast('تم منح الصلاحية');
        await refresh();
      });
    });

    // --- who holds rights here now (each right can be switched on/off)
    const holderRow = (g) =>
      h(
        'li',
        { class: 'holder' },
        h('span', { class: 'grow' }, h('strong', { text: nameOf(g.user_id) }), h('small', { class: 'muted', style: 'display:block', text: g.created_by === state.user.id ? 'منحتها أنت' : 'منحها غيرك' })),
        h(
          'div',
          { class: 'rights mini' },
          FLAGS.map((f) => {
            const cb = h('input', { type: 'checkbox' });
            cb.checked = !!g[`can_${f}`];
            cb.addEventListener('change', () =>
              run(async () => {
                const next = Object.fromEntries(FLAGS.map((k) => [k, k === f ? cb.checked : !!g[`can_${k}`]]));
                const { error } = await sb.rpc('grant_branch', { p_tree: state.treeId, p_person: person.id, p_user: g.user_id, p_add: next.add, p_edit: next.edit, p_delete: next.delete, p_grant: next.grant });
                if (error) throw error;
                g[`can_${f}`] = cb.checked;
                toast('تم تحديث الصلاحيات');
              }).catch(() => {}).finally(() => refresh()),
            );
            return h('label', { class: 'right' }, cb, FLAG_LABEL[f].split(' ')[0]);
          }),
        ),
        h('button', {
          class: 'btn small danger',
          type: 'button',
          text: 'سحب',
          onclick: async () => {
            if (!(await confirmBox('سحب الصلاحية', `ستفقد ${nameOf(g.user_id)} كل صلاحياته على فرع «${name}».`, 'سحب', true))) return;
            await run(async () => {
              const { error } = await sb.rpc('revoke_branch', { p_tree: state.treeId, p_user: g.user_id, p_person: person.id });
              if (error) throw error;
              toast('تم سحب الصلاحية');
              await refresh();
            });
          },
        }),
      );

    put(body, 
      h('p', {}, `كل من تمنحه صلاحية هنا يستطيع التصرف فقط في من يندرج تحت «${name}». لا يستطيع تعديل بطاقة «${name}» نفسها، ولا أي بطاقة أعلى منها، ولا أي فرع آخر. ويقرأ بقية الشجرة دون تعديل.`),
      lastInviteResult && inviteResultNode(lastInviteResult),
      h('div', { class: 'section-title', text: 'الصلاحيات الممنوحة' }),
      rightsRow,
      h('p', { class: 'muted small-note', text: 'إضافة: أشخاص جدد تحت هذا الاسم وأزواجهم. تعديل: بطاقاتهم. حذف: من لا أبناء له فقط. منح: دعوة آخرين داخل الفروع التي تحته بنفس صلاحياته أو أقل.' }),
      h('div', { class: 'section-title', text: 'دعوة شخص جديد' }),
      inviteForm,
      h('p', { class: 'muted small-note', text: 'الدعوة لبريد واحد محدد فقط، ولا يعمل رابطها مع أي بريد آخر.' }),
      candidates.length > 0 && h('div', { class: 'section-title', text: 'أو امنح عضوًا موجودًا' }),
      candidates.length > 0 && giveForm,
      h('div', { class: 'section-title', text: 'أصحاب الصلاحية على هذا الفرع' }),
      gr.data.length ? h('ul', { class: 'list' }, gr.data.map(holderRow)) : h('p', { class: 'muted', text: 'لا أحد بعد.' }),
      inv.data.length > 0 && h('div', { class: 'section-title', text: 'الدعوات' }),
      inv.data.length > 0 && h('ul', { class: 'list' }, inv.data.map((iv) => inviteRow(iv, refresh, nameOf))),
    );
  } catch (ex) {
    put(body, h('p', { class: 'error', text: friendly(ex) }));
  }
}

/** Settings are stored in this browser only (not shared with the rest of the family). */
function openSettings() {
  const isAdmin = state.role === 'admin' && !DEMO;
  const asAdmin = state.role === 'admin' && hasBackend(); // the one who decides the default look and the rule for women's cards
  const reopen = () => (dlg.close(), openSettings());
  const dlg = modal(
    'الإعدادات',
    h(
      'div',
      {},
      h('div', { class: 'section-title', text: 'المظهر والشكل العام' }),
      h('p', {
        class: 'muted small-note',
        text: asAdmin
          ? 'ما تغيّره هنا وفي قسم «بطاقات الإناث» يصير الشكل الافتراضي لكل أعضاء الشجرة الذين لم يخصّصوا شكلًا لأنفسهم، وتراه أنت حالًا. ومن خصّص شكلًا لنفسه يبقى شكله.'
          : hasBackend()
            ? 'ما تغيّره هنا وفي قسم «بطاقات الإناث» يظهر عندك أنت فقط ويبقى معك على كل أجهزتك. الشكل الافتراضي يحدده مدير الشجرة، ويعيدك إليه زر «العودة إلى الافتراضي».'
            : 'ما تغيّره هنا يظهر عندك أنت فقط ويبقى في هذا المتصفح. ويعيدك زر «العودة إلى الافتراضي» إلى الشكل الأصلي.',
      }),
      h('div', { class: 'sub-title', text: 'شكل الشجرة' }),
      designChooser(),
      h('div', { class: 'sub-title', text: 'شكل البطاقة' }),
      cardStyleChooser(),
      h('div', { class: 'sub-title', text: 'سمة الألوان' }),
      choiceGroup('سمة الألوان', [['auto', 'تلقائي (حسب الجهاز)'], ['light', 'فاتح'], ['dark', 'داكن']], state.theme, setTheme),
      h('p', { class: 'muted small-note', text: 'هذا الخيار لك وحدك دائمًا (حتى للمدير). وفي الشريط العلوي زر الشمس والقمر للتبديل السريع بين الفاتح والداكن.' }),
      h('div', { class: 'sub-title', text: 'خيارات العرض' }),
      h(
        'ul',
        { class: 'settings' },
        settingRow({
          title: 'ألوان الفروع',
          desc: 'كل ابن من أبناء الجد الأعلى له لون، ويتبعه كل أبنائه وأحفاده بنفس اللون. تعمل مع كل الأشكال.',
          checked: state.branchColors,
          onChange: setBranchColors,
        }),
        settingRow({
          title: 'الاسم الثلاثي في البطاقة',
          desc: 'يظهر على البطاقة اسم الشخص ثم اسم أبيه ثم العائلة، مثل: عبد الله يحيى هرموش. عند الإيقاف يظهر الاسم والعائلة فقط.',
          checked: state.tripleName,
          onChange: setTripleName,
        }),
        settingRow({
          title: 'أشرطة الأجيال',
          desc: 'شريط خلف كل جيل مكتوب عليه الجيل الأول والثاني… يعمل مع الشكل العمودي الكلاسيكي فقط.',
          checked: state.bands,
          onChange: setBands,
        }),
        settingRow({
          title: 'سنوات الميلاد والوفاة',
          desc: 'تظهر سنة الميلاد والوفاة بوضوح في كل بطاقة، تحت الاسم (واللقب إن وُجد). وعند الإيقاف تصغر البطاقات قليلًا.',
          checked: state.showYears,
          onChange: setShowYears,
        }),
        settingRow({
          title: 'خطوط منحنية',
          desc: 'الخطوط بين البطاقات منحنية. عند الإيقاف تعود بزوايا قائمة. تعمل مع الشكلين العمودي والأفقي.',
          checked: state.curves,
          onChange: setCurves,
        }),
        settingRow({
          title: 'زرّا «إضافة» و«عرض» على البطاقة',
          desc: '«عرض» يفتح بيانات الشخص، و«إضافة» يفتح اختيار القرابة (والد، زوج، أخ، ابن). عند الإيقاف تصغر البطاقات وتضغط عليها لتفتح بياناتها كما قبل.',
          checked: state.cardButtons,
          onChange: setCardButtons,
        }),
      ),
      h(
        'div',
        { class: 'modal-foot', style: 'justify-content:flex-start' },
        h('button', { class: 'btn small', type: 'button', text: 'العودة إلى الافتراضي', onclick: () => resetLook(reopen) }),
      ),
      h('p', { class: 'muted small-note', text: asAdmin ? 'يعيد الشكل الافتراضي للشجرة إلى الأصلي (هذا القسم وقسم بطاقات الإناث).' : 'يمسح اختياراتك في هذا القسم وفي قسم بطاقات الإناث، فتعود إلى ما حدده المدير.' }),

      asAdmin && publicPageSection(),

      h('div', { class: 'section-title', text: 'بطاقات الإناث' }),
      h(
        'ul',
        { class: 'settings' },
        settingRow({
          title: 'إظهار الإناث في الشجرة',
          desc: 'عند الإيقاف تُخفى بطاقات النساء (وكل ما يظهر تحتها إن وُجد) وأسماء الزوجات، لترى خط الذكور فقط. تبقى بطاقاتهن وبياناتهن في الشجرة ويمكن البحث عنهن.',
          checked: state.showFemales,
          onChange: setShowFemales,
        }),
        settingRow({
          title: 'عرض أسماء الزوجات',
          desc: 'تظهر أسماء الزوجات كنص تحت بطاقة الزوج: الزوجة الأولى، الزوجة الثانية… تعمل مع الشكلين العمودي والأفقي، وفي بقية الأشكال تجدها في بطاقة الشخص.',
          checked: state.showWives,
          onChange: setShowWives,
        }),
        settingRow({
          title: 'ألوان الزوجات وأبنائهن',
          desc: 'عندما يكون لرجل أكثر من زوجة تظهر دائرة صغيرة بلون بجانب اسم كل زوجة، وتأخذ خطوط أبنائها وإطار بطاقاتهم اللون نفسه. ويُرتَّب الأبناء مجموعات حسب الأم.',
          checked: state.wifeColors,
          onChange: setWifeColors,
        }),
      ),
      h('p', { class: 'muted small-note', text: 'هذان الخياران من الشكل، يتغيران عندك وحدك (والمدير يحدد الافتراضي).' }),
      asAdmin && h('div', { class: 'sub-title', text: 'السماح بإضافة بطاقات فرعية للأنثى (قاعدة الشجرة كلها)' }),
      asAdmin && femaleModeChooser(),
      h('div', { class: 'section-title', text: 'البطاقات' }),
      h(
        'ul',
        { class: 'settings' },
        settingRow({
          title: 'إضافة سريعة عبر جدول',
          desc: 'عند التفعيل يظهر في بطاقة الشخص زر «إضافة سريعة (جدول)». يفتح جدولًا بجانب البطاقة تكتب فيه عدة أبناء أو زوجات دفعة واحدة: القرابة، الاسم، تاريخ الميلاد، تاريخ الوفاة.',
          checked: state.quickTable,
          onChange: setQuickTable,
        }),
      ),

      h('p', { class: 'muted small-note', text: 'قوائم المحافظات والمدن بلغة كل بلد: العربية للدول العربية، والتركية لتركيا، والألمانية لألمانيا، وهكذا. وما لا يتوفر بلغته الأصلية فبالإنجليزية، من قاعدة بيانات مفتوحة «countries-states-cities-database» بترخيص ODbL.' }),

      installSection(),
      !DEMO && offlineSection(), // a copy only exists for the real tree

      h('div', { class: 'section-title', text: 'النسخ الاحتياطي' }),
      h('p', { class: 'muted', text: 'نزّل نسخة كاملة من الشجرة متى شئت (الأشخاص والزيجات، دون الصور). ملف JSON يعيده هذا البرنامج بدقة، وملف GEDCOM تفهمه برامج الأنساب الأخرى.' }),
      h(
        'div',
        { class: 'modal-foot', style: 'justify-content:flex-start' },
        h('button', { class: 'btn small', type: 'button', onclick: () => exportTree('json'), text: 'تنزيل JSON' }),
        h('button', { class: 'btn small', type: 'button', onclick: () => exportTree('ged'), text: 'تنزيل GEDCOM' }),
        isAdmin && h('button', { class: 'btn small', type: 'button', onclick: openImport, text: 'استيراد من ملف…' }),
      ),
    ),
  );
}

function exportTree(kind) {
  const persons = [...state.persons.values()];
  const marriages = [...state.marriages.values()];
  const treeName = state.memberships.find((m) => m.tree.id === state.treeId)?.tree.name;
  const stamp = new Date().toISOString().slice(0, 10);
  if (kind === 'json') downloadText(`family-tree-${stamp}.json`, JSON.stringify(toJson(persons, marriages, { treeName }), null, 2), 'application/json');
  else downloadText(`family-tree-${stamp}.ged`, toGedcom(persons, marriages, { treeName }), 'text/plain');
  toast('تم تنزيل النسخة');
}

/**
 * Admin: add people from a JSON backup or a GEDCOM file to THIS tree. Nothing is deleted or
 * merged: people already in the tree would appear twice, so the preview says what will happen.
 * Every chunk is one logged action and can be undone from the history.
 */
function openImport() {
  let plan = null;
  const status = h('div', { class: 'muted' });
  const err = h('div', { class: 'error', role: 'alert' });
  const bar = h('div', { class: 'progress', hidden: true }, h('i'));
  const confirmBox_ = h('input', { type: 'checkbox', id: 'imp-ok' });
  const go = h('button', { class: 'btn primary', type: 'button', text: 'بدء الاستيراد', disabled: true });
  const file = h('input', { type: 'file', accept: '.json,.ged,.gedcom,.txt,application/json' });
  const preview = h('div', { class: 'stack' });

  const refreshGo = () => (go.disabled = !plan || !confirmBox_.checked);
  confirmBox_.addEventListener('change', refreshGo);

  file.addEventListener('change', async () => {
    err.textContent = '';
    preview.replaceChildren();
    plan = null;
    refreshGo();
    const f = file.files[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) return (err.textContent = 'الملف كبير جدًا (الحد 20 ميغابايت)');
    try {
      const text = await f.text();
      const model = text.trimStart().startsWith('{') ? fromJson(text) : fromGedcom(text);
      plan = planImport(model);
      put(preview, 
        h('div', { class: 'notice' }, h('strong', { text: `سيُضاف ${plan.stats.persons} شخصًا و${plan.stats.marriages} سجل زواج.` })),
        ...plan.warnings.map((w) => h('p', { class: 'muted small-note', text: `• ${w}` })),
        h('p', { class: 'muted small-note', text: `الشجرة الحالية فيها ${state.persons.size} شخصًا. لا يُحذف شيء ولا يُدمج: إن كان الملف يحوي أشخاصًا موجودين أصلًا فسيظهرون مرتين.` }),
        h('label', { class: 'check', for: 'imp-ok' }, confirmBox_, 'أفهم ذلك وأريد إضافتهم إلى هذه الشجرة'),
      );
    } catch (ex) {
      err.textContent = friendly(ex);
    }
  });

  go.addEventListener('click', () =>
    run(async () => {
      go.disabled = file.disabled = true;
      bar.hidden = false;
      const fill = bar.firstChild;
      const pChunks = chunk(plan.personRows);
      const mChunks = chunk(plan.marriageRows);
      const total = pChunks.length + mChunks.length;
      let done = 0;
      let added = 0;
      try {
        for (const part of pChunks) {
          const { error } = await sb.from('persons').insert(part.map((r) => ({ tree_id: state.treeId, ...r })));
          if (error) throw error;
          added += part.length;
          fill.style.width = `${(++done / total) * 100}%`;
          status.textContent = `أُضيف ${added} من ${plan.stats.persons}…`;
        }
        for (const part of mChunks) {
          const { error } = await sb.from('marriages').insert(part.map((r) => ({ tree_id: state.treeId, ...r })));
          if (error) throw error;
          fill.style.width = `${(++done / total) * 100}%`;
        }
      } catch (ex) {
        await loadTreeData();
        rebuild();
        throw new Error(`توقف الاستيراد بعد إضافة ${added} شخصًا: ${friendly(ex)}. ما أُضيف يظهر في سجل التعديلات ويمكن التراجع عنه.`);
      }
      await loadTreeData();
      rebuild();
      chart.focusTop();
      toast(`تم استيراد ${plan.stats.persons} شخصًا`);
      dlg.close();
    }).finally(() => {
      file.disabled = false;
      refreshGo();
    }),
  );

  const dlg = modal(
    'استيراد شجرة من ملف',
    h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted', text: 'اختر نسخة JSON نزّلتها من هذا البرنامج، أو ملف GEDCOM (‎.ged) من برنامج أنساب آخر. يجب أن يكون الملف بترميز UTF-8.' }),
      h('div', { class: 'file-drop' }, file),
      preview,
      err,
      bar,
      status,
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close(), text: 'إغلاق' }), go),
    ),
    { backdropClose: false },
  );
}

function onToggle(id) {
  chart.keepInPlace(id, () => {
    if (state.collapsed.has(id)) state.collapsed.delete(id);
    else state.collapsed.add(id);
    rebuild();
  });
}

// ====================================================================
// main screen
// ====================================================================

/** Whole-tree editing (admin / editor). Per-person rights live in state.perms. */
const canEditAll = () => state.role === 'admin' || state.role === 'editor';

/** The phone's "المزيد": what is not in the bottom bar. */
function openMore() {
  const item = (name, label, fn) => h('button', { class: 'more-item', type: 'button', onclick: () => (dlg.close(), fn()) }, icon(name), h('span', { text: label }));
  const dark = isDarkNow();
  const dlg = modal(
    'المزيد',
    h(
      'div',
      { class: 'more-list' },
      hasBackend() && item('history', 'السجل', openHistory),
      item('printer', 'طباعة الشجرة', printTree),
      item('grid', 'تصدير إلى Excel', exportTreeXlsx),
      item(dark ? 'moon' : 'sun', dark ? 'الألوان داكنة: اجعلها فاتحة' : 'الألوان فاتحة: اجعلها داكنة', () => setTheme(dark ? 'light' : 'dark')),
      item('settings', 'الإعدادات', openSettings),
      item('info', 'عن المصمم', openAbout),
      OFFLINE ? item('refresh', 'إعادة الاتصال', leaveOffline) : item('logout', 'خروج', signOut),
    ),
  );
}

function mountMain(treeName) {
  const treePicker =
    state.memberships.length > 1
      ? h(
          'select',
          { class: 'tree-select', 'aria-label': 'الشجرة', onchange: (e) => openTree(e.target.value) },
          state.memberships.map((m) => {
            const o = h('option', { value: m.tree.id, text: m.tree.name });
            o.selected = m.tree.id === state.treeId;
            return o;
          }),
        )
      : h('strong', { text: treeName });

  const search_ = h('input', { type: 'search', placeholder: 'ابحث عن شخص…', 'aria-label': 'بحث', autocomplete: 'off' });
  const results = h('ul', { class: 'results' });
  results.hidden = true;
  const renderResults = () => {
    const q = search_.value.trim();
    if (!q) return (results.hidden = true);
    const res = search(state.index, q, { limit: 12 });
    put(results, 
      ...(res.length
        ? res.map((p) =>
            h(
              'li',
              {},
              h('button', {
                type: 'button',
                text: describe(state.index, p),
                onclick: () => {
                  results.hidden = true;
                  search_.value = '';
                  focusPerson(p.id);
                },
              }),
            ),
          )
        : [h('li', { class: 'empty', text: 'لا توجد نتائج' })]),
    );
    results.hidden = false;
  };
  search_.addEventListener('input', renderResults);
  search_.addEventListener('focus', renderResults);
  search_.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') (results.hidden = true), search_.blur();
    if (e.key === 'Enter') results.querySelector('button')?.click();
  });

  // every button shows its name under the icon
  const tbBtn = (name, label, onclick, title = label) =>
    h('button', { class: 'tb-btn', type: 'button', title, 'aria-label': title, onclick }, icon(name), h('span', { class: 'lbl', text: label }));
  const zoomBtn = (name, label, onclick, title = label) =>
    h('button', { class: 'zoom-btn', type: 'button', title, 'aria-label': title, onclick }, icon(name), h('span', { class: 'lbl', text: label }));

  // the sun / moon: a tap turns the colours light or dark (what it shows is what the screen is now)
  const themeBtn = h('button', { class: 'tb-btn theme-btn', type: 'button', onclick: () => setTheme(isDarkNow() ? 'light' : 'dark') });
  syncThemeBtn = () => {
    const dark = isDarkNow();
    const word = dark ? 'داكن' : 'فاتح';
    const tip = dark ? 'الألوان الآن داكنة: اضغط لتصير فاتحة' : 'الألوان الآن فاتحة: اضغط لتصير داكنة';
    themeBtn.title = tip;
    themeBtn.setAttribute('aria-label', tip);
    put(themeBtn, icon(dark ? 'moon' : 'sun'), h('span', { class: 'lbl', text: word }));
  };
  syncThemeBtn();

  const bellBadge = h('span', { class: 'badge-dot', hidden: true });
  const bell = h('button', { class: 'tb-btn bell', type: 'button', 'aria-label': 'صندوق الوارد', title: 'صندوق الوارد: طلبات الصلاحية وبلاغات الأخطاء', onclick: openInbox }, icon('bell'), h('span', { class: 'lbl', text: 'الوارد' }), bellBadge);

  // the bar at the foot of a phone (css shows it on narrow screens only; the buttons above stay for the other screens)
  const navBadge = h('span', { class: 'badge-dot', hidden: true });
  const navBtn = (name, label, onclick, badge = null) => h('button', { class: 'bn-btn', type: 'button', 'aria-label': label, onclick }, icon(name), h('span', { class: 'lbl', text: label }), badge);
  const bottomNav = h(
    'nav',
    { class: 'bottom-nav', 'aria-label': 'التنقل' },
    navBtn('tree', 'الشجرة', () => {
      select(null);
      chart.setSelected(null);
      renderPanel();
      chart.focusTop();
    }),
    navBtn('filter', 'بحث', openSearchPage),
    (!DEMO || FAKE_BACKEND) && navBtn('users', 'المشاركة', openShare),
    hasBackend() && navBtn('bell', 'الوارد', openInbox, navBadge),
    navBtn('menu', 'المزيد', openMore),
  );

  const viewport = h('div', { class: 'viewport' });
  const loading = h('div', { class: 'loading', text: 'جارٍ تحميل الشجرة…' });
  viewport.append(loading);
  const zoom = h(
    'div',
    { class: 'zoom' },
    zoomBtn('plus', 'تكبير', () => chart.zoomBy(1.3)),
    zoomBtn('minus', 'تصغير', () => chart.zoomBy(1 / 1.3)),
    zoomBtn('fit', 'عرض الكل', () => chart.fit(), 'عرض الشجرة كاملة'),
    zoomBtn('home', 'الجذر', () => state.index.list.length && setRoot(defaultRoot(state.index)), 'العودة إلى جذر الشجرة'),
  );
  zoom.hidden = true;

  const empty = h(
    'div',
    { class: 'empty-state' },
    h('h2', { text: 'الشجرة فارغة' }),
    h('p', { class: 'muted', text: canEditAll() ? 'ابدأ بإضافة أقدم شخص تعرفه في العائلة، ثم أضف أبناءه وأزواجه.' : 'لم يُضَف أحد بعد.' }),
    canEditAll() && h('button', { class: 'btn primary', type: 'button', onclick: addFirstPerson, text: 'إضافة أول شخص' }),
    state.role === 'admin' && !DEMO && h('button', { class: 'btn', type: 'button', onclick: openImport, text: 'أو استيراد شجرة من ملف' }),
  );
  empty.hidden = true;

  const panel = h('aside', { class: 'panel', 'aria-label': 'تفاصيل الشخص' });
  panel.hidden = true;
  const quick = h('div', { class: 'quick', role: 'region', 'aria-label': 'إضافة سريعة بجدول' });
  quick.hidden = true;

  mount(
    OFFLINE &&
      h(
        'div',
        { class: 'offline-banner', role: 'status' },
        h('span', { text: `نسخة محفوظة دون اتصال، للقراءة فقط · آخر تحديث: ${fmtDate(new Date(state.offlineAt).toISOString())}` }),
        h('button', { class: 'btn small', type: 'button', onclick: leaveOffline, text: 'إعادة الاتصال' }),
      ),
    h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('tree')), treePicker),
      h('div', { class: 'search' }, icon('search'), search_, results),
      h('div', { class: 'spacer' }),
      h(
        'div',
        { class: 'tb-actions' },
        hasBackend() && bell,
        tbBtn('filter', 'بحث وتصفية', openSearchPage, 'بحث وتصفية (بالاسم أو البلد أو المدينة)'),
        (!DEMO || FAKE_BACKEND) && tbBtn('users', 'المشاركة', openShare, 'المشاركة والأعضاء'),
        (!DEMO || FAKE_BACKEND) && tbBtn('history', 'السجل', openHistory, 'سجل التعديلات'),
        tbBtn('printer', 'طباعة', printTree, 'طباعة الشجرة المعروضة'),
        tbBtn('grid', 'Excel', exportTreeXlsx, 'تصدير الشجرة المعروضة إلى Excel'),
        themeBtn,
        tbBtn('settings', 'الإعدادات', openSettings),
        tbBtn('info', 'عن المصمم', openAbout, ABOUT_TITLE),
        OFFLINE ? tbBtn('refresh', 'اتصال', leaveOffline, 'إعادة الاتصال والعودة إلى الشجرة الكاملة') : tbBtn('logout', 'خروج', signOut, DEMO ? 'خروج من العرض التجريبي' : 'تسجيل الخروج'),
      ),
    ),
    h('div', { class: 'main' }, viewport, zoom, empty, quick, panel),
    bottomNav,
  );

  ui = { viewport, loading, zoom, empty, panel, quick, results, bellBadge, navBadge };
  chart = new Chart(viewport, {
    onSelect,
    onToggle,
    onAction,
    onDoubleTap: (id) => chart.centerOn(id, { insetBottom: sheetInset(), zoom: 1 }), // the sheet of the card (phone) must not cover it
  });
  chart.personOf = (id) => state.index.byId.get(id);
  chart.nameOf = displayName;
  chart.canAdd = (id) => {
    const p = state.index.byId.get(id);
    return !!p && hasBackend() && Object.values(addOptions(p)).some((o) => o.ok);
  };
  chart.photoUrl = (p) => photos?.url(p.photo_url);
}

document.addEventListener('click', (e) => {
  if (ui.results && !e.target.closest('.search')) ui.results.hidden = true;
});

// ---------- ancestors, Excel, printing ----------

const fileSafe = (s) => String(s || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'شجرة';

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const today = () => new Date().toISOString().slice(0, 10);

// ---------- sharing a card (the phone's own share list: WhatsApp and the others) ----------

/** The card as a picture: name, nickname, years, and the colour of the gender. Only what is on the card itself. */
async function cardImageBlob(p, name) {
  const W = 900;
  const H = 540;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  const color = p.gender === 'female' ? '#b5527a' : '#3b6ea5';
  try {
    await document.fonts.load('700 56px Tajawal');
  } catch {
    /* the picture is drawn with the system font then */
  }
  const font = (px) => `700 ${px}px Tajawal, system-ui, sans-serif`;
  const round = (x, y, w, h, r) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  g.fillStyle = '#f4f2ec';
  g.fillRect(0, 0, W, H);
  // the card
  const cx = 60;
  const cy = 120;
  const cw = W - 120;
  const ch = H - 200;
  g.fillStyle = '#ffffff';
  round(cx, cy, cw, ch, 30);
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = '#ddd8cb';
  g.stroke();
  // the strip with the years
  g.save();
  round(cx, cy, cw, ch, 30);
  g.clip();
  g.fillStyle = color;
  g.fillRect(cx, cy + ch - 96, cw, 96);
  g.restore();
  // the figure in a ring, rising above the card
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(W / 2, cy, 70, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = color;
  g.stroke();
  g.fillStyle = color;
  g.beginPath();
  g.arc(W / 2, cy - 18, 17, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  if (p.gender === 'female') {
    g.moveTo(W / 2, cy + 2);
    g.lineTo(W / 2 + 28, cy + 44);
    g.lineTo(W / 2 - 28, cy + 44);
  } else {
    round(W / 2 - 22, cy + 2, 44, 42, 10);
  }
  g.closePath();
  g.fill();
  // the texts
  g.direction = 'rtl';
  g.textAlign = 'center';
  const fit = (text, px, max) => {
    let size = px;
    g.font = font(size);
    while (g.measureText(text).width > max && size > 22) g.font = font((size -= 2));
    return size;
  };
  g.fillStyle = '#1f2a24';
  fit(name, 54, cw - 80);
  g.fillText(name, W / 2, cy + 118);
  if (p.nickname) {
    g.fillStyle = color;
    fit(p.nickname, 36, cw - 80);
    g.fillText(p.nickname, W / 2, cy + 166);
  }
  const years = lifeSpan(p);
  if (years) {
    g.fillStyle = '#ffffff';
    g.font = font(46);
    g.fillText(years, W / 2, cy + ch - 30);
  }
  g.fillStyle = '#68726c';
  g.font = font(28);
  g.fillText(`شجرة عائلة ${FAMILY}`, W / 2, H - 36);
  return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'));
}

// Android's browsers (Chrome and the ones built on it) refuse to share an Excel file through the share list: the type is not on their
// short list of file types (pictures, text, csv…). There the Excel file is saved on the phone and the picture goes to the share list.
// Elsewhere (an iPhone) both are tried, and a refusal of the Excel file is remembered.
const NO_XLSX_SHARE = 'ft.noXlsxShare';
const xlsxShareable = () => safeGet(NO_XLSX_SHARE) !== '1' && !/android/i.test(navigator.userAgent);

/**
 * Share one card through the share list of the phone: the Excel file of the person (the same file as «تصدير بياناته إلى Excel»)
 * and the picture of the card. If the phone takes only one file, the Excel file goes alone; with no sharing at all it is downloaded.
 */
async function shareCard(p) {
  const name = displayName(p);
  const text = [name + (p.nickname ? ` («${p.nickname}»)` : ''), lifeSpan(p), `من شجرة عائلة ${FAMILY}`].filter(Boolean).join('\n');
  const xl = personXlsxFile(p);
  const sheet = new File([xl.blob], xl.name, { type: XLSX_MIME });
  let picture = null;
  try {
    picture = new File([await cardImageBlob(p, name)], 'card.png', { type: 'image/png' });
  } catch {
    /* no picture: the Excel file goes alone */
  }
  const canShareFiles = (f) => !!navigator.canShare?.({ files: f });
  const files = xlsxShareable() ? [picture && [sheet, picture], [sheet]].filter(Boolean).find(canShareFiles) : null;
  if (!files) {
    // the Excel file is saved on the phone, and the picture goes to the share list
    downloadBlob(xl.name, xl.blob);
    if (!navigator.share || !picture || !canShareFiles([picture])) return toast('تم تنزيل ملف Excel');
    try {
      await navigator.share({ files: [picture], title: name, text });
    } catch (ex) {
      if (ex?.name !== 'AbortError') toast(`تعذّرت المشاركة (${ex?.name || 'خطأ'})`, true);
    }
    return toast('نُزّل ملف Excel في جهازك (مجلد التنزيلات): أرفقه من هناك عند الإرسال');
  }
  try {
    await navigator.share({ files, title: name, text });
  } catch (ex) {
    if (ex?.name !== 'AbortError') shareFallback(name, sheet, picture, ex); // closing the list is not an error
  }
}

/** The phone refused the share: each way is offered on its own (a new tap is a new permission to share) and the reason is shown. */
function shareFallback(name, sheet, picture, ex) {
  const can = (f) => !!navigator.canShare?.({ files: [f] });
  const one = (file, label) =>
    h('button', {
      class: 'btn',
      type: 'button',
      text: label,
      onclick: async () => {
        try {
          await navigator.share({ files: [file], title: name });
          dlg.close();
        } catch (e) {
          if (e?.name === 'NotAllowedError' && file === sheet) remember(NO_XLSX_SHARE, '1'); // this phone does not share Excel files: do not try again
          if (e?.name !== 'AbortError') toast(`تعذّرت المشاركة (${e?.name || 'خطأ'})`, true);
        }
      },
    });
  const dlg = modal(
    'تعذّرت المشاركة',
    h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted', text: 'لم يقبل الجوال إرسال الملفين معًا. جرّب كل واحد على حدة، أو نزّل ملف Excel على جهازك.' }),
      can(sheet) && one(sheet, 'مشاركة ملف Excel فقط'),
      picture && can(picture) && one(picture, 'مشاركة صورة البطاقة فقط'),
      h('button', { class: 'btn', type: 'button', text: 'تنزيل ملف Excel على الجهاز', onclick: () => (downloadBlob(sheet.name, sheet), dlg.close()) }),
      h('p', { class: 'muted small-note', dir: 'ltr', text: `${ex?.name || 'Error'}${ex?.message ? `: ${ex.message}` : ''}` }),
    ),
  );
}

/** Everyone above a person, from the first (oldest) ancestor down to them, on the father's and the mother's side. */
function openAncestors(p) {
  const idx = state.index;
  const dad = fatherLine(idx, p); // father first … the oldest ancestor last
  const mom = motherLine(idx, p); // mother first …

  const row = (a, label, { me = false } = {}) => {
    const mother = idx.byId.get(a.mother_id);
    const meta = [lifeSpan(a), birthText(a)].filter(Boolean).join(' · ');
    return h(
      'li',
      { class: `anc${me ? ' me' : ''}` },
      h('span', { class: 'anc-label', text: label }),
      me
        ? h('strong', { text: fullName(a) })
        : h('button', { class: 'who', type: 'button', onclick: () => (dlg.close(), openPerson(a.id)), text: fullName(a) }),
      meta && h('small', { class: 'muted', text: meta }),
      mother && !me && h('small', { class: 'muted', text: `الأم: ${fullName(mother)}` }),
    );
  };
  // listed from the oldest ancestor down to the person, but numbered from the closest one:
  // the father (or the mother), then the first grandfather, the second grandfather …
  const section = (title, line, nameOfN, withMe) => [
    h('div', { class: 'section-title', text: title }),
    h(
      'ul',
      { class: 'anc-list' },
      [...line].reverse().map((a, i) => row(a, nameOfN(line.length - i) + (i === 0 ? (line.length === 1 ? ' (أقدم من هو مسجّل)' : ' (الأقدم)') : ''))),
      withMe && row(p, p.gender === 'male' ? 'صاحب البطاقة' : 'صاحبة البطاقة', { me: true }),
    ),
  ];

  const chain = dad.length ? `${p.first_name} ${p.gender === 'male' ? 'بن' : 'بنت'} ${dad.map((x) => x.first_name).join(' بن ')}${dad[dad.length - 1].last_name ? ' ' + dad[dad.length - 1].last_name : ''}` : null;
  const go = dad.length
    ? h('button', {
        class: 'btn primary',
        type: 'button',
        text: `عرض الشجرة من أقدم جد (${dad[dad.length - 1].first_name})`,
        onclick: () => {
          dlg.close();
          setRoot(dad[dad.length - 1].id, { focus: false });
          focusPerson(p.id);
        },
      })
    : null;
  const dlg = modal(
    `أجداد ${fullName(p)}`,
    h(
      'div',
      {},
      !dad.length && !mom.length && h('p', { class: 'muted', text: 'لا يوجد أجداد مسجّلون لهذه البطاقة. أضف الأب أو الأم من بطاقة الشخص.' }),
      chain && h('p', { class: 'nasab', text: `النسب: ${chain}` }),
      dad.length ? section('من جهة الأب', dad, fatherSideName, true) : null,
      mom.length ? section('من جهة الأم', mom, motherSideName, !dad.length) : null,
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close(), text: 'إغلاق' }), go),
    ),
  );
}

/** One person -> an Excel file: the card, the ancestors, the wives / husbands and the children. */
/** The Excel file of one person: its name and its content. */
function personXlsxFile(p) {
  const mother = state.index.byId.get(p.mother_id);
  const bytes = buildXlsx(personSheets(state.index, p, infoRowsOf(p), mother ? infoRowsOf(mother) : []));
  return { name: `${fileSafe(currentTree()?.name)} - ${fileSafe(fullName(p))}.xlsx`, blob: new Blob([bytes], { type: XLSX_MIME }) };
}

function exportPersonXlsx(p) {
  run(async () => {
    const f = personXlsxFile(p);
    downloadBlob(f.name, f.blob);
    toast('تم تنزيل ملف Excel');
  });
}

const DESIGN_NAME = { classic: 'عمودية كلاسيكية', horizontal: 'أفقية', fan: 'مروحة', tree: 'شجرة طبيعية' };

/** The people shown on the screen right now -> an Excel file. */
function exportTreeXlsx() {
  const res = state.layout;
  if (!res || !res.cards.length) return toast('لا توجد شجرة لتصديرها', true);
  run(async () => {
    const idx = state.index;
    const offset = res.genOffset || 0;
    const persons = res.cards.map((c) => idx.byId.get(c.personId));
    const gen = new Map(res.cards.map((c) => [c.personId, c.node.depth + offset + 1]));
    // cards come in drawing order, so the last card at depth 1 is the head of the branch of everyone after it
    const branch = new Map();
    let head = null;
    for (const c of res.cards) {
      if (c.node.depth === 1) head = idx.byId.get(c.personId);
      if (c.node.depth >= 1 && head) branch.set(c.personId, `فرع ${head.first_name}`);
    }
    const root = idx.byId.get(state.rootId);
    const info = [
      ['اسم الشجرة', currentTree()?.name || ''],
      ['تبدأ الشجرة من', root ? fullName(root) : ''],
      ['عدد الأشخاص المعروضين', persons.length],
      ['شكل العرض', DESIGN_NAME[state.design]],
      ['تاريخ التصدير', today()],
    ];
    const bytes = buildXlsx(treeSheets(idx, persons, { gen, branch, info, infoRows: state.info }));
    downloadBlob(`${fileSafe(currentTree()?.name)} - ${fileSafe(root ? fullName(root) : '')}.xlsx`, new Blob([bytes], { type: XLSX_MIME }));
    toast('تم تنزيل ملف Excel');
  });
}

/**
 * Prints what is on the screen: the drawing is copied into a hidden page (scaled to fit one sheet of A4,
 * always in the light colours) that only the printer sees; the page itself is hidden while printing.
 */
function printTree() {
  const res = state.layout;
  if (!res || !res.cards.length) return toast('لا توجد شجرة للطباعة', true);
  document.querySelector('.print-area')?.remove();
  document.getElementById('print-page')?.remove();

  const b = res.bounds;
  const landscape = b.w >= b.h;
  const pageW = landscape ? 1040 : 710; // usable width / height of an A4 sheet with 10mm margins, in CSS px
  const pageH = landscape ? 710 : 1040;
  const s = Math.min(1, pageW / b.w, (pageH - 120) / b.h); // 120px for the title, the legend and the footer

  const stage = chart.stage.cloneNode(true);
  stage.classList.remove('anim', 'has-hl');
  for (const n of stage.querySelectorAll('.selected, .hl')) n.classList.remove('selected', 'hl');
  for (const n of stage.querySelectorAll('.tg')) n.remove();
  for (const n of stage.querySelectorAll('img')) n.removeAttribute('loading');
  stage.style.transform = `translate(${-b.minX * s}px, ${-b.minY * s}px) scale(${s})`;

  const root = state.index.byId.get(state.rootId);
  const branches = state.branchColors ? res.cards[0].node.children.filter((n) => n.branch >= 0) : [];
  const style = h('style', { id: 'print-page', text: `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm }` });
  const area = h(
    'div',
    { class: 'print-area' },
    h('div', { class: 'print-head' }, h('strong', { text: currentTree()?.name || 'شجرة العائلة' }), h('span', { text: `${root ? 'تبدأ من ' + fullName(root) + ' · ' : ''}${today()}` })),
    branches.length
      ? h('div', { class: 'print-legend' }, branches.map((n) => h('span', {}, h('i', { 'data-br': String(n.branch) }), `فرع ${state.index.byId.get(n.id).first_name}`)))
      : null,
    h('div', { class: 'print-frame', style: `width:${Math.ceil(b.w * s)}px;height:${Math.ceil(b.h * s)}px` }, stage),
    h('div', { class: 'print-foot', text: 'طُبعت من تطبيق «شجرة العائلة»' }),
  );
  document.head.append(style);
  document.body.append(area);
  const cleanup = () => {
    area.remove();
    style.remove();
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(() => window.print(), 250);
}

// ---------- quick-add table ----------
// A table next to the card panel: one line per new relative (son / daughter / wife or husband) with the
// name and the dates, and under "تفاصيل" everything else a card can hold. The lines become people through
// planQuickAdd() (js/quickadd.js). On a woman's card in a tree on the "information only" rule the same table
// writes rows of her information table instead of cards.

let quickRows = [];
let quickMsg = null; // { text, ok } shown under the table
let quickSig = ''; // what the table was built for: the wives / husbands, the rights, the rule
const infoOpen = new Set(); // saved information rows whose details are open

/** The rule for women's cards in this tree (supabase/009_female_cards.sql): 'full' | 'info' | 'none'. */
const femaleMode = () => currentTree()?.female_card_mode || 'full';
/** May the current user add sons / daughters as cards here? A woman's card only under the full rule. */
const canAddKids = (p) => state.perms.canAddChild(p) && (p.gender === 'male' || femaleMode() === 'full');
/** May the current user write information rows about a woman's children? */
const canAddInfo = (p) => hasBackend() && p.gender === 'female' && femaleMode() === 'info' && state.perms.canAddChild(p);
const infoRowsOf = (p) => state.info.get(p.id) || [];

function quickContext(p) {
  if (state.quickMode === 'info') {
    const ok = canAddInfo(p);
    return { canChild: ok, canSpouse: ok, spouses: [] };
  }
  return { canChild: canAddKids(p), canSpouse: state.perms.canAddSpouse(p), spouses: state.index.spouses.get(p.id) || [] };
}

/** Close it from a button: the panel's own button has to show it is no longer pressed. */
function dismissQuick() {
  closeQuick();
  renderPanel();
}

/** What the table depends on: redraw it only when this changes (not on every refresh of the page). */
function quickSigOf(p) {
  const { canChild, canSpouse, spouses } = quickContext(p);
  return `${state.quickMode}|${femaleMode()}|${spouses.map((s) => s.person.id).join(',')}|${canChild}|${canSpouse}|${infoRowsOf(p).length}`;
}

/**
 * A woman's information table opens by itself when her card is chosen (next to the card's details; on a phone, inside the sheet
 * of the card, under her details and before the buttons), as soon as the tree is on the "information only" rule and the user may
 * write in it, or she already has rows.
 */
function showsInfoTable(p) {
  return p.gender === 'female' && hasBackend() && (canAddInfo(p) || infoRowsOf(p).length > 0);
}

/** On a phone the table is part of the sheet of the card (the screen is too small for a second panel beside it). */
const quickInSheet = () => window.innerWidth > 0 && window.innerWidth <= 760; // 0 = the page is hidden right now: not a phone

function openQuick(p, mode = 'cards', { focus = true } = {}) {
  state.quickMode = mode;
  const { canChild } = quickContext(p);
  state.quickFor = p.id;
  quickRows = mode === 'info' && !canChild ? [] : Array.from({ length: 3 }, () => blankRow(canChild ? 'son' : 'spouse'));
  quickMsg = null;
  quickSig = '';
  infoOpen.clear();
  renderPanel(); // the button shows it is pressed (and draws the table, see renderPanel)
  if (ui.quick.hidden) renderQuick();
  if (!focus) return;
  if (quickInSheet()) ui.quick.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); // (focusing a field would raise the keyboard)
  else ui.quick.querySelector('input')?.focus();
}

function closeQuick() {
  state.quickFor = null;
  quickRows = [];
  quickMsg = null;
  quickSig = '';
  if (ui.quick) ui.quick.hidden = true;
}

const INFO_KIND = { son: 'ابن', daughter: 'ابنة', spouse: 'زوج' };

/** One saved row of a woman's information table, with its details and the buttons to edit / delete it. */
function infoRowNode(p, r, canWrite) {
  const open = infoOpen.has(r.id);
  const lines = [
    ['تاريخ الميلاد', r.birth_date],
    ['مكان الميلاد', birthText(r)],
    ['الإقامة', residenceText(r)],
    ['تاريخ الوفاة', r.death_date || (r.is_deceased ? 'متوفى' : '')],
    ['الهاتف', r.phone],
    ['البريد الإلكتروني', r.email],
    ['ملاحظات', r.notes],
  ].filter(([, v]) => v);
  return h(
    'div',
    { class: 'info-item' },
    h(
      'div',
      { class: 'info-row' },
      h('span', { class: 'kind', text: INFO_KIND[r.kind] || r.kind }),
      h('span', { class: 'nm', text: [r.first_name, r.last_name].filter(Boolean).join(' ') }),
      h('span', { text: r.birth_date || '—' }),
      h('span', { text: r.death_date || (r.is_deceased ? 'متوفى' : '—') }),
      h(
        'div',
        { class: 'quick-actions-cell' },
        birthText(r) || residenceText(r) || r.phone || r.email || r.notes
          ? h('button', { class: 'mini-btn', type: 'button', 'aria-expanded': String(open), text: open ? 'إخفاء' : 'تفاصيل', onclick: () => (open ? infoOpen.delete(r.id) : infoOpen.add(r.id), renderQuick()) })
          : null,
        canWrite &&
          h('button', {
            class: 'mini-btn',
            type: 'button',
            text: 'تعديل',
            onclick: () => {
              const row = rowFromInfo(r);
              row.open = true;
              quickRows.unshift(row);
              renderQuick();
            },
          }),
        canWrite && h('button', { class: 'mini-btn danger', type: 'button', text: 'حذف', onclick: () => deleteInfoRow(p, r) }),
      ),
    ),
    open && h('dl', { class: 'dl info-dl' }, lines.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
  );
}

async function deleteInfoRow(p, r) {
  if (!(await confirmBox('حذف سطر من الجدول', `سيُحذف «${r.first_name}» من جدول معلومات أبناء ${fullName(p)} نهائيًا، ولا يمكن التراجع عن ذلك.`, 'حذف', true))) return;
  await run(async () => {
    const { data, error } = await sb.from('card_info').delete().eq('id', r.id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('permission denied');
    state.info.set(p.id, infoRowsOf(p).filter((x) => x.id !== r.id));
    infoOpen.delete(r.id);
    if (state.quickFor === p.id) renderQuick();
    renderPanel();
  });
}

function renderQuick() {
  const p = state.quickFor && state.index.byId.get(state.quickFor);
  const info = state.quickMode === 'info';
  if (!p || (!info && !state.quickTable)) return closeQuick();
  const { canChild, canSpouse, spouses } = quickContext(p);
  const editable = canChild || canSpouse;
  const saved = info ? infoRowsOf(p) : [];
  if (!editable && !saved.length) return closeQuick();
  quickSig = quickSigOf(p);

  const kinds = [...(canChild ? [['son', 'ابن'], ['daughter', 'ابنة']] : []), ...(canSpouse ? [['spouse', spouseKindLabel(p)]] : [])];
  for (const r of quickRows) if (kinds.length && !kinds.some(([k]) => k === r.kind)) r.kind = kinds[0][0];
  const male = p.gender === 'male';

  // keep the caret where it was: the table is redrawn when a line is added or removed
  const active = document.activeElement;
  const keep = active && ui.quick.contains(active) && active.dataset.q ? { q: active.dataset.q, start: active.selectionStart, end: active.selectionEnd } : null;

  const focusField = (i, name) => ui.quick.querySelector(`[data-q="${i}:${name}"]`)?.focus();
  const addLine = (kind) => {
    quickRows.push(blankRow(kind));
    renderQuick();
    focusField(quickRows.length - 1, 'name');
  };

  const line = (r, i) => {
    const kind = h('select', { 'aria-label': 'القرابة', 'data-q': `${i}:kind` }, kinds.map(([v, t]) => h('option', { value: v, text: t })));
    kind.value = r.kind;
    kind.addEventListener('change', () => {
      r.kind = kind.value;
      renderQuick();
    });
    const input = (name, placeholder, extra = {}) => {
      const el = h('input', { type: 'text', placeholder, 'aria-label': placeholder, maxlength: name === 'name' ? 100 : 40, autocomplete: 'off', 'data-q': `${i}:${name}`, ...extra });
      el.value = r[name];
      el.addEventListener('input', () => (r[name] = el.value));
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (i === quickRows.length - 1) addLine(r.kind); // Enter on the last line starts the next one
        else focusField(i + 1, name);
      });
      return el;
    };
    let other = null;
    if (r.kind !== 'spouse' && spouses.length > 1) {
      other = h(
        'select',
        { class: 'other', 'aria-label': male ? 'الأم' : 'الأب', 'data-q': `${i}:other` },
        h('option', { value: '', text: male ? 'الأم: غير محددة' : 'الأب: غير محدد' }),
        spouses.map((s, k) => h('option', { value: s.person.id, text: `${spouseLabel(p, k, spouses.length)}: ${fullName(s.person)}` })),
      );
      other.value = r.other;
      other.addEventListener('change', () => (r.other = other.value));
    }
    if (r.open && !r.ed) r.ed = detailsEditor(r.extra || {}, { photo: !info });
    const toggle = h('button', {
      class: 'mini-btn',
      type: 'button',
      'aria-expanded': String(!!r.open),
      text: r.open ? 'إخفاء' : 'تفاصيل',
      title: 'اللقب، الهاتف، مكان الميلاد، السكن، الوفاة، الصورة، الملاحظات',
      onclick: () => {
        r.open = !r.open;
        renderQuick();
      },
    });
    const remove = miniBtn(
      'x',
      'حذف',
      () => {
        quickRows.splice(i, 1);
        if (!quickRows.length && editable) quickRows.push(blankRow(kinds[0][0]));
        renderQuick();
      },
      { danger: true, title: r.id ? 'إلغاء تعديل هذا السطر' : 'حذف هذا السطر' },
    );
    return h(
      'div',
      { class: `quick-row${r.id ? ' editing' : ''}` },
      kind,
      input('name', 'الاسم', { class: 'name' }),
      input('birth', 'تاريخ الميلاد', { dir: 'ltr' }),
      input('death', 'تاريخ الوفاة', { dir: 'ltr' }),
      h('div', { class: 'quick-actions-cell' }, toggle, remove),
      other,
      r.open && r.ed ? r.ed.node : null,
    );
  };

  const msg = h('div', { class: quickMsg?.ok ? 'quick-ok' : 'error', role: 'alert', text: quickMsg?.text || '' });
  const save = h('button', { class: 'btn primary', type: 'button', text: 'حفظ كل السطور' });
  save.addEventListener('click', () => saveQuick(p, save));
  const cols = h('div', { class: 'quick-cols', 'aria-hidden': 'true' }, h('span', { text: 'القرابة' }), h('span', { text: 'الاسم' }), h('span', { text: 'تاريخ الميلاد' }), h('span', { text: 'تاريخ الوفاة' }), h('span'));
  const shownSaved = saved.filter((r) => !quickRows.some((q) => q.id === r.id)); // a row being edited sits in the editor below

  put(
    ui.quick,
    h('div', { class: 'quick-head' }, h('strong', { text: info ? `معلومات أبناء ${fullName(p)}` : `إضافة سريعة لـ ${fullName(p)}` }), miniBtn('x', 'إغلاق', dismissQuick)),
    info && h('p', { class: 'muted small-note', text: 'جدول معلومات فقط: لا تظهر هذه الأسماء كبطاقات في الشجرة، وتظهر لأعضاء الشجرة هنا.' }),
    info && !editable && h('p', { class: 'muted small-note', text: femaleMode() === 'info' ? 'ليست لديك صلاحية إضافة معلومات في هذه البطاقة.' : 'قاعدة هذه الشجرة لا تسمح الآن بإضافة معلومات عن أبناء المرأة. تبقى المعلومات المكتوبة سابقًا للعرض.' }),
    shownSaved.length > 0 && [h('div', { class: 'section-title', text: `المسجَّل (${saved.length})` }), cols, h('div', { class: 'info-list' }, shownSaved.map((r) => infoRowNode(p, r, editable)))],
    editable && [
      shownSaved.length > 0 && h('div', { class: 'section-title', text: 'إضافة جديدة' }),
      h('p', { class: 'muted small-note', text: 'سطر لكل قريب. تُهمل السطور الفارغة. اكتب الاسم الأول فقط (يُضاف لقب الأب تلقائيًا)، والتاريخ سنة أو تاريخًا كاملًا مثل 1990 أو 1990-05-12. وفي «تفاصيل» بقية بيانات البطاقة.' }),
      shownSaved.length === 0 && cols,
      quickRows.map(line),
      msg,
      h('div', { class: 'quick-actions' }, h('button', { class: 'btn small', type: 'button', onclick: () => addLine(quickRows[quickRows.length - 1]?.kind || kinds[0][0]), text: '+ سطر' }), save),
    ],
  );
  ui.quick.hidden = false;

  if (keep) {
    const el = ui.quick.querySelector(`[data-q="${keep.q}"]`);
    if (el) {
      el.focus();
      try {
        if (keep.start != null) el.setSelectionRange(keep.start, keep.end);
      } catch {
        /* a select box has no caret */
      }
    }
  }
}

/** Writes one line of the information table (a new row, or the changes of a row that was edited). */
async function saveInfoRow(item) {
  const row = item.person;
  const query = item.id
    ? sb.from('card_info').update((({ person_id, ...patch }) => patch)(row)).eq('id', item.id)
    : sb.from('card_info').insert({ tree_id: state.treeId, ...row });
  const { data, error } = await query.select().single();
  if (error) throw error;
  setInfo(data);
}

async function saveQuick(p, save) {
  const info = state.quickMode === 'info';
  for (const r of quickRows) {
    if (r.ed) {
      r.extra = r.ed.get(); // what was typed under "تفاصيل"
      r.photo = r.ed.photo();
    }
  }
  const { canChild, canSpouse } = quickContext(p);
  const plan = planQuickAdd(state.index, p, quickRows, { canChild, canSpouse, mode: info ? 'info' : 'cards' });
  if (plan.errors.length) {
    quickMsg = { ok: false, text: plan.errors.map((e) => `السطر ${e.row}: ${e.message}`).join(' · ') };
    return renderQuick();
  }
  if (!plan.items.length) {
    quickMsg = { ok: false, text: 'اكتب اسمًا في سطر واحد على الأقل.' };
    return renderQuick();
  }
  save.disabled = true;
  const done = new Set(); // the line numbers that are saved
  const newIds = new Map(); // line number of a new wife / husband -> her / his id
  let failure = null;
  try {
    for (const item of plan.items) {
      if (info) {
        await saveInfoRow(item);
        done.add(item.row);
        continue;
      }
      let person = await dbInsert('persons', linkNewSpouse(item, p, newIds));
      done.add(item.row); // saved: never saved a second time
      if (item.photo) person = await savePhoto(person, { photo: item.photo });
      if (item.marriage) {
        newIds.set(item.row, person.id);
        await dbInsert('marriages', { person_a: p.id, person_b: person.id });
      }
    }
  } catch (ex) {
    failure = friendly(ex);
  }
  if (state.quickFor !== p.id) return; // the table was closed meanwhile
  quickRows = quickRows.filter((_, i) => !done.has(i + 1));
  while (editableRows(canChild, canSpouse) && quickRows.length < 3) quickRows.push(blankRow(canChild ? 'son' : 'spouse'));
  if (done.size && !info) state.collapsed.delete(p.id);
  quickMsg = failure
    ? { ok: false, text: `${done.size ? `تم حفظ ${done.size} من ${plan.items.length}. ` : ''}${failure}` }
    : { ok: true, text: `تمت إضافة ${done.size === 1 ? 'شخص واحد' : done.size === 2 ? 'شخصين' : done.size <= 10 ? `${done.size} أشخاص` : `${done.size} شخصًا`}.` };
  renderQuick();
  renderPanel(); // the count on the button
  if (!failure) toast(quickMsg.text);
}

const editableRows = (canChild, canSpouse) => canChild || canSpouse;

// ---------- side panel ----------

function relRow(p, { sub, dot, onRemove, removeLabel } = {}) {
  return h(
    'li',
    { class: 'rel' },
    dot && h('span', { class: 'dot', style: `background:${dot}` }),
    h('button', { class: 'who', type: 'button', onclick: () => openPerson(p.id) }, fullName(p), sub && h('small', { text: ` · ${sub}` })),
    onRemove && miniBtn('x', 'إزالة', onRemove, { danger: true, title: removeLabel }),
  );
}

function renderPanel() {
  const p = state.selectedId && state.index.byId.get(state.selectedId);
  ui.panel.hidden = !p;
  syncPanelLayer(!!p);
  if (state.quickFor && state.quickFor !== p?.id) closeQuick(); // another card (or none): the table belongs to one person
  const newSelection = !!p && ui.panelFor !== p.id; // this card was just chosen (not just refreshed)
  if (!p) {
    ui.panelFor = null;
    state.activeSpouse = null;
    chart.setHighlight(null);
    return;
  }
  const idx = state.index;
  const perms = state.perms;
  const canW = perms.canWritePerson(p); // edit this card / its parents
  const canChild = canAddKids(p);
  const canSpouse = perms.canAddSpouse(p);
  const canDel = perms.canDeletePerson(p);
  const canManage = (!DEMO || FAKE_BACKEND) && perms.canDelegate(p); // invite people / hand out rights on this card's branch
  const scopeNote = perms.isBranchUser
    ? perms.isBranchHead(p)
      ? `هذه بطاقة بداية الفرع الذي تديره. صلاحياتك على كل من تحتها: ${rightsText(perms.rightsAtHead(p))}. لا تستطيع تعديل هذه البطاقة نفسها.`
      : !canW && !canChild
        ? 'هذه البطاقة خارج الفرع الذي تديره، فهي للقراءة فقط.'
        : null
    : state.role === 'viewer'
      ? 'صلاحيتك: قراءة فقط.'
      : null;
  const father = idx.byId.get(p.father_id);
  const mother = idx.byId.get(p.mother_id);
  const spouses = idx.spouses.get(p.id) || [];
  const kids = idx.kids.get(p.id) || [];

  const avatar = h('div', { class: 'avatar', style: `--gender:var(--${p.gender})` });
  const photoSrc = photos?.url(p.photo_url);
  if (photoSrc) avatar.append(h('img', { src: photoSrc, alt: '' }));
  else avatar.append(genderIcon(p.gender));
  if (p.photo_url && !photoSrc) {
    photos?.ensure([p.photo_url]).then((changed) => changed && state.selectedId === p.id && renderPanel());
  }

  const details = [];
  const add = (k, val) => val && details.push(h('dt', { text: k }), h('dd', { text: val }));
  const addLink = (k, text, href) => text && details.push(h('dt', { text: k }), h('dd', {}, h('a', { class: 'ltr', href }, text)));
  add('اللقب المشتهر به', p.nickname);
  add('تاريخ الميلاد', p.birth_date);
  add('مكان الميلاد', birthText(p));
  add('الإقامة', residenceText(p));
  addLink('الهاتف', p.phone, `tel:${String(p.phone || '').replace(/[^+\d]/g, '')}`);
  addLink('البريد الإلكتروني', p.email, `mailto:${p.email}`);
  if (p.is_deceased) add('الوفاة', p.death_date || 'متوفى');
  add('ملاحظات', p.notes);

  const parentRow = (label, parent, field) =>
    parent
      ? relRow(parent, { onRemove: canW ? () => removeParent(p, field) : null, removeLabel: 'إزالة الربط' })
      : h('li', { class: 'muted', text: 'غير مسجّل' });

  // A wife (or husband) row: click = show the children they have with this person,
  // highlighted in the chart; the small button opens their own details.
  if (!spouses.some((s) => s.person.id === state.activeSpouse)) state.activeSpouse = null;
  const spouseRow = (s, i) => {
    const active = state.activeSpouse === s.person.id;
    const shared = commonChildren(idx, p.id, s.person.id);
    const dot = spouses.length > 1 ? SPOUSE_COLORS[i % SPOUSE_COLORS.length] : null;
    const info = [s.marriage ? STATUS_LABEL[s.marriage.status] : null, `${shared.length} من الأبناء`].filter(Boolean).join(' · ');
    return h(
      'li',
      { class: `spouse-item${active ? ' active' : ''}` },
      h(
        'div',
        { class: 'rel' },
        dot && h('span', { class: 'dot', style: `background:${dot}` }),
        h(
          'button',
          {
            class: 'who',
            type: 'button',
            'aria-expanded': String(active),
            onclick: () => {
              state.activeSpouse = active ? null : s.person.id;
              renderPanel();
            },
          },
          fullName(s.person),
          h('small', { text: ` · ${info}` }),
        ),
        miniBtn('user', 'البطاقة', () => openPerson(s.person.id), { title: `بيانات ${s.person.first_name}` }),
        s.marriage && perms.canRemoveMarriage(p, s.person) && miniBtn('x', 'إلغاء الزواج', () => removeMarriage(s.marriage, p, s.person), { danger: true, title: 'إلغاء تسجيل الزواج' }),
      ),
      active &&
        h(
          'ul',
          { class: 'rel-list sub' },
          shared.length
            ? shared.map((c) => relRow(c, { sub: lifeSpan(c) || null }))
            : h('li', { class: 'muted', text: 'لا أبناء مسجّلون بينهما' }),
        ),
    );
  };

  const kidRow = (c) => {
    const other = idx.byId.get(p.gender === 'male' ? c.mother_id : c.father_id);
    const parts = [lifeSpan(c)];
    if (spouses.length > 1 && other) parts.push(`من ${other.first_name}`);
    return relRow(c, { sub: parts.filter(Boolean).join(' · ') || null });
  };

  mountPanel(
    p.id,
    h(
      'div',
      { class: 'panel-head' },
      avatar,
      h('div', {}, h('h2', { text: displayName(p) }), h('div', { class: 'sub', text: [p.gender === 'male' ? 'ذكر' : 'أنثى', lifeSpan(p)].filter(Boolean).join(' · ') })),
      miniBtn('x', 'إغلاق', () => (select(null), chart.setSelected(null), renderPanel())),
    ),
    scopeNote && h('div', { class: 'notice', text: scopeNote }),
    details.length && h('dl', { class: 'dl' }, details),

    h('div', { class: 'section-title', text: 'الأب' }),
    h('ul', { class: 'rel-list' }, parentRow('الأب', father, 'father_id')),
    canW && !father && h('button', { class: 'btn small', type: 'button', onclick: () => addParent(p, 'father_id'), text: '+ إضافة الأب' }),

    h('div', { class: 'section-title', text: 'الأم' }),
    h('ul', { class: 'rel-list' }, parentRow('الأم', mother, 'mother_id')),
    canW && !mother && h('button', { class: 'btn small', type: 'button', onclick: () => addParent(p, 'mother_id'), text: '+ إضافة الأم' }),

    spouses.length > 0 && h('div', { class: 'section-title', text: p.gender === 'male' ? 'الزوجات (اضغط على زوجة لتظهر أبناؤها)' : 'الأزواج (اضغط لتظهر الأبناء)' }),
    spouses.length > 0 && h('ul', { class: 'rel-list' }, spouses.map(spouseRow)),

    kids.length > 0 && h('div', { class: 'section-title', text: `الأبناء (${kids.length})` }),
    kids.length > 0 && h('ul', { class: 'rel-list' }, kids.map(kidRow)),

    // on a phone the quick / information table is here, in the sheet: after the details and the relatives, before the buttons
    quickInSheet() && state.quickFor === p.id && ui.quick,

    h(
      'div',
      { class: 'actions' },
      (canChild || canSpouse) &&
        h(
          'div',
          { class: 'row' },
          canChild && h('button', { class: 'btn primary', type: 'button', onclick: () => addChild(p), text: 'إضافة ابن / ابنة' }),
          canSpouse && h('button', { class: 'btn', type: 'button', onclick: () => addSpouse(p), text: p.gender === 'male' ? 'إضافة زوجة' : 'إضافة زوج' }),
        ),
      state.quickTable && (canChild || canSpouse) && h('button', { class: 'btn', type: 'button', 'aria-pressed': String(state.quickFor === p.id && state.quickMode === 'cards'), onclick: () => (state.quickFor === p.id && state.quickMode === 'cards' ? dismissQuick() : openQuick(p, 'cards')), text: 'إضافة سريعة (جدول)' }),
      // a woman's card on the "information only" rule: the table of her children's information (no cards)
      p.gender === 'female' && hasBackend() && (canAddInfo(p) || infoRowsOf(p).length > 0) &&
        h('button', { class: 'btn', type: 'button', 'aria-pressed': String(state.quickFor === p.id && state.quickMode === 'info'), onclick: () => (state.quickFor === p.id && state.quickMode === 'info' ? dismissQuick() : openQuick(p, 'info')), text: `جدول معلومات الأبناء${infoRowsOf(p).length ? ` (${infoRowsOf(p).length})` : ''}` }),
      h(
        'div',
        { class: 'row' },
        canW && h('button', { class: 'btn', type: 'button', onclick: () => editPerson(p), text: 'تعديل البيانات' }),
        h('button', { class: 'btn', type: 'button', onclick: () => setRoot(p.id), text: 'عرض الشجرة من هنا' }),
      ),
      h(
        'div',
        { class: 'row' },
        (father || mother) && h('button', { class: 'btn', type: 'button', onclick: () => openAncestors(p), text: 'عرض الأجداد' }),
        h('button', { class: 'btn', type: 'button', onclick: () => exportPersonXlsx(p), text: 'تصدير بياناته إلى Excel' }),
      ),
      h('button', { class: 'btn only-touch', type: 'button', onclick: () => shareCard(p), text: xlsxShareable() ? 'مشاركة: ملف Excel + صورة البطاقة (واتساب وغيره)' : 'مشاركة صورة البطاقة + تنزيل ملف Excel' }),
      canManage && h('button', { class: 'btn', type: 'button', onclick: () => openBranchAccess(p), text: 'دعوة وصلاحيات هذا الفرع' }),
      hasBackend() && state.role === 'viewer' && !perms.isBranchHead(p) && h('button', { class: 'btn', type: 'button', onclick: () => openRequestDialog(p), text: 'طلب صلاحية على هذا الفرع' }),
      hasBackend() && h('button', { class: 'btn', type: 'button', onclick: () => openReportDialog(p), text: 'ابلغ عن خطأ بالمعلومات' }),
      canDel && h('button', { class: 'btn danger', type: 'button', onclick: () => deletePerson(p), text: 'حذف هذا الشخص' }),
    ),

    hasBackend() && h('div', { class: 'section-title', text: 'التعليقات' }),
    hasBackend() && commentsBox(p),
  );

  if (!ui.quick.isConnected) ui.panel.before(ui.quick); // not in the sheet (a wide screen, or another card): beside the panel as before
  chart.setHighlight(
    state.activeSpouse ? new Set(commonChildren(idx, p.id, state.activeSpouse).map((c) => c.id)) : null,
  );
  if (state.quickFor === p.id && quickSigOf(p) !== quickSig) renderQuick(); // the wives / rights changed
  if (newSelection && showsInfoTable(p)) openQuick(p, 'info', { focus: false }); // a woman's information table opens by itself
}

/** Replace the panel content; keep the scroll position while it is still the same person. */
function mountPanel(forId, ...nodes) {
  const keep = ui.panelFor === forId ? ui.panel.scrollTop : 0;
  put(ui.panel, ...nodes.filter(Boolean));
  ui.panel.scrollTop = keep;
  ui.panelFor = forId;
}

// ====================================================================
// data operations
// ====================================================================

function localUpsert(table, row) {
  (table === 'persons' ? state.persons : state.marriages).set(row.id, row);
}

function assertLive() {
  if (OFFLINE) throw new Error('أنت تتصفح نسخة محفوظة دون اتصال: لا يمكن التعديل الآن.');
  if (DEMO) throw new Error('هذه نسخة تجريبية للعرض فقط');
}

async function dbInsert(table, row) {
  assertLive();
  const { data, error } = await sb.from(table).insert({ tree_id: state.treeId, ...row }).select().single();
  if (error) throw error;
  localUpsert(table, data);
  rebuild();
  return data;
}

async function dbUpdate(table, id, patch) {
  assertLive();
  const { data, error } = await sb.from(table).update(patch).eq('id', id).select().single();
  if (error) throw error;
  localUpsert(table, data);
  rebuild();
  return data;
}

async function dbDelete(table, id) {
  assertLive();
  const { data, error } = await sb.from(table).delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('permission denied');
}

async function run(fn) {
  try {
    await fn();
  } catch (ex) {
    toast(friendly(ex), true);
  }
}

// ---------- actions ----------

/**
 * Upload / replace / remove a person's photo after their row is saved. A failed upload never
 * loses the person: they are already saved, so only a warning is shown.
 */
async function savePhoto(person, extras) {
  if (!photos || !extras || (!extras.photo && !extras.removePhoto)) return person;
  const old = person.photo_url;
  try {
    if (extras.photo) {
      const path = await photos.upload(state.treeId, person.id, extras.photo);
      const updated = await dbUpdate('persons', person.id, { photo_url: path });
      if (old) photos.remove(old);
      await photos.ensure([path]);
      chart?.refreshPhotos();
      return updated;
    }
    const updated = await dbUpdate('persons', person.id, { photo_url: null });
    photos.remove(old);
    return updated;
  } catch (ex) {
    toast(`حُفظت البطاقة لكن تعذّر تحديث الصورة: ${friendly(ex)}`, true);
    return person;
  }
}

/** Fetch signed links for the photos of the cards on screen, then put them into the cards. */
async function syncPhotos() {
  if (!photos || !chart || !state.layout) return;
  const paths = state.layout.cards.map((c) => state.index.byId.get(c.personId)?.photo_url).filter(Boolean);
  if (paths.length && (await photos.ensure(paths))) chart?.refreshPhotos();
}

function addFirstPerson() {
  openPersonForm({
    title: 'إضافة أول شخص في الشجرة',
    onSubmit: async (vals, _other, extras) => {
      const p = await savePhoto(await dbInsert('persons', vals), extras);
      state.selectedId = p.id;
      rebuild();
      chart.focusTop();
    },
  });
}

/**
 * "Other parent" choices for a child of `parent`: their wives (or husbands).
 * One spouse -> preselected automatically. Several -> the user picks, each listed as
 * "الزوجة الثانية: الاسم" so it is clear who is who.
 */
function otherParentChoice(parent, current = '') {
  const sp = state.index.spouses.get(parent.id) || [];
  if (!sp.length) return null;
  const isMale = parent.gender === 'male';
  return {
    label: isMale ? (sp.length > 1 ? 'الأم (اختر من زوجات الأب)' : 'الأم') : sp.length > 1 ? 'الأب (اختر من أزواج الأم)' : 'الأب',
    options: sp.map((s, i) => ({
      id: s.person.id,
      name: sp.length > 1 ? `${spouseLabel(parent, i, sp.length)}: ${fullName(s.person)}` : fullName(s.person),
    })),
    selected: current || (sp.length === 1 ? sp[0].person.id : ''),
    placeholder: sp.length > 1 ? (isMale ? 'اختر الأم…' : 'اختر الأب…') : 'غير محدد',
  };
}

function addChild(parent, { title = null, otherId = '' } = {}) {
  const isMale = parent.gender === 'male';
  let other = otherParentChoice(parent, otherId);
  const mate = otherId && state.index.byId.get(otherId); // a brother or a sister: the person's own other parent
  if (mate) {
    if (!other) other = { label: isMale ? 'الأم' : 'الأب', options: [], selected: otherId, placeholder: 'غير محدد' };
    if (!other.options.some((o) => o.id === otherId)) other.options.push({ id: otherId, name: fullName(mate) });
    other.selected = otherId;
  }
  openPersonForm({
    title: title || `إضافة ابن أو ابنة لـ ${fullName(parent)}`,
    defaults: { last_name: isMale ? parent.last_name : null },
    other,
    note: other ? null : `لم تُسجَّل ${isMale ? 'زوجة' : 'زوج'} لهذا الشخص بعد. لتحديد ${isMale ? 'الأم' : 'الأب'} أضف ${isMale ? 'الزوجة' : 'الزوج'} أولًا ثم أضف الابن.`,
    onSubmit: async (vals, otherId, extras) => {
      const child = await savePhoto(
        await dbInsert('persons', {
          ...vals,
          father_id: isMale ? parent.id : otherId,
          mother_id: isMale ? otherId : parent.id,
        }),
        extras,
      );
      state.collapsed.delete(parent.id);
      rebuild();
      // A child hangs under their father. If the father is someone else's husband-line
      // (e.g. a daughter's child), the child is not in this view: say so instead of jumping away.
      if (chart.has(child.id)) focusPerson(child.id);
      else toast(`تمت إضافة ${fullName(child)}، ويظهر تحت أبيه في شجرة عائلته.`);
    },
  });
}

async function addSpouse(person) {
  const isMale = person.gender === 'male';
  const spouseGender = isMale ? 'female' : 'male';
  const what = isMale ? 'زوجة' : 'زوج';
  const choice = await choose(`إضافة ${what} لـ ${fullName(person)}`, [
    { label: 'إضافة شخص جديد', value: 'new' },
    { label: 'اختيار شخص موجود في الشجرة', value: 'existing' },
  ]);
  if (!choice) return;
  if (choice === 'existing') {
    const id = await pickPerson({
      title: `اختر ${what}`,
      filter: (q) => q.id !== person.id && q.gender === spouseGender,
    });
    if (!id) return;
    await run(async () => {
      await dbInsert('marriages', { person_a: person.id, person_b: id });
      openPerson(person.id);
    });
    return;
  }
  openPersonForm({
    title: `إضافة ${what} لـ ${fullName(person)}`,
    defaults: { gender: spouseGender },
    lockGender: true,
    onSubmit: async (vals, _other, extras) => {
      const sp = await dbInsert('persons', vals);
      await savePhoto(sp, extras);
      await dbInsert('marriages', { person_a: person.id, person_b: sp.id });
      openPerson(person.id);
    },
  });
}

async function addParent(child, field) {
  const gender = field === 'father_id' ? 'male' : 'female';
  const what = field === 'father_id' ? 'الأب' : 'الأم';
  const choice = await choose(`إضافة ${what} لـ ${fullName(child)}`, [
    { label: 'إضافة شخص جديد', value: 'new' },
    { label: 'اختيار شخص موجود في الشجرة', value: 'existing' },
  ]);
  if (!choice) return;
  if (choice === 'existing') {
    const below = descendantsOf(state.index, child.id);
    const id = await pickPerson({ title: `اختر ${what}`, filter: (q) => q.gender === gender && !below.has(q.id) });
    if (!id) return;
    await run(async () => {
      await dbUpdate('persons', child.id, { [field]: id });
      focusPerson(child.id);
    });
    return;
  }
  openPersonForm({
    title: `إضافة ${what} لـ ${fullName(child)}`,
    defaults: { gender, last_name: field === 'father_id' ? child.last_name : null },
    lockGender: true,
    onSubmit: async (vals, _other, extras) => {
      const parent = await dbInsert('persons', vals);
      await savePhoto(parent, extras);
      await dbUpdate('persons', child.id, { [field]: parent.id });
      if (field === 'father_id' || !child.father_id) {
        state.rootId = topAncestor(state.index, child.id);
        state.collapsed = autoCollapse(state.index, state.rootId);
      }
      focusPerson(child.id);
    },
  });
}

/** A brother or a sister = a new child of the same parent, with the person's other parent chosen already. */
function addSibling(person, parent) {
  const mate = parent.gender === 'male' ? person.mother_id : person.father_id;
  addChild(parent, { title: `إضافة أخ أو أخت لـ ${fullName(person)}`, otherId: mate || '' });
}

/** The four places a new person can be added around someone, and why a place is closed (if it is). */
function addOptions(p) {
  const idx = state.index;
  const perms = state.perms;
  const father = idx.byId.get(p.father_id);
  const mother = idx.byId.get(p.mother_id);
  const closed = (reason) => ({ ok: false, reason });

  const missing = [!father && 'father_id', !mother && 'mother_id'].filter(Boolean);
  const parent = !perms.canWritePerson(p)
    ? closed('لا تملك صلاحية تعديل هذه البطاقة')
    : !missing.length
      ? closed('الأب والأم مسجّلان')
      : {
          ok: true,
          run: async () => {
            const field = missing.length === 1 ? missing[0] : await choose(`إضافة والد لـ ${fullName(p)}`, [{ label: 'إضافة الأب', value: 'father_id' }, { label: 'إضافة الأم', value: 'mother_id' }]);
            if (field) addParent(p, field);
          },
        };

  const spouse = perms.canAddSpouse(p) ? { ok: true, run: () => addSpouse(p) } : closed('لا تملك صلاحية الإضافة هنا');

  const via = father || mother;
  const sibling = !via
    ? closed('أضف الأب أو الأم أولًا')
    : canAddKids(via)
      ? { ok: true, run: () => addSibling(p, via) }
      : closed(via.gender === 'female' && femaleMode() !== 'full' ? 'قاعدة الشجرة لا تسمح بإضافة أبناء تحت بطاقة الأم. أضف الأب أولًا' : 'لا تملك صلاحية الإضافة عند والديه');

  const child = canAddKids(p)
    ? { ok: true, run: () => addChild(p) }
    : canAddInfo(p)
      ? { ok: true, run: () => (onSelect(p.id), openQuick(p, 'info')) } // a woman's sons / daughters are written as information
      : closed(p.gender === 'female' && femaleMode() === 'none' ? 'قاعدة الشجرة لا تسمح بإضافة أبناء تحت بطاقة امرأة' : 'لا تملك صلاحية الإضافة هنا');

  return { parent, spouse, sibling, child };
}

/** "مكان جديد في العائلة": the person in the middle, and the four relations around them. */
function openAddMenu(p) {
  const o = addOptions(p);
  const opt = (cls, ico, label, x) =>
    h(
      'button',
      { class: `rel-opt ${cls}`, type: 'button', disabled: !x.ok, title: x.ok ? '' : x.reason, onclick: () => (dlg.close(), x.run()) },
      icon(ico),
      h('span', { class: 'lbl', text: label }),
    );
  const labels = { parent: 'والد / والدة', spouse: 'زوج / زوجة', sibling: 'أخ / أخت', child: 'ابن / ابنة' };
  const why = Object.entries(o).filter(([, x]) => !x.ok);
  const dlg = modal(
    'مكان جديد في العائلة',
    h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted', text: `اختر العلاقة حول ${p.first_name}` }),
      h(
        'div',
        { class: 'rel-cross' },
        opt('parent', 'parents', labels.parent, o.parent),
        opt('spouse', 'heart', labels.spouse, o.spouse),
        h('div', { class: `rel-center ${p.gender}` }, p.first_name),
        opt('sibling', 'userplus', labels.sibling, o.sibling),
        opt('child', 'child', labels.child, o.child),
      ),
      why.length > 0 && h('div', { class: 'muted small-note' }, why.map(([k, x]) => h('div', { text: `${labels[k]}: ${x.reason}` }))),
      h('p', { class: 'muted small-note', text: 'اضغط على صلة القرابة للمتابعة.' }),
    ),
  );
}

/** A tap on the "إضافة" or "عرض" button of a card. */
function onAction(act, id) {
  const p = state.index.byId.get(id);
  if (!p) return;
  if (act === 'add') openAddMenu(p);
  else onSelect(id);
}

function editPerson(p) {
  // Let the user fix the other parent too: choose among the wives of the father
  // (or the husbands of the mother when the father is unknown).
  const idx = state.index;
  const father = idx.byId.get(p.father_id);
  const base = father || idx.byId.get(p.mother_id);
  const field = base && base === father ? 'mother_id' : 'father_id';
  const other = base ? otherParentChoice(base, p[field] || '') : null;
  if (other) {
    other.placeholder = 'غير محدد';
    other.selected = p[field] || ''; // never change the other parent silently while editing
  }
  openPersonForm({
    title: `تعديل ${fullName(p)}`,
    person: p,
    other,
    onSubmit: async (vals, otherId, extras) => {
      const updated = await dbUpdate('persons', p.id, other ? { ...vals, [field]: otherId } : vals);
      await savePhoto(updated, extras);
    },
  });
}

async function removeParent(p, field) {
  const ok = await confirmBox('إزالة الربط', `سيُفصل ${fullName(p)} عن ${field === 'father_id' ? 'أبيه' : 'أمه'}، ولن يُحذف أي شخص.`, 'إزالة الربط');
  if (ok) await run(() => dbUpdate('persons', p.id, { [field]: null }));
}

async function removeMarriage(m, a, b) {
  const ok = await confirmBox('إلغاء تسجيل الزواج', `سيُحذف سجل الزواج بين ${fullName(a)} و${fullName(b)}. لا يُحذف أي شخص، وتبقى صلة الأبناء بوالديهم.`, 'إلغاء التسجيل');
  if (!ok) return;
  await run(async () => {
    await dbDelete('marriages', m.id);
    state.marriages.delete(m.id);
    rebuild();
  });
}

async function deletePerson(p) {
  const kids = state.index.kids.get(p.id) || [];
  const warn = [`سيُحذف «${fullName(p)}» مع سجلات زواجه.`];
  if (kids.length) warn.push(`لديه ${kids.length} من الأبناء: يبقون محفوظين لكنهم ينفصلون عنه، فلن يظهروا تحت أحد في الشجرة المعروضة حتى تعيد ربطهم.`);
  warn.push('يمكن التراجع عن الحذف من «السجل» ثم «المحذوفات».');
  if (!(await confirmBox('تأكيد الحذف', warn.join(' '), 'حذف', true))) return;
  await run(async () => {
    await dbDelete('persons', p.id);
    state.selectedId = null;
    await loadTreeData();
    rebuild();
    toast('تم الحذف. للتراجع: السجل ← المحذوفات');
  });
}

// ====================================================================
// sharing & members
// ====================================================================

const inviteUrl = (code) => `${location.origin}${location.pathname}#/join/${code}`;

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('تم نسخ الرابط');
  } catch {
    prompt('انسخ الرابط:', text);
  }
}

async function openShare() {
  lastInviteResult = null;
  const body = h('div', {}, h('p', { class: 'muted', text: 'جارٍ التحميل…' }));
  modal('المشاركة والأعضاء', body);
  await renderShare(body);
}

async function renderShare(body) {
  const isAdmin = state.role === 'admin';
  try {
    const { data: members, error } = await sb
      .from('tree_members')
      .select('user_id, role, joined_at, profile:profiles(display_name)')
      .eq('tree_id', state.treeId)
      .order('joined_at');
    if (error) throw error;
    let invites = [];
    let grants = [];
    if (isAdmin) {
      const r = await sb.from('tree_invites').select('*').eq('tree_id', state.treeId).order('created_at');
      if (r.error) throw r.error;
      invites = r.data;
      const g = await sb.from('branch_grants').select('user_id, person_id').eq('tree_id', state.treeId);
      if (!g.error) grants = g.data; // table missing (migration not run) -> just no branch info
    }
    const branchesOf = (userId) =>
      grants
        .filter((g) => g.user_id === userId)
        .map((g) => state.index.byId.get(g.person_id))
        .filter(Boolean);
    const refresh = () => renderShare(body);

    // Invitations are always for ONE e-mail address (single use); there are no open links.
    const email = h('input', { type: 'email', required: true, placeholder: 'البريد الإلكتروني للشخص المدعو', autocomplete: 'off', dir: 'ltr', 'aria-label': 'البريد الإلكتروني' });
    const roleSel = h(
      'select',
      { 'aria-label': 'الدور' },
      h('option', { value: 'viewer', text: 'قارئ (يطّلع فقط)' }),
      h('option', { value: 'editor', text: 'محرّر (يعدّل كل الشجرة)' }),
    );
    const inviteForm = h('form', { class: 'inline-form' }, email, roleSel, h('button', { class: 'btn primary small', type: 'submit', text: 'إنشاء الدعوة' }));
    inviteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      run(async () => {
        const { data: code, error: er } = await sb.rpc('create_invite', { p_tree: state.treeId, p_email: email.value, p_role: roleSel.value });
        if (er) throw er;
        lastInviteResult = { email: email.value.trim().toLowerCase(), url: inviteUrl(code), what: `${ROLE_LABEL[roleSel.value]} في الشجرة كلها` };
        await refresh();
      });
    });

    // a link for ONE person that is not tied to an e-mail: the first who opens it and signs up enters, as a reader
    const openLabel = h('input', { type: 'text', maxlength: 100, placeholder: 'لمن هذا الرابط؟ (اسم للتذكير، اختياري)', autocomplete: 'off', 'aria-label': 'لمن هذا الرابط' });
    const openForm = h('form', { class: 'inline-form' }, openLabel, h('button', { class: 'btn small', type: 'submit', text: 'إنشاء رابط بلا بريد' }));
    openForm.addEventListener('submit', (e) => {
      e.preventDefault();
      run(async () => {
        const { data: code, error: er } = await sb.rpc('create_open_invite', { p_tree: state.treeId, p_label: openLabel.value });
        if (er) throw er;
        lastInviteResult = { email: null, label: openLabel.value.trim(), url: inviteUrl(code), what: 'قارئ في الشجرة كلها' };
        await refresh();
      });
    });
    const memberName = (uid) => members.find((m) => m.user_id === uid)?.profile?.display_name || null;

    const inviteSection = isAdmin
      ? [
          lastInviteResult && inviteResultNode(lastInviteResult),
          h('div', { class: 'section-title', text: 'دعوة شخص بالبريد' }),
          inviteForm,
          h('p', { class: 'muted small-note', text: 'الدعوة لبريد واحد محدد فقط: لا يعمل رابطها مع أي بريد آخر، وينتهي بعد أول استخدام. لإعطاء شخص صلاحية على فرع معيّن افتح بطاقة الاسم واختر «دعوة وصلاحيات هذا الفرع».' }),
          h('div', { class: 'section-title', text: 'أو رابط بلا بريد لشخص واحد' }),
          openForm,
          h('p', { class: 'muted small-note', text: 'يعمل مرة واحدة: أول من يفتح الرابط وينشئ حسابه ببريده الخاص يدخل الشجرة بدور «قارئ» (كأنك قبلتَ طلبه)، ثم ينتهي الرابط. أرسله للشخص الذي تقصده وحده، فمن يصل إليه أولًا يستخدمه. تغيّر دوره لاحقًا من قائمة الأعضاء.' }),
          invites.length > 0 && h('div', { class: 'section-title', text: 'الدعوات' }),
          invites.length > 0 && h('ul', { class: 'list' }, [...invites].reverse().map((iv) => inviteRow(iv, refresh, memberName))),
        ]
      : [];

    const memberSection = [
      h('div', { class: 'section-title', text: `الأعضاء (${members.length})` }),
      h(
        'ul',
        { class: 'list' },
        members.map((m) => {
          const me = m.user_id === state.user.id;
          const roleSel = isAdmin
            ? (() => {
                const s = h('select', { 'aria-label': 'الدور' }, Object.entries(ROLE_LABEL).map(([v, t]) => h('option', { value: v, text: t })));
                s.value = m.role;
                s.addEventListener('change', () =>
                  run(async () => {
                    const { error: e } = await sb.from('tree_members').update({ role: s.value }).eq('tree_id', state.treeId).eq('user_id', m.user_id);
                    if (e) throw e;
                    if (me) state.role = s.value;
                    await refresh();
                  }).finally(refresh),
                );
                return s;
              })()
            : h('span', { class: 'badge', text: ROLE_LABEL[m.role] });
          const canRemove = isAdmin || me;
          return h(
            'li',
            {},
            h(
              'span',
              { class: 'grow' },
              (m.profile?.display_name || 'بدون اسم') + (me ? ' (أنت)' : ''),
              m.role === 'viewer' &&
                branchesOf(m.user_id).length > 0 &&
                h('small', { class: 'muted', style: 'display:block' }, 'محرّر فرع: ', branchesOf(m.user_id).map((b, i) => [i ? '، ' : '', branchLink(b)])),
            ),
            roleSel,
            canRemove &&
              h('button', {
                class: 'btn small danger',
                type: 'button',
                text: me ? 'مغادرة' : 'إزالة',
                onclick: async () => {
                  if (!(await confirmBox(me ? 'مغادرة الشجرة' : 'إزالة عضو', me ? 'ستفقد الوصول إلى هذه الشجرة.' : `ستُزال ${m.profile?.display_name || 'هذا العضو'} من الشجرة.`, me ? 'مغادرة' : 'إزالة', true))) return;
                  await run(async () => {
                    const { error: e } = await sb.from('tree_members').delete().eq('tree_id', state.treeId).eq('user_id', m.user_id);
                    if (e) throw e;
                    if (me) return location.reload();
                    await refresh();
                  });
                },
              }),
          );
        }),
      ),
    ];

    put(body, ...inviteSection, ...memberSection);
  } catch (ex) {
    put(body, h('p', { class: 'error', text: friendly(ex) }));
  }
}

// ====================================================================
// comments, error reports, access requests, inbox
// (rules live in supabase/007_requests_reports_comments.sql)
// ====================================================================

const hasBackend = () => !DEMO || FAKE_BACKEND;
const fmtDate = (iso) => new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/** user id -> display name for the members of this tree (cached per tree). */
async function memberNames(force = false) {
  if (!force && state.names && state.namesTree === state.treeId) return state.names;
  const { data } = await sb.from('tree_members').select('user_id, profile:profiles(display_name)').eq('tree_id', state.treeId);
  state.names = new Map((data || []).map((m) => [m.user_id, m.profile?.display_name || 'بدون اسم']));
  state.namesTree = state.treeId;
  return state.names;
}

// ---------- comments on a card ----------

const commentDrafts = new Map(); // personId -> unsent text, kept while the panel re-renders
const commentCache = new Map(); // personId -> { rows, at }

/**
 * The comments box of the side panel. Shows what we already have at once, then refreshes it.
 * Every member of the tree can read and write; you delete your own, the admin deletes any.
 */
function commentsBox(person) {
  const box = h('div', { class: 'comments' });
  const draft = h('textarea', { maxlength: 1000, rows: 2, placeholder: 'اكتب تعليقًا يراه أعضاء العائلة…', 'aria-label': 'تعليق جديد' });
  draft.value = commentDrafts.get(person.id) || '';
  draft.addEventListener('input', () => commentDrafts.set(person.id, draft.value));
  const send = h('button', { class: 'btn small primary', type: 'button', text: 'إضافة تعليق' });
  const list = h('ul', { class: 'list comment-list' });

  const paint = (rows, names) => {
    put(list, 
      ...(rows.length
        ? rows.map((c) => {
            const mine = c.user_id === state.user.id;
            return h(
              'li',
              { class: 'comment' },
              h('div', { class: 'grow' }, h('strong', { text: names.get(c.user_id) || 'عضو سابق' }), h('small', { class: 'muted', style: 'display:block', text: fmtDate(c.created_at) }), h('p', { class: 'comment-body', text: c.body })),
              (mine || state.role === 'admin') &&
                h('button', {
                  class: 'mini-btn danger',
                  type: 'button',
                  title: 'حذف التعليق',
                  'aria-label': 'حذف التعليق',
                  onclick: async () => {
                    if (!(await confirmBox('حذف التعليق', 'سيُحذف هذا التعليق لكل أعضاء العائلة.', 'حذف', true))) return;
                    await run(async () => {
                      const { error } = await sb.from('card_comments').delete().eq('id', c.id);
                      if (error) throw error;
                      await refresh();
                    });
                  },
                }, icon('x'), 'حذف'),
            );
          })
        : [h('li', { class: 'muted', text: 'لا توجد تعليقات بعد.' })]),
    );
  };

  async function refresh() {
    const [{ data, error }, names] = await Promise.all([
      sb.from('card_comments').select('*').eq('tree_id', state.treeId).eq('person_id', person.id).order('created_at'),
      memberNames(),
    ]);
    if (error) return put(list, h('li', { class: 'muted', text: 'تعذّر تحميل التعليقات.' }));
    commentCache.set(person.id, { rows: data, at: Date.now() });
    paint(data, names);
  }

  send.addEventListener('click', () =>
    run(async () => {
      const body = draft.value.trim();
      if (!body) return;
      send.disabled = true;
      try {
        const { error } = await sb.from('card_comments').insert({ tree_id: state.treeId, person_id: person.id, body });
        if (error) throw error;
        draft.value = '';
        commentDrafts.delete(person.id);
        await refresh();
      } finally {
        send.disabled = false;
      }
    }),
  );

  const cached = commentCache.get(person.id);
  if (cached && state.names) paint(cached.rows, state.names);
  else put(list, h('li', { class: 'muted', text: 'جارٍ التحميل…' }));
  if (!cached || Date.now() - cached.at > 20000) refresh();

  box.append(list, draft, h('div', { class: 'modal-foot', style: 'justify-content:flex-start' }, send));
  return box;
}

// ---------- report an error on a card ----------

function openReportDialog(person) {
  const text = h('textarea', { maxlength: 1000, rows: 5, required: true, placeholder: 'اشرح الخطأ: ما المعلومة الخاطئة وما الصحيح في رأيك؟' });
  const err = h('div', { class: 'error', role: 'alert' });
  const send = h('button', { class: 'btn primary', type: 'submit', text: 'إرسال البلاغ' });
  const form = h(
    'form',
    {},
    h('p', { class: 'muted', text: `سيصل بلاغك إلى مدير الشجرة ومن يملك تعديل بطاقة «${fullName(person)}». لا يتغير شيء في البطاقة قبل أن يراجعه أحدهم.` }),
    field('ما الخطأ؟', text),
    err,
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close(), text: 'إلغاء' }), send),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    send.disabled = true;
    try {
      const { error } = await sb.rpc('report_card_error', { p_tree: state.treeId, p_person: person.id, p_message: text.value });
      if (error) throw error;
      dlg.close();
      toast('شكرًا، وصل بلاغك إلى المسؤولين');
      refreshInbox();
    } catch (ex) {
      err.textContent = friendly(ex);
      send.disabled = false;
    }
  });
  const dlg = modal(`الإبلاغ عن خطأ في «${fullName(person)}»`, form, { backdropClose: false });
  text.focus();
}

// ---------- ask for rights on a branch ----------

function openRequestDialog(person) {
  const seq = ++fieldSeq;
  const boxes = {};
  const right = (f, label, checked) => {
    const cb = h('input', { type: 'checkbox', id: `rq${seq}${f}` });
    cb.checked = checked;
    boxes[f] = cb;
    return h('label', { class: 'right', for: cb.id }, cb, label);
  };
  const msg = h('textarea', { maxlength: 500, rows: 3, placeholder: 'لماذا تطلب هذه الصلاحية؟ (اختياري لكنه يساعد على الموافقة)' });
  const err = h('div', { class: 'error', role: 'alert' });
  const send = h('button', { class: 'btn primary', type: 'submit', text: 'إرسال الطلب' });
  const name = fullName(person);
  const form = h(
    'form',
    {},
    h('p', {}, `بموافقة المدير تستطيع التصرف في كل من يندرج تحت «${name}». لن تستطيع تعديل بطاقة «${name}» نفسها ولا ما فوقها، وتبقى قارئًا لبقية الشجرة.`),
    h('div', { class: 'section-title', text: 'ما الذي تطلبه؟' }),
    h('div', { class: 'rights' }, right('add', 'إضافة', true), right('edit', 'تعديل', true), right('delete', 'حذف', false)),
    field('رسالة للمدير', msg),
    err,
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close(), text: 'إلغاء' }), send),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    send.disabled = true;
    try {
      const { error } = await sb.rpc('request_branch_access', { p_tree: state.treeId, p_person: person.id, p_add: boxes.add.checked, p_edit: boxes.edit.checked, p_delete: boxes.delete.checked, p_message: msg.value });
      if (error) throw error;
      dlg.close();
      toast('أُرسل طلبك. ستجد قرار المدير في صندوق الوارد');
      refreshInbox();
    } catch (ex) {
      err.textContent = friendly(ex);
      send.disabled = false;
    }
  });
  const dlg = modal(`طلب صلاحية على فرع «${name}»`, form, { backdropClose: false });
}

// ---------- inbox ----------

const REQUEST_STATUS = { pending: 'بانتظار القرار', approved: 'مقبول', rejected: 'مرفوض', cancelled: 'ملغى' };

/** Requests I may decide + reports I may handle + my own requests. RLS already filters what I can see. */
async function loadInbox() {
  const jq = state.role === 'admin' ? sb.from('join_requests').select('*').eq('tree_id', state.treeId).order('created_at', { ascending: false }).limit(100) : Promise.resolve({ data: [] });
  const [rq, rp, jr] = await Promise.all([
    sb.from('access_requests').select('*').eq('tree_id', state.treeId).order('created_at', { ascending: false }).limit(100),
    sb.from('card_reports').select('*').eq('tree_id', state.treeId).order('created_at', { ascending: false }).limit(100),
    jq,
  ]);
  const me = state.user.id;
  const requests = rq.data || [];
  const reports = rp.data || [];
  const handles = (r) => {
    const p = state.index?.byId.get(r.person_id);
    return state.role === 'admin' || state.role === 'editor' || (!!p && state.perms.canWritePerson(p));
  };
  return {
    toDecide: requests.filter((r) => r.user_id !== me),
    mine: requests.filter((r) => r.user_id === me),
    reports: reports.filter(handles),
    myReports: reports.filter((r) => r.user_id === me),
    joins: jr.error ? [] : (jr.data || []).filter((r) => r.status !== 'draft'), // a draft never got its document
  };
}

/** Updates the number on the bell in the top bar. */
async function refreshInbox() {
  if (!ui.bellBadge || !hasBackend()) return;
  try {
    const inbox = await loadInbox();
    const n = inbox.toDecide.filter((r) => r.status === 'pending').length + inbox.reports.filter((r) => r.status === 'open').length + inbox.joins.filter((r) => r.status === 'pending').length;
    for (const b of [ui.bellBadge, ui.navBadge]) {
      if (!b) continue;
      b.textContent = n > 99 ? '99+' : String(n);
      b.hidden = n === 0;
    }
  } catch {
    /* the bell is a convenience: never break the page over it */
  }
}

async function openInbox() {
  const body = h('div', {}, h('p', { class: 'muted', text: 'جارٍ التحميل…' }));
  modal('صندوق الوارد', body);
  await renderInbox(body, 'requests');
}

async function renderInbox(body, tab) {
  try {
    const [inbox, names] = await Promise.all([loadInbox(), memberNames(true)]);
    const again = () => Promise.all([renderInbox(body, tab), refreshInbox()]);
    const personName = (id) => {
      const p = state.index?.byId.get(id);
      return p ? fullName(p) : 'شخص محذوف';
    };
    const cardLink = (id) =>
      h('button', { class: 'link-btn', type: 'button', text: personName(id), onclick: () => goToCard(id) });

    const canDecide = inbox.toDecide.length > 0;
    const pendingN = inbox.toDecide.filter((r) => r.status === 'pending').length;
    const openN = inbox.reports.filter((r) => r.status === 'open').length;
    const tabs = [
      canDecide || state.role === 'admin' ? ['requests', `طلبات الصلاحية${pendingN ? ` (${pendingN})` : ''}`] : null,
      inbox.reports.length || state.role === 'admin' || state.role === 'editor' ? ['reports', `بلاغات الأخطاء${openN ? ` (${openN})` : ''}`] : null,
      state.role === 'admin' && (currentTree()?.public_page || inbox.joins.length) ? ['joins', `طلبات الانضمام${inbox.joins.filter((r) => r.status === 'pending').length ? ` (${inbox.joins.filter((r) => r.status === 'pending').length})` : ''}`] : null,
      ['mine', 'طلباتي وبلاغاتي'],
    ].filter(Boolean);
    if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];

    const seg = h('div', { class: 'seg', role: 'tablist' }, tabs.map(([k, t]) => h('button', { type: 'button', role: 'tab', 'aria-pressed': String(tab === k), onclick: () => renderInbox(body, k), text: t })));

    // --- requests waiting for me
    const requestRow = (r) => {
      const who = names.get(r.user_id) || 'عضو';
      const person = state.index?.byId.get(r.person_id);
      const wants = rightsText({ add: r.can_add, edit: r.can_edit, delete: r.can_delete });
      return h(
        'li',
        { class: 'inbox-item' },
        h(
          'div',
          { class: 'grow' },
          h('strong', { text: who }),
          ' يطلب صلاحية ',
          h('b', { text: wants }),
          ' على فرع ',
          cardLink(r.person_id),
          h('small', { class: 'muted', style: 'display:block', text: `${fmtDate(r.created_at)} · ${REQUEST_STATUS[r.status]}` }),
          r.message && h('p', { class: 'comment-body', text: `«${r.message}»` }),
          r.decision_note && h('p', { class: 'muted small-note', text: `ملاحظة القرار: ${r.decision_note}` }),
        ),
        r.status === 'pending' && person && h('button', { class: 'btn small primary', type: 'button', onclick: () => openDecision(r, person, who, again), text: 'مراجعة' }),
      );
    };

    // --- reports I can handle
    const reportRow = (r) =>
      h(
        'li',
        { class: `inbox-item${r.status === 'open' ? '' : ' done'}` },
        h(
          'div',
          { class: 'grow' },
          h('strong', { text: names.get(r.user_id) || 'عضو' }),
          ' بلّغ عن خطأ في ',
          cardLink(r.person_id),
          h('small', { class: 'muted', style: 'display:block', text: `${fmtDate(r.created_at)} · ${r.status === 'open' ? 'مفتوح' : 'تمت المعالجة'}` }),
          h('p', { class: 'comment-body', text: r.message }),
          r.resolution_note && h('p', { class: 'muted small-note', text: `ملاحظة: ${r.resolution_note}` }),
        ),
        h('button', {
          class: 'btn small',
          type: 'button',
          text: r.status === 'open' ? 'تمت المعالجة' : 'إعادة فتح',
          onclick: () =>
            run(async () => {
              const { error } = await sb.rpc('set_report_status', { p_id: r.id, p_status: r.status === 'open' ? 'resolved' : 'open', p_note: null });
              if (error) throw error;
              await again();
            }),
        }),
      );

    // --- my own requests and reports
    const myRequestRow = (r) =>
      h(
        'li',
        { class: 'inbox-item' },
        h('div', { class: 'grow' }, 'طلبت صلاحية ', h('b', { text: rightsText({ add: r.can_add, edit: r.can_edit, delete: r.can_delete }) }), ' على فرع ', cardLink(r.person_id), h('small', { class: 'muted', style: 'display:block', text: `${fmtDate(r.created_at)} · ${REQUEST_STATUS[r.status]}` }), r.decision_note && h('p', { class: 'muted small-note', text: `ملاحظة القرار: ${r.decision_note}` })),
        r.status === 'pending' &&
          h('button', {
            class: 'btn small danger',
            type: 'button',
            text: 'إلغاء الطلب',
            onclick: () =>
              run(async () => {
                const { error } = await sb.rpc('cancel_access_request', { p_id: r.id });
                if (error) throw error;
                await again();
              }),
          }),
      );
    const myReportRow = (r) =>
      h('li', { class: 'inbox-item' }, h('div', { class: 'grow' }, 'بلّغت عن خطأ في ', cardLink(r.person_id), h('small', { class: 'muted', style: 'display:block', text: `${fmtDate(r.created_at)} · ${r.status === 'open' ? 'قيد المراجعة' : 'تمت المعالجة'}` }), h('p', { class: 'comment-body', text: r.message })));

    const section = (title, rows, render, empty) => [h('div', { class: 'section-title', text: title }), rows.length ? h('ul', { class: 'list' }, rows.map(render)) : h('p', { class: 'muted', text: empty })];

    // --- requests to join the family (admin)
    const joinRowNode = (r) =>
      h(
        'li',
        { class: 'inbox-item join-item' },
        h(
          'div',
          { class: 'grow' },
          h('strong', { text: r.full_name }),
          h('small', { class: 'muted', style: 'display:block', text: `${fmtDate(r.created_at)} · ${JOIN_STATUS[r.status] || r.status}` }),
          h(
            'dl',
            { class: 'dl' },
            [
              ['صلته بالعائلة', r.relation],
              ['مكان الإقامة', [r.residence_city, countryLabel(r.residence_country)].filter(Boolean).join('، ')],
              ['الهاتف', r.phone],
              ['البريد للتواصل', r.contact_email],
            ].map(([k, v]) => [h('dt', { text: k }), h('dd', { class: k === 'صلته بالعائلة' ? 'pre' : '', text: v || '—' })]),
          ),
          r.decision_note && h('p', { class: 'muted small-note', text: `ملاحظة القرار: ${r.decision_note}` }),
          !r.phone && !r.contact_email && h('p', { class: 'muted small-note', text: 'لم يكتب هاتفًا ولا بريدًا: لا يمكنك مراسلته، وهو يتابع طلبه برقم المتابعة وحده.' }),
          r.status === 'approved' && !r.invite_code && h('p', { class: 'muted small-note', text: 'وافقتَ على الطلب. ينتظر أن يكتب بريده في صفحة المتابعة فتُنشأ له الدعوة تلقائيًا.' }),
          r.invite_claimed && h('p', { class: 'muted small-note', text: 'هذا البريد كتبه صاحب الطلب بنفسه بعد الموافقة.' }),
          h(
            'div',
            { class: 'join-actions' },
            r.doc_path && h('button', { class: 'btn small', type: 'button', text: 'عرض الوثيقة', onclick: () => openJoinDoc(r) }),
            !r.doc_path && r.status === 'pending' && h('span', { class: 'muted small-note', text: 'لم يرفق وثيقة' }),
            r.status === 'approved' && r.invite_code && h('button', { class: 'btn small', type: 'button', text: 'رابط الدعوة', onclick: () => showJoinInvite(r, r.invite_code) }),
            r.status === 'pending' && h('button', { class: 'btn small primary', type: 'button', text: 'قبول', onclick: () => openJoinDecision(r, true, again) }),
            r.status === 'pending' && h('button', { class: 'btn small danger', type: 'button', text: 'رفض', onclick: () => openJoinDecision(r, false, again) }),
          ),
        ),
      );

    const content =
      tab === 'joins'
        ? [...section('بانتظار قرارك', inbox.joins.filter((r) => r.status === 'pending'), joinRowNode, 'لا توجد طلبات انضمام بانتظارك.'), ...section('القرارات السابقة', inbox.joins.filter((r) => r.status !== 'pending').slice(0, 20), joinRowNode, 'لا شيء بعد.')]
        : tab === 'requests'
        ? [...section('بانتظار قرارك', inbox.toDecide.filter((r) => r.status === 'pending'), requestRow, 'لا توجد طلبات بانتظارك.'), ...section('القرارات السابقة', inbox.toDecide.filter((r) => r.status !== 'pending').slice(0, 20), requestRow, 'لا شيء بعد.')]
        : tab === 'reports'
          ? [...section('مفتوحة', inbox.reports.filter((r) => r.status === 'open'), reportRow, 'لا توجد بلاغات مفتوحة.'), ...section('تمت معالجتها', inbox.reports.filter((r) => r.status !== 'open').slice(0, 20), reportRow, 'لا شيء بعد.')]
          : [...section('طلباتي', inbox.mine, myRequestRow, 'لم تطلب أي صلاحية بعد. افتح بطاقة واختر «طلب صلاحية على هذا الفرع».'), ...section('بلاغاتي', inbox.myReports, myReportRow, 'لم تبلّغ عن أي خطأ بعد.')];

    put(body, seg, ...content);
  } catch (ex) {
    put(body, h('p', { class: 'error', text: friendly(ex) }));
  }
}

/** Approve (choosing the rights) or reject one request. The database refuses anything above my own rights. */
/** The invitation of an accepted applicant: the link, to copy or send by WhatsApp / e-mail. */
function showJoinInvite(r, inviteCode) {
  const url = inviteUrl(inviteCode);
  const wa = whatsappLink(r.phone, inviteMessage(r.full_name, url));
  modal(`دعوة ${r.full_name}`, inviteResultNode({ email: r.contact_email, url, what: 'قارئ في الشجرة' }, { whatsapp: wa }));
}

/** The proof document of a request: a link that works for five minutes, opened in a new tab. */
async function openJoinDoc(r) {
  await run(async () => {
    const { data, error } = await sb.storage.from('join-docs').createSignedUrl(r.doc_path, 300);
    if (error) throw error;
    window.open(data.signedUrl, '_blank', 'noopener');
  });
}

/** Approve or refuse a request to join. The document is deleted afterwards. */
function openJoinDecision(r, approve, after) {
  const note = h('input', { type: 'text', maxlength: 500, placeholder: approve ? 'ملاحظة (اختياري)' : 'سبب الرفض (يراه صاحب الطلب)' });
  const err = h('div', { class: 'error', role: 'alert' });
  const go = h('button', { class: `btn ${approve ? 'primary' : 'danger'}`, type: 'button', text: approve ? (r.contact_email ? 'قبول وإنشاء الدعوة' : 'قبول الطلب') : 'رفض الطلب' });
  go.addEventListener('click', async () => {
    go.disabled = true;
    err.textContent = '';
    try {
      const { data: res, error } = await sb.rpc('decide_join_request', { p_id: r.id, p_approve: approve, p_note: note.value });
      if (error) throw error;
      try {
        await dropJoinDoc(r.id, res?.doc_path);
      } catch {
        /* the decision is saved; a document that could not be deleted stays for the admin to remove */
      }
      dlg.close();
      toast(!approve ? 'رُفض الطلب' : res?.invite_code ? 'تمت الموافقة وأُنشئت الدعوة' : 'تمت الموافقة. يكتب صاحب الطلب بريده في صفحة المتابعة');
      await after();
      if (approve && res?.invite_code) showJoinInvite(r, res.invite_code);
    } catch (ex) {
      err.textContent = friendly(ex);
      go.disabled = false;
    }
  });
  const dlg = modal(
    approve ? `قبول طلب ${r.full_name}` : `رفض طلب ${r.full_name}`,
    h(
      'div',
      { class: 'stack' },
      approve
        ? h('p', {
            text: r.contact_email
              ? 'تُنشأ له دعوة خاصة ببريده (تُستخدم مرة واحدة) ويظهر له رابطها في صفحة المتابعة، وتجد رابطها هنا لترسله له على واتساب أو بريده. يدخل الشجرة بدور «قارئ»، ويمكنك لاحقًا منحه صلاحية على فرع معيّن.'
              : `لم يكتب بريدًا، فلا تُنشأ الدعوة الآن: تظهر له الموافقة في صفحة المتابعة (برقم المتابعة) ويكتب هناك بريده فتُنشأ له دعوة تلقائيًا، ويدخل الشجرة بدور «قارئ».${r.phone ? ' وقد كتب هاتفًا، فيمكنك إبلاغه ليفتح صفحة المتابعة.' : ''}`,
          })
        : h('p', { text: 'لن يدخل الشجرة، وسيرى سبب الرفض إن كتبتَه، ويستطيع تقديم طلب جديد.' }),
      h('p', { class: 'muted small-note', text: 'تُحذف الوثيقة المرفقة (إن وُجدت) بعد القرار.' }),
      field('ملاحظة', note),
      err,
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close(), text: 'رجوع' }), go),
    ),
    { backdropClose: false },
  );
}

function openDecision(r, person, who, after) {
  const allowed = state.perms.delegableFlags(person) || {};
  const seq = ++fieldSeq;
  const boxes = {};
  const right = (f, label) => {
    const cb = h('input', { type: 'checkbox', id: `dc${seq}${f}` });
    cb.checked = !!(f === 'add' ? r.can_add : f === 'edit' ? r.can_edit : f === 'delete' ? r.can_delete : false) && !!allowed[f];
    cb.disabled = !allowed[f];
    boxes[f] = cb;
    return h('label', { class: 'right', for: cb.id, title: allowed[f] ? '' : 'لا تملك هذه الصلاحية لتمنحها' }, cb, label);
  };
  const note = h('input', { type: 'text', maxlength: 500, placeholder: 'ملاحظة للطالب (اختياري)' });
  const err = h('div', { class: 'error', role: 'alert' });
  const decide = (approve) =>
    (async () => {
      err.textContent = '';
      try {
        const { error } = await sb.rpc('decide_access_request', { p_id: r.id, p_approve: approve, p_add: boxes.add.checked, p_edit: boxes.edit.checked, p_delete: boxes.delete.checked, p_grant: boxes.grant.checked, p_note: note.value });
        if (error) throw error;
        dlg.close();
        toast(approve ? 'تمت الموافقة ومُنحت الصلاحية' : 'رُفض الطلب');
        await after();
      } catch (ex) {
        err.textContent = friendly(ex);
      }
    })();
  const dlg = modal(
    `طلب من ${who}`,
    h(
      'div',
      { class: 'stack' },
      h('p', {}, `يطلب ${rightsText({ add: r.can_add, edit: r.can_edit, delete: r.can_delete })} على فرع «`, branchLink(person), '».'),
      r.message && h('p', { class: 'comment-body', text: `«${r.message}»` }),
      h('div', { class: 'section-title', text: 'الصلاحيات التي تمنحها' }),
      h('div', { class: 'rights' }, right('add', 'إضافة'), right('edit', 'تعديل'), right('delete', 'حذف'), right('grant', 'منح صلاحيات للآخرين')),
      h('p', { class: 'muted small-note', text: 'يستطيع التصرف فقط فيمن يندرج تحت هذه البطاقة، لا في البطاقة نفسها ولا ما فوقها. يمكنك سحب الصلاحية لاحقًا من «دعوة وصلاحيات هذا الفرع».' }),
      field('ملاحظة', note),
      err,
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn danger', type: 'button', onclick: () => decide(false), text: 'رفض' }), h('button', { class: 'btn primary', type: 'button', onclick: () => decide(true), text: 'قبول' })),
    ),
  );
}

// ====================================================================
// history
// ====================================================================

const FIELD_LABEL = {
  first_name: 'الاسم', last_name: 'اللقب', nickname: 'اللقب المشتهر به', gender: 'الجنس', father_id: 'الأب', mother_id: 'الأم',
  birth_date: 'تاريخ الميلاد', birth_place: 'مكان الميلاد', residence_country: 'بلد الإقامة', residence_city: 'مدينة الإقامة',
  is_deceased: 'حالة الوفاة', death_date: 'تاريخ الوفاة', photo_url: 'الصورة', notes: 'الملاحظات',
  status: 'حالة الزواج', marriage_date: 'تاريخ الزواج',
};
const VERB = { INSERT: 'أضاف', UPDATE: 'عدّل', DELETE: 'حذف' };

function describeChange(row) {
  const d = row.new_data || row.old_data || {};
  let what;
  if (row.table_name === 'persons') what = `«${fullName(d)}»`;
  else {
    const a = state.index?.byId.get(d.person_a);
    const b = state.index?.byId.get(d.person_b);
    what = `زواج ${a ? `«${fullName(a)}»` : ''}${a && b ? ' و' : ''}${b ? `«${fullName(b)}»` : ''}`.trim();
  }
  let extra = '';
  if (row.action === 'UPDATE' && row.old_data && row.new_data) {
    const keys = Object.keys(FIELD_LABEL).filter((k) => JSON.stringify(row.old_data[k]) !== JSON.stringify(row.new_data[k]));
    if (keys.length) extra = ` (${keys.map((k) => FIELD_LABEL[k]).join('، ')})`;
  }
  return `${VERB[row.action]} ${what}${extra}`;
}

async function openHistory() {
  const body = h('div', {}, h('p', { class: 'muted', text: 'جارٍ التحميل…' }));
  modal('سجل التعديلات', body);
  await renderHistory(body, 'all');
}

/** The change log. Admins get an "undo" button on every action (also for deletions). */
async function renderHistory(body, filter) {
  try {
    const [logRes, memRes] = await Promise.all([
      sb.from('change_log').select('*').eq('tree_id', state.treeId).order('id', { ascending: false }).limit(300),
      sb.from('tree_members').select('user_id, profile:profiles(display_name)').eq('tree_id', state.treeId),
    ]);
    if (logRes.error) throw logRes.error;
    const names = new Map((memRes.data || []).map((m) => [m.user_id, m.profile?.display_name]));
    const fmt = new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
    const isAdmin = state.role === 'admin';
    const groups = groupChanges(logRes.data);
    // a deleted person / marriage that is back in the tree (restored) leaves the "deleted" list, but stays in the log
    const exists = (r) => (r.table_name === 'persons' ? state.persons : state.marriages).has(r.record_id);
    const shown = filter === 'deleted' ? deletedGroups(groups, exists) : groups;

    const undo = (g) => async () => {
      const who = names.get(g.primary.user_id) || 'مستخدم';
      const ok = await confirmBox(
        'التراجع عن هذا التغيير',
        `سيعود كل شيء إلى ما كان عليه قبل: ${who} ${describeChange(g.primary)}${sideEffects(g)}. إن كان قد تغيّر شيء بعده فسيُرفض التراجع، وعندها تراجع عن التغييرات الأحدث أولًا.`,
        'تراجع',
      );
      if (!ok) return;
      await run(async () => {
        const { error } = await sb.rpc('revert_change', { p_tree: state.treeId, p_log_id: g.primary.id });
        if (error) throw error;
        toast('تم التراجع');
        await loadTreeData();
        rebuild();
        await renderHistory(body, filter);
      });
    };

    const seg = h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'عرض' },
      [['all', 'الكل'], ['deleted', 'المحذوفات']].map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(filter === k), onclick: () => renderHistory(body, k), text: t })),
    );

    put(body, 
      seg,
      shown.length
        ? h(
            'ul',
            { class: 'list' },
            shown.map((g) => {
              const r = g.primary;
              return h(
                'li',
                { class: `log-item${r.action === 'DELETE' && !exists(r) ? ' deleted' : ''}` },
                h('div', { class: 'grow' }, h('strong', { text: names.get(r.user_id) || 'مستخدم' }), ` ${describeChange(r)}${sideEffects(g)}`, h('small', { text: fmt.format(new Date(r.created_at)) })),
                r.action === 'DELETE' && exists(r)
                  ? h('span', { class: 'badge', text: 'تم استرجاعه' }) // nothing left to undo: it is back
                  : isAdmin && h('button', { class: 'btn small', type: 'button', onclick: undo(g), text: 'تراجع' }),
              );
            }),
          )
        : h('p', { class: 'muted', text: filter === 'deleted' ? 'لا توجد عناصر محذوفة.' : 'لا توجد تعديلات بعد.' }),
      h('p', { class: 'muted small-note', text: isAdmin ? 'يظهر آخر 300 تغيير. التراجع يشمل كل ما ارتبط بالتغيير (مثل أبناء محذوف)، ويُسجَّل هو أيضًا فيمكن التراجع عنه.' : 'يظهر آخر 300 تغيير. المدير وحده يستطيع التراجع.' }),
    );
  } catch (ex) {
    put(body, h('p', { class: 'error', text: friendly(ex) }));
  }
}

// ====================================================================
// start
// ====================================================================

async function init() {
  if (OFFLINE) {
    try {
      offlineSnap = await idb.get('snapshot');
    } catch {
      offlineSnap = null;
    }
    if (!offlineSnap || offlineSnap.userId !== authUserId()) return leaveOffline(); // no copy, or not this person's: the normal start
    state.user = { id: offlineSnap.userId };
    state.profile = { display_name: offlineSnap.displayName, look: offlineSnap.lookMine };
    state.offlineAt = offlineSnap.savedAt;
    state.memberships = [{ role: 'viewer', tree: offlineSnap.tree }];
    window.addEventListener('online', () => {
      toast('عاد الاتصال، جارٍ فتح الشجرة الكاملة…');
      setTimeout(leaveOffline, 800);
    });
    await openTree(offlineSnap.treeId);
    return;
  }
  if (DEMO_LANDING) {
    sb = makeFakeSb('u9', { publicPage: true }); // a make-believe public tree, a visitor who may ask to join
    return showLanding();
  }
  if (DEMO) {
    state.user = { id: location.hash === '#/demo-branch' ? 'u2' : 'u1' };
    if (FAKE_BACKEND) sb = makeFakeSb(state.user.id);
    state.memberships = [{ role: DEMO_ROLE, tree: { id: 'demo', name: 'عائلة الراشد (عرض تجريبي)', about: demoAbout } }];
    await openTree('demo');
    return;
  }

  if (!navigator.onLine && hasSnapshot()) return goOffline(); // no connection and a copy on this device: open it
  readHash();
  window.addEventListener('hashchange', () => {
    if (readHash() && state.user) boot();
  });

  // a visitor keeps seeing the static page (index.html) until the front page is ready; a returning member sees 'loading'
  if (Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k))) mount(loadingScreen());
  let createClient;
  try {
    ({ createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'));
  } catch {
    if (hasSnapshot()) return goOffline(); // the connection is down: the copy kept on this device
    mount(h('div', { class: 'center' }, h('div', { class: 'auth-card' }, brand(), h('p', { class: 'error', text: 'تعذّر الاتصال بالإنترنت' }), h('button', { class: 'btn block', onclick: () => location.reload(), text: 'إعادة المحاولة' }))));
    return;
  }
  sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Do not await Supabase calls inside this callback (supabase-js would deadlock) -> defer with setTimeout.
  sb.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      if (state.user?.id !== session.user.id) {
        state.user = session.user;
        setTimeout(boot, 0);
      }
    } else if (state.user) {
      dropSnapshot();
      state.user = null;
      state.profile = null;
      state.memberships = [];
      teardownTree();
      showFront();
    }
  });
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) showFront();
}

// ---------- the app on the phone (manifest.webmanifest, sw.js) ----------

let installOffer = null; // the browser's own "install" prompt, kept until the person asks for it
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installOffer = e;
});
window.addEventListener('appinstalled', () => (installOffer = null));

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

/** The copy of the tree kept on this device for reading without a connection: on by default, and the person can turn it off. */
function offlineSection() {
  return [
    h('div', { class: 'section-title', text: 'القراءة دون اتصال' }),
    h(
      'ul',
      { class: 'settings' },
      settingRow({
        title: 'حفظ نسخة من الشجرة على هذا الجهاز',
        desc: 'عند انقطاع الإنترنت تفتح الشجرة من هذه النسخة للقراءة فقط (دون الصور). تبقى على جهازك وحده ولا تُرسل لأحد، وتُحذف عند تسجيل الخروج أو عند إيقاف هذا الخيار.',
        checked: offlineWanted(),
        onChange: (on) => {
          remember('ft.offline', on ? '1' : '0');
          if (on) saveSnapshot();
          else dropSnapshot();
        },
      }),
    ),
  ];
}

/** The settings block that helps to put the site on the phone like an app. */
function installSection() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const offerBtn = installOffer
    ? h('button', {
        class: 'btn small primary',
        type: 'button',
        text: 'تثبيت التطبيق الآن',
        onclick: async () => {
          const offer = installOffer;
          installOffer = null;
          offer.prompt();
          await offer.userChoice.catch(() => {});
        },
      })
    : null;
  return [
    h('div', { class: 'section-title', text: 'تطبيق على الجوال' }),
    standalone
      ? h('p', { class: 'muted', text: 'أنت تستخدم التطبيق الآن. أي تحديث للموقع يصلك تلقائيًا عند فتحه.' })
      : h(
          'div',
          { class: 'stack' },
          h('p', { class: 'muted', text: 'ضع الموقع على شاشة جوالك كتطبيق: أيقونة وملء الشاشة، ويتحدّث وحده دون تنزيل شيء.' }),
          offerBtn,
          h('p', { class: 'muted small-note', text: ios ? 'على آيفون (متصفح Safari): اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية».' : 'على أندرويد (متصفح Chrome): اضغط القائمة ⋮ ثم «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».' }),
        ),
  ];
}

init();

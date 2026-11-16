// A long drop-down (a country, a province, a city) with a search box: type some letters and the list is cut down to what matches.
//
// The <select> stays in the page, hidden, and stays the one source of truth: the code that reads select.value, sets it, fills it
// with other options or listens to «change» does not change. This file only draws a button in its place (it shows the choice)
// that opens a panel: a box to type in, and under it the list, filtered as the letters are typed.
import { normalize } from './tree.js';

const stripAl = (s) => (s.startsWith('ال') && s.length > 3 ? s.slice(2) : s);

/**
 * The choices that match what was typed, best first: the text starts with it, then a word of it starts with it, then it appears
 * anywhere (the order they came in is kept inside each group). "ال" at the start of a word does not count («سعود» finds
 * «السعودية»), and neither do accents or the variants of the Arabic letters (normalize). choices = [{ value, text }].
 * Nothing typed = all of them, as they are.
 */
export function filterChoices(choices, query) {
  const q = normalize(query || '');
  if (!q) return choices.slice();
  const ranked = [];
  choices.forEach((c, i) => {
    const t = normalize(c.text);
    let rank = -1;
    if (t.startsWith(q) || stripAl(t).startsWith(q)) rank = 0;
    else if (t.split(' ').some((w) => w.startsWith(q) || stripAl(w).startsWith(q))) rank = 1;
    else if (t.includes(q)) rank = 2;
    if (rank >= 0) ranked.push([rank, i, c]);
  });
  ranked.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return ranked.map((r) => r[2]);
}

/**
 * Puts a searchable list in place of `sel`. If `sel` is already in the page the new box takes its place there; the box is also
 * returned, for a select that is not in the page yet. The id of the select moves to the button (so a label that points at it
 * still works). options: pinned = values that stay at the end of the list whatever is typed (like «غير ذلك (اكتب)»);
 * minForSearch = a list shorter than this has no search box.
 */
export function searchableSelect(sel, { pinned = [], minForSearch = 9 } = {}) {
  const doc = sel.ownerDocument;
  const el = (tag, props = {}, ...kids) => {
    const n = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) n.setAttribute(k, v);
    n.append(...kids);
    return n;
  };
  const label = sel.getAttribute('aria-label') || '';

  const val = el('span', { class: 'ss-val' });
  const btn = el('button', { type: 'button', class: 'ss-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, val);
  if (sel.id) {
    btn.id = sel.id;
    sel.removeAttribute('id');
  }
  const q = el('input', {
    type: 'search', class: 'ss-q', placeholder: 'اكتب للبحث…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    enterkeyhint: 'search', 'aria-label': label ? `بحث: ${label}` : 'بحث',
  });
  const list = el('ul', { class: 'ss-list', role: 'listbox', 'aria-label': label });
  const panel = el('div', { class: 'ss-panel' }, q, list);
  panel.hidden = true;
  const box = el('div', { class: 'ss' });
  if (sel.parentNode) sel.replaceWith(box);
  box.append(sel, btn, panel);

  let open = false;
  let shown = []; // the choices in the list now, in the order they are drawn
  let active = -1; // the one Enter chooses

  const choices = () => [...sel.options].map((o) => ({ value: o.value, text: o.textContent }));

  const sync = () => {
    const o = sel.selectedOptions[0];
    const text = o ? o.textContent : '';
    val.textContent = text;
    btn.classList.toggle('ss-empty', !sel.value);
    btn.setAttribute('aria-label', label ? `${label}: ${text}` : text);
  };

  const setActive = (i, scroll = true) => {
    active = i;
    [...list.children].forEach((li) => li.classList.toggle('on', li._i === i));
    const li = [...list.children].find((x) => x._i === i);
    if (li && scroll) {
      if (li.offsetTop < list.scrollTop) list.scrollTop = li.offsetTop;
      else if (li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight;
    }
  };

  const draw = () => {
    const all = choices();
    const typed = q.value.trim();
    const none = all.filter((c) => c.value === ''); // «— اختر —»: takes the choice back, offered while nothing is typed
    const tail = all.filter((c) => pinned.includes(c.value)); // «غير ذلك (اكتب)»: always offered
    const body = all.filter((c) => c.value !== '' && !pinned.includes(c.value));
    q.hidden = body.length < minForSearch;
    const found = filterChoices(body, typed);
    shown = [...(typed ? [] : none), ...found, ...tail];
    const nodes = shown.map((c, i) => {
      const li = el('li', { role: 'option', class: 'ss-opt', 'aria-selected': String(c.value === sel.value) }, c.text);
      li._i = i;
      return li;
    });
    if (typed && !found.length) nodes.splice(found.length, 0, el('li', { class: 'ss-none', role: 'presentation' }, 'لا توجد نتائج'));
    list.replaceChildren(...nodes);
    // Enter chooses the best match while typing, and the current choice otherwise
    const chosen = shown.findIndex((c) => c.value === sel.value && c.value !== '');
    setActive(typed ? (found.length ? 0 : -1) : chosen, false);
    if (!typed && chosen >= 0) {
      const li = [...list.children].find((x) => x._i === chosen);
      if (li) list.scrollTop = Math.max(0, li.offsetTop - list.clientHeight / 2);
    }
  };

  const onDoc = (e) => {
    if (!box.contains(e.target)) close(false);
  };
  const close = (refocus) => {
    if (!open) return;
    open = false;
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    doc.removeEventListener('pointerdown', onDoc, true);
    if (refocus) btn.focus();
  };
  const openIt = () => {
    open = true;
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    q.value = '';
    draw();
    doc.addEventListener('pointerdown', onDoc, true);
    requestAnimationFrame(() => {
      if (!q.hidden) q.focus({ preventScroll: true });
      panel.scrollIntoView({ block: 'nearest' }); // the panel is not left under the edge of the screen
    });
  };

  const choose = (value) => {
    const changed = sel.value !== value;
    sel.value = value;
    close(true);
    if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
  };

  btn.addEventListener('click', () => (open ? close(false) : openIt()));
  q.addEventListener('input', draw);
  list.addEventListener('click', (e) => {
    const li = e.target.closest?.('.ss-opt');
    if (li && shown[li._i]) choose(shown[li._i].value);
  });
  box.addEventListener('keydown', (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' && e.target === btn) {
        e.preventDefault();
        openIt();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // closes the list, not the sheet it is in
      close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) setActive(Math.min(shown.length - 1, Math.max(0, active + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter') {
      e.preventDefault(); // not the submit of the form
      if (active >= 0 && shown[active]) choose(shown[active].value);
    } else if (e.key === 'Tab') {
      close(false);
    }
  });

  // the code around keeps using the select: whatever it sets or refills shows on the button, and hiding it hides the box
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', {
    configurable: true,
    get() {
      return valueDesc.get.call(this);
    },
    set(v) {
      valueDesc.set.call(this, v);
      sync();
    },
  });
  const hiddenDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
  Object.defineProperty(sel, 'hidden', {
    configurable: true,
    get() {
      return hiddenDesc.get.call(this);
    },
    set(v) {
      hiddenDesc.set.call(this, v);
      box.hidden = !!v;
      if (v) close(false);
    },
  });
  new MutationObserver(() => {
    sync();
    if (open) draw();
  }).observe(sel, { childList: true });

  sync();
  return box;
}

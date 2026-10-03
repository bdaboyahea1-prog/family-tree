// Draws a laid-out tree (see tree.js) and handles pan / pinch / wheel zoom / taps.
import { fullName, lifeSpan, generationName, polar, SPOUSE_COLORS } from './tree.js';
import { genderIcon } from './gender.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const MIN_K = 0.2;
const MAX_K = 2.5;

const wifeColor = (i) => SPOUSE_COLORS[i % SPOUSE_COLORS.length];

const BTN_ICONS = {
  add: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  view: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** The two buttons of a card: add (only where the user may add) and view. */
function makeActions(p, canAdd) {
  const box = el('div', 'acts');
  const btn = (act, label) => {
    const b = el('button', `cbtn ${act}`);
    b.type = 'button';
    b.dataset.act = act;
    b.setAttribute('aria-label', `${label}: ${fullName(p)}`);
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = BTN_ICONS[act];
    b.append(s, el('span', 'lbl', label));
    return b;
  };
  if (canAdd) box.append(btn('add', 'إضافة'));
  box.append(btn('view', 'عرض'));
  return box;
}

/**
 * The card of one person, without a position: the figure (or the photo), the name, the nickname, the years and, when
 * asked, the two buttons. How it looks is decided by the CSS of the look chosen in the settings (js/cardstyles.js).
 */
export function makeCard(p, { photo = null, actions = false, canAdd = false, name = null } = {}) {
  const node = el('div', `card ${p.gender}`);
  if (p.is_deceased) node.classList.add('deceased');
  const avatar = el('div', 'avatar');
  if (photo) {
    const img = el('img');
    img.src = photo;
    img.alt = '';
    img.loading = 'lazy';
    avatar.append(img);
  } else {
    avatar.append(genderIcon(p.gender)); // a man or a woman, not the first letter
  }
  const txt = el('div', 'txt');
  const shown = name ?? fullName(p);
  const nm = el('div', 'nm', shown);
  nm.title = shown; // a long name may be cut on the card: the whole of it is here
  txt.append(nm);
  if (p.nickname) txt.append(el('div', 'nick', p.nickname)); // the name he / she is known by, right under the name
  txt.append(el('div', 'yr', lifeSpan(p))); // empty when nothing is known: some looks still draw the strip
  node.append(avatar, txt);
  if (actions) node.append(makeActions(p, canAdd));
  return node;
}

export class Chart {
  /**
   * @param {HTMLElement} viewport  element that clips and receives gestures
   * @param {{onSelect:(id:string|null)=>void, onToggle:(id:string)=>void, onAction?:(act:'add'|'view', id:string)=>void}} handlers
   */
  constructor(viewport, handlers) {
    this.vp = viewport;
    this.handlers = handlers;
    this.stage = el('div', 'stage');
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('class', 'edges');
    this.stage.append(this.svg);
    this.vp.append(this.stage);
    // not scaled with the drawing: the branch legend, and the generation labels of the bands design
    this.legend = el('div', 'legend');
    this.gens = el('div', 'gens');
    this.vp.append(this.legend, this.gens);
    // curves: connectors are smooth curves (else right angles); actions: the "إضافة" / "عرض" buttons on every card
    this.options = { bands: false, colors: true, years: true, curves: true, actions: false, cardStyle: 'portrait', wifeColors: true };
    this.genRows = [];
    this.genLabels = [];
    // the first view can be asked for while the page is hidden (zero size): redo it once it has a size
    this.needsFocus = false;
    new ResizeObserver(() => {
      if (this.needsFocus && this.vp.clientWidth && this.vp.clientHeight) this.focusTop();
    }).observe(this.vp);
    this.k = 1;
    this.tx = 0;
    this.ty = 0;
    this.result = null;
    this.byPerson = new Map();
    this.selectedId = null;
    this.#bind();
    // the keyboard (Enter / Space on a focused button): a mouse or touch tap is handled by the pointer code in #bind
    this.stage.addEventListener('click', (e) => {
      if (e.detail !== 0) return;
      const b = e.target.closest?.('.cbtn');
      if (b) this.handlers.onAction?.(b.dataset.act, b.closest('.card').dataset.id);
    });
  }

  // ----- rendering -----

  render(result, selectedId = null) {
    this.result = result;
    this.selectedId = selectedId;
    this.byPerson = new Map();
    this.svg.replaceChildren();
    for (const old of [...this.stage.querySelectorAll('.card, .band')]) old.remove();
    this.stage.dataset.design = result?.orientation || 'vertical'; // CSS hook: vertical | horizontal | fan | tree
    this.#overlays(result);
    if (!result) return;
    if (result.orientation === 'fan') return this.#renderFan(result);

    if (this.options.bands && result.rows) {
      for (const r of result.rows) {
        const band = el('div', 'band');
        band.style.cssText = `top:${r.top}px;height:${r.h}px;`;
        this.stage.insertBefore(band, this.svg); // under the connectors and the cards
      }
    }

    const shape = result.orientation;
    const curved = this.options.curves;
    for (const e of result.edges) {
      const path = document.createElementNS(SVGNS, 'path');
      if (shape === 'horizontal') {
        const mx = (e.x1 + e.x2) / 2;
        path.setAttribute('d', curved ? `M${e.x1} ${e.y1}C${mx} ${e.y1} ${mx} ${e.y2} ${e.x2} ${e.y2}` : `M${e.x1} ${e.y1}H${e.busX}V${e.y2}H${e.x2}`);
      } else if (shape === 'tree') {
        const my = (e.y1 + e.y2) / 2;
        path.setAttribute('d', `M${e.x1} ${e.y1}C${e.x1} ${my} ${e.x2} ${my} ${e.x2} ${e.y2}`);
        path.style.strokeWidth = e.w; // boughs are not coloured by branch: they are wood
      } else if (curved) {
        // leaves the parent straight down and reaches the child straight down: a smooth S
        const my = (e.y1 + e.y2) / 2;
        path.setAttribute('d', `M${e.x1} ${e.y1}C${e.x1} ${my} ${e.x2} ${my} ${e.x2} ${e.y2}`);
      } else {
        path.setAttribute('d', `M${e.x1} ${e.y1}V${e.busY}H${e.x2}V${e.y2}`);
      }
      if (e.branch >= 0 && shape !== 'tree') path.dataset.br = e.branch;
      if (e.wife >= 0 && this.options.wifeColors && shape !== 'tree') {
        path.style.stroke = wifeColor(e.wife); // the children of a man with several wives: the line has the colour of their mother
        path.dataset.wf = e.wife;
      }
      this.svg.append(path);
    }
    if (shape === 'tree' && result.trunk) this.#trunk(result.trunk);

    const frag = document.createDocumentFragment();
    for (const c of result.cards) frag.append(this.#card(c));
    this.stage.append(frag);
  }

  /** The trunk under the root, and two roots spreading from its foot. */
  #trunk({ x, y, h }) {
    const add = (d, w) => {
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'trunk');
      path.style.strokeWidth = w;
      this.svg.append(path);
    };
    add(`M${x} ${y - 6}V${y + h}`, 30);
    add(`M${x} ${y + h - 8}C${x - 24} ${y + h - 6} ${x - 60} ${y + h} ${x - 92} ${y + h + 12}`, 11);
    add(`M${x} ${y + h - 8}C${x + 24} ${y + h - 6} ${x + 60} ${y + h} ${x + 92} ${y + h + 12}`, 11);
  }

  /** Half-circle fan: one slice per person (SVG, no cards). Taps work on the slices like on cards. */
  #renderFan(result) {
    const mk = (tag, attrs = {}) => {
      const n = document.createElementNS(SVGNS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      return n;
    };
    const pt = (r, a) => polar(r, a).map((v) => v.toFixed(2));
    const slices = [];
    const labels = [];
    for (const s of result.sectors) {
      const p = this.personOf(s.personId);
      let shape;
      if (s.depth === 0) {
        shape = mk('circle', { r: s.r1 });
      } else {
        const [x1, y1] = pt(s.r1, s.a0);
        const [x2, y2] = pt(s.r1, s.a1);
        const [x3, y3] = pt(s.r0, s.a1);
        const [x4, y4] = pt(s.r0, s.a0);
        const big = s.a1 - s.a0 > 180 ? 1 : 0;
        shape = mk('path', { d: `M${x1} ${y1}A${s.r1} ${s.r1} 0 ${big} 0 ${x2} ${y2}L${x3} ${y3}A${s.r0} ${s.r0} 0 ${big} 1 ${x4} ${y4}Z` });
      }
      shape.setAttribute('class', `sector ${p.gender}${p.is_deceased ? ' deceased' : ''}${s.personId === this.selectedId ? ' selected' : ''}`);
      shape.dataset.id = s.personId;
      if (s.node.branch >= 0) shape.dataset.br = s.node.branch;
      const tip = mk('title');
      tip.textContent = [fullName(p), lifeSpan(p)].filter(Boolean).join(' · ') + (s.node.collapsed ? ` · +${s.node.totalKids}` : '');
      shape.append(tip);
      slices.push(shape);
      this.byPerson.set(s.personId, [shape]);

      const label = this.#fanLabel(s, p);
      if (label) labels.push(...label);
    }
    this.svg.append(...slices, ...labels);
  }

  /** The name written along the slice (radially); too narrow slices stay unlabelled, their tooltip has the name. */
  #fanLabel(s, p) {
    const mk = (text, attrs) => {
      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('class', 'fan-text');
      for (const [k, v] of Object.entries(attrs)) t.setAttribute(k, v);
      t.textContent = text;
      return t;
    };
    if (s.depth === 0) {
      const out = [mk(p.first_name, { y: -4, 'font-size': 16 })];
      if (p.last_name) out.push(mk(p.last_name, { y: 14, 'font-size': 12 }));
      return out;
    }
    const mid = (s.a0 + s.a1) / 2;
    const rm = (s.r0 + s.r1) / 2;
    const arc = (rm * (s.a1 - s.a0) * Math.PI) / 180;
    let fs = Math.min(14, arc * 0.7);
    if (fs < 6.5) return null;
    let text = p.first_name + (s.node.collapsed ? ` +${s.node.totalKids}` : '');
    const room = s.r1 - s.r0 - 10;
    const max = Math.floor(room / (fs * 0.55));
    if (max < 3) return null;
    if (text.length > max) text = text.slice(0, max - 1) + '…';
    const [x, y] = polar(rm, mid);
    const rot = mid > 90 ? 180 - mid : -mid; // along the radius, never upside down
    return [mk(text, { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)})`, 'font-size': fs.toFixed(1) })];
  }

  #card(c) {
    const p = this.personOf(c.personId);
    const head = this.result?.head || 0; // the top of the box belongs to the figure that rises above the card
    const node = makeCard(p, { photo: this.photoUrl(p), actions: this.options.actions, canAdd: this.options.actions && this.canAdd(c.personId), name: this.nameOf(p) });
    node.dataset.id = c.personId;
    if (c.node && c.node.branch >= 0) node.dataset.br = c.node.branch;
    node.style.cssText = `left:${c.x}px;top:${c.y + head}px;width:${c.w}px;height:${c.h - head}px;`;
    if (c.personId === this.selectedId) node.classList.add('selected');
    if (c.node && c.node.wife >= 0 && this.options.wifeColors) {
      node.dataset.wf = c.node.wife; // a child of one of several wives: a ring in the colour of the mother
      node.style.setProperty('--wc', wifeColor(c.node.wife));
    }

    if (c.lines && c.lines.length) {
      const box = el('div', 'wives');
      const colored = this.options.wifeColors && c.lines.length > 1 && p.gender === 'male'; // several wives: a circle in the colour of each
      c.lines.forEach((line, i) => {
        const row = el('div', colored ? 'wchip wc' : 'wchip'); // every wife in a frame of her own, easy to read
        if (colored) {
          const dot = el('i', 'wdot');
          row.style.setProperty('--wc', wifeColor(i));
          row.append(dot);
        }
        row.append(line);
        row.title = line;
        box.append(row);
      });
      node.append(box);
      node.style.setProperty('--extra', `${c.extra}px`);
    }

    const n = c.node;
    if (n && (n.collapsed || n.children.length)) {
      const tg = el('button', 'tg', n.collapsed ? `+${n.totalKids}` : '−');
      tg.type = 'button';
      tg.setAttribute('aria-label', n.collapsed ? 'إظهار الفروع' : 'إخفاء الفروع');
      node.append(tg);
    }

    if (!this.byPerson.has(c.personId)) this.byPerson.set(c.personId, []);
    this.byPerson.get(c.personId).push(node);
    return node;
  }

  /** { bands, colors }: set by the app before render(); `colors` can also be flipped without a re-render. */
  configure(o) {
    Object.assign(this.options, o);
    this.stage.classList.toggle('colored', this.options.colors);
    this.stage.classList.toggle('no-years', !this.options.years);
    this.stage.dataset.card = this.options.cardStyle; // CSS hook: one block of rules per look of the card
    this.#syncLegend();
  }

  #overlays(result) {
    // one chip per branch (= a child of the root)
    const kids = (result?.cards[0]?.node?.children || []).filter((n) => n.branch >= 0);
    const chips = kids.slice(0, 16).map((n) => {
      const sw = el('i', 'sw');
      sw.dataset.br = n.branch;
      const chip = el('span', 'chip');
      chip.append(sw, `فرع ${this.personOf(n.id).first_name}`);
      return chip;
    });
    if (kids.length > 16) chips.push(el('span', 'chip', `+${kids.length - 16}`));
    this.legend.replaceChildren(...chips);
    // generation labels (bands design only)
    this.genRows = this.options.bands && result?.rows ? result.rows : [];
    this.genLabels = this.genRows.map((r) => el('div', 'gen-label', `الجيل ${generationName(r.depth + (result.genOffset || 0))}`));
    this.gens.replaceChildren(...this.genLabels);
    this.#syncLegend();
    this.#placeLabels();
  }

  #syncLegend() {
    this.legend.hidden = !this.options.colors || !this.legend.childElementCount;
  }

  /** The labels stay at the edge while panning; each one is centred on its band and hidden when the bands get too close. */
  #placeLabels() {
    this.genRows.forEach((r, i) => {
      const pitch = (this.genRows[i + 1] ? this.genRows[i + 1].top - r.top : r.h) * this.k;
      const label = this.genLabels[i];
      label.style.top = `${this.ty + (r.top + r.h / 2) * this.k}px`;
      label.style.visibility = pitch >= 72 ? 'visible' : 'hidden';
    });
  }

  /** Set by the app: id -> person record. */
  personOf = () => ({ first_name: '?', gender: 'male' });

  /** Set by the app: the name written on a card (first name + father + family, or the plain name). */
  nameOf = (p) => fullName(p);

  /** Set by the app: may the user add anyone around this person? (decides whether the card gets an "إضافة" button) */
  canAdd = () => false;

  /** Set by the app: person -> a displayable photo URL (signed, may not be fetched yet) or undefined. */
  photoUrl = () => undefined;

  /** Put photos that arrived after the first render into the cards that are already drawn. */
  refreshPhotos() {
    for (const [id, nodes] of this.byPerson) {
      const url = this.photoUrl(this.personOf(id));
      if (!url) continue;
      for (const n of nodes) {
        const avatar = n.querySelector('.avatar');
        if (!avatar || avatar.querySelector('img')) continue;
        const img = el('img');
        img.src = url;
        img.alt = '';
        avatar.replaceChildren(img);
      }
    }
  }

  setSelected(id) {
    this.selectedId = id;
    for (const nodes of this.byPerson.values()) for (const n of nodes) n.classList.remove('selected');
    for (const n of this.byPerson.get(id) || []) n.classList.add('selected');
  }

  /** Emphasise a set of persons (e.g. one wife's children) and fade the rest; null clears it. */
  setHighlight(ids) {
    const on = !!(ids && ids.size);
    this.stage.classList.toggle('has-hl', on);
    for (const [id, nodes] of this.byPerson) for (const n of nodes) n.classList.toggle('hl', on && ids.has(id));
  }

  has(id) {
    return this.byPerson.has(id);
  }

  // ----- view -----

  #apply() {
    this.stage.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.k})`;
    this.#placeLabels();
  }

  #animate() {
    this.stage.classList.add('anim');
    clearTimeout(this._animTimer);
    this._animTimer = setTimeout(() => this.stage.classList.remove('anim'), 380);
  }

  #card0(id) {
    return (this.result?.cards || []).find((c) => c.personId === id);
  }

  /** Initial view: root centred at the top, zoomed out just enough to show the width. */
  focusTop() {
    if (!this.result || !this.result.cards.length) return;
    const b = this.result.bounds;
    const vw = this.vp.clientWidth;
    this.needsFocus = !vw || !this.vp.clientHeight;
    const root = this.result.cards[0];
    if (this.result.orientation === 'horizontal') {
      // root against the right edge, the tree centred vertically when it fits
      const vh = this.vp.clientHeight;
      const k = Math.min(1, Math.max(0.6, (vh - 40) / b.h));
      this.k = k;
      this.ty = b.h * k <= vh - 16 ? (vh - b.h * k) / 2 - b.minY * k : vh / 2 - (root.y + root.h / 2) * k;
      this.tx = b.w * k <= vw - 16 ? (vw - b.w * k) / 2 - b.minX * k : vw - 24 - (root.x + root.w) * k;
      this.#apply();
      return;
    }
    if (this.result.orientation === 'fan') {
      // the whole fan, the root disc at the bottom centre
      const vh = this.vp.clientHeight;
      const k = Math.min(1, Math.max(0.25, Math.min((vw - 32) / b.w, (vh - 40) / b.h)));
      this.k = k;
      this.tx = (vw - b.w * k) / 2 - b.minX * k;
      this.ty = (vh - b.h * k) / 2 - b.minY * k;
      this.#apply();
      return;
    }
    const k = Math.min(1, Math.max(0.6, (vw - 32) / b.w));
    this.k = k;
    const cx = root.x + root.w / 2;
    // Centre the drawing horizontally when it fits, else centre on the root card.
    const fits = b.w * k <= vw - 16;
    this.tx = fits ? (vw - b.w * k) / 2 - b.minX * k : vw / 2 - cx * k;
    this.ty = this.result.orientation === 'tree' ? Math.min(24 - b.minY * k, this.vp.clientHeight - 24 - b.maxY * k) : 24 - b.minY * k;
    this.#apply();
  }

  fit() {
    if (!this.result || !this.result.cards.length) return;
    const b = this.result.bounds;
    const vw = this.vp.clientWidth;
    const vh = this.vp.clientHeight;
    if (!vw || !vh) return; // not on screen right now (hidden pane): nothing sensible to fit into
    const k = Math.max(MIN_K, Math.min(1.2, (vw - 40) / b.w, (vh - 40) / b.h));
    this.k = k;
    this.tx = (vw - b.w * k) / 2 - b.minX * k;
    this.ty = (vh - b.h * k) / 2 - b.minY * k;
    this.#animate();
    this.#apply();
  }

  centerOn(id, { insetBottom = 0, animate = true } = {}) {
    const c = this.#card0(id);
    if (!c) return;
    const vw = this.vp.clientWidth;
    const vh = this.vp.clientHeight - insetBottom;
    this.k = Math.max(this.k, 0.75);
    this.tx = vw / 2 - (c.x + c.w / 2) * this.k;
    this.ty = vh / 2 - (c.y + c.h / 2) * this.k;
    if (animate) this.#animate();
    this.#apply();
  }

  zoomBy(f) {
    this.#zoomAt(this.vp.clientWidth / 2, this.vp.clientHeight / 2, f);
    this.#animate();
  }

  #zoomAt(mx, my, f) {
    const nk = Math.min(MAX_K, Math.max(MIN_K, this.k * f));
    const r = nk / this.k;
    this.tx = mx - (mx - this.tx) * r;
    this.ty = my - (my - this.ty) * r;
    this.k = nk;
    this.#apply();
  }

  /** Run fn (which re-renders) and keep the given person's card where it was on screen. */
  keepInPlace(id, fn) {
    const before = this.#card0(id);
    fn();
    const after = this.#card0(id);
    if (before && after) {
      this.tx += (before.x - after.x) * this.k;
      this.ty += (before.y - after.y) * this.k;
      this.#apply();
    }
  }

  // ----- gestures -----

  #bind() {
    const vp = this.vp;
    const pts = new Map();
    let start = null;
    let pinch = null;

    const rel = (e) => {
      const r = vp.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const pinchState = () => {
      const [a, b] = [...pts.values()];
      const r = vp.getBoundingClientRect();
      return {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mx: (a.x + b.x) / 2 - r.left,
        my: (a.y + b.y) / 2 - r.top,
        k: this.k,
        tx: this.tx,
        ty: this.ty,
      };
    };

    vp.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.stage.classList.remove('anim');
      try {
        vp.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone (synthetic or cancelled event) */
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        start = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, target: e.target, moved: false };
      } else if (pts.size === 2) {
        if (start) start.moved = true;
        pinch = pinchState();
      }
    });

    vp.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const r = vp.getBoundingClientRect();
        const nk = Math.min(MAX_K, Math.max(MIN_K, (pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.dist));
        const wx = (pinch.mx - pinch.tx) / pinch.k;
        const wy = (pinch.my - pinch.ty) / pinch.k;
        const mx = (a.x + b.x) / 2 - r.left;
        const my = (a.y + b.y) / 2 - r.top;
        this.k = nk;
        this.tx = mx - wx * nk;
        this.ty = my - wy * nk;
        this.#apply();
      } else if (pts.size === 1 && start) {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) > 6) start.moved = true;
        if (start.moved) {
          this.tx = start.tx + dx;
          this.ty = start.ty + dy;
          this.#apply();
        }
      }
    });

    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size === 0) {
        if (start && !start.moved && e.type === 'pointerup') this.#tap(start.target);
        start = null;
        pinch = null;
      } else if (pts.size === 1) {
        const [p] = [...pts.values()];
        start = { x: p.x, y: p.y, tx: this.tx, ty: this.ty, target: null, moved: true };
        pinch = null;
      }
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);

    vp.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const { x, y } = rel(e);
        this.stage.classList.remove('anim');
        this.#zoomAt(x, y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      },
      { passive: false },
    );
  }

  #tap(target) {
    if (!target || !target.closest) return;
    const card = target.closest('.card, .sector');
    const btn = card && target.closest('.cbtn');
    if (btn) return this.handlers.onAction?.(btn.dataset.act, card.dataset.id);
    if (card && target.closest('.tg')) return this.handlers.onToggle(card.dataset.id);
    // fan: a slice has no fold button, so tapping the selected slice again folds / unfolds its branch
    if (card && card.classList.contains('sector') && card.dataset.id === this.selectedId) {
      const n = this.result?.cards.find((x) => x.personId === card.dataset.id)?.node;
      if (n && (n.collapsed || n.children.length)) return this.handlers.onToggle(card.dataset.id);
    }
    this.handlers.onSelect(card ? card.dataset.id : null);
  }
}

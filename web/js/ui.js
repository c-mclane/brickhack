// HUD + Minecraft-style panels (inventory, menus, text windows, prompts).
import { legoIconForTile, gameTile } from './legoitems.js';
import { BLOCKS } from './blocks.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
};

// ---------------------------------------------------------------- icons

let ATLAS = { cols: 40, rows: 36, url: 'assets/slashem/tiles.png' };
export function setAtlas(meta, url) {
  ATLAS = { cols: meta.cols, rows: meta.rows || Math.ceil(meta.count / meta.cols), url };
}

export function tileIcon(t, size = 32, cls = 'icon') {
  const d = el('div', cls);
  if (t == null || t < 0) return d;
  d.style.width = d.style.height = size + 'px';
  // an item that's been made in LEGO shows its model (legoitems.js), not its sprite
  const lego = legoIconForTile(t);
  if (lego) {
    d.classList.add('lego-icon');
    d.style.backgroundImage = `url(${lego})`;
    d.style.backgroundSize = 'contain';
    return d;
  }
  t = gameTile(t); // (an artifact not yet in LEGO: its base item's sprite)
  d.style.backgroundImage = `url(${ATLAS.url})`;
  d.style.backgroundSize = `${ATLAS.cols * size}px ${ATLAS.rows * size}px`;
  d.style.backgroundPosition = `-${(t % ATLAS.cols) * size}px -${Math.floor(t / ATLAS.cols) * size}px`;
  return d;
}

// tiny pixel-art HUD icons (9x9) rendered to SVG data URLs
function pix(rows, pal) {
  const h = rows.length, w = rows[0].length;
  let r = '';
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (pal[ch]) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${pal[ch]}"/>`;
  }));
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' shape-rendering='crispEdges'>${r}</svg>`)}")`;
}
const HEART = ['.KK...KK.', 'KRRK.KRRK', 'KRWRKRRRK', 'KRRRRRRRK', 'KRRRRRRRK', '.KRRRRRK.', '..KRRRK..', '...KRK...', '....K....'];
const DRUM = ['......KK.', '.....KWWK', '....KWWK.', '..KKKKK..', '.KBBBK...', 'KBBBBK...', 'KBBBK....', 'KBBK.....', '.KK......'];
const PLATE = ['.KK...KK.', 'KWWKKKWWK', 'KWWWWWWWK', '.KWWWWWK.', '.KWWWWWK.', '.KWWWWWK.', '.KWWWWWK.', '.KKKKKKK.', '.........'];
const ORB = ['...KKK...', '..KBBBK..', '.KBWBBBK.', 'KBWBBBBBK', 'KBBBBBBBK', 'KBBBBBBBK', '.KBBBBBK.', '..KBBBK..', '...KKK...'];
const IC = {
  heart: pix(HEART, { K: '#000', R: '#e01010', W: '#ffbcbc' }),
  heartE: pix(HEART, { K: '#000', R: '#3a0a0a', W: '#3a0a0a' }),
  drum: pix(DRUM, { K: '#000', W: '#f0f0e8', B: '#b5651d' }),
  drumE: pix(DRUM, { K: '#000', W: '#333', B: '#2a1a0a' }),
  plate: pix(PLATE, { K: '#000', W: '#d8d8d8' }),
  plateE: pix(PLATE, { K: '#000', W: '#333' }),
  orb: pix(ORB, { K: '#000', W: '#fff', B: '#3a7bff' }),
  orbE: pix(ORB, { K: '#000', W: '#123', B: '#123' }),
};

function iconRow(container, halves, full, empty, n = 10) {
  container.textContent = '';
  for (let i = 0; i < n; i++) {
    const ic = el('div', 'ic');
    ic.style.backgroundImage = IC[empty];
    const f = el('i');
    f.style.backgroundImage = IC[full];
    const v = Math.max(0, Math.min(2, halves - i * 2));
    f.style.width = (v * 9) + 'px';
    ic.appendChild(f);
    container.appendChild(ic);
  }
}

// ---------------------------------------------------------------- items

export const SLOT_LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$#'.split('');

const ACTIONS = {
  wield: ['Wield', 'w'], wear: ['Wear', 'W'], takeoff: ['Take off', 'T'], puton: ['Put on', 'P'],
  remove: ['Remove', 'R'], eat: ['Eat', 'e'], quaff: ['Quaff', 'q'], read: ['Read', 'r'],
  zap: ['Zap', 'z'], apply: ['Apply', 'a'], throw: ['Throw', 't'], quiver: ['Quiver', 'Q'],
  drop: ['Drop', 'd'], invoke: ['Invoke', '\xe9'], rub: ['Rub', '\xf2'], dip: ['Dip', '\xe4'],
  engrave: ['Engrave with', 'E'], unwield: ['Unwield', 'w', '-'],
};

export function itemActions(it) {
  const worn = !!it.w;
  const a = [];
  switch (it.c) {
    case ')': a.push(it.w === 'weapon' ? 'unwield' : 'wield', 'throw', 'quiver', 'engrave'); break;
    case '[': a.push(worn ? 'takeoff' : 'wear'); break;
    case '=': case '"': a.push(worn ? 'remove' : 'puton'); break;
    case '%': a.push('eat'); break;
    case '!': a.push('quaff', 'dip'); break;
    case '?': case '+': a.push('read'); break;
    case '/': a.push('zap', 'engrave'); break;
    case '(': a.push('apply', it.w === 'weapon' ? 'unwield' : 'wield', 'rub'); if (worn) a.push('remove'); else if (/blindfold|towel|lenses/.test(it.n)) a.push('puton'); break;
    case '*': a.push('throw', 'rub', 'quiver'); break;
    case '`': case '0': a.push('throw'); break;
    default: a.push('apply');
  }
  if (!a.includes('throw') && it.c !== '$') a.push('throw');
  a.push('drop');
  return a.map((k) => ({ key: k, label: ACTIONS[k][0], cmd: ACTIONS[k][1], arg: ACTIONS[k][2] }));
}

const BUC = { 1: 'b', '-1': 'c', 0: 'u', 2: 'x' };

// ---------------------------------------------------------------- UI class

export class UI {
  constructor(game) {
    this.g = game;
    this.chatLines = [];
    this.history = false;
    this.drag = null;
    this.titleTimer = 0;
    this.hotbarSel = 0;
    this.selectMode = null; // {letters:Set, allowDash} when inventory answers a prompt
    this.buildStatic();
  }

  buildStatic() {
    // hotbar
    const hb = $('#hotbar');
    for (let i = 0; i < 9; i++) hb.appendChild(el('div', 'slot'));
    // inventory grid
    const grid = $('#grid');
    SLOT_LETTERS.forEach((l) => {
      const s = el('div', 'slot');
      s.dataset.letter = l;
      grid.appendChild(s);
    });
    const ihb = $('#inv-hotbar');
    for (let i = 0; i < 9; i++) {
      const s = el('div', 'slot');
      s.dataset.hot = i;
      ihb.appendChild(s);
    }
    const EQ = [['helm', 'Helm'], ['amulet', 'Amulet'], ['cloak', 'Cloak'], ['eyes', 'Eyes'], ['suit', 'Armor'], ['weapon', 'Weapon'],
      ['shirt', 'Shirt'], ['alt', 'Alt'], ['gloves', 'Gloves'], ['quiver', 'Quiver'], ['boots', 'Boots'], ['ringl', 'L Ring'],
      ['shield', 'Shield'], ['ringr', 'R Ring']];
    const eq = $('#equip');
    for (const [k, label] of EQ) {
      const s = el('div', 'slot');
      s.dataset.equip = k;
      s.appendChild(el('div', 'lbl', label));
      eq.appendChild(s);
    }
    this.bindInventoryMouse();
    $('#text [data-act=close]').onclick = () => this.g.closeText();
    document.querySelectorAll('.inv-tab').forEach((b) => (b.onclick = () => this.showTab(b.dataset.tab)));
  }

  // ---------------------------------------------------------------- HUD
  updateStatus(s) {
    const prev = this.stat;
    this.stat = s;
    const hpHalves = s.hpmax > 0 ? Math.ceil((Math.max(0, s.hp) / s.hpmax) * 20) : 0;
    iconRow($('#hearts'), hpHalves, 'heart', 'heartE');
    if (prev && s.hp < prev.hp) {
      $('#hearts').classList.remove('flash');
      void $('#hearts').offsetWidth;
      $('#hearts').classList.add('flash');
    }
    const hunger = Math.max(0, Math.min(20, Math.round(s.nut / 50)));
    iconRow($('#hunger'), hunger, 'drum', 'drumE');
    const armor = Math.max(0, Math.min(20, 10 - s.ac));
    iconRow($('#armor'), armor, 'plate', 'plateE');
    $('#armor').style.visibility = armor > 0 ? 'visible' : 'hidden';
    const pw = s.pwmax > 0 ? Math.ceil((s.pw / s.pwmax) * 20) : 0;
    iconRow($('#power'), pw, 'orb', 'orbE');
    $('#power').style.visibility = s.pwmax > 0 ? 'visible' : 'hidden';
    $('#hearts').title = `HP ${s.hp}/${s.hpmax}`;
    const frac = s.exphi > s.explo ? (s.exp - s.explo) / (s.exphi - s.explo) : 0;
    $('#xp .fill').style.width = Math.max(0, Math.min(100, frac * 100)) + '%';
    $('#xp .lvl').textContent = s.lvl;
    const hs = ['Satiated', '', 'Hungry', 'Weak', 'Fainting', 'Fainted', 'Starved'][s.uhs] || '';
    const enc = ['', 'Burdened', 'Stressed', 'Strained', 'Overtaxed', 'Overloaded'][s.enc] || '';
    $('#cond').innerHTML = [hs, enc, ...s.cond].filter(Boolean).join('<br>');
    this.updateInfo();
    this.renderCharStats();
  }

  updateInfo() {
    const s = this.stat;
    if (!s) return;
    const str = s.str > 18 ? (s.str > 118 ? s.str - 100 : `18/${String(s.str - 18).padStart(2, '0')}`) : s.str;
    const al = s.align > 0 ? 'Lawful' : s.align < 0 ? 'Chaotic' : 'Neutral';
    const lines = [
      `${s.name} the ${s.rank}`,
      `<span class="dim">Dlvl ${s.depth} · ${s.dname}</span>`,
      `HP ${s.hp}(${s.hpmax}) Pw ${s.pw}(${s.pwmax}) AC ${s.ac} $${s.gold} T:${s.turn}`,
    ];
    if (this.g.opts.debug)
      lines.push(`St:${str} Dx:${s.dex} Co:${s.con} In:${s.int} Wi:${s.wis} Ch:${s.cha} ${al}`,
        `<span class="dim">XYZ: ${s.ux} / ${s.uy} / ${s.depth}  Xp ${s.lvl}/${s.exp}</span>`);
    $('#info').innerHTML = lines.join('<br>');
  }

  renderCharStats() {
    const s = this.stat;
    if (!s) return;
    const str = s.str > 18 ? (s.str > 118 ? s.str - 100 : `18/${String(s.str - 18).padStart(2, '0')}`) : s.str;
    const al = s.align > 0 ? 'Lawful' : s.align < 0 ? 'Chaotic' : 'Neutral';
    $('#charstats').innerHTML =
      `<b>${s.name}</b><br>${s.race} ${s.role}<br>${s.rank}, ${al}<br>` +
      `St <b>${str}</b> Dx <b>${s.dex}</b> Co <b>${s.con}</b><br>In <b>${s.int}</b> Wi <b>${s.wis}</b> Ch <b>${s.cha}</b><br>` +
      `Xp <b>${s.lvl}</b>/${s.exp} AC <b>${s.ac}</b><br>Dlvl <b>${s.depth}</b> $<b>${s.gold}</b>`;
    const hp = $('#hero-preview');
    let icon;
    if (this.heroSkinURL) {
      icon = el('div', 'icon big skin-icon');
      icon.style.backgroundImage = `url(${this.heroSkinURL})`;
    } else icon = tileIcon(s.herotile, 96, 'icon big');
    hp.querySelector('.icon').replaceWith(icon);
    hp.querySelector('.name').textContent = s.name;
    hp.classList.toggle('has-fig', !!this.heroFigure && !s.poly); // (heroFigure: main.js shows your minifig)
  }

  showTitle(big, sub) {
    $('#title-text .big').textContent = big;
    $('#title-text .sub').textContent = sub || '';
    $('#title-text').classList.add('show');
    clearTimeout(this.titleTimer);
    this.titleTimer = setTimeout(() => $('#title-text').classList.remove('show'), 2500);
  }

  // ---------------------------------------------------------------- chat
  chat(text, cls) {
    const line = el('div', 'line' + (cls ? ' ' + cls : ''), text);
    const c = $('#chat');
    c.appendChild(line);
    this.chatLines.push(line);
    if (this.chatLines.length > 200) this.chatLines.shift().remove();
    // only the latest ~10 lines stay on screen; each fades after 10s
    setTimeout(() => line.classList.add('fade'), 10000);
    const visible = this.chatLines.filter((l) => !l.classList.contains('fade'));
    if (!this.history) visible.slice(0, -10).forEach((l) => l.classList.add('fade'));
    if (this.history) c.scrollTop = c.scrollHeight;
  }

  toggleHistory(on) {
    this.history = on ?? !this.history;
    $('#chat').classList.toggle('history', this.history);
    if (this.history) $('#chat').scrollTop = 1e9;
  }

  // ---------------------------------------------------------------- prompts
  showPrompt(q, choices, hint) {
    const p = $('#prompt');
    p.classList.remove('hidden');
    $('.q', p).textContent = q;
    const ch = $('.choices', p);
    ch.textContent = '';
    for (const c of choices || []) {
      const b = el('button', 'mc-btn small', c.label);
      b.onclick = () => c.fn();
      ch.appendChild(b);
    }
    if (hint) ch.appendChild(el('div', 'hint', hint));
  }

  hidePrompt() {
    $('#prompt').classList.add('hidden');
  }

  // ---------------------------------------------------------------- hotbar
  renderHotbar() {
    const slots = $('#hotbar').children;
    const islots = $('#inv-hotbar').children;
    for (let i = 0; i < 9; i++) {
      const it = this.g.hotbarItem(this.g.hotbar[i]);
      for (const s of [slots[i], islots[i]]) this.fillSlot(s, it, false);
      slots[i].classList.toggle('sel', i === this.hotbarSel);
    }
  }

  selectHotbar(i) {
    this.hotbarSel = (i + 9) % 9;
    this.renderHotbar();
    const it = this.selectedItem();
    const n = $('#itemname');
    n.textContent = it ? it.n : '';
    n.classList.add('show');
    clearTimeout(this.nameTimer);
    this.nameTimer = setTimeout(() => n.classList.remove('show'), 2000);
  }

  selectedItem() {
    return this.g.hotbarItem(this.g.hotbar[this.hotbarSel]);
  }

  fillSlot(s, it, showLetter) {
    s.textContent = '';
    s.title = '';
    if (s.dataset.equip) s.appendChild(el('div', 'lbl', s.dataset.equipLabel || ''));
    if (!it) return;
    const sz = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--icon')) || 32;
    if (it.icon) {
      const ic = el('div', 'icon skin-icon');
      ic.style.width = ic.style.height = sz + 'px';
      ic.style.backgroundImage = `url(${it.icon})`;
      s.appendChild(ic);
    } else s.appendChild(tileIcon(it.t, sz));
    if (it.q > 1) s.appendChild(el('div', 'qty', it.q > 999 ? '999+' : String(it.q)));
    if (showLetter) s.appendChild(el('div', 'let', it.l));
    if (it.w && showLetter) s.appendChild(el('div', 'wornmark'));
  }

  // ---------------------------------------------------------------- inventory
  renderInventory() {
    const inv = this.g.invByLetter;
    for (const s of $('#grid').children) {
      const it = inv[s.dataset.letter];
      this.fillSlot(s, it, true);
      s.classList.toggle('want', !!(this.selectMode && it && this.selectMode.letters.has(it.l)));
      s.classList.toggle('dim', !!(this.selectMode && it && !this.selectMode.letters.has(it.l)));
    }
    for (const s of $('#equip').children) {
      if (!s.dataset.equipLabel) s.dataset.equipLabel = s.querySelector('.lbl')?.textContent || '';
      const it = Object.values(inv).find((i) => i.w === s.dataset.equip);
      this.fillSlot(s, it, false);
      if (it) s.querySelector('.lbl')?.remove();
    }
    // every kind of block you're carrying (whatever you've mined and picked up)
    const ib = $('#inv-blocks');
    ib.textContent = '';
    for (const type of Object.keys(BLOCKS)) {
      if (!this.g.hotbarItem('block:' + type)) continue;
      const s = el('div', 'slot');
      s.dataset.block = type;
      ib.appendChild(s);
      this.fillSlot(s, this.slotItem(s), false);
    }
    this.renderHotbar();
    const acts = $('#inv-actions');
    acts.textContent = '';
    if (this.selectMode) {
      $('#inv-label').textContent = this.selectMode.q;
      if (this.selectMode.allowDash) {
        const b = el('button', 'mc-btn small', 'Nothing / bare hands (-)');
        b.onclick = () => this.g.answerSelect('-');
        acts.appendChild(b);
      }
      const b2 = el('button', 'mc-btn small', 'Cancel');
      b2.onclick = () => this.g.answerSelect('\x1b');
      acts.appendChild(b2);
    } else {
      $('#inv-label').textContent = 'Inventory  (drag to rearrange · right-click for actions · drag out to drop)';
    }
  }

  openInventory(selectMode, tab = 'items') {
    this.selectMode = selectMode || null;
    $('#inv').classList.toggle('select', !!selectMode);
    $('#inv').classList.remove('hidden');
    this.showTab(selectMode ? 'items' : tab);
    this.renderInventory();
  }

  showTab(tab) {
    this.tab = tab;
    document.querySelectorAll('.inv-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('.inv-panel').classList.toggle('hidden', tab !== 'items');
    $('#actions-panel').classList.toggle('hidden', tab !== 'actions');
    $('.inv-tabs').classList.toggle('hidden', !!this.selectMode);
    if (tab === 'actions') this.renderActions();
  }

  // groups: [{title, items: [{label, tip}]}]; here: context buttons first
  renderActions() {
    const root = $('#actions-panel');
    root.textContent = '';
    const groups = this.g.actionGroups();
    // suggestions for right now go first
    for (const g of groups) {
      if (!g.items.length) continue;
      const box = el('div', 'group' + (g.here ? ' here' : ''));
      box.appendChild(el('div', 'group-title', g.title));
      const btns = el('div', 'btns');
      for (const a of g.items) {
        const b = el('button', 'mc-btn', a.label);
        if (a.tip) b.title = a.tip;
        b.onclick = () => this.g.runAction(a);
        btns.appendChild(b);
      }
      box.appendChild(btns);
      root.appendChild(box);
    }
    root.appendChild(el('div', 'hint', 'Tip: hover a button to see what it does and its keyboard shortcut.'));
  }

  closeInventory() {
    $('#inv').classList.add('hidden');
    this.selectMode = null;
    this.hideTooltip();
    this.hideCtx();
  }

  get inventoryOpen() {
    return !$('#inv').classList.contains('hidden');
  }

  slotItem(s) {
    const inv = this.g.invByLetter;
    if (s.dataset.letter) return inv[s.dataset.letter];
    if (s.dataset.hot != null) return this.g.hotbarItem(this.g.hotbar[+s.dataset.hot]);
    if (s.dataset.block) return this.g.hotbarItem('block:' + s.dataset.block);
    if (s.dataset.equip) return Object.values(inv).find((i) => i.w === s.dataset.equip);
    return null;
  }

  bindInventoryMouse() {
    const root = $('#inv');
    root.addEventListener('mousemove', (e) => {
      const s = e.target.closest('.slot');
      const it = s && this.slotItem(s);
      if (it && !this.drag) this.showTooltip(it, e.clientX, e.clientY);
      else this.hideTooltip();
      if (this.drag) {
        this.drag.ghost.style.left = e.clientX - 16 + 'px';
        this.drag.ghost.style.top = e.clientY - 16 + 'px';
        root.querySelectorAll('.dragover').forEach((x) => x.classList.remove('dragover'));
        if (s) s.classList.add('dragover');
      }
    });
    root.addEventListener('mousedown', (e) => {
      this.hideCtx();
      const s = e.target.closest('.slot');
      if (!s) return;
      const it = this.slotItem(s);
      if (e.button === 2) {
        e.preventDefault();
        if (it) this.showCtx(it, e.clientX, e.clientY);
        return;
      }
      if (e.button !== 0 || !it) return;
      if (this.selectMode) { if (!it.block) this.g.answerSelect(it.l); return; }
      if (e.shiftKey && !it.block) { this.g.useItem(it); return; }
      const ghost = tileIcon(it.t, 32);
      Object.assign(ghost.style, { position: 'fixed', zIndex: 40, pointerEvents: 'none', left: e.clientX - 16 + 'px', top: e.clientY - 16 + 'px' });
      document.body.appendChild(ghost);
      this.drag = { it, from: s, ghost };
      this.hideTooltip();
    });
    window.addEventListener('mouseup', (e) => {
      if (!this.drag) return;
      const { it, from, ghost } = this.drag;
      ghost.remove();
      this.drag = null;
      root.querySelectorAll('.dragover').forEach((x) => x.classList.remove('dragover'));
      const to = e.target.closest && e.target.closest('.slot');
      const inPanel = e.target.closest && e.target.closest('.inv-panel');
      if (!to) {
        if (!inPanel) this.g.itemCmd('drop', it); // dragged out of the window
        else if (from.dataset.hot != null) { this.g.hotbar[+from.dataset.hot] = null; this.g.saveHotbar(); this.renderInventory(); }
        return;
      }
      if (to === from) return;
      this.g.dropOnSlot(it, from, to);
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  showTooltip(it, x, y) {
    const t = $('#tooltip');
    t.innerHTML = '';
    t.appendChild(el('div', BUC[it.cu] || 'u', it.n));
    t.appendChild(el('div', 'k', it.hint ? it.hint : it.block ? `${it.q} in inventory · right-click in the world to place`
      : `[${it.l}] ${this.selectMode ? 'click to choose' : 'shift-click: ' + itemActions(it)[0].label}`));
    t.classList.remove('hidden');
    t.style.left = Math.min(window.innerWidth - t.offsetWidth - 4, x + 14) + 'px';
    t.style.top = Math.max(4, y - 30) + 'px';
  }

  hideTooltip() {
    $('#tooltip').classList.add('hidden');
  }

  showCtx(it, x, y) {
    const m = $('#ctxmenu');
    m.textContent = '';
    for (const a of it.block ? [] : itemActions(it)) {
      const d = el('div', '', a.label);
      d.onmousedown = (e) => { e.stopPropagation(); this.hideCtx(); this.g.itemCmd(a.key, it); };
      m.appendChild(d);
    }
    if (it.q > 1 && !it.block) {
      const d = el('div', '', 'Drop one');
      d.onmousedown = (e) => { e.stopPropagation(); this.hideCtx(); this.g.itemCmd('drop', it, 1); };
      m.appendChild(d);
    }
    const hb = el('div', '', 'Put in hotbar');
    hb.onmousedown = (e) => { e.stopPropagation(); this.hideCtx(); this.g.addToHotbar(it.l, true); };
    m.appendChild(hb);
    m.classList.remove('hidden');
    m.style.left = Math.min(window.innerWidth - 180, x) + 'px';
    m.style.top = Math.min(window.innerHeight - m.offsetHeight - 4, y) + 'px';
    this.hideTooltip();
  }

  hideCtx() {
    $('#ctxmenu').classList.add('hidden');
  }

  // ---------------------------------------------------------------- recommended
  renderRecommend(recs) {
    const box = $('#recommend');
    const list = $('.rec-list', box);
    list.textContent = '';
    recs.slice(0, 4).forEach((r, i) => {
      const row = el('div', 'rec');
      row.appendChild(el('span', 'k', `\u21e7${i + 1}`));
      row.appendChild(el('span', 'l', r.label));
      if (r.why) row.appendChild(el('span', 'why', r.why));
      row.onclick = () => this.g.runAction(r);
      list.appendChild(row);
    });
    box.classList.toggle('hidden', !recs.length);
  }

  // ---------------------------------------------------------------- chest
  // contents: [{s: menu text, t: tile}]; callbacks get the clicked entry
  showChest(title, contents, { onTake, onPut, onClose }) {
    const root = $('#chest');
    root.classList.remove('hidden');
    $('.chest-title', root).textContent = title;
    const grid = $('#chest-grid');
    grid.textContent = '';
    for (let i = 0; i < 27; i++) {
      const s = el('div', 'slot');
      const it = contents[i];
      if (it) {
        s.appendChild(tileIcon(it.t, 32));
        const n = parseInt(it.s, 10);
        if (n > 1) s.appendChild(el('div', 'qty', String(n)));
        s.onmouseenter = (e) => this.showTooltip({ n: it.s, cu: 2, hint: 'click to take out' }, e.clientX, e.clientY);
        s.onmouseleave = () => this.hideTooltip();
        s.onclick = () => { this.hideTooltip(); onTake(it); };
      }
      grid.appendChild(s);
    }
    const inv = $('#chest-inv');
    inv.textContent = '';
    for (const l of SLOT_LETTERS) {
      const s = el('div', 'slot');
      const it = this.g.invByLetter[l];
      this.fillSlot(s, it, true);
      if (it) {
        s.onmouseenter = (e) => this.showTooltip({ ...it, hint: 'click to put in the chest' }, e.clientX, e.clientY);
        s.onmouseleave = () => this.hideTooltip();
        s.onclick = () => { this.hideTooltip(); onPut(it); };
      }
      inv.appendChild(s);
    }
    this.chestClose = onClose;
  }

  setChestBusy(busy) {
    $('#chest').querySelectorAll('.slot').forEach((s) => s.classList.toggle('busy', busy));
  }

  closeChest() {
    $('#chest').classList.add('hidden');
    this.hideTooltip();
  }

  get chestOpen() {
    return !$('#chest').classList.contains('hidden');
  }

  // ---------------------------------------------------------------- menus
  showMenu(m, onDone) {
    const root = $('#menu');
    root.classList.remove('hidden');
    $('.title', root).textContent = m.prompt || (m.how === 0 ? '' : m.how === 1 ? 'Pick one' : 'Pick any');
    const list = $('.list', root);
    list.textContent = '';
    const chosen = new Set(m.items.filter((i) => i.pre && i.sel).map((i) => i.i));
    const rows = [];
    for (const it of m.items) {
      const r = el('div', 'item' + (it.sel ? ' selectable' : ' header'));
      if (it.sel && m.how === 2) r.appendChild(el('div', 'box'));
      if (it.sel) r.appendChild(el('div', 'k', it.k || ''));
      if (it.t >= 0) r.appendChild(tileIcon(it.t, 32));
      r.appendChild(el('div', 's', it.s));
      if (chosen.has(it.i)) r.classList.add('on');
      if (it.sel && m.how > 0) {
        r.onclick = () => toggle(it);
      }
      rows[it.i] = r;
      list.appendChild(r);
    }
    const finish = (ok) => {
      root.classList.add('hidden');
      window.removeEventListener('keydown', onKey, true);
      onDone(ok ? [...chosen] : null);
    };
    const toggle = (it) => {
      if (m.how === 1) { chosen.clear(); chosen.add(it.i); finish(true); return; }
      if (chosen.has(it.i)) chosen.delete(it.i); else chosen.add(it.i);
      rows[it.i].classList.toggle('on', chosen.has(it.i));
    };
    const btns = $('.buttons', root);
    btns.textContent = '';
    if (m.how === 2) {
      const all = el('button', 'mc-btn small', 'All');
      all.onclick = () => m.items.filter((i) => i.sel).forEach((i) => { chosen.add(i.i); rows[i.i].classList.add('on'); });
      btns.appendChild(all);
      const ok = el('button', 'mc-btn small', 'Done');
      ok.onclick = () => finish(true);
      btns.appendChild(ok);
    }
    const cancel = el('button', 'mc-btn small', m.how === 0 ? 'Close' : 'Cancel');
    cancel.onclick = () => finish(false);
    btns.appendChild(cancel);
    const onKey = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.key === 'Escape') return finish(false);
      if (e.key === 'Enter' || (m.how !== 1 && e.key === ' ')) return finish(m.how === 2);
      if (m.how === 2 && e.key === ',') return all_();
      if (m.how === 2 && e.key === '-') { chosen.clear(); rows.forEach((r) => r && r.classList.remove('on')); return; }
      const it = m.items.find((i) => i.sel && i.k === e.key);
      if (it && m.how > 0) toggle(it);
      else if (m.how === 0) finish(false);
    };
    const all_ = () => m.items.filter((i) => i.sel).forEach((i) => { chosen.add(i.i); rows[i.i].classList.add('on'); });
    window.addEventListener('keydown', onKey, true);
  }

  showText(lines, onClose) {
    const root = $('#text');
    const pre = $('pre', root);
    pre.textContent = '';
    for (const l of lines) {
      const line = l.a ? el('b', '', l.s) : document.createTextNode(l.s);
      pre.appendChild(line);
      pre.appendChild(document.createTextNode('\n'));
    }
    root.classList.remove('hidden');
    pre.scrollTop = 0;
    const onKey = (e) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) return;
      e.stopPropagation();
      e.preventDefault();
      if (['Escape', 'Enter', ' '].includes(e.key) || e.key.length === 1) close();
    };
    const close = () => {
      root.classList.add('hidden');
      window.removeEventListener('keydown', onKey, true);
      onClose();
    };
    this.closeTextFn = close;
    window.addEventListener('keydown', onKey, true);
  }

  // text input bar (getlin / extended commands / chat-style commands)
  askLine(q, opts, onDone) {
    const root = $('#lineinput');
    root.classList.remove('hidden');
    $('.q', root).textContent = q;
    const inp = $('input', root);
    inp.value = opts.initial || '';
    if (opts.list) {
      const dl = $('#extlist');
      dl.textContent = '';
      for (const [n, d] of opts.list) { const o = el('option'); o.value = n; o.label = d; dl.appendChild(o); }
      inp.setAttribute('list', 'extlist');
    } else inp.removeAttribute('list');
    setTimeout(() => inp.focus(), 0);
    const finish = (v) => {
      root.classList.add('hidden');
      inp.onkeydown = null;
      inp.blur();
      onDone(v);
    };
    inp.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(inp.value);
      else if (e.key === 'Escape') finish(null);
      else if (e.key === 'Tab' && opts.list) {
        e.preventDefault();
        const m = opts.list.find(([n]) => n.startsWith(inp.value.replace(/^[#/]/, '')));
        if (m) inp.value = m[0];
      }
    };
  }
}

// NetHack 3D client: networking, game state, controls, camera, main loop.
import { Renderer } from './render.js';
import { World } from './world.js';
import { UI, setAtlas, itemActions, SLOT_LETTERS, tileIcon } from './ui.js';
import { CM, cmapTile, wallTile, setCmap, setCmapBase, WALL_H } from './terrain.js';
import { Motion } from './motion.js';
import { BlockWorld, BLOCKS, BUILD_LIMIT, breakTime, minedAs } from './blocks.js';
import { buildTextures } from './textures.js';
import { ACTION_GROUPS, recommend } from './actions.js';
import { CombatFX } from './combat.js';
import { NameTags, nameTagEntries } from './nametags.js';
import { Drops } from './drops.js';
import { buildPlayerModel } from './playermodel.js';
import { Music } from './music.js';
import { figureMatrix, partMatrix, FIG_HEIGHT, STUD_H } from './brick.js';
import { creatureLocal, slitherLocal, LUNGE_TIME } from './creature.js';
import { perchSpot, cameFrom } from './perch.js';
import { setupFigurePicker, figureView, loadRoster, figuresFor, customFigureUrl } from './figpick.js';
import { FigureAnimator, firstPersonMatrix, firstPersonWrist, wristMatrix, mul as mul4, FP_TILT, FP_HOLD_TILT, ATTACK_TIME, SLASH_CUT } from './minifig-anim.js';
import { loadBrickItems, brickItemForTile, brickItemByName, brickChainLink, brickBuilt, gameTile, setStartPieces, isStartTile, onIcons } from './brickitems.js';
import { menuPlate } from './brandlogo.js';
import { loadRules, conflicts } from './charrules.js';
import { makeSkin, loadSkinURL } from './skin.js';

const $ = (s) => document.querySelector(s);

// ------------------------------------------------------------------ options
const DEFAULT_OPTS = { camera: 0, wallStyle: 'brick', fov: 75, sens: 100, debug: false, hud: true, music: 60, playerModel: 'model', tileset: 'slashem' };
const opts = { ...DEFAULT_OPTS, ...safeJSON(localGet('nh3d.opts')) };
function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
function safeJSON(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }
const saveOpts = () => localSet('nh3d.opts', JSON.stringify(opts));

const CAMERA_NAMES = ['First Person', 'Third Person (Back)', 'Third Person (Front)', 'Overhead Map'];

// ------------------------------------------------------------------ net
let sid;
try { sid = sessionStorage.getItem('nh3d.sid'); } catch {}
if (!sid) {
  sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { sessionStorage.setItem('nh3d.sid', sid); } catch {}
}
let postChain = Promise.resolve();
function post(line) {
  postChain = postChain.then(() => fetch(`/api/input?sid=${sid}`, { method: 'POST', body: line }).catch(() => {}));
}
const hex = (s) => [...s].map((c) => (c.charCodeAt(0) & 255).toString(16).padStart(2, '0')).join('');

// ------------------------------------------------------------------ game state
const DIRS = { '-1,-1': 'y', '0,-1': 'k', '1,-1': 'u', '-1,0': 'h', '1,0': 'l', '-1,1': 'b', '0,1': 'j', '1,1': 'n' };
const OCT = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

const game = {
  opts,
  playing: false,
  ready: false,        // NetHack is waiting for a command key
  mode: null,          // null | 'yn' | 'dir' | 'getpos' | 'select'
  cursor: null,
  ext: [],
  inv: [],
  invByLetter: {},
  hotbar: new Array(9).fill(null),
  pending: [],         // queued answers for upcoming prompts: {key, re}
  pendingExt: null,
  pendingClick: null,
  rip: null,
  raw: false,
  lastStart: null,
  lastAct: 0,

  sendKeys(s) {
    post('K' + hex(s));
    this.ready = false;
    if (this.mode === 'yn' || this.mode === 'dir') this.endPrompt();
  },
  sendLine(l) { post(l); this.ready = false; },

  endPrompt() {
    this.mode = null;
    ui.hidePrompt();
  },

  closeText() { ui.closeTextFn && ui.closeTextFn(); },

  // ---- items -----------------------------------------------------------
  // a hotbar entry is an inventory letter, or "block:<type>" for building blocks
  hotbarItem(entry) {
    if (!entry) return null;
    if (entry.startsWith('block:')) {
      const type = entry.slice(6);
      if (!BLOCKS[type] || !blocks.inv[type]) return null;
      return { block: type, l: entry, q: blocks.inv[type], n: BLOCKS[type].name, icon: texUrl[BLOCKS[type].tex], cu: 2 };
    }
    return this.invByLetter[entry] || null;
  },
  ensureBlocksInHotbar() {
    for (const type of Object.keys(BLOCKS)) {
      const e = 'block:' + type;
      if (!blocks.inv[type] || this.hotbar.includes(e)) continue;
      let i = 8;
      while (i >= 0 && this.hotbarItem(this.hotbar[i])) i--;
      // a full hotbar with no blocks on it yet: the first block takes the last
      // slot, so you can build straight away (the item there stays in your pack)
      if (i < 0 && !this.hotbar.some((h) => h && h.startsWith('block:') && this.hotbarItem(h))) i = 8;
      if (i >= 0) this.hotbar[i] = e;
    }
    this.saveHotbar();
  },
  setInventory(items) {
    const before = new Set(this.inv.map((i) => i.l));
    const first = this.inv.length === 0 && !this.hotbarLoaded;
    this.inv = items;
    this.invByLetter = Object.fromEntries(items.map((i) => [i.l, i]));
    if (first) {
      this.loadHotbar();
      if (this.hotbar.every((h) => !h)) {
        const sorted = [...items].sort((a, b) => (b.w === 'weapon') - (a.w === 'weapon'));
        sorted.filter((i) => i.c !== '$' && (i.w === 'weapon' || !i.w || i.c !== '[')).slice(0, 9).forEach((i, k) => (this.hotbar[k] = i.l));
      }
    } else {
      for (const it of items) if (!before.has(it.l) && it.c !== '$') this.addToHotbar(it.l, false);
    }
    if (first && blocks.ident) this.ensureBlocksInHotbar();
    this.saveHotbar();
    ui.renderHotbar();
    if (ui.inventoryOpen) ui.renderInventory();
  },

  addToHotbar(l, force) {
    if (this.hotbar.includes(l)) return;
    let i = this.hotbar.findIndex((h) => !this.hotbarItem(h));
    if (i < 0 && force) i = ui.hotbarSel;
    if (i >= 0) this.hotbar[i] = l;
    this.saveHotbar();
    ui.renderHotbar();
    if (ui.inventoryOpen) ui.renderInventory();
  },
  hotbarKey() { return `nh3d.hotbar.${this.variant}.${this.charName || ''}`; },
  loadHotbar() {
    const h = safeJSON(localGet(this.hotbarKey()));
    if (Array.isArray(h)) this.hotbar = h.slice(0, 9).concat(new Array(9).fill(null)).slice(0, 9);
    this.hotbarLoaded = true;
  },
  saveHotbar() { if (this.charName) localSet(this.hotbarKey(), JSON.stringify(this.hotbar)); },

  // issue a NetHack command for an item; prompts for the item get answered automatically
  itemCmd(action, it, count) {
    const a = itemActions(it).find((x) => x.key === action) || { cmd: { drop: 'd' }[action] };
    if (!a.cmd) return;
    if (a.arg) { this.pending.push({ key: a.arg }); }
    else this.pending.push({ key: (count ? String(count) : '') + it.l });
    if (ui.inventoryOpen) { closeInventory(); relock(); }
    this.sendKeys(a.cmd);
  },
  useItem(it) {
    const a = itemActions(it)[0];
    this.itemCmd(a.key, it);
  },

  // drag & drop inside the inventory screen
  dropOnSlot(it, from, to) {
    if (it.block && to.dataset.hot == null) return; // blocks only go in the hotbar
    if (to.dataset.hot != null) {
      const i = +to.dataset.hot;
      const prev = this.hotbar.indexOf(it.l);
      if (prev >= 0) this.hotbar[prev] = this.hotbar[i];
      this.hotbar[i] = it.l;
      this.saveHotbar();
      ui.renderInventory();
      return;
    }
    if (to.dataset.equip) {
      const slot = to.dataset.equip;
      const armorSlots = ['helm', 'cloak', 'suit', 'shirt', 'gloves', 'boots', 'shield'];
      if (armorSlots.includes(slot)) { if (it.a === slot) this.itemCmd('wear', it); else ui.chat(`That doesn't go there.`, 'q'); return; }
      if (slot === 'weapon') return this.itemCmd('wield', it);
      if (slot === 'quiver') return this.itemCmd('quiver', it);
      // your alternate weapon (and, in the Off-hand, your second weapon, fighting with two):
      // your main weapon swapped aside, this one wielded, then swapped back, so your main
      // weapon stays in hand and this one is your alternate
      const makeAlt = (then) => {
        if (it.w === 'weapon') { ui.chat(`That's your main weapon.`, 'q'); return; }
        closeInventory();
        if (it.w === 'alt') { if (then) then(); return; }
        this.sendKeys('x');
        this.afterReady = () => {
          this.pending.push({ key: it.l });
          this.sendKeys('w');
          this.afterReady = () => { this.afterReady = then || null; this.sendKeys('x'); };
        };
      };
      if (slot === 'alt') return makeAlt();
      if (slot === 'offhand') {
        if (!(ui.stat && ui.stat.cantwo)) { ui.chat(`You can't fight with two weapons.`, 'q'); return; }
        return makeAlt(() => { if (!(ui.stat && ui.stat.twoweap)) { this.pendingExt = 'twoweapon'; this.sendKeys('#'); } });
      }
      if (slot === 'ringl' || slot === 'ringr') {
        if (it.c !== '=') return;
        this.pending.push({ key: it.l }, { key: slot === 'ringl' ? 'l' : 'r', re: /ring-finger/ });
        closeInventory();
        return this.sendKeys('P');
      }
      if (slot === 'amulet' || slot === 'eyes') return this.itemCmd('puton', it);
      return;
    }
    if (from.dataset.equip && to.dataset.letter) {
      // take off / unequip
      const s = from.dataset.equip;
      if (s === 'weapon') return this.itemCmd('unwield', it);
      if (s === 'quiver') { this.pending.push({ key: '-' }); closeInventory(); return this.sendKeys('Q'); }
      if (s === 'alt') { closeInventory(); return this.sendKeys('x'); }
      if (s === 'offhand') { closeInventory(); this.pendingExt = 'twoweapon'; return this.sendKeys('#'); } // (back to one weapon)
      if (['ringl', 'ringr', 'amulet', 'eyes'].includes(s)) return this.itemCmd('remove', it);
      return this.itemCmd('takeoff', it);
    }
    if (to.dataset.letter && from.dataset.letter && to.dataset.letter !== it.l) {
      const target = to.dataset.letter;
      if (target === '$' || target === '#') return;
      // #adjust (M-a): which item, then which letter
      this.pending.push({ key: it.l }, { key: target, re: /Adjust letter/ });
      this.sendKeys('\xe1');
    }
  },

  // ---- the Actions tab ----------------------------------------------------
  actionGroups() {
    const faith = !!(ui.stat && ui.stat.faith); // (his rites: for his followers only)
    const groups = ACTION_GROUPS.map((g) => ({ ...g, items: g.items.filter((a) => faith || !a.faith) }));
    return [{ title: 'Recommended', here: true, items: this.recommendations() }, ...groups];
  },
  recommendations() {
    if (!this.playing || !ui.stat) return [];
    return recommend({
      hero: world.hero, stat: ui.stat, CM, dirKey,
      cell: (x, y) => world.cell(x, y), classAt: (x, y) => world.classAt(x, y),
    });
  },
  refreshRecommend() {
    this.recs = this.recommendations();
    ui.renderRecommend(this.recs);
  },
  runAction(a) {
    closeInventory();
    if (a.fn === 'history') { ui.toggleHistory(true); return; }
    relock();
    if (a.fn === 'loot') return beginLoot({ kind: 'view' });
    if (a.fn === 'chestAt') return openChest(a.target);
    if (a.fn === 'allcmds') {
      releaseLock();
      const items = this.ext.map(([n, d], i) => ({ i, sel: 1, k: '', t: -1, s: `${n.padEnd(12)} ${d}` }));
      ui.showMenu({ how: 1, prompt: 'All commands', items }, (sel) => {
        relock();
        if (sel && sel.length) { this.pendingExt = this.ext[sel[0]][0]; this.sendKeys('#'); }
      });
      return;
    }
    if (a.answer) this.pending.push(a.answer);
    if (a.answers) this.pending.push(...a.answers);
    if (a.ext) { this.pendingExt = a.ext; this.sendKeys('#'); return; }
    this.sendKeys(a.keys);
  },

  answerSelect(k) {
    closeInventory();
    this.mode = null;
    ui.hidePrompt();
    this.sendKeys(k);
    relock();
  },
};

// ------------------------------------------------------------------ setup
const world = new World();
let npTimer = 0;
const music = new Music({
  volume: opts.music / 100,
  onTrack: (title) => {
    const el = $('#nowplaying');
    el.textContent = `Now playing: ${title}`;
    el.classList.add('show');
    clearTimeout(npTimer);
    npTimer = setTimeout(() => el.classList.remove('show'), 5000);
  },
});
const motion = new Motion();
const fx = new CombatFX();
{ // every attack (however it's made) holds the engine's replies until the blow lands (holdReplies)
  const attack = fx.attack.bind(fx);
  fx.attack = (x, y, now) => { attack(x, y, now); holdReplies(performance.now() + ATTACK_TIME * SLASH_CUT * 1000); };
}

// ---- Ascend (the engine's "dreamland" option): a blank baseplate, drawn as
// any brick level is (render.js): its floor, grey plates, and nothing on it
const SKY_FOG = [0.62, 0.80, 1.0]; // bright daytime haze
const ASCEND_FAR = 50; // how far Ascend's baseplate is drawn (squares): a quarter of the dungeon's
const DUNGEON_FOG = [0.04, 0.04, 0.06];
// BrickHack's dungeon is a brick maze out in the open, under a blue sky
function setSky() {
  renderer.daySky = true;
  renderer.spaceBelow = false;
  renderer.fog = SKY_FOG;
}
const nameTags = new NameTags($('#nametags'));
let figPicker = null; // the character select's minifig picker (figpick.js)
// mined blocks lying on the ground, waiting to be picked up
const drops = new Drops();
function pickUpBlock(type) {
  blocks.give(type);
  game.ensureBlocksInHotbar();
  ui.renderHotbar();
  if (ui.inventoryOpen) ui.renderInventory();
}

const blocks = new BlockWorld((line) => post(line));
world.blocks = blocks;
let texUrl = {}; // block texture name -> data URL (for inventory icons)

// ---- hero physics: gravity, falling, climbing (x/z still follow NetHack's squares).
// (No jumping in BrickHack: a minifig steps up onto a block, as up a ladder.)
const GRAVITY = 32; // blocks/s^2
const phys = { y: 0, vy: 0, onGround: true, peak: 0, reportedZ: 0, climb: null };
const CLIMB_V = 4.5; // blocks/s up or down a ladder
const onRoof = () => phys.y >= WALL_H - 0.5;

function updatePhysics(dt, now) {
  const [rx, rz] = motion.heroPos(now);
  const cx = Math.round(rx), cz = Math.round(rz);
  if (phys.climb != null) {
    // on a ladder: up or down at a steady pace, no gravity, no fall damage
    const d = phys.climb - phys.y, s = CLIMB_V * dt;
    phys.y = Math.abs(d) <= s ? phys.climb : phys.y + Math.sign(d) * s;
    phys.vy = 0;
    phys.peak = phys.y;
    phys.onGround = phys.y === phys.climb;
    if (phys.onGround) phys.climb = null;
    world.heroLift = phys.y;
    return;
  }
  const ground = world.groundAt(cx, cz, phys.y, onRoof());
  if (phys.onGround && ground < phys.y - 0.01) { phys.onGround = false; phys.peak = phys.y; phys.vy = 0; } // walked off an edge
  if (!phys.onGround) {
    phys.vy -= GRAVITY * dt;
    phys.y += phys.vy * dt;
    phys.peak = Math.max(phys.peak, phys.y);
    if (phys.y <= ground && phys.vy <= 0) {
      const fall = phys.peak - ground;
      phys.y = ground;
      phys.vy = 0;
      phys.onGround = true;
      // fall damage: 1 point per block beyond 3, scaled to your max HP
      if (fall > 3.2 && ui.stat) post('D ' + Math.max(1, Math.ceil(((fall - 3) * ui.stat.hpmax) / 20)));
    }
  }
  // never end up inside a block: step up onto it (like Minecraft's collision push-out)
  for (let i = 0; i < 3 && world.solidVoxel(cx, Math.floor(phys.y + 0.01), cz, onRoof()); i++) {
    phys.y = Math.floor(phys.y + 0.01) + 1;
    phys.vy = 0;
    phys.onGround = true;
    phys.peak = phys.y;
  }
  const z = phys.onGround ? Math.round(phys.y) : phys.reportedZ;
  if (z !== phys.reportedZ) { phys.reportedZ = z; post('Z ' + z); }
  world.heroLift = phys.y;
}

function rebuildTextures() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const a = ownAtlas; // block colours come from the game's own tiles, whatever the tileset
  const t = wallTile(), S = a.meta.size || 16;
  c.getContext('2d').drawImage(a.img, (t % a.meta.cols) * S, Math.floor(t / a.meta.cols) * S, S, S, 0, 0, 16, 16);
  const r = buildTextures(renderer, meta, c);
  renderer.slots = r.slot;
  texUrl = r.url;
  world.dirty = true;
  applyBlockArt();
}

// art/blocks/<block>.png replaces that block's texture (local only, like the
// monster sprites: drop in a texture pack's file); leaves.png covers all
// three leaf variants
let blockArt = null; // [{names, img}], loaded once
async function applyBlockArt() {
  if (!blockArt) {
    blockArt = [];
    let files = [];
    try { files = await (await fetch('/api/art?dir=blocks')).json(); } catch {}
    for (const f of files) {
      const name = f.replace(/\.[^.]+$/, '');
      const names = name === 'leaves' ? ['leaves', 'leaves1', 'leaves2'] : [name];
      if (!names.every((n) => renderer.slots[n] != null)) { console.warn(`art/blocks/${f}: no block texture called "${name}"`); continue; }
      const img = await loadImageURL('/art/blocks/' + encodeURIComponent(f));
      if (img) blockArt.push({ names, img });
    }
  }
  for (const { names, img } of blockArt) {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.drawImage(img, 0, 0, 16, 16);
    for (const n of names) { renderer.setTile(renderer.slots[n], c); texUrl[n] = c.toDataURL(); }
  }
  if (blockArt.length) world.dirty = true;
}
const ui = new UI(game);
let renderer;
let meta;

// onload rather than decode(): decode() can stall while the page is in the background
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('failed to load ' + src));
    i.src = src;
  });
}

// The tiles use teal (71,108,108) as their background; for on-screen icons
// (hotbar, inventory, held weapon) make a copy where that colour is transparent.
function keyedAtlasURL(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4)
    if (Math.abs(d.data[i] - 71) < 4 && Math.abs(d.data[i + 1] - 108) < 4 && Math.abs(d.data[i + 2] - 108) < 4) d.data[i + 3] = 0;
  x.putImageData(d, 0, 0);
  return c.toDataURL();
}

// each engine has its own tile atlas under assets/<variant>/; a tileset
// (Options) swaps in another drawing of the same tiles, from
// assets/tilesets/<id>/ (built by tools/tilesets/build_tileset.py)
export const TILESETS = [
  { id: 'slashem', label: "SLASH'EM" },
  { id: 'dcss', label: 'Dungeon Crawl' },
  { id: 'absurd', label: 'Absurd' },
];
const atlases = {};
let ownAtlas, atlasURL;
async function fetchAtlas(base) {
  if (!atlases[base]) {
    const res = await fetch(base + 'tiles.json');
    if (!res.ok) throw new Error('no tileset at ' + base);
    const m = await res.json();
    const img = await loadImage(base + 'tiles.png');
    atlases[base] = { meta: m, img, url: keyedAtlasURL(img) };
  }
  return atlases[base];
}
// the tilesets this copy has (Absurd only if you built it yourself)
async function availableTilesets() {
  const have = [];
  for (const t of TILESETS) {
    if (t.id === 'slashem') { have.push(t); continue; }
    try { if ((await fetch(`assets/tilesets/${t.id}/tiles.json`, { method: 'HEAD' })).ok) have.push(t); } catch {}
  }
  return have;
}
async function loadAtlas(variant) {
  ownAtlas = await fetchAtlas(`assets/${variant}/`);
  let a = ownAtlas;
  if (opts.tileset && opts.tileset !== variant) {
    try { a = await fetchAtlas(`assets/tilesets/${opts.tileset}/`); } catch (e) { console.warn(e.message); }
  }
  atlasURL = a.url;
  meta = a.meta;
  setCmapBase(a.meta);
  setAtlas(a.meta, a.url);
  if (renderer) renderer.setAtlas(a.img, a.meta, await loadMonsterArt(a.meta));
  return a;
}

// art/monsters/<monster name>.png replaces that monster's look in 3D
// (names as in art/monsters/MONSTERS.txt; '-' or '_' may stand for spaces)
async function loadMonsterArt(m) {
  let files = [];
  try { files = await (await fetch('/api/art?dir=monsters')).json(); } catch {}
  const end = m.names.findIndex((n) => n === 'strange object' || n === 'dummy object');
  // names compare without case or punctuation: "Poppy-Bros-Jr.png" is "Poppy Bros. Jr."
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const index = new Map(m.names.slice(0, end < 0 ? m.names.length : end).map((n, i) => [norm(n), i]));
  const out = [];
  for (const f of files) {
    const name = norm(f.replace(/\.[^.]+$/, ''));
    const tile = index.get(name);
    if (tile == null) { console.warn(`art/monsters/${f}: no monster called "${name}"`); continue; }
    const img = await loadImageURL('/art/monsters/' + encodeURIComponent(f));
    if (img) out.push({ tile, img });
  }
  return out;
}

async function init() {
  // BrickHack runs SLASH'EM only
  game.variants = [{ id: 'slashem', label: "SLASH'EM" }];
  game.variant = 'slashem';
  const { img } = await loadAtlas('slashem');
  renderer = new Renderer($('#view'), img, meta);
  renderer.setAtlas(img, meta, await loadMonsterArt(meta));
  game.tilesets = await availableTilesets();
  document.documentElement.style.setProperty('--bgtile', `url(${brickPlateTile()})`);
  buildScreens();
  // the items made in brick (brickitems.js): their models for the floor, their pictures for the slots
  // (the items' pictures are drawn as the page loads, what's on screen first: redraw as they come)
  onIcons(() => { if (game.playing) { ui.renderHotbar(); if (ui.renderInventory) ui.renderInventory(); } });
  loadBrickItems().then(() => { if (game.playing) { ui.renderHotbar(); if (ui.renderInventory) ui.renderInventory(); } });
  loadBrickMonsters();
  $('#actions-btn').onclick = (e) => { e.stopPropagation(); if (game.playing) { releaseLock(); ui.openInventory(null, 'actions'); } };
  requestAnimationFrame(frame);
  // music can only start after the first click or key press (browser autoplay rules)
  await music.load();
  const kick = () => { music.start(); window.removeEventListener('pointerdown', kick); window.removeEventListener('keydown', kick); };
  window.addEventListener('pointerdown', kick);
  window.addEventListener('keydown', kick);
}

// ------------------------------------------------------------------ event stream
let es;
function connect() {
  if (es) es.close();
  es = new EventSource(`/api/stream?sid=${sid}`);
  es.onmessage = (e) => {
    let m;
    // (an amulet's class is a double quote, which an engine built before winweb.c escaped it sends
    // bare in the inventory; mended, or the whole inventory would be lost)
    try { m = JSON.parse(e.data); } catch { try { m = JSON.parse(e.data.replace(/"c":"""/g, '"c":"\\""')); } catch { return; } }
    if (heldReplies.length || performance.now() < holdUntil) { heldReplies.push(m); return; } // (an attack's outcome waits for the blade)
    handle(m);
  };
}

// When you attack, the engine settles it at once; but what happens (a hit, a
// miss, a kill, the monster gone) is shown as the blade comes down: the
// replies are held until the slash reaches the bottom of its cut, then all
// handled, in order, together.
let holdUntil = 0, holdTimer = null;
const heldReplies = [];
function holdReplies(until) {
  holdUntil = Math.max(holdUntil, until);
  clearTimeout(holdTimer);
  holdTimer = setTimeout(releaseReplies, Math.max(0, holdUntil - performance.now()));
}
function releaseReplies() {
  holdTimer = null;
  while (heldReplies.length) handle(heldReplies.shift());
}

function handle(m) {
  switch (m.t) {
    case 'hello':
      game.ext = m.ext;
      if (m.cm) { setCmap(m.cm, m.cmapTiles); rebuildTextures(); }
      break;
    case 'clear': world.reset(); motion.mobs.clear(); break;
    case 'mons': motion.setMobs(m, performance.now()); break;
    case 'map': world.applyMap(m.c); break;
    case 'vis': world.setVis(m.v, m.w, m.h); break;
    case 'piles': world.applyPiles(m.p); break;
    case 'level':
      world.castle = m.castle || null; // the Castle: [x0, y0, x1, y1], where its stone walls stand (render.js raises them)
      ui.showTitle(`Level ${m.depth}`, m.dname);
      cam.snap = true;
      break;
    case 'stat':
      if (!game.charName) { game.charName = m.name; game.loadHotbar(); loadHeroFigure(m.name, m); }
      world.heroTile = game.skinLoaded && !m.poly ? skinTile() : null;
      // placed blocks belong to a dungeon level
      if (!blocks.ident) {
        const name = m.name, key = `${m.dnum}:${m.dlev}`;
        blocks.ident = { variant: game.variant, name }; // claim, then load
        blocks.load(game.variant, name).then(() => {
          blocks.enterLevel(key);
          game.ensureBlocksInHotbar();
          game.saveHotbar();
          ui.renderHotbar();
          world.dirty = true;
        });
      } else if (blocks.levelKey && blocks.enterLevel(`${m.dnum}:${m.dlev}`)) {
        Object.assign(phys, { y: 0, vy: 0, onGround: true, climb: null });
        drops.clear(); // (whatever was left lying stays behind)
        world.dirty = true;
      }
      ui.heroSkinURL = game.skinLoaded && !m.poly ? game.skinURL : null;
      if (ui.stat && ui.stat.poly === m.poly && ui.stat.depth === m.depth)
        fx.hpChange(ui.stat.hp, m.hp, m.hpmax, motion, world.hero, performance.now());
      world.setHero(m.ux, m.uy);
      motion.moveHero(m.ux, m.uy, performance.now(), cam.snap);
      cam.snap = false;
      ui.updateStatus(m);
      break;
    case 'inv': game.setInventory(m.items); redressHero(); break;
    case 'msg':
      if (m.raw) console.log('[slashem]', m.s);
      if (/For instructions type a \?/.test(m.s)) { game.mode = 'getpos'; break; }
      fx.onMessage(m.s, motion, world.hero, performance.now());
      ui.chat(m.s);
      break;
    case 'key': onKeyRequest(m); break;
    case 'yn': onYN(m); break;
    case 'menu': onMenu(m); break;
    case 'text':
      releaseLock();
      ui.showText(m.lines, () => { post('X'); relock(); });
      break;
    case 'line':
      releaseLock();
      ui.askLine(m.q, {}, (v) => { post(v == null ? 'X' : 'L' + hex(v)); relock(); });
      break;
    case 'ext':
      if (game.pendingExt) { post('E' + game.pendingExt); game.pendingExt = null; break; }
      releaseLock();
      ui.askLine('#', { list: game.ext }, (v) => { post(v ? 'E' + v.replace(/^[#/]/, '').trim() : 'X'); relock(); });
      break;
    case 'throw': { // the hero threw something: flown in an arc, to bounce and tumble to rest (throwfx.js)
      const l = brickItemForTile(m.tile);
      if (l && renderer.brickOn && renderer.brick) {
        const spit = / venom$/.test(l.name); // (spit: straight and dripping, and it splats where it reaches)
        renderer.brick.fx.launch(l.url, m.fx, m.fy, m.tx, m.ty, { spit });
        if (spit) renderer.brick.fx.shatter(l.url, m.tx, m.ty, 'venom');
      }
      if (m.by === 'monster') spitAt.set(`${m.fx},${m.fy}`, performance.now()); // (a creature there lunges: brickMonFigures)
      if (m.by !== 'monster' && hero3d.anim) hero3d.anim.attack('L'); // (you threw it: a swing of your left arm)
      break;
    }
    case 'shatter': { // something broke there: shards
      const l = brickItemForTile(m.tile);
      if (l && renderer.brickOn && renderer.brick) renderer.brick.fx.shatter(l.url, m.x, m.y, l.oc === 'potion'); // (a potion splashes too)
      break;
    }
    case 'push': { // the hero pushed a boulder: it rolls and tumbles into the next square (boulderfx.js)
      const l = brickItemForTile(m.tile);
      if (l && renderer.brickOn && renderer.brick) renderer.brick.boulderPush(l.url, m.fx, m.fy, m.tx, m.ty);
      hero3d.pushT0 = performance.now(); // (a lean into it: heroPose)
      break;
    }
    case 'crumble': { // a boulder broke into rocks: it bursts, grit and rocks flying
      const l = brickItemForTile(m.tile), rock = brickItemByName('rock');
      if (l && rock && renderer.brickOn && renderer.brick) renderer.brick.boulderBreak(l.url, m.x, m.y, rock.url);
      break;
    }
    case 'rip': game.rip = m; break;
    case 'bell': $('#hearts').classList.add('flash'); break;
    case 'prevmsg': ui.toggleHistory(); break;
    case 'gone': onGameOver(); break;
  }
}

function onKeyRequest(m) {
  game.ready = true;
  game.refreshRecommend();
  game.cursor = m.cx >= 0 ? { x: m.cx, y: m.cy } : null;
  game.pending = [];
  if (game.mode === 'yn' || game.mode === 'dir' || game.mode === 'select') game.endPrompt();
  if (game.mode === 'getpos') {
    if (game.pendingClick) {
      const p = game.pendingClick;
      game.pendingClick = null;
      game.sendLine(`C ${p.x} ${p.y} 1`);
      game.mode = null;
      return;
    }
    ui.showPrompt('Pick a location', [], 'Click (LMB) to choose · WASD move cursor · Space select · Esc cancel');
  }
  if (game.afterReady) { const f = game.afterReady; game.afterReady = null; f(); return; }
  if (chest.active) chestDone();
}

const YN_LABELS = { y: 'Yes', n: 'No', q: 'Quit', a: 'All', l: 'Left', r: 'Right' };

function onYN(m) {
  if (chest.active && chestYN(m)) return;
  // answer automatically if an item action queued this answer
  const i = game.pending.findIndex((p) => (p.re ? p.re.test(m.q) : m.r === ''));
  if (i >= 0) {
    const p = game.pending.splice(i, 1)[0];
    post('K' + hex(p.key));
    return;
  }
  game.ready = false;
  if (m.r === '' && /direction/i.test(m.q)) {
    game.mode = 'dir';
    ui.showPrompt(m.q, [{ label: 'Self (.)', fn: () => game.sendKeys('.') }, { label: 'Up (<)', fn: () => game.sendKeys('<') }, { label: 'Down (>)', fn: () => game.sendKeys('>') }],
      'Click (LMB) toward a target · WASD to pick a direction · Esc cancel');
    return;
  }
  const br = m.q.match(/\[([^\]]*)\]\s*$/);
  if (m.r === '' && br && /(What|Which) .* you want|What would you like/i.test(m.q)) {
    // item selection: open the inventory in "pick" mode
    const letters = new Set();
    const spec = br[1].split(' or ')[0];
    let allowDash = false;
    for (let k = 0; k < spec.length; k++) {
      if (spec[k] === '-' && k > 0 && k < spec.length - 1 && /[a-zA-Z]/.test(spec[k - 1]) && /[a-zA-Z]/.test(spec[k + 1])) {
        for (let c = spec.charCodeAt(k - 1); c <= spec.charCodeAt(k + 1); c++) letters.add(String.fromCharCode(c));
        k++;
      } else if (spec[k] === '-') allowDash = true;
      else if (/[a-zA-Z$#]/.test(spec[k])) letters.add(spec[k]);
    }
    // "... or .": something here to use instead (reading: the headstone or engraving you stand on)
    const allowHere = /\bor\b[^\]]*\./.test(br[1]);
    game.mode = 'select';
    releaseLock();
    ui.openInventory({ q: m.q, letters, allowDash, allowHere });
    return;
  }
  game.mode = 'yn';
  const choices = [...m.r].map((c) => ({ label: `${YN_LABELS[c] || c}${YN_LABELS[c] ? ` (${c})` : ''}`, fn: () => game.sendKeys(c) }));
  ui.showPrompt(m.q, choices, m.r ? '' : 'Type a key · Esc cancel');
  ui.chat(m.q, 'q');
}

function onMenu(m) {
  if (chest.active && chestMenu(m)) return;
  releaseLock();
  ui.showMenu(m, (sel) => {
    if (sel == null) post('X');
    else post('M ' + sel.map((i) => `${i}:-1`).join(' '));
    relock();
  });
}

function onGameOver() {
  game.playing = false;
  releaseLock();
  closeInventory();
  ui.hidePrompt();
  $('#hud').classList.add('hidden');
  if (game.rip) {
    const r = game.rip;
    $('#death .how').textContent = r.how ? r.how.charAt(0).toUpperCase() + r.how.slice(1) : '';
    $('#death .score').innerHTML = `Dungeon level: <span>${r.depth}</span> · Turns: <span>${r.turn}</span> · Gold: <span>${r.gold}</span>`;
    show('death');
  } else show('title');
  game.rip = null;
}

// The menus' background: a brick plate seen from above, 4x4 studs to a tile
// (dark bluish grey, each stud lit from the top left and casting a shadow)
function brickPlateTile(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d'), s = size / 4, r = s * 0.3;
  x.fillStyle = '#6c6e68';
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const cx = (i + 0.5) * s, cy = (j + 0.5) * s;
      x.fillStyle = 'rgba(0,0,0,0.35)'; // shadow
      x.beginPath(); x.arc(cx + r * 0.25, cy + r * 0.3, r * 1.04, 0, Math.PI * 2); x.fill();
      const g = x.createLinearGradient(cx - r, cy - r, cx + r, cy + r); // the stud's side, lit top left
      g.addColorStop(0, '#9a9c96'); g.addColorStop(1, '#4d4f4a');
      x.fillStyle = g;
      x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#767872'; // its flat top
      x.beginPath(); x.arc(cx - r * 0.06, cy - r * 0.08, r * 0.78, 0, Math.PI * 2); x.fill();
    }
  return c.toDataURL();
}

// ------------------------------------------------------------------ screens
const SCREENS = ['title', 'worlds', 'create', 'pause', 'options', 'controls', 'death', 'loading', 'reset'];
let returnTo = 'title';
function show(name) {
  for (const s of SCREENS) $('#' + s).classList.toggle('hidden', s !== name);
}
const anyScreen = () => SCREENS.some((s) => !$('#' + s).classList.contains('hidden'));

const ROLES = {
  slashem: ['random', 'Archeologist', 'Barbarian', 'Caveman', 'Flame Mage', 'Healer', 'Ice Mage', 'Knight', 'Monk', 'Necromancer', 'Priest', 'Rogue', 'Ranger', 'Samurai', 'Tourist', 'Undead Slayer', 'Valkyrie', 'Wizard', 'Yeoman'],
};
const RACES = {
  slashem: ['random', 'human', 'elf', 'dwarf', 'gnome', 'orc', 'hobbit', 'drow', 'doppelganger', 'lycanthrope', 'vampire', 'quantum', 'angel'],
};
const CYCLES = {
  role: ['Role', ROLES.slashem],
  race: ['Race', RACES.slashem],
  gender: ['Gender', ['random', 'male', 'female']],
  align: ['Alignment', ['random', 'lawful', 'neutral', 'chaotic']],
};
const SPLASHES = ['Now in 3D!', 'Elbereth!', 'Now with studs!', 'The DevTeam thinks of everything!', 'Do not eat the cockatrice!',
  'You hear the footsteps of a guard on patrol.', '100% tiles!', 'Ascend!', 'Mind your bare feet!', 'Watch out for soldier ants!'];

const CONTROLS = [
  ['Mouse', 'Look around'], ['W A S D', 'Move (relative to camera, 8 directions)'], ['Shift + WASD', 'Rush in a direction'],
  ['Left click', 'Attack / fight in the direction you look'], ['Right click', 'Use held item · open/close doors · travel to clicked spot'],
  ['Middle click', 'Look at what is under the crosshair'], ['1-9 / wheel', 'Select hotbar slot'], ['I', 'Inventory (and its Actions tab: every command as a button)'],
  ['Delete / Shift+Delete', 'Drop one / drop stack of held item'], ['Space', 'Use stairs (on stairs) · otherwise search'],
  ['Shift+1..4', 'Do a Recommended action: row 1, 2, 3, 4'], ['↑ (up arrow)', 'Do the first Recommended action'], ['Enter', 'Command bar (extended commands, "give <item>"...)'],
  ['Every other key', "NetHack's own, as ever: e eat, q quaff, r read, z zap, t throw, f fire, , pick up, # extended command, P put on, Alt+I invoke, Ctrl+D kick..."],
  ['Tab', 'Message history'], ['F2', 'Overhead map view on/off'], ['F5', 'Change camera (1st / 3rd back / 3rd front)'], ['F1', 'Hide HUD'],
  ['F3', 'Debug info'], ['`', 'Raw NetHack keys on/off (W A S D too)'], ['Esc', 'Cancel prompt / game menu'],
];

function buildScreens() {
  $('#title .splash').textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
  // every menu stands on a 3D brick baseplate; the title has BRICKHACK built on it
  const shown = (id) => !$('#' + id).classList.contains('hidden');
  const plated = SCREENS.filter((id) => $('#' + id).classList.contains('dirt'));
  if (menuPlate($('#menu-plate'), $('#title .logo-slot'), () => ({ plate: plated.some(shown), title: shown('title') })))
    document.body.classList.add('brick3d');
  else $('#title .logo').classList.add('no-gl');
  $('#title [data-act=singleplayer]').onclick = openWorlds;
  // Reset Game: delete every save, block world and bones (after a confirmation)
  const RESET_TEXT = $('#reset .reset-text').innerHTML;
  $('#title [data-act=reset]').onclick = () => {
    $('#reset .reset-text').innerHTML = RESET_TEXT;
    $('#reset [data-act=reset-yes]').classList.remove('hidden');
    $('#reset [data-act=reset-no]').textContent = 'Cancel';
    show('reset');
  };
  $('#reset [data-act=reset-no]').onclick = () => show('title');
  $('#reset [data-act=reset-yes]').onclick = async () => {
    let text;
    try {
      const r = await fetch('/api/reset', { method: 'POST' });
      const j = await r.json();
      text = r.ok ? `Done: ${j.deleted} file${j.deleted === 1 ? '' : 's'} deleted. Every character starts fresh.` : j.error;
    } catch { text = "Couldn't reach the game server."; }
    $('#reset .reset-text').textContent = text;
    $('#reset [data-act=reset-yes]').classList.add('hidden');
    $('#reset [data-act=reset-no]').textContent = 'Back';
  };
  $('#title [data-act=dreamland]').onclick = () => { game.createDream = true; applyVariantLists(); show('create'); };
  $('#title [data-act=controls]').onclick = () => { returnTo = 'title'; show('controls'); };
  $('#title [data-act=options]').onclick = () => { returnTo = 'title'; openOptions(); };
  $('#worlds [data-act=create]').onclick = () => { game.createDream = false; applyVariantLists(); show('create'); };
  $('#worlds [data-act=back]').onclick = () => show('title');
  $('#create [data-act=back]').onclick = () => show(game.createDream ? 'title' : 'worlds');

  // BrickHack starts you as a human male Knight (role 7, race 1, gender 1); the
  // alignment always starts random (the game picks one that fits)
  const choice = { role: 7, race: 1, gender: 1, ...safeJSON(localGet('bh.create')), align: 0 };
  delete choice.legacy; // (a choice no more: every new game opens with its story)
  const nameIn = $('#cname');
  nameIn.value = localGet('nh3d.name') || '';
  let syncPicker = () => {}; // the minifig picker follows the role and gender
  let sworn = null; // a figure with a deity of its own (its design's "god": Jesus) is held to its alignment: lawful
  const draws = [];
  // Role, race, gender and alignment open a menu of their options; an option
  // that can't go with the other choices (by the game's own rules) is greyed
  // out, and a choice that clashes (an old saved one) shows red and blocks Create.
  let rules = null;
  const cap = (s) => s.replace(/^./, (c) => c.toUpperCase());
  const pick = () => Object.fromEntries(['role', 'race', 'gender', 'align'].map((k) => [k, CYCLES[k][1][choice[k]]]));
  const RULED = ['role', 'race', 'gender', 'align'];
  const refresh = () => {
    draws.forEach((d) => d());
    const bad = RULED.some((k) => conflicts(rules, pick(), k, pick()[k]).length);
    $('#create [data-act=go]').disabled = bad;
    $('#create [data-act=go]').title = bad ? 'These choices don\'t go together (the red one)' : '';
  };
  const closeMenu = () => { const m = $('#choice-menu'); if (m) m.remove(); };
  const openMenu = (b, k) => {
    closeMenu();
    if (k === 'align' && sworn) return; // (fixed by the figure's faith)
    const menu = document.createElement('div');
    menu.id = 'choice-menu';
    menu.className = 'choice-menu';
    CYCLES[k][1].forEach((v, i) => {
      const o = document.createElement('button');
      o.className = 'mc-btn' + (i === choice[k] ? ' current' : '');
      o.textContent = cap(v);
      const clash = RULED.includes(k) ? conflicts(rules, pick(), k, v) : [];
      if (clash.length) {
        o.disabled = true;
        o.title = `Not with ${clash.map((c) => cap(pick()[c])).join(' / ')}`;
      }
      o.onclick = (e) => { e.stopPropagation(); choice[k] = i; closeMenu(); refresh(); syncPicker(); };
      menu.appendChild(o);
    });
    document.body.appendChild(menu);
    // under the button, or above it if there's no room below
    const r = b.getBoundingClientRect(), h = menu.offsetHeight;
    menu.style.left = `${Math.max(8, r.left + r.width / 2 - menu.offsetWidth / 2)}px`;
    menu.style.top = `${r.bottom + 4 + h < innerHeight ? r.bottom + 4 : Math.max(8, r.top - 4 - h)}px`;
  };
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#choice-menu, #create .cycle')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  document.querySelectorAll('#create .cycle').forEach((b) => {
    const k = b.dataset.key;
    const draw = () => {
      choice[k] %= CYCLES[k][1].length;
      b.textContent = `${CYCLES[k][0]}: ${cap(CYCLES[k][1][choice[k]])}` + (k === 'align' && sworn ? ` (${sworn})` : '');
      b.classList.toggle('conflict', RULED.includes(k) && conflicts(rules, pick(), k, pick()[k]).length > 0);
      if (k === 'align') {
        b.classList.toggle('sworn', !!sworn);
        b.title = sworn ? `A follower of ${sworn} is lawful` : '';
      }
    };
    b.onclick = (e) => {
      if (!RULED.includes(k)) { choice[k] = (choice[k] + 1) % CYCLES[k][1].length; refresh(); return; }
      if ($('#choice-menu')) return closeMenu();
      openMenu(b, k);
    };
    draws.push(draw);
  });
  loadRules().then((r) => { rules = r; refresh(); });
  // a lock beside each of them keeps it as it is when the dice roll; the
  // alignment starts locked (on Random)
  const locked = new Set(['align']);
  for (const k of RULED) {
    const b = $(`#create .cycle[data-key=${k}]`);
    const row = document.createElement('div');
    row.className = 'lock-row';
    b.replaceWith(row);
    const lock = document.createElement('button');
    lock.className = 'mc-btn lock-btn';
    const drawLock = () => {
      lock.textContent = locked.has(k) ? '\u{1F512}' : '\u{1F513}';
      lock.classList.toggle('on', locked.has(k));
      lock.title = locked.has(k) ? `${CYCLES[k][0]} is locked: the dice leave it alone` : `Lock the ${CYCLES[k][0].toLowerCase()} so the dice leave it alone`;
    };
    lock.onclick = () => { locked.has(k) ? locked.delete(k) : locked.add(k); drawLock(); };
    drawLock();
    row.append(b, lock);
  }
  // the dice: everything unlocked rerolled, to something that goes with the locked ones
  $('#create [data-act=roll]').onclick = () => {
    const any = (k) => CYCLES[k][1].map((v, i) => i).filter((i) => CYCLES[k][1][i] !== 'random');
    const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
    const free = RULED.filter((k) => !locked.has(k) && !(k === 'align' && sworn));
    for (const k of free) choice[k] = 0;
    for (const k of free) {
      const ok = any(k).filter((i) => !conflicts(rules, pick(), k, CYCLES[k][1][i]).length);
      if (ok.length) choice[k] = pickOne(ok);
    }
    refresh();
    syncPicker();
  };
  applyVariantLists = () => {
    CYCLES.role[1] = ROLES.slashem;
    CYCLES.race[1] = RACES.slashem;
    refresh();
    syncPicker();
    $('#create h2').textContent = game.createDream ? 'Ascend: Create New Character' : 'Descend: Create New Character';
  };
  // your character is named for the figure you pick, unless you have typed a name of your own
  const figNames = new Set();
  // a figure sworn to a deity of its own (Jesus) is lawful, whatever else was chosen; another frees it
  const swear = (fig) => {
    const god = (fig && fig.god) || null;
    if (god) choice.align = CYCLES.align[1].indexOf('lawful');
    else if (sworn) choice.align = 0;
    sworn = god;
    refresh();
  };
  figPicker = setupFigurePicker($('#figpick'), () => !$('#create').classList.contains('hidden'), (fig) => {
    if (!nameIn.value || nameIn.value === 'Steve' || figNames.has(nameIn.value)) nameIn.value = fig.label;
    figNames.add(fig.label);
    swear(fig);
  });
  loadRoster().then((r) => r.forEach((f) => figNames.add(f.label)));
  syncPicker = () => { figPicker.filter(CYCLES.role[1][choice.role], CYCLES.gender[1][choice.gender], CYCLES.race[1][choice.race]); swear(figPicker.current()); };
  syncPicker();
  $('#create [data-act=go]').onclick = () => {
    localSet('bh.create', JSON.stringify(choice));
    localSet('nh3d.name', nameIn.value);
    if (figPicker.current()) {
      localSet(FIG_KEY(nameIn.value), figPicker.current().id);
      localSet(FIG_KEY(nameIn.value) + '.parts', JSON.stringify(figPicker.parts()));
      localSet(FIG_KEY(nameIn.value) + '.start', 'new'); // (a new character: what it first wears is its starting gear: startGear)
    }
    const o = { name: nameIn.value };
    for (const k of ['role', 'race', 'gender', 'align']) {
      const v = CYCLES[k][1][choice[k]].toLowerCase();
      // roles go by their 3-letter file code (handles "Flame Mage" etc), races by full name
      o[k] = v === 'random' ? 'random' : k === 'race' ? v : v.slice(0, 3);
    }
    const fig = figPicker.current();
    if (fig) for (const k of ['kit', 'god', 'perks']) if (fig[k]) o[k] = fig[k]; // (what its design starts it with besides, its deity, its gifts)
    o.dreamland = !!game.createDream;
    o.variant = game.variant;
    startGame(o);
  };

  $('#pause [data-act=resume]').onclick = resume;
  $('#pause [data-act=options]').onclick = () => { returnTo = 'pause'; openOptions(); };
  $('#pause [data-act=controls]').onclick = () => { returnTo = 'pause'; show('controls'); };
  $('#pause [data-act=savequit]').onclick = () => {
    show(null);
    game.pending.push({ key: 'y', re: /save/i });
    game.sendKeys('S');
  };
  $('#controls [data-act=done]').onclick = () => show(returnTo);
  const tbl = $('#controls-table');
  for (const [k, d] of CONTROLS) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td></td><td></td>`;
    tr.children[0].textContent = k;
    tr.children[1].textContent = d;
    tbl.appendChild(tr);
  }

  $('#options [data-act=done]').onclick = () => { saveOpts(); show(returnTo); };
  $('#options [data-opt=camera]').onclick = () => { opts.camera = (opts.camera + 1) % 4; drawOptions(); };
  $('#options [data-opt=wallStyle]').onclick = () => { opts.wallStyle = opts.wallStyle === 'brick' ? 'exact' : 'brick'; world.dirty = true; drawOptions(); };
  $('#options [data-opt=tileset]').onclick = async () => {
    const list = game.tilesets || TILESETS.slice(0, 1);
    const i = list.findIndex((t) => t.id === opts.tileset);
    opts.tileset = list[(i + 1) % list.length].id;
    drawOptions();
    await loadAtlas(game.variant);
    // the new atlas needs our block textures, the skins and the open screens again
    if (renderer.slots) rebuildTextures();
    heldTile = null;
    world.dirty = true;
    if (game.playing) ui.renderHotbar();
  };
  $('#options [data-opt=playerModel]').onclick = () => { opts.playerModel = opts.playerModel === 'model' ? 'sprite' : 'model'; drawOptions(); };
  for (const k of ['fov', 'sens', 'music']) $(`#options [data-opt=${k}]`).oninput = (e) => { opts[k] = +e.target.value; drawOptions(); };

  $('#death [data-act=respawn]').onclick = () => game.lastStart && startGame(game.lastStart);
  $('#death [data-act=title]').onclick = () => show('title');
}

function drawOptions() {
  $('#options [data-opt=camera]').textContent = `Camera: ${CAMERA_NAMES[opts.camera]}`;
  $('#options [data-opt=wallStyle]').textContent = `Wall blocks: ${opts.wallStyle === 'brick' ? 'Brick tile' : 'Exact wall tiles'}`;
  const ts = (game.tilesets || TILESETS).find((t) => t.id === opts.tileset) || TILESETS[0];
  $('#options [data-opt=tileset]').textContent = `Tileset: ${ts.label}`;
  $('#options [data-opt=playerModel]').textContent = `Player: ${opts.playerModel === 'model' ? 'Brick figure' : 'Game sprite'}`;
  const f = $('#options [data-opt=fov]');
  f.value = opts.fov;
  f.nextElementSibling.textContent = `FOV: ${opts.fov}`;
  const s = $('#options [data-opt=sens]');
  s.value = opts.sens;
  s.nextElementSibling.textContent = `Sensitivity: ${opts.sens}%`;
  const mv = $('#options [data-opt=music]');
  mv.value = opts.music;
  mv.nextElementSibling.textContent = opts.music ? `Music: ${opts.music}%` : 'Music: OFF';
  music.setVolume(opts.music / 100);
}
function openOptions() { drawOptions(); show('options'); }

let applyVariantLists = () => {};
const variantLabel = () => (game.variants.find((v) => v.id === game.variant) || {}).label || game.variant;

async function openWorlds() {
  show('worlds');
  const list = $('#worlds .worldlist');
  list.textContent = '';
  let saves = [];
  try { saves = await (await fetch(`/api/saves?variant=${game.variant}`)).json(); } catch {}
  if (!saves.length) list.innerHTML = '<div class="empty">No saved characters yet</div>';
  for (const n of saves) {
    const d = document.createElement('div');
    d.className = 'world';
    d.innerHTML = '<div class="avatar"></div><div><div class="name"></div><div class="sub">Saved game · click to continue</div></div>';
    d.querySelector('.name').textContent = n;
    const av = loadSkinURL(n);
    if (av) d.querySelector('.avatar').style.backgroundImage = `url(${av})`;
    else d.querySelector('.avatar').style.visibility = 'hidden';
    d.onclick = async () => { // (its figure's deity and gifts, again: the engine sets them up on every restore)
      const fig = (await loadRoster()).find((f) => f.id === localGet(FIG_KEY(n)));
      const o = { name: n, variant: game.variant };
      if (fig) for (const k of ['god', 'perks']) if (fig[k]) o[k] = fig[k];
      startGame(o);
    };
    list.appendChild(d);
  }
}

async function startGame(o) {
  game.lastStart = o;
  setSky();
  music.reshuffle(); // a new game, a new random tune
  show('loading');
  game.variant = o.variant || game.variant;
  await loadAtlas(game.variant);
  world.reset();
  motion.reset();
  blocks.ident = null;
  blocks.levelKey = null;
  blocks.map = new Map();
  Object.assign(phys, { y: 0, vy: 0, onGround: true, peak: 0, reportedZ: 0, climb: null });
  nameTags.clear();
  drops.clear();
  cam.snap = true;
  Object.assign(game, { playing: true, ready: false, mode: null, inv: [], invByLetter: {}, pending: [], rip: null, charName: null, hotbarLoaded: false, hotbar: new Array(9).fill(null) });
  ui.chatLines.forEach((l) => l.remove());
  ui.chatLines = [];
  connect();
  await fetch(`/api/start?sid=${sid}`, { method: 'POST', body: JSON.stringify(o) });
  setTimeout(() => {
    show(null);
    $('#hud').classList.toggle('hidden', !opts.hud);
    relock();
  }, 400);
}

function resume() {
  show(null);
  relock();
}

// ------------------------------------------------------------------ skins
const creator = { file: null, url: null, removeBg: true, palette: true };
const skinTile = () => meta.count; // first free slot in the tile atlas


// ---- the hero as a brick minifig (on brick levels), chosen at character creation
// (by the name as the server keeps it: server.js cleanName, so "Knight of St. Lazarus" is KnightofStLazarus)
const FIG_KEY = (name) => 'lh.fig.' + (String(name || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) || 'Steve').toLowerCase();
const hero3d = { id: null, prims: null, anim: null, jabT0: -1 };
// who: the engine's status ({baserole, female, race}); a random role, race or
// gender may have come out differently from the figure picked, so then take
// the best fit for the character the game made (figuresFor)
async function loadHeroFigure(name, who) {
  const roster = await loadRoster();
  if (!roster.length) return;
  let fig = roster.find((f) => f.id === localGet(FIG_KEY(name)));
  if (who && who.baserole) {
    const fitting = figuresFor(roster, who.baserole.toLowerCase(), who.female ? 'female' : 'male', String(who.race || 'human').toLowerCase());
    if (!fitting.includes(fig)) fig = fitting[0];
  }
  fig = fig || roster[0];
  localSet(FIG_KEY(name), fig.id);
  // dressed up from the wardrobe at character creation? (the same swaps on whichever figure fits)
  let parts = {};
  try { parts = JSON.parse(localGet(FIG_KEY(name) + '.parts') || '{}') || {}; } catch {}
  hero3d.fig = fig;
  hero3d.parts = parts;
  hero3d.start = null; // (this character's starting gear: startGear)
  // the armour it started with is its design's own: each slot's piece, for the inventory and the floor
  setStartPieces(fig.id, parts).then(() => { ui.renderInventory(); ui.renderHotbar(); redressHero(); });
  hero3d.wear = wornHelm(); // (a helm on already: a restored game)
  const url = (await customFigureUrl(fig.id, parts, hero3d.wear)) || fig.url;
  hero3d.id = fig.id;
  hero3d.url = url;
  hero3d.prims = null;
  try { hero3d.prims = await renderer.figRender.model(url); } catch (e) { console.warn('hero figure:', e); }
  // the figure comes alive (minifig-anim.js): a big stretch as you arrive, then breathing, looking about...
  hero3d.anim = hero3d.prims && hero3d.prims.rig ? new FigureAnimator(hero3d.prims.rig) : null;
  if (hero3d.anim) hero3d.anim.spawn();
  // ...and in the inventory, beside your equipment
  if (!heroView) heroView = figureView($('#hero-preview .hero-fig'), () => $('#hero-preview').offsetParent !== null);
  if (heroView) { await heroView.show(url); ui.heroFigure = true; ui.renderCharStats(); }
}
let heroView = null;

// What your minifig shows of what you wear, for the server to dress it in:
// a list, comma-separated. A new character looks just as designed: the pieces
// it was designed with ARE the gear it starts wearing (a knight's helmet, his
// shield). Take a starting piece off and its designed piece goes with it
// ("strip:<slot>"); anything else you put on shows (items made in brick to be
// worn: items.json "wear"), in its slot. (A designed shield is put back in
// hand while you wear the one you started with: "design:shield", the roster's
// figures being built empty-handed.)
const WORN_SLOTS = ['shirt', 'suit', 'cloak', 'helm', 'shield', 'boots', 'gloves']; // (in the order they go on: a suit over a shirt; a helm takes a cloak's hood off)
function startGear() { // {items: {letter: slot} you started wearing, claimed: the slots they stood in} (kept with the character)
  if (hero3d.start) return hero3d.start;
  const key = FIG_KEY(game.charName) + '.start', kept = localGet(key);
  let st = null;
  try { st = kept && kept !== 'new' && JSON.parse(kept); } catch {}
  if (st && st.items) hero3d.start = st;
  else if (game.inv.length) { // (once the game has said what you have)
    // a character just made (the creator marks it 'new'): what it wears now is its starting
    // gear; a game from before this was kept: none
    const items = {};
    if (kept === 'new') for (const i of game.inv) if (WORN_SLOTS.includes(i.w)) items[i.l] = i.w;
    hero3d.start = { items, claimed: [...new Set(Object.values(items))] };
    localSet(key, JSON.stringify(hero3d.start));
  }
  return hero3d.start || { items: {}, claimed: [] };
}
function wornHelm() {
  const start = startGear(), slots = (hero3d.fig && hero3d.fig.slots) || {};
  for (const [l, slot] of Object.entries(start.items)) // (taken off: no longer starting gear)
    if (!game.inv.some((i) => i.l === l && i.w === slot)) { delete start.items[l]; localSet(FIG_KEY(game.charName) + '.start', JSON.stringify(start)); }
  return WORN_SLOTS.map((slot) => {
    const h = game.inv.find((i) => i.w === slot);
    if (h && isStartTile(h.t)) { // armour it started with: its design's own piece shows (where the design has one; else as ever)
      const l = brickItemForTile(h.t);
      if (l && l.start) return slot === 'shield' && slots.shield ? 'design:shield' : '';
      return l && l.wear ? l.name : '';
    }
    if (h && start.items[h.l]) return slot === 'shield' && slots.shield ? 'design:shield' : ''; // as designed
    if (!h) return start.claimed.includes(slot) && slots[slot] ? 'strip:' + slot : ''; // its starting piece taken off
    const l = brickItemForTile(h.t);
    return l && l.wear ? l.name : '';
  }).filter(Boolean).join(',');
}
// put on (or take off) armour, a cloak, a helm or a shield: your minifig, rebuilt by the server
// wearing them (a helm: hair and its own hat off: tools/wardrobe.py wearing), swapped in
async function redressHero() {
  if (!hero3d.fig) return;
  const wear = wornHelm();
  if (wear === hero3d.wear) return;
  hero3d.wear = wear;
  const url = (await customFigureUrl(hero3d.fig.id, hero3d.parts, wear)) || hero3d.fig.url;
  if (hero3d.wear !== wear || url === hero3d.url) return; // (changed again meanwhile)
  let prims = null;
  try { prims = await renderer.figRender.model(url); } catch (e) { console.warn('hero figure:', e); return; }
  if (hero3d.wear !== wear) return;
  hero3d.url = url;
  hero3d.prims = prims;
  hero3d.anim = prims && prims.rig ? new FigureAnimator(prims.rig) : null;
  if (heroView) heroView.show(url);
}
// the minifig stands in for the doll and the hero's sprite on brick levels
const showFigure = () => !!hero3d.prims && opts.playerModel === 'model' && opts.camera !== 0 && !(ui.stat && ui.stat.poly);

// What the hero has in each hand, as brick: {R, L}, each an item's url;
// null: nothing in that hand; undefined: something not made in brick yet (the
// figure keeps what it was built holding). The left hand only while fighting
// with two weapons (the "alt" weapon); otherwise it's left as built (a shield...).
const heldPrims = new Map(); // url -> the item's prims for brick.js (loading: null)
// Punished: an iron chain beside you (chains are only ever the punished hero's), and the heavy iron
// ball nearest it (or in your arms): {chain, ball (its floor item, or null: carried)}, or null
function punishment() {
  const h = world.hero, drops = world.brickDrops || [];
  const chain = drops.find((d) => d.name === 'iron chain' && Math.abs(d.x - h.x) <= 1 && Math.abs(d.z - h.y) <= 1);
  if (!chain) return null;
  if (heavyBall()) return { chain, ball: null };
  let best = null;
  for (const d of drops) if (d.name === 'heavy iron ball') { const r = Math.hypot(d.x - chain.x, d.z - chain.z); if (r <= 2.5 && (!best || r < best.r)) best = { d, r }; }
  return best ? { chain, ball: best.d } : null;
}
// the heavy iron ball, if you're carrying it (punished, you can pick it up: the hardest thing you'll ever carry)
const heavyBall = () => game.inv.find((i) => { const l = brickItemForTile(i.t); return l && l.name === 'heavy iron ball'; });
function heroHold() {
  const wep = game.inv.find((i) => i.w === 'weapon');
  const two = !!(ui.stat && ui.stat.twoweap);
  const alt = two ? game.inv.find((i) => i.w === 'alt') : null;
  const as = (it) => { const l = brickItemForTile(it.t); return l ? l.url : undefined; };
  const isRing = (it) => it && it.c === '=';
  const hold = { R: wep && !isRing(wep) ? as(wep) : null, L: alt && !isRing(alt) ? as(alt) : undefined, two };
  const ball = heavyBall();
  if (ball) { hold.R = null; hold.L = null; hold.two = false; hold.hug = punishment() ? undefined : as(ball); } // (lugging the ball: weapons put away, it held before you: on its chain, the chain's own ball)
  if (statuePerch(performance.now())) { hold.R = null; hold.L = null; hold.two = false; } // (climbing a statue: hands free)
  // rings: worn as bracelets round the wrists, the right ring on the right
  // (and a ring wielded: on the wrist too, not in the fist)
  const worn = (slot) => game.inv.find((i) => i.w === slot);
  const ringR = worn('ringr') || (isRing(wep) ? wep : null), ringL = worn('ringl') || (isRing(alt) ? alt : null);
  hold.ringR = ringR ? as(ringR) : undefined;
  hold.ringL = ringL ? as(ringL) : undefined;
  // an amulet: worn on the chest, on its ribbon round the neck. The Amulet of Yendor glows,
  // crackles and flares, real or not, until a fake is known for what it is: then it's just plastic
  const am = worn('amulet'), aml = am && brickItemForTile(am.t);
  const fake = am && /cheap plastic imitation/.test(am.n) && brickBuilt('_plastic Amulet of Yendor');
  hold.amulet = fake ? fake.worn : aml && aml.worn ? aml.worn : undefined;
  for (const url of [hold.R, hold.L, hold.ringR, hold.ringL, hold.amulet])
    if (url && !heldPrims.has(url)) {
      heldPrims.set(url, null);
      renderer.figRender.model(url).then((p) => heldPrims.set(url, p)).catch(() => {});
    }
  return hold;
}
// brick.js entries for what's held, on a figure drawn at `matrix` with its
// hands' joint matrices `hands` ({R, L}): each item at its hand's grip
function heldEntries(hold, rig, matrix, hands) {
  const out = [];
  for (const side of ['R', 'L']) {
    const url = hold[side], prims = url && heldPrims.get(url), j = rig['arm' + side];
    if (prims && j && j.grip && hands[side]) out.push({ prims, matrix: mul4(matrix, mul4(hands[side], new Float32Array(j.grip))), shade: 1 });
    const ring = hold['ring' + side] && heldPrims.get(hold['ring' + side]), w = ring && hands[side] && wristMatrix(rig, side);
    if (w) out.push({ prims: ring, matrix: mul4(matrix, mul4(hands[side], new Float32Array(w))), shade: 1 }); // (a bracelet)
  }
  // an amulet: on the chest, 12 LDU below the neck (the rig's: a dwarf's is lower), moving with the body
  const am = hold.amulet && heldPrims.get(hold.amulet), neck = rig.head && rig.head.pivot;
  if (am && neck && hands.body) out.push({ prims: am, matrix: mul4(matrix, mul4(hands.body, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, neck[1] - 12 / 20, 10 / 20, 1]))), shade: 1 });
  return out;
}
const skipped = (hold) => ['R', 'L'].filter((s) => hold[s] !== undefined).map((s) => 'item' + s);

// the hero minifig's joints this frame: walking when moving (or falling),
// swinging what's in the right hand on each attack (fx.attack)
function heroPose(dt, now) {
  const a = hero3d.anim;
  if (!a) return null;
  if (fx.jabT0 !== hero3d.jabT0) {
    if (hero3d.jabT0 !== -1) a.attack();
    hero3d.jabT0 = fx.jabT0;
  }
  const hold = hero3d.hold || {};
  // a statue: the hop up onto its ledge, and gazing up at it; a boulder: a lean into the push;
  // the ball: lugged, as if it were the hardest thing in the world
  const pp = statuePerch(now), push = Math.max(0, 1 - (now - (hero3d.pushT0 ?? -1e9)) / 700);
  return a.update(dt, { moving: game.playing && (motion.heroRemaining(now) > 0 || !phys.onGround),
    holdsR: !!hold.R, holdsL: !!hold.L, twoweap: !!hold.two,
    hop: pp ? pp.hop : 0, lookUp: pp ? pp.lookUp : 0, lean: push > 0 ? 0.3 : 0, reach: push > 0 ? 1 : 0, heavy: heavyBall() ? 1 : 0 });
}

// ---- standing at a statue: up on its ledge, gazing at it (perch.js)
const perchFrom = { x: 0, y: 0, cur: null }; // the square you came from
function statuePerch(now) {
  cameFrom(perchFrom, world.hero);
  return perchSpot(world.hero, perchFrom, motion.heroPos(now), world.brickDrops);
}

// ---- monsters made in brick (web/assets/brick/monsters.json, built by
// tools/build_roster.py): drawn as their minifig in place of their sprite,
// alive as the hero is (breathing, looking about, walking, swinging what
// they hold when they lunge at you), always facing you
const spitAt = new Map(); // x,y -> when a monster there last threw or spat something (its creature lunges)
const brickMons = new Map(); // tile -> {url, hold (an item's url), prims, anim, lungeT0, last}
async function loadBrickMonsters() {
  const get = (u) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const [mons, tiles, items] = await Promise.all([get('assets/brick/monsters.built.json'), get('assets/slashem/tiles.json'), get('assets/brick/items.built.json')]);
  (tiles.names || []).forEach((n, i) => {
    const m = mons[n];
    if (!m) return;
    const e = { url: m.url, hold: m.hold && items[m.hold] ? items[m.hold].url : undefined, prims: null, anim: null, lungeT0: null, last: null,
      creature: m.creature, slither: m.slither, lift: m.lift || 0 };
    brickMons.set(i, e);
    renderer.figRender.model(m.url).then((p) => { e.prims = p; e.anim = p && p.rig ? new FigureAnimator(p.rig) : null; if (e.anim) e.anim.spawn(); })
      .catch((err) => console.warn('brick monster:', n, err));
  });
}
// take the brick monsters' sprites out of the list; their figures, for renderer.brickFigures
function brickMonFigures(sprites, dt, now) {
  if (!brickMons.size) return [];
  const out = [];
  const [hx, hz] = motion.heroPos(now);
  for (let i = sprites.length - 1; i >= 0; i--) {
    const s = sprites[i], e = s.mon && brickMons.get(s.tile);
    if (!e || !e.prims) continue;
    sprites.splice(i, 1);
    const f = s.mob && fx.mobFX && fx.mobFX.get(s.mob.id);
    if (e.anim && f && f.kind === 'lunge' && f.t0 !== e.lungeT0) { e.lungeT0 = f.t0; e.anim.attack(); }
    const moving = !!e.last && Math.hypot(s.x - e.last[0], s.z - e.last[1]) > 0.002 && !(f && f.kind === 'lunge');
    e.last = [s.x, s.z];
    const yaw = Math.atan2(hx - s.x, -(hz - s.z)); // (the game's yaw: 0 looks north, -Z)
    if (e.creature) { // (a creature: no joints, the whole of it moving: creature.js)
      const spat = spitAt.get(`${Math.round(s.x)},${Math.round(s.z)}`);
      if (spat && spat > (e.spatT0 || 0)) { e.spatT0 = spat; e.lungeAt = now / 1000; }
      if (f && f.kind === 'lunge' && f.t0 !== e.lungeT0) { e.lungeT0 = f.t0; e.lungeAt = now / 1000; }
      const local = creatureLocal(e.creature, now / 1000, { moving, lungeT: e.lungeAt ?? -1e9 });
      out.push({ prims: e.prims, url: e.url, matrix: mul4(partMatrix(s.x + 0.5, (s.lift || 0) + STUD_H, s.z + 0.5, Math.PI - yaw), local), shade: s.shade, pose: null, hold: {} });
      continue;
    }
    // (a naga: spitting, it leans in, arms out, and its coils lunge; moving, it slithers)
    const spat = spitAt.get(`${Math.round(s.x)},${Math.round(s.z)}`);
    if (spat && spat > (e.spatT0 || 0)) { e.spatT0 = spat; e.spitAt = now / 1000; }
    const spitting = e.spitAt != null && now / 1000 - e.spitAt < LUNGE_TIME;
    const pose = e.anim ? e.anim.update(dt, { moving, holdsR: !!e.hold, lean: spitting ? 0.35 : 0, reach: spitting ? 0.7 : 0 }) : null;
    if (e.slither) {
      const m = mul4(figureMatrix(s.x + 0.5, (s.lift || 0) + e.lift, s.z + 0.5, yaw), slitherLocal(now / 1000, { moving, lungeT: e.spitAt ?? -1e9 }));
      out.push({ prims: e.prims, url: e.url, matrix: m, shade: s.shade, pose, hold: { R: e.hold } });
      continue;
    }
    out.push({ prims: e.prims, url: e.url, matrix: figureMatrix(s.x + 0.5, s.lift || 0, s.z + 0.5, yaw), shade: s.shade, pose, hold: { R: e.hold } });
  }
  return out;
}

// ---- the hero's walk cycle and facing (used to turn the minifig)
const doll = { swing: 0, phase: 0, yaw: 0, skinURL: null };

async function loadImageURL(url) {
  try { return await loadImage(url); } catch { return null; }
}

function updateDoll(dt, now) {
  // swing arms and legs while walking, settle when standing still
  const walking = motion.heroRemaining(now) > 0 || !phys.onGround;
  if (walking) doll.phase += dt * 11;
  const target = walking ? Math.sin(doll.phase) : 0;
  doll.swing += (target - doll.swing) * Math.min(1, dt * 12);
  // the body turns the way it walks (standing, it stays as it was; in first person, where you look)
  let d = (freeWalk.moving ? freeWalk.heading : opts.camera === 0 ? cam.yaw : doll.yaw) - doll.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  doll.yaw += d * Math.min(1, dt * 10);
}

// the atlas tile of the wielded weapon (pick-axes count), or null
function wieldedTile() {
  const w = game.inv.find((i) => i.w === 'weapon');
  return w ? gameTile(w.t) : null; // (an artifact: its base item's sprite)
}

// first-person: the wielded weapon held at the bottom-right, Minecraft style
let heldTile = null;
function updateHeld(now) {
  const el = $('#held');
  const t = game.playing && opts.camera === 0 && !anyScreen() && !hero3d.fpArm ? wieldedTile() : null;
  el.classList.toggle('hidden', t == null);
  if (t == null) return;
  if (t !== heldTile) {
    heldTile = t;
    const icon = $('#held .item');
    const sz = 220, rows = ATLAS_ROWS();
    icon.style.backgroundImage = `url(${atlasURL})`;
    icon.style.backgroundSize = `${meta.cols * sz}px ${rows * sz}px`;
    icon.style.backgroundPosition = `-${(t % meta.cols) * sz}px -${Math.floor(t / meta.cols) * sz}px`;
  }
  const walking = motion.heroRemaining(now) > 0;
  el.style.setProperty('--bob', walking ? `${Math.abs(Math.sin(doll.phase)) * -10}px` : '0px');
}
const ATLAS_ROWS = () => meta.rows || Math.ceil(meta.count / meta.cols);

// world point -> screen pixels (for floating labels), or null if behind you
function project(p) {
  const v = renderer && renderer.view, pr = renderer && renderer.proj;
  if (!v) return null;
  const x = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12];
  const y = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13];
  const z = v[2] * p[0] + v[6] * p[1] + v[10] * p[2] + v[14];
  if (-z < 0.1) return null;
  const nx = (pr[0] * x + pr[8] * z) / -z, ny = (pr[5] * y + pr[9] * z) / -z;
  const c = $('#view');
  return [((nx + 1) / 2) * c.clientWidth, ((1 - ny) / 2) * c.clientHeight];
}

const showDoll = () => false; // (BrickHack: the hero is a brick minifig, never the Minecraft doll)

function dollQuads(out, now) {
  const [hx, hz] = motion.heroPos(now);
  buildPlayerModel(out, (...a) => renderer.quadUV(...a), {
    x: hx + 0.5, y: world.heroLift ?? phys.y, z: hz + 0.5, yaw: doll.yaw,
    pitch: Math.max(-0.8, Math.min(0.8, cam.pitch)), swing: doll.swing, overlay: true,
    attack: fx.jab(now), weaponTile: wieldedTile(),
  }, (...a) => renderer.quad(...a));
}

// ------------------------------------------------------------------ pointer lock
let expectUnlock = false;
const locked = () => document.pointerLockElement === $('#view');
function relock() {
  if (!game.playing || anyScreen() || modalOpen()) return;
  try {
    const p = $('#view').requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  } catch {}
}
function releaseLock() {
  if (locked()) { expectUnlock = true; document.exitPointerLock(); }
}
document.addEventListener('pointerlockchange', () => {
  if (locked()) return;
  if (expectUnlock) { expectUnlock = false; return; }
  if (!game.playing || anyScreen() || modalOpen()) return;
  // the user pressed Esc (the browser swallows it while locked)
  if (game.mode) { game.sendKeys('\x1b'); game.endPrompt(); return; }
  show('pause');
});
const modalOpen = () => ['#menu', '#text', '#lineinput', '#inv', '#chest'].some((s) => !$(s).classList.contains('hidden'));

function closeInventory() {
  ui.closeInventory();
  if (game.mode === 'select') { game.mode = null; }
}

// ------------------------------------------------------------------ camera
const cam = { x: 0, z: 0, yaw: 0, pitch: -0.15, snap: true, eye: [0, 1, 0], vyaw: 0, vpitch: 0 };

function forward() { return [Math.sin(cam.yaw), -Math.cos(cam.yaw)]; }
function yawDir() {
  const [fx, fz] = forward();
  const o = ((Math.round(Math.atan2(fz, fx) / (Math.PI / 4)) % 8) + 8) % 8;
  return OCT[o];
}
function relDir(fwd, right) {
  const [fx, fz] = forward();
  const vx = fx * fwd + -fz * right, vz = fz * fwd + fx * right;
  if (!vx && !vz) return null;
  const o = ((Math.round(Math.atan2(vz, vx) / (Math.PI / 4)) % 8) + 8) % 8;
  return OCT[o];
}
const dirKey = (d) => DIRS[`${d[0]},${d[1]}`];

function updateCamera(now) {
  updateCameraBase(now);
  const s = fx.shakeOffset(now);
  if (s) {
    cam.eye = [cam.eye[0] + s[0], cam.eye[1] + s[1], cam.eye[2] + s[2]];
    cam.vyaw += s[3];
    cam.vpitch += s[4];
  }
}

function updateCameraBase(now) {
  // follow the hero's animated position (see motion.js)
  [cam.x, cam.z] = motion.heroPos(now);
  const pp = statuePerch(now); // (up on a statue's ledge: the view goes with you)
  const tx = cam.x + 0.5 + (pp ? pp.dx : 0), tz = cam.z + 0.5 + (pp ? pp.dz : 0), up = pp ? pp.lift : 0;
  const heroH = motion.heroHeight();
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const f = [Math.sin(cam.yaw) * cp, sp, -Math.cos(cam.yaw) * cp];
  if (opts.camera === 0) {
    cam.eye = [tx, (world.heroLift ?? phys.y) + up + heroH * 0.9, tz]; // Steve's eyes are at 1.62
    cam.vyaw = cam.yaw;
    cam.vpitch = cam.pitch;
    return;
  }
  if (opts.camera === 3) {
    // overhead map view: high above the hero, looking down along the view yaw
    const p = Math.min(cam.pitch, -0.7);
    const g = [Math.sin(cam.yaw) * Math.cos(p), Math.sin(p), -Math.cos(cam.yaw) * Math.cos(p)];
    cam.eye = [tx - g[0] * 16, phys.y + 0.5 - g[1] * 16, tz - g[2] * 16];
    cam.vyaw = cam.yaw;
    cam.vpitch = p;
    return;
  }
  const sign = opts.camera === 1 ? -1 : 1;
  // (a minifig is taller than Steve: the camera stands further back, and looks over the helmet)
  const fig = !!motion.figHeight && heroH === motion.figHeight;
  const target = [tx, (world.heroLift ?? phys.y) + up + heroH * (fig ? 1.0 : 0.85), tz];
  let dist = 4.2 * Math.max(1, heroH / 1.8);
  let overHaze = false;
  for (let t = 0.3; t < dist; t += 0.05) {
    const p = [target[0] + f[0] * t * sign, target[1] + f[1] * t * sign, target[2] + f[2] * t * sign];
    const vx = Math.floor(p[0]), vy = Math.floor(p[1]), vz = Math.floor(p[2]);
    if (world.solidVoxel(vx, vy, vz, onRoof())) { dist = Math.max(0.3, t - 0.15); break; }
    if (p[1] < HAZE_CLEAR && world.isHaze(vx, vz)) overHaze = true;
  }
  cam.eye = [target[0] + f[0] * dist * sign, target[1] + f[1] * dist * sign, target[2] + f[2] * dist * sign];
  cam.vyaw = opts.camera === 1 ? cam.yaw : cam.yaw + Math.PI;
  cam.vpitch = opts.camera === 1 ? cam.pitch : -cam.pitch;
  // the camera never goes into the haze over the unexplored: where it would,
  // it rises over it and looks down at you (the haze stays white and solid)
  if (overHaze && cam.eye[1] < HAZE_CLEAR) {
    cam.eye[1] = HAZE_CLEAR;
    const d = [target[0] - cam.eye[0], target[1] - cam.eye[1], target[2] - cam.eye[2]];
    cam.vyaw = Math.atan2(d[0], -d[2]);
    cam.vpitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
  }
}
const HAZE_CLEAR = 3.2; // (over the haze's billowing top, brickworld.js HAZE_TOP)

function crosshairTarget() {
  if (!renderer) return null;
  if (opts.camera === 3) return frontBlock(); // the map view looks down at you: aim at what you face
  return lookTarget();
}
// the map view's target: the first block ahead of you the way you face, up
// to 4 squares off (at your feet, else head height, else just below), for
// mining; none: attack ahead
const FRONT_REACH = 4;
function frontBlock() {
  const [dx, dz] = yawDir(), y = Math.round(phys.y);
  for (let i = 1; i <= FRONT_REACH; i++) {
    const x = world.hero.x + dx * i, z = world.hero.y + dz * i;
    for (const h of [y, y + 1, y - 1]) {
      const type = h >= 0 && blocks.get(x, h, z);
      if (type && breakTime(type, true) < Infinity) // (looking past what can't be mined: fire, fences, ladders...)
        return { x, y: z, h, kind: 'block', type, prev: null, box: [x, h, z, x + 1, h + 1, z + 1] };
    }
    const wall = (h) => world.solidVoxel(x, h, z, onRoof()) && !blocks.get(x, h, z);
    if (wall(y) || wall(y + 1)) return null; // (a wall in the way)
  }
  return null;
}
// what's under the crosshair, in the other views
function lookTarget() {
  const c = $('#view');
  const r = renderer.screenRay(cam.eye, cam.vyaw, cam.vpitch, c.clientWidth / 2, c.clientHeight / 2);
  return world.target(r.o, r.d, REACH, motion, performance.now(), onRoof());
}
const REACH = 6; // blocks, like Minecraft survival reach

// ---- building: place / break blocks, dig walls with the pick-axe
let mining = null; // {x, z, h, t0, dur} while the left button is held on a block
let lmbHeld = false;
const isPickAxe = (it) => it && !it.block && /pick-axe|mattock/i.test(it.n);

function startMining(tgt, now) {
  mining = { x: tgt.x, z: tgt.y, h: tgt.h, t0: now, dur: breakTime(tgt.type, isPickAxe(ui.selectedItem())) };
}

function updateMining(now, tgt) {
  if (!mining) {
    if (lmbHeld && tgt && tgt.kind === 'block' && !game.mode) startMining(tgt, now); // keep breaking, Minecraft-style
    return null;
  }
  if (!lmbHeld || !tgt || tgt.kind !== 'block' || tgt.x !== mining.x || tgt.y !== mining.z || tgt.h !== mining.h) {
    mining = null;
    return null;
  }
  const k = (now - mining.t0) / mining.dur;
  if (fx.jab(now) < 0) fx.attack(mining.x, mining.z, now); // keep swinging while mining
  fx.lastAttack = null;
  if (k >= 1) {
    const type = blocks.remove(mining.x, mining.h, mining.z);
    if (type) drops.spawn(minedAs(type), mining.x, mining.h, mining.z, now); // pops out onto the ground
    mining = null;
    world.dirty = true;
    game.ensureBlocksInHotbar();
    ui.renderHotbar();
    return null;
  }
  return { boxes: [[mining.x, mining.h, mining.z, mining.x + 1, mining.h + 1, mining.z + 1]], stage: Math.floor(k * 10) };
}

function placeBlock(tgt, type) {
  if (!tgt || tgt.kind === 'mob' || !tgt.prev) return;
  const [px, py, pz] = tgt.prev;
  if (py < 0 || py >= 16 || px < 1 || pz < 0 || px >= world.w || pz >= world.h) return;
  if (Math.hypot(px + 0.5 - cam.eye[0], py + 0.5 - cam.eye[1], pz + 0.5 - cam.eye[2]) > REACH + 0.5) return;
  if (world.solidVoxel(px, py, pz, onRoof())) return;
  // not inside the hero or a monster (but a block right under your feet
  // lifts you onto it: build a tower without jumping)
  const [hx, hz] = motion.heroPos(performance.now());
  const heroCols = new Set([`${world.hero.x},${world.hero.y}`, `${Math.round(hx)},${Math.round(hz)}`]);
  if (heroCols.has(`${px},${pz}`) && py + 1 > phys.y && py < phys.y + 1.8) {
    if (px === world.hero.x && pz === world.hero.y && py === Math.round(phys.y)) pillarUp(type);
    return;
  }
  if (motion.mobAt(px, pz) && py < 2) return;
  // not on stairs, altars, fountains... (keeps the game playable)
  const cl = world.classAt(px, pz);
  if (py < WALL_H && !cl) return;
  if (py < 2 && cl && (cl.sprite || [CM.upstair, CM.dnstair, CM.upladder, CM.dnladder].includes(cl.cmap))) return;
  if (blocks.place(px, py, pz, type)) {
    world.dirty = true;
    ui.renderHotbar();
    if (ui.inventoryOpen) ui.renderInventory();
  }
}

// a block under your feet, and you up on top of it (looking down and placing,
// or right-clicking with a block in the map view); 1 = done
function pillarUp(type) {
  const x = world.hero.x, z = world.hero.y, y = Math.round(phys.y);
  if (!phys.onGround || phys.climb || y < 0 || y >= BUILD_LIMIT) return false;
  if (world.solidVoxel(x, y, z, onRoof()) || world.solidVoxel(x, y + 1, z, onRoof()) || world.solidVoxel(x, y + 2, z, onRoof())) return false; // (room overhead)
  const cl = world.classAt(x, z);
  if (!cl || (y < 2 && (cl.sprite || [CM.upstair, CM.dnstair, CM.upladder, CM.dnladder].includes(cl.cmap)))) return false;
  if (!blocks.place(x, y, z, type)) return false;
  Object.assign(phys, { y: y + 1, vy: 0, onGround: true, peak: y + 1 });
  world.dirty = true;
  ui.renderHotbar();
  if (ui.inventoryOpen) ui.renderInventory();
  return true;
}

// ---- Minecraft-style chests: the chest screen drives NetHack's own #loot
const chest = { active: false, op: null, title: 'Chest', contents: [], sawMenu: false, x: -1, y: -1 };

function openChest(tgt) {
  const h = world.hero;
  if (h.x === tgt.x && h.y === tgt.y) return beginLoot({ kind: 'view' });
  // NetHack loots what you stand on: step onto an adjacent chest first
  if (Math.max(Math.abs(tgt.x - h.x), Math.abs(tgt.y - h.y)) === 1 && phys.y < 0.01) {
    game.afterReady = () => { if (world.hero.x === tgt.x && world.hero.y === tgt.y) beginLoot({ kind: 'view' }); };
    game.sendKeys(dirKey([Math.sign(tgt.x - h.x), Math.sign(tgt.y - h.y)]));
  } else game.sendLine(`C ${tgt.x} ${tgt.y} 1`); // travel there
}

function beginLoot(op) {
  Object.assign(chest, { active: true, op, sawMenu: false, x: world.hero.x, y: world.hero.y });
  if (renderer.brick) renderer.brick.setLid(chest.x, chest.y, true); // (a chest model there: its lid swings open)
  if (ui.chestOpen) ui.setChestBusy(true);
  releaseLock();
  game.pendingExt = 'loot';
  game.sendKeys('#');
}

function closeChestScreen() {
  chest.active = false;
  if (renderer.brick) renderer.brick.setLid(chest.x, chest.y, false); // (...and shut)
  ui.closeChest();
  relock();
}

// answer the loot prompts NetHack asks; false = not ours, show it normally
function chestYN(m) {
  if (/loot it\?/i.test(m.q)) { post('K' + hex('y')); return true; }
  if (/put something in\?/i.test(m.q)) { post('K' + hex(chest.op.kind === 'put' ? 'y' : 'n')); return true; }
  return false;
}

function chestMenu(m) {
  const pick = (it) => post(it ? `M ${it.i}:-1` : 'X');
  if (/^Do what with/i.test(m.prompt)) {
    chest.sawMenu = true;
    chest.title = m.prompt.replace(/^Do what with (the |your |an? )?/i, '').replace(/\?.*$/, '').replace(/^./, (c) => c.toUpperCase());
    const want = chest.op.kind === 'put' ? 'i' : 'o';
    const it = m.items.find((i) => i.sel && i.k === want);
    if (!it && want === 'o') chest.contents = []; // empty
    pick(it);
    return true;
  }
  if (/^Take out what/i.test(m.prompt)) {
    if (chest.op.kind === 'view') {
      chest.contents = m.items.filter((i) => i.sel).map((i) => ({ s: i.s, t: i.t }));
      pick(null);
    } else pick(m.items.find((i) => i.sel && i.s === chest.op.text));
    return true;
  }
  if (/^Put in what/i.test(m.prompt)) {
    pick(chest.op.kind === 'put' ? m.items.find((i) => i.sel && i.k === chest.op.letter) : null);
    return true;
  }
  return false;
}

// the loot command finished: refresh the contents after a transfer, then show the screen
function chestDone() {
  chest.active = false;
  if (!chest.sawMenu || world.hero.x !== chest.x || world.hero.y !== chest.y) { // locked, gone, moved...
    if (ui.chestOpen) closeChestScreen();
    return;
  }
  if (chest.op.kind !== 'view') { beginLoot({ kind: 'view' }); return; }
  ui.showChest(chest.title, chest.contents, {
    onTake: (it) => beginLoot({ kind: 'take', text: it.s }),
    onPut: (it) => beginLoot({ kind: 'put', letter: it.l }),
    onClose: closeChestScreen,
  });
}

// start NetHack's own digging toward an adjacent wall (apply pick-axe, direction)
// A dungeon wall or solid rock dug through with a pick-axe drops a block
// too (a wall: bricks, rock: cobblestone), like the blocks you mine.
let digging = null; // {x, y, kind} of the wall or rock being dug
function collectDug() {
  const d = ui.stat && ui.stat.dig;
  if (d && (!digging || digging.x !== d[0] || digging.y !== d[1])) {
    const cl = world.classAt(d[0], d[1]);
    digging = cl && (cl.type === 'wall' || cl.type === 'rock') ? { x: d[0], y: d[1], kind: cl.type } : null;
  }
  if (!digging) return;
  const cl = world.classAt(digging.x, digging.y);
  if (!cl || cl.type === 'wall' || cl.type === 'rock' || cl.type === 'none') return; // not through yet
  const type = digging.kind === 'wall' ? 'brick' : 'cobble';
  drops.spawn(type, digging.x, 1, digging.y, performance.now());
  digging = null;
}

function digWall(it, dir) {
  fx.attack(world.hero.x + dir[0], world.hero.y + dir[1], performance.now());
  game.pending.push({ key: it.l }, { key: dirKey(dir), re: /direction/i });
  game.sendKeys('a');
}

// ------------------------------------------------------------------ input
const held = new Set();
let lastMove = 0;

document.addEventListener('mousemove', (e) => {
  if (!locked()) return;
  const s = 0.0025 * (opts.sens / 100);
  cam.yaw += e.movementX * s;
  cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - e.movementY * s));
});

$('#view').addEventListener('mousedown', (e) => {
  if (!game.playing || anyScreen()) return;
  if (!locked()) { relock(); return; }
  e.preventDefault();
  const tgt = crosshairTarget();
  const h = world.hero;
  const adj = tgt && Math.max(Math.abs(tgt.x - h.x), Math.abs(tgt.y - h.y)) === 1;
  const towards = tgt && !(tgt.x === h.x && tgt.y === h.y) ? [Math.sign(tgt.x - h.x), Math.sign(tgt.y - h.y)] : null;
  if (game.mode === 'getpos') {
    if (tgt) { game.sendLine(`C ${tgt.x} ${tgt.y} ${e.button === 2 ? 2 : 1}`); game.endPrompt(); }
    return;
  }
  if (game.mode === 'dir') {
    if (tgt && tgt.x === h.x && tgt.y === h.y) game.sendKeys('.');
    else game.sendKeys(dirKey(towards && Math.max(Math.abs(tgt.x - h.x), Math.abs(tgt.y - h.y)) <= 1 ? towards : towards || yawDir()));
    return;
  }
  if (game.mode) return;
  if (e.button === 0) {
    lmbHeld = true;
    const it = ui.selectedItem();
    if (tgt && tgt.kind === 'block') { startMining(tgt, performance.now()); return; }
    if (tgt && adj && isPickAxe(it) && ['wall', 'rock', 'door'].includes(tgt.kind) && phys.y < 1) { digWall(it, towards); return; }
    // attack: aim at the adjacent monster under the crosshair, else straight ahead
    const ad = adj && tgt.kind === 'mob' ? towards : yawDir();
    fx.attack(h.x + ad[0], h.y + ad[1], performance.now());
    game.sendKeys('F' + dirKey(ad));
  } else if (e.button === 2) {
    // gates open and close with a right-click, like Minecraft's
    if (tgt && tgt.kind === 'block' && (tgt.type === 'gate' || tgt.type === 'gateOpen')) {
      if (blocks.swap(tgt.x, tgt.h, tgt.y, tgt.type === 'gate' ? 'gateOpen' : 'gate')) world.dirty = true;
      return;
    }
    const it = ui.selectedItem();
    if (it && it.block && opts.camera === 3) { pillarUp(it.block); return; } // the map view: stack a tower under your feet
    if (it && it.block) { placeBlock(tgt, it.block); return; }
    const cl = tgt && world.classAt(tgt.x, tgt.y);
    if (tgt && cl && cl.chest && tgt.kind !== 'mob') { openChest(tgt); return; }
    if (adj && cl && (cl.type === 'door' || cl.type === 'odoor')) game.sendKeys((cl.type === 'door' ? 'o' : 'c') + dirKey(towards));
    else if (it) game.useItem(it);
    else if (tgt && !(tgt.x === h.x && tgt.y === h.y)) game.sendLine(`C ${tgt.x} ${tgt.y} 1`);
  } else if (e.button === 1) {
    if (tgt) { game.pendingClick = tgt; game.mode = 'getpos'; game.sendKeys(';'); game.mode = 'getpos'; }
  }
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) lmbHeld = false; });
window.addEventListener('contextmenu', (e) => { if (game.playing) e.preventDefault(); });
window.addEventListener('wheel', (e) => {
  if (!game.playing || anyScreen() || modalOpen()) return;
  ui.selectHotbar(ui.hotbarSel + Math.sign(e.deltaY));
}, { passive: true });

function rawKey(e) {
  if (e.key === 'Enter') return '\r';
  if (e.key === 'Escape') return '\x1b';
  if (e.key === 'Backspace') return '\b';
  const arrows = { ArrowLeft: 'h', ArrowRight: 'l', ArrowUp: 'k', ArrowDown: 'j' };
  if (arrows[e.key]) return arrows[e.key];
  if (e.key.length !== 1) return null;
  if (e.ctrlKey && /[a-z]/i.test(e.key)) return String.fromCharCode(e.key.toUpperCase().charCodeAt(0) - 64);
  if (e.altKey) return String.fromCharCode(e.key.charCodeAt(0) | 0x80);
  return e.key;
}

window.addEventListener('keydown', (e) => {
  if (!game.playing) return;
  if (['F1', 'F2', 'F3', 'F5', 'Tab'].includes(e.key) || (e.key === ' ' && !modalOpen())) e.preventDefault();
  if (!$('#pause').classList.contains('hidden')) { if (e.key === 'Escape') resume(); return; }
  if (anyScreen()) return;
  const k = e.key;

  // view toggles always work
  if (k === 'F5') { opts.camera = opts.camera >= 2 ? 0 : opts.camera + 1; saveOpts(); return; }
  if (k === 'F2' && !game.mode && !ui.inventoryOpen && !game.raw) { // (m is NetHack's)
    if (opts.camera === 3) opts.camera = game.prevCamera ?? 0;
    else { game.prevCamera = opts.camera; opts.camera = 3; }
    return;
  }
  if (k === 'F1') { opts.hud = !opts.hud; $('#hud').classList.toggle('hidden', !opts.hud); return; }
  if (k === 'F3') { opts.debug = !opts.debug; ui.updateInfo(); return; }
  if (k === '`') { game.raw = !game.raw; $('#raw-badge').classList.toggle('hidden', !game.raw); held.clear(); return; }

  if (ui.chestOpen) {
    if (k === 'Escape' || k === 'e' || k === 'E') { e.preventDefault(); closeChestScreen(); }
    return;
  }
  if (ui.inventoryOpen) {
    if (k === 'Escape' || (game.mode !== 'select' && (k === 'i' || k === 'e' || k === 'E'))) {
      e.preventDefault();
      if (game.mode === 'select') game.answerSelect('\x1b');
      else { closeInventory(); relock(); }
    } else if (game.mode === 'select' && k.length === 1) {
      game.answerSelect(k);
    }
    return;
  }

  if (game.raw) {
    const r = rawKey(e);
    if (r) { e.preventDefault(); game.sendKeys(r); }
    return;
  }

  if (game.mode === 'dir' || game.mode === 'getpos') {
    const mv = { w: [1, 0], s: [-1, 0], a: [0, -1], d: [0, 1] }[k.toLowerCase()];
    if (mv) {
      const d = relDir(...mv);
      let key = dirKey(d);
      if (game.mode === 'getpos' && e.shiftKey) key = key.toUpperCase();
      game.sendKeys(key);
      if (game.mode === 'getpos') game.ready = false;
      return;
    }
    if (k === 'Escape') { game.sendKeys('\x1b'); game.endPrompt(); return; }
    if (k === ' ' || k === 'Enter') { game.sendKeys('.'); if (game.mode === 'getpos') game.endPrompt(); return; }
    const r = rawKey(e);
    if (r) game.sendKeys(r);
    return;
  }
  if (game.mode === 'yn') {
    const r = rawKey(e);
    if (r) { e.preventDefault(); game.sendKeys(r); }
    return;
  }

  // ---- normal play controls
  const lower = k.length === 1 ? k.toLowerCase() : k;
  if ('wasd'.includes(lower) && k.length === 1) { held.add(lower); return; }
  if (/^[1-9]$/.test(k)) { ui.selectHotbar(+k - 1); return; }
  // Shift+1..4: the Recommended actions, down the list (row 1, row 2...)
  if (e.shiftKey && /^Digit[1-4]$/.test(e.code)) {
    const r = game.recs && game.recs[+e.code.slice(5) - 1];
    if (r) { e.preventDefault(); game.runAction(r); }
    return;
  }
  // Ctrl and Alt (M-) commands are NetHack's, as ever (Ctrl+D kick, Alt+I invoke...); not the browser's own Ctrl keys
  if ((e.ctrlKey || e.altKey) && k.length === 1 && /[a-z]/i.test(k)) {
    if (e.ctrlKey && /^[rwnt]$/i.test(k)) return;
    e.preventDefault(); game.sendKeys(rawKey(e)); return;
  }
  const it = ui.selectedItem();
  switch (k) { // every other key is NetHack's own (below)
    case 'i': releaseLock(); ui.openInventory(); return; // (NetHack's inventory: ours, with its Actions tab)
    case 'Delete': if (it) game.itemCmd('drop', it, e.shiftKey || it.q === 1 ? 0 : 1); return; // drop the held item (Shift: the stack)
    case ' ': { // the stairs (or ladder) you're on; anywhere else, search
      const cl = world.classAt(world.hero.x, world.hero.y), c = cl && cl.cmap;
      game.sendKeys(c === CM.upstair || c === CM.upladder ? '<' : c === CM.dnstair || c === CM.dnladder ? '>' : 's');
      return;
    }
    case 'ArrowUp': { // the first Recommended action (shown above the hotbar)
      e.preventDefault();
      const r = game.recs && game.recs[0];
      if (r) game.runAction(r);
      return;
    }
    case 'tab': case 'Tab': ui.toggleHistory(); if (ui.history) releaseLock(); else relock(); return;
    case 'Escape': if (ui.history) { ui.toggleHistory(false); return; } show('pause'); return;
    case 'Enter':
      e.preventDefault();
      releaseLock();
      ui.askLine('Command (extended command, "give <item>", "dev cheese", "tp <level>", or "keys <raw game keys>")', { list: game.ext, initial: k === '/' ? '' : '' }, (v) => {
        relock();
        if (!v) return;
        v = v.trim().replace(/^[#/]/, '');
        if (/^keys\s/.test(v)) { game.sendKeys(v.slice(5).replace(/\\n/g, '\r').replace(/\\e/g, '\x1b')); return; }
        // dev: give yourself anything (named the way you'd wish for it)
        if (/^give\s+\S/i.test(v)) { post('W' + hex(v.replace(/^give\s+/i, ''))); return; }
        // dev: Grayswandir and the Blazing Cheese armour
        if (/^dev\s*cheese$/i.test(v)) { post('V'); return; }
        // dev: straight to another level of the dungeon you're in (a turn's wait to get there)
        const tp = v.match(/^tp\s+(\d+)$/i);
        if (tp) { post('T' + tp[1]); game.sendKeys('s'); return; }
        if (v === 'help') { returnTo = null; show('controls'); return; }
        game.pendingExt = v;
        game.sendKeys('#');
      });
      return;
    default: { // anything else is NetHack's own key, as ever (all but w a s d: walking): e eat, q quaff,
      // r read, z zap, t throw, # an extended command, P put on, : look here, h j k l y u b n...
      const r = k.length === 1 && rawKey(e);
      if (r) { e.preventDefault(); game.sendKeys(r); }
    }
  }
});
window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());
document.addEventListener('mouseup', () => {});

$('#controls [data-act=done]')?.addEventListener('click', () => { if (returnTo === null) { show(null); relock(); } });

// ---- walking: free, as in a world of bricks. You walk anywhere, any way, at your own pace
// (W A S D, as the camera faces), never waiting on the engine: what stops you is what's solid
// (walls, rock, a closed door, a boulder, a monster, blocks you can't climb), and you slide
// along it. The squares are still there: each time your middle crosses into another, that move
// is sent to the engine (queued, in order), and only that takes a turn. Pushing into a monster
// attacks it, into a boulder pushes it, into a closed door tries it. Should the engine not put
// you where you went (a step refused, a teleport), you walk to where it says you are (or are
// there at once, if it's far). motion.free: where you are.
const FREE_SPEED = 3.2; // squares a second
const BODY_R = 0.2; // (half the hero's body, across: how near a wall its middle comes)
const BUMP_MS = 450; // (pushing on into a monster, a door, a boulder: tried again this often)
let bumpT = 0;
const walk = { moving: false, heading: 0, at: null, sent: [], settle: false };
const freeWalk = walk;

// what's at square (x, z), walking into it: 'floor', 'climb' (blocks: stepped up onto), or
// what stops you: 'solid', 'mob', 'door' (closed), 'boulder'
function squareIs(x, z) {
  if (x < 1 || z < 0 || x >= world.w || z >= world.h) return 'solid';
  if (motion.mobAt(x, z) && !(x === walk.at.x && z === walk.at.z)) return 'mob';
  const cl = world.classAt(x, z);
  if (cl && cl.type === 'door') return 'door';
  if ((world.brickDrops || []).some((o) => o.x === x && o.z === z && o.name === 'boulder')) return 'boulder';
  const plain = phys.y < 0.01 && phys.y > -0.5 && !blocks.hasColumn(x, z) && !(cl && (cl.type === 'wall' || cl.type === 'rock'));
  if (plain) return 'floor';
  return world.landingAt(x, z, phys.y, onRoof()) == null ? 'solid' : 'climb';
}

// pushing into what stops you, toward square (x, z) from yours: a monster attacked, a boulder
// pushed, a door tried (once in a while, as you keep pushing)
function bump(kind, x, z, now) {
  if (now - bumpT < BUMP_MS || walk.sent.length || !game.ready) return;
  const d = [Math.sign(x - walk.at.x), Math.sign(z - walk.at.z)];
  if (!d[0] && !d[1]) return;
  bumpT = now;
  if (kind === 'mob') fx.attack(x, z, now);
  game.sendKeys(dirKey(d));
}

// you crossed from your square into the one beside it (d): the engine is told
function crossed(d) {
  const tx = walk.at.x + d[0], tz = walk.at.z + d[1];
  if (squareIs(tx, tz) === 'climb') { // climbing onto blocks: the client decides, the engine is told
    const land = world.landingAt(tx, tz, phys.y, onRoof());
    post(`A ${tx} ${tz}`);
    const onLadder = world.ladderTop(walk.at.x, walk.at.z) > 0;
    if (world.ladderTop(tx, tz) && land > phys.y + 0.05) phys.climb = land;
    else if (onLadder && land < phys.y - 1.05) phys.climb = land;
    else if (land > phys.y + 0.05) phys.climb = land;
  }
  walk.at = { x: tx, z: tz };
  walk.sent.push(dirKey(d));
}

function processMovement(now, dt) {
  if (!game.playing) { motion.free = null; walk.at = null; walk.sent = []; return; }
  const sq = { x: world.hero.x, z: world.hero.y };
  if (!motion.free || !walk.at) { motion.free = { ...sq }; walk.at = { ...sq }; walk.sent = []; }
  const F = motion.free;
  walk.moving = false;
  // the engine, kept up with: the next step sent as soon as it's ready for one; and where it
  // says you are checked against where you went
  if (game.ready) {
    if (walk.sent.length && !game.mode && !modalOpen()) {
      lastMove = now;
      game.sendKeys(walk.sent.shift());
    } else if (!walk.sent.length && now - lastMove > 300 && (sq.x !== walk.at.x || sq.z !== walk.at.z)) {
      // (all answered, and a moment gone by: it hasn't put you where you went (a step refused), or
      // it's moved you itself (travel, a trap, a teleport): where it says)
      walk.at = { ...sq }; walk.settle = true;
    }
  }
  if (Math.max(Math.abs(F.x - walk.at.x), Math.abs(F.z - walk.at.z)) > 2.5) { F.x = walk.at.x; F.z = walk.at.z; walk.settle = false; return; }
  // settling: walked back into your square (the engine put you there), or onto a statue's ledge
  const statue = (world.brickDrops || []).some((o) => o.x === walk.at.x && o.z === walk.at.z && o.name === 'statue');
  const able = game.playing && !game.mode && !modalOpen() && !anyScreen() && !game.raw && phys.climb == null && !walk.settle;
  const f = able ? (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0) : 0;
  const r = able ? (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0) : 0;
  if (walk.settle || (statue && !f && !r)) {
    const inner = 0.5 - BODY_R;
    const tx = statue ? walk.at.x : Math.max(walk.at.x - inner, Math.min(walk.at.x + inner, F.x));
    const tz = statue ? walk.at.z : Math.max(walk.at.z - inner, Math.min(walk.at.z + inner, F.z));
    const dx = tx - F.x, dz = tz - F.z, d = Math.hypot(dx, dz);
    if (d > 1e-3) {
      const st = Math.min(d, FREE_SPEED * dt);
      F.x += (dx / d) * st; F.z += (dz / d) * st;
      walk.moving = true; walk.heading = Math.atan2(dx, -dz);
    } else walk.settle = false;
    motion.freeMoving = walk.moving;
    return;
  }
  const [fx0, fz0] = forward();
  let vx = fx0 * f - fz0 * r, vz = fz0 * f + fx0 * r;
  const n = Math.hypot(vx, vz);
  if (!n) { motion.freeMoving = false; return; }
  vx /= n; vz /= n;
  // moved one way and then the other, each stopped by whatever's solid in its way (the body a
  // square 2 BODY_R across): sliding along walls; pushing into a monster, door or boulder bumps it
  const solidAt = (x, z) => { const k = squareIs(x, z); return k === 'floor' || k === 'climb' ? null : k; };
  const step = (axis, v) => {
    const cur = axis === 'x' ? F.x : F.z, other = axis === 'x' ? F.z : F.x;
    let nxt = cur + v * FREE_SPEED * dt;
    const edge = nxt + Math.sign(v) * BODY_R, cell = Math.round(edge);
    if (v && cell !== Math.round(cur + Math.sign(v) * BODY_R * 0.999)) { // (the body's front reaches another row of squares)
      for (const o of [Math.round(other - BODY_R + 1e-3), Math.round(other + BODY_R - 1e-3)]) {
        const [x, z] = axis === 'x' ? [cell, o] : [o, cell];
        const k = solidAt(x, z);
        if (k) {
          if (k !== 'solid') bump(k, x, z, now);
          nxt = v > 0 ? Math.min(nxt, cell - 0.5 - BODY_R) : Math.max(nxt, cell + 0.5 + BODY_R); // (up against it)
          break;
        }
      }
    }
    if (axis === 'x') F.x = nxt; else F.z = nxt;
  };
  const ox = F.x, oz = F.z;
  step('x', vx);
  step('z', vz);
  if (F.x !== ox || F.z !== oz) { walk.moving = true; walk.heading = Math.atan2(vx, -vz); }
  motion.freeMoving = walk.moving;
  // your middle crossed into another square: that's the move (diagonal, if both ways at once)
  const cx = Math.round(F.x), cz = Math.round(F.z);
  if (cx !== walk.at.x || cz !== walk.at.z) crossed([Math.sign(cx - walk.at.x), Math.sign(cz - walk.at.z)]);
}
window.addEventListener('keydown', (e) => (window.__shift = e.shiftKey), true);
window.addEventListener('keyup', (e) => (window.__shift = e.shiftKey), true);

// name tags over every creature, and over the hero when the camera is behind
function updateNameTags(now) {
  if (!game.playing || opts.camera === 3) { nameTags.update([], cam.eye, project); return; }
  let hero = null;
  if (opts.camera !== 0 && game.charName) {
    const [hx, hz] = motion.heroPos(now);
    hero = { x: hx + 0.5, y: (world.heroLift ?? phys.y) + motion.heroHeight() + 0.35, z: hz + 0.5, text: game.charName };
  }
  nameTags.update(nameTagEntries(motion, world, now, hero), cam.eye, project);
}

// ------------------------------------------------------------------ main loop
let lastT = performance.now();
let lastWall = opts.wallStyle;
let lastCracks = '';
function frame(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  if (renderer) {
    renderer.fov = opts.fov;
    if (world.dirty || lastWall !== opts.wallStyle) {
      world.rebuild();
      collectDug();
      renderer.buildTerrain(world, opts);
      world.dirty = false;
      lastWall = opts.wallStyle;
    }
    processMovement(t, dt);
    if (game.playing) { updatePhysics(dt, t); updateDoll(dt, t); }
    updateCamera(t);
    const fig3d = showFigure();
    const doll3d = showDoll() && !fig3d;
    motion.figHeight = hero3d.prims ? FIG_HEIGHT : null;
    world.spriteScale = FIG_HEIGHT / 2.0; // a human-sized monster stands as tall as you
    world.camYaw = cam.vyaw; // creatures face the way they walk, as seen from here
    const sprites = world.sprites(opts.camera !== 0 && !doll3d && !fig3d, motion, t, fx);
    // punished: the ball and chain drawn on your ankle, in physics (brickworld.setPunished), not lying as items
    const pun = renderer.brickOn && renderer.brick && brickChainLink() ? punishment() : null;
    const ballItem = brickItemByName('heavy iron ball');
    if (renderer.brick) renderer.brick.setPunished(pun && ballItem ? { ball: pun.ball ? [pun.ball.x, pun.ball.z] : null, ballUrl: ballItem.url, linkUrl: brickChainLink() } : null);
    renderer.brickItems = pun ? (world.brickDrops || []).filter((d) => d !== pun.chain && d !== pun.ball) : world.brickDrops || [];
    if (renderer.slots) sprites.push(...fx.puffSprites(t, renderer.slots.puff));
    if (game.playing) {
      const [hx, hz] = motion.heroPos(t);
      drops.update(dt, t, world, [hx + 0.5, world.heroLift ?? phys.y, hz + 0.5], pickUpBlock);
    }
    const hold = (hero3d.hold = hero3d.prims && game.playing ? heroHold() : {});
    const pose = hero3d.prims ? heroPose(dt, t) : null;
    const rig = hero3d.prims && hero3d.prims.rig;
    if (fig3d) {
      const [hx, hz] = motion.heroPos(t);
      const pp = statuePerch(t); // (on a statue's square: up on its ledge, looking at it)
      const m = pp ? figureMatrix(hx + 0.5 + pp.dx, (world.heroLift ?? phys.y) + pp.lift, hz + 0.5 + pp.dz, pp.k > 0.5 ? pp.yaw : doll.yaw)
        : figureMatrix(hx + 0.5, world.heroLift ?? phys.y, hz + 0.5, doll.yaw);
      renderer.brickFigures = [{ prims: hero3d.prims, url: hero3d.url, matrix: m, shade: 1, pose, hold, skip: skipped(hold) },
        // (for the block levels' renderer, brick.js; the brick dungeon's hangs them on the hands itself)
        ...(rig && pose ? heldEntries(hold, rig, m, { R: pose.handR || pose.armR, L: pose.handL || pose.armL, body: pose.body }) : [])];
    } else renderer.brickFigures = [];
    renderer.brickFigures.push(...brickMonFigures(sprites, dt, t)); // (King Skelly...)
    // first person: your own brick arm, and what it holds, in the corner of the
    // view; fighting with two weapons, your left one too, in the other corner
    const fpOn = !!pose && !!rig && game.playing && opts.camera === 0 && opts.playerModel === 'model' && !anyScreen() && !(ui.stat && ui.stat.poly);
    const vc = $('#view'), aspect = vc.clientWidth / Math.max(1, vc.clientHeight);
    if (fpOn) {
      const arms = [];
      for (const side of hold.two ? ['R', 'L'] : ['R']) {
        const fm = firstPersonMatrix(rig, aspect, side, hold[side] ? FP_HOLD_TILT : FP_TILT), ap = pose['fpArm' + side];
        if (!fm || !ap) continue;
        // (the wrist turned so what's held points up into the view; the grip stays in the fist)
        const W = hold[side] ? firstPersonWrist(rig, fm, side) : null, hp = W ? mul4(ap, W) : ap;
        arms.push({ prims: hero3d.prims, matrix: fm, pose: { ['arm' + side]: ap, ['hand' + side]: hp, ['item' + side]: hp },
          only: ['arm' + side, 'hand' + side, 'item' + side], skip: skipped(hold), shade: 1 },
          ...heldEntries({ [side]: hold[side], ["ring" + side]: hold["ring" + side] }, rig, fm, { [side]: hp }));
      }
      renderer.fpArm = arms;
    } else renderer.fpArm = null;
    hero3d.fpArm = fpOn;
    { const [fx, fz] = motion.heroPos(t); renderer.focus = [fx + 0.5, 0, fz + 0.5]; } // (the BrickWorld's shadows follow you)
    renderer.buildSprites(sprites, cam.vyaw, (out) => {
      if (doll3d) dollQuads(out, t);
      drops.draw(t, (x, y, z, s, a, type) => renderer.miniBlock(out, x, y, z, s, a, type));
    });
    updateHeld(t);
    fx.updateLabels(t, project);
    updateNameTags(t);
    // (no fog on brick levels, as in the viewer; but Ascend's baseplate is drawn only half as far,
    // hazing into the sky over its last stretch)
    const ascend = !!(ui.stat && ui.stat.dname === 'the Baseplate');
    renderer.far = ascend ? ASCEND_FAR : 200;
    renderer.fogRange = ascend ? [ASCEND_FAR * 0.7, ASCEND_FAR] : [1e4, 2e4];
    let outline = null, color = [0, 0, 0, 1], cracks = null;
    if (game.playing) {
      if (game.mode === 'getpos' && game.cursor) {
        const { x, y } = game.cursor;
        outline = [x, 0, y, x + 1, 1, y + 1];
        color = [1, 1, 0.2, 1];
      } else {
        const tgt = locked() ? crosshairTarget() : null;
        if (tgt) outline = tgt.box;
        cracks = updateMining(t, tgt);
      }
      // NetHack digging through a wall: crack the whole wall column as it progresses
      const dig = ui.stat && ui.stat.dig;
      if (!cracks && dig) cracks = { boxes: [[dig[0], 0, dig[1], dig[0] + 1, WALL_H, dig[1] + 1]], stage: Math.floor(dig[2] / 10) };
    }
    const crackKey = cracks ? cracks.boxes.join() + ':' + cracks.stage : '';
    if (crackKey !== lastCracks) { renderer.setCracks(cracks && cracks.boxes, cracks ? cracks.stage : 0); lastCracks = crackKey; }
    renderer.setOutline(outline);
    renderer.draw(cam.eye, cam.vyaw, cam.vpitch, color);
  }
  requestAnimationFrame(frame);
}

window.addEventListener('pagehide', () => navigator.sendBeacon(`/api/stop?sid=${sid}`));
init().catch((err) => {
  document.body.innerHTML = `<pre style="color:#f88;padding:20px">${String(err && err.stack || err)}</pre>`;
});

// debugging handle (used for automated checks in the dev console)
window.__nh = { cam, opts, world, game, ui, handle, creator, makeSkin, motion, music, blocks, phys, fx, nameTags, crosshairTarget, yawDir, hero3d, loadHeroFigure, get renderer() { return renderer; } };

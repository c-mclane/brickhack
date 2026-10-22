// NetHack 3D client: networking, game state, controls, camera, main loop.
import { Renderer } from './render.js';
import { World } from './world.js';
import { UI, setAtlas, itemActions, SLOT_LETTERS, tileIcon } from './ui.js';
import { CM, cmapTile, wallTile, setCmap, setCmapBase, WALL_H } from './terrain.js';
import { Motion, sizeHeight, posAt } from './motion.js';
import * as THREE3 from 'three'; // (measuring models: modelTop)
import { BlockWorld, BLOCKS, BUILD_LIMIT, breakTime, minedAs } from './blocks.js';
import { buildTextures } from './textures.js';
import { ACTION_GROUPS, recommend } from './actions.js';
import { CombatFX } from './combat.js';
import { NameTags, nameTagEntries } from './nametags.js';
import { Drops } from './drops.js';
import { buildPlayerModel } from './playermodel.js';
import { Music, Ambience } from './music.js';
import { swimPose, SWIM_SPLASH, WATER_Y, DEEP } from './swim.js';
import { DRY_GREY, DRY_SIT, LADY_T, PRAY_OUTCOME, PRAY_AFTER, prayAfter } from './brickworld.js';
import { figureMatrix, partMatrix, FIG_HEIGHT, STUD_H, MODEL_SCALE } from './brick.js';
import { creatureLocal, slitherLocal, LUNGE_TIME } from './creature.js';
import { hopOn, hopOff, perched, sideToward, offTime, HOP_ON, PERCHES, perchOf, FOUNT_SPLASH, FOUNT_REACH, FOUNT_DOWN, bathPath, BATH_SPLASH, sitPath, risePath, RISE_T, againstFountain } from './perch.js';
import { setupFigurePicker, figureView, loadRoster, figuresFor, customFigureUrl } from './figpick.js';
import { FigureAnimator, FOUNT, LOOSE_AT, NOCKED, nockAt, fountKey, mouthPoint, firstPersonMatrix, firstPersonWrist, wristMatrix, mul as mul4, FP_TILT, FP_HOLD_TILT, ATTACK_TIME, SLASH_CUT } from './minifig-anim.js';
import { loadBrickItems, brickItemForTile, brickItemByName, brickChainLink, brickBuilt, gameTile, setStartPieces, isStartTile, onIcons } from './brickitems.js';
import { menuPlate } from './brandlogo.js';
import { brickInterface } from './brickui.js';
import { AltarRites } from './rites.js';
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
    if (s[0] === 'a') this.lastApplyT = performance.now(); // (an apply: a pick-axe it wields is put away again after: tool swap)
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
  relock() { relock(); },
  hotbarKey() { return `nh3d.hotbar.${this.variant}.${this.charName || ''}`; },
  loadHotbar() {
    const h = safeJSON(localGet(this.hotbarKey()));
    if (Array.isArray(h)) this.hotbar = h.slice(0, 9).concat(new Array(9).fill(null)).slice(0, 9);
    this.hotbarLoaded = true;
  },
  saveHotbar() { if (this.charName) localSet(this.hotbarKey(), JSON.stringify(this.hotbar)); },

  // issue a NetHack command for an item; prompts for the item get answered automatically
  itemCmd(action, it, count) {
    if (action === 'fire') { // (a bow, a crossbow, a sling: what's quivered shot from it; wielded first, if it isn't)
      if (ui.inventoryOpen) { closeInventory(); relock(); }
      if (it.w !== 'weapon') { this.pending.push({ key: it.l }); this.afterReady = () => this.sendKeys('f'); this.sendKeys('w'); }
      else this.sendKeys('f');
      return;
    }
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
const ambience = new Ambience(opts.music / 100); // (a fountain's water, lava's flow: looped under the music: roomNear)
// the rites at the altar of a follower of Jesus (the engine's "rite": winweb.c web_ritefx), played out at it (rites.js):
// its statues come alive, the wafer, the chalice, alms tossed into its plate...; the Agnus Dei chanted meanwhile
const rites = new AltarRites({
  get brick() { return renderer.brick; },
  clock: () => performance.now() / 1000,
  wait: (s) => new Promise((res) => (s > 0 ? setTimeout(res, s * 1000) : requestAnimationFrame(() => res()))),
  say: () => {}, // (the engine says it)
  hero: { act: (n) => { if (n) fountNow(n); else hero3d.fount = null; }, hold: (h) => { hero3d.riteHold = h; } },
  url: (n) => (brickBuilt(n) || {}).url, upright: (n) => !!(brickBuilt(n) || {}).upright,
  angelUrl: null, chant: (on) => ambience.set('mass', on),
});
loadRoster().then((r) => { const a = r.find((f) => f.id === 'angel-priest-m'); rites.env.angelUrl = a && a.url; });
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
const NIGHT = 0x0b0d14; // the sky: black (as the test dungeon's), Descend and Ascend alike
const NIGHT_FOG = [0x0b / 255, 0x0d / 255, 0x14 / 255]; // (what the distance hazes into: the same)
const ASCEND_FAR = 50; // how far Ascend's baseplate is drawn (squares): a quarter of the dungeon's
// BrickHack's dungeon is a brick maze out in the open, under a black sky
function setSky() {
  renderer.daySky = false;
  renderer.showSky = false; // (a block level: no stars either, just black)
  renderer.spaceBelow = false;
  renderer.fog = NIGHT_FOG;
  if (renderer.brick) renderer.brick.setSky(NIGHT);
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
  loadBrickItems().then(() => { const c = brickItemByName('_coin'); if (c && renderer.brick) renderer.brick.coinUrl = c.url; /* (gold in a fountain: coins strewn in its basin) */ if (game.playing) { ui.renderHotbar(); if (ui.renderInventory) ui.renderInventory(); } });
  loadBrickMonsters();
  $('#actions-btn').onclick = (e) => { e.stopPropagation(); if (game.playing) { releaseLock(); ui.openInventory(null, 'actions'); } };
  requestAnimationFrame(frame);
  // music can only start after the first click or key press (browser autoplay rules)
  await music.load();
  const kick = () => { music.start(); ambience.allow(); window.removeEventListener('pointerdown', kick); window.removeEventListener('keydown', kick); };
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
    case 'mons': { // (any monster gone since: where it was, and how tall, for what it drops: dropTop)
      const before = new Map([...motion.mobs].map(([id, mob]) => [id, { x: mob.tx, z: mob.tz, size: mob.size }]));
      motion.setMobs(m, performance.now());
      const now = performance.now();
      for (const [id, b] of before) if (!motion.mobs.has(id)) gone.push({ x: b.x, z: b.z, top: mobTop(id, b.size), t: now });
      while (gone.length && now - gone[0].t > 3000) gone.shift();
      break;
    }
    case 'map': world.applyMap(m.c); break;
    case 'vis': world.setVis(m.v, m.w, m.h); break;
    case 'piles': world.applyPiles(m.p); break;
    case 'level':
      world.castle = m.castle || null; // the Castle: [x0, y0, x1, y1], where its stone walls stand (render.js raises them)
      world.style = /Gnomish Mines/i.test(m.dname || '') ? 'mines' : null; // (the Mines: brown floors, rock walls: brickworld minesWalls)
      ui.showTitle(`Level ${m.depth}`, m.dname);
      cam.snap = true;
      break;
    case 'stat':
      { const near = roomNear(m.ux, m.uy); ambience.set('water', near.water); ambience.set('lava', near.lava); } // (a fountain's or a pool's water, lava's flow: heard)
      if (!game.charName) { game.charName = m.name; game.loadHotbar(); loadHeroFigure(m.name, m); }
      world.heroTile = game.skinLoaded && !m.poly ? skinTile() : null;
      if (world.faith !== !!m.faith) { world.faith = !!m.faith; world.dirty = true; } // (his followers: his altar, lawful ones)
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
    case 'inv': {
      // applying a digging tool wields it in place of your weapon: that weapon taken up again, the
      // digging done (toolSwap)
      const was = game.inv.find((i) => i.w === 'weapon');
      game.setInventory(m.items);
      const now = game.inv.find((i) => i.w === 'weapon');
      if (was && now && was.l !== now.l && DIGGER.test(now.n) && performance.now() - (game.lastApplyT || 0) < 5000 && !toolSwap.back)
        toolSwap.back = was.l;
      redressHero();
      break;
    }
    case 'msg':
      if (m.raw) console.log('[slashem]', m.s);
      if (/For instructions type a \?/.test(m.s)) { game.mode = 'getpos'; break; }
      fx.onMessage(m.s, motion, world.hero, performance.now());
      // digging (a boulder, a statue, rock, down): a blow for each the engine tells of, each landing
      // before what comes after it (fx.attack holds the replies: the boulder bursts after the last)
      if (DIG_MSG.test(m.s)) {
        const d = ui.stat && ui.stat.dig, yaw = doll.yaw;
        fx.attack(d ? d[0] : world.hero.x + Math.round(Math.sin(yaw)), d ? d[1] : world.hero.y - Math.round(Math.cos(yaw)), performance.now());
      }
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
        // (the ball you're chained to: it itself flung, the chain after it, not a copy of it flown there)
        const pun = m.by !== 'monster' && l.name === 'heavy iron ball' && punishment();
        // (shot from a bow: loosed, flat and fast, from the bow's height, the arrow away as the string's let go, in the
        // archer's stance (FOUNT.loose: the hero, a minifig monster, a centaur's man half); a creature's lunge)
        const mon = m.by === 'monster' ? brickMons.get(world.cells[m.fy * world.w + m.fx] && world.cells[m.fy * world.w + m.fx].t) : null;
        const stance = m.shot && !(mon && mon.creature && !mon.rider);
        const from = m.shot ? (mon && mon.rider ? 1.25 : mon && mon.creature ? 1.15 : 1.05) : undefined, wait = stance ? LOOSE_AT * 1000 : 0;
        if (m.by !== 'monster' && m.shot) hero3d.nockUrl = l.url; // (the arrow on your string, till it's loosed)
        if (!(pun && renderer.brick.tossBall(m.tx, m.ty))) renderer.brick.fx.launch(l.url, m.fx, m.fy, m.tx, m.ty, { spit, shot: !!m.shot, from, delay: wait / 1000 }); // (in the air from now: not seen where it lands till it gets there)
        // (what it did (a hit, a kill, the monster gone, the messages) waits till it gets there, as an attack's waits for
        // the blade: the replies held through the draw and the flight (throwfx.js launch: its time in the air))
        const dist = Math.hypot(m.tx - m.fx, m.ty - m.fy), flight = m.shot ? 0.12 + 0.045 * dist : spit ? 0.28 + 0.1 * dist : 0.7 + 0.13 * dist;
        holdReplies(performance.now() + wait + flight * 1000 + 80);
        if (spit) renderer.brick.fx.shatter(l.url, m.tx, m.ty, 'venom');
      }
      const shooter = m.by === 'monster' && brickMons.get(world.cells[m.fy * world.w + m.fx] && world.cells[m.fy * world.w + m.fx].t);
      if (m.by === 'monster' && !(m.shot && shooter && shooter.rider)) spitAt.set(`${m.fx},${m.fy}`, performance.now()); // (a creature there lunges: brickMonFigures; a centaur shoots instead)
      if (m.by === 'monster' && m.shot) shotAt.set(`${m.fx},${m.fy}`, performance.now()); // (a minifig there draws and looses)
      if (m.by !== 'monster' && m.shot) fountNow('loose'); // (you shot it: into the stance, drawn, aimed, let go, and back)
      else if (m.by !== 'monster' && hero3d.anim) hero3d.anim.attack('L'); // (you threw it: a swing of your left arm)
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
    case 'sink': { // a boulder pushed into water: rolled in, sunk, a floor rising there should it fill it (brickworld.js boulderSink)
      const l = brickItemForTile(m.tile);
      if (l && renderer.brickOn && renderer.brick) renderer.brick.boulderSink(l.url, m.fx, m.fy, m.x, m.y, !!m.fills);
      if (m.fx !== m.x || m.fy !== m.y) hero3d.pushT0 = performance.now(); // (a lean into it)
      break;
    }
    case 'crumble': { // a boulder broke into rocks: it bursts, grit and rocks flying
      const l = brickItemForTile(m.tile), rock = brickItemByName('rock');
      if (l && rock && renderer.brickOn && renderer.brick) renderer.brick.boulderBreak(l.url, m.x, m.y, rock.url, l.halves);
      break;
    }
    case 'fountain': // drinking from the fountain you're on, or dipping something in: kneeling at its water (heroPose)
      if (m.act === 'dry') { fountainDries(m.x, m.y); break; }
      if (m.act === 'drink' || m.act === 'dip') hero3d.fount = { act: m.act, t0: performance.now(), url: m.act === 'dip' ? (brickItemForTile(m.tile) || {}).url : null, fired: 0 };
      else if (renderer.brickOn && renderer.brick) { // found to be magic, or "the water glows for a moment": its water flaring, an aura round it
        const f = hero3d.fount, into = f ? Math.max(0, (f.act === 'drink' ? 0.9 : 0.6) - (performance.now() - f.t0) / 1000) : 0; // (once the water's touched)
        if (m.act === 'magic') renderer.brick.fountainFlare(m.x, m.y, into); else renderer.brick.fountainGlint(m.x, m.y, into);
      }
      break;
    case 'swim': // fell into water (from the square you stepped from), or crawling out of it (onto a dry one): swim.js
      if (m.act === 'fall') hero3d.swim = { from: [m.x, m.y], pool: [m.px, m.py], to: null, t0: performance.now(), fired: 0, lava: !!m.lava };
      else { // (crawling out: onto the square; onto a statue's (a fountain's), only up to its foot on the pool's side, the hop
        // up onto its rim from there: processMovement)
        let to = [m.x, m.y];
        const pd = (world.brickDrops || []).find((o) => o.x === m.x && o.z === m.y && PERCHES[o.name]);
        if (pd) { const dx = m.px - m.x, dz = m.py - m.y, n = Math.hypot(dx, dz) || 1, k = perchOf(pd).OUT + BODY_R; to = [m.x + (dx / n) * k, m.y + (dz / n) * k]; }
        if (hero3d.swim && hero3d.swim.pool[0] === m.px && hero3d.swim.pool[1] === m.py) hero3d.swim.to = to;
        else hero3d.swim = { from: [m.px, m.py], pool: [m.px, m.py], to, t0: performance.now() - 1e3 * 0.9, fired: 1 }; // (no fall seen: just the crawl)
      }
      break;
    case 'gush': // the fountain you're on gushing: its burst (x -1), then a stream out to each square it floods, nearer first
      if (!renderer.brickOn || !renderer.brick) break;
      if (m.x < 0) { renderer.brick.gushBurst(m.fx, m.fy); hero3d.gushN = 0; }
      else renderer.brick.gushTo(m.fx, m.fy, m.x, m.y, 0.15 + 0.12 * Math.hypot(m.x - m.fx, m.y - m.fy) + 0.03 * (hero3d.gushN = (hero3d.gushN || 0) + 1));
      break;
    case 'lady': ladyOfTheLake(m); break;
    case 'trickle': // the fountain's flow reduced to a trickle
      if (renderer.brickOn && renderer.brick) renderer.brick.fountainTrickle(m.x, m.y);
      break;
    case 'warn': { // a watchman yelling at you to stop using the fountain: he brandishes his halberd high at you (a
      // warning, not a blow: brickMonFigures), a red flash over him
      const st = monState.get(m.id), mob = motion.mobs.get(m.id);
      if (st) st.warnAt = performance.now();
      if (mob && renderer.brickOn && renderer.brick) {
        const [mx, mz] = posAt(mob, performance.now());
        renderer.brick.fx.sparkles(new THREE3.Vector3(mx + 0.5, STUD_H + 1.5, mz + 0.5), 24, 0xff3b30, 0.15);
      }
      break;
    }
    case 'bubble': // no water nymph: a great bubble rises out of the fountain and pops
      if (renderer.brickOn && renderer.brick) { const b = brickItemByName('_bubble'); if (b) renderer.brick.fountainBubble(m.x, m.y, b.url); }
      break;
    case 'gem': { // a gem spotted in the sparkling waters: once your dip's done, you reach in and pull it out, and hold it
      // up high (as Excalibur), glinting; then it lies in the pool, where the game has it
      const l = brickItemForTile(m.tile);
      if (!l || !renderer.brickOn || !renderer.brick) break;
      const g = renderer.brick.fountainGem(m.x, m.y, l.url), f = hero3d.fount, now = performance.now();
      const after = f ? Math.max(0, FOUNT[f.act].T * 1000 - (now - f.t0)) : 0;
      setTimeout(() => {
        const t0 = performance.now();
        hero3d.fount = { act: 'dip', t0, url: null, grab: l.url, fired: 0 }; // (an empty hand in, the gem in it coming out: heroHold)
        hero3d.raise = { t0: t0 + (FOUNT.dip.T - 0.3) * 1000, T: GEM_RAISE_T, url: l.url, glint: 0, tip: [0.22, 1.3] }; // (its glints: at the fist)
        setTimeout(g.show, (FOUNT.dip.T - 0.3 + GEM_RAISE_T) * 1000);
      }, after);
      break;
    }
    case 'fountfx': { // odd things at the fountain you're on, once your drink or dip's done: the urge to take a bath
      // (a dive in, a jump out, a shake: perch.js bathPath); foul water (doubled over it, retching into it);
      // contaminated water (a purple haze about you a while: heroHaze); this water's no good (a murky puff about you)
      // and bad breath (a faint wisp or two off your mouth: heroWisps); a tingling, a chill (a shiver, frost glinting
      // off you); coins seen glistening far below (glints off them, strewn in its basin: brickworld basinCoins)
      const f = hero3d.fount, after = f ? Math.max(0, FOUNT[f.act].T * 1000 - (performance.now() - f.t0)) : 0;
      if (m.act === 'coins') { if (renderer.brickOn && renderer.brick) setTimeout(() => renderer.brick.fountainCoinsGlint(m.x, m.y), Math.max(0, after - 900)); break; }
      setTimeout(() => {
        const now = performance.now();
        if (m.act === 'poison') { if (!hero3d.haze || !hero3d.haze.sick) hero3d.haze = { t0: now, T: HAZE_T, last: 0 }; }
        else if (m.act === 'curse') hero3d.puff = { t0: now };
        else if (m.act === 'breath') hero3d.breath = { until: ((ui.stat && ui.stat.turn) || 0) + BREATH_TURNS, last: 0 };
        else hero3d.fount = { act: { bath: 'bath', foul: 'retch', shiver: 'shiver' }[m.act] || 'retch', t0: now, url: null, fired: 0, bathFired: 0, frostT: 0 };
      }, after);
      break;
    }
    case 'furnfx': furnFx(m); break; // a sink, a toilet: its doings (furnFx)
    case 'pray': prayFx(m); break; // praying, as it goes (prayFx)
    case 'rite': riteFx(m); break; // a rite at the altar of a follower of Jesus (riteFx)
    case 'altar': altarFx(m); break; // what happens at an altar: a sacrifice, a flash, a conversion (altarFx)
    case 'priest': priestFx(m); break; // a contribution to a temple priest (priestFx)
    case 'boxfx': // a box or a chest kicked (brickworld.js boxFx): your kick, and what comes of it as your foot lands
      if (m.act === 'thud') fountNow('kick');
      if (renderer.brickOn && renderer.brick) {
        const l = m.tile >= 0 ? brickItemForTile(m.tile) : null, tint = l ? potionHue((l.name || '').replace(/ potion$/, '')) : null;
        setTimeout(() => renderer.brick.boxFx(m.x, m.y, m.act, tint), m.act === 'thud' ? 380 : 520);
      }
      break;
    case 'steam': // a fire ray across a fountain: steam billows up out of it
      if (renderer.brickOn && renderer.brick) renderer.brick.fountainSteam(m.x, m.y);
      break;
    case 'wished': // a water demon granting a wish, and gone: a burst where it stood
      if (renderer.brickOn && renderer.brick) renderer.brick.demonGone(m.x, m.y);
      break;
    case 'rise': { // a monster out of the fountain (snakes pouring forth): one after another, up out of its water and off over the rim
      const now = performance.now(), burst = now - (rising.last || 0) < 1500 ? rising.n + 1 : 0;
      Object.assign(rising, { last: now, n: burst });
      rising.set(m.id, { f: [m.fx, m.fy], t0: now + burst * 350 });
      if (renderer.brickOn && renderer.brick) {
        const fd = (world.brickDrops || []).find((o) => o.x === m.fx && o.z === m.fy && PERCHES[o.name]), b = renderer.brick;
        const at = fd && fd.name === 'sink' ? b.sinkDrain(m.fx, m.fy) : fd && fd.name === 'toilet' ? b.toiletWater(m.fx, m.fy) : new THREE3.Vector3(m.fx + 0.5, STUD_H + PERCHES.fountain.H - 0.1, m.fy + 0.5);
        setTimeout(() => b.fx.splashStuds(at, 8, 1.4), burst * 350);
      }
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
  const a = hero3d.ascend; // (the ending played out first)
  if (a && performance.now() < a.end) { setTimeout(onGameOver, a.end - performance.now() + 200); return; }
  hero3d.ascend = null;
  ambience.set('mass', false);
  game.playing = false;
  ambience.set('water', false);
  ambience.set('lava', false);
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
// the pet each role starts with (SLASH'EM role.c petnum; the rest a kitten or a little dog: dog.c pet_type), and the
// names a dog of some of them is given, unnamed (dog.c makedog)
const PET_OF = { caveman: 'little dog', 'flame mage': 'hell hound pup', 'ice mage': 'winter wolf cub', knight: 'pony', necromancer: 'ghoul',
  ranger: 'little dog', samurai: 'little dog', wizard: 'kitten', yeoman: 'pony' };
const PET_NAMES = { caveman: 'Slasher', samurai: 'Hachi', barbarian: 'Idefix', ranger: 'Sirius' };
const SPLASHES = ['Now in 3D!', 'Elbereth!', 'Now with studs!', 'The DevTeam thinks of everything!', 'Do not eat the cockatrice!',
  'You hear the footsteps of a guard on patrol.', '100% tiles!', 'Ascend!', 'Mind your bare feet!', 'Watch out for soldier ants!'];

const CONTROLS = [
  ['Mouse', 'Look around'], ['W A S D', 'Move (relative to camera, 8 directions)'], ['Shift + WASD', 'Rush in a direction'],
  ['Left click', 'Attack / fight in the direction you look'], ['Right click', 'Use held item · open/close doors · travel to clicked spot'],
  ['Middle click', 'Look at what is under the crosshair'], ['1-9', 'Select hotbar slot'], ['Mouse wheel', 'Zoom the camera in and out'], ['I', 'Inventory (and its Actions tab: every command as a button)'],
  ['Delete / Shift+Delete', 'Drop one / drop stack of held item'], ['Space', 'Use stairs (on stairs) · otherwise search'],
  ['Shift+1..4', 'Do a Recommended action: row 1, 2, 3, 4'], ['↑ (up arrow)', 'Do the first Recommended action'], ['Enter', 'Command bar (extended commands, "give <item>"...)'],
  ['Every other key', "NetHack's own, as ever: e eat, q quaff, r read, z zap, t throw, f fire, , pick up, # extended command, P put on, Alt+I invoke, Ctrl+D kick..."],
  ['Tab', 'Message history'], ['F2', 'Overhead map view on/off'], ['F5', 'Change camera (1st / 3rd back / 3rd front)'], ['F1', 'Hide HUD'],
  ['F3', 'Debug info'], ['`', 'Raw NetHack keys on/off (W A S D too)'], ['Esc', 'Cancel prompt / game menu'],
];

function buildScreens() {
  $('#title .splash').textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
  brickInterface(); // (titles, buttons, the splash in brick: brickui.js)
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
  // your pet: the one your role starts with (role.c petnum), turning in its window, a kitten or a little dog where the
  // role's isn't fixed, or none at all (pettype:none: dog.c makedog), a click going round them; and its name, yours to
  // give (a dog's default, its role's)
  const petView = figureView($('#petpick canvas'), () => !$('#create').classList.contains('hidden'), { near: 3.2 });
  const petIn = $('#petname');
  let petType = localGet('bh.pettype') || (Math.random() < 0.5 ? 'c' : 'd'), petDefault = '', petMons = null;
  fetch('assets/brick/monsters.built.json', { cache: 'no-store' }).then((r) => r.json()).then((m) => { petMons = m; petSync(); }).catch(() => {});
  const petRole = () => CYCLES.role[1][choice.role].toLowerCase();
  const petKind = () => (petType === 'n' ? null : PET_OF[petRole()] || (petType === 'c' ? 'kitten' : 'little dog'));
  const PET_ROUND = (role) => (PET_OF[role] ? ['r', 'n'] : ['c', 'd', 'n']); // (r: the role's own)
  let petShown = null;
  const petSync = () => {
    const role = petRole();
    if (petType === 'r' && !PET_OF[role]) petType = Math.random() < 0.5 ? 'c' : 'd'; // (the role's own: this one has none fixed)
    const kind = petKind();
    $('#petpick .pet-kind').textContent = !kind ? 'No pet' : role === 'random' ? `${kind}?` : kind;
    $('#petpick canvas').classList.add('swap');
    $('#petpick canvas').title = PET_OF[role] ? `Your pet (click: a ${PET_OF[role]}, or none)` : 'Your pet (click: a kitten, a little dog, or none)';
    petIn.disabled = !kind;
    const def = kind === 'little dog' ? PET_NAMES[role] || '' : '';
    if (!petIn.value || petIn.value === petDefault) petIn.value = def; // (a name you gave it kept)
    petDefault = def;
    const url = kind ? petMons && petMons[kind] && petMons[kind].url : null;
    if (kind ? url && url !== petShown : petShown !== null) { petShown = url; petView && petView.show(url); } // (none: an empty stage)
  };
  $('#petpick canvas').onclick = () => {
    const round = PET_ROUND(petRole()), at = round.indexOf(PET_OF[petRole()] && petType !== 'n' ? 'r' : petType);
    petType = round[(at + 1) % round.length];
    petSync();
  };
  syncPicker = () => { figPicker.filter(CYCLES.role[1][choice.role], CYCLES.gender[1][choice.gender], CYCLES.race[1][choice.race]); swear(figPicker.current()); petSync(); };
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
    o.petname = petType === 'n' ? '' : petIn.value.trim(); // (your pet's name, and which it is where your role leaves it to you, or none)
    if (petType === 'n' || !PET_OF[petRole()]) o.pettype = petType;
    localSet('bh.pettype', petType);
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
  ambience.setVolume(opts.music / 100);
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
const showFigure = () => !!hero3d.prims && opts.playerModel === 'model' && (opts.camera !== 0 || !!cutscene) && !(ui.stat && ui.stat.poly); // (a cutscene: you, seen, whatever the view)

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
  if (statuePerch(performance.now()) && performance.now() - (game.lastApplyT || 0) > 8000) { hold.R = null; hold.L = null; hold.two = false; } // (climbing a statue: hands free; unless digging down from up there)
  if (hero3d.raise && hero3d.raise.url) { hold.R = hero3d.raise.url; hold.L = null; hold.two = false; } // (Excalibur: in hand from the blessing on, up there, jumping down, and held high)
  const fo = fountAct(performance.now());
  if (fo && fo.act === 'loose') { hold.L = null; hold.two = false; hold.nock = fo.t > NOCKED[0] && fo.t < NOCKED[1] ? hero3d.nockUrl : undefined; hold.nockK = nockAt(fo.t); } // (shooting: the bow kept in hand, an arrow on its string)
  else if (fo) { // (at a fountain: what's dipped in hand; a gem pulled out, in hand as it comes up)
    hold.R = fo.act === 'dip' || fo.act === 'reach' || fo.act === 'toiletDip' ? (hero3d.fount.grab && fo.t > FOUNT[fo.act].cup + 0.35 ? hero3d.fount.grab : hero3d.fount.url || null) : null;
    hold.L = null; hold.two = false;
  }
  if (hero3d.riteHold) { hold.R = hero3d.riteHold.R ?? null; hold.L = hero3d.riteHold.L ?? null; hold.two = false; } // (a rite: the wafer, the chalice, a corpse offered)
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
// riding (the engine's stat: steed, its tile): the steed you're on, in brick, saddled, or null
function riddenSteed() {
  const t = ui.stat && ui.stat.steed;
  if (t == null || t < 0 || !renderer.brickOn) return null;
  const e = brickMons.get(t);
  return e && (e.saddledPrims || e.prims) ? e : null;
}
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
  const sw = heroSwim(now); // (falling into water, crawling out)
  if (sw) return a.update(dt, { moving: false, holdsR: !!hold.R, holdsL: !!hold.L, hop: sw.hop, reach: sw.reach, lean: sw.lean });
  const riding = !!riddenSteed(); // (astride a steed: legs out, the reins held, still)
  return a.update(dt, { moving: !riding && game.playing && (motion.heroRemaining(now) > 0 || !phys.onGround), ride: riding ? 1 : 0,
    holdsR: !!hold.R, holdsL: !!hold.L, twoweap: !!hold.two,
    hop: pp ? pp.hop : 0, lookUp: pp && !fountAct(now) ? pp.lookUp : 0, lean: push > 0 ? 0.3 : 0, reach: push > 0 ? 1 : 0, heavy: heavyBall() ? 1 : 0,
    fount: fountAct(now), raise: raiseAct(now) });
}
// falling into water and crawling out, now (swim.js): where you are and how, or null; and the water
// broken as it goes. Over: still in it (no crawl: you swim, or drowned), sunk as deep as you went, rising
// to the waist (heroSink)
function heroSwim(now) {
  const s = hero3d.swim;
  if (!s) return null;
  const t = (now - s.t0) / 1000, p = swimPose(s, t);
  if (!p) { hero3d.swim = null; if (!s.to) hero3d.sink = DEEP; return null; }
  while (renderer.brickOn && renderer.brick && s.fired < SWIM_SPLASH.length && t >= SWIM_SPLASH[s.fired][0]) {
    const [, at, n, up] = SWIM_SPLASH[s.fired++], ground = world.heroLift ?? phys.y;
    const w = at === 'pool' ? [s.pool[0] + 0.5, s.pool[1] + 0.5] : [p.x + 0.5, p.z + 0.5];
    renderer.brick.fx.splashStuds(new THREE3.Vector3(w[0], at === 'you' ? ground + 0.45 + p.y : ground + WATER_Y, w[1]), n, up,
      at === 'you' ? { floor: ground + STUD_H, ring: false, lava: s.lava } : { lava: s.lava });
  }
  return p;
}

// in water (a pool, a moat, lava: the square you're over, as you go), and not above it (levitating,
// flying, riding, up on a statue): sunk in it, to the waist, bobbing a little; eased in and out. Squares
const SINK = 0.4;
function heroSink(dt, t, hx, hz, perched) {
  const cond = (ui.stat && ui.stat.cond) || [];
  const wet = !perched && world.isWater(Math.round(hx), Math.round(hz)) && phys.onGround && !['Lev', 'Fly', 'Ride'].some((c) => cond.includes(c));
  hero3d.sink = (hero3d.sink || 0) + ((wet ? SINK : 0) - (hero3d.sink || 0)) * Math.min(1, dt * 6);
  // (in lava: smoking, embers flying off you)
  const lv = wet && world.classAt(Math.round(hx), Math.round(hz)), lava = lv && lv.cmap === CM.lava;
  if (lava && renderer.brickOn && renderer.brick && t - (hero3d.smokeT || 0) > 450) {
    hero3d.smokeT = t;
    const g = (world.heroLift ?? phys.y) + 0.2;
    renderer.brick.fx.vapor(new THREE3.Vector3(Math.round(hx) + 0.5, g, Math.round(hz) + 0.5), 0x4a4a4a, 1.6);
    renderer.brick.fx.sparkles(new THREE3.Vector3(Math.round(hx) + 0.5, g, Math.round(hz) + 0.5), 10, 0xff7a1a, 0.3);
  }
  return hero3d.sink + (wet ? 0.02 * Math.sin(t / 1000 * 2.4) * (hero3d.sink / SINK) : 0);
}

// what's in the room you're in, as far as you know it (the floor you're on, out to its walls and
// doorways; a corridor: no room, nothing heard): {water (a fountain, a pool, a moat), lava}
function roomNear(x, y) {
  const at = (cx, cy) => world.classAt(cx, cy), near = { water: false, lava: false };
  const c0 = at(x, y);
  if (!c0 || (c0.cmap === CM.corr || c0.cmap === CM.litcorr)) return near;
  const seen = new Set([y * world.w + x]), todo = [[x, y]];
  while (todo.length && seen.size < 3000) {
    const [cx, cy] = todo.pop(), c = at(cx, cy);
    if (c.type === 'liquid' && c.cmap === CM.lava) near.lava = true;
    else if (c.cmap === CM.fountain || c.type === 'liquid') near.water = true;
    if (near.water && near.lava) break;
    if (c.lintel && !(cx === x && cy === y)) continue; // (a doorway: the room's edge)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy, i = ny * world.w + nx, n = at(nx, ny);
      if (!n || seen.has(i) || !(n.type === 'floor' || n.type === 'liquid' || n.type === 'odoor') || n.cmap === CM.corr || n.cmap === CM.litcorr) continue;
      seen.add(i);
      todo.push([nx, ny]);
    }
  }
  return near;
}

// ---- a sink and a toilet (winweb.c web_furnfx, web_furnobj): drunk from (a sip from a sink's tap, poured; bent
// down over a toilet, lapping) and what came of it; sat on, prayed at, a thing dipped in it; kicked; broken. What
// comes after a drink waits on it (atFount: when the water's touched; afterFount: when it's done)
const POTION_HUES = { puce: 0xc0608a, ruby: 0xb3122a, pink: 0xf28fb5, orange: 0xf08a24, yellow: 0xf2d43a, emerald: 0x1e9e5a, 'dark green': 0x1f5e2e,
  cyan: 0x3fd0d8, 'sky blue': 0x7cc4f0, 'brilliant blue': 0x2a6af0, indigo: 0x4b3cb0, magenta: 0xd02aa8, 'purple-red': 0x9c2a5a, violet: 0x8a4ad8,
  white: 0xf0f0f0, black: 0x1a1a1a, brown: 0x7a4a24, golden: 0xd8a83a, amber: 0xd89a2a, milky: 0xe8ece8, murky: 0x6a6a4a, cloudy: 0xc8ccd0,
  smoky: 0x8a8a8a, swirly: 0x9ab0e0, bubbly: 0xa8e0f0, fizzy: 0xd0f0e0, effervescent: 0xc0f0d8, dark: 0x2a2a3a, silver: 0xc8ccd4, clear: 0xbfe8ff };
const potionHue = (name) => POTION_HUES[name] ?? ([...(name || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffffff, 7) | 0x404040);
function atFount(fn, cup = 0.6) { const f = hero3d.fount; setTimeout(fn, f ? Math.max(0, cup * 1000 - (performance.now() - f.t0)) : 0); }
function afterFount(fn) { const f = hero3d.fount; setTimeout(fn, f ? Math.max(0, FOUNT[f.act].T * 1000 - (performance.now() - f.t0)) : 0); }
const fountNow = (act, extra = {}) => { hero3d.fount = { act, t0: performance.now(), url: null, fired: 0, ...extra }; };
function furnFx(m) {
  if (!renderer.brickOn || !renderer.brick) return;
  const b = renderer.brick, fx = b.fx, x = m.x, y = m.y, sink = m.what === 'sink';
  const wet = () => (sink ? b.sinkDrain(x, y) : b.toiletWater(x, y)), item = m.tile != null ? brickItemForTile(m.tile) : null;
  switch (m.act) {
    // a sink drunk from: hands under the tap, the water poured (a potion's colour, if it's that: set just after)
    case 'sip': {
      fountNow('sip');
      const sip = (hero3d.sinkSip = { tint: null });
      setTimeout(() => fx.pour(b.sinkSpout(x, y), b.sinkDrain(x, y).y, 1.2, { tint: sip.tint }), 300);
      break;
    }
    case 'potion': if (hero3d.sinkSip) hero3d.sinkSip.tint = potionHue(m.extra); break;
    case 'cold': atFount(() => { for (let i = 0; i < 4; i++) setTimeout(() => fx.frost(wet().setY(wet().y + 0.15)), i * 250); }); break;
    case 'scald': atFount(() => { for (let i = 0; i < 5; i++) setTimeout(() => fx.vapor(wet(), 0xf2f6f8, 1.3), i * 200); }); afterFount(() => fountNow('scald')); break;
    case 'awful': afterFount(() => fountNow('scald')); break;
    case 'toxic': atFount(() => { for (let i = 0; i < 4; i++) setTimeout(() => fx.vapor(wet(), 0x8ac83a, 1.0), i * 250); }); break;
    case 'clank': atFount(() => b.sinkShake(x, y, 1.2)); break;
    case 'song': atFount(() => fx.notes(wet(), 6)); break;
    case 'elemental': atFount(() => { for (let i = 0; i < 3; i++) setTimeout(() => fx.splashStuds(wet(), 16, 2.2), i * 160); }); break;
    case 'dirty': atFount(() => fx.splashStuds(wet(), 6, 0.6, { tint: 0x5a4a2a })); break;
    case 'sewage': afterFount(() => {
      fountNow(sink ? 'sinkRetch' : 'toiletRetch');
      for (const t of [0.5, 0.82, 1.15, 1.5]) setTimeout(() => fx.splashStuds(wet(), 6, 0.6, { tint: 0x7a6a3a }), t * 1000);
    }); break;
    case 'ring': { // a ring found in a sink: reached in for, and held up high (as a gem out of a fountain)
      if (!item) break;
      const g = b.fountainGem(x, y, item.url);
      afterFount(() => {
        const t0 = performance.now();
        fountNow('reach', { grab: item.url });
        hero3d.raise = { t0: t0 + (FOUNT.reach.T - 0.3) * 1000, T: GEM_RAISE_T, url: item.url, glint: 0, tip: [0.22, 1.3] };
        setTimeout(g.show, (FOUNT.reach.T - 0.3 + GEM_RAISE_T) * 1000);
      });
      break;
    }
    case 'break': b.sinkBreak(x, y, m.what); break;
    // a toilet drunk from: bent down over it, lapping
    case 'gulp': fountNow('gulp'); for (const t of [0.55, 0.95, 1.35, 1.75]) setTimeout(() => fx.splashStuds(wet(), 3, 0.4), t * 1000); break;
    case 'refreshing': atFount(() => fx.sparkles(wet(), 14, 0xbfefff, 0.2), 1.0); break;
    case 'ooze': hero3d.oozeT = setTimeout(() => b.toiletOoze(x, y, false), 900); break; // (and it stays: unless it slithers back, just after)
    case 'slither': clearTimeout(hero3d.oozeT); setTimeout(() => b.toiletOoze(x, y, true), 900); break;
    case 'fishy': atFount(() => { for (let i = 0; i < 4; i++) setTimeout(() => fx.vapor(wet(), 0xa3ab78, 0.7), i * 350); }, 1.0); break;
    case 'sit': fountNow('sit'); break;
    case 'pray': fountNow('pray'); break;
    case 'smiles': setTimeout(() => { const [hx, hz] = motion.heroPos(performance.now()); fx.sparkles(new THREE3.Vector3(hx + 0.5, (world.heroLift ?? phys.y) + 1.4, hz + 0.5), 40, 0xffe27a, 0.4); }, 900); break;
    case 'dip': fountNow('toiletDip', { url: item ? item.url : null }); for (const t of [0.6, 1.0, 1.4]) setTimeout(() => fx.splashStuds(wet(), 5, 0.7, { tint: 0x7a6a3a }), t * 1000); break;
    // kicked: your kick, and it rattles; what comes up out of a sink's drain
    case 'klunk': fountNow('kick'); setTimeout(() => b.sinkShake(x, y, 0.6, 0.04, m.what), 380); break;
    case 'pudding': setTimeout(() => { for (let i = 0; i < 4; i++) setTimeout(() => fx.splashStuds(wet(), 12, 1.4, { tint: 0x1a1a1a }), i * 180); }, 380); break;
    case 'washer': setTimeout(() => fx.vapor(wet(), 0xf0d8f0, 1.6), 380); break;
    case 'flupp': setTimeout(() => fx.splashStuds(wet(), 18, 1.6, { tint: 0x6b5233 }), 380); break;
    case 'shine': setTimeout(() => fx.sparkles(wet(), 18, 0xfff2b0, 0.15), 1200); break;
    // a ring dropped down a sink's drain; or given back up out of it
    case 'ringdown': if (item) b.sinkSwallow(x, y, item.url); break;
    case 'ringback': fx.splashStuds(wet(), 8, 1.2); break;
  }
}

// ---- praying (winweb.c web_pray): begun (down on your knees, arms raised; the light that comes for how it'll go, or
// a storm gathering: brickworld.js prayBegin), then what comes of it (prayOutcome) as the prayer ends, and how you
// take it after (struck, brought low: prayAfter). The engine tells it all at once; it's played out over the prayer
// a rite at his altar (winweb.c web_ritefx), played out there if it's his (the brick dungeon: rites.js); its statues
// come alive whatever, but only on his altar (altar_jesus: they're its own)
function riteFx(m) {
  if (!renderer.brickOn || !renderer.brick || !rites.env.angelUrl) return;
  const d = (world.brickDrops || []).find((o) => o.x === m.x && o.z === m.y && o.name === 'altar' && o.item === 'altar_jesus');
  if (!d) return;
  const turn = d.turn || 0;
  const go = { mass: () => rites.mass(m.x, m.y, turn), communion: () => rites.communion(m.x, m.y, turn), alms: () => rites.alms(m.x, m.y, turn, [[m.n, null, null]]),
    confess: () => rites.confess(m.x, m.y, turn, !!m.n), offer: () => rites.offer(m.x, m.y, turn), wafer: () => rites.prayed(m.x, m.y, turn, 'wafer'),
    wine: () => rites.prayed(m.x, m.y, turn, 'wine') }[m.act];
  if (go) go().catch((e) => console.error(e));
}

// what happens at an altar (winweb.c web_altarfx), played out there (brickworld.altarFx), in its own colours: a
// sacrifice held up and laid on it (offer), then, in turn, a moment apart (the engine says it all at once): the bolt
// of fire it goes up in, and what comes of it; things landing on it in a flash; an altar turned (convert, claim:
// the old one burning away, the new rising); kicked, its god's wrath
const ALTAR_KIND = { altar_lawful: 'lawful', altar_jesus: 'lawful', altar_neutral: 'neutral', altar_chaotic: 'chaotic', altar_unaligned: 'unaligned',
  altar_high_lawful: 'lawful', altar_high_neutral: 'neutral', altar_high_chaotic: 'chaotic', altar_high_unaligned: 'unaligned' };
const altarSeq = { next: 0 };
let altarProps = []; // (a sacrifice laid on it, till it goes up)
function altarFx(m) {
  if (!renderer.brickOn || !renderer.brick) return;
  const b = renderer.brick, now = performance.now();
  const d = (world.brickDrops || []).find((o) => o.x === m.x && o.z === m.y && o.name === 'altar');
  const kind = (d && ALTAR_KIND[d.item]) || 'lawful', turn = (d && d.turn) || 0, R = d ? perchOf(d).R : 0;
  const hx = m.x + Math.sin(turn) * R, hz = m.y + Math.cos(turn) * R; // (you, stood at its front)
  const o = (d && d.offer) || [0, 64 / 80, 0], c = Math.cos(turn), sn = Math.sin(turn);
  const spot = { x: m.x + 0.5 + o[0] * c + o[2] * sn, y: STUD_H + o[1], z: m.y + 0.5 - o[0] * sn + o[2] * c }; // (its offering place)
  if (m.act === 'offer') { // (held up to the heavens, laid on it)
    const l = m.tile >= 0 ? brickItemForTile(m.tile) : null;
    fountNow('sacrifice');
    hero3d.riteHold = { R: (l && l.url) || null };
    setTimeout(() => { hero3d.riteHold = { R: null }; if (l && l.url) altarProps = [{ url: l.url, ...spot, upright: !!l.upright }]; }, 2000);
    setTimeout(() => { hero3d.riteHold = null; }, FOUNT.sacrifice.T * 1000);
    setTimeout(() => { altarProps = []; }, 9000); // (whatever comes of it)
    altarSeq.next = now + 2500;
    return;
  }
  if (m.act === 'water') { // (blessed by the prayer: when it's done, the potions on it glowing)
    const P = hero3d.prayer;
    setTimeout(() => b.altarFx(m.x, m.y, 'water', kind, m.n, hx, hz, spot), P ? Math.max(0, P.t0 + PRAY_OUTCOME * 1000 - now) : 0);
    return;
  }
  if (m.act === 'ascend') { setTimeout(() => ascension(m, kind, hx, hz, spot), Math.max(0, altarSeq.next - now)); return; }
  const at = Math.max(now, altarSeq.next);
  altarSeq.next = at + (m.act === 'consume' ? 1400 : m.act === 'claim' || m.act === 'convert' ? 2600 : 1100);
  if (m.act === 'claim' || m.act === 'convert') b.convertAltar(m.x, m.y, (at - now) / 1000 + 0.6); // (before the map turns it: its old model kept a while)
  if (m.act === 'claim') fountNow('place');
  setTimeout(() => {
    if (m.act === 'consume') altarProps = [];
    if ((m.act === 'wrath' && m.n) || m.act === 'reject') fx.shake = { t0: performance.now(), amp: 0.6 };
    b.altarFx(m.x, m.y, m.act, kind, m.n, hx, hz, spot);
  }, at - now);
}

// the Amulet of Yendor offered (the engine's "altar" "ascend"; the game ends straight after: its end held till
// this is done): your own god's altar, an invisible choir (the Agnus Dei) and a column of radiance down onto you,
// your arms raised, and you rising up into it, the view following, all gone to white; another god's, orange smoke
// about you, and you gone into it. Letterboxed, the view slowly round you (cutsceneCamera)
const ASCEND_T = 12, ASCEND_RISE = 3.5, ASCEND_WHITE = 9;
function ascension(m, kind, hx, hz, spot) {
  const now = performance.now(), win = !!m.n;
  hero3d.ascend = { t0: now, win, end: now + (win ? ASCEND_T : 7) * 1000 };
  renderer.brick.altarFx(m.x, m.y, 'ascend', kind, m.n, hx, hz, spot);
  if (win) { ambience.set('mass', true); fountNow('orans'); }
  cutscene = { t0: now, T: win ? ASCEND_T + 2 : 7.5, up: null, focus: [hx + 0.5, STUD_H + 0.75, hz + 0.5], side: [0, 1], lift: (t) => ascendLift(t) };
  letterbox(true);
  const veil = document.createElement('div'); // (all gone to white; or to the smoke)
  Object.assign(veil.style, { position: 'fixed', inset: '0', background: win ? '#fffdf4' : '#3a1a08', opacity: '0', transition: `opacity ${win ? 2.5 : 1.5}s ease`, pointerEvents: 'none', zIndex: '45' });
  document.body.appendChild(veil);
  setTimeout(() => { veil.style.opacity = '1'; }, (win ? ASCEND_WHITE : 4.5) * 1000);
  setTimeout(() => { veil.style.opacity = '0'; setTimeout(() => veil.remove(), 2600); }, (win ? ASCEND_T + 1.5 : 7.5) * 1000);
}
// (how far up you've risen, t s into it; and how much of you there is still, going into the smoke)
function ascendLift(t) { const a = hero3d.ascend; if (!a || !a.win) return 0; const u = Math.max(0, t - ASCEND_RISE); return u * u * 0.18; }
function ascendFade(now) { const a = hero3d.ascend; if (!a || a.win) return undefined; const t = (now - a.t0) / 1000; return Math.max(0, Math.min(1, 1 - (t - 2.5) / 2)); }

// a contribution to a temple priest (winweb.c web_priestfx): your gold tossed to him (none, given nothing), and
// what comes of it (brickworld.priestFx)
function priestFx(m) {
  if (!renderer.brickOn || !renderer.brick) return;
  const b = renderer.brick, now = performance.now(), [hx, hz] = motion.heroPos(now);
  const you = { x: hx + 0.5, z: hz + 0.5 }, him = { x: m.x + 0.5, z: m.y + 0.5 };
  const coin = (brickBuilt('_coin') || {}).url, n = m.act === 'donate' ? [0, 3, 5, 8, 10][m.n] || 0 : 0;
  if (m.act === 'donate' && n && coin) {
    fountNow('alms');
    b.tossCoins({ x: you.x, y: STUD_H + 0.95, z: you.z }, { x: him.x, y: STUD_H + 0.9, z: him.z }, n, coin).then(() => b.priestFx(m.act, m.n, him, you));
  } else setTimeout(() => b.priestFx(m.act, m.n, him, you), m.act === 'blessing' ? 2200 : 0);
}

function prayFx(m) {
  if (!renderer.brickOn || !renderer.brick) return;
  const b = renderer.brick, now = performance.now();
  if (m.act === 'begin') {
    const [hx, hz] = motion.heroPos(now), pp = statuePerch(now); // (at an altar: on its step, before it, where you're drawn)
    const px = hx + 0.5 + (pp ? pp.dx : 0), pz = hz + 0.5 + (pp ? pp.dz : 0);
    fountNow('prayer');
    hero3d.prayer = { t0: now, x: px, z: pz, st: b.prayBegin(px, pz, m.n) };
    return;
  }
  const P = hero3d.prayer && now - hero3d.prayer.t0 < PRAY_AFTER * 1000 ? hero3d.prayer : null;
  const [hx, hz] = motion.heroPos(now), x = P ? P.x : hx + 0.5, z = P ? P.z : hz + 0.5;
  setTimeout(() => {
    b.prayOutcome(x, z, m.act, m.n, P ? P.st : {});
    if (m.act === 'lessons') fx.shake = { t0: performance.now(), amp: 0.75 }; // (a god's voice: the world shaken)
  }, P ? Math.max(0, P.t0 + PRAY_OUTCOME * 1000 - now) : 0);
  const after = prayAfter(m.act);
  if (after) setTimeout(() => fountNow(after), P ? Math.max(0, P.t0 + PRAY_AFTER * 1000 - now) : 600);
}

// ---- the Lady of the Lake (a long sword dipped: Excalibur), as a cutscene: the view taken from you to a
// slow turn about the fountain, letterboxed; your dip held, the sword in the water, while her arm rises out
// of it to the sword and blesses it (brickworld.js ladyOfTheLake), or (not lawful) a freezing mist wraps it;
// and then the fountain goes as a dried-up one does (fountainDries), and the view's given back
let cutscene = null; // {t0, T, focus: [x, y, z] (the fountain's middle), side: [x, z] (the way you are from it)}
function ladyOfTheLake(m) {
  const now = performance.now(), pp = statuePerch(now), [hx, hz] = motion.heroPos(now);
  const yaw = pp && pp.k > 0.5 ? pp.yaw : doll.yaw;
  const x = hx + 0.5 + (pp ? pp.dx : 0), z = hz + 0.5 + (pp ? pp.dz : 0), feet = (world.heroLift ?? phys.y) + (pp ? pp.lift : 0);
  const at = new THREE3.Vector3(x + Math.sin(yaw) * FOUNT_REACH, feet - FOUNT_DOWN, z - Math.cos(yaw) * FOUNT_REACH);
  const T = m.good ? LADY_T : LADY_T - 1.6;
  if (hero3d.fount && hero3d.fount.act === 'dip') Object.assign(hero3d.fount, { freezeAt: 0.85, freezeUntil: now + (T - 1.1) * 1000 });
  const sd = walk.perch && walk.perch.side;
  // (blessed: the sword in your hand becomes Excalibur as her light bursts about it; and once the fountain's
  // gone and you've landed, you hold it high overhead a while, golden light glinting off it)
  const exc = brickItemByName('Excalibur'), landed = T + 0.2 + DRY_GREY + DRY_SIT + 0.7;
  if (m.good && exc) {
    setTimeout(() => { if (hero3d.fount && hero3d.fount.act === 'dip') hero3d.fount.url = exc.url; }, 2.1 * 1000);
    hero3d.raise = { t0: now + landed * 1000, T: RAISE_T, url: exc.url, glint: 0 };
  }
  cutscene = { t0: now, T: m.good ? landed + RAISE_T + 0.4 : T + DRY_GREY + DRY_SIT + 2, up: m.good ? landed : null, focus: [m.x + 0.5, STUD_H + 0.75, m.y + 0.5], side: sd ? [sd.wx, sd.wz] : [0, 1] };
  letterbox(true);
  const arm = brickItemByName('_lady of the lake');
  if (renderer.brickOn && renderer.brick) renderer.brick.ladyOfTheLake(at, yaw, arm && arm.url, !!m.good);
  fountainDries(m.x, m.y, T + 0.2);
}
// holding Excalibur high, now: how far up (0..1: up fast, held, and down again), or 0; and golden light
// glinting off it as you hold it up (you: where your feet are)
const RAISE_T = 3.2, GEM_RAISE_T = 2.6; // (s: Excalibur held high; a gem held up)
function raiseAct(now) {
  const r = hero3d.raise;
  if (!r) return 0;
  const t = (now - r.t0) / 1000;
  if (t < 0) return 0;
  if (t > r.T) { hero3d.raise = null; return 0; }
  return ease(t / 0.4) * ease((r.T - t) / 0.5);
}
function raiseGlint(now, x, feet, z, yaw) {
  const r = hero3d.raise;
  if (!r || !renderer.brickOn || !renderer.brick) return;
  const t = (now - r.t0) / 1000;
  while (r.glint < 3 && t >= 0.45 + r.glint * 0.6) {
    r.glint++;
    const [out, up] = r.tip || [0.3, 1.75]; // (where it glints: a sword, its blade's tip; a gem, the fist holding it)
    renderer.brick.fx.sparkles(new THREE3.Vector3(x + Math.sin(yaw) * out, feet + up, z - Math.cos(yaw) * out), r.tip ? 18 : 30, r.glint === 2 ? 0xffe27a : 0xffc21a, r.tip ? 0.15 : 0.3);
  }
}
// the cutscene's view, over the game's own (eased in, and back out): slowly round the fountain, low, at you
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
function cutsceneCamera(now) {
  const c = cutscene;
  if (!c) return;
  const t = (now - c.t0) / 1000;
  if (t > c.T) { cutscene = null; letterbox(false); return; }
  if (!c.out && c.T - t < 0.9) { c.out = true; letterbox(false); } // (the bars going as the view comes back)
  const w = ease(t / 0.9) * ease((c.T - t) / 0.9);
  const ang = Math.atan2(c.side[1], c.side[0]) + 1.3 + 0.08 * t, k = c.up != null ? ease((t - c.up) / 0.8) : 0; // (k: drawn back and up a little, to the sword held high)
  const up = c.lift ? c.lift(t) : 0; // (following you up: ascending)
  const eye = [c.focus[0] + Math.cos(ang) * (2.1 + 0.6 * k + 0.5 * up), c.focus[1] + 0.4 + 0.2 * k + 0.55 * up, c.focus[2] + Math.sin(ang) * (2.1 + 0.6 * k + 0.5 * up)];
  const tgt = [c.focus[0] + c.side[0] * 0.5, c.focus[1] - 0.1 + 0.5 * k + 0.9 * up, c.focus[2] + c.side[1] * 0.5];
  const d = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]];
  const vy = Math.atan2(d[0], -d[2]), vp = Math.atan2(d[1], Math.hypot(d[0], d[2]));
  cam.eye = roundAbout(c.focus, cam.eye, eye, w);
  cam.vyaw += Math.atan2(Math.sin(vy - cam.vyaw), Math.cos(vy - cam.vyaw)) * w;
  cam.vpitch += (vp - cam.vpitch) * w;
}
// from a to b (eyes, [x, y, z]) by w, going round focus rather than straight across: by angle, distance and
// height about it (so never through what's there: a fountain's walls)
function roundAbout(focus, a, b, w) {
  const pa = [Math.atan2(a[2] - focus[2], a[0] - focus[0]), Math.hypot(a[0] - focus[0], a[2] - focus[2]), a[1]];
  const pb = [Math.atan2(b[2] - focus[2], b[0] - focus[0]), Math.hypot(b[0] - focus[0], b[2] - focus[2]), b[1]];
  const ang = pa[0] + Math.atan2(Math.sin(pb[0] - pa[0]), Math.cos(pb[0] - pa[0])) * w, r = pa[1] + (pb[1] - pa[1]) * w, y = pa[2] + (pb[2] - pa[2]) * w;
  return [focus[0] + Math.cos(ang) * r, y, focus[2] + Math.sin(ang) * r];
}
// black bars, top and bottom, sliding in for a cutscene
function letterbox(on) {
  let bars = document.querySelectorAll('.letterbox');
  if (!bars.length) {
    for (const edge of ['top', 'bottom']) {
      const b = document.createElement('div');
      b.className = 'letterbox';
      Object.assign(b.style, { position: 'fixed', left: '0', right: '0', [edge]: '0', height: '0', background: '#000', zIndex: '40', pointerEvents: 'none', transition: 'height 0.8s ease' });
      document.body.appendChild(b);
    }
    bars = document.querySelectorAll('.letterbox');
    void bars[0].offsetHeight;
  }
  bars.forEach((b) => { b.style.height = on ? '11vh' : '0'; });
}

// a fountain dried up (seen): its water greys, it stands a moment, and it comes apart brick by brick
// (brickworld.js fountainDry); should you be up on its rim, you jump down as it goes
function fountainDries(x, y, delay = 0) {
  // (it's floor there now, whatever's remembered of it: stood on, the game draws you there, not its floor, and
  // the fountain remembered under you would have you hop back up onto a rim that's gone)
  const i = y * world.w + x, c = world.cells[i];
  world.floorMem[i] = CM.room;
  if (c && c.bc === CM.fountain) c.bc = CM.room;
  if (c && (c.k === 'c' || c.k === 't') && c.c === CM.fountain) c.c = CM.room;
  world.rebuild();
  world.dirty = true;
  const it = brickItemByName('fountain');
  if (!it || !renderer.brickOn || !renderer.brick) return;
  const wait = renderer.brick.fountainDry(x, y, it.url, it.bricks, delay) || 0; // (dug into: gushing first; the Lady of the Lake first)
  setTimeout(() => {
    const p = walk.perch;
    if (p && p.x === x && p.z === y && p.phase !== 'off')
      Object.assign(p, { phase: 'off', t0: performance.now(), out: p.side, dest: [p.side.wx * 0.42, p.side.wz * 0.42], moved: true });
  }, (wait + DRY_GREY + DRY_SIT) * 1000);
}

// drinking from a fountain, or dipping something in it, now: {act, t (s in)}, or null
// on stairs: down them, stood on a step in their hole, at the square's middle; up them, on whichever step you're on.
// A flight up (tools/build_roster.py stairs_up): four steps, a 1x4 brick each, a quarter of the square deep, rising
// a brick (STAIR_RISE) at a time from its front (the model's +Z, turned (render.js, world.backToWall) away from its
// wall) to its back. Climbed only from the front (stairFront: squareIs keeps you out from the sides and the back);
// how high you stand: the highest step under your body (BODY_R each way), and under it a little ahead the way
// you're going (STAIR_AHEAD), so you're up each step as your feet reach it, never into its riser; eased, up quick
const STAIR_STEP = { down: -0.4 }, STAIR_RISE = 0.3, STAIR_AHEAD = 0.12;
function upStairAt(x, z) { const c = renderer.brickOn && world.classAt(x, z); return !!c && c.cmap === CM.upstair; }
function stairFront(x, z) { const t = world.backToWall(x, z); return { x: x + Math.round(Math.sin(t)), z: z + Math.round(Math.cos(t)) }; }
function stairHeight(px, pz, hx, hz) { // (the flight's top at point (px, pz), squares' units: 0 off it, or a flight you're
  // not on (you at (hx, hz)) nor coming onto from its front: up against its side or its back, not stood up on it)
  const x = Math.round(px), z = Math.round(pz);
  if (!upStairAt(x, z)) return 0;
  const sx = Math.round(hx), sz = Math.round(hz);
  if (sx !== x || sz !== z) { const f = stairFront(x, z); if (f.x !== sx || f.z !== sz) return 0; }
  const t = world.backToWall(x, z), dx = px - x, dz = pz - z;
  const lz = dx * Math.sin(t) + dz * Math.cos(t); // (along the flight: +0.5 its front, -0.5 its back)
  return STAIR_RISE * Math.min(4, Math.max(1, 1 + Math.floor((0.5 - lz) / 0.25)));
}
function stairStep(dt, hx, hz) {
  const c = world.classAt(Math.round(hx), Math.round(hz));
  const prev = hero3d.stairAt || [hx, hz], mx = hx - prev[0], mz = hz - prev[1], ml = Math.hypot(mx, mz);
  hero3d.stairAt = [hx, hz];
  const [ax, az] = ml > 1e-4 ? [mx / ml, mz / ml] : [0, 0]; // (the way you're going)
  let want = c && renderer.brickOn && c.cmap === CM.dnstair ? STAIR_STEP.down : 0;
  for (let i = -2; i <= 2; i++) // (the body's footprint, and it pushed on a little ahead)
    for (let j = -2; j <= 2; j++)
      for (const k of [0, 1]) want = Math.max(want, stairHeight(hx + (i / 2) * BODY_R + ax * STAIR_AHEAD * k, hz + (j / 2) * BODY_R + az * STAIR_AHEAD * k, hx, hz));
  const cur = hero3d.stairY || 0;
  hero3d.stairY = cur + (want - cur) * Math.min(1, dt * (want > cur ? 22 : 9));
  return hero3d.stairY;
}
// praying: how far down onto your knees you are, now (minifig-anim.js FOUNT.prayer drop)
function kneelDrop(now) { const a = fountAct(now); return a ? fountKey(a.act, 'drop', a.t) : 0; } // (and the rites': Communion, confession, a genuflection)
function fountAct(now) {
  const f = hero3d.fount;
  if (!f) return null;
  let t = (now - f.t0) / 1000;
  if (f.freezeUntil) t = now < f.freezeUntil ? Math.min(t, f.freezeAt) : f.freezeAt + (now - f.freezeUntil) / 1000; // (held there: the Lady of the Lake)
  if (t >= FOUNT[f.act].T) { hero3d.fount = null; return null; }
  return { act: f.act, t };
}
// ...and its water broken as it goes, out in front of you (you: where your feet are, which way you face)
function fountSplash(now, x, y, z, yaw) {
  const f = hero3d.fount, a = fountAct(now);
  if (!a || !renderer.brickOn || !renderer.brick) return;
  const cues = FOUNT_SPLASH[a.act];
  while (f.fired < cues.length && a.t >= cues[f.fired][0]) {
    const [, n, up, tint] = cues[f.fired++];
    renderer.brick.fx.splashStuds(new THREE3.Vector3(x + Math.sin(yaw) * FOUNT_REACH, y - FOUNT_DOWN, z - Math.cos(yaw) * FOUNT_REACH), n, up, tint ? { tint } : {});
  }
  const p = walk.perch; // (a bath: the water broken as you dive in and jump out, at the fountain's middle; dripping off you, shaking)
  while (a.act === 'bath' && p && f.bathFired < BATH_SPLASH.length && a.t >= BATH_SPLASH[f.bathFired][0]) {
    const [, at, n, up] = BATH_SPLASH[f.bathFired++], g = world.heroLift ?? phys.y, w = (p.pr ? STUD_H + p.pr.H : y) - FOUNT_DOWN;
    renderer.brick.fx.splashStuds(at === 'mid' ? new THREE3.Vector3(p.x + 0.5, g + w, p.z + 0.5) : new THREE3.Vector3(x, y + 0.6, z), n, up,
      at === 'mid' ? {} : { floor: y, ring: false });
  }
}
// this water's no good: a murky puff about you, once; bad breath: a faint green wisp off your mouth every
// second or so, the way you face, for BREATH_TURNS turns (the game keeps no such state: the monsters it scared
// stay scared till each regains its courage); a shiver: frost glinting off you
const BREATH_TURNS = 150;
function heroWisps(now, x, y, z, yaw, mouth) { // (mouth: where yours is, as drawn: minifig-anim.js mouthPoint)
  if (!renderer.brickOn || !renderer.brick) return;
  const fx = renderer.brick.fx, H = motion.heroHeight();
  if (hero3d.puff) { fx.cursePuff(new THREE3.Vector3(x, y + H * 0.4, z)); hero3d.puff = null; }
  const b = hero3d.breath;
  if (b) {
    if (!game.playing || ((ui.stat && ui.stat.turn) || 0) >= b.until) hero3d.breath = null;
    else if (now - b.last > 950) { b.last = now; fx.breath(mouth ? new THREE3.Vector3(...mouth) : new THREE3.Vector3(x + Math.sin(yaw) * 0.1, y + H * 0.66, z - Math.cos(yaw) * 0.1), yaw); }
  }
  const a = fountAct(now), f = hero3d.fount;
  if (a && a.act === 'shiver' && a.t > 0.25 && a.t < 1.6 && now - (f.frostT || 0) > 160) { f.frostT = now; fx.frost(new THREE3.Vector3(x, y + H * 0.4, z)); }
}
// poisoned: a purple haze about you, specks drifting up off you; a while after contaminated water, and all
// the while you're sick with it (food poisoning, a terminal illness: the status line's FoodPois, TermIll)
const HAZE_T = 4.0; // s
function heroHaze(now, x, y, z) {
  const cond = (ui.stat && ui.stat.cond) || [];
  if (!hero3d.haze && game.playing && cond.some((c) => c === 'FoodPois' || c === 'TermIll')) hero3d.haze = { t0: now, T: 1e9, last: 0, sick: true };
  const h = hero3d.haze;
  if (!h) return;
  if (h.sick && !cond.some((c) => c === 'FoodPois' || c === 'TermIll')) { hero3d.haze = null; return; } // (cured)
  if (now - h.t0 > h.T * 1000) { hero3d.haze = null; return; }
  if (now - h.last < 80 || !renderer.brickOn || !renderer.brick) return;
  h.last = now;
  renderer.brick.fx.haze(new THREE3.Vector3(x, y, z), motion.heroHeight() * 0.9, h.sick ? 8 : 1 - (now - h.t0) / (h.T * 1000) < 0.3 ? 6 : 12);
}

// ---- things dropped fall. What newly lies at your feet (dropped), or where a monster has just
// died (its corpse, its things), appears in the air just over whoever dropped it and falls there,
// knocking against you, a statue... and comes to rest as it lies (throwfx.js drop). How high it
// starts: dropTop, from the dropper's own model (a monster's measured as drawn: modelTop), so
// nothing ever starts inside the one it fell from, whatever it looks like.
const gone = []; // monsters gone: {x, z, top, t}
const mobModel = new Map(); // monster id -> {url, lift}: its brick model, as drawn
const urlTop = new Map(); // a model's url -> its height (world units), once measured
function modelTop(url) {
  if (!urlTop.has(url) && renderer && renderer.brick) {
    urlTop.set(url, null);
    renderer.brick.model(url).then((m) => { const b = new THREE3.Box3().setFromObject(m); urlTop.set(url, (b.max.y - b.min.y) * MODEL_SCALE); }).catch(() => {});
  }
  return urlTop.get(url) ?? null;
}
function mobTop(id, size) {
  const mm = mobModel.get(id), h = mm && modelTop(mm.url);
  return h != null ? mm.lift + h : sizeHeight(size) * (world.spriteScale || 1); // (drawn as a sprite: its height)
}
function dropTop(x, z, now) {
  const h = renderer && renderer.brick && renderer.brick.heroBody;
  if (h && world.hero.x === x && world.hero.y === z) return { top: h.top + 0.08, at: { x: h.x, z: h.z } }; // (at your feet: from just over your head)
  for (const [id, m] of motion.mobs) if (m.tx === x && m.tz === z) return { top: mobTop(id, m.size) + 0.08 }; // (a monster there, letting it go)
  for (let i = gone.length - 1; i >= 0; i--) if (gone[i].x === x && gone[i].z === z && now - gone[i].t < 2500) return { top: gone[i].top + 0.08 }; // (one just killed there)
  return null;
}
const dropSeen = { level: null, counts: new Map() };
function dropFalls(list, now) {
  const counts = new Map();
  for (const d of list) { const k = `${d.x},${d.z},${d.url}`; counts.set(k, (counts.get(k) || 0) + 1); }
  const lvl = ui.stat ? `${ui.stat.dname}:${ui.stat.depth}` : null;
  if (lvl !== dropSeen.level) { dropSeen.level = lvl; dropSeen.counts = counts; return; } // (a level arrived on: all just there)
  const brick = renderer && renderer.brickOn && renderer.brick;
  if (brick) for (const [k, n] of counts) {
    if (n <= (dropSeen.counts.get(k) || 0)) continue;
    const [x, z, ...u] = k.split(','), url = u.join(',');
    if (brick.fx.isIncoming(+x, +z, url)) continue; // (thrown, or a boulder rolled: it's on its way there)
    if (list.some((d) => d.url === url && PERCHES[d.name])) continue; // (a statue isn't dropped: one turned to stone, it's just there; nor is a fountain)
    const d = dropTop(+x, +z, now);
    if (d) brick.fx.drop(url, +x, +z, d.top, d.at);
  }
  dropSeen.counts = counts;
}

// a statue broken (dug into with a pick-axe, a force bolt...): it comes apart brick by brick
// (brickworld.js watchStatues); and should you be up on it, you jump down as it goes
function statueBreaks(list, now) {
  const lvl = ui.stat ? `${ui.stat.dname}:${ui.stat.depth}` : null;
  const broke = renderer.brick.watchStatues(list, lvl, brickItemByName);
  const p = walk.perch;
  for (const [x, z] of broke)
    if (p && p.x === x && p.z === z && p.phase !== 'off') // (straight down off the ledge, where it stood: still on its square)
      Object.assign(p, { phase: 'off', t0: now, out: p.side, dest: [p.side.wx * 0.42, p.side.wz * 0.42], moved: true });
}

// ---- standing at a statue: up on its ledge, gazing at it (perch.js; walk.perch: processMovement)
// where you're drawn, off where you are: {k, dx, dz, lift, yaw, hop, lookUp}, or null
function statuePerch(now) {
  const p = walk.perch, F = motion.free;
  if (!p || !F) return null;
  const u = (now - p.t0) / 1000;
  const fo = p.phase !== 'on' && p.phase !== 'off' ? fountAct(now) : null; // (taking a bath: in and out of its water)
  const pose = p.phase === 'on' ? hopOn(p.from, p.side, u / HOP_ON, p.pr) : p.phase === 'off' ? hopOff(p.side, p.out, p.dest, u, p.pr)
    : fo && fo.act === 'bath' ? { ...bathPath(p.side, fo.t, p.pr), lookUp: 0 } : fo && fo.act === 'sit' ? { ...sitPath(p.side, fo.t, p.pr), lookUp: 0 } : perched(p.side, p.pr);
  return { k: 1, dx: p.x + pose.x - F.x, dz: p.z + pose.z - F.z, lift: pose.lift, yaw: pose.yaw, hop: pose.hop, lookUp: pose.lookUp };
}

// ---- monsters made in brick (web/assets/brick/monsters.json, built by
// tools/build_roster.py): drawn as their minifig in place of their sprite,
// alive as the hero is (breathing, looking about, walking, swinging what
// they hold when they lunge at you), always facing you
const spitAt = new Map(); // x,y -> when a monster there last threw or spat something (its creature lunges)
const shotAt = new Map(); // x,y -> when a monster there last loosed an arrow (a minifig: drawn and let go, FOUNT.loose)
const archeryUrls = { bow: null, arrow: null }; // (a monster shooting: a bow in its hand for it, if it holds none; the arrow on its string)
const brickMons = new Map(); // tile -> {url, hold (an item's url), prims, creature, slither, lift} (each monster's own state: monStateOf)
const brickMonGods = new Map(); // `${tile}|${god}` -> the same, a priest of that god (monsters.json "aligned priest|lawful": his own figure)
const brickMonOf = (s) => (s.mob && s.mob.god && brickMonGods.get(`${s.tile}|${s.mob.god}`)) || brickMons.get(s.tile);
async function loadBrickMonsters() {
  const get = (u) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const [mons, tiles, items] = await Promise.all([get('assets/brick/monsters.built.json'), get('assets/slashem/tiles.json'), get('assets/brick/items.built.json')]);
  const tileOf = new Map((tiles.names || []).map((n, i) => [n, i]));
  archeryUrls.bow = items.bow && items.bow.url; archeryUrls.arrow = items.arrow && items.arrow.url;
  for (const [k, m] of Object.entries(mons)) { // (a priest, by his god)
    const [base, god] = k.split('|');
    if (!god || !tileOf.has(base)) continue;
    const e = { url: m.url, hold: undefined, prims: null, creature: null, slither: false, lift: 0, saddled: null, seat: 1, saddledPrims: null };
    brickMonGods.set(`${tileOf.get(base)}|${god}`, e);
    renderer.figRender.model(m.url).then((p) => { e.prims = p; }).catch((err) => console.warn('brick monster:', k, err));
  }
  (tiles.names || []).forEach((n, i) => {
    const m = mons[n];
    if (!m) return;
    const e = { url: m.url, hold: m.hold && items[m.hold] ? items[m.hold].url : undefined, prims: null, archer: !!m.archer,
      creature: m.creature, slither: m.slither, lift: m.lift || 0, saddled: m.saddled || null, seat: m.seat || 1, saddledPrims: null,
      rider: m.rider ? { ...m.rider, prims: null } : null }; // (a centaur: its man half, a figure of its own)
    brickMons.set(i, e);
    if (e.rider) renderer.figRender.model(e.rider.url).then((p) => { e.rider.prims = p; }).catch(() => {});
    if (m.saddled) renderer.figRender.model(m.saddled).then((p) => { e.saddledPrims = p; }).catch(() => {}); // (ridden: with its saddle on)
    renderer.figRender.model(m.url).then((p) => { e.prims = p; }) // (each one's animator its own: monStateOf)
      .catch((err) => console.warn('brick monster:', n, err));
  });
}
// take the brick monsters' sprites out of the list; their figures, for renderer.brickFigures
// monsters coming up out of a fountain (rise events): id -> {f: the fountain's square, t0}; where each is
// drawn while it comes (risePath), hidden till its turn (under the water)
const rising = new Map();
// a creature beside a fountain: kept out of its basin's wall, against its side (perch.js againstFountain); a
// snake leaning back on it, its back end propped up the side: [x, z] where it's drawn, the fountain's square
// if it's up against one
function fountainBeside(x, z) {
  const f = (world.brickDrops || []).find((o) => o.name === 'fountain' && Math.abs(o.x - x) < 1.6 && Math.abs(o.z - z) < 1.6);
  return f ? [f.x, f.z] : null;
}
// a snake's lean back against a fountain (radians), and half its length (squares): its head on the floor, its
// back end up against the basin's side, so its middle that far out, and that high
const LEAN = 0.45, SNAKE_HALF = 0.55, SNAKE_OUT = SNAKE_HALF * Math.cos(LEAN), SNAKE_UP = SNAKE_HALF * Math.sin(LEAN);
const leanOf = new Map(); // monster id -> how far it's leaning on a fountain now (eased)
// each brick monster's own state (by its id): its figure's animator (a walk cycle of its own, out of step with
// its kind's), where it was last drawn (moving or not), its lunges and spits
const monState = new Map();
function monStateOf(s, e, now) {
  const k = s.mob ? s.mob.id : `${s.tile}@${Math.round(s.x)},${Math.round(s.z)}`;
  let st = monState.get(k);
  if (!st || st.e !== e) {
    st = { e, anim: e.prims && e.prims.rig ? new FigureAnimator(e.prims.rig, { phase: Math.random() * 3 }) : null, last: null, lungeT0: null };
    if (st.anim) st.anim.spawn();
    monState.set(k, st);
  }
  st.seen = now;
  return st;
}
const tiltX = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
function risingAt(s, now) {
  const r = s.mob && rising.get(s.mob.id);
  if (!r) return null;
  const u = (now - r.t0) / 1000 / RISE_T;
  if (u >= 1) { rising.delete(s.mob.id); return null; }
  if (u < 0) return 'hidden';
  const e = brickMonOf(s), fd = (world.brickDrops || []).find((o) => o.x === r.f[0] && o.z === r.f[1] && PERCHES[o.name]);
  return risePath(r.f, [Math.round(s.x), Math.round(s.z)], u, e && e.creature === 'snake' ? SNAKE_OUT : 0.22, fd && fd.name !== 'fountain' ? fd.name : false); // (out of a sink's drain, a toilet's bowl)
}
function brickMonFigures(sprites, dt, now) {
  if (!brickMons.size) return [];
  for (const [k, st] of monState) if (now - st.seen > 5000) monState.delete(k); // (gone a while: forgotten)
  const out = [];
  const [hx, hz] = motion.heroPos(now);
  for (let i = sprites.length - 1; i >= 0; i--) {
    const s = sprites[i], e = s.mon && brickMonOf(s);
    if (!e || !e.prims) continue;
    if (s.mob) mobModel.set(s.mob.id, { url: e.url, lift: (s.lift || 0) + (e.lift || 0) }); // (how tall it stands: dropTop)
    sprites.splice(i, 1);
    const st = monStateOf(s, e, now); // (this monster's own: its walk, its lunges; not all of its kind's)
    const rp = risingAt(s, now);
    if (rp === 'hidden') continue;
    let sx = rp ? rp.x : s.x, sz = rp ? rp.z : s.z, slift = rp ? rp.y : s.lift || 0; // (out of a fountain: on its way)
    let lean = rp ? rp.lean || 0 : 0, leanYaw = rp ? rp.leanYaw : null;
    const fb = !rp && fountainBeside(sx, sz), ag = fb && againstFountain(fb, sx, sz, e.creature === 'snake' ? SNAKE_OUT : 0.22);
    if (ag) { sx = ag.x; sz = ag.z; lean = 1; leanYaw = ag.yaw; } // (up against a fountain: out of its wall, leaning on it)
    const lk = s.mob ? s.mob.id : s.tile, lw = (leanOf.get(lk) || 0) + (lean - (leanOf.get(lk) || 0)) * Math.min(1, dt * 6); // (each monster its own: not all of its kind)
    leanOf.set(lk, lw);
    const f = s.mob && fx.mobFX && fx.mobFX.get(s.mob.id);
    if (st.anim && f && f.kind === 'lunge' && f.t0 !== st.lungeT0) { st.lungeT0 = f.t0; st.anim.attack(); }
    const step = st.last ? [sx - st.last[0], sz - st.last[1]] : [0, 0];
    const moving = !!rp || (Math.hypot(step[0], step[1]) > 1.2 * Math.max(dt, 1 / 120) && !(f && f.kind === 'lunge')); // (going somewhere: faster than a flinch or a dodge)
    st.last = [sx, sz];
    // (facing: walking, the way it goes; standing, you; turning between, not snapping)
    const hp = statuePerch(now), ax = hx + (hp ? hp.dx : 0), az = hz + (hp ? hp.dz : 0); // (you as drawn: up on a fountain's rim, not its middle)
    const want = moving && !rp ? Math.atan2(step[0], -step[1]) : Math.atan2(ax - sx, -(az - sz));
    st.yaw = st.yaw == null ? want : st.yaw + Math.atan2(Math.sin(want - st.yaw), Math.cos(want - st.yaw)) * Math.min(1, dt * 9);
    let yaw = rp ? rp.yaw : st.yaw; // (the game's yaw: 0 looks north, -Z; out of a fountain, the way it goes)
    if (leanYaw != null && e.creature === 'snake') yaw = rp ? yaw + Math.atan2(Math.sin(leanYaw - yaw), Math.cos(leanYaw - yaw)) * lean : leanYaw;
    if (e.creature) { // (a creature: no joints, the whole of it moving: creature.js)
      const spat = spitAt.get(`${Math.round(s.x)},${Math.round(s.z)}`);
      if (spat && spat > (st.spatT0 || 0)) { st.spatT0 = spat; st.lungeAt = now / 1000; }
      if (f && f.kind === 'lunge' && f.t0 !== st.lungeT0) { st.lungeT0 = f.t0; st.lungeAt = now / 1000; }
      const local = creatureLocal(e.creature, now / 1000, { moving, lungeT: st.lungeAt ?? -1e9 });
      const L = e.creature === 'snake' ? lw : 0; // (a snake against a fountain: its back end up its side)
      const base = partMatrix(sx + 0.5, slift + STUD_H + SNAKE_UP * L, sz + 0.5, Math.PI - yaw);
      const cm = mul4(L > 0.01 ? mul4(base, tiltX(LEAN * L)) : base, local);
      out.push({ prims: e.prims, url: e.url, matrix: cm, shade: s.shade, pose: null, hold: {} });
      const r = e.rider;
      if (r && r.prims) { // (a centaur's man half: on its horse, where its neck is; shooting in the archer's stance, as you do)
        if (!st.riderAnim && r.prims.rig) st.riderAnim = new FigureAnimator(r.prims.rig, { phase: Math.random() * 3 });
        const shot = shotAt.get(`${Math.round(s.x)},${Math.round(s.z)}`);
        if (shot && shot > (st.shotT0 || 0)) { st.shotT0 = shot; st.looseAt = now / 1000; }
        const lt = st.looseAt != null ? now / 1000 - st.looseAt : 9, loosing = lt < FOUNT.loose.T, k = r.scale;
        const pose = st.riderAnim ? st.riderAnim.update(dt, { holdsR: !!e.hold || loosing, fount: loosing ? { act: 'loose', t: lt } : null }) : null;
        out.push({ prims: r.prims, url: r.url, matrix: mul4(cm, new Float32Array([k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, r.at[0], r.at[1], r.at[2], 1])), shade: s.shade, pose,
          hold: archerHold(e, loosing, lt) });
      }
      continue;
    }
    // (a naga: spitting, it leans in, arms out, and its coils lunge; moving, it slithers)
    const spat = spitAt.get(`${Math.round(s.x)},${Math.round(s.z)}`);
    if (spat && spat > (st.spatT0 || 0)) { st.spatT0 = spat; st.spitAt = now / 1000; }
    const spitting = st.spitAt != null && now / 1000 - st.spitAt < LUNGE_TIME;
    const wt = st.warnAt != null ? (now - st.warnAt) / 1000 : 9, warn = wt < 1.8 ? ease(wt / 0.3) * ease((1.8 - wt) / 0.4) : 0; // (brandishing his weapon at you: a warning)
    const shot = shotAt.get(`${Math.round(s.x)},${Math.round(s.z)}`);
    if (shot && shot > (st.shotT0 || 0)) { st.shotT0 = shot; st.looseAt = now / 1000; }
    const loosing = st.looseAt != null && now / 1000 - st.looseAt < FOUNT.loose.T;
    const pose = st.anim ? st.anim.update(dt, loosing ? { moving, holdsR: true, fount: { act: 'loose', t: now / 1000 - st.looseAt } }
      : { moving, holdsR: !!e.hold, lean: spitting ? 0.35 : 0, reach: spitting ? 0.7 : 0, raise: warn }) : null; // (shooting: into the archer's stance, and back)
    if (e.slither) {
      const m = mul4(figureMatrix(sx + 0.5, slift + e.lift, sz + 0.5, yaw), slitherLocal(now / 1000, { moving, lungeT: st.spitAt ?? -1e9 }));
      out.push({ prims: e.prims, url: e.url, matrix: m, shade: s.shade, pose, hold: { R: e.hold } });
      continue;
    }
    out.push({ prims: e.prims, url: e.url, matrix: figureMatrix(sx + 0.5, slift, sz + 0.5, yaw), shade: s.shade, pose, hold: loosing ? archerHold(e, true, now / 1000 - st.looseAt) : { R: e.hold } });
  }
  return out;
}
// what a monster holds as it shoots (FOUNT.loose, t s in): its own launcher, or a bow put in its hand for it; an arrow on
// the string from the bow's coming up to its loosing, brought onto the bow's own as it's drawn
function archerHold(e, loosing, t) {
  if (!loosing) return { R: e.hold ?? null, L: null };
  const bow = e.hold && /bow|sling/.test(e.hold) ? e.hold : archeryUrls.bow;
  return { R: bow, L: null, nock: t > NOCKED[0] && t < NOCKED[1] ? archeryUrls.arrow : undefined, nockK: nockAt(t) };
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
  cutsceneCamera(now); // (the Lady of the Lake: the view taken a while)
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
    const D = 16 * (opts.zoom ?? 1); // (zoomed: the wheel)
    cam.eye = [tx - g[0] * D, phys.y + 0.5 - g[1] * D, tz - g[2] * D];
    cam.vyaw = cam.yaw;
    cam.vpitch = p;
    return;
  }
  const sign = opts.camera === 1 ? -1 : 1;
  // (a minifig is taller than Steve: the camera stands further back, and looks over the helmet)
  const fig = !!motion.figHeight && heroH === motion.figHeight;
  const target = [tx, (world.heroLift ?? phys.y) + up + heroH * (fig ? 1.0 : 0.85), tz];
  let dist = 5.4 * Math.max(1, heroH / 1.8) * (opts.zoom ?? 1); // (zoomed: the wheel)
  let overHaze = false;
  for (let t = 0.3; t < dist; t += 0.05) {
    const p = [target[0] + f[0] * t * sign, target[1] + f[1] * t * sign, target[2] + f[2] * t * sign];
    const vx = Math.floor(p[0]), vy = Math.floor(p[1]), vz = Math.floor(p[2]);
    if (world.solidVoxel(vx, vy, vz, onRoof())) { dist = Math.max(0.3, t - 0.15); break; }
    if (p[1] < HAZE_CLEAR && world.isHaze(vx, vz)) overHaze = true;
  }
  cam.eye = [target[0] + f[0] * dist * sign, target[1] + f[1] * dist * sign, target[2] + f[2] * dist * sign];
  // (nor where the haze is near enough to be clipped by the view: over it, or right beside it)
  if (cam.eye[1] < HAZE_CLEAR)
    for (const [ox, oz] of [[0, 0], [-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]])
      if (world.isHaze(Math.floor(cam.eye[0] + ox), Math.floor(cam.eye[2] + oz))) overHaze = true;
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
const HAZE_CLEAR = 3.2; // (over the haze's billowing top, at its highest: brickworld.js HAZE_TOP 2.6, and its billow)

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

// Digging (a pick-axe or mattock applied: a wall, rock, a boulder, a statue): the hero swings
// it, again and again, as the work goes on (the engine's progress: ui.stat.dig); and once it's
// done, the weapon it took the place of is wielded again
const DIGGER = /pick-axe|mattock/;
const DIG_MSG = /^You (start|continue) (digging|hitting|chipping)|^You hit the .* with all your might|^You dig a (pit|hole)|^You make an opening|^You succeed in cutting away/;
const toolSwap = { back: null, effort: -1, swingT: 0, digT: 0 };
function digSwings(now) {
  const d = game.playing && ui.stat && ui.stat.dig;
  if (d) {
    toolSwap.digT = now;
    if (d[2] !== toolSwap.effort && now - toolSwap.swingT > ATTACK_TIME * 1100) { // (progress: a blow)
      toolSwap.swingT = now;
      CombatFX.prototype.attack.call(fx, d[0], d[1], now); // (the swing alone: the engine digs on, not waiting for it)
    }
    toolSwap.effort = d[2];
  } else toolSwap.effort = -1;
  if (toolSwap.back && game.ready && !game.mode && !modalOpen() && !d && now - toolSwap.digT > 600) {
    const w = game.inv.find((i) => i.l === toolSwap.back);
    if (w && w.w !== 'weapon') game.sendKeys('w' + toolSwap.back);
    toolSwap.back = null;
  }
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
  if (!locked()) { ui.hideCtx(); relock(); return; }
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
    else if (it) { // (what's in your hand: its menu, as the inventory's, over its hotbar slot; the mouse let go to choose)
      const r = $('#hotbar').children[ui.hotbarSel].getBoundingClientRect();
      releaseLock();
      ui.showCtx(it, r.left, r.top - 8, true);
    }
    else if (tgt && !(tgt.x === h.x && tgt.y === h.y)) game.sendLine(`C ${tgt.x} ${tgt.y} 1`);
  } else if (e.button === 1) {
    if (tgt) { game.pendingClick = tgt; game.mode = 'getpos'; game.sendKeys(';'); game.mode = 'getpos'; }
  }
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) lmbHeld = false; });
window.addEventListener('contextmenu', (e) => { if (game.playing) e.preventDefault(); });
// the mouse wheel: the camera zoomed in and out (opts.zoom: how far back it stands, behind you, before you, over you);
// out of your own eyes, rolled back out behind you, and in again, all the way, back into them
const ZOOM_MIN = 0.3, ZOOM_MAX = 2.5;
window.addEventListener('wheel', (e) => {
  if (!game.playing || anyScreen() || modalOpen() || !e.deltaY) return;
  if (opts.camera === 0) { if (e.deltaY > 0) { opts.camera = 1; opts.zoom = ZOOM_MIN; saveOpts(); } return; }
  const z = (opts.zoom ?? 1) * Math.exp(Math.max(-0.4, Math.min(0.4, e.deltaY * 0.0015)));
  if (z < ZOOM_MIN && opts.camera === 1) { opts.camera = 0; opts.zoom = ZOOM_MIN; }
  else opts.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  saveOpts();
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
  if (e.key === 'Escape' && !$('#ctxmenu').classList.contains('hidden') && !ui.inventoryOpen) { ui.hideCtx(); relock(); return; } // (an item's menu, from your hand: shut)
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
const walk = { moving: false, heading: 0, at: null, sent: [], settle: false, perch: null, bumped: false };
const freeWalk = walk;

// what's at square (x, z), walking into it: 'floor', 'climb' (blocks: stepped up onto), or
// what stops you: 'solid', 'mob', 'door' (closed), 'boulder'
function squareIs(x, z) {
  if (x < 1 || z < 0 || x >= world.w || z >= world.h) return 'solid';
  if (motion.mobAt(x, z) && !(x === walk.at.x && z === walk.at.z)) return 'mob';
  const cl = world.classAt(x, z);
  if (cl && cl.type === 'door') return 'door';
  if (upStairAt(x, z) && !(x === walk.at.x && z === walk.at.z)) { const f = stairFront(x, z); if (f.x !== walk.at.x || f.z !== walk.at.z) return 'solid'; } // (stairs up: onto them from the front, only; a bump on any other side)
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
  walk.bumped = true; // (held where you are till the engine answers: a boulder pushed moves you too)
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

// what the body is kept out of, beyond whole squares: the posts of door frames (as they stand in
// their squares: brickworld.js, render.js doorPiece) and boulders still sliding (as they're drawn);
// [x0, z0, x1, z1] in the squares' units (a square's middle at its coordinates)
const DOOR_OPEN = 30 / 80; // (half a doorway's opening, between the frame's posts)
function obstacles(F) {
  const out = [], sx = Math.round(F.x), sz = Math.round(F.z);
  for (let z = sz - 1; z <= sz + 1; z++)
    for (let x = sx - 1; x <= sx + 1; x++) {
      const c = world.classAt(x, z);
      if (!c || !(c.type === 'odoor' || c.cmap === CM.ndoor)) continue;
      const wallAt = (xx, zz) => { const n = world.classAt(xx, zz); return !!n && n.type === 'wall'; };
      const alongZ = c.cmap === CM.vodoor ? true : c.cmap === CM.hodoor ? false : wallAt(x, z - 1) || wallAt(x, z + 1);
      // (the frame: a stud deep, an eighth off the middle across the wall; a post at each end along it)
      for (const s of [-1, 1])
        out.push(alongZ ? [x, z + s * DOOR_OPEN, x + 0.25, z + s * 0.5] : [x + s * DOOR_OPEN, z, x + s * 0.5, z + 0.25]);
    }
  // (a statue's foot: its scroll corbels, a cross reaching a quarter into the squares beside it, and
  // its basin; a fountain's pool, its whole square; touched, it's hopped up onto)
  for (const o of world.brickDrops || [])
    if (PERCHES[o.name] && Math.abs(o.x - sx) <= 1 && Math.abs(o.z - sz) <= 1 && !(walk.at && o.x === walk.at.x && o.z === walk.at.z)) {
      const R = perchOf(o).OUT;
      if (o.name === 'statue') {
        const w = 20 / 80, C = 35 / 80; // (and the basin over its middle)
        out.push([o.x - w, o.z - R, o.x + w, o.z + R, o], [o.x - R, o.z - w, o.x + R, o.z + w, o], [o.x - C, o.z - C, o.x + C, o.z + C, o]);
      } else out.push([o.x - R, o.z - R, o.x + R, o.z + R, o]);
    }
  const bfx = renderer && renderer.brick && renderer.brick.boulders;
  if (bfx) for (const b of bfx.all)
    if (b.slide && b.holder.parent) {
      const h = Math.min(0.5, Math.max(b.size.x, b.size.z) / 2), cx = b.p.x - 0.5, cz = b.p.z - 0.5;
      out.push([cx - h, cz - h, cx + h, cz + h]);
    }
  return out.map(([a, b, c, d, statue]) => [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d), statue]);
}
// the clear spot in square `at` nearest `F` (the body clear of everything: obstacles), searched out from its
// middle in rings; its middle, failing all
function clearSpot(at, F) {
  const inner = 0.5 - BODY_R, fits = (x, z) => obstacles({ x, z }).every(([x0, z0, x1, z1]) => x + BODY_R <= x0 || x - BODY_R >= x1 || z + BODY_R <= z0 || z - BODY_R >= z1);
  let best = null;
  for (let i = -6; i <= 6; i++)
    for (let j = -6; j <= 6; j++) {
      const x = at.x + (i / 6) * inner, z = at.z + (j / 6) * inner;
      if (!fits(x, z)) continue;
      const d = Math.hypot(x - F.x, z - F.z);
      if (!best || d < best.d) best = { x, z, d };
    }
  return best ? { x: best.x, z: best.z } : { x: at.x, z: at.z };
}
// the body (a square BODY_R each way of its middle) out of anything it's come into: put back to just
// touching it, the shortest way out. The statue it's come up against, if one
function keepClear(F) {
  let statue = null;
  for (const [x0, z0, x1, z1, st] of obstacles(F)) {
    const px = Math.min(F.x + BODY_R - x0, x1 - (F.x - BODY_R)), pz = Math.min(F.z + BODY_R - z0, z1 - (F.z - BODY_R));
    if (px <= 0 || pz <= 0) continue;
    if (px < pz) F.x += F.x < (x0 + x1) / 2 ? -px : px;
    else F.z += F.z < (z0 + z1) / 2 ? -pz : pz;
    if (st) statue = st;
  }
  return statue;
}

function processMovement(now, dt) {
  if (!game.playing) { motion.free = null; walk.at = null; walk.sent = []; walk.perch = null; walk.bumped = false; return; }
  const sq = { x: world.hero.x, z: world.hero.y };
  if (!motion.free || !walk.at) { motion.free = { ...sq }; walk.at = { ...sq }; walk.sent = []; }
  const F = motion.free;
  walk.moving = false;
  // the engine, kept up with: the next step sent as soon as it's ready for one; and where it
  // says you are checked against where you went
  if (game.ready) {
    if (walk.bumped && !walk.sent.length) { // (the push answered: where the engine has you now, at once)
      walk.bumped = false;
      if (sq.x !== walk.at.x || sq.z !== walk.at.z) { walk.at = { ...sq }; walk.settle = true; }
    }
    if (walk.sent.length && !game.mode && !modalOpen()) {
      lastMove = now;
      game.sendKeys(walk.sent.shift());
    } else if (walk.perch && walk.perch.phase !== 'off' && Math.max(Math.abs(sq.x - walk.at.x), Math.abs(sq.z - walk.at.z)) === 1
      && walk.perch.x === walk.at.x && walk.perch.z === walk.at.z && !walk.sent.length) {
      // (moved off the statue by the engine (an attack on thin air, a step it took for you): the
      // dismount played, that way, landing where it has you)
      const p = walk.perch, d = [sq.x - walk.at.x, sq.z - walk.at.z], reach = p.pr.OUT + BODY_R + 0.02, n = Math.hypot(d[0], d[1]);
      Object.assign(p, { phase: 'off', t0: now, out: sideToward(d[0], d[1]), dest: [(d[0] / n) * reach * (n > 1 ? Math.SQRT2 : 1), (d[1] / n) * reach * (n > 1 ? Math.SQRT2 : 1)], moved: true });
    } else if (!walk.sent.length && now - lastMove > 300 && (sq.x !== walk.at.x || sq.z !== walk.at.z) && !(walk.perch && walk.perch.moved)) {
      // (all answered, and a moment gone by: it hasn't put you where you went (a step refused), or
      // it's moved you itself (travel, a trap, a teleport): where it says)
      walk.at = { ...sq }; walk.settle = true;
    }
  }
  if (Math.max(Math.abs(F.x - walk.at.x), Math.abs(F.z - walk.at.z)) > 2.5) { F.x = walk.at.x; F.z = walk.at.z; walk.settle = false; return; }
  const perchOn = (world.brickDrops || []).find((o) => o.x === walk.at.x && o.z === walk.at.z && PERCHES[o.name]), statue = !!perchOn;
  const able = game.playing && !game.mode && !modalOpen() && !anyScreen() && !game.raw && phys.climb == null && !walk.settle;
  const f = able ? (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0) : 0;
  const r = able ? (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0) : 0;
  // a statue's square: a hop up onto its ledge on the side you came in by; up there till you go,
  // then round the ledge and a jump off the way you go (each timed: perch.js); you're at its middle
  if (walk.perch && (walk.perch.x !== walk.at.x || walk.perch.z !== walk.at.z)) walk.perch = null; // (moved off it by the engine)
  // (put on a statue's square by the engine (crawled out of a pool onto it, say): up onto its rim from where you
  // are, not walked into its middle first, through it)
  if (walk.settle && statue) walk.settle = false;
  // (once begun, the perch has you till it's done: up, stood there, round and off, input or no; even
  // should the statue drop out of the floor's list a moment while you stand on it)
  if ((statue || walk.perch) && !walk.settle) {
    const at = walk.at, t = (now - (walk.perch ? walk.perch.t0 : now)) / 1000;
    const front = perchOn && (perchOn.name === 'sink' || perchOn.name === 'toilet' || perchOn.name === 'altar') ? { wx: Math.round(Math.sin(perchOn.turn || 0)), wz: Math.round(Math.cos(perchOn.turn || 0)) } : null; // (a sink, a toilet: stood at its front)
    if (!walk.perch) walk.perch = { phase: 'on', t0: now, x: at.x, z: at.z, from: [F.x - at.x, F.z - at.z], side: front || sideToward(F.x - at.x, F.z - at.z), pr: perchOf(perchOn) };
    const p = walk.perch;
    F.x = at.x; F.z = at.z;
    motion.freeMoving = false;
    if (p.phase === 'on' && t >= HOP_ON) p.phase = 'up';
    if (p.phase === 'up' && (f || r)) { // (off, the way you go: the square there, if you can go there)
      const [fx1, fz1] = forward();
      const vx = fx1 * f - fz1 * r, vz = fz1 * f + fx1 * r;
      const d = OCT[((Math.round(Math.atan2(vz, vx) / (Math.PI / 4)) % 8) + 8) % 8];
      const k = squareIs(at.x + d[0], at.z + d[1]);
      if (k === 'floor' || k === 'climb') {
        const reach = p.pr.OUT + BODY_R + 0.02, n = Math.hypot(d[0], d[1]);
        Object.assign(p, { phase: 'off', t0: now, out: sideToward(d[0], d[1]), dest: [(d[0] / n) * reach * Math.SQRT2 ** (n > 1 ? 1 : 0), (d[1] / n) * reach * Math.SQRT2 ** (n > 1 ? 1 : 0)] });
      } else if (k !== 'solid') bump(k, at.x + d[0], at.z + d[1], now);
    }
    if (p.phase === 'off' && t >= offTime(p.side, p.out)) { // (landed: just into the next square; that's the move)
      F.x = at.x + p.dest[0]; F.z = at.z + p.dest[1];
      walk.perch = null;
      if (p.moved) walk.at = { x: Math.round(F.x), z: Math.round(F.z) }; // (the engine moved you: already there)
      else crossed([Math.sign(Math.round(F.x) - at.x), Math.sign(Math.round(F.z) - at.z)]);
    }
    return;
  }
  // settling: walked back into your square (the engine put you there)
  if (walk.settle) {
    const inner = 0.5 - BODY_R;
    const tx = Math.max(walk.at.x - inner, Math.min(walk.at.x + inner, F.x));
    const tz = Math.max(walk.at.z - inner, Math.min(walk.at.z + inner, F.z));
    const dx = tx - F.x, dz = tz - F.z, d = Math.hypot(dx, dz);
    if (d > 1e-3) {
      const st = Math.min(d, FREE_SPEED * dt);
      F.x += (dx / d) * st; F.z += (dz / d) * st;
      walk.moving = true; walk.heading = Math.atan2(dx, -dz);
    } else walk.settle = false;
    keepClear(F);
    // (kept from getting there: the way in blocked by a statue's foot reaching into the square, say. Not stuck
    // there for good, input locked: a moment's try, then set down at the clear spot in it nearest you)
    if (walk.settle) {
      const left = Math.hypot(tx - F.x, tz - F.z);
      if (walk.settleBest === undefined || left < walk.settleBest - 1e-3) { walk.settleBest = left; walk.settleT = now; }
      else if (now - walk.settleT > 400) { Object.assign(F, clearSpot(walk.at, F)); walk.settle = false; }
    }
    if (!walk.settle) walk.settleBest = undefined;
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
  const solidAt = (x, z) => {
    if (walk.bumped && (x !== walk.at.x || z !== walk.at.z)) return 'solid'; // (a push not yet answered: stay put)
    const k = squareIs(x, z); return k === 'floor' || k === 'climb' ? null : k;
  };
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
  const st = keepClear(F);
  if (st && !walk.sent.length && !walk.bumped) { // (walked up against a statue's foot: that's the step onto it; up you hop)
    // (heading for it, or held up by it, whichever way you were going: its foot reaching into the square
    // beside it never leaves you stuck there, up against it, it's always up onto it or past it)
    const d = [st.x - walk.at.x, st.z - walk.at.z], want = FREE_SPEED * dt, got = Math.hypot(F.x - ox, F.z - oz);
    if (Math.max(Math.abs(d[0]), Math.abs(d[1])) === 1 && ((vx * d[0] + vz * d[1]) / Math.hypot(d[0], d[1]) > 0.3 || got < want * 0.5)) {
      crossed(d); motion.freeMoving = walk.moving = true; return;
    }
  }
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
    digSwings(t);
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
    if (renderer.brick) { // (the hero's body, for things falling onto it: brickworld.colliders)
      const [hx, hz] = motion.heroPos(t), pp = statuePerch(t), lift = (world.heroLift ?? phys.y) + (pp ? pp.lift : 0);
      renderer.brick.heroBody = game.playing ? { x: hx + 0.5 + (pp ? pp.dx : 0), z: hz + 0.5 + (pp ? pp.dz : 0), y0: lift, top: lift + motion.heroHeight() } : null;
    }
    if (game.playing && renderer.brickOn && renderer.brick) { statueBreaks(world.brickDrops || [], t); dropFalls(renderer.brickItems, t); }
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
      if (walk.perch && walk.perch.side && renderer.brick) renderer.brick.setFountainSide(walk.perch.x, walk.perch.z, walk.perch.side); // (what lies on it: on its rim where you stand)
      const sw = heroSwim(t), sink = sw ? 0 : heroSink(dt, t, hx, hz, !!pp); // (in a pool: sunk in it, to the waist; falling in, crawling out)
      // (riding: the steed under you, saddled, your way, trotting as you go; you on its saddle, bobbing with it)
      const steed = !sw && !pp ? riddenSteed() : null, ground = world.heroLift ?? phys.y, going = motion.heroRemaining(t) > 0;
      const m = steed ? figureMatrix(hx + 0.5, ground + steed.seat - 28 / 80 + (going ? 0.025 * Math.abs(Math.sin(t / 1000 * 9)) : 0), hz + 0.5, doll.yaw)
        : sw ? figureMatrix(sw.x + 0.5, (world.heroLift ?? phys.y) + sw.y, sw.z + 0.5, sw.yaw ?? doll.yaw)
        : pp ? figureMatrix(hx + 0.5 + pp.dx, (world.heroLift ?? phys.y) + pp.lift - kneelDrop(t) + (hero3d.ascend ? ascendLift((t - hero3d.ascend.t0) / 1000) : 0), hz + 0.5 + pp.dz, pp.k > 0.5 ? pp.yaw : doll.yaw) // (at an altar, knelt; ascending)
        : figureMatrix(hx + 0.5, (world.heroLift ?? phys.y) - sink - kneelDrop(t) + stairStep(dt, hx, hz), hz + 0.5, doll.yaw); // (praying: down on your knees; on stairs, on a step)
      if (pp) fountSplash(t, hx + 0.5 + pp.dx, (world.heroLift ?? phys.y) + pp.lift, hz + 0.5 + pp.dz, pp.k > 0.5 ? pp.yaw : doll.yaw);
      heroWisps(t, hx + 0.5 + (pp ? pp.dx : 0), (world.heroLift ?? phys.y) + (pp ? pp.lift : -sink), hz + 0.5 + (pp ? pp.dz : 0), pp && pp.k > 0.5 ? pp.yaw : doll.yaw, pose ? mouthPoint(m, pose) : null);
      heroHaze(t, sw ? sw.x + 0.5 : hx + 0.5 + (pp ? pp.dx : 0), (world.heroLift ?? phys.y) + (sw ? sw.y : pp ? pp.lift : -sink), sw ? sw.z + 0.5 : hz + 0.5 + (pp ? pp.dz : 0));
      raiseGlint(t, hx + 0.5 + (pp ? pp.dx : 0), (world.heroLift ?? phys.y) + (pp ? pp.lift : 0), hz + 0.5 + (pp ? pp.dz : 0), pp && pp.k > 0.5 ? pp.yaw : doll.yaw); // (something held high: glinting)
      const steedFig = steed ? [{ prims: steed.saddledPrims || steed.prims, url: steed.saddled || steed.url, shade: 1, pose: null, hold: {},
        matrix: mul4(partMatrix(hx + 0.5, ground, hz + 0.5, Math.PI - doll.yaw), creatureLocal(steed.creature, t / 1000, { moving: going, lungeT: -1e9 })) }] : [];
      renderer.brickFigures = [{ prims: hero3d.prims, url: hero3d.url, matrix: m, shade: 1, pose, hold, skip: skipped(hold), fade: ascendFade(t) }, ...steedFig, // (you first: the hero, to the brick world; going into the smoke)
        // (for the block levels' renderer, brick.js; the brick dungeon's hangs them on the hands itself)
        ...(rig && pose ? heldEntries(hold, rig, m, { R: pose.handR || pose.armR, L: pose.handL || pose.armL, body: pose.body }) : [])];
    } else renderer.brickFigures = [];
    renderer.brickFigures.push(...brickMonFigures(sprites, dt, t)); // (King Skelly...)
    if (renderer.brick) { // (a rite at his altar: its statues alive, what's set down or tossed; called off if you've gone)
      if (rites.busy && game.playing && (world.hero.x !== rites.busy.ax || world.hero.y !== rites.busy.az)) rites.cancel();
      renderer.brickFigures.push(...rites.figures(dt));
      rites.step();
      renderer.brick.setProps(altarProps.length ? rites.props.concat(altarProps) : rites.props);
    }
    // first person: your own brick arm, and what it holds, in the corner of the
    // view; fighting with two weapons, your left one too, in the other corner
    const fpOn = !!pose && !!rig && game.playing && opts.camera === 0 && !cutscene && opts.playerModel === 'model' && !anyScreen() && !(ui.stat && ui.stat.poly);
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

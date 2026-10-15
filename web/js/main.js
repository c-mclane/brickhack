// NetHack 3D client: networking, game state, controls, camera, main loop.
import { Renderer } from './render.js';
import { World } from './world.js';
import { UI, setAtlas, itemActions, SLOT_LETTERS, tileIcon } from './ui.js';
import { createChess, pieceName } from './chess.js';
import { CM, cmapTile, wallTile, setCmap, setCmapBase, WALL_H, setBlockHeights } from './terrain.js';
import { Motion } from './motion.js';
import { BlockWorld, BLOCKS, BUILD_LIMIT, breakTime, minedAs } from './blocks.js';
import { buildTextures } from './textures.js';
import { ACTION_GROUPS, recommend } from './actions.js';
import { CombatFX } from './combat.js';
import { DL, buildDreamscape, buildLevel2, buildLevel3, buildLevel4, palaceExtras, buildGlade, gladeExtras, dreamPath, dreamFire, dreamOaks, dreamIndoors, dreamPortal, dreamPortal3, dreamFlowers, dreamShrubs, buildLevel5 } from './dreamscape.js';
import { NameTags, nameTagEntries } from './nametags.js';
import { Drops } from './drops.js';
import { buildPlayerModel } from './playermodel.js';
import { Music } from './music.js';
import { figureMatrix, FIG_HEIGHT } from './lego.js';
import { setupFigurePicker, figureView, loadRoster, figuresFor, customFigureUrl } from './figpick.js';
import { FigureAnimator, firstPersonMatrix, firstPersonWrist, mul as mul4, FP_TILT, FP_HOLD_TILT, ATTACK_TIME, SLASH_CUT } from './minifig-anim.js';
import { loadLegoItems, legoItemForTile, gameTile } from './legoitems.js';
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
    return [{ title: 'Recommended', here: true, items: this.recommendations() }, ...ACTION_GROUPS];
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

// ---- Ascend: SLASH'EM's overland start level (the "dreamland" option).
// The engine has the plain, the woods and the stairs; the client builds the
// house, the paddock, the stone tower and the dirt path from the same layout
// (web/assets/dreamland.json).
const DREAM_FOG = [0.62, 0.80, 1.0]; // bright daytime haze instead of dungeon dark
const DUNGEON_FOG = [0.04, 0.04, 0.06];
const NIGHT_FOG = [0.05, 0.03, 0.11]; // the Fountain of Dreams, out among the stars
let dreamLayout = null, dreamBuilding = null;
async function ensureDreamscape() {
  const key = blocks.levelKey;
  if (!world.dream || !key || blocks.base || dreamBuilding === key) return;
  dreamBuilding = key;
  try {
    if (!dreamLayout) dreamLayout = await (await fetch('/assets/dreamland.json')).json();
    if (blocks.levelKey !== key || !world.dream) return;
    clearDreamscape();
    if (world.dreamLevel === 1) {
      // engine squares = layout squares + (1, 1): the des-file map sits inside SLASH'EM's border column/row
      const off = [1, 1];
      world.path = dreamPath(dreamLayout, off);
      world.hearth = dreamFire(dreamLayout, off);
      world.oaks = dreamOaks(dreamLayout, off); // the woods are blocks...
      world.shrubs = dreamShrubs(dreamLayout, off); // ...the shrubs, little tree tiles
      world.indoors = dreamIndoors(dreamLayout, off);
      world.portal = dreamPortal(dreamLayout, off);
      world.decor = dreamFlowers(dreamLayout, off).map((f) => ({ x: f.x, z: f.z, tile: renderer.slots['flower' + f.k], size: 0.55, shade: 1 }));
      blocks.setBase(buildDreamscape(dreamLayout, off));
    } else if (world.dreamLevel === DL.glade) {
      // the forest glade: woods everywhere, a path through to the standing stones
      const ex = gladeExtras(dreamLayout, [1, 1]);
      world.path = ex.path;
      world.portal = ex.portal;
      world.oaks = { has: () => true }; // no flat tree tiles anywhere: the woods are blocks (or under the canopy)
      world.decor = dreamFlowers(dreamLayout, [1, 1], 'glade').map((f) => ({ x: f.x, z: f.z, tile: renderer.slots['flower' + f.k], size: 0.55, shade: 1 }));
      blocks.setBase(buildGlade(dreamLayout, [1, 1]));
    } else if (world.dreamLevel === DL.sky) {
      world.floating = true; // a platform floating in the sky
      const dp = ui.stat && ui.stat.dportal; // its portal, if the Waddle Dees are already gone
      world.portal = dp ? { x: dp[0], z: dp[1], y: 0 } : null;
      blocks.setBase(buildLevel2(dreamLayout, [1, 1]));
    } else if (world.dreamLevel === DL.kirby) {
      world.portal = dreamPortal3(dreamLayout, [1, 1]); // hidden in a checkered tower
      world.oaks = dreamOaks(dreamLayout, [1, 1], 'kirby');
      world.decor = dreamFlowers(dreamLayout, [1, 1], 'kirby').map((f) => ({ x: f.x, z: f.z, tile: renderer.slots['flower' + f.k], size: 0.55, shade: 1 }));
      blocks.setBase(buildLevel3(dreamLayout, [1, 1]));
    } else if (world.dreamLevel === DL.palace || world.dreamLevel === DL.battle) {
      // (the battle is the same palace and gardens, at night)
      const ex = palaceExtras(dreamLayout, [1, 1]);
      world.oaks = dreamOaks(dreamLayout, [1, 1], 'palace'); // the weeds round the gardens (no flat tree tiles)
      world.paved = ex.paved; // marble walks and floors
      world.decor = ex.flowers.map((f) => ({ x: f.x, z: f.z, tile: renderer.slots['flower' + f.k], size: 0.55, shade: 1 }));
      world.hearth = { fires: ex.fires, smoke: null }; // the braziers either side of the altar
      const dp = ui.stat && ui.stat.dportal; // opened by an offering on the altar, in a hedge maze
      world.portal = dp ? { x: dp[0], z: dp[1], y: 0 } : null;
      blocks.setBase(buildLevel4(dreamLayout, [1, 1]));
    } else if (world.dreamLevel === DL.fountain) {
      // the Fountain of Dreams: an island floating among the stars
      const L5 = buildLevel5(dreamLayout, [1, 1]);
      world.floating = 'fountain';
      world.falls = L5.falls;
      world.starRod = L5.rod;
      world.gushers = L5.gushers;
      world.cloudRing = L5.center; // pink clouds swirl round the island
      world.decor = L5.cones.map((c) => ({ x: c.x, z: c.z, tile: renderer.slots[c.red ? 'coneRed' : 'coneGreen'], size: 1.9, shade: 1 }));
      blocks.setBase(L5.blocks);
    } else {
      blocks.setBase([]); // Dreamland's higher levels: nothing built yet
    }
    loadHorizon();
    world.dirty = true;
  } finally {
    dreamBuilding = null;
  }
}
// art/sky/dreamland-horizon.(png|webp|gif): a picture wrapped round Dreamland's
// horizon.  Loaded once, as soon as the page starts, so it's there from the
// first frame of Dreamland.
let horizonLoad = null;
function loadHorizon() {
  horizonLoad = horizonLoad || (async () => {
    try {
      const files = await (await fetch('/api/art?dir=sky')).json();
      const f = files.find((n) => /^dreamland-horizon\./i.test(n));
      if (f) renderer.setPanorama(await loadImage('/art/sky/' + encodeURIComponent(f)));
    } catch {}
  })();
  return horizonLoad;
}
// level 1's scenery extras (the path, the fire, the trees, the floors, the portal)
function clearDreamscape() {
  world.path = world.hearth = world.oaks = world.shrubs = world.indoors = world.portal = world.paved = null;
  world.decor = [];
  world.floating = false;
  world.falls = world.starRod = world.gushers = world.cloudRing = null;
}
function setDream(on) {
  if (world.dream === on) return;
  world.dream = on;
  setBlockHeights(on);
  if (!on) clearDreamscape();
  setSky();
  world.dirty = true;
}
// BrickHack's dungeon is a LEGO maze out in the open, under a blue sky, and
// Dreamland is in daylight too, until the Fountain of Dreams: night from
// there on, the stars all round, above and below
function setSky() {
  const night = world.dream && world.dreamLevel >= DL.fountain;
  renderer.daySky = !night;
  renderer.spaceBelow = night;
  renderer.iridescent = world.dream && world.dreamLevel === DL.fountain;
  renderer.fog = night ? NIGHT_FOG : DREAM_FOG;
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
let fallSent = 0; // when we asked to be put back on the platform
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
      // Minecraft fall damage: 1 point per block beyond 3, scaled to your max HP
      // (but not when Dreamland drops you back onto a platform)
      if (fall > 3.2 && ui.stat && !phys.soft) post('D ' + Math.max(1, Math.ceil(((fall - 3) * ui.stat.hpmax) / 20)));
      phys.soft = false;
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
  // fallen off a floating platform, far down into the sky: Dreamland puts you back
  if (world.dream && !phys.onGround && phys.y < -12 && (!fallSent || now - fallSent > 2000)) {
    fallSent = now;
    post('F');
  }
  // swimming: bob in the water
  world.heroLift = phys.y + (world.dream && phys.onGround && phys.y < -0.5 ? 0.45 + Math.sin(now / 320) * 0.08 : 0);
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
  loadHorizon();
  document.documentElement.style.setProperty('--bgtile', `url(${legoPlateTile()})`);
  buildScreens();
  // the items made in LEGO (legoitems.js): their models for the floor, their pictures for the slots
  loadLegoItems().then(() => { if (game.playing) { ui.renderHotbar(); if (ui.renderInventory) ui.renderInventory(); } });
  loadLegoMonsters();
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
    try { m = JSON.parse(e.data); } catch { return; }
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
      setDream(m.dream > 0);
      if (world.dreamLevel !== m.dream) { world.dreamLevel = m.dream; clearDreamscape(); setSky(); } // Dreamland level 1, 2... (0: not there)
      // level 2: a portal opens once both Waddle Dees are gone; level 4: in one
      // of the hedge mazes, once anything is offered on the altar; level 5:
      // on the island, once the trial is over (the engine says where)
      if (world.dreamLevel === DL.sky || world.dreamLevel === DL.palace || world.dreamLevel === DL.fountain) {
        world.portal = m.dportal ? { x: m.dportal[0], z: m.dportal[1], y: 0 } : null;
        if (m.dportal && !portal2Open && world.dreamLevel === DL.sky) ui.chat('A shimmering portal opens in the middle of the platform!');
      }
      portal2Open = !!m.dportal;
      // level 5: the Star Rod stands on the fountain until Kirby first falls;
      // then it pops off (a puff where it stood) and lies on the grass as an item
      if (world.rodUp && !m.starrod && world.starRod) fx.puff(world.starRod.x, world.starRod.z, performance.now());
      world.rodUp = !!m.starrod;
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
          ensureDreamscape();
        });
      } else if (blocks.levelKey && blocks.enterLevel(`${m.dnum}:${m.dlev}`)) {
        Object.assign(phys, { y: 0, vy: 0, onGround: true, climb: null });
        drops.clear(); // (whatever was left lying stays behind)
        world.dirty = true;
      }
      if (blocks.levelKey) ensureDreamscape();
      ui.heroSkinURL = game.skinLoaded && !m.poly ? game.skinURL : null;
      if (ui.stat && ui.stat.poly === m.poly && ui.stat.depth === m.depth)
        fx.hpChange(ui.stat.hp, m.hp, m.hpmax, motion, world.hero, performance.now());
      if (fallSent && (m.ux !== world.hero.x || m.uy !== world.hero.y)) {
        fallSent = 0;
        Object.assign(phys, { y: 4, vy: 0, onGround: false, peak: 4, soft: true });
        cam.snap = true;
      }
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

// The menus' background: a LEGO plate seen from above, 4x4 studs to a tile
// (dark bluish grey, each stud lit from the top left and casting a shadow)
function legoPlateTile(size = 128) {
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
const SCREENS = ['title', 'worlds', 'create', 'pause', 'options', 'controls', 'death', 'loading', 'chess', 'reset'];
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
  legacy: ['Intro story', ['off', 'on']],
};
const SPLASHES = ['Now in 3D!', 'Elbereth!', 'Now with studs!', 'The DevTeam thinks of everything!', 'Do not eat the cockatrice!',
  'You hear the footsteps of a guard on patrol.', '100% tiles!', 'Ascend!', 'Mind your bare feet!', 'Watch out for soldier ants!'];

const CONTROLS = [
  ['Mouse', 'Look around'], ['W A S D', 'Move (relative to camera, 8 directions)'], ['Shift + WASD', 'Rush in a direction'],
  ['Left click', 'Attack / fight in the direction you look'], ['Right click', 'Use held item · open/close doors · travel to clicked spot'],
  ['Middle click', 'Look at what is under the crosshair'], ['1-9 / wheel', 'Select hotbar slot'], ['E', 'Inventory'],
  ['Q / Shift+Q', 'Drop one / drop stack of held item'], ['Space', 'Use stairs (on stairs) · otherwise search'],
  ['G', 'Pick up'], ['R', 'Search / rest'], ['F', 'Fire quiver'], ['Z', 'Cast a spell'], ['X', 'Swap weapons'],
  ['K', 'Kick'], ['O', 'Open'], ['L', "Look here (:)"], ['C', 'Character attributes'], ['P', 'Pray'],
  ['T or Enter', 'Command bar (extended commands, e.g. "pray", "loot", "chat")'], ['/', 'Command bar'],
  ['Tab', 'Message history'], ['F5', 'Change camera (1st / 3rd back / 3rd front)'], ['M', 'Overhead map view on/off'], ['F1', 'Hide HUD'],
  ['F3', 'Debug info'], ['N', 'Next music track'], ['I', 'Actions menu (every command as a button)'],
  ['Shift+1..4', 'Do a Recommended action (shown above the hotbar)'], ['`', 'Raw NetHack keys on/off (classic controls)'], ['Esc', 'Cancel prompt / game menu'],
];

function buildScreens() {
  $('#title .splash').textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
  // every menu stands on a 3D LEGO baseplate; the title has BRICKHACK built on it
  const shown = (id) => !$('#' + id).classList.contains('hidden');
  const plated = SCREENS.filter((id) => $('#' + id).classList.contains('dirt'));
  if (menuPlate($('#menu-plate'), $('#title .logo-slot'), () => ({ plate: plated.some(shown), title: shown('title') })))
    document.body.classList.add('lego3d');
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
  // Chess mode: plain chess with NetHack's monsters, in 3D (chess.js, below)
  $('#title [data-act=chess]').onclick = enterChess;
  $('#title [data-act=dreamland]').onclick = () => { game.createDream = true; applyVariantLists(); show('create'); };
  $('#title [data-act=controls]').onclick = () => { returnTo = 'title'; show('controls'); };
  $('#title [data-act=options]').onclick = () => { returnTo = 'title'; openOptions(); };
  $('#worlds [data-act=create]').onclick = () => { game.createDream = false; applyVariantLists(); show('create'); };
  $('#worlds [data-act=back]').onclick = () => show('title');
  $('#create [data-act=back]').onclick = () => show(game.createDream ? 'title' : 'worlds');

  // BrickHack starts you as a human male Knight (role 7, race 1, gender 1); the
  // alignment always starts random (the game picks one that fits)
  const choice = { role: 7, race: 1, gender: 1, legacy: 0, ...safeJSON(localGet('bh.create')), align: 0 };
  const nameIn = $('#cname');
  nameIn.value = localGet('nh3d.name') || '';
  let syncPicker = () => {}; // the minifig picker follows the role and gender
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
      b.textContent = `${CYCLES[k][0]}: ${cap(CYCLES[k][1][choice[k]])}`;
      b.classList.toggle('conflict', RULED.includes(k) && conflicts(rules, pick(), k, pick()[k]).length > 0);
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
    const free = RULED.filter((k) => !locked.has(k));
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
  figPicker = setupFigurePicker($('#figpick'), () => !$('#create').classList.contains('hidden'), (fig) => {
    if (!nameIn.value || nameIn.value === 'Steve' || figNames.has(nameIn.value)) nameIn.value = fig.label;
    figNames.add(fig.label);
  });
  loadRoster().then((r) => r.forEach((f) => figNames.add(f.label)));
  syncPicker = () => figPicker.filter(CYCLES.role[1][choice.role], CYCLES.gender[1][choice.gender], CYCLES.race[1][choice.race]);
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
    o.legacy = choice.legacy === 1;
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
  $('#options [data-opt=playerModel]').textContent = `Player: ${opts.playerModel === 'model' ? 'LEGO minifig' : 'Game sprite'}`;
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
    d.onclick = () => startGame({ name: n, variant: game.variant });
    list.appendChild(d);
  }
}

async function startGame(o) {
  game.lastStart = o;
  // a new Dreamland game has its daytime sky from the very first frame
  // (a saved game finds out from the engine which level it's on)
  world.dreamLevel = o.dreamland ? 1 : 0; // (a saved game hears which level from the engine)
  setDream(!!o.dreamland);
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


// ---- the hero as a LEGO minifig (on LEGO levels), chosen at character creation
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
  hero3d.wear = wornHelm(); // (a helm on already: a restored game)
  const url = (await customFigureUrl(fig.id, parts, hero3d.wear)) || fig.url;
  hero3d.id = fig.id;
  hero3d.url = url;
  hero3d.prims = null;
  try { hero3d.prims = await renderer.lego.model(url); } catch (e) { console.warn('hero figure:', e); }
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
// ("strip:<slot>"); anything else you put on shows (items made in LEGO to be
// worn: items.json "wear"), in its slot. (A designed shield is put back in
// hand while you wear the one you started with: "design:shield", the roster's
// figures being built empty-handed.)
const WORN_SLOTS = ['shirt', 'suit', 'cloak', 'helm', 'shield']; // (in the order they go on: a suit over a shirt; a helm takes a cloak's hood off)
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
    if (h && start.items[h.l]) return slot === 'shield' && slots.shield ? 'design:shield' : ''; // as designed
    if (!h) return start.claimed.includes(slot) && slots[slot] ? 'strip:' + slot : ''; // its starting piece taken off
    const l = legoItemForTile(h.t);
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
  try { prims = await renderer.lego.model(url); } catch (e) { console.warn('hero figure:', e); return; }
  if (hero3d.wear !== wear) return;
  hero3d.url = url;
  hero3d.prims = prims;
  hero3d.anim = prims && prims.rig ? new FigureAnimator(prims.rig) : null;
  if (heroView) heroView.show(url);
}
// the minifig stands in for the doll and the hero's sprite on LEGO levels
const showFigure = () => !!hero3d.prims && opts.playerModel === 'model' && opts.camera !== 0 && !(ui.stat && ui.stat.poly);

// What the hero has in each hand, as LEGO: {R, L}, each an item's url;
// null: nothing in that hand; undefined: something not made in LEGO yet (the
// figure keeps what it was built holding). The left hand only while fighting
// with two weapons (the "alt" weapon); otherwise it's left as built (a shield...).
const heldPrims = new Map(); // url -> the item's prims for lego.js (loading: null)
function heroHold() {
  const wep = game.inv.find((i) => i.w === 'weapon');
  const two = !!(ui.stat && ui.stat.twoweap);
  const alt = two ? game.inv.find((i) => i.w === 'alt') : null;
  const as = (it) => { const l = legoItemForTile(it.t); return l ? l.url : undefined; };
  const hold = { R: wep ? as(wep) : null, L: alt ? as(alt) : undefined, two };
  for (const url of [hold.R, hold.L])
    if (url && !heldPrims.has(url)) {
      heldPrims.set(url, null);
      renderer.lego.model(url).then((p) => heldPrims.set(url, p)).catch(() => {});
    }
  return hold;
}
// lego.js entries for what's held, on a figure drawn at `matrix` with its
// hands' joint matrices `hands` ({R, L}): each item at its hand's grip
function heldEntries(hold, rig, matrix, hands) {
  const out = [];
  for (const side of ['R', 'L']) {
    const url = hold[side], prims = url && heldPrims.get(url), j = rig['arm' + side];
    if (prims && j && j.grip && hands[side]) out.push({ prims, matrix: mul4(matrix, mul4(hands[side], new Float32Array(j.grip))), shade: 1 });
  }
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
  return a.update(dt, { moving: game.playing && (motion.heroRemaining(now) > 0 || !phys.onGround),
    holdsR: !!hold.R, holdsL: !!hold.L, twoweap: !!hold.two });
}

// ---- monsters made in LEGO (web/assets/lego/monsters.json, built by
// tools/build_roster.py): drawn as their minifig in place of their sprite,
// alive as the hero is (breathing, looking about, walking, swinging what
// they hold when they lunge at you), always facing you
const legoMons = new Map(); // tile -> {url, hold (an item's url), prims, anim, lungeT0, last}
async function loadLegoMonsters() {
  const get = (u) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const [mons, tiles, items] = await Promise.all([get('assets/lego/monsters.built.json'), get('assets/slashem/tiles.json'), get('assets/lego/items.built.json')]);
  (tiles.names || []).forEach((n, i) => {
    const m = mons[n];
    if (!m) return;
    const e = { url: m.url, hold: m.hold && items[m.hold] ? items[m.hold].url : undefined, prims: null, anim: null, lungeT0: null, last: null };
    legoMons.set(i, e);
    renderer.lego.model(m.url).then((p) => { e.prims = p; e.anim = p && p.rig ? new FigureAnimator(p.rig) : null; if (e.anim) e.anim.spawn(); })
      .catch((err) => console.warn('LEGO monster:', n, err));
  });
}
// take the LEGO monsters' sprites out of the list; their figures, for renderer.legoFigures
function legoMonFigures(sprites, dt, now) {
  if (!legoMons.size) return [];
  const out = [];
  const [hx, hz] = motion.heroPos(now);
  for (let i = sprites.length - 1; i >= 0; i--) {
    const s = sprites[i], e = s.mon && legoMons.get(s.tile);
    if (!e || !e.prims) continue;
    sprites.splice(i, 1);
    const f = s.mob && fx.mobFX && fx.mobFX.get(s.mob.id);
    if (e.anim && f && f.kind === 'lunge' && f.t0 !== e.lungeT0) { e.lungeT0 = f.t0; e.anim.attack(); }
    const moving = !!e.last && Math.hypot(s.x - e.last[0], s.z - e.last[1]) > 0.002 && !(f && f.kind === 'lunge');
    e.last = [s.x, s.z];
    const pose = e.anim ? e.anim.update(dt, { moving, holdsR: !!e.hold }) : null;
    const yaw = Math.atan2(hx - s.x, -(hz - s.z)); // (the game's yaw: 0 looks north, -Z)
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
  // the body turns toward where you look
  let d = cam.yaw - doll.yaw;
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

const showDoll = () => false; // (BrickHack: the hero is a LEGO minifig, never the Minecraft doll)

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
  const tx = cam.x + 0.5, tz = cam.z + 0.5;
  const heroH = motion.heroHeight();
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const f = [Math.sin(cam.yaw) * cp, sp, -Math.cos(cam.yaw) * cp];
  if (opts.camera === 0) {
    cam.eye = [tx, (world.heroLift ?? phys.y) + heroH * 0.9, tz]; // Steve's eyes are at 1.62
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
  const target = [tx, (world.heroLift ?? phys.y) + heroH * (fig ? 1.0 : 0.85), tz];
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
    if (type === 'bomb') bombChain(mining.x, mining.h, mining.z, now);
    mining = null;
    world.dirty = true;
    game.ensureBlocksInHotbar();
    ui.renderHotbar();
    return null;
  }
  return { boxes: [[mining.x, mining.h, mining.z, mining.x + 1, mining.h + 1, mining.z + 1]], stage: Math.floor(k * 10) };
}

// Kirby's bomb blocks: break one and every star or bomb block joined to it
// pops too (each drops to the ground like any mined block)
function bombChain(x, y, z, now) {
  const todo = [[x, y, z]], seen = new Set([`${x},${y},${z}`]);
  let n = 0;
  while (todo.length) {
    const [cx, cy, cz] = todo.shift();
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = cx + dx, ny = cy + dy, nz = cz + dz, key = `${nx},${ny},${nz}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const t = blocks.get(nx, ny, nz);
      if (t !== 'star' && t !== 'bomb') continue;
      blocks.remove(nx, ny, nz);
      drops.spawn(t, nx, ny, nz, now);
      fx.puff(nx, nz, now);
      todo.push([nx, ny, nz]);
      n++;
    }
  }
  fx.puff(x, z, now);
  ui.chat(n ? `BOOM! The bomb block blows away ${n} star block${n === 1 ? '' : 's'}!` : 'BOOM!');
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
  if (ui.chestOpen) ui.setChestBusy(true);
  releaseLock();
  game.pendingExt = 'loot';
  game.sendKeys('#');
}

function closeChestScreen() {
  chest.active = false;
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
  if (['F1', 'F3', 'F5', 'Tab'].includes(e.key) || (e.key === ' ' && !modalOpen())) e.preventDefault();
  if (!$('#pause').classList.contains('hidden')) { if (e.key === 'Escape') resume(); return; }
  if (anyScreen()) return;
  const k = e.key;

  // view toggles always work
  if (k === 'F5') { opts.camera = opts.camera >= 2 ? 0 : opts.camera + 1; saveOpts(); return; }
  if ((k === 'm' || k === 'M') && !game.mode && !ui.inventoryOpen && !game.raw) {
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
    if (k === 'Escape' || k === 'e' || k === 'E') {
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
  // Shift+1..4: the Recommended actions
  if (e.shiftKey && /^Digit[1-4]$/.test(e.code)) {
    const r = game.recs && game.recs[+e.code.slice(5) - 1];
    if (r) { e.preventDefault(); game.runAction(r); }
    return;
  }
  const it = ui.selectedItem();
  switch (lower) {
    case 'i': releaseLock(); ui.openInventory(null, 'actions'); return;
    case 'e': releaseLock(); ui.openInventory(); return;
    case 'q': if (it) game.itemCmd('drop', it, e.shiftKey || it.q === 1 ? 0 : 1); return;
    case ' ': { // the stairs (or ladder) you're on; anywhere else, search
      const cl = world.classAt(world.hero.x, world.hero.y), c = cl && cl.cmap;
      game.sendKeys(c === CM.upstair || c === CM.upladder ? '<' : c === CM.dnstair || c === CM.dnladder ? '>' : 's');
      return;
    }
    case '<': case '>': game.sendKeys(k); return;
    case 'g': game.sendKeys(','); return;
    case 'n': music.next(); return;
    case 'r': game.sendKeys('s'); return;
    case 'f': game.sendKeys('f'); return;
    case 'z': game.sendKeys('Z'); return;
    case 'x': game.sendKeys('x'); return;
    case 'k': game.sendKeys('\x04'); return;
    case 'o': game.sendKeys('o'); return;
    case 'l': game.sendKeys(':'); return;
    case 'c': game.sendKeys('\x18'); return;
    case 'p': game.pendingExt = 'pray'; game.sendKeys('#'); return;
    case 'tab': case 'Tab': ui.toggleHistory(); if (ui.history) releaseLock(); else relock(); return;
    case 'Escape': if (ui.history) { ui.toggleHistory(false); return; } show('pause'); return;
    case 't': case 'Enter': case '/':
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
  }
});
window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());
document.addEventListener('mouseup', () => {});

$('#controls [data-act=done]')?.addEventListener('click', () => { if (returnTo === null) { show(null); relock(); } });

function processMovement(now) {
  if (!game.playing || !game.ready || game.mode || modalOpen() || anyScreen() || game.raw || phys.climb != null) return;
  // take the next step just before the hero reaches the centre of its square,
  // so holding W walks continuously
  if (motion.heroRemaining(now) > 40) return;
  if (now - lastMove < 60) return;
  const f = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0);
  const r = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0);
  const d = relDir(f, r);
  if (!d) return;
  const tx = world.hero.x + d[0], tz = world.hero.y + d[1];
  if (tx < 1 || tz < 0 || tx >= world.w || tz >= world.h) return;
  const cl = world.classAt(tx, tz);
  // on the floor and nothing built there: NetHack's own rules (doors, monsters, ...)
  const plain = phys.y < 0.01 && phys.y > -0.5 && !blocks.hasColumn(tx, tz) && !(cl && (cl.type === 'wall' || cl.type === 'rock'));
  let shift = window.__shift;
  if (motion.mobAt(tx, tz)) fx.attack(tx, tz, now); // walking into a monster attacks it
  if (!plain && !motion.mobAt(tx, tz)) {
    // climbing onto blocks / walking on walls: the client decides, the engine is told
    const land = world.landingAt(tx, tz, phys.y, onRoof());
    if (land == null) return; // something solid in the way
    post(`A ${tx} ${tz}`);
    const onLadder = world.ladderTop(world.hero.x, world.hero.y) > 0;
    if (world.ladderTop(tx, tz) && land > phys.y + 0.05) phys.climb = land; // climb up the ladder
    else if (onLadder && land < phys.y - 1.05) phys.climb = land; // climb down it
    else if (land > phys.y + 0.05) phys.climb = land; // step up onto it
    shift = false;
  }
  lastMove = now;
  game.sendKeys(shift ? dirKey(d).toUpperCase() : dirKey(d));
}
window.addEventListener('keydown', (e) => (window.__shift = e.shiftKey), true);
window.addEventListener('keyup', (e) => (window.__shift = e.shiftKey), true);

// the house's fire (four flickering frames) and the smoke puffing out of the chimney
function hearthSprites(h, now, T) {
  const out = [];
  const frame = T['fire' + (Math.floor(now / 110) % 4)];
  for (const f of h.fires) out.push({ x: f.x, z: f.z, lift: f.y || 0, tile: frame, size: 0.9 + 0.05 * Math.sin(now / 90), shade: 1.6 });
  const s = h.smoke;
  for (let i = 0; s && i < 6; i++) {
    const k = (now / 4200 + i / 6) % 1; // each puff rises, drifts, grows and fades
    out.push({ x: s.x + Math.sin(k * 5 + i) * 0.35 * k, z: s.z + 0.6 * k, lift: s.y + k * 4, tile: T.puff,
      size: 0.45 + 1.1 * k, shade: 1.25 - 0.45 * k });
  }
  return out;
}

// the swirling portal on the tower roof, and stepping into it: up to
// Dreamland's next level (the engine checks you really are in it, up there)
function portalSprites(p, now, T) {
  // the swirl glows: brighter than daylight, pulsing; sparkles drift up out of it
  const out = [{ x: p.x, z: p.z, lift: p.y + 0.05 + 0.06 * Math.sin(now / 300), tile: T['portal' + (Math.floor(now / 140) % 4)],
    size: 2.8, shade: 1.7 + 0.35 * Math.sin(now / 220) }];
  for (let i = 0; i < 8; i++) {
    const k = (now / 2600 + i / 8) % 1, a = i * 2.4 + now / 900;
    out.push({ x: p.x + Math.cos(a) * 0.9 * (1 - k), z: p.z + Math.sin(a) * 0.4, lift: p.y + 0.4 + k * 3.2,
      tile: T.puff, size: 0.22 * (1 - k) + 0.06, shade: 2.4 });
  }
  return out;
}
// the Star Rod on top of the Fountain of Dreams: glowing, and every so often
// flashing white, with sparkles falling round it
function starRodSprites(r, now, T) {
  const k = (now % 1600) / 1600, flash = k < 0.18;
  const out = [{ x: r.x, z: r.z, lift: r.y + 0.08 * Math.sin(now / 500), tile: T[flash ? 'starRod1' : 'starRod0'],
    size: 2.2, shade: flash ? 2.6 : 1.4 + 0.2 * Math.sin(now / 260) }];
  for (let i = 0; i < 6; i++) {
    const s = (now / 1800 + i / 6) % 1, a = i * 1.05 + now / 1200;
    out.push({ x: r.x + Math.cos(a) * (0.5 + s), z: r.z + Math.sin(a) * (0.5 + s), lift: r.y + 1.6 - s * 2.2,
      tile: T.puff, size: 0.18 * (1 - s) + 0.05, shade: 2.6 });
  }
  return out;
}
// a gusher's spray: rainbow sparkles thrown up and out of the top of its
// jet, arcing back down into the pool
function gusherSprites(g, now, T) {
  const out = [], N = 22, seed = g.x * 7 + g.z * 3;
  for (let i = 0; i < N; i++) {
    const k = (now / 1400 + i / N + seed * 0.13) % 1, a = i * 2.4 + seed;
    out.push({ x: g.x + Math.cos(a) * k * 1.4, z: g.z + Math.sin(a) * k * 1.4, lift: g.top - 0.6 + 2.2 * k - 5.0 * k * k,
      tile: T['spark' + (i % 4)], size: 0.45 - 0.18 * k, shade: 1.8 });
  }
  return out;
}

// fluffy pink clouds, high and low, swirling slowly round the whole island
const CLOUDS = Array.from({ length: 16 }, (_, i) => {
  const h = (n) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return { a: (i / 16) * Math.PI * 2 + h(1) * 0.3, r: 16 + h(2) * 7, y: -6 + h(3) * 15, size: 3 + h(4) * 2.5, speed: 0.035 + h(5) * 0.03 };
});
function cloudSprites(c, now, T) {
  const out = [], t = now / 1000;
  for (const cl of CLOUDS) {
    const a = cl.a + t * cl.speed;
    const y = cl.y + Math.sin(t * 0.4 + cl.a * 3) * 0.6;
    // three puffs side by side along the swirl make each cloud
    for (const d of [-1, 0, 1]) {
      const b = a + d * (cl.size * 0.18) / cl.r;
      out.push({ x: c.x + Math.cos(b) * cl.r - 0.5, z: c.z + Math.sin(b) * cl.r - 0.5, lift: y + (d ? -0.3 : 0.2),
        tile: T.pinkCloud, size: cl.size * (d ? 0.8 : 1), shade: 1.05 });
    }
  }
  return out;
}
// autumn leaves falling from the trees near you: they drift down from the
// undersides of the canopies, swaying and spinning, settle on the ground and
// fade after a while
const LEAVES = { list: [], canopy: [], key: null, next: 0 };
function leafSprites(now, dt, T) {
  const key = blocks.version + ':' + blocks.levelKey;
  if (LEAVES.key !== key) { // the canopies' undersides: leaves with nothing under them
    LEAVES.key = key;
    LEAVES.canopy = [...blocks.all()].filter((b) => b.type === 'leaves' && !blocks.get(b.x, b.y - 1, b.z));
    LEAVES.list = LEAVES.list.filter((l) => l.landed);
  }
  const [hx, hz] = motion.heroPos(now);
  // a new leaf every so often, from a canopy near you
  if (now > LEAVES.next && LEAVES.canopy.length && LEAVES.list.length < 70) {
    LEAVES.next = now + 140 + Math.random() * 220;
    for (let tries = 0; tries < 8; tries++) {
      const b = LEAVES.canopy[Math.floor(Math.random() * LEAVES.canopy.length)];
      if (Math.hypot(b.x - hx, b.z - hz) > 24) continue;
      let ground = 0; // where it will land: the top of whatever is under it
      for (let y = b.y - 1; y >= 0; y--) if (blocks.get(b.x, y, b.z)) { ground = y + 1; break; }
      LEAVES.list.push({ x: b.x + Math.random(), y: b.y - 0.05, z: b.z + Math.random(), ground,
        vy: 0.45 + Math.random() * 0.3, ph: Math.random() * 6.28, k: Math.random() < 0.5 ? 0 : 1, landed: 0 });
      break;
    }
  }
  const out = [];
  LEAVES.list = LEAVES.list.filter((l) => {
    if (!l.landed) {
      l.y -= l.vy * dt;
      l.x += Math.cos(now / 600 + l.ph) * 0.35 * dt; // swaying as it falls
      l.z += Math.sin(now / 750 + l.ph) * 0.25 * dt;
      if (l.y <= l.ground) { l.y = l.ground; l.landed = now; }
    } else if (now - l.landed > 5000) return false; // gone after a while on the ground
    const fade = l.landed ? Math.max(0, 1 - (now - l.landed - 3500) / 1500) : 1;
    out.push({ x: l.x - 0.5, z: l.z - 0.5, lift: l.y + (l.landed ? 0.02 : 0), tile: T['fallLeaf' + l.k], size: 0.4,
      tilt: l.landed ? 1.35 : Math.sin(now / 280 + l.ph) * 0.8, shade: Math.min(1, 0.4 + fade) });
    return fade > 0;
  });
  return out;
}
let portalSent = false;
let portal2Open = false; // level 2's portal was open at the last status (to announce it once)
function checkPortal() {
  const p = world.portal, h = world.hero;
  const inside = p && h.x === p.x && h.y === p.z && phys.onGround && phys.y >= p.y - 0.1;
  if (!inside) { portalSent = false; return; }
  if (portalSent || !game.ready || game.mode) return;
  portalSent = true;
  post('Z ' + Math.round(phys.y)); // (make sure the engine knows you're up on the roof)
  post('P');
  game.sendKeys('s'); // a moment's pause, and the portal takes you
}

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
  if (renderer && CH.active) { chessFrame(t); requestAnimationFrame(frame); return; }
  if (renderer) {
    renderer.fov = opts.fov;
    if (world.dirty || lastWall !== opts.wallStyle) {
      world.rebuild();
      collectDug();
      renderer.buildTerrain(world, opts);
      world.dirty = false;
      lastWall = opts.wallStyle;
    }
    processMovement(t);
    if (game.playing) { updatePhysics(dt, t); updateDoll(dt, t); checkPortal(); }
    updateCamera(t);
    const fig3d = showFigure();
    const doll3d = showDoll() && !fig3d;
    motion.figHeight = hero3d.prims ? FIG_HEIGHT : null;
    world.spriteScale = world.dream ? 1 : FIG_HEIGHT / 2.0; // a human-sized monster stands as tall as you
    world.camYaw = cam.vyaw; // creatures face the way they walk, as seen from here
    const sprites = world.sprites(opts.camera !== 0 && !doll3d && !fig3d, motion, t, fx);
    renderer.legoItems = world.legoDrops || [];
    if (renderer.slots) sprites.push(...fx.puffSprites(t, renderer.slots.puff));
    if (world.hearth && renderer.slots) sprites.push(...hearthSprites(world.hearth, t, renderer.slots));
    if (world.portal && renderer.slots) sprites.push(...portalSprites(world.portal, t, renderer.slots));
    if (world.starRod && world.rodUp && renderer.slots) sprites.push(...starRodSprites(world.starRod, t, renderer.slots));
    if (world.gushers && renderer.slots) for (const g of world.gushers) sprites.push(...gusherSprites(g, t, renderer.slots));
    if (world.cloudRing && renderer.slots) sprites.push(...cloudSprites(world.cloudRing, t, renderer.slots));
    if (world.dream && renderer.slots && game.playing) sprites.push(...leafSprites(t, dt, renderer.slots));
    if (game.playing) {
      const [hx, hz] = motion.heroPos(t);
      drops.update(dt, t, world, [hx + 0.5, world.heroLift ?? phys.y, hz + 0.5], pickUpBlock);
    }
    const hold = (hero3d.hold = hero3d.prims && game.playing ? heroHold() : {});
    const pose = hero3d.prims ? heroPose(dt, t) : null;
    const rig = hero3d.prims && hero3d.prims.rig;
    if (fig3d) {
      const [hx, hz] = motion.heroPos(t);
      const m = figureMatrix(hx + 0.5, world.heroLift ?? phys.y, hz + 0.5, doll.yaw);
      renderer.legoFigures = [{ prims: hero3d.prims, url: hero3d.url, matrix: m, shade: 1, pose, hold, skip: skipped(hold) },
        // (for the block levels' renderer, lego.js; the LEGO dungeon's hangs them on the hands itself)
        ...(rig && pose ? heldEntries(hold, rig, m, { R: pose.handR || pose.armR, L: pose.handL || pose.armL }) : [])];
    } else renderer.legoFigures = [];
    renderer.legoFigures.push(...legoMonFigures(sprites, dt, t)); // (King Skelly...)
    // first person: your own LEGO arm, and what it holds, in the corner of the
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
          ...heldEntries({ [side]: hold[side] }, rig, fm, { [side]: hp }));
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
    renderer.fogRange = !world.dream ? [1e4, 2e4] : opts.camera === 3 ? [30, 60] : [45, 150]; // (no fog on LEGO levels, as in the viewer)
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

// ------------------------------------------------------------------ chess
// Chess mode in 3D: a proper dungeon room (stone walls, the dungeon's floor,
// a brazier burning in each corner) with the board in the middle, its
// squares stone and dark earth; the pieces are NetHack's monsters standing
// on it, the ones taken lined up along the sides.  The camera circles the
// board (drag to look round, scroll to zoom); click a piece, then a square.
const CH = { active: false, game: null, world: null, dirty: true, yaw: 0, pitch: -0.8, dist: 10.5, eye: [0, 0, 0], drag: null };
const CH_ROOM = 14, CH_B0 = 3; // the room (walls round its edge), the board's first square
const CH_SIZE = { p: 1.25, n: 1.5, b: 1.6, r: 1.55, q: 1.8, k: 1.9 };
const chTile = (name) => meta.names.indexOf(name);

function chessRoom() {
  const T = renderer.slots, W = CH_ROOM, classes = new Array(W * W);
  const room = cmapTile(CM.room), wall = wallTile();
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const edge = x === 0 || y === 0 || x === W - 1 || y === W - 1;
      const f = x - CH_B0, r = y - CH_B0, onBoard = f >= 0 && f < 8 && r >= 0 && r < 8;
      classes[y * W + x] = edge ? { type: 'wall', tile: wall, seen: true, cmap: CM.hwall }
        : { type: 'floor', seen: true, cmap: CM.room, tile: onBoard ? ((f + r) % 2 ? T.dirt : T.stone) : room };
    }
  return { w: W, h: W, classes, cells: [], hero: { x: W / 2, y: W / 2 }, blocks: null, dream: false };
}

function enterChess() {
  if (!renderer.slots) rebuildTextures();
  if (!CH.game)
    CH.game = createChess($('#chess'), { tileIcon, tileOf: chTile, onBack: leaveChess, log: (text) => ui.chat(text) });
  else CH.game.redraw();
  CH.world = chessRoom();
  CH.dirty = true;
  CH.active = true;
  renderer.daySky = renderer.spaceBelow = renderer.iridescent = false;
  renderer.fog = DUNGEON_FOG;
  $('#hud').classList.remove('hidden');
  $('#hud').classList.add('chess-hud'); // just the chat: the moves, in algebraic notation
  show('chess');
}
function leaveChess() {
  CH.active = false;
  setSky();
  renderer.setOutline(null);
  world.dirty = true;
  $('#hud').classList.add('hidden');
  $('#hud').classList.remove('chess-hud');
  show('title');
}

function chessSprites(now) {
  const v = CH.game.view(), T = renderer.slots, out = [];
  for (let s = 0; s < 64; s++) {
    const p = v.board[s];
    if (!p) continue;
    out.push({ x: CH_B0 + (s & 7), z: CH_B0 + (s >> 3), tile: chTile(pieceName(p)), size: CH_SIZE[p.t],
      lift: s === v.sel ? 0.18 + 0.08 * Math.sin(now / 180) : 0, // the chosen piece hops
      shade: s === v.check ? 1.3 + 0.5 * Math.sin(now / 120) : 1 }); // a king in check flashes
  }
  for (const s of v.targets) // where it can go: twinkles on the squares
    out.push({ x: CH_B0 + (s & 7), z: CH_B0 + (s >> 3), tile: T.spark1, size: 0.45 + 0.05 * Math.sin(now / 150), lift: 0.05, shade: 1.6 });
  // taken pieces line up along the sides: white's on the west, black's on the east
  let w = 0, b = 0;
  for (const p of v.taken) {
    const i = p.c === 'w' ? w++ : b++;
    out.push({ x: p.c === 'w' ? 1 + Math.floor(i / 12) : CH_ROOM - 2 - Math.floor(i / 12), z: 1 + (i % 12),
      tile: chTile(pieceName(p)), size: CH_SIZE[p.t] * 0.8, shade: 0.85 });
  }
  const corners = [[1, 1], [CH_ROOM - 2, 1], [1, CH_ROOM - 2], [CH_ROOM - 2, CH_ROOM - 2]];
  out.push(...hearthSprites({ fires: corners.map(([x, z]) => ({ x, z, y: 0 })), smoke: null }, now, T));
  return out;
}

function chessFrame(t) {
  renderer.fov = opts.fov;
  if (CH.dirty) { renderer.buildTerrain(CH.world, opts); CH.dirty = false; }
  const c = CH_B0 + 4, cp = Math.cos(CH.pitch);
  const f = [Math.sin(CH.yaw) * cp, Math.sin(CH.pitch), -Math.cos(CH.yaw) * cp];
  CH.eye = [c - f[0] * CH.dist, 0.4 - f[1] * CH.dist, c - f[2] * CH.dist];
  renderer.buildSprites(chessSprites(t), CH.yaw);
  renderer.fogRange = [22, 50];
  const v = CH.game.view();
  renderer.setOutline(v.sel >= 0 ? [CH_B0 + (v.sel & 7), 0, CH_B0 + (v.sel >> 3), CH_B0 + (v.sel & 7) + 1, 0.02, CH_B0 + (v.sel >> 3) + 1] : null);
  renderer.draw(CH.eye, CH.yaw, CH.pitch, [1, 0.9, 0.3, 1]);
}

// which square a click is on: a piece standing there (its sprite, nearest
// the camera first), else the floor under the pointer; -1 off the board
function chessPick(sx, sy) {
  const v = CH.game.view();
  let best = -1, bestY = -Infinity;
  for (let s = 0; s < 64; s++) {
    const p = v.board[s];
    if (!p) continue;
    const x = CH_B0 + (s & 7) + 0.5, z = CH_B0 + (s >> 3) + 0.5;
    const foot = project([x, 0, z]), head = project([x, CH_SIZE[p.t], z]);
    if (!foot || !head) continue;
    const h = foot[1] - head[1], half = h * 0.35;
    if (sx >= foot[0] - half && sx <= foot[0] + half && sy >= head[1] && sy <= foot[1] && foot[1] > bestY) { best = s; bestY = foot[1]; }
  }
  if (best >= 0) return best;
  const ray = renderer.screenRay(CH.eye, CH.yaw, CH.pitch, sx, sy);
  if (ray.d[1] >= 0) return -1;
  const k = -ray.o[1] / ray.d[1];
  const f = Math.floor(ray.o[0] + ray.d[0] * k) - CH_B0, r = Math.floor(ray.o[2] + ray.d[2] * k) - CH_B0;
  return f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1;
}
$('#view').addEventListener('mousedown', (e) => {
  if (!CH.active) return;
  CH.drag = { x: e.clientX, y: e.clientY, moved: false };
});
window.addEventListener('mousemove', (e) => {
  if (!CH.active || !CH.drag) return;
  const dx = e.clientX - CH.drag.x, dy = e.clientY - CH.drag.y;
  if (!CH.drag.moved && Math.hypot(dx, dy) < 5) return;
  CH.drag.moved = true;
  CH.yaw += dx * 0.008;
  CH.pitch = Math.max(-1.45, Math.min(-0.25, CH.pitch - dy * 0.006));
  CH.drag.x = e.clientX; CH.drag.y = e.clientY;
});
window.addEventListener('mouseup', (e) => {
  if (!CH.active || !CH.drag) return;
  const clicked = !CH.drag.moved;
  CH.drag = null;
  if (!clicked) return;
  const r = $('#view').getBoundingClientRect();
  CH.game.click(chessPick(e.clientX - r.left, e.clientY - r.top));
});
$('#view').addEventListener('wheel', (e) => {
  if (CH.active) CH.dist = Math.max(6, Math.min(20, CH.dist + Math.sign(e.deltaY) * 0.8));
}, { passive: true });

// debugging handle (used for automated checks in the dev console)
window.__nh = { cam, opts, world, game, ui, handle, creator, makeSkin, motion, music, blocks, phys, fx, nameTags, crosshairTarget, yawDir, LEAVES, hero3d, loadHeroFigure, get renderer() { return renderer; } };

// NetHack's items as brick (web/assets/brick/items.json, built by
// tools/build_items.py): which game tile (sprite) is which brick item, and a
// picture of each for the inventory and hotbar, rendered once from its model:
// laid diagonally, blade to the top right, Minecraft-style.
//
// The tile sheet's names (assets/slashem/tiles.json) are 'appearance / real
// name' ("runed broadsword / elven broadsword"); an item's tile is the same
// whether it's been identified or not, so the real name finds it.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { gradientEnvironment } from './envmap.js';
import { corpsePiece } from './pieces.js';

const byTile = new Map(); // tile -> {name, url, brick}
// items named as the game names them, where a plain name could be another class's ("ring of see invisible")
const PREFIX = { ring: 'ring of ', wand: 'wand of ', spellbook: 'spellbook of ', scroll: 'scroll of ' };
const icons = new Map(); // tile -> data URL
const artBase = new Map(); // an artifact's tile (port/winweb.c: 90000 + its number) -> its base item's game tile
let readyP = null;

// Armour the hero started with is its figure's design's own piece (the monk's
// robe his habit, his gloves his hands): the game sends it as START_TILE + its
// slot x 10000 + its own tile (winweb.c web_obj_tile), shown as the piece
// (setStartPieces), or, where the design has none in that slot, as ever
const START_TILE = 100000;
const SLOTS = ['suit', 'shield', 'helm', 'gloves', 'boots', 'cloak', 'shirt']; // (the engine's armour categories, in order)
const UPRIGHT = new Set(['helm', 'gloves', 'boots']); // (set down standing; a garment lies flat)
const pieces = new Map(); // slot -> {url, icon} of the hero's design's piece (none: not in the map)
const isStart = (t) => t >= START_TILE && t < START_TILE + SLOTS.length * 10000;
const startSlot = (t) => SLOTS[Math.floor((t - START_TILE) / 10000)];
const startBase = (t) => (t - START_TILE) % 10000;
export const isStartTile = isStart;

// Corpses: the game sends each as CORPSE_TILE + whose (winweb.c web_obj_tile: its monster's own tile, on the tile
// sheet): shown as one brick of that monster's own model (pieces.js corpsePiece: the model url
// "corpse:<its name>", brickworld.model), on the floor and in its picture; one with no brick model, as its sprite
const CORPSE_TILE = 94000;
let monNames = [], monUrls = {}, corpseSprite = null;
const isCorpse = (t) => t >= CORPSE_TILE && t < CORPSE_TILE + 2000;
export const corpseMonsterUrl = (name) => monUrls[name] || null;

export const brickItemForTile = (t) => {
  if (isCorpse(t)) { const mon = monNames[t - CORPSE_TILE]; return mon && monUrls[mon] ? { name: 'corpse', url: 'corpse:' + mon, upright: true, corpse: mon } : null; }
  if (isStart(t)) {
    const p = pieces.get(startSlot(t)), base = byTile.get(startBase(t));
    return p ? { name: base ? base.name : '', url: p.url, brick: 'its own, from your design', upright: UPRIGHT.has(startSlot(t)), start: true } : base || null;
  }
  return byTile.get(t) || null;
};
// any built item by its name in items.json, tiles or not ("_plastic Amulet of Yendor"), or null
let builtItems = {};
export const brickBuilt = (name) => builtItems[name] || null;
// one link of a chain (the ball and chain: ballchain.js), its model's url
let chainLinkUrl = null;
export const brickChainLink = () => chainLinkUrl;
// a brick item by its real name ("rock"), or null
export const brickItemByName = (name) => { for (const it of byTile.values()) if (it.name === name) return it; return null; };
export const brickIconForTile = (t) => {
  if (isCorpse(t)) return corpseIcon(t);
  if (isStart(t)) { const p = pieces.get(startSlot(t)); return (p && p.icon) || brickIconForTile(startBase(t)); }
  const icon = icons.get(t);
  if (!icon && byTile.has(t)) wanted.add(t); // (not drawn yet: it's on screen, so it's drawn next)
  return icon || null;
};
// The pictures are drawn one by one when the page loads; what's on screen is drawn
// first (asked for and not there: wanted), and whoever shows them is told when it is
// (onIcons: the inventory and hotbar redraw), so a new game's gear isn't sprites for long
const wanted = new Set();
let iconsChanged = null, redrawSoon = false;
export function onIcons(fn) { iconsChanged = fn; }
function iconReady() {
  if (redrawSoon || !iconsChanged) return;
  redrawSoon = true;
  requestAnimationFrame(() => { redrawSoon = false; iconsChanged(); });
}
// the game's own tile for a look (an artifact's: its base item's, for its sprite; starting armour's: its own)
export const gameTile = (t) => (isCorpse(t) ? corpseSprite ?? t : isStart(t) ? startBase(t) : artBase.get(t) ?? t);
// (a corpse's picture: its brick, drawn once for each kind of monster, those that show it told when it's ready)
const corpseIcons = new Map();
function corpseIcon(t) {
  const mon = monNames[t - CORPSE_TILE];
  if (!mon || !monUrls[mon]) return null;
  if (corpseIcons.has(mon)) return corpseIcons.get(mon) || null;
  corpseIcons.set(mon, null);
  const { loader } = kit();
  new Promise((res, rej) => loader.load(monUrls[mon], res, undefined, rej))
    .then((g) => drawIcon(corpsePiece(g.scene, mon)))
    .then((png) => { if (png) { corpseIcons.set(mon, png); iconReady(); } })
    .catch(() => {});
  return null;
}

// the hero's figure (and its wardrobe swaps): each slot's piece of its design, and
// its picture; resolves when they're all in (then redraw what shows them)
export async function setStartPieces(fig, parts) {
  pieces.clear();
  const q = `base=${encodeURIComponent(fig)}&parts=${encodeURIComponent(JSON.stringify(parts || {}))}`;
  await Promise.all(SLOTS.map(async (slot) => {
    const r = await fetch(`/api/piece?${q}&slot=${slot}`).then((x) => x.json()).catch(() => null);
    if (r && r.url) pieces.set(slot, { url: r.url, icon: await renderIcon(r.url) });
  }));
}

// load the list and draw the pictures; resolves when they're all done
export function loadBrickItems() {
  if (!readyP)
    readyP = Promise.all([
      fetch('assets/brick/items.built.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})),
      fetch('assets/slashem/tiles.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { names: [] })),
      fetch('assets/brick/artifacts.built.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
      fetch('assets/brick/monsters.built.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]).then(async ([items, tiles, arts, mons]) => {
      // (the monsters: the tile sheet's first tiles (a corpse's whose), and their models)
      monNames = (tiles.names || []).slice(0, 2000);
      monUrls = Object.fromEntries(Object.entries(mons).filter(([k]) => !k.includes('|')).map(([k, m]) => [k, m.url]));
      if (items['_chain link']) chainLinkUrl = items['_chain link'].url; // (the punished hero's chain, link by link)
      builtItems = items;
      const tileOf = new Map(); // an item's real name (lower case) -> its game tile
      (tiles.names || []).forEach((n, i) => {
        const real = n.split(' / ').pop();
        const key = real.toLowerCase().replace(/-/g, ' '); // (the engine's names have no hyphens: "two handed sword")
        if (!tileOf.has(key)) tileOf.set(key, i);
        // only an item of its own class: a ring of see invisible isn't the potion (tiles.json "classes", items "oc")
        const cls = tiles.classes && tiles.classes[i];
        const it = items[(PREFIX[cls] || '') + real] || items[real]; // ("ring of see invisible": a ring's own; or the plain name)
        if (it && (!it.oc || !cls || it.oc === cls)) byTile.set(i, { name: real, ...it });
      });
      // (no corpse in its one look, ever: each is its own monster's brick; the plain corpse's sprite, for one with none)
      for (const [t, it] of [...byTile]) if (it.name === 'corpse') { corpseSprite = t; byTile.delete(t); }
      // artifacts: the game sends each as a tile of its own (winweb.c web_obj_tile): its own
      // brick look if it has one, or else its base item's (model, or sprite)
      for (const [t, a] of Object.entries(arts)) {
        const tile = +t, base = tileOf.get(String(a.base).toLowerCase().replace(/-/g, ' '));
        if (base != null) artBase.set(tile, base);
        const own = items[a.name];
        if (own) byTile.set(tile, { name: a.name, ...own });
        else if (base != null && byTile.has(base)) byTile.set(tile, byTile.get(base));
      }
      // variants with a look of their own (holy water): sent as a tile of their own too
      // (winweb.c web_obj_tile), shown as their base item's sprite where there's no model
      for (const [name, it] of Object.entries(items)) {
        if (!it.base || it.vtile == null) continue;
        const base = tileOf.get(it.base.toLowerCase());
        if (base != null) artBase.set(it.vtile, base);
        byTile.set(it.vtile, { name, ...it });
      }
      await drawIcons();
    }).catch((e) => console.warn('brick items:', e));
  return readyP;
}

const ICON = 192; // px (shown smaller: crisp on big and high-DPI screens)
let iconKit = null; // a renderer, scene and loader, kept for pictures drawn later (the hero's pieces)
function kit() {
  if (iconKit) return iconKit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ICON;
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(2, 5, 6);
  scene.add(sun);
  return (iconKit = { canvas, r, scene, loader: new GLTFLoader(), env: gradientEnvironment(THREE, r) });
}
// a model's picture: laid diagonally, blade to the top right, turned a little toward you; or (opts.rot: [x, y, z]
// radians, opts.turn: about the view) posed as asked; opts.empty: drawn as a ghost of itself, dark and see-through
// (the status bars' spent hearts: ui.js hudIcons)
export async function renderIcon(url, opts = {}) {
  const { loader } = kit();
  const g = await new Promise((res, rej) => loader.load(url, res, undefined, rej)).catch(() => null);
  return g ? drawIcon(g.scene, opts) : null;
}
// ...a model (an Object3D) pictured so
function drawIcon(m, opts = {}) {
  const { canvas, r, scene, env } = kit();
  m.traverse((o) => {
    if (!o.isMesh) return;
    o.material.flatShading = true;
    if (o.material.metalness > 0.5) { o.material.envMap = env; o.material.envMapIntensity = 1.2; } // chrome: reflects (envmap.js)
    if (o.material.transparent) { o.material.emissive = o.material.color.clone(); o.material.emissiveIntensity = 0.8; o.material.opacity = 0.85; }
    if (opts.empty) { o.material = o.material.clone(); o.material.color.setRGB(0.16, 0.16, 0.18); o.material.emissive = new THREE.Color(0); o.material.envMap = null; o.material.transparent = true; o.material.opacity = 0.5; o.material.depthWrite = false; }
  });
  const holder = new THREE.Group();
  holder.add(m);
  m.rotation.set(...(opts.rot || [0.35, 0.5, 0]));
  holder.rotation.z = opts.turn ?? -Math.PI / 4;
  scene.add(holder);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const half = Math.max(s.x, s.y) / 2 * 1.08;
  const cam = new THREE.OrthographicCamera(c.x - half, c.x + half, c.y + half, c.y - half, -100, 100);
  cam.position.set(0, 0, 10);
  r.render(scene, cam);
  const png = canvas.toDataURL('image/png');
  scene.remove(holder);
  return png;
}
async function drawIcons() {
  if (!byTile.size) return;
  const done = new Map(); // url -> data URL (one picture per model)
  const draw = async (t) => {
    const item = byTile.get(t);
    if (!done.has(item.url)) {
      const png = await renderIcon(item.url);
      if (!png) return;
      done.set(item.url, png);
    }
    icons.set(t, done.get(item.url));
  };
  // first, what's on screen: a redraw asks for its pictures (wanted), a frame before drawing starts
  iconReady();
  await new Promise((res) => { requestAnimationFrame(res); setTimeout(res, 60); }); // (a hidden tab has no frames)
  for (const t of byTile.keys()) {
    // whatever's been asked for meanwhile (on screen), first
    while (wanted.size) {
      const w = wanted.values().next().value;
      wanted.delete(w);
      if (!icons.has(w)) { await draw(w); iconReady(); }
    }
    if (!icons.has(t)) await draw(t);
  }
  wanted.clear();
}

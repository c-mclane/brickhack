// NetHack's items as LEGO (web/assets/lego/items.json, built by
// tools/build_items.py): which game tile (sprite) is which LEGO item, and a
// picture of each for the inventory and hotbar, rendered once from its model:
// laid diagonally, blade to the top right, Minecraft-style.
//
// The tile sheet's names (assets/slashem/tiles.json) are 'appearance / real
// name' ("runed broadsword / elven broadsword"); an item's tile is the same
// whether it's been identified or not, so the real name finds it.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const byTile = new Map(); // tile -> {name, url, lego}
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

export const legoItemForTile = (t) => {
  if (isStart(t)) {
    const p = pieces.get(startSlot(t)), base = byTile.get(startBase(t));
    return p ? { name: base ? base.name : '', url: p.url, lego: 'its own, from your design', upright: UPRIGHT.has(startSlot(t)), start: true } : base || null;
  }
  return byTile.get(t) || null;
};
export const legoIconForTile = (t) => {
  if (isStart(t)) { const p = pieces.get(startSlot(t)); return (p && p.icon) || icons.get(startBase(t)) || null; }
  return icons.get(t) || null;
};
// the game's own tile for a look (an artifact's: its base item's, for its sprite; starting armour's: its own)
export const gameTile = (t) => (isStart(t) ? startBase(t) : artBase.get(t) ?? t);

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
export function loadLegoItems() {
  if (!readyP)
    readyP = Promise.all([
      fetch('assets/lego/items.built.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})),
      fetch('assets/slashem/tiles.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { names: [] })),
      fetch('assets/lego/artifacts.built.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]).then(async ([items, tiles, arts]) => {
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
      // artifacts: the game sends each as a tile of its own (winweb.c web_obj_tile): its own
      // LEGO look if it has one, or else its base item's (model, or sprite)
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
    }).catch((e) => console.warn('LEGO items:', e));
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
  return (iconKit = { canvas, r, scene, loader: new GLTFLoader() });
}
// a model's picture: laid diagonally, blade to the top right, turned a little toward you
async function renderIcon(url) {
  const { canvas, r, scene, loader } = kit();
  const g = await new Promise((res, rej) => loader.load(url, res, undefined, rej)).catch(() => null);
  if (!g) return null;
  const m = g.scene;
  m.traverse((o) => {
    if (!o.isMesh) return;
    o.material.flatShading = true;
    if (o.material.transparent) { o.material.emissive = o.material.color.clone(); o.material.emissiveIntensity = 0.8; o.material.opacity = 0.85; }
  });
  const holder = new THREE.Group();
  holder.add(m);
  m.rotation.set(0.35, 0.5, 0);
  holder.rotation.z = -Math.PI / 4;
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
  for (const [t, item] of byTile) {
    if (!done.has(item.url)) {
      const png = await renderIcon(item.url);
      if (!png) continue;
      done.set(item.url, png);
    }
    icons.set(t, done.get(item.url));
  }
}

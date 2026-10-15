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
const icons = new Map(); // tile -> data URL
let readyP = null;

export const legoItemForTile = (t) => byTile.get(t) || null;
export const legoIconForTile = (t) => icons.get(t) || null;

// load the list and draw the pictures; resolves when they're all done
export function loadLegoItems() {
  if (!readyP)
    readyP = Promise.all([
      fetch('assets/lego/items.built.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})),
      fetch('assets/slashem/tiles.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { names: [] })),
    ]).then(async ([items, tiles]) => {
      (tiles.names || []).forEach((n, i) => {
        const real = n.split(' / ').pop();
        if (items[real]) byTile.set(i, { name: real, ...items[real] });
      });
      await drawIcons();
    }).catch((e) => console.warn('LEGO items:', e));
  return readyP;
}

const ICON = 128; // px (shown smaller: crisp on big screens)
async function drawIcons() {
  if (!byTile.size) return;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ICON;
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(2, 5, 6);
  scene.add(sun);
  const loader = new GLTFLoader();
  const done = new Map(); // url -> data URL (one picture per model)
  for (const [t, item] of byTile) {
    if (!done.has(item.url)) {
      const g = await new Promise((res, rej) => loader.load(item.url, res, undefined, rej)).catch(() => null);
      if (!g) continue;
      const m = g.scene;
      m.traverse((o) => {
        if (!o.isMesh) return;
        o.material.flatShading = true;
        if (o.material.transparent) { o.material.emissive = o.material.color.clone(); o.material.emissiveIntensity = 0.8; o.material.opacity = 0.85; }
      });
      // blade to the top right, turned a little toward you
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
      done.set(item.url, canvas.toDataURL('image/png'));
      scene.remove(holder);
    }
    if (done.has(item.url)) icons.set(t, done.get(item.url));
  }
  r.dispose();
}

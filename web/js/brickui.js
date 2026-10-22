// The interface in brick. Its words that stand out (titles, a button's label, the splash, the song playing, your
// level) spelled in 1x1 tiles printed with silver letters (tools/build_roster.py ui_glyph_*: A-Z, 0-8, - . @ _; a 9 is
// a 6 turned round; anything else a gap), and a button a plate (ui_plate, tinted) with its label laid on its studs;
// the experience bar a row of studs filling with green, the panels studded. Each picture drawn once (cached by what
// it shows) and put on the element as its background, the element's own text kept (and still read) but not shown.
// Long text (messages, menus, item names) stays in its font.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const PARTS = 'assets/brick/parts/';
const GLYPHS = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.@_');
const PX = 40; // px a stud, drawn (shown at whatever size)

let theKit = null;
function kit() {
  if (theKit) return theKit;
  const canvas = document.createElement('canvas');
  let r;
  try { r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true }); }
  catch (e) { plain(); throw e; }
  r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(-2, 6, 5);
  scene.add(sun);
  return (theKit = { canvas, r, scene, loader: new GLTFLoader() });
}
const models = new Map();
function model(name) {
  if (!models.has(name)) models.set(name, new Promise((res, rej) => kit().loader.load(PARTS + name + '.glb', (g) => res(g.scene), undefined, rej)));
  return models.get(name);
}
const glyphPart = (ch) => `ui_glyph_${(ch === '9' ? '6' : ch).charCodeAt(0)}`;
// (no brick to be had (no WebGL, the parts not built): the interface as it was, shown; it's hidden till it's in brick,
// index.html's html.brick-ui, so it's never seen in its plain dress first)
function plain() { document.documentElement.classList.remove('brick-ui'); }

// text in lines of at most `wrap` letters (0: one line), broken between words
function lines(text, wrap) {
  if (!wrap) return [text];
  const out = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const last = out[out.length - 1];
    if (last != null && last.length + 1 + w.length <= wrap) out[out.length - 1] = last + ' ' + w;
    else out.push(w);
  }
  return out.length ? out : [''];
}
// (a model's materials made its own, each recoloured: fn(material) -> a colour, or null to leave it)
function recolour(root, fn) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const one = (m) => { const c = fn(m); if (c == null) return m; const n = m.clone(); n.color = new THREE.Color(c); n.metalness = Math.min(n.metalness, 0.3); return n; };
    o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
  });
}
const isInk = (m) => m.color.r + m.color.g + m.color.b > 0.35; // (a letter tile: its body black, its print silver)

// A picture of `text` in tiles: {url, w, h (px), studs: [across, down]}. opts: plate (a colour: laid on a plate of it,
// a stud spare at each end), tile, ink (the tiles' colour, the letters': black and a bright silver, if not given),
// wrap (letters a line), tilt (radians: tipped back, its front edge seen; 0: straight down on it)
const drawn = new Map();
export function brickText(text, opts = {}) {
  const key = JSON.stringify([text, opts]);
  if (!drawn.has(key)) drawn.set(key, draw(text, opts).catch((e) => { console.warn('brick text:', e); return null; }));
  return drawn.get(key);
}
async function draw(text, opts) {
  try { return await drawn1(text, opts); } catch (e) { plain(); throw e; }
}
async function drawn1(text, { plate = null, tile = null, ink = null, wrap = 0, tilt = 0.45, pad = plate == null ? 0 : 1 } = {}) {
  const rows = lines(String(text).toUpperCase().replace(/\s+/g, ' ').trim(), wrap);
  const across = Math.max(1, ...rows.map((r) => r.length)) + 2 * pad;
  const holder = new THREE.Group(), g = new THREE.Group();
  holder.add(g);
  const plateM = plate != null ? await model('ui_plate') : null;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r], off = pad + Math.floor((across - 2 * pad - row.length) / 2);
    if (plateM) for (let c = 0; c < across; c++) {
      const p = plateM.clone();
      recolour(p, () => plate);
      p.position.set(c, 0, r);
      g.add(p);
    }
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (!GLYPHS.has(ch)) continue; // (a space, or no tile for it: a gap, bare studs)
      const t = (await model(glyphPart(ch))).clone();
      recolour(t, (m) => (isInk(m) ? ink ?? 0xeef0f2 : tile)); // (the silver bright: unlit by any room, printed silver is dull grey)
      t.position.set(off + i, plateM ? 0.4 : 0, r);
      if (ch === '9') t.rotation.y = Math.PI; // (the 6, turned round)
      g.add(t);
    }
  }
  // tipped up to face you, the rows running down, its front edge showing as much as `tilt` shows it
  holder.rotation.x = Math.PI / 2 - tilt;
  const { canvas, r, scene } = kit();
  scene.add(holder);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const m = 0.06, x0 = box.min.x - m, x1 = box.max.x + m, y0 = box.min.y - m, y1 = box.max.y + m;
  const w = Math.max(2, Math.round((x1 - x0) * PX)), h = Math.max(2, Math.round((y1 - y0) * PX));
  canvas.width = w; canvas.height = h;
  r.setSize(w, h, false);
  const cam = new THREE.OrthographicCamera(x0, x1, y1, y0, -100, 100);
  cam.position.set(0, 0, 50);
  r.render(scene, cam);
  const url = canvas.toDataURL('image/png');
  scene.remove(holder);
  return { url, w, h, studs: [across, rows.length] };
}

// ---- put on the page
// what's made of tiles, and how: selector -> {opts, size (px a stud shown), box ('fit': drawn to fit the element as
// it is, a button; else the element sized to the picture)}
const BUTTON = { opts: { plate: 0xa0a5a9, tilt: 0.5 }, box: 'fit' };
const ROLES = [
  ['.mc-btn', BUTTON],
  ['.screen h1', { opts: { wrap: 20 }, size: 44 }],
  ['.screen h2', { opts: { wrap: 26 }, size: 26 }],
  ['.menu-panel .title', { opts: { wrap: 30 }, size: 20, max: 60 }],
  ['#title .splash', { opts: { tile: 0xf2cd37, ink: 0x4a3a00, wrap: 12 }, size: 20 }],
  ['#nowplaying', { opts: { tile: 0xc91a09, wrap: 28 }, size: 17, center: true }],
  ['#xp .lvl', { opts: { tile: 0x4b9f4a }, size: 18, center: true }],
];
function apply(el, role) {
  const text = el.textContent.trim();
  if (el.dataset.brick === text) return;
  el.dataset.brick = text;
  if (!text || (role.max && text.length > role.max)) { el.classList.remove('brick-tiles', 'brick-btn'); el.style.backgroundImage = ''; if (role.box !== 'fit') el.style.width = el.style.height = ''; el.dataset.brickOk = '1'; return; }
  brickText(text, role.opts).then((p) => {
    if (el.dataset.brick !== text) return;
    el.dataset.brickOk = '1'; // (shown now: in brick, or (no picture) as it was)
    if (!p) return;
    el.style.backgroundImage = `url(${p.url})`;
    if (role.box === 'fit') { el.classList.add('brick-btn'); return; }
    el.classList.add('brick-tiles');
    const k = role.size / PX; // (shown at so many px a stud)
    if (role.center) { el.style.height = Math.round(p.h * k) + 'px'; el.style.backgroundSize = `${Math.round(p.w * k)}px ${Math.round(p.h * k)}px`; }
    else { el.style.width = Math.round(p.w * k) + 'px'; el.style.height = Math.round(p.h * k) + 'px'; }
  });
}
function scan(root) {
  for (const [sel, role] of ROLES) {
    if (root.matches && root.matches(sel)) apply(root, role);
    if (root.querySelectorAll) root.querySelectorAll(sel).forEach((el) => apply(el, role));
  }
}

// studs, for a bar or a panel: a 1x1 plate of `colour` seen straight down, to repeat
export async function studTile(colour) {
  const p = await brickText(' ', { plate: colour, pad: 0, tilt: 0 });
  return p && p.url;
}

// everything in brick from now on: what's on the page, and whatever's put on it or changed
export function brickInterface() {
  Promise.all(['ui_plate', ...[...GLYPHS].filter((c) => c !== '9').map(glyphPart)].map(model)).catch(plain); // (every part fetched at once, not one by one as each word's spelled)
  scan(document.body);
  let queued = new Set();
  new MutationObserver((list) => {
    for (const m of list) queued.add(m.target.nodeType === 1 ? m.target : m.target.parentElement);
    requestAnimationFrame(() => {
      const q = queued; queued = new Set();
      for (const el of q) if (el) { scan(el); let p = el.parentElement; for (let i = 0; i < 3 && p; i++, p = p.parentElement) for (const [sel, role] of ROLES) if (p.matches(sel)) apply(p, role); }
    });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  // the experience bar's studs, dark, filling green; the panels studded grey
  Promise.all([studTile(0x1b2a34), studTile(0x4b9f4a), studTile(0xc6c6c6)]).then(([dark, green, grey]) => {
    const st = document.createElement('style');
    st.textContent = `#xp { background: #10161b url(${dark}) repeat-x left center / auto 100%; }
      #xp .fill { background: #3d8a3c url(${green}) repeat-x left center / auto 100%; }
      .mc-panel { background-image: url(${grey}); background-size: 24px 24px; }
      .mc-slider input { background: #10161b url(${dark}) repeat-x left center / auto 100%; }`;
    document.head.appendChild(st);
  });
}

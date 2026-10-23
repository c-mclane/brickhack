// Wands zapped and spells cast, played out (BrickWorld: brick levels). The engine tells of a zap (winweb.c web_zap: the
// hero's, into the wand pose) and of every ray it draws (web_beam_*: a wand's, a spell's, a breath; bounced off walls,
// each stretch its own; a digging beam, a camera's flash, an explosion), and of the line of a wand or spell that strikes
// the first thing in its way (web_zapline: striking, teleportation, healing...). Each is played out here, one after
// another, the game's replies held till it's done (main.js holdReplies): a bolt of glowing specks and streaming brick
// pieces flying from the wand along its path (a flame's fire, a frost's ice, lightning crackling, a magic missile a blast
// of light), bursting where it ends; an explosion a ball of fire (frost, gas...) flung out; a zap with no way to go (a
// wand of light, a spell of healing) about the caster: hearts rising, a halo, a burst of light.
//
// Light: specks, additive (a glow texture, each its own colour, size and life); pieces: brick parts (assets/brick/parts
// fx_*: a stud, a star, a heart, a flame, a lightning bolt, a gem), each colour an instanced mesh of its own, glowing in
// it; and a few moving lights.

import * as THREE from 'three';
import { MODEL_SCALE, STUD_H } from './brick.js';
import { zapSound, hitSound, auraSound } from './zapsound.js';

const PARTS = 'assets/brick/parts/';
export const ZAP_AT = 0.62; // s into the wand pose (FOUNT.zap) the wand's flicked and the bolt is away
const HAND = 0.62; // a bolt flies this high over the floor (a wand held out at the shoulder)
const SPEED = 10; // squares a second
const MAXP = 6000; // specks at once

let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.75)'); r.addColorStop(0.6, 'rgba(255,255,255,0.18)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return (glowTex = new THREE.CanvasTexture(c));
}

// ---- what each looks like. A ray's kind (0-7: winweb.c), a digging beam (8), a flash (9), an explosion (10+its type),
// or a wand's or spell's name ("striking", "healing"; "wand:fire", "spell:fireball" from a zap)
const RAY = [
  { name: 'magic missile', c: 0x8fdcff, c2: 0xffffff, piece: 'star', piece2: 'stud', mode: 'blast', hit: 'blast' },
  { name: 'fire', c: 0xff6a12, c2: 0xffd23a, piece: 'flame', piece2: 'stud', mode: 'ray', hit: 'fire', smoke: true },
  { name: 'cold', c: 0x9fe9ff, c2: 0xffffff, piece: 'gem', piece2: 'stud', mode: 'ray', hit: 'frost' },
  { name: 'sleep', c: 0xc070ff, c2: 0xffb8ff, piece: 'star', piece2: 'stud', mode: 'ray', hit: 'swirl' },
  { name: 'death', c: 0x3cff6a, c2: 0x0a1a0a, piece: 'stud', piece2: 'stud', mode: 'ray', hit: 'smoke', dark: true },
  { name: 'lightning', c: 0xbfe6ff, c2: 0xffffff, piece: 'bolt', piece2: 'stud', mode: 'lightning', hit: 'flash' },
  { name: 'poison gas', c: 0x7fff3f, c2: 0xd8ff8a, piece: 'stud', piece2: 'stud', mode: 'cloud', hit: 'cloud' },
  { name: 'acid', c: 0xc8ff2a, c2: 0xf6ff9a, piece: 'stud', piece2: 'gem', mode: 'spray', hit: 'splash' },
  { name: 'digging', c: 0xb07a3a, c2: 0x6b4423, piece: 'stud', piece2: 'stud', mode: 'spray', hit: 'dust' },
  { name: 'flash', c: 0xffffff, c2: 0xfff4c0, piece: 'star', piece2: 'stud', mode: 'flash', hit: 'flash' },
];
const BOOM = [0x3a3550, 0x7fff3f, 0x8a5a2b, 0x4aa8ff, 0xff70ff, 0xff6a12, 0x9fe9ff, 0xfff7b0, 0x9a40ff, 0xbfe6ff]; // explosions: dark, noxious, muddy, wet, magical, fiery, frosty; and monsters' own bursts: a blinding light (a yellow light), a black light's, a shock (a shocking sphere)
const NAMED = { // (a bolt that strikes the first thing in its way; and a zap with nowhere to go)
  striking: { c: 0xffffff, c2: 0xcfe8ff, piece: 'stud', hit: 'blast' }, 'force bolt': { c: 0xffffff, c2: 0xbfe0ff, piece: 'star', hit: 'blast' },
  'make invisible': { c: 0xe8ffff, c2: 0xffffff, piece: 'gem', hit: 'fade' }, invisibility: { c: 0xe8ffff, c2: 0xffffff, piece: 'gem', hit: 'fade' },
  'slow monster': { c: 0x4a6cff, c2: 0x9fb4ff, piece: 'stud', hit: 'sink' }, 'speed monster': { c: 0xffe14a, c2: 0xffffff, piece: 'bolt', hit: 'streak' },
  'haste self': { c: 0xffe14a, c2: 0xffffff, piece: 'bolt', hit: 'streak' },
  'undead turning': { c: 0xffd700, c2: 0xfff6c0, piece: 'star', hit: 'holy' }, 'turn undead': { c: 0xffd700, c2: 0xfff6c0, piece: 'star', hit: 'holy' },
  polymorph: { c: 0xff40ff, c2: 0x40ffff, piece: 'star', hit: 'rainbow', rainbow: true }, cancellation: { c: 0xb8b8c8, c2: 0xffffff, piece: 'stud', hit: 'ring' },
  teleportation: { c: 0xb05cff, c2: 0xf0c8ff, piece: 'star', hit: 'vanish' }, 'teleport away': { c: 0xb05cff, c2: 0xf0c8ff, piece: 'star', hit: 'vanish' },
  opening: { c: 0xffc04a, c2: 0xfff0b0, piece: 'gem', hit: 'ring' }, knock: { c: 0xffc04a, c2: 0xfff0b0, piece: 'gem', hit: 'ring' },
  locking: { c: 0x8899aa, c2: 0xdde6ee, piece: 'stud', hit: 'ring' }, 'wizard lock': { c: 0x8899aa, c2: 0xdde6ee, piece: 'stud', hit: 'ring' },
  probing: { c: 0x4af0ff, c2: 0xd0ffff, piece: 'stud', hit: 'scan' }, nothing: { c: 0x9a9aa0, c2: 0xcfcfd4, piece: 'stud', hit: 'fizzle', faint: true },
  'drain life': { c: 0xa0001a, c2: 0x2a0008, piece: 'stud', hit: 'smoke' }, 'stone to flesh': { c: 0xe8b88a, c2: 0xfff0e0, piece: 'stud', hit: 'burst' },
  healing: { c: 0xff6fae, c2: 0xffd0e4, piece: 'heart', hit: 'hearts' }, 'extra healing': { c: 0xff3f8f, c2: 0xffd0e4, piece: 'heart', hit: 'hearts' },
  'cure blindness': { c: 0xff9fc8, c2: 0xffffff, piece: 'heart', hit: 'hearts' }, 'cure sickness': { c: 0xff9fc8, c2: 0xd8ffd8, piece: 'heart', hit: 'hearts' },
  'restore ability': { c: 0xff7fbf, c2: 0xffe0f0, piece: 'heart', hit: 'hearts' },
  light: { c: 0xfff2a0, c2: 0xffffff, piece: 'star', hit: 'light' }, 'create monster': { c: 0x9a3fe0, c2: 0x3a1050, piece: 'stud', hit: 'summon' },
  'summon undead': { c: 0x4a7a4a, c2: 0x101a10, piece: 'stud', hit: 'summon' }, 'create familiar': { c: 0xd88aff, c2: 0xffffff, piece: 'heart', hit: 'summon' },
  wishing: { c: 0xffd700, c2: 0xffffff, piece: 'star', hit: 'wish' }, enlightenment: { c: 0xffffff, c2: 0xffe080, piece: 'star', hit: 'halo', rainbow: true },
  enlighten: { c: 0xffffff, c2: 0xffe080, piece: 'star', hit: 'halo', rainbow: true }, clairvoyance: { c: 0x8fd8ff, c2: 0xffffff, piece: 'star', hit: 'halo' },
  identify: { c: 0xffffff, c2: 0xbfe8ff, piece: 'star', hit: 'halo' },
  'secret door detection': { c: 0x4af0ff, c2: 0xd0ffff, piece: 'stud', hit: 'pulse' }, 'detect unseen': { c: 0x4af0ff, c2: 0xd0ffff, piece: 'stud', hit: 'pulse' },
  'detect monsters': { c: 0xff5050, c2: 0xffd0d0, piece: 'stud', hit: 'pulse' }, 'detect food': { c: 0xffa040, c2: 0xffe0b0, piece: 'stud', hit: 'pulse' },
  'detect treasure': { c: 0xffd700, c2: 0xfff2a0, piece: 'gem', hit: 'pulse' }, 'magic mapping': { c: 0x6aa8ff, c2: 0xe0eeff, piece: 'stud', hit: 'pulse' },
  levitation: { c: 0xeef6ff, c2: 0xffffff, piece: 'stud', hit: 'rise' }, jumping: { c: 0xc8a070, c2: 0xffffff, piece: 'stud', hit: 'dust' },
  protection: { c: 0x5aa8ff, c2: 0xe0f0ff, piece: 'stud', hit: 'shield' },
  'remove curse': { c: 0xffe27a, c2: 0xffffff, piece: 'star', hit: 'swirl' }, 'enchant weapon': { c: 0x6ad8ff, c2: 0xffffff, piece: 'star', hit: 'swirl' },
  'enchant armor': { c: 0xffd700, c2: 0xffffff, piece: 'star', hit: 'swirl' }, charging: { c: 0xfff060, c2: 0xffffff, piece: 'bolt', hit: 'swirl' },
  'confuse monster': { c: 0xff60d0, c2: 0xffd0f0, piece: 'star', hit: 'swirl' }, 'cause fear': { c: 0x6a2080, c2: 0x200820, piece: 'stud', hit: 'smoke' },
  'charm monster': { c: 0xff70b0, c2: 0xffffff, piece: 'heart', hit: 'hearts' }, 'command undead': { c: 0x4a7a4a, c2: 0x101a10, piece: 'stud', hit: 'smoke' },
  'resist poison': { c: 0x7fff3f, c2: 0xffffff, piece: 'stud', hit: 'swirl' }, 'resist sleep': { c: 0xc070ff, c2: 0xffffff, piece: 'star', hit: 'swirl' },
  'endure cold': { c: 0x9fe9ff, c2: 0xffffff, piece: 'gem', hit: 'swirl' }, 'endure heat': { c: 0xff6a12, c2: 0xffd23a, piece: 'flame', hit: 'swirl' },
  insulate: { c: 0xbfe6ff, c2: 0xffffff, piece: 'bolt', hit: 'swirl' }, 'flame sphere': { c: 0xff6a12, c2: 0xffd23a, piece: 'flame', hit: 'fire' },
  'freeze sphere': { c: 0x9fe9ff, c2: 0xffffff, piece: 'gem', hit: 'frost' }, 'finger of death': RAY[4], sleep: RAY[3], dig: RAY[8], digging: RAY[8],
};
const FALLBACK = { c: 0xc89cff, c2: 0xffffff, piece: 'star', hit: 'swirl' };
const RAYS_BY_NAME = { 'magic missile': 0, fire: 1, fireball: 1, cold: 2, 'cone of cold': 2, sleep: 3, death: 4, 'finger of death': 4, lightning: 5,
  'poison blast': 6, 'acid stream': 7, digging: 8, dig: 8 };
export function styleOf(k) {
  if (typeof k === 'number') return k >= 10 ? { name: 'explosion', c: BOOM[k - 10] ?? 0xff6a12, c2: k === 18 ? 0xff60ff : 0xffffff, piece: { 15: 'flame', 16: 'gem', 17: 'star', 18: 'star', 19: 'bolt' }[k] || 'stud', piece2: 'stud', mode: 'explosion', hit: k === 19 ? 'flash' : 'blast', smoke: k === 15, dark: k === 10, gas: k === 11 } : RAY[k] || FALLBACK;
  const n = String(k).replace(/^(wand|spell):/, '');
  if (NAMED[n]) return { name: n, mode: 'bolt', piece2: 'stud', ...NAMED[n] };
  if (n in RAYS_BY_NAME) return RAY[RAYS_BY_NAME[n]];
  return { name: n, mode: 'bolt', piece2: 'stud', ...FALLBACK };
}
const rnd = (a, b) => a + Math.random() * (b - a);
const easeOut = (u) => 1 - (1 - u) * (1 - u);

export class SpellFX {
  constructor(brick) {
    this.brick = brick;
    this.live = []; // effects playing: {t0 (s), dur, step(t, dt), done}
    this.free = 0; // (s) when the last queued effect's done: the next starts then
    this.pieces = new Map(); // `${part}|${colour}` -> {mesh, list}
    this.partGeo = new Map();
    for (const n of ['stud', 'star', 'heart', 'flame', 'bolt', 'gem']) this.geo(n);
    // the specks: one buffer, each its own position, colour, size, alpha
    const g = new THREE.BufferGeometry();
    this.sp = { pos: new Float32Array(MAXP * 3), col: new Float32Array(MAXP * 3), size: new Float32Array(MAXP), alpha: new Float32Array(MAXP),
      v: new Float32Array(MAXP * 3), life: new Float32Array(MAXP), age: new Float32Array(MAXP), s0: new Float32Array(MAXP), fall: new Float32Array(MAXP), n: 0 };
    g.setAttribute('position', new THREE.BufferAttribute(this.sp.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.sp.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.sp.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.sp.alpha, 1));
    const mat = (blending) => new THREE.ShaderMaterial({
      uniforms: { map: { value: glowTexture() } }, transparent: true, depthWrite: false, blending, vertexColors: true,
      vertexShader: `attribute float size; attribute float alpha; varying vec3 vC; varying float vA;
        void main() { vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * (520.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA;
        void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA); }`,
    });
    this.points = new THREE.Points(g, mat(THREE.NormalBlending)); // (in their own colours, laid over: light added would wash out against the pale floors)
    this.points.frustumCulled = false; this.points.renderOrder = 6;
    brick.world.add(this.points);
    // (dark specks, smoke and shadow: laid over, not added)
    const gd = new THREE.BufferGeometry();
    this.dk = { pos: new Float32Array(MAXP * 3 / 4), col: new Float32Array(MAXP * 3 / 4), size: new Float32Array(MAXP / 4), alpha: new Float32Array(MAXP / 4),
      v: new Float32Array(MAXP * 3 / 4), life: new Float32Array(MAXP / 4), age: new Float32Array(MAXP / 4), s0: new Float32Array(MAXP / 4), fall: new Float32Array(MAXP / 4), n: 0, max: MAXP / 4 };
    gd.setAttribute('position', new THREE.BufferAttribute(this.dk.pos, 3));
    gd.setAttribute('color', new THREE.BufferAttribute(this.dk.col, 3));
    gd.setAttribute('size', new THREE.BufferAttribute(this.dk.size, 1));
    gd.setAttribute('alpha', new THREE.BufferAttribute(this.dk.alpha, 1));
    this.darkPoints = new THREE.Points(gd, mat(THREE.NormalBlending));
    this.darkPoints.frustumCulled = false; this.darkPoints.renderOrder = 6;
    brick.world.add(this.darkPoints);
    this.sp.max = MAXP;
    // lights that go with the bolts and the bursts
    this.lights = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffffff, 0, 5, 1.6); brick.world.add(l); return l; });
    this.last = performance.now() / 1000;
  }

  // a piece's geometry (its part, assets/brick/parts/fx_<name>.glb: merged, in squares, its middle at the origin)
  geo(name) {
    if (!this.partGeo.has(name)) {
      this.partGeo.set(name, null);
      this.brick.partsOf(PARTS + 'fx_' + name + '.glb').then((parts) => {
        const geos = parts.map((p) => { const g = p.geometry.clone(); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g.index ? g.toNonIndexed() : g; });
        const n = geos.reduce((a, g) => a + g.attributes.position.count, 0), pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
        let o = 0;
        for (const g of geos) { pos.set(g.attributes.position.array, o * 3); if (g.attributes.normal) nrm.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        geo.computeBoundingBox(); const c = geo.boundingBox.getCenter(new THREE.Vector3()); geo.translate(-c.x, -c.y, -c.z); geo.scale(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
        if (!geo.attributes.normal.array.some((v) => v)) geo.computeVertexNormals();
        this.partGeo.set(name, geo);
      }).catch(() => {});
    }
    return this.partGeo.get(name);
  }
  // a brick piece thrown into the air (its part, its colour): {p, v, q, w, s (size), life, drag, fall (gravity), orbit}
  piece(part, color, o) {
    const geo = this.geo(part);
    if (!geo) return null;
    const key = `${part}|${color}`;
    let set = this.pieces.get(key);
    if (!set) {
      const c = new THREE.Color(color);
      const mat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.7, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 });
      const mesh = new THREE.InstancedMesh(geo, mat, 220);
      mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 5;
      this.brick.world.add(mesh);
      set = { mesh, list: [] };
      this.pieces.set(key, set);
    }
    if (set.list.length >= 220) set.list.shift();
    const p = { p: o.p.clone(), v: o.v ? o.v.clone() : new THREE.Vector3(), q: new THREE.Quaternion().random(), w: o.w || new THREE.Vector3(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8)),
      s: o.s ?? 1, life: o.life ?? 1, age: 0, drag: o.drag ?? 1.5, fall: o.fall ?? 0, orbit: o.orbit || null, upright: !!o.upright };
    if (p.upright) p.q.identity();
    set.list.push(p);
    return p;
  }
  // a speck of light (dark: laid over, smoke): at p, moving v, its colour, size, life (s), falling (gravity)
  speck(p, v, color, size, life, fall = 0, dark = false) {
    const S = dark ? this.dk : this.sp;
    if (S.n >= S.max) return;
    const i = S.n++, c = typeof color === 'number' ? new THREE.Color(color) : color;
    S.pos[i * 3] = p.x; S.pos[i * 3 + 1] = p.y; S.pos[i * 3 + 2] = p.z;
    S.v[i * 3] = v.x; S.v[i * 3 + 1] = v.y; S.v[i * 3 + 2] = v.z;
    S.col[i * 3] = c.r; S.col[i * 3 + 1] = c.g; S.col[i * 3 + 2] = c.b;
    S.s0[i] = size; S.size[i] = size; S.life[i] = life; S.age[i] = 0; S.alpha[i] = 1; S.fall[i] = fall;
  }
  light(p, color, k = 1) { // (the dimmest of the lights, brought here)
    const l = this.lights.reduce((a, b) => (a.intensity < b.intensity ? a : b));
    l.position.copy(p); l.color.set(color); l.intensity = Math.max(l.intensity, 2.4 * k);
    return l;
  }

  // ---- what's played: queued one after another. Each returns s till it's done, from now
  queue(dur, step) {
    const now = performance.now() / 1000, t0 = Math.max(now, this.free);
    this.free = t0 + dur;
    this.live.push({ t0, dur, step, last: 0 });
    return this.free - now;
  }
  // the next queued effect waits till then (s from now: the wand's flick)
  hold(s) { this.free = Math.max(this.free, performance.now() / 1000 + s); }
  busy() { return Math.max(0, this.free - performance.now() / 1000); }

  // a ray, a bolt, an explosion along these squares ([[x, y], ...]), from src (its first square, if it isn't in the list)
  beam(k, path, src) {
    const st = styleOf(k);
    const at = (x, y, h = HAND) => new THREE.Vector3(x + 0.5, STUD_H + h, y + 0.5);
    if (st.mode === 'explosion') {
      const cx = path.reduce((a, p) => a + p[0], 0) / path.length, cy = path.reduce((a, p) => a + p[1], 0) / path.length;
      const r = path.length > 4 ? 1.5 : 0.8;
      return this.queue(1.1, (t, dt, e) => this.explosion(st, at(cx, cy, 0.5), r, t, dt, e));
    }
    const pts = [];
    if (src && !(path[0] && path[0][0] === src[0] && path[0][1] === src[1])) pts.push(at(src[0], src[1]));
    for (const [x, y] of path) pts.push(at(x, y));
    if (pts.length < 2) pts.unshift(pts[0].clone().add(new THREE.Vector3(0, 0.001, 0)));
    // (from the wand's tip, a little out from the caster's middle, to the far side of the last square it reached)
    const d0 = pts[1].clone().sub(pts[0]).setY(0).normalize();
    pts[0].addScaledVector(d0, 0.32);
    const segs = [], lens = [];
    let L = 0;
    for (let i = 1; i < pts.length; i++) { const l = pts[i].distanceTo(pts[i - 1]); segs.push([pts[i - 1], pts[i]]); lens.push(l); L += l; }
    const along = (s) => { // (the point s squares along the path, and the way it's going there)
      let a = 0;
      for (let i = 0; i < segs.length; i++) { if (s <= a + lens[i] || i === segs.length - 1) { const u = lens[i] ? Math.min(1, Math.max(0, (s - a) / lens[i])) : 0; return { p: segs[i][0].clone().lerp(segs[i][1], u), d: segs[i][1].clone().sub(segs[i][0]).normalize() }; } a += lens[i]; }
      return { p: pts[pts.length - 1].clone(), d: d0 };
    };
    const speed = st.mode === 'lightning' ? 40 : st.mode === 'flash' ? 60 : st.mode === 'blast' ? SPEED * 0.9 : SPEED;
    const fly = Math.max(0.18, L / speed), hit = st.mode === 'lightning' ? 0.55 : 0.75;
    const end = pts[pts.length - 1];
    let hitDone = false;
    return this.queue(fly + hit + 0.25, (t, dt, e) => {
      const s = Math.min(L, t * speed), head = along(s);
      if (!e.sounded) { e.sounded = true; zapSound(st, 0, fly); } // (heard as it leaves the wand)
      if (t < fly + 0.05) this.trail(st, head, t, dt, along, s, L);
      if (t >= fly && !hitDone) { hitDone = true; this.impact(st, end, head.d); hitSound(st); }
      if (t >= fly) this.lingering(st, end, t - fly, dt);
    });
  }

  // a zap with no way to go: about the caster at (x, y) (a wand of light, a healing spell on yourself, a wish)
  self(k, x, y) {
    const st = styleOf(k), c = new THREE.Vector3(x + 0.5, STUD_H, y + 0.5);
    return this.queue(st.hit === 'light' || st.hit === 'wish' ? 1.6 : 1.4, (t, dt, e) => this.aura(st, c, t, dt, e));
  }

  // ---- the parts of it
  colourOf(st, mix = Math.random()) {
    if (st.rainbow) return new THREE.Color().setHSL(Math.random(), 1, 0.62);
    return new THREE.Color(st.c).lerp(new THREE.Color(st.c2), mix * 0.6);
  }
  trail(st, head, t, dt, along, s, L) {
    const n = st.mode === 'lightning' ? 0 : Math.ceil(dt * (st.faint ? 120 : 520));
    const side = new THREE.Vector3(-head.d.z, 0, head.d.x), up = new THREE.Vector3(0, 1, 0);
    // the head: a bright orb
    const orb = st.mode === 'blast' ? 0.26 : st.mode === 'cloud' ? 0.3 : 0.16;
    for (let i = 0; i < (st.faint ? 1 : 4); i++) this.speck(head.p, new THREE.Vector3(), st.mode === 'cloud' ? st.c : st.c2, orb * rnd(0.8, 1.4), 0.08);
    if (!st.dark) this.light(head.p, st.c, st.mode === 'blast' ? 1.3 : 1);
    for (let i = 0; i < n; i++) {
      const back = along(Math.max(0, s - rnd(0, 0.5)));
      const r = st.mode === 'cloud' ? rnd(0.05, 0.28) : rnd(0, 0.09), a = rnd(0, Math.PI * 2);
      const p = back.p.clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r);
      const v = new THREE.Vector3(rnd(-0.25, 0.25), rnd(-0.1, 0.35), rnd(-0.25, 0.25));
      if (st.mode === 'cloud') this.speck(p, v.multiplyScalar(0.6), st.c, rnd(0.18, 0.32), rnd(0.5, 0.9));
      else if (st.mode === 'spray') this.speck(p, v.add(new THREE.Vector3(0, -0.4, 0)), this.colourOf(st), rnd(0.04, 0.08), rnd(0.25, 0.5), 3);
      else this.speck(p, v, this.colourOf(st), rnd(0.04, 0.1) * (st.mode === 'blast' ? 1.4 : 1), rnd(0.2, 0.45));
      if (st.dark && Math.random() < 0.5) this.speck(p, v, 0x061006, rnd(0.08, 0.16), rnd(0.3, 0.6), 0, true);
      if (st.smoke && Math.random() < 0.08) this.speck(p.clone().add(new THREE.Vector3(0, 0.1, 0)), new THREE.Vector3(0, 0.35, 0), 0x404040, rnd(0.12, 0.22), 0.9, 0, true);
    }
    // the pieces streaming after it in a helix about its path
    const every = st.faint ? 0.09 : st.mode === 'blast' ? 0.018 : 0.03;
    this.acc = (this.acc || 0) + dt;
    while (this.acc > every) {
      this.acc -= every;
      const a = t * 18 + Math.random() * 0.4, r = st.mode === 'blast' ? 0.13 : 0.1;
      const p = head.p.clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r);
      const v = side.clone().multiplyScalar(-Math.sin(a) * 1.1).addScaledVector(up, Math.cos(a) * 1.1).addScaledVector(head.d, -0.6);
      this.piece(Math.random() < 0.7 ? st.piece : st.piece2 || st.piece, this.colourOf(st, Math.random()).getHex(), { p, v, s: rnd(0.55, 0.95), life: rnd(0.35, 0.7), drag: 2.5,
        fall: st.mode === 'spray' ? 2.5 : 0 });
    }
    if (st.mode === 'lightning') this.lightning(st, along, s, L, dt);
  }
  // lightning: a jagged line of light from the wand to where it's got, crackling (redrawn every frame), bolts flung off it
  lightning(st, along, s, L, dt) {
    const steps = Math.max(6, Math.ceil(s * 10));
    let prev = along(0).p;
    for (let i = 1; i <= steps; i++) {
      const q = along((s * i) / steps);
      const j = i === steps ? 0 : 0.12;
      const p = q.p.clone().add(new THREE.Vector3(rnd(-j, j), rnd(-j, j), rnd(-j, j)));
      for (let u = 0; u < 1; u += 0.12) this.speck(prev.clone().lerp(p, u), new THREE.Vector3(), Math.random() < 0.3 ? 0xffffff : st.c, rnd(0.05, 0.09), 0.05);
      if (Math.random() < 0.08) this.piece('bolt', 0xdff4ff, { p, v: new THREE.Vector3(rnd(-1.5, 1.5), rnd(0, 1.5), rnd(-1.5, 1.5)), s: rnd(0.7, 1), life: 0.4 });
      prev = p;
    }
    this.light(prev, 0xd0ecff, 1.6);
  }
  impact(st, p, d) {
    const hit = st.hit;
    const burst = (n, speed, color = null, piece = st.piece, size = 0.9) => {
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(0.4, 1) * speed);
        this.piece(Math.random() < 0.75 ? piece : st.piece2 || piece, color ?? this.colourOf(st).getHex(), { p, v, s: rnd(0.6, 1) * size, life: rnd(0.6, 1.1), drag: 1.2, fall: 2.5 });
      }
    };
    const sparks = (n, speed, color = null, size = 0.09) => { for (let i = 0; i < n; i++) this.speck(p, new THREE.Vector3(rnd(-1, 1), rnd(-0.3, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(0.2, 1) * speed), color ?? this.colourOf(st), rnd(0.5, 1.2) * size, rnd(0.3, 0.7)); };
    if (!st.dark) this.light(p, st.c, hit === 'blast' || hit === 'fire' || hit === 'flash' || hit === 'light' ? 2.2 : 1.3);
    switch (hit) {
      case 'blast': sparks(160, 3.2, null, 0.12); burst(22, 3.6); this.speck(p, new THREE.Vector3(), st.c2, 0.9, 0.18); this.ring(p, st.c, 1.2, 0.35); break;
      case 'fire': sparks(120, 2.2, null, 0.11); burst(16, 2.6, null, 'flame'); for (let i = 0; i < 14; i++) this.speck(p.clone().add(new THREE.Vector3(rnd(-0.2, 0.2), 0, rnd(-0.2, 0.2))), new THREE.Vector3(0, rnd(0.3, 0.7), 0), 0x303030, rnd(0.18, 0.3), rnd(0.8, 1.3), 0, true); break;
      case 'frost': sparks(90, 1.8, 0xffffff, 0.08); burst(18, 2.2, 0xd8f6ff, 'gem'); this.ring(p, 0xbff0ff, 0.9, 0.5); break;
      case 'swirl': this.spiral(p, st, 0.45, 0.9, 18); sparks(40, 1.2); break;
      case 'smoke': for (let i = 0; i < 30; i++) this.speck(p.clone().add(new THREE.Vector3(rnd(-0.25, 0.25), rnd(-0.2, 0.2), rnd(-0.25, 0.25))), new THREE.Vector3(rnd(-0.2, 0.2), rnd(0.2, 0.5), rnd(-0.2, 0.2)), st.dark ? 0x061006 : st.c2, rnd(0.2, 0.35), rnd(0.8, 1.2), 0, true); sparks(50, 1.4); break;
      case 'flash': this.speck(p, new THREE.Vector3(), 0xffffff, 1.2, 0.15); sparks(90, 3, 0xffffff, 0.08); burst(8, 2.5, 0xdff4ff, 'bolt'); break;
      case 'cloud': for (let i = 0; i < 40; i++) this.speck(p.clone().add(new THREE.Vector3(rnd(-0.4, 0.4), rnd(-0.2, 0.3), rnd(-0.4, 0.4))), new THREE.Vector3(rnd(-0.3, 0.3), rnd(0, 0.25), rnd(-0.3, 0.3)), st.c, rnd(0.25, 0.4), rnd(0.9, 1.4)); break;
      case 'splash': sparks(60, 1.8, null, 0.07); burst(16, 2.2, null, 'stud', 0.7); break;
      case 'dust': burst(22, 2.4, 0x8a5a2b, 'stud', 0.8); for (let i = 0; i < 20; i++) this.speck(p, new THREE.Vector3(rnd(-0.6, 0.6), rnd(0, 0.5), rnd(-0.6, 0.6)), 0x7a6a50, rnd(0.15, 0.25), rnd(0.6, 1), 0, true); break;
      case 'hearts': this.hearts(p, st, 10); sparks(40, 1, 0xffd0e4); break;
      case 'vanish': this.spiral(p, st, 0.35, 1.2, 26, true); sparks(60, 0.8); break;
      case 'rainbow': this.spiral(p, st, 0.4, 1.0, 24); sparks(80, 1.6, null, 0.1); break;
      case 'ring': case 'scan': this.ring(p, st.c, 0.9, 0.45); sparks(40, 1.2); break;
      case 'sink': this.spiral(p, st, 0.3, -0.6, 14); sparks(30, 0.8); break;
      case 'streak': for (let i = 0; i < 30; i++) this.speck(p.clone().add(new THREE.Vector3(rnd(-0.3, 0.3), rnd(-0.3, 0.3), rnd(-0.3, 0.3))), d.clone().multiplyScalar(rnd(2, 4)), st.c, rnd(0.04, 0.08), rnd(0.2, 0.4)); burst(8, 2, null, 'bolt'); break;
      case 'holy': this.ring(p, 0xffe27a, 1, 0.45); this.spiral(p, st, 0.35, 1.2, 16); sparks(60, 1.4, 0xfff6c0); break;
      case 'fade': sparks(70, 0.7, 0xffffff, 0.06); break;
      case 'fizzle': sparks(12, 0.6, null, 0.05); break;
      default: sparks(80, 1.8); burst(10, 2);
    }
  }
  lingering(st, p, t, dt) { // (a fire burning on a moment where it struck; a cloud hanging)
    if (st.hit === 'fire' && t < 0.5 && Math.random() < 0.6) this.speck(p.clone().add(new THREE.Vector3(rnd(-0.15, 0.15), -0.3, rnd(-0.15, 0.15))), new THREE.Vector3(0, rnd(0.4, 0.9), 0), new THREE.Color(0xff8a20).lerp(new THREE.Color(0xffe060), Math.random()), rnd(0.08, 0.15), rnd(0.3, 0.5));
  }
  // a ring of light spreading out flat (at p's height, or the floor's)
  ring(p, color, r, T) {
    const n = 64;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      this.speck(p.clone().setY(Math.max(STUD_H + 0.04, p.y - 0.45)), d.multiplyScalar(r / T), color, 0.08, T);
    }
  }
  // pieces spiralling up (rise > 0) or down about p: radius r, rising so far, n of them; vanish: drawing in as they go
  spiral(p, st, r, rise, n, vanish = false) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.piece(st.piece, this.colourOf(st).getHex(), { p: p.clone().add(new THREE.Vector3(Math.cos(a) * r, -0.45 + (i / n) * 0.3, Math.sin(a) * r)), s: rnd(0.6, 0.9), life: 1.2,
        orbit: { c: p.clone(), r, a, w: vanish ? 9 : 6, rise, shrink: vanish } });
    }
  }
  hearts(p, st, n) { // (hearts floating up, swaying, from about p)
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), r = rnd(0.1, 0.35);
      this.piece('heart', i % 3 === 0 ? 0xff2a5a : st.c, { p: p.clone().add(new THREE.Vector3(Math.cos(a) * r, rnd(-0.5, 0), Math.sin(a) * r)), v: new THREE.Vector3(rnd(-0.1, 0.1), rnd(0.45, 0.8), rnd(-0.1, 0.1)),
        s: rnd(1.0, 1.5), life: rnd(1.1, 1.5), drag: 0.3, upright: true, w: new THREE.Vector3(0, rnd(-2, 2), 0) });
    }
  }
  explosion(st, c, r, t, dt, e) {
    if (!e.boom) {
      e.boom = true;
      hitSound(st);
      this.light(c, st.c, 2.6);
      for (let i = 0; i < 260; i++) {
        const v = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(0.3, 1) * r * 2.6);
        this.speck(c, v, new THREE.Color(st.c).lerp(new THREE.Color(st.c2), Math.random() * 0.5), rnd(0.12, 0.24), rnd(0.35, 0.6));
      }
      for (let i = 0; i < 28; i++) {
        const v = new THREE.Vector3(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(0.5, 1) * r * 3);
        this.piece(i % 2 ? st.piece : 'stud', new THREE.Color(st.c).lerp(new THREE.Color(st.c2), Math.random() * 0.4).getHex(), { p: c, v, s: rnd(0.7, 1.1), life: rnd(0.8, 1.2), drag: 0.8, fall: 3 });
      }
      this.ring(c, st.c, r, 0.45);
    }
    if (st.gas && t < 0.9) for (let i = 0; i < 3; i++) // (a gas spore's: a green cloud billowing out and hanging)
      this.speck(c.clone().add(new THREE.Vector3(rnd(-r, r), rnd(-0.3, 0.4), rnd(-r, r))), new THREE.Vector3(rnd(-0.3, 0.3), rnd(0, 0.2), rnd(-0.3, 0.3)), new THREE.Color(0x7fff3f).lerp(new THREE.Color(0x2a6a10), Math.random()), rnd(0.3, 0.5), rnd(1, 1.6));
    if ((st.smoke || st.dark) && t < 0.6 && Math.random() < 0.7)
      this.speck(c.clone().add(new THREE.Vector3(rnd(-r, r) * 0.5, rnd(-0.2, 0.3), rnd(-r, r) * 0.5)), new THREE.Vector3(0, rnd(0.3, 0.6), 0), st.dark ? 0x101018 : 0x353535, rnd(0.25, 0.4), rnd(0.8, 1.2), 0, true);
  }
  // about the caster: (c: their feet)
  aura(st, c, t, dt, e) {
    const mid = c.clone().add(new THREE.Vector3(0, 0.55, 0));
    if (!e.started) {
      e.started = true;
      auraSound(st);
      if (!st.dark) this.light(mid, st.c, 1.6);
      switch (st.hit) {
        case 'hearts': this.hearts(mid, st, 14); break;
        case 'light': this.ring(mid, st.c, 1.6, 0.6); for (let i = 0; i < 160; i++) this.speck(mid, new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(0.5, 2.4)), st.c2, rnd(0.08, 0.16), rnd(0.5, 1)); this.speck(mid, new THREE.Vector3(), 0xffffff, 1.6, 0.35); break;
        case 'wish': this.spiral(mid, st, 0.5, 1.6, 30); for (let i = 0; i < 40; i++) this.piece('star', 0xffd700, { p: mid, v: new THREE.Vector3(rnd(-1.2, 1.2), rnd(1, 2.4), rnd(-1.2, 1.2)), s: rnd(0.8, 1.2), life: 1.4, fall: 2.2, drag: 0.6 }); break;
        case 'halo': for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; this.piece(st.piece, this.colourOf(st).getHex(), { p: mid.clone().add(new THREE.Vector3(Math.cos(a) * 0.3, 0.55, Math.sin(a) * 0.3)), s: 0.7, life: 1.3, orbit: { c: mid.clone().add(new THREE.Vector3(0, 0.55, 0)), r: 0.3, a, w: 3, rise: 0 } }); } break;
        case 'pulse': this.ring(c.clone().setY(STUD_H + 0.5), st.c, 3, 0.7); setTimeout(() => this.ring(c.clone().setY(STUD_H + 0.5), st.c, 3, 0.7), 260); break;
        case 'summon': for (let i = 0; i < 40; i++) this.speck(mid.clone().add(new THREE.Vector3(rnd(-0.5, 0.5), rnd(-0.5, 0.2), rnd(-0.5, 0.5))), new THREE.Vector3(rnd(-0.3, 0.3), rnd(0.2, 0.6), rnd(-0.3, 0.3)), st.c2, rnd(0.25, 0.4), rnd(0.9, 1.3), 0, true); this.spiral(mid, st, 0.6, 0.8, 18); break;
        case 'shield': for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; this.piece('stud', i % 2 ? st.c : st.c2, { p: mid, s: 0.8, life: 1.3, orbit: { c: mid.clone().add(new THREE.Vector3(0, (i % 3 - 1) * 0.25, 0)), r: 0.55, a, w: 4, rise: 0 } }); } break;
        case 'rise': for (let i = 0; i < 60; i++) this.speck(c.clone().add(new THREE.Vector3(rnd(-0.3, 0.3), 0.05, rnd(-0.3, 0.3))), new THREE.Vector3(0, rnd(0.6, 1.4), 0), 0xffffff, rnd(0.05, 0.1), rnd(0.6, 1)); break;
        case 'dust': for (let i = 0; i < 24; i++) this.speck(c.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(rnd(-1, 1), rnd(0.1, 0.4), rnd(-1, 1)), 0x9a8a70, rnd(0.15, 0.25), rnd(0.6, 0.9), 0, true); break;
        case 'fade': for (let i = 0; i < 80; i++) this.speck(mid.clone().add(new THREE.Vector3(rnd(-0.3, 0.3), rnd(-0.5, 0.5), rnd(-0.3, 0.3))), new THREE.Vector3(rnd(-0.2, 0.2), rnd(0, 0.3), rnd(-0.2, 0.2)), 0xffffff, rnd(0.04, 0.08), rnd(0.5, 1)); break;
        case 'streak': this.spiral(mid, st, 0.45, 1.0, 16); break;
        case 'fire': this.spiral(mid, st, 0.45, 1.0, 20); break;
        case 'frost': this.spiral(mid, st, 0.45, 1.0, 20); break;
        case 'blast': this.impact(st, mid, new THREE.Vector3(0, 0, 1)); break;
        default: this.spiral(mid, st, 0.45, 1.0, 22);
      }
    }
    // (and sparkles drifting up about them all through it)
    if (t < 1 && !st.dark) for (let i = 0; i < Math.ceil(dt * 60); i++) {
      const a = rnd(0, Math.PI * 2);
      this.speck(c.clone().add(new THREE.Vector3(Math.cos(a) * 0.4, rnd(0.1, 1), Math.sin(a) * 0.4)), new THREE.Vector3(0, rnd(0.2, 0.6), 0), this.colourOf(st), rnd(0.04, 0.08), rnd(0.4, 0.8));
    }
  }

  step() {
    const now = performance.now() / 1000, dt = Math.min(0.05, now - this.last);
    this.last = now;
    for (const e of [...this.live]) {
      const t = now - e.t0;
      if (t < 0) continue;
      e.step(t, dt, e);
      if (t > e.dur) this.live.splice(this.live.indexOf(e), 1);
    }
    // the specks
    for (const S of [this.sp, this.dk]) {
      let j = 0;
      for (let i = 0; i < S.n; i++) {
        S.age[i] += dt;
        if (S.age[i] >= S.life[i]) continue;
        if (j !== i) {
          for (const A of [S.pos, S.v, S.col]) { A[j * 3] = A[i * 3]; A[j * 3 + 1] = A[i * 3 + 1]; A[j * 3 + 2] = A[i * 3 + 2]; }
          S.s0[j] = S.s0[i]; S.life[j] = S.life[i]; S.age[j] = S.age[i]; S.fall[j] = S.fall[i];
        }
        S.v[j * 3 + 1] -= S.fall[j] * dt;
        const drag = Math.exp(-1.6 * dt);
        S.v[j * 3] *= drag; S.v[j * 3 + 1] *= drag; S.v[j * 3 + 2] *= drag;
        S.pos[j * 3] += S.v[j * 3] * dt; S.pos[j * 3 + 1] += S.v[j * 3 + 1] * dt; S.pos[j * 3 + 2] += S.v[j * 3 + 2] * dt;
        if (S.pos[j * 3 + 1] < STUD_H + 0.02) { S.pos[j * 3 + 1] = STUD_H + 0.02; S.v[j * 3 + 1] *= -0.3; }
        const u = S.age[j] / S.life[j];
        S.alpha[j] = (S === this.dk ? 0.55 : 1) * (u < 0.1 ? u / 0.1 : 1 - (u - 0.1) / 0.9);
        S.size[j] = S.s0[j] * (S === this.dk ? 1 + u * 1.5 : 1 - u * 0.4);
        j++;
      }
      S.n = j;
    }
    for (const [P, S] of [[this.points, this.sp], [this.darkPoints, this.dk]]) {
      const g = P.geometry;
      g.setDrawRange(0, S.n);
      for (const k of ['position', 'color', 'size', 'alpha']) g.attributes[k].needsUpdate = true;
    }
    // the pieces
    const m4 = new THREE.Matrix4(), sc = new THREE.Vector3(), dq = new THREE.Quaternion(), eu = new THREE.Euler(), col = new THREE.Color();
    for (const set of this.pieces.values()) {
      set.list = set.list.filter((p) => (p.age += dt) < p.life);
      set.list.forEach((p, i) => {
        if (p.orbit) {
          const o = p.orbit;
          o.a += o.w * dt;
          const r = o.shrink ? o.r * (1 - p.age / p.life) : o.r;
          p.p.set(o.c.x + Math.cos(o.a) * r, p.p.y + (o.rise / p.life) * dt, o.c.z + Math.sin(o.a) * r);
        } else {
          p.v.y -= p.fall * dt;
          p.v.multiplyScalar(Math.exp(-p.drag * dt));
          p.p.addScaledVector(p.v, dt);
          if (p.p.y < STUD_H + 0.03) { p.p.y = STUD_H + 0.03; p.v.y *= -0.35; p.v.x *= 0.7; p.v.z *= 0.7; }
        }
        if (!p.upright) p.q.multiply(dq.setFromEuler(eu.set(p.w.x * dt, p.w.y * dt, p.w.z * dt)));
        else p.q.multiply(dq.setFromEuler(eu.set(0, p.w.y * dt, 0)));
        const u = p.age / p.life, k = p.s * (u < 0.12 ? u / 0.12 : u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1);
        m4.compose(p.p, p.q, sc.set(k, k, k));
        set.mesh.setMatrixAt(i, m4);
      });
      set.mesh.count = set.list.length;
      set.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const l of this.lights) l.intensity *= Math.exp(-6 * dt);
  }
}

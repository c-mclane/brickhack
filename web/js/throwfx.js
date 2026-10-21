// Thrown things, in a little physics of their own (BrickWorld: brick levels).
// The engine says what was thrown (by the hero or a monster), from where, and
// where its flight stopped (winweb.c web_throw, web_mthrow_end); we fly it
// there in a slow, lofted arc, tumbling. Every square of the dungeon is a box:
// inside the one it was thrown to, it hits the far wall, bounces off and
// tumbles down, and comes to rest wherever it comes to rest. It stays so (its
// pose: poseFor) until it's picked up. Something that breaks (web_shatter)
// bursts into shards of its own colours as it lands; a potion splashes too; a
// gob of venom (a monster's spit) only splats.
//
// The body: a box the size of its model (its eight corners are what touch),
// with mass 1 and a box's inertia; contacts are impulses at the corners against
// the floor and the target square's four walls, with bounce and friction.

import * as THREE from 'three';
import { MODEL_SCALE, STUD_H } from './brick.js';
import { fountainStud } from './mist.js';
// a stud of water to throw about where there's no fountain or pool about to lend one (mist.js fountainStud): a sink
let plain = null;
const plainStud = () => plain || (plain = { geo: new THREE.CylinderGeometry(0.03, 0.03, 0.022, 10).translate(0, 0.011, 0),
  mat: new THREE.MeshStandardMaterial({ color: 0x9fd8ff, roughness: 0.1, transparent: true, opacity: 0.8 }) });
// a musical note (♪), drawn once, for notes rising from a drain
let noteTex = null;
function noteTexture() {
  if (noteTex) return noteTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.font = 'bold 54px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('\u266A', 32, 34);
  return (noteTex = new THREE.CanvasTexture(c));
}

const G = -9; // gravity, squares per second²
const STEP = 1 / 240; // the simulation's step
const HAND = 0.55; // the hero's hand, above the floor
const E_FLOOR = 0.28, E_WALL = 0.4, FRICTION = 0.55;
const REST_V = 0.06, REST_W = 0.35, REST_TIME = 0.3, MAX_TIME = 6;
const SHARDS = 36, SHARD_LIFE = 1.6;
const SPIT_H = 0.32; // a spit leaves the mouth this high (a cobra's raised head)
const DRIPS = 40; // the most a spit's trail lets fall
// venom glows a little in its own colour (acid green, blinding purple), gob, drips and splat alike
const venomGlow = (c) => c.clone().lerp(new THREE.Color(0xffffff), 0.15).multiplyScalar(1.6);

const key = (x, z, url) => `${x},${z},${url}`;

// a body's box (oriented: b.p, b.q, half extents b.h) against an upright box [x0,y0,z0,x1,y1,z1]:
// where they overlap least (separating axes), the way out {n (out of the box), depth, r (the body's
// point that's in, from its centre)}; or null
function boxTouch(b, [x0, y0, z0, x1, y1, z1]) {
  const A = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((a) => a.applyQuaternion(b.q));
  const W = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const h = [b.h.x, b.h.y, b.h.z], e = [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2];
  const d = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).sub(b.p);
  const axes = [...W, ...A];
  for (const a of A) for (const w of W) { const c = a.clone().cross(w); if (c.lengthSq() > 1e-6) axes.push(c.normalize()); }
  let best = null;
  for (const L of axes) {
    const ra = h[0] * Math.abs(A[0].dot(L)) + h[1] * Math.abs(A[1].dot(L)) + h[2] * Math.abs(A[2].dot(L));
    const rb = e[0] * Math.abs(L.x) + e[1] * Math.abs(L.y) + e[2] * Math.abs(L.z);
    const dist = d.dot(L), over = ra + rb - Math.abs(dist);
    if (over <= 0) return null;
    if (!best || over < best.depth) best = { n: L.clone().multiplyScalar(dist > 0 ? -1 : 1), depth: over };
  }
  // the body's point deepest in: its corner (or edge, or face, where it lies flat) furthest along -n
  const r = new THREE.Vector3();
  for (let i = 0; i < 3; i++) { const k = A[i].dot(best.n); if (Math.abs(k) > 0.15) r.addScaledVector(A[i], -Math.sign(k) * h[i]); }
  best.r = r;
  return best;
}

export class ThrowFX {
  constructor(brick) {
    this.brick = brick;
    this.flying = []; // bodies in flight or tumbling
    this.shards = []; // bursts: {mesh, parts: [{p, v, q, w}], t}
    this.poses = new Map(); // x,z,url -> {p, q, c} where a thrown item came to rest
    this.incoming = new Map(); // x,z,url -> count still in the air (hidden on the floor till they land)
    this.pending = []; // breaks heard before their throw (a monster's: the engine drops or breaks it mid-flight): {url, x, z, splash, t}
    this.last = performance.now() / 1000;
  }

  poseFor(x, z, url) { return this.poses.get(key(x, z, url)) || null; }
  isIncoming(x, z, url) { return (this.incoming.get(key(x, z, url)) || 0) > 0; }
  forget(x, z, url) { this.poses.delete(key(x, z, url)); }

  // the hero threw (the item's model url) from square (fx, fz) to (tx, tz); opts.spit: a gob of
  // venom spat (straight and quick from the mouth, not lofted or tumbling, dripping as it goes,
  // and it splats on whatever it reaches)
  async launch(url, fx, fz, tx, tz, opts = {}) {
    const k = key(tx, tz, url);
    this.incoming.set(k, (this.incoming.get(k) || 0) + 1);
    // in the air from now on (its model still loading): a break reported straight after finds it;
    // one reported just before (a monster's throw) is its
    const b = { k, url, tx, tz, breaks: false, loading: true };
    const early = this.pending.findIndex((s) => s.x === tx && s.z === tz && s.url === url);
    if (early >= 0) { b.breaks = true; b.splash = this.pending[early].splash; this.pending.splice(early, 1); }
    this.flying.push(b);
    this.brick.redrawItems(k); // (already lying there, if the engine dropped it first: hidden till it lands)
    let m;
    try { m = (await this.brick.model(url)).clone(); } catch { this.flying.splice(this.flying.indexOf(b), 1); this.land(k); return; }
    // the body: its model inside a holder whose origin is the model's middle (its centre of mass)
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m);
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).multiplyScalar(MODEL_SCALE);
    m.position.sub(c);
    const holder = new THREE.Group();
    holder.scale.setScalar(MODEL_SCALE);
    holder.add(m);
    this.brick.world.add(holder);
    const h = size.clone().multiplyScalar(0.5);
    const corners = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(new THREE.Vector3(sx * h.x, sy * h.y, sz * h.z));
    const inertia = new THREE.Vector3( // a box's, mass 1
      (size.y ** 2 + size.z ** 2) / 12 || 0.01, (size.x ** 2 + size.z ** 2) / 12 || 0.01, (size.x ** 2 + size.y ** 2) / 12 || 0.01);
    // the arc: from the hand, lofted, to high on the far wall of the square it was thrown to
    const dx = tx - fx, dz = tz - fz, dist = Math.hypot(dx, dz);
    const dir = dist ? new THREE.Vector3(dx / dist, 0, dz / dist) : new THREE.Vector3(0, 0, 1);
    const spit = !!opts.spit;
    const p = spit ? new THREE.Vector3(fx + 0.5, STUD_H + SPIT_H, fz + 0.5).addScaledVector(dir, 0.3)
      : new THREE.Vector3(fx + 0.5, STUD_H + HAND, fz + 0.5).addScaledVector(dir, 0.25);
    const aim = spit ? new THREE.Vector3(tx + 0.5, STUD_H + 0.42, tz + 0.5) // (a spit: straight at you, chest high)
      : new THREE.Vector3(tx + 0.5, STUD_H + 0.75, tz + 0.5).addScaledVector(dir, 0.6);
    const T = spit ? 0.28 + 0.1 * dist : 0.7 + 0.13 * dist; // (slow: you can watch it go; a spit, quick)
    const v = aim.clone().sub(p).divideScalar(T);
    v.y -= 0.5 * G * T;
    // end over end, about the axis across its flight, and a little of everything (a spit: barely turning)
    const across = new THREE.Vector3(-dir.z, 0, dir.x);
    const w = spit ? across.multiplyScalar(1.5)
      : across.multiplyScalar(6 + Math.random() * 6).add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dir.z, dir.x));
    Object.assign(b, { holder, m, c, corners, inertia, p, v, q, w, t: 0, rest: 0, grounded: false, loading: false, spit, T });
    if (spit) { // (venom glows a little green)
      m.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive = venomGlow(o.material.color); o.material.emissiveIntensity = 0.55; } });
      b.trail = this.trail(m);
    }
  }

  // something come to lie at square (x, z) (the item's model url) let fall there from above, from
  // height `top` (just over whoever dropped it: the hero, a monster that died), a little off the
  // middle, turning a little: it falls, knocks against whatever's there (the hero, a statue: the
  // brick world's colliders), rolls off it, and comes to rest where it comes to rest, as it lies
  async drop(url, x, z, top, at) {
    const k = key(x, z, url);
    this.incoming.set(k, (this.incoming.get(k) || 0) + 1);
    const b = { k, url, tx: x, tz: z, breaks: false, loading: true, drop: true };
    this.flying.push(b);
    this.brick.redrawItems(k);
    let m;
    try { m = (await this.brick.model(url)).clone(); } catch { this.flying.splice(this.flying.indexOf(b), 1); this.land(k); return; }
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m);
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).multiplyScalar(MODEL_SCALE);
    m.position.sub(c);
    const holder = new THREE.Group();
    holder.scale.setScalar(MODEL_SCALE);
    holder.add(m);
    this.brick.world.add(holder);
    const h = size.clone().multiplyScalar(0.5), corners = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(new THREE.Vector3(sx * h.x, sy * h.y, sz * h.z));
    const inertia = new THREE.Vector3((size.y ** 2 + size.z ** 2) / 12 || 0.01, (size.x ** 2 + size.z ** 2) / 12 || 0.01, (size.x ** 2 + size.y ** 2) / 12 || 0.01);
    const jit = () => (Math.random() - 0.5) * 0.12;
    // over whoever dropped it (at: where they're drawn), kept within its square
    const M = 0.12, cl = (v, a) => Math.min(a + 1 - M, Math.max(a + M, v));
    const p = new THREE.Vector3(cl((at ? at.x : x + 0.5) + jit(), x), top + Math.max(h.x, h.y, h.z) + 0.04, cl((at ? at.z : z + 0.5) + jit(), z));
    const v = new THREE.Vector3(jit() * 2, 0, jit() * 2);
    const w = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
    Object.assign(b, { holder, m, c, corners, h, inertia, p, v, q, w, t: 0, rest: 0, grounded: false, loading: false });
  }

  // something broke at (x, z): if it's flying there, it bursts as it lands; else now.
  // splash: a potion (its drink splashes out too, and pools)
  shatter(url, x, z, splash) {
    const b = this.flying.find((f) => f.tx === x && f.tz === z && !f.breaks);
    if (b) { b.breaks = true; b.splash = splash; return; }
    this.pending.push({ url, x, z, splash, t: performance.now() / 1000 }); // (its throw may be on its way: a moment's wait)
  }

  step() {
    const now = performance.now() / 1000;
    let dt = Math.min(now - this.last, 1 / 20);
    this.last = now;
    for (const b of [...this.flying]) {
      if (b.loading) continue;
      for (let t = 0; t < dt; t += STEP) {
        if (this.integrate(b, Math.min(STEP, dt - t))) break;
      }
      if (b.done) continue;
      b.holder.position.copy(b.p);
      b.holder.quaternion.copy(b.q);
    }
    for (const s of [...this.pending]) // a break no throw came for: it bursts where it is
      if (now - s.t > 0.12) {
        this.pending.splice(this.pending.indexOf(s), 1);
        this.brick.model(s.url).then((m) => this.burst(m, new THREE.Vector3(s.x + 0.5, STUD_H + 0.2, s.z + 0.5), new THREE.Vector3(), s.splash)).catch(() => {});
      }
    for (const s of [...this.shards]) this.stepShards(s, dt);
    this.stepStreams(dt);
    this.stepPours(dt);
    this.stepNotes(dt);
    for (const r of [...(this.rings || [])]) { // a ring on the water: spreading, fading
      r.t += dt;
      r.mesh.scale.setScalar(0.02 + 0.3 * Math.sqrt(Math.min(1, r.t / 0.9)));
      r.mesh.material.opacity = 0.6 * Math.max(0, 1 - r.t / 0.9);
      if (r.t > 0.9) { this.brick.world.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); this.rings.splice(this.rings.indexOf(r), 1); }
    }
    for (const d of [...(this.puddles || [])]) { // spreading, then drying up
      d.t += dt;
      d.mesh.scale.setScalar(d.size * Math.min(1, d.t / 0.35));
      d.mesh.material.opacity = 0.7 * Math.max(0, Math.min(1, (3.5 - d.t) / 1.5));
      if (d.t > 3.5) { this.brick.world.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose(); this.puddles.splice(this.puddles.indexOf(d), 1); }
    }
  }

  // one step of a body; true when it's done (at rest, or burst)
  integrate(b, dt) {
    b.t += dt;
    if (b.spit) { // a spit: drips falling from it as it flies; and it splats on reaching you
      b.trail.due -= dt;
      if (b.trail.due <= 0 && b.trail.parts.length < DRIPS) {
        b.trail.due = 0.022;
        b.trail.parts.push({ p: b.p.clone(), v: b.v.clone().multiplyScalar(0.12).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3)),
          q: new THREE.Quaternion(), w: new THREE.Vector3(), s: 0.5 + Math.random() * 0.6, stick: true });
      }
      if (b.t >= b.T) { b.breaks = true; this.finish(b, true); return true; }
    }
    b.v.y += G * dt;
    b.p.addScaledVector(b.v, dt);
    const wq = new THREE.Quaternion(b.w.x * dt * 0.5, b.w.y * dt * 0.5, b.w.z * dt * 0.5, 0).multiply(b.q);
    b.q.set(b.q.x + wq.x, b.q.y + wq.y, b.q.z + wq.z, b.q.w + wq.w).normalize();
    // the planes it can touch: the floor; the walls of its square once it's in it
    const planes = [[new THREE.Vector3(0, 1, 0), STUD_H, E_FLOOR, true]];
    const inSquare = b.p.x > b.tx && b.p.x < b.tx + 1 && b.p.z > b.tz && b.p.z < b.tz + 1;
    if (inSquare)
      planes.push([new THREE.Vector3(1, 0, 0), b.tx, E_WALL, false], [new THREE.Vector3(-1, 0, 0), -(b.tx + 1), E_WALL, false],
        [new THREE.Vector3(0, 0, 1), b.tz, E_WALL, false], [new THREE.Vector3(0, 0, -1), -(b.tz + 1), E_WALL, false]);
    // what else it knocks against (the hero, a statue's bricks: brickworld.colliders): boxes and spheres
    const solids = b.drop && this.brick.colliders ? this.brick.colliders(b.tx, b.tz) : [];
    const R = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(b.q));
    const Iinv = R.clone().multiply(new THREE.Matrix3().set(1 / b.inertia.x, 0, 0, 0, 1 / b.inertia.y, 0, 0, 0, 1 / b.inertia.z)).multiply(R.clone().transpose());
    let hit = false;
    b.onHero = false;
    const touches = []; // [n, depth, r, e, floor]
    for (const c0 of b.corners) {
      const r = c0.clone().applyQuaternion(b.q), P = b.p.clone().add(r);
      for (const [n, d, e, floor] of planes) {
        const depth = d - P.x * n.x - P.y * n.y - P.z * n.z;
        if (depth > 0) touches.push([n, depth, r, e, floor]);
      }
    }
    for (const o of solids) if (o.sphere) { // the hero's head: things roll off it (its nearest point to the body, wholly)
      const C = new THREE.Vector3(o.sphere[0], o.sphere[1], o.sphere[2]), rad = o.sphere[3];
      const qi = b.q.clone().invert(), l = C.clone().sub(b.p).applyQuaternion(qi);
      l.set(Math.max(-b.h.x, Math.min(b.h.x, l.x)), Math.max(-b.h.y, Math.min(b.h.y, l.y)), Math.max(-b.h.z, Math.min(b.h.z, l.z)));
      const r = l.applyQuaternion(b.q), dv = b.p.clone().add(r).sub(C), dl = dv.length();
      if (dl < rad) { touches.push([dl > 1e-6 ? dv.divideScalar(dl) : new THREE.Vector3(0, 1, 0), rad - dl, r, 0.25, false]); b.onHero = true; }
    }
    for (const o of solids) if (o.box) { // a brick's box (the hero's body, a statue's bricks): wholly, not only at its corners
      const t = boxTouch(b, o.box);
      if (t) { touches.push([t.n, t.depth, t.r, 0.2, t.n.y > 0.5]); if (o.hero) b.onHero = true; } // (never left lying against you)
    }
    {
      for (const [n, depth, r, e, floor] of touches) {
        hit = true;
        b.p.addScaledVector(n, depth * 0.9);   // out of the plane
        const vc = b.v.clone().add(b.w.clone().cross(r));
        const vn = vc.dot(n);
        if (vn >= 0) continue;
        const rn = r.clone().cross(n);
        const k = 1 + rn.clone().applyMatrix3(Iinv).dot(rn);
        const j = -(1 + e) * vn / k;
        const J = n.clone().multiplyScalar(j);
        // friction, along the slide
        const vt = vc.clone().addScaledVector(n, -vn);
        if (vt.lengthSq() > 1e-8) {
          const tdir = vt.clone().normalize();
          const rt = r.clone().cross(tdir);
          const kt = 1 + rt.clone().applyMatrix3(Iinv).dot(rt);
          const jt = Math.min(FRICTION * j, vt.length() / kt);
          J.addScaledVector(tdir, -jt);
        }
        b.v.add(J);
        b.w.add(r.clone().cross(J).applyMatrix3(Iinv));
        if (floor) b.grounded = true;
      }
    }
    if (b.drop && touches.length) b.grounded = true;
    if (b.onHero && b.t > 1) { // (caught on you a while, wedged: it's eased off you, sideways, past your shoulder)
      const hs = solids.find((o) => o.sphere), dx = b.p.x - hs.sphere[0], dz = b.p.z - hs.sphere[2], dl = Math.hypot(dx, dz);
      const [ox, oz] = dl > 0.01 ? [-dz / dl, dx / dl] : [1, 0];
      b.v.x += ox * 2.5 * dt; b.v.z += oz * 2.5 * dt;
    }
    if (hit && b.breaks) { this.finish(b, true); return true; }
    if (b.grounded) { b.w.multiplyScalar(1 - 1.5 * dt); b.v.x *= 1 - 0.8 * dt; b.v.z *= 1 - 0.8 * dt; }
    const slow = b.drop && b.t > 2 ? 2 : 1; // (a drop wedged among bricks, barely trembling, is let lie)
    if (b.grounded && !b.onHero && b.v.length() < REST_V * slow && b.w.length() < REST_W * slow) b.rest += dt; else b.rest = 0; // (never at rest on your head)
    if (b.rest > REST_TIME || b.t > MAX_TIME) { this.finish(b, false); return true; }
    return false;
  }

  // at rest: settled flat on its nearest face, its pose kept for the floor; or burst
  finish(b, burst) {
    b.done = true;
    this.flying.splice(this.flying.indexOf(b), 1);
    this.brick.world.remove(b.holder);
    if (burst) {
      this.burst(b.m, b.p.clone(), b.v.clone(), b.splash);
      this.land(b.k);
      return;
    }
    if (b.drop) { // (dropped: it stays just as it came to rest: on the floor, on a statue's ledge...)
      b.p.x = Math.min(Math.max(b.p.x, b.tx + 0.04), b.tx + 0.96);
      b.p.z = Math.min(Math.max(b.p.z, b.tz + 0.04), b.tz + 0.96);
      this.poses.set(b.k, { p: b.p.clone(), q: b.q.clone(), c: b.c.clone() });
      this.land(b.k);
      return;
    }
    // the face nearest the floor, made to lie flat on it; never on the end of a long thing
    // (a carrot doesn't come to rest standing on its tip: it tips over)
    const ext = b.corners[7].toArray().map(Math.abs); // (half its size, along its own x, y, z)
    const sorted = [...ext].sort((p, q) => q - p);
    const tall = sorted[0] > 1.5 * sorted[1] ? ext.indexOf(sorted[0]) : -1; // its long axis, if it has one
    let best = null, bestDot = -2;
    for (const a of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      if (a[tall] !== undefined && a[tall] !== 0) continue;
      const axis = new THREE.Vector3(...a).applyQuaternion(b.q);
      if (axis.y > bestDot) { bestDot = axis.y; best = axis; }
    }
    b.q.premultiply(new THREE.Quaternion().setFromUnitVectors(best, new THREE.Vector3(0, 1, 0)));
    let low = Infinity;
    for (const c0 of b.corners) low = Math.min(low, b.p.y + c0.clone().applyQuaternion(b.q).y);
    b.p.y += STUD_H - low;
    const [x, z] = b.k.split(',').map(Number);
    b.p.x = Math.min(Math.max(b.p.x, x + 0.08), x + 0.92);
    b.p.z = Math.min(Math.max(b.p.z, z + 0.08), z + 0.92);
    this.poses.set(b.k, { p: b.p.clone(), q: b.q.clone(), c: b.c.clone() });
    this.land(b.k);
  }

  land(k) {
    const n = (this.incoming.get(k) || 1) - 1;
    if (n > 0) this.incoming.set(k, n); else this.incoming.delete(k);
    this.brick.redrawItems(k);
  }

  // shards of a model's own colours, flung out from p (moving at v); a potion's drink
  // splashes out too: droplets of its colour, and a puddle
  burst(model, p, v, splash) {
    const colors = [], transparent = [];
    model.traverse((o) => { if (o.isMesh && o.material && o.material.color) { colors.push(o.material.color); transparent.push(!!o.material.transparent); } });
    if (!colors.length) colors.push(new THREE.Color(0xcccccc));
    if (splash === 'venom') { this.splash(colors, p, v, true); return; } // (a gob of spit: no shards, it just splats, glowing)
    const glassy = transparent.some((t) => t);
    const geo = new THREE.TetrahedronGeometry(0.035);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.1, transparent: glassy, opacity: glassy ? 0.75 : 1 });
    const mesh = new THREE.InstancedMesh(geo, mat, SHARDS);
    const parts = [];
    for (let i = 0; i < SHARDS; i++) {
      mesh.setColorAt(i, colors[i % colors.length]);
      const out = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.3, Math.random() - 0.5).normalize().multiplyScalar(1 + Math.random() * 2.2);
      parts.push({ p: p.clone(), v: out.addScaledVector(v, 0.25), q: new THREE.Quaternion().random(), w: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(30), s: 0.6 + Math.random() * 0.9 });
    }
    this.brick.world.add(mesh);
    this.shards.push({ mesh, parts, t: 0 });
    if (splash) this.splash(colors, p, v);
  }

  // a drink spilt: droplets flung low and wide that stick where they land, and a puddle spreading
  splash(colors, p, v, glow = false) {
    const drink = colors.reduce((best, c) => (c.r + c.g + c.b < best.r + best.g + best.b ? best : c), colors[0]).clone(); // (its brightest colour: the drink)
    const geo = new THREE.IcosahedronGeometry(0.022, 0);
    const lit = glow ? { emissive: venomGlow(drink), emissiveIntensity: 0.5 } : {}; // (venom: glowing a little, in its colour)
    const mat = new THREE.MeshStandardMaterial({ color: drink, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.85, ...lit });
    const n = 40, mesh = new THREE.InstancedMesh(geo, mat, n), parts = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.8 + Math.random() * 1.8;
      parts.push({ p: p.clone(), v: new THREE.Vector3(Math.cos(a) * s, 0.6 + Math.random() * 1.6, Math.sin(a) * s).addScaledVector(v, 0.15),
        q: new THREE.Quaternion(), w: new THREE.Vector3(), s: 0.6 + Math.random(), stick: true });
    }
    this.brick.world.add(mesh);
    this.shards.push({ mesh, parts, t: 0, life: 2.4 });
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshStandardMaterial({ color: drink, roughness: 0.05, transparent: true, opacity: 0.7, depthWrite: false, ...lit }));
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(p.x, STUD_H + 0.004, p.z);
    puddle.scale.setScalar(0.01);
    this.brick.world.add(puddle);
    this.puddles = this.puddles || [];
    this.puddles.push({ mesh: puddle, t: 0, size: 0.28 + Math.random() * 0.12 });
  }

  // a fountain's water broken (something dipped in, a hand cupping a drink: the hero at its rim): its own clear
  // blue studs (mist.js fountainStud) popping up out of it at p (its surface), tumbling, and dropping back in out
  // of sight; and a ring spreading out over it. n: how many; up: how hard (squares/s); floor: where they go out
  // of sight (the water's surface: p's height; drips off someone: the floor), ring: a ring on the water
  splashStuds(p, n = 8, up = 1.6, { floor = p.y, ring: rings = true, lava = false, tint = null } = {}) { // (lava: its glowing orange studs, embers flying; tint: studs of that colour)
    const piece = lava ? this.brick.lavaStud : fountainStud() || plainStud();
    if (lava) this.sparkles(p.clone().setY(p.y + 0.1), Math.round(n * 1.5), 0xff7a1a, 0.3);
    if (piece) {
      const mat = piece.mat.clone();
      if (tint !== null && mat.color) { mat.color.set(tint); if (mat.emissive) mat.emissive.set(0); }
      const mesh = new THREE.InstancedMesh(piece.geo.clone(), mat, n), parts = [];
      mesh.frustumCulled = false; mesh.renderOrder = 3;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = 0.15 + Math.random() * 0.35;
        parts.push({ p: p.clone(), v: new THREE.Vector3(Math.cos(a) * s, up * (0.6 + Math.random() * 0.6), Math.sin(a) * s),
          q: new THREE.Quaternion().random(), w: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(18), s: MODEL_SCALE });
      }
      this.brick.world.add(mesh);
      this.shards.push({ mesh, parts, t: 0, life: 1.4, floor, sink: true });
    }
    if (!rings) return;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({ color: lava ? 0xffb347 : 0xdff4ff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(p).y += 0.006;
    ring.scale.setScalar(0.02);
    this.brick.world.add(ring);
    (this.rings = this.rings || []).push({ mesh: ring, t: 0 });
  }

  // a stream of water arcing from p to q (a fountain gushing, out to a square it floods): its clear blue
  // studs (fountainStud) thrown one after another along the arc, tumbling, each sinking away where it lands.
  // n: how many; T: s each is in the air; gap: s between them. Resolves as the last one lands
  stream(p, q, n = 10, T = 0.7, gap = 0.035) {
    const piece = fountainStud();
    if (!piece) return Promise.resolve();
    const mesh = new THREE.InstancedMesh(piece.geo.clone(), piece.mat.clone(), n);
    mesh.frustumCulled = false; mesh.renderOrder = 3;
    const d = Math.hypot(q.x - p.x, q.z - p.z), h = 0.35 + d * 0.22; // (how high it arcs: higher, the further it goes)
    const studs = [];
    for (let i = 0; i < n; i++) {
      const j = new THREE.Vector3((Math.random() - 0.5) * 0.18, 0, (Math.random() - 0.5) * 0.18); // (spread a little where they land)
      studs.push({ t0: i * gap, j, q: new THREE.Quaternion().random(), w: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14) });
    }
    this.brick.world.add(mesh);
    return new Promise((res) => (this.streams = this.streams || []).push({ mesh, studs, p: p.clone(), q: q.clone(), h, T, t: 0, end: (n - 1) * gap + T, res }));
  }
  stepStreams(dt) {
    const m4 = new THREE.Matrix4(), at = new THREE.Vector3(), s3 = new THREE.Vector3();
    for (const s of [...(this.streams || [])]) {
      s.t += dt;
      s.studs.forEach((f, i) => {
        const u = (s.t - f.t0) / s.T;
        let k = 0;
        if (u > 0 && u < 1.25) {
          const v = Math.min(1, u);
          at.lerpVectors(s.p, s.q.clone().add(f.j), v);
          at.y += s.h * 4 * v * (1 - v); // (a parabola over the straight line between)
          if (u >= 1) at.y -= (u - 1) * 0.3; // (and down into the water)
          f.q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(f.w.x * dt, f.w.y * dt, f.w.z * dt)));
          k = MODEL_SCALE * (u < 1 ? 1 : Math.max(0, 1 - (u - 1) / 0.25));
        }
        m4.compose(at, f.q, s3.set(k, k, k));
        s.mesh.setMatrixAt(i, m4);
      });
      s.mesh.instanceMatrix.needsUpdate = true;
      if (s.res && s.t >= s.end) { s.res(); s.res = null; }
      if (s.t > s.end + 0.3) {
        this.brick.world.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose();
        this.streams.splice(this.streams.indexOf(s), 1);
      }
    }
  }

  // sparkles: little glints of light (a blessing: gold; a freezing mist: frost) about p, drifting up and out
  sparkles(p, n = 24, color = 0xffe27a, spread = 0.18) {
    const mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.018, 0),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }), n), parts = [];
    mesh.frustumCulled = false; mesh.renderOrder = 5;
    for (let i = 0; i < n; i++)
      parts.push({ p: p.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread)),
        v: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.2 + Math.random() * 0.5, (Math.random() - 0.5) * 0.5),
        q: new THREE.Quaternion().random(), w: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(9), s: 0.5 + Math.random(), grow: -0.6 });
    this.brick.world.add(mesh);
    this.shards.push({ mesh, parts, t: 0, life: 1.6, rise: true });
  }

  // poisoned: a purple haze about you, specks drifting up off you and fading. p: your feet, h: how tall you are
  haze(p, h = 1.2, n = 7, color = 0xa23fe0) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.034, 0.034, 0.034),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }), n), parts = [];
    mesh.frustumCulled = false; mesh.renderOrder = 5;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.18 + Math.random() * 0.14;
      parts.push({ p: p.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.15 + Math.random() * h, Math.sin(a) * r)),
        v: new THREE.Vector3(Math.cos(a) * 0.05, 0.12 + Math.random() * 0.15, Math.sin(a) * 0.05),
        q: new THREE.Quaternion().random(), w: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(4), s: 0.6 + Math.random() * 0.8, grow: -0.4 });
    }
    this.brick.world.add(mesh);
    this.shards.push({ mesh, parts, t: 0, life: 1.3, rise: true });
  }

  // bad breath: a faint, small wisp of sickly green off your mouth (p), drifting out the way you face (yaw)
  breath(p, yaw) {
    const n = 7, mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.026, 1),
      new THREE.MeshBasicMaterial({ color: 0x8fb04a, transparent: true, opacity: 0.6, depthWrite: false }), n), parts = [];
    mesh.frustumCulled = false;
    for (let i = 0; i < n; i++)
      parts.push({ p: p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.03)),
        v: new THREE.Vector3(Math.sin(yaw) * (0.1 + Math.random() * 0.06), (Math.random() - 0.3) * 0.02, -Math.cos(yaw) * (0.1 + Math.random() * 0.06)), // (out before you, level with your mouth)
        q: new THREE.Quaternion(), w: new THREE.Vector3(), s: 0.6 + Math.random() * 0.5, grow: 0.8 });
    this.brick.world.add(mesh);
    this.shards.push({ mesh, parts, t: 0, life: 1.4, rise: true });
  }
  // this water's no good (your things cursed): a puff of murky dark about you, at your middle (p), dark specks in it
  cursePuff(p) {
    for (let i = 0; i < 5; i++) this.vapor(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.3 + i * 0.15, (Math.random() - 0.5) * 0.3)), i % 2 ? 0x1c1524 : 0x34283f, 1.9);
    this.sparkles(p, 26, 0x241b2e, 0.45);
  }
  // ash drifting down (a prayer gone unanswered): a few grey specks, sinking, fading
  ash(p) {
    const n = 4, mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), new THREE.MeshBasicMaterial({ color: 0x8a8a8a, transparent: true, opacity: 0.9, depthWrite: false }), n), parts = [];
    mesh.frustumCulled = false;
    for (let i = 0; i < n; i++)
      parts.push({ p: p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.3, (Math.random() - 0.5) * 0.3)),
        v: new THREE.Vector3((Math.random() - 0.5) * 0.06, -(0.25 + Math.random() * 0.15), (Math.random() - 0.5) * 0.06),
        q: new THREE.Quaternion().random(), w: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(3), s: 0.7 + Math.random() * 0.6, grow: 0 });
    this.brick.world.add(mesh);
    this.shards.push({ mesh, parts, t: 0, life: 3.5, rise: true });
  }
  // a shiver: a few specks of frost glinting off you (p: your middle)
  frost(p) { this.sparkles(p, 4, 0xd9f3ff, 0.4); }

  // water run from a tap (a sink's): drops falling from its spout (p) into its bowl (down to floorY), a steady
  // stream of them for T s, splashing a little where they land; tint: of another colour (a potion's, sewage)
  pour(p, floorY, T = 1.2, { tint = null, rate = 40 } = {}) {
    const n = Math.ceil(T * rate), mat = new THREE.MeshStandardMaterial({ color: tint ?? 0x9fd8ff, roughness: 0.1, transparent: true, opacity: tint ? 0.9 : 0.75 });
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.014, 0), mat, n), drops = [];
    mesh.frustumCulled = false; mesh.renderOrder = 4;
    for (let i = 0; i < n; i++) drops.push({ t0: i / rate, j: [(Math.random() - 0.5) * 0.012, (Math.random() - 0.5) * 0.012] });
    this.brick.world.add(mesh);
    (this.pours = this.pours || []).push({ mesh, drops, p: p.clone(), floorY, t: 0, T, tint, splashT: 0 });
  }
  stepPours(dt) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const P of [...(this.pours || [])]) {
      P.t += dt;
      let live = false;
      P.drops.forEach((d, i) => {
        const u = P.t - d.t0, y = P.p.y - 0.5 * 9.8 * 0.25 * u * u; // (falling: a quarter of g, in squares)
        const on = u >= 0 && y > P.floorY;
        if (on) live = true;
        v.set(P.p.x + d.j[0], Math.max(P.floorY, y), P.p.z + d.j[1]);
        sc.setScalar(on ? 1 + Math.min(1.2, u * 3) : 0); // (drawn out as it falls)
        m4.compose(v, q, sc.set(on ? 1 : 0, on ? 1 + Math.min(2, u * 6) : 0, on ? 1 : 0));
        P.mesh.setMatrixAt(i, m4);
      });
      P.mesh.instanceMatrix.needsUpdate = true;
      if (P.t < P.T && P.t - P.splashT > 0.35) { P.splashT = P.t; this.splashStuds(new THREE.Vector3(P.p.x, P.floorY, P.p.z), 2, 0.5, P.tint ? { tint: P.tint } : {}); }
      if (!live && P.t > P.T) { this.brick.world.remove(P.mesh); P.mesh.geometry.dispose(); P.mesh.material.dispose(); this.pours.splice(this.pours.indexOf(P), 1); }
    }
  }
  // snatches of song from among the sewers: little black notes rising out of a drain (p), swaying, fading
  notes(p, n = 5) {
    const tex = noteTexture(), mat = new THREE.SpriteMaterial({ map: tex, color: 0x222222, transparent: true, depthWrite: false });
    for (let i = 0; i < n; i++)
      setTimeout(() => {
        const s = new THREE.Sprite(mat.clone());
        s.scale.setScalar(0.09);
        s.position.copy(p);
        this.brick.world.add(s);
        (this.noteList = this.noteList || []).push({ s, p: p.clone(), t: 0, ph: Math.random() * 6 });
      }, i * 380);
  }
  stepNotes(dt) {
    for (const N of [...(this.noteList || [])]) {
      N.t += dt;
      N.s.position.set(N.p.x + 0.06 * Math.sin(N.t * 3 + N.ph), N.p.y + N.t * 0.3, N.p.z + 0.04 * Math.cos(N.t * 2 + N.ph));
      N.s.material.opacity = Math.max(0, 1 - N.t / 2);
      if (N.t > 2) { this.brick.world.remove(N.s); N.s.material.dispose(); this.noteList.splice(this.noteList.indexOf(N), 1); }
    }
  }

  // a wisp of vapor rising out of a fountain (its magic gone out of it, as it's found): soft white puffs
  // drifting up from p, swelling and thinning away
  vapor(p, color = 0xf2fbff, size = 1) { // (size: how big its puffs: steam's, billowing)
    const n = 14, mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.045 * size, 1),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }), n), parts = [];
    mesh.frustumCulled = false;
    for (let i = 0; i < n; i++)
      parts.push({ p: p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.1, -i * 0.05, (Math.random() - 0.5) * 0.1)),
        v: new THREE.Vector3((Math.random() - 0.5) * 0.12, 0.35 + Math.random() * 0.25, (Math.random() - 0.5) * 0.12),
        q: new THREE.Quaternion(), w: new THREE.Vector3(), s: 0.6 + Math.random() * 0.6, grow: 1.2 });
    this.brick.world.add(mesh);
    this.shards.push({ mesh, parts, t: 0, life: 2.8, rise: true });
  }

  // a spit's trail: drips of its colour, let fall as it flies (integrate), each sticking where it lands
  trail(model) {
    const colors = [];
    model.traverse((o) => { if (o.isMesh && o.material && o.material.color) colors.push(o.material.color); });
    const mat = new THREE.MeshStandardMaterial({ color: (colors[0] || new THREE.Color(0x88cc44)).clone(), roughness: 0.1, metalness: 0, transparent: true, opacity: 0.85,
      emissive: venomGlow(colors[0] || new THREE.Color(0x88cc44)), emissiveIntensity: 0.5 });
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.016, 0), mat, DRIPS);
    mesh.count = 0;
    this.brick.world.add(mesh);
    const t = { mesh, parts: [], t: 0, life: 3, due: 0 };
    this.shards.push(t);
    return t;
  }

  stepShards(s, dt) {
    if (s.mesh.count !== undefined && s.parts.length < s.mesh.instanceMatrix.count) s.mesh.count = s.parts.length; // (a trail: as many drips as have fallen)
    s.t += dt;
    const life = s.life || SHARD_LIFE;
    const m4 = new THREE.Matrix4(), fade = Math.max(0, Math.min(1, (life - s.t) / 0.6));
    s.parts.forEach((f, i) => {
      if (!s.rise) f.v.y += G * dt; else f.s += (f.grow || 0) * dt * 0.4; // (vapor: no weight, swelling as it goes)
      f.p.addScaledVector(f.v, dt);
      if (s.sink && f.p.y < s.floor && f.v.y < 0) f.sunk = (f.sunk || 0) + dt; // (back into the water: sinking out of sight)
      else if (f.p.y < STUD_H + 0.01) {
        f.p.y = STUD_H + 0.01;
        if (f.stick) f.v.set(0, 0, 0); // (a drop: where it lands, it stays)
        else { f.v.y *= -0.3; f.v.x *= 0.6; f.v.z *= 0.6; f.w.multiplyScalar(0.6); }
      }
      f.q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(f.w.x * dt, f.w.y * dt, f.w.z * dt)));
      const k = f.s * fade * (f.sunk ? Math.max(0, 1 - f.sunk / 0.2) : 1);
      m4.compose(f.p, f.q, new THREE.Vector3(k, k, k));
      s.mesh.setMatrixAt(i, m4);
    });
    s.mesh.instanceMatrix.needsUpdate = true;
    if (s.t > life) {
      this.brick.world.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
      this.shards.splice(this.shards.indexOf(s), 1);
    }
  }
}

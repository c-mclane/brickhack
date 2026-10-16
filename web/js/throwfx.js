// Thrown things, in a little physics of their own (BrickWorld: LEGO levels).
// The engine says what was thrown (by the hero or a monster), from where, and
// where its flight stopped (winweb.c web_throw, web_mthrow_end); we fly it
// there in a slow, lofted arc, tumbling. Every square of the dungeon is a box:
// inside the one it was thrown to, it hits the far wall, bounces off and
// tumbles down, and comes to rest wherever it comes to rest. It stays so (its
// pose: poseFor) until it's picked up. Something that breaks (web_shatter)
// bursts into shards of its own colours as it lands; a potion splashes too.
//
// The body: a box the size of its model (its eight corners are what touch),
// with mass 1 and a box's inertia; contacts are impulses at the corners against
// the floor and the target square's four walls, with bounce and friction.

import * as THREE from 'three';
import { MODEL_SCALE, STUD_H } from './lego.js';

const G = -9; // gravity, squares per second²
const STEP = 1 / 240; // the simulation's step
const HAND = 0.55; // the hero's hand, above the floor
const E_FLOOR = 0.28, E_WALL = 0.4, FRICTION = 0.55;
const REST_V = 0.06, REST_W = 0.35, REST_TIME = 0.3, MAX_TIME = 6;
const SHARDS = 36, SHARD_LIFE = 1.6;

const key = (x, z, url) => `${x},${z},${url}`;

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

  // the hero threw (the item's model url) from square (fx, fz) to (tx, tz)
  async launch(url, fx, fz, tx, tz) {
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
    const p = new THREE.Vector3(fx + 0.5, STUD_H + HAND, fz + 0.5).addScaledVector(dir, 0.25);
    const aim = new THREE.Vector3(tx + 0.5, STUD_H + 0.75, tz + 0.5).addScaledVector(dir, 0.6);
    const T = 0.7 + 0.13 * dist; // (slow: you can watch it go)
    const v = aim.clone().sub(p).divideScalar(T);
    v.y -= 0.5 * G * T;
    // end over end, about the axis across its flight, and a little of everything
    const across = new THREE.Vector3(-dir.z, 0, dir.x);
    const w = across.multiplyScalar(6 + Math.random() * 6).add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dir.z, dir.x));
    Object.assign(b, { holder, m, c, corners, inertia, p, v, q, w, t: 0, rest: 0, grounded: false, loading: false });
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
    const R = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(b.q));
    const Iinv = R.clone().multiply(new THREE.Matrix3().set(1 / b.inertia.x, 0, 0, 0, 1 / b.inertia.y, 0, 0, 0, 1 / b.inertia.z)).multiply(R.clone().transpose());
    let hit = false;
    for (const [n, d, e, floor] of planes) {
      for (const c0 of b.corners) {
        const r = c0.clone().applyQuaternion(b.q);
        const depth = d - (b.p.x + r.x) * n.x - (b.p.y + r.y) * n.y - (b.p.z + r.z) * n.z;
        if (depth <= 0) continue;
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
    if (hit && b.breaks) { this.finish(b, true); return true; }
    if (b.grounded) { b.w.multiplyScalar(1 - 1.5 * dt); b.v.x *= 1 - 0.8 * dt; b.v.z *= 1 - 0.8 * dt; }
    if (b.grounded && b.v.length() < REST_V && b.w.length() < REST_W) b.rest += dt; else b.rest = 0;
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
  splash(colors, p, v) {
    const drink = colors.reduce((best, c) => (c.r + c.g + c.b < best.r + best.g + best.b ? best : c), colors[0]).clone(); // (its brightest colour: the drink)
    const geo = new THREE.IcosahedronGeometry(0.022, 0);
    const mat = new THREE.MeshStandardMaterial({ color: drink, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.85 });
    const n = 40, mesh = new THREE.InstancedMesh(geo, mat, n), parts = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.8 + Math.random() * 1.8;
      parts.push({ p: p.clone(), v: new THREE.Vector3(Math.cos(a) * s, 0.6 + Math.random() * 1.6, Math.sin(a) * s).addScaledVector(v, 0.15),
        q: new THREE.Quaternion(), w: new THREE.Vector3(), s: 0.6 + Math.random(), stick: true });
    }
    this.brick.world.add(mesh);
    this.shards.push({ mesh, parts, t: 0, life: 2.4 });
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshStandardMaterial({ color: drink, roughness: 0.05, transparent: true, opacity: 0.7, depthWrite: false }));
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(p.x, STUD_H + 0.004, p.z);
    puddle.scale.setScalar(0.01);
    this.brick.world.add(puddle);
    this.puddles = this.puddles || [];
    this.puddles.push({ mesh: puddle, t: 0, size: 0.28 + Math.random() * 0.12 });
  }

  stepShards(s, dt) {
    s.t += dt;
    const life = s.life || SHARD_LIFE;
    const m4 = new THREE.Matrix4(), fade = Math.max(0, Math.min(1, (life - s.t) / 0.6));
    s.parts.forEach((f, i) => {
      f.v.y += G * dt;
      f.p.addScaledVector(f.v, dt);
      if (f.p.y < STUD_H + 0.01) {
        f.p.y = STUD_H + 0.01;
        if (f.stick) f.v.set(0, 0, 0); // (a drop: where it lands, it stays)
        else { f.v.y *= -0.3; f.v.x *= 0.6; f.v.z *= 0.6; f.w.multiplyScalar(0.6); }
      }
      f.q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(f.w.x * dt, f.w.y * dt, f.w.z * dt)));
      m4.compose(f.p, f.q, new THREE.Vector3(f.s * fade, f.s * fade, f.s * fade));
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

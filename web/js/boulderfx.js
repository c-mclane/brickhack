// Boulders, in the little physics of thrown things (throwfx.js): pushed, a
// boulder slides over into the next square, rolling as it goes and riding over
// its own lumps, and comes to rest there as it lies (it stays so; a boulder that won't move doesn't: that's the
// engine's to say, and nothing rolls); broken (a pick-axe, force bolt), it
// bursts: a cloud of grit in its own colours, and rocks flung out to tumble to
// rest, the few the engine left there staying where they fall, the rest gone.
//
// The body: its model's outermost points (in 26 directions) are what touch;
// mass 1 and a box's inertia; contacts are impulses at those points against the
// floor and, once inside it, the four walls of the square it's going to (a
// nudge on, should it stall short of it); there it tumbles to rest wherever it
// will.
//
// Units: squares (a square is 1 across; models drawn at MODEL_SCALE); the
// floor at STUD_H, as in the game. `world`: what to draw in.

import * as THREE from 'three';
import { MODEL_SCALE, STUD_H } from './brick.js';

const G = -9; // gravity, squares per second²
const STEP = 1 / 240;
const E_FLOOR = 0.12, E_WALL = 0.25, FRICTION = 0.7;
const REST_V = 0.05, REST_W = 0.3, REST_TIME = 0.35, MAX_TIME = 5;
const SLIDE_TIME = 0.75; // s a pushed boulder takes to slide over into the next square
const GRIT = 90, GRIT_LIFE = 1.4;
const CRACK_T = 0.6; // s a cracked boulder's halves fall apart before they burst
const SHUDDER = 0.35; // s a breaking statue shudders before it comes apart

// the points of a model that can touch: the farthest vertex in each of 26 directions
function hullPoints(model, centre) {
  const dirs = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) dirs.push(new THREE.Vector3(x, y, z).normalize());
  const best = dirs.map(() => ({ d: -Infinity, p: null }));
  const v = new THREE.Vector3();
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  model.traverse((o) => {
    if (!o.isMesh) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), a = o.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      v.fromBufferAttribute(a, i).applyMatrix4(m).sub(centre);
      dirs.forEach((d, k) => { const s = v.dot(d); if (s > best[k].d) best[k] = { d: s, p: v.clone() }; });
    }
  });
  return best.filter((b) => b.p).map((b) => b.p.multiplyScalar(MODEL_SCALE));
}

// a body: its model in a holder whose origin is the model's middle
function makeBody(model, world) {
  const m = model.clone();
  m.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m);
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).multiplyScalar(MODEL_SCALE);
  const points = hullPoints(m, c);
  m.position.sub(c);
  const holder = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(MODEL_SCALE);
  inner.add(m);
  holder.add(inner);
  world.add(holder);
  const inertia = new THREE.Vector3((size.y ** 2 + size.z ** 2) / 12 || 0.01, (size.x ** 2 + size.z ** 2) / 12 || 0.01, (size.x ** 2 + size.y ** 2) / 12 || 0.01);
  // resting on the floor, as it stands
  let low = Infinity;
  for (const p of points) low = Math.min(low, p.y);
  return { holder, m, c, box, points, inertia, size, p: new THREE.Vector3(0, STUD_H - low, 0), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), t: 0, rest: 0 };
}

export class BoulderFX {
  constructor(world) {
    this.world = world;
    this.bodies = []; // in motion: boulders rolling, rocks flung
    this.all = new Set(); // everything it has drawn, moving or at rest (for clear)
    this.grit = []; // clouds: {mesh, parts, t}
    this.last = performance.now() / 1000;
  }

  // a boulder (its model) standing in square (x, z): its body, to push or break; `at`: where its
  // middle is and how it's turned, if it's already lying there some way ({p, q})
  place(model, x, z, at) {
    const b = makeBody(model, this.world);
    this.all.add(b);
    b.p.x = x + 0.5; b.p.z = z + 0.5;
    if (at) { b.p.copy(at.p); b.q.copy(at.q); }
    b.holder.position.copy(b.p);
    return b;
  }

  // pushed from where it is into square (tx, tz): rolls and tumbles there. Resolves when at rest.
  push(b, tx, tz) {
    // a slide, not a shove: it glides over into the square, easing in and out, rolling as it goes
    // (turned by how far it's come over its radius), riding up and down over its own lumps (always
    // resting on its lowest point), and settles there as it lies
    const to = new THREE.Vector3(tx + 0.5, 0, tz + 0.5), from = b.p.clone(), d = to.clone().sub(from).setY(0);
    Object.assign(b, { tx, tz, pull: false, t: 0, rest: 0, done: false,
      slide: { from, d, q0: b.q.clone(), axis: d.clone().normalize().cross(new THREE.Vector3(0, -1, 0)), roll: Math.PI / 2, T: SLIDE_TIME } }); // (rolled a quarter turn over a square: square to its square again)
    if (b.onRest) { const done = b.onRest; b.onRest = null; done(b); } // (pushed on mid-slide: the last push is over)
    return new Promise((res) => { b.onRest = res; if (!this.bodies.includes(b)) this.bodies.push(b); });
  }
  // a boulder's slide, this moment; true when it's there
  slideStep(b, dt) {
    const s = b.slide;
    b.t += dt;
    const u = Math.min(1, b.t / s.T), e = u * u * (3 - 2 * u);
    b.q.copy(s.q0).premultiply(new THREE.Quaternion().setFromAxisAngle(s.axis, s.roll * e));
    b.p.set(s.from.x + s.d.x * e, 0, s.from.z + s.d.z * e);
    let low = Infinity;
    for (const c0 of b.points) low = Math.min(low, c0.clone().applyQuaternion(b.q).y);
    b.p.y = STUD_H - low;
    if (u < 1) return false;
    b.slide = null;
    this.bodies.splice(this.bodies.indexOf(b), 1);
    if (b.onRest) b.onRest(b);
    return true;
  }

  // broken: the boulder bursts into grit and rocks; `rock`: the rocks' model; `keep`: how many stay
  // (resolves with the ones that stay, at rest, for whoever draws the floor to take over)
  // (fade: every rock flung goes once it's come to rest, none kept: the floor's own pile shows instead)
  shatter(b, rock, keep = 4, sq = null, fade = false) {
    this.world.remove(b.holder);
    this.bodies = this.bodies.filter((o) => o !== b);
    const colors = [];
    b.m.traverse((o) => { if (o.isMesh && o.material && o.material.color) colors.push(o.material.color); });
    this.burst(b.p.clone(), colors.length ? colors : [new THREE.Color(0x777777)]);
    const n = keep, rocks = []; // (every one flung stays where it comes to rest: the pile the engine left)
    for (let i = 0; i < n; i++) {
      const k = makeBody(rock, this.world);
      this.all.add(k);
      const a = (i + Math.random() * 0.6) / n * Math.PI * 2, s = 0.5 + Math.random() * 0.8;
      k.p.set(b.p.x + Math.cos(a) * 0.15, b.p.y + (Math.random() - 0.3) * 0.2, b.p.z + Math.sin(a) * 0.15);
      k.v.set(Math.cos(a) * s, 1 + Math.random() * 1.2, Math.sin(a) * s);
      k.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
      k.q.random();
      Object.assign(k, { tx: sq ? sq[0] : Math.floor(b.p.x), tz: sq ? sq[1] : Math.floor(b.p.z), pull: false, walls: true, stays: !fade, t: 0, rest: 0 }); // (kept in its square)
      rocks.push(k);
      this.bodies.push(k);
    }
    return Promise.all(rocks.map((k) => new Promise((res) => { k.onRest = () => res(k); }))).then((all) => all.filter((k) => k.stays));
  }

  // broken, a boulder first cracks in half: along its seam, the top half tips off one way and the
  // bottom rocks back the other, with a puff of chips; a moment later each bursts as a boulder does
  // (shatter: grit, and rocks, `keep` of them staying). halves: the two halves' models (its top,
  // then its bottom: tools/build_items.py "halves"), as the boulder's model has them, the bottom
  // 64 LDU under the top. Resolves with the rocks that stay
  crack(b, halves, rock, keep = 4, fade = false) {
    const sq = [Math.floor(b.p.x), Math.floor(b.p.z)];
    this.world.remove(b.holder);
    this.bodies = this.bodies.filter((o) => o !== b);
    this.all.delete(b);
    // where each half sits in the boulder's model: the two together, lined up with the whole by their bounds
    const at = [new THREE.Vector3(), new THREE.Vector3(0, -64 / 20, 0)], box = new THREE.Box3(), whole = b.box;
    const boxes = halves.map((h, i) => { const hb = new THREE.Box3().setFromObject(h); hb.translate(at[i]); box.union(hb); return hb; });
    const shift = whole.min.clone().sub(box.min);
    const dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(), side = new THREE.Vector3(0, 1, 0).cross(dir);
    const parts = halves.map((h, i) => {
      const k = makeBody(h, this.world);
      this.all.add(k);
      const c = boxes[i].getCenter(new THREE.Vector3()).add(shift).sub(b.c).multiplyScalar(MODEL_SCALE);
      k.q.copy(b.q);
      k.p.copy(b.p).add(c.applyQuaternion(b.q));
      // the top tips off over its edge; the bottom rocks back
      if (i === 0) { k.v.copy(dir).multiplyScalar(0.7).setY(1.1); k.w.copy(side).multiplyScalar(-6); }
      else { k.v.copy(dir).multiplyScalar(-0.25).setY(0.35); k.w.copy(side).multiplyScalar(3); }
      Object.assign(k, { tx: sq[0], tz: sq[1], pull: false, walls: true, t: 0, rest: 0 });
      k.holder.position.copy(k.p); k.holder.quaternion.copy(k.q);
      this.bodies.push(k);
      return k;
    });
    const colors = [];
    b.m.traverse((o) => { if (o.isMesh && o.material && o.material.color) colors.push(o.material.color); });
    this.burst(b.p.clone(), colors.length ? colors : [new THREE.Color(0x777777)], 24, 0.45, false);
    return new Promise((res) => setTimeout(res, CRACK_T * 1000)).then(() => Promise.all(parts.map((k, i) => {
      this.all.delete(k);
      return this.shatter(k, rock, i === 0 ? Math.ceil(keep / 2) : Math.floor(keep / 2), sq, fade);
    }))).then((kept) => kept.flat());
  }

  // a statue broken: brick by brick. It shudders; the figure on it crumbles, its pieces dropping away
  // limp, and the bricks under it blow apart in a burst of grit and dust, all tumbling to rest where
  // they fall. pieces: [{model, pos (where its model's origin is), q (how it's turned), fig (the
  // figure's: crumbles; else blown apart)}]; centre: the statue's middle at its foot; fade: each piece
  // goes once it's come to rest
  crumble(pieces, centre, fade = false) {
    const colors = [], bodies = pieces.map((pc) => {
      const k = makeBody(pc.model, this.world);
      this.all.add(k);
      k.q.copy(pc.q);
      k.p.copy(pc.pos).add(k.c.clone().multiplyScalar(MODEL_SCALE).applyQuaternion(pc.q));
      const out = k.p.clone().sub(centre).setY(0), d = out.length() > 1e-3 ? out.normalize() : new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      d.x += (Math.random() - 0.5) * 0.6; d.z += (Math.random() - 0.5) * 0.6; d.normalize();
      if (pc.fig) { // (limp: slumping off, a little out, turning over as it goes)
        k.v.copy(d).multiplyScalar(0.25 + Math.random() * 0.45).setY(Math.random() * 0.5);
        k.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(5);
        k.hold = SHUDDER + Math.random() * 0.12;
      } else { // (blown out, and up, spinning hard)
        const s = 1.3 + Math.random() * 1.6;
        k.v.copy(d).multiplyScalar(s).setY(1.6 + Math.random() * 1.8);
        k.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(16);
        k.hold = SHUDDER + 0.12;
        pc.model.traverse((o) => { if (o.isMesh && o.material && o.material.color && colors.length < 6) colors.push(o.material.color); });
      }
      Object.assign(k, { pull: false, walls: false, t: 0, rest: 0, stays: !fade });
      k.holder.position.copy(k.p); k.holder.quaternion.copy(k.q);
      this.bodies.push(k);
      return k;
    });
    setTimeout(() => this.burst(centre.clone().setY(centre.y + 0.25), colors.length ? colors : [new THREE.Color(0x999999)]), (SHUDDER + 0.12) * 1000);
    return Promise.all(bodies.map((k) => new Promise((res) => { k.onRest = () => res(k); })));
  }

  // take something away (a boulder or rock: picked up, or the scene reset)
  remove(b) { this.world.remove(b.holder); this.bodies = this.bodies.filter((o) => o !== b); this.all.delete(b); }
  // everything gone: boulders, rocks, grit (a scene reset)
  clear() {
    for (const b of this.all) this.world.remove(b.holder);
    for (const g of this.grit) this.world.remove(g.mesh || g.dust);
    this.all.clear(); this.bodies = []; this.grit = [];
  }

  step() {
    const now = performance.now() / 1000;
    const dt = Math.min(now - this.last, 1 / 20);
    this.last = now;
    for (const b of [...this.bodies]) {
      if (b.fading != null) { // a rock that doesn't stay: shrinking away
        b.fading += dt;
        b.holder.scale.setScalar(Math.max(0.001, Math.min(1, 1 - b.fading / 0.5)));
        if (b.fading > 0.5) { this.world.remove(b.holder); this.bodies.splice(this.bodies.indexOf(b), 1); this.all.delete(b); }
        continue;
      }
      if (b.hold > 0) { // (still in one piece a moment: shuddering where it stands)
        b.hold -= dt;
        b.holder.position.copy(b.p).add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.025));
        continue;
      }
      if (b.slide) this.slideStep(b, dt);
      else for (let t = 0; t < dt; t += STEP) if (this.integrate(b, Math.min(STEP, dt - t))) break;
      b.holder.position.copy(b.p);
      b.holder.quaternion.copy(b.q);
    }
    for (const g of [...this.grit]) this.stepGrit(g, dt);
  }

  integrate(b, dt) {
    b.t += dt;
    b.v.y += G * dt;
    const inside = b.p.x > b.tx && b.p.x < b.tx + 1 && b.p.z > b.tz && b.p.z < b.tz + 1;
    if (b.pull && !inside) { // (stalled short of its square: nudged on into it; once in, it tumbles where it will)
      const k = b.grounded ? 5 : 0;
      b.v.x += ((b.tx + 0.5 - b.p.x) * k - b.v.x * 1.5 * (b.grounded ? 1 : 0)) * dt;
      b.v.z += ((b.tz + 0.5 - b.p.z) * k - b.v.z * 1.5 * (b.grounded ? 1 : 0)) * dt;
    }
    b.p.addScaledVector(b.v, dt);
    const wq = new THREE.Quaternion(b.w.x * dt * 0.5, b.w.y * dt * 0.5, b.w.z * dt * 0.5, 0).multiply(b.q);
    b.q.set(b.q.x + wq.x, b.q.y + wq.y, b.q.z + wq.z, b.q.w + wq.w).normalize();
    const planes = [[new THREE.Vector3(0, 1, 0), STUD_H, E_FLOOR, true]];
    if ((b.pull || b.walls) && b.p.x > b.tx && b.p.x < b.tx + 1 && b.p.z > b.tz && b.p.z < b.tz + 1)
      planes.push([new THREE.Vector3(1, 0, 0), b.tx, E_WALL, false], [new THREE.Vector3(-1, 0, 0), -(b.tx + 1), E_WALL, false],
        [new THREE.Vector3(0, 0, 1), b.tz, E_WALL, false], [new THREE.Vector3(0, 0, -1), -(b.tz + 1), E_WALL, false]);
    const R = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(b.q));
    const Iinv = R.clone().multiply(new THREE.Matrix3().set(1 / b.inertia.x, 0, 0, 0, 1 / b.inertia.y, 0, 0, 0, 1 / b.inertia.z)).multiply(R.clone().transpose());
    b.grounded = false;
    for (const [n, d, e, floor] of planes) {
      for (const c0 of b.points) {
        const r = c0.clone().applyQuaternion(b.q);
        const depth = d - (b.p.x + r.x) * n.x - (b.p.y + r.y) * n.y - (b.p.z + r.z) * n.z;
        if (depth <= 0) continue;
        if (floor) b.grounded = true;
        b.p.addScaledVector(n, depth * 0.9);
        const vc = b.v.clone().add(b.w.clone().cross(r));
        const vn = vc.dot(n);
        if (vn >= 0) continue;
        const rn = r.clone().cross(n);
        const k = 1 + rn.clone().applyMatrix3(Iinv).dot(rn);
        const j = -(1 + e) * vn / k;
        const J = n.clone().multiplyScalar(j);
        const vt = vc.clone().addScaledVector(n, -vn);
        if (vt.lengthSq() > 1e-8) {
          const tdir = vt.clone().normalize();
          const rt = r.clone().cross(tdir);
          const kt = 1 + rt.clone().applyMatrix3(Iinv).dot(rt);
          J.addScaledVector(tdir, -Math.min(FRICTION * j, vt.length() / kt));
        }
        b.v.add(J);
        b.w.add(r.clone().cross(J).applyMatrix3(Iinv));
      }
    }
    if (b.grounded) { b.w.multiplyScalar(1 - 2 * dt); b.v.x *= 1 - 0.6 * dt; b.v.z *= 1 - 0.6 * dt; }
    if (b.grounded && b.v.length() < REST_V && b.w.length() < REST_W) b.rest += dt; else b.rest = 0;
    if (b.rest > REST_TIME || b.t > MAX_TIME) {
      this.bodies.splice(this.bodies.indexOf(b), 1);
      b.v.set(0, 0, 0); b.w.set(0, 0, 0);
      b.holder.position.copy(b.p); b.holder.quaternion.copy(b.q);
      if (b.stays === false) { b.fading = -0.8; this.bodies.push(b); } // (not staying: it lies a moment, then shrinks away)
      if (b.onRest) b.onRest(b);
      return true;
    }
    return false;
  }

  // grit: little chips of the boulder's colours flung out and falling, fading; and a puff of dust
  // (n chips, flung `power` as hard; dust: a puff of it too)
  burst(p, colors, n = GRIT, power = 1, puff = true) {
    const geo = new THREE.TetrahedronGeometry(0.03);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, transparent: true });
    const mesh = new THREE.InstancedMesh(geo, mat, n), parts = [];
    for (let i = 0; i < n; i++) {
      mesh.setColorAt(i, colors[i % colors.length].clone().multiplyScalar(0.7 + Math.random() * 0.5));
      const out = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar((0.8 + Math.random() * 2.4) * power);
      parts.push({ p: p.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.4)), v: out,
        q: new THREE.Quaternion().random(), w: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(30), s: 0.5 + Math.random() * 1.2 });
    }
    this.world.add(mesh);
    this.grit.push({ mesh, parts, t: 0 });
    if (!puff) return;
    // the dust: soft spheres swelling and thinning out
    const dust = new THREE.Group();
    const dm = new THREE.MeshStandardMaterial({ color: colors[0].clone().lerp(new THREE.Color(0xbbaa99), 0.5), roughness: 1, transparent: true, opacity: 0.5, depthWrite: false });
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 1), dm);
      s.position.set((Math.random() - 0.5) * 0.6, Math.random() * 0.3, (Math.random() - 0.5) * 0.6);
      s.userData.v = s.position.clone().normalize().multiplyScalar(0.4).setY(0.25);
      dust.add(s);
    }
    dust.position.copy(p);
    this.world.add(dust);
    this.grit.push({ dust, t: 0 });
  }

  stepGrit(g, dt) {
    g.t += dt;
    if (g.dust) {
      const k = g.t / 1.6;
      for (const s of g.dust.children) { s.position.addScaledVector(s.userData.v, dt); s.scale.setScalar(1 + k * 2.5); }
      g.dust.children[0].material.opacity = 0.5 * Math.max(0, 1 - k);
      if (k >= 1) { this.world.remove(g.dust); g.dust.children[0].material.dispose(); this.grit.splice(this.grit.indexOf(g), 1); }
      return;
    }
    const m4 = new THREE.Matrix4(), fade = Math.max(0, Math.min(1, (GRIT_LIFE - g.t) / 0.5));
    g.parts.forEach((f, i) => {
      f.v.y += G * dt;
      f.p.addScaledVector(f.v, dt);
      if (f.p.y < STUD_H + 0.01) { f.p.y = STUD_H + 0.01; f.v.y *= -0.3; f.v.x *= 0.5; f.v.z *= 0.5; f.w.multiplyScalar(0.5); }
      f.q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(f.w.x * dt, f.w.y * dt, f.w.z * dt)));
      m4.compose(f.p, f.q, new THREE.Vector3(f.s * fade, f.s * fade, f.s * fade));
      g.mesh.setMatrixAt(i, m4);
    });
    g.mesh.instanceMatrix.needsUpdate = true;
    if (g.t > GRIT_LIFE) { this.world.remove(g.mesh); g.mesh.geometry.dispose(); g.mesh.material.dispose(); this.grit.splice(this.grit.indexOf(g), 1); }
  }
}

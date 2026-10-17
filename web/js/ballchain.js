// The ball and chain (NetHack's punishment): a heavy iron ball on a loose
// chain, the chain's first link fastened to a figure's ankle, its last sunk
// into the ball. The chain is a rope of points a link apart (verlet: each
// point keeps its last position, and its speed is the difference), its first
// point held at the ankle, its last the ball's centre; the ball is a heavy body
// on the floor. Walk away and the chain pays out, comes taut and drags the
// ball after you, sliding against the floor and rolling as it goes; stop and
// it comes to rest where it is. The links lie where they fall.
//
// Units: studs (the model's own; the baseplate draws studs at scale 1). For a
// world drawn smaller (the game's MODEL_SCALE), give `scale`: positions are in
// world units, the meshes scaled to match.

import * as THREE from 'three';

const PITCH = 13.633 / 20; // studs from one link's pin to the next (30104k02)
const G = -40; // gravity, studs per second²
const STEP = 1 / 120;
const ITER = 16; // constraint passes per step
// how far a link reaches below the line through its pins, as it lies (turned 45°, every other
// one the other way, as a chain lies): its half width (5.5) and half thickness (1.5), each at 45°
const LINK_R = (5.5 + 1.5) * Math.SQRT1_2 / 20 + 0.01;
const BALL_INV = 1 / 60; // the ball's mass, against a link's 1
const SLIDE = 0.12; // how much of its speed along the floor a lying thing loses each step

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class BallChain {
  // link, ball: template models (a link along +Y from its pin at the origin; the ball any way);
  // anchor(): where the chain is fastened, in the parent's frame, now; parent: what to draw in;
  // links: how many; floor: the floor's height; dir: which way the chain first lies from the anchor
  constructor({ link, ball, anchor, parent, links = 12, floor = 0, scale = 1, dir = new THREE.Vector3(0, 0, -1) }) {
    this.anchor = anchor;
    this.floor = floor;
    this.s = scale;
    this.group = new THREE.Group();
    parent.add(this.group);
    // the ball: its model centred on its middle; its radius from its size
    const b = ball.clone();
    b.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(b);
    b.position.sub(box.getCenter(new THREE.Vector3()));
    this.R = box.getSize(new THREE.Vector3()).x / 2 * scale;
    this.ball = new THREE.Group();
    this.ball.scale.setScalar(scale);
    this.ball.add(b);
    this.group.add(this.ball);
    // the links, each its own copy of the model
    this.meshes = [];
    for (let i = 0; i < links; i++) {
      const m = link.clone();
      m.matrixAutoUpdate = false;
      this.group.add(m);
      this.meshes.push(m);
    }
    // the rope: points 0..links-1 the links' pins, the last point the ball's centre (the last
    // link reaches from its pin into the ball: sunk in, as if cast in it)
    this.len = [];
    for (let i = 0; i < links - 1; i++) this.len.push(PITCH * scale);
    this.len.push(this.R + PITCH * scale * 0.4);
    const start = anchor().clone();
    const d = dir.clone().setY(0).normalize(), side = new THREE.Vector3(-d.z, 0, d.x);
    this.p = [], this.q = [], this.inv = [];
    let at = start.clone();
    for (let i = 0; i <= links; i++) { // (loose: the links laid zigzag, the ball near)
      if (i > 0 && i < links) at = at.clone().addScaledVector(d, this.len[i - 1] * 0.45).addScaledVector(side, (i % 2 ? 0.6 : -0.6) * this.len[i - 1]);
      else if (i === links) at = at.clone().addScaledVector(d, this.len[i - 1]);
      const p = at.clone();
      p.y = i === links ? floor + this.R : Math.max(floor + LINK_R * scale, p.y - i * 0.3 * scale);
      this.p.push(p);
      this.q.push(p.clone());
      this.inv.push(i === 0 ? 0 : i === links ? BALL_INV : 1);
    }
    this.last = this.p[links].clone();
    this.t = 0;
    this.draw();
  }

  // the one chained (their middle {x, z}, their body's radius r, which way they face: yaw, the
  // game's), for the ball to keep out of; null: nothing to keep out of
  keepOut(a) { this.avoid = a; }

  // carried (fn: where the ball is held, now, in the parent's frame), or set down again (null)
  carry(fn) {
    this.carryFn = fn;
    this.inv[this.inv.length - 1] = fn ? 0 : BALL_INV;
  }

  // the square the ball is on, as the game has it ((x, z): its middle): the ball, lying free,
  // slides over there (the chain drags it as the game says it does), or is put there if it's far
  home(x, z) {
    const c = this.p[this.p.length - 1];
    if (Math.hypot(c.x - x, c.z - z) > 4) { // (teleported: no sliding there)
      const q = this.q[this.q.length - 1];
      c.x = q.x = x; c.z = q.z = z;
    }
    this.homeAt = [x, z];
  }

  step(dt) {
    dt = Math.min(dt, 1 / 20);
    this.t += dt;
    while (this.t >= STEP) { this.integrate(STEP); this.t -= STEP; }
    this.draw();
  }

  integrate(dt) {
    const n = this.p.length - 1, s = this.s;
    this.p[0].copy(this.anchor());
    this.q[0].copy(this.p[0]);
    if (this.carryFn) { this.p[n].copy(this.carryFn()); this.q[n].copy(this.p[n]); } // (in someone's arms)
    else if (this.homeAt) { // (lying free: sliding over to the square it's on, steadily, easing in at the end)
      const c = this.p[n], dx = this.homeAt[0] - c.x, dz = this.homeAt[1] - c.z, d = Math.hypot(dx, dz);
      const step = Math.min(d, Math.min(1.4, d * 2.5 + 0.15) * dt);
      if (d > 1e-5) { c.x += dx / d * step; c.z += dz / d * step; }
    }
    for (let i = 1; i <= n; i++) { // move on, at the speed it had, and fall
      const p = this.p[i], q = this.q[i];
      _d.subVectors(p, q).multiplyScalar(0.995);
      q.copy(p);
      p.add(_d);
      p.y += G * s * dt * dt;
    }
    for (let k = 0; k < ITER; k++) {
      for (let i = 0; i < n; i++) { // each link: no further than a link from the last (it can bunch up)
        const a = this.p[i], b = this.p[i + 1], wa = this.inv[i], wb = this.inv[i + 1];
        _d.subVectors(b, a);
        const d = _d.length(), L = this.len[i];
        if (d <= L && (i < n - 1 || d >= L * 0.98)) continue; // (the ball's link: held at its length)
        if (d < 1e-6 || wa + wb === 0) continue;
        _d.multiplyScalar((d - L) / d / (wa + wb));
        a.addScaledVector(_d, wa);
        b.addScaledVector(_d, -wb);
      }
      const c = this.p[n];
      if (this.avoid) { // the ball stays out of whoever's chained to it: it comes to rest at their feet
        const a = this.avoid, dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz), r = a.r + this.R;
        if (!this.carryFn && d < r) {
          const ux = d > 1e-6 ? dx / d : Math.sin(a.yaw || 0), uz = d > 1e-6 ? dz / d : -Math.cos(a.yaw || 0); // (dead centre: out in front)
          c.x = a.x + ux * r; c.z = a.z + uz * r;
        }
      }
      for (let i = 1; i < n; i++) { // the links stay out of the ball
        const p = this.p[i];
        _d.subVectors(p, c);
        const d = _d.length(), r = this.R + LINK_R * s;
        if (d < r && d > 1e-6) p.addScaledVector(_d, (r - d) / d);
      }
      for (let i = 1; i <= n; i++) { // the floor
        const p = this.p[i], r = i === n ? this.R : LINK_R * s;
        if (p.y < this.floor + r) p.y = this.floor + r;
      }
    }
    for (let i = 1; i <= n; i++) { // what lies on the floor drags on it
      const p = this.p[i], q = this.q[i], r = i === n ? this.R : LINK_R * s;
      if (p.y > this.floor + r + 0.01 * s) continue;
      const f = i === n ? SLIDE * 1.5 : SLIDE;
      q.x += (p.x - q.x) * f;
      q.z += (p.z - q.z) * f;
      if (q.y < p.y - 0.001) q.y = p.y; // (no bounce)
    }
  }

  draw() {
    const n = this.p.length - 1;
    // the ball: where it is, rolled by how far it went along the floor
    const c = this.p[n];
    _d.subVectors(c, this.last).setY(0);
    const dist = _d.length();
    if (dist > 1e-5) {
      _x.crossVectors(UP, _d).normalize();
      this.ball.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(_x, dist / this.R));
    }
    this.last.copy(c);
    this.ball.position.copy(c);
    // each link from its pin toward the next, every other one turned a quarter about its length
    for (let i = 0; i < n; i++) {
      _a.copy(this.p[i]);
      _b.copy(this.p[i + 1]);
      _y.subVectors(_b, _a);
      if (_y.lengthSq() < 1e-10) _y.set(0, 0, 1);
      _y.normalize();
      _x.crossVectors(UP, _y);
      if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
      _x.normalize();
      _z.crossVectors(_x, _y);
      { // turned 45° about its length, every other one the other way (each a quarter turn from the last)
        const a = i % 2 ? Math.PI / 4 : -Math.PI / 4, c = Math.cos(a), sn = Math.sin(a), t = _x.clone();
        _x.multiplyScalar(c).addScaledVector(_z, sn);
        _z.multiplyScalar(c).addScaledVector(t, -sn);
      }
      const m = this.meshes[i];
      m.matrix.makeBasis(_x, _y, _z).scale(new THREE.Vector3(this.s, this.s, this.s)).setPosition(_a);
      m.matrixWorldNeedsUpdate = true;
    }
  }

  dispose() { this.group.parent && this.group.parent.remove(this.group); }
}

// Where on a figure's leg the chain is fastened: just above the left foot, at
// the back of the ankle, in the leg's own frame (it swings with the leg).
// joints: figureJoints(model).joints. Returns a function giving the point in
// `frame`'s coordinates, now (the figure posed, its matrices up to date).
export function ankleAnchor(joints, frame) {
  const leg = joints.legL || joints.legs || joints.body;
  const box = new THREE.Box3();
  leg.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone();
    if (o !== leg) bb.applyMatrix4(o.matrix);
    box.union(bb);
  });
  const local = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y + (box.max.y - box.min.y) * 0.12, box.min.z + 0.1);
  const inv = new THREE.Matrix4(), out = new THREE.Vector3();
  return () => {
    frame.updateMatrixWorld(true);
    inv.copy(frame.matrixWorld).invert();
    return out.copy(local).applyMatrix4(leg.matrixWorld).applyMatrix4(inv);
  };
}

// Minifig animation: what makes a LEGO figure look alive, for any figure
// built by tools/build_roster.py (or the wardrobe). A figure comes in joints
// (body, head, armR, armL, itemR, itemL, legR, legL; ldraw2glb.figure_groups)
// with its rig (pivots and axes, in the model's units: ldraw2glb.figure_rig).
// FigureAnimator turns a state (walking, attacking, just spawned) into a
// matrix per joint, in the model's own frame; the renderers put those between
// the figure's model matrix and its parts (brickworld.js, lego.js).
//
//   breathing  the body swells and settles from the waist, always
//   spawning   a big stretch: arms up overhead, head back, and down again
//   idle       arms hang (an arm with something in its hand holds it at the
//              ready); the head looks about, now and then
//   walking    legs stride, arms swing gently at the sides, opposite the legs
//   attacking  a slash: the right arm (and whatever it holds) winds up high
//              and out to the right, the body twisting back, then sweeps down
//              and across to the left as the body twists through
//
// The right hand's item is a joint of its own (itemR) that moves with the arm,
// so whatever is wielded can one day be swapped for another LEGO piece.

const DEG = Math.PI / 180;

// ---- column-major 4x4 matrices (as WebGL and three.js's fromArray take them)
const ident = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
// turn `ang` radians about the unit `axis` through point p
function turnAbout(p, axis, ang) {
  if (!ang) return ident();
  let [x, y, z] = axis;
  const l = Math.hypot(x, y, z) || 1;
  x /= l; y /= l; z /= l;
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  const R = [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0];
  const m = new Float32Array(16);
  m.set(R);
  // translation: p - R p
  m[12] = p[0] - (R[0] * p[0] + R[4] * p[1] + R[8] * p[2]);
  m[13] = p[1] - (R[1] * p[0] + R[5] * p[1] + R[9] * p[2]);
  m[14] = p[2] - (R[2] * p[0] + R[6] * p[1] + R[10] * p[2]);
  m[15] = 1;
  return m;
}
// stretch by k along Y about height y0 (breathing)
function swellY(y0, k) {
  const m = ident();
  m[5] = k;
  m[13] = y0 * (1 - k);
  return m;
}

const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const approach = (v, target, rate, dt) => v + (target - v) * Math.min(1, rate * dt);
// a bump that rises over [a, b] and falls over [c, d] (0..1)
const bump = (t, a, b, c, d) => (t < a || t > d ? 0 : t < b ? ease((t - a) / (b - a)) : t < c ? 1 : 1 - ease((t - c) / (d - c)));

const STRETCH_TIME = 2.2; // s
export const ATTACK_TIME = 0.4; // s
// the slash, as keyframes over 0..1: shoulder swing (degrees, negative is up
// in front), the arm thrown out sideways (degrees about the figure's forward
// axis, positive out to its right), and the body's twist (radians, positive
// turns it to its right)
const SLASH = [
  { t: 0, swing: null, out: 0, twist: 0 }, // (from wherever the arm was)
  { t: 0.34, swing: -150, out: 38, twist: 0.32 }, // wound up: high and out to the right, turned back
  { t: 0.58, swing: -35, out: -40, twist: -0.38 }, // the cut: down and across to the left
  { t: 1, swing: null, out: 0, twist: 0 }, // and back to where it was
];
function slashAt(k, rest) {
  let i = 0;
  while (i < SLASH.length - 2 && k > SLASH[i + 1].t) i++;
  const a = SLASH[i], b = SLASH[i + 1], u = ease((k - a.t) / (b.t - a.t));
  const sw = (f) => (f.swing === null ? rest : f.swing);
  return { swing: sw(a) + (sw(b) - sw(a)) * u, out: a.out + (b.out - a.out) * u, twist: a.twist + (b.twist - a.twist) * u };
}

export class FigureAnimator {
  // rig: the model's joints ({armR: {pivot, axis, swing, holds}, armL, legs, head, waist}), or null
  constructor(rig, opts = {}) {
    this.rig = rig;
    this.t = opts.phase || 0; // seconds (offset so a crowd doesn't breathe in step)
    this.spawnT0 = -1e9;
    this.attackT0 = -1e9;
    this.walk = 0; // 0..1: how much the figure is walking
    this.stride = 0; // the walk cycle's phase (radians)
    this.headYaw = 0; this.headPitch = 0;
    this.look = { yaw: 0, pitch: 0, next: 1 + Math.random() * 2 };
    this.arm = { R: 0, L: 0 }; // the arms' current swing, degrees
    this.poses = {};
  }

  spawn() { this.spawnT0 = this.t; }
  attack() { this.attackT0 = this.t; }

  // state: {moving (bool), speed (stride cycles per second, default 1.75)}
  update(dt, state = {}) {
    const rig = this.rig;
    if (!rig) return null;
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const t = this.t;
    this.walk = approach(this.walk, state.moving ? 1 : 0, 8, dt);
    this.stride += dt * (state.speed || 1.75) * Math.PI * 2 * (state.moving ? 1 : this.walk);
    const swing = Math.sin(this.stride) * this.walk;
    const stretch = Math.min(1, (t - this.spawnT0) / STRETCH_TIME);
    const up = stretch < 1 ? bump(stretch, 0.08, 0.42, 0.62, 0.95) : 0; // arms overhead
    const atk = (t - this.attackT0) / ATTACK_TIME;

    // the head: looks about when standing, ahead when walking, back during the stretch
    if (t > this.look.next) {
      const busy = this.walk > 0.3;
      this.look.yaw = busy ? 0 : (Math.random() * 2 - 1) * 0.75;
      this.look.pitch = busy ? 0 : Math.random() < 0.25 ? 0.18 : (Math.random() - 0.5) * 0.12;
      this.look.next = t + (busy ? 0.5 : 1.8 + Math.random() * 3.2);
    }
    const lookYaw = this.walk > 0.3 ? 0 : this.look.yaw, lookPitch = this.walk > 0.3 ? 0 : this.look.pitch;
    this.headYaw = approach(this.headYaw, lookYaw * (1 - up), 5, dt);
    this.headPitch = approach(this.headPitch, lookPitch * (1 - up) - 0.35 * up, 5, dt);

    // breathing (deeper during the stretch)
    const breath = 0.012 * Math.sin((t / 3.6) * Math.PI * 2) + 0.03 * up;
    const waist = rig.waist ? rig.waist.pivot : [0, -1.6, 0];
    const slashing = atk >= 0 && atk < 1;
    const slash = slashing ? slashAt(atk, this.arm.R) : null;
    // the upper body: breathing, and twisting into a slash
    const B = mul(slash ? turnAbout(waist, [0, -1, 0], slash.twist) : ident(), swellY(waist[1], 1 + breath));

    const P = this.poses;
    P.body = B;
    const hp = rig.head ? rig.head.pivot : [0, 0, 0];
    P.head = mul(B, mul(turnAbout(hp, [0, 1, 0], this.headYaw), turnAbout(hp, [1, 0, 0], this.headPitch)));

    // the arms: swing (degrees, as tools/minifig.py's pose_arm: negative raises the arm forward)
    for (const side of ['R', 'L']) {
      const j = rig['arm' + side];
      if (!j) continue;
      const holding = !!j.holds;
      // at rest: hanging, or (holding something) at the ready, part way up
      let target = holding ? j.swing * 0.55 : 0;
      // walking: a gentle swing at the side, against the leg on that side (the
      // right leg goes back for swing > 0: legR below; a positive arm swing is back too)
      target += swing * (side === 'R' ? -1 : 1) * (holding ? 10 : 22);
      // the stretch: both arms up overhead
      target = target * (1 - up) + -165 * up;
      let a = approach(this.arm[side], target, 10, dt);
      let out = 0;
      if (side === 'R' && slash) { a = slash.swing; out = slash.out; }
      else this.arm[side] = a;
      // (the arm thrown out sideways: about the figure's forward axis, through the shoulder;
      // the right arm is on the figure's -X side, so out to the right is a turn about -Z)
      const M = mul(B, mul(turnAbout(j.pivot, [0, 0, side === 'R' ? -1 : 1], out * DEG), turnAbout(j.pivot, j.axis, (a - j.swing) * DEG)));
      P['arm' + side] = M;
      P['item' + side] = M;
    }

    // first person: the right arm as you see it in the corner of the view
    // (firstPersonMatrix): held up before you, bobbing a little as you walk,
    // and the slash as a cut across the view: up and out to the right, then
    // down and across to the left
    {
      const j = rig.armR;
      if (j) {
        let sw = swing * 4 + Math.sin(t * 1.7) * 1.2, out = 0;
        if (slashing) {
          const k = atk;
          const keys = [[0, 0, 0], [0.34, -14, 10], [0.58, 14, -40], [1, 0, 0]];
          let i = 0;
          while (i < keys.length - 2 && k > keys[i + 1][0]) i++;
          const a = keys[i], b = keys[i + 1], u = ease((k - a[0]) / (b[0] - a[0]));
          sw += a[1] + (b[1] - a[1]) * u;
          out = a[2] + (b[2] - a[2]) * u;
        }
        P.fpArmR = mul(turnAbout(j.pivot, [0, 0, 1], out * DEG), turnAbout(j.pivot, j.axis, sw * DEG));
      }
    }

    // the legs: stride, opposite each other
    if (rig.legs) {
      const a = swing * 32 * DEG;
      P.legR = turnAbout(rig.legs.pivot, rig.legs.axis, a);
      P.legL = turnAbout(rig.legs.pivot, rig.legs.axis, -a);
    }
    return P;
  }
}

// ---- three.js: a loaded figure's joints, and posing them
// root: a figure model (gltf.scene, or a clone of it). Returns {rig, joints:
// {name: Object3D}} (joints posed by matrix from now on), or null if the
// model isn't in joints (an older build: it stays still).
export function figureJoints(root) {
  let fig = null;
  root.traverse((o) => { if (!fig && o.userData && o.userData.rig) fig = o; });
  if (!fig) return null;
  const joints = {};
  for (const c of fig.children) {
    if (!c.name) continue;
    c.matrixAutoUpdate = false;
    joints[c.name] = c;
  }
  return { rig: fig.userData.rig, joints };
}
export function poseJoints(j, poses) {
  if (!j || !poses) return;
  for (const [name, o] of Object.entries(j.joints)) {
    const m = poses[name];
    if (m) o.matrix.fromArray(m); else o.matrix.identity();
    o.matrixWorldNeedsUpdate = true;
  }
}

// First person: where to put the figure so that its right arm (and what it
// holds) reaches into the lower right of the view, as if it were your own.
// A view-space model matrix: the figure turned to face where you look, its
// right shoulder just below and right of the eye, and turned so the arm (as it
// hangs, unposed) is held up before you: a big fist and its blade close in the
// corner, Minecraft style. Pose the arm with FigureAnimator's fpArmR.
export function firstPersonMatrix(rig, aspect = 16 / 9) {
  const j = rig && rig.armR;
  if (!j) return null;
  const s = 0.16; // studs -> view units
  const shoulder = [0.11 + 0.06 * Math.min(aspect, 2), -0.2, -0.16];
  // T(shoulder) * tip forward * face away (turn half round) * scale * T(-pivot)
  const toPivot = ident(); toPivot[12] = -j.pivot[0]; toPivot[13] = -j.pivot[1]; toPivot[14] = -j.pivot[2];
  const S = ident(); S[0] = S[5] = S[10] = s;
  const back = turnAbout([0, 0, 0], [0, 1, 0], Math.PI);
  const tip = turnAbout([0, 0, 0], [1, 0, 0], 1.93); // (the arm held up: as in the arrival stretch)
  const T = ident(); T[12] = shoulder[0]; T[13] = shoulder[1]; T[14] = shoulder[2];
  return mul(T, mul(tip, mul(back, mul(S, toPivot))));
}

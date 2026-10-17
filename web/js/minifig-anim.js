// Minifig animation: what makes a brick figure look alive, for any figure
// built by tools/build_roster.py (or the wardrobe). A figure comes in joints
// (body, head, armR, armL, itemR, itemL, legR, legL; ldraw2glb.figure_groups)
// with its rig (pivots and axes, in the model's units: ldraw2glb.figure_rig).
// FigureAnimator turns a state (walking, attacking, just spawned) into a
// matrix per joint, in the model's own frame; the renderers put those between
// the figure's model matrix and its parts (brickworld.js, brick.js).
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
// so whatever is wielded can one day be swapped for another brick piece.

const DEG = Math.PI / 180;

// ---- column-major 4x4 matrices (as WebGL and three.js's fromArray take them)
const ident = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export function mul(a, b) {
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
export const FP_TILT = 1.93; // first person: how far the arm is turned up (radians)
export const FP_HOLD_TILT = 1.0; // ...holding something: lower, so the wrist can stand the blade straight up beside the view
export const ATTACK_TIME = 0.55; // s
export const SLASH_CUT = 0.62; // how far into the slash (0..1) the blade reaches the bottom of its cut: where a blow lands
// the slash, as keyframes over 0..1: shoulder swing (degrees, negative is up
// in front), the arm thrown out sideways (degrees about the figure's forward
// axis, positive out to its right), and the body's twist (radians, positive
// turns it to its right)
const SLASH = [
  { t: 0, swing: null, out: 0, twist: 0 }, // (from wherever the arm was)
  { t: 0.36, swing: -145, out: 72, twist: 0.42 }, // wound up: high and well out to the right (clear of the head), turned back
  { t: 0.5, swing: -62, out: 58, twist: 0.05 }, // coming down beside you (still out to the side: the blade never crosses your face)...
  { t: SLASH_CUT, swing: -12, out: -62, twist: -0.55 }, // ...then the cut: low and across to the left, following through
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
    this.attackSide = 'R'; // which arm swings (a throw: the left)
    this.walk = 0; // 0..1: how much the figure is walking
    this.stride = 0; // the walk cycle's phase (radians)
    this.headYaw = 0; this.headPitch = 0;
    this.look = { yaw: 0, pitch: 0, next: 1 + Math.random() * 2 };
    this.arm = { R: 0, L: 0 }; // the arms' current swing, degrees
    this.act = { lean: 0, reach: 0, lookUp: 0, heavy: 0, hop: 0 }; // what the body's doing, eased (state: lean...)
    this.poses = {};
  }

  spawn() { this.spawnT0 = this.t; }
  attack(side = 'R') { this.attackT0 = this.t; this.attackSide = side; }

  // state: {moving (bool), speed (stride cycles per second, default 1.75),
  //   holdsR, holdsL (bool: something's in that hand now, whatever the figure was built holding),
  //   twoweap (bool: fighting with both: the left slashes too, just after the right),
  //   lean (radians: the body bent forward at the waist, as into a push), reach (0..1: both arms
  //   out in front, pushing), lookUp (0..1: gazing up at something tall), heavy (0..1: lugging
  //   something far too heavy in both arms: leaning back, arms shaking, staggering), hop (0..1:
  //   in the air, a little jump: arms flung up, knees up)}
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
    const A = this.act;
    for (const k of ['lean', 'reach', 'lookUp', 'heavy']) A[k] = approach(A[k], state[k] || 0, 6, dt);
    A.hop = state.hop || 0; // (follows the jump exactly)
    const heavy = A.heavy, shake = heavy * Math.sin(t * 31) * 2.5; // (degrees: arms trembling under the weight)

    // the head: looks about when standing, ahead when walking, back during the stretch
    if (t > this.look.next) {
      const busy = this.walk > 0.3;
      this.look.yaw = busy ? 0 : (Math.random() * 2 - 1) * 0.75;
      this.look.pitch = busy ? 0 : Math.random() < 0.25 ? 0.18 : (Math.random() - 0.5) * 0.12;
      this.look.next = t + (busy ? 0.5 : 1.8 + Math.random() * 3.2);
    }
    const lookYaw = this.walk > 0.3 ? 0 : this.look.yaw, lookPitch = this.walk > 0.3 ? 0 : this.look.pitch;
    this.headYaw = approach(this.headYaw, lookYaw * (1 - up), 5, dt);
    this.headPitch = approach(this.headPitch, (lookPitch * (1 - up) - 0.35 * up) * (1 - A.lookUp) - 0.55 * A.lookUp + 0.15 * heavy, 5, dt);

    // breathing (deeper during the stretch)
    const breath = 0.012 * Math.sin((t / 3.6) * Math.PI * 2) + 0.03 * up;
    const waist = rig.waist ? rig.waist.pivot : [0, -1.6, 0];
    const lefty = this.attackSide === 'L'; // (a throw: the left arm swings, the body twisting the other way)
    const slash = atk >= 0 && atk < 1 ? slashAt(atk, this.arm[lefty ? 'L' : 'R']) : null;
    // walking: a little waddle, the upper body rocking over whichever foot is down
    // (so a short figure's steps don't look like gliding)
    // (lugging something heavy: a stagger, side to side)
    const waddle = turnAbout(waist, [0, 0, 1], Math.sin(this.stride) * this.walk * 4 * (1 + 2.5 * heavy) * DEG);
    // bent forward into a push; leaning back under a weight
    const bend = turnAbout(waist, [1, 0, 0], A.lean - 0.14 * heavy);
    // the upper body: breathing, twisting into a slash, waddling
    const B = mul(bend, mul(waddle, mul(slash ? turnAbout(waist, [0, -1, 0], lefty ? -slash.twist : slash.twist) : ident(), swellY(waist[1], 1 + breath))));

    const P = this.poses;
    P.body = B;
    P.amulet = B; // (an amulet worn: on the chest, moving with it)
    const hp = rig.head ? rig.head.pivot : [0, 0, 0];
    P.head = mul(B, mul(turnAbout(hp, [0, 1, 0], this.headYaw), turnAbout(hp, [1, 0, 0], this.headPitch)));

    // the arms: swing (degrees, as tools/minifig.py's pose_arm: negative raises the arm forward)
    for (const side of ['R', 'L']) {
      const j = rig['arm' + side];
      if (!j) continue;
      const holding = !!j.holds || !!state['holds' + side];
      // at rest: hanging, or (holding something) at the ready, part way up
      let target = holding ? (j.swing ? j.swing * 0.55 : -30) : 0;
      // walking: a gentle swing at the side, against the leg on that side (the
      // right leg goes back for swing > 0: legR below; a positive arm swing is back too)
      target += swing * (side === 'R' ? -1 : 1) * (holding ? 10 : 22);
      // the stretch: both arms up overhead
      target = target * (1 - up) + -165 * up;
      // pushing: both arms out in front, flat against what's pushed; lugging: both low in front,
      // round the weight, shaking; in a hop: flung up
      target = target * (1 - A.reach) - 88 * A.reach;
      target = target * (1 - heavy) + (-52 + shake * (side === 'R' ? 1 : -1)) * heavy;
      target += -55 * A.hop;
      let a = approach(this.arm[side], target, 10, dt);
      let out = 0;
      // (fighting with two weapons, the left slashes too, a moment after the right)
      const slashL = side === 'L' && !lefty && state.twoweap && atk >= 0.25 && atk < 1.25 ? slashAt(atk - 0.25, this.arm.L) : null;
      if (slash && side === (lefty ? 'L' : 'R')) { a = slash.swing; out = slash.out; }
      else if (slashL) { a = slashL.swing; out = slashL.out; }
      else this.arm[side] = a;
      // (as a shoulder does it: the arm first thrown out sideways (about the figure's
      // forward axis, through the shoulder; the right arm is on the figure's -X side,
      // so out is a turn about -Z), then swung up about the shoulder; the other way
      // round, an arm raised overhead and then turned "out" would sweep across the head)
      const M = mul(B, mul(turnAbout(j.pivot, j.axis, (a - j.swing) * DEG), turnAbout(j.pivot, [0, 0, side === 'R' ? -1 : 1], out * DEG)));
      P['arm' + side] = M;
      P['hand' + side] = M; // (the hand, and what it holds, turn with the arm; first person also turns the wrist)
      P['item' + side] = M;
    }

    // first person: each arm as you see it in its corner of the view
    // (firstPersonMatrix): held up before you, bobbing a little as you walk,
    // and the slash as a cut across the view: up and out to its side, then
    // down and across (the left one, two-weaponing, a moment after the right)
    for (const side of ['R', 'L']) {
      const j = rig['arm' + side];
      if (!j) continue;
      let sw = swing * (side === 'R' ? 4 : -4) + Math.sin(t * 1.7 + (side === 'L' ? 1 : 0)) * 1.2, out = 0;
      const k = side === this.attackSide ? atk : side === 'L' && state.twoweap ? atk - 0.25 : -1;
      if (k >= 0 && k < 1) {
        // (seen from behind your own arm, swing + brings the blade down toward the
        // middle, out + carries the fist in toward the middle) a wind-up back and
        // out, then a swoop down and across: the blade's tip from the top right,
        // through the middle, down to the left
        const keys = [[0, 0, 0], [0.36, -20, -15], [SLASH_CUT, 65, 60], [1, 0, 0]];
        let i = 0;
        while (i < keys.length - 2 && k > keys[i + 1][0]) i++;
        const a = keys[i], b = keys[i + 1], u = ease((k - a[0]) / (b[0] - a[0]));
        sw += a[1] + (b[1] - a[1]) * u;
        out = a[2] + (b[2] - a[2]) * u;
      }
      P['fpArm' + side] = mul(turnAbout(j.pivot, [0, 0, side === 'R' ? 1 : -1], out * DEG), turnAbout(j.pivot, j.axis, sw * DEG));
    }

    // the legs: stride, opposite each other
    if (rig.legs) {
      const a = swing * 32 * (1 - 0.5 * heavy) * DEG, tuck = -40 * A.hop * DEG; // (heavy: short steps; a hop: knees up)
      P.legR = turnAbout(rig.legs.pivot, rig.legs.axis, a + tuck);
      P.legL = turnAbout(rig.legs.pivot, rig.legs.axis, -a + tuck);
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
export function firstPersonMatrix(rig, aspect = 16 / 9, side = 'R', tilt = FP_TILT) {
  const j = rig && rig['arm' + side];
  if (!j) return null;
  const s = 0.16; // studs -> view units
  const shoulder = [(side === 'R' ? 1 : -1) * (0.11 + 0.06 * Math.min(aspect, 2)), -0.2, -0.16]; // (the left one mirrored)
  // T(shoulder) * tip forward * face away (turn half round) * scale * T(-pivot)
  const toPivot = ident(); toPivot[12] = -j.pivot[0]; toPivot[13] = -j.pivot[1]; toPivot[14] = -j.pivot[2];
  const S = ident(); S[0] = S[5] = S[10] = s;
  const back = turnAbout([0, 0, 0], [0, 1, 0], Math.PI);
  const tip = turnAbout([0, 0, 0], [1, 0, 0], tilt); // (FP_TILT: the arm held up, as in the arrival stretch)
  const T = ident(); T[12] = shoulder[0]; T[13] = shoulder[1]; T[14] = shoulder[2];
  return mul(T, mul(tip, mul(back, mul(S, toPivot))));
}

// First person: the turn of the wrist (a matrix in the arm's frame, about the
// hand's own axis: tools/minifig.py pose_arm's roll) that brings what the hand
// holds round so its blade stands up beside the view, raised and ready (the
// grip stays in the fist). fm: firstPersonMatrix, with FP_HOLD_TILT.
const wristCache = new Map();
export function firstPersonWrist(rig, fm, side = 'R') {
  const j = rig && rig['arm' + side], h = rig && rig['hand' + side];
  if (!j || !j.grip || !h || !fm) return null;
  const key = side + fm.join(',');
  if (wristCache.has(key)) return wristCache.get(key);
  const G = new Float32Array(j.grip);
  const sx = side === 'R' ? 1 : -1;
  const want = [-0.08 * sx, 1, -0.1], wl = Math.hypot(...want); // (straight up, beside the view)
  let best = null;
  for (let deg = 0; deg < 360; deg += 3) {
    const W = turnAbout(h.pivot, h.axis, deg * DEG);
    const A = mul(fm, mul(W, G));
    const b = [A[4], A[5], A[6]], bl = Math.hypot(...b) || 1; // the item's +Y (its blade), in view space
    const score = (b[0] * want[0] + b[1] * want[1] + b[2] * want[2]) / (bl * wl);
    if (!best || score > best.score) best = { score, W };
  }
  if (wristCache.size > 64) wristCache.clear();
  wristCache.set(key, best.W);
  return best.W;
}

// A ring worn as a bracelet: round the wrist, where the hand meets the sleeve
// (slipped over the hand's wrist peg, as a ring 11010 goes on a real
// minifig). The hand's pivot and turning axis (rig hand{R,L}: the hand's own
// Z) in the model's units; the wrist is 2 LDU along it, toward the hand. A
// ring model (tools/build_items.py) stands on its axis, +Y, 0.4 tall: turned
// onto the wrist's axis, its middle at the wrist. -> a column-major 4x4 in
// the figure's (hand joint's) frame, or null.
export function wristMatrix(rig, side) {
  const h = rig && rig['hand' + side];
  if (!h || !h.axis) return null;
  let [ax, ay, az] = h.axis;
  const n = Math.hypot(ax, ay, az) || 1;
  ax /= n; ay /= n; az /= n;
  // a rotation taking +Y onto the axis (Rodrigues, about Y x axis)
  const c = ay, k = 1 / (1 + c + 1e-9);
  const vx = az, vz = -ax; // (Y x a = (az, 0, -ax))
  // the rotation's columns, written out: R = I + [v]x + [v]x^2 / (1 + c), v = (vx, 0, vz)
  const R = [
    [1 - k * vz * vz, -vz, k * vx * vz],
    [vz, c, -vx],
    [k * vx * vz, vx, 1 - k * vx * vx],
  ];
  const [px, py, pz] = h.pivot;
  const t = [px - 0.3 * ax, py - 0.3 * ay, pz - 0.3 * az]; // (centre at pivot - 0.1 axis; the ring's own middle is 0.2 up it)
  return [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, t[0], t[1], t[2], 1];
}

// A hinged part (a chest's lid: tools/build_items.py "hinge", in the model's
// extras) swung open by `deg` degrees about its hinge. root: a loaded model
// (or a clone); its hinged node is posed by matrix from then on.
export function setHinge(THREE, root, deg) {
  let h = null;
  root.traverse((o) => { if (!h && o.userData && o.userData.hinge) h = o.userData.hinge; });
  if (!h) return false;
  const part = root.getObjectByName(h.joint);
  if (!part) return false;
  const p = new THREE.Vector3(...h.pivot), ax = new THREE.Vector3(...h.axis).normalize();
  const m = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(ax, (deg * Math.PI) / 180))
    .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  part.matrixAutoUpdate = false;
  part.matrix.copy(m);
  part.matrixWorldNeedsUpdate = true;
  return h.open;
}

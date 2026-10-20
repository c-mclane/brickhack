// Standing at a statue (or the rim of a fountain: PERCHES): a statue's square (the brick dungeon) is all plinth, so
// whoever walks onto it hops up onto one of the four scroll corbels round its
// column (the one on the side they came from) and stands there on the ledge,
// gazing up at the statue (its model: items.json "statue"); stepping off, they
// go round the ledge to the corbel on the side they're leaving by and jump down
// from there. Shared by the game
// (main.js) and the test dungeon (testbed.js).
//
// Units: squares, the game's yaw (0 looks north, -Z).

import { STUD_H } from './brick.js';

// what you can stand up on, by its floor item's name: its ledge (R: out from its middle; H: up from
// its foot) and how far its foot reaches out from its middle (OUT), all squares. A statue: its
// scroll corbels; a fountain: the rim of its pool
export const PERCHES = {
  statue: { R: 52 / 80, H: 24 / 80, OUT: 60 / 80 },
  fountain: { R: 70 / 80, H: 48 / 80, OUT: 80 / 80 },
};
const STATUE = PERCHES.statue;
const HOP = 0.28; // (how high the hop goes over the ledge)

// the statue's side (of its four, square to the grid) that best faces the way (fx, fz)
function side(fx, fz) {
  if (!fx && !fz) fz = 1;
  let best = null;
  for (const [wx, wz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const s = wx * fx + wz * fz;
    if (!best || s > best.s) best = { s, wx, wz };
  }
  return best;
}
const smooth = (u) => u * u * (3 - 2 * u);
// round the ledge from side `a` to side `b` (v: 0..1): by angle, the short way round (all the way
// to the far side: always the same way), never across the statue; a unit direction [x, z]
function roundLedge(a, b, v) {
  const a0 = Math.atan2(a.wz, a.wx);
  let da = Math.atan2(b.wz, b.wx) - a0;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  if (Math.abs(Math.abs(da) - Math.PI) < 1e-3) da = Math.PI;
  return [Math.cos(a0 + da * v), Math.sin(a0 + da * v)];
}
const statueAt = (drops, x, y) => (drops || []).find((d) => d.x === x && d.z === y && PERCHES[d.name]);

// where you stand, off where you'd be (pos): hero {x, y} (your square), track (cameFrom: the
// square you came from, and the side you're perched on), pos [x, z] (where you are, walking),
// drops (brickworld's floor items, world.brickDrops). {k (0..1: how much the statue has you;
// past 0.5 you face as it says), dx, dz, lift, yaw, hop (0..1: in the air), lookUp (0..1)}, or null.
//   onto it: a hop up onto the ledge on the side you came from, then gazing up at it;
//   off it: along the ledge to the corbel on the side you're leaving by, and a jump down from there
export function perchSpot(hero, track, pos, drops) {
  const on = statueAt(drops, hero.x, hero.y), pr = PERCHES[(on || statueAt(drops, track.perch ? track.perch.x : -1, track.perch ? track.perch.y : -1) || { name: 'statue' }).name];
  const PERCH_R = pr.R, L = STUD_H + pr.H;
  if (on) {
    const k = Math.max(0, Math.min(1, 1 - Math.hypot(pos[0] - hero.x, pos[1] - hero.y)));
    if (k <= 0) return null;
    const sd = side(track.x - hero.x, track.y - hero.y);
    track.perch = { x: hero.x, y: hero.y, wx: sd.wx, wz: sd.wz }; // (where you'll hop off from)
    const e = smooth(k), hop = Math.sin(Math.PI * Math.min(1, k * 1.15));
    return { k, dx: sd.wx * PERCH_R * e, dz: sd.wz * PERCH_R * e, lift: L * e + HOP * hop,
      yaw: Math.atan2(-sd.wx, sd.wz), hop: k < 1 ? hop : 0, lookUp: e };
  }
  // stepping off a statue you were up on: still within a square of it
  const p = track.perch;
  if (!p || p.x !== track.x || p.y !== track.y || !statueAt(drops, p.x, p.y)) return null;
  const u = Math.hypot(pos[0] - p.x, pos[1] - p.y);
  if (u >= 1) { track.perch = null; return null; }
  const ex = hero.x - p.x, ez = hero.y - p.y, out = side(ex, ez);
  const yaw = Math.atan2(ex, -ez); // (facing the way you go)
  // where you are, from the statue's middle: first along the ledge to the corbel on your way out...
  let ax, az, lift, hop = 0;
  if (u < 0.3) {
    [ax, az] = roundLedge({ wx: p.wx, wz: p.wz }, out, smooth(u / 0.3));
    ax *= PERCH_R; az *= PERCH_R;
    lift = L;
  } else { // ...then off, in a jump, down onto the square you're stepping to
    const v = (u - 0.3) / 0.7;
    ax = out.wx * PERCH_R + (ex - out.wx * PERCH_R) * v; az = out.wz * PERCH_R + (ez - out.wz * PERCH_R) * v;
    hop = Math.sin(Math.PI * v);
    lift = L * (1 - v) + HOP * 1.4 * hop;
  }
  return { k: 1, dx: p.x + ax - pos[0], dz: p.y + az - pos[1], lift, yaw, hop, lookUp: 0 };
}

// ---- the same, timed (free walking: main.js): hopping on, up there, hopping off, each a little
// play of its own, whatever way you came and however you go. Each gives where you are off the
// statue's middle ({x, z}), how high, which way you face, how far into a hop, and how far you gaze up.
export const HOP_ON = 0.5; // s (hopping off: offTime)
export const sideToward = side;
// up from `from` (where you were on the square, off its middle: [x, z]) onto the ledge on `sd`'s side; u: 0..1
// (springing up first, then in over the corbels: never through them)
export function hopOn(from, sd, u, pr = STATUE) {
  u = Math.min(1, u);
  const e = smooth(Math.max(0, (u - 0.3) / 0.7)), tx = sd.wx * pr.R, tz = sd.wz * pr.R, h = Math.sin(Math.PI * u);
  return { x: from[0] + (tx - from[0]) * e, z: from[1] + (tz - from[1]) * e, lift: (STUD_H + pr.H) * smooth(Math.min(1, u / 0.45)) + HOP * h,
    yaw: Math.atan2(-sd.wx, sd.wz), hop: u < 1 ? h : 0, lookUp: smooth(u) };
}
// how far the statue's foot reaches out from its middle (its scroll corbels): squares
export const STATUE_OUT = STATUE.OUT;
// on the ledge: standing there, gazing up
export const perched = (sd, pr = STATUE) => ({ x: sd.wx * pr.R, z: sd.wz * pr.R, lift: STUD_H + pr.H, yaw: Math.atan2(-sd.wx, sd.wz), hop: 0, lookUp: 1 });
// off: round the ledge from `sd`'s side to `out`'s, bounding athletically round the column (a spring
// each quarter turn, facing the way you go), then a jump down to `dest` (off the middle: just into the
// square you're going to). t: seconds in; offTime(sd, out): how long it all takes
const SWING_Q = 0.3, JUMP = 0.45; // (s a quarter turn round the ledge; s the jump down)
const turnOf = (a, b) => {
  let da = Math.atan2(b.wz, b.wx) - Math.atan2(a.wz, a.wx);
  da = Math.atan2(Math.sin(da), Math.cos(da));
  return Math.abs(Math.abs(da) - Math.PI) < 1e-3 ? Math.PI : da;
};
// facing along the ledge at angle a, going round it the way da turns; and from one facing to another, the short way
const alongYaw = (a, da) => Math.atan2(-Math.sin(a) * Math.sign(da), -Math.cos(a) * Math.sign(da));
const turnTo = (y0, y1, k) => { const d = Math.atan2(Math.sin(y1 - y0), Math.cos(y1 - y0)); return y0 + d * k; };
export const offTime = (sd, out) => (Math.abs(turnOf(sd, out)) / (Math.PI / 2)) * SWING_Q + JUMP;
export function hopOff(sd, out, dest, t, pr = STATUE) {
  const PERCH_R = pr.R, L = STUD_H + pr.H, da = turnOf(sd, out), swing = (Math.abs(da) / (Math.PI / 2)) * SWING_Q;
  if (t < swing) { // (bounding round the ledge)
    const v = smooth(t / swing), a = Math.atan2(sd.wz, sd.wx) + da * v;
    const quarters = Math.abs(da) / (Math.PI / 2), b = Math.abs(Math.sin(Math.PI * quarters * (t / swing)));
    // (turning from the statue to run along the ledge, over the first half of it)
    const yaw = turnTo(Math.atan2(-sd.wx, sd.wz), alongYaw(a, da), smooth(Math.min(1, (t / swing) * 2)));
    return { x: Math.cos(a) * PERCH_R, z: Math.sin(a) * PERCH_R, lift: L + HOP * 0.55 * b, yaw, hop: b * 0.8, lookUp: 0 };
  }
  const v = Math.min(1, (t - swing) / JUMP), h = Math.sin(Math.PI * v), ox = out.wx * PERCH_R, oz = out.wz * PERCH_R;
  const o = 1 - (1 - v) ** 2; // (out over the corbels early in the jump, then down: never through them)
  // (turning, as you spring, from along the ledge (or the statue) to the way you jump)
  const from = swing ? alongYaw(Math.atan2(out.wz, out.wx), da) : Math.atan2(-sd.wx, sd.wz);
  const yaw = turnTo(from, Math.atan2(dest[0] - ox, -(dest[1] - oz)), smooth(Math.min(1, v / 0.5)));
  return { x: ox + (dest[0] - ox) * o, z: oz + (dest[1] - oz) * o, lift: L * (1 - v) + HOP * 1.4 * h, yaw, hop: v < 1 ? h : 0, lookUp: 0 };
}

// the square you came from, kept as you go: call with your square every frame
export function cameFrom(track, hero) {
  if (!track.cur || track.cur.x !== hero.x || track.cur.y !== hero.y) {
    if (track.cur) { track.x = track.cur.x; track.y = track.cur.y; }
    track.cur = { x: hero.x, y: hero.y };
  }
  return track;
}

// at a fountain (drinking from it, dipping something in: minifig-anim.js FOUNT): when the water's broken, s
// in, and how ([s, how many studs pop up, how hard]); where, out in front of you (squares), and down from your feet
export const FOUNT_SPLASH = { drink: [[0.55, 6, 1.2]], dip: [[0.5, 9, 1.7], [0.95, 4, 1.0], [1.35, 6, 1.3]] };
export const FOUNT_REACH = 0.3, FOUNT_DOWN = 0.06;

// ---- out of a fountain (a monster made out of it: water moccasins pouring forth): up out of its water on the
// side it's going, over the rim, and down off it onto its own square. f: the fountain's square, to: the
// monster's, u: 0..1 through it. Where it is (squares, as a square's corner: drawn at + 0.5), how high its
// foot is (y, over the floor's studs), and which way it goes (the game's yaw)
export const RISE_T = 1.7; // s
export function risePath(f, to, u, r = 0.22) { // (r: how far it lies out from the basin's side, its middle: a snake's, half its length)
  const rest = againstFountain(f, to[0], to[1], r); // (where it'll lie: against the basin's side, if its square's up against it)
  if (rest) to = [rest.x, rest.z];
  const dx = to[0] - f[0], dz = to[1] - f[1], n = Math.hypot(dx, dz) || 1, ux = dx / n, uz = dz / n;
  const pr = PERCHES.fountain, rim = pr.H, water = pr.H - 0.12;
  const at = (r) => [f[0] + ux * r, f[1] + uz * r], yaw = Math.atan2(ux, -uz);
  if (u < 0.35) { // (up out of the water, in the basin)
    const k = smooth(u / 0.35), [x, z] = at(0.45);
    return { x, z, y: water - 0.25 + 0.3 * k, yaw };
  }
  if (u < 0.6) { // (along to the rim and over it)
    const k = smooth((u - 0.35) / 0.25), [x, z] = at(0.45 + (pr.R + 0.1 - 0.45) * k);
    return { x, z, y: water + 0.05 + (rim - water - 0.05) * k, yaw };
  }
  const k = (u - 0.6) / 0.4, [x0, z0] = at(pr.R + 0.1); // (and down off it, to its own square)
  const e = smooth(k);
  return { x: x0 + (to[0] - x0) * e, z: z0 + (to[1] - z0) * e, y: rim * (1 - k) * (1 - k) + 0.12 * Math.sin(Math.PI * k), yaw,
    lean: rest ? smooth(Math.max(0, (k - 0.6) / 0.4)) : 0, leanYaw: rest ? rest.yaw : yaw }; // (turning to lean on it, as it lands)
}

// ---- beside a fountain: a creature on a square up against its basin (wider than its square) kept out of its
// wall: pushed out to rest against its side (r: how far it reaches from its middle), facing out into the room,
// leaning back against it (its back end propped up the basin's side). f: the fountain's square; [x, z]: where
// it'd be (squares, a square's corner). {x, z, yaw (the game's: facing away from the fountain)}, or null if it's
// clear of it
export function againstFountain(f, x, z, r = 0.22) {
  const dx = x - f[0], dz = z - f[1], d = Math.hypot(dx, dz), out = PERCHES.fountain.OUT + r;
  if (d >= out || d < 1e-3) return null;
  return { x: f[0] + (dx / d) * out, z: f[1] + (dz / d) * out, yaw: Math.atan2(dx, -dz) };
}

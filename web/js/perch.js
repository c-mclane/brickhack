// Standing at a statue: a statue's square (the brick dungeon) is all plinth, so
// whoever walks onto it hops up onto one of the four scroll corbels round its
// column (the one on the side they came from) and stands there on the ledge,
// gazing up at the statue (its model: items.json "statue"); stepping off, they
// go round the ledge to the corbel on the side they're leaving by and jump down
// from there. Shared by the game
// (main.js) and the test dungeon (testbed.js).
//
// Units: squares, the game's yaw (0 looks north, -Z).

import { STUD_H } from './brick.js';

const PERCH_R = 52 / 80, PERCH_H = 24 / 80; // (the ledge: out from the column, up from the statue's foot)
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
const statueAt = (drops, x, y) => (drops || []).find((d) => d.x === x && d.z === y && d.name === 'statue');

// where you stand, off where you'd be (pos): hero {x, y} (your square), track (cameFrom: the
// square you came from, and the side you're perched on), pos [x, z] (where you are, walking),
// drops (brickworld's floor items, world.brickDrops). {k (0..1: how much the statue has you;
// past 0.5 you face as it says), dx, dz, lift, yaw, hop (0..1: in the air), lookUp (0..1)}, or null.
//   onto it: a hop up onto the ledge on the side you came from, then gazing up at it;
//   off it: along the ledge to the corbel on the side you're leaving by, and a jump down from there
export function perchSpot(hero, track, pos, drops) {
  const L = STUD_H + PERCH_H;
  if (statueAt(drops, hero.x, hero.y)) {
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
export function hopOn(from, sd, u) {
  u = Math.min(1, u);
  const e = smooth(Math.max(0, (u - 0.3) / 0.7)), tx = sd.wx * PERCH_R, tz = sd.wz * PERCH_R, h = Math.sin(Math.PI * u);
  return { x: from[0] + (tx - from[0]) * e, z: from[1] + (tz - from[1]) * e, lift: (STUD_H + PERCH_H) * smooth(Math.min(1, u / 0.45)) + HOP * h,
    yaw: Math.atan2(-sd.wx, sd.wz), hop: u < 1 ? h : 0, lookUp: smooth(u) };
}
// how far the statue's foot reaches out from its middle (its scroll corbels): squares
export const STATUE_OUT = 60 / 80;
// on the ledge: standing there, gazing up
export const perched = (sd) => ({ x: sd.wx * PERCH_R, z: sd.wz * PERCH_R, lift: STUD_H + PERCH_H, yaw: Math.atan2(-sd.wx, sd.wz), hop: 0, lookUp: 1 });
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
export function hopOff(sd, out, dest, t) {
  const L = STUD_H + PERCH_H, da = turnOf(sd, out), swing = (Math.abs(da) / (Math.PI / 2)) * SWING_Q;
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

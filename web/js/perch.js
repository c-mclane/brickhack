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

const PERCH_R = 52 / 80, PERCH_H = 48 / 80; // (the ledge: out from the column, up from the statue's foot)
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
    const v = smooth(u / 0.3);
    ax = (p.wx + (out.wx - p.wx) * v) * PERCH_R; az = (p.wz + (out.wz - p.wz) * v) * PERCH_R;
    const n = Math.hypot(ax, az) || 1; ax *= PERCH_R / n; az *= PERCH_R / n; // (round the ledge, not across the statue)
    lift = L;
  } else { // ...then off, in a jump, down onto the square you're stepping to
    const v = (u - 0.3) / 0.7;
    ax = out.wx * PERCH_R + (ex - out.wx * PERCH_R) * v; az = out.wz * PERCH_R + (ez - out.wz * PERCH_R) * v;
    hop = Math.sin(Math.PI * v);
    lift = L * (1 - v) + HOP * 1.4 * hop;
  }
  return { k: 1, dx: p.x + ax - pos[0], dz: p.y + az - pos[1], lift, yaw, hop, lookUp: 0 };
}

// the square you came from, kept as you go: call with your square every frame
export function cameFrom(track, hero) {
  if (!track.cur || track.cur.x !== hero.x || track.cur.y !== hero.y) {
    if (track.cur) { track.x = track.cur.x; track.y = track.cur.y; }
    track.cur = { x: hero.x, y: hero.y };
  }
  return track;
}

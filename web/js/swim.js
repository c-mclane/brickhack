// Falling into water and crawling out (the engine's drown(): winweb.c web_swim). A stumble from the
// square you stepped from into the pool, a splash, and down you go, arms flung up, sunk to the chest;
// then (if you crawl out) up to the edge of the dry square you're making for, reaching for it, and a
// haul up over it onto your feet, dripping. Shared by the game (main.js) and the test dungeon
// (testbed.js).
//
// Units: squares (the corner of square x, z is x, z: the hero drawn at x + 0.5), seconds, the game's
// yaw (0 looks north, -Z).

export const FALL_T = 0.9, CRAWL_T = 1.1;
export const DEEP = 0.75; // (how far you go under: to the chest)
const STEP = 0.35; // (of the fall: the stumble in, before you drop)
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const lerp = (a, b, k) => a + (b - a) * k;
const yawTo = (a, b) => (a[0] === b[0] && a[1] === b[1] ? null : Math.atan2(b[0] - a[0], -(b[1] - a[1])));

// s: {from: [x, z] (where you stepped in from), pool: [x, z], to: [x, z] (where you crawl out to) or
// null}; t: seconds since you fell. Where you are and how: {x, z, y (up from the floor: under it, in the
// water), yaw (or null: as you were), hop, reach, lean (FigureAnimator's)}, or null once it's over
export function swimPose(s, t) {
  if (t < FALL_T) {
    const u = t / FALL_T;
    if (u < STEP) { // stumbling in: a lurch forward, off balance
      const k = u / STEP, e = smooth(k);
      return { x: lerp(s.from[0], s.pool[0], e), z: lerp(s.from[1], s.pool[1], e), y: 0.1 * Math.sin(Math.PI * k), yaw: yawTo(s.from, s.pool),
        hop: Math.sin(Math.PI * k) * 0.6, reach: 0, lean: 0.35 * k };
    }
    const k = (u - STEP) / (1 - STEP); // ...and down, arms flung up, bobbing back a little as you settle
    return { x: s.pool[0], z: s.pool[1], y: -DEEP * (1 - (1 - k) ** 2) + 0.08 * Math.sin(k * Math.PI * 2.5) * (1 - k), yaw: yawTo(s.from, s.pool),
      hop: 0.9, reach: 0, lean: 0.35 * (1 - k) };
  }
  if (!s.to) return null;
  const v = (t - FALL_T) / CRAWL_T;
  if (v >= 1) return null;
  const edge = [lerp(s.pool[0], s.to[0], 0.42), lerp(s.pool[1], s.to[1], 0.42)], yaw = yawTo(s.pool, s.to);
  if (v < 0.4) { // up to the edge, reaching for it
    const k = smooth(v / 0.4);
    return { x: lerp(s.pool[0], edge[0], k), z: lerp(s.pool[1], edge[1], k), y: lerp(-DEEP, -0.35, k), yaw, hop: 0.9 * (1 - k), reach: k, lean: 0.55 * k };
  }
  const k = (v - 0.4) / 0.6, e = smooth(k); // ...and hauled up over it, onto your feet
  return { x: lerp(edge[0], s.to[0], e), z: lerp(edge[1], s.to[1], e), y: lerp(-0.35, 0, smooth(Math.min(1, k * 1.4))) + 0.12 * Math.sin(Math.PI * k),
    yaw, hop: 0, reach: 1 - e, lean: 0.55 * (1 - e) };
}

// when the water's broken, and how: [s in, where ('pool': its middle; 'edge': where you haul out; 'you':
// dripping off you), how many studs, how hard]
export const SWIM_SPLASH = [[FALL_T * STEP, 'pool', 16, 2.4], [FALL_T + CRAWL_T * 0.4, 'edge', 7, 1.2],
  [FALL_T + CRAWL_T * 0.6, 'you', 3, 0.4], [FALL_T + CRAWL_T * 0.8, 'you', 3, 0.3]];
export const WATER_Y = -0.03; // (the heap's surface, up from the floor)

// Sprite animation for creatures: the sprites are single pictures, so they
// come alive with motion — waddling, hopping, flapping, spinning, swaying —
// and turn to face the way they're going.  Every monster gets a style
// (Peanut Plains enemies their own, everyone else waddles).
import { posAt } from './motion.js';

const STYLES = {
  'bronto burt': 'flap', 'bat': 'flap', 'giant bat': 'flap', 'cherub': 'flap',
  'poppy bros. jr.': 'hop', 'grizzo': 'hop',
  'gordo': 'spin',
  'lovely': 'sway', 'parasol waddle dee': 'sway',
  'kabu': 'slide',
  'broom hatter': 'sweep',
};

// which way the sprites face (art/monsters, Kirby Super Star Ultra); others look left
const FACES_RIGHT = new Set(['waddle doo', 'grizzo', 'sir kibble']);
const FACES_FRONT = new Set(['chef kawasaki', 'kabu', 'lovely', 'gordo']);

// -> {tilt (radians), sx, sy (scale), dy (lift), flip}
export function mobAnim(m, now, camYaw) {
  const [, , k] = posAt(m, now);
  const moving = m.dur > 0 && k < 1;
  const t = now / 1000 + (m.id || 0) * 0.37; // each one on its own beat
  // face the way it's going: flip when the sprite looks the other way
  const name = (m.name || '').toLowerCase();
  const dx = m.tx - m.fx, dz = m.tz - m.fz;
  if (moving && Math.hypot(dx, dz) > 0.01) {
    const right = dx * Math.cos(camYaw) + dz * Math.sin(camYaw);
    if (Math.abs(right) > 0.05) m.face = right > 0;
  }
  const flip = FACES_FRONT.has(name) ? false : !!m.face !== FACES_RIGHT.has(name);
  const a = { tilt: 0, sx: 1, sy: 1, dy: 0, flip };
  const s = Math.sin, c = Math.abs;
  switch (STYLES[name] || 'waddle') {
    case 'flap':
      a.dy = 0.12 * s(t * 5);
      a.sx = 1 - 0.14 * c(s(t * 14)); // wings beating
      a.sy = 1 + 0.05 * c(s(t * 14));
      break;
    case 'hop': {
      const h = moving ? c(s(t * 9)) : Math.max(0, s(t * 2.2)) ** 8; // hops along; now and then a hop on the spot
      a.dy = h * (moving ? 0.55 : 0.3);
      a.sy = 1 + 0.12 * h - (h < 0.15 ? 0.12 : 0); // stretch in the air, squash on landing
      a.sx = 2 - a.sy;
      break;
    }
    case 'spin':
      a.tilt = t * 1.6;
      a.sx = a.sy = 1 + 0.06 * s(t * 6);
      break;
    case 'sway':
      a.tilt = 0.13 * s(t * 2);
      a.dy = 0.05 * c(s(t * 2));
      break;
    case 'slide':
      a.tilt = moving ? (m.face ? -0.08 : 0.08) : 0;
      break;
    case 'sweep':
      a.tilt = moving ? 0.12 * s(t * 18) : 0.04 * s(t * 3);
      a.sy = 1 + 0.03 * s(t * 3);
      break;
    default: // waddle
      if (moving) {
        a.tilt = 0.16 * s(t * 12);
        a.dy = 0.09 * c(s(t * 12));
        a.sy = 1 - 0.06 * c(s(t * 12));
        a.sx = 2 - a.sy;
      } else {
        a.sy = 1 + 0.035 * s(t * 3); // breathing
        a.sx = 1 - 0.02 * s(t * 3);
      }
  }
  return a;
}

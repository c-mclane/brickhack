// Sprite animation for creatures: the sprites are single pictures, so they
// come alive with motion — waddling, hopping, flapping, spinning, swaying —
// and turn to face the way they're going.  Every monster gets a style
// (bats flap; everyone else waddles).
import { posAt } from './motion.js';

const STYLES = { 'bat': 'flap', 'giant bat': 'flap' };

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
  const flip = !!m.face; // (the sprites look left)
  const a = { tilt: 0, sx: 1, sy: 1, dy: 0, flip };
  const s = Math.sin, c = Math.abs;
  switch (STYLES[name] || 'waddle') {
    case 'flap':
      a.dy = 0.12 * s(t * 5);
      a.sx = 1 - 0.14 * c(s(t * 14)); // wings beating
      a.sy = 1 + 0.05 * c(s(t * 14));
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

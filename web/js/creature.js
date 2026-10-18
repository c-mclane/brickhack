// Monsters in brick that aren't minifigs (monsters.json "creature"): no
// joints, so the whole model moves. A snake (the cobra, the nagas, the acid
// worm): at rest it sways, weaving its raised head; moving, it slithers,
// wiggling side to side; when it strikes or spits (a lunge), it rears back and
// darts forward, and settles. A bug (the spitting beetle): bobbing, twitching,
// scuttling; it rears its front to spit. A blob (Juiblex): quivering, squashing
// and swelling; it swells up and lurches forward to spit. A beast (a dog, a cat, a horse):
// breathing and looking about, trotting with a bob and a rock; it draws back and springs in to bite.
//
// creatureLocal: the model's own motion this moment, as a column-major 4x4 in
// the model's units (studs, Y up, its head toward +Z), for its placement matrix
// to be multiplied by.

export const LUNGE_TIME = 0.6; // s

const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
const move = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const about = (p, m) => mul(move(p[0], p[1], p[2]), mul(m, move(-p[0], -p[1], -p[2])));
const ease = (u) => u * u * (3 - 2 * u);

// t: seconds (its own clock); moving: slithering along; lungeT: when it last struck (seconds, its clock)
export function creatureLocal(kind, t, { moving = false, lungeT = -1e9 } = {}) {
  const k = (t - lungeT) / LUNGE_TIME, striking = k >= 0 && k < 1;
  if (kind === 'bug') { // (a beetle: bobbing and twitching at rest, scuttling quick; to spit, it rears its front up and snaps down)
    let m = moving ? mul(move(0, Math.abs(Math.sin(t * 22)) * 0.06, 0), rotY(Math.sin(t * 17) * 0.1))
      : mul(move(0, Math.max(0, Math.sin(t * 5)) * 0.03, 0), rotY(Math.round(Math.sin(t * 0.8) * 2) * 0.12));
    if (striking) {
      const up = k < 0.45 ? ease(k / 0.45) : 1 - ease((k - 0.45) / 0.55);
      m = mul(m, about([0, 0, -0.8], rotX(-0.45 * up)));
    }
    return m;
  }
  if (kind === 'blob') { // (Juiblex: a quivering mass, squashing and swelling; to spit it swells up and lurches forward)
    let sy = 1 + Math.sin(t * 2.3) * 0.05 + Math.sin(t * 5.1) * 0.02, sx = 1 / Math.sqrt(sy), z = 0;
    if (moving) { sy *= 1 + Math.sin(t * 8) * 0.08; sx = 1 / Math.sqrt(sy); }
    if (striking) {
      const swell = k < 0.5 ? ease(k / 0.5) : 1 - ease((k - 0.5) / 0.5), spurt = k < 0.5 ? 0 : Math.sin(Math.PI * (k - 0.5) / 0.5);
      sy *= 1 + 0.18 * swell - 0.15 * spurt; sx *= 1 + 0.1 * swell + 0.08 * spurt; z = 0.4 * spurt;
    }
    return mul(move(0, 0, z), [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sx, 0, 0, 0, 0, 1]);
  }
  if (kind === 'beast') { // (a dog, a cat, a horse: breathing at rest, now and then a look round; trotting, bobbing and
    // rocking nose to tail; to bite or kick, it draws back on its haunches and springs in, nose down, and settles)
    let m = moving ? mul(move(0, Math.abs(Math.sin(t * 9)) * 0.14, 0), about([0, 0.6, 0], rotX(Math.sin(t * 9) * 0.06)))
      : mul([1, 0, 0, 0, 0, 1 + Math.sin(t * 2.6) * 0.012, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], rotY(Math.sin(t * 0.37) * 0.09 + Math.sin(t * 0.9) * 0.03));
    if (striking) {
      const back = k < 0.35 ? ease(k / 0.35) : k < 0.5 ? 1 - ease((k - 0.35) / 0.15) : 0;
      const dart = k < 0.35 ? 0 : k < 0.5 ? ease((k - 0.35) / 0.15) : 1 - ease((k - 0.5) / 0.5);
      m = mul(m, mul(move(0, 0.25 * dart, -0.45 * back + 0.8 * dart), rotX(-0.18 * back + 0.14 * dart)));
    }
    return m;
  }
  if (kind !== 'snake') return move(0, 0, 0);
  const TAIL = [0, 0, -3.6]; // (where it pivots, rearing: its coils, behind the raised neck)
  // swaying (a cobra's weave), or slithering: a quick wiggle side to side, a little sideways shift
  let m = moving ? mul(move(Math.sin(t * 9 + 1.6) * 0.18, 0, 0), rotY(Math.sin(t * 9) * 0.26))
    : rotY(Math.sin(t * 1.3) * 0.12 + Math.sin(t * 0.47) * 0.06);
  // the strike: rear back (head up, drawn back), then dart forward and down, then settle
  if (striking) {
    const back = k < 0.4 ? ease(k / 0.4) : k < 0.55 ? 1 - ease((k - 0.4) / 0.15) : 0;
    const dart = k < 0.4 ? 0 : k < 0.55 ? ease((k - 0.4) / 0.15) : 1 - ease((k - 0.55) / 0.45);
    m = mul(m, mul(move(0, 0, -0.5 * back + 0.9 * dart), about(TAIL, rotX(-0.28 * back + 0.22 * dart))));
  } else if (!moving) { // (at rest: breathing, the head bobbing a little)
    m = mul(m, about(TAIL, rotX(Math.sin(t * 2.1) * 0.03)));
  }
  return m;
}

// A minifig monster with a serpent's tail for legs (a naga, monsters.json "slither"): the whole
// figure weaving gently on its coils at rest, swaying side to side as it slithers along; and as
// it spits, a sway back and a lunge in (its body leans: FigureAnimator lean). In the figure's
// units, about its middle.
export function slitherLocal(t, { moving = false, lungeT = -1e9 } = {}) {
  let m = moving ? mul(move(Math.sin(t * 7 + 1.6) * 0.25, 0, 0), rotY(Math.sin(t * 7) * 0.2))
    : mul(move(Math.sin(t * 1.1) * 0.08, Math.sin(t * 2.2) * 0.03, 0), rotY(Math.sin(t * 1.1) * 0.08));
  const k = (t - lungeT) / LUNGE_TIME;
  if (k >= 0 && k < 1) m = mul(m, move(0, 0, -0.4 * Math.sin(Math.PI * Math.min(1, k / 0.4)) * (k < 0.4 ? 1 : 0) + 0.7 * (k < 0.4 ? 0 : Math.sin(Math.PI * (k - 0.4) / 0.6))));
  return m;
}

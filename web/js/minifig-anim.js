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

// at a fountain (on its rim, facing its water): drinking, a cupped handful brought up to the mouth;
// dipping, what's in the right hand plunged in and swished about. Keyframes [s, value] for each of:
// the bend at the waist (radians), the arms' swing (degrees: null, where they'd be anyway; "R" with the
// right), turned in toward each other (degrees), and the head tipped back (radians)
// a shiver: keyframes about `base`, jerking `amp` either way every few hundredths of a second, dying away
function SHIVER(base, amp, T = 2.0) {
  const k = [[0, 0], [0.25, base]];
  for (let t = 0.31, i = 0; t < 1.6; t += 0.06, i++) k.push([t, base + (i % 2 ? amp : -amp) * (1 - (t - 0.25) / 1.6)]);
  return k.concat([[1.6, base], [T, 0]]);
}
export const LOOSE_AT = 1.8; // (the arrow away: FOUNT.loose, so many seconds in)
export const NOCKED = [0.45, LOOSE_AT]; // (an arrow in the string hand, seen: FOUNT.loose, from the bow's coming up to its loosing)
export const NOCK = [0.8, 1.15]; // (...brought onto the bow's own arrow (brickworld holdItems hold.nockK): then aimed)
export const nockAt = (t) => { const u = Math.max(0, Math.min(1, (t - NOCK[0]) / (NOCK[1] - NOCK[0]))); return u * u * (3 - 2 * u); };
export const FOUNT = {
  drink: { T: 2.6, cup: 0.6, sip: [1.15, 1.9],
    lean: [[0, 0], [0.4, 0.8], [0.75, 0.8], [1.15, 0.05], [2.2, 0.05], [2.6, 0]],
    armR: [[0, null], [0.4, -12], [0.6, 4], [0.78, 4], [1.15, -140], [1.9, -146], [2.3, -20], [2.6, null]],
    armL: 'R', inn: [[0, 0], [0.4, -14], [1.15, -16], [1.9, -16], [2.3, 0]],
    head: [[0, 0], [1.1, 0], [1.4, 0.45], [1.9, 0.45], [2.2, 0]] },
  dip: { T: 2.1, cup: 0.55, out: 1.4,
    lean: [[0, 0], [0.4, 0.8], [1.55, 0.8], [2.0, 0]],
    armR: [[0, null], [0.4, -28], [0.55, 6], [0.75, 14], [0.95, 2], [1.15, 14], [1.4, -40], [1.65, -40], [2.1, null]],
    armL: [[0, null], [0.4, 8], [1.55, 8], [2.0, null]], inn: [[0, 0]],
    head: [[0, 0], [0.4, -0.25], [1.4, -0.25], [1.7, 0]] },
  // foul water: both hands braced on the rim, doubled over the water, heaving into it again and again, the
  // head jerking up with each heave
  retch: { T: 2.9,
    lean: [[0, 0], [0.3, 0.95], [0.5, 1.4], [0.65, 1.0], [0.82, 1.45], [0.97, 1.0], [1.15, 1.5], [1.32, 1.05], [1.5, 1.35], [2.0, 1.1], [2.5, 0.2], [2.9, 0]],
    armR: [[0, null], [0.3, -62], [2.0, -62], [2.5, -15], [2.9, null]], armL: 'R',
    inn: [[0, 0], [0.3, 18], [2.0, 18], [2.5, 0]],
    head: [[0, 0], [0.3, -0.2], [0.5, 0.3], [0.65, -0.25], [0.82, 0.3], [0.97, -0.25], [1.15, 0.35], [1.32, -0.2], [1.5, 0.2], [2.0, -0.1], [2.5, 0]] },
  // a strange tingling, a sudden chill: arms hugged about you, hunched, shivering hard and then less (SHIVER)
  shiver: { T: 2.0, lean: SHIVER(0.18, 0.07), armR: [[0, null], [0.25, -48], [1.6, -48], [2.0, null]], armL: 'R',
    inn: [[0, 0], [0.25, -62], [1.6, -62], [2.0, 0]], head: SHIVER(-0.12, 0.06) },
  // at a sink (stood before it, its basin up at your shoulders): a sip, hands cupped under the tap and up to the
  // mouth; snatched back from it, scalded, arms flung out; a reach down into its bowl (a ring found in it: in
  // hand, coming up: cup); doubled over it, retching (sewage); and a kick at it, the right leg swung up hard
  sip: { T: 2.4, cup: 0.6, sip: [1.3, 1.9],
    lean: [[0, 0], [0.4, 0.15], [0.9, 0.15], [1.3, 0], [2.4, 0]],
    armR: [[0, null], [0.4, -95], [0.9, -95], [1.3, -150], [1.9, -150], [2.4, null]], armL: 'R',
    inn: [[0, 0], [0.4, -18], [1.9, -18], [2.4, 0]],
    head: [[0, 0], [1.2, 0], [1.45, 0.4], [1.9, 0.4], [2.2, 0]] },
  scald: { T: 1.3,
    lean: [[0, 0], [0.15, -0.35], [0.6, -0.25], [1.3, 0]],
    armR: [[0, null], [0.15, -60], [0.5, -40], [1.3, null]], armL: 'R',
    inn: [[0, 0], [0.15, 45], [0.8, 30], [1.3, 0]],
    head: [[0, 0], [0.15, 0.3], [0.45, -0.2], [0.75, 0.2], [1.05, -0.1], [1.3, 0]] },
  reach: { T: 1.9, cup: 0.9,
    lean: [[0, 0], [0.4, 0.35], [1.2, 0.35], [1.6, 0], [1.9, 0]],
    armR: [[0, null], [0.4, -105], [0.7, -85], [1.0, -105], [1.4, -60], [1.9, null]],
    armL: [[0, null], [0.4, -75], [1.4, -75], [1.9, null]], inn: [[0, 0]],
    head: [[0, 0], [0.4, -0.3], [1.3, -0.3], [1.6, 0]] },
  kick: { T: 0.9, lean: [[0, 0], [0.2, -0.15], [0.35, 0.1], [0.9, 0]],
    armR: [[0, null], [0.2, 30], [0.4, -30], [0.9, null]], armL: [[0, null], [0.2, -30], [0.4, 30], [0.9, null]], inn: [[0, 0]],
    head: [[0, 0]], legR: [[0, 0], [0.2, 25], [0.38, -70], [0.55, -60], [0.9, 0]] },
  // at a toilet (stood before it, its bowl at your hips): bent right down over it, hands braced on its rim, lapping
  // at its water with little dips of the head; and doubled over it, retching into it (sewage)
  gulp: { T: 2.8,
    lean: [[0, 0], [0.5, 1.15], [2.1, 1.15], [2.8, 0]],
    armR: [[0, null], [0.45, -42], [2.2, -42], [2.8, null]], armL: 'R',
    inn: [[0, 0], [0.45, 22], [2.2, 22], [2.8, 0]],
    head: [[0, 0], [0.5, -0.3], [0.75, -0.12], [0.95, -0.3], [1.15, -0.12], [1.35, -0.3], [1.55, -0.12], [1.75, -0.3], [2.2, -0.2], [2.6, 0]] },
  // sat on a toilet (where: perch.js sitPath): turned round, sat down, legs out before you, hands on the knees; a
  // strain, hunched, shaking ("You grunt."); and up again
  sit: { T: 5.6,
    lean: [[0, 0], [0.6, 0], [1.2, 0.08], [2.0, 0.08], [2.3, 0.3], [3.3, 0.3], [3.6, 0.08], [4.2, 0.08], [4.6, 0.25], [5.0, 0], [5.6, 0]],
    legR: [[0, 0], [0.6, 0], [1.2, -88], [4.2, -88], [4.8, 0], [5.6, 0]], legL: 'R',
    armR: [[0, null], [0.6, null], [1.2, -50], [2.3, -62], [3.3, -62], [3.6, -50], [4.2, -50], [4.8, null], [5.6, null]], armL: 'R',
    inn: [[0, 0], [1.2, 10], [4.2, 10], [4.8, 0]],
    head: [[0, 0], [2.0, 0], [2.3, -0.25], [3.3, -0.25], [3.6, 0], [5.6, 0]] },
  // praying (#pray): down on your knees (legs back, the body dropped to them: drop), arms raised to the heavens,
  // palms out, gazing up into the light; held there while it shines; and up again
  prayer: { T: 8.0,
    lean: [[0, 0], [0.7, 0.25], [1.3, -0.12], [6.6, -0.12], [7.3, 0.1], [8.0, 0]],
    legR: [[0, 0], [0.7, 72], [7.2, 72], [7.9, 0]], legL: 'R',
    drop: [[0, 0], [0.7, 0.21], [7.2, 0.21], [7.9, 0]],
    armR: [[0, null], [0.7, -15], [1.6, -168], [6.6, -168], [7.3, -40], [8.0, null]], armL: 'R',
    inn: [[0, 0], [0.7, 0], [1.6, 38], [6.6, 38], [7.3, 0]],
    head: [[0, 0], [0.7, -0.35], [1.6, 0.5], [6.6, 0.5], [7.3, -0.1], [8.0, 0]] },
  // what comes of a prayer, taken: struck (by lightning, a voice, a beam): thrown back, arms flung out, then
  // hunched, shaken; brought low (displeased, cursed): slumped, arms hanging, head bowed
  smitten: { T: 2.6,
    lean: [[0, 0], [0.12, -0.55], [0.7, -0.3], [1.4, 0.35], [2.6, 0]],
    armR: [[0, null], [0.12, -120], [0.7, -90], [1.4, -20], [2.6, null]], armL: 'R',
    inn: [[0, 0], [0.12, 55], [0.7, 40], [1.4, 0]],
    head: [[0, 0], [0.12, 0.45], [0.7, 0.2], [1.4, -0.3], [2.6, 0]], hop: [[0, 0], [0.12, 1], [0.5, 0]] },
  slump: { T: 3.0,
    lean: [[0, 0], [0.6, 0.5], [2.4, 0.5], [3.0, 0]],
    armR: [[0, null], [0.6, 12], [2.4, 12], [3.0, null]], armL: 'R',
    inn: [[0, 0], [0.6, -8], [2.4, -8], [3.0, 0]],
    head: [[0, 0], [0.6, -0.45], [2.4, -0.45], [3.0, 0]] },
  // praying to the Porcelain God: bowed over it, arms raised up before you, palms to it
  pray: { T: 3.6,
    lean: [[0, 0], [0.5, 0.45], [3.0, 0.45], [3.6, 0]],
    armR: [[0, null], [0.5, -150], [3.0, -150], [3.6, null]], armL: 'R',
    inn: [[0, 0], [0.5, -25], [3.0, -25], [3.6, 0]],
    head: [[0, 0], [0.5, -0.35], [3.0, -0.35], [3.6, 0]] },
  // the Mass (#mass, at his altar), the priest's part, from its start: the chalice set down on its stud; a wait
  // while the altar's angels come down; the wafer taken up off its tile, raised high in both hands, gazed up at
  // (the elevation), a genuflection (the right knee down), the wafer laid back; the chalice taken up, raised, a
  // genuflection; it set down; the wafer taken and eaten, the chalice taken and drunk from, set down; a bow.
  // (what's in the hand and when: testbed.js MASS_HOLD; where the wafer and chalice stand meanwhile, MASS_PROPS)
  massPriest: { T: 28.0,
    lean: [[0, 0], [0.4, 0.2], [1.1, 0.2], [1.6, 0], [4.8, 0], [5.3, 0.22], [5.9, 0.22], [6.6, 0], [6.9, -0.08], [9.3, -0.08], [9.9, 0],
      [11.4, 0], [11.8, 0.22], [12.4, 0.22], [12.6, 0.22], [13.2, 0.22], [13.6, 0], [13.8, -0.08], [16.0, -0.08], [16.6, 0],
      [18.4, 0], [18.8, 0.22], [19.2, 0.22], [19.8, 0.22], [20.2, 0.1], [21.8, 0], [22.4, 0.22], [23.0, 0.1], [24.8, 0.1], [25.2, 0.22],
      [25.6, 0.22], [26.0, 0.4], [27.2, 0.4], [28.0, 0]],
    armR: [[0, -100], [0.4, -84], [1.1, -84], [1.6, null], [4.8, null], [5.3, -80], [5.9, -80], [6.6, -100], [7.3, -122], [9.3, -122], [9.9, -100],
      [11.4, -100], [11.8, -82], [12.4, -82], [12.6, -80], [13.2, -80], [13.6, -100], [14.2, -122], [16.0, -122], [16.6, -100],
      [18.4, -100], [18.8, -82], [19.2, -82], [19.8, -80], [20.2, -100], [20.8, -118], [21.6, -118], [21.9, -80], [22.4, -80],
      [23.0, -100], [23.6, -132], [24.6, -132], [24.9, -100], [25.2, -82], [25.6, -82], [26.0, null], [28.0, null]],
    armL: [[0, null], [6.6, null], [7.3, -122], [9.3, -122], [9.9, null], [13.6, null], [14.2, -122], [16.0, -122], [16.6, null], [28.0, null]],
    inn: [[0, 0], [0.4, -12], [1.1, -12], [1.6, 0], [6.6, 0], [7.3, 20], [9.3, 20], [9.9, 0], [13.6, 0], [14.2, 20], [16.0, 20], [16.6, 0],
      [20.2, 0], [20.8, 28], [21.6, 28], [21.9, 0], [23.0, 0], [23.6, 26], [24.6, 26], [24.9, 0], [28.0, 0]],
    legR: [[0, 0], [10.0, 0], [10.5, 78], [11.0, 78], [11.4, 0], [16.6, 0], [17.1, 78], [17.6, 78], [18.0, 0], [28.0, 0]], legL: [[0, 0], [28.0, 0]],
    drop: [[0, 0], [10.0, 0], [10.5, 0.12], [11.0, 0.12], [11.4, 0], [16.6, 0], [17.1, 0.12], [17.6, 0.12], [18.0, 0], [28.0, 0]],
    head: [[0, 0], [0.4, -0.3], [1.1, -0.3], [1.6, -0.15], [4.8, -0.15], [5.3, -0.35], [6.6, -0.1], [7.3, 0.45], [9.3, 0.45], [9.9, 0],
      [10.5, -0.35], [11.4, -0.1], [11.8, -0.35], [13.6, -0.1], [14.2, 0.45], [16.0, 0.45], [16.6, 0], [17.1, -0.35], [18.0, -0.1],
      [18.8, -0.35], [20.2, -0.1], [20.8, -0.05], [21.6, -0.05], [22.4, -0.35], [23.6, 0.35], [24.6, 0.35], [25.2, -0.3], [26.0, -0.4],
      [27.2, -0.4], [28.0, 0]] },
  // Communion (#communion): down on both knees on the altar's step, hands joined, head bowed; the head lifted to
  // receive the wafer (it floats to you: testbed.js), bowed again a while, and up
  communion: { T: 7.6,
    lean: [[0, 0], [0.7, 0.1], [2.6, 0.1], [3.0, -0.05], [3.8, -0.05], [4.2, 0.15], [6.6, 0.15], [7.4, 0]],
    legR: [[0, 0], [0.7, 72], [6.7, 72], [7.4, 0]], legL: 'R',
    drop: [[0, 0], [0.7, 0.21], [6.7, 0.21], [7.4, 0]],
    armR: [[0, null], [0.7, -40], [6.6, -40], [7.4, null]], armL: 'R',
    inn: [[0, 0], [0.7, 34], [6.6, 34], [7.4, 0]],
    head: [[0, 0], [0.7, -0.3], [2.6, -0.3], [3.0, 0.3], [3.8, 0.3], [4.2, -0.4], [6.6, -0.4], [7.4, 0]] },
  // confession (#confess): on both knees, bowed low, hands joined at the brow, a while; and up
  confess: { T: 8.0,
    lean: [[0, 0], [0.8, 0.35], [7.0, 0.35], [7.8, 0]],
    legR: [[0, 0], [0.7, 72], [7.1, 72], [7.8, 0]], legL: 'R',
    drop: [[0, 0], [0.7, 0.21], [7.1, 0.21], [7.8, 0]],
    armR: [[0, null], [0.8, -78], [7.0, -78], [7.8, null]], armL: 'R',
    inn: [[0, 0], [0.8, 36], [7.0, 36], [7.8, 0]],
    head: [[0, 0], [0.8, -0.5], [7.0, -0.5], [7.8, 0]] },
  // alms (#alms): the right hand out over the offering plate (to the right, on the altar), tipped, the coins let go
  // a few at a time; and back
  alms: { T: 3.4,
    lean: [[0, 0], [0.6, 0.25], [2.7, 0.25], [3.4, 0]],
    armR: [[0, null], [0.6, -78], [1.0, -70], [1.4, -78], [1.8, -70], [2.2, -78], [2.7, -78], [3.4, null]], armL: [[0, null], [3.4, null]],
    inn: [[0, 0], [0.6, -24], [2.7, -24], [3.4, 0]],
    head: [[0, 0], [0.6, -0.35], [2.7, -0.35], [3.4, 0]] },
  // a corpse offered at his altar (#offer): held up to it in both hands, a wait; refused, lowered, the head bowed
  offerUp: { T: 4.6,
    lean: [[0, 0], [0.7, 0.1], [2.6, 0.1], [3.2, 0.2], [4.6, 0]],
    armR: [[0, null], [0.7, -100], [2.6, -100], [3.3, -40], [4.6, null]], armL: 'R',
    inn: [[0, 0], [0.7, 18], [2.6, 18], [3.3, 10], [4.6, 0]],
    head: [[0, 0], [0.7, 0.2], [2.6, 0.2], [3.3, -0.35], [4.2, -0.35], [4.6, 0]] },
  // an angel come alive at the altar (not the Mass): hands joined before it, head a little bowed, held
  attend: { T: 600.0, armR: [[0, null], [0.6, -40], [600, -40]], armL: 'R', inn: [[0, 0], [0.6, 34], [600, 34]], lean: [[0, 0], [600, 0]],
    head: [[0, 0], [0.6, -0.15], [600, -0.15]] },
  // ...the one on top, watching over you: hands held out over you, gazing down on you
  watch: { T: 600.0, armR: [[0, null], [0.8, -70], [600, -70]], armL: 'R', inn: [[0, 0], [0.8, -18], [600, -18]], lean: [[0, 0], [0.8, 0.12], [600, 0.12]],
    head: [[0, 0], [0.8, -0.55], [600, -0.55]] },
  // something set down on an altar before you: reached out over it, let go, and back
  place: { T: 1.5,
    lean: [[0, 0], [0.5, 0.3], [0.9, 0.3], [1.5, 0]],
    armR: [[0, null], [0.5, -64], [0.9, -64], [1.5, null]], armL: [[0, null], [1.5, null]],
    inn: [[0, 0], [1.5, 0]], head: [[0, 0], [0.5, -0.35], [0.9, -0.35], [1.5, 0]] },
  // a sacrifice (#offer): held up to the heavens in both hands, laid on the altar, let go; a step back from it,
  // gazing at it as it goes up
  sacrifice: { T: 4.0,
    lean: [[0, 0], [0.6, -0.1], [1.3, -0.1], [1.8, 0.3], [2.2, 0.3], [2.6, -0.05], [3.6, -0.05], [4.0, 0]],
    armR: [[0, -30], [0.6, -150], [1.3, -150], [1.8, -64], [2.2, -64], [2.6, null], [4.0, null]], armL: 'R',
    inn: [[0, 0], [0.6, 14], [1.3, 14], [1.8, 10], [2.2, 10], [2.6, 0], [4.0, 0]],
    head: [[0, 0], [0.6, 0.45], [1.3, 0.45], [1.8, -0.35], [2.2, -0.35], [2.6, 0.1], [3.6, 0.1], [4.0, 0]] },
  // a shot from a bow (a crossbow, a sling: what's wielded, in the right hand), the whole of it, from however you were
  // stood and back to it: into the stance (a step forward, side on to the mark, the bow arm out before you, an arrow
  // in the string hand, the head turned to sight), a breath, drawn (the shoulders turned further, the arrow brought
  // onto the bow's own: NOCK), aimed (the bow arm swung so the arrow points dead ahead, level: aim, AimSolve), held,
  // let go (LOOSE_AT: the arrow away, the string hand flung back, the bow kicking), held there a moment watching it
  // go, and back to how you were
  loose: { T: 2.95,
    lean: [[0, 0], [0.55, -0.03], [1.15, -0.05], [1.8, -0.05], [1.87, 0.03], [2.35, -0.02], [2.95, 0]],
    twist: [[0, 0], [0.55, 0.38], [0.8, 0.38], [1.15, 0.6], [1.8, 0.6], [1.87, 0.48], [2.35, 0.45], [2.95, 0]],
    yaw: [[0, 0], [0.55, -0.4], [0.8, -0.4], [1.15, -0.62], [1.8, -0.62], [1.87, -0.5], [2.35, -0.46], [2.95, 0]],
    armR: [[0, null], [0.55, -90], [1.15, -92], [1.8, -92], [1.87, -84], [2.35, -90], [2.95, null]],
    armL: [[0, null], [0.55, -86], [0.8, -86], [1.15, -93], [1.8, -93], [1.87, -64], [2.35, -82], [2.95, null]],
    innR: [[0, 0], [0.55, -16], [1.15, -26], [1.8, -26], [1.87, -20], [2.35, -20], [2.95, 0]],
    innL: [[0, 0], [0.55, 30], [0.8, 30], [1.15, 50], [1.5, 68], [1.8, 68], [1.87, 24], [2.35, 26], [2.95, 0]],
    inn: [[0, 0], [2.95, 0]],
    aim: [[0, 0], [1.15, 0], [1.5, 1], [1.8, 1], [1.87, 0], [2.95, 0]],
    head: [[0, 0], [0.55, -0.06], [1.8, -0.08], [1.87, -0.04], [2.35, -0.04], [2.95, 0]],
    legR: [[0, 0], [0.55, -16], [2.35, -16], [2.95, 0]], legL: [[0, 0], [0.55, 12], [2.35, 12], [2.95, 0]] },
  // carrying something up before you, held upright (the chalice, brought up to the altar)
  carry: { T: 60.0, armR: [[0, null], [0.4, -100], [60.0, -100]], armL: [[0, null], [60.0, null]], inn: [[0, 0], [60.0, 0]], lean: [[0, 0], [60.0, 0]], head: [[0, 0], [60.0, 0]] },
  // ...and the deacons' (the altar's two statues, come down): hands joined before them; down on their knees, heads
  // bowed, at each elevation, the host's and the chalice's
  massDeacon: { T: 28.0,
    lean: [[0, 0], [28.0, 0]],
    armR: [[0, null], [4.6, null], [5.2, -40], [27.4, -40], [28.0, null]], armL: 'R',
    inn: [[0, 0], [4.6, 0], [5.2, 34], [27.4, 34], [28.0, 0]],
    legR: [[0, 0], [6.6, 0], [7.2, 74], [9.8, 74], [10.4, 0], [13.6, 0], [14.2, 74], [16.4, 74], [17.0, 0], [28.0, 0]], legL: 'R',
    drop: [[0, 0], [6.6, 0], [7.2, 0.21], [9.8, 0.21], [10.4, 0], [13.6, 0], [14.2, 0.21], [16.4, 0.21], [17.0, 0], [28.0, 0]],
    head: [[0, 0], [5.2, -0.1], [6.6, -0.1], [7.2, -0.3], [9.8, -0.3], [10.4, -0.1], [13.6, -0.1], [14.2, -0.3], [16.4, -0.3], [17.0, -0.1],
      [28.0, -0.1]] },
  // ...and the angel on the altar's top: hands raised to the heavens, gazing up, held
  orans: { T: 600.0,
    lean: [[0, 0], [1.0, -0.1], [600, -0.1]],
    armR: [[0, null], [1.2, -170], [600, -170]], armL: 'R',
    inn: [[0, 0], [1.2, 30], [600, 30]],
    head: [[0, 0], [1.2, 0.55], [600, 0.55]] },
  // something dipped in a toilet: bent over it, the hand with it plunged in and swished about (as a fountain's dip)
  get toiletDip() { const D = FOUNT.dip; return { ...D, lean: D.lean.map(([t, v]) => [t, v * 1.25]) }; },
  get toiletRetch() { const R = FOUNT.retch; return { ...R, lean: R.lean.map(([t, v]) => [t, v * 0.82]), armR: R.armR.map(([t, v]) => [t, v === null ? null : v * 0.7]) }; },
  get sinkRetch() { const R = FOUNT.retch; return { ...R, lean: R.lean.map(([t, v]) => [t, v * 0.45]), armR: R.armR.map(([t, v]) => [t, v === null ? null : v * 1.4]) }; },
  // the urge to take a bath: a crouch, a dive in head first, arms out before you; under, arms up out of the
  // water; a jump back out onto the rim, turning to land facing away from it, and a shake, arms out,
  // dripping; then a dusting down, a hand and then the other patting your front, looking down at it; and a
  // turn back round (where you are: perch.js bathPath)
  bath: { T: 5.0,
    lean: [[0, 0], [0.35, 0.55], [0.55, 0.9], [0.85, 1.6], [1.15, 0.2], [1.8, 0], [2.0, 0.35], [2.35, 0], [2.6, 0.25], [3.3, 0.2], [3.5, 0.3], [4.4, 0.3], [4.7, 0]],
    armR: [[0, null], [0.35, 35], [0.55, -170], [1.0, -170], [1.3, -150], [1.6, -165], [1.8, -40], [2.0, 30], [2.35, -60], [2.55, -20], [3.3, -20],
      [3.5, -40], [3.62, -8], [3.74, -40], [3.86, -8], [3.98, -40], [4.1, -8], [4.22, -40], [4.4, -20], [4.7, null]],
    armL: [[0, null], [0.35, 35], [0.55, -170], [1.0, -170], [1.3, -150], [1.6, -165], [1.8, -40], [2.0, 30], [2.35, -60], [2.55, -20], [3.3, -20],
      [3.56, -8], [3.68, -40], [3.8, -8], [3.92, -40], [4.04, -8], [4.16, -40], [4.28, -8], [4.4, -20], [4.7, null]],
    inn: [[0, 0], [0.55, 0], [1.3, -10], [2.35, 0], [2.55, 70], [3.3, 70], [3.5, -30], [4.4, -30], [4.7, 0]],
    head: [[0, 0], [0.35, -0.2], [0.85, -0.4], [1.2, 0.3], [1.8, 0.3], [2.1, 0], [3.4, 0], [3.55, -0.4], [4.4, -0.4], [4.7, 0]] },
};
// a FOUNT act's keyframed value at t (s): e.g. how far a prayer's dropped you to your knees ('drop')
export function fountKey(act, key, t) { const F = FOUNT[act]; return F && F[key] ? keyAt(F[key], t) : 0; }
function keyAt(keys, t, rest = 0) {
  const v = (x) => (x === null ? rest : x);
  if (t <= keys[0][0]) return v(keys[0][1]);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t <= b[0]) return v(a[1]) + (v(b[1]) - v(a[1])) * ease((t - a[0]) / (b[0] - a[0]));
  }
  return v(keys[keys.length - 1][1]);
}

// The bow arm (rig arm j, the body turned B) swung (swing, out: degrees, as FigureAnimator's arms) so what it holds
// points its +Z (a bow's own arrow, tools/minifig.py HELD 4499: in the grip's frame) dead ahead, level: the
// figure's +Z. Searched from (a, o), finer each round.
function aimSolve(B, j, a, o) {
  const G = j.grip, side = j.pivot[0] < 0 ? -1 : 1;
  const zf = [G[8], G[9], G[10]];
  const err = (sw, ou) => {
    const M = mul(B, mul(turnAbout(j.pivot, j.axis, (sw - j.swing) * DEG), turnAbout(j.pivot, [0, 0, side < 0 ? -1 : 1], ou * DEG)));
    const d = [M[0] * zf[0] + M[4] * zf[1] + M[8] * zf[2], M[1] * zf[0] + M[5] * zf[1] + M[9] * zf[2], M[2] * zf[0] + M[6] * zf[1] + M[10] * zf[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return 1 - d[2] / l; // (0: straight ahead)
  };
  let best = [a, o], be = err(a, o);
  for (const step of [16, 6, 2, 0.6, 0.2]) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const [da, dout] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const e = err(best[0] + da, best[1] + dout);
        if (e < be - 1e-7) { be = e; best = [best[0] + da, best[1] + dout]; moved = true; }
      }
    }
  }
  return best;
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
    this.act = { lean: 0, reach: 0, lookUp: 0, heavy: 0, hop: 0, raise: 0, ride: 0 }; // what the body's doing, eased (state: lean...; ride: astride a steed)
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
  //   in the air, a little jump: arms flung up, knees up), fount ({act: 'drink'|'dip', t: s into it}: at a
  //   fountain, FOUNT), raise (0..1: what's in the right hand held high overhead, gazing up at it: Excalibur won)}
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
    for (const k of ['lean', 'reach', 'lookUp', 'heavy', 'raise', 'ride']) A[k] = approach(A[k], state[k] || 0, 6, dt);
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
    this.headPitch = approach(this.headPitch, (lookPitch * (1 - up) - 0.35 * up) * (1 - A.lookUp) - 0.55 * A.lookUp + 0.15 * heavy - 0.45 * A.raise, 5, dt);

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
    const F = state.fount && FOUNT[state.fount.act] && state.fount.t < FOUNT[state.fount.act].T ? FOUNT[state.fount.act] : null, ft = F ? state.fount.t : 0;
    const bend = turnAbout(waist, [1, 0, 0], A.lean - 0.14 * heavy - 0.1 * A.raise + (F ? keyAt(F.lean, ft) : 0));
    // the upper body: breathing, twisting into a slash, waddling
    const B = mul(bend, mul(waddle, mul(F && F.twist ? turnAbout(waist, [0, 1, 0], keyAt(F.twist, ft)) : ident(), mul(slash ? turnAbout(waist, [0, -1, 0], lefty ? -slash.twist : slash.twist) : ident(), swellY(waist[1], 1 + breath)))));

    const P = this.poses;
    P.body = B;
    P.amulet = B; // (an amulet worn: on the chest, moving with it)
    const hp = rig.head ? rig.head.pivot : [0, 0, 0];
    P.head = mul(B, mul(turnAbout(hp, [0, 1, 0], this.headYaw * (F ? 0 : 1) + (F && F.yaw ? keyAt(F.yaw, ft) : 0)), turnAbout(hp, [1, 0, 0], this.headPitch * (F ? 0 : 1) - (F ? keyAt(F.head, ft) : 0))));

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
      target = target * (1 - A.ride) + (holding ? target : -38) * A.ride; // (riding: the reins held out before you)
      if (side === 'R') target = target * (1 - A.raise) - 112 * A.raise; // (held high: up and out before you, so what it holds stands up into the air: a minifig's grip is square to its arm)
      let a = approach(this.arm[side], target, 10, dt);
      let out = 0;
      // (fighting with two weapons, the left slashes too, a moment after the right)
      const slashL = side === 'L' && !lefty && state.twoweap && atk >= 0.25 && atk < 1.25 ? slashAt(atk - 0.25, this.arm.L) : null;
      if (F) {
        a = keyAt(F[F['arm' + side] === 'R' ? 'armR' : 'arm' + side], ft, a); out = keyAt(F['inn' + side] || F.inn, ft);
        const k = side === 'R' && F.aim ? keyAt(F.aim, ft) : 0;
        if (k > 0 && j.grip) { const s = aimSolve(B, j, a, out); a += (s[0] - a) * k; out += (s[1] - out) * k; } // (aimed: the bow's arrow dead ahead)
        this.arm[side] = a;
      }
      else if (slash && side === (lefty ? 'L' : 'R')) { a = slash.swing; out = slash.out; }
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
      const a = swing * 32 * (1 - 0.5 * heavy) * (1 - A.ride) * DEG, tuck = (-40 * A.hop - 84 * A.ride) * DEG; // (heavy: short steps; a hop: knees up; riding: astride, legs out before you, still)
      P.legR = turnAbout(rig.legs.pivot, rig.legs.axis, a + tuck + (F && F.legR ? keyAt(F.legR, ft) * DEG : 0)); // (a kick: FOUNT.kick)
      P.legL = turnAbout(rig.legs.pivot, rig.legs.axis, -a + tuck + (F && F.legL ? keyAt(F.legL === 'R' ? F.legR : F.legL, ft) * DEG : 0)); // (sat down: FOUNT.sit)
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
// where a figure's mouth is, in the world: a point on the front of its head (model units: studs, up from the
// neck and out before the face), carried through the head's pose (leaning, nodding) and the figure's matrix
export const MOUTH = [0, 0.6, 0.62];
export function mouthPoint(matrix, pose) {
  const ap = (M, v) => [0, 1, 2].map((r) => M[r] * v[0] + M[4 + r] * v[1] + M[8 + r] * v[2] + M[12 + r]);
  const h = pose && pose.head ? ap(pose.head, MOUTH) : MOUTH;
  return ap(matrix, h);
}
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
// extras; and any it carries with it, "more") swung open by `deg` degrees about its hinge. root: a loaded model
// (or a clone); its hinged node is posed by matrix from then on.
export function setHinge(THREE, root, deg) {
  let h = null;
  root.traverse((o) => { if (!h && o.userData && o.userData.hinge) h = o.userData.hinge; });
  if (!h || !root.getObjectByName(h.joint)) return false;
  for (const j of [h, ...(h.more || [])]) { // (and any swinging with it, as far through their own swing: a beartrap's other jaw)
    const part = root.getObjectByName(j.joint);
    if (!part) continue;
    const p = new THREE.Vector3(...j.pivot), ax = new THREE.Vector3(...j.axis).normalize(), d = deg * (j.open / h.open);
    const m = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)
      .multiply(new THREE.Matrix4().makeRotationAxis(ax, (d * Math.PI) / 180))
      .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
    part.matrixAutoUpdate = false;
    part.matrix.copy(m);
    part.matrixWorldNeedsUpdate = true;
  }
  return h.open;
}

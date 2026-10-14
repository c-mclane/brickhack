// Original Minecraft-style block textures, drawn in code (16x16) and written
// into free slots of the tile atlas after the game's own tiles:
//   meta.count + 0       player skin (see skin.js)
//   meta.count + 1 ...   the textures below
// Also: the lower-wall brick, built from the colours of the game's wall tile.

const S = 16;
const KEY = [71, 108, 108]; // atlas key colour = transparent on keyed quads

export const TEX_NAMES = ['wallBrick', 'stone', 'dirt', 'cobble', 'brick', 'chestSide', 'chestFront', 'chestTop', 'puff',
  // Dreamland (Peanut Plains style) blocks
  'grassTop', 'grassSide', 'sand', 'starBlock', 'bombBlock', 'logSide', 'logTop', 'leaves',
  // castle stone and ladders; the little house: planks, roof shingles, a fire
  'stoneBricks', 'ladder', 'planks', 'gateWood', 'roof', 'fire0', 'fire1', 'fire2', 'fire3',
  // the magic portal on top of the tower
  'portal0', 'portal1', 'portal2', 'portal3',
  // Dreamland level 3: peach pillars, checkered towers, sky platforms, pink bricks
  'peach', 'peachTop', 'checker', 'skyPlat', 'skyTop', 'pinkBrick',
  // Dreamland level 4: the marble palace and its gardens
  'marble', 'quartz', 'glass', 'hedge', 'flower0', 'flower1', 'flower2',
  // Ascend level 1: fallen logs' bark (running along them), the house's windows
  'logBark', 'windowGlass', 'weeds', 'weedsTop', 'weedsTuft', 'leaves1', 'leaves2', 'fallLeaf0', 'fallLeaf1',
  // Dreamland level 5, the Fountain of Dreams: lavender tower domes, the
  // island's arched wall, the Star Rod (two frames: it flashes)
  'scales', 'archWall', 'starRod0', 'starRod1',
  // ...its gushers' rainbow sparkles, little cone trees, pink clouds
  'spark0', 'spark1', 'spark2', 'spark3', 'coneGreen', 'coneRed', 'pinkCloud',
  'crack0', 'crack1', 'crack2', 'crack3', 'crack4', 'crack5', 'crack6', 'crack7', 'crack8', 'crack9'];

// deterministic little PRNG so textures look the same every load
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  return c;
}

function paint(fn) {
  const c = canvas();
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const set = (x, y, [r, g, b]) => {
    const i = (((y + S) % S) * S + ((x + S) % S)) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  };
  fn(set);
  ctx.putImageData(img, 0, 0);
  return c;
}

const shade = ([r, g, b], k) => [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
const nudge = (c, r, amt) => shade(c, 1 + (r() - 0.5) * amt);

// --- the individual textures ------------------------------------------------

// seamless brick from the wall tile's own palette (mortar / brick / highlight)
function wallBrick(m, b, h) {
  return paint((set) => {
    for (let course = 0; course < 4; course++) {
      const y0 = course * 4, off = course % 2 ? 4 : 0;
      for (let x = 0; x < S; x++) set(x, y0, m);
      for (let y = y0 + 1; y < y0 + 4; y++)
        for (let x = 0; x < S; x++) {
          const j = (x - off + S) % 8;
          set(x, y, j === 0 ? m : j === 1 && y === y0 + 1 ? h : b);
        }
    }
  });
}

function stone() {
  const r = rng(7);
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(x, y, nudge([122, 122, 122], r, 0.22));
    for (let i = 0; i < 9; i++) { // darker streaks
      const x = Math.floor(r() * S), y = Math.floor(r() * S), len = 2 + Math.floor(r() * 4);
      for (let k = 0; k < len; k++) set(x + k, y, [98, 98, 98]);
    }
  });
}

function dirt() {
  const r = rng(11);
  const base = [134, 96, 67];
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = r();
      set(x, y, v < 0.12 ? [101, 70, 47] : v > 0.9 ? [158, 117, 84] : nudge(base, r, 0.12));
    }
    for (let i = 0; i < 6; i++) set(Math.floor(r() * S), Math.floor(r() * S), [120, 120, 120]); // pebbles
  });
}

function cobble() {
  // irregular stones: nearest of a few seed points, darker borders between them
  const r = rng(23);
  const pts = Array.from({ length: 11 }, () => [r() * S, r() * S, 0.85 + r() * 0.35]);
  const near = (x, y) => {
    let best = [1e9, 1e9, 0];
    pts.forEach((p, i) => {
      for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
        const d = (x - p[0] - dx) ** 2 + (y - p[1] - dy) ** 2;
        if (d < best[0]) best = [d, best[0], i];
        else if (d < best[1]) best[1] = d;
      }
    });
    return best;
  };
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const [d1, d2, i] = near(x + 0.5, y + 0.5);
      const edge = Math.sqrt(d2) - Math.sqrt(d1) < 1.1;
      set(x, y, edge ? [72, 72, 72] : nudge(shade([128, 128, 128], pts[i][2]), r, 0.1));
    }
  });
}

function brick() {
  const r = rng(31);
  const mortar = [168, 160, 152], red = [150, 74, 58];
  return paint((set) => {
    for (let course = 0; course < 4; course++) {
      const y0 = course * 4, off = course % 2 ? 4 : 0;
      for (let x = 0; x < S; x++) set(x, y0, mortar);
      for (let x = 0; x < S; x++) {
        const k = 0.85 + r() * 0.25;
        for (let y = y0 + 1; y < y0 + 4; y++) set(x, y, (x - off + S) % 8 === 0 ? mortar : shade(nudge(red, r, 0.12), k));
      }
    }
  });
}

// Minecraft-style stone bricks: two courses of big grey blocks, offset
function stoneBricks() {
  const r = rng(53);
  const mortar = [92, 92, 96], face = [132, 132, 136];
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const course = y < 8 ? 0 : 1, yy = y % 8, xx = (x + (course ? 8 : 0)) % S;
        if (yy === 7 || xx === 15) { set(x, y, mortar); continue; }
        const lit = yy === 0 || xx === 0 ? 1.12 : yy === 6 || xx === 14 ? 0.86 : 1; // bevelled edges
        set(x, y, shade(nudge(face, r, 0.12), lit));
      }
  });
}

// a wooden ladder: two rails and three rungs, see-through between them
function ladder() {
  const r = rng(61);
  const wood = [150, 104, 52];
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const rail = x === 2 || x === 3 || x === 12 || x === 13;
        const rung = (y % 5 === 1 || y % 5 === 2) && x > 3 && x < 12;
        set(x, y, rail || rung ? shade(nudge(wood, r, 0.15), rung && y % 5 === 2 ? 0.8 : 1) : KEY);
      }
  });
}

// oak planks: four boards, the joints staggered
function plankBlock() {
  const r = rng(71);
  const wood = [170, 128, 72];
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const board = y >> 2, joint = (board * 5 + 3) % S;
        const line = y % 4 === 3 || x === joint;
        set(x, y, line ? [104, 74, 40] : shade(nudge(wood, r, 0.08), 1 - (y % 4) * 0.025));
      }
  });
}

// the paddock gate's wood: paler and warmer than the fence, so it stands out
function gateWood() {
  const r = rng(77);
  const wood = [214, 178, 112];
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) set(x, y, y % 4 === 3 ? [150, 112, 60] : shade(nudge(wood, r, 0.07), 1 - (y % 4) * 0.02));
  });
}

// cute red roof shingles: rows of rounded tiles, offset
function roof() {
  const r = rng(73);
  const red = [184, 64, 52];
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const row = y >> 2, yy = y % 4, xx = (x + (row % 2 ? 2 : 0)) % 4;
        const rim = yy === 3 || (xx === 0 && yy > 0);
        set(x, y, rim ? [116, 38, 32] : shade(nudge(red, r, 0.1), yy === 0 ? 1.15 : 1 - yy * 0.04));
      }
  });
}

// a flickering fire, frame k of 4: hot yellow core, orange then red at the tips
function fire(k) {
  const r = rng(80 + k);
  const noise = Array.from({ length: S * S }, () => r());
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const h = (S - y) / S; // 0 at the bottom, 1 at the top
        const cx = 7.5 + Math.sin(y * 0.7 + k * 1.6) * 1.2; // the flame sways
        const width = 6.5 * (1 - h) ** 0.8 + 0.5;
        const d = Math.abs(x - cx) / width + noise[y * S + x] * 0.35 - 0.1;
        if (d > 1 || y < 1) { set(x, y, KEY); continue; }
        set(x, y, d < 0.35 && h < 0.6 ? [255, 244, 160] : d < 0.65 ? [255, 176, 40] : [226, 72, 24]);
      }
  });
}

// Kirby-style peach pillar: soft peach, a white shine down one side, a few
// tiny stars
function peach() {
  const r = rng(101);
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const shine = x === 3 || x === 4 ? 1.22 : x === 2 ? 1.1 : x >= 13 ? 0.86 : 1;
        set(x, y, shade(nudge([244, 166, 136], r, 0.05), shine));
      }
    for (const [sx, sy] of [[9, 3], [7, 11]]) { // little stars
      set(sx, sy, [255, 236, 214]); set(sx - 1, sy, [255, 222, 196]); set(sx + 1, sy, [255, 222, 196]);
      set(sx, sy - 1, [255, 222, 196]); set(sx, sy + 1, [255, 222, 196]);
    }
  });
}

// the top of a peach pillar: rounded corners (see-through), a highlight
function peachTop() {
  const base = peach();
  const px = base.getContext('2d').getImageData(0, 0, S, S).data;
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const cx = Math.max(0, Math.abs(x - 7.5) - 3.5), cy = Math.max(0, 7.5 - y - 1.5);
        if (y < 8 && Math.hypot(cx, cy) > 4.2) { set(x, y, KEY); continue; } // the rounded top
        const i = (y * S + x) * 4;
        set(x, y, shade([px[i], px[i + 1], px[i + 2]], y < 3 ? 1.12 : 1));
      }
  });
}

// pink and green checks (Kirby's checkered towers)
function checker() {
  const r = rng(103);
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const pink = ((x >> 2) + (y >> 2)) % 2 === 0;
        set(x, y, nudge(pink ? [236, 118, 150] : [86, 168, 92], r, 0.06));
      }
  });
}

// a floating sky platform: light blue with a white frosting along the top
function skyPlat() {
  const r = rng(105);
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++)
        set(x, y, y < 4 ? nudge([248, 252, 255], r, 0.03) : shade(nudge([124, 170, 236], r, 0.05), 1 - (y - 4) * 0.02));
  });
}
function skyTop() {
  const r = rng(107);
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(x, y, nudge(x === 0 || y === 0 ? [214, 232, 255] : [244, 250, 255], r, 0.03));
  });
}

// pink bricks (the ledges on the pillars)
function pinkBrick() {
  const r = rng(109);
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const course = y >> 2, off = course % 2 ? 4 : 0;
        const mortar = y % 4 === 3 || (x + off) % 8 === 7;
        set(x, y, mortar ? [196, 120, 132] : nudge([236, 160, 170], r, 0.07));
      }
  });
}

// white marble with soft grey veins
function marble() {
  const r = rng(121);
  const veins = Array.from({ length: 3 }, () => [r() * S, r() * 2 - 1, r() * 6.3]);
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const v = veins.some(([x0, k, p]) => Math.abs(x - (x0 + k * y + Math.sin(y * 0.6 + p) * 1.5)) < 0.55);
        set(x, y, v ? [196, 196, 204] : nudge([238, 238, 242], r, 0.025));
      }
  });
}

// a fluted quartz pillar: pale, with vertical grooves
function quartz() {
  const r = rng(123);
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) set(x, y, shade(nudge([234, 228, 222], r, 0.02), x % 4 === 0 ? 0.82 : x % 4 === 1 ? 1.06 : 1));
  });
}

// stained glass: leaded panes in jewel colours
function glass() {
  const r = rng(125);
  const jewels = [[186, 40, 60], [40, 92, 196], [232, 180, 40], [56, 150, 84], [140, 60, 170]];
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const lead = x % 5 === 0 || y % 5 === 0 || (x + y) % 9 === 0;
        set(x, y, lead ? [46, 40, 48] : shade(jewels[(((x / 5) | 0) * 3 + ((y / 5) | 0) * 2) % jewels.length], 1.05 + (r() - 0.5) * 0.12));
      }
  });
}

// a clipped hedge: dense dark leaves
function hedge() {
  const r = rng(127);
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(x, y, shade([48, 112, 52], 0.7 + r() * 0.5));
  });
}

// a little flower on a stem (a sprite): pink, yellow or white, k = 0..2
function flower(k) {
  const petal = [[244, 128, 176], [250, 214, 60], [250, 250, 250]][k];
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(x, y, KEY);
    for (let y = 8; y < S; y++) set(7, y, [70, 150, 60]); // stem
    set(6, 12, [80, 170, 70]); set(5, 11, [80, 170, 70]); set(8, 13, [80, 170, 70]); set(9, 12, [80, 170, 70]); // leaves
    for (const [dx, dy] of [[0, -2], [0, 2], [-2, 0], [2, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) set(7 + dx, 6 + dy, petal);
    set(7, 6, [250, 190, 40]); // the middle
  });
}

// a swirling magic portal, frame k of 4: a pink and purple whirl in an oval,
// with a few sparkles
function portal(k) {
  const r = rng(90 + k);
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = (x - 7.5) / 6.5, dy = (y - 7.5) / 7.5, d = Math.hypot(dx, dy);
        if (d > 1) { set(x, y, KEY); continue; }
        const a = Math.atan2(dy, dx) + d * 5 - k * (Math.PI / 2); // the swirl turns frame by frame
        const band = 0.5 + 0.5 * Math.sin(a * 3);
        const c = d > 0.86 ? [120, 40, 170] : band > 0.55 ? [236, 120, 230] : [150, 70, 220];
        set(x, y, r() < 0.04 ? [255, 250, 210] : shade(c, 1.2 - d * 0.35));
      }
  });
}

function planks(set, r) {
  const wood = [160, 118, 64];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const seam = y % 4 === 0;
    set(x, y, seam ? [92, 64, 34] : nudge(wood, r, 0.1));
  }
}

function chestSide() {
  const r = rng(41);
  return paint((set) => {
    planks(set, r);
    for (let i = 0; i < S; i++) { set(i, 0, [58, 40, 20]); set(i, S - 1, [58, 40, 20]); set(0, i, [58, 40, 20]); set(S - 1, i, [58, 40, 20]); }
    for (let x = 1; x < S - 1; x++) set(x, 5, [58, 40, 20]); // lid line
  });
}

function chestFront() {
  const c = chestSide();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2b2b2b';
  ctx.fillRect(6, 3, 4, 5);
  ctx.fillStyle = '#c9c9c9';
  ctx.fillRect(7, 4, 2, 3); // latch
  return c;
}

function chestTop() {
  const r = rng(43);
  return paint((set) => {
    planks(set, r);
    for (let i = 0; i < S; i++) { set(i, 0, [58, 40, 20]); set(i, S - 1, [58, 40, 20]); set(0, i, [58, 40, 20]); set(S - 1, i, [58, 40, 20]); }
  });
}

// a soft round smoke puff (key colour outside), for monsters going poof
function puff() {
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      set(x, y, d > 7 ? KEY : d > 5.5 ? [200, 200, 210] : d > 3 ? [235, 235, 240] : [255, 255, 255]);
    }
  });
}

// ---- Dreamland blocks: bright, round, Kirby-ish -------------------------------
function grassTop() {
  const r = rng(61);
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(x, y, nudge([104, 196, 74], r, 0.14));
    for (let i = 0; i < 14; i++) set(Math.floor(r() * S), Math.floor(r() * S), [150, 228, 104]); // light blades
    for (let i = 0; i < 3; i++) { // tiny flowers
      const x = Math.floor(r() * 14) + 1, y = Math.floor(r() * 14) + 1, c = r() < 0.5 ? [255, 160, 200] : [255, 245, 170];
      set(x, y, c); set(x + 1, y, c); set(x - 1, y, c); set(x, y + 1, c); set(x, y - 1, c); set(x, y, [255, 255, 255]);
    }
  });
}

function grassSide() {
  const r = rng(67);
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(x, y, nudge([196, 140, 86], r, 0.12)); // warm dirt
    for (let x = 0; x < S; x++) {
      const drip = 3 + Math.floor(r() * 3);
      for (let y = 0; y < drip; y++) set(x, y, nudge([104, 196, 74], r, 0.12));
      set(x, drip, [74, 150, 54]);
    }
  });
}

function sand() {
  const r = rng(71);
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(x, y, nudge([240, 214, 150], r, 0.08));
    for (let i = 0; i < 10; i++) set(Math.floor(r() * S), Math.floor(r() * S), [214, 180, 112]);
  });
}

function starBlock() {
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const edge = x === 0 || y === 0 || x === S - 1 || y === S - 1;
      const hi = x === 1 || y === 1, lo = x === S - 2 || y === S - 2;
      set(x, y, edge ? [150, 90, 20] : hi ? [255, 214, 120] : lo ? [200, 120, 30] : [238, 160, 48]);
    }
    // a fat yellow five-point star in the middle
    for (let y = 2; y < S - 2; y++) for (let x = 2; x < S - 2; x++) {
      const px = x - 7.5, py = y - 8, rr = Math.hypot(px, py), a = Math.atan2(py, px) + Math.PI / 2;
      const edge = 5.6 * (0.55 + 0.45 * Math.pow(Math.abs(Math.cos(2.5 * a)), 2));
      if (rr < edge) set(x, y, rr < edge * 0.45 ? [255, 255, 210] : [255, 232, 60]);
    }
  });
}

function bombBlock() {
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const edge = x === 0 || y === 0 || x === S - 1 || y === S - 1;
      set(x, y, edge ? [40, 40, 70] : (x + y) % 2 ? [110, 110, 150] : [100, 100, 140]);
    }
    for (let y = 3; y < 14; y++) for (let x = 3; x < 14; x++) { // the bomb
      const d = Math.hypot(x - 8, y - 9);
      if (d < 4.6) set(x, y, d < 1.6 && x < 8 && y < 9 ? [200, 200, 230] : [24, 24, 32]);
    }
    set(10, 4, [24, 24, 32]); set(11, 3, [140, 100, 60]); set(12, 2, [255, 200, 60]); set(12, 1, [255, 90, 40]); // fuse + spark
  });
}

function logSide() {
  const r = rng(73);
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(x, y, x % 4 === 0 ? [110, 72, 40] : nudge([150, 102, 58], r, 0.1));
  });
}

// the bark turned on its side, for a log lying down
function logBark() {
  const side = logSide();
  return paint((set) => {
    const px = side.getContext('2d').getImageData(0, 0, S, S).data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = (x * S + y) * 4; set(x, y, [px[i], px[i + 1], px[i + 2]]); }
  });
}

// clear window glass: a pale frame, see-through (key colour) inside but for
// a few glints
function windowGlass() {
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const frame = x === 0 || y === 0 || x === S - 1 || y === S - 1;
        const glint = (x - y === 3 && x > 3 && x < 9) || (x - y === 6 && x > 7 && x < 12) || (x === 12 && y === 3);
        set(x, y, frame ? [222, 236, 240] : glint ? [246, 252, 255] : KEY);
      }
  });
}

// a wall of tall weeds and grass: blades of every green, a few seed heads;
// tips: true for the top block, its blades ending raggedly (see-through between)
function weeds(tips) {
  const r = rng(tips ? 141 : 139);
  const greens = [[58, 128, 46], [76, 150, 52], [96, 168, 60], [120, 176, 64], [66, 112, 40], [140, 172, 70]];
  const tip = [...Array(S)].map(() => 2 + Math.floor(r() * 9));
  return paint((set) => {
    for (let x = 0; x < S; x++) {
      const g = greens[Math.floor(r() * greens.length)];
      for (let y = 0; y < S; y++) {
        if (tips && y < tip[x]) { set(x, y, KEY); continue; }
        const dark = (x * 7 + y * 3) % 11 === 0 || r() < 0.12;
        set(x, y, dark ? [34, 78, 30] : nudge(g, r, 0.18));
      }
      if (tips && r() < 0.18) set(x, tip[x], [196, 176, 96]); // a seed head
    }
  });
}

// looking down on the weeds: scattered blade tips
function weedsTuft() {
  const r = rng(143);
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(x, y, r() < 0.3 ? nudge([86, 156, 56], r, 0.3) : KEY);
  });
}

// the lavender scales of the Fountain of Dreams' tower domes, with gold dots
function scales() {
  const r = rng(147);
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const row = Math.floor(y / 4), sx = (x + (row % 2) * 2) % 4, sy = y % 4;
        const d = Math.hypot(sx - 1.5, sy - 0.5);
        const rim = d > 1.9;
        let c = rim ? [118, 86, 168] : shade([176, 146, 220], 1.1 - sy * 0.07);
        if (!rim && sx === 1 && sy === 1 && (x * 5 + y * 3) % 7 === 0) c = [250, 220, 90]; // gold dots
        set(x, y, nudge(c, r, 0.06));
      }
  });
}

// the island's wall below the Fountain: pale lavender stone with an arched
// window, dark blue behind gold lattice
function archWall() {
  const r = rng(149);
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const inArch = x >= 4 && x <= 11 && y >= 3 && (y >= 7 || Math.hypot(x - 7.5, y - 7) <= 4);
        const edge = !inArch && x >= 3 && x <= 12 && y >= 2 && (y >= 7 ? x === 3 || x === 12 : Math.hypot(x - 7.5, y - 7) <= 5);
        let c;
        if (inArch) c = (x + y) % 4 === 0 || (x - y + 16) % 4 === 0 ? [222, 186, 92] : [28, 30, 78];
        else if (edge) c = [168, 156, 196];
        else c = y % 8 === 0 || (x + (Math.floor(y / 8) % 2) * 4) % 8 === 0 ? [176, 168, 204] : nudge([226, 220, 240], r, 0.05);
        set(x, y, c);
      }
  });
}

// the Star Rod (a sprite): a pink and white striped staff with a yellow star
// on top; lit: the star flashing white
function starRod(lit) {
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = x - 7.5, dy = y - 4.5, a = Math.atan2(dy, dx) + Math.PI / 2;
        const rad = 4.4 * (0.6 + 0.4 * Math.cos(5 * a)) ** 1.6 + 1.2; // a five-point star
        const d = Math.hypot(dx, dy);
        if (d <= rad) set(x, y, lit ? (d > rad - 1 ? [255, 236, 150] : [255, 255, 236]) : d > rad - 1 ? [214, 150, 30] : [252, 222, 70]);
        else if ((x === 7 || x === 8) && y >= 8) set(x, y, (y + x) % 3 === 0 ? [236, 96, 150] : [250, 246, 250]);
        else if (lit && d <= rad + 1.5 && (x + y) % 2 === 0) set(x, y, [255, 250, 200]); // the flash
        else set(x, y, KEY);
      }
  });
}

// a sparkle of spray (a sprite): a little four-point twinkle, k = 0..3 a
// colour of the rainbow (pink, gold, aqua, lilac)
function spark(k) {
  const c = [[255, 150, 200], [255, 226, 110], [130, 236, 255], [200, 160, 255]][k];
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5);
        const core = dx + dy < 3.2, ray = (dx < 1 && dy < 7) || (dy < 1 && dx < 7);
        set(x, y, core ? [255, 255, 255] : ray ? c : KEY);
      }
  });
}

// a little cone tree (a sprite), green or red, with gold baubles and a star
function coneTree(red) {
  const r = rng(red ? 151 : 153);
  const body = red ? [214, 52, 64] : [52, 160, 72], dark = red ? [150, 28, 44] : [28, 104, 48];
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const half = (y - 1) * 0.45; // the cone widens downwards
        const inCone = y >= 2 && y <= 13 && Math.abs(x - 7.5) <= half;
        if (y <= 1 && Math.abs(x - 7.5) < 1) set(x, y, [255, 230, 90]); // the star on top
        else if (inCone) {
          const band = (y + Math.floor(Math.abs(x - 7.5))) % 4 === 0;
          set(x, y, r() < 0.1 ? [250, 214, 80] : band ? dark : nudge(body, r, 0.12));
        } else if (y >= 14 && Math.abs(x - 7.5) < 1.5) set(x, y, [112, 74, 44]); // the trunk
        else set(x, y, KEY);
      }
  });
}

// a fluffy pink cloud (a sprite): pixelated round puffs, paler on top
function pinkCloud() {
  const puffs = [[5, 9, 4], [10, 8, 4.5], [8, 6, 3.5], [3, 11, 2.8], [13, 11, 2.6]];
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.min(...puffs.map(([px, py, pr]) => Math.hypot(x - px, y - py) - pr));
        if (d > 0 || y > 13) { set(x, y, KEY); continue; }
        const top = puffs.some(([px, py, pr]) => Math.hypot(x - px, y - 1 - py) > pr && Math.hypot(x - px, y - py) <= pr);
        set(x, y, top ? [255, 236, 246] : d > -1 ? [222, 128, 178] : y > 10 ? [238, 160, 202] : [250, 190, 222]);
      }
  });
}

// a falling leaf (a sprite), after the user's pixel art: 0, a golden one with
// its stem; 1, a red-orange one
function fallLeaf(k) {
  const pal = k === 0
    ? { a: [221, 145, 38], b: [203, 125, 22], c: [182, 115, 26], d: [138, 84, 12], e: [150, 96, 22] }
    : { a: [186, 80, 40], b: [170, 64, 28], c: [157, 54, 20], d: [178, 72, 34] };
  const rows = k === 0 ? [
    '.......a........',
    '......abaa......',
    '.....abbb.......',
    '....abbbbc......',
    '....abbbcc......',
    '.....dccc.......',
    '......e.........',
    '......ed........',
  ] : [
    '.........cc.....',
    '.......bcc......',
    '......abbcc.....',
    '.....abdddbc....',
    '.....adddbbc....',
    '......addbaa....',
    '.......aa.......',
    '.......a........',
  ];
  return paint((set) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const ch = rows[y - 8] && rows[y - 8][x]; // (in the bottom half: a sprite stands on its feet)
        set(x, y, ch && ch !== '.' ? pal[ch] : KEY);
      }
  });
}

function logTop() {
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      set(x, y, d > 7 ? [110, 72, 40] : Math.floor(d) % 2 ? [214, 170, 110] : [190, 146, 90]);
    }
  });
}

// autumn leaves, after the user's reference (orange poplar): a burnt-orange
// base, brighter orange and gold leaves on it (little plus and pill shapes,
// lit in the middle), and deep brown holes between; three variants (k), so a
// canopy doesn't repeat
function leaves(k = 0) {
  const r = rng(79 + k * 17);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const base = [[172, 76, 14], [152, 62, 12], [186, 90, 24], [164, 70, 18]];
  const bright = [[236, 138, 40], [244, 164, 56], [226, 120, 34], [240, 150, 46]];
  const dark = [[62, 24, 4], [84, 38, 8], [100, 44, 10]];
  const px = [...Array(S * S)].map(() => pick(base));
  const put = (x, y, c) => (px[(((y % S) + S) % S) * S + (((x % S) + S) % S)] = c); // (wrapping: blocks join up)
  const PLUS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]], PILL = [[0, 0], [1, 0], [0, 1], [1, 1]], BAR = [[0, 0], [1, 0], [2, 0], [1, 1]];
  // the holes: dark plus shapes
  for (let n = 0; n < 6; n++) {
    const x = Math.floor(r() * S), y = Math.floor(r() * S), c = pick(dark);
    for (const [dx, dy] of PLUS) put(x + dx, y + dy, dx || dy ? pick(dark) : dark[0]);
  }
  // the leaves on top: bright shapes, the first pixel lit a little more
  for (let n = 0; n < 20; n++) {
    const x = Math.floor(r() * S), y = Math.floor(r() * S), c = pick(bright), shape = pick([PLUS, PILL, BAR, PILL]);
    shape.forEach(([dx, dy], i) => put(x + dx, y + dy, i === 0 ? shade(c, 1.08) : c));
  }
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(x, y, nudge(px[y * S + x], r, 0.05));
  });
}

// ten crack stages; transparent (key colour) except the crack lines
function cracks() {
  const r = rng(53);
  const segs = [];
  const branch = (x, y, n) => {
    for (let i = 0; i < n; i++) {
      const nx = x + Math.round((r() - 0.5) * 3), ny = y + Math.round((r() - 0.5) * 3);
      segs.push([x, y, nx, ny]);
      x = Math.max(0, Math.min(S - 1, nx)); y = Math.max(0, Math.min(S - 1, ny));
      if (r() < 0.25) branch(x, y, Math.floor(n / 2));
    }
  };
  branch(8, 8, 14);
  branch(4, 11, 8);
  branch(11, 4, 8);
  return Array.from({ length: 10 }, (_, stage) => paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(x, y, KEY);
    const n = Math.ceil(((stage + 1) / 10) * segs.length);
    for (const [x0, y0, x1, y1] of segs.slice(0, n)) {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let k = 0; k <= steps; k++)
        set(Math.round(x0 + ((x1 - x0) * k) / steps), Math.round(y0 + ((y1 - y0) * k) / steps), [20, 20, 20]);
    }
  }));
}

// a texture as an image for the HUD (hotbar, inventory): its key colour
// see-through, as it is in 3D
function keyedURL(c) {
  const out = document.createElement('canvas');
  out.width = c.width; out.height = c.height;
  const x = out.getContext('2d');
  x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4)
    if (d.data[i] === KEY[0] && d.data[i + 1] === KEY[1] && d.data[i + 2] === KEY[2]) d.data[i + 3] = 0;
  x.putImageData(d, 0, 0);
  return out.toDataURL();
}

/**
 * Draw every texture, upload it to the atlas and return
 * { slot: {name: tileIndex}, url: {name: dataURL} }.
 * wallTileCanvas: 16x16 canvas of the game's horizontal wall tile.
 */
export function buildTextures(renderer, meta, wallTileCanvas) {
  const px = wallTileCanvas.getContext('2d').getImageData(0, 0, S, S).data;
  const at = (x, y) => { const i = (y * S + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
  // mortar / brick / highlight sampled from the brick courses of the wall tile
  const canvases = {
    wallBrick: wallBrick(at(0, 8), at(0, 9), at(3, 9)),
    stone: stone(), dirt: dirt(), cobble: cobble(), brick: brick(),
    chestSide: chestSide(), chestFront: chestFront(), chestTop: chestTop(), puff: puff(),
    grassTop: grassTop(), grassSide: grassSide(), sand: sand(), starBlock: starBlock(), bombBlock: bombBlock(),
    logSide: logSide(), logTop: logTop(), leaves: leaves(),
    stoneBricks: stoneBricks(), ladder: ladder(), planks: plankBlock(), gateWood: gateWood(), roof: roof(),
    fire0: fire(0), fire1: fire(1), fire2: fire(2), fire3: fire(3),
    portal0: portal(0), portal1: portal(1), portal2: portal(2), portal3: portal(3),
    peach: peach(), peachTop: peachTop(), checker: checker(), skyPlat: skyPlat(), skyTop: skyTop(), pinkBrick: pinkBrick(),
    marble: marble(), quartz: quartz(), glass: glass(), hedge: hedge(), flower0: flower(0), flower1: flower(1), flower2: flower(2),
    logBark: logBark(), windowGlass: windowGlass(), leaves1: leaves(1), leaves2: leaves(2), fallLeaf0: fallLeaf(0), fallLeaf1: fallLeaf(1), weeds: weeds(false), weedsTop: weeds(true), weedsTuft: weedsTuft(),
    scales: scales(), archWall: archWall(), starRod0: starRod(false), starRod1: starRod(true),
    spark0: spark(0), spark1: spark(1), spark2: spark(2), spark3: spark(3),
    coneGreen: coneTree(false), coneRed: coneTree(true), pinkCloud: pinkCloud(),
  };
  cracks().forEach((c, i) => (canvases['crack' + i] = c));
  const slot = {}, url = {};
  TEX_NAMES.forEach((name, i) => {
    slot[name] = meta.count + 1 + i;
    renderer.setTile(slot[name], canvases[name]);
    url[name] = keyedURL(canvases[name]);
  });
  return { slot, url };
}

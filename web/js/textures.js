// Original Minecraft-style block textures, drawn in code (16x16) and written
// into free slots of the tile atlas after the game's own tiles:
//   meta.count + 0       player skin (see skin.js)
//   meta.count + 1 ...   the textures below
// Also: the lower-wall brick, built from the colours of the game's wall tile.

const S = 16;
const KEY = [71, 108, 108]; // atlas key colour = transparent on keyed quads

export const TEX_NAMES = ['wallBrick', 'stone', 'dirt', 'cobble', 'brick', 'chestSide', 'chestFront', 'chestTop', 'puff',
  // building blocks: grass, logs and leaves
  'grassTop', 'grassSide', 'logSide', 'logTop', 'leaves',
  // stone bricks and ladders; planks, gates, roof shingles
  'stoneBricks', 'ladder', 'planks', 'gateWood', 'roof',
  // hedge (the weeds' top), logs' bark (running along them), windows, weeds, more leaves
  'hedge', 'logBark', 'windowGlass', 'weeds', 'weedsTop', 'weedsTuft', 'leaves1', 'leaves2',
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

// a clipped hedge: dense dark leaves
function hedge() {
  const r = rng(127);
  return paint((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(x, y, shade([48, 112, 52], 0.7 + r() * 0.5));
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
    grassTop: grassTop(), grassSide: grassSide(), logSide: logSide(), logTop: logTop(), leaves: leaves(),
    stoneBricks: stoneBricks(), ladder: ladder(), planks: plankBlock(), gateWood: gateWood(), roof: roof(),
    hedge: hedge(), logBark: logBark(), windowGlass: windowGlass(), leaves1: leaves(1), leaves2: leaves(2),
    weeds: weeds(false), weedsTop: weeds(true), weedsTuft: weedsTuft(),
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

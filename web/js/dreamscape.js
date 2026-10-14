// Dreamscape: the client's part of Ascend's first level (the layout in
// web/assets/dreamland.json, written with the level by tools/dreamland_gen.py).
// The engine has the plain, the woods and the stairs; this builds, as blocks,
// the little wood house you start in (with its fireplace and chimney), the
// horse's paddock beside it, the stone castle tower in the woods, the woods
// themselves (Minecraft trees: log trunks, leaf canopies; a wall of tall
// weeds; fallen logs) and rocks on the plain, and marks the dirt path from the
// tower to the house's door.  (The shrubs on the plain are the game's own
// tree tiles.)
// All coordinates are map squares + the level's offset.

// Dreamland's levels by number (the engine has the same table, written by
// tools/dreamland_gen.py to dreamlnd.h: DREAM_LV_GLADE...); level 1 is the
// plain with the house; the layout's keys are these names
export const DL = { glade: 2, sky: 3, kirby: 4, palace: 5, fountain: 6, battle: 7 };

// blocks: [{x, y, z, type}] with x/z = map column/row and y = height
export function buildDreamscape(layout, [ox, oz]) {
  const out = new Map(); // "x,y,z" -> type
  const put = (x, y, z, type) => out.set(`${x + ox},${y},${z + oz}`, type);
  if (layout.house) buildHouse(layout.house, put);
  if (layout.pen) buildPen(layout.pen, put);
  for (const o of layout.oaks || []) buildOak(o, out, ox, oz);
  // fallen logs (lying along x or z, sometimes one on another), the wall of
  // weeds, the secret path's weeds (you walk right through them), rocks out
  // on the plain
  for (const [x, z, axis, n] of layout.logs || []) for (let y = 0; y < n; y++) put(x, y, z, axis === 'x' ? 'logX' : 'logZ');
  buildWeeds(layout.weeds, put);
  for (const [x, z] of (layout.secret && layout.secret.path) || []) { put(x, 0, z, 'fakeWeeds'); put(x, 1, z, 'fakeWeedsTop'); }
  for (const [x, z, h] of layout.rocks || []) for (let y = 0; y < h; y++) put(x, y, z, 'cobble');
  const t = layout.tower;
  if (!t) return listBlocks(out);
  const { x: x0, y: z0, w, d, h } = t;
  const x1 = x0 + w - 1, z1 = z0 + d - 1;
  const [dx, dz] = t.door;
  const edge = (x, z) => x === x0 || x === x1 || z === z0 || z === z1;
  const ladder = [x0 + 1, z0 + 1]; // inside, in the north-west corner
  // arrow slits: two blocks tall, in the middle of the other three walls, low and high up
  const slits = new Set([`${x0 + (w >> 1)},${z0}`, `${x0},${z0 + (d >> 1)}`, `${x1},${z0 + (d >> 1)}`]);
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      if (edge(x, z)) {
        // the walls, with a doorway two blocks high and the arrow slits
        for (let y = 0; y < h; y++) {
          if (x === dx && z === dz && y < 2) continue;
          if (slits.has(`${x},${z}`) && (y === 3 || y === 4 || (h > 10 && (y === h - 5 || y === h - 4)))) continue;
          put(x, y, z, 'stone');
        }
        // battlements: every other block along the top of the walls
        if ((x - x0 + z - z0) % 2 === 0) put(x, h, z, 'stone');
      } else if (x !== ladder[0] || z !== ladder[1]) {
        put(x, h - 1, z, 'stone'); // the roof, with a hole for the ladder
      }
    }
  for (let y = 0; y < h; y++) put(ladder[0], y, ladder[1], 'ladder');
  return listBlocks(out);
}

function listBlocks(out) {
  return [...out].map(([k, type]) => {
    const [x, y, z] = k.split(',').map(Number);
    return { x, y, z, type };
  });
}

// The little wood house: log corners, plank walls with glass windows, a doorway in
// the south wall, a plank ceiling, a gable roof of red shingles (sloped
// blocks, overhanging all round), a brick chimney in the west wall and a
// stone fireplace inside it.
function buildHouse(hs, put) {
  const { x: x0, y: z0, w, d } = hs, x1 = x0 + w - 1, z1 = z0 + d - 1;
  const [dx, dz] = hs.door;
  const WALL = 4; // walls 4 high (the top course sits under the eaves)
  const windows = new Set([`${x0 + 2},${z0}`, `${x0 + 4},${z0}`, `${x1},${z0 + 2}`, `${x0 + 1},${z1}`, `${x0 + 5},${z1}`]);
  const chimney = [x0, z0 + 2];
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
      const wall = x === x0 || x === x1 || z === z0 || z === z1;
      if (wall) {
        for (let y = 0; y < WALL; y++) {
          if (x === dx && z === dz && y < 2) continue; // the doorway
          put(x, y, z, windows.has(`${x},${z}`) && y === 1 ? 'window' : corner ? 'log' : 'planks');
        }
      } else put(x, WALL - 1, z, 'planks'); // the ceiling
    }
  // the roof: rows from the north eave to the south eave, one block higher
  // each row towards the ridge; the gable ends are filled in under it
  const rows = d + 2, mid = (rows - 1) / 2;
  for (let i = 0; i < rows; i++) {
    const z = z0 - 1 + i, y = WALL - 1 + Math.min(i, rows - 1 - i);
    const type = i < mid ? 'roofN' : i > mid ? 'roofS' : 'ridge';
    for (let x = x0 - 1; x <= x1 + 1; x++) put(x, y, z, type);
    if (z >= z0 && z <= z1) for (let yy = WALL; yy < y; yy++) { put(x0, yy, z, 'planks'); put(x1, yy, z, 'planks'); }
  }
  // the chimney: bricks from the hearth up past the ridge
  for (let y = 0; y < WALL + Math.ceil(mid) + 2; y++) put(chimney[0], y, chimney[1], 'brick');
  // the fireplace inside: stone sides and mantel round the fire
  const fx = x0 + 1, fz = chimney[1];
  for (const z of [fz - 1, fz + 1]) for (let y = 0; y < 2; y++) put(fx, y, z, 'cobble');
  put(fx, 2, fz, 'cobble');
  put(fx, 0, fz, 'fire');
}

// a Minecraft oak: a log trunk, two wide layers of leaves round its top, a
// narrower layer and a little plus of leaves on top; the outer corners are
// ragged, differently on every tree
function buildOak({ x, y: z, h }, out, ox, oz) {
  let seed = (x * 73856093) ^ (z * 19349663);
  const r = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const leaf = (lx, ly, lz) => { const k = `${lx + ox},${ly},${lz + oz}`; if (!out.has(k)) out.set(k, 'leaves'); };
  for (let y = 0; y < h; y++) out.set(`${x + ox},${y},${z + oz}`, 'log');
  for (const [y, rad] of [[h - 2, 2], [h - 1, 2], [h, 1], [h + 1, 1]])
    for (let dz = -rad; dz <= rad; dz++)
      for (let dx = -rad; dx <= rad; dx++) {
        const corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
        if (corner && (y === h + 1 || r() < 0.5)) continue; // ragged corners; a plus shape on top
        leaf(x + dx, y, z + dz);
      }
}

// a wall of tall weeds and grass, two blocks high, on these [x, z] squares
function buildWeeds(squares, put) {
  for (const [x, z] of squares || []) { put(x, 0, z, 'weeds'); put(x, 1, z, 'weedsTop'); }
}

// tree squares built as blocks (a Minecraft tree, a fallen log, weeds), whose
// flat tree tile isn't drawn: "x,z" squares.  key: the level's part of the
// layout ('glade', 'kirby', 'palace'), or none for level 1
export function dreamOaks(layout, [ox, oz], key = null) {
  const L = key ? layout[key] || {} : layout;
  const sq = [...(L.oaks || []).map((o) => [o.x, o.y]), ...(L.logs || []), ...(L.weeds || [])];
  return new Set(sq.map(([x, z]) => `${x + ox},${z + oz}`));
}

// level 1's shrubs (the game's tree tile, drawn small): "x,z" squares
export function dreamShrubs(layout, [ox, oz]) {
  return new Set((layout.shrubs || []).map(([x, z]) => `${x + ox},${z + oz}`));
}

// the horse's paddock: a fence all round, no gate; in the middle of the
// south side, a panel of two log blocks: break it to let the horse out
function buildPen(pen, put) {
  const { x: x0, y: z0, w, d } = pen, x1 = x0 + w - 1, z1 = z0 + d - 1;
  const wood = [x0 + (w >> 1), z1];
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      if (!(x === x0 || x === x1 || z === z0 || z === z1)) continue;
      if (x === wood[0] && z === wood[1]) { put(x, 0, z, 'log'); put(x, 1, z, 'log'); continue; }
      put(x, 0, z, 'fence');
    }
}

// where the fire burns and where its smoke leaves the chimney (game squares)
export function dreamFire(layout, [ox, oz]) {
  const hs = layout.house;
  if (!hs) return null;
  const rows = hs.d + 2;
  return {
    fires: [{ x: hs.x + 1 + ox, z: hs.y + 2 + oz }],
    smoke: { x: hs.x + ox, y: 4 + Math.ceil((rows - 1) / 2) + 2, z: hs.y + 2 + oz },
  };
}

// Dreamland's second level: a star block on each corner of the floating platform
export function buildLevel2(layout, [ox, oz]) {
  const p = layout.sky && layout.sky.platform;
  if (!p) return [];
  const x1 = p.x + p.w - 1, z1 = p.y + p.d - 1;
  return [[p.x, p.y], [x1, p.y], [p.x, z1], [x1, z1]].map(([x, z]) => ({ x: x + ox, y: 0, z: z + oz, type: 'star' }));
}

// Dreamland's third level, a Kirby-style grass field: peach pillars with
// rounded tops (a ladder up each, some with a pink brick ledge), checkered
// towers, floating sky platforms with ladders up, little grass mounds, and a
// hollow checkered tower in a far corner hiding the portal
export function buildLevel3(layout, [ox, oz]) {
  const L = layout.kirby;
  if (!L) return [];
  const out = new Map();
  const put = (x, y, z, type) => out.set(`${x + ox},${y},${z + oz}`, type);
  const ladder = (x, z, top) => { for (let y = 0; y < top; y++) put(x, y, z, 'ladder'); };
  for (const p of L.pillars) {
    for (let z = p.y; z < p.y + p.s; z++)
      for (let x = p.x; x < p.x + p.s; x++)
        for (let y = 0; y < p.h; y++) put(x, y, z, y === p.h - 1 ? 'peachTop' : 'peach');
    if (p.ladder === 's') ladder(p.x, p.y + p.s, p.h); else ladder(p.x + p.s, p.y, p.h);
    if (p.ledge) {
      // a pink brick ledge sticking out the other side, halfway up
      const y = p.h >> 1;
      for (let k = 1; k <= 2; k++)
        for (let i = 0; i < p.s; i++)
          if (p.ladder === 's') put(p.x + i, y, p.y - k, 'pinkBrick'); else put(p.x - k, y, p.y + i, 'pinkBrick');
    }
  }
  for (const t of L.towers) {
    for (let z = t.y; z < t.y + t.d; z++) for (let x = t.x; x < t.x + t.w; x++) for (let y = 0; y < t.h; y++) put(x, y, z, 'checker');
    ladder(t.x + t.w, t.y + (t.d >> 1), t.h);
  }
  for (const k of L.skies) {
    for (let z = k.y; z < k.y + k.d; z++) for (let x = k.x; x < k.x + k.w; x++) put(x, k.h, z, 'skyPlat');
    ladder(k.x - 1, k.y, k.h + 1);
  }
  for (const m of L.mounds)
    for (let dz = -m.r; dz <= m.r; dz++)
      for (let dx = -m.r; dx <= m.r; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > m.r + 0.3) continue;
        const top = Math.max(1, Math.ceil(m.h * (1 - d / (m.r + 1))));
        for (let y = 0; y < top; y++) put(m.x + dx, y, m.y + dz, y === top - 1 ? 'grass' : 'dirt');
      }
  // Kirby star-block walls, a bomb block in each (break it and they all go)
  for (const st of L.stars || [])
    for (let y = 0; y < st.h; y++)
      for (let x = st.x; x < st.x + st.w; x++) put(x, y, st.y, x === st.bomb[0] && y === st.bomb[1] ? 'bomb' : 'star');
  // the border woods: a wall of weeds
  buildWeeds(L.weeds, put);
  // the hidden portal's tower: hollow, roofed, one doorway (facing the woods)
  const v = L.vault, [dx, dz] = v.door;
  for (let z = v.y; z < v.y + v.d; z++)
    for (let x = v.x; x < v.x + v.w; x++) {
      const wall = x === v.x || x === v.x + v.w - 1 || z === v.y || z === v.y + v.d - 1;
      for (let y = 0; y < v.h; y++) {
        if (!wall && y < v.h - 1) continue;
        if (x === dx && z === dz && y < 2) continue;
        put(x, y, z, 'checker');
      }
    }
  return listBlocks(out);
}

// Dreamland's fourth level: the white marble palace in its gardens.  The
// temple in the middle (flat roof, no steeple; stained glass in the nave and
// the chancel and a clerestory above the wings; the altar and its water ring
// are the engine's), a west and an east wing with porches of quartz pillars,
// braziers either side of the altar, and four hedge mazes with archways.
export function buildLevel4(layout, [ox, oz]) {
  const L = layout.palace;
  if (!L) return [];
  const out = new Map();
  const put = (x, y, z, type) => out.set(`${x + ox},${y},${z + oz}`, type);
  const take = (x, y, z) => out.delete(`${x + ox},${y},${z + oz}`);
  buildWeeds(L.weeds, put); // the woods round the gardens: a wall of tall weeds
  const T = L.temple, tx1 = T.x + T.w - 1, tz1 = T.y + T.d - 1, az = L.altar[1];
  // a building: walls of marble h high, a flat roof, a cornice round the top
  const building = (b) => {
    const x1 = b.x + b.w - 1, z1 = b.y + b.d - 1;
    for (let z = b.y; z <= z1; z++)
      for (let x = b.x; x <= x1; x++) {
        const wall = x === b.x || x === x1 || z === b.y || z === z1;
        if (wall) { for (let y = 0; y <= b.h; y++) put(x, y, z, 'marble'); }
        else put(x, b.h - 1, z, 'marble');
      }
  };
  building(T);
  for (const wg of L.wings) building(wg);
  // the temple's way in (three wide) and its doorways into the wings
  for (let x = L.door[0] - 1; x <= L.door[0] + 1; x++) for (let y = 0; y < 3; y++) take(x, y, tz1);
  for (let y = 0; y < 3; y++) { take(T.x, y, az); take(tx1, y, az); }
  // stained glass: the chancel (north wall), the nave (south wall, either side
  // of the door), the clerestory above the wings, and low on the sides
  for (let x = T.x + 2; x <= tx1 - 2; x += 2) for (let y = 2; y <= 5; y++) put(x, y, T.y, 'glass');
  for (const dx of [-8, -5, 5, 8]) for (let y = 2; y <= 5; y++) put(L.door[0] + dx, y, tz1, 'glass');
  for (let z = T.y + 1; z < tz1; z += 2)
    for (const x of [T.x, tx1]) {
      for (let y = 6; y <= 7; y++) put(x, y, z, 'glass');
      const besideWing = L.wings.some((wg) => z >= wg.y && z < wg.y + wg.d);
      if (!besideWing && z !== az) for (let y = 2; y <= 4; y++) put(x, y, z, 'glass');
    }
  // the wings: a doorway into the temple, a door out to the porch, windows
  for (const wg of L.wings) {
    const x1 = wg.x + wg.w - 1, z1 = wg.y + wg.d - 1, mid = wg.x + (wg.w >> 1);
    const inner = wg.side === 'west' ? x1 : wg.x;
    for (let y = 0; y < 3; y++) take(inner, y, az);
    for (let x = mid - 1; x <= mid; x++) for (let y = 0; y < 2; y++) take(x, y, z1);
    for (let x = wg.x + 3; x < x1 - 1; x += 4) for (let y = 2; y <= 3; y++) { put(x, y, wg.y, 'glass'); if (Math.abs(x - mid) > 2) put(x, y, z1, 'glass'); }
    // the porch: a row of quartz pillars, a marble roof over it
    const pz = z1 + 2;
    for (let x = wg.x + 1; x < x1; x += 3) for (let y = 0; y < wg.h - 1; y++) put(x, y, pz, 'quartz');
    for (let z = z1 + 1; z <= pz; z++) for (let x = wg.x; x <= x1; x++) put(x, wg.h - 1, z, 'marble');
  }
  // the braziers: a marble pedestal, a flame on top (main.js draws the fire)
  for (const [x, z] of L.braziers) put(x, 0, z, 'marble');
  // the hedge mazes: three blocks tall (no seeing over them), a marble arch on
  // quartz pillars over each way in
  for (const [x, z] of L.hedges) for (let y = 0; y < 3; y++) put(x, y, z, 'hedge');
  for (const [x, z] of L.arches || []) {
    for (const dx of [-1, 1]) for (let y = 0; y < 4; y++) put(x + dx, y, z, 'quartz');
    for (let dx = -1; dx <= 1; dx++) put(x + dx, 4, z, 'marble');
  }
  return listBlocks(out);
}

// a level's flowers: [{x, z, k}] (k: which flower); key as for dreamOaks
export function dreamFlowers(layout, [ox, oz], key = null) {
  const L = key ? layout[key] || {} : layout;
  return (L.flowers || []).map(([x, z, k]) => ({ x: x + ox, z: z + oz, k }));
}

// level 4's extras: the floors (marble walks and the palace's floors), the
// flowers, the braziers' flames and where the altar's portal opens
export function palaceExtras(layout, [ox, oz]) {
  const L = layout.palace;
  if (!L) return null;
  const sq = (x, z) => `${x + ox},${z + oz}`;
  const paved = new Set(L.paving.map(([x, z]) => sq(x, z)));
  for (const b of [L.temple, ...L.wings])
    for (let z = b.y + 1; z < b.y + b.d - 1; z++) for (let x = b.x + 1; x < b.x + b.w - 1; x++) paved.add(sq(x, z));
  for (const wg of L.wings) // the porches
    for (let z = wg.y + wg.d; z <= wg.y + wg.d + 1; z++) for (let x = wg.x; x < wg.x + wg.w; x++) paved.add(sq(x, z));
  return {
    paved,
    flowers: L.flowers.map(([x, z, k]) => ({ x: x + ox, z: z + oz, k })),
    fires: L.braziers.map(([x, z]) => ({ x: x + ox, z: z + oz, y: 1 })),
    altar: { x: L.altar[0] + ox, z: L.altar[1] + oz },
  };
}

// the portal on top of the tower: its square and the roof's height
export function dreamPortal(layout, [ox, oz]) {
  const t = layout.tower;
  return t && t.portal ? { x: t.portal[0] + ox, z: t.portal[1] + oz, y: t.h } : null;
}

// level 3's portal, hidden on the floor inside its checkered tower
export function dreamPortal3(layout, [ox, oz]) {
  const L = layout.kirby;
  return L ? { x: L.portal[0] + ox, z: L.portal[1] + oz, y: 0 } : null;
}

// the floor inside the house and the tower: "x,z" squares (dungeon floor, not grass)
export function dreamIndoors(layout, [ox, oz]) {
  const out = new Set();
  for (const b of [layout.house, layout.tower])
    if (b) for (let z = b.y + 1; z < b.y + b.d - 1; z++) for (let x = b.x + 1; x < b.x + b.w - 1; x++) out.add(`${x + ox},${z + oz}`);
  return out;
}

// the dirt path from the tower's door to the house's: "x,z" squares
export function dreamPath(layout, [ox, oz]) {
  return new Set((layout.path || []).map(([x, z]) => `${x + ox},${z + oz}`));
}

// Dreamland level 5, the Fountain of Dreams: a round island floating in the
// night sky.  Returns { blocks, falls, rod, gushers, cones, center }:
//   blocks  the fountain (a marble basin, a quartz column, a wide bowl and a
//           narrow one), four lavender towers, star blocks
//   falls   iridescent water: sheets {a: [x, z], b: [x, z], top, bottom}
//           pouring from the bowls and off the island's edge into the sky,
//           and still surfaces {x0, z0, x1, z1, y} in the bowls and basin;
//           rising sheets (rise: true): the gushers' jets
//   rod     where the Star Rod stands on top of the fountain {x, z, y}
//   gushers where water leaps up out of the pool [{x, z, top}] (the client
//           sprays sparkles from their tops)
//   cones   little cone trees on the grass [{x, z, red}] (sprites)
//   center  the island's middle {x, z} (the pink clouds swirl round it)
export function buildLevel5(layout, [ox, oz]) {
  const L = layout.fountain;
  if (!L) return null;
  const out = new Map();
  const put = (x, y, z, type) => out.set(`${x + ox},${y},${z + oz}`, type);
  const F = L.fountain, cx = F.x, cz = F.y;
  const falls = [];
  const sheetsRound = (x0, z0, x1, z1, top, bottom, gap = 0.04) => { // all four sides of a box, just outside it
    falls.push({ a: [x0 + ox, z0 + oz - gap], b: [x1 + ox, z0 + oz - gap], top, bottom });
    falls.push({ a: [x0 + ox, z1 + oz + gap], b: [x1 + ox, z1 + oz + gap], top, bottom });
    falls.push({ a: [x0 + ox - gap, z0 + oz], b: [x0 + ox - gap, z1 + oz], top, bottom });
    falls.push({ a: [x1 + ox + gap, z0 + oz], b: [x1 + ox + gap, z1 + oz], top, bottom });
  };
  // the basin: a marble rim round the middle, iridescent water inside it
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) if (Math.max(Math.abs(dx), Math.abs(dz)) === 2) put(cx + dx, 0, cz + dz, 'marble');
  falls.push({ x0: cx - 1 + ox, z0: cz - 1 + oz, x1: cx + 2 + ox, z1: cz + 2 + oz, y: 0.8 });
  // the column, the wide bowl (spilling down into the basin), the narrow bowl
  // (spilling into the wide one)
  for (let y = 0; y < F.bowl; y++) put(cx, y, cz, 'quartz');
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) put(cx + dx, F.bowl, cz + dz, 'marble');
  falls.push({ x0: cx - 1 + ox, z0: cz - 1 + oz, x1: cx + 2 + ox, z1: cz + 2 + oz, y: F.bowl + 1.02 });
  sheetsRound(cx - 1, cz - 1, cx + 2, cz + 2, F.bowl + 1, 1);
  for (let y = F.bowl + 1; y < F.top - 1; y++) put(cx, y, cz, 'quartz');
  put(cx, F.top - 1, cz, 'marble');
  falls.push({ x0: cx + ox, z0: cz + oz, x1: cx + 1 + ox, z1: cz + 1 + oz, y: F.top + 0.02 });
  sheetsRound(cx, cz, cx + 1, cz + 1, F.top, F.bowl + 1);
  // the lavender towers: a quartz shaft, a scaled dome
  for (const t of L.towers) {
    for (let y = 0; y < t.h - 3; y++) put(t.x, y, t.y, 'quartz');
    const tz = t.y;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { put(t.x + dx, t.h - 3, tz + dz, 'scales'); put(t.x + dx, t.h - 2, tz + dz, 'scales'); }
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) put(t.x + dx, t.h - 1, tz + dz, 'scales');
    put(t.x, t.h, tz, 'star');
  }
  for (const [x, z, h] of L.stars) for (let y = 0; y < h; y++) put(x, y, z, 'star');
  // waterfalls over the island's edge, all round, down into the stars
  const isle = new Set(L.island.map(([x, z]) => `${x},${z}`));
  const off = (x, z) => !isle.has(`${x},${z}`);
  const E = 0.04, DROP = -18;
  for (const [x, z] of L.island) {
    if (off(x, z - 1)) falls.push({ a: [x + ox, z + oz - E], b: [x + 1 + ox, z + oz - E], top: 0.15, bottom: DROP });
    if (off(x, z + 1)) falls.push({ a: [x + ox, z + 1 + oz + E], b: [x + 1 + ox, z + 1 + oz + E], top: 0.15, bottom: DROP });
    if (off(x - 1, z)) falls.push({ a: [x + ox - E, z + oz], b: [x + ox - E, z + 1 + oz], top: 0.15, bottom: DROP });
    if (off(x + 1, z)) falls.push({ a: [x + 1 + ox + E, z + oz], b: [x + 1 + ox + E, z + 1 + oz], top: 0.15, bottom: DROP });
  }
  // the gushers: two crossed sheets of water leaping up out of the pool
  const JET = 4.4;
  const gushers = (L.gushers || []).map(([x, z]) => {
    falls.push({ a: [x + 0.1 + ox, z + 0.5 + oz], b: [x + 0.9 + ox, z + 0.5 + oz], top: JET, bottom: -0.1, rise: true });
    falls.push({ a: [x + 0.5 + ox, z + 0.1 + oz], b: [x + 0.5 + ox, z + 0.9 + oz], top: JET, bottom: -0.1, rise: true });
    return { x: x + ox, z: z + oz, top: JET };
  });
  const cones = (L.cones || []).map(([x, z, red]) => ({ x: x + ox, z: z + oz, red: !!red }));
  const [mx, mz] = L.center;
  return { blocks: listBlocks(out), falls, rod: { x: cx + ox, z: cz + oz, y: F.top + 0.05 }, gushers, cones,
    center: { x: mx + ox + 0.5, z: mz + oz + 0.5 } };
}

// Dreamland level 2, the forest glade: woods filling the map (Minecraft trees,
// a wall of weeds, fallen logs), fences round the centaurs' meadows (low:
// arrows fly over them) with a log panel to break in each, and the standing
// stones round the portal
export function buildGlade(layout, [ox, oz]) {
  const L = layout.glade;
  if (!L) return [];
  const out = new Map();
  const put = (x, y, z, type) => out.set(`${x + ox},${y},${z + oz}`, type);
  for (const o of L.oaks) buildOak(o, out, ox, oz);
  for (const [x, z, axis, n] of L.logs) for (let y = 0; y < n; y++) put(x, y, z, axis === 'x' ? 'logX' : 'logZ');
  buildWeeds(L.weeds, put);
  for (const [x, z] of L.fences) put(x, 0, z, 'fence');
  for (const [x, z] of L.panels) { put(x, 0, z, 'log'); put(x, 1, z, 'log'); }
  for (const [x, y, z] of L.henge) put(x, y, z, 'henge');
  return listBlocks(out);
}

// ...its dirt path, and the portal among the stones
export function gladeExtras(layout, [ox, oz]) {
  const L = layout.glade;
  if (!L) return null;
  return {
    path: new Set(L.path.map(([x, z]) => `${x + ox},${z + oz}`)),
    portal: { x: L.portal[0] + ox, z: L.portal[1] + oz, y: 0 },
  };
}

// Map symbols (cmap indices from include/rm.h) -> 3D block types.
// Defaults are NetHack 3.6.7's numbering; the engine sends its own table in
// the "hello" message (SLASH'EM numbers them differently), see setCmap().

// brick dungeon levels: rooms and corridors are platforms of 4x4-stud squares,
// walls six bricks (1.8 blocks: 2 for walking and the camera) and doors real
// 1x4x6 brick doors, as tall as the wall.
export const WALL_H = 2; // wall height in blocks (open air above for building)
export const DOOR_H = 2; // doors and doorways

export const CM = {
  stone: 0, vwall: 1, hwall: 2, tlcorn: 3, trcorn: 4, blcorn: 5, brcorn: 6, crwall: 7,
  tuwall: 8, tdwall: 9, tlwall: 10, trwall: 11, ndoor: 12, vodoor: 13, hodoor: 14,
  vcdoor: 15, hcdoor: 16, bars: 17, tree: 18, room: 19, darkroom: 20, corr: 21,
  litcorr: 22, upstair: 23, dnstair: 24, upladder: 25, dnladder: 26, altar: 27,
  grave: 28, throne: 29, sink: 30, fountain: 31, pool: 32, ice: 33, lava: 34,
  vodbridge: 35, hodbridge: 36, vcdbridge: 37, hcdbridge: 38, air: 39, cloud: 40,
  water: 41, web: 59,
};

// cmap index -> atlas tile. Until the engine sends its table, assume the map
// symbols start at the first tile of other.txt (see setCmapBase).
let CMAP_TILES = null;
let CMAP_BASE = 850;
export const cmapTile = (c) => (CMAP_TILES ? CMAP_TILES[c] : CMAP_BASE + c);
export function setCmapBase(meta) {
  const i = (meta.names || []).findIndex((n) => /^(unexplored area|dark part of a room)$/.test(n));
  if (i >= 0) CMAP_BASE = i;
  CMAP_TILES = null;
}
export const wallTile = () => cmapTile(CM.hwall); // brick
const roomTile = () => cmapTile(CM.room);

export function setCmap(cm, tiles) {
  for (const k of Object.keys(CM)) delete CM[k];
  Object.assign(CM, cm);
  if (CM.toilet == null) CM.toilet = -1;
  CMAP_TILES = tiles;
}

const isWall = (c) => (c >= CM.vwall && c <= CM.trwall) || c === CM.vcdbridge || c === CM.hcdbridge;
// altar, throne, sink, fountain (and SLASH'EM's toilet) stand up as sprites
const isFeature = (c) => [CM.altar, CM.throne, CM.sink, CM.fountain, CM.toilet].includes(c);
const isLiquid = (c) => c === CM.pool || c === CM.lava || c === CM.water;
const isCorr = (c) => c === CM.corr || c === CM.litcorr;
// a corridor square, even with a monster/object standing on it
const isCorrCell = (n) => isCorr(n.k === 'c' ? n.c : n.bc);

// Work out what to draw at (x, y).  `cell` = {t, k, c, bt, bc}
//   t/k/c: foreground tile, kind, cmap index;  bt/bc: background tile/cmap
// floorMem keeps the last known floor cmap for cells that are now covered.
export function classify(world, x, y) {
  const c = classifyCell(world, x, y);
  // chests and large boxes are drawn as chest blocks on top of the floor
  if (c && c.type !== 'wall' && c.type !== 'rock') {
    const cell = world.cell(x, y);
    if (cell && cell.k === 'C') c.chest = true;
  }
  return c;
}

function classifyCell(world, x, y) {
  const cell = world.cell(x, y);
  if (!cell || (cell.k === 'c' && cell.c === CM.stone)) {
    // a blank square. If it's in sight now (or ever was), or we've stood beside
    // it, it's rock: no way on there (on brick levels: wall). Otherwise nobody
    // knows yet (fog), though next to a known corridor it still counts as
    // solid (the camera and the block world treat it so)
    const i = y * world.w + x;
    if (world.solidSeen && (world.solidSeen.has(i) || (world.vis && world.visible(x, y)) || world.besideHero.has(i))) {
      world.solidSeen.add(i);
      return { type: 'rock', seen: true, known: true };
    }
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = world.cell(x + dx, y + dy);
        if (n && isCorrCell(n)) return { type: 'rock', seen: false };
      }
    return null;
  }
  let cm = cell.k === 'c' || cell.k === 't' ? cell.c : cell.bc;
  let decal = null, sprite = null;
  if (cell.k === 't') {
    decal = cell.t;
    cm = cell.bc >= 0 ? cell.bc : world.floorMem[y * world.w + x] ?? CM.room;
    if (cell.c === CM.web) { decal = null; sprite = { tile: cell.t, size: 1 }; }
  }
  if (cm < 0 || cm === undefined) {
    // monster/object over unknown floor: use what we remembered, else room floor
    cm = world.floorMem[y * world.w + x];
    if (cm == null) cm = cell.k === ' ' ? CM.stone : CM.room;
  }
  if (cm !== CM.stone && !isWall(cm)) world.floorMem[y * world.w + x] = cm;
  const seen = world.visible(x, y);
  const tile = cmapTile(cm);

  if (cm === CM.stone) return { type: 'none' };
  if (isWall(cm)) return { type: 'wall', tile, seen, cmap: cm };
  if (cm === CM.vcdoor || cm === CM.hcdoor) return { type: 'door', tile, seen, cmap: cm };
  if (cm === CM.vodoor || cm === CM.hodoor)
    return { type: 'odoor', tile, floorTile: cmapTile(CM.ndoor), seen, cmap: cm, lintel: true, decal };
  if (cm === CM.ndoor) return { type: 'floor', tile, seen, cmap: cm, lintel: true, decal };
  if (isLiquid(cm)) return { type: 'liquid', tile, seen, cmap: cm };
  if (cm === CM.air) return { type: 'none', cmap: cm }; // (open air)
  if (cm === CM.tree) return { type: 'floor', tile: roomTile(), seen, cmap: cm, sprite: { tile, size: 1.6 } };
  if (cm === CM.bars) return { type: 'floor', tile: roomTile(), seen, cmap: cm, sprite: { tile, size: 1.4 } };
  if (cm === CM.cloud) return { type: 'floor', tile: roomTile(), seen, cmap: cm, sprite: { tile, size: 1 } };
  if (isFeature(cm)) return { type: 'floor', tile: roomTile(), seen, cmap: cm, sprite: { tile, size: 0.9 }, decal };
  return { type: 'floor', tile, seen, cmap: cm, decal, sprite };
}

export const isSolidClass = (c) => c && (c.type === 'wall' || c.type === 'rock' || c.type === 'door');

// Placed blocks (per dungeon level) and the block inventory, saved on the
// server per character (/api/world). The engine is told which squares have
// blocks low enough to stop monsters ("B x y n").

export const BLOCKS = {
  brick: { name: 'Bricks', tex: 'brick', hard: true },
  dirt: { name: 'Dirt', tex: 'dirt', hard: false },
  cobble: { name: 'Cobblestone', tex: 'cobble', hard: true },
  // Dreamland blocks
  grass: { name: 'Grass Block', tex: 'grassSide', hard: false },
  sand: { name: 'Peanut Sand', tex: 'sand', hard: false },
  star: { name: 'Star Block', tex: 'starBlock', hard: false },
  bomb: { name: 'Bomb Block', tex: 'bombBlock', hard: false },
  log: { name: 'Log', tex: 'logSide', hard: false },
  leaves: { name: 'Leaves', tex: 'leaves', hard: false },
  stone: { name: 'Stone Bricks', tex: 'stoneBricks', hard: true },
  planks: { name: 'Planks', tex: 'planks', hard: false },
  window: { name: 'Glass', tex: 'windowGlass', hard: false },
  weeds: { name: 'Tall Grass', tex: 'weeds', hard: false },
  // Dreamland level 5
  scales: { name: 'Dream Tiles', tex: 'scales', hard: true },
  // Dreamland level 3
  peach: { name: 'Peach Block', tex: 'peach', hard: false },
  peachTop: { name: 'Peach Cap', tex: 'peachTop', hard: false },
  checker: { name: 'Checker Block', tex: 'checker', hard: true },
  skyPlat: { name: 'Sky Block', tex: 'skyPlat', hard: false },
  pinkBrick: { name: 'Pink Bricks', tex: 'pinkBrick', hard: true },
  // Dreamland level 4
  marble: { name: 'Marble', tex: 'marble', hard: true },
  quartz: { name: 'Quartz Pillar', tex: 'quartz', hard: true },
  glass: { name: 'Stained Glass', tex: 'glass', hard: false },
  hedge: { name: 'Hedge', tex: 'hedge', hard: false },
};
// scenery blocks that are another block when mined: fallen logs, the tops of
// the weeds, the secret path's weeds
const MINES_AS = { logX: 'log', logZ: 'log', weedsTop: 'weeds', fakeWeeds: 'weeds', fakeWeedsTop: 'weeds' };
export const minedAs = (type) => MINES_AS[type] || type;
export const START_BLOCKS = {}; // nothing to start with: every block you build with is one you mined
export const BUILD_LIMIT = 16;
const MONSTER_BLOCKING = 2; // blocks at heights 0..1 stop monsters walking through
const PASSABLE = new Set(['gateOpen', 'fakeWeeds', 'fakeWeedsTop']); // ...except these

// how long a block takes to break, in ms (Minecraft-ish: dirt is quick, stone needs a pick)
export function breakTime(type, hasPick) {
  type = minedAs(type);
  if (!BLOCKS[type]) return Infinity; // ladders stay put
  if (!BLOCKS[type].hard) return hasPick ? 300 : 500;
  return hasPick ? 600 : 2500;
}

const key = (x, y, z) => `${x},${y},${z}`; // x = column, y = height, z = row

export class BlockWorld {
  constructor(post) {
    this.post = post; // send a line to the engine
    this.levels = {};
    this.inv = { ...START_BLOCKS };
    this.levelKey = null;
    this.map = new Map();
    this.ident = null;
    this.saveTimer = 0;
    this.version = 0; // bumped on every change (the renderer caches block meshes)
    // generated levels (Dreamland): the scenery is rebuilt from its layout each
    // time; only the player's changes to it are saved, as a diff ('-' = removed)
    this.based = {}; // levelKey -> true for levels saved as a diff
    this.base = null; // the generated blocks of the current level, once known
  }

  async load(variant, name) {
    this.ident = { variant, name };
    let data = {};
    try { data = await (await fetch(`/api/world?variant=${variant}&name=${encodeURIComponent(name)}`)).json(); } catch {}
    this.levels = data.levels || {};
    this.based = data.based || {};
    this.inv = data.inv || { ...START_BLOCKS };
    this.levelKey = null;
    this.map = new Map();
    this.base = null;
  }

  // what gets saved for the current level
  snapshot() {
    if (!this.based[this.levelKey]) return Object.fromEntries(this.map);
    if (!this.base) return this.levels[this.levelKey] || {}; // scenery not built yet: keep the old diff
    const diff = {};
    for (const [k, t] of this.map) if (this.base.get(k) !== t) diff[k] = t;
    for (const k of this.base.keys()) if (!this.map.has(k)) diff[k] = '-';
    return diff;
  }

  // the generated scenery of the current level; saved changes go on top
  setBase(list) {
    this.base = new Map(list.map((b) => [key(b.x, b.y, b.z), b.type]));
    const diff = this.based[this.levelKey] ? this.levels[this.levelKey] || {} : Object.fromEntries(this.map);
    this.based[this.levelKey] = true;
    this.map = new Map(this.base);
    for (const [k, t] of Object.entries(diff)) if (t === '-') this.map.delete(k); else this.map.set(k, t);
    this.version++;
    this.syncEngine();
    this.save();
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      if (!this.ident) return;
      if (this.levelKey) this.levels[this.levelKey] = this.snapshot();
      const { variant, name } = this.ident;
      fetch(`/api/world?variant=${variant}&name=${encodeURIComponent(name)}`, {
        method: 'POST', body: JSON.stringify({ inv: this.inv, levels: this.levels, based: this.based }),
      }).catch(() => {});
    }, 500);
  }

  // switch to the blocks of another dungeon level and tell the engine
  enterLevel(levelKey) {
    if (levelKey === this.levelKey) return false;
    if (this.levelKey) this.levels[this.levelKey] = this.snapshot();
    this.levelKey = levelKey;
    this.base = null;
    this.version++;
    // a generated level shows nothing until its scenery is rebuilt (setBase)
    this.map = this.based[levelKey] ? new Map() : new Map(Object.entries(this.levels[levelKey] || {}));
    this.syncEngine();
    return true;
  }

  syncEngine() {
    const lines = ['BC'];
    const cols = new Set();
    for (const [k, t] of this.map) {
      const [x, y, z] = k.split(',').map(Number);
      if (y < MONSTER_BLOCKING && !PASSABLE.has(t)) cols.add(`${x} ${z}`);
    }
    for (const c of cols) lines.push(`B ${c} 1`);
    this.post(lines.join('\n'));
  }

  get(x, y, z) {
    return this.map.get(key(x, y, z));
  }

  columnBlocked(x, z) {
    for (let y = 0; y < MONSTER_BLOCKING; y++) {
      const t = this.map.get(key(x, y, z));
      if (t && !PASSABLE.has(t)) return true;
    }
    return false;
  }

  hasColumn(x, z) {
    for (let y = 0; y < BUILD_LIMIT; y++) if (this.map.has(key(x, y, z))) return true;
    return false;
  }

  place(x, y, z, type) {
    if (!this.inv[type] || this.map.has(key(x, y, z))) return false;
    this.inv[type]--;
    this.map.set(key(x, y, z), type);
    this.version++;
    if (y < MONSTER_BLOCKING) this.post(`B ${x} ${z} 1`);
    this.save();
    return true;
  }

  // turn a block into another kind in place (opening and closing a gate)
  swap(x, y, z, type) {
    if (!this.map.has(key(x, y, z))) return false;
    this.map.set(key(x, y, z), type);
    this.version++;
    if (y < MONSTER_BLOCKING) this.post(`B ${x} ${z} ${this.columnBlocked(x, z) ? 1 : 0}`);
    this.save();
    return true;
  }

  remove(x, y, z) {
    const type = this.map.get(key(x, y, z));
    if (!type) return null;
    this.map.delete(key(x, y, z));
    this.version++;
    if (y < MONSTER_BLOCKING) this.post(`B ${x} ${z} ${this.columnBlocked(x, z) ? 1 : 0}`);
    this.save();
    return type;
  }

  // a mined block picked up off the ground (main.js drops)
  give(type, n = 1) {
    this.inv[type] = (this.inv[type] || 0) + n;
    this.save();
  }

  *all() {
    for (const [k, type] of this.map) {
      const [x, y, z] = k.split(',').map(Number);
      yield { x, y, z, type };
    }
  }
}

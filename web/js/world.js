// Client-side copy of the NetHack map as reported by the window port.
import { classify, isSolidClass, WALL_H, DOOR_H, CM, TRAP_ITEMS } from './terrain.js';

const WALK_THROUGH = new Set(['gateOpen']);
import { posAt as motionPos, sizeHeight } from './motion.js';
import { mobAnim } from './anim.js';
import { brickItemForTile, gameTile, brickBuilt } from './brickitems.js';

// a trap's brick model (terrain.js TRAP_ITEMS: items.built.json), if it's been made: for the class of a square
const trapBuilt = (cl) => (cl && cl.trap != null && TRAP_ITEMS[cl.trap] && brickBuilt(TRAP_ITEMS[cl.trap])) || null;

// a square's own random number, 0..1, the same every time (a tree's kind, its turn)
const sqHash = (x, y) => { const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return h - Math.floor(h); };

export class World {
  constructor() {
    // SLASH'EM's map is COLNO x ROWNO (BrickHack: 120 x 64);
    // 'vis' messages carry the real size
    this.w = 120;
    this.h = 64;
    this.reset();
  }

  resize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.reset();
  }

  reset() {
    this.cells = new Array(this.w * this.h).fill(null);
    this.floorMem = new Array(this.w * this.h).fill(null);
    this.trapMem = new Map(); // square -> the kind of trap seen there (terrain.js classify)
    this.solidSeen = new Set(); // squares of rock we've seen (or stood beside): known not to lead anywhere
    this.besideHero = new Set(); // squares we've stood next to
    this.piles = new Map(); // square -> the tiles of everything lying there, top first (as last seen)
    this.vis = null;
    this.classes = [];
    this.hero = { x: 0, y: 0 };
    this.dirty = true;
  }

  cell(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.cells[y * this.w + x];
  }

  visible(x, y) {
    return !this.vis || this.vis[y * this.w + x] === '1';
  }

  applyMap(list) {
    for (const [x, y, t, k, c, bt, bc, a, h] of list) this.cells[y * this.w + x] = { t, k, c, bt, bc, a, h }; // (a: an altar's alignment, -1/0/1/-128; 2 none; h: a high altar)
    this.dirty = true;
  }

  // what lies on each square, from the engine ([[x, y, [tile, ...]]]; [] : nothing now)
  applyPiles(list) {
    for (const [x, y, tiles] of list) {
      if (tiles.length) this.piles.set(y * this.w + x, tiles);
      else this.piles.delete(y * this.w + x);
    }
  }

  setVis(v, w, h, lit) {
    if (w && h) this.resize(w, h);
    this.vis = v;
    this.lit = lit || null; // (each square: a room's floor, lit 'l' or dark 'd'; '0' not a room's: render.js, a dark room dark)
    this.dirty = true;
  }
  litAt(x, y) { return this.lit ? this.lit[y * this.w + x] || '0' : '0'; }

  // which way iron bars at (x, y) run: along x (0) if there's wall or more bars east or west of them, else along z
  barsTurn(x, y) {
    const along = (dx) => { const n = this.classes[y * this.w + x + dx]; return n && (n.type === 'wall' || n.type === 'rock' || n.cmap === CM.bars); };
    return along(-1) || along(1) ? 0 : Math.PI / 2;
  }

  setHero(x, y) {
    if (x !== this.hero.x || y !== this.hero.y) this.dirty = true;
    this.hero = { x, y };
    // you always see the squares beside you: any of them still blank is rock
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < this.w && yy < this.h) this.besideHero.add(yy * this.w + xx);
      }
  }

  // which way a sink or a toilet at (x, y) turns (radians about Y) for its back (a model's back is -Z) to be against a
  // wall beside it: the first wall found, north, east, south, west; none, as it is
  // (with walls beside it on more than one side: its back to the one across from open floor, so it faces out into
  // the room: an altar's front, where you stand, never against a wall: winweb.c web_altar_ok)
  backToWall(x, y) {
    const wall = (n) => n && (n.type === 'wall' || (n.type === 'rock' && n.known));
    let first = null;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      if (!wall(this.classAt(x + dx, y + dy))) continue;
      const t = Math.atan2(-dx, -dy);
      if (!wall(this.classAt(x - dx, y - dy))) return t;
      if (first === null) first = t;
    }
    return first ?? 0;
  }

  rebuild() {
    this.classes = new Array(this.w * this.h);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) this.classes[y * this.w + x] = classify(this, x, y);
  }

  classAt(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.classes[y * this.w + x];
  }

  solid(x, y) {
    return isSolidClass(this.classAt(x, y));
  }

  // everything drawn as a camera-facing sprite.  Monsters the engine
  // identified (motion.mobs) are drawn at their animated positions; the
  // hero at its animated position; everything else at its square.
  sprites(includeHero, motion, now, fx = null) {
    const out = [];
    this.brickDrops = []; // items lying on the floor as brick models (the brick dungeon): [{x, z, url}]
    this.bridges = []; // the drawbridges: [{gx, gz (its gate, in the wall), sx, sz (its span, over the moat), down (lowered)}] (brickworld setBridges)
    const bob = (x, y) => Math.sin(now / 400 + x * 1.7 + y * 2.3) * 0.06;
    const drawn = new Set(); // (monsters drawn: each once, the map and the monsters' list out of step or not)
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = this.cells[y * this.w + x];
        const cl = this.classes[y * this.w + x];
        if (!c) continue;
        const seen = this.visible(x, y);
        const shade = seen ? 1 : 0.5;
        // (a fountain, a sink, a toilet stands in brick (items.json), first on its square, all else on it; else its
        // sprite. A sink, a toilet: its back to a wall beside it, if there's one: turn)
        const furn = !cl ? null : cl.cmap === CM.fountain ? 'fountain' : cl.cmap === CM.sink ? 'sink' : cl.cmap === CM.toilet && CM.toilet >= 0 ? 'toilet'
          : cl.cmap === CM.altar ? 'altar' : cl.cmap === CM.throne ? 'throne' : cl.cmap === CM.grave ? 'grave' : cl.cmap === CM.bars ? 'iron bars'
          : cl.cmap === CM.tree ? 'tree' : null;
        // (an altar: the one of its alignment, its stone and trim: lawful white and gold, neutral grey, chaotic black and
        // dark red, Moloch's black and red; a lawful one, to a follower of Jesus: his, the cross on it)
        // (a high altar, the Astral Plane's or the Sanctum's: its kind's, grander; his, though, is his)
        const model = furn === 'altar' ? 'altar_' + (c.a === 1 && this.faith ? 'jesus'
            : (c.h ? 'high_' : '') + ({ 1: 'lawful', 0: 'neutral', [-1]: 'chaotic' }[c.a] || (c.a === -128 ? 'unaligned' : 'neutral')))
          : furn === 'tree' ? (sqHash(x, y) < 0.5 ? 'tree' : 'tree_pine') : furn; // (a tree: the round one or the pine, each square its own)
        const fountain = model && brickBuilt(model);
        if (fountain) this.brickDrops.push({ x, z: y, url: fountain.url, level: 0, upright: true, name: furn, colliders: fountain.colliders, perch: fountain.perch, offer: fountain.offer, anchored: fountain.anchored, spots: fountain.spots, item: model,
          turn: furn === 'fountain' ? 0 : furn === 'tree' ? sqHash(y, x) * Math.PI * 2 : furn === 'iron bars' ? this.barsTurn(x, y) : this.backToWall(x, y) });
        else if (cl && cl.sprite && !trapBuilt(cl)) out.push({ x, z: y, tile: cl.sprite.tile, size: cl.sprite.size, shade }); // (a web: in brick, if it's been made)
        // (a trap, in brick (terrain.js TRAP_ITEMS): square to its square; a pit, a hole, its shaft down where its floor isn't, render.js)
        const trapB = trapBuilt(cl);
        if (trapB) this.brickDrops.push({ x, z: y, url: trapB.url, level: 0, upright: true, name: TRAP_ITEMS[cl.trap], sunk: !!trapB.sunk, trap: cl.trap });
        // (a drawbridge: lowered, its span over the moat shows it, the gate the wall square beside it; raised, the gate shows it,
        // its span the water beside it)
        if (cl && (cl.cmap === CM.vodbridge || cl.cmap === CM.hodbridge || cl.cmap === CM.vcdbridge || cl.cmap === CM.hcdbridge)) {
          const down = cl.cmap === CM.vodbridge || cl.cmap === CM.hodbridge, ns = [[1, 0], [-1, 0], [0, 1], [0, -1]];
          const at = (dx, dz) => this.classes[(y + dz) * this.w + x + dx];
          const pick = down ? ns.find(([dx, dz]) => { const n = at(dx, dz); return n && (n.type === 'wall' || n.type === 'door' || n.type === 'odoor' || n.cmap === CM.ndoor); })
            : ns.find(([dx, dz]) => { const n = at(dx, dz); return n && n.type === 'liquid'; });
          if (pick) this.bridges.push(down ? { gx: x + pick[0], gz: y + pick[1], sx: x, sz: y, down } : { gx: x, gz: y, sx: x + pick[0], sz: y + pick[1], down });
        }
        const isHero = x === this.hero.x && y === this.hero.y;
        // the brick dungeon: everything lying here as brick models, the bottom one first, each
        // on the one below (brickworld.js stacks them), even under you or a monster
        const pile = this.piles.get(y * this.w + x) || (c.k === 'o' || c.k === 'C' ? [c.t] : null); // (a chest, a box: winweb.c's 'C', its own model, its lid on its hinge)
        if (pile) {
          let level = fountain ? 1 : 0;
          for (let i = pile.length - 1; i >= 0; i--) {
            const brick = brickItemForTile(pile[i]);
            if (brick) this.brickDrops.push({ x, z: y, url: brick.url, level: level++, upright: !!brick.upright, name: brick.name, colliders: brick.colliders });
          }
        }
        switch (c.k) {
          case 'm': case 'p': case 'i': case 'W': {
            if (isHero) break; // drawn below
            const mob = motion.mobAt(x, y) || motion.mobNear(x, y, (cx, cz) => { const n = this.cells[cz * this.w + cx]; return !n || !'mpiW'.includes(n.k); });
            if (mob && drawn.has(mob.id)) break; // (drawn already, from the square it's really on)
            if (mob) {
              drawn.add(mob.id);
              let [mx, mz] = motionPos(mob, now);
              const h = sizeHeight(mob.size);
              let lift = mob.fly ? 0.5 + bob(x, y) * 2 : 0, sh = shade;
              const off = fx && fx.mobOffset(mob, now); // hit / dodge / lunge reaction
              if (off) { mx += off.dx; mz += off.dz; lift += off.dy; if (off.flash) sh = 2.4; }
              const an = mobAnim(mob, now, this.camYaw || 0); // waddle or flap
              lift += this.standHeight(mob.tx, mob.tz); // up on a tower or a pillar
              out.push({ x: mx, z: mz, tile: c.t, size: h, lift: lift + an.dy, shade: sh, mon: true,
                tilt: an.tilt, sx: an.sx, sy: an.sy, flip: an.flip, mob });
            } else {
              out.push({ x, z: y, tile: c.t, size: c.k === 'i' ? 1 : 2, shade, mon: true });
            }
            break;
          }
          case 's':
            out.push({ x, z: y, tile: c.t, size: 2, shade, gray: true });
            break;
          case 'o': { // dropped items float and bob like Minecraft item drops (those made in brick lie on the floor: above)
            // (a pile: the top thing not yet made in brick floats over it)
            const t = pile ? pile.find((tt) => !brickItemForTile(tt)) : c.t;
            if (t != null) out.push({ x, z: y, tile: gameTile(t), size: 0.55, lift: 0.18 + bob(x, y) + (pile && pile.length > 1 ? 0.15 : 0), shade });
            break;
          }
          case 'z': case 'x': case 'w': case 'e': // zaps, explosions, engulfing, other effects
            out.push({ x, z: y, tile: c.t, size: 1.4, lift: 0.3, shade: 1.3 });
            break;
        }
      }
    // (brick levels: monsters and items at the minifig's scale)
    const k = this.spriteScale || 1;
    if (k !== 1) for (const s of out) s.size *= k;
    if (includeHero) {
      const c = this.cell(this.hero.x, this.hero.y);
      const tile = this.heroTile != null ? this.heroTile : c && c.t;
      if (tile != null) {
        const [hx, hz] = motion.heroPos(now);
        out.push({ x: hx, z: hz, tile, size: motion.heroHeight(), lift: this.heroLift || 0, shade: 1, hero: true });
      }
    }
    return out;
  }

  // ---- voxels: x = map column, y = height in blocks, z = map row --------
  // roof: treat unexplored squares as solid rock (only when walking on top of walls)
  // pick: for aiming (an open gate can be clicked; a fence is only its own block)
  solidVoxel(x, y, z, roof = false, pick = false) {
    if (y < 0) {
      return true; // bedrock under everything
    }
    const b = this.blocks && this.blocks.get(x, y, z);
    if (b) return b !== 'ladder' && (pick || !WALK_THROUGH.has(b)); // ladders are climbed, open gates walked through
    if (!pick && y === 1 && this.blocks) {
      const below = this.blocks.get(x, 0, z);
      if (below === 'fence' || below === 'gate') return true; // fences are too tall to jump
    }
    if (y >= WALL_H) return false;
    const c = this.classAt(x, z);
    if (!c) return roof;
    if (c.type === 'wall' || c.type === 'rock' || c.type === 'door') return true;
    return !!c.lintel && y >= DOOR_H;
  }

  // a square of the haze over the unexplored (brick dungeon levels; render.js
  // draws it there): nothing known, or rock nobody has seen
  isHaze(x, z) {
    if (x < 0 || z < 0 || x >= this.w || z >= this.h) return false;
    const c = this.classAt(x, z);
    return !c || (c.type === 'none' && c.cmap !== CM.air) || (c.type === 'rock' && !c.known);
  }

  isWater(x, z) {
    const c = this.classAt(x, z);
    return !!c && c.type === 'liquid';
  }

  // how high a monster on (x, z) stands: on top of the blocks stacked there
  // from the ground (a pillar, a tower), else on the ground
  standHeight(x, z) {
    if (!this.blocks) return 0;
    let y = 0;
    while (y < 32 && this.solidVoxel(x, y, z)) y++;
    return y;
  }

  isLadder(x, y, z) {
    return !!this.blocks && this.blocks.get(x, y, z) === 'ladder';
  }

  // top of the ladder in column (x, z) (0: none)
  ladderTop(x, z) {
    if (!this.blocks) return 0;
    for (let y = 15; y >= 0; y--) if (this.isLadder(x, y, z)) return y + 1;
    return 0;
  }

  // height of the surface the hero would stand on in column (x, z) from height `fromY`
  // (a ladder's rungs hold you at any height)
  groundAt(x, z, fromY, roof = false) {
    for (let y = Math.floor(fromY + 0.05) - 1; y >= -2; y--)
      if (this.solidVoxel(x, y, z, roof) || this.isLadder(x, y, z)) return y + 1;
    return 0;
  }

  // where the hero ends up stepping from height `curY` into column (x, z):
  // the highest surface reachable with a jump (+1.25) that has 2 blocks of headroom
  // (a ladder: its top, from below)
  landingAt(x, z, curY, roof = false) {
    const lt = this.ladderTop(x, z);
    if (lt && curY < lt - 0.05 && !this.solidVoxel(x, lt, z, roof) && !this.solidVoxel(x, lt + 1, z, roof)) return lt;
    for (let h = Math.floor(curY + 1.25); h >= 0; h--) {
      if (!this.solidVoxel(x, h - 1, z, roof) && !this.isLadder(x, h - 1, z)) continue;
      if (this.solidVoxel(x, h, z, roof) || this.solidVoxel(x, h + 1, z, roof)) return null; // wall in the way
      return h;
    }
    return null;
  }

  // Amanatides-Woo voxel traversal. Returns {x, y, z, prev:[x,y,z], t} or null.
  raycastVoxel(o, d, maxDist, roof = false) {
    let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);
    const step = d.map((v) => (v > 0 ? 1 : -1));
    const tDelta = d.map((v) => (v !== 0 ? Math.abs(1 / v) : Infinity));
    const tMax = [0, 1, 2].map((i) => {
      const p = o[i], v = d[i];
      if (v === 0) return Infinity;
      const b = v > 0 ? Math.floor(p) + 1 : Math.floor(p);
      return (b - p) / v;
    });
    let prev = [x, y, z], t = 0;
    for (let i = 0; i < 256 && t <= maxDist; i++) {
      const inMap = x >= 0 && z >= 0 && x < this.w && z < this.h;
      if (inMap && this.solidVoxel(x, y, z, roof, true) && !(y < 0 && !this.classAt(x, z))) return { x, y, z, prev, t };
      if (y < -1) return null;
      prev = [x, y, z];
      const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
      t = tMax[a];
      tMax[a] += tDelta[a];
      if (a === 0) x += step[0]; else if (a === 1) y += step[1]; else z += step[2];
    }
    return null;
  }

  // What the crosshair is on: a monster, a placed block, a wall or the floor.
  // x/y are map coordinates (column/row); h is the block height; prev is the
  // empty voxel in front of the hit face (where a new block would go).
  target(o, d, maxDist, motion, now, roof = false) {
    const v = this.raycastVoxel(o, d, maxDist, roof);
    const limit = v ? v.t : maxDist;
    const mob = this.pick(o, d, limit, motion, now, true);
    if (mob) return mob;
    if (!v) return null;
    const base = { x: v.x, y: v.z, h: v.y, prev: v.prev, t: v.t };
    if (v.y < 0) return { ...base, kind: 'floor', box: [v.x, -0.001, v.z, v.x + 1, 0.02, v.z + 1] };
    if (this.blocks && this.blocks.get(v.x, v.y, v.z))
      return { ...base, kind: 'block', type: this.blocks.get(v.x, v.y, v.z), box: [v.x, v.y, v.z, v.x + 1, v.y + 1, v.z + 1] };
    const c = this.classAt(v.x, v.z);
    const kind = c ? c.type : 'rock';
    return { ...base, kind: kind === 'door' ? 'door' : kind === 'wall' ? 'wall' : 'rock', box: [v.x, v.y, v.z, v.x + 1, v.y + 1, v.z + 1] };
  }

  // March a ray through the grid; returns {x, y, box, kind} for the first hit.
  pick(o, d, maxDist = 24, motion = null, now = 0, mobsOnly = false) {
    const step = 0.04;
    for (let t = 0; t < maxDist; t += step) {
      const px = o[0] + d[0] * t, py = o[1] + d[1] * t, pz = o[2] + d[2] * t;
      const cx = Math.floor(px), cz = Math.floor(pz);
      if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) {
        if (py < 0) return null;
        continue;
      }
      const cl = this.classAt(cx, cz);
      if (mobsOnly) {
        if (motion) {
          for (const m of motion.mobs.values()) {
            const [mx, mz] = motionPos(m, now);
            const h = sizeHeight(m.size) * (this.spriteScale || 1), lift = (m.fly ? 0.5 : 0) + this.standHeight(m.tx, m.tz), r = Math.min(0.45, h * 0.22);
            if (py >= lift && py <= lift + h && Math.abs(px - mx - 0.5) < r && Math.abs(pz - mz - 0.5) < r)
              return { kind: 'mob', x: m.tx, y: m.tz, box: [mx + 0.5 - r, lift, mz + 0.5 - r, mx + 0.5 + r, lift + h, mz + 0.5 + r], mon: true };
          }
        }
        continue;
      }
      if (cl && (cl.type === 'wall' || cl.type === 'rock') && py >= 0 && py <= WALL_H)
        return cl.type === 'rock' ? null : { x: cx, y: cz, box: [cx, 0, cz, cx + 1, WALL_H, cz + 1] };
      if (cl && cl.type === 'door' && py >= 0 && py <= WALL_H)
        return { x: cx, y: cz, box: [cx, 0, cz, cx + 1, DOOR_H, cz + 1] };
      if (motion) {
        for (const m of motion.mobs.values()) {
          const [mx, mz] = motionPos(m, now);
          const h = sizeHeight(m.size) * (this.spriteScale || 1), lift = (m.fly ? 0.5 : 0) + this.standHeight(m.tx, m.tz), r = Math.min(0.45, h * 0.22);
          if (py >= lift && py <= lift + h && Math.abs(px - mx - 0.5) < r && Math.abs(pz - mz - 0.5) < r)
            return { x: m.tx, y: m.tz, box: [mx + 0.5 - r, lift, mz + 0.5 - r, mx + 0.5 + r, lift + h, mz + 0.5 + r], mon: true };
        }
      }
      if (py <= 0) {
        if (!cl || cl.type === 'none' || cl.type === 'rock') return null;
        return { x: cx, y: cz, box: [cx, 0, cz, cx + 1, 0.02, cz + 1] };
      }
    }
    return null;
  }
}

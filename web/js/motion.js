// Smooth movement: NetHack resolves a whole turn instantly, but we play it
// back so the hero glides to the next square at walking speed while every
// monster glides to its new square on the same clock, all arriving together.

export const WALK_SPEED = 4.3; // blocks per second (Minecraft walking speed)
export const STEVE_HEIGHT = 1.8;

// NetHack size classes (MZ_TINY .. MZ_GIGANTIC) -> sprite height in blocks
const SIZE_HEIGHT = { 0: 0.9, 1: 1.4, 2: 2.0, 3: 2.6, 4: 3.2, 5: 3.6, 6: 3.8, 7: 4.0 };
export const sizeHeight = (sz) => SIZE_HEIGHT[sz] ?? 2.0;

const IDLE_TURN_MS = 220; // how long monsters take to move when the hero stands still
// ...and how fast they walk (squares a second): about the hero's own free walk (main.js FREE_SPEED 3.2), so a
// step takes a monster a step's time; a next one coming before it's there, it goes straight on from where it is
// (retarget): walking steadily with you, not hopping a square and standing
const MOB_SPEED = 2.8;

function track(x, z) {
  return { fx: x, fz: z, tx: x, tz: z, t0: 0, dur: 0 };
}

export function posAt(a, now) {
  const k = a.dur > 0 ? Math.min(1, (now - a.t0) / a.dur) : 1;
  return [a.fx + (a.tx - a.fx) * k, a.fz + (a.tz - a.fz) * k, k];
}

function retarget(a, x, z, now, dur) {
  const [cx, cz] = posAt(a, now);
  a.fx = cx; a.fz = cz; a.tx = x; a.tz = z; a.t0 = now; a.dur = dur;
}

export class Motion {
  constructor() {
    this.reset();
  }

  reset() {
    this.hero = track(0, 0);
    this.free = null; // walking freely: {x, z}, where you are (main.js processMovement)
    this.freeMoving = false;
    this.heroSize = 2;
    this.heroPoly = false;
    this.mobs = new Map(); // monster id -> track + {size, fly}
    this.byCell = new Map(); // "x,y" -> mob (by destination square)
  }

  // the hero's square changed (or we just learned it)
  moveHero(x, z, now, snap) {
    const [cx, cz] = posAt(this.hero, now);
    const d = Math.hypot(x - cx, z - cz);
    if (snap || d > 2.5) { this.hero = track(x, z); return; }
    if (x === this.hero.tx && z === this.hero.tz) return;
    retarget(this.hero, x, z, now, (d / WALK_SPEED) * 1000);
  }

  heroPos(now) {
    if (this.free) return [this.free.x, this.free.z, 1]; // (walking freely: main.js processMovement)
    return posAt(this.hero, now);
  }

  // time left until the hero reaches the centre of its square
  heroRemaining(now) {
    if (this.free) return this.freeMoving ? 1 : 0; // (walking freely: moving or not)
    return Math.max(0, this.hero.t0 + this.hero.dur - now);
  }

  heroHeight() {
    // (figHeight: the brick minifig's height, on brick levels)
    return this.heroPoly ? sizeHeight(this.heroSize) : this.figHeight || STEVE_HEIGHT;
  }

  // new monster positions for this turn: animate everyone to arrive with the hero
  setMobs(msg, now) {
    this.heroSize = msg.hero[2];
    this.heroPoly = !!msg.hero[3];
    const turn = Math.max(this.heroRemaining(now), IDLE_TURN_MS);
    const seen = new Set();
    for (const [id, x, y, size, fly, name, peace, god, pit] of msg.m) {
      seen.add(id);
      let m = this.mobs.get(id);
      if (!m) {
        m = { ...track(x, y), size, fly };
        this.mobs.set(id, m);
      } else if (m.tx !== x || m.tz !== y) {
        const [cx, cz] = posAt(m, now);
        if (Math.hypot(x - cx, y - cz) > 3) Object.assign(m, track(x, y)); // teleported
        else retarget(m, x, y, now, Math.max(turn, (Math.hypot(x - cx, y - cz) / MOB_SPEED) * 1000)); // (at a walk: as far as it goes)
      }
      m.id = id;
      m.size = size;
      m.fly = fly;
      m.name = name; // for the name tag
      m.peace = peace; // 1 tame, 2 peaceful, 0 hostile
      m.god = god || null; // (a priest: whose: his figure, monsters.json "aligned priest|lawful"...)
      m.pit = !!pit; // (down in a pit, caught there: drawn down in it)
    }
    for (const id of [...this.mobs.keys()]) if (!seen.has(id)) this.mobs.delete(id);
    this.byCell = new Map([...this.mobs.values()].map((m) => [`${m.tx},${m.tz}`, m]));
  }

  mobAt(x, y) {
    return this.byCell.get(`${x},${y}`);
  }

  // the monster a picture on (x, y) is, when the monsters' list doesn't have one there: the map and the list
  // come apart a moment (the map's sent on its own, before a message; the list only before you're asked for
  // input), so it's the one going to, or come from, the square beside it whose own square has no monster on the
  // map now (free(x, y): no monster's picture there). Drawn as itself, sliding, not a stand-in snapped there
  mobNear(x, y, free) {
    let best = null, bd = 9;
    for (const m of this.mobs.values()) {
      const d = Math.max(Math.abs(m.tx - x), Math.abs(m.tz - y));
      if (d !== 1 || !free(m.tx, m.tz)) continue;
      const [cx, cz] = posAt(m, performance.now()), e = Math.hypot(cx - x, cz - y);
      if (e < bd) { bd = e; best = m; }
    }
    return best;
  }
}

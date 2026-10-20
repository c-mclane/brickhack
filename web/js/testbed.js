// The test dungeon: the scene viewer (baseplate.html) as a little SLASH'EM
// level, drawn by the game's own brick renderer (brickworld.js) with the
// game's own effects, so what's tried here is what the game will do. A walled
// room, things set on its squares (scene.json "level": its size and what lies
// where), and a hero walking a script through them, square by square as the
// game moves you:
//   - onto a statue's square: a hop up onto its ledge, gazing up at it (perch.js)
//   - behind a boulder: a lean into it, and it rolls and tumbles on a square,
//     twice (boulderfx.js, as brickworld.boulderPush)
//   - a pick-axe at it: three swings, and it cracks in half and bursts into
//     grit and rocks, which go (brickworld.boulderBreak)
//   - every monster that spits (the cobra, the nagas, the acid worm, the
//     spitting beetle, Juiblex) rears and spits at it in turn: the gob flies, dripping, and splats
//   - punished: the ball and chain on its ankle (ballchain.js); it picks the
//     ball up, the weapon put away, and lugs it a few squares, as if it were
//     the hardest thing it ever carried; and sets it down
//   - a statue's odd cases, one after another, each named at the foot of the screen
// (broken while you stand on it; a statue trap coming alive; one with a spellbook inside; one
// picked up off rocks already there; two on a square, one broken; stone to flesh), the floor's list
// changing as the game's would and the game's own watch on it (brickworld.watchStatues) deciding
// what plays
// and again (or just one of them: ?part=statue, boulder, spit, ball or statues). Drag to look
// round, wheel to zoom, P to pause.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BrickWorld } from './brickworld.js';
import { FigureAnimator, FOUNT } from './minifig-anim.js';
import { Ambience } from './music.js';
import { swimPose, SWIM_SPLASH, WATER_Y, FALL_T, CRAWL_T } from './swim.js';
import { figureMatrix, partMatrix, STUD_H } from './brick.js';
import { perchSpot, cameFrom, hopOff, offTime, PERCHES, FOUNT_SPLASH, FOUNT_REACH, FOUNT_DOWN, bathPath, BATH_SPLASH, risePath, RISE_T, againstFountain } from './perch.js';
import { DRY_GREY, DRY_SIT, LADY_T } from './brickworld.js';
import { creatureLocal, slitherLocal, LUNGE_TIME } from './creature.js';
import { mul, mouthPoint } from './minifig-anim.js';

const STEP_TIME = 0.32; // s a square, walking

export async function runTestbed(data) {
  const level = data.level;
  const items = await (await fetch('assets/brick/items.built.json', { cache: 'no-store' })).json();
  const url = (name) => (items[name] ? items[name].url : null);
  const heroFig = data.objects.find((o) => o.hero);

  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%' });
  document.body.prepend(canvas);
  const gl = canvas.getContext('webgl2', { antialias: true });
  const brick = new BrickWorld(canvas, gl);
  brick.coinUrl = url('_coin'); // (gold in a fountain: coins strewn in its basin)
  const cam = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  const ctl = new OrbitControls(cam, canvas);
  const W = level.w, H = level.h;
  // the one room: a fountain or a pool in it, its water heard, lava, its flow (as the game's: main.js
  // roomNear), once there's been a click or a key (the browser's rule)
  const hasWater = (level.items || []).some((it) => it.item === 'fountain') || (level.pools || []).length, hasLava = (level.lava || []).length;
  if (hasWater || hasLava) {
    const amb = new Ambience(0.6);
    if (hasWater) amb.set('water', true);
    if (hasLava) amb.set('lava', true);
    const on = () => { amb.allow(); removeEventListener('pointerdown', on); removeEventListener('keydown', on); };
    addEventListener('pointerdown', on);
    addEventListener('keydown', on);
  }
  cam.position.set(...(level.camera ? level.camera.pos : [W / 2, 11, H + 3])); // (or where the level says to look from)
  ctl.target.set(...(level.camera ? level.camera.target : [W / 2, 0, H / 2 + 0.5]));

  // the room: a floor of plates, walls all round; water where scene.json has "pools" (and where more's been
  // let in: a fountain gushing, extra)
  const room = (extra = [], filled = []) => { // (filled: water a boulder's been pushed into, floor now)
    const floors = [], walls = [], pools = [], wet = (level.pools || []).concat(extra).filter(([x, z]) => !filled.some(([a, b]) => a === x && b === z));
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++) {
        if (x === 0 || z === 0 || x === W - 1 || z === H - 1) walls.push({ x, z, shade: 1 });
        else if (wet.some(([px, pz]) => px === x && pz === z)) pools.push({ x, z, shade: 1 });
        else if ((level.lava || []).some(([px, pz]) => px === x && pz === z)) pools.push({ x, z, shade: 1, lava: true }); // (scene.json "lava")
        else floors.push({ x, z, studs: true, shade: 1 });
      }
    brick.setTerrain({ floors, walls, pools, doors: [], fog: [], w: W, h: H });
  };
  await brick.ready;
  room();
  // the room under a dark sky, as deep in the dungeon
  brick.scene.background = new THREE.Color(0x0b0d14);
  if (level.menagerie) return menagerie(level, brick, cam, ctl, canvas);

  // what lies where: [{x, z, url, level, upright, name}] (world.js brickDrops), redone as things move
  const at = (name) => level.items.find((i) => i.item === name);
  let drops = [];
  const lay = (list) => {
    const n = new Map(); // (things on one square: stacked, one on another, as world.js has them)
    drops = list.filter(Boolean).map((i) => { const k = i.at.join(','), level = n.get(k) || 0; n.set(k, level + 1);
      return { x: i.at[0], z: i.at[1], url: url(i.item), level, upright: !!(items[i.item] || {}).upright, name: i.item }; });
    // (as the game watches its list: a statue broken comes apart; up on it, you jump down)
    for (const [x, z] of brick.watchStatues(drops, 'test', (n) => (items[n] ? { name: n, ...items[n] } : null)))
      if (hero.sq.x === x && hero.sq.y === z && hero.from.perch) hero.leap = { t0: clock, side: { wx: hero.from.perch.wx, wz: hero.from.perch.wz } };
  };
  let cut = null; // (a cutscene's view: the Lady of the Lake)
  const bars = (on) => { // (letterboxed, for a cutscene)
    let b = document.querySelectorAll('.letterbox');
    if (!b.length) {
      for (const edge of ['top', 'bottom']) {
        const d = document.createElement('div');
        d.className = 'letterbox';
        Object.assign(d.style, { position: 'fixed', left: '0', right: '0', [edge]: '0', height: '0', background: '#000', zIndex: '40', pointerEvents: 'none', transition: 'height 0.8s ease' });
        document.body.appendChild(d);
      }
      b = document.querySelectorAll('.letterbox');
      void b[0].offsetHeight;
    }
    b.forEach((d) => { d.style.height = on ? '11vh' : '0'; });
  };
  const say = (text) => { const el = document.getElementById('status'); if (el) el.textContent = text; };

  // the hero
  const anim = { a: null, state: {} };
  const hero = { sq: { x: 0, y: 0 }, pos: [0, 0], yaw: 0, from: { x: 0, y: 0, cur: null }, walk: null, hold: {}, lift: 0 };
    brick.model(heroFig.url).then((m) => {
    let rig = null;
    m.traverse((o) => { if (!rig && o.userData && o.userData.rig) rig = o.userData.rig; });
    anim.a = new FigureAnimator(rig, { phase: 0.4 });
    anim.a.spawn();
  });

  // the clock the script waits on (it runs with the frames)
  let clock = 0;
  const waits = [];
  const wait = (s) => new Promise((res) => waits.push({ t: clock + s, res }));
  // a step onto the next square (dx, dy), as the game moves you; resolves when there
  const step = (dx, dy) => {
    const from = { ...hero.sq };
    hero.sq = { x: from.x + dx, y: from.y + dy };
    hero.yaw = Math.atan2(dx, -dy);
    hero.walk = { from, t0: clock };
    hero.after = null;
    return wait(STEP_TIME);
  };
  const walk = async (path) => { for (const [dx, dy] of path) await step(dx, dy); };
  const place = (x, y, yaw) => { hero.sq = { x, y }; hero.pos = [x, y]; hero.from = { x, y, cur: null }; hero.yaw = yaw; hero.walk = null; hero.after = null; hero.leap = null; };

  let punished = null; // the ball and chain, when punished (brickworld.setPunished, as the game sets it)
  // the monsters: creatures (creature.js) facing you
  const mons = await (await fetch('assets/brick/monsters.built.json', { cache: 'no-store' })).json();
  const cobras = (level.monsters || []).filter((m) => mons[m.monster]).map((m) => ({ ...m, ...mons[m.monster], kind: mons[m.monster].creature, lungeAt: -1e9 }));
  for (const c of cobras) if (!c.kind) brick.model(c.url).then((m) => { // (a minifig monster: alive as the hero is)
    let rig = null;
    m.traverse((o) => { if (!rig && o.userData && o.userData.rig) rig = o.userData.rig; });
    c.anim = new FigureAnimator(rig, { phase: Math.random() * 3 });
    c.anim.spawn();
  });
  // a statue's odd cases, each on the statue's own square, the hero just west of it
  async function statueCases([sx, sz]) {
    const S = { item: 'statue', at: [sx, sz] }, rock = { item: 'rock', at: [sx, sz] };
    const fresh = async (label, list) => {
      say(label);
      brick.boulders && brick.boulders.clear();
      lay([]); lay(list); // (a fresh start: nothing to compare with)
      place(sx - 2, sz, Math.PI / 2);
      hero.hold = { R: url('pick-axe') };
      await wait(1.2);
    };
    const swing = async () => { for (let k = 0; k < 3; k++) { anim.a && anim.a.attack(); await wait(0.6); } };
    // 1. broken while you stand on it (a monster's force bolt): you jump down off the ledge as it goes
    await fresh('1/6  broken while you stand on it: you jump down as it comes apart', [S]);
    await walk([[1, 0], [1, 0]]);
    await wait(1.5);
    lay([rock]);
    await wait(4.5);
    // 2. a statue trap: it comes alive (no rocks: it doesn't shatter, the monster is just there)
    await fresh('2/6  a statue trap comes alive: no rocks, so no shatter', [S]);
    await walk([[1, 0]]);
    await swing();
    const mon = Object.keys(mons).find((k) => !mons[k].creature);
    const trap = mon ? { monster: mon, at: [sx, sz], ...mons[mon], lungeAt: -1e9 } : null;
    lay([]);
    if (trap) { cobras.push(trap); brick.model(trap.url).then((m) => { let rig = null; m.traverse((o) => { if (!rig && o.userData && o.userData.rig) rig = o.userData.rig; }); trap.anim = new FigureAnimator(rig, { phase: 1 }); trap.anim.spawn(); }); }
    await wait(3.5);
    if (trap) cobras.splice(cobras.indexOf(trap), 1);
    // 3. a spellbook inside: it falls out with the rocks, shown once the pieces have gone
    await fresh('3/6  a spellbook inside: it shows with the rocks once the pieces are gone', [S]);
    await walk([[1, 0]]);
    await swing();
    lay([rock, { item: 'spellbook of force bolt', at: [sx, sz] }]);
    await wait(5);
    // 4. picked up off a square with rocks already on it (no new rocks: no shatter)
    await fresh('4/6  picked up off rocks already lying there: no shatter', [S, rock]);
    await walk([[1, 0], [1, 0]]);
    await wait(1);
    lay([rock]);
    await wait(3);
    // 5. two statues on one square, one broken: that one comes apart, the other still stands
    await fresh('5/6  two statues on one square, one broken: it shatters, the other stands', [S, { ...S }]);
    await walk([[1, 0]]);
    await swing();
    lay([S, rock]);
    await wait(5);
    // 6. stone to flesh: it turns to meat (no rocks: no shatter)
    await fresh('6/6  stone to flesh: it turns to meat, no shatter', [S]);
    await wait(1);
    lay([{ item: 'huge chunk of meat', at: [sx, sz] }]);
    await wait(3);
  }

  async function script() {
    for (;;) {
      // set out: the room as the level has it, the hero at its start, a pick in hand
      const st = at('statue') || at('fountain'), bo = at('boulder'), ba = at('heavy iron ball'); // (or a fountain to stand on: perch.js PERCHES)
      lay([st, bo]);
      brick.boulders && brick.boulders.clear();
      for (const [k, kept] of brick.keptRocks) brick.keptRocks.delete(k);
      place(level.start[0], level.start[1], Math.PI / 2);
      hero.hold = { R: url('pick-axe') };
      anim.state = {};
      await wait(1);
      const part = new URLSearchParams(location.search).get('part') || level.part; // (?part=statue|boulder|spit|ball|swim, or the scene's own "part": just that, again and again)
      const doing = (p) => !part || part.split(',').includes(p); // (a list of them: just those, in the script's order)
      // the statue: walk up and onto it (from the west), stand a while, and step down
      if (doing('statue')) {
        await walk(Array(st.at[0] - hero.sq.x).fill([1, 0]));
        await wait(st.item === 'fountain' ? 1.2 : 3);
        if (st.item === 'fountain') { // (a fountain: a drink from it, then a sword dipped in)
          say('drinking from the fountain');
          hero.fount = { act: 'drink', t0: clock, fired: 0 };
          brick.fountainFlare(st.at[0], st.at[1], 0.9); // (a magic one: a flare)
          await wait(FOUNT.drink.T + 1);
          say('dipping a long sword in it');
          hero.fount = { act: 'dip', t0: clock, fired: 0, url: url('long sword') };
          brick.fountainGlint(st.at[0], st.at[1], 0.6); // (and the sword uncursed: "the water glows for a moment")
          await wait(FOUNT.dip.T + 1.2);
          say('');
        }
        await walk([[0, 1]]);
        if (st.item === 'fountain') { say('into the pool: a swimmer, sunk to the waist'); await wait(2.5); say(''); } // (down off the rim into water)
      }
      // the Lady of the Lake (?part=lady): up on the rim, a long sword dipped, and held there in the water: her arm
      // rises out of it to the sword, a burst of golden light, and she sinks again; and the fountain goes as a
      // dried-up one does, you jumping down off it. The view a cutscene's, letterboxed
      if (doing('lady') && st && st.item === 'fountain') {
        room();
        hero.hold = { R: url('long sword') };
        await walk(Array(st.at[0] - hero.sq.x).fill([1, 0]));
        await wait(1.2);
        say('dipping a long sword into the fountain...');
        hero.fount = { act: 'dip', t0: clock, fired: 0, url: url('long sword'), freezeAt: 0.85, freezeUntil: clock + LADY_T - 1.1 };
        const pp = hero.pp, yaw = pp ? pp.yaw : hero.yaw, x = hero.pos[0] + 0.5 + (pp ? pp.dx : 0), z = hero.pos[1] + 0.5 + (pp ? pp.dz : 0);
        const at = new THREE.Vector3(x + Math.sin(yaw) * FOUNT_REACH, (pp ? pp.lift : 0) - FOUNT_DOWN, z - Math.cos(yaw) * FOUNT_REACH);
        const sd = hero.from.perch;
        cut = { t0: clock, T: LADY_T + 0.2 + DRY_GREY + DRY_SIT + 0.7 + 3.2 + 0.4, up: LADY_T + 0.2 + DRY_GREY + DRY_SIT + 0.7, focus: [st.at[0] + 0.5, STUD_H + 0.75, st.at[1] + 0.5], side: sd ? [sd.wx, sd.wz] : [0, 1] };
        bars(true);
        await wait(0.5);
        say('From the murky depths, a hand reaches up to bless the sword.');
        brick.ladyOfTheLake(at, yaw, url('_lady of the lake'), true);
        setTimeout(() => { if (hero.fount) hero.fount.url = url('Excalibur'); hero.exc = true; }, 2100); // (blessed: Excalibur now, in your hand, till it's been held high)
        const w = brick.fountainDry(st.at[0], st.at[1], url('fountain'), (items.fountain || {}).bricks, LADY_T + 0.2) || 0;
        await wait(LADY_T - 0.6);
        say('As the hand retreats, the fountain disappears!');
        await wait(w - LADY_T + 0.6 + DRY_GREY + DRY_SIT);
        lay([]);
        if (hero.from.perch) hero.leap = { t0: clock, side: { wx: hero.from.perch.wx, wz: hero.from.perch.wz }, pr: PERCHES.fountain };
        await wait(0.7);
        say('Excalibur!'); // (held high, golden light glinting off it: as main.js raiseAct)
        hero.raise = { t0: clock, T: 3.2, glint: 0 };
        await wait(4.5);
        say('');
      }
      // a pool (?part=swim): no swimmer, stepping in falls in, and crawls out onto another dry square (swim.js)
      if (doing('swim') && (level.pools || []).length) {
        const [px, pz] = [...level.pools].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]; // (the pool's southwest: dry land south and west of it)
        place(px, pz + 1, 0);
        hero.hold = { R: null, L: null };
        say('stepping into the pool: falls in...');
        await wait(1.2);
        hero.swim = { from: [px, pz + 1], pool: [px, pz], to: [px - 1, pz + 1], t0: clock, fired: 0 };
        await wait(FALL_T);
        say('...and crawls out');
        await wait(CRAWL_T + 1.5);
      }
      // the town's watch (?part=guard): a fountain used once too often, and a watchman seeing it yells at you,
      // raising his halberd at you; used again all the same, it dries up and comes apart, and the watch turns on you
      if (doing('guard') && st && st.item === 'fountain' && mons.watchman) {
        room();
        lay([st]);
        hero.hold = { R: null, L: null };
        const [fx, fz] = st.at;
        place(level.start[0], level.start[1], Math.PI / 2); // (from where you start: in line with the fountain)
        const watch = { monster: 'watchman', at: [fx - 2, fz - 1], ...mons.watchman, lungeAt: -1e9 }; // (beside the fountain, in view, off your way to it)
        brick.model(watch.url).then((m) => { let rig = null; m.traverse((o) => { if (!rig && o.userData && o.userData.rig) rig = o.userData.rig; }); watch.anim = new FigureAnimator(rig, { phase: 2 }); });
        cobras.push(watch);
        await walk(Array(fx - hero.sq.x).fill([1, 0]));
        await wait(1);
        say('drinking from the fountain...');
        hero.fount = { act: 'drink', t0: clock, fired: 0 };
        await wait(FOUNT.drink.T);
        say('The watchman yells: "Hey, stop using that fountain!"'); // (as main.js 'warn': brandishing his halberd high at you)
        watch.warnAt = clock;
        brick.fx.sparkles(new THREE.Vector3(watch.at[0] + 0.5, STUD_H + 1.5, watch.at[1] + 0.5), 24, 0xff3b30, 0.15);
        await wait(2.5);
        say('drinking from it again, all the same...');
        hero.fount = { act: 'drink', t0: clock, fired: 0 };
        await wait(FOUNT.drink.T);
        say('The fountain dries up! The watch is angry!');
        const w = brick.fountainDry(fx, fz, url('fountain'), (items.fountain || {}).bricks) || 0;
        if (watch.anim) watch.anim.attack();
        await wait(w + DRY_GREY + DRY_SIT);
        lay([]);
        if (hero.from.perch) hero.leap = { t0: clock, side: { wx: hero.from.perch.wx, wz: hero.from.perch.wz }, pr: PERCHES.fountain };
        await wait(0.8);
        if (watch.anim) watch.anim.attack();
        await wait(3.5);
        cobras.splice(cobras.indexOf(watch), 1);
        say('');
      }
      // lava (?part=lava; scene.json "lava"): fire resistant, stepping in you sink into it, smoking, its glowing studs
      // flying; stuck in it a while, burning, and then you pull yourself to its edge and step out
      if (doing('lava') && (level.lava || []).length) {
        const [lx, lz] = level.lava[0];
        room();
        lay([st]);
        place(lx + 1, lz, -Math.PI / 2);
        hero.hold = { R: null, L: null };
        say('stepping into the lava...');
        await wait(1.2);
        say('You sink into the lava, but it only burns slightly!');
        hero.swim = { from: [lx + 1, lz], pool: [lx, lz], to: null, t0: clock, fired: 0, lava: true };
        await wait(FALL_T + 0.4);
        say('You are stuck in the lava.');
        await wait(2.8);
        say('You pull yourself to the edge of the lava.');
        await wait(0.8);
        await walk([[1, 0]]);
        await wait(1.5);
        say('');
      }
      // the fountain at [fx, fz] gushing: its burst, and streams out to squares round it (as the game picks them:
      // every other square, not the fountain's own, out to 3; here, clear of its basin), pools as they land
      const gush = ([fx, fz]) => {
        const wet = [];
        for (let z = 1; z < H - 1; z++)
          for (let x = 1; x < W - 1; x++) {
            const d = Math.max(Math.abs(x - fx), Math.abs(z - fz));
            if ((x + z) % 2 === 0 && d >= 2 && d <= 3 && !(level.pools || []).some(([a, b]) => a === x && b === z)) wet.push([x, z]);
          }
        brick.gushBurst(fx, fz);
        wet.forEach(([x, z], i) => brick.gushTo(fx, fz, x, z, 0.15 + 0.12 * Math.hypot(x - fx, z - fz) + 0.03 * i));
        room(wet); // (the map: those are pools now)
      };
      // dug into (?part=dig): up on its rim, three blows of a pick straight down, and it gushes; once its water's
      // landed, it dries up and comes apart (brickworld.js fountainDry), you jumping down as it goes
      if (doing('dig') && st && st.item === 'fountain') {
        room();
        hero.hold = { R: url('pick-axe') };
        await walk(Array(st.at[0] - hero.sq.x).fill([1, 0]));
        await wait(1);
        say('digging down into the fountain...');
        hero.digging = true;
        for (let k = 0; k < 3; k++) { anim.a && anim.a.attack(); await wait(0.6); }
        hero.digging = false;
        say('...water gushes forth, and the fountain dries up!');
        gush(st.at);
        const w = brick.fountainDry(st.at[0], st.at[1], url('fountain'), (items.fountain || {}).bricks) || 0;
        await wait(w + DRY_GREY + DRY_SIT);
        lay([]);
        if (hero.from.perch) hero.leap = { t0: clock, side: { wx: hero.from.perch.wx, wz: hero.from.perch.wz }, pr: PERCHES.fountain };
        await wait(5.5);
        say('');
      }
      // a gem in a fountain's sparkling waters (?part=gem): up on its rim, something dipped, and a gem leaps up out of
      // its water, glittering, and lands in its pool, where it lies (brickworld.js fountainGem)
      if (doing('gem') && st && st.item === 'fountain') {
        room();
        lay([st]);
        hero.hold = { R: url('dagger') };
        await walk(Array(st.at[0] - hero.sq.x).fill([1, 0]));
        await wait(1);
        const [fx, fz] = st.at, gems = ['ruby', 'emerald', 'sapphire'], gem = gems[Math.floor(clock) % gems.length];
        say('dipping a dagger into the fountain...');
        hero.fount = { act: 'dip', t0: clock, fired: 0, url: url('dagger') };
        await wait(0.6);
        say('You spot a gem in the sparkling waters!');
        const g = brick.fountainGem(fx, fz, url(gem));
        lay([st, { item: gem, at: [fx, fz] }]); // (the map: it lies there now, in the pool; out of sight while you show it off)
        await wait(FOUNT.dip.T - 0.6);
        // (as main.js 'gem': an empty hand reaching in, the gem in it coming up out of the water, and held up high)
        hero.fount = { act: 'dip', t0: clock, fired: 0, url: null, grab: url(gem) };
        await wait(FOUNT.dip.T - 0.3);
        hero.raise = { t0: clock, T: 2.6, glint: 0, url: url(gem), tip: [0.22, 1.3] }; // (its glints: at the fist)
        await wait(2.6);
        g.show();
        await wait(2.5);
        say('');
      }
      // odd things at a fountain (?part=odd): foul water drunk, retching into it; contaminated water drunk, a
      // purple haze about you; and a dagger dipped, the urge to take a bath: a dive in, a jump out, a shake
      if (doing('odd') && st && st.item === 'fountain') {
        room();
        lay([st]);
        hero.hold = { R: url('dagger') };
        await walk(Array(st.at[0] - hero.sq.x).fill([1, 0]));
        await wait(1);
        say('drinking from the fountain...');
        hero.fount = { act: 'drink', t0: clock, fired: 0 };
        await wait(FOUNT.drink.T);
        say('The water is foul!  You gag and vomit.');
        hero.fount = { act: 'retch', t0: clock, fired: 0 };
        await wait(FOUNT.retch.T + 1);
        say('drinking from the fountain...');
        hero.fount = { act: 'drink', t0: clock, fired: 0 };
        await wait(FOUNT.drink.T);
        say('The water is contaminated!');
        hero.haze = { t0: clock, last: -1 };
        await wait(5);
        say('dipping a dagger into the fountain...');
        hero.fount = { act: 'dip', t0: clock, fired: 0, url: url('dagger') };
        await wait(FOUNT.dip.T);
        say('An urge to take a bath overwhelms you.');
        hero.fount = { act: 'bath', t0: clock, fired: 0, bathFired: 0 };
        await wait(2.4);
        say('You lost some of your gold in the fountain!');
        await wait(FOUNT.bath.T - 2.4 + 1.5);
        say('');
      }
      // and more (?part=more): this water's no good, a murky puff about you; bad breath, a faint wisp or two; a
      // strange tingling, a shiver; and coins seen glistening far below, gold strewn in its basin
      if (doing('more') && st && st.item === 'fountain') {
        room();
        lay([st]);
        hero.hold = { R: url('dagger') };
        await walk(Array(st.at[0] - hero.sq.x).fill([1, 0]));
        await wait(1);
        const drink = async (msg) => { say('drinking from the fountain...'); hero.fount = { act: 'drink', t0: clock, fired: 0 }; await wait(FOUNT.drink.T); say(msg); };
        const dip = async (msg) => { say('dipping a dagger into the fountain...'); hero.fount = { act: 'dip', t0: clock, fired: 0, url: url('dagger') }; await wait(FOUNT.dip.T); say(msg); };
        await drink("This water's no good!");
        hero.puff = true;
        await wait(3);
        await drink('This water gives you bad breath!');
        hero.breath = { last: -1 }; // (as main.js: a wisp every second or so, a while: here, the rest of the demo)
        await dip('A strange tingling runs up your arm.');
        hero.fount = { act: 'shiver', t0: clock, fired: 0, frostT: 0 };
        await wait(FOUNT.shiver.T + 1);
        say('dipping a dagger into the fountain...');
        hero.fount = { act: 'dip', t0: clock, fired: 0, url: url('dagger') };
        await wait(FOUNT.dip.T - 0.9);
        lay([st, { item: 'gold piece', at: st.at }]);
        brick.fountainCoinsGlint(st.at[0], st.at[1]);
        await wait(0.9);
        say('Far below you, you see coins glistening in the water.');
        await wait(4);
        say('');
        hero.breath = null;
      }
      // just bad breath (?part=breath): a drink, and then the faint green wisp off you, on and on
      if (doing('breath') && st && st.item === 'fountain') {
        room();
        lay([st]);
        hero.hold = { R: null };
        await walk(Array(st.at[0] - hero.sq.x).fill([1, 0]));
        await wait(1);
        say('drinking from the fountain...');
        hero.fount = { act: 'drink', t0: clock, fired: 0 };
        await wait(FOUNT.drink.T);
        say('This water gives you bad breath!');
        hero.breath = { last: -1 };
        await wait(3);
        say('...and it stays with you as you go');
        // (down off the rim, round the room past the pools, and back: the wisp off your mouth all the way)
        await walk([[-1, 0], [0, -1], [0, -1], [1, 0], [0, 1], [1, 0], [0, 1], [1, 0], [1, 0], [0, 1], [0, 1],
          [-1, 0], [-1, 0], [-1, 0], [-1, 0], [-1, 0], [0, -1], [0, -1]]);
        await wait(2);
        hero.breath = null;
        say('');
      }
      // more out of a fountain (?part=fountain): a water demon rising out of it, granting a wish and gone in a burst;
      // a water nymph rising out of it; no nymph, a great bubble rising and popping; a gem leaping out of its water
      // into its pool; and steam billowing up out of it (a fire ray across it)
      if (doing('fountain') && st && st.item === 'fountain' && mons['water demon']) {
        room();
        lay([st]);
        hero.hold = { R: null, L: null };
        await walk(Array(st.at[0] - hero.sq.x).fill([1, 0]));
        await wait(1);
        const [fx, fz] = st.at;
        const rise = async (name, at, msg) => { // (a minifig out of the fountain: rising, over the rim, onto its square)
          say(msg);
          const c = { monster: name, at, ...mons[name], lungeAt: -1e9, rise: { f: [fx, fz], t0: clock } };
          brick.model(c.url).then((m) => { let rig = null; m.traverse((o) => { if (!rig && o.userData && o.userData.rig) rig = o.userData.rig; }); c.anim = new FigureAnimator(rig, { phase: 1 }); });
          brick.fx.splashStuds(new THREE.Vector3(fx + 0.5, STUD_H + 0.5, fz + 0.5), 14, 1.8);
          cobras.push(c);
          return c;
        };
        hero.fount = { act: 'drink', t0: clock, fired: 0 };
        await wait(FOUNT.drink.T);
        const demon = await rise('water demon', [fx + 2, fz], 'You unleash a water demon!');
        await wait(RISE_T + 1.2);
        say('Grateful for his release, he grants you a wish!');
        await wait(1);
        brick.demonGone(...demon.at);
        cobras.splice(cobras.indexOf(demon), 1);
        await wait(2);
        hero.fount = { act: 'drink', t0: clock, fired: 0 };
        await wait(FOUNT.drink.T);
        const nymph = await rise('water nymph', [fx, fz + 2], 'You attract a water nymph!');
        await wait(RISE_T + 2);
        cobras.splice(cobras.indexOf(nymph), 1);
        hero.fount = { act: 'drink', t0: clock, fired: 0 };
        await wait(FOUNT.drink.T);
        say('A large bubble rises to the surface and pops.');
        await brick.fountainBubble(fx, fz, url('_bubble'));
        await wait(1);
        hero.fount = { act: 'dip', t0: clock, fired: 0, url: url('dagger') };
        await wait(0.6);
        say('You spot a gem in the sparkling waters!');
        const g = brick.fountainGem(fx, fz, url('emerald'));
        lay([st, { item: 'emerald', at: [fx, fz] }]); // (the map: it lies there now: on the rim, once it's shown)
        hero.fount = { act: 'dip', t0: clock, fired: 0, url: null, grab: url('emerald') };
        await wait(FOUNT.dip.T - 0.3);
        hero.raise = { t0: clock, T: 2.6, glint: 0, url: url('emerald'), tip: [0.22, 1.3] };
        await wait(2.6);
        g.show();
        await wait(2);
        say('Steam billows from the fountain.');
        brick.fountainSteam(fx, fz);
        await wait(3.5);
        say('');
      }
      // water moccasins (?part=snakes): up on the rim, a drink, and an endless stream of black snakes pours forth,
      // one after another up out of the water, over the rim and off onto the squares round it
      if (doing('snakes') && st && st.item === 'fountain' && mons['water moccasin']) {
        room();
        hero.hold = { R: null, L: null };
        await walk(Array(st.at[0] - hero.sq.x).fill([1, 0]));
        await wait(1);
        say('drinking from the fountain...');
        hero.fount = { act: 'drink', t0: clock, fired: 0 };
        await wait(FOUNT.drink.T);
        say('An endless stream of snakes pours forth!');
        const [fx, fz] = st.at, spots = [[fx + 1, fz - 1], [fx + 1, fz + 1], [fx, fz - 1], [fx + 1, fz], [fx, fz + 1]];
        const snakes = spots.map((at, i) => ({ monster: 'water moccasin', at, ...mons['water moccasin'], kind: 'snake', lungeAt: -1e9, rise: { f: [fx, fz], t0: clock + i * 0.35 } }));
        snakes.forEach((sn, i) => setTimeout(() => brick.fx.splashStuds(new THREE.Vector3(fx + 0.5, STUD_H + PERCHES.fountain.H - 0.1, fz + 0.5), 8, 1.4), i * 350));
        cobras.push(...snakes);
        await wait(snakes.length * 0.35 + RISE_T + 2.5);
        for (const sn of snakes) cobras.splice(cobras.indexOf(sn), 1);
        say('');
      }
      // a boulder pushed into a pool (?part=sink): it rolls in and sinks with a splash, and a floor rises there in
      // its place (brickworld.js boulderSink); then you walk across
      if (doing('sink') && (level.pools || []).length) {
        const [px, pz] = [...level.pools].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]; // (the pool's southwest)
        room();
        lay([st, { item: 'boulder', at: [px - 1, pz] }]);
        place(px - 2, pz, Math.PI / 2);
        hero.hold = { R: null, L: null };
        say('pushing a boulder into the pool...');
        await wait(1.2);
        anim.pushT0 = clock;
        brick.boulderSink(url('boulder'), px - 1, pz, px, pz, true);
        lay([st]);
        room([], [[px, pz]]); // (the map: floor there now)
        await step(1, 0);
        say('...it fills the pool: now you can cross it!');
        await wait(2.2);
        await step(1, 0);
        await wait(1.5);
        say('');
      }
      // a fountain gushing (?part=gush): up on its rim, a drink, and it bursts: water out of its top all about,
      // and streams arcing out to squares round it, each a pool as the water lands (brickworld.js gushTo)
      if (doing('gush') && st && st.item === 'fountain') {
        room();
        hero.hold = { R: null, L: null };
        await walk(Array(st.at[0] - hero.sq.x).fill([1, 0]));
        await wait(1);
        say('drinking from the fountain...');
        hero.fount = { act: 'drink', t0: clock, fired: 0 };
        await wait(FOUNT.drink.T);
        say('...and water gushes forth from the overflowing fountain!');
        gush(st.at);
        await wait(6);
        say('');
      }
      // a fountain drying up (?part=dry): up on its rim, a drink, and its water greys under you; a moment, and
      // it comes apart brick by brick (brickworld.js fountainDry), you jumping down off it as it goes
      if (doing('dry') && st && st.item === 'fountain') {
        hero.hold = { R: null, L: null };
        await walk(Array(st.at[0] - hero.sq.x).fill([1, 0]));
        await wait(1);
        say('drinking from the fountain...');
        hero.fount = { act: 'drink', t0: clock, fired: 0 };
        await wait(FOUNT.drink.T);
        say('...and it dries up');
        brick.fountainDry(st.at[0], st.at[1], url('fountain'), (items.fountain || {}).bricks);
        await wait(DRY_GREY + DRY_SIT);
        lay([]); // (the map: plain floor there now)
        if (hero.from.perch) hero.leap = { t0: clock, side: { wx: hero.from.perch.wx, wz: hero.from.perch.wz }, pr: PERCHES.fountain };
        await wait(5.5);
        say('');
      }
      // the boulder: round behind it, and push, twice
      if (doing('boulder') && bo) {
        while (hero.sq.y < bo.at[1]) await step(0, 1);
        while (hero.sq.x < bo.at[0] - 1) await step(1, 0);
        await wait(0.6);
        for (let k = 0; k < 2; k++) {
          const b = { x: bo.at[0] + k, y: bo.at[1] };
          brick.boulderPush(url('boulder'), b.x, b.y, b.x + 1, b.y);
          lay([st, { item: 'boulder', at: [b.x + 1, b.y] }]); // (the map: the boulder's on the next square now)
          anim.pushT0 = clock;
          await step(1, 0);
          await wait(1.2);
        }
        // the pick: three swings, and it breaks into rocks
        for (let k = 0; k < 3; k++) { anim.a && anim.a.attack(); await wait(0.75); }
        const rocksAt = [hero.sq.x + 1, hero.sq.y];
        brick.boulderBreak(url('boulder'), rocksAt[0], rocksAt[1], url('rock'), (items.boulder || {}).halves);
        lay([st, { item: 'rock', at: rocksAt }]);
        await wait(3);
      }
      // the spitters, one by one: each rears and spits at you (its venom flies, dripping, and splats)
      if (doing('spit')) {
        for (const c of cobras) {
          c.lungeAt = clock;
          await wait(0.3);
          const venom = url(c.venom || 'blinding venom');
          brick.fx.launch(venom, c.at[0], c.at[1], hero.sq.x, hero.sq.y, { spit: true });
          brick.fx.shatter(venom, hero.sq.x, hero.sq.y, 'venom');
          await wait(1.4);
        }
      }
      // punished: the ball and chain on your ankle, the ball lying beside you (as the game draws it)
      if (doing('ball') && ba) {
        if (part === 'ball') place(ba.at[0] + 5, ba.at[1] - 1, -Math.PI / 2); // (on its own: from nearby)
        await walk([[0, 1], [-1, 0], [-1, 0], [-1, 0]]);
        while (hero.sq.x > ba.at[0] + 2) await step(-1, 0);
        await wait(0.3);
        punished = { ball: ba.at.slice(), ballUrl: url('heavy iron ball'), linkUrl: url('_chain link') };
        await wait(1.5);
        // pick it up: the pick put away, the ball in both arms, staggering
        hero.yaw = -Math.PI / 2;
        await wait(0.5);
        hero.hold = { R: null, L: null };
        anim.state.heavy = 1;
        punished.ball = null;
        await wait(1.2);
        await walk([[1, 0], [1, 0], [1, 0]]);
        await wait(1);
        await walk([[-1, 0], [-1, 0]]);
        // and down it goes, where you stand
        punished.ball = [hero.sq.x, hero.sq.y];
        anim.state.heavy = 0;
        await wait(1.5);
        await walk([[1, 0], [1, 0]]); // (and walk on, dragging it)
        punished.ball = [hero.sq.x - 1, hero.sq.y];
        await wait(2);
        punished = null;
      }
      // a statue's odd cases, one after another, each named
      if (doing('statues')) await statueCases(st.at);
      say('test dungeon · drag to look, wheel to zoom, P to pause');
      await wait(1);
    }
  }
  script();

  // ---- every frame
  let last = performance.now(), paused = false;
  const SLOW = +(new URLSearchParams(location.search).get('slow') || 1); // (?slow=0.25: everything at a quarter speed, to see it)
  addEventListener('keydown', (e) => { if (e.key === 'p' || e.key === 'P') paused = !paused; }); // P: hold everything still
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = paused ? 0 : Math.min(0.1, (now - last) / 1000) * SLOW;
    last = now;
    clock += dt;
    for (const w of [...waits]) if (clock >= w.t) { waits.splice(waits.indexOf(w), 1); w.res(); }
    // where the hero is: walking between squares, or on one
    let moving = false;
    if (hero.walk) {
      const u = (clock - hero.walk.t0) / STEP_TIME;
      if (u >= 1) hero.walk = null;
      else { hero.pos = [hero.walk.from.x + (hero.sq.x - hero.walk.from.x) * u, hero.walk.from.y + (hero.sq.y - hero.walk.from.y) * u]; moving = true; }
    }
    if (!hero.walk) hero.pos = [hero.sq.x, hero.sq.y];
    cameFrom(hero.from, hero.sq);
    let pp = perchSpot(hero.sq, hero.from, hero.pos, drops);
    if (hero.from.perch) brick.setFountainSide(hero.from.perch.x, hero.from.perch.y, hero.from.perch); // (what lies on it: on its rim where you stand)
    if (hero.leap) { // (the statue gone from under you: off the ledge, as the game plays it, perch.js hopOff)
      const L = hero.leap, dest = [L.side.wx * 0.42, L.side.wz * 0.42], u = clock - L.t0;
      if (u >= offTime(L.side, L.side)) { hero.leap = null; hero.after = dest; hero.from.perch = null; }
      else { const o = hopOff(L.side, L.side, dest, u, L.pr); pp = { k: 1, dx: o.x, dz: o.z, lift: o.lift, yaw: o.yaw, hop: o.hop, lookUp: 0 }; }
    }
    if (!pp && hero.after) pp = { k: 0, dx: hero.after[0], dz: hero.after[1], lift: 0, hop: 0, lookUp: 0 };
    const push = Math.max(0, 1 - (clock - (anim.pushT0 ?? -1e9)) / 0.7);
    const ft = hero.fount && (hero.fount.freezeUntil ? (clock < hero.fount.freezeUntil ? Math.min(clock - hero.fount.t0, hero.fount.freezeAt) : hero.fount.freezeAt + clock - hero.fount.freezeUntil) : clock - hero.fount.t0); // (held there: the Lady)
    const fo = hero.fount && ft < FOUNT[hero.fount.act].T ? { act: hero.fount.act, t: ft } : null;
    if (fo && fo.act === 'bath' && pp && pp.k >= 1 && hero.from.perch) { // (the urge to take a bath: in and out of its water, as main.js)
      const b = bathPath(hero.from.perch, fo.t, PERCHES.fountain), F = hero.from.perch;
      pp = { k: 1, dx: b.x, dz: b.z, lift: b.lift, yaw: b.yaw, hop: b.hop, lookUp: 0 };
      while (hero.fount.bathFired < BATH_SPLASH.length && fo.t >= BATH_SPLASH[hero.fount.bathFired][0]) {
        const [, at, n, up] = BATH_SPLASH[hero.fount.bathFired++];
        brick.fx.splashStuds(at === 'mid' ? new THREE.Vector3(F.x + 0.5, STUD_H + PERCHES.fountain.H - FOUNT_DOWN, F.y + 0.5)
          : new THREE.Vector3(hero.pos[0] + 0.5 + pp.dx, pp.lift + 0.6, hero.pos[1] + 0.5 + pp.dz), n, up, at === 'mid' ? {} : { floor: pp.lift, ring: false });
      }
    }
    hero.pp = pp; // (where you're drawn, for the script: the Lady of the Lake's sword)
    if (fo && pp) { // (its water broken as it goes, out in front)
      const cues = FOUNT_SPLASH[fo.act], x = hero.pos[0] + 0.5 + pp.dx, z = hero.pos[1] + 0.5 + pp.dz;
      while (hero.fount.fired < cues.length && fo.t >= cues[hero.fount.fired][0]) {
        const [, n, up, tint] = cues[hero.fount.fired++];
        brick.fx.splashStuds(new THREE.Vector3(x + Math.sin(pp.yaw) * FOUNT_REACH, pp.lift - FOUNT_DOWN, z - Math.cos(pp.yaw) * FOUNT_REACH), n, up, tint ? { tint } : {});
      }
    }
    let sw = null; // (falling into the water, crawling out: swim.js)
    if (hero.swim) {
      const s = hero.swim, t = clock - s.t0;
      sw = swimPose(s, t);
      while (s.fired < SWIM_SPLASH.length && t >= SWIM_SPLASH[s.fired][0]) {
        const [, at, n, up] = SWIM_SPLASH[s.fired++], w = at === 'pool' ? [s.pool[0] + 0.5, s.pool[1] + 0.5] : [(sw ? sw.x : s.pool[0]) + 0.5, (sw ? sw.z : s.pool[1]) + 0.5];
        brick.fx.splashStuds(new THREE.Vector3(w[0], at === 'you' ? 0.45 + (sw ? sw.y : 0) : WATER_Y, w[1]), n, up, at === 'you' ? { floor: STUD_H, ring: false, lava: s.lava } : { lava: s.lava });
      }
      if (!sw) { hero.swim = null; if (s.to) place(s.to[0], s.to[1], hero.yaw); else place(s.pool[0], s.pool[1], hero.yaw); } // (no crawl: still in it)
    }
    let raise = 0; // (Excalibur held high: up fast, held, down again; golden light glinting off it)
    if (hero.raise) {
      const r = hero.raise, t = clock - r.t0, sm = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
      if (t > r.T) { hero.raise = null; hero.exc = false; }
      else {
        raise = sm(t / 0.4) * sm((r.T - t) / 0.5);
        while (r.glint < 3 && t >= 0.45 + r.glint * 0.6) { r.glint++; const yw = pp && pp.k > 0.5 ? pp.yaw : hero.yaw, [tout, tup] = r.tip || [0.3, 1.75]; brick.fx.sparkles(new THREE.Vector3(hero.pos[0] + 0.5 + (pp ? pp.dx : 0) + Math.sin(yw) * tout, tup + (pp ? pp.lift : 0), hero.pos[1] + 0.5 + (pp ? pp.dz : 0) - Math.cos(yw) * tout), 30, r.glint === 2 ? 0xffe27a : 0xffc21a, 0.3); }
      }
    }
    const pose = sw && anim.a ? anim.a.update(dt, { hop: sw.hop, reach: sw.reach, lean: sw.lean }) : anim.a ? anim.a.update(dt, { raise, moving, holdsR: !!hero.hold.R, hop: pp ? pp.hop : 0, lookUp: pp && !fo ? pp.lookUp : 0, fount: fo,
      lean: push > 0 ? 0.3 : 0, reach: push > 0 ? 1 : 0, heavy: anim.state.heavy || 0, speed: anim.state.heavy ? 1.1 : undefined }) : null;
    const inLava = !pp && (level.lava || []).some(([px, pz]) => px === Math.round(hero.pos[0]) && pz === Math.round(hero.pos[1]));
    const wet = inLava || (!pp && (level.pools || []).some(([px, pz]) => px === Math.round(hero.pos[0]) && pz === Math.round(hero.pos[1]))); // (in a pool: sunk to the waist, as main.js heroSink)
    if (inLava && !hero.swim && clock - (hero.smokeT || 0) > 0.45) { // (in lava: smoking, embers flying off you)
      hero.smokeT = clock;
      const sp = new THREE.Vector3(Math.round(hero.pos[0]) + 0.5, 0.2 - hero.sink, Math.round(hero.pos[1]) + 0.5);
      brick.fx.vapor(sp, 0x4a4a4a, 1.6);
      brick.fx.sparkles(sp, 10, 0xff7a1a, 0.3);
    }
    hero.sink = (hero.sink || 0) + ((wet ? 0.4 : 0) - (hero.sink || 0)) * Math.min(1, dt * 6);
    { // (this water's no good, bad breath, a shiver: as main.js heroWisps)
      const wx = hero.pos[0] + 0.5 + (pp ? pp.dx : 0), wy = pp ? pp.lift : -hero.sink, wz = hero.pos[1] + 0.5 + (pp ? pp.dz : 0), yw = pp && pp.k > 0.5 ? pp.yaw : hero.yaw;
      if (hero.puff) { brick.fx.cursePuff(new THREE.Vector3(wx, wy + 0.5, wz)); hero.puff = null; }
      const b = hero.breath;
      if (b) {
        if (clock - b.last > 0.95 && hero.mouth) { b.last = clock; brick.fx.breath(new THREE.Vector3(...hero.mouth), yw); } // (at your mouth, as drawn: mouthPoint)
      }
      if (fo && fo.act === 'shiver' && fo.t > 0.25 && fo.t < 1.6 && clock - (hero.fount.frostT || 0) > 0.16) { hero.fount.frostT = clock; brick.fx.frost(new THREE.Vector3(wx, wy + 0.5, wz)); }
    }
    if (hero.haze && clock - hero.haze.t0 > 4) hero.haze = null; // (poisoned: a purple haze about you a while, as main.js heroHaze)
    if (hero.haze && clock - hero.haze.last > 0.08) {
      hero.haze.last = clock;
      brick.fx.haze(new THREE.Vector3(hero.pos[0] + 0.5 + (pp ? pp.dx : 0), pp ? pp.lift : -hero.sink, hero.pos[1] + 0.5 + (pp ? pp.dz : 0)), 1.1, clock - hero.haze.t0 > 2.8 ? 6 : 12);
    }
    const m = sw ? figureMatrix(sw.x + 0.5, sw.y, sw.z + 0.5, sw.yaw ?? hero.yaw) : figureMatrix(hero.pos[0] + 0.5 + (pp ? pp.dx : 0), pp ? pp.lift : -hero.sink, hero.pos[1] + 0.5 + (pp ? pp.dz : 0), pp && pp.k > 0.5 ? pp.yaw : hero.yaw);
    hero.mouth = pose ? mouthPoint(m, pose) : null; // (bad breath: off your mouth, next frame)
    const figs = [{ url: heroFig.url, matrix: m, pose, hold: fo ? { R: fo.act === 'dip' ? (hero.fount.grab && fo.t > FOUNT.dip.cup + 0.35 ? hero.fount.grab : hero.fount.url) : null, L: null }
      : raise > 0 || hero.exc ? { R: (hero.raise && hero.raise.url) || url('Excalibur'), L: null } : pp && !hero.digging ? { R: null, L: null } : hero.hold }]; // (climbing a statue: hands free)
    for (const c of cobras) {
      let rp = null; // (out of a fountain: up out of its water, over the rim, off to its square: perch.js risePath)
      const half = 0.55, out = c.kind === 'snake' ? half * Math.cos(0.45) : 0.22, up = half * Math.sin(0.45); // (a snake: half its length; as main.js SNAKE_OUT, SNAKE_UP)
      if (c.rise) { const u = (clock - c.rise.t0) / RISE_T; if (u < 0) continue; if (u < 1) rp = risePath(c.rise.f, c.at, u, out); }
      let cx = rp ? rp.x : c.at[0], cz = rp ? rp.z : c.at[1], lean = rp ? rp.lean || 0 : 0, leanYaw = rp ? rp.leanYaw : null;
      const fnt = !rp && drops.find((o) => o.name === 'fountain' && Math.abs(o.x - cx) < 1.6 && Math.abs(o.z - cz) < 1.6), ag = fnt && againstFountain([fnt.x, fnt.z], cx, cz, out);
      if (ag) { cx = ag.x; cz = ag.z; lean = 1; leanYaw = ag.yaw; } // (up against a fountain: out of its wall, a snake leaning back on it: as main.js)
      const hx2 = hero.pos[0] + (pp ? pp.dx : 0), hz2 = hero.pos[1] + (pp ? pp.dz : 0); // (you as drawn: up on a fountain's rim)
      let yaw = rp ? rp.yaw : Math.atan2(hx2 - cx, -(hz2 - cz));
      if (leanYaw != null && c.kind === 'snake') yaw = rp ? yaw + Math.atan2(Math.sin(leanYaw - yaw), Math.cos(leanYaw - yaw)) * lean : leanYaw;
      const L = c.kind === 'snake' ? lean : 0, ca = Math.cos(0.45 * L), sa = Math.sin(0.45 * L);
      const base = partMatrix(cx + 0.5, STUD_H + (rp ? rp.y : 0) + up * L, cz + 0.5, Math.PI - yaw);
      if (c.kind) figs.push({ url: c.url, matrix: mul(L > 0.01 ? mul(base, new Float32Array([1, 0, 0, 0, 0, ca, sa, 0, 0, -sa, ca, 0, 0, 0, 0, 1])) : base, creatureLocal(c.kind, clock, { lungeT: c.lungeAt, moving: !!rp })), pose: null, hold: {} });
      else { // (a naga: leaning in to spit, on coils that weave and lunge)
        const spitting = clock - c.lungeAt < LUNGE_TIME;
        const wt = c.warnAt != null ? clock - c.warnAt : 9, sm = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u)), warn = wt < 1.8 ? sm(wt / 0.3) * sm((1.8 - wt) / 0.4) : 0;
        const pose = c.anim ? c.anim.update(dt, { moving: !!rp, lean: spitting ? 0.35 : 0, reach: spitting ? 0.7 : 0, raise: warn }) : null;
        const fm = figureMatrix(cx + 0.5, (c.lift || 0) + (rp ? rp.y : 0), cz + 0.5, yaw); // (out of a fountain: on its way)
        figs.push({ url: c.url, matrix: c.slither ? mul(fm, slitherLocal(clock, { lungeT: c.lungeAt })) : fm, pose, hold: c.hold ? { R: url(c.hold) } : {} }); // (a watchman's halberd)
      }
    }
    brick.setFigures(figs);
    brick.setPunished(punished);
    brick.setItems(drops);
    // draw, with the orbiting camera
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w; canvas.height = h;
    cam.aspect = w / Math.max(1, h);
    cam.updateProjectionMatrix();
    if (cut) { // (a cutscene, as the game's (main.js cutsceneCamera): slowly round the fountain, low, at you; eased in
      // from where the view was, and back out to it, given back just as it was)
      const t = clock - cut.t0, k = Math.min(1, t / 0.9, (cut.T - t) / 0.9), e = k <= 0 ? 0 : k * k * (3 - 2 * k);
      cut.pos0 = cut.pos0 || cam.position.clone();
      if (!cut.out && cut.T - t < 0.9) { cut.out = true; bars(false); } // (the bars going as the view comes back)
      if (t > cut.T) { cam.position.copy(cut.pos0); cut = null; bars(false); ctl.update(); }
      else {
        const ang = Math.atan2(cut.side[1], cut.side[0]) + 1.3 + 0.08 * t, f = cut.focus;
        const ku = cut.up != null ? Math.max(0, Math.min(1, (t - cut.up) / 0.8)) : 0, k2 = ku * ku * (3 - 2 * ku); // (drawn back and up, to the sword held high)
        const eye = new THREE.Vector3(f[0] + Math.cos(ang) * (2.1 + 0.6 * k2), f[1] + 0.4 + 0.2 * k2, f[2] + Math.sin(ang) * (2.1 + 0.6 * k2));
        const tgt = new THREE.Vector3(f[0] + cut.side[0] * 0.5, f[1] - 0.1 + 0.5 * k2, f[2] + cut.side[1] * 0.5);
        { // (round the fountain, not straight across: never through its walls; as main.js roundAbout)
          const a0 = Math.atan2(cut.pos0.z - f[2], cut.pos0.x - f[0]), r0 = Math.hypot(cut.pos0.x - f[0], cut.pos0.z - f[2]);
          const a1 = Math.atan2(eye.z - f[2], eye.x - f[0]), r1 = Math.hypot(eye.x - f[0], eye.z - f[2]);
          const a = a0 + Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)) * e, r = r0 + (r1 - r0) * e;
          cam.position.set(f[0] + Math.cos(a) * r, cut.pos0.y + (eye.y - cut.pos0.y) * e, f[2] + Math.sin(a) * r);
        }
        cam.lookAt(ctl.target.clone().lerp(tgt, e));
      }
    } else ctl.update();
    cam.updateMatrixWorld();
    brick.render(cam.projectionMatrix.elements, cam.matrixWorldInverse.elements, w, h, [hero.pos[0] + 0.5, 0, hero.pos[1] + 0.5]);
  }
  requestAnimationFrame(frame);
}

// A menagerie (scene.json "level" with "menagerie": rows of monsters, [{monster, at}] in
// "monsters"): each in brick as the game draws it (creature.js), named over its head, facing you;
// each in turn breathing and looking about, trotting, then biting (a lunge), over and over
async function menagerie(level, brick, cam, ctl, canvas) {
  const mons = await (await fetch('assets/brick/monsters.built.json', { cache: 'no-store' })).json();
  const beasts = level.monsters.filter((m) => mons[m.monster]).map((m, i) => ({ ...m, ...mons[m.monster], phase: (i * 0.53) % 7 }));
  for (const b of beasts) if (!b.creature) brick.model(b.url).then((m) => { // (a minifig monster: alive as the hero is)
    let rig = null;
    m.traverse((o) => { if (!rig && o.userData && o.userData.rig) rig = o.userData.rig; });
    b.anim = new FigureAnimator(rig, { phase: b.phase });
    b.anim.spawn();
  });
  const missing = level.monsters.filter((m) => !mons[m.monster]).map((m) => m.monster);
  const el = document.getElementById('status');
  if (el) el.textContent = `${level.title ? level.title + ' · ' : ''}menagerie · ${beasts.length} in brick${missing.length ? ' · not yet: ' + missing.join(', ') : ''} · drag to look, wheel to zoom`;
  // their names, kept over them on screen
  const tags = beasts.map((b) => {
    const t = document.createElement('div');
    t.className = 'tag'; t.textContent = b.monster;
    document.body.appendChild(t);
    return t;
  });
  const v = new THREE.Vector3();
  const PERIOD = 7, TROT = [3, 5.5], BITE = 6;
  let last = performance.now(), clock = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock += dt;
    const figs = beasts.map((b) => {
      const u = (clock + b.phase) % PERIOD, moving = u >= TROT[0] && u < TROT[1];
      const lungeT = clock - (u - BITE) - (u < BITE ? PERIOD : 0); // (when it last bit, on its own clock)
      if (!b.creature) { // (a minifig: walking on the spot, then a swing)
        if (b.anim && b.lastU !== undefined && b.lastU < BITE && u >= BITE) b.anim.attack();
        b.lastU = u;
        return { url: b.url, matrix: figureMatrix(b.at[0] + 0.5, b.lift || 0, b.at[1] + 0.5, Math.PI), pose: b.anim ? b.anim.update(dt, { moving }) : null, hold: {} };
      }
      return { url: b.url, matrix: mul(partMatrix(b.at[0] + 0.5, STUD_H, b.at[1] + 0.5, 0), creatureLocal(b.creature, clock, { moving, lungeT })), pose: null, hold: {} };
    });
    brick.setFigures(figs);
    brick.setItems([]);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w; canvas.height = h;
    cam.aspect = w / Math.max(1, h);
    cam.updateProjectionMatrix();
    ctl.update();
    cam.updateMatrixWorld();
    brick.render(cam.projectionMatrix.elements, cam.matrixWorldInverse.elements, w, h, [ctl.target.x, 0, ctl.target.z]);
    beasts.forEach((b, i) => {
      v.set(b.at[0] + 0.5, 1.15, b.at[1] + 0.5).project(cam);
      const show = v.z < 1;
      tags[i].style.display = show ? '' : 'none';
      if (show) { tags[i].style.left = ((v.x + 1) / 2 * innerWidth) + 'px'; tags[i].style.top = ((1 - v.y) / 2 * innerHeight) + 'px'; }
    });
  }
  requestAnimationFrame(frame);
}

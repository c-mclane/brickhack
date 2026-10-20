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
import { perchSpot, cameFrom, hopOff, offTime, PERCHES, FOUNT_SPLASH, FOUNT_REACH, FOUNT_DOWN } from './perch.js';
import { DRY_GREY, DRY_SIT } from './brickworld.js';
import { creatureLocal, slitherLocal, LUNGE_TIME } from './creature.js';
import { mul } from './minifig-anim.js';

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
  const cam = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  const ctl = new OrbitControls(cam, canvas);
  const W = level.w, H = level.h;
  // the one room: a fountain or a pool in it, its water heard (as the game's: main.js waterNear), once
  // there's been a click or a key (the browser's rule)
  if ((level.items || []).some((it) => it.item === 'fountain') || (level.pools || []).length) {
    const amb = new Ambience(0.6);
    amb.set('water', true);
    const on = () => { amb.allow(); removeEventListener('pointerdown', on); removeEventListener('keydown', on); };
    addEventListener('pointerdown', on);
    addEventListener('keydown', on);
  }
  cam.position.set(...(level.camera ? level.camera.pos : [W / 2, 11, H + 3])); // (or where the level says to look from)
  ctl.target.set(...(level.camera ? level.camera.target : [W / 2, 0, H / 2 + 0.5]));

  // the room: a floor of plates, walls all round; water where scene.json has "pools" (and where more's been
  // let in: a fountain gushing, extra)
  const room = (extra = []) => {
    const floors = [], walls = [], pools = [], wet = (level.pools || []).concat(extra);
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++) {
        if (x === 0 || z === 0 || x === W - 1 || z === H - 1) walls.push({ x, z, shade: 1 });
        else if (wet.some(([px, pz]) => px === x && pz === z)) pools.push({ x, z, shade: 1 });
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
      const doing = (p) => !part || part === p;
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
        const [fx, fz] = st.at, wet = [];
        for (let z = 1; z < H - 1; z++)
          for (let x = 1; x < W - 1; x++) { // (as the game picks them: every other square, not the fountain's own, out to 3; here, clear of its basin)
            const d = Math.max(Math.abs(x - fx), Math.abs(z - fz));
            if ((x + z) % 2 === 0 && d >= 2 && d <= 3 && !(level.pools || []).some(([a, b]) => a === x && b === z)) wet.push([x, z]);
          }
        brick.gushBurst(fx, fz);
        wet.forEach(([x, z], i) => brick.gushTo(fx, fz, x, z, 0.15 + 0.12 * Math.hypot(x - fx, z - fz) + 0.03 * i));
        room(wet); // (the map: those are pools now)
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
  addEventListener('keydown', (e) => { if (e.key === 'p' || e.key === 'P') paused = !paused; }); // P: hold everything still
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = paused ? 0 : Math.min(0.1, (now - last) / 1000);
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
    if (hero.leap) { // (the statue gone from under you: off the ledge, as the game plays it, perch.js hopOff)
      const L = hero.leap, dest = [L.side.wx * 0.42, L.side.wz * 0.42], u = clock - L.t0;
      if (u >= offTime(L.side, L.side)) { hero.leap = null; hero.after = dest; hero.from.perch = null; }
      else { const o = hopOff(L.side, L.side, dest, u, L.pr); pp = { k: 1, dx: o.x, dz: o.z, lift: o.lift, yaw: o.yaw, hop: o.hop, lookUp: 0 }; }
    }
    if (!pp && hero.after) pp = { k: 0, dx: hero.after[0], dz: hero.after[1], lift: 0, hop: 0, lookUp: 0 };
    const push = Math.max(0, 1 - (clock - (anim.pushT0 ?? -1e9)) / 0.7);
    const fo = hero.fount && clock - hero.fount.t0 < FOUNT[hero.fount.act].T ? { act: hero.fount.act, t: clock - hero.fount.t0 } : null;
    if (fo && pp) { // (its water broken as it goes, out in front)
      const cues = FOUNT_SPLASH[fo.act], x = hero.pos[0] + 0.5 + pp.dx, z = hero.pos[1] + 0.5 + pp.dz;
      while (hero.fount.fired < cues.length && fo.t >= cues[hero.fount.fired][0]) {
        const [, n, up] = cues[hero.fount.fired++];
        brick.fx.splashStuds(new THREE.Vector3(x + Math.sin(pp.yaw) * FOUNT_REACH, pp.lift - FOUNT_DOWN, z - Math.cos(pp.yaw) * FOUNT_REACH), n, up);
      }
    }
    let sw = null; // (falling into the water, crawling out: swim.js)
    if (hero.swim) {
      const s = hero.swim, t = clock - s.t0;
      sw = swimPose(s, t);
      while (s.fired < SWIM_SPLASH.length && t >= SWIM_SPLASH[s.fired][0]) {
        const [, at, n, up] = SWIM_SPLASH[s.fired++], w = at === 'pool' ? [s.pool[0] + 0.5, s.pool[1] + 0.5] : [(sw ? sw.x : s.pool[0]) + 0.5, (sw ? sw.z : s.pool[1]) + 0.5];
        brick.fx.splashStuds(new THREE.Vector3(w[0], at === 'you' ? 0.45 + (sw ? sw.y : 0) : WATER_Y, w[1]), n, up, at === 'you' ? { floor: STUD_H, ring: false } : {});
      }
      if (!sw) { hero.swim = null; if (s.to) place(s.to[0], s.to[1], hero.yaw); }
    }
    const pose = sw && anim.a ? anim.a.update(dt, { hop: sw.hop, reach: sw.reach, lean: sw.lean }) : anim.a ? anim.a.update(dt, { moving, holdsR: !!hero.hold.R, hop: pp ? pp.hop : 0, lookUp: pp && !fo ? pp.lookUp : 0, fount: fo,
      lean: push > 0 ? 0.3 : 0, reach: push > 0 ? 1 : 0, heavy: anim.state.heavy || 0, speed: anim.state.heavy ? 1.1 : undefined }) : null;
    const wet = !pp && (level.pools || []).some(([px, pz]) => px === Math.round(hero.pos[0]) && pz === Math.round(hero.pos[1])); // (in a pool: sunk to the waist, as main.js heroSink)
    hero.sink = (hero.sink || 0) + ((wet ? 0.4 : 0) - (hero.sink || 0)) * Math.min(1, dt * 6);
    const m = sw ? figureMatrix(sw.x + 0.5, sw.y, sw.z + 0.5, sw.yaw ?? hero.yaw) : figureMatrix(hero.pos[0] + 0.5 + (pp ? pp.dx : 0), pp ? pp.lift : -hero.sink, hero.pos[1] + 0.5 + (pp ? pp.dz : 0), pp && pp.k > 0.5 ? pp.yaw : hero.yaw);
    const figs = [{ url: heroFig.url, matrix: m, pose, hold: fo ? { R: fo.act === 'dip' ? hero.fount.url : null, L: null } : pp ? { R: null, L: null } : hero.hold }]; // (climbing a statue: hands free)
    for (const c of cobras) {
      const yaw = Math.atan2(hero.pos[0] - c.at[0], -(hero.pos[1] - c.at[1]));
      if (c.kind) figs.push({ url: c.url, matrix: mul(partMatrix(c.at[0] + 0.5, STUD_H, c.at[1] + 0.5, Math.PI - yaw), creatureLocal(c.kind, clock, { lungeT: c.lungeAt })), pose: null, hold: {} });
      else { // (a naga: leaning in to spit, on coils that weave and lunge)
        const spitting = clock - c.lungeAt < LUNGE_TIME;
        const pose = c.anim ? c.anim.update(dt, { lean: spitting ? 0.35 : 0, reach: spitting ? 0.7 : 0 }) : null;
        const fm = figureMatrix(c.at[0] + 0.5, c.lift || 0, c.at[1] + 0.5, yaw);
        figs.push({ url: c.url, matrix: c.slither ? mul(fm, slitherLocal(clock, { lungeT: c.lungeAt })) : fm, pose, hold: {} });
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
    ctl.update();
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

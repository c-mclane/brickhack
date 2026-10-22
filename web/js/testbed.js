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
import { FigureAnimator, FOUNT, LOOSE_AT, NOCKED, nockAt, fountKey } from './minifig-anim.js';
import { Ambience } from './music.js';
import { swimPose, SWIM_SPLASH, WATER_Y, FALL_T, CRAWL_T } from './swim.js';
import { figureMatrix, partMatrix, STUD_H } from './brick.js';
import { perchSpot, cameFrom, hopOff, offTime, PERCHES, FOUNT_SPLASH, FOUNT_REACH, FOUNT_DOWN, bathPath, BATH_SPLASH, sitPath, risePath, RISE_T, againstFountain } from './perch.js';
import { DRY_GREY, DRY_SIT, LADY_T, PRAY_OUTCOME, PRAY_AFTER, prayAfter } from './brickworld.js';
import { creatureLocal, slitherLocal, LUNGE_TIME } from './creature.js';
import { mul, mouthPoint } from './minifig-anim.js';
import { NameTags } from './nametags.js';
import { AltarRites } from './rites.js';

const STEP_TIME = 0.32; // s a square, walking

export async function runTestbed(data) {
  const level = data.level;
  const items = await (await fetch('assets/brick/items.built.json', { cache: 'no-store' })).json();
  const url = (name) => (items[name] ? items[name].url : null);
  const heroFig = data.objects.find((o) => o.hero);

  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%' });
  document.body.prepend(canvas);
  // name tags over the monsters, as the game's (nametags.js; its look, style.css .nametag)
  const tagLayer = document.createElement('div');
  Object.assign(tagLayer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
  document.body.appendChild(tagLayer);
  const tagStyle = document.createElement('style');
  tagStyle.textContent = `.nametag { position: absolute; left: 0; top: 0; padding: 1px 6px 2px; background: rgba(0, 0, 0, .42); color: #fff;
    font: 18px/1.15 monospace; white-space: nowrap; transform-origin: 50% 100%; text-shadow: 2px 2px 0 #3f3f3f; }
    .nametag.hostile { color: #ffe0e0; } .nametag.peaceful { color: #bfeaff; } .nametag.tame { color: #9dff9d; }`;
  document.head.appendChild(tagStyle);
  const tags = new NameTags(tagLayer);
  const gl = canvas.getContext('webgl2', { antialias: true });
  const brick = new BrickWorld(canvas, gl);
  brick.coinUrl = url('_coin'); // (gold in a fountain: coins strewn in its basin)
  const cam = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  const ctl = new OrbitControls(cam, canvas);
  const W = level.w, H = level.h;
  // the one room: a fountain or a pool in it, its water heard, lava, its flow (as the game's: main.js
  // roomNear), once there's been a click or a key (the browser's rule)
  const hasWater = (level.items || []).some((it) => it.item === 'fountain') || (level.pools || []).length, hasLava = (level.lava || []).length;
  const amb = new Ambience(0.6); // (and the Agnus Dei, chanted through the Mass)
  if (hasWater) amb.set('water', true);
  if (hasLava) amb.set('lava', true);
  const hear = () => { amb.allow(); removeEventListener('pointerdown', hear); removeEventListener('keydown', hear); };
  addEventListener('pointerdown', hear);
  addEventListener('keydown', hear);
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
        else if (!(level.stairs || []).some((st) => !st.up && st.at[0] === x && st.at[1] === z)
          && !(level.items || []).some((it) => it.at[0] === x && it.at[1] === z && (items[it.item] || {}).sunk)) floors.push({ x, z, studs: true, shade: 1 }); // (stairs down: a hole; a pit, a hole: its own shaft)
      }
    // stairs (scene.json "stairs": [{at, up}]), run toward the wall nearest, as the game's (world.js backToWall)
    const wallBy = (x, z) => x === 0 || z === 0 || x === W - 1 || z === H - 1;
    const stairs = (level.stairs || []).map((st) => {
      const [x, z] = st.at, d = [[0, -1], [1, 0], [0, 1], [-1, 0]].find(([dx, dz]) => wallBy(x + dx, z + dz));
      return { x, z, up: !!st.up, turn: d ? Math.atan2(-d[0], -d[1]) : 0, shade: 1 };
    });
    brick.setTerrain({ floors, walls, pools, doors: [], fog: [], stairs, w: W, h: H, style: level.style || null }); // (scene.json "style": "mines")
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
      return { x: i.at[0], z: i.at[1], url: url(i.item), level, upright: !!(items[i.item] || {}).upright, anchored: !!(items[i.item] || {}).anchored, sunk: !!(items[i.item] || {}).sunk, offer: (items[i.item] || {}).offer, spots: (items[i.item] || {}).spots, name: i.item }; });
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

  // the Mass (?part=mass): the altar's statues come alive ([{url, x, y, z, yaw, fade, anim, act, moving, hop}]), and
  // a glow over what's raised at an elevation
  // the rites at the altar of a follower of Jesus (rites.js): its statues come alive, the wafer, the chalice...
  const rites = new AltarRites({ brick, clock: () => clock, wait: (s) => wait(s), say: (t) => say(t), angelUrl: null, chant: (on) => amb.set('mass', on),
    url: (n) => url(n), upright: (n) => !!(items[n] || {}).upright,
    hero: { act: (n) => { hero.fount = n ? { act: n, t0: clock, fired: 0 } : null; }, hold: (h) => { hero.hold = h ? { R: h.R ?? null, L: h.L ?? null } : { R: null }; } } });
  let rosterUrls = null; // (the figures, by id: roster.built.json)
  const roster = async () => rosterUrls || (rosterUrls = Object.fromEntries((await (await fetch('assets/brick/roster.built.json', { cache: 'no-store' })).json()).map((r) => [r.id, r.url])));
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

  // a steed's saddle: how high you sit on it (your feet, astride: the saddle's top, less your hips' height), and how
  // long getting up onto it or down off it takes
  const SADDLE_Y = STUD_H + 96 * 0.85 / 80 - 28 / 80, MOUNT_T = 0.9;
  // (a trap's: you flinching, or caught fast and struggling: hero.shake {t0, T, amp, fast}; your x, shaken)
  const trapShake = () => { const s = hero.shake; if (!s) return 0; const u = (clock - s.t0) / s.T; if (u >= 1) { hero.shake = null; return 0; } return s.amp * (1 - u) * Math.sin(u * (s.fast ? 120 : 60)); };
  let shake = null; // the view shaken a moment ({t0, T}: a god's voice, lightning)
  let punished = null; // the ball and chain, when punished (brickworld.setPunished, as the game sets it)
  // the monsters: creatures (creature.js) facing you
  const mons = await (await fetch('assets/brick/monsters.built.json', { cache: 'no-store' })).json();
  const cobras = (level.monsters || []).filter((m) => mons[m.monster]).map((m) => ({ ...m, ...mons[m.monster], kind: mons[m.monster].creature, lungeAt: -1e9 }));
  for (const c of cobras) if (c.rider) brick.model(c.rider.url).then((m) => { // (a centaur: its man half alive as the hero is, on its horse)
    let rig = null;
    m.traverse((o) => { if (!rig && o.userData && o.userData.rig) rig = o.userData.rig; });
    c.riderAnim = new FigureAnimator(rig, { phase: Math.random() * 3 });
  });
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
      const rest = (level.items || []).filter((i) => !['statue', 'fountain', 'boulder', 'heavy iron ball'].includes(i.item)); // (anything else the scene has: a sink...)
      lay([st, bo, ...rest]);
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
      // a sink (?part=sink): stood at, a sip from its tap (cold, scalding, a potion's colour), its pipes clanking, a
      // song from the sewers, sewage, a sewer rat up out of its drain, a ring found in it; then kicked (klunk,
      // muddy waste and a ring, a black ooze), a ring dropped down its drain, and its pipes broken: a fountain
      const sk = at('sink');
      if (doing('sink') && sk) {
        room();
        lay([sk]);
        hero.hold = { R: null };
        const [sx, sz] = sk.at;
        // (round to its front, and up to it)
        await walk([[1, 0], [1, 0], [0, 1], [1, 0], [0, -1]]);
        await wait(0.8);
        const spout = () => brick.sinkSpout(sx, sz), drain = () => brick.sinkDrain(sx, sz);
        const sip = async (msg, { tint = null, then = null } = {}) => {
          hero.fount = { act: 'sip', t0: clock, fired: 0 };
          await wait(0.3);
          brick.fx.pour(spout(), drain().y, 1.2, { tint });
          await wait(FOUNT.sip.cup);
          say(msg);
          if (then) then();
          await wait(FOUNT.sip.T - FOUNT.sip.cup - 0.3 + 0.8);
        };
        await sip('You take a sip of very cold water.', { then: () => { for (let i = 0; i < 4; i++) setTimeout(() => brick.fx.frost(drain().clone().setY(drain().y + 0.15)), i * 250); } });
        await sip('You take a sip of scalding hot water.', { then: () => { for (let i = 0; i < 5; i++) setTimeout(() => brick.fx.vapor(drain(), 0xf2f6f8, 1.3), i * 200); } });
        hero.fount = { act: 'scald', t0: clock, fired: 0 };
        await wait(FOUNT.scald.T + 0.6);
        await sip('Some puce liquid flows from the faucet.', { tint: 0xc0608a });
        await sip('You hear clanking from the pipes...', { then: () => brick.sinkShake(sx, sz, 1.2) });
        await sip('You hear snatches of song from among the sewers...', { then: () => brick.fx.notes(drain(), 6) });
        await sip('Gaggg... this tastes like sewage!  You vomit.', { tint: 0x7a6a3a });
        hero.fount = { act: 'sinkRetch', t0: clock, fired: 0 };
        for (let i = 0; i < 3; i++) setTimeout(() => brick.fx.splashStuds(drain(), 5, 0.5, { tint: 0x8c8a3a }), 500 + i * 330);
        await wait(FOUNT.retch.T + 0.6);
        // (a sewer rat up out of its drain, over the rim, onto the square beside you)
        hero.fount = { act: 'sip', t0: clock, fired: 0 };
        await wait(FOUNT.sip.cup);
        if (mons['sewer rat']) {
          say('Eek!  There\'s a sewer rat in the sink!');
          const rat = { monster: 'sewer rat', at: [sx + 1, sz], ...mons['sewer rat'], kind: mons['sewer rat'].creature, lungeAt: -1e9, rise: { f: [sx, sz], t0: clock, sink: true } };
          brick.fx.splashStuds(drain(), 8, 1.2);
          cobras.push(rat);
          await wait(RISE_T + 2);
          cobras.splice(cobras.indexOf(rat), 1);
        }
        // (a ring found in it: reached in for, and held up high)
        say('You find a ring in the sink!');
        hero.fount = { act: 'reach', t0: clock, fired: 0, url: null, grab: url('ring of adornment') };
        brick.fx.sparkles(drain(), 16, 0xfff2b0, 0.15);
        await wait(FOUNT.reach.T - 0.3);
        hero.raise = { t0: clock, T: 2.4, glint: 0, url: url('ring of adornment'), tip: [0.22, 1.3] };
        await wait(2.6);
        lay([sk, { item: 'ring of adornment', at: sk.at }]);
        await wait(1.2);
        lay([sk]);
        // (a step back from it, and kicked)
        await walk([[0, 1]]);
        hero.yaw = 0;
        await wait(0.6);
        const kick = async (msg, then) => {
          hero.fount = { act: 'kick', t0: clock, fired: 0 };
          await wait(0.38);
          brick.sinkShake(sx, sz, 0.6, 0.04);
          say(msg);
          if (then) then();
          await wait(FOUNT.kick.T + 1.4);
        };
        await kick('Klunk!  The pipes vibrate noisily.');
        await kick('Flupp!  Muddy waste pops up from the drain.', () => {
          brick.fx.splashStuds(drain(), 18, 1.6, { tint: 0x6b5233 });
          setTimeout(() => { say('You see a ring shining in its midst.'); lay([sk, { item: 'ring of adornment', at: sk.at }]); brick.fx.sparkles(drain(), 18, 0xfff2b0, 0.15); }, 900);
        });
        lay([sk]);
        await kick('A black ooze gushes up from the drain!', () => { for (let i = 0; i < 4; i++) setTimeout(() => brick.fx.splashStuds(drain(), 12, 1.4, { tint: 0x1a1a1a }), i * 180); });
        // (back up to it, and a ring dropped down its drain)
        await walk([[0, -1]]);
        await wait(0.6);
        say('You drop a ruby ring down the drain.');
        await brick.sinkSwallow(sx, sz, url('ring of adornment'));
        await wait(1.4);
        // (its pipes broken: water spurting out, the sink burst apart, a fountain there now)
        hero.fount = { act: 'sip', t0: clock, fired: 0 };
        await wait(FOUNT.sip.cup);
        say('The pipes break!  Water spurts out!');
        brick.sinkBreak(sx, sz);
        lay([{ item: 'fountain', at: sk.at }]);
        await wait(5);
        say('');
      }
      // a toilet (?part=toilet): stood at, bent down over it, a drink from it; sewage: retching into it
      const tl = at('toilet');
      if (doing('toilet') && tl) {
        room();
        lay([tl]);
        hero.hold = { R: null };
        const [tx, tz] = tl.at, water = () => brick.toiletWater(tx, tz);
        // (round to its front, and up to it)
        await walk([...Array(Math.max(0, tx - hero.sq.x)).fill([1, 0]), ...Array(Math.max(0, hero.sq.y - tz - 1)).fill([0, -1]), [0, -1]]);
        await wait(0.8);
        say('You drink from the toilet...');
        hero.fount = { act: 'gulp', t0: clock, fired: 0 };
        for (const t of [0.55, 0.95, 1.35, 1.75]) setTimeout(() => brick.fx.splashStuds(water(), 3, 0.4), t * 1000);
        await wait(FOUNT.gulp.T - 0.4);
        // (a baby crocodile: up out of the bowl, over the seat, and down onto the floor beside you)
        if (mons['baby crocodile']) {
          say('Egad!  There\'s a baby crocodile in the toilet!');
          const croc = { monster: 'baby crocodile', at: [tx + 1, tz], ...mons['baby crocodile'], kind: mons['baby crocodile'].creature, lungeAt: -1e9, rise: { f: [tx, tz], t0: clock, sink: 'toilet' } };
          brick.fx.splashStuds(water(), 10, 1.3);
          cobras.push(croc);
          await wait(RISE_T + 0.6);
          croc.lungeAt = clock; // (and a snap at you)
          await wait(2.2);
          cobras.splice(cobras.indexOf(croc), 1);
        }
        const drink = async () => {
          say('You drink from the toilet...');
          hero.fount = { act: 'gulp', t0: clock, fired: 0 };
          for (const t of [0.55, 0.95, 1.35, 1.75]) setTimeout(() => brick.fx.splashStuds(water(), 3, 0.4), t * 1000);
          await wait(FOUNT.gulp.T - 0.4);
        };
        // (a sewer rat, up out of it, as the crocodile)
        await drink();
        if (mons['sewer rat']) {
          say('Eek!  There\'s a sewer rat in the toilet!');
          const rat = { monster: 'sewer rat', at: [tx + 1, tz], ...mons['sewer rat'], kind: mons['sewer rat'].creature, lungeAt: -1e9, rise: { f: [tx, tz], t0: clock, sink: 'toilet' } };
          brick.fx.splashStuds(water(), 8, 1.2);
          cobras.push(rat);
          await wait(RISE_T + 2);
          cobras.splice(cobras.indexOf(rat), 1);
        }
        // (something heaving up out of it, and slithering back down)
        await drink();
        say('Something begins to crawl out of the toilet!');
        const ooze = brick.toiletOoze(tx, tz, true);
        await wait(2.3);
        say('But it slithers back out of sight.');
        await ooze;
        await wait(0.8);
        // (no crocodiles left: a stink off it)
        await drink();
        say('The toilet smells fishy.');
        for (let i = 0; i < 4; i++) setTimeout(() => brick.fx.vapor(water(), 0xa3ab78, 0.7), i * 350);
        await wait(2.6);
        await drink();
        say('Gaggg... this tastes like sewage!  You vomit.');
        hero.fount = { act: 'toiletRetch', t0: clock, fired: 0 };
        for (const t of [0.5, 0.82, 1.15, 1.5]) setTimeout(() => brick.fx.splashStuds(water(), 6, 0.6, { tint: 0x7a6a3a }), t * 1000);
        await wait(FOUNT.retch.T + 1);
        // (sat on: round, down onto its seat, a strain, and up again)
        say('You sit on the toilet.');
        hero.fount = { act: 'sit', t0: clock, fired: 0 };
        await wait(2.3);
        say('You grunt.');
        await wait(FOUNT.sit.T - 2.3 + 0.6);
        // (prayed at)
        say('You pray to the Porcelain God.');
        hero.fount = { act: 'pray', t0: clock, fired: 0 };
        await wait(1.8);
        say('He ignores your pleas.');
        await wait(FOUNT.pray.T - 1.8 + 0.6);
        // (a dagger dipped in it)
        hero.hold = { R: url('dagger') };
        say('You dip the dagger into the toilet.');
        hero.fount = { act: 'toiletDip', t0: clock, fired: 0, url: url('dagger') };
        for (const t of [0.6, 1.0, 1.4]) setTimeout(() => brick.fx.splashStuds(water(), 5, 0.7, { tint: 0x7a6a3a }), t * 1000);
        await wait(1.2);
        say('You cover it in filth.  Yuck!');
        await wait(FOUNT.dip.T - 1.2 + 0.6);
        hero.hold = { R: null };
        // (a step back, and kicked: klunk; and again: it shatters, a fountain there now, a brood of crocodiles out of
        // its pipes every way)
        await walk([[0, 1]]);
        hero.yaw = 0;
        await wait(0.5);
        const kick = async (msg) => {
          hero.fount = { act: 'kick', t0: clock, fired: 0 };
          await wait(0.38);
          brick.sinkShake(tx, tz, 0.6, 0.04, 'toilet');
          say(msg);
          await wait(FOUNT.kick.T + 1.2);
        };
        await kick('Klunk!');
        hero.fount = { act: 'kick', t0: clock, fired: 0 };
        await wait(0.38);
        say('Klunk!  The toilet suddenly shatters!');
        brick.sinkBreak(tx, tz, 'toilet');
        lay([{ item: 'fountain', at: tl.at }]);
        await wait(0.9);
        say('Oh no!  Crocodiles come out from the pipes!');
        const brood = [[tx - 1, tz], [tx + 1, tz], [tx - 1, tz + 1], [tx + 1, tz + 1], [tx, tz + 2]].filter(([x, z]) => x > 0 && x < level.w - 1 && z > 0 && z < level.h - 1)
          .map((at, i) => ({ monster: 'baby crocodile', at, ...mons['baby crocodile'], kind: mons['baby crocodile'].creature, lungeAt: -1e9, rise: { f: [tx, tz], t0: clock + i * 0.3 } }));
        if (mons['baby crocodile']) cobras.push(...brood);
        await wait(RISE_T + 3.5);
        for (const c of brood) cobras.splice(cobras.indexOf(c), 1);
        say('');
      }
      // a chest kicked (?part=chest): THUD, and it jumps; something inside it shattering (its glass and what was in it
      // out of the seam of its lid); its lid slammed open and falling shut; and then opened, looked into, and shut
      const ch = at('chest') || at('large box');
      if (doing('chest') && ch) {
        room();
        lay([ch]);
        hero.hold = { R: null };
        const [bx, bz] = ch.at;
        await walk(Array(Math.max(0, bx - 1 - hero.sq.x)).fill([1, 0]));
        hero.yaw = Math.PI / 2;
        await wait(0.8);
        const kick = async (msg, act, tint) => {
          hero.fount = { act: 'kick', t0: clock, fired: 0 };
          await wait(0.38);
          brick.boxFx(bx, bz, 'thud');
          say('WHAMM!!  THUD!');
          if (act) { await wait(0.15); say(msg); brick.boxFx(bx, bz, act, tint); }
          await wait(FOUNT.kick.T + 1.6);
        };
        await kick();
        await kick('You hear a muffled shatter.', 'shatter', 0xc0608a);
        await kick('The lid slams open, then falls shut.', 'slam');
        say('You carefully open the chest...');
        brick.setLid(bx, bz, true);
        await wait(2.5);
        say('You close the chest.');
        brick.setLid(bx, bz, false);
        await wait(2);
        say('');
      }
      // praying (?part=pray): down on your knees, arms raised, and how it goes, one way after another: heard (a column
      // of golden light down onto you, a halo spreading, gold rising; your god well-pleased), too soon (a light that
      // stutters and dies, ash), and angered (a storm gathering over you: a black glow; a voice; lightning)
      if (doing('pray')) {
        room();
        lay([]);
        hero.hold = { R: null };
        await wait(1);
        const x = hero.pos[0] + 0.5, z = hero.pos[1] + 0.5;
        const pray = async (n, act, outcome, during) => {
          say('You begin praying to Lugh.');
          hero.fount = { act: 'prayer', t0: clock, fired: 0 };
          const st = brick.prayBegin(x, z, n);
          if (during) { await wait(1.6); say(during); await wait(PRAY_OUTCOME - 1.6); } else await wait(PRAY_OUTCOME);
          say('You finish your prayer.');
          await wait(0.6);
          say(outcome);
          brick.prayOutcome(x, z, act, act === 'pleased' ? 3 : 0, st);
          if (act === 'lessons' || act === 'bolt') shake = { t0: clock, T: act === 'bolt' ? 0.6 : 1.4 };
          await wait(PRAY_AFTER - PRAY_OUTCOME - 0.6);
          const after = prayAfter(act);
          if (after) { hero.fount = { act: after, t0: clock, fired: 0 }; await wait(FOUNT[after].T); }
          await wait(1.5);
        };
        await pray(3, 'pleased', 'You feel that Lugh is well-pleased.', 'You are surrounded by a shimmering light.');
        await pray(0, 'toosoon', 'You feel that Lugh is displeased.');
        await pray(1, 'blackglow', 'A black glow surrounds you.');
        await pray(1, 'lessons', '"Thou hast strayed from the path, mortal.  Thou must relearn thy lessons!"');
        await pray(1, 'bolt', 'Suddenly, a bolt of lightning strikes you!');
        say('');
      }
      // traps (?part=traps: every kind, items.json "_trap ...", in rows): walked up to from the south, stepped onto,
      // sprung (brickworld trapFx: what it does in the world), what it does to you (dropped into a pit, down a hole,
      // gone in a flash and back, caught fast, turned into something else a moment), and back off it
      if (doing('traps')) {
        const ease = async (key, to, T) => { const from = hero[key] || 0, t0 = clock; while (clock - t0 < T) { const u = (clock - t0) / T; hero[key] = from + (to - from) * u * u * (3 - 2 * u); await wait(0); } hero[key] = to; };
        const flinch = (T = 0.35) => { hero.shake = { t0: clock, T, amp: 0.05 }; };
        const stuck = (T = 1.6) => { hero.shake = { t0: clock, T, amp: 0.035, fast: true }; };
        const fx = { arrow: url('arrow'), dart: url('dart'), rock: url('rock'), boulder: url('boulder') };
        const TRAPS = [
          ['arrow trap', 'arrow', 'An arrow shoots out at you! You are hit by an arrow.'],
          ['dart trap', 'dart', 'A little dart drops on you! You are hit by a little dart.'],
          ['falling rock trap', 'rock', 'A trap door in the ceiling opens and a rock falls on your head! Fortunately, you are wearing a hard hat.'],
          ['squeaky board', 'squeak', 'A board beneath you squeaks loudly.'],
          ['bear trap', 'bear', 'A bear trap closes on your foot!'],
          ['land mine', 'mine', 'KAABLAMM!!! You triggered a land mine!'],
          ['rolling boulder trap', 'boulder', 'Click! You trigger a rolling boulder trap! You are hit by a boulder!'],
          ['sleeping gas trap', 'gas', 'A cloud of gas puts you to sleep!'],
          ['rust trap', 'rust', 'A gush of water hits you!'],
          ['fire trap', 'fire', 'A tower of flame erupts from the floor!'],
          ['pit', 'pit', 'You fall into a pit!'],
          ['spiked pit', 'spiked', 'You fall into a pit! You land on a set of sharp iron spikes!'],
          ['hole', 'hole', 'There\'s a gaping hole under you! You fall through...'],
          ['trap door', 'trapdoor', 'A trap door opens up under you! You fall through...'],
          ['teleportation trap', 'tele', 'You feel a wrenching sensation.'],
          ['level teleporter', 'level', 'You feel a wrenching sensation. You are momentarily blinded by a flash of light.'],
          ['magic portal', 'portal', 'You feel dizzy for a moment, but the sensation passes.'],
          ['web', 'web', 'You stumble into a spider web.'],
          ['magic trap', 'magic', 'You are caught in a magical explosion!'],
          ['anti-magic field', 'antimagic', 'You feel momentarily lethargic.'],
          ['polymorph trap', 'poly', 'You feel a change coming over you. You turn into a Keystone Kop!'],
        ];
        const at = (name) => (level.items || []).find((it) => it.item === name || it.item === '_trap ' + name);
        for (const [name, kind, msg] of TRAPS) {
          const it = at(name);
          if (!it) continue;
          const [tx, tz] = it.at;
          // (round to the square south of it (down a column between the traps, to another row), and up onto it)
          if (hero.sq.y !== tz + 1) {
            while (hero.sq.x !== tx - 1) await step(Math.sign(tx - 1 - hero.sq.x), 0);
            while (hero.sq.y !== tz + 1) await step(0, Math.sign(tz + 1 - hero.sq.y));
          }
          while (hero.sq.x !== tx) await step(Math.sign(tx - hero.sq.x), 0);
          await step(0, -1);
          say(msg);
          const sprung = brick.trapFx(kind, tx, tz, fx);
          switch (kind) {
            case 'arrow': case 'dart': case 'rock': await wait(0.35); flinch(); break;
            case 'bear': case 'web': await wait(0.1); stuck(1.8); await wait(1.8); if (kind === 'bear') brick.setLid(tx, tz, false, 0.4); break;
            case 'mine': flinch(0.6); await ease('trapY', 0.7, 0.25); await ease('trapY', 0, 0.3); lay((level.items = level.items.filter((o) => o !== it))); break;
            case 'boulder': await wait(1.1); flinch(0.5); break;
            case 'gas': await wait(0.4); await ease('trapY', -0.25, 0.5); await wait(1.2); await ease('trapY', 0, 0.4); break;
            case 'rust': case 'fire': case 'magic': case 'antimagic': await wait(0.25); flinch(0.6); break;
            case 'pit': case 'spiked': // (down into it, a while, and clambering out)
              await ease('trapY', -0.55, 0.22); if (kind === 'spiked') { flinch(0.5); brick.flash(new THREE.Vector3(tx + 0.5, 0.2, tz + 0.5), 0xff2020, { size: 0.8, T: 0.4 }); }
              await wait(1.2); say('You crawl to the edge of the pit.'); await ease('trapY', 0, 0.7); break;
            case 'hole': case 'trapdoor': // (down through it, out of sight; and back, as if from the level above)
              await wait(0.15); await Promise.all([ease('trapY', -1.6, 0.5), ease('fade', 0, 0.5)]); hero.fade = 0; await wait(0.8);
              if (kind === 'trapdoor') brick.setLid(tx, tz, false, 0.5);
              hero.trapY = 0; place(tx, tz + 1, 0); await ease('fade', 1, 0.5); hero.fade = undefined; break;
            case 'tele': case 'level': case 'portal': // (gone, and back somewhere else)
              await wait(0.2); await Promise.all([ease('fade', 0, 0.35), kind === 'level' ? ease('trapY', 0.8, 0.35) : wait(0)]); hero.fade = 0; await wait(0.5);
              hero.trapY = 0; place(tx, tz + 1, 0); await ease('fade', 1, 0.45); hero.fade = undefined; break;
            case 'poly': // (a Keystone Kop a while, and yourself again)
              await wait(0.2); hero.polyUrl = (mons['Keystone Kop'] || {}).url; await wait(2.2);
              say('You return to human form!'); brick.trapFx('poly', tx, tz, fx); hero.polyUrl = null; break;
          }
          await sprung;
          await wait(0.6);
          if (hero.sq.y === tz) await step(0, 1); // (back off it)
        }
        say('');
      }
      // a monster slain (?part=explode, on its own: it goes on and on): blown apart into its bricks, scattering about its
      // square, white studs flying; and back again, to be slain again
      if (part === 'explode') {
        const c = cobras[0];
        if (c) for (;;) {
          await wait(1.6);
          say(`You kill the ${c.monster}!`);
          brick.shatterFigureAt(c.at[0], c.at[1]);
          c.gone = true;
          await wait(3.4);
          c.gone = false; say('');
        }
      }
      // archery (?part=archery: a centaur, and you with a bow): arrows loosed back and forth, flat and fast, each stuck in the
      // floor where it comes down, left lying there; each archer (you, the centaur's man half) into the stance, aimed, drawn,
      // let go, held, and back to how it stood (FOUNT.loose)
      const archer = cobras.find((c) => /centaur/.test(c.monster));
      if (doing('archery') && archer) {
        const stuck = [];
        const shoot = async (fromSq, toSq, by) => {
          if (by === 'hero') { // (turned smoothly to the target first)
            const want = Math.atan2(toSq[0] - fromSq[0], -(toSq[1] - fromSq[1])), y0 = hero.yaw, d = Math.atan2(Math.sin(want - y0), Math.cos(want - y0)), t0 = clock;
            while (clock - t0 < 0.35) { const u = (clock - t0) / 0.35; hero.yaw = y0 + d * u * u * (3 - 2 * u); await wait(0); }
            hero.yaw = want;
            hero.fount = { act: 'loose', t0: clock, fired: 0 };
          }
          else archer.looseAt = clock;
          await wait(LOOSE_AT);
          brick.fx.launch(url('arrow'), fromSq[0], fromSq[1], toSq[0], toSq[1], { shot: true, from: by === 'hero' ? 1.05 : 1.25 });
          await wait(0.6);
          stuck.push({ item: 'arrow', at: toSq }); lay(stuck.slice()); // (stuck where it came down: as the game lays it)
          await wait(FOUNT.loose.T - LOOSE_AT - 0.6 + 0.7); // (back as it stood, and a moment)
        };
        place(level.start[0], level.start[1], Math.PI / 2);
        hero.hold = { R: url('bow') };
        await wait(0.8);
        for (let i = 0; i < 3; i++) {
          say(`The ${archer.monster} shoots an arrow!`); await shoot(archer.at, [hero.sq.x, hero.sq.y], 'centaur');
          say('You shoot an arrow.'); await shoot([hero.sq.x, hero.sq.y], archer.at, 'hero');
        }
        await wait(1.5);
        lay([]); hero.hold = { R: url('pick-axe') }; say('');
      }
      // a temple (?part=temple: a lawful altar, its priest): water blessed (and cursed) by a prayer on the altar, the
      // potions glowing; contributions to the priest, gold tossed him, each way it's taken; and the Amulet of Yendor
      // offered: at another god's altar, gone into orange smoke; at your own, the choir, the radiance, and up into it
      const ta = at('altar_lawful'), tp = cobras.find((c) => /^aligned priest/.test(c.monster));
      const part3 = (p) => doing('temple') || doing(p); // (or just one of them: ?part=water, donate, amulet)
      if (ta && ['temple', 'water', 'donate', 'amulet'].some(doing)) {
        const [ax, az] = ta.at, S = { x: ax + 0.5, y: 0, z: az + 0.5 + 46 / 80, yaw: 0 }, o = items.altar_lawful.offer || [0, 0.8, 0];
        const spot = (i = 0) => ({ x: ax + 0.5 + o[0] + [0, -0.16, 0.16][i % 3], y: STUD_H + o[1], z: az + 0.5 + o[2] });
        const go = async (to) => {
          const from = hero.spot || { x: hero.pos[0] + 0.5, y: 0, z: hero.pos[1] + 0.5, yaw: hero.yaw }, t0 = clock, T = Math.max(0.4, Math.hypot(to.x - from.x, to.z - from.z) / 2.2);
          const way = Math.atan2(to.x - from.x, -(to.z - from.z));
          while (clock - t0 < T) { const u = (clock - t0) / T; hero.spot = { x: from.x + (to.x - from.x) * u, y: 0, z: from.z + (to.z - from.z) * u, yaw: u < 0.85 ? way : to.yaw, moving: true }; await wait(0); }
          hero.spot = { ...to };
          await wait(0.3);
        };
        let lying = [];
        const show = () => { if (!rites.busy) rites.props = lying; };
        const put = async (name) => { hero.hold = { R: url(name) }; hero.fount = { act: 'place', t0: clock, fired: 0 }; await wait(0.75); hero.hold = { R: null }; lying.push(rites.prop(name, spot(lying.length))); show(); await wait(0.8); };
        const pray = async (water, said) => { // (a prayer, and the potions on the altar touched by it)
          say('You begin praying to Lugh.');
          hero.fount = { act: 'prayer', t0: clock, fired: 0 };
          const st = brick.prayBegin(S.x, S.z, 3);
          await wait(PRAY_OUTCOME); say('You finish your prayer.');
          brick.prayOutcome(S.x, S.z, 'pleased', 2, st);
          await wait(0.4); say(said);
          brick.altarFx(ax, az, 'water', 'lawful', water, ax, az + 46 / 80, spot());
          await wait(0.6); lying = lying.map((p, i) => rites.prop(water > 0 ? 'holy water' : 'unholy water', spot(i))); show();
          await wait(PRAY_AFTER - PRAY_OUTCOME);
        };
        // holy water
        if (part3('water')) {
        await go(S);
        for (let i = 0; i < 3; i++) await put('water');
        await pray(1, 'The potions on the altar glow light blue for a moment.');
        lying = []; show();
        for (let i = 0; i < 2; i++) await put('water');
        await pray(-1, 'The potions on the altar glow black for a moment.');
        lying = []; show(); say('');
        }
        // contributions to the priest
        if (tp && part3('donate')) {
          const P = { x: tp.at[0] + 0.5, z: tp.at[1] + 0.5 }, near = { x: P.x - 1, y: 0, z: P.z, yaw: Math.PI / 2 };
          await go(near);
          for (const [n, asked, said] of [[0, 'You give the priest nothing.', '"Thou shalt regret thine action!"'], [1, 'You give the priest 20 gold pieces.', '"Cheapskate."'],
            [2, 'You give the priest 300 gold pieces.', '"Thou art indeed a pious individual."'], ['blessing', '', '"I bestow upon thee a blessing."'],
            [3, 'You give the priest 500 gold pieces.', '"Thy devotion has been rewarded."'], [4, 'You give the priest 900 gold pieces.', '"Thy selfless generosity is deeply appreciated."']]) {
            say('The priest asks you for a contribution for the temple.'); await wait(1.0);
            if (asked) { say(asked); await wait(0.9); }
            const k = n === 'blessing' ? 0 : [0, 3, 5, 8, 10][n];
            if (k) { hero.fount = { act: 'alms', t0: clock, fired: 0 }; await brick.tossCoins({ x: near.x, y: STUD_H + 0.95, z: near.z }, { x: P.x, y: STUD_H + 0.9, z: P.z }, k, url('_coin')); }
            say(said);
            brick.priestFx(n === 'blessing' ? 'blessing' : 'donate', n === 'blessing' ? 2 : n, P, { x: near.x, z: near.z });
            await wait(3);
          }
          say('');
        }
        // the Amulet of Yendor offered
        const offer = async (win) => {
          await go(S);
          hero.hold = { R: url('Amulet of Yendor') }; hero.fount = { act: 'sacrifice', t0: clock, fired: 0 };
          await wait(2.0); hero.hold = { R: null }; lying = [rites.prop('Amulet of Yendor', spot())]; show();
          await wait(0.5);
          say(win ? 'You offer the Amulet of Yendor to Lugh...' : 'You offer the Amulet of Yendor to Moloch...');
          const t0 = clock, veil = document.createElement('div');
          Object.assign(veil.style, { position: 'fixed', inset: '0', background: win ? '#fffdf4' : '#3a1a08', opacity: '0', transition: `opacity ${win ? 2.5 : 1.5}s ease`, pointerEvents: 'none', zIndex: '45' });
          document.body.appendChild(veil);
          brick.altarFx(ax, az, 'ascend', 'lawful', win ? 1 : 0, ax, az + 46 / 80, spot());
          lying = []; show();
          const lift = (t) => (win ? Math.max(0, t - 3.5) ** 2 * 0.18 : 0);
          cut = { t0: clock, T: win ? 14 : 7.5, up: null, focus: [S.x, STUD_H + 0.75, S.z], side: [0, 1], lift }; bars(true);
          if (win) { amb.set('mass', true); hero.fount = { act: 'orans', t0: clock, fired: 0 }; }
          const lines = win ? [[0.6, 'An invisible choir sings, and you are bathed in radiance...'], [3, 'The voice of Lugh booms out:  "Congratulations, mortal!"'],
            [5.5, '"In return for thy service, I grant thee the gift of Immortality!"'], [8, 'You ascend to the status of Demigod...']]
            : [[0.6, 'Moloch accepts your gift, and gains dominion over Lugh...'], [2, 'Lugh is enraged...'], [3.2, 'Fortunately, Moloch permits you to live...'], [4.4, 'A cloud of orange smoke surrounds you...']];
          for (const [t, l] of lines) setTimeout(() => say(l), t * 1000 / SLOW);
          setTimeout(() => { veil.style.opacity = '1'; }, (win ? 9 : 4.5) * 1000 / SLOW);
          while (clock - t0 < (win ? 13.5 : 7)) {
            const t = clock - t0;
            hero.spot = { ...S, y: lift(t) };
            hero.fade = win ? undefined : Math.max(0, Math.min(1, 1 - (t - 2.5) / 2));
            await wait(0);
          }
          veil.style.opacity = '0'; setTimeout(() => veil.remove(), 2600);
          if (win) amb.set('mass', false);
          hero.fade = undefined; hero.fount = null; hero.spot = null;
          say(''); await wait(2.5);
        };
        if (part3('amulet')) { await offer(false); await offer(true); }
      }
      // the altars of the gods (?part=altars: lawful, neutral, chaotic, Moloch's), one after another, as a lawful hero
      // finds them: things set down on them flashing amber or black; sacrifices going up in light or in the altar's own
      // fire, and what comes of them (a four-leaf clover; a cross-aligned altar converted, glowing white; blood and a
      // dark cloud; Moloch's refusal); and an altar kicked (brickworld.altarFx)
      const alts = [['altar_lawful', 'lawful'], ['altar_neutral', 'neutral'], ['altar_chaotic', 'chaotic'], ['altar_unaligned', 'unaligned']]
        .map(([n, kind]) => ({ it: at(n), kind })).filter((a) => a.it);
      if ((doing('altars') || doing('highaltars')) && alts.length) {
        const stand = (a) => { const pr = items[a.it.item].perch || { R: 46 / 80, H: 0 }; return { x: a.it.at[0] + 0.5, y: pr.H ? STUD_H + pr.H : 0, z: a.it.at[1] + 0.5 + pr.R, yaw: 0 }; }; // (where you stand at it: perch.js, its own if it has one)
        const top = (a, i = 0) => { const o = items[a.it.item].offer || [0, 64 / 80, 0]; return { x: a.it.at[0] + 0.5 + o[0] + [0, -0.16, 0.16][i % 3], y: STUD_H + o[1] + Math.floor(i / 3) * 0.05, z: a.it.at[1] + 0.5 + o[2] }; }; // (its offering place: before its statue; several side by side, as brickworld lays them)
        const go = async (to) => { // (walked over to it, turning to face it)
          const from = hero.spot || { x: hero.pos[0] + 0.5, y: 0, z: hero.pos[1] + 0.5, yaw: hero.yaw }, t0 = clock, d = Math.hypot(to.x - from.x, to.z - from.z), T = Math.max(0.4, d / 2.2);
          const way = Math.atan2(to.x - from.x, -(to.z - from.z));
          while (clock - t0 < T) { const u = (clock - t0) / T; hero.spot = { x: from.x + (to.x - from.x) * u, y: 0, z: from.z + (to.z - from.z) * u, yaw: u < 0.85 ? way : to.yaw, moving: true }; await wait(0); }
          hero.spot = { ...to };
          await wait(0.3);
        };
        let lying = [];
        const show = () => { if (!rites.busy) rites.props = lying; };
        const fx = (a, act, n = 0) => brick.altarFx(a.it.at[0], a.it.at[1], act, items0.find((i) => i.at === a.it.at) && /lawful|jesus/.test(items0.find((i) => i.at === a.it.at).item) ? 'lawful' : a.kind, n, a.it.at[0], a.it.at[1] + ((items[a.it.item] || {}).perch || { R: 46 / 80 }).R, top(a));
        const put = async (a, name, act, said) => { // (set down on it: a flash as it lands)
          hero.hold = { R: url(name) }; hero.fount = { act: 'place', t0: clock, fired: 0 };
          await wait(0.75); hero.hold = { R: null };
          lying.push(rites.prop(name, top(a, lying.length))); show(); say(said); if (act) fx(a, act);
          await wait(1.6);
        };
        const sacrifice = async (a, said, after) => { // (held up, laid on it, gone up in light or fire; what comes of it)
          hero.hold = { R: url('corpse') }; hero.fount = { act: 'sacrifice', t0: clock, fired: 0 };
          await wait(2.0); hero.hold = { R: null }; lying.push(rites.prop('corpse', top(a, lying.length))); show();
          await wait(0.5);
          say(said[0]); fx(a, 'consume', said[0].includes('light') ? 1 : 0); await wait(0.15); lying.pop(); show(); // (struck by the bolt, and gone)
          for (const [s, act, n] of after) { await wait(1.4); say(s); if (act) fx(a, act, n); }
          await wait(1.8);
        };
        const [L, N, C, M] = ['lawful', 'neutral', 'chaotic', 'unaligned'].map((k) => alts.find((a) => a.kind === k));
        let items0 = (level.items || []).slice(); // (what stands in the room: an altar turned, the next)
        const turnAltar = (a, to, extra = []) => { // (converted: the old one burning away as the new rises, as the game draws it)
          brick.convertAltar(a.it.at[0], a.it.at[1], 0.6);
          items0 = items0.map((i) => (i === a.it ? { ...i, item: to } : i));
          lay(items0.concat(extra));
        };
        const basic = doing('altars');
        if (L && basic) {
          await go(stand(L));
          await put(L, 'holy water', 'blessed', 'There is an amber flash as a potion of water hits the altar.');
          await put(L, 'iron shoes', 'cursed', 'There is a black flash as a pair of iron shoes hits the altar.');
          await put(L, 'dagger', null, 'A dagger lands on the altar.');
          lying = []; show();
          await sacrifice(L, ['Your sacrifice is consumed in a flash of light!'], [['You glimpse a four-leaf clover at your feet.', 'clover']]);
          await sacrifice(L, ['Your sacrifice is consumed in a flash of light!'], [['You have a feeling of reconciliation.', 'hopeful', 1]]);
          await sacrifice(L, ['Your sacrifice is consumed in a flash of light!'], [['An object appears at your feet!', 'gift'], ['"Use my gift wisely!"']]);
          await sacrifice(L, ['Your sacrifice is consumed in a flash of light!'], [['You have a feeling of inadequacy.', 'inadequacy']]);
          say('');
        }
        if (N && basic) { // (another god's: converted to yours)
          await go(stand(N));
          await sacrifice(N, ['Your sacrifice is consumed in a flash of light!'], [['You sense a conflict between Lugh and Crom.'], ['You feel the power of Lugh increase.']]);
          say('The altar glows white.'); fx(N, 'convert', 1); turnAltar(N, 'altar_lawful');
          await wait(3.2);
          say('');
        }
        if (C && basic) { // (a human sacrificed at a chaotic altar: blood, and a dark cloud; then kicked)
          await go(stand(C));
          await sacrifice(C, ['You offer this evil thing to Set...'], [['The blood covers the altar, and a dark cloud forms!', 'blood', 1]]);
          await wait(1.5);
          hero.fount = { act: 'kick', t0: clock, fired: 0 }; await wait(0.4);
          say('A voice (could it be Set?) whispers:  "Thou shalt pay, infidel!"'); fx(C, 'wrath', 0);
          await wait(2.4);
          say('');
        }
        if (M && basic) { // (Moloch's: the power of your god waning, refused; then claimed for Jesus, a chalice set down on it)
          await go(stand(M));
          await sacrifice(M, ['Your sacrifice is consumed in a burst of flame!'], [['You sense a conflict between Lugh and Moloch.'], ['Unluckily, you feel the power of Lugh decrease.', 'decrease']]);
          await sacrifice(M, ['Your sacrifice is consumed in a burst of flame!'], [['Moloch rejects your sacrifice!', 'reject'], ['"Suffer, infidel!"']]);
          shake = { t0: clock, T: 1.2 };
          await wait(1.4);
          say('(a follower of Jesus sets a chalice down on it)');
          await put(M, 'chalice', null, 'As the chalice touches the altar, it glows a brilliant white!');
          fx(M, 'claim', 1); lying = []; show();
          turnAltar(M, 'altar_jesus', [{ item: 'chalice', at: M.it.at }]);
          await go({ ...stand(M), z: M.it.at[1] + 2.4 }); // (stood back off it, as his rises)
          say("The altar is Jesus's now.");
          await wait(4);
          say('');
        }
        lying = []; show();
        say('');
        // the high altars (?part=altars, the row before the others: the Astral Plane's, the Sanctum's), each
        // visited from the corridor before them, a sacrifice on each going up in its fire
        const highs = [['altar_high_lawful', 'lawful'], ['altar_high_neutral', 'neutral'], ['altar_high_chaotic', 'chaotic'], ['altar_high_unaligned', 'unaligned']]
          .map(([n, kind]) => ({ it: at(n), kind })).filter((a) => a.it);
        for (const [i, h] of highs.entries()) {
          if (!doing('highaltars')) break;
          const s = stand(h);
          await go({ ...s, y: 0, z: s.z + 0.6, yaw: Math.PI / 2 }); // (along the corridor before them, then up to it)
          await go(s);
          const said = [['Your sacrifice is consumed in a flash of light!', 'You glimpse a four-leaf clover at your feet.', 'clover'],
            ['Your sacrifice is consumed in a burst of flame!', 'You have a hopeful feeling.', 'hopeful'],
            ['Your sacrifice is consumed in a burst of flame!', 'You have a feeling of inadequacy.', 'inadequacy'],
            ['Your sacrifice is consumed in a burst of flame!', 'Moloch rejects your sacrifice!', 'reject']][i];
          await sacrifice(h, [said[0]], [[said[1], said[2]]]);
          await go({ ...s, y: 0, z: s.z + 0.6, yaw: Math.PI / 2 });
        }
        say('');
        if (L && basic) { // (your own god's, kicked)
          await go(stand(L));
          hero.fount = { act: 'kick', t0: clock, fired: 0 }; await wait(0.4);
          say('"How darest thou desecrate my altar!"'); fx(L, 'wrath', 1); shake = { t0: clock, T: 1.0 };
          await wait(2.4);
        }
        lying = []; show();
        hero.spot = null; hero.fount = null; hero.hold = { R: null };
        say('');
      }
      // the rites at the altar of a follower of Jesus (altar_jesus: rites.js, as the game plays them), each from the
      // floor before it up onto its step, and down again after (?part=mass, communion, alms, confess, offer, jesuspray)
      const ja = at('altar_jesus');
      if (ja && ['mass', 'communion', 'alms', 'confess', 'offer', 'jesuspray'].some(doing)) {
        rites.env.angelUrl = (await roster())['angel-priest-m'];
        rites.place(ja.at[0], ja.at[1], 0);
        const S = rites.spot;
        // up onto its step from the floor before it (what's carried, held up before you)
        const toStep = async (carry) => {
          hero.hold = { R: carry ? url(carry) : null };
          hero.fount = carry ? { act: 'carry', t0: clock, fired: 0 } : null;
          const t0 = clock;
          while (clock - t0 < 1.4) { const u = (clock - t0) / 1.4, v = Math.min(1, u * 1.6); hero.spot = { x: S.x, y: S.y * v + 0.12 * Math.sin(Math.PI * v), z: S.z + 1.2 * (1 - u), yaw: 0, moving: true }; await wait(0); }
          hero.spot = { ...S, yaw: 0 };
        };
        // ...and down off it again, back the way you came
        const offStep = async () => {
          const t0 = clock;
          hero.fount = null; hero.hold = { R: null };
          while (clock - t0 < 1.2) { const u = (clock - t0) / 1.2, v = Math.max(0, (u - 0.2) / 0.5); hero.spot = { x: S.x, y: S.y * (1 - Math.min(1, v)) + 0.1 * Math.sin(Math.PI * Math.min(1, v)), z: S.z + 1.2 * u, yaw: Math.PI * Math.min(1, u * 3), moving: u > 0.15 }; await wait(0); }
          hero.spot = null;
          await wait(1.2);
          say('');
        };
        const [ax, az] = ja.at;
        if (doing('mass')) { await toStep('chalice'); await rites.mass(ax, az, 0, { wine: 'chalice', keep: false }); await offStep(); }
        if (doing('communion')) { await toStep(); await rites.communion(ax, az); await offStep(); }
        if (doing('alms')) {
          await toStep();
          await rites.alms(ax, az, 0, [[0, 'You give 40 gold pieces to the poor.', 'Your gift is noted.'], [1, 'You give 300 gold pieces to the poor.', 'You have a hopeful feeling.'],
            [2, 'You give 500 gold pieces to the poor.', 'You feel a sense of peace.'], [3, 'You give 112 gold pieces to the poor.', 'You gave all you had, and feel blessed.'],
            [4, 'You give 1000 gold pieces to the poor.', 'You feel watched over.']]);
          await offStep();
        }
        if (doing('confess')) { await toStep(); await rites.confess(ax, az, 0, true); await rites.confess(ax, az, 0, false); await offStep(); }
        if (doing('offer')) { await toStep('corpse'); hero.fount = null; await rites.offer(ax, az); await offStep(); }
        if (doing('jesuspray')) { // (a good prayer, the chalice set on its stud first: the column of light, his favour; a wafer, the wine)
          await toStep('chalice');
          hero.fount = null; hero.hold = { R: null };
          let lying = [rites.prop('chalice', rites.stud)];
          const keep = setInterval(() => { if (!rites.busy) rites.props = lying; }, 50); // (what the game would lay there: the engine's)
          say('You begin praying to Jesus.');
          hero.fount = { act: 'prayer', t0: clock, fired: 0 };
          const st = brick.prayBegin(S.x, S.z, 3);
          await wait(1.6); say('You are surrounded by a shimmering light.');
          await wait(PRAY_OUTCOME - 1.6); say('You finish your prayer.');
          await wait(0.6); say('You feel that Jesus is well-pleased.');
          brick.prayOutcome(S.x, S.z, 'pleased', 3, st);
          await wait(1.0); say('A holy wafer appears on the altar.');
          lying = [rites.prop('chalice', rites.stud), rites.prop('holy wafer', rites.wafer)];
          const done = rites.prayed(ax, az, 0, 'wafer');
          await wait(0.1); rites.props = lying;
          await wait(1.2); say('The chalice on the altar fills with wine.');
          lying = [rites.prop('holy wine', rites.stud), rites.prop('holy wafer', rites.wafer)]; rites.props = lying;
          rites.prayed(ax, az, 0, 'wine');
          await done;
          clearInterval(keep); rites.props = [];
          await offStep();
        }
      }
      // riding (?part=ride): up onto the saddled pony, astride it, ridden round the room (it goes where you go), and
      // down off it again
      const steed = cobras.find((c) => c.saddled);
      if (doing('ride') && steed) {
        room();
        lay([]);
        hero.hold = { R: null };
        steed.at = level.monsters.find((m) => m.monster === steed.monster).at.slice();
        // (round to its left side, facing the way it faces)
        const side = [steed.at[0] - 1, steed.at[1]];
        while (hero.sq.x !== side[0] || hero.sq.y !== side[1]) await step(Math.sign(side[0] - hero.sq.x), hero.sq.x === side[0] ? Math.sign(side[1] - hero.sq.y) : 0);
        hero.yaw = Math.PI / 2;
        steed.rideYaw = Math.PI / 2;
        await wait(0.8);
        say('You mount the saddled pony.');
        hero.ride = { c: steed, t0: clock, phase: 'up', from: hero.pos.slice() };
        await wait(MOUNT_T);
        place(steed.at[0], steed.at[1], Math.PI / 2);
        hero.ride.phase = 'on';
        await wait(1);
        say('');
        await walk([[1, 0], [1, 0], [0, 1], [-1, 0], [-1, 0], [-1, 0], [0, -1], [1, 0]]);
        await wait(1);
        say('You dismount the pony.');
        hero.ride = { c: steed, t0: clock, phase: 'down', to: [hero.sq.x - 1, hero.sq.y] };
        await wait(MOUNT_T);
        steed.at = [hero.sq.x, hero.sq.y];
        place(hero.ride.to[0], hero.ride.to[1], Math.PI / 2);
        hero.ride = null;
        await wait(1.5);
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
        // thrown: the game has it where it lands at once; the ball itself flung there, the chain whipping after it
        hero.yaw = Math.PI / 2;
        await wait(0.4);
        anim.a && anim.a.attack();
        anim.state.heavy = 0;
        const tgt = [hero.sq.x + 2, hero.sq.y];
        punished.ball = tgt;
        say('You throw the heavy iron ball.');
        brick.tossBall(tgt[0], tgt[1]); // (the ball itself flung, the chain after it: as main.js 'throw')
        await wait(2.5);
        say('');
        await walk([[1, 0], [1, 0]]);
        // picked up again, and down it goes, where you stand
        anim.state.heavy = 1;
        punished.ball = null;
        await wait(1);
        await walk([[-1, 0], [-1, 0]]);
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
    if (fo && fo.act === 'sit' && pp && pp.k >= 1 && hero.from.perch) { // (sat on a toilet: round, down onto its seat, and up again)
      const b = sitPath(hero.from.perch, fo.t, PERCHES.toilet);
      pp = { k: 1, dx: b.x, dz: b.z, lift: b.lift, yaw: b.yaw, hop: 0, lookUp: 0 };
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
    // (on a steed: up onto it, astride it as it goes, down off it: where you are, how far astride (ride.k), your hop)
    const R = hero.ride, rideAt = (() => {
      if (!R) return null;
      const sm = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u)), bob = R.phase === 'on' && moving ? 0.025 * Math.abs(Math.sin(clock * 9)) : 0;
      if (R.phase === 'on') return { x: hero.pos[0], z: hero.pos[1], y: SADDLE_Y + bob, k: 1, hop: 0 };
      const u = Math.min(1, (clock - R.t0) / MOUNT_T), e = sm(u), up = R.phase === 'up';
      const a = up ? R.from : R.c.at, b = up ? R.c.at : R.to, h = Math.sin(Math.PI * u);
      return { x: a[0] + (b[0] - a[0]) * e, z: a[1] + (b[1] - a[1]) * e, y: (up ? e : 1 - e) * SADDLE_Y + 0.3 * h, k: up ? e : 1 - e, hop: h };
    })();
    if (hero.spot && hero.spot.moving) moving = true; // (the Mass: walking up to the altar's step)
    const pose = sw && anim.a ? anim.a.update(dt, { hop: sw.hop, reach: sw.reach, lean: sw.lean }) : anim.a ? anim.a.update(dt, { raise, moving: moving && !R, ride: rideAt ? rideAt.k : 0, holdsR: !!hero.hold.R, hop: pp ? pp.hop : 0, lookUp: pp && !fo ? pp.lookUp : 0, fount: fo,
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
    const kneel = fo && fo.act === 'prayer' ? fountKey('prayer', 'drop', fo.t) : 0; // (praying: down on your knees)
    const m = rideAt ? figureMatrix(rideAt.x + 0.5, rideAt.y, rideAt.z + 0.5, hero.yaw) // (astride a steed)
      : sw ? figureMatrix(sw.x + 0.5, sw.y, sw.z + 0.5, sw.yaw ?? hero.yaw) : figureMatrix(hero.pos[0] + 0.5 + (pp ? pp.dx : 0) + trapShake(), (pp ? pp.lift : -hero.sink) - kneel + (hero.trapY || 0), hero.pos[1] + 0.5 + (pp ? pp.dz : 0), pp && pp.k > 0.5 ? pp.yaw : hero.yaw);
    if (hero.spot) { // (the Mass: on the altar's step, as the script has you; a genuflection, down on a knee)
      const S = hero.spot, drop = fo ? fountKey(fo.act, 'drop', fo.t) : 0;
      m.set(figureMatrix(S.x, S.y - drop, S.z, S.yaw));
    }
    hero.mouth = pose ? mouthPoint(m, pose) : null; // (bad breath: off your mouth, next frame)
    const figs = [{ url: hero.polyUrl || heroFig.url, matrix: m, pose, fade: hero.fade, hold: hero.spot ? hero.hold : fo && fo.act === 'loose' ? { ...hero.hold, L: null, nock: fo.t > NOCKED[0] && fo.t < NOCKED[1] ? url('arrow') : undefined, nockK: nockAt(fo.t) } : fo ? { R: fo.act === 'dip' || fo.act === 'reach' || fo.act === 'toiletDip' ? (hero.fount.grab && fo.t > FOUNT[fo.act].cup + 0.35 ? hero.fount.grab : hero.fount.url) : null, L: null }
      : raise > 0 || hero.exc ? { R: (hero.raise && hero.raise.url) || url('Excalibur'), L: null } : pp && !hero.digging ? { R: null, L: null } : hero.hold }]; // (climbing a statue: hands free)
    const tagList = []; // (each monster's name tag: over it, as drawn)
    for (const c of cobras) {
      if (c.gone) continue; // (slain: blown to bits, brickworld shatterFigureAt)
      let rp = null; // (out of a fountain: up out of its water, over the rim, off to its square: perch.js risePath)
      const half = 0.55, out = c.kind === 'snake' ? half * Math.cos(0.45) : 0.22, up = half * Math.sin(0.45); // (a snake: half its length; as main.js SNAKE_OUT, SNAKE_UP)
      if (c.rise) { const u = (clock - c.rise.t0) / RISE_T; if (u < 0) continue; if (u < 1) rp = risePath(c.rise.f, c.at, u, out, c.rise.sink); }
      let cx = rp ? rp.x : c.at[0], cz = rp ? rp.z : c.at[1], lean = rp ? rp.lean || 0 : 0, leanYaw = rp ? rp.leanYaw : null;
      const fnt = !rp && drops.find((o) => o.name === 'fountain' && Math.abs(o.x - cx) < 1.6 && Math.abs(o.z - cz) < 1.6), ag = fnt && againstFountain([fnt.x, fnt.z], cx, cz, out);
      if (ag) { cx = ag.x; cz = ag.z; lean = 1; leanYaw = ag.yaw; } // (up against a fountain: out of its wall, a snake leaning back on it: as main.js)
      const hx2 = hero.pos[0] + (pp ? pp.dx : 0), hz2 = hero.pos[1] + (pp ? pp.dz : 0); // (you as drawn: up on a fountain's rim)
      let yaw = rp ? rp.yaw : c.rideYaw != null ? c.rideYaw : Math.atan2(hx2 - cx, -(hz2 - cz)); // (a steed: the way it was last ridden, or is about to be)
      if (hero.ride && hero.ride.c === c && hero.ride.phase === 'on') { cx = hero.pos[0]; cz = hero.pos[1]; yaw = hero.yaw; c.rideYaw = yaw; } // (ridden: where you are, your way)
      if (leanYaw != null && c.kind === 'snake') yaw = rp ? yaw + Math.atan2(Math.sin(leanYaw - yaw), Math.cos(leanYaw - yaw)) * lean : leanYaw;
      const L = c.kind === 'snake' ? lean : 0, ca = Math.cos(0.45 * L), sa = Math.sin(0.45 * L);
      const base = partMatrix(cx + 0.5, STUD_H + (rp ? rp.y : 0) + up * L, cz + 0.5, Math.PI - yaw);
      if (hero.ride && hero.ride.c === c) hero.ride.at = { x: cx, z: cz, yaw }; // (where the saddle is, this frame: you on it)
      tagList.push({ id: c, x: cx + 0.5, y: STUD_H + (rp ? rp.y : 0) + (c.kind ? 0.55 : 1.55), z: cz + 0.5, text: c.monster, cls: c.tame ? 'tame' : c.peaceful ? 'peaceful' : 'hostile' });
      const cm = c.kind ? mul(L > 0.01 ? mul(base, new Float32Array([1, 0, 0, 0, 0, ca, sa, 0, 0, -sa, ca, 0, 0, 0, 0, 1])) : base, creatureLocal(c.kind, clock, { lungeT: c.lungeAt, moving: !!rp || (hero.ride && hero.ride.c === c && moving) })) : null;
      if (c.kind) figs.push({ url: c.saddled || c.url, matrix: cm, pose: null, hold: {} });
      if (c.rider) { // (a centaur's man half: on its horse, where its neck is; shooting as you do (FOUNT.loose), its bow in hand for it)
        const lt = c.looseAt != null ? clock - c.looseAt : 9, loosing = lt < FOUNT.loose.T, r = c.rider, k = r.scale;
        const pose = c.riderAnim ? c.riderAnim.update(dt, { holdsR: !!c.hold || loosing, fount: loosing ? { act: 'loose', t: lt } : null }) : null;
        figs.push({ url: r.url, matrix: mul(cm, new Float32Array([k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, r.at[0], r.at[1], r.at[2], 1])), pose,
          hold: { R: c.hold ? url(c.hold) : loosing ? url('bow') : null, L: null, nock: loosing && lt > NOCKED[0] && lt < NOCKED[1] ? url('arrow') : undefined, nockK: nockAt(lt) } });
      }
      else { // (a naga: leaning in to spit, on coils that weave and lunge)
        const spitting = clock - c.lungeAt < LUNGE_TIME;
        const wt = c.warnAt != null ? clock - c.warnAt : 9, sm = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u)), warn = wt < 1.8 ? sm(wt / 0.3) * sm((1.8 - wt) / 0.4) : 0;
        const pose = c.anim ? c.anim.update(dt, { moving: !!rp, lean: spitting ? 0.35 : 0, reach: spitting ? 0.7 : 0, raise: warn }) : null;
        const fm = figureMatrix(cx + 0.5, (c.lift || 0) + (rp ? rp.y : 0), cz + 0.5, yaw); // (out of a fountain: on its way)
        figs.push({ url: c.url, matrix: c.slither ? mul(fm, slitherLocal(clock, { lungeT: c.lungeAt })) : fm, pose, hold: c.hold ? { R: url(c.hold) } : {} }); // (a watchman's halberd)
      }
    }
    figs.push(...rites.figures(dt)); // (the altar's statues, come alive: rites.js)
    rites.step();
    brick.setFigures(figs);
    brick.setProps(rites.props);
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
        const up = cut.lift ? cut.lift(t) : 0; // (following you up: ascending)
        const eye = new THREE.Vector3(f[0] + Math.cos(ang) * (2.1 + 0.6 * k2 + 0.5 * up), f[1] + 0.4 + 0.2 * k2 + 0.55 * up, f[2] + Math.sin(ang) * (2.1 + 0.6 * k2 + 0.5 * up));
        const tgt = new THREE.Vector3(f[0] + cut.side[0] * 0.5, f[1] - 0.1 + 0.5 * k2 + 0.9 * up, f[2] + cut.side[1] * 0.5);
        { // (round the fountain, not straight across: never through its walls; as main.js roundAbout)
          const a0 = Math.atan2(cut.pos0.z - f[2], cut.pos0.x - f[0]), r0 = Math.hypot(cut.pos0.x - f[0], cut.pos0.z - f[2]);
          const a1 = Math.atan2(eye.z - f[2], eye.x - f[0]), r1 = Math.hypot(eye.x - f[0], eye.z - f[2]);
          const a = a0 + Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)) * e, r = r0 + (r1 - r0) * e;
          cam.position.set(f[0] + Math.cos(a) * r, cut.pos0.y + (eye.y - cut.pos0.y) * e, f[2] + Math.sin(a) * r);
        }
        cam.lookAt(ctl.target.clone().lerp(tgt, e));
      }
    } else ctl.update();
    const jolt = new THREE.Vector3(); // (shaken: jolted about, dying away; put back after drawing, so the view doesn't drift)
    if (shake) {
      const u = (clock - shake.t0) / shake.T;
      if (u >= 1) shake = null;
      else { const k = 0.06 * (1 - u); jolt.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k); cam.position.add(jolt); }
    }
    cam.updateMatrixWorld();
    brick.render(cam.projectionMatrix.elements, cam.matrixWorldInverse.elements, w, h, [hero.pos[0] + 0.5, 0, hero.pos[1] + 0.5]);
    cam.position.sub(jolt);
    const v = new THREE.Vector3();
    tags.update(tagList, [cam.position.x, cam.position.y, cam.position.z], (p) => {
      v.set(p[0], p[1], p[2]).project(cam);
      return v.z > 1 || v.z < -1 ? null : [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h];
    });
  }
  requestAnimationFrame(frame);
}

// A menagerie (scene.json "level" with "menagerie": rows of monsters, [{monster, at}] in
// "monsters"): each in brick as the game draws it (creature.js), named over its head, facing you;
// each in turn breathing and looking about, trotting, then biting (a lunge), over and over
async function menagerie(level, brick, cam, ctl, canvas) {
  const mons = await (await fetch('assets/brick/monsters.built.json', { cache: 'no-store' })).json();
  const items = await (await fetch('assets/brick/items.built.json', { cache: 'no-store' })).json(); // (what each holds, as the game gives it)
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
    t.className = 'tag'; t.textContent = b.label || b.monster; // (or what the scene calls it: a priest, by his god)
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
        const held = b.hold && items[b.hold] ? items[b.hold].url : null;
        return { url: b.url, matrix: figureMatrix(b.at[0] + 0.5, b.lift || 0, b.at[1] + 0.5, Math.PI), pose: b.anim ? b.anim.update(dt, { moving, holdsR: !!held }) : null, hold: held ? { R: held } : {} };
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

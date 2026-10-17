// The test dungeon: the scene viewer (baseplate.html) as a little SLASH'EM
// level, drawn by the game's own brick renderer (brickworld.js) with the
// game's own effects, so what's tried here is what the game will do. A walled
// room, things set on its squares (scene.json "level": its size and what lies
// where), and a hero walking a script through them, square by square as the
// game moves you:
//   - onto a statue's square: a hop up onto its ledge, gazing up at it (perch.js)
//   - behind a boulder: a lean into it, and it rolls and tumbles on a square,
//     twice (boulderfx.js, as brickworld.boulderPush)
//   - a pick-axe at it: three swings, and it bursts into grit and rocks
//     (brickworld.boulderBreak)
//   - every monster that spits (the cobra, the nagas, the acid worm, the
//     spitting beetle, Juiblex) rears and spits at it in turn: the gob flies, dripping, and splats
//   - punished: the ball and chain on its ankle (ballchain.js); it picks the
//     ball up, the weapon put away, and lugs it a few squares, as if it were
//     the hardest thing it ever carried; and sets it down
// and again (or just one of them: ?part=statue, boulder, spit or ball). Drag to
// look round, wheel to zoom, P to pause.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BrickWorld } from './brickworld.js';
import { FigureAnimator } from './minifig-anim.js';
import { figureMatrix, partMatrix, STUD_H } from './brick.js';
import { perchSpot, cameFrom } from './perch.js';
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
  cam.position.set(...(level.camera ? level.camera.pos : [W / 2, 11, H + 3])); // (or where the level says to look from)
  ctl.target.set(...(level.camera ? level.camera.target : [W / 2, 0, H / 2 + 0.5]));

  // the room: a floor of plates, walls all round
  const floors = [], walls = [];
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      if (x === 0 || z === 0 || x === W - 1 || z === H - 1) walls.push({ x, z, shade: 1 });
      else floors.push({ x, z, studs: true, shade: 1 });
    }
  await brick.ready;
  brick.setTerrain({ floors, walls, doors: [], fog: [], w: W, h: H });
  // the room under a dark sky, as deep in the dungeon
  brick.scene.background = new THREE.Color(0x0b0d14);

  // what lies where: [{x, z, url, level, upright, name}] (world.js brickDrops), redone as things move
  const at = (name) => level.items.find((i) => i.item === name);
  let drops = [];
  const lay = (list) => {
    drops = list.filter(Boolean).map((i) => ({ x: i.at[0], z: i.at[1], url: url(i.item), level: 0, upright: !!(items[i.item] || {}).upright, name: i.item }));
  };

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
    return wait(STEP_TIME);
  };
  const walk = async (path) => { for (const [dx, dy] of path) await step(dx, dy); };
  const place = (x, y, yaw) => { hero.sq = { x, y }; hero.pos = [x, y]; hero.from = { x, y, cur: null }; hero.yaw = yaw; hero.walk = null; };

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
  async function script() {
    for (;;) {
      // set out: the room as the level has it, the hero at its start, a pick in hand
      const st = at('statue'), bo = at('boulder'), ba = at('heavy iron ball');
      lay([st, bo]);
      brick.boulders && brick.boulders.clear();
      for (const [k, kept] of brick.keptRocks) brick.keptRocks.delete(k);
      place(level.start[0], level.start[1], Math.PI / 2);
      hero.hold = { R: url('pick-axe') };
      anim.state = {};
      await wait(1);
      const part = new URLSearchParams(location.search).get('part'); // (?part=statue|boulder|spit|ball: just that, again and again)
      const doing = (p) => !part || part === p;
      // the statue: walk up and onto it (from the west), stand a while, and step down
      if (doing('statue')) {
        await walk(Array(st.at[0] - hero.sq.x).fill([1, 0]));
        await wait(3);
        await walk([[0, 1]]);
      }
      // the boulder: round behind it, and push, twice
      if (doing('boulder')) {
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
        brick.boulderBreak(url('boulder'), rocksAt[0], rocksAt[1], url('rock'));
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
      if (doing('ball')) {
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
    const pp = perchSpot(hero.sq, hero.from, hero.pos, drops);
    const push = Math.max(0, 1 - (clock - (anim.pushT0 ?? -1e9)) / 0.7);
    const pose = anim.a ? anim.a.update(dt, { moving, holdsR: !!hero.hold.R, hop: pp ? pp.hop : 0, lookUp: pp ? pp.lookUp : 0,
      lean: push > 0 ? 0.3 : 0, reach: push > 0 ? 1 : 0, heavy: anim.state.heavy || 0, speed: anim.state.heavy ? 1.1 : undefined }) : null;
    const m = figureMatrix(hero.pos[0] + 0.5 + (pp ? pp.dx : 0), pp ? pp.lift : 0, hero.pos[1] + 0.5 + (pp ? pp.dz : 0), pp && pp.k > 0.5 ? pp.yaw : hero.yaw);
    const figs = [{ url: heroFig.url, matrix: m, pose, hold: pp ? { R: null, L: null } : hero.hold }]; // (climbing a statue: hands free)
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

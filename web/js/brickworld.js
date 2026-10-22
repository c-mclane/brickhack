// The brick world, drawn by three.js exactly as the scene viewer (baseplate.html)
// draws it: the real LDraw parts as converted (tools/build_roster.py), the same
// lights and shadows, the same plain sky-blue background (no skybox, no fog).
// It shares the game's WebGL2 context and canvas, so the game's own pass
// (monster and item sprites, outlines...) draws over it with the same depth.
//
// Units are the game's: a map square is 1 (4x4 studs), a stud 0.25.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { isMist, mistify, isStatic, staticify, quantumPart, strobify, addAura, auraOf, addLightning, addEffects, addHueShift, addBlink, roil, setWaterStud, smokeVents } from './mist.js';
import { figureJoints, poseJoints, wristMatrix, setHinge } from './minifig-anim.js';
import { PARTS, MODEL_SCALE, BRICK_H, PLATE_H, STUD_H } from './brick.js';
import { ThrowFX } from './throwfx.js';
import { BoulderFX } from './boulderfx.js';
import { BallChain, ankleAnchor } from './ballchain.js';

// where a figure holds something lugged in both arms: before its belly, clear of it (the model's units: studs)
export const HUG = new THREE.Vector3(0, -1.05, 1.45); // (high, the hands sunk into it)
const FOUNT_GLOW = new THREE.Color(0x9ff6ff); // (a magic fountain's water, lit from within)
// a fountain drying up (fountainDry): s its water takes to grey, s it stands so, the stone it greys to (the
// walls' grey), and how high in it (studs) its bricks crumble rather than blow apart (its tiers, over its rim)
export const DRY_GREY = 1.2, DRY_SIT = 1.0;
export const LADY_T = 4.5; // (the Lady of the Lake: s, her arm risen, the blessing, and sunk again)
const DRY_STONE = new THREE.Color(0xa0a5a9), DRY_CRUMBLE = 2.9;
// where things on a fountain's square lie, off its square's middle (squares): on its rim, on the ledge round its
// basin (its front-right, between where you'd stand on it), out of the water: a gem pulled out of it, set down by you
export const FOUNT_RIM_SPOT = [0.6, 0.6, 0.6];
// a fountain's basin: how many coins lie strewn in it (gold there: basinCoins), how high its floor (squares, over
// the studs), and between what distances from its middle (out of its column, in from its wall)
// praying: when what comes of it shows, and when you take it (s after you begin), and how: struck (thrown back)
// or brought low (slumped, head bowed)
export const PRAY_OUTCOME = 5.8, PRAY_AFTER = 8.0;
export const prayAfter = (act) => (['bolt', 'disintegrate', 'lessons', 'minion', 'undead'].includes(act) ? 'smitten'
  : ['displeased', 'toosoon', 'blackglow', 'punish', 'hell'].includes(act) ? 'slump' : null);
const BASIN_COINS = 16, BASIN_FLOOR = 0.36, BASIN_R = [0.3, 0.64];
// a sink's tap's spout and the drain in its bowl, off its square's middle (squares: [across, up, toward its front])
const SINK_SPOUT = [0, 1.12, -0.08], SINK_DRAIN = [0, 0.83, 0.1];
// (an altar's top, its slab, up from the floor: where an offering lies)
const ALTAR_TOP = 64 / 80;
const ALTAR_ROW = [0, -0.16, 0.16]; // (things on an altar, side by side along its front: squares off its offering place)
// an altar's fire, by its kind: [bright, dark] (altarFx)
const ALTAR_BOLT = { lawful: [0xfffbe8, 0xffd060], neutral: [0xf4f8ff, 0xa8b8d0], chaotic: [0xffb090, 0xd02020], unaligned: [0xffd0a0, 0xff3010] }; // (a sacrifice's bolt of fire: core, glow)
const ALTAR_HUE = { lawful: [0xfff3c0, 0x8a7a50], neutral: [0xdfe6f0, 0x5a6270], chaotic: [0xd02020, 0x2a0808], unaligned: [0xff3010, 0x3a0000] };
// see-through by k (0..1), each mesh under it given materials of its own the first time (shared ones left as they
// were); hidden at nothing
function fadeObject(root, k) {
  root.visible = k > 0.002;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.userData.fadeOwn) {
      o.userData.fadeOwn = true;
      const own = (m) => { const c = m.clone(); c.userData.op0 = m.transparent ? m.opacity : 1; c.transparent = true; return c; };
      o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
    }
    for (const m of [].concat(o.material)) { m.opacity = m.userData.op0 * k; m.depthWrite = k > 0.98; }
  });
}
// (and a toilet's water, down in its bowl)
const TOILET_WATER = [0, 0.5, 0.125];
const HERO_R = 0.2; // a minifig's body, round its middle (squares): what the ball keeps out of
import { gradientEnvironment } from './envmap.js';

export const SKY = 0x8fb8de; // the viewer's background

const PIECES = {
  plate: 'assets/brick/parts/plate4x4.glb', // a floor square: a grey 4x4 plate, origin at its top middle
  brick: 'assets/brick/parts/brick2x4.glb', // a wall's top course: grey 2x4 bricks, origin at the top middle
  pool: 'assets/brick/parts/water_stud.glb', // water: a clear blue 1x1 round plate, origin at its top middle (roiling: mist.js roil)
  poolbed: 'assets/brick/parts/water_bed.glb', // ...and under it, the bottom of its hole: the same plates, still, a square's worth
  lavapool: 'assets/brick/parts/lava_stud.glb', // lava: the same heap, in clear neon orange, glowing bright
  lavabed: 'assets/brick/parts/lava_bed.glb', // ...on a bed of clear red
  stairs_down: 'assets/brick/parts/stairs_down.glb', // stairs down: brick steps into a hole in the floor, origin at the floor's top, the square's middle
  stairs_up: 'assets/brick/parts/stairs_up.glb', // stairs up: brick steps rising out of it
  // the Gnomish Mines (minesWalls): its floor, brown; its walls of rock, tiled along each run of wall
  plate_mines: 'assets/brick/parts/plate4x4_mines.glb',
  panel_a: 'assets/brick/parts/mines_panel_a.glb', // a rock panel, 10 studs long, 4 deep, a wall's height: its rock face to +Z
  panel_b: 'assets/brick/parts/mines_panel_b.glb', // ...in dark tan
  rock4: 'assets/brick/parts/mines_rock4.glb', // a rock column, 4x4, a wall's height
  fill2: 'assets/brick/parts/mines_fill2.glb', // a stack of 2x4 bricks, 2 studs along X, 4 deep
};
// the Gnomish Mines' walls (setTerrain: data.style 'mines'), tiled out of real pieces, each a wall's height: every
// straight run of wall (squares with wall to either side along it, and not across it) filled along its length with
// rock panels, 10 studs each, as many as fit, the rest (its length, 4 studs a square, less the panels') in 4-stud
// rock columns and, if 2 studs short, one stack of 2x4 bricks, in an order of its own (by where it is: not the same
// run after run); each panel's rock face to the side the floor is (the more of it). A corner, a junction, a wall
// standing alone: a rock column, turned any way. -> {piece: [[matrix, shade]...]}
function minesWalls(data) {
  const W = data.w, S = MODEL_SCALE, TOP = 144 / 80;
  const wallAt = new Set(data.walls.map((w) => w.z * W + w.x)), open = new Set();
  for (const list of [data.floors, data.pools, data.stairs, data.doors]) for (const c of list || []) open.add(c.z * W + c.x);
  const inMap = (x, z) => x >= 0 && x < W && z >= 0; // (no wrapping round off one edge onto the next row)
  const isWall = (x, z) => inMap(x, z) && wallAt.has(z * W + x), isOpen = (x, z) => inMap(x, z) && open.has(z * W + x);
  const hash = (a, b) => { const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return h - Math.floor(h); };
  const out = { panel_a: [], panel_b: [], rock4: [], fill2: [] };
  const put = (k, x, z, turn) => out[k].push([new THREE.Matrix4().makeTranslation(x, TOP, z).multiply(new THREE.Matrix4().makeRotationY(turn)).scale(new THREE.Vector3(S, S, S)), 1]);
  const kind = (x, z) => { const h = isWall(x - 1, z) || isWall(x + 1, z), v = isWall(x, z - 1) || isWall(x, z + 1); return h && !v ? 'h' : v && !h ? 'v' : 'p'; };
  for (const w of data.walls) if (kind(w.x, w.z) === 'p') put('rock4', w.x + 0.5, w.z + 0.5, Math.floor(hash(w.x, w.z) * 4) * Math.PI / 2);
  const run = (cells, along) => { // (cells: the run's squares in order; along: 'h' (x) or 'v' (z))
    const [x0, z0] = cells[0], L = cells.length * 4, n = Math.floor(L / 10);
    const parts = Array(n).fill(10);
    for (let r = L - 10 * n; r > 0; r -= r >= 4 ? 4 : 2) parts.push(r >= 4 ? 4 : 2);
    for (let i = parts.length - 1; i > 0; i--) { const j = Math.floor(hash(x0 + i, z0 - i) * (i + 1)); [parts[i], parts[j]] = [parts[j], parts[i]]; }
    // (its face: toward the side with the more floor)
    let a = 0, b = 0;
    for (const [x, z] of cells) { if (along === 'h') { a += isOpen(x, z + 1); b += isOpen(x, z - 1); } else { a += isOpen(x + 1, z); b += isOpen(x - 1, z); } }
    const face = along === 'h' ? (a >= b ? 0 : Math.PI) : (a >= b ? Math.PI / 2 : -Math.PI / 2), across = along === 'h' ? 0 : Math.PI / 2;
    let at = 0;
    for (const [i, len] of parts.entries()) {
      const mid = (at + len / 2) / 4, x = along === 'h' ? x0 + mid : x0 + 0.5, z = along === 'h' ? z0 + 0.5 : z0 + mid;
      if (len === 10) put(hash(x0 + i * 3, z0 + i * 7) < 0.7 ? 'panel_a' : 'panel_b', x, z, face);
      else if (len === 4) put('rock4', x, z, Math.floor(hash(x * 3, z * 5) * 4) * Math.PI / 2);
      else put('fill2', x, z, across);
      at += len;
    }
  };
  for (const along of ['h', 'v']) {
    const seen = new Set();
    for (const w of data.walls) {
      if (kind(w.x, w.z) !== along || seen.has(w.z * W + w.x)) continue;
      // (back to its start, then along it to its end)
      let [x, z] = [w.x, w.z];
      const [dx, dz] = along === 'h' ? [1, 0] : [0, 1];
      while (isWall(x - dx, z - dz) && kind(x - dx, z - dz) === along) { x -= dx; z -= dz; }
      const cells = [];
      while (isWall(x, z) && kind(x, z) === along) { cells.push([x, z]); seen.add(z * W + x); x += dx; z += dz; }
      run(cells, along);
    }
  }
  return out;
}
const CHUNK = 8; // (squares a side: the map in pieces, each drawn only when in view)
const WALL_GREY = 0xa0a5a9, GROUND_GREY = WALL_GREY; // (the floor, under it all, the grey of the walls)
// a wall: this many courses of bricks, and a course of real bricks, studs and all, on top (six
// bricks: as tall as a door's frame; about two blocks, the walls' height, WALL_H)
const WALL_COURSES = 5;
// how many courses higher the Castle's walls rise: [none, its outer walls, its corner towers]
const RISE_COURSES = [0, 9, 16];

export class BrickWorld {
  constructor(canvas, gl) {
    const r = (this.r = new THREE.WebGLRenderer({ canvas, context: gl }));
    r.autoClear = true;
    r.shadowMap.enabled = true;
    r.setPixelRatio(1);
    const scene = (this.scene = new THREE.Scene());
    this.sky = SKY; // (the game's: black, setSky)
    scene.background = new THREE.Color(SKY);
    // the viewer's lights: sky and ground, a sun that casts shadows, a soft fill from the front
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = (this.sun = new THREE.DirectionalLight(0xffffff, 2.2));
    sun.castShadow = true;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 0.5, far: 80 });
    scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(0xfff4e6, 1.3);
    fill.position.set(0, 12, 20);
    scene.add(fill);
    this.cam = new THREE.PerspectiveCamera();
    this.cam.matrixAutoUpdate = false;
    this.world = new THREE.Group();
    this.figures = new THREE.Group();
    scene.add(this.world, this.figures);
    this.loader = new GLTFLoader();
    this.models = new Map(); // url -> Promise<Object3D>
    this.pieces = {}; // name -> [{geometry, material}] for instancing
    this.inst = {}; // name -> chunk -> {meshes: [InstancedMesh], sig} (place)
    this.doors = new Map(); // where -> the door's group
    this.items = new Map(); // where + what -> a brick item lying on the floor
    this.fx = new ThrowFX(this); // thrown things, flying and tumbling (throwfx.js)
    this.boulders = null; // boulders rolling and bursting (boulderfx.js: made with the world)
    this.rolling = new Map(); // x,z,url -> a pushed boulder sliding into that square, or just come to rest there
    this.keptRocks = new Map(); // x,z,url -> rocks flung from a broken boulder, lying where they fell (while its rocks are there)
    this.env = gradientEnvironment(THREE, r); // what metal reflects (envmap.js; plastic is lit as ever)
    this.data = null;
    this.ready = Promise.all(Object.entries(PIECES).map(async ([k, url]) => {
      this.pieces[k] = await this.partsOf(url);
      if (k === 'pool') {
        setWaterStud(this.pieces[k][0].geometry.clone(), this.pieces[k][0].material); // (a splash's studs, ThrowFX.splashStuds)
        this.pieces[k] = this.pieces[k].map(({ geometry, material }) => ({ geometry, material: roil(THREE, material) }));
      }
      if (k === 'poolbed') this.pieces[k] = this.pieces[k].map(({ geometry, material }) => { // (still, but as the water over it: the same plastic)
        const m = material.clone(); m.opacity = Math.max(m.opacity, 0.9); m.emissiveIntensity = Math.min(m.emissiveIntensity, 0.2); return { geometry, material: m }; });
      if (k === 'lavapool') { this.lavaStud = { geo: this.pieces[k][0].geometry.clone(), mat: this.pieces[k][0].material }; this.pieces[k] = this.pieces[k].map(({ geometry, material }) => ({ geometry, material: roil(THREE, material, { glow: 1.1 }) })); }
      if (k === 'lavabed') this.pieces[k] = this.pieces[k].map(({ geometry, material }) => { const m = material.clone(); m.opacity = 0.95; m.emissiveIntensity = 0.9; return { geometry, material: m }; });
    }))
      .then(() => this.data && this.setTerrain(this.data));
    // solid boxes for the wall courses under the top one (their studs are hidden anyway), and the ground
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
    this.pieces.course = [{ geometry: box, material: new THREE.MeshStandardMaterial({ color: WALL_GREY, roughness: 0.35, flatShading: true }) }];
    this.pieces.ground = [{ geometry: box, material: new THREE.MeshStandardMaterial({ color: GROUND_GREY, roughness: 0.35, flatShading: true }) }];
  }

  // a .glb, set up as the viewer sets it up
  model(url) {
    if (!this.models.has(url))
      this.models.set(url, new Promise((res, rej) => this.loader.load(url, (g) => {
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          o.material.flatShading = true;
          o.castShadow = o.receiveShadow = true;
          if (o.material.metalness > 0.5) { o.material.envMap = this.env; o.material.envMapIntensity = 1.2; } // chrome: reflects (envmap.js)
          // a doppelganger's other half is shimmering mist
          if (isMist(o.material)) { mistify(o); return; }
          if (isStatic(o.material)) { staticify(o); return; } // (a shade of the dead: the manes)
          if (quantumPart(o.material) !== null) strobify(o);
          // translucent brick (flames, ice) glows
          if (o.material.transparent && o.material.map) o.castShadow = false; // (printed see-through plastic: solid ink, its own alpha)
          else if (o.material.transparent) {
            // translucent plastic glows in its colour; clear plastic is glass: barely glowing, more see-through
            const c = o.material.color, clear = c.r > 0.8 && c.g > 0.8 && c.b > 0.8;
            o.material.emissive = c.clone(); o.material.emissiveIntensity = clear ? 0.12 : 0.7; o.material.opacity = clear ? 0.4 : 0.78; o.castShadow = false;
          }
        });
        addAura(THREE, g.scene); // an angel's glow
        addLightning(THREE, g.scene); // Mjollnir's crackle
        addEffects(THREE, g.scene); // an artifact's element: fire, meteors, frost
        addHueShift(THREE, g.scene); // a magic marker's shifting colour
        addBlink(THREE, g.scene); // a land mine's blinking light
        res(g.scene);
      }, undefined, rej)));
    return this.models.get(url);
  }

  // a .glb's meshes as geometry + material pairs (in the model's own frame), for instancing
  async partsOf(url) {
    const m = await this.model(url);
    m.updateMatrixWorld(true);
    const out = [];
    m.traverse((o) => { if (o.isMesh) out.push({ geometry: o.geometry.clone().applyMatrix4(o.matrixWorld), material: o.material }); });
    return out;
  }

  // fill the instances of a piece: list of [Matrix4, shade]. In chunks of the map (CHUNK squares a
  // side), each its own instanced mesh knowing its bounds: only what's in view (the camera's, the
  // sun's for its shadows) is drawn; and a chunk just as it was isn't sent again
  place(name, list) {
    const parts = this.pieces[name];
    if (!parts) return;
    const chunks = new Map();
    for (const e of list) {
      const el = e[0].elements, big = Math.abs(el[0]) > CHUNK || Math.abs(el[10]) > CHUNK; // (the ground under it all: one piece)
      const key = big ? 'all' : `${Math.floor(el[12] / CHUNK)},${Math.floor(el[14] / CHUNK)}`;
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push(e);
    }
    const had = this.inst[name] || new Map(), now = (this.inst[name] = new Map());
    const shadows = !['plate', 'ground', 'pool', 'poolbed', 'lavapool', 'lavabed'].includes(name); // (the floor casts no shadow: nothing's under it to fall on; nor water)
    const c = new THREE.Color();
    for (const [key, es] of chunks) {
      let sig = es.length;
      for (const [m, shade] of es) { const el = m.elements; sig = (sig * 31 + el[12] * 977 + el[13] * 131 + el[14] * 7919 + el[0] * 17 + el[2] * 23 + shade * 101) % 1e12; }
      let ch = had.get(key);
      had.delete(key);
      if (ch && ch.sig === sig) { now.set(key, ch); continue; }
      if (!ch || ch.meshes[0].instanceMatrix.count < es.length) {
        if (ch) ch.meshes.forEach((m) => { this.world.remove(m); m.dispose(); });
        const cap = Math.max(16, Math.ceil(es.length * 1.5));
        ch = { meshes: parts.map(({ geometry, material }) => {
          const im = new THREE.InstancedMesh(geometry, material, cap);
          im.castShadow = shadows;
          im.receiveShadow = true;
          im.frustumCulled = key !== 'all';
          if (name === 'poolbed' || name === 'lavabed') im.renderOrder = -1; // (a pool's still bed drawn before the studs heaped over it: they don't hide what's after them)
          this.world.add(im);
          return im;
        }) };
      }
      ch.sig = sig;
      for (const im of ch.meshes) {
        es.forEach(([m, shade], i) => { im.setMatrixAt(i, m); im.setColorAt(i, c.setScalar(shade)); });
        im.count = es.length;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
      }
      now.set(key, ch);
    }
    for (const ch of had.values()) ch.meshes.forEach((m) => { this.world.remove(m); m.dispose(); }); // (chunks with nothing left in them)
  }

  // The dungeon, from the game's terrain builder:
  // {w, h, floors: [{x, z, shade, studs}], walls: [{x, z, shade, studs, rise}], doors: [{url, matrix, shade}],
  //  pools: [{x, z, shade}] (water: no floor plate, its hole heaped with roiling clear blue studs)}
  setTerrain(data) {
    this.data = data;
    const M = () => new THREE.Matrix4();
    const S = MODEL_SCALE;
    const plates = [], smooth = [], courses = [], bricks = [];
    // (water a boulder's sinking into: still water, till it's under and its floor's risen there: boulderSink)
    const held = [...(this.pondHold || [])].map((k) => k.split(',').map(Number)).filter(([x, z]) => !(data.pools || []).some((p) => p.x === x && p.z === z));
    for (const f of data.floors) {
      if (held.some(([x, z]) => x === f.x && z === f.z)) continue;
      if (f.studs) plates.push([M().makeTranslation(f.x + 0.5, 0, f.z + 0.5).scale(new THREE.Vector3(S, S, S)), f.shade]);
      else smooth.push([M().makeTranslation(f.x, -PLATE_H, f.z).scale(new THREE.Vector3(1, PLATE_H, 1)), f.shade]); // a printed tile goes on top
    }
    const mines = data.style === 'mines'; // (the Gnomish Mines: brown floors, walls of rock: minesWalls)
    for (const w of mines ? [] : data.walls) {
      // under the wall, the floor's plate; then WALL_COURSES courses of two 2x4 bricks, crossing each course
      // (the Castle's: its outer walls RISE_COURSES[1] more, its towers [2], every other
      // square a course higher again: the battlements)
      const n = WALL_COURSES + (w.rise ? RISE_COURSES[w.rise] + ((w.x + w.z) % 2 === 0 ? 1 : 0) : 0);
      const TOP = (n + 1) * BRICK_H;
      courses.push([M().makeTranslation(w.x, -PLATE_H, w.z).scale(new THREE.Vector3(1, PLATE_H, 1)), w.shade]);
      for (let l = 0; l < n; l++)
        for (const half of [0, 0.5])
          courses.push([l % 2 === 0
            ? M().makeTranslation(w.x, l * BRICK_H, w.z + half).scale(new THREE.Vector3(1, BRICK_H, 0.5))
            : M().makeTranslation(w.x + half, l * BRICK_H, w.z).scale(new THREE.Vector3(0.5, BRICK_H, 1)), w.shade]);
      // the top course: real bricks, studs and all (course 5 runs north-south)
      for (const half of [0.25, 0.75]) {
        const m = M().makeTranslation(w.x + half, TOP, w.z + 0.5).multiply(M().makeRotationY(Math.PI / 2)).scale(new THREE.Vector3(S, S, S));
        bricks.push([m, w.shade]);
      }
    }
    // water: the floor's plate gone, and its hole heaped with nothing but 1x1 round plates (on a bed of more of
    // them, still, the hole's bottom: no grey seen through), their tops sunk
    // under the floor's: one on each of the square's 16 studs, and three more layers between them, each a
    // little deeper, offset to cover the gaps the one above leaves (so thick nothing shows through), each a
    // little off true
    const pools = [], beds = [];
    // (a square a fountain's gushing out to: still its floor, till the water lands there: gushTo)
    const wet = (data.pools || []).concat(held.map(([x, z]) => ({ x, z, shade: 1 }))).filter((p) => !(this.gushing && this.gushing.has(`${p.x},${p.z}`)));
    for (const p of data.pools || []) if (!wet.includes(p)) plates.push([M().makeTranslation(p.x + 0.5, 0, p.z + 0.5).scale(new THREE.Vector3(S, S, S)), p.shade]);
    const lavas = [], lavaBeds = [];
    for (const p of wet) (p.lava ? lavaBeds : beds).push([M().makeTranslation(p.x + 0.5, -0.09, p.z + 0.5).scale(new THREE.Vector3(S, S, S)), p.shade]);
    const LAYERS = [[0.5, 0.5, 4, 4, -0.035], [1, 1, 3, 3, -0.05], [1, 0.5, 3, 4, -0.065], [0.5, 1, 4, 3, -0.08]]; // [x, z offset, how many across, along, top]
    for (const p of wet)
      for (const [ox, oz, nx, nz, top] of LAYERS)
        // (lava: the same, in its own glowing plastic)
        for (let i = 0; i < nx; i++)
          for (let j = 0; j < nz; j++) {
            const h = Math.sin((p.x * 4 + i + ox) * 12.9898 + (p.z * 4 + j + oz) * 78.233 + top * 311) * 43758.5453, r = h - Math.floor(h);
            (p.lava ? lavas : pools).push([M().makeTranslation(p.x + (i + ox) / 4 + (r - 0.5) * 0.04, top, p.z + (j + oz) / 4 + (((r * 7.3) % 1) - 0.5) * 0.04).scale(new THREE.Vector3(S, S, S)), p.shade]);
          }
    this.place('pool', pools);
    this.place('poolbed', beds);
    this.place('lavapool', lavas);
    this.setLavaSmoke(wet.filter((p) => p.lava).map((p) => [p.x, p.z])); // (smoking)
    this.place('lavabed', lavaBeds);
    this.place('plate', mines ? [] : plates);
    this.place('plate_mines', mines ? plates : []);
    const rock = mines ? minesWalls(data) : {};
    for (const k of ['panel_a', 'panel_b', 'rock4', 'fill2']) this.place(k, rock[k] || []);
    // stairs: the brick flights, each turned to run toward its wall (render.js)
    const flight = (up) => (data.stairs || []).filter((st) => st.up === up)
      .map((st) => [M().makeTranslation(st.x + 0.5, 0, st.z + 0.5).multiply(M().makeRotationY(st.turn || 0)).scale(new THREE.Vector3(S, S, S)), st.shade]);
    this.place('stairs_up', flight(true));
    this.place('stairs_down', flight(false));
    this.setStairLights(data.stairs || []);
    // the ground under it all: only under what's drawn (what you know, and the fog about it), in runs along each
    // row; beyond, nothing: the black of the night, till it's found
    const drawn = new Set(), W = data.w;
    for (const list of [data.floors, data.walls, data.pools, data.fog]) for (const c of list || []) drawn.add(c.z * W + c.x);
    const ground = [];
    for (let z = 0; z < data.h; z++)
      for (let x = 0; x < W; x++) {
        if (!drawn.has(z * W + x)) continue;
        let x1 = x;
        while (x1 + 1 < W && drawn.has(z * W + x1 + 1)) x1++;
        ground.push([M().makeTranslation(x, -PLATE_H - BRICK_H, z).scale(new THREE.Vector3(x1 - x + 1, BRICK_H, 1)), 0.95]);
        x = x1;
      }
    this.place('ground', smooth.concat(ground));
    this.place('course', courses);
    this.place('brick', bricks);
    this.setFog(data.fog || [], data.w, data.h);
    // doors: a few, so plain copies of the model. The terrain is rebuilt at
    // every step, so a door that's still there (the same piece in the same
    // place) is kept as it is: one thrown away and loaded again would blink
    const doors = new Map();
    for (const d of data.doors) {
      const key = d.url + '@' + Array.from(d.matrix, (v) => v.toFixed(3)).join(',');
      let g = this.doors.get(key);
      if (!g) {
        g = new THREE.Group();
        g.matrixAutoUpdate = false;
        g.matrix.fromArray(d.matrix);
        this.world.add(g);
        this.model(d.url).then((m) => g.add(m.clone()));
      }
      doors.set(key, g);
    }
    for (const [key, g] of this.doors) if (!doors.has(key)) this.world.remove(g);
    this.doors = doors;
  }

  // Haze over everything not yet explored ([{x, z, into, over}], render.js),
  // up to the edge of the map, like dry-ice fog: one thick volume whose top
  // churns and bubbles and sags softly toward its edges (HAZE_*), heavier than
  // air, so wherever it sits against a room's wall it pours over the studs in
  // a continuous stream, down the inside, dissolving halfway down; and where
  // it meets a path you could walk, it slumps onto the floor and creeps along
  // it (FLOW_*: sheets the streaks flow along).
  setFog(cells, w, h) {
    const key = cells.length + ':' + cells.map((c) => c.x + c.z * 1000 + c.into.length * 0.1 + c.over.length * 0.01).reduce((a, b) => (a * 31 + b) % 1e9, 7);
    if (key === this.fogKey) return;
    this.fogKey = key;
    const fog = new Set(cells.map((c) => c.z * w + c.x));
    const isFog = (x, z) => x >= 0 && z >= 0 && x < w && z < h && fog.has(z * w + x);
    const T = HAZE_TOP, B = -0.05; // (a hair below the floor, so no seam shows at its foot)

    // the haze: its top in 3x3 pieces a square (to billow), and how far each
    // point is in from the haze's edge (0 at the edge: it sags and thins there).
    // (by where the point is, not whose square it's in: a corner shared by
    // squares sags the same in each, so the top never cracks open between them)
    const pos = [], edge = [];
    const N = 3;
    const insets = new Map();
    const inset = (vx, vz) => {
      const k = Math.round(vx * N) * 4096 + Math.round(vz * N); // (each point of the 3x3s worked out once)
      if (insets.has(k)) return insets.get(k);
      let d = 0.67;
      for (let cz = Math.floor(vz) - 2; cz <= Math.floor(vz) + 1; cz++)
        for (let cx = Math.floor(vx) - 2; cx <= Math.floor(vx) + 1; cx++) {
          if (isFog(cx, cz)) continue;
          const dx = Math.max(cx - vx, 0, vx - (cx + 1)), dz = Math.max(cz - vz, 0, vz - (cz + 1));
          d = Math.min(d, Math.hypot(dx, dz));
        }
      insets.set(k, Math.min(1, d / 0.67));
      return insets.get(k);
    };
    for (const c of cells) {
      const { x, z } = c;
      const open = [!isFog(x - 1, z), !isFog(x + 1, z), !isFog(x, z - 1), !isFog(x, z + 1)];
      const tv = (vx, vz) => { pos.push(vx, T, vz); edge.push(inset(vx, vz)); };
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) {
          const x0 = x + i / N, x1 = x + (i + 1) / N, z0 = z + j / N, z1 = z + (j + 1) / N;
          tv(x0, z0); tv(x1, z0); tv(x1, z1); tv(x0, z0); tv(x1, z1); tv(x0, z1);
        }
      // a side wherever the haze ends (the explored dungeon, or the map's edge)
      const side = (a, b, c, d) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); edge.push(0, 0, 0, 0, 0, 0); };
      // and its floor, so what shows through it is more haze, not the baseplate
      const F = B - 0.01;
      side([x, F, z], [x + 1, F, z], [x + 1, F, z + 1], [x, F, z + 1]);
      // (a hair inside its own square: never in the same plane as a wall's face, where they'd flicker;
      // and run on a hair past its ends, so where two sides meet in a corner they close it, no crack)
      const I = 0.03, a = -I, b = 1 + I;
      if (open[2]) side([x + a, B, z + I], [x + b, B, z + I], [x + b, T, z + I], [x + a, T, z + I]);
      if (open[3]) side([x + a, B, z + 1 - I], [x + b, B, z + 1 - I], [x + b, T, z + 1 - I], [x + a, T, z + 1 - I]);
      if (open[0]) side([x + I, B, z + a], [x + I, B, z + b], [x + I, T, z + b], [x + I, T, z + a]);
      if (open[1]) side([x + 1 - I, B, z + a], [x + 1 - I, B, z + b], [x + 1 - I, T, z + b], [x + 1 - I, T, z + a]);
    }
    if (!this.hazeMesh) {
      this.hazeMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: HAZE_VS, fragmentShader: HAZE_FS,
        side: THREE.DoubleSide, // (opaque: it hides what's behind it, and the streams behind it too)
      });
      this.hazeMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.hazeMat);
      this.hazeMesh.frustumCulled = false;
      this.hazeMesh.renderOrder = 5;
      this.scene.add(this.hazeMesh);
    }
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    hg.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
    this.hazeMesh.geometry.dispose();
    this.hazeMesh.geometry = hg;

    // the streams: a sheet along each edge it pours over, following the
    // fog's path (out from the edge, height), streaks flowing along it
    // (over the wall's studded top, and down its inside face a good way before it fades: about a block)
    const WT = (WALL_COURSES + 1) * BRICK_H + 0.17;
    const OVER = [[-0.3, T - 0.45], [0.0, WT], [0.5, WT - 0.03], [0.98, WT - 0.05], [1.07, WT - 0.25], [1.1, WT - 0.62], [1.12, WT - 1.02]];
    const SLUMP = [[-0.25, 1.5], [0.1, 0.9], [0.35, 0.35], [0.7, 0.14], [1.3, 0.12], [2.0, 0.12]];
    const fp = [], fu = [], fs = [], fv = [];
    const sheet = (c, dx, dz, path, lift) => {
      const bx = c.x + 0.5 + dx * 0.5, bz = c.z + 0.5 + dz * 0.5; // the middle of the edge
      const ax = Math.abs(dz), az = Math.abs(dx); // along the edge
      const along0 = bx * ax + bz * az; // (a world coordinate along the edge: streams join up along a wall)
      let len = 0;
      const pts = path.map(([o, y], i) => {
        if (i) len += Math.hypot(o - path[i - 1][0], y - path[i - 1][1]);
        return { o, y: y + lift, s: len };
      });
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        const corner = (pt, e) => [bx + dx * pt.o + ax * e, pt.y, bz + dz * pt.o + az * e];
        const vs = [[p, -0.5], [p, 0.5], [q, 0.5], [p, -0.5], [q, 0.5], [q, -0.5]];
        for (const [pt, e] of vs) {
          fp.push(...corner(pt, e));
          fu.push(along0 + e);
          fs.push(pt.s);
          fv.push(pt.s / len);
        }
      }
    };
    for (const c of cells) {
      for (const [dx, dz] of c.over) { sheet(c, dx, dz, OVER, 0); sheet(c, dx, dz, OVER.map(([o, y]) => [o + 0.05, y]), 0.06); }
      for (const [dx, dz] of c.into) { sheet(c, dx, dz, SLUMP, 0); sheet(c, dx, dz, SLUMP.map(([o, y]) => [o + 0.05, y]), 0.08); }
    }
    if (!this.flowMesh) {
      this.flowMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: FLOW_VS, fragmentShader: FLOW_FS,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      this.flowMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.flowMat);
      this.flowMesh.frustumCulled = false;
      this.flowMesh.renderOrder = 6;
      this.scene.add(this.flowMesh);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    fg.setAttribute('aU', new THREE.Float32BufferAttribute(fu, 1));
    fg.setAttribute('aS', new THREE.Float32BufferAttribute(fs, 1));
    fg.setAttribute('aV', new THREE.Float32BufferAttribute(fv, 1));
    this.flowMesh.geometry.dispose();
    this.flowMesh.geometry = fg;
  }

  // Items lying on the floor as brick models ([{x, z, url, level, upright}], world.js):
  // each laid flat on its side (its length along the floor, the flat of a
  // blade up) across its square at a diagonal; one made to stand (upright:
  // food) set down the right way up. A pile is stacked: the bottom
  // one (level 0) on the studs, each next one resting on top of the one
  // below, turned the other way so they cross like a heap of swords. Kept
  // from frame to frame; only what's picked up, dropped or changed is redone.
  setItems(list) {
    const keep = new Map(), touched = new Set();
    for (const it of list) {
      if (this.drying && this.drying.has(`${it.x},${it.z}`) && it.name === 'fountain') continue; // (drying up: fountainDry has it)
      const level = it.level || 0;
      const key = `${it.x},${it.z},${level},${it.url}`;
      let g = this.items.get(key);
      if (!g) {
        g = new THREE.Group();
        // a slant of its own: diagonal, crossing the one below, and a little off true
        const h = Math.sin(it.x * 12.9898 + it.z * 78.233 + level * 37.719) * 43758.5453;
        const turn = it.name === 'statue' || it.name === 'boulder' || it.name === 'fountain' || it.name === 'sink' || it.name === 'toilet' || /^altar/.test(it.name) ? it.turn || 0 // (a statue, a boulder, a fountain, a sink: square to its square, filling it, its edges its square's; a sink's back to its wall: turn)
          : (level % 2 ? -1 : 1) * Math.PI / 4 + (h - Math.floor(h) - 0.5) * 0.35;
        g.position.set(it.x + 0.5, STUD_H, it.z + 0.5);
        g.rotation.y = turn;
        g.scale.setScalar(MODEL_SCALE);
        g.userData = { square: `${it.x},${it.z}`, level, thick: 0, colliders: it.colliders || null, name: it.name, offer: it.offer || null, spots: it.spots || null };
        const cv = !level && this.converting && this.converting.get(g.userData.square);
        if (cv) { g.userData.rising = cv; g.visible = false; } // (the new altar, of a turned one: risen into its place, after: altarIn)
        this.world.add(g);
        if (this.fx.isIncoming(it.x, it.z, it.url)) g.visible = false; // (still in the air: it lands, then shows: throwfx.js)
        if (this.keptRocks.has(`${it.x},${it.z},${it.url}`)) g.visible = false; // (a broken boulder's rocks: the flung ones lying there are its pile)
        const pose = this.fx.poseFor(it.x, it.z, it.url);
        this.model(it.url).then((m) => {
          const lay = m.clone();
          if (pose) { // thrown here: where and how it came to rest
            g.position.copy(pose.p);
            g.quaternion.copy(pose.q);
            lay.position.copy(pose.c).negate();
            g.add(lay);
            g.userData.posed = true;
            return;
          }
          if (!it.upright) lay.rotation.z = -Math.PI / 2; // on its side: a blade's length (the model's Y) along the floor (food stands as it is)
          lay.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(lay);
          const c = box.getCenter(new THREE.Vector3());
          lay.position.set(it.anchored ? 0 : -c.x, -box.min.y, it.anchored ? 0 : -c.z); // centred on the square (or by its own origin: anchored), its underside at the group's height
          g.add(lay);
          g.userData.lay = lay; // (a chest: its lid swings open, setLids)
          if (g.userData.rising) this.altarIn(g, g.userData.rising);
          g.userData.thick = (box.max.y - box.min.y) * MODEL_SCALE;
          this.restack(g.userData.square);
        });
        touched.add(g.userData.square);
      }
      keep.set(key, g);
    }
    for (const [key, g] of this.items) if (!keep.has(key)) {
      touched.add(g.userData.square);
      const cv = !g.userData.level && this.converting && this.converting.get(g.userData.square);
      if (cv) this.altarOut(g, cv); else this.world.remove(g); // (an altar turned: the old one burning away, as the new rises)
    }
    this.items = keep;
    // a thrown item picked up (or gone): its resting pose forgotten
    for (const k of [...this.fx.poses.keys()]) {
      const [x, z, ...u] = k.split(','), url = u.join(',');
      if (!list.some((it) => it.x === +x && it.z === +z && it.url === url)) this.fx.poses.delete(k);
    }
    for (const sq of touched) this.restack(sq);
    for (const [k, kept] of this.keptRocks) { // (a broken boulder's flung rocks: gone with its rocks)
      const [x, z, ...u] = k.split(','), url = u.join(',');
      if (this.fx.isIncoming(+x, +z, url) || list.some((it) => it.x === +x && it.z === +z && it.url === url)) continue;
      for (const r of kept) this.boulders.remove(r);
      this.keptRocks.delete(k);
    }
  }

  // where a floor item lies (its model's middle, its turn), if it's drawn: {p, q, g}
  lying(x, z, url) {
    for (const [key, g] of this.items) {
      const [gx, gz, , ...gu] = key.split(',');
      if (+gx !== x || +gz !== z || gu.join(',') !== url || !g.children.length) continue;
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g);
      return { p: box.getCenter(new THREE.Vector3()), q: g.quaternion.clone(), g };
    }
    return null;
  }
  boulderFX() { return (this.boulders = this.boulders || new BoulderFX(this.world)); }

  // what a dropped thing falling into square (x, z) knocks against (throwfx.js drop): the hero, if
  // near (heroBody, set every frame: a rounded head things roll off, a body under it), and the solid
  // parts of whatever lies near that has any (items.json "colliders": a statue's column, corbels,
  // basin, figure: boxes in LDraw units, up from its foot, out from its middle); in world units
  colliders(x, z) {
    const out = [], h = this.heroBody;
    if (h && Math.abs(h.x - (x + 0.5)) < 1.5 && Math.abs(h.z - (z + 0.5)) < 1.5) {
      out.push({ sphere: [h.x, h.top - 0.2, h.z, 0.2] });
      out.push({ box: [h.x - 0.18, h.y0, h.z - 0.12, h.x + 0.18, h.top - 0.3, h.z + 0.12], hero: true });
    }
    for (const g of this.items.values()) {
      const cl = g.userData.colliders;
      if (!cl || !g.visible) continue;
      const [gx, gz] = g.userData.square.split(',').map(Number);
      if (Math.abs(gx - x) > 1 || Math.abs(gz - z) > 1) continue;
      const P = g.position, L = 1 / 80;
      for (const [x0, y0, z0, x1, y1, z1] of cl) out.push({ box: [P.x + x0 * L, P.y + y0 * L, P.z + z0 * L, P.x + x1 * L, P.y + y1 * L, P.z + z1 * L] });
    }
    return out;
  }

  // the hero pushed a boulder (its model) from square (fx, fz) into (tx, tz): it rolls there,
  // tumbling (boulderfx.js), hidden on the floor till it comes to rest, then lies as it came to rest
  async boulderPush(url, fx, fz, tx, tz) {
    const k = `${tx},${tz},${url}`, from = `${fx},${fz},${url}`, t = this.fx, fxb = this.boulderFX();
    t.incoming.set(k, (t.incoming.get(k) || 0) + 1);
    this.redrawItems(k);
    // the boulder still sliding there, or only just come to rest, is the one pushed on (never a
    // second one made beside it); else it's made where it lies
    let b = this.rolling.get(from);
    if (b) { this.rolling.delete(from); clearTimeout(b.gone); }
    const at = this.lying(fx, fz, url);
    if (at) at.g.visible = false; // (gone from where it was: the map catches up)
    t.forget(fx, fz, url);
    if (!b) {
      let m;
      try { m = await this.model(url); } catch { t.land(k); return; }
      b = fxb.place(m, fx, fz, at);
    }
    const id = (b.pushId = (b.pushId || 0) + 1);
    this.rolling.set(k, b);
    await fxb.push(b, tx, tz);
    if (b.pushId !== id) { t.land(k); return; } // (pushed on before it came to rest: that push has it now)
    t.poses.set(k, { p: b.p.clone(), q: b.q.clone(), c: b.c.clone() });
    t.land(k);
    b.gone = setTimeout(() => { // (till the floor's own model of it is drawn there: no blink)
      if (this.rolling.get(k) === b) this.rolling.delete(k);
      fxb.remove(b);
    }, 150);
  }

  // a boulder pushed into water (url: its model; from (fx, fz) to (tx, tz)): it rolls off its square into the
  // water and sinks under it with a great splash; filling it (fills), a floor plate rises up through the
  // water into place, and that's floor now. The water stays drawn till then (setTerrain: pondHold)
  async boulderSink(url, fx, fz, tx, tz, fills) {
    const sq = `${tx},${tz}`, hold = (this.pondHold = this.pondHold || new Set());
    hold.add(sq);
    if (this.data) this.setTerrain(this.data);
    const release = () => { hold.delete(sq); if (this.data) this.setTerrain(this.data); };
    const at = this.lying(fx, fz, url);
    if (at) at.g.visible = false; // (gone from where it was: the map catches up)
    let m;
    try { m = await this.model(url); } catch { release(); return; }
    const lay = m.clone(), box = new THREE.Box3().setFromObject(lay), c = box.getCenter(new THREE.Vector3()), h = (box.max.y - box.min.y) * MODEL_SCALE;
    lay.position.copy(c).negate();
    const holder = new THREE.Group();
    holder.scale.setScalar(MODEL_SCALE);
    holder.add(lay);
    this.world.add(holder);
    const dx = tx - fx, dz = tz - fz, n = Math.hypot(dx, dz) || 1, axis = new THREE.Vector3(dz / n, 0, -dx / n), q0 = new THREE.Quaternion();
    const water = new THREE.Vector3(tx + 0.5, -0.03, tz + 0.5);
    const ROLL = 0.45, SINK = 0.8, t0 = performance.now() / 1000;
    let splashed = 0;
    await new Promise((res) => {
      const step = () => {
        const t = performance.now() / 1000 - t0, u = Math.min(1, t / ROLL), v = Math.max(0, Math.min(1, (t - ROLL) / SINK));
        const e = u * u * (3 - 2 * u), along = Math.min(1, e + 0.12 * v); // (rolling on a little as it goes under)
        holder.position.set(fx + 0.5 + dx * along, STUD_H + h / 2 - (h + 0.12) * v * v, fz + 0.5 + dz * along);
        holder.quaternion.copy(q0).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, (along * n) / (h / 2)));
        if (splashed === 0 && t >= ROLL * 0.9) { splashed = 1; this.fx.splashStuds(water, 22, 2.3); }
        if (splashed === 1 && t >= ROLL + SINK * 0.5) { splashed = 2; this.fx.splashStuds(water, 8, 1.2); }
        if (t >= ROLL + SINK) { this.world.remove(holder); res(); return; }
        requestAnimationFrame(step);
      };
      step();
    });
    if (!fills) { release(); return; }
    // (filled: its floor rising up through the water, and that's floor)
    const plate = new THREE.Group();
    for (const { geometry, material } of this.pieces.plate || []) plate.add(new THREE.Mesh(geometry, material));
    plate.scale.setScalar(MODEL_SCALE);
    this.world.add(plate);
    const RISE = 0.5, r0 = performance.now() / 1000;
    await new Promise((res) => {
      const step = () => {
        const u = Math.min(1, (performance.now() / 1000 - r0) / RISE);
        plate.position.set(tx + 0.5, -0.16 * (1 - u * u * (3 - 2 * u)), tz + 0.5);
        if (u >= 1) { res(); return; }
        requestAnimationFrame(step);
      };
      step();
    });
    release();
    this.fx.splashStuds(new THREE.Vector3(tx + 0.5, STUD_H, tz + 0.5), 6, 0.9, { ring: false });
    setTimeout(() => this.world.remove(plate), 50); // (till the floor's own plate is drawn there: no blink)
  }

  // a boulder (its model) at (x, z) broke into rocks (rockUrl): it bursts, grit and rocks flying;
  // a few of the flung ones stay, lying about the square where they fell: they're the rocks the
  // engine left there (its pile not drawn while they lie there), gone when its rocks are
  // (halves: its two halves' models, if it has them: it cracks in half first, boulderfx.js crack)
  async boulderBreak(url, x, z, rockUrl, halves) {
    const k = `${x},${z},${rockUrl}`, t = this.fx;
    t.incoming.set(k, (t.incoming.get(k) || 0) + 1);
    this.redrawItems(k);
    const at = this.lying(x, z, url);
    if (at) at.g.visible = false;
    let m, rock, hv = null;
    try { [m, rock] = await Promise.all([this.model(url), this.model(rockUrl)]); } catch { t.land(k); return; }
    if (halves && halves.length === 2) hv = await Promise.all(halves.map((u) => this.model(u))).catch(() => null);
    const fxb = this.boulderFX(), b = fxb.place(m, x, z, at);
    for (const r of this.keptRocks.get(k) || []) fxb.remove(r);
    // (the pieces flung all go once they've come to rest; then the floor's own pile of rocks shows)
    await (hv ? fxb.crack(b, hv, rock, 5, true) : fxb.shatter(b, rock, 5, null, true));
    t.land(k);
  }

  // A statue broken (dug into, a force bolt...): the game says so only by the floor's list changing,
  // a statue fewer on a square and more rocks there than before (not one gone with no rocks: a
  // statue trap come alive, stone to flesh, one picked up; nor a second statue left standing).
  // Watched every time the list might have changed (list: world.brickDrops; lvl: which level it's
  // of, a new one all just there; item(name): a brick item, items.built.json): where one broke, it
  // comes apart there (statueBreak), and whatever came out of it (its rocks, what was inside it)
  // shows once the pieces are gone. The squares it happened on: [[x, z]...]
  watchStatues(list, lvl, item) {
    const now = new Map(), broke = [];
    for (const d of list) {
      const k = `${d.x},${d.z}`, e = now.get(k) || { s: 0, r: 0, u: new Map() };
      if (d.name === 'statue') e.s++;
      else if (d.name === 'rock') e.r++;
      e.u.set(d.url, (e.u.get(d.url) || 0) + 1);
      now.set(k, e);
    }
    const was = this.statuesSeen;
    if (was && was.lvl === lvl)
      for (const [k, w] of was.at) {
        const e = now.get(k) || { s: 0, r: 0, u: new Map() };
        if (!(e.s < w.s && e.r > w.r)) continue;
        const st = item('statue'), [x, z] = k.split(',').map(Number);
        if (!st || !st.bricks) continue;
        const out = [...e.u].filter(([u, n]) => n > (w.u.get(u) || 0)).map(([u]) => u); // (what wasn't there before)
        this.statueBreak(st.url, x, z, out, st.bricks);
        broke.push([x, z]);
      }
    this.statuesSeen = { lvl, at: new Map([...now].filter(([, e]) => e.s > 0)) };
    return broke;
  }

  // a statue broken at (x, z) (url: its model; bricks: each brick's model and place in it,
  // items.built.json "bricks"): the figure crumbles and the bricks blow apart (boulderfx.js crumble),
  // each going once it's at rest; what it left (out: those items' urls: its rocks, its contents)
  // shows on the floor after
  // (figAt: how high up in it (studs) a brick is part of what crumbles, not blown apart; else above a statue's plinth)
  async statueBreak(url, x, z, out, bricks, figAt = null) {
    const ks = out.map((u) => `${x},${z},${u}`), t = this.fx;
    for (const k of ks) { t.incoming.set(k, (t.incoming.get(k) || 0) + 1); this.redrawItems(k); }
    const done = () => ks.forEach((k) => t.land(k));
    let whole, models;
    try { [whole, models] = await Promise.all([this.model(url), Promise.all(bricks.map((b) => this.model(b.url)))]); } catch { done(); return; }
    // where each brick is, as the statue stood: centred on its square, its foot on the studs (setItems)
    const box = new THREE.Box3().setFromObject(whole.clone());
    const off = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
    const foot = new THREE.Vector3(x + 0.5, STUD_H, z + 0.5);
    const base = figAt ?? (bricks.find((b) => /part-35394-/.test(b.url)) || { pos: [0, 0, 0] }).pos[1] + 0.1;
    const pieces = bricks.map((b, i) => ({ model: models[i], pos: new THREE.Vector3(...b.pos).sub(off).multiplyScalar(MODEL_SCALE).add(foot),
      q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(new THREE.Matrix3().set(...b.mat))), fig: b.pos[1] > base }));
    await this.boulderFX().crumble(pieces, foot, true);
    done();
  }

  // how far the world is drawn (squares; 0: as far as the camera sees), hazing into the sky over
  // its last 30% (Ascend: half the dungeon's)
  setDistance(far) {
    if (far === this.far) return;
    this.far = far;
    this.scene.fog = far ? new THREE.Fog(this.sky, far * 0.7, far) : null;
  }

  // the sky (and what the far distance hazes into): a colour
  setSky(hex) {
    this.sky = hex;
    this.scene.background.setHex(hex);
    if (this.scene.fog) this.scene.fog.color.setHex(hex);
  }

  // Punished: the ball and chain on the hero's ankle (ballchain.js), drawn in physics in place of
  // the two floor items ({ball: [x, z] (its square) or null (carried: held before you), ballUrl,
  // linkUrl}), or null. The hero: the first figure (setFigures)
  setPunished(p) { this.punished = p; }
  // the ball thrown by the one chained to it: the ball itself flung to square (x, z), the chain after it (not a copy
  // of it flown there: ballchain.js toss); false if there's no ball and chain drawn to throw
  tossBall(x, z) {
    const bc = this.chain && this.chain.bc;
    if (!bc) return false;
    bc.toss(x + 0.5, z + 0.5);
    return true;
  }
  stepChain(dt) {
    const p = this.punished, g = this.figObjs && this.figObjs[0], j = g && g.userData.joints;
    if (this.chain && (!p || this.chain.joints !== j)) { if (this.chain.bc) this.chain.bc.dispose(); this.chain = null; }
    if (!p || !j) return;
    this.figures.updateMatrixWorld(true);
    if (!this.chain) {
      const c = (this.chain = { joints: j, bc: null });
      Promise.all([this.model(p.ballUrl), this.model(p.linkUrl)]).then(([ball, link]) => {
        if (this.chain !== c) return;
        const anchor = ankleAnchor(j.joints, this.world), a = anchor();
        const b = this.punished && this.punished.ball;
        c.bc = new BallChain({ link, ball, anchor, parent: this.world, links: 10, floor: STUD_H, scale: MODEL_SCALE,
          dir: b ? new THREE.Vector3(b[0] + 0.5 - a.x, 0, b[1] + 0.5 - a.z) : new THREE.Vector3(0, 0, 1) });
      }).catch(() => {});
      return;
    }
    const bc = this.chain.bc;
    if (!bc) return;
    const body = j.joints.body;
    bc.carry(!p.ball && body ? () => HUG.clone().applyMatrix4(body.matrixWorld) : null); // (carried: before you, as hold.hug holds it)
    if (p.ball) bc.home(p.ball[0] + 0.5, p.ball[1] + 0.5);
    const at = new THREE.Vector3().setFromMatrixPosition(g.matrixWorld);
    bc.keepOut({ x: at.x, z: at.z, r: HERO_R }); // (set down, it rolls to your feet: never into you)
    bc.step(dt);
  }

  // a thrown item landed (or burst): its square's items made again (with its pose, shown)
  redrawItems(k) {
    const [x, z, ...u] = k.split(','), url = u.join(',');
    for (const [key, g] of [...this.items]) {
      const [gx, gz, , ...gu] = key.split(',');
      if (+gx === +x && +gz === +z && gu.join(',') === url) { this.world.remove(g); this.items.delete(key); }
    }
  }

  // a chest on square (x, z) opened (looted) or shut: its lid swings to match, over a moment (tickLids)
  // (T: s it takes, a slam's quick; max: how far it goes, a jolt's just a crack)
  setLid(x, z, open, T = 0.45, max = 1) {
    this.lids = this.lids || new Map();
    this.lids.set(`${x},${z}`, { open, at: this.lids.get(`${x},${z}`)?.at ?? 0, T, max });
  }
  // a box or a chest on (x, z) (items.json: one with a hinged lid), as drawn
  boxAt(x, z) { return [...this.items.values()].find((g) => g.userData.square === `${x},${z}` && /^(chest|large box|ice box)$/.test(g.userData.name)) || null; }
  // kicked (dokick.c, web_boxfx): THUD, it jumps and rattles; something inside breaking (a muffled shatter: its
  // glass and what was in it out of the seam of its lid, jolted up a crack; an egg cracking); its lock broken open
  // (sparks, bits of it flung); its lid slammed open and falling shut. tint: what broke inside, its colour
  boxFx(x, z, act, tint = null) {
    const g = this.boxAt(x, z), top = new THREE.Vector3(x + 0.5, STUD_H + 0.42, z + 0.5);
    switch (act) {
      case 'thud': if (g) this.shakeItem(g, 0.5, 0.05); break;
      case 'shatter':
        this.setLid(x, z, true, 0.06, 0.18); setTimeout(() => this.setLid(x, z, false, 0.2), 120);
        this.fx.sparkles(top, 18, 0xd8f0ff, 0.25);
        this.fx.splashStuds(top, 7, 0.9, { floor: STUD_H, ring: false, tint: tint ?? 0x9fd8ff });
        break;
      case 'crack': this.fx.splashStuds(top, 5, 0.6, { floor: STUD_H, ring: false, tint: 0xf2e6a8 }); break;
      case 'lockbreak': if (g) this.shakeItem(g, 0.3, 0.03); this.fx.sparkles(top, 24, 0xffd060, 0.2); this.fx.sparkles(top, 10, 0xb8b8c0, 0.3); break;
      case 'slam': this.setLid(x, z, true, 0.12); setTimeout(() => this.setLid(x, z, false, 0.22), 380); if (g) setTimeout(() => this.shakeItem(g, 0.3, 0.03), 600); break;
    }
  }
  // a thing on the floor jumping and rattling where it stands (kicked: a box; a sink, a toilet: shakeItem): T s, dying away
  shakeItem(g, T = 0.8, amp = 0.025) {
    const base = g.userData.shakeBase || (g.userData.shakeBase = g.position.clone()), t0 = performance.now();
    const tick = () => {
      const u = (performance.now() - t0) / 1000 / T;
      if (u >= 1 || !g.parent) { g.position.copy(base); return; }
      const k = amp * (1 - u);
      g.position.set(base.x + k * Math.sin(u * 95), base.y + Math.abs(k * 0.8 * Math.sin(u * 40)), base.z + k * Math.cos(u * 83));
      requestAnimationFrame(tick);
    };
    tick();
  }
  tickLids(dt) {
    if (!this.lids) return;
    for (const [sq, l] of this.lids) {
      l.at = Math.max(0, Math.min(l.max ?? 1, l.at + (l.open ? dt : -dt) / (l.T ?? 0.45)));
      const e = l.at * l.at * (3 - 2 * l.at); // (eased: it creaks open, settles back)
      for (const g of this.items.values())
        if (g.userData.square === sq && g.userData.lay) {
          const max = setHinge(THREE, g.userData.lay, 0);
          if (max !== false) setHinge(THREE, g.userData.lay, -max * e);
        }
      if (!l.open && l.at === 0) this.lids.delete(sq);
    }
  }

  // a square's pile, each item resting on the one below
  // a fountain's water flaring up, an angel's aura round it: "the water glows for a moment" (glint); or as
  // it's found to be magic, a wisp of vapor rising out of it (flare).
  // Its see-through blue pieces (the water: its pool, its basins, the studs it throws) given their own
  // plastic, lit from within
  fountainFlare(x, z, delay = 0) {
    const t = performance.now() / 1000 + delay;
    (this.fglints = this.fglints || []).push({ sq: `${x},${z}`, t, T: 4.5, peak: 2.2 });
    setTimeout(() => this.fx.vapor(new THREE.Vector3(x + 0.5, STUD_H + 1.15, z + 0.5)), delay * 1000);
  }
  fountainGlint(x, z, delay = 0) {
    (this.fglints = this.fglints || []).push({ sq: `${x},${z}`, t: performance.now() / 1000 + delay, T: 2.2, peak: 2 });
  }
  stepFountainGlow(now) {
    const lit = new Map(); // square -> how brightly, now
    for (const g of [...(this.fglints || [])]) {
      const u = (now - g.t) / g.T;
      if (u > 1) { this.fglints.splice(this.fglints.indexOf(g), 1); continue; }
      if (u < 0) continue;
      const k = g.peak * (u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85) ** 1.5; // (up fast, dying away)
      lit.set(g.sq, Math.max(lit.get(g.sq) || 0, k));
    }
    if (!lit.size && !this.fglowing) return;
    this.fglowing = lit.size > 0;
    for (const g of this.items.values()) {
      const lay = g.userData.lay;
      if (!lay) continue;
      if (g.userData.fountain === undefined) { // (is it a fountain? its water's own plastic, once)
        let f = false;
        lay.traverse((o) => { if (o.userData && o.userData.fx === 'fountain') f = true; });
        g.userData.fountain = f ? [] : null;
        if (f) lay.traverse((o) => {
          if (!o.isMesh || !o.material.transparent || !o.material.emissive) return;
          const c = o.material.color;
          if (!(c.b > 0.6 && c.r < 0.9)) return; // (the blue: not the clear, nor the flame)
          const m = o.material.clone();
          m.onBeforeCompile = o.material.onBeforeCompile; // (the thrown studs: their flight is in the shader)
          if (o.material.customProgramCacheKey) m.customProgramCacheKey = o.material.customProgramCacheKey;
          o.material = m;
          g.userData.fountain.push({ m, e: m.emissive.clone(), i: m.emissiveIntensity });
        });
      }
      if (!g.userData.fountain) continue;
      const k = lit.get(g.userData.square) || 0;
      if (k === (g.userData.glowK || 0)) continue;
      g.userData.glowK = k;
      // ...and an angel's aura round all its bricks (made the first time it flares)
      if (k > 0 && !g.userData.aura) {
        g.userData.aura = auraOf(THREE, lay).map((m) => ({ m, s: m.material.uniforms.uStrength.value }));
        lay.updateMatrixWorld(true);
      }
      for (const a of g.userData.aura || []) { a.m.visible = k > 0; a.m.material.uniforms.uStrength.value = a.s * Math.min(3, k / 0.55); } // (flaring with the water)
      for (const w of g.userData.fountain) {
        w.m.emissive.copy(w.e).lerp(FOUNT_GLOW, Math.min(1, k));
        w.m.emissiveIntensity = w.i + k * 1.4;
      }
    }
  }

  // a fountain dried up at (x, z) (url: its model; bricks: its bricks, items.built.json, its water in grey):
  // the water stops; the water heaped in its pool and the flame on its top evaporate (rising, thinning away,
  // wisps of vapor coming off them: its joints "pool" and "flame"), and every other blue piece of it greys
  // to stone; it stands a moment, and it comes apart brick by brick (statueBreak: its tiers crumbling, its
  // basin blown apart), each going once it's at rest. Taken from the floor's items (setItems leaves it be).
  // Gushing as it goes (dug into), its water all lands first. Returns s till it begins to dry
  fountainDry(x, z, url, bricks, delay = 0) {
    const sq = `${x},${z}`;
    let key = null, g = null;
    for (const [k, gg] of this.items) {
      if (gg.userData.square !== sq || !gg.userData.lay) continue;
      let f = false;
      gg.userData.lay.traverse((o) => { if (o.userData && o.userData.fx === 'fountain') f = true; });
      if (f) { key = k; g = gg; break; }
    }
    if (!g) return 0;
    this.items.delete(key);
    (this.drying = this.drying || new Set()).add(sq);
    (this.held = this.held || new Map()).set(sq, g); // (still where it stood, its water still pouring: fountainTop finds it)
    // (gushing first, should it be: dug into, it gushes, then dries up: once the last of its water has landed)
    const wait = Math.max(delay, ((this.gushEnd && this.gushEnd.get(sq)) || 0) - performance.now() / 1000); // (or after delay s: the Lady first)
    setTimeout(() => this.dryStart(g, x, z, url, bricks), wait * 1000);
    return wait;
  }
  dryStart(g, x, z, url, bricks) {
    const lay = g.userData.lay, mats = [], evap = [], nodes = new Set();
    const goes = (o) => { for (let n = o; n && n !== lay; n = n.parent) if (n.name === 'pool' || n.name === 'flame') return n; return null; };
    lay.updateMatrixWorld(true);
    lay.traverse((o) => {
      if (!o.isMesh) return;
      if (o.isInstancedMesh || o.material.isShaderMaterial) { o.visible = false; return; } // (the water stops; no glow about it)
      const n = goes(o), c = o.material.color;
      if (!n && !(o.material.transparent && o.material.emissive && c.b > 0.6 && c.r < 0.9)) return;
      const m = o.material.clone();
      m.onBeforeCompile = o.material.onBeforeCompile;
      o.material = m;
      if (n) { m.transparent = true; m.depthWrite = false; evap.push({ m, o: m.opacity }); nodes.add(n); }
      else mats.push({ m, c: m.color.clone(), e: m.emissive.clone(), i: m.emissiveIntensity, o: m.opacity });
    });
    // (wisps of vapor: off the pool, round it, and off the flame, at its top)
    const wisps = [];
    for (const n of nodes) {
      const b = new THREE.Box3().setFromObject(n), mid = b.getCenter(new THREE.Vector3());
      if (n.name === 'flame') wisps.push(mid.clone().setY(b.max.y));
      else for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.4, r = Math.min(b.max.x - b.min.x, b.max.z - b.min.z) * 0.32;
        wisps.push(new THREE.Vector3(mid.x + Math.cos(a) * r, b.max.y, mid.z + Math.sin(a) * r)); }
    }
    wisps.forEach((p, i) => setTimeout(() => this.fx.vapor(p), 120 + i * 140));
    (this.dries = this.dries || []).push({ g, mats, evap, nodes: [...nodes].map((n) => ({ n, y: n.position.y })), x, z, url,
      bricks: bricks && bricks.filter((b) => b.group !== 'pool' && b.group !== 'flame'), t0: performance.now() / 1000 });
  }
  stepDry(now) {
    for (const d of [...(this.dries || [])]) {
      const t = now - d.t0, k = Math.min(1, t / DRY_GREY);
      for (const w of d.mats) {
        w.m.color.copy(w.c).lerp(DRY_STONE, k);
        w.m.emissive.copy(w.e).multiplyScalar(1 - k);
        w.m.emissiveIntensity = w.i * (1 - k);
        w.m.opacity = w.o + (1 - w.o) * k;
      }
      for (const w of d.evap) w.m.opacity = w.o * (1 - k) ** 1.5; // (the water and the flame: thinning away as they rise)
      for (const { n, y } of d.nodes) { n.position.y = y + 0.6 * k; n.visible = k < 1; }
      if (t < DRY_GREY + DRY_SIT) continue;
      this.dries.splice(this.dries.indexOf(d), 1);
      this.world.remove(d.g);
      this.held.delete(`${d.x},${d.z}`);
      if (d.bricks) this.statueBreak(d.url, d.x, d.z, [], d.bricks, DRY_CRUMBLE).then(() => this.drying.delete(`${d.x},${d.z}`));
      else this.drying.delete(`${d.x},${d.z}`);
    }
  }

  // the Lady of the Lake (a long sword dipped: Excalibur), at the fountain the hero's on: at, where the sword is
  // in the water (its surface); yaw, the way the hero faces (the game's yaw). Good: her arm, clad in white
  // samite (url: its model), rises up out of the water beside the sword, her hand to it; a burst of golden
  // light about the sword, the blessing; and down she sinks again. Else: a freezing mist rises and wraps the
  // sword, glittering with frost. Resolves once it's over (LADY_T s, or a little less for the mist)
  ladyOfTheLake(at, yaw, url, good) {
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw)), side = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const blade = at.clone().addScaledVector(fwd, 0.05).setY(at.y + 0.12);
    const later = (s, f) => setTimeout(f, s * 1000);
    if (!good) { // (the mist: billowing up round the sword, frost glittering in it)
      for (let k = 0; k < 6; k++) later(0.3 + k * 0.18, () => this.fx.vapor(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25)), 0xcfe8ff));
      later(0.8, () => this.fx.sparkles(blade, 30, 0xbfe6ff, 0.3));
      later(1.5, () => this.fx.sparkles(blade, 20, 0xbfe6ff, 0.25));
      return new Promise((res) => later(LADY_T - 1.6, res));
    }
    return this.model(url).then((m) => new Promise((res) => {
      const arm = m.clone(), holder = new THREE.Group();
      arm.rotation.x = 0.47; // (the arm piece is bent: stood up straight, the hand right over the shoulder)
      holder.add(arm);
      holder.scale.setScalar(MODEL_SCALE);
      // (facing the hero across the sword, a little to the side of it)
      holder.rotation.y = -yaw;
      const base = at.clone().addScaledVector(fwd, 0.16).addScaledVector(side, 0.05);
      this.world.add(holder);
      const RISE = [0.5, 1.7], SINK = [3.3, 4.3], t0 = performance.now() / 1000, low = at.y - 0.42, high = at.y + 0.1;
      let blessed = false, splashed = 0;
      const step = () => {
        const t = performance.now() / 1000 - t0;
        const up = t < RISE[0] ? 0 : t < RISE[1] ? (t - RISE[0]) / (RISE[1] - RISE[0]) : t < SINK[0] ? 1 : Math.max(0, 1 - (t - SINK[0]) / (SINK[1] - SINK[0]));
        const e = up * up * (3 - 2 * up);
        holder.position.copy(base).setY(low + (high - low) * e + 0.012 * Math.sin(t * 2.2) * (up > 0.99 ? 1 : 0));
        holder.rotation.z = 0.08 * Math.sin(t * 1.3) * e; // (swaying a little, held there)
        if (splashed === 0 && t > RISE[0]) { splashed = 1; this.fx.splashStuds(at.clone().addScaledVector(fwd, 0.16), 10, 1.2); }
        if (splashed === 1 && t > SINK[0] + 0.5) { splashed = 2; this.fx.splashStuds(at.clone().addScaledVector(fwd, 0.16), 8, 1.0); }
        if (!blessed && t > 2.1) { // (the blessing: golden light bursting about the sword)
          blessed = true;
          this.fx.sparkles(blade, 40, 0xffc21a, 0.22);
          later(0.35, () => this.fx.sparkles(blade, 30, 0xffe27a, 0.3));
          later(0.7, () => this.fx.sparkles(blade, 20, 0xffc21a, 0.35));
        }
        if (t >= SINK[1]) { this.world.remove(holder); res(); return; }
        requestAnimationFrame(step);
      };
      step();
    })).catch(() => {});
  }

  // lava smoking (mist.js smokeVents): a couple of vents on each pit square, at its own spots in it, a little
  // fountain of smoke off each; made again only when the pits change
  setLavaSmoke(squares) {
    const key = squares.map((q) => q.join(',')).join(';');
    if (key === this.smokeKey) return;
    this.smokeKey = key;
    if (this.smoke) { this.world.remove(this.smoke); this.smoke.geometry.dispose(); this.smoke.material.dispose(); this.smoke = null; }
    if (!squares.length) return;
    const vents = [];
    for (const [x, z] of squares)
      for (let k = 0; k < 2; k++) {
        const h = Math.sin(x * 12.9898 + z * 78.233 + k * 37.7) * 43758.5453, r = h - Math.floor(h), r2 = (r * 7.31) % 1;
        vents.push([x + 0.2 + r * 0.6, 0.0, z + 0.2 + r2 * 0.6]); // (off the heap's top)
      }
    this.smoke = smokeVents(THREE, vents);
    this.world.add(this.smoke);
  }

  // a fountain at (x, z) whose flow has reduced to a trickle: a few of its studs falling out of its top, not a stream
  fountainTrickle(x, z) {
    for (const g of this.items.values()) {
      if (g.userData.square !== `${x},${z}` || !g.userData.lay) continue;
      g.userData.lay.traverse((o) => { if (o.isInstancedMesh && o.material.onBeforeCompile && !o.material.userData.roil) o.count = Math.min(o.count, 7); });
    }
  }
  // which side of a fountain you're up on (side: {wx, wz}, from its middle), told as you are: what lies on its
  // square lies on its rim where you stand, a little to your right (rimSpot)
  setFountainSide(x, z, side) {
    const sq = `${x},${z}`, was = (this.fountSide = this.fountSide || new Map()).get(sq);
    if (was && was.wx === side.wx && was.wz === side.wz) return;
    this.fountSide.set(sq, { wx: side.wx, wz: side.wz });
    this.restack(sq);
  }
  // where on a fountain's rim things on its square lie, off its middle ([x, z], squares)
  rimSpot(sq) {
    const side = this.fountSide && this.fountSide.get(sq);
    if (!side) return [FOUNT_RIM_SPOT[0], FOUNT_RIM_SPOT[2]];
    const R = 0.86, a = Math.atan2(side.wz, side.wx) - 0.38; // (round the rim from where you stand, to your right as you face the fountain)
    return [Math.cos(a) * R, Math.sin(a) * R];
  }
  // the water in a fountain at (fx, fz): its surface, over the middle of its basin (squares)
  fountainWater(fx, fz) { return new THREE.Vector3(fx + 0.5, STUD_H + 0.5, fz + 0.5); }
  // no water nymph: a great bubble (url: its model) swelling up out of the fountain's water, rising, and popping
  // into a burst of its water
  fountainBubble(fx, fz, url) {
    const w = this.fountainWater(fx, fz).add(new THREE.Vector3(-0.1, 0, 0.45)); // (in the basin, before its column)
    return this.model(url).then((m) => new Promise((res) => {
      const b = m.clone(), box = new THREE.Box3().setFromObject(b), c = box.getCenter(new THREE.Vector3());
      b.position.copy(c).negate();
      const holder = new THREE.Group();
      holder.add(b);
      this.world.add(holder);
      const T = 1.4, t0 = performance.now() / 1000;
      const step = () => {
        const u = (performance.now() / 1000 - t0) / T;
        if (u >= 1) { // (pop)
          this.world.remove(holder);
          this.fx.splashStuds(holder.position.clone(), 18, 1.8, { floor: w.y, ring: false });
          this.fx.splashStuds(w, 6, 1.0);
          res(); return;
        }
        const k = u * u * (3 - 2 * u), wob = 1 + 0.05 * Math.sin(u * 40) * u; // (swelling, wobbling as it goes)
        const sc = MODEL_SCALE * (0.6 + 2.2 * k); // (swelling to a great bubble, twice a helmet's size)
        holder.scale.set(sc * wob, sc / wob, sc * wob);
        holder.position.copy(w).setY(w.y - 0.05 + 0.45 * k);
        requestAnimationFrame(step);
      };
      step();
    })).catch(() => {});
  }
  // a gem found in a fountain's water (url: its model): the water sparkling where it lies, and the gem kept out of
  // sight in the pool (fx incoming) while you pull it out and hold it up (main.js 'gem'); show() puts it there
  fountainGem(fx, fz, url) {
    const k = `${fx},${fz},${url}`, t = this.fx;
    t.incoming.set(k, (t.incoming.get(k) || 0) + 1);
    this.redrawItems(k);
    this.fx.sparkles(this.fountainWater(fx, fz).add(new THREE.Vector3(-0.3, 0, 0.1)), 26, 0xbfefff, 0.3);
    return { show: () => t.land(k) };
  }
  // ---- a sink (items.json "sink"): where its tap's spout is, and the drain in its bowl (world units), as it
  // stands, turned on its square (its back to a wall: setItems)
  sinkAt(x, z, name = 'sink') { return [...this.items.values()].find((g) => g.userData.square === `${x},${z}` && g.userData.name === name) || null; }
  sinkSpot(x, z, [ox, oy, oz], name = 'sink') {
    const g = this.sinkAt(x, z, name), t = g ? g.rotation.y : 0, c = Math.cos(t), s = Math.sin(t);
    return new THREE.Vector3(x + 0.5 + ox * c + oz * s, STUD_H + oy, z + 0.5 - ox * s + oz * c);
  }
  sinkSpout(x, z) { return this.sinkSpot(x, z, SINK_SPOUT); }
  sinkDrain(x, z) { return this.sinkSpot(x, z, SINK_DRAIN); }
  // a toilet (items.json "toilet"): the water in its bowl
  toiletWater(x, z) { return this.sinkSpot(x, z, TOILET_WATER, 'toilet'); }
  // something crawling up out of a toilet: a brown ooze heaving up out of its bowl, over its seat, glistening,
  // wobbling there; and (back) slithering back down out of sight. Resolves once it's done
  toiletOoze(x, z, back = true) {
    const w = this.toiletWater(x, z), T = back ? 3.2 : 2.0;
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.25, metalness: 0.05 });
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 2), mat);
    this.world.add(blob);
    const t0 = performance.now();
    return new Promise((res) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        if (t > T) { this.world.remove(blob); blob.geometry.dispose(); mat.dispose(); res(); return; }
        const up = back ? (t < 1.0 ? t / 1.0 : t < 2.2 ? 1 : 1 - (t - 2.2) / 1.0) : Math.min(1, t / 1.0), e = up * up * (3 - 2 * up);
        const wob = 0.06 * Math.sin(t * 9);
        blob.position.set(w.x, w.y - 0.12 + 0.3 * e, w.z);
        blob.scale.set((0.8 + 0.4 * e) * (1 + wob), (0.5 + 0.6 * e) * (1 - wob), (0.8 + 0.4 * e) * (1 + wob));
        requestAnimationFrame(tick);
      };
      tick();
      this.fx.splashStuds(w, 8, 0.9, { tint: 0x6b4423 });
      if (back) setTimeout(() => this.fx.splashStuds(w, 6, 0.6, { tint: 0x6b4423 }), 2900);
    });
  }
  // a ring dropped down a sink's drain (url: its model): dropped in over the bowl, spinning round the drain,
  // and gone down it
  sinkSwallow(x, z, url) {
    const d = this.sinkDrain(x, z);
    return this.model(url).then((m) => new Promise((res) => {
      const r = m.clone(), box = new THREE.Box3().setFromObject(r), c = box.getCenter(new THREE.Vector3()), g = new THREE.Group();
      r.position.copy(c).negate(); g.add(r); g.scale.setScalar(MODEL_SCALE);
      this.world.add(g);
      const t0 = performance.now();
      const tick = () => {
        const u = (performance.now() - t0) / 1000;
        if (u > 1.6) { this.world.remove(g); res(); return; }
        const fall = Math.min(1, u / 0.35), spin = Math.max(0, (u - 0.35) / 1.25), rr = 0.1 * (1 - spin);
        g.position.set(d.x + Math.cos(spin * 14) * rr, d.y + 0.35 * (1 - fall * fall) - 0.06 * spin, d.z + Math.sin(spin * 14) * rr);
        g.rotation.set(spin * 2, u * 9, 0);
        g.scale.setScalar(MODEL_SCALE * (1 - 0.8 * spin));
        if (u > 0.35 && !g.userData.splashed) { g.userData.splashed = true; this.fx.splashStuds(d, 4, 0.6); }
        requestAnimationFrame(tick);
      };
      tick();
    }));
  }
  // a prayer heard (#pray): a column of golden light coming down out of the heavens onto (x, z) (where you kneel),
  // a halo of it spreading over the floor about you, motes of gold rising all round; T s, fading in and out
  // (color, size, mote: another god's paler light, the red of one that turns you away; flicker: guttering out)
  prayLight(x, z, T = 6, { color = 0xffe9a0, size = 1, motes = [0xffe27a, 0xfff6d0], flicker = false } = {}) {
    const p = new THREE.Vector3(x, STUD_H, z), H = 9, g = new THREE.Group();
    const beam = (r, op) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r * size, r * size * 1.15, H, 28, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      m.position.set(x, STUD_H + H / 2, z); m.userData.op = op; g.add(m); return m;
    };
    const beams = flicker ? [beam(0.14, 0.5)] : [beam(0.32, 0.45), beam(0.55, 0.22), beam(0.85, 0.1)];
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.2 * size, 0.32 * size, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    halo.rotation.x = -Math.PI / 2; halo.position.set(x, STUD_H + 0.01, z); g.add(halo);
    this.world.add(g);
    const t0 = performance.now();
    let mote = 0;
    return new Promise((res) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        if (t > T) { this.world.remove(g); g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); res(); return; }
        const k = Math.min(1, t / 1.2, (T - t) / 1.4) * (flicker ? (Math.random() < 0.35 ? 0.15 : 1) * Math.max(0, 1 - t / T) : 1), pulse = 0.85 + 0.15 * Math.sin(t * 5); // (comes down, shines, goes; or stutters, and dies)
        beams.forEach((m, i) => {
          m.material.opacity = m.userData.op * k * pulse;
          const down = Math.min(1, t / 1.0); // (lowered out of the heavens)
          m.scale.y = 0.05 + 0.95 * down; m.position.y = STUD_H + H - (H / 2) * m.scale.y;
          m.rotation.y = t * (0.4 + i * 0.25);
        });
        const hs = 1 + 5 * Math.min(1, t / 2.5);
        halo.scale.set(hs, hs, hs); halo.material.opacity = (flicker ? 0 : 0.5) * k * (1 - Math.min(1, t / 2.5) * 0.6);
        if (!flicker && t > 0.8 && t - mote > 0.12 && t < T - 1) { mote = t; this.fx.sparkles(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, Math.random() * 0.6, (Math.random() - 0.5) * 0.9)), 6, Math.random() < 0.5 ? motes[0] : motes[1], 0.12); }
        if (flicker && t - mote > 0.18) { mote = t; this.fx.ash(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.7, 1.6, (Math.random() - 0.5) * 0.7))); } // (ash drifting down)
        requestAnimationFrame(tick);
      };
      tick();
    });
  }
  // an altar about to turn (converted; claimed for Jesus): the next time the square's altar changes, the old one
  // burns down and sinks away while the new one rises in its place (setItems: altarOut, altarIn). after: s from now
  // the old one starts to go (the light's had its moment)
  convertAltar(x, z, after = 0.6) {
    this.converting = this.converting || new Map();
    const k = `${x},${z}`, cv = { t0: performance.now() + after * 1000 };
    this.converting.set(k, cv);
    setTimeout(() => { if (this.converting.get(k) === cv) this.converting.delete(k); }, after * 1000 + 8000);
  }
  altarOut(g, cv) {
    const step = () => {
      const t = (performance.now() - cv.t0) / 1000;
      if (t < 0) { requestAnimationFrame(step); return; }
      const u = Math.min(1, t / 1.4);
      fadeObject(g, 1 - u);
      const lay = g.userData.lay; // (sinking into the floor as it goes)
      if (lay) { if (g.userData.layY0 == null) g.userData.layY0 = lay.position.y; lay.position.y = g.userData.layY0 - (0.5 * u * u) / MODEL_SCALE; }
      if (Math.random() < 0.4) this.fx.sparkles(new THREE.Vector3(g.position.x + (Math.random() - 0.5) * 0.6, STUD_H + 0.3 + Math.random() * 0.5, g.position.z + (Math.random() - 0.5) * 0.6), 4, 0xff7a1a, 0.08); // (embers)
      if (u < 1) requestAnimationFrame(step); else this.world.remove(g);
    };
    step();
  }
  altarIn(g, cv) {
    const lay = g.userData.lay, y0 = lay.position.y, sq = g.userData.square;
    const others = (on) => { for (const o of this.items.values()) if (o !== g && o.userData.square === sq) o.visible = on; }; // (what lies on it: once it's up)
    const step = () => {
      const t = (performance.now() - cv.t0) / 1000 - 0.7;
      if (t < 0) { g.visible = false; others(false); requestAnimationFrame(step); return; }
      const u = Math.min(1, t / 1.8), e = 1 - (1 - u) ** 3;
      g.visible = true;
      fadeObject(g, Math.min(1, u * 1.6));
      lay.position.y = y0 - (1 - e) * 1.2 / MODEL_SCALE;
      if (Math.random() < 0.5) this.fx.sparkles(new THREE.Vector3(g.position.x + (Math.random() - 0.5) * 0.9, STUD_H + Math.random() * 0.4, g.position.z + (Math.random() - 0.5) * 0.9), 5, 0xfff3c0, 0.1);
      if (u < 1) requestAnimationFrame(step); else { lay.position.y = y0; fadeObject(g, 1); g.userData.rising = null; others(true); this.restack(sq); }
    };
    step();
  }

  // gold tossed from (from) to (to), n coins (url: a coin's model), one after another in a little arc, each gone
  // as it reaches him (a contribution to a temple priest); resolves when the last has arrived
  tossCoins(from, to, n, url) {
    return new Promise((res) => this.model(url).then((m) => {
      const coins = [], t0 = performance.now();
      for (let i = 0; i < n; i++) {
        const c = m.clone(); c.scale.setScalar(MODEL_SCALE); c.visible = false; this.world.add(c);
        coins.push({ c, t: 0.15 * i, sp: (Math.random() - 0.5) * 0.1 });
      }
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        let live = 0;
        for (const k of coins) {
          const u = (t - k.t) / 0.5;
          if (u < 0) { live++; continue; }
          if (u >= 1) { if (k.c.parent) { this.world.remove(k.c); this.fx.sparkles(new THREE.Vector3(to.x, to.y, to.z), 3, 0xffd34d, 0.05); } continue; }
          live++;
          k.c.visible = true;
          k.c.position.set(from.x + (to.x - from.x) * u + k.sp, from.y + (to.y - from.y) * u + 0.35 * Math.sin(Math.PI * u), from.z + (to.z - from.z) * u);
          k.c.rotation.set(u * 9, u * 4, 0);
        }
        if (live) requestAnimationFrame(tick); else res();
      };
      tick();
    }));
  }
  // a contribution to a temple priest (the engine's "priest": winweb.c web_priestfx), what comes of it: at him (p),
  // or on you (you): 0 his curse (a red flash at him); 1 nothing much; 2 pious (a soft glow on you); blessing (its
  // clairvoyance: a bright eye of light over you); 3 devotion rewarded, his protection (a ring of gold shields
  // round you, a column of light); 4 selfless generosity (warm light down on you)
  priestFx(act, n, p, you) {
    const fx = this.fx, P = new THREE.Vector3(p.x, STUD_H + 1.0, p.z), Y = new THREE.Vector3(you.x, STUD_H + 0.7, you.z);
    if (act === 'blessing') { this.flash(Y.clone().setY(Y.y + 0.8), 0xa8e0ff, { size: 0.8, T: 1.2 }); fx.sparkles(Y.clone().setY(Y.y + 0.8), 30, 0xd8f0ff, 0.2); return; }
    switch (n) {
      case 0: this.flash(P, 0xff2a10, { size: 1.1, T: 0.8 }); fx.sparkles(P, 24, 0xff4020, 0.3); break;
      case 2: fx.sparkles(Y, 26, 0xfff6d0, 0.35); break;
      case 3: {
        this.prayLight(you.x, you.z, 3.5, { size: 0.7 });
        for (let i = 0; i < 12; i++) setTimeout(() => { // (a ring of shields of light about you, turning, closing in)
          const a = (i / 12) * Math.PI * 2 + i * 0.3, r = 0.55 - i * 0.025;
          fx.sparkles(new THREE.Vector3(you.x + Math.cos(a) * r, STUD_H + 0.5 + (i % 3) * 0.2, you.z + Math.sin(a) * r), 12, i % 2 ? 0xffe27a : 0x9fd0ff, 0.06);
        }, 300 + i * 120);
        break;
      }
      case 4: this.prayLight(you.x, you.z, 3, { size: 0.55 }); fx.sparkles(Y, 30, 0xffe9a0, 0.4); break;
    }
  }

  // a flash of light (or dark: dark, a black flash) swelling out of a point and gone: an altar's flash as
  // something blessed or cursed hits it, a sacrifice going up in light, an altar converted
  flash(p, color, { size = 1, T = 0.7, dark = false } = {}) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false,
      blending: dark ? THREE.NormalBlending : THREE.AdditiveBlending }));
    m.position.copy(p);
    this.world.add(m);
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t > T) { this.world.remove(m); m.geometry.dispose(); m.material.dispose(); return; }
      const u = t / T, s = size * (0.2 + 1.3 * Math.sqrt(u));
      m.scale.set(s, s, s);
      m.material.opacity = (dark ? 0.85 : 0.9) * Math.min(1, u * 6) * (1 - u) ** 1.5;
      requestAnimationFrame(tick);
    };
    tick();
  }

  // ---- what happens at an altar (the engine's "altar": winweb.c web_altarfx), on (x, z): its kind (ALTAR_HUE:
  // lawful, neutral, chaotic, unaligned: Moloch's) gives its fire its colours. act:
  //   blessed, cursed: an amber flash, a black flash, as it lands on it
  //   consume: a sacrifice gone up (n 1: in a flash of light, a lawful hero's; else in a burst of flame, the altar's)
  //   clover: a four-leaf clover glimpsed at your feet (fx at hx, hz); gift: something at your feet, out of a column
  //   of light; hopeful: a soft glow on you
  //   convert: the altar glowing as it turns (n: its new alignment, 1 white, 0 grey, -1 black); decrease: the power of
  //   your god waning, dark motes settling on you; reject: refused, a god's red anger; blood: the altar stained with
  //   it; cloud: a dark cloud forming over it (a demon summoned); wrath: kicked (n 1: your own god's thunder; else a
  //   whisper, a dark wisp)
  // (at: where on it things are laid, its offering place ({x, y, z}, the world): a grand one's table; else its top's middle)
  altarFx(x, z, act, kind = 'lawful', n = 0, hx = x, hz = z, at = null) {
    const top = at ? new THREE.Vector3(at.x, at.y + 0.05, at.z) : new THREE.Vector3(x + 0.5, STUD_H + ALTAR_TOP + 0.05, z + 0.5), you = new THREE.Vector3(hx + 0.5, STUD_H + 0.6, hz + 0.5);
    const [hi, lo] = ALTAR_HUE[kind] || ALTAR_HUE.lawful, fx = this.fx, later = (s, f) => setTimeout(f, s * 1000);
    switch (act) {
      case 'blessed': this.flash(top, 0xffb31a, { size: 1.1 }); fx.sparkles(top, 40, 0xffc84a, 0.3); break;
      case 'cursed': this.flash(top, 0x050505, { size: 1.1, dark: true }); fx.haze(top.clone().setY(top.y - 0.2), 0.6, 10, 0x0a0a0a); fx.sparkles(top, 16, 0x1a1a1a, 0.25); break;
      case 'consume': { // (a bolt of fire from the sky onto it, in its own colours; then it goes up)
        const [core, glowc] = ALTAR_BOLT[kind] || ALTAR_BOLT.lawful;
        this.lightning(top.x, top.z, 4, { core, glow: glowc, to: top.y - STUD_H, ground: false, sparks: [core, glowc] });
        later(0.12, () => this.altarFx(x, z, 'burn', kind, n, hx, hz, at));
        break;
      }
      case 'burn':
        if (n === 1) { this.flash(top, 0xfff6d8, { size: 1.6, T: 0.9 }); fx.sparkles(top, 60, 0xfff3c0, 0.35); later(0.15, () => fx.sparkles(top.clone().setY(top.y + 0.4), 40, 0xffe27a, 0.3)); break; }
        this.flash(top, hi, { size: 1.2, T: 0.8 });
        for (let i = 0; i < 8; i++) later(i * 0.11, () => { // (flames licking up off it, then smoke)
          fx.sparkles(top.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, i * 0.04, (Math.random() - 0.5) * 0.3)), 22, i % 2 ? hi : 0xffa020, 0.22);
          if (i % 2) fx.vapor(top.clone().setY(top.y + 0.2), lo, 0.8);
        });
        break;
      case 'clover': fx.sparkles(new THREE.Vector3(hx + 0.5, STUD_H + 0.05, hz + 0.5), 30, 0x3fbf3f, 0.2); later(0.3, () => fx.sparkles(new THREE.Vector3(hx + 0.5, STUD_H + 0.1, hz + 0.5), 14, 0x8dff7a, 0.12)); break;
      case 'gift': this.prayLight(hx + 0.5, hz + 0.5, 3, { size: 0.6 }); later(0.8, () => this.flash(new THREE.Vector3(hx + 0.5, STUD_H + 0.1, hz + 0.5), 0xffe9a0, { size: 0.7 })); break;
      case 'hopeful': fx.sparkles(you, 26, 0xfff6d0, 0.35); if (n) this.prayLight(hx + 0.5, hz + 0.5, 2.5, { size: 0.5 }); break; // (n: reconciled: a soft light down on you too)
      case 'inadequacy': fx.vapor(top, 0x8a8a8a, 0.6); break; // (a wisp, and nothing)
      case 'convert': {
        const c = n > 0 ? 0xffffff : n < 0 ? 0x101010 : 0x9a9a9a;
        this.flash(top.clone().setY(top.y - 0.3), c, { size: 2.6, T: 1.6, dark: n < 0 });
        for (let i = 0; i < 6; i++) later(i * 0.2, () => fx.sparkles(top.clone().setY(top.y + 0.3), 20, n < 0 ? 0x2a2a2a : n > 0 ? 0xffffff : 0xb8b8b8, 0.6));
        break;
      }
      case 'decrease': for (let i = 0; i < 6; i++) later(i * 0.15, () => fx.ash(you.clone().setY(you.y + 1.0))); break;
      case 'reject': this.flash(top, 0xff2a10, { size: 1.6, T: 0.9 }); fx.sparkles(top, 40, 0xff4020, 0.4); break;
      case 'blood': // (n: and a dark cloud forming over it)
        if (n) later(0.8, () => this.stormCloud(top.x, top.z, 5));
        fx.haze(top.clone().setY(top.y - 0.6), 0.7, 14, 0x6a0000);
        for (let i = 0; i < 6; i++) later(i * 0.12, () => fx.sparkles(top.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.3)), 8, 0x8a0000, 0.06));
        break;
      case 'cloud': this.stormCloud(top.x, top.z, 5); break;
      case 'water': // (the potions on it, blessed by a prayer: glowing light blue a moment; or cursed: black)
        if (n > 0) { this.flash(top.clone().setY(top.y + 0.1), 0x8fd4ff, { size: 1.2, T: 1.2 }); for (let i = 0; i < 5; i++) later(i * 0.2, () => fx.sparkles(top.clone().setY(top.y + 0.1), 14, i % 2 ? 0xbfe8ff : 0x6ab8ff, 0.2)); }
        else { this.flash(top.clone().setY(top.y + 0.1), 0x050508, { size: 1.2, T: 1.2, dark: true }); for (let i = 0; i < 5; i++) later(i * 0.2, () => fx.haze(top.clone().setY(top.y - 0.1), 0.5, 6, 0x0a0a12)); }
        break;
      case 'ascend': // (the Amulet offered: your own god's, an invisible choir, a column of radiance down onto you; another's: orange smoke)
        if (n) {
          this.prayLight(hx + 0.5, hz + 0.5, 11, { size: 2.4, color: 0xfff6dc, motes: [0xffffff, 0xffe9a0] });
          for (let i = 0; i < 40; i++) later(0.5 + i * 0.22, () => fx.sparkles(new THREE.Vector3(hx + 0.5 + (Math.random() - 0.5) * 1.6, STUD_H + Math.random() * 2.5, hz + 0.5 + (Math.random() - 0.5) * 1.6), 10, i % 3 ? 0xfff6d0 : 0xffffff, 0.2));
        } else for (let i = 0; i < 22; i++) later(0.3 + i * 0.16, () => fx.vapor(you.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.8 - 0.3, (Math.random() - 0.5) * 0.6)), 0xff8a2a, 1.5));
        break;
      case 'claim': // (a chalice set down on it by his follower: a brilliant white, the old god's altar burning away, his rising)
        this.flash(top.clone().setY(top.y - 0.2), 0xffffff, { size: 3.2, T: 2.0 });
        this.prayLight(top.x, top.z, 4.5, { size: 1.2 });
        for (let i = 0; i < 10; i++) later(i * 0.2, () => fx.sparkles(top.clone().setY(top.y + 0.2 + i * 0.05), 24, i % 2 ? 0xffffff : 0xfff3c0, 0.7));
        break;
      case 'wrath':
        if (n === 1) { this.flash(top.clone().setY(top.y + 0.4), 0xfff6d8, { size: 2, T: 0.6 }); fx.sparkles(you, 30, 0xffffff, 0.4); }
        else for (let i = 0; i < 10; i++) later(i * 0.1, () => fx.haze(you.clone().setY(STUD_H), 1.2, 6, 0x15101c));
        break;
    }
  }

  // ---- praying (#pray), as it goes: begun (n, how it'll go: 3 true to your god, 2 at another's altar, 1 naughty,
  // 0 too soon, -1 undead), its light (or none, or a storm gathering) over you at (x, z) a moment in; and what comes
  // of it (act, n), at the end. PRAY_OUTCOME: s in, the outcome; then (PRAY_AFTER) how you take it (prayAfter)
  prayBegin(x, z, n) {
    const st = {};
    setTimeout(() => {
      if (n === 3) this.prayLight(x, z, 6);
      else if (n === 2) this.prayLight(x, z, 5, { color: 0xdfe8ff, size: 0.75, motes: [0xf2f6ff, 0xc8d8ff] });
      else if (n === -1) this.prayLight(x, z, 4, { color: 0xff5040, size: 0.8, motes: [0xff6040, 0x801010] });
      else if (n === 0) this.prayLight(x, z, 3.5, { flicker: true });
    }, 1500);
    if (n === 1) setTimeout(() => (st.cloud = this.stormCloud(x, z, 9.5)), 900);
    return st;
  }
  prayOutcome(x, z, act, n, st = {}) {
    const p = new THREE.Vector3(x, STUD_H + 0.6, z), fx = this.fx;
    switch (act) {
      case 'pleased': for (let i = 0; i < n; i++) setTimeout(() => fx.sparkles(p.clone().setY(p.y + 0.5), 30 + 20 * n, i % 2 ? 0xfff6d0 : 0xffe27a, 0.45), i * 250); break;
      case 'displeased': case 'toosoon': case 'hell': for (let i = 0; i < 8; i++) setTimeout(() => fx.ash(p.clone().setY(p.y + 1.2)), i * 150); break;
      case 'lessons': if (st.cloud) st.cloud.flash(); for (let i = 0; i < 3; i++) setTimeout(() => st.cloud && st.cloud.flash(), 400 + i * 350); break;
      case 'blackglow': for (let i = 0; i < 24; i++) setTimeout(() => fx.haze(p.clone().setY(STUD_H), 1.2, 10, 0x15101c), i * 120); break;
      case 'punish': fx.sparkles(p, 30, 0x302838, 0.5); break;
      case 'minion': if (st.cloud) st.cloud.flash(); fx.sparkles(p, 50, 0xd02020, 0.6); break;
      case 'bolt': if (st.cloud) st.cloud.flash(); this.lightning(x, z); break;
      case 'disintegrate': if (st.cloud) st.cloud.flash(); this.disintegrate(x, z); break;
      case 'undead': fx.sparkles(p, 40, 0xb01818, 0.5); break;
    }
  }
  // a god angered: a dark storm cloud gathering over (x, z), churning, lit within now and then; T s. Its flash():
  // lit up bright at once (a bolt out of it, a voice from it)
  stormCloud(x, z, T = 7) {
    const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0x2c2f38, roughness: 1, emissive: 0x6070a0, emissiveIntensity: 0, transparent: true, opacity: 0 });
    const puffs = [];
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35 + Math.random() * 0.3, 1), mat);
      const a = (i / 9) * Math.PI * 2, r = i ? 0.5 + Math.random() * 0.3 : 0;
      m.userData.home = new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.5) * 0.25, Math.sin(a) * r);
      m.scale.y = 0.55; g.add(m); puffs.push(m);
    }
    g.position.set(x, STUD_H + 3.1, z);
    this.world.add(g);
    const t0 = performance.now();
    let flash = 0;
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t > T) { this.world.remove(g); puffs[0].geometry.dispose(); puffs.forEach((m) => m.geometry.dispose()); mat.dispose(); return; }
      mat.opacity = 0.92 * Math.min(1, t / 1.5, (T - t) / 1.2);
      if (Math.random() < 0.012) flash = Math.max(flash, 0.5); // (lit within, now and then)
      flash *= 0.88;
      mat.emissiveIntensity = flash * 2.5;
      puffs.forEach((m, i) => m.position.copy(m.userData.home).add(new THREE.Vector3(Math.sin(t * 0.7 + i) * 0.08, Math.sin(t * 1.1 + i * 2) * 0.05, Math.cos(t * 0.6 + i) * 0.08)));
      g.rotation.y = t * 0.12;
      requestAnimationFrame(tick);
    };
    tick();
    return { flash: () => { flash = 1; } };
  }
  // a bolt of lightning down out of the heavens onto (x, z): a jagged white-blue streak, struck three times over half
  // a second; sparks, a scorch on the floor, smoke
  // (or a bolt of fire from the sky onto an altar's sacrifice: its colours (core, glow), down to `to` (up from the
  // floor), no scorch on the floor, no smoke of its own)
  lightning(x, z, top = 3.1, { core = 0xe8f0ff, glow = 0x9fb8ff, to = 0.6, ground = true, sparks = [0xdfe8ff, 0xffd060] } = {}) {
    const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: core, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
    const bolt = () => {
      g.clear();
      let at = new THREE.Vector3(x, STUD_H + top, z);
      const n = 9;
      for (let i = 1; i <= n; i++) {
        const end = i === n ? new THREE.Vector3(x, STUD_H + to, z) : new THREE.Vector3(x + (Math.random() - 0.5) * 0.5, STUD_H + top - (top - to) * (i / n), z + (Math.random() - 0.5) * 0.5);
        const d = end.clone().sub(at), len = d.length();
        for (const [w, op] of [[0.035, 1], [0.12, 0.35]]) { // (its core, and its glow)
          const seg = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), op === 1 ? mat : new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending }));
          seg.position.copy(at).add(end).multiplyScalar(0.5);
          seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
          g.add(seg);
        }
        at = end;
      }
    };
    this.world.add(g);
    const t0 = performance.now(), strikes = [0, 0.18, 0.36];
    let k = 0;
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (k < strikes.length && t >= strikes[k]) { bolt(); k++; }
      mat.opacity = Math.max(0, 1 - ((t - strikes[k - 1]) / 0.15)) ;
      g.children.forEach((c) => { if (c.material !== mat) c.material.opacity = 0.35 * mat.opacity; });
      if (t > 0.7) { this.world.remove(g); g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (o.material !== mat) o.material.dispose(); } }); mat.dispose(); return; }
      requestAnimationFrame(tick);
    };
    tick();
    const p = new THREE.Vector3(x, STUD_H + (ground ? 0.2 : to), z);
    this.fx.sparkles(p, 40, sparks[0], 0.4);
    this.fx.sparkles(p, 20, sparks[1], 0.3);
    if (!ground) return;
    for (let i = 0; i < 4; i++) setTimeout(() => this.fx.vapor(p, 0x555555, 1.4), 200 + i * 180);
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(0.35, 24), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6, depthWrite: false }));
    scorch.rotation.x = -Math.PI / 2; scorch.position.set(x, STUD_H + 0.012, z);
    this.world.add(scorch);
    setTimeout(() => { this.world.remove(scorch); scorch.geometry.dispose(); scorch.material.dispose(); }, 6000);
  }
  // a wide-angle disintegration beam down onto (x, z): a broad violet-black column, slammed down and gone
  disintegrate(x, z) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 9, 28, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x8a3ad8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    m.position.set(x, STUD_H + 4.5, z);
    this.world.add(m);
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t > 1.3) { this.world.remove(m); m.geometry.dispose(); m.material.dispose(); return; }
      m.material.opacity = 0.7 * Math.min(1, t / 0.08, (1.3 - t) / 0.6);
      m.rotation.y = t * 3;
      requestAnimationFrame(tick);
    };
    tick();
    this.fx.sparkles(new THREE.Vector3(x, STUD_H + 0.6, z), 50, 0x2a0a40, 0.6);
  }
  // a sink rattling on its foot (clanking pipes; kicked): T s, dying away
  sinkShake(x, z, T = 0.8, amp = 0.025, name = 'sink') { // (name: a toilet's too)
    const g = this.sinkAt(x, z, name);
    if (!g) return;
    const base = g.userData.shakeBase || (g.userData.shakeBase = g.position.clone()), t0 = performance.now();
    const tick = () => {
      const u = (performance.now() - t0) / 1000 / T;
      if (u >= 1 || !g.parent) { g.position.copy(base); return; }
      const k = amp * (1 - u);
      g.position.set(base.x + k * Math.sin(u * 95), base.y + Math.abs(k * 0.5 * Math.sin(u * 60)), base.z + k * Math.cos(u * 83));
      requestAnimationFrame(tick);
    };
    tick();
  }
  // the pipes broken: water spurting up out of it, the sink burst apart (as the game has it: a fountain there now)
  sinkBreak(x, z, name = 'sink') { // (name: a toilet shattering too)
    const g = this.sinkAt(x, z, name), url = g && [...this.items.entries()].find(([, v]) => v === g)[0].split(',').slice(3).join(',');
    const d = name === 'toilet' ? this.toiletWater(x, z) : this.sinkDrain(x, z);
    if (url) this.fx.shatter(url, x, z, true);
    this.fx.splashStuds(d, 26, 2.6, { floor: STUD_H, ring: false });
    for (let i = 0; i < 6; i++) setTimeout(() => this.fx.splashStuds(d.clone().setY(d.y - 0.2), 10, 2.2, { floor: STUD_H, ring: false }), 120 * i);
  }
  // a fire ray across a fountain at (x, z): steam billowing up out of its water, all over its basin
  fountainSteam(x, z) {
    const w = this.fountainWater(x, z);
    for (let i = 0; i < 18; i++) // (great clouds of it, grey-white, rolling up off the water and over the rim)
      setTimeout(() => {
        const a = Math.random() * Math.PI * 2, r = 0.15 + Math.random() * 0.6;
        this.fx.vapor(w.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.05 + Math.random() * 0.2, Math.sin(a) * r)), i % 3 ? 0xe9edf0 : 0xcfd5da, 2.4);
      }, i * 90);
  }
  // a water demon, grateful for its release, granting a wish and gone, at (x, z): a burst of mist, water and gold
  // where it stood
  demonGone(x, z) {
    const p = new THREE.Vector3(x + 0.5, STUD_H + 0.5, z + 0.5);
    for (let i = 0; i < 4; i++) this.fx.vapor(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.3 + i * 0.12, (Math.random() - 0.5) * 0.3)), 0xd8f2ff);
    this.fx.sparkles(p, 40, 0xffc21a, 0.4);
    this.fx.splashStuds(p.clone().setY(STUD_H + 0.3), 16, 2.0, { floor: STUD_H, ring: false });
  }

  // a fountain at (fx, fz) gushing (the game's gush): a burst of its water out of its top, falling all about
  // it (and over you, up on it); and a stream arcing out to each square it floods, nearer ones first (delay:
  // s), the pool there opening as the water lands (setTerrain keeps its floor till then)
  fountainTop(fx, fz) {
    for (const g of [...this.items.values(), ...(this.held ? this.held.values() : [])]) {
      if (g.userData.square !== `${fx},${fz}` || !g.userData.lay) continue;
      let f = false;
      g.userData.lay.traverse((o) => { if (o.userData && o.userData.fx === 'fountain') f = true; });
      if (!f) continue;
      const b = new THREE.Box3().setFromObject(g.userData.lay), c = b.getCenter(new THREE.Vector3());
      return c.setY(b.max.y - 0.1);
    }
    return new THREE.Vector3(fx + 0.5, STUD_H + 1.6, fz + 0.5);
  }
  gushBurst(fx, fz) {
    const top = this.fountainTop(fx, fz), fsq = `${fx},${fz}`;
    (this.gushEnd = this.gushEnd || new Map()).set(fsq, Math.max(this.gushEnd.get(fsq) || 0, performance.now() / 1000 + 1.2)); // (its spray falling, before it dries)
    this.fx.splashStuds(top, 24, 2.4, { floor: STUD_H + 0.5, ring: false });
  }
  gushTo(fx, fz, x, z, delay = 0) {
    const sq = `${x},${z}`;
    (this.gushing = this.gushing || new Set()).add(sq);
    if (this.data) this.setTerrain(this.data);
    const d = Math.hypot(x - fx, z - fz), flight = 0.5 + d * 0.07, fsq = `${fx},${fz}`;
    (this.gushEnd = this.gushEnd || new Map()).set(fsq, Math.max((this.gushEnd.get(fsq) || 0), performance.now() / 1000 + delay + flight + 11 * 0.035 + 0.4));
    setTimeout(() => {
      const at = new THREE.Vector3(x + 0.5, -0.03, z + 0.5);
      this.fx.stream(this.fountainTop(fx, fz), at, 12, flight).then(() => {
        this.gushing.delete(sq);
        if (this.data) this.setTerrain(this.data);
        this.fx.splashStuds(at, 12, 1.8);
      });
    }, delay * 1000);
  }

  restack(square) {
    const pile = [...this.items.values()].filter((g) => g.userData.square === square && !g.userData.posed).sort((a, b) => a.userData.level - b.userData.level);
    let y = STUD_H;
    // (things on a fountain's square lie on its rim, out of the water, not on top of it)
    const fount = pile.length && pile[0].userData.name === 'fountain', [sx, sz] = square.split(',').map(Number);
    const sink = pile.length && pile[0].userData.name === 'sink' && this.sinkDrain(sx, sz); // (things on a sink: in its bowl)
    let gold = false; // (gold on a fountain: strewn in its basin instead, basinCoins)
    for (const g of pile) {
      if (g.userData.name === 'gold piece' && fount) { g.visible = false; g.userData.inBasin = gold = true; continue; }
      if (g.userData.inBasin) { g.visible = true; g.userData.inBasin = false; } // (the fountain gone from under it)
      if (sink && g !== pile[0]) { g.position.set(sink.x, sink.y + 0.01, sink.z); continue; }
      if (/^altar/.test(pile[0].userData.name) && g !== pile[0]) { // (on an altar: laid on its top, offered; or where its model says (its front, clear of its statue): off its middle, turned as it is, lying across it
        const sp = pile[0].userData.spots, o = (sp && sp[g.userData.name]) || pile[0].userData.offer, t = pile[0].rotation.y;
        // (several: side by side along its front, the middle, then left, then right; then on top of those)
        const k = g.userData.level - 1, along = o && !(sp && sp[g.userData.name]) ? ALTAR_ROW[k % 3] : 0, up = Math.floor(k / 3) * 0.05;
        if (o) g.position.set(sx + 0.5 + (o[0] + along) * Math.cos(t) + o[2] * Math.sin(t), STUD_H + o[1] + up, sz + 0.5 - (o[0] + along) * Math.sin(t) + o[2] * Math.cos(t));
        else g.position.y = STUD_H + ALTAR_TOP + (g.userData.level - 1) * 0.04;
        g.rotation.y = t + (g.userData.level % 2 ? 0 : 0.12); // (across it, along its front edge, not slanting back into what stands on it)
        continue;
      }
      g.position.y = y;
      if (fount && g !== pile[0]) { const [ox, oz] = this.rimSpot(square); g.position.x = sx + 0.5 + ox; g.position.z = sz + 0.5 + oz; }
      y = fount && g === pile[0] ? STUD_H + FOUNT_RIM_SPOT[1] : y + g.userData.thick * 0.85; // (they settle into each other a little)
    }
    this.basinCoins(square, gold);
  }
  // gold on a fountain's square (coins seen glistening far below, or dropped in): not a pile on its rim but
  // coins strewn about the floor of its basin, under its water, each lying its own way (this.coinUrl: one
  // coin's model, set by whoever draws the dungeon); gone with the gold
  basinCoins(sq, on) {
    const have = (this.coinsIn = this.coinsIn || new Map()).get(sq);
    if (!on) { if (have) { this.world.remove(have); this.coinsIn.delete(sq); } return; }
    if (have || !this.coinUrl) return;
    const g = new THREE.Group(), [x, z] = sq.split(',').map(Number);
    this.coinsIn.set(sq, g);
    this.world.add(g);
    this.model(this.coinUrl).then((m) => {
      if (this.coinsIn.get(sq) !== g) return;
      const box = new THREE.Box3().setFromObject(m), c = box.getCenter(new THREE.Vector3());
      for (let i = 0; i < BASIN_COINS; i++) {
        const h = (k) => { const v = Math.sin(x * 12.9898 + z * 78.233 + i * 37.719 + k * 11.13) * 43758.5453; return v - Math.floor(v); };
        const a = h(1) * Math.PI * 2, rr = BASIN_R[0] + h(2) * (BASIN_R[1] - BASIN_R[0]);
        const coin = new THREE.Group(), lay = m.clone();
        lay.position.copy(c).negate();
        coin.add(lay);
        coin.scale.setScalar(MODEL_SCALE);
        coin.position.set(x + 0.5 + Math.cos(a) * rr, STUD_H + BASIN_FLOOR + h(3) * 0.012, z + 0.5 + Math.sin(a) * rr);
        coin.rotation.set((h(4) - 0.5) * 0.5, h(5) * Math.PI * 2, (h(6) - 0.5) * 0.5); // (each tipped a little: lying on one another, on the stones)
        g.add(coin);
      }
    });
  }
  // coins seen glistening far below in a fountain at (x, z): glints off them, here and there over its basin
  fountainCoinsGlint(x, z) {
    for (let i = 0; i < 5; i++)
      setTimeout(() => {
        const a = Math.random() * Math.PI * 2, rr = BASIN_R[0] + Math.random() * (BASIN_R[1] - BASIN_R[0]);
        this.fx.sparkles(new THREE.Vector3(x + 0.5 + Math.cos(a) * rr, STUD_H + BASIN_FLOOR + 0.05, z + 0.5 + Math.sin(a) * rr), 10, i % 2 ? 0xffe27a : 0xffc21a, 0.08);
      }, i * 260);
  }

  // the figures to draw this frame: [{url, matrix, pose}] (the hero); pose:
  // a matrix per joint (minifig-anim.js), for a figure in joints
  setFigures(list) {
    const key = list.map((f) => f.url).join('|');
    if (key !== this.figKey) {
      this.figKey = key;
      this.figures.clear();
      this.figObjs = list.map((f) => {
        const g = new THREE.Group();
        g.matrixAutoUpdate = false;
        this.figures.add(g);
        this.model(f.url).then((m) => { const c = m.clone(); g.add(c); g.userData.joints = figureJoints(c); });
        return g;
      });
    }
    list.forEach((f, i) => {
      const g = this.figObjs[i];
      g.matrix.fromArray(f.matrix);
      g.matrixWorldNeedsUpdate = true;
      poseJoints(g.userData.joints, f.pose);
      if (g.userData.joints) this.holdItems(g, f.hold || {});
      if (f.fade !== undefined) fadeObject(g, f.fade); // (coming into being, or going: see-through, 0..1)
    });
  }

  // a part of a floor item, by its joint (items.json "joint"), faded: k 1 as built, 0 gone (an altar's statues
  // come alive: the Mass)
  fadeJoint(x, z, joint, k) {
    for (const g of this.items.values()) {
      if (g.userData.square !== `${x},${z}` || g.userData.level) continue;
      const node = g.getObjectByName(joint);
      if (node) fadeObject(node, k);
    }
  }

  // things set down loose, anywhere, as they'd lie (an altar's wafer on its tile, its chalice on its stud), or on
  // their way somewhere (a wafer floating to you, coins tossed into a plate): [{url, x, y, z (world: where its
  // underside's middle is), yaw, tilt, upright}]; each kept from frame to frame while its url is the same, only moved
  setProps(list) {
    if (!this.props) { this.props = new THREE.Group(); this.world.add(this.props); this.propObjs = []; }
    while (this.propObjs.length > list.length) this.props.remove(this.propObjs.pop().g);
    list.forEach((p, i) => {
      let o = this.propObjs[i];
      if (o && o.url !== p.url) { this.props.remove(o.g); o = null; }
      if (!o) {
        const g = new THREE.Group();
        g.scale.setScalar(MODEL_SCALE);
        this.props.add(g);
        o = this.propObjs[i] = { url: p.url, g };
        this.model(p.url).then((m) => { // (as a floor item lies: centred where it's set, its underside on the surface)
          if (this.propObjs[i] !== o) return;
          const c = m.clone();
          if (!p.upright) c.rotation.z = -Math.PI / 2;
          c.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(c), mid = box.getCenter(new THREE.Vector3());
          c.position.set(-mid.x, -box.min.y, -mid.z);
          g.add(c);
        });
      }
      o.g.position.set(p.x, p.y, p.z);
      o.g.rotation.set(p.tilt || 0, p.yaw || 0, 0);
    });
  }

  // What the figure has in its hands (hold: {R, L}, each a brick item's url;
  // null: nothing, the hand empty; undefined: as the figure was built). A
  // held item hangs on its hand's joint at the hand's grip (the rig's grip,
  // tools/minifig.py grip_frame), the figure's own item in that hand hidden.
  holdItems(g, hold) {
    const j = g.userData.joints;
    const held = (g.userData.held = g.userData.held || {});
    for (const side of ['R', 'L']) {
      const want = hold[side], baked = j.joints['item' + side], arm = j.joints['hand' + side] || j.joints['arm' + side];
      if (baked) baked.visible = want === undefined;
      const cur = held[side];
      if (cur && cur.url === want) continue;
      if (cur) { cur.obj.parent && cur.obj.parent.remove(cur.obj); delete held[side]; }
      const grip = j.rig['arm' + side] && j.rig['arm' + side].grip;
      if (!want || !arm || !grip) continue;
      const obj = new THREE.Group();
      obj.matrixAutoUpdate = false;
      obj.matrix.fromArray(grip);
      arm.add(obj);
      held[side] = { url: want, obj };
      this.model(want).then((m) => { if (held[side] && held[side].obj === obj) obj.add(m.clone()); });
    }
    // something lugged in both arms, held before you at the belly (hold.hug: its url: the heavy iron ball)
    {
      const want = hold.hug, body = j.joints.body, cur = held.hug;
      if (!(cur && cur.url === want)) {
        if (cur) { cur.obj.parent && cur.obj.parent.remove(cur.obj); delete held.hug; }
        if (want && body) {
          const obj = new THREE.Group();
          obj.position.copy(HUG);
          body.add(obj);
          held.hug = { url: want, obj };
          this.model(want).then((m) => {
            if (!(held.hug && held.hug.obj === obj)) return;
            const c = m.clone();
            c.updateMatrixWorld(true);
            c.position.sub(new THREE.Box3().setFromObject(c).getCenter(new THREE.Vector3())); // (held by its middle)
            obj.add(c);
          });
        }
      }
    }
    // an amulet worn (hold.amulet: its worn model's url, build_items.worn_ldr): its origin on the
    // middle of the chest's front, 12 LDU below the neck (the rig's: a dwarf's is lower), on the body
    {
      const want = hold.amulet, body = j.joints.body, cur = held.amulet, neck = j.rig.head && j.rig.head.pivot;
      if (!(cur && cur.url === want)) {
        if (cur) { cur.obj.parent && cur.obj.parent.remove(cur.obj); delete held.amulet; }
        if (want && body && neck) {
          const obj = new THREE.Group();
          obj.position.set(0, neck[1] - 12 / 20, 10 / 20);
          body.add(obj);
          held.amulet = { url: want, obj };
          this.model(want).then((m) => { if (held.amulet && held.amulet.obj === obj) obj.add(m.clone()); });
        }
      }
    }
    // rings worn as bracelets, round the wrists (hold.ringR, ringL: a ring's url)
    for (const side of ['R', 'L']) {
      const want = hold['ring' + side], key = 'ring' + side, hand = j.joints['hand' + side], cur = held[key];
      if (cur && cur.url === want) continue;
      if (cur) { cur.obj.parent && cur.obj.parent.remove(cur.obj); delete held[key]; }
      const w = want && hand && wristMatrix(j.rig, side);
      if (!w) continue;
      const obj = new THREE.Group();
      obj.matrixAutoUpdate = false;
      obj.matrix.fromArray(w);
      hand.add(obj);
      held[key] = { url: want, obj };
      this.model(want).then((m) => { if (held[key] && held[key].obj === obj) obj.add(m.clone()); });
    }
  }

  // draw, with the game's camera (column-major projection and view matrices), the
  // sun's shadows following `focus` (the hero)
  // stairs lit by firelight: a warm light flickering on each flight, from below a flight down (torches burning at
  // its foot, out of sight), from above one up (at its head)
  setStairLights(stairs) {
    const key = stairs.map((st) => `${st.x},${st.z},${st.up}`).join(';');
    if (key === this.stairKey) return;
    this.stairKey = key;
    for (const l of this.stairLights || []) { this.world.remove(l); l.dispose(); }
    this.stairLights = stairs.map((st, i) => {
      const l = new THREE.PointLight(0xff9a3c, 0, 3.2, 1.6);
      l.position.set(st.x + 0.5, st.up ? 1.9 : -1.15, st.z + 0.5);
      l.userData = { base: st.up ? 2.6 : 3.4, ph: i * 1.7 };
      this.world.add(l);
      return l;
    });
  }
  flickerStairs(t) {
    for (const l of this.stairLights || []) { // (a fire's flicker: a slow sway, and a quick jitter on it)
      const { base, ph } = l.userData;
      l.intensity = base * (0.78 + 0.14 * Math.sin(t * 2.3 + ph) + 0.08 * Math.sin(t * 9.7 + ph * 3) + 0.06 * (Math.random() - 0.5));
    }
  }
  render(proj, view, w, h, focus) {
    const r = this.r;
    const tLid = performance.now();
    this.flickerStairs(tLid / 1000);
    this.tickLids(Math.min(0.1, (tLid - (this.lastT || tLid)) / 1000));
    this.stepChain(Math.min(0.1, (tLid - (this.lastT || tLid)) / 1000)); // (the punished: ball and chain)
    this.lastT = tLid;
    r.resetState();
    r.setSize(w, h, false);
    this.cam.projectionMatrix.fromArray(proj);
    this.cam.projectionMatrixInverse.copy(this.cam.projectionMatrix).invert();
    // (three sets the world matrix from this one, and its inverse from that)
    this.cam.matrix.fromArray(view).invert();
    this.cam.matrixWorldNeedsUpdate = true;
    if (focus) {
      this.sun.target.position.set(focus[0], 0, focus[2]);
      this.sun.position.set(focus[0] + 12, 28, focus[2] + 18);
      this.sun.target.updateMatrixWorld();
    }
    this.fx.step(); // thrown things in flight
    this.stepFountainGlow(performance.now() / 1000); // fountains' water, glowing
    this.stepDry(performance.now() / 1000); // ...or drying up
    if (this.boulders) this.boulders.step(); // boulders rolling, rocks flying
    const now = performance.now() / 1000;
    if (this.hazeMat) this.hazeMat.uniforms.uTime.value = now;
    if (this.flowMat) this.flowMat.uniforms.uTime.value = now;
    r.render(this.scene, this.cam);
    r.resetState();
  }
}

// ---- the haze
const HAZE_TOP = 2.6; // (a little over the walls)
const HAZE_COLOR = 'vec3(0.80, 0.84, 0.89)';
// faint, slow noise: the haze is alive, not painted on
const NOISE = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}`;
// the top churns: each point of it rises and falls on slow rolling noise
const BILLOW = `
float billow(vec2 p, float t) {
  return 0.22 * noise(p * 0.9 + vec2(t * 0.11, -t * 0.07)) + 0.14 * noise(p * 2.1 - vec2(t * 0.19, t * 0.13)) + 0.06 * noise(p * 4.3 + t * 0.3);
}`;
const HAZE_VS = `
attribute float aEdge;
uniform float uTime;
varying vec3 vW; varying float vEdge;
${NOISE}
${BILLOW}
void main() {
  vec3 p = position;
  // the top billows, and sags down toward the haze's edge (no hard ridge)
  if (p.y > ${HAZE_TOP} - 0.01) p.y += (billow(p.xz, uTime) - 0.12) * (0.4 + 0.6 * aEdge) - (1.0 - aEdge) * 0.45;
  vW = p; vEdge = aEdge;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  // (never cut off by how far the view reaches (Ascend's is short): held just inside it, it fills on to its end)
  if (gl_Position.w > 0.0) gl_Position.z = min(gl_Position.z, gl_Position.w * 0.99999);
}`;
const HAZE_FS = `
uniform float uTime;
varying vec3 vW; varying float vEdge;
${NOISE}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
void main() {
  // a fluid: wisps that curl and flow through it (noise warped by noise,
  // drifting), light streaks over a slightly deeper haze; thick through
  // (the sides use height as their second direction, so the swirls run on
  // round the corners and up over the top)
  float t = uTime;
  vec2 p = vW.xz * 0.45 + vec2(vW.y * 0.5, -vW.y * 0.35);
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.06)), fbm(p + vec2(5.2, 1.3) - t * 0.05));
  vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + t * 0.09), fbm(p + 3.0 * q + vec2(8.3, 2.8) - t * 0.07));
  float f = fbm(p + 3.5 * r);
  float wisp = smoothstep(0.35, 0.85, f);
  vec3 deep = vec3(0.86, 0.88, 0.92), light = vec3(0.98, 0.99, 1.0);
  vec3 col = mix(deep, light, wisp * 0.85 + 0.1 * length(q));
  // solid: nothing shows through it, ever (its life is in its colour and its billowing top)
  gl_FragColor = vec4(col, 1.0);
}`;
// a stream of fog: a sheet along the fog's path (aS: how far along it, aV:
// the same 0..1, aU: across, in world units) with streaks flowing down it,
// fading in out of the haze and dissolving toward its end
const FLOW_VS = `
attribute float aU; attribute float aS; attribute float aV;
uniform float uTime;
varying float vU; varying float vS; varying float vV; varying vec3 vW;
void main() {
  vU = aU; vS = aS; vV = aV; vW = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;
const FLOW_FS = `
uniform float uTime;
varying float vU; varying float vS; varying float vV; varying vec3 vW;
${NOISE}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.1 + vec2(3.1, 7.7); a *= 0.5; }
  return v;
}
void main() {
  // streaks: long along the flow, narrow across it, sliding along, wobbling side to side
  float t = uTime;
  vec2 q = vec2(vU * 2.2 + 0.4 * sin(vS * 2.0 - t * 0.9 + vU), vS * 1.1 - t * 0.42);
  float n = fbm(q + fbm(q * 0.7 + t * 0.05) * 1.2);
  float streak = smoothstep(0.32, 0.72, n);
  float fade = smoothstep(0.0, 0.16, vV) * (1.0 - smoothstep(0.55, 1.0, vV));
  float a = streak * fade * 0.75;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(vec3(0.82, 0.86, 0.91), vec3(0.97, 0.98, 1.0), streak), a);
}`;

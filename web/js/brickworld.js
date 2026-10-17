// The brick world, drawn by three.js exactly as the scene viewer (baseplate.html)
// draws it: the real LDraw parts as converted (tools/build_roster.py), the same
// lights and shadows, the same plain sky-blue background (no skybox, no fog).
// It shares the game's WebGL2 context and canvas, so the game's own pass
// (monster and item sprites, outlines...) draws over it with the same depth.
//
// Units are the game's: a map square is 1 (4x4 studs), a stud 0.25.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { isMist, mistify, quantumPart, strobify, addAura, addLightning, addEffects } from './mist.js';
import { figureJoints, poseJoints, wristMatrix } from './minifig-anim.js';
import { PARTS, MODEL_SCALE, BRICK_H, PLATE_H, STUD_H } from './brick.js';
import { ThrowFX } from './throwfx.js';
import { gradientEnvironment } from './envmap.js';

export const SKY = 0x8fb8de; // the viewer's background

const PIECES = {
  plate: 'assets/brick/parts/plate4x4.glb', // a floor square: a green 4x4 plate, origin at its top middle
  brick: 'assets/brick/parts/brick2x4.glb', // a wall's top course: grey 2x4 bricks, origin at the top middle
};
const WALL_GREY = 0xa0a5a9, GROUND_GREEN = 0x00852b;
// how many courses higher the Castle's walls rise: [none, its outer walls, its corner towers]
const RISE_COURSES = [0, 9, 16];

export class BrickWorld {
  constructor(canvas, gl) {
    const r = (this.r = new THREE.WebGLRenderer({ canvas, context: gl }));
    r.autoClear = true;
    r.shadowMap.enabled = true;
    r.setPixelRatio(1);
    const scene = (this.scene = new THREE.Scene());
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
    this.inst = {}; // name -> [InstancedMesh]
    this.doors = new Map(); // where -> the door's group
    this.items = new Map(); // where + what -> a brick item lying on the floor
    this.fx = new ThrowFX(this); // thrown things, flying and tumbling (throwfx.js)
    this.env = gradientEnvironment(THREE, r); // what metal reflects (envmap.js; plastic is lit as ever)
    this.data = null;
    this.ready = Promise.all(Object.entries(PIECES).map(async ([k, url]) => { this.pieces[k] = await this.partsOf(url); }))
      .then(() => this.data && this.setTerrain(this.data));
    // solid boxes for the wall courses under the top one (their studs are hidden anyway), and the ground
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
    this.pieces.course = [{ geometry: box, material: new THREE.MeshStandardMaterial({ color: WALL_GREY, roughness: 0.35, flatShading: true }) }];
    this.pieces.ground = [{ geometry: box, material: new THREE.MeshStandardMaterial({ color: GROUND_GREEN, roughness: 0.35, flatShading: true }) }];
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
          if (quantumPart(o.material) !== null) strobify(o);
          // translucent brick (flames, ice) glows
          if (o.material.transparent && o.material.map) o.castShadow = false; // (printed see-through plastic: solid ink, its own alpha)
          else if (o.material.transparent) { o.material.emissive = o.material.color.clone(); o.material.emissiveIntensity = 0.7; o.material.opacity = 0.78; o.castShadow = false; }
        });
        addAura(THREE, g.scene); // an angel's glow
        addLightning(THREE, g.scene); // Mjollnir's crackle
        addEffects(THREE, g.scene); // an artifact's element: fire, meteors, frost
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

  // fill the instances of a piece: list of [Matrix4, shade]
  place(name, list) {
    const parts = this.pieces[name];
    if (!parts) return;
    let meshes = this.inst[name];
    if (!meshes || meshes[0].instanceMatrix.count < list.length) {
      if (meshes) meshes.forEach((m) => { this.world.remove(m); m.dispose(); });
      const cap = Math.max(64, Math.ceil(list.length * 1.5));
      meshes = this.inst[name] = parts.map(({ geometry, material }) => {
        const im = new THREE.InstancedMesh(geometry, material, cap);
        im.castShadow = im.receiveShadow = true;
        im.frustumCulled = false;
        this.world.add(im);
        return im;
      });
    }
    const c = new THREE.Color();
    for (const im of meshes) {
      list.forEach(([m, shade], i) => { im.setMatrixAt(i, m); im.setColorAt(i, c.setScalar(shade)); });
      im.count = list.length;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  // The dungeon, from the game's terrain builder:
  // {w, h, floors: [{x, z, shade, studs}], walls: [{x, z, shade, studs, rise}], doors: [{url, matrix, shade}]}
  setTerrain(data) {
    this.data = data;
    const M = () => new THREE.Matrix4();
    const S = MODEL_SCALE;
    const plates = [], smooth = [], courses = [], bricks = [];
    for (const f of data.floors) {
      if (f.studs) plates.push([M().makeTranslation(f.x + 0.5, 0, f.z + 0.5).scale(new THREE.Vector3(S, S, S)), f.shade]);
      else smooth.push([M().makeTranslation(f.x, -PLATE_H, f.z).scale(new THREE.Vector3(1, PLATE_H, 1)), f.shade]); // a printed tile goes on top
    }
    for (const w of data.walls) {
      // under the wall, the floor's plate; then five courses of two 2x4 bricks, crossing each course
      // (the Castle's: its outer walls RISE_COURSES[1] more, its towers [2], every other
      // square a course higher again: the battlements)
      const n = 5 + (w.rise ? RISE_COURSES[w.rise] + ((w.x + w.z) % 2 === 0 ? 1 : 0) : 0);
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
    this.place('plate', plates);
    this.place('ground', smooth.concat([[M().makeTranslation(0, -PLATE_H - BRICK_H, 0).scale(new THREE.Vector3(data.w, BRICK_H, data.h)), 0.95]]));
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
    // point is in from the haze's edge (0 at the edge: it sags and thins there)
    const pos = [], edge = [];
    const N = 3;
    for (const c of cells) {
      const { x, z } = c;
      const open = [!isFog(x - 1, z), !isFog(x + 1, z), !isFog(x, z - 1), !isFog(x, z + 1)];
      const inset = (vx, vz) => {
        let d = 1;
        if (open[0]) d = Math.min(d, vx - x);
        if (open[1]) d = Math.min(d, x + 1 - vx);
        if (open[2]) d = Math.min(d, vz - z);
        if (open[3]) d = Math.min(d, z + 1 - vz);
        return Math.min(1, d / 0.67);
      };
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
      // (a hair inside its own square: never in the same plane as a wall's face, where they'd flicker)
      const I = 0.03;
      if (open[2]) side([x, B, z + I], [x + 1, B, z + I], [x + 1, T, z + I], [x, T, z + I]);
      if (open[3]) side([x, B, z + 1 - I], [x + 1, B, z + 1 - I], [x + 1, T, z + 1 - I], [x, T, z + 1 - I]);
      if (open[0]) side([x + I, B, z], [x + I, B, z + 1], [x + I, T, z + 1], [x + I, T, z]);
      if (open[1]) side([x + 1 - I, B, z], [x + 1 - I, B, z + 1], [x + 1 - I, T, z + 1], [x + 1 - I, T, z]);
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
    const OVER = [[-0.3, T - 0.45], [0.0, 1.97], [0.5, 1.94], [0.98, 1.92], [1.07, 1.72], [1.1, 1.35], [1.12, 0.95]];
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
      const level = it.level || 0;
      const key = `${it.x},${it.z},${level},${it.url}`;
      let g = this.items.get(key);
      if (!g) {
        g = new THREE.Group();
        // a slant of its own: diagonal, crossing the one below, and a little off true
        const h = Math.sin(it.x * 12.9898 + it.z * 78.233 + level * 37.719) * 43758.5453;
        const turn = (level % 2 ? -1 : 1) * Math.PI / 4 + (h - Math.floor(h) - 0.5) * 0.35;
        g.position.set(it.x + 0.5, STUD_H, it.z + 0.5);
        g.rotation.y = turn;
        g.scale.setScalar(MODEL_SCALE);
        g.userData = { square: `${it.x},${it.z}`, level, thick: 0 };
        this.world.add(g);
        if (this.fx.isIncoming(it.x, it.z, it.url)) g.visible = false; // (still in the air: it lands, then shows: throwfx.js)
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
          lay.position.set(-c.x, -box.min.y, -c.z); // centred on the square, its underside at the group's height
          g.add(lay);
          g.userData.thick = (box.max.y - box.min.y) * MODEL_SCALE;
          this.restack(g.userData.square);
        });
        touched.add(g.userData.square);
      }
      keep.set(key, g);
    }
    for (const [key, g] of this.items) if (!keep.has(key)) { this.world.remove(g); touched.add(g.userData.square); }
    this.items = keep;
    // a thrown item picked up (or gone): its resting pose forgotten
    for (const k of [...this.fx.poses.keys()]) {
      const [x, z, ...u] = k.split(','), url = u.join(',');
      if (!list.some((it) => it.x === +x && it.z === +z && it.url === url)) this.fx.poses.delete(k);
    }
    for (const sq of touched) this.restack(sq);
  }

  // a thrown item landed (or burst): its square's items made again (with its pose, shown)
  redrawItems(k) {
    const [x, z, ...u] = k.split(','), url = u.join(',');
    for (const [key, g] of [...this.items]) {
      const [gx, gz, , ...gu] = key.split(',');
      if (+gx === +x && +gz === +z && gu.join(',') === url) { this.world.remove(g); this.items.delete(key); }
    }
  }

  // a square's pile, each item resting on the one below
  restack(square) {
    const pile = [...this.items.values()].filter((g) => g.userData.square === square && !g.userData.posed).sort((a, b) => a.userData.level - b.userData.level);
    let y = STUD_H;
    for (const g of pile) {
      g.position.y = y;
      y += g.userData.thick * 0.85; // (they settle into each other a little)
    }
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
  render(proj, view, w, h, focus) {
    const r = this.r;
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

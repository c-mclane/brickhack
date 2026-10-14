// The LEGO world, drawn by three.js exactly as the scene viewer (lego-test.html)
// draws it: the real LDraw parts as converted (tools/build_roster.py), the same
// lights and shadows, the same plain sky-blue background (no skybox, no fog).
// It shares the game's WebGL2 context and canvas, so the game's own pass
// (monster and item sprites, outlines...) draws over it with the same depth.
//
// Units are the game's: a map square is 1 (4x4 studs), a stud 0.25.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PARTS, MODEL_SCALE, BRICK_H, PLATE_H } from './lego.js';

export const SKY = 0x8fb8de; // the viewer's background

const PIECES = {
  plate: 'assets/lego/parts/plate4x4.glb', // a floor square: a green 4x4 plate, origin at its top middle
  brick: 'assets/lego/parts/brick2x4.glb', // a wall's top course: grey 2x4 bricks, origin at the top middle
};
const WALL_GREY = 0xa0a5a9, GROUND_GREEN = 0x00852b;

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
    this.doors = [];
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
          // translucent LEGO (flames, ice) glows
          if (o.material.transparent) { o.material.emissive = o.material.color.clone(); o.material.emissiveIntensity = 0.7; o.material.opacity = 0.78; o.castShadow = false; }
        });
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
  // {w, h, floors: [{x, z, shade, studs}], walls: [{x, z, shade, studs}], doors: [{url, matrix, shade}]}
  setTerrain(data) {
    this.data = data;
    const M = () => new THREE.Matrix4();
    const S = MODEL_SCALE;
    const plates = [], smooth = [], courses = [], bricks = [];
    for (const f of data.floors) {
      if (f.studs) plates.push([M().makeTranslation(f.x + 0.5, 0, f.z + 0.5).scale(new THREE.Vector3(S, S, S)), f.shade]);
      else smooth.push([M().makeTranslation(f.x, -PLATE_H, f.z).scale(new THREE.Vector3(1, PLATE_H, 1)), f.shade]); // a printed tile goes on top
    }
    const TOP = 6 * BRICK_H;
    for (const w of data.walls) {
      // under the wall, the floor's plate; then five courses of two 2x4 bricks, crossing each course
      courses.push([M().makeTranslation(w.x, -PLATE_H, w.z).scale(new THREE.Vector3(1, PLATE_H, 1)), w.shade]);
      for (let l = 0; l < 5; l++)
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
    // doors: a few, so plain copies of the model
    for (const d of this.doors) this.world.remove(d);
    this.doors = [];
    for (const d of data.doors) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.matrix.fromArray(d.matrix);
      this.doors.push(g);
      this.world.add(g);
      this.model(d.url).then((m) => g.add(m.clone()));
    }
  }

  // the figures to draw this frame: [{url, matrix}] (the hero)
  setFigures(list) {
    const key = list.map((f) => f.url).join('|');
    if (key !== this.figKey) {
      this.figKey = key;
      this.figures.clear();
      this.figObjs = list.map((f) => {
        const g = new THREE.Group();
        g.matrixAutoUpdate = false;
        this.figures.add(g);
        this.model(f.url).then((m) => g.add(m.clone()));
        return g;
      });
    }
    list.forEach((f, i) => { const g = this.figObjs[i]; g.matrix.fromArray(f.matrix); g.matrixWorldNeedsUpdate = true; });
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
    r.render(this.scene, this.cam);
    r.resetState();
  }
}

export { PARTS };

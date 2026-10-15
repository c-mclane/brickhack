// The LEGO world, drawn by three.js exactly as the scene viewer (lego-test.html)
// draws it: the real LDraw parts as converted (tools/build_roster.py), the same
// lights and shadows, the same plain sky-blue background (no skybox, no fog).
// It shares the game's WebGL2 context and canvas, so the game's own pass
// (monster and item sprites, outlines...) draws over it with the same depth.
//
// Units are the game's: a map square is 1 (4x4 studs), a stud 0.25.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { isMist, mistify, quantumPart, strobify, addAura } from './mist.js';
import { figureJoints, poseJoints } from './minifig-anim.js';
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
          // a doppelganger's other half is shimmering mist
          if (isMist(o.material)) { mistify(o); return; }
          if (quantumPart(o.material) !== null) strobify(o);
          // translucent LEGO (flames, ice) glows
          if (o.material.transparent) { o.material.emissive = o.material.color.clone(); o.material.emissiveIntensity = 0.7; o.material.opacity = 0.78; o.castShadow = false; }
        });
        addAura(THREE, g.scene); // an angel's glow
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
    this.setFog(data.fog || [], data.w, data.h);
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

  // Fog over everything not yet explored ([{x, z, into, near}], render.js): a
  // dense sea of puffy cloud, piled a little higher than the walls, with
  // wisps creeping out low along the floor into the squares beside it. Out
  // past the edge of the map it goes on a while. One draw of soft
  // camera-facing puffs, each drifting and breathing slowly (fogShader).
  setFog(cells, w, h) {
    const key = cells.length + ':' + cells.map((c) => c.x + c.z * 1000 + (c.near ? 0.5 : 0) + c.into.length * 0.1).reduce((a, b) => (a * 31 + b) % 1e9, 7);
    if (key === this.fogKey) return;
    this.fogKey = key;
    const P = []; // per puff: x, y, z, size, alpha, driftX, driftY, driftZ, phase
    const rnd = (x, z, k) => { // a fixed random number per square (the fog mustn't jump about when the map changes)
      let h = Math.imul(x * 374761393 + z * 668265263 + k * 2147483647, 1274126177);
      h = Math.imul(h ^ (h >>> 13), 1103515245);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const puff = (x, y, z, size, alpha, dx = 0, dy = 0, dz = 0, ph = 0) => P.push(x, y, z, size, alpha, dx, dy, dz, ph);
    const deep = (x, z) => { // far into the unknown: big overlapping puffs
      const r = (k) => rnd(x, z, k);
      puff(x + 0.5 + (r(1) - 0.5) * 0.6, 0.9 + r(2) * 0.5, z + 0.5 + (r(3) - 0.5) * 0.6, 2.3 + r(4) * 0.6, 0.9, 0, 0, 0, r(5));
      if (r(6) < 0.6) puff(x + 0.5 + (r(7) - 0.5) * 0.6, 1.7 + r(8) * 0.5, z + 0.5 + (r(9) - 0.5) * 0.6, 1.8 + r(10) * 0.6, 0.85, 0, 0, 0, r(11));
      puff(x + 0.5 + (r(12) - 0.5) * 0.4, 0.35, z + 0.5 + (r(13) - 0.5) * 0.4, 1.7 + r(14) * 0.4, 0.95, 0, 0, 0, r(15)); // (no floor showing through)
    };
    for (const c of cells) {
      const r = (k) => rnd(c.x, c.z, k);
      if (!c.near) { deep(c.x, c.z); continue; }
      // beside the explored dungeon: smaller puffs that stay in their square (no slicing through walls)
      for (let i = 0; i < 3; i++)
        puff(c.x + 0.5 + (r(20 + i) - 0.5) * 0.2, 0.42 + i * 0.58 + r(30 + i) * 0.1, c.z + 0.5 + (r(40 + i) - 0.5) * 0.2, 0.95 + r(50 + i) * 0.2, 0.92, 0, 0, 0, r(60 + i));
      // ...and wisps that creep out of it, low, into the squares you can walk
      for (const [dx, dz] of c.into)
        for (let i = 0; i < 2; i++)
          puff(c.x + 0.5 + dx * 0.3, 0.18 + r(70 + i) * 0.45, c.z + 0.5 + dz * 0.3, 0.55 + r(80 + i) * 0.3, 0.5,
            dx * (0.7 + r(90 + i) * 0.4), 0.05, dz * (0.7 + r(90 + i) * 0.4), r(100 + i));
    }
    // the map's surroundings: more of the same, a good way out
    const M = 10;
    for (let z = -M; z < h + M; z++)
      for (let x = -M; x < w + M; x++)
        if (x < 0 || z < 0 || x >= w || z >= h) deep(x, z);
    const n = P.length / 9;
    if (!this.fogMesh) {
      const g = new THREE.InstancedBufferGeometry();
      const quad = new THREE.PlaneGeometry(1, 1);
      g.index = quad.index;
      g.setAttribute('position', quad.attributes.position);
      g.setAttribute('uv', quad.attributes.uv);
      this.fogMat = new THREE.ShaderMaterial({
        uniforms: { uTex: { value: fogTexture() }, uTime: { value: 0 } },
        vertexShader: FOG_VS, fragmentShader: FOG_FS,
        transparent: true, depthWrite: false,
      });
      this.fogMesh = new THREE.Mesh(g, this.fogMat);
      this.fogMesh.frustumCulled = false;
      this.fogMesh.renderOrder = 5; // after the solid world (and the glass)
      this.scene.add(this.fogMesh);
    }
    const g = this.fogMesh.geometry, buf = new Float32Array(P);
    const ib = new THREE.InstancedInterleavedBuffer(buf, 9);
    g.setAttribute('iPos', new THREE.InterleavedBufferAttribute(ib, 4, 0)); // xyz, size
    g.setAttribute('iAlpha', new THREE.InterleavedBufferAttribute(ib, 1, 4));
    g.setAttribute('iDrift', new THREE.InterleavedBufferAttribute(ib, 4, 5)); // drift xyz, phase
    g.instanceCount = n;
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
    });
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
    if (this.fogMat) this.fogMat.uniforms.uTime.value = performance.now() / 1000;
    r.render(this.scene, this.cam);
    r.resetState();
  }
}

// ---- the fog's puffs
// a puff of cloud: lumpy white, soft at the edges (drawn once, on a canvas)
function fogTexture() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * S * 0.22, r = S * (0.12 + rnd() * 0.16);
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d * 0.8;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const FOG_VS = `
attribute vec4 iPos; attribute float iAlpha; attribute vec4 iDrift;
uniform float uTime;
varying vec2 vUv; varying float vAlpha; varying float vH;
void main() {
  float ph = iDrift.w * 6.2832;
  // wisps creep out and back (fading as they go); every puff drifts and breathes a little
  float k = 0.5 - 0.5 * cos(uTime * 0.32 + ph);
  vec3 p = iPos.xyz + iDrift.xyz * k;
  p.x += sin(uTime * 0.11 + ph * 1.7) * 0.12;
  p.z += cos(uTime * 0.09 + ph * 2.3) * 0.12;
  p.y += sin(uTime * 0.19 + ph) * 0.06;
  float size = iPos.w * (0.94 + 0.06 * sin(uTime * 0.45 + ph * 3.1));
  // face the camera, turned a little each (so the puffs don't all look alike)
  float a = ph + uTime * 0.03;
  vec2 q = mat2(cos(a), sin(a), -sin(a), cos(a)) * position.xy * size;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.xy += q;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vAlpha = iAlpha * (length(iDrift.xyz) > 0.01 ? 1.0 - 0.85 * k : 1.0);
  vH = p.y;
}`;
const FOG_FS = `
uniform sampler2D uTex;
varying vec2 vUv; varying float vAlpha; varying float vH;
void main() {
  vec4 t = texture2D(uTex, vUv);
  // white on top, a soft blue-grey underneath
  vec3 col = mix(vec3(0.74, 0.78, 0.86), vec3(1.0), clamp(vH / 2.2, 0.0, 1.0));
  float a = clamp(t.a * 1.6, 0.0, 1.0) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}`;

export { PARTS };

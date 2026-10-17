// The races' special looks.
//
// A quantum mechanic (tools/ldraw2glb.py: 'Quantum_Strobe_<n>', one per part):
// every part flashes between red, white, yellow and blue, each on its own, a
// dozen times a second, like the magic portal in the old brick stop-motion films.
//
// A doppelganger's other half (tools/ldraw2glb.py: the 'Doppel_Mist' colour):
// translucent green that glows and ripples like liquid, the same in the scene
// viewer and the game (three.js), and in brick.js's own shader (MIST_GLSL).

const t0 = performance.now();
const uTime = { value: 0 };
let ticking = false;
const strobing = []; // [material, part number]
const tick = () => {
  uTime.value = (performance.now() - t0) / 1000;
  for (const [m, i] of strobing) { m.color.setHex(strobeHex(i, uTime.value)); m.emissive.copy(m.color); }
  for (const m of hueing) m.color.setHSL((uTime.value * 0.15) % 1, 0.85, 0.5); // (a magic marker: round the colour wheel)
  const lit = (uTime.value % 1.1) < 0.35; // (a land mine's light: a flash, then dark)
  for (const m of blinking) { m.emissiveIntensity = lit ? 2.2 : 0.05; m.opacity = lit ? 0.95 : 0.55; }
  requestAnimationFrame(tick);
};
const hueing = new Set(); // materials whose colour goes round the wheel (addHueShift)
const blinking = new Set(); // materials that blink on and off (addBlink)
const startTicking = () => { if (!ticking) { ticking = true; tick(); } };

const STROBE = [0xc91a09, 0xffffff, 0xf2cd37, 0x0055bf]; // brick red, white, yellow, blue
const STROBE_FPS = 12;
// the part's colour at time t (s): a new one each frame, picked at random but the same for everyone
export function strobeHex(part, t) {
  const f = Math.floor(t * STROBE_FPS);
  let h = Math.imul(f ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(part + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  return STROBE[(h >>> 16) & 3];
}
export const quantumPart = (material) => { const m = /^Quantum_Strobe_(\d+)/.exec(material.name || ''); return m ? +m[1] : null; };

// make a three.js mesh's material strobe (a quantum mechanic's part)
export function strobify(mesh) {
  const m = mesh.material;
  m.flatShading = true;
  m.emissiveIntensity = 0.25;
  strobing.push([m, quantumPart(m) + 101 * strobing.length]); // (no two figures flash alike)
  startTicking();
}

export const isMist = (material) => /^Doppel_Mist/.test(material.name || '');

// the ripple: slow waves running up the body, a quick shimmer over them;
// p is the point in the model's own space, n its normal, t seconds
export const MIST_GLSL = `
float mistWave(vec3 p, float t) {
  float w = sin(p.y * 9.0 - t * 2.2 + sin(p.x * 7.0 + t) * 1.5) * 0.5 + 0.5;
  float s = sin(p.x * 23.0 + p.z * 19.0 + t * 4.0) * sin(p.y * 17.0 - t * 3.0) * 0.5 + 0.5;
  return w * 0.75 + s * 0.25;
}`;

// make a three.js material (MeshStandardMaterial) into mist
export function mistify(mesh) {
  const m = mesh.material;
  startTicking();
  m.flatShading = true;
  m.transparent = true;
  m.depthWrite = false;
  m.emissive = m.color.clone();
  m.emissiveIntensity = 0.6;
  m.roughness = 0.1;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMistTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMistPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMistPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vMistPos;\nuniform float uMistTime;\n${MIST_GLSL}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
  { float w = mistWave(vMistPos, uMistTime);
    gl_FragColor.rgb *= 0.8 + 0.5 * w;
    gl_FragColor.a = 0.28 + 0.4 * w; }`);
  };
  mesh.castShadow = false;
  mesh.renderOrder = 2; // after the solid half and other glass
}

// An angel (tools/ldraw2glb.py marks the model {aura: true}): the whole figure
// outlined in a glowing white corona. Shells round the figure, each puffed out
// along the smoothed normals, light up towards the figure's outline (where
// they're seen edge-on) and fade outwards, breathing slowly. Only their far
// sides are drawn, so the figure itself hides them: the glow is round it, not on it.
export const AURA = [ // offset (studs), strength
  { off: 0.08, strength: 0.9 },
  { off: 0.22, strength: 0.55 },
  { off: 0.42, strength: 0.3 },
];
export const AURA_COLOR = [1.0, 0.98, 0.9];
// rim brightness for a shell point: n, v unit view-space normal and direction to the eye
export const AURA_GLSL = `
float auraGlow(vec3 n, vec3 v, float strength, float t) {
  if (dot(n, v) > 0.0) discard; // the far side only (by its normal: LDraw's windings can't be trusted)
  float rim = 1.0 - abs(dot(n, v));
  return pow(rim, 2.2) * strength * (0.85 + 0.15 * sin(t * 1.8));
}`;

// the part of a model's triangles toward one end (an aura's "tip": {dir, fraction}): the
// triangles whose middle lies in the last `fraction` of the model's length along dir
export function tipOf(pos, tip) {
  if (!tip) return pos;
  const d = tip.dir || [0, 1, 0], l = Math.hypot(...d) || 1;
  const along = (i) => (pos[i] * d[0] + pos[i + 1] * d[1] + pos[i + 2] * d[2]) / l;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.length; i += 3) { const a = along(i); if (a < lo) lo = a; if (a > hi) hi = a; }
  const cut = hi - (tip.fraction ?? 0.5) * (hi - lo), out = [];
  for (let t = 0; t < pos.length; t += 9)
    if ((along(t) + along(t + 3) + along(t + 6)) / 3 >= cut) for (let k = 0; k < 9; k++) out.push(pos[t + k]);
  return new Float32Array(out);
}

// the shells for a model's triangles (positions, 9 floats a triangle): [{pos, nrm, strength}];
// scale: how far out they stand (1: an angel's; less, a thinner glow)
export function auraShells(pos, scale = 1, layers = AURA.length) {
  const key = (i) => `${Math.round(pos[i] * 40)},${Math.round(pos[i + 1] * 40)},${Math.round(pos[i + 2] * 40)}`;
  const sum = new Map(), face = new Float32Array(pos.length);
  for (let t = 0; t < pos.length; t += 9) {
    const ax = pos[t + 3] - pos[t], ay = pos[t + 4] - pos[t + 1], az = pos[t + 5] - pos[t + 2];
    const bx = pos[t + 6] - pos[t], by = pos[t + 7] - pos[t + 1], bz = pos[t + 8] - pos[t + 2];
    const n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]; // area-weighted
    const l = Math.hypot(...n) || 1;
    for (let k = 0; k < 9; k += 3) {
      face.set([n[0] / l, n[1] / l, n[2] / l], t + k);
      const s = sum.get(key(t + k)) || [0, 0, 0, 0];
      s[0] += n[0]; s[1] += n[1]; s[2] += n[2]; s[3] += l;
      sum.set(key(t + k), s);
    }
  }
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const s = sum.get(key(i)), l = Math.hypot(s[0], s[1], s[2]);
    // where the faces cancel out (both sides of a thin cape) use the face's own normal
    if (l > 0.3 * s[3]) nrm.set([s[0] / l, s[1] / l, s[2] / l], i);
    else nrm.set(face.subarray(i, i + 3), i);
  }
  return AURA.slice(0, layers).map(({ off, strength }) => {
    const p = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i++) p[i] = pos[i] + nrm[i] * off * scale;
    return { pos: p, nrm, strength };
  });
}

// three.js: give a loaded model (gltf.scene) its aura, if it's an angel; a
// figure in joints gets a set of shells per joint, so the glow moves with them.
// An aura is true (an angel's) or {color: [r, g, b], scale (its thickness),
// strength (how bright: 1 an angel's), layers (how many shells: an angel's 3),
// tip: {dir, fraction} (only that end of the model glows: Sting's blade)}
export function addAura(THREE, root) {
  let angel = null;
  root.traverse((o) => { if (!angel && o.userData && o.userData.aura) angel = o; });
  if (!angel) return;
  const cfg = typeof angel.userData.aura === 'object' ? angel.userData.aura : {};
  const only = angel.userData.fxJoint && root.getObjectByName(angel.userData.fxJoint); // (just that part glows: an amulet on a figure)
  const parts = only ? [only] : angel.userData.rig && angel.children.some((c) => c.name) ? angel.children.filter((c) => c.name) : [root];
  root.updateMatrixWorld(true);
  startTicking();
  for (const part of parts) auraOf(THREE, part, cfg);
}
function auraOf(THREE, root, cfg = {}) {
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const all = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), v = new THREE.Vector3();
    const a = g.attributes.position;
    for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(m); all.push(v.x, v.y, v.z); }
  });
  const pos = tipOf(new Float32Array(all), cfg.tip);
  if (!pos.length) return;
  for (const sh of auraShells(pos, cfg.scale ?? 1, cfg.layers)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(sh.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(sh.nrm, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uStrength: { value: sh.strength * (cfg.strength ?? 1) }, uMistTime: uTime, uColor: { value: new THREE.Vector3(...(cfg.color || AURA_COLOR)) } },
      vertexShader: `varying vec3 vN; varying vec3 vP;
        void main() { vN = normalize(normalMatrix * normal); vec4 p = modelViewMatrix * vec4(position, 1.0); vP = p.xyz; gl_Position = projectionMatrix * p; }`,
      fragmentShader: `varying vec3 vN; varying vec3 vP; uniform float uStrength, uMistTime; uniform vec3 uColor;
        ${AURA_GLSL}
        void main() { float a = auraGlow(normalize(vN), normalize(-vP), uStrength, uMistTime); gl_FragColor = vec4(uColor * a, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 3;
    mesh.castShadow = mesh.receiveShadow = false;
    root.add(mesh);
  }
}

// three.js: lightning crackling over a model (Mjollnir), if it's marked so
// (userData.lightning): jagged bolts between points on it, a few sets of
// them baked in; the shader flashes one set at a time, now and then
const BOLT_SETS = 8;
export function addLightning(THREE, root) {
  let host = null;
  root.traverse((o) => { if (!host && o.userData && o.userData.lightning) host = o; });
  if (!host) return;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const pts = [], v = new THREE.Vector3();
  // (fxJoint: only that part crackles: an amulet on a figure)
  const src = (host.userData.fxJoint && root.getObjectByName(host.userData.fxJoint)) || root;
  src.traverse((o) => {
    if (!o.isMesh) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), a = o.geometry.attributes.position;
    for (let i = 0; i < a.count; i += 3) { v.fromBufferAttribute(a, i).applyMatrix4(m); pts.push(v.clone()); }
  });
  if (pts.length < 2) return;
  const box = new THREE.Box3().setFromPoints(pts), size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());
  const pos = [], set = [], up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(1, 0, 0);
  const rnd = (n) => (Math.random() * 2 - 1) * n;
  const ribbon = (a, b, s, w) => { // a flat strip a-b, twice (crossed), so it shows from anywhere
    const d = b.clone().sub(a).normalize();
    for (const ref of [up, side]) {
      const n = d.clone().cross(ref).normalize().multiplyScalar(w);
      if (!n.lengthSq()) continue;
      const q = [a.clone().add(n), a.clone().sub(n), b.clone().sub(n), b.clone().add(n)];
      for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(q[k].x, q[k].y, q[k].z); set.push(s); }
    }
  };
  for (let s = 0; s < BOLT_SETS; s++)
    for (let b = 0; b < 4; b++) {
      const a = pts[(Math.random() * pts.length) | 0];
      // out into the air from it, away from its middle (so it's seen, not hidden inside)
      const away = a.clone().sub(center).normalize().add(new THREE.Vector3(rnd(0.7), rnd(0.7), rnd(0.7))).normalize();
      const end = a.clone().add(away.multiplyScalar(size * (0.2 + Math.random() * 0.25)));
      let prev = a.clone();
      const steps = 7;
      for (let k = 1; k <= steps; k++) {
        const p = a.clone().lerp(end, k / steps);
        if (k < steps) p.add(new THREE.Vector3(rnd(1), rnd(1), rnd(1)).multiplyScalar(size * 0.06));
        ribbon(prev, p, s, size * 0.01);
        prev = p;
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSet', new THREE.Float32BufferAttribute(set, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMistTime: uTime },
    vertexShader: `attribute float aSet; varying float vSet;
      void main() { vSet = aSet; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vSet; uniform float uMistTime;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float f = floor(uMistTime * 16.0);
        if (abs(mod(f, ${BOLT_SETS}.0) - vSet) > 0.5 || hash(f) < 0.2) discard; // this set, this moment (or none)
        gl_FragColor = vec4(0.75, 0.88, 1.0, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 3;
  mesh.castShadow = mesh.receiveShadow = false;
  root.add(mesh);
  startTicking();
}

// three.js: an artifact's element, in particles over it (userData.fx, from its
// item's "fx": ldraw2glb.figure_extras): 'fire' (flames rising off it: the Sword
// of Fire), 'meteors' (little meteors flaring and gone round it: the Scythe of
// Quakes), 'frost' (icy glints drifting down and twinkling: the Shurikens of
// Ice). Each particle sits on a point of the model and lives its own short life
// over and over, in the shader (no work per frame but the clock).
const FX = {
  fire: { n: 140, size: 0.09, color: 'mix(vec3(1.0, 0.95, 0.5), vec3(0.9, 0.18, 0.02), t)', alpha: '(1.0 - t) * 0.9',
    move: 'p += up * t * h * 0.45 + side * sin(t * 9.0 + ph * 6.3) * h * 0.03;', speed: '0.9 + ph * 0.8' },
  meteors: { n: 40, size: 0.15, color: 'mix(vec3(1.0, 0.98, 0.8), vec3(1.0, 0.45, 0.1), t)', alpha: 'sin(t * 3.1416) * step(0.55, fract(ph * 7.3 + floor(uMistTime * 0.7 + ph) * 0.37))',
    move: 'p += away * h * 0.25 + (away * 0.6 - up) * t * h * 0.35;', speed: '1.6 + ph * 1.2' },
  frost: { n: 140, size: 0.09, color: 'vec3(0.88, 0.96, 1.0)', alpha: 'pow(max(sin((t + ph) * 6.2832 * 2.0), 0.0), 6.0)',
    move: 'p += away * h * 0.12 - up * t * h * 0.18;', speed: '0.25 + ph * 0.3' },
};
export function addEffects(THREE, root) {
  let host = null;
  root.traverse((o) => { if (!host && o.userData && FX[o.userData.fx]) host = o; });
  if (!host) return;
  const fx = FX[host.userData.fx];
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const pts = [], v = new THREE.Vector3();
  // (fxJoint: only that part burns: a statue's torch flame, not the statue)
  const src = (host.userData.fxJoint && root.getObjectByName(host.userData.fxJoint)) || root;
  src.traverse((o) => {
    if (!o.isMesh) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), a = o.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(m); pts.push(v.clone()); }
  });
  if (!pts.length) return;
  const box = new THREE.Box3().setFromPoints(pts), center = box.getCenter(new THREE.Vector3());
  const h = box.getSize(new THREE.Vector3()).length();
  const pos = [], out = [], ph = [];
  for (let i = 0; i < fx.n; i++) {
    const p = pts[(Math.random() * pts.length) | 0];
    pos.push(p.x, p.y, p.z);
    const o = p.clone().sub(center).normalize();
    out.push(o.x || 0, o.y || 0, o.z || 0);
    ph.push(Math.random());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aOut', new THREE.Float32BufferAttribute(out, 3));
  g.setAttribute('aPh', new THREE.Float32BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMistTime: uTime, uH: { value: h }, uVH: { value: 600 } },
    vertexShader: `attribute vec3 aOut; attribute float aPh; uniform float uMistTime, uH, uVH; varying float vT, vPh;
      void main() {
        float ph = aPh, h = uH;
        float t = fract(uMistTime * (${fx.speed}) * 0.6 + ph);
        // the world's up and a sideways, in the model's own frame (so flames rise however it lies)
        vec3 up = normalize(transpose(mat3(modelMatrix)) * vec3(0.0, 1.0, 0.0));
        vec3 side = normalize(cross(up, vec3(0.3, 0.1, 0.9)));
        vec3 away = aOut, p = position;
        ${fx.move}
        vT = t; vPh = ph;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // (a true size in the world: the model's own scale, the lens and the screen's height, as any
        // mesh would be drawn; so the same in the dungeon as on the baseplate)
        float scale = length(modelMatrix[0].xyz);
        gl_PointSize = ${fx.size.toFixed(3)} * uH * scale * projectionMatrix[1][1] * 0.5 * uVH / -mv.z * (1.2 - t * 0.6);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uMistTime; varying float vT, vPh;
      void main() {
        float t = vT, ph = vPh;
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float a = (${fx.alpha}) * smoothstep(0.5, 0.1, d);
        if (a < 0.01) discard;
        gl_FragColor = vec4(${fx.color}, a);
      }`,
    transparent: true, depthWrite: false, // (not additive: fire stays orange and frost white over green grass)
  });
  const points = new THREE.Points(g, mat);
  points.renderOrder = 3;
  points.frustumCulled = false;
  const vp = new THREE.Vector2(); // (the height drawn to, in pixels, for the size above: on the material, shared by every copy)
  mat.onBeforeRender = (r) => { const t = r.getRenderTarget(); mat.uniforms.uVH.value = t ? t.height : r.getDrawingBufferSize(vp).y; };
  root.add(points);
  startTicking();
}

// An item whose colour shifts round the colour wheel (a magic marker:
// tools/build_items.py "hue", in its model's extras): every part of it
export function addHueShift(THREE, root) {
  let on = false;
  root.traverse((o) => { if (o.userData && o.userData.hue) on = true; });
  if (!on) return;
  root.traverse((o) => { if (o.isMesh) hueing.add(o.material); });
  startTicking();
}

// A part that blinks (a land mine's light: tools/build_items.py "blink":
// {joint}, in its model's extras): its node's materials flash on and off
export function addBlink(THREE, root) {
  let b = null;
  root.traverse((o) => { if (!b && o.userData && o.userData.blink) b = o.userData.blink; });
  const node = b && root.getObjectByName(b.joint);
  if (!node) return;
  node.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.material.emissive) return;
    o.material.emissive = o.material.color.clone();
    o.material.transparent = true;
    blinking.add(o.material);
  });
  startTicking();
}

// The races' special looks.
//
// A quantum mechanic (tools/ldraw2glb.py: 'Quantum_Strobe_<n>', one per part):
// every part flashes between red, white, yellow and blue, each on its own, a
// dozen times a second, like the magic portal in the old LEGO stop-motion films.
//
// A doppelganger's other half (tools/ldraw2glb.py: the 'Doppel_Mist' colour):
// translucent green that glows and ripples like liquid, the same in the scene
// viewer and the game (three.js), and in lego.js's own shader (MIST_GLSL).

const t0 = performance.now();
const uTime = { value: 0 };
let ticking = false;
const strobing = []; // [material, part number]
const tick = () => {
  uTime.value = (performance.now() - t0) / 1000;
  for (const [m, i] of strobing) { m.color.setHex(strobeHex(i, uTime.value)); m.emissive.copy(m.color); }
  requestAnimationFrame(tick);
};
const startTicking = () => { if (!ticking) { ticking = true; tick(); } };

const STROBE = [0xc91a09, 0xffffff, 0xf2cd37, 0x0055bf]; // LEGO red, white, yellow, blue
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

// the shells for a model's triangles (positions, 9 floats a triangle): [{pos, nrm, strength}]
export function auraShells(pos) {
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
  return AURA.map(({ off, strength }) => {
    const p = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i++) p[i] = pos[i] + nrm[i] * off;
    return { pos: p, nrm, strength };
  });
}

// three.js: give a loaded model (gltf.scene) its aura, if it's an angel; a
// figure in joints gets a set of shells per joint, so the glow moves with them
export function addAura(THREE, root) {
  let angel = null;
  root.traverse((o) => { if (!angel && o.userData && o.userData.aura) angel = o; });
  if (!angel) return;
  const parts = angel.userData.rig && angel.children.some((c) => c.name) ? angel.children.filter((c) => c.name) : [root];
  root.updateMatrixWorld(true);
  startTicking();
  for (const part of parts) auraOf(THREE, part);
}
function auraOf(THREE, root) {
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const all = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), v = new THREE.Vector3();
    const a = g.attributes.position;
    for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(m); all.push(v.x, v.y, v.z); }
  });
  if (!all.length) return;
  for (const sh of auraShells(new Float32Array(all))) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(sh.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(sh.nrm, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uStrength: { value: sh.strength }, uMistTime: uTime, uColor: { value: new THREE.Vector3(...AURA_COLOR) } },
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

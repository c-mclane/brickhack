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

// A shade of the dead (the manes: tools/ldraw2glb.py's 'Shade_Static' colours): a wisp of grey, crawling with
// static like a television's snow, scanlines rolling up it, flickering, now and then a band of it jerked aside;
// fading away to nothing at its feet. Its darker grey (a face, hair) stays darker, so it's still a face
export const isStatic = (material) => /^Shade_Static/.test(material.name || '');
export function staticify(mesh) {
  const m = mesh.material, dark = /Dark/.test(m.name);
  startTicking();
  m.flatShading = true;
  m.transparent = true;
  m.depthWrite = false;
  m.emissive = m.color.clone();
  m.emissiveIntensity = dark ? 0.02 : 0.5;
  m.roughness = 0.9;
  m.metalness = 0;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMistTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMistPos;\nuniform float uMistTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vMistPos = position;
  { float band = floor(position.y * 5.0), f = floor(uMistTime * 9.0); // (a band of it jerked aside, now and then)
    float g = fract(sin(band * 12.9898 + f * 78.233) * 43758.5453);
    if (g > 0.94) transformed.x += (g - 0.97) * 3.0; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMistPos;\nuniform float uMistTime;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
  { float f = floor(uMistTime * 24.0);
    float snow = fract(sin(dot(floor(gl_FragCoord.xy / 1.5) + f * vec2(7.13, 13.7), vec2(12.9898, 78.233))) * 43758.5453);
    float scan = 0.72 + 0.28 * sin(gl_FragCoord.y * 1.6 + uMistTime * 40.0);
    float roll = 0.75 + 0.25 * smoothstep(0.0, 0.2, fract(vMistPos.y * 0.3 - uMistTime * 0.35)); // (a bar rolling up it)
    float flick = 0.8 + 0.2 * step(0.35, fract(sin(floor(uMistTime * 11.0) * 91.7) * 43758.5453));
    float wisp = smoothstep(-3.6, -1.2, vMistPos.y); // (gone to nothing at its feet: its feet 3.6 studs under its neck)
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(${dark ? '0.08' : '0.85'}) * (0.55 + 0.75 * snow), ${dark ? '0.2' : '0.55'}) * scan * roll;
    gl_FragColor.a = (${dark ? '0.9' : '0.55'} + ${dark ? '0.1' : '0.25'} * snow) * wisp * flick; }`);
  };
  mesh.castShadow = false;
  mesh.renderOrder = dark ? 3 : 2; // (after what's solid; its face over the rest of it)
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
// (the shells made, round all of root's bricks: [mesh]; also a magic fountain's, brickworld.js stepFountainGlow)
export function auraOf(THREE, root, cfg = {}) {
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const all = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.material.isShaderMaterial) return; // (not what's thrown, nor another glow)
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), v = new THREE.Vector3();
    const a = g.attributes.position;
    for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(m); all.push(v.x, v.y, v.z); }
  });
  const pos = tipOf(new Float32Array(all), cfg.tip), made = [];
  if (!pos.length) return made;
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
    made.push(mesh);
  }
  return made;
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
  // (water leaping from a fountain's spout in arcs every way round, falling basin to basin: the
  // farther out an arc goes, the farther down it falls)
  fountain: { n: 300, size: 0.045, color: 'mix(vec3(0.9, 0.97, 1.0), vec3(0.4, 0.68, 0.95), t)', alpha: '0.85 * (1.0 - t * 0.45)',
    move: 'float ang = fract(ph * 13.37) * 6.2832; vec3 dir = side * cos(ang) + cross(up, side) * sin(ang); float far = fract(ph * 7.91); p += dir * h * (0.25 + 0.75 * far) * t + up * (h * 0.9 * t - (h * 0.9 + h * (0.7 + 2.6 * far)) * t * t);',
    speed: '0.55 + ph * 0.15' },
  // (hellfire: the same, red: Moloch's altar)
  hellfire: { n: 140, size: 0.09, color: 'mix(vec3(1.0, 0.42, 0.3), vec3(0.55, 0.02, 0.02), t)', alpha: '(1.0 - t) * 0.9',
    move: 'p += up * t * h * 0.45 + side * sin(t * 9.0 + ph * 6.3) * h * 0.03;', speed: '0.9 + ph * 0.8' },
  // (smoke: a vortex of it, thick, grey: up off the floor about its feet, spiralling round it and widening as it
  // climbs, faster as it goes, thinning away at the top, about its own upright (its model's origin: a figure's
  // middle, whatever it holds out): a shade of the dead's, the manes)
  smoke: { n: 260, size: 0.14, color: 'mix(vec3(0.62, 0.63, 0.67), vec3(0.82, 0.83, 0.86), t)', alpha: 'smoothstep(0.0, 0.08, t) * (1.0 - t * t) * 0.45',
    move: 'float ang = ph * 6.2832 + t * 9.0 + t * t * 8.0; float r = h * (0.07 + 0.2 * t) * (0.85 + 0.3 * fract(ph * 5.7)); vec3 fwd = cross(up, side); p = vec3(0.0, uLo, 0.0) + (side * cos(ang) + fwd * sin(ang)) * r + up * t * h * 0.8;',
    speed: '0.3 + ph * 0.1', glitch: true }, // (and glitching, as the shade does: static, jerks, flicker)
  frost: { n: 140, size: 0.09, color: 'vec3(0.88, 0.96, 1.0)', alpha: 'pow(max(sin((t + ph) * 6.2832 * 2.0), 0.0), 6.0)',
    move: 'p += away * h * 0.12 - up * t * h * 0.18;', speed: '0.25 + ph * 0.3' },
};
export function addEffects(THREE, root) {
  let host = null;
  root.traverse((o) => { if (!host && o.userData && FX[o.userData.fx]) host = o; });
  if (!host) return;
  if (host.userData.fx === 'fountain') return addStudFountain(THREE, root, host);
  const fx = FX[host.userData.fx];
  root.updateMatrixWorld(true);
  // (fxJoint: only that part burns: a statue's torch flame, not the statue; a list of them, each its own fire, sized
  // to it: an altar's two candle flames)
  const joints = [].concat(host.userData.fxJoint || []), srcs = joints.map((j) => root.getObjectByName(j)).filter(Boolean);
  for (const src of srcs.length ? srcs : [root]) addFxOn(THREE, root, fx, src);
  startTicking();
}
function addFxOn(THREE, root, fx, src) {
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const pts = [], v = new THREE.Vector3();
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
    uniforms: { uMistTime: uTime, uH: { value: h }, uVH: { value: 600 }, uC: { value: center }, uLo: { value: box.min.y } }, // (its middle, and its foot: a vortex up off the floor)
    vertexShader: `attribute vec3 aOut; attribute float aPh; uniform float uMistTime, uH, uVH, uLo; uniform vec3 uC; varying float vT, vPh;
      void main() {
        float ph = aPh, h = uH;
        float t = fract(uMistTime * (${fx.speed}) * 0.6 + ph);
        // the world's up and a sideways, in the model's own frame (so flames rise however it lies)
        vec3 up = normalize(transpose(mat3(modelMatrix)) * vec3(0.0, 1.0, 0.0));
        vec3 side = normalize(cross(up, vec3(0.3, 0.1, 0.9)));
        vec3 away = aOut, p = position;
        ${fx.move}
        ${fx.glitch ? `{ float band = floor(p.y * 5.0), f = floor(uMistTime * 9.0); // (a band of it jerked aside, now and then: staticify's)
          float g = fract(sin(band * 12.9898 + f * 78.233) * 43758.5453);
          if (g > 0.9) p += side * (g - 0.95) * h * 0.6; }` : ''}
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
        ${fx.glitch ? `{ float f = floor(uMistTime * 24.0); // (static: snow crawling over it, scanlines rolling, a flicker)
          float snow = fract(sin(dot(floor(gl_FragCoord.xy / 1.5) + f * vec2(7.13, 13.7), vec2(12.9898, 78.233))) * 43758.5453);
          float scan = 0.7 + 0.3 * sin(gl_FragCoord.y * 1.6 + uMistTime * 40.0);
          float flick = 0.75 + 0.25 * step(0.35, fract(sin(floor(uMistTime * 11.0) * 91.7 + vPh * 3.0) * 43758.5453));
          gl_FragColor.rgb *= (0.6 + 0.7 * snow) * scan;
          gl_FragColor.a *= (0.65 + 0.35 * snow) * flick; }` : ''}
      }`,
    transparent: true, depthWrite: false, // (not additive: fire stays orange and frost white over green grass)
  });
  const points = new THREE.Points(g, mat);
  points.renderOrder = 3;
  points.frustumCulled = false;
  const vp = new THREE.Vector2(); // (the height drawn to, in pixels, for the size above: on the material, shared by every copy)
  mat.onBeforeRender = (r) => { const t = r.getRenderTarget(); mat.uniforms.uVH.value = t ? t.height : r.getDrawingBufferSize(vp).y; };
  root.add(points);
}

// A fountain's water as bricks (tools/build_items.py fx "fountain", "fxPool": its pool's water level,
// LDU up from its foot): clear blue 1x1 round plates popping up out of its spout (fxJoint), each thrown
// up and out every way round, tumbling as they fall clear of the basins, and sinking out of sight into
// the pool's own heap of them; then up out of the spout again. In the model's own units (studs, Y up)
let studPiece = null; // the clear blue 1x1 round plate, its geometry (about its middle, studs) and plastic: once a fountain's built
export const fountainStud = () => studPiece;
export const setWaterStud = (geo, mat) => { if (!studPiece) studPiece = { geo, mat }; }; // (a pool's, when there's no fountain about)
const STUD_N = 40, STUD_G = 14; // (how many in the air at once; how hard they fall, studs/s²)
// (all in the shader, on the one clock: so every copy of the model (each fountain in the dungeon) pours too)
function addStudFountain(THREE, root, host) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const box = new THREE.Box3(), spout = new THREE.Box3(), v = new THREE.Vector3();
  const src = (host.userData.fxJoint && root.getObjectByName(host.userData.fxJoint)) || root;
  const grow = (o, b) => o.traverse((m) => {
    if (!m.isMesh) return;
    const mm = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld), a = m.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) b.expandByPoint(v.fromBufferAttribute(a, i).applyMatrix4(mm));
  });
  grow(root, box); grow(src, spout);
  const top = spout.getCenter(new THREE.Vector3()).setY(spout.max.y);
  const pool = box.min.y + (host.userData.fxPool || 0) / 20, reach = Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  // each stud's throw (out to land past the basins' rims, short of the pool's wall: [out x, out z, up speed,
  // when in its round]) and its spin (axis, how fast)
  const thr = [], spin = [];
  for (let i = 0; i < STUD_N; i++) {
    const ang = Math.random() * Math.PI * 2, r = reach * (0.62 + Math.random() * 0.2);
    thr.push(Math.cos(ang) * r, Math.sin(ang) * r, 3 + Math.random() * 2.2, Math.random());
    const ax = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    spin.push(ax.x, ax.y, ax.z, 5 + Math.random() * 8);
  }
  const uniforms = { uMistTime: uTime, uTop: { value: top }, uPool: { value: pool }, uG: { value: STUD_G } };
  // the studs thrown: the very piece in the spout (its fxJoint: the clear blue 1x1 round plate), its own
  // geometry and plastic, about its own middle
  const mid = spout.getCenter(new THREE.Vector3()), pieces = [];
  src.traverse((m) => {
    if (!m.isMesh) return;
    const g = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)).translate(-mid.x, -mid.y, -mid.z);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    pieces.push([g, m.material]);
  });
  if (!studPiece) studPiece = { geo: pieces[0][0].clone(), mat: pieces[0][1] }; // (for a splash, ThrowFX.splashStuds: the same piece)
  const mat = pieces[0][1].clone();
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'attribute vec4 aThrow; attribute vec4 aSpin; uniform float uMistTime, uPool, uG; uniform vec3 uTop;\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `
        // where it is in its round: thrown, falling (when it reaches the water, T), then sinking out of sight
        float dyS = uTop.y - uPool, vyS = aThrow.z;
        float T = (vyS + sqrt(vyS * vyS + 2.0 * uG * dyS)) / uG, cyc = T + 0.3;
        float uS = mod(uMistTime + aThrow.w * cyc, cyc), fall = min(uS, T);
        float ang = aSpin.w * uS; vec3 axS = aSpin.xyz;
        vec3 objectNormal = normal * cos(ang) + cross(axS, normal) * sin(ang) + axS * dot(axS, normal) * (1.0 - cos(ang));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', `
        float kS = uS > T ? 1.0 - (uS - T) / 0.3 : 1.0;
        vec3 transformed = position * kS;
        transformed = transformed * cos(ang) + cross(axS, transformed) * sin(ang) + axS * dot(axS, transformed) * (1.0 - cos(ang));
        transformed += uTop + vec3(aThrow.x * fall / T, vyS * fall - 0.5 * uG * fall * fall - (uS > T ? (uS - T) / 0.3 * 0.5 : 0.0), aThrow.y * fall / T);`);
  };
  for (const [g] of pieces) {
    g.setAttribute('aThrow', new THREE.InstancedBufferAttribute(new Float32Array(thr), 4));
    g.setAttribute('aSpin', new THREE.InstancedBufferAttribute(new Float32Array(spin), 4));
    const m = new THREE.InstancedMesh(g, mat, STUD_N);
    m.frustumCulled = false; m.renderOrder = 3;
    m.boundingBox = box.clone(); // (where they fly: within the fountain, not where the one piece sits, under its foot; the fountain laid flush on the floor: brickworld setItems)
    root.add(m);
  }
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

// Water (a pool, a moat: brickworld.js setTerrain): clear blue 1x1 round plates heaped in a square's
// hole, roiling: each bobbing, drifting a little round where it lies and rocking, and now and then
// popping up out of the heap with a flip. All in the shader, on the one clock; each stud its own by
// where it lies (its instance's place). In the piece's own units (studs, Y up; its middle a stud's
// height under its top)
export function roil(THREE, material, { glow = 0.2 } = {}) { // (glow: lit from within: water a little; lava, bright)
  const m = material.clone();
  m.opacity = Math.max(m.opacity, 0.9); // (heaped deep: hardly to be seen through)
  m.emissiveIntensity = glow > 0.2 ? glow : Math.min(m.emissiveIntensity, glow); // (so many glowing together wash out white: their blue kept)
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMistTime = uTime;
    const head = `uniform float uMistTime;
      mat3 roilRot(float a, float b) { float ca = cos(a), sa = sin(a), cb = cos(b), sb = sin(b);
        return mat3(1.0, 0.0, 0.0, 0.0, ca, sa, 0.0, -sa, ca) * mat3(cb, sb, 0.0, -sb, cb, 0.0, 0.0, 0.0, 1.0); }
      void roilAt(out mat3 R, out vec3 off) {
        vec2 at = instanceMatrix[3].xz;
        float h1 = fract(sin(dot(at, vec2(12.9898, 78.233))) * 43758.5453), h2 = fract(sin(dot(at, vec2(39.346, 11.135))) * 24634.6345);
        float t = uMistTime, ph = h1 * 6.2832;
        float bob = 0.3 * sin(t * (1.5 + h2 * 1.3) + ph) + 0.12 * sin(t * 3.3 + ph * 2.0) + 0.35 * (h2 - 0.5); // (and each at a height of its own: a lumpy heap)
        vec2 drift = 0.16 * vec2(sin(t * 0.9 + ph), cos(t * 0.7 + ph * 1.3));
        float p = fract(t * 0.2 + h2), pop = p < 0.09 ? p / 0.09 : 0.0; // (now and then: up out of the heap, flipping)
        R = roilRot(0.7 * sin(t * 1.3 + ph * 1.7) + 6.2832 * pop, 0.7 * cos(t * 1.1 + ph * 0.6));
        off = vec3(drift.x, bob + 1.4 * sin(3.1416 * pop), drift.y);
      }
`;
    sh.vertexShader = head + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `mat3 rR; vec3 rOff; roilAt(rR, rOff);
        vec3 objectNormal = rR * normal;
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', 'vec3 transformed = rR * (position - vec3(0.0, -0.1, 0.0)) + vec3(0.0, -0.1, 0.0) + rOff;');
  };
  m.customProgramCacheKey = () => 'roil';
  m.userData.roil = true;
  startTicking();
  return m;
}

// Lava smoking (brickworld.js setTerrain): over each pit's studs, little fountains of smoke: from each vent ([x, y,
// z], world squares) a steady stream of dark specks rising, drifting a little and wavering, swelling and then
// shrinking away as they go, and up again. All in the shader, on the one clock: one mesh for every pit on the level
export const SMOKE_PER_VENT = 12;
export function smokeVents(THREE, vents) {
  const n = vents.length * SMOKE_PER_VENT, vent = new Float32Array(n * 3), seed = new Float32Array(n * 4);
  vents.forEach(([x, y, z], v) => {
    for (let k = 0; k < SMOKE_PER_VENT; k++) {
      const i = v * SMOKE_PER_VENT + k, a = Math.random() * Math.PI * 2, d = 0.04 + Math.random() * 0.1;
      vent.set([x, y, z], i * 3);
      seed.set([k / SMOKE_PER_VENT + Math.random() * 0.05, 0.45 + Math.random() * 0.35, Math.cos(a) * d, Math.sin(a) * d], i * 4);
    }
  });
  const geo = new THREE.BoxGeometry(0.024, 0.024, 0.024);
  geo.setAttribute('aVent', new THREE.InstancedBufferAttribute(vent, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  const mat = new THREE.MeshBasicMaterial({ color: 0x2b2826 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMistTime = uTime;
    sh.vertexShader = 'attribute vec3 aVent; attribute vec4 aSeed; uniform float uMistTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      float u = fract(uMistTime * aSeed.y + aSeed.x); // (how far up its rise it is)
      vec3 at = aVent + vec3(aSeed.z * u + 0.025 * sin(u * 9.0 + aSeed.x * 40.0), u * 0.55, aSeed.w * u + 0.025 * cos(u * 7.0 + aSeed.x * 30.0));
      vec3 transformed = position * sin(3.1416 * u) * (0.7 + aSeed.y) + at;`);
  };
  mat.customProgramCacheKey = () => 'smoke-vents';
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  startTicking();
  return mesh;
}

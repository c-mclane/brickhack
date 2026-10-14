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

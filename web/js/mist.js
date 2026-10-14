// A doppelganger's other half (tools/ldraw2glb.py: the 'Doppel_Mist' colour):
// translucent green that glows and ripples like liquid, the same in the scene
// viewer and the game (three.js), and in lego.js's own shader (MIST_GLSL).

const t0 = performance.now();
const uTime = { value: 0 };
let ticking = false;
const tick = () => { uTime.value = (performance.now() - t0) / 1000; requestAnimationFrame(tick); };

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
  if (!ticking) { ticking = true; tick(); }
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

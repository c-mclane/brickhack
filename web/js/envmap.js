// What metal reflects: a soft sky-to-ground gradient (sky above, a bright band at
// the horizon, dark stone below). Chrome LEGO (ldraw2glb.py: fully metallic,
// smooth) has no colour of its own to show but what's around it; with nothing
// to reflect it would be black. Only metal gets it: plastic is lit as ever.
//
//   gradientEnvironment(THREE, renderer): a three.js environment map of it
//     (prefiltered, for rough and smooth metal alike), for envMap
//   ENV_GLSL: the same gradient as a GLSL function, envGrad(up), for a
//     renderer of our own (lego.js): up, the reflected ray's height (-1..1)

export const ENV = { sky: [0.42, 0.58, 0.86], horizon: [1.8, 1.7, 1.5], ground: [0.05, 0.045, 0.04] }; // (the horizon past white: a glint)

const v3 = (c) => `vec3(${c.map((x) => x.toFixed(3)).join(', ')})`;
export const ENV_GLSL = `
vec3 envGrad(float up) {
  vec3 sky = ${v3(ENV.sky)}, hor = ${v3(ENV.horizon)}, gnd = ${v3(ENV.ground)};
  return up > 0.0 ? mix(hor, sky, smoothstep(0.0, 0.3, up)) : mix(hor, gnd, smoothstep(0.0, 0.15, -up));
}`;

export function gradientEnvironment(THREE, renderer, env = ENV) {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uSky: { value: new THREE.Vector3(...env.sky) }, uHor: { value: new THREE.Vector3(...env.horizon) }, uGnd: { value: new THREE.Vector3(...env.ground) } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir; uniform vec3 uSky, uHor, uGnd;
      void main() { float up = normalize(vDir).y;
        vec3 c = up > 0.0 ? mix(uHor, uSky, smoothstep(0.0, 0.3, up)) : mix(uHor, uGnd, smoothstep(0.0, 0.15, -up));
        gl_FragColor = vec4(c, 1.0); }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  mat.dispose();
  return tex;
}

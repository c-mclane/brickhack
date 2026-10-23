// WebGL2 renderer: Minecraft-style blocks for terrain, camera-facing
// billboards for monsters / objects / the hero.  All art comes from the
// NetHack tile atlas.

import { brickBuilt } from './brickitems.js';
import { CM, classify, wallTile, cmapTile, WALL_H, DOOR_H, TRAP_ITEMS } from './terrain.js';
import { BrickRenderer, STUD_H, PARTS, DOOR_TOP, partMatrix } from './brick.js';
import { BrickWorld } from './brickworld.js';

const VS = `#version 300 es
in vec3 aPos; in vec2 aUV; in vec3 aMisc; // shade, key (1 = a sprite: its background is see-through), gray
uniform mat4 uProj, uView;
out vec2 vUV; out vec3 vMisc; out float vDist; out vec3 vWorld;
void main() {
  vec4 p = uView * vec4(aPos, 1.0);
  vDist = length(p.xyz);
  vWorld = aPos;
  vUV = aUV; vMisc = aMisc;
  gl_Position = uProj * p;
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 vUV; in vec3 vMisc; in float vDist; in vec3 vWorld;
uniform sampler2D uTex;
uniform vec3 uFog; uniform vec2 uFogRange;
uniform vec4 uSolid;
uniform float uTime;
out vec4 o;
void main() {
  if (uSolid.a > 0.0) { o = uSolid; return; }
  vec4 c = texture(uTex, vUV);
  // NetHack tiles use (71,108,108) as their background colour
  if (vMisc.y > 0.5 && distance(c.rgb, vec3(71.0, 108.0, 108.0) / 255.0) < 0.03) discard;
  vec3 col = c.rgb;
  if (vMisc.z > 0.5) col = vec3(dot(col, vec3(0.3, 0.59, 0.11)));
  col *= vMisc.x;
  float f = clamp((vDist - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
  o = vec4(mix(col, uFog, f), 1.0);
}`;

// ---- procedural sky: a dreamy, animated galaxy painted per pixel ----------
// Purple dream-space with drifting nebulae, slowly turning spiral galaxies,
// twinkling four-point sparkle stars and the occasional shooting star.
const SKY_VS = `#version 300 es
in vec2 aPos;
uniform vec3 uRight, uUp, uFwd;
uniform vec2 uTan; // tan(fov/2) * aspect, tan(fov/2)
out vec3 vDir;
void main() {
  vDir = uFwd + aPos.x * uTan.x * uRight + aPos.y * uTan.y * uUp;
  gl_Position = vec4(aPos, 0.999, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec3 vDir;
uniform float uTime;
uniform float uDay; // 1: the happy blue daytime sky
uniform float uSpace; // 1: floating in space: stars below the horizon too
const vec3 GRASS = vec3(0.27, 0.62, 0.17); // the ground below the horizon by day
out vec4 o;

const vec3 PURPLE = vec3(0.62, 0.36, 0.98);
const vec3 GREEN  = vec3(0.42, 1.00, 0.62);
const vec3 YELLOW = vec3(1.00, 0.90, 0.42);
const vec3 PINK   = vec3(1.00, 0.58, 0.88);
const vec3 WHITE  = vec3(1.0);

float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return v;
}
vec3 palette(float h) {
  h = fract(h);
  if (h < 0.25) return mix(PURPLE, PINK, h * 4.0);
  if (h < 0.5)  return mix(PINK, YELLOW, (h - 0.25) * 4.0);
  if (h < 0.75) return mix(YELLOW, GREEN, (h - 0.5) * 4.0);
  return mix(GREEN, PURPLE, (h - 0.75) * 4.0);
}

// a spiral galaxy centred on direction c
vec3 galaxy(vec3 d, vec3 c, float size, float spin, vec3 col, vec3 col2) {
  float facing = dot(d, c);
  if (facing < 0.0) return vec3(0.0);
  vec3 t1 = normalize(cross(c, vec3(0.31, 1.0, 0.17)));
  vec3 t2 = cross(c, t1);
  vec2 p = vec2(dot(d, t1), dot(d, t2)) / size;
  // tilt the disc a little so it reads as a galaxy, not a target
  p = mat2(1.0, 0.0, 0.35, 1.0) * p;
  float r = length(p), a = atan(p.y, p.x);
  float arms = pow(0.5 + 0.5 * sin(2.0 * a - 5.5 * log(r + 0.03) + uTime * spin), 3.0);
  float dust = fbm(vec3(p * 6.0, uTime * 0.02));
  float disc = exp(-r * 3.2) * (0.25 + arms * (0.6 + 0.6 * dust));
  float core = exp(-r * 22.0) * 1.6;
  return mix(col2, col, clamp(r * 2.5, 0.0, 1.0)) * disc + WHITE * core;
}

// direction -> (cube face id, 2D coords) so stars can sit on a flat grid
vec3 cubeUV(vec3 d) {
  vec3 a = abs(d);
  if (a.x > a.y && a.x > a.z) return vec3(d.yz / a.x, sign(d.x));
  if (a.y > a.z) return vec3(d.xz / a.y, 2.0 * sign(d.y));
  return vec3(d.xy / a.z, 3.0 * sign(d.z));
}

vec3 starTint(float h) {
  // the palette: pink, green, yellow, white, red (+ a little icy blue)
  return h < 0.22 ? PINK : h < 0.42 ? GREEN : h < 0.6 ? YELLOW : h < 0.74 ? WHITE : h < 0.9 ? vec3(1.0, 0.32, 0.38) : vec3(0.7, 0.9, 1.0);
}

// Pixel-art sky sprites.
// kind 0: blinking one-pixel dust
// kind 1: four-point twinkles
// kind 2: fat five-point stars with a white centre and a glow halo; each one
//         lives a little life: pops in, twinkles / grows / shrinks / spins /
//         flashes, then shrinks away or explodes into pixel sparks, and
//         reappears elsewhere in a new colour.
vec3 pixelStars(vec3 d, float scale, float density, float seed, int kind) {
  vec3 cu = cubeUV(d);
  vec2 uv = cu.xy * scale;
  vec2 cell = floor(uv);
  vec3 col = vec3(0.0);
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 cc = cell + vec2(i, j);
      vec3 base = hash33(vec3(cc, cu.z * 17.0 + seed));
      if (kind == 0) {
        if (base.x > density) continue;
        float px = 1.0 / 18.0;
        vec2 q = abs(floor((uv - (cc + 0.25 + 0.5 * base.yz)) / px));
        float blink = step(0.35, fract(uTime * (0.7 + base.y) + base.z * 9.0));
        if (q.x < 1.0 && q.y < 1.0) col += mix(PINK, mix(GREEN, WHITE, base.y), base.z) * blink * 0.9;
        continue;
      }
      if (kind == 1) {
        if (base.x > density) continue;
        float px = 1.0 / 26.0;
        vec2 q = floor((uv - (cc + 0.25 + 0.5 * base.yz)) / px);
        float fs = mod(floor(uTime * (3.0 + 4.0 * base.y) + base.z * 50.0), 6.0);
        float pulse = fs < 1.0 ? 0.0 : fs < 3.0 ? 1.0 : fs < 5.0 ? 2.0 : 1.0;
        float ax = abs(q.x), ay = abs(q.y);
        bool on = (ax < 1.0 && ay <= pulse + 1.0) || (ay < 1.0 && ax <= pulse + 1.0);
        if (on) col += mix(starTint(base.z), WHITE, ax + ay < 1.5 ? 0.7 : 0.2) * (0.5 + 0.35 * pulse);
        continue;
      }
      // ---- kind 2: five-point stars with a life cycle
      float period = 4.0 + 5.0 * base.y;
      float clock = uTime / period + base.z * 7.0;
      float life = fract(clock);
      vec3 h = hash33(vec3(cc, floor(clock) * 13.1 + cu.z * 5.0 + seed)); // new star each cycle
      if (h.x > density) continue;
      vec3 tint = starTint(h.z);
      vec2 center = cc + 0.28 + 0.44 * h.yz;
      float px = 1.0 / 34.0;
      vec2 p = floor((uv - center) / px) + 0.5; // sprite pixel coords
      bool explodes = h.y > 0.45;
      float R = 3.6 + 2.6 * h.y;
      // size over the life: pop in with overshoot, breathe, then shrink or burst
      float sz;
      if (life < 0.1) { float t = life / 0.1; sz = t * (1.0 + 0.6 * sin(t * 3.14159)); }
      else if (life < 0.78) sz = 1.0 + 0.18 * floor(2.0 * sin(life * 40.0 * (0.5 + h.z)) + 0.5) / 2.0; // stepped grow/shrink
      else if (!explodes) sz = max(0.0, 1.0 - (life - 0.78) / 0.12);
      else sz = life < 0.8 ? 1.25 : 0.0;
      float spin = (h.z > 0.5 ? 1.0 : -1.0) * step(0.4, fract(h.y * 7.3)) * uTime * (0.8 + 1.5 * h.y);
      float r = length(p);
      float a = atan(p.y, p.x) + spin + h.y * 6.28;
      float edge = R * sz * (0.62 + 0.38 * pow(abs(cos(2.5 * a)), 2.0)); // fat, cute points
      // flash white now and then
      bool flash = life > 0.15 && life < 0.78 && mod(floor(uTime * 8.0 + h.z * 30.0), 13.0) < 1.0;
      if (sz > 0.0 && r < edge) {
        vec3 c = r < edge * 0.42 ? mix(tint, WHITE, 0.8) : r < edge * 0.75 ? mix(tint, WHITE, 0.25) : tint;
        col += (flash ? WHITE : c) * 1.25;
      } else if (sz > 0.0 && r < edge + 1.6) {
        col += tint * 0.38 * (1.0 - (r - edge) / 1.6); // soft glow halo, like the sheet
      }
      if (flash && sz > 0.0 && (abs(p.x) < 0.6 || abs(p.y) < 0.6) && r < R * 2.4) col += WHITE * 0.6;
      // the burst: pixel sparks flying out and fading
      if (explodes && life >= 0.78 && life < 0.98) {
        float e = (life - 0.78) / 0.2;
        if (r < 2.5 && e < 0.2) col += WHITE * (1.0 - e * 5.0) * 1.5; // pop flash
        for (int k = 0; k < 8; k++) {
          float ang = float(k) * 0.7854 + h.y * 3.0;
          vec2 sp = floor(vec2(cos(ang), sin(ang)) * (2.0 + e * (9.0 + 5.0 * h.z))) + 0.5;
          vec2 dd = abs(p - sp);
          float big = e < 0.5 ? 1.0 : 0.5;
          if (dd.x < big && dd.y < big) col += mix(WHITE, tint, e) * (1.0 - e) * 1.3;
        }
      }
    }
  return col;
}

// faint dotted rings and swirls drifting behind the stars (also from the sheet)
vec3 dottedSwirls(vec3 d) {
  vec3 cu = cubeUV(d);
  vec2 uv = cu.xy * 4.0;
  vec2 cell = floor(uv);
  vec3 col = vec3(0.0);
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 cc = cell + vec2(i, j);
      vec3 h = hash33(vec3(cc, cu.z * 3.0 + 41.0));
      if (h.x > 0.22) continue;
      vec2 q = (uv - (cc + 0.3 + 0.4 * h.yz)) * 34.0; // in sprite pixels
      q = floor(q) + 0.5;
      float r = length(q), a = atan(q.y, q.x) + uTime * 0.15 * (h.z - 0.5);
      float ring = 7.0 + 6.0 * h.y + a * (h.z > 0.6 ? 1.6 : 0.0); // some are spirals
      float dots = step(0.5, fract(a * 5.0 + uTime * 0.3));
      if (abs(r - ring) < 0.6) col += mix(PINK, h.z > 0.7 ? vec3(1.0, 0.3, 0.35) : GREEN, h.y) * dots * 0.16;
    }
  return col;
}

void main() {
  vec3 d = normalize(vDir);
  float up = d.y * 0.5 + 0.5;
  // dreamy purple space, lighter toward the horizon
  vec3 col = mix(vec3(0.16, 0.07, 0.30), vec3(0.05, 0.02, 0.13), smoothstep(0.35, 1.0, up));
  // drifting nebulae in the four colours
  vec3 np = d * 2.2 + vec3(uTime * 0.008, 0.0, uTime * 0.005);
  float n = fbm(np);
  float n2 = fbm(np * 1.7 + 11.0);
  col += palette(n2 * 1.3 + uTime * 0.004) * pow(smoothstep(0.38, 0.82, n), 1.4) * 1.15;
  // a soft milky band across the sky
  float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.55, -0.78))), 2.0) * 18.0);
  col += mix(PURPLE, WHITE, 0.35) * band * (0.25 + 0.5 * fbm(d * 7.0)) * 0.6;
  // galaxies
  col += galaxy(d, normalize(vec3(0.4, 0.8, -0.45)), 0.42, 0.10, PURPLE, YELLOW) * 1.1;
  col += galaxy(d, normalize(vec3(-0.7, 0.55, 0.35)), 0.28, -0.14, GREEN, WHITE) * 1.1;
  col += galaxy(d, normalize(vec3(0.15, 0.6, 0.8)), 0.2, 0.18, YELLOW, PINK) * 1.0;
  col += galaxy(d, normalize(vec3(-0.2, 0.95, -0.1)), 0.16, -0.2, PINK, WHITE) * 0.9;
  col += galaxy(d, normalize(vec3(0.9, 0.35, 0.2)), 0.22, 0.12, GREEN, YELLOW) * 0.9;
  // pixel-art glitter: tiny dots, four-point sparkles, five-point stars
  vec3 stars = dottedSwirls(d);
  stars += pixelStars(d, 40.0, 0.45, 1.0, 0) * 0.9;
  stars += pixelStars(d, 16.0, 0.3, 5.0, 1);
  stars += pixelStars(d, 7.0, 0.45, 9.0, 2);
  col += stars;
  // an occasional shooting star
  float cycle = floor(uTime / 7.0);
  vec3 sh = hash33(vec3(cycle, 3.0, 9.0));
  float k = fract(uTime / 7.0) * 3.5;
  if (k < 1.0) {
    vec3 a0 = normalize(vec3(sh.x * 2.0 - 1.0, 0.45 + sh.y * 0.5, sh.z * 2.0 - 1.0));
    vec3 dir = normalize(cross(a0, vec3(0.0, 1.0, 0.0)) + vec3(0.0, -0.4, 0.0));
    vec3 head = normalize(a0 + dir * k * 0.7);
    float along = dot(d - head, -dir);
    float off = length(cross(d - head, dir));
    float trail = (along > 0.0 && along < 0.25) ? exp(-off * 900.0) * (1.0 - along / 0.25) : 0.0;
    col += mix(YELLOW, WHITE, 0.5) * (trail * 1.5 + exp(-length(d - head) * 600.0) * 2.0) * sin(k * 3.14159);
  }
  // gentle tone map so it glows instead of clipping
  vec3 night = 1.0 - exp(-col * 1.25);
  // daytime: a happy blue sky (pale at the horizon) with puffy clouds, the
  // stars and galaxies glowing through it (screen blend)
  vec3 blue = mix(vec3(0.70, 0.88, 1.0), vec3(0.30, 0.60, 1.0), smoothstep(0.5, 1.0, up));
  float cl = fbm(vec3(d.xz / max(d.y, 0.08) * 0.9 + vec2(uTime * 0.02, 0.0), 3.0));
  blue = mix(blue, vec3(1.0), smoothstep(0.55, 0.75, cl) * smoothstep(0.0, 0.25, d.y) * 0.85);
  vec3 bright = max(night - vec3(0.14, 0.06, 0.26), 0.0); // drop the purple space itself
  vec3 day = 1.0 - (1.0 - blue) * (1.0 - bright * 0.8);
  day = 1.0 - (1.0 - day) * exp(-stars * 2.0); // every star stays, bright, over the blue and the clouds
  col = mix(night, day, uDay);
  // the sky stops at a horizon level with the floor; below it is dark void (or haze by day)
  vec3 voidCol = mix(vec3(0.035, 0.02, 0.06), GRASS, uDay); // by day: grass all the way down
  col = mix(voidCol, col, max(smoothstep(-0.015, 0.02, d.y), uSpace));
  o = vec4(col, 1.0);
}`;

const FLOATS = 8; // x y z u v shade key gray
const FOG_REACH = 5; // squares: how far out past what you've seen the fog of the unknown is drawn (render.js buildTerrain)

// block type -> texture slots [sides, top]
const FACES = { grass: ['grassSide', 'grassTop'],
  log: ['logSide', 'logTop'], leaves: ['leaves'], brick: ['brick'], dirt: ['dirt'], cobble: ['cobble'], stone: ['stoneBricks'],
  planks: ['planks'], ridge: ['roof'],
  window: ['windowGlass'], weeds: ['weeds', 'hedge'], weedsTop: ['weedsTop', 'weedsTuft'] };
// fallen logs: the log's rings on its two ends, bark along it everywhere else
const LYING = { logX: 'x', logZ: 'z' };
// blocks with see-through pixels (their texture's key colour)
const CUTOUT = new Set(['window', 'weedsTop']);
// blocks that aren't whole cubes: they never hide the faces of blocks next to them
const PARTIAL = new Set(['ladder', 'roofN', 'roofS', 'fence', 'gate', 'gateOpen', 'window', 'weedsTop']);

function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

// view matrix from eye position + yaw/pitch (yaw 0 looks toward -Z = north)
function mat4View(eye, yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = [sy * cp, sp, -cy * cp];           // forward
  const r = [cy, 0, sy];                       // right
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return new Float32Array([
    r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0,
    -dot(r, eye), -dot(u, eye), dot(f, eye), 1,
  ]);
}

export class Renderer {
  constructor(canvas, atlas, meta) {
    this.canvas = canvas;
    const gl = (this.gl = canvas.getContext('webgl2', { antialias: false }));
    if (!gl) throw new Error('WebGL2 is not available in this browser');

    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = (this.prog = gl.createProgram());
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    this.u = {};
    for (const n of ['uProj', 'uView', 'uTex', 'uFog', 'uFogRange', 'uSolid', 'uTime']) this.u[n] = gl.getUniformLocation(p, n);
    this.a = { pos: gl.getAttribLocation(p, 'aPos'), uv: gl.getAttribLocation(p, 'aUV'), misc: gl.getAttribLocation(p, 'aMisc') };

    this.tex = gl.createTexture();
    this.setAtlas(atlas, meta);

    this.terrain = this.makeMesh();
    this.sprites = this.makeMesh();
    this.lines = this.makeMesh();
    this.overlay = this.makeMesh();
    this.blockMesh = this.makeMesh();
    this.figRender = new BrickRenderer(gl); // (the character previews' renderer; the game world is the BrickWorld's)
    this.brick = new BrickWorld(canvas, gl); // the brick dungeon and minifigs, drawn by three.js like the scene viewer
    this.brickOn = false; // drawing a brick level (the dungeon), not a block one (Ascend)
    this.brickFigures = []; // [{prims, matrix, shade}] drawn this frame (the hero)
    this.fpArm = null; // [{prims, matrix, pose, only, skip}]: first person, the hero's arms (and what they hold) in view space
    this.brickItems = []; // [{x, z, url}]: items lying on the floor as brick models (the brick dungeon)
    this.fog = [0.04, 0.04, 0.06];
    this.fov = 75;
  }

  // load a tile atlas (each game engine has its own)
  // overrides: [{tile, img}] custom sprites (art/monsters) that replace a tile in 3D
  setAtlas(img, meta, overrides = []) {
    const gl = this.gl;
    // below the game's tiles the GL atlas gets a 64px strip for the player's
    // Minecraft skin, then 64x64 cells for custom monster sprites at full size
    const rows = meta.rows || Math.ceil(meta.count / meta.cols);
    const TS = meta.size || 16; // the tileset's tile size (SLASH'EM's are 16px)
    const CELL = 64, perRow = Math.floor(img.width / CELL);
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = rows * TS + 64 + Math.ceil(overrides.length / perRow) * CELL;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    this.overrideUV = {};
    overrides.forEach(({ tile, img: o }, i) => {
      const cx = (i % perRow) * CELL, cy = rows * TS + 64 + Math.floor(i / perRow) * CELL;
      // keep pixel art crisp: biggest whole-number scale that fits (or shrink), feet at the bottom
      const k = Math.max(o.width, o.height) <= CELL ? Math.floor(CELL / Math.max(o.width, o.height)) : CELL / Math.max(o.width, o.height);
      const w = Math.round(o.width * k), h = Math.round(o.height * k);
      const cell = document.createElement('canvas');
      cell.width = cell.height = CELL;
      const cc = cell.getContext('2d', { willReadFrequently: true });
      cc.imageSmoothingEnabled = false;
      cc.drawImage(o, Math.floor((CELL - w) / 2), CELL - h, w, h);
      const d = cc.getImageData(0, 0, CELL, CELL);
      for (let p = 0; p < d.data.length; p += 4) { // transparent -> atlas key colour
        if (d.data[p + 3] < 128) { d.data[p] = 71; d.data[p + 1] = 108; d.data[p + 2] = 108; }
        d.data[p + 3] = 255;
      }
      cc.putImageData(d, 0, 0);
      ctx.drawImage(cell, cx, cy);
      this.overrideUV[tile] = [cx, cy, cx + CELL, cy + CELL];
    });
    this.atlasCanvas = c; // CPU copy (the skin and block textures are drawn into it too)
    this.atlasKey = (this.atlasKey || 0) + 1;
    this.atlasW = c.width;
    this.atlasH = c.height;
    this.skinY = rows * TS;
    this.cols = meta.cols;
    this.ts = TS;
    this.tw = TS / c.width;
    this.th = TS / c.height;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // ---- procedural galaxy sky (SKY_FS), drawn as a full-screen triangle
  initSky() {
    const gl = this.gl;
    const sh = (type, src) => {
      const x = gl.createShader(type);
      gl.shaderSource(x, src);
      gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x));
      return x;
    };
    const p = (this.skyProg = gl.createProgram());
    gl.attachShader(p, sh(gl.VERTEX_SHADER, SKY_VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, SKY_FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.skyU = {};
    for (const n of ['uRight', 'uUp', 'uFwd', 'uTan', 'uTime', 'uDay', 'uSpace']) this.skyU[n] = gl.getUniformLocation(p, n);
    this.skyVao = gl.createVertexArray();
    gl.bindVertexArray(this.skyVao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  drawSky(yaw, pitch, aspect) {
    const gl = this.gl;
    if (!this.skyProg) this.initSky();
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const f = [sy * cp, sp, -cy * cp], r = [cy, 0, sy];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const t = Math.tan((this.fov * Math.PI) / 360);
    gl.useProgram(this.skyProg);
    gl.uniform3fv(this.skyU.uRight, r);
    gl.uniform3fv(this.skyU.uUp, u);
    gl.uniform3fv(this.skyU.uFwd, f);
    gl.uniform2f(this.skyU.uTan, t * aspect, t);
    gl.uniform1f(this.skyU.uTime, performance.now() / 1000);
    gl.uniform1f(this.skyU.uDay, this.daySky ? 1 : 0);
    gl.uniform1f(this.skyU.uSpace, this.spaceBelow ? 1 : 0);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }

  // the 64x64 Minecraft skin used by the player model
  setMinecraftSkin(canvas64) {
    const gl = this.gl;
    if (this.atlasCanvas) this.atlasCanvas.getContext('2d').drawImage(canvas64, 0, this.skinY);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, this.skinY, gl.RGBA, gl.UNSIGNED_BYTE, canvas64);
  }

  // quad textured from a rectangle of the Minecraft skin (skin pixel coords)
  quadUV(out, p0, p1, p2, p3, [u0, v0, u1, v1], shade, key = 0) {
    const e = 0.02;
    const U0 = (u0 + e) / this.atlasW, U1 = (u1 - e) / this.atlasW;
    const V0 = (this.skinY + v0 + e) / this.atlasH, V1 = (this.skinY + v1 - e) / this.atlasH;
    const v = (p, u, w) => out.push(p[0], p[1], p[2], u, w, shade, key, 0);
    v(p0, U0, V0); v(p1, U1, V0); v(p2, U1, V1);
    v(p0, U0, V0); v(p2, U1, V1); v(p3, U0, V1);
  }

  // overwrite one atlas slot (used for the custom player skin)
  // (16px textures are scaled up, pixel for pixel, to a bigger tileset's size)
  setTile(t, canvas16) {
    const gl = this.gl, TS = this.ts || 16;
    let img = canvas16;
    if (img.width !== TS) {
      img = document.createElement('canvas');
      img.width = img.height = TS;
      const x = img.getContext('2d');
      x.imageSmoothingEnabled = false;
      x.drawImage(canvas16, 0, 0, TS, TS);
    }
    if (this.atlasCanvas) this.atlasCanvas.getContext('2d').drawImage(img, (t % this.cols) * TS, Math.floor(t / this.cols) * TS);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, (t % this.cols) * TS, Math.floor(t / this.cols) * TS, gl.RGBA, gl.UNSIGNED_BYTE, img);
  }

  makeMesh() {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const st = FLOATS * 4;
    gl.enableVertexAttribArray(this.a.pos);
    gl.vertexAttribPointer(this.a.pos, 3, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(this.a.uv);
    gl.vertexAttribPointer(this.a.uv, 2, gl.FLOAT, false, st, 12);
    gl.enableVertexAttribArray(this.a.misc);
    gl.vertexAttribPointer(this.a.misc, 3, gl.FLOAT, false, st, 20);
    gl.bindVertexArray(null);
    return { vao, buf, count: 0 };
  }

  upload(mesh, arr) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW);
    mesh.count = arr.length / FLOATS;
  }

  tileUV(t) {
    const o = this.overrideUV && this.overrideUV[t];
    if (o) return [(o[0] + 0.05) / this.atlasW, (o[1] + 0.05) / this.atlasH, (o[2] - 0.05) / this.atlasW, (o[3] - 0.05) / this.atlasH];
    const e = 0.01; // inset in texels to avoid bleeding
    const c = t % this.cols, r = Math.floor(t / this.cols);
    const du = this.tw / this.ts, dv = this.th / this.ts;
    return [c * this.tw + e * du, r * this.th + e * dv, (c + 1) * this.tw - e * du, (r + 1) * this.th - e * dv];
  }

  // push a quad: corners p0..p3 (top-left, top-right, bottom-right, bottom-left)
  quad(out, p0, p1, p2, p3, t, shade, key = 0, gray = 0, flipU = false) {
    let [u0, v0, u1, v1] = this.tileUV(t);
    if (flipU) [u0, u1] = [u1, u0];
    const v = (p, u, w) => out.push(p[0], p[1], p[2], u, w, shade, key, gray);
    v(p0, u0, v0); v(p1, u1, v0); v(p2, u1, v1);
    v(p0, u0, v0); v(p2, u1, v1); v(p3, u0, v1);
  }

  // A block spanning [x,x+1]x[y0,y1]x[z,z+1]; faces[] says which sides to emit.
  // (tile: one for all the sides, or {n, s, w, e, bottom})
  block(out, x, z, y0, y1, tile, shade, cull, topTile = tile) {
    const X0 = x, X1 = x + 1, Z0 = z, Z1 = z + 1;
    const t = typeof tile === 'object' ? tile : { n: tile, s: tile, w: tile, e: tile, bottom: tile };
    if (!cull.n) this.quad(out, [X1, y1, Z0], [X0, y1, Z0], [X0, y0, Z0], [X1, y0, Z0], t.n, shade * 0.8);
    if (!cull.s) this.quad(out, [X0, y1, Z1], [X1, y1, Z1], [X1, y0, Z1], [X0, y0, Z1], t.s, shade * 0.8);
    if (!cull.w) this.quad(out, [X0, y1, Z0], [X0, y1, Z1], [X0, y0, Z1], [X0, y0, Z0], t.w, shade * 0.62);
    if (!cull.e) this.quad(out, [X1, y1, Z1], [X1, y1, Z0], [X1, y0, Z0], [X1, y0, Z1], t.e, shade * 0.62);
    if (!cull.top) this.quad(out, [X0, y1, Z0], [X1, y1, Z0], [X1, y1, Z1], [X0, y1, Z1], topTile, shade);
    if (cull.bottom === false) this.quad(out, [X0, y0, Z1], [X1, y0, Z1], [X1, y0, Z0], [X0, y0, Z0], t.bottom, shade * 0.5);
  }

  // axis-aligned box with its own tile per face {n, s, w, e, top}
  box(out, x0, y0, z0, x1, y1, z1, t, shade, key = 0) {
    this.quad(out, [x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0], t.n, shade * 0.8, key);
    this.quad(out, [x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1], t.s, shade * 0.8, key);
    this.quad(out, [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0], t.w, shade * 0.62, key);
    this.quad(out, [x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1], t.e, shade * 0.62, key);
    this.quad(out, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], t.top, shade, key);
  }

  floor(out, x, z, y, tile, shade, key = 0) {
    this.quad(out, [x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1], tile, shade, key);
  }

  // Rebuild the static terrain mesh from the map state.
  buildTerrain(world, opts) {
    const out = [];
    const W = world.w, H = world.h;
    const cls = world.classes;
    // is the block at (x, y, level) solid?  used to skip hidden faces
    const cutType = (t) => PARTIAL.has(t);
    const solidAt = (x, y, lvl) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const bt = world.blocks && world.blocks.get(x, lvl, y);
      if (bt) return !cutType(bt);
      if (lvl >= WALL_H) return false;
      const c = cls[y * W + x];
      if (!c) return false;
      if (c.type === 'wall' || c.type === 'rock' || c.type === 'door') return true;
      return lvl >= DOOR_H && !!c.lintel;
    };
    const T = this.slots || {};
    // wall columns: the game's wall tile (battlements) on top, plain brick below
    const wallLayer = (l, topTile) => (l === WALL_H - 1 || T.wallBrick == null ? topTile : T.wallBrick);
    const hx = world.hero.x, hy = world.hero.y;
    const WALL_TILE = wallTile();
    // dungeon levels are a brick maze out in the open: grey studded floors (the
    // grey of the walls' tops) on a grey baseplate, grey brick walls (and the rock you've seen round the
    // corridors: walled lanes), wooden brick doors, and haze over everything
    // not yet explored (a path you haven't followed yet fades into it)
    const brickLevel = true; // (every level is: the dungeon, Ascend's baseplate)
    // what the BrickWorld builds: floor plates, walls, doors, fog
    const bricks = { w: W, h: H, floors: [], walls: [], doors: [], fog: [], pools: [], stairs: [], style: world.style || null }; // (style: the Mines')
    // a square of fog; `into`: the known squares beside it that wisps drift into ([dx, dz]...)
    const passable = (xx, yy) => {
      const n = xx >= 0 && yy >= 0 && xx < W && yy < H && cls[yy * W + xx];
      return !!n && n.type !== 'none' && n.type !== 'wall' && n.type !== 'rock';
    };
    const known = (xx, yy) => {
      const n = xx >= 0 && yy >= 0 && xx < W && yy < H && cls[yy * W + xx];
      return !!n && n.type !== 'none' && n.type !== 'rock';
    };
    const solid = (xx, yy) => {
      const n = xx >= 0 && yy >= 0 && xx < W && yy < H && cls[yy * W + xx];
      return !!n && (n.type === 'wall' || (n.type === 'rock' && n.known) || n.type === 'door');
    };
    // (fog only where it's near what you know: an unknown square within FOG_REACH squares of one you've seen, the
    // rest of the level left dark, not a whole map's worth of it)
    const seenNear = new Uint8Array(W * H);
    for (let yy = 0; yy < H; yy++)
      for (let xx = 0; xx < W; xx++) { const n = cls[yy * W + xx]; if (n && (known(xx, yy) || (n.type === 'rock' && n.known))) seenNear[yy * W + xx] = 1; }
    for (let k = 0; k < FOG_REACH; k++) { // (grown a square each way, each time)
      const was = seenNear.slice();
      for (let yy = 0; yy < H; yy++)
        for (let xx = 0; xx < W; xx++) {
          if (was[yy * W + xx]) continue;
          for (let dy = -1; dy <= 1 && !seenNear[yy * W + xx]; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const ax = xx + dx, ay = yy + dy;
              if (ax >= 0 && ay >= 0 && ax < W && ay < H && was[ay * W + ax]) { seenNear[yy * W + xx] = 1; break; }
            }
        }
    }
    // over: the walls it can pour over (a floor you can walk on just beyond)
    const fogAt = (x, y) => {
      if (!seenNear[y * W + x]) return;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const into = dirs.filter(([dx, dy]) => passable(x + dx, y + dy));
      const over = dirs.filter(([dx, dy]) => solid(x + dx, y + dy) && passable(x + 2 * dx, y + 2 * dy));
      let near = into.length > 0;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) near = known(x + dx, y + dy);
      bricks.fog.push({ x, z: y, into, over, near });
    };
    // a door piece in its square, across the wall it stands in; on a row of the
    // floor's studs (a 4x4 plate: studs at 1/8, 3/8...; the frame's one stud deep,
    // so an eighth off the middle, across the wall)
    const doorPiece = (x, y, name, alongZ, shade) =>
      bricks.doors.push({ url: PARTS[name], matrix: partMatrix(x + 0.5 + (alongZ ? 0.125 : 0), DOOR_TOP, y + 0.5 + (alongZ ? 0 : 0.125), alongZ ? Math.PI / 2 : 0), shade });
    const wallAt = (xx, yy) => { const n = xx >= 0 && yy >= 0 && xx < W && yy < H && cls[yy * W + xx]; return !!n && n.type === 'wall'; };
    // a doorway's wall runs north-south when it has wall north or south of it
    const doorAlongZ = (x, y, c) => (c.cmap === CM.vcdoor || c.cmap === CM.vodoor ? true
      : c.cmap === CM.hcdoor || c.cmap === CM.hodoor ? false : wallAt(x, y - 1) || wallAt(x, y + 1));
    // the Castle (King Skelly's): its outer walls, the ones on the moat, rise
    // high with battlements, and its four corner towers higher still (rise 1,
    // 2: brickworld.js); the walls inside stay as they are
    const castle = brickLevel && world.castle;
    const castleRise = (x, y) => {
      if (!castle) return 0;
      const [x0, y0, x1, y1] = castle;
      if (x < x0 || x > x1 || y < y0 || y > y1) return 0;
      if ((x - x0 <= 6 || x1 - x <= 6) && (y - y0 <= 3 || y1 - y <= 3)) return 2;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const n = cls[(y + dy) * W + x + dx];
          if (n && n.type === 'liquid') return 1;
        }
      return 0;
    };
    // dark: a dark room's floor (world.litAt 'd'); a wall, door or rock beside one, and beside no lit floor
    const darkAt = (x, y, c) => {
      const l = world.litAt(x, y);
      if (l === 'd') return true;
      if (l === 'l' || !(c.type === 'wall' || c.type === 'rock' || c.type === 'door' || c.type === 'odoor' || c.cmap === CM.ndoor)) return false;
      let dark = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = world.litAt(x + dx, y + dy); if (n === 'l') return false; if (n === 'd') dark = true; }
      return dark;
    };
    // plain floors get a studded plate; any other floor tile (stairs, an altar's square...) a smooth one, printed
    const plainFloor = new Set([CM.room, CM.darkroom, CM.corr, CM.litcorr, CM.ndoor].map(cmapTile));

    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = cls[y * W + x];
        if (brickLevel && (!c || (c.type === 'none' && c.cmap !== CM.air))) { fogAt(x, y); continue; }
        if (!c || c.type === 'none') continue;
        const d = Math.hypot(x - hx, y - hy);
        let shade = c.seen ? 1.0 : brickLevel ? 0.62 : 0.42;
        shade *= Math.max(brickLevel ? 0.75 : 0.55, Math.min(1, 1.25 - d / 16));
        // a dark room (the engine's: not lit): dark, but for the light about you (what you see of it, by your own light or a
        // lamp's), falling off with the distance; a wall dark with it, where it's beside dark floor and none lit
        if (brickLevel && darkAt(x, y, c)) shade = c.seen ? Math.max(0.3, Math.min(1, 1.15 - d * 0.3)) : 0.13;
        const blockTile = opts.wallStyle === 'exact' && c.type === 'wall' ? c.tile : WALL_TILE;
        const cull = (lvl) => ({
          n: solidAt(x, y - 1, lvl), s: solidAt(x, y + 1, lvl),
          w: solidAt(x - 1, y, lvl), e: solidAt(x + 1, y, lvl),
          top: solidAt(x, y, lvl + 1),
          bottom: lvl === 0 || solidAt(x, y, lvl - 1), // e.g. the wall over a doorway shows its underside
        });
        // a column of blocks from level `from` up to the wall top
        const column = (from, tile, sh, tileFor, to = WALL_H) => {
          for (let l = from; l < to; l++) this.block(out, x, y, l, l + 1, tileFor ? tileFor(l) : tile, sh, cull(l));
        };
        switch (c.type) {
          case 'wall':
            if (brickLevel) bricks.walls.push({ x, z: y, shade, rise: castleRise(x, y) });
            else column(0, null, shade, (l) => wallLayer(l, blockTile));
            break;
          case 'rock': // known rock is wall; rock nobody has seen yet is fog
            if (brickLevel) { if (c.known) bricks.walls.push({ x, z: y, shade }); else fogAt(x, y); }
            else column(0, T.stone ?? WALL_TILE, 0.45);
            break;
          case 'door': // closed door: a two-block door with wall above (brick: a 1x4x6 door, shut)
            if (brickLevel) { bricks.floors.push({ x, z: y, shade, studs: true }); doorPiece(x, y, 'door_closed', doorAlongZ(x, y, c), shade); }
            else column(0, null, shade, (l) => (l < DOOR_H ? c.tile : wallLayer(l, WALL_TILE)));
            break;
          case 'liquid': // (brick: water is a hole in the floor heaped with roiling clear blue studs; lava, glowing orange ones)
            if (brickLevel) bricks.pools.push({ x, z: y, shade, lava: c.cmap === CM.lava });
            else this.floor(out, x, y, -0.12, c.tile, shade);
            break;
          default:
            if (brickLevel) {
              // a studded plate in the floor's colour; a special floor (stairs, an
              // altar's square...) is a smooth plate with its tile printed on top
              const ft = c.floorTile ?? c.tile, plain = plainFloor.has(ft);
              // (stairs: built in brick, running toward a wall beside them: up, out of the floor; down, a hole in it)
              const stair = c.cmap === CM.upstair ? 'up' : c.cmap === CM.dnstair ? 'down' : null;
              if (stair) bricks.stairs.push({ x, z: y, up: stair === 'up', turn: world.backToWall ? world.backToWall(x, y) : 0, shade });
              // (a trap in brick (world.js): no picture of it on the floor; a pit, a hole, a trap door: no floor, its shaft down)
              const trapB = c.trap != null && TRAP_ITEMS[c.trap] && brickBuilt(TRAP_ITEMS[c.trap]);
              if (stair !== 'down' && !(trapB && trapB.sunk)) bricks.floors.push({ x, z: y, shade, studs: plain || !!stair || c.cmap === CM.altar });
              if (!plain && !stair && c.cmap !== CM.altar && !(trapB && trapB.sunk)) this.floor(out, x, y, 0.002, ft, shade); // (an altar: built in brick, world.js)
              if (c.decal != null && !trapB) this.floor(out, x, y, STUD_H + 0.005, c.decal, shade, 1);
              // an open door swung back in its frame; a doorway (no door, or a broken one): the frame alone
              if (c.type === 'odoor') doorPiece(x, y, 'door_open', doorAlongZ(x, y, c), shade);
              else if (c.cmap === CM.ndoor) doorPiece(x, y, 'doorway', doorAlongZ(x, y, c), shade);
            } else this.floor(out, x, y, 0, c.floorTile ?? c.tile, shade);
            if (c.decal != null && !brickLevel) this.floor(out, x, y, 0.01, c.decal, shade, 1);
            if (c.lintel && !brickLevel) column(DOOR_H, null, shade, (l) => wallLayer(l, WALL_TILE)); // (brick: the BrickWorld's own stone over the door)
            if (c.chest && T.chestSide != null && !brickLevel) {
              // NetHack chests and boxes as Minecraft-style chest blocks (a brick level: never; its brick model, world.js)
              const m = 0.0625;
              this.box(out, x + m, 0, y + m, x + 1 - m, 0.875, y + 1 - m,
                { n: T.chestSide, s: T.chestFront, w: T.chestSide, e: T.chestSide, top: T.chestTop }, shade);
            }
            if (c.type === 'odoor' && !brickLevel) {
              // swung-open door panel along one edge of the doorway, two blocks tall
              for (let l = 0; l < DOOR_H; l++) {
                const a = l + 1, b = l;
                if (c.cmap === CM.vodoor) {
                  this.quad(out, [x, a, y + 0.02], [x + 1, a, y + 0.02], [x + 1, b, y + 0.02], [x, b, y + 0.02], c.tile, shade * 0.8, 1);
                  this.quad(out, [x + 1, a, y + 0.02], [x, a, y + 0.02], [x, b, y + 0.02], [x + 1, b, y + 0.02], c.tile, shade * 0.8, 1);
                } else {
                  this.quad(out, [x + 0.02, a, y + 1], [x + 0.02, a, y], [x + 0.02, b, y], [x + 0.02, b, y + 1], c.tile, shade * 0.62, 1);
                  this.quad(out, [x + 0.02, a, y], [x + 0.02, a, y + 1], [x + 0.02, b, y + 1], [x + 0.02, b, y], c.tile, shade * 0.62, 1);
                }
              }
            }
        }
      }
    this.upload(this.terrain, out);
    // the baseplate under the whole level, a plate below the floors
    this.brickOn = brickLevel;
    if (brickLevel) this.brick.setTerrain(bricks);
    // placed blocks: their own mesh
    this.buildBlocks(world, solidAt, T, hx, hy);
  }

  buildBlocks(world, solidAt, T, hx, hy) {
    const out = [];
    if (world.blocks && T.dirt != null) {
      for (const b of world.blocks.all()) {
        let tile, top, cut = false;
        if (b.type === 'ladder') {
          // a flat ladder against the wall next to it (both sides visible)
          // (the side with blocks next to the ladder, at any height: a platform's slab)
          const wall = [[0, -1], [0, 1], [-1, 0], [1, 0]].find(([dx, dz]) => {
            for (let y = 0; y < 16; y++) { const t = world.blocks.get(b.x + dx, y, b.z + dz); if (t && t !== 'ladder') return true; }
            return false;
          }) || [0, -1];
          const [dx, dz] = wall, y0 = b.y, y1 = b.y + 1, f = 0.06;
          let p;
          if (dz) { const z = b.z + (dz > 0 ? 1 - f : f); p = [[b.x, y1, z], [b.x + 1, y1, z], [b.x + 1, y0, z], [b.x, y0, z]]; }
          else { const x = b.x + (dx > 0 ? 1 - f : f); p = [[x, y1, b.z + 1], [x, y1, b.z], [x, y0, b.z], [x, y0, b.z + 1]]; }
          this.quad(out, p[0], p[1], p[2], p[3], T.ladder, 1, 1);
          this.quad(out, p[1], p[0], p[3], p[2], T.ladder, 1, 1);
          continue;
        } else if (b.type === 'roofN' || b.type === 'roofS') {
          this.wedge(out, b.x, b.y, b.z, b.type === 'roofN', T.roof, T.planks);
          continue;
        } else if (b.type === 'fence' || b.type === 'gate' || b.type === 'gateOpen') {
          this.fence(out, world.blocks, b, b.type === 'fence' ? T.planks : T.gateWood ?? T.planks);
          continue;
        } else if (LYING[b.type]) {
          const along = LYING[b.type], ring = T.logTop, bark = T.logBark ?? T.logSide, barkZ = T.logSide;
          // bark stripes run along the log: the turned bark on faces that run along x, the upright one on those along z
          tile = along === 'x' ? { n: bark, s: bark, w: ring, e: ring, bottom: bark } : { n: ring, s: ring, w: bark, e: bark, bottom: barkZ };
          top = along === 'x' ? bark : barkZ;
        } else if (b.type === 'leaves') {
          // leaves: one of three textures, by position, so a canopy doesn't repeat
          const v = ((b.x * 73856093) ^ (b.y * 19349663) ^ (b.z * 83492791)) >>> 0;
          tile = top = T[['leaves', 'leaves1', 'leaves2'][v % 3]] ?? T.leaves;
        } else { const f = FACES[b.type] || ['dirt']; tile = T[f[0]] ?? T.dirt; top = T[f[1] || f[0]] ?? tile; cut = CUTOUT.has(b.type); }
        const d = Math.hypot(b.x - hx, b.z - hy);
        const shade = Math.max(0.55, Math.min(1, 1.25 - d / 16));
        const n0 = out.length;
        this.block(out, b.x, b.z, b.y, b.y + 1, tile, shade, {
          n: solidAt(b.x, b.z - 1, b.y), s: solidAt(b.x, b.z + 1, b.y),
          w: solidAt(b.x - 1, b.z, b.y), e: solidAt(b.x + 1, b.z, b.y),
          top: solidAt(b.x, b.z, b.y + 1),
          bottom: b.y === 0 || solidAt(b.x, b.z, b.y - 1),
        }, top);
        if (cut) for (let i = n0 + 6; i < out.length; i += 8) out[i] = 1; // see-through pixels
      }
    }
    this.upload(this.blockMesh, out);
  }

  // the texture slots of a block type: [sides, top]
  blockTiles(type) {
    const T = this.slots || {};
    const f = FACES[type] || ['dirt'];
    const side = T[f[0]] ?? T.dirt;
    return [side, T[f[1] || f[0]] ?? side];
  }

  // a little block (a dropped item): size `s`, centred on (x, z) with its
  // bottom at y, turned `a` radians round the vertical
  miniBlock(out, x, y, z, s, a, type) {
    const [side, top] = this.blockTiles(type);
    if (side == null) return;
    const h = s / 2, c = Math.cos(a), n = Math.sin(a);
    const P = (dx, dy, dz) => [x + dx * c - dz * n, y + dy, z + dx * n + dz * c];
    const p = [P(-h, s, -h), P(h, s, -h), P(h, s, h), P(-h, s, h), P(-h, 0, -h), P(h, 0, -h), P(h, 0, h), P(-h, 0, h)];
    this.quad(out, p[0], p[1], p[2], p[3], top, 1.1); // top
    this.quad(out, p[0], p[1], p[5], p[4], side, 0.9);
    this.quad(out, p[1], p[2], p[6], p[5], side, 0.75);
    this.quad(out, p[2], p[3], p[7], p[6], side, 0.9);
    this.quad(out, p[3], p[0], p[4], p[7], side, 0.75);
    this.quad(out, p[7], p[6], p[5], p[4], side, 0.55); // bottom
  }

  // a sloped roof block: the slope rises one block across it, towards the
  // south (north: true, its low edge on the north side) or the north; drawn
  // from both sides so the eaves look right from below
  wedge(out, x, y, z, north, roofT, underT) {
    const lo = north ? z : z + 1, hi = north ? z + 1 : z;
    const both = (p0, p1, p2, p3, t, sh) => { this.quad(out, p0, p1, p2, p3, t, sh); this.quad(out, p1, p0, p3, p2, t, sh); };
    both([x, y + 1, hi], [x + 1, y + 1, hi], [x + 1, y, lo], [x, y, lo], roofT, 1); // the slope
    both([x, y + 1, hi], [x + 1, y + 1, hi], [x + 1, y, hi], [x, y, hi], underT, 0.8); // the tall back
    both([x, y, lo], [x + 1, y, lo], [x + 1, y, hi], [x, y, hi], underT, 0.55); // underneath
    // the triangular gable sides (a quad with two corners together)
    both([x, y + 1, hi], [x, y + 1, hi], [x, y, lo], [x, y, hi], underT, 0.65);
    both([x + 1, y + 1, hi], [x + 1, y + 1, hi], [x + 1, y, hi], [x + 1, y, lo], underT, 0.65);
  }

  // Minecraft-style fence posts and rails, and the paddock gate (open: swung
  // back against the fence beside it)
  fence(out, blocks, b, t) {
    const { x, y, z, type } = b;
    const T = { n: t, s: t, w: t, e: t, top: t };
    const joins = (dx, dz) => {
      const n = blocks.get(x + dx, y, z + dz);
      return n === 'fence' || n === 'gate' || n === 'gateOpen' || n === 'log'; // (rails meet the log panel too)
    };
    if (type === 'fence') {
      this.box(out, x + 0.38, y, z + 0.38, x + 0.62, y + 1.5, z + 0.62, T, 0.95);
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (!joins(dx, dz)) continue;
        for (const [r0, r1] of [[0.55, 0.72], [1.1, 1.27]]) {
          const ax = dx ? [dx < 0 ? x : x + 0.5, dx < 0 ? x + 0.5 : x + 1] : [x + 0.44, x + 0.56];
          const az = dz ? [dz < 0 ? z : z + 0.5, dz < 0 ? z + 0.5 : z + 1] : [z + 0.44, z + 0.56];
          this.box(out, ax[0], y + r0, az[0], ax[1], y + r1, az[1], T, 0.9);
        }
      }
      return;
    }
    // the gate runs along the fence: along x if it joins fences east/west
    const alongX = joins(-1, 0) || joins(1, 0);
    // open, it swings 90 degrees on its hinge into the paddock side
    const ax = alongX !== (type === 'gateOpen');
    const bars = [[0.05, 0.18], [0.44, 0.56], [0.82, 0.95]];
    const rails = [[0.4, 0.55], [1.05, 1.2]];
    const span = (u0, u1, v0, v1, ya, yb) => (ax
      ? this.box(out, x + u0, y + ya, z + v0, x + u1, y + yb, z + v1, T, 0.85)
      : this.box(out, x + v0, y + ya, z + u0, x + v1, y + yb, z + u1, T, 0.85));
    const c = type === 'gateOpen' ? [0.04, 0.16] : [0.44, 0.56]; // closed: in the fence line; open: against the edge
    for (const [u0, u1] of bars) span(u0, u1, c[0], c[1], 0, 1.35);
    for (const [ya, yb] of rails) span(0.05, 0.95, c[0], c[1], ya, yb);
  }

  // block-cracking overlay: boxes = [[x0,y0,z0,x1,y1,z1], ...], stage 0..9
  setCracks(boxes, stage) {
    const out = [];
    const t = this.slots && this.slots['crack' + Math.max(0, Math.min(9, stage))];
    if (t != null && boxes) {
      const e = 0.003;
      for (const [x0, y0, z0, x1, y1, z1] of boxes) {
        // one layer of faces per block so the crack keeps its pixel scale
        for (let y = y0; y < y1; y++)
          this.box(out, x0 - e, y - e, z0 - e, x1 + e, y + 1 + e, z1 + e, { n: t, s: t, w: t, e: t, top: t }, 1, 1);
      }
    }
    this.upload(this.overlay, out);
  }

  // Camera-facing (around Y) sprites, rebuilt every frame.
  buildSprites(list, yaw, extra) {
    const out = [];
    if (extra) extra(out); // e.g. the player model
    const rx = Math.cos(yaw), rz = Math.sin(yaw);
    for (const s of list) {
      const h = s.size * (s.sy || 1), w2 = (s.size / 2) * (s.sx || 1);
      const cx = s.x + 0.5, cz = s.z + 0.5, y0 = s.lift || 0;
      // a corner at (u along the screen, v up), tilted round the sprite's feet
      const ct = Math.cos(s.tilt || 0), st = Math.sin(s.tilt || 0);
      const P = (u, v) => { const uu = u * ct - v * st, vv = u * st + v * ct; return [cx + rx * uu, y0 + vv, cz + rz * uu]; };
      this.quad(out, P(-w2, h), P(w2, h), P(w2, 0), P(-w2, 0), s.tile, s.shade, 1, s.gray ? 1 : 0, s.flip);
    }
    this.upload(this.sprites, out);
  }

  // Minecraft-style block selection outline
  setOutline(box) {
    if (!box) { this.lines.count = 0; return; }
    const [x0, y0, z0, x1, y1, z1] = box;
    const P = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    const E = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
    const out = [];
    for (const i of E) out.push(...P[i], 0, 0, 1, 0, 0);
    this.upload(this.lines, out);
  }

  draw(eye, yaw, pitch, outlineColor) {
    const gl = this.gl, c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(c.clientWidth * dpr), h = Math.floor(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.proj = mat4Perspective((this.fov * Math.PI) / 180, w / h, 0.05, this.far || 200); // (how far is drawn: less in Ascend)
    this.view = mat4View(eye, yaw, pitch);
    if (this.brickOn) {
      // a brick level: the BrickWorld draws the world (and clears to its sky blue); our pass draws on top
      this.brick.setDistance(this.far && this.far < 200 ? this.far : 0); // (drawn less far: hazing out at the end)
      this.brick.setFigures(this.brickFigures.filter((f) => f.url));
      this.brick.setItems(this.brickItems || []);
      this.brick.render(this.proj, this.view, w, h, this.focus);
      gl.viewport(0, 0, w, h);
    } else {
      gl.viewport(0, 0, w, h);
      gl.clearColor(...this.fog, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (this.showSky !== false) this.drawSky(yaw, pitch, w / h);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CW);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uProj, false, this.proj);
    gl.uniformMatrix4fv(this.u.uView, false, this.view);
    gl.uniform3fv(this.u.uFog, this.fog);
    gl.uniform2f(this.u.uFogRange, ...(this.fogRange || [10, 30]));
    gl.uniform4f(this.u.uSolid, 0, 0, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.u.uTex, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const m of [this.terrain, this.blockMesh]) {
      gl.bindVertexArray(m.vao);
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
    }
    if (this.overlay.count) {
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -1);
      gl.bindVertexArray(this.overlay.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.overlay.count);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    // the brick pass (its own shader), then back to ours
    if (!this.brickOn && this.brickFigures.length) { // (a minifig on a block level: Ascend)
      this.figRender.fog = this.fog;
      this.figRender.fogRange = this.fogRange || [10, 30];
      this.figRender.draw(this.proj, this.view, this.brickFigures);
      gl.useProgram(this.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
    }
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.sprites.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.sprites.count);
    if (this.lines.count) {
      gl.uniform4f(this.u.uSolid, ...(outlineColor || [0, 0, 0, 1]));
      gl.bindVertexArray(this.lines.vao);
      gl.drawArrays(gl.LINES, 0, this.lines.count);
    }
    // first person: the hero's own right arm and what it holds, last of all
    // and in front of everything (its own depth), in the corner of the view
    if (this.fpArm && this.fpArm.length) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.CULL_FACE);
      this.figRender.fog = this.fog;
      this.figRender.fogRange = [1e4, 2e4];
      const fp = mat4Perspective((70 * Math.PI) / 180, w / h, 0.01, 10);
      this.figRender.draw(fp, FP_VIEW, this.fpArm, true);
    }
    gl.bindVertexArray(null);
  }

  // ray through a screen point (pixels, CSS) -> origin + direction in world
  screenRay(eye, yaw, pitch, sx, sy) {
    const c = this.canvas;
    const nx = (sx / c.clientWidth) * 2 - 1, ny = 1 - (sy / c.clientHeight) * 2;
    const t = Math.tan((this.fov * Math.PI) / 360), asp = c.clientWidth / c.clientHeight;
    const cy = Math.cos(yaw), sy2 = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const f = [sy2 * cp, sp, -cy * cp], r = [cy, 0, sy2];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const d = [0, 1, 2].map((i) => f[i] + r[i] * nx * t * asp + u[i] * ny * t);
    const l = Math.hypot(...d);
    return { o: eye, d: d.map((v) => v / l) };
  }
}

const FP_VIEW = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); // (the first-person arm is placed in view space)

export { classify };

// LEGO rendering for the WebGL2 renderer: lit meshes from our .glb models
// (minifigs, built by tools/build_roster.py) and instanced bricks, plates and
// studs for the dungeon.
//
// Scale: a map square is a 4x4-stud cell, so 1 stud = 0.25 blocks = 20 LDU.
// A brick is 0.3 blocks tall (a wall is six: 1.8, the height of a 1x4x6
// door), a plate 0.1, and a minifig 1.3 blocks tall.
// The .glb models are in studs (20 LDU = 1), so they are drawn at scale 0.25.

import { MIST_GLSL, AURA_GLSL, AURA_COLOR, isMist, quantumPart, strobeHex, auraShells, tipOf } from './mist.js';

export const LDU = 1 / 80;
export const BRICK_H = 24 * LDU;
export const PLATE_H = 8 * LDU;
export const STUD_H = 4 * LDU;
export const STUD_R = 6 * LDU;
export const MODEL_SCALE = 0.25;
export const WALL_LAYERS = 6; // bricks in a wall
export const FIG_FEET = 72 / 20; // a minifig's feet are 72 LDU below its neck (the model's origin), in studs
export const FIG_HEIGHT = (72 + 32) * LDU; // feet to the top of a bare head: 1.3 blocks

// LDraw colours we build the dungeon from (sRGB, from LDConfig.ldr)
const hex = (h) => [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
export const COLORS = {
  green: hex('00852B'), // the floors and the baseplate under the level
  lightBluishGrey: hex('A0A5A9'), // walls
  darkBluishGrey: hex('6C6E68'),
  black: hex('1B2A34'),
};

const VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec2 aUV;
in vec4 iPos;   // instance: offset xyz, shade
in vec3 iSize;  // instance: size (scales the unit mesh)
in vec3 iCol;   // instance: colour
uniform mat4 uProj, uView, uModel;
out vec3 vNrm; out vec2 vUV; out vec3 vCol; out float vShade; out float vDist; out vec3 vLocal; out vec3 vSize; out vec3 vPos; out vec3 vVN; out vec3 vVP;
void main() {
  vPos = aPos;
  vec4 w = uModel * vec4(aPos * iSize + iPos.xyz, 1.0);
  vec4 p = uView * w;
  vDist = length(p.xyz);
  vNrm = mat3(uModel) * aNrm;
  vVN = mat3(uView) * vNrm; vVP = p.xyz;
  vUV = aUV; vCol = iCol; vShade = iPos.w;
  vLocal = aPos * iSize; vSize = iSize;
  gl_Position = uProj * p;
}`;

const FS = `#version 300 es
precision mediump float;
in vec3 vNrm; in vec2 vUV; in vec3 vCol; in float vShade; in float vDist; in vec3 vLocal; in vec3 vSize; in vec3 vPos; in vec3 vVN; in vec3 vVP;
uniform vec4 uColor;      // material colour (sRGB)
uniform sampler2D uTex; uniform float uHasTex;
uniform float uEdges;     // 1: darken a thin line round each face (brick seams)
uniform float uGlow;      // 1: a translucent part, lit from inside (flames, ice crystals)
uniform float uMist, uTime; // 1: a doppelganger's misty half (mist.js)
uniform float uAura;        // > 0: an angel's glow shell, this strong (mist.js), in uColor
uniform vec3 uFog; uniform vec2 uFogRange;
out vec4 o;
${MIST_GLSL}
${AURA_GLSL}
void main() {
  if (uAura > 0.0) {   // added on top (blended ONE, ONE): brightest at the outline
    float a = auraGlow(normalize(vVN), normalize(-vVP), uAura, uTime);
    o = vec4(uColor.rgb * a, 1.0);   // (the shell's colour: an angel's white, or the aura's own)
    return;
  }
  vec3 n = normalize(gl_FrontFacing ? vNrm : -vNrm);
  vec3 base = uColor.rgb * vCol;
  if (uHasTex > 0.5) base = texture(uTex, vUV).rgb;
  // a key light from above and to the side, a soft fill, and the sky
  float key = max(dot(n, normalize(vec3(0.45, 0.85, 0.3))), 0.0);
  float fill = max(dot(n, normalize(vec3(-0.5, 0.3, -0.6))), 0.0);
  float sky = 0.5 + 0.5 * n.y;
  vec3 col = base * (0.5 + 0.7 * key + 0.22 * fill + 0.18 * sky);
  if (uEdges > 0.5) {
    // distance to the nearest edge of this face: the middle of the three distances to the box's sides
    vec3 d = min(vLocal, vSize - vLocal);
    float e = d.x + d.y + d.z - min(d.x, min(d.y, d.z)) - max(d.x, max(d.y, d.z));
    col *= mix(0.62, 1.0, smoothstep(0.0, 0.018, e));
  }
  float alpha = uColor.a;
  if (uGlow > 0.5) {
    // translucent LEGO glows: mostly its own colour, brightest where it faces you
    col = base * (0.95 + 0.25 * key) + base * 0.35 * (1.0 - abs(n.y));
    alpha = 0.78;
  }
  if (uMist > 0.5) {
    float w = mistWave(vPos, uTime);
    col = base * (0.95 + 0.25 * key) * (0.8 + 0.5 * w);
    alpha = 0.28 + 0.4 * w;
  }
  col *= vShade;
  float f = clamp((vDist - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
  o = vec4(mix(col, uFog, f), alpha);
}`;

const lin2srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

// A unit box [0,1]^3, as triangles with face normals.
function boxMesh() {
  const pos = [], nrm = [];
  const face = (n, a, b, c, d) => { for (const p of [a, b, c, a, c, d]) { pos.push(...p); nrm.push(...n); } };
  face([0, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]);
  face([0, -1, 0], [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]);
  face([0, 0, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]);
  face([0, 0, -1], [0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]);
  face([1, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]);
  face([-1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]);
  return { pos, nrm };
}

// A stud: an octagonal cylinder of radius 1 and height 1, standing on y = 0,
// centred on x = z = 0 (scaled per instance), flat-shaded like the models.
function studMesh(sides = 8) {
  const pos = [], nrm = [];
  const P = (i) => { const a = (i / sides) * Math.PI * 2 + Math.PI / sides; return [Math.cos(a), Math.sin(a)]; };
  for (let i = 0; i < sides; i++) {
    const [x0, z0] = P(i), [x1, z1] = P(i + 1);
    const a = ((i + 0.5) / sides) * Math.PI * 2 + Math.PI / sides, n = [Math.cos(a), 0, Math.sin(a)];
    for (const p of [[x0, 0, z0], [x1, 0, z1], [x1, 1, z1], [x0, 0, z0], [x1, 1, z1], [x0, 1, z0]]) { pos.push(...p); nrm.push(...n); }
    for (const p of [[0, 1, 0], [x0, 1, z0], [x1, 1, z1]]) { pos.push(...p); nrm.push(0, 1, 0); }
  }
  return { pos, nrm };
}

// Parse a .glb (as written by tools/ldraw2glb.py): one mesh, primitives with
// POSITION, NORMAL, optional TEXCOORD_0 and a baseColorFactor or texture.
async function parseGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a .glb');
  let off = 12, json = null, bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
    else if (type === 0x004e4942) bin = buf.slice(off + 8, off + 8 + len);
    off += 8 + len;
  }
  const view = (i) => { const v = json.bufferViews[i]; return bin.slice(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength); };
  const floats = (a) => new Float32Array(view(json.accessors[a].bufferView));
  const prims = [];
  // a figure in joints has a mesh per joint (named: body, head, armR...; minifig-anim.js)
  for (const mesh of json.meshes) for (const p of mesh.primitives) {
    const mat = json.materials[p.material] || {};
    const pbr = mat.pbrMetallicRoughness || {};
    const f = pbr.baseColorFactor || [1, 1, 1, 1];
    let image = null;
    if (pbr.baseColorTexture) {
      const img = json.images[json.textures[pbr.baseColorTexture.index].source];
      image = await createImageBitmap(new Blob([view(img.bufferView)], { type: img.mimeType }), { imageOrientation: 'none' });
    }
    prims.push({
      pos: floats(p.attributes.POSITION), nrm: floats(p.attributes.NORMAL),
      uv: p.attributes.TEXCOORD_0 != null ? floats(p.attributes.TEXCOORD_0) : null,
      color: [lin2srgb(f[0]), lin2srgb(f[1]), lin2srgb(f[2]), f[3]], image, mist: isMist(mat), quantum: quantumPart(mat),
      group: mesh.name || null,
    });
  }
  const extras = (json.nodes && json.nodes[0] && json.nodes[0].extras) || {};
  // an angel: glow shells round the figure, a set per joint (drawn last, added on top)
  if (extras.aura) {
    const groups = [...new Set(prims.map((p) => p.group))];
    for (const g of groups) {
      const mine = prims.filter((p) => p.group === g);
      const all = new Float32Array(mine.reduce((n, p) => n + p.pos.length, 0));
      let at = 0;
      for (const p of mine) { all.set(p.pos, at); at += p.pos.length; }
      const cfg = typeof extras.aura === 'object' ? extras.aura : {};
      for (const sh of auraShells(tipOf(all, cfg.tip), cfg.scale ?? 1, cfg.layers)) prims.push({ pos: sh.pos, nrm: sh.nrm, uv: null, color: [...(cfg.color || AURA_COLOR), 0.5], image: null, aura: sh.strength * (cfg.strength ?? 1), group: g });
    }
  }
  prims.rig = extras.rig || null; // the joints, for the animation
  return prims;
}

const glbCache = new Map(); // url -> Promise<prims> (shared by every GL context)
export function loadGLB(url) {
  if (!glbCache.has(url)) glbCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.arrayBuffer(); }).then(parseGLB));
  return glbCache.get(url);
}

const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function mul4(a, b) { // column-major a * b
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

// model matrix: stand a figure's feet at (x, y, z), facing yaw (the game's
// yaw: 0 looks north, toward -Z), at LEGO scale
export function figureMatrix(x, y, z, yaw, scale = MODEL_SCALE) {
  return partMatrix(x, y + FIG_FEET * scale, z, Math.PI - yaw, scale);
}

// model matrix: a model's origin at (x, y, z), turned `turn` radians about Y
export function partMatrix(x, y, z, turn, scale = MODEL_SCALE) {
  const c = Math.cos(turn) * scale, s = Math.sin(turn) * scale;
  return new Float32Array([c, 0, -s, 0, 0, scale, 0, 0, s, 0, c, 0, x, y, z, 1]);
}

// The dungeon's LEGO pieces (tools/build_roster.py), and how high each one's
// origin sits above the floor: a door frame's origin is its top, six bricks up.
export const PARTS = {
  door_closed: 'assets/lego/parts/door_closed.glb',
  door_open: 'assets/lego/parts/door_open.glb',
  doorway: 'assets/lego/parts/doorway.glb',
};
export const DOOR_TOP = WALL_LAYERS * 24 * LDU;

export class Lego {
  constructor(gl) {
    this.gl = gl;
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
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.u = {};
    for (const n of ['uProj', 'uView', 'uModel', 'uColor', 'uTex', 'uHasTex', 'uEdges', 'uGlow', 'uMist', 'uAura', 'uTime', 'uFog', 'uFogRange']) this.u[n] = gl.getUniformLocation(p, n);
    this.a = {};
    for (const n of ['aPos', 'aNrm', 'aUV', 'iPos', 'iSize', 'iCol']) this.a[n] = gl.getAttribLocation(p, n);
    this.models = new Map(); // url -> Promise<[{vao, count, color, tex}]>
    this.box = this.instanced(boxMesh());
    this.stud = this.instanced(studMesh());
    this.fog = [0, 0, 0];
    this.fogRange = [10, 30];
  }

  // a static mesh (pos/nrm) drawn many times from an instance buffer
  instanced({ pos, nrm }) {
    const gl = this.gl, a = this.a;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = (data, loc, n) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
    };
    vb(pos, a.aPos, 3);
    vb(nrm, a.aNrm, 3);
    if (a.aUV >= 0) { gl.disableVertexAttribArray(a.aUV); }
    const inst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    const st = 10 * 4; // iPos(4) iSize(3) iCol(3)
    for (const [loc, n, o] of [[a.iPos, 4, 0], [a.iSize, 3, 16], [a.iCol, 3, 28]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, st, o);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    return { vao, inst, verts: pos.length / 3, count: 0 };
  }

  // set the instances of the box or stud mesh: flat array of
  // [x, y, z, shade, sx, sy, sz, r, g, b] per instance
  setInstances(mesh, data) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.inst);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    mesh.count = data.length / 10;
  }

  // upload a .glb's primitives into this GL context
  model(url) {
    if (!this.models.has(url)) this.models.set(url, loadGLB(url).then((prims) => Object.assign(prims.map((p) => this.uploadPrim(p)), { rig: prims.rig })));
    return this.models.get(url);
  }

  uploadPrim(p) {
    const gl = this.gl, a = this.a;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = (data, loc, n) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
    };
    vb(p.pos, a.aPos, 3);
    vb(p.nrm, a.aNrm, 3);
    if (p.uv && a.aUV >= 0) vb(p.uv, a.aUV, 2);
    gl.bindVertexArray(null);
    let tex = null;
    if (p.image) {
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, p.image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    return { vao, count: p.pos.length / 3, color: p.color, tex, mist: p.mist, quantum: p.quantum, aura: p.aura, group: p.group };
  }

  // the per-instance attributes as constants (for drawing a single model)
  single(shade) {
    const gl = this.gl, a = this.a;
    gl.vertexAttrib4f(a.iPos, 0, 0, 0, shade);
    gl.vertexAttrib3f(a.iSize, 1, 1, 1);
    gl.vertexAttrib3f(a.iCol, 1, 1, 1);
  }

  // Draw the instanced bricks and studs, then any models: [{prims, matrix, shade,
  // pose, only, skip}] (prims: the resolved result of model(url); pose: a matrix per
  // joint, minifig-anim.js; only: draw just these joints; skip: not these). figuresOnly: skip the bricks.
  draw(proj, view, figures = [], figuresOnly = false) {
    const gl = this.gl, u = this.u;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform3fv(u.uFog, this.fog);
    gl.uniform2fv(u.uFogRange, this.fogRange);
    const now = performance.now() / 1000;
    gl.uniform1f(u.uTime, now);
    gl.uniform1f(u.uMist, 0);
    gl.uniform1f(u.uAura, 0);
    gl.uniform1i(u.uTex, 0);
    gl.uniform1f(u.uHasTex, 0);
    gl.uniformMatrix4fv(u.uModel, false, IDENT);
    gl.uniform4f(u.uColor, 1, 1, 1, 1);
    gl.disable(gl.CULL_FACE);
    for (const [m, edges] of [[this.box, 1], [this.stud, 0]]) {
      if (!m.count || figuresOnly) continue;
      gl.uniform1f(u.uEdges, edges);
      gl.bindVertexArray(m.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, m.verts, m.count);
    }
    gl.uniform1f(u.uEdges, 0);
    // solid parts first, then the translucent ones (glowing, blended, not hiding what's behind)
    const pass = (glow) => {
      gl.uniform1f(u.uGlow, glow ? 1 : 0);
      for (const f of figures) {
        if (!f.prims) continue;
        gl.uniformMatrix4fv(u.uModel, false, f.matrix);
        // posed joints (minifig-anim.js): the figure's matrix times the joint's
        const posed = f.pose ? {} : null;
        let current = null;
        for (const p of f.prims) {
          if ((p.color[3] < 1) !== glow) continue;
          if (f.only && !f.only.includes(p.group)) continue;
          if (f.skip && f.skip.includes(p.group)) continue; // (a joint hidden: e.g. the hand's own item, something else held instead)
          if (posed && p.group !== current) {
            current = p.group;
            if (!(current in posed)) posed[current] = f.pose[current] ? mul4(f.matrix, f.pose[current]) : f.matrix;
            gl.uniformMatrix4fv(u.uModel, false, posed[current]);
          }
          gl.bindVertexArray(p.vao);
          this.single(f.shade ?? 1);
          if (p.quantum != null) {   // a quantum mechanic's part: flashing colours
            const h = strobeHex(p.quantum, now);
            gl.uniform4f(u.uColor, (h >> 16) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255, 1);
          } else gl.uniform4fv(u.uColor, p.color);
          gl.uniform1f(u.uMist, p.mist ? 1 : 0);
          gl.uniform1f(u.uAura, p.aura || 0);
          if (glow) gl.blendFunc(gl.SRC_ALPHA, p.aura ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
          gl.uniform1f(u.uHasTex, p.tex ? 1 : 0);
          if (p.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, p.tex); }
          gl.drawArrays(gl.TRIANGLES, 0, p.count);
        }
      }
    };
    pass(false);
    if (figures.some((f) => f.prims && f.prims.some((p) => p.color[3] < 1))) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      pass(true);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    gl.uniform1f(u.uGlow, 0);
    gl.uniform1f(u.uMist, 0);
    gl.uniform1f(u.uAura, 0);
    gl.bindVertexArray(null);
  }
}

// ---- the dungeon in bricks ---------------------------------------------
// Fills instance arrays for one map square. inst: {box: [], stud: []}
const GAP = 0.004; // a hair's gap between neighbouring bricks

// a wall: a foundation flush with the platform's underside, then courses of
// two 2x4 bricks, crossing direction every course like real LEGO masonry
export function wallColumn(inst, x, z, layers, color, shade, studsOnTop = true) {
  inst.box.push(x + GAP, -PLATE_H - BRICK_H, z + GAP, shade * 0.85, 1 - 2 * GAP, PLATE_H + BRICK_H - GAP, 1 - 2 * GAP, ...color);
  for (let l = 0; l < layers; l++) {
    const y = l * BRICK_H, h = BRICK_H - GAP;
    if (l % 2 === 0)
      for (const dz of [0, 0.5]) inst.box.push(x + GAP, y, z + dz + GAP, shade, 1 - 2 * GAP, h, 0.5 - 2 * GAP, ...color);
    else
      for (const dx of [0, 0.5]) inst.box.push(x + dx + GAP, y, z + GAP, shade, 0.5 - 2 * GAP, h, 1 - 2 * GAP, ...color);
  }
  if (studsOnTop) studs(inst, x, z, layers * BRICK_H, color, shade);
}

// one square of a platform: a plate on top of a brick, its top at y = 0
// (where the platform ends you see its edge drop away)
export function platform(inst, x, z, color, shade, withStuds = true) {
  inst.box.push(x + GAP, -PLATE_H, z + GAP, shade, 1 - 2 * GAP, PLATE_H - GAP, 1 - 2 * GAP, ...color);
  inst.box.push(x + GAP, -PLATE_H - BRICK_H, z + GAP, shade * 0.85, 1 - 2 * GAP, BRICK_H - GAP, 1 - 2 * GAP, ...color);
  if (withStuds) studs(inst, x, z, 0, color, shade);
}

// the sixteen studs on top of a 4x4 cell whose top is at height y
export function studs(inst, x, z, y, color, shade) {
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      inst.stud.push(x + (i + 0.5) / 4, y, z + (j + 0.5) / 4, shade, STUD_R, STUD_H, STUD_R, ...color);
}

// ---- camera helpers (for previews outside the game's renderer) ----------
export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

export function lookAt(eye, target) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, target)), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

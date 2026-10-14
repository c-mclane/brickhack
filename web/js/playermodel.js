// Minecraft-style player model ("doll") drawn from a standard 64x64 skin.
// Boxes use the usual skin layout; units are skin pixels, 32 px = 1.8 blocks.

const PX = 1.8 / 32;
export const KEY = [71, 108, 108]; // transparent pixels become the atlas key colour

// [name, texU, texV, overlayU, overlayV, x0, y0, z0, w, h, d, pivotY, limb]
// local axes: +x = model's right, +y = up, +z = forward
const PARTS = [
  ['head', 0, 0, 32, 0, -4, 24, -4, 8, 8, 8, 24, 'head'],
  ['body', 16, 16, 16, 32, -4, 12, -2, 8, 12, 4, 24, null],
  ['rarm', 40, 16, 40, 32, 4, 12, -2, 4, 12, 4, 22, 'rarm'],
  ['larm', 32, 48, 48, 48, -8, 12, -2, 4, 12, 4, 22, 'larm'],
  ['rleg', 0, 16, 0, 32, 0, 0, -2, 4, 12, 4, 12, 'rleg'],
  ['lleg', 16, 48, 0, 48, -4, 0, -2, 4, 12, 4, 12, 'lleg'],
];

// Bring any skin to the 64x64 layout; old 64x32 skins reuse the right limbs.
export function normalizeSkin(img) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, 64, img.height === 32 ? 32 : 64);
  if (img.height === 32) {
    x.drawImage(c, 0, 16, 16, 16, 16, 48, 16, 16); // right leg -> left leg
    x.drawImage(c, 40, 16, 16, 16, 32, 48, 16, 16); // right arm -> left arm
  }
  const d = x.getImageData(0, 0, 64, 64);
  for (let i = 0; i < d.data.length; i += 4) {
    if (d.data[i + 3] < 128) [d.data[i], d.data[i + 1], d.data[i + 2]] = KEY;
    d.data[i + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return c;
}

// An original default skin, used when no Minecraft skin is available.
export function defaultDollSkin() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = `rgb(${KEY.join(',')})`;
  x.fillRect(0, 0, 64, 64);
  const fill = (col, ...r) => { x.fillStyle = col; x.fillRect(...r); };
  fill('#c99a73', 0, 0, 32, 16); // head
  fill('#4a2f1d', 0, 0, 32, 10); // hair
  fill('#c99a73', 8, 10, 8, 6); // face
  fill('#fff', 9, 12, 2, 1); fill('#fff', 13, 12, 2, 1);
  fill('#3a2a8c', 10, 12, 1, 1); fill('#3a2a8c', 14, 12, 1, 1); // eyes
  fill('#8a5a44', 11, 14, 2, 1); // mouth
  fill('#3b7d3b', 16, 16, 24, 16); // shirt
  fill('#3b7d3b', 40, 16, 16, 6); fill('#c99a73', 40, 22, 16, 10); // arm: sleeve + hand
  fill('#3b7d3b', 32, 48, 16, 6); fill('#c99a73', 32, 54, 16, 10);
  fill('#3c3f63', 0, 16, 16, 16); fill('#3c3f63', 16, 48, 16, 16); // trousers
  fill('#2a2a2a', 0, 28, 16, 4); fill('#2a2a2a', 16, 60, 16, 4); // shoes
  return c;
}

/**
 * Emit the model's quads.
 * pose: {x, y, z (feet, world), yaw, pitch (head), swing (-1..1), overlay,
 *        attack (0..1 while jabbing, else -1), weaponTile (atlas tile or null)}
 * quadUV(out, p0, p1, p2, p3, [u0, v0, u1, v1] skin px, shade, key)
 * quadTile(out, p0, p1, p2, p3, tile, shade, key) - for the held weapon
 */
export function buildPlayerModel(out, quadUV, pose, quadTile) {
  const sy = Math.sin(pose.yaw), cy = Math.cos(pose.yaw);
  const fwd = [sy, -cy], right = [cy, sy];
  const toWorld = (lx, ly, lz) => [
    pose.x + right[0] * lx * PX + fwd[0] * lz * PX,
    pose.y + ly * PX,
    pose.z + right[1] * lx * PX + fwd[1] * lz * PX,
  ];
  const swing = pose.swing * 0.8;
  const angles = { rarm: -swing, larm: swing, rleg: swing, lleg: -swing, head: -pose.pitch };
  // attacking: the right arm thrusts forward and back
  if (pose.attack >= 0) angles.rarm = -1.6 * Math.sin(Math.PI * pose.attack) - 0.3;
  else if (pose.weaponTile != null) angles.rarm = -0.35 - swing * 0.3; // hold the weapon a little forward

  const emitBox = (part, u, v, inflate, key) => {
    const [, , , , , bx, by, bz, w, h, d, pivotY, limb] = part;
    const a = limb ? angles[limb] || 0 : 0;
    const ca = Math.cos(a), sa = Math.sin(a);
    const pz = 0; // pivot on the z axis
    // rotate about the local x axis through the pivot (limb swing / head pitch)
    const P = (lx, ly, lz) => {
      const yy = ly - pivotY, zz = lz - pz;
      return toWorld(lx, pivotY + yy * ca - zz * sa, pz + yy * sa + zz * ca);
    };
    const x0 = bx - inflate, x1 = bx + w + inflate, y0 = by - inflate, y1 = by + h + inflate, z0 = bz - inflate, z1 = bz + d + inflate;
    const S = 1;
    // [corners tl, tr, br, bl], skin rect, shade
    const faces = [
      [[x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [u + d, v + d, w, h], 0.95], // front
      [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [u + 2 * d + w, v + d, w, h], 0.75], // back
      [[x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [u, v + d, d, h], 0.8], // right side
      [[x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [u + d + w, v + d, d, h], 0.8], // left side
      [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [u + d, v, w, d], 1.0], // top
      [[x1, y0, z1], [x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [u + d + w, v, w, d], 0.55], // bottom
    ];
    for (const [a0, a1, a2, a3, [tu, tv, tw, th], sh] of faces)
      quadUV(out, P(...a0), P(...a1), P(...a2), P(...a3), [tu, tv, tu + tw, tv + th], sh * S * (pose.shade ?? 1), key);
  };

  for (const part of PARTS) {
    emitBox(part, part[1], part[2], 0, 0);
    if (pose.overlay) emitBox(part, part[3], part[4], part[0] === 'head' ? 0.5 : 0.25, 1);
  }

  // the wielded weapon, held in the right hand and turning with the arm
  if (pose.weaponTile != null && quadTile) {
    const a = angles.rarm, ca = Math.cos(a), sa = Math.sin(a), pivotY = 22;
    const P = (lx, ly, lz) => {
      const yy = ly - pivotY;
      return toWorld(lx, pivotY + yy * ca - lz * sa, yy * sa + lz * ca);
    };
    const x = 6, y0 = 6, y1 = 20, z0 = -3, z1 = 11; // a square in front of the fist
    quadTile(out, P(x, y1, z0), P(x, y1, z1), P(x, y0, z1), P(x, y0, z0), pose.weaponTile, 1, 1);
  }
}

// Custom player skins: turn an uploaded image into a 16x16 NetHack-style tile.

export const SKIN_SIZE = 16;
export const KEY_RGB = [71, 108, 108]; // NetHack's tile background colour (keyed out)

// the colour palette used by NetHack's own tiles (win/share/*.txt), minus the key colour
const NH_PALETTE = [
  [0, 0, 0], [0, 182, 255], [255, 108, 0], [255, 0, 0], [0, 0, 255], [0, 145, 0], [108, 255, 0],
  [255, 255, 0], [255, 0, 255], [145, 71, 0], [204, 79, 0], [255, 182, 145], [237, 237, 237],
  [255, 255, 255], [215, 215, 215], [108, 145, 182], [18, 18, 18], [54, 54, 54], [73, 73, 73],
  [82, 82, 82], [205, 205, 205], [104, 104, 104], [131, 131, 131], [140, 140, 140], [149, 149, 149],
  [195, 195, 195], [100, 100, 100],
];

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// sRGB -> CIELAB, so palette matching follows perceived colour, not raw RGB
function lab([r, g, b]) {
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const R = lin(r), G = lin(g), B = lin(b);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const NH_LAB = () => NH_PALETTE.map(lab);
let nhLab = null;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Flood-fill from the image border, clearing pixels close to the border colour.
function removeBackground(img, w, h, tol = 48) {
  const d = img.data;
  const at = (x, y) => (y * w + x) * 4;
  // background colour = most common of the four corners
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)].map((i) => [d[i], d[i + 1], d[i + 2], d[i + 3]]);
  if (corners.some((c) => c[3] < 16)) return; // already transparent
  const bg = corners.sort((a, b) => corners.filter((c) => dist2(c, b) < 400).length - corners.filter((c) => dist2(c, a) < 400).length)[0];
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, 0, x, h - 1);
  for (let y = 0; y < h; y++) stack.push(0, y, w - 1, y);
  const t2 = tol * tol;
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h || seen[y * w + x]) continue;
    seen[y * w + x] = 1;
    const i = at(x, y);
    if (d[i + 3] < 16 || dist2([d[i], d[i + 1], d[i + 2]], bg) <= t2) {
      d[i + 3] = 0;
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
  }
}

// bounding box of non-transparent pixels
function opaqueBox(img, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (img.data[(y * w + x) * 4 + 3] > 32) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? { x: 0, y: 0, w, h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Build a skin from an image file.
 * @returns {Promise<HTMLCanvasElement>} 16x16 canvas, transparent background
 */
export async function makeSkin(file, { removeBg = true, palette = true } = {}) {
  const bmp = await createImageBitmap(file);
  // work at a manageable size
  const scale = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const work = canvas(w, h);
  const wc = work.getContext('2d', { willReadFrequently: true });
  wc.drawImage(bmp, 0, 0, w, h);
  const img = wc.getImageData(0, 0, w, h);
  if (removeBg) removeBackground(img, w, h);
  wc.putImageData(img, 0, 0);
  const box = opaqueBox(img, w, h);

  // fit the subject into the tile, feet on the bottom edge, centred horizontally
  const S = SKIN_SIZE;
  const fit = Math.min(S / box.w, S / box.h);
  const dw = Math.max(1, Math.round(box.w * fit)), dh = Math.max(1, Math.round(box.h * fit));
  // downscale in halving steps for a cleaner average
  let src = work, sx = box.x, sy = box.y, sw = box.w, sh = box.h;
  while (sw / 2 > dw && sh / 2 > dh) {
    const half = canvas(Math.ceil(sw / 2), Math.ceil(sh / 2));
    const hc = half.getContext('2d');
    hc.imageSmoothingQuality = 'high';
    hc.drawImage(src, sx, sy, sw, sh, 0, 0, half.width, half.height);
    src = half; sx = 0; sy = 0; sw = half.width; sh = half.height;
  }
  const out = canvas(S, S);
  const oc = out.getContext('2d', { willReadFrequently: true });
  oc.imageSmoothingQuality = 'high';
  oc.drawImage(src, sx, sy, sw, sh, Math.floor((S - dw) / 2), S - dh, dw, dh);

  // crisp pixel-art: hard alpha, optional NetHack palette
  const px = oc.getImageData(0, 0, S, S);
  for (let i = 0; i < px.data.length; i += 4) {
    if (px.data[i + 3] < 110) { px.data[i + 3] = 0; continue; }
    px.data[i + 3] = 255;
    if (palette) {
      nhLab ||= NH_LAB();
      const c = lab([px.data[i], px.data[i + 1], px.data[i + 2]]);
      let best = 0, bd = Infinity;
      nhLab.forEach((p, k) => { const dd = dist2(c, p); if (dd < bd) { bd = dd; best = k; } });
      [px.data[i], px.data[i + 1], px.data[i + 2]] = NH_PALETTE[best];
    } else if (dist2([px.data[i], px.data[i + 1], px.data[i + 2]], KEY_RGB) < 30) {
      px.data[i + 2] += 8; // don't let real pixels be keyed out as background
    }
  }
  oc.putImageData(px, 0, 0);
  return out;
}

// same skin, with transparent pixels painted in the key colour (for the GL atlas)
export function keyedSkin(skin) {
  const c = canvas(SKIN_SIZE, SKIN_SIZE);
  const x = c.getContext('2d');
  x.fillStyle = `rgb(${KEY_RGB.join(',')})`;
  x.fillRect(0, 0, SKIN_SIZE, SKIN_SIZE);
  x.drawImage(skin, 0, 0);
  return c;
}

export async function skinFromDataURL(url) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
  const c = canvas(SKIN_SIZE, SKIN_SIZE);
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

// localStorage persistence per character name
const key = (name) => 'nh3d.skin.' + (name || '').toLowerCase();
export function loadSkinURL(name) {
  try { return localStorage.getItem(key(name)); } catch { return null; }
}
export function saveSkinURL(name, url) {
  try {
    if (url) localStorage.setItem(key(name), url);
    else localStorage.removeItem(key(name));
  } catch {}
}

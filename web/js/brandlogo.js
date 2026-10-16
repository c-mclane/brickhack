// The menus' background: a grey brick baseplate seen from straight above,
// filling the screen behind every menu.  On the title screen BRICKHACK is
// built on its studs in white bricks: each pixel of a 5x7 font is a 1x1
// brick, two bricks tall with a stud on top, standing exactly on the plate's
// stud grid.  The camera frames the letters into the page's logo slot (so the
// menu's layout is unchanged); the other menus see the plate from the same
// camera, so the studs look the same everywhere.

import { BrickRenderer, perspective, BRICK_H, STUD_H, STUD_R, PLATE_H } from './brick.js';

const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
};
const STUD = 0.25; // one stud, in the game's units (a map square is 4x4 studs)
const LAYERS = 2; // bricks per letter pixel
const WHITE = [0.95, 0.95, 0.95];
const PLATE = [0.424, 0.431, 0.408]; // dark bluish grey
const PLATE_SHADE = 0.85;
const GAP = 0.003;
const FOVY = (24 * Math.PI) / 180;

// canvas: fills the screen behind the menus; slot: the title's logo slot;
// state(): {plate, title}: is a menu with the plate showing, is it the title
export function menuPlate(canvas, slot, state, text = 'BRICKHACK') {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) return false;
  const brick = new BrickRenderer(gl);
  brick.fogRange = [1000, 2000];

  // the letters, on stud cells (col, row) from (0, 0)
  const cells = new Set(), letters = { box: [], stud: [] };
  let col = 0;
  for (const ch of text) {
    (FONT[ch] || []).forEach((row, r) => [...row].forEach((on, c) => {
      if (on !== '1') return;
      const i = col + c, x = i * STUD, z = r * STUD;
      cells.add(`${i},${r}`);
      for (let l = 0; l < LAYERS; l++)
        letters.box.push(x + GAP, l * BRICK_H, z + GAP, 1, STUD - 2 * GAP, BRICK_H - GAP, STUD - 2 * GAP, ...WHITE);
      letters.stud.push(x + STUD / 2, LAYERS * BRICK_H, z + STUD / 2, 1, STUD_R, STUD_H, STUD_R, ...WHITE);
    }));
    col += 6;
  }
  const LW = (col - 1) * STUD, LD = 7 * STUD, TOP = LAYERS * BRICK_H;

  let cam = null; // {h, cx, cz}: where the title last put the camera
  const draw = (title) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    const cw = Math.floor(W * dpr), ch = Math.floor(H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const aspect = W / H, tanH = Math.tan(FOVY / 2);
    const s = slot.getBoundingClientRect();
    if (title && s.width) {
      // frame the letters' tops into the slot: units per pixel there, then the
      // camera height that gives it, and the camera's place over the plate
      const c = canvas.getBoundingClientRect(), upp = LW / s.width;
      cam = {
        h: TOP + (H * upp) / 2 / tanH,
        cx: LW / 2 - (s.left + s.width / 2 - c.left - W / 2) * upp,
        cz: LD / 2 - (s.top + s.height / 2 - c.top - H / 2) * upp,
      };
    }
    if (!cam) cam = { h: 12, cx: 0, cz: 0 };
    const { h, cx, cz } = cam;
    // the baseplate: studs on the same grid as the letters, over all the plate in view
    const hw = h * tanH * aspect + STUD, hd = h * tanH + STUD;
    const inst = title ? { box: [...letters.box], stud: [...letters.stud] } : { box: [], stud: [] };
    const i0 = Math.floor((cx - hw) / STUD), i1 = Math.ceil((cx + hw) / STUD);
    const j0 = Math.floor((cz - hd) / STUD), j1 = Math.ceil((cz + hd) / STUD);
    inst.box.push(i0 * STUD, -PLATE_H, j0 * STUD, PLATE_SHADE, (i1 - i0) * STUD, PLATE_H, (j1 - j0) * STUD, ...PLATE);
    for (let i = i0; i < i1; i++)
      for (let j = j0; j < j1; j++)
        if (!title || !cells.has(`${i},${j}`))
          inst.stud.push((i + 0.5) * STUD, 0, (j + 0.5) * STUD, PLATE_SHADE, STUD_R, STUD_H, STUD_R, ...PLATE);
    brick.setInstances(brick.box, inst.box);
    brick.setInstances(brick.stud, inst.stud);
    // looking straight down, north up the screen
    const view = new Float32Array([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, -cx, cz, -h, 1]);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(PLATE[0] * 0.5, PLATE[1] * 0.5, PLATE[2] * 0.5, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    brick.draw(perspective(FOVY, aspect, 0.1, h + 10), view, []);
  };
  // redrawn only when something changes: which menu is up, or the window's size
  let last = '';
  const tick = () => {
    requestAnimationFrame(tick);
    const st = state();
    canvas.style.display = st.plate ? 'block' : 'none';
    if (!st.plate) return;
    const s = slot.getBoundingClientRect();
    const key = `${st.title}|${canvas.clientWidth}x${canvas.clientHeight}|${s.left},${s.top},${s.width}`;
    if (key !== last) { last = key; draw(st.title); }
  };
  tick();
  return true;
}

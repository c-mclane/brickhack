// Character select: the LEGO minifig picker.  A turning 3D preview of the
// chosen figure, with arrows to cycle through the figures for the chosen role
// and gender (tools/build_roster.py) and the figure's name.  Your pick is
// your hero.

import { Lego, figureMatrix, perspective, lookAt, loadGLB, FIG_FEET } from './lego.js';

let rosterP = null;
export function loadRoster() {
  if (!rosterP)
    rosterP = fetch('assets/lego/roster.built.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
  return rosterP;
}

const LAST = 'lh.fig.last';
const PREVIEW_SCALE = 0.5; // the preview's camera frames a figure drawn at half size (a 2.6-unit minifig)
const lget = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lset = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// A small 3D view of one minifig on its own canvas, turning slowly and
// pausing a moment facing you each time round.  visible(): is it on screen
// (only then is it drawn).  Returns {show(url), gl}.
export function figureView(canvas, visible) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) return null;
  const lego = new Lego(gl);
  lego.fogRange = [100, 200];
  let prims = null, want = null, spin = 0, last = performance.now();
  let fit = { lo: 0, hi: 2.9 }; // the figure's height range (feet to the top of a hat, flame...)
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!visible()) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    if (!prims) return;
    spin += dt * 0.7;
    const a = spin % (Math.PI * 2), hold = 1.2;
    const yaw = Math.PI + (a < hold ? 0 : ((a - hold) / (Math.PI * 2 - hold)) * Math.PI * 2);
    // frame the whole figure, however tall (a flame held overhead...)
    const fov = (28 * Math.PI) / 180, mid = (fit.lo + fit.hi) / 2;
    const dist = Math.max(7.4, ((fit.hi - fit.lo) / 2 + 0.45) / Math.tan(fov / 2));
    const proj = perspective(fov, w / h, 0.1, 50 + dist);
    const view = lookAt([0, mid + dist * 0.07, dist], [0, mid, 0]);
    lego.draw(proj, view, [{ prims, matrix: figureMatrix(0, 0, 0, yaw, PREVIEW_SCALE), shade: 1.05 }]);
  };
  requestAnimationFrame(frame);
  return {
    // show the figure at url (null: nothing); resolves false if it couldn't load
    async show(url) {
      want = url;
      prims = null;
      spin = 0; // each new figure starts facing you
      if (!url) return true;
      try {
        const [p, raw] = await Promise.all([lego.model(url), loadGLB(url)]);
        if (want !== url) return true;
        let lo = Infinity, hi = -Infinity;
        for (const q of raw) for (let i = 1; i < q.pos.length; i += 3) { lo = Math.min(lo, q.pos[i]); hi = Math.max(hi, q.pos[i]); }
        fit = { lo: (lo + FIG_FEET) * PREVIEW_SCALE, hi: (hi + FIG_FEET) * PREVIEW_SCALE };
        prims = p;
        return true;
      } catch { return false; }
    },
  };
}

// The character select's picker. root: the #figpick element; visible(): is
// it on screen; onChange(fig): called whenever the shown figure changes
export function setupFigurePicker(root, visible, onChange = () => {}) {
  const label = root.querySelector('.fig-label'), count = root.querySelector('.fig-count');
  const view = figureView(root.querySelector('canvas'), visible);
  if (!view) { label.textContent = 'WebGL2 is not available'; return { current: () => null, filter() {} }; }
  let all = [], roster = [], idx = 0;
  let want = { role: 'knight', gender: 'male' };

  const show = async () => {
    const f = roster[idx];
    if (!f) return;
    label.textContent = f.label;
    count.textContent = `${idx + 1} / ${roster.length}`;
    lset(LAST, f.id);
    onChange(f);
    if (!(await view.show(f.url))) label.textContent = `${f.label} (missing: run npm run lego)`;
  };
  const step = (d) => { if (roster.length) { idx = (idx + d + roster.length) % roster.length; show(); } };
  root.querySelector('.fig-prev').onclick = () => step(-1);
  root.querySelector('.fig-next').onclick = () => step(1);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
  });

  // the figures for a role and gender: a female Knight is a Dame; a role
  // with no figures of its own shows the knights
  const choose = () => {
    let list = all.filter((f) => f.role === want.role);
    if (!list.length) list = all.filter((f) => f.role === 'knight');
    const fem = list.filter((f) => f.gender === 'female'), male = list.filter((f) => f.gender !== 'female');
    list = want.gender === 'female' ? (fem.length ? fem : list) : male.length ? male : list;
    const keep = roster[idx];
    roster = list;
    idx = Math.max(0, roster.indexOf(keep), keep ? -1 : roster.findIndex((f) => f.id === lget(LAST)));
    if (roster.length) show();
  };
  loadRoster().then((r) => {
    all = r;
    if (!all.length) { label.textContent = 'No figures built (npm run lego)'; return; }
    choose();
  });

  return {
    current: () => roster[idx] || null,
    // role and gender as the creation screen shows them ('Knight', 'female', 'random'...)
    filter(role, gender) {
      want = { role: String(role).toLowerCase(), gender: String(gender).toLowerCase() };
      if (all.length) choose();
    },
  };
}

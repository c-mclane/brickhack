// Character select: the LEGO minifig picker.  A turning 3D preview of the
// chosen figure, with arrows to cycle through the figures for the chosen role
// and gender (tools/build_roster.py) and the figure's name.  Your pick is
// your hero.  Beside it, the wardrobe: arrows to swap any part for one from
// web/assets/lego/wardrobe.json (the game server builds the result:
// /api/figure), and a button back to the figure as it comes.

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
const PARTS = 'lh.fig.parts.last'; // the wardrobe choices last made

let wardrobeP = null;
export function loadWardrobe() {
  if (!wardrobeP)
    wardrobeP = fetch('assets/lego/wardrobe.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  return wardrobeP;
}

// a roster figure with wardrobe parts swapped in ({category: option id}):
// the url of its model, built by the game server (null if it can't be)
const customs = new Map();
export function customFigureUrl(base, parts) {
  if (!parts || !Object.keys(parts).length) return Promise.resolve(null);
  const q = `base=${encodeURIComponent(base)}&parts=${encodeURIComponent(JSON.stringify(parts))}`;
  if (!customs.has(q))
    customs.set(q, fetch('/api/figure?' + q).then((r) => r.json()).then((j) => j.url || null).catch(() => null));
  return customs.get(q);
}
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

// The figures for a role, gender and race ('random' for any), best fit first:
// exact matches; else the same role and gender (a race with no figures of its
// own shows the humans); else the role; else the knights.
export function figuresFor(all, role, gender, race) {
  let list = all.filter((f) => f.role === role);
  if (!list.length) list = all.filter((f) => f.role === 'knight');
  const fem = list.filter((f) => f.gender === 'female'), male = list.filter((f) => f.gender !== 'female');
  list = gender === 'female' ? (fem.length ? fem : list) : male.length ? male : list;
  const ofRace = list.filter((f) => f.race === (race === 'random' ? 'human' : race));
  return ofRace.length ? ofRace : list.filter((f) => f.race === 'human').length ? list.filter((f) => f.race === 'human') : list;
}

// The character select's picker. root: the #figpick element; visible(): is
// it on screen; onChange(fig): called whenever the shown figure changes
export function setupFigurePicker(root, visible, onChange = () => {}) {
  const label = root.querySelector('.fig-label'), count = root.querySelector('.fig-count');
  const view = figureView(root.querySelector('canvas'), visible);
  if (!view) { label.textContent = 'WebGL2 is not available'; return { current: () => null, filter() {} }; }
  let all = [], roster = [], idx = 0;
  let want = { role: 'knight', gender: 'male', race: 'human' };
  let parts = {};
  try { parts = JSON.parse(lget(PARTS) || '{}') || {}; } catch {}
  let shown = 0; // which show() is the latest (a slow build mustn't replace a newer figure)

  const show = async () => {
    const f = roster[idx];
    if (!f) return;
    const n = ++shown;
    label.textContent = f.label;
    count.textContent = `${idx + 1} / ${roster.length}`;
    lset(LAST, f.id);
    onChange(f);
    drawWardrobe();
    let url = f.url;
    if (Object.keys(parts).length) {
      label.textContent = `${f.label} (dressing...)`;
      url = (await customFigureUrl(f.id, parts)) || f.url;
      if (n !== shown) return;
      label.textContent = f.label;
    }
    if (!(await view.show(url)) && n === shown) label.textContent = `${f.label} (missing: run npm run lego)`;
  };

  // the wardrobe: a row per category, its arrows going through the options
  // (and back round to the figure's own); a button to put everything back
  const wroot = document.getElementById('wardrobe');
  let ward = null;
  const rows = {};
  function drawWardrobe() {
    if (!ward) return;
    for (const c of ward.categories) {
      const o = (ward.options[c.key] || []).find((x) => x.id === parts[c.key]);
      rows[c.key].textContent = o ? o.label : 'As it comes';
      rows[c.key].classList.toggle('changed', !!o);
    }
    wroot.querySelector('.ward-reset').disabled = !Object.keys(parts).length;
  }
  const swap = (key, d) => {
    const opts = ward.options[key] || [];
    let i = opts.findIndex((x) => x.id === parts[key]); // -1: the figure's own
    i = ((i + 1 + d + opts.length + 1) % (opts.length + 1)) - 1;
    if (i < 0) delete parts[key]; else parts[key] = opts[i].id;
    lset(PARTS, JSON.stringify(parts));
    show();
  };
  if (wroot)
    loadWardrobe().then((w) => {
      if (!w) return;
      ward = w;
      for (const c of w.categories) {
        const row = document.createElement('div');
        row.className = 'ward-row';
        row.innerHTML = `<span class="ward-cat"></span><button class="mc-btn ward-prev" title="Previous">&#9664;</button><span class="ward-val"></span><button class="mc-btn ward-next" title="Next">&#9654;</button>`;
        row.querySelector('.ward-cat').textContent = c.label;
        row.querySelector('.ward-prev').onclick = () => swap(c.key, -1);
        row.querySelector('.ward-next').onclick = () => swap(c.key, 1);
        rows[c.key] = row.querySelector('.ward-val');
        wroot.appendChild(row);
      }
      const reset = document.createElement('button');
      reset.className = 'mc-btn ward-reset';
      reset.textContent = '\u21BA As recommended';
      reset.title = 'Back to the figure for your role, as it comes';
      reset.onclick = () => { parts = {}; lset(PARTS, '{}'); show(); };
      wroot.appendChild(reset);
      drawWardrobe();
    });
  const step = (d) => { if (roster.length) { idx = (idx + d + roster.length) % roster.length; show(); } };
  root.querySelector('.fig-prev').onclick = () => step(-1);
  root.querySelector('.fig-next').onclick = () => step(1);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
  });

  const choose = () => {
    const list = figuresFor(all, want.role, want.gender, want.race);
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
    parts: () => ({ ...parts }), // the wardrobe choices ({} = the figure as it comes)
    // role, gender and race as the creation screen shows them ('Knight', 'female', 'elf', 'random'...)
    filter(role, gender, race = 'random') {
      want = { role: String(role).toLowerCase(), gender: String(gender).toLowerCase(), race: String(race).toLowerCase() };
      if (all.length) choose();
    },
  };
}

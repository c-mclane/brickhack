// BrickHack server: serves the web client and bridges each browser session
// to a native SLASH'EM process running the "web" window port.
//   stdin  <- command lines from the client (see port/winweb.c)
//   fd 3   -> JSON event lines, forwarded to the browser via Server-Sent Events
// No npm dependencies.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const MUSIC = path.join(ROOT, 'music'); // local only (git-ignored): tracker modules to shuffle-play
const MUSIC_EXT = /\.(xm|mod|s3m|it|mo3|mptm|669|med|okt|stm|ult|umx)$/i;
// local custom art (see art/README.md): art/sky, art/skins, art/monsters
const ART = path.join(ROOT, 'art');
const ART_DIRS = ['sky', 'skins', 'monsters', 'dreamland', 'blocks'];
const IMAGE_EXT = /\.(png|gif|webp)$/i;
const WORLDS = path.join(ROOT, 'worlds'); // local only: placed blocks + block inventory per character
// the game engine, built by tools/build-slashem.sh
// autopickup with no pickup_types = collect everything (Minecraft-style);
// menustyle:partial makes chests list their contents straight away
const COMMON_OPTS = ['autopickup', 'time', 'showexp', '!cmdassist', 'menustyle:partial'];
// the Windows package (tools/package-windows.sh) carries its engine in game\
const WINDOWS = process.platform === 'win32';
const VARIANTS = {
  slashem: {
    label: "SLASH'EM 0.0.8E0F2",
    dir: WINDOWS ? path.join(ROOT, 'game') : path.join(ROOT, 'build', 'slashem', 'slashemdir'),
    bin: WINDOWS ? 'slashem.exe' : 'slashem',
    opts: [...COMMON_OPTS],
  },
};
const installed = () => Object.keys(VARIANTS).filter((v) => fs.existsSync(path.join(VARIANTS[v].dir, VARIANTS[v].bin)));
const variantOf = (v) => (VARIANTS[v] && installed().includes(v) ? v : installed()[0]);
const PORT = +process.env.PORT || 8081; // (MineHack uses 8080)
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
};

/** sid -> { proc, res (SSE response), backlog[], timer } */
const sessions = new Map();

function cleanName(s) {
  return String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) || 'Steve';
}
function cleanOpt(s) {
  return String(s || '').replace(/[^a-z]/gi, '').slice(0, 12).toLowerCase();
}

function send(sess, line) {
  if (sess.res) sess.res.write(`data: ${line}\n\n`);
  else sess.backlog.push(line);
}

function stopGame(sess) {
  if (sess.proc && sess.proc.exitCode === null) sess.proc.stdin.end(); // EOF => NetHack saves
}

function startGame(sid, opts) {
  let sess = sessions.get(sid);
  if (!sess) sessions.set(sid, (sess = { res: null, backlog: [] }));
  // detach any previous game first so its exit isn't reported to the new one
  const old = sess.proc;
  sess.proc = null;
  sess.backlog = [];
  if (old && old.exitCode === null) old.stdin.end(); // EOF => NetHack saves

  const variant = variantOf(opts.variant);
  const V = VARIANTS[variant];
  const o = [...V.opts];
  for (const k of ['role', 'race', 'gender', 'align']) {
    const v = cleanOpt(opts[k]);
    if (v && v !== 'random') o.push(`${k}:${v}`);
  }
  if (!opts.legacy) o.push('!legacy');
  if (opts.dreamland) o.push('dreamland'); // start on the Dreamland overland level
  const name = cleanName(opts.name);
  // a brand-new character (no save to restore) starts a fresh block world
  // ...and starts with whatever more its figure's design gives it ("holy wafer:4": port/winweb.c web_kit_item)
  const fresh = !listSaves(variant).includes(name);
  if (fresh) {
    try { fs.unlinkSync(worldFile(variant, name)); } catch {}
  }
  const kit = fresh ? String(opts.kit || '').replace(/[^a-z0-9 ,:'-]/gi, '').slice(0, 200) : '';

  const start = () => {
    // LEGOHACK_WIZARD=1 npm start: every game in debug (wizard) mode, for testing
    // (^V level teleport, ^G make a monster, ^W wish; saves go under the name "wizard")
    const args = process.env.LEGOHACK_WIZARD === '1' ? ['-D', '-u', name] : ['-u', name];
    const proc = spawn(path.join(V.dir, V.bin), args, {
      cwd: V.dir,
      env: { ...process.env, NETHACKOPTIONS: o.join(','), HOME: V.dir, LEGOHACK_KIT: kit },
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    sess.proc = proc;
    let buf = '';
    proc.stdio[3].setEncoding('utf8');
    proc.stdio[3].on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line) send(sess, line);
      }
    });
    const passthru = (d) => {
      const s = String(d).trim();
      if (s) send(sess, JSON.stringify({ t: 'msg', raw: 1, s }));
    };
    proc.stdout.on('data', passthru);
    proc.stderr.on('data', passthru);
    proc.stdin.on('error', () => {});
    proc.on('exit', (code) => {
      if (sess.proc === proc) {
        sess.proc = null;
        send(sess, JSON.stringify({ t: 'gone', code }));
      }
    });
    console.log(`[${sid}] started ${variant} ${name} (${o.join(',')})`);
  };
  // let a previous process finish saving before restoring the same character
  if (old && old.exitCode === null) {
    old.once('exit', start);
    setTimeout(() => old.exitCode === null && old.kill('SIGHUP'), 3000);
  } else start();
}

function body(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 4e6) req.destroy(); });
    req.on('end', () => resolve(d));
  });
}

// ---- customized minifigs (the character select's wardrobe): built by a
// long-running tools/figure_worker.py (the LDraw library stays loaded), one
// request at a time, answered by id
const figs = { proc: null, next: 1, waiting: new Map(), buf: '' };
function figureWorker() {
  if (figs.proc) return figs.proc;
  const proc = (figs.proc = spawn('python3', [path.join(ROOT, 'tools', 'figure_worker.py')], { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] }));
  proc.stdout.on('data', (d) => {
    figs.buf += d;
    let i;
    while ((i = figs.buf.indexOf('\n')) >= 0) {
      const line = figs.buf.slice(0, i);
      figs.buf = figs.buf.slice(i + 1);
      try {
        const r = JSON.parse(line);
        const done = figs.waiting.get(r.id);
        if (done) { figs.waiting.delete(r.id); done(r); }
      } catch {}
    }
  });
  const fail = () => {
    figs.proc = null;
    for (const done of figs.waiting.values()) done({ error: 'figure builder stopped' });
    figs.waiting.clear();
  };
  proc.on('exit', fail);
  proc.on('error', fail);
  return proc;
}
function buildFigure(base, parts, wear = '') {
  return new Promise((resolve) => {
    const id = figs.next++;
    figs.waiting.set(id, resolve);
    try { figureWorker().stdin.write(JSON.stringify({ id, base, parts, wear }) + '\n'); }
    catch (e) { figs.waiting.delete(id); resolve({ error: String(e) }); }
  });
}

function worldFile(variant, name) {
  return path.join(WORLDS, variant, cleanName(name) + '.json');
}

function listSaves(variant) {
  // Windows: "<windows user>-<name>.NetHack-saved-game" in the game folder
  if (WINDOWS) {
    try {
      return fs.readdirSync(VARIANTS[variant].dir)
        .map((f) => f.match(/^[^-]*-(.+)\.NetHack-saved-game$/)) // (names may hold dashes; Windows user names rarely do)
        .filter(Boolean).map((m) => decodeURIComponent(m[1].replace(/%(?![0-9a-f]{2})/gi, '%25')));
    } catch { return []; }
  }
  try {
    return fs.readdirSync(path.join(VARIANTS[variant].dir, 'save'))
      .map((f) => f.match(/^\d+(.+?)(\.gz)?$/))
      .filter(Boolean).map((m) => m[1]);
  } catch { return []; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const sid = (url.searchParams.get('sid') || '').replace(/[^a-z0-9]/gi, '').slice(0, 40);

  if (url.pathname === '/api/stream' && sid) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
    });
    res.write(': hi\n\n');
    let sess = sessions.get(sid);
    if (!sess) sessions.set(sid, (sess = { res: null, backlog: [] }));
    clearTimeout(sess.timer);
    sess.res = res;
    for (const l of sess.backlog.splice(0)) send(sess, l);
    req.on('close', () => {
      if (sess.res !== res) return;
      sess.res = null;
      // tab closed: save the game after a grace period
      sess.timer = setTimeout(() => { stopGame(sess); sessions.delete(sid); }, 15000);
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/start' && sid) {
    let opts = {};
    try { opts = JSON.parse(await body(req)); } catch {}
    startGame(sid, opts);
    res.writeHead(204).end();
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/input' && sid) {
    const d = await body(req);
    const sess = sessions.get(sid);
    if (sess && sess.proc && sess.proc.exitCode === null) {
      sess.proc.stdin.write(d.endsWith('\n') ? d : d + '\n');
    }
    res.writeHead(204).end();
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/stop' && sid) {
    const sess = sessions.get(sid);
    if (sess) stopGame(sess);
    res.writeHead(204).end();
    return;
  }
  // the Windows launcher, when its window closes: save every game, then exit
  if (req.method === 'POST' && url.pathname === '/api/quit') {
    res.writeHead(204).end();
    const procs = [...sessions.values()].map((sess) => sess.proc).filter((p) => p && p.exitCode === null);
    for (const sess of sessions.values()) stopGame(sess);
    let left = procs.length;
    const done = () => process.exit(0);
    if (!left) return done();
    for (const p of procs) p.on('exit', () => { if (--left === 0) done(); });
    setTimeout(done, 15000); // (never hang the way out)
    return;
  }
  // Reset (the title screen): delete every saved game, every block world and
  // any bones (dead characters' levels left for later games); the high
  // scores stay.  Not while a game is running.
  if (req.method === 'POST' && url.pathname === '/api/reset') {
    const running = [...sessions.values()].some((sess) => sess.proc && sess.proc.exitCode === null);
    if (running) {
      res.writeHead(409, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'A game is still running: save and quit it first.' }));
      return;
    }
    let deleted = 0;
    const wipe = (dir, match) => {
      let files = [];
      try { files = fs.readdirSync(dir); } catch { return; }
      for (const f of files) {
        if (!match.test(f)) continue;
        try { fs.unlinkSync(path.join(dir, f)); deleted++; } catch {}
      }
    };
    for (const v of Object.keys(VARIANTS)) {
      const dir = VARIANTS[v].dir;
      if (WINDOWS) wipe(dir, /\.NetHack-saved-game$/);
      else wipe(path.join(dir, 'save'), /^\d+.+/);
      wipe(dir, /^bon.+/); // bones
      wipe(path.join(WORLDS, v), /\.json$/);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ deleted }));
    return;
  }
  if (url.pathname === '/api/saves') {
    const v = variantOf(url.searchParams.get('variant'));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(listSaves(v)));
    return;
  }
  if (url.pathname === '/api/music') {
    const list = [];
    const walk = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name), rel + e.name + '/');
        else if (MUSIC_EXT.test(e.name)) list.push(rel + e.name);
      }
    };
    try { walk(MUSIC, ''); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(list.sort()));
    return;
  }
  if (url.pathname === '/api/art') {
    const dir = url.searchParams.get('dir');
    let list = [];
    if (ART_DIRS.includes(dir)) {
      try { list = fs.readdirSync(path.join(ART, dir)).filter((f) => IMAGE_EXT.test(f)).sort(); } catch {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(list));
    return;
  }
  if (url.pathname.startsWith('/art/')) {
    const [, , dir, name] = url.pathname.split('/');
    const file = path.join(ART, dir || '', path.basename(decodeURIComponent(name || '')));
    if (!ART_DIRS.includes(dir) || !IMAGE_EXT.test(file)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end('not found');
      const type = { '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }[path.extname(file).toLowerCase()];
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }).end(data);
    });
    return;
  }
  if (url.pathname.startsWith('/music/')) {
    const file = path.join(MUSIC, path.normalize(decodeURIComponent(url.pathname.slice(7))));
    if (!file.startsWith(MUSIC + path.sep) || !MUSIC_EXT.test(file)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(data);
    });
    return;
  }
  if (url.pathname === '/api/world') {
    const file = worldFile(variantOf(url.searchParams.get('variant')), url.searchParams.get('name'));
    if (req.method === 'POST') {
      const d = await body(req);
      try { JSON.parse(d); } catch { return res.writeHead(400).end(); }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFile(file, d, () => res.writeHead(204).end());
      return;
    }
    fs.readFile(file, 'utf8', (err, data) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(err ? '{}' : data);
    });
    return;
  }
  // a roster figure with wardrobe parts swapped in: ?base=<figure id>&parts=<{category: option id} as JSON>
  if (url.pathname === '/api/figure') {
    const base = (url.searchParams.get('base') || '').replace(/[^a-z0-9-]/gi, '').slice(0, 60);
    let parts = {};
    try { parts = JSON.parse(url.searchParams.get('parts') || '{}'); } catch {}
    const clean = {};
    for (const [k, v] of Object.entries(parts || {}).slice(0, 20))
      clean[String(k).replace(/[^a-z]/g, '').slice(0, 20)] = String(v).replace(/[^a-z0-9-]/gi, '').slice(0, 40);
    // what the hero wears (items of items.json, by name, comma-separated: a helm, a shield): put on the figure
    // (and "strip:<slot>", "design:shield": what the figure's design shows of its starting gear)
    const wear = (url.searchParams.get('wear') || '').replace(/[^a-z ,':-]/gi, '').slice(0, 160);
    const r = await buildFigure(base, clean, wear);
    res.writeHead(r.url ? 200 : 400, { 'Content-Type': 'application/json' }).end(JSON.stringify(r.url ? { url: r.url } : { error: r.error || 'failed' }));
    return;
  }
  if (url.pathname === '/api/variants') {
    const list = installed().map((id) => ({ id, label: VARIANTS[id].label }));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(list));
    return;
  }

  // static files
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (!p) p = 'index.html';
  const file = path.join(WEB, p);
  if (!file.startsWith(WEB)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

if (!installed().length) {
  console.error('SLASH\'EM is not built yet. Run tools/build-slashem.sh (or npm run build).');
  process.exit(1);
}
server.listen(PORT, HOST, () => console.log(`BrickHack: http://${HOST}:${PORT}/`));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const s of sessions.values()) stopGame(s);
    if (figs.proc) figs.proc.kill();
    setTimeout(() => process.exit(0), 1500);
  });
}

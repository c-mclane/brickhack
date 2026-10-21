// The rites at the altar of a follower of Jesus (items.json "altar_jesus"), played out there: the Mass,
// Communion, alms, confession, a corpse offered (and refused), and what a good prayer leaves (a wafer on the
// altar, its chalices filled). Its three statues come alive for each (fading into angel priests: the one on top
// raising its hands, gazing up; the two out front turning to you, hands joined, or, for the Mass, hopping down to
// stand either side of you), and go back to stone after; the Agnus Dei chanted meanwhile. Shared by the game
// (main.js: the engine's "rite" messages, winweb.c web_ritefx) and the test dungeon (testbed.js).
//
// The host gives it (env): brick (the BrickWorld), clock() (s), wait(s) (resolves after that long: 0, the next
// frame), say(text) (the test dungeon's status line; the game prints the engine's own), hero: {act(name) (an act
// of FOUNT, minifig-anim.js: what your figure does; null, done), hold({R, L}) (urls; null, as you'd hold anyway)},
// url(name) and upright(name) (a brick item's model, and whether it stands as it is), angelUrl (the angel priest's
// figure), chant(on). Each frame the host draws figures(dt) (the angels: [{url, matrix, pose, hold, fade}]) and
// props (loose things: brickworld.setProps).

import * as THREE from 'three';
import { FigureAnimator, FOUNT, fountKey } from './minifig-anim.js';
import { figureMatrix, STUD_H } from './brick.js';

const CANCEL = Symbol('cancel');

export class AltarRites {
  constructor(env) {
    this.env = env;
    this.angels = []; // [{url, x, y, z, yaw, fade, anim, act: {act, t0}, moving, hop}]
    this.props = [];
    this.glow = null; // (over what's raised at an elevation: {t0, T, last})
    this.busy = null; // (the altar it's at, while a rite goes on: {ax, az})
  }

  // where on the altar (its LDU: X across, Y up (negative), Z out to its front (negative)), in the world: its
  // square (ax, az), turned about as it stands (turn: brickworld's, its back to a wall)
  place(ax, az, turn = 0) {
    const c = Math.cos(turn), s = Math.sin(turn);
    this.ax = ax; this.az = az; this.turn = turn;
    const W0 = (X, Y, Z) => { const ox = X / 80, oz = -Z / 80; return { x: ax + 0.5 + ox * c + oz * s, y: STUD_H - Y / 80, z: az + 0.5 - ox * s + oz * c }; };
    this.W0 = W0;
    this.spot = W0(0, -16, -70); // (where you stand: on its step, before the table)
    this.wafer = W0(30, -64, -50); // (the white tile)
    this.stud = W0(50, -64, -50); // (the chalice's gold stud)
    this.plate = W0(40, -72, -20); // (in the offering plate)
    this.cross = W0(0, -124, 10);
    // the statues: where each stands, and how it faces (the game's yaw: 0 north; a model turned, its yaws less the
    // turn); the two out front, where they go for the Mass: either side of you, angled in
    const yaw = (y) => y - turn;
    this.sts = [{ joint: 'statueL', ...W0(-60, -8, -110), yaw: yaw(Math.PI), to: { ...W0(-60, -8, -104), yaw: yaw(0.5) } },
      { joint: 'statueR', ...W0(60, -8, -110), yaw: yaw(-Math.PI), to: { ...W0(60, -8, -104), yaw: yaw(-0.5) } },
      { joint: 'angel', ...W0(0, -160, 30), yaw: yaw(Math.PI) }];
  }

  prop(name, p, more = {}) { return { url: this.env.url(name), x: p.x, y: p.y, z: p.z, upright: this.env.upright(name), ...more }; }
  glint(p, n = 24, spread = 0.15) { this.env.brick.fx.sparkles(new THREE.Vector3(p.x, p.y + 0.05, p.z), n, 0xfff3c0, spread); }
  sparkle(p, n, color, spread) { this.env.brick.fx.sparkles(new THREE.Vector3(p.x, p.y, p.z), n, color, spread); }

  // a wait, ended early (thrown out of) if the rite's been called off: you went
  async wait(s) { await this.env.wait(s); if (this.cancelled) throw CANCEL; }
  // ...till t s into what began at t0
  until(t0, t) { return this.wait(Math.max(0, t0 + t - this.env.clock())); }
  cancel() { if (this.busy) this.cancelled = true; }

  // your figure, for it: what it does (FOUNT), what's in its hands
  heroAct(name) { this.acted = true; this.env.hero.act(name); }
  heroHold(h) { this.acted = true; this.env.hero.hold(h); }

  // the angels, drawn this frame
  figures(dt) {
    const now = this.env.clock();
    return this.angels.map((f) => {
      const t = f.act ? now - f.act.t0 : 0, pose = f.anim ? f.anim.update(dt, { moving: !!f.moving, hop: f.hop || 0, fount: f.act ? { act: f.act.act, t } : null }) : null;
      const drop = f.act ? fountKey(f.act.act, 'drop', t) : 0;
      return { url: f.url, matrix: figureMatrix(f.x, f.y - drop, f.z, f.yaw), pose, hold: {}, fade: f.fade };
    });
  }
  // (each frame too: over what's raised, a golden shimmer)
  step() {
    const g = this.glow, now = this.env.clock();
    if (!g || now - g.t0 > g.T || now - (g.last || 0) < 0.12) return;
    g.last = now;
    this.sparkle({ x: this.spot.x, y: this.spot.y + 1.75, z: this.spot.z }, 8, 0xffe9a0, 0.12);
  }

  // its statues come alive: a shimmer, stone fading into flesh; the one on top raising its hands
  async awaken() {
    const { brick, angelUrl, clock } = this.env;
    this.angels = this.sts.map((s) => ({ url: angelUrl, x: s.x, y: s.y, z: s.z, yaw: s.yaw, fade: 0, anim: null }));
    for (const f of this.angels) brick.model(f.url).then((m) => { let rig = null; m.traverse((o) => { if (!rig && o.userData && o.userData.rig) rig = o.userData.rig; }); f.anim = new FigureAnimator(rig, { phase: Math.random() * 3 }); });
    for (const s of this.sts) this.sparkle({ x: s.x, y: s.y + 0.7, z: s.z }, 40, 0xfff3c0, 0.5);
    const f0 = clock();
    while (clock() - f0 < 1.2) { this.fadeStatues(1 - (clock() - f0) / 1.2); await this.wait(0); }
    this.fadeStatues(0);
    this.angels[2].act = { act: 'orans', t0: clock() };
  }
  fadeStatues(k) { this.sts.forEach((s, i) => { this.env.brick.fadeJoint(this.ax, this.az, s.joint, k); if (this.angels[i]) this.angels[i].fade = 1 - k; }); }
  // (not the Mass: the two out front just turn where they stand, to you, hands joined)
  async attend() {
    const { clock } = this.env, t0 = clock(), fs = this.angels.slice(0, 2);
    const to = this.sts.slice(0, 2).map((s) => Math.atan2(this.spot.x - s.x, -(this.spot.z - s.z)));
    for (const f of fs) f.act = { act: 'attend', t0 };
    while (clock() - t0 < 0.7) {
      const u = (clock() - t0) / 0.7, e = u * u * (3 - 2 * u);
      this.sts.slice(0, 2).forEach((s, i) => { fs[i].yaw = s.yaw + Math.atan2(Math.sin(to[i] - s.yaw), Math.cos(to[i] - s.yaw)) * e; });
      await this.wait(0);
    }
  }
  // (the Mass: a hop down off their plates, a turn about, and to their places either side of you)
  async descend(m0) {
    const { clock } = this.env, d0 = clock();
    for (;;) {
      const t = clock() - d0;
      for (const [i, s] of this.sts.slice(0, 2).entries()) {
        const f = this.angels[i], out = this.W0(0, 0, -24), o = this.W0(0, 0, 0), fx = out.x - o.x, fz = out.z - o.z; // (a hop forward, off the plate)
        const dn = { x: s.x + fx, y: 0, z: s.z + fz };
        if (t < 0.5) { const u = t / 0.5; Object.assign(f, { x: s.x + fx * u, y: s.y * (1 - u) + 0.28 * Math.sin(Math.PI * u), z: s.z + fz * u, hop: Math.sin(Math.PI * u), moving: false }); }
        else if (t < 1.1) { const u = (t - 0.5) / 0.6, e = u * u * (3 - 2 * u), d = Math.atan2(Math.sin(s.to.yaw - s.yaw), Math.cos(s.to.yaw - s.yaw)); Object.assign(f, { ...dn, hop: 0, yaw: s.yaw + d * e }); }
        else if (t < 2.7) { const u = (t - 1.1) / 1.6, v = Math.max(0, (u - 0.75) / 0.25); Object.assign(f, { x: dn.x + (s.to.x - dn.x) * u, z: dn.z + (s.to.z - dn.z) * u, y: v * s.to.y + 0.1 * Math.sin(Math.PI * v), yaw: s.to.yaw, moving: true }); }
        else Object.assign(f, { ...s.to, moving: false, act: f.act || { act: 'massDeacon', t0: m0 } });
      }
      if (t >= 2.7) break;
      await this.wait(0);
    }
  }
  // and back to stone
  async toStone() {
    const { clock } = this.env, b0 = clock();
    while (clock() - b0 < 1.2) { this.fadeStatues((clock() - b0) / 1.2); await this.env.wait(0); }
    this.fadeStatues(1);
    this.angels = [];
  }

  // a rite, start to end, at the altar on (ax, az), turned so: the chant, its statues alive; then the rite itself
  // (body: given its start, on the clock); then back to stone. Called off (you went), it ends there, the statues
  // back to stone
  async run(ax, az, turn, body) {
    if (this.busy) { this.cancel(); while (this.busy) await this.env.wait(0); } // (one at a time: the last one ended)
    this.place(ax, az, turn);
    this.busy = { ax, az };
    this.cancelled = false;
    this.acted = false;
    this.env.chant(true);
    try { await body(this.env.clock()); }
    catch (e) { if (e !== CANCEL) throw e; }
    this.glow = null;
    if (this.acted) { this.env.hero.act(null); this.env.hero.hold(null); } // (what you were doing for it, done; not a prayer the engine began)
    this.props = [];
    await this.toStone();
    this.env.chant(false);
    this.busy = null;
  }

  // the Mass: the chalice set on its stud; the statues alive, the two out front hopping down, turning about and
  // taking their places either side of you, angled in to the altar, hands joined. The wafer appears on its tile;
  // you raise it, genuflect, lay it back; raise the chalice, genuflect; then eat the wafer and drink from the
  // chalice, and take it up again (the game: back into your pack, empty)
  mass(ax, az, turn = 0, { wine = 'holy wine', keep = true } = {}) {
    return this.run(ax, az, turn, async (m0) => {
      const { url, say } = this.env, at = (t) => this.until(m0, t);
      const p = { wafer: false, chalice: false }, show = () => { this.props = [p.wafer && this.prop('holy wafer', this.wafer), p.chalice && this.prop(wine, this.stud)].filter(Boolean); };
      say('You celebrate Mass at the altar of Jesus.');
      this.heroAct('massPriest'); this.heroHold({ R: url(wine) });
      await at(1.0); this.heroHold({ R: null }); p.chalice = true; show(); // (the chalice on its stud)
      await this.awaken();
      await this.descend(m0);
      // the wafer: there on its tile, taken up, raised; a genuflection; laid back
      await at(4.2); p.wafer = true; show(); this.glint(this.wafer);
      await at(5.9); p.wafer = false; show(); this.heroHold({ R: url('holy wafer') });
      await at(7.4); say('"This is my body, which will be given up for you."');
      this.glow = { t0: this.env.clock(), T: 1.8 };
      await at(12.4); this.heroHold({ R: null }); p.wafer = true; show();
      // the chalice: taken up off its stud, raised; a genuflection
      await at(13.2); this.heroHold({ R: url(wine) }); p.chalice = false; show();
      await at(14.3); say('"This is the chalice of my blood."');
      this.glow = { t0: this.env.clock(), T: 1.6 };
      await at(19.2); this.heroHold({ R: null }); p.chalice = true; show();
      // communion: the wafer eaten, the chalice drunk from, set down; a bow
      await at(19.8); this.heroHold({ R: url('holy wafer') }); p.wafer = false; show();
      await at(20.4); say('The bread and wine are consecrated, and you receive them.');
      await at(21.5); this.heroHold({ R: null });
      await at(23.0); this.heroHold({ R: url(wine) }); p.chalice = false; show();
      await at(25.6); this.heroHold({ R: null }); p.chalice = true; show();
      await at(26.2); say('You feel the peace of Jesus.');
      await at(28.0);
      if (keep) { p.chalice = false; show(); } // (the empty chalice: back in your pack)
    });
  }

  // Communion: down on your knees on the step, hands joined; the wafer appears on its tile, rises and floats to
  // you; you lift your head and receive it; a quiet grace, a soft golden shimmer about you
  communion(ax, az, turn = 0) {
    return this.run(ax, az, turn, async () => {
      const { say, clock } = this.env;
      say('You receive Communion.');
      await this.awaken();
      await this.attend();
      this.heroAct('communion');
      const c0 = clock(), at = (t) => this.until(c0, t);
      await at(0.9); this.props = [this.prop('holy wafer', this.wafer)]; this.glint(this.wafer);
      const from = this.wafer, S = this.spot, fw = this.W0(0, 0, -14), o = this.W0(0, 0, 0);
      const to = { x: S.x - (fw.x - o.x), y: S.y + 0.84, z: S.z - (fw.z - o.z) }; // (before your mouth, knelt: a little toward the altar from you)
      await at(1.5);
      while (clock() - c0 < 3.0) { // (up off its tile and over to you, a little arc, a glimmer trailing)
        const u = Math.min(1, (clock() - c0 - 1.5) / 1.5), e = u * u * (3 - 2 * u);
        const q = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e + 0.25 * Math.sin(Math.PI * e), z: from.z + (to.z - from.z) * e };
        this.props = [this.prop('holy wafer', q, { tilt: -1.2 * e, yaw: -this.turn })]; // (turned up to face you)
        if (Math.random() < 0.3) this.sparkle({ x: q.x, y: q.y + 0.03, z: q.z }, 2, 0xfff3c0, 0.04);
        await this.wait(0);
      }
      await at(3.5); this.props = []; this.glint(to, 10, 0.05); // (received)
      await at(4.2); say('You feel a quiet grace.');
      for (let i = 0; i < 8; i++) { this.sparkle({ x: S.x, y: S.y + 0.5, z: S.z }, 10, i % 2 ? 0xfff6d0 : 0xffe27a, 0.35); await this.wait(0.28); }
      await at(FOUNT.communion.T);
    });
  }

  // alms: gold tossed from your hand into the offering plate, a coin at a time, and how it's taken (n): 0 noted;
  // 1 a hopeful feeling; 2 a sense of peace (a soft light down onto you); 3 all you had (the widow's mite: a
  // brighter light); 4 watched over (the angel on top turning to you, hands out over you). [n, said, after]: in
  // the test dungeon, each way after another
  alms(ax, az, turn = 0, gifts = [[2, null, null]]) {
    return this.run(ax, az, turn, async () => {
      const { say, clock } = this.env, S = this.spot;
      await this.awaken();
      await this.attend();
      const coins = [];
      for (const [n, said, after] of gifts) {
        if (said) say(said);
        this.heroAct('alms');
        const g0 = clock(), hand = { ...this.W0(14, -92, -86) }, flying = [];
        hand.y = S.y + 0.95;
        for (let i = 0; i < 4 + n * 1.5; i++) flying.push({ t0: g0 + 0.7 + i * 0.3, to: { x: this.plate.x + (Math.random() - 0.5) * 0.12, y: this.plate.y + coins.length * 0.004, z: this.plate.z + (Math.random() - 0.5) * 0.12 } });
        while (clock() - g0 < FOUNT.alms.T) {
          const list = [];
          for (const c of flying) {
            const u = (clock() - c.t0) / 0.45;
            if (u < 0) continue;
            if (u >= 1) { if (!c.landed) { c.landed = true; coins.push(c.to); this.sparkle({ x: c.to.x, y: c.to.y + 0.03, z: c.to.z }, 4, 0xffd34d, 0.05); } continue; }
            list.push(this.prop('_coin', { x: hand.x + (c.to.x - hand.x) * u, y: hand.y + (c.to.y - hand.y) * u + 0.22 * Math.sin(Math.PI * u), z: hand.z + (c.to.z - hand.z) * u }, { tilt: u * 6 }));
          }
          this.props = coins.map((c) => this.prop('_coin', c)).concat(list);
          await this.wait(0);
        }
        if (after) say(after);
        const light = (T, size) => this.env.brick.prayLight(S.x, S.z, T, { size });
        if (n === 1) this.sparkle({ x: S.x, y: S.y + 0.6, z: S.z }, 20, 0xfff6d0, 0.3);
        if (n === 2) light(3, 0.7);
        if (n === 3) { light(3.5, 1); for (let i = 0; i < 3; i++) setTimeout(() => this.sparkle({ x: S.x, y: S.y + 1.0, z: S.z }, 40, i % 2 ? 0xfff6d0 : 0xffe27a, 0.45), i * 250); }
        if (n === 4) { // (the angel above turns his gaze down on you, hands out over you)
          this.angels[2].act = { act: 'watch', t0: clock() };
          for (let i = 0; i < 6; i++) { const a = this.sts[2]; this.sparkle({ x: a.x, y: a.y + 1.0, z: a.z }, 12, 0xfff6d0, 0.3); await this.wait(0.35); }
          await this.wait(1);
          this.angels[2].act = { act: 'orans', t0: clock() };
        }
        await this.wait(2.2);
      }
    });
  }

  // confession: down on your knees, bowed low, hands at your brow. With his anger on you (angry), a dark haze
  // clinging about you as you kneel, lifted away as you're absolved, a light down onto you; the penance, a fast:
  // hunger, slumped. Without it, just a quiet light: at peace
  confess(ax, az, turn = 0, angry = false) {
    return this.run(ax, az, turn, async () => {
      const { say, clock, brick } = this.env, S = this.spot;
      await this.awaken();
      await this.attend();
      this.heroAct('confess');
      const c0 = clock(), at = (t) => this.until(c0, t);
      if (angry) {
        let dark = true;
        (async () => { while (dark && !this.cancelled) { brick.fx.haze(new THREE.Vector3(S.x, S.y, S.z), 1.1, 9, 0x15101c); await this.env.wait(0.12); } })();
        try {
          await at(1.0); say('You confess your sins before Jesus.');
          await at(3.4);
        } finally { dark = false; }
        say('You are absolved.  For your penance, you fast.');
        brick.prayLight(S.x, S.z, 3.5, { size: 0.9 });
        for (let i = 0; i < 3; i++) setTimeout(() => this.sparkle({ x: S.x, y: S.y + 0.6, z: S.z }, 30, 0xfff6d0, 0.4), i * 300);
        await at(FOUNT.confess.T);
        this.heroAct('slump'); say('You are beginning to feel hungry.');
        await this.wait(FOUNT.slump.T);
      } else {
        await at(1.0); say('You confess your sins before Jesus, and feel at peace.');
        await at(2.0); brick.prayLight(S.x, S.z, 3, { size: 0.6 });
        await at(FOUNT.confess.T);
      }
    });
  }

  // a corpse offered: held up to the altar in both hands; nothing burns: a glint off the cross, and you lower it,
  // refused
  offer(ax, az, turn = 0, corpse = null) {
    return this.run(ax, az, turn, async () => {
      const { say, clock, url } = this.env;
      await this.awaken();
      await this.attend();
      this.heroAct('offerUp'); this.heroHold({ R: corpse || url('corpse') });
      const o0 = clock(), at = (t) => this.until(o0, t);
      await at(1.4); say('Jesus has no need of burnt offerings.  His sacrifice was made once, for all.');
      for (let i = 0; i < 4; i++) { this.glint(this.cross, 16, 0.25); await this.wait(0.3); }
      await at(FOUNT.offerUp.T);
    });
  }

  // a good prayer at his altar, after: a glint where a holy wafer appears on it (the game lays the wafer there:
  // the engine's), and on its chalice as it fills with wine; the angels alive a while. (The prayer itself is the
  // engine's "pray": brickworld.prayBegin...)
  prayed(ax, az, turn = 0, what = 'wafer') {
    if (this.busy) { // (the wafer and then the wine: one waking)
      this.place(ax, az, turn);
      this.glint(what === 'wine' ? this.stud : this.wafer, 30, 0.2);
      return Promise.resolve();
    }
    return this.run(ax, az, turn, async () => {
      this.glint(what === 'wine' ? this.stud : this.wafer, 30, 0.2);
      await this.awaken();
      await this.attend();
      await this.wait(4);
    });
  }
}


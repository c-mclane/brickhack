// Combat feedback: weapon jabs, enemies reacting to hits, and the "you got
// hurt" effects (screen shake, claw slashes, red flash, damage numbers).
// Everything here is presentation; the game rules are untouched.

const $ = (s) => document.querySelector(s);

export class CombatFX {
  constructor() {
    this.shake = { t0: 0, amp: 0 };
    this.jabT0 = -1e9; // when the hero last attacked
    this.lastAttack = null; // {x, y, t} the square we last swung at
    this.mobFX = new Map(); // monster id -> {kind: 'hurt'|'dodge'|'lunge', t0, dx, dz}
    this.puffs = []; // {x, z, t0, parts: [{vx, vy, vz}]}
    this.labels = []; // floating text in the world: {x, y, z, text, cls, t0}
  }

  // ---- the hero swings ---------------------------------------------------
  attack(x, y, now) {
    this.jabT0 = now;
    this.lastAttack = { x, y, t: now };
    const held = $('#held');
    held.classList.remove('jab');
    void held.offsetWidth;
    held.classList.add('jab');
  }

  // 0..1 progress of the arm/weapon jab, or -1 when idle
  jab(now) {
    const k = (now - this.jabT0) / 260;
    return k >= 0 && k <= 1 ? k : -1;
  }

  // ---- read the game's messages for hits, misses and kills ---------------
  onMessage(s, motion, hero, now) {
    const a = this.lastAttack;
    if (!a || now - a.t > 1500) return;
    const mob = motion.mobAt(a.x, a.y);
    if (/^You (kill|destroy)/i.test(s)) {
      this.puff(a.x, a.y, now);
      this.lastAttack = null;
    } else if (/^You miss/i.test(s)) {
      if (mob) this.mobFX.set(mob.id, { kind: 'dodge', t0: now, dx: a.y - hero.y, dz: -(a.x - hero.x) });
      this.label(a.x + 0.5, 1.6, a.y + 0.5, 'Miss', 'miss', now);
    } else if (/^You (hit|smite|bite|kick|strike|bash|butt|claw|sting|touch|slash|stab|thrust|pummel|punch)/i.test(s)
               || /^(The |Your )?.* (is hit|staggers)/i.test(s)) {
      if (mob) this.mobFX.set(mob.id, { kind: 'hurt', t0: now, dx: a.x - hero.x, dz: a.y - hero.y });
    }
  }

  // ---- the hero gets hurt or healed -------------------------------------
  hpChange(prev, cur, hpmax, motion, hero, now) {
    if (prev == null || cur === prev) return;
    const d = cur - prev;
    if (d < 0) {
      const frac = Math.min(1, -d / Math.max(1, hpmax));
      this.shake = { t0: now, amp: 0.12 + frac * 0.6 };
      this.damageNumber(`${d}`, 'hurt');
      this.slashes(1 + Math.min(3, Math.ceil(frac * 6)));
      const v = $('#hurt-flash');
      v.classList.remove('on');
      void v.offsetWidth;
      v.classList.add('on');
      // whoever is next to you lunges in
      for (const m of motion.mobs.values()) {
        const dx = m.tx - hero.x, dz = m.tz - hero.y;
        if (Math.max(Math.abs(dx), Math.abs(dz)) === 1) this.mobFX.set(m.id, { kind: 'lunge', t0: now, dx: -dx, dz: -dz });
      }
    } else if (d > 0 && prev > 0) {
      this.damageNumber(`+${d}`, 'heal');
    }
  }

  // camera offset for the screen shake: [dx, dy, dz, dyaw, dpitch]
  shakeOffset(now) {
    const k = (now - this.shake.t0) / 350;
    if (k < 0 || k > 1) return null;
    const a = this.shake.amp * (1 - k) * (1 - k);
    const r = () => (Math.random() - 0.5) * 2;
    return [r() * a * 0.25, r() * a * 0.2, r() * a * 0.25, r() * a * 0.06, r() * a * 0.05];
  }

  // per-monster offset for its reaction animation: {dx, dy, dz, flash}
  mobOffset(mob, now) {
    const f = this.mobFX.get(mob.id);
    if (!f) return null;
    const k = (now - f.t0) / (f.kind === 'lunge' ? 320 : 380);
    if (k > 1) { this.mobFX.delete(mob.id); return null; }
    const s = Math.sin(Math.PI * k);
    const n = Math.hypot(f.dx, f.dz) || 1;
    if (f.kind === 'hurt') return { dx: (f.dx / n) * 0.3 * s, dy: 0.45 * s, dz: (f.dz / n) * 0.3 * s, flash: k < 0.35 };
    if (f.kind === 'dodge') return { dx: (f.dx / n) * 0.35 * s, dy: 0.1 * s, dz: (f.dz / n) * 0.35 * s, flash: false };
    return { dx: (f.dx / n) * 0.45 * s, dy: 0.25 * s, dz: (f.dz / n) * 0.45 * s, flash: false }; // lunge
  }

  // ---- particles and labels ---------------------------------------------
  puff(x, z, now) {
    const parts = Array.from({ length: 10 }, () => ({
      vx: (Math.random() - 0.5) * 2.2, vy: 1 + Math.random() * 1.8, vz: (Math.random() - 0.5) * 2.2,
    }));
    this.puffs.push({ x: x + 0.5, z: z + 0.5, t0: now, parts });
  }

  // sprites for the death puffs (tile = the "puff" texture)
  puffSprites(now, tile) {
    const out = [];
    this.puffs = this.puffs.filter((p) => now - p.t0 < 700);
    for (const p of this.puffs) {
      const t = (now - p.t0) / 1000;
      for (const q of p.parts)
        out.push({ x: p.x + q.vx * t - 0.5, z: p.z + q.vz * t - 0.5, lift: 0.5 + q.vy * t - 2 * t * t,
          tile, size: 0.35 * (1 - t * 1.2), shade: 1.6 });
    }
    return out;
  }

  label(x, y, z, text, cls, now) {
    const el = document.createElement('div');
    el.className = 'world-label ' + cls;
    el.textContent = text;
    $('#fx').appendChild(el);
    this.labels.push({ x, y, z, el, t0: now });
  }

  // position the world labels on screen (project: world -> [sx, sy] or null)
  updateLabels(now, project) {
    this.labels = this.labels.filter((l) => {
      const k = (now - l.t0) / 900;
      if (k > 1) { l.el.remove(); return false; }
      const p = project([l.x, l.y + k * 0.6, l.z]);
      if (!p) { l.el.style.display = 'none'; return true; }
      l.el.style.display = '';
      l.el.style.transform = `translate(${p[0]}px, ${p[1]}px) translate(-50%, -50%)`;
      l.el.style.opacity = String(1 - k * k);
      return true;
    });
  }

  damageNumber(text, cls) {
    const el = document.createElement('div');
    el.className = 'dmg-number ' + cls;
    el.textContent = text;
    el.style.left = 50 + (Math.random() - 0.5) * 8 + '%';
    $('#fx').appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  slashes(n) {
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'slash';
      el.style.left = 20 + Math.random() * 50 + '%';
      el.style.top = 15 + Math.random() * 45 + '%';
      el.style.setProperty('--rot', `${-60 + Math.random() * 40}deg`);
      el.style.animationDelay = i * 60 + 'ms';
      el.innerHTML = '<i></i><i></i><i></i>'; // three claw marks
      $('#fx').appendChild(el);
      setTimeout(() => el.remove(), 900 + i * 60);
    }
  }
}

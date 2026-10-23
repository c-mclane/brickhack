// The sounds of wands zapped and spells cast (spellfx.js plays them with what it shows): made up as they're played, in
// the browser's own synthesiser, no files: a magic missile's "pew" and the blast where it lands, fire's roar, frost's icy
// shimmer and a crystal ping, lightning's crackle and thunder, sleep's soft falling glide, death's low drone, a gas's hiss,
// acid's sizzle, a digging rumble, an explosion's boom, a healing spell's bells, light's and a wish's shimmering rise.
// Quiet till the first click, key or touch (browsers allow sound only after one), at a volume of its own (setZapVolume).

let ctx = null, master = null, noiseBuf = null;
let volume = 0.8, allowed = false;
// (unlocked by the first click, key or touch anywhere, and woken again by any after, should the browser have put it to sleep)
const unlock = () => { allowed = true; audio(); };
for (const ev of ['pointerdown', 'keydown', 'touchstart', 'mousedown']) addEventListener(ev, unlock, { capture: true, passive: true });

function audio() {
  if (!allowed) return null;
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    master = ctx.createGain(); master.gain.value = volume * 0.55; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
export function allowZapSound() { allowed = true; audio(); }
export function setZapVolume(v) { volume = v; if (master) master.gain.value = v * 0.55; }

// ---- the makings: an envelope, a tone, a noise
function env(g, t, a, peak, d, sustain = 0) { // (up to peak in a, down to sustain over d)
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + d);
}
function tone(t, { type = 'sine', f0, f1 = f0, dur, peak = 0.3, a = 0.01, vib = 0, out = master }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  if (vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 7; lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.05); }
  env(g, t, a, peak, dur);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + a + dur + 0.05);
}
function noise(t, { dur, peak = 0.3, a = 0.01, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, out = master }) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; s.loop = true;
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  env(g, t, a, peak, dur);
  s.connect(f); f.connect(g); g.connect(out);
  s.start(t, Math.random()); s.stop(t + a + dur + 0.05);
}
const bell = (t, f, peak = 0.16, dur = 0.9) => { tone(t, { f0: f, dur, peak, a: 0.005 }); tone(t, { f0: f * 2.01, dur: dur * 0.6, peak: peak * 0.35, a: 0.005 }); };

// ---- what's played. st: spellfx's style for it (its mode, its hit); when: s from now
// the bolt leaving the wand and flying (dur: s in the air)
export function zapSound(st, when = 0, dur = 0.5) {
  if (!audio()) return;
  const t = ctx.currentTime + Math.max(0, when), m = st.mode, n = st.name;
  if (m === 'lightning') {
    for (let i = 0; i < 18; i++) noise(t + Math.random() * Math.max(0.3, dur + 0.3), { dur: 0.03 + Math.random() * 0.05, peak: 0.35, type: 'highpass', f0: 2500 + Math.random() * 3000 });
    tone(t, { type: 'sawtooth', f0: 220, f1: 110, dur: 0.4, peak: 0.08 });
  } else if (n === 'fire' || st.hit === 'fire') {
    noise(t, { dur: dur + 0.3, peak: 0.32, a: 0.08, f0: 400, f1: 1400, q: 0.8 });
    noise(t, { dur: dur + 0.2, peak: 0.18, a: 0.05, type: 'lowpass', f0: 300 });
  } else if (n === 'cold' || st.hit === 'frost') {
    noise(t, { dur: dur + 0.2, peak: 0.16, a: 0.04, type: 'highpass', f0: 4000 });
    tone(t, { f0: 1800, f1: 2600, dur: dur + 0.2, peak: 0.07, vib: 40 });
  } else if (n === 'sleep') {
    tone(t, { type: 'triangle', f0: 900, f1: 380, dur: dur + 0.4, peak: 0.14, a: 0.05, vib: 18 });
  } else if (n === 'death' || st.hit === 'smoke') {
    tone(t, { type: 'sawtooth', f0: 70, f1: 55, dur: dur + 0.5, peak: 0.13, a: 0.08 });
    tone(t, { type: 'sawtooth', f0: 73, f1: 57, dur: dur + 0.5, peak: 0.1, a: 0.08 });
    noise(t, { dur: dur + 0.3, peak: 0.12, type: 'lowpass', f0: 500 });
  } else if (m === 'cloud') {
    noise(t, { dur: dur + 0.4, peak: 0.2, a: 0.12, f0: 350, f1: 700, q: 0.6 });
  } else if (m === 'spray') {
    noise(t, { dur: dur + 0.2, peak: n === 'digging' ? 0.25 : 0.16, a: 0.03, type: n === 'digging' ? 'lowpass' : 'highpass', f0: n === 'digging' ? 260 : 5000 });
  } else if (m === 'flash') {
    tone(t, { f0: 2600, f1: 1800, dur: 0.15, peak: 0.12 });
  } else if (m === 'blast') { // (a magic missile: pew)
    tone(t, { type: 'square', f0: 1500, f1: 260, dur: 0.28, peak: 0.12 });
    tone(t, { f0: 2200, f1: 600, dur: 0.22, peak: 0.08 });
  } else { // (a bolt: a bright zing, sliding down)
    tone(t, { type: 'triangle', f0: 1700, f1: 520, dur: Math.min(0.5, dur + 0.15), peak: 0.13 });
    tone(t + 0.02, { f0: 2400, f1: 900, dur: 0.25, peak: 0.05 });
  }
}
// where it lands
export function hitSound(st, when = 0) {
  if (!audio()) return;
  const t = ctx.currentTime + Math.max(0, when), h = st.hit;
  if (h === 'blast' || st.mode === 'explosion') {
    noise(t, { dur: 0.7, peak: 0.45, a: 0.005, type: 'lowpass', f0: 900, f1: 120 });
    tone(t, { f0: 110, f1: 40, dur: 0.6, peak: 0.3, a: 0.005 });
  } else if (h === 'fire') noise(t, { dur: 0.6, peak: 0.3, a: 0.01, f0: 900, f1: 300, q: 0.7 });
  else if (h === 'frost') { bell(t, 2637, 0.1, 0.6); bell(t + 0.05, 3520, 0.07, 0.5); }
  else if (h === 'flash') { noise(t, { dur: 0.25, peak: 0.45, type: 'highpass', f0: 1500 }); noise(t + 0.08, { dur: 1.2, peak: 0.3, a: 0.05, type: 'lowpass', f0: 180 }); }
  else if (h === 'hearts') [1047, 1319, 1568, 2093].forEach((f, i) => bell(t + i * 0.09, f, 0.12));
  else if (h === 'vanish' || h === 'rainbow') tone(t, { type: 'triangle', f0: 500, f1: 2000, dur: 0.5, peak: 0.1, vib: 30 });
  else if (h === 'cloud' || h === 'smoke') noise(t, { dur: 0.6, peak: 0.15, a: 0.05, type: 'lowpass', f0: 600 });
  else if (h === 'splash' || h === 'dust') noise(t, { dur: 0.35, peak: 0.25, type: 'bandpass', f0: h === 'dust' ? 300 : 3000 });
  else if (h === 'fizzle') noise(t, { dur: 0.25, peak: 0.08, type: 'highpass', f0: 3000 });
  else { noise(t, { dur: 0.25, peak: 0.18, f0: 1800, q: 1.2 }); tone(t, { f0: 880, f1: 440, dur: 0.2, peak: 0.08 }); }
}
// a zap with nowhere to go: about the caster
export function auraSound(st, when = 0) {
  if (!audio()) return;
  const t = ctx.currentTime + Math.max(0, when), h = st.hit;
  if (h === 'hearts') [784, 988, 1175, 1568, 1976].forEach((f, i) => bell(t + i * 0.1, f, 0.12, 1.1));
  else if (h === 'light' || h === 'wish' || h === 'halo') { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => bell(t + i * 0.07, f, 0.09, 1.2)); tone(t, { f0: 400, f1: 1600, dur: 0.9, peak: 0.05, vib: 20 }); }
  else if (h === 'pulse' || h === 'scan') { tone(t, { f0: 660, dur: 0.5, peak: 0.12, vib: 6 }); tone(t + 0.26, { f0: 660, dur: 0.5, peak: 0.1, vib: 6 }); }
  else if (h === 'summon' || h === 'smoke') { noise(t, { dur: 0.9, peak: 0.18, a: 0.15, f0: 250, f1: 600, q: 0.6 }); tone(t, { type: 'sawtooth', f0: 90, f1: 70, dur: 0.9, peak: 0.08 }); }
  else if (h === 'shield') tone(t, { type: 'triangle', f0: 300, f1: 600, dur: 0.6, peak: 0.12, vib: 10 });
  else if (h === 'dust' || h === 'rise') noise(t, { dur: 0.5, peak: 0.15, a: 0.05, f0: h === 'rise' ? 2000 : 300 });
  else if (h === 'fire') zapSound(st, when, 0.6);
  else if (h === 'frost') zapSound(st, when, 0.6);
  else { tone(t, { type: 'triangle', f0: 600, f1: 1500, dur: 0.6, peak: 0.1, vib: 25 }); bell(t + 0.3, 1568, 0.07); }
}

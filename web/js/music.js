// Background music: shuffle-plays the tracker modules in the local music/
// folder (served at /music/) through libopenmpt (vendor/chiptune3).
// Every session, and every game you start, begins with a random track.

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// "AGAiN/AGAiN - Link Stash 1.6.8.0 kg.xm" -> "AGAiN - Link Stash 1.6.8.0 kg"
export const trackTitle = (f) => f.split('/').pop().replace(/\.[^.]+$/, '');

export class Music {
  constructor({ volume = 0.6, onTrack = () => {} } = {}) {
    this.volume = volume;
    this.onTrack = onTrack;
    this.tracks = [];
    this.queue = [];
    this.player = null;
    this.current = null;
    this.started = false;
  }

  async load() {
    try { this.tracks = await (await fetch('/api/music')).json(); } catch { this.tracks = []; }
  }

  // browsers only allow audio after a user gesture, so call this from a click/key handler
  async start() {
    if (this.started || !this.tracks.length) return;
    this.started = true;
    const { ChiptuneJsPlayer } = await import('../vendor/chiptune3/chiptune3.js');
    this.player = new ChiptuneJsPlayer({ repeatCount: 0 });
    this.player.onInitialized(() => {
      this.player.setVol(this.volume);
      this.queue = shuffle([...this.tracks]);
      this.next();
    });
    this.player.onEnded(() => this.next());
    this.player.onError(() => setTimeout(() => this.next(), 500)); // skip unplayable files
  }

  next() {
    if (!this.player) return;
    if (!this.queue.length) {
      // played everything: reshuffle, avoiding an immediate repeat
      this.queue = shuffle(this.tracks.filter((t) => t !== this.current));
      if (this.current) this.queue.push(this.current);
    }
    this.current = this.queue.shift();
    this.player.load('/music/' + this.current.split('/').map(encodeURIComponent).join('/'));
    this.onTrack(trackTitle(this.current));
  }

  // a new game: a freshly shuffled order, starting on a different track
  reshuffle() {
    if (!this.player || !this.current) return;
    this.queue = shuffle(this.tracks.filter((t) => t !== this.current));
    this.next();
  }

  setVolume(v) {
    this.volume = v;
    if (this.player) this.player.setVol(v);
  }
}

// Ambience: a sound looped under the music while you're somewhere (a room with a fountain, a pool or lava
// in it: main.js roomNear), fading in as you come in and out as you leave. Files in the music/ folder
// (served at /music/, never shuffled in with the tunes)
export const AMBIENCE = { water: 'Fountain Sound Effect 4.mp3', lava: 'soundreality-lava-flow-202282.mp3',
  mass: '06Track6_64kb.mp3' }; // (the Agnus Dei, chanted through the Mass: from its start each time, not looped)
const ONCE = new Set(['mass']);
const FADE = 1.2; // s

export class Ambience {
  constructor(volume = 0.6) {
    this.volume = volume;
    this.sounds = new Map(); // name -> {audio, want (on or off), going (the way it last faded), timer}
    this.allowed = false; // (browsers: sound only after a click or a key)
  }
  allow() { this.allowed = true; for (const s of this.sounds.values()) this.fade(s); }
  setVolume(v) { this.volume = v; for (const s of this.sounds.values()) if (s.want && !s.timer) s.audio.volume = v; }
  // name (AMBIENCE) on or off
  set(name, on) {
    let s = this.sounds.get(name);
    if (!s && on && AMBIENCE[name]) {
      const audio = new Audio('/music/' + encodeURIComponent(AMBIENCE[name]));
      audio.loop = !ONCE.has(name);
      audio.volume = 0;
      this.sounds.set(name, (s = { audio, want: false, going: null }));
    }
    if (!s) return;
    s.want = on;
    this.fade(s);
  }
  fade(s) {
    if (!this.allowed || s.going === s.want) return; // (already on its way there)
    s.going = s.want;
    const on = s.want;
    if (on && ONCE.has([...this.sounds].find(([, v]) => v === s)[0])) s.audio.currentTime = 0; // (sung from the start)
    if (on) s.audio.play().catch(() => {});
    clearInterval(s.timer);
    const from = s.audio.volume, t0 = performance.now();
    s.timer = setInterval(() => {
      const u = Math.min(1, (performance.now() - t0) / (FADE * 1000));
      s.audio.volume = Math.max(0, Math.min(1, from + ((on ? this.volume : 0) - from) * u));
      if (u >= 1) { clearInterval(s.timer); s.timer = null; if (!on) s.audio.pause(); }
    }, 50);
  }
}

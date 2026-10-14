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

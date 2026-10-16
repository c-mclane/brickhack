// Minecraft-style name tags floating over every creature (and the hero in
// third person): what/who it is, coloured by attitude (tame, peaceful, hostile).
import { posAt, sizeHeight } from './motion.js';

const RANGE = 18; // blocks: tags further away are hidden

export class NameTags {
  constructor(layer) {
    this.layer = layer;
    this.els = new Map(); // id -> element
  }

  tag(id, text, cls) {
    let el = this.els.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'nametag';
      this.layer.appendChild(el);
      this.els.set(id, el);
    }
    if (el.textContent !== text) el.textContent = text;
    if (el.dataset.cls !== cls) { el.dataset.cls = cls; el.className = 'nametag ' + cls; }
    return el;
  }

  // entries: [{id, x, y, z, text, cls}] (world position of the tag)
  update(entries, eye, project) {
    const live = new Set();
    for (const e of entries) {
      const d = Math.hypot(e.x - eye[0], e.y - eye[1], e.z - eye[2]);
      if (d > RANGE) continue;
      const p = project([e.x, e.y, e.z]);
      if (!p) continue;
      live.add(e.id);
      const el = this.tag(e.id, e.text, e.cls);
      const k = Math.max(0.55, Math.min(1.25, 5 / Math.max(d, 0.1)));
      el.style.transform = `translate(${p[0]}px, ${p[1]}px) translate(-50%, -100%) scale(${k})`;
      el.style.opacity = d > RANGE - 4 ? String((RANGE - d) / 4) : '';
      el.style.display = '';
    }
    for (const [id, el] of this.els) if (!live.has(id)) el.style.display = 'none';
  }

  clear() {
    for (const el of this.els.values()) el.remove();
    this.els.clear();
  }
}

// tags for the monsters the engine reported (motion.mobs) and the hero
export function nameTagEntries(motion, world, now, hero) {
  const out = [];
  for (const m of motion.mobs.values()) {
    if (!m.name || !world.visible(m.tx, m.tz)) continue;
    const [mx, mz] = posAt(m, now);
    const lift = (m.fly ? 0.5 : 0) + world.standHeight(m.tx, m.tz); // (up on a tower or a pillar)
    out.push({
      id: 'm' + m.id, x: mx + 0.5, y: lift + sizeHeight(m.size) + 0.3, z: mz + 0.5,
      text: m.peace === 1 ? '♥ ' + m.name : m.name,
      cls: m.peace === 1 ? 'tame' : m.peace === 2 ? 'peaceful' : 'hostile',
    });
  }
  if (hero) out.push({ id: 'hero', ...hero, cls: 'hero' });
  return out;
}

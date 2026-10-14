// Mined blocks drop like Minecraft items: a little spinning block pops out,
// falls to the ground and bobs there until you walk over it. Close by, it
// drifts towards you; after a short delay it's picked up into your blocks.

const GRAVITY = 22; // blocks/s^2
const PICKUP_DELAY = 450; // ms before a fresh drop can be picked up
const REACH = 1.3; // blocks: walk this close to pick a drop up
const PULL = 2.6; // blocks: within this, drops drift towards you
const LIFETIME = 5 * 60 * 1000; // ms: drops left lying vanish after five minutes

export class Drops {
  constructor() {
    this.list = [];
  }

  clear() {
    this.list = [];
  }

  // a block of `type` mined at (x, y, z) (block coordinates)
  spawn(type, x, y, z, now) {
    const a = Math.random() * Math.PI * 2;
    this.list.push({
      type, t0: now,
      x: x + 0.5, y: y + 0.3, z: z + 0.5,
      vx: Math.cos(a) * 1.2, vy: 4, vz: Math.sin(a) * 1.2, // a little pop
      spin: Math.random() * Math.PI * 2,
    });
  }

  // move them; hero = [x, y, z] (feet); pick(type) is called for each picked up
  update(dt, now, world, hero, pick) {
    const [hx, hy, hz] = hero;
    this.list = this.list.filter((d) => {
      if (now - d.t0 > LIFETIME) return false;
      const dx = hx - d.x, dz = hz - d.z, dist = Math.hypot(dx, dz), near = Math.abs(hy - d.y) < 2.5;
      if (near && dist < PULL && now - d.t0 > PICKUP_DELAY) { // drift towards the hero
        d.x += (dx / (dist || 1)) * Math.min(dist, 5 * dt);
        d.z += (dz / (dist || 1)) * Math.min(dist, 5 * dt);
      } else {
        d.x += d.vx * dt;
        d.z += d.vz * dt;
      }
      d.vx *= 1 - Math.min(1, 4 * dt);
      d.vz *= 1 - Math.min(1, 4 * dt);
      d.vy -= GRAVITY * dt;
      d.y += d.vy * dt;
      const ground = world.groundAt(Math.floor(d.x), Math.floor(d.z), d.y + 0.6);
      if (d.y <= ground) { d.y = ground; d.vy = 0; }
      if (d.y < -50) return false; // fell out of the world
      if (near && dist < REACH && now - d.t0 > PICKUP_DELAY) {
        pick(d.type);
        return false;
      }
      return true;
    });
  }

  // draw them as little spinning, bobbing blocks (block(out, x, y, z, size, angle, type))
  draw(now, block) {
    for (const d of this.list) {
      const bob = 0.12 + Math.sin(now / 350 + d.spin) * 0.07;
      block(d.x, d.y + bob, d.z, 0.28, d.spin + now / 900, d.type);
    }
  }
}

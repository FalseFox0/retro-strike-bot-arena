// Thrown grenades: bouncing flight, the HE blast, the flashbang and smoke
// clouds that block sight. Values follow the CS 1.6 grenade code.

import * as THREE from '../lib/three.module.js';
import { thirdPersonWeapon, weaponAtlas } from './models.js';
import { WEAPONS } from './weapons.js';
import { dirFromAngles } from './player.js';

const GRAVITY = 800 * 0.55;   // pev->gravity = 0.55
const ELASTIC = 0.3;          // MOVETYPE_BOUNCE, friction 0.7: overbounce 1.3
const FUSE = 1.5;
const HE_DAMAGE = 100;
const HE_RADIUS = 350;        // RadiusDamage: damage * 3.5
const FLASH_RADIUS = 1500;
const SMOKE_TIME = 18;        // full cloud, then it thins out
const SMOKE_FADE = 3;
const SMOKE_RADIUS = 125;
const SMOKE_GROW = 2.2;
const MAX_CLOUDS = 6;
const SMOKE_SPRITES = 34;

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const SIM_SPIN = new THREE.Vector3();

export class Grenades {
  constructor(game, scene, T) {
    this.g = game;
    this.scene = scene;
    this.T = T;
    this.list = [];
    this.clouds = [];
    this.pool = [];
    this.mat = new THREE.MeshLambertMaterial({ map: weaponAtlas(T).texture, vertexColors: true });
    this.spritesPerCloud = SMOKE_SPRITES;
    this.seeThrough = false; // hacker mode: the view has no smoke on
    this.veil = 0;           // how far the puffs in front of the eyes are faded (render)
    this.serial = 0;         // grenades in the air get a number (online, the friends' games know them by it)
  }

  setQuality(q) {
    this.spritesPerCloud = q.effects < 1 ? 22 : SMOKE_SPRITES;
  }

  // yaw/pitch in radians (our convention), speed in units/s
  throw(owner, id, yaw, pitch, speed) {
    const g = this.g;
    const dir = dirFromAngles(yaw, pitch, new THREE.Vector3());
    const pos = g.eye(owner, new THREE.Vector3()).addScaledVector(dir, 16);
    // don't start inside a wall when throwing point blank
    const tr = g.world.traceRay(pos.x - dir.x * 16, pos.y - dir.y * 16, pos.z - dir.z * 16, dir.x, dir.y, dir.z, 16);
    if (tr) pos.set(tr.x - dir.x * 2, tr.y - dir.y * 2, tr.z - dir.z * 2);
    const vel = dir.multiplyScalar(speed).add(owner.vel);
    const mesh = new THREE.Mesh(thirdPersonWeapon(id, this.T).plain, this.mat);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.list.push({
      id, owner, team: owner.team, pos, vel, age: 0, mesh, onGround: false, cloud: null, done: false,
      spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14),
    });
  }

  tick(dt) {
    for (const n of this.list) {
      if (n.done) continue;
      n.age += dt;
      if (!n.onGround || n.vel.lengthSq() > 1) this.move(n, dt);
      if (n.id === 'smokegrenade') {
        if (!n.cloud && n.age >= FUSE && n.vel.length() < 10) this.startSmoke(n);
        if (n.cloud && this.g.time > n.cloud.start + SMOKE_TIME + SMOKE_FADE) n.done = true;
      } else if (n.age >= FUSE) {
        if (n.id === 'hegrenade') this.explodeHE(n);
        else this.explodeFlash(n);
        n.done = true;
      }
    }
    if (this.list.some((n) => n.done)) {
      for (const n of this.list) if (n.done) this.scene.remove(n.mesh);
      this.list = this.list.filter((n) => !n.done);
    }
    this.expire();
    // how big and thick each cloud is (what blocks sight), even with nothing drawn
    for (const c of this.clouds) this.grow(c, this.g.time);
  }

  // clouds that have thinned out are gone (also used by replays)
  expire() {
    this.clouds = this.clouds.filter((c) => {
      if (this.g.time <= c.start + SMOKE_TIME + SMOKE_FADE) return true;
      for (const s of c.sprites) s.visible = false;
      c.free = true;
      return false;
    });
  }

  // a cloud's size and thickness at a moment; returns how far it has spread (0..1)
  grow(c, now) {
    const t = now - c.start;
    const e = 1 - (1 - Math.min(1, t / SMOKE_GROW)) ** 3;
    const fade = t > SMOKE_TIME ? Math.max(0, 1 - (t - SMOKE_TIME) / SMOKE_FADE) : 1;
    c.alpha = Math.min(1, t * 3) * fade;
    c.radius = SMOKE_RADIUS * (0.25 + 0.75 * e);
    return e;
  }

  move(n, dt) {
    const w = this.g.world;
    if (n.onGround) {
      // a little sliding friction on the floor
      n.vel.multiplyScalar(Math.max(0, 1 - dt * 5));
      n.vel.y = 0;
      if (n.vel.lengthSq() < 25) n.vel.set(0, 0, 0);
    } else {
      n.vel.y -= GRAVITY * dt;
    }
    let remain = dt;
    for (let iter = 0; iter < 3 && remain > 0; iter++) {
      const len = n.vel.length() * remain;
      if (len < 1e-4) break;
      const dx = n.vel.x / n.vel.length(), dy = n.vel.y / n.vel.length(), dz = n.vel.z / n.vel.length();
      const hit = w.traceRay(n.pos.x, n.pos.y, n.pos.z, dx, dy, dz, len + 0.5);
      if (!hit || hit.t > len) {
        n.pos.x += dx * len;
        n.pos.y += dy * len;
        n.pos.z += dz * len;
        break;
      }
      n.pos.set(hit.x + hit.nx * 0.5, hit.y + hit.ny * 0.5, hit.z + hit.nz * 0.5);
      remain *= 1 - hit.t / len;
      this.bounce(n, hit.nx, hit.ny, hit.nz);
    }
    // the floor under a sliding grenade may end (a crate edge)
    if (n.onGround && !w.traceRay(n.pos.x, n.pos.y, n.pos.z, 0, -1, 0, 2)) n.onGround = false;
    if (n.sim) return;
    this.touchPlayers(n);
    if (n.pos.y < -200) n.done = true;
  }

  // ---------- aiming (bots) ----------
  // Where a grenade thrown with this view would go off: HE and flashbang
  // when the fuse runs out, smoke where it comes to rest. The throw follows
  // weapons.js (1.6: the view biased up, faster when aiming higher), from
  // standing still; the flight is the real one, bounces and all.
  predict(owner, id, yaw, viewPitch, out) {
    let x = -viewPitch * 180 / Math.PI;
    x = x < 0 ? -10 + x * (80 / 90) : -10 + x * (100 / 90);
    const speed = Math.min(750, (90 - x) * 6);
    const dir = dirFromAngles(yaw, -x * Math.PI / 180, v1);
    const pos = this.g.eye(owner, out).addScaledVector(dir, 16);
    const tr = this.g.world.traceRay(pos.x - dir.x * 16, pos.y - dir.y * 16, pos.z - dir.z * 16, dir.x, dir.y, dir.z, 16);
    if (tr) pos.set(tr.x - dir.x * 2, tr.y - dir.y * 2, tr.z - dir.z * 2);
    const n = { sim: true, pos, vel: v2.copy(dir).multiplyScalar(speed), onGround: false, spin: SIM_SPIN };
    const step = 0.02, end = id === 'smokegrenade' ? 3.5 : FUSE;
    for (let t = 0; t < end; t += step) {
      if (!n.onGround || n.vel.lengthSq() > 1) this.move(n, step);
      if (id === 'smokegrenade' && t >= FUSE && n.vel.length() < 10) break;
      if (pos.y < -200) break;
    }
    return pos;
  }

  // the view (yaw, pitch) whose throw goes off closest to a point, and by how
  // much it misses: { yaw, pitch, miss } (a flashbang counts in 3D, it pops in the air)
  aim(owner, id, target) {
    const eye = this.g.eye(owner, v1);
    const yaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
    const at = new THREE.Vector3();
    const miss = (vp) => {
      this.predict(owner, id, yaw, vp, at);
      return id === 'flashbang' ? at.distanceTo(target) : Math.hypot(at.x - target.x, at.z - target.z) + Math.abs(at.y - target.y) * 1.5;
    };
    let best = null;
    for (let vp = -0.6; vp <= 1.2; vp += 0.075) {
      const m = miss(vp);
      if (!best || m < best.miss) best = { yaw, pitch: vp, miss: m };
    }
    // a finer look around the best
    const c = best.pitch;
    for (let vp = c - 0.06; vp <= c + 0.06; vp += 0.015) {
      const m = miss(vp);
      if (m < best.miss) best = { yaw, pitch: vp, miss: m };
    }
    return best;
  }

  bounce(n, nx, ny, nz) {
    const speed = n.vel.length();
    const vn = n.vel.x * nx + n.vel.y * ny + n.vel.z * nz;
    n.vel.x -= nx * vn * (1 + ELASTIC);
    n.vel.y -= ny * vn * (1 + ELASTIC);
    n.vel.z -= nz * vn * (1 + ELASTIC);
    if (ny > 0.7) {
      n.vel.multiplyScalar(0.8); // BounceTouch: static friction on the ground
      if (n.vel.y < 60) {
        n.vel.y = 0;
        n.onGround = true;
      }
    }
    n.spin.multiplyScalar(0.6);
    if (!n.sim && speed > 60 && Math.abs(vn) > 30) {
      this.g.soundAt(n.id === 'hegrenade' ? 'nade_bounce' : 'nade_bounce2', n.pos, Math.min(1, speed / 500) * 0.8, 150);
    }
  }

  // grenades bounce off players too (never the thrower, like in 1.6)
  touchPlayers(n) {
    for (const p of this.g.players) {
      if (!p.alive || p === n.owner) continue;
      const r = 16, h = p.height();
      const dx = n.pos.x - p.pos.x, dz = n.pos.z - p.pos.z, y = n.pos.y - p.pos.y;
      if (Math.abs(dx) >= r || Math.abs(dz) >= r || y <= 0 || y >= h) continue;
      // push out through the nearest side
      const px = r - Math.abs(dx), pz = r - Math.abs(dz);
      if (px < pz) {
        n.pos.x = p.pos.x + Math.sign(dx || 1) * (r + 0.5);
        this.bounce(n, Math.sign(dx || 1), 0, 0);
      } else {
        n.pos.z = p.pos.z + Math.sign(dz || 1) * (r + 0.5);
        this.bounce(n, 0, 0, Math.sign(dz || 1));
      }
      n.vel.multiplyScalar(0.5);
    }
  }

  explodeHE(n) {
    const g = this.g;
    const p = n.pos.clone();
    p.y += 2;
    g.effects.explosion(p);
    g.soundAt('explode', p, 1, 500, 0.5);
    g.noiseAt(p, 2500, n.owner);
    g.shake(p, 750);
    g.breakAround(p, HE_RADIUS * 0.6, HE_DAMAGE);
    g.items.blast(p, HE_RADIUS, 1);
    const def = WEAPONS.hegrenade;
    for (const v of g.players) {
      if (!v.alive) continue;
      const center = v2.set(v.pos.x, v.pos.y + v.height() / 2, v.pos.z);
      const dist = center.distanceTo(p);
      const dmg = HE_DAMAGE - dist * (HE_DAMAGE / HE_RADIUS);
      if (dmg <= 0) continue;
      const head = v1.set(v.pos.x, v.pos.y + v.eyeHeight(), v.pos.z);
      if (!g.world.visible(p.x, p.y, p.z, center.x, center.y, center.z) && !g.world.visible(p.x, p.y, p.z, head.x, head.y, head.z)) continue;
      const dir = center.clone().sub(p).normalize();
      g.damagePlayer(v, n.owner, dmg, def, 'generic', dir, center.clone(), false);
    }
  }

  explodeFlash(n) {
    const g = this.g;
    const p = n.pos.clone();
    p.y += 2;
    g.effects.flashBurst(p);
    g.soundAt('flash_explode', p, 1, 400, 0.4);
    g.noiseAt(p, 1500, n.owner);
    for (const v of g.players) {
      if (!v.alive) continue;
      const eye = g.eye(v, v1);
      const dist = eye.distanceTo(p);
      if (dist > FLASH_RADIUS) continue;
      if (!g.world.visible(p.x, p.y, p.z, eye.x, eye.y, eye.z)) continue;
      const k = 1 - dist / FLASH_RADIUS;
      const fwd = dirFromAngles(v.yaw, v.pitch, v2);
      const to = p.clone().sub(eye).normalize();
      // looking toward it: a full white-out; looking away: weaker and shorter
      // (about 40% shorter than 1.6, for bots too)
      if (fwd.dot(to) >= 0.3) g.blind(v, 1.8 * k, 1.8 * k, 1);
      else g.blind(v, 0.45 * k, 1.05 * k, 0.78);
    }
  }

  startSmoke(n) {
    const g = this.g;
    let c = this.pool.find((x) => x.free);
    if (!c) {
      if (this.pool.length >= MAX_CLOUDS) {
        // too many at once: recycle the oldest
        c = this.clouds.shift();
        if (!c) return;
        for (const m of this.list) if (m.cloud === c) m.done = true;
      } else {
        c = { sprites: [], mats: [] };
        // a material each, so every puff can fade on its own (see render)
        for (let i = 0; i < SMOKE_SPRITES; i++) {
          c.mats.push(new THREE.SpriteMaterial({ map: this.T.smoke, transparent: true, depthWrite: false, opacity: 0, rotation: (i % 3) * 2.1 }));
          const s = new THREE.Sprite(c.mats[i]);
          s.visible = false;
          this.scene.add(s);
          c.sprites.push(s);
        }
        this.pool.push(c);
      }
    }
    c.free = false;
    c.start = g.time;
    c.pos = n.pos.clone();
    c.center = new THREE.Vector3(n.pos.x, n.pos.y + 62, n.pos.z);
    c.radius = 0;
    c.alpha = 0;
    // where each puff ends up, inside a squashed sphere
    c.targets = [];
    const L = g.lightLevel(n.pos.x, n.pos.y + 1, n.pos.z);
    const shade = 0.5 + 0.24 * Math.min(1, L);
    for (const m of c.mats) m.color.setRGB(shade, shade, shade * 1.01);
    for (let i = 0; i < c.sprites.length; i++) {
      // a tall, round cloud: about two players high
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 110;
      const ty = 20 + Math.random() * 120 * (1 - (r / 110) * 0.35);
      c.targets.push({ x: Math.cos(a) * r, y: ty, z: Math.sin(a) * r, size: 110 + Math.random() * 70, ph: Math.random() * 6 });
      c.sprites[i].visible = i < this.spritesPerCloud;
    }
    c.used = this.spritesPerCloud;
    n.cloud = c;
    this.clouds.push(c);
    g.recorder?.smoke(n.pos);
    g.net?.smoke(n.pos);
    g.soundAt('smoke_hiss', n.pos, 0.9, 260);
  }

  // Does any smoke cloud hide b from a? (sight lines for bots and the HUD)
  blocks(ax, ay, az, bx, by, bz) {
    for (const c of this.clouds) {
      if (c.alpha < 0.45 || c.radius < 30) continue;
      const r = c.radius * 0.85;
      // closest point of the segment to the cloud centre
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const len2 = dx * dx + dy * dy + dz * dz || 1;
      let t = ((c.center.x - ax) * dx + (c.center.y - ay) * dy + (c.center.z - az) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t - c.center.x, py = (ay + dy * t - c.center.y) * 1.4, pz = az + dz * t - c.center.z;
      if (px * px + py * py + pz * pz < r * r) return true;
    }
    return false;
  }

  // 0..1: how deep inside a smoke cloud this point is
  inside(x, y, z) {
    let best = 0;
    for (const c of this.clouds) {
      if (c.radius < 20) continue;
      const dx = x - c.center.x, dy = (y - c.center.y) * 1.4, dz = z - c.center.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / c.radius;
      best = Math.max(best, Math.min(1, (1.05 - d) * 2.5) * c.alpha);
    }
    return Math.max(0, best);
  }

  // per frame: grenade meshes and smoke animation
  render(dt, alpha) {
    const now = this.g.time;
    for (const n of this.list) {
      n.mesh.position.copy(n.pos);
      if (!n.onGround) {
        n.mesh.rotation.x += n.spin.x * dt;
        n.mesh.rotation.y += n.spin.y * dt;
        n.mesh.rotation.z += n.spin.z * dt;
      } else if (n.id !== 'hegrenade') {
        // cans lie on their side once they stop
        n.mesh.rotation.x += (Math.PI / 2 - n.mesh.rotation.x) * Math.min(1, dt * 10);
        n.mesh.rotation.z *= 1 - Math.min(1, dt * 10);
        n.mesh.position.y = n.pos.y + 0.9;
      }
    }
    // Puffs right in front of the eyes each cover the whole screen, and
    // drawing them all made smoke fights slow. They fade out only as far as
    // the grey "inside smoke" screen (the HUD) takes over, so nothing shows
    // through; the puffs further in still draw.
    const cam = this.g.camera;
    let veil = 0, cx = 0, cy = 0, cz = 0, fx = 0, fy = 0, fz = 0;
    if (cam && this.clouds.length) {
      cam.updateMatrixWorld();
      const m = cam.matrixWorld.elements;
      cx = m[12]; cy = m[13]; cz = m[14];
      fx = -m[8]; fy = -m[9]; fz = -m[10];
      veil = Math.min(1, this.inside(cx, cy, cz) * 1.25);
    }
    this.veil = veil; // the HUD's grey screen thickens by as much (game.js)
    for (const c of this.clouds) {
      const t = now - c.start;
      const e = this.grow(c, now);
      // hacker mode's no smoke: only a faint haze is left
      const op = 0.95 * c.alpha * (this.seeThrough ? 0.1 : 1);
      for (let i = 0; i < c.used; i++) {
        const s = c.sprites[i];
        const tg = c.targets[i];
        const drift = Math.sin(now * 0.3 + tg.ph) * 4;
        s.position.set(c.pos.x + tg.x * e + drift, c.pos.y + 6 + (tg.y - 6) * e + t * 0.4, c.pos.z + tg.z * e - drift);
        const size = tg.size * (0.3 + 0.7 * e) * (1 + Math.max(0, t - SMOKE_TIME) * 0.08);
        s.scale.set(size, size, 1);
        let k = 1;
        if (veil > 0) {
          // how far ahead of the eyes, against the puff's size
          const z = (s.position.x - cx) * fx + (s.position.y - cy) * fy + (s.position.z - cz) * fz;
          const near = Math.min(1, Math.max(0, (z - 0.1 * size) / (0.4 * size)));
          k = 1 - (1 - near * near * (3 - 2 * near)) * veil;
        }
        c.mats[i].opacity = op * k;
        s.visible = k > 0.02;
      }
    }
  }

  clear() {
    for (const n of this.list) this.scene.remove(n.mesh);
    this.list = [];
    this.veil = 0;
    for (const c of this.clouds) {
      for (const s of c.sprites) s.visible = false;
      c.free = true;
    }
    this.clouds = [];
  }

  // everything that can appear, for shader compiling up front
  prewarmObjects() {
    const out = [];
    for (const id of ['hegrenade', 'flashbang', 'smokegrenade']) {
      const m = new THREE.Mesh(thirdPersonWeapon(id, this.T).plain, this.mat);
      out.push(m);
    }
    return out;
  }
}

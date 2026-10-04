// Things lying on the ground: dropped guns (G, dying, buying a new one), the
// bomb and defuse kits in bomb defusal, and the guns and grenades a map puts
// out for players to grab (fy_ maps). Walk over a gun with that slot empty to
// take it, or press E while looking at it to swap.
// Anything on the floor can be pushed around: shot, thrown by an HE or C4
// blast, or kicked along by someone walking into it.

import * as THREE from '../lib/three.module.js';
import { WEAPONS, makeWeapon, selectSlot, deploy } from './weapons.js';
import { thirdPersonWeapon, weaponAtlas } from './models.js';
import { dirFromAngles } from './player.js';

const ITEM_GRAVITY = 800;
const SLIDE_FRICTION = 520; // units/s² of slowing down while sliding on the floor
const FLOOR_GAP = 1.2;      // the mesh rests this far above the floor
const DROPPED_STAY = 40;   // dropped guns vanish after this long in Team DM / FFA
const MAP_GUNS_RESET = 60; // Team DM / FFA: the map's guns go back in place this often

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpO = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const TWO_PI = Math.PI * 2;
// the nearest angle to a that's rest + a whole number of half turns
const settleAngle = (a, rest) => rest + Math.round((a - rest) / Math.PI) * Math.PI;

export class Items {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.enabled = false; // can players drop and pick up guns in this match?
    this.mat = new THREE.MeshLambertMaterial({ map: weaponAtlas(game.textures).texture, vertexColors: true });
    this.nextReset = Infinity;
    this.serial = 0; // each thing on the ground gets a number (online, the friends' games know it by it)
  }

  // a new match: drops allowed in bomb defusal and on maps that say so
  setup() {
    const g = this.g;
    this.clear();
    const rules = g.mapRules();
    this.enabled = !!g.bm || !!rules.drops;
    this.nextReset = Infinity;
    if (rules.groundGuns && !g.roundBased()) {
      this.placeMapGuns();
      this.nextReset = g.time + MAP_GUNS_RESET;
    }
  }

  clear() {
    for (const it of this.list) this.g.scene.remove(it.mesh);
    this.list = [];
    this.g.net?.itemsCleared();
  }

  dispose() {
    this.clear();
    this.mat.dispose();
  }

  // kind: 'weapon' | 'nade' | 'bomb' | 'kit'
  make(kind, id, w, pos, vel, owner) {
    const g = this.g;
    const tp = thirdPersonWeapon(id, g.textures);
    const mesh = new THREE.Mesh(w && w.silenced && tp.sil ? tp.sil : tp.plain, this.mat);
    // guns lie on their side, the bomb, kits and grenades flat
    mesh.rotation.set(0, Math.random() * Math.PI * 2, kind === 'weapon' ? Math.PI / 2 : 0);
    mesh.position.copy(pos);
    g.scene.add(mesh);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const it = {
      kind, id, w, pos: pos.clone(), vel: vel.clone(), onGround: false, mesh, owner,
      noPickup: g.time + 0.7, spin: (Math.random() - 0.5) * 8, born: g.time, mapGun: false,
      // tumbling in the air (rad/s), and the flat way it lies when it lands
      tumble: 0, restZ: kind === 'weapon' ? Math.PI / 2 : 0, restPos: pos.clone(), nextKick: 0,
      nid: ++this.serial,
    };
    this.list.push(it);
    this.g.net?.itemAdded(it);
    return it;
  }

  remove(it) {
    const i = this.list.indexOf(it);
    if (i < 0) return;
    this.g.scene.remove(it.mesh);
    this.list.splice(i, 1);
    this.g.net?.itemRemoved(it);
  }

  // the map's own guns and grenades, lying where the map puts them
  placeMapGuns() {
    const g = this.g;
    for (const it of this.list.filter((x) => x.mapGun)) this.remove(it);
    for (const s of g.mapRules().groundGuns) {
      const def = WEAPONS[s.id];
      const nade = def.type === 'grenade';
      const it = this.make(nade ? 'nade' : 'weapon', s.id, nade ? null : makeWeapon(s.id), v1.set(s.x, s.y + 1.2, s.z), v2.set(0, 0, 0), null);
      it.onGround = true;
      it.restPos.copy(it.pos);
      it.mapGun = true;
      it.noPickup = 0;
      it.mesh.rotation.y = s.yaw ?? it.mesh.rotation.y;
    }
  }

  // throw the weapon in a slot forward (G, buying a new one, or dying)
  drop(p, slot, toss = true) {
    const g = this.g;
    const w = p.weapons[slot];
    if (!w || w.def.type === 'knife' || w.def.type === 'grenade') return null;
    w.reloading = false;
    w.zoom = 0;
    w.resumeZoom = 0;
    w.burstLeft = 0;
    w.arming = false;
    p.weapons[slot] = null;
    if (p.slot === slot && p.alive) {
      const next = [1, 2, 3].find((s) => p.weapons[s]);
      p.slot = next || 3;
      p.lastSlot = next === 1 && p.weapons[2] ? 2 : 3;
      if (next) deploy(g, p);
    }
    const dir = dirFromAngles(p.yaw, toss ? Math.max(-0.4, p.pitch) : 0, v1);
    const pos = v2.set(p.pos.x, p.pos.y + (p.alive ? p.eyeHeight() - 12 : 30), p.pos.z);
    if (p.alive) {
      // don't push it into a wall
      const tr = g.world.traceRay(pos.x, pos.y, pos.z, dir.x, 0, dir.z, 24);
      if (!tr) pos.addScaledVector(dir.clone().setY(0), 16);
    }
    // thrown forward, or (dying, buying) falling a little way off
    const a = Math.random() * Math.PI * 2;
    const vel = toss ? dir.clone().multiplyScalar(320).add(p.vel) : new THREE.Vector3(p.vel.x + Math.cos(a) * 90, 0, p.vel.z + Math.sin(a) * 90);
    vel.y += toss ? 60 : 110;
    if (w.id === 'c4') {
      const it = this.make('bomb', 'c4', null, pos, vel, p);
      if (g.bm) g.bm.onBombDropped(it);
      return it;
    }
    return this.make('weapon', w.id, w, pos, vel, p);
  }

  // the dead drop their best gun
  onDeath(p) {
    if (!this.enabled) return;
    const best = p.weapons[1] ? 1 : p.weapons[2] ? 2 : 0;
    if (best) this.drop(p, best, false);
  }

  // walk over a gun with that slot empty to take it; use (E) swaps
  pickup(p, it, swap) {
    const g = this.g;
    if (it.kind === 'bomb' || it.kind === 'kit') {
      if (!g.bm || !g.bm.pickupSpecial(p, it)) return false;
    } else if (it.kind === 'nade') {
      const def = WEAPONS[it.id];
      if ((p.nades[it.id] || 0) >= def.max) return false;
      p.nades[it.id] = (p.nades[it.id] || 0) + 1;
      if (!p.weapons[4]) {
        p.weapons[4] = makeWeapon(it.id);
        p.weapons[4].clip = p.nades[it.id];
      } else if (p.weapons[4].id === it.id) p.weapons[4].clip = p.nades[it.id];
    } else {
      const slot = it.w.def.slot;
      if (p.weapons[slot]) {
        if (!swap) return false;
        this.drop(p, slot, true);
      }
      p.weapons[slot] = it.w;
      // switch to it like cl_autowepswitch 1 does for a better slot
      if (slot === 1 || swap || p.slot > slot) {
        p.slot = 0;
        selectSlot(g, p, slot);
      }
    }
    this.remove(it);
    g.sound('pickup', p, 0.7);
    return true;
  }

  // the gun the player is looking at, close enough to use
  inView(p) {
    const eye = this.g.eye(p, v1);
    const fwd = dirFromAngles(p.yaw, p.pitch, v2);
    let best = null, bd = 0.9;
    for (const it of this.list) {
      if (it.kind !== 'weapon') continue;
      const dx = it.pos.x - eye.x, dy = it.pos.y - eye.y, dz = it.pos.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 110) continue;
      const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d;
      if (dot > bd) { bd = dot; best = it; }
    }
    return best;
  }

  // E: swap for the gun we're looking at
  use(p) {
    if (!this.enabled) return false;
    const it = this.inView(p);
    return !!it && this.pickup(p, it, true);
  }

  // G and walking over things (called for everyone alive)
  playerTick(p, cmd) {
    if (!this.enabled) return;
    const g = this.g;
    if (cmd.drop) this.drop(p, p.slot, true);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i];
      if (!it) continue;
      if (Math.abs(it.pos.x - p.pos.x) > 26 || Math.abs(it.pos.z - p.pos.z) > 26 || it.pos.y < p.pos.y - 8 || it.pos.y > p.pos.y + 60) continue;
      if (!(it.owner === p && g.time < it.noPickup) && this.pickup(p, it, false)) continue;
      this.kick(p, it);
    }
  }

  // walking into something we don't pick up nudges it along the floor
  kick(p, it) {
    const g = this.g;
    if (!it.onGround || it.pos.y > p.pos.y + 12) return;
    const sp = Math.hypot(p.vel.x, p.vel.z);
    if (sp < 60) return;
    let dx = it.pos.x - p.pos.x, dz = it.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 22) return;
    // away from the feet, mostly the way we're walking (not when it's behind us)
    const mx = p.vel.x / sp, mz = p.vel.z / sp;
    if (d > 0.01 && (dx * mx + dz * mz) / d < -0.2) return;
    dx = d > 0.01 ? dx / d : mx;
    dz = d > 0.01 ? dz / d : mz;
    let kx = mx * 0.7 + dx * 0.3, kz = mz * 0.7 + dz * 0.3;
    const kl = Math.hypot(kx, kz) || 1;
    kx /= kl; kz /= kl;
    const want = sp * 1.15;
    if (it.vel.x * kx + it.vel.z * kz >= want * 0.8) return;
    it.vel.x = kx * want;
    it.vel.z = kz * want;
    it.spin = (Math.random() - 0.5) * 10;
    if (g.time >= it.nextKick) {
      it.nextKick = g.time + 0.4;
      g.soundAt('item_kick', it.pos, 0.6, 90);
    }
  }

  // knock something about: a bullet, a blast (velocity change in units/s)
  push(it, vx, vy, vz, tumble) {
    it.vel.x += vx;
    it.vel.y += vy;
    it.vel.z += vz;
    if (vy > 0) it.onGround = false;
    it.spin = (Math.random() - 0.5) * Math.min(30, 6 + Math.hypot(vx, vz) * 0.05);
    it.tumble = tumble;
  }

  // a bullet flying from start along dir (unit) for len units: everything it
  // passes through gets knocked away (bullets go on through, guns are thin)
  bulletHit(start, dir, len, dmg) {
    const g = this.g;
    for (const it of this.list) {
      const t = this.rayHit(it, start, dir, len);
      if (t < 0) continue;
      const imp = Math.min(520, 40 + dmg * 3.6) * (it.kind === 'bomb' ? 0.6 : 1);
      const up = 80 + imp * 0.45 + Math.max(0, -dir.y) * imp * 0.5;
      this.push(it, dir.x * imp, up, dir.z * imp, (Math.random() < 0.5 ? -1 : 1) * (6 + imp * 0.02));
      const pt = v1.copy(start).addScaledVector(dir, t);
      g.effects.sparks(pt, v2.copy(dir).negate(), 0.6);
      g.soundAt('imp_metal', pt, 0.45, 110);
    }
  }

  // where the ray enters the item's box, or -1
  rayHit(it, start, dir, len) {
    // quick reject: is the item anywhere near the line?
    tmpD.subVectors(it.pos, start);
    const along = tmpD.dot(dir);
    if (along < -40 || along > len + 40) return -1;
    if (tmpD.lengthSq() - along * along > 40 * 40) return -1;
    // into the mesh's own space, then a slab test against its box (a bit bigger: easier to hit)
    const m = it.mesh;
    m.position.copy(it.pos);
    m.updateMatrix();
    tmpM.copy(m.matrix).invert();
    tmpO.copy(start).applyMatrix4(tmpM);
    tmpD.copy(dir).transformDirection(tmpM);
    const bb = m.geometry.boundingBox;
    let t0 = 0, t1 = len;
    for (const ax of ['x', 'y', 'z']) {
      const lo = bb.min[ax] - 1, hi = bb.max[ax] + 1;
      const o = tmpO[ax], d = tmpD[ax];
      if (Math.abs(d) < 1e-6) {
        if (o < lo || o > hi) return -1;
        continue;
      }
      let a = (lo - o) / d, b = (hi - o) / d;
      if (a > b) { const s = a; a = b; b = s; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return -1;
    }
    return t0;
  }

  // an explosion throws things away from it (strength 1: an HE grenade)
  blast(pos, radius, strength) {
    const w = this.g.world;
    for (const it of this.list) {
      const dx = it.pos.x - pos.x, dy = it.pos.y - pos.y, dz = it.pos.z - pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > radius) continue;
      if (!w.visible(pos.x, pos.y, pos.z, it.pos.x, it.pos.y + 3, it.pos.z)) continue;
      const k = 1 - d / radius;
      const sp = (120 + 280 * k) * strength * (it.kind === 'bomb' ? 0.6 : 1);
      const hl = Math.hypot(dx, dz) || 1;
      this.push(it, (dx / hl) * sp * 0.7, 120 + sp * 0.6, (dz / hl) * sp * 0.7, (Math.random() < 0.5 ? -1 : 1) * (8 + sp * 0.02));
    }
  }

  tick(dt) {
    const g = this.g;
    for (const it of [...this.list]) if (!it.onGround || it.vel.x || it.vel.z) this.move(it, dt);
    if (!g.roundBased()) {
      // dropped guns don't pile up forever in Team DM / FFA
      for (const it of [...this.list]) if (it.kind === 'weapon' && !it.mapGun && g.time - it.born > DROPPED_STAY) this.remove(it);
      if (g.time >= this.nextReset) {
        this.placeMapGuns();
        this.nextReset = g.time + MAP_GUNS_RESET;
      }
    }
  }

  move(it, dt) {
    const g = this.g, w = g.world;
    if (it.onGround) {
      // sliding along the floor: friction, and off the edge if the floor ends
      const sp = Math.hypot(it.vel.x, it.vel.z);
      const ns = Math.max(0, sp - SLIDE_FRICTION * dt);
      if (ns < 4) {
        it.vel.set(0, 0, 0);
        it.restPos.copy(it.pos);
        return;
      }
      it.vel.x *= ns / sp;
      it.vel.z *= ns / sp;
      it.vel.y = 0;
      if (!w.traceRay(it.pos.x, it.pos.y, it.pos.z, 0, -1, 0, FLOOR_GAP + 3)) it.onGround = false;
    }
    if (!it.onGround) it.vel.y -= ITEM_GRAVITY * dt;
    let remain = dt;
    for (let iter = 0; iter < 3 && remain > 0; iter++) {
      const vl = it.vel.length();
      const len = vl * remain;
      if (len < 1e-4) break;
      const dx = it.vel.x / vl, dy = it.vel.y / vl, dz = it.vel.z / vl;
      const hit = w.traceRay(it.pos.x, it.pos.y, it.pos.z, dx, dy, dz, len + 1);
      if (!hit || hit.t > len) {
        it.pos.x += dx * len;
        it.pos.y += dy * len;
        it.pos.z += dz * len;
        break;
      }
      it.pos.set(hit.x + hit.nx * 1, hit.y + hit.ny * 1, hit.z + hit.nz * 1);
      remain *= Math.max(0, 1 - hit.t / len);
      const vn = it.vel.x * hit.nx + it.vel.y * hit.ny + it.vel.z * hit.nz;
      if (hit.ny > 0.7) {
        it.pos.y = hit.y + FLOOR_GAP;
        if (vn < -160) {
          // a hard landing bounces a little
          it.vel.y = -it.vel.y * 0.28;
          it.vel.x *= 0.6;
          it.vel.z *= 0.6;
          it.tumble *= 0.5;
          if (vn < -220) g.soundAt('item_land', it.pos, Math.min(0.8, -vn / 900), 100);
        } else {
          if (!it.onGround && vn < -60) g.soundAt('item_land', it.pos, 0.3, 80);
          it.onGround = true;
          it.vel.y = 0;
          it.tumble = 0;
        }
      } else {
        // off a wall (or a ceiling)
        it.vel.x -= hit.nx * vn * 1.4;
        it.vel.y -= hit.ny * vn * 1.4;
        it.vel.z -= hit.nz * vn * 1.4;
        it.vel.multiplyScalar(0.5);
        if (vn < -200) g.soundAt('item_land', it.pos, 0.4, 90);
      }
    }
    if (it.pos.y < (g.map.def.killY ?? -300)) {
      // fell out of the world: gone (the bomb comes back to where it last lay)
      if (it.kind === 'bomb') {
        it.pos.copy(it.restPos);
        it.vel.set(0, 0, 0);
        it.onGround = true;
      } else this.remove(it);
    }
  }

  render(dt) {
    for (const it of this.list) {
      const r = it.mesh.rotation;
      it.mesh.position.copy(it.pos);
      if (!it.onGround || it.vel.x || it.vel.z) r.y = (r.y + it.spin * dt) % TWO_PI;
      if (!it.onGround) {
        // a gun knocked into the air turns over
        r.x = (r.x + it.tumble * dt) % TWO_PI;
      } else {
        // and settles flat again on the floor
        it.spin *= Math.max(0, 1 - dt * 3);
        const k = Math.min(1, dt * 14);
        r.x += (settleAngle(r.x, 0) - r.x) * k;
        r.z += (settleAngle(r.z, it.restZ) - r.z) * k;
      }
    }
  }

  // anything resting on a box that just broke falls
  unsettle(box) {
    for (const it of this.list) if (it.pos.x > box.min[0] - 4 && it.pos.x < box.max[0] + 4 && it.pos.z > box.min[2] - 4 && it.pos.z < box.max[2] + 4) it.onGround = false;
  }
}

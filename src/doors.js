// Doors you open and close with E: swinging doors (offices, small rooms) and
// big sliding doors (factory halls). They stay as they are until someone
// presses E on them again; bots open the ones they walk into. Bullets go
// through them like thin walls.
//
// Collision stays axis-aligned: a swinging door is one box when closed and one
// for each way it can swing open (it swings away from whoever opens it); a
// sliding door is a single box that moves.
//
// Map definitions:
//   swing: { type: 'swing', x, z, axis: 'x' | 'z', len, y = 0, h = 112, thick = 6, mat = 'doorWood' }
//          hinge at (x, z); closed, the door runs `len` along `axis` (negative: the other way)
//   slide: { type: 'slide', min: [x, y, z], max: [x, y, z], dir: '+x' | '-x' | '+z' | '-z', dist, mat = 'doorMetal' }
//          closed at min/max, slides `dist` along `dir` to open

import * as THREE from '../lib/three.module.js';
import { HULL } from './config.js';
import { dirFromAngles } from './player.js';

const SWING_TIME = 0.6;
const SLIDE_SPEED = 120;  // units a second
const USE_RANGE = 84;
const BOT_REACH = 34;     // bots open a closed door this close to them

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

const overlapsPlayer = (b, players) => players.some((p) => p.alive &&
  p.pos.x + HULL.radius > b.min[0] && p.pos.x - HULL.radius < b.max[0] &&
  p.pos.z + HULL.radius > b.min[2] && p.pos.z - HULL.radius < b.max[2] &&
  p.pos.y + p.height() > b.min[1] && p.pos.y < b.max[1]);

// how far along a ray it meets a box (Infinity: it doesn't)
function rayHits(ox, oy, oz, dx, dy, dz, mn, mx, pad) {
  let t0 = 0, t1 = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    const lo = mn[a] - pad, hi = mx[a] + pad;
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo || o[a] > hi) return Infinity;
    } else {
      let ta = (lo - o[a]) / d[a], tb = (hi - o[a]) / d[a];
      if (ta > tb) { const q = ta; ta = tb; tb = q; }
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

// distance from a point to a box's footprint
const footDist = (b, x, z) => Math.hypot(Math.max(b.min[0] - x, 0, x - b.max[0]), Math.max(b.min[2] - z, 0, z - b.max[2]));

const dirVec = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };

export class Doors {
  // adds the doors' collision boxes to `boxes` (before the World is built)
  constructor(defs, boxes) {
    this.list = [];
    for (const d of defs || []) {
      const mat = d.mat || (d.type === 'slide' ? 'doorMetal' : 'doorWood');
      const door = { def: d, type: d.type, mat, lastUse: -10 };
      const tag = (b) => {
        b.door = door;
        b.noFloor = true;
        boxes.push(b);
        return b;
      };
      if (d.type === 'swing') {
        const t = (d.thick ?? 6) / 2, y0 = d.y ?? 0, h = d.h ?? 112, L = d.len, A = Math.abs(L);
        const mk = (x0, z0, x1, z1) => tag({ min: [Math.min(x0, x1), y0, Math.min(z0, z1)], max: [Math.max(x0, x1), y0 + h, Math.max(z0, z1)], mat });
        if (d.axis === 'x') {
          door.closed = mk(d.x, d.z - t, d.x + L, d.z + t);
          door.open = { 1: mk(d.x - t, d.z, d.x + t, d.z + A), [-1]: mk(d.x - t, d.z - A, d.x + t, d.z) };
          door.closedDir = [Math.sign(L), 0];
        } else {
          door.closed = mk(d.x - t, d.z, d.x + t, d.z + L);
          door.open = { 1: mk(d.x, d.z - t, d.x + A, d.z + t), [-1]: mk(d.x - A, d.z - t, d.x, d.z + t) };
          door.closedDir = [0, Math.sign(L)];
        }
        door.h = h;
        door.y0 = y0;
        door.len = A;
        door.thick = t * 2;
      } else {
        const [dx, dz] = dirVec[d.dir];
        const b = { min: [...d.min], max: [...d.max], mat };
        const off = [dx * d.dist, 0, dz * d.dist];
        // the grid has to know every place the box can be
        b.reach = {
          min: [Math.min(b.min[0], b.min[0] + off[0]), b.min[1], Math.min(b.min[2], b.min[2] + off[2])],
          max: [Math.max(b.max[0], b.max[0] + off[0]), b.max[1], Math.max(b.max[2], b.max[2] + off[2])],
        };
        door.box = tag(b);
        door.base = { min: [...d.min], max: [...d.max] };
        door.off = off;
      }
      this.list.push(door);
    }
    this.reset();
  }

  // everything closed (a new round, a new match)
  reset() {
    for (const d of this.list) {
      d.lastUse = -10; // (game time starts over with a new match)
      if (d.type === 'swing') {
        d.state = 0;      // 0 closed, 1 / -1 open toward +/- the other axis
        d.from = d.to = 0;
        d.t = 1;
        d.angle = 0;
        this.setSwingBoxes(d, 0);
      } else {
        d.pos = 0;
        d.target = 0;
        this.placeSlide(d);
      }
      this.pose(d);
    }
  }

  // every door out of the way (for building the bot navigation grid)
  allOff(off) {
    for (const d of this.list) {
      if (d.type === 'swing') {
        d.closed.off = off;
        d.open[1].off = off;
        d.open[-1].off = off;
      } else d.box.off = off;
    }
  }

  setSwingBoxes(d, state) {
    d.closed.off = state !== 0;
    d.open[1].off = state !== 1;
    d.open[-1].off = state !== -1;
    d.solidState = state;
  }

  placeSlide(d) {
    const b = d.box;
    for (let i = 0; i < 3; i++) {
      b.min[i] = d.base.min[i] + d.off[i] * d.pos;
      b.max[i] = d.base.max[i] + d.off[i] * d.pos;
    }
  }

  // ---------- meshes ----------
  build(T, group, shade, disposables) {
    for (const d of this.list) {
      const tex = T[d.mat];
      if (d.type === 'swing') {
        const geo = new THREE.BoxGeometry(d.len, d.h, d.thick);
        geo.translate(d.len / 2, d.h / 2, 0);
        const k = shade(d.def.x, d.y0 + 1, d.def.z);
        const mat = new THREE.MeshLambertMaterial({ map: tex, color: new THREE.Color(k, k, k) });
        const mesh = new THREE.Mesh(geo, mat);
        // a round knob on both sides, near the free edge
        const knobGeo = new THREE.SphereGeometry(1.6, 8, 6);
        const knobMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(0xb8a060).multiplyScalar(k) });
        for (const s of [1, -1]) {
          const knob = new THREE.Mesh(knobGeo, knobMat);
          knob.position.set(d.len - 6, 40, s * (d.thick / 2 + 1.2));
          mesh.add(knob);
        }
        const pivot = new THREE.Group();
        pivot.position.set(d.def.x, d.y0, d.def.z);
        pivot.add(mesh);
        group.add(pivot);
        d.mesh = pivot;
        d.baseAngle = Math.atan2(-d.closedDir[1], d.closedDir[0]);
        disposables.push(geo, mat, knobGeo, knobMat);
      } else {
        const b = d.base;
        const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], dz = b.max[2] - b.min[2];
        const geo = new THREE.BoxGeometry(w, h, dz);
        // the texture's long side runs along the door
        const k = shade((b.min[0] + b.max[0]) / 2, b.min[1] + 1, (b.min[2] + b.max[2]) / 2);
        const mat = new THREE.MeshLambertMaterial({ map: tex, color: new THREE.Color(k, k, k) });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.center = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
        group.add(mesh);
        d.mesh = mesh;
        disposables.push(geo, mat);
      }
      this.pose(d);
    }
  }

  pose(d) {
    if (!d.mesh) return;
    if (d.type === 'swing') d.mesh.rotation.y = d.baseAngle + d.angle;
    else {
      const c = d.mesh.userData.center;
      d.mesh.position.set(c[0] + d.off[0] * d.pos, c[1], c[2] + d.off[2] * d.pos);
    }
  }

  // ---------- using them ----------
  // E: the door the player looks at, close enough. Returns true if one moved.
  use(p, game) {
    const d = this.inView(p, game);
    if (!d) return false;
    this.toggle(d, p, game);
    return true;
  }

  inView(p, game) {
    if (!this.list.length) return null;
    const eye = game.eye(p, v1);
    const fwd = dirFromAngles(p.yaw, p.pitch, v2);
    const hit = game.world.traceRay(eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, USE_RANGE);
    if (hit && hit.box.door) return hit.box.door;
    // looking into a doorway (the door may be standing open off to the side)
    const reach = hit ? hit.t + 2 : USE_RANGE;
    let near = null, nt = reach;
    for (const d of this.list) {
      const b = d.type === 'swing' ? d.closed : d.base;
      const t = rayHits(eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, b.min, b.max, 6);
      if (t < nt) { nt = t; near = d; }
    }
    if (near) return near;
    // nothing straight ahead: the nearest door roughly in front of us
    let best = null, bd = Infinity;
    for (const d of this.list) {
      const b = d.type === 'swing' ? (d.solidState === 0 ? d.closed : d.open[d.solidState]) : d.box;
      const cx = Math.max(b.min[0], Math.min(eye.x, b.max[0])), cz = Math.max(b.min[2], Math.min(eye.z, b.max[2]));
      const dx = cx - eye.x, dz = cz - eye.z, dist = Math.hypot(dx, dz);
      if (dist > 64 || p.pos.y > b.max[1] || p.pos.y + p.height() < b.min[1]) continue;
      if (dist > 8 && (dx * fwd.x + dz * fwd.z) / (dist * Math.hypot(fwd.x, fwd.z) || 1) < 0.5) continue;
      if (dist < bd) { bd = dist; best = d; }
    }
    return best;
  }

  toggle(d, p, game) {
    d.lastUse = game.time;
    const center = (b) => [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2];
    if (d.type === 'swing') {
      if (d.to === 0) {
        // open it, swinging away from whoever pushed it
        const side = d.def.axis === 'x' ? Math.sign(p.pos.z - d.def.z) || 1 : Math.sign(p.pos.x - d.def.x) || 1;
        let s = -side;
        const others = game.players.filter((o) => o.alive);
        if (overlapsPlayer(d.open[s], others)) {
          if (overlapsPlayer(d.open[-s], others)) return;
          s = -s;
        }
        this.swing(d, s);
      } else {
        if (overlapsPlayer(d.closed, game.players)) return;
        this.swing(d, 0);
      }
      const [cx, cz] = center(d.closed);
      game.soundAt(d.to === 0 ? 'door_close' : 'door_open', { x: cx, y: d.y0 + 50, z: cz }, 0.8, 220, 0.15);
    } else {
      d.target = d.target ? 0 : 1;
      const [cx, cz] = center(d.box);
      game.soundAt('door_slide', { x: cx, y: d.box.min[1] + 80, z: cz }, 0.9, 380, 0.2);
    }
  }

  swing(d, to) {
    d.from = d.angle;
    d.to = to;
    d.t = 0;
    // open sideways: the angle that turns the closed direction toward the open one
    const [cx, cz] = d.closedDir;
    const [ox, oz] = d.def.axis === 'x' ? [0, to] : [to, 0];
    d.toAngle = to === 0 ? 0 : Math.atan2(-oz, ox) - Math.atan2(-cz, cx);
    while (d.toAngle > Math.PI) d.toAngle -= Math.PI * 2;
    while (d.toAngle < -Math.PI) d.toAngle += Math.PI * 2;
    d.state = to;
  }

  // ---------- every tick ----------
  update(dt, game) {
    for (const d of this.list) {
      if (d.type === 'swing') {
        if (d.t < 1) {
          d.t = Math.min(1, d.t + dt / SWING_TIME);
          const e = d.t * d.t * (3 - 2 * d.t);
          d.angle = d.from + (d.toAngle - d.from) * e;
          // the solid box follows the door partway through the swing
          if (d.solidState !== d.to && d.t >= (d.to === 0 ? 0.7 : 0.3)) this.setSwingBoxes(d, d.to);
          this.pose(d);
        }
      } else if (d.pos !== d.target) {
        const step = (dt * SLIDE_SPEED) / Math.hypot(d.off[0], d.off[2]);
        const prev = d.pos;
        d.pos = d.target > d.pos ? Math.min(d.target, d.pos + step) : Math.max(d.target, d.pos - step);
        this.placeSlide(d);
        if (d.target === 0 && overlapsPlayer(d.box, game.players)) {
          // somebody's in the way: go back open, like a 1.6 door
          d.pos = prev;
          d.target = 1;
          this.placeSlide(d);
        }
        if (d.pos === d.target) {
          const b = d.box;
          game.soundAt('door_stop', { x: (b.min[0] + b.max[0]) / 2, y: b.min[1] + 60, z: (b.min[2] + b.max[2]) / 2 }, 0.8, 300, 0.2);
        }
        this.pose(d);
      }
    }
    // bots push open the closed doors they walk into
    for (const p of game.players) {
      if (!p.alive || !p.isBot) continue;
      for (const d of this.list) {
        if (game.time - d.lastUse < 1.2) continue;
        const closed = d.type === 'swing' ? d.to === 0 : d.target === 0;
        if (!closed) continue;
        const b = d.type === 'swing' ? d.closed : d.box;
        if (p.pos.y > b.max[1] || p.pos.y + p.height() < b.min[1]) continue;
        if (footDist(b, p.pos.x, p.pos.z) < BOT_REACH && p.brain && p.brain.wantsThrough(b)) this.toggle(d, p, game);
      }
    }
  }
}

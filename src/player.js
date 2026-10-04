// Player state shared by the human and the bots, plus hitbox ray tests.

import * as THREE from '../lib/three.module.js';
import { HULL, PM, DEG } from './config.js';

// Hitboxes in the player's local frame (feet origin, facing -Z).
// [group, minX, minY, minZ, maxX, maxY, maxZ]
const HB_STAND = [
  ['head', -5, 56, -6, 5, 69, 5],
  ['chest', -9.5, 44, -6.5, 9.5, 56, 5.5],
  ['stomach', -8.5, 33, -5.5, 8.5, 44, 5],
  ['arm', -9, 44, -22, 9, 53, -6.5],
  ['leg', -8.5, 0, -5, 8.5, 33, 5],
];
const HB_DUCK = [
  ['head', -5, 37, -16, 5, 50, -5],
  ['chest', -9.5, 26, -12, 9.5, 39, 0],
  ['stomach', -8.5, 16, -8, 8.5, 27, 4],
  ['arm', -9, 28, -26, 9, 37, -12],
  ['leg', -9, 0, -18, 9, 17, 6],
];

export const HITGROUP_MULT = { head: 4, chest: 1, stomach: 1.25, arm: 1, leg: 0.75 };

const spline = (v) => v * v * (3 - 2 * v);

export class Player {
  constructor(id, name, isBot) {
    this.id = id;
    this.name = name;
    this.isBot = isBot;
    this.team = null;   // 'T' | 'CT' | null (FFA)
    this.look = 'T';    // which model to wear
    this.alive = false;
    this.health = 100;
    this.armor = 0;
    this.helmet = false;
    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.punchPitch = 0; // degrees, + is up
    this.punchYaw = 0;   // degrees, + is left
    this.onGround = false;
    this.ducked = false;
    this.inDuck = false;
    this.duckTimer = 0;
    this.fuser2 = 0;
    this.oldJump = false;
    this.fallVelocity = 0;
    this.ladderCooldown = 0;
    this.waterDepth = 0;
    this.velMod = 1;
    this.maxspeed = 250;
    this.moveEvents = { landed: 0, jumped: false };
    this.weapons = { 1: null, 2: null, 3: null, 4: null, 5: null };
    this.nades = {};
    // bomb defusal
    this.money = 0;
    this.defuser = false;
    this.defusing = false;
    this.buys = [];      // what was bought this round (for rebuy)
    this.lastBuys = [];
    this.blindUntil = 0;
    this.slot = 3;
    this.lastSlot = 2;
    this.nextAttackTime = 0;
    this.oldAttack = false;
    this.oldAttack2 = false;
    this.kills = 0;
    this.deaths = 0;
    this.score = 0;
    this.spawnProtectUntil = 0;
    this.respawnAt = 0;
    this.diedAt = 0;
    this.killer = null;
    this.stepAccum = 0;
    this.model = null;
    this.brain = null;
    this.lastDamageTime = -10;
    this.lastHitFrom = null;
    this.firingFlash = 0;
    // hacker mode (hacks.js): which hacks are on, their sliders, kills made hacking
    this.hacks = {};
    this.hackCfg = null;
    this.hacking = false;
    this.hackKills = 0;
  }

  height() {
    return this.ducked ? HULL.duck : HULL.stand;
  }

  duckAmount() {
    if (this.ducked) return 1;
    if (this.inDuck) return spline(Math.min(1, this.duckTimer / PM.timeToDuck));
    return 0;
  }

  eyeHeight() {
    if (this.ducked) return HULL.eyeDuck;
    return HULL.eyeStand + (HULL.eyeDuck - HULL.eyeStand) * this.duckAmount();
  }

  get weapon() {
    return this.weapons[this.slot];
  }

  isProtected(time) {
    return time < this.spawnProtectUntil;
  }

  aimYaw() {
    return this.yaw + this.punchYaw * DEG;
  }

  aimPitch() {
    return this.pitch + this.punchPitch * DEG;
  }

  resetMovement() {
    this.vel.set(0, 0, 0);
    this.onGround = false;
    this.ducked = false;
    this.inDuck = false;
    this.duckTimer = 0;
    this.fuser2 = 0;
    this.oldJump = false;
    this.fallVelocity = 0;
    this.ladderCooldown = 0;
    this.waterDepth = 0;
    this.velMod = 1;
    this.punchPitch = 0;
    this.punchYaw = 0;
  }
}

export function dirFromAngles(yaw, pitch, out = new THREE.Vector3()) {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

function slab(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = Infinity, t1, t2;
  if (Math.abs(dx) < 1e-9) { if (ox < x0 || ox > x1) return -1; }
  else { t1 = (x0 - ox) / dx; t2 = (x1 - ox) / dx; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return -1; }
  if (Math.abs(dy) < 1e-9) { if (oy < y0 || oy > y1) return -1; }
  else { t1 = (y0 - oy) / dy; t2 = (y1 - oy) / dy; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return -1; }
  if (Math.abs(dz) < 1e-9) { if (oz < z0 || oz > z1) return -1; }
  else { t1 = (z0 - oz) / dz; t2 = (z1 - oz) / dz; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return -1; }
  return tmin;
}

// Ray against a player's hitboxes. Returns { t, group } or null.
export function rayVsPlayer(p, ox, oy, oz, dx, dy, dz, maxT) {
  const lx = ox - p.pos.x, ly = oy - p.pos.y, lz = oz - p.pos.z;
  // cheap bounding box reject (world space)
  if (slab(lx, ly, lz, dx, dy, dz, -30, -2, -30, 30, 76, 30) < 0) return null;
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const rx = lx * c - lz * s, rz = lx * s + lz * c;
  const rdx = dx * c - dz * s, rdz = dx * s + dz * c;
  const boxes = p.duckAmount() > 0.5 ? HB_DUCK : HB_STAND;
  let best = maxT, group = null;
  for (const b of boxes) {
    const t = slab(rx, ly, rz, rdx, dy, rdz, b[1], b[2], b[3], b[4], b[5], b[6]);
    if (t >= 0 && t < best) {
      best = t;
      group = b[0];
    }
  }
  return group ? { t: best, group } : null;
}

// Points bots aim at (world space)
export function aimPoint(p, part, out = new THREE.Vector3()) {
  const duck = p.duckAmount() > 0.5;
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  let ly, lz;
  if (part === 'head') { ly = duck ? 43.5 : 62.5; lz = duck ? -10.5 : -0.5; }
  else { ly = duck ? 32 : 49; lz = duck ? -6 : -0.5; }
  // local→world: x = lx c + lz s ; z = -lx s + lz c (lx = 0)
  return out.set(p.pos.x + lz * s, p.pos.y + ly, p.pos.z + lz * c);
}

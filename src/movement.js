// Player movement, written to behave like GoldSrc's pm_shared.c, with the
// CS 1.6 changes: jump stamina (fuser2), landing slowdown and the
// bunnyhop speed cap. Ladders are simple: forward climbs, back goes down,
// jump lets go. Shallow water slows you down.

import { PM, HULL } from './config.js';

const tr = {};
const CLIMB_SPEED = 200;  // MAX_CLIMB_SPEED
const WADE_SLOW = 0.4;    // waist-deep water takes this much off your speed
const WADE_DEPTH = 28;
const STUCK_DIRS = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, -1, 0]];

export function playerMove(p, cmd, world, others, dt) {
  const ev = p.moveEvents;
  ev.landed = 0;
  ev.jumped = false;
  ev.ladder = false;

  if (p.fuser2 > 0) p.fuser2 = Math.max(0, p.fuser2 - dt * 1000);

  if (!world.hullFits(p.pos.x, p.pos.y, p.pos.z, p.height(), others)) unstick(p, world, others);

  categorize(p, world, others);
  if (!p.onGround) p.fallVelocity = -p.vel.y;

  duck(p, cmd, world, others, dt);

  if (p.ladderCooldown > 0) p.ladderCooldown -= dt;
  const lad = p.ladderCooldown > 0 ? null : ladderFor(p, cmd, world);
  if (lad) {
    ladderMove(p, cmd, lad, world, others, dt);
    return;
  }

  p.waterDepth = waterDepth(p, world);

  if (!p.onGround) p.vel.y -= PM.gravity * 0.5 * dt;

  if (cmd.jump) jump(p);
  else p.oldJump = false;

  if (p.onGround) {
    p.vel.y = 0;
    friction(p, dt, world);
  }
  clampVelocity(p);

  // Wish direction comes from the view yaw only.
  const fm = cmd.forward, sm = cmd.side;
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  let wx = -sy * fm + cy * sm, wz = -cy * fm - sy * sm;
  const wl = Math.hypot(wx, wz);
  let wishspeed = 0;
  if (wl > 1e-4) {
    wx /= wl;
    wz /= wl;
    wishspeed = p.maxspeed;
    if (cmd.walk) wishspeed *= PM.walkMul;
    if (p.ducked) wishspeed *= PM.duckMul;
    if (p.waterDepth > 4) wishspeed *= 1 - WADE_SLOW * Math.min(1, p.waterDepth / WADE_DEPTH);
  }

  if (p.onGround) walkMove(p, wx, wz, wishspeed, world, others, dt);
  else airMove(p, wx, wz, wishspeed, world, others, dt);

  categorize(p, world, others);
  clampVelocity(p);
  if (!p.onGround) p.vel.y -= PM.gravity * 0.5 * dt;
  if (p.onGround) {
    if (p.fallVelocity > 0) ev.landed = p.fallVelocity;
    p.vel.y = 0;
    p.fallVelocity = 0;
  }
}

// The ladder the player is on, if any. Standing on the floor you only get on
// by pushing forward into it, and never from the floor at its top.
export function ladderFor(p, cmd, world) {
  const L = world.ladders;
  if (!L || !L.length) return null;
  const r = HULL.radius, x = p.pos.x, y = p.pos.y, z = p.pos.z;
  for (const lad of L) {
    if (x + r <= lad.min[0] || x - r >= lad.max[0] || z + r <= lad.min[2] || z - r >= lad.max[2]) continue;
    if (y + p.height() <= lad.min[1] || y >= lad.max[1]) continue;
    if (p.onGround && (cmd.forward <= 0 || y >= lad.top - 4)) return null;
    return lad;
  }
  return null;
}

function ladderMove(p, cmd, lad, world, others, dt) {
  p.moveEvents.ladder = true;
  p.fallVelocity = 0;
  p.waterDepth = 0;
  if (cmd.jump) {
    if (!p.oldJump) {
      // let go, pushing off the ladder
      p.oldJump = true;
      p.ladderCooldown = 0.35;
      p.onGround = false;
      p.vel.set(lad.nx * 270, 0, lad.nz * 270);
      flyMove(p, world, others, dt);
      return;
    }
  } else p.oldJump = false;
  // up and down with forward / back, sideways along the ladder with the strafe keys
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  const ax = -lad.nz, az = lad.nx;
  const along = (cy * ax - sy * az) * cmd.side * CLIMB_SPEED * 0.5;
  let vx = ax * along, vz = az * along, vy = cmd.forward * CLIMB_SPEED;
  // over the top: stop rising and step off onto the floor behind the ladder
  if (cmd.forward > 0 && p.pos.y > lad.top - 4) {
    if (p.pos.y > lad.top + 2) vy = 0;
    vx -= lad.nx * 220;
    vz -= lad.nz * 220;
  }
  p.vel.set(vx, vy, vz);
  flyMove(p, world, others, dt);
  categorize(p, world, others);
  if (p.onGround) p.vel.y = 0;
}

// How deep the player's feet are in water (0 when dry).
export function waterDepth(p, world) {
  const W = world.water;
  if (!W) return 0;
  const { x, y, z } = p.pos;
  for (const w of W) {
    if (x > w.min[0] && x < w.max[0] && z > w.min[2] && z < w.max[2] && y < w.max[1] && y > w.min[1] - 2) return w.max[1] - y;
  }
  return 0;
}

function categorize(p, world, others) {
  if (p.vel.y > 180) {
    p.onGround = false;
    return;
  }
  world.traceHull(p.pos.x, p.pos.y, p.pos.z, p.pos.x, p.pos.y - 2, p.pos.z, p.height(), others, tr);
  if (tr.frac < 1 && tr.ny >= 0.7) {
    p.onGround = true;
    if (!tr.startSolid) p.pos.y = tr.y;
  } else {
    p.onGround = false;
  }
}

function duck(p, cmd, world, others, dt) {
  const half = (HULL.stand - HULL.duck) / 2;
  if (cmd.duck) {
    if (p.ducked) return;
    if (!p.onGround) {
      // Ducking in the air is instant and pulls the feet up (crouch-jump).
      p.ducked = true;
      p.inDuck = false;
      p.duckTimer = 0;
      p.pos.y += half;
      return;
    }
    if (!p.inDuck) {
      p.inDuck = true;
      p.duckTimer = 0;
    }
    p.duckTimer += dt;
    if (p.duckTimer >= PM.timeToDuck) {
      p.ducked = true;
      p.inDuck = false;
    }
    return;
  }
  if (p.inDuck && !p.ducked) {
    p.inDuck = false;
    p.duckTimer = 0;
    return;
  }
  if (p.ducked) {
    const ny = p.onGround ? p.pos.y : p.pos.y - half;
    if (world.hullFits(p.pos.x, ny, p.pos.z, HULL.stand, others)) {
      p.ducked = false;
      p.pos.y = ny;
    }
  }
}

function jump(p) {
  if (!p.onGround) {
    p.oldJump = true; // must release jump before it works again
    return;
  }
  if (p.oldJump) return;
  preventMegaBunnyJumping(p);
  p.onGround = false;
  p.vel.y = PM.jumpSpeed;
  if (p.fuser2 > 0) p.vel.y *= (100 - p.fuser2 * 0.001 * 19) * 0.01;
  p.fuser2 = 1315.789429;
  p.oldJump = true;
  p.moveEvents.jumped = true;
}

function preventMegaBunnyJumping(p) {
  const maxscaled = PM.bunnyjumpMaxSpeedFactor * p.maxspeed;
  if (maxscaled <= 0) return;
  const spd = p.vel.length();
  if (spd <= maxscaled) return;
  p.vel.multiplyScalar((maxscaled / spd) * 0.8);
}

function friction(p, dt, world) {
  const v = p.vel;
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed < 0.1) return;
  // if the leading edge is over a drop-off, friction doubles (sv_edgefriction)
  let fric = PM.friction;
  const sx = p.pos.x + (v.x / speed) * 16, sz = p.pos.z + (v.z / speed) * 16;
  if (!world.traceRay(sx, p.pos.y + 0.5, sz, 0, -1, 0, 34.5)) fric *= PM.edgefriction;
  const control = speed < PM.stopspeed ? PM.stopspeed : speed;
  const drop = control * fric * dt;
  let ns = speed - drop;
  if (ns < 0) ns = 0;
  v.multiplyScalar(ns / speed);
}

function clampVelocity(p) {
  const v = p.vel, m = PM.maxvelocity;
  if (v.x > m) v.x = m; else if (v.x < -m) v.x = -m;
  if (v.y > m) v.y = m; else if (v.y < -m) v.y = -m;
  if (v.z > m) v.z = m; else if (v.z < -m) v.z = -m;
}

function accelerate(p, wx, wz, wishspeed, accel, dt) {
  const cur = p.vel.x * wx + p.vel.z * wz;
  const add = wishspeed - cur;
  if (add <= 0) return;
  let acc = accel * dt * wishspeed;
  if (acc > add) acc = add;
  p.vel.x += acc * wx;
  p.vel.z += acc * wz;
}

function airAccelerate(p, wx, wz, wishspeed, accel, dt) {
  if (wishspeed === 0) return;
  const wishspd = Math.min(wishspeed, 30);
  const cur = p.vel.x * wx + p.vel.z * wz;
  const add = wishspd - cur;
  if (add <= 0) return;
  let acc = accel * wishspeed * dt;
  if (acc > add) acc = add;
  p.vel.x += acc * wx;
  p.vel.z += acc * wz;
}

function walkMove(p, wx, wz, wishspeed, world, others, dt) {
  // CS 1.6: still slowed down for a while after landing a jump
  if (p.fuser2 > 0) {
    const r = (100 - p.fuser2 * 0.001 * 19) * 0.01;
    p.vel.x *= r;
    p.vel.z *= r;
  }
  p.vel.y = 0;
  accelerate(p, wx, wz, wishspeed, PM.accelerate, dt);
  p.vel.y = 0;
  if (Math.hypot(p.vel.x, p.vel.z) < 1) {
    p.vel.x = p.vel.z = 0;
    return;
  }
  const pos = p.pos, vel = p.vel, h = p.height();
  world.traceHull(pos.x, pos.y, pos.z, pos.x + vel.x * dt, pos.y, pos.z + vel.z * dt, h, others, tr);
  if (tr.frac === 1) {
    pos.set(tr.x, tr.y, tr.z);
    return;
  }
  const ox = pos.x, oy = pos.y, oz = pos.z, ovx = vel.x, ovy = vel.y, ovz = vel.z;
  flyMove(p, world, others, dt);
  const dX = pos.x, dY = pos.y, dZ = pos.z, dvx = vel.x, dvy = vel.y, dvz = vel.z;

  // Try the same move from one step higher (stairs).
  pos.set(ox, oy, oz);
  vel.set(ovx, ovy, ovz);
  world.traceHull(ox, oy, oz, ox, oy + PM.stepsize, oz, h, others, tr);
  if (!tr.startSolid) pos.y = tr.y;
  flyMove(p, world, others, dt);
  world.traceHull(pos.x, pos.y, pos.z, pos.x, pos.y - PM.stepsize, pos.z, h, others, tr);
  if (tr.frac === 1 || tr.ny < 0.7) {
    pos.set(dX, dY, dZ);
    vel.set(dvx, dvy, dvz);
    return;
  }
  if (!tr.startSolid) pos.set(tr.x, tr.y, tr.z);
  const upDist = (pos.x - ox) ** 2 + (pos.z - oz) ** 2;
  const downDist = (dX - ox) ** 2 + (dZ - oz) ** 2;
  if (downDist > upDist) {
    pos.set(dX, dY, dZ);
    vel.set(dvx, dvy, dvz);
  } else {
    vel.y = dvy;
  }
}

function airMove(p, wx, wz, wishspeed, world, others, dt) {
  airAccelerate(p, wx, wz, wishspeed, PM.airaccelerate, dt);
  flyMove(p, world, others, dt);
}

// Slide along up to 4 planes (PM_FlyMove).
function flyMove(p, world, others, dt) {
  const pos = p.pos, vel = p.vel, h = p.height();
  const pvx = vel.x, pvy = vel.y, pvz = vel.z;
  const planes = [];
  let timeLeft = dt;
  for (let bump = 0; bump < 4; bump++) {
    if (vel.x === 0 && vel.y === 0 && vel.z === 0) break;
    world.traceHull(pos.x, pos.y, pos.z, pos.x + vel.x * timeLeft, pos.y + vel.y * timeLeft, pos.z + vel.z * timeLeft, h, others, tr);
    if (tr.frac > 0) {
      pos.set(tr.x, tr.y, tr.z);
      planes.length = 0;
    }
    if (tr.frac === 1) break;
    timeLeft -= timeLeft * tr.frac;
    planes.push(tr.nx, tr.ny, tr.nz);
    for (let i = 0; i < planes.length; i += 3) {
      const back = vel.x * planes[i] + vel.y * planes[i + 1] + vel.z * planes[i + 2];
      if (back < 0) {
        vel.x -= planes[i] * back;
        vel.y -= planes[i + 1] * back;
        vel.z -= planes[i + 2] * back;
      }
    }
    if (Math.abs(vel.x) < 0.1) vel.x = 0;
    if (Math.abs(vel.y) < 0.1) vel.y = 0;
    if (Math.abs(vel.z) < 0.1) vel.z = 0;
    if (vel.x * pvx + vel.y * pvy + vel.z * pvz <= 0) {
      vel.set(0, 0, 0);
      break;
    }
  }
}

function unstick(p, world, others) {
  const h = p.height(), { x, y, z } = p.pos;
  for (let d = 1; d <= 64; d *= 2) {
    for (const [ox, oy, oz] of STUCK_DIRS) {
      if (world.hullFits(x + ox * d, y + oy * d, z + oz * d, h, others)) {
        p.pos.set(x + ox * d, y + oy * d, z + oz * d);
        return;
      }
    }
  }
}

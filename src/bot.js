// Bot AI: perception (sight with FOV, hearing, being shot), A* roaming,
// human-like aim with reaction time and error, and burst/tap discipline.
// In bomb defusal they play the team plan from bomb.js: Terrorists gather
// outside a site and go in together behind smokes and flashes, Counter-
// Terrorists hold angles on the way in, rotate when a teammate calls
// enemies, and retake and defuse together. They throw grenades (aimed by
// simulating the throw), look away from their team's flashbangs, talk on
// the radio, climb ladders, open doors and pick up guns (and the ones
// teammates drop for them). In hacker mode a bot can be given hacks: it then
// knows where enemies are through walls (wallhack / ESP) or anywhere (radar),
// ignores flashes and smoke, and aims like an aimbot (the rest of the hacks
// work for bots the same way as for people, in hacks.js and game.js).

import * as THREE from '../lib/three.module.js';
import { DEG, HULL } from './config.js';
import { aimPoint, rayVsPlayer } from './player.js';
import { profile } from './arena.js';

export const DIFFICULTY = {
  // flashDodge: how often an enemy flashbang seen flying in makes them turn away
  easy: { reaction: 0.7, aimRate: 4.5, maxTurn: 4, aimError: 0.1, settle: 1.3, head: 0.1, recoilComp: 0, strafe: 0.15, crouch: 0, click: 0.42, fov: 100, burst: 3, flashDodge: 0.15 },
  normal: { reaction: 0.45, aimRate: 7.5, maxTurn: 7, aimError: 0.06, settle: 2.0, head: 0.25, recoilComp: 0.35, strafe: 0.5, crouch: 0.15, click: 0.3, fov: 115, burst: 4, flashDodge: 0.4 },
  hard: { reaction: 0.28, aimRate: 11, maxTurn: 11, aimError: 0.035, settle: 3.2, head: 0.45, recoilComp: 0.7, strafe: 0.8, crouch: 0.3, click: 0.22, fov: 125, burst: 5, flashDodge: 0.6 },
  expert: { reaction: 0.17, aimRate: 17, maxTurn: 16, aimError: 0.02, settle: 4.5, head: 0.65, recoilComp: 0.9, strafe: 1, crouch: 0.35, click: 0.17, fov: 135, burst: 6, flashDodge: 0.75 },
};

// what a difficulty bot has beyond its table (a Bot Arena character has its
// own of everything: see profile() in arena.js)
const PLAIN = { style: null, bhop: 0, nadeUse: 0.5, teamwork: 0.6, nadeErr: 0 };

// how long after seeing / hearing an enemy a bot still goes after them, by play style
const CHASE = { rusher: [8, 9], careful: [5, 6], camper: [3, 3], lurker: [6, 7] };

const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const trace = {};

export class Bot {
  // character: a Bot Arena character (its skills, style and habits), else
  // the bot plays at the difficulty
  constructor(game, player, difficulty, character) {
    this.g = game;
    this.p = player;
    if (character) this.d = profile(character);
    else {
      const d = DIFFICULTY[difficulty] || DIFFICULTY.normal;
      this.d = { ...PLAIN, ...d, counterStrafe: d.strafe > 0.4 };
    }
    // how much more (or less) than a plain bot they throw grenades
    this.nadeK = this.d.nadeUse * 2;
    this.reset();
  }

  reset() {
    this.target = null;
    this.targetPart = 'chest';
    this.seenAt = 0;
    this.reactUntil = 0;
    this.lastSeenPos = null;
    this.lastSeenTime = -100;
    this.heardPos = null;
    this.heardTime = -100;
    this.path = null;
    this.pathIdx = 0;
    this.goal = null;
    this.repathAt = 0;
    this.nextPerceive = Math.random() * 0.1;
    this.errYaw = 0;
    this.errPitch = 0;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeUntil = 0;
    this.burstLeft = 0;
    this.holdFireUntil = 0;
    this.lastClip = -1;
    this.clickToggle = false;
    this.nextClick = 0;
    this.duckUntil = 0;
    this.stuckCheckAt = 0;
    this.stuckPos = new THREE.Vector3();
    this.stuckCount = 0;
    this.jumpNext = false;
    this.lookYaw = this.p.yaw;
    this.lookPitch = 0;
    this.preAim = null;     // hacker mode: an enemy we see through a wall and aim at
    // play styles (Bot Arena characters)
    this.camp = null;       // a camper's lookout: { x, y, z, yaw, until }
    this.lossHoldUntil = 0; // careful: keep the angle a moment after losing sight
    this.bhopUntil = 0;     // bunny hopping along a straight, or not, until then
    this.bhopping = false;
    this.mateCall = null;   // a teammate got hit here (team players go help)
    this.zoomWaitUntil = 0;
    this.blindUntil = 0;
    // bomb defusal
    this.spot = null;       // where to stand at the objective
    this.holdUntil = 0;
    this.holdYaw = this.p.yaw;
    this.bombPos = null;    // planted bomb we know about
    this.wantSlot = 0;
    this.spotKind = null;   // the gathering spot we're headed for (bomb defusal)
    this.rotateDelay = 0.5 + Math.random() * 1.5; // CT: how quickly we rotate to a teammate's call
    this.inPosSaid = false;
    // grenades
    this.nade = null;       // a throw in progress: { id, yaw, pitch, until }
    this.nextNadeThink = 0;
    this.lostHandled = -1;  // the lost contact we already thought about a grenade for
    this.alertNaded = -1;
    // radio
    this.askedBackup = false;
    this.clearAt = 0;
    this.lastContact = -100;
    this.moveX = 0;         // the way we're walking (for opening doors)
    this.moveZ = 0;
    this.movedAt = -1;
  }

  // a closed door is in front of us: do we want to go through it?
  wantsThrough(b) {
    if (this.target || this.g.time - this.movedAt > 0.3) return false;
    const p = this.p;
    const cx = Math.max(b.min[0], Math.min(p.pos.x, b.max[0])) - p.pos.x;
    const cz = Math.max(b.min[2], Math.min(p.pos.z, b.max[2])) - p.pos.z;
    const d = Math.hypot(cx, cz);
    return d < 1 || (cx * this.moveX + cz * this.moveZ) / d > 0.3;
  }

  // a flashbang went off in our face: no sight until it wears off
  onBlind(until) {
    if (until <= this.blindUntil) return;
    this.blindUntil = until;
    this.target = null;
    this.burstLeft = 0;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
  }

  onDamaged(attacker) {
    const g = this.g, p = this.p;
    if (!attacker || attacker === p || !g.isEnemy(p, attacker)) return;
    if (p.health > 0 && p.health < 45 && !this.askedBackup) {
      this.askedBackup = true;
      g.radio.say(p, Math.random() < 0.5 ? 'needBackup' : 'takingFire');
    }
    if (!this.target) {
      this.lastSeenPos = attacker.pos.clone();
      this.lastSeenTime = this.g.time;
      this.heardPos = attacker.pos.clone();
      this.heardTime = this.g.time;
      this.forceLook = attacker;
    }
  }

  onNoise(pos, source) {
    if (this.target) return;
    // with a job to do, only noises close by are worth a look
    if (this.g.bm && pos.distanceToSquared(this.p.pos) > 900 * 900) return;
    if (this.g.bm && this.p.weapons[5]) return;
    this.heardPos = pos.clone();
    this.heardTime = this.g.time;
  }

  // we killed someone: maybe say so, and check the area is clear a bit later
  onKill() {
    if (Math.random() < 0.5 * this.d.teamwork) this.g.radio.say(this.p, 'enemyDown');
    this.clearAt = this.g.time + 2 + Math.random() * 2;
  }

  onBombPlanted(bomb) {
    this.bombPos = bomb.pos.clone();
    this.spot = null;
    this.goal = null;
    this.path = null;
  }

  canSee(e, ignoreFov) {
    const p = this.p, g = this.g;
    const ex = p.pos.x, ey = p.pos.y + p.eyeHeight(), ez = p.pos.z;
    const head = aimPoint(e, 'head', tmp);
    const dx = head.x - ex, dz = head.z - ez;
    if (!ignoreFov) {
      const yawTo = Math.atan2(-dx, -dz);
      if (Math.abs(wrap(yawTo - p.yaw)) > (this.d.fov * DEG) / 2) return false;
    }
    // nobody can see through smoke (unless they hack)
    if (!p.hacks.nosmoke && g.grenades.blocks(ex, ey, ez, head.x, head.y, head.z)) return false;
    if (g.world.visible(ex, ey, ez, head.x, head.y, head.z)) return true;
    const chest = aimPoint(e, 'chest', tmp2);
    return g.world.visible(ex, ey, ez, chest.x, chest.y, chest.z);
  }

  perceive() {
    const g = this.g, p = this.p;
    let best = null, bestD = Infinity;
    for (const e of g.players) {
      if (!e.alive || e === p || !g.isEnemy(p, e) || e.isProtected(g.time)) continue;
      const d = e.pos.distanceToSquared(p.pos);
      const keep = e === this.target;
      if (!this.canSee(e, keep || this.forceLook === e)) continue;
      const score = keep ? d * 0.5 : d;
      if (score < bestD) { bestD = score; best = e; }
    }
    this.forceLook = null;
    if (best !== this.target) {
      if (best) {
        // a new contact: tell the team (and as a Counter-Terrorist, where)
        if (!this.target) {
          if (g.time - this.lastContact > 10 && Math.random() < this.d.teamwork) g.radio.say(p, 'enemySpotted');
          this.lastContact = g.time;
          if (g.bm && p.team === 'CT') g.bm.ctAlert(best.pos);
          if (g.stats) g.stats.engage(p);
        }
        const d = this.d;
        this.reactUntil = g.time + d.reaction * (0.75 + Math.random() * 0.5);
        this.targetPart = Math.random() < d.head ? 'head' : 'chest';
        const err = d.aimError * (0.6 + Math.random() * 0.8);
        const a = Math.random() * Math.PI * 2;
        this.errYaw = Math.cos(a) * err;
        this.errPitch = Math.sin(a) * err * 0.6;
        // an enemy we were already following through the wall: we're aimed at them
        if (best === this.preAim) this.reactUntil = g.time + d.reaction * 0.3;
        // aimbot: no reaction time, no aim error, the chosen bone
        if (p.hacks.aimbot) {
          this.reactUntil = g.time + 0.04;
          this.targetPart = p.hackCfg.aimBone === 'body' ? 'chest' : 'head';
          this.errYaw = this.errPitch = 0;
        }
        this.burstLeft = 0;
        this.holdFireUntil = 0;
        this.path = null;
      } else if (this.d.style === 'careful') {
        // lost them: keep the angle a moment, they may peek again
        this.lossHoldUntil = g.time + 1 + Math.random() * 1.5;
      }
      this.target = best;
    }
    if (this.target) {
      this.lastSeenPos = this.target.pos.clone();
      this.lastSeenTime = g.time;
    }
    this.preAim = null;
    if (!this.target && (p.hacks.wallhack || p.hacks.esp || p.hacks.radar)) this.hackSense();
  }

  // Hacker mode: an enemy out of sight we still know about. Wallhack and ESP
  // show the ones in front of us through walls (we aim at them and go after
  // them); the radar hack shows where everyone is (we go after the closest).
  hackSense() {
    const g = this.g, p = this.p, h = p.hacks;
    const ex = p.pos.x, ez = p.pos.z;
    let best = null, bestD = Infinity, seen = false;
    for (const e of g.players) {
      if (!e.alive || e === p || !g.isEnemy(p, e) || e.isProtected(g.time)) continue;
      const dx = e.pos.x - ex, dz = e.pos.z - ez, d = dx * dx + dz * dz;
      const inView = (h.wallhack || h.esp) && d < 3000 * 3000 && Math.abs(wrap(Math.atan2(-dx, -dz) - p.yaw)) < (this.d.fov * DEG) / 2;
      if (!inView && !h.radar) continue;
      // the ones on screen first
      const score = inView ? d * 0.25 : d;
      if (score < bestD) { bestD = score; best = e; seen = inView; }
    }
    if (!best) return;
    if (seen) this.preAim = best;
    this.lastSeenPos = best.pos.clone();
    this.lastSeenTime = g.time;
  }

  // aim at the enemy we follow through the wall (not while climbing a ladder)
  preAimAt() {
    const e = this.preAim, p = this.p;
    if (!e || !e.alive || p.moveEvents.ladder || (this.path && this.path[this.pathIdx] && this.path[this.pathIdx].ladder)) return;
    const q = aimPoint(e, p.hacks.aimbot && p.hackCfg.aimBone === 'body' ? 'chest' : 'head', tmp);
    const dx = q.x - p.pos.x, dy = q.y - (p.pos.y + p.eyeHeight()), dz = q.z - p.pos.z;
    this.lookYaw = Math.atan2(-dx, -dz);
    this.lookPitch = Math.atan2(dy, Math.hypot(dx, dz));
  }

  think(dt) {
    const g = this.g, p = this.p;
    const cmd = { forward: 0, side: 0, jump: false, duck: false, walk: false, attack: false, attack2: false, reload: false, slot: 0, cycleNade: false };
    if (g.time < this.blindUntil) {
      // blinded: back off sideways and look around, firing now and then where the enemy was
      this.target = null;
      cmd.forward = -0.6;
      cmd.side = this.strafeDir;
      if (g.time >= this.strafeUntil) {
        this.strafeDir = -this.strafeDir;
        this.strafeUntil = g.time + 0.4 + Math.random() * 0.5;
        this.lookYaw = p.yaw + (Math.random() - 0.5) * 1.5;
      }
      const w = p.weapon;
      if (w && w.def.type !== 'knife' && this.lastSeenPos && g.time - this.lastSeenTime < 2 && Math.random() < 0.05) cmd.attack = !p.oldAttack;
      this.turn(dt);
      return cmd;
    }
    if (g.time >= this.nextPerceive) {
      this.nextPerceive = g.time + 0.1;
      if (this.target && !this.target.alive) this.target = null;
      this.perceive();
    }
    const w = p.weapon;
    this.wantSlot = 0;
    // planting: nothing else matters until the bomb is down
    if (w && w.def.type === 'c4' && w.arming) {
      cmd.attack = true;
      this.turn(dt);
      return cmd;
    }
    // defusing with the clock running out: keep at it
    if (p.defusing && g.bm.bomb && g.bm.bomb.blowAt - g.time < 12) {
      cmd.use = true;
      this.turn(dt);
      return cmd;
    }

    // a grenade throw in progress (an enemy showing up cancels it, unless the pin is out)
    if (this.nade) {
      const nw = p.weapon;
      if (this.target && !(nw && nw.def.type === 'grenade' && nw.pin)) this.nade = null;
      else if (this.nadeTick(cmd)) {
        this.turn(dt);
        return cmd;
      }
    }
    if (!this.target && g.time >= this.nextNadeThink) {
      this.nextNadeThink = g.time + 0.4;
      this.considerNade();
      if (this.nade && this.nadeTick(cmd)) {
        this.turn(dt);
        return cmd;
      }
    }
    if (this.clearAt && g.time >= this.clearAt) {
      this.clearAt = 0;
      if (!this.target && g.time - this.lastSeenTime > 2 && Math.random() < 0.4) g.radio.say(p, 'sectorClear');
    }

    if (this.target) this.combat(cmd, dt);
    else {
      this.roam(cmd, dt);
      this.preAimAt();
    }
    this.dodgeFlash();
    // Pull the primary out if we're holding something else
    if (this.wantSlot) {
      if (p.slot !== this.wantSlot) cmd.slot = this.wantSlot;
    } else if (w && w.def.slot !== 1 && p.weapons[1] && (p.weapons[1].clip > 0 || p.weapons[1].reserve > 0) && !this.target) cmd.slot = 1;
    else if (w && (w.def.slot === 3 || w.def.slot === 5) && p.weapons[2] && (p.weapons[2].clip > 0 || p.weapons[2].reserve > 0)) cmd.slot = 2;
    this.turn(dt);

    if (this.jumpNext) {
      cmd.jump = true;
      this.jumpNext = false;
    }
    return cmd;
  }

  // Smooth turning toward the desired look direction
  turn(dt) {
    const p = this.p, d = this.d;
    const dy = wrap(this.lookYaw - p.yaw), dp = this.lookPitch - p.pitch;
    // aimbot: onto the target as fast as its smoothing allows, no turn limit
    if (this.target && p.hacks.aimbot) {
      const s = p.hackCfg.aimSmooth;
      const k = s < 0.01 ? 1 : 1 - Math.exp(-dt / (s * 0.2));
      p.yaw = wrap(p.yaw + dy * k);
      p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch + dp * k));
      return;
    }
    const k = 1 - Math.exp(-d.aimRate * dt);
    const maxStep = d.maxTurn * dt;
    p.yaw = wrap(p.yaw + Math.max(-maxStep, Math.min(maxStep, dy * k)));
    p.pitch += Math.max(-maxStep, Math.min(maxStep, dp * k));
    p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));
  }

  combat(cmd, dt) {
    const g = this.g, p = this.p, d = this.d, t = this.target;
    const w = p.weapon;
    const eye = tmp2.set(p.pos.x, p.pos.y + p.eyeHeight(), p.pos.z);
    const ap = aimPoint(t, this.targetPart, tmp);
    // lead a little for moving targets on harder settings (the aimbot fully)
    const comp = p.hacks.aimbot ? 1 : d.recoilComp;
    ap.x += t.vel.x * 0.04 * comp;
    ap.z += t.vel.z * 0.04 * comp;
    const dx = ap.x - eye.x, dy = ap.y - eye.y, dz = ap.z - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    const yawTo = Math.atan2(-dx, -dz);
    const pitchTo = Math.atan2(dy, Math.hypot(dx, dz));

    // settle aim error over time
    const decay = Math.exp(-d.settle * dt);
    this.errYaw *= decay;
    this.errPitch *= decay;
    // recoil compensation: aim lower by part of the punch
    this.lookYaw = yawTo + this.errYaw - p.punchYaw * DEG * comp;
    this.lookPitch = pitchTo + this.errPitch - p.punchPitch * DEG * comp;

    if (!w) return;
    if (w.def.type === 'knife') {
      this.knifeFight(cmd, t, dist);
      return;
    }
    // out of ammo: the pistol, else the knife
    if (w.def.slot <= 2 && w.clip === 0 && w.reserve === 0) cmd.slot = p.weapons[2] && w.def.slot === 1 ? 2 : 3;

    // where the barrel actually points (view + punch)
    const aimYaw = p.yaw + p.punchYaw * DEG, aimPitch = p.pitch + p.punchPitch * DEG;
    const angErr = Math.hypot(wrap(aimYaw - yawTo) * Math.cos(pitchTo), aimPitch - pitchTo);
    const radius = this.targetPart === 'head' ? 5.5 : 9;
    const tol = Math.atan2(radius, dist) * 1.6 + 0.004;
    const reacted = g.time >= this.reactUntil;
    const sniper = w.def.type === 'sniper';
    const pistol = w.def.type === 'pistol';
    const shotgun = w.def.type === 'shotgun';

    // movement: strafe between shots, stand still to shoot at range
    const speed = Math.hypot(p.vel.x, p.vel.z);
    let wantShoot = reacted && angErr < tol && w.clip > 0 && !w.reloading;
    // friendly fire: never shoot through a teammate
    if (g.cfg.friendlyFire && (wantShoot || this.burstLeft > 0) && this.mateInLine(eye, ap, dist)) {
      wantShoot = false;
      this.burstLeft = 0;
    }
    if (g.time >= this.strafeUntil) {
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      this.strafeUntil = g.time + 0.3 + Math.random() * 0.6;
      this.strafing = Math.random() < d.strafe;
    }
    const needStill = sniper || (dist > 450 && !pistol && !shotgun);
    if (this.burstLeft > 0 || (wantShoot && needStill)) {
      // counter-strafe: push against current velocity to stop fast
      if (speed > 30 && d.counterStrafe) {
        const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
        const vr = p.vel.x * cy - p.vel.z * sy;
        cmd.side = vr > 0 ? -1 : 1;
      }
      if (dist > 600 && Math.random() < d.crouch * dt * 3) this.duckUntil = g.time + 0.8 + Math.random();
    } else if (this.strafing) {
      cmd.side = this.strafeDir;
    }
    if (dist > 1500 && !sniper) cmd.forward = 1;
    // shotguns close the distance and only fire when it counts
    if (shotgun) {
      if (dist > 350) cmd.forward = 1;
      if (dist > 900) wantShoot = false;
    }
    if (g.time < this.duckUntil) cmd.duck = true;
    this.ledgeGuard(cmd);
    if (needStill && speed > (sniper ? 10 : 140)) wantShoot = false;

    if (sniper) {
      if (w.zoom === 0 && !w.resumeZoom && g.time >= w.nextAttack2 && !w.reloading) {
        if (!p.oldAttack2) cmd.attack2 = true;
        this.zoomWaitUntil = g.time + 0.2;
      }
      if (g.time < this.zoomWaitUntil || w.zoom === 0) wantShoot = false;
      if (wantShoot && !p.oldAttack) cmd.attack = true;
      return;
    }

    if (shotgun) {
      if (wantShoot) cmd.attack = true;
      return;
    }

    if (pistol) {
      if (wantShoot && g.time >= this.nextClick && !p.oldAttack) {
        cmd.attack = true;
        this.nextClick = g.time + d.click * (0.8 + Math.random() * 0.5);
      }
      return;
    }

    // rifles: taps far away, bursts mid range, spray up close
    if (this.lastClip !== -1 && w.clip < this.lastClip && this.burstLeft > 0) this.burstLeft -= this.lastClip - w.clip;
    this.lastClip = w.clip;
    if (this.burstLeft > 0) {
      cmd.attack = true;
      if (angErr > tol * 4) this.burstLeft = 0;
      return;
    }
    if (wantShoot && g.time >= this.holdFireUntil) {
      let n, pause;
      if (dist > 1100) { n = 1 + (Math.random() < 0.4 ? 1 : 0); pause = 0.35; }
      else if (dist > 500) { n = 2 + ((Math.random() * (d.burst - 1)) | 0); pause = 0.3; }
      else { n = 6 + ((Math.random() * 8) | 0); pause = 0.2; }
      this.burstLeft = n;
      this.holdFireUntil = g.time + pause + n * w.def.cycle;
      this.lastClip = w.clip;
      cmd.attack = true;
    }
  }

  // Only a knife: run straight at them, weaving a little on the way in, slash
  // when in reach and stab when it kills (from behind, or they're hurt).
  knifeFight(cmd, t, dist) {
    const g = this.g, p = this.p, w = p.weapon;
    const flat = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
    this.lookPitch = Math.atan2(t.pos.y + 36 - (p.pos.y + p.eyeHeight()), flat);
    cmd.forward = 1;
    if (flat > 160) {
      if (g.time >= this.strafeUntil) {
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.strafeUntil = g.time + 0.35 + Math.random() * 0.4;
      }
      if (Math.random() < this.d.strafe) cmd.side = this.strafeDir;
    }
    this.ledgeGuard(cmd);
    if (g.time < this.reactUntil || g.time < p.nextAttackTime) return;
    const facing = Math.abs(wrap(p.yaw - Math.atan2(-(t.pos.x - p.pos.x), -(t.pos.z - p.pos.z)))) < 0.35;
    if (!facing || dist > 66) return;
    const stab = dist < 46 && (g.isBehind(p, t) || t.health <= 65);
    if (stab) {
      if (g.time >= w.nextAttack2 && !p.oldAttack2) cmd.attack2 = true;
    } else if (g.time >= w.nextAttack) cmd.attack = true;
  }

  // is there floor all the way along a straight walk? (no cutting across a gap)
  floorAlong(ax, az, bx, bz, y) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.floor(d / 32);
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      if (!this.g.world.traceRay(ax + (bx - ax) * t, y + 8, az + (bz - az) * t, 0, -1, 0, 60)) return false;
    }
    return true;
  }

  // don't strafe or back off a ledge (catwalks, planks, rooftops)
  ledgeGuard(cmd) {
    if (!cmd.forward && !cmd.side) return;
    const p = this.p, g = this.g;
    if (!p.onGround) return;
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    let dx = -sy * cmd.forward + cy * cmd.side, dz = -cy * cmd.forward - sy * cmd.side;
    const l = Math.hypot(dx, dz);
    dx /= l;
    dz /= l;
    const x = p.pos.x + dx * (HULL.radius + 14), z = p.pos.z + dz * (HULL.radius + 14);
    const hit = g.world.traceRay(x, p.pos.y + 8, z, 0, -1, 0, 80);
    if (!hit) {
      cmd.forward = 0;
      cmd.side = 0;
    }
  }

  // a gun lying close by, when we have no rifle of our own (one a teammate
  // dropped for us we fetch from further away)
  gunToGrab() {
    const g = this.g, p = this.p;
    if (!g.items.enabled || p.weapons[1]) return null;
    const reach = g.bm ? 450 : 1400;
    let best = null, bd = Infinity;
    for (const it of g.items.list) {
      if (it.kind !== 'weapon' || it.w.def.slot !== 1 || !it.onGround) continue;
      const d = it.pos.distanceTo(p.pos);
      if (d < (it.giftFor === p ? 1600 : reach) && d < bd) { bd = d; best = it; }
    }
    return best;
  }

  // Bomb defusal: go after an enemy we lost only when it fits our job:
  // Counter-Terrorists near the site they hold (or the planted bomb),
  // Terrorists close by. Chasing across the map gets bots picked off.
  mayChase(pos) {
    const g = this.g, p = this.p, bm = g.bm, st = this.d.style;
    const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    // campers only leave their spot for someone close
    if (!bm || g.round.state !== 'live') return st !== 'camper' || flat(pos, p.pos) < 600;
    const b = bm.bomb;
    if (b && b.state === 'planted') return flat(pos, b.pos) < 900;
    if (p.team === 'T') return flat(pos, p.pos) < (st === 'rusher' ? 1200 : st === 'camper' ? 450 : 700);
    const site = this.spotSite || (g.map.bombsites || [])[(this.siteIndex || 0) % Math.max(1, (g.map.bombsites || []).length)];
    return !!site && flat(pos, bm.siteCenter(site)) < 1000;
  }

  // is a teammate between us and where we'd shoot?
  mateInLine(eye, ap, dist) {
    const g = this.g, p = this.p;
    const dx = (ap.x - eye.x) / dist, dy = (ap.y - eye.y) / dist, dz = (ap.z - eye.z) / dist;
    for (const o of g.players) {
      if (o === p || !o.alive || g.isEnemy(p, o)) continue;
      if (rayVsPlayer(o, eye.x, eye.y, eye.z, dx, dy, dz, dist)) return true;
    }
    return false;
  }

  // ---------- grenades ----------
  // Start a throw at a point, if we carry that grenade and a simulated throw
  // lands close enough. True when we're going to throw.
  wantNade(id, at) {
    const g = this.g, p = this.p;
    if (this.nade || !(p.nades[id] > 0) || !p.alive) return false;
    // an HE never goes where it would hurt teammates
    if (id === 'hegrenade' && g.cfg.friendlyFire && g.players.some((o) => o !== p && o.alive && !g.isEnemy(p, o) && o.pos.distanceTo(at) < 380)) return false;
    const aim = g.grenades.aim(p, id, at);
    if (!aim || aim.miss > (id === 'flashbang' ? 240 : id === 'smokegrenade' ? 150 : 170)) return false;
    this.nade = { id, at: at.clone(), yaw: aim.yaw, pitch: aim.pitch, until: g.time + 4, settled: false };
    return true;
  }

  // carry out the throw: take the grenade out, aim, pull the pin, let go.
  // True while busy with it.
  nadeTick(cmd) {
    const g = this.g, p = this.p, n = this.nade, w = p.weapon;
    if (w && w.def.type === 'grenade' && w.redeployAt) {
      // thrown
      this.nade = null;
      return false;
    }
    if (g.time > n.until || !(p.nades[n.id] > 0)) {
      this.nade = null;
      return false;
    }
    cmd.forward = cmd.side = 0;
    this.lookYaw = n.yaw;
    this.lookPitch = n.pitch;
    if (!w || w.def.slot !== 4) {
      cmd.slot = 4;
      return true;
    }
    if (w.id !== n.id) {
      if (!w.pin) cmd.cycleNade = true;
      return true;
    }
    // stopped where we'll throw from: work the aim out again from here
    if (!n.settled && Math.hypot(p.vel.x, p.vel.z) < 5 && p.onGround) {
      n.settled = true;
      const aim = g.grenades.aim(p, n.id, n.at);
      if (aim) {
        // a less practised hand throws a little off
        const e = this.d.nadeErr, a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * e * 1.6;
        n.yaw = aim.yaw + Math.cos(a) * r;
        n.pitch = aim.pitch + Math.sin(a) * r;
      }
    }
    const aimed = n.settled && Math.abs(wrap(p.yaw - n.yaw)) < 0.008 && Math.abs(p.pitch - n.pitch) < 0.008;
    if (!w.pin) cmd.attack = aimed && g.time >= p.nextAttackTime && g.time >= w.nextAttack;
    else cmd.attack = !(aimed && g.time >= w.throwAt && !this.mateInFront());
    return true;
  }

  // someone right in front of us (a thrown grenade would bounce off them)
  mateInFront() {
    const g = this.g, p = this.p;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    return g.players.some((o) => {
      if (o === p || !o.alive) return false;
      const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      return d < 90 && (dx * fx + dz * fz) / (d || 1) > 0.6;
    });
  }

  // grenades on our own: after losing sight of an enemy (an HE where they
  // were, or a flash before going after them), at a Terrorist defusing our
  // bomb, or as a Counter-Terrorist at the Terrorists' way into our site
  considerNade() {
    const g = this.g, p = this.p;
    if (!p.weapons[4] || g.frozen() || p.weapons[5]) return;
    const has = (id) => (p.nades[id] || 0) > 0;
    if (this.lastSeenPos && this.lostHandled !== this.lastSeenTime && g.time - this.lastSeenTime > 0.6) {
      this.lostHandled = this.lastSeenTime;
      const since = g.time - this.lastSeenTime;
      const q = this.lastSeenPos;
      const d = Math.hypot(q.x - p.pos.x, q.z - p.pos.z);
      if (since < 3 && d > 300 && d < 1100) {
        // (characters who love grenades throw more of them)
        const r = Math.random(), k = this.nadeK;
        if (has('hegrenade') && r < 0.45 * k) this.wantNade('hegrenade', new THREE.Vector3(q.x, q.y + 10, q.z));
        else if (has('flashbang') && r < Math.min(0.95, 0.75 * k)) this.wantNade('flashbang', new THREE.Vector3(q.x, q.y + 70, q.z));
        if (this.nade) return;
      }
    }
    const bm = g.bm;
    if (!bm || g.round.state !== 'live') return;
    const b = bm.bomb;
    if (p.team === 'T' && b && b.state === 'planted' && b.defuser && has('hegrenade') && p.pos.distanceTo(b.pos) < 1100) {
      this.wantNade('hegrenade', b.pos);
      return;
    }
    const al = bm.alert;
    if (p.team === 'CT' && al && this.alertNaded !== al.at && g.time - al.at < 8 && this.spotSite === al.site) {
      this.alertNaded = al.at;
      const route = bm.siteRoute(al.site, 'T');
      if (!route || Math.hypot(route.entry.x - p.pos.x, route.entry.z - p.pos.z) > 1100) return;
      if (has('smokegrenade') && Math.random() < 0.6 * this.nadeK) this.wantNade('smokegrenade', route.entry);
      else if (has('hegrenade') && Math.random() < 0.6 * this.nadeK) this.wantNade('hegrenade', route.entry);
    }
  }

  // A flashbang about to go off where we can see it: look away. Our team's
  // we always know about; an enemy one only if we saw it flying in, and
  // even then only sometimes (better bots more often).
  dodgeFlash() {
    const g = this.g, p = this.p;
    const ex = p.pos.x, ey = p.pos.y + p.eyeHeight(), ez = p.pos.z;
    for (const n of g.grenades.list) {
      if (n.id !== 'flashbang' || n.done || n.age > 1.55) continue;
      const dx = ex - n.pos.x, dz = ez - n.pos.z;
      if (dx * dx + dz * dz > 1400 * 1400) continue;
      if (n.owner !== p && g.isEnemy(p, n.owner)) {
        n.seenBy = n.seenBy || new Map();
        let dodge = n.seenBy.get(p);
        if (dodge === undefined) {
          if (n.age < 0.3) continue;
          const inView = Math.abs(wrap(Math.atan2(-(n.pos.x - ex), -(n.pos.z - ez)) - p.yaw)) < (this.d.fov * DEG) / 2;
          dodge = inView && g.world.visible(ex, ey, ez, n.pos.x, n.pos.y, n.pos.z) && Math.random() < this.d.flashDodge;
          n.seenBy.set(p, dodge);
        }
        if (!dodge) continue;
      }
      if (n.age < 1.0) continue;
      if (!g.world.visible(ex, ey, ez, n.pos.x, n.pos.y, n.pos.z)) continue;
      this.lookYaw = Math.atan2(-dx, -dz);
      this.lookPitch = 0;
      this.burstLeft = 0;
      return;
    }
  }

  roam(cmd, dt) {
    const g = this.g, p = this.p;
    const w = p.weapon;
    if (w && w.def.type !== 'knife' && w.def.type !== 'c4' && w.clip < w.def.clip * 0.5 && w.reserve > 0 && !w.reloading) cmd.reload = true;
    const st = this.d.style;
    // careful: keep the angle where they were for a moment
    if (st === 'careful' && g.time < this.lossHoldUntil && this.lastSeenPos) {
      this.lookAt(this.lastSeenPos);
      return;
    }

    // Decide where to go
    let goal = null;
    const gun = this.gunToGrab();
    const [seenFor, heardFor] = CHASE[st] || [5, 6];
    if (gun) goal = gun.pos;
    else if (this.lastSeenPos && g.time - this.lastSeenTime < seenFor && !p.weapons[5] && this.mayChase(this.lastSeenPos)) goal = this.lastSeenPos;
    else if (this.heardPos && g.time - this.heardTime < heardFor && this.mayChase(this.heardPos)) goal = this.heardPos;
    else if (this.mateCall && g.time - this.mateCall.at < 6 && !p.weapons[5] && this.mayChase(this.mateCall.pos)) goal = this.mateCall.pos;
    else if (g.bm) {
      const og = this.objective(cmd);
      if (og === 'hold') return;
      goal = og;
    } else if (st === 'camper' && this.camping()) return;
    if (goal && (!this.goal || this.goal.distanceToSquared(goal) > 64 * 64)) {
      this.goal = goal.clone();
      this.path = null;
    }
    if (!this.goal || (this.path && this.pathIdx >= this.path.length)) {
      if (this.goal && this.path && this.pathIdx >= this.path.length) {
        this.lastSeenPos = null;
        this.heardPos = null;
        this.mateCall = null;
      }
      const pt = this.wanderPoint();
      this.goal = new THREE.Vector3(pt.x, pt.y, pt.z);
      this.path = null;
    }
    if (!this.path || g.time >= this.repathAt) {
      this.path = g.map.nav.findPath(p.pos.x, p.pos.y, p.pos.z, this.goal.x, this.goal.y, this.goal.z);
      this.pathIdx = 0;
      this.repathAt = g.time + 3 + Math.random() * 2;
      if (!this.path) {
        // can't get there: forget it and wander for a bit
        this.goal = null;
        this.lastSeenPos = null;
        this.heardPos = null;
        this.spot = null;
        return;
      }
    }
    // a ladder on the way: climb it before anything else
    if (this.path[this.pathIdx].ladder) {
      if (this.climb(cmd, this.path[this.pathIdx])) this.pathIdx++;
      return;
    }
    // skip ahead to the furthest node we can walk to directly (never past a ladder)
    const h = p.height();
    let last = Math.min(this.path.length - 1, this.pathIdx + 6);
    for (let k = this.pathIdx + 1; k <= last; k++) if (this.path[k].ladder) last = k - 1;
    for (let k = last; k > this.pathIdx; k--) {
      const n = this.path[k];
      g.world.traceHull(p.pos.x, p.pos.y + 1, p.pos.z, n.x, p.pos.y + 1, n.z, h, null, trace);
      if (trace.frac === 1 && this.floorAlong(p.pos.x, p.pos.z, n.x, n.z, Math.max(p.pos.y, n.y))) {
        this.pathIdx = k;
        break;
      }
    }
    const n = this.path[this.pathIdx];
    const dx = n.x - p.pos.x, dz = n.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 20) {
      this.pathIdx++;
      return;
    }
    // caught by a ladder while dropping past it: climb down it instead
    // (forward would climb up and keep us hanging there)
    if (p.moveEvents.ladder && n.y < p.pos.y - 24) {
      cmd.forward = -1;
      cmd.side = 0;
      return;
    }
    // move in world direction (dx,dz) relative to our yaw
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const fx = -sy, fz = -cy, rx = cy, rz = -sy;
    let nx = dx / dist, nz = dz / dist;
    // someone standing in the way (a teammate holding a spot doesn't step
    // aside): walk around them on the side away from them
    for (const o of g.players) {
      if (o === p || !o.alive || Math.abs(o.pos.y - p.pos.y) > 60) continue;
      const ox = o.pos.x - p.pos.x, oz = o.pos.z - p.pos.z;
      const ahead = ox * nx + oz * nz;
      if (ahead <= 0 || ahead > 56 || ahead > dist + 16) continue;
      const lat = ox * -nz + oz * nx; // + : on our (-nz, nx) side
      if (Math.abs(lat) > 34) continue;
      const s = lat > 2 ? -1 : lat < -2 ? 1 : p.id % 2 ? 1 : -1;
      const ax = nx - nz * s * 0.9, az = nz + nx * s * 0.9, l = Math.hypot(ax, az);
      nx = ax / l;
      nz = az / l;
      break;
    }
    cmd.forward = nx * fx + nz * fz;
    cmd.side = nx * rx + nz * rz;
    this.moveX = nx;
    this.moveZ = nz;
    this.movedAt = g.time;
    // quiet steps close to where enemies are (careful players and lurkers)
    cmd.walk = this.sneaking();
    // bunny hopping: the auto bhop hack, or a character who likes to (on and
    // off, along straights that are long, flat and have floor)
    if (g.time >= this.bhopUntil) {
      this.bhopUntil = g.time + 2 + Math.random() * 2;
      this.bhopping = Math.random() < this.d.bhop;
    }
    if ((p.hacks.autobhop || (this.bhopping && !cmd.walk)) && p.onGround && dist > 200 && Math.abs(n.y - p.pos.y) < 24 && p.waterDepth < 4 &&
      this.floorAlong(p.pos.x, p.pos.z, p.pos.x + nx * 200, p.pos.z + nz * 200, p.pos.y)) cmd.jump = true;
    // look where we're going, glancing toward the expected enemy side
    this.lookYaw = Math.atan2(-dx, -dz);
    this.lookPitch = 0;
    if (this.heardPos && g.time - this.heardTime < 2) {
      this.lookYaw = Math.atan2(-(this.heardPos.x - p.pos.x), -(this.heardPos.z - p.pos.z));
    }

    // stuck detection
    if (g.time >= this.stuckCheckAt) {
      const moved = Math.hypot(p.pos.x - this.stuckPos.x, p.pos.y - this.stuckPos.y, p.pos.z - this.stuckPos.z);
      if (moved < 12) {
        this.stuckCount++;
        this.jumpNext = true;
        this.strafeDir = -this.strafeDir;
        if (this.stuckCount > 2) {
          this.goal = null;
          this.path = null;
          this.stuckCount = 0;
        }
      } else this.stuckCount = 0;
      this.stuckPos.copy(p.pos);
      this.stuckCheckAt = g.time + 0.7;
    }
    if (this.stuckCount > 0) cmd.side += this.strafeDir * 0.7;
  }

  // ---------- play styles (Bot Arena characters) ----------
  lookAt(q, up = 50) {
    const p = this.p;
    const dx = q.x - p.pos.x, dz = q.z - p.pos.z;
    this.lookYaw = Math.atan2(-dx, -dz);
    this.lookPitch = Math.atan2(q.y + up - (p.pos.y + p.eyeHeight()), Math.hypot(dx, dz));
  }

  // where to go with nothing better to do
  wanderPoint() {
    const g = this.g, p = this.p, nav = g.map.nav, st = this.d.style;
    if (st === 'camper') {
      if (!this.camp || g.time > this.camp.until) this.camp = this.campSpot();
      return this.camp;
    }
    if (st === 'lurker') {
      // away from the others, round the side
      const mates = g.players.filter((o) => o !== p && o.alive && !g.isEnemy(p, o));
      let best = null, bs = -Infinity;
      for (let i = 0; i < 6; i++) {
        const q = g.roamPoint(p);
        let s = Math.random() * 200;
        for (const o of mates) s += Math.min(1500, Math.hypot(o.pos.x - q.x, o.pos.z - q.z)) / mates.length;
        if (!mates.length) s += Math.min(2000, Math.hypot(q.x - p.pos.x, q.z - p.pos.z)) * 0.3;
        if (s > bs) { bs = s; best = q; }
      }
      return best;
    }
    // team players stick together
    const tw = this.d.teamwork;
    if (st && !g.ffa && p.team && tw > 0.6 && Math.random() < (tw - 0.5) * 1.2) {
      const mates = g.players.filter((o) => o !== p && o.alive && o.team === p.team);
      if (mates.length) {
        const m = mates[(Math.random() * mates.length) | 0];
        return nav.randomPoint(Math.random, (q) => Math.hypot(q.x - m.pos.x, q.z - m.pos.z) < 350 && Math.abs(q.y - m.pos.y) < 120);
      }
    }
    if (st === 'rusher') {
      // straight for the enemy's end of the map
      const sd = g.map.sides;
      if (!g.ffa && p.team && sd) {
        const es = sd[p.team === 'T' ? 'CT' : 'T'];
        return nav.randomPoint(Math.random, (q) => q[sd.axis] * es > 300);
      }
      // free-for-all: somewhere far off, where the others are
      let best = null, bd = -1;
      for (let i = 0; i < 3; i++) {
        const q = nav.randomPoint(Math.random);
        const d = Math.hypot(q.x - p.pos.x, q.z - p.pos.z);
        if (d > bd) { bd = d; best = q; }
      }
      return best;
    }
    return g.roamPoint(p);
  }

  // A camper's lookout: of a few spots, the one that sees the most of the
  // map (judged against some points spread over it), facing the open side.
  campSpot() {
    const g = this.g, p = this.p, nav = g.map.nav;
    if (!this.probes || Math.random() < 0.2) this.probes = Array.from({ length: 14 }, () => nav.randomPoint(Math.random));
    let best = null, bs = -Infinity;
    for (let i = 0; i < 7; i++) {
      const q = nav.randomPoint(Math.random);
      let seen = 0, sx = 0, sz = 0;
      for (const o of this.probes) {
        const dx = o.x - q.x, dz = o.z - q.z, d = Math.hypot(dx, dz);
        if (d < 300 || d > 3000) continue;
        if (g.world.visible(q.x, q.y + 64, q.z, o.x, o.y + 40, o.z)) {
          seen++;
          sx += dx / d;
          sz += dz / d;
        }
      }
      // a close spot wins a tie (less running about in the open)
      const score = seen + Math.random() * 0.5 - Math.hypot(q.x - p.pos.x, q.z - p.pos.z) / 3000;
      if (score > bs) {
        bs = score;
        best = { x: q.x, y: q.y, z: q.z, yaw: sx || sz ? Math.atan2(-sx, -sz) : p.yaw, until: g.time + 40, arrived: false };
      }
    }
    return best;
  }

  // at the lookout: watch the open side (or a noise) until it's time to move on
  camping() {
    const g = this.g, p = this.p, c = this.camp;
    if (!c || g.time > c.until) return false;
    if (Math.hypot(c.x - p.pos.x, c.z - p.pos.z) > 40 || Math.abs(c.y - p.pos.y) > 60) return false;
    if (!c.arrived) {
      c.arrived = true;
      c.until = g.time + 15 + Math.random() * 25;
    }
    if (this.heardPos && g.time - this.heardTime < 3) this.lookAt(this.heardPos);
    else {
      this.lookYaw = c.yaw + Math.sin(g.time * 0.5 + p.id) * 0.45;
      this.lookPitch = 0;
    }
    return true;
  }

  // careful players and lurkers walk (no footsteps) near where enemies were
  sneaking() {
    const g = this.g, p = this.p, st = this.d.style;
    if (st !== 'careful' && st !== 'lurker') return false;
    const r = st === 'lurker' ? 1000 : 700;
    const near = (q, at) => q && g.time - at < 8 && Math.hypot(q.x - p.pos.x, q.z - p.pos.z) < r;
    return near(this.lastSeenPos, this.lastSeenTime) || near(this.heardPos, this.heardTime);
  }

  // a teammate got shot close by: team players go and help
  onMateHit(mate) {
    if (!this.d.style || this.target || Math.random() > this.d.teamwork * 0.5) return;
    this.mateCall = { pos: mate.pos.clone(), at: this.g.time };
  }

  // Follow a ladder link to spot n: walk to the foot and climb (forward is up),
  // or walk off the top onto it and go down (back is down). True when there.
  climb(cmd, n) {
    const p = this.p, lad = n.ladder;
    const up = n.y > lad.y0 + 8;
    if (p.onGround && (up ? p.pos.y > lad.top - 6 : p.pos.y < lad.top - 30)) return true;
    const r = HULL.radius;
    const onIt = p.pos.x + r > lad.min[0] && p.pos.x - r < lad.max[0] && p.pos.z + r > lad.min[2] && p.pos.z - r < lad.max[2] &&
      p.pos.y < lad.max[1] && p.pos.y + p.height() > lad.min[1];
    // face the ladder
    this.lookYaw = Math.atan2(lad.nx, lad.nz);
    this.lookPitch = up ? 0.35 : -0.35;
    if (onIt && !(p.onGround && !up)) {
      cmd.forward = up ? 1 : -1;
      cmd.side = 0;
      // stay in the middle of it
      const ax = -lad.nz, az = lad.nx;
      const off = (p.pos.x - lad.cx) * ax + (p.pos.z - lad.cz) * az;
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      const rightAlong = cy * ax - sy * az;
      if (Math.abs(off) > 4) cmd.side = -Math.sign(off) * Math.sign(rightAlong);
      return false;
    }
    // walk to the foot of the ladder, or off the top onto it (far enough out
    // that the floor behind no longer holds us up and the ladder catches us)
    const out = up ? 18 : HULL.radius + 6;
    const tx = lad.cx + lad.nx * out, tz = lad.cz + lad.nz * out;
    const dx = tx - p.pos.x, dz = tz - p.pos.z, d = Math.hypot(dx, dz) || 1;
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    cmd.forward = (dx / d) * -sy + (dz / d) * -cy;
    cmd.side = (dx / d) * cy + (dz / d) * -sy;
    // at the foot: lean in (forward climbs as soon as we touch it)
    if (up && d < 6) {
      cmd.forward = 1;
      cmd.side = 0;
    }
    this.moveX = dx / d;
    this.moveZ = dz / d;
    this.movedAt = this.g.time;
    return false;
  }

  // ---------- bomb defusal ----------
  // where to go for the objective (a point), 'hold' to stay put, or null to roam
  objective(cmd) {
    const g = this.g, p = this.p, bm = g.bm, b = bm.bomb;
    const sites = g.map.bombsites || [];
    if (!sites.length || g.round.state !== 'live') return null;
    const near = (q, r) => Math.hypot(q.x - p.pos.x, q.z - p.pos.z) < r && Math.abs(q.y - p.pos.y) < 60;

    if (p.team === 'T') {
      const tp = bm.tPlan;
      // loners (and rushers who don't care much for the team) don't wait for the others
      const tw = this.d.teamwork, loner = !!this.d.style && (tw < 0.3 || (this.d.style === 'rusher' && tw < 0.6));
      const going = !tp || tp.phase === 'execute' || loner;
      // carrying the bomb: plant it once the team goes in
      if (p.weapons[5]) {
        if (bm.siteAt(p.pos) && p.onGround) {
          this.wantSlot = 5;
          if (p.slot === 5 && g.time >= p.nextAttackTime) cmd.attack = true;
          this.lookPitch = -0.6;
          return 'hold';
        }
        if (!going) return this.stageSpot(bm.siteRoute(tp.site, 'T'), 120);
        if (!this.spot || !this.spotSite || this.spotSite !== bm.plan) this.pickSpot(bm.plan, 0.6);
        return this.spot;
      }
      // the bomb is lying around: the closest Terrorist goes for it
      if (b && b.state === 'dropped') {
        const ts = g.players.filter((o) => o.alive && o.team === 'T' && o.isBot);
        let closest = null, cd = Infinity;
        for (const o of ts) {
          const d = o.pos.distanceToSquared(b.item.pos);
          if (d < cd) { cd = d; closest = o; }
        }
        if (closest === p) return b.item.pos;
      }
      // planted: guard it
      if (b && b.state === 'planted') return this.guard(b.pos, 520);
      // gather outside the site with the others, then go in together (a lurker waits at the other site)
      if (!this.lurk && !going) return this.stageSpot(bm.siteRoute(tp.site, 'T'), 220);
      const site = this.lurk ? sites.find((s) => s !== bm.plan) || bm.plan : bm.plan;
      if (!this.spot || this.spotSite !== site) this.pickSpot(site, 0.9);
      if (near(this.spot, 40)) return this.hold();
      return this.spot;
    }

    // Counter-Terrorists
    if (b && b.state === 'planted') {
      const bp = b.pos, rt = bm.retake;
      const d = Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z);
      // retake together: gather outside first (unless we're already there), then one defuses and the rest cover
      if (rt && rt.phase !== 'go' && rt.stage && d > 500) return this.stageSpot({ stage: rt.stage, entry: bp }, 200);
      if (rt && rt.phase === 'go' && rt.defuser && rt.defuser !== p && rt.defuser.alive) return this.guard(bp, 320);
      if (d < 26 && Math.abs(bp.y - p.pos.y) < 40) {
        // on top of it: defuse
        this.lookYaw = Math.atan2(-(bp.x - p.pos.x), -(bp.z - p.pos.z));
        this.lookPitch = -1.2;
        if (!b.defuser || b.defuser === p) cmd.use = true;
        return 'hold';
      }
      if (d < 110 && Math.abs(bp.y - p.pos.y) < 40 && g.world.visible(p.pos.x, p.pos.y + 20, p.pos.z, bp.x, bp.y + 6, bp.z)) {
        // the last few steps straight to it
        this.steer(cmd, bp.x, bp.z, true);
        return 'hold';
      }
      return bp;
    }
    // hold our site; when a teammate calls them at the other one, rotate there
    // (the anchor stays). If nobody's left holding that site, wait at its way
    // in from our side instead of walking in alone.
    const mine = sites[(this.siteIndex || 0) % sites.length];
    const al = bm.alert;
    // campers (and loners) never leave their site, team players rotate quicker
    const stays = this.anchor || this.d.style === 'camper' || (!!this.d.style && this.d.teamwork < 0.25);
    const delay = this.rotateDelay * (this.d.style ? 1.6 - this.d.teamwork : 1);
    const site = al && al.site !== mine && !stays && g.time - al.at > delay && g.time - al.at < 45 ? al.site : mine;
    if (site !== mine && !bm.ctHolding(site)) {
      const r = bm.siteRoute(site, 'CT');
      if (r) return this.stageSpot({ stage: r.entry, entry: bm.siteCenter(site) }, 260);
    }
    if (!this.spot || this.spotSite !== site) this.pickSpot(site, 1.15);
    if (near(this.spot, 40)) {
      if (!this.inPosSaid) {
        this.inPosSaid = true;
        if (Math.random() < 0.3) g.radio.say(p, 'inPosition');
      }
      return this.hold();
    }
    return this.spot;
  }

  // stand near a gathering spot, looking toward where we'll go in
  stageSpot(route, r) {
    if (!route) return null;
    const st = route.stage, p = this.p, g = this.g;
    if (!this.spot || this.spotKind !== st) {
      const pt = g.map.nav.randomPoint(Math.random, (q) => Math.hypot(q.x - st.x, q.z - st.z) < r && Math.abs(q.y - st.y) < 60);
      this.spot = new THREE.Vector3(pt.x, pt.y, pt.z);
      this.spotSite = null;
      this.spotKind = st;
      this.holdUntil = 0;
      this.holdYaw = Math.atan2(-(route.entry.x - pt.x), -(route.entry.z - pt.z));
    }
    if (Math.hypot(this.spot.x - p.pos.x, this.spot.z - p.pos.z) < 40) {
      this.lookYaw = this.holdYaw + Math.sin(g.time * 0.6 + p.id) * 0.4;
      this.lookPitch = 0;
      return 'hold';
    }
    return this.spot;
  }

  // walk straight at a point
  steer(cmd, x, z, walk) {
    const p = this.p;
    const dx = x - p.pos.x, dz = z - p.pos.z, d = Math.hypot(dx, dz) || 1;
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    cmd.forward = (dx / d) * -sy + (dz / d) * -cy;
    cmd.side = (dx / d) * cy + (dz / d) * -sy;
    cmd.walk = !!walk;
    this.lookYaw = Math.atan2(-dx, -dz);
    this.lookPitch = -0.4;
  }

  // A standing spot in (or around) a bomb site, facing the enemy's way in:
  // one that sees it, as far back from it as the site allows (more time to
  // react, and they show up in a narrow gap).
  pickSpot(site, spread) {
    const g = this.g, p = this.p;
    const cx = (site.min[0] + site.max[0]) / 2, cz = (site.min[2] + site.max[2]) / 2;
    const hx = (site.max[0] - site.min[0]) / 2 * spread, hz = (site.max[2] - site.min[2]) / 2 * spread;
    const route = g.bm ? g.bm.siteRoute(site, p.team === 'T' ? 'CT' : 'T') : null;
    let pt = null, best = -1;
    for (let i = 0; i < (route ? 10 : 1); i++) {
      const q = g.map.nav.randomPoint(Math.random, (o) => Math.abs(o.x - cx) < hx && Math.abs(o.z - cz) < hz);
      let score = Math.random();
      if (route) {
        const d = Math.hypot(q.x - route.entry.x, q.z - route.entry.z);
        if (g.world.visible(q.x, q.y + 53, q.z, route.entry.x, route.entry.y + 40, route.entry.z)) score += 1000;
        score += Math.min(d, 900);
      }
      if (score > best) {
        best = score;
        pt = q;
      }
    }
    this.spot = new THREE.Vector3(pt.x, pt.y, pt.z);
    this.spotSite = site;
    this.spotKind = null;
    this.holdUntil = 0;
    if (route) {
      this.holdYaw = Math.atan2(-(route.entry.x - pt.x), -(route.entry.z - pt.z)) + (Math.random() - 0.5) * 0.5;
      return;
    }
    // face the way the enemy comes from
    const sd = g.map.sides;
    const enemyDir = sd ? sd[p.team === 'T' ? 'CT' : 'T'] : 0;
    const tx = sd && sd.axis === 'x' ? enemyDir * 1000 : 0, tz = sd && sd.axis === 'z' ? enemyDir * 1000 : 0;
    this.holdYaw = Math.atan2(-(tx - pt.x), -(tz - pt.z)) + (Math.random() - 0.5) * 1.6;
  }

  // stand at the spot looking out, now and then pick another one (holding a
  // bomb site, not so often)
  hold() {
    const g = this.g;
    if (!this.holdUntil) {
      // campers stay put twice as long, rushers half
      const k = this.d.style === 'camper' ? 2 : this.d.style === 'rusher' ? 0.5 : 1;
      this.holdUntil = g.time + k * (this.spotSite ? 25 + Math.random() * 20 : 8 + Math.random() * 14);
    }
    if (g.time > this.holdUntil) {
      this.spot = null;
      return null;
    }
    this.lookYaw = this.holdYaw + Math.sin(g.time * 0.7 + this.p.id) * 0.5;
    this.lookPitch = 0;
    return 'hold';
  }

  // walk around near a point, stopping now and then
  guard(pos, r) {
    if (!this.spot || this.spot.distanceTo(pos) > r * 1.2) {
      const pt = this.g.map.nav.randomPoint(Math.random, (q) => Math.hypot(q.x - pos.x, q.z - pos.z) < r && Math.hypot(q.x - pos.x, q.z - pos.z) > 120);
      this.spot = new THREE.Vector3(pt.x, pt.y, pt.z);
      this.spotSite = null;
      this.spotKind = null;
      this.holdUntil = 0;
      this.holdYaw = Math.atan2(-(pt.x - pos.x), -(pt.z - pos.z)) + Math.PI;
    }
    if (Math.hypot(this.spot.x - this.p.pos.x, this.spot.z - this.p.pos.z) < 40) {
      const h = this.hold();
      if (h) {
        // look away from the bomb, where defusers come from
        this.lookYaw = this.holdYaw + Math.PI + Math.sin(this.g.time * 0.6 + this.p.id) * 0.8;
        return h;
      }
    }
    return this.spot;
  }
}

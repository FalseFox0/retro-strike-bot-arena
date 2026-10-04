// A friend's side of an online match. The host's game is the real one; this
// shows it here. Everyone else moves as the host's snapshots say, a moment
// in the past and smoothly between two of them. Our own player moves at once
// with our keys: the host runs the same keys a moment later, and when its
// answer comes back we carry on from there (prediction). What happens in
// between (sounds, effects, kills, messages) comes as events and happens
// here on time (nethost.js sends them).

import * as THREE from '../lib/three.module.js';
import { Player } from './player.js';
import { makeWeapon } from './weapons.js';
import { thirdPersonWeapon } from './models.js';
import { noHacks, hackCfg, isHacking, hackCmd } from './hacks.js';
import { settings } from './settings.js';
import { tmsg } from './i18n.js';
import { TICK } from './config.js';
import { priceOf } from './bomb.js';
import { MSG, PF, NONE, WEAPON_IDS, readSnap, writeCmds } from './netsync.js';

const INTERP = 0.1;     // others are shown this far in the past (between two snapshots)
const SEND_EVERY = 2;   // ticks between sending our keys
const RESEND = 8;       // the newest keys go out again with each send (packets get lost)
const BOMB = { id: 'c4' }; // a bomb on someone's back (the model only asks if there is one)

const vec = (a) => (Array.isArray(a) ? new THREE.Vector3(a[0], a[1], a[2]) : a);
const lerpAngle = (a, b, k) => {
  let x = b - a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return a + x * k;
};
// what our own game handles the moment it comes in (the rest waits for its time)
const AT_ONCE = new Set(['tell', 'state', 'roster', 'hacks', 'board', 'over']);
const OUR_OWN = new Set(['we', 'gs', 'ps', 'shot']);

export class NetClient {
  // session: our ClientSession (online.js); start: the host's 'start' message
  constructor(session, start) {
    this.s = session;
    this.start = start;
    this.cfg = start.cfg;
    this.g = null;
    this.waiting = [];      // what came in while the map was loading
    this.snaps = [];        // the host's snapshots, oldest first
    this.events = [];       // waiting for the shown moment to reach them
    this.rt = start.time - INTERP; // the moment the others are shown at
    this.rate = 1;
    this.seq = 0;
    this.pending = [];      // our keys the host hasn't run yet (newest last)
    this.lastMe = 0;        // the snapshot our player last came from
    this.n = 0;
    this.nades = new Map(); // grenades in the air: their number -> what's drawn
    this.c4 = null;
  }

  // ---------------------------------------------------------------- setting up

  // the map is loaded: make everyone and catch up
  attach(g) {
    this.g = g;
    const st = this.start;
    g.time = this.rt;
    for (const e of st.roster) this.puppet(e);
    g.human = g.byId(st.you);
    if (!g.human) {
      // (can't happen: the host lists us) a watcher with no body
      g.human = this.puppet([st.you, settings.playerName || 'Player', null, 'T', 0, -1, null, 1]);
    }
    const h = g.human;
    delete h.duckAmount;          // ours comes from our own movement
    h.hackCfg = hackCfg(settings.hackCfg);
    this.setState(st.state);
    for (const m of st.items) this.addItem(m);
    this.setBomb(st.bomb);
    this.setBoard(st.board);
    for (const [id, hacks] of st.hacks) this.setHacks(id, hacks);
    for (const i of st.breaks) this.breakIt(i, null, true);
    for (const [pos, start] of st.smokes) this.smoke(pos, start);
    const waiting = this.waiting;
    this.waiting = [];
    for (const msg of waiting) this.receive(msg);
  }

  // a player as the host lists them: [id, name, team, look, bot, pid, color, spectator]
  puppet(e) {
    const g = this.g;
    const [id, name, team, look, bot, pid, color, spec] = e;
    const p = new Player(id, name, !!bot);
    p.team = team;
    p.spectator = !!spec;
    p.pid = pid;
    p.char = color ? { color } : null;
    p.hacks = noHacks();
    p.hackCfg = hackCfg(null);
    p.guns = {};
    p.duck = 0;
    // the snapshots say how crouched they are
    p.duckAmount = () => p.duck;
    g.makeModel(p, look || 'T');
    g.players.push(p);
    return p;
  }

  dispose() {
    this.removeC4();
    this.nades.clear();
    this.g = null;
  }

  send(msg, fast = false) {
    this.s.send(msg, fast);
  }

  // ---------------------------------------------------------------- coming in

  receive(msg) {
    if (!this.g) {
      this.waiting.push(msg);
      return;
    }
    if (msg instanceof ArrayBuffer) {
      if (new Uint8Array(msg)[0] !== MSG.SNAP) return;
      let s;
      try {
        s = readSnap(msg);
      } catch {
        return;
      }
      this.snap(s);
      return;
    }
    if (msg && msg.t === 'ev' && Array.isArray(msg.e)) for (const e of msg.e) this.event(e);
  }

  snap(s) {
    const S = this.snaps;
    if (S.some((x) => x.seq === s.seq)) return;
    // (one arriving late still helps between two others)
    let i = S.length;
    while (i > 0 && S[i - 1].seq > s.seq) i--;
    S.splice(i, 0, s);
    const newest = i === S.length - 1;
    while (S.length > 2 && S[1].time < this.rt - 0.5) S.shift();
    if (!newest) return;
    // the clock: show the others INTERP behind the newest snapshot
    const err = s.time - INTERP - this.rt;
    if (Math.abs(err) > 0.3) this.rt = s.time - INTERP;
    else this.rate = 1 + Math.max(-0.08, Math.min(0.08, err * 1.5));
    if (s.me && s.seq > this.lastMe) {
      this.lastMe = s.seq;
      this.me(s);
    }
  }

  event(e) {
    if (!Array.isArray(e)) return;
    const kind = e[1];
    // for our own screen, and what our own player does: right away
    if (AT_ONCE.has(kind) || (OUR_OWN.has(kind) && e[2] === this.g.human.id)) this.happen(e);
    else this.events.push(e);
  }

  // ---------------------------------------------------------------- our player

  // the host's answer about us: what we have, and where we really are
  me(s) {
    const g = this.g, h = g.human, m = s.me;
    const e = s.players.find((x) => x.id === h.id);
    const wasAlive = h.alive;
    if (e) {
      h.alive = !!(e.flags & PF.alive);
      h.health = h.alive ? e.health : 0;
      h.hasCorpse = !!(e.flags & PF.corpse);
      h.punchPitch = e.punchPitch;
      h.punchYaw = e.punchYaw;
      h.defusing = !!(e.flags & PF.defusing);
      h.spawnProtectUntil = e.flags & PF.protect ? g.time + 1 : 0;
    }
    h.armor = m.armor;
    h.helmet = m.helmet;
    h.defuser = m.defuser;
    h.money = m.money;
    h.nades = m.nades;
    h.lastSlot = m.lastSlot;
    // the guns (the same objects stay: the viewmodel and the HUD look at them)
    for (let k = 1; k <= 5; k++) {
      const w = m.weapons[k];
      if (!w) {
        h.weapons[k] = null;
        continue;
      }
      let cur = h.weapons[k];
      if (!cur || cur.id !== w.id) cur = h.weapons[k] = makeWeapon(w.id);
      cur.clip = w.clip;
      cur.reserve = w.reserve;
      cur.silenced = w.silenced;
      cur.burst = w.burst;
    }
    h.slot = m.slot;
    const w = h.weapon;
    if (w && e) {
      w.zoom = e.zoom;
      w.pin = !!(e.flags & PF.pin);
      w.reloading = !!(e.flags & PF.reload);
      w.redeployAt = e.flags & PF.thrown ? 1 : 0;
      const arming = !!(e.flags & PF.arming);
      if (arming && !w.arming) w.armStart = g.time;
      w.arming = arming;
      if (w.def.type === 'grenade') w.clip = h.nades[w.id] || 0;
    }
    // where we are: the host's word, then our keys it hasn't run yet, again
    this.pending = this.pending.filter((c) => c.seq > s.ack);
    if (!h.alive) return;
    h.pos.set(m.x, m.y, m.z);
    h.vel.set(m.vx, m.vy, m.vz);
    h.onGround = m.onGround;
    h.ducked = m.ducked;
    h.inDuck = m.inDuck;
    h.oldJump = m.oldJump;
    h.duckTimer = m.duckTimer;
    h.fuser2 = m.fuser2;
    h.fallVelocity = m.fallVelocity;
    h.ladderCooldown = m.ladderCooldown;
    h.velMod = m.velMod;
    h.maxspeed = m.maxspeed;
    if (!wasAlive) h.prevPos.copy(h.pos);
    const yaw = h.yaw, pitch = h.pitch;
    for (const c of this.pending) this.predict(c);
    h.yaw = yaw;
    h.pitch = pitch;
  }

  // one tick of our movement with these keys (and the view they were pressed with)
  predict(c) {
    const g = this.g, h = g.human;
    if (!h.alive) return;
    const cmd = { ...c };
    h.yaw = c.yaw;
    h.pitch = c.pitch;
    if (h.hacks.autobhop) h.oldJump = false;
    g.holdStill(h, cmd, g.frozen());
    const others = g.players.filter((p) => p.alive && p !== h);
    g.move(h, cmd, others, TICK);
  }

  // a friend buying: the host does it (and says why if it can't)
  buy(id) {
    this.send({ t: 'buy', id });
    return this.g.human.money >= priceOf(id);
  }

  // ---------------------------------------------------------------- every tick

  tick(dt) {
    const g = this.g, h = g.human;
    this.n++;
    this.rt += dt * this.rate;
    g.time = this.rt;
    // our keys: run here now, and off to the host
    const cmd = g.humanCmd();
    if (h.alive && h.hacking) hackCmd(g, h, cmd, dt);
    h.oldAttack = cmd.attack;
    cmd.yaw = h.yaw;
    cmd.pitch = h.pitch;
    cmd.seq = ++this.seq;
    this.pending.push(cmd);
    if (this.pending.length > 300) this.pending.shift();
    h.prevPos.copy(h.pos);
    if (h.alive) {
      this.predict(cmd);
      h.yaw = cmd.yaw;
      h.pitch = cmd.pitch;
      // the recoil kick wears off here as on the host (DropPunchAngle) until its next word
      const len = Math.hypot(h.punchPitch, h.punchYaw);
      if (len > 0) {
        const nl = Math.max(0, len - (10 + len * 0.5) * dt);
        h.punchPitch *= nl / len;
        h.punchYaw *= nl / len;
      }
    }
    if (this.n % SEND_EVERY === 0) this.s.send(writeCmds(this.rt, this.pending.slice(-RESEND)), true);
    // what has happened by now, and where everyone is
    const evs = this.events;
    let i = 0;
    while (i < evs.length && evs[i][0] <= this.rt) this.happen(evs[i++]);
    if (i) evs.splice(0, i);
    this.pose();
    if (g.timers.length) {
      const due = g.timers.filter((tm) => tm.at <= g.time);
      if (due.length) {
        g.timers = g.timers.filter((tm) => tm.at > g.time);
        for (const tm of due) tm.fn();
      }
    }
    // smoke: how big and thick each cloud is now (sight lines, the grey screen)
    g.grenades.expire();
    for (const c of g.grenades.clouds) g.grenades.grow(c, g.time);
  }

  // everyone else where the snapshots around the shown moment have them
  pose() {
    const g = this.g, S = this.snaps;
    if (!S.length) return;
    let i = S.length - 1;
    while (i > 0 && S[i].time > this.rt) i--;
    const a = S[i], b = S[Math.min(S.length - 1, i + 1)];
    const k = b.time > a.time ? Math.max(0, Math.min(1, (this.rt - a.time) / (b.time - a.time))) : 0;
    const later = new Map(b.players.map((e) => [e.id, e]));
    for (const ea of a.players) {
      const p = g.byId(ea.id);
      if (!p || p === g.human) continue;
      this.posePlayer(p, ea, later.get(ea.id) || ea, k, a.time);
    }
    // grenades in the air
    const seen = new Set();
    const nb = new Map(b.nades.map((n) => [n.rid, n]));
    for (const na of a.nades) {
      seen.add(na.rid);
      let e = this.nades.get(na.rid);
      if (!e) {
        const mesh = new THREE.Mesh(thirdPersonWeapon(na.id, g.textures).plain, g.grenades.mat);
        g.scene.add(mesh);
        e = { id: na.id, pos: new THREE.Vector3(na.x, na.y, na.z), mesh, onGround: false, done: false, puppet: true,
          spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14) };
        this.nades.set(na.rid, e);
        g.grenades.list.push(e);
      }
      const n2 = nb.get(na.rid) || na;
      e.pos.set(na.x + (n2.x - na.x) * k, na.y + (n2.y - na.y) * k, na.z + (n2.z - na.z) * k);
      e.onGround = na.ground;
    }
    for (const [rid, e] of this.nades) {
      if (seen.has(rid)) continue;
      g.scene.remove(e.mesh);
      g.grenades.list = g.grenades.list.filter((x) => x !== e);
      this.nades.delete(rid);
    }
    // doors
    const doors = g.map.doors;
    a.doors.forEach((d, j) => {
      const dr = doors.list[j];
      if (!dr) return;
      if (dr.type === 'swing') {
        dr.angle = d.v;
        if (d.solid !== dr.solidState && d.solid >= -1 && d.solid <= 1) doors.setSwingBoxes(dr, d.solid);
      } else {
        dr.pos = d.v;
        doors.placeSlide(dr);
      }
      doors.pose(dr);
    });
    // things on the ground being knocked about
    const ib = new Map(b.items.map((x) => [x.nid, x]));
    for (const ia of a.items) {
      const it = this.item(ia.nid);
      if (!it) continue;
      const i2 = ib.get(ia.nid) || ia;
      it.pos.set(ia.x + (i2.x - ia.x) * k, ia.y + (i2.y - ia.y) * k, ia.z + (i2.z - ia.z) * k);
      it.mesh.position.copy(it.pos);
      it.mesh.rotation.set(lerpAngle(ia.rx, i2.rx, k), lerpAngle(ia.ry, i2.ry, k), lerpAngle(ia.rz, i2.rz, k));
      it.onGround = ia.ground;
    }
  }

  // one of the others, between two snapshots (k: how far from the first)
  posePlayer(p, ea, eb, k, ta) {
    const g = this.g;
    // a snapshot from before a kill we've already seen has them standing still
    const alive = !!(ea.flags & PF.alive) && !(p.killT != null && ta <= p.killT + 1e-6);
    let snap = false;
    const far = Math.hypot(eb.x - ea.x, eb.z - ea.z) > 120; // a respawn: no gliding there
    const kk = far ? 0 : k;
    if (alive && !p.alive) {
      p.alive = true;
      p.hasCorpse = false;
      p.killT = null;
      snap = true;
    } else if (!alive && p.alive) {
      // died without us seeing the kill (or it's coming): lying there already
      p.alive = false;
      p.hasCorpse = !!(ea.flags & PF.corpse);
      p.diedAt = g.time - 10;
    } else if (!alive) p.hasCorpse = !!(ea.flags & PF.corpse) || (p.hasCorpse && p.killT != null);
    const x = ea.x + (eb.x - ea.x) * kk, y = ea.y + (eb.y - ea.y) * kk, z = ea.z + (eb.z - ea.z) * kk;
    if (snap || !p.alive) {
      if (!p.alive && p.killT != null) return; // lying where they fell
      p.pos.set(x, y, z);
      p.prevPos.copy(p.pos);
    } else {
      p.prevPos.copy(p.pos);
      p.pos.set(x, y, z);
    }
    p.vel.set(ea.vx + (eb.vx - ea.vx) * kk, ea.vy + (eb.vy - ea.vy) * kk, ea.vz + (eb.vz - ea.vz) * kk);
    p.yaw = lerpAngle(ea.yaw, eb.yaw, kk);
    p.pitch = ea.pitch + (eb.pitch - ea.pitch) * kk;
    p.duck = ea.duck + (eb.duck - ea.duck) * kk;
    p.ducked = !!(ea.flags & PF.ducked);
    p.onGround = !!(ea.flags & PF.ground);
    p.defusing = !!(ea.flags & PF.defusing);
    p.health = p.alive ? ea.health : 0;
    p.punchPitch = ea.punchPitch + (eb.punchPitch - ea.punchPitch) * kk;
    p.punchYaw = ea.punchYaw + (eb.punchYaw - ea.punchYaw) * kk;
    p.spawnProtectUntil = ea.flags & PF.protect ? g.time + 1 : 0;
    p.weapons[5] = ea.flags & PF.bomb ? BOMB : null;
    // the gun in their hands (it lives in slot 3 here: only the one in hand is known)
    const id = ea.weapon !== NONE ? WEAPON_IDS[ea.weapon] : null;
    if (id) {
      const w = (p.guns[id] ||= makeWeapon(id));
      const nade = w.def.type === 'grenade';
      w.silenced = !!(ea.flags & PF.silenced);
      w.zoom = ea.zoom;
      w.pin = !!(ea.flags & PF.pin);
      w.reloading = !!(ea.flags & PF.reload);
      w.redeployAt = ea.flags & PF.thrown ? 1 : 0;
      w.arming = !!(ea.flags & PF.arming);
      w.burst = !!(ea.flags & PF.burst);
      w.clip = ea.clip;
      w.reserve = ea.reserve;
      if (nade) p.nades[id] = ea.clip;
      p.weapons[3] = w;
    } else p.weapons[3] = null;
    p.slot = 3;
  }

  // ---------------------------------------------------------------- events

  happen(e) {
    const g = this.g;
    const P = (id) => g.byId(id);
    switch (e[1]) {
      case 'fx':
        if (typeof g.effects[e[2]] === 'function' && Array.isArray(e[3])) g.effects[e[2]](...e[3].map(vec));
        break;
      case 'ps': {
        const p = P(e[2]);
        if (p) g.playerSound(e[3], p, e[4], e[5], e[6], e[7]);
        break;
      }
      case 'gs': {
        const p = P(e[2]);
        if (p) g.gunSound(p, e[3], !!e[4]);
        break;
      }
      case 'as':
        g.soundSys.play(e[2], { pos: { x: e[3][0], y: e[3][1], z: e[3][2] }, volume: e[4], ref: e[5], reverb: e[6] });
        // the planted bomb's light blinks with its beep
        if (e[2] === 'c4_beep' && g.bm) g.bm.ledUntil = g.time + 0.12;
        break;
      case 'ns':
        g.soundSys.play(e[2], e[3] || {});
        break;
      case 'we': {
        const p = P(e[2]);
        if (p && p.alive && p.weapon) g.weaponEvent(p, e[3], e[4] ?? undefined);
        break;
      }
      case 'shot': {
        const p = P(e[2]);
        if (!p || !p.alive) break;
        const end = vec(e[3]);
        g.bulletTracer(p, end);
        if (g.specMode === 'overview') g.shotLines.push({ ax: p.pos.x, az: p.pos.z, bx: end.x, bz: end.z, team: p.team, t: g.time, p });
        break;
      }
      case 'kill':
        this.kill(e);
        break;
      case 'blind': {
        // our own flash, or the one of whoever we watch through their eyes
        const p = P(e[2]), h = g.human;
        if (p && (p === h || (!h.alive && p === g.specTarget && g.specMode === 'eye'))) g.whiteOut(e[3], e[4], e[5]);
        break;
      }
      case 'shake':
        g.shake(vec(e[2]), e[3]);
        break;
      case 'brk':
        this.breakIt(e[2], e[3], false);
        break;
      case 'smoke':
        this.smoke(e[2], e[0]);
        break;
      case 'flinch': {
        const p = P(e[2]);
        if (p && p.alive) p.model.flinch(vec(e[3]), p.yaw, !!e[4]);
        break;
      }
      case 'radio': {
        const p = P(e[2]);
        if (p) g.radio.show(p, e[3]);
        break;
      }
      case 'item+':
        this.addItem(e[2]);
        break;
      case 'item-': {
        const it = this.item(e[2]);
        if (it) g.items.remove(it);
        break;
      }
      case 'items0':
        g.items.clear();
        break;
      case 'round0':
        // a new round: smoke, grenades and the bomb gone, windows whole again
        g.grenades.clear();
        this.nades.clear();
        g.map.resetBreakables();
        this.removeC4();
        break;
      case 'tell': case 'all':
        g.show(e[2], ...(Array.isArray(e[3]) ? e[3] : []));
        break;
      case 'roster':
        this.roster(e[2]);
        break;
      case 'state':
        this.setState(e[2]);
        break;
      case 'bomb':
        this.setBomb(e[2]);
        break;
      case 'board':
        this.setBoard(e[2]);
        break;
      case 'hacks':
        this.setHacks(e[2], e[3]);
        break;
      case 'over':
        g.over = true;
        g.hooks.onMatchEnd(tmsg(e[2]), g.scoreboardHtml());
        break;
      default:
    }
  }

  kill(e) {
    const g = this.g;
    const victim = g.byId(e[2]), killer = e[3] >= 0 ? g.byId(e[3]) : null;
    if (!victim) return;
    victim.alive = false;
    victim.hasCorpse = true;
    victim.health = 0;
    victim.diedAt = g.time;
    // the snapshots from before this moment still have them standing
    victim.killT = e[0];
    const d = e[7];
    if (d) {
      const fx = -Math.sin(victim.yaw), fz = -Math.cos(victim.yaw);
      victim.model.fallDir = d[0] * fx + d[1] * fz < 0 ? 1 : -1;
      victim.model.fallSide = (Math.random() - 0.5) * 0.6;
    }
    victim.model.setGlow(0);
    g.deathMarks.push({ x: victim.pos.x, z: victim.pos.z, team: victim.team, t: g.time });
    g.hud.kill({ killer, victim, weapon: e[4], headshot: !!e[5], hack: !!e[6] }, g.time, g.human);
  }

  // the host's list of players: new ones come, gone ones go, teams change
  roster(list) {
    const g = this.g, ids = new Set();
    for (const e of list) {
      ids.add(e[0]);
      const p = g.byId(e[0]);
      if (!p) {
        this.puppet(e);
        continue;
      }
      p.name = e[1];
      p.team = e[2];
      p.isBot = !!e[4];
      p.pid = e[5];
      p.spectator = !!e[7];
      const color = e[6] || null;
      if (e[3] !== p.look || color !== (p.char ? p.char.color : null)) {
        p.char = color ? { color } : null;
        g.makeModel(p, e[3] || 'T');
      }
    }
    for (const p of [...g.players]) {
      if (ids.has(p.id) || p === g.human) continue;
      g.scene.remove(p.model.root);
      p.model.dispose();
      g.players = g.players.filter((o) => o !== p);
      if (g.specTarget === p) g.specTarget = null;
    }
  }

  setState(st) {
    const g = this.g, r = g.round;
    r.n = st.n;
    r.state = st.st;
    r.until = st.until;
    r.endsAt = st.ends;
    g.teamScore = { T: st.score[0], CT: st.score[1] };
    g.matchEndsAt = st.end || Infinity;
    if (g.bm) {
      g.bm.roundStartTime = st.buy;
      g.bm.planted = st.planted;
    }
  }

  setBoard(list) {
    for (const [id, kills, deaths, score, hackKills, ping, ggLevel, ggKills, money] of list) {
      const p = this.g.byId(id);
      if (!p) continue;
      Object.assign(p, { kills, deaths, score, hackKills, ping, ggLevel, ggKills });
      if (p !== this.g.human) p.money = money;
    }
  }

  setHacks(id, hacks) {
    const p = this.g.byId(id);
    if (!p || !hacks || typeof hacks !== 'object') return;
    p.hacks = { ...noHacks() };
    for (const k of Object.keys(p.hacks)) p.hacks[k] = !!hacks[k];
    p.hacking = isHacking(p);
  }

  // where the bomb is (carried, dropped, planted) and who's defusing it
  setBomb(b) {
    const g = this.g, bm = g.bm;
    if (!bm) return;
    const item = b && b.item ? this.item(b.item) : null;
    if (!b || (b.st === 'dropped' && !item)) {
      bm.bomb = null;
      this.removeC4();
      return;
    }
    bm.bomb = {
      state: b.st, carrier: b.c >= 0 ? g.byId(b.c) : null, item, pos: b.pos ? vec(b.pos) : null,
      defuser: b.d >= 0 ? g.byId(b.d) : null, defuseStart: b.ds, defuseEnd: b.de,
    };
    if (b.st === 'carried' && !bm.bomb.carrier) bm.bomb = null;
    if (b.st === 'planted' && b.pos) {
      if (!this.c4) {
        this.c4 = new THREE.Mesh(thirdPersonWeapon('c4', g.textures).plain, g.items.mat);
        g.scene.add(this.c4);
      }
      this.c4.position.set(b.pos[0], b.pos[1] + 0.8, b.pos[2]);
      this.c4.rotation.y = b.yaw || 0;
    } else this.removeC4();
  }

  removeC4() {
    if (!this.c4 || !this.g) return;
    this.g.scene.remove(this.c4);
    this.c4 = null;
  }

  item(nid) {
    return this.g.items.list.find((it) => it.nid === nid) || null;
  }

  // something put on the ground: [nid, kind, id, silenced, pos, rotation, onGround]
  addItem(m) {
    const g = this.g;
    if (!Array.isArray(m) || this.item(m[0])) return;
    const [nid, kind, id, sil, pos, rot, ground] = m;
    const w = kind === 'weapon' ? makeWeapon(id) : null;
    if (w) w.silenced = !!sil;
    const it = g.items.make(kind, id, w, vec(pos), new THREE.Vector3(), null);
    it.nid = nid;
    it.onGround = !!ground;
    it.mesh.rotation.set(rot[0], rot[1], rot[2]);
    it.mesh.position.copy(it.pos);
  }

  // a window, vent or crate broke (before: it was already broken when we came)
  breakIt(i, dir, before) {
    const g = this.g;
    const piece = g.map.breakables[i];
    if (!piece || piece.box.off) return;
    piece.box.off = true;
    if (piece.mesh) piece.mesh.visible = false;
    if (before) return;
    const box = piece.box;
    g.effects.gibs(box, box.mat === 'glass' ? 'glass' : box.mat === 'grate' ? 'metal' : 'wood', vec(dir) || new THREE.Vector3(0, 1, 0));
    g.effects.clearDecalsIn(box);
  }

  // a smoke cloud, as it started at time t (its hiss came as a sound of its own)
  smoke(pos, t) {
    const g = this.g;
    const play = g.soundAt;
    g.soundAt = () => {};
    const now = g.time;
    g.time = t;
    g.grenades.startSmoke({ pos: vec(pos) });
    g.time = now;
    g.soundAt = play;
  }
}

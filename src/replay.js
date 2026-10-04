// Playing a Bot Arena highlight back (highlights.js records them). The
// players are puppets that follow the recording, and what they did (shots,
// kills, grenades, sounds, effects) happens again on time. The game draws
// them like any match, so every spectator view works, and it starts in the
// star's eyes, slowing down around their kills.

import * as THREE from '../lib/three.module.js';
import { Player } from './player.js';
import { makeWeapon } from './weapons.js';
import { thirdPersonWeapon } from './models.js';
import { noHacks, HACK_DEFAULTS } from './hacks.js';
import { t } from './i18n.js';
import { STRIDE, WEAPON_IDS, NADE_IDS, F } from './highlights.js';

const SLOW = 0.3;        // slow motion around the star's kills
const SLOW_IN = 0.5, SLOW_OUT = 0.6; // seconds before and after each kill
const BOMB = { id: 'c4' }; // a bomb on someone's back (the model only asks if there is one)

const vec = (a) => (Array.isArray(a) ? new THREE.Vector3(a[0], a[1], a[2]) : a);

export class ReplayPlayer {
  constructor(game, clip) {
    this.g = game;
    this.c = clip;
    this.t = 0;                       // seconds into the clip
    this.dur = (clip.n - 1) / clip.fps;
    clip.events.sort((a, b) => a.t - b.t);
    this.next = 0;                    // the next event to happen
    this.nades = new Map();           // grenades in the air: their number -> what's drawn
    this.c4 = null;
    // the star's kills: around them it slows down
    this.kills = clip.events.filter((e) => e.k === 'kill' && e.a === clip.star && e.t >= clip.t0).map((e) => e.t - clip.t0);
    this.follow = true;               // the camera stays on the star (until you pick someone)
    this.makePuppets();
    // what happened before the clip: smoke still hanging, glass broken, the bomb down
    while (this.next < clip.events.length && clip.events[this.next].t < clip.t0) this.happen(clip.events[this.next++], true);
    this.pose(0, true);
  }

  makePuppets() {
    const g = this.g, c = this.c;
    this.ps = c.players.map((cp, i) => {
      const p = new Player(i + 1, cp.name, true);
      p.char = { id: cp.cid, name: cp.name, color: cp.color };
      p.arenaSide = cp.side;
      p.hacks = noHacks();
      p.hackCfg = { ...HACK_DEFAULTS };
      const team = this.teamAt(0, i);
      p.team = team;
      g.makeModel(p, cp.look || team || 'T');
      p.guns = {};
      p.slot = 3;
      p.duck = 0;
      // the recording says how crouched they are
      p.duckAmount = () => p.duck;
      g.players.push(p);
      return p;
    });
    this.star = this.ps[c.star];
  }

  teamAt(f, i) {
    const v = this.c.data[(f * this.c.players.length + i) * STRIDE + 12];
    return v === 0 ? 'T' : v === 1 ? 'CT' : null;
  }

  // how fast the replay runs now (slow around the star's kills)
  speed() {
    for (const k of this.kills) if (this.t > k - SLOW_IN && this.t < k + SLOW_OUT) return SLOW;
    return 1;
  }

  tick(dt) {
    const g = this.g;
    if (this.t >= this.dur) {
      if (!g.over) {
        g.over = true;
        g.hooks.onReplayEnd?.();
      }
      return;
    }
    this.t = Math.min(this.dur, this.t + dt);
    g.time = this.c.t0 + this.t;
    // what happened first (a kill lays them down now), then everyone moves on
    const evs = this.c.events;
    while (this.next < evs.length && evs[this.next].t <= g.time) this.happen(evs[this.next++], false);
    this.pose(this.t, false);
    if (this.follow && this.star.alive && g.specTarget !== this.star) g.specTarget = this.star;
    g.grenades.expire();
    // timers the game set (shells after a bolt is worked)
    if (g.timers.length) {
      const due = g.timers.filter((tm) => tm.at <= g.time);
      if (due.length) {
        g.timers = g.timers.filter((tm) => tm.at > g.time);
        for (const tm of due) tm.fn();
      }
    }
  }

  // everyone where the recording has them at time s
  pose(s, jump) {
    const g = this.g, c = this.c, n = this.ps.length, d = c.data;
    const fpos = Math.min(c.n - 1, s * c.fps);
    const f0 = Math.floor(fpos), f1 = Math.min(c.n - 1, f0 + 1), k = fpos - f0;
    const lerpAngle = (a, b) => {
      let x = b - a;
      while (x > Math.PI) x -= Math.PI * 2;
      while (x < -Math.PI) x += Math.PI * 2;
      return a + x * k;
    };
    // when the frame we stand on was recorded
    const tf = c.t0 + f0 / c.fps;
    this.ps.forEach((p, i) => {
      const o0 = (f0 * n + i) * STRIDE, o1 = (f1 * n + i) * STRIDE;
      const flags = d[o0 + 6];
      // a frame from before a kill we've just seen: they're down already
      const alive = !!(flags & F.alive) && !(p.killT != null && tf <= p.killT + 1e-6);
      let snap = jump;
      // a teleport (a respawn): no gliding there
      const far = Math.hypot(d[o1] - d[o0], d[o1 + 2] - d[o0 + 2]) > 120;
      const x = far ? d[o0] : d[o0] + (d[o1] - d[o0]) * k;
      const y = far ? d[o0 + 1] : d[o0 + 1] + (d[o1 + 1] - d[o0 + 1]) * k;
      const z = far ? d[o0 + 2] : d[o0 + 2] + (d[o1 + 2] - d[o0 + 2]) * k;
      if (alive && !p.alive) {
        // back in (a respawn)
        p.alive = true;
        p.hasCorpse = false;
        snap = true;
      } else if (!alive && p.alive && !(flags & F.corpse)) {
        p.alive = false;
        p.hasCorpse = false;
      } else if (!alive && p.alive) {
        // died without us seeing the kill (before the clip): lying there already
        p.alive = false;
        p.hasCorpse = true;
        p.diedAt = g.time - 10;
      }
      if (snap || !p.alive) {
        p.pos.set(x, y, z);
        p.prevPos.copy(p.pos);
      } else {
        p.prevPos.copy(p.pos);
        p.pos.set(x, y, z);
      }
      // how fast they move (for the walking legs)
      const dt = 1 / c.fps;
      p.vel.set((d[o1] - d[o0]) / dt, (d[o1 + 1] - d[o0 + 1]) / dt, (d[o1 + 2] - d[o0 + 2]) / dt);
      if (far) p.vel.set(0, 0, 0);
      p.yaw = lerpAngle(d[o0 + 3], d[o1 + 3]);
      p.pitch = d[o0 + 4] + (d[o1 + 4] - d[o0 + 4]) * k;
      p.duck = d[o0 + 5] + (d[o1 + 5] - d[o0 + 5]) * k;
      p.ducked = !!(flags & F.ducked);
      p.onGround = !!(flags & F.ground);
      p.defusing = !!(flags & F.defusing);
      p.health = p.alive ? d[o0 + 8] : 0;
      p.punchPitch = d[o0 + 9] + (d[o1 + 9] - d[o0 + 9]) * k;
      p.punchYaw = d[o0 + 10] + (d[o1 + 10] - d[o0 + 10]) * k;
      p.spawnProtectUntil = flags & F.protect ? g.time + 1 : 0;
      p.weapons[5] = flags & F.bomb ? BOMB : null;
      // the gun in their hands
      const wi = d[o0 + 7];
      const id = wi >= 0 ? WEAPON_IDS[wi] : null;
      if (id) {
        const w = (p.guns[id] ||= makeWeapon(id));
        w.silenced = !!(flags & F.silenced);
        w.zoom = d[o0 + 11];
        w.pin = !!(flags & F.pin);
        w.reloading = !!(flags & F.reload);
        w.clip = Math.max(1, w.clip || 1);
        p.weapons[3] = w;
      } else p.weapons[3] = null;
      // the side swap moves them to the other team
      const team = this.teamAt(f0, i);
      if (team !== p.team && team) {
        p.team = team;
        g.makeModel(p, team);
      }
    });
    // grenades in the air
    const seen = new Set();
    const list = c.nades[f0] || [];
    const next = c.nades[f1] || [];
    for (let j = 0; j < list.length; j += 6) {
      const rid = list[j];
      seen.add(rid);
      let e = this.nades.get(rid);
      if (!e) {
        const id = NADE_IDS[list[j + 1]] || 'hegrenade';
        const mesh = new THREE.Mesh(thirdPersonWeapon(id, g.textures).plain, g.grenades.mat);
        g.scene.add(mesh);
        e = { id, pos: new THREE.Vector3(), mesh, onGround: false, done: false, puppet: true,
          spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14) };
        this.nades.set(rid, e);
        g.grenades.list.push(e);
      }
      let x = list[j + 2], y = list[j + 3], z = list[j + 4];
      for (let q = 0; q < next.length; q += 6) {
        if (next[q] !== rid) continue;
        x += (next[q + 2] - x) * k;
        y += (next[q + 3] - y) * k;
        z += (next[q + 4] - z) * k;
      }
      e.pos.set(x, y, z);
      e.onGround = !!list[j + 5];
    }
    for (const [rid, e] of this.nades) {
      if (seen.has(rid)) continue;
      g.scene.remove(e.mesh);
      g.grenades.list = g.grenades.list.filter((x) => x !== e);
      this.nades.delete(rid);
    }
    // doors
    const doors = c.doors[f0] || [];
    g.map.doors.list.forEach((dr, j) => {
      if (doors[j] == null) return;
      if (dr.type === 'swing') dr.angle = doors[j] / 100;
      else dr.pos = doors[j] / 100;
      g.map.doors.pose(dr);
    });
    // the score at the top
    const sc = c.score[f0];
    if (sc) g.teamScore = { T: sc[0], CT: sc[1] };
  }

  // one recorded thing happens again (before: it was before the clip, only its traces count)
  happen(e, before) {
    const g = this.g;
    switch (e.k) {
      case 'snd': {
        if (before) return;
        const o = { ...e.o };
        if (o.pos) o.pos = { x: o.pos[0], y: o.pos[1], z: o.pos[2] };
        for (const key of Object.keys(o)) if (o[key] == null) delete o[key];
        g.soundSys.play(e.n, o);
        return;
      }
      case 'fx':
        if (before || typeof g.effects[e.m] !== 'function') return;
        g.effects[e.m](...e.a.map(vec));
        return;
      case 'we': {
        if (before) return;
        const p = this.ps[e.p];
        if (p && p.alive && p.weapon) g.weaponEvent(p, e.ty, e.a ?? undefined);
        return;
      }
      case 'shot': {
        if (before) return;
        const p = this.ps[e.p];
        if (!p || !p.alive) return;
        const end = vec(e.e);
        g.bulletTracer(p, end);
        if (g.specMode === 'overview') g.shotLines.push({ ax: p.pos.x, az: p.pos.z, bx: end.x, bz: end.z, team: p.team, t: g.time, p });
        return;
      }
      case 'kill':
        if (!before) this.kill(e);
        return;
      case 'blind':
        if (!before && this.ps[e.p] === g.specTarget && g.specMode === 'eye') g.flashFx = { start: g.time, hold: e.h, fade: e.f, alpha: e.al };
        return;
      case 'break': {
        const piece = g.map.breakables[e.b];
        if (!piece || piece.box.off) return;
        piece.box.off = true;
        if (piece.mesh) piece.mesh.visible = false;
        if (!before) {
          const box = piece.box;
          g.effects.gibs(box, box.mat === 'glass' ? 'glass' : box.mat === 'grate' ? 'metal' : 'wood', vec(e.d) || new THREE.Vector3(0, 1, 0));
          g.effects.clearDecalsIn(box);
        }
        return;
      }
      case 'smoke': {
        // the cloud, started when it was (without its hiss again)
        const sound = g.soundAt;
        g.soundAt = () => {};
        const tNow = g.time;
        g.time = e.t;
        g.grenades.startSmoke({ pos: new THREE.Vector3(e.x, e.y, e.z) });
        g.time = tNow;
        g.soundAt = sound;
        return;
      }
      case 'c4': {
        this.removeC4();
        const mesh = new THREE.Mesh(thirdPersonWeapon('c4', g.textures).plain, g.grenades.mat);
        mesh.position.set(e.x, e.y + 0.8, e.z);
        mesh.rotation.y = e.yaw || 0;
        g.scene.add(mesh);
        this.c4 = mesh;
        return;
      }
      case 'c4off':
        this.removeC4();
        return;
      case 'round':
        if (before) return;
        g.hud.centerPrint(e.r === 'bombed' ? t('targetBombed') : e.r === 'defused' ? t('bombDefused') : e.r === 'saved' ? t('targetSaved')
          : e.w === 'T' ? t('terroristsWin') : e.w === 'CT' ? t('ctsWin') : t('roundDraw'), g.time, 3);
        return;
      default:
    }
  }

  kill(e) {
    const g = this.g;
    const victim = this.ps[e.v], killer = e.a >= 0 ? this.ps[e.a] : null;
    if (!victim) return;
    victim.alive = false;
    victim.hasCorpse = true;
    victim.health = 0;
    victim.diedAt = g.time;
    // the frames from before this moment still have them standing
    victim.killT = e.t;
    victim.deaths++;
    if (killer && killer !== victim) {
      killer.kills++;
      killer.score++;
    }
    if (e.d) {
      const fx = -Math.sin(victim.yaw), fz = -Math.cos(victim.yaw);
      victim.model.fallDir = e.d[0] * fx + e.d[1] * fz < 0 ? 1 : -1;
      victim.model.fallSide = (Math.random() - 0.5) * 0.6;
    }
    victim.model.setGlow(0);
    g.deathMarks.push({ x: victim.pos.x, z: victim.pos.z, team: victim.team, t: g.time });
    g.hud.kill({ killer, victim, weapon: e.w, headshot: e.hs, hack: false }, g.time, g.human);
  }

  removeC4() {
    if (!this.c4) return;
    this.g.scene.remove(this.c4);
    this.c4 = null;
  }

  dispose() {
    const g = this.g;
    this.removeC4();
    for (const e of this.nades.values()) g.scene.remove(e.mesh);
    this.nades.clear();
  }
}

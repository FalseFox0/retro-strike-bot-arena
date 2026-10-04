// Bot Arena highlights: while a match plays (in a background worker or on
// screen) a Recorder keeps the last moments of everyone's position, aim and
// gun, and every shot, kill, grenade, sound and effect. When something worth
// seeing happens (an ace, a clutch, a multi-kill, a knife kill, a last-second
// defuse, the end of a final or an upset) it cuts that stretch out as a clip.
// replay.js plays a clip back in the real game view.

import { WEAPONS } from './weapons.js';
import { expect } from './arena.js';

export const FPS = 20;                 // frames a second
export const STRIDE = 13;              // numbers per player per frame
export const WEAPON_IDS = Object.keys(WEAPONS);
const WEAPON_INDEX = new Map(WEAPON_IDS.map((id, i) => [id, i]));
export const NADE_IDS = ['hegrenade', 'flashbang', 'smokegrenade'];
// frame flags
export const F = { alive: 1, ground: 2, defusing: 4, pin: 8, bomb: 16, silenced: 32, reload: 64, corpse: 128, protect: 256, ducked: 512 };

const KEEP = 45;         // seconds kept back
const CHAIN_GAP = 6;     // kills this close together make a multi-kill
const ACE_TIME = 15;     // kill modes: five kills within this long is an ace
const PRE = 3.5, POST = 2; // seconds of clip before the first moment and after the last
const MAX_LEN = 32;
const MAX_CLIPS = 3;     // per match
// effects a clip keeps (the rest come from the players: muzzle flashes, shells, tracers)
export const FX = new Set(['impact', 'decal', 'glassHit', 'blood', 'explosion', 'bigExplosion', 'flashBurst', 'splash', 'sparks', 'puff', 'dust']);

// plain data that can travel between threads (vectors become [x, y, z])
const plain = (v) => {
  if (v == null || typeof v !== 'object') return v;
  if (typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number') return [v.x, v.y, v.z];
  return null;
};
const r1 = (x) => Math.round(x * 10) / 10;

export class Recorder {
  // game: a Game with an arena match just started; spec: what was played
  constructor(game, spec) {
    this.g = game;
    this.spec = spec;
    this.ps = game.players.filter((p) => p.char);
    this.idx = new Map(this.ps.map((p, i) => [p, i]));
    this.frames = [];   // { t, p: Float32Array, g: [], d: [] }
    this.events = [];   // { t, k, ... }
    this.acc = 1 / FPS; // a frame right at the start
    this.nadeSerial = 0;
    this.chains = new Map(); // player -> { first, last, kills: [{ t, v, hs, w }] }
    this.roundKills = new Map();
    this.roundStartT = 0;
    this.clutch = null;     // { p, vs, t }
    this.found = [];        // moments: { kind, star, n, score, a, b, extra }
    this.clips = [];
    this.min = spec.clipMin || 0;
    // the first round started before we came in
    if (game.roundBased()) this.roundStart();
    this.attach();
  }

  // watch the game's effects and sounds (whatever plays them, they're also written down)
  attach() {
    const g = this.g, rec = this;
    this.realFx = g.effects;
    this.realSound = g.soundSys;
    g.effects = new Proxy(this.realFx, {
      get(o, k) {
        const v = o[k];
        if (typeof v !== 'function' || !FX.has(k)) return typeof v === 'function' ? v.bind(o) : v;
        return (...args) => {
          rec.events.push({ t: g.time, k: 'fx', m: k, a: args.map((a) => (a && typeof a === 'object' ? plain(a) : a)) });
          return v.apply(o, args);
        };
      },
      set(o, k, v) { o[k] = v; return true; },
    });
    g.soundSys = new Proxy(this.realSound, {
      get(o, k) {
        const v = o[k];
        if (k !== 'play' || typeof v !== 'function') return typeof v === 'function' ? v.bind(o) : v;
        return (name, opts = {}) => {
          rec.events.push({
            t: g.time + (opts.delay || 0), k: 'snd', n: name,
            o: { volume: opts.volume, rate: opts.rate, reverb: opts.reverb, ref: opts.ref, pos: opts.pos ? [opts.pos.x, opts.pos.y, opts.pos.z] : null },
          });
          return v.call(o, name, opts);
        };
      },
    });
  }

  detach() {
    if (!this.realFx) return;
    this.g.effects = this.realFx;
    this.g.soundSys = this.realSound;
    this.realFx = this.realSound = null;
  }

  // ---------------------------------------------------------------- every tick
  tick(dt) {
    this.acc += dt;
    if (this.acc < 1 / FPS - 1e-6) return;
    this.acc -= 1 / FPS;
    const g = this.g, n = this.ps.length;
    const p = new Float32Array(n * STRIDE);
    this.ps.forEach((pl, i) => {
      const o = i * STRIDE, w = pl.weapon;
      p[o] = pl.pos.x; p[o + 1] = pl.pos.y; p[o + 2] = pl.pos.z;
      p[o + 3] = pl.yaw; p[o + 4] = pl.pitch;
      p[o + 5] = pl.duckAmount();
      p[o + 6] = (pl.alive ? F.alive : 0) | (pl.onGround ? F.ground : 0) | (pl.defusing ? F.defusing : 0) | (w && w.pin ? F.pin : 0) |
        (pl.weapons[5] ? F.bomb : 0) | (w && w.silenced ? F.silenced : 0) | (w && w.reloading ? F.reload : 0) | (pl.hasCorpse ? F.corpse : 0) |
        (pl.isProtected(g.time) ? F.protect : 0) | (pl.ducked ? F.ducked : 0);
      p[o + 7] = w ? WEAPON_INDEX.get(w.id) ?? -1 : -1;
      p[o + 8] = pl.health;
      p[o + 9] = pl.punchPitch; p[o + 10] = pl.punchYaw;
      p[o + 11] = w && w.zoom ? w.zoom : 0;
      p[o + 12] = pl.team === 'T' ? 0 : pl.team === 'CT' ? 1 : 2;
    });
    // grenades in the air (by a number of their own) and the doors
    const nades = [];
    for (const nd of g.grenades.list) {
      if (nd.done) continue;
      nd.rid ||= ++this.nadeSerial;
      nades.push(nd.rid, NADE_IDS.indexOf(nd.id), r1(nd.pos.x), r1(nd.pos.y), r1(nd.pos.z), nd.onGround ? 1 : 0);
    }
    const doors = g.map.doors.list.map((d) => r1(d.type === 'swing' ? d.angle * 100 : d.pos * 100));
    this.frames.push({ t: g.time, p, g: nades, d: doors, sc: [g.teamScore.T, g.teamScore.CT] });
    // forget what's too old (and what nothing needs any more)
    const cut = g.time - KEEP;
    while (this.frames.length && this.frames[0].t < cut) this.frames.shift();
    if (this.events.length > 4000 || (this.events.length && this.events[0].t < cut - 25)) {
      const keepFrom = cut - 25; // smoke and broken glass from a bit earlier set the scene
      this.events = this.events.filter((e) => e.t >= keepFrom || (e.t >= keepFrom - 20 && (e.k === 'smoke' || e.k === 'break' || e.k === 'c4' || e.k === 'c4off')));
    }
    // moments whose after-part has been recorded
    if (this.found.some((m) => m.b <= g.time)) this.cutDue();
  }

  // ---------------------------------------------------------------- what happens
  weapon(p, type, arg) {
    const i = this.idx.get(p);
    if (i != null) this.events.push({ t: this.g.time, k: 'we', p: i, ty: type, a: arg ?? null });
  }

  shot(p, end) {
    const i = this.idx.get(p);
    if (i != null) this.events.push({ t: this.g.time, k: 'shot', p: i, e: [r1(end.x), r1(end.y), r1(end.z)] });
  }

  blind(p, hold, fade, alpha) {
    const i = this.idx.get(p);
    if (i != null) this.events.push({ t: this.g.time, k: 'blind', p: i, h: hold, f: fade, al: alpha });
  }

  brk(box, dir) {
    const i = this.g.map.breakables.findIndex((pc) => pc.box === box);
    if (i >= 0) this.events.push({ t: this.g.time, k: 'break', b: i, d: plain(dir) });
  }

  smoke(pos) {
    this.events.push({ t: this.g.time, k: 'smoke', x: pos.x, y: pos.y, z: pos.z });
  }

  c4(pos, yaw) {
    this.events.push({ t: this.g.time, k: 'c4', x: pos.x, y: pos.y, z: pos.z, yaw });
  }

  // the bomb is gone: defused (with this long left on the timer) or blown up
  c4off(defuser = null, left = 0) {
    const g = this.g;
    this.events.push({ t: g.time, k: 'c4off' });
    if (defuser && left < 1 && this.idx.has(defuser)) {
      this.moment('defuse', defuser, 1, 65 + Math.round((1 - left) * 20), g.time - 9, g.time + POST, { left: Math.round(left * 100) / 100 });
    }
  }

  kill(victim, attacker, weaponId, headshot, dir) {
    const g = this.g;
    const vi = this.idx.get(victim), ai = attacker ? this.idx.get(attacker) : null;
    if (vi == null) return;
    this.events.push({ t: g.time, k: 'kill', a: ai ?? -1, v: vi, w: weaponId, hs: !!headshot, d: dir ? [dir.x, dir.z] : null });
    // a chain of kills ends when its killer dies
    this.closeChain(victim);
    if (ai == null || attacker === victim || !g.isEnemy(attacker, victim)) return;
    let c = this.chains.get(attacker);
    if (c && g.time - c.last > CHAIN_GAP) {
      this.closeChain(attacker);
      c = null;
    }
    if (!c) this.chains.set(attacker, (c = { first: g.time, last: g.time, kills: [] }));
    c.last = g.time;
    c.kills.push({ t: g.time, v: vi, hs: !!headshot, w: weaponId });
    if (g.roundBased()) this.roundKills.set(attacker, (this.roundKills.get(attacker) || 0) + 1);
    if (weaponId === 'knife') this.moment('knife', attacker, 1, 35, g.time - 5, g.time + POST);
    if (g.roundBased()) this.checkClutch();
  }

  // a kill chain is over: three or more kills make a moment
  closeChain(p) {
    const c = this.chains.get(p);
    if (!c) return;
    this.chains.delete(p);
    const n = c.kills.length;
    if (n < 3) return;
    const hs = c.kills.filter((k) => k.hs).length;
    // kill modes: five quick kills are an ace (rounds have their own)
    const ace = !this.g.roundBased() && n >= 5 && c.last - c.first <= ACE_TIME;
    const score = ace ? 80 + (n - 5) * 10 : n >= 4 ? 50 + (n - 4) * 10 : 30;
    this.moment(ace ? 'ace' : 'multi', p, n, score + hs * 3, c.first - PRE, c.last + POST);
  }

  // the last one standing against two or more
  checkClutch() {
    const g = this.g;
    if (this.clutch || g.round.state !== 'live') return;
    for (const team of ['T', 'CT']) {
      const mine = this.ps.filter((p) => p.alive && p.team === team);
      const theirs = this.ps.filter((p) => p.alive && p.team && p.team !== team);
      if (mine.length === 1 && theirs.length >= 2) {
        this.clutch = { p: mine[0], vs: theirs.length, t: g.time };
        return;
      }
    }
  }

  roundStart() {
    this.roundKills.clear();
    this.clutch = null;
    this.roundStartT = this.g.time;
    this.enemiesAtStart = new Map(this.ps.map((p) => [p, this.ps.filter((o) => o.team && p.team && o.team !== p.team).length]));
  }

  roundEnd(winner, reason) {
    const g = this.g;
    this.events.push({ t: g.time, k: 'round', w: winner, r: reason });
    for (const p of [...this.chains.keys()]) this.closeChain(p);
    // an ace: one player killed every enemy of the round
    for (const [p, n] of this.roundKills) {
      const need = this.enemiesAtStart?.get(p) || 0;
      if (need >= 3 && n >= need) {
        const ks = this.events.filter((e) => e.k === 'kill' && e.a === this.idx.get(p) && e.t >= this.roundStartT);
        this.moment('ace', p, n, 80 + (need - 3) * 10, (ks.length ? ks[0].t : g.time - 20) - PRE, g.time + POST);
      }
    }
    const c = this.clutch;
    if (c && winner && c.p.team === winner) this.moment('clutch', c.p, c.vs, 30 + c.vs * 20, c.t - 3, g.time + POST);
    this.clutch = null;
    this.roundKills.clear();
  }

  // the match is over: the end of a final, or an upset, then everything is cut
  finish(res) {
    const g = this.g, spec = this.spec;
    for (const p of [...this.chains.keys()]) this.closeChain(p);
    const end = g.time;
    const lastRound = () => {
      const r = [...this.events].reverse().find((e) => e.k === 'round' && e.t < end - 1);
      return Math.max(r ? r.t + 3 : end - 25, end - 25);
    };
    // the winners' chance before the match (from the ratings it was played with)
    let upset = false;
    const a = spec.cfg?.arena;
    if (a && res && res.winner != null && a.type !== 'ffa') {
      const avg = (s) => {
        const xs = a.players.filter((p) => p.side === s).map((p) => p.r || 1000);
        return xs.reduce((x, y) => x + y, 0) / Math.max(1, xs.length);
      };
      upset = expect(avg(res.winner), avg(1 - res.winner)) < 0.2;
    }
    const star = this.matchStar(res);
    if (star) {
      if (spec.comp?.final) this.moment('final', star, 1, 45, g.roundBased() ? lastRound() : end - 18, end + 0.5, { final: true });
      else if (upset) this.moment('upset', star, 1, 40, g.roundBased() ? lastRound() : end - 15, end + 0.5);
    }
    for (const m of this.found) m.b = Math.min(m.b, end + 0.5);
    this.cutDue(true);
    this.detach();
    // the best few, and only ones good enough to keep
    return this.clips.sort((x, y) => y.meta.score - x.meta.score).slice(0, MAX_CLIPS).filter((c) => c.meta.score >= this.min);
  }

  // who the match's last moments are about: the winners' top killer
  matchStar(res) {
    const by = (list) => list.sort((x, y) => y.kills - x.kills)[0];
    if (!res) return by([...this.ps]);
    if (res.order) return this.ps.find((p) => p.char.id === res.order[0]);
    if (res.winner == null) return by([...this.ps]);
    return by(this.ps.filter((p) => p.arenaSide === res.winner));
  }

  moment(kind, p, n, score, a, b, extra = {}) {
    if (this.spec.comp) score += 10;
    if (this.spec.comp?.final) score += 10;
    // the same stretch twice: the better one stays
    const i = this.idx.get(p);
    const same = this.found.find((m) => m.star === i && m.a < b && a < m.b);
    if (same) {
      if (same.score >= score) {
        same.a = Math.min(same.a, a);
        return;
      }
      this.found.splice(this.found.indexOf(same), 1);
      a = Math.min(a, same.a);
    }
    if (b - a > MAX_LEN) a = b - MAX_LEN;
    this.found.push({ kind, star: i, n, score, a, b, extra });
  }

  // cut the moments whose after-part is in (all of them at the end)
  cutDue(all = false) {
    const now = this.g.time;
    const due = this.found.filter((m) => all || m.b <= now);
    this.found = this.found.filter((m) => !due.includes(m));
    for (const m of due) {
      const clip = this.cut(m);
      if (clip) this.clips.push(clip);
    }
    // only the best few are kept as they come
    if (this.clips.length > MAX_CLIPS * 2) {
      this.clips.sort((x, y) => y.meta.score - x.meta.score);
      this.clips.length = MAX_CLIPS;
    }
  }

  cut(m) {
    const g = this.g;
    const frames = this.frames.filter((f) => f.t >= m.a - 1e-6 && f.t <= m.b + 1e-6);
    if (frames.length < FPS) return null;
    const t0 = frames[0].t, t1 = frames[frames.length - 1].t;
    const n = this.ps.length;
    const data = new Float32Array(frames.length * n * STRIDE);
    frames.forEach((f, i) => data.set(f.p, i * n * STRIDE));
    // what set the scene before the clip (smoke, broken glass, the bomb) and what happens in it
    const pre = this.events.filter((e) => e.t < t0 && (e.k === 'smoke' || e.k === 'break' || e.k === 'c4' || e.k === 'c4off') && e.t > t0 - 40);
    const evs = [...pre, ...this.events.filter((e) => e.t >= t0 && e.t <= t1 + 0.05)];
    const star = this.ps[m.star];
    const spec = this.spec;
    return {
      meta: {
        kind: m.kind, n: m.n, score: m.score, star: star.char.id, starName: star.char.name, map: spec.map, type: spec.type, mode: g.mode,
        comp: spec.comp ? spec.comp.kind : null, cn: spec.comp ? spec.comp.n : null, final: !!spec.comp?.final, stage: spec.comp?.stage || null,
        len: Math.round((t1 - t0) * 10) / 10, extra: m.extra,
      },
      clip: {
        v: 1, map: spec.map, mode: g.mode, type: spec.type, fps: FPS, t0, n: frames.length,
        players: this.ps.map((p) => ({ cid: p.char.id, name: p.name, color: p.char.color, side: p.arenaSide ?? null, look: p.look })),
        star: m.star, data, nades: frames.map((f) => f.g), doors: frames.map((f) => f.d), score: frames.map((f) => f.sc),
        events: evs, round: g.round ? g.round.n : 0, roundEndsAt: g.round ? g.round.endsAt : 0, matchEndsAt: isFinite(g.matchEndsAt) ? g.matchEndsAt : 0,
      },
    };
  }
}

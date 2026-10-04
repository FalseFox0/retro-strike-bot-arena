// Hosting an online match. The host's game is the real one: it runs every
// player, the friends' too, with the keys their games send (cmds). This
// sends each friend what they need to see the match on their side: a
// snapshot of everyone 33 times a second (netsync.js), and what happens in
// between (sounds, effects, kills, messages for their screen) as events,
// which netclient.js plays back. Friends can come into a running match and
// go back to the lobby; bots take the places nobody plays.

import { MSG, SNAP_TICKS, Out, readCmds, writeCommon, writeMe } from './netsync.js';
import { FX } from './highlights.js';
import { HACKS } from './hacks.js';
import { WEAPONS } from './weapons.js';
import { MAX_TEAM } from './online.js';

const STEADY = 2;         // more keys waiting than this: run extra ones to catch up
const MAX_RUN = 4;        // at most this many of a friend's ticks in one of ours
const MAX_UNLAG = 0.4;    // shots are aimed at most this far back in time
const BOARD_EVERY = 0.5;  // seconds between scoreboard updates
const HISTORY = 1;        // seconds of everyone's positions kept for aiming back

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const vec = (v) => [r2(v.x), r2(v.y), r2(v.z)];
const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// the match settings the friends' games need (and nothing else of the host's)
const MATCH_KEYS = ['map', 'mode', 'ggTeams', 'hacks', 'friendlyFire', 'roundsToWin', 'freezeTime', 'timeLimit', 'tdmLimit', 'ffaLimit',
  'roundTime', 'deadView', 'difficulty', 'fill', 'startMoney', 'autoBalance'];

export class NetHost {
  // game: just started with the online settings (cfg.online); session: the
  // lobby (online.js HostSession); chars: Bot Arena characters for the bots
  constructor(game, session, chars) {
    this.g = game;
    this.s = session;
    this.chars = chars || [];
    this.peers = new Map();   // pid -> { sp, player, cmds, nextSeq, ack, rt, events, started }
    this.shared = [];         // events for everyone since the last snapshot
    this.fresh = new Set();   // things put on the ground since the last snapshot
    this.n = 0;               // ticks
    this.seq = 0;             // snapshots
    this.boardAt = 0;
    this.sent = { state: '', bomb: '' };
    this.rosterDirty = false;
    this.filling = false;
    this.history = [];        // everyone's positions, tick by tick (aiming back)
    this.handlers = [
      ['message', (sp, msg) => this.message(sp, msg)],
      ['leave', (sp) => this.left(sp)],
    ];
    for (const [ev, fn] of this.handlers) session.on(ev, fn);
    this.wrapEffects();
  }

  // every effect worth seeing elsewhere (impacts, blood, explosions...) also goes out
  wrapEffects() {
    const g = this.g, net = this;
    this.realFx = g.effects;
    g.effects = new Proxy(this.realFx, {
      get(o, k) {
        const v = o[k];
        if (typeof v !== 'function') return v;
        if (!FX.has(k)) return v.bind(o);
        return (...args) => {
          net.push('fx', k, args.map((a) => (a && typeof a === 'object' && typeof a.x === 'number' ? vec(a) : a)));
          return v.apply(o, args);
        };
      },
      set(o, k, v) {
        o[k] = v;
        return true;
      },
    });
  }

  detach() {
    for (const [ev, fn] of this.handlers) this.s.off(ev, fn);
    if (this.realFx) this.g.effects = this.realFx;
    this.realFx = null;
    for (const peer of this.peers.values()) peer.sp.inMatch = false;
    this.peers.clear();
  }

  // ---------------------------------------------------------------- the match

  // The match starts: everyone in the lobby comes along, in the team they
  // picked (those who let it pick are spread out after), bots fill up.
  begin() {
    const g = this.g, s = this.s;
    g.botsCreated = true;
    g.human.name = s.me.name;
    s.state = 'match';
    for (const sp of s.friends()) this.enter(sp);
    const people = [[g.human, s.me], ...[...this.peers.values()].map((peer) => [peer.player, peer.sp])];
    const chosen = (sp) => sp.team === 'T' || sp.team === 'CT';
    for (const [p, sp] of people) if (chosen(sp)) this.place(p, sp.team);
    for (const [p, sp] of people) if (!chosen(sp)) this.place(p, sp.team);
    this.fillBots();
    for (const peer of this.peers.values()) this.sendStart(peer);
    s.changed();
    g.tellAll('center', 'gameCommencing', 2.5);
    for (const [p] of people) this.hints(p);
    if (g.roundBased()) g.startRound();
    g.flushHackNews(true);
  }

  // the keys to know, for someone just put in the game
  hints(p) {
    const g = this.g;
    if (p.spectator) return;
    g.tell(p, 'msg', g.ffa ? (g.gg ? 'hintKeysGgFfa' : 'hintKeysFfa') : g.gg ? 'hintKeysGg' : 'hintKeys', 10);
    if (g.bm) g.tell(p, 'msg', 'hintKeysBomb', 14);
  }

  // a friend comes into the match (at the start, or into a running one)
  enter(sp) {
    const g = this.g;
    const p = g.addRemote(sp.pid, sp.name);
    p.ping = sp.ping;
    const ok = (id, slot) => typeof id === 'string' && WEAPONS[id] && WEAPONS[id].slot === slot;
    if (sp.guns && ok(sp.guns.primary, 1) && ok(sp.guns.secondary, 2)) p.guns = { ...sp.guns };
    const peer = { sp, player: p, cmds: [], nextSeq: 0, ack: 0, rt: 0, events: [], started: false };
    this.peers.set(sp.pid, peer);
    sp.inMatch = true;
    return peer;
  }

  // into a team: the one picked ('T', 'CT'), or the one with fewer people
  // ('auto'); 'spec' watches. A team with five people takes nobody more.
  place(p, pick) {
    const g = this.g;
    if (pick === 'spec') {
      p.spectator = true;
      p.team = null;
      return;
    }
    p.spectator = false;
    if (g.ffa) {
      p.team = null;
      g.makeModel(p, Math.random() < 0.5 ? 'T' : 'CT');
      p.respawnAt = g.time + 0.1;
      return;
    }
    let team = pick === 'T' || pick === 'CT' ? pick : g.autoTeam(p);
    const people = (tm) => g.players.filter((o) => o !== p && !o.isBot && o.team === tm).length;
    if (people(team) >= MAX_TEAM) team = team === 'T' ? 'CT' : 'T';
    if (people(team) >= MAX_TEAM) {
      p.spectator = true;
      p.team = null;
      return;
    }
    p.team = team;
    g.makeModel(p, team);
    if (!g.roundBased()) p.respawnAt = g.time + 0.1;
  }

  // what a friend's game needs to show the match from now on
  sendStart(peer) {
    const g = this.g;
    const cfg = { online: true };
    for (const k of MATCH_KEYS) if (k in g.cfg) cfg[k] = g.cfg[k];
    const breaks = [];
    g.map.breakables.forEach((pc, i) => { if (pc.box.off) breaks.push(i); });
    peer.sp.link.send({
      t: 'start', cfg, you: peer.player.id, time: g.time,
      roster: this.roster(), state: this.state(), bomb: this.bomb(), board: this.board(),
      hacks: g.players.map((p) => [p.id, { ...p.hacks }]),
      items: g.items.list.map((it) => this.itemMsg(it)),
      breaks,
      smokes: g.grenades.clouds.map((c) => [vec(c.pos), c.start]),
    });
    peer.started = true;
  }

  // Bots take the places nobody plays: on each team (free-for-all: in all)
  // as many as the lobby's "players" setting, minus the people there. One
  // leaves when someone joins (a dead one if it can), one comes back when
  // someone goes.
  fillBots() {
    const g = this.g, fill = g.cfg.fill || 0;
    this.filling = true;
    let changed = false;
    for (const team of g.ffa ? [null] : ['T', 'CT']) {
      const on = g.players.filter((p) => !p.spectator && (g.ffa || p.team === team));
      const bots = on.filter((p) => p.isBot);
      const want = Math.max(0, fill - (on.length - bots.length));
      while (bots.length > want) {
        bots.sort((a, b) => (a.alive ? 1 : 0) - (b.alive ? 1 : 0) || a.score - b.score);
        g.removePlayer(bots.shift());
        changed = true;
      }
      while (bots.length < want) {
        bots.push(this.newBot(team));
        changed = true;
      }
    }
    this.filling = false;
    if (changed) this.rosterDirty = true;
  }

  newBot(team) {
    const g = this.g, cfg = g.cfg;
    // Bot Arena characters (when the lobby picked a save) before plain bots
    const used = new Set(g.players.filter((p) => p.char).map((p) => p.char.id));
    const ch = this.chars.find((c) => !used.has(c.id)) || null;
    const b = g.addBot(g.newId(), ch ? ch.name : g.botName(), team, ch);
    // hacker mode: as many hacking bots on each side as the lobby says
    if (cfg.hacks && !b.hacking) {
      const want = (g.ffa ? cfg.hackBots : team === 'T' ? cfg.hackBotsT : cfg.hackBotsCT) || 0;
      const have = g.players.filter((p) => p.isBot && p.hacking && p !== b && (g.ffa || p.team === team)).length;
      if (have < want) for (const k of HACKS) if (cfg.botHacks && cfg.botHacks[k]) g.setHack(b, k, true);
    }
    return b;
  }

  // the match is over: everyone's game shows the final scoreboard
  matchOver(title) {
    this.push('over', title);
    this.snapshot();
  }

  // back to the lobby, all together (the match is over, or the host ended it)
  backToLobby() {
    for (const peer of this.peers.values()) peer.sp.link.send({ t: 'tolobby' });
    for (const sp of this.s.players) sp.inMatch = false;
    this.s.state = 'lobby';
    this.s.changed();
  }

  // ---------------------------------------------------------------- the friends

  peerOf(p) {
    return p.remote != null ? this.peers.get(p.remote) : null;
  }

  message(sp, msg) {
    const g = this.g;
    const peer = this.peers.get(sp.pid);
    if (msg instanceof ArrayBuffer) {
      if (peer && new Uint8Array(msg)[0] === MSG.CMDS) this.takeCmds(peer, msg);
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'enter') {
      // from the lobby into the running match
      if (peer || !g.active || g.over) return;
      const pr = this.enter(sp);
      this.place(pr.player, sp.team);
      this.fillBots();
      this.rosterDirty = true;
      this.sendStart(pr);
      g.tellAll('msg', ['onlJoinedGame', { name: sp.name }], 5);
      this.hints(pr.player);
      this.s.changed();
      return;
    }
    if (!peer) return;
    const p = peer.player;
    switch (msg.t) {
      case 'leave':
        // back to the lobby (still connected)
        this.drop(peer);
        g.tellAll('msg', ['onlLeftGame', { name: sp.name }], 5);
        this.s.changed();
        break;
      case 'jointeam':
        this.joinTeam(p, msg.team);
        break;
      case 'guns': {
        const ok = (id, slot) => typeof id === 'string' && WEAPONS[id] && WEAPONS[id].slot === slot;
        if (!ok(msg.primary, 1) || !ok(msg.secondary, 2)) break;
        p.guns = { primary: msg.primary, secondary: msg.secondary };
        if (typeof msg.life === 'number') g.applyGunChoice(msg.life, p, p.guns);
        break;
      }
      case 'buy':
        if (g.bm && p.alive && typeof msg.id === 'string') g.bm.buy(p, msg.id);
        break;
      case 'autobuy': case 'rebuy':
        if (g.bm && p.alive) g.bm[msg.t](p);
        break;
      case 'radio':
        if (typeof msg.key === 'string') g.radio.order(p, msg.key);
        break;
      case 'hack':
        if (HACKS.includes(msg.key)) g.setHack(p, msg.key, !!msg.on);
        break;
      case 'hackcfg':
        g.setHackCfg(p, msg.cfg);
        break;
      case 'hacknews':
        g.flushHackNews(true);
        break;
      default:
    }
  }

  // the team menu (M), the host's or a friend's: five people a team at most
  joinTeam(p, team) {
    const g = this.g;
    if (!['T', 'CT', 'AUTO', 'SPEC'].includes(team) || g.over) return;
    if ((team === 'T' || team === 'CT') && team !== p.team && g.players.filter((o) => o !== p && !o.isBot && o.team === team).length >= MAX_TEAM) {
      g.tell(p, 'msg', 'onlTeamFullMsg', 4);
      return;
    }
    g.chooseTeam(g.ffa && team !== 'SPEC' ? 'AUTO' : team, p);
  }

  // a friend's connection is gone (or they went back to the lobby)
  left(sp) {
    const peer = this.peers.get(sp.pid);
    if (!peer) return;
    this.drop(peer);
    this.g.tellAll('msg', ['onlLeftGame', { name: sp.name }], 5);
  }

  drop(peer) {
    this.peers.delete(peer.sp.pid);
    peer.sp.inMatch = false;
    this.g.removePlayer(peer.player);
    this.fillBots();
    this.rosterDirty = true;
  }

  // a friend's keys: in order of their number, each one run once
  takeCmds(peer, buf) {
    let data;
    try {
      data = readCmds(buf);
    } catch {
      return;
    }
    if (Number.isFinite(data.rt)) peer.rt = data.rt;
    for (const c of data.cmds) {
      if (c.seq < peer.nextSeq || peer.cmds.some((x) => x.seq === c.seq)) continue;
      let i = peer.cmds.length;
      while (i > 0 && peer.cmds[i - 1].seq > c.seq) i--;
      peer.cmds.splice(i, 0, c);
    }
  }

  // A friend's keys to run this tick (game.js), each one tick of theirs, in
  // order. Their game moved them with exactly these (prediction), so none
  // are made up here: if none came yet, they wait for them.
  cmdsFor(p) {
    const peer = this.peerOf(p);
    if (!peer || !peer.cmds.length) return [];
    const n = Math.min(MAX_RUN, peer.cmds.length > STEADY ? peer.cmds.length - STEADY + 1 : 1);
    const out = peer.cmds.splice(0, n);
    const last = out[out.length - 1];
    peer.nextSeq = last.seq + 1;
    peer.ack = last.seq;
    for (const c of out) c.yaw = wrap(c.yaw);
    return out;
  }

  // keys of a friend who isn't playing right now (dead, watching) are used up
  drain(peer) {
    const last = peer.cmds[peer.cmds.length - 1];
    if (!last) return;
    peer.nextSeq = last.seq + 1;
    peer.ack = last.seq;
    peer.cmds = [];
  }

  // Lag compensation: a friend's shot is checked against where everyone was
  // on their screen when they fired (their game shows the others a moment
  // in the past), then everyone goes back.
  lagComp(p, cmd, fn) {
    const peer = this.peerOf(p);
    const g = this.g, h = this.history;
    if (!peer || !(cmd.attack || cmd.attack2) || h.length < 2) {
      fn();
      return;
    }
    const t = Math.max(g.time - MAX_UNLAG, Math.min(g.time, peer.rt));
    let i = h.length - 1;
    while (i > 0 && h[i - 1].t >= t) i--;
    const b = h[i], a = h[Math.max(0, i - 1)];
    const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 1;
    const moved = [];
    for (const o of g.players) {
      if (o === p || !o.alive) continue;
      const sa = a.ps.get(o), sb = b.ps.get(o);
      if (!sa || !sb) continue;
      moved.push([o, o.pos.x, o.pos.y, o.pos.z, o.yaw, o.ducked, o.inDuck, o.duckTimer]);
      // (a respawn in between: no sliding across the map)
      const jump = Math.hypot(sb[0] - sa[0], sb[2] - sa[2]) > 120;
      const s = jump || k > 0.5 ? sb : sa;
      if (jump) o.pos.set(sb[0], sb[1], sb[2]);
      else o.pos.set(sa[0] + (sb[0] - sa[0]) * k, sa[1] + (sb[1] - sa[1]) * k, sa[2] + (sb[2] - sa[2]) * k);
      o.yaw = jump ? sb[3] : sa[3] + wrap(sb[3] - sa[3]) * k;
      o.ducked = s[4];
      o.inDuck = s[5];
      o.duckTimer = s[6];
    }
    try {
      fn();
    } finally {
      for (const [o, x, y, z, yaw, ducked, inDuck, duckTimer] of moved) {
        o.pos.set(x, y, z);
        o.yaw = yaw;
        o.ducked = ducked;
        o.inDuck = inDuck;
        o.duckTimer = duckTimer;
      }
    }
  }

  remember() {
    const g = this.g;
    const ps = new Map();
    for (const o of g.players) if (o.alive) ps.set(o, [o.pos.x, o.pos.y, o.pos.z, o.yaw, o.ducked, o.inDuck, o.duckTimer]);
    this.history.push({ t: g.time, ps });
    while (this.history.length && this.history[0].t < g.time - HISTORY) this.history.shift();
  }

  // ---------------------------------------------------------------- every tick

  tick() {
    const g = this.g;
    this.n++;
    for (const peer of this.peers.values()) if (!peer.player.alive) this.drain(peer);
    this.remember();
    if (this.rosterDirty) {
      this.rosterDirty = false;
      this.fillBots();
      this.rosterDirty = false;
      this.push('roster', this.roster());
    }
    if (g.time >= this.boardAt) {
      this.boardAt = g.time + BOARD_EVERY;
      for (const peer of this.peers.values()) peer.player.ping = peer.sp.ping;
      this.push('board', this.board());
    }
    if (this.n % SNAP_TICKS === 0) this.snapshot();
  }

  snapshot() {
    const g = this.g;
    this.seq++;
    // what was put on the ground (as it is now: placed, turned)
    for (const it of this.fresh) if (g.items.list.includes(it)) this.push('item+', this.itemMsg(it));
    this.fresh.clear();
    // the round, the score, the bomb: when they change
    const st = this.state(), bs = this.bomb();
    const sj = JSON.stringify(st), bj = JSON.stringify(bs);
    if (sj !== this.sent.state) {
      this.sent.state = sj;
      this.push('state', st);
    }
    if (bj !== this.sent.bomb) {
      this.sent.bomb = bj;
      this.push('bomb', bs);
    }
    // things on the ground that move (and a second after: they settle flat)
    const moving = g.items.list.filter((it) => {
      if (!it.onGround || it.vel.x || it.vel.z) it.movedAt = g.time;
      return g.time - (it.movedAt ?? -9) < 1;
    });
    const common = new Out(2048);
    writeCommon(common, g, moving);
    const bytes = new Uint8Array(common.buf, 0, common.i);
    for (const peer of this.peers.values()) {
      if (!peer.started) continue;
      const o = new Out(bytes.length + 160);
      o.u8(MSG.SNAP);
      o.u32(this.seq);
      o.f64(g.time);
      o.u32(peer.ack);
      o.u8(1);
      writeMe(o, peer.player);
      o.bytes(bytes);
      peer.sp.link.send(o.done(), true);
      const evs = peer.events.length ? [...this.shared, ...peer.events] : this.shared;
      if (evs.length) peer.sp.link.send({ t: 'ev', e: evs });
      peer.events = [];
    }
    this.shared = [];
  }

  // ---------------------------------------------------------------- what's sent

  roster() {
    const g = this.g;
    return g.players.map((p) => [p.id, p.name, p.team, p.look, p.isBot ? 1 : 0, p === g.human ? 0 : p.remote ?? -1, p.char ? p.char.color : null, p.spectator ? 1 : 0]);
  }

  board() {
    return this.g.players.map((p) => [p.id, p.kills, p.deaths, p.score, p.hackKills, Math.round(p.ping || 0), p.ggLevel ?? 0, p.ggKills ?? 0, p.money || 0]);
  }

  state() {
    const g = this.g, r = g.round;
    return {
      n: r.n, st: r.state, until: r3(r.until), ends: r3(r.endsAt), score: [g.teamScore.T, g.teamScore.CT],
      end: Number.isFinite(g.matchEndsAt) ? g.matchEndsAt : 0, buy: g.bm ? g.bm.roundStartTime : 0, planted: !!(g.bm && g.bm.planted),
    };
  }

  bomb() {
    const b = this.g.bm && this.g.bm.bomb;
    if (!b) return null;
    return {
      st: b.state, c: b.carrier ? b.carrier.id : -1, item: b.item ? b.item.nid : 0, pos: b.pos ? vec(b.pos) : null,
      yaw: b.mesh ? r2(b.mesh.rotation.y) : 0, d: b.defuser ? b.defuser.id : -1, ds: r3(b.defuseStart || 0), de: r3(b.defuseEnd || 0),
    };
  }

  itemMsg(it) {
    const r = it.mesh.rotation;
    return [it.nid, it.kind, it.id, it.w && it.w.silenced ? 1 : 0, vec(it.pos), [r3(r.x), r3(r.y), r3(r.z)], it.onGround ? 1 : 0];
  }

  // an event for everyone in the match / for one friend's game
  push(kind, ...a) {
    if (this.peers.size) this.shared.push([r3(this.g.time), kind, ...a]);
  }

  pushTo(p, kind, ...a) {
    const peer = this.peerOf(p);
    if (peer && peer.started) peer.events.push([r3(this.g.time), kind, ...a]);
  }

  // ---------------------------------------------------------------- game.js tells us

  tell(p, kind, args) { this.pushTo(p, 'tell', kind, args); }
  tellAll(kind, args) { this.push('all', kind, args); }
  sound(name, p, volume, delay, ref, own) { if (p) this.push('ps', p.id, name, r2(volume), r3(delay), ref, r2(own)); }
  weaponSound(p, name, silenced) { this.push('gs', p.id, name, silenced ? 1 : 0); }
  soundAt(name, pos, volume, ref, reverb) { this.push('as', name, vec(pos), r2(volume), ref, reverb); }
  globalSound(name, opts) { this.push('ns', name, opts); }
  weaponEvent(p, type, arg) { this.push('we', p.id, type, arg ?? null); }
  shot(p, end) { this.push('shot', p.id, vec(end)); }
  blind(p, hold, fade, alpha) { this.push('blind', p.id, r2(hold), r2(fade), r2(alpha)); }
  shake(pos, radius) { this.push('shake', vec(pos), radius); }
  smoke(pos) { this.push('smoke', vec(pos)); }
  flinch(p, dir, head) { this.push('flinch', p.id, vec(dir), head ? 1 : 0); }
  radio(p, key) { this.push('radio', p.id, key); }
  hacksChanged(p) { this.push('hacks', p.id, { ...p.hacks }); }
  newRound() { this.push('round0'); }
  rosterChanged() { if (!this.filling) this.rosterDirty = true; }

  kill(victim, attacker, weaponId, headshot, dir, hack) {
    this.push('kill', victim.id, attacker ? attacker.id : -1, weaponId, headshot ? 1 : 0, hack ? 1 : 0, dir ? [r2(dir.x), r2(dir.z)] : null);
  }

  brk(box, dir) {
    const i = this.g.map.breakables.findIndex((pc) => pc.box === box);
    if (i >= 0) this.push('brk', i, dir ? vec(dir) : null);
  }

  itemAdded(it) { this.fresh.add(it); }

  itemRemoved(it) {
    if (this.fresh.delete(it)) return;
    this.push('item-', it.nid);
  }

  itemsCleared() {
    this.fresh.clear();
    this.push('items0');
  }
}

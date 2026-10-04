// Online play: the host's session and a friend's session (net.js carries the
// messages). The host keeps the lobby (who's in, their teams, the match
// settings) and sends it to everyone whenever it changes; friends only ask
// (their name, the team they want).
//
// Messages on the reliable channel ('rel'):
//   friend -> host  { t: 'hello', name, v }   { t: 'team', team }   { t: 'guns', ... }
//   host -> friend  { t: 'welcome', pid }      { t: 'lobby', players, cfg, state }
//                   { t: 'refuse', why }       { t: 'bye', why }
// During a match: the match itself (nethost.js / netclient.js), and
//   friend -> host  { t: 'enter' } into the running match, { t: 'leave' } back to the lobby
//   host -> friend  { t: 'start', ... } the match as it is, { t: 'tolobby' } everyone back

import { Link, newInviteId, decodeCode } from './net.js';

// bumped whenever the messages change: host and friend must run the same game
export const NET_VERSION = 1;
export const MAX_PLAYERS = 10;     // host included
export const MAX_TEAM = 5;         // humans on one team
const PING_EVERY = 2000;
export const TEAMS = ['auto', 'T', 'CT', 'spec'];

const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);

// the address of this page with an invite inside (the part after # never
// leaves the browser, so the code isn't sent to the website)
export function inviteUrl(code) {
  return location.origin + location.pathname + '#join=' + code;
}

// an invite code from a pasted link, or the code itself
export function codeFrom(text) {
  const s = String(text || '').trim();
  const m = s.match(/#join=([A-Za-z0-9_-]+)/);
  return m ? m[1] : s.replace(/\s+/g, '');
}

class Emitter {
  constructor() { this.handlers = {}; }
  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; }
  off(ev, fn) { this.handlers[ev] = (this.handlers[ev] || []).filter((f) => f !== fn); return this; }
  emit(ev, ...a) { for (const fn of this.handlers[ev] || []) fn(...a); }
}

// ---------------------------------------------------------------- host

export class HostSession extends Emitter {
  // cfg: the match settings shown in the lobby (the host edits them)
  constructor(name, cfg) {
    super();
    this.role = 'host';
    this.state = 'lobby';            // 'lobby' | 'match'
    this.cfg = cfg;
    this.nextPid = 1;
    // pid 0 is the host
    this.players = [{ pid: 0, name: cleanName(name) || 'Host', team: 'auto', ping: 0, link: null }];
    this.invites = new Map();        // invite id -> Link waiting for its reply
    this.pinger = setInterval(() => this.pingAll(), PING_EVERY);
    this.closed = false;
  }

  get me() { return this.players[0]; }
  friends() { return this.players.filter((p) => p.link); }

  // a new invite: { id, code, url }
  async invite() {
    if (this.players.length + this.invites.size >= MAX_PLAYERS) throw new Error('full');
    let id = newInviteId();
    while (this.invites.has(id)) id = newInviteId();
    const link = new Link();
    this.invites.set(id, link);
    const code = await link.invite(id);
    return { id, code, url: inviteUrl(code) };
  }

  cancelInvite(id) {
    const link = this.invites.get(id);
    if (!link) return;
    this.invites.delete(id);
    link.close('cancelled');
  }

  // the friend's reply code arrived: connect them. Throws 'code' / 'other'
  // (a reply to an invite we don't have) / 'full'
  async accept(code) {
    const clean = code.trim().replace(/\s+/g, '');
    // the code says which invite it answers
    const { id } = decodeCode(clean, 'reply');
    const link = this.invites.get(id);
    if (!link) throw new Error('other');
    if (this.players.length >= MAX_PLAYERS) throw new Error('full');
    await link.accept(clean);
    this.invites.delete(id);
    this.attach(link);
  }

  attach(link) {
    let player = null;
    const timeout = setTimeout(() => { if (!player) link.close('timeout'); }, 30000);
    link.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (!player) {
        if (msg.t !== 'hello') return;
        clearTimeout(timeout);
        if (msg.v !== NET_VERSION) {
          link.send({ t: 'refuse', why: 'version' });
          setTimeout(() => link.close('version'), 500);
          return;
        }
        if (this.players.length >= MAX_PLAYERS) {
          link.send({ t: 'refuse', why: 'full' });
          setTimeout(() => link.close('full'), 500);
          return;
        }
        player = { pid: this.nextPid++, name: this.uniqueName(cleanName(msg.name) || 'Player'), team: 'auto', ping: 0, link };
        this.players.push(player);
        link.send({ t: 'welcome', pid: player.pid });
        this.emit('join', player);
        this.changed();
        return;
      }
      this.message(player, msg);
    });
    link.on('open', () => link.ping());
    link.on('close', (why) => {
      clearTimeout(timeout);
      if (!player) return;
      this.players = this.players.filter((p) => p !== player);
      this.emit('leave', player, why);
      this.changed();
    });
  }

  uniqueName(name) {
    const taken = new Set(this.players.map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) if (!taken.has(`${name} (${n})`.toLowerCase())) return `${name} (${n})`;
  }

  message(player, msg) {
    switch (msg.t) {
      case 'team':
        if (this.canJoin(player, msg.team)) {
          player.team = msg.team;
          this.changed();
        }
        break;
      case 'guns':
        // the guns they like (the match gives them these until they pick in the menu)
        if (typeof msg.primary === 'string' && typeof msg.secondary === 'string') player.guns = { primary: msg.primary, secondary: msg.secondary };
        this.emit('message', player, msg);
        break;
      default:
        this.emit('message', player, msg);
    }
  }

  // a full team can't take more humans
  canJoin(player, team) {
    if (!TEAMS.includes(team)) return false;
    if (team !== 'T' && team !== 'CT') return true;
    return this.players.filter((p) => p !== player && p.team === team).length < MAX_TEAM;
  }

  setTeam(team) {
    if (this.canJoin(this.me, team)) {
      this.me.team = team;
      this.changed();
    }
  }

  setName(name) {
    this.me.name = cleanName(name) || this.me.name;
    this.changed();
  }

  // the lobby as everyone sees it
  view() {
    return {
      players: this.players.map((p) => ({ pid: p.pid, name: p.name, team: p.team, ping: Math.round(p.ping), inMatch: p.pid === 0 ? this.state === 'match' : !!p.inMatch })),
      cfg: this.cfg,
      state: this.state,
    };
  }

  changed() {
    if (this.closed) return;
    const v = this.view();
    for (const p of this.friends()) p.link.send({ t: 'lobby', ...v });
    this.emit('lobby', v);
  }

  broadcast(msg, fast = false) {
    for (const p of this.friends()) p.link.send(msg, fast);
  }

  pingAll() {
    let moved = false;
    for (const p of this.friends()) {
      p.link.ping();
      if (Math.abs(p.link.rtt - p.ping) >= 5) { p.ping = p.link.rtt; moved = true; }
    }
    if (moved) this.changed();
  }

  close(why = 'host') {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pinger);
    for (const p of this.friends()) p.link.send({ t: 'bye', why });
    // a moment for the goodbye to leave before the connections close
    const links = [...this.friends().map((p) => p.link), ...this.invites.values()];
    setTimeout(() => { for (const l of links) l.close('host'); }, 200);
    this.invites.clear();
  }
}

// ---------------------------------------------------------------- friend

export class ClientSession extends Emitter {
  constructor(name) {
    super();
    this.role = 'client';
    this.name = cleanName(name) || 'Player';
    this.link = new Link();
    this.pid = -1;
    this.lobby = null;
    this.closed = false;
    this.link.on('open', () => {
      this.link.send({ t: 'hello', name: this.name, v: NET_VERSION });
      this.emit('open');
    });
    this.link.on('message', (msg) => this.message(msg));
    this.link.on('close', (why) => this.end(this.why || why));
    this.pinger = setInterval(() => this.link.ping(), PING_EVERY);
  }

  // the invite from the link: returns the reply code to send to the host
  async answer(code) {
    return this.link.answer(code);
  }

  message(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome':
        this.pid = msg.pid;
        this.emit('welcome', msg.pid);
        break;
      case 'lobby':
        this.lobby = { players: msg.players, cfg: msg.cfg, state: msg.state };
        this.emit('lobby', this.lobby);
        break;
      case 'refuse':
      case 'bye':
        this.why = msg.why === 'host' ? 'hostLeft' : msg.why;
        break;
      default:
        this.emit('message', msg);
    }
  }

  get me() {
    return this.lobby?.players.find((p) => p.pid === this.pid) || null;
  }

  setTeam(team) {
    this.link.send({ t: 'team', team });
  }

  send(msg, fast = false) {
    return this.link.send(msg, fast);
  }

  end(why) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pinger);
    this.emit('end', why);
  }

  close() {
    this.why = 'left';
    this.link.close('left');
    this.end('left');
  }
}

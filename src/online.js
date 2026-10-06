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

import { Link, newInviteId, readInvite, replyId } from './net.js';

// bumped whenever the messages change: host and friend must run the same game
export const NET_VERSION = 1;
export const MAX_PLAYERS = 10;     // host included
export const MAX_TEAM = 5;         // humans on one team
const PING_EVERY = 2000;
const CONNECT_MS = 30000;          // host: how long a friend has to connect once their reply is in
const PATIENCE_MS = 5 * 60000;     // friend: how long to wait for the host to add the reply
const OPEN_INVITES = 20;           // host: invites waiting for a reply at most
export const TEAMS = ['auto', 'T', 'CT', 'spec'];

const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);

// the address of this page with an invite (or a reply) inside: the part
// after # never leaves the browser, so the code isn't sent to the website
export function inviteUrl(code) {
  return location.origin + location.pathname + '#join=' + code;
}
export function replyUrl(code) {
  return location.origin + location.pathname + '#reply=' + code;
}

// a code from a pasted link, or the code itself
export function codeFrom(text) {
  const s = String(text || '').trim();
  const m = s.match(/#(?:join|reply)=([A-Za-z0-9_-]+)/);
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
  // relay: { server, user, pass } from Options (the invites pass it on)
  constructor(name, cfg, relay = null) {
    super();
    this.role = 'host';
    this.state = 'lobby';            // 'lobby' | 'match'
    this.cfg = cfg;
    this.relay = relay;
    this.nextPid = 1;
    // pid 0 is the host
    this.players = [{ pid: 0, name: cleanName(name) || 'Host', team: 'auto', ping: 0, link: null }];
    this.invites = new Map();        // invite id -> Link waiting for its reply
    this.taken = new Map();          // invite id -> the reply it got (a reply link clicked twice)
    this.pinger = setInterval(() => this.pingAll(), PING_EVERY);
    this.closed = false;
  }

  get me() { return this.players[0]; }
  friends() { return this.players.filter((p) => p.link); }

  // a new invite: { id, code, url }. Invites nobody answered don't take a
  // place (the lobby fills when people come in); past OPEN_INVITES the
  // oldest one stops working.
  async invite() {
    if (this.players.length >= MAX_PLAYERS) throw new Error('full');
    while (this.invites.size >= OPEN_INVITES) this.cancelInvite(this.invites.keys().next().value);
    let id = newInviteId();
    while (this.invites.has(id)) id = newInviteId();
    const link = new Link(this.relay);
    this.invites.set(id, link);
    const code = await link.invite(id);
    return { id, code, url: inviteUrl(code), relay: !!link.relay };
  }

  cancelInvite(id) {
    const link = this.invites.get(id);
    if (!link) return;
    this.invites.delete(id);
    link.close('cancelled');
  }

  // the friend's reply code arrived: connect them. Throws 'code' / 'version'
  // / 'other' (a reply to an invite we don't have) / 'full' / 'again' (this
  // very reply is in already)
  async accept(code) {
    const clean = code.trim().replace(/\s+/g, '');
    // the code says which invite it answers
    const id = replyId(clean);
    if (this.taken.get(id) === clean) throw new Error('again');
    const link = this.invites.get(id);
    if (!link) throw new Error('other');
    if (this.players.length >= MAX_PLAYERS) throw new Error('full');
    this.taken.set(id, clean);
    try {
      await link.accept(clean);
    } catch (e) {
      this.taken.delete(id);
      throw e;
    }
    this.invites.delete(link.id);
    this.attach(link);
  }

  // a friend who doesn't get through (or never says hello) is dropped; the
  // host hears about it ('failed', relay: whether the relay was tried too)
  attach(link) {
    let player = null;
    const timeout = setTimeout(() => { if (!player) link.close(link.state === 'open' ? 'timeout' : 'failed'); }, CONNECT_MS);
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
      if (!player) {
        if (!this.closed && why === 'failed') this.emit('failed', !!link.relay);
        return;
      }
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
    this.link = null;       // made from the invite (it may bring the host's relay)
    this.pid = -1;
    this.lobby = null;
    this.closed = false;
    this.waitTimer = 0;
    this.waitingSince = 0;   // when our reply was ready
    this.pinger = setInterval(() => this.link?.ping(), PING_EVERY);
  }

  // the invite from the link: returns the reply code to send to the host.
  // Throws 'code' / 'version' (an invite from another version of the game)
  async answer(code) {
    const inv = readInvite(code);
    const link = this.link = new Link(inv.relay);
    link.on('open', () => {
      clearTimeout(this.waitTimer);
      link.send({ t: 'hello', name: this.name, v: NET_VERSION });
      this.emit('open');
    });
    link.on('message', (msg) => this.message(msg));
    link.on('close', (why) => {
      // before the first connection only the wait ends it ('expired'); a
      // 'failed' later is a connection that broke
      if (why === 'expired' && link.relay) why = 'expiredRelay';
      else if (why === 'failed') why = 'closed';
      this.end(this.why || why);
    });
    const reply = await link.answer(inv);
    // the host has a few minutes to add the reply
    this.waitTimer = setTimeout(() => link.close('expired'), PATIENCE_MS);
    this.waitingSince = performance.now();
    return reply;
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
    this.link?.send({ t: 'team', team });
  }

  send(msg, fast = false) {
    return this.link ? this.link.send(msg, fast) : false;
  }

  end(why) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pinger);
    clearTimeout(this.waitTimer);
    this.emit('end', why);
  }

  close() {
    this.why = 'left';
    this.link?.close('left');
    this.end('left');
  }
}

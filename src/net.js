// Online play with no server of our own: the browsers talk straight to each
// other over WebRTC (built into every browser). Setting a connection up takes
// two messages carried by hand: the host's invite (inside an invite link) and
// the friend's reply (a short reply link back). The public STUN servers below
// only tell each browser its own internet address. Where a network blocks
// direct connections (universities, mobile data), a relay (TURN server) the
// host sets up in Options passes the data along. Game data is encrypted
// either way: a relay can't read it.
//
// The host is in the middle: one Link per friend. Each Link has two channels,
// 'rel' (reliable, in order: chat, lobby, buying) and 'fast' (unreliable:
// positions and keys, where only the newest message matters).

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
const GATHER_MS = 3000;  // longest wait for the browser to find its addresses
const KNOCK_MS = 5000;   // how often a friend waiting for the host knocks again
const VERSION = 2;
const KIND = { invite: 0, reply: 1 };
const CAND = { host: 0, srflx: 1, prflx: 2, relay: 3 };
const CAND_NAMES = ['host', 'srflx', 'prflx', 'relay'];
// address kinds inside a code ('same': the address the other side sent for
// that kind of candidate, e.g. the relay's)
const ADDR = { v4: 0, v6: 1, mdns: 2, same: 3 };
const ALGS = ['sha-1', 'sha-256', 'sha-384', 'sha-512'];
const FP_LEN = [20, 32, 48, 64];
// flags next to the fingerprint kind (bits 0-1)
const F_CREDS = 4;   // reply: the friend's ICE name and password follow
const F_RELAY = 8;   // invite: the host's relay follows

// ---------------------------------------------------------------- codes

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function unb64url(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

class Writer {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 255); }
  u16(v) { this.a.push((v >> 8) & 255, v & 255); }
  bytes(b) { for (const x of b) this.u8(x); }
  str(s) {
    const b = new TextEncoder().encode(s);
    if (b.length > 255) throw new Error('long');
    this.u8(b.length);
    this.bytes(b);
  }
}
class Reader {
  constructor(b) { this.b = b; this.i = 0; }
  u8() { if (this.i >= this.b.length) throw new Error('short'); return this.b[this.i++]; }
  u16() { return (this.u8() << 8) | this.u8(); }
  bytes(n) { const o = []; for (let k = 0; k < n; k++) o.push(this.u8()); return o; }
  str() { return new TextDecoder().decode(new Uint8Array(this.bytes(this.u8()))); }
  left() { return this.b.length - this.i; }
}

// what a description needs to travel: ICE name and password, the DTLS
// fingerprint and the addresses (UDP only)
function parseSdp(sdp) {
  const get = (re) => (sdp.match(re) || [])[1];
  const ufrag = get(/a=ice-ufrag:(\S+)/), pwd = get(/a=ice-pwd:(\S+)/);
  const fp = sdp.match(/a=fingerprint:(\S+) ([0-9A-Fa-f:]+)/);
  if (!ufrag || !pwd || !fp) throw new Error('bad description');
  const cands = [];
  for (const m of sdp.matchAll(/a=candidate:\S+ \d+ (\S+) \d+ (\S+) (\d+) typ (\S+)/g)) {
    if (m[1].toLowerCase() !== 'udp' || !(m[4] in CAND)) continue;
    if (!cands.some((c) => c.addr === m[2] && c.port === +m[3])) cands.push({ addr: m[2], port: +m[3], type: m[4] });
  }
  return { ufrag, pwd, alg: fp[1].toLowerCase(), fp: fp[2].split(':').map((x) => parseInt(x, 16)), cands };
}

// -> { kind, bytes } (null: an address we can't write)
function addrBytes(addr) {
  const v4 = addr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) return { kind: ADDR.v4, bytes: v4.slice(1).map(Number) };
  const mdns = addr.match(/^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i);
  if (mdns) {
    const hex = mdns.slice(1).join('');
    return { kind: ADDR.mdns, bytes: Array.from({ length: 16 }, (_, k) => parseInt(hex.slice(k * 2, k * 2 + 2), 16)) };
  }
  if (addr.includes(':')) {
    // IPv6: expand '::' and write 8 groups
    const [head, tail] = addr.split('::');
    const hs = head ? head.split(':') : [], ts = tail != null && tail ? tail.split(':') : [];
    const groups = tail != null ? [...hs, ...Array(8 - hs.length - ts.length).fill('0'), ...ts] : hs;
    if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
    return { kind: ADDR.v6, bytes: groups.flatMap((g) => { const v = parseInt(g, 16); return [v >> 8, v & 255]; }) };
  }
  return null;
}

// same: the address the other side already has for this kind of candidate
function writeCand(w, c, same) {
  if (same && c.addr === same) {
    w.u8((CAND[c.type] << 4) | ADDR.same);
  } else {
    const a = addrBytes(c.addr);
    if (!a) return;
    w.u8((CAND[c.type] << 4) | a.kind);
    w.bytes(a.bytes);
  }
  w.u16(c.port);
}

// sameOf(type): the address a 'same' stands for
function readCand(r, sameOf) {
  const b = r.u8(), type = CAND_NAMES[b >> 4], kind = b & 15;
  let addr;
  if (kind === ADDR.v4) addr = r.bytes(4).join('.');
  else if (kind === ADDR.mdns) {
    const hex = r.bytes(16).map((x) => x.toString(16).padStart(2, '0')).join('');
    addr = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.local`;
  } else if (kind === ADDR.v6) {
    const g = [];
    for (let k = 0; k < 8; k++) g.push(r.u16().toString(16));
    addr = g.join(':');
  } else if (kind === ADDR.same) addr = sameOf(type);
  if (!type || !addr) throw new Error('code');
  return { type, addr, port: r.u16() };
}

const firstOf = (cands, type) => cands.find((c) => c.type === type)?.addr;
const isV6 = (addr) => addr.includes(':');

// the host's addresses worth sending (a few of each kind: the first ones are
// the browser's best)
function pickHost(cands) {
  const out = [];
  for (const [type, n] of [['host', 2], ['srflx', 2], ['relay', 3]]) out.push(...cands.filter((c) => c.type === type).slice(0, n));
  return out;
}

// the friend's addresses the host can use: relayed and outside ones, and the
// home-network ones only when we're on the host's network (same outside
// address, or no outside address to tell)
function pickFriend(cands, theirs) {
  const mine = cands.filter((c) => c.type === 'srflx');
  const their = theirs.filter((c) => c.type === 'srflx');
  const theirV6 = theirs.some((c) => c.type !== 'host' && isV6(c.addr));
  const out = cands.filter((c) => c.type === 'relay').slice(0, 3);
  out.push(...mine.filter((c) => !isV6(c.addr) || theirV6).slice(0, 2));
  if (!mine.length || !their.length || mine.some((m) => their.some((t) => t.addr === m.addr))) out.push(...cands.filter((c) => c.type === 'host').slice(0, 2));
  return out;
}

function candLine(c, k, foundation = k + 1) {
  const pref = c.type === 'host' ? 126 : c.type === 'prflx' ? 110 : c.type === 'srflx' ? 100 : 0;
  const prio = pref * 16777216 + (65535 - k) * 256 + 255;
  return `candidate:${foundation} 1 udp ${prio} ${c.addr} ${c.port} typ ${c.type}` + (c.type === 'host' ? '' : ' raddr 0.0.0.0 rport 0') + ' generation 0';
}

// a description for the other browser, rebuilt from a code
function buildSdp({ ufrag, pwd, alg, fp, cands }, setup) {
  return [
    'v=0',
    `o=- ${Date.now()} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:${alg} ${fp.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(':')}`,
    `a=setup:${setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    ...cands.map((c, k) => 'a=' + candLine(c, k)),
    'a=end-of-candidates',
    '',
  ].join('\r\n');
}

const sameBytes = (a, b) => a.length === b.length && a.every((x, k) => x === b[k]);

// the shortest fingerprint the other browser accepts: the SHA-1 of our
// certificate (20 bytes; Chrome lets a page read the certificate) instead of
// the usual SHA-256 (32). -> { alg (index in ALGS), fp }
async function shortFp(pc, d) {
  try {
    for (const s of (await pc.getStats()).values()) {
      if (s.type !== 'certificate' || !s.base64Certificate || d.alg !== 'sha-256') continue;
      const der = Uint8Array.from(atob(s.base64Certificate), (c) => c.charCodeAt(0));
      // (only ours: the one our description names)
      if (!sameBytes([...new Uint8Array(await crypto.subtle.digest('SHA-256', der))], d.fp)) continue;
      return { alg: 0, fp: [...new Uint8Array(await crypto.subtle.digest('SHA-1', der))] };
    }
  } catch { /* the long one below */ }
  const alg = ALGS.indexOf(d.alg);
  if (alg < 0) throw new Error('fingerprint ' + d.alg);
  return { alg, fp: d.fp };
}

// The friend's ICE name and password follow from the host's, so the reply
// doesn't carry them (null: this browser can't work them out)
async function friendCreds(hostPwd) {
  try {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('retro-strike:' + hostPwd)));
    const s = btoa(String.fromCharCode(...h));   // letters, digits, + and /: all fine for ICE
    return { ufrag: s.slice(0, 8), pwd: s.slice(8, 32) };
  } catch {
    return null;
  }
}

function openCode(code, kind) {
  let r;
  try {
    r = new Reader(unb64url(String(code).trim().replace(/\s+/g, '')));
  } catch {
    throw new Error('code');
  }
  const head = r.left() ? r.u8() : -1;
  if (head >> 4 !== VERSION) throw new Error(head < 0 ? 'code' : 'version');
  if ((head & 15) !== KIND[kind]) throw new Error('kind');
  return r;
}

// a code's own errors are 'version', 'kind' and 'code' (anything broken)
function guard(fn) {
  try {
    return fn();
  } catch (e) {
    throw new Error(e.message === 'kind' || e.message === 'version' ? e.message : 'code');
  }
}

// the host's invite -> { id, ufrag, pwd, alg, fp, cands, relay }
export function readInvite(code) {
  return guard(() => {
    const r = openCode(code, 'invite');
    const id = r.u16(), flags = r.u8();
    const ufrag = r.str(), pwd = r.str();
    const alg = flags & 3, fp = r.bytes(FP_LEN[alg]);
    const n = r.u8(), cands = [];
    for (let k = 0; k < n; k++) cands.push(readCand(r, () => null));
    const relay = flags & F_RELAY ? { server: r.str(), user: r.str(), pass: r.str() } : null;
    return { id, ufrag, pwd, alg: ALGS[alg], fp, cands, relay };
  });
}

// which invite a reply answers
export function replyId(code) {
  return guard(() => openCode(code, 'reply').u16());
}

// ---------------------------------------------------------------- relay

// a relay's address as typed (relay.example.com:3478, turn:…, turns:…) ->
// the ICE servers for it (none until all three fields are filled in)
export function relayServers(relay) {
  if (!relay || !relay.server || !relay.user || !relay.pass) return [];
  let s = String(relay.server).trim();
  const tls = /^turns:/i.test(s);
  s = s.replace(/^turns?:\/*/i, '').replace(/[?/].*$/, '');
  if (!s) return [];
  if (!/:\d+$/.test(s)) s += tls ? ':443' : ':3478';
  const urls = tls ? ['turns:' + s + '?transport=tcp'] : ['turn:' + s + '?transport=udp', 'turn:' + s + '?transport=tcp'];
  return [{ urls, username: String(relay.user), credential: String(relay.pass) }];
}

// ask the relay for an address -> { ok, ms } or { error: 'empty' | 'address' | 'login' | 'noanswer' }
export async function testRelay(relay) {
  const servers = relayServers(relay);
  if (!servers.length) return { error: 'empty' };
  let pc;
  try {
    pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: 'relay' });
  } catch {
    return { error: 'address' };
  }
  pc.createDataChannel('test');
  const t0 = performance.now();
  let login = false, timer = 0;
  const result = new Promise((res) => {
    const done = (r) => { clearTimeout(timer); pc.close(); res(r); };
    timer = setTimeout(() => done({ error: login ? 'login' : 'noanswer' }), 8000);
    pc.onicecandidate = (e) => {
      if (e.candidate && / typ relay /.test(e.candidate.candidate)) done({ ok: true, ms: Math.round(performance.now() - t0) });
    };
    pc.onicecandidateerror = (e) => { if (e.errorCode === 401 || e.errorCode === 403 || e.errorCode === 441) login = true; };
    pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') done({ error: login ? 'login' : 'noanswer' }); };
  });
  await pc.setLocalDescription(await pc.createOffer());
  return result;
}

// ---------------------------------------------------------------- links

// wait until the browser has found its addresses (or give up waiting)
function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((res) => {
    const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); res(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const timer = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

// One connection between two players. relay: the host's relay, if any.
// Events (on): open, message (data, fast), close (reason)
export class Link {
  constructor(relay = null) {
    const servers = relayServers(relay);
    try {
      this.pc = new RTCPeerConnection({ iceServers: [...STUN, ...servers] });
      this.relay = servers.length ? relay : null;
    } catch {
      // a relay address the browser can't use: go without
      this.pc = new RTCPeerConnection({ iceServers: STUN });
      this.relay = null;
    }
    // both channels agreed on in advance (same ids on both sides): nothing
    // more has to be exchanged to open them
    this.rel = this.pc.createDataChannel('rel', { negotiated: true, id: 0, ordered: true });
    this.fast = this.pc.createDataChannel('fast', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    this.id = 0;
    this.handlers = {};
    this.state = 'new';   // new -> waiting -> open -> closed
    this.rtt = 0;
    this.knocker = 0;
    let opened = 0;
    for (const ch of [this.rel, this.fast]) {
      ch.binaryType = 'arraybuffer';
      ch.onopen = () => {
        if (++opened === 2 && this.state !== 'closed') {
          this.state = 'open';
          clearInterval(this.knocker);
          this.emit('open');
        }
      };
      ch.onmessage = (e) => this.receive(e.data, ch === this.fast);
      ch.onclose = () => this.close('closed');
    }
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      // Before the first connection a 'failed' only means the other side
      // hasn't answered yet (the host may still be adding the reply): the
      // browser picks up again when they do, so keep waiting (the sessions
      // decide how long)
      if (s === 'failed' && this.state === 'open') this.close('failed');
      else if (s === 'closed') this.close('closed');
    };
  }

  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; }
  emit(ev, ...a) { for (const fn of this.handlers[ev] || []) fn(...a); }

  // host: make an invite code for one friend
  async invite(id) {
    this.id = id;
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await gathered(this.pc);
    const d = parseSdp(this.pc.localDescription.sdp);
    const f = await shortFp(this.pc, d);
    // (only what the code can carry: a reply's 'same' points into this list)
    this.sent = pickHost(d.cands).filter((c) => addrBytes(c.addr));
    this.peer = await friendCreds(d.pwd);
    const w = new Writer();
    w.u8((VERSION << 4) | KIND.invite);
    w.u16(id);
    w.u8(f.alg | (this.relay ? F_RELAY : 0));
    w.str(d.ufrag);
    w.str(d.pwd);
    w.bytes(f.fp);
    const at = w.a.length;
    w.u8(0);
    let n = 0;
    for (const c of this.sent) {
      const before = w.a.length;
      writeCand(w, c);
      if (w.a.length > before) n++;
    }
    w.a[at] = n;
    if (this.relay) {
      w.str(String(this.relay.server).trim());
      w.str(String(this.relay.user));
      w.str(String(this.relay.pass));
    }
    this.state = 'waiting';
    return b64url(w.a);
  }

  // friend: answer an invite (readInvite's result); returns the reply code
  async answer(inv) {
    this.id = inv.id;
    this.theirs = inv.cands;
    await this.pc.setRemoteDescription({ type: 'offer', sdp: buildSdp(inv, 'actpass') });
    const answer = await this.pc.createAnswer();
    // our ICE name and password as the host works them out (where the browser
    // lets us set them; otherwise they go in the reply)
    const want = await friendCreds(inv.pwd);
    let set = false;
    if (want) {
      try {
        await this.pc.setLocalDescription({ type: 'answer', sdp: answer.sdp.replace(/a=ice-ufrag:\S+/g, 'a=ice-ufrag:' + want.ufrag).replace(/a=ice-pwd:\S+/g, 'a=ice-pwd:' + want.pwd) });
        set = true;
      } catch { /* the browser's own then */ }
    }
    if (!set) await this.pc.setLocalDescription(answer);
    await gathered(this.pc);
    const d = parseSdp(this.pc.localDescription.sdp);
    const creds = !want || d.ufrag !== want.ufrag || d.pwd !== want.pwd;
    const f = await shortFp(this.pc, d);
    const w = new Writer();
    w.u8((VERSION << 4) | KIND.reply);
    w.u16(inv.id);
    w.u8(f.alg | (creds ? F_CREDS : 0));
    w.bytes(f.fp);
    if (creds) {
      w.str(d.ufrag);
      w.str(d.pwd);
    }
    for (const c of pickFriend(d.cands, inv.cands)) writeCand(w, c, firstOf(inv.cands, c.type));
    this.state = 'waiting';
    this.knock();
    return b64url(w.a);
  }

  // Friend, until the host adds the reply: knock on the host's addresses
  // again and again. The browser gives up on them after 15 s, and a router
  // soon forgets a door nobody uses; this keeps ours open for the host's
  // first packets. (The same address under a new name is a new try.)
  knock() {
    let n = 0;
    this.knocker = setInterval(() => {
      const ice = this.pc.iceConnectionState;
      if (this.state !== 'waiting' || ice === 'connected' || ice === 'completed') {
        if (this.state !== 'waiting') clearInterval(this.knocker);
        return;
      }
      n++;
      this.theirs.forEach((c, k) => {
        if (c.type === 'host') return;   // (a home-network address has no router door)
        this.pc.addIceCandidate({ candidate: candLine(c, k, 100 * n + k), sdpMid: '0' }).catch(() => {});
      });
    }, KNOCK_MS);
  }

  // host: the friend's reply code arrived
  async accept(code) {
    const reply = guard(() => {
      const r = openCode(code, 'reply');
      const id = r.u16(), flags = r.u8();
      const alg = flags & 3, fp = r.bytes(FP_LEN[alg]);
      let creds = this.peer;
      if (flags & F_CREDS) creds = { ufrag: r.str(), pwd: r.str() };
      if (!creds) throw new Error('code');
      const cands = [];
      while (r.left()) cands.push(readCand(r, (type) => firstOf(this.sent, type)));
      return { id, ufrag: creds.ufrag, pwd: creds.pwd, alg: ALGS[alg], fp, cands };
    });
    if (reply.id !== this.id) throw new Error('other');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: buildSdp(reply, 'active') });
  }

  send(msg, fast = false) {
    const ch = fast ? this.fast : this.rel;
    if (ch.readyState !== 'open') return false;
    try {
      ch.send(typeof msg === 'string' || msg instanceof ArrayBuffer || ArrayBuffer.isView(msg) ? msg : JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  receive(data, fast) {
    if (typeof data === 'string') {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      // round trip time: answered here, measured where it was asked
      if (msg && msg.t === '_ping') { this.send({ t: '_pong', at: msg.at }); return; }
      if (msg && msg.t === '_pong') { this.rtt = performance.now() - msg.at; return; }
      this.emit('message', msg, fast);
    } else this.emit('message', data, fast);
  }

  ping() { this.send({ t: '_ping', at: performance.now() }); }

  close(reason = 'closed') {
    if (this.state === 'closed') return;
    this.state = 'closed';
    clearInterval(this.knocker);
    try { this.rel.close(); this.fast.close(); this.pc.close(); } catch { /* already gone */ }
    this.emit('close', reason);
  }
}

// a random invite number
export const newInviteId = () => (Math.random() * 65536) | 0;

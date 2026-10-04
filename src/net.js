// Online play with no server of our own: the browsers talk straight to each
// other over WebRTC (built into every browser). Setting a connection up takes
// two messages carried by hand: the host's invite (inside an invite link) and
// the friend's reply code. The public STUN servers below only tell each
// browser its own internet address; game data goes nowhere but between the
// players, encrypted.
//
// The host is in the middle: one Link per friend. Each Link has two channels,
// 'rel' (reliable, in order: chat, lobby, buying) and 'fast' (unreliable:
// positions and keys, where only the newest message matters).

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
const GATHER_MS = 3000;  // longest wait for the browser to find its addresses
const VERSION = 1;
const KIND = { invite: 0, reply: 1 };
const CAND = { host: 0, srflx: 1, prflx: 2, relay: 3 };
const CAND_NAMES = ['host', 'srflx', 'prflx', 'relay'];
// address kinds inside a code
const ADDR = { v4: 0, v6: 1, mdns: 2 };

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
  str(s) { this.u8(s.length); for (const c of s) this.u8(c.charCodeAt(0)); }
  bytes(b) { for (const x of b) this.u8(x); }
}
class Reader {
  constructor(b) { this.b = b; this.i = 0; }
  u8() { if (this.i >= this.b.length) throw new Error('short'); return this.b[this.i++]; }
  u16() { return (this.u8() << 8) | this.u8(); }
  str() { const n = this.u8(); let s = ''; for (let k = 0; k < n; k++) s += String.fromCharCode(this.u8()); return s; }
  bytes(n) { const o = []; for (let k = 0; k < n; k++) o.push(this.u8()); return o; }
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
    cands.push({ addr: m[2], port: +m[3], type: m[4] });
  }
  return { ufrag, pwd, alg: fp[1].toLowerCase(), fp: fp[2].split(':').map((x) => parseInt(x, 16)), cands };
}

function writeAddr(w, addr) {
  const v4 = addr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) { w.u8(ADDR.v4); for (let k = 1; k <= 4; k++) w.u8(+v4[k]); return true; }
  const mdns = addr.match(/^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i);
  if (mdns) {
    w.u8(ADDR.mdns);
    const hex = mdns.slice(1).join('');
    for (let k = 0; k < 32; k += 2) w.u8(parseInt(hex.slice(k, k + 2), 16));
    return true;
  }
  if (addr.includes(':')) {
    // IPv6: expand '::' and write 8 groups
    const [head, tail] = addr.split('::');
    const hs = head ? head.split(':') : [], ts = tail != null && tail ? tail.split(':') : [];
    const groups = tail != null ? [...hs, ...Array(8 - hs.length - ts.length).fill('0'), ...ts] : hs;
    if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return false;
    w.u8(ADDR.v6);
    for (const g of groups) w.u16(parseInt(g, 16));
    return true;
  }
  return false;
}

function readAddr(r) {
  const kind = r.u8();
  if (kind === ADDR.v4) return r.bytes(4).join('.');
  if (kind === ADDR.mdns) {
    const hex = r.bytes(16).map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.local`;
  }
  if (kind === ADDR.v6) {
    const g = [];
    for (let k = 0; k < 8; k++) g.push(r.u16().toString(16));
    return g.join(':');
  }
  throw new Error('bad address');
}

const ALGS = ['sha-256', 'sha-384', 'sha-512'];

// kind: 'invite' or 'reply'; id: which invite this belongs to (0-65535)
export function encodeCode(kind, id, sdp) {
  const d = parseSdp(sdp);
  const w = new Writer();
  w.u8(VERSION);
  w.u8(KIND[kind]);
  w.u16(id);
  w.str(d.ufrag);
  w.str(d.pwd);
  const alg = ALGS.indexOf(d.alg);
  if (alg < 0) throw new Error('fingerprint ' + d.alg);
  w.u8(alg);
  w.bytes(d.fp);
  // a few of each type is plenty: the first ones are the browser's best
  const keep = [];
  for (const type of ['host', 'srflx', 'prflx', 'relay']) keep.push(...d.cands.filter((c) => c.type === type).slice(0, 4));
  const at = w.a.length;
  w.u8(0);
  let n = 0;
  for (const c of keep) {
    const save = w.a.length;
    w.u8(CAND[c.type]);
    if (!writeAddr(w, c.addr)) { w.a.length = save; continue; }
    w.u16(c.port);
    n++;
  }
  w.a[at] = n;
  return b64url(w.a);
}

// -> { kind, id, sdp } with sdp rebuilt for the other side to use
export function decodeCode(code, wantKind) {
  let r;
  try {
    r = new Reader(unb64url(code.trim().replace(/\s+/g, '')));
  } catch {
    throw new Error('code');
  }
  try {
    if (r.u8() !== VERSION) throw new Error('version');
    const kind = r.u8() === KIND.reply ? 'reply' : 'invite';
    if (wantKind && kind !== wantKind) throw new Error('kind');
    const id = r.u16();
    const ufrag = r.str(), pwd = r.str();
    const alg = ALGS[r.u8()];
    if (!alg) throw new Error('code');
    const fpLen = alg === 'sha-256' ? 32 : alg === 'sha-384' ? 48 : 64;
    const fp = r.bytes(fpLen).map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(':');
    const n = r.u8();
    const lines = [];
    for (let k = 0; k < n; k++) {
      const type = CAND_NAMES[r.u8()];
      const addr = readAddr(r);
      const port = r.u16();
      const pref = type === 'host' ? 126 : type === 'prflx' ? 110 : type === 'srflx' ? 100 : 0;
      const prio = pref * 16777216 + (65535 - k) * 256 + 255;
      lines.push(`a=candidate:${k + 1} 1 udp ${prio} ${addr} ${port} typ ${type}` + (type === 'host' ? '' : ' raddr 0.0.0.0 rport 0') + ' generation 0');
    }
    const sdp = [
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
      `a=fingerprint:${alg} ${fp}`,
      `a=setup:${kind === 'invite' ? 'actpass' : 'active'}`,
      'a=mid:0',
      'a=sctp-port:5000',
      'a=max-message-size:262144',
      ...lines,
      'a=end-of-candidates',
      '',
    ].join('\r\n');
    return { kind, id, sdp };
  } catch (e) {
    throw new Error(e.message === 'kind' || e.message === 'version' ? e.message : 'code');
  }
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

// One connection between two players.
// Events (on): open, message (data, fast), close (reason)
export class Link {
  constructor() {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    // both channels agreed on in advance (same ids on both sides): nothing
    // more has to be exchanged to open them
    this.rel = this.pc.createDataChannel('rel', { negotiated: true, id: 0, ordered: true });
    this.fast = this.pc.createDataChannel('fast', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    this.id = 0;
    this.handlers = {};
    this.state = 'new';   // new -> waiting -> open -> closed
    this.rtt = 0;
    let opened = 0;
    for (const ch of [this.rel, this.fast]) {
      ch.binaryType = 'arraybuffer';
      ch.onopen = () => {
        if (++opened === 2 && this.state !== 'closed') {
          this.state = 'open';
          this.emit('open');
        }
      };
      ch.onmessage = (e) => this.receive(e.data, ch === this.fast);
      ch.onclose = () => this.close('closed');
    }
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed') this.close('failed');
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
    this.state = 'waiting';
    return encodeCode('invite', id, this.pc.localDescription.sdp);
  }

  // friend: answer an invite; returns the reply code to send back
  async answer(code) {
    const offer = decodeCode(code, 'invite');
    this.id = offer.id;
    await this.pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await gathered(this.pc);
    this.state = 'waiting';
    return encodeCode('reply', offer.id, this.pc.localDescription.sdp);
  }

  // host: the friend's reply code arrived
  async accept(code) {
    const reply = decodeCode(code, 'reply');
    if (reply.id !== this.id) throw new Error('other');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: reply.sdp });
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
    try { this.rel.close(); this.fast.close(); this.pc.close(); } catch { /* already gone */ }
    this.emit('close', reason);
  }
}

// a random invite number
export const newInviteId = () => (Math.random() * 65536) | 0;

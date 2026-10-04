// What the host's game and the friends' games send each other many times a
// second during an online match, packed into bytes: the friends' keys and
// view (cmds), and the host's snapshots of everyone. The rest (sounds,
// effects, kills, messages) travels as JSON events: nethost.js sends,
// netclient.js plays them back.

import { WEAPONS } from './weapons.js';

export const SNAP_TICKS = 3;      // a snapshot every 3 ticks: 33 a second
export const MSG = { SNAP: 1, CMDS: 2 };
export const WEAPON_IDS = Object.keys(WEAPONS);
export const WEAPON_INDEX = new Map(WEAPON_IDS.map((id, i) => [id, i]));
export const NADE_IDS = ['hegrenade', 'flashbang', 'smokegrenade'];
export const NONE = 255;

// a player's flags in a snapshot
export const PF = {
  alive: 1, ground: 2, defusing: 4, pin: 8, bomb: 16, silenced: 32, reload: 64, corpse: 128,
  protect: 256, ducked: 512, thrown: 1024, arming: 2048, burst: 4096,
};
// keys held in a cmd
const KEY = {
  fwd: 1, back: 2, right: 4, left: 8, jump: 16, duck: 32, walk: 64, attack: 128,
  attack2: 256, reload: 512, use: 1024, drop: 2048, cycle: 4096,
};

// ---------------------------------------------------------------- bytes

export class Out {
  constructor(size = 1024) {
    this.buf = new ArrayBuffer(size);
    this.v = new DataView(this.buf);
    this.i = 0;
  }

  room(n) {
    if (this.i + n <= this.buf.byteLength) return;
    const bigger = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.i + n));
    new Uint8Array(bigger).set(new Uint8Array(this.buf, 0, this.i));
    this.buf = bigger;
    this.v = new DataView(bigger);
  }

  u8(x) { this.room(1); this.v.setUint8(this.i, x); this.i += 1; }
  u16(x) { this.room(2); this.v.setUint16(this.i, x, true); this.i += 2; }
  i16(x) { this.room(2); this.v.setInt16(this.i, Math.max(-32768, Math.min(32767, Math.round(x))), true); this.i += 2; }
  u32(x) { this.room(4); this.v.setUint32(this.i, x, true); this.i += 4; }
  f32(x) { this.room(4); this.v.setFloat32(this.i, x, true); this.i += 4; }
  f64(x) { this.room(8); this.v.setFloat64(this.i, x, true); this.i += 8; }

  bytes(b) {
    this.room(b.length);
    new Uint8Array(this.buf, this.i, b.length).set(b);
    this.i += b.length;
  }

  done() {
    return this.buf.slice(0, this.i);
  }
}

export class In {
  constructor(buf) {
    this.v = new DataView(buf);
    this.i = 0;
  }

  u8() { const x = this.v.getUint8(this.i); this.i += 1; return x; }
  u16() { const x = this.v.getUint16(this.i, true); this.i += 2; return x; }
  i16() { const x = this.v.getInt16(this.i, true); this.i += 2; return x; }
  u32() { const x = this.v.getUint32(this.i, true); this.i += 4; return x; }
  f32() { const x = this.v.getFloat32(this.i, true); this.i += 4; return x; }
  f64() { const x = this.v.getFloat64(this.i, true); this.i += 8; return x; }
}

// angles as two bytes
const TAU = Math.PI * 2;
const packYaw = (a) => Math.round(((((a + Math.PI) % TAU) + TAU) % TAU) / TAU * 65535);
const unpackYaw = (v) => (v / 65535) * TAU - Math.PI;

// ---------------------------------------------------------------- cmds (friend -> host)

// rt: when the friend's screen shows the others (the host aims their shots
// at that moment); cmds: [{ seq, forward, side, jump, ..., slot, yaw, pitch }]
export function writeCmds(rt, cmds) {
  const o = new Out(16 + cmds.length * 15);
  o.u8(MSG.CMDS);
  o.f64(rt);
  o.u8(cmds.length);
  for (const c of cmds) {
    o.u32(c.seq);
    o.u16((c.forward > 0 ? KEY.fwd : 0) | (c.forward < 0 ? KEY.back : 0) | (c.side > 0 ? KEY.right : 0) | (c.side < 0 ? KEY.left : 0) |
      (c.jump ? KEY.jump : 0) | (c.duck ? KEY.duck : 0) | (c.walk ? KEY.walk : 0) | (c.attack ? KEY.attack : 0) |
      (c.attack2 ? KEY.attack2 : 0) | (c.reload ? KEY.reload : 0) | (c.use ? KEY.use : 0) | (c.drop ? KEY.drop : 0) | (c.cycleNade ? KEY.cycle : 0));
    o.u8(c.slot || 0);
    o.f32(c.yaw);
    o.f32(c.pitch);
  }
  return o.done();
}

export function readCmds(buf) {
  const r = new In(buf);
  r.u8();
  const rt = r.f64();
  const n = r.u8();
  const cmds = [];
  for (let k = 0; k < n; k++) {
    const seq = r.u32(), b = r.u16(), slot = r.u8(), yaw = r.f32(), pitch = r.f32();
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) continue;
    cmds.push({
      seq, rt, slot: slot <= 5 ? slot : 0, yaw, pitch: Math.max(-1.56, Math.min(1.56, pitch)),
      forward: (b & KEY.fwd ? 1 : 0) - (b & KEY.back ? 1 : 0), side: (b & KEY.right ? 1 : 0) - (b & KEY.left ? 1 : 0),
      jump: !!(b & KEY.jump), duck: !!(b & KEY.duck), walk: !!(b & KEY.walk), attack: !!(b & KEY.attack),
      attack2: !!(b & KEY.attack2), reload: !!(b & KEY.reload), use: !!(b & KEY.use), drop: !!(b & KEY.drop), cycleNade: !!(b & KEY.cycle),
    });
  }
  return { rt, cmds };
}

// ---------------------------------------------------------------- snapshots (host -> friend)
//
// [header] seq, time, ack (the friend's last cmd the host has run)
// [me]     the friend's own player in full: movement (to carry on from it
//          on their side), armor, money, every gun and grenade
// [common] everyone (position, view, gun, health...), grenades in the air,
//          doors, and the things on the ground that move

// the part everyone gets
export function writeCommon(o, g, movingItems) {
  const ps = g.players;
  o.u8(ps.length);
  for (const p of ps) {
    const w = p.weapon;
    const nade = w && w.def.type === 'grenade';
    o.u8(p.id);
    o.u16((p.alive ? PF.alive : 0) | (p.onGround ? PF.ground : 0) | (p.defusing ? PF.defusing : 0) | (w && w.pin ? PF.pin : 0) |
      (p.weapons[5] ? PF.bomb : 0) | (w && w.silenced ? PF.silenced : 0) | (w && w.reloading ? PF.reload : 0) | (p.hasCorpse ? PF.corpse : 0) |
      (p.isProtected(g.time) ? PF.protect : 0) | (p.ducked ? PF.ducked : 0) | (w && w.redeployAt ? PF.thrown : 0) | (w && w.arming ? PF.arming : 0) |
      (w && w.burst ? PF.burst : 0));
    o.f32(p.pos.x); o.f32(p.pos.y); o.f32(p.pos.z);
    o.i16(p.vel.x); o.i16(p.vel.y); o.i16(p.vel.z);
    o.u16(packYaw(p.yaw));
    o.i16(p.pitch * 10000);
    o.u8(Math.round(p.duckAmount() * 255));
    o.u8(w ? WEAPON_INDEX.get(w.id) ?? NONE : NONE);
    o.u8(w ? w.zoom || 0 : 0);
    o.u8(Math.max(0, Math.min(255, Math.ceil(p.health))));
    o.i16(p.punchPitch * 100);
    o.i16(p.punchYaw * 100);
    o.u8(Math.min(255, w ? (nade ? p.nades[w.id] || 0 : w.clip) : 0));
    o.u16(Math.min(65535, w && !nade ? w.reserve : 0));
  }
  const nades = g.grenades.list.filter((n) => !n.done && !n.puppet);
  o.u8(Math.min(255, nades.length));
  for (const n of nades.slice(0, 255)) {
    n.rid ||= ++g.grenades.serial;
    o.u16(n.rid & 65535);
    o.u8(NADE_IDS.indexOf(n.id));
    o.f32(n.pos.x); o.f32(n.pos.y); o.f32(n.pos.z);
    o.u8(n.onGround ? 1 : 0);
  }
  const doors = g.map.doors.list;
  o.u8(doors.length);
  for (const d of doors) {
    o.i16((d.type === 'swing' ? d.angle : d.pos) * 10000);
    o.u8(d.type === 'swing' ? d.solidState + 1 : 0);
  }
  o.u8(Math.min(255, movingItems.length));
  for (const it of movingItems.slice(0, 255)) {
    const r = it.mesh.rotation;
    o.u16(it.nid & 65535);
    o.f32(it.pos.x); o.f32(it.pos.y); o.f32(it.pos.z);
    o.i16(r.x * 5000); o.i16(r.y * 5000); o.i16(r.z * 5000);
    o.u8(it.onGround ? 1 : 0);
  }
}

// one friend's own player
export function writeMe(o, p) {
  o.f32(p.pos.x); o.f32(p.pos.y); o.f32(p.pos.z);
  o.f32(p.vel.x); o.f32(p.vel.y); o.f32(p.vel.z);
  o.u8((p.onGround ? 1 : 0) | (p.ducked ? 2 : 0) | (p.inDuck ? 4 : 0) | (p.oldJump ? 8 : 0));
  o.f32(p.duckTimer); o.f32(p.fuser2); o.f32(p.fallVelocity); o.f32(p.ladderCooldown); o.f32(p.velMod); o.f32(p.maxspeed);
  o.u8(Math.max(0, Math.min(255, Math.round(p.armor))));
  o.u8((p.helmet ? 1 : 0) | (p.defuser ? 2 : 0));
  o.u16(Math.max(0, Math.min(65535, p.money || 0)));
  o.u8(p.slot);
  o.u8(p.lastSlot || 0);
  for (let s = 1; s <= 5; s++) {
    const w = p.weapons[s];
    o.u8(w ? WEAPON_INDEX.get(w.id) ?? NONE : NONE);
    o.u8(w ? Math.min(255, w.clip) : 0);
    o.u16(w ? Math.min(65535, w.reserve) : 0);
    o.u8(w ? (w.silenced ? 1 : 0) | (w.burst ? 2 : 0) : 0);
  }
  o.u8(p.nades.hegrenade || 0);
  o.u8(p.nades.flashbang || 0);
  o.u8(p.nades.smokegrenade || 0);
}

export function readSnap(buf) {
  const r = new In(buf);
  r.u8();
  const s = { seq: r.u32(), time: r.f64(), ack: r.u32(), me: null, players: [], nades: [], doors: [], items: [] };
  if (r.u8()) {
    const m = s.me = {};
    m.x = r.f32(); m.y = r.f32(); m.z = r.f32();
    m.vx = r.f32(); m.vy = r.f32(); m.vz = r.f32();
    const mf = r.u8();
    m.onGround = !!(mf & 1); m.ducked = !!(mf & 2); m.inDuck = !!(mf & 4); m.oldJump = !!(mf & 8);
    m.duckTimer = r.f32(); m.fuser2 = r.f32(); m.fallVelocity = r.f32(); m.ladderCooldown = r.f32(); m.velMod = r.f32(); m.maxspeed = r.f32();
    m.armor = r.u8();
    const f = r.u8();
    m.helmet = !!(f & 1); m.defuser = !!(f & 2);
    m.money = r.u16();
    m.slot = r.u8();
    m.lastSlot = r.u8();
    m.weapons = [];
    for (let k = 1; k <= 5; k++) {
      const wi = r.u8(), clip = r.u8(), reserve = r.u16(), wf = r.u8();
      m.weapons[k] = wi === NONE ? null : { id: WEAPON_IDS[wi], clip, reserve, silenced: !!(wf & 1), burst: !!(wf & 2) };
    }
    m.nades = { hegrenade: r.u8(), flashbang: r.u8(), smokegrenade: r.u8() };
  }
  const n = r.u8();
  for (let k = 0; k < n; k++) {
    s.players.push({
      id: r.u8(), flags: r.u16(), x: r.f32(), y: r.f32(), z: r.f32(), vx: r.i16(), vy: r.i16(), vz: r.i16(),
      yaw: unpackYaw(r.u16()), pitch: r.i16() / 10000, duck: r.u8() / 255, weapon: r.u8(), zoom: r.u8(), health: r.u8(),
      punchPitch: r.i16() / 100, punchYaw: r.i16() / 100, clip: r.u8(), reserve: r.u16(),
    });
  }
  const nn = r.u8();
  for (let k = 0; k < nn; k++) s.nades.push({ rid: r.u16(), id: NADE_IDS[r.u8()] || 'hegrenade', x: r.f32(), y: r.f32(), z: r.f32(), ground: !!r.u8() });
  const nd = r.u8();
  for (let k = 0; k < nd; k++) s.doors.push({ v: r.i16() / 10000, solid: r.u8() - 1 });
  const ni = r.u8();
  for (let k = 0; k < ni; k++) {
    s.items.push({ nid: r.u16(), x: r.f32(), y: r.f32(), z: r.f32(), rx: r.i16() / 5000, ry: r.i16() / 5000, rz: r.i16() / 5000, ground: !!r.u8() });
  }
  return s;
}

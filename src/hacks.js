// Hacker mode: hacks anyone can switch on when the match allows them (Create
// Game → Hacks). Nothing is secret: a hacker gets a [HACK] tag on their name,
// a red glow on their body, a chat line every time they switch something and
// a mark on the kills they make. Every hack is its own switch, and the state
// lives on the player (p.hacks, p.hackCfg) so a server can check it later.

import * as THREE from '../lib/three.module.js';
import { DEG } from './config.js';
import { aimPoint, rayVsPlayer, dirFromAngles } from './player.js';

// in the order the menus list them
export const SEE_HACKS = ['wallhack', 'esp', 'radar', 'noflash', 'nosmoke'];
export const PLAY_HACKS = ['aimbot', 'triggerbot', 'norecoil', 'nospread', 'speedhack', 'autobhop'];
export const HACKS = [...SEE_HACKS, ...PLAY_HACKS];

// the sliders (bots always use these defaults)
export const HACK_DEFAULTS = {
  aimSmooth: 0.3,   // 0 = snaps instantly, 1 = slides on slowly
  aimFov: 30,       // degrees: how wide a circle around the crosshair it picks targets in
  aimBone: 'head',  // 'head' | 'body'
  aimWhen: 'always', // 'always' | 'fire' (only while shooting)
  trigDelay: 80,    // ms the crosshair has to be on an enemy before the triggerbot fires
  speed: 1.5,       // speedhack: movement runs this much faster
};
export const HACK_LIMITS = { aimSmooth: [0, 1], aimFov: [1, 180], trigDelay: [0, 300], speed: [1.2, 3] };

export const noHacks = () => Object.fromEntries(HACKS.map((k) => [k, false]));

export function hackCfg(src) {
  const c = { ...HACK_DEFAULTS };
  if (!src || typeof src !== 'object') return c;
  for (const [k, [lo, hi]] of Object.entries(HACK_LIMITS)) {
    if (typeof src[k] === 'number' && src[k] >= lo && src[k] <= hi) c[k] = src[k];
  }
  if (src.aimBone === 'head' || src.aimBone === 'body') c.aimBone = src.aimBone;
  if (src.aimWhen === 'always' || src.aimWhen === 'fire') c.aimWhen = src.aimWhen;
  return c;
}

export const isHacking = (p) => !!p.hacks && HACKS.some((k) => p.hacks[k]);

const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const v1 = new THREE.Vector3();
const dir = new THREE.Vector3();

// can p see this point (walls, and smoke unless p has no-smoke)?
function clearShot(g, p, ex, ey, ez, q) {
  if (!g.world.visible(ex, ey, ez, q.x, q.y, q.z)) return false;
  return p.hacks.nosmoke || !g.grenades.blocks(ex, ey, ez, q.x, q.y, q.z);
}

// Aimbot: turn the crosshair (view + recoil punch, where the bullets go) onto
// the visible enemy closest to it, inside the chosen circle.
export function aimbot(g, p, cmd, dt) {
  const c = p.hackCfg;
  if (c.aimWhen === 'fire' && !cmd.attack) return;
  const w = p.weapon;
  if (!w || w.def.type === 'grenade' || w.def.type === 'c4') return;
  const ex = p.pos.x, ey = p.pos.y + p.eyeHeight(), ez = p.pos.z;
  const ay = p.aimYaw(), ap = p.aimPitch();
  const half = (c.aimFov * DEG) / 2;
  let best = null, bestA = Infinity, bestYaw = 0, bestPitch = 0;
  for (const e of g.players) {
    if (!e.alive || e === p || !g.isEnemy(p, e) || e.isProtected(g.time)) continue;
    const q = aimPoint(e, c.aimBone === 'head' ? 'head' : 'chest', v1);
    const dx = q.x - ex, dy = q.y - ey, dz = q.z - ez;
    const ty = Math.atan2(-dx, -dz), tp = Math.atan2(dy, Math.hypot(dx, dz));
    const a = Math.hypot(wrap(ty - ay) * Math.cos(tp), tp - ap);
    if (a > half || a >= bestA) continue;
    if (!clearShot(g, p, ex, ey, ez, q)) continue;
    best = e;
    bestA = a;
    bestYaw = ty;
    bestPitch = tp;
  }
  if (!best) return;
  // where the view has to point so that view + punch lands on the target
  const wantYaw = bestYaw - p.punchYaw * DEG, wantPitch = bestPitch - p.punchPitch * DEG;
  const k = c.aimSmooth < 0.01 ? 1 : 1 - Math.exp(-dt / (c.aimSmooth * 0.2));
  p.yaw = wrap(p.yaw + wrap(wantYaw - p.yaw) * k);
  p.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, p.pitch + (wantPitch - p.pitch) * k));
}

// Triggerbot: fire as soon as the crosshair has been on an enemy for the delay.
export function triggerbot(g, p, cmd) {
  const w = p.weapon;
  if (!w || w.def.type === 'grenade' || w.def.type === 'c4' || (w.def.type !== 'knife' && (w.clip <= 0 || w.reloading))) {
    p.trigSince = 0;
    return;
  }
  const ex = p.pos.x, ey = p.pos.y + p.eyeHeight(), ez = p.pos.z;
  const d = dirFromAngles(p.aimYaw(), p.aimPitch(), dir);
  const reach = w.def.type === 'knife' ? 64 : 8192;
  const wh = g.world.traceRay(ex, ey, ez, d.x, d.y, d.z, reach);
  let bt = wh ? wh.t : reach, hit = null;
  for (const o of g.players) {
    if (o === p || !o.alive) continue;
    const r = rayVsPlayer(o, ex, ey, ez, d.x, d.y, d.z, bt);
    if (r) { bt = r.t; hit = o; }
  }
  const on = hit && g.isEnemy(p, hit) && !hit.isProtected(g.time) &&
    (p.hacks.nosmoke || !g.grenades.blocks(ex, ey, ez, hit.pos.x, hit.pos.y + 50, hit.pos.z));
  if (!on) {
    p.trigSince = 0;
    return;
  }
  if (!p.trigSince) p.trigSince = g.time;
  if ((g.time - p.trigSince) * 1000 < p.hackCfg.trigDelay) return;
  // automatic guns (and the knife) just hold the trigger, the rest click
  if (w.def.auto || w.def.type === 'knife') cmd.attack = true;
  else cmd.attack = !p.oldAttack;
}

// the hacks that change what a player does this tick (before they move)
export function hackCmd(g, p, cmd, dt) {
  const h = p.hacks;
  // bots aim with their own brain (bot.js), people with the aimbot
  if (h.aimbot && !p.isBot) aimbot(g, p, cmd, dt);
  if (h.triggerbot && !cmd.attack) triggerbot(g, p, cmd);
  // holding jump hops again the moment you land
  if (h.autobhop) p.oldJump = false;
}

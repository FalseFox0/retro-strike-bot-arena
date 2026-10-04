// Every texture is painted in code. World textures are 128px (1 texel per
// unit, like GoldSrc) and filtered smoothly the way CS 1.6 rendered them.

import * as THREE from '../lib/three.module.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Tileable value noise, w x h pixels, cx x cy lattice cells.
function valueNoise(w, h, cx, cy, seed) {
  const r = rng(seed);
  const lat = new Float32Array(cx * cy);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * cy, iy = Math.floor(fy), sy = smooth(fy - iy);
    const y0 = (iy % cy) * cx, y1 = ((iy + 1) % cy) * cx;
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cx, ix = Math.floor(fx), sx = smooth(fx - ix);
      const x0 = ix % cx, x1 = (ix + 1) % cx;
      const a = lat[y0 + x0], b = lat[y0 + x1], c = lat[y1 + x0], d = lat[y1 + x1];
      const top = a + (b - a) * sx, bot = c + (d - c) * sx;
      out[y * w + x] = top + (bot - top) * sy;
    }
  }
  return out;
}

// Fractal noise in [0,1]
function fbm(w, h, cells, octaves, seed, gain = 0.5) {
  const out = new Float32Array(w * h);
  let amp = 1, total = 0;
  const ratio = h / w;
  for (let o = 0; o < octaves; o++) {
    const c = cells << o;
    const n = valueNoise(w, h, c, Math.max(1, Math.round(c * ratio)), seed + o * 1013);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// fn(x, y, i) -> [r, g, b, a?]
function paint(w, h, fn) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const col = fn(x, y, i);
      const k = i * 4;
      d[k] = clamp255(col[0]);
      d[k + 1] = clamp255(col[1]);
      d[k + 2] = clamp255(col[2]);
      d[k + 3] = col.length > 3 ? clamp255(col[3]) : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tex(c, { wrap = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = aniso;
  return t;
}

const mul = (rgb, s) => [rgb[0] * s, rgb[1] * s, rgb[2] * s];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// distance from (x,y) to the edges of a w x h cell
function edgeDist(x, y, w, h) {
  return Math.min(x, y, w - 1 - x, h - 1 - y);
}

// ---------------- world ----------------

function floor() {
  const S = 128, r = rng(11);
  const n = fbm(S, S, 4, 4, 101), g = fbm(S, S, 32, 2, 102), crack = fbm(S, S, 8, 3, 103);
  const tint = Array.from({ length: 8 }, () => [0.9 + r() * 0.16, 0.97 + r() * 0.06]);
  return paint(S, S, (x, y, i) => {
    // two rows of 64px slabs, second row shifted by half a slab
    const row = y >> 6, ly = y & 63;
    const sx = (x + (row & 1) * 32) & 127, slab = (row * 2 + (sx >> 6)) & 7, lx = sx & 63;
    const [t, hue] = tint[slab];
    let col = [190 * hue, 166, 124 / hue];
    let s = t * (0.82 + 0.36 * n[i]) + (g[i] - 0.5) * 0.14;
    const d = edgeDist(lx, ly, 64, 64);
    if (d < 1) s *= 0.5;
    else if (d < 2) s *= 0.68;
    else if (d < 4) s *= lx < 4 || ly < 4 ? 1.07 : 0.88; // bevel: light top-left, dark bottom-right
    if (Math.abs(crack[i] - 0.5) < 0.006 && d > 4) s *= 0.72;
    if (g[i] > 0.8) s *= 0.9;
    col = mul(col, s);
    // a little sand piled in the grout
    if (d < 2) col = mix(col, [170, 148, 108], 0.45);
    return col;
  });
}

function wall() {
  const S = 128, r = rng(22);
  const n = fbm(S, S, 4, 4, 201), g = fbm(S, S, 32, 2, 202), chip = fbm(S, S, 16, 3, 203);
  const tint = Array.from({ length: 16 }, () => 0.86 + r() * 0.22);
  return paint(S, S, (x, y, i) => {
    const row = y >> 5, ly = y & 31;
    const sx = (x + (row & 1) * 32) & 127, blk = (row * 2 + (sx >> 6)) & 15, lx = sx & 63;
    let s = tint[blk] * (0.84 + 0.3 * n[i]) + (g[i] - 0.5) * 0.12;
    const d = edgeDist(lx, ly, 64, 32);
    if (d < 1) s *= 0.48;
    else if (d < 2) s *= 0.64;
    else if (d < 3) s *= ly < 3 ? 1.1 : lx < 3 ? 1.05 : 0.86;
    if (chip[i] < 0.24 && d > 2) s *= 0.8;
    if (chip[i] > 0.78) s *= 1.06;
    let col = mul([210, 182, 136], s);
    if (d < 2) col = mix(col, [150, 130, 100], 0.4);
    return col;
  });
}

function trim() {
  const n = fbm(64, 64, 4, 3, 301);
  return paint(64, 64, (x, y, i) => {
    let s = 0.8 + 0.3 * n[i];
    if (y < 2) s *= 1.25;
    else if (y < 4) s *= 1.1;
    if ((x & 31) === 0) s *= 0.6;
    return mul([118, 108, 94], s);
  });
}

function crate() {
  const S = 128;
  const n = fbm(S, S, 4, 4, 401), g = fbm(S, S, 16, 3, 402);
  return paint(S, S, (x, y, i) => {
    const F = 13; // frame board width
    const inFrame = x < F || y < F || x >= S - F || y >= S - F;
    const dd = Math.abs(x - y);
    const inBrace = !inFrame && dd < 10;
    let base, s, grain;
    if (inFrame) {
      const horiz = (y < F || y >= S - F) && x >= F - 1 && x <= S - F;
      grain = horiz ? Math.sin(y * 1.1 + n[i] * 9) : Math.sin(x * 1.1 + n[i] * 9);
      base = [140, 96, 52];
      s = 0.86 + grain * 0.05 + (g[i] - 0.5) * 0.15;
      const e = horiz ? Math.min(y < F ? y : y - (S - F), (y < F ? F - 1 - y : S - 1 - y)) : Math.min(x < F ? x : x - (S - F), x < F ? F - 1 - x : S - 1 - x);
      if (e < 1) s *= 0.55; else if (e < 2) s *= 0.8;
      if (!horiz && (y < F || y >= S - F)) s *= 0.93;
    } else if (inBrace) {
      grain = Math.sin((x + y) * 0.55 + n[i] * 8);
      base = [146, 101, 56];
      s = 0.9 + grain * 0.05 + (g[i] - 0.5) * 0.15;
      if (dd > 8) s *= 0.62; else if (dd > 7) s *= 0.85;
    } else {
      // vertical planks behind
      const plank = Math.floor((x - F) / 17);
      grain = Math.sin(x * 0.9 + n[i] * 10 + plank * 3);
      base = [176, 128, 74];
      s = 0.9 + grain * 0.06 + (g[i] - 0.5) * 0.16 - (plank % 2) * 0.05;
      if ((x - F) % 17 === 0) s *= 0.58;
      // shadow under the frame and brace
      if (x < F + 3 || y < F + 3) s *= 0.8;
      if (x - y > 9 && x - y < 13) s *= 0.75;
    }
    // nail heads
    for (const [nx, ny] of [[6, 6], [S - 7, 6], [6, S - 7], [S - 7, S - 7], [64, 6], [64, S - 7], [6, 64], [S - 7, 64]]) {
      const dn = Math.hypot(x - nx, y - ny);
      if (dn < 2.2) return dn < 1.2 ? [88, 86, 80] : [52, 48, 42];
    }
    return mul(base, s);
  });
}

function mcrate() {
  const S = 128;
  const n = fbm(S, S, 4, 4, 501), g = fbm(S, S, 32, 2, 502), w = fbm(S, S, 8, 4, 503);
  return paint(S, S, (x, y, i) => {
    let s = 0.86 + 0.24 * n[i] + (g[i] - 0.5) * 0.1;
    let col = [84, 98, 70];
    const B = 8;
    const d = edgeDist(x, y, S, S);
    if (d < B) {
      s *= 0.78;
      if (d < 1) s *= 0.6; else if (d === B - 1) s *= 1.15;
    } else {
      const ry = (y - B) % 28;
      if (ry < 2) s *= 1.18; else if (ry < 4) s *= 1.06; else if (ry > 25) s *= 0.72;
    }
    // worn paint on the edges shows bare metal
    if (w[i] < 0.28 + (d < B + 3 ? 0.12 : 0)) col = mix(col, [128, 126, 118], 0.75);
    // rivets
    for (const [rx, ry] of [[4, 4], [S - 5, 4], [4, S - 5], [S - 5, S - 5], [64, 4], [64, S - 5], [4, 64], [S - 5, 64]]) {
      const dr = Math.hypot(x - rx, y - ry);
      if (dr < 2) return dr < 1 ? [150, 150, 140] : [44, 46, 40];
    }
    return mul(col, s);
  });
}

function concrete() {
  const S = 128;
  const n = fbm(S, S, 4, 5, 601), g = fbm(S, S, 32, 2, 602), st = fbm(S, S, 6, 3, 603);
  return paint(S, S, (x, y, i) => {
    let s = 0.82 + 0.28 * n[i] + (g[i] - 0.5) * 0.16;
    if (st[i] < 0.3) s *= 0.88 + st[i] * 0.3;
    if (y === 0 || x === 0) s *= 0.7;
    // form-tie holes
    for (const [hx, hy] of [[32, 32], [96, 32], [32, 96], [96, 96]]) {
      const dh = Math.hypot(x - hx, y - hy);
      if (dh < 2.5) s *= 0.45; else if (dh < 3.5) s *= 0.8;
    }
    if (g[i] > 0.85) s *= 0.82;
    return mul([150, 147, 139], s);
  });
}

function barrel() {
  const W = 64, H = 128;
  const n = fbm(W, H, 4, 4, 701), rust = fbm(W, H, 8, 3, 702);
  return paint(W, H, (x, y, i) => {
    let s = 0.84 + 0.26 * n[i];
    let col = [134, 50, 34];
    const yy = y % 43;
    if (yy < 3) s *= 1.2; else if (yy < 6) s *= 0.7;
    if (y < 4 || y > H - 5) s *= 0.65;
    if (rust[i] < 0.35) col = mix(col, [104, 70, 42], 0.7);
    if (rust[i] > 0.7) col = mix(col, [150, 66, 44], 0.4);
    return mul(col, s);
  });
}

function sky() {
  const W = 1024, H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#4a80c2');
  grd.addColorStop(0.4, '#93b8dc');
  grd.addColorStop(0.5, '#d6e0e4');
  grd.addColorStop(0.53, '#cbbd9c');
  grd.addColorStop(1, '#a8946f');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
  const r = rng(77);
  for (let i = 0; i < 40; i++) {
    const cx = r() * W, cy = 50 + r() * 70, w = 30 + r() * 70;
    for (let k = 0; k < 6; k++) {
      const x = cx + (r() - 0.5) * w, y = cy + (r() - 0.5) * w * 0.12, rad = w * (0.18 + r() * 0.22);
      const a = 0.32 + r() * 0.2;
      for (const off of [0, -W, W]) {
        const rg = ctx.createRadialGradient(x + off, y, 0, x + off, y, rad);
        rg.addColorStop(0, `rgba(255,255,255,${a})`);
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = rg;
        ctx.save();
        ctx.translate(x + off, y);
        ctx.scale(1, 0.35);
        ctx.translate(-(x + off), -y);
        ctx.beginPath();
        ctx.arc(x + off, y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
  const t = tex(c, { aniso: 1 });
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------- desert town ----------------

// packed sand with ripples and pebbles
function sand() {
  const S = 128, r = rng(2101);
  const n = fbm(S, S, 4, 5, 2102), g = fbm(S, S, 32, 2, 2103), rip = fbm(S, S, 8, 2, 2104);
  const pebbles = Array.from({ length: 34 }, () => [r() * S, r() * S, 0.6 + r() * 1.6, 0.7 + r() * 0.5]);
  return paint(S, S, (x, y, i) => {
    let s = 0.84 + 0.26 * n[i] + (g[i] - 0.5) * 0.18;
    s *= 1 + Math.sin((y + rip[i] * 30) * 0.42) * 0.025;
    let col = mix([214, 184, 132], [196, 160, 112], clamp01((n[i] - 0.35) * 2));
    for (const [px, py, pr, ps] of pebbles) {
      const dx = Math.min(Math.abs(x - px), S - Math.abs(x - px)), dy = Math.min(Math.abs(y - py), S - Math.abs(y - py));
      const d = Math.hypot(dx, dy);
      if (d < pr) return mul([150, 128, 98], ps * (d < pr * 0.5 ? 1.1 : 0.85));
      if (d < pr + 1) s *= 0.9; // little shadow ring
    }
    col = mul(col, s);
    return col;
  });
}

// stone paving slabs of different sizes, sand in the joints
function paving() {
  const S = 128, r = rng(2201);
  const n = fbm(S, S, 4, 4, 2202), g = fbm(S, S, 32, 2, 2203), wear = fbm(S, S, 8, 3, 2204);
  // three rows, each cut into slabs of random width
  const rows = [0, 40, 84, 128];
  const cuts = rows.slice(0, 3).map(() => {
    const c = [0];
    while (c[c.length - 1] < S - 20) c.push(Math.min(S, c[c.length - 1] + 28 + Math.floor(r() * 30)));
    c[c.length - 1] = S;
    return c;
  });
  const tint = Array.from({ length: 40 }, () => 0.88 + r() * 0.2);
  return paint(S, S, (x, y, i) => {
    const row = y < 40 ? 0 : y < 84 ? 1 : 2;
    const ly = y - rows[row], hh = rows[row + 1] - rows[row];
    const c = cuts[row];
    let k = 0;
    while (k < c.length - 2 && x >= c[k + 1]) k++;
    const lx = x - c[k], ww = c[k + 1] - c[k];
    const d = Math.min(lx, ly, ww - 1 - lx, hh - 1 - ly);
    let s = tint[(row * 13 + k) % 40] * (0.84 + 0.24 * n[i]) + (g[i] - 0.5) * 0.12;
    if (wear[i] > 0.72) s *= 1.06;
    if (d < 1) return mul([176, 150, 110], 0.8 + g[i] * 0.2);
    if (d < 2) s *= 0.78;
    else if (d < 3) s *= lx < 3 || ly < 3 ? 1.06 : 0.9;
    return mul([186, 168, 138], s);
  });
}

// big sandstone blocks, weathered
function sandstone() {
  const S = 128, r = rng(2301);
  const n = fbm(S, S, 4, 4, 2302), g = fbm(S, S, 32, 2, 2303), chip = fbm(S, S, 16, 3, 2304), streak = fbm(S, S, 2, 3, 2305);
  const tint = Array.from({ length: 8 }, () => [0.88 + r() * 0.18, 0.96 + r() * 0.08]);
  return paint(S, S, (x, y, i) => {
    const row = y >> 5, ly = y & 31;
    const sx = (x + (row & 1) * 40) & 127, blk = (row * 2 + (sx >= 80 ? 1 : 0)) & 7, lx = sx >= 80 ? sx - 80 : sx, bw = sx >= 80 ? 48 : 80;
    const [t, hue] = tint[blk];
    let s = t * (0.84 + 0.26 * n[i]) + (g[i] - 0.5) * 0.14;
    // horizontal weathering bands, as if wind-worn
    s *= 0.95 + Math.sin(y * 0.35 + streak[i] * 8) * 0.03;
    const d = Math.min(lx, ly, bw - 1 - lx, 31 - ly);
    if (d < 1) s *= 0.55;
    else if (d < 2) s *= 0.72;
    else if (d < 3) s *= ly < 3 ? 1.1 : 0.9;
    if (chip[i] < 0.22 && d > 1) s *= 0.82;
    let col = mul([220 * hue, 184, 130 / hue], s);
    if (d < 2) col = mix(col, [168, 140, 100], 0.4);
    return col;
  });
}

// smooth plaster with stains, cracks and a few bare bricks showing
// worn: bits of plaster have fallen off, showing the bricks (a kept-up villa isn't)
function plasterTex(base, seed, worn = true) {
  const S = 128;
  const n = fbm(S, S, 4, 5, seed), g = fbm(S, S, 32, 2, seed + 1), crack = fbm(S, S, 6, 4, seed + 2), patch = fbm(S, S, 3, 3, seed + 3), stain = fbm(S, S, 2, 4, seed + 4);
  return paint(S, S, (x, y, i) => {
    let s = 0.9 + 0.16 * n[i] + (g[i] - 0.5) * 0.08;
    s *= 0.92 + stain[i] * (worn ? 0.14 : 0.06);
    let col = base;
    if (worn && patch[i] > 0.8) {
      // fallen plaster: bricks underneath
      const row = y >> 3, bx = (x + (row & 1) * 8) & 15;
      const mortar = (y & 7) === 0 || bx === 0;
      col = mortar ? mul(base, 0.72) : mix(base, [176, 136, 100], 0.55);
      s = 0.88 + n[i] * 0.16;
      if (patch[i] < 0.815) s *= 0.78; // the plaster edge
    }
    if (worn && Math.abs(crack[i] - 0.5) < 0.006) s *= 0.75;
    // rain streaks running down
    s *= 0.96 + Math.sin(x * 0.9 + g[i] * 3) * 0.015 * (y / S);
    return mul(col, s);
  });
}

// weathered wooden boards, running sideways
function planks() {
  const S = 64;
  const n = fbm(S, S, 4, 3, 2401), g = fbm(S, S, 32, 1, 2402);
  return paint(S, S, (x, y, i) => {
    const board = y >> 4, ly = y & 15;
    const grain = Math.sin(x * 0.45 + n[i] * 12 + board * 2.3);
    let s = 0.84 + grain * 0.07 + (g[i] - 0.5) * 0.16 + (board & 1 ? -0.04 : 0.03);
    if (ly === 0) s *= 0.55;
    else if (ly === 1) s *= 0.85;
    // nails at the board ends
    if ((x === 3 || x === 60) && (ly === 5 || ly === 10)) return [62, 58, 52];
    return mul([132, 100, 70], s);
  });
}

// carved stone ledge / band
function stoneTrim() {
  const n = fbm(64, 64, 4, 3, 2501), g = fbm(64, 64, 16, 2, 2502);
  return paint(64, 64, (x, y, i) => {
    let s = 0.84 + 0.24 * n[i] + (g[i] - 0.5) * 0.1;
    if (y < 3) s *= 1.18;
    else if (y < 6) s *= 1.06;
    else if (y > 58) s *= 0.78;
    if (y === 32) s *= 0.8;
    if ((x & 31) === 0) s *= 0.72;
    return mul([190, 164, 126], s);
  });
}

// window pane: dusty glass (see-through) in a wooden frame with a cross bar
function glass() {
  const S = 64;
  const n = fbm(S, S, 4, 3, 2601), streak = fbm(S, S, 16, 2, 2602);
  return paint(S, S, (x, y, i) => {
    const d = edgeDist(x, y, S, S);
    const bar = Math.abs(x - 31.5) < 1.6 || Math.abs(y - 31.5) < 1.6;
    if (d < 3 || bar) {
      const s = 0.8 + n[i] * 0.3;
      return [96 * s, 70 * s, 46 * s, 255];
    }
    const dust = clamp01(0.25 + n[i] * 0.5 + (S - y) / S * 0.0 + (y / S) * 0.25);
    const s = 0.85 + streak[i] * 0.3;
    return [190 * s + dust * 30, 214 * s + dust * 10, 222 * s - dust * 20, 70 + dust * 70];
  });
}

// vent cover: a metal frame with slots you can see through
function grate() {
  const S = 64;
  const n = fbm(S, S, 8, 2, 2701);
  return paint(S, S, (x, y, i) => {
    const d = edgeDist(x, y, S, S);
    const s = 0.82 + n[i] * 0.3;
    if (d < 5) return [98 * s, 100 * s, 102 * s, 255];
    const slot = (y - 5) % 8;
    if (slot < 4 && x > 8 && x < S - 9) return [20, 20, 20, 0];
    return [120 * s, 122 * s, 124 * s, 255];
  });
}

// palm trunk bark rings and fronds (alpha cut-out)
function palmTrunk() {
  const W = 64, H = 128;
  const n = fbm(W, H, 4, 3, 2801);
  return paint(W, H, (x, y, i) => {
    const ring = y % 10;
    let s = 0.82 + n[i] * 0.3;
    if (ring < 2) s *= 0.65;
    else if (ring < 4) s *= 1.12;
    s *= 1 + Math.sin(x * 0.6 + y * 0.3) * 0.04;
    return mul([124, 98, 70], s);
  });
}

function palmLeaf() {
  const W = 128, H = 64;
  const n = fbm(W, H, 8, 2, 2901);
  return paint(W, H, (x, y, i) => {
    // midrib along the middle (u = 0 at the trunk end, 1 at the tip)
    const u = x / W, v = (y - 31.5) / 32;
    const width = Math.sin(Math.min(1, u * 1.15) * Math.PI) * 0.95 + 0.05;
    const leaflet = Math.abs(Math.sin(u * 46 + Math.sign(v) * 0.8)) > 0.35;
    if (Math.abs(v) > width || (!leaflet && Math.abs(v) > 0.08)) return [0, 0, 0, 0];
    const s = 0.82 + n[i] * 0.3 - Math.abs(v) * 0.2;
    const dry = clamp01((u - 0.75) * 3) * 0.5;
    if (Math.abs(v) < 0.05) return [120, 112, 60, 255];
    return [mix([62, 102, 38], [150, 136, 70], dry)[0] * s, mix([62, 102, 38], [150, 136, 70], dry)[1] * s, mix([62, 102, 38], [150, 136, 70], dry)[2] * s, 255];
  });
}

// desert sky: pale and hazy toward a sandy horizon, a few high streaks
function skyDesert() {
  const W = 1024, H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#3f7bc4');
  grd.addColorStop(0.3, '#78a8d8');
  grd.addColorStop(0.47, '#cfdbe0');
  grd.addColorStop(0.5, '#e6dcc4');
  grd.addColorStop(0.53, '#d2b98e');
  grd.addColorStop(1, '#b0915e');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
  const r = rng(3001);
  // thin high cirrus streaks
  for (let i = 0; i < 26; i++) {
    const cx = r() * W, cy = 30 + r() * 70, w = 80 + r() * 160;
    for (const off of [0, -W, W]) {
      const rg = ctx.createRadialGradient(cx + off, cy, 0, cx + off, cy, w);
      rg.addColorStop(0, `rgba(255,255,255,${0.16 + r() * 0.14})`);
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      ctx.save();
      ctx.translate(cx + off, cy);
      ctx.scale(1, 0.08);
      ctx.translate(-(cx + off), -cy);
      ctx.beginPath();
      ctx.arc(cx + off, cy, w, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  // far dunes along the horizon
  ctx.fillStyle = 'rgba(196,164,112,0.85)';
  ctx.beginPath();
  ctx.moveTo(0, 132);
  for (let x = 0; x <= W; x += 8) ctx.lineTo(x, 128 - 5 * Math.sin(x * 0.012) - 4 * Math.sin(x * 0.031 + 1.3) - 2 * Math.sin(x * 0.07));
  ctx.lineTo(W, 140);
  ctx.lineTo(0, 140);
  ctx.fill();
  const t = tex(c, { aniso: 1 });
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------- factory (de_foundry) ----------------

// smooth poured concrete in big slabs, oil stains and scuffs
function factoryFloor() {
  const S = 128;
  const n = fbm(S, S, 4, 5, 3101), g = fbm(S, S, 32, 2, 3102), stain = fbm(S, S, 3, 4, 3103), scuff = fbm(S, S, 12, 3, 3104);
  return paint(S, S, (x, y, i) => {
    let s = 0.86 + 0.18 * n[i] + (g[i] - 0.5) * 0.1;
    if (stain[i] > 0.66) s *= 1 - (stain[i] - 0.66) * 1.4; // oil
    if (scuff[i] > 0.78) s *= 1.05;
    // saw-cut joints between the slabs
    if (x === 0 || y === 0) s *= 0.62;
    else if (x === 1 || y === 1) s *= 0.85;
    return mul([148, 146, 140], s);
  });
}

// worn asphalt: dark grain, lighter aggregate, a few tar-sealed cracks
function asphalt() {
  const S = 128, r = rng(3201);
  const n = fbm(S, S, 4, 4, 3202), crack = fbm(S, S, 5, 4, 3203), patch = fbm(S, S, 2, 3, 3204);
  return paint(S, S, (x, y, i) => {
    let s = 0.8 + 0.22 * n[i] + (r() - 0.5) * 0.22;
    if (r() < 0.05) s *= 1.35; // bits of stone
    if (patch[i] > 0.7) s *= 0.88;
    let col = mul([86, 86, 88], s);
    if (Math.abs(crack[i] - 0.5) < 0.008) col = [34, 34, 36];
    return col;
  });
}

// industrial brick, a little sooty toward the top
function brick(base, seed) {
  const S = 128, r = rng(seed);
  const n = fbm(S, S, 4, 4, seed + 1), g = fbm(S, S, 32, 2, seed + 2), soot = fbm(S, S, 3, 3, seed + 3);
  const tint = Array.from({ length: 64 }, () => 0.84 + r() * 0.26);
  return paint(S, S, (x, y, i) => {
    const row = (y / 8) | 0, ly = y & 7;
    const bx = (x + (row & 1) * 8) & 127, col = (bx / 16) | 0, lx = bx & 15;
    if (ly === 0 || lx === 0) return mul([126, 118, 106], 0.8 + g[i] * 0.3); // mortar
    let s = tint[(row * 9 + col) & 63] * (0.86 + 0.2 * n[i]) + (g[i] - 0.5) * 0.12;
    if (ly === 1 || lx === 1) s *= 1.06;
    if (ly === 7 || lx === 15) s *= 0.84;
    s *= 0.9 + soot[i] * 0.16;
    return mul(base, s);
  });
}

// corrugated steel siding: vertical ribs, faded paint, rust running down
function corrugated(base, seed) {
  const S = 128;
  const n = fbm(S, S, 4, 4, seed), rust = fbm(S, S, 6, 4, seed + 1), streak = fbm(S, 32, 16, 2, seed + 2);
  return paint(S, S, (x, y, i) => {
    const rib = Math.sin((x / 16) * Math.PI * 2);
    let s = 0.86 + rib * 0.14 + (n[i] - 0.5) * 0.14;
    let col = mul(base, s);
    // rust where the paint is worn, streaks below fasteners
    const st = streak[(y >> 2) * S + x];
    const rr = rust[i] > 0.7 ? (rust[i] - 0.7) * 2.5 : 0;
    const rs = (x % 32 < 3) ? Math.max(0, st - 0.55) * (y / S) * 1.6 : 0;
    col = mix(col, mul([122, 70, 38], 0.8 + n[i] * 0.4), Math.min(0.85, rr + rs));
    if ((y === 4 || y === 124) && x % 16 === 8) col = [60, 58, 54]; // rivets
    return col;
  });
}

// painted structural steel with weld seams and bolts
function steel(base, seed) {
  const S = 64;
  const n = fbm(S, S, 8, 3, seed), chip = fbm(S, S, 16, 2, seed + 1);
  return paint(S, S, (x, y, i) => {
    let s = 0.86 + n[i] * 0.22;
    let col = mul(base, s);
    if (chip[i] > 0.78) col = mix(col, [70, 66, 62], 0.7); // chipped paint
    if (y === 32 || y === 33) col = mul(col, 0.8);
    if ((x === 8 || x === 56) && (y === 8 || y === 56)) col = mul(base, 0.55);
    return col;
  });
}

// diamond tread plate (catwalks, stairs)
function plate() {
  const S = 64;
  const n = fbm(S, S, 8, 3, 3401), g = fbm(S, S, 32, 1, 3402);
  return paint(S, S, (x, y, i) => {
    let s = 0.82 + n[i] * 0.2 + (g[i] - 0.5) * 0.1;
    // raised diamonds in alternating directions
    const cx = x & 15, cy = y & 15, alt = ((x >> 4) + (y >> 4)) & 1;
    const u = alt ? cx - cy : cx + cy - 15;
    if (Math.abs(u) < 2 && cx > 3 && cx < 12 && cy > 3 && cy < 12) s *= u < 0 ? 1.22 : 0.8;
    return mul([128, 130, 134], s);
  });
}

// yellow and black warning stripes
function hazard() {
  const S = 64;
  const n = fbm(S, S, 8, 2, 3501);
  return paint(S, S, (x, y, i) => {
    const band = ((x + y) >> 4) & 1;
    const s = 0.82 + n[i] * 0.25;
    return band ? mul([214, 172, 40], s) : mul([36, 34, 32], s);
  });
}

// shipping container walls: horizontal box ribs
function containerTex(base, seed) {
  const S = 128;
  const n = fbm(S, S, 4, 4, seed), rust = fbm(S, S, 6, 4, seed + 1), g = fbm(S, S, 32, 1, seed + 2);
  return paint(S, S, (x, y, i) => {
    const ly = y & 31;
    let s = 0.88 + (n[i] - 0.5) * 0.16 + (g[i] - 0.5) * 0.06;
    if (ly < 3) s *= 0.78; else if (ly < 5) s *= 1.1; else if (ly > 27) s *= 0.9;
    let col = mul(base, s);
    if (rust[i] > 0.74) col = mix(col, [118, 66, 36], (rust[i] - 0.74) * 3);
    return col;
  });
}

// a big rolling hall door: ribbed panels in a steel frame with a cross brace
function doorMetal() {
  const S = 128;
  const n = fbm(S, S, 4, 4, 3601), rust = fbm(S, S, 5, 4, 3602);
  return paint(S, S, (x, y, i) => {
    const frame = edgeDist(x, y, S, S) < 6 || Math.abs(y - 64) < 3;
    const brace = Math.abs((x - 6) - (y - 6) * 0.98) < 3 && x > 5 && x < 122 && y > 5 && y < 122;
    let col;
    if (frame || brace) col = mul([78, 92, 104], 0.82 + n[i] * 0.2);
    else col = mul([104, 118, 128], 0.84 + Math.sin((y / 8) * Math.PI * 2) * 0.08 + (n[i] - 0.5) * 0.14);
    if (rust[i] > 0.72) col = mix(col, [120, 72, 40], (rust[i] - 0.72) * 2.5);
    return col;
  });
}

// an office door: painted, two recessed panels, a metal kick plate
function doorWood() {
  const W = 64, H = 128;
  const n = fbm(W, H, 4, 3, 3701), g = fbm(W, H, 16, 2, 3702);
  return paint(W, H, (x, y, i) => {
    let s = 0.9 + n[i] * 0.14 + (g[i] - 0.5) * 0.06;
    const inPanel = (y > 10 && y < 56 || y > 64 && y < 104) && x > 9 && x < 55;
    if (inPanel) {
      const d = Math.min(x - 9, 55 - x, y > 60 ? Math.min(y - 64, 104 - y) : Math.min(y - 10, 56 - y));
      s *= d < 2 ? 0.8 : 0.95;
    }
    if (y > 112) return mul([150, 150, 146], 0.8 + n[i] * 0.3); // kick plate
    return mul([108, 122, 104], s);
  });
}

// ---------------- pool villa (fy_poolhouse) ----------------

// little blue mosaic tiles
function poolTile() {
  const S = 64, r = rng(3801);
  const tint = Array.from({ length: 256 }, () => 0.86 + r() * 0.22);
  return paint(S, S, (x, y) => {
    const tx = x >> 2, ty = y >> 2;
    if ((x & 3) === 0 || (y & 3) === 0) return [196, 210, 214];
    const s = tint[(ty * 16 + tx) & 255];
    return mul([58, 150, 196], s);
  });
}

// pale stone deck tiles round the pool
function deck() {
  const S = 128, r = rng(3901);
  const n = fbm(S, S, 4, 4, 3902), g = fbm(S, S, 32, 2, 3903);
  const tint = Array.from({ length: 16 }, () => 0.9 + r() * 0.14);
  return paint(S, S, (x, y, i) => {
    const tx = x >> 5, ty = y >> 5, lx = x & 31, ly = y & 31;
    let s = tint[ty * 4 + tx] * (0.88 + 0.16 * n[i]) + (g[i] - 0.5) * 0.08;
    if (lx === 0 || ly === 0) return mul([170, 160, 140], 0.85);
    if (lx === 1 || ly === 1) s *= 1.04;
    return mul([222, 208, 182], s);
  });
}

// water: soft bright ripple lines on a mid tone (drifts in map.js)
function water() {
  const S = 128;
  const a = fbm(S, S, 4, 3, 4001), b = fbm(S, S, 8, 2, 4002);
  return paint(S, S, (x, y, i) => {
    const w = Math.abs(Math.sin((a[i] * 6 + b[i] * 2) * Math.PI));
    const s = 0.72 + Math.pow(1 - w, 6) * 0.6 + b[i] * 0.1;
    return mul([150, 210, 230], s);
  });
}

// short lawn
function grass() {
  const S = 128, r = rng(4101);
  const n = fbm(S, S, 4, 4, 4102), g = fbm(S, S, 16, 2, 4103);
  return paint(S, S, (x, y, i) => {
    const s = 0.78 + 0.24 * n[i] + (r() - 0.5) * 0.26;
    return mix(mul([78, 128, 52], s), mul([128, 136, 70], s), g[i] * 0.6);
  });
}

// terracotta roof tiles in rows
function roofTile() {
  const S = 64;
  const n = fbm(S, S, 4, 3, 4201);
  return paint(S, S, (x, y, i) => {
    const row = y >> 4, ly = y & 15, lx = (x + (row & 1) * 8) & 15;
    let s = 0.86 + n[i] * 0.2 + Math.sin((lx / 16) * Math.PI) * 0.12;
    if (ly > 12) s *= 0.7;
    return mul([176, 92, 56], s);
  });
}

// wooden floor boards inside the houses
function parquet() {
  const S = 64, r = rng(4301);
  const n = fbm(S, S, 4, 3, 4302);
  const tint = Array.from({ length: 32 }, () => 0.84 + r() * 0.24);
  return paint(S, S, (x, y, i) => {
    const board = x >> 3, off = (board * 23) & 63, ly = (y + off) & 63;
    let s = tint[(board * 3 + (((y + off) >> 6) & 7)) & 31] * (0.9 + n[i] * 0.14) + Math.sin(y * 0.6 + board * 3 + n[i] * 9) * 0.03;
    if ((x & 7) === 0 || ly === 0) s *= 0.6;
    return mul([152, 104, 62], s);
  });
}

// ---------------- city rooftops (awp_rooftops) ----------------

// tar and gravel roof
function roofTar() {
  const S = 128, r = rng(4401);
  const n = fbm(S, S, 4, 4, 4402), patch = fbm(S, S, 3, 3, 4403);
  return paint(S, S, (x, y, i) => {
    let s = 0.78 + 0.2 * n[i] + (r() - 0.5) * 0.3;
    if (r() < 0.08) s *= 1.3; // gravel
    if (patch[i] > 0.68) s *= 0.82; // tar patches
    return mul([112, 106, 98], s);
  });
}

// a building side seen from the roofs: brick with rows of windows
function facade() {
  const b = brick([150, 92, 70], 4501);
  const ctx = b.getContext('2d');
  // two windows per tile, with sills and lintels; some lit for the evening
  const r = rng(4502);
  for (const wx of [20, 84]) {
    ctx.fillStyle = '#5a4a3e';
    ctx.fillRect(wx - 3, 26, 30, 4);
    ctx.fillRect(wx - 3, 96, 30, 5);
    const lit = r() < 0.35;
    ctx.fillStyle = lit ? '#e8b868' : '#2a3038';
    ctx.fillRect(wx, 30, 24, 66);
    ctx.fillStyle = lit ? '#c89850' : '#1c2028';
    ctx.fillRect(wx + 11, 30, 2, 66);
    ctx.fillRect(wx, 60, 24, 2);
  }
  return b;
}

// a rooftop air conditioner / vent box
function ventBox() {
  const S = 64;
  const n = fbm(S, S, 8, 3, 4601);
  return paint(S, S, (x, y, i) => {
    let s = 0.86 + n[i] * 0.18;
    if (x > 8 && x < 56 && y > 8 && y < 56 && (y & 3) < 2) s *= 0.55; // grille
    if (edgeDist(x, y, S, S) < 2) s *= 0.75;
    return mul([168, 170, 168], s);
  });
}

// sky with a horizon of factory chimneys
function skyIndustrial() {
  const W = 1024, H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#5f86b4');
  grd.addColorStop(0.36, '#9fb8cf');
  grd.addColorStop(0.49, '#d8dcd8');
  grd.addColorStop(0.5, '#8a8c88');
  grd.addColorStop(1, '#5c5e5a');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
  const r = rng(4701);
  // a soft overcast of long cloud banks
  for (let i = 0; i < 30; i++) {
    const cx = r() * W, cy = 40 + r() * 70, w = 90 + r() * 180;
    for (const off of [0, -W, W]) {
      const rg = ctx.createRadialGradient(cx + off, cy, 0, cx + off, cy, w);
      rg.addColorStop(0, `rgba(240,242,244,${0.22 + r() * 0.2})`);
      rg.addColorStop(1, 'rgba(240,242,244,0)');
      ctx.fillStyle = rg;
      ctx.save();
      ctx.translate(cx + off, cy);
      ctx.scale(1, 0.18);
      ctx.translate(-(cx + off), -cy);
      ctx.beginPath();
      ctx.arc(cx + off, cy, w, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  // far factory skyline: sheds, tanks and chimneys
  ctx.fillStyle = 'rgba(96,100,104,0.9)';
  let x = 0;
  while (x < W) {
    const w = 20 + r() * 60, h = 4 + r() * 10;
    ctx.fillRect(x, 128 - h, w, h + 2);
    if (r() < 0.3) {
      const cw = 3 + r() * 3, ch = 18 + r() * 26;
      ctx.fillRect(x + w * 0.4, 128 - h - ch, cw, ch);
    }
    x += w + r() * 8;
  }
  const t = tex(c, { aniso: 1 });
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// a city at sunset: warm low sky, dark skyline with lit windows
function skySunset() {
  const W = 1024, H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#2c3a66');
  grd.addColorStop(0.25, '#6a5f86');
  grd.addColorStop(0.4, '#d88a68');
  grd.addColorStop(0.48, '#f4b866');
  grd.addColorStop(0.5, '#e8a058');
  grd.addColorStop(1, '#3a3036');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
  const r = rng(4801);
  // the sun low in the west, where awp_rooftops' light comes from (u = 0 is -x)
  const sy = 102;
  for (const sx of [W * 0.083, W * 1.083]) {
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 90);
    sg.addColorStop(0, 'rgba(255,240,200,0.95)');
    sg.addColorStop(0.12, 'rgba(255,214,140,0.7)');
    sg.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sx - 90, sy - 90, 180, 180);
  }
  // thin glowing cloud streaks
  for (let i = 0; i < 22; i++) {
    const cx = r() * W, cy = 50 + r() * 50, w = 60 + r() * 150;
    for (const off of [0, -W, W]) {
      const rg = ctx.createRadialGradient(cx + off, cy, 0, cx + off, cy, w);
      rg.addColorStop(0, `rgba(255,${150 + r() * 60 | 0},${110 + r() * 40 | 0},${0.25 + r() * 0.2})`);
      rg.addColorStop(1, 'rgba(255,160,120,0)');
      ctx.fillStyle = rg;
      ctx.save();
      ctx.translate(cx + off, cy);
      ctx.scale(1, 0.07);
      ctx.translate(-(cx + off), -cy);
      ctx.beginPath();
      ctx.arc(cx + off, cy, w, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  // skyline: towers of all heights, some lit windows
  let x = 0;
  while (x < W) {
    const w = 14 + r() * 40, h = 5 + r() * r() * 24;
    ctx.fillStyle = `rgb(${34 + r() * 14 | 0},${30 + r() * 10 | 0},${42 + r() * 12 | 0})`;
    ctx.fillRect(x, 130 - h, w, h + 4);
    for (let wy = 130 - h + 2; wy < 128; wy += 3) {
      for (let wx = x + 2; wx < x + w - 2; wx += 4) if (r() < 0.12) {
        ctx.fillStyle = r() < 0.5 ? '#f2c37a' : '#e7d6a6';
        ctx.fillRect(wx, wy, 1.5, 1.5);
      }
    }
    x += w + r() * 3;
  }
  const t = tex(c, { aniso: 1 });
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------- decals and sprites ----------------

function hole(kind) {
  const S = 32, r = rng(kind === 'wood' ? 31 : kind === 'metal' ? 32 : 33);
  const n = fbm(S, S, 4, 3, 800 + S);
  const spikes = Array.from({ length: 9 }, () => [r() * Math.PI * 2, 4 + r() * 7]);
  return paint(S, S, (x, y, i) => {
    const dx = x - 15.5, dy = y - 15.5, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (kind === 'metal') {
      if (d < 2.3) return [10, 10, 10, 255];
      if (d < 3.6) return [170, 168, 160, 230];
      if (d < 6) return [60, 60, 58, 150 * (6 - d) / 2.4];
      return [0, 0, 0, 0];
    }
    if (d < 2.4) return [6, 5, 4, 255];
    let edge = 5 + (n[i] - 0.5) * 3;
    if (kind === 'wood') {
      for (const [sa, len] of spikes) {
        const da = Math.abs(((a - sa + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (da < 0.12) edge = Math.max(edge, len + 3);
      }
      if (d < edge) return [62, 40, 20, 220 * clamp01((edge - d) / 2)];
      return [0, 0, 0, 0];
    }
    if (d < 3.8) return [40, 36, 30, 240];
    if (d < edge + 2) return [92, 86, 76, 200 * clamp01((edge + 2 - d) / 3)];
    return [0, 0, 0, 0];
  });
}

function blood() {
  const S = 64, r = rng(901);
  const n = fbm(S, S, 4, 4, 902);
  const drops = Array.from({ length: 10 }, () => [32 + (r() - 0.5) * 50, 32 + (r() - 0.5) * 50, 1 + r() * 3]);
  return paint(S, S, (x, y, i) => {
    const d = Math.hypot(x - 32, y - 32);
    let a = clamp01((14 + (n[i] - 0.5) * 18 - d) / 4);
    for (const [dx, dy, dr] of drops) if (Math.hypot(x - dx, y - dy) < dr) a = 1;
    return [110 + n[i] * 30, 6, 6, a * 230];
  });
}

// burnt patch left by an HE grenade
function scorch() {
  const S = 64;
  const n = fbm(S, S, 4, 4, 1201);
  return paint(S, S, (x, y, i) => {
    const d = Math.hypot(x - 31.5, y - 31.5) / 32;
    const a = clamp01((1 - d * (1.1 + (n[i] - 0.5) * 0.9)) * 1.7);
    return [16 + n[i] * 14, 13 + n[i] * 10, 10, a * 235];
  });
}

// HE fireball: a hot core breaking up into ragged flame at the edges
function fireball() {
  const S = 64;
  const n = fbm(S, S, 4, 4, 1301), m = fbm(S, S, 8, 2, 1302);
  return paint(S, S, (x, y, i) => {
    const d = Math.hypot(x - 31.5, y - 31.5) / 32;
    const edge = 1 - d * (1.05 + (n[i] - 0.5) * 1.1);
    const a = clamp01(edge * 2.2);
    const heat = clamp01(edge * 1.6 + (m[i] - 0.5) * 0.5);
    return [255, 120 + 135 * heat, 40 + 170 * heat * heat, 255 * a];
  });
}

function smoke() {
  const S = 64;
  const n = fbm(S, S, 3, 4, 1001);
  return paint(S, S, (x, y, i) => {
    const d = Math.hypot(x - 31.5, y - 31.5) / 32;
    const a = clamp01(1 - d * (1.1 + (n[i] - 0.5) * 0.9));
    return [255, 255, 255, a * a * 255 * (0.6 + n[i] * 0.6)];
  });
}

function flash() {
  const S = 64;
  const n = fbm(S, S, 4, 2, 1101);
  return paint(S, S, (x, y, i) => {
    const dx = x - 31.5, dy = y - 31.5;
    const d = Math.hypot(dx, dy) / 32;
    const a = Math.atan2(dy, dx);
    const rays = 0.45 + 0.55 * Math.pow(Math.abs(Math.cos(a * 4 + n[i])), 4);
    let v = Math.max(0, 1 - d / rays);
    v = v * v;
    const core = Math.max(0, 1 - d * 4);
    return [255, 190 + 65 * core + 0 * v, 80 * v + 175 * core, 255 * Math.min(1, v * 1.5 + core)];
  });
}

function particle() {
  return paint(16, 16, (x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5) / 8;
    return [255, 255, 255, 255 * clamp01(1.4 - d * 1.5)];
  });
}

// ---------------- characters and weapons ----------------

function camo(base, dark, light, seed) {
  const S = 64;
  const a = fbm(S, S, 4, 3, seed), b = fbm(S, S, 4, 3, seed + 50), g = fbm(S, S, 32, 1, seed + 99);
  return paint(S, S, (x, y, i) => {
    let col = base;
    if (a[i] > 0.6) col = dark;
    else if (b[i] > 0.62) col = light;
    // fabric weave
    const weave = ((x + y) & 1) ? 1.03 : 0.97;
    return mul(col, (0.9 + g[i] * 0.2) * weave);
  });
}

function vest(base, seed) {
  const S = 64;
  const n = fbm(S, S, 8, 3, seed);
  return paint(S, S, (x, y, i) => {
    let s = 0.85 + n[i] * 0.3;
    const ry = y % 10;
    if (ry === 0) s *= 0.7; else if (ry === 1) s *= 1.15; // MOLLE webbing
    if (x % 16 === 0) s *= 0.75; // stitching
    return mul(base, s);
  });
}

// Head textures wrap around a sphere; the face is centred at u = 0.25.
function headT() {
  const W = 128, H = 64, n = fbm(W, H, 16, 2, 1210);
  return paint(W, H, (x, y, i) => {
    const knit = 0.88 + n[i] * 0.24 + ((x + (y >> 1)) & 1 ? 0.03 : -0.03);
    const fx = x - 32;
    if (y >= 25 && y <= 33 && Math.abs(fx) <= 14) {
      const ey = (y - 29) / 3.6;
      const eL = Math.hypot((fx + 6) / 4, ey), eR = Math.hypot((fx - 6) / 4, ey);
      if (eL < 0.5 || eR < 0.5) return [26, 20, 16];
      if (eL < 0.85 || eR < 0.85) return [226, 222, 214];
      return mul([180, 134, 102], 0.92 + n[i] * 0.16);
    }
    if (y >= 42 && y <= 45 && Math.abs(fx) <= 3) return [18, 16, 16];
    return mul([42, 40, 38], knit);
  });
}

function headCT() {
  const W = 128, H = 64, n = fbm(W, H, 16, 2, 1310);
  return paint(W, H, (x, y, i) => {
    const fx = x - 32;
    const face = Math.abs(fx) <= 18 && y >= 14;
    let col = face ? mul([206, 162, 130], 0.92 + n[i] * 0.14) : mul([46, 40, 36], 0.9 + n[i] * 0.2);
    if (y >= 19 && y <= 27) {
      if (y >= 20 && y <= 26 && (Math.abs(fx + 6) <= 5 || Math.abs(fx - 6) <= 5)) return mul([60, 92, 100], y < 22 ? 1.5 : 1);
      return [26, 26, 28]; // goggle strap all round
    }
    if (face) {
      if (y >= 28 && y <= 29) col = mul(col, 0.82);
      if (y >= 31 && y <= 39 && Math.abs(fx) <= 2) col = mul(col, 0.88);
      if (y >= 44 && y <= 45 && Math.abs(fx) <= 5) col = [132, 80, 70];
      if (y >= 52) col = mix(col, [44, 50, 62], 0.85);
    }
    return col;
  });
}

function metal(base, seed, brushed = false) {
  const S = 64, n = fbm(S, S, 8, 3, seed), g = fbm(S, S, 32, 1, seed + 1);
  return paint(S, S, (x, y, i) => {
    let s = 0.88 + n[i] * 0.2 + (g[i] - 0.5) * 0.08;
    if (brushed) s += Math.sin(y * 2.7 + n[i] * 4) * 0.04;
    return mul(base, s);
  });
}

function gunWood() {
  const S = 64, n = fbm(S, S, 4, 3, 1401), g = fbm(S, S, 32, 1, 1402);
  return paint(S, S, (x, y, i) => {
    const grain = Math.sin(y * 0.7 + n[i] * 14);
    const s = 0.86 + grain * 0.08 + (g[i] - 0.5) * 0.12;
    return mul([116, 68, 40], s);
  });
}

export function createTextures() {
  return {
    floor: tex(floor()),
    wall: tex(wall()),
    trim: tex(trim()),
    crate: tex(crate()),
    mcrate: tex(mcrate()),
    concrete: tex(concrete()),
    barrel: tex(barrel()),
    sand: tex(sand()),
    paving: tex(paving()),
    sandstone: tex(sandstone()),
    plaster: tex(plasterTex([206, 178, 134], 2311)),
    plasterB: tex(plasterTex([224, 214, 194], 2321)),
    planks: tex(planks()),
    stoneTrim: tex(stoneTrim()),
    glass: tex(glass()),
    grate: tex(grate()),
    palmTrunk: tex(palmTrunk()),
    palmLeaf: tex(palmLeaf(), { wrap: false }),
    sky: sky(),
    skyDesert: skyDesert(),
    // de_foundry
    factoryFloor: tex(factoryFloor()),
    asphalt: tex(asphalt()),
    brick: tex(brick([142, 72, 52], 3301)),
    corrugated: tex(corrugated([124, 136, 146], 3311)),
    corrugatedB: tex(corrugated([150, 144, 128], 3321)),
    steel: tex(steel([72, 84, 96], 3331)),
    steelYellow: tex(steel([196, 156, 44], 3341)),
    plate: tex(plate()),
    hazard: tex(hazard()),
    containerRed: tex(containerTex([150, 54, 40], 3351)),
    containerBlue: tex(containerTex([44, 82, 128], 3361)),
    containerGreen: tex(containerTex([62, 104, 66], 3371)),
    doorMetal: tex(doorMetal()),
    doorWood: tex(doorWood()),
    ladder: tex(steel([86, 90, 96], 3381)),
    skyIndustrial: skyIndustrial(),
    // fy_poolhouse
    poolTile: tex(poolTile()),
    deck: tex(deck()),
    water: tex(water()),
    stucco: tex(plasterTex([234, 226, 210], 4001, false)),
    stuccoB: tex(plasterTex([218, 200, 168], 4011, false)),
    grass: tex(grass()),
    roofTile: tex(roofTile()),
    parquet: tex(parquet()),
    // awp_rooftops
    roofTar: tex(roofTar()),
    brickCity: tex(brick([136, 84, 66], 4511)),
    facade: tex(facade()),
    ventBox: tex(ventBox()),
    skySunset: skySunset(),
    holeConcrete: tex(hole('concrete'), { wrap: false }),
    holeWood: tex(hole('wood'), { wrap: false }),
    holeMetal: tex(hole('metal'), { wrap: false }),
    blood: tex(blood(), { wrap: false }),
    scorch: tex(scorch(), { wrap: false }),
    smoke: tex(smoke(), { wrap: false }),
    flash: tex(flash(), { wrap: false }),
    fireball: tex(fireball(), { wrap: false }),
    particle: tex(particle(), { wrap: false }),
    camoT: tex(camo([152, 132, 98], [108, 90, 62], [182, 166, 128], 1501)),
    camoCT: tex(camo([66, 74, 92], [40, 46, 60], [100, 108, 124], 1601)),
    vestT: tex(vest([86, 70, 48], 1701)),
    vestCT: tex(vest([36, 40, 48], 1801)),
    headT: tex(headT()),
    headCT: tex(headCT()),
    gunmetal: tex(metal([56, 56, 60], 1901)),
    polymer: tex(metal([34, 34, 36], 1902)),
    silver: tex(metal([176, 176, 182], 1903, true)),
    awpGreen: tex(metal([66, 90, 60], 1904)),
    gunWood: tex(gunWood()),
  };
}

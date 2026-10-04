// GoldSrc-style baked lighting. Every visible box face gets a grid of luxels
// lit by the sun (with shadows), the sky (with ambient occlusion) and a bit of
// warm bounce light. The result is packed into one lightmap atlas.
// Optional per map: `indoor` (how much sky light is left under a roof, 0..1)
// and `lamps` ([x, y, z, r, g, b, radius] point lights with shadows).

import * as THREE from '../lib/three.module.js';

const LUX = 8; // world units per luxel (GoldSrc used 16); a big map can ask for more
// default light; a map can bring its own sun
export const DEFAULT_LIGHT = {
  sunDir: [0.42, 0.86, 0.3],
  sun: [1.16, 1.04, 0.84],
  sky: [0.29, 0.34, 0.44],
  bounce: [0.2, 0.15, 0.1],
  maxY: 400,
};
const AO_RAYS = 14;
const AO_DIST = 150;
const GRID = 64;

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Ray vs box (min/max arrays). Returns hit distance or -1. Origin inside = miss.
function rayBox(ox, oy, oz, dx, dy, dz, mn, mx, maxT) {
  let t0 = 0, t1 = maxT;
  for (let a = 0; a < 3; a++) {
    const o = a === 0 ? ox : a === 1 ? oy : oz;
    const d = a === 0 ? dx : a === 1 ? dy : dz;
    if (Math.abs(d) < 1e-9) {
      if (o <= mn[a] || o >= mx[a]) return -1;
    } else {
      let ta = (mn[a] - o) / d, tb = (mx[a] - o) / d;
      if (ta > tb) { const q = ta; ta = tb; tb = q; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
  }
  if (t0 <= 0) return -1; // starts inside or behind
  return t0;
}

function insideAny(x, y, z, list, boxes) {
  for (const k of list) {
    const b = boxes[k];
    if (x > b.min[0] && x < b.max[0] && y > b.min[1] && y < b.max[1] && z > b.min[2] && z < b.max[2]) return true;
  }
  return false;
}

// Spatial lookup: boxes whose XZ footprint is within `margin` of each cell.
function buildGrid(boxes, bounds, margin) {
  const nx = Math.ceil((bounds.maxX - bounds.minX) / GRID), nz = Math.ceil((bounds.maxZ - bounds.minZ) / GRID);
  const cells = Array.from({ length: nx * nz }, () => []);
  boxes.forEach((b, k) => {
    const i0 = Math.max(0, Math.floor((b.min[0] - margin - bounds.minX) / GRID));
    const i1 = Math.min(nx - 1, Math.floor((b.max[0] + margin - bounds.minX) / GRID));
    const j0 = Math.max(0, Math.floor((b.min[2] - margin - bounds.minZ) / GRID));
    const j1 = Math.min(nz - 1, Math.floor((b.max[2] + margin - bounds.minZ) / GRID));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * nx + i].push(k);
  });
  return (x, z) => {
    const i = Math.max(0, Math.min(nx - 1, Math.floor((x - bounds.minX) / GRID)));
    const j = Math.max(0, Math.min(nz - 1, Math.floor((z - bounds.minZ) / GRID)));
    return cells[j * nx + i];
  };
}

// Cosine-weighted hemisphere directions around +Z (rotated per luxel).
const HEMI = [];
for (let i = 0; i < AO_RAYS; i++) {
  const u = (i + 0.5) / AO_RAYS;
  const r = Math.sqrt(u), a = i * 2.39996323; // golden angle
  HEMI.push([r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - u)]);
}

// faces: { n:[x,y,z], A:[x,y,z], U:[unit], V:[unit], w, h }
// boxes: what casts shadows; light: see DEFAULT_LIGHT
export function bakeLightmaps(faces, boxes, bounds, light = DEFAULT_LIGHT) {
  const SUN_DIR = norm(light.sunDir), SUN = light.sun, SKY = light.sky, BOUNCE = light.bounce, TOP = light.maxY;
  const near = buildGrid(boxes, bounds, AO_DIST + 8);
  const far = buildGrid(boxes, bounds, 260);
  const INDOOR = light.indoor ?? 1;
  const lux = light.lux ?? LUX;
  const blockedBy = (list, px, py, pz, dx, dy, dz, maxT) => {
    for (const kb of list) {
      const b = boxes[kb];
      if (rayBox(px, py, pz, dx, dy, dz, b.min, b.max, maxT) > 0) return true;
    }
    return false;
  };
  // each lamp only needs the boxes inside its reach
  const lamps = (light.lamps || []).map((L) => {
    const [x, y, z, , , , r] = L;
    const list = [];
    boxes.forEach((b, k) => {
      const dx = Math.max(b.min[0] - x, 0, x - b.max[0]), dy = Math.max(b.min[1] - y, 0, y - b.max[1]), dz = Math.max(b.min[2] - z, 0, z - b.max[2]);
      if (dx * dx + dy * dy + dz * dz < r * r) list.push(k);
    });
    return { L, list };
  });
  // sky seen from a point: straight up, then four tilted rays (as far as the
  // shadow grid reaches) if a roof is overhead
  const TILT = [[0.55, 0.835, 0], [-0.55, 0.835, 0], [0, 0.835, 0.55], [0, 0.835, -0.55]];
  const skyOpen = (px, py, pz, list) => {
    if (!blockedBy(list, px, py, pz, 0, 1, 0, Math.max(10, TOP - py))) return 1;
    let open = 0;
    for (const [dx, dy, dz] of TILT) if (!blockedBy(list, px, py, pz, dx, dy, dz, Math.min(440, Math.max(10, (TOP - py) / dy)))) open += 0.25;
    return open * 0.6;
  };
  const rand = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

  // 1. luxel grids
  for (const f of faces) {
    f.nu = Math.max(1, Math.round(f.w / lux)) + 1;
    f.nv = Math.max(1, Math.round(f.h / lux)) + 1;
    f.lu = f.w / (f.nu - 1);
    f.lv = f.h / (f.nv - 1);
    f.data = new Float32Array(f.nu * f.nv * 3);
    f.valid = new Uint8Array(f.nu * f.nv);
  }

  // 2. light every luxel
  for (const f of faces) {
    const [nx, ny, nz] = f.n;
    const ndl = nx * SUN_DIR[0] + ny * SUN_DIR[1] + nz * SUN_DIR[2];
    // tangent frame for the hemisphere rays
    const T = f.U, B = f.V;
    for (let j = 0; j < f.nv; j++) {
      for (let i = 0; i < f.nu; i++) {
        const k = j * f.nu + i;
        const du = Math.min(i * f.lu, f.w - 0.25) + (i === 0 ? 0.25 : 0);
        const dv = Math.min(j * f.lv, f.h - 0.25) + (j === 0 ? 0.25 : 0);
        const px = f.A[0] + f.U[0] * du + f.V[0] * dv + nx * 0.5;
        const py = f.A[1] + f.U[1] * du + f.V[1] * dv + ny * 0.5;
        const pz = f.A[2] + f.U[2] * du + f.V[2] * dv + nz * 0.5;
        const nearList = near(px, pz);
        if (insideAny(px, py, pz, nearList, boxes)) continue;
        f.valid[k] = 1;

        // sun with a few jittered rays for a soft edge
        let sun = 0;
        if (ndl > 0) {
          const farList = far(px, pz);
          const rays = 3;
          for (let s = 0; s < rays; s++) {
            const jx = SUN_DIR[0] + (rand() - 0.5) * 0.05, jy = SUN_DIR[1] + (rand() - 0.5) * 0.05, jz = SUN_DIR[2] + (rand() - 0.5) * 0.05;
            const l = Math.hypot(jx, jy, jz);
            const maxT = Math.max(10, (TOP - py) / (jy / l));
            let blocked = false;
            for (const kb of farList) {
              const b = boxes[kb];
              if (rayBox(px, py, pz, jx / l, jy / l, jz / l, b.min, b.max, maxT) > 0) { blocked = true; break; }
            }
            if (!blocked) sun += 1 / rays;
          }
          sun *= ndl;
        }

        // sky visibility (ambient occlusion)
        let occ = 0;
        const rot = rand() * Math.PI * 2, cr = Math.cos(rot), sr = Math.sin(rot);
        for (const h of HEMI) {
          const hx = h[0] * cr - h[1] * sr, hy = h[0] * sr + h[1] * cr, hz = h[2];
          const dx = T[0] * hx + B[0] * hy + nx * hz;
          const dy = T[1] * hx + B[1] * hy + ny * hz;
          const dz = T[2] * hx + B[2] * hy + nz * hz;
          let best = AO_DIST;
          for (const kb of nearList) {
            const b = boxes[kb];
            const t = rayBox(px, py, pz, dx, dy, dz, b.min, b.max, best);
            if (t > 0 && t < best) best = t;
          }
          if (best < AO_DIST) occ += 1 - best / AO_DIST;
        }
        let ao = 1 - occ / AO_RAYS;
        // under a roof most of the sky is gone
        if (INDOOR < 1) ao *= INDOOR + (1 - INDOOR) * skyOpen(px, py, pz, far(px, pz));
        const sky = ao * (0.55 + 0.45 * ny);
        const bounce = ao * Math.max(0, 0.55 - ny * 0.55);
        const o = k * 3;
        for (let c = 0; c < 3; c++) f.data[o + c] = SUN[c] * sun + SKY[c] * sky + BOUNCE[c] * bounce;
        // lamps: soft falloff, lit only where they can be seen
        if (lamps.length) {
          for (const { L, list } of lamps) {
            const lx = L[0] - px, ly = L[1] - py, lz = L[2] - pz;
            const d = Math.hypot(lx, ly, lz);
            if (d >= L[6] || d < 1) continue;
            const ndl2 = (lx * nx + ly * ny + lz * nz) / d;
            if (ndl2 <= 0) continue;
            if (blockedBy(list, px, py, pz, lx / d, ly / d, lz / d, d - 6)) continue;
            const a = 1 - d / L[6];
            const e = a * a * (0.35 + 0.65 * ndl2);
            f.data[o] += L[3] * e;
            f.data[o + 1] += L[4] * e;
            f.data[o + 2] += L[5] * e;
          }
        }
      }
    }
    fillAndBlur(f);
  }

  // 3. pack into an atlas (shelf packing, 1px border on each face)
  const sorted = [...faces].sort((a, b) => b.nv - a.nv);
  const W = 1024;
  let x = 0, y = 0, rowH = 0;
  for (const f of sorted) {
    const w = f.nu + 2, h = f.nv + 2;
    if (x + w > W) { x = 0; y += rowH; rowH = 0; }
    f.ax = x;
    f.ay = y;
    x += w;
    rowH = Math.max(rowH, h);
  }
  const H = Math.max(4, 1 << Math.ceil(Math.log2(y + rowH)));
  const pixels = new Uint8Array(W * H * 4);
  const enc = (v) => Math.max(0, Math.min(255, Math.round(Math.sqrt(v / 2) * 255)));
  for (const f of faces) {
    for (let j = -1; j <= f.nv; j++) {
      for (let i = -1; i <= f.nu; i++) {
        const si = Math.max(0, Math.min(f.nu - 1, i)), sj = Math.max(0, Math.min(f.nv - 1, j));
        const o = (sj * f.nu + si) * 3;
        const p = ((f.ay + 1 + j) * W + (f.ax + 1 + i)) * 4;
        pixels[p] = enc(f.data[o]);
        pixels[p + 1] = enc(f.data[o + 1]);
        pixels[p + 2] = enc(f.data[o + 2]);
        pixels[p + 3] = 255;
      }
    }
  }
  const texture = new THREE.DataTexture(pixels, W, H, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, W, H };
}

// Invalid luxels (inside other boxes) take their neighbours' light, then a
// light blur hides the per-luxel noise.
function fillAndBlur(f) {
  const { nu, nv, data, valid } = f;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const k = j * nu + i;
        if (valid[k]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nu || jj >= nv) continue;
          const kk = jj * nu + ii;
          if (valid[kk] !== 1) continue;
          r += data[kk * 3]; g += data[kk * 3 + 1]; b += data[kk * 3 + 2]; n++;
        }
        if (n) {
          data[k * 3] = r / n * 0.8; data[k * 3 + 1] = g / n * 0.8; data[k * 3 + 2] = b / n * 0.8;
          valid[k] = 2;
          changed = true;
        }
      }
    }
    for (let k = 0; k < valid.length; k++) if (valid[k] === 2) valid[k] = 1;
    if (!changed) break;
  }
  const src = data.slice();
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nu || jj >= nv) continue;
        const wgt = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1;
        const kk = (jj * nu + ii) * 3;
        r += src[kk] * wgt; g += src[kk + 1] * wgt; b += src[kk + 2] * wgt; wsum += wgt;
      }
      const k = (j * nu + i) * 3;
      data[k] = r / wsum; data[k + 1] = g / wsum; data[k + 2] = b / wsum;
    }
  }
}

// Light at a point on an upward face (for lighting models like GoldSrc does).
export function sampleFace(f, x, y, z) {
  const rx = x - f.A[0], ry = y - f.A[1], rz = z - f.A[2];
  const u = (rx * f.U[0] + ry * f.U[1] + rz * f.U[2]) / f.lu;
  const v = (rx * f.V[0] + ry * f.V[1] + rz * f.V[2]) / f.lv;
  const i0 = Math.max(0, Math.min(f.nu - 1, Math.floor(u))), j0 = Math.max(0, Math.min(f.nv - 1, Math.floor(v)));
  const i1 = Math.min(f.nu - 1, i0 + 1), j1 = Math.min(f.nv - 1, j0 + 1);
  const tu = Math.max(0, Math.min(1, u - i0)), tv = Math.max(0, Math.min(1, v - j0));
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = f.data[(j0 * f.nu + i0) * 3 + c], b = f.data[(j0 * f.nu + i1) * 3 + c];
    const cc = f.data[(j1 * f.nu + i0) * 3 + c], d = f.data[(j1 * f.nu + i1) * 3 + c];
    out[c] = (a + (b - a) * tu) * (1 - tv) + (cc + (d - cc) * tu) * tv;
  }
  return out;
}

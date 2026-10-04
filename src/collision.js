// Axis-aligned world collision. Player hulls are swept as points against
// boxes expanded by the hull size (Minkowski sum), like GoldSrc clip hulls.
// Boxes are bucketed in a grid over the floor plan so big maps stay fast.
// A box with `off` set (a broken window or crate) no longer collides;
// `seeThrough` boxes (glass) stop bullets and players but not sight, and
// `clip` boxes (invisible player clips) stop only players. A box that moves
// (a sliding door) gives its whole travel as `reach` so the grid can find it.

import { HULL } from './config.js';

const DIST_EPSILON = 0.03125;
const CELL = 128;

// Result of the last sweep() call (avoids allocating in the hot path).
let sT = 0, sAxis = -1, sSign = 0;

// Returns 0 = miss, 1 = hit (sT/sAxis/sSign set), 2 = started inside.
function sweep(sx, sy, sz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tEnter = -Infinity, tExit = Infinity, axis = -1, sign = 0, t1, t2, s, inv;
  if (dx === 0) {
    if (sx <= x0 || sx >= x1) return 0;
  } else {
    inv = 1 / dx; t1 = (x0 - sx) * inv; t2 = (x1 - sx) * inv; s = -1;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
    if (t1 > tEnter) { tEnter = t1; axis = 0; sign = s; }
    if (t2 < tExit) tExit = t2;
  }
  if (dy === 0) {
    if (sy <= y0 || sy >= y1) return 0;
  } else {
    inv = 1 / dy; t1 = (y0 - sy) * inv; t2 = (y1 - sy) * inv; s = -1;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
    if (t1 > tEnter) { tEnter = t1; axis = 1; sign = s; }
    if (t2 < tExit) tExit = t2;
  }
  if (dz === 0) {
    if (sz <= z0 || sz >= z1) return 0;
  } else {
    inv = 1 / dz; t1 = (z0 - sz) * inv; t2 = (z1 - sz) * inv; s = -1;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
    if (t1 > tEnter) { tEnter = t1; axis = 2; sign = s; }
    if (t2 < tExit) tExit = t2;
  }
  if (tEnter > tExit || tExit <= 0 || tEnter >= 1) return 0;
  if (tEnter < 0) return 2;
  sT = tEnter; sAxis = axis; sSign = sign;
  return 1;
}

export class World {
  constructor(boxes) {
    this.boxes = boxes; // { min: [x,y,z], max: [x,y,z], mat, off?, seeThrough? }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const b of boxes) {
      const r = b.reach || b;
      x0 = Math.min(x0, r.min[0]); z0 = Math.min(z0, r.min[2]);
      x1 = Math.max(x1, r.max[0]); z1 = Math.max(z1, r.max[2]);
    }
    if (!boxes.length) x0 = z0 = x1 = z1 = 0;
    this.gx = Math.floor(x0 / CELL) * CELL;
    this.gz = Math.floor(z0 / CELL) * CELL;
    this.nx = Math.max(1, Math.ceil((x1 - this.gx) / CELL));
    this.nz = Math.max(1, Math.ceil((z1 - this.gz) / CELL));
    this.cells = Array.from({ length: this.nx * this.nz }, () => []);
    boxes.forEach((b, k) => {
      const r = b.reach || b;
      const [i0, i1, j0, j1] = this.range(r.min[0], r.min[2], r.max[0], r.max[2]);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cells[j * this.nx + i].push(k);
    });
    this.mark = new Uint32Array(boxes.length);
    this.stamp = 0;
  }

  // grid cells covering an XZ rectangle: [i0, i1, j0, j1] (clamped)
  range(ax, az, bx, bz) {
    const i0 = Math.max(0, Math.min(this.nx - 1, Math.floor((ax - this.gx) / CELL)));
    const i1 = Math.max(0, Math.min(this.nx - 1, Math.floor((bx - this.gx) / CELL)));
    const j0 = Math.max(0, Math.min(this.nz - 1, Math.floor((az - this.gz) / CELL)));
    const j1 = Math.max(0, Math.min(this.nz - 1, Math.floor((bz - this.gz) / CELL)));
    return [i0, i1, j0, j1];
  }

  nextStamp() {
    if (++this.stamp > 0xfffffff0) {
      this.mark.fill(0);
      this.stamp = 1;
    }
    return this.stamp;
  }

  // Sweep a player hull (feet origin) from s to e. `others` are players
  // to collide with. Writes into `out` and returns it.
  traceHull(sx, sy, sz, ex, ey, ez, h, others, out = {}) {
    const dx = ex - sx, dy = ey - sy, dz = ez - sz, r = HULL.radius;
    let best = 1, ax = -1, sg = 0, solid = false, ent = null;
    const boxes = this.boxes, cells = this.cells, mark = this.mark, st = this.nextStamp();
    const [i0, i1, j0, j1] = this.range(Math.min(sx, ex) - r - 1, Math.min(sz, ez) - r - 1, Math.max(sx, ex) + r + 1, Math.max(sz, ez) + r + 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cell = cells[j * this.nx + i];
        for (let c = 0; c < cell.length; c++) {
          const k = cell[c];
          if (mark[k] === st) continue;
          mark[k] = st;
          const b = boxes[k];
          if (b.off) continue;
          const mn = b.min, mx = b.max;
          const res = sweep(sx, sy, sz, dx, dy, dz, mn[0] - r, mn[1] - h, mn[2] - r, mx[0] + r, mx[1], mx[2] + r);
          if (res === 1) {
            if (sT < best) { best = sT; ax = sAxis; sg = sSign; ent = null; }
          } else if (res === 2) solid = true;
        }
      }
    }
    if (others) {
      const rr = r + HULL.radius;
      for (let i = 0; i < others.length; i++) {
        const o = others[i], p = o.pos;
        const res = sweep(sx, sy, sz, dx, dy, dz, p.x - rr, p.y - h, p.z - rr, p.x + rr, p.y + o.height(), p.z + rr);
        if (res === 1) {
          if (sT < best) { best = sT; ax = sAxis; sg = sSign; ent = o; }
        } else if (res === 2) solid = true;
      }
    }
    out.frac = best;
    out.startSolid = solid;
    out.hitPlayer = ent;
    out.x = sx + dx * best;
    out.y = sy + dy * best;
    out.z = sz + dz * best;
    out.nx = out.ny = out.nz = 0;
    if (ax === 0) { out.nx = sg; out.x += sg * DIST_EPSILON; }
    else if (ax === 1) { out.ny = sg; out.y += sg * DIST_EPSILON; }
    else if (ax === 2) { out.nz = sg; out.z += sg * DIST_EPSILON; }
    return out;
  }

  hullFits(x, y, z, h, others, r = HULL.radius) {
    const boxes = this.boxes, cells = this.cells, mark = this.mark, st = this.nextStamp();
    const [i0, i1, j0, j1] = this.range(x - r - 1, z - r - 1, x + r + 1, z + r + 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cell = cells[j * this.nx + i];
        for (let c = 0; c < cell.length; c++) {
          const k = cell[c];
          if (mark[k] === st) continue;
          mark[k] = st;
          const b = boxes[k];
          if (b.off) continue;
          const mn = b.min, mx = b.max;
          if (x + r > mn[0] && x - r < mx[0] && y + h > mn[1] && y < mx[1] && z + r > mn[2] && z - r < mx[2]) return false;
        }
      }
    }
    if (others) {
      for (let i = 0; i < others.length; i++) {
        const o = others[i], p = o.pos, rr = r + HULL.radius;
        if (Math.abs(x - p.x) < rr && Math.abs(z - p.z) < rr && y + h > p.y && y < p.y + o.height()) return false;
      }
    }
    return true;
  }

  // Boxes whose footprint touches an XZ rectangle (calls fn(box)).
  each(ax, az, bx, bz, fn) {
    const boxes = this.boxes, cells = this.cells, mark = this.mark, st = this.nextStamp();
    const [i0, i1, j0, j1] = this.range(ax, az, bx, bz);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cell = cells[j * this.nx + i];
        for (let c = 0; c < cell.length; c++) {
          const k = cell[c];
          if (mark[k] === st) continue;
          mark[k] = st;
          if (!boxes[k].off) fn(boxes[k]);
        }
      }
    }
  }

  // Bullet / line-of-sight ray against world geometry only. dir must be normalized.
  // sight: see through glass. Walks the grid cells along the ray (2D DDA).
  traceRay(ox, oy, oz, dx, dy, dz, maxDist, sight = false) {
    const Dx = dx * maxDist, Dy = dy * maxDist, Dz = dz * maxDist;
    let best = 1, hit = null, ax = -1, sg = 0;
    const boxes = this.boxes, cells = this.cells, mark = this.mark, st = this.nextStamp(), nx = this.nx, nz = this.nz;
    // clip the ray to the grid's rectangle
    let t0 = 0, t1 = 1;
    const gx1 = this.gx + nx * CELL, gz1 = this.gz + nz * CELL;
    if (Dx === 0) {
      if (ox < this.gx || ox > gx1) return null;
    } else {
      let a = (this.gx - ox) / Dx, b = (gx1 - ox) / Dx;
      if (a > b) { const q = a; a = b; b = q; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    if (Dz === 0) {
      if (oz < this.gz || oz > gz1) return null;
    } else {
      let a = (this.gz - oz) / Dz, b = (gz1 - oz) / Dz;
      if (a > b) { const q = a; a = b; b = q; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    if (t0 > t1) return null;
    const px = ox + Dx * t0, pz = oz + Dz * t0;
    let i = Math.max(0, Math.min(nx - 1, Math.floor((px - this.gx) / CELL)));
    let j = Math.max(0, Math.min(nz - 1, Math.floor((pz - this.gz) / CELL)));
    const stepI = Dx > 0 ? 1 : -1, stepJ = Dz > 0 ? 1 : -1;
    const dI = Dx !== 0 ? Math.abs(CELL / Dx) : Infinity, dJ = Dz !== 0 ? Math.abs(CELL / Dz) : Infinity;
    let tI = Dx !== 0 ? (this.gx + (i + (Dx > 0 ? 1 : 0)) * CELL - ox) / Dx : Infinity;
    let tJ = Dz !== 0 ? (this.gz + (j + (Dz > 0 ? 1 : 0)) * CELL - oz) / Dz : Infinity;
    for (let guard = 0; guard < 4096; guard++) {
      const cell = cells[j * nx + i];
      for (let c = 0; c < cell.length; c++) {
        const k = cell[c];
        if (mark[k] === st) continue;
        mark[k] = st;
        const b = boxes[k];
        // player clips stop players only
        if (b.off || b.clip || (sight && b.seeThrough)) continue;
        const mn = b.min, mx = b.max;
        if (sweep(ox, oy, oz, Dx, Dy, Dz, mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]) === 1 && sT < best) {
          best = sT; hit = b; ax = sAxis; sg = sSign;
        }
      }
      // anything hit before the ray leaves this cell can't be beaten further on
      const tNext = Math.min(tI, tJ);
      if (best <= tNext || tNext >= t1) break;
      if (tI < tJ) {
        i += stepI;
        tI += dI;
        if (i < 0 || i >= nx) break;
      } else {
        j += stepJ;
        tJ += dJ;
        if (j < 0 || j >= nz) break;
      }
    }
    if (!hit) return null;
    const t = best * maxDist;
    return {
      t, box: hit,
      x: ox + dx * t, y: oy + dy * t, z: oz + dz * t,
      nx: ax === 0 ? sg : 0, ny: ax === 1 ? sg : 0, nz: ax === 2 ? sg : 0,
    };
  }

  // Can a see b? Glass doesn't block sight.
  visible(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1) return true;
    return this.traceRay(ax, ay, az, dx / len, dy / len, dz / len, len, true) === null;
  }

  // Distance a ray travels inside box b, starting from a point on/inside it.
  exitDistance(b, px, py, pz, dx, dy, dz) {
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (b.max[0] - px) / dx); else if (dx < 0) t = Math.min(t, (b.min[0] - px) / dx);
    if (dy > 0) t = Math.min(t, (b.max[1] - py) / dy); else if (dy < 0) t = Math.min(t, (b.min[1] - py) / dy);
    if (dz > 0) t = Math.min(t, (b.max[2] - pz) / dz); else if (dz < 0) t = Math.min(t, (b.min[2] - pz) / dz);
    return Math.max(0, t);
  }
}

// Bot navigation: walkable spots on a grid over the floor plan, generated from
// the collision boxes, with A* path finding. A grid cell can hold several
// spots at different heights (a street and a rooftop above it). Neighbours
// connect when the step up is small enough to walk (stairs) or the drop is
// safe to jump down. Ladders add links between their foot and their top.

import { HULL, PM } from './config.js';

const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];
const CLEAR = HULL.radius + 1; // room a spot needs around it
// a floor only holds you up if it's really under the hull (2 units of overlap,
// not just touching the edge: a thin wall top beside you is no floor)
const STAND = HULL.radius - 2;
const MAX_DROP = 150;          // never take a drop that hurts
// where in a cell to try a spot: the middle, then a little to the side (so a
// doorway that isn't lined up with the grid still gets a spot)
const OFFSETS = [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8], [8, 8], [-8, 8], [8, -8], [-8, -8]];
const tr = {};

// is there floor at height y under a player standing at (x, z)?
function floorAt(world, x, y, z, maxY) {
  let ok = false;
  world.each(x - CLEAR, z - CLEAR, x + CLEAR, z + CLEAR, (b) => {
    if (ok || b.seeThrough || b.breakable || b.noFloor || b.max[1] > maxY || b.max[1] !== y) return;
    if (x + STAND > b.min[0] && x - STAND < b.max[0] && z + STAND > b.min[2] && z - STAND < b.max[2]) ok = true;
  });
  return ok;
}

export class NavGrid {
  // maxY: nothing higher than this is a floor anyone can reach (rooftops)
  constructor(world, bounds, cell = 32, maxY = Infinity, ladders = []) {
    this.world = world;
    this.cell = cell;
    this.ox = bounds.minX;
    this.oz = bounds.minZ;
    this.nx = Math.floor((bounds.maxX - bounds.minX) / cell);
    this.nz = Math.floor((bounds.maxZ - bounds.minZ) / cell);
    // spots: x, y, z per node; cellNodes: first node index per cell (+ count)
    const xs = [], ys = [], zs = [], cellOf = [];
    this.cellStart = new Int32Array(this.nx * this.nz + 1);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i;
        this.cellStart[k] = xs.length;
        const x = this.cx(i), z = this.cz(j);
        // every top surface under a player standing here is a candidate floor
        // (the edge of a stair step holds you up just as well as its middle)
        const tops = new Set();
        world.each(x - CLEAR - 8, z - CLEAR - 8, x + CLEAR + 8, z + CLEAR + 8, (b) => {
          if (b.seeThrough || b.breakable || b.noFloor || b.max[1] > maxY) return;
          // within reach of the cell's spot or one shifted a little to the side
          if (x + STAND + 8 > b.min[0] && x - STAND - 8 < b.max[0] && z + STAND + 8 > b.min[2] && z - STAND - 8 < b.max[2]) tops.add(b.max[1]);
        });
        for (const y of [...tops].sort((a, b) => a - b)) {
          for (const [ox, oz] of OFFSETS) {
            const px = x + ox, pz = z + oz;
            if (!world.hullFits(px, y + 0.5, pz, HULL.stand, null, CLEAR)) continue;
            if (!floorAt(world, px, y, pz, maxY)) continue;
            xs.push(px); ys.push(y); zs.push(pz); cellOf.push(k);
            break;
          }
        }
      }
    }
    this.cellStart[this.nx * this.nz] = xs.length;
    const n = xs.length;
    this.n = n;
    this.x = Float32Array.from(xs);
    this.y = Float32Array.from(ys);
    this.z = Float32Array.from(zs);
    this.cellOf = Int32Array.from(cellOf);

    // links: up to 8 per node (neighbour node index or -1)
    this.links = new Int32Array(n * 8).fill(-1);
    const ortho = (di, dj) => (di === 1 ? 0 : di === -1 ? 1 : dj === 1 ? 2 : 3);
    for (let a = 0; a < n; a++) {
      const k = this.cellOf[a], i = k % this.nx, j = (k / this.nx) | 0;
      for (let d = 0; d < 8; d++) {
        const [di, dj] = DIRS[d];
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= this.nx || nj >= this.nz) continue;
        // no cutting corners past walls (the straight steps come first)
        if (di && dj && (this.links[a * 8 + ortho(di, 0)] < 0 || this.links[a * 8 + ortho(0, dj)] < 0)) continue;
        this.links[a * 8 + d] = this.bestStep(a, nj * this.nx + ni);
      }
    }

    // ladders: the floor in front of the foot <-> the floor behind the top
    this.extra = new Map();
    const link = (a, b, cost, lad) => {
      if (!this.extra.has(a)) this.extra.set(a, []);
      this.extra.get(a).push({ to: b, cost, ladder: lad });
    };
    for (const lad of ladders) {
      const a = this.nearestLevel(lad.cx + lad.nx * 28, lad.y0, lad.cz + lad.nz * 28, 24);
      const b = this.nearestLevel(lad.cx - lad.nx * 30, lad.top, lad.cz - lad.nz * 30, 24);
      if (a < 0 || b < 0) {
        console.warn('ladder without floor at both ends', lad);
        continue;
      }
      const cost = (lad.top - lad.y0) / cell + 3;
      link(a, b, cost, lad);
      link(b, a, cost, lad);
    }

    // keep to the biggest connected area (spots on top of crates you can't
    // walk onto are left out of random goals)
    this.comp = new Int32Array(n).fill(-1);
    let best = -1, bestSize = 0, id = 0;
    const stack = [];
    for (let s = 0; s < n; s++) {
      if (this.comp[s] >= 0) continue;
      let size = 0;
      stack.push(s);
      this.comp[s] = id;
      while (stack.length) {
        const a = stack.pop();
        size++;
        for (let d = 0; d < 8; d++) {
          const b = this.links[a * 8 + d];
          if (b >= 0 && this.comp[b] < 0) { this.comp[b] = id; stack.push(b); }
        }
        for (const e of this.extra.get(a) || []) {
          if (this.comp[e.to] < 0) { this.comp[e.to] = id; stack.push(e.to); }
        }
      }
      if (size > bestSize) { bestSize = size; best = id; }
      id++;
    }
    this.mainComp = best;
    this.walkable = [];
    for (let a = 0; a < n; a++) if (this.comp[a] === best) this.walkable.push(a);

    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.via = new Array(n).fill(null); // the ladder taken to get to a spot
    this.state = new Uint8Array(n); // 0 new, 1 open, 2 closed
    this.heap = [];
  }

  cx(i) { return this.ox + (i + 0.5) * this.cell; }
  cz(j) { return this.oz + (j + 0.5) * this.cell; }

  cellIndex(x, z) {
    const i = Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.ox) / this.cell)));
    const j = Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.oz) / this.cell)));
    return j * this.nx + i;
  }

  // the spot in cell k we can walk to from node a, or -1
  bestStep(a, k) {
    const ya = this.y[a];
    let best = -1, bd = Infinity;
    for (let b = this.cellStart[k]; b < this.cellStart[k + 1]; b++) {
      const dy = this.y[b] - ya;
      if (dy > 40 || dy < -MAX_DROP) continue;
      if (Math.abs(dy) >= bd) continue;
      if (dy > PM.stepsize) {
        // more than one step between the two spots: walk it like a player would
        if (!this.climb(a, b)) continue;
      } else {
        // walk across at the higher of the two heights
        const hy = Math.max(ya, this.y[b]) + 0.5;
        this.world.traceHull(this.x[a], hy, this.z[a], this.x[b], hy, this.z[b], HULL.stand, null, tr);
        if (tr.frac < 1 || tr.startSolid) continue;
      }
      best = b;
      bd = Math.abs(dy);
    }
    return best;
  }

  // up a short flight of stairs: lift a step, move a bit, settle on the floor
  climb(a, b) {
    const w = this.world, H = HULL.stand;
    let x = this.x[a], y = this.y[a] + 0.5, z = this.z[a];
    for (let s = 1; s <= 4; s++) {
      const nx = this.x[a] + (this.x[b] - this.x[a]) * s / 4, nz = this.z[a] + (this.z[b] - this.z[a]) * s / 4;
      w.traceHull(x, y, z, x, y + PM.stepsize, z, H, null, tr);
      const ly = tr.y;
      w.traceHull(x, ly, z, nx, ly, nz, H, null, tr);
      if (tr.frac < 1) return false;
      w.traceHull(nx, ly, nz, nx, ly - 40, nz, H, null, tr);
      x = nx;
      z = nz;
      y = tr.frac < 1 ? tr.y : ly - 40;
    }
    return Math.abs(y - 0.5 - this.y[b]) < 4;
  }

  // the spot under (or nearest to) a point; reachable: only spots everyone
  // can walk to (a goal on top of a crate becomes the floor next to it)
  nearest(x, y, z, reachable = false) {
    const k0 = this.cellIndex(x, z);
    const si = k0 % this.nx, sj = (k0 / this.nx) | 0;
    for (let r = 0; r < 12; r++) {
      let best = -1, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = si + di, j = sj + dj;
          if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
          const k = j * this.nx + i;
          for (let a = this.cellStart[k]; a < this.cellStart[k + 1]; a++) {
            if (reachable && this.comp[a] !== this.mainComp) continue;
            // prefer the floor we're standing on: spots above us count as far away
            const dy = this.y[a] - y;
            const d = (this.x[a] - x) ** 2 + (this.z[a] - z) ** 2 + (dy > 24 ? dy * dy * 16 : dy * dy * 4);
            if (d < bd) { bd = d; best = a; }
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  // the closest spot to a point that's within dy of its height (or -1)
  nearestLevel(x, y, z, dy) {
    const k0 = this.cellIndex(x, z);
    const si = k0 % this.nx, sj = (k0 / this.nx) | 0;
    let best = -1, bd = Infinity;
    for (let dj = -3; dj <= 3; dj++) {
      for (let di = -3; di <= 3; di++) {
        const i = si + di, j = sj + dj;
        if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
        const k = j * this.nx + i;
        for (let a = this.cellStart[k]; a < this.cellStart[k + 1]; a++) {
          if (Math.abs(this.y[a] - y) > dy) continue;
          const d = (this.x[a] - x) ** 2 + (this.z[a] - z) ** 2;
          if (d < bd) { bd = d; best = a; }
        }
      }
    }
    return best;
  }

  pointOf(a) {
    return { x: this.x[a], y: this.y[a], z: this.z[a] };
  }

  randomPoint(rand, filter) {
    for (let tries = 0; tries < 30; tries++) {
      const a = this.walkable[(rand() * this.walkable.length) | 0];
      const p = this.pointOf(a);
      if (!filter || filter(p)) return p;
    }
    // a small area: look through every spot
    const ok = this.walkable.filter((a) => filter(this.pointOf(a)));
    const list = ok.length ? ok : this.walkable;
    return this.pointOf(list[(rand() * list.length) | 0]);
  }

  // A* between two points. Returns [{x,y,z}...] or null; a spot reached by
  // climbing a ladder carries it as `ladder`.
  findPath(ax, ay, az, bx, by, bz) {
    const s = this.nearest(ax, ay, az), goal = this.nearest(bx, by, bz, true);
    if (s < 0 || goal < 0) return null;
    if (s === goal) return [this.pointOf(goal)];
    const links = this.links, g = this.g, parent = this.parent, state = this.state, via = this.via, extra = this.extra;
    state.fill(0);
    const gx = this.x[goal], gz = this.z[goal], cell = this.cell;
    const h = (k) => {
      const di = Math.abs(this.x[k] - gx) / cell, dj = Math.abs(this.z[k] - gz) / cell;
      return Math.max(di, dj) + (SQRT2 - 1) * Math.min(di, dj);
    };
    const heap = this.heap;
    heap.length = 0;
    const push = (k, f) => {
      heap.push([f, k]);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (heap[p][0] <= heap[c][0]) break;
        [heap[p], heap[c]] = [heap[c], heap[p]];
        c = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = c * 2 + 1, r = l + 1;
          let m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]];
          c = m;
        }
      }
      return top[1];
    };
    g[s] = 0;
    parent[s] = -1;
    via[s] = null;
    state[s] = 1;
    push(s, h(s));
    let found = false;
    while (heap.length) {
      const k = pop();
      if (state[k] === 2) continue;
      state[k] = 2;
      if (k === goal) { found = true; break; }
      for (let d = 0; d < 8; d++) {
        const nk = links[k * 8 + d];
        if (nk < 0 || state[nk] === 2) continue;
        const ng = g[k] + DIRS[d][2];
        if (state[nk] === 0 || ng < g[nk]) {
          g[nk] = ng;
          parent[nk] = k;
          via[nk] = null;
          state[nk] = 1;
          push(nk, ng + h(nk));
        }
      }
      const ex = extra.get(k);
      if (ex) {
        for (const e of ex) {
          const nk = e.to;
          if (state[nk] === 2) continue;
          const ng = g[k] + e.cost;
          if (state[nk] === 0 || ng < g[nk]) {
            g[nk] = ng;
            parent[nk] = k;
            via[nk] = e.ladder;
            state[nk] = 1;
            push(nk, ng + h(nk));
          }
        }
      }
    }
    if (!found) return null;
    const out = [];
    for (let k = goal; k !== -1; k = parent[k]) {
      const pt = this.pointOf(k);
      if (via[k]) pt.ladder = via[k];
      out.push(pt);
    }
    out.reverse();
    return out;
  }
}

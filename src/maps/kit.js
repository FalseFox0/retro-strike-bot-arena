// Helpers for laying out maps out of axis-aligned boxes.

import * as THREE from '../../lib/three.module.js';

// A box from (x0, z0) to (x1, z1), h tall, standing on y0.
export const box = (x0, z0, x1, z1, h, mat, y0 = 0, extra) => ({
  min: [Math.min(x0, x1), y0, Math.min(z0, z1)],
  max: [Math.max(x0, x1), y0 + h, Math.max(z0, z1)],
  mat,
  ...extra,
});

// Stairs climbing `rise` over the rectangle, going up toward `dir`
// ('+x' | '-x' | '+z' | '-z'), in steps of at most 16 units.
export function stairs(out, x0, z0, x1, z1, y0, rise, dir, mat) {
  const n = Math.ceil(rise / 16);
  const sh = rise / n;
  const along = dir[1] === 'x';
  const a0 = along ? Math.min(x0, x1) : Math.min(z0, z1);
  const a1 = along ? Math.max(x0, x1) : Math.max(z0, z1);
  const len = (a1 - a0) / n;
  for (let i = 0; i < n; i++) {
    // step i is (i + 1) high, counted from the low end; a solid column from y0
    const lo = dir[0] === '+' ? a0 + i * len : a1 - (i + 1) * len;
    const hi = lo + len;
    const h = sh * (i + 1);
    if (along) out.push(box(lo, z0, hi, z1, h, mat, y0));
    else out.push(box(x0, lo, x1, hi, h, mat, y0));
  }
}

// A wall from (x0, z0) to (x1, z1) with a doorway: gap from g0 to g1 along
// the wall, `gh` high, filled above with a lintel.
export function wallWithGap(out, x0, z0, x1, z1, h, mat, g0, g1, gh, y0 = 0) {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  if (alongX) {
    const zA = Math.min(z0, z1), zB = Math.max(z0, z1);
    if (g0 > Math.min(x0, x1)) out.push(box(Math.min(x0, x1), zA, g0, zB, h, mat, y0));
    if (g1 < Math.max(x0, x1)) out.push(box(g1, zA, Math.max(x0, x1), zB, h, mat, y0));
    if (gh < h) out.push(box(g0, zA, g1, zB, h - gh, mat, y0 + gh));
  } else {
    const xA = Math.min(x0, x1), xB = Math.max(x0, x1);
    if (g0 > Math.min(z0, z1)) out.push(box(xA, Math.min(z0, z1), xB, g0, h, mat, y0));
    if (g1 < Math.max(z0, z1)) out.push(box(xA, g1, xB, Math.max(z0, z1), h, mat, y0));
    if (gh < h) out.push(box(xA, g0, xB, g1, h - gh, mat, y0 + gh));
  }
}

// Carve open areas out of a solid block of grid cells (G units each).
// open: [x0, z0, x1, z1, options]; later areas win where they overlap.
// at(i, j) is the open area a cell belongs to (-1 = solid); rects(pred)
// merges the cells matching pred into as few rectangles as it can.
export function carve(minX, minZ, maxX, maxZ, G, open) {
  const nx = (maxX - minX) / G, nz = (maxZ - minZ) / G;
  const cell = new Int16Array(nx * nz).fill(-1);
  open.forEach(([x0, z0, x1, z1], k) => {
    for (let j = (z0 - minZ) / G; j < (z1 - minZ) / G; j++) {
      for (let i = (x0 - minX) / G; i < (x1 - minX) / G; i++) cell[j * nx + i] = k;
    }
  });
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz ? -1 : cell[j * nx + i]);
  const rects = (pred) => {
    const used = new Uint8Array(nx * nz);
    const list = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (used[j * nx + i] || !pred(i, j)) continue;
        let w = 1;
        while (i + w < nx && !used[j * nx + i + w] && pred(i + w, j)) w++;
        let h = 1;
        outer: while (j + h < nz) {
          for (let k = 0; k < w; k++) if (used[(j + h) * nx + i + k] || !pred(i + k, j + h)) break outer;
          h++;
        }
        for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) used[(j + b) * nx + i + a] = 1;
        list.push([i, j, w, h]);
      }
    }
    return list;
  };
  return { nx, nz, at, rects, X: (i) => minX + i * G, Z: (j) => minZ + j * G };
}

// Boxes along the edges of open area k where it meets solid cells (skirting,
// wall linings): `thick` deep into the area, `h` tall.
export function linings(grid, open, k, G, minX, minZ, thick, h, mat) {
  const out = [];
  const [x0, z0, x1, z1] = open[k];
  const { at, X, Z } = grid;
  const i0 = (x0 - minX) / G, i1 = (x1 - minX) / G, j0 = (z0 - minZ) / G, j1 = (z1 - minZ) / G;
  const sides = [
    { n: i1 - i0, out: (s) => at(i0 + s, j0 - 1), ins: (s) => at(i0 + s, j0), mk: (a, b) => box(X(i0 + a), z0, X(i0 + b), z0 + thick, h, mat) },
    { n: i1 - i0, out: (s) => at(i0 + s, j1), ins: (s) => at(i0 + s, j1 - 1), mk: (a, b) => box(X(i0 + a), z1 - thick, X(i0 + b), z1, h, mat) },
    // the sides along z stop short of the corners the others already cover
    { n: j1 - j0, out: (s) => at(i0 - 1, j0 + s), ins: (s) => at(i0, j0 + s), mk: (a, b, n) => box(x0, Z(j0 + a) + (a === 0 ? thick : 0), x0 + thick, Z(j0 + b) - (b === n ? thick : 0), h, mat) },
    { n: j1 - j0, out: (s) => at(i1, j0 + s), ins: (s) => at(i1 - 1, j0 + s), mk: (a, b, n) => box(x1 - thick, Z(j0 + a) + (a === 0 ? thick : 0), x1, Z(j0 + b) - (b === n ? thick : 0), h, mat) },
  ];
  for (const sd of sides) {
    let s = 0;
    while (s < sd.n) {
      if (!(sd.out(s) < 0 && sd.ins(s) === k)) { s++; continue; }
      let e = s;
      while (e < sd.n && sd.out(e) < 0 && sd.ins(e) === k) e++;
      const b = sd.mk(s, e, sd.n);
      if (b.max[0] - b.min[0] > 1 && b.max[2] - b.min[2] > 1) out.push(b);
      s = e;
    }
  }
  return out;
}

// Mirror boxes across x = 0 (for symmetric maps).
export const mirrorX = (b) => ({ ...b, min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] });

// tiny deterministic hash in [0, 1) for picking heights / materials per block
export const hash = (a, b) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// palm trees: a leaning, segmented trunk and a crown of drooping fronds,
// all merged into two meshes (shaded per tree with vertex colours)
export function palmTrees(list, { T, group, shade, disposables }) {
  const trunk = { pos: [], nrm: [], uv: [], col: [], idx: [] };
  const leaves = { pos: [], nrm: [], uv: [], col: [], idx: [] };
  const add = (acc, geo, m, k) => {
    const base = acc.pos.length / 3;
    const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m);
      acc.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      acc.nrm.push(v.x, v.y, v.z);
      acc.uv.push(U.getX(i), U.getY(i));
      acc.col.push(k, k, k);
    }
    for (let i = 0; i < geo.index.count; i++) acc.idx.push(geo.index.getX(i) + base);
  };
  const seg = new THREE.CylinderGeometry(7, 9, 40, 8, 1, true);
  seg.translate(0, 20, 0);
  for (let i = 0; i < seg.attributes.uv.count; i++) seg.attributes.uv.setY(i, seg.attributes.uv.getY(i) * 0.32);
  const frond = new THREE.PlaneGeometry(130, 34, 6, 1);
  frond.translate(65, 0, 0);
  frond.rotateX(-Math.PI / 2);
  const fp = frond.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const u = fp.getX(i) / 130;
    fp.setY(i, fp.getY(i) + 18 * u - 62 * u * u);
  }
  frond.computeVertexNormals();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  list.forEach(([x, z], n) => {
    const k = Math.max(0.55, shade(x, 0, z) * 0.95);
    const lean = 0.1 + hash(x, z) * 0.12, dir = hash(z, x) * Math.PI * 2;
    let px = x, py = 0, pz = z;
    for (let i = 0; i < 6; i++) {
      const a = lean * (0.4 + i * 0.25);
      e.set(Math.cos(dir) * a, 0, Math.sin(dir) * a);
      q.setFromEuler(e);
      p.set(px, py, pz);
      s.set(1 - i * 0.04, 1, 1 - i * 0.04);
      m.compose(p, q, s);
      add(trunk, seg, m, k);
      const up = new THREE.Vector3(0, 40, 0).applyQuaternion(q);
      px += up.x; py += up.y; pz += up.z;
    }
    for (let f = 0; f < 9; f++) {
      e.set(0, f * (Math.PI * 2 / 9) + n, (hash(f, n) - 0.5) * 0.3);
      q.setFromEuler(e);
      p.set(px, py - 2, pz);
      s.set(0.85 + hash(n, f) * 0.3, 1, 1);
      m.compose(p, q, s);
      add(leaves, frond, m, k * 1.05);
    }
  });
  for (const [acc, mat] of [
    [trunk, new THREE.MeshLambertMaterial({ map: T.palmTrunk, vertexColors: true })],
    [leaves, new THREE.MeshLambertMaterial({ map: T.palmLeaf, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide })],
  ]) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(acc.col, 3));
    geo.setIndex(acc.idx);
    group.add(new THREE.Mesh(geo, mat));
    disposables.push(geo, mat);
  }
  seg.dispose();
  frond.dispose();
}

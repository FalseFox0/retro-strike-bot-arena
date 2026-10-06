// de_foundry: an original medium-size bomb defusal map in a steel foundry.
// Terrorists start in the truck yard in the south, Counter-Terrorists in the
// north between the two sites. Bomb site A is inside the big foundry hall,
// with catwalks, a bridge over the site, two ladders and a staircase; bomb
// site B is out in the container yard behind the warehouse.
//
// Routes north: the A road on the west to the hall's big sliding door; mid
// (through the half-open mid doors), with an alley across to the A road and
// a corridor (door) into the warehouse; the warehouse on the east (big
// sliding door) out to the B yard.
// A small office with a door at each end joins mid to the A hall.
//
// Like de_dunetown the open areas are carved out of solid blocks; the blocks
// around the halls rise above their roofs.

import * as THREE from '../../lib/three.module.js';
import { box, stairs, carve, linings, hash } from './kit.js';

const G = 32;
const MIN_X = -2048, MAX_X = 2048, MIN_Z = -2048, MAX_Z = 2048;
const CAT = 240; // catwalk floor height in the A hall

// [x0, z0, x1, z1, options]: floor material, roof height (indoors), hall name
const OPEN = [
  // ---- outdoors ----
  [-768, 1472, 768, 1984, { floor: 'asphalt' }],                 // T spawn: the truck yard
  [-1920, 1216, -896, 1984, { floor: 'asphalt' }],               // west storage yard
  [-896, 1600, -768, 1792, { floor: 'asphalt' }],                // gate to the west yard
  [-1920, -640, -1472, 1216, { floor: 'asphalt' }],              // A road
  [-1472, -96, -320, 96, { floor: 'asphalt' }],                  // alley from the A road to mid
  [-320, -1344, 320, 1472, { floor: 'asphalt' }],                // mid
  [768, 1600, 896, 1792, { floor: 'asphalt' }],                  // gate to the east yard
  [896, 1216, 1920, 1984, { floor: 'asphalt' }],                 // east yard
  [1024, 576, 1408, 1216, { floor: 'asphalt' }],                 // lane to the warehouse
  [576, -1920, 1920, -832, { floor: 'asphalt' }],                // B container yard
  [-448, -1920, 448, -1344, { floor: 'asphalt' }],               // CT spawn
  [448, -1728, 576, -1472, { floor: 'asphalt' }],                // CT to B
  // ---- indoors ----
  [-1920, -1920, -768, -704, { floor: 'factoryFloor', roof: 448, hall: 'A' }],  // the foundry hall
  [-1792, -704, -1600, -640, { floor: 'factoryFloor', roof: 224 }],            // its big door
  [-768, -1920, -448, -1728, { floor: 'factoryFloor', roof: 192 }],            // CT passage into the hall
  [-704, -1248, -384, -992, { floor: 'factoryFloor', roof: 128 }],             // office
  [-768, -1152, -704, -1088, { floor: 'factoryFloor', roof: 112 }],            // office door to the hall
  [-384, -1152, -320, -1088, { floor: 'factoryFloor', roof: 112 }],            // office door to mid
  [640, -704, 1600, 512, { floor: 'factoryFloor', roof: 320, hall: 'B' }],     // warehouse
  [1024, 512, 1216, 576, { floor: 'factoryFloor', roof: 224 }],                // its big door
  [1088, -832, 1344, -704, { floor: 'factoryFloor', roof: 256 }],              // warehouse to the B yard
  [320, -192, 640, -128, { floor: 'factoryFloor', roof: 144 }],                // corridor from mid (door)
];

// hanging lamps: [x, y, z, r, g, b, radius]
const LAMPS = [];
for (const x of [-1664, -1344, -1024]) for (const z of [-1664, -1312, -960]) LAMPS.push([x, 400, z, 0.62, 0.52, 0.36, 640]);
for (const x of [704, 1120, 1536]) for (const z of [-400, 100]) LAMPS.push([x, 290, z, 0.42, 0.48, 0.52, 520]);
LAMPS.push([-544, 112, -1120, 0.56, 0.52, 0.44, 300]);  // office
LAMPS.push([-608, 176, -1824, 0.5, 0.46, 0.38, 320]);   // CT passage
LAMPS.push([480, 128, -160, 0.5, 0.46, 0.38, 240]);     // corridor
LAMPS.push([-1696, 250, -628, 0.6, 0.5, 0.34, 380]);    // over the big doors, outside
LAMPS.push([1120, 250, 588, 0.6, 0.5, 0.34, 380]);

const LADDERS = [
  { x: -1400, z: -800, face: '-z', top: CAT },   // hall floor -> south catwalk
  { x: -800, z: -1264, face: '+z', top: CAT },   // hall floor -> the bridge's east end
  { x: 1272, z: -1408, face: '+z', top: 192 },   // B yard: up the container stack
];

const DOORS = [
  // big sliding doors: they roll into the wall beside the opening
  { type: 'slide', min: [-1792, 0, -680], max: [-1600, 224, -664], dir: '+x', dist: 192 },
  { type: 'slide', min: [1024, 0, 536], max: [1216, 224, 552], dir: '+x', dist: 192 },
  // the office doors and the warehouse side door
  { type: 'swing', x: -736, z: -1149, axis: 'z', len: 58 },
  { type: 'swing', x: -352, z: -1149, axis: 'z', len: 58 },
  { type: 'swing', x: 608, z: -189, axis: 'z', len: 58 },
];

function layout() {
  const grid = carve(MIN_X, MIN_Z, MAX_X, MAX_Z, G, OPEN);
  const { nx, nz, at, rects, X, Z } = grid;
  const out = [];

  // floors
  for (const mat of ['asphalt', 'factoryFloor']) {
    for (const [i, j, w, h] of rects((a, b) => at(a, b) >= 0 && OPEN[at(a, b)][4].floor === mat)) {
      out.push(box(X(i), Z(j), X(i + w), Z(j + h), 16, mat, -16));
    }
  }

  // how tall each solid cell must be (above any roof next to it) and what it's made of
  const need = new Int16Array(nx * nz), kind = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (at(i, j) >= 0) continue;
      let h = 0, k = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const o = at(i + di, j + dj);
          if (o < 0) continue;
          const opt = OPEN[o][4];
          if (opt.roof) h = Math.max(h, opt.roof + 32);
          if (opt.hall === 'A') k = 1;
          else if (opt.hall === 'B' && !k) k = 2;
        }
      }
      need[j * nx + i] = h;
      kind[j * nx + i] = k;
    }
  }
  // buildings: the solid cells in chunks of varied height and cladding
  const height = new Int16Array(nx * nz);
  const CH = 12;
  for (const [i, j, w, h] of rects((a, b) => at(a, b) < 0)) {
    for (let b = 0; b < h; b += CH) {
      for (let a = 0; a < w; a += CH) {
        const ww = Math.min(CH, w - a), hh = Math.min(CH, h - b), i0 = i + a, j0 = j + b;
        let req = 0, k = 0;
        for (let q = 0; q < hh; q++) {
          for (let p = 0; p < ww; p++) {
            const c = (j0 + q) * nx + i0 + p;
            req = Math.max(req, need[c]);
            k = Math.max(k, kind[c]);
          }
        }
        const x0 = X(i0), z0 = Z(j0), x1 = X(i0 + ww), z1 = Z(j0 + hh);
        const edge = x0 <= MIN_X || z0 <= MIN_Z || x1 >= MAX_X || z1 >= MAX_Z;
        const tall = Math.max(req, edge ? 512 : [320, 384, 384, 448][(hash(x0, z0) * 4) | 0]);
        const mat = k === 1 ? 'brick' : k === 2 ? 'corrugated' : ['brick', 'corrugatedB', 'concrete', 'corrugated'][(hash(z0, x0) * 4) | 0];
        out.push(box(x0, z0, x1, z1, tall, mat));
        for (let q = 0; q < hh; q++) for (let p = 0; p < ww; p++) height[(j0 + q) * nx + i0 + p] = tall;
      }
    }
  }

  // roofs: the halls get a sheet-metal roof with skylights and trusses; doorways
  // and small rooms are closed up to the walls around them
  OPEN.forEach(([x0, z0, x1, z1, o]) => {
    if (!o.roof) return;
    if (o.hall === 'A') {
      for (const [a, b] of [[-1920, -1600], [-1536, -1216], [-1152, -768]]) out.push(box(a, z0, b, z1, 32, 'corrugatedB', o.roof));
      for (const z of [-1856, -1600, -1088, -832]) out.push(box(x0, z, x1, z + 16, 40, 'steel', o.roof - 40));
      return;
    }
    if (o.hall === 'B') {
      out.push(box(x0, z0, 1088, z1, 32, 'corrugatedB', o.roof));
      out.push(box(1152, z0, x1, z1, 32, 'corrugatedB', o.roof));
      for (const z of [-448, -96, 256]) out.push(box(x0, z, x1, z + 16, 32, 'steel', o.roof - 32));
      return;
    }
    let top = o.roof + 32;
    const i0 = (x0 - MIN_X) / G, i1 = (x1 - MIN_X) / G, j0 = (z0 - MIN_Z) / G, j1 = (z1 - MIN_Z) / G;
    for (let i = i0 - 1; i <= i1; i++) {
      for (const j of [j0 - 1, j1]) if (i >= 0 && i < nx && j >= 0 && j < nz) top = Math.max(top, height[j * nx + i]);
    }
    for (let j = j0; j < j1; j++) {
      for (const i of [i0 - 1, i1]) if (i >= 0 && i < nx && j >= 0 && j < nz) top = Math.max(top, height[j * nx + i]);
    }
    out.push(box(x0, z0, x1, z1, top - o.roof, 'concrete', o.roof));
  });

  // a concrete base along the walls: tall inside the halls, a low curb outside
  OPEN.forEach(([, , , , o], k) => {
    if (o.roof && !o.hall) return;
    out.push(...linings(grid, OPEN, k, G, MIN_X, MIN_Z, o.hall ? 8 : 6, o.hall ? 112 : 24, 'concrete'));
  });

  // ---- the A hall: catwalks, a bridge over the site, a staircase ----
  const deck = (x0, z0, x1, z1) => out.push(box(x0, z0, x1, z1, 8, 'plate', CAT - 8));
  deck(-1920, -800, -768, -704);    // south catwalk, over the big door
  deck(-1920, -1920, -1824, -800);  // west catwalk
  deck(-1824, -1920, -1760, -1856); // landing at the top of the stairs
  deck(-1824, -1360, -768, -1264);  // bridge across the hall
  stairs(out, -1824, -1856, -1760, -1616, 0, CAT, '-z', 'plate');
  // railings (yellow pipe: posts, a mid rail and a top rail) with gaps for the ladders
  const rail = (x0, z0, x1, z1) => {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1), a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
    const c = alongX ? z0 : x0;
    const seg = (y0, h) => out.push(alongX ? box(a0, c - 1.5, a1, c + 1.5, h, 'steelYellow', y0) : box(c - 1.5, a0, c + 1.5, a1, h, 'steelYellow', y0));
    seg(CAT + 38, 3);
    seg(CAT + 18, 3);
    const n = Math.max(1, Math.round((a1 - a0) / 64));
    for (let s = 0; s <= n; s++) {
      const a = Math.min(a1 - 1.5, Math.max(a0 + 1.5, a0 + (a1 - a0) * s / n));
      out.push(alongX ? box(a - 1.5, c - 1.5, a + 1.5, c + 1.5, 38, 'steelYellow', CAT) : box(c - 1.5, a - 1.5, c + 1.5, a + 1.5, 38, 'steelYellow', CAT));
    }
  };
  rail(-1824, -798, -1428, -798);   // south catwalk, west of its ladder
  rail(-1372, -798, -770, -798);    //   and east of it
  rail(-1826, -1854, -1826, -1362); // west catwalk, north of the bridge
  rail(-1826, -1262, -1826, -802);  //   and south of it
  rail(-1762, -1918, -1762, -1858); // landing
  rail(-1822, -1358, -770, -1358);  // bridge, north side
  rail(-1822, -1266, -828, -1266);  // bridge, south side (gap for the ladder)
  // yellow columns under the catwalks and the bridge
  for (const x of [-1536, -1280, -1024]) out.push(box(x - 8, -760, x + 8, -744, CAT - 8, 'steelYellow'));
  for (const z of [-1664, -1152, -960]) out.push(box(-1880, z - 8, -1864, z + 8, CAT - 8, 'steelYellow'));
  for (const x of [-1536, -1088]) out.push(box(x - 8, -1320, x + 8, -1304, CAT - 8, 'steelYellow'));

  // site A: the furnace with its flue, a press, crates
  out.push(box(-1440, -1440, -1248, -1248, 176, 'steel'));
  out.push(box(-1456, -1456, -1232, -1232, 24, 'steelYellow', 176));
  out.push(box(-1376, -1440, -1312, -1392, 248, 'steel', 200));
  out.push(box(-1760, -1200, -1632, -1072, 128, 'steelYellow'));
  out.push(box(-1200, -1520, -1136, -1456, 64, 'crate'));
  out.push(box(-1192, -1512, -1144, -1464, 48, 'crate', 64));
  out.push(box(-1620, -1400, -1556, -1336, 64, 'mcrate'));
  out.push(box(-1560, -1040, -1496, -976, 64, 'crate'));
  out.push(box(-1080, -1180, -1016, -1116, 64, 'mcrate'));
  out.push(box(-1080, -1116, -1016, -1052, 64, 'mcrate'));
  out.push(box(-1840, -1560, -1776, -1496, 64, 'crate'));
  out.push(box(-1000, -1800, -936, -1736, 64, 'crate'));
  out.push(box(-1260, -880, -1196, -816, 64, 'crate'));
  // office: desks and a filing cabinet
  out.push(box(-640, -1208, -560, -1176, 36, 'planks'));
  out.push(box(-480, -1040, -400, -1008, 36, 'planks'));
  out.push(box(-700, -1036, -672, -996, 64, 'mcrate'));

  // ---- mid ----
  out.push(box(-336, -544, -64, -480, 192, 'concrete'));
  out.push(box(64, -544, 336, -480, 192, 'concrete'));
  // mid doors: the west one shut, the east one swung open toward CT, and
  // crates stacked behind the gap so the spawns can't see each other
  out.push(box(-64, -516, -8, -508, 160, 'doorMetal'));
  out.push(box(56, -624, 64, -544, 160, 'doorMetal'));
  out.push(box(-48, -700, 32, -636, 64, 'crate'));
  out.push(box(32, -700, 104, -636, 64, 'mcrate'));
  out.push(box(-40, -692, 32, -644, 48, 'crate', 64));
  out.push(box(32, -696, 100, -640, 48, 'crate', 64));
  trailer(out, -208, 640, -112, 1024, 'containerBlue', 'z');
  out.push(box(100, -440, 164, -376, 64, 'crate'));
  out.push(box(-240, -700, -176, -636, 64, 'crate'));
  out.push(box(180, 200, 244, 264, 64, 'mcrate'));
  out.push(box(-260, -1100, -196, -1036, 64, 'crate'));
  out.push(box(200, 1100, 264, 1164, 64, 'crate'));
  out.push(box(208, 1108, 256, 1156, 48, 'crate', 64));

  // ---- A road and the alley ----
  container(out, -1880, 860, 'z', 'containerRed');
  container(out, -1580, 320, 'z', 'containerGreen');
  container(out, -1880, -180, 'z', 'containerBlue');
  out.push(box(-1600, -420, -1536, -356, 64, 'crate'));
  out.push(box(-1700, 700, -1636, 764, 64, 'mcrate'));
  out.push(box(-1100, -80, -1036, -16, 64, 'crate'));
  out.push(box(-700, 30, -636, 94, 64, 'crate'));
  out.push(box(-1420, 20, -1356, 84, 56, 'mcrate'));

  // ---- the yards ----
  container(out, -1600, 1500, 'x', 'containerBlue');
  container(out, -1600, 1500, 'x', 'containerRed', 102);
  container(out, -1300, 1800, 'x', 'containerGreen');
  forklift(out, -1180, 1690, 'z');
  out.push(box(-1800, 1300, -1736, 1364, 64, 'crate'));
  trailer(out, -640, 1560, -544, 1880, 'containerBlue', 'z');
  trailer(out, 300, 1500, 684, 1596, 'containerRed', 'x');
  out.push(box(-120, 1530, -56, 1594, 64, 'crate'));
  container(out, 1500, 1300, 'x', 'containerGreen');
  out.push(box(1100, 1700, 1164, 1764, 64, 'crate'));
  out.push(box(1700, 1600, 1764, 1664, 64, 'mcrate'));
  out.push(box(1300, 800, 1364, 864, 64, 'crate'));

  // ---- warehouse: two long pallet racks, more crates in the aisle ----
  rack(out, 768, -448, 256);
  rack(out, 1408, -448, 256);
  out.push(box(1000, -300, 1064, -236, 64, 'crate'));
  out.push(box(1008, -292, 1056, -244, 48, 'crate', 64));
  out.push(box(1180, 0, 1244, 64, 64, 'crate'));
  out.push(box(1100, 300, 1164, 364, 64, 'mcrate'));
  forklift(out, 1250, -520, 'x');

  // ---- B yard: a stack of two containers (ladder to the top), more around the site ----
  container(out, 1152, -1504, 'x', 'containerBlue', 0, 96);
  container(out, 1152, -1504, 'x', 'containerRed', 96, 96);
  container(out, 1600, -1280, 'z', 'containerGreen');
  container(out, 800, -1250, 'x', 'containerRed');
  container(out, 1500, -1800, 'x', 'containerBlue');
  out.push(box(1000, -1550, 1064, -1486, 64, 'crate'));
  out.push(box(1450, -1200, 1514, -1136, 64, 'crate'));
  out.push(box(1458, -1192, 1506, -1144, 48, 'crate', 64));
  out.push(box(1780, -1100, 1844, -1036, 64, 'mcrate'));
  forklift(out, 930, -1700, 'x');

  // ---- CT spawn ----
  out.push(box(-64, -1700, 64, -1620, 112, 'concrete'));
  out.push(box(320, -1880, 384, -1816, 64, 'crate'));

  // barrels
  for (const [x, z] of [[-1880, 1240], [-1860, -600], [-480, -1880], [1880, 1240], [1880, -1880], [-280, 1440], [1560, 480], [-1440, -1880]]) {
    out.push(box(x - 14, z - 14, x + 14, z + 14, 44, 'barrel'));
  }
  return out;
}

// a pallet rack along z (64 deep): yellow uprights, two plank shelves, crates
// on every level; solid to the floor so nothing gets stuck under it
function rack(out, x, z0, z1) {
  for (let z = z0; z < z1; z += 128) {
    const ze = Math.min(z1, z + 128);
    out.push(box(x + 4, z + 6, x + 60, ze - 6, 60, (z / 128) & 1 ? 'crate' : 'mcrate'));
    out.push(box(x + 4, z + 6, x + 60, ze - 6, 52, (z / 128) & 1 ? 'mcrate' : 'crate', 72));
    out.push(box(x + 8, z + 10, x + 56, ze - 10, 44, 'crate', 136));
  }
  for (const y of [64, 128]) out.push(box(x, z0, x + 64, z1, 8, 'planks', y));
  out.push(box(x, z0, x + 64, z1, 6, 'planks', 184));
  for (let z = z0; z <= z1; z += 128) {
    const zz = Math.min(z1 - 6, Math.max(z0, z - 3));
    for (const xx of [x - 2, x + 60]) out.push(box(xx, zz, xx + 6, zz + 6, 190, 'steelYellow'));
  }
  // fill the gaps between the crates so the rack stays a solid wall to walk around
  out.push(box(x + 20, z0, x + 44, z1, 184, 'clip'));
}

// a 20 ft shipping container (240 x 96, 102 tall) along x or z, from (x, z)
function container(out, x, z, along, mat, y0 = 0, h = 102) {
  out.push(along === 'x' ? box(x, z, x + 240, z + 96, h, mat, y0) : box(x, z, x + 96, z + 240, h, mat, y0));
}

// a semi-trailer: the box up on its wheels, with a cab at the front
function trailer(out, x0, z0, x1, z1, mat, along) {
  out.push(box(x0, z0, x1, z1, 120, mat, 28));
  const w = along === 'z';
  for (const t of [0.12, 0.82]) {
    if (w) out.push(box(x0 + 4, z0 + (z1 - z0) * t, x1 - 4, z0 + (z1 - z0) * t + 40, 28, 'steel'));
    else out.push(box(x0 + (x1 - x0) * t, z0 + 4, x0 + (x1 - x0) * t + 40, z1 - 4, 28, 'steel'));
  }
}

// a forklift: body, counterweight and mast
function forklift(out, x, z, along) {
  const w = along === 'z';
  out.push(w ? box(x, z, x + 48, z + 80, 56, 'steelYellow') : box(x, z, x + 80, z + 48, 56, 'steelYellow'));
  out.push(w ? box(x + 4, z + 80, x + 44, z + 88, 128, 'steel') : box(x + 80, z + 4, x + 88, z + 44, 128, 'steel'));
}

// painted site letters
const SIGNS = [
  { text: 'A', x: -1300, y: 200, z: -1919, size: 140, face: '+z' },
  { text: 'A', x: -1856, y: 150, z: -639, size: 80, face: '+z' },
  { text: 'B', x: 1500, y: 160, z: -833, size: 110, face: '-z' },
  { text: 'B', x: 1919, y: 150, z: -1300, size: 110, face: '-x' },
];

// lamp shades and bulbs, hanging rods, and pipes along the hall walls
function props({ group, disposables }) {
  const shade = new THREE.CylinderGeometry(6, 18, 12, 10, 1, true);
  const bulb = new THREE.CircleGeometry(13, 12);
  bulb.rotateX(Math.PI / 2);
  const rod = new THREE.CylinderGeometry(0.8, 0.8, 1, 4);
  const shadeMat = new THREE.MeshLambertMaterial({ color: 0x3c4a44, side: THREE.DoubleSide });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
  const rodMat = new THREE.MeshLambertMaterial({ color: 0x303030 });
  for (const [x, y, z] of LAMPS) {
    const s = new THREE.Mesh(shade, shadeMat);
    s.position.set(x, y + 6, z);
    const b = new THREE.Mesh(bulb, bulbMat);
    b.position.set(x, y + 1, z);
    group.add(s, b);
    // hall lamps hang from the roof on a rod
    const top = y === 400 ? 448 : y === 290 ? 320 : null;
    if (top) {
      const r = new THREE.Mesh(rod, rodMat);
      r.scale.y = top - y - 12;
      r.position.set(x, (top + y + 12) / 2, z);
      group.add(r);
    }
  }
  const pipeMat = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
  const pipes = [
    [-1910, 360, -1920, -1910, 360, -704, 7],
    [-1910, 340, -1920, -1910, 340, -704, 5],
    [-1920, 380, -1906, -768, 380, -1906, 8],
    [630, 290, -704, 630, 290, 512, 6],
  ];
  const pipeGeos = [];
  for (const [x0, y0, z0, x1, y1, z1, r] of pipes) {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const g = new THREE.CylinderGeometry(r, r, len, 10);
    const m = new THREE.Mesh(g, pipeMat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    if (z1 !== z0) m.rotation.x = Math.PI / 2;
    else m.rotation.z = Math.PI / 2;
    group.add(m);
    pipeGeos.push(g);
  }
  disposables.push(shade, bulb, rod, shadeMat, bulbMat, rodMat, pipeMat, ...pipeGeos);
}

function spawns() {
  const T = [], CT = [];
  for (const z of [1720, 1860]) for (const x of [-320, -160, 0, 160, 320]) T.push({ x, y: 0, z, yaw: 0 });
  // (the back row's last one stands clear of the crate in the corner)
  for (const z of [-1480, -1830]) for (const x of [-320, -160, 0, 160, z === -1830 ? 240 : 320]) CT.push({ x, y: 0, z, yaw: Math.PI });
  const extra = [
    [-1700, 1000], [-1700, 0], [-1300, -1600], [-1700, -1000], [-1000, -1400], [-560, -1120], [-900, 0], [0, 800], [0, -200], [0, -900],
    [1100, -100], [1500, 400], [1250, 900], [800, -1000], [1700, -1500], [1300, -1150], [1400, 1500], [-1400, 1650],
  ].map(([x, z]) => ({ x, y: 0, z, yaw: Math.atan2(x, z) }));
  return { T, CT, ffa: [...T, ...CT, ...extra] };
}

export default {
  name: 'de_foundry',
  ambience: 'factory', // the background sound (ambient.js)
  bounds: { minX: -1920, maxX: 1920, minZ: -1920, maxZ: 1984 },
  boxes: layout,
  spawns,
  props,
  doors: DOORS,
  ladders: LADDERS,
  bombsites: [
    { name: 'A', min: [-1700, -20, -1700], max: [-1000, 160, -1000] },
    { name: 'B', min: [980, -20, -1680], max: [1620, 160, -1060] },
  ],
  buyzones: {
    T: [{ min: [-768, -20, 1408], max: [768, 220, 2048] }],
    CT: [{ min: [-448, -20, -1984], max: [448, 220, -1344] }],
  },
  signs: SIGNS,
  bombRadius: 500,
  sides: { axis: 'z', T: 1, CT: -1, mid: 700 },
  hideTopsAbove: 300,
  maxFloorY: 260,
  light: {
    sunDir: [0.45, 0.82, 0.36], sun: [1.06, 1.0, 0.9], sky: [0.3, 0.33, 0.38], bounce: [0.2, 0.18, 0.15],
    maxY: 600, gamma: 1.45, indoor: 0.3, lamps: LAMPS, lux: 12,
  },
  modelLight: { sky: 0xdde4ea, ground: 0x6a6660, hemi: 1.15, sun: 0xfff2e0, sunI: 1.6 },
  menuCam: { pan: true, from: [760, 230, -880], to: [1820, 230, -880], look: [1260, 60, -1450] },
  sky: 'skyIndustrial',
};

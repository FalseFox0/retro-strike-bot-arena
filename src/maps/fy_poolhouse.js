// fy_poolhouse: an original small fight-yard map. Two villas face each other
// across a sunny courtyard with a shallow pool (wading only, it slows you
// down). Each side starts in its back garden; guns lie on the ground there and
// inside the house, and there's no weapon menu. Both houses can be entered on
// the ground floor, with windows looking over the pool. Mirrored for fairness:
// Terrorists in the west (-x), Counter-Terrorists in the east.

import { box, carve, linings, mirrorX, palmTrees } from './kit.js';

const G = 16;
const MIN_X = -1152, MAX_X = 1152, MIN_Z = -704, MAX_Z = 704;

// the west (Terrorist) half; the east half is its mirror image
const HALF = [
  [-1088, -640, -928, 640, { floor: 'grass' }],                    // back garden (spawn)
  [-928, -640, -576, -432, { floor: 'grass' }],                    // paths round the house
  [-928, 432, -576, 640, { floor: 'grass' }],
  [-896, -400, -608, 400, { floor: 'parquet', roof: 176, house: true }], // inside the house
  [-608, -32, -576, 32, { floor: 'parquet', roof: 112 }],          // front door
  [-928, -32, -896, 32, { floor: 'parquet', roof: 112 }],          // back door
  [-800, -432, -736, -400, { floor: 'parquet', roof: 112 }],       // side doors
  [-800, 400, -736, 432, { floor: 'parquet', roof: 112 }],
  [-608, -272, -576, -144, { floor: 'parquet', window: { sill: 40, top: 104 } }], // windows over the pool
  [-608, 144, -576, 272, { floor: 'parquet', window: { sill: 40, top: 104 } }],
];
const mirror = ([x0, z0, x1, z1, o]) => [-x1, z0, -x0, z1, o];

const OPEN = [
  [-576, -640, 576, 640, { floor: 'deck' }],          // the courtyard
  [-576, -640, 576, -448, { floor: 'grass' }],        // lawns at both ends
  [-576, 448, 576, 640, { floor: 'grass' }],
  [-320, -192, 320, 192, { pool: true }],             // the pool (built below)
  ...HALF,
  ...HALF.map(mirror),
];

// the pool: tiled walls, a step all the way round inside, water 28 deep
const POOL_FLOOR = -32, SURFACE = -4;

// guns on the ground, west side (mirrored for the east): [id, x, z]
const GUNS_WEST = [
  ['ak47', -1000, -300], ['ak47', -1000, 300], ['awp', -1040, 0], ['m4a1', -980, -150],
  ['hegrenade', -960, 120], ['flashbang', -960, 170],
  ['ak47', -840, -280], ['m4a1', -840, 280], ['mp5navy', -680, -200], ['deagle', -680, 200],
  ['flashbang', -640, 120], ['hegrenade', -640, -120],
];
const GROUND_GUNS = [...GUNS_WEST, ...GUNS_WEST.map(([id, x, z]) => [id, -x, z])]
  .map(([id, x, z], i) => ({ id, x, y: 0, z, yaw: (i * 2.3) % (Math.PI * 2) }));

function layout() {
  const grid = carve(MIN_X, MIN_Z, MAX_X, MAX_Z, G, OPEN);
  const { at, rects, X, Z } = grid;
  const out = [];
  const opt = (a, b) => OPEN[at(a, b)][4];

  // floors (not under the pool)
  for (const mat of ['deck', 'grass', 'parquet']) {
    for (const [i, j, w, h] of rects((a, b) => at(a, b) >= 0 && opt(a, b).floor === mat)) {
      out.push(box(X(i), Z(j), X(i + w), Z(j + h), 16, mat, -16));
    }
  }

  // walls: the houses' walls stop under their roofs, the garden walls stand taller
  const nearHouse = (i, j) => {
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        const o = at(i + di, j + dj);
        if (o >= 0 && OPEN[o][4].roof) return true;
      }
    }
    return false;
  };
  for (const [i, j, w, h] of rects((a, b) => at(a, b) < 0 && nearHouse(a, b))) out.push(box(X(i), Z(j), X(i + w), Z(j + h), 208, 'stucco'));
  for (const [i, j, w, h] of rects((a, b) => at(a, b) < 0 && !nearHouse(a, b))) out.push(box(X(i), Z(j), X(i + w), Z(j + h), 224, 'stuccoB'));

  // roofs, window sills and lintels
  OPEN.forEach(([x0, z0, x1, z1, o]) => {
    if (o.roof) out.push(box(x0, z0, x1, z1, 208 - o.roof, 'plasterB', o.roof));
    if (o.window) {
      out.push(box(x0, z0, x1, z1, o.window.sill, 'stoneTrim'));
      out.push(box(x0, z0, x1, z1, 208 - o.window.top, 'stucco', o.window.top));
    }
  });
  // terracotta roof over each house (a wide cap and a narrower one on top)
  for (const s of [-1, 1]) {
    const b1 = box(-944, -448, -560, 448, 12, 'roofTile', 208), b2 = box(-912, -416, -592, 416, 12, 'roofTile', 220);
    out.push(...(s < 0 ? [b1, b2] : [mirrorX(b1), mirrorX(b2)]));
  }

  // skirting: wooden inside the houses, stone outside
  OPEN.forEach(([, , , , o], k) => {
    if (o.pool || o.window || (o.roof && !o.house)) return;
    out.push(...linings(grid, OPEN, k, G, MIN_X, MIN_Z, 4, o.house ? 10 : 18, o.house ? 'planks' : 'stoneTrim'));
  });

  // ---- the pool ----
  const tile = (x0, z0, x1, z1, y0, y1) => out.push(box(x0, z0, x1, z1, y1 - y0, 'poolTile', y0));
  tile(-320, -192, 320, 192, POOL_FLOOR - 16, POOL_FLOOR);  // bottom
  tile(-320, -192, 320, -176, POOL_FLOOR, 0);               // walls
  tile(-320, 176, 320, 192, POOL_FLOOR, 0);
  tile(-320, -176, -304, 176, POOL_FLOOR, 0);
  tile(304, -176, 320, 176, POOL_FLOOR, 0);
  tile(-304, -176, 304, -152, POOL_FLOOR, -16);             // the step round the inside
  tile(-304, 152, 304, 176, POOL_FLOOR, -16);
  tile(-304, -152, -280, 152, POOL_FLOOR, -16);
  tile(280, -152, 304, 152, POOL_FLOOR, -16);

  // ---- the courtyard (one half, mirrored) ----
  const half = [];
  half.push(box(-480, -400, -432, -304, 18, 'planks'));     // sun loungers
  half.push(box(-480, 304, -432, 400, 18, 'planks'));
  half.push(box(-464, -112, -448, 112, 48, 'stucco'));      // low wall between pool and house
  half.push(box(-560, -420, -500, -360, 40, 'stoneTrim'));  // planters
  half.push(box(-560, 360, -500, 420, 40, 'stoneTrim'));
  half.push(box(-240, 280, -192, 328, 30, 'planks'));       // a table by the pool
  half.push(box(-400, 500, -352, 548, 36, 'crate'));        // garden boxes on the lawns
  half.push(box(-300, -560, -252, -512, 36, 'crate'));
  // inside the house: sofa, table, kitchen counter, fridge
  half.push(box(-880, -360, -848, -200, 32, 'planks'));
  half.push(box(-760, -60, -680, 60, 30, 'planks'));
  half.push(box(-896, 200, -848, 400, 40, 'concrete'));
  half.push(box(-896, 120, -864, 168, 72, 'ventBox'));
  // back garden: a shed and hedges along the paths
  half.push(box(-1088, 560, -992, 640, 96, 'planks'));
  half.push(box(-880, -580, -720, -548, 56, 'grass'));
  half.push(box(-880, 548, -720, 580, 56, 'grass'));
  for (const b of half) out.push(b, mirrorX(b));
  // the pool bar on the north lawn, its roof, and benches on the south lawn
  out.push(box(-96, -608, 96, -512, 104, 'stucco'));
  out.push(box(-128, -624, 128, -480, 12, 'roofTile', 104));
  out.push(box(-160, 560, 160, 584, 18, 'planks'));
  // palm trunks (the trees themselves are props)
  for (const [x, z] of PALMS) out.push(box(x - 9, z - 9, x + 9, z + 9, 220, 'palm'));
  return out;
}

const PALMS = [[-500, -560], [500, 560], [-500, 560], [500, -560], [-400, 250], [400, -250], [-1040, -600], [1040, 600]];

function props(ctx) {
  palmTrees(PALMS, ctx);
}

function spawns() {
  const T = [], CT = [];
  for (let z = -540; z <= 540; z += 120) {
    T.push({ x: -1010, y: 0, z, yaw: -Math.PI / 2 });
    CT.push({ x: 1010, y: 0, z, yaw: Math.PI / 2 });
  }
  const extra = [
    [-750, -300], [-750, 300], [750, -300], [750, 300], [-400, -540], [400, 540], [0, -320], [0, 320],
    [-400, 0], [400, 0], [-700, -520], [700, 520],
  ].map(([x, z]) => ({ x, y: 0, z, yaw: Math.atan2(x, z) }));
  return { T, CT, ffa: [...T, ...CT, ...extra] };
}

export default {
  name: 'fy_poolhouse',
  ambience: 'pool', // the background sound (ambient.js)
  bounds: { minX: -1088, maxX: 1088, minZ: -640, maxZ: 640 },
  boxes: layout,
  spawns,
  props,
  water: [{ min: [-304, POOL_FLOOR, -176], max: [304, SURFACE, 176] }],
  // no weapon menu: knife and pistol, the rest lies around (and can be dropped)
  rules: { guns: 'ground', drops: true, groundGuns: GROUND_GUNS },
  sides: { axis: 'x', T: -1, CT: 1, mid: 300 },
  hideTopsAbove: 200,
  maxFloorY: 120,
  light: {
    sunDir: [0.35, 0.85, 0.4], sun: [1.12, 1.05, 0.9], sky: [0.3, 0.36, 0.46], bounce: [0.24, 0.2, 0.14],
    maxY: 400, gamma: 1.4, indoor: 0.45,
    lamps: [[-752, 168, 0, 0.5, 0.46, 0.38, 340], [752, 168, 0, 0.5, 0.46, 0.38, 340]],
  },
  menuCam: { pan: true, from: [-320, 150, 600], to: [320, 150, 600], look: [0, 0, 0] },
  sky: 'sky',
};

// de_dunetown: an original small bomb defusal map. A sandstone town in the
// desert: Terrorists start in the south, Counter-Terrorists in the north
// between the two bomb sites. Three ways north: A long (west street), mid
// with its double doors, and the B tunnel (east). Short A and a connector
// corridor tie the lanes together; a crawl duct with vent covers runs from the
// connector into the B house.
//
// The town is laid out as open areas (streets, plazas, rooms); everything
// else becomes solid buildings, with stone skirting, cornices and shutters
// added along the street walls.

import { box, stairs, palmTrees } from './kit.js';

const G = 16; // layout grid
const MIN_X = -1728, MAX_X = 1728, MIN_Z = -1600, MAX_Z = 1600;

// [x0, z0, x1, z1, options] — roof: covered at this height; floor: material;
// window: { sill, top } a window hole (glass is added separately)
const OPEN = [
  [-576, 1088, 576, 1536, { floor: 'sand', name: 'tspawn' }],
  [-1664, 1088, -896, 1536, { floor: 'sand' }],             // long corner
  [-896, 1216, -576, 1408, { floor: 'paving', roof: 160 }],  // covered passage to long
  [-1664, -640, -1280, 1088, { floor: 'sand' }],             // A long
  [-1664, -1536, -896, -640, { floor: 'paving' }],           // A site
  [-896, -1472, -512, -1152, { floor: 'paving' }],           // CT to A
  [-512, -1536, 512, -1088, { floor: 'paving' }],            // CT spawn
  [512, -1472, 896, -1152, { floor: 'paving' }],             // CT to B
  [896, -1536, 1664, -640, { floor: 'paving' }],             // B site
  [-224, -1088, 224, 1088, { floor: 'sand' }],               // mid
  [-896, -800, -224, -640, { floor: 'sand' }],               // short A
  [576, 1216, 640, 1408, { floor: 'sand' }],                 // gap to B outside
  [640, 1088, 1664, 1536, { floor: 'sand' }],                // B outside
  [1216, 320, 1600, 1088, { floor: 'sand' }],                // B street
  [1280, -640, 1536, 320, { floor: 'paving', roof: 176 }],   // B tunnel
  [224, -416, 1280, -224, { floor: 'paving', roof: 160 }],   // connector, mid to tunnel
  // A house: a room between short A, A site and the CT path
  [-864, -1120, -544, -832, { floor: 'planks', roof: 160 }],
  [-736, -832, -640, -800, { floor: 'planks', roof: 128 }],  // its door to short A
  [-896, -1040, -864, -944, { floor: 'planks', window: { sill: 40, top: 104 } }],
  [-784, -1152, -688, -1120, { floor: 'planks', window: { sill: 40, top: 104 } }],
  // B house: between B site and CT, reached by the duct
  [544, -1120, 864, -672, { floor: 'planks', roof: 160 }],
  [864, -1008, 896, -912, { floor: 'planks', roof: 128 }],   // door to B site
  [640, -1152, 736, -1120, { floor: 'planks', window: { sill: 40, top: 104 } }],
  [688, -672, 736, -416, { floor: 'paving', roof: 48, duct: true }],
];

// tiny deterministic hash for picking heights / materials per block
const hash = (a, b) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function layout() {
  const nx = (MAX_X - MIN_X) / G, nz = (MAX_Z - MIN_Z) / G;
  // which open area each grid cell belongs to (-1 = solid)
  const cell = new Int16Array(nx * nz).fill(-1);
  OPEN.forEach(([x0, z0, x1, z1], k) => {
    for (let j = (z0 - MIN_Z) / G; j < (z1 - MIN_Z) / G; j++) {
      for (let i = (x0 - MIN_X) / G; i < (x1 - MIN_X) / G; i++) cell[j * nx + i] = k;
    }
  });
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz ? -1 : cell[j * nx + i]);
  const out = [];

  // greedy rectangles over cells matching pred
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

  // floors under the open areas
  for (const mat of ['sand', 'paving', 'planks']) {
    for (const [i, j, w, h] of rects((a, b) => at(a, b) >= 0 && OPEN[at(a, b)][4].floor === mat)) {
      out.push(box(MIN_X + i * G, MIN_Z + j * G, MIN_X + (i + w) * G, MIN_Z + (j + h) * G, 16, mat, -16));
    }
  }

  // buildings: the solid cells, cut into chunks of varied height and finish
  const blocks = [];
  for (const [i, j, w, h] of rects((a, b) => at(a, b) < 0)) {
    const CH = 24; // at most 384 units per chunk
    for (let b = 0; b < h; b += CH) {
      for (let a = 0; a < w; a += CH) {
        const ww = Math.min(CH, w - a), hh = Math.min(CH, h - b);
        const x0 = MIN_X + (i + a) * G, z0 = MIN_Z + (j + b) * G, x1 = x0 + ww * G, z1 = z0 + hh * G;
        const edge = x0 <= MIN_X || z0 <= MIN_Z || x1 >= MAX_X || z1 >= MAX_Z;
        const r = hash(x0, z0);
        const height = edge ? 352 : [256, 288, 288, 320][(r * 4) | 0];
        const mat = ['plaster', 'sandstone', 'plasterB', 'plaster'][(hash(z0, x0) * 4) | 0];
        const blk = box(x0, z0, x1, z1, height, mat);
        out.push(blk);
        blocks.push({ b: blk, i: i + a, j: j + b, w: ww, h: hh });
      }
    }
  }

  // roofs over covered areas, window sills and lintels
  OPEN.forEach(([x0, z0, x1, z1, o]) => {
    if (o.roof) out.push(box(x0, z0, x1, z1, 256 - o.roof, o.duct ? 'concrete' : 'plaster', o.roof));
    if (o.window) {
      out.push(box(x0, z0, x1, z1, o.window.sill, 'sandstone'));
      out.push(box(x0, z0, x1, z1, 256 - o.window.top, 'plaster', o.window.top));
    }
  });

  // street-side details along every building wall that faces open sky
  const covered = (k) => k >= 0 && (OPEN[k][4].roof || OPEN[k][4].window);
  for (const { b, i, j, w, h } of blocks) {
    const top = b.max[1];
    // the four sides: cells just outside, and how to build a box along them
    const sides = [
      { n: w, cellAt: (s) => at(i + s, j - 1), mk: (s0, s1, d, hgt, y0, m) => box(b.min[0] + s0 * G, b.min[2] - d, b.min[0] + s1 * G, b.min[2], hgt, m, y0) },
      { n: w, cellAt: (s) => at(i + s, j + h), mk: (s0, s1, d, hgt, y0, m) => box(b.min[0] + s0 * G, b.max[2], b.min[0] + s1 * G, b.max[2] + d, hgt, m, y0) },
      { n: h, cellAt: (s) => at(i - 1, j + s), mk: (s0, s1, d, hgt, y0, m) => box(b.min[0] - d, b.min[2] + s0 * G, b.min[0], b.min[2] + s1 * G, hgt, m, y0) },
      { n: h, cellAt: (s) => at(i + w, j + s), mk: (s0, s1, d, hgt, y0, m) => box(b.max[0], b.min[2] + s0 * G, b.max[0] + d, b.min[2] + s1 * G, hgt, m, y0) },
    ];
    for (const sd of sides) {
      let s = 0;
      while (s < sd.n) {
        const k = sd.cellAt(s);
        if (k < 0) { s++; continue; }
        let e = s;
        while (e < sd.n && sd.cellAt(e) >= 0 && covered(sd.cellAt(e)) === covered(k)) e++;
        const runLen = (e - s) * G;
        const narrow = OPEN[k][4].roof && OPEN[k][4].roof <= 128;
        if (runLen >= 64 && !narrow && !OPEN[k][4].window) {
          // stop short of inside corners so skirting from the next wall doesn't overlap
          const a0 = s + (sd.cellAt(s - 1) < 0 && s > 0 ? 0.25 : 0), a1 = e - (sd.cellAt(e) < 0 && e < sd.n ? 0.25 : 0);
          out.push(sd.mk(a0, a1, 4, 20, 0, 'stoneTrim'));
          if (!covered(k)) {
            out.push(sd.mk(s, e, 6, 14, top - 30, 'stoneTrim'));
            // shutters and old doors now and then
            for (let p = s + 4; p + 4 <= e - 3; p += 14) {
              const r = hash(b.min[0] + p * 7, b.min[2] - p * 13);
              const d = sd.mk(p, p + 4, 3, 1, 0, 'planks');
              const cx = (d.min[0] + d.max[0]) / 2, cz = (d.min[2] + d.max[2]) / 2;
              if (SIGNS.some((sg) => Math.hypot(sg.x - cx, sg.z - cz) < sg.size)) continue;
              if (r < 0.45) out.push(sd.mk(p, p + 3, 3, 60, 116 + ((r * 100) | 0) % 2 * 40, 'planks'));
              else if (r < 0.58) out.push(sd.mk(p, p + 4, 3, 104, 0, 'planks'));
            }
          }
        }
        s = e;
      }
    }
  }

  // ---- cover and features ----
  // A site: a raised stone platform with steps, crates at the back
  out.push(box(-1472, -1344, -1088, -1024, 40, 'sandstone'));
  stairs(out, -1408, -1024, -1152, -952, 0, 40, '-z', 'sandstone');
  stairs(out, -1088, -1280, -1016, -1088, 0, 40, '-x', 'sandstone');
  out.push(box(-1616, -1232, -1552, -1168, 64, 'crate'));
  out.push(box(-1608, -1224, -1560, -1176, 48, 'crate', 64));
  out.push(box(-1616, -1168, -1552, -1104, 64, 'crate'));
  out.push(box(-1200, -760, -1136, -696, 64, 'crate'));
  // B site: crate stacks and a low wall at the tunnel exit
  out.push(box(1200, -1304, 1264, -1240, 64, 'crate'));
  out.push(box(1200, -1240, 1264, -1176, 64, 'crate'));
  out.push(box(1208, -1296, 1256, -1248, 48, 'crate', 64));
  out.push(box(1456, -1112, 1520, -1048, 64, 'crate'));
  out.push(box(1000, -816, 1160, -784, 48, 'sandstone'));
  out.push(box(1568, -720, 1632, -656, 64, 'crate'));
  // mid: the double doors and some boxes
  out.push(box(-224, -608, -80, -576, 224, 'sandstone'));
  out.push(box(80, -608, 224, -576, 224, 'sandstone'));
  out.push(box(-80, -608, 80, -576, 64, 'planks', 160));
  // the doors themselves: the west one shut, the east one swung open toward
  // CT, and crates stacked behind the gap so the spawns can't see each other
  out.push(box(-80, -596, 0, -588, 160, 'doorWood'));
  out.push(box(72, -676, 80, -596, 160, 'doorWood'));
  out.push(box(-48, -804, 32, -740, 64, 'crate'));
  out.push(box(32, -804, 120, -740, 64, 'crate'));
  out.push(box(-40, -796, 40, -748, 48, 'crate', 64));
  out.push(box(40, -800, 112, -744, 48, 'crate', 64));
  out.push(box(-224, 180, 224, 212, 40, 'stoneTrim', 200)); // arch over mid
  out.push(box(-192, 640, -128, 704, 64, 'crate'));
  out.push(box(96, 300, 160, 364, 64, 'crate'));
  out.push(box(-200, -900, -136, -836, 64, 'crate'));
  // A long: crates to fight around
  out.push(box(-1600, 200, -1536, 264, 64, 'crate'));
  out.push(box(-1360, -200, -1296, -136, 64, 'crate'));
  out.push(box(-1640, 1440, -1576, 1504, 64, 'crate'));
  // T spawn and CT spawn
  out.push(box(-480, 1180, -416, 1244, 64, 'crate'));
  out.push(box(400, 1440, 464, 1504, 64, 'crate'));
  out.push(box(-120, -1240, -56, -1176, 64, 'crate'));
  // connector and tunnel
  out.push(box(1300, 100, 1364, 164, 64, 'crate'));
  out.push(box(900, -400, 948, -352, 48, 'crate'));

  // barrels
  for (const [x, z] of [[-1640, 960], [-1640, 1000], [544, 1500], [1630, 900], [-480, -1500], [1630, -1500], [-880, -1500]]) {
    out.push(box(x - 14, z - 14, x + 14, z + 14, 44, 'barrel'));
  }

  // palm trunks (the trees themselves are props)
  for (const [x, z] of PALMS) out.push(box(x - 9, z - 9, x + 9, z + 9, 220, 'palm'));

  // ---- breakables ----
  const brk = (b, hp) => { b.breakable = true; b.hp = hp; out.push(b); };
  // window panes in the middle of the wall openings
  brk(box(-882, -1040, -878, -944, 64, 'glass', 40), 5);
  brk(box(-784, -1138, -688, -1134, 64, 'glass', 40), 5);
  brk(box(640, -1138, 736, -1134, 64, 'glass', 40), 5);
  // vent covers at both ends of the duct
  brk(box(688, -424, 736, -416, 48, 'grate'), 20);
  brk(box(688, -672, 736, -664, 48, 'grate'), 20);
  // small wooden crates
  for (const [x, z, y] of [[-1440, 600, 0], [-1260, -1180, 40], [-1300, -1060, 40], [1360, -880, 0], [1500, -1300, 0], [140, -1000, 0], [-1520, 1200, 0], [1000, 1200, 0]]) {
    brk(box(x - 20, z - 20, x + 20, z + 20, 40, 'crate', y), 30);
  }
  return out;
}

// painted bomb site letters
const SIGNS = [
  { text: 'A', x: -1663, y: 170, z: -1100, size: 110, face: '+x' },
  { text: 'A', x: -1279, y: 150, z: -560, size: 70, face: '+x' },
  { text: 'B', x: 1663, y: 170, z: -1100, size: 110, face: '-x' },
  { text: 'B', x: 1535, y: 120, z: 200, size: 70, face: '-x' },
];

const PALMS = [[-420, 1400], [500, 1150], [-1560, -1450], [-1000, -800], [1580, -1440], [980, -1460], [0, -1460], [1500, 1300], [-1200, 1460]];

// palm trees (kit.js builds them)
function props(ctx) {
  palmTrees(PALMS, ctx);
}

function spawns() {
  const T = [], CT = [];
  for (const z of [1300, 1430]) for (const x of [-256, -128, 0, 128, 256]) T.push({ x, y: 0, z, yaw: 0 });
  for (const z of [-1300, -1430]) for (const x of [-256, -128, 0, 128, 256]) CT.push({ x, y: 0, z, yaw: Math.PI });
  const extra = [
    [-1470, 700], [-1470, -200], [-1300, -900], [-800, -720], [0, 700], [0, 0], [0, -860],
    [1400, 700], [1400, -100], [1200, -1100], [700, -320], [1100, 1300], [-1300, 1300],
  ].map(([x, z]) => ({ x, y: 0, z, yaw: Math.atan2(x, z) }));
  return { T, CT, ffa: [...T, ...CT, ...extra] };
}

export default {
  name: 'de_dunetown',
  ambience: 'desert', // the background sound (ambient.js)
  bounds: { minX: -1664, maxX: 1664, minZ: -1536, maxZ: 1536 },
  boxes: layout,
  spawns,
  props,
  bombsites: [
    { name: 'A', min: [-1600, -20, -1472], max: [-1024, 220, -960] },
    { name: 'B', min: [1088, -20, -1472], max: [1600, 220, -960] },
  ],
  buyzones: {
    T: [{ min: [-640, -20, 1024], max: [640, 220, 1600] }],
    CT: [{ min: [-576, -20, -1600], max: [576, 220, -1024] }],
  },
  signs: SIGNS,
  bombRadius: 500,
  sides: { axis: 'z', T: 1, CT: -1, mid: 600 },
  hideTopsAbove: 200,
  maxFloorY: 160,
  light: { sunDir: [0.36, 0.86, 0.36], sun: [1.08, 0.97, 0.78], sky: [0.27, 0.3, 0.38], bounce: [0.28, 0.21, 0.13], maxY: 400, gamma: 1.55 },
  modelLight: { sky: 0xe6ecf2, ground: 0x8a7050, hemi: 1.2, sun: 0xfff0d0, sunI: 1.9 },
  menuCam: { pan: true, from: [-260, 130, 1470], to: [260, 130, 1470], look: [0, 90, 0] },
  sky: 'skyDesert',
};

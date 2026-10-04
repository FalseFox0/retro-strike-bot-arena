// awp_rooftops: an original AWP map. Two flat city rooftops face each other
// across a street far below; falling means death. The only way across is a
// narrow plank in the middle. Chimneys, vents, a stair hut, a water tank and a
// raised corner give cover. Everyone gets an AWP, a pistol and a knife.
// Mirrored: Terrorists on the west roof (-x), Counter-Terrorists on the east.

import { box, stairs, mirrorX } from './kit.js';

const STREET = -656; // street level, far below the roofs (y = 0)

function boxes() {
  const out = [];
  const half = [];
  // the building, its tar roof, and the low wall along the street side
  half.push(box(-1024, -640, -192, 640, -16 - STREET, 'facade', STREET));
  half.push(box(-1024, -640, -192, 640, 16, 'roofTar', -16));
  half.push(box(-224, -640, -192, -36, 40, 'stoneTrim'));
  half.push(box(-224, 36, -192, 640, 40, 'stoneTrim'));
  // the taller buildings around it
  half.push(box(-1088, -1664, -192, -640, 192 - STREET, 'brickCity', STREET));
  half.push(box(-1088, 640, -192, 1664, 224 - STREET, 'brickCity', STREET));
  half.push(box(-1152, -640, -1024, 640, 256 - STREET, 'brickCity', STREET));
  // the sidewalk along the street
  half.push(box(-192, -1664, -160, 1664, 8, 'concrete', STREET));

  // cover on the roof
  half.push(box(-800, -176, -640, -16, 128, 'brickCity'));            // stair hut
  half.push(box(-808, -184, -632, -8, 8, 'concrete', 128));
  half.push(box(-420, -500, -372, -452, 104, 'brickCity'));           // chimneys
  half.push(box(-560, 420, -512, 468, 104, 'brickCity'));
  half.push(box(-480, 140, -400, 204, 52, 'ventBox'));                // air conditioners
  half.push(box(-330, -320, -266, -256, 52, 'ventBox'));
  half.push(box(-700, 250, -620, 314, 52, 'ventBox'));
  // water tank up on four legs
  for (const [x, z] of [[-952, 448], [-848, 448], [-952, 552], [-848, 552]]) half.push(box(x - 4, z - 4, x + 4, z + 4, 96, 'steel'));
  half.push(box(-956, 444, -844, 556, 96, 'planks', 96));
  // the raised corner with steps up to it
  half.push(box(-1024, -640, -880, -336, 96, 'brickCity'));
  half.push(box(-1024, -640, -880, -336, 8, 'roofTar', 96));
  stairs(half, -880, -560, -768, -416, 0, 104, '-x', 'concrete');

  for (const b of half) out.push(b, mirrorX(b));
  // the street, and buildings closing off both ends of it
  out.push(box(-192, -1664, 192, 1664, 16, 'asphalt', STREET - 16));
  out.push(box(-192, -1728, 192, -1664, 400 - STREET, 'brickCity', STREET));
  out.push(box(-192, 1664, 192, 1728, 400 - STREET, 'brickCity', STREET));
  // the plank across: a little above the roofs, resting on both of them
  out.push(box(-232, -20, 232, 20, 4, 'planks', -2));
  return out;
}

function spawns() {
  const T = [], CT = [];
  for (const z of [-280, -160, -40, 80, 200, 320]) {
    T.push({ x: -960, y: 0, z, yaw: -Math.PI / 2 });
    CT.push({ x: 960, y: 0, z, yaw: Math.PI / 2 });
  }
  for (const z of [-240, 120, 400, 580]) {
    T.push({ x: -900, y: 0, z, yaw: -Math.PI / 2 });
    CT.push({ x: 900, y: 0, z, yaw: Math.PI / 2 });
  }
  const extra = [[-500, 0], [500, 0], [-400, 560], [400, -560], [-600, -560], [600, 560], [-300, 300], [300, -300]]
    .map(([x, z]) => ({ x, y: 0, z, yaw: Math.atan2(x, z) }));
  return { T, CT, ffa: [...T, ...CT, ...extra] };
}

export default {
  name: 'awp_rooftops',
  ambience: 'city', // the background sound (ambient.js)
  bounds: { minX: -1024, maxX: 1024, minZ: -640, maxZ: 640 },
  // the street and the buildings along it can be seen from the roofs
  drawBounds: { minX: -1152, maxX: 1152, minZ: -1728, maxZ: 1728 },
  boxes,
  spawns,
  // everyone gets an AWP; the street is far enough down to be deadly
  rules: { guns: 'awp' },
  killY: -2000,
  sides: { axis: 'x', T: -1, CT: 1, mid: 300 },
  hideTopsAbove: 160,
  maxFloorY: 200,
  light: {
    sunDir: [-0.82, 0.32, 0.47], sun: [1.3, 0.78, 0.48], sky: [0.24, 0.22, 0.32], bounce: [0.3, 0.18, 0.12],
    maxY: 500, gamma: 1.35,
  },
  modelLight: { sky: 0xc8b8d0, ground: 0x6a5048, hemi: 1.05, sun: 0xffc08a, sunI: 1.8 },
  menuCam: { x: 0, y: 40, z: 0, rx: 820, rz: 520, h: 260 },
  sky: 'skySunset',
};

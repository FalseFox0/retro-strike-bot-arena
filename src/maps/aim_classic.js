// aim_classic: an original aim-style map. Two spawns face each other across an
// open middle with crates, low walls and pillars. It's mirrored for fairness.
// Units are GoldSrc units (about 1 inch), Y is up, T spawn is -X, CT spawn is +X.

import { box } from './kit.js';

function boxes() {
  const out = [];
  const H = 352;
  // floor and outer walls
  out.push(box(-1152, -768, 1152, 768, 16, 'floor', -16));
  out.push(box(-1152, 704, 1152, 768, H, 'wall'));
  out.push(box(-1152, -768, 1152, -704, H, 'wall'));
  out.push(box(-1152, -704, -1088, 704, H, 'wall'));
  out.push(box(1088, -704, 1152, 704, H, 'wall'));
  // skirting along the inside of the walls
  out.push(box(-1088, 696, 1088, 704, 20, 'trim'));
  out.push(box(-1088, -704, 1088, -696, 20, 'trim'));
  out.push(box(-1088, -696, -1080, 696, 20, 'trim'));
  out.push(box(1080, -696, 1088, 696, 20, 'trim'));

  // Centre: tall metal crate stack and two crates on the long axis
  out.push(box(-56, -56, 56, 56, 56, 'mcrate'));
  out.push(box(-48, -48, 48, 48, 56, 'mcrate', 56));
  out.push(box(-32, 288, 32, 352, 64, 'crate'));
  out.push(box(-32, -352, 32, -288, 64, 'crate'));

  // One half of the map (T side, x < 0). Mirrored to the CT side below.
  const half = [];
  for (const s of [1, -1]) {
    // spawn corner crate stacks
    half.push(box(-900, 512 * s, -836, 576 * s, 64, 'crate'));
    half.push(box(-892, 520 * s, -844, 568 * s, 48, 'crate', 64));
    // forward double crates with a small one on top
    half.push(box(-672, 256 * s, -608, 320 * s, 64, 'crate'));
    half.push(box(-672, 320 * s, -608, 384 * s, 64, 'crate'));
    half.push(box(-664, 328 * s, -616, 376 * s, 48, 'crate', 64));
    // mid flank crates (crouch-jumpable)
    half.push(box(-344, 528 * s, -288, 584 * s, 56, 'crate'));
    // pillars near the side walls
    half.push(box(-208, 592 * s, -176, 696 * s, 192, 'concrete'));
    // barrels
    half.push(box(-1066, 654 * s, -1038, 682 * s, 44, 'barrel'));
    half.push(box(-520, 650 * s, -492, 678 * s, 44, 'barrel'));
  }
  // low concrete wall in front of the T approach (wallbangable)
  half.push(box(-424, -144, -408, 144, 48, 'concrete'));
  // small crates covering the low wall's ends
  half.push(box(-488, -208, -440, -160, 48, 'crate'));
  half.push(box(-488, 160, -440, 208, 48, 'crate'));

  for (const b of half) {
    out.push(b);
    out.push({ ...b, min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] });
  }
  return out;
}

function spawns() {
  const zs = [-420, -300, -180, -60, 60, 180, 300, 420];
  const T = zs.map((z) => ({ x: -980, y: 0, z, yaw: -Math.PI / 2 }));
  const CT = zs.map((z) => ({ x: 980, y: 0, z, yaw: Math.PI / 2 }));
  for (const z of [-240, 240]) {
    T.push({ x: -880, y: 0, z, yaw: -Math.PI / 2 });
    CT.push({ x: 880, y: 0, z, yaw: Math.PI / 2 });
  }
  const extra = [
    [-560, 0], [560, 0], [-200, 460], [-200, -460], [200, 460], [200, -460],
    [0, 520], [0, -520], [-760, 0], [760, 0], [-300, 0], [300, 0],
  ].map(([x, z]) => ({ x, y: 0, z, yaw: Math.atan2(x, z) }));
  return { T, CT, ffa: [...T, ...CT, ...extra] };
}

export default {
  name: 'aim_classic',
  ambience: 'breeze', // the background sound (ambient.js)
  bounds: { minX: -1088, maxX: 1088, minZ: -704, maxZ: 704 },
  boxes,
  spawns,
  // bots head for the enemy's half or the middle
  sides: { axis: 'x', T: -1, CT: 1, mid: 500 },
  menuCam: { x: 0, y: 70, z: 0, rx: 820, rz: 520, h: 230 },
  sky: 'sky',
};

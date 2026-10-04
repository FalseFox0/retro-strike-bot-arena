// Map building: turns a map definition (boxes, spawns, bomb sites, props,
// doors, ladders, water) into lightmapped meshes, collision, bot navigation
// and breakable objects.
// Map layouts live in src/maps/. Units are GoldSrc units (about 1 inch), Y is up.

import * as THREE from '../lib/three.module.js';
import { World } from './collision.js';
import { NavGrid } from './nav.js';
import { bakeLightmaps, sampleFace, DEFAULT_LIGHT } from './lightmap.js';
import { Doors } from './doors.js';
import aimClassic from './maps/aim_classic.js';
import dunetown from './maps/de_dunetown.js';
import foundry from './maps/de_foundry.js';
import poolhouse from './maps/fy_poolhouse.js';
import rooftops from './maps/awp_rooftops.js';

export const MAPS = { aim_classic: aimClassic, de_dunetown: dunetown, de_foundry: foundry, fy_poolhouse: poolhouse, awp_rooftops: rooftops };
export const MAP_LIST = Object.keys(MAPS);
// maps with bomb sites can host bomb defusal
export const isBombMap = (name) => !!MAPS[name]?.bombsites;

// Every surface material: texture, tiling (world units per texture, 0 = one
// texture per face), bullet penetration factor, impact sound / colour / decal.
const MATERIALS = {
  floor: { tex: 'floor', world: 128, pen: 0, snd: 'imp_concrete', col: [0.75, 0.66, 0.5], decal: 'concrete', map: '#a99572' },
  wall: { tex: 'wall', world: 128, pen: 0.35, snd: 'imp_concrete', col: [0.8, 0.72, 0.56], decal: 'concrete', map: '#5c5040' },
  trim: { tex: 'trim', world: 64, pen: 0.35, snd: 'imp_concrete', col: [0.5, 0.46, 0.4], decal: 'concrete', map: '#5c5040' },
  concrete: { tex: 'concrete', world: 128, pen: 0.5, snd: 'imp_concrete', col: [0.6, 0.6, 0.56], decal: 'concrete', map: '#8a8780' },
  crate: { tex: 'crate', world: 0, pen: 1, snd: 'imp_wood', col: [0.55, 0.38, 0.2], decal: 'wood', map: '#8a5e30' },
  mcrate: { tex: 'mcrate', world: 0, pen: 0.6, snd: 'imp_metal', col: [1, 0.85, 0.4], decal: 'metal', map: '#5f6e5a' },
  barrel: { tex: 'barrel', world: 0, pen: 0.8, snd: 'imp_metal', col: [1, 0.85, 0.4], decal: 'metal', map: '#7a3424' },
  // desert town
  sand: { tex: 'sand', world: 128, pen: 0, snd: 'imp_concrete', col: [0.82, 0.7, 0.5], decal: 'concrete', map: '#c2a878' },
  paving: { tex: 'paving', world: 128, pen: 0, snd: 'imp_concrete', col: [0.72, 0.64, 0.52], decal: 'concrete', map: '#a8987c' },
  sandstone: { tex: 'sandstone', world: 128, pen: 0.3, snd: 'imp_concrete', col: [0.85, 0.72, 0.52], decal: 'concrete', map: '#8c7454' },
  plaster: { tex: 'plaster', world: 128, pen: 0.4, snd: 'imp_concrete', col: [0.86, 0.76, 0.6], decal: 'concrete', map: '#9a8464' },
  plasterB: { tex: 'plasterB', world: 128, pen: 0.4, snd: 'imp_concrete', col: [0.9, 0.86, 0.78], decal: 'concrete', map: '#a49a88' },
  planks: { tex: 'planks', world: 64, pen: 0.9, snd: 'imp_wood', col: [0.5, 0.36, 0.22], decal: 'wood', map: '#6e5034' },
  stoneTrim: { tex: 'stoneTrim', world: 64, pen: 0.3, snd: 'imp_concrete', col: [0.7, 0.62, 0.5], decal: 'concrete', map: '#7a6a52' },
  glass: { tex: 'glass', world: 0, pen: 1, snd: 'imp_glass', col: [0.8, 0.9, 0.95], decal: 'concrete', map: '#9ab8c4' },
  grate: { tex: 'grate', world: 0, pen: 1, snd: 'imp_metal', col: [0.7, 0.7, 0.7], decal: 'metal', map: '#606468' },
  palm: { tex: 'palmTrunk', world: 0, pen: 0.8, snd: 'imp_wood', col: [0.5, 0.4, 0.28], decal: 'wood', map: '#4c6a30' },
  // steel foundry
  factoryFloor: { tex: 'factoryFloor', world: 128, pen: 0, snd: 'imp_concrete', col: [0.6, 0.6, 0.58], decal: 'concrete', map: '#8c8a84' },
  asphalt: { tex: 'asphalt', world: 128, pen: 0, snd: 'imp_concrete', col: [0.42, 0.42, 0.42], decal: 'concrete', map: '#5a5a5c' },
  brick: { tex: 'brick', world: 128, pen: 0.35, snd: 'imp_concrete', col: [0.6, 0.36, 0.28], decal: 'concrete', map: '#7a4434' },
  corrugated: { tex: 'corrugated', world: 128, pen: 0.6, snd: 'imp_metal', col: [0.7, 0.7, 0.7], decal: 'metal', map: '#7a8690' },
  corrugatedB: { tex: 'corrugatedB', world: 128, pen: 0.6, snd: 'imp_metal', col: [0.7, 0.7, 0.7], decal: 'metal', map: '#8a8676' },
  steel: { tex: 'steel', world: 64, pen: 0.25, snd: 'imp_metal', col: [1, 0.85, 0.4], decal: 'metal', map: '#4a5460' },
  steelYellow: { tex: 'steelYellow', world: 64, pen: 0.25, snd: 'imp_metal', col: [1, 0.85, 0.4], decal: 'metal', map: '#b89030' },
  plate: { tex: 'plate', world: 64, pen: 0.5, snd: 'imp_metal', col: [1, 0.85, 0.4], decal: 'metal', map: '#7c7e82' },
  hazard: { tex: 'hazard', world: 64, pen: 0.35, snd: 'imp_concrete', col: [0.7, 0.6, 0.3], decal: 'concrete', map: '#a08020' },
  containerRed: { tex: 'containerRed', world: 128, pen: 0.6, snd: 'imp_metal', col: [1, 0.85, 0.4], decal: 'metal', map: '#8a3a2c' },
  containerBlue: { tex: 'containerBlue', world: 128, pen: 0.6, snd: 'imp_metal', col: [1, 0.85, 0.4], decal: 'metal', map: '#2c4c74' },
  containerGreen: { tex: 'containerGreen', world: 128, pen: 0.6, snd: 'imp_metal', col: [1, 0.85, 0.4], decal: 'metal', map: '#3c623e' },
  doorMetal: { tex: 'doorMetal', world: 0, pen: 0.7, snd: 'imp_metal', col: [1, 0.85, 0.4], decal: 'metal', map: null },
  doorWood: { tex: 'doorWood', world: 0, pen: 1, snd: 'imp_wood', col: [0.5, 0.42, 0.3], decal: 'wood', map: null },
  // pool villa
  poolTile: { tex: 'poolTile', world: 64, pen: 0, snd: 'imp_concrete', col: [0.6, 0.75, 0.82], decal: 'concrete', map: '#3a96c4' },
  deck: { tex: 'deck', world: 128, pen: 0, snd: 'imp_concrete', col: [0.85, 0.8, 0.7], decal: 'concrete', map: '#d8ccb4' },
  stucco: { tex: 'stucco', world: 128, pen: 0.4, snd: 'imp_concrete', col: [0.9, 0.88, 0.82], decal: 'concrete', map: '#d0c8b8' },
  stuccoB: { tex: 'stuccoB', world: 128, pen: 0.4, snd: 'imp_concrete', col: [0.86, 0.8, 0.68], decal: 'concrete', map: '#b8a888' },
  grass: { tex: 'grass', world: 128, pen: 0, snd: 'imp_wood', col: [0.36, 0.42, 0.24], decal: 'concrete', map: '#5a8a40' },
  roofTile: { tex: 'roofTile', world: 64, pen: 0.4, snd: 'imp_concrete', col: [0.7, 0.4, 0.28], decal: 'concrete', map: '#a85838' },
  parquet: { tex: 'parquet', world: 64, pen: 0.9, snd: 'imp_wood', col: [0.55, 0.4, 0.25], decal: 'wood', map: '#8a5e38' },
  // city rooftops
  roofTar: { tex: 'roofTar', world: 128, pen: 0, snd: 'imp_concrete', col: [0.45, 0.43, 0.4], decal: 'concrete', map: '#6a645c' },
  brickCity: { tex: 'brickCity', world: 128, pen: 0.35, snd: 'imp_concrete', col: [0.55, 0.36, 0.3], decal: 'concrete', map: '#7a5040' },
  facade: { tex: 'facade', world: 128, pen: 0.35, snd: 'imp_concrete', col: [0.55, 0.36, 0.3], decal: 'concrete', map: '#7a5040' },
  ventBox: { tex: 'ventBox', world: 0, pen: 0.6, snd: 'imp_metal', col: [1, 0.85, 0.4], decal: 'metal', map: '#a0a2a0' },
  clip: { tex: null, world: 0, pen: 1, snd: null, col: [0, 0, 0], decal: null, map: null },
};

// What a bullet throws up from each surface (effects.js) and what a footstep
// on it sounds like (game.js): [impact, step]
const SURFACE = {
  floor: ['stone', 'concrete'], wall: ['stone', 'concrete'], trim: ['stone', 'concrete'], concrete: ['stone', 'concrete'],
  crate: ['wood', 'wood'], mcrate: ['metal', 'metal'], barrel: ['metal', 'metal'],
  sand: ['sand', 'sand'], paving: ['stone', 'concrete'], sandstone: ['stone', 'concrete'], plaster: ['stone', 'concrete'],
  plasterB: ['stone', 'concrete'], planks: ['wood', 'wood'], stoneTrim: ['stone', 'concrete'], glass: ['glass', 'tile'],
  grate: ['metal', 'grate'], palm: ['wood', 'wood'],
  factoryFloor: ['stone', 'concrete'], asphalt: ['stone', 'concrete'], brick: ['stone', 'concrete'],
  corrugated: ['metal', 'metal'], corrugatedB: ['metal', 'metal'], steel: ['metal', 'metal'], steelYellow: ['metal', 'metal'],
  plate: ['metal', 'grate'], hazard: ['stone', 'concrete'], containerRed: ['metal', 'metal'], containerBlue: ['metal', 'metal'],
  containerGreen: ['metal', 'metal'], doorMetal: ['metal', 'metal'], doorWood: ['wood', 'wood'],
  poolTile: ['tile', 'tile'], deck: ['stone', 'tile'], stucco: ['stone', 'concrete'], stuccoB: ['stone', 'concrete'],
  grass: ['dirt', 'grass'], roofTile: ['tile', 'tile'], parquet: ['wood', 'wood'],
  roofTar: ['stone', 'concrete'], brickCity: ['stone', 'concrete'], facade: ['stone', 'concrete'], ventBox: ['metal', 'metal'],
  clip: ['stone', 'concrete'],
};

export const PENETRATION = {};
export const IMPACT_SOUND = {};
export const IMPACT_COLOR = {};
export const DECAL_KIND = {};
export const IMPACT_FX = {};
export const STEP_KIND = {};
for (const [k, m] of Object.entries(MATERIALS)) {
  PENETRATION[k] = m.pen;
  IMPACT_SOUND[k] = m.snd;
  IMPACT_COLOR[k] = m.col;
  DECAL_KIND[k] = m.decal;
  IMPACT_FX[k] = SURFACE[k]?.[0] || 'stone';
  STEP_KIND[k] = SURFACE[k]?.[1] || 'concrete';
}

// The 6 faces of a box: normal and 4 corners (counter-clockwise from outside),
// A->B is the texture's U axis and A->D its V axis.
function boxFaces(b) {
  const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
  return [
    [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
    [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
    [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
    [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
  ];
}

// Faces nobody can see: under the floor, outside the map, or flush against
// another solid box.
function hiddenFace(n, c, solid, self, bounds, floorY) {
  if (n[1] === -1 && c[0][1] <= floorY + 0.5) return true; // the underside of floors
  const cx = (c[0][0] + c[2][0]) / 2, cy = (c[0][1] + c[2][1]) / 2, cz = (c[0][2] + c[2][2]) / 2;
  if (cx < bounds.minX - 1 || cx > bounds.maxX + 1 || cz < bounds.minZ - 1 || cz > bounds.maxZ + 1) return true;
  const px = cx + n[0] * 0.5, py = cy + n[1] * 0.5, pz = cz + n[2] * 0.5;
  let hidden = false;
  solid.each(px - 1, pz - 1, px + 1, pz + 1, (b) => {
    if (hidden || b === self || b.seeThrough || b.clip || b.breakable || b.hidden || b.door) return;
    if (px > b.min[0] && px < b.max[0] && py > b.min[1] && py < b.max[1] && pz > b.min[2] && pz < b.max[2]) {
      // only hidden if the whole face is covered
      hidden = c.every((p) => p[0] + n[0] * 0.5 >= b.min[0] && p[0] + n[0] * 0.5 <= b.max[0] && p[1] + n[1] * 0.5 >= b.min[1] && p[1] + n[1] * 0.5 <= b.max[1] && p[2] + n[2] * 0.5 >= b.min[2] && p[2] + n[2] * 0.5 <= b.max[2]);
    }
  });
  return hidden;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];

const WORLD_VS = /* glsl */`
  attribute vec2 lmuv;
  varying vec2 vUv;
  varying vec2 vLm;
  varying vec3 vPos;
  varying vec3 vNrm;
  void main() {
    vUv = uv;
    vLm = lmuv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPos = wp.xyz;
    vNrm = normal;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WORLD_FS = /* glsl */`
  uniform sampler2D map;
  uniform sampler2D lightmap;
  uniform vec3 dlPos[4];
  uniform vec3 dlCol[4];
  uniform float dlRad[4];
  uniform float lmGamma;
  varying vec2 vUv;
  varying vec2 vLm;
  varying vec3 vPos;
  varying vec3 vNrm;
  void main() {
    vec3 albedo = texture2D(map, vUv).rgb;
    vec3 lm = texture2D(lightmap, vLm).rgb;
    // lmGamma > 1 deepens shadows (GoldSrc lit in gamma space)
    vec3 light = pow(lm * lm * 2.0, vec3(lmGamma));
    for (int i = 0; i < 4; i++) {
      if (dlRad[i] <= 0.0) continue;
      vec3 d = dlPos[i] - vPos;
      float dist = length(d);
      float a = max(0.0, 1.0 - dist / dlRad[i]);
      light += dlCol[i] * a * a * max(0.25, dot(vNrm, d / max(dist, 0.001)));
    }
    gl_FragColor = vec4(albedo * light, 1.0);
    #include <colorspace_fragment>
  }
`;

// A painted bomb site letter (spray-stencil look) for walls.
const SIGN_TEX = new Map();
function signTexture(text) {
  if (SIGN_TEX.has(text)) return SIGN_TEX.get(text);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.font = 'bold 104px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(176, 48, 28, 0.92)';
  g.fillText(text, 64, 70);
  // worn paint: knock holes out of it
  g.globalCompositeOperation = 'destination-out';
  let s = text.charCodeAt(0) * 977;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(0,0,0,${0.25 + rnd() * 0.6})`;
    g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 3, 1 + rnd() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  SIGN_TEX.set(text, t);
  return t;
}

// UVs for a box mesh: one texture per face, or world-aligned tiling.
function boxGeometry(b, world) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (const [n, c] of boxFaces(b)) {
    const base = pos.length / 3;
    const ab = sub(c[1], c[0]), ad = sub(c[3], c[0]);
    const U = scale(ab, 1 / len(ab)), V = scale(ad, 1 / len(ad));
    const corner = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let k = 0; k < 4; k++) {
      const p = c[k];
      pos.push(p[0], p[1], p[2]);
      nrm.push(n[0], n[1], n[2]);
      if (world) uv.push((p[0] * U[0] + p[1] * U[1] + p[2] * U[2]) / world, (p[0] * V[0] + p[1] * V[1] + p[2] * V[2]) / world);
      else uv.push(corner[k][0], corner[k][1]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

// A ladder against a wall: (x, z) is the middle of its foot on the wall face,
// `face` the way it faces, `top` the floor you climb up to. The climbable
// volume sticks out from the wall and reaches a little over the top.
const FACES = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };
function makeLadder(l) {
  const [nx, nz] = FACES[l.face];
  const w = l.w ?? 32, depth = 20, y0 = l.y0 ?? 0;
  const ax = Math.abs(nz), az = Math.abs(nx); // along the wall
  const xs = [l.x - ax * w / 2, l.x + ax * w / 2, l.x + nx * depth], zs = [l.z - az * w / 2, l.z + az * w / 2, l.z + nz * depth];
  return {
    ...l, nx, nz, cx: l.x, cz: l.z, y0, w,
    min: [Math.min(...xs, l.x), y0, Math.min(...zs, l.z)],
    max: [Math.max(...xs, l.x), l.top + 40, Math.max(...zs, l.z)],
  };
}

// rails and rungs of every ladder, one mesh
function ladderMesh(ladders, T, shade) {
  const pos = [], nrm = [], uv = [], col = [], idx = [];
  const addBox = (x0, y0, z0, x1, y1, z1, k) => {
    for (const [n, c] of boxFaces({ min: [x0, y0, z0], max: [x1, y1, z1] })) {
      const base = pos.length / 3;
      const ab = sub(c[1], c[0]), ad = sub(c[3], c[0]);
      const lu = len(ab), lv = len(ad);
      [[0, 0], [lu / 32, 0], [lu / 32, lv / 32], [0, lv / 32]].forEach(([u, v], q) => {
        pos.push(...c[q]);
        nrm.push(...n);
        uv.push(u, v);
        col.push(k, k, k);
      });
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  for (const l of ladders) {
    const k = Math.max(0.45, shade(l.cx + l.nx * 24, l.y0 + 1, l.cz + l.nz * 24));
    const ax = Math.abs(l.nz), az = Math.abs(l.nx);
    const off = 4; // rails stand a little off the wall
    const at = (a, d) => [l.cx + ax * a + l.nx * d, l.cz + az * a + l.nz * d];
    for (const s of [-1, 1]) {
      const [x, z] = at(s * (l.w / 2 - 2), off);
      addBox(x - 1.5, l.y0, z - 1.5, x + 1.5, l.top + 40, z + 1.5, k);
    }
    for (let y = l.y0 + 12; y < l.top + 6; y += 14) {
      const [xa, za] = at(-(l.w / 2 - 2), off), [xb, zb] = at(l.w / 2 - 2, off);
      addBox(Math.min(xa, xb) - 0.8, y - 0.8, Math.min(za, zb) - 0.8, Math.max(xa, xb) + 0.8, y + 0.8, Math.max(za, zb) + 0.8, k * 0.92);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshLambertMaterial({ map: T.ladder, vertexColors: true });
  return { mesh: new THREE.Mesh(geo, mat), geo, mat };
}

// What both kinds of map share: the boxes (doors add their own; ladders and
// water don't collide) and the collision world.
function layout(def) {
  const boxes = def.boxes();
  const doors = new Doors(def.doors, boxes);
  const ladders = (def.ladders || []).map(makeLadder);
  const water = def.water || [];
  // breakables start whole; `hp` comes from the layout
  for (const b of boxes) {
    if (b.breakable) {
      b.maxHp = b.hp;
      if (b.mat === 'glass') b.seeThrough = true;
    }
    if (b.mat === 'clip') {
      b.clip = true;
      b.hidden = true;
      b.noFloor = true;
    }
    if (b.mat === 'barrel' || b.mat === 'palm') b.hidden = true;
  }
  const world = new World(boxes);
  world.ladders = ladders;
  world.water = water;
  return { boxes, doors, ladders, water, world };
}

// bots plan as if every door were open; they push closed ones open as they go
function navFor(def, world, doors, ladders) {
  doors.allOff(true);
  const nav = new NavGrid(world, def.bounds, 32, def.maxFloorY ?? Infinity, ladders);
  doors.reset();
  return nav;
}

// The same map without anything to draw (no meshes, lightmap or textures):
// Bot Arena plays its background matches on these.
export function buildWorld(name) {
  const def = MAPS[name] || aimClassic;
  const { boxes, doors, ladders, water, world } = layout(def);
  const breakables = [];
  for (const b of boxes) {
    if (!b.breakable) continue;
    breakables.push({ box: b, mesh: { visible: true } });
    b.piece = breakables[breakables.length - 1];
  }
  const nav = navFor(def, world, doors, ladders);
  const grey = [0.8, 0.8, 0.8];
  return {
    def, name: def.name, world, nav, spawns: def.spawns(), bounds: def.bounds, sky: null, group: null,
    lightAt: () => grey, dynLights: { flash() {}, update() {} }, breakables, doors, ladders, water,
    bombsites: def.bombsites || null,
    buyzones: def.buyzones || null,
    sides: def.sides,
    menuCam: def.menuCam,
    bombRadius: def.bombRadius || 500,
    resetBreakables() {
      for (const p of breakables) {
        p.box.off = false;
        p.box.hp = p.box.maxHp;
      }
    },
    update() {},
    dispose() {},
  };
}

export function buildMap(name, scene, T) {
  const def = MAPS[name] || aimClassic;
  const { boxes, doors, ladders, water, world } = layout(def);
  const bounds = def.bounds;
  // faces outside this aren't drawn (a map can show scenery past where you can walk)
  const viewBounds = def.drawBounds || bounds;
  const light = { ...DEFAULT_LIGHT, ...(def.light || {}) };
  const group = new THREE.Group();
  group.name = 'map';
  const disposables = [];

  // collect visible faces of the solid, drawn boxes and bake their lighting
  const drawn = boxes.filter((b) => !b.hidden && !b.breakable && !b.seeThrough && !b.door);
  const faces = [];
  // roofs nobody can see from the streets aren't drawn or lit
  const topLimit = def.hideTopsAbove ?? Infinity;
  for (const b of drawn) {
    for (const [n, c] of boxFaces(b)) {
      if (n[1] === 1 && c[0][1] > topLimit) continue;
      if (hiddenFace(n, c, world, b, viewBounds, def.floorY ?? 0)) continue;
      const ab = sub(c[1], c[0]), ad = sub(c[3], c[0]);
      const w = len(ab), h = len(ad);
      faces.push({ box: b, n, c, A: c[0], U: scale(ab, 1 / w), V: scale(ad, 1 / h), w, h });
    }
  }
  // what casts baked shadows: solid boxes (and barrels / palm trunks), not glass or crates you can break
  const occluders = boxes.filter((b) => !b.breakable && !b.seeThrough && !b.clip && !b.door);
  const t0 = performance.now();
  const pad = 64;
  const lm = bakeLightmaps(faces, occluders, { minX: viewBounds.minX - pad, maxX: viewBounds.maxX + pad, minZ: viewBounds.minZ - pad, maxZ: viewBounds.maxZ + pad }, light);
  console.info(`${def.name}: ${faces.length} faces baked in ${(performance.now() - t0).toFixed(0)} ms (${lm.W}x${lm.H})`);
  disposables.push(lm.texture);

  // dynamic lights (muzzle flashes), shared by all world materials
  const dl = {
    dlPos: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    dlCol: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    dlRad: { value: [0, 0, 0, 0] },
  };

  const byMat = {};
  const uvCorner = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const f of faces) {
    const a = (byMat[f.box.mat] ||= { pos: [], nrm: [], uv: [], lm: [], idx: [] });
    const S = MATERIALS[f.box.mat].world;
    const base = a.pos.length / 3;
    for (let k = 0; k < 4; k++) {
      const p = f.c[k];
      a.pos.push(p[0], p[1], p[2]);
      a.nrm.push(f.n[0], f.n[1], f.n[2]);
      if (S) {
        // world-aligned tiling: U along the face's U axis, V along its V axis
        const u = p[0] * f.U[0] + p[1] * f.U[1] + p[2] * f.U[2];
        const v = p[0] * f.V[0] + p[1] * f.V[1] + p[2] * f.V[2];
        a.uv.push(u / S, v / S);
      } else {
        a.uv.push(uvCorner[k][0], uvCorner[k][1]);
      }
      const du = k === 1 || k === 2 ? f.w : 0, dv = k === 2 || k === 3 ? f.h : 0;
      a.lm.push((f.ax + 1 + du / f.lu + 0.5) / lm.W, (f.ay + 1 + dv / f.lv + 0.5) / lm.H);
    }
    a.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  for (const mat in byMat) {
    const a = byMat[mat];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(a.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
    geo.setAttribute('lmuv', new THREE.Float32BufferAttribute(a.lm, 2));
    geo.setIndex(a.idx);
    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: T[MATERIALS[mat].tex] }, lightmap: { value: lm.texture }, lmGamma: { value: light.gamma ?? 1 }, ...dl },
      vertexShader: WORLD_VS,
      fragmentShader: WORLD_FS,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    disposables.push(geo, material);
  }

  // upward faces in a grid, for lighting models by what they stand on
  const LG = 128;
  const upCells = new Map();
  for (const f of faces) {
    if (f.n[1] !== 1) continue;
    const b = f.box;
    for (let i = Math.floor(b.min[0] / LG); i <= Math.floor(b.max[0] / LG); i++) {
      for (let j = Math.floor(b.min[2] / LG); j <= Math.floor(b.max[2] / LG); j++) {
        const key = i * 65536 + j;
        if (!upCells.has(key)) upCells.set(key, []);
        upCells.get(key).push(f);
      }
    }
  }
  const lightAt = (x, y, z) => {
    let best = null;
    const list = upCells.get(Math.floor(x / LG) * 65536 + Math.floor(z / LG));
    if (list) {
      for (const f of list) {
        const b = f.box;
        if (x < b.min[0] || x > b.max[0] || z < b.min[2] || z > b.max[2]) continue;
        const top = b.max[1];
        if (top > y + 4) continue;
        if (!best || top > best.box.max[1]) best = f;
      }
    }
    if (!best) return [0.8, 0.8, 0.8];
    return sampleFace(best, x, best.box.max[1], z);
  };
  const shade = (x, y, z) => {
    const L = lightAt(x, y, z);
    return Math.min(1.15, (L[0] + L[1] + L[2]) / 3 / 0.9);
  };

  // Barrels: round visuals, box collision, lit by the floor beneath them
  const barrelGeo = new THREE.CylinderGeometry(14, 14, 44, 14);
  disposables.push(barrelGeo);
  for (const b of boxes) {
    if (b.mat !== 'barrel') continue;
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const k = shade(cx, b.min[1], cz);
    const mats = [
      new THREE.MeshLambertMaterial({ map: T.barrel, color: new THREE.Color(k, k, k) }),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(0x5a2a1c).multiplyScalar(k) }),
      new THREE.MeshLambertMaterial({ color: 0x2a140e }),
    ];
    const m = new THREE.Mesh(barrelGeo, mats);
    m.position.set(cx, b.min[1] + 22, cz);
    group.add(m);
    disposables.push(...mats);
  }

  // Breakables: their own meshes so they can disappear
  const breakables = [];
  for (const b of boxes) {
    if (!b.breakable) continue;
    const m = MATERIALS[b.mat];
    const geo = boxGeometry(b, m.world);
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const k = shade(cx, b.min[1] + 1, cz);
    let mat;
    if (b.mat === 'glass') {
      mat = new THREE.MeshLambertMaterial({ map: T.glass, color: new THREE.Color(k, k, k), transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    } else {
      mat = new THREE.MeshLambertMaterial({ map: T[m.tex], color: new THREE.Color(k * 0.95, k * 0.95, k * 0.95), alphaTest: b.mat === 'grate' ? 0.5 : 0, side: b.mat === 'grate' ? THREE.DoubleSide : THREE.FrontSide });
    }
    const mesh = new THREE.Mesh(geo, mat);
    if (b.mat === 'glass') mesh.renderOrder = 2;
    group.add(mesh);
    disposables.push(geo, mat);
    breakables.push({ box: b, mesh });
    b.piece = breakables[breakables.length - 1];
  }

  // painted bomb site letters (and other signs)
  for (const s of def.signs || []) {
    const geo = new THREE.PlaneGeometry(s.size, s.size);
    const L = lightAt(s.x, s.y - s.size, s.z);
    const k = Math.min(1.1, (L[0] + L[1] + L[2]) / 3 / 0.85);
    const mat = new THREE.MeshBasicMaterial({ map: signTexture(s.text), transparent: true, depthWrite: false, color: new THREE.Color(k, k * 0.97, k * 0.94), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(s.x, s.y, s.z);
    mesh.rotation.y = { '+x': Math.PI / 2, '-x': -Math.PI / 2, '+z': 0, '-z': Math.PI }[s.face];
    group.add(mesh);
    disposables.push(geo, mat);
  }

  // decorations (palm trees and the like)
  if (def.props) def.props({ T, group, shade, lightAt, disposables });

  doors.build(T, group, shade, disposables);
  if (ladders.length) {
    const lm = ladderMesh(ladders, T, shade);
    group.add(lm.mesh);
    disposables.push(lm.geo, lm.mat);
  }

  // water: a see-through surface that drifts slowly, tinted by the light on the pool floor
  const waterMats = [];
  for (const w of water) {
    const sx = w.max[0] - w.min[0], sz = w.max[2] - w.min[2];
    const geo = new THREE.PlaneGeometry(sx, sz);
    geo.rotateX(-Math.PI / 2);
    const uvs = geo.attributes.uv;
    for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * sx / 128, uvs.getY(i) * sz / 128);
    const k = shade((w.min[0] + w.max[0]) / 2, w.min[1] + 1, (w.min[2] + w.max[2]) / 2);
    const map = T.water.clone();
    map.needsUpdate = true;
    const mat = new THREE.MeshLambertMaterial({ map, color: new THREE.Color(0.75 * k, 0.92 * k, 1 * k), transparent: true, opacity: 0.62, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((w.min[0] + w.max[0]) / 2, w.max[1], (w.min[2] + w.max[2]) / 2);
    mesh.renderOrder = 2;
    group.add(mesh);
    waterMats.push(mat);
    disposables.push(geo, mat, map);
  }

  // Sky dome follows the camera.
  const skyGeo = new THREE.SphereGeometry(7000, 24, 12);
  const skyMat = new THREE.MeshBasicMaterial({ map: T[def.sky || 'sky'], side: THREE.BackSide, depthWrite: false, fog: false });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -1;
  scene.add(sky);
  disposables.push(skyGeo, skyMat);

  // Scene lights only affect models (the world uses the lightmap).
  const ml = def.modelLight || {};
  group.add(new THREE.HemisphereLight(ml.sky ?? 0xdfe8f2, ml.ground ?? 0x7a6848, ml.hemi ?? 1.25));
  const sun = new THREE.DirectionalLight(ml.sun ?? 0xfff0d6, ml.sunI ?? 1.7);
  sun.position.set(...light.sunDir);
  group.add(sun);

  scene.add(group);

  const nav = navFor(def, world, doors, ladders);
  const spawns = def.spawns();

  let dlNext = 0;
  const dynLights = {
    // brief light from a muzzle flash
    flash(x, y, z, r = 1.2, g = 0.85, bl = 0.45, radius = 220, life = 0.06) {
      const i = dlNext;
      dlNext = (dlNext + 1) % 4;
      dl.dlPos.value[i].set(x, y, z);
      dl.dlCol.value[i].set(r, g, bl);
      dl.dlRad.value[i] = radius;
      this.life[i] = life;
      this.max[i] = life;
      this.base[i] = [r, g, bl];
    },
    life: [0, 0, 0, 0],
    max: [1, 1, 1, 1],
    base: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
    update(dt) {
      for (let i = 0; i < 4; i++) {
        if (this.life[i] <= 0) continue;
        this.life[i] -= dt;
        if (this.life[i] <= 0) {
          dl.dlRad.value[i] = 0;
          continue;
        }
        const k = this.life[i] / this.max[i];
        const b = this.base[i];
        dl.dlCol.value[i].set(b[0] * k, b[1] * k, b[2] * k);
      }
    },
  };

  return {
    def, name: def.name, world, nav, spawns, bounds, sky, group, lightAt, dynLights, breakables, doors, ladders, water,
    bombsites: def.bombsites || null,
    buyzones: def.buyzones || null,
    sides: def.sides,
    menuCam: def.menuCam,
    bombRadius: def.bombRadius || 500,
    // put every window and crate back (new round)
    resetBreakables() {
      for (const p of breakables) {
        p.box.off = false;
        p.box.hp = p.box.maxHp;
        p.mesh.visible = true;
      }
    },
    // moving water
    update(dt) {
      for (const m of waterMats) {
        m.map.offset.x += dt * 0.018;
        m.map.offset.y += dt * 0.011;
      }
    },
    dispose() {
      scene.remove(group);
      scene.remove(sky);
      for (const d of disposables) d.dispose();
    },
  };
}

// The map from above for the spectator overview: about 1024 px, roofs and
// ceilings left out (above the highest floor), with the bomb sites.
// { canvas, w, h, s, ox, oz }: a world point (x, z) is at (ox + x*s, oz + z*s).
const OVERVIEWS = new Map();
export function mapOverview(name) {
  if (OVERVIEWS.has(name)) return OVERVIEWS.get(name);
  const def = MAPS[name] || aimClassic;
  const b = def.bounds;
  const bw = b.maxX - b.minX + 128, bh = b.maxZ - b.minZ + 128;
  const s = 1024 / Math.max(bw, bh);
  const w = Math.ceil(bw * s), h = Math.ceil(bh * s);
  const ox = -(b.minX - 64) * s, oz = -(b.minZ - 64) * s;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1f18';
  g.fillRect(0, 0, w, h);
  const roof = (def.maxFloorY ?? Infinity) + 60;
  const boxes = def.boxes().filter((x) => MATERIALS[x.mat]?.map && x.min[1] < roof).sort((p, q) => p.max[1] - q.max[1]);
  for (const x of boxes) {
    // walls and higher floors lighter, the ground darker
    const col = new THREE.Color(MATERIALS[x.mat].map).multiplyScalar(0.62 + Math.min(0.55, Math.max(0, x.max[1]) / 420));
    g.fillStyle = '#' + col.getHexString();
    g.fillRect(ox + x.min[0] * s, oz + x.min[2] * s, Math.max(1, (x.max[0] - x.min[0]) * s), Math.max(1, (x.max[2] - x.min[2]) * s));
  }
  for (const site of def.bombsites || []) {
    const x0 = ox + site.min[0] * s, z0 = oz + site.min[2] * s, sw = (site.max[0] - site.min[0]) * s, sh = (site.max[2] - site.min[2]) * s;
    g.fillStyle = 'rgba(255, 90, 58, 0.12)';
    g.fillRect(x0, z0, sw, sh);
    g.strokeStyle = 'rgba(255, 90, 58, 0.8)';
    g.lineWidth = 2;
    g.strokeRect(x0, z0, sw, sh);
    g.fillStyle = 'rgba(255, 110, 80, 0.9)';
    g.font = 'bold 28px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(site.name, x0 + sw / 2, z0 + sh / 2);
  }
  const o = { canvas: c, w, h, s, ox, oz };
  OVERVIEWS.set(name, o);
  return o;
}

// Top-down picture of a map for the Create Game screen.
export function mapPreview(name, w = 220, h = 146) {
  const def = MAPS[name] || aimClassic;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#2b3026';
  g.fillRect(0, 0, w, h);
  const b = def.bounds;
  const bw = b.maxX - b.minX + 128, bh = b.maxZ - b.minZ + 128;
  const s = Math.min(w / bw, h / bh);
  const ox = (w - bw * s) / 2 - (b.minX - 64) * s, oz = (h - bh * s) / 2 - (b.minZ - 64) * s;
  const boxes = def.boxes().filter((x) => MATERIALS[x.mat]?.map).sort((p, q) => p.max[1] - q.max[1]);
  for (const x of boxes) {
    if (x.max[0] < b.minX - 64 || x.min[0] > b.maxX + 64 || x.max[2] < b.minZ - 64 || x.min[2] > b.maxZ + 64) continue;
    // higher boxes are drawn lighter, on top
    const col = new THREE.Color(MATERIALS[x.mat].map).multiplyScalar(0.75 + Math.min(0.6, x.max[1] / 500));
    g.fillStyle = '#' + col.getHexString();
    g.fillRect(ox + x.min[0] * s, oz + x.min[2] * s, Math.max(1, (x.max[0] - x.min[0]) * s), Math.max(1, (x.max[2] - x.min[2]) * s));
  }
  for (const site of def.bombsites || []) {
    g.strokeStyle = 'rgba(255,90,58,0.9)';
    g.lineWidth = 1;
    g.strokeRect(ox + site.min[0] * s, oz + site.min[2] * s, (site.max[0] - site.min[0]) * s, (site.max[2] - site.min[2]) * s);
    g.fillStyle = '#ff5a3a';
    g.font = 'bold 11px sans-serif';
    g.textAlign = 'center';
    g.fillText(site.name, ox + (site.min[0] + site.max[0]) / 2 * s, oz + (site.min[2] + site.max[2]) / 2 * s + 4);
  }
  const sp = def.spawns();
  g.fillStyle = '#ff5a3a';
  for (const p of sp.T) g.fillRect(ox + p.x * s - 1.5, oz + p.z * s - 1.5, 3, 3);
  g.fillStyle = '#7fb4ff';
  for (const p of sp.CT) g.fillRect(ox + p.x * s - 1.5, oz + p.z * s - 1.5, 3, 3);
  return c;
}

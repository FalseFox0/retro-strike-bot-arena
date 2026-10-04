// Low-poly models in the CS 1.6 spirit: characters with a simple skeleton,
// third-person weapons, and the first-person viewmodel with hands and
// keyframed animations. Weapon meshes themselves are in weaponmodels.js.

import * as THREE from '../lib/three.module.js';
import { vfov } from './config.js';
import { lam, boxGeo, cylDown, unitLimb, sphereGeo, helmetGeo, B, put, stretch } from './modelkit.js';
import { buildWeapon, isPistol, isGrenade, isC4 } from './weaponmodels.js';

export { buildWeapon, isPistol, isGrenade, isC4 };

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

// ---------------------------------------------------------------- merging

const _v = new THREE.Vector3();
const _nm = new THREE.Matrix3();

// Merge parts { geo, matrix, rect?, color?, bone? } into one indexed geometry.
// rect = [u0, v0, w, h] squeezes the part's UVs into an atlas region.
function mergeParts(parts, { skin = false, colors = false } = {}) {
  let vCount = 0, iCount = 0;
  for (const p of parts) {
    const n = p.geo.attributes.position.count;
    vCount += n;
    iCount += p.geo.index ? p.geo.index.count : n;
  }
  const pos = new Float32Array(vCount * 3), nrm = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
  const col = colors ? new Float32Array(vCount * 3) : null;
  const si = skin ? new Uint16Array(vCount * 4) : null;
  const sw = skin ? new Float32Array(vCount * 4) : null;
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const p of parts) {
    const g = p.geo, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    _nm.getNormalMatrix(p.matrix);
    // some geometries (extrusions) have UVs outside 0..1: normalise them
    let u0 = 0, u1 = 1, w0 = 0, w1 = 1;
    if (U) {
      let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
      for (let i = 0; i < U.count; i++) {
        const x = U.getX(i), y = U.getY(i);
        if (x < a) a = x;
        if (x > b) b = x;
        if (y < c) c = y;
        if (y > d) d = y;
      }
      if (a < -0.001 || b > 1.001 || c < -0.001 || d > 1.001) { u0 = a; u1 = b; w0 = c; w1 = d; }
    }
    const du = u1 - u0 || 1, dw = w1 - w0 || 1;
    for (let i = 0; i < P.count; i++) {
      const k = vo + i;
      _v.fromBufferAttribute(P, i).applyMatrix4(p.matrix);
      pos[k * 3] = _v.x; pos[k * 3 + 1] = _v.y; pos[k * 3 + 2] = _v.z;
      _v.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
      nrm[k * 3] = _v.x; nrm[k * 3 + 1] = _v.y; nrm[k * 3 + 2] = _v.z;
      let u = U ? (U.getX(i) - u0) / du : 0.5, w = U ? (U.getY(i) - w0) / dw : 0.5;
      if (p.rect) { u = p.rect[0] + u * p.rect[2]; w = p.rect[1] + w * p.rect[3]; }
      uv[k * 2] = u; uv[k * 2 + 1] = w;
      if (col) { col[k * 3] = p.color.r; col[k * 3 + 1] = p.color.g; col[k * 3 + 2] = p.color.b; }
      if (si) { si[k * 4] = p.bone; sw[k * 4] = 1; }
    }
    if (g.index) for (let j = 0; j < g.index.count; j++) idx[io++] = g.index.getX(j) + vo;
    else for (let j = 0; j < P.count; j++) idx[io++] = vo + j;
    vo += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (si) {
    out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// Replace a group's static mesh children with one mesh per material.
function mergeStatic(group, keep = new Set()) {
  const byMat = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh || child.children.length || keep.has(child)) continue;
    child.updateMatrix();
    if (!byMat.has(child.material)) byMat.set(child.material, []);
    byMat.get(child.material).push({ geo: child.geometry, matrix: child.matrix.clone() });
    group.remove(child);
  }
  for (const [mat, parts] of byMat) group.add(new THREE.Mesh(mergeParts(parts), mat));
}

// [u0, v0, w, h] for a pixel region of an atlas canvas (canvas y runs down)
function atlasRect(x, y, w, h, W, H, inset = 1.5) {
  return [(x + inset) / W, 1 - (y + h - inset) / H, (w - inset * 2) / W, (h - inset * 2) / H];
}

function atlasTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  return t;
}

// One texture per team look holding every character material.
const CHAR_ATLAS = {};
const CHAR_GEO = {};

// Hacker mode. The red glow around a hacker: the body blown up a little along
// its normals, bright at the edges, added on top (walls still hide it).
// One material for everyone; hackPulse() makes it breathe.
const GLOW_PULSE = { value: 1 };
let glowMat = null;
function hackGlowMaterial() {
  if (glowMat) return glowMat;
  const m = new THREE.MeshBasicMaterial({ color: 0xff2a14, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  m.onBeforeCompile = (s) => {
    s.uniforms.pulse = GLOW_PULSE;
    s.vertexShader = 'varying vec3 vRimN;\nvarying vec3 vRimV;\n' + s.vertexShader
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n\ttransformed += normalize( objectNormal ) * 1.7;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tvRimN = normalize( transformedNormal );\n\tvRimV = - mvPosition.xyz;');
    s.fragmentShader = 'uniform float pulse;\nvarying vec3 vRimN;\nvarying vec3 vRimV;\n' + s.fragmentShader
      .replace('#include <opaque_fragment>', 'float rim = 1.0 - abs( dot( normalize( vRimN ), normalize( vRimV ) ) );\n\tgl_FragColor = vec4( outgoingLight, ( 0.1 + 0.8 * pow( rim, 1.5 ) ) * pulse );');
  };
  m.customProgramCacheKey = () => 'hackglow';
  glowMat = m;
  return m;
}
export function hackPulse(k) {
  GLOW_PULSE.value = k;
}
function charAtlas(look, T) {
  if (CHAR_ATLAS[look]) return CHAR_ATLAS[look];
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const isT = look === 'T';
  const camo = (isT ? T.camoT : T.camoCT).image;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.drawImage(camo, i * 64, j * 64);
      ctx.drawImage(camo, 128 + i * 64, j * 64);
    }
  }
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = isT ? '#d8cdb8' : '#c4c8d4';
  ctx.fillRect(128, 0, 128, 128);
  ctx.globalCompositeOperation = 'source-over';
  const vest = (isT ? T.vestT : T.vestCT).image;
  ctx.drawImage(vest, 0, 128);
  ctx.drawImage(vest, 64, 128);
  ctx.drawImage((isT ? T.headT : T.headCT).image, 128, 128);
  const rects = {
    camo: atlasRect(0, 0, 128, 128, S, S),
    shirt: atlasRect(128, 0, 128, 128, S, S),
    vest: atlasRect(0, 128, 128, 64, S, S),
    head: atlasRect(128, 128, 128, 64, S, S, 0.5),
  };
  const swatches = { boots: isT ? '#3a2c1e' : '#18181a', gloves: isT ? '#2e2620' : '#161719', gear: isT ? '#4a3c28' : '#23272e', helmet: '#2e3644', skin: '#c69676' };
  let x = 0;
  for (const [k, colr] of Object.entries(swatches)) {
    ctx.fillStyle = colr;
    ctx.fillRect(x, 192, 32, 32);
    rects[k] = atlasRect(x, 192, 32, 32, S, S, 8);
    x += 32;
  }
  return (CHAR_ATLAS[look] = { texture: atlasTexture(c), rects });
}

// One texture for every weapon surface (third-person weapons are a single mesh).
let WEAPON_ATLAS = null;
export function weaponAtlas(T) {
  if (WEAPON_ATLAS) return WEAPON_ATLAS;
  // Bot Arena's background matches draw nothing: no textures, no atlas
  if (T.headless) return (WEAPON_ATLAS = { texture: null, rectFor: () => [0, 0, 1, 1] });
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const slots = [[T.gunmetal, 0, 0], [T.polymer, 64, 0], [T.silver, 128, 0], [T.awpGreen, 192, 0], [T.gunWood, 0, 64]];
  const rects = new Map();
  for (const [tex, x, y] of slots) {
    ctx.drawImage(tex.image, x, y);
    rects.set(tex, atlasRect(x, y, 64, 64, W, H, 2));
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(64, 64, 64, 64);
  const white = atlasRect(64, 64, 64, 64, W, H, 8);
  WEAPON_ATLAS = { texture: atlasTexture(c), rectFor: (map) => rects.get(map) || white };
  return WEAPON_ATLAS;
}

// Third-person weapons: the whole gun merged into one mesh (shared geometry).
const TP_CACHE = new Map();
export function thirdPersonWeapon(id, T) {
  if (TP_CACHE.has(id)) return TP_CACHE.get(id);
  const w = buildWeapon(id, T);
  w.group.updateMatrixWorld(true);
  const atlas = weaponAtlas(T);
  const collect = (withSilencer) => {
    const parts = [];
    w.group.traverse((o) => {
      if (!o.isMesh || (o === w.silencer && !withSilencer)) return;
      parts.push({ geo: o.geometry, matrix: o.matrixWorld.clone(), rect: atlas.rectFor(o.material.map), color: o.material.color });
    });
    return mergeParts(parts, { colors: true });
  };
  const entry = {
    plain: collect(false),
    sil: w.silencer ? collect(true) : null,
    muzzle: w.baseMuzzle.clone(),
    silMuzzle: w.silMuzzle ? w.silMuzzle.clone() : null,
    eject: w.eject.position.clone(),
  };
  TP_CACHE.set(id, entry);
  return entry;
}

// ---------------------------------------------------------------- characters

// the Bot Arena color band (an open ring a little wider than the upper arm)
let MARK_GEO = null;
const markGeo = () => (MARK_GEO ||= new THREE.CylinderGeometry(3.2, 3.2, 2.8, 12, 1, true));

// A body that is never drawn: Bot Arena's background matches have no
// graphics, but the game still asks every player's model for things.
export class NullModel {
  constructor() {
    this.root = new THREE.Group();
    this.deadT = 0;
    this.fallDir = 1;
    this.fallSide = 0;
    this.recoil = 0;
  }

  worldPoint(which, out) {
    return out.copy(this.root.position);
  }

  setChams() {}
  setHackGlow() {}
  setBomb() {}
  setWeapon() {}
  setGlow() {}
  setMark() {}
  setLight() {}
  showFlash() {}
  play() {}
  flinch() {}
  update() {}
  dispose() {}
}

// Third-person character: every body part is merged into ONE skinned mesh
// (one draw call) driven by a small skeleton; the weapon is a second mesh.
export class CharacterModel {
  constructor(look, T) {
    this.T = T;
    this.root = new THREE.Group();
    const atlas = charAtlas(look, T);
    this.material = lam({ map: atlas.texture });
    this.weaponMat = lam({ map: weaponAtlas(T).texture, vertexColors: true });
    this.weapons = {};
    this.weaponId = null;
    this.phase = 0;
    this.deadT = 0;
    this.fallDir = 1;
    this.fallSide = 0;
    this.recoil = 0;
    this.light = 1;
    this.act = null;        // what the hands are doing: reload, throw, knife swing, plant...
    this.slashSide = 1;
    this.legYaw = 0;        // the legs turn toward where we walk
    this.backward = false;
    this.flinchX = 0;       // a hit jolts the upper body (pitch, roll) and the head
    this.flinchZ = 0;
    this.flinchHead = 0;
    this.kneel = 0;         // 0..1, kneeling to plant or defuse the bomb
    this.bones = [];
    const bone = (parent, x, y, z) => {
      const b = new THREE.Bone();
      b.position.set(x, y, z);
      parent.add(b);
      this.bones.push(b);
      return b;
    };
    const parts = [];
    const tmp = new THREE.Object3D();
    const add = (b, geo, region, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      tmp.position.set(x, y, z);
      tmp.rotation.set(rx, ry, rz);
      tmp.scale.set(sx, sy, sz);
      tmp.updateMatrix();
      parts.push({ b, geo, region, m: tmp.matrix.clone() });
    };
    const addLimb = (b, a, c, r1, r2, region) => {
      stretch(tmp, new THREE.Vector3(...a), new THREE.Vector3(...c));
      tmp.updateMatrix();
      parts.push({ b, geo: unitLimb(r1, r2, 8), region, m: tmp.matrix.clone() });
    };
    const isT = look === 'T';

    this.body = bone(this.root, 0, 0, 0);
    // legs: pelvis (turns toward where we walk) -> hip -> thigh -> knee -> shin -> boot
    this.pelvis = bone(this.body, 0, 0, 0);
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = bone(this.pelvis, side * 4.4, 33, 0);
      add(hip, cylDown(3.9, 3.3, 16.5, 8), 'camo', 0, 0, 0);
      const knee = bone(hip, 0, -16.5, 0);
      add(knee, cylDown(3.25, 2.7, 13, 8), 'camo', 0, 0, 0);
      if (!isT) add(knee, boxGeo(4.4, 3.6, 2), 'gear', 0, -1, -2.7);
      add(knee, boxGeo(5.4, 4.2, 9), 'boots', 0, -14.4, -1.3);
      add(knee, boxGeo(5.0, 2.6, 2.4), 'boots', 0, -15.2, -5.4);
      this.legs.push({ hip, knee });
    }

    // torso pivots at the hips
    this.torso = bone(this.body, 0, 33, 0);
    add(this.torso, cylDown(7.6, 7.2, 6, 10), 'camo', 0, 5.5, 0, 0, 0, 0, 1, 1, 0.66);
    add(this.torso, cylDown(8.0, 7.4, 7, 10), 'shirt', 0, 12, 0, 0, 0, 0, 1, 1, 0.64);
    add(this.torso, cylDown(9.8, 8.6, 12, 10), 'vest', 0, 23.5, 0, 0, 0, 0, 1, 1, 0.66);
    add(this.torso, cylDown(8.4, 8.4, 1.6, 10), 'gear', 0, 6.2, 0, 0, 0, 0, 1, 1, 0.7);
    for (const x of [-4.5, 0, 4.5]) add(this.torso, boxGeo(3.4, 3.6, 1.6), 'gear', x, 15.5, -6.3);
    if (isT) add(this.torso, boxGeo(2.2, 15, 1.2), 'gear', 0, 17, -6.5, 0, 0, 0.7); // bandolier
    add(this.torso, sphereGeo(8, 6), 'shirt', -9.2, 21.5, 0, 0, 0, 0, 3.2, 3.2, 3.4);
    add(this.torso, sphereGeo(8, 6), 'shirt', 9.2, 21.5, 0, 0, 0, 0, 3.2, 3.2, 3.4);
    add(this.torso, cylDown(2.5, 2.7, 3, 8), isT ? 'head' : 'skin', 0, 26.5, 0);

    this.head = bone(this.torso, 0, 25, 0);
    // the face is painted at u = 0.25, so turn the sphere around
    add(this.head, sphereGeo(12, 10), 'head', 0, 5, -0.4, 0, Math.PI, 0, 5.1, 6.4, 5.6);
    if (!isT) {
      add(this.head, helmetGeo(), 'helmet', 0, 7.2, 0, 0, 0, 0, 6.0, 5.6, 6.4);
      add(this.head, cylDown(6.1, 6.3, 0.8, 12), 'helmet', 0, 7.6, 0, 0, 0, 0, 1, 1, 1.05);
    }

    // arms + weapon, pitched with the aim; two arm poses on separate bones,
    // each with the left arm on its own shoulder bone (it fetches magazines)
    this.arms = bone(this.body, 0, 53, 0);
    this.rifleArms = bone(this.arms, 0, 0, 0);
    this.pistolArms = bone(this.arms, 0, 0, 0);
    for (const g of [this.rifleArms, this.pistolArms]) {
      addLimb(g, [9.2, 0.5, 0.5], [8.8, -8.5, -6], 2.9, 2.5, 'shirt');
      addLimb(g, [8.8, -8.5, -6], [3.4, -5, -14.5], 2.5, 2.1, 'shirt');
      add(g, boxGeo(2.8, 3.2, 3.2), 'gloves', 3, -5.4, -15.4);
    }
    const SH = [-9.2, 0.5, 0.5]; // left shoulder
    const fromSh = (v) => [v[0] - SH[0], v[1] - SH[1], v[2] - SH[2]];
    this.rifleLeft = bone(this.rifleArms, ...SH);
    this.pistolLeft = bone(this.pistolArms, ...SH);
    addLimb(this.rifleLeft, fromSh(SH), fromSh([-8, -10, -13]), 2.9, 2.5, 'shirt');
    addLimb(this.rifleLeft, fromSh([-8, -10, -13]), fromSh([-0.4, -4.8, -27]), 2.5, 2.1, 'shirt');
    add(this.rifleLeft, boxGeo(3, 2.8, 3.4), 'gloves', ...fromSh([-0.2, -4.6, -28]));
    addLimb(this.pistolLeft, fromSh(SH), fromSh([-8, -9, -7]), 2.9, 2.5, 'shirt');
    addLimb(this.pistolLeft, fromSh([-8, -9, -7]), fromSh([1.8, -6.5, -15]), 2.5, 2.1, 'shirt');
    add(this.pistolLeft, boxGeo(2.8, 3.0, 3.2), 'gloves', ...fromSh([2.4, -6.6, -15.2]));
    this.gunMount = new THREE.Group();
    this.gunMount.position.set(3, -4, -15);
    this.arms.add(this.gunMount);

    this.root.updateMatrixWorld(true);
    // every T (or CT) has the same body, so the merged geometry is shared
    if (!CHAR_GEO[look]) {
      const merged = mergeParts(parts.map((p) => ({
        geo: p.geo,
        matrix: new THREE.Matrix4().multiplyMatrices(p.b.matrixWorld, p.m),
        rect: atlas.rects[p.region],
        bone: this.bones.indexOf(p.b),
      })), { skin: true });
      merged.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 20, 0), 90);
      CHAR_GEO[look] = merged;
    }
    const geo = CHAR_GEO[look];
    this.mesh = new THREE.SkinnedMesh(geo, this.material);
    this.root.add(this.mesh);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    // generous bounds so a body lying on the floor isn't culled
    this.mesh.boundingSphere = geo.boundingSphere.clone();
    // drawn after the wallhack's colored body (see setChams)
    this.mesh.renderOrder = 2;
    this.chams = null;
    this.chamsHex = 0;
    this.hackGlow = null;

    const flashMat = new THREE.SpriteMaterial({ map: T.flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.flash = new THREE.Sprite(flashMat);
    this.flash.scale.set(16, 16, 1);
    this.flash.visible = false;
    this.root.add(this.flash);

    // the bomb carried on the back, like in 1.6
    this.backpack = new THREE.Mesh(thirdPersonWeapon('c4', T).plain, this.weaponMat);
    this.backpack.position.set(0, 14, 7.6);
    this.backpack.rotation.set(Math.PI / 2, 0, 0);
    this.backpack.visible = false;
    this.backpack.renderOrder = 2;
    this.torso.add(this.backpack);
  }

  // A second copy of the body on the same skeleton, used by hacker mode.
  skinCopy(material, renderOrder) {
    const m = new THREE.SkinnedMesh(this.mesh.geometry, material);
    m.bind(this.mesh.skeleton, this.mesh.bindMatrix);
    m.boundingSphere = this.mesh.boundingSphere.clone();
    m.renderOrder = renderOrder;
    this.root.add(m);
    return m;
  }

  // Wallhack: the body in a flat bright color, only where something solid
  // hides it. It's drawn after the world and before the real models (which
  // are drawn last) with "greater" depth, so only the hidden parts show.
  // floorY: nothing below the feet (boots dip into the floor a little when walking)
  setChams(hex, floorY = 0) {
    if (this.chams) this.chams.userData.floor.value = floorY;
    if (this.chamsHex === hex) return;
    this.chamsHex = hex;
    if (!hex) {
      if (this.chams) this.chams.visible = false;
      return;
    }
    if (!this.chams) {
      const floor = { value: floorY };
      const mat = new THREE.MeshLambertMaterial({ depthFunc: THREE.GreaterDepth, depthWrite: false });
      mat.onBeforeCompile = (s) => {
        s.uniforms.chamsFloor = floor;
        s.vertexShader = 'varying float vChamsY;\n' + s.vertexShader
          .replace('#include <project_vertex>', '#include <project_vertex>\n\tvChamsY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;');
        s.fragmentShader = 'uniform float chamsFloor;\nvarying float vChamsY;\n' + s.fragmentShader
          .replace('void main() {', 'void main() {\n\tif ( vChamsY < chamsFloor ) discard;');
      };
      mat.customProgramCacheKey = () => 'chams';
      this.chams = this.skinCopy(mat, 1);
      this.chams.userData.floor = floor;
    }
    const m = this.chams.material;
    m.color.setHex(hex).multiplyScalar(0.5);
    m.emissive.setHex(hex).multiplyScalar(0.62);
    this.chams.visible = true;
  }

  // a hacker's red glow
  setHackGlow(on) {
    if (!on && !this.hackGlow) return;
    if (!this.hackGlow) this.hackGlow = this.skinCopy(hackGlowMaterial(), 3);
    this.hackGlow.visible = on;
  }

  setBomb(on) {
    this.backpack.visible = on;
  }

  setWeapon(id, silenced) {
    if (this.weaponId !== id) {
      if (this.weaponId && this.weapons[this.weaponId]) this.weapons[this.weaponId].group.visible = false;
      if (!this.weapons[id]) {
        const tp = thirdPersonWeapon(id, this.T);
        const group = new THREE.Group();
        const mesh = new THREE.Mesh(tp.plain, this.weaponMat);
        mesh.renderOrder = 2;
        const muzzle = new THREE.Object3D(), eject = new THREE.Object3D();
        muzzle.position.copy(tp.muzzle);
        eject.position.copy(tp.eject);
        group.add(mesh, muzzle, eject);
        if (isGrenade(id)) group.position.set(-0.5, 1.5, 0.5);
        else if (isC4(id)) group.position.set(-1, 0.5, 1);
        this.gunMount.add(group);
        this.weapons[id] = { group, mesh, muzzle, eject, tp, sil: false };
      }
      this.weapons[id].group.visible = true;
      this.weaponId = id;
      const small = isPistol(id) || isGrenade(id) || isC4(id) || id === 'knife';
      this.rifleArms.scale.setScalar(small ? 1e-4 : 1);
      this.pistolArms.scale.setScalar(small ? 1 : 1e-4);
      this.gunMount.position.set(3, small ? -4.5 : -4, small ? -15.5 : -15);
    }
    const w = this.weapons[id];
    const sil = !!silenced && !!w.tp.sil;
    if (w.sil !== sil) {
      w.sil = sil;
      w.mesh.geometry = sil ? w.tp.sil : w.tp.plain;
      w.muzzle.position.copy(sil ? w.tp.silMuzzle : w.tp.muzzle);
    }
  }

  setGlow(hex) {
    if (this.glow === hex) return;
    this.glow = hex;
    this.material.emissive.setHex(hex || 0);
  }

  // Bot Arena: a character's own color, as a band round each upper arm (on
  // both arm poses; the pose not in use is shrunk away with its bands)
  setMark(hex) {
    if (this.markHex === hex) return;
    this.markHex = hex;
    if (!this.marks) {
      if (!hex) return;
      this.markMat = new THREE.MeshLambertMaterial();
      this.marks = [];
      const SH = [-9.2, 0.5, 0.5];
      const rightArm = [[9.2, 0.5, 0.5], [8.8, -8.5, -6]];
      for (const [bone, [a, c]] of [
        [this.rifleArms, rightArm], [this.pistolArms, rightArm],
        [this.rifleLeft, [[0, 0, 0], [-8 - SH[0], -10 - SH[1], -13 - SH[2]]]],
        [this.pistolLeft, [[0, 0, 0], [-8 - SH[0], -9 - SH[1], -7 - SH[2]]]],
      ]) {
        const from = new THREE.Vector3(...a), dir = new THREE.Vector3(...c).sub(from);
        const m = new THREE.Mesh(markGeo(), this.markMat);
        m.position.copy(from).addScaledVector(dir, 0.3);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        m.renderOrder = 2;
        bone.add(m);
        this.marks.push(m);
      }
    }
    for (const m of this.marks) m.visible = !!hex;
    if (hex) {
      this.markMat.color.setHex(hex);
      // a little light of its own so the color reads in the shade too
      this.markMat.emissive.setHex(hex).multiplyScalar(0.35);
    }
  }

  // free what belongs to this instance (geometry and atlases are shared)
  dispose() {
    this.mesh.skeleton.dispose();
    this.material.dispose();
    if (this.chams) this.chams.material.dispose();
    if (this.markMat) this.markMat.dispose();
    this.weaponMat.dispose();
    this.flash.material.dispose();
  }

  // darken the model by the light it stands in (GoldSrc style)
  setLight(k) {
    if (Math.abs(this.light - k) < 0.02) return;
    this.light = k;
    this.material.color.setScalar(k);
    this.weaponMat.color.setScalar(k);
  }

  showFlash() {
    this.recoil = 1;
    const w = this.weapons[this.weaponId];
    if (!w || this.weaponId === 'knife') return;
    this.root.updateMatrixWorld(true);
    w.muzzle.getWorldPosition(this.flash.position);
    this.root.worldToLocal(this.flash.position);
    this.flash.material.rotation = Math.random() * Math.PI;
    this.flash.visible = true;
    this.flashTime = 0.05;
  }

  worldPoint(which, out) {
    const w = this.weapons[this.weaponId];
    if (!w) return out.copy(this.root.position).setY(this.root.position.y + 50);
    this.root.updateMatrixWorld(true);
    return (which === 'eject' ? w.eject : w.muzzle).getWorldPosition(out);
  }

  // What the hands do, seen from outside (the same events as ViewModel.play):
  // reload, deploy, silencer, knife slash / stab, grenade pin and throw, planting
  play(type, now, arg) {
    if (type === 'plant_stop') {
      if (this.act && this.act.type === 'plant') this.act = null;
      return;
    }
    const dur = { deploy: Math.min(arg || 0.75, 0.6), reload: arg || 2.5, silencer: arg || 2, slash: 0.32, stab: 0.6, sg_insert: arg || 0.45, pullpin: 0.5, throw: 0.55, plant: arg || 3 }[type];
    if (!dur) return; // firing has its own kick (recoil)
    if (type === 'slash') this.slashSide = -this.slashSide;
    this.act = { type, start: now, dur };
  }

  // hit by a bullet or blast travelling along dir (world): the upper body
  // jolts a little with it, and a headshot snaps the head back
  flinch(dir, yaw, head) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const lx = dir.x * c - dir.z * s, lz = dir.x * s + dir.z * c;
    this.flinchX = Math.max(-0.2, Math.min(0.2, this.flinchX + lz * 0.13));
    this.flinchZ = Math.max(-0.16, Math.min(0.16, this.flinchZ - lx * 0.1));
    this.flinchHead = Math.min(0.6, this.flinchHead + (head ? 0.5 : 0.07));
  }

  // st: { dt, now, speed, vx, vz, yaw, duck (0..1), pitch, onGround, alive, pinOut, defusing }
  update(st) {
    const dt = st.dt;
    if (this.flash.visible) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) this.flash.visible = false;
    }
    this.recoil = Math.max(0, this.recoil - dt * 12);
    // a hit wears off quickly
    const fk = Math.exp(-dt * 9);
    this.flinchX *= fk;
    this.flinchZ *= fk;
    this.flinchHead *= Math.exp(-dt * 7);
    if (!st.alive) {
      this.act = null;
      this.kneel = 0;
      this.deathPose(dt);
      return;
    }
    this.deadT = 0;
    this.body.rotation.set(0, 0, 0);
    this.body.position.y = 0;
    const now = st.now;
    const a = this.act && now - this.act.start < this.act.dur && now >= this.act.start - 0.05 ? this.act : null;
    if (!a) this.act = null;
    // down on one knee to plant or defuse the bomb
    this.kneel += ((st.defusing || (a && a.type === 'plant') ? 1 : 0) - this.kneel) * Math.min(1, dt * 8);
    const kn = this.kneel < 0.002 ? 0 : this.kneel;
    const f = st.duck * (1 - kn);
    const spd = Math.min(1, st.speed / 250);

    // the legs walk the way we move: the pelvis turns toward it (up to about
    // 57°), the rest is a side step; walking backward runs the cycle in reverse
    let wantYaw = 0, wantSide = 0;
    if (st.speed > 20 && st.onGround) {
      const c = Math.cos(st.yaw), s = Math.sin(st.yaw);
      const fwd = -(st.vx * s + st.vz * c), right = st.vx * c - st.vz * s;
      let ang = Math.atan2(right, fwd); // 0: forward, +pi/2: right
      this.backward = Math.abs(ang) > (this.backward ? 1.3 : 1.85);
      if (this.backward) ang -= Math.PI * Math.sign(ang);
      const turn = Math.max(-1, Math.min(1, ang * 0.7));
      wantYaw = -turn;
      wantSide = ang - turn;
    }
    const lk = Math.min(1, dt * 10);
    this.legYaw += (wantYaw - this.legYaw) * lk;
    this.legSide = (this.legSide || 0) + (wantSide - (this.legSide || 0)) * lk;
    this.pelvis.rotation.y = this.legYaw * (1 - kn);
    if (st.onGround) this.phase += st.speed * dt * 0.072 * (this.backward ? -1 : 1);
    const swing = st.onGround ? Math.sin(this.phase) * 0.62 * spd : 0;
    const air = st.onGround ? 0 : 1;
    const hipY = 33 - 16.5 * f - 14 * kn;
    const sc = Math.cos(this.legSide), ss = Math.sin(this.legSide);
    for (let i = 0; i < 2; i++) {
      const l = this.legs[i];
      const s = i === 0 ? swing : -swing;
      l.hip.position.y = hipY;
      let hx = 1.45 * f + s * (1 - f * 0.6) * sc + (i === 0 ? 0.5 : 0.25) * air;
      let hz = s * ss * 0.55;
      const back = Math.max(0, -Math.sin(this.phase + (i === 0 ? 0 : Math.PI))) * spd;
      let kx = -2.0 * f - back * 1.15 * (1 - f) - (i === 0 ? 0.9 : 0.5) * air;
      if (kn) {
        // the left foot planted in front, the right knee on the ground
        hx += ((i === 0 ? 1.5 : 0.15) - hx) * kn;
        kx += ((i === 0 ? -1.5 : -1.55) - kx) * kn;
        hz *= 1 - kn;
      }
      l.hip.rotation.set(hx, 0, hz);
      l.knee.rotation.x = kx;
    }
    const bob = st.onGround ? Math.abs(Math.sin(this.phase)) * 1.1 * spd * (1 - f) * (1 - kn) : 0;

    // the hands: aim, then whatever action is playing
    let ax = st.pitch + this.recoil * 0.05, ay = 0, az = 0, py = 0, pz = 0, gz = 0, lx = 0, ly = 0, twist = 0;
    let hideGun = false;
    if (a && now >= a.start) {
      const t = (now - a.start) / a.dur;
      const s = Math.sin(t * Math.PI);
      switch (a.type) {
        case 'reload':
          // tip the gun, the left hand fetches a magazine from the belt
          gz = kf(t, [[0, 0], [0.12, 0.45], [0.8, 0.45], [0.95, 0]]);
          ax -= kf(t, [[0, 0], [0.12, 0.3], [0.8, 0.3], [0.95, 0]]);
          lx = kf(t, [[0.08, 0], [0.22, -0.95], [0.34, -1.0], [0.5, -0.2], [0.6, 0]]);
          ly = kf(t, [[0.08, 0], [0.22, 0.25], [0.5, 0.1], [0.6, 0]]);
          break;
        case 'sg_insert':
          lx = kf(t, [[0, 0], [0.3, -0.6], [0.6, -0.1], [0.9, 0]]);
          gz = 0.2;
          break;
        case 'silencer':
          gz = s * 0.3;
          ly = -s * 0.3;
          lx = -s * 0.15;
          break;
        case 'deploy':
          // the new gun comes up from low
          ax -= (1 - Math.min(1, t * 1.4)) ** 2 * 1.1;
          break;
        case 'slash':
          ay = s * 0.85 * this.slashSide;
          az = s * 0.35 * this.slashSide;
          ax += s * 0.25;
          pz = -s * 4;
          twist = s * 0.15 * this.slashSide;
          break;
        case 'stab': {
          // raise the knife, then drive it forward and down
          const th = kf(t, [[0, 0], [0.2, -1], [0.45, 1], [0.75, 0.4], [1, 0]]);
          ax += Math.max(0, -th) * 0.6 - Math.max(0, th) * 0.2;
          pz = -Math.max(0, th) * 10 + Math.max(0, -th) * 3;
          break;
        }
        case 'pullpin':
          ax += kf(t, [[0, 0], [0.5, 0.25]]);
          lx = kf(t, [[0, 0], [0.4, 0.2], [0.8, 0.2], [1, 0]]);
          ly = kf(t, [[0, 0], [0.4, -0.35], [0.8, -0.35], [1, 0]]);
          break;
        case 'throw':
          // wind up over the shoulder and swing through
          ax += kf(t, [[0, 0.25], [0.25, 1.5], [0.5, -0.4], [1, 0]]);
          py = kf(t, [[0, 0], [0.25, 6], [0.5, 0]]);
          pz = kf(t, [[0, 0], [0.25, 6], [0.5, -8], [1, 0]]);
          twist = kf(t, [[0, 0], [0.25, -0.3], [0.5, 0.25], [1, 0]]);
          hideGun = t > 0.45;
          break;
        case 'plant':
          // punching in the code
          if (t > 0.12 && t < 0.92) py += Math.max(0, Math.sin(t * 70)) * 0.7;
          break;
      }
    }
    // a grenade with the pin out is held up, ready
    if (st.pinOut && !(a && a.type === 'throw')) ax += 0.25;
    if (kn) {
      // kneeling: the hands go down to the bomb
      ax += (-0.95 - ax) * kn;
      ay *= 1 - kn;
      if (st.defusing) py += Math.sin(now * 9) * 0.5 * kn;
    }

    this.torso.position.y = hipY + bob;
    this.torso.rotation.set(-0.35 * f - 0.06 * spd * (1 - kn) - 0.3 * kn + this.flinchX, Math.sin(this.phase) * 0.08 * spd + twist, this.flinchZ);
    this.head.rotation.x = st.pitch * 0.5 + 0.35 * f + 0.25 * kn + this.flinchHead;
    this.arms.position.set(0, 53 - 16.5 * f - 14 * kn + bob + py, -8 * f - 4 * kn + this.recoil * 1.2 + pz);
    this.arms.rotation.set(ax + this.flinchX * 0.5, ay + twist, az + this.flinchZ * 0.5);
    this.gunMount.rotation.z = gz;
    this.gunMount.visible = !hideGun;
    this.rifleLeft.rotation.set(lx, ly, 0);
    this.pistolLeft.rotation.set(lx, ly, 0);
  }

  deathPose(dt) {
    if (this.deadT >= 1) return; // already lying still
    if (this.deadT === 0) {
      // whatever the hands and legs were doing stops
      this.pelvis.rotation.set(0, 0, 0);
      this.legYaw = this.legSide = 0;
      for (const l of this.legs) l.hip.rotation.set(0, 0, 0);
      this.torso.rotation.set(0, 0, 0);
      this.arms.rotation.set(0, 0, 0);
      this.gunMount.rotation.set(0, 0, 0);
      this.rifleLeft.rotation.set(0, 0, 0);
      this.pistolLeft.rotation.set(0, 0, 0);
    }
    this.deadT = Math.min(1, this.deadT + dt / 0.9);
    const t = this.deadT;
    // knees buckle first, then the body falls
    const buckle = Math.min(1, t / 0.35);
    const fall = Math.max(0, (t - 0.2) / 0.8);
    const e = 1 - (1 - fall) ** 3;
    for (const l of this.legs) {
      l.hip.position.y = 33 - 8 * buckle * (1 - e);
      l.hip.rotation.x = 0.7 * buckle * (1 - e * 0.8);
      l.knee.rotation.x = -1.3 * buckle * (1 - e * 0.8);
    }
    this.torso.position.y = 33 - 8 * buckle * (1 - e);
    this.torso.rotation.x = -0.3 * buckle * this.fallDir * (1 - e);
    this.torso.rotation.y = 0;
    this.body.rotation.x = e * (Math.PI / 2) * this.fallDir;
    this.body.rotation.z = e * this.fallSide;
    this.body.position.y = e * 4.5;
    // the gun falls out of the hands and the arms drop along the body
    this.gunMount.visible = t < 0.3;
    this.arms.rotation.x = -0.3 * buckle - 1.1 * e;
    this.head.rotation.x = -0.3 * e * this.fallDir;
  }
}

// ---------------------------------------------------------------- viewmodel

// Smoothed keyframes: keys = [[t, value], ...] sorted by t.
function kf(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      const u = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * u * u * (3 - 2 * u);
    }
  }
  return keys[keys.length - 1][1];
}

// resting placement [x, y, z, rx, ry, rz] per weapon kind, in view space
const REST = {
  knife: [6.6, -6.4, -13.5, 0.12, 0.3, -0.12],
  pistol: [5.6, -5.4, -14.5, 0.04, 0.1, 0],
  deagle: [5.7, -5.7, -15, 0.04, 0.1, 0],
  elite: [5.6, -5.5, -15, 0.04, 0, 0],
  smg: [6.2, -6.2, -16, 0.035, 0.085, 0],
  p90: [6.0, -6.3, -16.5, 0.035, 0.08, 0],
  rifle: [6.5, -6.6, -17.5, 0.035, 0.085, 0],
  bullpup: [6.3, -6.6, -18.5, 0.035, 0.08, 0],
  sniper: [6.7, -7.1, -17, 0.035, 0.075, 0],
  shotgun: [6.5, -6.9, -17.5, 0.035, 0.085, 0],
  m249: [6.8, -7.4, -17.5, 0.035, 0.08, 0],
  grenade: [6.4, -6.8, -12.5, 0.15, 0.3, -0.15],
  c4: [3.2, -9.6, -14.5, 0.95, 0.12, -0.05],
};
const KIND = {
  glock18: 'pistol', usp: 'pistol', p228: 'pistol', fiveseven: 'pistol',
  mac10: 'smg', tmp: 'smg', mp5navy: 'smg', ump45: 'smg',
  ak47: 'rifle', m4a1: 'rifle', galil: 'rifle', sg552: 'rifle', famas: 'bullpup', aug: 'bullpup',
  awp: 'sniper', scout: 'sniper', g3sg1: 'sniper', sg550: 'sniper',
  m3: 'shotgun', xm1014: 'shotgun', hegrenade: 'grenade', flashbang: 'grenade', smokegrenade: 'grenade', c4: 'c4',
};
const restFor = (id) => REST[id] || REST[KIND[id]] || REST.rifle;
// how hard each gun kicks back in the hands
const KICK = { awp: 2.2, scout: 2, deagle: 1.7, m3: 2.2, xm1014: 1.8, g3sg1: 1.5, sg550: 1.4, m249: 1.15 };
const BOLT_ACTION = new Set(['awp', 'scout']);

const ELBOW_R = new THREE.Vector3(14, -18, 6);
const ELBOW_L = new THREE.Vector3(-6, -17, -6);
const ELBOW_L_PISTOL = new THREE.Vector3(-9, -18, 2);
const ELBOW_L_DUAL = new THREE.Vector3(-15, -18, 6);
// reaching up (grenade pin, P90 magazine): the arm comes in low from the left
const ELBOW_L_REACH = new THREE.Vector3(-14, -21, -7);
const DEG2RAD = Math.PI / 180;

export class ViewModel {
  constructor(T) {
    this.T = T;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(vfov(90), 1, 0.5, 400);
    this.hemi = new THREE.HemisphereLight(0xe8eef6, 0x5a4a38, 1.35);
    this.sun = new THREE.DirectionalLight(0xfff0dc, 1.5);
    this.sun.position.set(0.4, 1, 0.6);
    this.scene.add(this.hemi, this.sun);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.cache = new Map();
    this.cur = null;
    this.id = null;
    this.kick = 0;
    this.fireT = 9;
    this.anim = null; // { type, start, dur }
    this.slashSide = 1;
    this.dualLeft = false;
    this.sgTilt = 0;
    this.breath = 0;
    this.light = 1;
    this.lastLight = -1;
    this.onEject = null;
    const flashMat = new THREE.SpriteMaterial({ map: T.flash, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true });
    this.flash = new THREE.Sprite(flashMat);
    this.flash.visible = false;
    this.flash.renderOrder = 10;
    this.scene.add(this.flash);
    this.flashTime = 0;
  }

  build(id, look) {
    const T = this.T;
    const g = new THREE.Group();
    const w = buildWeapon(id, T);
    // merge the parts that never move on their own (fewer draw calls)
    mergeStatic(w.group, new Set([w.silencer]));
    mergeStatic(w.mag);
    mergeStatic(w.bolt);
    g.add(w.group);
    const sleeve = lam({ map: look === 'T' ? T.camoT : T.camoCT, color: 0xb0b0b0 });
    const glove = lam({ color: look === 'T' ? 0x3a2e24 : 0x1c1d20 });
    const cuff = lam({ color: look === 'T' ? 0x4c3c2a : 0x22262e });
    const mats = [sleeve, glove, cuff];
    const bases = mats.map((m) => m.color.clone());
    const hand = (side) => {
      const h = new THREE.Group();
      put(h, B(2.3, 2.7, 2.9, glove), 0.4 * side, 0, 0.4);
      for (let i = 0; i < 4; i++) put(h, B(0.62, 0.6, 2.2, glove), -0.5 * side, 1.0 - i * 0.68, -0.9, 0, 0.5 * side, 0);
      put(h, B(0.7, 0.7, 2.2, glove), 0.9 * side, 1.2, -0.8, 0.3, -0.3 * side, 0);
      put(h, new THREE.Mesh(unitLimb(1.75, 1.75, 10), cuff), 0.3 * side, -0.2, 1.6).scale.set(1, 1, 1.1);
      mergeStatic(h);
      this.root.add(h);
      return h;
    };
    const right = hand(1), left = hand(-1);
    const rArm = new THREE.Mesh(unitLimb(1.6, 1.95, 10), sleeve);
    const lArm = new THREE.Mesh(unitLimb(1.6, 1.95, 10), sleeve);
    this.root.add(rArm, lArm);
    const pistol = isPistol(id), nade = isGrenade(id), c4 = isC4(id);
    const rightGrip = new THREE.Object3D();
    if (id === 'knife') rightGrip.position.set(0.3, 0, 1.4);
    else if (nade) rightGrip.position.set(0.95, -1.2, 0.8);
    else if (c4) rightGrip.position.set(4.2, -1.6, 0.4);
    else rightGrip.position.set(0.4, -1.8, 1.4);
    rightGrip.rotation.set(id === 'knife' ? 0 : nade ? 0.25 : c4 ? -0.2 : -0.3, 0, nade ? 0.15 : c4 ? 0.5 : 0);
    w.group.add(rightGrip);
    if (id === 'elite') w.leftGrip.rotation.set(-0.3, 0, 0);
    else if (c4) w.leftGrip.rotation.set(-1.1, 0.4, 0.2);
    else w.leftGrip.rotation.set(pistol ? -0.25 : 0.3, 0, pistol ? 0 : -0.5);
    const magHold = new THREE.Object3D();
    magHold.position.copy(w.magHold);
    w.mag.add(magHold);
    return { group: g, weapon: w, right, left, rArm, lArm, rightGrip, magHold, mats, bases, rest: restFor(id), nade, pistol, c4 };
  }

  setWeapon(id, look, silenced) {
    const key = id + '|' + look;
    if (!this.cache.has(key)) {
      const v = this.build(id, look);
      this.setVis(v, false);
      this.root.add(v.group);
      this.cache.set(key, v);
    }
    const v = this.cache.get(key);
    if (this.cur && this.cur !== v) this.setVis(this.cur, false);
    this.cur = v;
    this.id = id;
    this.setVis(v, true);
    v.weapon.setSilenced(!!silenced);
    v.weapon.bolt.visible = true;
    v.weapon.group.visible = true;
    this.sgTilt = 0;
    this.lastLight = -1;
  }

  setVis(v, on) {
    v.group.visible = on;
    for (const o of [v.right, v.left, v.rArm, v.lArm]) o.visible = on;
    if (on && (this.id === 'knife' || v.nade || v.c4)) {
      v.left.visible = false;
      v.lArm.visible = false;
    }
  }

  setLight(k) {
    this.light = k;
  }

  // type: deploy | fire | reload | silencer | slash | stab | sg_start | sg_insert | sg_end | pullpin | throw | plant | plant_stop
  play(type, now, arg) {
    if (type === 'plant_stop') {
      if (this.anim && this.anim.type === 'plant') this.anim = null;
      return;
    }
    if (type === 'fire') {
      this.kick = 1;
      this.fireT = 0;
      if (this.id === 'elite') this.dualLeft = !this.dualLeft;
      if (this.id !== 'knife' && !arg) this.showFlash();
      if (BOLT_ACTION.has(this.id)) this.anim = { type: 'bolt', start: now + 0.22, dur: 1.05 };
      else if (this.id === 'm3') this.anim = { type: 'pump', start: now + 0.3, dur: 0.5, eject: true };
      return;
    }
    if (type === 'sg_start') return; // the tilt follows the reload state
    if (type === 'sg_end') {
      if (this.id === 'm3' && arg > 0.3) this.anim = { type: 'pump', start: now + 0.05, dur: 0.5 };
      else this.anim = null;
      return;
    }
    if (type === 'slash') this.slashSide = -this.slashSide;
    const dur = { deploy: arg || 0.75, reload: arg || 2.5, silencer: arg || 2, slash: 0.32, stab: 0.6, sg_insert: arg || 0.45, pullpin: 0.5, throw: 0.55, plant: arg || 3 }[type] || 0.5;
    this.anim = { type, start: now, dur };
    if (type === 'deploy' && this.cur) {
      this.cur.weapon.bolt.visible = true;
      this.cur.weapon.group.visible = true;
      this.sgTilt = 0;
    }
  }

  showFlash() {
    const v = this.cur;
    if (!v) return;
    this.root.updateMatrixWorld(true);
    const m = this.id === 'elite' && this.dualLeft && v.weapon.muzzle2 ? v.weapon.muzzle2 : v.weapon.muzzle;
    m.getWorldPosition(this.flash.position);
    this.flash.material.rotation = Math.random() * Math.PI;
    const s = this.id === 'awp' || this.id === 'deagle' || this.id === 'm3' || this.id === 'xm1014' ? 12 : 9;
    this.flash.scale.set(s, s, 1);
    this.flash.visible = true;
    this.flashTime = 0.045;
  }

  // the muzzle in view space (where tracers start), like ejectPoint
  muzzlePoint(out) {
    const v = this.cur;
    if (!v) return null;
    this.root.updateMatrixWorld(true);
    const m = this.id === 'elite' && this.dualLeft && v.weapon.muzzle2 ? v.weapon.muzzle2 : v.weapon.muzzle;
    return m.getWorldPosition(out);
  }

  // the ejection port in view space (camera at the origin looking down -Z)
  ejectPoint(out) {
    if (!this.cur) return null;
    this.root.updateMatrixWorld(true);
    return this.cur.weapon.eject.getWorldPosition(out);
  }

  // st: { dt, now, bob, punchPitch, punchYaw (degrees), visible, clipEmpty, sgReload, pinOut, nadeGone }
  update(st) {
    const v = this.cur;
    this.root.visible = st.visible && !!v;
    if (this.flashTime > 0) {
      this.flashTime -= st.dt;
      if (this.flashTime <= 0) this.flash.visible = false;
    }
    if (!v) return;
    if (Math.abs(this.lastLight - this.light) > 0.02) {
      this.lastLight = this.light;
      v.mats.forEach((m, i) => m.color.copy(v.bases[i]).multiplyScalar(0.6 + 0.4 * this.light));
      const k = this.light;
      this.hemi.intensity = 1.35 * (0.55 + 0.45 * k);
      this.sun.intensity = 1.5 * k * k;
    }
    const w = v.weapon;
    const id = this.id;
    const pistol = v.pistol;
    const [px, py, pz, rx, ry, rz] = v.rest;
    let x = px, y = py, z = pz, ax = rx, ay = ry, az = rz;
    let magDrop = 0, magHide = false, boltBack = 0, boltLift = 0, boltSide = 0;
    let leftToMag = 0, leftToBolt = 0, rightToBolt = 0, leftToPort = 0, showLeft = false, hideGun = false, tap = 0;

    // CS 1.6 V_CalcBob: the gun moves forward and up with the bob value
    const bob = st.bob;
    z -= bob * 0.4;
    y += bob;
    ay -= bob * 0.5 * DEG2RAD;
    az -= bob * DEG2RAD;
    ax -= bob * 0.3 * DEG2RAD;

    this.breath += st.dt;
    y += Math.sin(this.breath * 1.7) * 0.05;

    // In 1.6 the view is punched but the gun keeps pointing where you aimed
    ax -= st.punchPitch * DEG2RAD;
    ay -= st.punchYaw * DEG2RAD;

    // shotguns tilt while loading shells
    this.sgTilt += ((st.sgReload ? 1 : 0) - this.sgTilt) * Math.min(1, st.dt * 9);
    if (this.sgTilt > 0.001) {
      az += this.sgTilt * 0.38;
      ax += this.sgTilt * 0.12;
      y += this.sgTilt * 1.3;
      x -= this.sgTilt * 0.8;
    }

    // a pulled grenade is held up, ready to throw
    if (v.nade && st.pinOut) {
      y += 1.4;
      z += 0.6;
      ax += 0.35;
    }

    // fire kick and slide/bolt travel
    this.fireT += st.dt;
    if (this.kick > 0) {
      const k = this.kick;
      const s = KICK[id] || (pistol ? 1.2 : 1);
      z += k * 1.1 * s;
      ax += k * 0.045 * s;
      if (id === 'elite') ay += k * 0.03 * (this.dualLeft ? -1 : 1);
      this.kick = Math.max(0, this.kick - st.dt * 13);
    }
    if (!BOLT_ACTION.has(id) && id !== 'knife' && id !== 'm3' && !v.nade && !v.c4) {
      const travel = pistol ? 1.3 : 1.6;
      if (this.fireT < 0.07) boltBack = travel * Math.sin((this.fireT / 0.07) * Math.PI);
      if (pistol && st.clipEmpty && this.fireT >= 0.035) boltBack = travel; // slide locks back on empty
    }

    const a = this.anim;
    if (a) {
      const t = (st.now - a.start) / a.dur;
      if (t >= 1) this.anim = null;
      else if (t >= 0) {
        const s = Math.sin(t * Math.PI);
        switch (a.type) {
          case 'deploy': {
            const e = (1 - Math.min(1, t * 1.6)) ** 2;
            y -= e * 11;
            ax -= e * 0.9;
            az += e * 0.3;
            if (pistol && t > 0.45 && t < 0.75) boltBack = kf(t, [[0.45, 0], [0.55, 1.3], [0.62, 1.3], [0.7, 0]]);
            break;
          }
          case 'reload': {
            if (id === 'elite') {
              // both guns tip up while the empty mags drop out of the grips
              ax += kf(t, [[0, 0], [0.12, 0.3], [0.8, 0.3], [0.92, 0]]);
              y += kf(t, [[0, 0], [0.12, -1.5], [0.8, -1.5], [0.92, 0]]);
              magDrop = kf(t, [[0.12, 0], [0.24, 9], [0.3, 12], [0.31, 10], [0.6, 2.5], [0.72, 0]]);
              magHide = t > 0.27 && t < 0.34;
            } else if (pistol) {
              az += kf(t, [[0, 0], [0.12, -0.32], [0.75, -0.32], [0.9, 0]]);
              ax += kf(t, [[0, 0], [0.12, 0.18], [0.75, 0.18], [0.9, 0]]);
              y += kf(t, [[0, 0], [0.12, 1.2], [0.75, 1.2], [0.9, 0]]);
              magDrop = kf(t, [[0.12, 0], [0.24, 9], [0.3, 12], [0.31, 10], [0.5, 2.5], [0.6, 0]]);
              magHide = t > 0.27 && t < 0.31;
              // with two guns each hand keeps its own
              if (id !== 'elite') leftToMag = kf(t, [[0.1, 0], [0.2, 1], [0.6, 1], [0.7, 0]]);
              if (st.clipEmpty) boltBack = t < 0.68 ? 1.3 : kf(t, [[0.68, 1.3], [0.72, 0]]);
            } else {
              az += kf(t, [[0, 0], [0.12, 0.35], [0.8, 0.35], [0.95, 0]]);
              ax += kf(t, [[0, 0], [0.12, 0.12], [0.8, 0.12], [0.95, 0]]);
              y += kf(t, [[0, 0], [0.12, 1.4], [0.8, 1.4], [0.95, 0]]);
              x += kf(t, [[0, 0], [0.12, -1.2], [0.8, -1.2], [0.95, 0]]);
              magDrop = kf(t, [[0.14, 0], [0.24, 7], [0.3, 13], [0.31, 12], [0.48, 3], [0.56, 0.6], [0.6, 0]]);
              magHide = t > 0.28 && t < 0.32;
              leftToMag = kf(t, [[0.08, 0], [0.16, 1], [0.6, 1], [0.66, 0]]);
              if (BOLT_ACTION.has(id)) {
                rightToBolt = kf(t, [[0.66, 0], [0.74, 1], [0.88, 1], [0.95, 0]]);
                boltLift = kf(t, [[0.73, 0], [0.77, 1], [0.86, 1], [0.9, 0]]);
                boltBack = kf(t, [[0.77, 0], [0.8, 3.5], [0.83, 3.5], [0.86, 0]]);
              } else {
                leftToBolt = kf(t, [[0.62, 0], [0.7, 1], [0.82, 1], [0.9, 0]]);
                boltBack = kf(t, [[0.72, 0], [0.76, 3.2], [0.79, 0]]);
              }
            }
            break;
          }
          case 'bolt': {
            // bolt-action cycle after a shot
            rightToBolt = kf(t, [[0, 0], [0.18, 1], [0.78, 1], [0.95, 0]]);
            boltLift = kf(t, [[0.18, 0], [0.28, 1], [0.66, 1], [0.76, 0]]);
            boltBack = kf(t, [[0.28, 0], [0.42, 3.5], [0.5, 3.5], [0.64, 0]]);
            az += s * 0.12;
            y += s * 0.6;
            if (t > 0.42 && !a.shell) {
              a.shell = true;
              if (this.onEject) this.onEject();
            }
            break;
          }
          case 'pump': {
            // pump action: the left hand rides the fore-end back and forth
            boltBack = kf(t, [[0, 0], [0.4, 3.6], [0.55, 3.6], [0.95, 0]]);
            az += s * 0.08;
            y -= s * 0.4;
            if (a.eject && t > 0.42 && !a.shell) {
              a.shell = true;
              if (this.onEject) this.onEject();
            }
            break;
          }
          case 'sg_insert':
            leftToPort = kf(t, [[0, 0], [0.35, 1], [0.6, 1], [0.95, 0]]);
            y += kf(t, [[0.4, 0], [0.5, 0.35], [0.6, 0]]);
            break;
          case 'silencer':
            az -= s * 0.45;
            ay += s * 0.5;
            x -= s * 3;
            y -= s * 1.5;
            break;
          case 'slash': {
            const side = this.slashSide;
            ay += s * 1.0 * side;
            az += s * 0.6 * side;
            ax -= s * 0.3;
            x -= s * (side > 0 ? 5 : 2);
            z -= s * 3;
            break;
          }
          case 'stab': {
            const th = kf(t, [[0, 0], [0.2, -1], [0.45, 1], [0.75, 0.4], [1, 0]]);
            z -= Math.max(0, th) * 9;
            z += Math.max(0, -th) * 2;
            ax -= s * 0.25;
            break;
          }
          case 'pullpin':
            // the left hand comes in, takes the ring and pulls it out to the side
            showLeft = true;
            leftToBolt = kf(t, [[0, 0], [0.35, 1], [0.8, 1], [1, 0.6]]);
            boltSide = kf(t, [[0.45, 0], [0.8, 3]]);
            y += kf(t, [[0, 0], [0.4, 1.0]]);
            ay -= kf(t, [[0, 0], [0.4, 0.35]]);
            break;
          case 'plant': {
            // kneel the bomb down and punch in the code
            showLeft = true;
            leftToBolt = kf(t, [[0, 0], [0.1, 1], [0.93, 1], [1, 0.4]]);
            y -= kf(t, [[0, 0], [0.12, 1.6]]);
            z -= kf(t, [[0, 0], [0.12, 1.2]]);
            ax += kf(t, [[0, 0], [0.12, 0.22]]);
            if (t > 0.12 && t < 0.92) tap = Math.max(0, Math.sin(t * 70)) * 0.55;
            break;
          }
          case 'throw': {
            const fw = kf(t, [[0, 0], [0.25, -0.3], [0.5, 1], [1, 1.2]]);
            z -= fw * 9;
            y += kf(t, [[0, 1.4], [0.3, 3.5], [0.6, 0], [1, -8]]);
            ax += kf(t, [[0, 0.35], [0.3, 0.9], [0.6, -0.6], [1, -1]]);
            hideGun = t > 0.42;
            break;
          }
        }
      }
    }
    if (v.nade) {
      // after a throw nothing is in the hand until the next grenade comes out
      if (st.nadeGone && !(a && a.type === 'throw')) this.root.visible = false;
      w.bolt.visible = !st.pinOut || (a && a.type === 'pullpin');
      w.group.visible = !hideGun && !(st.nadeGone && !(a && a.type === 'throw'));
    }

    v.group.position.set(x, y, z);
    v.group.rotation.set(ax, ay, az);
    w.mag.position.copy(w.magRest).addScaledVector(w.magDir, magDrop);
    w.mag.visible = !magHide;
    w.bolt.position.copy(w.boltRest);
    w.bolt.position.z += boltBack;
    w.bolt.position.x -= boltSide;
    w.bolt.rotation.z = BOLT_ACTION.has(id) ? boltLift * 1.1 : 0;

    // hands follow their anchors, forearms run from the wrists to elbows off screen
    this.root.updateMatrixWorld(true);
    v.rightGrip.getWorldPosition(v.right.position);
    v.rightGrip.getWorldQuaternion(v.right.quaternion);
    if (rightToBolt > 0) v.right.position.lerp(w.boltHand.getWorldPosition(tmpB), rightToBolt);
    const leftOn = id !== 'knife' && ((!v.nade && !v.c4) || showLeft);
    v.left.visible = v.lArm.visible = leftOn && v.group.visible;
    if (leftOn) {
      w.leftGrip.getWorldPosition(v.left.position);
      w.leftGrip.getWorldQuaternion(v.left.quaternion);
      if (leftToMag > 0) v.left.position.lerp(v.magHold.getWorldPosition(tmpB), leftToMag);
      if (leftToBolt > 0) v.left.position.lerp(w.boltHand.getWorldPosition(tmpB), leftToBolt);
      if (leftToPort > 0) v.left.position.lerp(w.port.getWorldPosition(tmpB), leftToPort);
      v.left.position.y -= tap;
      tmpA.set(0, 0, 2.6).applyQuaternion(v.left.quaternion).add(v.left.position);
      stretch(v.lArm, tmpA, id === 'elite' ? ELBOW_L_DUAL : v.nade || v.c4 || id === 'p90' ? ELBOW_L_REACH : pistol ? ELBOW_L_PISTOL : ELBOW_L);
    }
    tmpA.set(0, 0, 2.6).applyQuaternion(v.right.quaternion).add(v.right.position);
    stretch(v.rArm, tmpA, ELBOW_R);
  }
}

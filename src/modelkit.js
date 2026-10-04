// Small building blocks shared by the weapon, character and viewmodel code:
// cached primitive geometries and helpers to place and stretch parts.

import * as THREE from '../lib/three.module.js';

export const lam = (o) => new THREE.MeshLambertMaterial(o);

const geoCache = new Map();
const cached = (key, make) => {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
};

export const boxGeo = (w, h, d) => cached(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
// cylinder along Z: radius r1 at the front (-Z), r2 at the back
export const cylZ = (r1, r2, len, seg) => cached(`cz${r1}|${r2}|${len}|${seg}`, () => {
  const g = new THREE.CylinderGeometry(r1, r2, len, seg);
  g.rotateX(-Math.PI / 2);
  return g;
});
// cylinder hanging down from the origin (limbs, torso parts)
export const cylDown = (r1, r2, len, seg) => cached(`cd${r1}|${r2}|${len}|${seg}`, () => {
  const g = new THREE.CylinderGeometry(r1, r2, len, seg);
  g.translate(0, -len / 2, 0);
  return g;
});
// unit-length cylinder from z=0 (radius r1) to z=1 (radius r2), stretched between two points
export const unitLimb = (r1, r2, seg) => cached(`ul${r1}|${r2}|${seg}`, () => {
  const g = new THREE.CylinderGeometry(r2, r1, 1, seg);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.5);
  return g;
});
export const sphereGeo = (seg = 10, rings = 8) => cached(`s${seg}|${rings}`, () => new THREE.SphereGeometry(1, seg, rings));
export const helmetGeo = () => cached('helmet', () => new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5));
// ring in the XY plane (grenade pins)
export const ringGeo = (r, tube) => cached(`r${r}|${tube}`, () => new THREE.TorusGeometry(r, tube, 5, 12));

export const B = (w, h, d, m) => new THREE.Mesh(boxGeo(w, h, d), m);
export const CZ = (r1, r2, len, m, seg = 10) => new THREE.Mesh(cylZ(r1, r2, len, seg), m);
// vertical cylinder (Y axis)
export const CY = (r1, r2, len, m, seg = 10) => {
  const mesh = new THREE.Mesh(cylZ(r1, r2, len, seg), m);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
};
export const SPH = (rx, ry, rz, m, seg = 10, rings = 8) => {
  const s = new THREE.Mesh(sphereGeo(seg, rings), m);
  s.scale.set(rx, ry, rz);
  return s;
};

// Place obj in parent. Rotation only replaces the object's own one if given.
export function put(parent, obj, x, y, z, rx, ry, rz) {
  obj.position.set(x, y, z);
  if (rx !== undefined) obj.rotation.set(rx, ry || 0, rz || 0);
  parent.add(obj);
  return obj;
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const tmpC = new THREE.Vector3();

// Point a unit limb from a to b.
export function stretch(mesh, a, b) {
  tmpC.copy(b).sub(a);
  const l = tmpC.length() || 0.001;
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(Z_AXIS, tmpC.multiplyScalar(1 / l));
  mesh.scale.set(1, 1, l);
}

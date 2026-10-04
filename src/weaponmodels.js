// Low-poly weapon models, shared by the first-person viewmodel and the
// third-person characters. Origin at the grip, barrel toward -Z, ~1 unit per inch.

import * as THREE from '../lib/three.module.js';
import { lam, B, CZ, CY, SPH, put, ringGeo } from './modelkit.js';

let WM = null;
export function weaponMats(T) {
  if (WM) return WM;
  WM = {
    metal: lam({ map: T.gunmetal }),
    dark: lam({ map: T.gunmetal, color: 0x8a8a8e }),
    black: lam({ map: T.polymer }),
    wood: lam({ map: T.gunWood }),
    woodDark: lam({ map: T.gunWood, color: 0x9a7868 }),
    silver: lam({ map: T.silver }),
    silverDark: lam({ map: T.silver, color: 0xb0b0b4 }),
    green: lam({ map: T.awpGreen }),
    olive: lam({ map: T.silver, color: 0x7a8254 }),
    oliveDark: lam({ map: T.silver, color: 0x585e42 }),
    gray: lam({ map: T.silver, color: 0x9a9ca0 }),
    smokeGray: lam({ map: T.awpGreen, color: 0x9c9c9c }),
    band: lam({ map: T.silver, color: 0xe2dcc4 }),
    blade: lam({ map: T.silver, color: 0xf0f2f6 }),
    lens: lam({ color: 0x1c3440, emissive: 0x0c2028 }),
    hole: lam({ color: 0x050505 }),
    // C4
    clay: lam({ map: T.silver, color: 0xb4a47a }),
    tape: lam({ map: T.polymer, color: 0x9a9a9a }),
    lcd: lam({ color: 0x36ff6a, emissive: 0x1c8a34 }),
    key: lam({ map: T.silver, color: 0xc8c8c8 }),
    wireRed: lam({ color: 0xb02018 }),
    wireBlue: lam({ color: 0x2440a8 }),
    wireYellow: lam({ color: 0xc8a820 }),
  };
  return WM;
}

function knifeBlade(mat) {
  const s = new THREE.Shape();
  s.moveTo(-1.2, -0.45);
  s.lineTo(-8.2, -0.55);
  s.quadraticCurveTo(-9.6, -0.3, -10.2, 0.35);
  s.lineTo(-8.6, 0.95);
  s.lineTo(-1.2, 0.8);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.08, bevelSegments: 1 });
  g.rotateY(-Math.PI / 2); // shape -x -> -z (blade points forward)
  g.translate(0.08, 0, 0);
  return new THREE.Mesh(g, mat);
}

// ---- pieces many guns share ----

// rifle pistol grip, trigger guard and trigger
function rifleGrip(g, M, z = 1.2, mat = M.black) {
  put(g, B(1.4, 4.0, 2.0, mat), 0, -2.3, z, -0.32);
  put(g, B(0.35, 0.3, 2.6, M.metal), 0, -0.75, z - 2.4);
  put(g, B(0.35, 1.0, 0.3, M.metal), 0, -0.3, z - 3.7);
  put(g, B(0.25, 0.9, 0.3, M.dark), 0, -0.25, z - 2, 0.3);
}

// pistol frame parts below the slide
function pistolFrame(g, M, x, len, mat, gripMat) {
  put(g, B(1.0, 0.9, len, mat), x, 0.45, -2.2 - (len - 6) / 2);
  put(g, B(1.15, 4.3, 2.05, gripMat || mat), x, -2.1, 0.75, -0.27);
  put(g, B(0.3, 0.3, 2.4, mat), x, -0.85, -1.6);
  put(g, B(0.3, 1.0, 0.3, mat), x, -0.35, -2.85);
  put(g, B(0.22, 0.7, 0.25, M.dark), x, -0.25, -1.3, 0.25);
}

// pistol magazine (in the grip)
function pistolMag(mag, M, x, mat) {
  put(mag, B(1.15, 0.4, 2.0, mat || M.black), x, 0, 0, -0.27);
  put(mag, B(0.85, 3.4, 1.6, M.dark), x, 1.8, -0.5, -0.27);
}

// pistol slide with serrations and sights
function pistolSlide(bolt, M, x, len, mat, serr = M.metal) {
  put(bolt, B(1.05, 1.35, len, mat), x, 1.5, -2.6 - (len - 7.3) / 2);
  for (let i = 0; i < 4; i++) put(bolt, B(1.1, 1.0, 0.1, serr), x, 1.5, 0.3 + i * 0.22);
  put(bolt, B(0.2, 0.25, 0.3, M.metal), x, 2.3, -5.9 - (len - 7.3));
  put(bolt, B(0.8, 0.3, 0.4, M.metal), x, 2.3, 0.6);
  put(bolt, CZ(0.3, 0.3, 0.2, M.hole, 8), x, 1.55, -6.3 - (len - 7.3));
}

// telescopic sight along -Z at height y, centred on z
function scope(g, M, y, z, len, bell = 1.1, r = 0.68) {
  put(g, CZ(r, r, len, M.black, 12), 0, y, z);
  put(g, CZ(bell, r, 2.4, M.black, 12), 0, y, z - len / 2 - 1.1);
  put(g, CZ(r, r * 1.3, 2, M.black, 12), 0, y, z + len / 2 + 0.9);
  put(g, CZ(bell - 0.08, bell - 0.08, 0.08, M.lens, 12), 0, y, z - len / 2 - 2.32);
  put(g, B(1.0, y - 2.2, 0.8, M.dark), 0, (y + 2.2) / 2, z - len / 2 + 1.2);
  put(g, B(1.0, y - 2.2, 0.8, M.dark), 0, (y + 2.2) / 2, z + len / 2 - 1.2);
}

// curved rifle magazine made of a few tilted boxes
function curvedMag(mag, M, mat, segs) {
  for (const [y, z, rx, h] of segs) put(mag, B(1.5, h, 2.8, mat || M.dark), 0, y, z, rx);
}

// grenade fuse, spoon and pin (the pin is in the "bolt" group so it can be pulled)
function grenadeTop(g, bolt, M, y) {
  put(g, CY(0.42, 0.5, 0.9, M.metal, 10), 0, y, 0);
  put(g, CY(0.32, 0.32, 0.45, M.dark, 8), 0, y + 0.6, 0);
  put(g, B(0.16, 2.6, 0.6, M.metal), 0.95, y - 1.0, 0, 0, 0, -0.08);
  put(g, B(0.7, 0.16, 0.6, M.metal), 0.65, y + 0.25, 0);
  put(bolt, new THREE.Mesh(ringGeo(0.42, 0.07), M.metal), -0.85, y + 0.15, 0, 0, Math.PI / 2, 0);
  put(bolt, B(0.8, 0.1, 0.1, M.metal), -0.35, y + 0.15, 0);
}

// Each builder fills the parts; c holds the groups and anchor points.
const BUILD = {
  ak47(c, M) {
    const { g, mag, bolt } = c;
    put(g, B(2.0, 2.6, 13, M.metal), 0, 0.9, -3.5);
    put(g, CZ(1.0, 1.0, 12, M.dark, 12), 0, 2.15, -4).scale.set(1, 0.55, 1);
    put(g, B(1.2, 0.8, 1.6, M.metal), 0, 2.6, -10.6);
    put(g, CZ(0.55, 0.55, 8, M.metal, 8), 0, 2.35, -15);
    put(g, CZ(0.85, 0.85, 7.4, M.wood, 10), 0, 2.45, -15).scale.set(1, 0.85, 1);
    put(g, CZ(1.25, 1.2, 7.8, M.wood, 12), 0, 0.95, -15).scale.set(0.95, 0.85, 1);
    put(g, CZ(0.42, 0.42, 14, M.metal, 8), 0, 1.25, -25);
    put(g, B(1.1, 1.9, 1.2, M.metal), 0, 1.8, -19.2);
    put(g, B(0.9, 1.6, 1.0, M.metal), 0, 1.8, -29);
    put(g, B(0.15, 1.0, 0.6, M.metal), 0.38, 2.9, -29);
    put(g, B(0.15, 1.0, 0.6, M.metal), -0.38, 2.9, -29);
    put(g, CZ(0.58, 0.5, 1.8, M.dark, 8), 0, 1.25, -32.7);
    put(g, CZ(0.15, 0.15, 11, M.metal, 6), 0, 0.25, -24);
    put(g, B(0.35, 0.3, 2.6, M.metal), 0, -0.75, -1.2);
    put(g, B(0.35, 1.0, 0.3, M.metal), 0, -0.3, -2.5);
    put(g, B(0.25, 0.9, 0.3, M.dark), 0, -0.25, -0.8, 0.3);
    put(g, B(1.4, 4.2, 2.0, M.woodDark), 0, -2.3, 1.2, -0.32);
    put(g, B(1.6, 2.3, 4, M.wood), 0, 0.6, 4.8);
    put(g, B(1.8, 3.6, 7, M.wood), 0, -0.1, 10, 0.15);
    put(g, B(1.9, 3.9, 0.4, M.dark), 0, -0.6, 13.6, 0.15);
    c.magRest.set(0, -0.4, -6.2);
    curvedMag(mag, M, M.dark, [[-1.1, 0, 0.05, 2.2], [-3.0, -0.35, 0.22, 2.2], [-4.8, -1.1, 0.4, 2.2], [-6.3, -2.1, 0.55, 1.6]]);
    put(bolt, B(0.9, 0.5, 0.5, M.metal), 1.3, 1.65, -7);
    put(bolt, B(0.5, 0.6, 0.6, M.metal), 1.7, 1.65, -7);
    c.muzzle.set(0, 1.25, -33.6);
    c.eject.set(1.0, 1.9, -6);
    c.leftGrip.set(-0.2, -0.3, -15);
    c.boltHand.set(2.3, 1.2, -6.6);
  },
  m4a1(c, M) {
    const { g, mag, bolt } = c;
    put(g, B(1.7, 2.0, 9.5, M.dark), 0, 0.2, -2.8);
    put(g, B(1.7, 1.9, 10.5, M.dark), 0, 2.1, -3.8);
    put(g, B(0.8, 0.6, 6.2, M.dark), 0, 3.95, -3.6);
    put(g, B(0.8, 0.9, 0.8, M.dark), 0, 3.3, -6.4);
    put(g, B(0.8, 1.0, 1.1, M.dark), 0, 4.4, -0.9);
    put(g, B(0.8, 0.9, 0.9, M.dark), 0, 3.3, -1.0);
    put(g, B(1.6, 1.4, 2.9, M.dark), 0, -1.3, -5.6);
    put(g, B(1.3, 4.0, 1.9, M.black), 0, -2.4, 1.4, -0.38);
    put(g, B(0.4, 0.3, 2.6, M.dark), 0, -0.95, -0.9);
    put(g, B(0.25, 0.9, 0.3, M.metal), 0, -0.45, -0.6, 0.3);
    put(g, CZ(1.3, 1.3, 7, M.black, 12), 0, 1.6, -12);
    put(g, CZ(1.42, 1.42, 0.5, M.dark, 12), 0, 1.6, -8.4);
    put(g, CZ(0.35, 0.35, 9, M.metal, 8), 0, 1.6, -20);
    put(g, B(0.9, 0.9, 1.1, M.dark), 0, 2.1, -17.6);
    put(g, B(0.35, 1.9, 0.5, M.dark), 0, 3.3, -17.6);
    put(g, CZ(0.6, 0.6, 1, M.dark, 8), 0, 1.6, -17.6);
    put(g, CZ(0.45, 0.45, 1.8, M.metal, 8), 0, 1.6, -25.4);
    put(g, CZ(0.6, 0.6, 5, M.black, 8), 0, 1.85, 4.5);
    put(g, B(1.5, 2.6, 5, M.black), 0, 1.0, 8.4);
    put(g, B(1.4, 1.4, 3.5, M.black), 0, -0.4, 8.6, -0.35);
    put(g, B(1.6, 3.3, 0.5, M.black), 0, 0.6, 11);
    put(g, CZ(0.35, 0.35, 0.8, M.metal, 6), 1.0, 2.4, -0.6);
    c.silencer = put(g, CZ(0.78, 0.78, 7, M.black, 12), 0, 1.6, -29.6);
    c.magRest.set(0, -1.6, -5.6);
    put(mag, B(1.4, 3.6, 2.6, M.metal), 0, -1.8, 0, 0.08);
    put(mag, B(1.4, 2.6, 2.55, M.metal), 0, -4.7, -0.35, 0.16);
    put(bolt, B(1.6, 0.3, 0.6, M.dark), 0, 2.95, 1.2);
    c.muzzle.set(0, 1.6, -26.4);
    c.silMuzzle = new THREE.Vector3(0, 1.6, -33.2);
    c.eject.set(1.0, 2.1, -4);
    c.leftGrip.set(-0.2, -0.2, -12);
    c.boltHand.set(0.2, 3.4, 1.8);
  },
  awp(c, M) {
    const { g, mag, bolt } = c;
    put(g, B(2.2, 2.4, 22, M.green), 0, 0.6, 0);
    put(g, B(2.0, 5.2, 7, M.green), 0, -0.3, 10.5);
    put(g, B(1.6, 4.0, 2.0, M.green), 0, -2.2, 2.6, -0.25);
    put(g, B(1.9, 1.2, 6, M.green), 0, 1.6, 7);
    put(g, B(1.9, 1.0, 6, M.green), 0, -2.4, 8.2);
    put(g, B(1.9, 5.4, 0.6, M.black), 0, -0.3, 14.2);
    put(g, B(2.2, 2.0, 10, M.green), 0, 0.7, -15.5).scale.set(0.95, 0.9, 1);
    put(g, CZ(1.0, 1.0, 9, M.dark, 12), 0, 2.0, -3);
    put(g, CZ(0.45, 0.55, 26, M.metal, 8), 0, 1.9, -24);
    put(g, B(1.4, 1.2, 2.8, M.dark), 0, 1.9, -38.2);
    put(g, B(1.5, 0.3, 0.5, M.hole), 0, 1.9, -38.6);
    put(g, B(1.5, 0.3, 0.5, M.hole), 0, 1.9, -37.6);
    put(g, CZ(0.75, 0.75, 13, M.black, 12), 0, 4.3, -3.5);
    put(g, CZ(1.35, 0.75, 3, M.black, 12), 0, 4.3, -11.4);
    put(g, CZ(0.8, 1.05, 3, M.black, 12), 0, 4.3, 4.2);
    put(g, CZ(1.2, 1.2, 0.1, M.lens, 12), 0, 4.3, -12.95);
    put(g, CZ(0.5, 0.5, 1, M.black, 8), 0, 5.4, -3.4, Math.PI / 2);
    put(g, CZ(0.5, 0.5, 1, M.black, 8), 0.95, 4.3, -3.4, 0, Math.PI / 2);
    put(g, B(1.8, 1.4, 0.9, M.black), 0, 3.25, -7);
    put(g, B(1.8, 1.4, 0.9, M.black), 0, 3.25, 0.5);
    put(g, B(0.35, 0.3, 2.4, M.dark), 0, -0.75, 0.4);
    c.magRest.set(0, -0.6, -4);
    put(mag, B(1.6, 2.6, 3.6, M.dark), 0, -1.3, 0);
    // the bolt handle turns around the receiver axis
    put(bolt, CZ(0.25, 0.25, 2.6, M.metal, 6), 1.4, 0, 0, 0, Math.PI / 2);
    put(bolt, SPH(0.5, 0.5, 0.5, M.metal, 8, 6), 2.8, -0.2, 0);
    bolt.position.set(0, 2.0, 1.4);
    c.muzzle.set(0, 1.9, -39.8);
    c.eject.set(1.1, 2.2, -1.5);
    c.leftGrip.set(-0.2, -0.6, -16);
    c.boltHand.set(2.9, -0.6, 0.4);
  },
  scout(c, M) {
    const { g, mag, bolt } = c;
    put(g, B(1.8, 1.9, 16, M.black), 0, 0.5, -6);
    put(g, B(1.8, 2.2, 6, M.black), 0, 0.4, 5);
    put(g, B(1.9, 4.6, 5.5, M.black), 0, -0.6, 10.4, 0.08);
    put(g, B(2.0, 4.8, 0.5, M.dark), 0, -0.8, 13.3, 0.08);
    put(g, B(1.6, 1.0, 5, M.black), 0, 1.9, 8.8);
    put(g, B(1.5, 3.6, 2.0, M.black), 0, -1.9, 1.6, -0.35);
    put(g, B(0.35, 0.3, 2.4, M.dark), 0, -0.6, 0.0);
    put(g, B(0.25, 0.8, 0.3, M.metal), 0, -0.2, 0.3, 0.3);
    put(g, CZ(0.82, 0.82, 8.5, M.dark, 10), 0, 1.8, -2.2);
    put(g, CZ(0.42, 0.5, 22, M.metal, 8), 0, 1.8, -17.5);
    put(g, CZ(0.5, 0.5, 0.8, M.dark, 8), 0, 1.8, -28.8);
    scope(g, M, 3.65, -2.8, 9, 1.05, 0.62);
    c.magRest.set(0, -0.4, -3.6);
    put(mag, B(1.4, 2.0, 2.8, M.dark), 0, -1.0, 0);
    put(bolt, CZ(0.22, 0.22, 2.4, M.metal, 6), 1.3, 0, 0, 0, Math.PI / 2);
    put(bolt, SPH(0.45, 0.45, 0.45, M.metal, 8, 6), 2.6, -0.2, 0);
    bolt.position.set(0, 1.8, 1.4);
    c.muzzle.set(0, 1.8, -29.4);
    c.eject.set(1.0, 2.1, -1.0);
    c.leftGrip.set(-0.2, -0.4, -11);
    c.boltHand.set(2.7, -0.6, 0.4);
  },
  g3sg1(c, M) {
    const { g, mag, bolt } = c;
    put(g, B(2.0, 2.7, 14, M.black), 0, 1.0, -3.0);
    put(g, B(2.1, 2.3, 9, M.black), 0, 1.1, -14.8);
    for (let i = 0; i < 3; i++) put(g, B(2.15, 0.5, 1.0, M.dark), 0, 1.1, -11.8 - i * 2.8);
    put(g, CZ(0.48, 0.5, 12, M.metal, 8), 0, 1.5, -25);
    put(g, CZ(0.6, 0.55, 1.8, M.dark, 8), 0, 1.5, -31.5);
    put(g, CZ(0.35, 0.35, 10, M.dark, 8), 0, 2.6, -14);
    scope(g, M, 4.4, -3.4, 10, 1.2, 0.72);
    rifleGrip(g, M, 1.2);
    put(g, B(1.8, 3.0, 9.5, M.black), 0, 0.5, 8.2);
    put(g, B(1.6, 1.0, 5, M.black), 0, 2.4, 8.4);
    put(g, B(1.9, 4.4, 0.8, M.dark), 0, 0.0, 13.2);
    put(g, CZ(0.2, 0.2, 9, M.metal, 6), 0.65, -0.1, -15);
    put(g, CZ(0.2, 0.2, 9, M.metal, 6), -0.65, -0.1, -15);
    put(bolt, B(0.35, 0.6, 1.0, M.metal), -1.0, 2.6, -13.6);
    c.magRest.set(0, -0.3, -6.2);
    put(mag, B(1.5, 4.4, 2.5, M.dark), 0, -2.2, 0, 0.05);
    c.muzzle.set(0, 1.5, -32.4);
    c.eject.set(1.1, 1.9, -4.0);
    c.leftGrip.set(-0.2, -0.3, -15);
    c.boltHand.set(-1.6, 2.6, -13.6);
  },
  sg550(c, M) {
    const { g, mag, bolt } = c;
    put(g, B(1.9, 2.5, 13, M.black), 0, 0.9, -3.0);
    put(g, B(2.1, 2.3, 9, M.oliveDark), 0, 1.0, -14.6);
    put(g, CZ(0.45, 0.48, 14, M.metal, 8), 0, 1.4, -26);
    put(g, CZ(0.6, 0.55, 1.6, M.dark, 8), 0, 1.4, -33.6);
    put(g, B(1.0, 1.2, 1.0, M.metal), 0, 1.9, -19.6);
    scope(g, M, 4.2, -3.2, 10, 1.15, 0.7);
    rifleGrip(g, M, 1.2);
    put(g, B(1.7, 1.8, 8.5, M.black), 0, 1.4, 7.6);
    put(g, B(1.7, 1.4, 6, M.black), 0, -1.7, 8.6);
    put(g, B(1.8, 4.4, 1.2, M.black), 0, -0.1, 12.0);
    put(g, B(1.5, 0.8, 4.5, M.black), 0, 2.6, 8.2);
    put(g, CZ(0.2, 0.2, 8, M.metal, 6), 0.65, -0.1, -15.5);
    put(g, CZ(0.2, 0.2, 8, M.metal, 6), -0.65, -0.1, -15.5);
    put(bolt, B(0.4, 0.5, 1.0, M.metal), 1.2, 1.8, -8);
    c.magRest.set(0, -0.4, -6.2);
    put(mag, B(1.4, 4.6, 2.6, M.dark), 0, -2.3, 0, 0.12);
    c.muzzle.set(0, 1.4, -34.4);
    c.eject.set(1.0, 1.9, -4.2);
    c.leftGrip.set(-0.2, -0.3, -14.6);
    c.boltHand.set(1.8, 1.8, -8);
  },
  galil(c, M) {
    const { g, mag, bolt } = c;
    put(g, B(1.9, 2.5, 12, M.black), 0, 0.9, -3.5);
    put(g, B(1.6, 0.8, 10, M.dark), 0, 2.5, -3.6);
    put(g, B(1.9, 2.1, 7.5, M.black), 0, 1.15, -13.2);
    put(g, B(1.1, 1.4, 1.2, M.metal), 0, 1.9, -17.4);
    put(g, CZ(0.42, 0.42, 13, M.metal, 8), 0, 1.5, -22.5);
    put(g, B(0.9, 2.2, 1.0, M.dark), 0, 2.45, -19.6);
    put(g, CZ(0.55, 0.55, 1.6, M.dark, 8), 0, 1.5, -29.6);
    put(g, CZ(0.18, 0.18, 8, M.metal, 6), 0.6, 0.0, -17.5);
    put(g, CZ(0.18, 0.18, 8, M.metal, 6), -0.6, 0.0, -17.5);
    put(g, B(0.9, 0.9, 0.8, M.dark), 0, 3.2, 0.5);
    rifleGrip(g, M, 1.2);
    put(g, B(1.2, 0.5, 8, M.metal), 0, 1.3, 6.4);
    put(g, B(1.2, 0.5, 8.5, M.metal), 0, -0.6, 6.6, 0.12);
    put(g, B(1.4, 3.3, 0.8, M.black), 0, 0.4, 10.6);
    put(bolt, B(0.4, 0.6, 1.0, M.metal), 1.1, 1.85, -5.8);
    put(bolt, B(0.5, 0.9, 0.5, M.metal), 1.3, 2.3, -5.8);
    c.magRest.set(0, -0.4, -6.4);
    curvedMag(mag, M, M.dark, [[-1.1, 0, 0.05, 2.3], [-3.0, -0.35, 0.2, 2.3], [-4.9, -1.0, 0.36, 2.3], [-6.5, -1.9, 0.48, 1.6]]);
    c.muzzle.set(0, 1.5, -30.4);
    c.eject.set(1.0, 1.9, -5.2);
    c.leftGrip.set(-0.2, 0.1, -13.2);
    c.boltHand.set(1.7, 1.9, -5.8);
  },
  famas(c, M) {
    const { g, mag, bolt } = c;
    put(g, B(2.0, 3.0, 20, M.black), 0, 0.6, 0.5);
    put(g, B(1.9, 2.2, 6, M.black), 0, -1.4, 6.5);
    put(g, B(0.9, 0.75, 16, M.dark), 0, 4.1, -2.5);
    put(g, B(0.8, 1.6, 1.2, M.dark), 0, 3.1, -9.8);
    put(g, B(0.8, 1.6, 1.4, M.dark), 0, 3.1, 4.6);
    put(g, B(1.9, 1.9, 5, M.black), 0, 0.6, -12);
    put(g, CZ(0.4, 0.4, 7, M.metal, 8), 0, 1.1, -17.5);
    put(g, CZ(0.55, 0.5, 1.4, M.dark, 8), 0, 1.1, -21.6);
    put(g, CZ(0.18, 0.18, 7, M.metal, 6), 0.7, 0.2, -15.5);
    put(g, CZ(0.18, 0.18, 7, M.metal, 6), -0.7, 0.2, -15.5);
    put(g, B(1.4, 3.8, 1.9, M.black), 0, -2.1, 0.3, -0.28);
    put(g, B(0.35, 0.35, 4.0, M.black), 0, -0.9, -1.6);
    put(g, B(0.35, 2.6, 0.35, M.black), 0, -2.1, -3.5);
    put(g, B(0.25, 0.9, 0.3, M.dark), 0, -0.4, -1.4, 0.3);
    put(g, B(2.1, 3.6, 0.8, M.dark), 0, 0.4, 10.8);
    put(bolt, B(0.4, 0.6, 0.7, M.metal), 0, 3.3, -5.2);
    c.magRest.set(0, -1.6, 6.2);
    put(mag, B(1.3, 4.2, 2.2, M.dark), 0, -1.9, 0, 0.06);
    c.muzzle.set(0, 1.1, -22.4);
    c.eject.set(1.1, 1.0, 3.6);
    c.leftGrip.set(-0.2, -0.3, -12);
    c.boltHand.set(0, 3.6, -5.2);
  },
  sg552(c, M) {
    const { g, mag, bolt } = c;
    put(g, B(1.8, 2.5, 12, M.black), 0, 0.9, -3.4);
    put(g, B(2.0, 2.2, 7, M.black), 0, 1.0, -12.8);
    put(g, CZ(0.42, 0.42, 8, M.metal, 8), 0, 1.35, -19);
    put(g, CZ(0.55, 0.55, 1.6, M.dark, 8), 0, 1.35, -23.6);
    put(g, B(1.0, 1.2, 1.0, M.metal), 0, 1.9, -16.6);
    scope(g, M, 3.7, -4.0, 5, 0.95, 0.62);
    rifleGrip(g, M, 1.2);
    put(g, B(1.3, 0.55, 7.5, M.black), 0, 1.6, 5.6);
    put(g, B(1.3, 0.55, 7.5, M.black), 0, -0.5, 5.4, 0.1);
    put(g, B(1.5, 3.4, 0.8, M.black), 0, 0.6, 9.4);
    put(bolt, B(0.4, 0.5, 1.0, M.metal), 1.2, 1.8, -8);
    c.magRest.set(0, -0.5, -6);
    put(mag, B(1.4, 4.6, 2.6, M.dark), 0, -2.3, 0, 0.14);
    c.muzzle.set(0, 1.35, -24.4);
    c.eject.set(1.0, 1.9, -4.4);
    c.leftGrip.set(-0.2, -0.2, -12.8);
    c.boltHand.set(1.8, 1.8, -8);
  },
  aug(c, M) {
    const { g, mag, bolt } = c;
    put(g, B(2.2, 3.2, 14, M.olive), 0, 0.3, 3.6);
    put(g, B(2.0, 2.4, 3, M.olive), 0, 0.9, -4.8);
    put(g, B(1.5, 1.4, 11, M.black), 0, 2.25, -1.8);
    put(g, CZ(0.8, 0.8, 8.5, M.black, 12), 0, 3.9, -2.6);
    put(g, CZ(1.25, 0.85, 1.6, M.black, 12), 0, 3.9, -7.6);
    put(g, CZ(0.85, 1.0, 1.2, M.black, 12), 0, 3.9, 2.0);
    put(g, CZ(1.15, 1.15, 0.08, M.lens, 12), 0, 3.9, -8.42);
    put(g, CZ(0.55, 0.55, 13, M.metal, 8), 0, 1.3, -12.5);
    put(g, CZ(0.75, 0.75, 1.4, M.dark, 10), 0, 1.3, -6.6);
    put(g, CZ(0.62, 0.55, 1.8, M.dark, 8), 0, 1.3, -19.6);
    put(g, B(1.1, 3.0, 1.4, M.olive), 0, -1.0, -6.6, 0.12);
    put(g, B(1.3, 0.4, 6.6, M.olive), 0, -0.9, -2.2);
    put(g, B(1.4, 3.8, 2.0, M.olive), 0, -2.2, 0.6, -0.22);
    put(g, B(0.25, 0.9, 0.3, M.dark), 0, -0.3, -1.2, 0.3);
    put(g, B(2.3, 3.6, 0.6, M.black), 0, 0.2, 10.9);
    put(bolt, B(0.4, 0.5, 0.9, M.metal), -1.0, 2.1, -3.2);
    c.magRest.set(0, -1.3, 4.6);
    put(mag, B(1.4, 4.2, 2.4, M.dark), 0, -1.8, 0, 0.05);
    c.muzzle.set(0, 1.3, -20.5);
    c.eject.set(1.2, 1.6, 3.0);
    c.leftGrip.set(0, -2.4, -6.8);
    c.boltHand.set(-1.6, 2.1, -3.2);
  },
  m249(c, M) {
    const { g, mag, bolt } = c;
    put(g, B(2.4, 3.0, 13, M.black), 0, 1.2, -2.6);
    put(g, B(2.2, 0.8, 8, M.dark), 0, 3.1, -1.8);
    put(g, B(0.8, 1.0, 0.8, M.dark), 0, 3.9, 1.2);
    put(g, B(0.5, 1.4, 4.6, M.black), 0, 4.0, -9.8);
    put(g, B(2.0, 1.4, 6.5, M.dark), 0, 2.4, -12.6);
    put(g, B(2.2, 1.8, 6.5, M.black), 0, 0.6, -12.6);
    put(g, CZ(0.55, 0.55, 17, M.metal, 10), 0, 1.5, -21.5);
    put(g, CZ(0.32, 0.32, 9, M.dark, 8), 0, 0.4, -20);
    put(g, CZ(0.62, 0.55, 1.8, M.dark, 8), 0, 1.5, -30.6);
    put(g, B(0.3, 1.6, 0.5, M.dark), 0, 2.6, -28.5);
    put(g, CZ(0.22, 0.22, 10, M.metal, 6), 0.6, 0.0, -22);
    put(g, CZ(0.22, 0.22, 10, M.metal, 6), -0.6, 0.0, -22);
    rifleGrip(g, M, 1.5);
    put(g, B(2.0, 3.2, 8.5, M.black), 0, 0.5, 8.0, 0.06);
    put(g, B(2.1, 3.6, 0.8, M.dark), 0, 0.2, 12.3, 0.06);
    put(g, B(0.4, 0.9, 2.2, M.metal), -1.4, 0.4, -6);
    put(bolt, B(0.5, 0.6, 1.0, M.metal), 1.4, 1.6, -6.2);
    c.magRest.set(-0.2, -1.6, -6.2);
    put(mag, B(2.6, 3.4, 5, M.oliveDark), 0, 0, 0);
    put(mag, B(2.7, 0.4, 5.1, M.dark), 0, 1.7, 0);
    c.muzzle.set(0, 1.5, -31.4);
    c.eject.set(1.2, 0.4, -3.0);
    c.leftGrip.set(-0.3, 0.2, -12.6);
    c.boltHand.set(2.0, 1.6, -6.2);
  },

  // ---- SMGs ----
  mac10(c, M) {
    const { g, mag, bolt } = c;
    put(g, B(1.5, 2.4, 7.8, M.black), 0, 1.0, -2.6);
    put(g, B(1.4, 1.0, 5, M.black), 0, -0.3, -1.6);
    put(g, B(1.35, 4.4, 2.0, M.black), 0, -2.6, 0.2, -0.05);
    put(g, B(0.3, 0.3, 2.0, M.black), 0, -0.9, -2.2);
    put(g, B(0.3, 1.0, 0.3, M.black), 0, -0.4, -3.2);
    put(g, B(0.22, 0.8, 0.25, M.dark), 0, -0.3, -1.9, 0.2);
    put(g, CZ(0.42, 0.42, 3.0, M.metal, 8), 0, 1.3, -7.9);
    put(g, B(1.3, 1.6, 1.0, M.black), 0, 1.2, -6.8);
    put(g, B(0.3, 0.3, 2.6, M.dark), 0, -0.2, -6.2);
    put(g, B(0.3, 1.4, 0.3, M.dark), 0, -0.9, -7.4);
    put(g, CZ(0.18, 0.18, 7, M.metal, 6), 0.85, 0.6, -0.8);
    put(g, CZ(0.18, 0.18, 7, M.metal, 6), -0.85, 0.6, -0.8);
    put(g, B(1.9, 0.4, 1.4, M.metal), 0, 0.6, 3.0);
    put(g, B(0.8, 0.5, 0.5, M.dark), 0, 2.4, 0.8);
    put(g, B(0.25, 0.5, 0.3, M.dark), 0, 2.4, -6.2);
    put(bolt, B(0.6, 0.7, 0.6, M.metal), 0, 2.5, -3.8);
    c.magRest.set(0, -4.6, 0.3);
    put(mag, B(1.0, 4.8, 1.4, M.dark), 0, 0, 0, -0.05);
    put(mag, B(1.15, 0.4, 1.6, M.black), 0, -2.4, 0.1, -0.05);
    c.muzzle.set(0, 1.3, -9.5);
    c.eject.set(0.8, 1.7, -3.0);
    c.leftGrip.set(-0.6, -0.4, -6.4);
    c.boltHand.set(0, 3.0, -3.8);
  },
  tmp(c, M) {
    const { g, mag, bolt } = c;
    put(g, B(1.35, 2.1, 7.2, M.black), 0, 0.85, -2.4);
    put(g, B(0.8, 0.35, 5.5, M.dark), 0, 2.05, -2.5);
    put(g, B(1.25, 3.9, 1.9, M.black), 0, -1.9, 0.45, -0.18);
    put(g, B(0.3, 0.3, 2.2, M.black), 0, -0.75, -1.8);
    put(g, B(0.3, 1.0, 0.3, M.black), 0, -0.3, -2.9);
    put(g, B(0.22, 0.8, 0.25, M.dark), 0, -0.25, -1.5, 0.25);
    put(g, B(1.0, 2.8, 1.3, M.black), 0, -1.1, -5.5, 0.1);
    put(g, CZ(0.78, 0.78, 6.4, M.dark, 12), 0, 1.2, -9.1);
    put(g, B(1.2, 1.4, 1.0, M.black), 0, 1.1, -6.0);
    put(bolt, B(0.6, 0.4, 0.9, M.metal), 0, 2.05, 0.6);
    c.magRest.set(0, -4.3, 0.6);
    put(mag, B(0.95, 4.0, 1.4, M.dark), 0, 0, 0, -0.18);
    put(mag, B(1.1, 0.4, 1.6, M.black), 0, -2.0, 0.35, -0.18);
    c.muzzle.set(0, 1.2, -12.4);
    c.eject.set(0.8, 1.5, -2.6);
    c.leftGrip.set(-0.1, -2.2, -5.6);
    c.boltHand.set(0, 2.6, 0.6);
  },
  mp5navy(c, M) {
    const { g, mag, bolt } = c;
    put(g, CZ(1.0, 1.0, 11, M.dark, 12), 0, 1.6, -3.6).scale.set(0.95, 1, 1);
    put(g, B(1.5, 1.4, 5.2, M.black), 0, 0.35, -1.6);
    put(g, B(1.4, 1.6, 2.0, M.dark), 0, 0.0, -5.8);
    put(g, B(1.4, 4.0, 1.9, M.black), 0, -2.1, 1.1, -0.32);
    put(g, B(0.3, 0.3, 2.4, M.black), 0, -0.75, -1.0);
    put(g, B(0.3, 1.0, 0.3, M.black), 0, -0.3, -2.2);
    put(g, B(0.22, 0.8, 0.25, M.dark), 0, -0.3, -0.7, 0.3);
    put(g, B(1.8, 1.9, 6.2, M.black), 0, 1.2, -11.7);
    put(g, CZ(0.42, 0.42, 3.2, M.metal, 8), 0, 1.5, -16.2);
    put(g, B(1.2, 1.1, 0.7, M.dark), 0, 2.75, -14.6);
    put(g, CZ(0.32, 0.32, 7, M.dark, 8), 0, 2.45, -10.2);
    put(g, B(1.0, 0.9, 1.0, M.dark), 0, 2.85, 0.6);
    put(g, B(1.4, 2.0, 2.5, M.black), 0, 1.2, 3.4);
    put(g, B(1.6, 3.0, 6, M.black), 0, 0.6, 8.0, 0.12);
    put(g, B(1.7, 3.3, 0.5, M.dark), 0, 0.2, 11.1, 0.12);
    put(bolt, B(0.6, 0.5, 0.9, M.metal), -0.75, 2.45, -9.2);
    c.magRest.set(0, -0.4, -5.8);
    put(mag, B(1.1, 2.5, 1.7, M.dark), 0, -1.2, 0, 0.12);
    put(mag, B(1.1, 2.5, 1.7, M.dark), 0, -3.4, -0.5, 0.32);
    put(mag, B(1.1, 1.6, 1.65, M.dark), 0, -5.1, -1.3, 0.5);
    c.muzzle.set(0, 1.5, -17.8);
    c.eject.set(0.9, 1.9, -4.2);
    c.leftGrip.set(-0.2, 0.1, -11.6);
    c.boltHand.set(-1.4, 2.45, -9.2);
  },
  ump45(c, M) {
    const { g, mag, bolt } = c;
    put(g, B(1.6, 2.5, 13, M.black), 0, 1.2, -4.2);
    put(g, B(0.9, 0.45, 9, M.dark), 0, 2.7, -4.4);
    put(g, B(1.4, 3.9, 2.0, M.black), 0, -2.1, 1.4, -0.28);
    put(g, B(0.32, 0.32, 2.6, M.black), 0, -0.6, -1.0);
    put(g, B(0.32, 1.0, 0.32, M.black), 0, -0.15, -2.3);
    put(g, B(0.22, 0.8, 0.25, M.dark), 0, -0.2, -0.6, 0.3);
    put(g, CZ(0.45, 0.45, 3.0, M.metal, 8), 0, 1.4, -11.9);
    put(g, B(1.5, 1.6, 1.2, M.black), 0, 1.1, -10.4);
    put(g, B(0.3, 1.0, 0.5, M.dark), 0, 3.2, -9.8);
    put(g, B(0.9, 0.8, 0.6, M.dark), 0, 3.2, 0.8);
    put(g, B(1.2, 0.6, 7.5, M.black), 0, 2.0, 5.8);
    put(g, B(1.2, 0.5, 7.5, M.black), 0, -0.2, 5.6, 0.08);
    put(g, B(1.4, 3.0, 0.8, M.black), 0, 0.8, 9.6);
    put(bolt, B(0.5, 0.5, 1.0, M.metal), -1.0, 1.8, -7.2);
    c.magRest.set(0, -0.6, -5.2);
    put(mag, B(1.3, 4.6, 2.1, M.black), 0, -2.3, 0, 0.08);
    c.muzzle.set(0, 1.4, -13.4);
    c.eject.set(0.9, 1.9, -3.4);
    c.leftGrip.set(-0.2, -0.1, -8.6);
    c.boltHand.set(-1.6, 1.8, -7.2);
  },
  p90(c, M) {
    const { g, mag, bolt } = c;
    put(g, B(1.9, 2.4, 15, M.black), 0, 1.2, 1.0);
    put(g, B(1.8, 1.6, 5, M.black), 0, -0.6, -4.0);
    put(g, B(1.6, 3.6, 1.0, M.black), 0, -2.0, -2.3, 0.15);
    put(g, B(1.6, 0.8, 4.0, M.black), 0, -3.6, -0.4);
    put(g, B(1.5, 3.4, 2.0, M.black), 0, -1.9, 1.0, -0.12);
    put(g, B(2.0, 4.0, 4.5, M.black), 0, 0.2, 6.8, 0.05);
    put(g, B(2.1, 4.2, 0.6, M.dark), 0, 0.0, 9.2);
    put(g, B(1.4, 1.5, 2, M.black), 0, 1.1, -7.4);
    put(g, CZ(0.38, 0.38, 2.2, M.metal, 8), 0, 1.2, -9.4);
    put(g, B(1.0, 1.1, 3.2, M.dark), 0, 3.0, -3.6);
    put(g, B(1.5, 2.6, 1.2, M.black), 0, -1.6, -5.6, 0.2);
    put(bolt, B(0.4, 0.4, 0.8, M.metal), -1.1, 1.4, -5);
    c.magRest.set(0, 2.75, 0.6);
    put(mag, B(1.7, 0.9, 12, M.dark), 0, 0, 0);
    // the P90 magazine lifts off the top
    c.magDir.set(0, 0.8, 0.6);
    c.magTravel = 0.45;
    c.magHold.set(-1.4, 0.2, -3.5);
    c.muzzle.set(0, 1.2, -10.6);
    c.eject.set(0, -1.6, 1.4);
    c.leftGrip.set(-0.3, -2.4, -5.8);
    c.boltHand.set(-1.7, 1.4, -5);
  },

  // ---- shotguns ----
  m3(c, M) {
    const { g, bolt } = c;
    put(g, B(1.8, 2.5, 9, M.black), 0, 1.0, -3.6);
    put(g, CZ(0.9, 0.9, 9, M.black, 10), 0, 2.0, -3.6).scale.set(1, 0.5, 1);
    put(g, CZ(0.62, 0.62, 20, M.metal, 10), 0, 1.95, -18);
    put(g, CZ(0.55, 0.55, 17, M.dark, 10), 0, 0.55, -16.4);
    put(g, CZ(0.62, 0.62, 0.6, M.metal, 10), 0, 0.55, -25);
    put(g, B(1.4, 2.2, 0.7, M.dark), 0, 1.25, -24);
    put(g, SPH(0.25, 0.25, 0.25, M.metal, 6, 4), 0, 2.65, -27.6);
    put(g, B(1.0, 0.9, 0.5, M.dark), 0, 2.7, -0.5);
    put(g, B(1.2, 0.3, 3, M.hole), 0, -0.25, -3.5);
    rifleGrip(g, M, 1.2);
    put(g, B(1.5, 2.4, 4, M.black), 0, 0.5, 4.6);
    put(g, B(1.7, 3.6, 7, M.black), 0, -0.1, 9.6, 0.15);
    put(g, B(1.8, 3.9, 0.5, M.dark), 0, -0.6, 13.3, 0.15);
    // the pump slides along the magazine tube; the left hand rides on it
    put(bolt, CZ(1.0, 1.0, 7.5, M.black, 10), 0, 0.55, -13.5).scale.set(1, 0.95, 1);
    for (let i = 0; i < 4; i++) put(bolt, CZ(1.06, 1.06, 0.35, M.dark, 10), 0, 0.55, -16.4 + i * 1.9);
    c.leftOnBolt = true;
    c.muzzle.set(0, 1.95, -28.2);
    c.eject.set(1.0, 1.6, -4.4);
    c.leftGrip.set(-0.2, -0.4, -13.5);
    c.port.set(0, -0.8, -3.5);
  },
  xm1014(c, M) {
    const { g, bolt } = c;
    put(g, B(1.8, 2.4, 10, M.black), 0, 1.0, -3.5);
    put(g, B(0.9, 0.5, 7, M.dark), 0, 2.45, -3.2);
    put(g, CZ(0.6, 0.6, 18, M.metal, 10), 0, 1.9, -17.5);
    put(g, CZ(0.52, 0.52, 13, M.dark, 10), 0, 0.6, -14.5);
    put(g, CZ(0.98, 0.98, 6.5, M.black, 10), 0, 0.85, -11.8).scale.set(1, 0.9, 1);
    put(g, B(0.3, 0.9, 0.5, M.dark), 0, 2.5, -26);
    put(g, B(1.2, 0.3, 3, M.hole), 0, -0.25, -3.6);
    rifleGrip(g, M, 1.2);
    put(g, CZ(0.25, 0.25, 8, M.metal, 6), 0, 1.5, 5);
    put(g, CZ(0.25, 0.25, 8, M.metal, 6), 0, -0.3, 5);
    put(g, B(1.6, 3.6, 1.2, M.black), 0, 0.4, 9.4);
    put(g, B(1.4, 0.8, 3, M.black), 0, 1.9, 8);
    put(g, B(1.0, 0.9, 0.5, M.dark), 0, 2.85, 0.2);
    put(bolt, B(1.0, 0.5, 0.6, M.metal), 1.3, 1.4, -5.2);
    c.muzzle.set(0, 1.9, -26.6);
    c.eject.set(1.0, 1.6, -4.2);
    c.leftGrip.set(-0.2, -0.3, -12);
    c.boltHand.set(1.9, 1.4, -5.2);
    c.port.set(0, -0.8, -3.6);
  },

  // ---- pistols ----
  deagle(c, M) {
    const { g, mag, bolt } = c;
    put(bolt, B(1.25, 1.55, 10, M.silver), 0, 1.75, -3.6);
    put(bolt, CZ(0.95, 0.95, 9.6, M.silver, 3), 0, 2.45, -3.8, 0, 0, Math.PI);
    put(bolt, B(0.25, 0.35, 0.4, M.dark), 0, 3.15, -8.2);
    put(bolt, B(0.9, 0.35, 0.5, M.dark), 0, 3.0, 0.9);
    put(bolt, CZ(0.36, 0.36, 0.2, M.hole, 8), 0, 1.9, -8.65);
    put(g, B(1.2, 1.1, 7.5, M.silverDark), 0, 0.5, -3);
    put(g, B(0.3, 0.3, 2.6, M.silverDark), 0, -0.9, -1.6);
    put(g, B(0.3, 1.1, 0.3, M.silverDark), 0, -0.4, -2.9);
    put(g, B(0.22, 0.8, 0.3, M.dark), 0, -0.3, -1.2, 0.3);
    put(g, B(1.4, 4.6, 2.3, M.black), 0, -2.2, 0.9, -0.24);
    put(g, B(0.4, 0.8, 0.5, M.dark), 0, 2.4, 1.6, 0.4);
    c.magRest.set(0, -4.2, 1.5);
    put(mag, B(1.25, 0.45, 2.2, M.dark), 0, 0, 0, -0.24);
    put(mag, B(0.9, 3.6, 1.7, M.dark), 0, 1.9, -0.45, -0.24);
    c.muzzle.set(0, 1.9, -8.9);
    c.eject.set(0.9, 2.1, -2);
    c.leftGrip.set(-1.1, -2.6, 0.2);
  },
  glock18(c, M) {
    const { g, mag, bolt } = c;
    put(bolt, B(1.05, 1.35, 7.3, M.black), 0, 1.5, -2.6);
    for (let i = 0; i < 4; i++) put(bolt, B(1.1, 1.0, 0.12, M.metal), 0, 1.5, 0.3 + i * 0.25);
    put(bolt, B(0.2, 0.25, 0.3, M.metal), 0, 2.3, -5.9);
    put(bolt, B(0.8, 0.3, 0.4, M.metal), 0, 2.3, 0.6);
    put(g, B(1.0, 0.9, 6.2, M.black), 0, 0.45, -2.3);
    put(g, B(1.15, 4.3, 2.05, M.black), 0, -2.1, 0.75, -0.3);
    put(g, B(0.3, 0.3, 2.3, M.black), 0, -0.85, -1.6);
    put(g, B(0.3, 1.0, 0.3, M.black), 0, -0.35, -2.8);
    put(g, B(0.22, 0.7, 0.25, M.dark), 0, -0.25, -1.3, 0.25);
    c.magRest.set(0, -4.0, 1.35);
    put(mag, B(1.15, 0.4, 2.0, M.black), 0, 0, 0, -0.3);
    put(mag, B(0.85, 3.4, 1.6, M.dark), 0, 1.8, -0.5, -0.3);
    c.muzzle.set(0, 1.5, -6.4);
    c.eject.set(0.8, 1.8, -2);
    c.leftGrip.set(-1.0, -2.5, 0.2);
  },
  usp(c, M) {
    const { g, mag, bolt } = c;
    put(bolt, B(1.1, 1.45, 7.6, M.black), 0, 1.55, -2.7);
    for (let i = 0; i < 5; i++) put(bolt, B(1.15, 1.1, 0.1, M.metal), 0, 1.55, 0.1 + i * 0.22);
    put(bolt, B(0.2, 0.25, 0.3, M.metal), 0, 2.4, -6.1);
    put(bolt, B(0.8, 0.3, 0.4, M.metal), 0, 2.4, 0.8);
    put(g, B(1.05, 1.0, 6.6, M.black), 0, 0.45, -2.3);
    put(g, B(0.9, 0.4, 2.0, M.black), 0, -0.15, -4.6);
    put(g, B(1.2, 4.4, 2.1, M.black), 0, -2.15, 0.8, -0.27);
    put(g, B(0.3, 0.3, 2.4, M.black), 0, -0.85, -1.6);
    put(g, B(0.3, 1.0, 0.3, M.black), 0, -0.35, -2.85);
    put(g, B(0.4, 0.7, 0.45, M.dark), 0, 2.1, 1.15, 0.35);
    c.silencer = put(g, CZ(0.62, 0.62, 6.4, M.metal, 12), 0, 1.55, -9.75);
    c.magRest.set(0, -4.1, 1.4);
    put(mag, B(1.2, 0.4, 2.05, M.black), 0, 0, 0, -0.27);
    put(mag, B(0.85, 3.5, 1.6, M.dark), 0, 1.85, -0.5, -0.27);
    c.muzzle.set(0, 1.55, -6.6);
    c.silMuzzle = new THREE.Vector3(0, 1.55, -13);
    c.eject.set(0.8, 1.9, -2.2);
    c.leftGrip.set(-1.0, -2.6, 0.2);
  },
  p228(c, M) {
    const { g, mag, bolt } = c;
    pistolSlide(bolt, M, 0, 6.9, M.black);
    pistolFrame(g, M, 0, 5.9, M.black, M.dark);
    put(g, B(0.35, 0.6, 0.45, M.dark), 0, 2.15, 1.25, 0.4);
    c.magRest.set(0, -4.0, 1.3);
    pistolMag(mag, M, 0);
    c.muzzle.set(0, 1.55, -6.2);
    c.eject.set(0.8, 1.8, -2);
    c.leftGrip.set(-1.0, -2.5, 0.2);
  },
  fiveseven(c, M) {
    const { g, mag, bolt } = c;
    pistolSlide(bolt, M, 0, 7.6, M.gray, M.dark);
    pistolFrame(g, M, 0, 6.8, M.black);
    put(g, B(0.8, 0.4, 2, M.black), 0, -0.1, -5);
    c.magRest.set(0, -4.0, 1.3);
    pistolMag(mag, M, 0);
    c.muzzle.set(0, 1.55, -6.9);
    c.eject.set(0.8, 1.8, -2.2);
    c.leftGrip.set(-1.0, -2.5, 0.2);
  },
  elite(c, M) {
    const { g, mag, bolt } = c;
    // two pistols side by side; the left hand holds the second one
    for (const x of [0, -11.2]) {
      put(bolt, B(1.0, 1.3, 8.0, M.silver), x, 1.55, -2.7);
      put(bolt, B(0.6, 0.3, 4.0, M.dark), x, 2.25, -4.3);
      for (let i = 0; i < 4; i++) put(bolt, B(1.05, 1.0, 0.1, M.silverDark), x, 1.55, 0.3 + i * 0.22);
      put(bolt, B(0.2, 0.25, 0.3, M.metal), x, 2.3, -6.4);
      put(bolt, B(0.8, 0.3, 0.4, M.metal), x, 2.3, 0.7);
      put(bolt, CZ(0.3, 0.3, 0.2, M.hole, 8), x, 1.6, -6.75);
      pistolFrame(g, M, x, 6.5, M.black, M.dark);
      put(g, B(0.35, 0.6, 0.45, M.dark), x, 2.2, 1.25, 0.4);
      pistolMag(mag, M, x);
    }
    c.magRest.set(0, -4.0, 1.3);
    c.muzzle.set(0, 1.6, -7.0);
    c.muzzle2 = new THREE.Vector3(-11.2, 1.6, -7.0);
    c.eject.set(0.8, 1.9, -2.2);
    c.leftGrip.set(-11.6, -1.8, 1.4);
  },
  knife(c, M) {
    const { g } = c;
    put(g, CZ(0.55, 0.6, 4.6, M.black, 8), 0, 0, 1.3).scale.set(0.8, 1.15, 1);
    put(g, B(1.05, 1.3, 0.5, M.metal), 0, -0.05, 3.7);
    put(g, B(0.5, 2.3, 0.45, M.metal), 0, 0.1, -1.05);
    g.add(knifeBlade(M.blade));
    c.muzzle.set(0, 0.2, -10);
    c.leftGrip.set(-6, -6, 4);
  },

  // ---- grenades (origin at the grenade's centre) ----
  hegrenade(c, M) {
    const { g, bolt } = c;
    put(g, SPH(1.2, 1.35, 1.2, M.olive, 10, 8), 0, 0, 0);
    put(g, CY(1.0, 1.0, 0.3, M.oliveDark, 10), 0, -0.9, 0);
    grenadeTop(g, bolt, M, 1.55);
    c.muzzle.set(0, 1.5, 0);
    c.leftGrip.set(-6, -9, -3);
    c.boltHand.set(-1.5, 1.9, -1.6);
  },
  flashbang(c, M) {
    const { g, bolt } = c;
    put(g, CY(0.82, 0.82, 3.0, M.gray, 12), 0, 0.1, 0);
    put(g, CY(0.86, 0.86, 0.25, M.dark, 12), 0, 1.25, 0);
    put(g, CY(0.86, 0.86, 0.25, M.dark, 12), 0, -1.05, 0);
    grenadeTop(g, bolt, M, 1.95);
    c.muzzle.set(0, 1.9, 0);
    c.leftGrip.set(-6, -9, -3);
    c.boltHand.set(-1.5, 2.3, -1.6);
  },
  // ---- the bomb: three charges taped together under a keypad timer ----
  c4(c, M) {
    const { g } = c;
    const S = 1.7; // a brick about 8 x 11 inches
    const P = (o, x, y, z, rx, ry, rz) => put(g, o, x * S, y * S, z * S, rx, ry, rz);
    for (const x of [-1.55, 0, 1.55]) P(B(1.45 * S, 1.5 * S, 6.6 * S, M.clay), x, 0, -0.8);
    for (const z of [-3.2, 1.6]) P(B(4.9 * S, 1.62 * S, 0.8 * S, M.tape), 0, 0, z);
    P(B(3.6 * S, 0.75 * S, 3.4 * S, M.dark), 0, 1.1, -1.0);
    P(B(2.4 * S, 0.1 * S, 1.0 * S, M.lcd), 0, 1.5, -2.1);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) P(B(0.55 * S, 0.14 * S, 0.45 * S, M.key), -0.75 + k * 0.75, 1.52, -0.95 + r * 0.6);
    P(CZ(0.11 * S, 0.11 * S, 3.4 * S, M.wireRed, 5), 1.95, 0.95, -0.8);
    P(CZ(0.11 * S, 0.11 * S, 3.4 * S, M.wireBlue, 5), -1.95, 0.95, -0.8);
    P(CZ(0.11 * S, 0.11 * S, 2.6 * S, M.wireYellow, 5), 1.0, 0.85, 1.4, 0, 0.7, 0);
    c.muzzle.set(0, 1.6 * S, -2.1 * S); // the display: where the light blinks
    c.leftGrip.set(-4, -5, 2);
    c.boltHand.set(0.2 * S, 1.75 * S, -0.5 * S); // fingers on the keypad
  },
  // defuse kit: a small pouch with wire cutters
  defuser(c, M) {
    const { g } = c;
    put(g, B(3.4, 1.4, 4.6, M.black), 0, 0, 0);
    put(g, B(3.0, 0.3, 1.6, M.tape), 0, 0.8, -1.2);
    put(g, B(0.5, 0.4, 3.0, M.metal), 0.8, 0.85, 0.6);
    put(g, B(0.5, 0.4, 3.0, M.wireRed), -0.4, 0.85, 0.6);
  },
  smokegrenade(c, M) {
    const { g, bolt } = c;
    put(g, CY(0.9, 0.9, 3.2, M.smokeGray, 12), 0, 0.1, 0);
    put(g, CY(0.94, 0.94, 0.4, M.band, 12), 0, 0.6, 0);
    put(g, CY(0.94, 0.94, 0.2, M.dark, 12), 0, -1.4, 0);
    grenadeTop(g, bolt, M, 2.05);
    c.muzzle.set(0, 2.0, 0);
    c.leftGrip.set(-6, -9, -3);
    c.boltHand.set(-1.5, 2.4, -1.6);
  },
};

// Weapon meshes: origin at the grip, barrel toward -Z, ~1 unit per inch.
// Returns the moving parts (magazine, bolt/slide/pump/pin) and hand anchors.
export function buildWeapon(id, T) {
  const M = weaponMats(T);
  const g = new THREE.Group();
  const mag = new THREE.Group();
  const bolt = new THREE.Group();
  const c = {
    g, mag, bolt,
    muzzle: new THREE.Vector3(), eject: new THREE.Vector3(), leftGrip: new THREE.Vector3(),
    boltHand: new THREE.Vector3(), magRest: new THREE.Vector3(), port: new THREE.Vector3(0, -1, -3),
    magDir: new THREE.Vector3(0, -1, 0.12), magHold: new THREE.Vector3(-0.6, -2.5, 0), magTravel: 1,
    silencer: null, silMuzzle: null, muzzle2: null, leftOnBolt: false,
  };
  BUILD[id](c, M);
  const muzzle = new THREE.Object3D();
  const eject = new THREE.Object3D();
  const leftGrip = new THREE.Object3D();   // on the weapon
  const boltHand = new THREE.Object3D();   // on the bolt / charging handle / pin
  const port = new THREE.Object3D();       // shotgun loading port
  muzzle.position.copy(c.muzzle);
  eject.position.copy(c.eject);
  leftGrip.position.copy(c.leftGrip);
  boltHand.position.copy(c.boltHand);
  port.position.copy(c.port);
  mag.position.copy(c.magRest);
  if (mag.children.length) g.add(mag);
  g.add(bolt, muzzle, eject, port);
  bolt.add(boltHand);
  if (c.leftOnBolt) bolt.add(leftGrip);
  else g.add(leftGrip);
  let muzzle2 = null;
  if (c.muzzle2) {
    muzzle2 = new THREE.Object3D();
    muzzle2.position.copy(c.muzzle2);
    g.add(muzzle2);
  }
  const baseMuzzle = muzzle.position.clone();
  const boltRest = bolt.position.clone();
  const silencer = c.silencer, silMuzzle = c.silMuzzle;
  return {
    group: g, muzzle, muzzle2, eject, port, mag, bolt, magRest: c.magRest.clone(), boltRest, leftGrip, boltHand,
    silencer, silMuzzle, baseMuzzle, magDir: c.magDir.clone().normalize().multiplyScalar(c.magTravel), magHold: c.magHold.clone(),
    setSilenced(on) {
      if (!silencer) return;
      silencer.visible = on;
      muzzle.position.copy(on ? silMuzzle : baseMuzzle);
    },
  };
}

export const isPistol = (id) => ['glock18', 'usp', 'deagle', 'p228', 'elite', 'fiveseven'].includes(id);
export const isGrenade = (id) => id === 'hegrenade' || id === 'flashbang' || id === 'smokegrenade';
export const isC4 = (id) => id === 'c4';

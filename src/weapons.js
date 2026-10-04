// Weapon data and firing logic. Spread, accuracy and recoil (KickBack) follow
// the CS 1.6 weapon code, including its integer-division accuracy quirk.
//
// spread(acc, s): s = { air, speed, duck, zoomed, silenced, burst }
// acc:  auto weapons, accuracy = (shots^pow / div) + base after every shot
// kick: KickBack(upBase, latBase, upMod, latMod, upMax, latMax, dirChange) per stance

const kb = (air, move, duck, stand) => ({ air, move, duck, stand });

export const WEAPONS = {
  knife: {
    id: 'knife', name: 'Knife', slot: 3, type: 'knife', speed: 250, armorRatio: 1.7, deploy: 0.75,
  },

  // ---------------- pistols ----------------
  glock18: {
    id: 'glock18', name: 'Glock 18', slot: 2, type: 'pistol', cat: 'pistol', price: 400,
    dmg: 25, rangeMod: 0.75, armorRatio: 1.05, penPower: 21, penCount: 1, cycle: 0.15, clip: 20, reserve: 120,
    reload: 2.2, speed: 250, deploy: 0.75, accStart: 0.9, accMin: 0.6, accMax: 0.9, accK: 0.325, accM: 0.275, punch: 0.8,
    burstShots: 3, burstGap: 0.055, burstCycle: 0.5, burstMsg: 'semiMode',
    spread: (a, s) => s.burst
      ? (1 - a) * (s.air ? 1.2 : s.speed > 0 ? 0.185 : s.duck ? 0.095 : 0.3)
      : (1 - a) * (s.air ? 1.0 : s.speed > 0 ? 0.165 : s.duck ? 0.075 : 0.1),
  },
  usp: {
    id: 'usp', name: 'USP', slot: 2, type: 'pistol', cat: 'pistol', price: 500,
    dmg: 34, silDmg: 30, rangeMod: 0.79, armorRatio: 1.0, penPower: 15, penCount: 1, cycle: 0.15, clip: 12, reserve: 100,
    reload: 2.7, speed: 250, deploy: 0.75, accStart: 0.92, accMin: 0.6, accMax: 0.92, accK: 0.3, accM: 0.275, punch: 1.6,
    silencerTime: 3.1,
    spread: (a, s) => s.silenced
      ? (1 - a) * (s.air ? 1.3 : s.speed > 0 ? 0.25 : s.duck ? 0.125 : 0.15)
      : (1 - a) * (s.air ? 1.2 : s.speed > 0 ? 0.225 : s.duck ? 0.08 : 0.1),
  },
  p228: {
    id: 'p228', name: 'P228', slot: 2, type: 'pistol', cat: 'pistol', price: 600,
    dmg: 32, rangeMod: 0.8, armorRatio: 1.25, penPower: 25, penCount: 1, cycle: 0.15, clip: 13, reserve: 52,
    reload: 2.7, speed: 250, deploy: 0.75, accStart: 0.9, accMin: 0.6, accMax: 0.9, accK: 0.325, accM: 0.3, punch: 2,
    spread: (a, s) => (1 - a) * (s.air ? 1.5 : s.speed > 0 ? 0.255 : s.duck ? 0.075 : 0.15),
  },
  deagle: {
    id: 'deagle', name: 'Desert Eagle', slot: 2, type: 'pistol', cat: 'pistol', price: 650,
    dmg: 54, rangeMod: 0.81, armorRatio: 1.5, penPower: 30, penCount: 2, cycle: 0.225, clip: 7, reserve: 35,
    reload: 2.2, speed: 250, deploy: 0.75, accStart: 0.9, accMin: 0.55, accMax: 0.9, accK: 0.4, accM: 0.35, punch: 2,
    spread: (a, s) => (1 - a) * (s.air ? 1.5 : s.speed > 0 ? 0.25 : s.duck ? 0.115 : 0.13),
  },
  elite: {
    id: 'elite', name: 'Dual Elites', slot: 2, type: 'pistol', cat: 'pistol', price: 800, team: 'T',
    dmg: 36, rangeMod: 0.75, armorRatio: 1.05, penPower: 21, penCount: 1, cycle: 0.12, clip: 30, reserve: 120,
    reload: 4.5, speed: 250, deploy: 0.75, accStart: 0.88, accMin: 0.55, accMax: 0.88, accK: 0.325, accM: 0.275, punch: 2,
    spread: (a, s) => (1 - a) * (s.air ? 1.3 : s.speed > 0 ? 0.175 : s.duck ? 0.08 : 0.1),
  },
  fiveseven: {
    id: 'fiveseven', name: 'Five-SeveN', slot: 2, type: 'pistol', cat: 'pistol', price: 750, team: 'CT',
    dmg: 20, rangeMod: 0.885, armorRatio: 1.5, penPower: 30, penCount: 1, cycle: 0.15, clip: 20, reserve: 100,
    reload: 2.7, speed: 250, deploy: 0.75, accStart: 0.92, accMin: 0.725, accMax: 0.92, accK: 0.275, accM: 0.25, punch: 2,
    spread: (a, s) => (1 - a) * (s.air ? 1.5 : s.speed > 0 ? 0.255 : s.duck ? 0.075 : 0.15),
  },

  // ---------------- shotguns ----------------
  m3: {
    id: 'm3', name: 'M3 Super 90', slot: 1, type: 'shotgun', cat: 'shotgun', price: 1700, auto: true,
    dmg: 20, pellets: 9, cone: 0.0675, armorRatio: 1.0, penCount: 0, cycle: 0.875, clip: 8, reserve: 32,
    speed: 230, deploy: 0.75, reloadStart: 0.55, reloadShell: 0.45, punchGround: [4, 6], punchAir: [8, 11], pump: true,
  },
  xm1014: {
    id: 'xm1014', name: 'XM1014', slot: 1, type: 'shotgun', cat: 'shotgun', price: 3000, auto: true,
    dmg: 20, pellets: 6, cone: 0.0725, armorRatio: 1.0, penCount: 0, cycle: 0.25, clip: 7, reserve: 32,
    speed: 240, deploy: 0.75, reloadStart: 0.55, reloadShell: 0.3, punchGround: [3, 5], punchAir: [7, 10],
  },

  // ---------------- SMGs ----------------
  mac10: {
    id: 'mac10', name: 'MAC-10', slot: 1, type: 'smg', cat: 'smg', price: 1400, team: 'T', auto: true,
    dmg: 29, rangeMod: 0.82, armorRatio: 0.95, penPower: 15, penCount: 1, cycle: 0.07, clip: 30, reserve: 100,
    reload: 3.15, speed: 250, deploy: 0.75, accStart: 0.15, acc: { pow: 3, div: 200, base: 0.6, max: 1.65, floor: true },
    spread: (a, s) => (s.air ? 0.375 : 0.03) * a,
    kick: kb([1.3, 0.55, 0.4, 0.05, 4.75, 3.75, 5], [0.9, 0.45, 0.25, 0.035, 3.5, 2.75, 7], [0.75, 0.4, 0.175, 0.03, 2.75, 2.5, 10], [0.775, 0.425, 0.2, 0.03, 3, 2.75, 9]),
  },
  tmp: {
    id: 'tmp', name: 'TMP', slot: 1, type: 'smg', cat: 'smg', price: 1250, team: 'CT', auto: true, quiet: true,
    dmg: 20, rangeMod: 0.85, armorRatio: 1.0, penPower: 21, penCount: 1, cycle: 0.07, clip: 30, reserve: 120,
    reload: 2.12, speed: 250, deploy: 0.75, accStart: 0.2, acc: { pow: 3, div: 200, base: 0.55, max: 1.4, floor: true },
    spread: (a, s) => (s.air ? 0.25 : 0.03) * a,
    kick: kb([1.1, 0.5, 0.35, 0.045, 4.5, 3.5, 6], [0.8, 0.4, 0.2, 0.03, 3, 2.5, 7], [0.7, 0.35, 0.125, 0.025, 2.5, 2, 10], [0.725, 0.375, 0.15, 0.025, 2.75, 2.25, 9]),
  },
  mp5navy: {
    id: 'mp5navy', name: 'MP5 Navy', slot: 1, type: 'smg', cat: 'smg', price: 1500, auto: true,
    dmg: 26, rangeMod: 0.84, armorRatio: 1.0, penPower: 21, penCount: 1, cycle: 0.075, clip: 30, reserve: 120,
    reload: 2.63, speed: 250, deploy: 0.75, accStart: 0, acc: { pow: 2, div: 220.1, base: 0.45, max: 0.75, floor: false },
    spread: (a, s) => (s.air ? 0.2 : 0.04) * a,
    kick: kb([0.9, 0.475, 0.35, 0.0425, 5, 3, 6], [0.5, 0.275, 0.2, 0.03, 3, 2, 10], [0.225, 0.15, 0.1, 0.015, 2, 1, 10], [0.25, 0.175, 0.125, 0.02, 2.25, 1.25, 10]),
  },
  ump45: {
    id: 'ump45', name: 'UMP45', slot: 1, type: 'smg', cat: 'smg', price: 1700, auto: true,
    dmg: 30, rangeMod: 0.82, armorRatio: 1.0, penPower: 15, penCount: 1, cycle: 0.1, clip: 25, reserve: 100,
    reload: 3.5, speed: 250, deploy: 0.75, accStart: 0, acc: { pow: 2, div: 210, base: 0.5, max: 1, floor: true },
    spread: (a, s) => (s.air ? 0.24 : 0.04) * a,
    kick: kb([0.125, 0.65, 0.55, 0.0475, 5.5, 4, 10], [0.55, 0.3, 0.225, 0.03, 3.5, 2.5, 10], [0.25, 0.175, 0.125, 0.02, 2.25, 1.25, 10], [0.275, 0.2, 0.15, 0.0225, 2.5, 1.5, 10]),
  },
  p90: {
    id: 'p90', name: 'P90', slot: 1, type: 'smg', cat: 'smg', price: 2350, auto: true,
    dmg: 21, rangeMod: 0.885, armorRatio: 1.5, penPower: 30, penCount: 1, cycle: 0.066, clip: 50, reserve: 100,
    reload: 3.4, speed: 245, deploy: 0.75, accStart: 0.2, acc: { pow: 2, div: 175, base: 0.45, max: 1, floor: true },
    spread: (a, s) => (s.air ? 0.3 : s.speed > 170 ? 0.115 : 0.045) * a,
    kick: kb([0.9, 0.45, 0.35, 0.04, 5.25, 3.5, 4], [0.45, 0.3, 0.2, 0.0275, 4, 2.25, 7], [0.275, 0.2, 0.125, 0.02, 3, 1, 9], [0.3, 0.225, 0.125, 0.02, 3.25, 1.25, 8]),
  },

  // ---------------- rifles ----------------
  galil: {
    id: 'galil', name: 'Galil', slot: 1, type: 'rifle', cat: 'rifle', price: 2000, team: 'T', auto: true,
    dmg: 30, rangeMod: 0.98, armorRatio: 1.55, penPower: 35, penCount: 2, cycle: 0.0875, clip: 35, reserve: 90,
    reload: 2.45, speed: 240, deploy: 0.75, accStart: 0.2, acc: { pow: 3, div: 200, base: 0.35, max: 1.25, floor: true },
    spread: (a, s) => (s.air ? 0.04 + 0.3 * a : s.speed > 140 ? 0.04 + 0.07 * a : 0.0375 * a),
    kick: kb([1.2, 0.5, 0.23, 0.15, 5.5, 3.5, 6], [1, 0.45, 0.28, 0.045, 3.75, 3, 7], [0.6, 0.3, 0.2, 0.0125, 3.25, 2, 7], [0.65, 0.35, 0.25, 0.015, 3.5, 2.25, 7]),
  },
  famas: {
    id: 'famas', name: 'FAMAS', slot: 1, type: 'rifle', cat: 'rifle', price: 2250, team: 'CT', auto: true,
    dmg: 30, rangeMod: 0.96, armorRatio: 1.4, penPower: 35, penCount: 2, cycle: 0.0825, clip: 25, reserve: 90,
    reload: 3.3, speed: 240, deploy: 0.75, accStart: 0.2, acc: { pow: 3, div: 215, base: 0.3, max: 1, floor: true },
    burstShots: 3, burstGap: 0.07, burstCycle: 0.55, burstMsg: 'autoMode',
    spread: (a, s) => (s.air ? 0.03 + 0.3 * a : s.speed > 140 ? 0.03 + 0.07 * a : 0.02 * a) + (s.burst ? 0.01 : 0),
    kick: kb([1.25, 0.45, 0.22, 0.18, 5.5, 4, 5], [1, 0.45, 0.275, 0.05, 4, 2.5, 7], [0.575, 0.325, 0.2, 0.011, 3.25, 2, 8], [0.625, 0.375, 0.25, 0.0125, 3.5, 2.25, 8]),
  },
  ak47: {
    id: 'ak47', name: 'AK-47', slot: 1, type: 'rifle', cat: 'rifle', price: 2500, team: 'T', auto: true,
    dmg: 36, rangeMod: 0.98, armorRatio: 1.55, penPower: 39, penCount: 2, cycle: 0.0955, clip: 30, reserve: 90,
    reload: 2.45, speed: 221, deploy: 0.75, accStart: 0.2, acc: { pow: 3, div: 200, base: 0.35, max: 1.25, floor: true },
    spread: (a, s) => (s.air ? 0.04 + 0.4 * a : s.speed > 140 ? 0.04 + 0.07 * a : 0.0275 * a),
    kick: kb([2, 1, 0.5, 0.35, 9, 6, 5], [1.5, 0.45, 0.225, 0.05, 6.5, 2.5, 7], [0.9, 0.35, 0.15, 0.025, 5.5, 1.5, 9], [1, 0.375, 0.175, 0.0375, 5.75, 1.75, 8]),
  },
  m4a1: {
    id: 'm4a1', name: 'M4A1', slot: 1, type: 'rifle', cat: 'rifle', price: 3100, team: 'CT', auto: true,
    dmg: 32, silDmg: 33, rangeMod: 0.97, silRangeMod: 0.95, armorRatio: 1.4, penPower: 35, penCount: 2, cycle: 0.0875,
    clip: 30, reserve: 90, reload: 3.05, speed: 230, deploy: 0.75, silencerTime: 2.0,
    accStart: 0.2, acc: { pow: 3, div: 220, base: 0.3, max: 1, floor: true },
    spread: (a, s) => s.silenced
      ? (s.air ? 0.035 + 0.4 * a : s.speed > 140 ? 0.035 + 0.07 * a : 0.025 * a)
      : (s.air ? 0.035 + 0.4 * a : s.speed > 140 ? 0.035 + 0.07 * a : 0.02 * a),
    kick: kb([1.2, 0.5, 0.23, 0.15, 5.5, 3.5, 6], [1, 0.45, 0.28, 0.045, 3.75, 3, 7], [0.6, 0.3, 0.2, 0.0125, 3.25, 2, 7], [0.65, 0.35, 0.25, 0.015, 3.5, 2.25, 7]),
  },
  sg552: {
    id: 'sg552', name: 'SG 552', slot: 1, type: 'rifle', cat: 'rifle', price: 3500, team: 'T', auto: true,
    dmg: 33, rangeMod: 0.955, armorRatio: 1.4, penPower: 35, penCount: 2, cycle: 0.0825, cycleZoom: 0.135,
    clip: 30, reserve: 90, reload: 3.0, speed: 235, zoomSpeed: 200, deploy: 0.75, zoom: [90, 55],
    accStart: 0.2, acc: { pow: 3, div: 220, base: 0.3, max: 1, floor: true },
    spread: (a, s) => (s.air ? 0.035 + 0.45 * a : s.speed > 140 ? 0.035 + 0.075 * a : 0.02 * a),
    kick: kb([1.25, 0.45, 0.22, 0.18, 6, 4, 5], [1, 0.45, 0.28, 0.04, 4.25, 2.5, 7], [0.6, 0.35, 0.2, 0.0125, 3.7, 2, 10], [0.625, 0.375, 0.25, 0.0125, 4, 2.25, 9]),
  },
  aug: {
    id: 'aug', name: 'AUG', slot: 1, type: 'rifle', cat: 'rifle', price: 3500, team: 'CT', auto: true,
    dmg: 32, rangeMod: 0.96, armorRatio: 1.4, penPower: 35, penCount: 2, cycle: 0.0825, cycleZoom: 0.135,
    clip: 30, reserve: 90, reload: 3.3, speed: 240, zoomSpeed: 221, deploy: 0.75, zoom: [90, 55],
    accStart: 0.2, acc: { pow: 3, div: 215, base: 0.3, max: 1, floor: true },
    spread: (a, s) => (s.air ? 0.035 + 0.4 * a : s.speed > 140 ? 0.035 + 0.07 * a : 0.02 * a),
    kick: kb([1.25, 0.45, 0.22, 0.18, 5.5, 4, 5], [1, 0.45, 0.275, 0.05, 4, 2.5, 7], [0.575, 0.325, 0.2, 0.011, 3.25, 2, 8], [0.625, 0.375, 0.25, 0.0125, 3.5, 2.25, 8]),
  },
  scout: {
    id: 'scout', name: 'Scout', slot: 1, type: 'sniper', cat: 'rifle', price: 2750, auto: true,
    dmg: 75, rangeMod: 0.98, armorRatio: 1.7, penPower: 39, penCount: 3, cycle: 1.25, clip: 10, reserve: 90,
    reload: 2.0, speed: 260, zoomSpeed: 220, deploy: 0.75, zoom: [90, 40, 15], scope: true, boltAction: true, punch: 2,
    spread: (a, s) => (s.air ? 0.2 : s.speed > 170 ? 0.075 : s.duck ? 0 : 0.007) + (s.zoomed ? 0 : 0.025),
  },
  awp: {
    id: 'awp', name: 'AWP', slot: 1, type: 'sniper', cat: 'rifle', price: 4750, auto: true,
    dmg: 115, rangeMod: 0.99, armorRatio: 1.95, penPower: 45, penCount: 3, cycle: 1.45, clip: 10, reserve: 30,
    reload: 2.5, speed: 210, zoomSpeed: 150, deploy: 0.75, zoom: [90, 40, 10], scope: true, boltAction: true, punch: 2,
    spread: (a, s) => (s.air ? 0.85 : s.speed > 140 ? 0.25 : s.speed > 10 ? 0.1 : s.duck ? 0 : 0.001) + (s.zoomed ? 0 : 0.08),
  },
  g3sg1: {
    id: 'g3sg1', name: 'G3/SG-1', slot: 1, type: 'sniper', cat: 'rifle', price: 5000, team: 'T', auto: true,
    dmg: 80, rangeMod: 0.98, armorRatio: 1.65, penPower: 39, penCount: 3, cycle: 0.25, clip: 20, reserve: 90,
    reload: 3.5, speed: 210, zoomSpeed: 150, deploy: 0.75, zoom: [90, 40, 15], scope: true,
    accStart: 0.98, snAcc: { base: 0.55, k: 0.3 }, randPunch: [0.75, 1.75],
    spread: (a, s) => (s.air ? 0.45 * (1 - a) : s.speed > 0 ? 0.15 : s.duck ? 0.035 * (1 - a) : 0.055 * (1 - a)) + (s.zoomed ? 0 : 0.025),
  },
  sg550: {
    id: 'sg550', name: 'SG 550', slot: 1, type: 'sniper', cat: 'rifle', price: 4200, team: 'CT', auto: true,
    dmg: 70, rangeMod: 0.98, armorRatio: 1.45, penPower: 35, penCount: 2, cycle: 0.25, clip: 30, reserve: 90,
    reload: 3.35, speed: 210, zoomSpeed: 150, deploy: 0.75, zoom: [90, 40, 15], scope: true,
    accStart: 0.98, snAcc: { base: 0.65, k: 0.35 }, randPunch: [0.75, 1.25],
    spread: (a, s) => (s.air ? 0.45 * (1 - a) : s.speed > 0 ? 0.15 : s.duck ? 0.04 * (1 - a) : 0.05 * (1 - a)) + (s.zoomed ? 0 : 0.025),
  },

  // ---------------- machine gun ----------------
  m249: {
    id: 'm249', name: 'M249', slot: 1, type: 'mg', cat: 'mg', price: 5750, auto: true,
    dmg: 32, rangeMod: 0.97, armorRatio: 1.5, penPower: 35, penCount: 2, cycle: 0.1, clip: 100, reserve: 200,
    reload: 4.7, speed: 220, deploy: 0.75, accStart: 0.2, acc: { pow: 3, div: 175, base: 0.4, max: 0.9, floor: true },
    spread: (a, s) => (s.air ? 0.045 + 0.5 * a : s.speed > 140 ? 0.045 + 0.095 * a : 0.03 * a),
    kick: kb([1.8, 0.65, 0.45, 0.125, 5, 3.5, 8], [1.1, 0.5, 0.3, 0.06, 4, 3, 8], [0.75, 0.325, 0.25, 0.025, 3.5, 2.5, 9], [0.8, 0.35, 0.3, 0.03, 3.75, 3, 9]),
  },

  // ---------------- grenades ----------------
  hegrenade: { id: 'hegrenade', name: 'HE Grenade', slot: 4, type: 'grenade', price: 300, max: 1, speed: 250, deploy: 0.75, armorRatio: 1.4 },
  flashbang: { id: 'flashbang', name: 'Flashbang', slot: 4, type: 'grenade', price: 200, max: 2, speed: 250, deploy: 0.75 },
  smokegrenade: { id: 'smokegrenade', name: 'Smoke Grenade', slot: 4, type: 'grenade', price: 300, max: 1, speed: 250, deploy: 0.75 },

  // ---------------- the bomb ----------------
  c4: { id: 'c4', name: 'C4', slot: 5, type: 'c4', speed: 250, deploy: 0.75, plantTime: 3 },
};

// Buy / gun menu order, like the 1.6 VGUI menu
export const CATEGORIES = {
  pistol: ['glock18', 'usp', 'p228', 'deagle', 'elite', 'fiveseven'],
  shotgun: ['m3', 'xm1014'],
  smg: ['mac10', 'tmp', 'mp5navy', 'ump45', 'p90'],
  rifle: ['galil', 'famas', 'ak47', 'scout', 'sg552', 'awp', 'g3sg1', 'm4a1', 'aug', 'sg550'],
  mg: ['m249'],
};
export const PRIMARIES = [...CATEGORIES.shotgun, ...CATEGORIES.smg, ...CATEGORIES.rifle, ...CATEGORIES.mg];
export const SECONDARIES = CATEGORIES.pistol;
export const GRENADES = ['hegrenade', 'flashbang', 'smokegrenade'];
export const ALL_GUNS = [...SECONDARIES, ...PRIMARIES];

// Bots mostly pick what players pick: [weapon, weight]
export const BOT_PRIMARY = [
  ['ak47', 24], ['m4a1', 24], ['awp', 10], ['famas', 5], ['galil', 5], ['mp5navy', 5], ['p90', 4], ['scout', 4],
  ['sg552', 3], ['aug', 3], ['ump45', 3], ['m3', 3], ['xm1014', 2], ['mac10', 2], ['tmp', 2], ['m249', 2], ['g3sg1', 1], ['sg550', 1],
];
export const BOT_PISTOL = [['deagle', 35], ['usp', 20], ['glock18', 20], ['p228', 10], ['fiveseven', 8], ['elite', 7]];
export function weighted(list, team) {
  const ok = list.filter(([id]) => canUse(id, team));
  let r = Math.random() * ok.reduce((s, [, w]) => s + w, 0);
  for (const [id, w] of ok) if ((r -= w) <= 0) return id;
  return ok[0][0];
}

// The other team's version of a team-only gun
export const COUNTERPART = {
  elite: 'fiveseven', fiveseven: 'elite', mac10: 'tmp', tmp: 'mac10', galil: 'famas', famas: 'galil',
  ak47: 'm4a1', m4a1: 'ak47', sg552: 'aug', aug: 'sg552', g3sg1: 'sg550', sg550: 'g3sg1',
};

// team: 'T' | 'CT' | null (FFA: no restrictions)
export const canUse = (id, team) => !team || !WEAPONS[id].team || WEAPONS[id].team === team;
export const forTeam = (id, team) => (canUse(id, team) ? id : COUNTERPART[id] || id);

// Current field of view (CS fov, 4:3 horizontal) for a weapon's zoom level
export const zoomFov = (w) => (w && w.zoom && w.def.zoom ? w.def.zoom[w.zoom] : 90);

export function makeWeapon(id) {
  const d = WEAPONS[id];
  return {
    id, def: d,
    clip: d.clip ?? 0,
    reserve: d.reserve ?? 0,
    nextAttack: 0,
    nextAttack2: 0,
    reloading: false,
    reloadEnd: 0,
    shellStage: 0,      // shotguns: 1 = starting, 2 = loading shells
    shotsFired: 0,
    accuracy: d.accStart ?? 0.2,
    lastFire: 0,
    delayFire: false,
    decreaseShotsFired: 0,
    kickDir: 0,
    silenced: false,
    burst: false,
    burstLeft: 0,
    burstNext: 0,
    zoom: 0,
    resumeZoom: 0,
    left: false,        // dual elites: which gun fires next
    pin: false,         // grenades: pin pulled, waiting to throw
    throwAt: 0,
    redeployAt: 0,
    arming: false,      // C4: being planted
    armStart: 0,
  };
}

export function computeSpread(p, w, speed) {
  const d = w.def;
  if (!d.spread) return 0;
  return d.spread(w.accuracy, { air: !p.onGround, speed, duck: p.ducked, zoomed: w.zoom > 0, silenced: w.silenced, burst: w.burst });
}

// CS 1.6 CBasePlayerWeapon::KickBack. punchPitch > 0 means the view kicks up.
function kickBack(p, w, [upBase, latBase, upMod, latMod, upMax, latMax, dirChange]) {
  let front, side;
  if (w.shotsFired === 1) {
    front = upBase;
    side = latBase;
  } else {
    front = w.shotsFired * upMod + upBase;
    side = w.shotsFired * latMod + latBase;
  }
  p.punchPitch += front;
  if (p.punchPitch > upMax) p.punchPitch = upMax;
  if (w.kickDir === 1) {
    p.punchYaw += side;
    if (p.punchYaw > latMax) p.punchYaw = latMax;
  } else {
    p.punchYaw -= side;
    if (p.punchYaw < -latMax) p.punchYaw = -latMax;
  }
  if (Math.floor(Math.random() * (dirChange + 1)) === 0) w.kickDir = 1 - w.kickDir;
}

const randRange = (a, b) => a + Math.random() * (b - a);

function recoil(p, w, speed) {
  const d = w.def;
  if (d.kick) {
    const k = d.kick;
    kickBack(p, w, !p.onGround ? k.air : speed > 0 ? k.move : p.ducked ? k.duck : k.stand);
  } else if (d.randPunch) {
    // G3SG1 / SG550: a random kick that grows with the current punch
    p.punchPitch += randRange(d.randPunch[0], d.randPunch[1]) + p.punchPitch * 0.25;
    p.punchYaw += randRange(-0.75, 0.75);
  } else if (d.punchGround) {
    const [a, b] = p.onGround ? d.punchGround : d.punchAir;
    p.punchPitch += a + Math.floor(Math.random() * (b - a + 1));
  } else {
    p.punchPitch += d.punch || 0;
  }
}

function fireGun(game, p, w) {
  const d = w.def, now = game.time;
  const speed = Math.hypot(p.vel.x, p.vel.z);
  const quiet = w.silenced || !!d.quiet;
  w.clip--;
  if (d.type === 'shotgun') {
    for (let i = 0; i < d.pellets; i++) game.fireBullets(p, d.cone, d.dmg, 0, d, true);
  } else {
    const spread = computeSpread(p, w, speed);
    if (d.acc) {
      w.delayFire = true;
      w.shotsFired++;
      const s = w.shotsFired, a = d.acc;
      const v = Math.pow(s, a.pow) / a.div;
      w.accuracy = Math.min(a.max, (a.floor ? Math.floor(v) : v) + a.base);
    } else if (d.type === 'pistol') {
      if (w.lastFire) {
        w.accuracy -= (d.accK - (now - w.lastFire)) * d.accM;
        w.accuracy = Math.max(d.accMin, Math.min(d.accMax, w.accuracy));
      }
      w.lastFire = now;
    } else if (d.snAcc) {
      if (w.lastFire) w.accuracy = Math.min(0.98, d.snAcc.base + d.snAcc.k * (now - w.lastFire));
      w.lastFire = now;
    }
    const dmg = w.silenced && d.silDmg ? d.silDmg : d.dmg;
    const rangeMod = w.silenced && d.silRangeMod ? d.silRangeMod : d.rangeMod;
    game.fireBullets(p, spread, dmg, rangeMod, d, false);
  }
  if (d.id === 'elite') w.left = !w.left;
  game.weaponSound(p, w.silenced ? w.id + '_sil' : w.id, quiet);
  game.weaponEvent(p, 'fire', quiet);
  recoil(p, w, speed);
  w.nextAttack = now + (w.burst ? d.burstCycle : w.zoom && d.cycleZoom ? d.cycleZoom : d.cycle);
  if (d.boltAction) {
    if (w.zoom) {
      w.resumeZoom = w.zoom;
      w.zoom = 0;
    }
    game.later(0.45, () => game.sound('boltpull', p, 0.8));
  }
  if (d.pump) game.later(0.42, () => game.sound('pump', p, 0.75));
  if (w.burst) {
    w.burstLeft = d.burstShots - 1;
    w.burstNext = now + d.burstGap;
  }
}

function knifeAttack(game, p, w, stab) {
  const now = game.time;
  const hit = game.meleeTrace(p, stab ? 32 : 48);
  if (hit && hit.player) {
    let dmg = stab ? 65 : 15;
    if (stab && game.isBehind(p, hit.player)) dmg *= 3;
    game.damagePlayer(hit.player, p, dmg, w.def, hit.group, hit.dir, hit.point, true);
    game.sound('stab', p);
    w.nextAttack = now + (stab ? 1.1 : 0.4);
  } else if (hit && hit.world) {
    if (hit.box.breakable) game.damageBreakable(hit.box, stab ? 65 : 15, hit.normal);
    game.sound('knife_wall', p, 0.6);
    if (!hit.box.off) game.effects.impact(hit.point, hit.normal, hit.mat);
    w.nextAttack = now + (stab ? 1.1 : 0.4);
  } else {
    game.sound('slash', p, 0.7);
    w.nextAttack = now + (stab ? 1.0 : 0.35);
  }
  w.nextAttack2 = w.nextAttack + (stab ? 0 : 0.1);
  game.weaponEvent(p, stab ? 'stab' : 'slash');
}

export function startReload(game, p, w) {
  const d = w.def;
  if (w.reloading || !d.clip || w.clip >= d.clip || w.reserve <= 0) return;
  const now = game.time;
  w.reloading = true;
  w.zoom = 0;
  w.resumeZoom = 0;
  w.burstLeft = 0;
  if (d.type === 'shotgun') {
    // shells go in one at a time; firing interrupts
    w.shellStage = 1;
    w.reloadEnd = now + d.reloadStart;
    w.nextAttack = now + d.reloadStart;
    game.weaponEvent(p, 'sg_start', d.reloadStart);
    return;
  }
  w.reloadEnd = now + d.reload;
  w.nextAttack = w.nextAttack2 = w.reloadEnd;
  w.shotsFired = 0;
  w.accuracy = d.accStart ?? 0.2;
  game.weaponEvent(p, 'reload', d.reload);
  game.sound('clipout', p, 0.7, d.reload * 0.18);
  game.sound('clipin', p, 0.7, d.reload * 0.62);
  if (d.type !== 'pistol') game.sound('boltpull', p, 0.6, d.reload * 0.82);
}

function shotgunReloadTick(game, p, w) {
  const d = w.def, now = game.time;
  if (now < w.reloadEnd) return;
  if (w.shellStage === 2) {
    w.clip++;
    w.reserve--;
  }
  if (w.clip < d.clip && w.reserve > 0) {
    w.shellStage = 2;
    w.reloadEnd = now + d.reloadShell;
    w.nextAttack = now + Math.min(d.reloadShell, 0.3);
    game.weaponEvent(p, 'sg_insert', d.reloadShell);
    game.sound('shell_insert', p, 0.7, d.reloadShell * 0.45);
  } else {
    endShotgunReload(game, p, w);
  }
}

function endShotgunReload(game, p, w, interrupted = false) {
  w.reloading = false;
  w.shellStage = 0;
  if (interrupted) {
    game.weaponEvent(p, 'sg_end', 0.15);
    return;
  }
  game.weaponEvent(p, 'sg_end', w.def.pump ? 0.6 : 0.3);
  if (w.def.pump) game.sound('pump', p, 0.75, 0.1);
  w.nextAttack = Math.max(w.nextAttack, game.time + (w.def.pump ? 0.5 : 0.2));
}

function secondary(game, p, w) {
  const now = game.time, d = w.def;
  if (d.silencerTime) {
    if (w.reloading) return;
    w.silenced = !w.silenced;
    w.nextAttack = w.nextAttack2 = now + d.silencerTime;
    game.weaponEvent(p, 'silencer', d.silencerTime);
    game.sound('silencer', p, 0.6, 0.3);
  } else if (d.burstShots) {
    w.burst = !w.burst;
    game.weaponMessage(p, w.burst ? 'burstMode' : d.burstMsg);
    w.nextAttack2 = now + 0.3;
  } else if (d.zoom) {
    if (w.reloading) return;
    w.zoom = (w.zoom + 1) % d.zoom.length;
    w.resumeZoom = 0;
    w.nextAttack2 = now + 0.3;
    game.sound('zoom', p, 0.6);
  } else if (d.type === 'knife') {
    if (now >= w.nextAttack) knifeAttack(game, p, w, true);
  }
}

// ---------------- grenades ----------------

// 1.6 throw: the view is biased 10 degrees up, faster when aiming higher
function throwGrenade(game, p, w) {
  const now = game.time;
  let x = -p.aimPitch() * 180 / Math.PI; // GoldSrc pitch: + is down
  x = x < 0 ? -10 + x * (80 / 90) : -10 + x * (100 / 90);
  const vel = Math.min(750, (90 - x) * 6);
  game.throwGrenade(p, w.id, p.aimYaw(), -x * Math.PI / 180, vel);
  p.nades[w.id] = Math.max(0, (p.nades[w.id] || 0) - 1);
  w.clip = p.nades[w.id];
  w.pin = false;
  w.nextAttack = now + 0.5;
  w.redeployAt = now + 0.75;
  game.weaponEvent(p, 'throw');
  game.sound('throw', p, 0.6);
}

// after a throw: take out another grenade, or go back to a gun
function afterThrow(game, p, w) {
  if (p.nades[w.id] > 0) {
    deploy(game, p);
    return;
  }
  const next = GRENADES.find((id) => p.nades[id] > 0);
  if (next) {
    p.weapons[4] = makeWeapon(next);
    p.weapons[4].clip = p.nades[next];
    deploy(game, p);
    return;
  }
  p.weapons[4] = null;
  const slot = p.weapons[1] ? 1 : p.weapons[2] ? 2 : 3;
  p.slot = slot;
  p.lastSlot = slot === 1 && p.weapons[2] ? 2 : 3;
  deploy(game, p);
}

function grenadeTick(game, p, w, cmd) {
  const now = game.time;
  p.maxspeed = w.def.speed;
  if (w.redeployAt) {
    if (now >= w.redeployAt) {
      w.redeployAt = 0;
      afterThrow(game, p, w);
    }
    return;
  }
  if (w.pin) {
    if (!cmd.attack && now >= w.throwAt) throwGrenade(game, p, w);
    return;
  }
  if (cmd.attack && now >= w.nextAttack && now >= p.nextAttackTime && (p.nades[w.id] || 0) > 0) {
    w.pin = true;
    w.throwAt = now + 0.5;
    game.weaponEvent(p, 'pullpin');
    game.sound('pinpull', p, 0.6, 0.1);
  }
}

export function giveGrenades(p, counts) {
  p.nades = { ...counts };
  const first = GRENADES.find((id) => p.nades[id] > 0);
  p.weapons[4] = null;
  if (first) {
    p.weapons[4] = makeWeapon(first);
    p.weapons[4].clip = p.nades[first];
  }
}

// Pressing the grenade key again cycles through the grenade types (1.6 slot 4).
export function cycleGrenade(game, p) {
  const cur = p.weapons[4];
  if (!cur || p.slot !== 4 || cur.pin || cur.redeployAt) return false;
  const i = GRENADES.indexOf(cur.id);
  for (let k = 1; k < GRENADES.length; k++) {
    const id = GRENADES[(i + k) % GRENADES.length];
    if (p.nades[id] > 0) {
      p.weapons[4] = makeWeapon(id);
      p.weapons[4].clip = p.nades[id];
      deploy(game, p);
      return true;
    }
  }
  return false;
}

export function weaponTick(game, p, cmd) {
  const w = p.weapon;
  if (!w) return;
  const d = w.def, now = game.time;

  if (d.type === 'grenade') {
    if (now >= p.nextAttackTime) grenadeTick(game, p, w, cmd);
    p.oldAttack = cmd.attack;
    p.oldAttack2 = cmd.attack2;
    return;
  }

  // the bomb: hold fire at a bomb site to plant it (bomb.js does the rest)
  if (d.type === 'c4') {
    p.maxspeed = w.arming ? 1 : d.speed;
    if (now >= p.nextAttackTime && game.bm) game.bm.c4Tick(p, w, cmd);
    p.oldAttack = cmd.attack;
    p.oldAttack2 = cmd.attack2;
    return;
  }

  if (w.reloading) {
    if (d.type === 'shotgun') {
      // a shot interrupts loading shells
      if (cmd.attack && w.clip > 0 && w.shellStage === 2 && now >= w.nextAttack) endShotgunReload(game, p, w, true);
      else shotgunReloadTick(game, p, w);
    } else if (now >= w.reloadEnd) {
      const take = Math.min(d.clip - w.clip, w.reserve);
      w.clip += take;
      w.reserve -= take;
      w.reloading = false;
    }
  }

  // the rest of a burst (Glock 18, FAMAS)
  if (w.burstLeft > 0 && now >= w.burstNext) {
    if (w.clip > 0) {
      w.clip--;
      game.fireBullets(p, 0.05, d.dmg, d.rangeMod, d, false);
      game.weaponSound(p, w.id, false);
      game.weaponEvent(p, 'fire');
      p.punchPitch += d.type === 'pistol' ? d.punch * 0.5 : 0.5;
      w.burstLeft--;
      w.burstNext = now + d.burstGap;
    } else {
      w.burstLeft = 0;
    }
  }

  if (w.resumeZoom && now >= w.nextAttack) {
    w.zoom = w.resumeZoom;
    w.resumeZoom = 0;
  }

  p.maxspeed = d.zoomSpeed && w.zoom ? d.zoomSpeed : d.speed;

  if (now >= p.nextAttackTime) {
    if (cmd.reload) startReload(game, p, w);
    if (cmd.attack2 && !p.oldAttack2 && now >= w.nextAttack2) secondary(game, p, w);
    if (cmd.attack) {
      if (now >= w.nextAttack && w.burstLeft === 0) {
        if (d.type === 'knife') knifeAttack(game, p, w, false);
        else if (!w.reloading) {
          if (w.clip <= 0) {
            if (!p.oldAttack) game.sound('dryfire', p, 0.8);
            w.nextAttack = now + 0.2;
          } else if (d.auto || !p.oldAttack) {
            fireGun(game, p, w);
          }
        }
      }
    } else {
      if (w.delayFire) {
        w.delayFire = false;
        if (w.shotsFired > 15) w.shotsFired = 15;
        w.decreaseShotsFired = now + 0.4;
      }
      if (w.shotsFired > 0 && now > w.decreaseShotsFired) {
        w.shotsFired--;
        w.decreaseShotsFired = now + 0.0225;
      }
      if (w.clip === 0 && w.reserve > 0 && !w.reloading && d.type !== 'knife' && now >= w.nextAttack) startReload(game, p, w);
    }
  }
  p.oldAttack = cmd.attack;
  p.oldAttack2 = cmd.attack2;
}

// A new round with no ammo to buy: the guns a survivor kept fill up again.
export function refillAmmo(p) {
  for (const s of [1, 2]) {
    const w = p.weapons[s];
    if (!w) continue;
    w.clip = w.def.clip;
    w.reserve = w.def.reserve;
    w.reloading = false;
    w.zoom = 0;
    w.resumeZoom = 0;
    w.burstLeft = 0;
  }
  if (p.weapons[4] && !p.nades[p.weapons[4].id]) p.weapons[4] = null;
  p.weapons[5] = null;
}

export function giveWeapon(p, id) {
  const w = makeWeapon(id);
  p.weapons[w.def.slot] = w;
  return w;
}

// put away the current weapon: cancel anything in progress
function holster(w) {
  w.reloading = false;
  w.shellStage = 0;
  w.zoom = 0;
  w.resumeZoom = 0;
  w.burstLeft = 0;
  w.pin = false;
  w.redeployAt = 0;
  w.arming = false;
}

export function selectSlot(game, p, slot) {
  if (!p.weapons[slot] || p.slot === slot) return false;
  const cur = p.weapon;
  if (cur) {
    // a grenade being thrown can't be put away
    if (cur.def.type === 'grenade' && cur.redeployAt) return false;
    holster(cur);
  }
  p.lastSlot = p.slot;
  p.slot = slot;
  deploy(game, p);
  return true;
}

export function deploy(game, p) {
  const w = p.weapon;
  if (!w) return;
  w.shotsFired = 0;
  w.delayFire = false;
  w.accuracy = w.def.accStart ?? 0.2;
  w.zoom = 0;
  w.resumeZoom = 0;
  w.pin = false;
  p.nextAttackTime = game.time + w.def.deploy;
  game.weaponEvent(p, 'deploy', w.def.deploy);
  if (w.def.type === 'knife') game.sound('slash', p, 0.25);
  else if (w.def.type === 'grenade') game.sound('deploy', p, 0.3);
  else game.sound('deploy', p, 0.5);
}

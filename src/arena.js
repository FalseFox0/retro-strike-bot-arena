// Bot Arena: characters (bots with their own skills, habits and guns), the
// saves that keep them together with their stats and ratings, skills that
// grow by use ("practice"), evolution, and the list of matches a battle plays.
// The menus use it and so do the background matches (workers): nothing in
// here touches the page.

import { WEAPONS, PRIMARIES, SECONDARIES } from './weapons.js';
import { HACKS, hackCfg } from './hacks.js';

// skills: how good they are (0-100; 50 is a Normal bot, 90 about Expert).
// In a practice save these grow with use and never quite reach 100.
export const SKILLS = ['reaction', 'aim', 'headshots', 'recoil', 'grenades'];
// habits: how they like to play (0-100), free choices like the style and guns
export const HABITS = ['strafe', 'bhop', 'crouch', 'nadeUse', 'teamwork'];
export const STYLES = ['rusher', 'careful', 'camper', 'lurker'];
// how they talk in the news (their quotes and trash talk)
export const PERSONALITIES = ['cocky', 'polite', 'smug', 'mysterious', 'hothead', 'joker', 'stoic', 'nervous'];
// the fight types a battle can play, and the game mode each one runs as
export const FIGHTS = ['duel', 'tdm', 'classic', 'ffa', 'bomb'];
export const FIGHT_MODE = { duel: 'tdm', tdm: 'tdm', classic: 'classic', ffa: 'ffa', bomb: 'bomb' };
export const ROUND_FIGHTS = new Set(['classic', 'bomb']);
// favorite guns: any primary (or none: a pistol player) and any pistol
export const GUN_CHOICES = ['none', ...PRIMARIES];
export const PISTOL_CHOICES = [...SECONDARIES];
export const MAX_SIDE = 10; // every map has 10 spawns a side
export const MAX_FFA = 20;
export const BASE_SKILL = 50; // a practice save's "same start for all"
export const BASE_RATING = 1000;

export const COLORS = [
  '#f2b134', '#33c3ff', '#c8a27a', '#8fa0b3', '#ff5533', '#b48cff', '#2ed47a', '#1f6fff', '#e6e6e6', '#ff8a1f',
  '#ff4fb4', '#6fe3d8', '#5b6474', '#a3d13b', '#c0392b', '#ffe14d', '#9b30ff', '#5aa0e6', '#40e0a0', '#b0703a',
];

// ---------------------------------------------------------------- skills -> bot
// Skill levels at which a bot plays like today's Easy, Normal, Hard and
// Expert bots (15, 50, 72, 90), with the ends past them.
const AT = [0, 15, 50, 72, 90, 100];
const CURVE = {
  reaction: [0.95, 0.7, 0.45, 0.28, 0.17, 0.12],  // seconds before the first shot
  fov: [95, 100, 115, 125, 135, 140],             // degrees they notice enemies in
  aimRate: [3, 4.5, 7.5, 11, 17, 22],
  maxTurn: [3, 4, 7, 11, 16, 20],
  aimError: [0.13, 0.1, 0.06, 0.035, 0.02, 0.012],
  settle: [1, 1.3, 2, 3.2, 4.5, 6],
  click: [0.5, 0.42, 0.3, 0.22, 0.17, 0.14],      // pistol taps
  head: [0.05, 0.1, 0.25, 0.45, 0.65, 0.8],       // how often they go for the head
  recoilComp: [0, 0, 0.35, 0.7, 0.9, 0.97],
  burst: [3, 3, 4, 5, 6, 7],
  flashDodge: [0.1, 0.15, 0.4, 0.6, 0.75, 0.85],
  nadeErr: [0.05, 0.035, 0.02, 0.01, 0.005, 0.0025], // radians off when throwing
};

function curve(key, s) {
  const ys = CURVE[key];
  s = Math.max(0, Math.min(100, s));
  for (let i = 1; i < AT.length; i++) {
    if (s <= AT[i]) {
      const k = (s - AT[i - 1]) / (AT[i] - AT[i - 1]);
      return ys[i - 1] + (ys[i] - ys[i - 1]) * k;
    }
  }
  return ys[ys.length - 1];
}

// what bot.js plays with (the same fields as its difficulty table, and more)
export function profile(ch) {
  const s = ch.skills, h = ch.habits;
  return {
    reaction: curve('reaction', s.reaction),
    fov: curve('fov', s.reaction),
    aimRate: curve('aimRate', s.aim),
    maxTurn: curve('maxTurn', s.aim),
    aimError: curve('aimError', s.aim),
    settle: curve('settle', s.aim),
    click: curve('click', s.aim),
    // stopping dead before a shot takes some skill
    counterStrafe: s.aim >= 40,
    head: curve('head', s.headshots),
    recoilComp: curve('recoilComp', s.recoil),
    burst: Math.round(curve('burst', s.recoil)),
    flashDodge: curve('flashDodge', s.grenades),
    nadeErr: curve('nadeErr', s.grenades),
    strafe: h.strafe / 100,
    crouch: (h.crouch / 100) * 0.6,
    bhop: h.bhop / 100,
    nadeUse: h.nadeUse / 100,
    teamwork: h.teamwork / 100,
    style: ch.style,
  };
}

// ---------------------------------------------------------------- characters
const clamp = (v, lo, hi, def) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);
const pick = (v, list, def) => (list.includes(v) ? v : def);
const hexColor = (v, def) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : def);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
// an array of objects that pass the test (anything else: an empty one)
const goodList = (v, ok) => (Array.isArray(v) ? v.filter((x) => obj(x) && ok(x)) : []);

export function newId() {
  return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
}

// a clean, complete copy of a character (old saves, the editor, imports)
export function cleanChar(c, i = 0) {
  c = c && typeof c === 'object' ? c : {};
  const skills = {}, habits = {}, start = {}, peak = {}, hacks = {};
  for (const k of SKILLS) {
    skills[k] = clamp(c.skills?.[k], 0, 100, BASE_SKILL);
    start[k] = clamp(c.start?.[k], 0, 100, skills[k]);
    peak[k] = clamp(c.peak?.[k], 0, 100, skills[k]);
  }
  for (const k of HABITS) habits[k] = clamp(c.habits?.[k], 0, 100, 50);
  for (const k of HACKS) hacks[k] = !!c.hacks?.[k];
  return {
    id: typeof c.id === 'string' && c.id ? c.id : newId(),
    name: (typeof c.name === 'string' && c.name.trim() ? c.name.trim() : 'Bot ' + (i + 1)).slice(0, 20),
    color: hexColor(c.color, COLORS[i % COLORS.length]),
    style: pick(c.style, STYLES, 'careful'),
    pers: pick(c.pers, PERSONALITIES, persFor(c.style)),
    skills, start, peak, habits,
    gun: pick(c.gun, GUN_CHOICES, 'ak47'),
    pistol: pick(c.pistol, PISTOL_CHOICES, 'usp'),
    hacks,
    hackCfg: hackCfg(c.hackCfg),
    gen: clamp(c.gen, 0, 9999, 0),
    parents: Array.isArray(c.parents) ? c.parents.filter((x) => typeof x === 'string').slice(0, 2) : [],
    retired: !!c.retired,
    born: clamp(c.born, 0, 1e9, 0),
    retiredAt: clamp(c.retiredAt, 0, 1e9, 0),
    tune: c.tune && typeof c.tune === 'object' ? c.tune : null,
  };
}

export const hacksOn = (c) => HACKS.filter((k) => c.hacks[k]);

// a personality that fits a play style (most rushers are cocky, a few aren't)
const STYLE_PERS = {
  rusher: ['cocky', 'cocky', 'cocky', 'hothead', 'joker', 'polite'],
  careful: ['polite', 'stoic', 'nervous', 'polite', 'joker'],
  camper: ['smug', 'smug', 'stoic', 'joker'],
  lurker: ['mysterious', 'mysterious', 'smug', 'hothead'],
};
export function persFor(style) {
  const list = STYLE_PERS[style] || PERSONALITIES;
  return list[(Math.random() * list.length) | 0];
}
export const isPistolOnly = (c) => c.gun === 'none';

// The ready roster: 20 original characters with their own ways to play.
// [name, style, [reaction, aim, headshots, recoil, grenades], [strafe, bhop, crouch, nadeUse, teamwork], gun, pistol, personality]
const ROSTER = [
  ['Kestrel', 'careful', [74, 78, 60, 45, 40], [30, 5, 45, 30, 55], 'awp', 'usp', 'stoic'],
  ['Bolt', 'rusher', [80, 55, 35, 62, 30], [90, 85, 5, 35, 25], 'p90', 'fiveseven', 'cocky'],
  ['Nomad', 'lurker', [62, 64, 52, 58, 45], [55, 20, 25, 45, 15], 'ak47', 'deagle', 'mysterious'],
  ['Rook', 'camper', [55, 68, 48, 60, 35], [20, 0, 60, 40, 60], 'm4a1', 'usp', 'smug'],
  ['Havoc', 'rusher', [70, 45, 30, 40, 25], [80, 70, 10, 50, 35], 'xm1014', 'glock18', 'hothead'],
  ['Quill', 'camper', [50, 82, 70, 30, 30], [15, 0, 30, 20, 45], 'awp', 'deagle', 'smug'],
  ['Talon', 'lurker', [68, 72, 62, 35, 50], [45, 30, 35, 40, 20], 'scout', 'usp', 'mysterious'],
  ['Mako', 'rusher', [76, 70, 72, 55, 35], [75, 60, 20, 40, 40], 'ak47', 'deagle', 'cocky'],
  ['Grit', 'careful', [58, 74, 66, 20, 25], [50, 10, 40, 25, 50], 'none', 'deagle', 'nervous'],
  ['Ember', 'careful', [52, 58, 40, 66, 60], [45, 10, 35, 70, 75], 'galil', 'glock18', 'polite'],
  ['Jinx', 'rusher', [72, 50, 38, 48, 40], [95, 90, 5, 55, 20], 'mac10', 'elite', 'joker'],
  ['Halcyon', 'careful', [60, 66, 50, 72, 55], [40, 15, 50, 55, 80], 'sg552', 'p228', 'polite'],
  ['Onyx', 'camper', [45, 55, 30, 78, 30], [10, 0, 70, 30, 55], 'm249', 'glock18', 'stoic'],
  ['Pike', 'lurker', [64, 56, 45, 52, 40], [60, 40, 25, 45, 25], 'mp5navy', 'usp', 'hothead'],
  ['Sable', 'careful', [57, 63, 50, 57, 85], [40, 10, 40, 95, 85], 'ak47', 'usp', 'stoic'],
  ['Tempo', 'rusher', [74, 62, 48, 60, 30], [70, 95, 10, 30, 40], 'm4a1', 'deagle', 'polite'],
  ['Vex', 'lurker', [70, 68, 58, 40, 45], [50, 25, 30, 50, 10], 'ump45', 'deagle', 'mysterious'],
  ['Wren', 'careful', [50, 52, 42, 55, 80], [35, 5, 40, 85, 95], 'famas', 'usp', 'nervous'],
  ['Zephyr', 'rusher', [66, 60, 44, 50, 35], [85, 75, 15, 40, 30], 'galil', 'glock18', 'cocky'],
  ['Flint', 'camper', [60, 60, 55, 65, 40], [25, 0, 65, 35, 60], 'aug', 'usp', 'joker'],
];

export function rosterChars() {
  return ROSTER.map(([name, style, sk, hb, gun, pistol, pers], i) => cleanChar({
    name, style, gun, pistol, pers, color: COLORS[i],
    skills: Object.fromEntries(SKILLS.map((k, j) => [k, sk[j]])),
    habits: Object.fromEntries(HABITS.map((k, j) => [k, hb[j]])),
  }, i));
}

// The ready clans of a new save: 4 clans of 5, as even as a draft makes
// them (the best pick first, then back the other way). `names`: 4 clan names.
const CLAN_COLORS = ['#e8a33a', '#3aa0e8', '#d94a4a', '#5cc46a'];
export function readyClans(chars, names) {
  const live = chars.filter((c) => !c.retired);
  const power = (c) => SKILLS.reduce((s, k) => s + c.skills[k], 0);
  const order = [...live].sort((a, b) => power(b) - power(a));
  const n = Math.min(4, Math.floor(live.length / 2));
  if (n < 2) return [];
  const clans = names.slice(0, n).map((name, i) => ({ id: newId(), name, color: CLAN_COLORS[i], members: [] }));
  const size = Math.floor(order.length / n);
  order.slice(0, size * n).forEach((c, i) => {
    const lap = Math.floor(i / n), j = i % n;
    clans[lap % 2 ? n - 1 - j : j].members.push(c.id);
  });
  return clans;
}

// names for characters born in "new generations" saves
const CHILD_NAMES = [
  'Blaze', 'Comet', 'Drift', 'Glitch', 'Haze', 'Ion', 'Jolt', 'Karma', 'Lynx', 'Mantis', 'Orbit', 'Pulse', 'Quake', 'Raptor',
  'Spark', 'Thorn', 'Umbra', 'Vortex', 'Warden', 'Zinc', 'Brick', 'Crux', 'Dusk', 'Gale', 'Hex', 'Ivy', 'Kilo', 'Lumen', 'Moth',
  'Nyx', 'Opal', 'Prism', 'Rune', 'Shard', 'Tusk', 'Volt', 'Wisp', 'Yeti', 'Zest', 'Cobalt', 'Dune', 'Ferro', 'Gust', 'Hawk',
  'Iris', 'Jade', 'Kite', 'Lark', 'Maple', 'Nimbus', 'Oak', 'Pebble', 'Quartz', 'Reed', 'Slate', 'Tide', 'Ursa', 'Vale', 'Yarrow', 'Zircon',
];
const ROMAN = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const MAX_RETIRED = 100; // retired characters a save keeps (the oldest go)

function freshName(save) {
  const used = new Set(save.chars.map((c) => c.name.toLowerCase()));
  const free = CHILD_NAMES.filter((n) => !used.has(n.toLowerCase()));
  if (free.length) return free[(Math.random() * free.length) | 0];
  for (const r of ROMAN) {
    const n = CHILD_NAMES[(Math.random() * CHILD_NAMES.length) | 0] + ' ' + r;
    if (!used.has(n.toLowerCase())) return n;
  }
  return 'Bot ' + newId().slice(0, 4);
}

// ---------------------------------------------------------------- saves
export const SAVE_DEFAULTS = {
  skillMode: 'free',   // 'free' (sliders) | 'practice' (skills grow by use)
  start: 'editor',     // practice: 'same' (everyone at 50) | 'editor' (where the sliders are)
  learn: 1,            // practice: learning speed, 0.25-4
  evolve: 'off',       // 'off' | 'tune' (each tunes itself) | 'gen' (new generations)
  tuneEvery: 20,       // matches per tuning try (per character)
  genEvery: 100,       // matches between generations
};

export function cleanSettings(s) {
  s = s && typeof s === 'object' ? s : {};
  return {
    skillMode: pick(s.skillMode, ['free', 'practice'], SAVE_DEFAULTS.skillMode),
    start: pick(s.start, ['same', 'editor'], SAVE_DEFAULTS.start),
    learn: clamp(s.learn, 0.25, 4, SAVE_DEFAULTS.learn),
    evolve: pick(s.evolve, ['off', 'tune', 'gen'], SAVE_DEFAULTS.evolve),
    tuneEvery: Math.round(clamp(s.tuneEvery, 5, 200, SAVE_DEFAULTS.tuneEvery)),
    genEvery: Math.round(clamp(s.genEvery, 20, 1000, SAVE_DEFAULTS.genEvery)),
  };
}

export const DEFAULT_SETUP = {
  chars: null, // null: everyone
  maps: ['aim_classic', 'de_dunetown', 'de_foundry', 'fy_poolhouse', 'awp_rooftops'],
  fights: {
    duel: { on: true, kills: 10 },
    tdm: { on: true, size: 5, kills: 50 },
    classic: { on: false, size: 5, rounds: 8 },
    ffa: { on: true, size: 10, kills: 30 },
    bomb: { on: false, size: 5, rounds: 8 },
  },
  teams: 'random', // 'random' | 'clans'
  count: 1000,
};

export function cleanSetup(s, save) {
  s = s && typeof s === 'object' ? s : {};
  const d = DEFAULT_SETUP;
  const ids = new Set(save.chars.filter((c) => !c.retired).map((c) => c.id));
  const fights = {};
  for (const f of FIGHTS) {
    const src = s.fights?.[f] || {}, def = d.fights[f];
    const o = { on: typeof src.on === 'boolean' ? src.on : def.on };
    if ('kills' in def) o.kills = Math.round(clamp(src.kills, 1, 500, def.kills));
    if ('rounds' in def) o.rounds = Math.round(clamp(src.rounds, 1, 30, def.rounds));
    if ('size' in def) o.size = Math.round(clamp(src.size, f === 'ffa' ? 3 : 1, f === 'ffa' ? MAX_FFA : MAX_SIDE, def.size));
    fights[f] = o;
  }
  return {
    chars: Array.isArray(s.chars) ? s.chars.filter((id) => ids.has(id)) : null,
    maps: Array.isArray(s.maps) ? s.maps.filter((m) => d.maps.includes(m)) : [...d.maps],
    fights,
    teams: pick(s.teams, ['random', 'clans'], d.teams),
    count: Math.round(clamp(s.count, 1, 100000, d.count)),
  };
}

export function newSave(name, settings, clanNames = null) {
  const save = {
    id: newId(),
    name: (name || 'Save').slice(0, 30),
    created: Date.now(),
    settings: cleanSettings(settings),
    chars: rosterChars(),
    clans: [],
    stats: {},
    h2h: {},
    matches: 0,
    sinceGen: 0,
    log: [],
    evoLog: [],
    setup: null,
    // everything a save holds from the start (cleanSave fills the same in for older ones)
    season: null, cup: null, seasonCfg: null, cupCfg: null, divs: null,
    seasonHist: [], cupHist: [], wallet: null, news: [], rivals: [], records: {}, clips: [],
    run: null,
  };
  applyStart(save);
  if (clanNames) save.clans = readyClans(save.chars, clanNames);
  return save;
}

// a practice save with "same start": every skill begins at 50
export function applyStart(save) {
  if (save.settings.skillMode !== 'practice') return;
  for (const c of save.chars) {
    if (save.settings.start === 'same') for (const k of SKILLS) c.skills[k] = BASE_SKILL;
    // nothing to remember yet: the best so far is where they start
    for (const k of SKILLS) c.start[k] = c.peak[k] = c.skills[k];
  }
}

export function cleanSave(s) {
  s = s && typeof s === 'object' ? s : {};
  const save = {
    id: typeof s.id === 'string' ? s.id : newId(),
    name: typeof s.name === 'string' ? s.name.slice(0, 30) : 'Save',
    created: clamp(s.created, 0, 1e15, Date.now()),
    settings: cleanSettings(s.settings),
    chars: Array.isArray(s.chars) ? s.chars.map((c, i) => cleanChar(c, i)) : rosterChars(),
    clans: Array.isArray(s.clans) ? s.clans.filter((c) => c && typeof c === 'object').map((c, i) => ({
      id: typeof c.id === 'string' ? c.id : newId(),
      name: typeof c.name === 'string' ? c.name.slice(0, 24) : 'Clan ' + (i + 1),
      color: hexColor(c.color, COLORS[(i * 3) % COLORS.length]),
      members: Array.isArray(c.members) ? c.members.filter((x) => typeof x === 'string') : [],
    })) : [],
    stats: s.stats && typeof s.stats === 'object' ? s.stats : {},
    h2h: s.h2h && typeof s.h2h === 'object' ? s.h2h : {},
    matches: clamp(s.matches, 0, 1e9, 0),
    // free-battle matches since the last generation ("new generations" saves)
    sinceGen: clamp(s.sinceGen, 0, 1e9, 0),
    log: Array.isArray(s.log) ? s.log.slice(-LOG_MAX) : [],
    evoLog: Array.isArray(s.evoLog) ? s.evoLog.slice(-LOG_MAX) : [],
    setup: s.setup || null,
    // seasons and cups (league.js), the wallet (bets.js), the news (news.js)
    season: obj(s.season),
    cup: obj(s.cup),
    seasonCfg: obj(s.seasonCfg),
    cupCfg: obj(s.cupCfg),
    divs: obj(s.divs),
    // (entries that aren't what they should be are left out: one bad line mustn't break a page)
    seasonHist: goodList(s.seasonHist, (x) => obj(x.names)).slice(-200),
    cupHist: goodList(s.cupHist, (x) => obj(x.names)).slice(-200),
    wallet: obj(s.wallet),
    news: goodList(s.news, (x) => typeof x.k === 'string' && obj(x.p)).slice(-300),
    rivals: Array.isArray(s.rivals) ? s.rivals.filter((r) => Array.isArray(r) && r.length >= 2) : [],
    records: obj(s.records) || {},
    clips: goodList(s.clips, (x) => typeof x.id === 'string' && typeof x.score === 'number'),
    // a battle that didn't finish (the page was closed): how far it got
    run: s.run && typeof s.run.total === 'number' ? { total: clamp(s.run.total, 1, 1e6, 1), done: clamp(s.run.done, 0, 1e6, 0) } : null,
  };
  // a clan only holds characters that still exist
  const ids = new Set(save.chars.map((c) => c.id));
  for (const cl of save.clans) cl.members = cl.members.filter((id) => ids.has(id));
  save.setup = cleanSetup(save.setup, save);
  return save;
}

const STORE_KEY = 'cs16remake.arena.v1';
const LOG_MAX = 300;

// everything Bot Arena keeps in the browser: { saves, current }
export function loadStore() {
  let data = null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) data = JSON.parse(raw);
  } catch (e) {
    data = null;
  }
  // (a line that isn't a save at all is skipped, not turned into an empty one)
  const saves = Array.isArray(data?.saves) ? data.saves.filter((x) => obj(x) && Array.isArray(x.chars)).map(cleanSave) : [];
  return { saves, current: saves.some((s) => s.id === data?.current) ? data.current : saves[0]?.id || null };
}

// false when the browser refuses (storage blocked or full)
export function saveStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------- stats
const emptyStats = () => ({
  r: BASE_RATING, m: 0, w: 0, l: 0, d: 0, k: 0, de: 0, hs: 0, sh: 0, hi: 0, dmg: 0, rp: 0, rw: 0,
  pl: 0, df: 0, nd: 0, hk: 0, tk: 0, su: 0, place: 0, ffa: 0, wk: {}, by: {}, hist: [],
  cs: 0,           // streak now: +wins in a row, -losses in a row
  bs: 0,           // best win streak
  peakR: BASE_RATING, // best rating ever
  best: 0,         // most kills in one match
  tro: {},         // trophies: champ, clan, cup, div, mvp, frag, star
});
// stats saved by an older version get the newer fields
const statFields = (st) => {
  st.cs ??= 0;
  st.bs ??= 0;
  st.peakR ??= st.r;
  st.best ??= 0;
  st.tro ??= {};
  return st;
};
export const statsOf = (save, id) => statFields(save.stats[id] ||= emptyStats());

// how one character did in one match: 1 a win, 0.5 a draw, 0 a loss (FFA: by place)
function outcome(spec, res, pr) {
  if (spec.type === 'ffa') {
    const n = res.order.length;
    const place = res.order.indexOf(pr.cid);
    return { s: n > 1 ? 1 - place / (n - 1) : 1, place: place + 1, win: place === 0 };
  }
  if (res.winner == null) return { s: 0.5, draw: true };
  return { s: res.winner === pr.side ? 1 : 0, win: res.winner === pr.side };
}

export const expect = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));

// a season or cup under way: nobody may retire until it's over (its
// schedule and brackets name them)
export const compOpen = (save) => !!((save.season && save.season.phase !== 'done') || (save.cup && save.cup.phase !== 'done'));
const ELO_K = 24;

// how well a character played a match, for tuning (result first, then trading kills)
function perf(o, pr) {
  const kd = pr.k + pr.de > 0 ? pr.k / (pr.k + pr.de) : 0.5;
  return o.s * 0.7 + kd * 0.3;
}

// Take in a finished match. Returns what changed for the battle screen and
// what the competitions and the news need (ratings before, results).
export function applyResult(save, spec, res) {
  save.matches++;
  const n = save.matches;
  const key = spec.map + '|' + spec.type;
  const byId = new Map(save.chars.map((c) => [c.id, c]));
  const plays = res.players.filter((pr) => byId.has(pr.cid));
  const outs = new Map(plays.map((pr) => [pr.cid, outcome(spec, res, pr)]));
  // ratings: two sides like chess (team average), free-for-all pair by pair
  const before = new Map(plays.map((pr) => [pr.cid, statsOf(save, pr.cid).r]));
  const delta = new Map();
  if (spec.type === 'ffa') {
    const k = ELO_K / Math.max(1, plays.length - 1);
    for (const a of plays) {
      let d = 0;
      for (const b of plays) {
        if (a === b) continue;
        const ia = res.order.indexOf(a.cid), ib = res.order.indexOf(b.cid);
        d += (ia < ib ? 1 : ia > ib ? 0 : 0.5) - expect(before.get(a.cid), before.get(b.cid));
      }
      delta.set(a.cid, d * k);
    }
  } else {
    const avg = (side) => {
      const xs = plays.filter((p) => p.side === side).map((p) => before.get(p.cid));
      return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : BASE_RATING;
    };
    const r0 = avg(0), r1 = avg(1);
    for (const pr of plays) {
      const mine = pr.side === 0 ? r0 : r1, theirs = pr.side === 0 ? r1 : r0;
      delta.set(pr.cid, ELO_K * (outs.get(pr.cid).s - expect(mine, theirs)));
    }
  }
  for (const pr of plays) {
    const st = statsOf(save, pr.cid), o = outs.get(pr.cid);
    st.m++;
    if (o.win) st.w++;
    else if (o.draw) st.d++;
    else st.l++;
    for (const f of ['k', 'de', 'hs', 'sh', 'hi', 'dmg', 'rp', 'rw', 'pl', 'df', 'nd', 'hk', 'tk', 'su']) st[f] += pr[f] || 0;
    if (spec.type === 'ffa') {
      st.ffa++;
      st.place += o.place;
    }
    for (const [w, c] of Object.entries(pr.wk || {})) st.wk[w] = (st.wk[w] || 0) + c;
    const b = (st.by[key] ||= [0, 0, 0, 0, 0, 0]);
    b[0]++;
    b[o.win ? 1 : o.draw ? 3 : 2]++;
    b[4] += pr.k;
    b[5] += pr.de;
    st.r = Math.round((st.r + delta.get(pr.cid)) * 10) / 10;
    st.peakR = Math.max(st.peakR, st.r);
    st.best = Math.max(st.best, pr.k);
    // streaks (a draw ends both kinds)
    st.cs = o.win ? Math.max(0, st.cs) + 1 : o.draw ? 0 : Math.min(0, st.cs) - 1;
    st.bs = Math.max(st.bs, st.cs);
    st.hist.push([n, Math.round(st.r)]);
    // a long history keeps every other point
    if (st.hist.length > 400) st.hist = st.hist.filter((x, i) => i % 2 === 0 || i === st.hist.length - 1);
  }
  // head to head: everyone against everyone they played against
  for (const a of plays) {
    for (const b of plays) {
      if (a === b) continue;
      if (spec.type !== 'ffa' && a.side === b.side) continue;
      const row = (save.h2h[a.cid] ||= {});
      const cell = (row[b.cid] ||= [0, 0, 0]);
      let r;
      if (spec.type === 'ffa') {
        const ia = res.order.indexOf(a.cid), ib = res.order.indexOf(b.cid);
        r = ia < ib ? 0 : ia > ib ? 1 : 2;
      } else r = res.winner == null ? 2 : res.winner === a.side ? 0 : 1;
      cell[r]++;
    }
  }
  const changes = [];
  if (save.settings.skillMode === 'practice') for (const pr of plays) practice(save, byId.get(pr.cid), pr);
  if (save.settings.evolve === 'tune') {
    for (const pr of plays) {
      const ch = tuneStep(save, byId.get(pr.cid), perf(outs.get(pr.cid), pr));
      if (ch) changes.push(ch);
    }
  }
  // free battles: a new generation every so many matches (seasons have
  // theirs between seasons, and cups none: their brackets must stay whole)
  if (!spec.comp) save.sinceGen = (save.sinceGen || 0) + 1;
  if (save.settings.evolve === 'gen' && !spec.comp && save.sinceGen >= save.settings.genEvery && !compOpen(save)) {
    save.sinceGen = 0;
    const born = generation(save);
    if (born) changes.push(born);
  }
  save.log.push({
    n, type: spec.type, map: spec.map, t: Math.round(res.time), w: res.winner, sc: res.score, rounds: res.rounds,
    ps: plays.map((pr) => [pr.cid, pr.side ?? -1, pr.k, pr.de]), order: res.order || null, watched: !!res.watched,
  });
  if (save.log.length > LOG_MAX) save.log.splice(0, save.log.length - LOG_MAX);
  return { changes, ctx: { before, delta, outs, plays } };
}

// ---------------------------------------------------------------- practice
// What each skill is practised by in a match, and how much of it a character
// gets in an average match (measured over duels, Team DM and free-for-all;
// longer matches bring more practice, like in real life).
const USES = { reaction: 'eng', aim: 'sh', headshots: 'hi', recoil: 'spray', grenades: 'nd' };
const PER_MATCH = { reaction: 52, aim: 77, headshots: 39, recoil: 13, grenades: 2.7 };
// At learning speed 1 a skill at 50 gains about 0.11 a match: Normal to about
// Hard in ~300 matches, near Expert after ~2000, slower and slower after that.
const LEARN = 0.444;
// Muscle memory: below its old best a skill comes back this share of the gap
// a match (with a full match of practice), so a few dozen matches bring it back
const MEMORY = 0.1;
// an unused skill loses this much a match (very slowly)
const RUST = 0.01;

function practice(save, c, pr) {
  const speed = save.settings.learn;
  for (const k of SKILLS) {
    const uses = pr[USES[k]] || 0;
    let v = c.skills[k];
    if (uses > 0) {
      const x = 1 - v / 100;
      let gain = Math.min(2, speed * (LEARN / PER_MATCH[k]) * uses * x * x);
      const gap = c.peak[k] - v;
      // back toward the old best quickly (never past it: past it, learning as usual)
      if (gap > 0) gain = Math.max(gain, gap * MEMORY * Math.min(1, uses / PER_MATCH[k]) * Math.max(1, speed));
      v = Math.min(99.99, v + gain);
    } else {
      v = Math.max(0, v - RUST * speed);
    }
    c.skills[k] = Math.round(v * 1000) / 1000;
    if (c.skills[k] > c.peak[k]) c.peak[k] = c.skills[k];
  }
}

// ---------------------------------------------------------------- evolution
const rnd = (a, b) => a + Math.random() * (b - a);
const GUN_POOL = PRIMARIES.filter((g) => WEAPONS[g]);

// A small change to how a character plays (in free-slider saves the skills
// can change too). Hacks are never touched: they are the user's choice.
function mutate(save, c, strength = 1) {
  const out = [];
  const n = 1 + (Math.random() < 0.4 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const r = Math.random();
    if (r < 0.12) {
      c.style = STYLES.filter((s) => s !== c.style)[(Math.random() * 3) | 0];
      out.push('style');
    } else if (r < 0.24) {
      c.gun = Math.random() < 0.08 ? 'none' : GUN_POOL[(Math.random() * GUN_POOL.length) | 0];
      out.push('gun');
    } else if (r < 0.3) {
      c.pistol = PISTOL_CHOICES[(Math.random() * PISTOL_CHOICES.length) | 0];
      out.push('pistol');
    } else if (save.settings.skillMode === 'free' && r < 0.6) {
      const k = SKILLS[(Math.random() * SKILLS.length) | 0];
      c.skills[k] = Math.round(clamp(c.skills[k] + rnd(-10, 10) * strength, 0, 100, 50));
      out.push(k);
    } else {
      const k = HABITS[(Math.random() * HABITS.length) | 0];
      c.habits[k] = Math.round(clamp(c.habits[k] + rnd(-20, 20) * strength, 0, 100, 50));
      out.push(k);
    }
  }
  return out;
}

const traitsOf = (c) => ({ style: c.style, gun: c.gun, pistol: c.pistol, habits: { ...c.habits }, skills: { ...c.skills } });

// "Each tunes itself": play some matches, try a change, keep it if the
// character did at least as well with it, otherwise go back.
function tuneStep(save, c, p) {
  if (!c || c.retired) return null;
  const every = save.settings.tuneEvery;
  const t = (c.tune ||= { phase: 'base', n: 0, sum: 0, base: 0, backup: null, tries: 0, kept: 0 });
  t.n++;
  t.sum += p;
  if (t.n < every) return null;
  const score = t.sum / t.n;
  t.n = 0;
  t.sum = 0;
  let note = null;
  if (t.phase === 'trial') {
    t.tries++;
    if (score >= t.base - 0.01) {
      t.base = score;
      t.kept++;
      note = { kind: 'kept', id: c.id, what: t.what };
    } else {
      // it did worse: back to before (practice skills stay what they are)
      const b = t.backup;
      c.style = b.style;
      c.gun = b.gun;
      c.pistol = b.pistol;
      c.habits = b.habits;
      if (save.settings.skillMode === 'free') c.skills = b.skills;
      note = { kind: 'reverted', id: c.id, what: t.what };
    }
  } else t.base = score;
  t.backup = traitsOf(c);
  t.what = mutate(save, c);
  t.phase = 'trial';
  if (note) {
    save.evoLog.push({ n: save.matches, ...note });
    if (save.evoLog.length > LOG_MAX) save.evoLog.splice(0, save.evoLog.length - LOG_MAX);
  }
  return note;
}

// "New generations": the weakest quarter retires and children of the best
// half take their places, mixing their parents' traits.
export function generation(save) {
  const live = save.chars.filter((c) => !c.retired);
  if (live.length < 4) return null;
  const rated = live.map((c) => ({ c, r: statsOf(save, c.id).r })).sort((a, b) => b.r - a.r);
  const out = Math.max(1, Math.floor(live.length / 4));
  const parents = rated.slice(0, Math.max(2, Math.ceil(live.length / 2))).map((x) => x.c);
  const gone = rated.slice(-out).map((x) => x.c);
  const born = [];
  // better parents get picked more often
  const pickParent = (not) => {
    const pool = parents.filter((p) => p !== not);
    const w = pool.map((p, i) => pool.length - i);
    let r = Math.random() * w.reduce((s, x) => s + x, 0);
    for (let i = 0; i < pool.length; i++) if ((r -= w[i]) <= 0) return pool[i];
    return pool[0];
  };
  for (const old of gone) {
    old.retired = true;
    old.retiredAt = save.matches;
    const a = pickParent(null), b = pickParent(a);
    const kid = cleanChar({
      name: freshName(save),
      color: mixColor(a.color, b.color),
      style: Math.random() < 0.5 ? a.style : b.style,
      pers: Math.random() < 0.8 ? (Math.random() < 0.5 ? a.pers : b.pers) : PERSONALITIES[(Math.random() * PERSONALITIES.length) | 0],
      gun: Math.random() < 0.5 ? a.gun : b.gun,
      pistol: Math.random() < 0.5 ? a.pistol : b.pistol,
      habits: Object.fromEntries(HABITS.map((k) => [k, Math.round((a.habits[k] + b.habits[k]) / 2)])),
      hacks: Object.fromEntries(HACKS.map((k) => [k, Math.random() < 0.5 ? a.hacks[k] : b.hacks[k]])),
      hackCfg: Math.random() < 0.5 ? a.hackCfg : b.hackCfg,
      gen: Math.max(a.gen, b.gen) + 1,
      parents: [a.id, b.id],
      born: save.matches,
    }, save.chars.length);
    for (const k of SKILLS) {
      if (save.settings.skillMode === 'free') kid.skills[k] = Math.round((a.skills[k] + b.skills[k]) / 2);
      else kid.skills[k] = save.settings.start === 'same' ? BASE_SKILL : Math.round((a.start[k] + b.start[k]) / 2);
      kid.start[k] = kid.skills[k];
      kid.peak[k] = kid.skills[k];
    }
    mutate(save, kid, 0.6);
    save.chars.push(kid);
    // the child takes the parent's place in clans and in the battle setup
    for (const cl of save.clans) {
      const i = cl.members.indexOf(old.id);
      if (i >= 0) cl.members[i] = kid.id;
    }
    if (save.setup && Array.isArray(save.setup.chars)) {
      const i = save.setup.chars.indexOf(old.id);
      if (i >= 0) save.setup.chars[i] = kid.id;
    }
    // ...and in the season's divisions
    for (const div of save.divs?.solo || []) {
      const i = div.indexOf(old.id);
      if (i >= 0) div[i] = kid.id;
    }
    born.push({ id: kid.id, from: [a.id, b.id], replaced: old.id });
  }
  // the retired keep their stats, but not who they played against; the
  // oldest of them go for good, so a long run doesn't fill the browser's storage
  for (const old of gone) {
    delete save.h2h[old.id];
    for (const row of Object.values(save.h2h)) delete row[old.id];
  }
  const retired = save.chars.filter((c) => c.retired).sort((a, b) => a.retiredAt - b.retiredAt);
  for (const c of retired.slice(0, Math.max(0, retired.length - MAX_RETIRED))) {
    save.chars.splice(save.chars.indexOf(c), 1);
    delete save.stats[c.id];
  }
  const note = { kind: 'generation', n: save.matches, born };
  save.evoLog.push(note);
  if (save.evoLog.length > LOG_MAX) save.evoLog.splice(0, save.evoLog.length - LOG_MAX);
  return note;
}

function mixColor(a, b) {
  const ca = parseInt(a.slice(1), 16), cb = parseInt(b.slice(1), 16);
  let out = 0;
  for (const sh of [16, 8, 0]) {
    const v = Math.round((((ca >> sh) & 255) + ((cb >> sh) & 255)) / 2 + rnd(-30, 30));
    out |= Math.max(0, Math.min(255, v)) << sh;
  }
  return '#' + out.toString(16).padStart(6, '0');
}

// ---------------------------------------------------------------- battles
export const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// the parts of a character a match needs (a frozen copy: a change made while
// the match plays doesn't touch it)
export const snapshot = (c) => JSON.parse(JSON.stringify({
  id: c.id, name: c.name, color: c.color, style: c.style, skills: c.skills, habits: c.habits, gun: c.gun, pistol: c.pistol, hacks: c.hacks, hackCfg: c.hackCfg,
}));

// what a battle can play with these settings; null when it can't play
// anything (the reason as a key for the menus)
export function battleCheck(save, setup) {
  const chars = battleChars(save, setup);
  const maps = setup.maps;
  if (!maps.length) return 'arenaNoMaps';
  const fights = FIGHTS.filter((f) => setup.fights[f].on && (f !== 'bomb' || maps.some(isBombMapName)));
  if (!fights.length) return setup.fights.bomb.on ? 'arenaNoBombMap' : 'arenaNoFights';
  if (setup.teams === 'clans' && fights.some((f) => f !== 'duel' && f !== 'ffa')) {
    if (clansFor(save, setup).length < 2) return 'arenaNoClans';
  }
  if (chars.length < 2) return 'arenaNoChars';
  return null;
}

const BOMB_MAPS = new Set(['de_dunetown', 'de_foundry']);
export const isBombMapName = (m) => BOMB_MAPS.has(m);
export const ARENA_MAPS = DEFAULT_SETUP.maps;

const battleChars = (save, setup) => save.chars.filter((c) => !c.retired && (!setup.chars || setup.chars.includes(c.id)));
// clans with at least one character who's in the battle
const clansFor = (save, setup) => {
  const ids = new Set(battleChars(save, setup).map((c) => c.id));
  return save.clans.map((cl) => ({ ...cl, members: cl.members.filter((id) => ids.has(id)) })).filter((cl) => cl.members.length);
};

// A battle: hands out its matches one by one, spread evenly over the fight
// types and maps, each character playing about as often as the others.
export class Battle {
  constructor(save, setup) {
    this.save = save;
    this.setup = setup;
    this.total = setup.count;
    this.made = 0;
    this.combos = [];
    this.played = new Map(); // character -> matches handed out (per fight type)
    this.pairs = [];
    this.clanPairs = [];
  }

  // the (fight, map) pairs to go round, shuffled every lap
  nextCombo() {
    if (!this.combos.length) {
      const s = this.setup;
      for (const f of FIGHTS) {
        if (!s.fights[f].on) continue;
        for (const m of s.maps) if (f !== 'bomb' || isBombMapName(m)) this.combos.push([f, m]);
      }
      shuffle(this.combos);
    }
    return this.combos.pop();
  }

  count(id, f) {
    return this.played.get(id + '|' + f) || 0;
  }

  mark(list, f) {
    for (const c of list) this.played.set(c.id + '|' + f, this.count(c.id, f) + 1);
  }

  // the runner: nothing more to hand out / a match that wasn't played after all
  finished() {
    return this.made >= this.total;
  }

  drop() {
    this.made--;
  }

  // the n who have played this fight type the least (ties at random)
  leastPlayed(pool, n, f) {
    return shuffle([...pool]).sort((a, b) => this.count(a.id, f) - this.count(b.id, f)).slice(0, n);
  }

  next() {
    if (this.made >= this.total) return null;
    const save = this.save, s = this.setup;
    const pool = battleChars(save, s);
    if (pool.length < 2) return null;
    const combo = this.nextCombo();
    if (!combo) return null;
    const [type, map] = combo;
    const fs = s.fights[type];
    let sides = null, players = null;
    if (type === 'duel') {
      // every pair in turn (a round-robin), a new shuffled round when it's done
      const ids = new Set(pool.map((c) => c.id));
      this.pairs = this.pairs.filter(([a, b]) => ids.has(a.id) && ids.has(b.id));
      if (!this.pairs.length) {
        for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) this.pairs.push([pool[i], pool[j]]);
        shuffle(this.pairs);
      }
      const [a, b] = this.pairs.pop();
      sides = [[a], [b]];
    } else if (type === 'ffa') {
      players = this.leastPlayed(pool, Math.min(fs.size, pool.length), type);
    } else if (s.teams === 'clans') {
      const clans = clansFor(save, s);
      if (clans.length < 2) return null;
      if (!this.clanPairs.length) {
        for (let i = 0; i < clans.length; i++) for (let j = i + 1; j < clans.length; j++) this.clanPairs.push([clans[i].id, clans[j].id]);
        shuffle(this.clanPairs);
      }
      const [ia, ib] = this.clanPairs.pop();
      const ca = clans.find((c) => c.id === ia), cb = clans.find((c) => c.id === ib);
      if (!ca || !cb) {
        this.clanPairs = [];
        return this.next();
      }
      const byId = new Map(pool.map((c) => [c.id, c]));
      const n = Math.min(fs.size, ca.members.length, cb.members.length);
      sides = [ca, cb].map((cl) => this.leastPlayed(cl.members.map((id) => byId.get(id)).filter(Boolean), n, type));
      sides.clans = [ca.id, cb.id];
    } else {
      const n = Math.min(fs.size, Math.floor(pool.length / 2));
      const chosen = shuffle(this.leastPlayed(pool, n * 2, type));
      sides = [chosen.slice(0, n), chosen.slice(n)];
    }
    const list = sides ? [...sides[0], ...sides[1]] : players;
    this.mark(list, type);
    this.made++;
    return makeSpec(type, map, fs, sides, players, this.made, (id) => statsOf(save, id).r);
  }
}

// the match as the game plays it (what Game.start gets, plus who is who)
export function makeSpec(type, map, fs, sides, players, n, rating = () => BASE_RATING) {
  const mode = FIGHT_MODE[type];
  const ps = sides
    ? sides.flatMap((list, side) => list.map((c) => ({ ch: snapshot(c), side, r: Math.round(rating(c.id)) })))
    : players.map((c) => ({ ch: snapshot(c), side: null, r: Math.round(rating(c.id)) }));
  const hacks = ps.some((p) => HACKS.some((k) => p.ch.hacks[k]));
  const firstT = Math.random() < 0.5 ? 0 : 1;
  const nT = sides ? sides[firstT].length : 0, nCT = sides ? sides[1 - firstT].length : 0;
  const rounds = ROUND_FIGHTS.has(type);
  return {
    n, type, map,
    clans: sides?.clans || null,
    cfg: {
      map, mode, difficulty: 'normal',
      bots: ps.length, botsT: nT, botsCT: nCT,
      tdmLimit: type === 'duel' || type === 'tdm' ? fs.kills : 0,
      ffaLimit: type === 'ffa' ? fs.kills : 0,
      // a match that drags on ends on time (the leader wins)
      timeLimit: rounds ? 0 : type === 'duel' ? 15 : 20,
      roundsToWin: rounds ? fs.rounds : 30,
      roundTime: 0, freezeTime: 3, startMoney: 800, friendlyFire: false, autoBalance: false, ggTeams: false,
      hacks, hackBotsT: 0, hackBotsCT: 0, hackBots: 0, botHacks: null,
      arena: { type, players: ps, firstT, swapHalf: rounds },
    },
  };
}

// ---------------------------------------------------------------- export
// quoted only when it holds the separator, a quote or a line break (a quoted
// number could be read as text)
const csvCell = (v, sep) => {
  const s = String(v ?? '');
  return s.includes(sep) || /["\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

// The stats as one CSV file (opens in Excel): leaderboard, per map and fight
// type, head to head, kills per gun. `label` translates column titles; `fmt`
// has the list separator and decimal point Excel expects ({ sep, dec }).
export function toCSV(save, label, fmt = {}) {
  const rows = [];
  const L = label || ((k) => k);
  const sep = fmt.sep || ',', dec = fmt.dec || '.';
  const chars = [...save.chars].sort((a, b) => statsOf(save, b.id).r - statsOf(save, a.id).r);
  rows.push([save.name, L('csvMatches'), save.matches]);
  rows.push([]);
  rows.push([L('csvLeaderboard')]);
  rows.push(['#', L('name'), L('arenaRating'), L('csvMatches'), L('csvWins'), L('csvLosses'), L('csvDraws'), L('csvWinPct'), L('csvKills'), L('deaths'), 'K/D', L('csvHsPct'), L('csvAccuracy'), L('csvDmgRound'), L('csvPlants'), L('csvDefuses'), L('csvNades'), L('hackKillsCol'), L('arenaStyle'), L('arenaGun'), L('arenaPistol'), ...SKILLS.map((k) => L('skill_' + k)), ...HABITS.map((k) => L('habit_' + k)), L('hacks'), L('csvRetired')]);
  chars.forEach((c, i) => {
    const s = statsOf(save, c.id);
    rows.push([i + 1, c.name, Math.round(s.r), s.m, s.w, s.l, s.d, pct(s.w, s.m), s.k, s.de, s.de ? Math.round((s.k / s.de) * 100) / 100 : s.k, pct(s.hs, s.k), pct(s.hi, s.sh), s.rp ? Math.round(s.dmg / s.rp) : '',
      s.pl, s.df, s.nd, s.hk, L('style_' + c.style), c.gun === 'none' ? L('arenaNoGun') : WEAPONS[c.gun].name, WEAPONS[c.pistol].name,
      ...SKILLS.map((k) => Math.round(c.skills[k])), ...HABITS.map((k) => c.habits[k]), hacksOn(c).map((k) => L('hack_' + k)).join(' + '), c.retired ? L('yes') : '']);
  });
  rows.push([]);
  rows.push([L('csvByMap')]);
  rows.push([L('name'), L('map'), L('arenaFight'), L('csvMatches'), L('csvWins'), L('csvLosses'), L('csvDraws'), L('csvWinPct'), L('csvKills'), L('deaths')]);
  for (const c of chars) {
    const s = statsOf(save, c.id);
    for (const [k, b] of Object.entries(s.by).sort()) {
      const [map, type] = k.split('|');
      rows.push([c.name, map, L('fight_' + type), b[0], b[1], b[2], b[3], pct(b[1], b[0]), b[4], b[5]]);
    }
  }
  rows.push([]);
  rows.push([L('csvH2h')]);
  rows.push(['', ...chars.map((c) => c.name)]);
  for (const a of chars) {
    rows.push([a.name, ...chars.map((b) => {
      if (a === b) return '';
      const cell = save.h2h[a.id]?.[b.id];
      return cell ? `${cell[0]}-${cell[1]}-${cell[2]}` : '';
    })]);
  }
  rows.push([]);
  rows.push([L('csvGunKills')]);
  rows.push([L('name'), L('csvGun'), L('csvKills')]);
  for (const c of chars) {
    const s = statsOf(save, c.id);
    for (const [w, k] of Object.entries(s.wk).sort((a, b) => b[1] - a[1])) rows.push([c.name, WEAPONS[w]?.name || w, k]);
  }
  const cell = (v) => csvCell(typeof v === 'number' && !Number.isInteger(v) ? String(v).replace('.', dec) : v, sep);
  return rows.map((r) => r.map(cell).join(sep)).join('\r\n');
}

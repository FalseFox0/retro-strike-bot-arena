// Player preferences, kept in localStorage (the game still works if storage is blocked).

import { PRIMARIES, SECONDARIES } from './weapons.js';
import { CROSSHAIR_DEFAULTS, CROSSHAIR_SHAPES } from './crosshair.js';
import { HACKS, HACK_DEFAULTS, hackCfg } from './hacks.js';

export const ACTIONS = [
  'forward', 'back', 'moveleft', 'moveright', 'jump', 'duck', 'walk',
  'attack', 'attack2', 'reload', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'lastinv',
  'invnext', 'invprev', 'use', 'drop', 'scores', 'chooseteam', 'gunmenu', 'autobuy', 'rebuy', 'radio',
];

export const DEFAULT_BINDS = {
  forward: ['KeyW', null],
  back: ['KeyS', null],
  moveleft: ['KeyA', null],
  moveright: ['KeyD', null],
  jump: ['Space', null],
  duck: ['ControlLeft', null],
  walk: ['ShiftLeft', null],
  attack: ['MOUSE1', null],
  attack2: ['MOUSE2', null],
  reload: ['KeyR', null],
  slot1: ['Digit1', null],
  slot2: ['Digit2', null],
  slot3: ['Digit3', null],
  slot4: ['Digit4', null],
  slot5: ['Digit5', null],
  use: ['KeyE', null],
  drop: ['KeyG', null],
  autobuy: ['F1', null],
  rebuy: ['F2', null],
  lastinv: ['KeyQ', null],
  invnext: ['MWHEELDOWN', null],
  invprev: ['MWHEELUP', null],
  scores: ['Tab', null],
  chooseteam: ['KeyM', null],
  gunmenu: ['KeyB', null],
  radio: ['KeyZ', null],
};

const STORAGE_KEY = 'cs16remake.settings.v1';

function defaults() {
  const nav = (typeof navigator !== 'undefined' && navigator.language) || '';
  const match = defaultMatch();
  return {
    lang: nav.toLowerCase().startsWith('tr') ? 'tr' : 'en',
    sensitivity: 3,
    invertMouse: false,
    rawInput: true,
    volume: 0.7,
    musicVolume: 0.5,
    ambienceVolume: 0.6,
    crosshair: { ...CROSSHAIR_DEFAULTS },
    fullscreen: true,
    showFps: false,
    quality: 'medium',
    gamma: 1,
    brightness: 1,
    pauseInMenu: true,
    tracers: true,
    // hacker mode: our aimbot / triggerbot / speedhack sliders, and whether
    // watching a hacker shows their hacks ('off' | 'eye' first person | 'all')
    hackCfg: { ...HACK_DEFAULTS },
    hackSpecView: 'eye',
    binds: structuredClone(DEFAULT_BINDS),
    match,
    // online play: the name others see, and the host's match settings (kept
    // apart from Create Game's). fill: players a team (or all of them in
    // free-for-all); bots take the places no human has
    playerName: '',
    onlineMatch: { ...structuredClone(match), fill: 5 },
    guns: { primary: 'ak47', secondary: 'deagle', remember: false },
  };
}

function defaultMatch() {
  return {
    map: 'de_dunetown',
    mode: 'tdm',
    bots: 9,
    difficulty: 'normal',
    tdmLimit: 75,
    ffaLimit: 30,
    timeLimit: 15,
    roundsToWin: 10,
    ggTeams: false,
    // team modes: bots on each side (you join on top of them)
    botsT: 4,
    botsCT: 5,
    // Advanced: round and freeze time, start money, friendly fire, auto team balance
    roundTime: 0, // minutes, 0 = the mode's own (2:00, bomb defusal 1:45)
    freezeTime: 3,
    startMoney: 800,
    friendlyFire: false,
    autoBalance: true,
    // Hacks tab: may players switch hacks on, how many bots hack and with what
    hacks: false,
    hackBotsT: 0,
    hackBotsCT: 0,
    hackBots: 0, // free-for-all
    botHacks: Object.fromEntries(HACKS.map((k) => [k, true])),
    // what the dead may watch: 'team' (teammates only) or 'all' (everyone, every view)
    deadView: 'team',
    // Bot Arena characters in the bot slots: from which save ('' = plain bots), and which (null = any)
    botChars: { save: '', pick: null },
  };
}

// Create Game choices
export const ROUND_TIMES = [0, 1, 1.5, 1.75, 2, 2.5, 3, 4, 5];
export const FREEZE_TIMES = [0, 2, 3, 4, 6, 8, 10];
export const START_MONEY = [800, 1000, 2000, 4000, 8000, 16000];
export const MAX_TEAM_BOTS = 9; // every map has 10 spawns a side
// does this match setup have teams? (free-for-all and free-for-all Gun Game don't)
export const hasTeams = (m) => m.mode !== 'ffa' && (m.mode !== 'gungame' || m.ggTeams);

const PRIMARY_IDS = PRIMARIES;
const SECONDARY_IDS = SECONDARIES;
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const num = (v, min, max, fallback) => (typeof v === 'number' && v >= min && v <= max ? v : fallback);

// the old color and size choices carry over to the custom crosshair
const OLD_COLORS = { green: '#32fa32', red: '#fa3232', blue: '#3232fa', yellow: '#fafa32', cyan: '#32fafa' };
const OLD_SIZES = { small: 6, medium: 9, large: 13 };

function loadCrosshair(s, d) {
  const c = { ...d, ...(s.crosshair && typeof s.crosshair === 'object' ? s.crosshair : {}) };
  if (!s.crosshair) {
    if (OLD_COLORS[s.crosshairColor]) c.color = OLD_COLORS[s.crosshairColor];
    if (OLD_SIZES[s.crosshairSize]) c.length = OLD_SIZES[s.crosshairSize];
  }
  c.shape = pick(c.shape, CROSSHAIR_SHAPES, d.shape);
  c.color = typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color.toLowerCase() : d.color;
  c.alpha = num(c.alpha, 0.1, 1, d.alpha);
  c.length = num(c.length, 1, 20, d.length);
  c.thickness = num(c.thickness, 1, 6, d.thickness);
  c.gap = num(c.gap, 0, 20, d.gap);
  for (const k of ['dynamic', 'dot', 'outline']) if (typeof c[k] !== 'boolean') c[k] = d[k];
  for (const k of Object.keys(c)) if (!(k in d)) delete c[k];
  return c;
}

// a saved match setup with anything out of range set back to the default (raw: what was saved)
function cleanMatch(m, dm, raw) {
  m.mode = pick(m.mode, ['tdm', 'ffa', 'classic', 'bomb', 'gungame'], dm.mode);
  m.map = pick(m.map, ['aim_classic', 'de_dunetown', 'de_foundry', 'fy_poolhouse', 'awp_rooftops'], dm.map);
  if (m.mode === 'bomb' && !m.map.startsWith('de_')) m.mode = 'classic';
  m.difficulty = pick(m.difficulty, ['easy', 'normal', 'hard', 'expert'], dm.difficulty);
  m.bots = num(m.bots, 0, 15, dm.bots);
  for (const k of ['tdmLimit', 'ffaLimit', 'timeLimit', 'roundsToWin']) m[k] = num(m[k], 0, 1000, dm[k]);
  if (m.roundsToWin < 1) m.roundsToWin = dm.roundsToWin;
  m.ggTeams = !!m.ggTeams;
  // the per-team bot counts came later: split the old total
  if (!raw || raw.botsT === undefined) {
    m.botsT = Math.floor(m.bots / 2);
    m.botsCT = m.bots - m.botsT;
  }
  m.botsT = num(m.botsT, 0, MAX_TEAM_BOTS, dm.botsT);
  m.botsCT = num(m.botsCT, 0, MAX_TEAM_BOTS, dm.botsCT);
  m.roundTime = ROUND_TIMES.includes(m.roundTime) ? m.roundTime : 0;
  m.freezeTime = num(m.freezeTime, 0, 10, dm.freezeTime);
  m.startMoney = num(m.startMoney, 800, 16000, dm.startMoney);
  for (const k of ['friendlyFire', 'autoBalance', 'hacks']) if (typeof m[k] !== 'boolean') m[k] = dm[k];
  m.hackBotsT = num(m.hackBotsT, 0, MAX_TEAM_BOTS, 0);
  m.hackBotsCT = num(m.hackBotsCT, 0, MAX_TEAM_BOTS, 0);
  m.hackBots = num(m.hackBots, 0, 15, 0);
  const bh = m.botHacks && typeof m.botHacks === 'object' ? m.botHacks : {};
  m.botHacks = Object.fromEntries(HACKS.map((k) => [k, typeof bh[k] === 'boolean' ? bh[k] : true]));
  m.deadView = pick(m.deadView, ['team', 'all'], dm.deadView);
  const bc = m.botChars && typeof m.botChars === 'object' ? m.botChars : {};
  m.botChars = {
    save: typeof bc.save === 'string' ? bc.save : '',
    pick: Array.isArray(bc.pick) ? bc.pick.filter((x) => typeof x === 'string') : null,
  };
  return m;
}

function load() {
  const d = defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return d;
    const out = {
      ...d,
      ...s,
      binds: { ...d.binds },
      match: { ...d.match, ...(s.match || {}) },
      guns: { ...d.guns, ...(s.guns || {}) },
    };
    // keep only well-formed key bindings
    for (const a of ACTIONS) {
      const b = s.binds && s.binds[a];
      if (Array.isArray(b) && b.length === 2 && b.every((c) => c === null || typeof c === 'string')) out.binds[a] = b;
    }
    // anything out of range falls back to the default
    out.lang = pick(out.lang, ['en', 'tr'], d.lang);
    out.quality = pick(out.quality, ['low', 'medium', 'high'], d.quality);
    out.crosshair = loadCrosshair(s, d.crosshair);
    delete out.crosshairColor;
    delete out.crosshairSize;
    out.sensitivity = num(out.sensitivity, 0.1, 20, d.sensitivity);
    out.volume = num(out.volume, 0, 1, d.volume);
    out.musicVolume = num(out.musicVolume, 0, 1, d.musicVolume);
    out.ambienceVolume = num(out.ambienceVolume, 0, 1, d.ambienceVolume);
    out.gamma = num(out.gamma, 0.5, 1.5, d.gamma);
    out.brightness = num(out.brightness, 0.5, 1.5, d.brightness);
    out.guns.primary = pick(out.guns.primary, PRIMARY_IDS, d.guns.primary);
    out.guns.secondary = pick(out.guns.secondary, SECONDARY_IDS, d.guns.secondary);
    out.match = cleanMatch(out.match, d.match, s.match);
    out.onlineMatch = cleanMatch({ ...d.onlineMatch, ...(s.onlineMatch || {}) }, d.onlineMatch, s.onlineMatch);
    out.onlineMatch.fill = num(out.onlineMatch.fill, 1, 10, d.onlineMatch.fill);
    out.playerName = typeof out.playerName === 'string' ? out.playerName.slice(0, 20) : '';
    out.hackCfg = hackCfg(out.hackCfg);
    out.hackSpecView = pick(out.hackSpecView, ['off', 'eye', 'all'], d.hackSpecView);
    for (const k of ['invertMouse', 'rawInput', 'fullscreen', 'showFps', 'pauseInMenu', 'tracers']) if (typeof out[k] !== 'boolean') out[k] = d[k];
    out.guns.remember = !!out.guns.remember;
    return out;
  } catch {
    return d;
  }
}

export const settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage blocked: settings just won't persist
  }
}

export function resetBinds() {
  settings.binds = structuredClone(DEFAULT_BINDS);
}

// Match logic: players and bots, the game modes, shooting and damage,
// grenades, breakables, respawns / rounds, cameras and HUD state.
// Bot Arena matches (cfg.arena) are played by its characters, with us as a
// spectator; its background matches run with `headless` (nothing drawn).
// Bomb defusal's own rules (money, the C4, dropped guns) are in bomb.js,
// Gun Game's (the gun ladder) in gungame.js.
// Online, the host's game is the real one and runs everyone (nethost.js
// sends it to the friends); a friend's game only shows it (netclient.js).

import * as THREE from '../lib/three.module.js';
import { DEG, vfov, HULL, PM } from './config.js';
import { t, tmsg } from './i18n.js';
import { settings, saveSettings } from './settings.js';
import { Player, rayVsPlayer, dirFromAngles, HITGROUP_MULT } from './player.js';
import { playerMove } from './movement.js';
import {
  forTeam, zoomFov, weaponTick, giveWeapon, giveGrenades, refillAmmo, cycleGrenade, selectSlot, deploy, BOT_PRIMARY, BOT_PISTOL, weighted,
} from './weapons.js';
import { BombMode, BOMB_ROUND_TIME, BUY_TIME, priceOf } from './bomb.js';
import { radio } from './radio.js';
import { CharacterModel, NullModel, hackPulse } from './models.js';
import { Grenades } from './grenades.js';
import { Items } from './items.js';
import { Bot } from './bot.js';
import { GunGame } from './gungame.js';
import { TeamRadio } from './teamradio.js';
import { PENETRATION, IMPACT_SOUND, STEP_KIND } from './map.js';
import { escapeHtml, weaponName } from './hud.js';
import { HACKS, HACK_DEFAULTS, noHacks, hackCfg, isHacking, hackCmd } from './hacks.js';
import { MatchStats } from './matchstats.js';
import { ReplayPlayer } from './replay.js';

const BOT_NAMES = [
  'Viper', 'Ghost', 'Rookie', 'Hawk', 'Blaze', 'Shadow', 'Tank', 'Spike', 'Ace', 'Raven', 'Bolt', 'Cobra', 'Wolf', 'Storm', 'Frost',
  'Rex', 'Duke', 'Fox', 'Jet', 'Saber', 'Nomad', 'Echo', 'Talon', 'Moose', 'Brick', 'Pike', 'Onyx', 'Drake', 'Flint', 'Mako',
];
const RESPAWN_DELAY = 1.5;
const SPAWN_PROTECT = 2;
const FREEZE_TIME = 3;
const ROUND_TIME = 120;
const ROUND_END_DELAY = 5;
// What DM respawns carry: one HE, two flashbangs and a smoke (1.6 carry limits)
const DM_NADES = { hegrenade: 1, flashbang: 2, smokegrenade: 1 };
// CS 1.6 crosshair base distance and per-shot growth (cl_dll ammo.cpp)
const CROSS = {
  p228: [8, 3], fiveseven: [8, 3], usp: [8, 3], glock18: [8, 3], awp: [8, 3], deagle: [8, 3],
  hegrenade: [8, 3], flashbang: [8, 3], smokegrenade: [8, 3],
  mp5navy: [6, 2], m3: [8, 6], g3sg1: [6, 4], ak47: [4, 4], tmp: [7, 3], knife: [7, 3], p90: [7, 3],
  xm1014: [9, 4], mac10: [9, 3], aug: [3, 3], ump45: [6, 3], m249: [6, 3], sg552: [5, 3],
};

const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const v4 = new THREE.Vector3();
// what hacker mode shows when nobody's hacks apply to the view
const NO_HACKS = Object.freeze(noHacks());
const ENEMY_CHAMS = 0xff3a1e, TEAM_CHAMS = 0x2f7bff;
const blankCmd = () => ({ forward: 0, side: 0, jump: false, duck: false, walk: false, attack: false, attack2: false, reload: false, slot: 0, cycleNade: false, use: false, drop: false });

export class Game {
  constructor(ctx) {
    // ctx: scene, camera, map, effects, hud, sound, input, viewModel, textures, ui, hooks
    Object.assign(this, ctx);
    this.world = this.map.world;
    this.players = [];
    this.time = 0;
    this.active = false;
    this.over = false;
    this.timers = [];
    this.human = null;
    this.pendingSlot = 0;
    this.pendingCycle = false;
    this.pendingDrop = false;
    this.bm = null; // bomb defusal rules, when playing that mode
    this.gg = null; // Gun Game rules, likewise
    this.ffa = false; // no teams: free-for-all (and free-for-all Gun Game)
    this.deathCam = null;
    this.specTarget = null;
    // watching: 'chase' (behind them), 'eye' (through their eyes), 'free' (fly
    // around) or 'overview' (the map from above)
    this.specMode = 'chase';
    this.director = false;   // the camera picks who to watch by itself
    this.statsPanel = false; // everyone's kills, health and guns at the side
    this.freeCam = null;     // { pos, yaw, pitch }
    this.dirNext = 0;        // when the director looks around again
    this.dirSince = 0;       // when it last switched
    this.shotLines = [];     // the overview's shots and deaths
    this.deathMarks = [];
    this.panelAt = 0;
    this.frameDt = 0;        // the real time of this frame (free camera speed)
    this.watchSpeed = 1;     // Bot Arena: how fast the watched match plays
    this.recorder = null;    // Bot Arena: writes the match down for highlights (highlights.js)
    this.replay = null;      // Bot Arena: a highlight being played back (replay.js)
    this.net = null;         // online, hosting: sends the match to the friends (nethost.js)
    this.client = null;      // online, a friend: the host's match shown here (netclient.js)
    this.pov = null; // whose eyes the camera is in: ours, the player we watch in first person, or nobody
    this.viewY = null;
    this.othersBuf = [];
    this.lastVm = '';
    this.bobTime = 0;
    this.bob = 0;
    this.flashFx = null;
    this.shakeAmp = 0;
    this.grenades = new Grenades(this, this.scene, this.textures);
    this.items = new Items(this); // guns on the ground
    this.radio = new TeamRadio(this);
    this.viewModel.onEject = () => this.pov && this.pov.alive && this.ejectShell(this.pov);
    this.effects.onShellBounce = (p) => this.soundSys.play('shell', { pos: { x: p.x, y: p.y, z: p.z }, volume: 0.5, ref: 60 });
  }

  // CS 1.6 V_CalcBob (cl_bob 0.01, cl_bobcycle 0.8, cl_bobup 0.5)
  calcBob(dt, p) {
    if (!p.onGround || dt === 0) return this.bob;
    this.bobTime += dt;
    let cycle = (this.bobTime % 0.8) / 0.8;
    cycle = cycle < 0.5 ? (Math.PI * cycle) / 0.5 : Math.PI + (Math.PI * (cycle - 0.5)) / 0.5;
    let bob = Math.hypot(p.vel.x, p.vel.z) * 0.01;
    bob = bob * 0.3 + bob * 0.7 * Math.sin(cycle);
    this.bob = Math.max(-7, Math.min(4, bob));
    return this.bob;
  }

  setMap(map) {
    this.map = map;
    this.world = map.world;
  }

  // how brightly a model at this spot is lit, from the lightmap under it
  lightLevel(x, y, z) {
    const L = this.map.lightAt(x, y, z);
    const lum = Math.pow(Math.max(0, 0.3 * L[0] + 0.59 * L[1] + 0.11 * L[2]), this.map.def.light?.gamma ?? 1);
    return Math.max(0.35, Math.min(1.15, lum / 1.25));
  }

  // ---------- match setup ----------
  start(cfg) {
    this.stop();
    this.cfg = cfg;
    this.mode = cfg.mode;
    this.ffa = cfg.mode === 'ffa' || (cfg.mode === 'gungame' && !cfg.ggTeams);
    this.time = 0;
    this.over = false;
    this.teamScore = { T: 0, CT: 0 };
    // Gun Game only ends with a knife kill on the last level
    this.matchEndsAt = cfg.timeLimit > 0 && cfg.mode !== 'gungame' ? cfg.timeLimit * 60 : Infinity;
    this.freezeTime = cfg.freezeTime ?? FREEZE_TIME;
    this.nextBalance = 0;
    this.round = { n: 0, state: 'wait', until: 0, endsAt: 0 };
    this.botsCreated = false;
    // spectating: a Bot Arena match starts with the director and the stats panel on
    this.director = !!cfg.arena;
    this.statsPanel = !!cfg.arena;
    this.specMode = 'chase';
    this.freeCam = null;
    this.shotLines = [];
    this.deathMarks = [];
    this.watchSpeed = 1;
    // Bot Arena: what everyone does, and each side's score (sides swap teams at half)
    this.stats = cfg.arena ? new MatchStats(this) : null;
    this.sideScore = [0, 0];
    this.swapped = false;
    if (cfg.arena) this.matchEndsAt = Math.min(this.matchEndsAt, 90 * 60);
    if (this.bm) this.bm.dispose();
    this.bm = this.mode === 'bomb' ? new BombMode(this) : null;
    this.gg = this.mode === 'gungame' ? new GunGame(this) : null;
    this.map.resetBreakables();
    this.map.doors.reset();
    this.items.setup();
    const h = new Player(0, 'Player', false);
    // hacker mode: everyone starts a match with every hack off
    h.hacks = noHacks();
    h.hackCfg = hackCfg(settings.hackCfg);
    if (this.bm) this.bm.onJoin(h);
    if (this.gg) this.gg.onJoin(h);
    h.model = this.makeModel(h, 'T');
    this.human = h;
    this.players = [h];
    this.active = true;
    this.radio.reset();
    this.effects.clear();
    this.hud.clearFeed();
    this.hud.setVisible(true);
    // Bot Arena: we only watch (online, nethost.js puts everyone in a team)
    if (cfg.arena) this.joinSpectators();
    else if (this.ffa && !cfg.online) this.chooseTeam('FFA');
  }

  // Compile shaders for everything that can show up during the match.
  prewarm(renderer) {
    const shown = [];
    const show = (o) => {
      if (!o.visible) {
        o.visible = true;
        shown.push(o);
      }
    };
    // one gun of each material mix is enough: all weapons share these programs and textures
    const sample = ['ak47', 'awp', 'deagle', 'm3', 'aug', 'knife', 'hegrenade', 'c4'];
    for (const p of this.players) {
      show(p.model.root);
      show(p.model.flash);
      for (const id of sample) p.model.setWeapon(id, false);
      // hacker mode's wallhack body and glow
      if (this.cfg.hacks) {
        p.model.setChams(ENEMY_CHAMS);
        p.model.setHackGlow(true);
      }
    }
    this.effects.smoke.forEach((sm) => show(sm.s));
    this.effects.fireballs.forEach((f) => show(f.s));
    if (this.bm) show(this.bm.led);
    const extra = this.grenades.prewarmObjects();
    for (const o of extra) this.scene.add(o);
    renderer.compile(this.scene, this.camera);
    for (const o of extra) this.scene.remove(o);
    for (const o of shown) o.visible = false;
    for (const p of this.players) {
      if (p.weapon) p.model.setWeapon(p.weapon.id, p.weapon.silenced);
      p.model.setChams(0);
      p.model.setHackGlow(false);
    }
    // first-person weapons for our look
    const vm = this.viewModel, look = this.human.look;
    for (const id of sample) {
      vm.setWeapon(id, look, false);
      vm.root.visible = true;
      renderer.compile(vm.scene, vm.camera);
    }
    this.lastVm = '';
  }

  stop() {
    if (this.recorder) {
      this.recorder.detach();
      this.recorder = null;
    }
    if (this.net) {
      this.net.detach();
      this.net = null;
    }
    if (this.client) {
      this.client.dispose();
      this.client = null;
    }
    if (this.replay) {
      this.replay.dispose();
      this.replay = null;
    }
    for (const p of this.players) {
      if (!p.model) continue;
      this.scene.remove(p.model.root);
      p.model.dispose();
    }
    this.players = [];
    this.human = null;
    this.active = false;
    this.over = false;
    this.timers = [];
    this.deathCam = null;
    this.specTarget = null;
    this.pov = null;
    this.flashFx = null;
    this.shakeAmp = 0;
    this.pendingGunMenu = null;
    this.hud.drawOverview(null);
    this.hud.setPanel(null);
    this.radio.reset();
    this.grenades.clear();
    this.items.clear();
    if (this.bm) {
      this.bm.dispose();
      this.bm = null;
    }
    this.gg = null;
    this.hud.showTextMenu(null);
    this.hud.setVisible(false);
  }

  makeModel(p, look) {
    if (p.model) {
      this.scene.remove(p.model.root);
      p.model.dispose();
    }
    const m = this.headless ? new NullModel() : new CharacterModel(look, this.textures);
    m.root.visible = false;
    if (p.char) m.setMark(parseInt(p.char.color.slice(1), 16));
    this.scene.add(m.root);
    p.look = look;
    p.model = m;
    return m;
  }

  needsTeam() {
    return this.active && !this.ffa && !this.human.team && !this.human.spectator;
  }

  // Auto-select: the team with fewer players. Online, bots give their place
  // to people, so it goes by people first (friends end up spread out).
  autoTeam(p = this.human) {
    if (!this.botsCreated) return Math.random() < 0.5 ? 'T' : 'CT';
    const n = (team, people) => this.players.filter((o) => o.team === team && o !== p && (!people || !o.isBot)).length;
    if (this.cfg.online) {
      const d = n('T', true) - n('CT', true);
      if (d) return d < 0 ? 'T' : 'CT';
    }
    if (n('T') !== n('CT')) return n('T') < n('CT') ? 'T' : 'CT';
    return Math.random() < 0.5 ? 'T' : 'CT';
  }

  // choice: 'T', 'CT', 'AUTO', 'SPEC' (or 'FFA' to start free-for-all);
  // p: who chooses (online, the friends choose on the host's game too)
  chooseTeam(choice, p = this.human) {
    const h = p;
    if (choice === 'FFA') {
      h.team = null;
      this.makeModel(h, Math.random() < 0.5 ? 'T' : 'CT');
      this.createBots();
      h.respawnAt = this.time + 0.1;
      this.hud.centerPrint(t('gameCommencing'), this.time, 2.5);
      this.hud.message(t(this.gg ? 'hintKeysGgFfa' : 'hintKeysFfa'), this.time, 10);
      return;
    }
    if (choice === 'SPEC') {
      this.joinSpectators();
      return;
    }
    // free-for-all has no teams: back from watching into the match
    if (this.ffa) {
      if (!h.spectator) return;
      h.spectator = false;
      h.respawnAt = this.time + 0.5;
      this.net?.rosterChanged();
      return;
    }
    const team = choice === 'AUTO' ? this.autoTeam(h) : choice;
    h.spectator = false;
    if (!this.botsCreated) {
      h.team = team;
      this.makeModel(h, team);
      this.createBots();
      this.hud.centerPrint(t('gameCommencing'), this.time, 2.5);
      this.hud.message(t(this.gg ? 'hintKeysGg' : 'hintKeys'), this.time, 10);
      if (this.bm) this.hud.message(t('hintKeysBomb'), this.time, 14);
      if (this.roundBased()) this.startRound();
      else h.respawnAt = this.time + 0.1;
      return;
    }
    if (team === h.team) return;
    const old = h.team;
    if (h.alive) {
      this.dropOnDeath(h);
      h.alive = false;
      h.deaths++;
      h.diedAt = this.time;
      this.tell(h, 'died', -1);
    }
    h.team = team;
    this.makeModel(h, team);
    // uneven teams are evened out by auto team balance (when it's on)
    this.tellAll('msg', ['teamChanged', { name: h.name, team: [team === 'T' ? 'teamT' : 'teamCT'] }]);
    if (!this.roundBased()) h.respawnAt = this.time + 0.5;
    else if (old) this.checkRoundEnd();
    this.net?.rosterChanged();
  }

  // watch the match without playing (team menu: 6. Spectate)
  joinSpectators(p = this.human) {
    const h = p;
    if (h.spectator) return;
    if (h.alive) {
      this.dropOnDeath(h);
      h.alive = false;
      h.diedAt = this.time;
    }
    h.hasCorpse = false;
    h.team = null;
    h.spectator = true;
    h.respawnAt = 0;
    this.tell(h, 'watch');
    if (!this.botsCreated) {
      this.createBots();
      this.hud.centerPrint(t('gameCommencing'), this.time, 2.5);
      if (this.roundBased()) this.startRound();
    } else if (this.roundBased()) this.checkRoundEnd();
    // (Bot Arena's spectator line has the keys already)
    if (!this.cfg.arena) this.tell(h, 'msg', 'hintKeysSpec', 10);
    this.net?.rosterChanged();
  }

  createBots() {
    const cfg = this.cfg;
    // Bot Arena: the match's characters on their sides (side firstT starts as Terrorists)
    if (cfg.arena) {
      const a = cfg.arena;
      a.players.forEach((e, i) => {
        const team = this.ffa ? null : e.side === a.firstT ? 'T' : 'CT';
        this.addBot(i + 1, e.ch.name, team, e.ch);
        this.players[this.players.length - 1].arenaSide = e.side;
      });
      this.botsCreated = true;
      this.flushHackNews(true);
      return;
    }
    const names = shuffle([...BOT_NAMES]);
    const teams = [];
    if (this.ffa) {
      for (let i = 0; i < cfg.bots; i++) teams.push(null);
    } else {
      // the T and CT counts from Create Game (older setups only have a total)
      const nT = cfg.botsT ?? Math.floor(cfg.bots / 2), nCT = cfg.botsCT ?? cfg.bots - nT;
      for (let i = 0; i < nT; i++) teams.push('T');
      for (let i = 0; i < nCT; i++) teams.push('CT');
    }
    // hacker mode: Create Game says how many bots of each side hack, and with what
    const hackers = new Set();
    if (cfg.hacks) {
      const idx = (want) => shuffle(teams.map((tm, i) => i).filter((i) => this.ffa || teams[i] === want));
      if (this.ffa) idx(null).slice(0, cfg.hackBots || 0).forEach((i) => hackers.add(i));
      else {
        idx('T').slice(0, cfg.hackBotsT || 0).forEach((i) => hackers.add(i));
        idx('CT').slice(0, cfg.hackBotsCT || 0).forEach((i) => hackers.add(i));
      }
    }
    // Bot Arena characters can fill the bot slots (Create Game); a character
    // that hacks does so when the match allows hacks
    const chars = cfg.chars || [];
    teams.forEach((team, i) => {
      const ch = chars[i] || null;
      const b = this.addBot(i + 1, ch ? ch.name : names[i % names.length], team, ch);
      if (hackers.has(i) && !b.hacking) for (const k of HACKS) if (cfg.botHacks && cfg.botHacks[k]) this.setHack(b, k, true);
    });
    this.botsCreated = true;
    this.flushHackNews(true);
  }

  // one bot (ch: a Bot Arena character, else it plays at the match's difficulty)
  addBot(id, name, team, ch) {
    const b = new Player(id, name, true);
    b.team = team;
    b.char = ch;
    b.hacks = noHacks();
    b.hackCfg = ch ? hackCfg(ch.hackCfg) : { ...HACK_DEFAULTS };
    this.makeModel(b, team || (Math.random() < 0.5 ? 'T' : 'CT'));
    b.brain = new Bot(this, b, this.cfg.difficulty, ch);
    if (this.bm) this.bm.onJoin(b);
    if (this.gg) this.gg.onJoin(b);
    b.respawnAt = this.time + 0.2 + Math.random() * 0.8;
    this.players.push(b);
    if (ch && this.cfg.hacks) for (const k of HACKS) if (ch.hacks[k]) this.setHack(b, k, true);
    return b;
  }

  // Online: a friend playing on the host's game from their own computer.
  // pid: who they are in the online session; their keys arrive through
  // nethost.js, and what's meant for their screen goes back there (tell).
  // They start out watching until they're put in a team.
  addRemote(pid, name) {
    const p = new Player(this.newId(), name, false);
    p.remote = pid;
    p.ping = 0;
    p.hacks = noHacks();
    p.hackCfg = hackCfg(null);
    p.guns = { primary: forTeam(settings.guns.primary, null), secondary: forTeam(settings.guns.secondary, null) };
    p.spectator = true;
    if (this.bm) this.bm.onJoin(p);
    if (this.gg) this.gg.onJoin(p);
    this.makeModel(p, 'T');
    this.players.push(p);
    return p;
  }

  // someone leaves the match (a friend going, a bot making room): what they
  // carried falls where they stood
  removePlayer(p) {
    if (!this.players.includes(p)) return;
    if (p.alive) {
      this.dropOnDeath(p);
      p.alive = false;
    }
    this.scene.remove(p.model.root);
    p.model.dispose();
    this.players = this.players.filter((o) => o !== p);
    if (this.specTarget === p) this.specTarget = null;
    if (this.deathCam && this.deathCam.killer === p) this.deathCam.killer = null;
    if (this.roundBased()) this.checkRoundEnd();
    this.net?.rosterChanged();
  }

  // a player number nobody has (online they travel as one byte)
  newId() {
    const used = new Set(this.players.map((p) => p.id));
    let id = 1;
    while (used.has(id)) id++;
    return id;
  }

  // a bot name nobody in the match has yet
  botName() {
    const used = new Set(this.players.map((p) => p.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    return free.length ? free[(Math.random() * free.length) | 0] : 'Bot ' + this.newId();
  }

  // ---------- spawning ----------
  pickSpawn(p) {
    const list = this.ffa ? this.map.spawns.ffa : this.map.spawns[p.team];
    const alive = this.players.filter((o) => o !== p && o.alive);
    const free = list.filter((s) => alive.every((o) => Math.hypot(o.pos.x - s.x, o.pos.z - s.z) > 48));
    if (!free.length) return null;
    const enemies = alive.filter((o) => this.isEnemy(p, o));
    const scored = free.map((s) => {
      let d = Infinity;
      for (const e of enemies) d = Math.min(d, Math.hypot(e.pos.x - s.x, e.pos.z - s.z));
      return { s, d };
    }).sort((a, b) => b.d - a.d);
    const top = scored.slice(0, Math.max(1, Math.min(3, Math.ceil(scored.length / 2))));
    return top[(Math.random() * top.length) | 0].s;
  }

  // team used for gun restrictions (FFA has none)
  gunTeam(p) {
    return this.ffa ? null : p.team;
  }

  // keep: a bomb defusal survivor keeps their gear into the next round
  spawnPlayer(p, sp, keep = false) {
    sp = sp || this.pickSpawn(p);
    if (!sp) {
      p.respawnAt = this.time + 0.5;
      return;
    }
    p.pos.set(sp.x, (sp.y || 0) + 0.05, sp.z);
    p.prevPos.copy(p.pos);
    p.yaw = sp.yaw;
    p.pitch = 0;
    p.resetMovement();
    p.alive = true;
    p.health = 100;
    p.respawnAt = 0;
    p.blindUntil = 0;
    p.defusing = false;
    const mapGuns = this.mapGuns();
    if (this.gg) {
      this.gg.loadout(p);
    } else if (this.bm) {
      this.bm.loadout(p, keep);
    } else if (mapGuns) {
      this.mapLoadout(p, mapGuns, keep);
    } else {
      p.armor = 100;
      p.helmet = true;
      p.weapons = { 1: null, 2: null, 3: null, 4: null, 5: null };
      giveWeapon(p, 'knife');
      const team = this.gunTeam(p);
      let prim, sec;
      if (p.char) {
        // a Bot Arena character takes its favorite guns (a pistol player no rifle)
        prim = p.char.gun === 'none' ? null : forTeam(p.char.gun, team);
        sec = forTeam(p.char.pistol, team);
      } else if (p.isBot) {
        prim = weighted(BOT_PRIMARY, team);
        sec = weighted(BOT_PISTOL, team);
      } else {
        // a friend online picked theirs on their own computer
        const guns = p.remote != null ? p.guns : settings.guns;
        prim = forTeam(guns.primary, team);
        sec = forTeam(guns.secondary, team);
      }
      if (prim) giveWeapon(p, prim);
      giveWeapon(p, sec);
      giveGrenades(p, this.mode === 'classic' ? {} : DM_NADES);
      if (p.isBot && Math.random() < 0.5) {
        if (prim === 'm4a1') p.weapons[1].silenced = true;
        if (sec === 'usp') p.weapons[2].silenced = true;
      }
      p.slot = prim ? 1 : 2;
      p.lastSlot = prim ? 2 : 3;
    }
    if (p.isBot && this.bm && p.weapons[2] && p.weapons[2].id === 'usp' && Math.random() < 0.5) p.weapons[2].silenced = true;
    deploy(this, p);
    p.spawnTime = this.time;
    p.spawnProtectUntil = this.roundBased() ? 0 : this.time + SPAWN_PROTECT;
    p.hasCorpse = false;
    p.model.deadT = 0;
    if (p.brain) p.brain.reset();
    this.tell(p, 'spawned', p.spawnTime, p.yaw);
    if (!this.roundBased()) this.tell(p, 'sub', 'spawnProtection', SPAWN_PROTECT);
  }

  // the map's own gun rules; Gun Game switches them off (it hands out the guns)
  mapRules() {
    return this.gg ? {} : this.map.def.rules || {};
  }

  // how the map hands out guns: 'awp' (everyone gets an AWP), 'ground'
  // (pick them up off the floor) or null (the gun menu)
  mapGuns() {
    return this.mapRules().guns || null;
  }

  // awp_ maps: knife, pistol and an AWP every spawn. fy_ maps: knife and a
  // pistol, the rest lies on the ground (survivors of a round keep theirs).
  mapLoadout(p, kind, keep) {
    p.armor = 100;
    p.helmet = true;
    if (keep) {
      refillAmmo(p);
      // the best gun kept (a dropped pistol leaves slot 2 empty)
      p.slot = p.weapons[1] ? 1 : p.weapons[2] ? 2 : 3;
      p.lastSlot = p.slot === 1 && p.weapons[2] ? 2 : 3;
      return;
    }
    p.weapons = { 1: null, 2: null, 3: null, 4: null, 5: null };
    giveWeapon(p, 'knife');
    giveWeapon(p, (p.team || p.look) === 'CT' ? 'usp' : 'glock18');
    giveGrenades(p, {});
    if (kind === 'awp') giveWeapon(p, 'awp');
    p.slot = p.weapons[1] ? 1 : 2;
    p.lastSlot = p.weapons[1] ? 2 : 3;
  }

  giveLoadout(p, prim, sec) {
    giveWeapon(p, prim);
    giveWeapon(p, sec);
    p.slot = 0;
    selectSlot(this, p, 1);
    p.lastSlot = 2;
  }

  // ---------- weapon menu (VGUI window, free guns) ----------
  openGunMenu() {
    const h = this.human;
    if (!h || this.over) return;
    if (this.bm) {
      this.openBuyMenu();
      return;
    }
    if (this.gg) {
      this.hud.message(t('noGunMenuGg'), this.time, 4);
      return;
    }
    const mapGuns = this.mapGuns();
    if (mapGuns) {
      this.hud.message(t(mapGuns === 'awp' ? 'noGunMenuAwp' : 'noGunMenuGround'), this.time, 4);
      return;
    }
    // A menu opened at spawn (or shortly after) gives the guns as soon as you choose,
    // as long as you're still in that same life.
    const life = h.alive && this.time - h.spawnTime < 10 ? h.spawnTime : null;
    const team = this.gunTeam(h);
    this.pendingGunMenu = null;
    const shown = this.hooks.onGunMenu({
      team,
      current: { primary: forTeam(settings.guns.primary, team), secondary: forTeam(settings.guns.secondary, team) },
      nades: this.mode !== 'classic',
      onChoose: (primary, secondary) => {
        settings.guns.primary = primary;
        settings.guns.secondary = secondary;
        saveSettings();
        this.applyGunChoice(life);
      },
    });
    // another menu was open (e.g. ESC): offer it again when we get back into the game
    if (!shown && life != null) this.pendingGunMenu = life;
  }

  // bomb defusal: the 1.6 buy menu (only in the buy zone, during buy time)
  openBuyMenu() {
    const h = this.human, bm = this.bm;
    const blocked = bm.buyBlocked(h);
    if (blocked) {
      this.hud.message(t(blocked, { n: BUY_TIME }), this.time, 4);
      return;
    }
    this.buyMenuOpen = this.hooks.onGunMenu({
      buy: true,
      team: h.team,
      money: () => h.money,
      price: (id) => priceOf(id),
      // a friend online asks the host (which says why if it can't be bought)
      onBuy: (id) => (this.client ? this.client.buy(id) : bm.buy(h, id)),
    });
  }

  // the spawn weapon menu that couldn't open yet, if it's still useful
  reopenGunMenu() {
    const life = this.pendingGunMenu, h = this.human;
    this.pendingGunMenu = null;
    if (life == null || !h || !h.alive || h.spawnTime !== life || this.time - life >= 10 || this.over) return false;
    this.openGunMenu();
    return this.pendingGunMenu == null;
  }

  // the guns chosen in the menu: now if still in the life it was opened for,
  // else next spawn. p, guns: a friend's choice online (on the host's game)
  applyGunChoice(life, p = this.human, guns = settings.guns) {
    const h = p;
    if (!this.active || !h) return;
    if (this.client) {
      this.client.send({ t: 'guns', primary: guns.primary, secondary: guns.secondary, life });
      return;
    }
    const team = this.gunTeam(h);
    const prim = forTeam(guns.primary, team), sec = forTeam(guns.secondary, team);
    if (h.alive && life != null && h.spawnTime === life) {
      const w1 = h.weapons[1], w2 = h.weapons[2];
      if (!w1 || w1.id !== prim || !w2 || w2.id !== sec) this.giveLoadout(h, prim, sec);
    } else {
      this.tell(h, 'msg', 'gunsNextSpawn', 4);
    }
  }

  // ---------- rules ----------
  isEnemy(a, b) {
    if (a === b) return false;
    if (this.ffa) return true;
    return a.team !== b.team;
  }

  // classic and bomb defusal are played in rounds
  roundBased() {
    return this.mode === 'classic' || this.mode === 'bomb';
  }

  frozen() {
    return this.roundBased() && this.round.state === 'freeze';
  }

  startRound() {
    const r = this.round;
    r.n++;
    r.state = 'freeze';
    r.until = this.time + this.freezeTime;
    this.autoBalance(true);
    // a new round starts clean: no grenades or smoke left over, windows and crates whole again
    this.grenades.clear();
    this.map.resetBreakables();
    this.map.doors.reset();
    this.items.clear();
    this.net?.newRound();
    if (this.mapRules().groundGuns) this.items.placeMapGuns();
    if (this.bm) this.bm.roundStart();
    for (const team of ['T', 'CT']) {
      const spots = shuffle([...this.map.spawns[team]]);
      const members = this.players.filter((p) => p.team === team);
      const keepGear = !!this.bm || this.mapGuns() === 'ground';
      members.forEach((p, i) => {
        const keep = keepGear && p.alive;
        p.alive = false;
        this.spawnPlayer(p, spots[i % spots.length], keep);
      });
    }
    if (this.bm) this.bm.afterSpawn();
    if (this.recorder) this.recorder.roundStart();
    this.tellAll('center', ['roundN', { n: r.n }], Math.max(1.5, this.freezeTime));
    if (this.freezeTime > 0) this.tellAll('sub', 'freezeTime', this.freezeTime);
  }

  updateMode() {
    if (this.over) return;
    if (this.time >= this.matchEndsAt) {
      this.endMatch();
      return;
    }
    if (this.roundBased()) {
      const r = this.round;
      if (r.state === 'freeze' && this.time >= r.until) {
        r.state = 'live';
        r.endsAt = this.time + this.roundSeconds();
        this.tellAll('center', 'goGoGo', 1.5);
        this.globalSound('round_start');
        if (this.bm) this.tellAll('say', ['Go go go!', 'Lock and load.', 'Let\'s go.', 'Move out.'][(Math.random() * 4) | 0]);
      } else if (r.state === 'live') {
        // once the bomb is down the clock no longer matters
        if (this.bm && this.bm.planted) this.checkRoundEnd();
        else if (this.time >= r.endsAt) {
          if (this.bm) {
            this.tellAll('center', 'targetSaved', ROUND_END_DELAY);
            this.endRound('CT', 'saved');
          } else this.endRound(null);
        } else this.checkRoundEnd();
      } else if (r.state === 'end' && this.time >= r.until) {
        if (this.teamScore.T >= this.cfg.roundsToWin || this.teamScore.CT >= this.cfg.roundsToWin) this.endMatch();
        else {
          // Bot Arena: halfway (one round short of the win) the sides swap
          if (this.cfg.arena?.swapHalf && !this.swapped && r.n === this.cfg.roundsToWin - 1) this.swapSides();
          this.startRound();
        }
      }
    } else {
      if (this.time >= this.nextBalance) {
        this.nextBalance = this.time + 1;
        this.autoBalance(false);
      }
      for (const p of this.players) {
        if (!p.alive && p.respawnAt > 0 && this.time >= p.respawnAt && (p.team || this.ffa)) this.spawnPlayer(p);
      }
    }
  }

  // Bot Arena's half time: everyone changes team and starts over with the
  // start money and nothing bought (the score goes with them)
  swapSides() {
    this.swapped = true;
    for (const p of this.players) {
      if (!p.team) continue;
      p.team = p.team === 'T' ? 'CT' : 'T';
      // not killed, but the next round gives them a fresh start
      p.alive = false;
      p.hasCorpse = false;
      if (this.bm) this.bm.onJoin(p);
      this.makeModel(p, p.team);
      if (p.brain) p.brain.reset();
    }
    this.teamScore = { T: this.teamScore.CT, CT: this.teamScore.T };
    if (this.bm) this.bm.lossStreak = { T: 0, CT: 0 };
    this.tellAll('msg', 'switchSides', 5);
  }

  // round length: Create Game's choice, else the mode's own
  roundSeconds() {
    return this.cfg.roundTime > 0 ? this.cfg.roundTime * 60 : this.bm ? BOMB_ROUND_TIME : ROUND_TIME;
  }

  // 1.6 auto team balance: when one team has two or more players more, a bot
  // moves over (in rounds at the start of the next one, otherwise a bot
  // that's waiting to respawn)
  autoBalance(roundStart) {
    if (!this.cfg.autoBalance || this.ffa || !this.botsCreated) return;
    for (let n = 0; n < 16; n++) {
      const nT = this.players.filter((p) => p.team === 'T').length;
      const nCT = this.players.filter((p) => p.team === 'CT').length;
      if (Math.abs(nT - nCT) < 2) return;
      const from = nT > nCT ? 'T' : 'CT', to = from === 'T' ? 'CT' : 'T';
      const movable = this.players.filter((p) => p.isBot && p.team === from && (roundStart || !p.alive));
      if (!movable.length) return;
      const b = movable.sort((a, c) => a.score - c.score)[0];
      b.team = to;
      b.alive = false;
      b.hasCorpse = false;
      b.defuser = false;
      this.makeModel(b, to);
      b.brain.reset();
      if (!roundStart) b.respawnAt = Math.max(b.respawnAt, this.time + 0.5);
      this.tellAll('msg', ['autoBalanced', { name: b.name, team: [to === 'T' ? 'teamT' : 'teamCT'] }], 5);
      this.net?.rosterChanged();
    }
  }

  checkRoundEnd() {
    if (this.round.state !== 'live') return;
    // with nobody on one side (e.g. 0 bots) rounds only end on time
    if (!this.players.some((p) => p.team === 'T') || !this.players.some((p) => p.team === 'CT')) return;
    const aliveT = this.players.some((p) => p.alive && p.team === 'T');
    const aliveCT = this.players.some((p) => p.alive && p.team === 'CT');
    if (this.bm && this.bm.planted) {
      // after the plant only the bomb (or the last CT) decides it
      if (!aliveCT) this.endRound('T', 'elim');
      return;
    }
    if (!aliveT && !aliveCT) this.endRound(null);
    else if (!aliveT) this.endRound('CT');
    else if (!aliveCT) this.endRound('T');
  }

  // reason (bomb defusal): elim | bombed | defused | saved
  endRound(winner, reason = 'elim') {
    const r = this.round;
    if (r.state === 'end') return;
    r.state = 'end';
    r.until = this.time + ROUND_END_DELAY;
    if (winner) this.teamScore[winner]++;
    if (this.recorder) this.recorder.roundEnd(winner, reason);
    if (this.stats) {
      this.stats.round(winner);
      const w = winner && this.players.find((p) => p.team === winner && p.arenaSide != null);
      if (w) this.sideScore[w.arenaSide]++;
    }
    const text = reason === 'bombed' ? 'targetBombed' : reason === 'defused' ? 'bombDefused' : reason === 'saved' ? 'targetSaved'
      : winner === 'T' ? 'terroristsWin' : winner === 'CT' ? 'ctsWin' : 'roundDraw';
    this.tellAll('center', text, ROUND_END_DELAY);
    this.globalSound('round_start', { rate: 0.75 });
    if (this.bm) {
      this.bm.rewards(winner, reason);
      this.tellAll('say', winner === 'T' ? 'Terrorists win.' : winner === 'CT' ? 'Counter-Terrorists win.' : 'Round draw.');
    }
  }

  // a round event: big centre text and the radio voice
  announce(key, speech) {
    this.tellAll('center', key, 3);
    this.tellAll('say', speech);
  }

  checkLimits() {
    if (this.over) return;
    if (this.mode === 'tdm' && this.cfg.tdmLimit > 0) {
      if (this.teamScore.T >= this.cfg.tdmLimit || this.teamScore.CT >= this.cfg.tdmLimit) this.endMatch();
    } else if (this.mode === 'ffa' && this.cfg.ffaLimit > 0) {
      if (this.players.some((p) => p.score >= this.cfg.ffaLimit)) this.endMatch();
    }
  }

  endMatch() {
    this.over = true;
    // the title as a message, so friends online read it in their language
    let title;
    if (this.gg) {
      title = this.gg.matchTitle();
    } else if (this.mode === 'ffa') {
      const best = [...this.players].filter((p) => !p.spectator).sort((a, b) => b.score - a.score || a.deaths - b.deaths)[0];
      title = best ? ['playerWins', { name: best.name }] : 'draw';
    } else if (this.teamScore.T === this.teamScore.CT) {
      title = 'draw';
    } else {
      title = ['teamWins', { team: [this.teamScore.T > this.teamScore.CT ? 'teamT' : 'teamCT'] }];
    }
    this.net?.matchOver(title);
    this.hooks.onMatchEnd(tmsg(title), this.scoreboardHtml());
  }

  // ---------- main tick ----------
  tick(dt) {
    if (!this.active) return;
    // a friend online: the host's match, as it comes in
    if (this.client) {
      this.client.tick(dt);
      this.input.endTick();
      return;
    }
    // (hosting, the match goes on for the friends whatever we do)
    if (this.needsTeam() && !this.net) return;
    if (this.replay) {
      this.replay.tick(dt);
      this.input.endTick();
      return;
    }
    this.time += dt;
    if (this.timers.length) {
      const due = this.timers.filter((tm) => tm.at <= this.time);
      if (due.length) {
        this.timers = this.timers.filter((tm) => tm.at > this.time);
        for (const tm of due) tm.fn();
      }
    }
    if (this.over) return;
    this.updateMode();
    const frozen = this.frozen();
    const alive = this.players.filter((p) => p.alive);
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.remote != null) {
        // A friend's keys, one tick's worth each, as they arrive from their
        // computer (nethost.js): none yet, and they wait where they are; a
        // pile-up runs a few at once. Each comes with where they looked.
        for (const cmd of this.net.cmdsFor(p)) {
          if (!p.alive) break;
          p.yaw = cmd.yaw;
          p.pitch = cmd.pitch;
          this.playerTick(p, cmd, dt, alive, frozen);
        }
        continue;
      }
      this.playerTick(p, p.isBot ? p.brain.think(dt) : this.humanCmd(), dt, alive, frozen);
    }
    this.grenades.tick(dt);
    this.items.tick(dt);
    this.map.doors.update(dt, this);
    if (this.bm) this.bm.tick(dt);
    if (this.recorder) this.recorder.tick(dt);
    if (this.net) this.net.tick(dt);
    this.input.endTick();
  }

  // one player's tick with their keys: move, shoot, use, pick up
  playerTick(p, cmd, dt, alive, frozen) {
    if (p.hacking) hackCmd(this, p, cmd, dt);
    this.holdStill(p, cmd, frozen);
    if (cmd.slot) selectSlot(this, p, cmd.slot);
    if (cmd.cycleNade) cycleGrenade(this, p);
    const others = this.othersBuf;
    others.length = 0;
    for (const o of alive) if (o !== p && o.alive) others.push(o);
    p.prevPos.copy(p.pos);
    this.move(p, cmd, others, dt);
    if (p.moveEvents.landed > PM.maxSafeFallSpeed) this.fallDamage(p, p.moveEvents.landed);
    if (!p.alive) return;
    if (cmd.attack && p.spawnProtectUntil > this.time && this.time - p.spawnTime > 0.3) p.spawnProtectUntil = this.time;
    // a friend shoots at what their screen showed a moment ago (nethost.js)
    if (p.remote != null) this.net.lagComp(p, cmd, () => weaponTick(this, p, cmd));
    else weaponTick(this, p, cmd);
    if (!p.alive) return;
    if (p.hacks.norecoil) p.punchPitch = p.punchYaw = 0;
    this.useTick(p, cmd);
    this.items.playerTick(p, cmd);
    if (this.bm) this.bm.playerTick(p, cmd);
    this.stepSounds(p, dt);
    // DropPunchAngle
    const len = Math.hypot(p.punchPitch, p.punchYaw);
    if (len > 0) {
      const nl = Math.max(0, len - (10 + len * 0.5) * dt);
      p.punchPitch *= nl / len;
      p.punchYaw *= nl / len;
    }
    if (p.pos.y < (this.map.def.killY ?? -300)) this.killPlayer(p, null, 'world', false);
  }

  // freeze time and defusing keep a player where they are (defusing: hands
  // on the bomb)
  holdStill(p, cmd, frozen) {
    if (frozen) {
      cmd.forward = cmd.side = 0;
      cmd.jump = cmd.attack = cmd.attack2 = false;
    }
    if (p.defusing) {
      cmd.forward = cmd.side = 0;
      cmd.jump = cmd.attack = cmd.attack2 = false;
      cmd.slot = 0;
      p.vel.x = p.vel.z = 0;
    }
  }

  // one tick of a player's movement (a friend's game online runs this too
  // for their own player, so they move at once: netclient.js)
  move(p, cmd, others, dt) {
    // slowed down by being hit
    if (p.velMod < 1) {
      p.vel.x *= p.velMod;
      p.vel.z *= p.velMod;
      p.velMod = Math.min(1, p.velMod + 0.01);
    }
    // speedhack: their movement runs faster than the clock
    playerMove(p, cmd, this.world, others, p.hacks.speedhack ? dt * p.hackCfg.speed : dt);
  }

  // E: defuse the bomb, else open / close a door, else swap for the gun we look at
  useTick(p, cmd) {
    if (cmd.use && !p.oldUse) {
      if (!(this.bm && this.bm.tryDefuse(p)) && !this.map.doors.use(p, this)) this.items.use(p);
    }
    p.oldUse = cmd.use;
  }

  // what the dead leave on the ground
  dropOnDeath(p) {
    this.items.onDeath(p);
    if (this.bm) this.bm.onDeath(p);
  }

  humanCmd() {
    const cmd = blankCmd();
    const inp = this.input;
    if (!inp.locked || this.ui.isOpen()) return cmd;
    cmd.forward = (inp.isDown('forward') ? 1 : 0) - (inp.isDown('back') ? 1 : 0);
    cmd.side = (inp.isDown('moveright') ? 1 : 0) - (inp.isDown('moveleft') ? 1 : 0);
    cmd.jump = inp.isDown('jump');
    cmd.duck = inp.isDown('duck');
    cmd.walk = inp.isDown('walk');
    cmd.attack = inp.isDown('attack');
    cmd.attack2 = inp.isDown('attack2');
    cmd.reload = inp.isDown('reload');
    cmd.use = inp.isDown('use');
    cmd.slot = this.pendingSlot;
    cmd.cycleNade = this.pendingCycle;
    cmd.drop = this.pendingDrop;
    this.pendingSlot = 0;
    this.pendingCycle = false;
    this.pendingDrop = false;
    return cmd;
  }

  // Edge-triggered keys, once per frame.
  handleInput() {
    const h = this.human;
    if (!this.active || !h) {
      this.input.takePressed();
      return;
    }
    for (const code of this.input.takePressed()) {
      // the radio menu takes the number keys while it's open
      if (this.radio.menuOpen) {
        const m = /^(?:Digit|Numpad)(\d)$/.exec(code);
        if (m) {
          this.radio.choose(+m[1]);
          continue;
        }
      }
      for (const a of this.input.actionsFor(code)) {
        switch (a) {
          case 'slot1': case 'slot2': case 'slot3': case 'slot5':
            this.pendingSlot = +a.slice(4);
            break;
          case 'drop':
            if (this.items.enabled) this.pendingDrop = true;
            break;
          case 'autobuy': case 'rebuy':
            if (!this.bm || !h.alive) break;
            if (this.client) this.client.send({ t: a });
            else this.bm[a](h);
            break;
          case 'slot4':
            // pressing it again cycles through the grenade types
            if (h.slot === 4) this.pendingCycle = true;
            else this.pendingSlot = 4;
            break;
          case 'lastinv':
            this.pendingSlot = h.lastSlot;
            break;
          case 'invnext': case 'invprev': {
            const order = [1, 2, 3, 4, 5].filter((s) => h.weapons[s]);
            const i = order.indexOf(h.slot);
            if (i >= 0 && order.length > 1) this.pendingSlot = order[(i + (a === 'invnext' ? 1 : order.length - 1)) % order.length];
            break;
          }
          case 'chooseteam':
            // a watched Bot Arena match (or a replay) isn't ours to join
            if (!this.ffa && !this.over && !this.cfg.arena) this.hooks.onTeamMenu();
            break;
          case 'gunmenu':
            if (!this.over && !this.cfg.arena) this.openGunMenu();
            break;
          case 'attack': case 'attack2':
            // picking someone yourself turns the director off
            if (this.spectating()) {
              this.director = false;
              // a replay stops following its star
              if (this.replay) this.replay.follow = false;
              this.cycleSpectate(a === 'attack' ? 1 : -1);
              if (this.specMode === 'free') this.specMode = 'chase';
            }
            break;
          case 'jump':
            // spectating: the next view (chase, first person, free camera, overview)
            if (this.spectating()) this.nextSpecMode();
            break;
          case 'use':
            if (this.spectating()) {
              this.director = !this.director;
              this.dirNext = 0;
              // the director picks who to watch now, not the replay's star
              if (this.replay && this.director) this.replay.follow = false;
              if (this.director && this.specMode === 'free') this.specMode = 'chase';
            }
            break;
          case 'reload':
            if (this.spectating()) this.statsPanel = !this.statsPanel;
            break;
          case 'radio':
            if (!this.over && !this.cfg.arena) this.radio.toggleMenu();
            break;
        }
      }
    }
  }

  look(mx, my) {
    const h = this.human;
    // the free camera looks around with the mouse
    if (h && !h.alive && this.freeCam && this.specMode === 'free' && this.spectating()) {
      const sens = settings.sensitivity * 0.022 * DEG;
      const fc = this.freeCam;
      fc.yaw = wrap(fc.yaw - mx * sens);
      fc.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, fc.pitch - my * sens * (settings.invertMouse ? -1 : 1)));
      return;
    }
    if (!h || !h.alive || this.over) return;
    let sens = settings.sensitivity * 0.022 * DEG;
    const w = h.weapon;
    // zoom_sensitivity_ratio 1.2
    if (w && w.zoom) sens *= (zoomFov(w) / 90) * 1.2;
    h.yaw = wrap(h.yaw - mx * sens);
    h.pitch -= my * sens * (settings.invertMouse ? -1 : 1);
    const lim = 89 * DEG;
    h.pitch = Math.max(-lim, Math.min(lim, h.pitch));
  }

  // 1.6 fall damage: nothing below 580 units/s, certain death at 1024 (armor doesn't help)
  fallDamage(p, speed) {
    const dmg = Math.floor((speed - PM.maxSafeFallSpeed) * (100 / (PM.fatalFallSpeed - PM.maxSafeFallSpeed)) * 1.25);
    if (dmg <= 0) return;
    p.health -= dmg;
    p.punchPitch -= Math.min(10, speed * 0.013);
    this.sound('fallpain', p, 1);
    this.tell(p, 'hurt');
    if (p.health <= 0) this.killPlayer(p, null, 'world', false);
  }

  stepSounds(p, dt) {
    const ev = p.moveEvents;
    const wet = p.waterDepth > 4;
    if (wet && !p.wasWet && p.vel.y < -120) this.splash(p.pos.x, p.pos.y + p.waterDepth, p.pos.z, 1.4);
    p.wasWet = wet;
    if (ev.landed > 250) {
      this.sound(wet ? 'wade' : 'land', p, Math.min(1, ev.landed / 600));
      this.noise(p, 700);
    }
    if (ev.jumped) this.sound(wet ? 'wade' : this.stepSound(p), p, 0.8, 0, 200, 0.35);
    if (ev.ladder) {
      // hands and feet on the rungs
      if (Math.abs(p.vel.y) > 50) {
        p.stepAccum += dt;
        if (p.stepAccum >= 0.38) {
          p.stepAccum = 0;
          this.sound('ladder', p, 0.9, 0, 110, 0.4);
          this.noise(p, 800);
        }
      }
      return;
    }
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (p.onGround && ((speed > 150 && !p.ducked) || (wet && speed > 60))) {
      p.stepAccum += dt;
      if (p.stepAccum >= (wet ? 0.42 : 0.3)) {
        p.stepAccum = 0;
        if (wet) {
          // wading: splashes you can hear even when walking
          this.sound('wade', p, 0.9, 0, 120, 0.4);
          this.splash(p.pos.x, p.pos.y + p.waterDepth, p.pos.z, 0.5);
        } else this.sound(this.stepSound(p), p, 0.9, 0, 110, 0.32);
        this.noise(p, 900);
      }
    } else {
      p.stepAccum = 0.2;
    }
  }

  // footsteps sound like what we walk on: sand, concrete, metal, wood, grate, tile, grass
  stepSound(p) {
    const w = this.world;
    let hit = w.traceRay(p.pos.x, p.pos.y + 2, p.pos.z, 0, -1, 0, 20);
    // standing on an edge: look under the side of the feet that's over something
    if (!hit) {
      for (const [dx, dz] of [[12, 0], [-12, 0], [0, 12], [0, -12]]) {
        hit = w.traceRay(p.pos.x + dx, p.pos.y + 2, p.pos.z + dz, 0, -1, 0, 20);
        if (hit) break;
      }
    }
    return 'step_' + (hit ? STEP_KIND[hit.box.mat] || 'concrete' : 'concrete');
  }

  // water flying up where something hit the surface
  splash(x, y, z, size) {
    this.effects.splash({ x, y, z }, size);
  }

  // a bullet crossing a water surface on its way from a to b
  bulletWater(a, b) {
    for (const w of this.map.water) {
      const sy = w.max[1];
      if ((a.y - sy) * (b.y - sy) >= 0) continue;
      const k = (a.y - sy) / (a.y - b.y);
      const x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k;
      if (x < w.min[0] || x > w.max[0] || z < w.min[2] || z > w.max[2]) continue;
      this.effects.splash({ x, y: sy, z }, 0.7);
      if (Math.random() < 0.6) this.soundAt('imp_water', { x, y: sy, z }, 0.5, 140);
      return;
    }
  }

  // ---------- whose screen ----------
  // Online, the host's game runs everyone. What's meant for one player's
  // screen (a message, the red flash of a hit, the death camera) is shown
  // here when they're us, goes to their own game when they're a friend
  // (nethost.js), and is dropped for bots. Text travels as a message (tmsg)
  // so everyone reads it in their own language.
  tell(p, kind, ...args) {
    if (!p) return;
    if (p === this.human) this.show(kind, ...args);
    else if (p.remote != null && this.net) this.net.tell(p, kind, args);
  }

  // the same, for everyone's screen
  tellAll(kind, ...args) {
    this.show(kind, ...args);
    if (this.net) this.net.tellAll(kind, args);
  }

  // what each kind of tell does on this screen
  show(kind, ...a) {
    const h = this.human, hud = this.hud, now = this.time;
    if (!h) return;
    switch (kind) {
      case 'center': hud.centerPrint(tmsg(a[0]), now, a[1]); break;
      case 'sub': hud.subPrint(tmsg(a[0]), now, a[1]); break;
      case 'msg': hud.message(tmsg(a[0]), now, a[1]); break;
      case 'hack': hud.hackMessage(tmsg(a[0]), now); break;
      case 'say': radio.say(a[0]); break;            // the round announcer's voice
      case 'sound': this.soundSys.play(a[0], a[1]); break;
      case 'money': hud.moneyChange(a[0]); break;
      case 'hurt': hud.hurtFlash(); break;
      case 'damage': hud.damage(a[0]); break;
      case 'killed': {
        // we killed someone: "You killed X" and the kill sound
        const v = this.byId(a[0]);
        if (v) hud.killNotice(v, a[1], now);
        this.soundSys.play(a[1] ? 'kill_hs' : 'kill', { volume: 0.7 });
        break;
      }
      case 'died': {
        // the death camera turns to the killer (a[1], the gun: none for a team change)
        const killer = this.byId(a[0]);
        this.radio.closeMenu();
        h.diedAt = now;
        this.deathCam = { pos: h.pos.clone(), yaw: h.yaw, pitch: h.pitch, killer, start: now };
        if (a[1] == null) break;
        if (killer) hud.subPrint(t(a[2] ? 'killedByHs' : 'killedBy', { killer: killer.name, weapon: weaponName(a[1]) }), now, 4);
        else hud.subPrint(t('suicide'), now, 3);
        break;
      }
      case 'spawned':
        // a new life (a[0]: when it started, a[1]: where the spawn faces)
        h.spawnTime = a[0];
        h.yaw = a[1];
        h.pitch = 0;
        this.deathCam = null;
        this.specTarget = null;
        this.viewY = null;
        this.flashFx = null;
        if (!settings.guns.remember && !this.bm && !this.gg && !this.mapGuns()) this.openGunMenu();
        break;
      case 'watch':
        // on the Spectator team now
        this.deathCam = null;
        this.specTarget = null;
        this.radio.closeMenu();
        break;
      case 'ggUp':
        // Gun Game: up a level (a[0]: the knife level)
        if (this.gg) this.gg.upAt = now;
        this.soundSys.play('levelup', { volume: 0.6 });
        if (a[0]) hud.subPrint(t('ggKnifeLevel'), now, 3);
        break;
    }
  }

  byId(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  // ---------- services used by weapons.js and grenades.js ----------
  later(delay, fn) {
    this.timers.push({ at: this.time + delay, fn });
  }

  // A sound a player makes: whoever is that player hears it as their own
  // (no direction, at ownVolume), everyone else from where they are.
  sound(name, p, volume = 1, delay = 0, ref = 200, ownVolume = volume) {
    if (this.net) this.net.sound(name, p, volume, delay, ref, ownVolume);
    this.playerSound(name, p, volume, delay, ref, ownVolume);
  }

  playerSound(name, p, volume, delay, ref, ownVolume) {
    if (p === this.human || !p) this.soundSys.play(name, { volume: p ? ownVolume : volume, delay });
    else this.soundSys.play(name, { volume, delay, ref, pos: { x: p.pos.x, y: p.pos.y + 40, z: p.pos.z } });
  }

  weaponSound(p, name, silenced) {
    if (this.net) this.net.weaponSound(p, name, silenced);
    this.gunSound(p, name, silenced);
    this.noise(p, silenced ? 500 : 2800);
  }

  gunSound(p, name, silenced) {
    const reverb = silenced ? 0.05 : 0.22;
    if (p === this.human) this.soundSys.play(name, { volume: 0.85, rate: 0.97 + Math.random() * 0.06, reverb });
    else this.soundSys.play(name, { volume: 1, rate: 0.97 + Math.random() * 0.06, reverb, ref: silenced ? 150 : 450, pos: { x: p.pos.x, y: p.pos.y + 50, z: p.pos.z } });
  }

  // a sound everyone hears the same, from nowhere in particular (a round starting)
  globalSound(name, opts = {}) {
    if (this.net) this.net.globalSound(name, opts);
    this.soundSys.play(name, opts);
  }

  noise(src, radius) {
    this.noiseAt(src.pos, radius, src);
  }

  // let enemy bots within radius hear something at pos
  noiseAt(pos, radius, src) {
    for (const b of this.players) {
      if (!b.isBot || !b.alive || (src && !this.isEnemy(b, src))) continue;
      if (b.pos.distanceToSquared(pos) < radius * radius) b.brain.onNoise(pos, src);
    }
  }

  weaponEvent(p, type, arg) {
    if (this.recorder) this.recorder.weapon(p, type, arg);
    if (this.net) this.net.weaponEvent(p, type, arg);
    if (p === this.pov) {
      this.viewModel.play(type, this.time, arg);
      if (type === 'fire') this.hud.crossShot(CROSS[p.weapon.id]?.[1] ?? 3);
    } else if (type === 'fire') {
      if (!arg) p.model.showFlash();
      else p.model.recoil = 1;
    }
    // the body shows it too (reloads, throws, knife swings, planting)
    p.model.play(type, this.time, arg);
    if (type !== 'fire') return;
    const w = p.weapon;
    // three or more quick shots leave the barrel smoking for a while
    p.burstN = this.time - (p.lastShotAt ?? -9) < 0.3 ? (p.burstN || 0) + 1 : 1;
    p.lastShotAt = this.time;
    if (this.stats && p.burstN >= 3) this.stats.add(p, 'spray');
    if (p.burstN >= 3) {
      p.smokeLen = Math.min(2.6, 0.6 + p.burstN * 0.1);
      p.smokeUntil = this.time + p.smokeLen;
      p.smokeGun = w;
    }
    // muzzle-flash light on the world (not for silenced guns)
    if (!arg && w.def.type !== 'knife') {
      if (p === this.pov) {
        dirFromAngles(p.yaw, p.pitch, v1);
        this.effects.muzzleLight({ x: p.pos.x + v1.x * 30, y: p.pos.y + p.eyeHeight() + v1.y * 30, z: p.pos.z + v1.z * 30 });
      } else {
        this.effects.muzzleLight(p.model.worldPoint('muzzle', v1));
      }
    }
    if (w.def.boltAction || w.def.pump) {
      // bolt-action rifles drop the case when the bolt is worked, the M3 when it's pumped;
      // our own viewmodel animation does it for us
      if (p !== this.pov) this.later(w.def.pump ? 0.5 : 0.65, () => p.alive && p.weapon === w && this.ejectShell(p));
    } else if (w.def.type !== 'knife') {
      this.ejectShell(p);
    }
  }

  // smoke curling up from barrels that were just fired in a burst
  gunSmoke(dt, pov) {
    const cam = this.camera;
    for (const p of this.players) {
      if (!(p.smokeUntil > this.time)) continue;
      if (!p.alive || p.weapon !== p.smokeGun) {
        p.smokeUntil = 0;
        continue;
      }
      // not while still shooting: the muzzle flash covers it
      if (this.time - p.lastShotAt < 0.1) continue;
      p.smokeAcc = (p.smokeAcc || 0) + dt;
      if (p.smokeAcc < 0.035) continue;
      p.smokeAcc = 0;
      const pos = v4;
      if (p === pov) {
        if (!this.viewModel.muzzlePoint(pos)) continue;
        cam.updateMatrixWorld();
        pos.applyMatrix4(cam.matrixWorld);
      } else {
        if (p.pos.distanceToSquared(cam.position) > 2500 * 2500) continue;
        p.model.worldPoint('muzzle', pos);
      }
      this.effects.gunSmoke(pos, (p.smokeUntil - this.time) / p.smokeLen);
    }
  }

  ejectShell(p) {
    const w = p.weapon;
    if (!w) return;
    const ty = w.def.type;
    const kind = ty === 'pistol' ? 'pistol' : ty === 'shotgun' ? 'shotgun' : ty === 'sniper' ? 'awp' : 'rifle';
    const yaw = p.yaw;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const pos = new THREE.Vector3();
    if (p === this.pov) {
      // from the viewmodel's ejection port, taken into world space
      if (!this.viewModel.ejectPoint(pos)) return;
      this.camera.updateMatrixWorld();
      pos.applyMatrix4(this.camera.matrixWorld);
    } else {
      p.model.worldPoint('eject', pos);
    }
    const side = 70 + Math.random() * 40, upv = 60 + Math.random() * 40, fwd = (Math.random() - 0.6) * 25;
    const vel = new THREE.Vector3(rx * side + fx * fwd + p.vel.x, upv, rz * side + fz * fwd + p.vel.z);
    this.effects.shell(pos, vel, kind);
  }

  weaponMessage(p, key) {
    this.tell(p, 'msg', key, 3);
  }

  eye(p, out) {
    return out.set(p.pos.x, p.pos.y + p.eyeHeight(), p.pos.z);
  }

  throwGrenade(p, id, yaw, pitch, speed) {
    this.grenades.throw(p, id, yaw, pitch, speed);
    if (this.stats && p.alive) this.stats.add(p, 'nd');
    // a live grenade dropped by the dying says nothing
    if (p.alive) this.radio.say(p, 'fireInTheHole');
  }

  // flashbang: hold the white for `hold` seconds, then fade over `fade`
  blind(p, hold, fade, alpha) {
    if (this.recorder) this.recorder.blind(p, hold, fade, alpha);
    if (hold + fade < 0.05 || p.hacks.noflash) return;
    const now = this.time;
    if (p === this.human) this.whiteOut(hold, fade, alpha);
    // (everyone online gets it: whoever watches them in first person sees it too)
    if (this.net) this.net.blind(p, hold, fade, alpha);
    if (p.brain) p.brain.onBlind(now + hold + fade * (alpha >= 1 ? 0.5 : 0.25));
  }

  // the flashbang's white on our screen (a weaker one doesn't cut a strong one short)
  whiteOut(hold, fade, alpha) {
    const now = this.time, cur = this.flashFx;
    const left = cur ? this.flashAlpha() * (Math.max(0, cur.start + cur.hold - now) + cur.fade / 2) : 0;
    if (alpha * (hold + fade / 2) >= left) this.flashFx = { start: now, hold, fade, alpha };
  }

  flashAlpha() {
    const f = this.flashFx;
    if (!f) return 0;
    const t2 = this.time - f.start;
    if (t2 < f.hold) return f.alpha;
    const k = f.fade > 0 ? 1 - (t2 - f.hold) / f.fade : 0;
    if (k <= 0) {
      this.flashFx = null;
      return 0;
    }
    return f.alpha * k;
  }

  // screen shake for the human near an explosion
  shake(pos, radius) {
    const h = this.human;
    if (this.net) this.net.shake(pos, radius);
    if (!h) return;
    const d = this.camera.position.distanceTo(pos);
    const k = 1 - d / radius;
    if (k > 0) this.shakeAmp = Math.max(this.shakeAmp, k);
  }

  fireBullets(p, spread, dmg, rangeMod, def, pellet) {
    if (p.hacks.nospread) spread = 0;
    if (this.stats) this.stats.add(p, 'sh');
    const yaw = p.aimYaw(), pitch = p.aimPitch();
    const fwd = dirFromAngles(yaw, pitch, v1);
    const right = v2.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const up = v3.crossVectors(right, fwd);
    let x, y;
    do {
      x = Math.random() - 0.5 + Math.random() - 0.5;
      y = Math.random() - 0.5 + Math.random() - 0.5;
    } while (x * x + y * y > 1);
    const dir = new THREE.Vector3().copy(fwd).addScaledVector(right, x * spread).addScaledVector(up, y * spread).normalize();
    const start = this.eye(p, new THREE.Vector3());
    // buckshot doesn't go through anything and loses power quickly
    let traveled = 0, damage = dmg, pen = pellet ? 0 : def.penCount;
    const maxDist = pellet ? 3000 : 8192;
    const hitSet = new Set([p]);
    // where the bullet stops, for the tracer (into the sky: a long way off)
    const end = new THREE.Vector3().copy(start).addScaledVector(dir, 4000);
    for (let iter = 0; iter < 8 && traveled < maxDist; iter++) {
      const remain = maxDist - traveled;
      const wh = this.world.traceRay(start.x, start.y, start.z, dir.x, dir.y, dir.z, remain);
      const maxT = wh ? wh.t : remain;
      let bestT = maxT, bestP = null, bestG = null;
      for (const o of this.players) {
        if (!o.alive || hitSet.has(o)) continue;
        const r = rayVsPlayer(o, start.x, start.y, start.z, dir.x, dir.y, dir.z, bestT);
        if (r && r.t < bestT) { bestT = r.t; bestP = o; bestG = r.group; }
      }
      if (bestP) {
        const pt = start.clone().addScaledVector(dir, bestT);
        const dist = traveled + bestT;
        const hitDmg = pellet ? damage * Math.max(0.15, Math.min(1, 1 - (dist - 64) / 1600)) : damage * Math.pow(rangeMod, dist / 500);
        this.damagePlayer(bestP, p, hitDmg, def, bestG, dir, pt, false);
        hitSet.add(bestP);
        end.copy(pt);
        if (pen <= 0) break;
        pen--;
        damage *= 0.6;
        start.copy(pt).addScaledVector(dir, 1);
        traveled = dist + 1;
        continue;
      }
      if (!wh) {
        end.copy(start).addScaledVector(dir, Math.min(remain, 4000));
        break;
      }
      end.set(wh.x, wh.y, wh.z);
      const n = { x: wh.nx, y: wh.ny, z: wh.nz };
      const pt = { x: wh.x, y: wh.y, z: wh.z };
      if (wh.box.breakable) {
        // windows, vent covers and small crates take the hit (and may break)
        const hitDmg = pellet ? damage * Math.max(0.15, 1 - (traveled + wh.t - 64) / 1600) : damage * Math.pow(rangeMod, (traveled + wh.t) / 500);
        const broke = this.damageBreakable(wh.box, hitDmg, dir);
        if (wh.box.mat === 'glass' || broke) {
          // glass barely slows a bullet down
          if (!broke) this.effects.glassHit(pt, n);
          start.set(wh.x, wh.y, wh.z).addScaledVector(dir, wh.box.max[0] - wh.box.min[0] < 8 || wh.box.max[2] - wh.box.min[2] < 8 ? 6 : 1);
          traveled += wh.t + 1;
          damage *= 0.9;
          continue;
        }
      }
      if (pellet && Math.random() < 0.5) this.effects.decal(pt, n, wh.box.mat === 'crate' ? 'wood' : wh.box.mat === 'mcrate' || wh.box.mat === 'barrel' ? 'metal' : 'concrete');
      else this.effects.impact(pt, n, wh.box.mat);
      if (Math.random() < (pellet ? 0.08 : 0.35)) this.soundAt(IMPACT_SOUND[wh.box.mat] || 'imp_concrete', pt, 0.5, 120);
      if (Math.random() < (pellet ? 0.03 : 0.12)) this.soundAt('ric', pt, 0.6, 150);
      if (pen <= 0) break;
      const thick = this.world.exitDistance(wh.box, wh.x, wh.y, wh.z, dir.x, dir.y, dir.z);
      const power = def.penPower * (PENETRATION[wh.box.mat] ?? 0);
      if (thick > power) break;
      pen--;
      damage *= wh.box.mat === 'crate' ? 0.75 : 0.5;
      start.set(wh.x, wh.y, wh.z).addScaledVector(dir, thick + 0.5);
      traveled += wh.t + thick + 0.5;
      // exit hole
      const en = { x: wh.nx ? -wh.nx : 0, y: wh.ny ? -wh.ny : 0, z: wh.nz ? -wh.nz : 0 };
      if (thick > 0.5) this.effects.decal({ x: start.x - dir.x * 0.5, y: start.y - dir.y * 0.5, z: start.z - dir.z * 0.5 }, en);
    }
    this.bulletTracer(p, end);
    p.lastFightAt = this.time;
    if (!this.headless && this.specMode === 'overview' && !pellet) this.shotLines.push({ ax: p.pos.x, az: p.pos.z, bx: end.x, bz: end.z, team: p.team, t: this.time, p });
    // guns and the bomb lying in the bullet's path get knocked away
    if (this.items.list.length) {
      const from = this.eye(p, v4);
      this.items.bulletHit(from, dir, from.distanceTo(end), dmg);
    }
    if (this.map.water.length) this.bulletWater(this.eye(p, v4), end);
  }

  // a streak from the gun to where the bullet stopped
  bulletTracer(p, end) {
    if (this.recorder) this.recorder.shot(p, end);
    if (this.net) this.net.shot(p, end);
    if (!settings.tracers || this.headless) return;
    const from = v4;
    if (p === this.pov) {
      // our own gun: from the viewmodel's muzzle, taken into world space
      if (!this.viewModel.muzzlePoint(from)) return;
      this.camera.updateMatrixWorld();
      from.applyMatrix4(this.camera.matrixWorld);
    } else {
      p.model.worldPoint('muzzle', from);
    }
    this.effects.tracer(from, end);
  }

  // a sound from a place in the world
  soundAt(name, pos, volume, ref, reverb = 0) {
    if (this.net) this.net.soundAt(name, pos, volume, ref, reverb);
    this.soundSys.play(name, { volume, ref, pos, reverb });
  }

  // ---------- breakables ----------
  // returns true if it broke
  damageBreakable(box, dmg, dir) {
    if (!box.breakable || box.off) return false;
    box.hp -= dmg;
    if (box.hp > 0) return false;
    this.breakBox(box, dir);
    return true;
  }

  breakBox(box, dir) {
    if (this.recorder) this.recorder.brk(box, dir);
    if (this.net) this.net.brk(box, dir);
    box.off = true;
    if (box.piece) box.piece.mesh.visible = false;
    const kind = box.mat === 'glass' ? 'glass' : box.mat === 'grate' ? 'metal' : 'wood';
    this.effects.gibs(box, kind, dir);
    this.effects.clearDecalsIn(box);
    const c = new THREE.Vector3((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2);
    this.soundAt(kind === 'glass' ? 'glass_break' : kind === 'metal' ? 'metal_break' : 'wood_break', c, 1, 250, 0.2);
    this.noiseAt(c, 900, null);
    // whatever was resting on it falls
    for (const n of this.grenades.list) if (n.pos.x > box.min[0] - 4 && n.pos.x < box.max[0] + 4 && n.pos.z > box.min[2] - 4 && n.pos.z < box.max[2] + 4) n.onGround = false;
    this.items.unsettle(box);
  }

  // explosions break what's close
  breakAround(pos, radius, dmg) {
    for (const piece of this.map.breakables) {
      const b = piece.box;
      if (b.off) continue;
      const cx = Math.max(b.min[0], Math.min(pos.x, b.max[0])), cy = Math.max(b.min[1], Math.min(pos.y, b.max[1])), cz = Math.max(b.min[2], Math.min(pos.z, b.max[2]));
      const d = Math.hypot(cx - pos.x, cy - pos.y, cz - pos.z);
      if (d < radius) this.damageBreakable(b, dmg * (1 - d / radius), v1.set(cx - pos.x, cy - pos.y, cz - pos.z).normalize());
    }
  }

  meleeTrace(p, range) {
    const yaw = p.aimYaw(), pitch = p.aimPitch();
    const fwd = dirFromAngles(yaw, pitch, new THREE.Vector3());
    const eye = this.eye(p, new THREE.Vector3());
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const up = new THREE.Vector3().crossVectors(right, fwd);
    const wh = this.world.traceRay(eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, range);
    const limit = wh ? wh.t : range;
    const dirs = [fwd];
    for (const [a, b] of [[0.18, 0], [-0.18, 0], [0, 0.18], [0, -0.18]]) dirs.push(fwd.clone().addScaledVector(right, a).addScaledVector(up, b).normalize());
    for (const d of dirs) {
      let best = null;
      for (const o of this.players) {
        if (o === p || !o.alive) continue;
        const r = rayVsPlayer(o, eye.x, eye.y, eye.z, d.x, d.y, d.z, d === fwd ? limit : range);
        if (r && (!best || r.t < best.t)) best = { player: o, group: r.group, t: r.t };
      }
      if (best) return { player: best.player, group: best.group, dir: d, point: eye.clone().addScaledVector(d, best.t) };
    }
    if (wh) return { world: true, point: { x: wh.x, y: wh.y, z: wh.z }, normal: { x: wh.nx, y: wh.ny, z: wh.nz }, mat: wh.box.mat, box: wh.box };
    return null;
  }

  isBehind(attacker, victim) {
    const dx = victim.pos.x - attacker.pos.x, dz = victim.pos.z - attacker.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = -Math.sin(victim.yaw), fz = -Math.cos(victim.yaw);
    return (dx / len) * fx + (dz / len) * fz > 0.8;
  }

  damagePlayer(victim, attacker, rawDmg, def, group, dir, point, melee) {
    if (!victim.alive) return;
    const friendly = attacker && attacker !== victim && !this.isEnemy(attacker, victim);
    if (friendly && !this.cfg.friendlyFire) return;
    if (victim.isProtected(this.time)) {
      if (!melee) this.effects.impact(point, { x: -dir.x, y: -dir.y, z: -dir.z }, 'mcrate');
      return;
    }
    let dmg = rawDmg * (HITGROUP_MULT[group] ?? 1);
    // friendly fire, like 1.6: a teammate's bullets and knife do about a third (grenades hurt fully)
    if (friendly && def.id !== 'hegrenade') dmg *= 0.35;
    let helmetHit = false;
    if (victim.armor > 0 && group !== 'leg' && (group !== 'head' || victim.helmet)) {
      const ratio = def.armorRatio * 0.5, bonus = 0.5;
      let nd = dmg * ratio;
      let ad = (dmg - nd) * bonus;
      if (ad > victim.armor) {
        ad = victim.armor * (1 / bonus);
        nd = dmg - ad;
        victim.armor = 0;
      } else {
        victim.armor -= ad;
      }
      dmg = nd;
      helmetHit = group === 'head';
    }
    dmg = Math.floor(dmg);
    if (this.stats) this.stats.hit(attacker, victim, Math.min(dmg, Math.max(0, victim.health)), !melee && def.type !== 'grenade' && def.id !== 'c4');
    victim.health -= dmg;
    // Bot Arena characters who play for the team come to help
    if (attacker && attacker !== victim && this.isEnemy(attacker, victim)) {
      for (const o of this.players) {
        if (o.brain && o !== victim && o.alive && !this.isEnemy(o, victim) && o.pos.distanceToSquared(victim.pos) < 1500 * 1500) o.brain.onMateHit(victim);
      }
    }
    victim.velMod = 0.65;
    victim.lastDamageTime = this.time;
    victim.lastFightAt = this.time;
    this.effects.blood(point, dir, group === 'head' ? 1.4 : 1);
    victim.model.flinch(dir, victim.yaw, group === 'head');
    if (this.net) this.net.flinch(victim, dir, group === 'head');
    if (helmetHit) this.soundAt('hit_helmet', point, 0.9, 250);
    else this.soundAt('hit_flesh', point, 0.8, 160);
    if (victim.brain) victim.brain.onDamaged(attacker);
    if (attacker && attacker !== victim && !victim.isBot) {
      const dx = attacker.pos.x - victim.pos.x, dz = attacker.pos.z - victim.pos.z;
      const rel = wrap(Math.atan2(-dx, -dz) - victim.yaw);
      const side = Math.abs(rel) < Math.PI / 4 ? 'front' : Math.abs(rel) > (Math.PI * 3) / 4 ? 'back' : rel > 0 ? 'left' : 'right';
      this.tell(victim, 'damage', side);
    }
    if (victim.health <= 0) this.killPlayer(victim, attacker, def.id, group === 'head', dir);
  }

  killPlayer(victim, attacker, weaponId, headshot, dir) {
    if (!victim.alive) return;
    if (this.recorder) this.recorder.kill(victim, attacker, weaponId, headshot, dir);
    if (this.net) this.net.kill(victim, attacker, weaponId, headshot, dir, !!attacker && attacker !== victim && attacker.hacking);
    // a grenade with its pin pulled drops live, like in 1.6
    const held = victim.weapon;
    if (held && held.def.type === 'grenade' && held.pin) this.throwGrenade(victim, held.id, victim.yaw, -1.2, 40);
    victim.alive = false;
    victim.health = 0;
    victim.deaths++;
    victim.diedAt = this.time;
    victim.killer = attacker;
    victim.hasCorpse = true;
    const enemyKill = !!attacker && attacker !== victim && this.isEnemy(attacker, victim);
    if (enemyKill) attacker.lastKillAt = this.time;
    if (!this.headless) this.deathMarks.push({ x: victim.pos.x, z: victim.pos.z, team: victim.team, t: this.time });
    // hacker mode: kills made with a hack on are marked (and counted on the scoreboard)
    const hackKill = !!attacker && attacker !== victim && attacker.hacking;
    if (this.stats) this.stats.kill(attacker, victim, weaponId, headshot, hackKill);
    if (enemyKill) {
      attacker.kills++;
      if (hackKill) attacker.hackKills++;
      attacker.score++;
      if (attacker.arenaSide != null && !this.roundBased()) this.sideScore[attacker.arenaSide]++;
      if (this.mode === 'tdm') this.teamScore[attacker.team]++;
      if (attacker.brain) attacker.brain.onKill(victim);
    } else if (attacker && attacker !== victim) {
      attacker.score--; // a teammate
    } else if (weaponId !== 'c4') {
      victim.score--;
    }
    if (this.bm) this.bm.onKill(attacker, victim);
    if (this.gg) this.gg.onKill(attacker, victim, weaponId);
    this.dropOnDeath(victim);
    this.hud.kill({ killer: attacker, victim, weapon: weaponId, headshot, hack: hackKill }, this.time, this.human);
    if (enemyKill) this.tell(attacker, 'killed', victim.id, headshot);
    // fall away from the shot
    if (dir) {
      const fx = -Math.sin(victim.yaw), fz = -Math.cos(victim.yaw);
      victim.model.fallDir = dir.x * fx + dir.z * fz < 0 ? 1 : -1;
      victim.model.fallSide = (Math.random() - 0.5) * 0.6;
    }
    this.sound('death', victim, 0.8);
    if (victim.brain) victim.brain.reset();
    victim.model.setGlow(0);
    this.tell(victim, 'died', attacker && attacker !== victim ? attacker.id : -1, weaponId, headshot);
    if (this.roundBased()) this.checkRoundEnd();
    else {
      victim.respawnAt = this.time + RESPAWN_DELAY + (victim.isBot ? Math.random() * 0.8 : 0);
      this.checkLimits();
    }
  }

  roamPoint(p) {
    const nav = this.map.nav, sd = this.map.sides;
    if (this.ffa || !p.team || !sd) return nav.randomPoint(Math.random);
    // head for the enemy's half or the middle of the map
    const enemySide = sd[p.team === 'T' ? 'CT' : 'T'];
    const r = Math.random();
    if (r < 0.5) return nav.randomPoint(Math.random, (q) => q[sd.axis] * enemySide > 200);
    if (r < 0.8) return nav.randomPoint(Math.random, (q) => Math.abs(q[sd.axis]) < sd.mid);
    return nav.randomPoint(Math.random);
  }

  // dead and past the death cam (or on the Spectator team): watching someone
  spectating() {
    const h = this.human;
    if (!h || h.alive || this.over || this.needsTeam()) return false;
    return !(this.deathCam && (!this.roundBased() || this.time - h.diedAt < 2.5));
  }

  // the dead watch their teammates (or everyone, when Create Game says so);
  // spectators watch anyone
  canWatch(p) {
    const h = this.human;
    return p.alive && p !== h && (this.seesAll() || this.ffa || p.team === h.team);
  }

  // may we see the enemies too? (spectators always; the dead when Create Game allows)
  seesAll() {
    const h = this.human;
    return !!h && (h.spectator || this.ffa || this.cfg.deadView === 'all');
  }

  specModes() {
    // the free camera would show the dead where the enemies are
    return this.seesAll() ? ['chase', 'eye', 'free', 'overview'] : ['chase', 'eye', 'overview'];
  }

  nextSpecMode() {
    const ms = this.specModes();
    this.specMode = ms[(ms.indexOf(this.specMode) + 1) % ms.length];
    // the free camera starts where the camera is now
    if (this.specMode === 'free') {
      const c = this.camera;
      this.freeCam = { pos: c.position.clone(), yaw: c.rotation.y, pitch: Math.max(-1.4, Math.min(1.4, c.rotation.x)) };
      this.director = false;
    }
  }

  // The director: every half second, who's worth watching? Someone in a fight,
  // who just got a kill, planting or defusing, carrying the bomb onto a site,
  // the last one alive on a team. It stays a few seconds on someone.
  direct() {
    if (this.time < this.dirNext) return;
    this.dirNext = this.time + 0.5;
    const pool = this.players.filter((p) => this.canWatch(p));
    if (!pool.length) return;
    const cur = this.specTarget && this.canWatch(this.specTarget) ? this.specTarget : null;
    const score = (p) => {
      let s = Math.random() * 4;
      if (this.time - (p.lastFightAt ?? -99) < 2) s += 50;
      if (this.time - (p.lastKillAt ?? -99) < 3) s += 30;
      if (p.brain && p.brain.target) s += 20;
      const w = p.weapon;
      if (p.defusing || (w && w.def.type === 'c4' && w.arming)) s += 60;
      if (this.bm && p.weapons[5] && this.bm.siteAt(p.pos)) s += 30;
      if (p.team && this.players.filter((o) => o.alive && o.team === p.team).length === 1) s += 25;
      if (p === cur) s += 15;
      return s;
    };
    let best = null, bs = -1;
    for (const p of pool) {
      const sc = score(p);
      if (sc > bs) { bs = sc; best = p; }
    }
    if (!cur || (best !== cur && bs > score(cur) + 10 && this.time - this.dirSince > 2.5)) {
      if (best !== this.specTarget) this.dirSince = this.time;
      this.specTarget = best;
    }
  }

  // flying about (no walls): WASD along the view, Shift faster
  freeCamMove(dt) {
    const fc = this.freeCam, inp = this.input;
    const f = (inp.isDown('forward') ? 1 : 0) - (inp.isDown('back') ? 1 : 0);
    const r = (inp.isDown('moveright') ? 1 : 0) - (inp.isDown('moveleft') ? 1 : 0);
    if (!f && !r) return;
    const speed = inp.isDown('walk') ? 1300 : 500;
    const fwd = dirFromAngles(fc.yaw, fc.pitch, v1);
    fc.pos.addScaledVector(fwd, f * speed * dt);
    fc.pos.x += Math.cos(fc.yaw) * r * speed * dt;
    fc.pos.z -= Math.sin(fc.yaw) * r * speed * dt;
  }

  // what the overview map shows (only teammates for the dead, unless they may see all)
  overviewData(target) {
    const all = this.seesAll(), h = this.human;
    const shown = (p) => all || p.team === h.team;
    const now = this.time;
    this.shotLines = this.shotLines.filter((l) => now - l.t < 0.35 && now >= l.t);
    this.deathMarks = this.deathMarks.filter((d) => now - d.t < 15 && now >= d.t);
    const bomb = this.bm && (all || h.team === 'T') ? this.bm.bombRadar() : null;
    return {
      map: this.map, now, target,
      players: this.players.filter((p) => p.alive && shown(p)).map((p) => ({
        x: p.pos.x, z: p.pos.z, yaw: p.yaw, team: p.team, name: p.name, hp: p.health,
        mark: p.char ? p.char.color : null, hack: p.hacking, me: p === target,
      })),
      shots: this.shotLines.filter((l) => shown(l.p)).map((l) => ({ ...l, p: undefined, k: 1 - (now - l.t) / 0.35 })),
      deaths: this.deathMarks.filter((d) => all || d.team === h.team),
      smokes: this.grenades.clouds.filter((c) => c.alpha > 0.1).map((c) => ({ x: c.center.x, z: c.center.z, r: c.radius, a: c.alpha })),
      bomb: bomb && { x: bomb.pos.x, z: bomb.pos.z, planted: !!bomb.planted },
    };
  }

  // the live stats panel: everyone, by team (health and guns only of who we may see)
  panelRows() {
    const all = this.seesAll(), h = this.human;
    const ratings = this.cfg.arena ? new Map(this.cfg.arena.players.map((e) => [e.ch.id, e.r])) : null;
    const rows = this.players.filter((p) => p !== h || p.alive).map((p) => {
      const see = all || p.team === h.team || p === h;
      return {
        name: p.name, team: p.team, mark: p.char ? p.char.color : null, hack: p.hacking, alive: p.alive,
        k: p.kills, d: p.deaths, score: p.score, hp: see && p.alive ? Math.ceil(p.health) : null,
        gun: see && p.alive && p.weapon ? weaponName(p.weapon.id) : '', money: see && this.bm ? p.money : null,
        rating: ratings && p.char ? ratings.get(p.char.id) : null, watched: p === this.specTarget,
      };
    });
    const order = { CT: 0, T: 1 };
    rows.sort((a, b) => (order[a.team] ?? 2) - (order[b.team] ?? 2) || b.score - a.score || a.d - b.d);
    return rows;
  }

  cycleSpectate(dir = 1) {
    const h = this.human;
    if (!h || h.alive) return;
    const pool = this.players.filter((p) => this.canWatch(p));
    if (!pool.length) {
      this.specTarget = null;
      return;
    }
    const i = pool.indexOf(this.specTarget);
    this.specTarget = pool[i < 0 ? (dir > 0 ? 0 : pool.length - 1) : (i + dir + pool.length) % pool.length];
  }

  // ---------- hacker mode ----------
  // Switch one hack for a player (only when the match allows hacks). Everyone
  // is told: a few quick switches make one chat line (see flushHackNews).
  setHack(p, key, on) {
    if (!this.cfg || !this.cfg.hacks || !HACKS.includes(key)) return false;
    on = !!on;
    if (!!p.hacks[key] === on) return true;
    if (!p.hackNews) p.hackNews = { before: { ...p.hacks }, at: 0 };
    p.hackNews.at = performance.now();
    p.hacks[key] = on;
    p.hacking = isHacking(p);
    if (!on && key === 'triggerbot') p.trigSince = 0;
    if (this.net) this.net.hacksChanged(p);
    return true;
  }

  // the aimbot / triggerbot / speed sliders
  setHackCfg(p, cfg) {
    p.hackCfg = hackCfg(cfg);
  }

  // "Viper turned on: Wallhack, Aimbot" once a player has stopped switching
  // (now: also what's waiting, e.g. when the hack menu closes)
  flushHackNews(now = false) {
    const wall = performance.now();
    for (const p of this.players) {
      const n = p.hackNews;
      if (!n || (!now && wall - n.at < 700)) continue;
      p.hackNews = null;
      const on = HACKS.filter((k) => p.hacks[k] && !n.before[k]);
      const off = HACKS.filter((k) => !p.hacks[k] && n.before[k]);
      // (a list of messages: everyone online reads it in their own language)
      const list = (ks) => (ks.length === HACKS.length ? ['allHacks'] : ks.map((k) => ['hack_' + k]));
      if (on.length) this.tellAll('hack', ['hackOn', { name: p.name, list: list(on) }]);
      if (off.length) this.tellAll('hack', ['hackOff', { name: p.name, list: list(off) }]);
    }
  }

  // whose hacks the picture shows: ours while alive; when watching someone,
  // theirs if Options say so (never, in first person, or always)
  viewHacks(target, pov) {
    const h = this.human;
    if (!this.cfg.hacks) return NO_HACKS;
    if (h.alive) return h.hacks;
    if (!target) return NO_HACKS;
    const sv = settings.hackSpecView;
    return sv === 'all' || (sv === 'eye' && pov === target) ? target.hacks : NO_HACKS;
  }

  // ESP: name, health, gun and distance over everyone else, walls or not
  espList(viewer, pov) {
    const cam = this.camera, out = [];
    cam.updateMatrixWorld();
    const W = window.innerWidth, H = window.innerHeight;
    for (const p of this.players) {
      if (!p.alive || p === pov || p === viewer) continue;
      const m = p.model.root.position;
      v1.set(m.x, m.y + p.height() + 10, m.z).applyMatrix4(cam.matrixWorldInverse);
      if (v1.z > -8) continue; // behind us
      v1.applyMatrix4(cam.projectionMatrix);
      if (Math.abs(v1.x) > 1.2 || Math.abs(v1.y) > 1.2) continue;
      out.push({
        x: (v1.x * 0.5 + 0.5) * W, y: (-v1.y * 0.5 + 0.5) * H,
        name: p.name, team: p.team, hack: p.hacking, hp: Math.ceil(p.health),
        gun: p.weapon ? weaponName(p.weapon.id) : '',
        dist: Math.round(p.pos.distanceTo(cam.position) * 0.0254),
      });
    }
    return out;
  }

  // the spectator line: who we watch, the view, and the keys
  specLine(s) {
    const parts = [];
    const a = this.cfg.arena;
    const speed = this.watchSpeed ? Math.round(this.watchSpeed * 100) / 100 + '×' : t('watchPaused');
    if (a && a.replay) parts.push(t('replayLine', { what: a.title, speed }));
    else if (a) parts.push(t('watchLine', { fight: t('fight_' + a.type), map: this.map.name, speed }));
    if (s && this.specMode !== 'free') parts.push(t('spectating', { name: s.name + (s.hacking ? ' ' + t('hackTag') : '') }) + '  ·  ' + Math.ceil(s.health) + ' HP');
    parts.push(t('specMode_' + this.specMode) + (this.director ? ' · ' + t('specDirectorOn') : ''));
    return parts.join('  ·  ') + '\n' + t(this.specMode === 'free' ? 'specHintFree' : 'specHint2') + (a ? '   ' + t('watchHint') : '');
  }

  // ---------- highlight replays ----------
  // Play a recorded highlight (highlights.js) on this map: we watch, the
  // players are puppets of the recording (replay.js). title: what it is.
  startReplay(clip, title) {
    this.stop();
    const mode = clip.mode;
    this.cfg = {
      map: clip.map, mode, hacks: false, friendlyFire: false, roundsToWin: 99, freezeTime: 0, timeLimit: 0, deadView: 'all',
      arena: { type: clip.type, players: [], replay: true, title },
    };
    this.mode = mode;
    this.ffa = mode === 'ffa';
    this.time = clip.t0;
    this.over = false;
    this.teamScore = { T: 0, CT: 0 };
    this.matchEndsAt = clip.matchEndsAt || Infinity;
    this.freezeTime = 0;
    this.round = { n: clip.round || 1, state: 'live', until: 0, endsAt: clip.roundEndsAt || Infinity };
    this.botsCreated = true;
    this.director = false;
    this.statsPanel = false;
    this.specMode = 'eye';
    this.freeCam = null;
    this.shotLines = [];
    this.deathMarks = [];
    this.watchSpeed = 1;
    this.stats = null;
    this.sideScore = [0, 0];
    this.swapped = false;
    this.bm = null;
    this.gg = null;
    this.map.resetBreakables();
    this.map.doors.reset();
    this.items.clear();
    const h = new Player(0, 'Player', false);
    h.hacks = noHacks();
    h.hackCfg = hackCfg(settings.hackCfg);
    h.model = this.makeModel(h, 'T');
    h.spectator = true;
    h.team = null;
    this.human = h;
    this.players = [h];
    this.active = true;
    this.radio.reset();
    this.effects.clear();
    this.hud.clearFeed();
    this.hud.setVisible(true);
    this.replay = new ReplayPlayer(this, clip);
    this.specTarget = this.replay.star.alive ? this.replay.star : null;
    this.hud.centerPrint(title, this.time, 3);
  }

  // ---------- online, a friend's game ----------
  // The host's match shown here: netclient.js makes the players and moves
  // them as the host says; our keys go to the host. client: the NetClient
  // (its cfg is the host's match settings).
  startClient(client) {
    this.stop();
    const cfg = client.cfg;
    this.cfg = cfg;
    this.mode = cfg.mode;
    this.ffa = cfg.mode === 'ffa' || (cfg.mode === 'gungame' && !cfg.ggTeams);
    this.time = 0;
    this.over = false;
    this.teamScore = { T: 0, CT: 0 };
    this.matchEndsAt = Infinity;
    this.freezeTime = cfg.freezeTime ?? FREEZE_TIME;
    this.round = { n: 0, state: 'wait', until: 0, endsAt: 0 };
    this.botsCreated = true;
    this.director = false;
    this.statsPanel = false;
    this.specMode = 'chase';
    this.freeCam = null;
    this.shotLines = [];
    this.deathMarks = [];
    this.watchSpeed = 1;
    this.stats = null;
    this.sideScore = [0, 0];
    this.swapped = false;
    // the bomb and Gun Game only keep what the host tells about them here
    this.bm = this.mode === 'bomb' ? new BombMode(this) : null;
    this.gg = this.mode === 'gungame' ? new GunGame(this) : null;
    this.map.resetBreakables();
    this.map.doors.reset();
    this.items.clear();
    this.items.enabled = !!this.bm || !!this.mapRules().drops;
    this.players = [];
    this.human = null;
    this.active = true;
    this.radio.reset();
    this.effects.clear();
    this.hud.clearFeed();
    this.hud.setVisible(true);
    this.client = client;
    client.attach(this);
  }

  // ---------- Bot Arena ----------
  // How the match went: who won (a side, or the order in free-for-all) and
  // what each character did.
  arenaResult() {
    const a = this.cfg.arena, st = this.stats;
    const chars = this.players.filter((p) => p.char);
    const players = chars.map((p) => ({ cid: p.char.id, side: p.arenaSide ?? null, ...st.of(p) }));
    if (a.type === 'ffa') {
      const order = [...chars].sort((x, y) => y.score - x.score || x.deaths - y.deaths).map((p) => p.char.id);
      return { time: this.time, winner: null, order, score: null, rounds: 0, players };
    }
    const score = [...this.sideScore];
    const winner = score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : null;
    return { time: this.time, winner, order: null, score, rounds: this.round.n, players };
  }

  // ---------- presentation ----------
  scoreboardHtml() {
    // Terrorists see who has the bomb
    const bombTag = (p) => (this.bm && p.weapons[5] && p.alive && p.team === 'T' && this.human.team === 'T' ? ` <em class="bomb">${t('bombCarrier')}</em>` : '');
    // Gun Game: everyone's level and gun
    const gg = this.gg;
    const lvCell = (p) => (gg ? `<td>${gg.boardCell(p)}</td>` : '');
    // hacker mode: a [HACK] tag while they hack, and how many kills they made hacking
    const hk = !!this.cfg.hacks;
    const hackTag = (p) => (p.hacking ? ` <em class="hk">${escapeHtml(t('hackTag'))}</em>` : '');
    const hkCell = (p) => (hk ? `<td class="${p.hackKills ? 'hk' : ''}">${p.hackKills}</td>` : '');
    const row = (p) => `<tr class="${p === this.human ? 'me' : ''}${p.alive ? '' : ' dead'}"><td>${escapeHtml(p.name)}${hackTag(p)}${p.alive ? '' : ` <em>${t('dead')}</em>`}${bombTag(p)}</td>${lvCell(p)}<td>${p.score}</td><td>${p.deaths}</td>${hkCell(p)}<td>${p.isBot ? 'BOT' : Math.round(p.ping || 0)}</td></tr>`;
    const head = `<tr><th>${t('name')}</th>${gg ? `<th>${t('ggLevelCol')}</th>` : ''}<th>${t('score')}</th><th>${t('deaths')}</th>${hk ? `<th>${t('hackKillsCol')}</th>` : ''}<th>${t('latency')}</th></tr>`;
    const sort = gg ? GunGame.sort : (a, b) => b.score - a.score || a.deaths - b.deaths;
    const modeName = t('mode_' + this.mode) + (gg ? ` · ${t(this.ffa ? 'ggFfa' : 'ggTeams')}` : '');
    let html = `<div class="sb-title">${escapeHtml(this.map.name)} — ${escapeHtml(modeName)}</div>`;
    if (this.ffa) {
      const ps = this.players.filter((p) => !p.spectator).sort(sort);
      html += `<div class="sb-team ffa"><div class="sb-head"><span>${t('players')}</span><span>${t('playersCount', { n: ps.length })}</span></div><table>${head}${ps.map(row).join('')}</table></div>`;
    } else {
      for (const team of ['CT', 'T']) {
        const ps = this.players.filter((p) => p.team === team).sort(sort);
        html += `<div class="sb-team ${team.toLowerCase()}"><div class="sb-head"><span>${t(team === 'T' ? 'teamT' : 'teamCT')}</span><span class="sb-score">${gg ? '' : this.teamScore[team]}</span><span>${t('playersCount', { n: ps.length })}</span></div><table>${head}${ps.map(row).join('')}</table></div>`;
      }
    }
    const specs = this.players.filter((p) => p.spectator);
    if (specs.length) html += `<div class="sb-spec">${t('spectators')}: ${specs.map((p) => escapeHtml(p.name)).join(', ')}</div>`;
    return html;
  }

  topCenterHtml() {
    if (this.gg) return this.gg.hudHtml(this.human);
    if (this.mode === 'ffa') {
      const lead = [...this.players].sort((a, b) => b.score - a.score)[0];
      const lim = this.cfg.ffaLimit ? ` / ${this.cfg.ffaLimit}` : '';
      return `<span class="tc-me">${t('you')}: ${this.human.score}</span><span class="tc-sep">|</span><span>${t('leader')}: ${escapeHtml(lead.name)} ${lead.score}${lim}</span>`;
    }
    const lim = this.mode === 'tdm' && this.cfg.tdmLimit ? `<span class="tc-lim">${this.cfg.tdmLimit}</span>` : this.roundBased() ? `<span class="tc-lim">${this.cfg.roundsToWin}</span>` : '';
    return `<span class="tc-ct">CT ${this.teamScore.CT}</span><span class="tc-sep">:</span><span class="tc-t">${this.teamScore.T} T</span>${lim}`;
  }

  hudTimer() {
    if (this.roundBased()) {
      const r = this.round;
      // 1.6: once the bomb is planted the clock goes away; listen to the beeps
      if (this.bm && this.bm.planted) return null;
      if (r.state === 'freeze') return r.until - this.time;
      if (r.state === 'live') return r.endsAt - this.time;
      return 0;
    }
    return this.matchEndsAt === Infinity ? null : this.matchEndsAt - this.time;
  }

  render(alpha, dt) {
    const h = this.human;
    if (!this.active || !h) return;
    const cam = this.camera;
    this.map.update(dt);
    cam.rotation.order = 'YXZ';

    // looking out of our own dead eyes: our body isn't drawn
    const ownEyes = !h.alive && this.deathCam && (!this.roundBased() || this.time - h.diedAt < 2.5);
    // spectating: keep watching someone we're allowed to (the director may pick)
    const spec = this.spectating();
    if (spec && !this.specModes().includes(this.specMode)) this.specMode = 'chase';
    if (spec && this.director && this.specMode !== 'free') this.direct();
    if (spec && (!this.specTarget || !this.canWatch(this.specTarget))) {
      this.specTarget = null;
      this.cycleSpectate(1);
    }
    const target = spec ? this.specTarget : null;
    const free = spec && this.specMode === 'free';
    const overview = spec && this.specMode === 'overview';
    // whose eyes the camera is in (their body isn't drawn, their gun is the viewmodel)
    const pov = h.alive ? h : target && this.specMode === 'eye' ? target : null;
    this.pov = pov;
    // hacker mode: the hacks that change what we see, and whose side they take
    const vh = this.viewHacks(target, pov);
    const viewer = h.alive ? h : target;
    this.flushHackNews();
    hackPulse(0.75 + 0.25 * Math.sin(this.time * 5));
    for (const p of this.players) {
      const m = p.model;
      const ix = p.prevPos.x + (p.pos.x - p.prevPos.x) * alpha;
      const iy = p.prevPos.y + (p.pos.y - p.prevPos.y) * alpha;
      const iz = p.prevPos.z + (p.pos.z - p.prevPos.z) * alpha;
      m.root.position.set(ix, iy, iz);
      if (p.alive) m.root.rotation.y = p.yaw;
      const w = p.weapon;
      if (w) m.setWeapon(w.id, w.silenced);
      m.setBomb(p.alive && !!p.weapons[5] && (!w || w.id !== 'c4'));
      m.setGlow(p.alive && p.isProtected(this.time) ? (p.look === 'T' ? 0x401808 : 0x0a1a40) : 0);
      m.update({
        dt, now: this.time, speed: Math.hypot(p.vel.x, p.vel.z), vx: p.vel.x, vz: p.vel.z, yaw: p.yaw, duck: p.duckAmount(), pitch: p.pitch,
        onGround: p.onGround, alive: p.alive, pinOut: !!(w && w.pin), defusing: !!p.defusing,
      });
      m.root.visible = p.alive ? p !== pov : p.hasCorpse && !(p === h && ownEyes);
      if (m.root.visible) m.setLight(this.lightLevel(ix, iy + 1, iz));
      // wallhack: hidden bodies in red (enemies) or blue (teammates); hackers glow red
      m.setChams(vh.wallhack && p.alive && p !== viewer ? (viewer && !this.isEnemy(viewer, p) ? TEAM_CHAMS : ENEMY_CHAMS) : 0, iy + 1.5);
      m.setHackGlow(p.alive && !!p.hacking);
    }
    // no smoke: clouds are only a faint haze
    this.grenades.seeThrough = vh.nosmoke;
    this.grenades.render(dt, alpha);
    // (a friend's game online gets the guns' turning from the host)
    if (!this.client) this.items.render(dt);
    if (this.bm) {
      this.bm.render();
      // the buy menu closes when you leave the buy zone or buy time runs out
      if (this.buyMenuOpen && this.hooks.isGunMenuOpen() && this.bm.buyBlocked(h)) this.hooks.closeGunMenu();
    }

    let fovDeg = 90;
    let statusText = '', statusColor = '';
    const w = pov ? pov.weapon : null;
    if (h.alive) {
      h.model.root.visible = false;
      const ix = h.prevPos.x + (h.pos.x - h.prevPos.x) * alpha;
      const iy = h.prevPos.y + (h.pos.y - h.prevPos.y) * alpha;
      const iz = h.prevPos.z + (h.pos.z - h.prevPos.z) * alpha;
      let eyeY = iy + h.eyeHeight();
      // smooth out stair steps and unducking
      if (this.viewY == null || Math.abs(eyeY - this.viewY) > 40) this.viewY = eyeY;
      else this.viewY += (eyeY - this.viewY) * Math.min(1, dt * 18);
      eyeY = h.onGround ? this.viewY : eyeY;
      if (!h.onGround) this.viewY = eyeY;
      const bob = this.calcBob(dt, h);
      cam.position.set(ix, eyeY + bob, iz);
      cam.rotation.set(h.pitch + h.punchPitch * DEG, h.yaw + h.punchYaw * DEG, 0);
      this.viewModel.setLight(this.lightLevel(ix, iy + 1, iz));
      fovDeg = zoomFov(w);
      // who are we looking at? (not through smoke)
      const fwd = dirFromAngles(h.aimYaw(), h.aimPitch(), v1);
      const wh = this.world.traceRay(cam.position.x, cam.position.y, cam.position.z, fwd.x, fwd.y, fwd.z, 3000);
      let best = null, bt = wh ? wh.t : 3000;
      for (const o of this.players) {
        if (o === h || !o.alive) continue;
        const r = rayVsPlayer(o, cam.position.x, cam.position.y, cam.position.z, fwd.x, fwd.y, fwd.z, bt);
        if (r) { bt = r.t; best = o; }
      }
      if (best && !h.hacks.nosmoke && this.grenades.blocks(cam.position.x, cam.position.y, cam.position.z, best.pos.x, best.pos.y + 50, best.pos.z)) best = null;
      if (best) {
        const tag = best.hacking ? ' ' + t('hackTag') : '';
        if (this.isEnemy(h, best)) {
          statusText = `${t('enemy')}: ${best.name}${tag}`;
          statusColor = '#ff6a4a';
        } else {
          statusText = `${t('friend')}: ${best.name}${tag}   ${t('health')}: ${Math.ceil(best.health)}%`;
          statusColor = '#9ec9ff';
        }
      }
      this.hud.setSpec('');
    } else if (this.deathCam && (!this.roundBased() || this.time - h.diedAt < 2.5)) {
      const dc = this.deathCam;
      const k = Math.min(1, (this.time - dc.start) / 0.6);
      const e = 1 - (1 - k) ** 2;
      cam.position.set(dc.pos.x, dc.pos.y + HULL.eyeStand + (14 - HULL.eyeStand) * e, dc.pos.z);
      let yaw = dc.yaw, pitch = dc.pitch;
      if (dc.killer && dc.killer.alive) {
        const dx = dc.killer.pos.x - cam.position.x, dy = dc.killer.pos.y + 50 - cam.position.y, dz = dc.killer.pos.z - cam.position.z;
        const ty = Math.atan2(-dx, -dz), tp = Math.atan2(dy, Math.hypot(dx, dz));
        yaw = dc.yaw + wrap(ty - dc.yaw) * e;
        pitch = dc.pitch + (tp - dc.pitch) * e;
      }
      cam.rotation.set(pitch, yaw, 0.35 * e);
      if (!this.roundBased() && h.respawnAt > 0) {
        const left = Math.max(0, Math.ceil(h.respawnAt - this.time));
        this.hud.setSpec(left > 0 ? t('respawnIn', { n: left }) : '');
      } else this.hud.setSpec('');
    } else if (free) {
      // the free camera
      if (!this.freeCam) this.freeCam = { pos: cam.position.clone(), yaw: cam.rotation.y, pitch: 0 };
      this.freeCamMove(this.frameDt);
      cam.position.copy(this.freeCam.pos);
      cam.rotation.set(this.freeCam.pitch, this.freeCam.yaw, 0);
      this.hud.setSpec(this.specLine(null));
    } else if (target) {
      const s = target;
      const ix = s.prevPos.x + (s.pos.x - s.prevPos.x) * alpha;
      const iy = s.prevPos.y + (s.pos.y - s.prevPos.y) * alpha;
      const iz = s.prevPos.z + (s.pos.z - s.prevPos.z) * alpha;
      if (pov === s) {
        // first person: their view, their gun and crosshair
        cam.position.set(ix, iy + s.eyeHeight() + this.calcBob(dt, s), iz);
        cam.rotation.set(s.pitch + s.punchPitch * DEG, s.yaw + s.punchYaw * DEG, 0);
        this.viewModel.setLight(this.lightLevel(ix, iy + 1, iz));
        fovDeg = zoomFov(s.weapon);
      } else {
        // chase cam: behind and a little above them
        const ey = iy + s.eyeHeight() + 20;
        const camPitch = Math.min(0.3, Math.max(-0.5, s.pitch * 0.5)) - 0.18;
        const back = dirFromAngles(s.yaw, camPitch, v2).negate();
        const tr = this.world.traceRay(ix, ey, iz, back.x, back.y, back.z, 120);
        const d = tr ? Math.max(8, tr.t - 6) : 120;
        cam.position.set(ix + back.x * d, ey + back.y * d, iz + back.z * d);
        cam.rotation.set(camPitch, s.yaw, 0);
      }
      this.hud.setSpec(this.specLine(s));
    } else {
      // nobody to watch: a view over the map
      const mc = this.map.menuCam;
      if (mc.pan) {
        cam.position.set(mc.from[0], mc.from[1], mc.from[2]);
        cam.lookAt(mc.look[0], mc.look[1], mc.look[2]);
      } else {
        cam.position.set(mc.x + mc.rx * 0.8, mc.h, mc.z + mc.rz * 0.6);
        cam.lookAt(mc.x, mc.y, mc.z);
      }
      this.hud.setSpec(spec ? (this.cfg.arena ? this.specLine(null) + '\n' : '') + t('specNobody') : '');
    }
    // the overview map instead of the 3D view (main.js skips drawing the world)
    this.skip3D = overview;
    this.hud.drawOverview(overview ? this.overviewData(target) : null);
    // the stats panel, a few times a second
    const wall = performance.now();
    if (!(spec && this.statsPanel)) this.hud.setPanel(null);
    else if (wall >= this.panelAt) {
      this.panelAt = wall + 250;
      this.hud.setPanel(this.panelRows(), this.bm ? 'money' : null, !!this.cfg.arena);
    }
    // explosions nearby shake the view
    if (this.shakeAmp > 0) {
      const a = this.shakeAmp;
      cam.position.x += (Math.random() - 0.5) * a * 3;
      cam.position.y += (Math.random() - 0.5) * a * 3;
      cam.rotation.x += (Math.random() - 0.5) * a * 0.02;
      cam.rotation.z += (Math.random() - 0.5) * a * 0.02;
      this.shakeAmp = Math.max(0, a - dt * 1.2);
    }
    const vf = vfov(fovDeg);
    if (cam.fov !== vf) {
      cam.fov = vf;
      cam.updateProjectionMatrix();
    }

    // viewmodel: the gun of whoever's eyes we're in
    const vm = this.viewModel;
    const scoped = !!(pov && w && w.def.scope && w.zoom);
    if (pov && w) {
      const key = w.id + '|' + pov.look + '|' + w.silenced;
      if (key !== this.lastVm) {
        vm.setWeapon(w.id, pov.look, w.silenced);
        this.lastVm = key;
      }
    }
    vm.update({
      dt, now: this.time, bob: this.bob, punchPitch: pov ? pov.punchPitch : 0, punchYaw: pov ? pov.punchYaw : 0,
      visible: !!pov && !!w && !scoped, clipEmpty: !!(w && w.def.type === 'pistol' && w.clip === 0),
      sgReload: !!(w && w.def.type === 'shotgun' && w.reloading), pinOut: !!(w && w.pin), nadeGone: !!(w && w.redeployAt),
    });

    // HUD
    let gap = 0;
    if (pov && w) {
      const speed = Math.hypot(pov.vel.x, pov.vel.z);
      gap = (CROSS[w.id] || [4, 3])[0];
      if (!pov.onGround) gap *= 2;
      else if (pov.ducked) gap *= 0.5;
      else if (speed > 140) gap *= 1.5;
    }
    const nade = !!(w && w.def.type === 'grenade');
    this.hud.update({
      alive: h.alive,
      health: h.health,
      armor: h.armor,
      helmet: h.helmet,
      specEye: !h.alive && !!pov,
      clip: w ? (nade ? pov.nades[w.id] || 0 : w.clip) : 0,
      reserve: w && !nade ? w.reserve : null,
      showAmmo: h.alive && w && w.def.type !== 'knife',
      timer: this.hudTimer(),
      crossGap: gap,
      // sniper rifles have no crosshair in 1.6
      showCross: !(w && w.def.scope),
      scoped,
      flash: vh.noflash ? 0 : this.flashAlpha(),
      // the grey screen inside smoke; it thickens as the puffs in front of the
      // eyes fade out (grenades.render), so nothing shows through
      smoke: vh.nosmoke ? this.grenades.inside(cam.position.x, cam.position.y, cam.position.z) * 0.1
        : 1 - (1 - this.grenades.inside(cam.position.x, cam.position.y, cam.position.z) * 0.96) * (1 - 0.9 * this.grenades.veil ** 2),
      statusText,
      statusColor,
    }, dt, this.time);
    this.hud.setTopCenter(this.topCenterHtml());
    this.hud.setBombHud(this.bm && h.alive ? this.bm.hudState(h) : null, this.bm && h.team ? h.money : null);
    // the radar follows whoever we watch (a spectator sees that player's team)
    const viewTeam = h.alive || !target ? h.team : target.team;
    const radarBomb = this.bm && viewTeam === 'T' ? this.bm.bombRadar() : null;
    // the radar hack shows everyone
    this.hud.drawRadar(h.alive ? h : target, this.players, (p) => vh.radar || (!this.ffa && p.team === viewTeam), h.alive ? h.yaw : target ? target.yaw : 0, dt, radarBomb, this.time);
    this.hud.drawEsp(vh.esp ? this.espList(viewer, pov) : null);
    this.radio.render();
    // rebuild the scoreboard a few times a second at most while TAB is held
    const showBoard = this.input.isDown('scores') && !this.over;
    this.boardTimer = (this.boardTimer || 0) - dt;
    if (!showBoard) {
      if (this.boardShown) this.hud.showScoreboard(false);
      this.boardShown = false;
    } else if (!this.boardShown || this.boardTimer <= 0) {
      this.hud.showScoreboard(true, this.scoreboardHtml());
      this.boardShown = true;
      this.boardTimer = 0.25;
    }

    if (dt > 0) this.gunSmoke(dt, pov);

    // listener at the camera
    const f = dirFromAngles(cam.rotation.y, cam.rotation.x, v3);
    this.soundSys.setListener(cam.position.x, cam.position.y, cam.position.z, f.x, f.y, f.z);
  }
}


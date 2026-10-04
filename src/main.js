// Entry point: renderer, main loop, pointer lock / fullscreen and menu wiring.

import * as THREE from '../lib/three.module.js';
import { TICK, vfov } from './config.js';
import { setLang, t } from './i18n.js';
import { settings } from './settings.js';
import { Input } from './input.js';
import { createTextures } from './textures.js';
import { SoundSystem } from './audio.js';
import { MenuMusic, Ambience } from './ambient.js';
import { buildMap, mapPreview, MAPS } from './map.js';
import { Effects } from './effects.js';
import { Hud } from './hud.js';
import { ViewModel } from './models.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { radio } from './radio.js';
import { loadStore, snapshot } from './arena.js';
import { fixComps } from './league.js';
import { Recorder } from './highlights.js';
import { loadClip, removeClip } from './clipstore.js';
import { ArenaRunner } from './arenarun.js';
import { ArenaScreens } from './arenaui.js';
import { OnlineScreens } from './onlineui.js';
import { NetHost } from './nethost.js';
import { NetClient } from './netclient.js';
import { hackCfg, isHacking } from './hacks.js';
import { hasTeams } from './settings.js';

setLang(settings.lang);

// Graphics quality presets
const QUALITY = {
  low: { pixelRatio: 0.7, aa: false, aniso: 1, effects: 0.5, smoke: false, dlights: false },
  // no antialiasing: on built-in graphics it doubled the time to draw a frame
  medium: { pixelRatio: 1, aa: false, aniso: 4, effects: 1, smoke: true, dlights: true },
  high: { pixelRatio: Math.min(window.devicePixelRatio || 1, 2), aa: true, aniso: 8, effects: 1, smoke: true, dlights: true },
};
const quality = () => QUALITY[settings.quality] || QUALITY.medium;

let renderer = null;
let canvas = null;
function createRenderer() {
  const q = quality();
  const r = new THREE.WebGLRenderer({ antialias: q.aa, powerPreference: 'high-performance' });
  r.setPixelRatio(q.pixelRatio);
  r.setSize(window.innerWidth, window.innerHeight);
  r.autoClear = false;
  r.userData = { aa: q.aa };
  const host = document.getElementById('game');
  if (renderer) {
    host.removeChild(renderer.domElement);
    renderer.dispose();
    renderer.forceContextLoss();
  }
  host.appendChild(r.domElement);
  renderer = r;
  canvas = r.domElement;
  canvas.addEventListener('click', onCanvasClick);
  if (window.cs16) window.cs16.renderer = r;
}
createRenderer();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9dbfdf);
const camera = new THREE.PerspectiveCamera(vfov(90), window.innerWidth / window.innerHeight, 2, 12000);
camera.rotation.order = 'YXZ';

// Gamma and brightness work like a monitor's picture controls on the finished
// 3D frame: it's copied and drawn again through the curve. The HUD and menus
// are HTML on top, so they keep their colors. At the defaults nothing extra is
// drawn.
const picture = {
  scene: new THREE.Scene(),
  camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
  size: new THREE.Vector2(),
  frame: null,
  mat: new THREE.ShaderMaterial({
    uniforms: { frame: { value: null }, gamma: { value: 1 }, bright: { value: 1 }, knee: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D frame;
      uniform float gamma, bright, knee;
      varying vec2 vUv;
      void main() {
        vec3 c = pow(texture2D(frame, vUv).rgb, vec3(gamma)) * bright;
        // past the knee, bright colors bend smoothly up to white instead of clipping
        vec3 over = max(c - knee, 0.0);
        c = min(c, vec3(knee)) + (1.0 - knee) * (1.0 - exp(-over / (1.0 - knee)));
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  }),
};
{
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), picture.mat);
  quad.frustumCulled = false;
  picture.scene.add(quad);
}
function drawPicture() {
  const g = settings.gamma, b = settings.brightness;
  if (Math.abs(g - 1) < 0.001 && Math.abs(b - 1) < 0.001) return;
  const { x: w, y: h } = renderer.getDrawingBufferSize(picture.size);
  if (!picture.frame || picture.frame.image.width !== w || picture.frame.image.height !== h) {
    if (picture.frame) picture.frame.dispose();
    picture.frame = new THREE.FramebufferTexture(w, h);
    picture.mat.uniforms.frame.value = picture.frame;
  }
  renderer.copyFramebufferToTexture(picture.frame);
  const u = picture.mat.uniforms;
  u.gamma.value = Math.pow(3, 1 - g); // 1.5 lifts the shadows a lot, 0.5 deepens them
  u.bright.value = b;
  u.knee.value = b > 1 ? 1 - (b - 1) * 0.5 : 0.999;
  renderer.render(picture.scene, picture.camera);
}

const textures = createTextures();
let map = buildMap(MAPS[settings.match.map] ? settings.match.map : 'de_dunetown', scene, textures);
const effects = new Effects(scene, textures, map);
effects.camera = camera;
const soundSys = new SoundSystem();
soundSys.volume = settings.volume;
radio.attach(soundSys);
const music = new MenuMusic(soundSys);
const ambience = new Ambience(soundSys);
// browsers only allow sound after a click or key press: the first one starts it
// (and the menu music with it)
function wakeSound() {
  soundSys.init();
  soundSys.resume();
}
window.addEventListener('pointerdown', wakeSound, true);
window.addEventListener('keydown', wakeSound, true);
const input = new Input(canvas);
const hud = new Hud(document.getElementById('hud'));
const viewModel = new ViewModel(textures);

// Antialiasing can only change with a new renderer; the rest applies live.
function applyQuality() {
  const q = quality();
  if (renderer.userData.aa !== q.aa) {
    createRenderer();
    // a new renderer compiles its shaders again: do it now, not mid-fight
    if (game.active && game.botsCreated) game.prewarm(renderer);
    else renderer.compile(scene, camera);
  } else renderer.setPixelRatio(q.pixelRatio);
  effects.setQuality(q);
  game.grenades.setQuality(q);
  for (const tx of Object.values(textures)) {
    if (tx.anisotropy !== q.aniso) {
      tx.anisotropy = q.aniso;
      tx.needsUpdate = true;
    }
  }
}

function plainLock() {
  try {
    const r = canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => {});
  } catch { /* pointerlockerror shows the menu again */ }
}

function lockPointer() {
  try {
    const r = canvas.requestPointerLock(settings.rawInput ? { unadjustedMovement: true } : undefined);
    if (r && r.catch) r.catch((e) => { if (e && e.name === 'NotSupportedError') plainLock(); });
  } catch {
    plainLock();
  }
}

function enterPlay() {
  soundSys.init();
  soundSys.resume();
  ui.hideAll();
  input.clear();
  input.gameActive = true;
  lockPointer();
  if (settings.fullscreen && !document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => {
        // Keyboard lock keeps Ctrl+W / Ctrl+T etc. inside the game (Chrome, Edge)
        if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock().catch(() => {});
        if (!input.locked && !ui.isOpen()) lockPointer();
      })
      .catch(() => {});
  }
}

function leaveFullscreen() {
  if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function releasePointer() {
  if (document.pointerLockElement) document.exitPointerLock();
}

// Swap the loaded map (the old one's meshes and lightmap are freed).
function loadMap(name) {
  if (map.name === name) return;
  map.dispose();
  map = buildMap(name, scene, textures);
  effects.setMap(map);
  game.setMap(map);
  renderer.compile(scene, camera);
}

// Building a big map takes a moment: show a loading screen first.
function withLoading(name, fn) {
  if (map.name === name) {
    fn();
    return;
  }
  const el = document.createElement('div');
  el.id = 'boot';
  el.innerHTML = `<div class="boot-box"><div class="boot-title">${name}</div><div class="boot-text">${t('loadingMap')}</div></div>`;
  document.body.append(el);
  // let the browser paint it before the work starts (a hidden tab paints
  // nothing, and an online match can't wait for it: a timer goes too)
  let started = false;
  const go = () => {
    if (started) return;
    started = true;
    setTimeout(() => {
      try {
        loadMap(name);
      } finally {
        el.remove();
      }
      fn();
    }, 30);
  };
  requestAnimationFrame(go);
  setTimeout(go, 250);
}

// Bot Arena characters for Create Game's bot slots: the ones ticked there
// (in random order), then the save's others, then plain bots
function pickChars(cfg) {
  const bc = cfg.botChars;
  const save = bc && bc.save && arenaStore.saves.find((s) => s.id === bc.save);
  if (!save) return null;
  const n = hasTeams(cfg) ? (cfg.botsT || 0) + (cfg.botsCT || 0) : cfg.bots || 0;
  const live = save.chars.filter((c) => !c.retired);
  const mix = (a) => a.map((x) => [Math.random(), x]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  const ticked = mix(live.filter((c) => !bc.pick || bc.pick.includes(c.id)));
  const rest = mix(live.filter((c) => !ticked.includes(c)));
  // shuffled once more so the ticked ones don't all end up on the side filled first
  return mix([...ticked, ...rest].slice(0, n)).map(snapshot);
}

// Bot Arena: how fast the watched match plays (0.25x to 4x, or paused)
const WATCH_SPEEDS = [0.25, 0.5, 1, 2, 4];
let watchRate = 1;
let watchPaused = false;
// the highlight being replayed, and the list it's from (Next plays the next one)
let replayClip = null;
let replayList = null;
const watching = () => !!(game.active && game.cfg && game.cfg.arena);
// online: 'host' or 'client' while in an online match
const onlineRole = () => (game.active ? (game.net ? 'host' : game.client ? 'client' : null) : null);
// a friend's match being loaded (its messages wait in it), and the host's
// trip back to the lobby after a match
let netClient = null;
let lobbyTimer = 0;
const LOBBY_AFTER = 20; // seconds the final scoreboard shows online

// out of a match, back to the main menu
function leaveMatch() {
  clearTimeout(lobbyTimer);
  netClient = null;
  radio.cancel();
  game.stop();
  input.gameActive = false;
  releasePointer();
  leaveFullscreen();
  ui.showMain(false);
  // a Bot Arena battle that waited for the match goes on
  if (runner.autoPaused) runner.resume();
}

const handlers = {
  start(cfg) {
    // a Bot Arena battle in the background would slow the game down: it waits
    if (runner.state === 'running') runner.pause(true);
    cfg = { ...cfg, chars: cfg.arena ? null : pickChars(cfg) };
    soundSys.init();
    soundSys.resume();
    ui.hideAll();
    withLoading(cfg.map, () => {
      // the rest of the sounds and the map's ambience are made behind the loading screen
      soundSys.finish();
      ambience.update(map.def.ambience);
      game.start(cfg);
      if (game.needsTeam()) ui.showTeamSelect(false);
      else {
        game.prewarm(renderer);
        enterPlay();
      }
    });
  },
  resume() {
    if (!game.active) return;
    if (game.needsTeam()) {
      ui.showTeamSelect(false);
      return;
    }
    // a spawn weapon menu that waited for us opens instead of grabbing the mouse
    ui.hideAll();
    if (game.reopenGunMenu()) return;
    enterPlay();
  },
  disconnect() {
    // online: the host ends the match for everyone (after asking), a friend goes back to the lobby
    if (game.net && !game.over) {
      ui.confirm(t('onlEndMatch'), t('onlEndMatchAsk'), t('onlEndMatch'), () => handlers.onlineToLobby());
      return;
    }
    if (game.net) {
      handlers.onlineToLobby();
      return;
    }
    if (game.client || netClient) {
      game.client?.send({ t: 'leave' });
      leaveMatch();
      onlineUI.open('lobby');
      return;
    }
    // leaving a watched Bot Arena match before the end: it doesn't count
    // (and a bet on it comes back)
    const arena = watching();
    const replay = !!game.replay;
    if (arena && !game.over && !replay) {
      runner.dropLive();
      arenaUI.liveOver(null);
    }
    radio.cancel();
    game.stop();
    // the background gets all its threads back
    runner.setWatching(false);
    input.gameActive = false;
    releasePointer();
    leaveFullscreen();
    ui.showMain(false);
    if (replay) arenaUI.openClips();
    else if (arena) arenaUI.open(arenaUI.watchTab || 'battle');
    else if (runner.autoPaused) runner.resume();
  },
  // ---------- Bot Arena ----------
  arena: () => arenaUI.open(),
  online: () => onlineUI.open(),
  onlineRole,
  // ---------- online ----------
  // the host starts the match from the lobby (everyone in the lobby comes along)
  startOnline(session) {
    if (runner.state === 'running') runner.pause(true);
    const cfg = { ...structuredClone(settings.onlineMatch), online: true };
    // Bot Arena characters for the bots' places (when the lobby picked a save)
    const chars = pickChars({ ...cfg, botsT: cfg.fill, botsCT: cfg.fill, bots: cfg.fill }) || [];
    soundSys.init();
    soundSys.resume();
    ui.hideAll();
    withLoading(cfg.map, () => {
      soundSys.finish();
      ambience.update(map.def.ambience);
      game.start(cfg);
      game.net = new NetHost(game, session, chars);
      game.net.begin();
      game.prewarm(renderer);
      enterPlay();
    });
  },
  // a friend's game: the host started the match (or let us into the running one)
  joinOnline(session, start) {
    if (runner.state === 'running') runner.pause(true);
    const client = new NetClient(session, start);
    netClient = client;
    soundSys.init();
    soundSys.resume();
    ui.hideAll();
    withLoading(start.cfg.map, () => {
      // (gone back to the lobby meanwhile)
      if (netClient !== client) return;
      soundSys.finish();
      ambience.update(map.def.ambience);
      game.startClient(client);
      client.send({ t: 'hackcfg', cfg: settings.hackCfg });
      game.prewarm(renderer);
      enterPlay();
    });
  },
  // the match is over (or the host ended it): everyone back to the lobby
  onlineToLobby() {
    if (game.net) game.net.backToLobby();
    leaveMatch();
    onlineUI.open('lobby');
  },
  arenaWatching: watching,
  // play a match here to watch it (spec: one the runner gave out for this)
  arenaWatch(spec) {
    if (!spec) return false;
    watchRate = 1;
    watchPaused = false;
    soundSys.init();
    soundSys.resume();
    ui.hideAll();
    runner.setWatching(true);
    withLoading(spec.map, () => {
      soundSys.finish();
      ambience.update(map.def.ambience);
      game.start(spec.cfg);
      game.recorder = new Recorder(game, spec);
      game.prewarm(renderer);
      enterPlay();
    });
    return true;
  },
  // play a highlight (save: whose, entry: which, list: what plays after it);
  // false when it can't be read now, 'gone' when its recording isn't there
  // (clip: the recording itself when it's at hand)
  async arenaReplay(save, entry, list = null, clip = null) {
    if (!clip) {
      try {
        clip = await loadClip(save, entry.id);
      } catch (e) {
        return false;
      }
      if (!clip) return 'gone';
    }
    replayList = list ? { save, list, at: list.indexOf(entry) } : { save, list: [entry], at: 0 };
    replayClip = { clip, entry };
    watchRate = 1;
    watchPaused = false;
    soundSys.init();
    soundSys.resume();
    ui.hideAll();
    runner.setWatching(true);
    withLoading(clip.map, () => {
      soundSys.finish();
      ambience.update(map.def.ambience);
      game.startReplay(clip, arenaUI.clipTitle(entry));
      game.prewarm(renderer);
      enterPlay();
    });
    return true;
  },
  arenaReplayAgain() {
    const r = replayClip;
    if (!r) return;
    handlers.arenaReplay(replayList.save, r.entry, replayList.list, r.clip);
  },
  // the next one in the list (one whose recording is gone is skipped, and leaves the list)
  async arenaReplayNext() {
    const l = replayList;
    for (let i = (l ? l.at : 0) + 1; l && i < l.list.length; i++) {
      const ok = await handlers.arenaReplay(l.save, l.list[i], l.list);
      if (ok === true) return;
      if (ok === 'gone') {
        removeClip(l.save, l.list[i]);
        arenaUI.touch(true);
      }
    }
    handlers.disconnect();
  },
  // the match-end screen's "Watch another": back to Bot Arena, the next match and its bet
  arenaWatchNext() {
    handlers.disconnect();
    arenaUI.watchNext(null, arenaUI.watchTab);
  },
  arenaSaves: () => arenaStore.saves,
  teamSelected(team) {
    // online, the host's game decides (five people a team at most)
    if (game.client) game.client.send({ t: 'jointeam', team });
    else if (game.net) game.net.joinTeam(game.human, team);
    else game.chooseTeam(team);
    game.prewarm(renderer);
    // Classic spawns right away and may have put the weapon menu up instead of the team menu
    if (ui.dialog?.name === 'weapons') {
      soundSys.init();
      soundSys.resume();
      input.clear();
      input.gameActive = true;
    } else enterPlay();
  },
  playAgain() {
    handlers.start(game.cfg);
  },
  settingsChanged() {
    soundSys.setVolume(settings.volume);
    applyQuality();
  },
  mapPreview: (name) => mapPreview(name),
  // hacker mode (the Esc menu's Hacks window)
  hackState: () => ({ allowed: !!(game.active && game.cfg && game.cfg.hacks && game.human), hacks: game.human ? game.human.hacks : {} }),
  // (a friend online switches here at once and tells the host, which tells everyone)
  setHack(key, on) {
    const h = game.human;
    if (!h) return false;
    if (!game.client) return game.setHack(h, key, on);
    if (!game.cfg.hacks) return false;
    h.hacks[key] = !!on;
    h.hacking = isHacking(h);
    game.client.send({ t: 'hack', key, on: !!on });
    return true;
  },
  setHackCfg(cfg) {
    const h = game.human;
    if (!h) return;
    if (game.client) {
      h.hackCfg = hackCfg(cfg);
      game.client.send({ t: 'hackcfg', cfg });
    } else game.setHackCfg(h, cfg);
  },
  hackNews() {
    if (game.client) game.client.send({ t: 'hacknews' });
    else if (game.active) game.flushHackNews(true);
  },
};

const hooks = {
  onMatchEnd(title, html) {
    releasePointer();
    // online: the final scoreboard, then everyone back to the lobby together
    if (game.net || game.client) {
      const host = !!game.net;
      ui.showMatchEnd(title, html, null, { host, until: performance.now() + LOBBY_AFTER * 1000 });
      if (host) {
        clearTimeout(lobbyTimer);
        lobbyTimer = setTimeout(() => {
          if (game.net && game.over) handlers.onlineToLobby();
        }, LOBBY_AFTER * 1000);
      }
      return;
    }
    if (game.cfg.arena) {
      // a watched Bot Arena match counts like the others (and settles a bet on it)
      const res = game.arenaResult();
      res.clips = game.recorder ? game.recorder.finish(res) : [];
      game.recorder = null;
      const kind = runner.kind;
      runner.finishLive(res);
      ui.showMatchEnd(title, html, { more: arenaUI.canWatchMore(), bet: arenaUI.liveOver(res), kind });
      return;
    }
    ui.showMatchEnd(title, html);
  },
  // a highlight played to its end
  onReplayEnd() {
    releasePointer();
    const l = replayList;
    ui.showReplayEnd(arenaUI.clipTitle(replayClip.entry), !!l && l.at + 1 < l.list.length);
  },
  onTeamMenu() {
    releasePointer();
    ui.showTeamSelect(true);
  },
  // the weapon window needs the mouse; it doesn't open over other menus
  onGunMenu(opts) {
    if (ui.screen || (ui.dialog && ui.dialog.name !== 'team')) return false;
    ui.showWeaponMenu(opts);
    releasePointer();
    return true;
  },
  isGunMenuOpen() {
    return ui.dialog?.name === 'weapons';
  },
  closeGunMenu() {
    if (ui.dialog?.name === 'weapons') ui.closeDialog();
  },
};

const game = new Game({ scene, camera, map, effects, hud, soundSys, input, viewModel, textures, ui: null, hooks });
const ui = new UI(document.getElementById('ui'), input, soundSys, handlers);
game.ui = ui;
// Bot Arena: its saves, the battle runner (background workers) and its menus
const arenaStore = loadStore();
for (const s of arenaStore.saves) fixComps(s);
const runner = new ArenaRunner(arenaStore);
const arenaUI = new ArenaScreens(ui, runner, arenaStore, {
  watch: (spec) => handlers.arenaWatch(spec),
  replay: (save, entry, list) => handlers.arenaReplay(save, entry, list),
});
// online play: the Play online window and its sessions
const onlineUI = new OnlineScreens(ui, {
  start: (s) => handlers.startOnline(s),
  joinMatch: (s) => s.send({ t: 'enter' }),
  // the match's own messages
  message(s, msg) {
    if (s.role !== 'client') return;
    if (msg && msg.t === 'start') handlers.joinOnline(s, msg);
    else if (msg && msg.t === 'tolobby') {
      if (game.client || netClient) {
        leaveMatch();
        onlineUI.open('lobby');
      }
    } else if (game.client) game.client.receive(msg);
    else if (netClient) netClient.receive(msg);
  },
  // the online game is over (the host closed it, the connection broke, or we left)
  ended() {
    if (game.net || game.client || netClient) leaveMatch();
  },
});
window.cs16 = { game, input, ui, settings, arenaStore, runner, arenaUI, onlineUI };
applyQuality();

document.addEventListener('pointerlockchange', () => {
  input.locked = document.pointerLockElement === canvas;
  if (!input.locked) {
    input.down.clear();
    if (game.active && !game.over && !ui.isOpen()) ui.showMain(true);
  }
});
document.addEventListener('pointerlockerror', () => {
  if (game.active && !game.over && !ui.isOpen()) ui.showMain(true);
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
});

// With keyboard lock, Escape reaches the page instead of releasing the mouse.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && input.locked) releasePointer();
  // watching a Bot Arena match: P pauses, - and + change the speed
  if (watching() && !ui.isOpen() && !e.repeat) {
    const i = WATCH_SPEEDS.indexOf(watchRate);
    if (e.code === 'KeyP') watchPaused = !watchPaused;
    else if (e.code === 'Minus' || e.code === 'NumpadSubtract') watchRate = WATCH_SPEEDS[Math.max(0, i - 1)];
    else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
      watchRate = WATCH_SPEEDS[Math.min(WATCH_SPEEDS.length - 1, i + 1)];
      watchPaused = false;
    }
  }
});

// Clicking the game view while a match runs grabs the mouse again.
function onCanvasClick() {
  if (game.active && !game.over && !ui.isOpen() && !input.locked) enterPlay();
}

window.addEventListener('beforeunload', (e) => {
  // (closing the page would also end an online game for everyone in it)
  if ((game.active && !game.over) || onlineUI.session) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  viewModel.camera.aspect = w / h;
  viewModel.camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

let last = performance.now();
let lastDrawn = performance.now();
let acc = 0;
let orbit = 0;

function frame(now) {
  requestAnimationFrame(frame);
  lastDrawn = performance.now();
  advance(true);
}

function advance(draw) {
  const now = performance.now();
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (window.cs16.freeze) return; // debugging aid: stop the loop, step by hand
  step(dt, draw);
}

// A hidden tab gets no frames to draw. An online match can't stop for that
// (the host's game runs everyone, a friend's keys have to keep going), so a
// worker's clock moves the game on then, without drawing anything.
{
  const pulse = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 20);'], { type: 'text/javascript' })));
  pulse.onmessage = () => {
    if (performance.now() - lastDrawn > 150 && (game.net || game.client)) advance(false);
  };
}

// draw: false when the tab is hidden (the game moves on, nothing is drawn)
function step(dt, draw = true) {
  const [mx, my] = input.takeMouse();

  if (game.active) {
    const menuOpen = ui.isOpen();
    // keys pressed while a menu is open belong to the menu, not the game
    if (menuOpen) input.takePressed();
    else game.handleInput();
    // (an online match never stops: the others play on)
    const online = !!(game.net || game.client);
    const paused = !online && ((ui.pausesGame() && settings.pauseInMenu) || game.needsTeam());
    if (input.locked && !menuOpen) game.look(mx, my);
    // a watched Bot Arena match can run slower or faster, or stand still
    const rate = watching() ? (watchPaused ? 0 : watchRate * (game.replay ? game.replay.speed() : 1)) : 1;
    game.watchSpeed = rate;
    game.frameDt = dt;
    const still = paused || rate === 0;
    if (!still) {
      acc += dt * rate;
      let n = 0;
      const max = 12 * Math.max(1, rate);
      while (acc >= TICK && n < max) {
        game.tick(TICK);
        acc -= TICK;
        n++;
      }
      if (n === max) acc = 0;
    }
    if (!draw) {
      game.flushHackNews();
      return;
    }
    game.render(still ? 1 : acc / TICK, still ? 0 : dt * rate);
    effects.update(still ? 0 : dt * rate);
  } else {
    if (!draw) return;
    // slow fly-around (or pan) behind the main menu
    orbit += dt * 0.04;
    camera.fov = vfov(90);
    camera.updateProjectionMatrix();
    const mc = map.menuCam;
    if (mc.pan) {
      const k = 0.5 - 0.5 * Math.cos(orbit * 1.5);
      camera.position.set(mc.from[0] + (mc.to[0] - mc.from[0]) * k, mc.from[1] + (mc.to[1] - mc.from[1]) * k, mc.from[2] + (mc.to[2] - mc.from[2]) * k);
      camera.lookAt(mc.look[0], mc.look[1], mc.look[2]);
    } else {
      camera.position.set(mc.x + Math.cos(orbit) * mc.rx, mc.h + Math.sin(orbit * 0.7) * 40, mc.z + Math.sin(orbit) * mc.rz);
      camera.lookAt(mc.x, mc.y, mc.z);
    }
  }
  map.sky.position.copy(camera.position);
  // music in the main menu, the map's own sounds in a match
  music.update(!game.active);
  ambience.update(game.active ? map.def.ambience : null);

  renderer.clear();
  // the spectator overview covers the screen: no need to draw the world
  const world = !(game.active && game.skip3D);
  if (world) renderer.render(scene, camera);
  if (game.active && world) {
    renderer.clearDepth();
    renderer.render(viewModel.scene, viewModel.camera);
  }
  if (world) drawPicture();
}

window.cs16.step = step; // debugging aid: advance one frame by hand
window.cs16.loadMap = loadMap; // debugging aid: switch maps synchronously
window.cs16.renderer = renderer;

ui.showMain(false);
document.getElementById('boot')?.remove();
// opened from an invite link: join that game (the code leaves the address bar)
{
  const m = location.hash.match(/^#join=([A-Za-z0-9_-]+)$/);
  if (m) {
    history.replaceState(null, '', location.pathname + location.search);
    onlineUI.openInvite(m[1]);
  }
}
requestAnimationFrame(frame);

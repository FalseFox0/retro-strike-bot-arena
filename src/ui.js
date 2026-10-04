// Menus in the style of the CS 1.6 / old Steam VGUI: main menu, Create Game,
// Options (with key binding), team select and match end. Bot Arena's own
// window is in arenaui.js.

import { t, setLang, getLang, LANGS, onLangChange } from './i18n.js';
import { settings, saveSettings, resetBinds, ACTIONS, ROUND_TIMES, FREEZE_TIMES, START_MONEY, MAX_TEAM_BOTS, hasTeams } from './settings.js';
import { keyName } from './input.js';
import { escapeHtml, gunIcon } from './hud.js';
import { WEAPONS, CATEGORIES, canUse } from './weapons.js';
import { MAP_LIST, isBombMap } from './map.js';
import { CROSSHAIR_DEFAULTS, CROSSHAIR_SHAPES, CROSSHAIR_SWATCHES, crosshairScale, crosshairGap, drawCrosshair } from './crosshair.js';
import { HACKS, SEE_HACKS, PLAY_HACKS } from './hacks.js';
import { testRelay } from './net.js';

const DIGITS = {
  Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Digit6: 6, Digit7: 7, Digit8: 8, Digit9: 9, Digit0: 0,
  Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4, Numpad5: 5, Numpad6: 6, Numpad7: 7, Numpad8: 8, Numpad9: 9, Numpad0: 0,
};
// With no team (FFA) all ten rifles would be too many for the number keys,
// so the sniper rifles get their own page there. The buy menu adds equipment.
const menuCats = (team, buy) => (buy ? ['pistol', 'shotgun', 'smg', 'rifle', 'mg', 'equip'] : team ? ['pistol', 'shotgun', 'smg', 'rifle', 'mg'] : ['pistol', 'shotgun', 'smg', 'rifle', 'sniper', 'mg']);
// bomb defusal equipment, in the 1.6 menu order
const EQUIP_ITEMS = ['vest', 'vesthelm', 'flashbang', 'hegrenade', 'smokegrenade', 'defuser'];
const itemName = (id) => (WEAPONS[id] ? WEAPONS[id].name : t('eq_' + id));

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}

export class UI {
  constructor(root, input, sound, handlers) {
    this.root = root;
    this.input = input;
    this.sound = sound;
    this.on = handlers;
    this.layer = h('div', { class: 'ui-layer' });
    root.append(this.layer);
    this.screen = null; // { name, render }
    this.dialog = null;
    this.inGame = false;
    onLangChange(() => this.rerender());
    // ESC closes dialogs / resumes
    window.addEventListener('keydown', (e) => {
      if (this.dialog?.name === 'weapons' && !this.capturing && !e.repeat) {
        if (e.code in DIGITS) {
          e.preventDefault();
          this.weaponKey(DIGITS[e.code]);
          return;
        }
        if (e.code === 'Enter' || e.code === 'NumpadEnter') {
          e.preventDefault();
          this.weaponApply();
          return;
        }
      }
      if (this.dialog?.name === 'team' && !this.capturing) {
        const pick = { Digit1: 'T', Digit2: 'CT', Digit5: 'AUTO', Digit6: 'SPEC', Numpad1: 'T', Numpad2: 'CT', Numpad5: 'AUTO', Numpad6: 'SPEC' }[e.code];
        if (pick) {
          this.click();
          this.on.teamSelected(pick);
          return;
        }
      }
      if (e.code !== 'Escape' || this.capturing) return;
      if (!this.isOpen()) return;
      if (this.dialog && (this.dialog.name !== 'team' || this.dialog.cancel) && this.dialog.name !== 'end') {
        this.closeDialog();
      } else if (!this.dialog && this.inGame && this.screen?.name === 'main') {
        this.on.resume();
      }
    });
  }

  click() {
    this.sound?.play('ui_click');
  }

  isOpen() {
    return !!(this.screen || this.dialog);
  }

  // The weapon menu doesn't pause the game, like in 1.6.
  pausesGame() {
    return !!this.screen || (!!this.dialog && !this.dialog.live);
  }

  rerender() {
    if (this.screen) this.renderScreen();
    if (this.dialog) this.renderDialog();
  }

  hideAll() {
    this.screen = null;
    this.dialog = null;
    this.layer.innerHTML = '';
    this.layer.classList.remove('dim');
  }

  renderAll() {
    this.layer.innerHTML = '';
    if (this.screen) this.layer.append(this.screen.render());
    if (this.dialog) this.layer.append(this.dialog.render());
    this.layer.classList.toggle('dim', !!this.screen && this.inGame);
  }

  renderScreen() { this.renderAll(); }
  renderDialog() { this.renderAll(); }

  closeDialog() {
    // closing the hack window tells everyone what was switched right away
    if (this.dialog?.name === 'hacks') this.on.hackNews();
    this.dialog = null;
    this.renderAll();
    if (!this.screen && this.inGame) this.on.resume();
  }

  // ---------- main menu ----------
  showMain(inGame) {
    this.inGame = inGame;
    this.dialog = null;
    this.screen = { name: 'main', render: () => this.mainMenu() };
    this.renderAll();
  }

  mainMenu() {
    const item = (label, fn) => h('a', {
      class: 'mm-item', href: '#',
      onclick: (e) => { e.preventDefault(); this.click(); fn(); },
      onmouseenter: () => this.sound?.play('ui_hover'),
    }, label);
    const items = [];
    // watching a Bot Arena match: back to Bot Arena instead of disconnecting
    const watching = this.inGame && this.on.arenaWatching();
    // online: the host ends the match for everyone, a friend goes back to the lobby
    const online = this.inGame ? this.on.onlineRole() : null;
    if (this.inGame) {
      items.push(item(t('resume'), () => this.on.resume()));
      const leave = watching ? 'arenaBack' : online === 'host' ? 'onlEndMatch' : online === 'client' ? 'onlToLobby' : 'disconnect';
      items.push(item(t(leave), () => this.on.disconnect()));
      if (!watching) {
        items.push(h('div', { class: 'mm-gap' }));
        if (online) items.push(item(t('onlLobby'), () => this.on.online()));
        items.push(item(t('hacks'), () => this.showHacks()));
      }
    }
    if (!watching && !online) items.push(item(t('newGame'), () => this.showCreate()));
    if (!this.inGame) items.push(item(t('playOnline'), () => this.on.online()));
    if (!this.inGame) items.push(item(t('botArena'), () => this.on.arena()));
    items.push(item(t('options'), () => this.showOptions()));
    return h('div', { class: 'main-menu' + (this.inGame ? ' ingame' : '') },
      h('div', { class: 'logo' },
        h('div', { class: 'logo-title' }, 'RETRO STRIKE'),
        h('div', { class: 'logo-sub' }, 'BOT ARENA'),
        h('div', { class: 'logo-note' }, t('subtitle'))),
      h('div', { class: 'mm-items' }, items),
      this.inGame ? h('div', { class: 'mm-paused' }, settings.pauseInMenu && !online ? t('paused') : '') : null,
    );
  }

  // ---------- generic VGUI window ----------
  win(title, body, buttons, cls = '') {
    return h('div', { class: 'vgui-backdrop' },
      h('div', { class: 'vgui-window ' + cls },
        h('div', { class: 'vgui-title' }, title,
          h('button', { class: 'vgui-x', onclick: () => { this.click(); this.closeDialog(); } }, '×')),
        h('div', { class: 'vgui-body' }, body),
        buttons ? h('div', { class: 'vgui-buttons' }, buttons) : null));
  }

  btn(label, fn, primary) {
    return h('button', { class: 'vgui-btn' + (primary ? ' primary' : ''), onclick: () => { this.click(); fn(); } }, label);
  }

  select(value, options, onchange) {
    const s = h('select', { class: 'vgui-select', onchange: (e) => onchange(e.target.value) },
      options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));
    return s;
  }

  row(label, control) {
    return h('div', { class: 'vgui-row' }, h('label', {}, label), control);
  }

  check(label, value, onchange) {
    return h('label', { class: 'vgui-check' },
      h('input', { type: 'checkbox', checked: value, onchange: (e) => onchange(e.target.checked) }),
      h('span', { class: 'box' }), label);
  }

  slider(value, min, max, step, onchange, fmt = (v) => v) {
    const out = h('span', { class: 'vgui-sval' }, fmt(value));
    const inp = h('input', {
      type: 'range', class: 'vgui-slider', min, max, step, value,
      oninput: (e) => { const v = parseFloat(e.target.value); out.textContent = fmt(v); onchange(v); },
    });
    return h('div', { class: 'vgui-sliderwrap' }, inp, out);
  }

  // ---------- Create Game ----------
  showCreate() {
    this.dialog = { name: 'create', render: () => this.createGame() };
    this.renderAll();
  }

  createGame() {
    const tab = this.cgTab || 'game';
    const tabs = [['game', t('cgTabGame')], ['advanced', t('cgTabAdvanced')], ['hacks', t('cgTabHacks')]];
    const tabBar = h('div', { class: 'vgui-tabs' }, tabs.map(([id, label]) =>
      h('button', { class: 'vgui-tab' + (tab === id ? ' on' : ''), onclick: () => { this.click(); this.cgTab = id; this.renderAll(); } }, label)));
    const content = tab === 'advanced' ? this.createAdvanced() : tab === 'hacks' ? this.createHacks() : this.createMain();
    return this.win(t('createGame'), h('div', {}, tabBar, h('div', { class: 'vgui-tabbody cg-body' }, content)), [
      this.btn(t('start'), () => this.on.start({ ...settings.match }), true),
      this.btn(t('cancel'), () => this.closeDialog()),
    ], 'w-create');
  }

  // Game tab: map, mode, bots, limits. online: the online lobby's settings,
  // where bots fill the places no human takes (m.fill a team, or in all)
  createMain(m = settings.match, online = false) {
    const save = () => saveSettings();
    const botsRow = h('div');
    // team modes have T and CT bots, free-for-all a single count
    const fillBots = () => {
      botsRow.innerHTML = '';
      const counts = (n) => Array.from({ length: n + 1 }, (_, i) => [i, String(i)]);
      if (online) {
        const team = hasTeams(m), max = team ? 5 : 10;
        if (m.fill > max) m.fill = max;
        const opts = Array.from({ length: max - (team ? 0 : 1) }, (_, i) => i + (team ? 1 : 2)).map((n) => [n, team ? `${n} v ${n}` : String(n)]);
        botsRow.append(this.row(t(team ? 'onlFillTeam' : 'onlFillAll'), this.select(m.fill, opts, (v) => { m.fill = +v; save(); })),
          h('div', { class: 'vgui-desc' }, t('onlFillDesc')));
      } else if (hasTeams(m)) {
        botsRow.append(
          this.row(t('botsT'), this.select(m.botsT, counts(MAX_TEAM_BOTS), (v) => { m.botsT = +v; save(); })),
          this.row(t('botsCT'), this.select(m.botsCT, counts(MAX_TEAM_BOTS), (v) => { m.botsCT = +v; save(); })));
      } else {
        botsRow.append(this.row(t('bots'), this.select(m.bots, counts(15), (v) => { m.bots = +v; save(); })));
      }
    };
    const desc = h('div', { class: 'vgui-desc' }, t('modeDesc_' + m.mode));
    const limitRow = h('div');
    const timeRow = h('div');
    const modeRow = h('div');
    const thumb = h('div', { class: 'cg-thumb' });
    const fillThumb = () => {
      thumb.innerHTML = '';
      thumb.append(this.on.mapPreview(m.map), h('span', {}, m.map));
    };
    // bomb defusal needs a map with bomb sites
    const fillModes = () => {
      modeRow.innerHTML = '';
      const modes = ['tdm', 'ffa', 'classic', 'bomb', 'gungame'].filter((md) => md !== 'bomb' || isBombMap(m.map));
      modeRow.append(this.row(t('gameMode'), this.select(m.mode, modes.map((md) => [md, t('mode_' + md)]), (v) => {
        m.mode = v; save(); desc.textContent = t('modeDesc_' + v); fillLimit(); fillBots();
      })));
    };
    const fillLimit = () => {
      limitRow.innerHTML = '';
      timeRow.innerHTML = '';
      // Gun Game: free-for-all or teams, and no limits (a knife kill on the last level ends it)
      if (m.mode === 'gungame') {
        limitRow.append(this.row(t('ggPlayAs'), this.select(m.ggTeams ? 'teams' : 'ffa', [['ffa', t('ggFfa')], ['teams', t('ggTeams')]], (v) => { m.ggTeams = v === 'teams'; save(); fillBots(); })));
        return;
      }
      timeRow.append(this.row(t('timeLimit'), this.select(m.timeLimit, [[0, t('noLimit')], [5, '5'], [10, '10'], [15, '15'], [20, '20'], [30, '30']], (v) => { m.timeLimit = +v; save(); })));
      if (m.mode === 'tdm') {
        limitRow.append(this.row(t('teamKillLimit'), this.select(m.tdmLimit, [[25, '25'], [50, '50'], [75, '75'], [100, '100'], [150, '150'], [0, t('noLimit')]], (v) => { m.tdmLimit = +v; save(); })));
      } else if (m.mode === 'ffa') {
        limitRow.append(this.row(t('killLimit'), this.select(m.ffaLimit, [[10, '10'], [20, '20'], [30, '30'], [50, '50'], [0, t('noLimit')]], (v) => { m.ffaLimit = +v; save(); })));
      } else {
        limitRow.append(this.row(t('roundsToWin'), this.select(m.roundsToWin, [[3, '3'], [5, '5'], [8, '8'], [10, '10'], [16, '16']], (v) => { m.roundsToWin = +v; save(); })));
      }
    };
    fillLimit();
    fillThumb();
    fillModes();
    fillBots();
    return h('div', { class: 'create-game' },
      h('div', { class: 'cg-map' },
        thumb,
        this.row(t('map'), this.select(m.map, MAP_LIST.map((n) => [n, n]), (v) => {
          m.map = v;
          if (m.mode === 'bomb' && !isBombMap(v)) m.mode = 'classic';
          save();
          desc.textContent = t('modeDesc_' + m.mode);
          fillThumb();
          fillModes();
          fillLimit();
          fillBots();
        }))),
      h('div', { class: 'cg-fields' },
        modeRow,
        desc,
        botsRow,
        this.row(t('botDifficulty'), this.select(m.difficulty, ['easy', 'normal', 'hard', 'expert'].map((d) => [d, t('diff_' + d)]), (v) => { m.difficulty = v; save(); })),
        this.charsRow(m),
        limitRow,
        timeRow,
      ));
  }

  // Bot Arena characters can take the bot slots (nothing they do here counts in the save)
  charsRow(m = settings.match) {
    const bc = m.botChars;
    const saves = this.on.arenaSaves();
    const cur = saves.find((x) => x.id === bc.save);
    const rows = [this.row(t('botPlayers'), this.select(cur ? cur.id : '', [['', t('botPlayersPlain')], ...saves.map((x) => [x.id, t('botPlayersSave', { name: x.name })])], (v) => {
      bc.save = v;
      bc.pick = null;
      saveSettings();
      this.renderAll();
    }))];
    if (cur) {
      const live = cur.chars.filter((c) => !c.retired);
      const on = (id) => !bc.pick || bc.pick.includes(id);
      rows.push(h('div', { class: 'cg-chars' }, live.map((c) => this.check(h('span', {}, h('i', { class: 'ar-dot', style: `background:${c.color}` }), ' ' + c.name), on(c.id), (v) => {
        const ids = bc.pick ? [...bc.pick] : live.map((x) => x.id);
        bc.pick = v ? [...new Set([...ids, c.id])] : ids.filter((id) => id !== c.id);
        saveSettings();
      }))));
      rows.push(h('div', { class: 'vgui-desc' }, t('botPlayersDesc')));
    }
    return h('div', {}, rows);
  }

  // Advanced tab: only what applies to the chosen mode
  createAdvanced(m = settings.match) {
    const save = () => saveSettings();
    const rows = [];
    const rounds = m.mode === 'classic' || m.mode === 'bomb';
    if (rounds) {
      const own = m.mode === 'bomb' ? '1:45' : '2:00';
      const fmt = (min) => `${Math.floor(min)}:${String(Math.round((min % 1) * 60)).padStart(2, '0')}`;
      rows.push(this.row(t('roundTime'), this.select(m.roundTime, ROUND_TIMES.map((v) => [v, v ? fmt(v) : t('roundTimeOwn', { t: own })]), (v) => { m.roundTime = +v; save(); })));
      rows.push(this.row(t('freezeTimeOpt'), this.select(m.freezeTime, FREEZE_TIMES.map((v) => [v, t('seconds', { n: v })]), (v) => { m.freezeTime = +v; save(); })));
    }
    if (m.mode === 'bomb') {
      rows.push(this.row(t('startMoney'), this.select(m.startMoney, START_MONEY.map((v) => [v, '$' + v]), (v) => { m.startMoney = +v; save(); })));
    }
    if (hasTeams(m)) {
      rows.push(this.check(t('friendlyFire'), m.friendlyFire, (v) => { m.friendlyFire = v; save(); }));
      rows.push(h('div', { class: 'vgui-desc' }, t('friendlyFireDesc')));
      rows.push(this.check(t('autoBalance'), m.autoBalance, (v) => { m.autoBalance = v; save(); }));
      rows.push(h('div', { class: 'vgui-desc' }, t('autoBalanceDesc')));
      rows.push(this.row(t('deadView'), this.select(m.deadView, [['team', t('deadView_team')], ['all', t('deadView_all')]], (v) => { m.deadView = v; save(); })));
      rows.push(h('div', { class: 'vgui-desc' }, t('deadViewDesc')));
    }
    if (!rows.length) rows.push(h('div', { class: 'vgui-desc' }, t('noAdvanced')));
    return h('div', { class: 'vgui-form' },
      h('div', { class: 'vgui-desc cg-for' }, t('advancedFor', { mode: t('mode_' + m.mode) })),
      ...rows);
  }

  // Hacks tab: may players hack, and which bots hack with what
  // (online: up to the number of places bots may fill)
  createHacks(m = settings.match, online = false) {
    const save = () => saveSettings();
    const rows = [
      this.check(t('hacksAllowed'), m.hacks, (v) => { m.hacks = v; save(); this.renderAll(); }),
      h('div', { class: 'vgui-desc' }, t('hacksAllowedDesc')),
    ];
    if (!m.hacks) {
      rows.push(h('div', { class: 'vgui-desc hk-off' }, t('hacksAllowFirst')));
    } else {
      const counts = (n) => Array.from({ length: n + 1 }, (_, i) => [i, String(i)]);
      const maxT = online ? m.fill : m.botsT, maxCT = online ? m.fill : m.botsCT, maxN = online ? m.fill : m.bots;
      if (hasTeams(m)) {
        rows.push(
          this.row(t('hackBotsT'), this.select(Math.min(m.hackBotsT, maxT), counts(maxT), (v) => { m.hackBotsT = +v; save(); })),
          this.row(t('hackBotsCT'), this.select(Math.min(m.hackBotsCT, maxCT), counts(maxCT), (v) => { m.hackBotsCT = +v; save(); })));
      } else {
        rows.push(this.row(t('hackBotsN'), this.select(Math.min(m.hackBots, maxN), counts(maxN), (v) => { m.hackBots = +v; save(); })));
      }
      rows.push(h('div', { class: 'hk-sub' }, t('botHacksTitle')));
      rows.push(h('div', { class: 'hk-grid' }, HACKS.map((k) => this.check(t('hack_' + k), m.botHacks[k], (v) => { m.botHacks[k] = v; save(); }))));
      rows.push(h('div', { class: 'vgui-desc' }, t('botHacksNote')));
    }
    return h('div', { class: 'vgui-form' }, ...rows);
  }

  // ---------- hacks (Esc menu) ----------
  showHacks() {
    this.dialog = { name: 'hacks', render: () => this.hacksWindow() };
    this.renderAll();
  }

  // a switch for every hack; the aimbot, triggerbot and speedhack have sliders
  hacksWindow() {
    const st = this.on.hackState();
    const c = settings.hackCfg;
    const cfg = (k, v) => { c[k] = v; saveSettings(); this.on.setHackCfg({ ...c }); };
    const pct = (v) => Math.round(v * 100) + '%';
    const extra = {
      aimbot: () => [
        this.row(t('aimSmooth'), this.slider(c.aimSmooth, 0, 1, 0.05, (v) => cfg('aimSmooth', v), pct)),
        this.row(t('aimFov'), this.slider(c.aimFov, 1, 180, 1, (v) => cfg('aimFov', v), (v) => v + '°')),
        this.row(t('aimBone'), this.select(c.aimBone, [['head', t('aimBone_head')], ['body', t('aimBone_body')]], (v) => cfg('aimBone', v))),
        this.row(t('aimWhen'), this.select(c.aimWhen, [['always', t('aimWhen_always')], ['fire', t('aimWhen_fire')]], (v) => cfg('aimWhen', v))),
      ],
      triggerbot: () => [this.row(t('trigDelay'), this.slider(c.trigDelay, 0, 300, 10, (v) => cfg('trigDelay', v), (v) => v + ' ms'))],
      speedhack: () => [this.row(t('hackSpeed'), this.slider(c.speed, 1.2, 3, 0.1, (v) => cfg('speed', v), (v) => v.toFixed(1) + '×'))],
    };
    const item = (k) => h('div', { class: 'hk-item' },
      st.allowed
        ? this.check(t('hack_' + k), !!st.hacks[k], (v) => this.on.setHack(k, v))
        : h('div', { class: 'hk-name' }, t('hack_' + k)),
      h('div', { class: 'vgui-desc' }, t('hackDesc_' + k)),
      st.allowed && extra[k] ? h('div', { class: 'hk-sliders' }, extra[k]()) : null);
    const body = h('div', { class: 'hk-window' + (st.allowed ? '' : ' off') },
      h('div', { class: 'hk-note' + (st.allowed ? '' : ' hk-off') }, st.allowed ? t('hacksWarn') : t('hacksOffMatch')),
      h('div', { class: 'hk-cols' },
        h('div', { class: 'hk-col' }, h('div', { class: 'hk-sub' }, t('hackSee')), SEE_HACKS.map(item)),
        h('div', { class: 'hk-col' }, h('div', { class: 'hk-sub' }, t('hackPlay')), PLAY_HACKS.map(item))),
      this.row(t('hackSpecView'), this.select(settings.hackSpecView, ['off', 'eye', 'all'].map((v) => [v, t('specView_' + v)]), (v) => { settings.hackSpecView = v; saveSettings(); })));
    const buttons = [this.btn(t('ok'), () => this.closeDialog(), true)];
    if (st.allowed) buttons.unshift(this.btn(t('allHacksOff'), () => { for (const k of HACKS) this.on.setHack(k, false); this.renderAll(); }));
    return this.win(t('hacks'), body, buttons, 'w-hacks');
  }

  // ---------- Options ----------
  showOptions(tab = 'keyboard') {
    this.optTab = tab;
    this.dialog = { name: 'options', render: () => this.options() };
    this.renderAll();
  }

  options() {
    const tabs = [['keyboard', t('tabKeyboard')], ['mouse', t('tabMouse')], ['crosshair', t('tabCrosshair')], ['av', t('tabAudioVideo')], ['game', t('tabGame')]];
    const tabBar = h('div', { class: 'vgui-tabs' }, tabs.map(([id, label]) =>
      h('button', { class: 'vgui-tab' + (this.optTab === id ? ' on' : ''), onclick: () => { this.click(); this.optTab = id; this.renderAll(); } }, label)));
    let content;
    const save = () => { saveSettings(); this.on.settingsChanged(); };
    if (this.optTab === 'keyboard') {
      content = this.keyTable();
    } else if (this.optTab === 'mouse') {
      content = h('div', { class: 'vgui-form' },
        this.row(t('sensitivity'), this.slider(settings.sensitivity, 0.5, 10, 0.1, (v) => { settings.sensitivity = v; save(); }, (v) => v.toFixed(1))),
        this.check(t('invertMouse'), settings.invertMouse, (v) => { settings.invertMouse = v; save(); }),
        this.check(t('rawInput'), settings.rawInput, (v) => { settings.rawInput = v; save(); }));
    } else if (this.optTab === 'crosshair') {
      content = this.crosshairTab();
    } else if (this.optTab === 'av') {
      content = h('div', { class: 'vgui-form' },
        this.row(t('quality'), this.select(settings.quality, ['low', 'medium', 'high'].map((q) => [q, t('q_' + q)]), (v) => { settings.quality = v; save(); })),
        h('div', { class: 'vgui-desc' }, t('qualityDesc')),
        this.row(t('gamma'), this.slider(settings.gamma, 0.5, 1.5, 0.05, (v) => { settings.gamma = v; save(); }, (v) => v.toFixed(2))),
        this.row(t('brightness'), this.slider(settings.brightness, 0.5, 1.5, 0.05, (v) => { settings.brightness = v; save(); }, (v) => Math.round(v * 100) + '%')),
        h('div', { class: 'vgui-desc' }, t('pictureDesc')),
        this.row(t('volume'), this.slider(settings.volume, 0, 1, 0.05, (v) => { settings.volume = v; save(); }, (v) => Math.round(v * 100) + '%')),
        this.row(t('musicVolume'), this.slider(settings.musicVolume, 0, 1, 0.05, (v) => { settings.musicVolume = v; save(); }, (v) => Math.round(v * 100) + '%')),
        this.row(t('ambienceVolume'), this.slider(settings.ambienceVolume, 0, 1, 0.05, (v) => { settings.ambienceVolume = v; save(); }, (v) => Math.round(v * 100) + '%')),
        this.check(t('fullscreen'), settings.fullscreen, (v) => { settings.fullscreen = v; save(); }),
        this.check(t('showFps'), settings.showFps, (v) => { settings.showFps = v; save(); }));
    } else {
      content = h('div', { class: 'vgui-form' },
        this.row(t('language'), this.select(getLang(), LANGS.map((l) => [l, t('langName_' + l)]), (v) => { settings.lang = v; save(); setLang(v); })),
        // the name other players see online (an empty one is asked for again)
        this.row(t('onlNameOpt'), h('input', {
          class: 'vgui-input', value: settings.playerName, maxlength: 20, placeholder: t('onlNamePh'),
          onchange: (e) => { settings.playerName = e.target.value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20); save(); },
        })),
        this.check(t('tracers'), settings.tracers, (v) => { settings.tracers = v; save(); }),
        this.check(t('pauseInMenu'), settings.pauseInMenu, (v) => { settings.pauseInMenu = v; save(); }),
        this.relayOptions());
    }
    return this.win(t('options'), h('div', {}, tabBar, h('div', { class: 'vgui-tabbody' }, content)), [
      this.btn(t('ok'), () => this.closeDialog(), true),
    ], 'w-options');
  }

  // the relay for online games you host (Options -> Game), with a test button
  // (typing only saves: nothing else needs to know)
  relayOptions() {
    const r = settings.relay;
    const field = (k, placeholder, type = 'text') => h('input', {
      class: 'vgui-input opt-relay', type, value: r[k], placeholder, spellcheck: false, autocomplete: type === 'password' ? 'new-password' : 'off',
      oninput: (e) => { r[k] = e.target.value.trim().slice(0, 200); saveSettings(); },
    });
    const result = h('span', { class: 'opt-relayres' });
    const test = async () => {
      result.className = 'opt-relayres';
      result.textContent = t('onlRelayTesting');
      const res = await testRelay(r);
      result.classList.toggle('bad', !res.ok);
      result.textContent = res.ok ? t('onlRelayOk', { n: res.ms }) : t('onlRelayErr_' + res.error);
    };
    return h('div', { class: 'opt-relaybox' },
      h('div', { class: 'ar-head' }, t('onlRelay')),
      this.row(t('onlRelayServer'), field('server', 'relay1.expressturn.com:3478')),
      this.row(t('onlRelayUser'), field('user', '')),
      this.row(t('onlRelayPass'), field('pass', '', 'password')),
      h('div', { class: 'vgui-desc' }, t('onlRelayDesc')),
      h('div', { class: 'opt-relaytest' }, this.btn(t('onlRelayTest'), test), result));
  }

  // custom crosshair: shape, color, opacity, sizes, dynamic, dot, outline
  crosshairTab() {
    const o = settings.crosshair;
    const save = () => saveSettings();
    const picker = h('input', { type: 'color', class: 'ch-picker', value: o.color, title: t('chCustomColor') });
    const swatches = CROSSHAIR_SWATCHES.map((c) => h('button', {
      class: 'ch-swatch', style: `background:${c}`, title: c, 'data-c': c,
      onclick: () => { this.click(); setColor(c); },
    }));
    const markSwatch = () => { for (const b of swatches) b.classList.toggle('on', b.dataset.c === o.color); };
    const setColor = (c) => { o.color = c.toLowerCase(); picker.value = o.color; markSwatch(); save(); };
    picker.addEventListener('input', (e) => setColor(e.target.value));
    markSwatch();
    const form = h('div', { class: 'vgui-form ch-form' },
      this.row(t('chShape'), this.select(o.shape, CROSSHAIR_SHAPES.map((k) => [k, t('chShape_' + k)]), (v) => { o.shape = v; save(); })),
      this.row(t('chColor'), h('div', { class: 'ch-colors' }, swatches, picker)),
      this.row(t('chAlpha'), this.slider(o.alpha, 0.1, 1, 0.05, (v) => { o.alpha = v; save(); }, (v) => Math.round(v * 100) + '%')),
      this.row(t('chLength'), this.slider(o.length, 1, 20, 1, (v) => { o.length = v; save(); })),
      this.row(t('chThickness'), this.slider(o.thickness, 1, 6, 1, (v) => { o.thickness = v; save(); })),
      this.row(t('chGap'), this.slider(o.gap, 0, 20, 1, (v) => { o.gap = v; save(); })),
      this.check(t('chDynamic'), o.dynamic, (v) => { o.dynamic = v; save(); }),
      this.check(t('chDot'), o.dot, (v) => { o.dot = v; save(); }),
      this.check(t('chOutline'), o.outline, (v) => { o.outline = v; save(); }));
    const preview = h('canvas', { class: 'ch-preview' });
    this.crosshairPreview(preview);
    return h('div', { class: 'ch-layout' }, form,
      h('div', { class: 'ch-side' },
        preview,
        h('div', { class: 'vgui-desc' }, t('chPreviewDesc')),
        this.btn(t('chReset'), () => { settings.crosshair = { ...CROSSHAIR_DEFAULTS }; saveSettings(); this.renderAll(); })));
  }

  // Draws the crosshair at its in-game size over a bit of scenery (sky, sand,
  // a dark doorway) and, when dynamic, fires a short burst every so often.
  crosshairPreview(canvas) {
    cancelAnimationFrame(this.chRaf);
    const W = 220, H = 170;
    let gap = 4, alpha = 255, last = performance.now(), nextBurst = last + 900, shots = 0, nextShot = 0;
    const frame = (now) => {
      if (!canvas.isConnected) return;
      const o = settings.crosshair;
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.round(W * dpr) & ~1, ch = Math.round(H * dpr) & ~1;
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
        canvas.style.width = cw / dpr + 'px';
        canvas.style.height = ch / dpr + 'px';
      }
      // 1.6 crosshair timing: open up per shot, close a bit every 1/100 s
      const frames = Math.min(10, (now - last) / 10);
      last = now;
      if (now >= nextBurst) { shots = 3; nextShot = now; nextBurst = now + 1800; }
      if (shots > 0 && now >= nextShot) {
        gap = Math.min(15, gap + 4);
        alpha = Math.max(120, alpha - 40);
        shots--;
        nextShot = now + 100;
      }
      gap = Math.max(4, gap - (gap * 0.013 + 0.1) * frames);
      alpha = Math.min(255, alpha + 2 * frames);
      const ctx = canvas.getContext('2d');
      ctx.globalAlpha = 1;
      const sky = ctx.createLinearGradient(0, 0, 0, ch * 0.55);
      sky.addColorStop(0, '#6f9fd0');
      sky.addColorStop(1, '#c4d8e8');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#c9a874';
      ctx.fillRect(0, ch * 0.55, cw, ch);
      ctx.fillStyle = '#b08d5c';
      ctx.fillRect(cw * 0.5, ch * 0.18, cw * 0.5, ch * 0.6);
      ctx.fillStyle = '#2a241d';
      ctx.fillRect(cw * 0.62, ch * 0.34, cw * 0.18, ch * 0.44);
      // draw opaque on a scratch canvas, then lay it on with the opacity
      const sc = this.chScratch || (this.chScratch = document.createElement('canvas'));
      sc.width = cw;
      sc.height = ch;
      const sctx = sc.getContext('2d');
      drawCrosshair(sctx, cw / 2, ch / 2, o, crosshairGap(o, o.dynamic ? gap : 4), crosshairScale(window.innerHeight) * dpr);
      ctx.globalAlpha = o.alpha * (o.dynamic ? alpha / 255 : 1);
      ctx.drawImage(sc, 0, 0);
      ctx.globalAlpha = 1;
      this.chRaf = requestAnimationFrame(frame);
    };
    this.chRaf = requestAnimationFrame(frame);
  }

  keyTable() {
    const rows = ACTIONS.map((a) => {
      const b = settings.binds[a];
      const cell = (i) => h('td', {
        class: 'kb-cell' + (this.capturing && this.capturing.action === a && this.capturing.slot === i ? ' wait' : ''),
        ondblclick: () => this.captureKey(a, i),
        onclick: () => this.captureKey(a, i),
      }, keyName(b[i]) || '');
      return h('tr', {}, h('td', {}, t('act_' + a)), cell(0), cell(1));
    });
    const hint = h('div', { class: 'kb-hint' }, this.capturing ? t('pressKey', { action: t('act_' + this.capturing.action) }) : '');
    return h('div', {},
      h('div', { class: 'kb-wrap' },
        h('table', { class: 'kb-table' },
          h('thead', {}, h('tr', {}, h('th', {}, t('action')), h('th', {}, t('key')), h('th', {}, t('altKey')))),
          h('tbody', {}, rows))),
      hint,
      h('div', { class: 'kb-actions' }, this.btn(t('resetDefaults'), () => { resetBinds(); saveSettings(); this.renderAll(); })));
  }

  captureKey(action, slot) {
    this.click();
    this.capturing = { action, slot };
    this.renderAll();
    // The click that started this has already fired its mousedown, so the
    // next key, button or wheel turn is the new binding.
    this.input.captureHandler = (code) => {
      if (code === 'Escape') {
        this.endCapture();
        return true;
      }
      const b = settings.binds[action];
      if (code === 'Delete' || code === 'Backspace') {
        b[slot] = null;
      } else {
        // one action per key, like CS
        for (const a of ACTIONS) {
          const ab = settings.binds[a];
          for (let i = 0; i < 2; i++) if (ab[i] === code) ab[i] = null;
        }
        b[slot] = code;
      }
      saveSettings();
      this.endCapture();
      return true;
    };
  }

  endCapture() {
    this.input.captureHandler = null;
    // keep ESC from also closing the dialog this frame
    setTimeout(() => {
      this.capturing = null;
      this.renderAll();
    }, 0);
    this.capturing = { action: '', slot: -1, ending: true };
  }

  // ---------- weapon menu (1.6 VGUI buy menu layout) ----------
  // free guns: { team, current: { primary, secondary }, nades: bool, onChoose(primary, secondary) }
  // buying:    { buy: true, team, money(), price(id), onBuy(id) -> bool }
  showWeaponMenu(opts) {
    this.wm = { opts, cat: null, primary: null, secondary: null, hover: null };
    this.dialog = { name: 'weapons', live: true, render: () => this.weaponMenu() };
    this.renderAll();
  }

  // like 1.6, only the guns your team can use are listed
  weaponList(cat) {
    const team = this.wm.opts.team;
    if (cat === 'equip') return EQUIP_ITEMS.filter((id) => id !== 'defuser' || team === 'CT').map((id) => ({ id, ok: this.affordable(id) }));
    if (this.wm.opts.buy) return CATEGORIES[cat].filter((id) => canUse(id, team)).map((id) => ({ id, ok: this.affordable(id) }));
    let ids = cat === 'sniper' ? CATEGORIES.rifle.filter((id) => WEAPONS[id].type === 'sniper') : CATEGORIES[cat];
    if (cat === 'rifle' && !team) ids = ids.filter((id) => WEAPONS[id].type !== 'sniper');
    return ids.filter((id) => canUse(id, team)).map((id) => ({ id, ok: true }));
  }

  affordable(id) {
    const o = this.wm.opts;
    return !o.buy || o.money() >= o.price(id);
  }

  // number keys: categories, then guns; 0 goes back or closes
  weaponKey(n) {
    const m = this.wm;
    if (!m) return;
    // 1.6 players type 8 for equipment
    if (m.opts.buy && !m.cat && n === 8) n = 6;
    if (n === 0) {
      this.click();
      if (m.cat) {
        m.cat = null;
        m.hover = null;
        this.renderAll();
      } else this.closeDialog();
      return;
    }
    if (!m.cat) {
      const cats = menuCats(m.opts.team, m.opts.buy);
      if (n >= 1 && n <= cats.length) this.weaponCat(cats[n - 1]);
      else if (n === 9 && !m.opts.buy) this.weaponPrevious();
      return;
    }
    const item = this.weaponList(m.cat)[n - 1];
    if (item && (item.ok || m.opts.buy)) this.weaponPick(item.id);
  }

  weaponCat(cat) {
    this.click();
    this.wm.cat = cat;
    this.wm.hover = null;
    this.renderAll();
  }

  // a primary first, then a pistol, like the CSDM gun menu
  weaponPick(id) {
    const m = this.wm;
    this.click();
    if (m.opts.buy) {
      // 1.6: buying something closes the menu (a failed buy shows why and stays open)
      if (m.opts.onBuy(id)) {
        this.wm = null;
        this.closeDialog();
      } else this.renderAll();
      return;
    }
    if (WEAPONS[id].slot === 2) m.secondary = id;
    else m.primary = id;
    if (m.primary && m.secondary) {
      this.weaponApply();
      return;
    }
    m.cat = m.primary ? 'pistol' : null;
    m.hover = null;
    this.renderAll();
  }

  weaponApply() {
    const m = this.wm;
    // the buy menu has nothing to apply (Enter there does nothing)
    if (!m || m.opts.buy) return;
    const cur = m.opts.current;
    const primary = m.primary || cur.primary, secondary = m.secondary || cur.secondary;
    this.wm = null;
    this.dialog = null;
    m.opts.onChoose(primary, secondary);
    this.closeDialog();
  }

  weaponPrevious() {
    this.click();
    const m = this.wm;
    m.primary = m.primary || m.opts.current.primary;
    m.secondary = m.secondary || m.opts.current.secondary;
    this.weaponApply();
  }

  weaponMenu() {
    const m = this.wm, o = m.opts;
    const team = o.team;
    const cats = h('div', { class: 'wm-col wm-cats' },
      menuCats(team, o.buy).map((c, i) => h('button', {
        class: 'wm-item' + (m.cat === c ? ' on' : ''),
        onclick: () => this.weaponCat(c),
      }, h('b', {}, String(i + 1)), t('cat_' + c))),
      h('div', { class: 'wm-gap' }),
      o.buy ? null : h('button', { class: 'wm-item', onclick: () => this.weaponPrevious() }, h('b', {}, '9'), t('previousSetup')),
      o.buy ? null : this.check(t('dontAskAgain'), settings.guns.remember, (v) => { settings.guns.remember = v; saveSettings(); }));

    let list;
    if (m.cat) {
      list = h('div', { class: 'wm-col wm-list' },
        h('div', { class: 'wm-head' }, t('cat_' + m.cat)),
        this.weaponList(m.cat).map((it, i) => {
          const d = WEAPONS[it.id];
          const chosen = !o.buy && (m.primary === it.id || m.secondary === it.id);
          return h('button', {
            class: 'wm-item' + (it.ok ? '' : ' off') + (chosen ? ' on' : ''),
            disabled: !it.ok && !o.buy,
            onclick: () => (it.ok || o.buy) && this.weaponPick(it.id),
            onmouseenter: () => { m.hover = it.id; this.renderInfo(); },
          }, h('b', {}, String(i + 1)), d ? d.name : itemName(it.id), o.buy ? h('span', { class: 'wm-price' }, '$' + o.price(it.id)) : null);
        }),
        h('div', { class: 'wm-gap' }),
        h('button', { class: 'wm-item', onclick: () => this.weaponKey(0) }, h('b', {}, '0'), t('back')));
    } else {
      list = h('div', { class: 'wm-col wm-list wm-hint' }, o.buy ? t('buyHint') : t('wmHint'), o.nades ? h('div', { class: 'wm-nades' }, t('nadesIncluded')) : null);
    }

    this.wmInfo = h('div', { class: 'wm-col wm-info' });
    this.renderInfo();

    const name = (id) => (id ? WEAPONS[id].name : '—');
    const sel = o.buy
      ? h('div', { class: 'wm-sel wm-money' }, h('span', {}, t('money') + ': ', h('b', {}, '$' + o.money())))
      : h('div', { class: 'wm-sel' },
        h('span', {}, t('wmPrimary') + ': ', h('b', {}, name(m.primary || o.current.primary))),
        h('span', {}, t('wmPistol') + ': ', h('b', {}, name(m.secondary || o.current.secondary))));

    const body = h('div', { class: 'wm' }, h('div', { class: 'wm-cols' }, cats, list, this.wmInfo), sel);
    if (o.buy) {
      return this.win(t('buyMenuTitle'), body, [this.btn(t('cancel'), () => this.closeDialog())], 'w-weapons');
    }
    return this.win(t('weaponMenuTitle'), body, [
      this.btn(t('ok'), () => this.weaponApply(), true),
      this.btn(t('cancel'), () => this.closeDialog()),
    ], 'w-weapons');
  }

  // the picture and numbers of the gun under the mouse
  renderInfo() {
    const el = this.wmInfo, m = this.wm;
    if (!el || !m) return;
    const id = m.hover || (m.cat ? this.weaponList(m.cat)[0]?.id : null) || m.primary || m.opts.current?.primary;
    el.innerHTML = '';
    if (!id) return;
    const d = WEAPONS[id];
    if (!d || d.type === 'grenade') {
      // equipment: a name and a price
      el.append(
        h('div', { class: 'wm-pic', html: gunIcon(id, 'wm-gun') }),
        h('div', { class: 'wm-name' }, itemName(id)),
        h('table', { class: 'wm-stats' }, h('tr', {}, h('td', {}, t('price')), h('td', {}, '$' + m.opts.price(id)))));
      return;
    }
    const rpm = Math.round(60 / (d.cycle || 1));
    const rows = [
      ...(m.opts.buy ? [[t('price'), '$' + m.opts.price(id)]] : []),
      [t('statDamage'), d.pellets ? `${d.dmg} × ${d.pellets}` : String(d.dmg)],
      [t('statRate'), t('statRpm', { n: rpm })],
      [t('statMag'), `${d.clip} / ${d.reserve}`],
      [t('statSpeed'), String(d.speed)],
      [t('statTeam'), t(d.team === 'T' ? 'tOnly' : d.team === 'CT' ? 'ctOnly' : 'bothTeams')],
    ];
    el.append(
      h('div', { class: 'wm-pic', html: gunIcon(id, 'wm-gun') }),
      h('div', { class: 'wm-name' }, d.name),
      h('table', { class: 'wm-stats' }, rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v)))));
  }

  // ---------- team select ----------
  showTeamSelect(canCancel) {
    this.inGame = true;
    this.screen = null;
    this.dialog = { name: 'team', cancel: canCancel, render: () => this.teamSelect(canCancel) };
    this.renderAll();
  }

  teamSelect(canCancel) {
    const pick = (team) => { this.click(); this.on.teamSelected(team); };
    const card = (team, label, info) => h('button', { class: 'team-card ' + team.toLowerCase(), onclick: () => pick(team) },
      h('div', { class: 'team-emblem' }, team === 'T' ? 'T' : 'CT'),
      h('div', { class: 'team-name' }, (team === 'T' ? '1. ' : '2. ') + label),
      h('div', { class: 'team-info' }, info));
    const body = h('div', { class: 'team-select' },
      h('div', { class: 'team-cards' },
        card('T', t('teamForcesT'), t('teamInfoT')),
        card('CT', t('teamForcesCT'), t('teamInfoCT'))),
      h('div', { class: 'team-extra' },
        this.btn('5. ' + t('autoSelect'), () => this.on.teamSelected('AUTO')),
        this.btn('6. ' + t('spectate'), () => this.on.teamSelected('SPEC'))));
    const w = this.win(t('chooseTeam'), body, canCancel ? [this.btn(t('cancel'), () => this.closeDialog())] : null, 'w-team');
    if (!canCancel) w.querySelector('.vgui-x').remove();
    return w;
  }

  // a yes / no question in a window of its own
  confirm(title, text, yes, onYes) {
    this.dialog = {
      name: 'confirm',
      render: () => this.win(title, h('div', { class: 'vgui-desc' }, text), [
        this.btn(yes, () => { this.dialog = null; onYes(); }, true),
        this.btn(t('cancel'), () => this.closeDialog()),
      ]),
    };
    this.renderAll();
  }

  // ---------- match end ----------
  // arena: a watched Bot Arena match ({ more: the battle has more to watch, bet: a line about
  // the bet on it, kind: 'battle' | 'season' | 'cup' }); online: { host, until } (when
  // everyone goes back to the lobby, performance.now() time)
  showMatchEnd(title, boardHtml, arena = null, online = null) {
    this.screen = null;
    this.dialog = { name: 'end', render: () => this.matchEnd(title, boardHtml, arena, online) };
    this.renderAll();
  }

  // a highlight replay is over: again, the next one, or back
  showReplayEnd(title, more) {
    this.screen = null;
    this.dialog = {
      name: 'end',
      render: () => {
        const w = this.win(t('replayOver'), h('div', { class: 'match-end' }, h('div', { class: 'me-title' }, title)), [
          this.btn(t('replayAgain'), () => this.on.arenaReplayAgain(), !more),
          more ? this.btn(t('replayNext'), () => this.on.arenaReplayNext(), true) : null,
          this.btn(t('arenaBack'), () => this.on.disconnect()),
        ], 'w-end');
        w.querySelector('.vgui-x').remove();
        return w;
      },
    };
    this.renderAll();
  }

  matchEnd(title, boardHtml, arena, online) {
    // online: how long until everyone is back in the lobby
    let count = null;
    if (online) {
      count = h('div', { class: 'me-count' });
      const show = () => {
        const n = Math.max(0, Math.ceil((online.until - performance.now()) / 1000));
        count.textContent = t(online.host ? 'onlBackInHost' : 'onlBackIn', { n });
      };
      show();
      const timer = setInterval(() => (count.isConnected ? show() : clearInterval(timer)), 250);
    }
    const body = h('div', { class: 'match-end' },
      h('div', { class: 'me-title' }, title),
      count,
      arena ? h('div', { class: 'vgui-desc' }, t(arena.kind === 'season' || arena.kind === 'cup' ? 'arenaCounted_' + arena.kind : 'arenaCounted')) : null,
      arena && arena.bet ? h('div', { class: 'me-bet', html: arena.bet }) : null,
      h('div', { class: 'me-board', html: boardHtml }));
    const buttons = online ? [
      online.host ? this.btn(t('onlBackNow'), () => this.on.onlineToLobby(), true) : this.btn(t('onlToLobby'), () => this.on.disconnect(), true),
    ] : arena ? [
      arena.more ? this.btn(t('arenaWatchNext'), () => this.on.arenaWatchNext(), true) : null,
      this.btn(t('arenaBack'), () => this.on.disconnect(), !arena.more),
    ] : [
      this.btn(t('playAgain'), () => this.on.playAgain(), true),
      this.btn(t('mainMenu'), () => this.on.disconnect()),
    ];
    const w = this.win(t('matchOver'), body, buttons, 'w-end');
    w.querySelector('.vgui-x').remove();
    return w;
  }
}

export { escapeHtml, h };

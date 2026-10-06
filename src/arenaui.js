// Bot Arena's menus, one big window over the main menu: the characters and
// their editor (and clans), battles (setup, progress, watching a match) and
// the stats, plus the saves that hold all of it.

import { t } from './i18n.js';
import { h } from './ui.js';
import { WEAPONS } from './weapons.js';
import { MAP_LIST } from './map.js';
import { HACKS } from './hacks.js';
import {
  SKILLS, HABITS, STYLES, FIGHTS, GUN_CHOICES, PISTOL_CHOICES, MAX_SIDE, MAX_FFA, COLORS, BASE_SKILL, PERSONALITIES,
  newSave, cleanChar, cleanSave, statsOf, battleCheck, toCSV, hacksOn, newId, readyClans, compOpen,
} from './arena.js';
import { DEFAULT_WORKERS, MAX_WORKERS } from './arenarun.js';
import { SeasonScreens, coins } from './seasonui.js';
import { walletOf, settleMatch } from './bets.js';
import { rivalsOf } from './news.js';
import { MAX_CLIPS, removeClip, dropSaveClips } from './clipstore.js';
import { koWaiting } from './league.js';
import { escapeHtml } from './ui.js';

const BOMB_MAPS = new Set(['de_dunetown', 'de_foundry']);
const gunName = (id) => (id === 'none' ? t('arenaNoGun') : WEAPONS[id]?.name || id);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) + '%' : '—');
const ratio = (a, b) => (b > 0 ? (a / b).toFixed(2) : a ? a.toFixed(2) : '—');
const minutes = (m) => (m < 1 ? t('arenaUnderMin') : m < 90 ? t('arenaMinutes', { n: Math.round(m) }) : t('arenaHours', { n: (m / 60).toFixed(1) }));
// rough work per match (seconds of one thread), for the time estimate
const COST = { duel: 1, tdm: 9, classic: 6, ffa: 7, bomb: 25 };
// played from start.bat on this computer, or from the website
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

export class ArenaScreens {
  // on: { watch() } (main.js plays the watched match)
  constructor(ui, runner, store, on) {
    this.ui = ui;
    this.runner = runner;
    this.store = store;
    this.on = on;
    this.tab = 'chars';
    this.statTab = 'board';
    this.sel = null;       // the character open in the editor
    this.view = null;      // characters tab: null (editor) | 'clans'; saves tab: 'new'
    this.ask = null;       // a question waiting for yes / no: { text, yes }
    this.sort = { key: 'r', dir: -1 };
    this.showRetired = false;
    this.statChar = null;
    this.mapFilter = 'all';
    this.fightFilter = 'all';
    this.liveEl = null;
    this.liveTimer = 0;
    this.season = new SeasonScreens(this);
    this.betAsk = null;    // a bet window over the tab (seasonui.js betBox)
    this.liveBet = null;   // the bet on the match being watched
    this.watchTab = 'battle'; // where "Back to Bot Arena" returns
    this.clipFilter = { kind: 'all', who: 'all', season: 'all', sort: 'best' };
    runner.on((ev) => this.runnerEvent(ev));
  }

  minutes(m) {
    return minutes(m);
  }

  // ---------------------------------------------------------------- watching
  // The next match to watch (want: a competition's match or series), with
  // the chance to bet on it first.
  watchNext(want = null, tab = this.tab) {
    const r = this.runner;
    this.watchTab = tab;
    this.tab = tab;
    if (!this.isOpen()) this.open(tab);
    const spec = r.takeLive(want);
    if (!spec) {
      // why not: a knockout round waits for Play, the threads have it all, or it's over
      const comp = r.kind === 'season' || r.kind === 'cup' ? r.kind : null;
      const save = r.save || this.save;
      this.notice(comp && koWaiting(save, comp) ? t('ssRoundWaits') : !r.busy() ? t('arenaNothingNow') : t(comp ? 'arenaNothingToWatchComp' : 'arenaNothingToWatch'));
      return false;
    }
    this.betAsk = this.season.matchBetAsk(spec, (bet) => {
      this.liveBet = bet;
      this.betAsk = null;
      this.on.watch(spec);
    }, () => r.dropLive());
    this.redraw();
    return true;
  }

  // the watched match is over (res) or was left (null): its bet settles; a
  // line for the match-end screen
  liveOver(res) {
    const b = this.liveBet;
    this.liveBet = null;
    if (!b) return '';
    const save = this.runner.save || this.save;
    const pay = settleMatch(save, b, res);
    this.touch(true);
    if (!res) return '';
    const name = escapeHtml(b.pickName || '');
    const won = b.ffa ? res.order?.[0] === b.pick : res.winner != null && res.winner === b.pick;
    const line = res.winner == null && !b.ffa ? t('betRefundLine', { c: coins(b.stake) })
      : won ? t('betWonLine', { name, c: coins(pay - b.stake) }) : t('betLostLine', { name, c: coins(b.stake) });
    return `<span class="${won ? 'won' : 'lost'}">${line}</span> <span class="ar-sub">${t('betNowHave', { c: coins(walletOf(save).coins) })}</span>`;
  }

  // ---------------------------------------------------------------- highlights
  clipTitle(c) {
    return `${c.starName}: ${t('clip_' + c.kind, { n: c.n })}` + (c.final && c.kind !== 'final' ? ' · ' + t('clipInFinal') : '');
  }

  openClips() {
    this.season.sub = 'clips';
    this.open('season');
  }

  clipsView() {
    const ui = this.ui, save = this.save, f = this.clipFilter;
    const all = save.clips || [];
    const BIG = new Set(['knife', 'defuse', 'final', 'upset']);
    const keep = (c) => (f.kind === 'all' || c.kind === f.kind || (f.kind === 'big' && BIG.has(c.kind)) || (f.kind === 'fav' && c.fav)) &&
      (f.who === 'all' || c.star === f.who) && (f.season === 'all' || String(c.season) === f.season);
    const list = all.filter(keep).sort((a, b) => (f.sort === 'new' ? b.at - a.at : b.score - a.score));
    const chars = [...new Map(all.map((c) => [c.star, c.starName])).entries()];
    const seasons = [...new Set(all.map((c) => c.season).filter((x) => x != null))].sort((a, b) => b - a);
    const sel = (key, opts) => ui.select(f[key], opts, (v) => { f[key] = v; this.redraw(); });
    const play = (c, from) => {
      this.on.replay(save, c, from).then((ok) => {
        if (ok === true) return;
        // a recording the browser threw away: its line goes too
        if (ok === 'gone') {
          removeClip(save, c);
          this.touch(true);
        }
        this.notice(t('clipMissing'));
      });
    };
    const where = (c) => (c.season != null ? t('ssSeasonShort', { n: c.season }) : c.comp === 'cup' ? t('ssCupTitle', { n: c.cn }) : t('clipBattle'));
    const byId = new Map(save.chars.map((c) => [c.id, c]));
    return h('div', {},
      h('div', { class: 'ar-filters' },
        sel('kind', [['all', t('clipAll')], ['ace', t('clipKind_ace')], ['clutch', t('clipKind_clutch')], ['multi', t('clipKind_multi')], ['big', t('clipKind_big')], ['fav', t('clipFavs')]]),
        sel('who', [['all', t('clipEveryone')], ...chars.map(([id, name]) => [id, name])]),
        sel('season', [['all', t('clipAllSeasons')], ...seasons.map((n) => [String(n), t('ssNewSeason', { n })])]),
        sel('sort', [['best', t('clipBest')], ['new', t('clipNewest')]]),
        h('span', { class: 'ar-grow' }),
        list.length ? ui.btn(t('clipReel', { n: Math.min(10, list.length) }), () => play(list[0], list.slice(0, 10)), true) : null),
      h('div', { class: 'vgui-desc' }, t('clipsDesc', { n: all.length, max: MAX_CLIPS })),
      list.length ? h('table', { class: 'ar-table clips' },
        h('tr', {}, h('th', {}, '★'), h('th', {}, t('clipWhat')), h('th', {}, t('map')), h('th', {}, t('arenaFight')), h('th', {}, t('clipWhere')),
          h('th', {}, t('clipLen')), h('th', {}, t('clipScore')), h('th', {}), h('th', {})),
        list.map((c) => h('tr', {},
          h('td', {}, h('button', { class: 'ar-star' + (c.fav ? ' on' : ''), title: t('clipFavTip'), onclick: () => { c.fav = !c.fav; this.touch(); this.redraw(); } }, c.fav ? '★' : '☆')),
          h('td', { class: 'nm' }, h('i', { class: 'ar-dot', style: `background:${byId.get(c.star)?.color || '#888'}` }), ' ' + this.clipTitle(c)),
          h('td', {}, c.map), h('td', {}, t('fight_' + c.type)), h('td', {}, where(c) + ' · #' + c.match),
          h('td', {}, Math.round(c.len) + ' s'), h('td', {}, String(Math.round(c.score))),
          h('td', {}, h('button', { class: 'vgui-btn small', onclick: () => play(c, list) }, t('clipWatch'))),
          h('td', {}, h('button', { class: 'vgui-btn small', onclick: () => { removeClip(save, c); this.touch(true); this.redraw(); } }, '✕')))))
        : h('div', { class: 'vgui-desc' }, t(all.length ? 'clipNoneHere' : 'clipNone')));
  }

  // the match-end screen offers another match to watch
  canWatchMore() {
    const r = this.runner;
    return r.busy() && !!r.src && !r.src.finished();
  }

  get save() {
    const st = this.store;
    let save = st.saves.find((s) => s.id === st.current);
    // (the current one gone: the first one takes over)
    if (!save && st.saves.length) {
      save = st.saves[0];
      st.current = save.id;
    }
    return save || null;
  }

  open(tab) {
    if (tab) this.tab = tab;
    this.ask = null;
    this.ui.dialog = { name: 'arena', render: () => this.render() };
    this.ui.renderAll();
  }

  isOpen() {
    return this.ui.dialog?.name === 'arena';
  }

  redraw() {
    if (!this.isOpen()) return;
    // keep the scroll of the lists where it was
    const keep = [...this.ui.layer.querySelectorAll('.ar-scroll')].map((e) => e.scrollTop);
    this.ui.renderAll();
    this.ui.layer.querySelectorAll('.ar-scroll').forEach((e, i) => { if (keep[i]) e.scrollTop = keep[i]; });
  }

  // something in the store changed: write it down soon
  touch(now = false) {
    this.runner.persist(now);
  }

  confirm(text, yes) {
    this.ask = { text, yes };
    this.redraw();
  }

  // a message with just an OK
  notice(text) {
    this.ask = { text, yes: null };
    this.redraw();
  }

  runnerEvent(ev) {
    if (!this.isOpen()) return;
    if (ev.type === 'storeFull' && !this.ask) {
      this.notice(t('arenaStoreFull'));
      return;
    }
    if (this.tab === 'season') {
      // a season changes shape (league to playoffs, the end): draw it all again
      const c = this.save?.[this.season.sub === 'cup' ? 'cup' : 'season'];
      const shape = c ? c.phase + '|' + (c.po ? [c.po.solo, c.po.clan] : [c.bracket]).map((b) => (b ? b.cur + ':' + b.go : '')).join() : '';
      if (ev.type === 'finished' || ev.type === 'state' || shape !== this.seasonShape) {
        this.seasonShape = shape;
        if (!this.betAsk) this.redraw();
        return;
      }
      if (!this.liveTimer && !this.betAsk) {
        this.liveTimer = setTimeout(() => {
          this.liveTimer = 0;
          const el = this.season.liveEl;
          if (el && el.isConnected) {
            if (this.season.sub === 'cup') this.season.fillCup(el);
            else this.season.fillSeason(el);
          }
        }, 350);
      }
      return;
    }
    if (ev.type === 'finished' || (ev.type === 'state' && this.tab === 'battle')) {
      this.redraw();
      return;
    }
    if (this.tab === 'battle' && this.liveEl && !this.liveTimer) {
      // a few updates a second at most
      this.liveTimer = setTimeout(() => {
        this.liveTimer = 0;
        if (this.liveEl && this.liveEl.isConnected) this.fillLive(this.liveEl);
      }, 350);
    }
  }

  // ---------------------------------------------------------------- window
  render() {
    const ui = this.ui, save = this.save;
    if (!save && this.tab !== 'saves') this.tab = 'saves';
    const tabs = [['chars', t('arenaTabChars')], ['battle', t('arenaTabBattle')], ['season', t('arenaTabSeason')], ['stats', t('arenaTabStats')], ['saves', t('arenaTabSaves')]];
    const tabBar = h('div', { class: 'vgui-tabs' }, tabs.map(([id, label]) => h('button', {
      class: 'vgui-tab' + (this.tab === id ? ' on' : ''), disabled: !save && id !== 'saves',
      onclick: () => { ui.click(); this.tab = id; this.view = null; this.ask = null; this.redraw(); },
    }, label)));
    let content;
    // a bet window goes over whatever tab is open
    if (this.betAsk && save) content = this.season.betBox(this.betAsk);
    else if (this.tab === 'saves') content = this.savesTab();
    else if (this.tab === 'chars') content = this.charsTab();
    else if (this.tab === 'battle') content = this.battleTab();
    else if (this.tab === 'season') content = this.season.render();
    else content = this.statsTab();
    const ask = !this.ask ? null : this.ask.yes
      ? h('div', { class: 'ar-ask' }, h('span', {}, this.ask.text),
        ui.btn(t('yes'), () => { const f = this.ask.yes; this.ask = null; f(); this.redraw(); }, true),
        ui.btn(t('no'), () => { this.ask = null; this.redraw(); }))
      : h('div', { class: 'ar-ask' }, h('span', {}, this.ask.text), ui.btn(t('ok'), () => { this.ask = null; this.redraw(); }, true));
    const title = t('botArena') + (save ? ' — ' + save.name : '');
    return ui.win(title, h('div', { class: 'ar' }, tabBar, ask, h('div', { class: 'vgui-tabbody ar-body' }, content)),
      [ui.btn(t('close'), () => ui.closeDialog(), true)], 'w-arena');
  }

  input(value, onchange, attrs = {}) {
    return h('input', { class: 'vgui-input', value, ...attrs, oninput: (e) => onchange(e.target.value, false), onchange: (e) => onchange(e.target.value, true) });
  }

  // ---------------------------------------------------------------- saves
  savesTab() {
    const ui = this.ui, save = this.save;
    if (this.view === 'new' || !this.store.saves.length) return this.newSaveForm();
    const busy = this.runner.busy();
    const list = h('div', { class: 'ar-list ar-scroll' }, this.store.saves.map((s) => h('button', {
      class: 'ar-item' + (s === save ? ' on' : ''),
      onclick: () => {
        ui.click();
        if (s === save) return;
        if (busy) {
          this.notice(t('arenaBusySwitch'));
          return;
        }
        this.store.current = s.id;
        this.sel = null;
        this.statChar = null;
        this.touch(true);
        this.redraw();
      },
    }, h('b', {}, s.name), h('span', { class: 'ar-sub' }, t('arenaSaveLine', {
      n: s.matches, c: s.chars.filter((c) => !c.retired).length, mode: t('skillMode_' + s.settings.skillMode), evo: t('evolve_' + s.settings.evolve),
    })))));
    const btns = h('div', { class: 'ar-btns' },
      ui.btn(t('arenaNewSave'), () => { this.view = 'new'; this.newForm = null; this.redraw(); }),
      ui.btn(t('arenaCopySave'), () => {
        const copy = cleanSave(JSON.parse(JSON.stringify(save)));
        copy.id = newId();
        copy.name = (save.name + ' ' + t('arenaCopySuffix')).slice(0, 30);
        copy.run = null;
        copy.clips = [];
        this.store.saves.push(copy);
        this.store.current = copy.id;
        this.touch(true);
        this.redraw();
      }),
      ui.btn(t('arenaDeleteSave'), () => {
        if (busy && this.runner.save === save) {
          this.notice(t('arenaBusyDelete'));
          return;
        }
        this.confirm(t('arenaDeleteSaveQ', { name: save.name }), () => {
          dropSaveClips(save);
          this.store.saves = this.store.saves.filter((s) => s !== save);
          this.store.current = this.store.saves[0]?.id || null;
          this.sel = null;
          this.touch(true);
        });
      }));
    const st = save.settings, practice = st.skillMode === 'practice';
    const form = h('div', { class: 'vgui-form ar-form' },
      h('div', { class: 'ar-head' }, t('arenaSaveSettings')),
      ui.row(t('arenaSaveName'), this.input(save.name, (v, done) => {
        save.name = (v.trim() || save.name).slice(0, 30);
        this.touch();
        if (done) this.redraw();
      }, { maxlength: 30 })),
      ui.row(t('arenaSkillMode'), h('span', { class: 'ar-fixed' }, t('skillMode_' + st.skillMode) + (practice ? ' · ' + t('start_' + st.start) : ''))),
      h('div', { class: 'vgui-desc' }, t('skillModeDesc_' + st.skillMode) + ' ' + t('arenaSkillModeFixed')),
      practice ? ui.row(t('arenaLearn'), ui.slider(st.learn, 0.25, 4, 0.25, (v) => { st.learn = v; this.touch(); }, (v) => v + '×')) : null,
      practice ? h('div', { class: 'vgui-desc' }, t('arenaLearnDesc')) : null,
      ui.row(t('arenaEvolve'), ui.select(st.evolve, ['off', 'tune', 'gen'].map((v) => [v, t('evolve_' + v)]), (v) => { st.evolve = v; this.touch(); this.redraw(); })),
      h('div', { class: 'vgui-desc' }, t('evolveDesc_' + st.evolve)),
      st.evolve === 'tune' ? ui.row(t('arenaTuneEvery'), ui.select(st.tuneEvery, [10, 20, 30, 50, 100].map((n) => [n, String(n)]), (v) => { st.tuneEvery = +v; this.touch(); })) : null,
      st.evolve === 'gen' ? ui.row(t('arenaGenEvery'), ui.select(st.genEvery, [50, 100, 200, 300, 500, 1000].map((n) => [n, String(n)]), (v) => { st.genEvery = +v; this.touch(); })) : null,
      h('div', { class: 'ar-btns' }, ui.btn(t('arenaResetStats'), () => this.confirm(t('arenaResetStatsQ'), () => {
        save.stats = {};
        save.h2h = {};
        save.log = [];
        save.evoLog = [];
        save.matches = 0;
        save.run = null;
        this.touch(true);
      }))),
      h('div', { class: 'vgui-desc' }, t('arenaResetStatsDesc')));
    return h('div', { class: 'ar-cols' }, h('div', { class: 'ar-left' }, h('div', { class: 'ar-head' }, t('arenaSaves')), list, btns), h('div', { class: 'ar-right ar-scroll' }, form));
  }

  newSaveForm() {
    const ui = this.ui;
    const f = (this.newForm ||= { name: t('arenaSaveDefault', { n: this.store.saves.length + 1 }), skillMode: 'free', start: 'editor', learn: 1, evolve: 'off' });
    const practice = f.skillMode === 'practice';
    return h('div', { class: 'vgui-form ar-form ar-new' },
      h('div', { class: 'ar-head' }, t('arenaNewSaveTitle')),
      this.store.saves.length ? null : h('div', { class: 'vgui-desc' }, t('arenaFirstSave')),
      ui.row(t('arenaSaveName'), this.input(f.name, (v) => { f.name = v; }, { maxlength: 30 })),
      ui.row(t('arenaSkillMode'), ui.select(f.skillMode, [['free', t('skillMode_free')], ['practice', t('skillMode_practice')]], (v) => { f.skillMode = v; this.redraw(); })),
      h('div', { class: 'vgui-desc' }, t('skillModeDesc_' + f.skillMode)),
      practice ? ui.row(t('arenaStartSkills'), ui.select(f.start, [['same', t('start_same')], ['editor', t('start_editor')]], (v) => { f.start = v; this.redraw(); })) : null,
      practice ? h('div', { class: 'vgui-desc' }, t('startDesc_' + f.start)) : null,
      practice ? ui.row(t('arenaLearn'), ui.slider(f.learn, 0.25, 4, 0.25, (v) => { f.learn = v; }, (v) => v + '×')) : null,
      ui.row(t('arenaEvolve'), ui.select(f.evolve, ['off', 'tune', 'gen'].map((v) => [v, t('evolve_' + v)]), (v) => { f.evolve = v; this.redraw(); })),
      h('div', { class: 'vgui-desc' }, t('evolveDesc_' + f.evolve)),
      h('div', { class: 'ar-btns' },
        ui.btn(t('arenaCreate'), () => {
          const s = newSave(f.name.trim() || t('arenaSaveDefault', { n: this.store.saves.length + 1 }), f, [1, 2, 3, 4].map((i) => t('clanName' + i)));
          s.setup = cleanSave(s).setup;
          this.store.saves.push(s);
          this.store.current = s.id;
          this.newForm = null;
          this.view = null;
          this.sel = null;
          this.tab = 'chars';
          this.touch(true);
          this.redraw();
        }, true),
        this.store.saves.length ? ui.btn(t('cancel'), () => { this.view = null; this.redraw(); }) : null));
  }

  // ---------------------------------------------------------------- characters
  charsTab() {
    const ui = this.ui, save = this.save;
    const live = save.chars.filter((c) => !c.retired), retired = save.chars.filter((c) => c.retired);
    if (!this.sel || !save.chars.some((c) => c.id === this.sel)) this.sel = live[0]?.id || null;
    const item = (c) => h('button', {
      class: 'ar-item ar-char' + (c.id === this.sel && this.view !== 'clans' ? ' on' : '') + (c.retired ? ' gone' : ''),
      onclick: () => { ui.click(); this.sel = c.id; this.view = null; this.redraw(); },
    },
    h('i', { class: 'ar-dot', style: `background:${c.color}` }),
    h('span', { class: 'ar-name' }, h('b', { 'data-name': c.id }, c.name), hacksOn(c).length ? h('em', { class: 'hk' }, ' ' + t('hackTag')) : null),
    h('span', { class: 'ar-sub' }, `${t('style_' + c.style)} · ${gunName(c.gun)}`),
    h('span', { class: 'ar-rt' }, String(Math.round(statsOf(save, c.id).r))));
    const list = h('div', { class: 'ar-list ar-scroll' }, live.map(item),
      retired.length ? h('button', { class: 'ar-subhead', onclick: () => { this.showRetired = !this.showRetired; this.redraw(); } },
        (this.showRetired ? '▾ ' : '▸ ') + t('arenaRetired', { n: retired.length })) : null,
      this.showRetired ? retired.map(item) : null);
    const btns = h('div', { class: 'ar-btns' },
      ui.btn(t('arenaNewChar'), () => this.addChar(null)),
      ui.btn(t('arenaCopyChar'), () => this.addChar(save.chars.find((c) => c.id === this.sel))),
      ui.btn(t('arenaDeleteChar'), () => this.deleteChar(save.chars.find((c) => c.id === this.sel))),
      ui.btn(t('arenaClans'), () => { this.view = this.view === 'clans' ? null : 'clans'; this.redraw(); }));
    const right = this.view === 'clans' ? this.clansView() : this.editor(save.chars.find((c) => c.id === this.sel));
    return h('div', { class: 'ar-cols' },
      h('div', { class: 'ar-left' }, h('div', { class: 'ar-head' }, t('arenaCharsN', { n: live.length })), list, btns),
      h('div', { class: 'ar-right ar-scroll' }, right));
  }

  addChar(from) {
    const save = this.save;
    const used = new Set(save.chars.map((c) => c.color));
    const src = from ? JSON.parse(JSON.stringify(from)) : {
      style: 'careful', gun: 'ak47', pistol: 'usp',
      skills: Object.fromEntries(SKILLS.map((k) => [k, BASE_SKILL])),
      habits: Object.fromEntries(HABITS.map((k) => [k, 50])),
    };
    const c = cleanChar({
      ...src, id: null, gen: 0, parents: [], retired: false, tune: null, born: save.matches,
      name: from ? (from.name + ' 2').slice(0, 20) : t('arenaNewName', { n: save.chars.length + 1 }),
      color: COLORS.find((x) => !used.has(x)) || COLORS[save.chars.length % COLORS.length],
    }, save.chars.length);
    // practice saves: a newcomer starts fresh (or where the editor puts it)
    if (save.settings.skillMode === 'practice') {
      for (const k of SKILLS) {
        if (save.settings.start === 'same') c.skills[k] = BASE_SKILL;
        c.start[k] = c.peak[k] = c.skills[k];
      }
    }
    save.chars.push(c);
    if (save.setup && Array.isArray(save.setup.chars)) save.setup.chars.push(c.id);
    this.sel = c.id;
    this.view = null;
    this.touch();
    this.redraw();
  }

  deleteChar(c) {
    const save = this.save;
    if (!c) return;
    if (save.chars.filter((x) => !x.retired && x !== c).length < 2) {
      this.notice(t('arenaKeepTwo'));
      return;
    }
    if (compOpen(save)) {
      this.notice(t('arenaInComp'));
      return;
    }
    this.confirm(t('arenaDeleteCharQ', { name: c.name }), () => {
      save.chars = save.chars.filter((x) => x !== c);
      delete save.stats[c.id];
      delete save.h2h[c.id];
      for (const row of Object.values(save.h2h)) delete row[c.id];
      for (const cl of save.clans) cl.members = cl.members.filter((id) => id !== c.id);
      if (save.setup && Array.isArray(save.setup.chars)) save.setup.chars = save.setup.chars.filter((id) => id !== c.id);
      this.sel = null;
      this.touch();
    });
  }

  editor(c) {
    const ui = this.ui, save = this.save;
    if (!c) return h('div', { class: 'vgui-desc' }, t('arenaNoChar'));
    const practice = save.settings.skillMode === 'practice';
    const st = statsOf(save, c.id);
    // practice saves: the start can be set until the character has played
    const setStart = practice && save.settings.start === 'editor' && st.m === 0;
    const ch = (redraw) => { this.touch(); if (redraw) this.redraw(); };
    const color = h('input', {
      type: 'color', class: 'ch-picker', value: c.color,
      oninput: (e) => { c.color = e.target.value; const dot = this.ui.layer.querySelector('.ar-char.on .ar-dot'); if (dot) dot.style.background = c.color; ch(); },
    });
    const name = this.input(c.name, (v, done) => {
      c.name = (v.trim() || c.name).slice(0, 20);
      const el = this.ui.layer.querySelector(`[data-name="${c.id}"]`);
      if (el) el.textContent = c.name;
      ch(done);
    }, { maxlength: 20 });
    const skillRows = SKILLS.map((k) => {
      if (!practice || setStart) {
        return ui.row(t('skill_' + k), ui.slider(Math.round(c.skills[k]), 0, 100, 1, (v) => {
          c.skills[k] = v;
          if (practice) c.start[k] = c.peak[k] = v;
          ch();
        }));
      }
      // practice: what it has reached by playing (a bar; the mark is its best)
      return ui.row(t('skill_' + k), h('div', { class: 'ar-bar', title: t('arenaSkillTip', { now: c.skills[k].toFixed(1), peak: c.peak[k].toFixed(1), start: Math.round(c.start[k]) }) },
        h('i', { style: `width:${c.skills[k]}%` }),
        h('u', { style: `left:${c.peak[k]}%` }),
        h('span', {}, c.skills[k].toFixed(1))));
    });
    const habitRows = HABITS.map((k) => h('div', {},
      ui.row(t('habit_' + k), ui.slider(c.habits[k], 0, 100, 1, (v) => { c.habits[k] = v; ch(); }))));
    // hacks: a trait like any other (the battle allows them when someone has one)
    const hc = c.hackCfg;
    const hackGrid = h('div', { class: 'hk-grid' }, HACKS.map((k) => ui.check(t('hack_' + k), c.hacks[k], (v) => { c.hacks[k] = v; ch(true); })));
    const hackSliders = [];
    if (c.hacks.aimbot) {
      hackSliders.push(
        ui.row(t('aimSmooth'), ui.slider(hc.aimSmooth, 0, 1, 0.05, (v) => { hc.aimSmooth = v; ch(); }, (v) => Math.round(v * 100) + '%')),
        ui.row(t('aimFov'), ui.slider(hc.aimFov, 1, 180, 1, (v) => { hc.aimFov = v; ch(); }, (v) => v + '°')),
        ui.row(t('aimBone'), ui.select(hc.aimBone, [['head', t('aimBone_head')], ['body', t('aimBone_body')]], (v) => { hc.aimBone = v; ch(); })));
    }
    if (c.hacks.triggerbot) hackSliders.push(ui.row(t('trigDelay'), ui.slider(hc.trigDelay, 0, 300, 10, (v) => { hc.trigDelay = v; ch(); }, (v) => v + ' ms')));
    if (c.hacks.speedhack) hackSliders.push(ui.row(t('hackSpeed'), ui.slider(hc.speed, 1.2, 3, 0.1, (v) => { hc.speed = v; ch(); }, (v) => v.toFixed(1) + '×')));
    const byId = new Map(save.chars.map((x) => [x.id, x]));
    const kids = save.chars.filter((x) => x.parents.includes(c.id));
    const family = [];
    if (c.gen) family.push(t('arenaGen', { n: c.gen }));
    if (c.parents.length) family.push(t('arenaParents', { names: c.parents.map((id) => byId.get(id)?.name || '?').join(' + ') }));
    if (kids.length) family.push(t('arenaKids', { names: kids.map((x) => x.name).join(', ') }));
    if (c.retired) family.push(t('arenaRetiredAt', { n: c.retiredAt }));
    return h('div', { class: 'ar-editor' },
      h('div', { class: 'ar-ed-top' },
        h('i', { class: 'ar-dot big', style: `background:${c.color}` }),
        name, color,
        h('span', { class: 'ar-sub' }, t('arenaRatingN', { n: Math.round(st.r) }) + ' · ' + t('arenaMatchesN', { n: st.m }))),
      family.length ? h('div', { class: 'vgui-desc ar-family' }, family.join(' · ')) : null,
      h('div', { class: 'ar-ed-cols' },
        h('div', { class: 'ar-ed-col' },
          h('div', { class: 'hk-sub' }, t('arenaPlay')),
          ui.row(t('arenaStyle'), ui.select(c.style, STYLES.map((s) => [s, t('style_' + s)]), (v) => { c.style = v; ch(true); })),
          h('div', { class: 'vgui-desc' }, t('styleDesc_' + c.style)),
          ui.row(t('arenaPers'), ui.select(c.pers, PERSONALITIES.map((p) => [p, t('pers_' + p)]), (v) => { c.pers = v; ch(true); })),
          h('div', { class: 'vgui-desc' }, t('persDesc_' + c.pers)),
          ui.row(t('arenaGun'), ui.select(c.gun, GUN_CHOICES.map((g) => [g, gunName(g)]), (v) => { c.gun = v; ch(true); })),
          ui.row(t('arenaPistol'), ui.select(c.pistol, PISTOL_CHOICES.map((g) => [g, gunName(g)]), (v) => { c.pistol = v; ch(); })),
          h('div', { class: 'vgui-desc' }, t('arenaGunDesc')),
          h('div', { class: 'hk-sub' }, t('arenaHabits')),
          habitRows),
        h('div', { class: 'ar-ed-col' },
          h('div', { class: 'hk-sub' }, t('arenaSkills')),
          h('div', { class: 'vgui-desc' }, practice ? (setStart ? t('arenaSkillsStart') : t('arenaSkillsPractice')) : t('arenaSkillsFree')),
          skillRows,
          h('div', { class: 'hk-sub' }, t('hacks')),
          h('div', { class: 'vgui-desc' }, t('arenaHacksDesc')),
          hackGrid,
          hackSliders.length ? h('div', { class: 'hk-sliders' }, hackSliders) : null)));
  }

  // clans: named groups of characters that play together (clan battles)
  clansView() {
    const ui = this.ui, save = this.save;
    const live = save.chars.filter((c) => !c.retired);
    const clanOf = (id) => save.clans.find((cl) => cl.members.includes(id));
    const rows = save.clans.map((cl) => h('div', { class: 'ar-clan' },
      h('input', { type: 'color', class: 'ch-picker', value: cl.color, oninput: (e) => { cl.color = e.target.value; this.touch(); } }),
      this.input(cl.name, (v, done) => { cl.name = (v.trim() || cl.name).slice(0, 24); this.touch(); if (done) this.redraw(); }, { maxlength: 24 }),
      h('span', { class: 'ar-sub' }, t('arenaMembersN', { n: cl.members.length })),
      ui.btn(t('arenaDeleteClan'), () => {
        if (compOpen(save)) return this.notice(t('arenaClanInComp'));
        save.clans = save.clans.filter((x) => x !== cl);
        this.touch();
        this.redraw();
      })));
    const members = h('div', { class: 'ar-members' }, live.map((c) => {
      const cur = clanOf(c.id);
      return ui.row(h('span', {}, h('i', { class: 'ar-dot', style: `background:${c.color}` }), ' ' + c.name),
        ui.select(cur ? cur.id : '', [['', t('arenaNoClan')], ...save.clans.map((cl) => [cl.id, cl.name])], (v) => {
          // a character is in one clan at most
          for (const cl of save.clans) cl.members = cl.members.filter((id) => id !== c.id);
          const to = save.clans.find((cl) => cl.id === v);
          if (to) to.members.push(c.id);
          this.touch();
          this.redraw();
        }));
    }));
    return h('div', { class: 'ar-clans' },
      h('div', { class: 'ar-head' }, t('arenaClans')),
      h('div', { class: 'vgui-desc' }, t('arenaClansDesc')),
      rows,
      h('div', { class: 'ar-btns' },
        save.clans.length ? null : ui.btn(t('arenaReadyClans'), () => {
          save.clans = readyClans(save.chars, [1, 2, 3, 4].map((i) => t('clanName' + i)));
          this.touch();
          this.redraw();
        }),
        ui.btn(t('arenaNewClan'), () => {
        save.clans.push({ id: newId(), name: t('arenaClanN', { n: save.clans.length + 1 }), color: COLORS[(save.clans.length * 7 + 3) % COLORS.length], members: [] });
        this.touch();
        this.redraw();
      })),
      save.clans.length ? [h('div', { class: 'hk-sub' }, t('arenaWhoWhere')), members] : null);
  }

  // ---------------------------------------------------------------- battle
  battleTab() {
    const r = this.runner, ui = this.ui;
    if (r.busy() && r.save === this.save && r.kind !== 'battle') {
      return h('div', { class: 'vgui-form' }, h('div', { class: 'vgui-desc' }, t(r.kind === 'cup' ? 'arenaCupBusy' : 'arenaSeasonBusy')),
        ui.btn(t('arenaGoSeason'), () => { this.tab = 'season'; this.season.sub = r.kind === 'cup' ? 'cup' : 'season'; this.redraw(); }));
    }
    if (r.busy() && r.save === this.save) return this.battleLive();
    if (r.busy()) {
      return h('div', { class: 'vgui-form' }, h('div', { class: 'vgui-desc' }, t('arenaOtherBusy', { name: r.save.name })),
        ui.btn(t('arenaGoThere'), () => { this.store.current = r.save.id; this.redraw(); }));
    }
    this.liveEl = null;
    return this.battleSetup();
  }

  battleSetup() {
    const ui = this.ui, save = this.save, s = save.setup;
    const live = save.chars.filter((c) => !c.retired);
    const ch = (redraw = true) => { this.touch(); if (redraw) this.redraw(); };
    const inBattle = (id) => !s.chars || s.chars.includes(id);
    const chars = h('div', { class: 'ar-pick' }, live.map((c) => ui.check(h('span', {}, h('i', { class: 'ar-dot', style: `background:${c.color}` }), ' ' + c.name), inBattle(c.id), (v) => {
      const ids = s.chars ? [...s.chars] : live.map((x) => x.id);
      s.chars = v ? [...new Set([...ids, c.id])] : ids.filter((id) => id !== c.id);
      ch();
    })));
    const maps = h('div', { class: 'ar-pick maps' }, MAP_LIST.map((m) => ui.check(m, s.maps.includes(m), (v) => {
      s.maps = v ? [...new Set([...s.maps, m])] : s.maps.filter((x) => x !== m);
      ch();
    })));
    const num = (list, v, set, fmt = String) => ui.select(v, list.map((n) => [n, fmt(n)]), (x) => { set(+x); ch(false); });
    const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    const fightRow = (f) => {
      const o = s.fights[f];
      const parts = [ui.check(t('fight_' + f), o.on, (v) => { o.on = v; ch(); })];
      if (o.on) {
        if (f === 'ffa') parts.push(h('span', { class: 'ar-lbl' }, t('arenaPlayers')), num(range(3, MAX_FFA), o.size, (v) => { o.size = v; }));
        else if (f !== 'duel') parts.push(h('span', { class: 'ar-lbl' }, t('arenaTeamSize')), num(range(1, MAX_SIDE), o.size, (v) => { o.size = v; }, (n) => `${n} v ${n}`));
        if ('kills' in o) parts.push(h('span', { class: 'ar-lbl' }, t('arenaToKills')), num([5, 10, 15, 20, 25, 30, 50, 75, 100, 150], o.kills, (v) => { o.kills = v; }));
        else parts.push(h('span', { class: 'ar-lbl' }, t('arenaToRounds')), num([3, 4, 5, 8, 10, 13, 16], o.rounds, (v) => { o.rounds = v; }));
      }
      return h('div', { class: 'ar-fight' + (o.on ? '' : ' off') }, parts, h('div', { class: 'vgui-desc' }, t('fightDesc_' + f)));
    };
    const reason = battleCheck(save, s);
    const workers = this.store.workers || DEFAULT_WORKERS;
    // a rough guess of how long it takes
    const on = FIGHTS.filter((f) => s.fights[f].on && (f !== 'bomb' || s.maps.some((m) => BOMB_MAPS.has(m))));
    const avg = on.length ? on.reduce((sum, f) => sum + COST[f] * (f === 'duel' ? 1 : s.fights[f].size / (f === 'ffa' ? 10 : 5)), 0) / on.length : 0;
    const est = (s.count * avg) / workers / 60;
    const left = save.run ? save.run.total - save.run.done : 0;
    return h('div', { class: 'ar-setup ar-scroll' },
      h('div', { class: 'ar-cols' },
        h('div', { class: 'ar-left' },
          h('div', { class: 'ar-head' }, t('arenaWho'),
            h('span', { class: 'ar-links' },
              h('a', { href: '#', onclick: (e) => { e.preventDefault(); s.chars = null; ch(); } }, t('arenaAll')),
              h('a', { href: '#', onclick: (e) => { e.preventDefault(); s.chars = []; ch(); } }, t('arenaNone')))),
          chars,
          h('div', { class: 'ar-head' }, t('arenaMaps')),
          maps,
          h('div', { class: 'vgui-desc' }, t('arenaMapsDesc'))),
        h('div', { class: 'ar-right' },
          h('div', { class: 'ar-head' }, t('arenaFights')),
          FIGHTS.map(fightRow),
          ui.row(t('arenaTeams'), ui.select(s.teams, [['random', t('teams_random')], ['clans', t('teams_clans')]], (v) => { s.teams = v; ch(); })),
          h('div', { class: 'vgui-desc' }, t('teamsDesc_' + s.teams)),
          ui.row(t('arenaCount'), num([10, 50, 100, 250, 500, 1000, 2000, 5000, 10000], s.count, (v) => { s.count = v; ch(); })),
          ui.row(t('arenaThreads'), ui.select(workers, range(1, MAX_WORKERS).map((n) => [n, String(n)]), (v) => { this.store.workers = +v; ch(); })),
          h('div', { class: 'vgui-desc' }, t('arenaThreadsDesc')),
          reason ? h('div', { class: 'vgui-desc hk-off' }, t(reason)) : h('div', { class: 'vgui-desc ar-est' }, t('arenaEstimate', { time: minutes(est) })),
          h('div', { class: 'ar-btns' },
            ui.btn(t('arenaStart'), () => {
              if (reason) return;
              this.runner.start(save, workers);
              this.redraw();
            }, true),
            left > 0 ? ui.btn(t('arenaContinue', { n: left }), () => { if (this.runner.resumeSaved(save, workers)) this.redraw(); }) : null))));
  }

  battleLive() {
    const el = h('div', { class: 'ar-live' });
    this.liveEl = el;
    this.fillLive(el);
    return el;
  }

  fillLive(el) {
    const ui = this.ui, r = this.runner, save = this.save;
    if (!save || r.save !== save) return;
    const done = r.done, total = r.total;
    const speed = r.speed();
    const left = speed > 0 ? (total - done) / speed : 0;
    const threads = r.workers.filter((w) => !w.retiring).length;
    const byId = new Map(save.chars.map((c) => [c.id, c]));
    const nm = (id) => byId.get(id)?.name || '?';
    const top = save.chars.filter((c) => !c.retired).map((c) => ({ c, s: statsOf(save, c.id) })).sort((a, b) => b.s.r - a.s.r);
    const resultText = (x) => {
      const res = x.result, sp = x.spec;
      if (sp.type === 'ffa') return t('arenaFfaWon', { name: nm(res.order[0]) });
      const side = (i) => res.players.filter((p) => p.side === i).map((p) => nm(p.cid)).join(', ');
      if (res.winner == null) return t('arenaDrawLine', { a: side(0), b: side(1), s: res.score.join(':') });
      return t('arenaWonLine', { w: side(res.winner), l: side(1 - res.winner), s: [res.score[res.winner], res.score[1 - res.winner]].join(':') });
    };
    const playing = r.workers.filter((w) => w.job).map((w) => w.job);
    if (r.live) playing.unshift(r.live);
    // threads load the game before their first match
    const starting = r.state === 'running' && !playing.length && r.starting();
    const status = r.state === 'paused' ? t('arenaPaused') + (r.autoPaused ? ' ' + t('arenaAutoPaused') : '')
      : starting ? t('arenaStarting', { n: r.wanted - starting, of: r.wanted })
        : t('arenaPerMin', { n: speed ? speed.toFixed(1) : '…' });
    const warn = r.state !== 'paused' ? null : r.offline ? t(LOCAL ? 'arenaOffline' : 'arenaOfflineWeb') :r.stuck ? t('arenaStuck') : null;
    el.innerHTML = '';
    // (the lines left out are null: append would write them as text)
    el.append(...[
      h('div', { class: 'ar-prog' }, h('i', { style: `width:${total ? (done / total) * 100 : 0}%` }), h('span', {}, `${done} / ${total}`)),
      h('div', { class: 'ar-runline' },
        h('span', {}, status),
        r.state === 'running' && speed ? h('span', {}, left < 1 ? t('arenaLeftSoon') : t('arenaLeft', { time: minutes(left) })) : null,
        h('span', {}, t('arenaThreads') + ' ', ui.select(threads || r.wanted || this.store.workers || DEFAULT_WORKERS, Array.from({ length: MAX_WORKERS }, (_, i) => [i + 1, String(i + 1)]), (v) => {
          this.store.workers = +v;
          r.setWorkers(+v);
          this.touch();
        })),
        r.errors ? h('span', { class: 'ar-fails' }, t('arenaErrors', { n: r.errors })) : null),
      warn ? h('div', { class: 'ar-warn' }, h('span', {}, warn)) : null,
      // what went wrong last, to read or pass on
      r.errors && r.lastError && !r.offline ? h('div', { class: 'ar-err' },
        h('span', {}, t('arenaLastError')),
        h('code', { title: r.lastError }, r.lastError.split('\n')[0]),
        ui.btn(t('arenaCopyError'), () => {
          navigator.clipboard?.writeText(r.lastError).then(() => this.notice(t('arenaCopied')), () => {});
        })) : null,
      h('div', { class: 'ar-btns' },
        ui.btn(t('arenaWatch'), () => this.watchNext(null, 'battle'), true),
        r.state === 'paused' ? ui.btn(t('arenaResume'), () => { r.resume(); }) : ui.btn(t('arenaPause'), () => { r.pause(); }),
        ui.btn(t('arenaStop'), () => this.confirm(t('arenaStopQ'), () => { r.stop(); }))),
      h('div', { class: 'ar-cols' },
        h('div', { class: 'ar-left' },
          h('div', { class: 'ar-head' }, t('arenaStandings')),
          h('table', { class: 'ar-table small' },
            h('tr', {}, h('th', {}, '#'), h('th', {}, t('name')), h('th', {}, t('arenaRating')), h('th', {}, t('arenaWL')), h('th', {}, 'K/D')),
            top.map((x, i) => h('tr', {},
              h('td', {}, String(i + 1)),
              h('td', {}, h('i', { class: 'ar-dot', style: `background:${x.c.color}` }), ' ' + x.c.name, hacksOn(x.c).length ? h('em', { class: 'hk' }, ' ' + t('hackTag')) : null),
              h('td', {}, String(Math.round(x.s.r))),
              h('td', {}, `${x.s.w}-${x.s.l}${x.s.d ? '-' + x.s.d : ''}`),
              h('td', {}, ratio(x.s.k, x.s.de)))))),
        h('div', { class: 'ar-right' },
          h('div', { class: 'ar-head' }, t('arenaPlaying')),
          h('div', { class: 'ar-feed' }, playing.slice(0, 8).map((sp) => h('div', {},
            h('b', {}, `${t('fight_' + sp.type)} · ${sp.map}`), sp === r.live ? h('em', { class: 'ar-watching' }, ' ' + t('arenaWatching')) : null, ' ',
            h('span', { class: 'ar-sub' }, sp.cfg.arena.players.map((p) => p.ch.name).join(', '))))),
          h('div', { class: 'ar-head' }, t('arenaRecent')),
          h('div', { class: 'ar-feed' }, r.recent.map((x) => h('div', {}, h('b', {}, `${t('fight_' + x.spec.type)} · ${x.spec.map}: `), resultText(x)))),
          save.evoLog.length ? [h('div', { class: 'ar-head' }, t('arenaEvolution')), h('div', { class: 'ar-feed' }, save.evoLog.slice(-5).reverse().map((e) => h('div', {}, this.evoText(e, nm))))] : null)),
    ].filter(Boolean));
  }

  evoText(e, nm) {
    if (e.kind === 'generation') {
      return t('evoGen', { n: e.n, list: e.born.map((b) => t('evoBorn', { kid: nm(b.id), a: nm(b.from[0]), b: nm(b.from[1]), old: nm(b.replaced) })).join('; ') });
    }
    const what = (e.what || []).map((k) => t(SKILLS.includes(k) ? 'skill_' + k : HABITS.includes(k) ? 'habit_' + k : 'evoWhat_' + k)).join(', ');
    return t(e.kind === 'kept' ? 'evoKept' : 'evoReverted', { n: e.n, name: nm(e.id), what });
  }

  // ---------------------------------------------------------------- stats
  statsTab() {
    const ui = this.ui, save = this.save;
    const tabs = [['board', t('arenaBoard')], ['char', t('arenaCharStats')], ['maps', t('arenaByMap')], ['h2h', t('arenaH2h')], ['evo', t('arenaEvolution')]];
    const bar = h('div', { class: 'ar-subtabs' }, tabs.map(([id, label]) => h('button', {
      class: 'ar-subtab' + (this.statTab === id ? ' on' : ''),
      onclick: () => { ui.click(); this.statTab = id; this.redraw(); },
    }, label)),
    h('span', { class: 'ar-grow' }),
    ui.btn(t('arenaExport'), () => this.exportCsv()));
    let body;
    if (!save.matches) body = h('div', { class: 'vgui-desc' }, t('arenaNoStats'));
    else if (this.statTab === 'char') body = this.charStats();
    else if (this.statTab === 'maps') body = this.mapStats();
    else if (this.statTab === 'h2h') body = this.h2hStats();
    else if (this.statTab === 'evo') body = this.evoStats();
    else body = this.board();
    return h('div', { class: 'ar-stats' }, bar, h('div', { class: 'ar-statbody ar-scroll' }, body));
  }

  board() {
    const save = this.save;
    const rows = save.chars.filter((c) => this.showRetired || !c.retired).map((c) => {
      const s = statsOf(save, c.id);
      return {
        c, s, r: s.r, m: s.m, w: s.w, l: s.l, d: s.d, wp: s.m ? s.w / s.m : -1, k: s.k, de: s.de, kd: s.de ? s.k / s.de : s.k,
        hs: s.k ? s.hs / s.k : 0, acc: s.sh ? s.hi / s.sh : 0, dpm: s.m ? s.dmg / s.m : 0, pl: s.pl, df: s.df, hk: s.hk,
      };
    });
    const { key, dir } = this.sort;
    rows.sort((a, b) => (a[key] < b[key] ? -dir : a[key] > b[key] ? dir : b.r - a.r));
    const cols = [['r', t('arenaRating')], ['m', t('csvMatches')], ['w', t('csvWins')], ['l', t('csvLosses')], ['d', t('csvDraws')], ['wp', t('csvWinPct')],
      ['k', t('csvKills')], ['de', t('deaths')], ['kd', 'K/D'], ['hs', t('csvHsPct')], ['acc', t('csvAccuracy')], ['dpm', t('arenaDmgMatch')],
      ['pl', t('csvPlants')], ['df', t('csvDefuses')], ['hk', t('hackKillsCol')]];
    const head = h('tr', {}, h('th', {}, '#'), h('th', {}, t('name')), cols.map(([k, label]) => h('th', {
      class: 'sort' + (key === k ? ' on' : ''),
      onclick: () => { this.sort = { key: k, dir: key === k ? -dir : -1 }; this.redraw(); },
    }, label + (key === k ? (dir < 0 ? ' ▾' : ' ▴') : ''))));
    const cell = (x, k) => {
      switch (k) {
        case 'r': return String(Math.round(x.r));
        case 'wp': return pct(x.w, x.m);
        case 'kd': return ratio(x.k, x.de);
        case 'hs': return pct(x.s.hs, x.k);
        case 'acc': return pct(x.s.hi, x.s.sh);
        case 'dpm': return String(Math.round(x.dpm));
        default: return String(x[k]);
      }
    };
    return h('div', {},
      this.ui.check(t('arenaShowRetired'), this.showRetired, (v) => { this.showRetired = v; this.redraw(); }),
      h('table', { class: 'ar-table' }, head, rows.map((x, i) => h('tr', { class: x.c.retired ? 'gone' : '', onclick: () => { this.statChar = x.c.id; this.statTab = 'char'; this.redraw(); } },
        h('td', {}, String(i + 1)),
        h('td', { class: 'nm' }, h('i', { class: 'ar-dot', style: `background:${x.c.color}` }), ' ' + x.c.name, hacksOn(x.c).length ? h('em', { class: 'hk' }, ' ' + t('hackTag')) : null),
        cols.map(([k]) => h('td', {}, cell(x, k)))))),
      h('div', { class: 'vgui-desc' }, t('arenaBoardDesc')));
  }

  charStats() {
    const ui = this.ui, save = this.save;
    const all = save.chars.filter((c) => this.showRetired || !c.retired || c.id === this.statChar);
    if (!this.statChar || !save.chars.some((c) => c.id === this.statChar)) this.statChar = all[0]?.id;
    const c = save.chars.find((x) => x.id === this.statChar);
    if (!c) return h('div', {});
    const s = statsOf(save, c.id);
    const byId = new Map(save.chars.map((x) => [x.id, x]));
    const pick = ui.row(t('arenaCharacter'), ui.select(c.id, all.map((x) => [x.id, x.name + (x.retired ? ' †' : '')]), (v) => { this.statChar = v; this.redraw(); }));
    const num = (label, v) => h('div', { class: 'ar-num' }, h('b', {}, v), h('span', {}, label));
    const nums = h('div', { class: 'ar-nums' },
      num(t('arenaRating'), String(Math.round(s.r))), num(t('csvMatches'), String(s.m)), num(t('arenaWLD'), `${s.w}-${s.l}-${s.d}`), num(t('csvWinPct'), pct(s.w, s.m)),
      num('K/D', ratio(s.k, s.de)), num(t('csvHsPct'), pct(s.hs, s.k)), num(t('csvAccuracy'), pct(s.hi, s.sh)), num(t('arenaDmgMatch'), s.m ? String(Math.round(s.dmg / s.m)) : '—'),
      s.rp ? num(t('arenaRoundsWon'), pct(s.rw, s.rp)) : null, s.ffa ? num(t('arenaAvgPlace'), (s.place / s.ffa).toFixed(1)) : null,
      s.pl || s.df ? num(t('arenaPlantsDefuses'), `${s.pl} / ${s.df}`) : null, s.nd ? num(t('csvNades'), String(s.nd)) : null, s.hk ? num(t('hackKillsCol'), String(s.hk)) : null);
    // the rating over the save's matches
    const chart = h('canvas', { class: 'ar-chart', width: 520, height: 130 });
    this.drawChart(chart, s.hist, c.color);
    // kills with each gun
    const guns = Object.entries(s.wk).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxK = guns.length ? guns[0][1] : 1;
    const gunBars = h('div', { class: 'ar-gunbars' }, guns.map(([w, k]) => h('div', { class: 'ar-gb' },
      h('span', {}, WEAPONS[w]?.name || w), h('i', { style: `width:${(k / maxK) * 100}%` }), h('b', {}, String(k)))));
    // by map and fight type
    const by = Object.entries(s.by).sort();
    const byTable = h('table', { class: 'ar-table small' },
      h('tr', {}, h('th', {}, t('map')), h('th', {}, t('arenaFight')), h('th', {}, t('csvMatches')), h('th', {}, t('csvWinPct')), h('th', {}, 'K/D')),
      by.map(([k, b]) => {
        const [map, type] = k.split('|');
        return h('tr', {}, h('td', {}, map), h('td', {}, t('fight_' + type)), h('td', {}, String(b[0])), h('td', {}, pct(b[1], b[0])), h('td', {}, ratio(b[4], b[5])));
      }));
    // best and worst opponents (3+ meetings)
    const opp = Object.entries(save.h2h[c.id] || {}).map(([id, x]) => ({ id, w: x[0], l: x[1], d: x[2], n: x[0] + x[1] + x[2] }))
      .filter((o) => o.n >= 3 && byId.has(o.id)).map((o) => ({ ...o, k: (o.w + o.d / 2) / o.n })).sort((a, b) => b.k - a.k);
    const oppLine = (o) => h('div', {}, h('i', { class: 'ar-dot', style: `background:${byId.get(o.id).color}` }), ` ${byId.get(o.id).name}: ${o.w}-${o.l}-${o.d} (${Math.round(o.k * 100)}%)`);
    const practice = save.settings.skillMode === 'practice';
    const TRO = ['champ', 'cup', 'clan', 'div', 'mvp', 'frag', 'star'].filter((k) => s.tro[k]);
    const rivals = rivalsOf(save, c.id).filter((id) => byId.has(id));
    return h('div', { class: 'ar-charstats' },
      pick,
      h('div', { class: 'vgui-desc' }, `${t('style_' + c.style)} · ${t('pers_' + c.pers)}` + (s.bs >= 3 ? ' · ' + t('arenaBestStreak', { n: s.bs }) : '') + (s.peakR > 1000 ? ' · ' + t('arenaPeakRating', { n: Math.round(s.peakR) }) : '')),
      TRO.length ? h('div', { class: 'ar-trophies' }, TRO.map((k) => h('span', { class: 'ar-trophy', title: t('tro_' + k) }, '🏆 ' + t('tro_' + k) + (s.tro[k] > 1 ? ' ×' + s.tro[k] : '')))) : null,
      rivals.length ? h('div', { class: 'vgui-desc' }, t('arenaRivalsOf', { names: rivals.map((id) => byId.get(id).name).join(', ') })) : null,
      nums,
      h('div', { class: 'ar-cols' },
        h('div', { class: 'ar-left wide' },
          h('div', { class: 'ar-head' }, t('arenaRatingChart')), chart,
          h('div', { class: 'ar-head' }, t('arenaByMap')), byTable),
        h('div', { class: 'ar-right' },
          practice ? [h('div', { class: 'ar-head' }, t('arenaSkills')), SKILLS.map((k) => h('div', { class: 'ar-skillline' },
            h('span', {}, t('skill_' + k)), h('b', {}, c.skills[k].toFixed(1)), h('span', { class: 'ar-sub' }, t('arenaFromTo', { start: Math.round(c.start[k]), peak: c.peak[k].toFixed(1) }))))] : null,
          h('div', { class: 'ar-head' }, t('arenaGunKills')), guns.length ? gunBars : h('div', { class: 'vgui-desc' }, '—'),
          h('div', { class: 'ar-head' }, t('arenaBestVs')), opp.slice(0, 3).map(oppLine),
          h('div', { class: 'ar-head' }, t('arenaWorstVs')), opp.slice(-3).reverse().map(oppLine))));
  }

  drawChart(cv, hist, color) {
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    g.fillStyle = '#2f3529';
    g.fillRect(0, 0, W, H);
    if (hist.length < 2) {
      g.fillStyle = '#a0aa95';
      g.font = '11px Tahoma, sans-serif';
      g.fillText(t('arenaNotEnough'), 10, H / 2);
      return;
    }
    let lo = Infinity, hi = -Infinity;
    for (const [, r] of hist) { lo = Math.min(lo, r); hi = Math.max(hi, r); }
    lo = Math.min(lo, 1000) - 20;
    hi = Math.max(hi, 1000) + 20;
    const n0 = hist[0][0], n1 = hist[hist.length - 1][0];
    const X = (n) => 30 + ((n - n0) / Math.max(1, n1 - n0)) * (W - 40);
    const Y = (r) => H - 14 - ((r - lo) / (hi - lo)) * (H - 24);
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    g.beginPath();
    g.moveTo(30, Y(1000));
    g.lineTo(W - 10, Y(1000));
    g.stroke();
    g.fillStyle = '#a0aa95';
    g.font = '10px Tahoma, sans-serif';
    g.fillText(String(Math.round(hi)), 2, 12);
    g.fillText(String(Math.round(lo)), 2, H - 16);
    g.fillText('1000', 2, Y(1000) + 3);
    g.fillText(t('arenaMatchN', { n: n0 }), 30, H - 2);
    g.textAlign = 'right';
    g.fillText(t('arenaMatchN', { n: n1 }), W - 10, H - 2);
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    hist.forEach(([n, r], i) => (i ? g.lineTo(X(n), Y(r)) : g.moveTo(X(n), Y(r))));
    g.stroke();
  }

  mapStats() {
    const ui = this.ui, save = this.save;
    const mapSel = ui.select(this.mapFilter, [['all', t('arenaAllMaps')], ...MAP_LIST.map((m) => [m, m])], (v) => { this.mapFilter = v; this.redraw(); });
    const fightSel = ui.select(this.fightFilter, [['all', t('arenaAllFights')], ...FIGHTS.map((f) => [f, t('fight_' + f)])], (v) => { this.fightFilter = v; this.redraw(); });
    const rows = save.chars.filter((c) => this.showRetired || !c.retired).map((c) => {
      const s = statsOf(save, c.id);
      const sum = [0, 0, 0, 0, 0, 0];
      for (const [k, b] of Object.entries(s.by)) {
        const [map, type] = k.split('|');
        if ((this.mapFilter === 'all' || map === this.mapFilter) && (this.fightFilter === 'all' || type === this.fightFilter)) b.forEach((v, i) => { sum[i] += v; });
      }
      return { c, b: sum };
    }).filter((x) => x.b[0] > 0).sort((a, b) => (b.b[1] + b.b[3] / 2) / b.b[0] - (a.b[1] + a.b[3] / 2) / a.b[0] || b.b[0] - a.b[0]);
    return h('div', {},
      h('div', { class: 'ar-filters' }, mapSel, fightSel),
      rows.length ? h('table', { class: 'ar-table' },
        h('tr', {}, h('th', {}, '#'), h('th', {}, t('name')), h('th', {}, t('csvMatches')), h('th', {}, t('csvWins')), h('th', {}, t('csvLosses')), h('th', {}, t('csvDraws')), h('th', {}, t('csvWinPct')), h('th', {}, t('csvKills')), h('th', {}, t('deaths')), h('th', {}, 'K/D')),
        rows.map((x, i) => h('tr', {},
          h('td', {}, String(i + 1)),
          h('td', { class: 'nm' }, h('i', { class: 'ar-dot', style: `background:${x.c.color}` }), ' ' + x.c.name),
          h('td', {}, String(x.b[0])), h('td', {}, String(x.b[1])), h('td', {}, String(x.b[2])), h('td', {}, String(x.b[3])),
          h('td', {}, pct(x.b[1], x.b[0])), h('td', {}, String(x.b[4])), h('td', {}, String(x.b[5])), h('td', {}, ratio(x.b[4], x.b[5])))))
        : h('div', { class: 'vgui-desc' }, t('arenaNoMatchesHere')),
      h('div', { class: 'vgui-desc' }, t('arenaByMapDesc')));
  }

  h2hStats() {
    const save = this.save;
    const chars = save.chars.filter((c) => !c.retired).sort((a, b) => statsOf(save, b.id).r - statsOf(save, a.id).r);
    const cell = (a, b) => {
      if (a === b) return h('td', { class: 'self' });
      const x = save.h2h[a.id]?.[b.id];
      if (!x) return h('td', { class: 'none' });
      const n = x[0] + x[1] + x[2], k = (x[0] + x[2] / 2) / n;
      // green: a beats b, red: b beats a
      const col = k >= 0.5 ? `rgba(70, 170, 60, ${0.15 + (k - 0.5) * 1.5})` : `rgba(200, 50, 40, ${0.15 + (0.5 - k) * 1.5})`;
      return h('td', { style: `background:${col}`, title: t('arenaH2hTip', { a: a.name, b: b.name, w: x[0], l: x[1], d: x[2] }) }, `${x[0]}-${x[1]}`);
    };
    return h('div', {},
      h('div', { class: 'vgui-desc' }, t('arenaH2hDesc')),
      h('table', { class: 'ar-h2h' },
        h('tr', {}, h('th', {}), chars.map((c) => h('th', { class: 'v', title: c.name }, h('span', {}, c.name)))),
        chars.map((a) => h('tr', {}, h('th', { class: 'nm' }, h('i', { class: 'ar-dot', style: `background:${a.color}` }), ' ' + a.name), chars.map((b) => cell(a, b))))));
  }

  evoStats() {
    const save = this.save;
    const byId = new Map(save.chars.map((c) => [c.id, c]));
    const nm = (id) => byId.get(id)?.name || '?';
    if (!save.evoLog.length) return h('div', { class: 'vgui-desc' }, t(save.settings.evolve === 'off' ? 'arenaEvoOff' : 'arenaEvoNone'));
    // the family tree: every generation, who came from whom
    const gens = [...new Set(save.chars.map((c) => c.gen))].sort((a, b) => a - b);
    const tree = gens.length > 1 ? h('div', { class: 'ar-tree' }, gens.map((g) => h('div', { class: 'ar-gen' },
      h('div', { class: 'ar-head' }, t('arenaGen', { n: g })),
      save.chars.filter((c) => c.gen === g).map((c) => h('div', { class: c.retired ? 'gone' : '' },
        h('i', { class: 'ar-dot', style: `background:${c.color}` }), ' ', h('b', {}, c.name),
        c.parents.length ? h('span', { class: 'ar-sub' }, ' ← ' + c.parents.map(nm).join(' + ')) : null,
        h('span', { class: 'ar-sub' }, ' · ' + Math.round(statsOf(save, c.id).r))))))) : null;
    return h('div', {},
      tree,
      h('div', { class: 'ar-head' }, t('arenaEvoLog')),
      h('div', { class: 'ar-feed' }, save.evoLog.slice().reverse().map((e) => h('div', {}, this.evoText(e, nm)))));
  }

  exportCsv() {
    const save = this.save;
    // Excel takes the list separator from the language settings: ";" where a comma is the decimal point
    const comma = (1.5).toLocaleString().includes(',');
    const csv = toCSV(save, (k) => t(k), { sep: comma ? ';' : ',', dec: comma ? ',' : '.' });
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bot-arena-${save.name.replace(/[^\w\-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}

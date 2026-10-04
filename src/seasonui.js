// Bot Arena's Season tab: seasons (setup, the waiting room for fantasy picks
// and champion bets, league tables, playoff brackets, the result), cups,
// betting, the fantasy team, the news and the hall of fame. ArenaScreens
// (arenaui.js) holds the window; this draws the tab's pages.

import { t, getLang } from './i18n.js';
import { h, escapeHtml } from './ui.js';
import { statsOf, ARENA_MAPS, isBombMapName, MAX_SIDE } from './arena.js';
import {
  cleanSeasonCfg, cleanCupCfg, newSeason, seasonCheck, startSeason, soloTable, clanTable, newCup, cupCheck,
  playKnockouts, koWaiting, bracketDone, roundWaiting, roundStarted, roundName, playingClans, FANTASY, TEAM_FIGHTS,
} from './league.js';
import {
  walletOf, setLevel, seasonTurn, odds, sideChance, seriesChance, placeBet, refundComp, champChances,
  fantasyToggle, fantasyCost, BET_LEVELS, MIN_BET, PAY,
} from './bets.js';
import { seasonStartNews, cupStartNews, rivalsOf } from './news.js';
import { quoteText } from './quotes.js';
import { DEFAULT_WORKERS } from './arenarun.js';

const SUBS = ['season', 'cup', 'bets', 'fantasy', 'news', 'clips', 'fame'];
// rough work per match (seconds of one thread) at the default lengths
const COST = { duel: 1, tdm: 9, classic: 6, ffa: 7, bomb: 25 };
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const coins = (n) => `${Math.round(n).toLocaleString()} ¢`;

export class SeasonScreens {
  constructor(arena) {
    this.A = arena;
    this.sub = 'season';
    this.view = 0;          // the table shown: a division, or 'clan'
    this.newsFilter = 'all';
    this.seasonDraft = null;
    this.cupDraft = null;
    this.liveEl = null;
    this.stake = 100;
  }

  get save() { return this.A.save; }
  get ui() { return this.A.ui; }
  get runner() { return this.A.runner; }
  redraw() { this.A.redraw(); }
  touch(now) { this.A.touch(now); }

  render() {
    const ui = this.ui, w = walletOf(this.save);
    const bar = h('div', { class: 'ar-subtabs' }, SUBS.map((id) => h('button', {
      class: 'ar-subtab' + (this.sub === id ? ' on' : ''),
      onclick: () => { ui.click(); this.sub = id; this.redraw(); },
    }, t('ssTab_' + id))),
    h('span', { class: 'ar-grow' }),
    h('span', { class: 'ar-coins', title: t('ssCoinsTip') }, coins(w.coins)));
    let body;
    switch (this.sub) {
      case 'cup': body = this.cupView(); break;
      case 'bets': body = this.betsView(); break;
      case 'fantasy': body = this.fantasyView(); break;
      case 'news': body = this.newsView(); break;
      case 'clips': body = this.A.clipsView(); break;
      case 'fame': body = this.fameView(); break;
      default: body = this.seasonView();
    }
    return h('div', { class: 'ar-stats' }, bar, h('div', { class: 'ar-statbody ar-scroll' }, body));
  }

  // ---------------------------------------------------------------- helpers
  charName(id) {
    return this.save.chars.find((c) => c.id === id)?.name || '?';
  }

  clanOf(id) {
    return this.save.clans.find((c) => c.id === id);
  }

  // a name with its color dot (a character or a clan)
  who(comp, id, extra = null) {
    if (id == null) return h('span', { class: 'ar-sub' }, t('ssBye'));
    if (comp === 'clan') {
      const cl = this.clanOf(id);
      return h('span', { class: 'ar-who' }, h('i', { class: 'ar-dot', style: `background:${cl?.color || '#888'}` }), ' ' + (cl?.name || '?'), extra);
    }
    const c = this.save.chars.find((x) => x.id === id);
    return h('span', { class: 'ar-who' }, h('i', { class: 'ar-dot', style: `background:${c?.color || '#888'}` }), ' ' + (c?.name || '?'), extra);
  }

  // is the runner busy with something else than this competition?
  otherBusy(kind) {
    const r = this.runner;
    return r.busy() && (r.save !== this.save || r.kind !== kind);
  }

  // play what's ready in this competition (the runner takes it on)
  play(kind) {
    const r = this.runner;
    if (this.otherBusy(kind)) return this.A.notice(t('ssOtherBusy'));
    if (r.busy()) {
      if (r.state === 'paused') r.resume();
      else {
        // new matches came free (a knockout round started): feed the threads
        r.topUp();
        for (const w of r.workers) r.feed(w);
      }
    } else r.startComp(this.save, this.A.store.workers || DEFAULT_WORKERS, kind);
    this.redraw();
  }

  // watch a match of this competition (want: a series to watch)
  watch(kind, want = null) {
    const r = this.runner;
    if (this.otherBusy(kind)) return this.A.notice(t('ssOtherBusy'));
    if (!r.busy()) r.startComp(this.save, this.A.store.workers || DEFAULT_WORKERS, kind);
    this.A.watchNext(want, 'season');
  }

  controls(kind) {
    const ui = this.ui, r = this.runner;
    const mine = r.busy() && r.save === this.save && r.kind === kind;
    const btns = [];
    if (this.otherBusy(kind)) {
      return h('div', { class: 'ar-warn' }, h('span', {}, t('ssOtherBusy')),
        ui.btn(t('ssStopOther'), () => { r.stop(); this.redraw(); }));
    }
    const c = this.save[kind];
    const ko = c.phase === 'playoffs' || c.phase === 'ko' || (kind === 'cup' && c.phase === 'prep');
    const waiting = koWaiting(this.save, kind);
    if (ko) {
      if (waiting) {
        btns.push(ui.btn(t('ssPlayRound'), () => { this.startRound(kind, false); }, true));
        btns.push(ui.btn(t('ssPlayAll'), () => { this.startRound(kind, true); }));
      }
    } else if (!mine) btns.push(ui.btn(t('ssPlay'), () => this.play(kind), true));
    if (mine) {
      btns.push(r.state === 'paused' ? ui.btn(t('arenaResume'), () => r.resume()) : ui.btn(t('arenaPause'), () => r.pause()));
      btns.push(ui.btn(t('arenaStop'), () => { r.stop(); this.redraw(); }));
    }
    if (!ko) btns.push(ui.btn(t('arenaWatch'), () => this.watch(kind)));
    return h('div', { class: 'ar-btns' }, btns);
  }

  // Play (one round) or Play all: the waiting knockout rounds start
  startRound(kind, all) {
    const save = this.save;
    if (kind === 'cup' && save.cup.phase === 'prep') cupStartNews(save, this.chances('cup'));
    playKnockouts(save, kind, all);
    this.touch(true);
    this.play(kind);
  }

  // who wins it all: chances from many simulated runs (kept until ratings move)
  chances(kind) {
    const c = this.save[kind];
    if (!c.chances || c.chancesAt !== this.save.matches) {
      c.chances = champChances(this.save, kind);
      c.chancesAt = this.save.matches;
    }
    return c.chances;
  }

  // ---------------------------------------------------------------- a bet window
  // ask: { title, options: [{ label, odds, pick }], make(pick) -> bet fields, go?(bet|null), goLabel }
  betBox(ask) {
    const ui = this.ui, save = this.save, w = walletOf(save);
    ask.pick ??= ask.options[0]?.pick;
    const stake = Math.max(MIN_BET, Math.min(this.stake, w.coins));
    const input = h('input', { class: 'vgui-input ar-stake', type: 'number', min: MIN_BET, max: w.coins, step: 10, value: stake });
    const quick = [10, 50, 100, 250].filter((v) => v <= w.coins).map((v) => h('button', { class: 'vgui-btn small', onclick: () => { input.value = v; } }, String(v)));
    quick.push(h('button', { class: 'vgui-btn small', onclick: () => { input.value = w.coins; } }, t('ssAllIn')));
    const opts = h('div', { class: 'ar-betopts' }, ask.options.map((o) => h('label', { class: 'ar-betopt' + (o.pick === ask.pick ? ' on' : '') },
      h('input', { type: 'radio', name: 'betpick', checked: o.pick === ask.pick, onchange: () => { ask.pick = o.pick; this.redraw(); } }),
      h('span', {}, o.label), h('b', {}, '×' + o.odds.toFixed(2)))));
    const place = () => {
      const v = Math.floor(+input.value);
      if (!(v >= MIN_BET) || v > w.coins) return this.A.notice(t('ssBadStake', { min: MIN_BET, max: w.coins }));
      this.stake = v;
      const o = ask.options.find((x) => x.pick === ask.pick);
      const bet = placeBet(save, { ...ask.make(o.pick), pick: o.pick, odds: o.odds, stake: v, pickName: o.name || o.label });
      this.touch(true);
      this.A.betAsk = null;
      if (ask.go) ask.go(bet);
      else this.redraw();
    };
    return h('div', { class: 'ar-betbox' },
      h('div', { class: 'ar-head' }, ask.title),
      ask.desc ? h('div', { class: 'vgui-desc' }, ask.desc) : null,
      opts,
      w.coins >= MIN_BET ? h('div', { class: 'ar-betrow' }, h('span', {}, t('ssStake')), input, quick, h('span', { class: 'ar-sub' }, t('ssYouHave', { c: coins(w.coins) }))) : h('div', { class: 'vgui-desc hk-off' }, t('ssNoCoins')),
      h('div', { class: 'ar-btns' },
        w.coins >= MIN_BET ? ui.btn(ask.go ? t('ssBetWatch') : t('ssPlaceBet'), place, true) : null,
        ask.go ? ui.btn(t('ssJustWatch'), () => { this.A.betAsk = null; ask.go(null); }, !(w.coins >= MIN_BET)) : null,
        ui.btn(t('cancel'), () => { const f = ask.cancel; this.A.betAsk = null; if (f) f(); this.redraw(); })));
  }

  // the bet window for a match about to be watched
  matchBetAsk(spec, go, cancel) {
    const save = this.save;
    const lvl = walletOf(save).level;
    const nm = (id) => this.charName(id);
    let options;
    const what = { t: 'betWhatMatch', p: { f: spec.type, m: spec.map } };
    if (spec.type === 'ffa') {
      const ids = spec.cfg.arena.players.map((p) => p.ch.id);
      const w = ids.map((id) => Math.pow(10, statsOf(save, id).r / 400)), sum = w.reduce((s, x) => s + x, 0);
      options = ids.map((id, i) => ({ pick: id, label: nm(id), name: nm(id), odds: odds(w[i] / sum, lvl) })).sort((a, b) => a.odds - b.odds);
    } else {
      const sides = [0, 1].map((s) => spec.cfg.arena.players.filter((p) => p.side === s).map((p) => p.ch.id));
      const p0 = sideChance(save, sides);
      const label = (s) => (spec.comp?.clans ? this.clanOf(spec.comp.clans[s])?.name || '?' : sides[s].map(nm).join(', '));
      options = [0, 1].map((s) => ({ pick: s, label: label(s), name: label(s), odds: odds(s ? 1 - p0 : p0, lvl) }));
    }
    return {
      title: t('ssBetMatchTitle', { f: t('fight_' + spec.type), m: spec.map }),
      desc: t('ssBetMatchDesc'),
      options,
      make: () => ({ kind: 'match', ffa: spec.type === 'ffa', ref: { kind: 'live' }, what }),
      go, cancel,
    };
  }

  // a knockout series to bet on (before its round starts)
  seriesBetAsk(kind, br, s) {
    const save = this.save, lvl = walletOf(save).level, comp = br.comp;
    const rOf = (id) => (comp === 'clan'
      ? (this.clanOf(id)?.members || []).map((m) => statsOf(save, m).r).reduce((a, b, _, all) => a + b / all.length, 0)
      : statsOf(save, id).r);
    const p = seriesChance(1 / (1 + Math.pow(10, (rOf(s.b) - rOf(s.a)) / 400)), br.bestOf);
    const nm = (id) => (comp === 'clan' ? this.clanOf(id)?.name || '?' : this.charName(id));
    return {
      title: t('ssBetSeriesTitle', { a: nm(s.a), b: nm(s.b) }),
      desc: t('ssBetSeriesDesc', { n: br.bestOf }),
      options: [{ pick: 0, label: nm(s.a), odds: odds(p, lvl) }, { pick: 1, label: nm(s.b), odds: odds(1 - p, lvl) }],
      make: () => ({ kind: 'series', ref: { kind, n: save[kind].n, sid: s.id }, what: { t: 'betWhatSeries', p: { a: nm(s.a), b: nm(s.b), r: roundName(br, br.cur), rn: br.rounds[br.cur].length * 2, k: kind, n: save[kind].n } } }),
    };
  }

  champBetAsk(kind, comp, id) {
    const save = this.save, lvl = walletOf(save).level;
    const ch = this.chances(kind)[comp] || {};
    const nm = comp === 'clan' ? this.clanOf(id)?.name || '?' : this.charName(id);
    return {
      title: t(kind === 'cup' ? 'ssBetCupTitle' : comp === 'clan' ? 'ssBetClanTitle' : 'ssBetChampTitle', { n: save[kind].n }),
      desc: t('ssBetChampDesc'),
      options: [{ pick: id, label: nm, odds: odds(ch[id] || 0.001, lvl) }],
      make: () => ({ kind: 'champ', ref: { kind, n: save[kind].n, comp }, what: { t: kind === 'cup' ? 'betWhatCup' : 'betWhatChamp', p: { k: comp, n: save[kind].n } } }),
    };
  }

  // ---------------------------------------------------------------- season
  seasonView() {
    const c = this.save.season;
    if (!c || c.phase === 'done') return this.seasonIdle();
    if (c.phase === 'prep') return this.seasonPrep();
    return this.seasonRun();
  }

  seasonIdle() {
    const c = this.save.season;
    return h('div', { class: 'ar-cols' },
      h('div', { class: 'ar-left wide' }, c?.result ? this.resultCard(c) : h('div', { class: 'vgui-desc' }, t('ssNoSeasonYet')), this.seasonSetup()),
      h('div', { class: 'ar-right' }, this.fameMini()));
  }

  // the setup of the next season
  seasonSetup() {
    const ui = this.ui, save = this.save;
    const d = (this.seasonDraft ||= cleanSeasonCfg(save.seasonCfg));
    const so = d.solo, cl = d.clan;
    const re = () => this.redraw();
    const sel = (v, list, set, fmt = String) => ui.select(v, list.map((x) => [x, fmt(x)]), (x) => { set(isNaN(+x) ? x : +x); re(); });
    const clans = playingClans(save).length;
    const reason = seasonCheck(save, d);
    const n = (save.seasonHist?.length || 0) + 1;
    let summary = null;
    if (!reason) {
      const s = newSeason(save, d);
      const work = s.matches.reduce((sum, m) => sum + this.cost(d, m), 0) / (this.A.store.workers || DEFAULT_WORKERS) / 60;
      summary = h('div', { class: 'vgui-desc ar-est' }, t('ssSize', { n: s.matches.length, time: this.A.minutes(work) }));
    }
    const killList = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100];
    const roundList = [3, 4, 5, 6, 8, 10, 13, 16];
    return h('div', { class: 'vgui-form ar-sform' },
      h('div', { class: 'ar-head' }, t('ssNewSeason', { n })),
      h('div', { class: 'ar-cols' },
        h('div', { class: 'ar-left' },
          ui.check(h('b', {}, t('ssSoloLeague')), so.on, (v) => { so.on = v; re(); }),
          h('div', { class: 'vgui-desc' }, t('ssSoloDesc')),
          so.on ? [
            ui.row(t('ssDivisions'), sel(so.divs, range(1, 4), (v) => { so.divs = v; })),
            so.divs > 1 ? ui.row(t('ssMove'), sel(so.move, range(1, 4), (v) => { so.move = v; })) : null,
            ui.row(t('ssLegs'), sel(so.legs, range(1, 3), (v) => { so.legs = v; })),
            h('div', { class: 'ar-pick' },
              ui.check(t('fight_duel'), so.duel, (v) => { so.duel = v; re(); }),
              ui.check(t('fight_ffa'), so.ffa, (v) => { so.ffa = v; re(); }),
              ui.check(t('ssTeamMatches'), so.team, (v) => { so.team = v; re(); })),
            so.duel ? ui.row(t('ssDuelKills'), sel(so.duelKills, killList, (v) => { so.duelKills = v; })) : null,
            so.ffa ? ui.row(t('ssFfaKills'), sel(so.ffaKills, killList, (v) => { so.ffaKills = v; })) : null,
            so.team ? ui.row(t('ssTeamFight'), h('span', { class: 'ar-inline' },
              sel(so.teamFight, TEAM_FIGHTS, (v) => { so.teamFight = v; }, (f) => t('fight_' + f)),
              sel(so.teamSize, range(1, MAX_SIDE), (v) => { so.teamSize = v; }, (x) => `${x} v ${x}`))) : null,
            so.team ? (so.teamFight === 'tdm'
              ? ui.row(t('ssTeamKills'), sel(so.teamKills, killList, (v) => { so.teamKills = v; }))
              : ui.row(t('ssRoundsToWin'), sel(so.teamRounds, roundList, (v) => { so.teamRounds = v; }))) : null,
            ui.row(t('ssPlayoffs'), sel(so.playoffs, [0, 2, 4, 8], (v) => { so.playoffs = v; }, (x) => (x ? t('ssTopN', { n: x }) : t('ssNone')))),
            so.playoffs ? ui.row(t('ssBestOf'), sel(so.bestOf, [1, 3, 5], (v) => { so.bestOf = v; }, (x) => t('ssBo', { n: x }))) : null,
          ] : null),
        h('div', { class: 'ar-right' },
          ui.check(h('b', {}, t('ssClanLeague')), cl.on, (v) => { cl.on = v; re(); }),
          h('div', { class: 'vgui-desc' }, clans >= 2 ? t('ssClanDesc', { n: clans }) : t('ssClanNeed')),
          cl.on ? [
            ui.row(t('ssClanLegs'), sel(cl.legs, range(1, 4), (v) => { cl.legs = v; })),
            h('div', { class: 'ar-pick' }, TEAM_FIGHTS.map((f) => ui.check(t('fight_' + f), cl[f], (v) => { cl[f] = v; re(); }))),
            ui.row(t('ssTeamSize'), sel(cl.size, range(1, MAX_SIDE), (v) => { cl.size = v; }, (x) => `${x} v ${x}`)),
            cl.tdm ? ui.row(t('ssTeamKills'), sel(cl.kills, killList, (v) => { cl.kills = v; })) : null,
            cl.classic || cl.bomb ? ui.row(t('ssRoundsToWin'), sel(cl.rounds, roundList, (v) => { cl.rounds = v; })) : null,
            ui.row(t('ssPlayoffs'), sel(cl.playoffs, [0, 2, 4], (v) => { cl.playoffs = v; }, (x) => (x ? t('ssTopN', { n: x }) : t('ssNone')))),
            cl.playoffs ? ui.row(t('ssBestOf'), sel(cl.bestOf, [1, 3, 5], (v) => { cl.bestOf = v; }, (x) => t('ssBo', { n: x }))) : null,
          ] : null,
          h('div', { class: 'ar-head' }, t('arenaMaps')),
          h('div', { class: 'ar-pick maps' }, ARENA_MAPS.map((m) => ui.check(m, d.maps.includes(m), (v) => {
            d.maps = v ? [...new Set([...d.maps, m])] : d.maps.filter((x) => x !== m);
            re();
          }))))),
      cl.on && cl.bomb && !d.maps.some(isBombMapName) && reason !== 'arenaNoBombMap' ? h('div', { class: 'vgui-desc' }, t('arenaNoBombMap')) : null,
      reason ? h('div', { class: 'vgui-desc hk-off' }, t(reason)) : summary,
      h('div', { class: 'ar-btns' }, ui.btn(t('ssCreateSeason', { n }), () => {
        if (reason) return;
        save.seasonCfg = cleanSeasonCfg(d);
        seasonTurn(save);
        save.season = newSeason(save, d);
        this.seasonDraft = null;
        this.touch(true);
        this.redraw();
      }, true)));
  }

  // seconds of one thread a match takes, roughly
  cost(cfg, m) {
    if (m.kind === 'duel') return COST.duel * (cfg.solo.duelKills / 10);
    if (m.kind === 'ffa') return COST.ffa * (cfg.solo.ffaKills / 30);
    const so = m.kind === 'team', f = m.fight;
    const size = so ? cfg.solo.teamSize : cfg.clan.size;
    const len = f === 'tdm' ? (so ? cfg.solo.teamKills : cfg.clan.kills) / 50 : (so ? cfg.solo.teamRounds : cfg.clan.rounds) / 8;
    return COST[f] * (size / 5) * len;
  }

  seasonPrep() {
    const ui = this.ui, save = this.save, c = save.season;
    const ch = this.chances('season');
    const w = walletOf(save);
    const myBets = w.open.filter((b) => b.kind === 'champ' && b.ref.kind === 'season' && b.ref.n === c.n);
    const lvl = w.level;
    const favList = (comp, list) => {
      const rows = Object.entries(list).sort((a, b) => b[1] - a[1]).slice(0, comp === 'clan' ? 8 : 12);
      return h('table', { class: 'ar-table small' },
        h('tr', {}, h('th', {}, t('name')), h('th', {}, t('ssChance')), h('th', {}, t('ssOdds')), h('th', {})),
        rows.map(([id, p]) => h('tr', {},
          h('td', { class: 'nm' }, this.who(comp, id)),
          h('td', {}, Math.round(p * 1000) / 10 + '%'),
          h('td', {}, '×' + odds(p, lvl).toFixed(2)),
          h('td', {}, h('button', { class: 'vgui-btn small', onclick: () => { this.A.betAsk = this.champBetAsk('season', comp, id); this.redraw(); } }, t('ssBet'))))));
    };
    const divs = c.divs.map((ids, d) => h('div', { class: 'ar-divcol' },
      h('div', { class: 'ar-head' }, t('ssDivN', { n: d + 1 })),
      [...ids].sort((a, b) => statsOf(save, b).r - statsOf(save, a).r).map((id) => h('div', {}, this.who('solo', id, h('span', { class: 'ar-sub' }, ' ' + Math.round(statsOf(save, id).r)))))));
    return h('div', {},
      h('div', { class: 'ar-head big' }, t('ssPrepTitle', { n: c.n })),
      h('div', { class: 'vgui-desc' }, t('ssPrepDesc', { n: c.matches.length })),
      h('div', { class: 'ar-btns' },
        ui.btn(t('ssStartSeason'), () => this.beginSeason(), true),
        ui.btn(t('ssPickFantasy', { n: c.fantasy.picks.length, of: FANTASY.picks }), () => { this.sub = 'fantasy'; this.redraw(); }),
        ui.btn(t('ssCallOff'), () => this.callOff('season'))),
      h('div', { class: 'ar-cols' },
        h('div', { class: 'ar-left' },
          c.divs.length ? [h('div', { class: 'ar-divs' }, divs)] : null,
          c.clans.length ? [h('div', { class: 'ar-head' }, t('ssClansIn')), ...c.clans.map((id) => h('div', {}, this.who('clan', id,
            h('span', { class: 'ar-sub' }, ' · ' + (this.clanOf(id)?.members || []).map((m) => this.charName(m)).join(', ')))))] : null),
        h('div', { class: 'ar-right' },
          h('div', { class: 'ar-head' }, t('ssWhoWins')),
          h('div', { class: 'vgui-desc' }, t('ssWhoWinsDesc')),
          Object.keys(ch.solo || {}).length ? favList('solo', ch.solo) : null,
          Object.keys(ch.clan || {}).length ? [h('div', { class: 'ar-head' }, t('ssClanTitle')), favList('clan', ch.clan)] : null,
          myBets.length ? [h('div', { class: 'ar-head' }, t('ssYourBets')), ...myBets.map((b) => this.betLine(b))] : null)));
  }

  beginSeason() {
    const save = this.save;
    seasonStartNews(save, this.chances('season'));
    startSeason(save);
    this.touch(true);
    this.play('season');
  }

  callOff(kind) {
    this.A.confirm(t(kind === 'cup' ? 'ssCallOffCupQ' : 'ssCallOffQ'), () => {
      const save = this.save;
      if (this.runner.busy() && this.runner.save === save && this.runner.kind === kind) this.runner.stop();
      refundComp(save, kind, save[kind].n);
      save[kind] = null;
      this.touch(true);
    });
  }

  seasonRun() {
    const save = this.save, c = save.season;
    const el = h('div', { class: 'ar-live' });
    this.liveEl = el;
    this.fillSeason(el);
    const views = [...c.divs.map((_, d) => [d, t('ssDivN', { n: d + 1 })]), ...(c.clans.length >= 2 ? [['clan', t('ssClanTitle')]] : [])];
    if (!views.some(([v]) => v === this.view)) this.view = views[0]?.[0] ?? 0;
    return h('div', {},
      h('div', { class: 'ar-head big' }, t(c.phase === 'league' ? 'ssLeagueTitle' : 'ssPlayoffsTitle', { n: c.n })),
      this.controls('season'),
      c.phase === 'league' && views.length > 1 ? h('div', { class: 'ar-subtabs small' }, views.map(([v, label]) => h('button', {
        class: 'ar-subtab' + (this.view === v ? ' on' : ''), onclick: () => { this.ui.click(); this.view = v; this.redraw(); },
      }, label))) : null,
      el,
      h('div', { class: 'ar-btns ar-foot' }, this.ui.btn(t('ssCallOff'), () => this.callOff('season'))));
  }

  // the part that changes as matches finish (redrawn by itself)
  fillSeason(el) {
    const save = this.save, c = save.season;
    if (!c || !el) return;
    const r = this.runner;
    const mine = r.busy() && r.save === save && r.kind === 'season';
    const lg = c.matches.filter((m) => m.stage === 'league');
    const done = lg.filter((m) => m.st === 'done').length;
    const status = mine ? (r.state === 'paused' ? t('arenaPaused') : r.starting() && !r.workers.some((w) => w.job) ? t('arenaStarting', { n: r.wanted - r.starting(), of: r.wanted }) : t('arenaPerMin', { n: r.speed() ? r.speed().toFixed(1) : '…' })) : t('ssIdle');
    el.innerHTML = '';
    if (c.phase === 'league') {
      el.append(
        h('div', { class: 'ar-prog' }, h('i', { style: `width:${lg.length ? (done / lg.length) * 100 : 0}%` }), h('span', {}, `${done} / ${lg.length}`)),
        h('div', { class: 'ar-runline' }, h('span', {}, status), r.errors && mine ? h('span', { class: 'ar-fails' }, t('arenaErrors', { n: r.errors })) : null),
        h('div', { class: 'ar-cols' },
          h('div', { class: 'ar-left wide' }, this.view === 'clan' ? this.clanTableView(c) : this.soloTableView(c, this.view)),
          h('div', { class: 'ar-right' }, this.feedView(c))));
    } else {
      const ko = [c.po.solo, c.po.clan].filter(Boolean);
      el.append(
        h('div', { class: 'ar-runline' }, h('span', {}, koWaiting(save, 'season') ? t('ssRoundWaits') : status)),
        ...ko.map((br) => this.bracketView('season', br)),
        // the final tables, one under the other (side by side they don't fit a small window)
        h('div', {},
          c.divs.length ? [h('div', { class: 'ar-head' }, t('ssDivN', { n: 1 })), this.soloTableView(c, 0)] : null,
          c.clans.length >= 2 ? this.clanTableView(c) : null));
    }
  }

  soloTableView(c, d) {
    const save = this.save;
    const rows = soloTable(save, c, d);
    const so = c.cfg.solo;
    const nDivs = c.divs.length, move = Math.min(so.move, Math.floor(rows.length / 2));
    const po = d === 0 && so.playoffs ? Math.min(so.playoffs, 1 << Math.floor(Math.log2(Math.max(2, rows.length)))) : 0;
    const mark = (i) => (i < po ? 'po' : '') + (d > 0 && i < move ? ' up' : '') + (d < nDivs - 1 && i >= rows.length - move ? ' down' : '');
    const picks = new Set(c.fantasy.picks);
    return h('div', {},
      h('table', { class: 'ar-table league' },
        h('tr', {}, h('th', {}, '#'), h('th', {}, t('name')), h('th', {}, t('ssP')), h('th', {}, t('ssW')), h('th', {}, t('ssD')), h('th', {}, t('ssL')),
          h('th', {}, t('csvKills')), h('th', {}, t('deaths')), h('th', {}, '+/-'), h('th', {}, t('ssPts')), h('th', {}, t('ssForm'))),
        rows.map((x, i) => h('tr', { class: mark(i) },
          h('td', {}, String(i + 1)),
          h('td', { class: 'nm' }, this.who('solo', x.id, picks.has(x.id) ? h('em', { class: 'ar-fan', title: t('ssFantasyPick') }, ' ★') : null)),
          h('td', {}, String(x.p)), h('td', {}, String(x.w)), h('td', {}, String(x.d)), h('td', {}, String(x.l)),
          h('td', {}, String(x.k)), h('td', {}, String(x.de)), h('td', {}, String(x.k - x.de)),
          h('td', { class: 'pts' }, String(x.pts)),
          h('td', { class: 'form' }, x.form.map((f) => h('i', { class: 'f' + f }, t('form' + f))))))),
      h('div', { class: 'vgui-desc' }, [po ? t('ssKeyPo', { n: po }) : '', nDivs > 1 ? t('ssKeyMove') : '', t('ssKeyPts')].filter(Boolean).join(' ')));
  }

  clanTableView(c) {
    const rows = clanTable(this.save, c);
    const po = c.cfg.clan.playoffs ? Math.min(c.cfg.clan.playoffs, 1 << Math.floor(Math.log2(Math.max(2, rows.length)))) : 0;
    return h('div', {},
      h('div', { class: 'ar-head' }, t('ssClanTitle')),
      h('table', { class: 'ar-table league' },
        h('tr', {}, h('th', {}, '#'), h('th', {}, t('ssClan')), h('th', {}, t('ssP')), h('th', {}, t('ssW')), h('th', {}, t('ssD')), h('th', {}, t('ssL')),
          h('th', {}, t('ssFor')), h('th', {}, t('ssAgainst')), h('th', {}, t('ssPts')), h('th', {}, t('ssForm'))),
        rows.map((x, i) => h('tr', { class: i < po ? 'po' : '' },
          h('td', {}, String(i + 1)), h('td', { class: 'nm' }, this.who('clan', x.id)),
          h('td', {}, String(x.p)), h('td', {}, String(x.w)), h('td', {}, String(x.d)), h('td', {}, String(x.l)),
          h('td', {}, String(x.f)), h('td', {}, String(x.a)), h('td', { class: 'pts' }, String(x.pts)),
          h('td', { class: 'form' }, x.form.map((f) => h('i', { class: 'f' + f }, t('form' + f))))))));
  }

  // what's being played, and the latest results
  feedView(c) {
    const live = c.matches.filter((m) => m.st === 'live').slice(0, 8);
    const recent = c.matches.filter((m) => m.st === 'done' && m.res && !m.res.forfeit).slice(-8).reverse();
    return h('div', {},
      h('div', { class: 'ar-head' }, t('arenaPlaying')),
      h('div', { class: 'ar-feed' }, live.map((m) => h('div', {}, h('b', {}, `${t('fight_' + (m.kind === 'duel' ? 'duel' : m.fight))} · ${m.map}`), ' ', h('span', { class: 'ar-sub' }, this.matchWho(m))))),
      h('div', { class: 'ar-head' }, t('arenaRecent')),
      h('div', { class: 'ar-feed' }, recent.map((m) => h('div', {}, this.matchLine(m)))));
  }

  matchWho(m) {
    if (m.clans) return m.clans.map((id) => this.clanOf(id)?.name || '?').join(' – ');
    if (m.kind === 'ffa') return t('ssDivN', { n: m.div + 1 });
    if (m.sides) return m.sides.map((s) => s.map((id) => this.charName(id)).join(', ')).join(' – ');
    return t('ssDivN', { n: m.div + 1 });
  }

  matchLine(m) {
    const r = m.res;
    if (m.kind === 'ffa') return t('arenaFfaWon', { name: this.charName(r.order[0]) });
    const name = (s) => (m.clans ? this.clanOf(m.clans[s])?.name || '?' : m.sides[s].map((id) => this.charName(id)).join(', '));
    const sc = r.sc || [0, 0];
    if (r.w == null) return t('arenaDrawLine', { a: name(0), b: name(1), s: sc.join(':') });
    return t('arenaWonLine', { w: name(r.w), l: name(1 - r.w), s: `${sc[r.w]}:${sc[1 - r.w]}` });
  }

  // a knockout bracket: rounds side by side, every series with its score, bets and watching
  bracketView(kind, br) {
    const save = this.save, comp = this.save[kind];
    const w = walletOf(save);
    const waiting = roundWaiting(comp, br);
    const cols = br.rounds.map((round, ri) => h('div', { class: 'ar-round' },
      h('div', { class: 'ar-head' }, t('ko_' + roundName(br, ri), { n: round.length * 2 })),
      round.map((s) => {
        const cur = ri === br.cur && !bracketDone(br);
        const myBet = w.open.find((b) => b.kind === 'series' && b.ref.kind === kind && b.ref.n === comp.n && b.ref.sid === s.id);
        const canBet = cur && waiting && s.a != null && s.b != null && s.w == null && !s.games.length;
        const canWatch = cur && s.a != null && s.b != null && s.w == null && !s.busy;
        const line = (id, wins, won) => h('div', { class: 'ar-sline' + (won ? ' won' : s.w != null ? ' lost' : '') }, this.who(br.comp, id), h('b', {}, s.a != null && s.b != null ? String(wins) : ''));
        return h('div', { class: 'ar-series' + (cur ? ' cur' : '') },
          line(s.a, s.wa, s.w != null && s.w === s.a),
          line(s.b, s.wb, s.w != null && s.w === s.b),
          s.busy ? h('div', { class: 'ar-sub' }, t('ssPlayingGame', { n: s.games.length })) : null,
          myBet ? h('div', { class: 'ar-sub ar-mybet' }, t('ssYourBetOn', { name: myBet.pickName, c: myBet.stake })) : null,
          canBet || canWatch ? h('div', { class: 'ar-sbtns' },
            canBet ? h('button', { class: 'vgui-btn small', onclick: () => { this.A.betAsk = this.seriesBetAsk(kind, br, s); this.redraw(); } }, t('ssBet')) : null,
            canWatch ? h('button', { class: 'vgui-btn small', onclick: () => this.watchSeries(kind, br, s) }, t('ssWatchGame')) : null) : null);
      })));
    // the rounds still to come, empty
    const total = Math.round(Math.log2(br.rounds[0].length * 2));
    for (let ri = br.rounds.length; ri < total; ri++) {
      const n = br.rounds[0].length / Math.pow(2, ri);
      cols.push(h('div', { class: 'ar-round' }, h('div', { class: 'ar-head' }, t('ko_' + roundName(br, ri), { n: n * 2 })),
        Array.from({ length: n }, () => h('div', { class: 'ar-series later' }, h('div', { class: 'ar-sline' }, '—'), h('div', { class: 'ar-sline' }, '—')))));
    }
    const champ = br.champ != null ? h('div', { class: 'ar-round champ' }, h('div', { class: 'ar-head' }, t('ssChampion')), h('div', { class: 'ar-series won' }, this.who(br.comp, br.champ))) : null;
    return h('div', { class: 'ar-bracketwrap' },
      h('div', { class: 'ar-head' }, t(kind === 'cup' ? 'ssCupBracket' : br.comp === 'clan' ? 'ssClanBracket' : 'ssSoloBracket'), h('span', { class: 'ar-sub' }, ' · ' + t('ssBo', { n: br.bestOf }))),
      h('div', { class: 'ar-bracket' }, cols, champ));
  }

  // watching a series' next game starts its round (bets on that round close)
  watchSeries(kind, br, s) {
    const comp = this.save[kind];
    if (roundWaiting(comp, br)) {
      if (kind === 'cup' && comp.phase === 'prep') cupStartNews(this.save, this.chances('cup'));
      if (kind === 'cup') comp.phase = 'ko';
      br.go = br.cur;
    }
    this.touch(true);
    this.watch(kind, s.id);
  }

  // the result of a finished season
  resultCard(c) {
    const r = c.result;
    const line = (label, node) => h('div', { class: 'ar-resline' }, h('span', {}, label), node);
    const names = (ids) => ids.map((id) => this.charName(id)).join(', ') || '—';
    return h('div', { class: 'ar-result' },
      h('div', { class: 'ar-head big' }, t('ssSeasonOver', { n: r.n })),
      r.champ != null ? line(t('ssChampion'), h('b', { class: 'gold' }, this.who('solo', r.champ))) : null,
      r.second != null ? line(t('ssRunnerUp'), this.who('solo', r.second)) : null,
      r.clanChamp != null ? line(t('ssClanChampion'), h('b', { class: 'gold' }, this.who('clan', r.clanChamp))) : null,
      r.divWinners.length > 1 ? line(t('ssDivWinners'), h('span', {}, r.divWinners.map((id, d) => `${d + 1}. ${this.charName(id)}`).join(' · '))) : null,
      r.up.length ? line(t('ssPromoted'), h('span', {}, names(r.up))) : null,
      r.down.length ? line(t('ssRelegated'), h('span', {}, names(r.down))) : null,
      r.mvp != null ? line(t('ssMvp'), this.who('solo', r.mvp)) : null,
      r.frag != null ? line(t('ssFrag'), this.who('solo', r.frag)) : null,
      r.star != null ? line(t('ssStar'), this.who('solo', r.star, h('span', { class: 'ar-sub' }, ` +${r.gain}`))) : null,
      r.born ? line(t('ssNewGen'), h('span', {}, r.born.born.map((b) => `${this.charName(b.id)} (${this.charName(b.replaced)} †)`).join(', '))) : null,
      r.fantasyPay ? line(t('ssFantasyPaid'), h('b', {}, '+' + coins(r.fantasyPay))) : null,
      r.bonus ? line(t('ssSeasonBonus'), h('b', {}, '+' + coins(r.bonus))) : null);
  }

  // ---------------------------------------------------------------- cups
  cupView() {
    const save = this.save, c = save.cup;
    if (!c || c.phase === 'done') {
      return h('div', { class: 'ar-cols' },
        h('div', { class: 'ar-left wide' },
          c?.result ? this.cupResult(c) : null,
          this.cupSetup()),
        h('div', { class: 'ar-right' }, this.cupHistory()));
    }
    const ui = this.ui;
    const prep = c.phase === 'prep';
    const ch = prep ? this.chances('cup')[c.cfg.comp] || {} : null;
    const lvl = walletOf(save).level;
    const el = h('div', { class: 'ar-live' });
    this.liveEl = el;
    this.fillCup(el);
    return h('div', {},
      h('div', { class: 'ar-head big' }, t('ssCupTitle', { n: c.n }), h('span', { class: 'ar-sub' }, ' · ' + t(c.cfg.comp === 'clan' ? 'ssClanCup' : 'ssSoloCup') + ' · ' + t('ssEntrants', { n: c.entrants.length }))),
      prep ? h('div', { class: 'vgui-desc' }, t('ssCupPrepDesc')) : null,
      this.controls('cup'),
      el,
      prep ? h('div', {},
        h('div', { class: 'ar-head' }, t('ssWhoWins')),
        h('table', { class: 'ar-table small' },
          h('tr', {}, h('th', {}, t('name')), h('th', {}, t('ssChance')), h('th', {}, t('ssOdds')), h('th', {})),
          Object.entries(ch).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, p]) => h('tr', {},
            h('td', { class: 'nm' }, this.who(c.cfg.comp, id)), h('td', {}, Math.round(p * 1000) / 10 + '%'), h('td', {}, '×' + odds(p, lvl).toFixed(2)),
            h('td', {}, h('button', { class: 'vgui-btn small', onclick: () => { this.A.betAsk = this.champBetAsk('cup', c.cfg.comp, id); this.redraw(); } }, t('ssBet'))))))) : null,
      h('div', { class: 'ar-btns ar-foot' }, ui.btn(t('ssCallOffCup'), () => this.callOff('cup'))));
  }

  fillCup(el) {
    const save = this.save, c = save.cup;
    if (!c || !el) return;
    const r = this.runner;
    const mine = r.busy() && r.save === save && r.kind === 'cup';
    el.innerHTML = '';
    el.append(
      h('div', { class: 'ar-runline' }, h('span', {}, koWaiting(save, 'cup') ? t('ssRoundWaits') : mine ? (r.state === 'paused' ? t('arenaPaused') : t('ssPlayingRound')) : t('ssIdle'))),
      this.bracketView('cup', c.bracket));
  }

  cupSetup() {
    const ui = this.ui, save = this.save;
    const d = (this.cupDraft ||= cleanCupCfg(save.cupCfg));
    const re = () => this.redraw();
    const sel = (v, list, set, fmt = String) => ui.select(v, list.map((x) => [x, fmt(x)]), (x) => { set(isNaN(+x) ? x : +x); re(); });
    const reason = cupCheck(save, d);
    const n = (save.cupHist?.length || 0) + 1;
    const killList = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100];
    return h('div', { class: 'vgui-form ar-form' },
      h('div', { class: 'ar-head' }, t('ssNewCup', { n })),
      h('div', { class: 'vgui-desc' }, t('ssCupDesc')),
      ui.row(t('ssCupFor'), sel(d.comp, ['solo', 'clan'], (v) => { d.comp = v; }, (x) => t(x === 'clan' ? 'ssClanCup' : 'ssSoloCup'))),
      d.comp === 'solo' ? [
        ui.row(t('ssCupSize'), sel(d.size, [4, 8, 16, 32, 0], (v) => { d.size = v; }, (x) => (x ? t('ssTopRated', { n: x }) : t('ssEveryone')))),
        ui.row(t('ssDuelKills'), sel(d.kills, killList, (v) => { d.kills = v; })),
      ] : [
        h('div', { class: 'ar-pick' }, TEAM_FIGHTS.map((f) => ui.check(t('fight_' + f), d[f], (v) => { d[f] = v; re(); }))),
        ui.row(t('ssTeamSize'), sel(d.teamSize, range(1, MAX_SIDE), (v) => { d.teamSize = v; }, (x) => `${x} v ${x}`)),
        d.tdm ? ui.row(t('ssTeamKills'), sel(d.teamKills, killList, (v) => { d.teamKills = v; })) : null,
        d.classic || d.bomb ? ui.row(t('ssRoundsToWin'), sel(d.rounds, [3, 4, 5, 6, 8, 10, 13, 16], (v) => { d.rounds = v; })) : null,
      ],
      ui.row(t('ssBestOf'), sel(d.bestOf, [1, 3, 5], (v) => { d.bestOf = v; }, (x) => t('ssBo', { n: x }))),
      h('div', { class: 'ar-head' }, t('arenaMaps')),
      h('div', { class: 'ar-pick maps' }, ARENA_MAPS.map((m) => ui.check(m, d.maps.includes(m), (v) => {
        d.maps = v ? [...new Set([...d.maps, m])] : d.maps.filter((x) => x !== m);
        re();
      }))),
      d.comp === 'clan' && d.bomb && !d.maps.some(isBombMapName) ? h('div', { class: 'vgui-desc' }, t('arenaNoBombMap')) : null,
      reason ? h('div', { class: 'vgui-desc hk-off' }, t(reason)) : null,
      h('div', { class: 'ar-btns' }, ui.btn(t('ssCreateCup', { n }), () => {
        if (reason) return;
        save.cupCfg = cleanCupCfg(d);
        save.cup = newCup(save, d);
        this.cupDraft = null;
        this.touch(true);
        this.redraw();
      }, true)));
  }

  cupResult(c) {
    const r = c.result;
    return h('div', { class: 'ar-result' },
      h('div', { class: 'ar-head big' }, t('ssCupOver', { n: r.n })),
      r.champ != null ? h('div', { class: 'ar-resline' }, h('span', {}, t('ssCupWinner')), h('b', { class: 'gold' }, this.who(r.comp, r.champ))) : null,
      r.second != null ? h('div', { class: 'ar-resline' }, h('span', {}, t('ssRunnerUp')), this.who(r.comp, r.second)) : null);
  }

  cupHistory() {
    const list = (this.save.cupHist || []).slice().reverse();
    return h('div', {},
      h('div', { class: 'ar-head' }, t('ssCupHistory')),
      list.length ? list.map((x) => h('div', { class: 'ar-histline' },
        h('b', {}, t('ssCupN', { n: x.n })), ' ',
        h('span', {}, `${x.names[x.champ] || '?'}`), h('span', { class: 'ar-sub' }, ` · ${t(x.comp === 'clan' ? 'ssClanCup' : 'ssSoloCup')} · ${t('ssFinalVs', { name: x.names[x.second] || '?' })}`)))
        : h('div', { class: 'vgui-desc' }, t('ssNoneYet')));
  }

  // ---------------------------------------------------------------- bets
  betLine(b) {
    const w = b.what || { t: 'betWhatMatch', p: {} };
    const p = { ...w.p };
    if (p.f) p.f = t('fight_' + p.f);
    if (p.r) p.r = t('ko_' + p.r, { n: p.rn });
    if (p.k) p.k = t(p.k === 'season' ? 'ssSeasonWord' : p.k === 'cup' ? 'ssCupWord' : p.k === 'clan' ? 'ssClanWord' : 'ssSoloWord');
    return h('div', { class: 'ar-betline' },
      h('span', {}, t(w.t, p)), h('b', {}, ' ' + (b.pickName || '')),
      h('span', { class: 'ar-sub' }, ` · ${coins(b.stake)} × ${b.odds.toFixed(2)} → ${coins(Math.round(b.stake * b.odds))}`));
  }

  betsView() {
    const ui = this.ui, save = this.save, w = walletOf(save);
    const seasonOpen = save.season && save.season.phase !== 'done';
    const net = w.paid - (w.staked - w.open.reduce((s, b) => s + b.stake, 0));
    const histLine = (e) => {
      if (e.kind === 'bet') {
        const cls = e.out === 'won' ? 'won' : e.out === 'lost' ? 'lost' : '';
        const amount = e.out === 'won' ? '+' + coins(e.pay - e.bet.stake) : e.out === 'lost' ? '−' + coins(e.bet.stake) : t('ssRefunded');
        return h('div', { class: 'ar-hist ' + cls }, h('b', {}, amount), ' ', this.betLine(e.bet));
      }
      return h('div', { class: 'ar-hist won' }, h('b', {}, (e.kind === 'bust' ? '' : '+') + coins(e.pay)), ' ', h('span', {}, t('ssHist_' + e.kind, { pts: e.pts })));
    };
    return h('div', { class: 'ar-cols' },
      h('div', { class: 'ar-left' },
        h('div', { class: 'ar-wallet' }, h('div', { class: 'ar-big' }, coins(w.coins)), h('div', { class: 'ar-sub' }, t('ssWalletSub'))),
        ui.row(t('ssLevel'), ui.select(w.next || w.level, BET_LEVELS.map((l) => [l, t('betLevel_' + l)]), (v) => {
          if (seasonOpen) setLevel(save, v);
          else {
            w.level = v;
            w.next = null;
          }
          this.touch(true);
          this.redraw();
        })),
        w.next ? h('div', { class: 'vgui-desc hk-off' }, t('ssLevelNext', { l: t('betLevel_' + w.next), n: (save.season?.n || 0) + 1 })) : null,
        BET_LEVELS.map((l) => h('div', { class: 'vgui-desc' + (l === w.level ? ' ar-est' : '') }, h('b', {}, t('betLevel_' + l) + ': '), t('betLevelDesc_' + l))),
        h('div', { class: 'ar-nums' },
          this.num(t('ssBetsWL'), `${w.wins}-${w.losses}`),
          this.num(t('ssProfit'), (net >= 0 ? '+' : '−') + coins(Math.abs(net))),
          this.num(t('ssBestWin'), coins(w.best)),
          this.num(t('ssFantasyEarned'), coins(w.fantasy)),
          w.busted ? this.num(t('ssBusted'), String(w.busted)) : null),
        h('div', { class: 'vgui-desc' }, t('ssBetsHow'))),
      h('div', { class: 'ar-right' },
        h('div', { class: 'ar-head' }, t('ssOpenBets')),
        w.open.length ? w.open.map((b) => this.betLine(b)) : h('div', { class: 'vgui-desc' }, t('ssNoOpenBets')),
        h('div', { class: 'ar-head' }, t('ssBetHistory')),
        w.hist.length ? h('div', { class: 'ar-feed tall' }, w.hist.map(histLine)) : h('div', { class: 'vgui-desc' }, t('ssNoneYet'))));
  }

  num(label, v) {
    return h('div', { class: 'ar-num' }, h('b', {}, v), h('span', {}, label));
  }

  // ---------------------------------------------------------------- fantasy
  fantasyView() {
    const ui = this.ui, save = this.save, c = save.season;
    if (!c) return h('div', { class: 'vgui-desc' }, t('ssFantasyNone'));
    const picks = c.fantasy.picks, pts = c.fantasy.pts || {};
    const prep = c.phase === 'prep';
    const ids = c.divs.flat();
    const spent = fantasyCost(c, picks);
    const total = picks.reduce((s, id) => s + (pts[id] || 0), 0);
    const head = h('div', {},
      h('div', { class: 'ar-head big' }, t('ssFantasyTitle', { n: c.n })),
      h('div', { class: 'vgui-desc' }, t(prep ? 'ssFantasyPrepDesc' : 'ssFantasyRunDesc', { n: FANTASY.picks, b: FANTASY.budget })),
      h('div', { class: 'ar-nums' },
        this.num(t('ssPicks'), `${picks.length} / ${FANTASY.picks}`),
        this.num(t('ssBudgetLeft'), String(FANTASY.budget - spent)),
        this.num(t('ssFantasyPts'), String(Math.round(total))),
        !prep ? this.num(t('ssFantasyCoins'), coins(total * FANTASY.coin * PAY[walletOf(save).level])) : null));
    const rows = [...ids].sort((a, b) => (prep ? (c.prices[b] || 0) - (c.prices[a] || 0) : (pts[b] || 0) - (pts[a] || 0)));
    const table = h('table', { class: 'ar-table' },
      h('tr', {}, h('th', {}), h('th', {}, t('name')), h('th', {}, t('arenaStyle')), h('th', {}, t('arenaRating')), h('th', {}, t('ssPrice')), h('th', {}, t('ssFantasyPts'))),
      rows.map((id) => {
        const ch = save.chars.find((x) => x.id === id);
        const on = picks.includes(id);
        return h('tr', { class: on ? 'po' : '' },
          h('td', {}, prep ? ui.check('', on, () => {
            const why = fantasyToggle(save, id);
            if (why) this.A.notice(t(why, { n: FANTASY.picks, b: FANTASY.budget }));
            this.touch();
            this.redraw();
          }) : on ? '★' : ''),
          h('td', { class: 'nm' }, this.who('solo', id)),
          h('td', {}, ch ? t('style_' + ch.style) : ''),
          h('td', {}, String(Math.round(statsOf(save, id).r))),
          h('td', {}, String(c.prices[id] ?? '—')),
          h('td', {}, String(Math.round(pts[id] || 0))));
      }));
    return h('div', {}, head, table, h('div', { class: 'vgui-desc' }, t('ssFantasyRules', FANTASY)));
  }

  // ---------------------------------------------------------------- news
  newsView() {
    const ui = this.ui, save = this.save;
    const lang = getLang();
    const picks = new Set(save.season?.fantasy?.picks || []);
    const f = this.newsFilter;
    const chars = save.chars.filter((c) => !c.retired);
    const filter = ui.select(f, [['all', t('ssNewsAll')], ['big', t('ssNewsBig')], ['fantasy', t('ssNewsFantasy')], ['rivals', t('ssNewsRivals')],
      ...chars.map((c) => ['c:' + c.id, c.name])], (v) => { this.newsFilter = v; this.redraw(); });
    const keep = (x) => f === 'all' || (f === 'big' && x.big) || (f === 'fantasy' && x.ids?.some((id) => picks.has(id))) ||
      (f === 'rivals' && (x.k === 'rivals' || x.k === 'rivalWin')) || (f.startsWith('c:') && x.ids?.includes(f.slice(2)));
    const list = (save.news || []).filter(keep).slice().reverse();
    const text = (x) => {
      const p = { ...x.p };
      if (p.f) p.f = t('fight_' + p.f);
      if (p.r) p.r = t('ko_' + p.r, { n: p.rn });
      if (x.k === 'final') p.c = t(p.c === 'cup' ? 'ssCupFinal' : 'ssSeasonFinal');
      return t('news_' + x.k, p);
    };
    const q = (qq) => (qq ? h('div', { class: 'ar-quote' }, '“' + quoteText(lang, qq) + '”', h('span', { class: 'ar-sub' }, ' — ' + qq.by)) : null);
    // rivalries
    const rivals = (save.rivals || []).filter(([a, b]) => save.chars.some((c) => c.id === a) && save.chars.some((c) => c.id === b));
    return h('div', { class: 'ar-cols' },
      h('div', { class: 'ar-left wide' },
        h('div', { class: 'ar-filters' }, filter),
        list.length ? h('div', { class: 'ar-news' }, list.slice(0, 200).map((x) => h('div', { class: 'ar-newsitem' + (x.big ? ' big' : '') },
          h('div', {}, h('span', { class: 'ar-sub' }, x.s ? t('ssSeasonShort', { n: x.s }) + ' · ' : ''), h('span', { class: 'ar-sub' }, '#' + x.n + ' '), text(x)),
          q(x.q), q(x.q2)))) : h('div', { class: 'vgui-desc' }, t('ssNoNews'))),
      h('div', { class: 'ar-right' },
        h('div', { class: 'ar-head' }, t('ssRivalries')),
        rivals.length ? rivals.map(([a, b]) => {
          const x = save.h2h[a]?.[b] || [0, 0, 0];
          return h('div', { class: 'ar-histline' }, this.who('solo', a), h('b', {}, ` ${x[0]} – ${x[1]} `), this.who('solo', b));
        }) : h('div', { class: 'vgui-desc' }, t('ssNoRivals'))));
  }

  // ---------------------------------------------------------------- hall of fame
  fameMini() {
    const hist = (this.save.seasonHist || []).slice(-6).reverse();
    return h('div', {},
      h('div', { class: 'ar-head' }, t('ssPastSeasons')),
      hist.length ? hist.map((x) => h('div', { class: 'ar-histline' }, h('b', {}, t('ssSeasonShort', { n: x.n }) + ' '),
        h('span', {}, x.names[x.champ] || '—'), x.clanChamp ? h('span', { class: 'ar-sub' }, ' · ' + (x.clanNames[x.clanChamp] || '?')) : null))
        : h('div', { class: 'vgui-desc' }, t('ssNoneYet')));
  }

  fameView() {
    const save = this.save;
    const hist = (save.seasonHist || []).slice().reverse();
    const nm = (x, id) => (id == null ? '—' : x.names[id] || this.charName(id));
    const trophies = save.chars.map((c) => ({ c, tr: statsOf(save, c.id).tro }))
      .map((x) => ({ ...x, score: (x.tr.champ || 0) * 10 + (x.tr.cup || 0) * 6 + (x.tr.clan || 0) * 4 + (x.tr.div || 0) * 3 + (x.tr.mvp || 0) * 3 + (x.tr.frag || 0) * 2 + (x.tr.star || 0) }))
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
    const TRO = ['champ', 'cup', 'clan', 'div', 'mvp', 'frag', 'star'];
    return h('div', { class: 'ar-cols' },
      h('div', { class: 'ar-left wide' },
        h('div', { class: 'ar-head' }, t('ssSeasons')),
        hist.length ? h('table', { class: 'ar-table' },
          h('tr', {}, h('th', {}, '#'), h('th', {}, t('ssChampion')), h('th', {}, t('ssRunnerUp')), h('th', {}, t('ssClanChampion')), h('th', {}, t('ssMvp')), h('th', {}, t('ssFrag'))),
          hist.map((x) => h('tr', {}, h('td', {}, String(x.n)), h('td', { class: 'gold' }, nm(x, x.champ)), h('td', {}, nm(x, x.second)),
            h('td', {}, x.clanChamp ? x.clanNames[x.clanChamp] || '?' : '—'), h('td', {}, nm(x, x.mvp)), h('td', {}, nm(x, x.frag)))))
          : h('div', { class: 'vgui-desc' }, t('ssNoneYet')),
        this.cupHistory()),
      h('div', { class: 'ar-right' },
        h('div', { class: 'ar-head' }, t('ssTrophies')),
        trophies.length ? h('table', { class: 'ar-table small' },
          h('tr', {}, h('th', {}, t('name')), TRO.map((k) => h('th', { title: t('tro_' + k) }, t('troShort_' + k)))),
          trophies.slice(0, 25).map((x) => h('tr', { class: x.c.retired ? 'gone' : '' }, h('td', { class: 'nm' }, this.who('solo', x.c.id)),
            TRO.map((k) => h('td', {}, x.tr[k] ? String(x.tr[k]) : '')))))
          : h('div', { class: 'vgui-desc' }, t('ssNoTrophies')),
        h('div', { class: 'vgui-desc' }, TRO.map((k) => `${t('troShort_' + k)} = ${t('tro_' + k)}`).join(' · '))));
  }
}

export { escapeHtml, rivalsOf, roundStarted, coins };

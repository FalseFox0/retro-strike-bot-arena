// Bot Arena's competitions: seasons (a league in divisions for the
// characters and a league for the clans, then playoffs) and cups (knockout
// brackets). All of it is data in the save; the battle runner plays the
// matches a CompSource hands out, one competition at a time.
//
// A match of a competition (M):
//   { id, comp: 'solo'|'clan', stage: 'league'|'ko', div, md (matchday),
//     kind: 'duel'|'ffa'|'team'|'clan', fight, map, sides | players, clans,
//     series, st: 'wait'|'live'|'done', res }
// A knockout series (S): { id, a, b, wa, wb, w, busy, games }

import {
  MAX_FFA, MAX_SIDE, ROUND_FIGHTS, ARENA_MAPS, isBombMapName, makeSpec, statsOf, shuffle, generation, compOpen,
} from './arena.js';

const clamp = (v, lo, hi, def) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);
const pick = (v, list, def) => (list.includes(v) ? v : def);
const bool = (v, def) => (typeof v === 'boolean' ? v : def);

export const TEAM_FIGHTS = ['tdm', 'classic', 'bomb'];

// ---------------------------------------------------------------- settings
export const SEASON_DEFAULTS = {
  maps: [...ARENA_MAPS],
  solo: {
    on: true,
    divs: 2, move: 2,     // divisions, and how many go up / down
    legs: 1,              // times each pair meets in duels
    duel: true, ffa: true, team: true,
    teamFight: 'tdm', teamSize: 5,
    duelKills: 10, ffaKills: 20, teamKills: 30, teamRounds: 5,
    playoffs: 4, bestOf: 3,
  },
  clan: {
    on: true,
    legs: 2,
    tdm: true, classic: true, bomb: true,
    size: 5, kills: 40, rounds: 6,
    playoffs: 2, bestOf: 3,
  },
};

export function cleanSeasonCfg(c) {
  c = c && typeof c === 'object' ? c : {};
  const d = SEASON_DEFAULTS, so = c.solo || {}, cl = c.clan || {};
  const maps = Array.isArray(c.maps) ? c.maps.filter((m) => ARENA_MAPS.includes(m)) : [...d.maps];
  return {
    maps: maps.length ? maps : [...d.maps],
    solo: {
      on: bool(so.on, d.solo.on),
      divs: Math.round(clamp(so.divs, 1, 4, d.solo.divs)),
      move: Math.round(clamp(so.move, 1, 4, d.solo.move)),
      legs: Math.round(clamp(so.legs, 1, 3, d.solo.legs)),
      duel: bool(so.duel, d.solo.duel), ffa: bool(so.ffa, d.solo.ffa), team: bool(so.team, d.solo.team),
      teamFight: pick(so.teamFight, TEAM_FIGHTS, d.solo.teamFight),
      teamSize: Math.round(clamp(so.teamSize, 1, MAX_SIDE, d.solo.teamSize)),
      duelKills: Math.round(clamp(so.duelKills, 1, 100, d.solo.duelKills)),
      ffaKills: Math.round(clamp(so.ffaKills, 1, 150, d.solo.ffaKills)),
      teamKills: Math.round(clamp(so.teamKills, 1, 300, d.solo.teamKills)),
      teamRounds: Math.round(clamp(so.teamRounds, 1, 16, d.solo.teamRounds)),
      playoffs: pick(so.playoffs, [0, 2, 4, 8], d.solo.playoffs),
      bestOf: pick(so.bestOf, [1, 3, 5], d.solo.bestOf),
    },
    clan: {
      on: bool(cl.on, d.clan.on),
      legs: Math.round(clamp(cl.legs, 1, 4, d.clan.legs)),
      tdm: bool(cl.tdm, d.clan.tdm), classic: bool(cl.classic, d.clan.classic), bomb: bool(cl.bomb, d.clan.bomb),
      size: Math.round(clamp(cl.size, 1, MAX_SIDE, d.clan.size)),
      kills: Math.round(clamp(cl.kills, 1, 300, d.clan.kills)),
      rounds: Math.round(clamp(cl.rounds, 1, 16, d.clan.rounds)),
      playoffs: pick(cl.playoffs, [0, 2, 4], d.clan.playoffs),
      bestOf: pick(cl.bestOf, [1, 3, 5], d.clan.bestOf),
    },
  };
}

export const CUP_DEFAULTS = { comp: 'solo', size: 16, bestOf: 1, kills: 10, tdm: true, classic: true, bomb: true, teamSize: 5, teamKills: 40, rounds: 6, maps: [...ARENA_MAPS] };

export function cleanCupCfg(c) {
  c = c && typeof c === 'object' ? c : {};
  const d = CUP_DEFAULTS;
  const maps = Array.isArray(c.maps) ? c.maps.filter((m) => ARENA_MAPS.includes(m)) : [...d.maps];
  return {
    comp: pick(c.comp, ['solo', 'clan'], d.comp),
    size: pick(c.size, [4, 8, 16, 32, 0], d.size), // 0: everyone
    bestOf: pick(c.bestOf, [1, 3, 5], d.bestOf),
    kills: Math.round(clamp(c.kills, 1, 100, d.kills)),
    tdm: bool(c.tdm, d.tdm), classic: bool(c.classic, d.classic), bomb: bool(c.bomb, d.bomb),
    teamSize: Math.round(clamp(c.teamSize, 1, MAX_SIDE, d.teamSize)),
    teamKills: Math.round(clamp(c.teamKills, 1, 300, d.teamKills)),
    rounds: Math.round(clamp(c.rounds, 1, 16, d.rounds)),
    maps: maps.length ? maps : [...d.maps],
  };
}

// what the clan side plays: the fights it allows that the maps can host
const clanFights = (c, maps) => TEAM_FIGHTS.filter((f) => c[f] && (f !== 'bomb' || maps.some(isBombMapName)));

// ---------------------------------------------------------------- who takes part
const liveChars = (save) => save.chars.filter((c) => !c.retired);
const rating = (save, id) => statsOf(save, id).r;
// clans with at least one character
export const playingClans = (save) => save.clans.filter((cl) => cl.members.some((id) => save.chars.some((c) => c.id === id && !c.retired)));
const clanRating = (save, cl) => {
  const rs = cl.members.map((id) => rating(save, id));
  return rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : 0;
};

// Divisions for a season: last season's (moved up and down) with newcomers at
// the bottom, or split by rating when the number of divisions changes.
export function divisionsFor(save, cfg) {
  const ids = liveChars(save).map((c) => c.id);
  const want = Math.max(1, Math.min(cfg.solo.divs, Math.floor(ids.length / 2)));
  const byRating = (a, b) => rating(save, b) - rating(save, a);
  let divs = (save.divs?.solo || []).map((d) => d.filter((id) => ids.includes(id)));
  if (divs.length !== want || !divs.some((d) => d.length)) {
    const sorted = [...ids].sort(byRating);
    divs = [];
    for (let i = 0; i < want; i++) divs.push(sorted.slice(Math.round((i * sorted.length) / want), Math.round(((i + 1) * sorted.length) / want)));
    return divs;
  }
  // newcomers start at the bottom
  const placed = new Set(divs.flat());
  for (const id of ids) if (!placed.has(id)) divs[divs.length - 1].push(id);
  // even sizes again: the extra ones of a crowded division go down (or up)
  const size = (i) => Math.round(((i + 1) * ids.length) / want) - Math.round((i * ids.length) / want);
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < want - 1; i++) {
      divs[i].sort(byRating);
      divs[i + 1].sort(byRating);
      while (divs[i].length > size(i)) divs[i + 1].unshift(divs[i].pop());
      while (divs[i].length < size(i) && divs[i + 1].length) divs[i].push(divs[i + 1].shift());
    }
  }
  return divs;
}

// ---------------------------------------------------------------- schedule
// every pair once: the circle method (one "round" = everyone plays once)
function roundRobin(ids) {
  const list = [...ids];
  if (list.length % 2) list.push(null);
  const n = list.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a && b) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop());
  }
  return rounds;
}

// hands out maps in turn (shuffled each lap), only ones that fit the fight
class MapTurns {
  constructor(maps) {
    this.maps = maps;
    this.bag = [];
    this.bombBag = [];
  }

  take(fight) {
    if (fight === 'bomb') {
      if (!this.bombBag.length) this.bombBag = shuffle(this.maps.filter(isBombMapName));
      return this.bombBag.pop() || 'de_dunetown';
    }
    if (!this.bag.length) this.bag = shuffle([...this.maps]);
    return this.bag.pop();
  }
}

function soloSchedule(cfg, divs) {
  const out = [];
  const so = cfg.solo, turns = new MapTurns(cfg.maps);
  divs.forEach((ids, div) => {
    if (ids.length < 2) return;
    const rr = roundRobin(ids);
    let md = 0;
    for (let leg = 0; leg < so.legs; leg++) {
      for (const pairs of rr) {
        if (so.duel) for (const [a, b] of pairs) out.push({ comp: 'solo', stage: 'league', div, md, kind: 'duel', fight: 'duel', map: turns.take('duel'), sides: leg % 2 ? [[b], [a]] : [[a], [b]] });
        if (so.ffa && ids.length >= 3) out.push({ comp: 'solo', stage: 'league', div, md, kind: 'ffa', fight: 'ffa', map: turns.take('ffa'), players: null });
        // two can't have a free-for-all: they play a duel in its place (when there are no duels)
        else if (so.ffa && !so.duel && ids.length === 2) out.push({ comp: 'solo', stage: 'league', div, md, kind: 'duel', fight: 'duel', map: turns.take('duel'), sides: (leg + md) % 2 ? [[ids[1]], [ids[0]]] : [[ids[0]], [ids[1]]] });
        if (so.team && ids.length >= 2) out.push({ comp: 'solo', stage: 'league', div, md, kind: 'team', fight: so.teamFight, map: turns.take(so.teamFight), sides: null });
        md++;
      }
    }
  });
  return out;
}

function clanSchedule(cfg, clans) {
  const out = [];
  const fights = clanFights(cfg.clan, cfg.maps);
  if (clans.length < 2 || !fights.length) return out;
  const turns = new MapTurns(cfg.maps);
  const rr = roundRobin(clans);
  let md = 0, f = 0;
  for (let leg = 0; leg < cfg.clan.legs; leg++) {
    for (const pairs of rr) {
      for (const [a, b] of pairs) {
        const fight = fights[f++ % fights.length];
        out.push({ comp: 'clan', stage: 'league', div: 0, md, kind: 'clan', fight, map: turns.take(fight), clans: leg % 2 ? [b, a] : [a, b], sides: null });
      }
      md++;
    }
  }
  return out;
}

// the order matches are played in: matchday by matchday, the two leagues together
function interleave(a, b) {
  const all = [...a, ...b];
  return all.sort((x, y) => x.md - y.md || (x.comp === y.comp ? 0 : x.comp === 'solo' ? -1 : 1));
}

// ---------------------------------------------------------------- seasons
// A new season, waiting to start (fantasy picks and champion bets come first).
export function newSeason(save, cfgIn) {
  const cfg = cleanSeasonCfg(cfgIn);
  // a league with nothing to play is off (no divisions moving without a match played)
  if (!(cfg.solo.duel || cfg.solo.ffa || cfg.solo.team)) cfg.solo.on = false;
  if (!clanFights(cfg.clan, cfg.maps).length) cfg.clan.on = false;
  const divs = cfg.solo.on ? divisionsFor(save, cfg) : [];
  // clans only play when one of their fights fits the maps
  const clans = cfg.clan.on && clanFights(cfg.clan, cfg.maps).length ? playingClans(save).map((cl) => cl.id) : [];
  const ms = interleave(cfg.solo.on ? soloSchedule(cfg, divs) : [], clans.length >= 2 ? clanSchedule(cfg, clans) : []);
  ms.forEach((m, i) => { m.id = i; m.st = 'wait'; m.res = null; });
  const n = (save.seasonHist?.length || 0) + 1;
  const startR = {};
  for (const c of liveChars(save)) startR[c.id] = Math.round(rating(save, c.id));
  return {
    n, phase: 'prep', cfg, divs, clans, matches: ms,
    po: { solo: null, clan: null }, koPlay: 'wait',
    startR, startM: save.matches,
    played: {},     // character -> matches this season (who sits out in team matches)
    fantasy: { picks: [], pts: {} },
    prices: fantasyPrices(save, divs.flat()),
    result: null,
  };
}

export function seasonCheck(save, cfgIn) {
  // no maps ticked (the setup would quietly use them all)
  if (Array.isArray(cfgIn?.maps) && !cfgIn.maps.length) return 'arenaNoMaps';
  const cfg = cleanSeasonCfg(cfgIn);
  // bomb defusal team matches need a bomb map among the ticked ones
  if (cfg.solo.on && cfg.solo.team && cfg.solo.teamFight === 'bomb' && !cfg.maps.some(isBombMapName)) return 'arenaNoBombMap';
  const soloOk = cfg.solo.on && liveChars(save).length >= 2 && (cfg.solo.duel || cfg.solo.ffa || cfg.solo.team);
  const clanOk = cfg.clan.on && playingClans(save).length >= 2 && clanFights(cfg.clan, cfg.maps).length > 0;
  if (!soloOk && !clanOk) return cfg.clan.on && playingClans(save).length < 2 ? 'seasonNeedClans' : 'seasonNothing';
  if (!newSeason(save, cfg).matches.length) return 'seasonNothing';
  return null;
}

// how many matches a season of this setup plays (league part)
export function seasonSize(save, cfgIn) {
  const s = newSeason(save, cfgIn);
  return s.matches.length;
}

// ---------------------------------------------------------------- tables
export const pointsFfa = (place, n) => (place === 0 ? 3 : n >= 5 && place === 1 ? 2 : n >= 5 && place === 2 ? 1 : n < 5 && place === 1 ? 1 : 0);
const sideOf = (m, id) => (m.sides ? m.sides.findIndex((s) => s.includes(id)) : -1);

// one division's table: sorted rows { id, p, w, d, l, pts, k, de, form }
export function soloTable(save, season, div) {
  const ids = season.divs[div] || [];
  const rows = new Map(ids.map((id) => [id, { id, p: 0, w: 0, d: 0, l: 0, pts: 0, k: 0, de: 0, form: [] }]));
  for (const m of season.matches) {
    if (m.comp !== 'solo' || m.stage !== 'league' || m.div !== div || m.st !== 'done' || !m.res) continue;
    const r = m.res;
    const who = m.kind === 'ffa' ? r.order : m.sides.flat();
    for (const id of who) {
      const row = rows.get(id);
      if (!row) continue;
      row.p++;
      row.k += r.k[id] || 0;
      row.de += r.de[id] || 0;
      let res;
      if (m.kind === 'ffa') {
        const place = r.order.indexOf(id);
        row.pts += pointsFfa(place, r.order.length);
        // a place that earns points (but not first) shows like a draw
        res = place === 0 ? 'W' : pointsFfa(place, r.order.length) ? 'D' : 'L';
      } else if (r.w == null) {
        row.pts += 1;
        res = 'D';
      } else {
        const won = sideOf(m, id) === r.w;
        if (won) row.pts += 3;
        res = won ? 'W' : 'L';
      }
      row[res === 'W' ? 'w' : res === 'D' ? 'd' : 'l']++;
      row.form.push(res);
    }
  }
  const out = [...rows.values()];
  for (const row of out) row.form = row.form.slice(-5);
  return out.sort((a, b) => b.pts - a.pts || (b.k - b.de) - (a.k - a.de) || b.w - a.w || rating(save, b.id) - rating(save, a.id));
}

// the clan table: rows { id, p, w, d, l, pts, f, a, form } (f / a: rounds, or kills in Team DM)
export function clanTable(save, season) {
  const rows = new Map(season.clans.map((id) => [id, { id, p: 0, w: 0, d: 0, l: 0, pts: 0, f: 0, a: 0, form: [] }]));
  for (const m of season.matches) {
    if (m.comp !== 'clan' || m.stage !== 'league' || m.st !== 'done' || !m.res) continue;
    m.clans.forEach((cid, side) => {
      const row = rows.get(cid);
      if (!row) return;
      const sc = m.res.sc || [0, 0];
      row.p++;
      row.f += sc[side] || 0;
      row.a += sc[1 - side] || 0;
      const res = m.res.w == null ? 'D' : m.res.w === side ? 'W' : 'L';
      row.pts += res === 'W' ? 3 : res === 'D' ? 1 : 0;
      row[res === 'W' ? 'w' : res === 'D' ? 'd' : 'l']++;
      row.form.push(res);
    });
  }
  const out = [...rows.values()];
  for (const row of out) row.form = row.form.slice(-5);
  const cr = (id) => clanRating(save, save.clans.find((c) => c.id === id) || { members: [] });
  return out.sort((a, b) => b.pts - a.pts || (b.f - b.a) - (a.f - a.a) || b.w - a.w || cr(b.id) - cr(a.id));
}

// ---------------------------------------------------------------- brackets
// seeds in bracket order: 1 v 8, 4 v 5, 2 v 7, 3 v 6 ...
function seedOrder(n) {
  let order = [1];
  while (order.length < n) {
    const m = order.length * 2 + 1;
    order = order.flatMap((s) => [s, m - s]);
  }
  return order;
}

// a knockout bracket for these entrants (best first); missing seeds are byes
export function makeBracket(comp, entrants, bestOf) {
  let size = 2;
  while (size < entrants.length) size *= 2;
  const order = seedOrder(size);
  const first = [];
  for (let i = 0; i < size; i += 2) {
    const a = entrants[order[i] - 1] ?? null, b = entrants[order[i + 1] - 1] ?? null;
    first.push(newSeries(`${comp}0_${i / 2}`, a, b));
  }
  return { comp, bestOf, rounds: [first], cur: 0, go: -1, champ: null, second: null };
}

function newSeries(id, a, b) {
  const s = { id, a, b, wa: 0, wb: 0, w: null, busy: false, games: [] };
  // a bye: the one who's there goes through
  if (a == null || b == null) s.w = a ?? b;
  return s;
}

const needWins = (bestOf) => Math.floor(bestOf / 2) + 1;

// when the current round is over: the next one (it waits for Play again), or
// the champion. True when the round ended. (A first-round pair always has
// someone in it, and later rounds have no byes.)
function advance(br) {
  const round = br.rounds[br.cur];
  if (round.some((s) => s.w == null)) return false;
  if (round.length === 1) {
    const s = round[0];
    br.champ = s.w;
    br.second = s.w === s.a ? s.b : s.a;
    return true;
  }
  const next = [];
  for (let i = 0; i < round.length; i += 2) next.push(newSeries(`${br.comp}${br.cur + 1}_${i / 2}`, round[i].w, round[i + 1].w));
  br.rounds.push(next);
  br.cur++;
  return true;
}

export const bracketDone = (br) => !br || br.champ != null;
// A bracket's current round is played once Play was pressed for it
// (br.go === br.cur), or right away after 'Play all'.
export const roundStarted = (comp, br) => comp.koPlay === 'all' || br.go === br.cur;
export const roundWaiting = (comp, br) => !bracketDone(br) && !roundStarted(comp, br);
// a series is in its bracket's current round and still undecided
export const seriesOpen = (br, s) => br.rounds[br.cur].includes(s) && s.w == null;
export const roundName = (br, r) => {
  const left = br.rounds[0].length * 2 / Math.pow(2, r);
  return left === 2 ? 'final' : left === 4 ? 'semi' : left === 8 ? 'quarter' : 'roundOf';
};

// ---------------------------------------------------------------- playing
// A competition the battle runner plays: hands out matches, takes results.
// kind: 'season' | 'cup'. `on`: what happens around it (news, bets), set by
// the page: { seasonEnd(save, result), cupEnd(save, result), series(save, br, s) }.
export class CompSource {
  constructor(save, kind, on = {}) {
    this.save = save;
    this.kind = kind;
    this.on = on;
    this.serial = 0;
  }

  get comp() {
    return this.kind === 'season' ? this.save.season : this.save.cup;
  }

  brackets() {
    const c = this.comp;
    if (!c) return [];
    return this.kind === 'cup' ? [c.bracket].filter(Boolean) : [c.po.solo, c.po.clan].filter(Boolean);
  }

  // the next match to play (want: a match id or a series id to pick that one)
  next(want = null) {
    const c = this.comp;
    if (!c || c.phase === 'done' || c.phase === 'prep') return null;
    if (c.phase === 'league') {
      const m = want != null ? c.matches.find((x) => x.id === want && x.st === 'wait') : c.matches.find((x) => x.st === 'wait');
      return m ? this.specFor(m) : null;
    }
    // knockouts: only rounds that were started
    for (const br of this.brackets()) {
      if (bracketDone(br) || !roundStarted(c, br)) continue;
      for (const s of br.rounds[br.cur]) {
        if (s.w != null || s.busy || (want != null && s.id !== want)) continue;
        return this.specFor(this.koGame(br, s));
      }
    }
    return null;
  }

  // nothing more to hand out now (the runner also waits for matches still playing)
  finished() {
    const c = this.comp;
    if (!c || c.phase === 'done' || c.phase === 'prep') return true;
    if (c.phase === 'league') return !c.matches.some((x) => x.st === 'wait');
    return !this.brackets().some((br) => !bracketDone(br) && roundStarted(c, br) && br.rounds[br.cur].some((s) => s.w == null && !s.busy));
  }

  // the bar on the screen: { done, total }
  progress() {
    const c = this.comp;
    if (!c) return { done: 0, total: 0 };
    if (c.phase === 'league') {
      const lg = c.matches.filter((m) => m.stage === 'league');
      return { done: lg.filter((m) => m.st === 'done').length, total: lg.length };
    }
    const ss = this.brackets().filter((br) => !bracketDone(br)).flatMap((br) => br.rounds[br.cur]);
    return { done: ss.filter((s) => s.w != null).length, total: ss.length };
  }

  // a knockout game: its own match (one at a time per series)
  koGame(br, s) {
    const c = this.comp;
    const k = s.games.length;
    const maps = c.cfg.maps;
    let fight = 'duel', map;
    if (br.comp === 'clan') {
      const fights = this.kind === 'cup' ? clanFights(c.cfg, maps) : clanFights(c.cfg.clan, maps);
      fight = fights[(k + s.id.length) % fights.length] || 'tdm';
    }
    // a different map for each game of a series
    const fit = maps.filter((m) => fight !== 'bomb' || isBombMapName(m));
    s.maps ||= shuffle([...fit]);
    map = s.maps[k % s.maps.length];
    const last = br.rounds[br.cur].length === 1;
    const m = {
      id: c.matches.length, comp: br.comp, stage: 'ko', div: 0, md: br.cur, kind: br.comp === 'clan' ? 'clan' : 'duel', fight, map,
      series: s.id, game: k, final: last, st: 'wait', res: null,
      sides: br.comp === 'solo' ? [[s.a], [s.b]] : null, clans: br.comp === 'clan' ? [s.a, s.b] : null,
    };
    c.matches.push(m);
    s.games.push(m.id);
    s.busy = true;
    return m;
  }

  findSeries(id) {
    for (const br of this.brackets()) for (const r of br.rounds) for (const s of r) if (s.id === id) return { br, s };
    return null;
  }

  // the game's spec (what Game.start gets); the match is now being played
  specFor(m) {
    const save = this.save, c = this.comp;
    const cfg = this.kind === 'cup' ? null : c.cfg;
    let fs, sides = m.sides, players = null, type = m.fight;
    const r = (id) => rating(save, id);
    if (m.kind === 'duel') {
      fs = { kills: this.kind === 'cup' ? c.cfg.kills : cfg.solo.duelKills };
      type = 'duel';
    } else if (m.kind === 'ffa') {
      const div = c.divs[m.div].filter((id) => save.chars.some((x) => x.id === id && !x.retired));
      players = div.length > MAX_FFA ? this.leastPlayed(div, MAX_FFA) : div;
      m.players = players;
      fs = { kills: cfg.solo.ffaKills, size: players.length };
    } else if (m.kind === 'team') {
      const div = c.divs[m.div].filter((id) => save.chars.some((x) => x.id === id && !x.retired));
      const size = Math.min(cfg.solo.teamSize, Math.floor(div.length / 2));
      const chosen = shuffle(this.leastPlayed(div, size * 2));
      sides = m.sides = [chosen.slice(0, size), chosen.slice(size)];
      fs = ROUND_FIGHTS.has(type) ? { rounds: cfg.solo.teamRounds, size } : { kills: cfg.solo.teamKills, size };
    } else {
      // clan against clan: the members who played least this season
      const cc = this.kind === 'cup' ? c.cfg : cfg.clan;
      const want = this.kind === 'cup' ? cc.teamSize : cc.size;
      const mem = m.clans.map((cid) => (save.clans.find((x) => x.id === cid)?.members || []).filter((id) => save.chars.some((x) => x.id === id && !x.retired)));
      const size = Math.max(1, Math.min(want, mem[0].length, mem[1].length));
      sides = m.sides = mem.map((list) => this.leastPlayed(list, size));
      const kills = this.kind === 'cup' ? cc.teamKills : cc.kills;
      fs = ROUND_FIGHTS.has(type) ? { rounds: cc.rounds, size } : { kills, size };
      // a clan with nobody left loses without playing
      if (!mem[0].length || !mem[1].length) return this.forfeit(m, mem[0].length ? 0 : 1);
    }
    const ids = sides ? sides.flat() : players;
    // the match takes the characters themselves (a frozen copy of each)
    const byId = new Map(save.chars.map((ch) => [ch.id, ch]));
    const chars = (list) => list.map((id) => byId.get(id)).filter(Boolean);
    const spec = makeSpec(type, m.map, fs, sides ? sides.map(chars) : null, players ? chars(players) : null, ++this.serial, r);
    for (const id of ids) c.played[id] = (c.played[id] || 0) + 1;
    m.st = 'live';
    spec.comp = { kind: this.kind, n: c.n, mid: m.id, stage: m.stage, final: !!m.final, series: m.series || null, clans: m.clans || null };
    return spec;
  }

  leastPlayed(ids, n) {
    const c = this.comp;
    c.played ||= {};
    return shuffle([...ids]).sort((a, b) => (c.played[a] || 0) - (c.played[b] || 0)).slice(0, n);
  }

  // a match that can't be played: the other side wins it
  forfeit(m, winner) {
    m.st = 'done';
    m.res = { w: winner, sc: winner ? [0, 1] : [1, 0], k: {}, de: {}, order: null, forfeit: true };
    this.after(m);
    return this.next();
  }

  // a match came back from a worker (or the watched one ended)
  take(spec, res) {
    const c = this.comp;
    const m = c && spec.comp && c.matches[spec.comp.mid];
    if (!m || m.st === 'done') return;
    const k = {}, de = {};
    for (const p of res.players) {
      k[p.cid] = p.k;
      de[p.cid] = p.de;
    }
    m.st = 'done';
    m.res = { w: res.winner, sc: res.score, order: res.order, k, de };
    if (m.kind === 'ffa') m.players = res.order;
    this.after(m);
  }

  after(m) {
    const c = this.comp;
    // fantasy points: wins, draws and kills in this season's matches
    if (this.kind === 'season') scoreFantasy(c, m);
    if (m.stage === 'ko') this.koResult(m);
    if (c.phase === 'league' && !c.matches.some((x) => x.stage === 'league' && x.st !== 'done')) this.leagueOver();
  }

  koResult(m) {
    const f = this.findSeries(m.series);
    if (!f) return;
    const { br, s } = f;
    s.busy = false;
    // a drawn game doesn't count: they play another
    if (m.res.w === 0) s.wa++;
    else if (m.res.w === 1) s.wb++;
    const need = needWins(br.bestOf);
    if (s.wa >= need) s.w = s.a;
    else if (s.wb >= need) s.w = s.b;
    if (s.w != null) this.on.series?.(this.save, this.kind, br, s);
    if (advance(br) && this.brackets().every(bracketDone)) this.finish();
  }

  leagueOver() {
    const c = this.comp, save = this.save;
    const so = c.cfg.solo, cl = c.cfg.clan;
    if (so.on && so.playoffs && c.divs[0]?.length >= 2) {
      const n = Math.min(so.playoffs, 1 << Math.floor(Math.log2(c.divs[0].length)));
      c.po.solo = makeBracket('solo', soloTable(save, c, 0).slice(0, n).map((r) => r.id), so.bestOf);
    }
    if (c.clans.length >= 2 && cl.playoffs) {
      const n = Math.min(cl.playoffs, 1 << Math.floor(Math.log2(c.clans.length)));
      c.po.clan = makeBracket('clan', clanTable(save, c).slice(0, n).map((r) => r.id), cl.bestOf);
    }
    if (c.po.solo || c.po.clan) {
      c.phase = 'playoffs';
      c.koPlay = 'wait';
      // a bracket made of byes only is already over
      if (this.brackets().every(bracketDone)) this.finish();
    } else this.finish();
  }

  finish() {
    if (this.kind === 'season') {
      const result = endSeason(this.save);
      this.on.seasonEnd?.(this.save, result);
    } else {
      const result = endCup(this.save);
      this.on.cupEnd?.(this.save, result);
    }
  }

  // a match that wasn't played after all (a worker failed, or the watcher left)
  drop(spec) {
    const c = this.comp;
    const m = c && spec.comp && c.matches[spec.comp.mid];
    if (!m || m.st !== 'live') return;
    const ids = m.sides ? m.sides.flat() : m.players || [];
    for (const id of ids) if (c.played[id]) c.played[id]--;
    if (m.stage === 'ko') {
      // the series asks for a new game when it's its turn again
      const f = this.findSeries(m.series);
      if (f) {
        f.s.busy = false;
        f.s.games = f.s.games.filter((g) => g !== m.id);
      }
      m.st = 'done';
      m.res = null;
      m.void = true;
    } else {
      m.st = 'wait';
      if (m.kind === 'team' || m.kind === 'clan') m.sides = null;
      if (m.kind === 'ffa') m.players = null;
    }
  }
}

// ---------------------------------------------------------------- fantasy
// points for the five picks: a win 3, a draw 1, every kill 0.3 (titles at the end);
// at the end a point is worth half a coin (coin)
export const FANTASY = { win: 3, draw: 1, kill: 0.3, champ: 20, div: 10, up: 5, mvp: 10, frag: 10, clan: 10, budget: 50, picks: 5, coin: 0.5 };

function scoreFantasy(c, m) {
  if (!m.res || m.res.forfeit) return;
  const pts = (c.fantasy.pts ||= {});
  const add = (id, v) => { pts[id] = Math.round(((pts[id] || 0) + v) * 10) / 10; };
  const ids = m.kind === 'ffa' ? m.res.order : m.sides.flat();
  for (const id of ids) {
    add(id, (m.res.k[id] || 0) * FANTASY.kill);
    if (m.kind === 'ffa') {
      const place = m.res.order.indexOf(id);
      if (place === 0) add(id, FANTASY.win);
      else if (pointsFfa(place, m.res.order.length)) add(id, FANTASY.draw);
    } else if (m.res.w == null) add(id, FANTASY.draw);
    else if (sideOf(m, id) === m.res.w) add(id, FANTASY.win);
  }
}

// what a character costs for the fantasy team (better rated, dearer: 4 to 16)
export function fantasyPrices(save, ids) {
  const rs = ids.map((id) => rating(save, id));
  const lo = Math.min(...rs), hi = Math.max(...rs);
  const out = {};
  ids.forEach((id, i) => { out[id] = hi > lo ? Math.round(4 + (12 * (rs[i] - lo)) / (hi - lo)) : 10; });
  return out;
}

// ---------------------------------------------------------------- the end
// awards from this season's matches: { mvp, frag, star } (character ids)
function awards(save, c) {
  const per = new Map();
  const get = (id) => per.get(id) || (per.set(id, { m: 0, k: 0, score: 0 }), per.get(id));
  for (const m of c.matches) {
    if (m.st !== 'done' || !m.res || m.res.forfeit) continue;
    const ids = m.kind === 'ffa' ? m.res.order : m.sides.flat();
    for (const id of ids) {
      const x = get(id);
      x.m++;
      x.k += m.res.k[id] || 0;
      const won = m.kind === 'ffa' ? m.res.order[0] === id : m.res.w != null && sideOf(m, id) === m.res.w;
      x.score += (won ? 3 : m.res.w == null && m.kind !== 'ffa' ? 1 : 0) + (m.res.k[id] || 0) * 0.3;
    }
  }
  const alive = [...per.entries()].filter(([id]) => save.chars.some((ch) => ch.id === id));
  if (!alive.length) return { mvp: null, frag: null, star: null };
  const maxM = Math.max(...alive.map(([, x]) => x.m));
  const regulars = alive.filter(([, x]) => x.m >= maxM / 2);
  const best = (list, f) => list.reduce((a, b) => (f(b) > f(a) ? b : a))[0];
  const gain = (id) => rating(save, id) - (c.startR[id] ?? rating(save, id));
  return {
    mvp: best(regulars, ([, x]) => x.score / x.m),
    frag: best(alive, ([, x]) => x.k),
    star: best(alive, ([id]) => gain(id)),
    gain: Math.round(gain(best(alive, ([id]) => gain(id)))),
  };
}

const trophy = (save, id, kind) => {
  const tro = statsOf(save, id).tro;
  tro[kind] = (tro[kind] || 0) + 1;
};

// The season is over: champions, trophies, who goes up and down, the
// next generation (in "new generations" saves). Returns the season's result.
export function endSeason(save) {
  const c = save.season;
  const so = c.cfg.solo;
  const result = {
    n: c.n, from: c.startM + 1, to: save.matches,
    champ: null, second: null, clanChamp: null, clanSecond: null,
    divWinners: [], up: [], down: [], mvp: null, frag: null, star: null, gain: 0, born: null,
  };
  // solo: division winners (by the table), the champion (playoffs, else the top table)
  const tables = c.divs.map((_, d) => soloTable(save, c, d));
  tables.forEach((tb) => { if (tb[0]?.p) result.divWinners.push(tb[0].id); });
  if (c.po.solo?.champ != null) {
    result.champ = c.po.solo.champ;
    result.second = c.po.solo.second;
  } else if (tables[0]?.[0]?.p) {
    result.champ = tables[0][0].id;
    result.second = tables[0][1]?.id ?? null;
  }
  // clans
  if (c.clans.length >= 2) {
    const ct = clanTable(save, c);
    if (c.po.clan?.champ != null) {
      result.clanChamp = c.po.clan.champ;
      result.clanSecond = c.po.clan.second;
    } else if (ct[0]?.p) {
      result.clanChamp = ct[0].id;
      result.clanSecond = ct[1]?.id ?? null;
    }
  }
  // up and down: the bottom of a division swaps with the top of the next
  if (so.on && c.divs.length > 1) {
    const next = c.divs.map((d) => [...d]);
    for (let d = 0; d < c.divs.length - 1; d++) {
      const move = Math.min(so.move, Math.floor(Math.min(c.divs[d].length, c.divs[d + 1].length) / 2));
      const down = tables[d].slice(-move).map((r) => r.id), up = tables[d + 1].slice(0, move).map((r) => r.id);
      next[d] = next[d].filter((id) => !down.includes(id)).concat(up);
      next[d + 1] = next[d + 1].filter((id) => !up.includes(id)).concat(down);
      result.up.push(...up);
      result.down.push(...down);
    }
    save.divs = { solo: next };
  } else if (so.on) save.divs = { solo: c.divs.map((d) => [...d]) };
  // awards and trophies
  Object.assign(result, awards(save, c));
  if (result.champ != null) trophy(save, result.champ, 'champ');
  for (const id of result.divWinners) trophy(save, id, 'div');
  if (result.clanChamp != null) {
    const cl = save.clans.find((x) => x.id === result.clanChamp);
    for (const id of cl?.members || []) trophy(save, id, 'clan');
  }
  for (const k of ['mvp', 'frag', 'star']) if (result[k] != null) trophy(save, result[k], k);
  // fantasy titles
  const pts = (c.fantasy.pts ||= {});
  const add = (id, v) => { if (id != null) pts[id] = Math.round(((pts[id] || 0) + v) * 10) / 10; };
  add(result.champ, FANTASY.champ);
  for (const id of result.divWinners) add(id, FANTASY.div);
  for (const id of result.up) add(id, FANTASY.up);
  add(result.mvp, FANTASY.mvp);
  add(result.frag, FANTASY.frag);
  if (result.clanChamp != null) for (const id of save.clans.find((x) => x.id === result.clanChamp)?.members || []) add(id, FANTASY.clan);
  result.fantasy = c.fantasy.picks.reduce((s, id) => s + (pts[id] || 0), 0);
  c.phase = 'done';
  c.result = result;
  // a short record for the hall of fame (the season itself goes when the next starts)
  (save.seasonHist ||= []).push({
    n: c.n, from: result.from, to: result.to, champ: result.champ, second: result.second, clanChamp: result.clanChamp, clanSecond: result.clanSecond,
    divWinners: result.divWinners, up: result.up, down: result.down, mvp: result.mvp, frag: result.frag, star: result.star,
    names: namesOf(save, [result.champ, result.second, ...result.divWinners, result.mvp, result.frag, result.star, ...result.up, ...result.down]),
    clanNames: clanNamesOf(save, [result.clanChamp, result.clanSecond]),
  });
  // the off-season: a new generation
  if (save.settings.evolve === 'gen' && !(save.cup && save.cup.phase !== 'done')) {
    const born = generation(save);
    if (born) result.born = born;
  }
  return result;
}

// names at the time (characters can retire and be renamed later)
function namesOf(save, ids) {
  const out = {};
  for (const id of ids) {
    const c = save.chars.find((x) => x.id === id);
    if (c) out[id] = c.name;
  }
  return out;
}
function clanNamesOf(save, ids) {
  const out = {};
  for (const id of ids) {
    const c = save.clans.find((x) => x.id === id);
    if (c) out[id] = c.name;
  }
  return out;
}

// ---------------------------------------------------------------- cups
export function cupEntrants(save, cfg) {
  if (cfg.comp === 'clan') {
    return playingClans(save).sort((a, b) => clanRating(save, b) - clanRating(save, a)).map((c) => c.id);
  }
  const ids = liveChars(save).map((c) => c.id).sort((a, b) => rating(save, b) - rating(save, a));
  return cfg.size ? ids.slice(0, cfg.size) : ids;
}

export function cupCheck(save, cfgIn) {
  if (Array.isArray(cfgIn?.maps) && !cfgIn.maps.length) return 'arenaNoMaps';
  const cfg = cleanCupCfg(cfgIn);
  if (cfg.comp === 'clan') {
    if (playingClans(save).length < 2) return 'seasonNeedClans';
    if (!clanFights(cfg, cfg.maps).length) return 'seasonNothing';
  }
  return cupEntrants(save, cfg).length < 2 ? 'seasonNothing' : null;
}

export function newCup(save, cfgIn) {
  const cfg = cleanCupCfg(cfgIn);
  const entrants = cupEntrants(save, cfg);
  return {
    n: (save.cupHist?.length || 0) + 1, phase: 'prep', cfg, entrants,
    bracket: makeBracket(cfg.comp, entrants, cfg.bestOf), matches: [], koPlay: 'wait', played: {}, result: null,
    startM: save.matches,
  };
}

function endCup(save) {
  const c = save.cup;
  const br = c.bracket;
  const result = { n: c.n, comp: c.cfg.comp, champ: br.champ, second: br.second };
  if (br.champ != null) {
    if (c.cfg.comp === 'clan') for (const id of save.clans.find((x) => x.id === br.champ)?.members || []) trophy(save, id, 'cup');
    else trophy(save, br.champ, 'cup');
  }
  c.phase = 'done';
  c.result = result;
  (save.cupHist ||= []).push({
    n: c.n, comp: c.cfg.comp, champ: br.champ, second: br.second, size: c.entrants.length, at: save.matches,
    names: c.cfg.comp === 'clan' ? clanNamesOf(save, [br.champ, br.second]) : namesOf(save, [br.champ, br.second]),
  });
  return result;
}

// ---------------------------------------------------------------- starting / loading
// the season leaves its waiting room: no more fantasy picks or champion bets
export function startSeason(save) {
  const c = save.season;
  if (!c || c.phase !== 'prep') return false;
  c.phase = 'league';
  return true;
}

// After loading: matches that were being played when the page closed wait again.
export function fixComps(save) {
  for (const kind of ['season', 'cup']) {
    const c = save[kind];
    // a competition that isn't whole (damaged data) goes: it couldn't be shown or played
    const whole = c && Array.isArray(c.matches) && c.cfg && typeof c.phase === 'string' && (kind === 'season'
      ? Array.isArray(c.divs) && Array.isArray(c.clans) && c.po && typeof c.po === 'object' && c.fantasy && Array.isArray(c.fantasy.picks)
      : Array.isArray(c.entrants) && c.bracket && Array.isArray(c.bracket.rounds));
    if (!whole) {
      save[kind] = null;
      continue;
    }
    const src = new CompSource(save, kind);
    for (const m of c.matches) {
      if (m.st !== 'live') continue;
      src.drop({ comp: { mid: m.id } });
    }
  }
  return save;
}

// Play: the waiting knockout rounds start (bets on them close); all: the
// rest of the brackets play without waiting again
export function playKnockouts(save, kind, all = false) {
  const c = save[kind];
  if (!c) return;
  if (kind === 'cup' && c.phase === 'prep') c.phase = 'ko';
  if (all) c.koPlay = 'all';
  for (const br of kind === 'cup' ? [c.bracket] : [c.po.solo, c.po.clan]) if (br && !bracketDone(br)) br.go = br.cur;
}

// a knockout round waits for Play somewhere in this competition
export function koWaiting(save, kind) {
  const c = save[kind];
  if (!c || c.phase === 'done' || c.phase === 'league' || (kind === 'season' && c.phase === 'prep')) return false;
  return (kind === 'cup' ? [c.bracket] : [c.po.solo, c.po.clan]).some((br) => br && roundWaiting(c, br));
}

export { compOpen };

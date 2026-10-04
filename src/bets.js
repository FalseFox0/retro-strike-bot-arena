// Bot Arena betting with play money: a wallet per save, odds from the
// ratings, bets on a match you watch, on knockout series and on who wins it
// all, and the fantasy team's pay at the end of a season.
//
// Difficulty (per save; a change counts from the next season):
//   easy   never below 100 coins (topped up when the last bet is settled)
//   normal 1000 to start and a bonus every season
//   hard   broke means a fresh 1000 and a "busted" mark
// Harder levels pay better odds.

import { expect, statsOf, MAX_FFA, shuffle } from './arena.js';
import { soloTable, clanTable, makeBracket, playingClans, pointsFfa, FANTASY } from './league.js';

export const BET_LEVELS = ['easy', 'normal', 'hard'];
// what a winning bet pays, times the fair odds
export const PAY = { easy: 0.9, normal: 1, hard: 1.15 };
export const MIN_BET = 10;
export const START_COINS = 1000;
const EASY_FLOOR = 100;
const HIST_MAX = 100;

export function walletOf(save) {
  const w = (save.wallet && typeof save.wallet === 'object' ? save.wallet : (save.wallet = {}));
  if (typeof w.coins !== 'number' || !isFinite(w.coins)) w.coins = START_COINS;
  if (!BET_LEVELS.includes(w.level)) w.level = 'normal';
  if (!BET_LEVELS.includes(w.next)) w.next = null;
  // bets and history lines that aren't whole are left out
  w.open = Array.isArray(w.open) ? w.open.filter((b) => b && typeof b.stake === 'number' && typeof b.odds === 'number') : [];
  w.hist = Array.isArray(w.hist) ? w.hist.filter((e) => e && typeof e.kind === 'string' && (e.kind !== 'bet' || (e.bet && typeof e.bet.odds === 'number'))) : [];
  for (const k of ['staked', 'paid', 'wins', 'losses', 'busted', 'best', 'fantasy']) if (typeof w[k] !== 'number') w[k] = 0;
  return w;
}

// a level picked now counts from the next season
export function setLevel(save, level) {
  const w = walletOf(save);
  w.next = level === w.level ? null : level;
}

// the next season begins: a new level, and Normal's season bonus
export function seasonTurn(save) {
  const w = walletOf(save);
  if (w.next) {
    w.level = w.next;
    w.next = null;
  }
}

export function seasonBonus(save) {
  const w = walletOf(save);
  if (w.level !== 'normal') return 0;
  const bonus = w.coins < 200 ? 300 : 100;
  w.coins += bonus;
  note(w, { kind: 'bonus', pay: bonus });
  return bonus;
}

const note = (w, e) => {
  w.hist.unshift({ ...e, t: Date.now() });
  if (w.hist.length > HIST_MAX) w.hist.length = HIST_MAX;
};

// decimal odds for a chance p at this level (what 1 coin brings back)
export function odds(p, level) {
  if (!Number.isFinite(p)) p = 0.5;
  const o = (PAY[level] || 1) / Math.max(0.004, Math.min(0.995, p));
  return Math.round(Math.max(1.02, Math.min(250, o)) * 100) / 100;
}

// ---------------------------------------------------------------- chances
const avg = (save, ids) => (ids.length ? ids.reduce((s, id) => s + statsOf(save, id).r, 0) / ids.length : 1000);

// two sides: the chance side 0 wins (a draw is left out: it refunds)
export const sideChance = (save, sides) => expect(avg(save, sides[0]), avg(save, sides[1]));

// free-for-all: each one's chance of finishing first (stronger, likelier)
export function ffaChances(save, ids) {
  const w = ids.map((id) => Math.pow(10, statsOf(save, id).r / 400));
  const sum = w.reduce((s, x) => s + x, 0);
  return Object.fromEntries(ids.map((id, i) => [id, w[i] / sum]));
}

// winning a best-of series from a game chance p
export function seriesChance(p, bestOf) {
  const need = Math.floor(bestOf / 2) + 1;
  let out = 0, c = 1;
  for (let k = 0; k < need; k++) {
    // need wins, k losses, the last game a win
    if (k > 0) c = (c * (need - 1 + k)) / k;
    out += c * Math.pow(p, need) * Math.pow(1 - p, k);
  }
  return out;
}

// ---------------------------------------------------------------- placing and settling
let serial = 0;
const betId = () => Date.now().toString(36) + (serial++).toString(36);

// bet = { kind: 'match'|'series'|'champ', ref, pick, stake, odds, what } -> the bet or null
export function placeBet(save, bet) {
  const w = walletOf(save);
  const stake = Math.floor(bet.stake);
  if (!(stake >= MIN_BET) || stake > w.coins) return null;
  const b = { ...bet, stake, id: betId(), level: w.level, at: save.matches };
  w.coins -= stake;
  w.staked += stake;
  w.open.push(b);
  return b;
}

// out: 'won' | 'lost' | 'refund'. Returns the coins paid back.
export function settle(save, b, out) {
  const w = walletOf(save);
  const i = w.open.indexOf(b);
  if (i < 0) return 0;
  w.open.splice(i, 1);
  let pay = 0;
  if (out === 'won') {
    pay = Math.round(b.stake * b.odds);
    w.wins++;
    w.best = Math.max(w.best, pay - b.stake);
  } else if (out === 'refund') {
    pay = b.stake;
    w.staked -= b.stake;
  } else w.losses++;
  w.coins += pay;
  if (out !== 'refund') w.paid += pay;
  note(w, { kind: 'bet', bet: b, out, pay });
  rules(save);
  return pay;
}

// the level's rule when the last open bet is settled
function rules(save) {
  const w = walletOf(save);
  if (w.open.length) return;
  if (w.level === 'easy' && w.coins < EASY_FLOOR) {
    note(w, { kind: 'topup', pay: EASY_FLOOR - w.coins });
    w.coins = EASY_FLOOR;
  } else if (w.level === 'hard' && w.coins < MIN_BET) {
    w.busted++;
    note(w, { kind: 'bust', pay: START_COINS - w.coins });
    w.coins = START_COINS;
  }
}

// a watched match ended (or was left: refund)
export function settleMatch(save, b, res) {
  if (!b || !res) return settle(save, b, 'refund');
  if (b.ffa) return settle(save, b, res.order?.[0] === b.pick ? 'won' : 'lost');
  if (res.winner == null) return settle(save, b, 'refund');
  return settle(save, b, res.winner === b.pick ? 'won' : 'lost');
}

// a knockout series is decided
export function settleSeries(save, kind, n, s) {
  const w = walletOf(save);
  const out = [];
  for (const b of [...w.open]) {
    if (b.kind !== 'series' || b.ref.kind !== kind || b.ref.n !== n || b.ref.sid !== s.id) continue;
    out.push([b, settle(save, b, (b.pick === 0 ? s.a : s.b) === s.w ? 'won' : 'lost')]);
  }
  return out;
}

// a season or cup is over (champ null: called off, everything back)
export function settleChamps(save, kind, n, comp, champ) {
  const w = walletOf(save);
  const out = [];
  for (const b of [...w.open]) {
    if (b.kind !== 'champ' || b.ref.kind !== kind || b.ref.n !== n || b.ref.comp !== comp) continue;
    out.push([b, settle(save, b, champ == null ? 'refund' : b.pick === champ ? 'won' : 'lost')]);
  }
  return out;
}

// everything still open on this competition goes back (it was called off)
export function refundComp(save, kind, n) {
  const w = walletOf(save);
  for (const b of [...w.open]) if (b.ref && b.ref.kind === kind && b.ref.n === n) settle(save, b, 'refund');
}

// the fantasy team's points become coins at the end of a season
export function fantasyPay(save, pts) {
  const w = walletOf(save);
  const pay = Math.round(pts * FANTASY.coin * PAY[w.level]);
  if (pay <= 0) return 0;
  w.coins += pay;
  w.fantasy += pay;
  note(w, { kind: 'fantasy', pay, pts: Math.round(pts) });
  return pay;
}

// ---------------------------------------------------------------- who wins it all
// The chance each one has to win the competition, from simulating it many
// times with the current ratings. kind 'season': { solo: {id: p}, clan: {id: p} };
// kind 'cup': { solo|clan: {id: p} }.
export function champChances(save, kind, runs = 800) {
  const c = save[kind];
  if (!c) return {};
  const r = new Map();
  for (const ch of save.chars) r.set(ch.id, statsOf(save, ch.id).r);
  const clanR = new Map(save.clans.map((cl) => [cl.id, avg(save, cl.members.filter((id) => r.has(id)))]));
  const win = (ra, rb) => Math.random() < expect(ra, rb);
  const seriesWin = (ra, rb, bestOf) => Math.random() < seriesChance(expect(ra, rb), bestOf);
  // a bracket from seeds, played out
  const playBracket = (entrants, bestOf, rOf) => {
    const br = makeBracket('x', entrants, bestOf);
    let round = br.rounds[0].map((s) => [s.a, s.b]);
    for (;;) {
      const winners = round.map(([a, b]) => (a == null ? b : b == null ? a : seriesWin(rOf(a), rOf(b), bestOf) ? a : b));
      if (winners.length === 1) return winners[0];
      round = [];
      for (let i = 0; i < winners.length; i += 2) round.push([winners[i], winners[i + 1]]);
    }
  };
  const count = { solo: {}, clan: {} };
  const add = (comp, id) => { if (id != null) count[comp][id] = (count[comp][id] || 0) + 1; };
  if (kind === 'cup') {
    const comp = c.cfg.comp;
    const rOf = comp === 'clan' ? (id) => clanR.get(id) ?? 1000 : (id) => r.get(id) ?? 1000;
    for (let i = 0; i < runs; i++) add(comp, playBracket(c.entrants, c.cfg.bestOf, rOf));
    return { [comp]: norm(count[comp], runs) };
  }
  const so = c.cfg.solo, cl = c.cfg.clan;
  for (let i = 0; i < runs; i++) {
    // the league, match by match (team matches: random teams of the division)
    const pts = new Map();
    const give = (id, v) => pts.set(id, (pts.get(id) || 0) + v);
    for (const m of c.matches) {
      if (m.stage !== 'league') continue;
      if (m.st === 'done' && m.res) {
        // already played: as it went
        tally(m, give);
        continue;
      }
      if (m.kind === 'duel') {
        const [a, b] = [m.sides[0][0], m.sides[1][0]];
        give(win(r.get(a), r.get(b)) ? a : b, 3);
      } else if (m.kind === 'ffa') {
        const ids = c.divs[m.div].slice(0, MAX_FFA);
        const order = luceOrder(ids, (id) => r.get(id) ?? 1000);
        order.forEach((id, place) => give(id, pointsFfa(place, ids.length)));
      } else if (m.kind === 'team') {
        const div = shuffle([...c.divs[m.div]]);
        const size = Math.min(so.teamSize, Math.floor(div.length / 2));
        const a = div.slice(0, size), b = div.slice(size, size * 2);
        const ra = a.reduce((s, id) => s + (r.get(id) ?? 1000), 0) / size, rb = b.reduce((s, id) => s + (r.get(id) ?? 1000), 0) / size;
        for (const id of win(ra, rb) ? a : b) give(id, 3);
      } else if (m.kind === 'clan') {
        const [a, b] = m.clans;
        give('c:' + (win(clanR.get(a), clanR.get(b)) ? a : b), 3);
      }
    }
    if (so.on && c.divs[0]?.length >= 2) {
      const top = [...c.divs[0]].sort((a, b) => (pts.get(b) || 0) - (pts.get(a) || 0) || (r.get(b) - r.get(a)));
      const n = so.playoffs ? Math.min(so.playoffs, 1 << Math.floor(Math.log2(top.length))) : 0;
      add('solo', n ? playBracket(top.slice(0, n), so.bestOf, (id) => r.get(id) ?? 1000) : top[0]);
    }
    if (c.clans.length >= 2) {
      const top = [...c.clans].sort((a, b) => (pts.get('c:' + b) || 0) - (pts.get('c:' + a) || 0) || clanR.get(b) - clanR.get(a));
      const n = cl.playoffs ? Math.min(cl.playoffs, 1 << Math.floor(Math.log2(top.length))) : 0;
      add('clan', n ? playBracket(top.slice(0, n), cl.bestOf, (id) => clanR.get(id) ?? 1000) : top[0]);
    }
  }
  return { solo: norm(count.solo, runs), clan: norm(count.clan, runs) };
}

function tally(m, give) {
  const r = m.res;
  if (m.kind === 'ffa') r.order.forEach((id, place) => give(id, pointsFfa(place, r.order.length)));
  else if (m.kind === 'clan') {
    if (r.w == null) m.clans.forEach((id) => give('c:' + id, 1));
    else give('c:' + m.clans[r.w], 3);
  } else if (r.w == null) m.sides.flat().forEach((id) => give(id, 1));
  else m.sides[r.w].forEach((id) => give(id, 3));
}

// the finishing order of a free-for-all, drawn by strength
function luceOrder(ids, rOf) {
  const left = [...ids], out = [];
  while (left.length) {
    const w = left.map((id) => Math.pow(10, rOf(id) / 400));
    let x = Math.random() * w.reduce((s, v) => s + v, 0);
    let i = 0;
    while (i < left.length - 1 && (x -= w[i]) > 0) i++;
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

const norm = (count, runs) => Object.fromEntries(Object.entries(count).map(([id, n]) => [id, n / runs]));

// ---------------------------------------------------------------- fantasy
export const fantasyCost = (c, ids) => ids.reduce((s, id) => s + (c.prices?.[id] || 0), 0);

export function fantasyToggle(save, id) {
  const c = save.season;
  if (!c || c.phase !== 'prep') return 'fantasyClosed';
  const picks = c.fantasy.picks;
  const i = picks.indexOf(id);
  if (i >= 0) {
    picks.splice(i, 1);
    return null;
  }
  if (picks.length >= FANTASY.picks) return 'fantasyFull';
  if (fantasyCost(c, [...picks, id]) > FANTASY.budget) return 'fantasyBudget';
  picks.push(id);
  return null;
}

export { playingClans, soloTable, clanTable };

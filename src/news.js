// Bot Arena's news feed: upsets, streaks, records, rivalries, champions,
// with a line from the character in their own personality (quotes.js).
// An item: { n (match), s (season), k (kind), p (names and numbers), ids
// (who it's about, for the filter), q (a quote), big (shown bold) }.
// Names are kept as they were then: the news is history.

import { statsOf, expect } from './arena.js';
import { seriesChance } from './bets.js';
import { roundName } from './league.js';
import { QUOTES } from './quotes.js';

const NEWS_MAX = 300;
const WIN_MARKS = [50, 100, 250, 500, 1000, 2500, 5000, 10000];
const KILL_MARKS = [500, 1000, 2500, 5000, 10000, 25000, 50000];
// rivals: met this often, and this close
const RIVAL_MIN = 10;
const RIVALS_EACH = 2;

const charOf = (save, id) => save.chars.find((c) => c.id === id);
const nameOf = (save, id) => charOf(save, id)?.name || '?';
const clanName = (save, id) => save.clans.find((c) => c.id === id)?.name || '?';

export function addNews(save, item) {
  const list = (save.news ||= []);
  list.push({ n: save.matches, s: save.season && save.season.phase !== 'done' ? save.season.n : null, ...item });
  if (list.length > NEWS_MAX) list.splice(0, list.length - NEWS_MAX);
  return item;
}

// a line from this character for this moment ({b}: the other one)
function quote(save, id, sit, extra = {}) {
  const c = charOf(save, id);
  if (!c) return null;
  const n = QUOTES.en[c.pers]?.[sit]?.length || 0;
  if (!n) return null;
  return { by: c.name, p: c.pers, sit, i: (Math.random() * n) | 0, ...extra };
}

// ---------------------------------------------------------------- after every match
export function matchNews(save, spec, res, ctx) {
  const comp = !!spec.comp;
  const plays = ctx.plays;
  const before = ctx.before;
  const out = [];
  const push = (item) => out.push(addNews(save, item));
  const one = (side) => plays.filter((p) => p.side === side).map((p) => p.cid);
  // upsets: duels (and knockout duels), free-for-all, clan matches
  if (spec.type === 'ffa') {
    // the winner's chance before the match (stronger players, likelier winners)
    const ids = res.order.filter((id) => before.has(id));
    const ws = ids.map((id) => Math.pow(10, before.get(id) / 400));
    const w = ids[0], p = ids.length ? ws[0] / ws.reduce((s, x) => s + x, 0) : 1;
    if (ids.length >= 6 && p < (comp ? 0.07 : 0.04)) push({ k: 'upsetFfa', p: { a: nameOf(save, w), p: Math.round(p * 100) }, ids: [w], q: quote(save, w, 'upset', { b: nameOf(save, ids[1]) }) });
  } else if (res.winner != null && (spec.type === 'duel' || spec.comp?.clans)) {
    const avg = (ids) => ids.reduce((s, id) => s + (before.get(id) ?? 1000), 0) / Math.max(1, ids.length);
    const win = one(res.winner), lose = one(1 - res.winner);
    const p = expect(avg(win), avg(lose));
    if (p < (comp ? 0.3 : 0.2)) {
      const clans = spec.comp?.clans;
      const a = clans ? clanName(save, clans[res.winner]) : nameOf(save, win[0]);
      const b = clans ? clanName(save, clans[1 - res.winner]) : nameOf(save, lose[0]);
      const item = { k: clans ? 'upsetClan' : 'upset', p: { a, b, p: Math.round(p * 100) }, ids: [...win, ...lose] };
      if (!clans) {
        item.q = quote(save, win[0], 'upset', { b });
        if (p < 0.2) item.q2 = quote(save, lose[0], 'upsetLoss', { b: a });
      }
      push(item);
    }
  }
  for (const pr of plays) {
    const id = pr.cid, st = statsOf(save, id), c = charOf(save, id);
    if (!c) continue;
    // streaks
    if (st.cs >= 5 && st.cs % 5 === 0) push({ k: 'streak', p: { a: c.name, x: st.cs }, ids: [id], q: quote(save, id, 'streak', { n: st.cs }), big: st.cs >= 10 });
    if (st.cs <= -5 && -st.cs % 5 === 0) push({ k: 'slump', p: { a: c.name, x: -st.cs }, ids: [id], q: quote(save, id, 'slump') });
    // milestones
    const o = ctx.outs.get(id);
    if (o?.win && WIN_MARKS.includes(st.w)) push({ k: 'wins', p: { a: c.name, x: st.w }, ids: [id] });
    const k0 = st.k - (pr.k || 0);
    for (const m of KILL_MARKS) if (k0 < m && st.k >= m) push({ k: 'kills', p: { a: c.name, x: m }, ids: [id] });
    // a career-best rating past each hundred (from 1100 up)
    const mark = Math.floor(st.r / 100) * 100;
    if (mark >= 1100 && mark > (st.pm || 1000)) {
      st.pm = mark;
      push({ k: 'peak', p: { a: c.name, x: mark }, ids: [id], big: mark >= 1300 });
    }
    // records: most kills in one match of this kind
    const recs = (save.records ||= {});
    const r = recs[spec.type];
    if (pr.k > 0 && (!r || pr.k > r.k)) {
      recs[spec.type] = { k: pr.k, id, name: c.name, n: save.matches };
      // the first matches of a save set records all the time: quiet until there's history
      if (r && save.matches > 50) push({ k: 'record', p: { a: c.name, x: pr.k, f: spec.type }, ids: [id] });
    }
  }
  // rivalries: one against one
  if (spec.type === 'duel' && res.winner != null) {
    const w = one(res.winner)[0], l = one(1 - res.winner)[0];
    rivalry(save, w, l, comp, push);
  }
  return out;
}

export const rivalsOf = (save, id) => (save.rivals || []).filter((r) => r[0] === id || r[1] === id).map((r) => (r[0] === id ? r[1] : r[0]));
const areRivals = (save, a, b) => (save.rivals || []).some((r) => (r[0] === a && r[1] === b) || (r[0] === b && r[1] === a));

function rivalry(save, w, l, comp, push) {
  if (!charOf(save, w) || !charOf(save, l)) return;
  const h = save.h2h[w]?.[l];
  if (!h) return;
  const n = h[0] + h[1] + h[2];
  if (areRivals(save, w, l)) {
    // rivals meeting in a season or a cup make the news
    if (comp) push({ k: 'rivalWin', p: { a: nameOf(save, w), b: nameOf(save, l), x: h[0], y: h[1] }, ids: [w, l], q: quote(save, w, 'rival', { b: nameOf(save, l) }) });
    return;
  }
  if (n < RIVAL_MIN || Math.abs(h[0] - h[1]) > Math.max(1, Math.round(n * 0.12))) return;
  if (rivalsOf(save, w).length >= RIVALS_EACH || rivalsOf(save, l).length >= RIVALS_EACH) return;
  (save.rivals ||= []).push([w, l, save.matches]);
  push({ k: 'rivals', p: { a: nameOf(save, w), b: nameOf(save, l), x: h[0], y: h[1] }, ids: [w, l], big: true });
}

// ---------------------------------------------------------------- competitions
const sideName = (save, comp, id) => (comp === 'clan' ? clanName(save, id) : nameOf(save, id));
const sideRating = (save, comp, id) => {
  if (comp !== 'clan') return statsOf(save, id).r;
  const cl = save.clans.find((c) => c.id === id);
  const rs = (cl?.members || []).map((m) => statsOf(save, m).r);
  return rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : 1000;
};

// a knockout series is decided
export function seriesNews(save, kind, br, s) {
  const comp = br.comp;
  const w = s.w, l = s.w === s.a ? s.b : s.a;
  if (l == null) return;
  const x = Math.max(s.wa, s.wb), y = Math.min(s.wa, s.wb);
  const rn = roundName(br, br.cur), size = br.rounds[br.cur].length * 2;
  const p = seriesChance(expect(sideRating(save, comp, w), sideRating(save, comp, l)), br.bestOf);
  const ids = comp === 'clan' ? [] : [w, l];
  const a = sideName(save, comp, w), b = sideName(save, comp, l);
  if (rn === 'final') {
    const item = { k: 'final', p: { a, b, x, y, c: kind }, ids, big: true };
    if (comp !== 'clan') item.q = quote(save, l, 'finalLoss', { b: a });
    addNews(save, item);
  } else if (p < 0.3) {
    addNews(save, { k: 'koUpset', p: { a, b, x, y, r: rn, rn: size }, ids, q: comp !== 'clan' ? quote(save, w, 'upset', { b }) : null });
  } else addNews(save, { k: 'seriesWin', p: { a, b, x, y, r: rn, rn: size }, ids });
}

export function seasonStartNews(save, chances) {
  const c = save.season;
  const fav = Object.entries(chances.solo || {}).sort((a, b) => b[1] - a[1])[0];
  const favClan = Object.entries(chances.clan || {}).sort((a, b) => b[1] - a[1])[0];
  addNews(save, {
    k: 'seasonStart', s: c.n,
    p: { s: c.n, a: fav ? nameOf(save, fav[0]) : '—', p: fav ? Math.round(fav[1] * 100) : 0, c: favClan ? clanName(save, favClan[0]) : null, q: favClan ? Math.round(favClan[1] * 100) : 0 },
    ids: fav ? [fav[0]] : [], big: true,
  });
}

export function seasonEndNews(save, r) {
  const s = r.n;
  if (r.champ != null) addNews(save, { k: 'champ', s, p: { a: nameOf(save, r.champ), s }, ids: [r.champ], q: quote(save, r.champ, 'champ'), big: true });
  if (r.clanChamp != null) addNews(save, { k: 'clanChamp', s, p: { a: clanName(save, r.clanChamp), s }, ids: [], big: true });
  const c = save.season;
  r.divWinners.forEach((id, d) => { if (d > 0) addNews(save, { k: 'divWin', s, p: { a: nameOf(save, id), d: d + 1 }, ids: [id] }); });
  // who moves: by division they come to
  if (c && c.divs.length > 1) {
    for (let d = 0; d < c.divs.length - 1; d++) {
      const up = r.up.filter((id) => c.divs[d + 1].includes(id)), down = r.down.filter((id) => c.divs[d].includes(id));
      if (up.length) addNews(save, { k: 'up', s, p: { d: d + 1, list: up.map((id) => nameOf(save, id)).join(', ') }, ids: up, q: quote(save, up[0], 'promoted') });
      if (down.length) addNews(save, { k: 'down', s, p: { d: d + 2, list: down.map((id) => nameOf(save, id)).join(', ') }, ids: down, q: quote(save, down[0], 'relegated') });
    }
  }
  if (r.mvp != null) addNews(save, { k: 'mvp', s, p: { a: nameOf(save, r.mvp), s }, ids: [r.mvp] });
  if (r.frag != null) {
    let kills = 0;
    for (const m of c?.matches || []) if (m.res && !m.res.forfeit) kills += m.res.k[r.frag] || 0;
    addNews(save, { k: 'frag', s, p: { a: nameOf(save, r.frag), s, x: kills }, ids: [r.frag] });
  }
  if (r.star != null && r.gain > 0) addNews(save, { k: 'star', s, p: { a: nameOf(save, r.star), s, x: r.gain }, ids: [r.star] });
  if (r.born) generationNews(save, r.born);
}

export function cupStartNews(save, chances) {
  const c = save.cup;
  const list = chances[c.cfg.comp] || {};
  const fav = Object.entries(list).sort((a, b) => b[1] - a[1])[0];
  addNews(save, { k: 'cupStart', p: { s: c.n, x: c.entrants.length, a: fav ? sideName(save, c.cfg.comp, fav[0]) : '—', p: fav ? Math.round(fav[1] * 100) : 0 }, ids: [], big: true });
}

export function cupEndNews(save, r) {
  if (r.champ == null) return;
  const item = { k: 'cup', p: { a: sideName(save, r.comp, r.champ), s: r.n }, ids: r.comp === 'clan' ? [] : [r.champ], big: true };
  if (r.comp !== 'clan') item.q = quote(save, r.champ, 'champ');
  addNews(save, item);
}

// a new generation: who came, who went
export function generationNews(save, note) {
  for (const b of note.born || []) {
    addNews(save, { k: 'born', p: { a: nameOf(save, b.id), b: nameOf(save, b.from[0]), c: nameOf(save, b.from[1]), d: nameOf(save, b.replaced) }, ids: [b.id, b.replaced] });
  }
}

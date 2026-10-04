// What happens around Bot Arena's competitions: the news, the bets that
// settle and the coins of a season's end. league.js plays the competitions;
// this ties them to news.js and bets.js (page side only).

import { CompSource } from './league.js';
import { seasonEndNews, cupEndNews, seriesNews } from './news.js';
import { settleSeries, settleChamps, fantasyPay, seasonBonus } from './bets.js';

export const COMP_EVENTS = {
  series(save, kind, br, s) {
    seriesNews(save, kind, br, s);
    settleSeries(save, kind, save[kind].n, s);
  },
  seasonEnd(save, r) {
    seasonEndNews(save, r);
    settleChamps(save, 'season', r.n, 'solo', r.champ);
    settleChamps(save, 'season', r.n, 'clan', r.clanChamp);
    r.fantasyPay = save.season.fantasy.picks.length ? fantasyPay(save, r.fantasy) : 0;
    r.bonus = seasonBonus(save);
  },
  cupEnd(save, r) {
    cupEndNews(save, r);
    settleChamps(save, 'cup', r.n, r.comp, r.champ);
  },
};

export const compSource = (save, kind) => new CompSource(save, kind, COMP_EVENTS);

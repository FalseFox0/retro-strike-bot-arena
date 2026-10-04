// Gun Game: everyone starts with a pistol and climbs a fixed ladder of guns,
// going up a level after enough kills (the strong guns need more), up to the
// knife. A knife kill on the knife level wins the match. Dying without an
// enemy kill (a fall) costs a level. Played free-for-all or T vs CT (chosen
// in Create Game); there's no gun menu, no buying and nothing to pick up:
// you always have the knife and your level's gun.

import { WEAPONS, giveWeapon, giveGrenades, selectSlot } from './weapons.js';
import { t } from './i18n.js';
import { escapeHtml, weaponName } from './hud.js';

// the classic GunGame order (without the mod's HE grenade level) and the kills each gun needs
export const LADDER = [
  ['glock18', 1], ['usp', 1], ['p228', 1], ['deagle', 1], ['fiveseven', 1], ['elite', 1],
  ['m3', 2], ['xm1014', 2],
  ['tmp', 2], ['mac10', 2], ['mp5navy', 2], ['ump45', 2], ['p90', 2],
  ['galil', 3], ['famas', 3], ['ak47', 3],
  ['scout', 2],
  ['m4a1', 3], ['sg552', 3], ['aug', 3],
  ['m249', 3],
  ['knife', 1],
].map(([id, kills]) => ({ id, kills }));
export const KNIFE_LEVEL = LADDER.length - 1;

const UP_FLASH = 1.2; // how long the HUD panel lights up after going up a level

export class GunGame {
  constructor(game) {
    this.g = game;
    this.winner = null;
    this.upAt = -10;
  }

  onJoin(p) {
    p.ggLevel = 0;
    p.ggKills = 0;
  }

  // every spawn: armor and helmet, the knife and this level's gun
  loadout(p) {
    p.armor = 100;
    p.helmet = true;
    p.weapons = { 1: null, 2: null, 3: null, 4: null, 5: null };
    giveWeapon(p, 'knife');
    giveGrenades(p, {});
    const id = LADDER[p.ggLevel].id;
    if (id !== 'knife') giveWeapon(p, id);
    p.slot = WEAPONS[id].slot;
    p.lastSlot = 3;
  }

  // swap to the gun of the level we're on now (when it isn't already in hand)
  arm(p) {
    if (!p.alive || this.g.over) return;
    const id = LADDER[p.ggLevel].id;
    const gun = p.weapons[1] || p.weapons[2];
    if (gun ? gun.id === id : id === 'knife') return;
    p.weapons[1] = p.weapons[2] = null;
    if (id !== 'knife') giveWeapon(p, id);
    p.slot = 0;
    selectSlot(this.g, p, WEAPONS[id].slot);
    p.lastSlot = 3;
  }

  onKill(attacker, victim, weaponId) {
    const g = this.g;
    if (!attacker || attacker === victim) {
      // a fall (or anything else that wasn't an enemy): one level down
      if (victim.ggLevel > 0) {
        victim.ggLevel--;
        if (victim === g.human) g.hud.message(t('ggLevelDown', { n: victim.ggLevel + 1, gun: weaponName(LADDER[victim.ggLevel].id) }), g.time, 4);
      }
      victim.ggKills = 0;
      return;
    }
    if (!g.isEnemy(attacker, victim)) return;
    if (attacker.ggLevel === KNIFE_LEVEL) {
      if (weaponId === 'knife') this.win(attacker);
      return;
    }
    attacker.ggKills++;
    if (attacker.ggKills >= LADDER[attacker.ggLevel].kills) this.levelUp(attacker);
  }

  levelUp(p) {
    const g = this.g;
    p.ggLevel++;
    p.ggKills = 0;
    // the new gun comes next tick, after the shot that earned it is done
    g.later(0, () => this.arm(p));
    if (p === g.human) {
      this.upAt = g.time;
      g.sound('levelup', p, 0.6);
      if (p.ggLevel === KNIFE_LEVEL) g.hud.subPrint(t('ggKnifeLevel'), g.time, 3);
    }
  }

  win(p) {
    this.winner = p;
    this.g.endMatch();
  }

  matchTitle() {
    const p = this.winner;
    if (!p) return t('draw');
    return p.team ? t('ggWinsTeam', { name: p.name, team: t(p.team === 'T' ? 'teamT' : 'teamCT') }) : t('playerWins', { name: p.name });
  }

  // top of the screen: our level, gun and kills, and the gun after it
  hudHtml(p) {
    const lv = LADDER[p.ggLevel];
    const next = LADDER[p.ggLevel + 1];
    const up = this.g.time - this.upAt < UP_FLASH ? ' up' : '';
    const kills = p.ggLevel === KNIFE_LEVEL ? t('ggKnifeWins') : t('ggKills', { n: p.ggKills, of: lv.kills });
    const nextLine = next ? t('ggNext', { gun: escapeHtml(weaponName(next.id)) }) : t('ggLastLevel');
    return `<div class="tc-gg${up}"><div class="gg-main"><span class="gg-lv">${t('ggLevel', { n: p.ggLevel + 1, of: LADDER.length })}</span>`
      + `<span class="tc-sep">·</span><span class="gg-gun">${escapeHtml(weaponName(lv.id))}</span>`
      + `<span class="tc-sep">·</span><span class="gg-k">${kills}</span></div><div class="gg-next">${nextLine}</div></div>`;
  }

  // scoreboard cell: level number and gun
  boardCell(p) {
    return `${p.ggLevel + 1} <span class="sb-gun">${escapeHtml(weaponName(LADDER[p.ggLevel].id))}</span>`;
  }

  // highest level first, then whoever is closer to the next one
  static sort(a, b) {
    return b.ggLevel - a.ggLevel || b.ggKills - a.ggKills || b.score - a.score || a.deaths - b.deaths;
  }
}

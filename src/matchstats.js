// Bot Arena: what each player did in one match, for the save's stats,
// ratings and the skills that grow by use. The game calls in as things
// happen (only in Bot Arena matches; game.stats is null otherwise).

const blank = () => ({
  k: 0, de: 0, hs: 0, sh: 0, hi: 0, dmg: 0, rp: 0, rw: 0, pl: 0, df: 0, nd: 0, hk: 0, tk: 0, su: 0,
  eng: 0,   // fights started (saw an enemy): practises reaction
  spray: 0, // bullets fired three or more in a row: practises recoil control
  wk: {},   // kills per gun
});

export class MatchStats {
  constructor(game) {
    this.g = game;
    this.rec = new Map();
  }

  of(p) {
    let r = this.rec.get(p);
    if (!r) this.rec.set(p, (r = blank()));
    return r;
  }

  add(p, field, n = 1) {
    if (p) this.of(p)[field] += n;
  }

  engage(p) {
    this.add(p, 'eng');
  }

  // damage to an enemy (only what it really took off); bullets count as hits
  hit(attacker, victim, dmg, bullet) {
    if (!attacker || attacker === victim || !this.g.isEnemy(attacker, victim)) return;
    const r = this.of(attacker);
    r.dmg += dmg;
    if (bullet) r.hi++;
  }

  kill(attacker, victim, weaponId, headshot, hack) {
    this.of(victim).de++;
    if (!attacker || attacker === victim) {
      if (weaponId !== 'c4') this.of(victim).su++;
      return;
    }
    const r = this.of(attacker);
    if (!this.g.isEnemy(attacker, victim)) {
      r.tk++;
      return;
    }
    r.k++;
    if (headshot) r.hs++;
    if (hack) r.hk++;
    r.wk[weaponId] = (r.wk[weaponId] || 0) + 1;
  }

  // a round is over: everyone on a side played it, the winners won it
  round(winner) {
    for (const p of this.g.players) {
      if (!p.team) continue;
      const r = this.of(p);
      r.rp++;
      if (p.team === winner) r.rw++;
    }
  }
}

// Bomb defusal, following CS 1.6: money and the buy menu, the C4 (plant,
// beep, defuse, explode) and the round rewards. Bought guns come with full
// ammo (there is no ammo to buy). Guns on the ground are in items.js.
// The bots' team plans live here too: how each team buys, where the
// Terrorists gather and hit, and how the Counter-Terrorists hold, rotate
// and retake (bot.js carries them out).

import * as THREE from '../lib/three.module.js';
import { WEAPONS, canUse, forTeam, makeWeapon, selectSlot, deploy, BOT_PRIMARY, weighted, refillAmmo } from './weapons.js';
import { thirdPersonWeapon } from './models.js';
import { dirFromAngles } from './player.js';
import { t } from './i18n.js';
import { weaponName } from './hud.js';

export const MONEY = {
  start: 800, max: 16000, kill: 300,
  winElim: 3250, winBomb: 3500, winDefuse: 3500, winTime: 3250,
  loss: 1400, lossAdd: 500, lossMax: 3400, plantBonus: 800,
};
export const BUY_TIME = 90;
export const BOMB_ROUND_TIME = 105;
const C4_TIMER = 35;
// a full buy: rifle and armor (and a kit for Counter-Terrorists)
const FULL_BUY = { T: 3700, CT: 4300 };
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const DEFUSE_TIME = 10;
const DEFUSE_TIME_KIT = 5;
export const EQUIP = { vest: 650, vesthelm: 1000, defuser: 200 };
const HELMET_ONLY = 350;
const C4_DEF = { id: 'c4', armorRatio: 1 };

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

export const priceOf = (id) => EQUIP[id] ?? WEAPONS[id]?.price ?? 0;

export class BombMode {
  constructor(game) {
    this.g = game;
    this.bomb = null;
    this.planted = false;
    this.lossStreak = { T: 0, CT: 0 };
    this.roundStartTime = 0;
    // the planted bomb's blinking light
    this.led = new THREE.Sprite(new THREE.SpriteMaterial({ map: game.textures.flash, color: 0xff2a10, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.led.scale.set(10, 10, 1);
    this.led.visible = false;
    game.scene.add(this.led);
    this.ledUntil = 0;
  }

  dispose() {
    this.removeBomb();
    this.g.scene.remove(this.led);
    this.led.material.dispose();
  }

  // ---------- money ----------
  addMoney(p, amount) {
    const before = p.money;
    p.money = Math.max(0, Math.min(MONEY.max, p.money + amount));
    if (p.money !== before) this.g.tell(p, 'money', p.money - before);
  }

  onJoin(p) {
    p.money = this.g.cfg.startMoney || MONEY.start;
    p.defuser = false;
  }

  onKill(attacker, victim) {
    if (attacker && attacker !== victim && this.g.isEnemy(attacker, victim)) this.addMoney(attacker, MONEY.kill);
  }

  // the round is over: pay everyone (1.6 amounts, loss bonus grows with a losing streak)
  rewards(winner, reason) {
    const players = this.g.players;
    if (!winner) {
      for (const p of players) if (p.team) this.addMoney(p, MONEY.loss);
      return;
    }
    const loser = winner === 'T' ? 'CT' : 'T';
    const win = reason === 'bombed' ? MONEY.winBomb : reason === 'defused' ? MONEY.winDefuse : reason === 'saved' ? MONEY.winTime : MONEY.winElim;
    this.lossStreak[winner] = 0;
    this.lossStreak[loser]++;
    const bonus = Math.min(MONEY.lossMax, MONEY.loss + MONEY.lossAdd * (this.lossStreak[loser] - 1));
    for (const p of players) {
      if (p.team === winner) this.addMoney(p, win);
      else if (p.team === loser) this.addMoney(p, bonus + (loser === 'T' && this.planted ? MONEY.plantBonus : 0));
    }
  }

  // ---------- rounds ----------
  // before everyone respawns for a new round
  roundStart() {
    this.removeBomb();
    this.planted = false;
    this.roundStartTime = this.g.time;
    for (const p of this.g.players) {
      if (p.buys.length) p.lastBuys = p.buys;
      p.buys = [];
      p.defusing = false;
    }
  }

  // what a player has at the start of a round: survivors keep their gear
  loadout(p, keep) {
    if (!keep) {
      p.weapons = { 1: null, 2: null, 3: null, 4: null, 5: null };
      p.nades = {};
      p.weapons[3] = makeWeapon('knife');
      p.weapons[2] = makeWeapon(p.team === 'T' ? 'glock18' : 'usp');
      p.armor = 0;
      p.helmet = false;
      p.defuser = false;
    } else {
      // guns come with full ammo, so a new round fills them up again
      refillAmmo(p);
    }
    // the best gun in hand (survivors may have dropped their pistol)
    p.slot = p.weapons[1] ? 1 : p.weapons[2] ? 2 : 3;
    p.lastSlot = p.slot === 1 && p.weapons[2] ? 2 : 3;
  }

  // after everyone has spawned: a random Terrorist gets the bomb, bots go shopping
  afterSpawn() {
    const g = this.g;
    const ts = g.players.filter((p) => p.alive && p.team === 'T');
    if (ts.length) this.giveBomb(ts[(Math.random() * ts.length) | 0]);
    // each team buys together: a full buy, a forced buy or saving
    this.buyPlan = { T: this.teamBuy('T'), CT: this.teamBuy('CT') };
    for (const p of g.players) if (p.isBot && p.alive) this.botBuy(p, this.buyPlan[p.team]);
    for (const team of ['T', 'CT']) this.dropGuns(team);
    this.planRound();
  }

  // ---------- the bots' plans ----------
  // Per bomb site, worked out once per map from the nav paths out of each
  // spawn: where that team's way in reaches the site (entry) and a spot some
  // way back along it to gather at before going in (stage).
  routes() {
    const map = this.g.map;
    if (map.bombRoutes) return map.bombRoutes;
    const routes = new Map();
    for (const site of map.bombsites || []) {
      const c = { x: (site.min[0] + site.max[0]) / 2, y: site.min[1] + 30, z: (site.min[2] + site.max[2]) / 2 };
      const inside = (q, m) => q.x > site.min[0] - m && q.x < site.max[0] + m && q.z > site.min[2] - m && q.z < site.max[2] + m &&
        q.y > site.min[1] - 40 && q.y < site.max[1];
      const r = { center: c };
      for (const team of ['T', 'CT']) {
        const sp = map.spawns[team];
        const ax = sp.reduce((s, q) => s + q.x, 0) / sp.length, az = sp.reduce((s, q) => s + q.z, 0) / sp.length;
        const path = map.nav.findPath(ax, sp[0].y || 0, az, c.x, c.y, c.z);
        if (!path || path.length < 2) continue;
        let e = path.findIndex((q) => inside(q, 72));
        if (e < 0) e = path.length - 1;
        let k = e, d = 0;
        const back = team === 'T' ? 560 : 420;
        while (k > 0 && d < back) {
          d += flat(path[k], path[k - 1]);
          k--;
        }
        const pt = (q) => new THREE.Vector3(q.x, q.y, q.z);
        r[team] = { entry: pt(path[e]), stage: pt(path[k]) };
      }
      routes.set(site, r);
    }
    map.bombRoutes = routes;
    return routes;
  }

  // which site the Terrorists hit and how, who holds which site
  planRound() {
    const g = this.g;
    const sites = g.map.bombsites || [];
    this.plan = sites[(Math.random() * sites.length) | 0];
    const rt = this.plan && this.routes().get(this.plan);
    // most rounds the Terrorists gather outside the site and go in together; now and then a straight rush
    // (they wait out there a while first, unless they lose people or run short of time)
    this.tPlan = { site: this.plan, phase: rt && rt.T && Math.random() > 0.2 ? 'gather' : 'execute', goAt: 0, waitUntil: 12 + Math.random() * 16 };
    this.alert = null;
    this.retake = null;
    this.liveAt = this.roundStartTime + g.freezeTime;
    const bots = g.players.filter((p) => p.brain && p.alive);
    // one Terrorist sometimes lurks at the other site
    const tBots = bots.filter((p) => p.team === 'T');
    // (a Bot Arena lurker always does; plain bots sometimes send one)
    for (const p of tBots) p.brain.lurk = p.brain.d.style === 'lurker' && sites.length > 1 && tBots.length >= 2;
    if (!tBots.some((p) => p.brain.d.style) && tBots.length >= 3 && sites.length > 1 && Math.random() < 0.4) tBots[(Math.random() * tBots.length) | 0].brain.lurk = true;
    // Counter-Terrorists split over the sites; the first on each one stays put when the others rotate
    let k = (Math.random() * 2) | 0;
    const anchored = new Set();
    for (const p of bots.filter((o) => o.team === 'CT')) {
      p.brain.siteIndex = k++;
      const site = sites[p.brain.siteIndex % Math.max(1, sites.length)];
      p.brain.anchor = !anchored.has(site);
      anchored.add(site);
    }
  }

  siteRoute(site, team) {
    const r = site && this.routes().get(site);
    return r ? r[team] : null;
  }

  siteCenter(site) {
    return this.routes().get(site).center;
  }

  // the bomb site nearest a point (within reach)
  siteNear(pos, reach) {
    let best = null, bd = reach;
    for (const s of this.g.map.bombsites || []) {
      const d = flat(this.siteCenter(s), pos);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // a Counter-Terrorist saw Terrorists (or went down) near a site: the others
  // may rotate there
  ctAlert(pos) {
    const g = this.g;
    if (g.round.state !== 'live' || this.planted) return;
    const site = this.siteNear(pos, 1300);
    if (!site) return;
    // a call stands for a while: no flipping back and forth
    if (this.alert && g.time - this.alert.at < (this.alert.site === site ? 12 : 10)) return;
    this.alert = { site, at: g.time };
  }

  // are any Counter-Terrorists still holding this site?
  ctHolding(site) {
    const c = this.siteCenter(site);
    return this.g.players.some((p) => p.alive && p.team === 'CT' && flat(p.pos, c) < 650);
  }

  // the Terrorists gathered (or ran out of time): smoke the Counter-Terrorists'
  // way in, flash the site, then everyone goes
  execute() {
    const g = this.g, tp = this.tPlan;
    const ct = this.siteRoute(tp.site, 'CT'), T = this.siteRoute(tp.site, 'T');
    const center = this.siteCenter(tp.site);
    const ts = g.players.filter((p) => p.brain && p.alive && p.team === 'T' && !p.brain.lurk && T && flat(p.pos, T.stage) < 600);
    let thrown = 0, smoked = false;
    for (const p of ts) {
      if (!smoked && ct && p.nades.smokegrenade && p.brain.wantNade('smokegrenade', ct.entry)) { smoked = true; thrown++; continue; }
      if (thrown < 3 && p.nades.flashbang && p.brain.wantNade('flashbang', new THREE.Vector3(center.x, center.y + 70, center.z))) thrown++;
    }
    tp.phase = thrown ? 'nades' : 'execute';
    tp.goAt = g.time + (thrown ? 2.1 : 0);
    const lead = ts.find((p) => !p.brain.nade) || ts[0];
    if (lead) g.radio.say(lead, 'goGoGo');
  }

  // twice a second: move the team plans along
  botPlans() {
    const g = this.g, tp = this.tPlan;
    if (!tp || g.round.state !== 'live') return;
    if (tp.phase === 'gather') {
      const T = this.siteRoute(tp.site, 'T');
      const ts = g.players.filter((p) => p.brain && p.alive && p.team === 'T' && !p.brain.lurk);
      const there = ts.filter((p) => flat(p.pos, T.stage) < 380).length;
      const lost = g.players.filter((p) => p.team === 'T' && !p.alive).length;
      const since = g.time - this.liveAt;
      if (!ts.length || (there >= Math.ceil(ts.length * 0.7) && since > tp.waitUntil) || since > 40 || g.round.endsAt - g.time < 50 || lost >= 2) this.execute();
    } else if (tp.phase === 'nades' && g.time >= tp.goAt) tp.phase = 'execute';
    const rt = this.retake, b = this.bomb;
    if (rt && b && b.state === 'planted') {
      const cts = g.players.filter((p) => p.brain && p.alive && p.team === 'CT');
      const left = b.blowAt - g.time;
      const kit = cts.some((p) => p.defuser);
      if (rt.phase === 'gather') {
        const there = rt.stage ? cts.filter((p) => flat(p.pos, rt.stage) < 380 || flat(p.pos, b.pos) < 500).length : cts.length;
        if (there >= Math.min(2, cts.length) || left < (kit ? 5 : 10) + 14 || g.time - rt.at > 12) {
          // a flash or two into the site, then in
          let thrown = 0;
          for (const p of cts) {
            if (thrown < 2 && p.nades.flashbang && flat(p.pos, b.pos) > 350 && p.brain.wantNade('flashbang', new THREE.Vector3(b.pos.x, b.pos.y + 80, b.pos.z))) thrown++;
          }
          rt.phase = thrown ? 'nades' : 'go';
          rt.goAt = g.time + (thrown ? 2 : 0);
          const lead = cts.find((p) => !p.brain.nade);
          if (lead) g.radio.say(lead, 'goGoGo');
        }
      } else if (rt.phase === 'nades' && g.time >= rt.goAt) rt.phase = 'go';
      // one goes for the bomb (a kit first), the others cover them
      if (rt.phase === 'go' && (!rt.defuser || !rt.defuser.alive)) {
        let best = null, bd = Infinity;
        for (const p of cts) {
          const d = flat(p.pos, b.pos) * (p.defuser ? 0.6 : 1);
          if (d < bd) { bd = d; best = p; }
        }
        rt.defuser = best;
      }
    }
  }

  // ---------- money: the team's buy ----------
  // Everyone buys together or saves together: a full buy when most can afford
  // rifle and armor, otherwise save for next round, unless saving won't help
  // or the other team is one round from winning (then spend everything).
  teamBuy(team) {
    const g = this.g;
    const ms = g.players.filter((p) => p.team === team);
    if (!ms.length) return 'eco';
    if (g.round.n === 1) return 'pistol';
    const full = FULL_BUY[team];
    const ready = ms.filter((p) => p.weapons[1] || p.money >= full).length;
    if (ready >= ms.length * 0.6) return 'full';
    const other = team === 'T' ? 'CT' : 'T';
    if (g.teamScore[other] >= g.cfg.roundsToWin - 1) return 'force';
    const bonus = Math.min(MONEY.lossMax, MONEY.loss + MONEY.lossAdd * this.lossStreak[team]);
    const nextReady = ms.filter((p) => p.weapons[1] || p.money + bonus >= full).length;
    if (nextReady >= ms.length * 0.6) return 'eco';
    const avg = ms.reduce((s, p) => s + p.money, 0) / ms.length;
    return avg >= 2000 ? 'force' : 'eco';
  }

  // full buys: bots with money to spare buy a rifle for a teammate who can't
  // afford one (the bot that gets it picks it up, you get a message)
  dropGuns(team) {
    const g = this.g;
    if (this.buyPlan[team] !== 'full') return;
    const poor = g.players.filter((p) => p.alive && p.team === team && !p.weapons[1] && p.money < FULL_BUY[team]);
    const rich = g.players.filter((p) => p.isBot && p.alive && p.team === team && p.weapons[1] && p.brain.d.teamwork >= 0.3).sort((a, b) => b.money - a.money);
    const rifle = team === 'T' ? 'ak47' : 'm4a1';
    for (const p of poor.slice(0, 2)) {
      const giver = rich.find((r) => r.money >= priceOf(rifle) + 1200 && !r.gave);
      if (!giver) return;
      giver.gave = true;
      // the giver's own rifle goes on the ground (pointed at them), a new one goes in its hands
      const own = giver.weapons[1];
      const dx = p.pos.x - giver.pos.x, dz = p.pos.z - giver.pos.z;
      giver.yaw = Math.atan2(-dx, -dz);
      const it = g.items.drop(giver, 1, Math.hypot(dx, dz) > 60);
      if (!it) continue;
      it.giftFor = p;
      this.buy(giver, rifle, true);
      g.tell(p, 'msg', ['gunDroppedForYou', { name: giver.name, gun: weaponName(own.id) }], 6);
    }
    for (const r of rich) r.gave = false;
  }

  giveBomb(p) {
    p.weapons[5] = makeWeapon('c4');
    this.removeBomb();
    this.bomb = { state: 'carried', carrier: p };
    this.g.tell(p, 'msg', 'youHaveBomb', 8);
  }

  carrier() {
    return this.bomb && this.bomb.state === 'carried' ? this.bomb.carrier : null;
  }

  // ---------- where things are ----------
  siteAt(pos) {
    for (const s of this.g.map.bombsites || []) {
      if (pos.x >= s.min[0] && pos.x <= s.max[0] && pos.y >= s.min[1] && pos.y <= s.max[1] && pos.z >= s.min[2] && pos.z <= s.max[2]) return s;
    }
    return null;
  }

  inBuyZone(p) {
    const zones = this.g.map.buyzones && this.g.map.buyzones[p.team];
    if (!zones) return false;
    const q = p.pos;
    return zones.some((z) => q.x >= z.min[0] && q.x <= z.max[0] && q.y >= z.min[1] && q.y <= z.max[1] && q.z >= z.min[2] && q.z <= z.max[2]);
  }

  buyTimeLeft() {
    return BUY_TIME - (this.g.time - this.roundStartTime);
  }

  // null when buying is fine, otherwise the message to show
  buyBlocked(p) {
    if (!p.alive || !p.team) return 'notInBuyZone';
    if (this.buyTimeLeft() <= 0) return 'buyTimeOver';
    if (!this.inBuyZone(p)) return 'notInBuyZone';
    return null;
  }

  canBuyNow(p) {
    return !this.buyBlocked(p);
  }

  // ---------- buying ----------
  // returns true if something was bought; messages only for the human
  buy(p, id, quiet = false) {
    const g = this.g;
    const say = (key, vars) => { if (!quiet) g.tell(p, 'msg', [key, vars], 4); };
    const blocked = this.buyBlocked(p);
    if (blocked) {
      say(blocked, { n: BUY_TIME });
      return false;
    }
    let price = priceOf(id);
    const def = WEAPONS[id];
    if (id === 'vest') {
      if (p.armor >= 100) { say('alreadyHave'); return false; }
    } else if (id === 'vesthelm') {
      if (p.armor >= 100 && p.helmet) { say('alreadyHave'); return false; }
      if (p.armor >= 100) price = HELMET_ONLY;
      else if (p.helmet) price = EQUIP.vest;
    } else if (id === 'defuser') {
      if (p.team !== 'CT') { say('ctOnlyItem'); return false; }
      if (p.defuser) { say('alreadyHave'); return false; }
    } else if (!def || !canUse(id, p.team)) {
      return false;
    } else if (def.type === 'grenade') {
      if ((p.nades[id] || 0) >= def.max) { say('cannotCarry'); return false; }
    }
    if (p.money < price) {
      say('notEnoughMoney');
      return false;
    }
    this.addMoney(p, -price);
    p.buys.push(id);
    if (id === 'vest') p.armor = 100;
    else if (id === 'vesthelm') { p.armor = 100; p.helmet = true; }
    else if (id === 'defuser') p.defuser = true;
    else if (def.type === 'grenade') {
      p.nades[id] = (p.nades[id] || 0) + 1;
      if (!p.weapons[4]) {
        p.weapons[4] = makeWeapon(id);
        p.weapons[4].clip = p.nades[id];
      } else if (p.weapons[4].id === id) p.weapons[4].clip = p.nades[id];
    } else {
      // a new gun replaces the one in that slot (the old one is dropped)
      if (p.weapons[def.slot]) g.items.drop(p, def.slot, false);
      p.weapons[def.slot] = makeWeapon(id);
      if (def.slot === 1 || p.slot !== 1) {
        p.slot = 0;
        selectSlot(g, p, def.slot);
      }
    }
    g.tell(p, 'sound', 'buy', { volume: 0.6 });
    return true;
  }

  // F1: the 1.6 default autobuy list
  autobuy(p) {
    const blocked = this.buyBlocked(p);
    if (blocked) {
      this.g.tell(p, 'msg', [blocked, { n: BUY_TIME }], 4);
      return;
    }
    if (!p.weapons[1]) {
      for (const id of ['m4a1', 'ak47', 'famas', 'galil', 'p90', 'mp5navy']) {
        if (canUse(id, p.team) && p.money >= priceOf(id)) {
          this.buy(p, id, true);
          break;
        }
      }
    }
    if (p.team === 'CT' && !p.defuser && p.money >= EQUIP.defuser) this.buy(p, 'defuser', true);
    if (!(p.armor >= 100 && p.helmet) && !this.buy(p, 'vesthelm', true) && p.armor < 100) this.buy(p, 'vest', true);
  }

  // F2: buy again what you bought last round
  rebuy(p) {
    const blocked = this.buyBlocked(p);
    if (blocked) {
      this.g.tell(p, 'msg', [blocked, { n: BUY_TIME }], 4);
      return;
    }
    for (const id of p.lastBuys) {
      const def = WEAPONS[id];
      if (def && def.type !== 'grenade' && p.weapons[def.slot] && p.weapons[def.slot].id === id) continue;
      this.buy(p, id, true);
    }
  }

  // Bots shop like players, following the team's plan: a full buy, a forced
  // buy (the best they can afford), or saving; pistols and armor on the
  // first round. Every full buy brings grenades, and the team makes sure of
  // a smoke and some flashes (Terrorists) or two defuse kits.
  botBuy(p, plan = 'full') {
    const g = this.g;
    const mates = g.players.filter((o) => o.team === p.team && o.alive);
    const r = Math.random();
    // a Bot Arena character: its favorite guns, and its taste for grenades
    const ch = p.char;
    const nk = p.brain ? p.brain.nadeK : 1;
    const chance = (x) => Math.random() < Math.min(1, x * nk);
    const nades = () => {
      const has = (id) => mates.some((o) => o.nades[id] > 0);
      if (p.money > 600 && (!has('smokegrenade') || chance(0.3)) && nk > 0.2) this.buy(p, 'smokegrenade', true);
      if (p.money > 500 && chance(0.75)) this.buy(p, 'flashbang', true);
      if (p.money > 600 && chance(0.6)) this.buy(p, 'hegrenade', true);
      if (p.money > 1500 && chance(0.3)) this.buy(p, 'flashbang', true);
    };
    if (ch) {
      this.charBuy(p, plan, ch, nades);
      return;
    }
    const kit = () => {
      const kits = mates.filter((o) => o.defuser).length;
      if (p.team === 'CT' && !p.defuser && (kits < 2 || Math.random() < 0.4)) this.buy(p, 'defuser', true);
    };
    const armor = () => {
      if (!this.buy(p, 'vesthelm', true) && p.armor < 100) this.buy(p, 'vest', true);
    };
    if (plan === 'pistol' && !p.weapons[1]) {
      // pistol round
      if (r < 0.45) this.buy(p, 'vest', true);
      else if (r < 0.7) this.buy(p, 'deagle', true);
      else if (r < 0.85) { this.buy(p, p.team === 'T' ? 'p228' : 'fiveseven', true); this.buy(p, 'flashbang', true); }
      else { this.buy(p, 'hegrenade', true); this.buy(p, 'flashbang', true); }
      if (p.team === 'CT' && Math.random() < 0.3) this.buy(p, 'defuser', true);
      return;
    }
    if (p.weapons[1]) {
      // survived with a gun: top up
      armor();
      if (plan !== 'eco') nades();
      kit();
      return;
    }
    const m = p.money;
    if (plan === 'full' && m >= 2700) {
      // full buy: what players buy, AWP only with money to spare
      let id = null;
      for (let i = 0; i < 6 && !id; i++) {
        const pick = weighted(BOT_PRIMARY, p.team);
        if (priceOf(pick) + 1000 <= m && (pick !== 'awp' || m >= 5950)) id = pick;
      }
      if (!id) id = p.team === 'T' ? (m >= 3500 ? 'ak47' : 'galil') : (m >= 4100 ? 'm4a1' : 'famas');
      this.buy(p, id, true);
      armor();
      kit();
      nades();
    } else if (plan === 'force' || plan === 'full') {
      // forced: the best gun that still leaves money for a vest
      const list = p.team === 'T' ? ['ak47', 'galil', 'mp5navy', 'mac10', 'm3'] : ['m4a1', 'famas', 'mp5navy', 'tmp', 'm3'];
      const id = list.find((g2) => priceOf(g2) + 650 <= m) || list.find((g2) => priceOf(g2) <= m);
      if (id) this.buy(p, id, true);
      else if (m >= 650) this.buy(p, 'deagle', true);
      if (p.money >= 650) this.buy(p, 'vest', true);
      if (p.money >= 200 && Math.random() < 0.5) this.buy(p, 'flashbang', true);
    }
    // eco: save it all for next round
  }

  // How a Bot Arena character shops: its favorite gun when the team buys and
  // it can afford it (with armor), else the best it can get; pistol players
  // buy their pistol, armor and plenty of grenades.
  charBuy(p, plan, ch, nades) {
    const team = p.team;
    const fav = ch.gun === 'none' ? null : forTeam(ch.gun, team);
    const pistol = forTeam(ch.pistol, team);
    const kit = () => {
      if (team === 'CT' && !p.defuser && (p.brain.d.teamwork > 0.5 || Math.random() < 0.3)) this.buy(p, 'defuser', true);
    };
    const armor = () => {
      if (!this.buy(p, 'vesthelm', true) && p.armor < 100) this.buy(p, 'vest', true);
    };
    const myPistol = () => {
      const w = p.weapons[2];
      if ((!w || w.id !== pistol) && priceOf(pistol) <= p.money) this.buy(p, pistol, true);
    };
    if (plan === 'pistol' && !p.weapons[1]) {
      if (pistol !== (team === 'T' ? 'glock18' : 'usp') && priceOf(pistol) + 350 <= p.money) myPistol();
      else this.buy(p, 'vest', true);
      if (p.money >= 300) nades();
      return;
    }
    if (p.weapons[1] || (!fav && plan !== 'eco')) {
      // kept a gun (or plays the pistol anyway): top up
      if (!fav) myPistol();
      armor();
      if (plan !== 'eco' || !fav) nades();
      kit();
      return;
    }
    const m = p.money;
    if (plan === 'full' && fav && priceOf(fav) + 1000 <= m) {
      this.buy(p, fav, true);
      armor();
      kit();
      nades();
    } else if (plan === 'force' || plan === 'full') {
      const list = team === 'T' ? ['ak47', 'galil', 'mp5navy', 'mac10', 'm3'] : ['m4a1', 'famas', 'mp5navy', 'tmp', 'm3'];
      const id = (fav && priceOf(fav) + 650 <= m && fav) || list.find((g2) => priceOf(g2) + 650 <= m) || list.find((g2) => priceOf(g2) <= m);
      if (id) this.buy(p, id, true);
      else if (m >= 650) myPistol();
      if (p.money >= 650) this.buy(p, 'vest', true);
      if (p.money >= 200) nades();
    }
  }

  removeBomb() {
    const b = this.bomb;
    if (b && b.mesh) this.g.scene.remove(b.mesh);
    if (b && b.item) this.g.items.remove(b.item);
    this.led.visible = false;
    this.bomb = null;
  }

  // the bomb hit the ground (items.js made the item)
  onBombDropped(it) {
    const g = this.g;
    this.bomb = { state: 'dropped', carrier: null, item: it };
    for (const p of g.players) if (p.team === 'T') g.tell(p, 'msg', 'bombDroppedMsg', 4);
  }

  // picking up the bomb (Terrorists) or a defuse kit (Counter-Terrorists)
  pickupSpecial(p, it) {
    const g = this.g;
    if (it.kind === 'bomb') {
      if (p.team !== 'T') return false;
      this.bomb = null; // the item goes away in items.js
      this.giveBomb(p);
      for (const o of g.players) if (o.team === 'T' && o !== p) g.tell(o, 'msg', ['bombPickedUp', { name: p.name }], 4);
      return true;
    }
    if (p.team !== 'CT' || p.defuser) return false;
    p.defuser = true;
    return true;
  }

  // the dead drop the bomb and their defuse kit (their gun: items.js)
  onDeath(p) {
    const g = this.g;
    // a Counter-Terrorist going down near a site tells the others where the fight is
    if (p.team === 'CT' && g.round.state === 'live') this.ctAlert(p.pos);
    const b = this.bomb;
    if (b && b.state === 'planted' && b.defuser === p) this.stopDefuse();
    p.defusing = false;
    if (p.weapons[5]) g.items.drop(p, 5, false);
    if (p.defuser) {
      p.defuser = false;
      g.items.make('kit', 'defuser', null, v2.set(p.pos.x + 8, p.pos.y + 20, p.pos.z), new THREE.Vector3(0, 0, 0), p);
    }
  }

  // ---------- the bomb ----------
  c4Tick(p, w, cmd) {
    const g = this.g, now = g.time;
    if (w.arming) {
      // let go, jump off or leave the site: start over
      if (!cmd.attack || !p.onGround || !this.siteAt(p.pos) || g.round.state !== 'live') {
        this.stopArming(p, w);
        return;
      }
      p.vel.x = p.vel.z = 0;
      if (now >= w.armStart + w.def.plantTime) this.plant(p, w);
      return;
    }
    if (!cmd.attack || now < w.nextAttack || g.round.state !== 'live') return;
    if (!this.siteAt(p.pos)) {
      g.weaponMessage(p, 'plantAtSite');
      w.nextAttack = now + 1;
      return;
    }
    if (!p.onGround) {
      g.weaponMessage(p, 'plantOnGround');
      w.nextAttack = now + 1;
      return;
    }
    w.arming = true;
    w.armStart = now;
    g.weaponEvent(p, 'plant', w.def.plantTime);
    // the code goes in, key by key
    for (let i = 0; i < 7; i++) g.sound('c4_key', p, 0.5, 0.35 + i * 0.32 + Math.random() * 0.05);
  }

  stopArming(p, w) {
    w.arming = false;
    w.nextAttack = this.g.time + 0.5;
    this.g.weaponEvent(p, 'plant_stop');
  }

  plant(p, w) {
    const g = this.g;
    w.arming = false;
    p.weapons[5] = null;
    const site = this.siteAt(p.pos);
    // back to a gun
    const next = p.weapons[p.lastSlot] && p.lastSlot !== 5 ? p.lastSlot : [1, 2, 3].find((s) => p.weapons[s]);
    p.slot = next;
    p.lastSlot = 3;
    deploy(g, p);
    const pos = new THREE.Vector3(p.pos.x, p.pos.y + 1, p.pos.z);
    const mesh = new THREE.Mesh(thirdPersonWeapon('c4', g.textures).plain, g.items.mat);
    mesh.position.copy(pos);
    mesh.position.y += 0.8;
    mesh.rotation.y = p.yaw;
    g.scene.add(mesh);
    this.bomb = {
      state: 'planted', carrier: null, pos, mesh, site, planter: p,
      plantedAt: g.time, blowAt: g.time + C4_TIMER, nextBeep: g.time + 1, defuser: null, defuseEnd: 0,
    };
    this.planted = true;
    g.recorder?.c4(pos, p.yaw);
    if (g.stats) g.stats.add(p, 'pl');
    g.soundAt('c4_plant', pos, 0.8, 150);
    g.announce('bombPlanted', 'Bomb has been planted.');
    // the Counter-Terrorists gather outside the site and retake it together
    const route = this.siteRoute(site, 'CT');
    this.retake = { site, stage: route ? route.stage : null, phase: 'gather', at: g.time, goAt: 0, defuser: null };
    for (const b of g.players) if (b.brain && b.alive) b.brain.onBombPlanted(this.bomb);
  }

  // E near the planted bomb as a CT
  tryDefuse(p) {
    const b = this.bomb, g = this.g;
    if (!b || b.state !== 'planted' || p.team !== 'CT' || b.defuser) return false;
    const eye = g.eye(p, v1);
    const dx = b.pos.x - eye.x, dy = b.pos.y - eye.y, dz = b.pos.z - eye.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > 80) return false;
    // aimed at it (or standing right over it)
    const fwd = dirFromAngles(p.yaw, p.pitch, v2);
    if (Math.hypot(dx, dz) > 40 && (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d < 0.7) return false;
    b.defuser = p;
    b.defuseStart = g.time;
    b.defuseEnd = g.time + (p.defuser ? DEFUSE_TIME_KIT : DEFUSE_TIME);
    b.defusePos = p.pos.clone();
    p.defusing = true;
    g.sound('c4_disarm', p, 0.7);
    g.tell(p, 'msg', p.defuser ? 'defusingKit' : 'defusing', 3);
    return true;
  }

  stopDefuse() {
    const b = this.bomb;
    if (!b || !b.defuser) return;
    b.defuser.defusing = false;
    b.defuser = null;
  }

  defused() {
    const g = this.g, b = this.bomb;
    const p = b.defuser;
    b.state = 'defused';
    g.recorder?.c4off(p, b.blowAt - g.time);
    p.defusing = false;
    b.defuser = null;
    this.led.visible = false;
    g.soundAt('c4_defused', b.pos, 0.9, 200);
    p.score += 3;
    if (g.stats) g.stats.add(p, 'df');
    g.announce('bombDefused', 'Bomb has been defused.');
    if (g.round.state === 'live') g.endRound('CT', 'defused');
  }

  explode() {
    const g = this.g, b = this.bomb;
    b.state = 'exploded';
    g.recorder?.c4off();
    this.stopDefuse();
    this.led.visible = false;
    g.scene.remove(b.mesh);
    const p = b.pos.clone();
    g.effects.bigExplosion(p);
    g.soundAt('c4_explode', p, 1, 1200, 0.6);
    g.shake(p, 2500);
    const dmg = g.map.bombRadius, radius = dmg * 3.5;
    for (const v of g.players) {
      if (!v.alive) continue;
      const center = v1.set(v.pos.x, v.pos.y + v.height() / 2, v.pos.z);
      const d = center.distanceTo(p);
      const hit = dmg - d * (dmg / radius);
      if (hit <= 0) continue;
      const dir = center.clone().sub(p).normalize();
      g.damagePlayer(v, null, hit, C4_DEF, 'generic', dir, center.clone(), false);
    }
    g.breakAround(p, radius * 0.5, 400);
    g.items.blast(p, radius * 0.6, 2.2);
    if (g.round.state === 'live') {
      if (b.planter) b.planter.score += 3;
      g.endRound('T', 'bombed');
    }
  }

  // ---------- per tick ----------
  // a defuser has to keep holding use and stay put
  playerTick(p, cmd) {
    const b = this.bomb;
    if (b && b.state === 'planted' && b.defuser === p) {
      if (!cmd.use || p.pos.distanceToSquared(b.defusePos) > 24 * 24) this.stopDefuse();
      else if (this.g.time >= b.defuseEnd) this.defused();
    }
  }

  tick(dt) {
    const g = this.g;
    const b = this.bomb;
    if (g.time >= (this.nextPlans || 0)) {
      this.nextPlans = g.time + 0.5;
      this.botPlans();
    }
    if (b && b.state === 'planted') {
      const left = b.blowAt - g.time;
      if (g.time >= b.nextBeep) {
        // beeps come faster and faster as the timer runs out
        const k = Math.max(0, left / C4_TIMER);
        b.nextBeep = g.time + Math.max(0.1, 1.45 * k * k + 0.12);
        g.soundAt('c4_beep', b.pos, 0.75, 260, 0.1);
        this.ledUntil = g.time + 0.12;
      }
      if (left <= 0) this.explode();
    }
  }

  render() {
    const g = this.g;
    const b = this.bomb;
    if (b && b.state === 'planted') {
      const on = g.time < this.ledUntil;
      this.led.visible = on;
      if (on) this.led.position.set(b.pos.x, b.pos.y + 4, b.pos.z);
    } else this.led.visible = false;
  }

  // ---------- HUD ----------
  hudState(p) {
    const b = this.bomb;
    const w = p.weapon;
    let progress = null;
    if (w && w.def.type === 'c4' && w.arming) progress = { k: Math.min(1, (this.g.time - w.armStart) / w.def.plantTime), label: t('planting') };
    else if (b && b.state === 'planted' && b.defuser === p) progress = { k: Math.min(1, (this.g.time - b.defuseStart) / (b.defuseEnd - b.defuseStart)), label: t(p.defuser ? 'defusingKit' : 'defusing') };
    return {
      money: p.money,
      buy: p.alive && this.canBuyNow(p),
      c4: !!p.weapons[5],
      c4Site: !!p.weapons[5] && !!this.siteAt(p.pos),
      defuser: p.defuser,
      progress,
    };
  }

  // where the bomb is, for the radar (Terrorists only)
  bombRadar() {
    const b = this.bomb;
    if (!b) return null;
    if (b.state === 'carried') return b.carrier.alive ? { pos: b.carrier.pos, carried: true } : null;
    if (b.state === 'dropped') return { pos: b.item.pos, carried: false };
    if (b.state === 'planted') return { pos: b.pos, planted: true };
    return null;
  }
}

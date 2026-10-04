// Team radio: the short radio menu (Z), what bots say on their own and their
// answers to you. Like 1.6 only the speaker's team hears it: a line in the
// message area, the radio voice saying it, a radio icon over the speaker's
// head and their dot flashing on the radar. Spectators hear the team of the
// player they're watching.

import * as THREE from '../lib/three.module.js';
import { t } from './i18n.js';
import { radio } from './radio.js';

// the menu, keys 1-8
export const RADIO_MENU = ['goGoGo', 'fallBack', 'enemySpotted', 'needBackup', 'sectorClear', 'inPosition', 'roger', 'negative'];

// what the radio voice says (English, like 1.6)
const SPOKEN = {
  goGoGo: 'Go go go!', fallBack: 'Fall back!', enemySpotted: 'Enemy spotted.', needBackup: 'Need backup.',
  sectorClear: 'Sector clear.', inPosition: "I'm in position.", roger: 'Roger that.', negative: 'Negative.',
  affirmative: 'Affirmative.', fireInTheHole: 'Fire in the hole!', enemyDown: 'Enemy down.', takingFire: 'Taking fire, need assistance!',
};

// the commands and calls a teammate bot answers
const ANSWERED = new Set(['goGoGo', 'fallBack', 'enemySpotted', 'needBackup', 'sectorClear', 'inPosition']);
const ICON_TIME = 1.5;
const BOT_GAP = 2.5;   // a team's bots leave this long between radio lines
const SAME_GAP = 8;    // and one bot doesn't repeat itself sooner than this
const VOICE_GAP = 1.6; // the voice skips bot lines that come quicker than this (the text still shows)

export class TeamRadio {
  constructor(game) {
    this.g = game;
    this.menuOpen = false;
    this.lastBot = { T: -10, CT: -10 };
    this.lastVoice = -10;
    // (Bot Arena's background matches draw nothing)
    this.mat = new THREE.SpriteMaterial({ map: game.headless ? null : iconTexture(), depthWrite: false, transparent: true });
    this.icons = [];
  }

  reset() {
    this.closeMenu();
    this.lastBot = { T: -10, CT: -10 };
    this.lastVoice = -10;
    for (const s of this.icons) s.visible = false;
  }

  dispose() {
    for (const s of this.icons) this.g.scene.remove(s);
    this.icons = [];
  }

  toggleMenu() {
    const g = this.g, h = g.human;
    if (this.menuOpen) {
      this.closeMenu();
      return;
    }
    if (!h || !h.alive || !h.team) {
      g.hud.message(t(g.ffa ? 'radioNoTeam' : 'radioDead'), g.time, 3);
      return;
    }
    this.menuOpen = true;
    g.hud.showTextMenu(t('radioTitle'), [
      ...RADIO_MENU.map((k, i) => ({ key: i + 1, label: t('radio_' + k) })),
      { gap: true },
      { key: 0, label: t('radioExit') },
    ]);
  }

  closeMenu() {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.g.hud.showTextMenu(null);
  }

  // a number key while the menu is open (0 closes it)
  choose(n) {
    this.closeMenu();
    const key = RADIO_MENU[n - 1];
    const g = this.g, h = g.human;
    if (!key || !h.alive || !h.team) return;
    // a friend online: the host's game says it for them
    if (g.client) g.client.send({ t: 'radio', key });
    else this.order(h, key);
  }

  // a person picked a line from the menu (online, a friend too)
  order(p, key) {
    const g = this.g;
    if (!RADIO_MENU.includes(key) || !p.alive || !p.team) return;
    this.say(p, key);
    // a teammate bot answers orders and calls
    if (!ANSWERED.has(key)) return;
    const mates = g.players.filter((o) => o.isBot && o.alive && o.team === p.team);
    if (!mates.length) return;
    const b = mates[(Math.random() * mates.length) | 0];
    const answer = Math.random() < 0.15 ? 'negative' : Math.random() < 0.5 ? 'affirmative' : 'roger';
    g.later(0.7 + Math.random() * 0.8, () => b.alive && this.say(b, answer, true));
  }

  // p says something; bot chatter is rate-limited so they don't talk over each other
  say(p, key, answer = false) {
    const g = this.g;
    if (!p.team || !p.alive || !SPOKEN[key]) return false;
    if (p.isBot) {
      p.radioSaid = p.radioSaid || {};
      if (!answer && (g.time - this.lastBot[p.team] < BOT_GAP || g.time - (p.radioSaid[key] ?? -100) < SAME_GAP)) return false;
      this.lastBot[p.team] = g.time;
      p.radioSaid[key] = g.time;
    }
    if (g.net) g.net.radio(p, key);
    this.show(p, key);
    return true;
  }

  // what everyone sees and hears of it (a friend's game online: from the host)
  show(p, key) {
    const g = this.g;
    if (!SPOKEN[key]) return;
    p.radioUntil = g.time + ICON_TIME;
    if (!this.hears(p.team)) return;
    g.hud.radioMessage(p, t('radio_' + key), g.time);
    if (!p.isBot || g.time - this.lastVoice >= VOICE_GAP) {
      this.lastVoice = g.time;
      radio.say(SPOKEN[key]);
    }
  }

  // does the human hear this team's radio?
  hears(team) {
    const g = this.g, h = g.human;
    if (!h) return false;
    if (h.spectator) return !!g.specTarget && g.specTarget.team === team;
    return h.team === team;
  }

  // radio icons over the heads of teammates who just spoke
  render() {
    const g = this.g;
    let k = 0;
    for (const p of g.players) {
      if (!p.alive || !(p.radioUntil > g.time) || p === g.pov || !this.hears(p.team)) continue;
      let s = this.icons[k];
      if (!s) {
        s = new THREE.Sprite(this.mat);
        s.scale.set(11, 11, 1);
        g.scene.add(s);
        this.icons.push(s);
      }
      s.visible = true;
      s.position.set(p.model.root.position.x, p.model.root.position.y + p.height() + 16, p.model.root.position.z);
      k++;
    }
    for (; k < this.icons.length; k++) this.icons[k].visible = false;
  }
}

// a little walkie-talkie: body, speaker grille and antenna
function iconTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.lineJoin = 'round';
  const body = () => {
    x.beginPath();
    x.roundRect(20, 18, 26, 40, 5);
  };
  x.strokeStyle = 'rgba(0,0,0,0.85)';
  x.lineWidth = 6;
  body();
  x.stroke();
  x.beginPath();
  x.moveTo(40, 18);
  x.lineTo(40, 4);
  x.stroke();
  x.fillStyle = '#e8e4d0';
  body();
  x.fill();
  x.strokeStyle = '#e8e4d0';
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(40, 18);
  x.lineTo(40, 5);
  x.stroke();
  x.fillStyle = '#3a3a34';
  for (let i = 0; i < 4; i++) x.fillRect(25, 25 + i * 5, 16, 2);
  x.fillStyle = '#c03a20';
  x.fillRect(25, 47, 6, 5);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

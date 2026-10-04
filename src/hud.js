// CS 1.6 style HUD built from DOM elements: health/armor/timer/ammo,
// dynamic crosshair, kill feed, radar, scoreboard, old-style text menus,
// and for spectators the overview map and the live stats panel.

import { t } from './i18n.js';
import { mapOverview } from './map.js';
import { CrosshairCanvas, crosshairGap, crosshairScale } from './crosshair.js';
import { settings } from './settings.js';
import { WEAPONS } from './weapons.js';

const ICON = {
  cross: '<svg viewBox="0 0 24 24"><path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5.5-3.4 9.6-8 11-4.6-1.4-8-5.5-8-11V5z"/></svg>',
  helmet: '<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5.5-3.4 9.6-8 11-4.6-1.4-8-5.5-8-11V5z"/><path fill="#000" fill-opacity=".45" d="M7 9h10v3H7z"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 110 20 10 10 0 010-20zm0 3a7 7 0 100 14 7 7 0 000-14zm-1 2h2v5l4 2-1 2-5-2.6z"/></svg>',
  ammo: '<svg viewBox="0 0 24 24"><path d="M5 9l2-5 2 5v12H5zm5 0l2-5 2 5v12h-4zm5 0l2-5 2 5v12h-4z"/></svg>',
  cart: '<svg viewBox="0 0 24 24"><path d="M2 3h3l2.6 11h10.2L21 6H7.2l-.5-2H2z"/><circle cx="9" cy="19" r="2"/><circle cx="17" cy="19" r="2"/></svg>',
  c4: '<svg viewBox="0 0 24 24"><path d="M3 8h18v10H3z"/><path fill="#000" fill-opacity=".45" d="M9 10h6v3H9z"/><path d="M6 4h2v4H6zm10 0h2v4h-2z"/></svg>',
  kit: '<svg viewBox="0 0 24 24"><path d="M4 7h16v12H4z"/><path d="M9 3h6v4h-2V5h-2v2H9z"/><path fill="#000" fill-opacity=".45" d="M11 10h2v3h3v2h-3v3h-2v-3H8v-2h3z"/></svg>',
  // a chip: the kill was made with hacks on
  hk: '<svg viewBox="0 0 16 16" class="hk"><path d="M4 4h8v8H4z"/><path d="M6 1h1v3H6zm3 0h1v3H9zM6 12h1v3H6zm3 0h1v3H9zM1 6h3v1H1zm0 3h3v1H1zm11-3h3v1h-3zm0 3h3v1h-3z"/><path fill="#000" fill-opacity=".5" d="M6 6h4v4H6z"/></svg>',
  hs: '<svg viewBox="0 0 16 16" class="hs"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2"/><path d="M8 0v4M8 12v4M0 8h4M12 8h4" stroke="currentColor" stroke-width="1.4"/></svg>',
};

// Kill feed weapon silhouettes, barrel pointing right. [x, y, w, h] or [cx, cy, r]
const GUN_SHAPES = {
  ak47: [[0, 6, 10, 4.5], [10, 5, 16, 4], [12, 9, 3, 4], [18, 9, 3.5, 4], [19.5, 12, 3.5, 3], [26, 5, 8, 3], [34, 5.5, 12, 2], [43, 3.5, 1.2, 2]],
  m4a1: [[0, 5, 8, 6], [8, 6, 4, 2], [12, 4, 14, 5], [14, 2, 9, 2], [19, 9, 4, 6], [13, 9, 3, 4], [26, 5, 9, 3], [35, 6, 11, 1.6], [33, 2.5, 1.5, 3]],
  awp: [[0, 5, 12, 6.5], [12, 5, 14, 4], [16, 1.5, 12, 2.5], [26, 6, 20, 2], [20, 9, 4, 3], [12, 9, 3, 3.5]],
  deagle: [[10, 4, 22, 5], [12, 9, 5, 7], [17, 9, 7, 1.6]],
  glock18: [[14, 5, 17, 4], [15, 9, 5, 7], [20, 9, 5, 1.5]],
  usp: [[13, 5, 18, 4], [14, 9, 5, 7], [19, 9, 5, 1.5]],
  p228: [[14, 5, 16, 4], [15, 9, 5, 7], [20, 9, 5, 1.5]],
  fiveseven: [[13, 5, 19, 4], [14, 9, 5, 7], [19, 9, 5, 1.5]],
  elite: [[4, 2.5, 15, 3.5], [5, 6, 4, 6], [22, 7, 15, 3.5], [23, 10.5, 4, 5.5]],
  m3: [[0, 6, 12, 4.5], [12, 5, 8, 4], [13, 9, 3.5, 4.5], [20, 5, 26, 2], [22, 7.5, 12, 2.6]],
  xm1014: [[0, 5, 4, 6], [4, 6, 8, 2], [12, 5, 9, 4], [13, 9, 3.5, 4.5], [21, 5, 25, 2], [22, 7.5, 11, 2.2]],
  mac10: [[10, 4, 16, 5], [13, 9, 4, 7], [26, 5, 4, 2]],
  tmp: [[10, 4, 15, 4.5], [12, 8.5, 3.5, 6], [20, 8.5, 3, 4], [25, 4.5, 10, 3]],
  mp5navy: [[0, 5, 10, 4], [10, 4, 18, 5], [14, 9, 4, 5], [19, 9, 3, 5.5], [28, 5.5, 8, 3], [36, 6, 4, 1.6]],
  ump45: [[0, 4, 10, 3], [0, 4, 2, 7], [10, 4, 20, 5], [13, 9, 4, 5], [20, 9, 3.5, 6], [30, 5.5, 5, 2]],
  p90: [[2, 5, 30, 6], [8, 11, 4, 4], [6, 3, 22, 2], [32, 7, 6, 2]],
  galil: [[0, 5, 10, 3], [0, 5, 2, 6], [10, 5, 16, 4], [12, 9, 3.5, 4.5], [18, 9, 3.5, 5], [26, 5, 8, 3], [34, 5.5, 12, 2]],
  famas: [[0, 5, 30, 5], [4, 2, 22, 2], [10, 10, 4, 5], [18, 10, 3, 4], [30, 6, 12, 2]],
  sg552: [[0, 4, 10, 6], [10, 5, 16, 4], [12, 1.5, 8, 2.5], [13, 9, 3.5, 4], [19, 9, 3.5, 5.5], [26, 5.5, 9, 3], [35, 6, 10, 1.6]],
  aug: [[0, 5, 22, 6], [8, 1.5, 14, 3], [16, 11, 3, 4], [22, 6, 6, 3], [28, 6.5, 18, 1.8]],
  scout: [[0, 5, 12, 6], [12, 5, 12, 3], [14, 1.5, 12, 2.5], [24, 6, 22, 1.6], [14, 8, 3, 3.5]],
  g3sg1: [[0, 4, 12, 7], [12, 5, 16, 4.5], [14, 1, 12, 2.5], [16, 9.5, 4, 4.5], [22, 9, 3.5, 5], [28, 5.5, 10, 3], [38, 6, 8, 1.8]],
  sg550: [[0, 4, 12, 7], [12, 5, 16, 4], [14, 1, 12, 2.5], [16, 9, 3.5, 4.5], [22, 9, 3.5, 5], [28, 5.5, 10, 3], [38, 6, 8, 1.6]],
  m249: [[0, 5, 12, 5], [12, 4, 18, 6], [14, 10, 7, 5], [30, 5, 8, 3], [38, 6, 8, 2], [26, 1.5, 6, 2.5]],
  knife: [[4, 7, 12, 3], [16, 5, 2, 7], [18, 6.5, 22, 2.6], [40, 7, 4, 1.6]],
  hegrenade: [[23, 9.5, 5.5], [21, 1.5, 4, 3], [26.5, 2.5, 1.5, 9]],
  c4: [[12, 5, 24, 8], [16, 2, 10, 3], [30, 4, 2, 10]],
  world: [[24, 7, 6.5], [19.5, 11, 9, 4.5]],
  vest: [[16, 1, 16, 14], [14, 1, 4, 5], [30, 1, 4, 5]],
  vesthelm: [[8, 4, 13, 11], [6, 4, 3, 3], [24, 2, 14, 13], [36, 9, 4, 3]],
  defuser: [[14, 4, 20, 10], [20, 1, 8, 3], [34, 6, 6, 2]],
  flashbang: [[20, 4, 7, 11], [21, 1.5, 4, 3], [27, 2.5, 1.5, 9]],
  smokegrenade: [[20, 4, 7.5, 11], [21, 1.5, 4, 3], [27.5, 2.5, 1.5, 9]],
};

export function gunIcon(id, cls = 'gun') {
  const shapes = (GUN_SHAPES[id] || GUN_SHAPES.knife).map((s) => s.length === 3
    ? `<circle cx="${s[0]}" cy="${s[1]}" r="${s[2]}"/>`
    : `<rect x="${s[0]}" y="${s[1]}" width="${s[2]}" height="${s[3]}"/>`).join('');
  return `<svg viewBox="0 0 48 16" class="${cls}">${shapes}</svg>`;
}

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

const fmtTime = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = '';
    // smoke, flashbang white-out and the scope are drawn under the rest of the HUD, like in CS
    this.smokeEl = el('div', 'smoke-overlay', root);
    this.whiteEl = el('div', 'flash-overlay', root);
    this.scope = el('div', 'scope hidden', root, '<div class="scope-ring"></div><i class="h"></i><i class="v"></i>');
    // hacker mode: labels over players (ESP)
    this.esp = el('canvas', 'esp hidden', root);
    this.espCtx = this.esp.getContext('2d');
    this.espOn = false;
    // spectating: the map from above, and everyone's numbers at the side
    this.ov = el('canvas', 'overview hidden', root);
    this.ovCtx = this.ov.getContext('2d');
    this.ovOn = false;
    this.panel = el('div', 'spec-panel hidden', root);
    this.panelHtml = '';
    this.radar = el('canvas', 'radar', root);
    this.radar.width = this.radar.height = 150;
    this.rctx = this.radar.getContext('2d');
    this.topCenter = el('div', 'top-center', root);
    this.killfeed = el('div', 'killfeed', root);
    this.cross = el('canvas', 'crosshair', root);
    this.crossCanvas = new CrosshairCanvas(this.cross);
    this.dmg = el('div', 'dmg-ind', root, '<i class="d-t"></i><i class="d-b"></i><i class="d-l"></i><i class="d-r"></i>');
    this.dmgParts = { front: this.dmg.children[0], back: this.dmg.children[1], left: this.dmg.children[2], right: this.dmg.children[3] };
    this.dmgAlpha = { front: 0, back: 0, left: 0, right: 0 };
    this.flashEl = el('div', 'hurt-flash', root);
    this.bottom = el('div', 'hud-bottom', root);
    this.hp = el('div', 'hud-num hp', this.bottom, `<span class="icon">${ICON.cross}</span><span class="val">100</span>`);
    this.ar = el('div', 'hud-num armor', this.bottom, `<span class="icon">${ICON.helmet}</span><span class="val">0</span>`);
    this.timer = el('div', 'hud-num timer', this.bottom, `<span class="icon">${ICON.clock}</span><span class="val">0:00</span>`);
    this.ammo = el('div', 'hud-num ammo', this.bottom, `<span class="val clip">0</span><span class="sep"></span><span class="val reserve">0</span><span class="icon">${ICON.ammo}</span>`);
    // bomb defusal: money, status icons on the left, plant / defuse progress
    this.money = el('div', 'hud-num money hidden', root, '<span class="cur">$</span><span class="val">0</span><span class="delta"></span>');
    this.moneyVal = this.money.querySelector('.val');
    this.moneyDelta = this.money.querySelector('.delta');
    this.icons = el('div', 'hud-icons', root);
    this.iconBuy = el('div', 'hud-icon buy hidden', this.icons, ICON.cart);
    this.iconC4 = el('div', 'hud-icon c4 hidden', this.icons, ICON.c4);
    this.iconKit = el('div', 'hud-icon kit hidden', this.icons, ICON.kit);
    this.progress = el('div', 'hud-progress hidden', root, '<div class="lbl"></div><div class="bar"><i></i></div>');
    this.progressLbl = this.progress.querySelector('.lbl');
    this.progressBar = this.progress.querySelector('i');
    this.deltaUntil = 0;
    this.hpVal = this.hp.querySelector('.val');
    this.arVal = this.ar.querySelector('.val');
    this.arIcon = this.ar.querySelector('.icon');
    this.timerVal = this.timer.querySelector('.val');
    this.clipVal = this.ammo.querySelector('.clip');
    this.resVal = this.ammo.querySelector('.reserve');
    this.center = el('div', 'center-msg', root);
    this.sub = el('div', 'sub-msg', root);
    this.status = el('div', 'status-text', root);
    this.killNote = el('div', 'kill-note', root);
    this.msgs = el('div', 'msgs', root);
    this.spec = el('div', 'spec-info hidden', root);
    this.fps = el('div', 'fps hidden', root);
    this.board = el('div', 'scoreboard hidden', root);
    this.menu = el('div', 'textmenu hidden', root);
    this.centerUntil = 0;
    this.subUntil = 0;
    this.crossGap = 0;
    this.crossAlpha = 255;
    this.last = {};
    this.radarTimer = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
  }

  setVisible(v) {
    this.root.classList.toggle('hidden', !v);
  }

  // Only touch the DOM when a value changed.
  set(key, elmt, val) {
    if (this.last[key] === val) return;
    this.last[key] = val;
    elmt.textContent = val;
  }

  update(s, dt, now) {
    // s: { alive, health, armor, helmet, clip, reserve, showAmmo, timer, crossGap, showCross, zoomed, statusText }
    this.bottom.classList.toggle('hidden', !s.alive);
    this.set('hp', this.hpVal, String(Math.max(0, Math.ceil(s.health))));
    this.hp.classList.toggle('low', s.health <= 25);
    this.set('ar', this.arVal, String(Math.ceil(s.armor)));
    if (this.last.helmet !== s.helmet) {
      this.last.helmet = s.helmet;
      this.arIcon.innerHTML = s.helmet ? ICON.helmet : ICON.shield;
    }
    this.ar.classList.toggle('dim', s.armor <= 0);
    this.timer.classList.toggle('hidden', s.timer == null);
    if (s.timer != null) this.set('tm', this.timerVal, fmtTime(s.timer));
    this.ammo.classList.toggle('hidden', !s.showAmmo);
    if (s.showAmmo) {
      this.set('clip', this.clipVal, String(s.clip));
      this.set('res', this.resVal, String(s.reserve));
      // grenades only show how many you carry
      this.ammo.classList.toggle('noclip', s.reserve === null);
    }

    // flashbang white-out and being inside smoke
    const white = s.flash || 0, smoke = s.smoke || 0;
    if (this.last.white !== white) {
      this.last.white = white;
      this.whiteEl.style.opacity = white.toFixed(3);
    }
    if (this.last.smoke !== smoke) {
      this.last.smoke = smoke;
      this.smokeEl.style.opacity = smoke.toFixed(3);
    }

    // crosshair (also when watching someone through their eyes)
    const eyes = s.alive || s.specEye;
    const showCross = eyes && s.showCross && !s.scoped;
    this.cross.classList.toggle('hidden', !showCross);
    if (showCross) {
      const o = settings.crosshair;
      // CS 1.6: shrink a little every (100 fps) frame, never below the base distance
      const frames = dt * 100;
      this.crossGap -= (this.crossGap * 0.013 + 0.1) * frames;
      this.crossAlpha = Math.min(255, this.crossAlpha + 2 * frames);
      if (this.crossGap < s.crossGap) this.crossGap = s.crossGap;
      this.crossCanvas.draw(o, crosshairGap(o, this.crossGap), crosshairScale(window.innerHeight));
      // a dynamic crosshair also fades a little while shooting
      const op = (o.alpha * (o.dynamic ? this.crossAlpha / 255 : 1)).toFixed(2);
      if (this.last.crossOp !== op) {
        this.last.crossOp = op;
        this.cross.style.opacity = op;
      }
    }
    this.scope.classList.toggle('hidden', !(eyes && s.scoped));

    // damage direction indicators fade out
    for (const k in this.dmgAlpha) {
      if (this.dmgAlpha[k] > 0) {
        this.dmgAlpha[k] = Math.max(0, this.dmgAlpha[k] - dt * 1.5);
        this.dmgParts[k].style.opacity = this.dmgAlpha[k].toFixed(2);
      }
    }

    if (now > this.centerUntil && this.center.textContent) this.center.textContent = '';
    if (now > this.subUntil && this.sub.textContent) this.sub.textContent = '';
    this.set('status', this.status, s.statusText || '');
    if (s.statusColor !== this.last.statusColor) {
      this.last.statusColor = s.statusColor;
      this.status.style.color = s.statusColor || '';
    }

    // kill feed expiry
    for (const c of [...this.killfeed.children]) if (now > +c.dataset.until) c.remove();
    for (const c of [...this.msgs.children]) if (now > +c.dataset.until) c.remove();
    // kill notices fade in, hold, then fade out (on game time, so they pause with the game)
    for (const c of [...this.killNote.children]) {
      const age = now - +c.dataset.born;
      if (age > KILL_NOTE_TIME) {
        c.remove();
        continue;
      }
      const op = age < 0.1 ? age / 0.1 : age > KILL_NOTE_TIME - 0.4 ? (KILL_NOTE_TIME - age) / 0.4 : 1;
      c.style.opacity = (op * KILL_NOTE_ALPHA).toFixed(2);
    }

    // fps
    this.fps.classList.toggle('hidden', !settings.showFps);
    if (settings.showFps) {
      this.fpsFrames++;
      this.fpsTime += dt;
      if (this.fpsTime >= 0.5) {
        this.fps.textContent = Math.round(this.fpsFrames / this.fpsTime) + ' fps';
        this.fpsFrames = 0;
        this.fpsTime = 0;
      }
    }
  }

  // bomb defusal HUD; st from BombMode.hudState (null when dead or not that mode)
  setBombHud(st, money) {
    this.money.classList.toggle('hidden', money == null);
    if (money != null) this.set('money', this.moneyVal, String(money));
    if (this.deltaUntil && performance.now() > this.deltaUntil) {
      this.deltaUntil = 0;
      this.moneyDelta.textContent = '';
    }
    const on = (e, v) => { if (e.classList.contains('hidden') === !!v) e.classList.toggle('hidden', !v); };
    on(this.iconBuy, st && st.buy);
    on(this.iconC4, st && st.c4);
    on(this.iconKit, st && st.defuser);
    if (st) this.iconC4.classList.toggle('blink', !!st.c4Site);
    const pr = st && st.progress;
    on(this.progress, pr);
    if (pr) {
      this.set('prl', this.progressLbl, pr.label);
      const w = (pr.k * 100).toFixed(1) + '%';
      if (this.last.prw !== w) {
        this.last.prw = w;
        this.progressBar.style.width = w;
      }
    }
  }

  // +300 / -2500 next to the money, like 1.6
  moneyChange(delta) {
    this.moneyDelta.textContent = (delta > 0 ? '+' : '') + delta;
    this.moneyDelta.className = 'delta ' + (delta > 0 ? 'up' : 'down');
    this.deltaUntil = performance.now() + 2500;
  }

  // a shot was fired: the crosshair opens up and fades a bit
  crossShot(delta) {
    this.crossGap = Math.min(15, this.crossGap + delta);
    this.crossAlpha = Math.max(120, this.crossAlpha - 40);
  }

  damage(side) {
    this.dmgAlpha[side] = 1;
    this.dmgParts[side].style.opacity = '1';
    this.hurtFlash();
  }

  // the red flash of getting hurt (falls have no direction)
  hurtFlash() {
    this.flashEl.classList.remove('on');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('on');
  }

  centerPrint(text, now, dur = 3) {
    this.center.textContent = text;
    this.centerUntil = now + dur;
  }

  subPrint(text, now, dur = 3) {
    this.sub.textContent = text;
    this.subUntil = now + dur;
  }

  message(text, now, dur = 6) {
    const m = el('div', 'msg', this.msgs);
    m.textContent = text;
    m.dataset.until = now + dur;
    while (this.msgs.children.length > 5) this.msgs.firstChild.remove();
  }

  // hacker mode: "Viper turned on: Wallhack, Aimbot"
  hackMessage(text, now) {
    const m = el('div', 'msg hack', this.msgs);
    m.textContent = text;
    m.dataset.until = now + 8;
    while (this.msgs.children.length > 5) this.msgs.firstChild.remove();
  }

  // ESP labels: [{ x, y (CSS px, over the head), name, team, hack, hp, gun, dist }]
  drawEsp(list) {
    const c = this.espCtx, cv = this.esp;
    if (!list || !list.length) {
      if (this.espOn) {
        this.espOn = false;
        cv.classList.add('hidden');
        c.clearRect(0, 0, cv.width, cv.height);
      }
      return;
    }
    if (!this.espOn) {
      this.espOn = true;
      cv.classList.remove('hidden');
    }
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(window.innerWidth * dpr), H = Math.round(window.innerHeight * dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.lineJoin = 'round';
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    const text = (s, x, y, col) => {
      c.strokeText(s, x, y);
      c.fillStyle = col;
      c.fillText(s, x, y);
    };
    // players standing close together: the nearer one keeps its spot, the
    // others' labels stack above it (and are drawn first, under it)
    const LH = 36;
    c.font = 'bold 11px Verdana, Tahoma, sans-serif';
    const placed = [];
    for (const e of [...list].sort((a, b) => a.dist - b.dist)) {
      e.w = Math.max(70, c.measureText((e.hack ? t('hackTag') + ' ' : '') + e.name).width + 8);
      for (let n = 0; n < 6; n++) {
        const hit = placed.find((o) => Math.abs(o.x - e.x) < (o.w + e.w) / 2 && Math.abs(o.y - e.y) < LH);
        if (!hit) break;
        e.y = hit.y - LH;
      }
      placed.push(e);
    }
    for (const e of placed.reverse()) {
      const x = Math.round(e.x), y = Math.round(e.y);
      const col = e.team === 'T' ? '#ff7a5c' : e.team === 'CT' ? '#9cc4ff' : '#ffd34a';
      // bottom up: gun and distance, health bar, name
      c.font = '10px Verdana, Tahoma, sans-serif';
      text(`${e.gun}  ${t('espDist', { n: e.dist })}`, x, y, '#d8d8d8');
      const bw = 36, bx = x - bw / 2, by = y - 16;
      c.fillStyle = 'rgba(0,0,0,0.75)';
      c.fillRect(bx - 1, by - 1, bw + 2, 5);
      const hp = Math.max(0, Math.min(100, e.hp));
      c.fillStyle = hp > 60 ? '#5fd35f' : hp > 25 ? '#e8c43a' : '#ff4a3a';
      c.fillRect(bx, by, (bw * hp) / 100, 3);
      c.font = 'bold 11px Verdana, Tahoma, sans-serif';
      const name = (e.hack ? t('hackTag') + ' ' : '') + e.name;
      text(name, x, y - 21, e.hack ? '#ff5a4a' : col);
    }
  }

  // The spectator overview: the map from above with everyone on it, their
  // shots, where people died, smoke and the bomb (o: game.overviewData())
  drawOverview(o) {
    const cv = this.ov, c = this.ovCtx;
    if (!o) {
      if (this.ovOn) {
        this.ovOn = false;
        cv.classList.add('hidden');
        this.radar.classList.remove('hidden');
      }
      return;
    }
    if (!this.ovOn) {
      this.ovOn = true;
      cv.classList.remove('hidden');
      this.radar.classList.add('hidden');
    }
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(window.innerWidth * dpr), H = Math.round(window.innerHeight * dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#0c0e0a';
    c.fillRect(0, 0, W, H);
    const bg = mapOverview(o.map.name);
    // fit the map between the score at the top and the spectator line at the bottom
    const k = Math.min((W - 40 * dpr) / bg.w, (H - 150 * dpr) / bg.h);
    const x0 = (W - bg.w * k) / 2, y0 = 50 * dpr + (H - 150 * dpr - bg.h * k) / 2;
    c.drawImage(bg.canvas, x0, y0, bg.w * k, bg.h * k);
    const u = bg.s * k;
    const X = (x) => x0 + (bg.ox + x * bg.s) * k, Y = (z) => y0 + (bg.oz + z * bg.s) * k;
    const teamCol = (team) => (team === 'T' ? '#ff5a3a' : team === 'CT' ? '#7fb4ff' : '#ffb030');
    for (const sm of o.smokes) {
      c.fillStyle = `rgba(205, 205, 200, ${0.45 * sm.a})`;
      c.beginPath();
      c.arc(X(sm.x), Y(sm.z), Math.max(4, sm.r * u), 0, Math.PI * 2);
      c.fill();
    }
    // where people died: a cross that fades away
    c.lineWidth = 2 * dpr;
    for (const d of o.deaths) {
      const a = Math.max(0, 1 - (o.now - d.t) / 15);
      const x = X(d.x), y = Y(d.z), r = 4 * dpr;
      c.strokeStyle = `rgba(${d.team === 'T' ? '255,90,58' : d.team === 'CT' ? '127,180,255' : '255,176,48'}, ${0.85 * a})`;
      c.beginPath();
      c.moveTo(x - r, y - r); c.lineTo(x + r, y + r); c.moveTo(x + r, y - r); c.lineTo(x - r, y + r);
      c.stroke();
    }
    c.lineWidth = 1.2 * dpr;
    for (const l of o.shots) {
      c.strokeStyle = `rgba(255, 230, 140, ${0.8 * l.k})`;
      c.beginPath();
      c.moveTo(X(l.ax), Y(l.az));
      c.lineTo(X(l.bx), Y(l.bz));
      c.stroke();
    }
    if (o.bomb) {
      const blink = o.bomb.planted ? (performance.now() / 300) % 2 < 1 : true;
      if (blink) {
        c.fillStyle = o.bomb.planted ? '#ff2a1a' : '#ffd040';
        c.fillRect(X(o.bomb.x) - 5 * dpr, Y(o.bomb.z) - 4 * dpr, 10 * dpr, 8 * dpr);
      }
    }
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.font = `${10 * dpr}px Verdana, Tahoma, sans-serif`;
    c.lineJoin = 'round';
    const R = 5.5 * dpr;
    for (const p of o.players) {
      const x = X(p.x), y = Y(p.z);
      // which way they look
      c.strokeStyle = 'rgba(255,255,255,0.75)';
      c.lineWidth = 1.5 * dpr;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x - Math.sin(p.yaw) * R * 2.6, y - Math.cos(p.yaw) * R * 2.6);
      c.stroke();
      c.fillStyle = p.team ? teamCol(p.team) : p.mark || teamCol(null);
      c.beginPath();
      c.arc(x, y, R, 0, Math.PI * 2);
      c.fill();
      // a Bot Arena character's own color round it; the one we watch in white
      if (p.mark || p.me) {
        c.strokeStyle = p.me ? '#ffffff' : p.mark;
        c.lineWidth = (p.me ? 2.5 : 2) * dpr;
        c.beginPath();
        c.arc(x, y, R + 2.5 * dpr, 0, Math.PI * 2);
        c.stroke();
      }
      const hp = Math.max(0, Math.min(100, p.hp));
      c.fillStyle = 'rgba(0,0,0,0.7)';
      c.fillRect(x - 10 * dpr, y + R + 4 * dpr, 20 * dpr, 3 * dpr);
      c.fillStyle = hp > 60 ? '#5fd35f' : hp > 25 ? '#e8c43a' : '#ff4a3a';
      c.fillRect(x - 10 * dpr, y + R + 4 * dpr, (20 * dpr * hp) / 100, 3 * dpr);
      const name = (p.hack ? t('hackTag') + ' ' : '') + p.name;
      c.strokeStyle = 'rgba(0,0,0,0.85)';
      c.lineWidth = 3 * dpr;
      c.strokeText(name, x, y - R - 3 * dpr);
      c.fillStyle = p.hack ? '#ff6a5a' : p.me ? '#ffffff' : '#e8e8e0';
      c.fillText(name, x, y - R - 3 * dpr);
    }
  }

  // The live stats panel at the right (rows from game.panelRows(), or null).
  // money / rating: show those columns.
  setPanel(rows, money, rating) {
    if (!rows) {
      if (this.panelHtml) {
        this.panelHtml = '';
        this.panel.classList.add('hidden');
      }
      return;
    }
    const cell = (v) => (v == null ? '—' : escapeHtml(String(v)));
    let html = `<table><tr><th></th><th>${escapeHtml(t('name'))}</th><th>K</th><th>D</th><th>HP</th><th>${escapeHtml(t('panelGun'))}</th>` +
      (money ? '<th>$</th>' : '') + (rating ? `<th>${escapeHtml(t('arenaRating'))}</th>` : '') + '</tr>';
    for (const r of rows) {
      const team = r.team === 'T' ? 't' : r.team === 'CT' ? 'ct' : 'ffa';
      const hp = r.hp == null ? '' : `<span class="pbar"><i style="width:${r.hp}%"></i></span>${r.hp}`;
      html += `<tr class="${r.alive ? '' : 'dead'}${r.watched ? ' on' : ''}">` +
        `<td>${r.mark ? `<i class="ar-dot" style="background:${r.mark}"></i>` : ''}</td>` +
        `<td class="${team}">${escapeHtml(r.name)}${r.hack ? ` <em class="hk">${escapeHtml(t('hackTag'))}</em>` : ''}</td>` +
        `<td>${r.k}</td><td>${r.d}</td><td class="hp">${r.alive ? hp || '—' : escapeHtml(t('dead'))}</td><td>${escapeHtml(r.gun || '')}</td>` +
        (money ? `<td>${cell(r.money)}</td>` : '') + (rating ? `<td>${cell(r.rating)}</td>` : '') + '</tr>';
    }
    html += '</table>';
    if (html === this.panelHtml) return;
    this.panelHtml = html;
    this.panel.innerHTML = html;
    this.panel.classList.remove('hidden');
  }

  // a teammate on the radio: "Name (RADIO): Enemy spotted."
  radioMessage(p, text, now) {
    const m = el('div', 'msg radio', this.msgs);
    m.innerHTML = `${teamName(p)} <span class="rd-tag">${escapeHtml(t('radioTag'))}</span>: ${escapeHtml(text)}`;
    m.dataset.until = now + 6;
    while (this.msgs.children.length > 5) this.msgs.firstChild.remove();
  }

  kill(k, now, localPlayer) {
    const e = el('div', 'kf', this.killfeed);
    // our own kills stand out (and stay longer); our deaths get a thin outline
    const mine = k.killer === localPlayer && k.victim !== localPlayer;
    if (mine) e.classList.add('mine');
    else if (k.killer === localPlayer || k.victim === localPlayer) e.classList.add('me');
    e.innerHTML = (k.killer && k.killer !== k.victim ? teamName(k.killer) + ' ' : '') + gunIcon(k.weapon) + (k.headshot ? ICON.hs : '') + (k.hack ? ICON.hk : '') + ' ' + teamName(k.victim);
    e.dataset.until = now + (mine ? 10 : 6);
    while (this.killfeed.children.length > 5) this.killfeed.firstChild.remove();
  }

  // "You killed X" under the crosshair (the last two kills)
  killNotice(victim, headshot, now) {
    const e = el('div', 'kn' + (headshot ? ' hs' : ''), this.killNote);
    e.innerHTML = `<span class="kn-text">${t('youKilled', { name: teamName(victim) })}</span>` + (headshot ? `<span class="kn-hs">${t('headshotNote')}</span>` : '');
    e.dataset.born = now;
    e.style.opacity = '0';
    while (this.killNote.children.length > 2) this.killNote.firstChild.remove();
  }

  clearFeed() {
    this.killfeed.innerHTML = '';
    this.killNote.innerHTML = '';
    this.msgs.innerHTML = '';
    this.center.textContent = '';
    this.sub.textContent = '';
  }

  setTopCenter(html) {
    if (this.last.top === html) return;
    this.last.top = html;
    this.topCenter.innerHTML = html;
  }

  setSpec(text) {
    this.spec.classList.toggle('hidden', !text);
    if (text) this.set('spec', this.spec, text);
  }

  // bomb: { pos, carried?, planted? } for Terrorists
  // now: game time, for the dots of teammates talking on the radio
  // isShown: whose dots to draw (teammates; everyone with the radar hack)
  drawRadar(me, players, isShown, yaw, dt, bomb, now = 0) {
    this.radarTimer -= dt;
    if (this.radarTimer > 0) return;
    this.radarTimer = 0.05;
    const c = this.rctx, R = 75, range = 1500;
    c.clearRect(0, 0, 150, 150);
    c.fillStyle = 'rgba(30,40,24,0.55)';
    c.beginPath();
    c.arc(R, R, R - 1, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(190,200,170,0.45)';
    c.lineWidth = 1;
    c.stroke();
    c.beginPath();
    c.moveTo(R, 4); c.lineTo(R, 146); c.moveTo(4, R); c.lineTo(146, R);
    c.strokeStyle = 'rgba(190,200,170,0.15)';
    c.stroke();
    if (!me) return;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    // rotate so that view direction is up
    const toRadar = (x, z) => {
      const dx = x - me.pos.x, dz = z - me.pos.z;
      const rx = dx * cs - dz * sn;
      const rz = dx * sn + dz * cs;
      let px = (rx / range) * R, py = (rz / range) * R;
      const d = Math.hypot(px, py);
      if (d > R - 5) { px *= (R - 5) / d; py *= (R - 5) / d; }
      return [R + px, R + py];
    };
    for (const p of players) {
      if (p === me || !p.alive || !isShown(p)) continue;
      const [x, y] = toRadar(p.pos.x, p.pos.z);
      c.fillStyle = p.team === 'T' ? '#ff5a3a' : p.team === 'CT' ? '#7fb4ff' : '#ffb030';
      c.fillRect(x - 2.5, y - 2.5, 5, 5);
      // on the radio: the dot flashes
      if (p.radioUntil > now && (now * 6) % 2 < 1.2) {
        c.strokeStyle = '#fff';
        c.lineWidth = 1.2;
        c.strokeRect(x - 4.5, y - 4.5, 9, 9);
      }
    }
    if (bomb) {
      // the bomb blinks: carried, dropped or planted
      const blink = (performance.now() / 250) % 2 < 1.3;
      const [x, y] = toRadar(bomb.pos.x, bomb.pos.z);
      if (blink || bomb.carried) {
        c.strokeStyle = bomb.planted ? '#ff2020' : '#ffd040';
        c.lineWidth = 1.5;
        c.strokeRect(x - 4.5, y - 4.5, 9, 9);
        if (!bomb.carried) {
          c.fillStyle = bomb.planted ? '#ff2020' : '#ffd040';
          c.fillRect(x - 2, y - 2, 4, 4);
        }
      }
    }
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(R, R - 5); c.lineTo(R + 4, R + 4); c.lineTo(R - 4, R + 4);
    c.closePath();
    c.fill();
  }

  showScoreboard(show, data) {
    this.board.classList.toggle('hidden', !show);
    if (!show) return;
    this.board.innerHTML = data;
  }

  showTextMenu(title, items) {
    if (!title) {
      this.menu.classList.add('hidden');
      return;
    }
    this.menu.classList.remove('hidden');
    this.menu.innerHTML = `<div class="tm-title">${escapeHtml(title)}</div>` +
      items.map((it) => it.gap ? '<div class="tm-gap"></div>' : `<div class="tm-item${it.disabled ? ' off' : ''}"><b>${it.key}.</b> ${escapeHtml(it.label)}</div>`).join('');
  }
}

const KILL_NOTE_TIME = 1.6; // seconds a "You killed X" line stays
const KILL_NOTE_ALPHA = 0.72; // kept faint so it doesn't pull the eye from the crosshair

// a player's name in their team colour (HTML), with a [HACK] tag while they hack
const teamName = (p) => `<span class="${p.team === 'CT' ? 'ct' : p.team === 'T' ? 't' : 'ffa'}">${escapeHtml(p.name)}</span>` +
  (p.hacking ? ` <em class="hk">${escapeHtml(t('hackTag'))}</em>` : '');

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function weaponName(id) {
  return WEAPONS[id]?.name ?? id;
}

// Keyboard / mouse state with rebindable actions. Mouse buttons and the wheel
// use CS-style codes (MOUSE1, MWHEELUP...) so they can be bound like keys.

import { settings } from './settings.js';

const MOUSE_CODES = ['MOUSE1', 'MOUSE3', 'MOUSE2', 'MOUSE4', 'MOUSE5'];

// a text box or other control in a menu has the keys (typing a name or
// pasting a code with Ctrl+V while a match goes on)
const formControl = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

export function keyName(code) {
  if (!code) return '';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'KP_' + code.slice(6).toUpperCase();
  const map = {
    Space: 'SPACE', ControlLeft: 'CTRL', ControlRight: 'RCTRL', ShiftLeft: 'SHIFT',
    ShiftRight: 'RSHIFT', AltLeft: 'ALT', AltRight: 'RALT', Tab: 'TAB', Enter: 'ENTER',
    Backspace: 'BACKSPACE', CapsLock: 'CAPSLOCK', ArrowUp: 'UPARROW', ArrowDown: 'DOWNARROW',
    ArrowLeft: 'LEFTARROW', ArrowRight: 'RIGHTARROW', Backquote: '`', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.',
    Slash: '/', Backslash: '\\', IntlBackslash: '<', Insert: 'INS', Home: 'HOME', End: 'END',
    PageUp: 'PGUP', PageDown: 'PGDN', Delete: 'DEL',
  };
  return map[code] || code.toUpperCase();
}

export class Input {
  constructor(target) {
    this.target = target;
    this.down = new Set();
    this.pulses = new Set();   // wheel "presses" that last for one game tick
    this.pressed = [];         // codes pressed since last takePressed()
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.captureHandler = null; // UI hook: (code, event) => true to swallow
    this.gameActive = false;

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => this.down.delete(MOUSE_CODES[e.button] || 'MOUSE' + (e.button + 1)));
    window.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Chrome sometimes reports a huge bogus jump under pointer lock; drop those
      if (Math.abs(e.movementX) > 1500 || Math.abs(e.movementY) > 1500) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('contextmenu', (e) => { if (this.gameActive && !formControl(e.target)) e.preventDefault(); });
  }

  onKeyDown(e) {
    if (this.captureHandler && this.captureHandler(e.code, e)) {
      e.preventDefault();
      return;
    }
    if (!this.gameActive || formControl(e.target)) return;
    // Keep the browser from scrolling / tabbing while playing.
    if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.ctrlKey || e.altKey) e.preventDefault();
    // function keys that are bound (F1 autobuy...) shouldn't open browser help
    if (/^F\d+$/.test(e.code) && this.actionsFor(e.code).length) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    this.pulses.add(e.code); // seen by the next tick even if released before it
    this.pressed.push(e.code);
  }

  onMouseDown(e) {
    const code = MOUSE_CODES[e.button] || 'MOUSE' + (e.button + 1);
    if (this.captureHandler && this.captureHandler(code, e)) {
      e.preventDefault();
      return;
    }
    if (!this.gameActive || !this.locked) return;
    this.down.add(code);
    this.pulses.add(code);
    this.pressed.push(code);
  }

  onWheel(e) {
    if (e.deltaY === 0) return;
    const code = e.deltaY < 0 ? 'MWHEELUP' : 'MWHEELDOWN';
    if (this.captureHandler && this.captureHandler(code, e)) {
      e.preventDefault();
      return;
    }
    if (!this.gameActive || !this.locked) return;
    e.preventDefault();
    this.pulses.add(code);
    this.pressed.push(code);
  }

  isDown(action) {
    const b = settings.binds[action];
    if (!b) return false;
    for (const c of b) if (c && (this.down.has(c) || this.pulses.has(c))) return true;
    return false;
  }

  actionsFor(code) {
    const out = [];
    for (const a in settings.binds) if (settings.binds[a].includes(code)) out.push(a);
    return out;
  }

  takePressed() {
    const p = this.pressed;
    this.pressed = [];
    return p;
  }

  takeMouse() {
    const d = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  endTick() {
    this.pulses.clear();
  }

  clear() {
    this.down.clear();
    this.pulses.clear();
    this.pressed = [];
    this.mouseDX = this.mouseDY = 0;
  }
}

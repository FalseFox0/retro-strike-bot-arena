// Menu music and map ambience, both made on the spot from oscillators and
// noise (nothing is loaded from disk).
// The music is a slow, calm synth: soft pads that change chord every few
// seconds, a low bass, and now and then a bell note with an echo.
// Each map has a quiet bed of sound (desert wind, a factory hum, water and a
// breeze, a city far below) and the odd sound somewhere around you.

import { settings } from './settings.js';

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// ---------------------------------------------------------------- music

// pad voicing, bass note and bell notes for each chord
const CHORDS = [
  { bass: 45, pad: [57, 60, 64, 67, 71], bell: [76, 79, 81, 83, 84] }, // Am9
  { bass: 41, pad: [53, 57, 60, 64, 69], bell: [72, 76, 77, 79, 81] }, // Fmaj7
  { bass: 48, pad: [52, 55, 59, 62, 67], bell: [74, 76, 79, 83, 84] }, // Cmaj9
  { bass: 43, pad: [55, 59, 62, 64, 69], bell: [74, 76, 79, 81, 83] }, // G6/9
  { bass: 38, pad: [53, 57, 60, 64, 65], bell: [72, 74, 76, 77, 81] }, // Dm9
  { bass: 40, pad: [55, 59, 62, 67, 71], bell: [74, 76, 79, 83, 86] }, // Em7
];
// a few calm progressions, picked at random one after another
const PROGRESSIONS = [[0, 1, 2, 3], [0, 1, 4, 5], [4, 5, 1, 2], [0, 4, 1, 3]];
const CHORD_LEN = 9;   // seconds between chord changes
const LOOKAHEAD = 1.6; // notes are scheduled this far ahead

// a long, soft hall for the music
function hall(ctx, secs) {
  const sr = ctx.sampleRate, n = Math.floor(sr * secs);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let s = 1234 + ch * 77, y = 0;
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      const r = s / 4294967296 * 2 - 1;
      y = y * 0.6 + r * 0.4; // a little darker than white noise
      const t = i / sr;
      d[i] = y * Math.exp(-t / (secs / 5)) * Math.min(1, t / 0.03);
    }
  }
  return buf;
}

export class MenuMusic {
  constructor(sound) {
    this.sound = sound;
    this.on = false;
    this.bus = null;
    this.chords = []; // [{ t, c }] the chords scheduled, for the bells to follow
    this.prog = null;
    this.step = 0;
    this.timer = null;
  }

  setup() {
    const ctx = this.sound.ctx;
    this.out = ctx.createGain();
    this.out.connect(this.sound.master);
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(this.out);
    const verb = ctx.createConvolver();
    verb.buffer = hall(ctx, 4.5);
    const wet = ctx.createGain();
    wet.gain.value = 0.6;
    this.bus.connect(wet);
    wet.connect(verb);
    verb.connect(this.out);
    // an echo for the bells
    this.echo = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.48;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    this.echo.connect(delay);
    delay.connect(tone);
    tone.connect(fb);
    fb.connect(delay);
    tone.connect(this.bus);
  }

  // called every frame: the music plays while `want` is true (the main menu)
  update(want) {
    const ctx = this.sound.ctx;
    if (!ctx) return;
    if (!this.bus) this.setup();
    this.out.gain.value = settings.musicVolume * 0.55;
    if (want === this.on) return;
    this.on = want;
    const now = ctx.currentTime, g = this.bus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(want ? 1 : 0, now + (want ? 3 : 1.2));
    clearInterval(this.timer);
    this.timer = null;
    if (want) {
      this.next = now + 0.05;
      this.nextBell = now + 2.5;
      this.prog = null;
      // a timer rather than the frame loop keeps it going in a background tab
      this.timer = setInterval(() => this.schedule(), 250);
      this.schedule();
    }
  }

  schedule() {
    const ctx = this.sound.ctx;
    const until = ctx.currentTime + LOOKAHEAD;
    while (this.next < until) {
      this.chord(this.next);
      this.next += CHORD_LEN;
    }
    while (this.nextBell < until) {
      this.bell(this.nextBell);
      this.nextBell += 1 + Math.random() * 2.4;
    }
    this.chords = this.chords.filter((x) => x.t > ctx.currentTime - CHORD_LEN * 2);
  }

  chord(t) {
    const ctx = this.sound.ctx;
    if (!this.prog || this.step >= this.prog.length) {
      this.prog = PROGRESSIONS[(Math.random() * PROGRESSIONS.length) | 0];
      this.step = 0;
    }
    const c = CHORDS[this.prog[this.step++]];
    this.chords.push({ t, c });
    const len = CHORD_LEN + 4; // rings on into the next chord
    // pads: detuned saws through a filter that slowly opens and closes
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 0.7;
    filt.frequency.setValueAtTime(450, t);
    filt.frequency.linearRampToValueAtTime(1100 + Math.random() * 600, t + len * 0.45);
    filt.frequency.linearRampToValueAtTime(500, t + len);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.05, t + 3.5);
    env.gain.setValueAtTime(0.05, t + len - 5);
    env.gain.linearRampToValueAtTime(0, t + len);
    filt.connect(env);
    env.connect(this.bus);
    c.pad.forEach((n, i) => {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det + (Math.random() - 0.5) * 4;
        const pan = ctx.createStereoPanner();
        pan.pan.value = (i / (c.pad.length - 1) - 0.5) * 0.9 * (det > 0 ? 1 : -1);
        o.connect(pan);
        pan.connect(filt);
        o.start(t);
        o.stop(t + len + 0.05);
      }
    });
    // a soft sine bass under it
    const b = ctx.createOscillator();
    b.type = 'sine';
    b.frequency.value = midi(c.bass);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(0.13, t + 2.5);
    bg.gain.setValueAtTime(0.13, t + len - 5);
    bg.gain.linearRampToValueAtTime(0, t + len);
    b.connect(bg);
    bg.connect(this.bus);
    b.start(t);
    b.stop(t + len + 0.05);
  }

  bell(t) {
    let c = CHORDS[0];
    for (const x of this.chords) if (x.t <= t) c = x.c;
    const notes = [c.bell[(Math.random() * c.bell.length) | 0]];
    // sometimes a second note right after it
    if (Math.random() < 0.35) notes.push(c.bell[(Math.random() * c.bell.length) | 0]);
    notes.forEach((n, k) => this.ping(t + k * (0.22 + Math.random() * 0.12), midi(n), k ? 0.7 : 1));
  }

  ping(t, f, level) {
    const ctx = this.sound.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045 * level, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 2.6);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 1.1;
    g.connect(pan);
    pan.connect(this.bus);
    pan.connect(this.echo);
    for (const [mul, amp] of [[1, 1], [2, 0.22], [3.01, 0.07]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mul;
      const a = ctx.createGain();
      a.gain.value = amp;
      o.connect(a);
      a.connect(g);
      o.start(t);
      o.stop(t + 2.7);
    }
  }
}

// ---------------------------------------------------------------- ambience

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return (s / 4294967296) * 2 - 1;
  };
}

// a one-pole lowpass whose cutoff can change as it runs (the coefficient is
// only worked out again when the cutoff has moved by more than 1%)
class LP {
  constructor(sr) { this.sr = sr; this.y = 0; this.fc = -1; this.a = 0; }
  run(x, fc) {
    if (Math.abs(fc - this.fc) > this.fc * 0.01) {
      this.fc = fc;
      this.a = Math.exp((-2 * Math.PI * fc) / this.sr);
    }
    this.y = (1 - this.a) * x + this.a * this.y;
    return this.y;
  }
}

// n samples of a sound made by fn(t, r, state) -> value, plus a crossfade so it loops cleanly
function loop(sr, secs, seed, fn) {
  const n = Math.floor(sr * secs), x = Math.floor(sr * 1.5);
  const d = new Float32Array(n + x);
  const r = rng(seed), st = {};
  for (let i = 0; i < n + x; i++) d[i] = fn(i / sr, r, st);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = i < x ? d[i] * (i / x) + d[n + i] * (1 - i / x) : d[i];
  return out;
}

function oneShot(sr, secs, seed, fn) {
  const n = Math.floor(sr * secs);
  const d = new Float32Array(n);
  const r = rng(seed), st = {};
  for (let i = 0; i < n; i++) d[i] = fn(i / sr, r, st, secs);
  const fade = Math.min(n, Math.floor(sr * 0.05));
  for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
  return d;
}

const hump = (t, len) => Math.sin(Math.PI * Math.min(1, Math.max(0, t / len))) ** 2;

// the bed of each kind of place: (sr, channel) -> Float32Array
const BEDS = {
  // desert wind: a low moan that swells and fades, with a hiss of blown sand
  desert: (sr, ch) => loop(sr, 24, 11 + ch, (t, r, s) => {
    s.a ||= new LP(sr); s.b ||= new LP(sr); s.h ||= new LP(sr);
    const sw = 0.5 + 0.5 * Math.sin(t * 0.86 + ch * 1.7) * (0.6 + 0.4 * Math.sin(t * 2.1));
    const env = 0.45 + 0.3 * Math.sin(t * 0.55 + ch) + 0.15 * Math.sin(t * 2.4 + ch * 2);
    const w = s.b.run(s.a.run(r(), 220 + 420 * sw), 260 + 480 * sw) * 3.2;
    const x = r();
    const hiss = (x - s.h.run(x, 2600)) * 0.05;
    return (w + hiss * (0.4 + 0.6 * sw)) * env;
  }),
  // a softer breeze for an open aim map
  breeze: (sr, ch) => loop(sr, 20, 21 + ch, (t, r, s) => {
    s.a ||= new LP(sr); s.b ||= new LP(sr);
    const sw = 0.5 + 0.5 * Math.sin(t * 0.7 + ch * 2.3);
    return s.b.run(s.a.run(r(), 300 + 300 * sw), 400 + 300 * sw) * 1.8 * (0.35 + 0.25 * Math.sin(t * 0.45 + ch));
  }),
  // a factory hall: mains hum, the roar of air handling, a faint whine
  factory: (sr, ch) => loop(sr, 20, 31 + ch, (t, r, s) => {
    s.a ||= new LP(sr); s.b ||= new LP(sr);
    const am = 0.92 + 0.08 * Math.sin(t * 3.1 + ch);
    const hum = (Math.sin(2 * Math.PI * 50 * t) * 0.35 + Math.sin(2 * Math.PI * 100 * t + 0.4) * 0.45 + Math.sin(2 * Math.PI * 150.3 * t) * 0.18 + Math.sin(2 * Math.PI * 200 * t + 1) * 0.1) * am;
    const air = s.b.run(s.a.run(r(), 380), 380) * 2.6 * (0.85 + 0.15 * Math.sin(t * 0.3 + ch * 2));
    const whine = Math.sin(2 * Math.PI * (3150 + ch * 4) * t) * 0.006;
    return hum * 0.28 + air + whine;
  }),
  // a pool in the sun: a light breeze and water lapping at the edge
  pool: (sr, ch) => loop(sr, 20, 41 + ch, (t, r, s) => {
    s.a ||= new LP(sr); s.b ||= new LP(sr); s.w ||= new LP(sr); s.w2 ||= new LP(sr);
    if (s.next === undefined || t >= s.next) {
      s.laps ||= [];
      s.laps.push([t, 0.18 + Math.abs(r()) * 0.25, 0.5 + Math.abs(r()) * 0.6]);
      s.next = t + 0.5 + Math.abs(r()) * 1.1;
      if (s.laps.length > 4) s.laps.shift();
    }
    let lap = 0;
    for (const [t0, w, g] of s.laps) {
      const u = (t - t0) / w;
      if (u > -3 && u < 3) lap += Math.exp(-u * u) * g;
    }
    const x = r();
    const water = (s.w.run(x, 900) - s.w2.run(x, 180)) * lap * 1.6;
    const breeze = s.b.run(s.a.run(r(), 500), 600) * 1.1 * (0.3 + 0.2 * Math.sin(t * 0.5 + ch));
    return water + breeze;
  }),
  // a city far below the roofs: traffic rumble and a wind at height
  city: (sr, ch) => loop(sr, 24, 51 + ch, (t, r, s) => {
    s.br ||= 0; s.a ||= new LP(sr); s.t ||= new LP(sr); s.t2 ||= new LP(sr); s.w ||= new LP(sr);
    s.br = s.br * 0.998 + r() * 0.02; // brown noise
    const rumble = s.a.run(s.br, 160) * 9 * (0.75 + 0.25 * Math.sin(t * 0.37 + ch));
    const x = r();
    const traffic = (s.t.run(x, 1300) - s.t2.run(x, 350)) * 0.5 * (0.5 + 0.5 * Math.sin(t * 0.21 + ch * 1.3));
    const wind = s.w.run(r(), 700) * 1.1 * (0.3 + 0.25 * Math.sin(t * 0.6 + ch * 2));
    return rumble + traffic + wind;
  }),
};

// the odd sound somewhere around you
const EVENTS = {
  gust: (sr, seed) => oneShot(sr, 5, seed, (t, r, s, len) => {
    s.a ||= new LP(sr); s.b ||= new LP(sr);
    const h = hump(t, len);
    return s.b.run(s.a.run(r(), 250 + 1100 * h), 300 + 1300 * h) * 4 * h;
  }),
  // a bird of prey crying high over the desert
  hawk: (sr, seed) => oneShot(sr, 2.2, seed, (t, r, s) => {
    let v = 0;
    for (const t0 of [0, 1.05]) {
      const u = t - t0;
      if (u < 0 || u > 0.9) continue;
      const f = 2500 - 900 * (u / 0.9) + 60 * Math.sin(u * 70);
      s.ph = (s.ph || 0) + (2 * Math.PI * f) / sr;
      v += (Math.sin(s.ph) + 0.3 * Math.sin(s.ph * 2)) * hump(u, 0.9) * (t0 ? 0.7 : 1);
    }
    return v * 0.5;
  }),
  // something heavy hitting steel somewhere in the plant
  clank: (sr, seed) => oneShot(sr, 1.4, seed, (t, r) => {
    const e = Math.exp(-t / 0.35);
    return ((Math.sin(2 * Math.PI * 142 * t) * 0.6 + Math.sin(2 * Math.PI * 377 * t) * 0.35 + Math.sin(2 * Math.PI * 811 * t) * 0.2 + Math.sin(2 * Math.PI * 1490 * t) * 0.1) * e + r() * Math.exp(-t / 0.015) * 0.8) * 0.8;
  }),
  steam: (sr, seed) => oneShot(sr, 2.4, seed, (t, r, s, len) => {
    s.a ||= new LP(sr);
    const x = r();
    return (x - s.a.run(x, 1800)) * Math.min(1, t / 0.08) * Math.min(1, (len - t) / 0.9) * 0.9;
  }),
  // a press stamping: a deep thump and a clack
  press: (sr, seed) => oneShot(sr, 1.2, seed, (t, r, s) => {
    s.a ||= new LP(sr);
    const thump = Math.sin(2 * Math.PI * (55 - 15 * Math.min(1, t * 3)) * t) * Math.exp(-t / 0.18);
    const u = t - 0.32;
    const clack = u > 0 ? (s.a.run(r(), 2500) * 3 * Math.exp(-u / 0.03) + Math.sin(2 * Math.PI * 960 * u) * Math.exp(-u / 0.08) * 0.3) : 0;
    return thump * 0.9 + clack * 0.6;
  }),
  // a little bird: a quick run of chirps
  birds: (sr, seed) => {
    const r0 = rng(seed);
    const n = 3 + ((Math.abs(r0()) * 5) | 0), base = 3200 + Math.abs(r0()) * 1600, gap = 0.07 + Math.abs(r0()) * 0.08;
    return oneShot(sr, n * (gap + 0.07) + 0.2, seed + 1, (t, r, s) => {
      const k = Math.floor(t / (gap + 0.07)), u = t - k * (gap + 0.07);
      if (k >= n || u > 0.07) return 0;
      const f = base * (1 + 0.35 * (u / 0.07)) * (1 + 0.04 * k);
      s.ph = (s.ph || 0) + (2 * Math.PI * f) / sr;
      return Math.sin(s.ph) * hump(u, 0.07) * 0.5;
    });
  },
  // a car going past down on the street
  car: (sr, seed) => oneShot(sr, 4.5, seed, (t, r, s, len) => {
    s.a ||= new LP(sr); s.b ||= new LP(sr);
    const h = hump(t, len);
    const x = r();
    const tyres = (s.a.run(x, 400 + 900 * h) - s.b.run(x, 120)) * 1.5;
    const f = 95 + 30 * (1 - t / len); // the engine note drops as it passes
    s.ph = (s.ph || 0) + (2 * Math.PI * f) / sr;
    return (tyres + Math.sin(s.ph) * 0.25 + Math.sin(s.ph * 2) * 0.12) * h;
  }),
  horn: (sr, seed) => {
    const two = rng(seed)() > 0;
    return oneShot(sr, two ? 0.9 : 0.5, seed, (t, r, s) => {
      s.a ||= new LP(sr);
      const on = t < 0.35 || (two && t > 0.5 && t < 0.85);
      if (!on) return s.a.run(0, 1400);
      const sq = (f) => (Math.sin(2 * Math.PI * f * t) > 0 ? 1 : -1);
      return s.a.run((sq(415) + sq(520)) * 0.3, 1400);
    });
  },
  siren: (sr, seed) => oneShot(sr, 7, seed, (t, r, s, len) => {
    const f = 800 + 180 * Math.sin(t * 2 * Math.PI / 1.4);
    s.ph = (s.ph || 0) + (2 * Math.PI * f) / sr;
    return Math.sin(s.ph) * hump(t, len) * 0.35;
  }),
};

// each place: its bed, its level, and [event, min gap s, max gap s, distance]
const PLACES = {
  desert: { bed: 'desert', level: 0.5, events: [['gust', 7, 16, 900], ['hawk', 35, 80, 1800]] },
  breeze: { bed: 'breeze', level: 0.45, events: [['gust', 10, 22, 900]] },
  factory: { bed: 'factory', level: 0.5, events: [['clank', 6, 15, 1100], ['steam', 14, 32, 900], ['press', 9, 22, 1400]] },
  pool: { bed: 'pool', level: 0.55, events: [['birds', 3, 9, 900], ['gust', 18, 34, 900]] },
  city: { bed: 'city', level: 0.6, events: [['car', 4, 10, 1300], ['horn', 14, 40, 1700], ['siren', 70, 150, 2400]] },
};

export class Ambience {
  constructor(sound) {
    this.sound = sound;
    this.kind = null;
    this.bus = null;
    this.beds = {};   // kind -> AudioBuffer (stereo loop)
    this.shots = {};  // event -> [mono buffers]
    this.cur = null;  // { src, gain }
    this.timers = [];
  }

  setup() {
    const ctx = this.sound.ctx;
    this.bus = ctx.createGain();
    this.bus.connect(this.sound.master);
  }

  bed(name) {
    if (this.beds[name]) return this.beds[name];
    const ctx = this.sound.ctx, sr = ctx.sampleRate;
    const l = BEDS[name](sr, 0);
    // same loudness for every bed
    let m = 0;
    for (let i = 0; i < l.length; i += 7) m = Math.max(m, Math.abs(l[i]));
    for (let i = 0; i < l.length; i++) l[i] *= 0.7 / (m || 1);
    // the right ear hears the same loop from halfway through: wide, and half the work
    const n = l.length, half = n >> 1, r = new Float32Array(n);
    r.set(l.subarray(half), 0);
    r.set(l.subarray(0, half), n - half);
    const buf = ctx.createBuffer(2, n, sr);
    buf.copyToChannel(l, 0);
    buf.copyToChannel(r, 1);
    this.beds[name] = buf;
    return buf;
  }

  shot(name) {
    if (!this.shots[name]) {
      const ctx = this.sound.ctx, sr = ctx.sampleRate;
      this.shots[name] = [0, 1, 2].map((i) => {
        const d = EVENTS[name](sr, 700 + i * 37 + name.length * 5);
        let m = 0;
        for (let k = 0; k < d.length; k++) m = Math.max(m, Math.abs(d[k]));
        for (let k = 0; k < d.length; k++) d[k] *= 0.8 / (m || 1);
        const b = ctx.createBuffer(1, d.length, sr);
        b.copyToChannel(d, 0);
        return b;
      });
    }
    const list = this.shots[name];
    return list[(Math.random() * list.length) | 0];
  }

  // called every frame with the place to sound like (null: silence)
  update(kind) {
    const ctx = this.sound.ctx;
    if (!ctx) return;
    if (!this.bus) this.setup();
    this.bus.gain.value = settings.ambienceVolume;
    if (kind && !PLACES[kind]) kind = 'breeze';
    if (kind !== this.kind) this.change(kind);
    if (!kind) return;
    const now = ctx.currentTime;
    for (const ev of this.timers) {
      if (now < ev.at) continue;
      ev.at = now + ev.min + Math.random() * (ev.max - ev.min);
      this.play(ev.name, ev.dist);
    }
  }

  change(kind) {
    const ctx = this.sound.ctx, now = ctx.currentTime;
    this.kind = kind;
    if (this.cur) {
      const { src, gain } = this.cur;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 1.5);
      src.stop(now + 1.6);
      this.cur = null;
    }
    this.timers = [];
    if (!kind) return;
    const place = PLACES[kind];
    const src = ctx.createBufferSource();
    src.buffer = this.bed(place.bed);
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(place.level, now + 2.5);
    src.connect(gain);
    gain.connect(this.bus);
    // start somewhere in the loop so it never sounds the same twice
    src.start(now, Math.random() * src.buffer.duration);
    this.cur = { src, gain };
    for (const [name, min, max, dist] of place.events) {
      this.shot(name); // make the sounds now, not in the middle of a fight
      this.timers.push({ name, min, max, dist, at: now + min * 0.5 + Math.random() * (max - min) });
    }
  }

  // play a sound a long way off in a random direction from the listener
  play(name, dist) {
    const s = this.sound, ctx = s.ctx;
    if (s.lx === undefined) return;
    const a = Math.random() * Math.PI * 2, d = dist * (0.7 + Math.random() * 0.6);
    const src = ctx.createBufferSource();
    src.buffer = this.shot(name);
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    const g = ctx.createGain();
    g.gain.value = 0.55 + Math.random() * 0.3;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 500;
    p.rolloffFactor = 1;
    const x = s.lx + Math.cos(a) * d, y = s.ly + 150 + Math.random() * 300, z = s.lz + Math.sin(a) * d;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else p.setPosition(x, y, z);
    src.connect(g);
    g.connect(p);
    p.connect(this.bus);
    src.start();
  }
}

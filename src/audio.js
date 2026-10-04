// All sounds are synthesized into AudioBuffers at startup: filtered noise,
// sine thumps and clicks. Nothing is loaded from disk.

function noise(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return (s / 4294967296) * 2 - 1;
  };
}

function lp(d, sr, fc) {
  const a = Math.exp((-2 * Math.PI * fc) / sr);
  let y = 0;
  for (let i = 0; i < d.length; i++) { y = (1 - a) * d[i] + a * y; d[i] = y; }
  return d;
}

function hp(d, sr, fc) {
  const a = Math.exp((-2 * Math.PI * fc) / sr);
  let y = 0, xp = 0;
  for (let i = 0; i < d.length; i++) { const x = d[i]; y = a * (y + x - xp); xp = x; d[i] = y; }
  return d;
}

function norm(d, peak = 1) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  return d;
}

function noiseBuf(n, seed) {
  const r = noise(seed);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = r();
  return d;
}

function gunshot(sr, o) {
  const n = Math.floor(sr * o.dur);
  const out = new Float32Array(n);
  const body = norm(lp(lp(noiseBuf(n, o.seed), sr, o.bodyFc), sr, o.bodyFc));
  const crack = norm(hp(noiseBuf(n, o.seed + 1), sr, 1800));
  const tail = norm(lp(lp(noiseBuf(n, o.seed + 2), sr, o.tailFc), sr, o.tailFc));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const atk = Math.min(1, t / 0.0008);
    const f = o.boomF * (0.55 + 0.45 * Math.exp(-t / 0.03));
    phase += (2 * Math.PI * f) / sr;
    const boom = Math.sin(phase) * Math.exp(-t / o.boomDecay);
    const eTail = t < 0.012 ? t / 0.012 : Math.exp(-(t - 0.012) / o.tailDecay);
    const v = atk * (crack[i] * Math.exp(-t / 0.004) * o.crack + body[i] * Math.exp(-t / o.bodyDecay) * o.body + boom * o.boom) + tail[i] * eTail * o.tail;
    out[i] = Math.tanh(v * o.drive);
  }
  // fade the end to avoid clicks
  const fade = Math.min(n, Math.floor(sr * 0.05));
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  return norm(out, o.gain);
}

function silenced(sr, seed, gain) {
  const n = Math.floor(sr * 0.35);
  const out = new Float32Array(n);
  const puff = norm(lp(hp(noiseBuf(n, seed), sr, 700), sr, 4000));
  const click = norm(hp(noiseBuf(n, seed + 5), sr, 3000));
  const mech = norm(lp(noiseBuf(n, seed + 9), sr, 2500));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * 150) / sr;
    let v = puff[i] * Math.exp(-t / 0.022) * 0.9 + Math.sin(ph) * Math.exp(-t / 0.02) * 0.5;
    v += click[i] * Math.exp(-t / 0.002) * 0.5;
    const tm = t - 0.03;
    if (tm > 0) v += mech[i] * Math.exp(-tm / 0.01) * 0.35;
    out[i] = Math.tanh(v * 1.5);
  }
  return norm(out, gain);
}

function clicks(sr, list, dur, seed) {
  // list: [time, gain, decay, cutoff]
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const nz = noiseBuf(n, seed);
  hp(nz, sr, 1200);
  norm(nz);
  for (const [t0, g, dec, ring] of list) {
    const s0 = Math.floor(t0 * sr);
    let ph = 0;
    for (let i = s0; i < n; i++) {
      const t = (i - s0) / sr;
      const e = Math.exp(-t / dec);
      if (e < 0.001) break;
      ph += (2 * Math.PI * (ring || 2400)) / sr;
      out[i] += (nz[i] * 0.8 + Math.sin(ph) * 0.4) * e * g;
    }
  }
  return norm(out, 0.6);
}

function slide(sr, dur, seed, fc = 2200) {
  const n = Math.floor(sr * dur);
  const d = norm(lp(hp(noiseBuf(n, seed), sr, 500), sr, fc));
  for (let i = 0; i < n; i++) d[i] *= Math.sin((Math.PI * i) / n) * 0.5;
  return d;
}

function mix(sr, dur, parts) {
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  for (const [buf, at, g] of parts) {
    const s0 = Math.floor(at * sr);
    for (let i = 0; i < buf.length && s0 + i < n; i++) out[s0 + i] += buf[i] * (g ?? 1);
  }
  return out;
}

function footstep(sr, seed) {
  const n = Math.floor(sr * 0.14);
  const out = new Float32Array(n);
  const a = norm(lp(noiseBuf(n, seed), sr, 1100));
  const b = norm(hp(noiseBuf(n, seed + 3), sr, 2500));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * 95) / sr;
    let v = (a[i] * 0.9 + b[i] * 0.25) * Math.exp(-t / 0.01) + Math.sin(ph) * Math.exp(-t / 0.018) * 0.6;
    const t2 = t - 0.045;
    if (t2 > 0) v += (a[i] * 0.6 + b[i] * 0.3) * Math.exp(-t2 / 0.008) * 0.6;
    out[i] = v;
  }
  return norm(out, 0.55);
}

// Footsteps on each surface: a heel and a toe, coloured by what's underfoot.
// kind: concrete | sand | metal | grate | wood | tile | grass
function surfaceStep(sr, seed, kind) {
  const r = noise(seed * 7 + 3);
  const vary = 1 + r() * 0.08;
  const dur = { sand: 0.2, grass: 0.2, metal: 0.26, grate: 0.3, wood: 0.18, tile: 0.13 }[kind] || 0.14;
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const low = norm(lp(noiseBuf(n, seed), sr, 900));
  const high = norm(hp(noiseBuf(n, seed + 3), sr, 2500));
  const mid = norm(lp(hp(noiseBuf(n, seed + 5), sr, 700), sr, 3200));
  const soft = kind === 'grass' ? norm(lp(hp(noiseBuf(n, seed + 7), sr, 300), sr, 1800)) : null;
  // the toe lands a little after the heel
  const toe = 0.04 + r() * 0.012;
  const hit = (t) => (t < 0 ? 0 : 1);
  // metal resonances
  const modes = kind === 'grate' ? [[610, 0.09, 0.4], [1480, 0.06, 0.3], [2730, 0.05, 0.2]] : [[330, 0.07, 0.5], [870, 0.05, 0.3], [1720, 0.035, 0.2]];
  for (let i = 0; i < n; i++) {
    const t = i / sr, t2 = t - toe;
    let v = 0;
    switch (kind) {
      case 'sand': {
        // a soft crunch of grains: noise in many tiny bursts
        const grain = Math.abs(r()) > 0.82 ? 1 : 0.25;
        const env = Math.min(1, t / 0.012) * Math.exp(-t / 0.05) + hit(t2) * Math.exp(-Math.max(0, t2) / 0.04) * 0.7;
        v = mid[i] * grain * env * 0.9 + low[i] * Math.exp(-t / 0.02) * 0.35;
        break;
      }
      case 'grass': {
        const env = Math.min(1, t / 0.02) * Math.exp(-t / 0.06) + hit(t2) * Math.exp(-Math.max(0, t2) / 0.05) * 0.6;
        v = soft[i] * env * 0.6 + low[i] * Math.exp(-t / 0.018) * 0.4;
        break;
      }
      case 'metal':
      case 'grate': {
        const env = Math.exp(-t / 0.008) + hit(t2) * Math.exp(-Math.max(0, t2) / 0.008) * 0.7;
        v = (low[i] * 0.7 + high[i] * 0.3) * env;
        for (const [f, d, g] of modes) {
          v += Math.sin(2 * Math.PI * f * vary * t) * Math.exp(-t / d) * g * 0.6;
          if (t2 > 0) v += Math.sin(2 * Math.PI * f * vary * 1.03 * t2) * Math.exp(-t2 / d) * g * 0.45;
        }
        // a catwalk rattles in its frame
        if (kind === 'grate') for (const k of [0.018, 0.031, 0.062]) if (t > k) v += high[i] * Math.exp(-(t - k) / 0.004) * 0.35;
        break;
      }
      case 'wood': {
        // a hollow knock
        const env = Math.exp(-t / 0.012) + hit(t2) * Math.exp(-Math.max(0, t2) / 0.01) * 0.75;
        v = low[i] * env * 0.7 + Math.sin(2 * Math.PI * 165 * vary * t) * Math.exp(-t / 0.035) * 0.55 + Math.sin(2 * Math.PI * 420 * vary * t) * Math.exp(-t / 0.02) * 0.25;
        if (t2 > 0) v += Math.sin(2 * Math.PI * 190 * vary * t2) * Math.exp(-t2 / 0.03) * 0.4;
        break;
      }
      case 'tile': {
        // a hard, sharp click
        const env = Math.exp(-t / 0.005) + hit(t2) * Math.exp(-Math.max(0, t2) / 0.004) * 0.8;
        v = (high[i] * 0.7 + low[i] * 0.4) * env + Math.sin(2 * Math.PI * 2900 * vary * t) * Math.exp(-t / 0.012) * 0.18;
        break;
      }
      default: {
        // concrete: the original step
        v = (low[i] * 0.9 + high[i] * 0.25) * Math.exp(-t / 0.01) + Math.sin(2 * Math.PI * 95 * vary * t) * Math.exp(-t / 0.018) * 0.6;
        if (t2 > 0) v += (low[i] * 0.6 + high[i] * 0.3) * Math.exp(-t2 / 0.008) * 0.6;
      }
    }
    out[i] = v;
  }
  const fade = Math.floor(sr * 0.01);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  const gain = { sand: 0.5, grass: 0.42, metal: 0.62, grate: 0.6, wood: 0.58, tile: 0.5 }[kind] || 0.55;
  return norm(out, gain);
}

// a gun or the bomb dropping onto the floor: a clatter of metal on stone
function clatter(sr, seed) {
  const n = Math.floor(sr * 0.35);
  const out = new Float32Array(n);
  const nz = norm(hp(noiseBuf(n, seed), sr, 1200));
  const low = norm(lp(noiseBuf(n, seed + 1), sr, 500));
  const r = noise(seed + 2);
  const hits = [[0, 1], [0.05 + r() * 0.02, 0.55], [0.11 + r() * 0.03, 0.3]];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = low[i] * Math.exp(-t / 0.02) * 0.7;
    for (const [t0, g] of hits) {
      const u = t - t0;
      if (u < 0) continue;
      v += (nz[i] * Math.exp(-u / 0.004) + Math.sin(2 * Math.PI * 1850 * u) * Math.exp(-u / 0.05) * 0.4 + Math.sin(2 * Math.PI * 2930 * u) * Math.exp(-u / 0.03) * 0.25) * g;
    }
    out[i] = v;
  }
  return norm(out, 0.55);
}

function thud(sr, dur, f, seed, gain) {
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const nz = norm(lp(noiseBuf(n, seed), sr, 600));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * f * (1 - 0.4 * Math.min(1, t / dur))) / sr;
    out[i] = (Math.sin(ph) * 0.8 + nz[i] * 0.6) * Math.exp(-t / (dur * 0.25));
  }
  return norm(out, gain);
}

function ding(sr) {
  const n = Math.floor(sr * 0.45);
  const out = new Float32Array(n);
  const nz = norm(hp(noiseBuf(n, 55), sr, 2000));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] =
      Math.sin(2 * Math.PI * 1650 * t) * Math.exp(-t / 0.12) * 0.6 +
      Math.sin(2 * Math.PI * 3320 * t) * Math.exp(-t / 0.07) * 0.35 +
      Math.sin(2 * Math.PI * 4910 * t) * Math.exp(-t / 0.04) * 0.2 +
      nz[i] * Math.exp(-t / 0.003) * 0.6;
  }
  return norm(out, 0.7);
}

// kill confirmation: two soft rising notes; a headshot adds a bright metal
// ping in front and lands a step higher
function killTone(sr, notes, ping, len = 0.42) {
  const n = Math.floor(sr * len);
  const out = new Float32Array(n);
  const nz = ping ? norm(hp(noiseBuf(n, 57), sr, 3500)) : null;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    for (const [t0, f, decay, gain] of notes) {
      const u = t - t0;
      if (u < 0) continue;
      const env = Math.min(1, u / 0.004) * Math.exp(-u / decay);
      v += (Math.sin(2 * Math.PI * f * u) + 0.22 * Math.sin(4 * Math.PI * f * u)) * env * gain;
    }
    if (ping) {
      v += (Math.sin(2 * Math.PI * 2760 * t) * Math.exp(-t / 0.05) * 0.45 +
        Math.sin(2 * Math.PI * 4130 * t) * Math.exp(-t / 0.03) * 0.3 +
        nz[i] * Math.exp(-t / 0.002) * 0.5);
    }
    out[i] = v;
  }
  return norm(out, 0.8);
}

// wading through water: a swish of filtered noise with a few bubbly blips
function wade(sr, seed) {
  const n = Math.floor(sr * 0.42);
  const out = new Float32Array(n);
  const nz = norm(lp(hp(noiseBuf(n, seed), sr, 350), sr, 2600));
  const r = noise(seed + 7);
  const blips = Array.from({ length: 4 }, () => [0.04 + (r() + 1) * 0.12, 500 + (r() + 1) * 450]);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = nz[i] * Math.min(1, t / 0.04) * Math.exp(-t / 0.12);
    for (const [t0, f] of blips) {
      const u = t - t0;
      if (u > 0) v += Math.sin(2 * Math.PI * f * (1 + u * 6) * u) * Math.exp(-u / 0.025) * 0.35;
    }
    out[i] = v;
  }
  return norm(out, 0.7);
}

// a bullet into water: a sharp plip with a rising bubble
function waterHit(sr, seed) {
  const n = Math.floor(sr * 0.18);
  const out = new Float32Array(n);
  const nz = norm(hp(noiseBuf(n, seed), sr, 1500));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = nz[i] * Math.exp(-t / 0.018) * 0.7 + Math.sin(2 * Math.PI * (900 + 5000 * t) * t) * Math.exp(-t / 0.04) * 0.5;
  }
  return norm(out, 0.55);
}

// boots and hands on metal rungs
function ladderStep(sr, seed, f) {
  const n = Math.floor(sr * 0.22);
  const out = new Float32Array(n);
  const nz = norm(lp(noiseBuf(n, seed), sr, 1800));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = (Math.sin(2 * Math.PI * f * t) * 0.5 + Math.sin(2 * Math.PI * f * 2.63 * t) * 0.25) * Math.exp(-t / 0.05) + nz[i] * Math.exp(-t / 0.012) * 0.8;
  }
  return norm(out, 0.6);
}

// a wooden door on old hinges: a short creak
function creak(sr, seed, dur) {
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const r = noise(seed);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // stick-slip: a buzzy tone whose pitch wanders
    const f = 170 + 60 * Math.sin(t * 9 + 1) + 25 * Math.sin(t * 23);
    ph += (2 * Math.PI * f) / sr;
    const saw = (ph / (2 * Math.PI)) % 1 * 2 - 1;
    const env = Math.min(1, t / 0.05) * Math.min(1, (dur - t) / 0.08);
    out[i] = (saw * 0.6 + r() * 0.25) * env * (0.6 + 0.4 * Math.sin(t * 60));
  }
  return norm(lp(out, sr, 2400), 0.5);
}

// a heavy hall door rolling on its rail
function rumble(sr, seed, dur) {
  const n = Math.floor(sr * dur);
  const low = norm(lp(lp(noiseBuf(n, seed), sr, 140), sr, 140));
  const rattle = norm(hp(noiseBuf(n, seed + 1), sr, 900));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.15) * Math.min(1, (dur - t) / 0.3);
    out[i] = (low[i] * (0.8 + 0.2 * Math.sin(t * 31)) + rattle[i] * 0.12 * (0.5 + 0.5 * Math.sin(t * 47))) * env;
  }
  return norm(out, 0.75);
}

// the door hitting its stop: a deep metal clang
function clang(sr, seed) {
  const n = Math.floor(sr * 0.6);
  const out = new Float32Array(n);
  const nz = norm(lp(noiseBuf(n, seed), sr, 900));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = (Math.sin(2 * Math.PI * 118 * t) * 0.6 + Math.sin(2 * Math.PI * 307 * t) * 0.3 + Math.sin(2 * Math.PI * 611 * t) * 0.15) * Math.exp(-t / 0.18) + nz[i] * Math.exp(-t / 0.02) * 0.6;
  }
  return norm(out, 0.75);
}

function ricochet(sr, seed) {
  const r = noise(seed);
  const n = Math.floor(sr * 0.38);
  const out = new Float32Array(n);
  const f0 = 2600 + r() * 1400, f1 = 900 + r() * 500;
  const nz = norm(hp(noiseBuf(n, seed + 1), sr, 1500));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = f1 + (f0 - f1) * Math.exp(-t / 0.08);
    ph += (2 * Math.PI * f * (1 + 0.03 * Math.sin(t * 90))) / sr;
    out[i] = Math.sin(ph) * Math.exp(-t / 0.09) * 0.5 + nz[i] * Math.exp(-t / 0.006) * 0.7;
  }
  return norm(out, 0.35);
}

function impact(sr, seed, fc, gain) {
  const n = Math.floor(sr * 0.12);
  const d = norm(lp(noiseBuf(n, seed), sr, fc));
  for (let i = 0; i < n; i++) d[i] *= Math.exp(-i / sr / 0.015);
  return norm(d, gain);
}

function whoosh(sr, seed) {
  const n = Math.floor(sr * 0.24);
  const src = noiseBuf(n, seed);
  const out = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const p = i / n;
    const fc = 400 + 2600 * Math.sin(Math.PI * p);
    const a = Math.exp((-2 * Math.PI * fc) / sr);
    y = (1 - a) * src[i] + a * y;
    out[i] = y * Math.sin(Math.PI * p);
  }
  return norm(out, 0.45);
}

function metalHit(sr, seed) {
  const n = Math.floor(sr * 0.3);
  const out = new Float32Array(n);
  const nz = norm(hp(noiseBuf(n, seed), sr, 1500));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = (Math.sin(2 * Math.PI * 2250 * t) * 0.5 + Math.sin(2 * Math.PI * 3480 * t) * 0.3) * Math.exp(-t / 0.06) + nz[i] * Math.exp(-t / 0.004);
  }
  return norm(out, 0.5);
}

function beep(sr, f, dur, gain) {
  const n = Math.floor(sr * dur);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    d[i] = Math.sin(2 * Math.PI * f * t) * Math.min(1, t / 0.003) * Math.exp(-t / (dur * 0.4));
  }
  return norm(d, gain);
}

function shellTink(sr, seed) {
  const r = noise(seed);
  const n = Math.floor(sr * 0.35);
  const out = new Float32Array(n);
  const f1 = 3800 + r() * 900, f2 = 5900 + r() * 900;
  // two or three quick bounces
  const hits = [[0, 1], [0.07 + r() * 0.03, 0.45], [0.15 + r() * 0.04, 0.2]];
  for (const [t0, g] of hits) {
    const s0 = Math.floor(t0 * sr);
    for (let i = s0; i < n; i++) {
      const t = (i - s0) / sr;
      const e = Math.exp(-t / 0.035);
      if (e < 0.001) break;
      out[i] += (Math.sin(2 * Math.PI * f1 * t) * 0.6 + Math.sin(2 * Math.PI * f2 * t) * 0.4) * e * g;
    }
  }
  return norm(out, 0.3);
}

// Small room / courtyard impulse response for the reverb send.
function impulse(ctx) {
  const sr = ctx.sampleRate, len = Math.floor(sr * 1.3);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const r = noise(900 + ch * 17);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      d[i] = r() * Math.exp(-t / 0.32) * (t < 0.008 ? t / 0.008 : 1);
    }
    lp(d, sr, 3500);
    // a few early reflections off the walls
    for (const [t0, g] of [[0.019, 0.5], [0.031, 0.35], [0.047, 0.3], [0.066, 0.22]]) {
      const k = Math.floor((t0 + ch * 0.003) * sr);
      if (k < len) d[k] += g;
    }
    norm(d, 0.6);
  }
  return buf;
}

// HE grenade: a deep boom, a crack and a long rumbling tail with debris
function explosion(sr, seed) {
  const n = Math.floor(sr * 2.6);
  const out = new Float32Array(n);
  const low = norm(lp(lp(noiseBuf(n, seed), sr, 180), sr, 180));
  const mid = norm(lp(noiseBuf(n, seed + 1), sr, 1400));
  const crack = norm(hp(noiseBuf(n, seed + 2), sr, 2000));
  const debris = norm(hp(noiseBuf(n, seed + 3), sr, 2500));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * (48 + 40 * Math.exp(-t / 0.08))) / sr;
    let v = Math.sin(ph) * Math.exp(-t / 0.35) * 1.2;
    v += low[i] * Math.exp(-t / 0.7) * 1.4;
    v += mid[i] * Math.exp(-t / 0.12) * 0.9;
    v += crack[i] * Math.exp(-t / 0.01) * 0.8;
    // bits falling back down
    const td = t - 0.35;
    if (td > 0) v += debris[i] * Math.exp(-td / 0.5) * 0.12 * (0.5 + 0.5 * Math.sin(t * 61) * Math.sin(t * 23));
    out[i] = Math.tanh(v * 2.2) * Math.min(1, t / 0.002);
  }
  const fade = Math.floor(sr * 0.3);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  return norm(out, 1);
}

// flashbang: a sharp bang with a hissing high end
function flashPop(sr, seed) {
  const n = Math.floor(sr * 1.1);
  const out = new Float32Array(n);
  const hi = norm(hp(noiseBuf(n, seed), sr, 1500));
  const body = norm(lp(noiseBuf(n, seed + 1), sr, 2200));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * 140) / sr;
    const v = hi[i] * Math.exp(-t / 0.05) * 0.9 + body[i] * Math.exp(-t / 0.03) * 1 + Math.sin(ph) * Math.exp(-t / 0.04) * 0.7 + hi[i] * Math.exp(-t / 0.35) * 0.12;
    out[i] = Math.tanh(v * 2.5);
  }
  return norm(out, 0.95);
}

// smoke grenade: a long hiss that swells and dies away
function hiss(sr, seed, dur) {
  const n = Math.floor(sr * dur);
  const d = norm(lp(hp(noiseBuf(n, seed), sr, 900), sr, 6000));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    d[i] *= Math.min(1, t / 0.15) * Math.exp(-t / (dur * 0.45)) * (0.85 + 0.15 * Math.sin(t * 37));
  }
  return norm(d, 0.5);
}

// a grenade hitting the floor: a dull knock plus a short metal ring
function nadeBounce(sr, seed, ring) {
  const n = Math.floor(sr * 0.25);
  const out = new Float32Array(n);
  const nz = norm(lp(noiseBuf(n, seed), sr, 1600));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = nz[i] * Math.exp(-t / 0.012) + Math.sin(2 * Math.PI * ring * t) * Math.exp(-t / 0.05) * 0.35 + Math.sin(2 * Math.PI * ring * 1.47 * t) * Math.exp(-t / 0.03) * 0.2;
  }
  return norm(out, 0.5);
}

// the C4 going off: a deeper, longer blast with a rolling tail
function bigBlast(sr, seed) {
  const n = Math.floor(sr * 4.2);
  const out = new Float32Array(n);
  const low = norm(lp(lp(noiseBuf(n, seed), sr, 120), sr, 120));
  const mid = norm(lp(noiseBuf(n, seed + 1), sr, 900));
  const crack = norm(hp(noiseBuf(n, seed + 2), sr, 1800));
  const debris = norm(hp(noiseBuf(n, seed + 3), sr, 2200));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * (34 + 36 * Math.exp(-t / 0.12))) / sr;
    let v = Math.sin(ph) * Math.exp(-t / 0.6) * 1.4;
    v += low[i] * Math.exp(-t / 1.3) * 1.6 * (1 + 0.3 * Math.sin(t * 9));
    v += mid[i] * Math.exp(-t / 0.25) * 1.0;
    v += crack[i] * Math.exp(-t / 0.015) * 0.9;
    const td = t - 0.5;
    if (td > 0) v += debris[i] * Math.exp(-td / 0.9) * 0.14 * (0.5 + 0.5 * Math.sin(t * 47) * Math.sin(t * 19));
    out[i] = Math.tanh(v * 2.4) * Math.min(1, t / 0.003);
  }
  const fade = Math.floor(sr * 0.5);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  return norm(out, 1);
}

// breaking glass: a crack and a shower of high tinkles
function glassBreak(sr, seed) {
  const r = noise(seed);
  const n = Math.floor(sr * 0.9);
  const out = new Float32Array(n);
  const hi = norm(hp(noiseBuf(n, seed + 1), sr, 3000));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = hi[i] * Math.exp(-t / 0.03) * 1.1;
  }
  for (let k = 0; k < 26; k++) {
    const t0 = 0.02 + Math.pow((r() + 1) / 2, 1.6) * 0.75;
    const f = 2800 + ((r() + 1) / 2) * 4200, g = 0.15 + ((r() + 1) / 2) * 0.35;
    const s0 = Math.floor(t0 * sr);
    for (let i = s0; i < n; i++) {
      const t = (i - s0) / sr;
      const e = Math.exp(-t / 0.025);
      if (e < 0.002) break;
      out[i] += Math.sin(2 * Math.PI * f * t) * e * g * (1 - t0);
    }
  }
  return norm(out, 0.75);
}

// splintering wood
function woodBreak(sr, seed) {
  const n = Math.floor(sr * 0.6);
  const out = new Float32Array(n);
  const nz = norm(lp(noiseBuf(n, seed), sr, 1800));
  const cr = norm(hp(noiseBuf(n, seed + 1), sr, 1200));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = nz[i] * Math.exp(-t / 0.05) * 1.1 + cr[i] * Math.exp(-t / 0.02) * 0.6;
    for (const [t0, g] of [[0.09, 0.5], [0.17, 0.35], [0.29, 0.25]]) if (t > t0) v += nz[i] * Math.exp(-(t - t0) / 0.025) * g;
    out[i] = v;
  }
  return norm(out, 0.7);
}

// a short radio squelch: band-limited hiss and a click
function squelch(sr, seed, len) {
  const n = Math.floor(sr * len);
  const d = norm(lp(hp(noiseBuf(n, seed), sr, 1200), sr, 4200));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    d[i] = d[i] * 0.5 * Math.min(1, t / 0.005) * (1 - t / len) + (i < 40 ? (40 - i) / 40 * 0.6 : 0);
  }
  return norm(d, 0.35);
}

const MAX_VOICES = 28;

const GUNS = {
  ak47: { dur: 0.9, seed: 11, bodyFc: 2300, bodyDecay: 0.06, crack: 0.6, body: 1, boomF: 92, boom: 0.95, boomDecay: 0.06, tail: 0.38, tailFc: 700, tailDecay: 0.22, drive: 2.3, gain: 0.95 },
  m4a1: { dur: 0.8, seed: 21, bodyFc: 3300, bodyDecay: 0.045, crack: 0.75, body: 0.9, boomF: 112, boom: 0.7, boomDecay: 0.05, tail: 0.32, tailFc: 900, tailDecay: 0.18, drive: 2.0, gain: 0.9 },
  awp: { dur: 1.7, seed: 31, bodyFc: 1600, bodyDecay: 0.1, crack: 0.85, body: 1, boomF: 62, boom: 1.25, boomDecay: 0.12, tail: 0.55, tailFc: 480, tailDecay: 0.45, drive: 2.7, gain: 1 },
  deagle: { dur: 0.95, seed: 41, bodyFc: 2000, bodyDecay: 0.07, crack: 0.9, body: 1, boomF: 84, boom: 1, boomDecay: 0.07, tail: 0.38, tailFc: 650, tailDecay: 0.26, drive: 2.4, gain: 0.95 },
  glock18: { dur: 0.5, seed: 51, bodyFc: 3600, bodyDecay: 0.03, crack: 0.8, body: 0.8, boomF: 140, boom: 0.5, boomDecay: 0.03, tail: 0.2, tailFc: 1000, tailDecay: 0.12, drive: 1.8, gain: 0.72 },
  usp: { dur: 0.55, seed: 61, bodyFc: 3000, bodyDecay: 0.035, crack: 0.7, body: 0.9, boomF: 120, boom: 0.6, boomDecay: 0.04, tail: 0.22, tailFc: 900, tailDecay: 0.14, drive: 1.9, gain: 0.78 },
  p228: { dur: 0.55, seed: 63, bodyFc: 3200, bodyDecay: 0.033, crack: 0.8, body: 0.85, boomF: 128, boom: 0.55, boomDecay: 0.035, tail: 0.22, tailFc: 950, tailDecay: 0.13, drive: 1.9, gain: 0.76 },
  elite: { dur: 0.5, seed: 65, bodyFc: 3400, bodyDecay: 0.03, crack: 0.85, body: 0.8, boomF: 135, boom: 0.5, boomDecay: 0.03, tail: 0.2, tailFc: 1000, tailDecay: 0.12, drive: 1.8, gain: 0.74 },
  fiveseven: { dur: 0.5, seed: 67, bodyFc: 4200, bodyDecay: 0.028, crack: 0.95, body: 0.75, boomF: 150, boom: 0.45, boomDecay: 0.03, tail: 0.2, tailFc: 1200, tailDecay: 0.12, drive: 1.9, gain: 0.72 },
  m3: { dur: 1.1, seed: 71, bodyFc: 1500, bodyDecay: 0.09, crack: 0.5, body: 1.1, boomF: 70, boom: 1.2, boomDecay: 0.09, tail: 0.45, tailFc: 520, tailDecay: 0.3, drive: 2.6, gain: 1 },
  xm1014: { dur: 1.0, seed: 73, bodyFc: 1700, bodyDecay: 0.08, crack: 0.55, body: 1.05, boomF: 76, boom: 1.1, boomDecay: 0.08, tail: 0.42, tailFc: 560, tailDecay: 0.27, drive: 2.5, gain: 0.98 },
  mac10: { dur: 0.55, seed: 75, bodyFc: 2600, bodyDecay: 0.035, crack: 0.6, body: 0.95, boomF: 110, boom: 0.6, boomDecay: 0.04, tail: 0.22, tailFc: 800, tailDecay: 0.13, drive: 2.0, gain: 0.78 },
  mp5navy: { dur: 0.55, seed: 77, bodyFc: 3400, bodyDecay: 0.032, crack: 0.7, body: 0.85, boomF: 130, boom: 0.5, boomDecay: 0.035, tail: 0.22, tailFc: 1000, tailDecay: 0.13, drive: 1.9, gain: 0.76 },
  ump45: { dur: 0.6, seed: 79, bodyFc: 2400, bodyDecay: 0.04, crack: 0.6, body: 0.95, boomF: 100, boom: 0.7, boomDecay: 0.045, tail: 0.25, tailFc: 750, tailDecay: 0.15, drive: 2.0, gain: 0.8 },
  p90: { dur: 0.55, seed: 81, bodyFc: 4000, bodyDecay: 0.03, crack: 0.85, body: 0.8, boomF: 140, boom: 0.45, boomDecay: 0.03, tail: 0.22, tailFc: 1100, tailDecay: 0.13, drive: 1.9, gain: 0.74 },
  galil: { dur: 0.85, seed: 83, bodyFc: 2900, bodyDecay: 0.05, crack: 0.7, body: 0.95, boomF: 104, boom: 0.8, boomDecay: 0.055, tail: 0.34, tailFc: 820, tailDecay: 0.2, drive: 2.1, gain: 0.9 },
  famas: { dur: 0.8, seed: 85, bodyFc: 3500, bodyDecay: 0.045, crack: 0.8, body: 0.9, boomF: 115, boom: 0.7, boomDecay: 0.05, tail: 0.3, tailFc: 950, tailDecay: 0.18, drive: 2.0, gain: 0.88 },
  sg552: { dur: 0.85, seed: 87, bodyFc: 3100, bodyDecay: 0.048, crack: 0.75, body: 0.92, boomF: 108, boom: 0.75, boomDecay: 0.05, tail: 0.33, tailFc: 880, tailDecay: 0.19, drive: 2.05, gain: 0.9 },
  aug: { dur: 0.85, seed: 89, bodyFc: 3200, bodyDecay: 0.046, crack: 0.75, body: 0.9, boomF: 112, boom: 0.72, boomDecay: 0.05, tail: 0.32, tailFc: 900, tailDecay: 0.19, drive: 2.0, gain: 0.9 },
  scout: { dur: 1.3, seed: 91, bodyFc: 2400, bodyDecay: 0.07, crack: 0.95, body: 0.9, boomF: 80, boom: 0.95, boomDecay: 0.08, tail: 0.45, tailFc: 600, tailDecay: 0.34, drive: 2.4, gain: 0.95 },
  g3sg1: { dur: 1.2, seed: 93, bodyFc: 2000, bodyDecay: 0.075, crack: 0.8, body: 1, boomF: 76, boom: 1.05, boomDecay: 0.08, tail: 0.45, tailFc: 560, tailDecay: 0.32, drive: 2.5, gain: 0.97 },
  sg550: { dur: 1.1, seed: 95, bodyFc: 2600, bodyDecay: 0.065, crack: 0.85, body: 0.95, boomF: 88, boom: 0.95, boomDecay: 0.07, tail: 0.42, tailFc: 640, tailDecay: 0.3, drive: 2.4, gain: 0.95 },
  m249: { dur: 0.85, seed: 97, bodyFc: 2700, bodyDecay: 0.05, crack: 0.65, body: 1, boomF: 98, boom: 0.85, boomDecay: 0.055, tail: 0.34, tailFc: 780, tailDecay: 0.2, drive: 2.2, gain: 0.92 },
};

export class SoundSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffers = new Map();
    this.volume = 0.7;
    this.voices = 0;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // A 30 ms buffer instead of the smallest one (10 ms): a busy computer
    // couldn't always refill the small one in time, which crackled.
    this.ctx = new AC({ latencyHint: 0.03 });
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -8;
    comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = impulse(this.ctx);
    this.reverbIn = this.ctx.createGain();
    this.reverbIn.gain.value = 1;
    this.reverbIn.connect(this.reverb);
    this.reverb.connect(this.master);
    this.jobs = [];
    this.generate();
    const work = () => {
      this.pump(10);
      if (this.jobs.length) setTimeout(work, 16);
    };
    work();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  add(name, data) {
    const b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    b.copyToChannel(data, 0);
    if (!this.buffers.has(name)) this.buffers.set(name, []);
    this.buffers.get(name).push(b);
  }

  // Making every sound takes about a second, so it's done a few at a time
  // in the background (menu sounds first); finish() does the rest at once.
  generate() {
    const sr = this.ctx.sampleRate;
    const J = (fn) => this.jobs.push(fn);
    J(() => this.add('ui_click', beep(sr, 1200, 0.03, 0.25)));
    J(() => this.add('ui_hover', beep(sr, 1800, 0.015, 0.08)));
    for (const id in GUNS) J(() => this.add(id, gunshot(sr, GUNS[id])));
    J(() => this.add('m4a1_sil', silenced(sr, 71, 0.5)));
    J(() => this.add('usp_sil', silenced(sr, 81, 0.42)));
    J(() => this.add('tmp', silenced(sr, 91, 0.46)));
    J(() => this.add('pump', mix(sr, 0.5, [[slide(sr, 0.16, 214, 1800), 0, 0.9], [clicks(sr, [[0, 1, 0.007, 1700]], 0.1, 215), 0.15], [slide(sr, 0.14, 216, 2000), 0.22, 0.8], [clicks(sr, [[0, 0.9, 0.006, 2100]], 0.1, 217), 0.34]])));
    J(() => this.add('shell_insert', mix(sr, 0.25, [[slide(sr, 0.08, 218, 1500), 0, 0.6], [clicks(sr, [[0, 0.8, 0.006, 1500]], 0.1, 219), 0.07]])));
    J(() => this.add('pinpull', mix(sr, 0.3, [[clicks(sr, [[0, 0.7, 0.01, 3200], [0.05, 0.5, 0.02, 4100]], 0.25, 220), 0]])));
    J(() => this.add('throw', whoosh(sr, 602)));
    for (let i = 0; i < 2; i++) J(() => this.add('nade_bounce', nadeBounce(sr, 230 + i, 900 + i * 140)));
    for (let i = 0; i < 2; i++) J(() => this.add('nade_bounce2', nadeBounce(sr, 240 + i, 1500 + i * 180)));
    J(() => this.add('explode', explosion(sr, 250)));
    J(() => this.add('explode', explosion(sr, 260)));
    J(() => this.add('flash_explode', flashPop(sr, 270)));
    J(() => this.add('smoke_hiss', hiss(sr, 280, 3.2)));
    for (let i = 0; i < 4; i++) J(() => this.add('step', footstep(sr, 100 + i * 7)));
    for (const kind of ['concrete', 'sand', 'metal', 'grate', 'wood', 'tile', 'grass']) {
      for (let i = 0; i < 4; i++) J(() => this.add('step_' + kind, kind === 'concrete' ? footstep(sr, 100 + i * 7) : surfaceStep(sr, 130 + i * 11 + kind.length * 101, kind)));
    }
    for (let i = 0; i < 3; i++) J(() => this.add('item_land', clatter(sr, 940 + i * 3)));
    for (let i = 0; i < 2; i++) J(() => this.add('item_kick', mix(sr, 0.3, [[slide(sr, 0.18, 950 + i, 2600), 0, 0.7], [clicks(sr, [[0, 0.7, 0.01, 1900]], 0.1, 952 + i), 0.0]])));
    J(() => this.add('land', thud(sr, 0.18, 70, 140, 0.6)));
    J(() => this.add('clipout', mix(sr, 0.3, [[clicks(sr, [[0, 1, 0.006, 2600]], 0.3, 201), 0], [slide(sr, 0.12, 202), 0.02, 0.8]])));
    J(() => this.add('clipin', mix(sr, 0.3, [[slide(sr, 0.1, 203, 1600), 0, 0.7], [clicks(sr, [[0, 1, 0.01, 1800]], 0.2, 204), 0.09]])));
    J(() => this.add('boltpull', mix(sr, 0.45, [[clicks(sr, [[0, 1, 0.006, 2200]], 0.2, 205), 0], [slide(sr, 0.14, 206), 0.03, 0.9], [clicks(sr, [[0, 1, 0.008, 1900]], 0.2, 207), 0.22]])));
    J(() => this.add('deploy', mix(sr, 0.3, [[slide(sr, 0.14, 208), 0, 0.8], [clicks(sr, [[0, 0.6, 0.005, 2800]], 0.1, 209), 0.12]])));
    J(() => this.add('dryfire', clicks(sr, [[0, 1, 0.004, 3000]], 0.06, 210)));
    J(() => this.add('zoom', clicks(sr, [[0, 0.7, 0.003, 4000]], 0.05, 211)));
    J(() => this.add('silencer', mix(sr, 0.5, [[slide(sr, 0.3, 212, 1300), 0, 0.6], [clicks(sr, [[0, 1, 0.006, 2100]], 0.1, 213), 0.3]])));
    J(() => this.add('hit_flesh', thud(sr, 0.12, 80, 300, 0.7)));
    J(() => this.add('hit_flesh', thud(sr, 0.12, 95, 301, 0.7)));
    J(() => this.add('hit_helmet', ding(sr)));
    J(() => this.add('death', thud(sr, 0.35, 55, 320, 0.8)));
    J(() => this.add('kill', killTone(sr, [[0, 1046.5, 0.06, 0.55], [0.06, 1568, 0.11, 0.6]], false)));
    J(() => this.add('kill_hs', killTone(sr, [[0.02, 1568, 0.06, 0.5], [0.075, 2349.3, 0.12, 0.6]], true)));
    J(() => this.add('levelup', killTone(sr, [[0.12, 784, 0.07, 0.45], [0.19, 1046.5, 0.07, 0.5], [0.26, 1318.5, 0.07, 0.55], [0.33, 1568, 0.16, 0.65]], false, 0.62)));
    for (let i = 0; i < 3; i++) J(() => this.add('ric', ricochet(sr, 400 + i * 13)));
    J(() => this.add('imp_concrete', impact(sr, 500, 3500, 0.35)));
    J(() => this.add('imp_wood', impact(sr, 501, 1200, 0.4)));
    J(() => this.add('imp_metal', metalHit(sr, 502)));
    J(() => this.add('slash', whoosh(sr, 600)));
    J(() => this.add('slash', whoosh(sr, 601)));
    J(() => this.add('stab', thud(sr, 0.2, 70, 610, 0.8)));
    J(() => this.add('knife_wall', metalHit(sr, 620)));
    J(() => this.add('round_start', beep(sr, 880, 0.25, 0.25)));
    for (let i = 0; i < 3; i++) J(() => this.add('shell', shellTink(sr, 700 + i * 11)));
    // bomb defusal
    J(() => this.add('buy', mix(sr, 0.35, [[clicks(sr, [[0, 1, 0.006, 2400], [0.07, 0.7, 0.01, 1800]], 0.3, 801), 0], [slide(sr, 0.12, 802, 1600), 0.1, 0.6]])));
    J(() => this.add('pickup', mix(sr, 0.3, [[clicks(sr, [[0, 0.9, 0.008, 2000]], 0.2, 803), 0], [slide(sr, 0.1, 804, 1400), 0.05, 0.5]])));
    J(() => this.add('c4_key', beep(sr, 1320, 0.07, 0.4)));
    J(() => this.add('c4_key', beep(sr, 1480, 0.07, 0.4)));
    J(() => this.add('c4_plant', mix(sr, 0.5, [[clicks(sr, [[0, 1, 0.012, 1500], [0.12, 0.8, 0.01, 1900]], 0.3, 805), 0], [beep(sr, 2000, 0.12, 0.5), 0.25]])));
    J(() => this.add('c4_beep', beep(sr, 2350, 0.11, 0.6)));
    J(() => this.add('c4_disarm', mix(sr, 0.6, [[slide(sr, 0.2, 806, 1800), 0, 0.7], [clicks(sr, [[0, 1, 0.006, 2600], [0.25, 0.8, 0.006, 3000]], 0.4, 807), 0.15]])));
    J(() => this.add('c4_defused', mix(sr, 0.6, [[clicks(sr, [[0, 1, 0.01, 1700]], 0.2, 808), 0], [beep(sr, 1000, 0.3, 0.45), 0.08]])));
    J(() => this.add('c4_explode', bigBlast(sr, 810)));
    J(() => this.add('glass_break', glassBreak(sr, 820)));
    J(() => this.add('glass_break', glassBreak(sr, 821)));
    J(() => this.add('wood_break', woodBreak(sr, 830)));
    J(() => this.add('metal_break', metalHit(sr, 840)));
    J(() => this.add('imp_glass', mix(sr, 0.2, [[clicks(sr, [[0, 0.8, 0.004, 5200]], 0.1, 850), 0], [beep(sr, 4100, 0.08, 0.2), 0]])));
    J(() => this.add('radio_on', squelch(sr, 860, 0.12)));
    J(() => this.add('radio_off', squelch(sr, 861, 0.18)));
    J(() => this.add('fallpain', thud(sr, 0.3, 60, 870, 0.9)));
    for (let i = 0; i < 3; i++) J(() => this.add('wade', wade(sr, 880 + i * 5)));
    for (let i = 0; i < 2; i++) J(() => this.add('imp_water', waterHit(sr, 900 + i)));
    for (let i = 0; i < 3; i++) J(() => this.add('ladder', ladderStep(sr, 910 + i, 380 + i * 70)));
    J(() => this.add('door_open', mix(sr, 0.65, [[clicks(sr, [[0, 1, 0.01, 1900]], 0.1, 920), 0], [creak(sr, 921, 0.5), 0.06, 0.8]])));
    J(() => this.add('door_close', mix(sr, 0.5, [[thud(sr, 0.3, 85, 922, 0.9), 0], [clicks(sr, [[0, 1, 0.012, 1700]], 0.1, 923), 0.03, 0.7]])));
    J(() => this.add('door_slide', mix(sr, 1.8, [[clicks(sr, [[0, 1, 0.02, 900]], 0.1, 924), 0], [rumble(sr, 925, 1.7), 0.05]])));
    J(() => this.add('door_stop', clang(sr, 926)));
  }

  // run queued sound jobs for up to ms milliseconds
  pump(ms) {
    const until = performance.now() + ms;
    while (this.jobs.length && performance.now() < until) this.jobs.shift()();
  }

  // everything made now (a match is about to start)
  finish() {
    if (this.ctx) this.pump(1e9);
  }

  // opts: pos {x,y,z}, volume, rate, ref (reference distance), delay, reverb (send level)
  play(name, opts = {}) {
    if (!this.ctx) return;
    const list = this.buffers.get(name);
    if (!list) return;
    // Cap simultaneous world sounds so big firefights don't flood the audio
    // thread. Nearby sounds (footsteps of someone close!) always get through.
    let dist = 0;
    if (opts.pos && this.lx !== undefined) dist = Math.hypot(opts.pos.x - this.lx, opts.pos.y - this.ly, opts.pos.z - this.lz);
    if (opts.pos && this.voices >= MAX_VOICES && (dist > 700 || this.voices >= MAX_VOICES * 2)) return;
    // too far away to be heard over the rest: don't give the audio thread the work
    const ref = opts.ref ?? 200;
    if (opts.pos && dist > ref && (opts.volume ?? 1) * ref / (ref + (opts.rolloff ?? 1) * (dist - ref)) < 0.012) return;
    const src = this.ctx.createBufferSource();
    this.voices++;
    src.onended = () => { this.voices--; };
    src.buffer = list[(Math.random() * list.length) | 0];
    src.playbackRate.value = opts.rate ?? 1;
    const g = this.ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    let head = src;
    if (opts.pos && this.lx !== undefined) {
      // far away sounds lose their high end
      if (dist > 300) {
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = Math.max(900, 18000 * Math.exp(-(dist - 300) / 900));
        src.connect(f);
        head = f;
      }
    }
    head.connect(g);
    if (opts.reverb && this.reverbIn) {
      const send = this.ctx.createGain();
      send.gain.value = opts.reverb;
      g.connect(send);
      send.connect(this.reverbIn);
    }
    if (opts.pos) {
      const p = this.ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = opts.ref ?? 200;
      p.maxDistance = 10000;
      p.rolloffFactor = opts.rolloff ?? 1;
      if (p.positionX) {
        p.positionX.value = opts.pos.x;
        p.positionY.value = opts.pos.y;
        p.positionZ.value = opts.pos.z;
      } else {
        p.setPosition(opts.pos.x, opts.pos.y, opts.pos.z);
      }
      g.connect(p);
      p.connect(this.master);
    } else {
      g.connect(this.master);
    }
    src.start(this.ctx.currentTime + (opts.delay ?? 0));
  }

  setListener(px, py, pz, fx, fy, fz) {
    if (!this.ctx) return;
    this.lx = px; this.ly = py; this.lz = pz;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = px; l.positionY.value = py; l.positionZ.value = pz;
      l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(px, py, pz);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }
}

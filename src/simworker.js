// Bot Arena's background matches: a worker thread that plays one match at a
// time with the real game code and nothing drawn, as fast as it can, and
// reports how it went. The menus run several of these at once (arenarun.js).
//
// Messages in:  { type: 'run', spec } (a match from arena.js), { type: 'stop' }
// Messages out: { type: 'ready' }, { type: 'done', n, result, ms },
//               { type: 'error', n, message }

// The game modules expect a page around them; give them the little they use
// (nothing is drawn here, so no real canvas or sound is needed).
self.window = self;
self.document = { createElement: () => new OffscreenCanvas(1, 1), documentElement: {} };

const THREE = await import('../lib/three.module.js');
const { Game } = await import('./game.js');
const { buildWorld } = await import('./map.js');
const { TICK } = await import('./config.js');
const { Recorder } = await import('./highlights.js');

// a stand-in for the HUD, sounds, effects, input and the rest: does nothing
const noop = () => {};
const stub = () => new Proxy({}, { get: (o, k) => (k in o ? o[k] : noop) });

const maps = new Map();
const mapFor = (name) => {
  if (!maps.has(name)) maps.set(name, buildWorld(name));
  return maps.get(name);
};

let ended = false;
const game = new Game({
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(74, 4 / 3, 1, 10000),
  map: mapFor('aim_classic'),
  effects: stub(), hud: stub(), soundSys: stub(), input: stub(), viewModel: stub(), ui: stub(),
  textures: { headless: true },
  headless: true,
  hooks: {
    onMatchEnd() {
      ended = true;
    },
  },
});

let stopping = false;
const pause = () => new Promise((r) => setTimeout(r, 0));

async function run(spec) {
  const t0 = performance.now();
  game.setMap(mapFor(spec.map));
  ended = false;
  game.start(spec.cfg);
  // highlights: the match is written down as it goes
  game.recorder = new Recorder(game, spec);
  // a safety net: no match is allowed more than this much game time
  const maxTicks = Math.round((95 * 60) / TICK);
  let ticks = 0, slice = performance.now();
  while (!ended && ticks < maxTicks) {
    game.tick(TICK);
    ticks++;
    // now and then let messages in (a stop)
    if ((ticks & 255) === 0 && performance.now() - slice > 200) {
      await pause();
      slice = performance.now();
      if (stopping) break;
    }
  }
  if (!ended && !stopping) game.endMatch();
  const result = stopping ? null : game.arenaResult();
  if (result) result.clips = game.recorder ? game.recorder.finish(result) : [];
  game.stop();
  return { result, ms: performance.now() - t0 };
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'stop') {
    stopping = true;
    return;
  }
  if (m.type !== 'run') return;
  stopping = false;
  try {
    const { result, ms } = await run(m.spec);
    // the recordings travel without being copied
    if (result) self.postMessage({ type: 'done', n: m.spec.n, result, ms }, result.clips.map((c) => c.clip.data.buffer));
    else self.postMessage({ type: 'stopped', n: m.spec.n });
  } catch (err) {
    try {
      game.stop();
    } catch (e2) {
      // the game was half set up; the next start cleans up
    }
    self.postMessage({ type: 'error', n: m.spec.n, message: String(err && err.stack || err) });
  }
};

self.postMessage({ type: 'ready' });

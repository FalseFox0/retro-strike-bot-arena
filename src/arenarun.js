// Bot Arena's battle runner: hands a battle's matches to a pool of
// background workers (simworker.js), takes in what comes back (stats,
// ratings, practice, evolution: arena.js) and keeps the save stored.
// One match at a time can also be played in the page, to watch it.

import { Battle, applyResult, saveStore } from './arena.js';
import { compSource } from './arenaevents.js';
import { fixComps } from './league.js';
import { matchNews, generationNews } from './news.js';
import { keepClip, minScore } from './clipstore.js';

const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
// leave a couple of cores for the page (and the match you watch)
export const MAX_WORKERS = Math.max(1, Math.min(16, cores));
export const DEFAULT_WORKERS = Math.max(1, Math.min(12, cores - 2));

// can the page still load the game's files? (a thread that can't start most
// likely means the game's server, start.bat, was closed)
const serverUp = () => fetch(new URL('./config.js', import.meta.url), { cache: 'no-store' }).then((r) => r.ok, () => false);

export class ArenaRunner {
  constructor(store) {
    this.store = store;
    this.state = 'idle'; // idle | starting | running | paused
    this.save = null;
    this.src = null;     // where the matches come from: a Battle, or a season / cup (CompSource)
    this.kind = 'battle'; // 'battle' | 'season' | 'cup'
    this.workers = [];
    this.listeners = new Set();
    this.done = 0;       // matches finished in this battle
    this.total = 0;
    this.errors = 0;
    this.lastError = '';
    this.failRun = 0;    // failures since the last match that worked
    this.stuck = false;  // paused: matches kept failing
    this.offline = false; // paused: the game's server can't be reached
    this.wanted = 0;     // how many threads should play
    this.runId = 0;      // which battle (answers that come late are dropped)
    this.times = [];     // when recent matches finished (speed, time left)
    this.recent = [];    // the last few results, for the battle screen
    this.live = null;    // the match being watched in the page
    this.autoPaused = false;
    this.saveTimer = 0;
    this.watchFull = 0;  // while a match is watched: the threads to go back to after
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(ev) {
    for (const fn of this.listeners) fn(ev);
  }

  busy() {
    return this.state !== 'idle';
  }

  // a new battle on this save with its setup (save.setup); `workers` threads
  start(save, workers) {
    this.stop();
    this.save = save;
    this.kind = 'battle';
    this.src = new Battle(save, save.setup);
    this.total = this.src.total;
    this.done = 0;
    this.errors = 0;
    this.lastError = '';
    this.times = [];
    this.recent = [];
    save.run = { total: this.total, done: 0 };
    this.begin(workers);
  }

  // carry on with the rest of a battle that was stopped (or cut off by closing the page)
  resumeSaved(save, workers) {
    const left = save.run ? save.run.total - save.run.done : 0;
    if (left <= 0) return false;
    const setup = { ...save.setup, count: left };
    this.stop();
    this.save = save;
    this.kind = 'battle';
    this.src = new Battle(save, setup);
    this.total = save.run.total;
    this.done = save.run.done;
    this.src.total = left;
    this.errors = 0;
    this.lastError = '';
    this.times = [];
    this.recent = [];
    this.begin(workers);
    return true;
  }

  // play a season's or a cup's matches (what's ready to be played)
  startComp(save, workers, kind) {
    this.stop();
    // nothing plays now: a match still marked as playing waits again
    fixComps(save);
    this.save = save;
    this.kind = kind;
    this.src = compSource(save, kind);
    this.done = 0;
    this.total = 0;
    this.errors = 0;
    this.lastError = '';
    this.times = [];
    this.recent = [];
    this.begin(workers);
    // nothing to play (a knockout round that waits): over at once
    this.checkEnd();
  }

  // the bar: a battle counts its matches, a competition its stage
  progress() {
    return this.src?.progress ? this.src.progress() : { done: this.done, total: this.total };
  }

  begin(workers) {
    this.runId++;
    this.watchFull = 0;
    this.failRun = 0;
    this.stuck = this.offline = false;
    this.wanted = workers;
    this.state = 'running';
    this.spawn(workers);
    this.emit({ type: 'state' });
  }

  spawn(n) {
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./simworker.js', import.meta.url), { type: 'module' });
      w.ready = false;
      w.job = null;
      w.onmessage = (e) => this.message(w, e.data);
      w.onerror = (e) => {
        e.preventDefault();
        const msg = (e.message || 'worker error') + (e.filename ? ` @${e.filename}:${e.lineno}` : '');
        if (w.ready) this.fail(w, msg);
        else this.loadFailed(w, msg);
      };
      this.workers.push(w);
    }
  }

  // as many threads as wanted (after some were let go)
  topUp() {
    if (this.state !== 'running') return;
    const live = this.workers.filter((w) => !w.retiring).length;
    if (live < this.wanted) this.spawn(this.wanted - live);
  }

  // how many threads play; changing it mid-battle adds or retires some
  setWorkers(n) {
    this.wanted = n;
    if (this.state === 'idle') return;
    const live = this.workers.filter((w) => !w.retiring);
    if (n > live.length) this.topUp();
    else {
      for (const w of live.slice(n)) {
        w.retiring = true;
        if (!w.job) this.retire(w);
      }
    }
    this.emit({ type: 'state' });
  }

  // A match (or a highlight) is watched in the page: half the threads play
  // meanwhile, so it runs smoothly; all of them again once it's left.
  setWatching(on) {
    if (on) {
      if (this.watchFull || this.state === 'idle' || this.wanted < 2) return;
      this.watchFull = this.wanted;
      this.setWorkers(Math.floor(this.wanted / 2));
    } else {
      const n = this.watchFull;
      this.watchFull = 0;
      if (n && this.state !== 'idle') this.setWorkers(n);
    }
  }

  retire(w) {
    w.terminate();
    this.workers = this.workers.filter((x) => x !== w);
  }

  // threads started but not ready yet (they load the game first)
  starting() {
    return this.workers.filter((w) => !w.ready && !w.retiring).length;
  }

  message(w, m) {
    if (m.type === 'ready') {
      w.ready = true;
      this.feed(w);
      this.emit({ type: 'ready' });
      return;
    }
    const spec = w.job;
    w.job = null;
    if (m.type === 'done' && spec && this.save) {
      this.failRun = 0;
      this.take(spec, m.result, m.ms);
    } else if (m.type === 'error') {
      this.fail(w, m.message, spec);
      return;
    }
    if (w.retiring) this.retire(w);
    else this.feed(w);
    this.checkEnd();
  }

  // a match that went wrong is skipped (its slot goes back to the battle) and
  // a fresh thread takes over (whatever broke can't carry over)
  fail(w, message, spec = w.job) {
    w.job = null;
    if (spec && this.src) this.src.drop(spec);
    this.retire(w);
    this.problem(message);
    this.topUp();
    this.checkEnd();
  }

  // a thread that couldn't even start
  async loadFailed(w, message) {
    this.retire(w);
    const id = this.runId;
    const up = await serverUp();
    if (id !== this.runId || this.state === 'idle') return;
    if (!up) {
      // the game's server is gone: nothing can start until it's back
      if (!this.offline) {
        this.offline = true;
        this.halt();
      }
      return;
    }
    this.problem(message);
    setTimeout(() => { if (id === this.runId) this.topUp(); }, 1000);
  }

  // one more failure; when they keep coming, something is broken: pause
  problem(message) {
    this.errors++;
    this.failRun++;
    this.lastError = String(message).slice(0, 2000);
    console.warn('Bot Arena match failed:', this.lastError);
    if (this.failRun >= Math.max(6, this.wanted * 2) && !this.stuck) {
      this.stuck = true;
      this.halt();
    }
    this.emit({ type: 'error', message: this.lastError });
  }

  // every thread goes; the matches they were playing go back to be played again
  dropJobs() {
    for (const w of this.workers) {
      if (w.job && this.src) this.src.drop(w.job);
      w.job = null;
      w.terminate();
    }
    this.workers = [];
  }

  // let every thread go and wait (Resume tries again)
  halt() {
    this.dropJobs();
    if (this.state === 'running') this.state = 'paused';
    this.autoPaused = false;
    this.persist(true);
    this.emit({ type: 'state' });
  }

  feed(w) {
    if (this.state !== 'running' || !w.ready || w.job || w.retiring) return;
    let spec;
    try {
      spec = this.src.next();
    } catch (err) {
      // a broken match list: say so and stop, rather than hang
      console.error(err);
      this.problem(String(err && err.stack || err));
      this.stuck = true;
      this.halt();
      return;
    }
    if (!spec) return;
    // highlights only worth sending if they'd make the save's list
    spec.clipMin = minScore(this.save);
    w.job = spec;
    w.postMessage({ type: 'run', spec });
  }

  // a finished match goes into the save
  take(spec, result, ms) {
    const save = this.save;
    const { changes, ctx } = applyResult(save, spec, result);
    this.done++;
    if (this.kind === 'battle') save.run = { total: this.total, done: this.done };
    // the news first (a season's last match then ends the season after it)
    matchNews(save, spec, result, ctx);
    for (const ch of changes) if (ch.kind === 'generation') generationNews(save, ch);
    this.src?.take?.(spec, result);
    // the best moments of the match go to the highlights
    for (const c of result.clips || []) {
      c.meta.season = spec.comp?.kind === 'season' ? spec.comp.n : null;
      keepClip(save, c);
    }
    result.clips = null;
    const now = performance.now();
    this.times.push(now);
    if (this.times.length > 60) this.times.shift();
    this.recent.unshift({ spec, result, ms });
    if (this.recent.length > 8) this.recent.pop();
    this.persist();
    this.emit({ type: 'match', spec, result, changes });
  }

  // matches a minute, from the last ones (all threads together)
  speed() {
    const ts = this.times;
    if (ts.length < 2) return 0;
    return ((ts.length - 1) / (ts[ts.length - 1] - ts[0])) * 60000;
  }

  checkEnd() {
    if (this.state === 'idle' || !this.src) return;
    const working = this.workers.some((w) => w.job) || !!this.live;
    if (!working && this.src.finished()) {
      this.finish();
    }
  }

  finish() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.state = 'idle';
    this.src = null;
    if (this.save && this.kind === 'battle') this.save.run = null;
    this.persist(true);
    this.emit({ type: 'finished' });
  }

  // finish the matches being played, then wait. auto: a normal game is
  // starting, and threads finishing their matches would slow it down, so
  // they stop now (the matches go back in the queue)
  pause(auto = false) {
    if (this.state !== 'running') return;
    if (auto) this.dropJobs();
    this.state = 'paused';
    this.autoPaused = auto;
    this.persist(true);
    this.emit({ type: 'state' });
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.autoPaused = false;
    this.stuck = this.offline = false;
    this.failRun = 0;
    this.topUp();
    for (const w of this.workers) this.feed(w);
    this.emit({ type: 'state' });
  }

  // stop at once; matches being played are thrown away
  stop() {
    this.runId++;
    this.dropJobs();
    if (this.state !== 'idle') {
      this.state = 'idle';
      this.persist(true);
      this.emit({ type: 'state' });
    }
    // a watched match of a competition goes back to wait
    if (this.live && this.src) this.src.drop(this.live);
    this.src = null;
    this.live = null;
  }

  // ---------- watching ----------
  // the next match, to be played in the page instead of in a worker
  // want: a competition's match id or series id to watch that one
  takeLive(want = null) {
    if (!this.src || this.state === 'idle' || this.live) return null;
    const spec = this.src.next(want);
    if (spec) {
      spec.clipMin = minScore(this.save);
      this.live = spec;
    }
    return spec;
  }

  finishLive(result) {
    const spec = this.live;
    this.live = null;
    if (!spec || !this.save) return;
    result.watched = true;
    this.take(spec, result, 0);
    for (const w of this.workers) this.feed(w);
    this.checkEnd();
    return spec;
  }

  // left before the end: it doesn't count, another match takes its place
  dropLive() {
    if (!this.live) return;
    const spec = this.live;
    this.live = null;
    if (this.src) this.src.drop(spec);
    for (const w of this.workers) this.feed(w);
    this.checkEnd();
  }

  // ---------- storing ----------
  persist(now = false) {
    clearTimeout(this.saveTimer);
    if (now) {
      this.flush();
      return;
    }
    this.saveTimer = setTimeout(() => this.flush(), 1500);
  }

  flush() {
    if (!saveStore(this.store)) this.emit({ type: 'storeFull' });
  }
}

// Bot Arena's highlight clips live in the browser's IndexedDB (they're too
// big for localStorage). Each save keeps a list of its best ones (save.clips:
// what they are, without the recording); favorites are never pushed out.

const DB = 'cs16remake.clips', STORE = 'clips';
export const MAX_CLIPS = 60;

let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}

const done = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const store = async (mode) => (await db()).transaction(STORE, mode).objectStore(STORE);
const key = (save, id) => save.id + ':' + id;

export const loadClip = async (save, id) => done((await store('readonly')).get(key(save, id)));
const putClip = async (save, id, clip) => done((await store('readwrite')).put(clip, key(save, id)));
const dropClip = async (save, id) => done((await store('readwrite')).delete(key(save, id)));

// the score a new clip has to beat to be kept (0 while there's room)
export function minScore(save) {
  const list = save.clips || [];
  if (list.length < MAX_CLIPS) return 0;
  const free = list.filter((c) => !c.fav);
  return free.length ? Math.min(...free.map((c) => c.score)) + 0.01 : Infinity;
}

let serial = 0;
// a new clip ({ meta, clip }): kept if it's one of the best; returns its entry or null
export function keepClip(save, { meta, clip }) {
  const list = (save.clips ||= []);
  if (list.length >= MAX_CLIPS) {
    const free = list.filter((c) => !c.fav);
    if (!free.length) return null;
    const worst = free.reduce((a, b) => (b.score < a.score ? b : a));
    if (worst.score >= meta.score) return null;
    removeClip(save, worst);
  }
  const entry = { ...meta, id: Date.now().toString(36) + (serial++).toString(36), at: Date.now(), match: save.matches, fav: false };
  list.push(entry);
  putClip(save, entry.id, clip).catch(() => {
    // the browser said no (no room): forget it
    const i = list.indexOf(entry);
    if (i >= 0) list.splice(i, 1);
  });
  return entry;
}

export function removeClip(save, entry) {
  const list = save.clips || [];
  const i = list.indexOf(entry);
  if (i >= 0) list.splice(i, 1);
  dropClip(save, entry.id).catch(() => {});
}

// a save goes: so do its clips
export function dropSaveClips(save) {
  for (const c of save.clips || []) dropClip(save, c.id).catch(() => {});
}

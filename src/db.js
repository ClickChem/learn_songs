// Saved analyses in IndexedDB (on this device only). One record per distinct lyrics text.

const DB_NAME = "lyric-note";
const STORE = "songs";

let dbp = null;
function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: "key" });
      s.createIndex("savedAt", "savedAt");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
  });
  return dbp;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

// Same lyrics (ignoring blank lines, edge spaces and language choice) -> same key.
export async function lyricsKey(lang, raw) {
  const text = lang + "\n" + raw.map((l) => l.trim()).filter(Boolean).join("\n");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const getSong = (key) => tx("readonly", (s) => s.get(key));
export const putSong = (song) => tx("readwrite", (s) => s.put(song));
export const deleteSong = (key) => tx("readwrite", (s) => s.delete(key));
export async function listSongs() {
  const all = await tx("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

// Ask the browser not to evict our data under storage pressure. Not guaranteed.
export async function requestPersist() {
  try { return (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false; }
  catch { return false; }
}

// One-time move of the old localStorage history into IndexedDB.
export async function migrateFromLocalStorage() {
  let old;
  try { old = JSON.parse(localStorage.getItem("ln.history") || "null"); } catch { return; }
  if (!Array.isArray(old) || !old.length) return;
  const now = Date.now();
  for (let i = 0; i < old.length; i++) {
    const h = old[i];
    await putSong({ ...h, key: await lyricsKey(h.lang, h.raw), savedAt: now - i });
  }
  try { localStorage.removeItem("ln.history"); } catch {}
}

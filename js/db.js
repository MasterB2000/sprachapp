// Speicherung im Browser (IndexedDB) plus Export/Import als JSON-Datei.
//
// Vier Ablagen:
//   phrases    – die Wendungen (eine Zeile pro Satz)
//   recordings – die letzte eigene Aufnahme je Wendung
//   settings   – Einstellungen und Merker
//   tts        – erzeugte Musterstimme je Stimme und Satz (jederzeit neu erzeugbar)

const DB_NAME = 'sprachapp';
const DB_VERSION = 2;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('phrases')) db.createObjectStore('phrases', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('tts')) db.createObjectStore('tts', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(store, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  }));
}

export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const put = (store, obj) => run(store, 'readwrite', (s) => s.put(obj));
export const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));

export async function getSetting(key, fallback) {
  const row = await get('settings', key);
  return row ? row.value : fallback;
}

export const setSetting = (key, value) => put('settings', { key, value });

// Bittet den Browser, die Daten nicht bei Platzmangel zu löschen.
export async function requestPersistence() {
  if (navigator.storage && navigator.storage.persist) {
    try { return await navigator.storage.persist(); } catch { return false; }
  }
  return false;
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Neue Wendung mit allen Feldern, damit überall dieselbe Form gilt.
export function makePhrase(fields) {
  const now = Date.now();
  return {
    id: newId(),
    de: '',
    en: '',
    decode: null,      // [["I","ich"], ["want","will"], …] – englisches Wort, wörtlich darunter
    note: '',          // Erklärung, erscheint nur auf Nachfrage
    source: 'manual',  // start | bergamot | prompt | pc
    refined: false,    // true, sobald eine Fassung mit Dekodierung vorliegt
    dir: 'de-en',      // de-en = selbst sagen wollen | en-de = gehört, verstehen wollen (Hör-Karte)
    learn: true,       // false = nur übersetzt, kommt nicht beim Üben dran
    interval: 0,
    streak: 0,
    reps: 0,
    lapses: 0,
    due: null,
    firstSeen: null,
    lastReviewed: null,
    created: now,
    updated: now,
    ...fields,
  };
}

// Startlektion beim ersten Start einlesen; bei neuer Fassung fehlende Einträge ergänzen.
export async function seedStartLesson() {
  const res = await fetch('data/start.json');
  const lesson = await res.json();
  const done = await getSetting('seeded', {});
  if (done[lesson.id] === lesson.version) return 0;

  const existing = new Set((await getAll('phrases')).map((p) => p.id));
  let added = 0;
  for (const item of lesson.items) {
    if (existing.has(item.id)) continue;
    await put('phrases', makePhrase({ ...item, source: 'start', refined: true }));
    added++;
  }
  done[lesson.id] = lesson.version;
  await setSetting('seeded', done);
  return added;
}

// Löscht eine Wendung samt Aufnahme. Gibt zurück, was zum Rückgängigmachen nötig ist.
export async function deletePhrase(id) {
  const phrase = await get('phrases', id);
  const recording = await get('recordings', id);
  await del('phrases', id);
  await del('recordings', id);
  return { phrase, recording };
}

export async function restorePhrase({ phrase, recording }) {
  if (phrase) await put('phrases', phrase);
  if (recording) await put('recordings', recording);
}

export const isStartPhrase = (p) => /^s\d+$/.test(p.id);

export async function exportData() {
  const phrases = await getAll('phrases');
  return {
    app: 'sprachapp',
    format: 1,
    exported: new Date().toISOString(),
    phrases,
  };
}

// Führt eine Exportdatei mit dem Bestand zusammen. Bei gleicher ID gewinnt die jüngere Fassung.
export async function importData(data) {
  if (!data || !Array.isArray(data.phrases)) throw new Error('Keine gültige Sprachapp-Datei.');
  const existing = new Map((await getAll('phrases')).map((p) => [p.id, p]));
  let added = 0, updated = 0;
  for (const p of data.phrases) {
    if (!p.id || (!p.de && !p.en)) continue;
    const old = existing.get(p.id);
    if (!old) { await put('phrases', makePhrase(p)); added++; }
    else if ((p.updated || 0) > (old.updated || 0)) { await put('phrases', { ...old, ...p }); updated++; }
  }
  return { added, updated };
}

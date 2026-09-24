// Natürliche englische Stimme (Kokoro, offline).
// Jeder Satz wird einmal erzeugt und gespeichert; danach kommt er sofort aus dem Speicher.

import * as db from './db.js';

export const VOICES = [
  { id: 'bf_emma', label: 'Emma – britisch' },
  { id: 'bf_isabella', label: 'Isabella – britisch' },
  { id: 'bm_george', label: 'George – britisch' },
  { id: 'bm_fable', label: 'Fable – britisch' },
  { id: 'af_heart', label: 'Heart – amerikanisch' },
  { id: 'af_bella', label: 'Bella – amerikanisch' },
  { id: 'am_michael', label: 'Michael – amerikanisch' },
  { id: 'am_fenrir', label: 'Fenrir – amerikanisch' },
];
export const DEFAULT_VOICE = 'bf_emma';

let worker = null;
let serial = 0;
const pending = new Map();
const inflight = new Map();
let state = 'idle'; // idle | loading | ready | failed

export const status = () => state;

function call(text, voice) {
  if (!worker) {
    if (state === 'idle' || state === 'failed') state = 'loading';
    worker = new Worker(new URL('./voice-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error)); else p.resolve(data);
    };
    worker.onerror = (e) => {
      state = 'failed';
      pending.forEach((p) => p.reject(new Error(e.message || 'Stimme konnte nicht geladen werden')));
      pending.clear();
      worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, text, voice });
  });
}

export const getVoice = () => db.getSetting('voice', DEFAULT_VOICE);
export const setVoice = (v) => db.setSetting('voice', v);

// Lädt das Modell (einmalig ~115 MB, danach offline).
export function warmUp() {
  if (worker || state === 'ready') return;
  call('', DEFAULT_VOICE)
    .then(() => { state = 'ready'; })
    .catch((err) => { state = 'failed'; console.warn('Kokoro:', err); });
}

const key = (text, voice) => `${voice}|${text}`;

export async function cached(text, voice) {
  const row = await db.get('tts', key(text, voice ?? await getVoice()));
  return row ? row.blob : null;
}

// Liefert die Aufnahme eines Satzes – aus dem Speicher oder frisch erzeugt.
export async function getAudio(text, voice) {
  voice = voice ?? await getVoice();
  const k = key(text, voice);
  const hit = await db.get('tts', k);
  if (hit) return hit.blob;
  if (!inflight.has(k)) {
    const job = call(text, voice)
      .then(async ({ blob }) => {
        state = 'ready';
        await db.put('tts', { key: k, blob, created: Date.now() });
        return blob;
      })
      .finally(() => inflight.delete(k));
    inflight.set(k, job);
  }
  return inflight.get(k);
}

// Im Hintergrund vorbereiten, Fehler egal.
export function prepare(text) {
  if (text) getAudio(text).catch(() => {});
}

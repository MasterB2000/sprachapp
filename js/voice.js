// Stimmen: Kokoro (Englisch, offline), Piper (Deutsch, offline), Google (online, eigener Schlüssel),
// Systemstimme (Rückfallebene). Pro Sprache ist eine Stimme gewählt.
// Jeder Satz wird einmal erzeugt und gespeichert; danach kommt er sofort und offline aus dem Speicher.

import * as db from './db.js';

export const KOKORO_VOICES = [
  { id: 'bf_emma', label: 'Emma', accent: 'britisch' },
  { id: 'bf_isabella', label: 'Isabella', accent: 'britisch' },
  { id: 'bm_george', label: 'George', accent: 'britisch' },
  { id: 'bm_fable', label: 'Fable', accent: 'britisch' },
  { id: 'af_heart', label: 'Heart', accent: 'amerikanisch' },
  { id: 'af_bella', label: 'Bella', accent: 'amerikanisch' },
  { id: 'am_michael', label: 'Michael', accent: 'amerikanisch' },
  { id: 'am_fenrir', label: 'Fenrir', accent: 'amerikanisch' },
];

export const PIPER_VOICES = [
  { id: 'de_DE-thorsten-medium', label: 'Thorsten', note: 'männlich' },
  { id: 'de_DE-kerstin-low', label: 'Kerstin', note: 'weiblich' },
];

const DEFAULTS = {
  en: { provider: 'kokoro', id: 'bf_emma' },
  de: { provider: 'system', id: '' },
};

export const SAMPLES = {
  en: "I'm looking forward to the weekend. We could bake some bread together.",
  de: 'Ich freue mich aufs Wochenende. Vielleicht backen wir zusammen Brot.',
};

// ---------- Auswahl ----------

export async function selected(lang) {
  const sel = await db.getSetting('voice.' + lang, null);
  if (sel) return sel;
  // Übernahme der früheren Einstellung (nur Kokoro-ID gespeichert)
  const legacy = lang === 'en' ? await db.getSetting('voice', null) : null;
  return legacy ? { provider: 'kokoro', id: legacy } : DEFAULTS[lang];
}

export const select = (lang, sel) => db.setSetting('voice.' + lang, sel);

// ---------- Hintergrund-Prozesse (Kokoro, Piper) ----------

function workerClient(url) {
  let worker = null;
  let serial = 0;
  const pending = new Map();
  const client = {
    state: 'idle', // idle | loading | ready | failed
    call(msg) {
      if (!worker) {
        client.state = 'loading';
        worker = new Worker(url, { type: 'module' });
        worker.onmessage = ({ data }) => {
          const p = pending.get(data.id);
          if (!p) return;
          pending.delete(data.id);
          if (data.error) p.reject(new Error(data.error));
          else { client.state = 'ready'; p.resolve(data); }
        };
        worker.onerror = (e) => {
          client.state = 'failed';
          pending.forEach((p) => p.reject(new Error(e.message || 'Stimme konnte nicht geladen werden')));
          pending.clear();
          worker = null;
        };
      }
      return new Promise((resolve, reject) => {
        const id = ++serial;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, ...msg });
      });
    },
  };
  return client;
}

const kokoro = workerClient(new URL('./voice-worker.js', import.meta.url));
const piper = workerClient(new URL('./piper-worker.js', import.meta.url));

export const status = (provider) => ({ kokoro, piper }[provider]?.state ?? 'ready');

// Lädt die Modelle der gewählten Offline-Stimmen im Hintergrund.
export async function warmUp() {
  for (const lang of ['en', 'de']) {
    const sel = await selected(lang);
    const client = { kokoro, piper }[sel.provider];
    if (client && client.state === 'idle') client.call({ text: '', voice: sel.id }).catch(() => {});
  }
}

// ---------- Google ----------

const GOOGLE = 'https://texttospeech.googleapis.com/v1/';

export const googleKey = () => db.getSetting('google.key', '');
export const setGoogleKey = (k) => db.setSetting('google.key', k.trim());

async function googleFetch(path, key, body) {
  const res = await fetch(GOOGLE + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Goog-Api-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `Google antwortet mit Fehler ${res.status}`);
  return json;
}

// Liste der passenden Google-Stimmen, gespeichert – ohne Netz bleibt die letzte Liste erhalten.
export async function googleVoices({ refresh = false } = {}) {
  const cachedList = await db.getSetting('google.voices', null);
  if (cachedList && !refresh) return cachedList;
  const key = await googleKey();
  if (!key) return [];
  const { voices = [] } = await googleFetch('voices', key);
  const wanted = ['de-DE', 'en-GB', 'en-US'];
  const list = voices
    .filter((v) => v.languageCodes.some((c) => wanted.includes(c)))
    .map((v) => {
      const code = v.languageCodes.find((c) => wanted.includes(c));
      const kind = v.name.includes('Chirp3-HD') ? 'Chirp 3 HD'
        : v.name.includes('Chirp') ? 'Chirp'
        : v.name.includes('Neural2') ? 'Neural2'
        : v.name.includes('Studio') ? 'Studio'
        : v.name.includes('Wavenet') ? 'WaveNet' : 'Standard';
      return {
        id: v.name,
        lang: code.slice(0, 2),
        code,
        label: v.name.split('-').pop(),
        kind,
        best: kind === 'Chirp 3 HD',
        gender: { MALE: 'männlich', FEMALE: 'weiblich' }[v.ssmlGender] || '',
      };
    })
    .sort((a, b) => Number(b.best) - Number(a.best) || a.code.localeCompare(b.code) || a.label.localeCompare(b.label));
  await db.setSetting('google.voices', list);
  return list;
}

async function googleSynth(text, voiceName) {
  const key = await googleKey();
  if (!key) throw new Error('Kein Google-Schlüssel eingetragen');
  const languageCode = voiceName.split('-').slice(0, 2).join('-');
  const { audioContent } = await googleFetch('text:synthesize', key, {
    input: { text },
    voice: { languageCode, name: voiceName },
    audioConfig: { audioEncoding: 'MP3' },
  });
  const bytes = Uint8Array.from(atob(audioContent), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'audio/mpeg' });
}

// ---------- Erzeugen und Speichern ----------

const inflight = new Map();
const cacheKey = (text, sel) => `${sel.provider}:${sel.id}|${text}`;

export async function cached(text, sel) {
  const row = await db.get('tts', cacheKey(text, sel));
  return row ? row.blob : null;
}

// Kann diese Stimme jetzt ohne spürbare Wartezeit liefern?
export function canGenerateNow(sel) {
  if (sel.provider === 'google') return navigator.onLine;
  if (sel.provider === 'system') return false;
  return status(sel.provider) === 'ready';
}

async function generate(text, sel) {
  if (sel.provider === 'google') return googleSynth(text, sel.id);
  const client = { kokoro, piper }[sel.provider];
  if (!client) throw new Error('Unbekannte Stimme');
  return (await client.call({ text, voice: sel.id })).blob;
}

// Aufnahme eines Satzes – aus dem Speicher oder frisch erzeugt. Systemstimme: null.
export async function getAudio(text, lang, sel) {
  sel = sel ?? await selected(lang);
  if (sel.provider === 'system' || !text) return null;
  const k = cacheKey(text, sel);
  const hit = await db.get('tts', k);
  if (hit) return hit.blob;
  if (!inflight.has(k)) {
    const job = generate(text, sel)
      .then(async (blob) => {
        await db.put('tts', { key: k, blob, created: Date.now() });
        return blob;
      })
      .finally(() => inflight.delete(k));
    inflight.set(k, job);
  }
  return inflight.get(k);
}

// Im Hintergrund vorbereiten, Fehler egal.
export function prepare(text, lang) {
  if (text) getAudio(text, lang).catch(() => {});
}

// Aufnahme, Wiedergabe und Sprachausgabe.

import * as voice from './voice.js';

// ---------- Musterstimme ----------
// Die pro Sprache gewählte Stimme (siehe voice.js). Ist sie gerade nicht verfügbar
// (lädt noch, kein Netz, Fehler), spricht die Systemstimme – der Satz wird fürs nächste Mal vorbereitet.

export async function speak(text, { lang = 'en', rate = 1 } = {}) {
  if (!text) return;
  try {
    const sel = await voice.selected(lang);
    if (sel.provider !== 'system') {
      const hit = await voice.cached(text, sel);
      if (hit) return playBlob(hit, { rate });
      if (voice.canGenerateNow(sel)) return playBlob(await voice.getAudio(text, lang, sel), { rate });
      voice.prepare(text, lang);
    }
  } catch (err) {
    console.warn('Stimme nicht verfügbar:', err);
  }
  return systemSpeak(text, { lang, rate });
}

// ---------- Systemstimme (Rückfallebene) ----------

let voices = [];

function loadVoices() {
  voices = speechSynthesis.getVoices();
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
}

// Bevorzugt britisches Englisch, sonst irgendein Englisch.
function pickVoice(lang) {
  const prefs = lang === 'en' ? ['en-GB', 'en_GB', 'en-US', 'en_US', 'en'] : ['de-DE', 'de_DE', 'de'];
  for (const pref of prefs) {
    const local = voices.find((v) => v.lang.startsWith(pref) && v.localService);
    if (local) return local;
    const any = voices.find((v) => v.lang.startsWith(pref));
    if (any) return any;
  }
  return null;
}

export function systemSpeak(text, { lang = 'en', rate = 1 } = {}) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || !text) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const sysVoice = pickVoice(lang);
    if (sysVoice) u.voice = sysVoice;
    u.lang = sysVoice ? sysVoice.lang : (lang === 'en' ? 'en-GB' : 'de-DE');
    u.rate = rate;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  stopPlayback();
}

// ---------- Aufnahme ----------

let recorder = null;
let chunks = [];
let stream = null;
let meterCtx = null;
let analyser = null;
let samples = null;

export const canRecord = () => Boolean(navigator.mediaDevices && window.MediaRecorder);

export async function startRecording() {
  // Rauschunterdrückung und Pegelregelung aus: verfälschen die eigene Stimme (siehe Masterplan 6).
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  chunks = [];
  try {
    meterCtx = new AudioContext();
    analyser = meterCtx.createAnalyser();
    analyser.fftSize = 1024;
    samples = new Float32Array(analyser.fftSize);
    meterCtx.createMediaStreamSource(stream).connect(analyser);
  } catch {
    analyser = null; // ohne Pegel geht die Aufnahme trotzdem
  }
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start();
}

export function stopRecording() {
  return new Promise((resolve) => {
    if (!recorder || recorder.state === 'inactive') return resolve(null);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      stream.getTracks().forEach((t) => t.stop());
      meterCtx?.close();
      meterCtx = analyser = null;
      recorder = null;
      stream = null;
      resolve(blob);
    };
    recorder.stop();
  });
}

export const isRecording = () => Boolean(recorder && recorder.state === 'recording');

// Momentane Lautstärke der Aufnahme, 0 … 1 – für den Pegelbalken.
export function level() {
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const v of samples) sum += v * v;
  return Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length)) * 1.6);
}

// ---------- Wiedergabe ----------

let current = null;

// Spielt eine Aufnahme ab. Ergebnis: true = gespielt, sonst eine Fehlerbeschreibung.
// Scheitert das Audio-Element (kommt auf manchen Handys bei eigenen Aufnahmen vor),
// springt Web Audio ein.
// normalize: leise Aufnahmen auf die Lautstärke der Musterstimme anheben (nur beim Abspielen).
export async function playBlob(blob, { rate = 1, normalize = false } = {}) {
  if (!blob) return 'keine Aufnahme';
  if (!blob.size) return 'Aufnahme ist leer';
  if (normalize) {
    const result = await playWithWebAudio(blob, rate, true);
    if (result === true || result === 'gestoppt') return result;
  }
  const first = await playWithElement(blob, rate);
  if (first === true || first === 'gestoppt') return first;
  const second = await playWithWebAudio(blob, rate);
  return second === true ? true : `${first}; Ersatzweg: ${second}`;
}

function playWithElement(blob, rate) {
  return new Promise((resolve) => {
    stopPlayback();
    const url = URL.createObjectURL(blob);
    const el = new Audio(url);
    el.playbackRate = rate; // Tonhöhe bleibt erhalten
    let started = false;
    const done = (result) => {
      if (current?.el !== el) return;
      URL.revokeObjectURL(url);
      current = null;
      resolve(result);
    };
    current = { el, stop: () => { el.pause(); done('gestoppt'); } };
    el.onplaying = () => { started = true; };
    el.onended = () => done(started ? true : 'endete sofort');
    el.onerror = () => done('Audio-Element: ' + (el.error?.message || el.error?.code || 'Fehler'));
    el.play().catch((err) => done('Audio-Element: ' + err.name));
  });
}

async function playWithWebAudio(blob, rate, normalize = false) {
  try {
    const ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    return await new Promise((resolve) => {
      stopPlayback();
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      if (normalize) {
        // Verstärken auf Ziel-Lautheit, Kompressor fängt Spitzen ab.
        const gain = ctx.createGain();
        gain.gain.value = loudnessGain(buffer);
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 12;
        comp.ratio.value = 4;
        comp.attack.value = 0.005;
        comp.release.value = 0.15;
        src.connect(gain).connect(comp).connect(ctx.destination);
      } else {
        src.connect(ctx.destination);
      }
      const done = (result) => { if (current?.src !== src) return; current = null; ctx.close(); resolve(result); };
      current = { src, stop: () => { try { src.stop(); } catch {} done('gestoppt'); } };
      src.onended = () => done(true);
      src.start();
    });
  } catch (err) {
    return 'Web Audio: ' + (err.message || err.name);
  }
}

// Verstärkung, damit die gesprochenen Stellen etwa bei -18 dBFS liegen (so laut wie die Musterstimmen).
// Stille zählt nicht mit: nur die lauteren Abschnitte von 20 ms gehen in die Messung ein.
function loudnessGain(buffer) {
  const data = buffer.getChannelData(0);
  const frame = Math.round(buffer.sampleRate * 0.02);
  const levels = [];
  for (let i = 0; i + frame <= data.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j++) sum += data[j] * data[j];
    levels.push(Math.sqrt(sum / frame));
  }
  const loudest = Math.max(...levels, 1e-6);
  const voiced = levels.filter((l) => l > loudest * 0.15);
  const rms = Math.sqrt(voiced.reduce((n, l) => n + l * l, 0) / Math.max(1, voiced.length));
  const TARGET = 0.126; // -18 dBFS
  return Math.min(12, Math.max(1, TARGET / Math.max(rms, 1e-6)));
}

export function stopPlayback() {
  current?.stop();
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Aufnahme, Wiedergabe und Sprachausgabe.

// ---------- Sprachausgabe (Musterstimme) ----------

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

export function speak(text, { lang = 'en', rate = 1 } = {}) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || !text) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;
    u.lang = voice ? voice.lang : (lang === 'en' ? 'en-GB' : 'de-DE');
    u.rate = rate;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

// ---------- Aufnahme ----------

let recorder = null;
let chunks = [];
let stream = null;

export const canRecord = () => Boolean(navigator.mediaDevices && window.MediaRecorder);

export async function startRecording() {
  // Rauschunterdrückung und Pegelregelung aus: verfälschen die eigene Stimme (siehe Masterplan 6).
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  chunks = [];
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
      recorder = null;
      stream = null;
      resolve(blob);
    };
    recorder.stop();
  });
}

export const isRecording = () => Boolean(recorder && recorder.state === 'recording');

// ---------- Wiedergabe ----------

let current = null;

export function playBlob(blob) {
  return new Promise((resolve) => {
    if (!blob) return resolve();
    stopPlayback();
    const url = URL.createObjectURL(blob);
    current = new Audio(url);
    const done = () => { URL.revokeObjectURL(url); current = null; resolve(); };
    current.onended = done;
    current.onerror = done;
    current.play().catch(done);
  });
}

export function stopPlayback() {
  if (current) { current.pause(); current.onended?.(); }
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

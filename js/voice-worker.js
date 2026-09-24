// Läuft im Hintergrund: erzeugt englische Sprache mit Kokoro, ohne die Oberfläche zu blockieren.

import { KokoroTTS, env } from '../vendor/kokoro/kokoro.web.js';

const base = new URL('../vendor/kokoro/', import.meta.url).href;

// Alles aus der App selbst laden, nichts aus dem Internet.
const t = env.transformers;
t.remoteHost = base + 'models/';
t.remotePathTemplate = '{model}/';
t.allowLocalModels = false;
t.useBrowserCache = false;            // der Service Worker hält die Dateien schon vor
t.backends.onnx.wasm.wasmPaths = base + 'ort/';
// Mehrere Kerne nur mit Cross-Origin-Isolation (setzt der Service Worker, siehe sw.js).
t.backends.onnx.wasm.numThreads = self.crossOriginIsolated
  ? Math.min(4, navigator.hardwareConcurrency || 1)
  : 1;

let tts = null;

function load() {
  if (!tts) {
    tts = KokoroTTS.from_pretrained('kokoro', { dtype: 'q8', device: 'wasm' });
    tts.catch(() => { tts = null; });
  }
  return tts;
}

// 16-Bit-WAV statt 32-Bit: halb so groß im Speicher, klanglich kein Unterschied.
function toWav16(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

self.onmessage = async ({ data: { id, text, voice } }) => {
  try {
    const model = await load();
    if (!text) return self.postMessage({ id, ready: true });
    const audio = await model.generate(text, { voice });
    self.postMessage({ id, blob: toWav16(audio.audio, audio.sampling_rate) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};

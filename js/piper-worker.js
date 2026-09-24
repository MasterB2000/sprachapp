// Läuft im Hintergrund: deutsche Sprache mit Piper, offline.
// Text → Lautnummern (piper_phonemize, eSpeak NG) → Piper-Modell (ONNX) → WAV.
// Nutzt dieselbe ONNX-Laufzeit wie Kokoro (vendor/kokoro/ort).

import * as ort from '../vendor/kokoro/ort/ort.min.mjs';

const base = new URL('../vendor/', import.meta.url).href;
ort.env.wasm.wasmPaths = base + 'kokoro/ort/';
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

// ---------- Lautumwandler ----------
// piper_phonemize ist ein klassisches Emscripten-Skript; im Modul-Worker wird es als Funktion geladen.
// Programm (0,6 MB) und Sprachdaten (18 MB) werden einmal geholt und im Speicher gehalten.

const PH = base + 'piper/phonemize/piper_phonemize';
let phonemizer = null;

function loadPhonemizer() {
  if (!phonemizer) {
    phonemizer = (async () => {
      const [src, wasm, data] = await Promise.all([
        fetch(PH + '.js').then((r) => r.text()),
        fetch(PH + '.wasm').then((r) => r.arrayBuffer()),
        fetch(PH + '.data').then((r) => r.arrayBuffer()),
      ]);
      const create = new Function(src + '\nreturn createPiperPhonemize;')();
      return { create, wasm, data };
    })();
    phonemizer.catch(() => { phonemizer = null; });
  }
  return phonemizer;
}

// Liefert die Laute als Zeichen. Die Nummern bildet jede Stimme mit ihrer eigenen Lauttabelle,
// denn ältere Modelle kennen weniger Zeichen als der Lautumwandler.
async function phonemes(text, voice) {
  const { create, wasm, data } = await loadPhonemizer();
  return new Promise((resolve, reject) => {
    create({
      wasmBinary: wasm,
      getPreloadedPackage: () => data,
      print: (line) => { try { resolve(JSON.parse(line).phonemes); } catch (e) { reject(e); } },
      printErr: (msg) => reject(new Error(msg)),
    }).then((mod) => {
      mod.callMain(['-l', voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
    }, reject);
  });
}

const voices = new Map(); // id → Promise<{ session, config }>

function loadVoice(id) {
  if (!voices.has(id)) {
    const job = (async () => {
      const url = `${base}piper/models/${id}.onnx`;
      const config = await (await fetch(url + '.json')).json();
      const model = await (await fetch(url)).arrayBuffer();
      const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
      return { session, config };
    })();
    job.catch(() => voices.delete(id));
    voices.set(id, job);
  }
  return voices.get(id);
}

// Piper-Schema: ^ _ (Laut _)* $  – "_" trennt jeden Laut. Unbekannte Laute werden übersprungen.
function toIds(list, map) {
  const ids = [...map['^'], ...map['_']];
  for (const ph of list) {
    if (map[ph]) ids.push(...map[ph], ...map['_']);
  }
  ids.push(...map['$']);
  return ids;
}

async function synthesize(text, id) {
  const [{ session, config }] = await Promise.all([loadVoice(id), loadPhonemizer()]);
  const { noise_scale, length_scale, noise_w } = config.inference;
  const ids = toIds(await phonemes(text.trim(), config.espeak.voice), config.phoneme_id_map);
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([noise_scale, length_scale, noise_w]), [3]),
  };
  const out = await session.run(feeds);
  return toWav16(out.output.data, config.audio.sample_rate);
}

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
    if (!text) { await Promise.all([loadVoice(voice), loadPhonemizer()]); return self.postMessage({ id, ready: true }); }
    self.postMessage({ id, blob: await synthesize(text, voice) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};

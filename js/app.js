// Einstieg: Bildschirme umschalten, Startlektion einlesen, Offline-Betrieb anmelden.

import * as db from './db.js';
import * as review from './review.js';
import * as capture from './capture.js';
import * as library from './library.js';
import * as settings from './settings.js';
import { registerSource } from './translate.js';
import { bergamotSource, warmUp } from './bergamot.js';
import * as voice from './voice.js';
import { applyFontScale } from './ui.js';

registerSource(bergamotSource);

const views = { review, capture, library, settings };
const main = document.getElementById('view');
const tabs = document.querySelectorAll('.tabs button');
let active = null;

async function show(name, opts = {}) {
  if (active) views[active].leave();
  active = name;
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  main.innerHTML = '';
  await views[name].enter(main, opts);
}

tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));

// Bildschirme können zu anderen wechseln, z. B. "Angepinnte üben" aus dem Übersetzer.
window.addEventListener('navigate', (e) => show(e.detail.tab, e.detail));

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker:', err));
  }
  db.requestPersistence();
  applyFontScale(await db.getSetting('fontScale', 1));
  try {
    await db.seedStartLesson();
  } catch (err) {
    console.warn('Startlektion nicht geladen:', err);
  }
  await show('review');
  // Übersetzer im Hintergrund laden – so liegt er auch offline bereit, bevor er gebraucht wird.
  setTimeout(warmUp, 3000);
  setTimeout(voice.warmUp, 6000);
}

init();

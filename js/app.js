// Einstieg: Bildschirme umschalten, Startlektion einlesen, Offline-Betrieb anmelden.

import * as db from './db.js';
import * as review from './review.js';
import * as capture from './capture.js';
import * as library from './library.js';
import { registerSource } from './translate.js';
import { bergamotSource, warmUp } from './bergamot.js';

registerSource(bergamotSource);

const views = { review, capture, library };
const main = document.getElementById('view');
const tabs = document.querySelectorAll('.tabs button');
let active = null;

async function show(name) {
  if (active) views[active].leave();
  active = name;
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  main.innerHTML = '';
  await views[name].enter(main);
}

tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker:', err));
  }
  db.requestPersistence();
  try {
    await db.seedStartLesson();
  } catch (err) {
    console.warn('Startlektion nicht geladen:', err);
  }
  await show('review');
  // Übersetzer im Hintergrund laden – so liegt er auch offline bereit, bevor er gebraucht wird.
  setTimeout(warmUp, 3000);
}

init();

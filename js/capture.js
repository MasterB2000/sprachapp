// Translator-Ersatz: deutschen Satz diktieren → englische Fassung → automatisch im Speicher.

import * as db from './db.js';
import * as audio from './audio.js';
import { translate } from './translate.js';
import { renderDecode } from './decode.js';
import { h, esc } from './ui.js';

let root = null;

export async function enter(el) {
  root = el;
  root.innerHTML = '';
  root.appendChild(h(`
    <section class="capture">
      <label class="field">
        <span class="muted">Deutscher Satz – Mikrofon der Tastatur antippen und sprechen</span>
        <textarea data-de rows="3" placeholder="z. B. Ich will morgen Brot backen."></textarea>
      </label>
      <button class="primary" data-go>Auf Englisch</button>

      <div class="result" data-result hidden>
        <p class="de-sentence" data-de-out></p>
        <div class="answer" data-en-out></div>
        <div class="row">
          <button class="secondary" data-say>Anhören</button>
          <button class="secondary" data-slow>Langsam</button>
        </div>
        <p class="muted" data-status></p>
      </div>

      <h3>Zuletzt erfasst</h3>
      <ul class="recent" data-recent></ul>
    </section>
  `));

  const input = root.querySelector('[data-de]');
  root.querySelector('[data-go]').addEventListener('click', () => capture(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); capture(input.value); }
  });
  await renderRecent();
}

export function leave() {
  audio.stopSpeaking();
  root = null;
}

async function capture(text) {
  const de = text.trim();
  if (!de) return;
  const go = root.querySelector('[data-go]');
  go.disabled = true;
  go.textContent = 'Übersetze …';

  let result = null;
  try { result = await translate(de); } finally {
    if (root) { go.disabled = false; go.textContent = 'Auf Englisch'; }
  }
  if (!root) return;

  const phrase = db.makePhrase({ de, en: result?.en || '', source: result?.source || 'offen' });
  await db.put('phrases', phrase);

  const box = root.querySelector('[data-result]');
  box.hidden = false;
  root.querySelector('[data-de-out]').textContent = de;
  const status = root.querySelector('[data-status]');

  root.querySelectorAll('[data-say],[data-slow]').forEach((b) => (b.hidden = !result));
  if (result) {
    renderDecode(root.querySelector('[data-en-out]'), phrase);
    status.textContent = 'Gespeichert. Kommt in der nächsten Runde dran.';
    root.querySelector('[data-say]').onclick = () => audio.speak(phrase.en, { rate: 0.95 });
    root.querySelector('[data-slow]').onclick = () => audio.speak(phrase.en, { rate: 0.7 });
    audio.speak(phrase.en, { rate: 0.95 });
  } else {
    root.querySelector('[data-en-out]').innerHTML = '';
    status.textContent = 'Gemerkt. Die englische Fassung kommt beim Veredeln (Speicher → Prompt).';
  }

  root.querySelector('[data-de]').value = '';
  await renderRecent();
}

async function renderRecent() {
  const list = root.querySelector('[data-recent]');
  const own = (await db.getAll('phrases'))
    .filter((p) => p.source !== 'start')
    .sort((a, b) => b.created - a.created)
    .slice(0, 8);
  list.innerHTML = own.length
    ? own.map((p) => `
        <li>
          <span class="de">${esc(p.de)}</span>
          <span class="en">${p.en ? esc(p.en) : '<i class="muted">wartet aufs Veredeln</i>'}</span>
        </li>`).join('')
    : '<li class="muted">Noch nichts. Der nächste Satz, der dir fehlt, gehört hierher.</li>';
}

// Übersetzen (Translator-Ersatz): deutschen Satz diktieren → englische Fassung → landet automatisch in den Übungskarten.

import * as db from './db.js';
import * as audio from './audio.js';
import { translate } from './translate.js';
import { renderDecode } from './decode.js';
import { h, esc, toast } from './ui.js';

let root = null;

export async function enter(el) {
  root = el;
  root.innerHTML = '';
  root.appendChild(h(`
    <section class="capture">
      <label class="field">
        <span class="muted">Was willst du auf Englisch sagen? Mikrofon der Tastatur antippen und auf Deutsch sprechen.</span>
        <textarea data-de rows="3" placeholder="z. B. Ich will morgen Brot backen."></textarea>
        <span class="muted small">Tipp: „Komma“, „Punkt“ und „Fragezeichen“ mitsprechen – dann übersetzt es deutlich besser.</span>
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

      <h3>Zuletzt übersetzt</h3>
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
    status.textContent = 'Gespeichert – kommt beim Üben als Karte dran.';
    root.querySelector('[data-say]').onclick = () => audio.speak(phrase.en, { rate: 0.95 });
    root.querySelector('[data-slow]').onclick = () => audio.speak(phrase.en, { rate: 0.7 });
    audio.speak(phrase.en, { rate: 0.95 });
  } else {
    root.querySelector('[data-en-out]').innerHTML = '';
    status.textContent = 'Gemerkt. Die englische Fassung kommt beim Veredeln (Reiter „Sätze“).';
  }

  root.querySelector('[data-de]').value = '';
  await renderRecent();
}

async function renderRecent() {
  const list = root.querySelector('[data-recent]');
  const own = (await db.getAll('phrases'))
    .filter((p) => !db.isStartPhrase(p))
    .sort((a, b) => b.created - a.created)
    .slice(0, 8);
  list.innerHTML = '';
  if (!own.length) {
    list.innerHTML = '<li class="muted">Noch nichts. Der nächste Satz, der dir fehlt, gehört hierher.</li>';
    return;
  }
  for (const p of own) {
    const li = h(`
      <li>
        <div class="texts">
          <span class="de">${esc(p.de)}</span>
          <span class="en">${p.en ? esc(p.en) : '<i class="muted">wartet aufs Veredeln</i>'}</span>
        </div>
        <button class="icon-btn remove" title="Löschen" aria-label="Löschen">✕</button>
      </li>
    `);
    li.querySelector('.remove').addEventListener('click', () => removePhrase(p));
    list.appendChild(li);
  }
}

async function removePhrase(p) {
  const undo = await db.deletePhrase(p.id);
  if (root) await renderRecent();
  toast('Gelöscht.', {
    ms: 5000,
    action: { label: 'Rückgängig', run: async () => { await db.restorePhrase(undo); if (root) await renderRecent(); } },
  });
}

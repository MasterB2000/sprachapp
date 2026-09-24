// Übersetzen (Translator-Ersatz), zwei Richtungen:
//   Deutsch → Englisch: was ich sagen will  → wird zur Sprech-Karte
//   Englisch → Deutsch: was ich gehört habe → wird zur Hör-Karte
// Jeder Satz landet automatisch in den Übungskarten, außer er steht auf "nur übersetzen".
//
// Liste darunter: angepinnte Sätze (verschiebbar) und zuletzt übersetzte.
// Antippen klappt die Aktionen auf: Kopieren, Teilen, Anhören, Zeigen, Bearbeiten, Anpinnen, Lernen, Löschen.

import * as db from './db.js';
import * as srs from './srs.js';
import * as audio from './audio.js';
import { translate } from './translate.js';
import { renderDecode } from './decode.js';
import { h, esc, toast, openOverlay, closeOverlay } from './ui.js';

const RECENT = 15;

const DIRS = {
  'de-en': {
    from: 'de', to: 'en', fromLabel: 'Deutsch', toLabel: 'Englisch', go: 'Auf Englisch',
    ask: 'Was willst du auf Englisch sagen? Mikrofon der Tastatur antippen und auf Deutsch sprechen.',
    hint: 'Tipp: „Komma“, „Punkt“ und „Fragezeichen“ mitsprechen – dann übersetzt es deutlich besser.',
    placeholder: 'z. B. Ich will morgen Brot backen.',
  },
  'en-de': {
    from: 'en', to: 'de', fromLabel: 'Englisch', toLabel: 'Deutsch', go: 'Auf Deutsch',
    ask: 'Was hast du gehört? Tastatur auf Englisch stellen (Leertaste oder Globus) und nachsprechen.',
    hint: 'Wird zur Hör-Karte: Beim Üben hörst du den Satz und sollst ihn verstehen.',
    placeholder: 'z. B. Did you eat yet?',
  },
};

let root = null;
let openId = null;   // aufgeklappter Satz
let dir = 'de-en';

// Eingabe- und Ausgabeseite eines Satzes, je nach Richtung.
const inputOf = (p) => (p.dir === 'en-de' ? p.en : p.de);
const outputOf = (p) => (p.dir === 'en-de' ? p.de : p.en);

export async function enter(el) {
  root = el;
  openId = null;
  dir = await db.getSetting('captureDir', 'de-en');
  root.innerHTML = '';
  root.appendChild(h(`
    <section class="capture">
      <div class="dir-switch">
        <span data-from></span>
        <button class="secondary swap" data-swap aria-label="Richtung tauschen">⇄</button>
        <span data-to></span>
      </div>
      <label class="field">
        <span class="muted" data-ask></span>
        <textarea data-de rows="3"></textarea>
        <span class="muted small" data-hint></span>
      </label>
      <button class="primary" data-go></button>

      <div class="result" data-result hidden>
        <p class="de-sentence" data-de-out></p>
        <div class="answer" data-en-out></div>
        <div class="row">
          <button class="accent-soft" data-copy-new>📋 Kopieren</button>
          <button class="secondary" data-say>🔈 Anhören</button>
          <button class="secondary" data-show-new>⛶ Zeigen</button>
        </div>
        <p class="muted small" data-status></p>
      </div>

      <div data-pinned-box hidden>
        <div class="list-head">
          <h3>📌 Angepinnt</h3>
          <button class="link small" data-practice-pinned>Diese üben</button>
        </div>
        <ul class="recent" data-pinned></ul>
      </div>

      <h3>Zuletzt übersetzt</h3>
      <ul class="recent" data-recent></ul>
    </section>
  `));

  const input = root.querySelector('[data-de]');
  root.querySelector('[data-swap]').addEventListener('click', async () => {
    dir = dir === 'de-en' ? 'en-de' : 'de-en';
    await db.setSetting('captureDir', dir);
    applyDir();
    root.querySelector('[data-result]').hidden = true;
  });
  applyDir();
  root.querySelector('[data-go]').addEventListener('click', () => capture(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); capture(input.value); }
  });
  root.querySelector('[data-practice-pinned]').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: { tab: 'review', mode: 'pinned' } }));
  });
  await renderLists();
}

export function leave() {
  audio.stopSpeaking();
  closeOverlay();
  root = null;
}

function applyDir() {
  const d = DIRS[dir];
  root.querySelector('[data-from]').textContent = d.fromLabel;
  root.querySelector('[data-to]').textContent = d.toLabel;
  root.querySelector('[data-ask]').textContent = d.ask;
  root.querySelector('[data-hint]').textContent = d.hint;
  root.querySelector('[data-de]').placeholder = d.placeholder;
  root.querySelector('[data-de]').lang = d.from;
  root.querySelector('[data-go]').textContent = d.go;
}

// ---------- Neu übersetzen ----------

async function capture(text) {
  const input = text.trim();
  if (!input) return;
  const d = DIRS[dir];
  const go = root.querySelector('[data-go]');
  go.disabled = true;
  go.textContent = 'Übersetze …';

  let result = null;
  try { result = await translate(input, { from: d.from, to: d.to }); } finally {
    if (root) { go.disabled = false; go.textContent = d.go; }
  }
  if (!root) return;

  const out = result?.text || '';
  const phrase = db.makePhrase(dir === 'en-de'
    ? { dir, en: input, de: out, source: result?.source || 'offen' }
    : { dir, de: input, en: out, source: result?.source || 'offen' });
  await db.put('phrases', phrase);

  const box = root.querySelector('[data-result]');
  box.hidden = false;
  root.querySelector('[data-de-out]').textContent = input;
  const status = root.querySelector('[data-status]');
  const outEl = root.querySelector('[data-en-out]');

  box.querySelector('.row').hidden = !result;
  if (result) {
    if (dir === 'en-de') outEl.innerHTML = `<p class="out-de">${esc(out)}</p>`;
    else renderDecode(outEl, phrase);
    status.textContent = dir === 'en-de'
      ? 'Gespeichert – kommt beim Üben als Hör-Karte dran.'
      : srs.waitsForCheck(phrase)
        ? 'Gespeichert. Geübt wird der Satz, sobald er geprüft ist (Reiter „Sätze“ → KI-Prüfung) – so lernst du kein Maschinen-Englisch.'
        : 'Gespeichert – kommt beim Üben als Karte dran.';
    root.querySelector('[data-copy-new]').onclick = () => copy(out);
    root.querySelector('[data-say]').onclick = () => audio.speak(phrase.en, { rate: 0.95 });
    root.querySelector('[data-show-new]').onclick = () => showBig(phrase);
    audio.speak(phrase.en, { rate: 0.95 });
  } else {
    outEl.innerHTML = '';
    status.textContent = 'Gemerkt. Die Übersetzung kommt bei der KI-Prüfung (Reiter „Sätze“).';
  }

  root.querySelector('[data-de]').value = '';
  await renderLists();
}

// ---------- Listen ----------

async function renderLists() {
  if (!root) return;
  const own = (await db.getAll('phrases')).filter((p) => !db.isStartPhrase(p));
  const pinned = own.filter((p) => p.pinned).sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0));
  const recent = own.filter((p) => !p.pinned).sort((a, b) => b.created - a.created).slice(0, RECENT);

  root.querySelector('[data-pinned-box]').hidden = !pinned.length;
  fillList(root.querySelector('[data-pinned]'), pinned, true);
  fillList(root.querySelector('[data-recent]'), recent, false);
  if (!recent.length) {
    root.querySelector('[data-recent]').innerHTML = pinned.length
      ? '<li class="muted">Alles angepinnt.</li>'
      : '<li class="muted">Noch nichts. Der nächste Satz, der dir fehlt, gehört hierher.</li>';
  }
}

function fillList(ul, phrases, pinnedList) {
  ul.innerHTML = '';
  for (const p of phrases) {
    const li = h(`
      <li class="entry ${openId === p.id ? 'open' : ''}" data-id="${p.id}">
        <div class="entry-row">
          ${pinnedList ? '<span class="grip" title="Zum Verschieben festhalten" aria-label="Verschieben">⠿</span>' : ''}
          <button class="texts">
            <span class="de">${esc(inputOf(p))}</span>
            <span class="en">${outputOf(p) ? esc(outputOf(p)) : '<i class="muted">wartet auf die KI-Prüfung</i>'}</span>
            ${tags(p)}
          </button>
        </div>
      </li>
    `);
    li.querySelector('.texts').addEventListener('click', () => toggleOpen(p.id));
    if (openId === p.id) li.appendChild(actions(p));
    if (pinnedList) enableDrag(li.querySelector('.grip'), li, ul);
    ul.appendChild(li);
  }
}

function tags(p) {
  const t = [];
  if (p.dir === 'en-de') t.push('🎧 gehört');
  if (p.human) t.push('✓ von dir korrigiert');
  if (p.learn === false) t.push('nur übersetzt');
  return t.length ? `<span class="muted small">${t.join(' · ')}</span>` : '';
}

function toggleOpen(id) {
  openId = openId === id ? null : id;
  renderLists();
}

function actions(p) {
  const el = h(`
    <div class="actions">
      <button class="accent-soft wide" data-a="copy" ${outputOf(p) ? '' : 'disabled'}>📋 Kopieren</button>
      <button class="secondary" data-a="share" ${outputOf(p) && navigator.share ? '' : 'hidden'}>↗ Teilen</button>
      <button class="secondary" data-a="say" ${p.en ? '' : 'disabled'}>🔈 Anhören</button>
      <button class="secondary" data-a="show" ${p.en ? '' : 'disabled'}>⛶ Zeigen</button>
      <button class="secondary" data-a="edit-de">✎ Deutsch</button>
      <button class="secondary" data-a="edit-en">✎ Englisch</button>
      <button class="secondary" data-a="pin">${p.pinned ? '📌 Lösen' : '📌 Anpinnen'}</button>
      <button class="secondary" data-a="learn">${p.learn === false ? '🎓 Lernen' : '🎓 Nicht lernen'}</button>
      <button class="secondary danger-soft" data-a="del">✕ Löschen</button>
    </div>
  `);
  const on = (a, fn) => el.querySelector(`[data-a="${a}"]`).addEventListener('click', fn);
  on('copy', () => copy(outputOf(p)));
  on('share', () => navigator.share({ text: outputOf(p) }).catch(() => {}));
  on('say', () => audio.speak(p.en, { rate: 0.95 }));
  on('show', () => showBig(p));
  on('edit-de', () => openEditor(p, 'de'));
  on('edit-en', () => openEditor(p, 'en'));
  on('pin', () => togglePin(p));
  on('learn', () => toggleLearn(p));
  on('del', () => removePhrase(p));
  return el;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return toast('Kopiert.');
  } catch {
    // Ersatzweg für Browser ohne Zwischenablage-Erlaubnis
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    toast(ok ? 'Kopiert.' : 'Kopieren nicht erlaubt – lang auf den Text drücken und markieren.');
  }
}

// ---------- Bearbeiten ----------
// Eigene Ansicht mit nur einem Feld, Speichern oben (die Tastatur verdeckt es so nie).
// Ausgangssatz geändert → neu übersetzen. Übersetzung geändert → gilt als von dir korrigiert
// und wird bei der KI-Prüfung nicht mehr überschrieben (nur die wörtliche Zeile kommt dazu).

const isInput = (p, lang) => lang === (p.dir === 'en-de' ? 'en' : 'de');

function openEditor(p, lang) {
  const el = h(`
    <div class="overlay editor" role="dialog" aria-label="Bearbeiten">
      <div class="overlay-bar">
        <button class="link" data-e-cancel>Abbrechen</button>
        <b>${lang === 'de' ? 'Deutsch ändern' : 'Englisch ändern'}</b>
        <button class="primary slim" data-e-save>Speichern</button>
      </div>
      <p class="muted small">${isInput(p, lang)
        ? 'Danach wird der Satz neu übersetzt.'
        : 'Zum Beispiel so, wie es dir jemand korrigiert hat. Deine Fassung bleibt dann geschützt.'}</p>
      <textarea data-e-text rows="3" spellcheck="true" lang="${lang}"></textarea>
      ${isInput(p, lang) ? '' : `<p class="muted small">${lang === 'en' ? 'Deutsch' : 'Englisch'}: ${esc(lang === 'en' ? p.de : p.en)}</p>`}
    </div>
  `);
  const ta = el.querySelector('[data-e-text]');
  ta.value = lang === 'de' ? p.de : p.en;
  const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  ta.addEventListener('input', grow);
  el.querySelector('[data-e-cancel]').addEventListener('click', closeOverlay);
  el.querySelector('[data-e-save]').addEventListener('click', () => saveEdit(p, lang, ta.value.trim(), el));
  openOverlay(el);
  grow();
  ta.focus();
}

async function saveEdit(p, lang, text, el) {
  const other = lang === 'de' ? 'en' : 'de';
  if (text === p[lang]) return closeOverlay();
  if (!text && isInput(p, lang)) return toast('Der Ausgangssatz darf nicht leer sein.');

  const fresh = await db.get('phrases', p.id);
  if (!isInput(p, lang)) {
    Object.assign(fresh, { [lang]: text, human: Boolean(text), decode: null, refined: false, source: text ? 'mensch' : 'offen' });
  } else {
    el.querySelector('[data-e-save]').textContent = 'Übersetze …';
    const result = await translate(text, { from: lang, to: other });
    Object.assign(fresh, { [lang]: text, [other]: result?.text || '', human: false, decode: null, refined: false, source: result?.source || 'offen' });
  }
  fresh.updated = Date.now();
  await db.put('phrases', fresh);
  closeOverlay();
  toast(isInput(p, lang) ? 'Neu übersetzt und gespeichert.' : 'Gespeichert – deine Fassung bleibt.');
  renderLists();
}

// ---------- Lernen an/aus ----------

async function toggleLearn(p) {
  const fresh = await db.get('phrases', p.id);
  fresh.learn = fresh.learn === false;
  fresh.updated = Date.now();
  await db.put('phrases', fresh);
  toast(fresh.learn ? 'Kommt wieder beim Üben dran.' : 'Nur übersetzt – kommt nicht beim Üben dran.');
  renderLists();
}

// ---------- Anpinnen und Verschieben ----------

async function togglePin(p) {
  const fresh = await db.get('phrases', p.id);
  if (fresh.pinned) {
    fresh.pinned = false;
  } else {
    const all = await db.getAll('phrases');
    fresh.pinned = true;
    fresh.pinOrder = Math.max(0, ...all.filter((x) => x.pinned).map((x) => (x.pinOrder ?? 0) + 1));
  }
  fresh.updated = Date.now();
  await db.put('phrases', fresh);
  renderLists();
}

// Am Griff festhalten und ziehen. Nur der Griff startet, damit Scrollen nichts verschiebt.
// Die Bewegung wird auf der ganzen Seite verfolgt: Beim Umsortieren wandert der Griff im Dokument
// mit, dabei würde er den Finger verlieren.
function enableDrag(grip, li, ul) {
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    li.classList.add('dragging');

    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const siblings = [...ul.children].filter((x) => x !== li);
      const after = siblings.find((x) => {
        const r = x.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      if (after) { if (li.nextSibling !== after) ul.insertBefore(li, after); }
      else if (ul.lastChild !== li) ul.appendChild(li);
    };
    const up = async (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      li.classList.remove('dragging');
      const ids = [...ul.children].map((x) => x.dataset.id);
      for (const [i, id] of ids.entries()) {
        const p = await db.get('phrases', id);
        if (p && p.pinOrder !== i) { p.pinOrder = i; await db.put('phrases', p); }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

// ---------- Zeigen-Modus ----------
// Englischer Satz bildschirmfüllend – zum Hinhalten im Gespräch.
// ✕ oben rechts und die Zurück-Geste schließen. Die Schrift passt sich der Länge an.

function bigSize(text) {
  const n = text.length;
  return n < 40 ? 3.2 : n < 90 ? 2.6 : n < 180 ? 2.1 : n < 320 ? 1.8 : 1.4;
}

function showBig(p) {
  const longDe = p.de.length > 120;
  const el = h(`
    <div class="overlay show-big" role="dialog" aria-label="Satz zeigen">
      <div class="overlay-bar">
        <button class="secondary slim" data-big-say>🔈 Anhören</button>
        <button class="icon-btn close" data-big-close aria-label="Schließen">✕</button>
      </div>
      <div class="big-body">
        <p class="big-en" style="font-size:${bigSize(p.en)}rem">${esc(p.en)}</p>
        ${longDe
          ? `<details class="big-de"><summary>Deutsch anzeigen</summary>${esc(p.de)}</details>`
          : `<p class="big-de">${esc(p.de)}</p>`}
      </div>
    </div>
  `);
  el.querySelector('[data-big-say]').addEventListener('click', () => audio.speak(p.en, { rate: 0.9 }));
  el.querySelector('[data-big-close]').addEventListener('click', closeOverlay);
  openOverlay(el);
}

// ---------- Löschen ----------

async function removePhrase(p) {
  const undo = await db.deletePhrase(p.id);
  openId = null;
  await renderLists();
  toast('Gelöscht.', {
    ms: 5000,
    action: { label: 'Rückgängig', run: async () => { await db.restorePhrase(undo); await renderLists(); } },
  });
}

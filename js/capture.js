// Übersetzen (Translator-Ersatz): deutschen Satz diktieren → englische Fassung → landet automatisch in den Übungskarten.
//
// Liste darunter: angepinnte Sätze (verschiebbar) und zuletzt übersetzte.
// Antippen klappt die Aktionen auf: Kopieren, Teilen, Bearbeiten, Anpinnen, Anhören, Zeigen, Löschen.

import * as db from './db.js';
import * as audio from './audio.js';
import { translate } from './translate.js';
import { renderDecode } from './decode.js';
import { h, esc, toast, openOverlay, closeOverlay } from './ui.js';

const RECENT = 15;

let root = null;
let openId = null;   // aufgeklappter Satz

export async function enter(el) {
  root = el;
  openId = null;
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

// ---------- Neu übersetzen ----------

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

  box.querySelector('.row').hidden = !result;
  if (result) {
    renderDecode(root.querySelector('[data-en-out]'), phrase);
    status.textContent = 'Gespeichert – kommt beim Üben als Karte dran.';
    root.querySelector('[data-copy-new]').onclick = () => copy(phrase.en);
    root.querySelector('[data-say]').onclick = () => audio.speak(phrase.en, { rate: 0.95 });
    root.querySelector('[data-show-new]').onclick = () => showBig(phrase);
    audio.speak(phrase.en, { rate: 0.95 });
  } else {
    root.querySelector('[data-en-out]').innerHTML = '';
    status.textContent = 'Gemerkt. Die englische Fassung kommt beim Veredeln (Reiter „Sätze“).';
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
            <span class="de">${esc(p.de)}</span>
            <span class="en">${p.en ? esc(p.en) : '<i class="muted">wartet aufs Veredeln</i>'}</span>
            ${p.human ? '<span class="muted small">✓ von dir korrigiert</span>' : ''}
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

function toggleOpen(id) {
  openId = openId === id ? null : id;
  renderLists();
}

function actions(p) {
  const el = h(`
    <div class="actions">
      <button class="accent-soft wide" data-a="copy" ${p.en ? '' : 'disabled'}>📋 Kopieren</button>
      <button class="secondary" data-a="share" ${p.en && navigator.share ? '' : 'hidden'}>↗ Teilen</button>
      <button class="secondary" data-a="say" ${p.en ? '' : 'disabled'}>🔈 Anhören</button>
      <button class="secondary" data-a="show" ${p.en ? '' : 'disabled'}>⛶ Zeigen</button>
      <button class="secondary" data-a="edit-de">✎ Deutsch</button>
      <button class="secondary" data-a="edit-en">✎ Englisch</button>
      <button class="secondary" data-a="pin">${p.pinned ? '📌 Lösen' : '📌 Anpinnen'}</button>
      <button class="secondary danger-soft" data-a="del">✕ Löschen</button>
    </div>
  `);
  const on = (a, fn) => el.querySelector(`[data-a="${a}"]`).addEventListener('click', fn);
  on('copy', () => copy(p.en));
  on('share', () => navigator.share({ text: p.en }).catch(() => {}));
  on('say', () => audio.speak(p.en, { rate: 0.95 }));
  on('show', () => showBig(p));
  on('edit-de', () => openEditor(p, 'de'));
  on('edit-en', () => openEditor(p, 'en'));
  on('pin', () => togglePin(p));
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
// Deutsch geändert → neu übersetzen. Englisch geändert → gilt als von dir korrigiert
// und wird beim Veredeln nicht mehr überschrieben (nur die wörtliche Zeile kommt dazu).

function openEditor(p, lang) {
  const el = h(`
    <div class="overlay editor" role="dialog" aria-label="Bearbeiten">
      <div class="overlay-bar">
        <button class="link" data-e-cancel>Abbrechen</button>
        <b>${lang === 'de' ? 'Deutsch ändern' : 'Englisch ändern'}</b>
        <button class="primary slim" data-e-save>Speichern</button>
      </div>
      <p class="muted small">${lang === 'de'
        ? 'Danach wird der Satz neu übersetzt.'
        : 'Zum Beispiel so, wie es dir jemand korrigiert hat. Deine Fassung bleibt dann geschützt.'}</p>
      <textarea data-e-text rows="3" spellcheck="true"></textarea>
      ${lang === 'en' ? `<p class="muted small">Deutsch: ${esc(p.de)}</p>` : ''}
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
  const old = lang === 'de' ? p.de : p.en;
  if (text === old) return closeOverlay();
  if (!text && lang === 'de') return toast('Der deutsche Satz darf nicht leer sein.');

  const fresh = await db.get('phrases', p.id);
  if (lang === 'en') {
    Object.assign(fresh, { en: text, human: Boolean(text), decode: null, refined: false, source: text ? 'mensch' : 'offen' });
  } else {
    el.querySelector('[data-e-save]').textContent = 'Übersetze …';
    const result = await translate(text);
    Object.assign(fresh, { de: text, en: result?.en || '', human: false, decode: null, refined: false, source: result?.source || 'offen' });
  }
  fresh.updated = Date.now();
  await db.put('phrases', fresh);
  closeOverlay();
  toast(lang === 'en' ? 'Gespeichert – deine Fassung bleibt.' : 'Neu übersetzt und gespeichert.');
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

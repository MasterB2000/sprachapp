// Sätze: Überblick, KI-Prüfung per Prompt, Export/Import, durchsuchbare Liste.
//
// KI-Prüfung: Auswahl (ungeprüft / komisch markiert / Startlektion / alle) → Liste mit Häkchen
// → Prompt kopieren → Antwort der KI einfügen → alt und neu nebeneinander → übernehmen.

import * as db from './db.js';
import * as srs from './srs.js';
import { buildCheckPrompt, parseResponse } from './prompt.js';
import { renderDecode } from './decode.js';
import { h, esc, toast, formatDay } from './ui.js';

const BATCH = 25; // mehr Karten pro Durchgang machen KI-Antworten unzuverlässig

const SCOPES = {
  unchecked: { label: 'Ungeprüft', pick: (p) => p.learn !== false && !p.refined && !db.isStartPhrase(p) },
  flagged: { label: 'Komisch markiert', pick: (p) => p.flagged },
  start: { label: 'Startlektion', pick: (p) => db.isStartPhrase(p) },
  all: { label: 'Alle', pick: (p) => p.learn !== false },
};

let root = null;
let phrases = [];
let scope = null;
let picked = new Set();
let parsed = null;
let query = '';

export async function enter(el) {
  root = el;
  scope = null;
  query = '';
  await render();
}

export function leave() {
  root = null;
  parsed = null;
}

async function render() {
  phrases = await db.getAll('phrases');
  const day = srs.today();
  const due = phrases.filter((p) => srs.isDue(p, day)).length;
  const fresh = phrases.filter(srs.isNew).length;
  const waiting = phrases.filter(srs.waitsForCheck).length;
  if (!scope) scope = phrases.some(SCOPES.unchecked.pick) ? 'unchecked' : phrases.some(SCOPES.flagged.pick) ? 'flagged' : 'start';

  root.innerHTML = '';
  root.appendChild(h(`
    <section class="library">
      <p class="finding">${phrases.length} Sätze · ${due} heute fällig · ${fresh} noch neu</p>
      ${waiting ? `<p class="muted small">${waiting} übersetzte ${waiting === 1 ? 'Satz wartet' : 'Sätze warten'} auf die Prüfung, bevor ${waiting === 1 ? 'er' : 'sie'} geübt ${waiting === 1 ? 'wird' : 'werden'}.</p>` : ''}

      <div class="panel">
        <h3>KI-Prüfung</h3>
        <p class="muted small">Eine KI deiner Wahl (Claude, ChatGPT …) prüft Karten und liefert natürliche Fassungen mit wörtlicher Zeile. Du siehst vorher, was geschickt wird, und nachher alt und neu nebeneinander.</p>
        <div class="chips" data-scopes>
          ${Object.entries(SCOPES).map(([k, sc]) => {
            const n = phrases.filter(sc.pick).length;
            return `<button class="chip ${k === scope ? 'active' : ''}" data-scope="${k}" ${n ? '' : 'disabled'}>${sc.label} <span>${n}</span></button>`;
          }).join('')}
        </div>
        <ul class="pick-list" data-pick></ul>
        <p class="muted small" data-pick-info></p>
        <ol class="steps">
          <li><button class="secondary" data-copy>Prompt kopieren</button>
              <span class="muted small">In Claude oder eine andere KI einfügen und abschicken.</span></li>
          <li><button class="secondary" data-paste>Antwort der KI einfügen</button></li>
        </ol>
        <textarea data-answer rows="4" placeholder="…oder hier lang drücken und Einfügen wählen" hidden></textarea>
        <div data-preview></div>
      </div>

      <div class="panel">
        <h3>Sichern</h3>
        <div class="row">
          <button class="secondary" data-export>Exportieren</button>
          <button class="secondary" data-import>Importieren</button>
          <input type="file" accept="application/json,.json" data-file hidden>
        </div>
        <p class="muted small">Sichert alle Sätze und den Lernstand als Datei. Aufnahmen bleiben auf dem Gerät.</p>
      </div>

      <h3>Alle Sätze</h3>
      <input type="search" class="search" data-search placeholder="Suchen – deutsch oder englisch" value="${esc(query)}">
      <ul class="phrase-list" data-phrases></ul>
    </section>
  `));

  root.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => {
    scope = b.dataset.scope;
    root.querySelectorAll('[data-scope]').forEach((x) => x.classList.toggle('active', x === b));
    fillPickList(true);
  }));
  fillPickList(true);
  bindCheck();
  bindBackup();
  const search = root.querySelector('[data-search]');
  search.addEventListener('input', () => { query = search.value; renderList(); });
  renderList();
}

// ---------- KI-Prüfung: Auswahl ----------

function fillPickList(reset) {
  const list = phrases.filter(SCOPES[scope].pick).sort((a, b) => a.id.localeCompare(b.id));
  if (reset) picked = new Set(list.slice(0, BATCH).map((p) => p.id));
  const ul = root.querySelector('[data-pick]');
  ul.innerHTML = '';
  for (const p of list) {
    const li = h(`
      <li>
        <label>
          <input type="checkbox" ${picked.has(p.id) ? 'checked' : ''}>
          <span class="pick-text">
            <span>${esc(p.dir === 'en-de' ? p.en : p.de)}</span>
            <span class="muted small">${esc((p.dir === 'en-de' ? p.de : p.en) || 'noch ohne Übersetzung')}${p.flagged ? ' · komisch markiert' : ''}${p.human ? ' · von dir korrigiert' : ''}</span>
          </span>
        </label>
      </li>
    `);
    li.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) picked.add(p.id); else picked.delete(p.id);
      pickInfo();
    });
    ul.appendChild(li);
  }
  pickInfo();
}

function pickInfo() {
  const n = picked.size;
  root.querySelector('[data-pick-info]').textContent = n > BATCH
    ? `${n} ausgewählt – mehr als ${BATCH} machen die KI-Antwort unzuverlässig. Lieber in mehreren Durchgängen.`
    : `${n} ${n === 1 ? 'Satz' : 'Sätze'} ausgewählt.`;
  root.querySelector('[data-copy]').disabled = !n;
}

// ---------- KI-Prüfung: Prompt und Antwort ----------

function bindCheck() {
  const area = root.querySelector('[data-answer]');

  root.querySelector('[data-copy]').addEventListener('click', async () => {
    const batch = phrases.filter((p) => picked.has(p.id));
    const text = buildCheckPrompt(batch);
    try {
      await navigator.clipboard.writeText(text);
      toast(`Prompt mit ${batch.length} ${batch.length === 1 ? 'Satz' : 'Sätzen'} kopiert. Jetzt in der KI einfügen.`);
    } catch {
      // Ohne Zugriff auf die Zwischenablage: Text zum Markieren anzeigen.
      area.value = text;
      area.hidden = false;
      area.select();
      toast('Bitte markierten Text kopieren.');
      return;
    }
    area.hidden = false;
  });

  root.querySelector('[data-paste]').addEventListener('click', async () => {
    area.hidden = false;
    try {
      area.value = await navigator.clipboard.readText();
    } catch {
      area.value = '';
      area.focus();
      toast('Lang ins Feld drücken und „Einfügen“ wählen.');
      return;
    }
    preview(area.value);
  });

  area.addEventListener('paste', () => setTimeout(() => preview(area.value), 0));
}

const sameDecode = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);

// Neue Fassung, wie sie übernommen würde (eigene Korrekturen bleiben geschützt).
function merged(p, it) {
  return {
    de: p.human ? p.de : it.de || p.de,
    en: p.human && p.dir !== 'en-de' ? p.en : it.en,
    decode: it.decode,
    note: it.note,
  };
}

function preview(text) {
  const box = root.querySelector('[data-preview]');
  const { items, problems } = parseResponse(text);
  const byId = new Map(phrases.map((p) => [p.id, p]));
  const known = items.filter((it) => byId.has(it.id));
  items.filter((it) => !byId.has(it.id)).forEach((it) => problems.push(`„${it.en}“: gehört zu keinem gespeicherten Satz – übersprungen.`));
  parsed = known;

  box.innerHTML = '';
  if (problems.length) box.appendChild(h(`<ul class="problems">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`));
  if (!known.length) return;

  const changedList = h('<ul class="preview-list"></ul>');
  const sameList = h('<ul class="preview-list"></ul>');
  let nChanged = 0;
  for (const it of known) {
    const p = byId.get(it.id);
    const m = merged(p, it);
    const enChanged = m.en !== p.en;
    const deChanged = m.de !== p.de;
    const changed = enChanged || deChanged || !sameDecode(m.decode, p.decode) || (m.note || '') !== (p.note || '');
    const li = h(`
      <li class="${changed ? 'changed' : ''}">
        <label class="take"><input type="checkbox" data-take="${it.id}" checked> übernehmen</label>
        <p class="de">${esc(m.de)}${deChanged ? ` <s class="old">${esc(p.de)}</s>` : ''}</p>
        ${enChanged && p.en ? `<p class="old"><s>${esc(p.en)}</s></p>` : ''}
        <div class="answer"></div>
        ${m.note ? `<p class="note">${esc(m.note)}</p>` : ''}
      </li>
    `);
    renderDecode(li.querySelector('.answer'), { ...p, ...m });
    (changed ? changedList : sameList).appendChild(li);
    if (changed) nChanged++;
  }

  const nSame = known.length - nChanged;
  if (nChanged) {
    box.appendChild(h(`<h4>${nChanged} ${nChanged === 1 ? 'Änderung' : 'Änderungen'}</h4>`));
    box.appendChild(changedList);
  }
  if (nSame) {
    const d = h(`<details><summary>${nSame} ${nSame === 1 ? 'Karte ist' : 'Karten sind'} in Ordnung – nur bestätigt</summary></details>`);
    d.appendChild(sameList);
    box.appendChild(d);
  }
  const apply = h('<button class="primary">Übernehmen</button>');
  apply.addEventListener('click', applyChecked);
  box.appendChild(apply);
}

async function applyChecked() {
  if (!parsed) return;
  const take = new Set([...root.querySelectorAll('[data-take]:checked')].map((x) => x.dataset.take));
  let n = 0;
  for (const it of parsed) {
    if (!take.has(it.id)) continue;
    const p = await db.get('phrases', it.id);
    if (!p) continue;
    // Lernstand bleibt, nur die Fassung wird ersetzt.
    Object.assign(p, merged(p, it), {
      source: p.human ? p.source : db.isStartPhrase(p) ? 'start' : 'prompt',
      refined: Boolean(it.decode),
      flagged: false,
      updated: Date.now(),
    });
    await db.put('phrases', p);
    n++;
  }
  toast(`${n} ${n === 1 ? 'Karte' : 'Karten'} übernommen.`);
  parsed = null;
  scope = null;
  await render();
}

// ---------- Sichern ----------

function bindBackup() {
  root.querySelector('[data-export]').addEventListener('click', async () => {
    const data = await db.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sprachapp-${srs.today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  const file = root.querySelector('[data-file]');
  root.querySelector('[data-import]').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const { added, updated } = await db.importData(JSON.parse(await f.text()));
      toast(`Eingelesen: ${added} neu, ${updated} aktualisiert.`);
      await render();
    } catch (err) {
      toast('Datei nicht lesbar: ' + err.message);
    }
  });
}

// ---------- Liste ----------

function status(p) {
  if (p.learn === false) return 'nur übersetzt';
  if (!p.en || !p.de) return 'wartet auf Übersetzung';
  if (srs.waitsForCheck(p)) return 'wartet auf Prüfung';
  if (p.reps === 0) return 'neu';
  return `fällig ${formatDay(p.due)}`;
}

function renderList() {
  const list = root.querySelector('[data-phrases]');
  const q = query.trim().toLowerCase();
  const shown = [...phrases]
    .filter((p) => !q || `${p.de} ${p.en}`.toLowerCase().includes(q))
    .sort((a, b) => b.created - a.created);
  list.innerHTML = '';
  if (!shown.length) {
    list.innerHTML = `<li class="muted">${q ? 'Nichts gefunden.' : 'Noch keine Sätze.'}</li>`;
    return;
  }
  for (const p of shown) {
    const li = h(`
      <li>
        <button class="phrase-row">
          <span class="de">${esc(p.de)}</span>
          <span class="en">${esc(p.en || '')}</span>
          <span class="muted small">${p.dir === 'en-de' ? '🎧 · ' : ''}${status(p)}</span>
        </button>
        <div class="phrase-actions" hidden>
          <button class="danger" data-del>Löschen</button>
        </div>
      </li>
    `);
    li.querySelector('.phrase-row').addEventListener('click', () => {
      const a = li.querySelector('.phrase-actions');
      a.hidden = !a.hidden;
    });
    li.querySelector('[data-del]').addEventListener('click', async () => {
      const undo = await db.deletePhrase(p.id);
      phrases = phrases.filter((x) => x.id !== p.id);
      li.remove();
      toast('Gelöscht.', {
        ms: 5000,
        action: { label: 'Rückgängig', run: async () => { await db.restorePhrase(undo); if (root) await render(); } },
      });
    });
    list.appendChild(li);
  }
}

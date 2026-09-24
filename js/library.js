// Speicher: Überblick, Veredeln per Prompt, Export/Import, Liste.

import * as db from './db.js';
import * as srs from './srs.js';
import { buildRefinePrompt, parseResponse } from './prompt.js';
import { renderDecode } from './decode.js';
import * as audio from './audio.js';
import * as voice from './voice.js';
import { h, esc, toast, formatDay } from './ui.js';

const PROMPT_BATCH = 25;

let root = null;
let parsed = null;

export async function enter(el) {
  root = el;
  await render();
}

export function leave() {
  root = null;
  parsed = null;
}

async function render() {
  const phrases = await db.getAll('phrases');
  const day = srs.today();
  const due = phrases.filter((p) => srs.isDue(p, day)).length;
  const fresh = phrases.filter(srs.isNew).length;
  const unrefined = phrases.filter((p) => !p.refined);
  const currentVoice = await voice.getVoice();

  root.innerHTML = '';
  root.appendChild(h(`
    <section class="library">
      <p class="finding">${phrases.length} Wendungen · ${due} heute fällig · ${fresh} noch neu</p>

      <div class="panel">
        <h3>Veredeln</h3>
        ${unrefined.length ? `
          <p class="muted">${unrefined.length} ${unrefined.length === 1 ? 'Satz wartet' : 'Sätze warten'} auf eine natürliche Fassung mit wörtlicher Übersetzung.</p>
          <ol class="steps">
            <li><button class="secondary" data-copy>Prompt kopieren (${Math.min(unrefined.length, PROMPT_BATCH) === 1 ? '1 Satz' : Math.min(unrefined.length, PROMPT_BATCH) + ' Sätze'})</button>
                <span class="muted">In Claude oder eine andere KI einfügen.</span></li>
            <li><button class="secondary" data-paste>Antwort der KI einfügen</button></li>
          </ol>
          <textarea data-answer rows="4" placeholder="…oder hier lang drücken und Einfügen wählen" hidden></textarea>
          <div data-preview></div>
        ` : '<p class="muted">Alles veredelt.</p>'}
      </div>

      <div class="panel">
        <h3>Stimme</h3>
        <div class="row">
          <select data-voice>
            ${voice.VOICES.map((v) => `<option value="${v.id}" ${v.id === currentVoice ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
          <button class="secondary" data-voice-try>Probe hören</button>
        </div>
        <p class="muted small" data-voice-state>${voiceState()}</p>
      </div>

      <div class="panel">
        <h3>Sichern</h3>
        <div class="row">
          <button class="secondary" data-export>Exportieren</button>
          <button class="secondary" data-import>Importieren</button>
          <input type="file" accept="application/json,.json" data-file hidden>
        </div>
        <p class="muted">Sichert alle Wendungen und den Lernstand als Datei. Aufnahmen bleiben auf dem Gerät.</p>
      </div>

      <h3>Alle Wendungen</h3>
      <ul class="phrase-list" data-list></ul>
    </section>
  `));

  bindRefine(unrefined.slice(0, PROMPT_BATCH));
  bindVoice();
  bindBackup();
  renderList(phrases);
}

// ---------- Veredeln ----------

function bindRefine(batch) {
  const copy = root.querySelector('[data-copy]');
  if (!copy) return;
  const area = root.querySelector('[data-answer]');

  copy.addEventListener('click', async () => {
    const text = buildRefinePrompt(batch);
    try {
      await navigator.clipboard.writeText(text);
      toast('Prompt kopiert. Jetzt in der KI einfügen.');
    } catch {
      // Ohne Zugriff auf die Zwischenablage: Text zum Markieren anzeigen.
      area.hidden = false;
      area.value = text;
      area.select();
      toast('Bitte markierten Text kopieren.');
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

async function preview(text) {
  const box = root.querySelector('[data-preview]');
  const { items, problems } = parseResponse(text);
  const byId = new Map((await db.getAll('phrases')).map((p) => [p.id, p]));

  const known = items.filter((it) => byId.has(it.id));
  items.filter((it) => !byId.has(it.id)).forEach((it) => problems.push(`„${it.en}“: gehört zu keinem gespeicherten Satz – übersprungen.`));
  parsed = known;

  box.innerHTML = '';
  if (problems.length) {
    box.appendChild(h(`<ul class="problems">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`));
  }
  if (!known.length) return;

  const list = h('<ul class="preview-list"></ul>');
  for (const it of known) {
    const li = h(`<li><p class="de">${esc(it.de || byId.get(it.id).de)}</p><div class="answer"></div>${it.note ? `<p class="note">${esc(it.note)}</p>` : ''}</li>`);
    renderDecode(li.querySelector('.answer'), it);
    list.appendChild(li);
  }
  box.appendChild(list);

  const apply = h(`<button class="primary">${known.length} übernehmen</button>`);
  apply.addEventListener('click', applyRefined);
  box.appendChild(apply);
}

async function applyRefined() {
  if (!parsed) return;
  for (const it of parsed) {
    const p = await db.get('phrases', it.id);
    if (!p) continue;
    // Lernstand bleibt, nur die Fassung wird ersetzt.
    Object.assign(p, {
      de: it.de || p.de,
      en: it.en,
      decode: it.decode,
      note: it.note,
      source: 'prompt',
      refined: Boolean(it.decode),
      updated: Date.now(),
    });
    await db.put('phrases', p);
  }
  toast(`${parsed.length} Wendungen veredelt.`);
  parsed = null;
  await render();
}

// ---------- Stimme ----------

const SAMPLE = "I'm looking forward to the weekend. We could bake some bread together.";

function voiceState() {
  return {
    idle: 'Wird beim nächsten Start geladen.',
    loading: 'Wird geladen – beim ersten Mal ca. 115 MB, danach offline.',
    ready: 'Bereit, läuft offline.',
    failed: 'Konnte nicht geladen werden – solange spricht die Systemstimme.',
  }[voice.status()];
}

function bindVoice() {
  const select = root.querySelector('[data-voice]');
  const btn = root.querySelector('[data-voice-try]');
  const stateEl = root.querySelector('[data-voice-state]');

  select.addEventListener('change', () => voice.setVoice(select.value));
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Erzeuge …';
    try {
      voice.warmUp();
      const blob = await voice.getAudio(SAMPLE, select.value);
      await audio.playBlob(blob);
    } catch (err) {
      toast('Stimme nicht verfügbar: ' + err.message);
    } finally {
      if (root) {
        btn.disabled = false;
        btn.textContent = 'Probe hören';
        stateEl.textContent = voiceState();
      }
    }
  });
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

function renderList(phrases) {
  const list = root.querySelector('[data-list]');
  const sorted = [...phrases].sort((a, b) => b.created - a.created);
  for (const p of sorted) {
    const when = !p.en ? 'wartet aufs Veredeln' : p.reps === 0 ? 'neu' : `fällig ${formatDay(p.due)}`;
    const li = h(`
      <li>
        <button class="phrase-row">
          <span class="de">${esc(p.de)}</span>
          <span class="en">${esc(p.en || '')}</span>
          <span class="muted small">${when}</span>
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
      if (!confirm(`„${p.de}“ löschen?`)) return;
      await db.del('phrases', p.id);
      await db.del('recordings', p.id);
      li.remove();
    });
    list.appendChild(li);
  }
}

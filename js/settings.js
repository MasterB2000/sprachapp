// Optionen: Üben, Anzeige und Stimmen.

import * as db from './db.js';
import * as srs from './srs.js';
import * as audio from './audio.js';
import * as voice from './voice.js';
import { h, esc, toast, FONT_SCALES, applyFontScale } from './ui.js';

let root = null;

export async function enter(el) {
  root = el;
  await render();
}

export function leave() {
  audio.stopSpeaking();
  resetTry();
  root = null;
}

async function render() {
  const googleKeySet = Boolean(await voice.googleKey());
  const literal = await db.getSetting('literal', 'tip');
  const fontScale = await db.getSetting('fontScale', 1);
  const minutes = await db.getSetting('sessionMinutes', 10);
  const allowUnchecked = await db.getSetting('allowUnchecked', false);

  root.innerHTML = '';
  root.appendChild(h(`
    <section class="settings">
      <div class="panel">
        <h3>Üben</h3>
        <div class="setting">
          <span>Dauer einer Runde</span>
          <div class="seg" data-minutes>
            ${[5, 10, 15, 20].map((m) => `<button data-v="${m}" class="${m === minutes ? 'active' : ''}">${m}</button>`).join('')}
          </div>
        </div>
        <p class="muted small">Minuten. Danach bietet die App eine weitere Runde an – freiwillig.</p>
        <label class="setting">
          <span>Ungeprüfte Übersetzungen schon üben</span>
          <input type="checkbox" data-unchecked ${allowUnchecked ? 'checked' : ''}>
        </label>
        <p class="muted small">Aus (empfohlen): Sätze aus dem Übersetzer werden erst geübt, wenn sie per KI-Prüfung oder von dir korrigiert sind. So lernst du kein Maschinen-Englisch. Hör-Karten sind immer dabei.</p>
      </div>

      <div class="panel">
        <h3>Anzeige</h3>
        <label class="setting">
          <span>Wörtliche Übersetzung</span>
          <select data-literal>
            <option value="tip" ${literal === 'tip' ? 'selected' : ''}>nur als Tipp</option>
            <option value="always" ${literal === 'always' ? 'selected' : ''}>immer</option>
            <option value="off" ${literal === 'off' ? 'selected' : ''}>aus</option>
          </select>
        </label>
        <p class="muted small">Zeigt, was jedes englische Wort wörtlich heißt: „ich · will · zu · backen“. So wird sichtbar, wo Englisch anders gebaut ist als Deutsch.</p>
        <div class="setting">
          <span>Schrift</span>
          <div class="seg" data-font>
            ${FONT_SCALES.map((f, i) => `<button data-v="${f}" class="${f === fontScale ? 'active' : ''}" style="font-size:${0.85 + i * 0.2}rem">A</button>`).join('')}
          </div>
        </div>
      </div>

      <div class="panel voices">
        <h3>Stimmen</h3>
        <p class="voice-head"><b>Englisch</b> <span class="muted small">– die Musterstimme</span></p>
        <ul class="voice-list" data-list="en"></ul>
        <p class="voice-head"><b>Deutsch</b> <span class="muted small">– liest die Fragen vor (🔈)</span></p>
        <ul class="voice-list" data-list="de"></ul>

        <details class="google" ${googleKeySet ? '' : 'open'}>
          <summary>Google-Stimmen ${googleKeySet ? '<span class="muted small">(Schlüssel eingetragen)</span>' : '<span class="muted small">(eigener Schlüssel)</span>'}</summary>
          <p class="muted small">Der Schlüssel wird nur auf diesem Gerät gespeichert und nie hochgeladen. Jeder Satz wird einmal online erzeugt und danach offline abgespielt.</p>
          <div class="row">
            <input type="password" data-gkey placeholder="${googleKeySet ? 'Neuen Schlüssel einfügen' : 'API-Schlüssel einfügen'}" autocomplete="off" spellcheck="false">
            <button class="secondary" data-gsave>Speichern</button>
          </div>
          <p class="small" data-gstate></p>
          ${googleKeySet ? '<button class="link small" data-gremove>Schlüssel entfernen</button>' : ''}
          <label class="setting small"><span>Auch ältere Google-Stimmen zeigen</span><input type="checkbox" data-gall></label>
          <details>
            <summary class="small">So sicherst du den Schlüssel ab</summary>
            <ol class="small muted">
              <li>Eigenen Schlüssel nur für diese App anlegen (nicht den von anderen Programmen).</li>
              <li>Anwendungseinschränkung: Websites → <code>https://masterb2000.github.io/*</code></li>
              <li>API-Einschränkung: nur „Cloud Text-to-Speech API“.</li>
              <li>Kontingent: Anfragen pro Tag begrenzen, z. B. auf 500.</li>
            </ol>
          </details>
        </details>
      </div>

    </section>
  `));

  bindPractice();
  bindDisplay();
  bindVoice();
}

// ---------- Üben und Anzeige ----------

function bindPractice() {
  root.querySelectorAll('[data-minutes] button').forEach((b) => b.addEventListener('click', async () => {
    await db.setSetting('sessionMinutes', Number(b.dataset.v));
    root.querySelectorAll('[data-minutes] button').forEach((x) => x.classList.toggle('active', x === b));
  }));
  root.querySelector('[data-unchecked]').addEventListener('change', async (e) => {
    await db.setSetting('allowUnchecked', e.target.checked);
    srs.setAllowUnchecked(e.target.checked);
  });
}

function bindDisplay() {
  root.querySelector('[data-literal]').addEventListener('change', (e) => db.setSetting('literal', e.target.value));
  root.querySelectorAll('[data-font] button').forEach((b) => b.addEventListener('click', async () => {
    const v = Number(b.dataset.v);
    applyFontScale(v);
    await db.setSetting('fontScale', v);
    root.querySelectorAll('[data-font] button').forEach((x) => x.classList.toggle('active', x === b));
  }));
}

// ---------- Stimmen ----------

let showAllGoogle = false;
let trying = null; // Knopf, dessen Probe gerade läuft

const ACCENT = { 'en-GB': 'britisch', 'en-US': 'amerikanisch', 'de-DE': '' };

// Alle wählbaren Stimmen einer Sprache, gruppiert.
async function voiceOptions(lang) {
  const groups = [];
  if (lang === 'en') {
    groups.push({
      title: 'Offline',
      items: voice.KOKORO_VOICES.map((v) => ({ sel: { provider: 'kokoro', id: v.id }, name: v.label, tag: `${v.accent} · offline` })),
    });
  } else {
    groups.push({
      title: 'Offline',
      items: voice.PIPER_VOICES.map((v) => ({ sel: { provider: 'piper', id: v.id }, name: v.label, tag: `${v.note} · offline · einmalig ca. 80 MB` })),
    });
  }
  const google = (await voice.googleVoices().catch(() => []))
    .filter((v) => v.lang === lang && (showAllGoogle || v.best));
  if (google.length) {
    groups.push({
      title: `Google (${google.length})`,
      collapsed: true,
      items: google.map((v) => ({
        sel: { provider: 'google', id: v.id },
        name: v.label,
        tag: [ACCENT[v.code], v.gender, v.kind].filter(Boolean).join(' · '),
      })),
    });
  }
  groups.push({ title: 'Handy', items: [{ sel: { provider: 'system', id: '' }, name: 'Systemstimme', tag: 'Stimme des Handys' }] });
  return groups;
}

const same = (a, b) => a.provider === b.provider && a.id === b.id;

async function renderVoiceList(lang) {
  const ul = root?.querySelector(`[data-list="${lang}"]`);
  if (!ul) return;
  const current = await voice.selected(lang);
  const groups = await voiceOptions(lang);
  ul.innerHTML = '';
  for (const g of groups) {
    const open = !g.collapsed || g.items.some((it) => same(it.sel, current));
    const group = h(`<li class="voice-group"><details ${open ? 'open' : ''}><summary class="muted small">${esc(g.title)}</summary><ul></ul></details></li>`);
    const inner = group.querySelector('ul');
    for (const it of g.items) {
      const active = same(it.sel, current);
      const li = h(`
        <li class="voice-item ${active ? 'active' : ''}">
          <label>
            <input type="radio" name="voice-${lang}" ${active ? 'checked' : ''}>
            <span class="voice-name">${esc(it.name)}</span>
            <span class="muted small">${esc(it.tag)}</span>
          </label>
          <button class="secondary try" title="Probe hören">▶</button>
        </li>
      `);
      li.querySelector('input').addEventListener('change', async () => {
        await voice.select(lang, it.sel);
        voice.warmUp();
        ul.querySelectorAll('.voice-item').forEach((x) => x.classList.toggle('active', x === li));
      });
      li.querySelector('.try').addEventListener('click', (e) => tryVoice(e.currentTarget, lang, it.sel));
      inner.appendChild(li);
    }
    ul.appendChild(group);
  }
}

async function tryVoice(btn, lang, sel) {
  audio.stopSpeaking();
  if (trying === btn) { resetTry(); return; }
  resetTry();
  trying = btn;
  btn.textContent = '…';
  try {
    if (sel.provider === 'system') {
      btn.textContent = '■';
      await audio.systemSpeak(voice.SAMPLES[lang], { lang });
    } else {
      const blob = await voice.getAudio(voice.SAMPLES[lang], lang, sel);
      if (trying !== btn) return;
      btn.textContent = '■';
      await audio.playBlob(blob);
    }
  } catch (err) {
    toast('Stimme nicht verfügbar: ' + err.message, { ms: 8000 });
  } finally {
    if (trying === btn) resetTry();
  }
}

function resetTry() {
  if (trying) trying.textContent = '▶';
  trying = null;
}

function bindVoice() {
  renderVoiceList('en');
  renderVoiceList('de');

  const input = root.querySelector('[data-gkey]');
  const state = root.querySelector('[data-gstate]');

  root.querySelector('[data-gsave]').addEventListener('click', async () => {
    if (!input.value.trim()) return;
    await voice.setGoogleKey(input.value);
    input.value = '';
    state.textContent = 'Prüfe Schlüssel …';
    try {
      const list = await voice.googleVoices({ refresh: true });
      state.textContent = `Schlüssel funktioniert – ${list.length} Stimmen gefunden. Du findest sie oben in den Listen unter „Google“.`;
      renderVoiceList('en');
      renderVoiceList('de');
    } catch (err) {
      state.textContent = 'Google meldet: ' + err.message;
    }
  });

  root.querySelector('[data-gremove]')?.addEventListener('click', async () => {
    if (!confirm('Google-Schlüssel von diesem Gerät entfernen?')) return;
    await voice.setGoogleKey('');
    await db.setSetting('google.voices', null);
    for (const lang of ['en', 'de']) {
      if ((await voice.selected(lang)).provider === 'google') await voice.select(lang, null);
    }
    await render();
  });

  root.querySelector('[data-gall]').addEventListener('change', (e) => {
    showAllGoogle = e.target.checked;
    renderVoiceList('en');
    renderVoiceList('de');
  });
}


// Wiederholungsrunde.
// Ablauf je Wendung: Deutsch → selbst sprechen (Aufnahme) → Muster → eigene Aufnahme → saß / saß nicht.

import * as db from './db.js';
import * as srs from './srs.js';
import * as audio from './audio.js';
import * as voice from './voice.js';
import { renderDecode, fadeAlong, showAll, cancelFade } from './decode.js';
import { h, esc, toast, formatDay } from './ui.js';

const SESSION_MS = 10 * 60 * 1000;
const NEW_PER_DAY = 8;
const MAX_RECORD_MS = 30000;

// Der eine Schieber: Tempo der Stimme, wie lange Wörter stehen bleiben, Pause vor der eigenen Aufnahme.
// Ab Stufe 4 zusätzlich weniger Text (siehe srs.textStage).
const LEVELS = {
  1: { rate: 0.7, visible: 2200, gap: 1400, label: 'sehr ruhig' },
  2: { rate: 0.8, visible: 1800, gap: 1100, label: 'ruhig' },
  3: { rate: 0.9, visible: 1400, gap: 900, label: 'normal' },
  4: { rate: 1.0, visible: 1100, gap: 700, label: 'zügig' },
  5: { rate: 1.1, visible: 900, gap: 500, label: 'schnell' },
};

let root = null;
let s = null;          // Zustand der laufenden Runde
let recordTimer = null;

export async function enter(el) {
  root = el;
  s = { level: await db.getSetting('level', 2) };
  await startRound(false);
}

export function leave() {
  stopAll();
  if (audio.isRecording()) audio.stopRecording();
  clearTimeout(recordTimer);
  root = null;
}

function stopAll() {
  audio.stopSpeaking();
  audio.stopPlayback();
  cancelFade();
}

const lv = () => LEVELS[s.level];

// ---------- Runde ----------

async function startRound(extra) {
  const phrases = await db.getAll('phrases');
  const queue = srs.buildQueue(phrases, { newPerDay: NEW_PER_DAY, ignoreNewLimit: extra });
  Object.assign(s, { queue, started: Date.now(), done: 0, firstTry: 0, retried: new Set() });
  if (!queue.length) return renderEmpty(phrases);
  // Stimme für die ganze Runde der Reihe nach im Hintergrund erzeugen.
  queue.forEach((q) => voice.prepare(q.en));
  showCard();
}

function continueRound() {
  s.started = Date.now();
  showCard();
}

function roundOver() {
  return !s.queue.length || Date.now() - s.started >= SESSION_MS;
}

// ---------- Karte ----------

function showCard() {
  if (!root) return;
  const p = s.queue[0];
  s.card = { phrase: p, blob: null, stage: srs.textStage(p, s.level), retry: s.retried.has(p.id) };

  root.innerHTML = '';
  root.appendChild(h(`
    <section class="review">
      <header class="bar">
        <span class="muted">${s.queue.length === 1 ? 'letzte' : `noch ${s.queue.length}`}${s.card.retry ? ' · zweiter Anlauf' : ''}</span>
        <label class="level">
          <span>Tempo: <b data-level-label>${lv().label}</b></span>
          <input type="range" min="1" max="5" step="1" value="${s.level}" data-level>
        </label>
      </header>

      <div class="card">
        <p class="de-sentence">${esc(p.de)}</p>
        <button class="icon-btn" data-say-de title="Deutsch anhören">🔈</button>
        <div class="answer" data-answer></div>
        <p class="note" data-note hidden></p>
      </div>

      <div class="controls" data-controls></div>
    </section>
  `));

  root.querySelector('[data-level]').addEventListener('input', async (e) => {
    s.level = Number(e.target.value);
    root.querySelector('[data-level-label]').textContent = lv().label;
    await db.setSetting('level', s.level);
  });
  root.querySelector('[data-say-de]').addEventListener('click', () => audio.speak(p.de, { lang: 'de', rate: lv().rate + 0.1 }));

  askControls();
}

function controls(html) {
  const c = root.querySelector('[data-controls]');
  c.innerHTML = html;
  return c;
}

function askControls() {
  const c = controls(`
    <button class="mic" data-mic>
      <span class="mic-dot"></span>
      <span data-mic-label>Auf Englisch sagen</span>
    </button>
    <button class="link" data-skip>ohne Aufnahme aufdecken</button>
  `);
  c.querySelector('[data-mic]').addEventListener('click', toggleRecording);
  c.querySelector('[data-skip]').addEventListener('click', () => reveal());
  if (!audio.canRecord()) c.querySelector('[data-mic]').hidden = true;
}

async function toggleRecording() {
  const btn = root.querySelector('[data-mic]');
  if (!audio.isRecording()) {
    try {
      stopAll();
      await audio.startRecording();
    } catch (err) {
      toast('Mikrofon nicht freigegeben – es geht auch ohne Aufnahme.');
      return reveal();
    }
    btn.classList.add('recording');
    root.querySelector('[data-mic-label]').textContent = 'Fertig';
    recordTimer = setTimeout(toggleRecording, MAX_RECORD_MS);
  } else {
    clearTimeout(recordTimer);
    btn.classList.remove('recording');
    const blob = await audio.stopRecording();
    s.card.blob = blob;
    if (blob) db.put('recordings', { id: s.card.phrase.id, blob, date: srs.today() });
    reveal();
  }
}

// ---------- Aufdecken und vergleichen ----------

function reveal() {
  const { phrase: p, stage } = s.card;
  const answer = root.querySelector('[data-answer]');
  s.card.line = renderDecode(answer, p);
  if (stage > 0) answer.classList.add('veiled');

  const c = controls(`
    <div class="row">
      <button class="secondary" data-again>${s.card.blob ? 'Nochmal vergleichen' : 'Nochmal hören'}</button>
      <button class="secondary" data-show ${stage === 2 ? 'disabled' : ''}>Text zeigen</button>
      <button class="secondary" data-why ${p.note ? '' : 'hidden'}>Warum?</button>
    </div>
    <div class="row grade">
      <button class="grade-bad" data-bad>Saß nicht</button>
      <button class="grade-good" data-good>Saß</button>
    </div>
  `);
  c.querySelector('[data-again]').addEventListener('click', () => compare());
  c.querySelector('[data-show]').addEventListener('click', () => {
    answer.classList.remove('veiled');
    showAll(s.card.line);
  });
  c.querySelector('[data-why]').addEventListener('click', () => {
    const n = root.querySelector('[data-note]');
    n.textContent = p.note;
    n.hidden = false;
  });
  c.querySelector('[data-bad]').addEventListener('click', () => rate(false));
  c.querySelector('[data-good]').addEventListener('click', () => rate(true));

  compare();
}

async function compare() {
  const { phrase: p, line, stage, blob } = s.card;
  stopAll();
  if (stage === 0) {
    showAll(line);
    fadeAlong(line, { rate: lv().rate, visibleMs: lv().visible });
  }
  await audio.speak(p.en, { lang: 'en', rate: lv().rate });
  if (blob && root) {
    await audio.wait(lv().gap);
    await audio.playBlob(blob);
  }
  // Ohne Text geübt: nach dem Hören darf man nachsehen.
  const show = root?.querySelector('[data-show]');
  if (show) show.disabled = false;
}

async function rate(ok) {
  stopAll();
  const p = s.queue.shift();
  if (s.card.retry) {
    // Zweiter Anlauf in derselben Runde ändert den Plan nicht mehr.
  } else {
    srs.grade(p, ok);
    await db.put('phrases', p);
    s.done++;
    if (ok) s.firstTry++;
    if (!ok) { s.retried.add(p.id); s.queue.push(p); }
  }
  if (roundOver()) return renderEnd();
  showCard();
}

// ---------- Ende und Leerlauf ----------

async function renderEnd() {
  const phrases = await db.getAll('phrases');
  const minutes = Math.max(1, Math.round((Date.now() - s.started) / 60000));
  const rest = s.queue.length;
  const more = rest || srs.buildQueue(phrases, { ignoreNewLimit: true }).length;
  const next = srs.nextDue(phrases);

  root.innerHTML = '';
  root.appendChild(h(`
    <section class="done">
      <h2>Runde vorbei</h2>
      <p class="finding">${s.done} ${s.done === 1 ? 'Wendung' : 'Wendungen'} in ${minutes} Min., ${s.firstTry} davon saßen auf Anhieb.</p>
      ${next ? `<p class="muted">Als Nächstes: ${formatDay(next.date)} ${next.count} ${next.count === 1 ? 'Wendung' : 'Wendungen'}.</p>` : ''}
      ${rest ? `<p class="muted">Heute noch ${rest} offen – die laufen nicht weg.</p>` : ''}
      <div class="stack">
        ${more ? '<button class="primary" data-more>Noch eine Runde</button>' : ''}
      </div>
    </section>
  `));
  root.querySelector('[data-more]')?.addEventListener('click', () => (rest ? continueRound() : startRound(true)));
}

function renderEmpty(phrases) {
  const next = srs.nextDue(phrases);
  const fresh = phrases.filter(srs.isNew).length;
  const pending = phrases.filter((p) => !srs.isReady(p)).length;

  root.innerHTML = '';
  root.appendChild(h(`
    <section class="done">
      <h2>Heute nichts fällig</h2>
      ${next ? `<p class="finding">Nächste Wendungen ${formatDay(next.date)}: ${next.count}.</p>` : ''}
      ${pending ? `<p class="muted">${pending} erfasste Sätze warten aufs Veredeln (Speicher).</p>` : ''}
      ${!next && !fresh ? '<p class="muted">Erfasse Sätze aus deinem Alltag unter „Erfassen“.</p>' : ''}
      <div class="stack">
        ${fresh ? `<button class="primary" data-new>Neue Wendungen üben (${fresh})</button>` : ''}
      </div>
    </section>
  `));
  root.querySelector('[data-new]')?.addEventListener('click', () => startRound(true));
}

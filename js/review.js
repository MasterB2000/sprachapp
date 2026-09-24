// Wiederholungsrunde.
//
// Ablauf je Karte:
//   1. Frage     – deutscher Satz; Sprechen oder Tipp (erst wörtlich, dann Lösung)
//   2. Aufnahme  – Pegelbalken zeigt, dass das Mikrofon hört
//   3. Auflösung – Englisch bleibt stehen; Muster / Ich nur auf Knopfdruck
//   4. Bewertung – Noch nicht / Wackelig / Sitzt (Tipp begrenzt die Bewertung)
// "Nochmal versuchen" führt mit derselben Karte zurück zu 1.
//
// Hör-Karten (gehörte Sätze, Richtung en-de): Englisch wird vorgespielt, du sollst es verstehen.
// Englisch mitlesen ist der Tipp (höchstens "Wackelig"); Auflösen zeigt die Bedeutung.

import * as db from './db.js';
import * as srs from './srs.js';
import * as audio from './audio.js';
import * as voice from './voice.js';
import { renderDecode, literalLine } from './decode.js';
import { h, esc, toast, formatDay } from './ui.js';

const SESSION_MS = 10 * 60 * 1000;
const NEW_PER_DAY = 8;
const MAX_RECORD_MS = 30000;

// Der eine Schieber: Tempo der Musterstimme.
const LEVELS = {
  1: { rate: 0.7, label: 'sehr ruhig' },
  2: { rate: 0.8, label: 'ruhig' },
  3: { rate: 0.9, label: 'normal' },
  4: { rate: 1.0, label: 'zügig' },
  5: { rate: 1.1, label: 'schnell' },
};

const RATING_TEXT = { good: 'Sitzt', hard: 'Wackelig', again: 'Noch nicht' };

let root = null;
let s = null;          // Zustand der laufenden Runde
let recordTimer = null;
let ticker = null;
let meterFrame = null;

export async function enter(el, opts = {}) {
  root = el;
  s = {
    level: await db.getSetting('level', 2),
    literal: await db.getSetting('literal', 'tip'), // tip | always | off
    playToken: 0,
    playing: null,
    mode: 'plan', // plan = nach Wiederholungsplan | pinned = nur angepinnte, ändert den Plan nicht
  };
  if (opts.mode === 'pinned') await startPinned();
  else await startRound(false);
}

export function leave() {
  stopAudio();
  if (audio.isRecording()) audio.stopRecording();
  clearTimeout(recordTimer);
  clearInterval(ticker);
  cancelAnimationFrame(meterFrame);
  root = null;
}

const lv = () => LEVELS[s.level];

// ---------- Runde ----------

async function startRound(extra) {
  const phrases = await db.getAll('phrases');
  const queue = srs.buildQueue(phrases, { newPerDay: NEW_PER_DAY, ignoreNewLimit: extra });
  return beginRound(queue, 'plan', phrases);
}

// Nur die angepinnten Sätze in deiner Reihenfolge. Freies Üben: Bewertungen ändern den Plan nicht.
async function startPinned() {
  const phrases = await db.getAll('phrases');
  const queue = phrases.filter((p) => p.pinned && p.en).sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0));
  return beginRound(queue, 'pinned', phrases);
}

async function beginRound(queue, mode, phrases) {
  s.mode = mode;
  Object.assign(s, {
    queue, started: Date.now(), done: 0, retried: new Set(),
    counts: { good: 0, hard: 0, again: 0 }, firstCard: true,
  });
  if (!queue.length) return renderEmpty(phrases);
  // Stimme für die ganze Runde der Reihe nach im Hintergrund erzeugen.
  queue.forEach((q) => { voice.prepare(q.en, 'en'); voice.prepare(q.de, 'de'); });
  clearInterval(ticker);
  ticker = setInterval(updateTimeline, 1000);
  showCard();
}

function continueRound() {
  s.started = Date.now();
  s.firstCard = true;
  showCard();
}

function roundOver() {
  return !s.queue.length || Date.now() - s.started >= SESSION_MS;
}

function updateTimeline() {
  const bar = root?.querySelector('[data-time]');
  if (bar) bar.style.width = Math.min(100, ((Date.now() - s.started) / SESSION_MS) * 100) + '%';
}

// ---------- Karte ----------

function showCard() {
  if (!root) return;
  const p = s.queue[0];
  const listen = p.dir === 'en-de';
  s.card = { phrase: p, blob: null, help: 0, retry: s.retried.has(p.id), listen };

  root.innerHTML = '';
  root.appendChild(h(`
    <section class="review">
      <div class="timeline"><span data-time></span></div>
      <header class="bar">
        <span class="muted small">${s.mode === 'pinned' ? '📌 Angepinnte · freies Üben' : ''}${s.card.retry ? ' zweiter Anlauf' : ''}</span>
        <label class="level">
          <span>Tempo: <b data-level-label>${lv().label}</b></span>
          <input type="range" min="1" max="5" step="1" value="${s.level}" data-level>
        </label>
      </header>

      <div class="card">
        <p class="de-sentence" data-top>${listen ? '🎧 Was bedeutet das?' : esc(p.de)}</p>
        <button class="icon-btn" data-say-de title="${listen ? 'Englisch nochmal hören' : 'Deutsch anhören'}">🔈</button>
        <p class="literal" data-literal hidden></p>
        <div class="answer" data-answer hidden></div>
        <p class="note" data-note hidden></p>
      </div>

      <div class="controls" data-controls></div>
      ${s.firstCard ? '<p class="muted small hint">Aufhören geht jederzeit – jede Karte ist sofort gespeichert.</p>' : ''}
    </section>
  `));
  s.firstCard = false;
  updateTimeline();

  root.querySelector('[data-level]').addEventListener('input', async (e) => {
    s.level = Number(e.target.value);
    root.querySelector('[data-level-label]').textContent = lv().label;
    await db.setSetting('level', s.level);
  });
  root.querySelector('[data-say-de]').addEventListener('click', () => (listen
    ? audio.speak(p.en, { lang: 'en', rate: lv().rate })
    : audio.speak(p.de, { lang: 'de', rate: lv().rate + 0.1 })));

  askPhase();
}

function controls(html) {
  const c = root.querySelector('[data-controls]');
  c.innerHTML = html;
  return c;
}

// ---------- 1. Frage ----------

function askPhase() {
  const { phrase: p } = s.card;
  if (s.card.listen) return askListen();
  showLiteral(s.literal === 'always' || s.card.help >= 1);

  // Neue und unsichere Karten zeigen den Tipp deutlich, gut sitzende nur dezent.
  const helpClass = p.streak < 2 ? 'secondary' : 'link';
  const c = controls(`
    <div class="meter" data-meter hidden>
      <canvas data-canvas></canvas>
      <span class="muted small" data-secs>0 s</span>
    </div>
    <button class="mic" data-mic>
      <span class="mic-dot"></span>
      <span data-mic-label>Auf Englisch sagen</span>
    </button>
    <button class="${helpClass} help" data-help>${helpLabel()}</button>
  `);
  c.querySelector('[data-mic]').addEventListener('click', toggleRecording);
  c.querySelector('[data-help]').addEventListener('click', askForHelp);
  if (!audio.canRecord()) c.querySelector('[data-mic]').hidden = true;
}

// Hör-Karte: vorspielen, verstehen, dann auflösen.
function askListen() {
  const { phrase: p } = s.card;
  const lit = root.querySelector('[data-literal]');
  lit.textContent = p.en;
  lit.classList.add('en-read');
  lit.hidden = s.card.help < 1;
  const c = controls(`
    <button class="secondary listen-again" data-listen>▶ Nochmal anhören</button>
    <button class="primary" data-solve>Auflösen</button>
    ${s.card.help < 1 ? '<button class="secondary help" data-read>Englisch mitlesen</button>' : ''}
  `);
  c.querySelector('[data-listen]').addEventListener('click', () => { stopAudio(); audio.speak(p.en, { lang: 'en', rate: lv().rate }); });
  c.querySelector('[data-solve]').addEventListener('click', reveal);
  c.querySelector('[data-read]')?.addEventListener('click', () => {
    s.card.help = 1;
    lit.hidden = false;
    c.querySelector('[data-read]').remove();
  });
  audio.speak(p.en, { lang: 'en', rate: lv().rate });
}

function literalAvailable() {
  return s.literal !== 'off' && s.card.help === 0;
}

function helpLabel() {
  return literalAvailable() && s.literal !== 'always' ? 'Tipp' : 'Lösung zeigen';
}

function askForHelp() {
  if (literalAvailable() && s.literal !== 'always') {
    s.card.help = 1;
    showLiteral(true);
    root.querySelector('[data-help]').textContent = helpLabel();
  } else {
    s.card.help = 2;
    reveal();
  }
}

// Tipp: wörtliche Zeile. Ohne Dekodierung ersatzweise die ersten englischen Wörter.
function showLiteral(show) {
  const el = root.querySelector('[data-literal]');
  const { phrase: p } = s.card;
  const text = literalLine(p) || (s.card.help >= 1 ? 'Anfang: ' + p.en.split(/\s+/).slice(0, 2).join(' ') + ' …' : '');
  el.textContent = text;
  el.hidden = !show || !text;
}

// ---------- 2. Aufnahme ----------

async function toggleRecording() {
  const btn = root.querySelector('[data-mic]');
  if (!audio.isRecording()) {
    try {
      stopAudio();
      await audio.startRecording();
    } catch {
      toast('Mikrofon nicht freigegeben – es geht auch ohne Aufnahme.');
      return;
    }
    btn.classList.add('recording');
    root.querySelector('[data-mic-label]').textContent = 'Fertig';
    const help = root.querySelector('[data-help]');
    if (help) help.hidden = true;
    startMeter();
    recordTimer = setTimeout(toggleRecording, MAX_RECORD_MS);
  } else {
    clearTimeout(recordTimer);
    cancelAnimationFrame(meterFrame);
    btn.classList.remove('recording');
    const blob = await audio.stopRecording();
    if (!root) return;
    if (!blob || blob.size < 500) toast('Die Aufnahme ist leer – das Mikrofon hat nichts geliefert.', { ms: 8000 });
    if (blob?.size) {
      s.card.blob = blob;
      db.put('recordings', { id: s.card.phrase.id, blob, date: srs.today() });
    }
    if (!s.card.revealed) return reveal();
    // Nachgesprochen bei sichtbarer Lösung: nur "▶ Ich" freischalten, nichts spielt ungefragt.
    root.querySelector('[data-meter]').hidden = true;
    root.querySelector('[data-mic-label]').textContent = micLabel();
    root.querySelector('[data-play="me"]').disabled = !s.card.blob;
  }
}

// Laufende Aufnahme verwerfen, z. B. wenn während der Aufnahme bewertet wird.
function cancelRecording() {
  clearTimeout(recordTimer);
  cancelAnimationFrame(meterFrame);
  if (audio.isRecording()) audio.stopRecording();
}

// Pegelbalken: die letzten Lautstärkewerte als Säulen, laufen von rechts nach links.
function startMeter() {
  const wrap = root.querySelector('[data-meter]');
  const canvas = root.querySelector('[data-canvas]');
  const secs = root.querySelector('[data-secs]');
  wrap.hidden = false;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const ctx = canvas.getContext('2d');
  const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const bars = new Array(40).fill(0);
  const start = Date.now();

  const draw = () => {
    if (!root || !audio.isRecording()) return;
    bars.shift();
    bars.push(audio.level());
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width / bars.length;
    const mid = canvas.height / 2;
    ctx.fillStyle = color;
    bars.forEach((v, i) => {
      const hgt = Math.max(2 * dpr, v * canvas.height);
      ctx.fillRect(i * w + w * 0.2, mid - hgt / 2, w * 0.6, hgt);
    });
    secs.textContent = Math.floor((Date.now() - start) / 1000) + ' s';
    meterFrame = requestAnimationFrame(draw);
  };
  draw();
}

// ---------- 3. Auflösung ----------

// Mit sichtbarer Lösung nachsprechen: der Text bleibt stehen.
function micLabel() {
  if (s.card.listen) return s.card.blob ? 'Nochmal nachsprechen' : 'Nachsprechen';
  return s.card.blob ? 'Nochmal sprechen' : 'Jetzt selbst sagen';
}

function reveal() {
  s.card.revealed = true;
  const { phrase: p, blob, help } = s.card;
  if (s.card.listen) {
    root.querySelector('[data-top]').textContent = p.de;
    root.querySelector('[data-literal]').hidden = true;
  } else {
    showLiteral(false);
  }
  const answer = root.querySelector('[data-answer]');
  renderDecode(answer, p);
  answer.classList.toggle('no-literal', s.literal === 'off');
  answer.hidden = false;

  const c = controls(`
    <div class="row play">
      <button class="secondary" data-play="model" data-label="▶ Muster">▶ Muster</button>
      <button class="accent-soft" data-play="me" data-label="▶ Ich" ${blob ? '' : 'disabled'}>▶ Ich</button>
    </div>
    <div class="meter" data-meter hidden>
      <canvas data-canvas></canvas>
      <span class="muted small" data-secs>0 s</span>
    </div>
    <button class="mic mic-small" data-mic>
      <span class="mic-dot"></span>
      <span data-mic-label>${micLabel()}</span>
    </button>
    ${s.card.listen ? '' : '<button class="secondary retry" data-retry>↻ Nochmal versuchen</button>'}
    <div class="row links">
      ${p.note ? '<button class="link" data-why>Warum?</button>' : ''}
      <button class="link" data-odd>Komisch?</button>
    </div>
    <div class="row grade">
      <button class="grade-bad" data-rate="again">Noch nicht</button>
      <button class="grade-mid" data-rate="hard" ${help >= 2 ? 'disabled' : ''}>Wackelig</button>
      <button class="grade-good" data-rate="good" ${help >= 1 ? 'disabled' : ''}>Sitzt</button>
    </div>
    ${help ? `<p class="muted small">${help >= 2 ? 'Mit Lösung' : s.card.listen ? 'Mitgelesen' : 'Mit Tipp'} geht höchstens „${help >= 2 ? 'Noch nicht' : 'Wackelig'}“ – kein Tadel, die Karte kommt nur bald wieder.</p>` : ''}
  `);
  c.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => play(b.dataset.play)));
  c.querySelector('[data-mic]').addEventListener('click', toggleRecording);
  if (!audio.canRecord()) c.querySelector('[data-mic]').hidden = true;
  c.querySelector('[data-retry]')?.addEventListener('click', retry);
  c.querySelector('[data-why]')?.addEventListener('click', () => {
    const n = root.querySelector('[data-note]');
    n.textContent = p.note;
    n.hidden = !n.hidden;
  });
  c.querySelector('[data-odd]').addEventListener('click', flagOdd);
  c.querySelectorAll('[data-rate]').forEach((b) => b.addEventListener('click', () => rate(b.dataset.rate)));

  play('model');
}

// Muster / Ich. Nochmal antippen stoppt.
// Die eigene Aufnahme wird beim Abspielen auf die Lautstärke des Musters angehoben.
async function play(kind) {
  if (s.playing === kind) return stopAudio();
  stopAudio();
  const token = s.playToken;
  setPlaying(kind);
  const { phrase: p, blob } = s.card;

  if (kind === 'model') {
    await audio.speak(p.en, { lang: 'en', rate: lv().rate });
  } else {
    const result = await audio.playBlob(blob, { normalize: true });
    if (result !== true && result !== 'gestoppt') toast('Deine Aufnahme ließ sich nicht abspielen (' + result + ').', { ms: 8000 });
  }
  if (token === s.playToken) setPlaying(null);
}

function stopAudio() {
  s.playToken++;
  audio.stopSpeaking();
  setPlaying(null);
}

function setPlaying(kind) {
  s.playing = kind;
  root?.querySelectorAll('[data-play]').forEach((b) => {
    const on = b.dataset.play === kind;
    b.classList.toggle('playing', on);
    b.textContent = on ? '■ Stopp' : b.dataset.label;
  });
}

function retry() {
  cancelRecording();
  stopAudio();
  s.card.blob = null;
  s.card.revealed = false;
  root.querySelector('[data-answer]').hidden = true;
  root.querySelector('[data-note]').hidden = true;
  askPhase();
}

async function flagOdd() {
  const p = s.card.phrase;
  p.flagged = true;
  p.refined = false;
  p.updated = Date.now();
  await db.put('phrases', p);
  toast('Vorgemerkt – kommt beim nächsten Veredeln mit.');
}

// ---------- 4. Bewertung ----------

async function rate(rating) {
  cancelRecording();
  stopAudio();
  const p = s.queue[0];
  const undo = {
    snapshot: structuredClone(p),
    queue: [...s.queue],
    done: s.done,
    counts: { ...s.counts },
    retried: new Set(s.retried),
  };

  s.queue.shift();
  let msg;
  if (s.mode === 'pinned') {
    // Freies Üben: Plan bleibt unberührt. Was nicht saß, kommt in dieser Runde nochmal.
    s.done++;
    s.counts[rating]++;
    if (rating === 'again' && !s.card.retry) { s.retried.add(p.id); s.queue.push(p); }
    msg = rating === 'again' ? 'Kommt in dieser Runde nochmal.' : `${RATING_TEXT[rating]}.`;
  } else if (s.card.retry) {
    // Zweiter Anlauf in derselben Runde ändert den Plan nicht mehr.
    msg = 'Zweiter Anlauf erledigt.';
  } else {
    srs.grade(p, rating);
    await db.put('phrases', p);
    s.done++;
    s.counts[rating]++;
    if (rating === 'again') { s.retried.add(p.id); s.queue.push(p); }
    msg = rating === 'again'
      ? 'Noch nicht – kommt heute nochmal und morgen wieder.'
      : `${RATING_TEXT[rating]} – wieder ${formatDay(p.due)}.`;
  }
  toast(msg, { action: { label: 'Rückgängig', run: () => undoRating(undo) }, ms: 5000 });

  if (roundOver()) return renderEnd();
  showCard();
}

async function undoRating(u) {
  if (!root) return;
  await db.put('phrases', u.snapshot);
  u.queue[0] = u.snapshot;
  Object.assign(s, { queue: u.queue, done: u.done, counts: u.counts, retried: u.retried });
  showCard();
}

// ---------- Ende und Leerlauf ----------

async function renderEnd() {
  const phrases = await db.getAll('phrases');
  const minutes = Math.max(1, Math.round((Date.now() - s.started) / 60000));
  const rest = s.queue.length;
  const pinnedMode = s.mode === 'pinned';
  const more = rest || pinnedMode || srs.buildQueue(phrases, { ignoreNewLimit: true }).length;
  const next = srs.nextDue(phrases);
  const { good, hard, again } = s.counts;

  root.innerHTML = '';
  root.appendChild(h(`
    <section class="done">
      <h2>Runde vorbei</h2>
      <p class="finding">${s.done} ${s.done === 1 ? 'Karte' : 'Karten'} in ${minutes} Min.: ${good} sitzen, ${hard} wackelig, ${again} noch nicht.</p>
      ${pinnedMode ? '<p class="muted">Freies Üben – dein Wiederholungsplan bleibt, wie er war.</p>' : ''}
      ${next && !pinnedMode ? `<p class="muted">Als Nächstes: ${formatDay(next.date)} ${next.count} ${next.count === 1 ? 'Karte' : 'Karten'}.</p>` : ''}
      ${rest ? `<p class="muted">Noch ${rest} offen – die laufen nicht weg.</p>` : ''}
      <div class="stack">
        ${more ? `<button class="primary" data-more>${pinnedMode && !rest ? 'Angepinnte nochmal' : 'Noch eine Runde'}</button>` : ''}
      </div>
    </section>
  `));
  root.querySelector('[data-more]')?.addEventListener('click', () => (rest ? continueRound() : pinnedMode ? startPinned() : startRound(true)));
  if (!pinnedMode) addPinnedButton(phrases);
}

// "Angepinnte üben", wenn es angepinnte Sätze gibt.
function addPinnedButton(phrases) {
  const n = phrases.filter((p) => p.pinned && p.en).length;
  if (!n || !root) return;
  const btn = h(`<button class="secondary">📌 Angepinnte üben (${n})</button>`);
  btn.addEventListener('click', startPinned);
  root.querySelector('.stack')?.appendChild(btn);
}

function renderEmpty(phrases) {
  const next = srs.nextDue(phrases);
  const fresh = phrases.filter(srs.isNew).length;
  const pending = phrases.filter((p) => p.learn !== false && !(p.en && p.de)).length;

  root.innerHTML = '';
  root.appendChild(h(`
    <section class="done">
      <h2>Heute nichts fällig</h2>
      ${next ? `<p class="finding">Nächste Karten ${formatDay(next.date)}: ${next.count}.</p>` : ''}
      ${pending ? `<p class="muted">${pending === 1 ? '1 erfasster Satz wartet' : `${pending} erfasste Sätze warten`} aufs Veredeln (Reiter „Sätze“).</p>` : ''}
      ${!next && !fresh ? '<p class="muted">Übersetze Sätze aus deinem Alltag unter „Übersetzen“ – sie landen automatisch hier.</p>' : ''}
      <div class="stack">
        ${fresh ? `<button class="primary" data-new>Neue Karten üben (${fresh})</button>` : ''}
      </div>
    </section>
  `));
  root.querySelector('[data-new]')?.addEventListener('click', () => startRound(true));
  addPinnedButton(phrases);
}

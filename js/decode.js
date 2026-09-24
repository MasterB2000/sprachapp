// Dekodier-Anzeige: englische Wörter, darunter wörtlich auf Deutsch (Birkenbihl).
// Blendet Wort für Wort im Takt der Musterstimme aus.

// Ohne Dekodierung (z. B. frisch übersetzt) werden nur die englischen Wörter gezeigt.
function pairs(phrase) {
  if (Array.isArray(phrase.decode) && phrase.decode.length) return phrase.decode;
  return phrase.en.split(/\s+/).filter(Boolean).map((w) => [w, '']);
}

export function renderDecode(container, phrase) {
  container.innerHTML = '';
  const line = document.createElement('div');
  line.className = 'decode';
  for (const [en, de] of pairs(phrase)) {
    const w = document.createElement('span');
    w.className = 'w';
    w.innerHTML = `<span class="en"></span><span class="de"></span>`;
    w.querySelector('.en').textContent = en;
    w.querySelector('.de').textContent = de || ' ';
    line.appendChild(w);
  }
  container.appendChild(line);
  return line;
}

let timers = [];

export function cancelFade() {
  timers.forEach(clearTimeout);
  timers = [];
}

// Jedes Wort bleibt `visibleMs` sichtbar, nachdem die Stimme es (geschätzt) erreicht hat.
export function fadeAlong(line, { rate = 1, visibleMs = 1500 } = {}) {
  cancelFade();
  const words = [...line.querySelectorAll('.w')];
  const perWord = 380 / rate;
  words.forEach((w, i) => {
    timers.push(setTimeout(() => w.classList.add('gone'), i * perWord + visibleMs));
  });
}

export function showAll(line) {
  cancelFade();
  line.querySelectorAll('.w').forEach((w) => w.classList.remove('gone'));
}

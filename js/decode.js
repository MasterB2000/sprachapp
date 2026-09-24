// Dekodier-Anzeige: englische Wörter, darunter wörtlich auf Deutsch (Birkenbihl).

// Ohne Dekodierung (z. B. frisch übersetzt) werden nur die englischen Wörter gezeigt.
function pairs(phrase) {
  if (hasDecode(phrase)) return phrase.decode;
  return phrase.en.split(/\s+/).filter(Boolean).map((w) => [w, '']);
}

export const hasDecode = (phrase) => Array.isArray(phrase.decode) && phrase.decode.length > 0;

export function renderDecode(container, phrase) {
  container.innerHTML = '';
  const line = document.createElement('div');
  line.className = hasDecode(phrase) ? 'decode' : 'decode plain';
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

// Nur die wörtliche deutsche Zeile, als Tipp vor der Lösung: „ich · will · zu · backen …“
export function literalLine(phrase) {
  if (!hasDecode(phrase)) return '';
  return phrase.decode.map(([, de]) => de).filter(Boolean).join(' · ');
}

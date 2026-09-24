// Prompt-Austausch: Die App erzeugt einen Prompt, der Nutzer kopiert ihn in eine KI
// seiner Wahl und die Antwort zurück. Streng im geforderten Format, großzügig beim Einlesen.

export function buildRefinePrompt(phrases) {
  const list = phrases.map((p) => ({
    id: p.id,
    de: p.de,
    ...(p.en ? { entwurf: p.en } : {}),
  }));

  return `Du hilfst einem deutschen Muttersprachler beim Englischlernen (Niveau: B1 Sprechen, B2 Verstehen). Ziel ist natürliches Alltagsenglisch im Gespräch, kein Fachenglisch.

Unten stehen deutsche Sätze aus seinem Alltag, teils mit einem maschinellen englischen Entwurf. Liefere für jeden Satz:

1. "en": die natürlichste englische Fassung, wie ein Muttersprachler es im Gespräch sagen würde. Kurzformen (I'm, don't) sind erwünscht.
2. "decode": eine wörtliche Rückübersetzung nach der Birkenbihl-Methode. Für JEDES englische Wort (Kurzformen als ein Wort) ein Paar [englisches Wort, wörtliche deutsche Bedeutung]. Wörtlich, nicht sinngemäß: "I'm looking forward to it" wird zu [["I'm","ich-bin"],["looking","schauend"],["forward","vorwärts"],["to","zu"],["it","es"]]. Satzzeichen bleiben am englischen Wort.
3. "note": nur falls es eine typische Falle für Deutsche gibt (falscher Freund, andere Präposition, anderes Verb), ein kurzer Satz dazu. Sonst leerer Text.

Ist ein Satz mehrdeutig, nimm die im Alltag wahrscheinlichste Bedeutung. Ist ein deutscher Satz offensichtlich falsch erkannt (Spracheingabe), korrigiere ihn in "de".

ANTWORTE AUSSCHLIESSLICH mit einem JSON-Array in genau dieser Form, ohne Einleitung und ohne Nachwort:

[
  {"id": "…", "de": "…", "en": "…", "decode": [["…","…"]], "note": "…"}
]

Die "id" jedes Eintrags unverändert übernehmen.

Sätze:
${JSON.stringify(list, null, 2)}
`;
}

// Liest die KI-Antwort. Gibt gültige Einträge und eine Liste von Auffälligkeiten zurück.
export function parseResponse(text) {
  const problems = [];
  const raw = extractJson(text);
  if (!raw) return { items: [], problems: ['Keine Liste in der Antwort gefunden. Bitte die ganze Antwort der KI einfügen.'] };

  let data, lastError;
  for (const attempt of repairs(raw)) {
    try { data = JSON.parse(attempt); break; } catch (err) { lastError = err; }
  }
  if (data === undefined) {
    return { items: [], problems: ['Die Antwort ist kein lesbares JSON: ' + lastError.message] };
  }
  if (!Array.isArray(data)) data = data.items || data.saetze || [data];

  const items = [];
  data.forEach((row, i) => {
    if (!row || typeof row !== 'object') return;
    const en = String(row.en || row.english || '').trim();
    if (!row.id) { problems.push(`Eintrag ${i + 1}: keine ID – übersprungen.`); return; }
    if (!en) { problems.push(`Eintrag ${i + 1}: keine englische Fassung – übersprungen.`); return; }
    const decode = normalizeDecode(row.decode);
    if (!decode) problems.push(`„${en}“: Dekodierung fehlt oder unlesbar – Satz wird ohne übernommen.`);
    items.push({
      id: String(row.id),
      de: row.de ? String(row.de).trim() : null,
      en,
      decode,
      note: String(row.note || '').trim(),
    });
  });
  return { items, problems };
}

// Sucht das JSON in der Antwort, auch wenn die KI Text oder ```-Blöcke drumherum schreibt.
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  const open = body[start];
  const end = body.lastIndexOf(open === '[' ? ']' : '}');
  if (end <= start) return null;
  return body.slice(start, end + 1);
}

// Häufige Formfehler, vorsichtig der Reihe nach probiert. Deutsche „Anführungszeichen“
// in Erklärtexten sind gültig und werden erst ganz zuletzt angefasst.
function* repairs(s) {
  yield s;
  const noTrailing = s.replace(/,\s*([\]}])/g, '$1');
  yield noTrailing;
  yield noTrailing.replace(/[“”]/g, '"');
}

// Akzeptiert [["I","ich"]], [{"en":"I","de":"ich"}] und "I(ich) want(will)".
function normalizeDecode(d) {
  if (Array.isArray(d)) {
    const out = d.map((x) => {
      if (Array.isArray(x) && x.length >= 1) return [String(x[0]), String(x[1] ?? '')];
      if (x && typeof x === 'object') return [String(x.en ?? x.word ?? ''), String(x.de ?? x.literal ?? '')];
      return null;
    }).filter((x) => x && x[0]);
    return out.length ? out : null;
  }
  if (typeof d === 'string' && d.trim()) {
    const out = [...d.matchAll(/(\S+?)\(([^)]*)\)/g)].map((m) => [m[1], m[2]]);
    return out.length ? out : null;
  }
  return null;
}

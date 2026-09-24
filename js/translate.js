// Übersetzer-Schnittstelle.
//
// Mehrere Quellen, in Reihenfolge der Anmeldung gefragt. Die erste verfügbare liefert.
// Jede Quelle ist ein Objekt:
//   { name: 'bergamot', available: async () => bool, translate: async (text, from, to) => übersetzung }
// Richtung: from/to als Sprachkürzel ('de', 'en'). Standard ist Deutsch → Englisch.
//
// Geplante Quellen: 'bergamot' (Handy, offline), 'pc' (Ollama, ab Schicht X).
// Die KI-Prüfung per Prompt (prompt.js) verbessert nachträglich und läuft nicht über diese Liste.

const sources = [];

export function registerSource(source) {
  sources.push(source);
}

export async function translate(text, { from = 'de', to = 'en' } = {}) {
  for (const src of sources) {
    try {
      if (!(await src.available())) continue;
      const out = (await src.translate(text, from, to))?.trim();
      if (out) return { text: out, en: to === 'en' ? out : undefined, source: src.name };
    } catch (err) {
      console.warn(`Übersetzer ${src.name} gescheitert:`, err);
    }
  }
  return null;
}

export const hasSources = () => sources.length > 0;

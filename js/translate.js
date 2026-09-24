// Übersetzer-Schnittstelle.
//
// Mehrere Quellen, in Reihenfolge der Anmeldung gefragt. Die erste verfügbare liefert.
// Jede Quelle ist ein Objekt:
//   { name: 'bergamot', available: async () => bool, translate: async (de) => en }
//
// Geplante Quellen: 'bergamot' (Handy, offline), 'pc' (Ollama, ab Schicht X).
// Der Prompt-Austausch (prompt.js) veredelt nachträglich und läuft nicht über diese Liste.

const sources = [];

export function registerSource(source) {
  sources.push(source);
}

export async function translate(de) {
  for (const src of sources) {
    try {
      if (!(await src.available())) continue;
      const en = (await src.translate(de))?.trim();
      if (en) return { en, source: src.name };
    } catch (err) {
      console.warn(`Übersetzer ${src.name} gescheitert:`, err);
    }
  }
  return null;
}

export const hasSources = () => sources.length > 0;

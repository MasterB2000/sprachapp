// Übersetzungsquelle "bergamot": Deutsch → Englisch direkt im Handy, ohne Netz.
// Programm und Modell liegen unter vendor/bergamot (Mozilla/Bergamot, MPL-2.0).
// Das Modell (~23 MB) wird beim ersten Gebrauch geladen und danach vom Service Worker vorgehalten.

let translator = null;

async function load() {
  if (!translator) {
    const { LatencyOptimisedTranslator } = await import('../vendor/bergamot/translator.js');
    translator = new LatencyOptimisedTranslator({
      registryUrl: 'vendor/bergamot/models/registry.json',
      pivotLanguage: null,
      downloadTimeout: 180000,
    });
    translator.worker.catch(() => { translator = null; });
  }
  return translator;
}

export const bergamotSource = {
  name: 'bergamot',
  available: async () => typeof WebAssembly === 'object' && typeof Worker === 'function',
  async translate(de) {
    const t = await load();
    const res = await t.translate({ from: 'de', to: 'en', text: de, html: false });
    return res.target.text;
  },
};

// Lädt Programm und Modell schon im Hintergrund, damit die erste Übersetzung nicht wartet.
export function warmUp() {
  bergamotSource.translate('Hallo.').catch(() => {});
}

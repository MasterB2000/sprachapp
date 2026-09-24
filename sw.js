// Offline-Speicher der App-Dateien.
// Online: immer frisch aus dem Netz holen (Änderungen sind sofort da) und Kopie ablegen.
// Offline: Kopie ausliefern.

const CACHE = 'sprachapp-v6';
// Eigener Speicher für große Modelldateien: überlebt App-Updates, wird nur bei neuem Modell erhöht.
const VENDOR_CACHE = 'sprachapp-vendor-v1';

const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/ui.js',
  'js/srs.js',
  'js/audio.js',
  'js/decode.js',
  'js/translate.js',
  'js/bergamot.js',
  'js/voice.js',
  'js/voice-worker.js',
  'js/prompt.js',
  'js/review.js',
  'js/capture.js',
  'js/library.js',
  'data/start.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'no-cache' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== VENDOR_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // Große Modelldateien: einmal laden, danach nur noch aus dem Speicher.
  if (url.pathname.includes('/vendor/')) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VENDOR_CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })).then(isolate)
    );
    return;
  }

  // no-cache: beim Server nachfragen statt der Browser-Kopie zu trauen – Updates sind sofort da.
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
      .then(isolate)
  );
});

// Cross-Origin-Isolation: erlaubt der Stimme, mehrere Rechenkerne zu nutzen.
// GitHub Pages kann diese Kopfzeilen nicht setzen, also setzt sie der Service Worker.
function isolate(res) {
  if (!res || res.status === 0) return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

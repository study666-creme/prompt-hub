const CACHE = 'prompt-hub-v43';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './styles-mobile.css',
  './styles-theme.css',
  './styles-settings.css',
  './styles-features.css',
  './theme.js',
  './script.js',
  './points-system.js',
  './features-draft.js',
  './membership.js',
  './subscription.js',
  './mobile.js',
  './supabase-config.js',
  './api-domain.config.js',
  './api-config.js',
  './api-client.js',
  './cloud-sync-safety.js',
  './supabase-sync.js',
  './ripple-grid.js',
  './manifest.webmanifest',
  './assets/logo.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;

  const isHtml =
    e.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html');
  const isScriptOrStyle = /\.(css|js)$/.test(url.pathname);

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const putCache = (res) => {
        if (res.ok && url.pathname.match(/\.(css|js|png|svg|webmanifest)$/)) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      };
      if (isHtml) {
        return fetch(e.request).then(putCache).catch(() => cached);
      }
      if (isScriptOrStyle) {
        return fetch(e.request).then(putCache).catch(() => cached);
      }
      const network = fetch(e.request).then(putCache).catch(() => cached);
      return cached || network;
    })
  );
});

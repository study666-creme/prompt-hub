const CACHE = 'prompt-hub-v62';
/** 仅预缓存壳资源；JS/CSS 不预缓存，避免强刷仍命中旧脚本 */
const ASSETS = [
  './',
  './index.html',
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
    (async () => {
      if (isScriptOrStyle) {
        try {
          return await fetch(e.request, { cache: 'no-store' });
        } catch (err) {
          const cached = await caches.match(e.request);
          if (cached) return cached;
          throw err;
        }
      }
      const cached = await caches.match(e.request);
      const putCache = (res) => {
        if (res.ok && url.pathname.match(/\.(png|svg|webmanifest)$/)) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      };
      if (isHtml) {
        try {
          return await fetch(e.request, { cache: 'no-store' }).then(putCache);
        } catch (err) {
          if (cached) return cached;
          throw err;
        }
      }
      try {
        return await fetch(e.request).then(putCache);
      } catch (err) {
        if (cached) return cached;
        throw err;
      }
    })()
  );
});

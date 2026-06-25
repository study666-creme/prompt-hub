const CACHE = 'prompt-hub-v20260624k';
/** 仅缓存静态小资源；HTML/JS/CSS 始终走网络，避免误显示「暂时无法连接」 */
const ASSETS = [
  './manifest.webmanifest',
  './assets/logo.png',
  './assets/asset-studio-icon.png'
];

const OFFLINE_HTML =
  '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>提示词仓库</title></head>' +
  '<body style="font-family:sans-serif;padding:2rem;background:#121212;color:#eee">' +
  '<h1>暂时无法连接</h1><p>请检查网络后按 Ctrl+Shift+R 强刷，或稍后再试。</p>' +
  '<p style="color:#888;font-size:14px">若在本机开发，请运行 <code>serve-local.ps1</code> 后访问 http://127.0.0.1:5500 ，不要直接打开 file://。</p>' +
  '</body></html>';

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
  /** 后台页不走 SW，避免缓存旧 admin.js / 导航失败 */
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/') || url.pathname === '/admin.html') {
    return;
  }

  const isHtml =
    e.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html');
  const isScriptOrStyle = /\.(css|js)$/.test(url.pathname);

  e.respondWith(
    (async () => {
      if (isScriptOrStyle) {
        try {
          const res = await fetch(e.request, { cache: 'no-store' });
          const ct = res.headers.get('content-type') || '';
          if (/text\/html/i.test(ct)) {
            return new Response('// script response was HTML (SPA fallback)', {
              status: 502,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
          }
          return res;
        } catch (err) {
          const cached = await caches.match(e.request);
          if (cached) return cached;
          throw err;
        }
      }
      if (isHtml) {
        try {
          return await fetch(e.request, { cache: 'no-store' });
        } catch (err) {
          const cached =
            (await caches.match(e.request)) ||
            (await caches.match('/index.html')) ||
            (await caches.match('./index.html'));
          if (cached) return cached;
          if (!navigator.onLine) {
            return new Response(OFFLINE_HTML, {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
          }
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
      try {
        return await fetch(e.request).then(putCache);
      } catch (err) {
        if (cached) return cached;
        throw err;
      }
    })()
  );
});

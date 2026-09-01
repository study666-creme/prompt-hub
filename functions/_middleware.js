const PACK_JS_RE = /^\/pack-[a-z0-9-]+\.js$/i;
const PRIVATE_SOURCE_FRAGMENT_RE = /^\/(?:legacy|styles|partials)\//i;
// 版本化 URL 的响应体永不复用旧内容（bump-build.ps1 每次发版统一刷新 ?v=，
// 延迟加载队列也用运行时 __APP_BUILD__ 拼 URL），所以这里可以安全地长缓存，
// 免去每次回访 1.4MB+ JS 的 no-store 全量重下。
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (PRIVATE_SOURCE_FRAGMENT_RE.test(url.pathname)) {
    return new Response('Not found', {
      status: 404,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8'
      }
    });
  }

  if (request.method === 'GET' && url.search && PACK_JS_RE.test(url.pathname)) {
    const isVersioned = url.searchParams.has('v');
    url.search = '';
    const cleanRequest = new Request(url.toString(), request);
    const assetResponse = env?.ASSETS?.fetch
      ? await env.ASSETS.fetch(cleanRequest)
      : await fetch(cleanRequest);

    const type = assetResponse.headers.get('content-type') || '';
    if (assetResponse.ok && !/text\/html/i.test(type)) {
      const headers = new Headers(assetResponse.headers);
      headers.set('Content-Type', 'application/javascript; charset=utf-8');
      headers.set('Cache-Control', isVersioned
        ? IMMUTABLE_CACHE_CONTROL
        : 'no-cache, no-store, must-revalidate');
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers
      });
    }
  }

  return next();
}

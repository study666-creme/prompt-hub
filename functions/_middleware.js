const PACK_JS_RE = /^\/pack-[a-z0-9-]+\.js$/i;
const PRIVATE_SOURCE_FRAGMENT_RE = /^\/(?:legacy|styles|partials)\//i;

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
    url.search = '';
    const cleanRequest = new Request(url.toString(), request);
    const assetResponse = env?.ASSETS?.fetch
      ? await env.ASSETS.fetch(cleanRequest)
      : await fetch(cleanRequest);

    const type = assetResponse.headers.get('content-type') || '';
    if (assetResponse.ok && !/text\/html/i.test(type)) {
      const headers = new Headers(assetResponse.headers);
      headers.set('Content-Type', 'application/javascript; charset=utf-8');
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers
      });
    }
  }

  return next();
}

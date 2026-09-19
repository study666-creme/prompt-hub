/**
 * 同源反代：/canvas-admin/* -> https://canvas-api.prompt-hubs.com/*
 *
 * 为什么要这层代理：
 * canvas-api.prompt-hubs.com/admin/model-overrides 的响应头带 `x-frame-options: DENY`，
 * 浏览器会直接拒绝在 iframe 里渲染（后台「画布模型」页表现就是整块空白，控制台报
 * refused to connect）。那个服务的响应头不归本仓库管，所以在自己域名下开一条代理：
 *
 *   /canvas-admin/admin/model-overrides  -> canvas-api.../admin/model-overrides   （内嵌页面）
 *   /canvas-admin/api/v1/admin/...       -> canvas-api.../api/v1/admin/...        （页面内接口）
 *
 * 代理时剥掉 x-frame-options / CSP，并把页面里写死的 '/api/v1/admin/...'
 * 重写成 '/canvas-admin/api/v1/admin/...'，让页面内的 fetch 也回到这条代理上。
 * 反代后 iframe 与主后台同源，画布管理密钥（sessionStorage）可以自动复用，
 * 后台前端因此能接管内嵌页的密钥框与「加载」按钮。
 *
 * 路由实现放在 functions/ 下是有意的：部署走 scripts/stage-pages.ps1，
 * 它只打包 functions/ 等白名单目录，根目录的 _worker.js（.gitignore 忽略）
 * 不会上传，所以在这里写才是真正生效的那份。
 */

const CANVAS_ADMIN_PREFIX = '/canvas-admin';
const CANVAS_API_ORIGIN = 'https://canvas-api.prompt-hubs.com';
// 只转发白名单请求头，不把 host / cookie / cf-* 原样透给上游。
const CANVAS_PROXY_HEADER_ALLOWLIST = [
  'accept',
  'accept-language',
  'content-type',
  'x-model-overrides-secret',
  'x-catalog-admin-secret'
];
const CANVAS_API_PATH_REWRITE_RE = /(["'`])\/api\/v1\/admin\//g;

function noStoreJson(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const targetPath = url.pathname.slice(CANVAS_ADMIN_PREFIX.length) || '/';
  const target = new URL(CANVAS_API_ORIGIN + targetPath);
  target.search = url.search;

  const headers = new Headers();
  for (const name of CANVAS_PROXY_HEADER_ALLOWLIST) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const init = { method: request.method, headers, redirect: 'follow' };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), init);
  } catch (e) {
    return noStoreJson(
      { ok: false, error: { message: '画布服务不可达：' + (e && e.message ? e.message : String(e)) } },
      502
    );
  }

  const outHeaders = new Headers(upstream.headers);
  outHeaders.delete('x-frame-options');
  outHeaders.delete('content-security-policy');
  outHeaders.delete('content-security-policy-report-only');
  // 运行时已解压上游响应体，残留的 content-encoding / content-length
  // 会让浏览器按压缩体解码（ERR_CONTENT_DECODING_FAILED），必须去掉。
  outHeaders.delete('content-encoding');
  outHeaders.delete('content-length');
  outHeaders.set('Cache-Control', 'no-store');
  outHeaders.set('X-Robots-Tag', 'noindex, nofollow');

  const contentType = upstream.headers.get('content-type') || '';
  if (/text\/html/i.test(contentType)) {
    const html = await upstream.text();
    return new Response(html.replace(CANVAS_API_PATH_REWRITE_RE, `$1${CANVAS_ADMIN_PREFIX}/api/v1/admin/`), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders
  });
}

import type { Context } from 'hono';
import type { Env } from '../env';
import { applyCorsHeaders } from '../lib/cors-headers';
import { isIcpBlockBody, SUPABASE_ICP_HINT } from '../lib/supabase-upstream';

const FORWARD_REQUEST_HEADERS = [
  'apikey',
  'authorization',
  'content-type',
  'prefer',
  'x-client-info',
  'x-supabase-api-version',
  'accept',
  'accept-profile',
  'content-profile'
] as const;

const BLOCKED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

function buildTargetUrl(c: Context<{ Bindings: Env }>): string | null {
  const base = c.env.SUPABASE_URL?.trim().replace(/\/$/, '');
  if (!base) return null;

  const incoming = new URL(c.req.url);
  const path = incoming.pathname.replace(/^\/supabase/, '') || '/';
  return new URL(`${path}${incoming.search}`, `${base}/`).toString();
}

function collectForwardHeaders(c: Context<{ Bindings: Env }>): Headers {
  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = c.req.header(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function filterResponseHeaders(upstream: Headers): Headers {
  const headers = new Headers();
  upstream.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (BLOCKED_RESPONSE_HEADERS.has(lower) || lower.startsWith('cf-')) return;
    headers.set(key, value);
  });
  return headers;
}

function isRawIpHost(url: string): boolean {
  try {
    const { hostname } = new URL(url.startsWith('http') ? url : `http://${url}`);
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  } catch {
    return false;
  }
}

const CF_SSRF_1003_HINT =
  'Cloudflare Worker 不能 fetch 裸 IP。请在 Cloudflare DNS 添加「仅 DNS（灰云）」A 记录（如 sb.prompt-hub.cn → 8.148.193.247），' +
  '并把 Worker Secret SUPABASE_URL 改为 http://sb.prompt-hub.cn 后 redeploy。详见 docs/SUPABASE-PROXY-SETUP.md';

export async function supabaseProxyHandler(c: Context<{ Bindings: Env }>) {
  applyCorsHeaders(c);

  if (c.req.method === 'OPTIONS') {
    c.header(
      'Access-Control-Allow-Headers',
      [
        'Authorization',
        'Content-Type',
        'apikey',
        'x-client-info',
        'prefer',
        'x-supabase-api-version',
        'accept',
        'accept-profile',
        'content-profile'
      ].join(', ')
    );
    c.header(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD'
    );
    return c.body(null, 204);
  }

  const targetUrl = buildTargetUrl(c);
  if (!targetUrl) {
    return c.json({ ok: false, error: { message: 'Supabase 未配置' } }, 503);
  }

  const upstream = await fetch(targetUrl, {
    method: c.req.method,
    headers: collectForwardHeaders(c),
    body: c.req.raw.body,
    redirect: 'manual'
  });

  applyCorsHeaders(c);

  if (upstream.status === 403) {
    const bodyText = await upstream.text();
    if (isIcpBlockBody(bodyText)) {
      return c.json(
        { ok: false, error: { code: 'aliyun_icp_block', message: SUPABASE_ICP_HINT } },
        403
      );
    }
    if (bodyText.includes('1003')) {
      const configured = c.env.SUPABASE_URL?.trim() || '';
      const error: Record<string, string> = {
        code: 'cloudflare_ssrf_1003',
        message: CF_SSRF_1003_HINT
      };
      if (configured && isRawIpHost(configured)) {
        error.configuredUrl = configured;
        error.reason =
          `当前 SUPABASE_URL 为裸 IP（${configured}），Worker 出站 fetch 会被 Cloudflare SSRF 策略拦截。`;
      }
      return c.json({ ok: false, error }, 403);
    }
    const headers = filterResponseHeaders(upstream.headers);
    return new Response(bodyText, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });
  }

  const headers = filterResponseHeaders(upstream.headers);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}

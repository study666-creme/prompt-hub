/* Shared session + API client for the admin console (ES module rewrite). */

const LS_KEY = 'ph_admin_session_v1';

export let session = loadSession();

function loadSession() {
  try {
    const raw = sessionStorage.getItem(LS_KEY);
    const s = raw ? JSON.parse(raw) : null;
    if (s?.secret) {
      const expected = resolveApiBase();
      if (s.apiBase !== expected) s.apiBase = expected;
    }
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s) {
  session = s;
  sessionStorage.setItem(LS_KEY, JSON.stringify(s));
}

export function clearSession() {
  session = null;
  sessionStorage.removeItem(LS_KEY);
}

export function resolveApiBase() {
  const host = (window.location.hostname || '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') {
    return String(window.API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
  }
  const custom = String(window.CUSTOM_API_HOST || '').trim();
  if (custom) {
    return 'https://' + custom.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }
  const prodByHost = {
    'prompt-hubs.com': 'https://api.prompt-hubs.com',
    'www.prompt-hubs.com': 'https://api.prompt-hubs.com',
    'prompt-hub.cn': 'https://api.prompt-hub.cn',
    'www.prompt-hub.cn': 'https://api.prompt-hub.cn',
    'prompt-hub-hub.pages.dev': 'https://api.prompt-hubs.com',
    'prompt-hub-web.pages.dev': 'https://api.prompt-hubs.com'
  };
  if (prodByHost[host]) return prodByHost[host];
  if (/\.prompt-hub-hub\.pages\.dev$/i.test(host) || /\.prompt-hub-web\.pages\.dev$/i.test(host)) {
    return 'https://api.prompt-hubs.com';
  }
  return String(window.API_BASE_URL || 'https://api.prompt-hubs.com').replace(/\/$/, '');
}

export function apiBase() {
  return (session?.apiBase || resolveApiBase()).replace(/\/$/, '');
}

function encodeAdminSecret(secret) {
  const bytes = new TextEncoder().encode(secret);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'b64:' + btoa(binary);
}

export function friendlyFetchError(err) {
  const msg = String(err?.message || err || '');
  if (/non ISO-8859-1|headers.*RequestInit/i.test(msg)) {
    return '密钥含特殊符号导致浏览器无法发送，请刷新页面后重试；或改用纯英文+数字密钥';
  }
  if (/UNAUTHORIZED|管理员密钥无效/i.test(msg)) {
    return '密钥与 Cloudflare 中保存的不一致。请重新执行 wrangler secret put 设置同一串后再登录。';
  }
  if (/failed to fetch|networkerror|load failed|cors/i.test(msg)) {
    const base = resolveApiBase();
    const localHint =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? '本地请先运行：cd server 后 npx wrangler dev（8787）。'
        : '';
    return `无法连接 API：${base}。${localHint}线上请确认 server 已 deploy、/health 返回 supabase:ok`;
  }
  if (/site_settings|Could not find the table|PGRST205|SITE_SETTINGS|SAVE_VERIFY|PERMISSION|payment_orders/i.test(msg)) {
    return msg.includes('SAVE_VERIFY')
      ? '保存后读不到数据：请确认 Worker 的 SUPABASE_URL 与 SQL 编辑器是同一个 MemFire 项目'
      : msg.includes('PERMISSION')
        ? '无写入权限：请在 MemFire SQL 编辑器执行 supabase/migrations/20260602200000_site_settings_grants.sql'
        : '数据库表不可用（site_settings / payment_orders 等）。请执行对应建表+授权 SQL 后重试';
  }
  return msg || '请求失败';
}

export async function adminFetch(path, opts) {
  if (!session) throw new Error('未登录');
  const url = apiBase() + path;
  const headers = {
    'Content-Type': 'application/json',
    'X-Admin-Secret': encodeAdminSecret(session.secret)
  };
  const timeoutMs = opts?.timeoutMs || 90000;
  const attempts = Math.max(1, Number(opts?.retries) || 1);

  async function once() {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, {
        method: opts?.method || 'GET',
        headers,
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
        mode: 'cors',
        cache: 'no-store',
        signal: controller?.signal
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        const msg = json?.error?.message || res.statusText || '请求失败';
        const code = json?.error?.code || '';
        const err = new Error(code ? `${msg} (${code})` : msg);
        err.status = res.status;
        err.code = code;
        throw err;
      }
      return json.data;
    } catch (e) {
      if (e?.name === 'AbortError') {
        throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）：${url}`);
      }
      if (e instanceof TypeError) {
        const err = new Error(e.message || 'Failed to fetch');
        err.cause = url;
        throw err;
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await once();
    } catch (e) {
      lastErr = e;
      const retryable = /failed to fetch|networkerror|load failed/i.test(String(e?.message || ''));
      if (!retryable || i >= attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  throw lastErr;
}

/** Low-level fetch that returns raw text (CSV export). */
export async function adminFetchRaw(path) {
  if (!session) throw new Error('未登录');
  const res = await fetch(apiBase() + path, {
    headers: { 'X-Admin-Secret': encodeAdminSecret(session.secret) },
    mode: 'cors',
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`导出失败：HTTP ${res.status}`);
  return res.text();
}

importScripts('config.js');

const SESSION_KEY = 'ph_session';
const PANEL_ENABLED_KEY = 'ph_panel_enabled';
const DISCLAIMER_KEY = 'ph_disclaimer_ok';

function sessionFromBridge(raw) {
  if (!raw?.access_token) return null;
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token || null,
    expires_at: raw.expires_at || raw.expiresAt || null,
    user: raw.user || null
  };
}

async function loadSession() {
  const { [SESSION_KEY]: s } = await chrome.storage.local.get(SESSION_KEY);
  return s || null;
}

async function saveSession(session) {
  if (!session?.access_token) {
    await chrome.storage.local.remove(SESSION_KEY);
    return;
  }
  await chrome.storage.local.set({ [SESSION_KEY]: session });
}

async function refreshSessionIfNeeded(session) {
  if (!session?.refresh_token) return session;
  const expMs = session.expires_at ? Number(session.expires_at) * 1000 : 0;
  if (expMs && expMs > Date.now() + 120000) return session;

  const res = await fetch(`${PH_CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: PH_CONFIG.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) return session;
  const next = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || session.refresh_token,
    expires_at: data.expires_at || null,
    user: data.user || session.user
  };
  await saveSession(next);
  return next;
}

async function getValidSession() {
  let session = await loadSession();
  if (!session) return null;
  session = await refreshSessionIfNeeded(session);
  return session;
}

async function apiRequest(method, path, body) {
  const session = await getValidSession();
  if (!session?.access_token) {
    return { ok: false, code: 'UNAUTHORIZED', message: '请先登录 prompt-hub.cn' };
  }
  const res = await fetch(`${PH_CONFIG.API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: body != null ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    return {
      ok: false,
      code: json.error?.code || json.code || 'REQUEST_FAILED',
      message: json.error?.message || json.message || `请求失败 (${res.status})`
    };
  }
  return { ok: true, data: json.data };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'PH_SESSION') {
      const session = sessionFromBridge(msg.session);
      if (session) await saveSession(session);
      sendResponse({ ok: !!session });
      return;
    }
    if (msg?.type === 'PH_LOGOUT') {
      await chrome.storage.local.remove(SESSION_KEY);
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'PH_GET_AUTH') {
      const session = await getValidSession();
      sendResponse({
        ok: true,
        loggedIn: !!session?.access_token,
        email: session?.user?.email || null
      });
      return;
    }
    if (msg?.type === 'PH_SAVE_CARD') {
      const result = await apiRequest('POST', '/api/v1/extension/quick-card', {
        prompt: msg.prompt || '',
        title: msg.title || '',
        imageBase64: msg.imageBase64 || null,
        sourceUrl: msg.sourceUrl || null
      });
      sendResponse(result);
      return;
    }
    if (msg?.type === 'PH_SET_PANEL') {
      await chrome.storage.local.set({ [PANEL_ENABLED_KEY]: msg.enabled !== false });
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'PH_GET_PANEL') {
      const data = await chrome.storage.local.get([PANEL_ENABLED_KEY, DISCLAIMER_KEY]);
      sendResponse({
        ok: true,
        enabled: data[PANEL_ENABLED_KEY] !== false,
        disclaimerOk: !!data[DISCLAIMER_KEY]
      });
      return;
    }
    if (msg?.type === 'PH_ACCEPT_DISCLAIMER') {
      await chrome.storage.local.set({ [DISCLAIMER_KEY]: true });
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'PH_INJECT_PANEL') {
      const tabId = sender.tab?.id || msg.tabId;
      if (!tabId) {
        sendResponse({ ok: false, message: '无标签页' });
        return;
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/panel.js']
        });
        await chrome.scripting.insertCSS({
          target: { tabId },
          files: ['content/panel.css']
        });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, message: String(e.message || e) });
      }
      return;
    }
    sendResponse({ ok: false, message: 'unknown' });
  })().catch((e) => sendResponse({ ok: false, message: String(e.message || e) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ [PANEL_ENABLED_KEY]: true });
});

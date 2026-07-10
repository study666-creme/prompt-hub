importScripts('config.js');

const SESSION_KEY = 'ph_session';
const PANEL_ENABLED_KEY = 'ph_panel_enabled';
const DISCLAIMER_KEY = 'ph_disclaimer_ok';
const PANEL_PREFS_KEY = 'ph_panel_prefs';
const DEFAULT_PANEL_PREFS = {
  autoSaveWhenReady: true,
  autoTrimOnSave: false,
  autoEnablePublish: true
};
const injectedTabs = new Set();
const closedTabs = new Set();

function sessionFromBridge(raw) {
  if (!raw?.access_token) return null;
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token || null,
    expires_at: raw.expires_at || raw.expiresAt || null,
    user: raw.user || null
  };
}

function canInjectUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const blocked = ['chrome://', 'edge://', 'about:', 'chrome-extension://', 'devtools://'];
  return !blocked.some((p) => url.startsWith(p));
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

async function shouldAutoInject() {
  const data = await chrome.storage.local.get([PANEL_ENABLED_KEY, DISCLAIMER_KEY]);
  if (data[PANEL_ENABLED_KEY] === false) return false;
  if (!data[DISCLAIMER_KEY]) return false;
  return chrome.permissions.contains({ origins: ['<all_urls>'] });
}

async function teardownPanelInTab(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PH_TEARDOWN_PANEL' });
  } catch {
    /* 页面未注入或已关闭 */
  }
  injectedTabs.delete(tabId);
}

async function teardownAllInjectedPanels() {
  const tabIds = [...injectedTabs];
  await Promise.all(tabIds.map((tabId) => teardownPanelInTab(tabId)));
}

async function injectPanelIntoTab(tabId, force) {
  if (!tabId) return { ok: false, message: '无标签页' };
  if (!force && injectedTabs.has(tabId)) return { ok: true, skipped: true };
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['lib/image-trim.js', 'content/panel.js']
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content/panel.css']
    });
    injectedTabs.add(tabId);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e.message || e) };
  }
}

async function tryAutoInjectTab(tab) {
  if (!tab?.id || !canInjectUrl(tab.url)) return;
  if (closedTabs.has(tab.id)) return;
  if (!(await shouldAutoInject())) return;
  await injectPanelIntoTab(tab.id, false);
}

async function apiRequest(method, path, body) {
  const session = await getValidSession();
  if (!session?.access_token) {
    return { ok: false, code: 'UNAUTHORIZED', message: '请先登录 prompt-hubs.com' };
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
        sourceUrl: msg.sourceUrl || null,
        tags: msg.tags || [],
        publishToCommunity: msg.publishToCommunity === true
      });
      sendResponse(result);
      return;
    }
    if (msg?.type === 'PH_GET_STATUS') {
      const result = await apiRequest('GET', '/api/v1/extension/status');
      sendResponse(result);
      return;
    }
    if (msg?.type === 'PH_GET_TAGS') {
      const result = await apiRequest('GET', '/api/v1/extension/tags');
      sendResponse(result);
      return;
    }
    if (msg?.type === 'PH_GET_PREFS') {
      const data = await chrome.storage.local.get(PANEL_PREFS_KEY);
      const raw = data[PANEL_PREFS_KEY] || {};
      const prefs = { ...DEFAULT_PANEL_PREFS, ...raw };
      if (raw.autoSavePaste !== undefined && raw.autoSaveWhenReady === undefined) {
        prefs.autoSaveWhenReady = raw.autoSavePaste !== false;
      }
      sendResponse({ ok: true, prefs });
      return;
    }
    if (msg?.type === 'PH_SET_PREFS') {
      const prefs = { ...DEFAULT_PANEL_PREFS, ...(msg.prefs || {}) };
      await chrome.storage.local.set({ [PANEL_PREFS_KEY]: prefs });
      sendResponse({ ok: true, prefs });
      return;
    }
    if (msg?.type === 'PH_CLOSE_PANEL') {
      const tabId = sender.tab?.id || msg.tabId;
      if (tabId) {
        closedTabs.add(tabId);
        await teardownPanelInTab(tabId);
      }
      await chrome.storage.local.set({ [PANEL_ENABLED_KEY]: false });
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'PH_SET_PANEL') {
      await chrome.storage.local.set({ [PANEL_ENABLED_KEY]: msg.enabled !== false });
      if (msg.enabled === false) {
        await teardownAllInjectedPanels();
      } else {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          closedTabs.delete(tab.id);
          await tryAutoInjectTab(tab);
        }
      }
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
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await tryAutoInjectTab(tab);
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'PH_INJECT_PANEL' || msg?.type === 'PH_AUTO_INJECT_ACTIVE') {
      const tabId = sender.tab?.id || msg.tabId;
      if (!tabId) {
        sendResponse({ ok: false, message: '无标签页' });
        return;
      }
      closedTabs.delete(tabId);
      await chrome.storage.local.set({ [PANEL_ENABLED_KEY]: true });
      const res = await injectPanelIntoTab(tabId, true);
      sendResponse(res);
      return;
    }
    sendResponse({ ok: false, message: 'unknown' });
  })().catch((e) => sendResponse({ ok: false, message: String(e.message || e) }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return;
  void tryAutoInjectTab(tab || { id: tabId, url: tab?.url });
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    void tryAutoInjectTab(tab);
  } catch {
    /* tab closed */
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
  closedTabs.delete(tabId);
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ [PANEL_ENABLED_KEY]: true });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) void tryAutoInjectTab(tab);
});

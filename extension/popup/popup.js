const SITE = 'https://prompt-hub.cn/';

async function send(type, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...extra }, resolve);
  });
}

async function refreshAuth() {
  const line = document.getElementById('phAuthLine');
  const res = await send('PH_GET_AUTH');
  if (res?.loggedIn) {
    line.textContent = `已登录：${res.email || '账号'}`;
  } else {
    line.textContent = '未登录 — 请打开主站登录';
  }
}

async function ensureAllUrlsPermission() {
  const ok = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  if (ok) return true;
  return chrome.permissions.request({ origins: ['<all_urls>'] });
}

async function injectPanelOnActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, message: '无活动标签页' };
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://')) {
    return { ok: false, message: '此页面无法注入面板' };
  }
  const granted = await ensureAllUrlsPermission();
  if (!granted) return { ok: false, message: '需要「访问所有网站」权限' };
  return send('PH_INJECT_PANEL', { tabId: tab.id });
}

document.getElementById('phLoginBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: SITE });
  window.close();
});

document.getElementById('phLogoutBtn').addEventListener('click', async () => {
  await send('PH_LOGOUT');
  await refreshAuth();
});

document.getElementById('phPanelToggle').addEventListener('change', async (e) => {
  const on = e.target.checked;
  await send('PH_SET_PANEL', { enabled: on });
  if (on) {
    const granted = await ensureAllUrlsPermission();
    if (granted) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await send('PH_INJECT_PANEL', { tabId: tab.id });
    }
  }
});

document.getElementById('phOpenPanelBtn').addEventListener('click', async () => {
  const btn = document.getElementById('phOpenPanelBtn');
  btn.disabled = true;
  const res = await injectPanelOnActiveTab();
  btn.disabled = false;
  if (!res?.ok) alert(res?.message || '打开失败');
  else window.close();
});

(async () => {
  await refreshAuth();
  const panel = await send('PH_GET_PANEL');
  document.getElementById('phPanelToggle').checked = panel?.enabled !== false;
})();

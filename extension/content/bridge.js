(function () {
  const KEY = 'sb-d95gau8g91hmdup86ag0-auth-token';

  function readSession() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.currentSession || parsed?.session || parsed;
    } catch {
      return null;
    }
  }

  function pushSession() {
    const session = readSession();
    if (!session?.access_token) return;
    chrome.runtime.sendMessage({
      type: 'PH_SESSION',
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        user: session.user
      }
    }).catch(() => {});
  }

  pushSession();
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) pushSession();
  });
  setInterval(pushSession, 4000);
})();

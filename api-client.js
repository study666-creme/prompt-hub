/**
 * Prompt Hub 后端 API 客户端（Bearer = Supabase 会话 JWT）
 */
(function () {
  function baseUrl() {
    const u = String(window.API_BASE_URL || '').trim().replace(/\/$/, '');
    return u;
  }

  function isConfigured() {
    const u = baseUrl();
    return !!u && u !== 'disabled';
  }

  function getAccessToken() {
    const session = window.SupabaseSync?.getSession?.();
    return session?.access_token || null;
  }

  async function request(method, path, body) {
    if (!isConfigured()) {
      return { ok: false, code: 'API_NOT_CONFIGURED', message: '未配置 API 地址' };
    }
    const token = getAccessToken();
    if (!token) {
      return { ok: false, code: 'UNAUTHORIZED', message: '请先登录' };
    }
    let res;
    try {
      res = await fetch(`${baseUrl()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: body != null ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        message: '无法连接后端，请检查网络或 API 地址'
      };
    }
    let json = {};
    try {
      json = await res.json();
    } catch (e) {
      json = {};
    }
    if (!res.ok || json.ok === false) {
      const err = json.error || {};
      return {
        ok: false,
        status: res.status,
        code: err.code || 'REQUEST_FAILED',
        message: err.message || `请求失败 (${res.status})`
      };
    }
    return { ok: true, data: json.data };
  }

  async function syncMe(opts) {
    const silent = opts?.silent === true;
    const r = await request('GET', '/api/v1/me');
    if (!r.ok) {
      if (!silent && typeof showToast === 'function') {
        showToast(r.message);
      }
      return r;
    }
    const d = r.data;
    if (d && typeof d.credits === 'number' && window.PointsSystem?.setCreditsFromServer) {
      window.PointsSystem.setCreditsFromServer(d.credits);
    }
    if (d?.membership && window.Membership?.applyServerState) {
      window.Membership.applyServerState(d.membership);
    }
    if (d && 'firstSubOfferUsed' in d) {
      window.SubscriptionUI?.setFirstOfferUsedFromServer?.(!!d.firstSubOfferUsed);
    } else if (window.SupabaseSync?.isLoggedIn?.()) {
      window.SubscriptionUI?.setFirstOfferUsedFromServer?.(false);
    }
    window.PointsSystem?.updateCreditsUI?.();
    window.SubscriptionUI?.refreshOfferUI?.();
    return r;
  }

  async function redeem(code) {
    return request('POST', '/api/v1/redeem', { code });
  }

  async function getGenerationCost(resolution, quality, model) {
    const r = encodeURIComponent(resolution || '1k');
    const m = encodeURIComponent(model || 'quanneng2');
    return request('GET', `/api/v1/generate/cost?resolution=${r}&model=${m}`);
  }

  async function generateImage(payload) {
    return request('POST', '/api/v1/generate', payload);
  }

  async function getLedger(limit) {
    const n = Math.min(50, Math.max(1, Number(limit) || 20));
    return request('GET', `/api/v1/me/ledger?limit=${n}`);
  }

  async function checkLikeMilestone(postId, likes) {
    return request('POST', '/api/v1/community/like-milestone', {
      postId: String(postId || ''),
      likes: Math.max(0, Math.floor(Number(likes) || 0))
    });
  }

  window.PromptHubApi = {
    isConfigured,
    syncMe,
    redeem,
    getGenerationCost,
    generateImage,
    getLedger,
    checkLikeMilestone
  };
})();

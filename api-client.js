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

  async function getAccessToken() {
    if (window.SupabaseSync?.getValidAccessToken) {
      return window.SupabaseSync.getValidAccessToken();
    }
    const session = window.SupabaseSync?.getSession?.();
    return session?.access_token || null;
  }

  const API_TIMEOUT_MS = 22000;
  const API_GENERATE_TIMEOUT_MS = 45000;
  const API_JOB_POLL_TIMEOUT_MS = 35000;

  async function request(method, path, body, opts = {}, attempt = 0) {
    if (!isConfigured()) {
      return { ok: false, code: 'API_NOT_CONFIGURED', message: '未配置 API 地址' };
    }
    const token = await getAccessToken();
    if (!token) {
      return { ok: false, code: 'UNAUTHORIZED', message: '请先登录' };
    }
    const timeoutMs = opts.timeoutMs || API_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(`${baseUrl()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: body != null ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
    } catch (e) {
      const aborted = e && (e.name === 'AbortError' || String(e).includes('abort'));
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 600 + attempt * 400));
        return request(method, path, body, opts, attempt + 1);
      }
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        message: aborted
          ? '连接 api.prompt-hub.cn 超时，请换网络或稍后再试'
          : '无法连接 api.prompt-hub.cn，请检查网络或 VPN'
      };
    } finally {
      clearTimeout(timer);
    }
    let json = {};
    try {
      json = await res.json();
    } catch (e) {
      json = {};
    }
    if (!res.ok || json.ok === false) {
      const err = json.error || {};
      const code = err.code || 'REQUEST_FAILED';
      const message = err.message || `请求失败 (${res.status})`;
      if (res.status === 401 && attempt < 1 && window.SupabaseSync?.getValidAccessToken) {
        const refreshed = await window.SupabaseSync.getValidAccessToken();
        if (refreshed) return request(method, path, body, opts, attempt + 1);
      }
      return {
        ok: false,
        status: res.status,
        code,
        message
      };
    }
    return { ok: true, data: json.data };
  }

  async function syncMe(opts) {
    const silent = opts?.silent === true;
    const r = await request('GET', '/api/v1/me');
    if (!r.ok) {
      if (!silent && typeof showToast === 'function' && r.code !== 'NETWORK_ERROR') {
        showToast(r.message);
      }
      return r;
    }
    const d = r.data;
    if (d && typeof d.credits === 'number' && window.PointsSystem?.setCreditsFromServer) {
      window.PointsSystem.setCreditsFromServer(d.credits, {
        permanent: d.creditsPermanent,
        daily: d.dailyCredits,
        mode: d.creditGrantMode,
        note: d.dailyCreditsNote
      });
    }
    if (d?.membership && window.Membership?.applyServerState) {
      window.Membership.applyServerState(d.membership);
    }
    if (d && 'firstSubOfferUsed' in d) {
      window.SubscriptionUI?.setFirstOfferUsedFromServer?.(!!d.firstSubOfferUsed);
    } else if (window.SupabaseSync?.isLoggedIn?.()) {
      window.SubscriptionUI?.setFirstOfferUsedFromServer?.(false);
    }
    if (d?.creditGrantMode || d?.dailyCreditsByTier) {
      window.SubscriptionUI?.applyServerState?.(d);
    }
    window.PointsSystem?.updateCreditsUI?.();
    window.SubscriptionUI?.refreshOfferUI?.();
    return r;
  }

  async function redeem(code, opts) {
    const body = { code };
    if (opts?.creditGrantMode) body.creditGrantMode = opts.creditGrantMode;
    return request('POST', '/api/v1/redeem', body);
  }

  async function claimFreeTrial() {
    return request('POST', '/api/v1/membership/trial-free');
  }

  async function setCreditGrantMode(mode) {
    return request('POST', '/api/v1/membership/credit-mode', {
      creditGrantMode: mode
    });
  }

  async function getGenerationCost(resolution, quality, model) {
    const r = encodeURIComponent(resolution || '1k');
    const m = encodeURIComponent(model || 'quanneng2');
    return request('GET', `/api/v1/generate/cost?resolution=${r}&model=${m}`);
  }

  async function generateImage(payload) {
    return request('POST', '/api/v1/generate', payload, { timeoutMs: API_GENERATE_TIMEOUT_MS });
  }

  async function getGenerationJob(jobId) {
    return request('GET', `/api/v1/generate/jobs/${encodeURIComponent(jobId)}`, null, {
      timeoutMs: API_JOB_POLL_TIMEOUT_MS
    });
  }

  async function getLedger(limit) {
    const n = Math.min(50, Math.max(1, Number(limit) || 20));
    return request('GET', `/api/v1/me/ledger?limit=${n}`);
  }

  async function getMembershipTasks() {
    return request('GET', '/api/v1/membership/tasks');
  }

  async function syncMembershipTasks(payload) {
    return request('POST', '/api/v1/membership/tasks/sync', payload || {});
  }

  async function claimMembershipTask(taskKey) {
    return request(
      'POST',
      `/api/v1/membership/tasks/${encodeURIComponent(taskKey)}/claim`
    );
  }

  async function checkLikeMilestone(postId, likes) {
    return request('POST', '/api/v1/community/like-milestone', {
      postId: String(postId || ''),
      likes: Math.max(0, Math.floor(Number(likes) || 0))
    });
  }

  async function signMediaRef(ref) {
    const q = encodeURIComponent(String(ref || ''));
    return request('GET', `/api/v1/media/sign?ref=${q}`);
  }

  async function getGenerationImageUrl(jobId) {
    return request('GET', `/api/v1/media/generation/${encodeURIComponent(jobId)}/url`);
  }

  async function fetchMediaAsBlobUrl(remoteUrl) {
    if (!isConfigured() || !remoteUrl) return null;
    const token = getAccessToken();
    if (!token) return null;
    const q = encodeURIComponent(remoteUrl);
    try {
      const res = await fetch(`${baseUrl()}/api/v1/media/fetch?url=${q}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch (e) {
      return null;
    }
  }

  window.PromptHubApi = {
    isConfigured,
    syncMe,
    redeem,
    claimFreeTrial,
    getMembershipTasks,
    syncMembershipTasks,
    claimMembershipTask,
    setCreditGrantMode,
    getGenerationCost,
    generateImage,
    getGenerationJob,
    getLedger,
    checkLikeMilestone,
    signMediaRef,
    getGenerationImageUrl,
    fetchMediaAsBlobUrl
  };
})();

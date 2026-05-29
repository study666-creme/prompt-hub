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
  const API_FAST_TIMEOUT_MS = 2800;
  const API_SIGN_TIMEOUT_MS = 3500;
  const API_HEALTH_TIMEOUT_MS = 2000;
  const API_GENERATE_TIMEOUT_MS = 45000;
  const API_JOB_POLL_TIMEOUT_MS = 35000;
  const API_UNREACHABLE_COOLDOWN_MS = 10 * 60 * 1000;

  function markApiUnreachable() {
    window.__PH_API_DOWN_UNTIL__ = Date.now() + API_UNREACHABLE_COOLDOWN_MS;
  }

  function isApiUnreachable() {
    return !!(window.__PH_API_DOWN_UNTIL__ && Date.now() < window.__PH_API_DOWN_UNTIL__);
  }

  function isNetworkFetchError(e) {
    const s = String(e && (e.message || e) || '');
    return /Failed to fetch|NetworkError|ERR_CONNECTION|ENOTFOUND|ECONNREFUSED|refused/i.test(s);
  }

  function isFileOrigin() {
    return (
      window.__PH_FILE_ORIGIN__ === true
      || (typeof location !== 'undefined' && location.protocol === 'file:')
    );
  }

  async function recoverSessionForApi() {
    if (window.SupabaseSync?.healSessionOnResume) {
      const healed = await window.SupabaseSync.healSessionOnResume();
      if (healed) return true;
    }
    if (window.SupabaseSync?.getValidAccessToken) {
      const token = await window.SupabaseSync.getValidAccessToken({ force: true });
      return !!token;
    }
    return false;
  }

  async function request(method, path, body, opts = {}, attempt = 0) {
    if (isFileOrigin()) {
      return {
        ok: false,
        code: 'FILE_ORIGIN',
        message:
          '当前用 file:// 打开页面，浏览器禁止访问 API。请用 https://prompt-hub.cn 或运行 .\\serve-local.ps1 后访问 http://127.0.0.1:5500'
      };
    }
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
      if (isNetworkFetchError(e)) markApiUnreachable();
      if (attempt < 2 && !opts.noRetry && !isNetworkFetchError(e)) {
        await new Promise((r) => setTimeout(r, 600 + attempt * 400));
        return request(method, path, body, opts, attempt + 1);
      }
      const fileHint = isFileOrigin()
        ? '请用 https://prompt-hub.cn 打开，或运行 .\\serve-local.ps1'
        : '';
      return {
        ok: false,
        code: isFileOrigin() ? 'FILE_ORIGIN' : 'NETWORK_ERROR',
        message: fileHint
          || (aborted
            ? '连接 api.prompt-hub.cn 超时，请换网络或稍后再试'
            : '无法连接 api.prompt-hub.cn，请检查网络或 VPN')
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
      const errRaw = json.error;
      const err =
        typeof errRaw === 'object' && errRaw !== null
          ? errRaw
          : { message: errRaw != null ? String(errRaw) : '' };
      const code = err.code || (res.status === 429 ? 'RATE_LIMITED' : 'REQUEST_FAILED');
      const message =
        typeof err.message === 'string'
          ? err.message
          : err.message != null
            ? JSON.stringify(err.message)
            : res.status === 429
              ? '操作过于频繁，请稍后再试'
              : `请求失败 (${res.status})`;
      if (res.status === 401 && attempt < 2) {
        const recovered = await recoverSessionForApi();
        if (recovered) return request(method, path, body, opts, attempt + 1);
      }
      if (res.status === 429 && attempt < 4) {
        await new Promise((r) => setTimeout(r, 1200 + attempt * 800));
        return request(method, path, body, opts, attempt + 1);
      }
      return {
        ok: false,
        status: res.status,
        code,
        message,
        details:
          typeof err.details === 'string'
            ? err.details
            : err.details != null
              ? JSON.stringify(err.details)
              : undefined
      };
    }
    return { ok: true, data: json.data };
  }

  let syncMePromise = null;

  async function syncMe(opts) {
    if (syncMePromise) return syncMePromise;
    syncMePromise = (async () => {
      try {
        return await syncMeOnce(opts);
      } finally {
        syncMePromise = null;
      }
    })();
    return syncMePromise;
  }

  let apiHealthPromise = null;

  async function probeApiHealth() {
    if (!isConfigured() || isApiUnreachable()) return false;
    if (apiHealthPromise) return apiHealthPromise;
    apiHealthPromise = (async () => {
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), API_HEALTH_TIMEOUT_MS);
        const r = await fetch(`${baseUrl()}/health`, { method: 'GET', cache: 'no-store', signal: c.signal });
        clearTimeout(t);
        if (!r.ok) markApiUnreachable();
        return r.ok;
      } catch (e) {
        if (isNetworkFetchError(e)) markApiUnreachable();
        return false;
      } finally {
        apiHealthPromise = null;
      }
    })();
    return apiHealthPromise;
  }

  async function syncMeOnce(opts) {
    if (isApiUnreachable()) {
      return { ok: false, code: 'API_UNREACHABLE', message: 'API 暂不可用' };
    }
    const silent = opts?.silent === true;
    const r = await request('GET', '/api/v1/me', null, { timeoutMs: API_FAST_TIMEOUT_MS, noRetry: true });
    if (!r.ok && r.code === 'UNAUTHORIZED') {
      const recovered = await recoverSessionForApi();
      if (recovered) {
        const retry = await request('GET', '/api/v1/me', null, { timeoutMs: API_FAST_TIMEOUT_MS, noRetry: true });
        if (retry.ok) {
          const d = retry.data;
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
          return retry;
        }
      }
    }
    if (!r.ok) {
      if (!silent && typeof showToast === 'function' && r.code !== 'NETWORK_ERROR' && r.code !== 'UNAUTHORIZED') {
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

  const costCache = new Map();
  const costInflight = new Map();

  async function getGenerationCost(resolution, quality, model) {
    const key = `${model || 'quanneng2'}|${resolution || '1k'}|${quality || ''}`;
    const hit = costCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.data;
    if (costInflight.has(key)) return costInflight.get(key);
    const r = encodeURIComponent(resolution || '1k');
    const m = encodeURIComponent(model || 'quanneng2');
    const p = request('GET', `/api/v1/generate/cost?resolution=${r}&model=${m}`)
      .then((res) => {
        if (res.ok) costCache.set(key, { data: res, exp: Date.now() + 90_000 });
        return res;
      })
      .finally(() => costInflight.delete(key));
    costInflight.set(key, p);
    return p;
  }

  async function generateImage(payload) {
    return request('POST', '/api/v1/generate', payload, { timeoutMs: API_GENERATE_TIMEOUT_MS });
  }

  async function getGenerationJob(jobId) {
    return request('GET', `/api/v1/generate/jobs/${encodeURIComponent(jobId)}`, null, {
      timeoutMs: API_JOB_POLL_TIMEOUT_MS
    });
  }

  async function listRecentGenerationJobs() {
    return request('GET', '/api/v1/generate/jobs', null, { timeoutMs: API_TIMEOUT_MS });
  }

  async function getLedger(limit) {
    const n = Math.min(50, Math.max(1, Number(limit) || 20));
    return request('GET', `/api/v1/me/ledger?limit=${n}`);
  }

  async function getMembershipTasks() {
    return request('GET', '/api/v1/membership/tasks');
  }

  async function syncMembershipTasks(payload) {
    if (isApiUnreachable()) {
      return { ok: false, code: 'API_UNREACHABLE', message: 'API 暂不可用' };
    }
    return request('POST', '/api/v1/membership/tasks/sync', payload || {}, {
      timeoutMs: API_FAST_TIMEOUT_MS,
      noRetry: true
    });
  }

  async function claimMembershipTask(taskKey) {
    return request(
      'POST',
      `/api/v1/membership/tasks/${encodeURIComponent(taskKey)}/claim`
    );
  }

  async function checkinMembershipTask() {
    return request('POST', '/api/v1/membership/tasks/checkin');
  }

  async function redeemInviteCode(code) {
    return request('POST', '/api/v1/membership/tasks/redeem-invite', { code: String(code || '').trim() });
  }

  async function checkLikeMilestone(postId, likes) {
    return request('POST', '/api/v1/community/like-milestone', {
      postId: String(postId || ''),
      likes: Math.max(0, Math.floor(Number(likes) || 0))
    });
  }

  async function signMediaRef(ref, opts) {
    if (isApiUnreachable()) {
      return { ok: false, code: 'API_UNREACHABLE', message: 'API 暂不可用' };
    }
    const normalized = window.SupabaseSync?.normalizeImageRef?.(ref) || ref;
    const q = encodeURIComponent(String(normalized || ''));
    return request('GET', `/api/v1/media/sign?ref=${q}`, null, {
      timeoutMs: API_SIGN_TIMEOUT_MS,
      noRetry: true
    });
  }

  /** 游客浏览社区：无需登录 */
  async function publicGet(path, opts = {}, attempt = 0) {
    if (!isConfigured()) {
      return { ok: false, code: 'API_NOT_CONFIGURED', message: '未配置 API 地址' };
    }
    const timeoutMs = opts.timeoutMs || API_FAST_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl()}${path}`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        const code = json.error?.code || (res.status === 429 ? 'RATE_LIMITED' : 'REQUEST_FAILED');
        if (res.status === 429 && attempt < 4) {
          await new Promise((r) => setTimeout(r, 1000 + attempt * 900));
          return publicGet(path, opts, attempt + 1);
        }
        return {
          ok: false,
          status: res.status,
          code,
          message: json.error?.message || (res.status === 429 ? '操作过于频繁，请稍后再试' : `HTTP ${res.status}`)
        };
      }
      return json;
    } catch (e) {
      if (isNetworkFetchError(e)) markApiUnreachable();
      return { ok: false, code: 'NETWORK_ERROR', message: '无法连接社区服务' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function getCommunityFeed(opts = {}) {
    const limit = Math.min(100, Math.max(1, Number(opts.limit) || 60));
    const offset = Math.max(0, Number(opts.offset) || 0);
    return publicGet(`/api/v1/community/feed?limit=${limit}&offset=${offset}`, {
      timeoutMs: opts.timeoutMs || 12000
    });
  }

  async function publishCommunityPost(post) {
    return request('POST', '/api/v1/community/posts', post);
  }

  async function unpublishCommunityPost(postId) {
    return request('DELETE', `/api/v1/community/posts/${encodeURIComponent(String(postId || ''))}`);
  }

  async function syncCommunityPostsBatch(posts) {
    return request('POST', '/api/v1/community/posts/sync', { posts: posts || [] });
  }

  async function pushCommunityNotify(payload) {
    return request('POST', '/api/v1/community/notify', payload || {});
  }

  async function fetchCommunityNotifications(opts = {}) {
    const limit = Math.min(80, Math.max(1, Number(opts.limit) || 40));
    return request('GET', `/api/v1/community/notifications?limit=${limit}`);
  }

  async function signCommunityMediaRef(ref, opts) {
    if (!isConfigured()) {
      return { ok: false, code: 'API_NOT_CONFIGURED', message: '未配置 API 地址' };
    }
    const normalized = window.SupabaseSync?.normalizeImageRef?.(ref) || ref;
    const q = encodeURIComponent(String(normalized || ''));
    const aid = opts?.authorId ? `&authorId=${encodeURIComponent(String(opts.authorId))}` : '';
    const cid = opts?.cardId ? `&cardId=${encodeURIComponent(String(opts.cardId))}` : '';
    try {
      const res = await fetch(`${baseUrl()}/api/v1/media/community/sign?ref=${q}${aid}${cid}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          code: data.error?.code || data.code || 'SIGN_FAILED',
          message: data.error?.message || data.message || '社区图片签名失败'
        };
      }
      return data;
    } catch (e) {
      return { ok: false, code: 'NETWORK_ERROR', message: '无法连接图片服务' };
    }
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

  if (isConfigured()) {
    void probeApiHealth();
  }

  window.PromptHubApi = {
    isApiUnreachable,
    markApiUnreachable,
    probeApiHealth,
    isConfigured,
    syncMe,
    redeem,
    claimFreeTrial,
    getMembershipTasks,
    syncMembershipTasks,
    claimMembershipTask,
    checkinMembershipTask,
    redeemInviteCode,
    setCreditGrantMode,
    getGenerationCost,
    generateImage,
    getGenerationJob,
    listRecentGenerationJobs,
    getLedger,
    checkLikeMilestone,
    signMediaRef,
    signCommunityMediaRef,
    getCommunityFeed,
    publishCommunityPost,
    unpublishCommunityPost,
    syncCommunityPostsBatch,
    pushCommunityNotify,
    fetchCommunityNotifications,
    getGenerationImageUrl,
    fetchMediaAsBlobUrl
  };
})();

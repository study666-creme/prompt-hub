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

  const ACCESS_TOKEN_TIMEOUT_MS = 10000;

  async function getAccessToken() {
    const task = (async () => {
      if (window.SupabaseSync?.getValidAccessToken) {
        return window.SupabaseSync.getValidAccessToken();
      }
      const session = window.SupabaseSync?.getSession?.();
      return session?.access_token || null;
    })();
    const token = await Promise.race([
      task,
      new Promise((resolve) => setTimeout(() => resolve(null), ACCESS_TOKEN_TIMEOUT_MS))
    ]);
    return token || null;
  }

  const API_TIMEOUT_MS = 22000;
  const API_FAST_TIMEOUT_MS = 2800;
  const API_SIGN_TIMEOUT_MS = 3500;
  const API_HEALTH_TIMEOUT_MS = 2000;
  const API_GENERATE_TIMEOUT_MS = 45000;
  const API_JOB_POLL_TIMEOUT_MS = 12000;
  const API_JOB_DELIVERY_TIMEOUT_MS = 45000;
  const API_UNREACHABLE_COOLDOWN_MS = 10 * 60 * 1000;

  function markApiUnreachable() {
    window.__PH_API_DOWN_UNTIL__ = Date.now() + API_UNREACHABLE_COOLDOWN_MS;
  }

  function isApiUnreachable() {
    return !!(window.__PH_API_DOWN_UNTIL__ && Date.now() < window.__PH_API_DOWN_UNTIL__);
  }

  function isApiRateLimited() {
    return !!(window.__PH_API_RATE_LIMITED_UNTIL__ && Date.now() < window.__PH_API_RATE_LIMITED_UNTIL__);
  }

  function markApiRateLimited(ms) {
    const until = Date.now() + Math.max(15000, Number(ms) || 90000);
    window.__PH_API_RATE_LIMITED_UNTIL__ = Math.max(window.__PH_API_RATE_LIMITED_UNTIL__ || 0, until);
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

  let authRefreshInflight = null;

  function isMediaAuthPath(path) {
    return /\/api\/v1\/media\/(?:sign|warehouse-thumbs)/i.test(String(path || ''));
  }

  function isAuthSignPaused() {
    return !!(window.__PH_AUTH_SIGN_PAUSE_UNTIL__ && Date.now() < window.__PH_AUTH_SIGN_PAUSE_UNTIL__);
  }

  function pauseAuthSign(ms) {
    const until = Date.now() + Math.max(15000, Number(ms) || 90000);
    window.__PH_AUTH_SIGN_PAUSE_UNTIL__ = Math.max(window.__PH_AUTH_SIGN_PAUSE_UNTIL__ || 0, until);
  }

  function notifyAuthSignFailure(detail = {}) {
    if (window.__PH_AUTH_SIGN_TOAST_AT__ && Date.now() - window.__PH_AUTH_SIGN_TOAST_AT__ < 60000) return;
    window.__PH_AUTH_SIGN_TOAST_AT__ = Date.now();
    window.__PH_AUTH_SESSION_EXPIRED__ = true;
    try {
      window.SupabaseSync?.markSessionExpired?.({
        source: detail.source || 'api-client',
        reason: detail.reason || 'media-auth',
        message: detail.message || '登录已过期，请重新登录',
        emit: false
      });
    } catch (e) { /* ignore */ }
    window.dispatchEvent(new CustomEvent('ph-api-unauthorized', {
      detail: {
        source: 'api-client',
        reason: 'media-auth',
        message: '登录已过期，请重新登录',
        ...detail
      }
    }));
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

  async function ensureApiAuthFresh() {
    if (authRefreshInflight) return authRefreshInflight;
    authRefreshInflight = recoverSessionForApi().finally(() => {
      authRefreshInflight = null;
    });
    return authRefreshInflight;
  }

  async function request(method, path, body, opts = {}, attempt = 0) {
    if (isFileOrigin()) {
      return {
        ok: false,
        code: 'FILE_ORIGIN',
        message:
          '当前用 file:// 打开页面，浏览器禁止访问 API。请用 https://prompt-hubs.com 或运行 .\\serve-local.ps1 后访问 http://127.0.0.1:5500'
      };
    }
    if (!isConfigured()) {
      return { ok: false, code: 'API_NOT_CONFIGURED', message: '未配置 API 地址' };
    }
    if (isMediaAuthPath(path) && isAuthSignPaused()) {
      notifyAuthSignFailure({ source: 'api-client', reason: 'paused' });
      return { ok: false, code: 'UNAUTHORIZED', message: '登录已过期，请重新登录' };
    }
    if (isMediaAuthPath(path) && attempt === 0) {
      await ensureApiAuthFresh();
    }
    const token = await getAccessToken();
    if (!token && opts.public !== true) {
      if (isMediaAuthPath(path)) {
        pauseAuthSign(60000);
        notifyAuthSignFailure({ source: 'api-client', reason: 'missing-token', message: '登录已过期，请重新登录' });
      }
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
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body != null ? { 'Content-Type': 'application/json' } : {})
        },
        body: body != null ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
    } catch (e) {
      const aborted = e && (e.name === 'AbortError' || String(e).includes('abort'));
      const network = isNetworkFetchError(e) || aborted;
      if (attempt < 2 && !opts.noRetry && network) {
        window.__PH_API_DOWN_UNTIL__ = 0;
        await recoverSessionForApi();
        await new Promise((r) => setTimeout(r, 900 + attempt * 700));
        return request(method, path, body, opts, attempt + 1);
      }
      if (attempt < 2 && !opts.noRetry && !network) {
        await new Promise((r) => setTimeout(r, 600 + attempt * 400));
        return request(method, path, body, opts, attempt + 1);
      }
      if (network) markApiUnreachable();
      const fileHint = isFileOrigin()
        ? '请用 https://prompt-hubs.com 打开，或运行 .\\serve-local.ps1'
        : '';
      const apiHost = baseUrl() || 'api.prompt-hubs.com';
      const decimalHint =
        '若仍报积分相关错误，请确认 Supabase 已执行 migrations/20260602211000_credits_decimal_fixup.sql';
      return {
        ok: false,
        code: isFileOrigin() ? 'FILE_ORIGIN' : 'NETWORK_ERROR',
        message: fileHint
          || (aborted
            ? `连接 ${apiHost} 超时，请确认 Worker 在运行（本机 http://127.0.0.1:8787）`
            : `无法连接 ${apiHost}，请确认 start-dev.ps1 两个窗口都在运行。${decimalHint}`)
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
      const code = err.code || (res.status === 401 ? 'UNAUTHORIZED' : res.status === 429 ? 'RATE_LIMITED' : 'REQUEST_FAILED');
      const message =
        typeof err.message === 'string'
          ? err.message
          : err.message != null
            ? JSON.stringify(err.message)
            : res.status === 429
              ? '操作过于频繁，请稍后再试'
              : `请求失败 (${res.status})`;
      const details =
        typeof err.details === 'string' && err.details && err.details !== message
          ? err.details
          : '';
      const fullMessage =
        message === '服务器内部错误' && details
          ? `${message}（${details.slice(0, 120)}）`
          : message;
      if (res.status === 401 && attempt < 2 && !opts.noRetry) {
        const recovered = await ensureApiAuthFresh();
        if (recovered) return request(method, path, body, opts, attempt + 1);
        if (isMediaAuthPath(path)) {
          pauseAuthSign(60000);
          notifyAuthSignFailure({ source: 'api-client', reason: 'http-401', message: fullMessage });
        }
      } else if (res.status === 401 && isMediaAuthPath(path)) {
        pauseAuthSign(60000);
        notifyAuthSignFailure({ source: 'api-client', reason: 'http-401-final', message: fullMessage });
      }
      if (res.status === 429) {
        markApiRateLimited(90000 + attempt * 30000);
        if (!opts.noRetry && attempt < 2) {
          await new Promise((r) => setTimeout(r, 1800 + attempt * 1200));
          return request(method, path, body, opts, attempt + 1);
        }
      }
      return {
        ok: false,
        status: res.status,
        code,
        message: fullMessage,
        details:
          typeof err.details === 'string'
            ? err.details
            : err.details != null
              ? JSON.stringify(err.details)
              : undefined
      };
    }
    window.__PH_API_DOWN_UNTIL__ = 0;
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
  let lastHealthOkAt = 0;

  async function probeApiHealth(opts) {
    if (!isConfigured()) return false;
    if (!opts?.force && isApiUnreachable()) return false;
    if (apiHealthPromise && !opts?.force) return apiHealthPromise;
    const run = (async () => {
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), API_HEALTH_TIMEOUT_MS);
        const r = await fetch(`${baseUrl()}/health`, { method: 'GET', cache: 'no-store', signal: c.signal });
        clearTimeout(t);
        if (r.ok) {
          window.__PH_API_DOWN_UNTIL__ = 0;
          lastHealthOkAt = Date.now();
          return true;
        }
        if (!opts?.skipMark) markApiUnreachable();
        return false;
      } catch (e) {
        if (!opts?.skipMark && isNetworkFetchError(e)) markApiUnreachable();
        return false;
      }
    })();
    if (opts?.force) return run;
    apiHealthPromise = run;
    try {
      return await apiHealthPromise;
    } finally {
      apiHealthPromise = null;
    }
  }

  async function prepareApiCall(opts) {
    window.__PH_API_DOWN_UNTIL__ = 0;
    await recoverSessionForApi();
    if (opts?.light && Date.now() - lastHealthOkAt < 45000) return true;
    const ok = await probeApiHealth({
      force: !opts?.light,
      skipMark: true
    });
    return ok;
  }

  async function requestWithPrepare(method, path, body, opts) {
    if (!opts?.directFirst) {
      await prepareApiCall({ light: opts?.lightPrepare });
    }
    let r = await request(method, path, body, opts);
    if (!opts?.noRetry && !r.ok && (r.code === 'NETWORK_ERROR' || r.code === 'API_UNREACHABLE')) {
      await prepareApiCall();
      r = await request(method, path, body, opts);
    }
    return r;
  }

  async function syncMeOnce(opts) {
    if (isApiUnreachable()) {
      return { ok: false, code: 'API_UNREACHABLE', message: 'API 暂不可用' };
    }
    const silent = opts?.silent === true;

    function applyMePayload(d) {
      if (!d) return;
      if (typeof d.displayName === 'string' && d.displayName.trim()) {
        window.__userDisplayName = d.displayName.trim();
      }
      if (typeof d.credits === 'number' && window.PointsSystem?.setCreditsFromServer) {
        window.PointsSystem.setCreditsFromServer(d.credits, {
          permanent: d.creditsPermanent,
          daily: d.dailyCredits,
          mode: d.creditGrantMode,
          note: d.dailyCreditsNote
        });
      }
      if (d.membership && window.Membership?.applyServerState) {
        window.Membership.applyServerState(d.membership);
      }
      if ('firstSubOfferUsed' in d) {
        window.SubscriptionUI?.setFirstOfferUsedFromServer?.(!!d.firstSubOfferUsed);
      } else if (window.SupabaseSync?.isLoggedIn?.()) {
        window.SubscriptionUI?.setFirstOfferUsedFromServer?.(false);
      }
      if (d.creditGrantMode || d.dailyCreditsByTier) {
        window.SubscriptionUI?.applyServerState?.(d);
      }
      if (d.inspirationDraw) {
        window.ImageGenPromptTools?.applyQuota?.(d.inspirationDraw);
      }
      if (d.communityGacha) {
        window.CommunityGacha?.applyQuota?.(d.communityGacha);
      }
      if (d.storage && window.Membership?.applyStorageState) {
        window.Membership.applyStorageState(d.storage);
      }
      window.PointsSystem?.updateCreditsUI?.();
      window.SubscriptionUI?.refreshOfferUI?.();
    }

    const r = await request('GET', '/api/v1/me', null, { timeoutMs: API_FAST_TIMEOUT_MS, noRetry: true });
    if (!r.ok && r.code === 'UNAUTHORIZED') {
      const recovered = await recoverSessionForApi();
      if (recovered) {
        const retry = await request('GET', '/api/v1/me', null, { timeoutMs: API_FAST_TIMEOUT_MS, noRetry: true });
        if (retry.ok) {
          applyMePayload(retry.data);
          prefetchGenerationModels();
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
    applyMePayload(r.data);
    prefetchGenerationModels();
    return r;
  }

  async function reportStorageDelta(delta) {
    const n = Math.max(0, Math.floor(Number(delta) || 0));
    if (!n) return { ok: true };
    const r = await request('POST', '/api/v1/me/storage/delta', { delta: n });
    if (r.ok && r.data && window.Membership?.applyStorageState) {
      window.Membership.applyStorageState(r.data);
    }
    return r;
  }

  async function setDisplayName(displayName) {
    const r = await requestWithPrepare('PATCH', '/api/v1/me/display-name', { displayName });
    if (r.ok && r.data?.displayName) {
      window.__userDisplayName = String(r.data.displayName);
      window.FeatureDraft?.onDisplayNameChanged?.();
    }
    return r;
  }

  async function listAssetPackages() {
    return request('GET', '/api/v1/asset-packages');
  }

  async function getAssetPackageCovers(id) {
    return request('GET', `/api/v1/asset-packages/${encodeURIComponent(id)}/covers`);
  }

  async function listMyOwnedAssetPackages() {
    return request('GET', '/api/v1/asset-packages/mine/owned');
  }

  async function listMyPublishedAssetPackages() {
    return request('GET', '/api/v1/asset-packages/mine/published');
  }

  async function claimAssetPackage(id) {
    return request('POST', `/api/v1/asset-packages/${encodeURIComponent(id)}/claim`);
  }

  async function publishAssetPackage(payload) {
    return request('POST', '/api/v1/asset-packages', payload);
  }

  async function updateAssetPackage(id, payload) {
    return requestWithPrepare('PATCH', `/api/v1/asset-packages/${encodeURIComponent(id)}`, payload);
  }

  async function getAssetPackageContent(id) {
    return request('GET', `/api/v1/asset-packages/${encodeURIComponent(id)}/content`);
  }

  async function getCommunityGachaQuota() {
    return request('GET', '/api/v1/community/gacha/quota');
  }

  async function consumeCommunityGachaDraw() {
    return request('POST', '/api/v1/community/gacha/draw');
  }

  async function importAssetPackage(id, warehouseId, folders, cardIds) {
    const body = { warehouseId };
    if (Array.isArray(folders) && folders.length) body.folders = folders;
    if (Array.isArray(cardIds) && cardIds.length) body.cardIds = cardIds;
    return request('POST', `/api/v1/asset-packages/${encodeURIComponent(id)}/import`, body);
  }

  async function getAssetPackageFolderImages(id, folder) {
    const f = encodeURIComponent(folder || '');
    return request('GET', `/api/v1/asset-packages/${encodeURIComponent(id)}/folders/${f}/images`);
  }

  async function downloadAssetPackageJson(id) {
    if (!isConfigured()) {
      return { ok: false, code: 'API_NOT_CONFIGURED', message: '未配置 API 地址' };
    }
    const token = await getAccessToken();
    if (!token) return { ok: false, code: 'UNAUTHORIZED', message: '请先登录' };
    try {
      const res = await fetch(`${baseUrl()}/api/v1/asset-packages/${encodeURIComponent(id)}/export`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        let json = {};
        try {
          json = await res.json();
        } catch (e) {
          json = {};
        }
        const err = json.error || {};
        return {
          ok: false,
          code: err.code || 'REQUEST_FAILED',
          message: err.message || `下载失败 (${res.status})`
        };
      }
      const blob = await res.blob();
      const disp = res.headers.get('Content-Disposition') || '';
      const m = /filename="([^"]+)"/.exec(disp);
      const filename = m?.[1] || `asset-pack-${id}.json`;
      return { ok: true, blob, filename };
    } catch (e) {
      if (isNetworkFetchError(e)) markApiUnreachable();
      return { ok: false, code: 'NETWORK_ERROR', message: '无法连接 api.prompt-hubs.com，请检查网络或 VPN' };
    }
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
  const IMAGE_GEN_CATALOG_CACHE_VERSION = 19;
  const PUBLIC_IMAGE_MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const RETIRED_PUBLIC_IMAGE_MODEL_IDS = new Set(['image2-free']);
  const PUBLIC_IMAGE_MODEL_LABEL_OVERRIDES = {
    'image2-4k-fast': '全能模型2 · 4K'
  };
  const PRIVATE_PUBLIC_MODEL_TEXT_RE = /(?:https?:\/\/|www\.|\b(?:upstream|provider|reseller|channel|route|priority|weight|margin|markup|multiplier|base\s*url)\b|上游|供应商|供货商|渠道|通道|线路|路由|采购|进货|成本|毛利|利润|倍率|加价|结算价|内部价|实时价|优先级|权重|故障转移)/i;
  const PRIVATE_PUBLIC_MODEL_PARAMETER_RE = /(?:upstream|provider|reseller|channel|route|group|priority|weight|margin|markup|multiplier|cost|base_?url|api_?key)/i;
  let modelsCache = null;
  let modelsCacheExp = 0;
  let modelsInflight = null;

  function publicModelText(value, fallback = '', maxLength = 240) {
    const text = String(value ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || PRIVATE_PUBLIC_MODEL_TEXT_RE.test(text)) return String(fallback || '').slice(0, maxLength);
    return text.slice(0, maxLength);
  }

  function publicModelNumber(value) {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function publicModelPrimitive(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string') {
      const text = publicModelText(value, '', 160);
      return text || undefined;
    }
    if (Array.isArray(value)) {
      return value.slice(0, 64).map(publicModelPrimitive).filter((item) => item !== undefined);
    }
    return undefined;
  }

  function publicModelStringList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
      .map((item) => String(item || '').trim())
      .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/.test(item)))]
      .slice(0, 64);
  }

  function publicModelCreditMap(primary, legacy, keys) {
    const result = {};
    for (const key of keys) {
      const primaryValue = primary?.[key];
      const legacyValue = legacy?.[key];
      const credits = publicModelNumber(
        primaryValue && typeof primaryValue === 'object' ? primaryValue.final : primaryValue
      ) ?? publicModelNumber(
        legacyValue && typeof legacyValue === 'object' ? legacyValue.final : legacyValue
      );
      if (credits != null) result[key] = credits;
    }
    return result;
  }

  function projectPublicGenerationParameter(parameter, publicModelId) {
    if (!parameter || typeof parameter !== 'object') return null;
    const name = String(parameter.name || '').trim();
    const path = String(parameter.path || '').trim();
    if (!name || !path || PRIVATE_PUBLIC_MODEL_PARAMETER_RE.test(name) || PRIVATE_PUBLIC_MODEL_PARAMETER_RE.test(path)) return null;
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(name) || !/^[A-Za-z0-9_.-]{1,120}$/.test(path)) return null;
    const type = ['string', 'integer', 'number', 'boolean', 'array', 'object'].includes(String(parameter.type))
      ? String(parameter.type)
      : 'string';
    const result = {
      name,
      path,
      label: publicModelText(parameter.label, name, 80),
      type,
      required: parameter.required === true
    };
    const defaultValue = publicModelPrimitive(parameter.default);
    const fixedValue = name === 'model' ? publicModelId : publicModelPrimitive(parameter.fixed);
    const options = publicModelPrimitive(parameter.options);
    if (defaultValue !== undefined) result.default = defaultValue;
    if (fixedValue !== undefined) result.fixed = fixedValue;
    if (Array.isArray(options) && options.length) result.options = options;
    for (const key of ['min', 'max', 'min_items', 'max_items']) {
      const number = Number(parameter[key]);
      if (Number.isFinite(number)) result[key] = number;
    }
    if (parameter.items && typeof parameter.items === 'object') {
      const itemType = publicModelPrimitive(parameter.items.type);
      const itemFormat = publicModelPrimitive(parameter.items.format);
      const items = {};
      if (typeof itemType === 'string') items.type = itemType;
      if (typeof itemFormat === 'string') items.format = itemFormat;
      if (Object.keys(items).length) result.items = items;
    }
    return result;
  }

  function projectPublicGenerationModel(model) {
    if (!model || typeof model !== 'object') return null;
    const id = String(model.id || '').trim();
    if (
      !PUBLIC_IMAGE_MODEL_ID_RE.test(id)
      || PRIVATE_PUBLIC_MODEL_TEXT_RE.test(id)
      || RETIRED_PUBLIC_IMAGE_MODEL_IDS.has(id)
    ) return null;
    const labelOverride = PUBLIC_IMAGE_MODEL_LABEL_OVERRIDES[id];
    const label = labelOverride || publicModelText(model.displayLabel || model.label || model.catalogLabel, id, 80);
    const catalogLabel = labelOverride || publicModelText(model.catalogLabel || model.label, label, 80);
    const description = publicModelText(model.description, '', 240) || null;
    const uiFamily = ['gim2', 'banana', 'midjourney'].includes(String(model.uiFamily))
      ? String(model.uiFamily)
      : (id.startsWith('mj-') ? 'midjourney' : (id.startsWith('lingtu') ? 'banana' : 'gim2'));
    const status = ['active', 'maintenance', 'offline'].includes(String(model.status))
      ? String(model.status)
      : 'active';
    const creditsByResolution = publicModelCreditMap(
      model.creditsByResolution,
      model.costByResolution,
      ['1k', '2k', '4k']
    );
    const creditsBySpeed = publicModelCreditMap(
      model.creditsBySpeed,
      model.costBySpeed,
      ['relax', 'fast', 'turbo']
    );
    const creditsPerCall = publicModelNumber(model.creditsPerCall)
      ?? publicModelNumber(model.creditsFinal)
      ?? publicModelNumber(model.cost?.credits);
    const creditsFinal = publicModelNumber(model.creditsFinal) ?? creditsPerCall;
    const result = {
      id,
      label,
      catalogLabel,
      description,
      uiFamily,
      sortOrder: Number.isFinite(Number(model.sortOrder)) ? Number(model.sortOrder) : 999,
      status,
      selectable: model.selectable !== false,
      refundOnViolation: model.refundOnViolation === true,
      statusNotice: publicModelText(model.statusNotice, '', 160) || null,
      violationNotice: publicModelText(model.violationNotice, '', 160) || null,
      fixedQualityLow: model.fixedQualityLow === true,
      resolutions: publicModelStringList(model.resolutions),
      aspectRatios: publicModelStringList(model.aspectRatios),
      parameters: Array.isArray(model.parameters)
        ? model.parameters.slice(0, 32)
          .map((parameter) => projectPublicGenerationParameter(parameter, id))
          .filter(Boolean)
        : [],
      pricingByResolution: model.pricingByResolution === true || Object.keys(creditsByResolution).length > 0,
      creditsByResolution,
      pricingBySpeed: model.pricingBySpeed === true || Object.keys(creditsBySpeed).length > 0,
      creditsBySpeed
    };
    const maxReferenceImages = publicModelNumber(model.maxReferenceImages);
    if (maxReferenceImages != null) result.maxReferenceImages = Math.floor(maxReferenceImages);
    if (creditsPerCall != null) result.creditsPerCall = creditsPerCall;
    if (creditsFinal != null) result.creditsFinal = creditsFinal;
    return result;
  }

  function projectGenerationModels(models) {
    if (!Array.isArray(models)) return [];
    return models.map(projectPublicGenerationModel).filter(Boolean);
  }

  function getGenerationModels() {
    if (modelsInflight) return modelsInflight;
    if (modelsCache && modelsCacheExp > Date.now()) {
      return Promise.resolve({ ok: true, data: modelsCache });
    }
    modelsInflight = (async () => {
      try {
        const raw = JSON.parse(localStorage.getItem('promptrepo_imagegen_models_cache_v4') || 'null');
        if (raw?.models?.length && Number(raw.version) >= IMAGE_GEN_CATALOG_CACHE_VERSION && raw.ts > Date.now() - 7 * 24 * 3600 * 1000) {
          const models = projectGenerationModels(raw.models);
          modelsCache = { models };
          modelsCacheExp = Date.now() + 45_000;
          localStorage.setItem(
            'promptrepo_imagegen_models_cache_v4',
            JSON.stringify({ ts: raw.ts, version: IMAGE_GEN_CATALOG_CACHE_VERSION, models })
          );
        }
      } catch (e) { /* ignore */ }
      const res = await request(
        'GET',
        `/api/v1/generate/models?refresh=1&v=${IMAGE_GEN_CATALOG_CACHE_VERSION}`,
        null,
        { timeoutMs: 8000, public: true }
      );
      if (res.ok && res.data) {
        const models = projectGenerationModels(res.data.models);
        modelsCache = { models };
        modelsCacheExp = Date.now() + 120_000;
        if (models.length) {
          try {
            localStorage.setItem(
              'promptrepo_imagegen_models_cache_v4',
              JSON.stringify({ ts: Date.now(), version: IMAGE_GEN_CATALOG_CACHE_VERSION, models })
            );
          } catch (e) { /* ignore */ }
        }
        return { ...res, data: modelsCache };
      }
      if (modelsCache) return { ok: true, data: modelsCache };
      return res;
    })().finally(() => {
      modelsInflight = null;
    });
    return modelsInflight;
  }

  function prefetchGenerationModels() {
    if (!isConfigured() || isApiUnreachable()) return;
    void getGenerationModels().catch(() => {});
  }

  async function getGenerationCost(resolution, quality, model, opts) {
    const speed = opts?.speed ? String(opts.speed) : '';
    const key = `${model || 'image2'}|${resolution || '1k'}|${quality || ''}|${speed}`;
    const hit = costCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.data;
    if (costInflight.has(key)) return costInflight.get(key);
    const r = encodeURIComponent(resolution || '1k');
    const m = encodeURIComponent(model || 'image2');
    const speedQ = speed ? `&speed=${encodeURIComponent(speed)}` : '';
    const p = request('GET', `/api/v1/generate/cost?resolution=${r}&model=${m}${speedQ}`)
      .then((res) => {
        if (res.ok) costCache.set(key, { data: res, exp: Date.now() + 90_000 });
        return res;
      })
      .finally(() => costInflight.delete(key));
    costInflight.set(key, p);
    return p;
  }

  async function generateImage(payload) {
    window.__PH_API_DOWN_UNTIL__ = 0;
    return requestWithPrepare('POST', '/api/v1/generate', payload, {
      timeoutMs: API_GENERATE_TIMEOUT_MS,
      lightPrepare: true,
      directFirst: true,
      noRetry: true
    });
  }

  async function getGenerationJob(jobId, opts = {}) {
    const settle = opts?.settle ? '?settle=1' : '';
    return request('GET', `/api/v1/generate/jobs/${encodeURIComponent(jobId)}${settle}`, null, {
      timeoutMs: Number(opts.timeoutMs) > 0
        ? Number(opts.timeoutMs)
        : opts.settle
          ? 30000
          : API_JOB_POLL_TIMEOUT_MS,
      noRetry: opts.noRetry !== false
    });
  }

  async function getGenerationJobByClientRequestId(clientRequestId) {
    return request(
      'GET',
      `/api/v1/generate/requests/${encodeURIComponent(String(clientRequestId || ''))}`,
      null,
      { timeoutMs: API_JOB_POLL_TIMEOUT_MS, noRetry: true }
    );
  }

  async function getGenerationJobImageBlobUrl(jobId, opts = {}, attempt = 0) {
    let token = await getAccessToken();
    if (!token && attempt === 0) {
      await recoverSessionForApi();
      token = await getAccessToken();
    }
    if (!token) return { ok: false, code: 'UNAUTHORIZED', message: '请先登录' };
    const index = Math.max(0, Math.min(7, Number(opts.index) || 0));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_JOB_DELIVERY_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(
        `${baseUrl()}/api/v1/generate/jobs/${encodeURIComponent(jobId)}/image?index=${index}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
          cache: 'no-store'
        }
      );
    } catch (e) {
      clearTimeout(timer);
      const aborted = e?.name === 'AbortError' || String(e).includes('abort');
      return {
        ok: false,
        code: aborted ? 'DELIVERY_TIMEOUT' : 'NETWORK_ERROR',
        message: aborted ? '取图超时' : '暂时无法获取生成图片'
      };
    }
    if (res.status === 401 && attempt === 0) {
      clearTimeout(timer);
      await recoverSessionForApi();
      return getGenerationJobImageBlobUrl(jobId, opts, 1);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      clearTimeout(timer);
      return {
        ok: false,
        status: res.status,
        code: body?.error?.code || (res.status === 404 ? 'NOT_READY' : 'DELIVERY_FAILED'),
        message: body?.error?.message || (res.status === 404 ? '图片尚未就绪' : '生成图片交付失败')
      };
    }
    let blob;
    try {
      blob = await res.blob();
    } catch (e) {
      const aborted = e?.name === 'AbortError' || String(e).includes('abort');
      clearTimeout(timer);
      return {
        ok: false,
        code: aborted ? 'DELIVERY_TIMEOUT' : 'DELIVERY_READ_FAILED',
        message: aborted ? '取图超时' : '生成图片读取失败，请稍后重试'
      };
    }
    clearTimeout(timer);
    if (!blob.size || !String(blob.type || '').toLowerCase().startsWith('image/')) {
      return { ok: false, code: 'INVALID_IMAGE', message: '生成结果不是有效图片' };
    }
    const imageUrl = URL.createObjectURL(blob);
    return { ok: true, data: { imageUrl, blob, contentType: blob.type, size: blob.size } };
  }

  async function mjAction(payload) {
    window.__PH_API_DOWN_UNTIL__ = 0;
    return requestWithPrepare('POST', '/api/v1/generate/mj-action', payload, {
      timeoutMs: API_GENERATE_TIMEOUT_MS,
      lightPrepare: true,
      directFirst: true
    });
  }

  async function mjBlend(payload) {
    window.__PH_API_DOWN_UNTIL__ = 0;
    return requestWithPrepare('POST', '/api/v1/generate/mj-blend', payload, {
      timeoutMs: API_GENERATE_TIMEOUT_MS,
      lightPrepare: true,
      directFirst: true
    });
  }

  async function studioChat(payload) {
    return request('POST', '/api/v1/chat', payload, { timeoutMs: 120000 });
  }

  async function studioChatQuote(params) {
    const q = new URLSearchParams();
    if (params?.model) q.set('model', params.model);
    if (params?.thinking) q.set('thinking', '1');
    if (params?.inputTokens) q.set('inputTokens', String(params.inputTokens));
    const qs = q.toString();
    return request('GET', `/api/v1/chat/cost${qs ? `?${qs}` : ''}`, null, { timeoutMs: API_FAST_TIMEOUT_MS });
  }

  async function promptToolsOptimize(payload) {
    return request('POST', '/api/v1/prompt-tools/optimize', payload, { timeoutMs: 90000 });
  }

  async function promptToolsReverse(payload) {
    return request('POST', '/api/v1/prompt-tools/reverse', payload, { timeoutMs: 120000 });
  }

  async function promptToolsFission(payload) {
    return request('POST', '/api/v1/prompt-tools/fission', payload, { timeoutMs: 120000 });
  }

  async function promptToolsPurifyDescribe(payload) {
    return request('POST', '/api/v1/prompt-tools/purify-describe', payload, { timeoutMs: 120000 });
  }

  async function promptToolsInfo() {
    return request('GET', '/api/v1/prompt-tools/info', null, { timeoutMs: API_FAST_TIMEOUT_MS });
  }

  async function consumeInspirationDraw() {
    return requestWithPrepare('POST', '/api/v1/prompt-tools/inspiration-draw', {});
  }

  async function listRecentGenerationJobs() {
    return request('GET', '/api/v1/generate/jobs', null, { timeoutMs: API_TIMEOUT_MS });
  }

  async function listGenerationJobsHistory(opts = {}) {
    const days = Math.min(365, Math.max(1, Number(opts.days) || 90));
    const limit = Math.min(500, Math.max(1, Number(opts.limit) || 200));
    return request(
      'GET',
      `/api/v1/generate/jobs/history?days=${days}&limit=${limit}`,
      null,
      { timeoutMs: Math.max(API_TIMEOUT_MS, 45000) }
    );
  }

  /**
   * Create an online payment order. The options argument is intentionally
   * optional so older callers using the original three-argument contract keep
   * working while custom top-ups can pass their amount and return target.
   */
  async function createPaymentCheckout(productId, paymentMethod, creditGrantMode, options = {}) {
    if (typeof options === 'number' || typeof options === 'string') {
      options = { customAmount: Number(options) };
    } else if (!options || typeof options !== 'object') {
      options = {};
    }
    const payload = {
      productId,
      paymentMethod,
      creditGrantMode
    };
    if (options.customAmount !== undefined && options.customAmount !== null && options.customAmount !== '') {
      payload.customAmount = Number(options.customAmount);
    }
    if (options.returnTarget === 'card-library' || options.returnTarget === 'canvas') {
      payload.returnTarget = options.returnTarget;
    }
    if (typeof options.returnPath === 'string' && options.returnPath) {
      payload.returnPath = options.returnPath;
    }
    // A lost response must never transparently submit a second payment order.
    // Keep this POST non-retriable; the caller can explicitly retry after
    // checking the order status.
    return request('POST', '/api/v1/payments/checkout', payload, {
      timeoutMs: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : API_TIMEOUT_MS,
      noRetry: true
    });
  }

  async function listRecentGeneratedCreations(opts = {}) {
    const days = Math.min(30, Math.max(1, Number(opts.days) || 7));
    const limit = Math.min(400, Math.max(1, Number(opts.limit) || 200));
    return request(
      'GET',
      `/api/v1/generate/jobs/recent?days=${days}&limit=${limit}`,
      null,
      { timeoutMs: Math.max(API_TIMEOUT_MS, 30000) }
    );
  }

  async function getLedger(limit) {
    const n = Math.min(50, Math.max(1, Number(limit) || 20));
    return request('GET', `/api/v1/me/ledger?limit=${n}`);
  }

  async function getMembershipTasks() {
    return request('GET', '/api/v1/membership/tasks');
  }

  async function syncMembershipTasks(payload) {
    if (isApiUnreachable() || isApiRateLimited()) {
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
    if (isApiRateLimited()) {
      return { ok: false, code: 'RATE_LIMITED', message: '操作过于频繁，请稍后再试' };
    }
    const normalized = window.SupabaseSync?.normalizeImageRef?.(ref) || ref;
    const q = encodeURIComponent(String(normalized || ''));
    const variant = opts?.variant === 'full' ? 'full' : 'grid';
    if (isApiUnreachable()) {
      await probeApiHealth({ force: true, skipMark: true }).catch(() => false);
    }
    return request('GET', `/api/v1/media/sign?ref=${q}&variant=${variant}`, null, {
      timeoutMs: API_SIGN_TIMEOUT_MS,
      noRetry: true
    });
  }

  async function signMediaRefsBatch(refs, opts) {
    const list = (refs || []).filter(Boolean).slice(0, 48);
    if (!list.length) return { ok: true, data: { urls: {} } };
    if (isApiUnreachable()) {
      await probeApiHealth({ force: true, skipMark: true }).catch(() => false);
    }
    return request('POST', '/api/v1/media/sign-batch', { refs: list }, {
      timeoutMs: opts?.timeoutMs || 8000
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
      window.__PH_API_DOWN_UNTIL__ = 0;
      return json;
    } catch (e) {
      const network = isNetworkFetchError(e) || e?.name === 'AbortError';
      if (network && attempt < 2 && !opts.noRetry) {
        await new Promise((r) => setTimeout(r, 600 + attempt * 900));
        return publicGet(path, { ...opts, noRetry: attempt >= 1 }, attempt + 1);
      }
      if (network && !opts.skipUnreachableMark) markApiUnreachable();
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        message: e?.name === 'AbortError' ? '连接 api.prompt-hubs.com 超时，请换网络或稍后再试' : '无法连接社区服务'
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function getCommunityFeed(opts = {}) {
    const limit = Math.min(100, Math.max(1, Number(opts.limit) || 60));
    const offset = Math.max(0, Number(opts.offset) || 0);
    return publicGet(`/api/v1/community/feed?limit=${limit}&offset=${offset}`, {
      timeoutMs: opts.timeoutMs || 22000,
      skipUnreachableMark: opts.skipUnreachableMark !== false,
      noRetry: !!opts.noRetry
    });
  }

  async function publishCommunityPost(post) {
    return request('POST', '/api/v1/community/posts', post);
  }

  async function unpublishCommunityPost(postId) {
    return request('DELETE', `/api/v1/community/posts/${encodeURIComponent(String(postId || ''))}`);
  }

  async function syncCommunityPostsBatch(posts) {
    if (isApiUnreachable() || isApiRateLimited()) {
      return { ok: false, code: 'API_UNREACHABLE', message: 'API 暂不可用' };
    }
    const batchSize = Math.max(1, (posts || []).length);
    const timeoutMs = Math.min(120000, Math.max(45000, 12000 + batchSize * 120));
    return request('POST', '/api/v1/community/posts/sync', { posts: posts || [] }, {
      timeoutMs,
      noRetry: false
    });
  }

  async function likeCommunityPost(postId) {
    return request('POST', `/api/v1/community/posts/${encodeURIComponent(String(postId || ''))}/like`, {});
  }

  async function pushCommunityNotify(payload) {
    return request('POST', '/api/v1/community/notify', payload || {});
  }

  async function fetchCommunityNotifications(opts = {}) {
    const limit = Math.min(200, Math.max(1, Number(opts.limit) || 120));
    return request('GET', `/api/v1/community/notifications?limit=${limit}`);
  }

  async function publicPost(path, body, opts = {}, attempt = 0) {
    if (!isConfigured()) {
      return { ok: false, code: 'API_NOT_CONFIGURED', message: '未配置 API 地址' };
    }
    if (isApiRateLimited()) {
      return { ok: false, code: 'RATE_LIMITED', message: '操作过于频繁，请稍后再试' };
    }
    const max429Retries = opts.max429Retries != null ? Number(opts.max429Retries) : 4;
    const timeoutMs = opts.timeoutMs || API_FAST_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        cache: 'no-store',
        signal: controller.signal
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        const code = json.error?.code || (res.status === 429 ? 'RATE_LIMITED' : 'REQUEST_FAILED');
        if (res.status === 429 && attempt < max429Retries) {
          await new Promise((r) => setTimeout(r, 1000 + attempt * 900));
          return publicPost(path, body, opts, attempt + 1);
        }
        if (res.status === 429 || res.status === 503) {
          markApiRateLimited(res.status === 503 ? 120000 : 90000);
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

  async function signCommunityMediaRefsBatch(items, opts) {
    const list = (items || [])
      .filter((item) => item && String(item.ref || '').trim())
      .slice(0, 40)
      .map((item) => ({
        ref: String(item.ref || '').trim(),
        authorId: item.authorId ? String(item.authorId) : undefined,
        cardId: item.cardId ? String(item.cardId) : undefined
      }));
    if (!list.length) return { ok: true, data: { urls: {}, refMap: {} } };
    return publicPost('/api/v1/media/community/sign-batch', { items: list }, {
      timeoutMs: opts?.timeoutMs || 5500,
      max429Retries: 1
    });
  }

  async function signCommunityMediaRef(ref, opts) {
    if (!isConfigured()) {
      return { ok: false, code: 'API_NOT_CONFIGURED', message: '未配置 API 地址' };
    }
    const normalized = window.SupabaseSync?.normalizeImageRef?.(ref) || ref;
    const q = encodeURIComponent(String(normalized || ''));
    const aid = opts?.authorId ? `&authorId=${encodeURIComponent(String(opts.authorId))}` : '';
    const cid = opts?.cardId ? `&cardId=${encodeURIComponent(String(opts.cardId))}` : '';
    const variant = opts?.variant === 'full' ? 'full' : 'grid';
    try {
      const res = await fetch(`${baseUrl()}/api/v1/media/community/sign?ref=${q}${aid}${cid}&variant=${variant}`);
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

  async function getGenerationImageUrl(jobId, opts = {}) {
    const variant = opts.variant === 'grid' ? 'grid' : 'full';
    return request(
      'GET',
      `/api/v1/media/generation/${encodeURIComponent(jobId)}/url?variant=${variant}`,
      null,
      { noRetry: true }
    );
  }

  async function fetchMediaAsBlobUrl(remoteUrl) {
    if (!isConfigured() || !remoteUrl) return null;
    try {
      let token = await getAccessToken();
      if (!token) {
        await recoverSessionForApi();
        token = await getAccessToken();
      }
      if (!token) return null;
      const q = encodeURIComponent(remoteUrl);
      let res = await fetch(`${baseUrl()}/api/v1/media/fetch?url=${q}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 401) {
        await recoverSessionForApi();
        token = await getAccessToken();
        if (token) {
          res = await fetch(`${baseUrl()}/api/v1/media/fetch?url=${q}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
        }
      }
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch (e) {
      return null;
    }
  }

  async function recoverWarehouseFromJobs(opts = {}) {
    return requestWithPrepare('POST', '/api/v1/generate/recover-warehouse', {
      max: opts.max,
      days: opts.days,
      hours: opts.hours,
      offset: opts.offset,
      providerScope: opts.providerScope,
      mode: opts.mode || 'import',
      jobIds: Array.isArray(opts.jobIds) ? opts.jobIds.filter(Boolean).slice(0, 10) : undefined
    }, { timeoutMs: Math.max(API_TIMEOUT_MS, 120000), lightPrepare: true });
  }

  async function postWarehouseThumbs(jobs) {
    const list = Array.isArray(jobs) ? jobs.filter((j) => j && j.jobId).slice(0, 8) : [];
    if (!list.length) return { ok: true, data: { thumbs: {} } };
    return requestWithPrepare('POST', '/api/v1/media/warehouse-thumbs', { jobs: list }, {
      timeoutMs: Math.max(API_TIMEOUT_MS, 90000),
      lightPrepare: true
    });
  }

  /** 卡片图上传 → Worker → R2（避免浏览器直连 Supabase/阿里云 Storage 流量费） */
  function uploadStorageBlob(path, blob, opts = {}) {
    return new Promise((resolve, reject) => {
      (async () => {
        if (!isConfigured()) {
          reject(new Error('未配置 API 地址'));
          return;
        }
        const cleanPath = String(path || '').replace(/^\//, '');
        if (!cleanPath) {
          reject(new Error('图片路径无效'));
          return;
        }
        const token = await getAccessToken();
        if (!token) {
          reject(new Error('未登录'));
          return;
        }
        const url = `${baseUrl()}/api/v1/media/upload?path=${encodeURIComponent(cleanPath)}`;
        const contentType =
          blob && blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('Content-Type', contentType);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable && typeof opts.onProgress === 'function') {
            opts.onProgress(ev.loaded / ev.total, ev.loaded, ev.total);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const parsed = JSON.parse(xhr.responseText || '{}');
              const ref = parsed?.data?.ref;
              if (ref) {
                resolve(ref);
                return;
              }
            } catch (e) { /* ignore */ }
            resolve(`storage://card-images/${cleanPath}`);
            return;
          }
          let errMsg = xhr.responseText || `HTTP ${xhr.status}`;
          try {
            const parsed = JSON.parse(xhr.responseText);
            errMsg = parsed?.error?.message || parsed?.message || errMsg;
          } catch (e) { /* ignore */ }
          reject(new Error(errMsg));
        };
        xhr.onerror = () => reject(new Error('网络错误，图片上传失败'));
        xhr.send(blob);
      })().catch(reject);
    });
  }

  /** 删卡/换图：force 时卡片库已确认，直接删 R2 */
  async function deleteOwnedCardImage(imageRef, opts = {}) {
    const ref = window.SupabaseSync?.normalizeImageRef?.(imageRef) || imageRef;
    if (!ref && !opts.force) return { ok: false, code: 'VALIDATION_ERROR', message: '无效图片引用' };
    return requestWithPrepare('POST', '/api/v1/media/delete-owned', {
      imageRef: ref || '',
      excludeCardId: opts.excludeCardId,
      allowGenerated: opts.allowGenerated === true,
      force: opts.force === true,
      genJobId: opts.genJobId
    }, { timeoutMs: opts.timeoutMs || 15000, lightPrepare: true });
  }

  if (isConfigured()) {
    void probeApiHealth();
  }

  window.PromptHubApi = {
    isApiUnreachable,
    isApiRateLimited,
    markApiRateLimited,
    markApiUnreachable,
    probeApiHealth,
    prepareApiCall,
    isConfigured,
    syncMe,
    reportStorageDelta,
    setDisplayName,
    redeem,
    claimFreeTrial,
    getMembershipTasks,
    syncMembershipTasks,
    claimMembershipTask,
    checkinMembershipTask,
    redeemInviteCode,
    setCreditGrantMode,
    createPaymentCheckout,
    getGenerationModels,
    projectGenerationModels,
    getGenerationCost,
    generateImage,
    mjAction,
    mjBlend,
    getGenerationJob,
    getGenerationJobByClientRequestId,
    getGenerationJobImageBlobUrl,
    studioChat,
    studioChatQuote,
    promptToolsOptimize,
    promptToolsReverse,
    promptToolsFission,
    promptToolsPurifyDescribe,
    promptToolsInfo,
    consumeInspirationDraw,
    listRecentGenerationJobs,
    listGenerationJobsHistory,
    listRecentGeneratedCreations,
    recoverWarehouseFromJobs,
    postWarehouseThumbs,
    getLedger,
    checkLikeMilestone,
    uploadStorageBlob,
    deleteOwnedCardImage,
    signMediaRef,
    signMediaRefsBatch,
    signCommunityMediaRef,
    signCommunityMediaRefsBatch,
    getCommunityFeed,
    publishCommunityPost,
    unpublishCommunityPost,
    syncCommunityPostsBatch,
    likeCommunityPost,
    pushCommunityNotify,
    fetchCommunityNotifications,
    getGenerationImageUrl,
    fetchMediaAsBlobUrl,
    listAssetPackages,
    getAssetPackageCovers,
    listMyOwnedAssetPackages,
    listMyPublishedAssetPackages,
    claimAssetPackage,
    publishAssetPackage,
    updateAssetPackage,
    getAssetPackageContent,
    getCommunityGachaQuota,
    consumeCommunityGachaDraw,
    importAssetPackage,
    getAssetPackageFolderImages,
    downloadAssetPackageJson
  };

  const initialPath = String(window.location?.pathname || '/').replace(/\/+$/, '') || '/';
  if (initialPath === '/generate' || initialPath === '/imagegen') {
    prefetchGenerationModels();
  }
})();

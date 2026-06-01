(function () {
  const PLACEHOLDER = /YOUR_/;
  const BUCKET = 'card-images';
  const STORAGE_PREFIX = `storage://${BUCKET}/`;
  const SIGNED_TTL_SEC = 604800;
  const signedUrlCache = new Map();
  /** 云端不存在的路径，避免每张图重复签名 400（拖慢首屏 30s～2min） */
  const missingPathCache = new Map();
  const imageUploadSkipUntil = new Map();
  const MISSING_PATH_TTL_MS = 20 * 60 * 1000;
  const IMAGE_UPLOAD_SKIP_MS = 24 * 60 * 60 * 1000;
  const SIGN_REQUEST_TIMEOUT_MS = 4500;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const MAX_SIDE = 1024;
  const JPEG_QUALITY = 0.78;
  /** 列表用 grid 缓存键；签名不再走 Storage transform（易 500） */
  const VARIANT_GRID = 'grid';
  const VARIANT_FULL = 'full';
  const USE_STORAGE_TRANSFORM = false;
  const GRID_SIGN_CONCURRENCY = 12;
  const WAREHOUSE_PREFETCH_CARD_CAP = 48;
  const WAREHOUSE_FAST_FIRST = 12;
  const SS_SIGN_CACHE = 'ph_signed_urls_v1';
  const signInflight = new Map();

  function loadSessionSignCache() {
    try {
      const raw = sessionStorage.getItem(SS_SIGN_CACHE);
      if (!raw) return;
      const data = JSON.parse(raw);
      const now = Date.now();
      for (const [key, entry] of Object.entries(data || {})) {
        if (entry?.url && entry.expiresAt > now + 60000) signedUrlCache.set(key, entry);
      }
    } catch (e) { /* ignore */ }
  }

  let persistSignCacheTimer = null;
  function persistSessionSignCache() {
    clearTimeout(persistSignCacheTimer);
    persistSignCacheTimer = setTimeout(() => {
      try {
        const now = Date.now();
        const data = {};
        signedUrlCache.forEach((entry, key) => {
          if (entry?.url && entry.expiresAt > now + 60000) data[key] = entry;
        });
        sessionStorage.setItem(SS_SIGN_CACHE, JSON.stringify(data));
      } catch (e) { /* ignore */ }
    }, 120);
  }

  loadSessionSignCache();

  function isCdnMediaUrl(url) {
    return typeof url === 'string' && /\/api\/v1\/media\/[ci]\//i.test(url);
  }

  function parseCdnUrlExpiry(url) {
    if (!isCdnMediaUrl(url)) return 0;
    try {
      if (/\/api\/v1\/media\/c\//i.test(url)) return Date.now() + SIGNED_TTL_SEC * 1000;
      const e = Number(new URL(url).searchParams.get('e') || 0);
      return e ? e * 1000 : Date.now() + SIGNED_TTL_SEC * 1000;
    } catch (e) {
      return Date.now() + SIGNED_TTL_SEC * 1000;
    }
  }

  function parseSignedUrlExpiry(url) {
    if (isCdnMediaUrl(url)) return parseCdnUrlExpiry(url);
    if (!url || typeof url !== 'string') return 0;
    try {
      const token = new URL(url).searchParams.get('token');
      if (!token) return 0;
      const parts = token.split('.');
      if (parts.length < 2) return 0;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return (payload.exp || 0) * 1000;
    } catch (e) {
      return 0;
    }
  }

  function isIncompleteSignedStorageUrl(url) {
    if (!url || typeof url !== 'string' || isCdnMediaUrl(url)) return false;
    if (!/\/storage\/v1\/object\/sign\//i.test(url)) return false;
    try {
      const token = new URL(url).searchParams.get('token');
      return !token || token.length < 8;
    } catch (e) {
      return true;
    }
  }

  function isValidSignedDisplayUrl(url) {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    if (isIncompleteSignedStorageUrl(url)) return false;
    const path = storagePathFromRef(url);
    if (!path) return true;
    return isFreshSignedDisplayUrl(url, 60000);
  }

  function isFreshSignedDisplayUrl(url, minRemainingMs = 120000) {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    if (isCdnMediaUrl(url)) {
      if (/\/api\/v1\/media\/c\//i.test(url)) return true;
      return parseCdnUrlExpiry(url) > Date.now() + minRemainingMs;
    }
    if (isIncompleteSignedStorageUrl(url)) return false;
    const path = storagePathFromRef(url);
    if (!path) return true;
    const exp = parseSignedUrlExpiry(url);
    if (exp) return exp > Date.now() + minRemainingMs;
    const cached = signedUrlCache.get(signedCacheKey(path.replace(/^\//, ''), VARIANT_GRID));
    return !!(cached?.url === url && cached.expiresAt > Date.now() + minRemainingMs);
  }

  function invalidateSignedCache(path) {
    const key = String(path || '').replace(/^\//, '').split('?')[0];
    if (!key) return;
    signedUrlCache.delete(signedCacheKey(key, VARIANT_GRID));
    signedUrlCache.delete(signedCacheKey(key, VARIANT_FULL));
  }

  function invalidateSignedCacheForRef(ref, assetId) {
    for (const p of listImagePathCandidates(normalizeImageRef(ref), assetId)) {
      invalidateSignedCache(p);
    }
    const fromUrl = storagePathFromRef(ref);
    if (fromUrl) invalidateSignedCache(fromUrl);
  }

  function isUsableLoadedImgSrc(src) {
    return !!(src && src.startsWith('http') && !src.includes('data:image/svg') && isValidSignedDisplayUrl(src));
  }

  function configured() {
    return !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY
      && !PLACEHOLDER.test(window.SUPABASE_URL)
      && !PLACEHOLDER.test(window.SUPABASE_ANON_KEY)
      && window.supabase?.createClient);
  }

  let client = null;
  let session = null;
  let onAuthChange = null;

  function getClient() {
    if (!configured()) return null;
    if (!client) {
      client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
    }
    return client;
  }

  function getUserId() {
    return session?.user?.id || null;
  }

  let ensureSessionPromise = null;
  let refreshSessionPromise = null;
  const REFRESH_AHEAD_SEC = 300;

  function tokenExpiresInSec(sess) {
    const exp = (sess || session)?.expires_at;
    if (exp == null) return -1;
    return exp - Math.floor(Date.now() / 1000);
  }

  function isAccessTokenFresh(sess, minRemainingSec = REFRESH_AHEAD_SEC) {
    const left = tokenExpiresInSec(sess);
    if (left < 0) return false;
    return left >= minRemainingSec;
  }

  const SESSION_OP_TIMEOUT_MS = 12000;

  function withSessionTimeout(promise, ms = SESSION_OP_TIMEOUT_MS) {
    return Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve('__ph_session_timeout__'), ms))
    ]);
  }

  async function refreshSessionOnce() {
    const sb = getClient();
    if (!sb) return null;
    if (refreshSessionPromise) return refreshSessionPromise;
    refreshSessionPromise = (async () => {
      try {
        const work = (async () => {
          const { data, error } = await sb.auth.refreshSession();
          if (error) throw error;
          if (data?.session?.access_token) {
            session = data.session;
            return session;
          }
          const { data: fresh } = await sb.auth.getSession();
          session = fresh?.session ?? null;
          return session;
        })();
        const result = await withSessionTimeout(work);
        if (result === '__ph_session_timeout__') {
          console.warn('[SupabaseSync] refreshSession timed out');
          return session?.access_token ? session : null;
        }
        return result;
      } catch (e) {
        console.warn('[SupabaseSync] refreshSession failed', e);
        return null;
      } finally {
        refreshSessionPromise = null;
      }
    })();
    return refreshSessionPromise;
  }

  async function healSessionOnResume() {
    if (!configured()) return false;
    const sb = getClient();
    if (!sb) return false;
    try {
      const { data } = await sb.auth.getSession();
      if (data?.session) session = data.session;
      if (!session?.user) return false;
      if (isAccessTokenFresh(session, 60)) return true;
      const refreshed = await refreshSessionOnce();
      return !!(refreshed?.access_token && isAccessTokenFresh(refreshed, 0));
    } catch (e) {
      console.warn('[SupabaseSync] healSessionOnResume', e);
      return false;
    }
  }

  async function ensureSession() {
    if (session?.access_token && isAccessTokenFresh(session, 60)) return session;
    if (ensureSessionPromise) return ensureSessionPromise;
    ensureSessionPromise = (async () => {
      const sb = getClient();
      if (!sb) throw new Error('Supabase 未配置');
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      session = data?.session ?? null;
      if (!session?.user) throw new Error('登录已过期，请重新登录');
      if (!isAccessTokenFresh(session, 60)) {
        const refreshed = await refreshSessionOnce();
        if (refreshed?.access_token) session = refreshed;
        else if (!isAccessTokenFresh(session, 0)) throw new Error('登录已过期，请重新登录');
      }
      return session;
    })();
    try {
      return await ensureSessionPromise;
    } finally {
      ensureSessionPromise = null;
    }
  }

  function isConfigured() { return configured(); }
  function isLoggedIn() { return !!session?.user; }
  function getSession() { return session; }

  /** 在 access_token 将过期时刷新，避免 UI 仍显示已登录但 API 返回「登录已过期」 */
  async function getValidAccessToken(opts = {}) {
    const force = opts.force === true;
    const sb = getClient();
    if (!sb) return null;
    if (!session?.access_token || force) {
      try {
        const { data } = await sb.auth.getSession();
        if (data?.session) session = data.session;
      } catch (e) { /* ignore */ }
    }
    if (!session?.access_token) return null;
    if (force || !isAccessTokenFresh(session)) {
      const refreshed = await refreshSessionOnce();
      if (refreshed?.access_token) session = refreshed;
      if (!isAccessTokenFresh(session, 0)) return null;
    }
    return session.access_token || null;
  }
  function getUserEmail() { return session?.user?.email || ''; }

  function isDataUrl(str) {
    return typeof str === 'string' && str.startsWith('data:image/');
  }

  function formatError(err) {
    if (!err) return '未知错误';
    if (typeof err === 'string') return err;
    const msg = String(err.message || err.error_description || err.msg || err.error || '').trim();
    if (/bucket not found/i.test(msg)) {
      return msg + '（请在 Supabase 运行 supabase/storage.sql）';
    }
    if (/relation.*user_data|user_data.*does not exist/i.test(msg)) {
      return msg + '（请在 Supabase 运行 supabase/schema.sql）';
    }
    if (/row-level security|violates.*policy|permission denied/i.test(msg)) {
      return msg + '（若已运行过 SQL，请再运行 supabase/fix-policies.sql 后退出并重新登录）';
    }
    if (msg) return msg;
    if (err.error && typeof err.error !== 'string') return formatError(err.error);
    try { return JSON.stringify(err); } catch (e) { return '同步失败'; }
  }

  function isStorageUrl(str) {
    return isStorageRef(str);
  }

  function isStorageRef(str) {
    if (!str || typeof str !== 'string') return false;
    if (str.startsWith(STORAGE_PREFIX)) return true;
    if (!window.SUPABASE_URL) return false;
    const base = window.SUPABASE_URL.replace(/\/$/, '');
    return (
      str.startsWith(`${base}/storage/v1/object/public/${BUCKET}/`) ||
      str.startsWith(`${base}/storage/v1/object/sign/${BUCKET}/`) ||
      str.startsWith(`${base}/storage/v1/object/authenticated/${BUCKET}/`)
    );
  }

  function storagePathFromUrl(url) {
    if (!url || typeof url !== 'string') return null;
    if (url.startsWith(STORAGE_PREFIX)) return url.slice(STORAGE_PREFIX.length).split('?')[0];
    const bare = url.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[^/?#]+\.(jpe?g|png|webp|gif)$/i.test(bare)) {
      return bare;
    }
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const p = u.pathname.replace(/^\//, '');
      if (
        (host === 'api.prompt-hub.cn' || host.endsWith('.prompt-hub.cn')) &&
        /^[^/]+\/.+\.(jpe?g|png|webp|gif)$/i.test(p)
      ) {
        return p;
      }
    } catch (e) { /* ignore */ }
    const markers = [
      `/storage/v1/object/public/${BUCKET}/`,
      `/storage/v1/object/sign/${BUCKET}/`,
      `/storage/v1/object/authenticated/${BUCKET}/`
    ];
    for (const marker of markers) {
      const i = url.indexOf(marker);
      if (i !== -1) return url.slice(i + marker.length).split('?')[0];
    }
    return null;
  }

  function storagePathFromRef(value) {
    return storagePathFromUrl(value);
  }

  function toStorageRef(path) {
    return STORAGE_PREFIX + path.replace(/^\//, '');
  }

  function publicUrlFromPath(path) {
    if (!path || !window.SUPABASE_URL) return null;
    const base = window.SUPABASE_URL.replace(/\/$/, '');
    return `${base}/storage/v1/object/public/${BUCKET}/${path.replace(/^\//, '')}`;
  }

  function isResolvableStorageRef(value) {
    return !!value && typeof value === 'string' && value.startsWith(STORAGE_PREFIX);
  }

  function normalizeImageRef(value) {
    if (!value || typeof value !== 'string') return value;
    const path = storagePathFromRef(value);
    if (path) return toStorageRef(path);
    const bare = value.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[^/?#]+\.(jpe?g|png|webp|gif)$/i.test(bare)) {
      return toStorageRef(bare);
    }
    if (/^https?:\/\//i.test(bare) && isInvalidMediaUrl(bare)) {
      try {
        const p = new URL(bare).pathname.replace(/^\//, '');
        if (/^[^/]+\/.+\.(jpe?g|png|webp|gif)$/i.test(p)) return toStorageRef(p);
      } catch (e) { /* ignore */ }
    }
    return value;
  }

  function clearSignedUrlCache() {
    signedUrlCache.clear();
    missingPathCache.clear();
    imageUploadSkipUntil.clear();
  }

  try {
    if (localStorage.getItem('promptrepo_sign_v') !== '5') {
      clearSignedUrlCache();
      localStorage.setItem('promptrepo_sign_v', '5');
    }
  } catch (e) { /* ignore */ }

  function shouldSkipImageUploadAttempt(cardId) {
    if (!cardId) return false;
    const until = imageUploadSkipUntil.get(String(cardId));
    if (!until) return false;
    if (until > Date.now()) return true;
    imageUploadSkipUntil.delete(String(cardId));
    return false;
  }

  function markImageUploadSkip(cardId) {
    if (cardId) imageUploadSkipUntil.set(String(cardId), Date.now() + IMAGE_UPLOAD_SKIP_MS);
  }

  function cardNeedsCloudImageUpload(card) {
    if (!card?.id || !card.image) return false;
    if (isDataUrl(card.image) || (typeof card.image === 'string' && card.image.startsWith('blob:'))) {
      return true;
    }
    if (!isStorageRef(card.image)) return false;
    const primary = primaryImagePath(card.image, card.id);
    return !!(primary && isPathKnownMissing(primary));
  }

  function normalizePathKey(path) {
    return String(path || '').replace(/^\//, '').split('@')[0];
  }

  function isPathKnownMissing(path) {
    const key = normalizePathKey(path);
    if (!key) return false;
    const exp = missingPathCache.get(key);
    if (!exp) return false;
    if (exp > Date.now()) return true;
    missingPathCache.delete(key);
    return false;
  }

  function markPathMissing(path) {
    const key = normalizePathKey(path);
    if (key) missingPathCache.set(key, Date.now() + MISSING_PATH_TTL_MS);
  }

  function isStorageNotFoundError(e) {
    const msg = String(e?.message || e?.error || e?.error_description || '').toLowerCase();
    const code = e?.statusCode ?? e?.status;
    return code === 404 || code === 400 || /not found|object not found|does not exist/.test(msg);
  }

  function isInvalidMediaUrl(url) {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const path = u.pathname || '/';
      if (host === 'api.prompt-hub.cn' && !path.startsWith('/api/')) return true;
      if ((host === 'prompt-hub.cn' || host === 'www.prompt-hub.cn') && /\.(jpe?g|png|webp|gif)$/i.test(path)) {
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function primaryImagePath(image, assetId) {
    const fromRef = storagePathFromRef(image);
    if (fromRef) return fromRef.replace(/^\//, '');
    const canonical = cardImageStoragePath(assetId);
    return canonical ? canonical.replace(/^\//, '') : null;
  }

  function signedCacheKey(path, variant) {
    const p = String(path || '').replace(/^\//, '');
    return variant === VARIANT_FULL ? p : `${p}@g640`;
  }

  function displayVariantFromOpts(opts) {
    if (!opts || typeof opts !== 'object') return VARIANT_GRID;
    return opts.variant === VARIANT_FULL ? VARIANT_FULL : VARIANT_GRID;
  }

  async function getSignedUrlForPath(path, opts) {
    if (window.PromptHubApi?.isConfigured?.() && !window.PromptHubApi?.isApiUnreachable?.()) {
      return null;
    }
    const variant = displayVariantFromOpts(opts);
    const fileKey = path.replace(/^\//, '');
    if (isPathKnownMissing(fileKey)) return null;
    const cacheKey = signedCacheKey(fileKey, variant);
    const cached = signedUrlCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 120000) return cached.url;
    await ensureSession();
    const sb = getClient();
    const signOpts =
      USE_STORAGE_TRANSFORM && variant !== VARIANT_FULL
        ? { transform: { width: 640, quality: 78, resize: 'contain' } }
        : undefined;
    try {
      const signWork = sb.storage.from(BUCKET).createSignedUrl(fileKey, SIGNED_TTL_SEC, signOpts);
      const { data, error } = await Promise.race([
        signWork,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('sign_timeout')), SIGN_REQUEST_TIMEOUT_MS);
        })
      ]);
      if (error) throw error;
      if (!data?.signedUrl || isIncompleteSignedStorageUrl(data.signedUrl)) {
        throw new Error('invalid_signed_url');
      }
      signedUrlCache.set(cacheKey, {
        url: data.signedUrl,
        expiresAt: Date.now() + (SIGNED_TTL_SEC - 120) * 1000
      });
      return data.signedUrl;
    } catch (e) {
      if (isStorageNotFoundError(e)) {
        markPathMissing(fileKey);
        return null;
      }
      if (variant === VARIANT_GRID) {
        return getSignedUrlForPath(path, { variant: VARIANT_FULL });
      }
      throw e;
    }
  }

  function cardImageStoragePath(cardId, ownerId) {
    const uid = ownerId || getUserId();
    if (!uid || !cardId) return null;
    const base = String(cardId).replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${uid}/${base}.jpg`;
  }

  function listImagePathCandidates(image, assetId, ownerId) {
    const paths = [];
    const add = (p) => {
      const key = (p || '').replace(/^\//, '');
      if (key && !paths.includes(key)) paths.push(key);
    };
    add(storagePathFromRef(image));
    const canonical = cardImageStoragePath(assetId, ownerId);
    if (canonical) add(canonical);
    const uid = ownerId || getUserId();
    if (uid && assetId) {
      const base = String(assetId).replace(/[^a-zA-Z0-9_-]/g, '_');
      add(`${uid}/${base}.jpg`);
      add(`${uid}/${assetId}.jpg`);
      add(`${uid}/${base}.webp`);
      add(`${uid}/${base}.png`);
      const stripped = String(assetId).replace(/^wh_/, '');
      if (stripped !== String(assetId)) add(`${uid}/${stripped}.jpg`);
    }
    return paths;
  }

  async function signPathViaCommunityApi(path, variant, signOpts = {}) {
    if (!window.PromptHubApi?.isConfigured?.() || !window.PromptHubApi.signCommunityMediaRef) return null;
    const fileKey = String(path || '').replace(/^\//, '');
    if (isPathKnownMissing(fileKey)) return null;
    const v = variant || VARIANT_GRID;
    const inflightKey = `community:${fileKey}:${v}:${signOpts.authorId || ''}:${signOpts.cardId || ''}`;
    if (signInflight.has(inflightKey)) return signInflight.get(inflightKey);
    const task = (async () => {
      try {
        const r = await window.PromptHubApi.signCommunityMediaRef(toStorageRef(path), {
          variant: v,
          authorId: signOpts.authorId,
          cardId: signOpts.cardId
        });
        if (r.ok && r.data?.url && !isIncompleteSignedStorageUrl(r.data.url)) {
          const ttlSec = Math.max(3600, Number(r.data.expiresIn) || SIGNED_TTL_SEC) - 120;
          signedUrlCache.set(signedCacheKey(fileKey, v), {
            url: r.data.url,
            expiresAt: Date.now() + ttlSec * 1000
          });
          return r.data.url;
        }
        if (r?.status === 404 || r?.code === 'NOT_FOUND') {
          markPathMissing(fileKey);
        }
      } catch (e) {
        console.warn('[SupabaseSync] community api sign failed', path, e);
      }
      return null;
    })();
    signInflight.set(inflightKey, task);
    try {
      return await task;
    } finally {
      signInflight.delete(inflightKey);
    }
  }

  function apiSignAllowed(opts) {
    if (window.PromptHubApi?.isApiUnreachable?.()) return false;
    if (isLoggedIn() && !isCommunityFeedOpts(opts)) {
      return !!(window.PromptHubApi?.isConfigured?.() && window.PromptHubApi.signMediaRef);
    }
    return !!(window.PromptHubApi?.isConfigured?.() && window.PromptHubApi.signMediaRef);
  }

  async function signPathViaApi(path, variant, opts) {
    if (!apiSignAllowed(opts)) return null;
    const fileKey = String(path || '').replace(/^\//, '');
    const v = variant || VARIANT_GRID;
    const inflightKey = `api:${fileKey}:${v}`;
    if (signInflight.has(inflightKey)) return signInflight.get(inflightKey);
    const task = (async () => {
      try {
        const r = await window.PromptHubApi.signMediaRef(toStorageRef(path), { variant: v });
        if (r.ok && r.data?.url && !isIncompleteSignedStorageUrl(r.data.url)) {
          const ttlSec = Math.max(3600, Number(r.data.expiresIn) || SIGNED_TTL_SEC) - 120;
          signedUrlCache.set(signedCacheKey(fileKey, v), {
            url: r.data.url,
            expiresAt: Date.now() + ttlSec * 1000
          });
          return r.data.url;
        }
      } catch (e) {
        console.warn('[SupabaseSync] api sign failed', path, e);
      }
      return null;
    })();
    signInflight.set(inflightKey, task);
    try {
      return await task;
    } finally {
      signInflight.delete(inflightKey);
    }
  }

  function storagePathOwnedByCurrentUser(path) {
    const uid = getUserId();
    const key = String(path || '').replace(/^\//, '');
    if (!uid || !key) return false;
    return key.startsWith(`${uid}/`);
  }

  function cacheSignedPath(path, url, variant) {
    if (!path || !url) return;
    const fileKey = String(path).replace(/^\//, '');
    const v = variant || VARIANT_GRID;
    signedUrlCache.set(signedCacheKey(fileKey, v), {
      url,
      expiresAt: Date.now() + (SIGNED_TTL_SEC - 120) * 1000
    });
  }

  async function batchSignPaths(paths, variant) {
    const v = variant || VARIANT_GRID;
    const pending = [...new Set((paths || []).map((p) => String(p || '').replace(/^\//, '')).filter(Boolean))].filter((p) => {
      if (isPathKnownMissing(p)) return false;
      const cached = signedUrlCache.get(signedCacheKey(p, v));
      return !(cached?.url && cached.expiresAt > Date.now() + 120000);
    });
    if (!pending.length) return 0;
    if (!apiSignAllowed({}) || !window.PromptHubApi?.signMediaRefsBatch) return 0;
    await ensureSession();
    try {
      const refs = pending.map((p) => toStorageRef(p));
      const r = await window.PromptHubApi.signMediaRefsBatch(refs, { timeoutMs: 4200 });
      if (!r?.ok || !r.data?.urls) return 0;
      let n = 0;
      for (const [path, url] of Object.entries(r.data.urls)) {
        if (!url || isIncompleteSignedStorageUrl(url)) continue;
        cacheSignedPath(path, url, v);
        n += 1;
      }
      if (n) persistSessionSignCache();
      return n;
    } catch (e) {
      console.warn('[SupabaseSync] batch sign failed', e);
      return 0;
    }
  }

  async function resolvePathToUrl(path, variant, opts) {
    const fileKey = String(path || '').replace(/^\//, '');
    if (isPathKnownMissing(fileKey)) return null;
    const v = variant || VARIANT_GRID;
    const communityFeed = opts?.communityFeed === true;
    const signMeta = {
      authorId: opts?.authorId,
      cardId: opts?.cardId
    };
    if (communityFeed) {
      const publicUrl = await signPathViaCommunityApi(path, v, signMeta);
      if (publicUrl) return publicUrl;
      if (!isLoggedIn()) return null;
      if (!storagePathOwnedByCurrentUser(path)) return null;
    }
    if (isLoggedIn() && storagePathOwnedByCurrentUser(path)) {
      if (apiSignAllowed(opts)) {
        const apiUrl = await signPathViaApi(path, v, opts);
        if (apiUrl) return apiUrl;
      }
      try {
        const ownUrl = await getSignedUrlForPath(path, { variant: v });
        if (ownUrl) return ownUrl;
      } catch (e) {
        if (!isStorageNotFoundError(e) && String(e?.message || e) !== 'sign_timeout') {
          console.warn('[SupabaseSync] own signed url failed', path, e);
        }
      }
    }
    try {
      const url = await getSignedUrlForPath(path, { variant: v });
      if (url) return url;
      if (isPathKnownMissing(fileKey)) return null;
    } catch (e) {
      if (!isStorageNotFoundError(e)) {
        console.warn('[SupabaseSync] signed url failed', path, e);
      }
    }
    if (isPathKnownMissing(fileKey)) return null;
    if (!apiSignAllowed(opts)) return null;
    return signPathViaApi(path, v, opts);
  }

  async function verifyImageUrl(url) {
    if (!url || url.startsWith('data:image/svg')) return false;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 0);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  async function findCardImageInStorage(cardId) {
    if (!isLoggedIn() || !cardId) return null;
    await ensureSession();
    const uid = getUserId();
    const sb = getClient();
    if (!sb || !uid) return null;
    const cid = String(cardId).replace(/^wh_/, '');
    try {
      const { data, error } = await sb.storage.from(BUCKET).list(uid, {
        limit: 200,
        sortBy: { column: 'name', order: 'asc' }
      });
      if (error || !data?.length) return null;
      const matches = data.filter((f) => {
        const name = f?.name || '';
        return name === `${cid}.jpg` || name.startsWith(`${cid}.`) || name.includes(cid);
      });
      for (const file of matches) {
        const path = `${uid}/${file.name}`;
        const ref = toStorageRef(path);
        const url = await resolveDisplayUrl(ref, { assetId: cardId });
        if (url && await verifyImageUrl(url)) return ref;
      }
    } catch (e) {
      console.warn('[SupabaseSync] list storage failed', e);
    }
    return null;
  }

  async function repairCardImageIfMissing(cardId, currentRef) {
    const found = await findCardImageInStorage(cardId);
    if (found && found !== currentRef) return found;
    if (currentRef) {
      const url = await resolveDisplayUrl(currentRef, { assetId: cardId });
      if (url && await verifyImageUrl(url)) return normalizeImageRef(currentRef);
    }
    return null;
  }

  function isCommunityFeedOpts(opts) {
    return !!(opts && typeof opts === 'object' && opts.communityFeed === true);
  }

  async function resolveDisplayUrl(image, opts) {
    if (!image || typeof image !== 'string') return image;
    if (isDataUrl(image) || image.startsWith('blob:')) return image;
    const o = opts && typeof opts === 'object' ? opts : {};
    const assetId = o.assetId;
    const authorId = o.authorId;
    const variant = displayVariantFromOpts(opts);
    const communityFeed = isCommunityFeedOpts(opts);
    const normalized = normalizeImageRef(image);
    const bucketPath = storagePathFromRef(normalized);
    if (bucketPath && (isLoggedIn() || communityFeed)) {
      const primary = primaryImagePath(normalized, assetId);
      const fromRef = bucketPath.replace(/^\//, '');
      const all = listImagePathCandidates(normalized, assetId, authorId).filter(
        (p) => !isPathKnownMissing(p)
      );
      let candidates;
      if (o.tryAllPaths === true) {
        candidates = all;
      } else if (fromRef) {
        candidates = assetId && all.length ? all : [fromRef];
      } else if (primary) {
        candidates = [primary];
      } else if (communityFeed) {
        candidates = all.slice(0, 2);
      } else {
        candidates = all.slice(0, 1);
      }
      for (const path of candidates) {
        const cached = signedUrlCache.get(signedCacheKey(path.replace(/^\//, ''), variant));
        if (cached?.url && cached.expiresAt > Date.now() + 120000) return cached.url;
      }
      for (const path of candidates) {
        const url = await resolvePathToUrl(path, variant, {
          communityFeed,
          authorId,
          cardId: assetId
        });
        if (url) return url;
      }
      return null;
    }
    if (/^https?:\/\//i.test(image)) {
      if (isInvalidMediaUrl(image)) return null;
      const legacyPath = storagePathFromRef(image);
      if (legacyPath) {
        const uid = getUserId();
        const own = !!(uid && legacyPath.replace(/^\//, '').startsWith(`${uid}/`));
        const useCommunity = communityFeed || (isLoggedIn() && !own);
        return resolveDisplayUrl(toStorageRef(legacyPath), {
          assetId,
          authorId,
          cardId: o.cardId || assetId,
          communityFeed: useCommunity,
          tryAllPaths: useCommunity || o.tryAllPaths === true
        });
      }
      if (window.PromptHubApi?.fetchMediaAsBlobUrl) {
        const blobUrl = await window.PromptHubApi.fetchMediaAsBlobUrl(image);
        if (blobUrl) return blobUrl;
      }
      return null;
    }
    return image;
  }

  function communityPrefetchPaths(imagesOrPosts) {
    const paths = new Set();
    const list = Array.isArray(imagesOrPosts)
      ? imagesOrPosts
      : imagesOrPosts == null
        ? []
        : typeof imagesOrPosts === 'string'
          ? [imagesOrPosts]
          : [imagesOrPosts];
    for (const item of list) {
      if (typeof item === 'string') {
        const p = storagePathFromRef(item);
        if (p) paths.add(p.replace(/^\//, ''));
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const ref = item.image;
      if (ref) {
        if (isInvalidMediaUrl(ref)) continue;
        const p = storagePathFromRef(ref);
        if (p) {
          paths.add(p.replace(/^\//, ''));
          continue;
        }
      }
      const authorId = item.authorId && String(item.authorId) !== 'guest' ? String(item.authorId) : '';
      const cardId = item.sourceCardId ? String(item.sourceCardId) : '';
      if (authorId && cardId) {
        const base = String(cardId).replace(/[^a-zA-Z0-9_-]/g, '_');
        const primary = `${authorId}/${base}.jpg`;
        if (!isPathKnownMissing(primary)) paths.add(primary);
      }
    }
    return [...paths];
  }

  async function prefetchCommunityDisplayUrls(images, capMs) {
    if (!window.PromptHubApi?.signCommunityMediaRef) return;
    const items = (images || []).slice(0, 36);
    if (!items.length) return;
    const limit = Math.max(800, Number(capMs) || 4000);
    const started = Date.now();
    let i = 0;
    const concurrency = 8;
    async function signItem(item) {
      const authorId = item && typeof item === 'object' ? item.authorId : '';
      const cardId = item && typeof item === 'object' ? (item.sourceCardId || item.id) : '';
      const paths = communityPrefetchPaths(item).slice(0, 3);
      for (const path of paths) {
        if (Date.now() - started >= limit) return;
        const key = path.replace(/^\//, '');
        if (signedUrlCache.get(signedCacheKey(key, VARIANT_GRID))?.expiresAt > Date.now() + 120000) continue;
        await signPathViaCommunityApi(path, VARIANT_GRID, { authorId, cardId });
      }
    }
    async function worker() {
      while (i < items.length && Date.now() - started < limit) {
        await signItem(items[i++]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  }

  async function prefetchDisplayUrls(images) {
    if (!isLoggedIn()) return;
    const paths = [...new Set(
      (images || []).map(storagePathFromRef).filter(Boolean).map(p => p.replace(/^\//, ''))
    )];
    if (!paths.length) return;
    const pending = paths.filter(p => {
      if (isPathKnownMissing(p)) return false;
      const cached = signedUrlCache.get(signedCacheKey(p, VARIANT_GRID));
      return !(cached && cached.expiresAt > Date.now() + 120000);
    });
    if (!pending.length) return;
    await ensureSession();
    await batchSignPaths(pending, VARIANT_GRID);
    const still = pending.filter((p) => {
      const cached = signedUrlCache.get(signedCacheKey(p, VARIANT_GRID));
      return !(cached?.url && cached.expiresAt > Date.now() + 120000);
    });
    if (!still.length) return;
    for (let i = 0; i < still.length; i += GRID_SIGN_CONCURRENCY) {
      const batch = still.slice(i, i + GRID_SIGN_CONCURRENCY);
      await Promise.all(
        batch.map(async (p) => {
          if (apiSignAllowed({})) {
            const url = await signPathViaApi(p, VARIANT_GRID, {});
            if (url) return;
          }
          await getSignedUrlForPath(p, { variant: VARIANT_GRID }).catch(() => {});
        })
      );
    }
  }

  function getCachedDisplayUrl(image, assetIdOrOpts) {
    if (!image || typeof image !== 'string') return image;
    if (isDataUrl(image) || image.startsWith('blob:')) return image;
    const opts = typeof assetIdOrOpts === 'object' ? assetIdOrOpts : { assetId: assetIdOrOpts };
    const assetId = opts?.assetId;
    const variant = displayVariantFromOpts(opts);
    if (isLoggedIn() && (storagePathFromRef(image) || assetId)) {
      const primary = primaryImagePath(image, assetId);
      if (primary) {
        const hit = signedUrlCache.get(signedCacheKey(primary.replace(/^\//, ''), variant));
        if (hit?.url && hit.expiresAt > Date.now() + 120000) return hit.url;
      }
      for (const path of listImagePathCandidates(image, assetId)) {
        const cached = signedUrlCache.get(signedCacheKey(path.replace(/^\//, ''), variant));
        if (cached?.url && cached.expiresAt > Date.now() + 120000) return cached.url;
      }
    }
    const path = storagePathFromRef(image);
    if (!path) {
      if (/^https?:\/\//i.test(image) && isValidSignedDisplayUrl(image)) return image;
      return '';
    }
    const cached = signedUrlCache.get(signedCacheKey(path.replace(/^\//, ''), variant));
    if (cached?.url && cached.expiresAt > Date.now() + 120000 && !isIncompleteSignedStorageUrl(cached.url)) {
      return cached.url;
    }
    if (/^https?:\/\//i.test(image) && isValidSignedDisplayUrl(image)) return image;
    return '';
  }

  /** 按卡片 id 收集 canonical 路径，一次 batch 签完（避免列表每张图多次试探） */
  async function prefetchCardsImages(cards, capMs) {
    if (!isLoggedIn()) return;
    const pathSet = new Set();
    const list = (cards || []).slice(0, WAREHOUSE_PREFETCH_CARD_CAP);
    for (const c of list) {
      if (!c?.image) continue;
      const p = primaryImagePath(c.image, c.id);
      if (p && !isPathKnownMissing(p)) pathSet.add(p);
    }
    if (!pathSet.size) return;
    const refs = [...pathSet].map((p) => toStorageRef(p));
    const limit = capMs != null ? Math.min(Math.max(800, capMs), 8000) : 2800;
    await prefetchDisplayUrlsWithCap(refs, limit);
  }

  /** 卡片库首屏：先签可见 12 张（≈2s），其余后台签 */
  async function prefetchWarehousePage(cards, capMs) {
    if (!isLoggedIn()) return;
    const list = (cards || []).slice(0, 24);
    if (!list.length) return;
    const budget = capMs == null ? 2200 : Math.min(capMs, 2800);
    const first = list.slice(0, WAREHOUSE_FAST_FIRST);
    const rest = list.slice(WAREHOUSE_FAST_FIRST);
    await prefetchCardsImages(first, budget);
    if (rest.length) void prefetchCardsImages(rest, 6000);
  }

  function patchWarehouseImagesFromCache(container, opts) {
    patchImageSrcFromCache(container, opts);
  }

  function imgPlaceholderSrc() {
    return 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect fill="#18181c" width="4" height="3"/></svg>'
    );
  }

  function isPlaceholderImgSrc(src) {
    return !src || (typeof src === 'string' && src.includes('data:image/svg'));
  }

  function isResolvableDisplayUrl(url) {
    return !!(
      url &&
      typeof url === 'string' &&
      !url.startsWith(STORAGE_PREFIX) &&
      !isPlaceholderImgSrc(url) &&
      !isIncompleteSignedStorageUrl(url)
    );
  }

  function setCardMediaLoadState(media, state) {
    if (!media) return;
    media.classList.remove('card-media--missing', 'card-media--load-failed');
    if (state === 'loading') {
      media.classList.add('is-loading');
      return;
    }
    media.classList.remove('is-loading');
    if (state === 'failed') {
      if (media.closest('#communityGrid, #creationsGrid, #userProfileGrid')) {
        media.remove();
        return;
      }
      media.classList.add('card-media--load-failed');
    }
  }

  function safeImgSrc(image) {
    if (!image) return '';
    if (isDataUrl(image) || image.startsWith('blob:')) return image;
    if (/^https?:\/\//i.test(image)) {
      if (isInvalidMediaUrl(image) || isIncompleteSignedStorageUrl(image)) return imgPlaceholderSrc();
      const path = storagePathFromRef(image);
      if (path) {
        const cached = getCachedDisplayUrl(toStorageRef(path));
        if (cached && !cached.startsWith(STORAGE_PREFIX)) return cached;
        return imgPlaceholderSrc();
      }
      return image;
    }
    if (isStorageRef(image)) {
      const cached = getCachedDisplayUrl(image);
      if (cached && !cached.startsWith(STORAGE_PREFIX)) return cached;
      return imgPlaceholderSrc();
    }
    return image;
  }

  function patchImageSrcFromCache(root, opts) {
    const scope = root || document;
    let imgs = [...scope.querySelectorAll('img[data-image-ref], img[data-storage-ref]')];
    if (opts?.visibleFirst) {
      imgs.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const aVis = ar.top < window.innerHeight + 120 && ar.bottom > -80;
        const bVis = br.top < window.innerHeight + 120 && br.bottom > -80;
        if (aVis !== bVis) return aVis ? -1 : 1;
        return ar.top - br.top;
      });
      if (opts.max > 0) imgs = imgs.slice(0, opts.max);
    }
    imgs.forEach((img) => {
      const ref = img.getAttribute('data-image-ref') || img.getAttribute('data-storage-ref');
      if (!ref) return;
      const cur = img.currentSrc || img.src || '';
      if (isUsableLoadedImgSrc(cur)) return;
      const assetId = img.closest('.card[data-source-card-id]')?.dataset?.sourceCardId
        || img.closest('.card[data-id]')?.dataset?.id
        || img.closest('.card[data-post-id]')?.dataset?.postId
        || undefined;
      const url = getCachedDisplayUrl(ref, { assetId, variant: VARIANT_GRID });
      if (url && /^https?:\/\//i.test(url) && isValidSignedDisplayUrl(url)) {
        const media = img.closest('.card-media, .imagegen-feed-media');
        media?.classList.remove('card-media--await');
        const alreadyVisible = img.complete && img.naturalWidth > 8 && isUsableLoadedImgSrc(cur);
        if (media && !alreadyVisible) {
          if (!media.dataset.shineAt) media.dataset.shineAt = String(Date.now());
          if (!media.classList.contains('is-loading')) media.classList.add('is-loading');
        }
        const done = () => {
          if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(media);
          else media?.classList.remove('is-loading');
        };
        if (img.complete && img.naturalWidth > 0 && img.src === url) done();
        else {
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          img.src = url;
        }
      }
    });
  }

  async function prefetchDisplayUrlsWithCap(images, capMs) {
    const limit = Math.max(800, Number(capMs) || 5000);
    await Promise.race([
      prefetchDisplayUrls(images),
      new Promise((r) => setTimeout(r, limit))
    ]);
  }

  async function hydrateImageElements(root, opts) {
    const onlyMissing = opts?.onlyMissing === true;
    const scope = root || document;
    const imgs = [...scope.querySelectorAll('img[data-storage-ref], img[data-image-ref]')];
    imgs.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const aVis = ar.top < window.innerHeight && ar.bottom > 0;
      const bVis = br.top < window.innerHeight && br.bottom > 0;
      if (aVis !== bVis) return aVis ? -1 : 1;
      return ar.top - br.top;
    });
    const concurrency = window.matchMedia('(max-width: 900px)').matches ? 5 : 8;
    let idx = 0;
    async function hydrateOne(img) {
      const ref = img.getAttribute('data-storage-ref') || img.getAttribute('data-image-ref');
      if (!ref) return;
      const media = img.closest('.card-media, .imagegen-feed-media');
      if (media?.classList.contains('imagegen-gen-pending')) return;
      const cur = img.currentSrc || img.src || '';
      if (onlyMissing && isUsableLoadedImgSrc(cur)) {
        media?.classList.remove('is-loading');
        return;
      }
      const inFeed = !!img.closest('#communityGrid, #creationsGrid, #userProfileGrid');
      const authorId = img.dataset?.authorId
        || img.closest('.card')?.dataset?.authorId
        || '';
      const refPath = storagePathFromRef(ref) || '';
      const uid = getUserId();
      const ownFeedPath = !!(refPath && uid && refPath.replace(/^\//, '').startsWith(`${uid}/`));
      const inSide = !!img.closest('#communitySideBody, #creationsSideBody, .community-side-img-btn');
      const communityFeed = (inFeed && (!isLoggedIn() || !ownFeedPath)) || inSide;
      const assetId = img.dataset?.sourceCardId
        || img.closest('.card[data-source-card-id]')?.dataset?.sourceCardId
        || img.closest('.card[data-id]')?.dataset?.id
        || img.closest('.card[data-post-id]')?.dataset?.postId
        || img.closest('.card[data-creation-id]')?.dataset?.creationId
        || img.closest('[data-feed-id]')?.dataset?.feedId?.replace(/^wh_/, '')
        || undefined;
      const resolveOpts = {
        assetId,
        authorId: authorId || undefined,
        cardId: assetId,
        variant: VARIANT_GRID,
        communityFeed,
        tryAllPaths: communityFeed
      };
      const cached = communityFeed ? '' : getCachedDisplayUrl(ref, { assetId, variant: VARIANT_GRID });
      if (cached && isResolvableDisplayUrl(cached)) {
        const mediaWrapCached = media || img.closest('.community-side-img-btn');
        if (cur !== cached) {
          if (mediaWrapCached && !mediaWrapCached.dataset.shineAt) {
            mediaWrapCached.dataset.shineAt = String(Date.now());
          }
          setCardMediaLoadState(mediaWrapCached, 'loading');
          img.src = cached;
          if (img.complete && img.naturalWidth > 0) {
            if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(mediaWrapCached);
            else mediaWrapCached?.classList.remove('is-loading');
          }
        } else if (!isPlaceholderImgSrc(cur)) {
          mediaWrapCached?.classList.remove('is-loading');
        }
        return;
      }
      const mediaWrap = media || img.closest('.community-side-img-btn');
      if (mediaWrap) {
        if (!mediaWrap.dataset.shineAt) mediaWrap.dataset.shineAt = String(Date.now());
        setCardMediaLoadState(mediaWrap, 'loading');
      }
      if (!img.getAttribute('src') || isPlaceholderImgSrc(img.getAttribute('src'))) {
        img.src = imgPlaceholderSrc();
      }
      const endShine = () => {
        if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(mediaWrap);
        else mediaWrap?.classList.remove('is-loading');
      };
      try {
        let url = await resolveDisplayUrl(ref, resolveOpts);
        if (!isResolvableDisplayUrl(url) && assetId && typeof window.getCardImageBackup === 'function') {
          const backup = await window.getCardImageBackup(assetId);
          if (backup && (isDataUrl(backup) || backup.startsWith('blob:'))) url = backup;
        }
        if (!isResolvableDisplayUrl(url) && communityFeed && assetId && typeof window.getCardImageBackup === 'function') {
          const backup = await window.getCardImageBackup(assetId);
          if (backup && (isDataUrl(backup) || backup.startsWith('blob:'))) url = backup;
        }
        if (isResolvableDisplayUrl(url)) {
          const onFail = () => {
            if (media?.classList.contains('is-loading')) return;
            img.src = imgPlaceholderSrc();
            img.classList.remove('img-load-failed');
            setCardMediaLoadState(media, 'failed');
            endShine();
          };
          if (img.complete && img.src === url && img.naturalWidth > 0) endShine();
          else {
            img.addEventListener('load', () => {
              setCardMediaLoadState(media, 'loading');
              media?.classList.remove('card-media--load-failed');
              endShine();
            }, { once: true });
            img.addEventListener('error', onFail, { once: true });
            img.src = url;
          }
          img.classList.remove('img-load-failed');
          if (img.complete && img.naturalWidth > 0) endShine();
        } else if (!isPlaceholderImgSrc(cur) && cur.startsWith('http')) {
          endShine();
        } else {
          setCardMediaLoadState(media, 'loading');
        }
      } catch (e) {
        console.warn('[SupabaseSync] hydrate failed', ref, e);
        setCardMediaLoadState(media, 'loading');
      }
      if (!img.dataset.hydrateBound) {
        img.dataset.hydrateBound = '1';
        img.addEventListener('error', () => {
          if (media?.classList.contains('is-loading')) return;
          if (img.dataset.retryHydrate === '1') {
            setCardMediaLoadState(media, 'failed');
            return;
          }
          img.dataset.retryHydrate = '1';
          invalidateSignedCacheForRef(ref, assetId);
          setCardMediaLoadState(media, 'loading');
          void resolveDisplayUrl(ref, { ...resolveOpts, tryAllPaths: true }).then((url) => {
            if (isResolvableDisplayUrl(url)) {
              img.src = url;
              img.classList.remove('img-load-failed');
              media?.classList.remove('card-media--load-failed');
            } else {
              setCardMediaLoadState(media, 'failed');
            }
          });
        });
      }
    }
    async function worker() {
      while (idx < imgs.length) {
        const i = idx++;
        await hydrateOne(imgs[i]);
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, imgs.length) }, () => worker());
    await Promise.all(workers);
  }

  async function verifyStorageRef(ref, assetId, opts = {}) {
    if (!ref || !isStorageRef(ref)) return false;
    const attempts = opts.quick ? 1 : 2;
    const all = listImagePathCandidates(normalizeImageRef(ref), assetId);
    const candidates = (opts.quick ? [primaryImagePath(ref, assetId)].filter(Boolean) : all)
      .filter((p) => !isPathKnownMissing(p));
    for (let round = 0; round < attempts; round++) {
      for (const path of candidates) {
        try {
          const url = await resolvePathToUrl(path.replace(/^\//, ''));
          if (url && await verifyImageUrl(url)) return true;
        } catch (e) {
          if (!isStorageNotFoundError(e)) {
            console.warn('[SupabaseSync] verifyStorageRef', path, e);
          }
        }
      }
      if (round < attempts - 1) {
        await new Promise((r) => setTimeout(r, opts.quick ? 80 : 300));
      }
    }
    return false;
  }

  async function uploadStorageBlob(path, blob, opts = {}) {
    const maxAttempts = Math.max(1, opts.maxAttempts || 3);
    await ensureSession();
    const sb = getClient();
    if (!sb) throw new Error('未登录');
    const cleanPath = String(path || '').replace(/^\//, '');
    if (!cleanPath) throw new Error('图片路径无效');
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { error } = await sb.storage.from(BUCKET).upload(cleanPath, blob, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '3600'
      });
      if (error) {
        lastErr = error;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 350 * attempt));
          continue;
        }
        break;
      }
      const url = await resolvePathToUrl(cleanPath);
      if (url) {
        if (opts.skipVerify) return toStorageRef(cleanPath);
        if (await verifyImageUrl(url)) return toStorageRef(cleanPath);
      }
      if (opts.skipVerify && url) return toStorageRef(cleanPath);
      await new Promise((r) => setTimeout(r, opts.skipVerify ? 120 : 450));
      const retryUrl = await resolvePathToUrl(cleanPath);
      if (retryUrl) {
        if (opts.skipVerify || (await verifyImageUrl(retryUrl))) return toStorageRef(cleanPath);
      }
      lastErr = new Error('上传后校验失败');
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, opts.skipVerify ? 200 : 350 * attempt));
    }
    throw lastErr || new Error('图片上传失败，请检查网络后重试');
  }

  async function persistGenerationImage(assetId, image) {
    if (!image || typeof image !== 'string') return image;
    if (!isLoggedIn()) return image;
    if (isStorageRef(image)) {
      const normalized = normalizeImageRef(image);
      if (await verifyStorageRef(normalized, assetId)) return normalized;
      return normalized;
    }
    await ensureSession();
    const id = String(assetId || Date.now());
    if (isDataUrl(image) || image.startsWith('blob:')) {
      return uploadGeneratedImage(id, image);
    }
    if (/^https?:\/\//i.test(image)) {
      try {
        const res = await fetch(image, { mode: 'cors' });
        if (res.ok) {
          const blob = await res.blob();
          return uploadGeneratedImage(id, blob);
        }
      } catch (e) {
        console.warn('[SupabaseSync] 生成图 CORS 拉取失败，保留 Worker 链接', e);
      }
      return image;
    }
    return image;
  }

  async function uploadGeneratedImage(assetId, source) {
    await ensureSession();
    const uid = getUserId();
    if (!uid || !assetId) throw new Error('未登录');
    const blob = await compressImage(source);
    const path = `${uid}/generated/${assetId}.jpg`;
    return uploadStorageBlob(path, blob, { skipVerify: true });
  }

  function loadImageFromSource(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片无法读取'));
      if (typeof source === 'string') img.src = source;
      else if (source instanceof Blob) img.src = URL.createObjectURL(source);
      else reject(new Error('不支持的图片格式'));
    });
  }

  async function compressImage(source) {
    const img = await loadImageFromSource(source);
    if (typeof source !== 'string' && source instanceof Blob) {
      try { URL.revokeObjectURL(img.src); } catch (e) { /* ignore */ }
    }
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (!w || !h) throw new Error('图片尺寸无效');
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('图片压缩失败'))), 'image/jpeg', JPEG_QUALITY);
    });
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new Error('图片过大，请换一张较小的图（建议小于 5MB）');
    }
    return blob;
  }

  async function uploadImageGenRef(refId, source) {
    await ensureSession();
    const uid = getUserId();
    if (!uid || !refId) throw new Error('未登录或参考图无效');
    const blob = await compressImage(source);
    const path = `${uid}/imagegen/${refId}.jpg`;
    return uploadStorageBlob(path, blob, { skipVerify: true });
  }

  async function uploadCardImage(cardId, source) {
    await ensureSession();
    const path = cardImageStoragePath(cardId);
    if (!path) throw new Error('未登录或卡片无效');
    const blob = await compressImage(source);
    return uploadStorageBlob(path, blob, { skipVerify: true });
  }

  async function deleteCardImageByUrl(url) {
    if (!url || !isStorageRef(url)) return;
    const sb = getClient();
    const path = storagePathFromRef(url);
    if (!sb || !path) return;
    await sb.storage.from(BUCKET).remove([path]);
  }

  function clearPathMissingForCard(cardId, image) {
    for (const p of listImagePathCandidates(image, cardId)) {
      missingPathCache.delete(normalizePathKey(p));
    }
  }

  /** 登录态：保证卡片图在 Storage（可上传则上传，已有则校验） */
  async function ensureCardImageOnCloud(card) {
    const cardId = card?.id;
    if (!cardId || !isLoggedIn()) {
      return { ok: true, image: card?.image ?? null };
    }
    const image = card?.image;
    if (!image) return { ok: true, image: null };

    if (isDataUrl(image) || (typeof image === 'string' && image.startsWith('blob:'))) {
      try {
        const url = await uploadCardImage(cardId, image);
        if (typeof window.clearCardImageBackup === 'function') {
          await window.clearCardImageBackup(cardId);
        }
        clearPathMissingForCard(cardId, url);
        return { ok: true, image: url, uploaded: true };
      } catch (e) {
        return { ok: false, image, error: formatError(e) };
      }
    }

    if (!isStorageRef(image)) {
      return { ok: true, image };
    }

    const normalized = normalizeImageRef(image);
    if (await verifyStorageRef(normalized, cardId, { quick: true })) {
      return { ok: true, image: normalized };
    }

    const fallback = await resolveLocalImageFallback(cardId, image);
    if (!fallback) {
      markImageUploadSkip(cardId);
      markPathMissing(primaryImagePath(image, cardId) || normalized);
      return { ok: false, image: normalized, error: '云端无图且本机无备份，请重新添加图片' };
    }
    try {
      const url = await uploadCardImage(cardId, fallback);
      if (typeof window.clearCardImageBackup === 'function') {
        await window.clearCardImageBackup(cardId);
      }
      clearPathMissingForCard(cardId, url);
      return { ok: true, image: url, uploaded: true, repaired: true };
    } catch (e) {
      return { ok: false, image: normalized, error: formatError(e) };
    }
  }

  async function repairMissingCardImages(cards, opts = {}) {
    if (!isLoggedIn() || !Array.isArray(cards) || !cards.length) {
      return { fixed: 0, skipped: 0, failed: [] };
    }
    const capMs = Math.max(5000, Number(opts.capMs) || 120000);
    const deadline = Date.now() + capMs;
    let fixed = 0;
    let skipped = 0;
    const failed = [];

    for (const card of cards) {
      if (Date.now() > deadline) {
        failed.push({ id: '_timeout', title: '补传超时', error: '请稍后重试或分批保存' });
        break;
      }
      if (!card?.id || !card.image) {
        skipped += 1;
        continue;
      }
      if (shouldSkipImageUploadAttempt(card.id)) {
        skipped += 1;
        continue;
      }

      const needsUpload = cardNeedsCloudImageUpload(card)
        || (opts.fullCheck === true && isStorageRef(card.image)
          && !(await verifyStorageRef(card.image, card.id, { quick: true })));

      if (!needsUpload) {
        skipped += 1;
        continue;
      }

      const before = card.image;
      const r = await ensureCardImageOnCloud(card);
      if (r.ok && r.image) {
        card.image = r.image;
        if (r.uploaded || r.repaired || r.image !== before) fixed += 1;
        else skipped += 1;
      } else {
        failed.push({
          id: card.id,
          title: (card.title || card.prompt || card.id || '').toString().slice(0, 40),
          error: r.error || '无法上传'
        });
      }
    }
    return { fixed, skipped, failed };
  }

  async function resolveCardImageForSave(cardId, imageValue, previousUrl) {
    if (!imageValue) {
      if (previousUrl && isStorageRef(previousUrl)) await deleteCardImageByUrl(previousUrl);
      return null;
    }
    if (!isLoggedIn()) return imageValue;
    if (isStorageRef(imageValue)) {
      const normalized = normalizeImageRef(imageValue);
      if (previousUrl && normalizeImageRef(previousUrl) === normalized) return normalized;
      if (await verifyStorageRef(normalized, cardId, { quick: true })) return normalized;
      const fallback = await resolveLocalImageFallback(cardId, imageValue);
      if (fallback) {
        const url = await uploadCardImage(cardId, fallback);
        clearPathMissingForCard(cardId, url);
        if (previousUrl && previousUrl !== url && isStorageRef(previousUrl)) {
          await deleteCardImageByUrl(previousUrl);
        }
        if (typeof window.clearCardImageBackup === 'function') {
          await window.clearCardImageBackup(cardId);
        }
        return url;
      }
      throw new Error('图片在云端已丢失，请重新选择图片后再保存');
    }
    if (isDataUrl(imageValue) || imageValue.startsWith('blob:')) {
      const url = await uploadCardImage(cardId, imageValue);
      if (previousUrl && previousUrl !== url && isStorageRef(previousUrl)) {
        await deleteCardImageByUrl(previousUrl);
      }
      return url;
    }
    if (/^https?:\/\//i.test(imageValue)) {
      try {
        const res = await fetch(imageValue, { mode: 'cors' });
        if (res.ok) {
          const blob = await res.blob();
          const url = await uploadCardImage(cardId, blob);
          if (previousUrl && previousUrl !== url && isStorageRef(previousUrl)) {
            await deleteCardImageByUrl(previousUrl);
          }
          return url;
        }
      } catch (e) {
        console.warn('[SupabaseSync] card image fetch failed', e);
      }
      throw new Error('远程图片下载失败，请换一张本地图片重试');
    }
    return imageValue;
  }

  async function resolveLocalImageFallback(cardId, currentImage) {
    if (currentImage && isDataUrl(currentImage)) return currentImage;
    if (currentImage && typeof currentImage === 'string' && currentImage.startsWith('blob:')) {
      return currentImage;
    }
    if (typeof window.getCardImageBackup === 'function') {
      const backup = await window.getCardImageBackup(cardId);
      if (backup && isDataUrl(backup)) return backup;
    }
    const sel = cardId ? `.card[data-id="${CSS.escape(String(cardId))}"] .card-img` : null;
    const img = sel ? document.querySelector(sel) : null;
    if (img?.src && isDataUrl(img.src)) return img.src;
    if (img?.src && /^https?:\/\//i.test(img.src) && img.naturalWidth > 8) {
      try {
        const res = await fetch(img.src, { mode: 'cors' });
        if (res.ok) return await res.blob();
      } catch (e) {
        console.warn('[SupabaseSync] fallback fetch card img failed', cardId, e);
      }
    }
    return null;
  }

  async function repairAllCardImagesBeforeSync(cards, opts = {}) {
    const r = await repairMissingCardImages(cards, { capMs: opts.capMs || 8000 });
    const warnings = r.failed
      .filter((f) => f.id !== '_timeout')
      .map((f) => `「${f.title}」${f.error}`);
    if (r.failed.some((f) => f.id === '_timeout')) {
      warnings.unshift('图片补传超时，已继续同步文字数据');
    }
    return { fixed: r.fixed, warnings: [...new Set(warnings)] };
  }

  async function prepareCardsForCloud(cards, opts = {}) {
    if (!isLoggedIn() || !Array.isArray(cards)) return { cards: cards || [], warnings: [] };
    const strict = opts.strict === true;
    const warnings = [];
    const warnedOnce = new Set();
    const out = [];
    for (const card of cards || []) {
      const copy = { ...card };
      if (!copy?.id || !copy.image) {
        out.push(copy);
        continue;
      }
      const mustUpload = cardNeedsCloudImageUpload(copy)
        || (strict && isStorageRef(copy.image) && !shouldSkipImageUploadAttempt(copy.id));
      if (!mustUpload) {
        out.push(copy);
        continue;
      }
      if (shouldSkipImageUploadAttempt(copy.id)) {
        out.push(copy);
        continue;
      }
      const r = await ensureCardImageOnCloud(copy);
      if (r.image) copy.image = r.image;
      if (!r.ok) {
        const label = (copy.title || copy.prompt || copy.id || '').toString().slice(0, 24);
        const msg = `「${label}」${r.error || '图片未上传'}`;
        if (!warnedOnce.has(copy.id)) {
          warnedOnce.add(copy.id);
          warnings.push(msg);
        }
      }
      out.push(copy);
    }
    return { cards: out, warnings: [...new Set(warnings)] };
  }

  async function auditBrokenCardImages(cards, opts = {}) {
    if (!isLoggedIn() || !Array.isArray(cards)) return { broken: [], repaired: [] };
    const capMs = Math.max(2000, Number(opts.capMs) || 6000);
    const deadline = Date.now() + capMs;
    const skipStorageList = opts.skipStorageList !== false;
    const broken = [];
    const repaired = [];
    for (const card of cards) {
      if (Date.now() > deadline) break;
      if (!card?.image) continue;
      if (isDataUrl(card.image) || card.image.startsWith('blob:')) continue;
      if (!isStorageRef(card.image)) continue;
      const ok = await verifyStorageRef(card.image, card.id, { quick: true });
      if (ok) continue;
      let fixed = skipStorageList ? null : await findCardImageInStorage(card.id);
      if (!fixed && typeof window.getCardImageBackup === 'function') {
        const backup = await window.getCardImageBackup(card.id);
        if (backup && isDataUrl(backup)) {
          try {
            fixed = await uploadCardImage(card.id, backup);
            if (typeof window.clearCardImageBackup === 'function') {
              await window.clearCardImageBackup(card.id);
            }
          } catch (e) {
            console.warn('[SupabaseSync] backup re-upload failed', card.id, e);
          }
        }
      }
      if (fixed) {
        repaired.push({
          id: card.id,
          title: card.title || card.prompt || card.id,
          from: card.image,
          to: fixed
        });
        card.image = fixed;
      } else {
        broken.push({
          id: card.id,
          title: (card.title || card.prompt || card.id || '').toString().slice(0, 40)
        });
      }
    }
    return { broken, repaired };
  }

  async function init(callback) {
    onAuthChange = callback;
    const sb = getClient();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    session = data.session;
    let initialHandled = false;
    sb.auth.onAuthStateChange((event, newSession) => {
      session = newSession;
      if (event === 'TOKEN_REFRESHED' && newSession?.access_token) {
        session = newSession;
      }
      if (event === 'INITIAL_SESSION') {
        if (initialHandled) return;
        initialHandled = true;
      }
      if (typeof onAuthChange === 'function') onAuthChange(newSession, event);
    });
    if (!initialHandled && typeof onAuthChange === 'function') {
      initialHandled = true;
      onAuthChange(session, 'INITIAL_SESSION');
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && session?.user) {
        void healSessionOnResume();
      }
    });
    if (session?.user && !isAccessTokenFresh(session, 60)) {
      void healSessionOnResume();
    }
    return session;
  }

  function formatAuthError(err) {
    if (!err) return '操作失败';
    const msg = String(err.message || err.error_description || err.msg || '').toLowerCase();
    if (/invalid login|invalid credentials|invalid email or password/.test(msg)) {
      return '邮箱或密码错误，请检查后重试';
    }
    if (/email not confirmed|confirm your email/.test(msg)) {
      return '邮箱尚未验证，请查收邮件中的确认链接（或在 Supabase 关闭邮箱验证）';
    }
    if (/user already registered|already been registered|already exists/.test(msg)) {
      return '该邮箱已注册，请直接登录';
    }
    if (/password should be at least|weak password|too short/.test(msg)) {
      return '密码至少 6 位，建议使用字母与数字组合';
    }
    if (/unable to validate email|invalid email/.test(msg)) {
      return '邮箱格式不正确';
    }
    if (/rate limit|too many requests/.test(msg)) {
      return '操作过于频繁，请稍后再试';
    }
    if (/network|fetch failed|failed to fetch/.test(msg)) {
      return '网络连接失败，请检查网络后重试';
    }
    if (/signup is disabled/.test(msg)) {
      return '注册功能未开启，请联系管理员';
    }
    if (/phone|sms|otp|invalid token|token has expired/.test(msg)) {
      if (/invalid token|token has expired|expired/.test(msg)) return '验证码错误或已过期';
      if (/phone provider|sms provider|phone auth/.test(msg)) {
        return '手机登录未在 Supabase 配置，请先在控制台开启 Phone 并配置短信服务';
      }
      if (/invalid phone/.test(msg)) return '手机号格式不正确';
    }
    return err.message || '操作失败，请稍后重试';
  }

  function normalizePhone(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (s.startsWith('+')) {
      const digits = s.replace(/\D/g, '');
      return digits.length >= 10 ? '+' + digits : null;
    }
    const digits = s.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) return '+86' + digits;
    if (digits.length === 13 && digits.startsWith('86')) return '+' + digits;
    return null;
  }

  function isPhoneAuthEnabled() {
    return window.AUTH_PHONE_ENABLED === true;
  }

  function isWeChatAuthEnabled() {
    return window.WECHAT_OAUTH_ENABLED === true && !!window.WECHAT_OAUTH_URL;
  }

  async function sendPhoneOtp(phone) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase 未配置');
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error('请输入正确的 11 位中国大陆手机号');
    const { error } = await sb.auth.signInWithOtp({ phone: normalized });
    if (error) throw new Error(formatAuthError(error));
  }

  async function verifyPhoneOtp(phone, token) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase 未配置');
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error('请输入正确的手机号');
    const code = String(token || '').trim();
    if (!/^\d{6}$/.test(code)) throw new Error('请输入 6 位数字验证码');
    const { data, error } = await sb.auth.verifyOtp({
      phone: normalized,
      token: code,
      type: 'sms'
    });
    if (error) throw new Error(formatAuthError(error));
    session = data.session;
    return data;
  }

  /** 已登录账号在任务中心绑定/验证手机号 */
  async function sendPhoneOtpForBind(phone) {
    await ensureSession();
    const sb = getClient();
    if (!sb || !session?.user) throw new Error('请先登录');
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error('请输入正确的 11 位中国大陆手机号');
    const { error } = await sb.auth.updateUser({ phone: normalized });
    if (error) throw new Error(formatAuthError(error));
  }

  async function verifyPhoneOtpForBind(phone, token) {
    await ensureSession();
    const sb = getClient();
    if (!sb || !session?.user) throw new Error('请先登录');
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error('请输入正确的手机号');
    const code = String(token || '').trim();
    if (!/^\d{6}$/.test(code)) throw new Error('请输入 6 位数字验证码');
    const { data, error } = await sb.auth.verifyOtp({
      phone: normalized,
      token: code,
      type: 'phone_change'
    });
    if (error) throw new Error(formatAuthError(error));
    session = data.session;
    return data;
  }

  async function signUp(email, password) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase 未配置');
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin + window.location.pathname }
    });
    if (error) throw new Error(formatAuthError(error));
    if (data.session) session = data.session;
    return data;
  }

  async function signIn(email, password) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase 未配置');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(formatAuthError(error));
    session = data.session;
    if (!session) {
      const { data: fresh } = await sb.auth.getSession();
      session = fresh.session;
    }
    return { ...data, session: session || data.session };
  }

  async function resetPassword(email) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase 未配置');
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });
    if (error) throw new Error(formatAuthError(error));
  }

  async function updatePassword(newPassword) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase 未配置');
    await ensureSession();
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw new Error(formatAuthError(error));
  }

  async function signOut() {
    const sb = getClient();
    if (!sb) return;
    await sb.auth.signOut();
    session = null;
    clearSignedUrlCache();
  }

  async function pullCloudData() {
    await ensureSession();
    const sb = getClient();
    const uid = getUserId();
    if (!sb || !uid) return null;
    const { data, error } = await sb.from('user_data').select('data, updated_at').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    return data?.data || null;
  }

  async function pushCloudData(payload, opts = {}) {
    await ensureSession();
    const sb = getClient();
    const uid = getUserId();
    if (!sb || !uid) return { warnings: [] };

    let cloudPayload = null;
    if (!opts.skipSafety && window.CloudSyncSafety?.validatePush) {
      try {
        const { data, error: pullErr } = await sb
          .from('user_data')
          .select('data')
          .eq('user_id', uid)
          .maybeSingle();
        if (pullErr) throw pullErr;
        cloudPayload = data?.data || null;
        const check = window.CloudSyncSafety.validatePush(payload, cloudPayload);
        if (!check.allow) {
          throw new Error(check.reason || '为保护云端数据，已取消同步');
        }
        if (check.merged) payload = check.merged;
      } catch (e) {
        if (e.message && e.message.includes('已阻止')) throw e;
        if (!opts.allowWithoutCloudCheck) {
          throw new Error('无法校验云端数据，已取消上传：' + formatError(e));
        }
      }
    }

    const imageSnapshot = (payload.cards || []).map((c) => ({
      id: c?.id,
      image: c?.image
    }));
    const { cards: preparedCards, warnings } = await prepareCardsForCloud(payload.cards || [], {
      strict: opts.strictImageCheck === true
    });
    const restoredCards = (preparedCards || []).map((c) => {
      const snap = imageSnapshot.find((s) => String(s.id) === String(c.id));
      if (snap?.image && !c.image) return { ...c, image: snap.image };
      return c;
    });
    const prepared = {
      ...payload,
      cards: restoredCards,
      schemaVersion: window.CloudSyncSafety?.SCHEMA_VERSION || 2
    };
    const { error } = await sb.from('user_data').upsert({
      user_id: uid,
      data: prepared,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) throw new Error(formatError(error));
    if (Array.isArray(prepared.cards)) payload.cards = prepared.cards;
    return { warnings, data: prepared };
  }

  window.SupabaseSync = {
    isConfigured,
    isLoggedIn,
    getUserId,
    getSession,
    getValidAccessToken,
    healSessionOnResume,
    refreshSessionOnce,
    getUserEmail,
    isDataUrl,
    isStorageUrl,
    isStorageRef,
    storagePathFromRef,
    primaryImagePath,
    isPathKnownMissing,
    isInvalidMediaUrl,
    normalizeImageRef,
    resolveDisplayUrl,
    prefetchDisplayUrls,
    prefetchDisplayUrlsWithCap,
    prefetchCardsImages,
    prefetchWarehousePage,
    patchWarehouseImagesFromCache,
    batchSignPaths,
    prefetchCommunityDisplayUrls,
    patchImageSrcFromCache,
    getCachedDisplayUrl,
    invalidateSignedCache,
    invalidateSignedCacheForRef,
    isFreshSignedDisplayUrl,
    isValidSignedDisplayUrl,
    isIncompleteSignedStorageUrl,
    VARIANT_GRID,
    VARIANT_FULL,
    safeImgSrc,
    publicUrlFromPath,
    repairAllCardImagesBeforeSync,
    resolveLocalImageFallback,
    uploadStorageBlob,
    auditBrokenCardImages,
    repairCardImageIfMissing,
    findCardImageInStorage,
    hydrateImageElements,
    persistGenerationImage,
    uploadGeneratedImage,
    clearSignedUrlCache,
    init,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    sendPhoneOtp,
    verifyPhoneOtp,
    sendPhoneOtpForBind,
    verifyPhoneOtpForBind,
    normalizePhone,
    isPhoneAuthEnabled,
    isWeChatAuthEnabled,
    formatAuthError,
    pullCloudData,
    pushCloudData,
    uploadCardImage,
    uploadImageGenRef,
    deleteCardImageByUrl,
    resolveCardImageForSave,
    ensureCardImageOnCloud,
    repairMissingCardImages,
    prepareCardsForCloud,
    formatError
  };
})();

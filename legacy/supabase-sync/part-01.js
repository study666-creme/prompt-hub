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
  /** 持久化 404 路径，刷新后少重复 sign（24h） */
  const MISSING_PATH_PERSIST_TTL_MS = 24 * 60 * 60 * 1000;
  const LS_MISSING_PATHS = 'ph_missing_paths_v1';
  /** R2 同步已启动：结束过渡期隐藏，已上传 R2 的图由 Worker r2-first 出图 */
  const LEGACY_IMAGE_RESTORE_UNTIL_MS = Date.parse('2026-06-06T00:00:00+08:00');
  /** 此日期前创建的 storage:// 卡视为境外旧图，过渡期直接隐藏 */
  const LEGACY_STORAGE_HIDE_BEFORE_MS = Date.parse('2026-06-07T00:00:00+08:00');
  const IMAGE_UPLOAD_SKIP_MS = 24 * 60 * 60 * 1000;
  const SIGN_REQUEST_TIMEOUT_MS = 4500;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  /** 卡片库列表缩略图 */
  const MAX_SIDE = 1024;
  const GRID_MAX_SIDE = 640;
  const JPEG_QUALITY = 0.78;
  const GRID_JPEG_QUALITY = 0.72;
  const MIN_VALID_IMAGE_BYTES = 512;
  /** 列表 grid 小于此字节视为损坏空壳（真实 640px grid 通常 ≥15KB） */
  const GRID_MIN_VALID_BYTES = 8192;
  /** 列表 grid 大于此字节视为误存原图，触发 backfill / 重签 */
  const GRID_MAX_VALID_BYTES = 220 * 1024;
  /** 卡片库主图（未开原图时）：兼顾清晰度与体积 */
  const CARD_UPLOAD_MAX_SIDE = 2560;
  const CARD_UPLOAD_JPEG_QUALITY = 0.88;
  /** 生图入库：原字节入库，仅列表 grid 缩略；4K 等付费档位不得重编码降画质 */
  function extensionFromMime(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('png')) return 'png';
    if (m.includes('webp')) return 'webp';
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
    return 'jpg';
  }
  /** 与 Supabase 桶 card-images 上限一致（迁移 20260602120000 为 50MB） */
  const STORAGE_BUCKET_LIMIT_BYTES = 52428800;
  /** 设置里开启「保存原图」/ 生图入库时的单张上限（与桶 50MB 一致） */
  const CARD_ORIGINAL_MAX_BYTES = STORAGE_BUCKET_LIMIT_BYTES;
  /** 列表用 grid 缓存键；签名不再走 Storage transform（易 500） */
  const VARIANT_GRID = 'grid';
  const VARIANT_FULL = 'full';
  const USE_STORAGE_TRANSFORM = false;
  const GRID_SIGN_CONCURRENCY = 16;
  const WAREHOUSE_PREFETCH_CARD_CAP = 24;
  const WAREHOUSE_VISIBLE_SIGN_CAP = 10;
  const WAREHOUSE_FAST_FIRST = 10;

  /** 与 MobileUI.MOBILE_PERF.warehousePrefetchCap 对齐（社区 feed 同量级 24） */
  function warehousePrefetchCardCap() {
    const mp = typeof window !== 'undefined' && window.MobileUI?.getPerf?.();
    if (mp?.warehousePrefetchCap) return Math.max(8, Number(mp.warehousePrefetchCap) || 24);
    return WAREHOUSE_PREFETCH_CARD_CAP;
  }
  const SS_SIGN_CACHE = 'ph_signed_urls_v2';
  const LS_CLOUD_UPDATED = 'ph_cloud_updated_at';
  let pullCloudInflight = null;
  let lastCloudPullSkipped = false;

  function cloudUpdatedKey(uid) {
    return `${LS_CLOUD_UPDATED}_${uid || ''}`;
  }

  function getLocalCloudUpdatedAt(uid) {
    if (!uid) return '';
    try {
      return localStorage.getItem(cloudUpdatedKey(uid)) || '';
    } catch (e) {
      return '';
    }
  }

  function setLocalCloudUpdatedAt(uid, iso) {
    if (!uid || !iso) return;
    try {
      localStorage.setItem(cloudUpdatedKey(uid), String(iso));
    } catch (e) { /* ignore */ }
  }

  function wasLastCloudPullSkipped() {
    return lastCloudPullSkipped === true;
  }

  function slimPayloadForCloudStorage(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const out = { ...payload };
    if (Array.isArray(out.cards)) {
      out.cards = out.cards.map((c) => {
        if (!c || typeof c !== 'object') return c;
        const card = { ...c };
        if (typeof card.image === 'string' && card.image.startsWith('data:image/')) {
          card.image = null;
        }
        if (card.customFields && typeof card.customFields === 'object' && !Object.keys(card.customFields).length) {
          delete card.customFields;
        }
        return card;
      });
    }
    if (Array.isArray(out.communityPosts)) {
      out.communityPosts = out.communityPosts.filter((p) => p && !p.isMock).map((p) => {
        if (!p.sourceCardId) return p;
        const slim = { ...p };
        delete slim.prompt;
        delete slim.image;
        delete slim.title;
        return slim;
      });
    }
    if (Array.isArray(out.creations)) {
      out.creations = out.creations.map((c) => {
        if (!c?.image || !String(c.image).startsWith('data:')) return c;
        const { image, ...rest } = c;
        return rest;
      });
    }
    if (Array.isArray(out.notifications) && out.notifications.length > 40) {
      out.notifications = out.notifications.slice(-40);
    }
    if (Array.isArray(out.communityEvents) && out.communityEvents.length > 30) {
      out.communityEvents = out.communityEvents.slice(-30);
    }
    return out;
  }
  const SS_GRID_DONE = 'ph_grid_done_v1';
  const LS_GRID_DONE = 'ph_grid_done_v1';
  const SS_GRID_SKIP = 'ph_grid_skip_v1';
  const signInflight = new Map();
  const gridBackfillQueue = [];
  let gridBackfillRunning = false;
  let signBudgetUsed = 0;
  let signBudgetResetAt = 0;
  const SIGN_BUDGET_MAX = (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches) ? 180 : 240;
  const SIGN_BUDGET_WINDOW_MS = 30000;
  /** 社区 sign-batch：串行 + 最小间隔，避免滚动/append 并发打满 Worker 429 */
  const COMMUNITY_SIGN_BATCH_CHUNK = 40;
  const COMMUNITY_SIGN_BATCH_MIN_GAP_MS = 700;
  let communitySignBatchChain = Promise.resolve();
  let communitySignBatchLastAt = 0;
  let communitySignBatchCooldownUntil = 0;
  /** 视口触发 backfill：一次下载原图+上传 grid，会话内限量避免 Supabase 风暴 */
  const AUTO_GRID_BACKFILL = true;
  const GRID_BACKFILL_SESSION_CAP = 48;
  let gridBackfillSessionCount = 0;
  /** 列表签名只走 Worker API，避免 Supabase 超限 400 风暴 */
  const USE_DIRECT_SUPABASE_SIGN = false;
  /** 本会话 CDN 404 过的 grid 路径；带 TTL，避免 R2 已有文件仍整页黑卡 */
  const gridFetchFailedPaths = new Map();
  const GRID_FETCH_FAIL_TTL_MS = 6 * 60 * 1000;
  const warmGenThumbInflight = new Set();
  const queueGridBackfillInflight = new Set();

  let persistMissingPathTimer = null;
  function loadMissingPathCache() {
    try {
      const raw = localStorage.getItem(LS_MISSING_PATHS);
      if (!raw) return;
      const data = JSON.parse(raw);
      const now = Date.now();
      for (const [key, exp] of Object.entries(data || {})) {
        if (typeof exp === 'number' && exp > now) missingPathCache.set(key, exp);
      }
    } catch (e) { /* ignore */ }
  }

  function persistMissingPathCache() {
    clearTimeout(persistMissingPathTimer);
    persistMissingPathTimer = setTimeout(() => {
      try {
        const now = Date.now();
        const data = {};
        missingPathCache.forEach((exp, key) => {
          if (exp > now) data[key] = exp;
        });
        localStorage.setItem(LS_MISSING_PATHS, JSON.stringify(data));
      } catch (e) { /* ignore */ }
    }, 200);
  }

  function loadSessionSignCache() {
    try {
      const raw = sessionStorage.getItem(SS_SIGN_CACHE);
      if (!raw) return;
      const data = JSON.parse(raw);
      const now = Date.now();
      for (const [key, entry] of Object.entries(data || {})) {
        if (entry?.url && entry.expiresAt > now + 60000 && !isInvalidMediaUrl(entry.url)
          && mediaUrlMatchesCurrentApi(entry.url)) {
          if (/@g640$/.test(key) && !isGridDisplayUrl(entry.url)) continue;
          signedUrlCache.set(key, entry);
        }
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

  function purgeStaleGridSignCache() {
    const drop = [];
    signedUrlCache.forEach((_entry, key) => {
      const path = String(key).replace(/@g640$/, '');
      if (!/_grid\.(jpe?g|webp|png)$/i.test(path)) return;
      if (path.includes('/generated/') || isLegacyUploadCardPath(path.replace(/_grid\.(jpe?g|webp|png)$/i, '.jpg'))) {
        drop.push(key);
      }
    });
    drop.forEach((k) => signedUrlCache.delete(k));
    if (drop.length) persistSessionSignCache();
  }

  function purgeFakeGridCacheEntries() {
    let n = 0;
    for (const [key, val] of signedUrlCache.entries()) {
      if (!key.endsWith('@g640') || !val?.url) continue;
      if (!isGridDisplayUrl(val.url)) {
        signedUrlCache.delete(key);
        n += 1;
      }
    }
    if (n) persistSessionSignCache();
  }

  loadMissingPathCache();

  function currentApiOrigin() {
    const api = String(window.API_BASE_URL || '').trim().replace(/\/$/, '');
    if (!api) return '';
    try { return new URL(api).origin; } catch (e) { return ''; }
  }

  function localDevMediaOrigins() {
    const h = (typeof location !== 'undefined' && location.hostname) || '';
    if (h !== 'localhost' && h !== '127.0.0.1') return [];
    return ['https://api.prompt-hubs.com', 'https://api.prompt-hub.cn'];
  }

  function mediaUrlMatchesCurrentApi(url) {
    if (!url || typeof url !== 'string') return false;
    const apiOrigin = currentApiOrigin();
    try {
      const u = new URL(url);
      if (u.pathname.includes('/api/v1/media/')) {
        if (apiOrigin && u.origin === apiOrigin) return true;
        return localDevMediaOrigins().includes(u.origin);
      }
    } catch (e) { /* ignore */ }
    return true;
  }

  function purgeForeignOriginSignCache() {
    let n = 0;
    for (const [key, entry] of signedUrlCache.entries()) {
      if (entry?.url && !mediaUrlMatchesCurrentApi(entry.url)) {
        signedUrlCache.delete(key);
        n += 1;
      }
    }
    if (n) persistSessionSignCache();
    return n;
  }

  loadSessionSignCache();
  purgeForeignOriginSignCache();
  purgeStaleGridSignCache();
  purgeFakeGridCacheEntries();

  function clearGridMissingMarksForReadyCards() {
    /* 不再清除 missing 标记：grid done 但文件 404 时会陷入 sign→404→clear→sign 死循环 */
  }

  function consumeSignBudget(n) {
    const now = Date.now();
    if (now > signBudgetResetAt) {
      signBudgetUsed = 0;
      signBudgetResetAt = now + SIGN_BUDGET_WINDOW_MS;
    }
    if (signBudgetUsed + (n || 1) > SIGN_BUDGET_MAX) return false;
    signBudgetUsed += n || 1;
    return true;
  }

  function signBudgetAvailable() {
    const now = Date.now();
    if (now > signBudgetResetAt) return true;
    return signBudgetUsed < SIGN_BUDGET_MAX;
  }

  function markGridFetchFailed(path, cardIdHint) {
    const key = normalizePathKey(path);
    if (!key) return;
    gridFetchFailedPaths.set(key, Date.now() + GRID_FETCH_FAIL_TTL_MS);
    if (/_grid\.(jpe?g|webp|png)$/i.test(key)) {
      invalidateSignedCache(key);
    } else {
      markPathMissing(key);
      invalidateSignedCache(key);
    }
    persistSessionSignCache();
    if (/_grid\.(jpe?g|webp|png)$/i.test(key)) {
      const id = cardIdHint || findCardForGridPath(key)?.id;
      if (id) unmarkGridThumbReady(id);
    }
  }

  function isGridFetchFailed(path) {
    const key = normalizePathKey(path);
    if (!key) return false;
    const exp = gridFetchFailedPaths.get(key);
    if (!exp) return false;
    if (exp <= Date.now()) {
      gridFetchFailedPaths.delete(key);
      return false;
    }
    return true;
  }

  function clearSessionGridFetchFailures() {
    gridFetchFailedPaths.clear();
  }

  /** 进入卡片库 / 新版本：自动清本地「路径失败」缓存（无需用户开控制台） */
  function bootstrapWarehouseMediaCache(opts) {
    const uid = getUserId();
    clearSessionGridFetchFailures();
    signBudgetUsed = 0;
    signBudgetResetAt = 0;
    if (opts?.clearAllMissing !== false) {
      missingPathCache.clear();
      try { localStorage.removeItem(LS_MISSING_PATHS); } catch (e) { /* ignore */ }
    } else if (uid) {
      const prefix = `${uid}/`;
      const drop = [];
      missingPathCache.forEach((_exp, key) => {
        if (String(key).startsWith(prefix)) drop.push(key);
      });
      drop.forEach((k) => missingPathCache.delete(k));
      persistMissingPathCache();
    }
    try {
      const build = window.__APP_BUILD__ || '';
      const k = `ph_wh_media_boot_${build}`;
      if (build && !sessionStorage.getItem(k)) {
        sessionStorage.removeItem('ph_signed_urls_v2');
        sessionStorage.removeItem('ph_wh_grid_v1');
        sessionStorage.setItem(k, '1');
      }
    } catch (e) { /* ignore */ }
  }

  function unmarkGridThumbReady(cardId) {
    if (!cardId) return;
    const id = String(cardId);
    try {
      const rawLocal = localStorage.getItem(LS_GRID_DONE);
      const mapLocal = rawLocal ? JSON.parse(rawLocal) : {};
      if (mapLocal[id]) {
        delete mapLocal[id];
        localStorage.setItem(LS_GRID_DONE, JSON.stringify(mapLocal));
      }
    } catch (e) { /* ignore */ }
    try {
      const raw = sessionStorage.getItem(SS_GRID_DONE);
      const map = raw ? JSON.parse(raw) : {};
      if (map[id]) {
        delete map[id];
        sessionStorage.setItem(SS_GRID_DONE, JSON.stringify(map));
      }
    } catch (e) { /* ignore */ }
  }

  function gridListNeedsPrimaryFallback(primary, cardId) {
    if (!primary) return false;
    const pk = String(primary).replace(/^\//, '');
    /* 他人社区卡：不做自有 backfill 判定，列表仍尝试 grid 签名 */
    if (!storagePathOwnedByCurrentUser(pk)) return false;
    const grid = gridPathFromPrimary(pk);
    if (!grid) return true;
    const gk = grid.replace(/^\//, '');
    if (isPathKnownMissing(gk) || isGridFetchFailed(gk)) return true;
    if (cardId && isGridThumbReady(cardId) && !isPathKnownMissing(gk)) return false;
    if (isGridFetchFailed(gk)) return true;
    /* 生图/旧版卡：桶里可无 _grid 文件，CDN 对 _grid 路径现场缩略；列表禁止回退原图 */
    if (cardId && (pk.includes('/generated/') || isLegacyUploadCardPath(pk))) return false;
    if (!shouldSignGridPath(gk, cardId)) return true;
    return false;
  }

  /** 自有卡列表：优先签 grid（CDN 可现场缩略）；列表不签 full */
  function ownedListSignTargets(primary, cardId, opts) {
    const gridOnly = opts?.gridOnly === true;
    const pkey = String(primary || '').replace(/^\//, '');
    if (!pkey || isPathKnownMissing(pkey)) {
      return { grid: null, primary: null, needsBackfill: false };
    }
    const gridKey = (gridPathFromPrimary(pkey) || '').replace(/^\//, '');
    if (gridKey && shouldSignGridPath(gridKey, cardId)) {
      return { grid: gridKey, primary: null, needsBackfill: false };
    }
    if (gridListNeedsPrimaryFallback(primary, cardId)) {
      return {
        grid: null,
        primary: gridOnly ? null : pkey,
        needsBackfill: AUTO_GRID_BACKFILL && !!cardId
      };
    }
    if (gridKey) return { grid: gridKey, primary: null, needsBackfill: false };
    if (!gridOnly) return { grid: null, primary: pkey, needsBackfill: false };
    return { grid: null, primary: null, needsBackfill: false };
  }

  async function resolveListPrimaryFallback(primary, assetId, opts) {
    const key = String(primary || '').replace(/^\//, '');
    if (!key || isPathKnownMissing(key)) return null;
    const cached = signedUrlCache.get(signedCacheKey(key, VARIANT_FULL));
    if (cached?.url && cached.expiresAt > Date.now() + 120000) return cached.url;
    const apiUrl = await signPathViaApi(key, VARIANT_FULL, {
      cardId: assetId,
      authorId: opts?.authorId,
      bypassSignBudget: true
    });
    if (apiUrl) return apiUrl;
    return resolvePathToUrl(key, VARIANT_FULL, {
      cardId: assetId,
      authorId: opts?.authorId,
      listOnly: false,
      bypassSignBudget: true
    });
  }

  function shouldSignGridPath(gridKey, cardId) {
    const key = normalizePathKey(gridKey);
    if (!key || isPathKnownMissing(key) || isGridFetchFailed(key)) return false;
    if (!/_grid\.(jpe?g|webp|png)$/i.test(key)) return false;
  /** 自有图：CDN 可按原图现场生成 grid，勿等本地 backfill 完成才签名 */
    if (storagePathOwnedByCurrentUser(key)) {
      const id = cardId || findCardForGridPath(key)?.id;
      if (id) return true;
    }
    let id = cardId;
    if (!id) {
      const card = findCardForGridPath(key);
      id = card?.id;
    }
    const primaryGuess = key.replace(/_grid\.(jpe?g|webp|png)$/i, '.jpg');
    const needsReadyFlag = key.includes('/generated/') || isLegacyUploadCardPath(primaryGuess);
    /* 生图/旧版上传常无独立 grid 文件；签 grid CDN 路径后边缘按需从原图生成 */
    if (needsReadyFlag) {
      if (id) return true;
      return storagePathOwnedByCurrentUser(primaryGuess);
    }
    if (id && isGridThumbReady(id)) return true;
    const gridHit = signedUrlCache.get(signedCacheKey(key, VARIANT_GRID));
    return !!(gridHit?.url && gridHit.expiresAt > Date.now() + 120000);
  }

  let gridPathCardIdCache = null;
  let gridPathCardIdCacheLen = 0;

  function rebuildGridPathCardIdCache() {
    const map = new Map();
    const list = window.__promptHubCards || [];
    for (const c of list) {
      if (!c?.id || !c?.image) continue;
      const p = primaryImagePath(c.image, c.id);
      const grid = p ? gridPathFromPrimary(p.replace(/^\//, '')) : null;
      if (grid) map.set(normalizePathKey(grid), c.id);
    }
    gridPathCardIdCache = map;
    gridPathCardIdCacheLen = list.length;
  }

  function findCardForGridPath(gridKey) {
    const norm = normalizePathKey(gridKey);
    const list = window.__promptHubCards || [];
    if (!gridPathCardIdCache || gridPathCardIdCacheLen !== list.length) {
      rebuildGridPathCardIdCache();
    }
    const id = gridPathCardIdCache.get(norm);
    if (id) return list.find((c) => c.id === id) || null;
    return list.find((c) => {
      if (!c?.id || !c?.image) return false;
      const p = primaryImagePath(c.image, c.id);
      const grid = p ? gridPathFromPrimary(p.replace(/^\//, '')) : null;
      return grid && normalizePathKey(grid) === norm;
    }) || null;
  }

  try {
    const rawS = sessionStorage.getItem(SS_GRID_DONE);
    const rawL = localStorage.getItem(LS_GRID_DONE);
    const mapS = rawS ? JSON.parse(rawS) : {};
    const mapL = rawL ? JSON.parse(rawL) : {};
    const merged = { ...mapS, ...mapL };
    if (Object.keys(merged).length) {
      localStorage.setItem(LS_GRID_DONE, JSON.stringify(merged));
    }
  } catch (e) { /* ignore */ }

  function isCdnMediaUrl(url) {
    return typeof url === 'string' && /\/api\/v1\/media\/[ci]\//i.test(url);
  }

  /** 上游临时链（getapi / MJ CDN 等）：列表禁止直载原图，须先入库或走 grid CDN */
  function isEphemeralUpstreamImageUrl(url) {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    if (isInvalidMediaUrl(url)) return false;
    if (isCdnMediaUrl(url)) return false;
    if (/supabase\.co\/storage\/v1\/object/i.test(url)) return false;
    if (storagePathFromRef(url)) return false;
    return true;
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
    if (isInvalidMediaUrl(url)) return false;
    if (isIncompleteSignedStorageUrl(url)) return false;
    const path = storagePathFromRef(url);
    if (!path) return isCdnMediaUrl(url) || isFreshSignedDisplayUrl(url, 60000);
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

  function isUsableLoadedImgSrc(src, img) {
    if (!src || !src.startsWith('http') || src.includes('data:image/svg')) return false;
    if (img?.complete && img.naturalWidth > 8) return true;
    return isValidSignedDisplayUrl(src);
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
    if (/maximum allowed size|entity too large|payload too large|413/.test(msg)) {
      return '图片超过云存储单文件上限（当前桶约 50MB）。站点已尝试原尺寸高清 JPEG；若仍失败，请换较小文件或联系管理员检查 Supabase 桶 card-images 的 File size limit';
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

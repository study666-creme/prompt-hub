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
    return (
      str.startsWith(`${base}/storage/v1/object/public/${BUCKET}/`) ||
      str.startsWith(`${base}/storage/v1/object/sign/${BUCKET}/`) ||
      str.startsWith(`${base}/storage/v1/object/authenticated/${BUCKET}/`)
    );
  }

  function storagePathFromUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const cdnPath = storagePathFromCdnUrl(url);
    if (cdnPath) return cdnPath;
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
    if (isCdnMediaUrl(value)) {
      const fromCdn = storagePathFromDisplayUrl(value);
      if (fromCdn) return toStorageRef(fromCdn);
    }
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

  function clearListImageMissMarks() {
    missingPathCache.clear();
    gridFetchFailedPaths.clear();
    persistSessionSignCache();
  }

  function clearSignedUrlCache() {
    signedUrlCache.clear();
    missingPathCache.clear();
    imageUploadSkipUntil.clear();
  }

  try {
    if (localStorage.getItem('promptrepo_sign_v') !== '9') {
      clearSignedUrlCache();
      missingPathCache.clear();
      gridFetchFailedPaths.clear();
      try { localStorage.removeItem(LS_MISSING_PATHS); } catch (e) { /* ignore */ }
      localStorage.setItem('promptrepo_sign_v', '9');
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

  function payloadNeedsImageUpload(cards, opts = {}) {
    const includeRemoteHttp = opts.includeRemoteHttp === true;
    return (cards || []).some((c) => {
      if (!c?.id || !c?.image) return false;
      if (isDataUrl(c.image) || (typeof c.image === 'string' && c.image.startsWith('blob:'))) {
        return true;
      }
      if (includeRemoteHttp && typeof c.image === 'string' && /^https?:\/\//i.test(c.image)) {
        return true;
      }
      if (!isStorageRef(c.image)) return false;
      const primary = primaryImagePath(c.image, c.id);
      return !!(primary && isPathKnownMissing(primary));
    });
  }

  function cardNeedsCloudImageUpload(card) {
    if (!card?.id || !card.image) return false;
    if (isDataUrl(card.image) || (typeof card.image === 'string' && card.image.startsWith('blob:'))) {
      return true;
    }
    if (typeof card.image === 'string' && /^https?:\/\//i.test(card.image)) {
      if (isCdnMediaUrl(card.image) || /supabase\.co\/storage\/v1\/object/i.test(card.image)) {
        return false;
      }
      if (/aitohumanize|filesystem\.site|apimart\.ai|grsai\.com/i.test(card.image)) {
        return false;
      }
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
    if (!key) return;
    const exp = Date.now() + MISSING_PATH_PERSIST_TTL_MS;
    missingPathCache.set(key, exp);
    persistMissingPathCache();
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

  function stripGridSuffixFromPath(path) {
    let p = String(path || '').replace(/^\//, '');
    if (!/_grid\./i.test(p)) return p;
    if (/_grid\.webp$/i.test(p)) return p.replace(/_grid\.webp$/i, '.webp');
    if (/_grid\.png$/i.test(p)) return p.replace(/_grid\.png$/i, '.png');
    return p.replace(/_grid\.jpe?g$/i, '.jpg');
  }

  function primaryImagePath(image, assetId) {
    if (image != null && typeof image !== 'string') return null;
    const fromRef = storagePathFromRef(image);
    if (fromRef) return stripGridSuffixFromPath(fromRef);
    const canonical = cardImageStoragePath(assetId);
    return canonical ? canonical.replace(/^\//, '') : null;
  }

  function gridPathFromPrimary(path) {
    if (!path || /_grid\.(jpe?g|webp|png)$/i.test(path)) return null;
    const m = String(path).replace(/^\//, '').match(/^(.+\/)([^/]+)\.(jpe?g|webp|png)$/i);
    if (!m) return null;
    return `${m[1]}${m[2]}_grid.jpg`;
  }

  function gridImageStoragePath(cardId, ownerId) {
    const primary = cardImageStoragePath(cardId, ownerId);
    return primary ? gridPathFromPrimary(primary) : null;
  }

  function pathsForVariant(image, assetId, ownerId, variant, jobId) {
    const all = listImagePathCandidates(image, assetId, ownerId, jobId);
    const skipMissing = (paths) => paths.filter((p) => !isPathKnownMissing(String(p || '').replace(/^\//, '')));
    if (variant === VARIANT_FULL) {
      return skipMissing(all.filter((p) => !/_grid\.(jpe?g|webp|png)$/i.test(p)));
    }
    const gridFirst = [];
    const seen = new Set();
    const add = (p) => {
      const key = (p || '').replace(/^\//, '');
      if (key && !seen.has(key)) {
        seen.add(key);
        gridFirst.push(key);
      }
    };
    for (const p of all) {
      if (/_grid\.(jpe?g|webp|png)$/i.test(p)) add(p);
    }
    const primary = primaryImagePath(image, assetId);
    if (primary) {
      const grid = gridPathFromPrimary(primary.replace(/^\//, ''));
      if (grid) add(grid);
    }
    return skipMissing(gridFirst);
  }

  function isGridThumbReady(cardId) {
    if (!cardId) return false;
    const id = String(cardId);
    try {
      const rawLocal = localStorage.getItem(LS_GRID_DONE);
      const mapLocal = rawLocal ? JSON.parse(rawLocal) : {};
      if (mapLocal[id]) return true;
    } catch (e) { /* ignore */ }
    try {
      const raw = sessionStorage.getItem(SS_GRID_DONE);
      const map = raw ? JSON.parse(raw) : {};
      return !!map[id];
    } catch (e) {
      return false;
    }
  }

  function markGridThumbReady(cardId) {
    if (!cardId) return;
    const id = String(cardId);
    const stamp = Date.now();
    try {
      const rawLocal = localStorage.getItem(LS_GRID_DONE);
      const mapLocal = rawLocal ? JSON.parse(rawLocal) : {};
      mapLocal[id] = stamp;
      localStorage.setItem(LS_GRID_DONE, JSON.stringify(mapLocal));
    } catch (e) { /* ignore */ }
    try {
      const raw = sessionStorage.getItem(SS_GRID_DONE);
      const map = raw ? JSON.parse(raw) : {};
      map[id] = stamp;
      sessionStorage.setItem(SS_GRID_DONE, JSON.stringify(map));
    } catch (e) { /* ignore */ }
  }

  function isGridBackfillSkipped(cardId) {
    if (!cardId) return false;
    try {
      const raw = sessionStorage.getItem(SS_GRID_SKIP);
      const map = raw ? JSON.parse(raw) : {};
      return !!map[String(cardId)];
    } catch (e) {
      return false;
    }
  }

  function clearGridBackfillSkipped(cardId) {
    if (!cardId) return;
    try {
      const raw = sessionStorage.getItem(SS_GRID_SKIP);
      const map = raw ? JSON.parse(raw) : {};
      if (map[String(cardId)]) {
        delete map[String(cardId)];
        sessionStorage.setItem(SS_GRID_SKIP, JSON.stringify(map));
      }
    } catch (e) { /* ignore */ }
  }

  function markGridBackfillSkipped(cardId, reason) {
    if (!cardId) return;
    try {
      const raw = sessionStorage.getItem(SS_GRID_SKIP);
      const map = raw ? JSON.parse(raw) : {};
      map[String(cardId)] = { at: Date.now(), reason: String(reason || 'no_source') };
      sessionStorage.setItem(SS_GRID_SKIP, JSON.stringify(map));
    } catch (e) { /* ignore */ }
  }

  async function downloadOriginalForBackfill(card) {
    const cardId = card?.id;
    const image = card?.image;
    if (!cardId || !image) return null;
    const dlOpts = { ignoreMissingCache: true, markMissing: false, cardId };
    const primary = primaryImagePath(image, cardId);
    if (primary) {
      const blob = await downloadOwnedStorageBlob(primary.replace(/^\//, ''), dlOpts);
      if (blob) return { blob, path: primary.replace(/^\//, '') };
    }
    const uid = getUserId();
    if (uid) {
      const cid = String(cardId).replace(/^wh_/, '');
      const genJobId = resolveJobIdForAsset({ cardId }, cardId);
      if (genJobId) {
        const genKey = generationStorageAssetId(genJobId, '');
        for (const ext of ['png', 'jpg', 'webp']) {
          const genPath = `${uid}/generated/${genKey}.${ext}`;
          if (!primary || genPath !== primary.replace(/^\//, '')) {
            const blob = await downloadOwnedStorageBlob(genPath, dlOpts);
            if (blob) return { blob, path: genPath };
          }
        }
      }
      const genPath = `${uid}/generated/${cid}.jpg`;
      if (!primary || genPath !== primary.replace(/^\//, '')) {
        const blob = await downloadOwnedStorageBlob(genPath, dlOpts);
        if (blob) return { blob, path: genPath };
      }
    }
    return null;
  }

  function refreshCardGridImages(cardId) {
    const id = String(cardId || '');
    if (!id) return;
    const roots = [
      document.getElementById('cardsContainer'),
      document.getElementById('imageGenFeed')
    ].filter(Boolean);
    for (const root of roots) {
      root.querySelectorAll('img[data-image-ref]').forEach((img) => {
        const cid = img.dataset?.sourceCardId
          || img.closest('.card[data-id]')?.dataset?.id
          || img.closest('.imagegen-feed-card[data-feed-id]')?.dataset?.feedId?.replace(/^wh_/, '');
        if (cid !== id) return;
        const ref = img.getAttribute('data-image-ref');
        if (!ref) return;
        const url = getCachedDisplayUrl(ref, { assetId: id, variant: VARIANT_GRID });
        if (url && window.CardImageLoader?.applyUrlToImg) {
          window.CardImageLoader.applyUrlToImg(img, url);
          return;
        }
        void resolveDisplayUrl(ref, {
          assetId: id,
          variant: VARIANT_GRID,
          listOnly: true,
          allowFullFallback: false,
          degradedListFull: false
        }).then((u) => {
          if (u && window.CardImageLoader?.applyUrlToImg) window.CardImageLoader.applyUrlToImg(img, u);
        });
      });
    }
  }

  /** 生图卡：经 warehouse-thumbs 确保 _grid（禁止再走 resolveDisplayUrl，避免递归） */
  async function warmGeneratedGridThumb(card) {
    const cardId = card?.id ? String(card.id) : '';
    if (!cardId || warmGenThumbInflight.has(cardId)) return;
    warmGenThumbInflight.add(cardId);
    try {
      if (window.WarehouseThumb?.resolveForCardModel) {
        await window.WarehouseThumb.resolveForCardModel(card);
        return;
      }
      const path = primaryImagePath(card?.image, cardId);
      if (!path || !storagePathOwnedByCurrentUser(path)) return;
      if (!String(path).replace(/^\//, '').includes('/generated/')) return;
      const jobId = card?.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : null;
      if (jobId && window.WarehouseThumb?.resolveForCard) {
        await window.WarehouseThumb.resolveForCard(card.image, { jobId, assetId: cardId, cardId });
      }
    } finally {
      warmGenThumbInflight.delete(cardId);
    }
  }

  function queueGridBackfill(card, opts) {
    if (!AUTO_GRID_BACKFILL) return;
    if (!card?.id || !card?.image || !isLoggedIn()) return;
    const cardKey = String(card.id);
    const force = opts?.force === true;
    const path = primaryImagePath(card.image, card.id);
    if (!path || !storagePathOwnedByCurrentUser(path)) return;
    if (String(path).replace(/^\//, '').includes('/generated/')) {
      if (!force && !queueGridBackfillInflight.has(cardKey)) {
        queueGridBackfillInflight.add(cardKey);
        void warmGeneratedGridThumb(card).finally(() => {
          queueGridBackfillInflight.delete(cardKey);
        });
      }
      return;
    }
    if (force && isGridBackfillSkipped(card.id)) clearGridBackfillSkipped(card.id);
    if (!force && gridBackfillSessionCount >= GRID_BACKFILL_SESSION_CAP) return;
    if (!force && isGridBackfillSkipped(card.id)) return;
    if (!force && isGridThumbReady(card.id)) return;
    const grid = gridPathFromPrimary(path);
    if (!grid) return;
    const key = String(card.id);
    if (gridBackfillQueue.some((c) => String(c.id) === key)) return;
    gridBackfillQueue.push(card);
    void drainGridBackfillQueue();
  }

  function invalidateCorruptGrid(gridKey, cardId) {
    const key = normalizePathKey(gridKey);
    if (!key) return;
    markGridFetchFailed(key);
    markPathMissing(key);
    if (cardId) unmarkGridThumbReady(cardId);
  }

  function isValidGridBlob(blob) {
    const n = blob?.size || 0;
    return n >= GRID_MIN_VALID_BYTES && n <= GRID_MAX_VALID_BYTES;
  }

  function isValidImageBlob(blob, opts) {
    const min = opts?.grid ? GRID_MIN_VALID_BYTES : MIN_VALID_IMAGE_BYTES;
    return !!(blob && (blob.size || 0) >= min);
  }

  async function verifyMediaUrlReachable(url) {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    if (url.includes('data:image/svg')) return false;
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 9000) : null;
      const res = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-2047' },
        mode: 'cors',
        credentials: 'omit',
        signal: controller?.signal
      });
      if (timer) clearTimeout(timer);
      if (!(res.ok || res.status === 206)) return false;
      const ct = String(res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('json') || ct.includes('html')) return false;
      const buf = await res.arrayBuffer();
      if ((buf.byteLength || 0) < 128) return false;
      const head = new Uint8Array(buf.slice(0, 12));
      const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
      const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
      const webp = head.length >= 12 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
        && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
      return jpeg || png || webp;
    } catch (e) {
      return false;
    }
  }

  async function resolveListGridFallbackUrl(image, opts = {}) {
    if (!image) return '';
    const assetId = opts.assetId || opts.cardId;
    const url = await resolveDisplayUrl(image, {
      assetId,
      authorId: opts.authorId,
      cardId: opts.cardId || assetId,
      variant: VARIANT_GRID,
      listOnly: true,
      allowFullFallback: false,
      bypassSignBudget: true,
      tryAllPaths: true,
      communityFeed: opts.communityFeed === true
    });
    if (url && await verifyMediaUrlReachable(url)) return url;
    return '';
  }

  async function downloadBlobFromSignedPath(pathKey, opts = {}) {
    const key = String(pathKey || '').replace(/^\//, '');
    if (!key) return null;
    const variant = /_grid\.(jpe?g|webp|png)$/i.test(key) ? VARIANT_GRID : VARIANT_FULL;
    let url = await signPathViaApi(key, variant, {
      bypassSignBudget: true,
      cardId: opts.cardId
    });
    if (!url) {
      url = await resolvePathToUrl(key, variant, {
        bypassSignBudget: true,
        listOnly: variant === VARIANT_GRID,
        cardId: opts.cardId
      });
    }
    if (!url) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404 && opts.markMissing !== false) markPathMissing(key);
        return null;
      }
      return await res.blob();
    } catch (e) {
      return null;
    }
  }

  async function downloadOwnedStorageBlob(path, opts = {}) {
    const key = String(path || '').replace(/^\//, '');
    if (!key || !storagePathOwnedByCurrentUser(key)) return null;
    if (!opts.ignoreMissingCache && isPathKnownMissing(key)) return null;
    await ensureSession();
    const isGrid = /_grid\.(jpe?g|webp|png)$/i.test(key);
    const blob = await downloadBlobFromSignedPath(key, opts);
    if (!blob) return null;
    if (!isValidImageBlob(blob, { grid: isGrid })) {
      if (isGrid) {
        const card = findCardForGridPath(key);
        invalidateCorruptGrid(key, card?.id || opts.cardId);
      }
      return null;
    }
    if (isGrid && (blob.size || 0) > GRID_MAX_VALID_BYTES) {
      const card = findCardForGridPath(key);
      invalidateCorruptGrid(key, card?.id || opts.cardId);
      return null;
    }
    return blob;
  }

  async function backfillOneGridThumb(card) {
    const cardId = card?.id;
    const path = primaryImagePath(card?.image, cardId);
    const grid = gridPathFromPrimary(path);
    if (!cardId || !path || !grid || !storagePathOwnedByCurrentUser(path)) {
      if (cardId) markGridBackfillSkipped(cardId, 'invalid_path');
      return { ok: false, skip: true, reason: 'invalid_path' };
    }
    if (String(path).replace(/^\//, '').includes('/generated/')) {
      void warmGeneratedGridThumb(card);
      return { ok: false, skip: true, reason: 'generated_server_grid' };
    }
    const gridKey = grid.replace(/^\//, '');
    const probeOpts = { ignoreMissingCache: true, markMissing: false };
    if (isGridThumbReady(cardId)) {
      try {
        const existingGrid = await downloadOwnedStorageBlob(grid, probeOpts);
        if (existingGrid && isValidGridBlob(existingGrid)) {
          missingPathCache.delete(normalizePathKey(grid));
          void batchSignPaths([gridKey], VARIANT_GRID).then(() => refreshCardGridImages(cardId));
          return { ok: true, skip: true };
        }
        unmarkGridThumbReady(cardId);
        invalidateCorruptGrid(gridKey, cardId);
      } catch (e) {
        unmarkGridThumbReady(cardId);
        invalidateCorruptGrid(gridKey, cardId);
      }
    }
    const cached = signedUrlCache.get(signedCacheKey(gridKey, VARIANT_GRID));
    if (cached?.url && cached.expiresAt > Date.now() + 120000) {
      try {
        const probeCached = await downloadOwnedStorageBlob(grid, probeOpts);
        if (probeCached && isValidGridBlob(probeCached)) {
          markGridThumbReady(cardId);
          return { ok: true, skip: true };
        }
        invalidateSignedCache(gridKey);
        unmarkGridThumbReady(cardId);
      } catch (e) {
        invalidateSignedCache(gridKey);
        unmarkGridThumbReady(cardId);
      }
    }
    try {
      const existingGrid = await downloadOwnedStorageBlob(grid, probeOpts);
      if (existingGrid && isValidGridBlob(existingGrid)) {
        markGridThumbReady(cardId);
        missingPathCache.delete(normalizePathKey(grid));
        void batchSignPaths([gridKey], VARIANT_GRID).then(() => refreshCardGridImages(cardId));
        return { ok: true, skip: true };
      }
    } catch (e) { /* need backfill */ }
    let source = null;
    if (typeof window.getCardImageBackup === 'function') {
      try {
        const backup = await window.getCardImageBackup(cardId);
        if (backup && (String(backup).startsWith('data:') || String(backup).startsWith('blob:'))) {
          source = backup;
        }
      } catch (e) { /* ignore */ }
    }
    if (!source) {
      try {
        const found = await downloadOriginalForBackfill(card);
        if (found?.blob) source = found.blob;
      } catch (e) { /* ignore */ }
    }
    if (!source) {
      markGridBackfillSkipped(cardId, 'no_original');
      return { ok: false, skip: true, reason: 'no_original' };
    }
    try {
      const gridBlob = await compressImageToGrid(source);
      if (!isValidGridBlob(gridBlob) || !(await blobLooksLikeUsableImage(gridBlob))) {
        markGridBackfillSkipped(cardId, 'grid_too_small');
        return { ok: false, skip: true, reason: 'grid_too_small' };
      }
      await uploadStorageBlob(grid, gridBlob, { skipVerify: true });
      clearSignedCacheForPaths([grid, path]);
      missingPathCache.delete(normalizePathKey(grid));
      markGridThumbReady(cardId);
      gridBackfillSessionCount += 1;
      void batchSignPaths([gridKey], VARIANT_GRID).then(() => {
        refreshCardGridImages(cardId);
      });
      return { ok: true };
    } catch (e) {
      console.warn('[SupabaseSync] grid backfill failed', cardId, e);
      return { ok: false };
    }
  }

  async function drainGridBackfillQueue() {
    if (gridBackfillRunning || !gridBackfillQueue.length) return;
    gridBackfillRunning = true;
    try {
      while (gridBackfillQueue.length) {
        const batch = gridBackfillQueue.splice(0, 1);
        await Promise.all(batch.map((c) => backfillOneGridThumb(c)));
        await new Promise((r) => setTimeout(r, 280));
      }
    } finally {
      gridBackfillRunning = false;
    }
  }

  async function diagnoseGridBackfillPending(cards, opts = {}) {
    const max = Math.min(Math.max(1, Number(opts.max) || 24), 120);
    const all = (cards || []).filter((c) => c?.id && c?.image && isStorageRef(c.image));
    const pending = all.filter((c) => !isGridThumbReady(c.id) && !isGridBackfillSkipped(c.id));
    const skipped = all.filter((c) => isGridBackfillSkipped(c.id));
    const sample = [];
    const probeOpts = { ignoreMissingCache: true, markMissing: false };
    for (const c of pending.slice(0, max)) {
      const path = primaryImagePath(c.image, c.id);
      const grid = gridPathFromPrimary(path);
      let gridOk = false;
      let originalOk = false;
      let backupOk = false;
      try {
        const g = grid ? await downloadOwnedStorageBlob(grid, probeOpts) : null;
        gridOk = !!(g && isValidGridBlob(g));
      } catch (e) { /* ignore */ }
      try {
        const o = await downloadOriginalForBackfill(c);
        originalOk = !!o?.blob;
      } catch (e) { /* ignore */ }
      if (typeof window.getCardImageBackup === 'function') {
        try {
          const backup = await window.getCardImageBackup(c.id);
          backupOk = !!(backup && (String(backup).startsWith('data:') || String(backup).startsWith('blob:')));
        } catch (e) { /* ignore */ }
      }
      sample.push({
        id: c.id,
        path,
        grid,
        gridOk,
        originalOk,
        backupOk,
        canBackfill: gridOk || originalOk || backupOk
      });
    }
    return {
      total: all.length,
      done: all.filter((c) => isGridThumbReady(c.id)).length,
      skipped: skipped.length,
      pending: pending.length,
      sampleCanBackfill: sample.filter((s) => s.canBackfill).length,
      sampleGhost: sample.filter((s) => !s.canBackfill).length,
      sample
    };
  }

  async function backfillGridThumbsForCards(cards, opts = {}) {
    if (!isLoggedIn()) return { done: 0, queued: 0, pending: 0, skipped: 0 };
    if (opts.quiet !== false && opts.awaitDrain) window.CardImageLoader?.disconnect?.();
    const force = opts.force === true;
    const max = Math.min(Math.max(1, Number(opts.max) || 24), force ? 80 : 48);
    const all = (cards || []).filter((c) => c?.id && c?.image && isStorageRef(c.image));
    const pendingBefore = force
      ? all.filter((c) => !isGridThumbReady(c.id))
      : all.filter((c) => !isGridThumbReady(c.id) && !isGridBackfillSkipped(c.id));
    const list = pendingBefore.slice(0, max);
    for (const c of list) {
      if (force && isGridBackfillSkipped(c.id)) clearGridBackfillSkipped(c.id);
      queueGridBackfill(c, { force });
    }
    if (opts.awaitDrain) {
      while (gridBackfillRunning || gridBackfillQueue.length) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    const pendingAfter = all.filter((c) => !isGridThumbReady(c.id) && !isGridBackfillSkipped(c.id));
    const skipped = all.filter((c) => isGridBackfillSkipped(c.id)).length;
    return {
      done: all.filter((c) => isGridThumbReady(c.id)).length,
      queued: list.length,
      pending: pendingAfter.length,
      skipped,
      total: all.length,
      finished: pendingAfter.length < pendingBefore.length || skipped > 0
    };
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
    const variant = displayVariantFromOpts(opts);
    let fileKey = path.replace(/^\//, '');
    if (variant === VARIANT_GRID && !/_grid\.(jpe?g|webp|png)$/i.test(fileKey)) {
      const grid = gridPathFromPrimary(fileKey);
      if (grid && !isPathKnownMissing(grid.replace(/^\//, ''))) fileKey = grid.replace(/^\//, '');
    }
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
        if (variant === VARIANT_GRID) {
          if (/_grid\.(jpe?g|webp|png)$/i.test(fileKey)) {
            markPathMissing(fileKey);
          } else {
            const expectedGrid = gridPathFromPrimary(fileKey);
            if (expectedGrid) markPathMissing(expectedGrid);
          }
          return null;
        }
        markPathMissing(fileKey);
        return null;
      }
      if (variant === VARIANT_GRID) {
        return null;
      }
      throw e;
    }
  }

  function isLegacyOffshoreStorageImage(image) {
    if (!image || typeof image !== 'string') return false;
    if (isStorageRef(image)) return true;
    return /supabase\.co\/storage\/v1\/object/i.test(image);
  }

  function cardImageStillResolvable(image, assetId) {
    if (!image || typeof image !== 'string') return false;
    if (isDataUrl(image) || image.startsWith('blob:')) return true;
    if (/^https?:\/\//i.test(image)) {
      if (/supabase\.co\/storage\/v1\/object/i.test(image)) {
        const path = storagePathFromRef(image);
        if (!path) return false;
        const candidates = listImagePathCandidates(normalizeImageRef(toStorageRef(path)), assetId);
        if (!candidates.length) return false;
        return candidates.some((p) => !isPathKnownMissing(p));
      }
      return !isInvalidMediaUrl(image);
    }
    if (!isStorageRef(image)) return true;
    const candidates = listImagePathCandidates(normalizeImageRef(image), assetId);
    if (!candidates.length) return true;
    return candidates.some((p) => !isPathKnownMissing(p));
  }

  function isLegacyImageRestorePhase() {
    return Date.now() < LEGACY_IMAGE_RESTORE_UNTIL_MS;
  }

  function isLegacyStoredCardImage(card) {
    if (!card || !isLegacyImageRestorePhase()) return false;
    const image = card.image;
    if (!image || typeof image !== 'string') return false;
    if (/supabase\.co\/storage\/v1\/object/i.test(image)) return true;
    if (!isStorageRef(image)) return false;
    const created = Number(card.createdAt) || 0;
    return created > 0 && created < LEGACY_STORAGE_HIDE_BEFORE_MS;
  }

  /** 卡片库是否展示（过渡期隐藏旧 Supabase storage 无图卡，不删库） */
  function shouldShowCardInWarehouse(card) {
    if (!card) return false;
    if (isLegacyStoredCardImage(card)) return false;
    const image = card.image;
    if (!image || typeof image !== 'string') return true;
    if (isDataUrl(image) || image.startsWith('blob:')) return true;
    if (!isLegacyImageRestorePhase()) return true;
    /** 境外 Supabase 直链：egress 已断，6/25 前直接不展示 */
    if (/supabase\.co\/storage\/v1\/object/i.test(image)) return false;
    if (!isLegacyOffshoreStorageImage(image)) return true;
    return cardImageStillResolvable(image, card.id);
  }

  /** 社区 Feed 是否展示（与卡片库同一套旧图隐藏规则） */
  function shouldShowPostInCommunityFeed(post) {
    if (!post) return false;
    if (post.sourceCardId) {
      const cards = window.__promptHubCards;
      if (Array.isArray(cards)) {
        const card = cards.find((c) => String(c.id) === String(post.sourceCardId));
        if (card && shouldShowCardInWarehouse(card) === false) return false;
      }
    }
    const image = post.image;
    if (!image || typeof image !== 'string') return true;
    return shouldShowCardInWarehouse({
      id: post.sourceCardId || post.id,
      image: post.image,
      createdAt: post.createdAt
    }) !== false;
  }

  function cardImageStoragePath(cardId, ownerId, ext) {
    const uid = ownerId || getUserId();
    if (!uid || !cardId) return null;
    const base = String(cardId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeExt = String(ext || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
    return `${uid}/${base}.${safeExt}`;
  }

  /** 从 storage 路径提取 UUID（legacy card_* id 与 generated/uuid 不一致时用） */
  function storageAssetIdFromPath(path, fallbackId) {
    const key = String(path || '').replace(/^\//, '');
    const m = key.match(/\/generated\/([0-9a-f-]{36})\./i)
      || key.match(/\/([0-9a-f-]{36})(?:_grid)?\./i);
    if (m) return m[1];
    return fallbackId;
  }

  function signCardIdForPath(path, fallbackId) {
    const fb = String(fallbackId || '');
    if (/^card_\d/i.test(fb)) {
      return storageAssetIdFromPath(path, fb) || fb;
    }
    return fb || storageAssetIdFromPath(path, fb);
  }

  function extFromImageMime(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('png')) return 'png';
    if (m.includes('webp')) return 'webp';
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
    return 'jpg';
  }

  function preserveOriginalCardImageFromSettings() {
    try {
      const raw = localStorage.getItem('promptrepo_settings');
      if (!raw) return false;
      const s = JSON.parse(raw);
      return s.preserveOriginalCardImage === true;
    } catch (e) {
      return false;
    }
  }

  function cardUploadOriginalEnabled() {
    if (typeof window.__cardUploadOriginal === 'boolean') return window.__cardUploadOriginal;
    return preserveOriginalCardImageFromSettings();
  }

  function preserveOriginalCardImageEnabled() {
    return cardUploadOriginalEnabled();
  }

  async function sourceToBlob(source) {
    if (source instanceof Blob) return source;
    if (typeof source === 'string') {
      if (isDataUrl(source) || source.startsWith('blob:')) {
        const res = await fetch(source);
        if (!res.ok) throw new Error('无法读取图片');
        return res.blob();
      }
      if (/^https?:\/\//i.test(source)) {
        return fetchRemoteImageBlob(source);
      }
    }
    throw new Error('不支持的图片格式');
  }

  /** 跨域生图 URL 经 Worker 代理拉 blob，避免 canvas 污染导致 toBlob 失败 */
  async function fetchRemoteImageBlob(url, opts = {}) {
    const raw = String(url || '').trim();
    if (!raw) throw new Error('远程图片地址无效');
    if (opts.allowRemoteArchive !== true && isEphemeralUpstreamImageUrl(raw)) {
      throw new Error('临时生图链禁止浏览器拉原图，请用服务端归档');
    }
    const timeoutMs = 12000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (window.PromptHubApi?.fetchMediaAsBlobUrl) {
        const tmp = await window.PromptHubApi.fetchMediaAsBlobUrl(raw);
        if (tmp) {
          try {
            const res = await fetch(tmp, { signal: controller.signal });
            if (res.ok) return await res.blob();
          } finally {
            try { URL.revokeObjectURL(tmp); } catch (e) { /* ignore */ }
          }
        }
      }
      try {
        const res = await fetch(raw, { mode: 'cors', credentials: 'omit', signal: controller.signal });
        if (res.ok) return await res.blob();
      } catch (e) { /* fall through */ }
    } finally {
      clearTimeout(timer);
    }
    throw new Error('远程图片下载失败，请换一张本地图片重试');
  }

  async function coerceImageUploadSource(source) {
    if (source instanceof Blob) return source;
    if (typeof source === 'string' && /^https?:\/\//i.test(source)) {
      return fetchRemoteImageBlob(source);
    }
    return source;
  }

  function isGridStoragePath(path) {
    return /_grid\.(jpe?g|webp|png)$/i.test(String(path || '').replace(/^\//, ''));
  }

  function isGridDisplayUrl(url) {
    const p = storagePathFromDisplayUrl(url);
    return !!(p && isGridStoragePath(p));
  }

  /** 列表区 img.src：禁止自有卡/生图 feed 写入 full 原图 URL */
  function safeListImgUrl(url, img) {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return '';
    if (url.includes('data:image/svg') || isInvalidMediaUrl(url)) return '';
    const inList = img?.closest?.('#cardsContainer, #imageGenFeed');
    if (inList && !isGridDisplayUrl(url)) return '';
    if (isWarehouseBlockedFullUrl(url, img)) return '';
    return url;
  }

  function filterGridVariantUrl(url, variant) {
    if (!url || variant !== VARIANT_GRID) return url || '';
    if (!isValidSignedDisplayUrl(url) || isInvalidMediaUrl(url)) return '';
    return isGridDisplayUrl(url) ? url : '';
  }

  /** 插件/旧版上传：card_{timestamp}_{rand}.jpg，常无对应 _grid */
  function isLegacyUploadCardPath(pathKey) {
    return /\/card_\d{10,}_[a-z0-9]+\.(jpe?g|webp|png)$/i.test(String(pathKey || '').replace(/^\//, ''));
  }

  function storagePathFromCdnUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const m = url.match(/\/api\/v1\/media\/[ci]\/([^?]+)/i);
    if (!m) return null;
    try {
      let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes).replace(/^\//, '');
    } catch (e) {
      return null;
    }
  }

  function storagePathFromDisplayUrl(url) {
    const cdn = storagePathFromCdnUrl(url);
    if (cdn) return cdn;
    try {
      const u = new URL(url);
      const m = (u.pathname || '').match(
        /\/storage\/v1\/object\/(?:sign|public|authenticated)\/card-images\/(.+)$/i
      );
      if (m) return decodeURIComponent(m[1]).replace(/^\/+/, '');
    } catch (e) { /* ignore */ }
    return null;
  }

  /** 列表区默认只显示 grid；最近生成（cr_）与生图入库卡 grid 未就绪时允许 full 缩略 */
  function isWarehouseBlockedFullUrl(url, img) {
    const listRoot = img?.closest?.('#cardsContainer, #imageGenFeed, #communityGrid, #creationsGrid, #userProfileGrid');
    if (!listRoot) return false;
    const feedId = img?.closest?.('.imagegen-feed-card[data-feed-id]')?.dataset?.feedId || '';
    if (feedId.startsWith('cr_')) return false;
    if (isEphemeralUpstreamImageUrl(url)) return true;
    const path = storagePathFromDisplayUrl(url);
    if (!path || isGridStoragePath(path)) return false;
    if (!/\.(jpe?g|webp|png|gif)$/i.test(path)) return false;
    if (img?.dataset?.listPrimaryRetried === '1') return false;
    const cardId = img?.dataset?.sourceCardId
      || img?.closest?.('.card[data-id]')?.dataset?.id
      || img?.closest?.('.imagegen-feed-card[data-feed-id^="wh_"]')?.dataset?.feedId?.replace(/^wh_/, '')
      || undefined;
    const ref = img?.getAttribute?.('data-image-ref');
    if (cardId && ref && (listRoot.id === 'cardsContainer' || listRoot.id === 'imageGenFeed')) {
      const primary = primaryImagePath(ref, cardId);
      if (primary) {
        const pk = String(primary).replace(/^\//, '');
        /* 自有生图卡：grid 未签好时允许 full，避免卡片库整片灰块 */
        if (pk.includes('/generated/')) {
          const card = (window.__promptHubCards || []).find((c) => c.id === cardId);
          if (card?.genJobId) return false;
          return true;
        }
        if (!gridListNeedsPrimaryFallback(primary, cardId)) return true;
      }
      if (primary && gridListNeedsPrimaryFallback(primary, cardId)) return false;
    }
    return true;
  }

  function needsDegradedListPreview(image, cardId) {
    const primary = primaryImagePath(image, cardId);
    return !!(primary && gridListNeedsPrimaryFallback(primary, cardId));
  }

  /** 社区列表 prefetch / DOM：优先 grid 路径 ref */
  function communityListGridRef(image, assetId) {
    if (!image) return null;
    const primary = primaryImagePath(image, assetId);
    if (!primary) return null;
    const grid = gridPathFromPrimary(primary.replace(/^\//, ''));
    return grid ? toStorageRef(grid) : null;
  }

  function clearSignedCacheForPaths(paths) {
    for (const raw of paths || []) {
      const key = String(raw || '').replace(/^\//, '');
      if (!key) continue;
      signedUrlCache.delete(signedCacheKey(key, VARIANT_GRID));
      signedUrlCache.delete(signedCacheKey(key, VARIANT_FULL));
    }
  }

  async function encodeFullResolutionJpeg(source, quality) {
    const normalized = await coerceImageUploadSource(source);
    const img = await loadImageFromSource(normalized);
    if (typeof source !== 'string' && source instanceof Blob) {
      try { URL.revokeObjectURL(img.src); } catch (e) { /* ignore */ }
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error('图片尺寸无效');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('JPEG 编码失败'))),
        'image/jpeg',
        quality
      );
    });
  }

  function isStorageSizeError(err) {
    const msg = String(err?.message || err?.error || err || '').toLowerCase();
    return /maximum allowed size|entity too large|payload too large|413/.test(msg);
  }

  async function fitBlobToStorageLimit(source, blob) {
    const limit = STORAGE_BUCKET_LIMIT_BYTES;
    if (!blob || blob.size <= limit) {
      return { blob, mode: 'raw' };
    }
    let quality = 0.95;
    let jpeg = await encodeFullResolutionJpeg(source, quality);
    while (jpeg.size > limit && quality > 0.72) {
      quality -= 0.04;
      jpeg = await encodeFullResolutionJpeg(source, quality);
    }
    if (jpeg.size <= limit) {
      return { blob: jpeg, mode: 'full_res_jpeg', quality };
    }
    const mb = (blob.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `图片约 ${mb}MB，超过云存储单文件 50MB 上限；已尝试原尺寸 JPEG 仍超限，请换较小文件。`
    );
  }

  async function prepareCardFullUploadBlob(source, opts = {}) {
    const original = opts.original != null ? !!opts.original : cardUploadOriginalEnabled();
    if (original) {
      const blob = await sourceToBlob(source);
      if (!blob.type || !blob.type.startsWith('image/')) {
        throw new Error('请选择有效的图片文件');
      }
      if (blob.size > CARD_ORIGINAL_MAX_BYTES) {
        const mb = (blob.size / (1024 * 1024)).toFixed(1);
        const cap = Math.round(CARD_ORIGINAL_MAX_BYTES / (1024 * 1024));
        throw new Error(`原图约 ${mb}MB，超过 ${cap}MB 上限。可关闭「保存原图」后自动压缩，或换较小文件`);
      }
      const fitted = await fitBlobToStorageLimit(source, blob);
      fitted.blob.__uploadEncodeMode = fitted.mode;
      if (fitted.mode === 'full_res_jpeg') {
        fitted.blob.__uploadJpegQuality = fitted.quality;
      }
      return fitted.blob;
    }
    return compressImage(source, {
      maxSide: CARD_UPLOAD_MAX_SIDE,
      quality: CARD_UPLOAD_JPEG_QUALITY
    });
  }

  function isGeneratedWarehouseCard(card) {
    if (!card) return false;
    if (card.genJobId) return true;
    return Array.isArray(card.tags) && card.tags.includes('图片生成');
  }

  function expectedMinFullImageBytes(resolution) {
    const r = String(resolution || '1k').toLowerCase();
    /** 4K JPEG 通常 10MB+；低于此多为 card_xxx 压缩副本，应继续找 generated 或触发修复 */
    if (r === '4k') return Math.floor(10 * 1024 * 1024);
    if (r === '2k') return Math.floor(1.2 * 1024 * 1024);
    return Math.floor(80 * 1024);
  }

  function isGeneratedArchivePath(pathOrRef) {
    const path = storagePathFromRef(pathOrRef) || String(pathOrRef || '').replace(/^\//, '');
    return /\/generated\/[^/]+\.(jpe?g|png|webp)$/i.test(path);
  }

  /** 生图多图槽位：jobId#2 → uuid-2，避免各槽位覆盖同一路径 */
  function generationStorageAssetId(jobId, fallbackAssetId) {
    if (jobId) return String(jobId).replace(/#/g, '-');
    return String(fallbackAssetId || Date.now());
  }

  /** 生图 storage 路径：保留 #N 槽位（MJ 多图） */
  function resolveStorageJobIdForAsset(opts, assetId) {
    const raw = opts?.jobId || opts?.genJobId || null;
    if (raw) return String(raw);
    const id = assetId || opts?.cardId;
    if (!id) return null;
    const card = (window.__promptHubCards || []).find((c) => c.id === id);
    if (card) {
      const thumb = window.PromptHubCardGallery?.pickWarehouseListThumb?.(card);
      if (thumb?.slotJobId) return String(thumb.slotJobId);
    }
    if (card?.genJobId) return String(card.genJobId);
    if (window.PromptHubCardGallery?.resolveGenJobIdFromCard) {
      return window.PromptHubCardGallery.resolveGenJobIdFromCard(card);
    }
    return null;
  }

  /** 列表/预览签名：opts 或卡片 genJobId → 生图 storage 路径 */
  function resolveJobIdForAsset(opts, assetId) {
    const full = resolveStorageJobIdForAsset(opts, assetId);
    if (full) return String(full).replace(/#\d+$/, '');
    return null;
  }

  function listImagePathCandidates(image, assetId, ownerId, jobId) {
    const paths = [];
    const add = (p) => {
      const key = (p || '').replace(/^\//, '');
      if (key && !paths.includes(key)) paths.push(key);
    };
    const uid = ownerId || getUserId();
    const genJobKey = jobId ? generationStorageAssetId(jobId, '') : '';
    if (uid && genJobKey) {
      add(`${uid}/generated/${genJobKey}.jpg`);
      add(`${uid}/generated/${genJobKey}.png`);
      add(`${uid}/generated/${genJobKey}.webp`);
    }
    add(storagePathFromRef(image));
    const canonical = cardImageStoragePath(assetId, ownerId);
    if (canonical) add(canonical);
    if (uid && assetId) {
      const base = String(assetId).replace(/[^a-zA-Z0-9_-]/g, '_');
      add(`${uid}/${base}.jpg`);
      add(`${uid}/${assetId}.jpg`);
      add(`${uid}/${base}.webp`);
      add(`${uid}/${base}.png`);
      add(`${uid}/generated/${base}.jpg`);
      add(`${uid}/generated/${assetId}.jpg`);
      const stripped = String(assetId).replace(/^wh_/, '');
      if (stripped !== String(assetId)) {
        add(`${uid}/${stripped}.jpg`);
        add(`${uid}/generated/${stripped}.jpg`);
      }
    }
    return paths;
  }

  async function signPathViaCommunityApi(path, variant, signOpts = {}) {
    if (!window.PromptHubApi?.isConfigured?.() || !window.PromptHubApi.signCommunityMediaRef) return null;
    const fileKey = String(path || '').replace(/^\//, '');
    const ownPath = storagePathOwnedByCurrentUser(fileKey);
    if (!ownPath && isPathKnownMissing(fileKey)) {
      /* 他人社区图：不因本地 missing 缓存放弃签名（CDN 可现场生成 grid） */
    } else if (isPathKnownMissing(fileKey)) {
      return null;
    }
    /* 自有路径不走 community/sign（card_* 与 generated/uuid 会 404） */
    if (storagePathOwnedByCurrentUser(fileKey)) {
      return signPathViaApi(path, variant, {
        ...signOpts,
        cardId: signCardIdForPath(fileKey, signOpts?.cardId || signOpts?.assetId),
        bypassSignBudget: true
      });
    }
    const v = variant || VARIANT_GRID;
    const inflightKey = `community:${fileKey}:${v}:${signOpts.authorId || ''}:${signOpts.cardId || ''}`;
    if (signInflight.has(inflightKey)) return signInflight.get(inflightKey);
    const apiPathKey = (() => {
      if (/_grid\.(jpe?g|webp|png)$/i.test(fileKey)) {
        return fileKey.replace(/_grid\.(jpe?g|webp|png)$/i, '.jpg');
      }
      return fileKey;
    })();
    const task = (async () => {
      try {
        const r = await window.PromptHubApi.signCommunityMediaRef(toStorageRef(apiPathKey), {
          variant: v === VARIANT_FULL ? 'full' : 'grid',
          authorId: signOpts.authorId,
          cardId: signOpts.cardId
        });
        if (r.ok && r.data?.url && !isIncompleteSignedStorageUrl(r.data.url)) {
          const url = r.data.url;
          const cdnPath = storagePathFromDisplayUrl(url);
          if (v === VARIANT_GRID && cdnPath && !isGridStoragePath(cdnPath)) {
            return null;
          }
          if (v === VARIANT_GRID && !cdnPath && !isCdnMediaUrl(url)) {
            return null;
          }
          const ttlSec = Math.max(3600, Number(r.data.expiresIn) || SIGNED_TTL_SEC) - 120;
          const cacheKeys = new Set([fileKey]);
          if (/_grid\.(jpe?g|webp|png)$/i.test(fileKey)) {
            const stem = fileKey.replace(/_grid\.(jpe?g|webp|png)$/i, '');
            ['.jpg', '.jpeg', '.webp', '.png'].forEach((ext) => cacheKeys.add(`${stem}${ext}`));
          } else {
            const grid = gridPathFromPrimary(fileKey);
            if (grid) cacheKeys.add(grid.replace(/^\//, ''));
          }
          for (const ck of cacheKeys) {
            signedUrlCache.set(signedCacheKey(ck, v), {
              url,
              expiresAt: Date.now() + ttlSec * 1000
            });
          }
          return url;
        }
        if (r?.status === 404 || r?.code === 'NOT_FOUND') {
          const missKey = apiPathKey.replace(/^\//, '');
          if (storagePathOwnedByCurrentUser(fileKey)) {
            invalidateSignedCache(fileKey);
          } else if (missKey) {
            markPathMissing(missKey);
          } else if (/_grid\.(jpe?g|webp|png)$/i.test(fileKey) && storagePathOwnedByCurrentUser(fileKey)) {
            markGridFetchFailed(fileKey);
          }
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

  function resetMediaSignEnvironment(opts) {
    try { window.__PH_API_DOWN_UNTIL__ = 0; } catch (e) { /* ignore */ }
    try { window.__PH_AUTH_SIGN_PAUSE_UNTIL__ = 0; } catch (e) { /* ignore */ }
    try { window.__PH_API_RATE_LIMITED_UNTIL__ = 0; } catch (e) { /* ignore */ }
    gridFetchFailedPaths.clear();
    signBudgetUsed = 0;
    signBudgetResetAt = 0;
    if (opts?.clearMissing !== false) {
      missingPathCache.clear();
      try { localStorage.removeItem(LS_MISSING_PATHS); } catch (e) { /* ignore */ }
    }
    persistSessionSignCache();
  }

  function apiSignAllowed(opts) {
    if (window.__PH_AUTH_SIGN_PAUSE_UNTIL__ && Date.now() < window.__PH_AUTH_SIGN_PAUSE_UNTIL__) return false;
    if (window.PromptHubApi?.isApiRateLimited?.()) return false;
    if (isLoggedIn() && !isCommunityFeedOpts(opts)) {
      return !!(window.PromptHubApi?.isConfigured?.() && window.PromptHubApi.signMediaRef);
    }
    return !!(window.PromptHubApi?.isConfigured?.() && window.PromptHubApi.signMediaRef);
  }

  async function signPathViaApi(path, variant, opts) {
    if (!storagePathOwnedByCurrentUser(path)) return null;
    if (!apiSignAllowed(opts)) return null;
    const bypassBudget = opts?.bypassSignBudget === true;
    if (!bypassBudget && !signBudgetAvailable()) return null;
    const v = variant || VARIANT_GRID;
    let fileKey = String(path || '').replace(/^\//, '');
    if (v === VARIANT_GRID && !/_grid\.(jpe?g|webp|png)$/i.test(fileKey)) {
      const grid = gridPathFromPrimary(fileKey);
      const gridKey = grid ? grid.replace(/^\//, '') : '';
      if (gridKey && shouldSignGridPath(gridKey, opts?.cardId || opts?.assetId)) {
        fileKey = gridKey;
      } else if (v === VARIANT_GRID) {
        return null;
      }
    }
    if (v === VARIANT_GRID && !shouldSignGridPath(fileKey, opts?.cardId || opts?.assetId)) {
      if (!(opts?.bypassSignBudget === true && storagePathOwnedByCurrentUser(fileKey))) {
        return null;
      }
    }
    const inflightKey = `api:${fileKey}:${v}`;
    if (signInflight.has(inflightKey)) return signInflight.get(inflightKey);
    const task = (async () => {
      try {
        let r = await window.PromptHubApi.signMediaRef(toStorageRef(fileKey), { variant: v });
        if (!r?.ok && (r?.status === 401 || r?.code === 'UNAUTHORIZED')) {
          await healSessionOnResume();
          r = await window.PromptHubApi.signMediaRef(toStorageRef(fileKey), { variant: v });
        }
        if (r.ok && r.data?.url && !isIncompleteSignedStorageUrl(r.data.url)
          && mediaUrlMatchesCurrentApi(r.data.url)) {
          consumeSignBudget(1);
          const ttlSec = Math.max(3600, Number(r.data.expiresIn) || SIGNED_TTL_SEC) - 120;
          signedUrlCache.set(signedCacheKey(fileKey, v), {
            url: r.data.url,
            expiresAt: Date.now() + ttlSec * 1000
          });
          return r.data.url;
        }
        if (r?.status === 404 || r?.code === 'NOT_FOUND') {
          if (/_grid\.(jpe?g|webp|png)$/i.test(fileKey)) markGridFetchFailed(fileKey);
          else invalidateSignedCache(fileKey);
        } else if (r?.status === 429 || r?.code === 'RATE_LIMITED') {
          window.PromptHubApi?.markApiRateLimited?.(90000);
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
    if (!path || !url || isInvalidMediaUrl(url)) return;
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
      if (v === VARIANT_GRID && !shouldSignGridPath(p)) return false;
      if (!storagePathOwnedByCurrentUser(p)) return false;
      const cached = signedUrlCache.get(signedCacheKey(p, v));
      return !(cached?.url && cached.expiresAt > Date.now() + 120000);
    });
    if (!pending.length) return 0;
    if (!signBudgetAvailable()) {
      signBudgetUsed = 0;
      signBudgetResetAt = 0;
    }
    if (!window.PromptHubApi?.signMediaRefsBatch) return 0;
    await ensureSession();
    try {
      const refs = pending.map((p) => toStorageRef(p));
      let r = await window.PromptHubApi.signMediaRefsBatch(refs, { timeoutMs: 8000 });
      if (!r?.ok && (r?.status === 401 || r?.code === 'UNAUTHORIZED')) {
        await healSessionOnResume();
        r = await window.PromptHubApi.signMediaRefsBatch(refs, { timeoutMs: 8000 });
      }
      if (!r?.ok || !r.data?.urls) return 0;
      let n = 0;
      for (const [path, url] of Object.entries(r.data.urls)) {
        if (!url || isIncompleteSignedStorageUrl(url)) continue;
        cacheSignedPath(path, url, v);
        n += 1;
      }
      if (n) {
        consumeSignBudget(n);
        persistSessionSignCache();
        try {
          window.PromptHubMedia?.ingestSignedBatch?.(r.data.urls, v);
        } catch (_) { /* ignore */ }
      }
      return n;
    } catch (e) {
      console.warn('[SupabaseSync] batch sign failed', e);
      return 0;
    }
  }

  async function resolvePathToUrl(path, variant, opts) {
    const fileKey = String(path || '').replace(/^\//, '');
    const v = variant || VARIANT_GRID;
    const listOnly = opts?.listOnly === true;
    const communityFeed = opts?.communityFeed === true;
    const ownPath = storagePathOwnedByCurrentUser(fileKey);
    if (isPathKnownMissing(fileKey) && !(communityFeed && !ownPath)) return null;
    const signMeta = {
      authorId: opts?.authorId,
      cardId: opts?.cardId
    };
    if (communityFeed && !storagePathOwnedByCurrentUser(fileKey)) {
      const publicUrl = await signPathViaCommunityApi(path, v, signMeta);
      if (publicUrl) return publicUrl;
      if (!isLoggedIn()) return null;
    }
    if (isLoggedIn() && storagePathOwnedByCurrentUser(path)) {
      const signOpts = {
        ...opts,
        cardId: signCardIdForPath(fileKey, opts?.cardId || opts?.assetId)
      };
      if (apiSignAllowed(signOpts)) {
        const bypassBudget = listOnly || v === VARIANT_FULL || signOpts.bypassSignBudget === true;
        const apiUrl = await signPathViaApi(path, v, {
          ...signOpts,
          bypassSignBudget: bypassBudget
        });
        if (apiUrl) return apiUrl;
      }
      if (listOnly) {
        const cachedOnly = signedUrlCache.get(signedCacheKey(fileKey, v));
        if (cachedOnly?.url && cachedOnly.expiresAt > Date.now() + 120000) return cachedOnly.url;
        return null;
      }
      if (!listOnly) {
        if (USE_DIRECT_SUPABASE_SIGN) {
          try {
            const ownUrl = await getSignedUrlForPath(path, { variant: v });
            if (ownUrl) return ownUrl;
          } catch (e) {
            if (!isStorageNotFoundError(e) && String(e?.message || e) !== 'sign_timeout') {
              console.warn('[SupabaseSync] own signed url failed', path, e);
            }
          }
        }
      }
    }
    if (isPathKnownMissing(fileKey)) return null;
    if (communityFeed) return null;
    if (!storagePathOwnedByCurrentUser(path)) return null;
    if (!apiSignAllowed(opts)) return null;
    const bypassBudget = listOnly || v === VARIANT_FULL || opts.bypassSignBudget === true;
    return signPathViaApi(path, v, {
      ...opts,
      cardId: signCardIdForPath(fileKey, opts?.cardId || opts?.assetId),
      bypassSignBudget: bypassBudget
    });
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

  async function repairCardImageIfMissing(cardId, currentRef, opts = {}) {
    if (currentRef && isStorageRef(currentRef)) {
      const ok = await verifyStorageRef(currentRef, cardId, { quick: true, noDownload: true });
      if (ok) return normalizeImageRef(currentRef);
    }
    if (opts.allowStorageList === true) {
      const found = await findCardImageInStorage(cardId);
      if (found && found !== currentRef) return found;
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
    const depth = Number(o._depth) || 0;
    if (depth > 5) return null;
    const nextOpts = (patch) => ({ ...o, ...patch, _depth: depth + 1 });
    const assetId = o.assetId;
    const authorId = o.authorId;
    const jobId = resolveJobIdForAsset(o, assetId);
    const storageJobId = resolveStorageJobIdForAsset(o, assetId) || jobId;
    const variant = displayVariantFromOpts(opts);
    const normalizedEarly = normalizeImageRef(image);
    const bucketPathEarly = storagePathFromRef(normalizedEarly);
    const listOnlyGridEarly =
      variant === VARIANT_GRID && (o.listOnly === true || o.allowFullFallback === false);
    if (
      listOnlyGridEarly
      && jobId
      && assetId
      && isLoggedIn()
      && bucketPathEarly
      && !storagePathOwnedByCurrentUser(bucketPathEarly)
    ) {
      const card = (window.__promptHubCards || []).find((c) => c.id === assetId);
      const stored = card ? cardListThumbStorageRef(card) : null;
      if (stored?.ref && stored.ref !== normalizedEarly) {
        return resolveDisplayUrl(stored.ref, nextOpts({
          jobId: stored.thumb?.slotJobId || jobId,
          galleryIndex: stored.thumb?.galleryIndex ?? o.galleryIndex
        }));
      }
    }
    if (
      listOnlyGridEarly
      && jobId
      && isLoggedIn()
      && window.WarehouseThumb?.resolveForCard
    ) {
      const ownedStorage = bucketPathEarly && storagePathOwnedByCurrentUser(bucketPathEarly);
      if (!ownedStorage) {
        const wh = await window.WarehouseThumb.resolveForCard(image, {
          jobId: storageJobId || jobId,
          assetId,
          cardId: o.cardId || assetId,
          galleryIndex: o.galleryIndex || 0
        });
        if (wh && isGridDisplayUrl(wh)) {
          if (assetId) markGridThumbReady(assetId);
          return wh;
        }
      }
    }
    let communityFeed = isCommunityFeedOpts(o);
    if (
      communityFeed
      && bucketPathEarly
      && isLoggedIn()
      && storagePathOwnedByCurrentUser(bucketPathEarly)
    ) {
      communityFeed = false;
    }
    const assetIdEarly = o.assetId;
    if (
      variant === VARIANT_GRID
      && assetIdEarly
      && !isGridThumbReady(assetIdEarly)
      && !communityFeed
      && o.allowFullFallback !== false
      && o.listOnly !== true
      && o.preferFull === true
    ) {
      return resolveDisplayUrl(image, nextOpts({
        variant: VARIANT_FULL,
        allowFullFallback: false,
        preferFull: false
      }));
    }
    const normalized = normalizeImageRef(image);
    const bucketPath = storagePathFromRef(normalized);
    if (bucketPath && (isLoggedIn() || communityFeed)) {
      const primary = primaryImagePath(normalized, assetId);
      const fromRef = bucketPath.replace(/^\//, '');
      const all = listImagePathCandidates(normalized, assetId, authorId, storageJobId).filter(
        (p) => !isPathKnownMissing(p)
      );
      const variantPaths = pathsForVariant(normalized, assetId, authorId, variant, storageJobId);
      let candidates;
      const listOnlyGrid = variant === VARIANT_GRID && (o.listOnly === true || o.allowFullFallback === false);
      if (
        listOnlyGrid
        && o.degradedListFull === true
        && primary
        && !communityFeed
        && isLoggedIn()
        && storagePathOwnedByCurrentUser(primary)
      ) {
        const degraded = await resolveListPrimaryFallback(primary, assetId, o);
        if (degraded) return degraded;
      }
      if (communityFeed && listOnlyGrid) {
        const one = fromRef ? fromRef.replace(/^\//, '') : (primary ? primary.replace(/^\//, '') : '');
        candidates = one ? [one] : [];
      } else if (o.tryAllPaths === true) {
        candidates = variantPaths.length ? variantPaths : (listOnlyGrid ? [] : all);
      } else if (fromRef) {
        candidates = variantPaths.length
          ? variantPaths
          : (listOnlyGrid ? [] : (assetId && all.length ? all : [fromRef]));
      } else if (primary) {
        candidates = variantPaths.length ? variantPaths.slice(0, variant === VARIANT_GRID ? 3 : 1) : [primary];
      } else if (communityFeed) {
        candidates = variantPaths.slice(0, 3);
      } else {
        candidates = variantPaths.slice(0, 1);
      }
      if (o.listOnly === true && candidates.length > 1) {
        candidates = candidates.slice(0, 1);
      }
      for (const path of candidates) {
        const pkey = path.replace(/^\//, '');
        const cached = signedUrlCache.get(signedCacheKey(pkey, variant));
        if (cached?.url && cached.expiresAt > Date.now() + 120000) {
          const out = filterGridVariantUrl(cached.url, variant);
          if (out) return out;
        }
      }
      for (const path of candidates) {
        const url = await resolvePathToUrl(path, variant, {
          communityFeed,
          authorId,
          cardId: assetId,
          listOnly: o.listOnly === true
        });
        if (url) return url;
      }
      /* 列表/grid 缺缩略图：只排队 backfill，禁止签 full 原图进 feed（单张 2MB+ 会卡死首屏） */
      if (
        listOnlyGrid
        && primary
        && !communityFeed
        && isLoggedIn()
        && storagePathOwnedByCurrentUser(primary)
      ) {
        /* 列表 resolve 热路径不排队 backfill，避免与 WarehouseThumb 并发打满 */
      }
      if (
        variant === VARIANT_GRID
        && !communityFeed
        && o.allowFullFallback !== false
        && o.listOnly !== true
        && o.preferFull === true
        && assetId
        && isLoggedIn()
      ) {
        const own = bucketPath && storagePathOwnedByCurrentUser(bucketPath);
        if (own) {
          return resolveDisplayUrl(image, nextOpts({
            variant: VARIANT_FULL,
            allowFullFallback: false,
            preferFull: false
          }));
        }
      }
      return null;
    }
    if (/^https?:\/\//i.test(image)) {
      if (isInvalidMediaUrl(image)) return null;
      if (o.listOnly === true && isEphemeralUpstreamImageUrl(image)) return null;
      const legacyPath = storagePathFromRef(image);
      if (legacyPath) {
        const uid = getUserId();
        const own = !!(uid && legacyPath.replace(/^\//, '').startsWith(`${uid}/`));
        const useCommunity = communityFeed || (isLoggedIn() && !own);
        const storageRef = toStorageRef(legacyPath);
        if (o._fromStorageRef === storageRef) return null;
        return resolveDisplayUrl(storageRef, nextOpts({
          communityFeed: useCommunity,
          tryAllPaths: useCommunity || o.tryAllPaths === true,
          _fromStorageRef: storageRef
        }));
      }
      if (isEphemeralUpstreamImageUrl(image)) return null;
      if (window.PromptHubApi?.fetchMediaAsBlobUrl && o.allowRemoteFetch === true) {
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
        if (p) {
          const pk = p.replace(/^\//, '');
          if (isGridStoragePath(pk)) paths.add(pk);
          else {
            const grid = gridPathFromPrimary(pk);
            if (grid && !isPathKnownMissing(grid)) paths.add(grid.replace(/^\//, ''));
          }
        }
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const ref = item.image;
      if (ref) {
        if (isInvalidMediaUrl(ref)) continue;
        const p = storagePathFromRef(ref);
        if (p) {
          const pk = p.replace(/^\//, '');
          if (isGridStoragePath(pk)) paths.add(pk);
          else {
            const grid = gridPathFromPrimary(pk);
            if (grid && !isPathKnownMissing(grid)) paths.add(grid.replace(/^\//, ''));
          }
          continue;
        }
      }
      const authorId = item.authorId && String(item.authorId) !== 'guest' ? String(item.authorId) : '';
      const cardId = item.sourceCardId ? String(item.sourceCardId) : '';
      if (authorId && cardId) {
        const base = String(cardId).replace(/[^a-zA-Z0-9_-]/g, '_');
        const grid = `${authorId}/${base}_grid.jpg`;
        if (!isPathKnownMissing(grid)) paths.add(grid);
      }
    }
    return [...paths];
  }

  async function runCommunitySignBatchQueued(items, capMs) {
    const list = (items || []).filter((item) => item && String(item.ref || '').trim());
    if (!list.length) return { ok: true, data: { urls: {}, refMap: {} } };
    if (Date.now() < communitySignBatchCooldownUntil) return null;
    if (window.PromptHubApi?.isApiRateLimited?.()) return null;
    if (!window.PromptHubApi?.signCommunityMediaRefsBatch) return null;

    const chunks = [];
    for (let i = 0; i < list.length; i += COMMUNITY_SIGN_BATCH_CHUNK) {
      chunks.push(list.slice(i, i + COMMUNITY_SIGN_BATCH_CHUNK));
    }

    communitySignBatchChain = communitySignBatchChain.then(async () => {
      let last = null;
      for (const chunk of chunks) {
        if (Date.now() < communitySignBatchCooldownUntil) break;
        if (window.PromptHubApi?.isApiRateLimited?.()) break;
        const gap = COMMUNITY_SIGN_BATCH_MIN_GAP_MS - (Date.now() - communitySignBatchLastAt);
        if (gap > 0) await new Promise((r) => setTimeout(r, gap));
        communitySignBatchLastAt = Date.now();
        const r = await window.PromptHubApi.signCommunityMediaRefsBatch(chunk, {
          timeoutMs: Math.max(2500, Number(capMs) || 5000)
        });
        last = r;
        if (r?.ok) {
          applyCommunityBatchSignResult(r.data);
          continue;
        }
        if (r?.status === 429 || r?.status === 503 || r?.code === 'RATE_LIMITED') {
          communitySignBatchCooldownUntil = Date.now() + (r?.status === 503 ? 120000 : 75000);
          window.PromptHubApi?.markApiRateLimited?.(communitySignBatchCooldownUntil - Date.now());
          break;
        }
      }
      return last;
    }).catch(() => null);

    return communitySignBatchChain;
  }

  async function prefetchCommunityDisplayUrlsLegacy(images, capMs) {
    if (!window.PromptHubApi?.signCommunityMediaRefsBatch) return;
    const items = (images || []).slice(0, 24).map((raw) => {
      if (typeof raw === 'string') return { ref: raw };
      if (!raw || typeof raw !== 'object') return null;
      return {
        ref: raw.image || raw.ref || '',
        authorId: raw.authorId,
        cardId: raw.sourceCardId || raw.id
      };
    }).filter((x) => x?.ref);
    if (!items.length) return;
    await runCommunitySignBatchQueued(items, capMs);
  }

  function applyCommunityBatchSignResult(data) {
    if (!data) return 0;
    let n = 0;
    const urls = data.urls && typeof data.urls === 'object' ? data.urls : {};
    const refMap = data.refMap && typeof data.refMap === 'object' ? data.refMap : {};
    const cacheGridUrl = (pathOrRef, url) => {
      if (!url || isIncompleteSignedStorageUrl(url)) return;
      if (!isCdnMediaUrl(url)) return;
      const cdnPath = storagePathFromDisplayUrl(url);
      if (cdnPath && !isGridStoragePath(cdnPath)) return;
      const fromRef = storagePathFromRef(
        typeof pathOrRef === 'string' && pathOrRef.startsWith(STORAGE_PREFIX) ? pathOrRef : ''
      );
      const keys = new Set();
      const raw = String(fromRef || pathOrRef || '').replace(/^\//, '');
      if (raw) keys.add(raw);
      if (raw && isGridStoragePath(raw)) {
        const stem = raw.replace(/_grid\.(jpe?g|webp|png)$/i, '');
        ['.jpg', '.jpeg', '.webp', '.png'].forEach((ext) => keys.add(`${stem}${ext}`));
      } else if (raw) {
        const grid = gridPathFromPrimary(raw);
        if (grid) keys.add(grid.replace(/^\//, ''));
      }
      for (const key of keys) {
        cacheSignedPath(key, url, VARIANT_GRID);
        n += 1;
      }
    };
    for (const [path, url] of Object.entries(urls)) cacheGridUrl(path, url);
    for (const [ref, url] of Object.entries(refMap)) cacheGridUrl(ref, url);
    if (n) persistSessionSignCache();
    return n;
  }

  async function prefetchCommunityDisplayUrls(images, capMs) {
    const list = (images || []).slice(0, 100);
    if (!list.length) return;

    const batchItems = [];
    const ownBatch = [];
    const seen = new Set();
    const uid = getUserId();
    for (const raw of list) {
      let ref = '';
      let authorId = '';
      let cardId = '';
      if (typeof raw === 'string') {
        ref = raw;
      } else if (raw && typeof raw === 'object') {
        ref = raw.image || raw.ref || '';
        authorId = raw.authorId && String(raw.authorId) !== 'guest' ? String(raw.authorId) : '';
        cardId = raw.sourceCardId ? String(raw.sourceCardId) : (raw.id ? String(raw.id) : '');
      }
      if (!ref || isInvalidMediaUrl(ref)) continue;
      const signRef = ref;
      const path = storagePathFromRef(signRef);
      if (path && uid && storagePathOwnedByCurrentUser(path)) {
        ownBatch.push(typeof raw === 'object' ? raw : { image: ref, id: cardId || undefined });
        continue;
      }
      const key = `${ref}|${authorId}|${cardId}`;
      if (seen.has(key)) continue;
      if (path) {
        const fileKey = path.replace(/^\//, '');
        const cached = signedUrlCache.get(signedCacheKey(fileKey, VARIANT_GRID));
        if (cached?.expiresAt > Date.now() + 120000) continue;
      }
      seen.add(key);
      batchItems.push({
        ref: signRef,
        authorId: authorId || undefined,
        cardId: cardId || undefined
      });
    }

    if (!batchItems.length && !ownBatch.length) return;

    if (ownBatch.length) {
      await prefetchCardsImages(ownBatch, Math.max(2500, Number(capMs) || 5000), {
        maxCards: Math.min(ownBatch.length, 24)
      });
    }

    if (!batchItems.length) return;

    await runCommunitySignBatchQueued(batchItems.slice(0, COMMUNITY_SIGN_BATCH_CHUNK), capMs);
  }

  function collectPrefetchItemForRef(ref) {
    if (!ref) return null;
    const cards = window.__promptHubCards || [];
    const norm = normalizeImageRef(ref);
    const card = cards.find((c) => {
      if (!c?.image) return false;
      const ci = normalizeImageRef(c.image);
      return ci === norm || c.image === ref;
    });
    const collect = card && typeof window.getCommunityCollectImageResolveOpts === 'function'
      ? window.getCommunityCollectImageResolveOpts(card)
      : null;
    if (!collect?.authorId) return null;
    return {
      ref,
      authorId: collect.authorId,
      cardId: collect.cardId || collect.assetId || undefined
    };
  }

  function findCardForStoragePath(pathKey) {
    const key = String(pathKey || '').replace(/^\//, '');
    if (!key) return null;
    const cards = window.__promptHubCards || [];
    return cards.find((c) => {
      if (!c?.image) return false;
      const p = primaryImagePath(c.image, c.id);
      return p === key;
    }) || null;
  }

  async function prefetchDisplayUrls(images, opts) {
    if (!isLoggedIn()) return;
    const gridOnly = opts?.gridOnly === true;
    const communityBatch = [];
    const seenCommunity = new Set();
    const ownedGridPaths = [];
    const ownedFullPaths = [];
    for (const raw of images || []) {
      const ref = typeof raw === 'string' ? raw : (raw?.image || raw?.ref || '');
      if (!ref) continue;
      const path = storagePathFromRef(ref);
      if (!path) continue;
      const key = path.replace(/^\//, '');
      if (storagePathOwnedByCurrentUser(path)) {
        const card = findCardForStoragePath(key);
        const plan = ownedListSignTargets(key, card?.id, { gridOnly });
        if (plan.grid) ownedGridPaths.push(plan.grid);
        /* backfill 由视口触发，不在 prefetchDisplayUrls 批量排队 */
        continue;
      }
      const item = collectPrefetchItemForRef(ref);
      if (!item) continue;
      const ck = `${item.ref}|${item.authorId}|${item.cardId || ''}`;
      if (seenCommunity.has(ck)) continue;
      seenCommunity.add(ck);
      communityBatch.push(item);
    }
    if (communityBatch.length) {
      await prefetchCommunityDisplayUrls(communityBatch, 5000);
    }
    async function signOwnedBatch(paths, variant) {
      const list = [...new Set(paths)];
      if (!list.length) return;
      const pending = list.filter((p) => {
        if (isPathKnownMissing(p)) return false;
        const cached = signedUrlCache.get(signedCacheKey(p, variant));
        return !(cached?.url && cached.expiresAt > Date.now() + 120000);
      });
      if (!pending.length) return;
      await ensureSession();
      await batchSignPaths(pending, variant);
    }
    await signOwnedBatch(ownedGridPaths, VARIANT_GRID);
    await signOwnedBatch(ownedFullPaths, VARIANT_FULL);
  }

  function getCachedDisplayUrl(image, assetIdOrOpts) {
    if (!image || typeof image !== 'string') return image;
    if (isDataUrl(image) || image.startsWith('blob:')) return image;
    const opts = typeof assetIdOrOpts === 'object' ? assetIdOrOpts : { assetId: assetIdOrOpts };
    const assetId = opts?.assetId;
    const storageJobId = resolveStorageJobIdForAsset(opts, assetId)
      || resolveJobIdForAsset(opts, assetId);
    const variant = displayVariantFromOpts(opts);
    const primary = primaryImagePath(image, assetId);
    const pathFromImage = storagePathFromRef(image);
    const canLookup = !!(pathFromImage || assetId || primary);
    if (canLookup) {
      if (primary) {
        const pkey = primary.replace(/^\//, '');
        if (variant === VARIANT_GRID && gridListNeedsPrimaryFallback(primary, assetId)) {
          /* 列表 grid 缺失时不回退 full（侧栏/灯箱单独 resolve full） */
        } else {
          const hit = signedUrlCache.get(signedCacheKey(pkey, variant));
          if (
            hit?.url
            && hit.expiresAt > Date.now() + 120000
            && !(variant === VARIANT_GRID && gridListNeedsPrimaryFallback(primary, assetId))
          ) {
            const out = filterGridVariantUrl(hit.url, variant);
            if (out) return out;
          }
        }
      }
      for (const path of pathsForVariant(image, assetId, opts?.authorId, variant, storageJobId)) {
        const key = path.replace(/^\//, '');
        if (variant === VARIANT_FULL && isGridStoragePath(key)) continue;
        if (variant === VARIANT_GRID && primary && gridListNeedsPrimaryFallback(primary, assetId)) continue;
        const cached = signedUrlCache.get(signedCacheKey(key, variant));
        if (cached?.url && cached.expiresAt > Date.now() + 120000) {
          const cdnPath = storagePathFromDisplayUrl(cached.url);
          if (
            variant === VARIANT_GRID
            && primary
            && cdnPath
            && isGridStoragePath(cdnPath)
            && gridListNeedsPrimaryFallback(primary, assetId)
          ) {
            continue;
          }
          const out = filterGridVariantUrl(cached.url, variant);
          if (out) return out;
        }
      }
    }
    const path = pathFromImage || (primary ? primary.replace(/^\//, '') : null);
    if (!path) {
      if (/^https?:\/\//i.test(image) && isValidSignedDisplayUrl(image)) return image;
      return '';
    }
    const cached = signedUrlCache.get(signedCacheKey(path.replace(/^\//, ''), variant));
    if (cached?.url && cached.expiresAt > Date.now() + 120000 && !isIncompleteSignedStorageUrl(cached.url)) {
      return filterGridVariantUrl(cached.url, variant);
    }
    if (variant === VARIANT_GRID) {
      return '';
    }
    if (/^https?:\/\//i.test(image) && isValidSignedDisplayUrl(image)) return image;
    return '';
  }

  /** 列表 DOM 首屏 src：仅 grid；禁止默认降级 full（单张 2MB+ 会撑爆首屏） */
  function getListDisplayImageSrc(image, assetId, extraOpts) {
    if (!image || typeof image !== 'string') return '';
    const o = extraOpts && typeof extraOpts === 'object' ? extraOpts : {};
    const id = o.assetId || assetId;
    const storageJobId = resolveStorageJobIdForAsset(o, id);
    const primary = id ? primaryImagePath(normalizeImageRef(image), id) : null;
    const pkey = primary ? primary.replace(/^\//, '') : '';
    if (pkey && isPathKnownMissing(pkey)) return '';
    const gridKey = pkey ? (gridPathFromPrimary(pkey) || '').replace(/^\//, '') : '';
    const grid = getCachedDisplayUrl(image, {
      assetId: id,
      authorId: o.authorId,
      jobId: storageJobId || o.jobId,
      variant: VARIANT_GRID
    });
    if (grid && isValidSignedDisplayUrl(grid) && !isInvalidMediaUrl(grid) && isGridDisplayUrl(grid)) {
      return grid;
    }
    if (gridKey && (isPathKnownMissing(gridKey) || isGridFetchFailed(gridKey))) return '';
    if (o.allowFullFallback === true && isLoggedIn() && id) {
      const normalized = normalizeImageRef(image);
      const primary = primaryImagePath(normalized, id);
      const pkey = primary ? primary.replace(/^\//, '') : '';
      if (primary && storagePathOwnedByCurrentUser(primary) && pkey && !isPathKnownMissing(pkey)) {
        const full = getCachedDisplayUrl(normalized, {
          assetId: id,
          authorId: o.authorId,
          jobId: storageJobId || o.jobId,
          variant: VARIANT_FULL
        });
        if (full && isValidSignedDisplayUrl(full) && !isInvalidMediaUrl(full)) return full;
      }
    }
    return '';
  }

  /** 列表缩略图 ref 已是自有 storage:// → 与普通卡同走 batch 签 grid */
  function cardListThumbStorageRef(card) {
    if (!card?.id) return null;
    const thumb = window.PromptHubCardGallery?.pickWarehouseListThumb?.(card);
    const ref = thumb?.ref || (isStorageRef(card.image) ? card.image : null);
    if (!ref || !isStorageRef(ref)) return null;
    const path = storagePathFromRef(ref);
    if (!path || !storagePathOwnedByCurrentUser(path)) return null;
    const pkey = path.replace(/^\//, '');
    if (isPathKnownMissing(pkey)) return null;
    return { ref, thumb };
  }

  /** 收集卡片 gallery 内所有可 batch 签名的 grid 路径（含 MJ 多槽） */
  function collectCardOwnedListSignPaths(card) {
    const paths = new Set();
    if (!card?.id) return paths;
    const addRef = (ref) => {
      if (!ref || !isStorageRef(ref)) return;
      const path = storagePathFromRef(ref);
      if (!path || !storagePathOwnedByCurrentUser(path)) return;
      const pkey = path.replace(/^\//, '');
      if (isPathKnownMissing(pkey)) return;
      const plan = ownedListSignTargets(pkey, card.id);
      if (plan.grid) paths.add(plan.grid);
      else if (!plan.primary) {
        const gk = (gridPathFromPrimary(pkey) || '').replace(/^\//, '');
        if (gk && !isPathKnownMissing(gk)) paths.add(gk);
      }
    };
    const thumb = window.PromptHubCardGallery?.pickWarehouseListThumb?.(card);
    if (thumb?.ref) addRef(thumb.ref);
    const gallery = window.PromptHubCardGallery?.normalizeCardGallery?.(card) || [];
    for (const u of gallery) addRef(u);
    if (isStorageRef(card.image)) addRef(card.image);
    return paths;
  }

  function cardHasOwnedGalleryStorage(card) {
    return collectCardOwnedListSignPaths(card).size > 0;
  }

  function isGeneratedStoragePath(pathOrRef) {
    const raw = String(pathOrRef || '').trim();
    if (!raw) return false;
    const path = storagePathFromRef(raw) || raw.replace(/^\//, '');
    return path.includes('/generated/');
  }

  /** 生图卡常带 storage://…/generated/…，R2 可能尚未归档；不能走 sign-batch */
  function cardUsesGeneratedStorage(card) {
    const jobId = card?.genJobId
      || window.PromptHubCardGallery?.resolveGenJobIdFromCard?.(card);
    if (!jobId) return false;
    const thumb = window.PromptHubCardGallery?.pickWarehouseListThumb?.(card);
    const ref = thumb?.ref || card.image;
    return isGeneratedStoragePath(ref);
  }

  function cardHasGeneratedGalleryStorage(card) {
    const gallery = window.PromptHubCardGallery?.normalizeCardGallery?.(card) || [];
    for (const u of gallery) {
      if (u && isGeneratedStoragePath(u)) return true;
    }
    return false;
  }

  /** 生图 /generated/ 路径：优先 sign-batch（服务端 ensureGrid 会现场出 grid）；仅无 storage 引用时才走 warehouse-thumbs */
  function cardNeedsWarehouseThumbServer(card) {
    if (cardListThumbStorageRef(card)) return false;
    const ownedPaths = collectCardOwnedListSignPaths(card);
    if (ownedPaths.size) return false;
    if (cardHasOwnedGalleryStorage(card)) return false;
    const jobId = card?.genJobId
      || window.PromptHubCardGallery?.resolveGenJobIdFromCard?.(card);
    return !!jobId;
  }

  /** 按卡片 id 收集 canonical 路径，一次 batch 签名（避免列表每张图多次试探） */
  async function prefetchCardsImages(cards, capMs, opts) {
    if (!isLoggedIn()) return;
    const maxCards = Math.min(
      warehousePrefetchCardCap(),
      Math.max(1, Number(opts?.maxCards) || warehousePrefetchCardCap())
    );
    const limit = capMs != null ? Math.min(Math.max(800, capMs), 8000) : 2800;
    const pathSet = new Set();
    const communityBatch = [];
    const seenCommunity = new Set();
    const list = (cards || []).slice(0, maxCards);
    const genCards = [];
    for (const c of list) {
      if (!c?.id) continue;
      if (cardNeedsWarehouseThumbServer(c)) {
        genCards.push(c);
        continue;
      }
      const ownedPaths = collectCardOwnedListSignPaths(c);
      if (ownedPaths.size) {
        if (!isGridBackfillSkipped(c.id)) {
          ownedPaths.forEach((p) => pathSet.add(p));
        }
        continue;
      }
      if (isGridBackfillSkipped(c.id)) continue;
      const collectOpts = typeof window.getCommunityCollectImageResolveOpts === 'function'
        ? window.getCommunityCollectImageResolveOpts(c)
        : null;
      if (collectOpts?.authorId) {
        const ck = `${c.image}|${collectOpts.authorId}|${collectOpts.cardId || collectOpts.assetId || ''}`;
        if (!seenCommunity.has(ck)) {
          seenCommunity.add(ck);
          communityBatch.push({
            ref: c.image,
            authorId: collectOpts.authorId,
            cardId: collectOpts.cardId || collectOpts.assetId
          });
        }
        continue;
      }
      const p = primaryImagePath(c.image, c.id);
      if (!p || isPathKnownMissing(p)) continue;
      if (!storagePathOwnedByCurrentUser(p)) continue;
      const plan = ownedListSignTargets(p, c.id);
      if (plan.grid) pathSet.add(plan.grid);
      else if (!plan.primary) {
        const gk = (gridPathFromPrimary(p) || '').replace(/^\//, '');
        if (gk && !isPathKnownMissing(gk)) pathSet.add(gk);
      }
      /* backfill 仅由视口 prefetchOneCardImg 触发，避免刷新时批量拉原图 */
    }
    if (genCards.length && window.WarehouseThumb?.prefetchForCards) {
      await window.WarehouseThumb.prefetchForCards(genCards, {
        max: Math.min(genCards.length, maxCards)
      });
    }
    if (communityBatch.length) {
      await prefetchCommunityDisplayUrls(communityBatch, limit);
    }
    /* 列表 prefetch 只签 grid，不批量签 full（否则首屏 24 张 × 2MB ≈ 48MB） */
    if (pathSet.size) {
      await batchSignPaths([...pathSet], VARIANT_GRID);
    }
    /* 列表 prefetch 禁止 batch 签 full（legacy 缺 grid 时等 CDN/侧栏，勿首屏拉原图） */
  }

  /** 卡片库首屏：签当前页可见卡（默认最多 24 张） */
  async function prefetchWarehousePage(cards, capMs, opts) {
    if (!isLoggedIn()) return;
    const mobile = typeof window !== 'undefined' && window.MobileUI?.isMobileViewport?.();
    const cap = Number(opts?.maxCards) > 0
      ? Number(opts.maxCards)
      : warehousePrefetchCardCap();
    const maxCards = Math.min(cap, Math.max(1, (cards || []).length));
    const list = (cards || []).slice(0, maxCards);
    if (!list.length) return;
    const budget = capMs == null ? (mobile ? 4200 : 2800) : Math.min(capMs, mobile ? 4800 : 4000);
    await prefetchCardsImages(list, budget, { maxCards });
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
      !isInvalidMediaUrl(url) &&
      !isIncompleteSignedStorageUrl(url) &&
      (isCdnMediaUrl(url) || isValidSignedDisplayUrl(url))
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
        media.classList.add('card-media--load-failed');
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
      if (isEphemeralUpstreamImageUrl(image)) return imgPlaceholderSrc();
      const path = storagePathFromRef(image);
      if (path) {
        const cached = filterGridVariantUrl(
          getCachedDisplayUrl(toStorageRef(path), { variant: VARIANT_GRID }),
          VARIANT_GRID
        );
        if (cached && !cached.startsWith(STORAGE_PREFIX)) return cached;
        return imgPlaceholderSrc();
      }
      return image;
    }
    if (isStorageRef(image)) {
      const cached = filterGridVariantUrl(getCachedDisplayUrl(image, { variant: VARIANT_GRID }), VARIANT_GRID);
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
      if (isUsableLoadedImgSrc(cur, img)) return;
      const assetId = img.dataset?.sourceCardId
        || img.closest('.card[data-source-card-id]')?.dataset?.sourceCardId
        || img.closest('.card[data-id]')?.dataset?.id
        || img.closest('.card[data-post-id]')?.dataset?.postId
        || img.closest('.imagegen-feed-card[data-feed-id]')?.dataset?.feedId?.replace(/^wh_/, '')
        || undefined;
      const inWarehouse = !!img.closest('#cardsContainer');
      const inImageGenWh = !!img.closest('#imageGenFeed .imagegen-feed-card[data-feed-id^="wh_"]');
      const inSide = !!img.closest('#communitySideBody, #creationsSideBody, .community-side-img-btn, #appreciateViewer, #imageLightbox');
      let url = '';
      const inCommunityGrid = !!img.closest('#communityGrid, #creationsGrid, #userProfileGrid');
      if (inWarehouse || inSide || inImageGenWh || inCommunityGrid || !assetId) {
        url = getListDisplayImageSrc(ref, assetId, {
          assetId,
          authorId: img.dataset?.authorId || img.closest('.card')?.dataset?.authorId,
          allowFullFallback: false
        });
      }
      if (url && isInvalidMediaUrl(url)) url = '';
      if (url && isWarehouseBlockedFullUrl(url, img)) url = '';
      if (url && /^https?:\/\//i.test(url) && isValidSignedDisplayUrl(url)) {
        const media = img.closest('.card-media, .imagegen-feed-media');
        const whOwnList = inWarehouse && !img.closest('.card[data-community-collect="1"]');
        const alreadyVisible = img.complete && img.naturalWidth > 8 && isUsableLoadedImgSrc(cur, img);
        if (whOwnList && !isGridDisplayUrl(url)) url = '';
        if (!url) return;
        if (whOwnList) {
          if (media && !alreadyVisible) media.classList.add('card-media--await');
        } else {
          media?.classList.remove('card-media--await');
          if (media && !alreadyVisible) {
            if (!media.dataset.shineAt) media.dataset.shineAt = String(Date.now());
            if (!media.classList.contains('is-loading')) media.classList.add('is-loading');
          }
        }
        const currentNow = img.currentSrc || img.src || '';
        const currentPath = storagePathFromDisplayUrl(currentNow);
        const targetPath = storagePathFromDisplayUrl(url);
        const targetKey = targetPath ? String(targetPath).replace(/^\//, '') : url;
        const sameDisplayResource = currentNow === url
          || (currentPath && targetPath && String(currentPath).replace(/^\//, '') === String(targetPath).replace(/^\//, ''));
        if (!img.complete && (
          img.dataset.feedLoadingUrl === url
          || (targetKey && img.dataset.feedLoadingKey === targetKey)
          || sameDisplayResource
        )) {
          return;
        }
        const done = () => {
          if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(media);
          else media?.classList.remove('is-loading');
        };
        if (img.complete && img.naturalWidth > 0 && (img.src === url || isUsableLoadedImgSrc(cur, img))) done();
        else {
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', () => {
            const failedPath = storagePathFromDisplayUrl(img.src || '');
            if (failedPath && /_grid\.(jpe?g|webp|png)$/i.test(failedPath)) {
              markGridFetchFailed(failedPath);
            }
            if (inWarehouse && !img.closest('.card[data-community-collect="1"]')) {
              if (img.dataset.feedLoadDone !== '1') {
                window.finalizeWarehouseCardMediaFailure?.(media, img);
              }
              done();
              return;
            }
            if (img.dataset.patchRetry === '1') {
              media?.classList.add('card-media--load-failed');
              done();
              return;
            }
            img.dataset.patchRetry = '1';
            void resolveDisplayUrl(ref, {
              assetId,
              authorId: img.dataset?.authorId || img.closest('.card')?.dataset?.authorId,
              communityFeed: inCommunityGrid,
              variant: VARIANT_GRID,
              listOnly: true,
              allowFullFallback: false,
              degradedListFull: false
            }).then((retryUrl) => {
              const safeRetry = window.SupabaseSync?.safeListImgUrl?.(retryUrl, img) || '';
              if (safeRetry && window.CardImageLoader?.applyUrlToImg?.(img, safeRetry)) {
                return;
              }
              media?.classList.add('card-media--load-failed');
              done();
            });
          }, { once: true });
          if (!window.CardImageLoader?.applyUrlToImg?.(img, url)) {
            media?.classList.add('card-media--load-failed');
            done();
          }
        }
      }
    });
  }

  async function prefetchDisplayUrlsWithCap(images, capMs, opts) {
    const limit = Math.max(800, Number(capMs) || 5000);
    await Promise.race([
      prefetchDisplayUrls(images, opts),
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
    const concurrency = opts?.warehouseBoost
      ? (window.matchMedia('(max-width: 900px)').matches ? 10 : 18)
      : opts?.communityBoost
        ? (window.matchMedia('(max-width: 900px)').matches ? 8 : 14)
        : (window.matchMedia('(max-width: 900px)').matches ? 5 : 8);
    let idx = 0;
    async function hydrateOne(img) {
      if (img.closest('#cardsContainer')) return;
      if (img.closest('#imageGenFeed')) return;
      const ref = img.getAttribute('data-storage-ref') || img.getAttribute('data-image-ref');
      if (!ref) return;
      const media = img.closest('.card-media, .imagegen-feed-media');
      if (media?.classList.contains('imagegen-gen-pending')) return;
      const cur = img.currentSrc || img.src || '';
      if (onlyMissing && isUsableLoadedImgSrc(cur, img)) {
        media?.classList.remove('is-loading');
        return;
      }
      const inWarehouse = !!img.closest('#cardsContainer');
      const inCommunityFeed = !!img.closest('#communityGrid, #creationsGrid, #userProfileGrid');
      const inFeed = inCommunityFeed;
      const authorId = img.dataset?.authorId
        || img.closest('.card')?.dataset?.authorId
        || '';
      const refPath = storagePathFromRef(ref) || '';
      const uid = getUserId();
      const ownFeedPath = !!(refPath && uid && refPath.replace(/^\//, '').startsWith(`${uid}/`));
      const inSide = !!img.closest('#communitySideBody, #creationsSideBody, .community-side-img-btn');
      const communityFeed = (inFeed && (!isLoggedIn() || !ownFeedPath)) || inSide;
      const listVariant = inSide ? VARIANT_FULL : ((inCommunityFeed || inWarehouse) ? VARIANT_GRID : VARIANT_GRID);
      const assetId = img.dataset?.sourceCardId
        || img.closest('.card[data-source-card-id]')?.dataset?.sourceCardId
        || img.closest('.card[data-id]')?.dataset?.id
        || img.closest('.card[data-post-id]')?.dataset?.postId
        || img.closest('.card[data-creation-id]')?.dataset?.creationId
        || img.closest('[data-feed-id]')?.dataset?.feedId?.replace(/^wh_/, '')
        || undefined;
      let resolveOpts = {
        assetId,
        authorId: authorId || undefined,
        cardId: assetId,
        variant: listVariant,
        communityFeed,
        tryAllPaths: false,
        allowFullFallback: inSide ? true : false,
        listOnly: inWarehouse || (inCommunityFeed && !inSide) ? true : undefined
      };
      if (inWarehouse && assetId && typeof window.getCommunityCollectImageResolveOpts === 'function') {
        const cardModel = (window.__promptHubCards || []).find((c) => c.id === assetId);
        const collectOpts = window.getCommunityCollectImageResolveOpts(cardModel);
        if (collectOpts) {
          resolveOpts = {
            ...resolveOpts,
            authorId: collectOpts.authorId,
            cardId: collectOpts.cardId || collectOpts.assetId,
            communityFeed: true,
            tryAllPaths: false,
            variant: VARIANT_GRID,
            listOnly: true,
            allowFullFallback: false
          };
        }
      }
      const cached = getCachedDisplayUrl(ref, { assetId, authorId: authorId || undefined, variant: listVariant });
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
        if (isResolvableDisplayUrl(url) && !isWarehouseBlockedFullUrl(url, img)) {
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
          void resolveDisplayUrl(ref, {
            ...resolveOpts,
            tryAllPaths: inWarehouse ? false : true,
            listOnly: inWarehouse ? true : resolveOpts.listOnly,
            allowFullFallback: false,
            degradedListFull: false
          }).then((url) => {
            if (isResolvableDisplayUrl(url) && !isWarehouseBlockedFullUrl(url, img)) {
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
    if (opts.quick && opts.noDownload === true) {
      const primary = primaryImagePath(ref, assetId);
      if (!primary || isPathKnownMissing(primary)) return false;
      const pkey = primary.replace(/^\//, '');
      const cached = signedUrlCache.get(signedCacheKey(pkey, VARIANT_FULL));
      if (cached?.url && cached.expiresAt > Date.now() + 120000) return true;
      const url = await resolvePathToUrl(pkey, VARIANT_FULL, { bypassSignBudget: true });
      return !!url;
    }
    const attempts = opts.quick ? 1 : 2;
    const all = listImagePathCandidates(normalizeImageRef(ref), assetId);
    const candidates = (opts.quick ? [primaryImagePath(ref, assetId)].filter(Boolean) : all)
      .filter((p) => !isPathKnownMissing(p));
    for (let round = 0; round < attempts; round++) {
      for (const path of candidates) {
        try {
          const url = await resolvePathToUrl(path.replace(/^\//, ''), VARIANT_FULL, { bypassSignBudget: true });
          if (url && (opts.noDownload === true || await verifyImageUrl(url))) return true;
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

  async function uploadStorageBlobViaApi(path, blob, opts = {}) {
    if (!window.PromptHubApi?.isConfigured?.() || !window.PromptHubApi?.uploadStorageBlob) {
      return null;
    }
    const ref = await window.PromptHubApi.uploadStorageBlob(path, blob, opts);
    const cleanPath = String(path || '').replace(/^\//, '');
    if (cleanPath) missingPathCache.delete(normalizePathKey(cleanPath));
    return ref;
  }

  async function uploadStorageBlobXHR(path, blob, opts = {}) {
    if (window.PromptHubApi?.isConfigured?.() && window.PromptHubApi?.uploadStorageBlob) {
      return uploadStorageBlobViaApi(path, blob, opts);
    }
    await ensureSession();
    const sb = getClient();
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('未登录');
    const base = String(window.SUPABASE_URL || '').replace(/\/$/, '');
    const cleanPath = String(path || '').replace(/^\//, '');
    if (!cleanPath) throw new Error('图片路径无效');
    const pathEnc = cleanPath.split('/').map(encodeURIComponent).join('/');
    const uploadUrl = `${base}/storage/v1/object/${BUCKET}/${pathEnc}`;
    const contentType = (blob.type && blob.type.startsWith('image/')) ? blob.type : 'image/jpeg';
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', uploadUrl);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', window.SUPABASE_ANON_KEY);
      xhr.setRequestHeader('x-upsert', 'true');
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.setRequestHeader('cache-control', '3600');
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && typeof opts.onProgress === 'function') {
          opts.onProgress(ev.loaded / ev.total, ev.loaded, ev.total);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(toStorageRef(cleanPath));
          return;
        }
        let errMsg = xhr.responseText || `HTTP ${xhr.status}`;
        try {
          const parsed = JSON.parse(xhr.responseText);
          errMsg = parsed.message || parsed.error || errMsg;
        } catch (e) { /* ignore */ }
        reject(new Error(errMsg));
      };
      xhr.onerror = () => reject(new Error('网络错误，图片上传失败'));
      xhr.send(blob);
    });
  }

  async function uploadStorageBlob(path, blob, opts = {}) {
    if (!blob || (blob.size || 0) < MIN_VALID_IMAGE_BYTES) {
      throw new Error('图片数据无效（文件过小），请重新选择或重新生成');
    }
    if (window.PromptHubApi?.isConfigured?.() && window.PromptHubApi?.uploadStorageBlob) {
      try {
        const ref = await uploadStorageBlobViaApi(path, blob, opts);
        if (ref) return ref;
      } catch (e) {
        if ((blob.size || 0) > STORAGE_BUCKET_LIMIT_BYTES) throw e;
        console.warn('[SupabaseSync] Worker 上传失败，改走 Storage 直传', e);
      }
    }
    if (typeof opts.onProgress === 'function') {
      return uploadStorageBlobXHR(path, blob, opts);
    }
    const maxAttempts = Math.max(1, opts.maxAttempts || 3);
    await ensureSession();
    const sb = getClient();
    if (!sb) throw new Error('未登录');
    const cleanPath = String(path || '').replace(/^\//, '');
    if (!cleanPath) throw new Error('图片路径无效');
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { error } = await sb.storage.from(BUCKET).upload(cleanPath, blob, {
        contentType: (blob.type && blob.type.startsWith('image/')) ? blob.type : 'image/jpeg',
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
      if (opts.skipVerify) {
        missingPathCache.delete(normalizePathKey(cleanPath));
        return toStorageRef(cleanPath);
      }
      const url = await resolvePathToUrl(cleanPath);
      if (url) {
        if (await verifyImageUrl(url)) return toStorageRef(cleanPath);
      }
      await new Promise((r) => setTimeout(r, 450));
      const retryUrl = await resolvePathToUrl(cleanPath);
      if (retryUrl && (await verifyImageUrl(retryUrl))) return toStorageRef(cleanPath);
      lastErr = new Error('上传后校验失败');
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 350 * attempt));
    }
    throw lastErr || new Error('图片上传失败，请检查网络后重试');
  }

  /** 生图入库：原字节写入 generated/{jobId}，列表另存 _grid 缩略 */
  async function archiveGeneratedCardImage(cardId, image, opts = {}) {
    if (!cardId || !image) return image || null;
    if (isStorageRef(image) && !opts.copyToOwnPath) {
      const normalized = normalizeImageRef(image);
      if (await verifyStorageRef(normalized, cardId, { quick: true })) return normalized;
      return normalized;
    }
    if (isStorageRef(image) && opts.copyToOwnPath) {
      const path = storagePathFromRef(image);
      if (path) {
        const url = await resolvePathToUrl(path.replace(/^\//, ''), VARIANT_FULL, { bypassSignBudget: true });
        if (url) {
          return persistGenerationImage(cardId, url, {
            ...(opts?.jobId ? { jobId: opts.jobId } : {}),
            allowRemoteArchive: true
          });
        }
      }
    }
    if (
      /^https?:\/\//i.test(image)
      && isEphemeralUpstreamImageUrl(image)
      && opts.allowRemoteArchive !== true
      && !opts?.jobId
    ) {
      const jobId = opts?.jobId || null;
      if (jobId && window.WarehouseThumb?.resolveForCard) {
        void window.WarehouseThumb.resolveForCard(image, { jobId, assetId: cardId, cardId });
      }
      return image;
    }
    if (!isLoggedIn()) return image;
    const persistOpts = {
      ...(opts?.jobId ? { jobId: opts.jobId } : {}),
      allowRemoteArchive: opts.allowRemoteArchive === true
    };
    let ref = image;
    try {
      ref = await persistGenerationImage(cardId, image, persistOpts);
    } catch (e) {
      console.warn('[SupabaseSync] persistGenerationImage failed', cardId, e);
    }
    if (ref && isStorageRef(ref) && await verifyStorageRef(ref, cardId, { quick: true })) {
      return ref;
    }
    if (/^https?:\/\//i.test(image) || isDataUrl(image) || String(image).startsWith('blob:')) {
      try {
        return await persistGenerationImage(cardId, image, persistOpts);
      } catch (e) {
        console.warn('[SupabaseSync] archiveGeneratedCardImage fallback failed', cardId, e);
      }
    }
    return ref || image;
  }

  async function persistGenerationImage(assetId, image, opts = {}) {
    if (!image || typeof image !== 'string') return image;
    if (!isLoggedIn()) return image;
    if (isStorageRef(image)) {
      const normalized = normalizeImageRef(image);
      if (await verifyStorageRef(normalized, assetId)) return normalized;
      return normalized;
    }
    await ensureSession();
    const storeId = generationStorageAssetId(opts?.jobId, assetId);
    if (isDataUrl(image) || image.startsWith('blob:')) {
      return uploadGeneratedImage(storeId, image);
    }
    if (/^https?:\/\//i.test(image)) {
      if (opts.allowRemoteArchive !== true && !opts?.jobId) {
        if (isEphemeralUpstreamImageUrl(image)) return image;
        if (window.WarehouseThumb?.needsServerThumb?.(image, opts?.jobId)) return image;
      }
      let blob = null;
      if (window.PromptHubApi?.fetchMediaAsBlobUrl) {
        const tmp = await window.PromptHubApi.fetchMediaAsBlobUrl(image);
        if (tmp) {
          try {
            const res = await fetch(tmp);
            if (res.ok) blob = await res.blob();
          } finally {
            try { URL.revokeObjectURL(tmp); } catch (e) { /* ignore */ }
          }
        }
      }
      if (!blob) {
        try {
          const res = await fetch(image, { mode: 'cors' });
          if (res.ok) blob = await res.blob();
        } catch (e) {
          console.warn('[SupabaseSync] 生成图 CORS 拉取失败', e);
        }
      }
      if (blob && (await blobLooksLikeUsableImage(blob))) {
        return uploadGeneratedImage(storeId, blob, { cardId: assetId, jobId: opts?.jobId || null });
      }
      console.warn('[SupabaseSync] 生成图远程地址无效或已过期', storeId);
      return image;
    }
    return image;
  }

  async function uploadGeneratedImage(assetId, source, opts = {}) {
    await ensureSession();
    const uid = getUserId();
    if (!uid || !assetId) throw new Error('未登录');
    const blob = await sourceToBlob(source);
    if (!(await blobLooksLikeUsableImage(blob))) {
      throw new Error('生成图无效（全黑或无法解码），已拒绝上传');
    }
    if ((blob.size || 0) > STORAGE_BUCKET_LIMIT_BYTES) {
      const mb = ((blob.size || 0) / (1024 * 1024)).toFixed(1);
      throw new Error(`生成图约 ${mb}MB，超过云存储单文件 50MB 上限`);
    }
    const ext = extensionFromMime(blob.type);
    const path = `${uid}/generated/${assetId}.${ext}`;
    const gridPath = gridPathFromPrimary(path);
    const ref = await uploadStorageBlob(path, blob, {
      skipVerify: true,
      contentType: blob.type || `image/${ext}`
    });
    if (gridPath) {
      try {
        const gridBlob = await compressImageToGrid(source);
        if ((gridBlob.size || 0) >= GRID_MIN_VALID_BYTES) {
          await uploadStorageBlob(gridPath, gridBlob, { skipVerify: true });
          const readyId = opts?.cardId || opts?.jobId || assetId;
          markGridThumbReady(String(readyId));
          clearSignedCacheForPaths([gridPath, path]);
        }
      } catch (e) {
        console.warn('[SupabaseSync] generated grid thumb failed', assetId, e);
      }
    }
    return ref;
  }

  async function loadImageFromSource(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片无法读取'));
      if (typeof source === 'string') img.src = source;
      else if (source instanceof Blob) img.src = URL.createObjectURL(source);
      else reject(new Error('不支持的图片格式'));
    });
  }

  /** 拒绝全黑/无法解码的 blob，避免 upsert 覆盖 Storage 里仍有效的原图 */
  async function blobLooksLikeUsableImage(blob) {
    if (!blob || (blob.size || 0) < MIN_VALID_IMAGE_BYTES) return false;
    let objectUrl = null;
    try {
      const img = await loadImageFromSource(blob);
      if (typeof blob !== 'string' && blob instanceof Blob) {
        objectUrl = img.src;
      }
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      if (w < 16 || h < 16) return false;
      const canvas = document.createElement('canvas');
      const sw = Math.min(48, w);
      const sh = Math.min(48, h);
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, sw, sh);
      const data = ctx.getImageData(0, 0, sw, sh).data;
      let sum = 0;
      let sumSq = 0;
      const n = sw * sh;
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        sum += lum;
        sumSq += lum * lum;
      }
      const mean = sum / n;
      const variance = sumSq / n - mean * mean;
      if (variance < 6 && mean < 14) return false;
      return true;
    } catch (e) {
      return false;
    } finally {
      if (objectUrl) {
        try { URL.revokeObjectURL(objectUrl); } catch (e) { /* ignore */ }
      }
    }
  }

  async function compressImage(source, opts) {
    const maxSide = opts?.maxSide || MAX_SIDE;
    const quality = opts?.quality != null ? opts.quality : JPEG_QUALITY;
    const normalized = await coerceImageUploadSource(source);
    const img = await loadImageFromSource(normalized);
    if (typeof source !== 'string' && source instanceof Blob) {
      try { URL.revokeObjectURL(img.src); } catch (e) { /* ignore */ }
    }
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (!w || !h) throw new Error('图片尺寸无效');
    const scale = Math.min(1, maxSide / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('图片压缩失败'))), 'image/jpeg', quality);
    });
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new Error('图片过大，请换一张较小的图（建议小于 5MB）');
    }
    return blob;
  }

  async function compressImageToGrid(source) {
    return compressImage(source, { maxSide: GRID_MAX_SIDE, quality: GRID_JPEG_QUALITY });
  }

  async function uploadImageGenRef(refId, source) {
    await ensureSession();
    const uid = getUserId();
    if (!uid || !refId) throw new Error('未登录或参考图无效');
    const blob = await compressImage(source);
    const path = `${uid}/imagegen/${refId}.jpg`;
    return uploadStorageBlob(path, blob, { skipVerify: true });
  }

  async function uploadCardImage(cardId, source, opts = {}) {
    await ensureSession();
    const original = opts.original != null ? !!opts.original : cardUploadOriginalEnabled();
    const fullBlob = await prepareCardFullUploadBlob(source, { original });
    if (!(await blobLooksLikeUsableImage(fullBlob))) {
      throw new Error('图片无效（全黑或无法解码），已拒绝上传以免覆盖云端原图');
    }
    const encodeMode = fullBlob.__uploadEncodeMode || 'raw';
    const ext = original
      ? (encodeMode === 'full_res_jpeg' ? 'jpg' : extFromImageMime(fullBlob.type))
      : 'jpg';
    const path = cardImageStoragePath(cardId, null, ext);
    if (!path) throw new Error('未登录或卡片无效');
    const gridPath = gridImageStoragePath(cardId);
    clearSignedCacheForPaths([path, gridPath, ...listImagePathCandidates(toStorageRef(path), cardId)]);
    await uploadStorageBlob(path, fullBlob, { skipVerify: true, onProgress: opts.onProgress });
    let gridBytes = 0;
    if (gridPath) {
      try {
        const gridBlob = await compressImageToGrid(source);
        gridBytes = gridBlob.size || 0;
        if (gridBytes >= GRID_MIN_VALID_BYTES && await blobLooksLikeUsableImage(gridBlob)) {
          await uploadStorageBlob(gridPath, gridBlob, { skipVerify: true });
          markGridThumbReady(cardId);
        }
      } catch (e) {
        console.warn('[SupabaseSync] grid thumb upload failed', cardId, e);
      }
    }
    const totalBytes = (fullBlob.size || 0) + gridBytes;
    window.__lastCardUploadMeta = {
      cardId: String(cardId),
      bytes: fullBlob.size,
      gridBytes,
      totalBytes,
      original,
      encodeMode
    };
    if (totalBytes > 0 && window.PromptHubApi?.reportStorageDelta) {
      void window.PromptHubApi.reportStorageDelta(totalBytes).then((r) => {
        if (!r?.ok && r?.message && typeof showToast === 'function') {
          showToast(r.message);
        }
      });
    }
    return toStorageRef(path);
  }

  async function resolveCardDownloadUrl(image, opts = {}) {
    if (!image || typeof image !== 'string') return image || null;
    if (isDataUrl(image) || image.startsWith('blob:')) return image;
    const assetId = opts?.assetId;
    const normalized = normalizeImageRef(image);
    const jobId = opts?.jobId ? generationStorageAssetId(opts.jobId, '') : '';
    const candidates = pathsForVariant(normalized, assetId, opts?.authorId, VARIANT_FULL, opts?.jobId || jobId)
      .filter((p) => !isGridStoragePath(p));
    for (const raw of candidates) {
      const key = raw.replace(/^\//, '');
      if (isPathKnownMissing(key)) continue;
      if (opts.forceRefresh === true) {
        signedUrlCache.delete(signedCacheKey(key, VARIANT_FULL));
        signedUrlCache.delete(signedCacheKey(key, VARIANT_GRID));
      }
      const url = await resolvePathToUrl(raw, VARIANT_FULL, {
        cardId: assetId,
        authorId: opts?.authorId,
        communityFeed: opts?.communityFeed === true,
        bypassSignBudget: true
      });
      if (!url) continue;
      if (await verifyMediaUrlReachable(url)) return url;
      invalidateSignedCache(key);
    }
    return null;
  }

  /** 侧栏/编辑面板/灯箱：优先 full 原图；原图不存在时回退可用 grid 预览 */
  async function resolvePreviewFullUrl(image, opts = {}) {
    if (!image || typeof image !== 'string') return '';
    if (isDataUrl(image) || image.startsWith('blob:')) return image;
    if (/^https?:\/\//i.test(image) && !isInvalidMediaUrl(image)) {
      if (await verifyMediaUrlReachable(image)) return image;
    }
    const assetId = opts.assetId || opts.cardId;
    const slotJobId = opts?.jobId ? String(opts.jobId) : '';
    const storageJobKey = slotJobId ? generationStorageAssetId(slotJobId, '') : '';
    const galleryIndex = Number.isFinite(opts.galleryIndex) ? opts.galleryIndex : null;
    const cached = getCachedDisplayUrl(image, {
      assetId,
      authorId: opts.authorId,
      variant: VARIANT_FULL
    });
    if (cached && isValidSignedDisplayUrl(cached) && !isInvalidMediaUrl(cached)
      && await verifyMediaUrlReachable(cached)) return cached;
    const useJobApi = opts.useJobImageApi === true
      && (galleryIndex == null || galleryIndex <= 0);
    const baseJobId = slotJobId.replace(/#\d+$/, '');
    if (useJobApi && baseJobId && window.PromptHubApi?.getGenerationImageUrl) {
      try {
        const r = await window.PromptHubApi.getGenerationImageUrl(baseJobId);
        if (r?.ok && r.data?.url) return r.data.url;
      } catch (e) { /* ignore */ }
    }
    const dl = await resolveCardDownloadUrl(image, {
      assetId,
      authorId: opts.authorId,
      communityFeed: opts.communityFeed === true,
      jobId: slotJobId || storageJobKey
    });
    if (dl) return dl;
    const resolved = await resolveDisplayUrl(image, {
      assetId,
      authorId: opts.authorId,
      cardId: opts.cardId || assetId,
      jobId: slotJobId || storageJobKey || undefined,
      variant: VARIANT_FULL,
      tryAllPaths: true,
      preferFull: true,
      listOnly: false,
      allowFullFallback: true,
      bypassSignBudget: true,
      communityFeed: opts.communityFeed === true
    });
    if (resolved && typeof resolved === 'string' && await verifyMediaUrlReachable(resolved)) return resolved;
    if (opts.allowGridFallback !== false) {
      const gridHint = opts.gridFallbackUrl || opts.fallbackGridUrl;
      if (gridHint && /^https?:\/\//i.test(gridHint) && await verifyMediaUrlReachable(gridHint)) {
        return gridHint;
      }
      const grid = await resolveListGridFallbackUrl(image, {
        assetId,
        authorId: opts.authorId,
        cardId: opts.cardId || assetId,
        communityFeed: opts.communityFeed === true
      });
      if (grid) return grid;
    }
    return '';
  }

  async function deleteCardImageByUrl(url, opts = {}) {
    if (!url || !isStorageRef(url)) return;
    const path = storagePathFromRef(url);
    if (!path) return;
    if (isGeneratedArchivePath(path) && opts.allowGenerated !== true) return;

    if (window.PromptHubApi?.isConfigured?.() && window.PromptHubApi.deleteOwnedCardImage) {
      try {
        const r = await window.PromptHubApi.deleteOwnedCardImage(url, {
          excludeCardId: opts.excludeCardId,
          allowGenerated: opts.allowGenerated === true,
          force: opts.force === true,
          genJobId: opts.genJobId
        });
        if (r?.ok) return;
        throw new Error(r?.message || 'delete-owned failed');
      } catch (e) {
        console.warn('[SupabaseSync] delete-owned API failed, fallback storage.remove', e);
      }
    }

    const sb = getClient();
    if (!sb) return;
    const grid = gridPathFromPrimary(path);
    const removeList = grid ? [path, grid] : [path];
    await sb.storage.from(BUCKET).remove(removeList);
  }

  function clearPathMissingForCard(cardId, image) {
    for (const p of listImagePathCandidates(image, cardId)) {
      const nk = normalizePathKey(p);
      missingPathCache.delete(nk);
      if (/_grid\.(jpe?g|webp|png)$/i.test(nk)) gridFetchFailedPaths.delete(nk);
      else {
        const grid = gridPathFromPrimary(p);
        if (grid) gridFetchFailedPaths.delete(normalizePathKey(grid));
      }
    }
    persistMissingPathCache();
  }

  /** 清除误标的「无图」缓存（网速慢时 audit 曾误判，导致黑块） */
  function resetMissingPathCache() {
    missingPathCache.clear();
    gridFetchFailedPaths.clear();
    try { localStorage.removeItem(LS_MISSING_PATHS); } catch (e) { /* ignore */ }
  }

  function healMissingPathCacheForCards(cards) {
    if (!Array.isArray(cards)) return 0;
    let n = 0;
    for (const c of cards) {
      if (!c?.id || !c?.image) continue;
      clearPathMissingForCard(c.id, c.image);
      n += 1;
    }
    return n;
  }

  function uploadOptsForCard(card) {
    const forceOriginal = isGeneratedWarehouseCard(card);
    return {
      original: forceOriginal || card?.imageUploadOriginal === true || cardUploadOriginalEnabled()
    };
  }

  async function fetchBlobFromCdnPath(path, assetId) {
    const key = String(path || '').replace(/^\//, '');
    if (!key || isGridStoragePath(key)) return null;
    try {
      const url = await resolvePathToUrl(toStorageRef(key), VARIANT_FULL, {
        cardId: assetId,
        bypassSignBudget: true
      });
      if (!url) return null;
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) return null;
      const ct = String(res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('json')) return null;
      const blob = await res.blob();
      if ((blob.size || 0) < MIN_VALID_IMAGE_BYTES) return null;
      if (blob.type && blob.type.includes('json')) return null;
      return blob;
    } catch (e) {
      return null;
    }
  }

  async function downloadCardStorageBlob(image, assetId, opts = {}) {
    if (!image || typeof image !== 'string' || !isLoggedIn()) return null;
    await ensureSession();
    const sb = getClient();
    if (!sb) return null;
    const normalized = normalizeImageRef(image);
    const minBytes = Math.max(0, Number(opts?.minBytes) || 0);
    const jobId = opts?.jobId || null;
    const preferLargest = opts.preferLargest !== false && !!jobId;
    const candidates = pathsForVariant(normalized, assetId, null, VARIANT_FULL, jobId)
      .filter((p) => !isGridStoragePath(p));
    let bestSmall = null;
    let bestBlob = null;
    let bestAboveMin = null;
    for (const raw of candidates) {
      const key = String(raw || '').replace(/^\//, '');
      if (!key || isGridStoragePath(key)) continue;
      let blob = null;
      try {
        const { data, error } = await sb.storage.from(BUCKET).download(key);
        if (!error && data && data.size > 0) blob = data;
      } catch (e) {
        console.warn('[SupabaseSync] storage download failed', key, e);
      }
      if (!blob) {
        blob = await fetchBlobFromCdnPath(key, assetId);
      }
      if (blob && blob.size > 0) {
        if (preferLargest) {
          if (!bestBlob || blob.size > bestBlob.size) bestBlob = blob;
          if (minBytes > 0 && blob.size >= minBytes) {
            if (!bestAboveMin || blob.size > bestAboveMin.size) bestAboveMin = blob;
          }
          continue;
        }
        if (minBytes > 0 && blob.size < minBytes) {
          if (!bestSmall || blob.size > bestSmall.size) bestSmall = blob;
          continue;
        }
        return blob;
      }
    }
    if (preferLargest) return bestAboveMin || bestBlob;
    return bestSmall;
  }

  async function rearchiveGeneratedCardFromJob(card) {
    if (!card?.genJobId || !window.PromptHubApi?.recoverWarehouseFromJobs) return false;
    const jobId = String(card.genJobId).replace(/#\d+$/, '');
    try {
      const r = await window.PromptHubApi.recoverWarehouseFromJobs({
        mode: 'repair',
        jobIds: [jobId],
        max: 1,
        days: 7
      });
      if (r?.ok && (r.data?.repaired > 0 || (r.data?.cardIds || []).length)) return true;
    } catch (e) {
      console.warn('[SupabaseSync] server repair gen image failed', jobId, e);
    }
    if (!window.PromptHubApi?.getGenerationImageUrl) return false;
    try {
      if (window.WarehouseThumb?.resolveForCard) {
        await window.WarehouseThumb.resolveForCard(card.image, {
          jobId,
          assetId: card.id,
          cardId: card.id
        });
      }
      return !!(card.image && isStorageRef(card.image));
    } catch (e) {
      console.warn('[SupabaseSync] rearchive from job url failed', jobId, e);
      return false;
    }
  }

  /** 生图下载：多路径取最大体积；体积不达标时从上游任务重新归档 */
  async function downloadCardFullResBlob(card, opts = {}) {
    if (!card?.image) return null;
    const skipRepair = opts.skipRepair === true;
    const resKey = opts.resolution || card.resolution || '1k';
    const minBytes = expectedMinFullImageBytes(resKey);
    const jobId = card.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : null;
    const dlOpts = { jobId, minBytes, preferLargest: !!jobId };
    let blob = await downloadCardStorageBlob(card.image, card.id, dlOpts);
    const usableFloor = Math.min(minBytes || 0, 80 * 1024);
    const tooSmall = minBytes > 0 && blob && blob.size < usableFloor;
    if (blob && !tooSmall) return blob;
    if (skipRepair && !tooSmall) return blob;
    if (isGeneratedWarehouseCard(card) && jobId) {
      await rearchiveGeneratedCardFromJob(card);
      blob = await downloadCardStorageBlob(card.image, card.id, dlOpts);
      if (blob && (!minBytes || blob.size >= minBytes)) return blob;
    }
    return blob;
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
        const url = await uploadCardImage(cardId, image, uploadOptsForCard(card));
        if (typeof window.clearCardImageBackup === 'function') {
          await window.clearCardImageBackup(cardId);
        }
        clearPathMissingForCard(cardId, url);
        return { ok: true, image: url, uploaded: true };
      } catch (e) {
        return { ok: false, image, error: formatError(e) };
      }
    }

    if (typeof image === 'string' && /^https?:\/\//i.test(image)) {
      if (isCdnMediaUrl(image) || /supabase\.co\/storage\/v1\/object/i.test(image)) {
        return { ok: true, image: normalizeImageRef(image) || image };
      }
      if (/aitohumanize|filesystem\.site|apimart\.ai|grsai\.com/i.test(image)) {
        markImageUploadSkip(cardId);
        return { ok: true, image };
      }
      try {
        const url = await resolveCardImageForSave(cardId, image, null, uploadOptsForCard(card));
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
    clearPathMissingForCard(cardId, normalized);
    if (await verifyStorageRef(normalized, cardId, { quick: false })) {
      return { ok: true, image: normalized };
    }
    const existing = await downloadCardStorageBlob(normalized, cardId);
    if (existing && isValidImageBlob(existing) && await blobLooksLikeUsableImage(existing)) {
      clearPathMissingForCard(cardId, normalized);
      return { ok: true, image: normalized };
    }

    if (isGeneratedWarehouseCard(card) && card.genJobId) {
      const repaired = await rearchiveGeneratedCardFromJob(card);
      if (repaired) {
        const fresh = card.image || normalized;
        if (await verifyStorageRef(fresh, cardId, { quick: false })) {
          return { ok: true, image: fresh, repaired: true };
        }
      }
      markImageUploadSkip(cardId);
      return {
        ok: false,
        image: normalized,
        error: '生图原图归档中，请稍后在仓库点下载重试（勿用列表缩略图覆盖原图）'
      };
    }

    const fallback = await resolveLocalImageFallback(cardId, image);
    if (!fallback) {
      markImageUploadSkip(cardId);
      markPathMissing(primaryImagePath(image, cardId) || normalized);
      return { ok: false, image: normalized, error: '云端无图且本机无备份，请重新添加图片' };
    }
    try {
      if (!(await blobLooksLikeUsableImage(fallback))) {
        markImageUploadSkip(cardId);
        return { ok: false, image: normalized, error: '本地备份无效（全黑或损坏），已拒绝覆盖云端' };
      }
      const url = await uploadCardImage(cardId, fallback, uploadOptsForCard(card));
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
          && !(await verifyStorageRef(card.image, card.id, { quick: false })));

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

  async function resolveCardImageForSave(cardId, imageValue, previousUrl, opts = {}) {
    if (!imageValue) {
      if (previousUrl && isStorageRef(previousUrl)) {
        await deleteCardImageByUrl(previousUrl, { allowGenerated: true, excludeCardId: cardId, force: true });
      }
      return null;
    }
    if (!isLoggedIn()) return imageValue;
    const uploadOpts = { original: opts.original };
    if (isStorageRef(imageValue)) {
      const normalized = normalizeImageRef(imageValue);
      if (previousUrl && normalizeImageRef(previousUrl) === normalized) return normalized;
      if (await verifyStorageRef(normalized, cardId, { quick: true })) return normalized;
      const fallback = await resolveLocalImageFallback(cardId, imageValue);
      if (fallback) {
        const url = await uploadCardImage(cardId, fallback, uploadOpts);
        clearPathMissingForCard(cardId, url);
        if (previousUrl && previousUrl !== url && isStorageRef(previousUrl)) {
          await deleteCardImageByUrl(previousUrl, { excludeCardId: cardId, force: true });
        }
        if (typeof window.clearCardImageBackup === 'function') {
          await window.clearCardImageBackup(cardId);
        }
        return url;
      }
      throw new Error('图片在云端已丢失，请重新选择图片后再保存');
    }
    if (imageValue instanceof Blob) {
      const url = await uploadCardImage(cardId, imageValue, uploadOpts);
      if (previousUrl && previousUrl !== url && isStorageRef(previousUrl)) {
        await deleteCardImageByUrl(previousUrl, { excludeCardId: cardId, force: true });
      }
      return url;
    }
    if (isDataUrl(imageValue) || (typeof imageValue === 'string' && imageValue.startsWith('blob:'))) {
      const url = await uploadCardImage(cardId, imageValue, uploadOpts);
      if (previousUrl && previousUrl !== url && isStorageRef(previousUrl)) {
        await deleteCardImageByUrl(previousUrl, { excludeCardId: cardId, force: true });
      }
      return url;
    }
    if (/^https?:\/\//i.test(imageValue)) {
      try {
        const blob = await fetchRemoteImageBlob(imageValue);
        const url = await uploadCardImage(cardId, blob, uploadOpts);
        if (previousUrl && previousUrl !== url && isStorageRef(previousUrl)) {
          await deleteCardImageByUrl(previousUrl, { excludeCardId: cardId, force: true });
        }
        return url;
      } catch (e) {
        console.warn('[SupabaseSync] card image fetch failed', e);
        throw new Error(String(e?.message || '远程图片下载失败，请换一张本地图片重试'));
      }
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
    const list = Array.isArray(cards) ? cards : [];
    const concurrency = Math.max(
      1,
      Number(opts.concurrency)
        || (window.matchMedia?.('(max-width: 900px)')?.matches ? 2 : 4)
    );
    const out = new Array(list.length);

    async function prepareOne(card, index) {
      const copy = { ...card };
      if (!copy?.id || !copy.image) {
        out[index] = copy;
        return;
      }
      const mustUpload = cardNeedsCloudImageUpload(copy)
        || (strict && isStorageRef(copy.image) && !shouldSkipImageUploadAttempt(copy.id));
      if (!mustUpload || shouldSkipImageUploadAttempt(copy.id)) {
        out[index] = copy;
        return;
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
      out[index] = copy;
    }

    let cursor = 0;
    async function worker() {
      while (cursor < list.length) {
        const i = cursor++;
        await prepareOne(list[i], i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length || 1) }, () => worker()));
    return { cards: out, warnings: [...new Set(warnings)] };
  }

  async function auditBrokenCardImages(cards, opts = {}) {
    if (!isLoggedIn() || !Array.isArray(cards)) return { broken: [], repaired: [] };
    const capMs = Math.max(2000, Number(opts.capMs) || 6000);
    const deadline = Date.now() + capMs;
    const skipStorageList = opts.skipStorageList !== false;
    const maxScan = Math.max(8, Math.min(24, Number(opts.maxScan) || 16));
    const broken = [];
    const repaired = [];
    let scanned = 0;
    for (const card of cards) {
      if (Date.now() > deadline || scanned >= maxScan) break;
      if (!card?.image) continue;
      if (isDataUrl(card.image) || card.image.startsWith('blob:')) continue;
      if (!isStorageRef(card.image) && !/supabase\.co\/storage\/v1\/object/i.test(card.image)) continue;
      scanned += 1;
      const ok = await verifyStorageRef(card.image, card.id, { quick: true, noDownload: true });
      if (ok) continue;
      let fixed = skipStorageList ? null : await findCardImageInStorage(card.id);
      if (!fixed && typeof window.getCardImageBackup === 'function') {
        const backup = await window.getCardImageBackup(card.id);
        if (backup && isDataUrl(backup)) {
          try {
            fixed = await uploadCardImage(card.id, backup, uploadOptsForCard(card));
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
        clearPathMissingForCard(card.id, fixed);
      } else {
        /** 仅记录；不在 audit 里 markPathMissing（网速慢/签超时会被误判，曾导致数百张黑块） */
        broken.push({
          id: card.id,
          title: (card.title || card.prompt || card.id || '').toString().slice(0, 40),
          inconclusive: true
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
    if (session?.user) resetMediaSignEnvironment({ clearMissing: true });
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
    if (!err) return '操作失败，请稍后重试';
    if (typeof err === 'string') {
      const s = err.trim();
      if (!s || s === '{}') return '操作失败，请稍后重试';
      if (/[\u4e00-\u9fa5]/.test(s)) return s;
      return '操作失败，请稍后重试';
    }
    const status = Number(err.status ?? err.statusCode ?? err.code);
    if (status === 503 || status === 502 || status === 504) {
      return '登录服务暂时繁忙，请 30～60 秒后再试';
    }
    if (status === 429) {
      return '登录尝试过于频繁，请 1 分钟后再试';
    }
    const rawMsg = String(
      err.message || err.error_description || err.msg || err.error || ''
    ).trim();
    const msg = rawMsg.toLowerCase();
    if (/503|502|504|service unavailable|temporarily unavailable|overloaded/.test(msg)) {
      return '登录服务暂时繁忙，请稍后再试';
    }
    if (
      /invalid login|invalid credentials|invalid email or password|invalid authentication credentials|invalid_grant/.test(
        msg
      )
    ) {
      return '邮箱或密码不正确，请核对后重试。仍无法登录？请联系管理员协助重置';
    }
    if (/email not confirmed|confirm your email/.test(msg)) {
      return '账号暂不可用，请尝试重新注册或联系管理员';
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
      return '注册功能暂未开放，请联系管理员';
    }
    if (/phone|sms|otp|invalid token|token has expired/.test(msg)) {
      if (/invalid token|token has expired|expired/.test(msg)) return '验证码错误或已过期';
      if (/phone provider|sms provider|phone auth/.test(msg)) {
        return '手机登录暂未开放，请使用邮箱登录';
      }
      if (/invalid phone/.test(msg)) return '手机号格式不正确';
    }
    if (Number.isFinite(status) && status >= 400) {
      return '操作失败，请稍后重试';
    }
    return '操作失败，请稍后重试';
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

  async function pullCloudMeta() {
    await ensureSession();
    const sb = getClient();
    const uid = getUserId();
    if (!sb || !uid) return null;
    const { data, error } = await sb.from('user_data').select('updated_at').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    return data?.updated_at || null;
  }

  async function pullCloudData(opts = {}) {
    const force = opts?.force === true;
    const ifStale = opts?.ifStale !== false;
    const uid = getUserId();
    if (pullCloudInflight && !force) return pullCloudInflight;
    lastCloudPullSkipped = false;

    pullCloudInflight = (async () => {
      await ensureSession();
      const sb = getClient();
      if (!sb || !uid) return null;

      if (ifStale && !force) {
        const remoteUpdated = await pullCloudMeta();
        const localUpdated = getLocalCloudUpdatedAt(uid);
        if (remoteUpdated && localUpdated && remoteUpdated === localUpdated) {
          lastCloudPullSkipped = true;
          return null;
        }
      }

      const { data, error } = await sb.from('user_data').select('data, updated_at').eq('user_id', uid).maybeSingle();
      if (error) throw error;
      if (data?.updated_at) setLocalCloudUpdatedAt(uid, data.updated_at);
      return data?.data || null;
    })();

    try {
      return await pullCloudInflight;
    } finally {
      pullCloudInflight = null;
    }
  }

  async function pushCloudData(payload, opts = {}) {
    await ensureSession();
    const sb = getClient();
    const uid = getUserId();
    if (!sb || !uid) return { warnings: [] };

    let cloudPayload = null;
    if (!opts.skipSafety && window.CloudSyncSafety?.validatePush) {
      try {
        const remoteUpdated = await pullCloudMeta();
        const localUpdated = getLocalCloudUpdatedAt(uid);
        const canSkipFullCloud = !!(remoteUpdated && localUpdated && remoteUpdated === localUpdated);
        if (!canSkipFullCloud) {
          const { data, error: pullErr } = await sb
            .from('user_data')
            .select('data')
            .eq('user_id', uid)
            .maybeSingle();
          if (pullErr) throw pullErr;
          cloudPayload = data?.data || null;
        }
        const check = window.CloudSyncSafety.validatePush(payload, cloudPayload || {});
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
    let preparedCards = payload.cards || [];
    let warnings = [];
    if (opts.deferImageUpload !== true) {
      const prep = await prepareCardsForCloud(payload.cards || [], {
        strict: opts.strictImageCheck === true,
        concurrency: opts.concurrency
      });
      preparedCards = prep.cards;
      warnings = prep.warnings;
    }
    const restoredCards = (preparedCards || []).map((c) => {
      const snap = imageSnapshot.find((s) => String(s.id) === String(c.id));
      if (snap?.image && !c.image) return { ...c, image: snap.image };
      return c;
    });
    const prepared = slimPayloadForCloudStorage({
      ...payload,
      cards: restoredCards,
      schemaVersion: window.CloudSyncSafety?.SCHEMA_VERSION || 2
    });
    const updatedAt = new Date().toISOString();
    const { error } = await sb.from('user_data').upsert({
      user_id: uid,
      data: prepared,
      updated_at: updatedAt
    }, { onConflict: 'user_id' });
    if (error) throw new Error(formatError(error));
    setLocalCloudUpdatedAt(uid, updatedAt);
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
    storagePathOwnedByCurrentUser,
    primaryImagePath,
    isGridStoragePath,
    storagePathFromCdnUrl,
    isWarehouseBlockedFullUrl,
    needsDegradedListPreview,
    gridListNeedsPrimaryFallback,
    communityListGridRef,
    storagePathFromDisplayUrl,
    isPathKnownMissing,
    markPathMissing,
    resetMediaSignEnvironment,
    clearPathMissingForCard,
    resetMissingPathCache,
    healMissingPathCacheForCards,
    markGridFetchFailed,
    clearSessionGridFetchFailures,
    bootstrapWarehouseMediaCache,
    isGridFetchFailed,
    isGridFetchFailed,
    shouldSignGridPath,
    resolveListPrimaryFallback,
    cardImageStillResolvable,
    isLegacyImageRestorePhase,
    shouldShowCardInWarehouse,
    shouldShowPostInCommunityFeed,
    isInvalidMediaUrl,
    isCdnMediaUrl,
    isGridDisplayUrl,
    safeListImgUrl,
    invalidateCorruptGrid,
    warmGeneratedGridThumb,
    isEphemeralUpstreamImageUrl,
    normalizeImageRef,
    resolveDisplayUrl,
    prefetchDisplayUrls,
    prefetchDisplayUrlsWithCap,
    prefetchCardsImages,
    prefetchWarehousePage,
    cardListThumbStorageRef,
    cardNeedsWarehouseThumbServer,
    isGeneratedStoragePath,
    cardUsesGeneratedStorage,
    batchSignPaths,
    prefetchCommunityDisplayUrls,
    patchImageSrcFromCache,
    getCachedDisplayUrl,
    getListDisplayImageSrc,
    listImagePathCandidates,
    cardImageStoragePath,
    gridImageStoragePath,
    gridPathFromPrimary,
    blobLooksLikeUsableImage,
    downloadOwnedStorageBlob,
    verifyStorageRef,
    toStorageRef,
    invalidateSignedCache,
    invalidateSignedCacheForRef,
    isFreshSignedDisplayUrl,
    isValidSignedDisplayUrl,
    isResolvableDisplayUrl,
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
    archiveGeneratedCardImage,
    uploadGeneratedImage,
    clearSignedUrlCache,
    clearListImageMissMarks,
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
    pullCloudMeta,
    pullCloudData,
    wasLastCloudPullSkipped,
    getLocalCloudUpdatedAt,
    pushCloudData,
    uploadCardImage,
    uploadImageGenRef,
    deleteCardImageByUrl,
    resolveCardImageForSave,
    resolveCardDownloadUrl,
    resolvePreviewFullUrl,
    downloadCardStorageBlob,
    downloadCardFullResBlob,
    isGeneratedWarehouseCard,
    expectedMinFullImageBytes,
    rearchiveGeneratedCardFromJob,
    cardUploadOriginalEnabled,
    preserveOriginalCardImageFromSettings,
    prepareCardFullUploadBlob,
    ensureCardImageOnCloud,
    cardNeedsCloudImageUpload,
    payloadNeedsImageUpload,
    repairMissingCardImages,
    clearGridMissingMarksForReadyCards,
    backfillGridThumbsForCards,
    diagnoseGridBackfillPending,
    queueGridBackfill,
    isGridThumbReady,
    isGridBackfillSkipped,
    clearGridBackfillSkipped,
    prepareCardsForCloud,
    formatError
  };
})();

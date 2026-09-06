/**
 * 生图卡列表缩略图唯一入口：服务端归档 + 生成 _grid，浏览器只拿 CDN grid URL。
 */
(function () {
  'use strict';

  const cache = new Map();
  const inflight = new Map();
  let pending = [];
  let flushTimer = null;
  let thumbsBackoffUntil = 0;
  let thumbsBackoffWarned = false;
  const BATCH_DELAY_MS = 16;
  const MAX_BATCH = 24;
  const THUMBS_BACKOFF_MS = 180000;
  const LS_WH_GRID = 'ph_wh_grid_v1';
  const WH_GRID_TTL_MS = 45 * 60 * 1000;

  function readWhGridSession() {
    try {
      const raw = sessionStorage.getItem(LS_WH_GRID);
      if (!raw) return {};
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return {};
      const now = Date.now();
      const out = {};
      for (const [k, v] of Object.entries(data)) {
        if (v?.url && v.expiresAt > now) out[k] = v.url;
      }
      return out;
    } catch (e) {
      return {};
    }
  }

  function writeWhGridSession(key, url) {
    if (!key || !url) return;
    try {
      const data = readWhGridSessionRaw();
      data[key] = { url, expiresAt: Date.now() + WH_GRID_TTL_MS };
      const keys = Object.keys(data);
      if (keys.length > 240) {
        keys.sort((a, b) => (data[a]?.expiresAt || 0) - (data[b]?.expiresAt || 0));
        keys.slice(0, keys.length - 200).forEach((k) => delete data[k]);
      }
      sessionStorage.setItem(LS_WH_GRID, JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }

  function readWhGridSessionRaw() {
    try {
      const raw = sessionStorage.getItem(LS_WH_GRID);
      if (!raw) return {};
      const data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : {};
    } catch (e) {
      return {};
    }
  }

  (function hydrateWhGridFromSession() {
    const sess = readWhGridSession();
    for (const [k, url] of Object.entries(sess)) {
      if (url && isGridUrl(url)) cache.set(k, url);
    }
  })();

  function mobileBatchTuning() {
    const p = window.MobileUI?.getPerf?.();
    if (!p) return { delay: BATCH_DELAY_MS, max: MAX_BATCH };
    return { delay: p.warehouseThumbDelay ?? BATCH_DELAY_MS, max: Math.min(p.warehouseThumbBatch ?? MAX_BATCH, MAX_BATCH) };
  }

  function slotJobId(baseJobId, slot) {
    const base = String(baseJobId || '').replace(/#\d+$/, '');
    if (!Number.isFinite(slot) || slot <= 0) return base;
    return `${base}#${slot + 1}`;
  }

  function cacheKey(jobId, slot) {
    return `${String(jobId || '').replace(/#\d+$/, '')}:${Number(slot) || 0}`;
  }

  function gallerySlotFromJobId(jobId) {
    const m = String(jobId || '').match(/#(\d+)$/);
    if (!m) return 0;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 1 ? n - 1 : 0;
  }

  function isGridUrl(url) {
    return !!(url && window.SupabaseSync?.isGridDisplayUrl?.(url));
  }

  function cachedGridUrl(image, assetId, jobId, slot) {
    const base = String(jobId || '').replace(/#\d+$/, '');
    const ck = cacheKey(base, slot);
    if (cache.has(ck)) return cache.get(ck);
    if (assetId && window.SupabaseSync?.getListDisplayImageSrc) {
      const url = window.SupabaseSync.getListDisplayImageSrc(image, assetId, {
        jobId: slotJobId(base, slot),
        allowFullFallback: false
      });
      if (url && isGridUrl(url)) return url;
    }
    return '';
  }

  /** 仅当无可用 storage 引用或路径已标 missing 时才走 warehouse-thumbs */
  function needsServerThumb(image, jobId, opts) {
    if (!jobId || !window.PromptHubApi?.postWarehouseThumbs) return false;
    if (!window.SupabaseSync?.isLoggedIn?.()) return false;
    if (image && window.SupabaseSync?.isStorageRef?.(image)) {
      const path = window.SupabaseSync.storagePathFromRef?.(image);
      if (path && window.SupabaseSync.storagePathOwnedByCurrentUser?.(path)) {
        const pkey = String(path).replace(/^\//, '');
        if (!window.SupabaseSync.isPathKnownMissing?.(pkey)) {
          const slot = Number.isFinite(opts?.galleryIndex) ? opts.galleryIndex : gallerySlotFromJobId(jobId);
          const base = String(jobId).replace(/#\d+$/, '');
          if (cachedGridUrl(image, opts?.assetId || opts?.cardId, base, slot)) return false;
          return false;
        }
        if (window.SupabaseSync?.isGeneratedStoragePath?.(pkey)) return true;
      }
    }
    const slot = Number.isFinite(opts?.galleryIndex) ? opts.galleryIndex : gallerySlotFromJobId(jobId);
    const base = String(jobId).replace(/#\d+$/, '');
    if (cachedGridUrl(image, opts?.assetId || opts?.cardId, base, slot)) return false;
    return true;
  }

  function rememberUrl(key, url, cardId) {
    if (!url) return '';
    cache.set(key, url);
    writeWhGridSession(key, url);
    if (cardId && window.SupabaseSync?.markGridThumbReady) {
      window.SupabaseSync.markGridThumbReady(cardId);
    }
    return url;
  }

  function scheduleFlush() {
    if (flushTimer) return;
    const { delay } = mobileBatchTuning();
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushPending();
    }, delay);
  }

  function enterThumbsBackoff(reason) {
    thumbsBackoffUntil = Date.now() + THUMBS_BACKOFF_MS;
    if (!thumbsBackoffWarned) {
      thumbsBackoffWarned = true;
      console.warn('[WarehouseThumb] API 暂不可用，3 分钟内不再请求缩略图', reason || '');
    }
  }

  async function flushPending() {
    if (!pending.length) return;
    if (window.__phBulkRepairActive) {
      const defer = pending.splice(0, pending.length);
      defer.forEach((item) => item.resolve(''));
      return;
    }
    const { max } = mobileBatchTuning();
    const batch = pending.splice(0, max);
    if (pending.length) scheduleFlush();

    if (Date.now() < thumbsBackoffUntil) {
      batch.forEach((item) => item.resolve(''));
      return;
    }

    const grouped = new Map();
    for (const item of batch) {
      const ck = cacheKey(item.baseJobId, item.slot);
      const hit = cache.get(ck);
      if (hit) {
        item.resolve(hit);
        continue;
      }
      if (!grouped.has(ck)) {
        grouped.set(ck, {
          baseJobId: item.baseJobId,
          slot: item.slot,
          cardId: item.cardId,
          waiters: []
        });
      }
      grouped.get(ck).waiters.push(item.resolve);
    }
    if (!grouped.size) return;

    const jobs = [...grouped.values()].map((g) => ({
      jobId: slotJobId(g.baseJobId, g.slot),
      slot: g.slot || 0
    }));

    let thumbs = {};
    try {
      const res = await window.PromptHubApi.postWarehouseThumbs(jobs);
      if (res?.ok === false) {
        if (res.status === 503 || res.status === 524 || res.code === 'NETWORK_ERROR') {
          enterThumbsBackoff(res.message || res.code);
        } else {
          console.warn('[WarehouseThumb] batch rejected', res?.message || res?.code);
        }
      }
      thumbs = res?.data?.thumbs || res?.thumbs || {};
    } catch (e) {
      enterThumbsBackoff(String(e?.message || e));
    }

    for (const [ck, g] of grouped) {
      const url = thumbs[ck] || '';
      const out = url && isGridUrl(url) ? rememberUrl(ck, url, g.cardId) : '';
      g.waiters.forEach((fn) => fn(out));
    }
  }

  function enqueue(baseJobId, slot, cardId) {
    const ck = cacheKey(baseJobId, slot);
    const hit = cache.get(ck);
    if (hit) return Promise.resolve(hit);

    if (inflight.has(ck)) return inflight.get(ck);

    const p = new Promise((resolve) => {
      pending.push({ baseJobId, slot, cardId, resolve });
      scheduleFlush();
    }).finally(() => {
      inflight.delete(ck);
    });
    inflight.set(ck, p);
    return p;
  }

  async function resolveForCard(image, opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const jobId = o.jobId ? String(o.jobId) : '';
    if (!jobId) return '';
    const slot = Number.isFinite(o.galleryIndex) ? o.galleryIndex : gallerySlotFromJobId(jobId);
    const baseJobId = jobId.replace(/#\d+$/, '');
    const cardId = o.assetId || o.cardId || '';

    const cached = cachedGridUrl(image, cardId, baseJobId, slot);
    if (cached) return cached;

    if (!needsServerThumb(image, jobId, o)) return '';

    const url = await enqueue(baseJobId, slot, cardId);
    return url || '';
  }

  /** 从 card 对象解析列表缩略图（卡片库 / 生图 feed / 编辑预览共用） */
  async function resolveForCardModel(card) {
    if (!card?.id) return '';
    window.SupabaseSync?.clearPathMissingForCard?.(card.id, card.image);
    const thumb = window.PromptHubCardGallery?.pickWarehouseListThumb?.(card)
      || window.PromptHubCardGallery?.pickWarehouseFeedCover?.(card);
    const ref = thumb?.ref || card.image || '';
    const galleryIndex = thumb?.galleryIndex ?? 0;
    const jobId = thumb?.slotJobId?.replace(/#\d+$/, '')
      || window.PromptHubCardGallery?.resolveGenJobIdFromCard?.(card)
      || (card.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : '');
    if (!ref && !jobId) return '';
    if (ref && window.SupabaseSync?.getListDisplayImageSrc) {
      const cached = window.SupabaseSync.getListDisplayImageSrc(ref, card.id, {
        jobId: jobId || undefined,
        allowFullFallback: false
      });
      if (cached && isGridUrl(cached)) return cached;
    }
    if (ref && window.SupabaseSync?.isStorageRef?.(ref)) {
      const path = window.SupabaseSync.storagePathFromRef?.(ref);
      if (path && window.SupabaseSync.storagePathOwnedByCurrentUser?.(path)) {
        const pkey = String(path).replace(/^\//, '');
        const isGen = window.SupabaseSync?.isGeneratedStoragePath?.(pkey);
        if (!isGen && !window.SupabaseSync.isPathKnownMissing?.(pkey) && window.SupabaseSync?.resolveDisplayUrl) {
          try {
            const signed = await window.SupabaseSync.resolveDisplayUrl(ref, {
              assetId: card.id,
              cardId: card.id,
              jobId: thumb?.slotJobId || jobId || undefined,
              galleryIndex,
              variant: 'grid',
              listOnly: true,
              allowFullFallback: false,
              tryAllPaths: true
            });
            if (signed && isGridUrl(signed)) return signed;
          } catch (e) { /* fallback warehouse */ }
        }
      }
    }
    if (jobId && needsServerThumb(ref, thumb?.slotJobId || slotJobId(jobId, galleryIndex), {
      assetId: card.id,
      cardId: card.id,
      galleryIndex
    })) {
      const wh = await resolveForCard(ref, {
        jobId: thumb?.slotJobId || slotJobId(jobId, galleryIndex),
        assetId: card.id,
        cardId: card.id,
        galleryIndex
      });
      if (wh) return wh;
    }
    if (window.MediaPipeline?.resolveListUrl) {
      return window.MediaPipeline.resolveListUrl(ref, {
        assetId: card.id,
        cardId: card.id,
        jobId: jobId || undefined,
        galleryIndex,
        tryAllPaths: true
      });
    }
    return '';
  }

  async function prefetchForCards(cards, opts) {
    const list = Array.isArray(cards) ? cards : [];
    const max = Math.min(opts?.max || warehousePrefetchCardCap(), list.length);
    const needServer = [];
    for (let i = 0; i < max; i += 1) {
      const card = list[i];
      if (!card?.id) continue;
      if (window.SupabaseSync?.cardNeedsWarehouseThumbServer?.(card)) {
        needServer.push(card);
      }
    }
    if (!needServer.length) return;

    const jobEntries = [];
    const seenKeys = new Set();
    for (const card of needServer) {
      const thumb = window.PromptHubCardGallery?.pickWarehouseListThumb?.(card)
        || window.PromptHubCardGallery?.pickWarehouseFeedCover?.(card);
      const baseJob = window.PromptHubCardGallery?.resolveGenJobIdFromCard?.(card)
        || (card.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : '');
      if (!baseJob) continue;
      const galleryIndex = thumb?.galleryIndex ?? 0;
      const slot = Number.isFinite(galleryIndex) ? galleryIndex : 0;
      const resolvedJobId = thumb?.slotJobId || slotJobId(baseJob, slot);
      const ck = cacheKey(baseJob, slot);
      if (seenKeys.has(ck) || cache.has(ck)) continue;
      seenKeys.add(ck);
      jobEntries.push({ card, baseJobId: baseJob, slot, slotJobId: resolvedJobId, ck });
    }
    if (!jobEntries.length) return;

    const { max: batchMax } = mobileBatchTuning();
    for (let i = 0; i < jobEntries.length; i += batchMax) {
      const chunk = jobEntries.slice(i, i + batchMax);
      const jobs = chunk.map((e) => ({
        jobId: e.slotJobId,
        slot: e.slot
      }));
      let thumbs = {};
      try {
        const res = await window.PromptHubApi.postWarehouseThumbs(jobs);
        thumbs = res?.data?.thumbs || res?.thumbs || {};
      } catch (e) {
        console.warn('[WarehouseThumb] prefetch batch failed', e);
      }
      for (const e of chunk) {
        const url = thumbs[e.ck] || '';
        if (url && isGridUrl(url)) rememberUrl(e.ck, url, e.card.id);
      }
    }
  }

  function warehousePrefetchCardCap() {
    const mp = window.MobileUI?.getPerf?.();
    return Math.min(24, Math.max(8, Number(mp?.warehousePrefetchCap) || 24));
  }

  window.WarehouseThumb = {
    resolveForCard,
    resolveForCardModel,
    needsServerThumb,
    prefetchForCards,
    cacheKey,
    slotJobId
  };
})();

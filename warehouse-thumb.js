/**
 * 生图卡列表缩略图唯一入口：服务端归档 + 生成 _grid，浏览器只拿 CDN grid URL。
 */
(function () {
  'use strict';

  const cache = new Map();
  const inflight = new Map();
  let pending = [];
  let flushTimer = null;
  const BATCH_DELAY_MS = 24;
  const MAX_BATCH = 8;
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

  /** 有生图 jobId 且尚无 grid 缓存 → 必须走服务端 warehouse-thumbs */
  function needsServerThumb(image, jobId, opts) {
    if (!jobId || !window.PromptHubApi?.postWarehouseThumbs) return false;
    if (!window.SupabaseSync?.isLoggedIn?.()) return false;
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

  async function flushPending() {
    if (!pending.length) return;
    const { max } = mobileBatchTuning();
    const batch = pending.splice(0, max);
    if (pending.length) scheduleFlush();

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
        console.warn('[WarehouseThumb] batch rejected', res?.message || res?.code);
      }
      thumbs = res?.data?.thumbs || res?.thumbs || {};
    } catch (e) {
      console.warn('[WarehouseThumb] batch failed', e);
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
    if (jobId) {
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
    const concurrency = Math.min(4, max);
    let idx = 0;
    const worker = async () => {
      while (idx < max) {
        const i = idx;
        idx += 1;
        const card = list[i];
        if (!card?.id) continue;
        const thumb = window.PromptHubCardGallery?.pickWarehouseListThumb?.(card)
          || window.PromptHubCardGallery?.pickWarehouseFeedCover?.(card);
        const ref = thumb?.ref || card.image || '';
        const jobId = thumb?.slotJobId?.replace(/#\d+$/, '')
          || window.PromptHubCardGallery?.resolveGenJobIdFromCard?.(card)
          || (card.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : '');
        if (!ref && !jobId) continue;
        if (ref && window.SupabaseSync?.getListDisplayImageSrc) {
          const cached = window.SupabaseSync.getListDisplayImageSrc(ref, card.id, {
            jobId: jobId || undefined,
            allowFullFallback: false
          });
          if (cached && isGridUrl(cached)) continue;
        }
        try {
          await resolveForCardModel(card);
        } catch (e) { /* ignore */ }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
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

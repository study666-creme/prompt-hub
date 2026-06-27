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
  const MAX_BATCH = 24;

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
    if (cardId && window.SupabaseSync?.markGridThumbReady) {
      window.SupabaseSync.markGridThumbReady(cardId);
    }
    return url;
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushPending();
    }, BATCH_DELAY_MS);
  }

  async function flushPending() {
    const batch = pending.splice(0, MAX_BATCH);
    if (!batch.length) return;
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
    const meta = window.PromptHubCardGallery?.getWarehouseListThumbMeta?.(card);
    if (!meta?.hasImage) return '';
    const jobId = meta.jobId || meta.thumbMeta?.slotJobId
      || window.PromptHubCardGallery?.resolveGenJobIdFromCard?.(card)
      || (card.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : '');
    const ref = meta.ref || card.image || '';
    const galleryIndex = meta.galleryIndex ?? 0;
    if (meta.cachedUrl && isGridUrl(meta.cachedUrl)) return meta.cachedUrl;
    if (jobId) {
      const wh = await resolveForCard(ref, {
        jobId: meta.thumbMeta?.slotJobId || slotJobId(jobId, galleryIndex),
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
    const max = Math.min(opts?.max || 16, list.length);
    const tasks = [];
    for (let i = 0; i < max; i += 1) {
      const card = list[i];
      if (!card?.id) continue;
      const meta = window.PromptHubCardGallery?.getWarehouseListThumbMeta?.(card);
      if (!meta?.hasImage) continue;
      tasks.push(resolveForCardModel(card));
    }
    if (!tasks.length) return;
    await Promise.allSettled(tasks);
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

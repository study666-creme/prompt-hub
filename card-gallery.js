/**
 * 卡片多图槽位（最多 5 张）：MJ 四宫格 + 变体
 */
(function (global) {
  'use strict';

  const MAX = 5;

  /** MJ：四宫格合成图 + 最多 4 张单图 */
  function buildMjCardImages(composite, tiles, fallback) {
    const t = (tiles || []).filter(Boolean).slice(0, 4);
    const comp = composite && String(composite).trim();
    if (comp) {
      const rest = t.filter((u) => u !== comp);
      return [comp, ...rest].slice(0, MAX);
    }
    if (t.length) return t.slice(0, MAX);
    const fb = fallback && String(fallback).trim();
    return fb ? [fb] : [];
  }

  function normalizeCardGallery(card) {
    if (!card) return [];
    let imgs = Array.isArray(card.cardImages) ? card.cardImages.filter(Boolean) : [];
    if (!imgs.length && Array.isArray(card.mjGridUrls)) imgs = card.mjGridUrls.filter(Boolean);
    if (!imgs.length && card.image) imgs = [card.image];
    if (card.isMidjourney && card.mjCompositeUrl) {
      const tiles = Array.isArray(card.mjGridUrls) && card.mjGridUrls.length
        ? card.mjGridUrls.filter(Boolean)
        : imgs.slice(1);
      imgs = buildMjCardImages(card.mjCompositeUrl, tiles, imgs[0] || card.image);
    }
    return imgs.slice(0, MAX);
  }

  function isResolvableCoverRef(ref, cardId) {
    if (!ref || typeof ref !== 'string') return false;
    if (global.SupabaseSync?.isInvalidMediaUrl?.(ref)) return false;
    if (global.SupabaseSync?.isEphemeralUpstreamImageUrl?.(ref)) return false;
    if (global.SupabaseSync?.isStorageRef?.(ref)) {
      const path = global.SupabaseSync.storagePathFromRef?.(ref);
      if (path && global.SupabaseSync.isPathKnownMissing?.(path)) return false;
      const primary = global.SupabaseSync.primaryImagePath?.(ref, cardId);
      if (primary && global.SupabaseSync.isPathKnownMissing?.(primary)) return false;
      if (global.SupabaseSync?.cardImageStillResolvable?.(ref, cardId) === false) return false;
      return true;
    }
    if (/^https?:\/\//i.test(ref)) return true;
    if (global.SupabaseSync?.isDataUrl?.(ref) && !/^data:image\/svg/i.test(ref)) return true;
    return false;
  }

  const GEN_JOB_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** genJobId 可能在 tags 里（自动恢复卡） */
  function resolveGenJobIdFromCard(card) {
    if (!card) return null;
    if (card.genJobId) return String(card.genJobId).replace(/#\d+$/, '');
    if (card.feedCoverJobId) return String(card.feedCoverJobId).replace(/#\d+$/, '');
    const tags = Array.isArray(card.tags) ? card.tags : [];
    for (const t of tags) {
      const s = String(t || '').trim();
      if (GEN_JOB_UUID_RE.test(s)) return s;
    }
    return null;
  }

  function isMjCompositeCoverRef(ref, card) {
    if (!ref || !card?.isMidjourney) return false;
    const comp = card.mjCompositeUrl && String(card.mjCompositeUrl).trim();
    if (comp && String(ref) === comp) return true;
    const path = global.SupabaseSync?.storagePathFromRef?.(ref);
    return !!(path && /_grid\.(jpe?g|webp|png)$/i.test(path));
  }

  /** 列表/生图仓库封面：gallery 第一张（MJ 四宫格在 index 0） */
  function getCardFeedCoverImage(card) {
    const list = pickWarehouseListThumb(card);
    if (list?.ref) return list.ref;
    const picked = pickWarehouseFeedCover(card);
    return picked?.ref || null;
  }

  /** 列表/feed 缩略元数据：gallery 第一张（MJ 含四宫格合成图） */
  const thumbMetaGuard = new WeakSet();
  function getWarehouseListThumbMeta(card, opts = {}) {
    if (!card?.id) return { hasImage: false };
    const guarded = thumbMetaGuard.has(card);
    if (!guarded && !opts.skipEnsure) {
      thumbMetaGuard.add(card);
      try {
        ensureFeedCoverFromGallery(card, { persist: false, backfill: false });
      } catch (e) {
        /* 避免 ensure → resolve → meta 递归栈溢出 */
      } finally {
        thumbMetaGuard.delete(card);
      }
    }
    const thumb = pickWarehouseListThumb(card) || pickWarehouseFeedCover(card);
    const gallery = normalizeCardGallery(card);
    const baseJob = resolveGenJobIdFromCard(card) || '';
    const ref = thumb?.ref || card.image || '';
    const slotJobId = thumb?.slotJobId || (baseJob || null);
    const jobId = baseJob || (slotJobId ? String(slotJobId).replace(/#\d+$/, '') : '');
    if (!ref && !gallery.length && !baseJob) return { hasImage: false };
    const listOpts = { jobId: slotJobId || jobId || undefined, allowFullFallback: !!baseJob };
    let cachedUrl = '';
    if (ref && global.SupabaseSync?.getListDisplayImageSrc) {
      cachedUrl = global.SupabaseSync.getListDisplayImageSrc(ref, card.id, listOpts) || '';
    }
    if (!cachedUrl && ref && /^https?:\/\//i.test(ref) && !global.SupabaseSync?.isEphemeralUpstreamImageUrl?.(ref)) {
      const cdnOk = global.SupabaseSync?.isCdnMediaUrl?.(ref) && global.SupabaseSync?.isGridDisplayUrl?.(ref);
      const signedOk = !global.SupabaseSync?.isCdnMediaUrl?.(ref)
        && global.SupabaseSync?.isValidSignedDisplayUrl?.(ref)
        && global.SupabaseSync?.isGridDisplayUrl?.(ref);
      if (cdnOk || signedOk) cachedUrl = ref;
    }
    const hasResolvable = ref && isResolvableCoverRef(ref, card.id);
    const hasGalleryResolvable = gallery.some((u) => isResolvableCoverRef(u, card.id));
    const hasGenJobThumb = !!baseJob;
    const hasGalleryAny = gallery.some((u) => u && String(u).trim());
    return {
      hasImage: !!(cachedUrl || hasResolvable || hasGalleryResolvable || hasGenJobThumb || (hasGalleryAny && baseJob)),
      ref,
      jobId,
      slotJobId,
      cachedUrl,
      galleryIndex: thumb?.galleryIndex ?? 0,
      thumbMeta: thumb,
      gallery
    };
  }

  /** 列表缩略：gallery 第一张可用单图（MJ 跳过四宫格合成 + 临时链） */
  function pickWarehouseListThumb(card) {
    if (!card) return null;
    const gallery = normalizeCardGallery(card);
    if (!gallery.length) return null;
    const baseJob = resolveGenJobIdFromCard(card);
    const pack = (ref, galleryIndex) => ({
      ref,
      galleryIndex: galleryIndex >= 0 ? galleryIndex : 0,
      slotJobId: baseJob ? gallerySlotJobId(baseJob, galleryIndex >= 0 ? galleryIndex : 0) : null,
      gallery
    });
    for (let i = 0; i < gallery.length; i += 1) {
      const u = gallery[i];
      if (!u || !String(u).trim()) continue;
      if (isMjCompositeCoverRef(u, card)) continue;
      if (global.SupabaseSync?.isStorageRef?.(u)) return pack(u, i);
    }
    for (let i = 0; i < gallery.length; i += 1) {
      const u = gallery[i];
      if (!u || !String(u).trim()) continue;
      if (isMjCompositeCoverRef(u, card)) continue;
      if (global.SupabaseSync?.isEphemeralUpstreamImageUrl?.(u)) continue;
      if (isResolvableCoverRef(u, card.id)) return pack(u, i);
    }
    if (baseJob) {
      for (let i = 0; i < gallery.length; i += 1) {
        const u = gallery[i];
        if (!u || !String(u).trim()) continue;
        if (isMjCompositeCoverRef(u, card)) continue;
        return pack(u, i);
      }
      if (card.image && String(card.image).trim()) return pack(card.image, 0);
    }
    return null;
  }

  /** 从 gallery 选仓库/Feed 封面（内页有图、外列表无图时自动补） */
  function pickWarehouseFeedCover(card) {
    if (!card) return null;
    const gallery = normalizeCardGallery(card);
    const cardId = card.id;
    const baseJob = resolveGenJobIdFromCard(card);

    const pack = (ref, galleryIndex) => ({
      ref,
      galleryIndex: galleryIndex >= 0 ? galleryIndex : 0,
      slotJobId: baseJob ? gallerySlotJobId(baseJob, galleryIndex >= 0 ? galleryIndex : 0) : null,
      gallery
    });

    const pickFrom = (list, skipComposite) => {
      for (let i = 0; i < list.length; i += 1) {
        const u = list[i];
        if (!u) continue;
        if (skipComposite && isMjCompositeCoverRef(u, card)) continue;
        if (isFeedListCoverCandidate(u, cardId, card)) {
          return pack(u, gallery.indexOf(u));
        }
      }
      return null;
    };

    if (card.isMidjourney && gallery.length) {
      const head = gallery.find((u) => u && String(u).trim());
      if (head) {
        const idx = gallery.indexOf(head);
        if (isFeedListCoverCandidate(head, cardId, card)) return pack(head, idx >= 0 ? idx : 0);
      }
    }

    const strict = pickFrom(gallery, false);
    if (strict) return strict;

    const relaxed = getCardCoverImage(card);
    if (relaxed) {
      const idx = gallery.findIndex((u) => String(u || '') === String(relaxed));
      return pack(relaxed, idx >= 0 ? idx : 0);
    }
    const first = gallery.find((u) => u && String(u).trim());
    if (first) return pack(first, gallery.indexOf(first));
    return null;
  }

  /** 比 isResolvableCoverRef 略宽：内页能看图时，列表也允许尝试该 ref */
  function isFeedListCoverCandidate(ref, cardId, card) {
    if (!ref || typeof ref !== 'string') return false;
    if (global.SupabaseSync?.isInvalidMediaUrl?.(ref)) return false;
    if (global.SupabaseSync?.isEphemeralUpstreamImageUrl?.(ref)) return false;
    if (/^https?:\/\//i.test(ref) && !global.SupabaseSync?.isStorageRef?.(ref)) return true;
    if (global.SupabaseSync?.isDataUrl?.(ref) && !/^data:image\/svg/i.test(ref)) return true;
    if (global.SupabaseSync?.isStorageRef?.(ref)) {
      if (global.SupabaseSync?.cardImageStillResolvable?.(ref, cardId) !== false) return true;
      if (card?.genJobId || (Array.isArray(card?.cardImages) && card.cardImages.length > 1)) return true;
      const path = global.SupabaseSync?.storagePathFromRef?.(ref);
      if (path && !global.SupabaseSync?.isPathKnownMissing?.(path.replace(/^\//, ''))) return true;
    }
    return isResolvableCoverRef(ref, cardId);
  }

  function getCardFeedCoverMeta(card) {
    const picked = pickWarehouseFeedCover(card);
    if (picked?.ref) return picked;
    const gallery = normalizeCardGallery(card);
    const ref = getCardCoverImage(card);
    const galleryIndex = ref ? gallery.findIndex((u) => String(u || '') === String(ref)) : 0;
    const baseJob = resolveGenJobIdFromCard(card);
    return {
      ref,
      galleryIndex: galleryIndex >= 0 ? galleryIndex : 0,
      slotJobId: baseJob ? gallerySlotJobId(baseJob, galleryIndex >= 0 ? galleryIndex : 0) : null,
      gallery
    };
  }

  function getCardCoverImage(card) {
    const gallery = normalizeCardGallery(card);
    for (const u of gallery) {
      if (!u || typeof u !== 'string') continue;
      if (global.SupabaseSync?.isInvalidMediaUrl?.(u)) continue;
      if (global.SupabaseSync?.isEphemeralUpstreamImageUrl?.(u)) continue;
      if (global.SupabaseSync?.isStorageRef?.(u)) {
        const path = global.SupabaseSync.storagePathFromRef?.(u);
        if (path && global.SupabaseSync.isPathKnownMissing?.(path)) continue;
      }
      return u;
    }
    const fb = card?.image;
    if (fb && typeof fb === 'string' && !global.SupabaseSync?.isInvalidMediaUrl?.(fb)) return fb;
    return null;
  }

  function mergeCardGalleryImages(existing, additions, max = MAX) {
    const out = [...(existing || [])];
    for (const raw of additions || []) {
      const u = raw && String(raw).trim();
      if (!u) continue;
      if (out.some((x) => x === u)) continue;
      if (out.length >= max) break;
      out.push(u);
    }
    return out.slice(0, max);
  }

  /** 将 card.image 同步为列表/feed 可用封面（MJ 优先单图，不用四宫格合成） */
  function syncCardCoverFromGallery(card) {
    if (!card) return false;
    const imgs = normalizeCardGallery(card);
    if (!imgs.length) return false;
    const cover = getCardFeedCoverImage(card);
    if (!cover) return false;
    const cur = card.image;
    if (cur === cover) return false;
    const curBad = !cur || !isResolvableCoverRef(cur, card.id);
    const compositeCover = card.isMidjourney && isMjCompositeCoverRef(cur, card);
    if (!curBad && !compositeCover) return false;
    card.image = cover;
    return true;
  }

  function repairAllFeedCoversQuiet(cardList) {
    if (!Array.isArray(cardList) || !cardList.length) return false;
    let changed = false;
    for (const c of cardList) {
      if (!c?.id) continue;
      const gal = normalizeCardGallery(c);
      if (!gal.length) continue;
      if (ensureFeedCoverFromGallery(c, { persist: false, backfill: false })) {
        changed = true;
      } else if (gal.length >= 2 || c.isMidjourney) {
        if (syncCardCoverFromGallery(c)) {
          c.updatedAt = Date.now();
          changed = true;
        }
      }
    }
    return changed;
  }

  /**
   * 内页 gallery 有图、列表封面缺失时：写入 card.image 并排队生成 _grid 缩略
   */
  function ensureFeedCoverFromGallery(card, opts = {}) {
    if (!card?.id) return false;
    const gallery = normalizeCardGallery(card);
    const picked = pickWarehouseFeedCover(card);
    if (!picked?.ref && gallery.length) {
      const first = gallery.find((u) => u && String(u).trim()) || gallery[0];
      if (first) {
        card.image = first;
        syncCardGalleryFields(card);
        card.updatedAt = Date.now();
        if (opts.persist !== false && typeof global.persistPromptHubCards === 'function') {
          void global.persistPromptHubCards();
        }
        if (opts.backfill !== false && global.SupabaseSync?.queueGridBackfill) {
          global.SupabaseSync.queueGridBackfill(card, { force: opts.forceBackfill === true });
        }
        return true;
      }
      return false;
    }
    if (!picked?.ref) return false;
    global.SupabaseSync?.clearPathMissingForCard?.(card.id, picked.ref);
    let changed = false;
    if (card.image !== picked.ref) {
      card.image = picked.ref;
      changed = true;
    }
    const prevGal = JSON.stringify(normalizeCardGallery(card));
    syncCardGalleryFields(card);
    if (JSON.stringify(normalizeCardGallery(card)) !== prevGal) changed = true;
    if (changed) card.updatedAt = Date.now();
    if (changed && opts.persist !== false && typeof global.persistPromptHubCards === 'function') {
      void global.persistPromptHubCards();
    }
    if (opts.backfill !== false && global.SupabaseSync?.queueGridBackfill) {
      global.SupabaseSync.queueGridBackfill(card, { force: opts.forceBackfill === true });
    }
    return changed;
  }

  function ensureFeedCoversForCards(cardList, opts = {}) {
    if (!Array.isArray(cardList) || !cardList.length) return 0;
    let n = 0;
    for (const c of cardList) {
      if (ensureFeedCoverFromGallery(c, { ...opts, persist: false })) n += 1;
    }
    if (n && opts.persist !== false && typeof global.persistPromptHubCards === 'function') {
      void global.persistPromptHubCards();
    }
    return n;
  }

  /** 卡片库首屏：ensure 仅首屏；append 页只算 meta 不 ensure */
  function prepareWarehousePageThumbs(cardList, opts = {}) {
    const list = Array.isArray(cardList) ? cardList : [];
    if (!list.length) return [];
    if (opts.ensure === true) {
      const ensureMax = Number(opts.ensureMax) > 0 ? Number(opts.ensureMax) : list.length;
      ensureFeedCoversForCards(list.slice(0, ensureMax), { persist: false, backfill: false });
    }
    return list.map((card) => ({
      card,
      meta: getWarehouseListThumbMeta(card, { skipEnsure: true })
    }));
  }

  function syncCardGalleryFields(card) {
    if (!card) return [];
    const imgs = normalizeCardGallery(card);
    card.cardImages = imgs.length ? imgs : null;
    if (imgs.length) {
      const listCover = pickWarehouseListThumb({ ...card, cardImages: imgs });
      card.image = listCover?.ref || getCardFeedCoverImage({ ...card, cardImages: imgs }) || imgs[0];
    }
    if (card.isMidjourney) {
      const comp = card.mjCompositeUrl && String(card.mjCompositeUrl).trim();
      if (comp && imgs[0] === comp) {
        card.mjGridUrls = imgs.slice(1, 5);
      } else if (Array.isArray(card.mjGridUrls) && card.mjGridUrls.length) {
        card.mjGridUrls = card.mjGridUrls.filter(Boolean).slice(0, 4);
      } else {
        card.mjGridUrls = imgs.slice(0, 4);
      }
    }
    return imgs;
  }

  function gallerySlotJobId(baseJobId, galleryIndex) {
    if (!baseJobId) return null;
    const base = String(baseJobId).replace(/#\d+$/, '');
    if (!Number.isFinite(galleryIndex) || galleryIndex <= 0) return base;
    return `${base}#${galleryIndex + 1}`;
  }

  /** 解析 storage / 签名链为可显示的 http(s) URL */
  async function resolveMediaUrl(ref, opts = {}) {
    if (!ref) return '';
    const cardId = opts.cardId || opts.assetId || null;
    const galleryIndex = Number.isFinite(opts.galleryIndex) ? opts.galleryIndex : null;
    const baseJobId = opts.jobId
      ? String(opts.jobId).replace(/#\d+$/, '')
      : (cardId && galleryIndex != null && galleryIndex > 0 ? String(cardId) : null);
    const slotJobId = galleryIndex != null
      ? gallerySlotJobId(baseJobId || opts.jobId, galleryIndex)
      : (opts.jobId ? String(opts.jobId) : null);
    const isCoverSlot = galleryIndex == null || galleryIndex <= 0;
    const wantFull = opts.preferFull === true;
    if (/^https?:\/\//i.test(ref) && !global.SupabaseSync?.isInvalidMediaUrl?.(ref)) {
      if (!global.SupabaseSync?.isStorageRef?.(ref)) {
        if (wantFull) return ref;
        if (global.SupabaseSync?.isGridDisplayUrl?.(ref)) return ref;
        return '';
      }
    }
    const pipeOpts = {
      assetId: cardId,
      cardId,
      jobId: slotJobId || baseJobId || undefined,
      galleryIndex: galleryIndex != null ? galleryIndex : undefined,
      useJobImageApi: opts.useJobImageApi === true || isCoverSlot,
      allowGridFallback: opts.allowGridFallback !== false && isCoverSlot
    };
    if (!wantFull && global.MediaPipeline?.resolveListUrl) {
      try {
        const u = await global.MediaPipeline.resolveListUrl(ref, {
          ...pipeOpts,
          tryAllPaths: true,
          allowFullFallback: false
        });
        if (u && !/data:image\/svg/i.test(u)) return u;
      } catch (e) { /* ignore */ }
    }
    if (wantFull && global.MediaPipeline?.resolvePreviewUrl) {
      try {
        const u = await global.MediaPipeline.resolvePreviewUrl(ref, pipeOpts);
        if (u && !/data:image\/svg/i.test(u)) return u;
      } catch (e) { /* ignore */ }
    }
    if (global.SupabaseSync?.resolveDisplayUrl) {
      try {
        const u = await global.SupabaseSync.resolveDisplayUrl(ref, {
          assetId: cardId,
          cardId,
          jobId: slotJobId || baseJobId || undefined,
          galleryIndex: galleryIndex != null ? galleryIndex : undefined,
          variant: wantFull ? (global.SupabaseSync.VARIANT_FULL || 'full') : (global.SupabaseSync.VARIANT_GRID || 'grid'),
          listOnly: !wantFull,
          allowFullFallback: false,
          preferFull: wantFull
        });
        if (u) return u;
      } catch (e) { /* ignore */ }
    }
    if (slotJobId && global.WarehouseThumb?.resolveForCard) {
      try {
        const wh = await global.WarehouseThumb.resolveForCard(ref, {
          jobId: slotJobId,
          assetId: cardId,
          cardId,
          galleryIndex: galleryIndex != null ? galleryIndex : 0
        });
        if (wh) return wh;
      } catch (e) { /* ignore */ }
    }
    if (/^https?:\/\//i.test(ref) && global.SupabaseSync?.isEphemeralUpstreamImageUrl?.(ref)) {
      return '';
    }
    return '';
  }

  /** 合并旧版 genJobId#2 分卡到主卡 */
  function migrateMjSplitCardsQuiet(cardList) {
    if (!Array.isArray(cardList) || !cardList.length) return false;
    const byBase = new Map();
    for (const c of cardList) {
      if (!c?.genJobId) continue;
      const base = String(c.genJobId).replace(/#\d+$/, '');
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push(c);
    }
    let changed = false;
    const removeIds = new Set();
    for (const [base, group] of byBase) {
      if (group.length < 2) continue;
      const parent =
        group.find((c) => String(c.genJobId) === base)
        || group.slice().sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))[0];
      if (!parent) continue;
      let gallery = normalizeCardGallery(parent);
      for (const c of group) {
        if (c.id === parent.id) continue;
        gallery = mergeCardGalleryImages(gallery, normalizeCardGallery(c));
        if (/#\d+$/.test(String(c.genJobId || ''))) {
          removeIds.add(c.id);
        }
      }
      const next = gallery.slice(0, MAX);
      if (JSON.stringify(normalizeCardGallery(parent)) !== JSON.stringify(next)) {
        parent.cardImages = next;
        syncCardGalleryFields(parent);
        parent.updatedAt = Date.now();
        changed = true;
      }
      for (const c of group) {
        if (c.id !== parent.id && removeIds.has(c.id)) changed = true;
      }
    }
    if (!removeIds.size) return changed;
    for (let i = cardList.length - 1; i >= 0; i -= 1) {
      if (removeIds.has(cardList[i]?.id)) cardList.splice(i, 1);
    }
    return changed;
  }

  global.PromptHubCardGallery = {
    MAX,
    buildMjCardImages,
    normalizeCardGallery,
    getCardCoverImage,
    getCardFeedCoverImage,
    getWarehouseListThumbMeta,
    getCardFeedCoverMeta,
    pickWarehouseFeedCover,
    pickWarehouseListThumb,
    isFeedListCoverCandidate,
    ensureFeedCoverFromGallery,
    ensureFeedCoversForCards,
    prepareWarehousePageThumbs,
    isResolvableCoverRef,
    isMjCompositeCoverRef,
    mergeCardGalleryImages,
    syncCardGalleryFields,
    syncCardCoverFromGallery,
    repairAllFeedCoversQuiet,
    resolveGenJobIdFromCard,
    gallerySlotJobId,
    resolveMediaUrl,
    migrateMjSplitCardsQuiet
  };
})(typeof window !== 'undefined' ? window : globalThis);

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

  function isMjCompositeCoverRef(ref, card) {
    if (!ref || !card?.isMidjourney) return false;
    const comp = card.mjCompositeUrl && String(card.mjCompositeUrl).trim();
    if (comp && String(ref) === comp) return true;
    const path = global.SupabaseSync?.storagePathFromRef?.(ref);
    return !!(path && /_grid\.(jpe?g|webp|png)$/i.test(path));
  }

  /** 列表/生图仓库封面：MJ 优先用第一张可解析的单图，避免四宫格 grid 加载失败整卡发灰 */
  function getCardFeedCoverImage(card) {
    if (!card) return null;
    const gallery = normalizeCardGallery(card);
    const cardId = card.id;
    const pick = (list) => {
      for (const u of list) {
        if (isResolvableCoverRef(u, cardId)) return u;
      }
      return null;
    };
    if (card.isMidjourney && gallery.length > 1) {
      const singles = gallery.filter((u) => u && !isMjCompositeCoverRef(u, card));
      const fromSingles = pick(singles);
      if (fromSingles) return fromSingles;
    }
    return pick(gallery) || getCardCoverImage(card);
  }

  function getCardFeedCoverMeta(card) {
    const gallery = normalizeCardGallery(card);
    const ref = getCardFeedCoverImage(card);
    let galleryIndex = ref ? gallery.findIndex((u) => String(u || '') === String(ref)) : 0;
    if (galleryIndex < 0) galleryIndex = 0;
    const baseJob = card?.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : null;
    const slotJobId = baseJob ? gallerySlotJobId(baseJob, galleryIndex) : null;
    return { ref, galleryIndex, slotJobId, gallery };
  }

  function getCardCoverImage(card) {
    const gallery = normalizeCardGallery(card);
    for (const u of gallery) {
      if (!u || typeof u !== 'string') continue;
      if (global.SupabaseSync?.isInvalidMediaUrl?.(u)) continue;
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

  function syncCardGalleryFields(card) {
    if (!card) return [];
    const imgs = normalizeCardGallery(card);
    card.cardImages = imgs.length ? imgs : null;
    if (imgs.length) card.image = imgs[0];
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
    if (/^https?:\/\//i.test(ref) && !global.SupabaseSync?.isInvalidMediaUrl?.(ref)) {
      if (!global.SupabaseSync?.isStorageRef?.(ref)) return ref;
    }
    if (global.MediaPipeline?.resolvePreviewUrl) {
      try {
        const u = await global.MediaPipeline.resolvePreviewUrl(ref, {
          assetId: cardId,
          cardId,
          jobId: slotJobId || baseJobId || undefined,
          galleryIndex: galleryIndex != null ? galleryIndex : undefined,
          useJobImageApi: opts.useJobImageApi === true || isCoverSlot,
          allowGridFallback: opts.allowGridFallback !== false && isCoverSlot
        });
        if (u && !/data:image\/svg/i.test(u)) return u;
      } catch (e) { /* ignore */ }
    }
    if (global.SupabaseSync?.resolveDisplayUrl) {
      try {
        const u = await global.SupabaseSync.resolveDisplayUrl(ref, {
          assetId: cardId,
          preferFull: opts.preferFull !== false
        });
        if (u) return u;
      } catch (e) { /* ignore */ }
    }
    return ref;
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
    getCardFeedCoverMeta,
    isResolvableCoverRef,
    isMjCompositeCoverRef,
    mergeCardGalleryImages,
    syncCardGalleryFields,
    gallerySlotJobId,
    resolveMediaUrl,
    migrateMjSplitCardsQuiet
  };
})(typeof window !== 'undefined' ? window : globalThis);

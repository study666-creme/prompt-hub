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
    const baseJobId = opts.jobId ? String(opts.jobId).replace(/#\d+$/, '') : null;
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
    mergeCardGalleryImages,
    syncCardGalleryFields,
    gallerySlotJobId,
    resolveMediaUrl,
    migrateMjSplitCardsQuiet
  };
})(typeof window !== 'undefined' ? window : globalThis);

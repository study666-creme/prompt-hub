/**
 * 生图仓库卡片修复：MJ 字段补全、任务图回填、批量静默修复
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};

  function d() { return deps; }

  function warehouseCardImageNeedsRecovery(card, apiImageUrl) {
    if (!apiImageUrl) return false;
    if (!card?.image || !d().isDisplayableImage(card.image)) return true;
    if (/^https?:\/\//i.test(card.image)) return true;
    if (global.SupabaseSync?.isDataUrl?.(card.image)) return true;
    if (global.SupabaseSync?.isStorageRef?.(card.image)) {
      const path = global.SupabaseSync.storagePathFromRef?.(card.image);
      if (path && global.SupabaseSync.isPathKnownMissing?.(path)) return true;
    }
    return false;
  }

  function mjGalleryNeedsRearchive(card) {
    const CG = window.PromptHubCardGallery;
    if (!card?.isMidjourney || !CG) return false;
    const gallery = CG.normalizeCardGallery(card);
    if (gallery.length <= 1) return false;
    const uniq = new Set(gallery.map((u) => String(u || '').trim()).filter(Boolean));
    if (uniq.size < gallery.length) return true;
    if (gallery.some((u) => /^https?:\/\//i.test(String(u)))) return true;
    const paths = gallery.map((ref) => {
      if (global.SupabaseSync?.storagePathFromRef?.(ref)) {
        return global.SupabaseSync.storagePathFromRef(ref);
      }
      return String(ref || '');
    }).filter(Boolean);
    return new Set(paths).size < gallery.length;
  }

  async function rearchiveMjGallerySlots(card, sourceUrls) {
    const CG = window.PromptHubCardGallery;
    if (!card?.id || !CG || !Array.isArray(sourceUrls) || !sourceUrls.length) return false;
    const baseJobId = card.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : null;
    if (!baseJobId) return false;
    if (global.ImageGenWarehouseRepair?.recoverWarehouseImagesViaServer) {
      await global.ImageGenWarehouseRepair.recoverWarehouseImagesViaServer({
        jobIds: [baseJobId],
        max: 1,
        hours: 168
      });
    }
    if (global.WarehouseThumb?.prefetchForCards) {
      await global.WarehouseThumb.prefetchForCards([card], { max: 1 });
    }
    return false;
  }

  async function repairMjGalleryFromJob(card) {
    if (!card?.genJobId || !global.PromptHubApi?.getGenerationJob) return false;
    if (!mjGalleryNeedsRearchive(card)) return false;
    const baseJobId = String(card.genJobId).replace(/#\d+$/, '');
    try {
      const poll = await global.PromptHubApi.getGenerationJob(baseJobId);
      if (!poll?.ok) return false;
      const parsed = d().resolveMjPollImages?.(poll);
      const CG = window.PromptHubCardGallery;
      const sources = parsed?.gallery?.length
        ? parsed.gallery
        : (parsed?.composite && CG
          ? CG.buildMjCardImages(parsed.composite, parsed.tiles, parsed.primary)
          : parsed?.tiles);
      if (!sources?.length) return false;
      if (parsed?.composite && !card.mjCompositeUrl) card.mjCompositeUrl = parsed.composite;
      return await rearchiveMjGallerySlots(card, sources);
    } catch (e) {
      console.warn('[repairMjGalleryFromJob]', card.id, e);
      return false;
    }
  }

  async function repairMjWarehouseCardFields(card, fields) {
    if (!card?.id) return false;
    let changed = false;
    const gridUrls = Array.isArray(fields.mjGridUrls) ? fields.mjGridUrls.filter(Boolean) : [];
    const composite = fields.mjCompositeUrl || card.mjCompositeUrl || null;
    const CG = window.PromptHubCardGallery;
    if (CG && (gridUrls.length || composite)) {
      if (composite && !card.mjCompositeUrl) {
        card.mjCompositeUrl = composite;
        changed = true;
      }
      const next = CG.buildMjCardImages(
        composite || card.mjCompositeUrl,
        gridUrls.length ? gridUrls : card.mjGridUrls,
        CG.normalizeCardGallery(card)[0] || card.image
      );
      if (JSON.stringify(CG.normalizeCardGallery(card)) !== JSON.stringify(next)) {
        card.cardImages = next;
        CG.syncCardGalleryFields(card);
        changed = true;
      }
    } else if (gridUrls.length && (!Array.isArray(card.mjGridUrls) || card.mjGridUrls.length < gridUrls.length)) {
      card.mjGridUrls = gridUrls;
      changed = true;
    }
    if (Array.isArray(fields.mjButtons) && fields.mjButtons.length
      && (!Array.isArray(card.mjButtons) || !card.mjButtons.length)) {
      card.mjButtons = fields.mjButtons;
      changed = true;
    }
    if (!card.isMidjourney && gridUrls.length) {
      card.isMidjourney = true;
      changed = true;
    }
    if (!changed) return false;
    global.invalidateWarehouseCardsForImageGenCache?.();
    card.updatedAt = Date.now();
    const creations = d().getCreations() || [];
    const cre = creations.find(
      (c) => c.jobId === card.genJobId || c.id === card.genSourceId
    );
    if (cre) {
      if (gridUrls.length) cre.mjGridUrls = gridUrls;
      if (fields.mjCompositeUrl) cre.mjCompositeUrl = fields.mjCompositeUrl;
      if (fields.mjButtons?.length) cre.mjButtons = fields.mjButtons;
      cre.isMidjourney = true;
      d().persistCreations();
    }
    await d().persistPromptHubCards();
    if (mjGalleryNeedsRearchive(card) && (gridUrls.length || composite)) {
      const CG2 = window.PromptHubCardGallery;
      const sources = CG2?.buildMjCardImages(
        composite || card.mjCompositeUrl,
        gridUrls.length ? gridUrls : card.mjGridUrls,
        CG2.normalizeCardGallery(card)[0] || card.image
      );
      if (sources?.length > 1) {
        await rearchiveMjGallerySlots(card, sources);
      }
    }
    return true;
  }

  async function repairWarehouseCardImageFromJob(card, imageUrl, jobId) {
    if (!card?.id || !imageUrl) return false;
    const tombKey = jobId || card.genJobId;
    if (tombKey && d().isGenerationJobDeleted(tombKey)) return false;
    if (jobId && card.genJobId && String(card.genJobId) !== String(jobId)) {
      console.warn('[imagegen] 跳过修复：卡片 genJobId 与任务不一致', card.id, card.genJobId, jobId);
      return false;
    }
    const baseJob = String(jobId || card.genJobId || '').replace(/#\d+$/, '');
    if (baseJob && global.ImageGenWarehouseRepair?.recoverWarehouseImagesViaServer) {
      await global.ImageGenWarehouseRepair.recoverWarehouseImagesViaServer({
        jobIds: [baseJob],
        max: 1,
        hours: 168
      });
    }
    if (global.WarehouseThumb?.resolveForCard) {
      await global.WarehouseThumb.resolveForCard(imageUrl, {
        jobId: baseJob,
        assetId: card.id,
        cardId: card.id
      });
    }
    global.invalidateWarehouseCardsForImageGenCache?.();
    return true;
  }

  let missingGenCardRepairInflight = null;
  let mjPreviewRepairInflight = null;
  let serverRecoverInflight = null;

  async function recoverWarehouseImagesViaServer(opts = {}) {
    if (!global.PromptHubApi?.recoverWarehouseFromJobs || !global.SupabaseSync?.isLoggedIn?.()) {
      return { ok: false, reason: 'no_api' };
    }
    if (serverRecoverInflight) return serverRecoverInflight;
    serverRecoverInflight = (async () => {
      try {
        const r = await global.PromptHubApi.recoverWarehouseFromJobs({
          mode: 'repair',
          hours: opts.hours ?? 72,
          max: opts.max ?? 24,
          providerScope: opts.providerScope || 'all',
          jobIds: Array.isArray(opts.jobIds) ? opts.jobIds.filter(Boolean).slice(0, 10) : undefined
        });
        if (r?.ok && r.data?.repaired > 0) {
          global.SupabaseSync?.clearSignedUrlCache?.();
          global.SupabaseSync?.clearListImageMissMarks?.();
          if (typeof global.runDeferredCloudPull === 'function') {
            await global.runDeferredCloudPull({ force: true, silent: true });
          }
          global.invalidateWarehouseCardsForImageGenCache?.();
          d().refreshWarehouseUI?.();
          if (d().isPageImageGenActive?.()) {
            d().renderImageGenFeed({ preserveScroll: true, force: true });
          }
          if (global.FeedImages?.hydrateFeedImages) {
            void global.FeedImages.hydrateFeedImages(document.getElementById('imageGenFeed'));
          }
        }
        return r;
      } catch (e) {
        console.warn('[recoverWarehouseImagesViaServer]', e);
        return { ok: false, error: e };
      }
    })().finally(() => {
      serverRecoverInflight = null;
    });
    return serverRecoverInflight;
  }

  function isMidjourneyWarehouseCard(card) {
    if (!card) return false;
    if (card.isMidjourney) return true;
    if (Array.isArray(card.mjGridUrls) && card.mjGridUrls.length) return true;
    if (card.mjCompositeUrl) return true;
    const model = String(card.model || card.genModel || '').toLowerCase();
    if (/midjourney|\bmj\b/.test(model)) return true;
    const tags = Array.isArray(card.tags) ? card.tags : [];
    return tags.some((t) => /midjourney|\bmj\b/i.test(String(t || '')));
  }

  function mjCardNeedsPreviewRepair(card) {
    if (!card?.id || !card?.genJobId || !isMidjourneyWarehouseCard(card)) return false;
    if (!d().isUsableWarehouseImage(card)) return true;
    if (mjGalleryNeedsRearchive(card)) return true;
    const cover = global.PromptHubCardGallery?.getCardFeedCoverImage?.(card)
      || global.PromptHubCardGallery?.getCardCoverImage?.(card)
      || card.image;
    if (!cover || !d().isDisplayableImage(cover)) return true;
    if (global.SupabaseSync?.isStorageRef?.(cover)) {
      const path = global.SupabaseSync.storagePathFromRef(cover);
      if (path && global.SupabaseSync.isPathKnownMissing?.(path)) return true;
      const primary = global.SupabaseSync.primaryImagePath?.(cover, card.id);
      if (primary && global.SupabaseSync.isPathKnownMissing?.(primary)) return true;
    }
    return false;
  }

  function collectMjPreviewRepairTargets() {
    const list = d().getCards() || [];
    const tomb = global.getDeletedGenerationJobTombstones?.() || {};
    const ids = new Set();
    const targets = [];
    const push = (card) => {
      if (!card?.id || ids.has(card.id)) return;
      const jobKey = String(card.genJobId || '');
      const base = jobKey.replace(/#\d+$/, '');
      if (tomb[jobKey] || (base && tomb[base])) return;
      ids.add(card.id);
      targets.push(card);
    };
    list.filter(mjCardNeedsPreviewRepair).forEach(push);
    if (typeof document !== 'undefined') {
      document.querySelectorAll('#imageGenFeed .imagegen-feed-card[data-source-card-id]').forEach((el) => {
        const img = el.querySelector('.imagegen-feed-media img');
        if (!img) return;
        const failed = img.classList.contains('img-load-failed')
          || (!img.complete && img.naturalWidth === 0 && img.src && !/svg\+xml/i.test(img.src));
        if (!failed) return;
        const card = list.find((c) => c.id === el.dataset.sourceCardId);
        if (card?.genJobId) push(card);
      });
    }
    return targets;
  }

  async function repairSingleMjCardPreview(card) {
    if (!card?.id || !card?.genJobId) return false;
    const baseJobId = String(card.genJobId).replace(/#\d+$/, '');
    global.SupabaseSync?.clearPathMissingForCard?.(card.id, card.image);
    let changed = false;
    try {
      const poll = await global.PromptHubApi.getGenerationJob(baseJobId);
      if (!poll?.ok) return false;
      const parsed = d().resolveMjPollImages?.(poll);
      if (parsed) {
        const okFields = await repairMjWarehouseCardFields(card, {
          mjGridUrls: parsed.tiles,
          mjCompositeUrl: parsed.composite,
          mjButtons: poll.data?.mjButtons
        });
        if (okFields) changed = true;
      }
      if (await repairMjGalleryFromJob(card)) changed = true;
      const src = parsed?.primary || parsed?.gallery?.[0] || poll.data?.imageUrl;
      if (src && !d().isUsableWarehouseImage(card)) {
        if (await repairWarehouseCardImageFromJob(card, src, card.genJobId)) {
          changed = true;
          global.SupabaseSync?.clearPathMissingForCard?.(card.id, card.image);
          if (typeof global.saveCardImageBackup === 'function') {
            void global.saveCardImageBackup(card.id, src).catch(() => {});
          }
        }
      }
    } catch (e) {
      console.warn('[repairMjWarehousePreviews]', card.id, e);
    }
    return changed;
  }

  let archiveVisibleMjInflight = null;

  /** 卡片库当前页：服务端归档 + grid（禁止浏览器批量拉 getapib 原图） */
  async function archiveVisibleMjCardsQuiet(cards, opts = {}) {
    if (!global.SupabaseSync?.isLoggedIn?.()) {
      return { ok: false, repaired: 0, total: 0 };
    }
    const max = Math.min(Math.max(1, Number(opts.max) || 6), 8);
    const list = Array.isArray(cards) ? cards : [];
    const targets = [];
    const seen = new Set();
    for (const card of list) {
      if (!card?.id || !card?.genJobId || seen.has(card.id)) continue;
      if (!isMidjourneyWarehouseCard(card)) continue;
      if (!mjCardNeedsPreviewRepair(card)) continue;
      seen.add(card.id);
      targets.push(card);
      if (targets.length >= max) break;
    }
    if (!targets.length) return { ok: true, repaired: 0, total: 0 };
    if (archiveVisibleMjInflight) return archiveVisibleMjInflight;
    archiveVisibleMjInflight = (async () => {
      const jobIds = targets.map((c) => String(c.genJobId).replace(/#\d+$/, '')).filter(Boolean);
      if (jobIds.length && global.ImageGenWarehouseRepair?.recoverWarehouseImagesViaServer) {
        await global.ImageGenWarehouseRepair.recoverWarehouseImagesViaServer({
          jobIds: jobIds.slice(0, 6),
          max: Math.min(jobIds.length, 6),
          hours: 168
        });
      }
      if (global.WarehouseThumb?.prefetchForCards) {
        await global.WarehouseThumb.prefetchForCards(targets, { max });
      }
      return { ok: true, repaired: targets.length, total: targets.length };
    })().finally(() => {
      archiveVisibleMjInflight = null;
    });
    return archiveVisibleMjInflight;
  }

  async function repairMjWarehousePreviewsQuiet() {
    if (!global.PromptHubApi?.getGenerationJob || !global.SupabaseSync?.isLoggedIn?.()) {
      console.warn('[repairMjWarehousePreviews] 请先登录');
      return { ok: false, reason: 'not_logged_in' };
    }
    if (mjPreviewRepairInflight) return mjPreviewRepairInflight;
    const targets = collectMjPreviewRepairTargets();
    if (!targets.length) {
      console.info('[repairMjWarehousePreviews] 未发现需要修复的 MJ 卡片');
      return { ok: true, repaired: 0, total: 0 };
    }
    mjPreviewRepairInflight = (async () => {
      let repaired = 0;
      for (const card of targets) {
        if (await repairSingleMjCardPreview(card)) repaired += 1;
        await new Promise((res) => setTimeout(res, 180));
      }
      if (repaired) {
        await d().persistPromptHubCards();
        d().refreshWarehouseUI();
        if (d().isPageImageGenActive()) {
          d().renderImageGenFeed({ preserveScroll: true, force: true });
        }
        d().queueUrgentCardsSync();
        if (global.FeedImages?.hydrateFeedImages) {
          void global.FeedImages.hydrateFeedImages(document.getElementById('imageGenFeed'));
        }
      }
      console.info(`[repairMjWarehousePreviews] 完成：${repaired}/${targets.length} 张已尝试修复`);
      return { ok: true, repaired, total: targets.length };
    })().finally(() => {
      mjPreviewRepairInflight = null;
    });
    return mjPreviewRepairInflight;
  }

  async function repairMissingGenCardImagesQuiet() {
    if (!global.PromptHubApi?.getGenerationJob || !global.SupabaseSync?.isLoggedIn?.()) return false;
    if (missingGenCardRepairInflight) return missingGenCardRepairInflight;
    missingGenCardRepairInflight = (async () => {
      const serverRes = await recoverWarehouseImagesViaServer({ max: 20, hours: 72 });
      if (serverRes?.ok && serverRes.data?.repaired > 0) return true;

      const list = d().getCards() || [];
      const tomb = global.getDeletedGenerationJobTombstones?.() || {};
      const targets = list.filter((c) => {
        if (!c?.id || !c?.genJobId) return false;
        const jobKey = String(c.genJobId);
        const base = jobKey.replace(/#\d+$/, '');
        if (tomb[jobKey] || (base && tomb[base])) return false;
        if (!c.image) return true;
        return !d().isUsableWarehouseImage(c);
      }).slice(0, 12);
      if (!targets.length) return false;

      let changed = false;
      for (const card of targets) {
        try {
          let src = null;
          const jobId = String(card.genJobId);
          const baseJobId = jobId.replace(/#\d+$/, '');
          const r = await global.PromptHubApi.getGenerationJob(baseJobId);
          if (r?.ok && r.data?.imageUrl) src = r.data.imageUrl;
          if (r?.ok && isMidjourneyWarehouseCard(card)) {
            const parsed = d().resolveMjPollImages?.(r);
            if (parsed) {
              await repairMjWarehouseCardFields(card, {
                mjGridUrls: parsed.tiles,
                mjCompositeUrl: parsed.composite,
                mjButtons: r.data?.mjButtons
              });
              await repairMjGalleryFromJob(card);
              src = parsed.primary || parsed.gallery?.[0] || src;
            }
          }
          if (!src && typeof global.getCardImageBackup === 'function') {
            const backup = await global.getCardImageBackup(card.id);
            if (backup && d().isDisplayableImage(backup)) src = backup;
          }
          if (!src) continue;
          const ok = await repairWarehouseCardImageFromJob(card, src, jobId);
          if (ok) {
            changed = true;
            global.SupabaseSync?.clearPathMissingForCard?.(card.id, card.image);
            if (typeof global.saveCardImageBackup === 'function') {
              void global.saveCardImageBackup(card.id, src).catch(() => {});
            }
          }
        } catch (e) {
          console.warn('[repairMissingGenCardImages]', card.id, e);
        }
        await new Promise((res) => setTimeout(res, 160));
      }
      if (changed) {
        await d().persistPromptHubCards();
        d().refreshWarehouseUI();
        if (d().isPageImageGenActive()) {
          d().renderImageGenFeed({ preserveScroll: true });
        }
        d().queueUrgentCardsSync();
      }
      return changed;
    })().finally(() => {
      missingGenCardRepairInflight = null;
    });
    return missingGenCardRepairInflight;
  }

  function init(injected) {
    deps = injected || {};
    const api = {
      warehouseCardImageNeedsRecovery,
      repairMjWarehouseCardFields,
      repairMjGalleryFromJob,
      repairWarehouseCardImageFromJob,
      repairMissingGenCardImagesQuiet,
      repairMjWarehousePreviewsQuiet,
      archiveVisibleMjCardsQuiet,
      recoverWarehouseImagesViaServer
    };
    Object.assign(global.ImageGenWarehouseRepair, api);
    return api;
  }

  global.ImageGenWarehouseRepair = { init };
})(typeof window !== 'undefined' ? window : globalThis);

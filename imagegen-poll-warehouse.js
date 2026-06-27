/**
 * 轮询完成后的仓库入库：主图、附赠图、Midjourney 四宫格
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};

  function d() { return deps; }
  function CG() { return global.PromptHubCardGallery; }

  function findWarehouseCardForJob(jobId) {
    if (!jobId) return null;
    const key = String(jobId).replace(/#\d+$/, '');
    return (global.__promptHubCards || []).find((c) => {
      if (!c?.genJobId) return false;
      const cardKey = String(c.genJobId).replace(/#\d+$/, '');
      return c.genJobId === jobId || cardKey === key;
    }) || null;
  }

  function hasWarehouseCardForJob(jobId) {
    if (!jobId) return false;
    const card = findWarehouseCardForJob(jobId);
    if (!card) return false;
    const cover = CG()?.getCardCoverImage?.(card) || card.image;
    if (!cover || !d().isDisplayableImage(cover)) return false;
    return true;
  }

  function getPollExtraImageUrls(poll, primaryUrl) {
    const main = primaryUrl || poll?.data?.imageUrl;
    if (!main) return [];
    const raw = Array.isArray(poll?.data?.extraImageUrls) ? poll.data.extraImageUrls : [];
    return raw.filter((u) => u && u !== main);
  }

  function isGenCreationSlotSaved(baseJobId, slotIndex) {
    if (!baseJobId) return false;
    const slotId = slotIndex <= 1 ? String(baseJobId) : `${baseJobId}#${slotIndex}`;
    return hasWarehouseCardForJob(slotId);
  }

  function allGenCreationSlotsSaved(baseJobId, extraCount) {
    if (!baseJobId || !isGenCreationSlotSaved(baseJobId, 1)) return false;
    for (let i = 0; i < extraCount; i += 1) {
      if (!isGenCreationSlotSaved(baseJobId, i + 2)) return false;
    }
    return true;
  }

  /** MJ 放大/变体：追加到父卡片的 cardImages（最多 5 张） */
  async function appendMjActionToParentCard(poll, ctx, pendingId) {
    const parentJobId = String(poll?.data?.mjParentJobId || '').replace(/#\d+$/, '');
    const actionImage = poll?.data?.imageUrl;
    const action = poll?.data?.mjAction;
    if (!parentJobId || !actionImage || !action) return false;
    const card = findWarehouseCardForJob(parentJobId);
    if (!card?.id) return false;
    const galleryApi = CG();
    if (!galleryApi) return false;

    let stored = actionImage;
    const slot = galleryApi.normalizeCardGallery(card).length + 1;
    if (global.SupabaseSync?.archiveGeneratedCardImage) {
      try {
        stored = await global.SupabaseSync.archiveGeneratedCardImage(card.id, actionImage, {
          jobId: `${parentJobId}#a${slot}`
        }) || actionImage;
      } catch (e) {
        console.warn('[mj-action] gallery archive failed', e);
      }
    }
    const merged = galleryApi.mergeCardGalleryImages(galleryApi.normalizeCardGallery(card), [stored]);
    if (typeof global.persistCardGalleryUpdate === 'function') {
      await global.persistCardGalleryUpdate(card.id, merged);
    } else {
      card.cardImages = merged;
      galleryApi.syncCardGalleryFields(card);
      card.updatedAt = Date.now();
    }
    if (pendingId) d().removePendingJob(pendingId);
    if (poll?.data?.jobId) d().clearSessionGenJob(poll.data.jobId);
    d().renderImageGenFeed({ preserveScroll: true });
    if (!ctx?.silentToast) {
      d().toast(action === 'upscale' ? '放大图已存入原卡片' : '变体已追加到原卡片');
    }
    return true;
  }

  function mjCardGalleryComplete(card) {
    const gallery = CG()?.normalizeCardGallery?.(card) || [];
    return gallery.length >= 4;
  }

  async function upsertMjGalleryToWarehouse(card, parsed, poll, ctx, pendingId, baseJobId) {
    const gallery = parsed.gallery?.length
      ? parsed.gallery.slice(0, CG()?.MAX || 5)
      : CG()?.buildMjCardImages?.(parsed.composite, parsed.tiles, parsed.primary) || [];
    if (gallery.length < 4) return false;

    if (card?.id) {
      card.cardImages = gallery;
      if (parsed.composite) card.mjCompositeUrl = parsed.composite;
      card.mjGridUrls = parsed.tiles?.length ? parsed.tiles.slice(0, 4) : gallery.slice(1, 5);
      card.isMidjourney = true;
      CG()?.syncCardGalleryFields?.(card);
      card.updatedAt = Date.now();
      if (typeof global.persistCardGalleryUpdate === 'function') {
        await global.persistCardGalleryUpdate(card.id, gallery);
      } else {
        await d().persistPromptHubCards?.();
      }
      if (d().repairMjGalleryFromJob) {
        await d().repairMjGalleryFromJob(card);
      }
      if (Array.isArray(poll?.data?.mjButtons) && poll.data.mjButtons.length) {
        await d().repairMjWarehouseCardFields(card, {
          mjGridUrls: parsed.tiles,
          mjCompositeUrl: parsed.composite,
          mjButtons: poll.data.mjButtons
        });
      }
      if (pendingId) d().removePendingJob(pendingId);
      d().clearSessionGenJob(baseJobId);
      d().renderImageGenFeed({ preserveScroll: true, force: true });
      d().queueUrgentCardsSync?.();
      return true;
    }

    await saveMjToWarehouse({
      ...ctx,
      primary: gallery[0],
      gridUrls: parsed.tiles?.length ? parsed.tiles : gallery.slice(parsed.composite ? 1 : 0, 5),
      composite: parsed.composite,
      buttons: poll?.data?.mjButtons,
      gallery,
      jobId: baseJobId,
      silentToast: !!ctx.silentToast,
      isRecovery: !!ctx.isRecovery,
      pendingId
    });
    return true;
  }

  /** Midjourney 入库：单卡 cardImages（四宫格首图 + 单图 + 变体槽位） */
  async function saveMjToWarehouse({
    prompt,
    model,
    resolution,
    quality,
    size,
    cost,
    jobId,
    silentToast,
    isRecovery,
    fromInspirationDraw,
    pendingId,
    targetGroup,
    targetTags,
    cardTitle,
    genBatchId,
    primary,
    gridUrls,
    composite,
    buttons,
    gallery: galleryInput
  }) {
    const tiles = (gridUrls || []).filter(Boolean).slice(0, 4);
    const cardImages = Array.isArray(galleryInput) && galleryInput.length
      ? galleryInput.filter(Boolean).slice(0, CG()?.MAX || 5)
      : CG()?.buildMjCardImages?.(composite, tiles, primary || tiles[0])
        || (tiles.length ? tiles : primary ? [primary] : []);
    const mainImage = cardImages[0];
    if (!mainImage) return false;

    await d().finishImageGenRun({
      prompt,
      model,
      resolution,
      quality,
      size,
      cost,
      jobId,
      isRecovery,
      fromInspirationDraw,
      pendingId,
      targetGroup,
      targetTags,
      cardTitle,
      genBatchId,
      isMidjourney: true,
      image: mainImage,
      imageIndex: 1,
      silentToast: true,
      extraImages: [],
      cardImages,
      mjGridUrls: tiles,
      mjCompositeUrl: composite,
      mjButtons: buttons
    });
    if (!silentToast) {
      const n = cardImages.length;
      d().toast(
        n >= 4
          ? `Midjourney 已入库（${n} 张在同一卡片，放大后自动追加）`
          : `Midjourney 已入库 ${n} 张图`
      );
    }
    return true;
  }

  /** 同提示词批量：合并入库到同一卡片（genBatchId） */
  async function appendImagesToBatchCard(ctx, images, pendingId) {
    const batchId = ctx?.batchId;
    const urls = (images || []).filter(Boolean);
    if (!batchId || !urls.length) return false;
    const galleryApi = CG();
    if (!galleryApi) return false;
    const cards = global.__promptHubCards || [];
    const card = cards.find((c) => c.genBatchId === batchId);
    if (!card?.id) return false;

    const beforeLen = galleryApi.normalizeCardGallery(card).length;
    let merged = galleryApi.normalizeCardGallery(card);
    for (const imageUrl of urls) {
      let stored = imageUrl;
      const slot = merged.length + 1;
      if (global.SupabaseSync?.archiveGeneratedCardImage) {
        try {
          stored = await global.SupabaseSync.archiveGeneratedCardImage(card.id, imageUrl, {
            jobId: ctx.jobId ? `${String(ctx.jobId).replace(/#\d+$/, '')}#b${slot}` : null
          }) || imageUrl;
        } catch (e) {
          console.warn('[batch-merge] gallery archive failed', e);
        }
      }
      merged = galleryApi.mergeCardGalleryImages(merged, [stored]);
    }
    if (merged.length === beforeLen) {
      if (!ctx?.silentToast) d().toast('该卡片已满 5 张，无法继续追加');
      if (pendingId) d().removePendingJob(pendingId);
      if (ctx?.jobId) d().clearSessionGenJob(ctx.jobId);
      return true;
    }
    if (typeof global.persistCardGalleryUpdate === 'function') {
      await global.persistCardGalleryUpdate(card.id, merged);
    } else {
      card.cardImages = merged;
      galleryApi.syncCardGalleryFields(card);
      card.updatedAt = Date.now();
    }
    if (ctx?.jobId) {
      const ids = Array.isArray(card.genBatchJobIds) ? card.genBatchJobIds.slice() : [];
      if (!ids.includes(ctx.jobId)) ids.push(ctx.jobId);
      card.genBatchJobIds = ids;
    }
    if (pendingId) d().removePendingJob(pendingId);
    if (ctx?.jobId) d().clearSessionGenJob(ctx.jobId);
    d().renderImageGenFeed({ preserveScroll: true, force: true });
    d().queueUrgentCardsSync?.();
    if (!ctx?.silentToast && ctx.batchIndex === ctx.batchTotal) {
      d().toast(`已合并 ${merged.length} 张到同一卡片`);
    }
    return true;
  }

  async function saveBatchMergedFromPoll(poll, ctx, pendingId) {
    if (!ctx?.batchMergeCards || !ctx?.batchId || !poll?.data?.imageUrl) return false;
    if (poll.data.isMidjourney || d().isImageGenMidjourneyModel?.(ctx?.model)) return false;
    const cards = global.__promptHubCards || [];
    const existing = cards.find((c) => c.genBatchId === ctx.batchId);

    if (existing) {
      return appendImagesToBatchCard(ctx, [poll.data.imageUrl], pendingId);
    }

    await d().finishImageGenRun({
      ...ctx,
      image: poll.data.imageUrl,
      extraImages: [],
      cost: ctx.cost,
      jobId: ctx.jobId,
      silentToast: true,
      isRecovery: !!ctx.isRecovery,
      pendingId,
      cardTitle: ctx.cardTitle,
      genBatchId: ctx.batchId
    });
    if (!ctx.silentToast && ctx.batchIndex === ctx.batchTotal) {
      const card = (global.__promptHubCards || []).find((c) => c.genBatchId === ctx.batchId);
      const n = CG()?.normalizeCardGallery?.(card)?.length || 1;
      d().toast(`已合并 ${n} 张到同一卡片`);
    }
    return true;
  }

  /** 入库主图 + 同任务附赠图；已有主图时只补缺失的附赠槽位 */
  async function ensureGenJobCreationsFromPoll(poll, ctx, pendingId) {
    if (poll?.data?.status !== 'completed' || !poll.data.imageUrl) return false;

    if (poll.data.mjParentJobId && poll.data.mjAction) {
      const appended = await appendMjActionToParentCard(poll, ctx, pendingId);
      if (appended) return true;
    }

    if (ctx?.batchMergeCards && ctx?.batchId && ctx.batchTotal > 1) {
      return saveBatchMergedFromPoll(poll, ctx, pendingId);
    }

    const baseJobId = ctx?.jobId || poll.data.jobId;
    const imageUrl = poll.data.imageUrl;
    const extras = getPollExtraImageUrls(poll, imageUrl);
    const isMj = poll.data.isMidjourney || d().isImageGenMidjourneyModel?.(ctx?.model);

    if (isMj) {
      const parsed = d().resolveMjPollImages(poll);
      if ((parsed.gallery?.length || 0) < 4) return false;
      const card = baseJobId ? findWarehouseCardForJob(baseJobId) : null;
      return upsertMjGalleryToWarehouse(card, parsed, poll, ctx, pendingId, baseJobId);
    }

    if (baseJobId && allGenCreationSlotsSaved(baseJobId, extras.length)) {
      const mainCard = findWarehouseCardForJob(baseJobId);
      if (mainCard && d().warehouseCardImageNeedsRecovery(mainCard, imageUrl)) {
        await d().repairWarehouseCardImageFromJob(mainCard, imageUrl, baseJobId);
      }
      for (let ei = 0; ei < extras.length; ei += 1) {
        const slotId = `${baseJobId}#${ei + 2}`;
        const slotCard = findWarehouseCardForJob(slotId);
        if (slotCard && d().warehouseCardImageNeedsRecovery(slotCard, extras[ei])) {
          await d().repairWarehouseCardImageFromJob(slotCard, extras[ei], slotId);
        }
      }
      if (pendingId) d().removePendingJob(pendingId);
      d().clearSessionGenJob(baseJobId);
      d().renderImageGenFeed({ preserveScroll: true });
      return true;
    }

    if (!baseJobId || !isGenCreationSlotSaved(baseJobId, 1)) {
      await d().finishImageGenRun({
        ...ctx,
        image: imageUrl,
        extraImages: extras,
        cost: ctx.cost,
        jobId: baseJobId,
        silentToast: !!ctx.silentToast,
        isRecovery: !!ctx.isRecovery,
        pendingId
      });
      if (extras.length && !ctx.silentToast) {
        d().toast(`本次上游共 ${extras.length + 1} 张图，已全部存入仓库（仅扣 1 次积分）`);
      }
      return true;
    }

    for (let i = 0; i < extras.length; i += 1) {
      if (!isGenCreationSlotSaved(baseJobId, i + 2)) {
        await d().finishImageGenRun({
          ...ctx,
          image: extras[i],
          extraImages: [],
          cost: ctx.cost,
          jobId: baseJobId,
          silentToast: true,
          isRecovery: !!ctx.isRecovery,
          pendingId: null,
          imageIndex: i + 2
        });
      }
    }
    if (pendingId) d().removePendingJob(pendingId);
    d().renderImageGenFeed({ preserveScroll: true });
    if (extras.length && !ctx.silentToast) {
      d().toast(`已补全同任务附赠图 ${extras.length} 张`);
    }
    return true;
  }

  function init(injected) {
    deps = injected || {};
    return {
      getPollExtraImageUrls,
      isGenCreationSlotSaved,
      allGenCreationSlotsSaved,
      appendImagesToBatchCard,
      saveBatchMergedFromPoll,
      saveMjToWarehouse,
      appendMjActionToParentCard,
      ensureGenJobCreationsFromPoll
    };
  }

  global.ImageGenPollWarehouse = { init };
})(typeof window !== 'undefined' ? window : globalThis);

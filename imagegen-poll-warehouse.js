/**
 * 轮询完成后的最近生成写入：主图、附赠图、Midjourney 四宫格
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};
  function d() { return deps; }
  function CG() { return global.PromptHubCardGallery; }

  function baseJobId(jobId) {
    return jobId ? String(jobId).replace(/#\d+$/, '') : '';
  }

  function getCreations() {
    return d().getCreations?.() || [];
  }

  function findCreationForJob(jobId) {
    if (!jobId) return null;
    const key = baseJobId(jobId);
    return getCreations().find((c) => {
      if (!c?.jobId) return false;
      return baseJobId(c.jobId) === key;
    }) || null;
  }

  function creationHasImage(creation) {
    if (!creation) return false;
    if (creation.image && d().isDisplayableImage(creation.image)) return true;
    if (creation.isMidjourney) {
      if (creation.mjCompositeUrl && d().isDisplayableImage(creation.mjCompositeUrl)) return true;
      if (Array.isArray(creation.mjGridUrls) && creation.mjGridUrls.some((u) => d().isDisplayableImage(u))) return true;
      if (Array.isArray(creation.cardImages) && creation.cardImages.some((u) => d().isDisplayableImage(u))) return true;
    }
    return false;
  }

  function hasCreationForJob(jobId) {
    return creationHasImage(findCreationForJob(jobId));
  }

  function getPollExtraImageUrls(poll, primaryUrl) {
    const main = primaryUrl || poll?.data?.imageUrl;
    if (!main) return [];
    const raw = Array.isArray(poll?.data?.extraImageUrls) ? poll.data.extraImageUrls : [];
    return raw.filter((u) => u && u !== main);
  }

  function isGenCreationSlotSaved(baseJobId) {
    return hasCreationForJob(baseJobId);
  }

  function allGenCreationSlotsSaved(baseJobId) {
    return hasCreationForJob(baseJobId);
  }

  function persistCreationUpdate(creation) {
    if (!creation) return;
    creation.updatedAt = Date.now();
    d().persistCreations?.();
  }

  function buildCreationGallery(creation) {
    if (!creation) return [];
    if (Array.isArray(creation.cardImages) && creation.cardImages.length) {
      return creation.cardImages.filter(Boolean).slice(0, CG()?.MAX || 5);
    }
    if (creation.isMidjourney) {
      const tiles = Array.isArray(creation.mjGridUrls) ? creation.mjGridUrls.filter(Boolean) : [];
      if (tiles.length) return tiles.slice(0, 5);
      if (creation.mjCompositeUrl && creation.image) return [creation.mjCompositeUrl, creation.image].filter(Boolean);
    }
    return creation.image ? [creation.image] : [];
  }

  /** MJ 放大/变体：追加到父 creation 的 cardImages（最多 5 张） */
  async function appendMjActionToParentCard(poll, ctx, pendingId) {
    const parentJobId = baseJobId(poll?.data?.mjParentJobId || '');
    const actionImage = poll?.data?.imageUrl;
    const action = poll?.data?.mjAction;
    if (!parentJobId || !actionImage || !action) return false;
    const creation = findCreationForJob(parentJobId);
    if (!creation?.id) return false;

    let stored = actionImage;
    const gallery = buildCreationGallery(creation);
    const slot = gallery.length + 1;
    if (global.SupabaseSync?.archiveGeneratedCardImage) {
      try {
        stored = await global.SupabaseSync.archiveGeneratedCardImage(creation.id, actionImage, {
          jobId: `${parentJobId}#a${slot}`
        }) || actionImage;
      } catch (e) {
        console.warn('[mj-action] gallery archive failed', e);
      }
    }
    const merged = CG()?.mergeCardGalleryImages
      ? CG().mergeCardGalleryImages(gallery, [stored])
      : [...gallery, stored].filter(Boolean).slice(0, CG()?.MAX || 5);
    creation.cardImages = merged;
    creation.image = merged[0] || creation.image;
    if (merged.length > 1) {
      creation.mjGridUrls = merged.slice(1, 5);
    }
    creation.isMidjourney = true;
    persistCreationUpdate(creation);
    if (pendingId) d().removePendingJob(pendingId);
    if (poll?.data?.jobId) d().clearSessionGenJob(poll.data.jobId);
    d().renderImageGenFeed({ preserveScroll: true });
    if (!ctx?.silentToast) {
      d().toast(action === 'upscale' ? '放大图已追加到最近生成' : '变体已追加到最近生成');
    }
    return true;
  }

  async function upsertMjGalleryToCreation(creation, parsed, poll, ctx, pendingId, baseJobId) {
    const gallery = parsed.gallery?.length
      ? parsed.gallery.slice(0, CG()?.MAX || 5)
      : CG()?.buildMjCardImages?.(parsed.composite, parsed.tiles, parsed.primary) || [];
    if (gallery.length < 4) return false;

    if (creation?.id) {
      creation.cardImages = gallery;
      creation.image = gallery[0] || creation.image;
      if (parsed.composite) creation.mjCompositeUrl = parsed.composite;
      creation.mjGridUrls = parsed.tiles?.length ? parsed.tiles.slice(0, 4) : gallery.slice(1, 5);
      creation.isMidjourney = true;
      if (Array.isArray(poll?.data?.mjButtons) && poll.data.mjButtons.length) {
        creation.mjButtons = poll.data.mjButtons;
      }
      persistCreationUpdate(creation);
      if (pendingId) d().removePendingJob(pendingId);
      d().clearSessionGenJob(baseJobId);
      d().renderImageGenFeed({ preserveScroll: true, force: true });
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

  /** Midjourney：单条最近记录（四宫格 + 变体槽位） */
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
          ? `Midjourney 已加入最近生成（${n} 张在同一记录）`
          : `Midjourney 已加入最近生成 ${n} 张图`
      );
    }
    return true;
  }

  /** 同提示词批量：合并到同一 creation（genBatchId） */
  async function appendImagesToBatchCard(ctx, images, pendingId) {
    const batchId = ctx?.batchId;
    const urls = (images || []).filter(Boolean);
    if (!batchId || !urls.length) return false;
    const creation = getCreations().find((c) => c.genBatchId === batchId);
    if (!creation?.id) return false;

    const beforeLen = buildCreationGallery(creation).length;
    let merged = buildCreationGallery(creation);
    for (const imageUrl of urls) {
      let stored = imageUrl;
      const slot = merged.length + 1;
      if (global.SupabaseSync?.archiveGeneratedCardImage) {
        try {
          stored = await global.SupabaseSync.archiveGeneratedCardImage(creation.id, imageUrl, {
            jobId: ctx.jobId ? `${baseJobId(ctx.jobId)}#b${slot}` : null
          }) || imageUrl;
        } catch (e) {
          console.warn('[batch-merge] gallery archive failed', e);
        }
      }
      merged = CG()?.mergeCardGalleryImages
        ? CG().mergeCardGalleryImages(merged, [stored])
        : [...merged, stored].filter(Boolean).slice(0, CG()?.MAX || 5);
    }
    if (merged.length === beforeLen) {
      if (!ctx?.silentToast) d().toast('该记录已满 5 张，无法继续追加');
      if (pendingId) d().removePendingJob(pendingId);
      if (ctx?.jobId) d().clearSessionGenJob(ctx.jobId);
      return true;
    }
    creation.cardImages = merged;
    creation.image = merged[0] || creation.image;
    persistCreationUpdate(creation);
    if (pendingId) d().removePendingJob(pendingId);
    if (ctx?.jobId) d().clearSessionGenJob(ctx.jobId);
    d().renderImageGenFeed({ preserveScroll: true, force: true });
    if (!ctx?.silentToast && ctx.batchIndex === ctx.batchTotal) {
      d().toast(`已合并 ${merged.length} 张到同一最近记录`);
    }
    return true;
  }

  async function saveBatchMergedFromPoll(poll, ctx, pendingId) {
    if (!ctx?.batchMergeCards || !ctx?.batchId || !poll?.data?.imageUrl) return false;
    if (poll.data.isMidjourney || d().isImageGenMidjourneyModel?.(ctx?.model)) return false;
    const existing = getCreations().find((c) => c.genBatchId === ctx.batchId);

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
      const cre = getCreations().find((c) => c.genBatchId === ctx.batchId);
      const n = buildCreationGallery(cre).length || 1;
      d().toast(`已合并 ${n} 张到同一最近记录`);
    }
    return true;
  }

  /** 写入最近生成；已有记录时跳过 */
  async function ensureGenJobCreationsFromPoll(poll, ctx, pendingId) {
    if (poll?.data?.status !== 'completed' || !poll.data.imageUrl) return false;

    if (poll.data.mjParentJobId && poll.data.mjAction) {
      const appended = await appendMjActionToParentCard(poll, ctx, pendingId);
      if (appended) return true;
    }

    if (ctx?.batchMergeCards && ctx?.batchId && ctx.batchTotal > 1) {
      return saveBatchMergedFromPoll(poll, ctx, pendingId);
    }

    const baseJobIdVal = ctx?.jobId || poll.data.jobId;
    const imageUrl = poll.data.imageUrl;
    const extras = getPollExtraImageUrls(poll, imageUrl);
    const isMj = poll.data.isMidjourney || d().isImageGenMidjourneyModel?.(ctx?.model);

    if (isMj) {
      const parsed = d().resolveMjPollImages(poll);
      if ((parsed.gallery?.length || 0) < 4) return false;
      const creation = baseJobIdVal ? findCreationForJob(baseJobIdVal) : null;
      return upsertMjGalleryToCreation(creation, parsed, poll, ctx, pendingId, baseJobIdVal);
    }

    if (baseJobIdVal && allGenCreationSlotsSaved(baseJobIdVal)) {
      if (pendingId) d().removePendingJob(pendingId);
      d().clearSessionGenJob(baseJobIdVal);
      d().renderImageGenFeed({ preserveScroll: true });
      return true;
    }

    await d().finishImageGenRun({
      ...ctx,
      image: imageUrl,
      extraImages: extras,
      cost: ctx.cost,
      jobId: baseJobIdVal,
      silentToast: !!ctx.silentToast,
      isRecovery: !!ctx.isRecovery,
      pendingId
    });
    if (extras.length && !ctx.silentToast) {
      d().toast(`本次上游共 ${extras.length + 1} 张图，已加入最近生成（仅扣 1 次积分）`);
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
      ensureGenJobCreationsFromPoll,
      findCreationForJob,
      hasCreationForJob
    };
  }

  global.ImageGenPollWarehouse = { init };
})(typeof window !== 'undefined' ? window : globalThis);

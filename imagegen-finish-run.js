/**
 * 生图完成入库：creation 记录 + 仓库卡片 + 附赠图递归
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};

  const finishingJobIds = new Set();

  function d() { return deps; }

  async function finishImageGenRun({
    prompt,
    model,
    resolution,
    quality,
    size,
    image,
    extraImages,
    cost,
    btn,
    jobId,
    silentToast,
    isRecovery,
    fromInspirationDraw,
    pendingId,
    imageIndex,
    targetGroup,
    targetTags,
    cardTitle,
    genBatchId,
    isMidjourney,
    mjGridUrls,
    mjCompositeUrl,
    mjButtons,
    mjSplitSave,
    cardImages
  }) {
    if (!image) {
      d().toast('图片地址无效，请重试');
      return;
    }
    const baseJobId = jobId ? String(jobId).replace(/#\d+$/, '') : null;
    const idx = Math.max(1, Number(imageIndex) || 1);
    const slotJobId = baseJobId ? (idx === 1 ? baseJobId : `${baseJobId}#${idx}`) : null;
    if (slotJobId) {
      if (d().isGenerationJobDeleted(slotJobId) || d().isGenerationJobDeleted(baseJobId)) return;
      const existingCard = d().findWarehouseCardForJob(slotJobId);
      if (existingCard && d().hasWarehouseCardForJob(slotJobId)) {
        if (isMidjourney && Array.isArray(mjGridUrls) && mjGridUrls.length > 1
          && (!Array.isArray(existingCard.mjGridUrls) || existingCard.mjGridUrls.length < mjGridUrls.length)) {
          await d().repairMjWarehouseCardFields(existingCard, {
            mjGridUrls,
            mjCompositeUrl,
            mjButtons
          });
          d().renderImageGenFeed({ preserveScroll: true });
        }
        if (d().warehouseCardImageNeedsRecovery(existingCard, image)) {
          await d().repairWarehouseCardImageFromJob(existingCard, image, slotJobId);
          d().renderImageGenFeed({ preserveScroll: true });
        }
        if (idx === 1) {
          d().clearSessionGenJob(baseJobId);
          if (pendingId) d().removePendingJob(pendingId);
          d().prunePendingJobsWithWarehouseCards();
          d().renderImageGenFeed({ preserveScroll: true });
        }
        return;
      }
      if (finishingJobIds.has(slotJobId)) return;
      finishingJobIds.add(slotJobId);
    }
    try {
      const creations = d().getCreations() || [];
      const existingCre = slotJobId ? creations.find((c) => c.jobId === slotJobId) : null;
      const creationId = existingCre?.id || d().genId('cr');
      let storedImage = image;
      if (slotJobId) {
        void global.ImageGenWarehouseRepair?.recoverWarehouseImagesViaServer?.({
          jobIds: [String(slotJobId).replace(/#\d+$/, '')],
          max: 1,
          hours: 24
        });
        void global.WarehouseThumb?.resolveForCard?.(image, {
          jobId: slotJobId,
          assetId: creationId,
          cardId: creationId
        });
      }
      if (idx === 1) d().setImageGenLastResult(storedImage);
      const primaryRef = d().getImageGenPrimaryRef();
      const refImages = d().getImageGenRefImages() || [];
      const modelId = model || 'gpt-image-2';
      const modelLabel = global.PointsSystem?.getImageGenModel?.(modelId)?.label || modelId;
      const promptNote = idx > 1
        ? (isMidjourney && (mjSplitSave || d().isImageGenMjSaveAllTiles?.())
          ? `${prompt}（MJ 图 ${idx}）`
          : `${prompt}（同任务附赠图 ${idx}）`)
        : prompt;
      const cardMjGridUrls = isMidjourney && Array.isArray(mjGridUrls) && mjGridUrls.length
        ? mjGridUrls.slice(0, 4)
        : isMidjourney && Array.isArray(cardImages) && cardImages.length > 1 && mjCompositeUrl
          ? cardImages.slice(1, 5)
          : isMidjourney && Array.isArray(mjGridUrls) && idx === 1 && !mjSplitSave
            ? mjGridUrls
            : (isMidjourney && mjSplitSave ? null : (isMidjourney && Array.isArray(mjGridUrls) ? mjGridUrls : null));
      const creation = {
        id: creationId,
        jobId: slotJobId,
        prompt: promptNote,
        image: storedImage,
        refImage: primaryRef,
        refImages: refImages.length ? [...refImages] : null,
        model: modelId,
        modelLabel,
        resolution,
        quality: quality || 'standard',
        size: size || '1:1',
        hasRefImage: refImages.length > 0,
        visibility: 'private',
        createdAt: Date.now() + idx,
        expiresAt: Date.now() + d().randomGenRetentionMs(),
        isMidjourney: !!isMidjourney,
        mjGridUrls: cardMjGridUrls,
        mjCompositeUrl: isMidjourney && mjCompositeUrl && idx === 1 ? mjCompositeUrl : null,
        mjButtons: isMidjourney && Array.isArray(mjButtons) && idx === 1 ? mjButtons : null
      };
      d().setCreations(d().dedupeCreationsByJobId([creation, ...creations]));
      if (idx === 1) d().setImageGenActiveHistoryId(creation.id);
      d().persistCreations();
      d().switchImageGenFeedToWarehouse();
      d().updateImageGenFeedHint();
      global.PointsSystem?.updateCreditsUI?.();
      if (btn) {
        btn.disabled = false;
        d().restoreImageGenSubmitLabel();
      }
      const publish = idx === 1 && d().isImageGenGenPublicChecked();
      const userTitle = cardTitle && String(cardTitle).trim() ? String(cardTitle).trim() : '';
      const whTitle = idx > 1
        ? (isMidjourney && (mjSplitSave || d().isImageGenMjSaveAllTiles?.()) ? `MJ 图 ${idx}` : `附赠图 ${idx}`)
        : userTitle
          ? userTitle
          : (isMidjourney ? (mjSplitSave || d().isImageGenMjSaveAllTiles?.() ? 'MJ 图 1' : 'MJ 四宫格') : '');
      const saved = await d().saveGeneratedToWarehouse({
        prompt: creation.prompt,
        image: storedImage || image,
        sourceId: creation.id,
        jobId: slotJobId,
        title: whTitle,
        resolution,
        model: modelId,
        quality: quality || 'standard',
        size: size || '1:1',
        targetGroup: targetGroup || null,
        targetTags: targetTags || null,
        publishToCommunity: publish,
        fromInspirationDraw: !!fromInspirationDraw,
        silentToast: !!silentToast,
        isMidjourney: !!isMidjourney,
        mjGridUrls: cardMjGridUrls,
        mjCompositeUrl: isMidjourney && mjCompositeUrl && idx === 1 ? mjCompositeUrl : null,
        mjButtons: isMidjourney && Array.isArray(mjButtons) && idx === 1 ? mjButtons : null,
        cardImages: isMidjourney && Array.isArray(cardImages) && cardImages.length ? cardImages : null,
        genBatchId: genBatchId && idx === 1 ? genBatchId : null,
        genBatchJobIds: genBatchId && slotJobId ? [slotJobId] : null,
        deferCloudPush: !!isMidjourney,
        isRecovery: !!isRecovery
      });
      if (pendingId && idx === 1) d().removePendingJob(pendingId);
      d().prunePendingJobsWithWarehouseCards();
      d().renderImageGenFeed({ preserveScroll: true, force: true });
      d().renderImageGenMobileResult();
      if (saved && global.SupabaseSync?.isLoggedIn?.()) {
        d().queueUrgentCardsSync();
      }
      const whCard = slotJobId
        ? (global.__promptHubCards || []).find((c) => c.genJobId === slotJobId)
        : null;
      if (whCard && d().warehouseCardImageNeedsRecovery(whCard, image || storedImage)) {
        await d().repairWarehouseCardImageFromJob(whCard, image || storedImage, slotJobId);
      }
      const backupRef = image || storedImage;
      if (whCard?.id && backupRef && typeof global.saveCardImageBackup === 'function') {
        void global.getCardImageBackup?.(whCard.id).then((existing) => {
          if (!existing) void global.saveCardImageBackup(whCard.id, backupRef);
        });
      }
      if (isRecovery) {
        /* 恢复流程在 recoverRecentGenerationJobs 末尾统一提示 */
      } else if (!silentToast && idx === 1) {
        if (saved) {
          const published = publish && whCard && d().isCommunityPublishEligible(whCard);
          d().toast(published
            ? `已生成并保存到仓库（已公开到社区，-${cost} 积分）`
            : `已生成并保存到仓库（-${cost} 积分）`);
        } else {
          d().toast(`已生成（-${cost} 积分）`);
        }
      }
      const extras = Array.isArray(extraImages)
        ? extraImages.filter((u) => u && u !== image)
        : [];
      if (!isMidjourney) {
        for (let i = 0; i < extras.length; i += 1) {
          await finishImageGenRun({
            prompt,
            model,
            resolution,
            quality,
            size,
            image: extras[i],
            cost,
            btn,
            jobId: baseJobId,
            targetGroup,
            targetTags,
            silentToast: true,
            isRecovery,
            fromInspirationDraw,
            pendingId: null,
            imageIndex: i + 2
          });
        }
      }
      if (baseJobId && idx === 1) d().clearSessionGenJob(baseJobId);
    } finally {
      if (slotJobId) finishingJobIds.delete(slotJobId);
    }
  }

  function init(injected) {
    deps = injected || {};
    return { finishImageGenRun };
  }

  global.ImageGenFinishRun = { init };
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * 生图完成：写入「最近生成」（7 天），不自动入库卡片库
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};

  const finishingJobIds = new Set();

  function d() { return deps; }

  function baseJobIdFrom(jobId) {
    return jobId ? String(jobId).replace(/#\d+$/, '') : '';
  }

  function findCreationForBaseJob(jobId) {
    const base = baseJobIdFrom(jobId);
    if (!base) return null;
    return (d().getCreations() || []).find((c) => {
      if (!c?.jobId) return false;
      return baseJobIdFrom(c.jobId) === base;
    }) || null;
  }

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
    cardImages,
    refImage: submittedRefImage,
    refImages: submittedRefImages,
    referenceAssets: submittedReferenceAssets
  }) {
    if (!image) {
      d().toast('图片地址无效，请重试');
      return;
    }
    const baseJobId = baseJobIdFrom(jobId);
    const idx = Math.max(1, Number(imageIndex) || 1);
    if (isMidjourney && idx > 1) return;

    const slotJobId = baseJobId ? (idx === 1 ? baseJobId : `${baseJobId}#${idx}`) : null;
    if (slotJobId) {
      if (d().isGenerationJobDeleted(slotJobId) || d().isGenerationJobDeleted(baseJobId)) return;
      const existingCre = findCreationForBaseJob(baseJobId);
      if (existingCre && !isMidjourney) {
        if (idx === 1) {
          d().clearSessionGenJob?.(baseJobId);
          if (pendingId) d().removePendingJob(pendingId);
          d().prunePendingJobsWithCreations?.();
          d().renderImageGenFeed({ preserveScroll: true });
        }
        return;
      }
      if (finishingJobIds.has(slotJobId)) return;
      finishingJobIds.add(slotJobId);
    }
    try {
      const creations = d().getCreations() || [];
      const existingCre = baseJobId ? findCreationForBaseJob(baseJobId) : null;
      const creationId = existingCre?.id || d().genId('cr');
      let storedImage = image;
      const archiveJobId = slotJobId || baseJobId;
      if (global.SupabaseSync?.isLoggedIn?.() && global.SupabaseSync?.archiveGeneratedCardImage && archiveJobId) {
        try {
          const archived = await global.SupabaseSync.archiveGeneratedCardImage(creationId, image, {
            jobId: archiveJobId,
            allowRemoteArchive: true
          });
          if (archived) storedImage = archived;
        } catch (e) {
          console.warn('[finishImageGen] archive to storage failed', e);
        }
      }

      if (slotJobId && global.SupabaseSync?.isStorageRef?.(storedImage)) {
        void global.WarehouseThumb?.resolveForCard?.(storedImage, {
          jobId: slotJobId,
          assetId: creationId,
          cardId: creationId
        });
      }
      if (idx === 1) d().setImageGenLastResult(storedImage);

      const submittedRefs = Array.isArray(submittedRefImages)
        ? submittedRefImages.filter((ref) => d().isDisplayableImage?.(ref))
        : [];
      const formRefs = (d().getImageGenRefImages() || []).filter((ref) => d().isDisplayableImage?.(ref));
      const refImages = submittedRefs.length ? submittedRefs : formRefs;
      const referenceAssets = Array.isArray(submittedReferenceAssets)
        ? submittedReferenceAssets.filter((a) => a && (a.ref || a.imageRef))
        : [];
      const primaryRef = (submittedRefImage && d().isDisplayableImage?.(submittedRefImage))
        ? submittedRefImage
        : (refImages[0] || d().getImageGenPrimaryRef());
      const modelId = model || 'gpt-image-2';
      const modelLabel = global.PointsSystem?.getImageGenModel?.(modelId)?.label || modelId;

      const galleryFromMj = () => {
        if (Array.isArray(cardImages) && cardImages.length) {
          return cardImages.filter(Boolean).slice(0, global.PromptHubCardGallery?.MAX || 5);
        }
        if (Array.isArray(mjGridUrls) && mjGridUrls.length) {
          return mjGridUrls.filter(Boolean).slice(0, global.PromptHubCardGallery?.MAX || 5);
        }
        if (mjCompositeUrl && storedImage) {
          return [mjCompositeUrl, storedImage].filter(Boolean).slice(0, 5);
        }
        return storedImage ? [storedImage] : [];
      };

      let mjGalleryStored = null;
      if (isMidjourney && global.SupabaseSync?.isLoggedIn?.() && global.SupabaseSync?.archiveGeneratedCardImage && archiveJobId) {
        const rawGallery = galleryFromMj();
        if (rawGallery.length > 1) {
          mjGalleryStored = [];
          for (let gi = 0; gi < rawGallery.length; gi += 1) {
            const slot = gi === 0 ? archiveJobId : `${String(archiveJobId).replace(/#\d+$/, '')}#${gi + 1}`;
            try {
              const a = await global.SupabaseSync.archiveGeneratedCardImage(creationId, rawGallery[gi], {
                jobId: slot,
                allowRemoteArchive: true
              });
              mjGalleryStored.push(a || rawGallery[gi]);
            } catch (e) {
              mjGalleryStored.push(rawGallery[gi]);
            }
          }
        }
      }

      const cardMjGridUrls = isMidjourney
        ? (Array.isArray(mjGridUrls) && mjGridUrls.length
          ? mjGridUrls.slice(0, 4)
          : galleryFromMj().slice(1, 5))
        : null;

      const creation = {
        id: creationId,
        jobId: baseJobId || slotJobId,
        prompt: prompt || '',
        image: isMidjourney ? (galleryFromMj()[0] || storedImage) : storedImage,
        refImage: primaryRef,
        refImages: refImages.length ? [...refImages] : null,
        referenceAssets: referenceAssets.length ? referenceAssets.map((a) => ({ ...a, ref: a.ref || a.imageRef })) : null,
        model: modelId,
        modelLabel,
        resolution,
        quality: quality || 'standard',
        size: size || '1:1',
        hasRefImage: refImages.length > 0,
        visibility: 'private',
        createdAt: existingCre?.createdAt || Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + (d().genRetentionMs?.() || 7 * 24 * 60 * 60 * 1000),
        isMidjourney: !!isMidjourney,
        mjGridUrls: cardMjGridUrls,
        mjCompositeUrl: isMidjourney && mjCompositeUrl ? mjCompositeUrl : null,
        mjButtons: isMidjourney && Array.isArray(mjButtons) ? mjButtons : null,
        cardImages: isMidjourney ? (mjGalleryStored || galleryFromMj()) : null,
        genBatchId: genBatchId || existingCre?.genBatchId || null,
        fromInspirationDraw: !!fromInspirationDraw,
        savedToWarehouse: !!existingCre?.savedToWarehouse,
        warehouseCardId: existingCre?.warehouseCardId || null
      };

      const nextList = existingCre
        ? [creation, ...creations.filter((c) => c.id !== creationId)]
        : d().dedupeCreationsByJobId([creation, ...creations]);

      d().setCreations(nextList);
      if (idx === 1) d().setImageGenActiveHistoryId(creation.id);
      d().persistCreations();
      d().switchImageGenFeedToRecent?.();
      d().updateImageGenFeedHint();
      global.PointsSystem?.updateCreditsUI?.();

      if (btn) {
        btn.disabled = false;
        d().restoreImageGenSubmitLabel();
      }
      if (pendingId && idx === 1) d().removePendingJob(pendingId);
      d().prunePendingJobsWithCreations?.();
      d().renderImageGenFeed({ preserveScroll: true, force: true });
      d().renderImageGenMobileResult?.();

      if (!isRecovery && !silentToast && idx === 1) {
        d().toast(isMidjourney
          ? `已生成（最近保留 7 天，喜欢请点「存入库」）· -${cost} 积分`
          : `已加入最近生成（7 天内可存入库）· -${cost} 积分`);
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
            imageIndex: i + 2,
            refImage: primaryRef,
            refImages,
            referenceAssets
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

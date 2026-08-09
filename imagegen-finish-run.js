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

  function slotFromArchiveJobId(jobId) {
    const m = String(jobId || '').match(/#(\d+)$/);
    if (!m) return 0;
    return Math.max(0, Number(m[1]) - 1);
  }

  function findCreationForBaseJob(jobId) {
    const base = baseJobIdFrom(jobId);
    if (!base) return null;
    return (d().getCreations() || []).find((c) => {
      if (!c?.jobId) return false;
      return baseJobIdFrom(c.jobId) === base;
    }) || null;
  }

  function replaceArchivedImageRefs(creation, rawImage, archivedImage) {
    if (!creation || !rawImage || !archivedImage || rawImage === archivedImage) return null;
    const replace = (value) => value === rawImage ? archivedImage : value;
    const next = { ...creation };
    let changed = false;
    for (const key of ['image', 'mjCompositeUrl']) {
      if (next[key] === rawImage) {
        next[key] = archivedImage;
        changed = true;
      }
    }
    for (const key of ['cardImages', 'mjGridUrls']) {
      if (!Array.isArray(next[key])) continue;
      const values = next[key].map((value) => replace(value));
      if (values.some((value, index) => value !== next[key][index])) {
        next[key] = values;
        changed = true;
      }
    }
    return changed ? next : null;
  }

  function gridPathFromStorageRef(storageRef) {
    const path = String(storageRef || '')
      .replace(/^storage:\/\/card-images\//i, '')
      .replace(/^\//, '');
    if (!path || !/^[A-Za-z0-9-]+\//.test(path)) return '';
    return path.replace(/\.(png|jpe?g|webp)$/i, '') + '_grid.jpg';
  }

  function gridDataUrlToBlob(dataUrl) {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return Promise.resolve(null);
    return fetch(dataUrl).then((res) => (res.ok ? res.blob() : null)).catch(() => null);
  }

  /** 浏览器端生成 _grid 并上传 R2（失败静默，不阻塞生图流程） */
  function uploadGeneratedGridThumb(creationId, storageRef, jobId, slot) {
    if (
      !creationId
      || !storageRef
      || !global.SupabaseSync?.isStorageRef?.(storageRef)
      || !global.SupabaseSync?.resolveDisplayUrl
      || !global.PromptHubApi?.uploadStorageBlob
      || !global.ImageGenRefCompress?.compressRefImageFromSource
    ) return;
    const gridPath = gridPathFromStorageRef(storageRef);
    if (!gridPath) return;
    void Promise.resolve()
      .then(() => global.SupabaseSync.resolveDisplayUrl(storageRef, {
        variant: 'full',
        jobId: jobId || undefined,
        assetId: creationId
      }))
      .then((url) => url && global.ImageGenRefCompress.compressRefImageFromSource(url, 640, { crossOrigin: true }))
      .then((dataUrl) => gridDataUrlToBlob(dataUrl))
      .then((blob) => blob && blob.size >= 2048
        ? global.PromptHubApi.uploadStorageBlob(gridPath, blob)
        : null)
      .then((uploaded) => {
        if (!uploaded) return;
        if (global.WarehouseThumb?.invalidateGridCache) {
          global.WarehouseThumb.invalidateGridCache(jobId || gridPath, Number(slot) || 0);
        }
        global.SupabaseSync?.markGridThumbReady?.(creationId);
        d().renderImageGenFeed?.({ preserveScroll: true });
      })
      .catch((error) => console.warn('[finishImageGen] grid thumb upload skipped', error));
  }

  function archiveImageInBackground(creationId, rawImage, archiveJobId) {
    if (
      !creationId
      || !rawImage
      || !archiveJobId
      || !global.SupabaseSync?.isLoggedIn?.()
      || !global.SupabaseSync?.archiveGeneratedCardImage
    ) return;
    void Promise.resolve()
      .then(() => global.SupabaseSync.archiveGeneratedCardImage(creationId, rawImage, {
        jobId: archiveJobId,
        allowRemoteArchive: true
      }))
      .then((archived) => {
        if (!archived || archived === rawImage) return;
        const current = d().getCreations?.() || [];
        const live = current.find((item) => item?.id === creationId);
        const next = replaceArchivedImageRefs(live, rawImage, archived);
        if (!next) return;
        d().setCreations?.(current.map((item) => item?.id === creationId ? next : item));
        d().persistCreations?.();
        if (next.image === archived) d().setImageGenLastResult?.(archived);
        if (global.SupabaseSync?.isStorageRef?.(archived)) {
          void global.WarehouseThumb?.resolveForCard?.(archived, {
            jobId: archiveJobId,
            assetId: creationId,
            cardId: creationId
          });
          uploadGeneratedGridThumb(creationId, archived, archiveJobId, slotFromArchiveJobId(archiveJobId));
        }
        d().renderImageGenFeed?.({ preserveScroll: true });
      })
      .catch((error) => console.warn('[finishImageGen] background archive failed', error));
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
      // Show the upstream result immediately. Storage archiving is best-effort
      // and must not hold the paid generation in a pending state.
      const storedImage = image;
      const archiveJobId = slotJobId || baseJobId;
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
      const modelId = model || 'image2';
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
        cardImages: isMidjourney ? galleryFromMj() : null,
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
      d().renderImageGenFeed({ preserveScroll: true });
      d().renderImageGenMobileResult?.();

      if (archiveJobId) {
        if (isMidjourney) {
          galleryFromMj().forEach((rawImage, galleryIndex) => {
            const archiveSlot = galleryIndex === 0
              ? archiveJobId
              : `${String(archiveJobId).replace(/#\d+$/, '')}#${galleryIndex + 1}`;
            archiveImageInBackground(creationId, rawImage, archiveSlot);
          });
        } else {
          archiveImageInBackground(creationId, image, archiveJobId);
        }
      }

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

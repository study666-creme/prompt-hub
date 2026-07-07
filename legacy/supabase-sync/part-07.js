        if (check.merged) payload = check.merged;
      } catch (e) {
        if (e.message && e.message.includes('已阻止')) throw e;
        if (!opts.allowWithoutCloudCheck) {
          throw new Error('无法校验云端数据，已取消上传：' + formatError(e));
        }
      }
    }

    const imageSnapshot = (payload.cards || []).map((c) => ({
      id: c?.id,
      image: c?.image
    }));
    let preparedCards = payload.cards || [];
    let warnings = [];
    if (opts.deferImageUpload !== true) {
      const prep = await prepareCardsForCloud(payload.cards || [], {
        strict: opts.strictImageCheck === true,
        concurrency: opts.concurrency
      });
      preparedCards = prep.cards;
      warnings = prep.warnings;
    }
    const restoredCards = (preparedCards || []).map((c) => {
      const snap = imageSnapshot.find((s) => String(s.id) === String(c.id));
      if (snap?.image && !c.image) return { ...c, image: snap.image };
      return c;
    });
    const prepared = slimPayloadForCloudStorage({
      ...payload,
      cards: restoredCards,
      schemaVersion: window.CloudSyncSafety?.SCHEMA_VERSION || 2
    });
    const updatedAt = new Date().toISOString();
    const { error } = await sb.from('user_data').upsert({
      user_id: uid,
      data: prepared,
      updated_at: updatedAt
    }, { onConflict: 'user_id' });
    if (error) throw new Error(formatError(error));
    setLocalCloudUpdatedAt(uid, updatedAt);
    if (Array.isArray(prepared.cards)) payload.cards = prepared.cards;
    return { warnings, data: prepared };
  }

  window.SupabaseSync = {
    isConfigured,
    isLoggedIn,
    getUserId,
    getSession,
    getValidAccessToken,
    markSessionExpired,
    healSessionOnResume,
    refreshSessionOnce,
    getUserEmail,
    isDataUrl,
    isStorageUrl,
    isStorageRef,
    storagePathFromRef,
    storagePathOwnedByCurrentUser,
    primaryImagePath,
    isGridStoragePath,
    storagePathFromCdnUrl,
    isWarehouseBlockedFullUrl,
    needsDegradedListPreview,
    gridListNeedsPrimaryFallback,
    communityListGridRef,
    storagePathFromDisplayUrl,
    isPathKnownMissing,
    markPathMissing,
    resetMediaSignEnvironment,
    clearPathMissingForCard,
    resetMissingPathCache,
    healMissingPathCacheForCards,
    markGridFetchFailed,
    clearSessionGridFetchFailures,
    bootstrapWarehouseMediaCache,
    isGridFetchFailed,
    isGridFetchFailed,
    shouldSignGridPath,
    resolveListPrimaryFallback,
    cardImageStillResolvable,
    isLegacyImageRestorePhase,
    shouldShowCardInWarehouse,
    shouldShowPostInCommunityFeed,
    isInvalidMediaUrl,
    isCdnMediaUrl,
    isGridDisplayUrl,
    safeListImgUrl,
    invalidateCorruptGrid,
    warmGeneratedGridThumb,
    isEphemeralUpstreamImageUrl,
    normalizeImageRef,
    resolveDisplayUrl,
    prefetchDisplayUrls,
    prefetchDisplayUrlsWithCap,
    prefetchCardsImages,
    prefetchWarehousePage,
    cardListThumbStorageRef,
    cardNeedsWarehouseThumbServer,
    isGeneratedStoragePath,
    cardUsesGeneratedStorage,
    batchSignPaths,
    prefetchCommunityDisplayUrls,
    patchImageSrcFromCache,
    getCachedDisplayUrl,
    getListDisplayImageSrc,
    listImagePathCandidates,
    cardImageStoragePath,
    gridImageStoragePath,
    gridPathFromPrimary,
    blobLooksLikeUsableImage,
    downloadOwnedStorageBlob,
    verifyStorageRef,
    toStorageRef,
    invalidateSignedCache,
    invalidateSignedCacheForRef,
    isFreshSignedDisplayUrl,
    isValidSignedDisplayUrl,
    isResolvableDisplayUrl,
    isIncompleteSignedStorageUrl,
    VARIANT_GRID,
    VARIANT_FULL,
    safeImgSrc,
    publicUrlFromPath,
    repairAllCardImagesBeforeSync,
    resolveLocalImageFallback,
    uploadStorageBlob,
    auditBrokenCardImages,
    repairCardImageIfMissing,
    findCardImageInStorage,
    hydrateImageElements,
    persistGenerationImage,
    archiveGeneratedCardImage,
    uploadGeneratedImage,
    clearSignedUrlCache,
    clearListImageMissMarks,
    init,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    sendPhoneOtp,
    verifyPhoneOtp,
    sendPhoneOtpForBind,
    verifyPhoneOtpForBind,
    normalizePhone,
    isPhoneAuthEnabled,
    isWeChatAuthEnabled,
    formatAuthError,
    pullCloudMeta,
    pullCloudData,
    wasLastCloudPullSkipped,
    getLocalCloudUpdatedAt,
    pushCloudData,
    uploadCardImage,
    uploadImageGenRef,
    deleteCardImageByUrl,
    resolveCardImageForSave,
    resolveCardDownloadUrl,
    resolvePreviewFullUrl,
    downloadCardStorageBlob,
    downloadCardFullResBlob,
    isGeneratedWarehouseCard,
    expectedMinFullImageBytes,
    rearchiveGeneratedCardFromJob,
    cardUploadOriginalEnabled,
    preserveOriginalCardImageFromSettings,
    prepareCardFullUploadBlob,
    ensureCardImageOnCloud,
    cardNeedsCloudImageUpload,
    payloadNeedsImageUpload,
    repairMissingCardImages,
    clearGridMissingMarksForReadyCards,
    backfillGridThumbsForCards,
    diagnoseGridBackfillPending,
    queueGridBackfill,
    isGridThumbReady,
    isGridBackfillSkipped,
    clearGridBackfillSkipped,
    prepareCardsForCloud,
    formatError
  };
})();

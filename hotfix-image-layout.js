/** @deprecated 卡片库请用 card-image-loader.js；此处仅补社区/生图网格 */
(function () {
  window.forceRefreshAllImages = function () {
    const box = document.getElementById('cardsContainer');
    if (box && window.CardImageLoader) {
      window.CardImageLoader.patchVisibleFromCache(box);
    }
    ['communityGrid', 'creationsGrid', 'userProfileGrid', 'imageGenFeed'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      window.SupabaseSync?.patchImageSrcFromCache?.(el);
      if (id === 'imageGenFeed') window.FeatureDraft?.scheduleImageGenFeedLayout?.();
      else if (id === 'communityGrid' || id === 'creationsGrid') {
        if (window.matchMedia('(max-width: 900px)').matches) {
          window.FeatureDraft?.enforceMobileCommunityFeedGrid?.(id);
        } else {
          window.FeatureDraft?.scrubCommunityFeedFlexCards?.(el);
          window.FeatureDraft?.repairCommunityFeedLayout?.(id);
        }
      } else window.FeatureDraft?.layoutCommunityMasonry?.(id);
    });
  };
})();

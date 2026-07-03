/**
 * MediaPipeline 薄代理：实现已迁入 pack-media-client（PromptHubMedia）
 */
(function () {
  'use strict';

  function attachFromPromptHubMedia() {
    const M = window.PromptHubMedia;
    if (!M?.exportPipeline) return false;
    window.MediaPipeline = M.exportPipeline();
    return true;
  }

  if (!attachFromPromptHubMedia()) {
    console.warn('[media-pipeline] PromptHubMedia missing — list/preview resolve may fail until pack-media-client loads');
    window.MediaPipeline = {
      VARIANT_LIST: 'grid',
      VARIANT_PREVIEW: 'full',
      resetOnLogin: () => {},
      getListCached: () => '',
      getPreviewCached: () => '',
      safeImgSrc: (image) => image || '',
      gridUrlFromImgEl: () => '',
      resolveListUrl: async () => '',
      resolveCardListThumb: async () => '',
      resolvePreviewUrl: async () => '',
      resolveFeedUrl: async () => '',
      prefetchList: async () => {},
      patchContainerFromCache: () => {},
      isUsableGenRefUrl: () => false
    };
  }
})();

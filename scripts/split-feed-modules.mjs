/**
 * Extract feed-images.js + image-gen-feed.js from features-draft.js
 * Run: node scripts/split-feed-modules.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'features-draft.js');
const lines = fs.readFileSync(srcPath, 'utf8').split('\n');

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

function indentBlock(code, spaces = 2) {
  const pad = ' '.repeat(spaces);
  return code.split('\n').map((l) => (l ? pad + l : l)).join('\n');
}

const feedImagesParts = [
  slice(317, 327),
  slice(2363, 2456),
  slice(2461, 2661),
  slice(2671, 2709),
  slice(2752, 2766),
  slice(2826, 2968),
];

let feedImagesBody = feedImagesParts.join('\n\n');
feedImagesBody = feedImagesBody
  .replace(/\bisDisplayableImage\(/g, 'isDisplayableImage(')
  .replace(/\bcommunityFeedPageLoading\b/g, 'd().getCommunityFeedPageLoading?.()')
  .replace(/\bisMobileFeedViewport\(\)/g, 'd().isMobileFeedViewport?.()')
  .replace(/\bresetMobileFeedGridStyles\(\)/g, 'd().resetMobileFeedGridStyles?.()')
  .replace(/\blayoutImageGenFeedMasonry\(\)/g, 'd().layoutImageGenFeedMasonry?.()')
  .replace(/\bscrubCommunityFeedCardMediaHeights\(/g, 'd().scrubCommunityFeedCardMediaHeights?.(');

const feedImagesFile = `/**
 * Feed 图片 URL 解析、hydrate、错误回退（与 features-draft 业务解耦）
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};
  const displayUrlCache = new Map();

  const IMG_LOADING_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect fill="%2318181c" width="16" height="16"/></svg>'
  );

  function d() {
    return deps;
  }

  function isDisplayableImage(v) {
    return d().isDisplayableImage?.(v) ?? false;
  }

${indentBlock(feedImagesBody)}

  function init(injected) {
    deps = injected || {};
    return {
      displayUrlCache,
      IMG_LOADING_PLACEHOLDER,
      feedAssetIdFromImg,
      mergeCollectResolveOpts,
      resolveImageDisplayUrl,
      imageGenFeedSignOpts,
      communityImageSignOpts,
      bindFeedImgErrorFallback,
      applyFeedImageSrc,
      hydrateFeedImages,
      hydrateFeedImageOne,
      releaseFeedMediaLoading,
      stripFailedFeedMedia,
      removeBrokenCommunityFeedCard,
      pruneEmptyCommunityFeedCards,
      revealCommunityFeedImages
    };
  }

  global.FeedImages = { init };
})(typeof window !== 'undefined' ? window : globalThis);
`;

const imageGenParts = [
  slice(2663, 2669),
  slice(3065, 3074),
  slice(3200, 3305),
  slice(8900, 8924),
  slice(8981, 9005),
  slice(9007, 9020),
  slice(9022, 9090),
  slice(9469, 9537),
  slice(9595, 9867),
];

let imageGenBody = imageGenParts.join('\n\n');
const depReplacements = [
  [/\besc\(/g, 'd().esc?.('],
  [/\bisDisplayableImage\(/g, 'd().isDisplayableImage?.('],
  [/\bisMobileFeedViewport\(\)/g, 'd().isMobileFeedViewport?.()'],
  [/\bgetMasonryGap\(\)/g, 'd().getMasonryGap?.()'],
  [/\bgetImageGenFeedColumns\(/g, 'd().getImageGenFeedColumns?.('],
  [/\bsetFeedLayoutPending\(/g, 'd().setFeedLayoutPending?.('],
  [/\bimageGenFeedTab\b/g, 'd().getImageGenFeedTab?.()'],
  [/\bimageGenWhGroup\b/g, 'd().getImageGenWhGroup?.()'],
  [/\bimageGenWhTag\b/g, 'd().getImageGenWhTag?.()'],
  [/\bimageGenPendingJobs\b/g, '(d().getImageGenPendingJobs?.() ?? [])'],
  [/\bimageGenFailedJobs\b/g, '(d().getImageGenFailedJobs?.() ?? [])'],
  [/\blikedIds\.has\(/g, 'd().getLikedIds?.()?.has('],
  [/\bactivePollJobIds\.delete\(/g, 'd().getActivePollJobIds?.()?.delete('],
  [/\bcommunityScope\b/g, 'd().getCommunityScope?.()'],
  [/\bcommunitySort\b/g, 'd().getCommunitySort?.()'],
  [/\bgetCommunityFeedForDisplay\(\)/g, 'd().getCommunityFeedForDisplay?.()'],
  [/\bfilterAndSortPosts\(/g, 'd().filterAndSortPosts?.('],
  [/\bisGenericPostTitle\(/g, 'd().isGenericPostTitle?.('],
  [/\bimageGenModelLabel\(/g, 'd().imageGenModelLabel?.('],
  [/\bformatTime\(/g, 'd().formatTime?.('],
  [/\bfailedJobModelLabel\(/g, 'd().failedJobModelLabel?.('],
  [/\bfriendlyGenErrorMessage\(/g, 'd().friendlyGenErrorMessage?.('],
  [/\bbatchIndexLabel\(/g, 'd().batchIndexLabel?.('],
  [/\bupdateImageGenFeedHint\(\)/g, 'd().updateImageGenFeedHint?.()'],
  [/\brenderImageGenMobileResult\(\)/g, 'd().renderImageGenMobileResult?.()'],
  [/\bhydrateFeedImageOne\(/g, 'd().hydrateFeedImageOne?.('],
  [/\bopenImageGenLightboxAt\(/g, 'd().openImageGenLightboxAt?.('],
  [/\bopenImageGenPreview\(/g, 'd().openImageGenPreview?.('],
  [/\bfillFeedPromptToActiveMode\(/g, 'd().fillFeedPromptToActiveMode?.('],
  [/\bcopyFeedPromptText\(/g, 'd().copyFeedPromptText?.('],
  [/\bgetActiveImageGenMode\(\)/g, 'd().getActiveImageGenMode?.()'],
  [/\blikeCommunityPostOnly\(/g, 'd().likeCommunityPostOnly?.('],
  [/\bremoveFailedGenJob\(/g, 'd().removeFailedGenJob?.('],
  [/\bremovePendingJob\(/g, 'd().removePendingJob?.('],
  [/\bclearSessionGenJob\(/g, 'd().clearSessionGenJob?.('],
  [/\blikedIds\.has\(/g, 'd().getLikedIds?.()?.has('],
  [/\bactivePollJobIds\.delete\(/g, 'd().getActivePollJobIds?.()?.delete('],
  [/\bIMAGEGEN_FEED_PENDING_CAP\b/g, 'd().IMAGEGEN_FEED_PENDING_CAP ?? 6'],
  [/\bIMAGEGEN_FEED_FAILED_CAP\b/g, 'd().IMAGEGEN_FEED_FAILED_CAP ?? 4'],
  [/\bIMG_LOADING_PLACEHOLDER\b/g, 'd().IMG_LOADING_PLACEHOLDER'],
  [/\bimageGenFeedScrollEl\(\)/g, 'document.getElementById(\'imageGenFeed\')'],
];
for (const [re, rep] of depReplacements) {
  imageGenBody = imageGenBody.replace(re, rep);
}

const imageGenFile = `/**
 * 生图仓库 Feed：Masonry 排版、渲染、分页（与 features-draft 业务解耦）
 */
(function (global) {
  'use strict';

  const IMAGEGEN_FEED_PER_PAGE = 24;

  /** @type {Record<string, any>} */
  let deps = {};
  /** @type {import('masonry-layout')|null} */
  let imageGenMasonry = null;
  let imageGenLayoutTimer = null;
  /** @type {{ sig: string, page: number, whCards: any[], commPosts: any[] }|null} */
  let imageGenFeedPagedStore = null;
  let imageGenFeedScrollLoading = false;

  function d() {
    return deps;
  }

${indentBlock(imageGenBody)}

  function init(injected) {
    deps = injected || {};
    return {
      IMAGEGEN_FEED_PER_PAGE,
      layoutImageGenFeedMasonry,
      scheduleImageGenFeedLayout,
      resetImageGenFeedCardLayout,
      bindImageGenFeedImageRelayout,
      enforceMobileImageGenFeed,
      resetMobileFeedGridStyles: enforceMobileImageGenFeed,
      buildFeedCardHtml,
      buildFeedPendingCardHtml,
      buildFeedFailedCardHtml,
      feedImgStorageAttr,
      getImageGenWarehouseFeedList,
      getImageGenCommunityFeedList,
      imageGenFeedListSignature,
      warehouseCardToFeedHtml,
      communityPostToFeedHtml,
      getImageGenFeedNavItems,
      imageGenFeedHasMorePages,
      syncImageGenFeedLoadMoreBtn,
      bindImageGenFeedPagedScroll,
      renderImageGenFeed,
      bindImageGenFeedCardEvents
    };
  }

  global.ImageGenFeed = { init };
})(typeof window !== 'undefined' ? window : globalThis);
`;

fs.writeFileSync(path.join(root, 'feed-images.js'), feedImagesFile, 'utf8');
fs.writeFileSync(path.join(root, 'image-gen-feed.js'), imageGenFile, 'utf8');
console.log('Generated feed-images.js + image-gen-feed.js');

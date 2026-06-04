/**
 * Patch features-draft.js after split-feed-modules.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const file = path.join(root, 'features-draft.js');
const lines = fs.readFileSync(file, 'utf8').split('\n');

const deleteRanges = [
  [317, 327],
  [2363, 2710],
  [2752, 2766],
  [2826, 2968],
  [3065, 3074],
  [3200, 3305],
  [8900, 8924],
  [8977, 8979],
  [8981, 9090],
  [9469, 9537],
  [9595, 9867],
];

const del = new Set();
for (const [a, b] of deleteRanges) {
  for (let i = a; i <= b; i++) del.add(i);
}

const kept = lines.filter((_, i) => !del.has(i + 1));
let text = kept.join('\n');

text = text.replace(
  '  let imageGenMasonry = null;\n',
  '  /* imageGenMasonry → image-gen-feed.js */\n'
);
text = text.replace(
  '  let imageGenFeedPagedStore = null;\n  let imageGenFeedScrollLoading = false;\n',
  '  /* imageGenFeedPagedStore → image-gen-feed.js */\n  let imageGenFeedScrollLoading = false;\n'
);
text = text.replace(
  '  let imageGenLayoutTimer = null;\n  const displayUrlCache = new Map();\n',
  '  /* displayUrlCache → feed-images.js */\n'
);

const wireBlock = `
  /* —— Feed 图片：feed-images.js —— */
  let feedAssetIdFromImg;
  let resolveImageDisplayUrl;
  let imageGenFeedSignOpts;
  let communityImageSignOpts;
  let applyFeedImageSrc;
  let hydrateFeedImages;
  let hydrateFeedImageOne;
  let releaseFeedMediaLoading;
  let stripFailedFeedMedia;
  let removeBrokenCommunityFeedCard;
  let pruneEmptyCommunityFeedCards;
  let revealCommunityFeedImages;

  function wireFeedImages() {
    if (window.__feedImagesWired) return;
    const FI = window.FeedImages.init({
      isDisplayableImage,
      getCommunityFeedPageLoading: () => communityFeedPageLoading,
      isMobileFeedViewport,
      resetMobileFeedGridStyles: () => resetMobileFeedGridStyles(),
      layoutImageGenFeedMasonry: () => layoutImageGenFeedMasonry(),
      scrubCommunityFeedCardMediaHeights
    });
    feedAssetIdFromImg = FI.feedAssetIdFromImg;
    resolveImageDisplayUrl = FI.resolveImageDisplayUrl;
    imageGenFeedSignOpts = FI.imageGenFeedSignOpts;
    communityImageSignOpts = FI.communityImageSignOpts;
    applyFeedImageSrc = FI.applyFeedImageSrc;
    hydrateFeedImages = FI.hydrateFeedImages;
    hydrateFeedImageOne = FI.hydrateFeedImageOne;
    releaseFeedMediaLoading = FI.releaseFeedMediaLoading;
    stripFailedFeedMedia = FI.stripFailedFeedMedia;
    removeBrokenCommunityFeedCard = FI.removeBrokenCommunityFeedCard;
    pruneEmptyCommunityFeedCards = FI.pruneEmptyCommunityFeedCards;
    revealCommunityFeedImages = FI.revealCommunityFeedImages;
    window.__feedImagesWired = true;
  }

  /* —— 生图仓库 Feed：image-gen-feed.js —— */
  let layoutImageGenFeedMasonry;
  let scheduleImageGenFeedLayout;
  let resetImageGenFeedCardLayout;
  let bindImageGenFeedImageRelayout;
  let enforceMobileImageGenFeed;
  let buildFeedCardHtml;
  let buildFeedPendingCardHtml;
  let buildFeedFailedCardHtml;
  let getImageGenWarehouseFeedList;
  let getImageGenCommunityFeedList;
  let imageGenFeedListSignature;
  let warehouseCardToFeedHtml;
  let communityPostToFeedHtml;
  let getImageGenFeedNavItems;
  let imageGenFeedHasMorePages;
  let syncImageGenFeedLoadMoreBtn;
  let bindImageGenFeedPagedScroll;
  let renderImageGenFeed;
  let bindImageGenFeedCardEvents;

  function wireImageGenFeed() {
    if (window.__imageGenFeedWired) return;
    const IG = window.ImageGenFeed.init({
      esc,
      isDisplayableImage,
      isMobileFeedViewport,
      getMasonryGap,
      getImageGenFeedColumns,
      setFeedLayoutPending,
      IMG_LOADING_PLACEHOLDER,
      hydrateFeedImageOne: (...a) => hydrateFeedImageOne(...a),
      getImageGenFeedTab: () => imageGenFeedTab,
      getImageGenWhGroup: () => imageGenWhGroup,
      getImageGenWhTag: () => imageGenWhTag,
      getImageGenPendingJobs: () => imageGenPendingJobs,
      getImageGenFailedJobs: () => imageGenFailedJobs,
      getCommunityScope: () => communityScope,
      getCommunitySort: () => communitySort,
      getLikedIds: () => likedIds,
      getCommunityFeedForDisplay,
      filterAndSortPosts,
      isGenericPostTitle,
      isGenericFeedTitle,
      imageGenModelLabel,
      formatTime,
      failedJobModelLabel,
      friendlyGenErrorMessage,
      batchIndexLabel,
      updateImageGenFeedHint,
      renderImageGenMobileResult,
      openImageGenLightboxAt,
      openImageGenPreview,
      fillFeedPromptToActiveMode,
      copyFeedPromptText,
      getActiveImageGenMode,
      likeCommunityPostOnly,
      removeFailedGenJob,
      removePendingJob,
      clearSessionGenJob,
      getActivePollJobIds: () => activePollJobIds,
      IMAGEGEN_FEED_PENDING_CAP,
      IMAGEGEN_FEED_FAILED_CAP
    });
    layoutImageGenFeedMasonry = IG.layoutImageGenFeedMasonry;
    scheduleImageGenFeedLayout = IG.scheduleImageGenFeedLayout;
    resetImageGenFeedCardLayout = IG.resetImageGenFeedCardLayout;
    bindImageGenFeedImageRelayout = IG.bindImageGenFeedImageRelayout;
    enforceMobileImageGenFeed = IG.enforceMobileImageGenFeed;
    buildFeedCardHtml = IG.buildFeedCardHtml;
    buildFeedPendingCardHtml = IG.buildFeedPendingCardHtml;
    buildFeedFailedCardHtml = IG.buildFeedFailedCardHtml;
    getImageGenWarehouseFeedList = IG.getImageGenWarehouseFeedList;
    getImageGenCommunityFeedList = IG.getImageGenCommunityFeedList;
    imageGenFeedListSignature = IG.imageGenFeedListSignature;
    warehouseCardToFeedHtml = IG.warehouseCardToFeedHtml;
    communityPostToFeedHtml = IG.communityPostToFeedHtml;
    getImageGenFeedNavItems = IG.getImageGenFeedNavItems;
    imageGenFeedHasMorePages = IG.imageGenFeedHasMorePages;
    syncImageGenFeedLoadMoreBtn = IG.syncImageGenFeedLoadMoreBtn;
    bindImageGenFeedPagedScroll = IG.bindImageGenFeedPagedScroll;
    renderImageGenFeed = IG.renderImageGenFeed;
    bindImageGenFeedCardEvents = IG.bindImageGenFeedCardEvents;
    window.__imageGenFeedWired = true;
  }

  function resetMobileFeedGridStyles() {
    enforceMobileImageGenFeed?.();
  }
`;

if (!text.includes('wireFeedImages')) {
  text = text.replace(
    '  function wireFeedLayout() {',
    wireBlock + '\n  function wireFeedLayout() {'
  );
}

text = text.replace(
  '  wireFeedLayout();\n',
  '  wireFeedImages();\n  wireImageGenFeed();\n  wireFeedLayout();\n'
);

fs.writeFileSync(file, text, 'utf8');
console.log('Patched features-draft.js, lines:', text.split('\n').length);

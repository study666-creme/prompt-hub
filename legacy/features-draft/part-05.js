  async function fetchMorePublicCommunityFeed() {
    if (typeof _fetchMorePublicCommunityFeed === 'function') return _fetchMorePublicCommunityFeed();
    return null;
  }
  let _savePublicFeedCache;
  function savePublicFeedCache(posts) {
    if (typeof _savePublicFeedCache === 'function') return _savePublicFeedCache(posts);
  }
  let _normalizeFeedPost;
  function normalizeFeedPost(p) {
    if (typeof _normalizeFeedPost === 'function') return _normalizeFeedPost(p);
    return null;
  }
  let _mergePostsLists;
  function mergePostsLists(...lists) {
    if (typeof _mergePostsLists === 'function') return _mergePostsLists(...lists);
    return [];
  }
  let _mergePublicFeedHead;
  function mergePublicFeedHead(incoming) {
    if (typeof _mergePublicFeedHead === 'function') return _mergePublicFeedHead(incoming);
    return false;
  }
  let _fetchAllPublicCommunityFeedPages;
  async function fetchAllPublicCommunityFeedPages(timeoutMs) {
    if (typeof _fetchAllPublicCommunityFeedPages === 'function') {
      return _fetchAllPublicCommunityFeedPages(timeoutMs);
    }
    return null;
  }
  let PUBLIC_FEED_TTL_MS = 120_000;
  let LS_PUBLIC_FEED_CACHE = 'promptrepo_public_feed_cache';

  function wireCommunityPublicFeed() {
    if (window.__communityPublicFeedWired) return;
    if (!window.CommunityPublicFeed?.init) {
      console.error('[FeatureDraft] pack-feed.js not loaded — CommunityPublicFeed missing');
      return;
    }
    const CPF = window.CommunityPublicFeed.init({
      state: publicFeedState,
      getFeedPerPage: () => FEED_PER_PAGE,
      sortPostsByActivity,
      scheduleProgressiveCommunityRender,
      logFeedPageDebug,
      rebuildOwnPostFilterCache,
      invalidateCommunityReconcileCache,
      pruneLocalCommunityNotOnServer,
      onLoggedInFeedRefreshed: (posts) => {
        if (window.CloudSyncSafety?.mergeCommunityPostsList) {
          const pubForLocal = filterFeedPostsForPublishFlags(posts);
          communityPosts = CPF.mergePostsLists(
            window.CloudSyncSafety.mergeCommunityPostsList(communityPosts, pubForLocal),
            buildPostsFromPublishedCards()
          );
          saveJson(LS_COMMUNITY, communityPosts.filter((p) => !p.isMock));
        }
      }
    });
    _normalizeFeedPost = CPF.normalizeFeedPost;
    authorIdFromPostImage = CPF.authorIdFromPostImage;
    communityPostDisplayKey = CPF.communityPostDisplayKey;
    _mergePostsLists = CPF.mergePostsLists;
    loadPublicFeedCache = CPF.loadPublicFeedCache;
    _savePublicFeedCache = CPF.savePublicFeedCache;
    _hydratePublicFeedFromCache = CPF.hydratePublicFeedFromCache;
    _publicFeedNeedsFullRefresh = CPF.publicFeedNeedsFullRefresh;
    _mergePublicFeedHead = CPF.mergePublicFeedHead;
    _fetchAllPublicCommunityFeedPages = CPF.fetchAllPublicCommunityFeedPages;
    _refreshPublicCommunityFeed = CPF.refreshPublicCommunityFeed;
    _fetchMorePublicCommunityFeed = CPF.fetchMorePublicCommunityFeed;
    PUBLIC_FEED_TTL_MS = CPF.PUBLIC_FEED_TTL_MS;
    LS_PUBLIC_FEED_CACHE = CPF.LS_PUBLIC_FEED_CACHE;
    window.__communityPublicFeedWired = true;
  }

  /* —— Feed 排版：feed-layout.js（见 docs/FEED-LAYOUT.md）—— */

  function useCssGridForCommunityFeed(containerId) {
    return window.FeedLayout?.useMobileGrid?.(containerId) ?? false;
  }

  function useFeedPagedRender(containerId) {
    return containerId === 'communityGrid' || containerId === 'creationsGrid';
  }

  function useCommunityCssGrid(containerId) {
    return window.FeedLayout?.useFlexColumns?.(containerId) ?? false;
  }

  function getFeedLayoutMode(containerId) {
    return window.FeedLayout?.getMode?.(containerId) ?? 'masonry';
  }

  let layoutCommunityMasonry;
  let layoutFeedFlexColumns;
  let _scheduleCommunityLayout;
  function scheduleCommunityLayout(id, o) {
    return _scheduleCommunityLayout?.(id, o);
  }
  let relayoutCommunityFeeds;
  let runCommunityFeedLayoutPass;
  let bindCommunityGridImageRelayout;
  let bindCommunityFeedResizeRelayout;

  function enforceMobileCommunityFeedGrid(containerId) {
    if (!isMobileViewport()) return;
    window.FeedLayout?.layout?.(containerId);
  }


  /* —— Feed 图片：feed-images.js —— */
  let feedAssetIdFromImg;
  let feedImgStorageAttr;
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
  let scrubImageGenFeedCards;

  function wireFeedImages() {
    if (window.__feedImagesWired) return;
    if (!window.FeedImages?.init) {
      console.error('[FeatureDraft] pack-feed.js not loaded — FeedImages missing');
      return;
    }
    const FI = window.FeedImages.init({
      esc,
      isDisplayableImage,
      getCommunityFeedPageLoading: () => communityFeedPageLoading,
      isMobileFeedViewport: isMobileViewport,
      resetMobileFeedGridStyles: () => resetMobileFeedGridStyles(),
      layoutImageGenFeedMasonry: () => layoutImageGenFeedMasonry(),
      scrubCommunityFeedCardMediaHeights
    });
    feedAssetIdFromImg = FI.feedAssetIdFromImg;
    feedImgStorageAttr = FI.feedImgStorageAttr;
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
    scrubImageGenFeedCards = FI.scrubImageGenFeedCards;
    window.__feedImagesWired = true;
  }

  /* —— 生图仓库 Feed：image-gen-feed.js —— */
  let layoutImageGenFeedMasonry;
  let _scheduleImageGenFeedLayout;
  function scheduleImageGenFeedLayout(opts) {
    return _scheduleImageGenFeedLayout?.(opts);
  }
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
  let bindImageGenFeedResizeRelayout;
  let _renderImageGenFeed;
  let imageGenFeedRenderCoalesceTimer = null;
  /** @type {Record<string, any>|null} */
  let imageGenFeedRenderCoalesceOpts = null;

  function renderImageGenFeedImmediate(opts) {
    return _renderImageGenFeed?.(opts);
  }

  function renderImageGenFeed(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const mobileIg = !!document.getElementById('pageImageGen')?.classList.contains('active')
      && window.MobileUI?.isMobileViewport?.();
    const coalesce = !!o.preserveScroll && !o.scrollToTop && !o.feedAppend && !o.force && !mobileIg;
    if (!coalesce) {
      clearTimeout(imageGenFeedRenderCoalesceTimer);
      imageGenFeedRenderCoalesceTimer = null;
      imageGenFeedRenderCoalesceOpts = null;
      return renderImageGenFeedImmediate(o);
    }
    imageGenFeedRenderCoalesceOpts = { ...imageGenFeedRenderCoalesceOpts, ...o, preserveScroll: true };
    clearTimeout(imageGenFeedRenderCoalesceTimer);
    imageGenFeedRenderCoalesceTimer = setTimeout(() => {
      imageGenFeedRenderCoalesceTimer = null;
      const merged = imageGenFeedRenderCoalesceOpts;
      imageGenFeedRenderCoalesceOpts = null;
      void renderImageGenFeedImmediate(merged);
    }, 100);
  }
  let imageGenFeedIsNearTop;
  let bindImageGenFeedCardEvents;
  let captureImageGenFeedCardPositions;

  function safeRenderImageGenFeed(opts) {
    if (typeof renderImageGenFeed !== 'function') return;
    try {
      void renderImageGenFeed(opts);
    } catch (e) {
      console.warn('[imagegen] renderImageGenFeed failed', e);
    }
  }

  function wireImageGenFeed() {
    if (window.__imageGenFeedWired) return;
    if (!window.ImageGenFeed?.init) {
      console.error('[FeatureDraft] pack-feed.js not loaded — ImageGenFeed missing');
      return;
    }
    const IG = window.ImageGenFeed.init({
      esc,
      isDisplayableImage,
      isMobileFeedViewport: isMobileViewport,
      getFeedScrollRoot,
      getMasonryGap,
      getImageGenFeedColumns,
      setFeedLayoutPending,
      IMG_LOADING_PLACEHOLDER,
      hydrateFeedImageOne: (...a) => hydrateFeedImageOne(...a),
      getImageGenFeedTab: () => imageGenFeedTab,
      getImageGenWhGroup: () => imageGenWhGroup,
      getImageGenWhTag: () => imageGenWhTag,
      getImageGenPendingJobs: () => getImageGenPendingJobsForFeed(),
      getImageGenFailedJobs: () => imageGenFailedJobs,
      prunePendingJobsWithCreations,
      getRecentCreationsForFeed,
      pickCreationFeedImage,
      creationFeedImageCandidates,
      saveCreationToWarehouse,
      deleteCreation,
      confirmDeleteCreation,
      isCreationLinkedToWarehouse,
      formatExpiryLabel,
      scrubImageGenFeedCards: (wrap) => scrubImageGenFeedCards?.(wrap),
      getCommunityScope: () => communityScope,
      getCommunitySort: () => communitySort,
      getCommunityRandomEpoch: () => communityRandomEpoch,
      getLikedIds: () => likedIds,
      getCommunityFeedForDisplay,
      filterAndSortPosts,
      isGenericPostTitle,
      isGenericFeedTitle,
      imageGenModelLabel,
      isSlowGenProviderModel,
      formatTime,
      failedJobModelLabel,
      friendlyGenErrorMessage,
      batchIndexLabel,
      updateImageGenFeedHint,
      syncImageGenWarehouseFiltersUI,
      syncImageGenCommunityFiltersUI,
      renderImageGenMobileResult,
      openImageGenLightboxAt,
    resolveImageGenFullUrl,
      openImageGenPreview,
      downloadImageGenFeedItem,
      fillFeedPromptToActiveMode,
      fillFeedRefToActiveMode,
      fillFeedAllToActiveMode,
      regenerateFeedItem,
      copyFeedPromptText,
      getActiveImageGenMode,
      findPost,
      favoritePost,
      likeCommunityPostOnly,
      removeFailedGenJob,
      removePendingJob,
      clearSessionGenJob,
      getActivePollJobIds,
      IMAGEGEN_FEED_PENDING_CAP,
      IMAGEGEN_FEED_FAILED_CAP,
      addImageGenRefFromFeed: (...a) => ru('addImageGenRefFromFeed', ...a)
    });
    layoutImageGenFeedMasonry = IG.layoutImageGenFeedMasonry;
    _scheduleImageGenFeedLayout = IG.scheduleImageGenFeedLayout;
    window.repairImageGenFeedLayout = () => IG.repairImageGenFeedLayoutImmediate?.();
    window.diagnoseImageGenFeedLayout = () => IG.diagnoseImageGenFeedLayout?.();
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
    bindImageGenFeedResizeRelayout = IG.bindImageGenFeedResizeRelayout;
    _renderImageGenFeed = IG.renderImageGenFeed;
    imageGenFeedIsNearTop = IG.imageGenFeedIsNearTop;
    bindImageGenFeedCardEvents = IG.bindImageGenFeedCardEvents;
    captureImageGenFeedCardPositions = IG.captureImageGenFeedCardPositions;
    window.__imageGenFeedWired = true;
  }

  function resetMobileFeedGridStyles() {
    enforceMobileImageGenFeed?.();
  }

  function wireFeedLayout() {
    if (window.__feedLayoutWired) return;
    if (!window.FeedLayout?.init) {
      console.error('[FeatureDraft] pack-feed.js not loaded — FeedLayout missing');
      return;
    }
    const FL = window.FeedLayout.init({
      getCommunityColumns,
      getCreationsFeedColumns,
      getCardColumns,
      getMasonryGap,
      getCommunityFeedGaps,
      getFeedScrollRoot,
      safeApplyFeedScrollTop,
      feedScrollIntentActive: (containerId) => !!feedScrollIntent[containerId],
      setFeedLayoutPending,
      ensureFeedPageSentinel,
      revealCommunityFeedImages,
      scrubStaleCommunityFeedEmpty,
      scrubCommunityFeedCardMediaHeights
    });
    layoutCommunityMasonry = (id, o) => FL.layout(id, o);
    layoutFeedFlexColumns = (id, o) => FL.layoutFlex(id, o);
    _scheduleCommunityLayout = (id, o) => FL.schedule(id, o);
    relayoutCommunityFeeds = () => FL.relayoutAll();
    runCommunityFeedLayoutPass = (id) => { FL.layout(id); return true; };
    bindCommunityGridImageRelayout = () => {
      FL.bindImageRelayout('communityGrid');
      FL.bindImageRelayout('creationsGrid');
    };
    bindCommunityFeedResizeRelayout = (id) => FL.bindResizeRelayout(id);
    window.__feedLayoutWired = true;
  }

  function renderLikeRewardRules() {
    const el = document.getElementById('publishedRewardRules');
    if (!el) return;
    const rules = window.PointsSystem?.LIKE_MILESTONE_REWARDS || [];
    if (!rules.length) {
      el.innerHTML = '';
      return;
    }
    const items = rules
      .slice()
      .sort((a, b) => b.threshold - a.threshold)
      .map(r => `<li>作品累计 <strong>${r.threshold}</strong> 赞 → 奖励 <strong>${r.credits}</strong> 积分（每人最多 ${r.maxClaimsPerUser} 次）</li>`)
      .join('');
    el.innerHTML = `<h4>点赞奖励规则</h4><ul>${items}</ul><p class="panel-hint">仅对你发布到社区的作品生效，达标后自动发放积分。</p>`;
  }

  function purgeBrokenPublishedPosts() {
    const cardList = window.__promptHubCards || [];
    let changed = false;
    communityPosts = communityPosts.filter((p) => {
      if (!p?.sourceCardId) return true;
      const card = cardList.find((c) => c.id === p.sourceCardId);
      if (!card) return false;
      const ok = isDisplayableImage(card.image || p.image) || isCommunityPromptEligible(card.prompt || p.prompt);
      if (!ok) changed = true;
      return ok;
    });
    if (changed) persistCommunity();
    return changed;
  }

  function isMyCommunityPost(p, user, cardIds) {
    if (!p || p.isMock) return false;
    if (p.sourceCardId && cardIds.has(p.sourceCardId)) return true;
    return isCurrentUserPost(p);
  }

  function getMyPublishedPosts() {
    const user = getActiveUser();
    if (user.id === 'guest') return [];
    purgeBrokenPublishedPosts();
    migrateCommunityAuthorIds();
    const cardIds = new Set((window.__promptHubCards || []).map((c) => c.id));
    const seen = new Set();
    return getAllCommunityPosts()
      .filter(p => isMyCommunityPost(p, user, cardIds) && p.sourceCardId)
      .filter(ownPostAllowedInFeed)
      .filter((p) => isDisplayableImage(p.image) || isCommunityPromptEligible(p.prompt))
      .filter((p) => {
        const key = communityPostDedupeKey(p, user.id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(comparePostsByCreatedDesc);
  }

  function isFollowing(authorId) {
    return follows.has(String(authorId));
  }

  function toggleFollow(authorId, authorName) {
    if (!window.AuthGate?.requireAuth?.('community')) return false;
    const user = getActiveUser();
    const id = String(authorId);
    if (!id || id === user.id || id === 'guest') return false;
    if (follows.has(id)) {
      follows.delete(id);
      adjustFollowerList(id, user.id, false);
      toast(`已取消关注 ${authorName || '用户'}`);
      persistFollows();
      syncFollowUI(authorId);
      syncMyHomeProfileStats();
      return false;
    }
    follows.add(id);
    adjustFollowerList(id, user.id, true);
    pushCommunityEvent({
      type: 'follow',
      targetUserId: id,
      actorId: user.id,
      actorName: user.name,
      message: `${user.name} 关注了你`
    });
    toast(`已关注 ${authorName || '用户'}`);
    persistFollows();
    syncFollowUI(authorId);
    syncMyHomeProfileStats();
    return true;
  }

  function followersStorageKey(userId) {
    return `promptrepo_followers_${String(userId || '')}`;
  }

  function loadFollowersSet(userId) {
    try {
      const raw = localStorage.getItem(followersStorageKey(userId));
      const list = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(list) ? list.map(String) : []);
    } catch (e) {
      return new Set();
    }
  }

  function persistFollowersSet(userId, set) {
    try {
      localStorage.setItem(followersStorageKey(userId), JSON.stringify([...set]));
    } catch (e) { /* ignore */ }
  }

  function adjustFollowerList(targetUserId, followerId, add) {
    const set = loadFollowersSet(targetUserId);
    const fid = String(followerId);
    if (add) set.add(fid);
    else set.delete(fid);
    persistFollowersSet(targetUserId, set);
  }

  function countFollowers(userId) {
    return loadFollowersSet(userId).size;
  }

  function syncMyHomeProfileStats() {
    const user = getActiveUser();
    if (user.id === 'guest') return;
    const root = document.getElementById('myHomeProfile');
    if (!root) return;
    const postsEl = root.querySelector('[data-stat="posts"]');
    const followingEl = root.querySelector('[data-stat="following"]');
    const followersEl = root.querySelector('[data-stat="followers"]');
    if (postsEl) postsEl.textContent = String(getMyPublishedPosts().length);
    if (followingEl) followingEl.textContent = String(follows.size);
    if (followersEl) followersEl.textContent = String(countFollowers(user.id));
  }

  function renderMyHomeProfile() {
    const el = document.getElementById('myHomeProfile');
    if (!el) return;
    const user = getActiveUser();
    if (user.id === 'guest') {
      el.innerHTML = `<div class="creations-profile my-home-profile-card">
        <div class="creations-avatar">?</div>
        <div class="creations-profile-text">
          <h3>访客</h3>
          <p>登录后查看你的主页、关注与资产包</p>
        </div>
        <button type="button" class="btn btn-primary btn-sm" onclick="openAuthModal()">登录</button>
      </div>`;
      return;
    }
    const displayName = user.displayName || user.name || '用户';
    const avatar = (displayName[0] || '?').toUpperCase();
    const posts = getMyPublishedPosts().length;
    const following = follows.size;
    const followers = countFollowers(user.id);
    el.innerHTML = `<div class="creations-profile my-home-profile-card">
      <div class="creations-avatar" aria-hidden="true">${esc(avatar)}</div>
      <div class="creations-profile-text my-home-profile-text">
        <div class="my-home-name-row">
          <h3 id="myHomeDisplayName">${esc(displayName)}</h3>
          <button type="button" class="btn btn-ghost btn-sm" id="myHomeEditNameBtn">修改用户名</button>
        </div>
        <p class="my-home-name-hint">社区显示名 · 2～20 字，与社区发帖作者名一致</p>
        <p class="my-home-email-line">${esc(user.email || '已登录用户')}</p>
        <form class="my-home-name-form hidden" id="myHomeNameForm">
          <input type="text" class="settings-input my-home-name-input" id="myHomeNameInput" maxlength="20" value="${esc(displayName)}" autocomplete="nickname">
          <button type="submit" class="btn btn-primary btn-sm">保存</button>
          <button type="button" class="btn btn-ghost btn-sm" id="myHomeNameCancel">取消</button>
        </form>
      </div>
      <div class="my-home-stats" aria-label="主页统计">
        <span><strong data-stat="posts">${posts}</strong> 作品</span>
        <span><strong data-stat="following">${following}</strong> 关注</span>
        <span><strong data-stat="followers">${followers}</strong> 粉丝</span>
      </div>
    </div>`;

    el.querySelector('#myHomeEditNameBtn')?.addEventListener('click', () => {
      el.querySelector('#myHomeNameForm')?.classList.remove('hidden');
      el.querySelector('#myHomeEditNameBtn')?.classList.add('hidden');
      el.querySelector('#myHomeDisplayName')?.classList.add('hidden');
      el.querySelector('.my-home-name-hint')?.classList.add('hidden');
      const input = el.querySelector('#myHomeNameInput');
      if (input) {
        input.focus();
        input.select();
      }
    });
    el.querySelector('#myHomeNameCancel')?.addEventListener('click', () => {
      el.querySelector('#myHomeNameForm')?.classList.add('hidden');
      el.querySelector('#myHomeEditNameBtn')?.classList.remove('hidden');
      el.querySelector('#myHomeDisplayName')?.classList.remove('hidden');
      el.querySelector('.my-home-name-hint')?.classList.remove('hidden');
    });
    el.querySelector('#myHomeNameForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void saveMyHomeDisplayName();
    });
  }

  async function saveMyHomeDisplayName() {
    const input = document.getElementById('myHomeNameInput');
    const name = String(input?.value || '').trim();
    if (name.length < 2) {
      toast('用户名至少 2 个字');
      return;
    }
    if (!window.PromptHubApi?.setDisplayName) {
      toast('请先连接 API 后再修改用户名');
      return;
    }
    const btn = document.querySelector('#myHomeNameForm button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const r = await window.PromptHubApi.setDisplayName(name);
      if (!r?.ok) {
        const hint =
          r?.code === 'NETWORK_ERROR' || r?.code === 'API_UNREACHABLE'
            ? '无法连接 api.prompt-hub.cn，请检查网络/VPN 后重试，或稍后再试'
            : r?.message || '保存失败';
        toast(hint, 6000);
        return;
      }
      toast('用户名已更新，社区作品将显示新名称');
      renderMyHomeProfile();
      renderCommunity();
      void renderCreations();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function recordCreationDeletion(id, jobId) {
    if (id == null) return;
    try {
      const key = 'promptrepo_deleted_creations';
      const raw = localStorage.getItem(key);
      const map = raw ? JSON.parse(raw) : {};
      map[String(id)] = Date.now();
      localStorage.setItem(key, JSON.stringify(map));
    } catch (e) { /* ignore */ }
    if (typeof window.recordCreationDeletionGlobal === 'function') {
      window.recordCreationDeletionGlobal(id, jobId);
    }
  }

  function highlightCreationCard(id) {
    document.querySelectorAll('#creationsGrid .creation-post-card').forEach(el => {
      el.classList.toggle('selected', el.dataset.creationId === id);
    });
  }

  function openCreationsSidePanel(id) {
    const c = creations.find(x => x.id === id);
    if (!c) return;
    creationsSideId = id;
    ensureFeatureSidePanelDocked('creationsSidePanel');
    mountFeatureSidePanel('creationsSidePanel');
    document.getElementById('creationsSidePanel')?.classList.remove('hidden');
    syncCommunityPanelOpenClass();
    if (isMobileViewport()) window.MobileUI?.closeDrawers?.();
    void renderCreationsSidePanel(id);
  }

  async function renderCreationsSidePanel(id) {
    const body = document.getElementById('creationsSideBody');
    const c = creations.find(x => x.id === id);
    if (!body || !c) return;
    const badge = c.visibility === 'published' ? '已发布' : '私密';
    const storageAttr = feedImgStorageAttr(c.image);
    const jobAttr = c.jobId ? ` data-job-id="${esc(c.jobId)}"` : '';
    const showImg = c.image && isDisplayableImage(c.image);
    const imgHtml = showImg
      ? `<button type="button" class="community-side-img-btn" data-side-zoom title="点击放大"><img class="community-side-img" src="${IMG_LOADING_PLACEHOLDER}" data-image-ref="${esc(c.image)}"${storageAttr}${jobAttr} alt=""></button>`
      : '';
    body.innerHTML = `
      ${imgHtml}
      <p class="community-side-author">${esc(badge)} · ${esc((c.resolution || '1k').toUpperCase())} · ${esc(formatExpiryLabel(c))}</p>
      <div class="community-side-prompt">${esc(c.prompt || '')}</div>
      <div class="community-side-actions">
        <button type="button" class="btn btn-secondary" data-action="remix">再生成</button>
        <button type="button" class="btn btn-secondary" data-action="del">删除记录</button>
      </div>
      <p class="panel-hint">最近生成保留 7 天，条数上限随会员等级（轻量 150 / 基础 200 / 标准 300 / 专业 400）。超出或到期未存入库将彻底删除；喜欢请点「存入库」。</p>`;
    bindCommunitySideImageZoom(body, null, c.image, id, { jobId: c.jobId || null });
    body.querySelector('[data-action="remix"]')?.addEventListener('click', () => remixCreation(id));
    body.querySelector('[data-action="del"]')?.addEventListener('click', () => {
      const doDel = () => {
        deleteCreation(id);
        closeCreationsSidePanel();
      };
      if (typeof window.customConfirm === 'function') {
        window.customConfirm('确定删除该创作？无回收站，删除后不可恢复。', doDel);
      } else if (confirm('确定删除该创作？')) doDel();
    });
    highlightCreationCard(id);
    if (showImg) await hydrateFeedImages(body);
  }

  function closeCreationsSidePanel() {
    document.getElementById('creationsSidePanel')?.classList.add('hidden');
    unmountFeatureSidePanel('creationsSidePanel');
    ensureFeatureSidePanelDocked('creationsSidePanel');
    syncCommunityPanelOpenClass();
    creationsSideId = null;
    communitySidePostId = null;
    openPostId = null;
    document.querySelectorAll('#creationsGrid .community-post-card.selected').forEach(el => el.classList.remove('selected'));
    if (!isMobileViewport()) {
      requestAnimationFrame(() => {
        scheduleCommunityLayout('creationsGrid', { force: true, immediate: true });
      });
    }
  }

  async function renderCreations() {
    renderMyHomeProfile();
    const container = document.getElementById('creationsGrid');
    const hintEl = document.getElementById('creationsHint');
    if (!container) return;
    const user = getActiveUser();
    if (window.__promptHubCards?.length) {
      ensureCommunityFromCardsThrottled(false);
    } else {
      dedupeCommunityPosts();
      migrateCommunityAuthorIds();
    }
    if (hintEl) {
      hintEl.textContent = user.id === 'guest'
        ? '登录后在此查看你发布到社区的作品'
        : '你在卡片库公开到社区的作品 · 按最新发布排序 · 点击卡片查看详情';
    }
    if (user.id === 'guest') {
      window.FeedLayout?.destroyLayout?.('creationsGrid');
      closeCreationsSidePanel();
      container.innerHTML = '<div class="feature-empty"><p>请先登录后查看发布作品</p><button type="button" class="btn btn-primary" onclick="openAuthModal()">登录</button></div>';
      return;
    }
    const list = getMyPublishedPosts();
    const sig = feedListSignature(list, 'creationsGrid');
    if (container.dataset.feedSig === sig && container.querySelector('.community-post-card')) {
      patchFeedLikeLabels(container, list);
      if (isCreationsFeedLayoutStale(container)) {
        delete container.dataset.feedSig;
        delete container.dataset.feedDistributed;
        delete container.dataset.feedDistributedCols;
        repairCreationsFeedLayout(true);
      } else {
        requestAnimationFrame(() => syncCommunityFeedColumnCount('creationsGrid'));
      }
      return;
    }
    renderLikeRewardRules();
    window.FeedLayout?.destroyLayout?.('creationsGrid');
    if (!list.length) {
      closeCreationsSidePanel();
      container.innerHTML = '<div class="feature-empty"><p>暂无发布作品</p><p class="panel-hint">在卡片库保存作品并开启「发布到提示词社区」，或在生图页开启「生成后公开」</p><button type="button" class="btn btn-primary" onclick="switchAppPage(\'warehouse\')">去卡片库</button></div>';
      return;
    }
    void renderPostsIntoContainer(list, 'creationsGrid').then(() => {
      if (useFeedPagedRender('creationsGrid')) {
        void drainCommunityFeedPages('creationsGrid', isMobileViewport() ? 8 : 6);
      }
      requestAnimationFrame(() => {
        layoutFeedFlexColumns('creationsGrid', { force: true, forceReflow: true, recalcCols: true });
        syncCommunityFeedColumnCount('creationsGrid');
      });
    });
  }

  function publishCreation(id, opts) {
    toast('发布到社区请先在卡片库保存该作品，并开启「发布到提示词社区」');
  }

  function confirmDeleteCreation(id) {
    const c = creations.find((x) => x.id === id);
    const linked = isCreationLinkedToWarehouse(c);
    const msg = linked
      ? '确定从最近生成中移除？卡片库里的对应卡片不会被删除。'
      : '确定删除该条最近生成？未存入库的图片将彻底删除，不可恢复。';
    const doDel = () => { void deleteCreation(id); };
    if (typeof window.customConfirm === 'function') {
      window.customConfirm(msg, doDel, null, { danger: true, confirmLabel: linked ? '移除' : '删除' });
      return;
    }
    if (typeof confirm === 'function' && confirm(msg)) doDel();
  }

  async function deleteCreation(id) {
    if (creationsSideId === id) closeCreationsSidePanel();
    if (imageGenPreviewId === id) closeImageGenPreview();
    const removed = creations.find(c => c.id === id);
    if (!removed) return;
    if (removed?.communityPostId) {
      const post = findPost(removed.communityPostId);
      if (post?.sourceCreationId === id && !post?.sourceCardId) {
        performCommunityPostRemoval(removed.communityPostId, { silent: true });
      }
    }
    recordCreationDeletion(id, removed?.jobId);
    const linked = isCreationLinkedToWarehouse(removed);
    if (!linked && !removed?.savedToWarehouse) {
      await purgeCreationMedia(removed);
    }
    creations = creations.filter(c => c.id !== id);
    persistCreations();
    renderCreations();
    if (document.getElementById('pageImageGen')?.classList.contains('active')) {
      renderImageGenFeed({ preserveScroll: true, force: true });
    }
    toast(linked ? '已从最近生成移除（卡片库不受影响）' : '已删除');
  }

  function remixCreation(id) {
    const c = creations.find(x => x.id === id);
    if (!c) return;
    if (typeof switchAppPage === 'function') switchAppPage('imagegen');
    imageGenFeedTab = 'recent';
    document.querySelectorAll('[data-feed-tab]').forEach(b => {
      b.classList.toggle('active', b.dataset.feedTab === 'recent');
    });
    updateImageGenFeedHint();
    applyHistoryToForm(c);
  }

  function onDisplayNameChanged() {
    reconcileOwnedPostAuthors();
    migrateCommunityAuthorIds();
  }

  function initMyHomeTabs() {
    const tabs = document.getElementById('myHomeTabs');
    if (!tabs || tabs.dataset.bound) return;
    tabs.dataset.bound = '1';
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-home-tab]');
      if (!btn) return;
      const tab = btn.dataset.homeTab;
      tabs.querySelectorAll('.my-home-tab').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      document.querySelectorAll('[data-home-pane]').forEach((pane) => {
        const on = pane.dataset.homePane === tab;
        pane.classList.toggle('hidden', !on);
        pane.classList.toggle('active', on);
      });
      if (tab === 'owned-packages') {
        window.FeatureAssets?.renderMyHomePackages?.(document.getElementById('myHomeOwnedPackages'), 'owned');
      } else if (tab === 'published-packages') {
        window.FeatureAssets?.renderMyHomePackages?.(document.getElementById('myHomePublishedPackages'), 'published');
      } else {
        void renderCreations();
      }
    });
  }

  function persistFollows() {
    try {
      localStorage.setItem('promptrepo_follows', JSON.stringify([...follows]));
    } catch (e) { /* ignore */ }
    if (window.SupabaseSync?.isLoggedIn?.()) queueCloudPush();
  }

  function loadFollows() {
    try {
      const raw = localStorage.getItem('promptrepo_follows');
      if (raw) follows = new Set(JSON.parse(raw).map(String));
    } catch (e) { follows = new Set(); }
  }

  function pushCommunityEvent(ev) {
    const user = getActiveUser();
    if (user.id === 'guest' || !ev?.targetUserId || String(ev.targetUserId) === String(user.id)) return;
    const payload = {
      id: genId('ce'),
      type: ev.type,
      targetUserId: String(ev.targetUserId),
      actorId: String(ev.actorId || user.id),
      actorName: ev.actorName || user.name,
      postId: ev.postId || null,
      postTitle: ev.postTitle || '',
      likes: ev.likes || 0,
      message: ev.message || '',
      createdAt: Date.now()
    };
    communityEvents.push(payload);
    if (communityEvents.length > 200) communityEvents = communityEvents.slice(-200);
    if (window.SupabaseSync?.isLoggedIn?.()) queueCloudPush();
    if (window.PromptHubApi?.pushCommunityNotify) {
      void window.PromptHubApi.pushCommunityNotify({
        targetUserId: payload.targetUserId,
        type: payload.type,
        postId: payload.postId,
        postTitle: payload.postTitle,
        message: payload.message,
        actorName: payload.actorName
      });
    }
  }

  function ingestCommunityEvents(events) {
    if (!window.getCommunityNotificationsEnabled?.()) return;
    const user = getActiveUser();
    if (user.id === 'guest' || !Array.isArray(events)) return;
    let added = false;
    for (const ev of events) {
      if (!ev || String(ev.targetUserId) !== String(user.id)) continue;
      if (notifications.some(n => n.id === ev.id)) continue;
      const evKey = `${ev.type || ''}|${ev.postId || ''}|${ev.actorId || ''}`;
      if (evKey && notifications.some((n) => notifyDedupeKey(n) === evKey)) continue;
      notifications.unshift({
        id: ev.id,
        type: ev.type,
        actorId: ev.actorId,
        actorName: ev.actorName || '用户',
        postId: ev.postId || null,
        postTitle: ev.postTitle || '',
        likes: ev.likes || 0,
        message: ev.message || formatNotifyMessage(ev),
        read: false,
        createdAt: ev.createdAt || Date.now()
      });
      added = true;
    }
    if (added) {
      notifications = notifications.slice(0, 100);
      persistNotifications();
      updateNotifyBadge();
    }
  }

  function notifyDedupeKey(n) {
    if (!n) return '';
    return `${n.type || ''}|${n.postId || ''}|${n.actorId || ''}`;
  }

  function markNotificationsReadById(id) {
    const hit = notifications.find((x) => x.id === id);
    if (!hit) return;
    const key = notifyDedupeKey(hit);
    notifications.forEach((n) => {

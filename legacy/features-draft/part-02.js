      incoming = shuffleCommunityPosts(incoming);
    }
    store.posts.push(...incoming);
    return incoming.length;
  }

  async function ensureFeedStoreHasMore(containerId) {
    const store = feedPagedStore[containerId];
    if (!store) return false;
    if (containerId === 'communityGrid') {
      syncFeedPagedStoreFromDisplay(containerId);
    }
    if (getPendingFeedPosts(store, containerId, 1).length) return true;
    if (countFeedDomUnique(containerId) < store.posts.length) return true;
    if (store.page * feedPageSize(containerId) < store.posts.length) return true;
    if (store.remoteExhausted && !publicFeedState.remoteHasMore) {
      logFeedPageDebug(containerId, 'remote_exhausted_local_end');
      return false;
    }
    let attempts = 0;
    while (attempts < 12) {
      attempts += 1;
      if (!publicFeedState.remoteHasMore) {
        store.remoteExhausted = true;
        logFeedPageDebug(containerId, 'no_more_api', { attempts });
        return false;
      }
      const batch = await fetchMorePublicCommunityFeed();
      if (batch === null) {
        logFeedPageDebug(containerId, 'api_null_keep_local', { attempts });
        return store.page * feedPageSize(containerId) < store.posts.length;
      }
      if (!batch.length) {
        store.remoteExhausted = true;
        publicFeedState.remoteHasMore = false;
        logFeedPageDebug(containerId, 'api_empty_done', { attempts });
        return false;
      }
      const added = appendRenderableToFeedStore(containerId, batch);
      if (added > 0) {
        store.remoteExhausted = !publicFeedState.remoteHasMore;
        return true;
      }
      if (!publicFeedState.remoteHasMore) {
        store.remoteExhausted = true;
        logFeedPageDebug(containerId, 'api_dupes_done', { attempts });
        return false;
      }
      // 满页但均已存在 store：offset 已推进，继续尝试下一批
    }
    return store.page * feedPageSize(containerId) < store.posts.length;
  }

  async function syncMyPostsToPublicFeed() {
    if (!window.SupabaseSync?.isLoggedIn?.() || !window.PromptHubApi?.syncCommunityPostsBatch) return 0;
    if (window.PromptHubApi?.isApiUnreachable?.() || window.PromptHubApi?.isApiRateLimited?.()) return 0;
    if (Date.now() - lastCommunityPostsSyncAt < COMMUNITY_POSTS_SYNC_GAP_MS) return 0;
    if (communityPostsSyncInflight) return communityPostsSyncInflight;
    communityPostsSyncInflight = (async () => {
      const mine = collectMyCommunityPostsForSync();
      for (const p of mine) {
        if (!p.image || !p.sourceCardId || !window.SupabaseSync?.isStorageRef?.(p.image)) continue;
        try {
          const ok = await window.SupabaseSync.verifyStorageRef(p.image, p.sourceCardId, {
            quick: true,
            noDownload: true
          });
          if (!ok) p._syncSkip = true;
        } catch (e) { /* ignore */ }
      }
      if (mine.length) {
        communityPosts = mergePostsLists(communityPosts, mine);
        persistCommunity();
      }
      try {
        const payload = mine
          .filter((p) => !p._syncSkip)
          .map(postForPublicApi)
          .filter((p) => p?.id && String(p.prompt || '').trim().length >= 1 && isDisplayableImage(p.image));
        let synced = 0;
        let lastFail = null;
        for (let i = 0; i < payload.length; i += COMMUNITY_SYNC_BATCH_MAX) {
          const chunk = payload.slice(i, i + COMMUNITY_SYNC_BATCH_MAX);
          const r = await window.PromptHubApi.syncCommunityPostsBatch(chunk);
          if (r?.ok) {
            synced += chunk.length;
            continue;
          }
          lastFail = r;
          const transient =
            r?.status === 429
            || r?.code === 'RATE_LIMITED'
            || r?.status === 503
            || r?.status === 524
            || r?.code === 'NETWORK_ERROR'
            || r?.status === 0;
          if (transient) {
            const backoffMs = r?.status === 429 ? 300000 : 180000;
            lastCommunityPostsSyncAt = Date.now() - COMMUNITY_POSTS_SYNC_GAP_MS + backoffMs;
            if (!communitySyncTransientWarned) {
              communitySyncTransientWarned = true;
              console.warn('[community] 同步暂跳过（API 繁忙/超时），约', Math.round(backoffMs / 60000), '分钟后重试');
            }
            break;
          }
          console.warn('[community] sync public posts failed', r, { batch: i / COMMUNITY_SYNC_BATCH_MAX + 1, size: chunk.length });
          break;
        }
        if (synced > 0) {
          lastCommunityPostsSyncAt = Date.now();
          return synced;
        }
        if (lastFail) console.warn('[community] sync public posts failed', lastFail);
      } catch (e) {
        console.warn('[community] sync public posts failed', e);
      }
      return 0;
    })();
    try {
      return await communityPostsSyncInflight;
    } finally {
      communityPostsSyncInflight = null;
    }
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function toast(msg, durationMs) {
    if (typeof showToast === 'function') {
      showToast(msg, durationMs);
      return;
    }
    console.warn('[toast]', msg);
  }
  window.toast = toast;

  let lastCommunityHydrateAt = 0;
  let communityHydrateTimer = null;
  /** 避免空社区页反复触发 requestCloudHydrate 导致左下角「正在加载社区数据」闪烁 */
  function scheduleCommunityHydrateOnce() {
    if (!window.SupabaseSync?.isLoggedIn?.()) return;
    if (communityScope === 'following') return;
    if (!(window.__promptHubCards || []).length) return;
    if (Date.now() - lastCommunityHydrateAt < 45000) return;
    clearTimeout(communityHydrateTimer);
    communityHydrateTimer = setTimeout(() => {
      lastCommunityHydrateAt = Date.now();
      void window.requestCloudHydrate?.();
    }, 1200);
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function saveJson(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      const quota = e && (e.name === 'QuotaExceededError' || /quota|exceeded/i.test(String(e.message || '')));
      if (quota && val && typeof val === 'object') {
        try {
          const slim = { ...val };
          delete slim.refImages;
          delete slim.refImage;
          if (typeof slim.prompt === 'string' && slim.prompt.length > 4000) {
            slim.prompt = slim.prompt.slice(0, 4000);
          }
          localStorage.setItem(key, JSON.stringify(slim));
          return true;
        } catch (e2) {
          /* fall through */
        }
      }
      console.warn('[storage] saveJson failed', key, e);
      return false;
    }
  }

  /** 生图草稿：不把 data URL 大参考图写入 localStorage，避免 QuotaExceeded 阻断提交 */
  function compactRefsForDraft(refs) {
    return (refs || [])
      .filter((u) => typeof u === 'string' && u && !/^data:/i.test(u))
      .map((u) => u.slice(0, 800))
      .slice(0, 4);
  }

  function saveImageGenDraft(meta) {
    const draft = {
      prompt: String(meta.prompt || '').slice(0, 8000),
      model: meta.model,
      modelFamily: imageGenModelFamily,
      refImages: compactRefsForDraft(meta.refImages),
      refImage: compactRefsForDraft([meta.refImage])[0] || null,
      resolution: meta.resolution,
      quality: meta.quality,
      size: meta.size,
      count: meta.count,
      countPreferenceVersion: IMAGE_GEN_COUNT_PREFERENCE_VERSION,
      cardTitle: meta.cardTitle,
      batchSplit: meta.batchSplit,
      mjMode: meta.mjMode,
      mjSaveAllTiles: meta.mjSaveAllTiles,
      mjSpeed: meta.mjSpeed,
      mjExtras: meta.mjExtras
    };
    if (!saveJson(LS_IMAGEGEN, draft)) {
      saveJson(LS_IMAGEGEN, {
        prompt: draft.prompt.slice(0, 2000),
        model: draft.model,
        resolution: draft.resolution,
        quality: draft.quality,
        size: draft.size,
        count: draft.count
      });
    }
  }

  function genId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function getActiveUser() {
    const uid = window.SupabaseSync?.getUserId?.();
    const email = document.getElementById('authUserEmail')?.textContent?.trim()
      || window.SupabaseSync?.getUserEmail?.() || '';
    const displayName = String(window.__userDisplayName || '').trim();
    if (uid) {
      const name = displayName || '用户';
      return { id: uid, name, email, displayName: name };
    }
    if (email) return { id: 'local_' + email, name: email.split('@')[0] || '用户', email };
    return { id: 'guest', name: '访客', email: '' };
  }

  /** 是否当前登录账号的帖（兼容 uuid / local_邮箱；sourceCardId 须同时能确认作者） */
  function isCurrentUserPost(p) {
    if (!p || p.isMock) return false;
    const uid = window.SupabaseSync?.getUserId?.();
    const user = getActiveUser();
    if (user.id === 'guest') return false;
    const aid = String(p.authorId || '');
    const imgOwner = authorIdFromPostImage(p);
    if (imgOwner && uid && imgOwner === String(uid)) return true;
    if (uid && aid === String(uid)) return true;
    if (aid === String(user.id)) return true;
    if (user.email && aid === `local_${user.email}`) return true;
    if (p.sourceCardId) {
      const cardIds = new Set((window.__promptHubCards || []).map((c) => c.id));
      if (!cardIds.has(p.sourceCardId)) return false;
      if (uid && aid && aid !== String(uid) && aid !== String(user.id)) return false;
      if (imgOwner && uid && imgOwner !== String(uid)) return false;
      return true;
    }
    return false;
  }

  function cardPublishedToCommunity(c) {
    if (!c?.id) return false;
    if (!c.publishedToCommunity) return false;
    return isCommunityPublishEligible(c);
  }

  /** 云端 user_data 拉回的历史帖：仅保留全站仍可见或卡片仍勾选发布的自己的帖 */
  function pruneOwnStaleCommunityPostsFromCloud() {
    const user = getActiveUser();
    if (user.id === 'guest') return false;
    const pubIds = new Set(publicFeedState.posts.map((p) => String(p.id)));
    const pubCards = new Set(
      publicFeedState.posts.map((p) => String(p.sourceCardId)).filter(Boolean)
    );
    const publishCardIds = new Set(
      (window.__promptHubCards || [])
        .filter((c) => c?.publishedToCommunity)
        .map((c) => String(c.id))
    );
    const before = communityPosts.length;
    communityPosts = communityPosts.filter((p) => {
      if (!p || p.isMock) return false;
      if (!isCurrentUserPost(p)) return true;
      if (pubIds.has(String(p.id))) return true;
      if (p.sourceCardId && pubCards.has(String(p.sourceCardId))) return true;
      if (p.sourceCardId && publishCardIds.has(String(p.sourceCardId))) return true;
      return false;
    });
    if (communityPosts.length === before) return false;
    persistCommunity();
    rebuildOwnPostFilterCache();
    invalidateCommunityReconcileCache();
    return true;
  }

  /** 全站 Feed 已下架的帖，从本地 communityPosts / 卡片关联里清掉 */
  function pruneLocalCommunityNotOnServer() {
    const user = getActiveUser();
    if (user.id === 'guest' || !publicFeedState.at) return false;
    const pubIds = new Set(publicFeedState.posts.map((p) => String(p.id)));
    const pubCards = new Set(
      publicFeedState.posts.map((p) => String(p.sourceCardId)).filter(Boolean)
    );
    let dirty = false;
    const before = communityPosts.length;
    communityPosts = communityPosts.filter((p) => {
      if (!p || p.isMock) return false;
      if (!isCurrentUserPost(p)) return true;
      if (pubIds.has(String(p.id))) return true;
      if (p.sourceCardId && pubCards.has(String(p.sourceCardId))) return true;
      const card = (window.__promptHubCards || []).find((c) => c.id === p.sourceCardId);
      return !!(card?.publishedToCommunity);
    });
    if (communityPosts.length !== before) dirty = true;
    for (const c of window.__promptHubCards || []) {
      if (c.publishedToCommunity) continue;
      const onServer =
        (c.communityPostId && pubIds.has(String(c.communityPostId)))
        || (c.id && pubCards.has(String(c.id)));
      if (!onServer && c.communityPostId) {
        c.communityPostId = null;
        dirty = true;
      }
    }
    if (dirty) {
      persistCommunity();
      if (typeof window.persistPromptHubCards === 'function') void window.persistPromptHubCards();
    }
    return dirty;
  }

  function getCardColumns() {
    return Math.min(5, Math.max(1, Number(getComputedStyle(document.documentElement).getPropertyValue('--card-columns')) || 3));
  }

  function getCommunityColumns() {
    return Math.min(5, Math.max(1, Number(getComputedStyle(document.documentElement).getPropertyValue('--community-columns')) || 4));
  }

  function getCreationsFeedColumns(_container) {
    let userCols = Number(localStorage.getItem('promptrepo_myhome_columns'));
    if (!Number.isFinite(userCols) || userCols < 2) userCols = 3;
    return Math.min(5, Math.max(2, userCols));
  }

  /** 生图作品流按可用宽度自适应列数，避免预览侧栏打开后右侧大块留白 */
  function getImageGenFeedColumns(innerW) {
    const gap = getMasonryGap();
    const previewOpen = document.querySelector('.imagegen-side')?.classList.contains('imagegen-preview-open');
    const minCol = previewOpen ? 148 : 156;
    const maxCols = previewOpen ? 5 : 6;
    const fit = Math.floor((innerW + gap) / (minCol + gap));
    return Math.min(maxCols, Math.max(2, fit));
  }

  function getMasonryGap() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--card-gap').trim()
      || getComputedStyle(document.documentElement).getPropertyValue('--card-row-gap').trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 16;
  }

  /** 社区/我的主页：列间距=gutter；上下间距=CSS margin-bottom（与 #cardsContainer 一致） */
  function getCommunityFeedGaps() {
    const gap = getMasonryGap();
    return { colGap: gap, rowGap: gap };
  }

  function purgeCommunityFeedGridNoise(container) {
    if (!container) return;
    container.querySelectorAll(
      ':scope > .feature-empty, :scope > .community-feed-skeleton, :scope > .community-curated-placeholder, :scope > .community-feed-empty'
    ).forEach((el) => el.remove());
  }

  function invalidateCommunityFeedRender() {
    communityFeedRenderGen += 1;
    delete feedPagedStore.communityGrid;
    const grid = document.getElementById('communityGrid');
    if (grid) {
      delete grid.dataset.feedSig;
      delete grid.dataset.feedDistributed;
      delete grid.dataset.masonryLoadBound;
    }
  }

  /** 社区/卡片库空态：销毁 Masonry 列布局并垂直水平居中 */
  function setFeedGridEmpty(container, html) {
    if (!container) return;
    const id = container.id;
    if (id === 'communityGrid' || id === 'creationsGrid' || id === 'userProfileGrid') {
      window.FeedLayout?.destroyLayout?.(id);
      window.FeedLayout?.resetGridClasses?.(container);
    }
    container.classList.add('feed-grid-centered');
    container.classList.remove(
      'cards-grid-primed',
      'masonry-ready',
      'feed-layout-pending',
      'feed-layout-ready',
      'community-feed-grid',
      'community-feed-columns'
    );
    container.innerHTML = html;
  }

  function scrubStaleCommunityFeedEmpty(container) {
    if (!container) return;
    if (container.querySelector('.community-post-card, .creation-post-card')) {
      purgeCommunityFeedGridNoise(container);
    }
  }

  function scheduleFeedMasonryRelayout(containerId = 'communityGrid') {
    window.FeedLayout?.scheduleMasonryRelayout?.(containerId);
  }

  function scheduleCommunityMasonryRelayout() {
    scheduleFeedMasonryRelayout('communityGrid');
  }

  function filterCreationsForCloud(list) {
    const tomb = window.getDeletedCreationTombstones?.() || {};
    return (list || []).filter((c) => c && c.id != null && !tomb[String(c.id)]);
  }

  const FEED_AUTHOR_UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isValidFeedAuthorId(authorId) {
    return FEED_AUTHOR_UUID_RE.test(String(authorId || '').trim());
  }

  function filterCommunityPostsForDisplay(list, opts = {}) {
    const postTomb = window.getDeletedCommunityPostTombstones?.() || {};
    const cardTomb = opts.skipCardTombstones ? {} : (window.getDeletedCardTombstones?.() || {});
    const creTomb = window.getDeletedCreationTombstones?.() || {};
    return (list || []).filter((p) => {
      if (!p || p.isMock) return false;
      if (!isValidFeedAuthorId(p.authorId)) return false;
      if (postTomb[String(p.id)]) return false;
      if (p.sourceCardId && cardTomb[String(p.sourceCardId)]) return false;
      if (p.sourceCreationId && creTomb[String(p.sourceCreationId)]) return false;
      return true;
    });
  }

  /** 清理已删卡片对应的社区帖、无来源孤儿帖，并同步云端 */
  function purgeGhostCommunityData() {
    const user = getActiveUser();
    if (user.id === 'guest') return { removedPosts: 0 };
    const list = window.__promptHubCards || [];
    migrateCommunityAuthorIds();
    reconcileCommunityWithCards(list, { force: true });
    const cardIds = new Set(list.map((c) => c.id));
    const cardTomb = window.getDeletedCardTombstones?.() || {};
    const before = communityPosts.length;
    communityPosts = communityPosts.filter((p) => {
      if (!p || p.isMock) return false;
      if (!isCurrentUserPost(p)) return true;
      if (p.sourceCardId && (cardTomb[String(p.sourceCardId)] || !cardIds.has(p.sourceCardId))) {
        if (typeof window.recordCommunityPostDeletion === 'function') {
          window.recordCommunityPostDeletion(p.id);
        }
        return false;
      }
      if (!p.sourceCardId) {
        const linked = list.some((c) => String(c.communityPostId) === String(p.id));
        if (!linked) {
          if (typeof window.recordCommunityPostDeletion === 'function') {
            window.recordCommunityPostDeletion(p.id);
          }
          return false;
        }
      }
      return true;
    });
    dedupeCommunityPosts({ persist: false });
    pruneOrphanFeatureData();
    const removedPosts = Math.max(0, before - communityPosts.length);
    if (removedPosts > 0) persistCommunity();
    invalidateCommunityReconcileCache();
    rebuildOwnPostFilterCache();
    return { removedPosts };
  }

  function pruneOrphanFeatureData() {
    const beforeP = communityPosts.length;
    communityPosts = filterCommunityPostsForDisplay(communityPosts);
    if (communityPosts.length !== beforeP) persistCommunity();
    const creTomb = window.getDeletedCreationTombstones?.() || {};
    const beforeC = creations.length;
    creations = creations.filter((c) => c && c.id != null && !creTomb[String(c.id)]);
    if (creations.length !== beforeC) persistCreations();
  }

  /** 退出 / 换号：清空本地社区与创作缓存（全站 Feed 改从 API 拉取，避免串号） */
  function resetFeatureFeedDom() {
    ['communityGrid', 'creationsGrid', 'userProfileGrid'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = '';
      delete el.dataset.feedSig;
      el.classList.remove('feed-layout-pending', 'feed-layout-ready', 'community-mobile-feed');
    });
    window.FeedLayout?.destroyAllLayouts?.();
  }

  function clearAllLocalFeatureData(opts = {}) {
    const preservePublicFeed = opts.preservePublicFeed === true;
    communityPosts = [];
    if (!preservePublicFeed) publicFeedState.posts = [];
    creations = [];
    likedIds = new Set();
    favIds = new Set();
    communityEvents = [];
    notifications = [];
    if (!preservePublicFeed) publicFeedState.at = 0;
    publicFeedRefreshPromise = null;
    try {
      localStorage.removeItem(LS_COMMUNITY);
      localStorage.removeItem(LS_CREATIONS);
      localStorage.removeItem(LS_LIKES);
      localStorage.removeItem(LS_FAVS);
      if (!preservePublicFeed) localStorage.removeItem(LS_PUBLIC_FEED_CACHE);
      if (opts.clearImageGenDraft === true) {
        localStorage.removeItem(LS_IMAGEGEN);
        localStorage.removeItem(PREFILL_KEY);
      }
      sessionStorage.removeItem('promptrepo_guest_session');
      sessionStorage.removeItem('promptrepo_pending_guest_migrate');
      sessionStorage.removeItem(LS_PENDING_GEN_JOBS);
      sessionStorage.removeItem(LS_FAILED_GEN_JOBS);
      sessionStorage.removeItem(LS_SESSION_GEN_JOBS);
      localStorage.removeItem(LS_GEN_JOBS_STATE);
    } catch (e) { /* ignore */ }
    imageGenPendingJobs = [];
    imageGenFailedJobs = [];
    getActivePollJobIds().clear();
    resetFeatureFeedDom();
    updateNotifyBadge();
    closeCommunitySidePanel();
    closeCreationsSidePanel();
    closeUserProfile();
  }

  function resetSignedOutImageGenForm() {
    try {
      localStorage.removeItem(LS_IMAGEGEN);
      localStorage.removeItem(PREFILL_KEY);
    } catch (e) { /* ignore */ }
    const prompt = document.getElementById('imageGenPrompt');
    const title = document.getElementById('imageGenCardTitle');
    const model = document.getElementById('imageGenModel');
    if (prompt) prompt.value = '';
    if (title) title.value = '';
    if (model?.querySelector('option[value="image2-economy"]')) model.value = 'image2-economy';
    imageGenModelFamily = 'gim2';
    clearImageGenRef();
    try { localStorage.removeItem(LS_IMAGEGEN); } catch (e) { /* ignore */ }
    if (imageGenFormActivated) {
      syncImageGenModelToResolution();
      scheduleImageGenModelUiRefresh();
    }
  }

  function clearSensitiveLocalStateOnSignOut() {
    clearAllLocalFeatureData({ preservePublicFeed: true, clearImageGenDraft: true });
    resetSignedOutImageGenForm();
    renderCommunity({ immediate: true, skipFeedFetch: true });
    void renderCreations();
    if (document.getElementById('pageImageGen')?.classList.contains('active')) renderImageGenFeed({ preserveScroll: true });
  }

  function reloadStores() {
    loadStores();
  }

  function loadStores() {
    const authResolved = window.__PROMPT_HUB_AUTH_RESOLVED__ === true;
    const loggedInBoot = authResolved && window.SupabaseSync?.isLoggedIn?.();
    const idbOwner = localStorage.getItem('promptrepo_idb_owner_uid') || '';
    const lastUid = localStorage.getItem('promptrepo_last_uid') || '';
    const guestLocalAllowed = authResolved && !loggedInBoot
      && (idbOwner === 'guest' || (!idbOwner && !lastUid));
    if (!loggedInBoot && !guestLocalAllowed) {
      communityPosts = [];
      creations = [];
      likedIds = new Set();
      favIds = new Set();
      communityEvents = [];
      notifications = [];
      imageGenPendingJobs = [];
      imageGenFailedJobs = [];
      getActivePollJobIds().clear();
      updateNotifyBadge();
      return;
    }
    communityPosts = filterCommunityPostsForDisplay(loadJson(LS_COMMUNITY, []));
    if (!loggedInBoot) {
      communityPosts = [];
      publicFeedState.posts = [];
      publicFeedState.at = 0;
    }
    creations = dedupeCreationsByJobId(filterCreationsForCloud(loadJson(LS_CREATIONS, [])));
    likedIds = new Set(loadJson(LS_LIKES, []));
    favIds = new Set(loadJson(LS_FAVS, []));
    loadFollows();
    loadNotifications();
    updateNotifyBadge();
    stripDemoCreations();
    reconcileCreationsWarehouseLinks();
    pruneCreations();
    migrateCommunityAuthorIds();
    pruneOrphanFeatureData();
    loadPendingGenJobs();
    loadFailedGenJobs();
    if (loggedInBoot) {
      scheduleRecentCreationsServerSync({
        render: document.getElementById('pageImageGen')?.classList.contains('active')
      }, 900);
    }
    if (imageGenPendingJobs.length > 0) {
      requestAnimationFrame(() => {
        renderImageGenFeed({ preserveScroll: true });
        renderImageGenMobileResult();
      });
    }
    if (imageGenPendingJobs.length > 0) {
      scheduleGenJobsSync(2000);
    }
  }

  function normalizeImageRefForCompare(image) {
    if (!image) return '';
    try {
      if (window.SupabaseSync?.normalizeImageRef) {
        return String(window.SupabaseSync.normalizeImageRef(image) || image || '');
      }
    } catch (e) { /* ignore */ }
    return String(image);
  }

  let publicFeedBatchSyncTimer = null;
  function scheduleSyncMyPostsToPublicFeed(delayMs) {
    if (!window.SupabaseSync?.isLoggedIn?.() || !window.PromptHubApi?.syncCommunityPostsBatch) return;
    clearTimeout(publicFeedBatchSyncTimer);
    publicFeedBatchSyncTimer = setTimeout(() => {
      void syncMyPostsToPublicFeed();
    }, delayMs == null ? 2500 : delayMs);
  }

  /** 卡片库里的作品：社区帖作者必须与当前登录账号一致（修复换号串号后 author=888 等） */
  function reconcileOwnedPostAuthors() {
    const user = getActiveUser();
    if (user.id === 'guest') return false;
    const cardIds = new Set((window.__promptHubCards || []).map((c) => c.id));
    if (!cardIds.size) return false;
    let changed = false;
    for (const p of communityPosts) {
      if (!p || p.isMock || !p.sourceCardId) continue;
      if (!cardIds.has(p.sourceCardId)) continue;
      const card = (window.__promptHubCards || []).find((c) => c.id === p.sourceCardId);
      if (!card?.publishedToCommunity) continue;
      const cardImg = cardImageForPost(p);
      const authorOk = String(p.authorId) === String(user.id) && p.authorName === user.name;
      const imgOk = !cardImg || normalizeImageRefForCompare(p.image) === normalizeImageRefForCompare(cardImg);
      if (authorOk && imgOk) continue;
      p.authorId = user.id;
      p.authorName = user.name;
      if (cardImg) p.image = cardImg;
      p.updatedAt = Date.now();
      changed = true;
    }
    if (changed) {
      persistCommunity();
      rebuildOwnPostFilterCache();
      invalidateCommunityReconcileCache();
      publicFeedState.at = 0;
      scheduleSyncMyPostsToPublicFeed(2500);
    }
    return changed;
  }

  /** 登录后 uid 变化时，把旧 local_/guest 作者帖归到当前账号 */
  function migrateCommunityAuthorIds() {
    const user = getActiveUser();
    if (user.id === 'guest') return;
    const uid = window.SupabaseSync?.getUserId?.() || user.id;
    const cardIds = new Set((window.__promptHubCards || []).map((c) => c.id));
    let changed = false;
    for (const p of communityPosts) {
      if (!p || p.isMock) continue;
      const imgOwner = authorIdFromPostImage(p);
      if (imgOwner && imgOwner === String(uid) && String(p.authorId) !== imgOwner) {
        p.authorId = uid;
        p.authorName = user.name;
        changed = true;
        continue;
      }
      const aid = String(p.authorId || '');
      const isLegacyGuest = aid === 'guest' || p.authorName === '访客';
      const ownsCard = p.sourceCardId && cardIds.has(p.sourceCardId);
      const emailMatch = user.email && aid === 'local_' + user.email;
      if (aid.startsWith('local_') && (ownsCard || emailMatch)) {
        p.authorId = user.id;
        p.authorName = user.name;
        changed = true;
        continue;
      }
      if (isLegacyGuest && ownsCard) {
        p.authorId = user.id;
        p.authorName = user.name;
        changed = true;
      }
    }
    if (changed) persistCommunity();
  }

  let lastEnsureCommunityAt = 0;
  function ensureCommunityFromCardsThrottled(force) {
    if (!force && Date.now() - lastEnsureCommunityAt < 10000) return 0;
    lastEnsureCommunityAt = Date.now();
    return ensureCommunityFromCards();
  }

  function ensureCommunityFromCards() {
    const cards = window.__promptHubCards || [];
    if (!cards.length) return 0;
    reconcileOwnedPostAuthors();
    migrateCommunityAuthorIds();
    reconcileCommunityWithCards(cards);
    const mat = materializeCommunityFromCards(cards);
    if (mat.dirty || mat.added > 0) persistCommunity();
    const user = getActiveUser();
    if (user.id !== 'guest') {
      const added = mat.added + syncMissingPublishedCardsToCommunity({ silent: true, skipRender: true });
      if (added > 0 || mat.dirty) scheduleSyncMyPostsToPublicFeed(3000);
      return added;
    }
    return mat.added;
  }

  /** 仅把「已勾选发布到社区」且尚未有社区帖的卡片补进 Feed */
  function syncMissingPublishedCardsToCommunity(opts = {}) {
    const user = getActiveUser();
    if (user.id === 'guest') return 0;
    let added = 0;
    for (const c of window.__promptHubCards || []) {
      if (!c?.id || !isCommunityPromptEligible(c.prompt)) continue;
      if (!cardPublishedToCommunity(c)) continue;
      if (communityPosts.some((p) => p.sourceCardId === c.id)) continue;
      const before = communityPosts.length;
      syncCardToCommunity(c, true, {
        silent: true,
        keepPublishFlag: true,
        skipPersist: true,
        skipRender: true
      });
      if (communityPosts.length > before) added += 1;
    }
    if (added > 0) {
      persistCommunity();
      rebuildOwnPostFilterCache();
      invalidateCommunityReconcileCache();
    }
    if (!opts.skipRender && added > 0) renderCommunity({ skipFeedFetch: true, forceRepaint: true });
    return added;
  }

  function stripDemoCreations() {
    const before = creations.length;
    creations = creations.filter(c => !isDemoPlaceholderImage(c?.image));
    if (creations.length !== before) persistCreations();
  }

  function buildCreationGallery(c) {
    if (!c) return [];
    if (Array.isArray(c.cardImages) && c.cardImages.length) {
      return c.cardImages.filter(Boolean).slice(0, window.PromptHubCardGallery?.MAX || 5);
    }
    if (c.isMidjourney) {
      const tiles = Array.isArray(c.mjGridUrls) ? c.mjGridUrls.filter(Boolean) : [];
      if (tiles.length) return tiles.slice(0, 5);
      if (c.mjCompositeUrl && c.image) return [c.mjCompositeUrl, c.image].filter(Boolean);
    }
    return c.image ? [c.image] : [];
  }

  /** 最近 Feed 列表缩略：优先可解析的 ref，避免坏 storage:// 挡住 MJ 合成图 */
  function pickCreationFeedImage(c) {
    if (!c) return '';
    const candidates = [];
    const push = (u) => {
      if (u && String(u).trim() && !candidates.includes(u)) candidates.push(String(u).trim());
    };
    push(c.image);
    if (Array.isArray(c.cardImages)) c.cardImages.forEach(push);
    if (c.isMidjourney) {
      push(c.mjCompositeUrl);
      if (Array.isArray(c.mjGridUrls)) c.mjGridUrls.forEach(push);
    }
    for (const u of candidates) {
      if (window.SupabaseSync?.isStorageRef?.(u)) {
        const p = window.SupabaseSync.storagePathFromRef?.(u);
        const key = p ? String(p).replace(/^\//, '') : '';
        if (key && !window.SupabaseSync?.isPathKnownMissing?.(key)) return u;
      }
    }
    for (const u of candidates) {
      if (/^https?:\/\//i.test(u) && !window.SupabaseSync?.isEphemeralUpstreamImageUrl?.(u)) return u;
    }
    for (const u of candidates) {
      if (/^https?:\/\//i.test(u)) return u;
    }
    return candidates[0] || '';
  }

  function creationFeedImageCandidates(c) {
    const out = [];
    const push = (u) => {
      if (u && String(u).trim() && !out.includes(u)) out.push(String(u).trim());
    };
    push(pickCreationFeedImage(c));
    push(c.image);
    if (Array.isArray(c.cardImages)) c.cardImages.forEach(push);
    push(c.mjCompositeUrl);
    if (Array.isArray(c.mjGridUrls)) c.mjGridUrls.forEach(push);
    return out;
  }

  function isKnownMissingImageRef(ref) {
    if (!ref || !window.SupabaseSync?.isStorageRef?.(ref)) return false;
    const path = window.SupabaseSync.storagePathFromRef?.(ref);
    const key = path ? String(path).replace(/^\//, '') : '';
    return !!(key && window.SupabaseSync?.isPathKnownMissing?.(key));
  }

  function isUsableCreationImageRef(ref) {
    if (!isDisplayableImage(ref)) return false;
    if (isKnownMissingImageRef(ref)) return false;
    if (/^https?:\/\//i.test(ref) && window.SupabaseSync?.isInvalidMediaUrl?.(ref)) return false;
    return true;
  }

  function creationHasFeedImage(c) {
    return creationFeedImageCandidates(c).some(isUsableCreationImageRef);
  }

  function getRecentCreationsLimit() {
    return window.Membership?.getRecentCreationsLimit?.()
      ?? 100;
  }

  function isRecentCreationEligible(c) {
    if (!c?.id) return false;
    if (c.permanent || c.visibility === 'published') return false;
    return creationHasFeedImage(c);
  }

  function getRecentCreationsActiveSorted() {
    const now = Date.now();
    return creations
      .filter((c) => isRecentCreationEligible(c))
      .filter((c) => !c.expiresAt || c.expiresAt > now)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  function pruneCreationsByCountLimit() {
    const max = getRecentCreationsLimit();
    const active = getRecentCreationsActiveSorted();
    if (active.length <= max) return;
    const overflow = active.slice(0, active.length - max);
    if (!overflow.length) return;
    void Promise.all(
      overflow
        .filter((c) => !warehouseReferencesCreation(c))
        .map((c) => purgeCreationMedia(c))
    );
    const dropIds = new Set(overflow.map((c) => c.id));
    creations = creations.filter((c) => !dropIds.has(c.id));
    persistCreations();
  }

  function getRecentCreationsForFeed() {
    pruneCreations();
    const now = Date.now();
    return creations
      .filter((c) => c?.id && (!c.expiresAt || c.expiresAt > now))
      .filter((c) => creationHasFeedImage(c))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  let recentServerSyncInflight = null;
  let recentServerSyncLastAt = 0;
  let recentServerSyncTimer = null;

  function creationBaseJobId(c) {
    return normalizeGenJobBaseId(c?.jobId || '');
  }

  function uniqueImageRefs(list) {
    const out = [];
    for (const ref of list || []) {
      const s = String(ref || '').trim();
      if (!s || out.includes(s)) continue;
      out.push(s);
    }
    return out;
  }

  function serverRecentJobToCreation(job, existing) {
    const baseJob = normalizeGenJobBaseId(job?.id);
    if (!baseJob) return null;
    const createdAt = Date.parse(job.createdAt || job.completedAt || '') || Date.now();
    const expiresAt = createdAt + GEN_RETENTION_MS;
    const imageRefs = uniqueImageRefs([
      job.imageUrl,
      ...(Array.isArray(job.extraImageUrls) ? job.extraImageUrls : []),
      job.mjCompositeUrl,
      ...(Array.isArray(job.mjGalleryUrls) ? job.mjGalleryUrls : []),
      ...(Array.isArray(job.mjGridUrls) ? job.mjGridUrls : [])
    ]).filter(isUsableCreationImageRef);
    if (!imageRefs.length) return null;
    const mjGallery = uniqueImageRefs([
      ...(Array.isArray(job.mjGalleryUrls) ? job.mjGalleryUrls : []),
      job.mjCompositeUrl,
      ...(Array.isArray(job.mjGridUrls) ? job.mjGridUrls : []),
      job.imageUrl
    ]).filter(isUsableCreationImageRef);
    const gallery = job.isMidjourney
      ? (mjGallery.length ? mjGallery : imageRefs)
      : imageRefs;
    const localImage = isUsableCreationImageRef(existing?.image) ? existing.image : '';
    const mainImage = localImage || gallery[0] || imageRefs[0];
    const existingGallery = Array.isArray(existing?.cardImages)
      ? existing.cardImages.filter(isUsableCreationImageRef)
      : [];

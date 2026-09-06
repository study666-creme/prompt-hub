    if (!list.length) {
      if (!opts.silent) {
        toast(
          '卡片库里没有作品。若之前有发布过，请到「设置」→「恢复备份」，或点「从云端恢复卡片库」',
          7000
        );
      }
      return 0;
    }
    let added = 0;
    for (const c of list) {
      if (!c?.id || !isCommunityPublishEligible(c)) continue;
      if (!cardPublishedToCommunity(c)) continue;
      if (communityPosts.some((p) => p.sourceCardId === c.id)) continue;
      const before = communityPosts.length;
      syncCardToCommunity(c, true, { silent: true, skipPersist: true, skipRender: true });
      if (communityPosts.length > before) {
        c.publishedToCommunity = true;
        added += 1;
      }
    }
    if (added > 0) {
      persistCommunity();
      rebuildOwnPostFilterCache();
      invalidateCommunityReconcileCache();
      if (typeof window.persistPromptHubCards === 'function') void window.persistPromptHubCards();
    }
    if (!opts.skipRender) {
      renderCommunity({ skipFeedFetch: true });
      if (
        document.getElementById('pageCreations')?.classList.contains('active')
        && communityFeedNeedsRerender('creationsGrid')
      ) {
        void renderCreations();
      }
    }
    return added;
  }

  /** 診斷：卡片庫總數 vs 已勾選公開 vs 可發布條件 */
  function inspectCardLibraryPublishGap() {
    const list = window.__promptHubCards || [];
    const total = list.length;
    const flagged = list.filter((c) => c?.publishedToCommunity === true).length;
    const effective = list.filter((c) => cardPublishedToCommunity(c)).length;
    const eligible = list.filter((c) => isCommunityPublishEligible(c)).length;
    const canMarkMore = list.filter(
      (c) => !c?.publishedToCommunity && isCommunityPublishEligible(c) && !window.isCommunityCollectCard?.(c)
    ).length;
    const flaggedButIneligible = list.filter(
      (c) => c?.publishedToCommunity && !isCommunityPublishEligible(c)
    ).length;
    const shortPrompt = list.filter((c) => !isCommunityPromptEligible(c?.prompt)).length;
    const noUsableImage = list.filter(
      (c) => isCommunityPromptEligible(c?.prompt) && !cardHasCommunityImage(c)
    ).length;
    const row = {
      卡片庫總數: total,
      已勾選公開標記: flagged,
      有效公開_含條件: effective,
      滿足發布條件_未勾選: canMarkMore,
      已勾選但不滿足條件: flaggedButIneligible,
      提示詞不足15字: shortPrompt,
      提示詞夠長但無可用配圖: noUsableImage,
      滿足條件可發布: eligible
    };
    console.table(row);
    console.info(
      '側欄「全部」= 卡片庫總數，不是公開數。Console 用 publishedToCommunity 統計的是「已勾選公開」。'
    );
    return row;
  }

  /** 僅對滿足條件且未公開的卡片勾選發布（不覆蓋 Storage） */
  async function markAllEligibleCardsPublished(opts = {}) {
    const list = window.__promptHubCards || [];
    if (!list.length) {
      if (!opts.silent) toast('卡片庫為空');
      return { marked: 0 };
    }
    if (!window.SupabaseSync?.isLoggedIn?.()) {
      if (!opts.silent) toast('請先登錄');
      return { marked: 0 };
    }
    let marked = 0;
    let already = 0;
    let skipIneligible = 0;
    let skipCollect = 0;
    for (const c of list) {
      if (!c?.id) continue;
      if (window.isCommunityCollectCard?.(c)) {
        skipCollect += 1;
        continue;
      }
      if (c.publishedToCommunity) {
        already += 1;
        continue;
      }
      if (!isCommunityPublishEligible(c)) {
        skipIneligible += 1;
        continue;
      }
      await syncCardToCommunity(c, true, {
        silent: true,
        skipRender: true,
        skipPersist: true,
        keepPublishFlag: true
      });
      if (c.publishedToCommunity) marked += 1;
    }
    if (marked > 0) {
      persistCommunity();
      rebuildOwnPostFilterCache();
      invalidateCommunityReconcileCache();
      if (typeof window.persistPromptHubCards === 'function') void window.persistPromptHubCards();
      if (!opts.skipSync) {
        await syncMyPostsToPublicFeed();
        await refreshPublicCommunityFeed({ force: true });
      }
    }
    const summary = { marked, already, skipIneligible, skipCollect, total: list.length };
    if (!opts.silent) {
      const parts = [];
      if (marked) parts.push(`新勾選公開 ${marked} 張`);
      if (already) parts.push(`${already} 張已是公開`);
      if (skipIneligible) parts.push(`${skipIneligible} 張不滿足（提示詞≥15字且需可用配圖）`);
      if (skipCollect) parts.push(`${skipCollect} 張為社區收藏`);
      toast(parts.length ? parts.join('；') : '沒有可新勾選的卡片', 6000);
    }
    console.table(summary);
    return summary;
  }

  window.inspectCardLibraryPublishGap = inspectCardLibraryPublishGap;
  window.markAllEligibleCardsPublished = markAllEligibleCardsPublished;

  async function runSyncCardLibraryToCommunity() {
    let list = window.__promptHubCards || [];
    if (!list.length) {
      toast('卡片库为空，正在尝试从云端/本地备份恢复…', 5000);
      if (typeof window.syncCloudNow === 'function') {
        await window.syncCloudNow();
      }
      list = window.__promptHubCards || [];
      if (!list.length) {
        toast('仍未找到卡片。请到「设置」→「恢复备份」', 8000);
        return 0;
      }
    }
    const added = syncMissingPublishedCardsToCommunity({ silent: true, skipRender: true });
    const bulk = syncEligibleCardsToCommunity({ silent: true, skipRender: true });
    const total = added + bulk;
    if (window.SupabaseSync?.isLoggedIn?.()) {
      await syncMyPostsToPublicFeed();
      await refreshPublicCommunityFeed({ force: true });
    }
    renderCommunity({ skipFeedFetch: true, forceRepaint: true });
    if (total > 0) {
      toast(`已同步 ${total} 条作品到社区`, 4500);
    } else {
      const eligible = list.filter((c) => isCommunityPromptEligible(c.prompt)).length;
      toast(
        `卡片库 ${list.length} 张，其中 ${eligible} 张提示词够长；社区帖已对齐。请到「全部作品」查看`,
        7000
      );
    }
    return total;
  }

  window.syncEligibleCardsToCommunity = syncEligibleCardsToCommunity;
  window.runSyncCardLibraryToCommunity = runSyncCardLibraryToCommunity;

  /** 从全站社区帖恢复缺失的卡片库条目（数据库有帖、本地库无卡时用） */
  async function restoreCardsFromCommunityFeed() {
    const uid = window.SupabaseSync?.getUserId?.();
    if (!uid) {
      toast('请先登录', 4000);
      return 0;
    }
    toast('正在从社区恢复卡片…', 3500);
    await refreshPublicCommunityFeed({ force: true, timeoutMs: 20000 });
    const list = window.__promptHubCards || [];
    const existing = new Set(list.map((c) => c.id));
    const tomb = window.getDeletedCardTombstones?.() || {};
    let added = 0;
    const mine = publicFeedState.posts.filter((p) => {
      if (!p?.sourceCardId) return false;
      const owner = authorIdFromPostImage(p) || String(p.authorId || '');
      return owner === String(uid);
    });
    for (const p of mine) {
      const cid = String(p.sourceCardId);
      if (existing.has(cid)) continue;
      if (tomb[cid] && typeof window.clearCardDeletionTombstone === 'function') {
        window.clearCardDeletionTombstone(cid);
      }
      list.push({
        id: cid,
        title: (p.title || '').trim() || '',
        prompt: p.prompt || '',
        image: p.image || null,
        tags: [],
        groupId: null,
        pinned: false,
        publishedToCommunity: true,
        communityPostId: p.id,
        createdAt: p.createdAt || Date.now(),
        updatedAt: Date.now()
      });
      existing.add(cid);
      added += 1;
    }
    if (!added) {
      toast(`社区共 ${mine.length} 条你的作品，卡片库已对齐，无需恢复`, 6000);
      return 0;
    }
    window.__promptHubCards = list;
    if (typeof window.persistPromptHubCards === 'function') await window.persistPromptHubCards();
    restorePublishedFlagsFromFeed();
    maybeReconcileCommunityWithCards(list, { force: true });
    renderCommunity({ skipFeedFetch: true, forceRepaint: true });
    if (typeof window.renderCards === 'function') window.renderCards(true);
    toast(`已从社区恢复 ${added} 张卡片到卡片库`, 5500);
    return added;
  }
  window.restoreCardsFromCommunityFeed = restoreCardsFromCommunityFeed;

  function communityFeedNeedsRerender(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return false;
    const list =
      containerId === 'creationsGrid'
        ? getMyPublishedPosts()
        : filterAndSortPosts(getCommunityFeedForDisplay());
    const sig = feedListSignature(list, containerId);
    return container.dataset.feedSig !== sig;
  }

  let refreshFeedsTimer = null;
  function refreshFeedsAfterCardsSync() {
    clearTimeout(refreshFeedsTimer);
    refreshFeedsTimer = setTimeout(() => {
      const onCommunity = document.getElementById('pageCommunity')?.classList.contains('active');
      const onImageGen = document.getElementById('pageImageGen')?.classList.contains('active');
      const onCreations = document.getElementById('pageCreations')?.classList.contains('active');
      if (isMobileViewport() && !onCommunity && !onImageGen && !onCreations) {
        prunePendingJobsWithCreations();
        return;
      }
      if (window.__promptHubCards?.length) {
        ensureCommunityFromCards();
      }
      const afterFeed = () => {
        if (onCommunity && communityFeedNeedsRerender('communityGrid')) {
          renderCommunity({ skipFeedFetch: true });
        }
        if (
          document.getElementById('pageCreations')?.classList.contains('active')
        ) {
          const container = document.getElementById('creationsGrid');
          const list = getMyPublishedPosts();
          const sig = feedListSignature(list, 'creationsGrid');
          if (container?.dataset.feedSig === sig && container.querySelector('.community-post-card')) {
            patchFeedLikeLabels(container, list);
          } else if (communityFeedNeedsRerender('creationsGrid')) {
            void renderCreations();
          }
        }
      };
      void syncMyPostsToPublicFeed().finally(() => {
        void refreshPublicCommunityFeed({ force: publicFeedState.at === 0 }).then(afterFeed);
      });
      prunePendingJobsWithWarehouseCards();
      if (document.getElementById('pageImageGen')?.classList.contains('active')) {
        renderImageGenFeed({ preserveScroll: true });
      }
    }, 800);
  }

  function featureImgSrc(image) {
    if (!image) return '';
    if (window.MediaPipeline?.safeImgSrc) return window.MediaPipeline.safeImgSrc(image);
    if (window.SupabaseSync?.safeImgSrc) return window.SupabaseSync.safeImgSrc(image);
    if (window.SupabaseSync?.isStorageRef?.(image)) {
      const c = window.SupabaseSync.getCachedDisplayUrl?.(image, { variant: 'grid' });
      return c && !c.startsWith('storage://') ? c : '';
    }
    return image;
  }

  function isDemoPlaceholderImage(image) {
    if (typeof image !== 'string' || !image.startsWith('data:image/')) return false;
    return image.includes('演示生成');
  }

  function isDisplayableImage(image) {
    if (!image || typeof image !== 'string') return false;
    if (!String(image).trim()) return false;
    if (isDemoPlaceholderImage(image)) return false;
    return true;
  }

  function cardImageForPost(post) {
    if (!post?.sourceCardId) return null;
    const card = (window.__promptHubCards || []).find((c) => c.id === post.sourceCardId);
    return card?.image && isDisplayableImage(card.image) ? card.image : null;
  }

  function finishCommunityFeedLayoutAfterBatch(containerId) {
    if (!containerId) return;
    const container = document.getElementById(containerId);
    if (!container) return;
    if (
      (window.__PH_FEED_BULK_DRAIN__ || feedScrollIntent[containerId])
      && (containerId === 'communityGrid' || containerId === 'creationsGrid')
    ) {
      ensureFeedPageSentinel(container);
      reconnectFeedPageObserver(containerId);
      setFeedLayoutPending(containerId, false);
      return;
    }
    if (useCommunityCssGrid(containerId) && container.dataset.feedDistributed === '1') {
      ensureFeedPageSentinel(container);
      reconnectFeedPageObserver(containerId);
      setFeedLayoutPending(containerId, false);
      return;
    }
    scheduleCommunityLayout(containerId, { force: true, immediate: true });
    layoutCommunityWhenImagesReady(containerId);
    if (containerId === 'communityGrid' || containerId === 'creationsGrid') {
      requestAnimationFrame(() => reconnectFeedPageObserver(containerId));
    }
  }

  function getFeedScrollRoot(container) {
    if (!container) return null;
    let el = container;
    while (el && el !== document.documentElement) {
      const st = getComputedStyle(el);
      const oy = st.overflowY;
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 8) {
        return el;
      }
      el = el.parentElement;
    }
    if (!isMobileViewport() && container.id === 'creationsGrid') {
      const shell = container.closest('.feature-shell.my-home-shell')
        || container.closest('.my-home-shell')
        || container.closest('.feature-shell');
      if (shell) return shell;
    }
    if (
      !isMobileViewport()
      && container.id === 'communityGrid'
      && container.classList?.contains('community-feed-columns')
      && container.scrollHeight > container.clientHeight + 8
    ) {
      return container;
    }
    if (isMobileViewport() && (container.id === 'communityGrid' || container.id === 'creationsGrid' || container.id === 'imageGenFeed')) {
      return document.querySelector('.app-main') || container;
    }
    if (container.id === 'imageGenFeed') {
      return container;
    }
    return container;
  }

  function collectFeedScrollTargets(containerId, container) {
    const targets = new Set();
    const addIfScrollable = (el) => {
      if (!el) return;
      const st = getComputedStyle(el);
      const oy = st.overflowY;
      if (
        (oy === 'auto' || oy === 'scroll' || oy === 'overlay')
        && el.scrollHeight > el.clientHeight + 8
      ) {
        targets.add(el);
      }
    };
    const primary = getFeedScrollRoot(container) || container;
    if (primary) targets.add(primary);
    if (!isMobileViewport() && (containerId === 'communityGrid' || containerId === 'creationsGrid')) {
      addIfScrollable(container);
      addIfScrollable(container?.closest?.('.feature-body'));
      if (containerId === 'creationsGrid') {
        addIfScrollable(container?.closest?.('.my-home-shell'));
        addIfScrollable(container?.closest?.('.feature-shell'));
      }
    }
    if (isMobileViewport() && (containerId === 'communityGrid' || containerId === 'creationsGrid')) {
      const shell = container?.closest?.('.feature-shell');
      if (shell) targets.add(shell);
      if (container && container.scrollHeight > container.clientHeight + 8) targets.add(container);
      if (document.scrollingElement) targets.add(document.scrollingElement);
    }
    return [...targets];
  }


  function ensureFeedPageSentinel(container) {
    if (!container) return null;
    container.closest('.feature-body-cards')?.querySelector(':scope > .feed-page-sentinel')?.remove();
    container.querySelectorAll(':scope > .feed-page-sentinel').forEach((el) => el.remove());
    const sentinel = document.createElement('div');
    sentinel.className = 'feed-page-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    /* 必須掛在 grid 容器直層，與 styles.css 一致；勿塞進最短列（會導致滾到底不觸發加載） */
    container.appendChild(sentinel);
    const io = container.__feedPageIo;
    if (io) {
      io.disconnect();
      const scrollEl = getFeedScrollRoot(container) || container;
      const root = scrollEl === container ? container : scrollEl;
      io.observe(sentinel);
      container.__feedPageIoRoot = root;
    }
    return sentinel;
  }

  function markFeedUserScrolling() {
    feedUserScrollUntil = Date.now() + 900;
  }

  function shouldSkipFeedScrollRestore(scrollEl, capturedTop) {
    if (!scrollEl || !Number.isFinite(capturedTop)) return true;
    if (Date.now() < feedUserScrollUntil) return true;
    return scrollEl.scrollTop > capturedTop + 20;
  }

  function safeApplyFeedScrollTop(scrollEl, capturedTop, opts = {}) {
    if (!scrollEl || !Number.isFinite(capturedTop)) return;
    const force = opts.force === true;
    const cur = scrollEl.scrollTop;
    if (!force) {
      if (shouldSkipFeedScrollRestore(scrollEl, capturedTop)) return;
      /* 布局/排版后禁止把用户已滑过的位置往回拉 */
      if (cur > capturedTop + 8) return;
    }
    scrollEl.scrollTop = capturedTop;
  }

  function captureFeedScrollAnchor(container) {
    if (!container) return null;
    const scrollEl = getFeedScrollRoot(container) || container;
    const rect = scrollEl.getBoundingClientRect();
    const cards = container.querySelectorAll('.community-feed-col .card, :scope > .card');
    for (const card of cards) {
      const r = card.getBoundingClientRect();
      if (r.bottom > rect.top + 12 && r.top < rect.bottom - 12) {
        return { postId: card.dataset.postId || '', offset: r.top - rect.top, scrollTop: scrollEl.scrollTop, scrollEl };
      }
    }
    return { scrollTop: scrollEl.scrollTop, scrollEl };
  }

  function restoreFeedScrollAnchor(container, anchor, opts = {}) {
    if (!container || !anchor) return;
    const scrollEl = anchor.scrollEl || getFeedScrollRoot(container) || container;
    const force = opts.force === true;
    if (!force && shouldSkipFeedScrollRestore(scrollEl, anchor.scrollTop)) return;
    if (anchor.postId) {
      const card = container.querySelector(`.card[data-post-id="${CSS.escape(anchor.postId)}"]`);
      if (card) {
        const rect = scrollEl.getBoundingClientRect();
        const r = card.getBoundingClientRect();
        const nextTop = scrollEl.scrollTop + (r.top - rect.top) - anchor.offset;
        if (!force && nextTop < scrollEl.scrollTop - 8) return;
        scrollEl.scrollTop = nextTop;
        return;
      }
    }
    if (Number.isFinite(anchor.scrollTop)) {
      safeApplyFeedScrollTop(scrollEl, anchor.scrollTop, { force });
    }
  }

  function preserveFeedScroll(container, fn) {
    const anchor = captureFeedScrollAnchor(container);
    fn();
    scheduleFeedScrollRestores(container, anchor, [0, 16, 32, 120, 280]);
  }

  function releaseFeedScrollLock() {
    feedScrollLockUntil = 0;
    feedScrollLockAnchor = null;
    clearTimeout(feedScrollLockClearTimer);
    feedScrollLockClearTimer = null;
  }

  function lockFeedScroll(container, ms = 520) {
    if (!container) return null;
    const anchor = captureFeedScrollAnchor(container);
    feedScrollLockAnchor = anchor;
    feedScrollLockUntil = Date.now() + ms;
    clearTimeout(feedScrollLockClearTimer);
    feedScrollLockClearTimer = setTimeout(() => {
      releaseFeedScrollLock();
    }, ms + 48);
    return anchor;
  }

  function isFeedScrollLocked() {
    return Date.now() < feedScrollLockUntil;
  }

  function restoreLockedFeedScroll(container) {
    releaseFeedScrollLock();
  }

  function bindFeedScrollLock(containerId) {
    const container = document.getElementById(containerId);
    if (!container || container.__feedScrollLockBound) return;
    container.__feedScrollLockBound = true;
    const onUserScrollIntent = () => {
      markFeedUserScrolling();
      releaseFeedScrollLock();
    };
    const refresh = () => {
      collectFeedScrollTargets(containerId, container).forEach((el) => {
        if (!el || el.__feedScrollLockListener) return;
        el.__feedScrollLockListener = onUserScrollIntent;
        el.addEventListener('scroll', onUserScrollIntent, { passive: true });
        el.addEventListener('wheel', onUserScrollIntent, { passive: true });
      });
    };
    container.__feedScrollLockRefresh = refresh;
    refresh();
  }

  function scheduleFeedScrollRestores(container, anchor, delays = [0, 16, 80, 180, 360, 560]) {
    if (!container || !anchor) return;
    const scrollEl = anchor.scrollEl || getFeedScrollRoot(container) || container;
    const capturedTop = anchor.scrollTop;
    delays.forEach((ms) => {
      setTimeout(() => {
        if (Date.now() < feedUserScrollUntil) return;
        if (shouldSkipFeedScrollRestore(scrollEl, capturedTop)) return;
        restoreFeedScrollAnchor(container, anchor);
      }, ms);
    });
  }

  function resolveFeedPageIoRoot(containerId, container, scrollTargets) {
    const candidates = scrollTargets?.length
      ? scrollTargets
      : collectFeedScrollTargets(containerId, container);
    for (const el of candidates) {
      if (!el || el === document.documentElement) continue;
      if (el.scrollHeight > el.clientHeight + 8) return el;
    }
    return null;
  }

  function isFeedNearBottom(target, margin = 320) {
    if (!target) return false;
    return target.scrollTop + target.clientHeight >= target.scrollHeight - margin;
  }

  function finalizeFeedContainer(container, containerId) {
    if (!container) return;
    if (container.dataset.feedFinalized === '1') return;
    container.dataset.feedFinalized = '1';
    container.dataset.feedLayoutReady = '1';
    container.querySelectorAll('.card-media.is-loading').forEach((m) => {
      const img = m.querySelector('img.card-img');
      const src = img?.currentSrc || img?.src || '';
      const loaded = img
        && img.complete
        && img.naturalWidth > 8
        && /^https?:\/\//i.test(src)
        && !src.includes('data:image/svg');
      if (loaded) releaseFeedMediaLoading(m);
    });
    setFeedLayoutPending(containerId, false);
    if (useCssGridForCommunityFeed(containerId)) {
      layoutCommunityMasonry(containerId);
    } else {
      scheduleCommunityLayout(containerId);
    }
  }

  function getPostsByAuthor(authorId) {
    return getCommunityFeedForDisplay().filter(p => p.authorId === authorId);
  }

  function isGenericPostTitle(title) {
    const t = (title || '').trim();
    return !t || t === '未命名' || t === '未命名提示词' || t === '我的作品';
  }

  function getPostTitle(post) {
    const title = (post.title || '').trim();
    if (title && !isGenericPostTitle(title)) return title;
    const prompt = (post.prompt || '').trim();
    if (!prompt) return '暂无提示词';
    if (prompt.length <= 80) return prompt;
    return prompt.slice(0, 80) + '…';
  }

  /** 侧栏标题最多 10 字 */
  function getPostSideTitle(post) {
    const title = (post.title || '').trim();
    if (title && !isGenericPostTitle(title)) {
      return title.length > 10 ? title.slice(0, 10) + '…' : title;
    }
    const prompt = (post.prompt || '').trim();
    if (!prompt) return '提示词详情';
    return prompt.length > 10 ? prompt.slice(0, 10) + '…' : prompt;
  }

  function getPostDesc(post) {
    const title = (post.title || '').trim();
    const prompt = (post.prompt || '').trim();
    if (!title || isGenericPostTitle(title)) return '';
    return prompt || '';
  }

  function formatTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `大约 ${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
    return new Date(ts).toLocaleDateString('zh-CN');
  }

  function makePlaceholderDataUrl(prompt, seed = 0) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');
    const h = ((prompt || '').length * 17 + seed * 53) % 360;
    const g = ctx.createLinearGradient(0, 0, 512, 512);
    g.addColorStop(0, `hsl(${h}, 45%, 22%)`);
    g.addColorStop(1, `hsl(${(h + 80) % 360}, 50%, 12%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.font = '14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('演示生成', 256, 248);
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText('接入 API 后替换', 256, 268);
    return c.toDataURL('image/jpeg', 0.85);
  }

  function isGenericFeedTitle(title) {
    const t = (title || '').trim();
    return !t || t === '未命名' || t === '未命名提示词' || t === '我的作品' || t === '生成图';
  }

  /** 标题行仅显示真实标题；勿把提示词首行当标题 */

  /** 首屏：有缓存 URL 直接用，否则小占位（避免 Masonry 就位前大图闪现） */
  function feedImgInitialSrc(image, opts) {
    if (!image || !isDisplayableImage(image)) return '';
    const o = opts && typeof opts === 'object' ? opts : {};
    if (window.SupabaseSync?.getListDisplayImageSrc) {
      const listUrl = window.SupabaseSync.getListDisplayImageSrc(
        image,
        o.assetId || o.sourceCardId,
        { authorId: o.authorId, assetId: o.assetId || o.sourceCardId }
      );
      if (listUrl && listUrl.startsWith('http') && !listUrl.includes('data:image/svg')) {
        if (!window.SupabaseSync?.isInvalidMediaUrl?.(listUrl)) return listUrl;
      }
    }
    return IMG_LOADING_PLACEHOLDER;
  }

  /** 社区首屏加载：低存在感骨架，替代大段「正在加载…」文案 */
  function communityFeedSkeletonHtml(count) {
    const heights = [168, 224, 152, 196, 248, 176, 212, 184, 232, 160];
    const n = Math.max(4, Math.min(count || 8, heights.length));
    let html = '';
    for (let i = 0; i < n; i++) {
      const h = heights[i % heights.length];
      html += `<div class="card community-post-card community-post-card--visual community-feed-skeleton" aria-hidden="true"><div class="card-media is-loading community-feed-skeleton-media" style="min-height:${h}px"></div></div>`;
    }
    return html;
  }

  function showCommunityFeedSkeleton(container, count) {
    if (!container) return;
    window.FeedLayout?.destroyLayout?.('communityGrid');
    delete container.dataset.feedSig;
    delete container.dataset.feedFinalized;
    delete feedPagedStore.communityGrid;
    container.classList.add('feed-layout-pending');
    container.classList.remove('feed-layout-ready');
    container.innerHTML = communityFeedSkeletonHtml(count);
  }

  function setFeedLayoutPending(containerId, pending) {
    const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!el) return;
    el.classList.toggle('feed-layout-pending', !!pending);
    if (!pending) el.classList.add('feed-layout-ready');
    else el.classList.remove('feed-layout-ready');
    if (!pending) {
      clearTimeout(el.__feedPendingTimer);
      el.__feedPendingTimer = null;
    }
  }

  function feedListSignature(posts, containerId) {
    const ids = posts.map((p) => String(p.id));
    const orderSensitive =
      containerId === 'communityGrid' ||
      containerId === 'userProfileGrid' ||
      containerId === 'creationsGrid';
    const idKey = orderSensitive ? ids.join('|') : [...ids].sort().join('|');
    let meta = '';
    if (containerId === 'communityGrid') {
      const q = (document.getElementById('communitySearch')?.value || '').trim().toLowerCase();
      meta = `|sort:${communitySort}|scope:${communityScope}|q:${q}`;
      if (communitySort === 'random') meta += `|rnd:${communityRandomEpoch}`;
    }
    return `${containerId}:${posts.length}:${idKey}${meta}`;
  }

  function communityLikeCountText(count) {
    return `获赞 ${count || 0}`;
  }

  function patchFeedLikeLabels(container, posts) {
    posts.forEach((post) => {
      const label = communityLikeCountText(post.likes);
      const liked = likedIds.has(post.id);
      container.querySelectorAll(`.card[data-post-id="${post.id}"] .card-time`).forEach((el) => {
        el.textContent = label;
        el.classList.toggle('liked', liked);
      });
    });
  }

  async function softHydrateFeedContainer(container) {
    if (!container) return;
    window.MediaPipeline?.patchContainerFromCache?.(container, { visibleFirst: true, max: FEED_PER_PAGE });
    window.CardImageLoader?.observeContainer?.(container);
    window.CardImageLoader?.boostCommunityFeedImages?.(container, FEED_PER_PAGE);
  }

  function communityImgInitialSrc(image, opts) {
    return feedImgInitialSrc(image, opts);
  }

  function patchCommunityLikeUI(id) {
    const post = findPost(id);
    if (!post) return;
    const label = communityLikeCountText(post.likes);
    const liked = likedIds.has(id);
    document.querySelectorAll(`#communityGrid .card[data-post-id="${id}"] .card-time`).forEach(el => {
      el.textContent = label;
      el.classList.toggle('liked', liked);
    });
    if (openProfileAuthorId) {
      document.querySelectorAll(`#userProfileGrid .card[data-post-id="${id}"] .card-time`).forEach(el => {
        el.textContent = label;
        el.classList.toggle('liked', liked);
      });
    }
  }

  function patchCommunitySidePanelUI(id) {
    if (communitySidePostId !== id) return;
    const post = findPost(id);
    const body = document.getElementById('communitySideBody');
    if (!post || !body) return;
    const liked = likedIds.has(id);
    const faved = favIds.has(id);
    const stats = body.querySelector('.community-side-stats');
    if (stats) {
      stats.innerHTML = `<span>${communityLikeCountText(post.likes)}</span><span>${faved ? '已收藏' : '未收藏'}</span>`;
    }
    const likeBtn = body.querySelector('[data-action="like"]');
    if (likeBtn) likeBtn.textContent = liked ? '已点赞' : '点赞';
    const favBtn = body.querySelector('[data-action="fav"]');
    if (favBtn) favBtn.textContent = faved ? '已收藏' : '收藏';
  }

  function feedImgStillPending(img) {
    const src = img?.currentSrc || img?.src || '';
    if (!src || src.includes('data:image/svg')) return true;
    return !(img.complete && img.naturalWidth > 8);
  }

  function layoutCommunityWhenImagesReady(containerId) {
    if (useCommunityCssGrid(containerId) || useCssGridForCommunityFeed(containerId)) {
      setFeedLayoutPending(containerId, false);
      return;
    }
    const container = document.getElementById(containerId);
    if (!container) return;
    const run = () => settleCommunityFeedLayout(containerId, { recalcCols: true });
    const imgs = [...container.querySelectorAll('.card-img')];
    const pending = imgs.filter((img) => feedImgStillPending(img));
    if (!pending.length) {
      run();
      return;
    }
    let left = pending.length;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      run();
    };
    const tick = () => {
      left -= 1;
      if (left <= 0) finish();
    };
    pending.forEach((img) => {
      img.addEventListener('load', tick, { once: true });
      img.addEventListener('error', tick, { once: true });
    });
    setTimeout(finish, 2800);
  }

  const feedLayoutSettleSeq = Object.create(null);
  function settleCommunityFeedLayout(containerId = 'communityGrid', opts = {}) {
    if (!containerId) return;
    const container = document.getElementById(containerId);
    if (!container) return;
    if (useCommunityCssGrid(containerId) || useCssGridForCommunityFeed(containerId)) {
      setFeedLayoutPending(containerId, false);
      return;
    }
    if (!container.querySelector('.community-post-card, .card')) return;
    const seq = (feedLayoutSettleSeq[containerId] || 0) + 1;
    feedLayoutSettleSeq[containerId] = seq;
    const fromImage = opts.fromImage === true;
    const delays = fromImage
      ? [120, 420]
      : [0, 120, 360, 900, 1600];
    const run = () => {
      if (feedLayoutSettleSeq[containerId] !== seq) return;
      const live = document.getElementById(containerId);
      if (!live) return;
      if (containerId === 'communityGrid') {
        window.FeedLayout?.repairCommunityMasonry?.(containerId);
      }
      if (fromImage) {
        scheduleCommunityLayout(containerId, {
          fromImage: true,
          immediate: false,
          recalcCols: opts.recalcCols === true
        });
        if (containerId === 'communityGrid' || containerId === 'creationsGrid') {
          requestAnimationFrame(() => reconnectFeedPageObserver(containerId));
        }
        return;
      }
      scheduleCommunityLayout(containerId, {
        force: true,
        immediate: true,
        recalcCols: opts.recalcCols === true
      });
      window.FeedLayout?.scheduleMasonryRelayout?.(containerId);
      if (containerId === 'communityGrid' || containerId === 'creationsGrid') {
        requestAnimationFrame(() => reconnectFeedPageObserver(containerId));
      }
    };
    delays.forEach((delay) => {
      if (delay <= 0) requestAnimationFrame(() => requestAnimationFrame(run));
      else setTimeout(run, delay);
    });
  }

  /* —— 全站社区 Feed API：community-public-feed.js —— */
  let authorIdFromPostImage;
  let communityPostDisplayKey;
  let loadPublicFeedCache;
  let _hydratePublicFeedFromCache;
  function hydratePublicFeedFromCache() {
    if (typeof _hydratePublicFeedFromCache === 'function') return _hydratePublicFeedFromCache();
    return false;
  }
  let _publicFeedNeedsFullRefresh;
  function publicFeedNeedsFullRefresh() {
    if (typeof _publicFeedNeedsFullRefresh === 'function') return _publicFeedNeedsFullRefresh();
    return true;
  }
  let _refreshPublicCommunityFeed;
  async function refreshPublicCommunityFeed(opts) {
    if (typeof _refreshPublicCommunityFeed === 'function') return _refreshPublicCommunityFeed(opts);
    return false;
  }
  let _fetchMorePublicCommunityFeed;

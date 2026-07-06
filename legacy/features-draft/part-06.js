      if (n.id === id || (key && notifyDedupeKey(n) === key)) n.read = true;
    });
  }

  function mergeNotifications(list) {
    if (!Array.isArray(list)) return;
    const map = new Map(notifications.map(n => [n.id, n]));
    for (const n of list) {
      if (!n?.id) continue;
      const prev = map.get(n.id);
      const merged = prev ? { ...n, ...prev, read: !!(prev.read || n.read) } : n;
      map.set(n.id, merged);
      const key = notifyDedupeKey(merged);
      if (key && merged.read) {
        for (const item of map.values()) {
          if (notifyDedupeKey(item) === key) item.read = true;
        }
      }
    }
    notifications = [...map.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 100);
    persistNotifications();
    updateNotifyBadge();
  }

  function formatNotifyMessage(n) {
    if (n.type === 'follow') return `${n.actorName || '用户'} 关注了你`;
    if (n.type === 'favorite') {
      const title = (n.postTitle || '').trim();
      return title ? `${n.actorName || '用户'} 收藏了你的作品「${title.slice(0, 20)}」` : `${n.actorName || '用户'} 收藏了你的作品`;
    }
    if (n.type === 'like') {
      const title = (n.postTitle || '').trim();
      return title ? `${n.actorName || '用户'} 赞了你的作品「${title.slice(0, 20)}」` : `${n.actorName || '用户'} 赞了你的作品`;
    }
    return n.message || '新消息';
  }

  function persistNotifications() {
    try {
      localStorage.setItem('promptrepo_notifications', JSON.stringify(notifications));
    } catch (e) { /* ignore */ }
    if (window.SupabaseSync?.isLoggedIn?.()) queueCloudPush();
  }

  function loadNotifications() {
    try {
      const raw = localStorage.getItem('promptrepo_notifications');
      notifications = raw ? JSON.parse(raw) : [];
    } catch (e) { notifications = []; }
  }

  function unreadNotifyCount() {
    return notifications.filter(n => !n.read).length;
  }

  function updateNotifyBadge() {
    const badge = document.getElementById('communityNotifyBadge');
    if (!badge) return;
    const showBadge = window.getCommunityNotifyBadgeEnabled?.() !== false;
    const n = unreadNotifyCount();
    const visible = showBadge && n > 0;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('hidden', !visible);
    badge.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function renderNotifyPanel() {
    const listEl = document.getElementById('communityNotifyList');
    if (!listEl) return;
    if (!notifications.length) {
      listEl.innerHTML = '<p class="community-notify-empty">暂无消息</p>';
      return;
    }
    listEl.innerHTML = notifications.map(n => `
      <button type="button" class="community-notify-item${n.read ? '' : ' unread'}" data-notify-id="${esc(n.id)}" data-post-id="${esc(n.postId || '')}">
        <span class="community-notify-item-title">${esc(n.message || formatNotifyMessage(n))}</span>
        <span class="community-notify-item-time">${esc(formatTime(n.createdAt))}</span>
      </button>`).join('');
    listEl.querySelectorAll('.community-notify-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.notifyId;
        markNotificationsReadById(id);
        persistNotifications();
        updateNotifyBadge();
        renderNotifyPanel();
        const n = notifications.find(x => x.id === id);
        if (n?.postId) {
          closeNotifyPanel();
          if (typeof switchAppPage === 'function') switchAppPage('community');
          openCommunitySidePanel(n.postId);
        }
      });
    });
  }

  function toggleNotifyPanel() {
    const panel = document.getElementById('communityNotifyPanel');
    if (!panel) return;
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) renderNotifyPanel();
  }

  function closeNotifyPanel() {
    document.getElementById('communityNotifyPanel')?.classList.add('hidden');
  }

  function markAllNotificationsRead() {
    notifications.forEach(n => { n.read = true; });
    persistNotifications();
    updateNotifyBadge();
    renderNotifyPanel();
  }

  function syncFollowUI(authorId) {
    const btn = document.getElementById('userProfileFollowBtn');
    if (!btn || String(openProfileAuthorId) !== String(authorId)) return;
    const on = isFollowing(authorId);
    btn.textContent = on ? '已关注' : '关注';
    btn.classList.toggle('active', on);
  }

  function bindAuthorLink(el, authorId, authorName) {
    el.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      openUserProfile(authorId, authorName);
    });
  }

  function snapshotLoadedFeedImages(container) {
    const map = new Map();
    if (!container) return map;
    container.querySelectorAll('.card[data-post-id] img.card-img').forEach((img) => {
      const postId = img.closest('.card')?.dataset?.postId;
      const src = img.currentSrc || img.src || '';
      if (!postId || !src || src.includes('data:image/svg')) return;
      const ok =
        (window.SupabaseSync?.isValidSignedDisplayUrl && window.SupabaseSync.isValidSignedDisplayUrl(src)) ||
        /^https?:\/\//i.test(src);
      if (ok) map.set(postId, src);
    });
    return map;
  }

  function restoreLoadedFeedImages(container, map) {
    if (!container || !map?.size) return;
    map.forEach((src, postId) => {
      const card = container.querySelector(`.card[data-post-id="${CSS.escape(postId)}"]`);
      const img = card?.querySelector('img.card-img');
      if (!img) return;
      const cur = img.currentSrc || img.src || '';
      if (cur && !cur.includes('data:image/svg') && cur === src) return;
      if (window.CardImageLoader?.applyUrlToImg) {
        window.CardImageLoader.applyUrlToImg(img, src);
      } else {
        img.src = src;
        const media = img.closest('.card-media');
        media?.classList.remove('is-loading', 'card-media--await');
        if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(media);
      }
    });
  }

  function createCommunityFeedCard(post, containerId, cardOpts = {}) {
    const displayRef = communityFeedCardImageRef(post);
    const showImage = !!(displayRef && isDisplayableImage(displayRef));
    const div = document.createElement('div');
    const visualOnly = containerId === 'communityGrid' || containerId === 'creationsGrid';
    div.className = visualOnly
      ? (showImage
        ? 'card community-post-card community-post-card--visual feed-card-enter'
        : 'card community-post-card community-post-card--text feed-card-enter')
      : 'card community-post-card feed-card-enter';
    div.dataset.postId = post.id;
    if (post.sourceCardId) div.dataset.sourceCardId = post.sourceCardId;
    if (post.authorId) div.dataset.authorId = post.authorId;
    const liked = likedIds.has(post.id);
    const titleTrim = (post.title || '').trim();
    const hasRealTitle = titleTrim && !isGenericPostTitle(titleTrim);
    const storageAttr = feedImgStorageAttr(displayRef);
    const authorAttrs = ` data-author-id="${esc(post.authorId || '')}" data-source-card-id="${esc(post.sourceCardId || '')}"`;
    const imgSrc = showImage ? feedImgInitialSrc(displayRef, {
      assetId: post.sourceCardId || post.id,
      authorId: post.authorId,
      sourceCardId: post.sourceCardId
    }) : '';
    const imgLoading = showImage && (imgSrc === IMG_LOADING_PLACEHOLDER || !imgSrc);
    const eagerImg = cardOpts.eagerImage === true;
    const imgLoadAttrs = eagerImg
      ? ' loading="eager" fetchpriority="high" decoding="async"'
      : ' loading="lazy" decoding="async"';
    const mediaHtml = showImage
      ? `<div class="card-media${imgLoading ? ' is-loading' : ''}"${imgLoading ? ` data-shine-at="${Date.now()}"` : ''}><img class="card-img" src="${esc(imgSrc || IMG_LOADING_PLACEHOLDER)}" data-image-ref="${esc(displayRef)}"${storageAttr}${authorAttrs}${imgLoadAttrs} draggable="false" alt="" onload="if(typeof finishCardMediaShine==='function')finishCardMediaShine(this.closest('.card-media'))"></div>`
      : '';
    const timeLabel = communityLikeCountText(post.likes);
    const promptTrim = (post.prompt || '').trim();
    if (visualOnly) {
      if (showImage) {
        div.innerHTML = mediaHtml;
      } else {
        const titleLine = hasRealTitle
          ? `<div class="community-card-text-title">${esc(titleTrim)}</div>`
          : '';
        const previewSrc = hasRealTitle ? promptTrim : (titleTrim || promptTrim);
        const previewLine = previewSrc
          ? `<div class="community-card-text-preview">${esc(previewSrc.length > 120 ? `${previewSrc.slice(0, 120)}…` : previewSrc)}</div>`
          : '';
        div.innerHTML = `<div class="community-card-text-body">${titleLine}${previewLine}<div class="community-card-text-meta"><span class="card-time ${liked ? 'liked' : ''}">${esc(timeLabel)}</span></div></div>`;
      }
    } else {
      const headHtml = hasRealTitle
        ? `<div class="card-head"><div class="card-title">${esc(titleTrim)}</div><time class="card-time ${liked ? 'liked' : ''}">${esc(timeLabel)}</time></div>`
        : '';
      const descHtml = promptTrim ? `<div class="card-desc">${esc(promptTrim)}</div>` : '';
      const likeInTags = !hasRealTitle
        ? `<span class="card-time card-time-inline ${liked ? 'liked' : ''}">${esc(timeLabel)}</span>`
        : '';
      div.innerHTML = `
        ${mediaHtml}
        <div class="card-body">
          ${headHtml}
          ${descHtml}
          <div class="card-tags">${likeInTags}
            <button type="button" class="tag community-author-link" data-author-id="${esc(post.authorId)}" data-author-name="${esc(post.authorName)}">${esc(post.authorName)}</button>
          </div>
        </div>`;
    }
    div.addEventListener('click', (e) => {
      if (containerId === 'userProfileGrid') closeUserProfile();
      if (containerId === 'creationsGrid') {
        openPostSidePanel(post.id, 'creations', { post });
        return;
      }
      if (containerId === 'communityGrid') {
        if (isCommunityQuickPreviewActive()) {
          e.preventDefault();
          e.stopPropagation();
          void openCommunityAppreciateViewer(post);
          return;
        }
        openPostSidePanel(post.id, 'community', { post });
        return;
      }
      openPostSidePanel(post.id, 'community', { post });
    });
    const authorBtn = div.querySelector('.community-author-link');
    if (authorBtn) bindAuthorLink(authorBtn, post.authorId, post.authorName);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => div.classList.remove('feed-card-enter'));
    });
    return div;
  }

  function reconnectFeedPageObserver(containerId) {
    const container = document.getElementById(containerId);
    if (!container || !useFeedPagedRender(containerId)) return;
    ensureFeedPageSentinel(container);
    bindFeedPagedScroll(containerId);
  }

  function bindFeedPagedScroll(containerId) {
    if (!useFeedPagedRender(containerId)) return;
    const container = document.getElementById(containerId);
    if (!container) return;
    bindFeedScrollLock(containerId);
    container.__feedScrollLockRefresh?.();
    const scrollTargets = collectFeedScrollTargets(containerId, container);
    const scrollEl = resolveFeedPageIoRoot(containerId, container, scrollTargets) || scrollTargets[0] || container;

    async function drainFeedPages(maxPages = 8) {
      if (!canLoadMoreFeedPages(containerId)) return;
      logFeedPageDebug(containerId, 'drain_start', { maxPages });
      await drainCommunityFeedPages(containerId, maxPages);
      logFeedPageDebug(containerId, 'drain_end');
    }

    function onFeedScroll(target) {
      markFeedUserScrolling();
      releaseFeedScrollLock();
      if (target.scrollTop > 32) feedScrollIntent[containerId] = true;
      if (communityFeedPageLoading || !canLoadMoreFeedPages(containerId)) return;
      const nearBottom = isFeedNearBottom(target);
      if (!nearBottom) return;
      const now = Date.now();
      if (now - feedPageScrollThrottle < 180) return;
      feedPageScrollThrottle = now;
      void drainFeedPages(6);
    }

    container.__feedScrollTargets = container.__feedScrollTargets || new Set();
    scrollTargets.forEach((target) => {
      if (!target || container.__feedScrollTargets.has(target)) return;
      container.__feedScrollTargets.add(target);
      target.addEventListener('scroll', () => onFeedScroll(target), { passive: true });
      target.addEventListener('wheel', () => markFeedUserScrolling(), { passive: true });
    });
    feedPagedScrollBound[containerId] = true;

    ensureFeedPageSentinel(container);
    const sentinel = container.querySelector(':scope > .feed-page-sentinel');
    if (!sentinel) return;
    if (container.__feedPageIo) {
      container.__feedPageIo.disconnect();
      container.__feedPageIo = null;
    }
    const ioRoot = resolveFeedPageIoRoot(containerId, container, scrollTargets);
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      if (isFeedScrollLocked() || !canLoadMoreFeedPages(containerId)) return;
      const now = Date.now();
      if (now - feedPageScrollThrottle < 180) return;
      feedPageScrollThrottle = now;
      void drainFeedPages(4);
    }, { root: ioRoot, rootMargin: '420px 0px', threshold: 0 });
    io.observe(sentinel);
    container.__feedPageIo = io;
    container.__feedPageIoRoot = ioRoot;
    if (!container.dataset.feedPageDone && canLoadMoreFeedPages(containerId) && !feedScrollIntent[containerId]) {
      requestAnimationFrame(() => {
        if (!canLoadMoreFeedPages(containerId) || feedScrollIntent[containerId]) return;
        if (isFeedNearBottom(scrollEl) || isFeedNearBottom(container)) {
          void drainFeedPages(1);
        }
      });
    }
  }

  async function renderPostsIntoContainer(posts, containerId, opts = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.classList.remove('feed-grid-centered');
    const feedAppend = !!opts.feedAppend;
    const paginate = useFeedPagedRender(containerId);
    const sig = feedListSignature(posts, containerId);
    if (
      !feedAppend
      && container.dataset.feedSig === sig
      && hasRealCommunityFeedCards(container)
    ) {
      scrubStaleCommunityFeedEmpty(container);
      patchFeedLikeLabels(container, posts);
      const layoutReady = isCommunityFeedLayoutReady(container, containerId);
      if (!layoutReady && hasRealCommunityFeedCards(container)) {
        scheduleCommunityLayout(containerId, { force: true, immediate: true });
        layoutCommunityWhenImagesReady(containerId);
      } else if (container.classList.contains('feed-layout-pending')) {
        void softHydrateFeedContainer(container).then(() => {
          setFeedLayoutPending(containerId, false);
          scheduleCommunityLayout(containerId);
        });
      }
      if (paginate && (containerId === 'communityGrid' || containerId === 'creationsGrid')) {
        scheduleCommunityFeedInitialDrain(containerId);
      }
      return;
    }
    if (!feedAppend) {
      container.dataset.feedSig = sig;
      delete container.dataset.feedPageDone;
    }
    delete container.dataset.feedFinalized;
    const isProfile = containerId === 'userProfileGrid';
    const isCommunityFeed = containerId === 'communityGrid' || containerId === 'userProfileGrid';
    const renderPosts = isCommunityFeed ? posts.filter(isFeedRenderablePost) : posts;
    let postsToRender = renderPosts;
    if (paginate) {
      if (!feedAppend) {
        feedPagedStore[containerId] = { sig, posts: renderPosts, page: 1, remoteExhausted: false };
        postsToRender = renderPosts.slice(0, FEED_PER_PAGE);
      } else {
        const store = feedPagedStore[containerId];
        if (!store) return;
        if (Array.isArray(opts.feedAppendPosts) && opts.feedAppendPosts.length) {
          postsToRender = opts.feedAppendPosts;
        } else {
          const start = (store.page - 1) * FEED_PER_PAGE;
          postsToRender = store.posts.slice(start, start + FEED_PER_PAGE);
          if (containerId === 'communityGrid' || containerId === 'creationsGrid') {
            const seenDom = getCommunityFeedRenderedPostIds(containerId);
            postsToRender = postsToRender.filter((p) => !seenDom.has(String(p.id)));
          }
        }
        if (!postsToRender.length) return;
      }
    }
    if (containerId === 'communityGrid' && communitySidePostId && !feedAppend) {
      const stillThere = renderPosts.some((p) => p.id === communitySidePostId);
      if (!stillThere) closeCommunitySidePanel();
    }
    if (!feedAppend) {
      window.FeedLayout?.destroyLayout?.(containerId);
    }

    if (!postsToRender.length) {
      if (!feedAppend) {
        container.innerHTML = '<div class="feature-empty" style="grid-column:1/-1;padding:40px"><p>暂无已发布作品</p></div>';
      }
      return;
    }

    const imageRefs = postsToRender.map((p) => canonicalCommunityImageRef(p) || p.image).filter(Boolean);

    const inCommunityFeed =
      containerId === 'communityGrid' || containerId === 'creationsGrid' || containerId === 'userProfileGrid';
    if (inCommunityFeed && imageRefs.length) {
      const prefetchCap = Math.min(postsToRender.length, FEED_PER_PAGE);
      const prefetchItems = postsToRender.slice(0, prefetchCap).map((p) => ({
        id: p.sourceCardId || p.id,
        image: canonicalCommunityImageRef(p) || p.image,
        sourceCardId: p.sourceCardId,
        authorId: p.authorId
      }));
      const prefetchMs = feedAppend ? 8000 : 4000;
      const prefetchP = window.SupabaseSync?.prefetchCommunityDisplayUrls
        ? window.SupabaseSync.prefetchCommunityDisplayUrls(prefetchItems, prefetchMs)
        : Promise.resolve();
      try {
        await Promise.race([
          prefetchP,
          new Promise((r) => setTimeout(r, feedAppend ? 280 : 180))
        ]);
      } catch (e) { /* ignore */ }
      if (feedAppend) {
        void prefetchP.finally?.(() => {
          window.MediaPipeline?.patchContainerFromCache?.(container, { visibleFirst: true, max: FEED_PER_PAGE });
          window.CardImageLoader?.boostCommunityFeedImages?.(container, FEED_PER_PAGE);
        });
      }
    }

    const fragment = document.createDocumentFragment();
    const useGrid = useCssGridForCommunityFeed(containerId);
    if (!useGrid && !useCommunityCssGrid(containerId) && !feedAppend && !container.querySelector('.grid-sizer')) {
      const sizer = document.createElement('div');
      sizer.className = 'grid-sizer';
      fragment.appendChild(sizer);
    }

    const eagerCap = feedAppend ? postsToRender.length : (isMobileViewport() ? 24 : 18);
    const feedOrderBase = feedAppend ? countFeedDomUnique(containerId) : 0;
    postsToRender.forEach((post, idx) => {
      const cardEl = createCommunityFeedCard(post, containerId, { eagerImage: idx < eagerCap });
      cardEl.dataset.feedOrder = String(feedOrderBase + idx);
      fragment.appendChild(cardEl);
    });

    const appendedCards = [...fragment.querySelectorAll('.card')];
    const preservedImgs = !feedAppend && isMobileViewport() ? snapshotLoadedFeedImages(container) : new Map();
    if (!feedAppend) {
      container.innerHTML = '';
      delete container.dataset.feedFinalized;
      delete container.dataset.feedLayoutReady;
      delete container.dataset.feedDistributed;
      delete container.dataset.feedDistributedCols;
      delete container.dataset.feedLayoutCols;
      feedScrollIntent[containerId] = false;
      setFeedLayoutPending(containerId, true);
    }
    if (feedAppend && paginate) {
      const renderGen = ++communityFeedRenderGen;
      const scrollEl = getFeedScrollRoot(container) || container;
      const prevScrollTop = scrollEl.scrollTop;
      purgeCommunityFeedGridNoise(container);
      container.appendChild(fragment);
      appendFeedCardsLayout(containerId, appendedCards);
      requestAnimationFrame(() => {
        safeApplyFeedScrollTop(scrollEl, prevScrollTop);
        finishCommunityFeedLayoutAfterBatch(containerId);
      });
      bindFeedPagedScroll(containerId);
      ensureFeedPageSentinel(container);
      restoreLoadedFeedImages(container, preservedImgs);
      window.MediaPipeline?.patchContainerFromCache?.(container);
      window.CardImageLoader?.observeContainer?.(container);
      window.CardImageLoader?.boostCommunityFeedImages?.(container, FEED_PER_PAGE);
      container.querySelectorAll('.card-media img.card-img').forEach((img) => {
        const src = img.currentSrc || img.src || '';
        if (img.complete && img.naturalWidth > 8 && src.startsWith('http') && !src.includes('data:image/svg')) {
          window.finishCardMediaShine?.(img.closest('.card-media'));
        }
      });
      container.classList.add('cards-grid-primed');
      if (!window.__PH_FEED_BULK_DRAIN__) {
        void softHydrateFeedContainer(container).then(() => {
          if (renderGen !== communityFeedRenderGen) return;
          ensureFeedPageSentinel(container);
          finishCommunityFeedLayoutAfterBatch(containerId);
        });
      }
      return;
    }
    container.appendChild(fragment);
    bindFeedPagedScroll(containerId);
    ensureFeedPageSentinel(container);
    restoreLoadedFeedImages(container, preservedImgs);
    window.MediaPipeline?.patchContainerFromCache?.(container);
    window.CardImageLoader?.observeContainer?.(container);
    window.CardImageLoader?.boostCommunityFeedImages?.(container, FEED_PER_PAGE);
    container.querySelectorAll('.card-media img.card-img').forEach((img) => {
      const src = img.currentSrc || img.src || '';
      if (img.complete && img.naturalWidth > 8 && src.startsWith('http') && !src.includes('data:image/svg')) {
        window.finishCardMediaShine?.(img.closest('.card-media'));
      }
    });
    container.classList.add('cards-grid-primed');
    if (useGrid) container.classList.add('community-mobile-feed');
    runCommunityFeedLayoutPass(containerId);
    const renderGen = ++communityFeedRenderGen;
    const finishLayout = () => {
      if (renderGen !== communityFeedRenderGen) return;
      layoutCommunityWhenImagesReady(containerId);
    };
    if (useCssGridForCommunityFeed(containerId)) {
      setFeedLayoutPending(containerId, false);
    }
    finishLayout();
    void (async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (renderGen !== communityFeedRenderGen) return;
      ensureCommunityFeedColumnLayout(containerId);
      if (!runCommunityFeedLayoutPass(containerId)) {
        scheduleCommunityLayout(containerId, { force: true, immediate: true });
      }
      if (!feedAppend && paginate && (containerId === 'communityGrid' || containerId === 'creationsGrid')) {
        const store = feedPagedStore[containerId];
        if (store?.posts?.length > FEED_PER_PAGE && !window.__PH_FEED_BULK_DRAIN__ && !feedScrollIntent[containerId]) {
          void drainCommunityFeedPages(containerId, 1);
        }
      }
      await new Promise((r) => requestAnimationFrame(r));
      if (renderGen !== communityFeedRenderGen) return;
      window.MediaPipeline?.patchContainerFromCache?.(container);
      window.CardImageLoader?.observeContainer?.(container);
      window.CardImageLoader?.boostCommunityFeedImages?.(container, FEED_PER_PAGE);
      const mobile = isMobileViewport();
      const prefetchCap = mobile ? 24 : 40;
      const cardLike = posts.map((p) => ({
        id: p.sourceCardId || p.id,
        image: canonicalCommunityImageRef(p) || p.image,
        sourceCardId: p.sourceCardId,
        authorId: p.authorId
      }));
      const uid = window.SupabaseSync?.getUserId?.();
      if (uid && window.SupabaseSync?.backfillGridThumbsForCards) {
        const ownCards = (window.__promptHubCards || []).filter((c) => {
          if (!c?.image || !c?.publishedToCommunity) return false;
          const path = window.SupabaseSync?.storagePathFromRef?.(c.image);
          return path && window.SupabaseSync?.storagePathOwnedByCurrentUser?.(path);
        }).slice(0, 24);
        if (ownCards.length) {
          void window.SupabaseSync.backfillGridThumbsForCards(ownCards, {
            max: ownCards.length,
            force: true,
            quiet: true,
            awaitDrain: false
          });
        }
      }
      const inCommunityFeed =
        containerId === 'communityGrid' || containerId === 'creationsGrid' || containerId === 'userProfileGrid';
      const prefetchP = inCommunityFeed && imageRefs.length && window.SupabaseSync?.prefetchCommunityDisplayUrls
        ? window.SupabaseSync.prefetchCommunityDisplayUrls(cardLike.slice(0, prefetchCap), mobile ? 5000 : 5500)
        : imageRefs.length && window.SupabaseSync?.prefetchDisplayUrlsWithCap
          ? window.SupabaseSync.prefetchDisplayUrlsWithCap(imageRefs.slice(0, prefetchCap), mobile ? 4500 : 5500)
          : Promise.resolve();
      void prefetchP.catch(() => {});
      const hydrateP = hydrateFeedImages(container);
      await Promise.race([
        Promise.all([hydrateP, prefetchP]),
        new Promise((r) => setTimeout(r, mobile ? 3200 : 2600))
      ]);
      if (renderGen !== communityFeedRenderGen) return;
      window.MediaPipeline?.patchContainerFromCache?.(container);
      window.CardImageLoader?.observeContainer?.(container);
      window.CardImageLoader?.boostCommunityFeedImages?.(container, FEED_PER_PAGE);
      finalizeFeedContainer(container, containerId);
      finishLayout();
      void hydrateP.then(() => {
        if (renderGen !== communityFeedRenderGen) return;
        window.MediaPipeline?.patchContainerFromCache?.(container);
        window.CardImageLoader?.observeContainer?.(container);
      });
    })();
  }

  function shuffleCommunityPosts(posts) {
    const list = Array.isArray(posts) ? posts : [];
    if (!list.length) return list;
    const seenKeys = new Map();
    const keyed = list.map((p, idx) => {
      const base = stablePostSortKey(p) || `idx:${idx}`;
      const n = seenKeys.get(base) || 0;
      seenKeys.set(base, n + 1);
      return { post: p, key: `${base}#${n}` };
    });
    const idSig = keyed.map((x) => x.key).sort().join('|');
    if (!communityRandomOrder || communityRandomSig !== idSig || communityRandomOrder.size !== keyed.length) {
      const shuffled = [...keyed];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      communityRandomOrder = new Map();
      shuffled.forEach((item, idx) => communityRandomOrder.set(item.key, idx));
      communityRandomSig = idSig;
    }
    return keyed
      .sort((a, b) => {
        const ai = communityRandomOrder.get(a.key) ?? 0;
        const bi = communityRandomOrder.get(b.key) ?? 0;
        return (ai - bi) || compareStablePostKey(a.post, b.post);
      })
      .map((x) => x.post);
  }

  function applyCommunitySort(mode) {
    const next = mode || 'random';
    if (next === 'random') {
      communityRandomOrder = new Map();
      communityRandomSig = '';
      communityRandomEpoch += 1;
    }
    delete feedPagedStore.communityGrid;
    delete feedPagedStore.creationsGrid;
    const grid = document.getElementById('communityGrid');
    if (grid) {
      delete grid.dataset.feedSig;
      delete grid.dataset.feedPageDone;
    }
    communitySort = next;
    document.querySelectorAll('[data-community-sort]').forEach((b) => {
      b.classList.toggle('active', (b.dataset.communitySort || 'random') === communitySort);
    });
    document.querySelectorAll('[data-imagegen-community-sort]').forEach((b) => {
      b.classList.toggle('active', (b.dataset.imagegenCommunitySort || 'random') === communitySort);
    });
  }

  function filterAndSortPosts(list) {
    if (communityScope === 'curated') return [];
    const q = (document.getElementById('communitySearch')?.value || '').toLowerCase();
    let filtered = [...list];
    if (q) {
      filtered = filtered.filter(p =>
        (p.title || '').toLowerCase().includes(q) ||
        (p.prompt || '').toLowerCase().includes(q) ||
        (p.authorName || '').toLowerCase().includes(q)
      );
    }
    if (communityScope === 'following') {
      filtered = filtered.filter(p => follows.has(String(p.authorId)));
    }
    if (communitySort === 'new') {
      filtered.sort(comparePostsByActivityDesc);
    } else if (communitySort === 'hot') {
      filtered.sort(comparePostsByLikesDesc);
    } else {
      filtered = shuffleCommunityPosts(filtered);
    }
    return filtered;
  }

  let renderCommunityTimer = null;
  function renderCommunity(opts = {}) {
    if (opts.skipFeedFetch === undefined && publicFeedState.at > 0 && Date.now() - publicFeedState.at < PUBLIC_FEED_TTL_MS) {
      opts = { ...opts, skipFeedFetch: true };
    }
    if (opts.immediate) {
      clearTimeout(renderCommunityTimer);
      renderCommunityNow(opts);
      return;
    }
    clearTimeout(renderCommunityTimer);
    renderCommunityTimer = setTimeout(() => renderCommunityNow(opts), 120);
  }

  async function refreshRemoteNotifications() {
    if (!window.getCommunityNotificationsEnabled?.()) return;
    if (!window.PromptHubApi?.fetchCommunityNotifications) return;
    try {
      const r = await window.PromptHubApi.fetchCommunityNotifications({ limit: 40 });
      if (!r?.ok || !Array.isArray(r.data?.items)) return;
      const user = getActiveUser();
      if (user.id === 'guest') return;
      let changed = false;
      for (const n of r.data.items) {
        if (!n?.id) continue;
        const existing = notifications.find((x) => x.id === n.id);
        if (existing) {
          const wasRead = existing.read;
          existing.read = !!(existing.read || n.read);
          if (existing.read !== wasRead) changed = true;
          continue;
        }
        const key = notifyDedupeKey(n);
        const dup = key ? notifications.find((x) => notifyDedupeKey(x) === key) : null;
        if (dup) {
          const wasRead = dup.read;
          dup.read = !!(dup.read || n.read);
          if (dup.read !== wasRead) changed = true;
          continue;
        }
        notifications.unshift({
          id: n.id,
          type: n.type,
          actorId: n.actorId,
          actorName: n.actorName || '用户',
          postId: n.postId || null,
          postTitle: n.postTitle || '',
          message: n.message || formatNotifyMessage(n),
          read: !!n.read,
          createdAt: n.createdAt || Date.now()
        });
        changed = true;
      }
      if (changed) {
        notifications = notifications.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 100);
        persistNotifications();
        updateNotifyBadge();
      }
    } catch (e) {
      console.warn('[community] fetch notifications failed', e);
    }
  }

  function renderCommunityNow(opts = {}) {
    const container = document.getElementById('communityGrid');
    if (!container) return;
    if (communityScope === 'curated') {
      invalidateCommunityFeedRender();
      closeCommunitySidePanel();
      if (communityAppreciateActive) exitCommunityAppreciate(true);
      setFeedGridEmpty(
        container,
        `<div class="feature-empty community-curated-placeholder">
        <p>社区精选</p>
        <p class="panel-hint">正在开发中。未来将按使用场景展示官方与精选创作者挑选的提示词与例图；轻量会员及以上可查看（现阶段计划限免开放）。</p>
      </div>`
      );
      return;
    }
    const gen = ++communityFeedRenderGen;
    if (!opts.skipFeedFetch) {
      hydratePublicFeedFromCache();
      const feedStale = publicFeedNeedsFullRefresh();
      if ((publicFeedState.at === 0 || publicFeedState.posts.length < PUBLIC_FEED_MIN_READY) && !publicFeedState.loading) {
        showCommunityFeedSkeleton(container, 8);
        void refreshPublicCommunityFeed({ force: true, timeoutMs: 15000 }).then(async () => {
          if (gen !== communityFeedRenderGen) return;
          if (communityScope === 'curated') return;
          if (publicFeedState.at === 0) {
            setFeedGridEmpty(
              container,
              '<div class="feature-empty community-feed-empty"><p>社区加载失败</p><button type="button" class="btn btn-ghost btn-sm" onclick="renderCommunity({ immediate: true, forceRepaint: true })">重试</button></div>'
            );
            return;
          }
          const sortedAfterFetch = filterAndSortPosts(getCommunityFeedForDisplay());
          if (shouldPreserveCommunityFeedDom('communityGrid', sortedAfterFetch)) {
            await growCommunityFeedAfterPublicRefresh('communityGrid');
            return;
          }
          renderCommunityNow({ skipFeedFetch: true, forceRepaint: true });
        });
        return;
      }
      if (feedStale && !publicFeedState.loading) {
        void refreshPublicCommunityFeed({ force: true, timeoutMs: 15000 }).then(async (changed) => {
          if (gen !== communityFeedRenderGen) return;
          if (communityScope === 'curated') return;
          if (!changed) return;
          const grid = document.getElementById('communityGrid');
          const sorted = filterAndSortPosts(getCommunityFeedForDisplay());
          patchFeedLikeLabels(grid, sorted);
          if (shouldPreserveCommunityFeedDom('communityGrid', sorted)) {
            await growCommunityFeedAfterPublicRefresh('communityGrid');
            return;
          }
          renderCommunityNow({ skipFeedFetch: true, forceRepaint: true });
        });
      }
    }
    let list = filterAndSortPosts(getCommunityFeedForDisplay());
    const earlySig = feedListSignature(list, 'communityGrid');
    if (
      !opts.forceRepaint
      && container.dataset.feedSig === earlySig
      && container.querySelector('.community-post-card')
    ) {
      scrubStaleCommunityFeedEmpty(container);
      patchFeedLikeLabels(container, list);
      const layoutReady = isCommunityFeedLayoutReady(container, 'communityGrid');
      if (!layoutReady && container.querySelector('.community-post-card')) {
        settleCommunityFeedLayout('communityGrid', { recalcCols: true });
      } else {
        settleCommunityFeedLayout('communityGrid', { fromImage: true });
      }
      if (window.SupabaseSync?.isLoggedIn?.()) void refreshRemoteNotifications();
      return;
    }
    if (window.SupabaseSync?.isLoggedIn?.()) {
      maybeReconcileCommunityWithCards(window.__promptHubCards || []);
      ensureCommunityFromCardsThrottled(!!opts.syncFromCards);
      void refreshRemoteNotifications();
      list = filterAndSortPosts(getCommunityFeedForDisplay());
    } else if (window.__promptHubCards?.length) {
      ensureCommunityFromCardsThrottled(false);
      list = filterAndSortPosts(getCommunityFeedForDisplay());
    }
    const guestUser = getActiveUser().id === 'guest';
    const loggedInUser = window.SupabaseSync?.isLoggedIn?.();
    if (!list.length && (guestUser || loggedInUser) && (publicFeedState.loading || !publicFeedState.at)) {
      showCommunityFeedSkeleton(container, 6);
      return;
    }
    if (!list.length) {
      window.FeedLayout?.destroyLayout?.('communityGrid');
      window.FeedLayout?.resetGridClasses?.(container);
      const cardN = (window.__promptHubCards || []).length;
      if (window.SupabaseSync?.isLoggedIn?.() && communityScope === 'all' && cardN > 0) {
        scheduleCommunityHydrateOnce();
      }
      const emptyMsg = communityScope === 'following'
        ? (cardN === 0
          ? '「我的关注」只显示你关注的作者；卡片库为空时请先恢复卡片'
          : '暂无关注作者的作品，去「全部作品」点头像关注作者吧')
        : cardN === 0
          ? '卡片库暂无作品，因此社区里也没有你的发布记录'
          : '暂无社区内容';
      const restoreCardsBtn = window.SupabaseSync?.isLoggedIn?.() && cardN === 0
        ? '<button type="button" class="btn btn-secondary" onclick="syncCloudNow()">从云端恢复卡片库</button>'
        : '';
      const rateHint = publicFeedState.loading
        ? '<p class="panel-hint">正在加载全站社区内容…</p>'
        : (loadPublicFeedCache()?.posts?.length
          ? '<p class="panel-hint">社区列表加载受限，已显示缓存；请稍后再刷新</p>'
          : '<p class="panel-hint">正在加载全站社区内容…若长时间空白，请稍后再试（勿连续强刷）</p>');
      const cardHint = cardN === 0
        ? '<p class="panel-hint">若你之前发布过作品：请到「设置」→「恢复备份」，或点下方「从云端恢复卡片库」。</p>'
        : '<p class="panel-hint">发布到社区的作品会进入全站 Feed（提示词至少 15 字）。在卡片库打开「发布到社区」开关即可。</p>';
      setFeedGridEmpty(
        container,
        `<div class="feature-empty"><p>${emptyMsg}</p>${rateHint}${cardHint}<button type="button" class="btn btn-primary" onclick="switchAppPage('warehouse')">去卡片库</button>${restoreCardsBtn}</div>`
      );
      return;
    }
    const sig = feedListSignature(list, 'communityGrid');
    if (
      !opts.forceRepaint
      && container.dataset.feedSig === sig
      && container.querySelector('.community-post-card')
    ) {
      scrubStaleCommunityFeedEmpty(container);
      patchFeedLikeLabels(container, list);
      const layoutReady2 = container.classList.contains('masonry-ready')
        || container.querySelector(':scope > .community-feed-col');
      if (!layoutReady2 && container.querySelector('.community-post-card')) {
        settleCommunityFeedLayout('communityGrid', { recalcCols: true });
      } else {
        settleCommunityFeedLayout('communityGrid', { fromImage: true });
      }
      return;
    }
    if (
      !opts.forceRepaint
      && shouldPreserveCommunityFeedDom('communityGrid', list)
      && container.querySelector('.community-post-card')
    ) {
      scrubStaleCommunityFeedEmpty(container);
      patchFeedLikeLabels(container, list);
      void growCommunityFeedAfterPublicRefresh('communityGrid');
      settleCommunityFeedLayout('communityGrid', { recalcCols: true });
      if (window.SupabaseSync?.isLoggedIn?.()) void refreshRemoteNotifications();
      return;
    }
    void renderPostsIntoContainer(list, 'communityGrid').then(() => {
      if (!feedScrollIntent.communityGrid) {
        void drainCommunityFeedPages('communityGrid', 1);
      }
    });
  }

  function renderUserProfileGrid() {
    if (!openProfileAuthorId) return;
    const posts = getPostsByAuthor(openProfileAuthorId);
    posts.sort(comparePostsByCreatedDesc);
    void renderPostsIntoContainer(posts, 'userProfileGrid');
  }

  function openUserProfile(authorId, authorName) {
    if (!authorId) return;
    openProfileAuthorId = authorId;
    const posts = getPostsByAuthor(authorId);
    const newestName = posts.reduce(
      (best, p) => {
        const ts = p.updatedAt || p.createdAt || 0;
        if (p.authorName && ts >= best.ts) return { name: p.authorName, ts };
        return best;
      },
      { name: authorName || '用户', ts: 0 }

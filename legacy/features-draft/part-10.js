      if (cre?.jobId) galleryJobId = String(cre.jobId).replace(/#\d+$/, '');
      const gallery = buildCreationGallery(cre);
      if (gallery.length > 1) mjGalleryUrls = gallery;
    } else if (kind === 'warehouse' && assetId) {
      const full = (window.__promptHubCards || []).find((c) => c.id === assetId);
      galleryJobId = window.PromptHubCardGallery?.resolveGenJobIdFromCard?.(full)
        || (full?.genJobId ? String(full.genJobId).replace(/#\d+$/, '') : null);
      const gallery = window.PromptHubCardGallery?.normalizeCardGallery?.(full) || [];
      if (gallery.length > 1) mjGalleryUrls = gallery;
      if (!mjGalleryUrls?.length && full?.isMidjourney && Array.isArray(full.mjGridUrls) && full.mjGridUrls.length > 1) {
        mjGalleryUrls = full.mjGridUrls.filter(Boolean).slice(0, 5);
      }
      if (!mjGalleryUrls?.length && full?.genJobId && window.PromptHubApi?.getGenerationJob) {
        try {
          const poll = await window.PromptHubApi.getGenerationJob(normalizeMjParentJobId(full.genJobId));
          if (poll?.ok) {
            const parsed = resolveMjPollImages(poll);
            if (parsed.gallery?.length > 1 || parsed.tiles.length > 1) {
              mjGalleryUrls = parsed.gallery?.length ? parsed.gallery : parsed.tiles;
              await repairMjWarehouseCardFields(full, {
                mjGridUrls: parsed.tiles,
                mjCompositeUrl: parsed.composite,
                mjButtons: poll.data.mjButtons
              });
            }
          }
        } catch (e) {
          console.warn('[imagegen] mj lightbox grid fetch failed', e);
        }
      }
    }
    const startIdx = 0;
    const lbOpts = {
      imageGen: true,
      feedKey,
      community: kind === 'community',
      postId: kind === 'community' ? id : null,
      cardId: kind === 'warehouse' ? assetId : (kind === 'recent' ? assetId : null),
      preferFull: true,
      mjGalleryUrls: mjGalleryUrls || undefined,
      mjGalleryIndex: startIdx,
      cardJobId: galleryJobId || undefined,
      mjJobId: galleryJobId || undefined,
      fallbackSrc: window.MediaPipeline?.gridUrlFromImgEl?.(imgEl) || ''
    };
    if (typeof window.openLightbox !== 'function') return;
    if (mjGalleryUrls?.length) {
      const startRef = mjGalleryUrls[startIdx];
      let startSrc = startRef;
      if (window.PromptHubCardGallery?.resolveMediaUrl) {
        try {
          startSrc = await window.PromptHubCardGallery.resolveMediaUrl(startRef, {
            cardId: lbOpts.cardId,
            jobId: galleryJobId || undefined,
            galleryIndex: startIdx,
            preferFull: true
          }) || startRef;
        } catch (e) { /* keep raw ref */ }
      }
      if (!/^(https?:|blob:|data:image\/)/i.test(String(startSrc || '')) || String(startSrc).includes('data:image/svg')) {
        startSrc = fullUrlFromImgEl(imgEl) || lbOpts.fallbackSrc || '';
      }
      if (!startSrc || String(startSrc).includes('data:image/svg')) {
        window.openLightbox('', { ...lbOpts, pending: true });
        toast('原图加载中，请稍后再试');
        return;
      }
      window.openLightbox(startSrc, lbOpts);
      return;
    }
    const instant = fullUrlFromImgEl(imgEl);
    if (instant) {
      window.openLightbox(instant, lbOpts);
      return;
    }
    window.openLightbox('', { ...lbOpts, pending: true });
    const url = await resolveImageGenFullUrl(kind, id, feedKey, imgEl);
    if (url && !String(url).startsWith('data:image/svg')) {
      window.setLightboxSrc?.(url, lbOpts);
      return;
    }
    window.closeLightbox?.();
    toast('原图加载中，请稍后再试');
  }


  function formatExpiryLabel(c) {
    if (c.permanent || c.visibility === 'published') return '永久保留';
    if (!c.expiresAt) return '';
    const left = c.expiresAt - Date.now();
    if (left <= 0) return '已过期';
    const h = Math.ceil(left / 3600000);
    const timeLabel = h < 24 ? `约 ${h} 小时后清理` : `约 ${Math.ceil(h / 24)} 天后清理`;
    return timeLabel;
  }

  function bindUI() {
    initImageGenSegmentGliders();
    document.getElementById('communitySearch')?.addEventListener('input', () => renderCommunity());
    const communitySearch = document.getElementById('communitySearch');
    if (communitySearch && !communitySearch.dataset.searchBound) {
      communitySearch.dataset.searchBound = '1';
      const commitCommunitySearch = () => {
        renderCommunity({ skipFeedFetch: true, forceRepaint: true });
        communitySearch.blur();
      };
      communitySearch.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        commitCommunitySearch();
      });
      communitySearch.addEventListener('search', (e) => {
        e.preventDefault();
        commitCommunitySearch();
      });
    }
    document.querySelectorAll('[data-community-sort]').forEach(btn => {
      btn.addEventListener('click', () => {
        applyCommunitySort(btn.dataset.communitySort);
        renderCommunity({ skipFeedFetch: true, forceRepaint: true });
        if (document.getElementById('pageImageGen')?.classList.contains('active')) renderImageGenFeed({ preserveScroll: true });
      });
    });
    document.querySelectorAll('[data-community-scope]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nextScope = btn.dataset.communityScope || 'all';
        if (nextScope === 'curated') {
          communityScope = 'curated';
          invalidateCommunityFeedRender();
          document.querySelectorAll('[data-community-scope]').forEach(b => {
            b.classList.toggle('active', b === btn);
          });
          document.querySelectorAll('[data-imagegen-community-scope]').forEach(b => {
            b.classList.toggle('active', (b.dataset.imagegenCommunityScope || 'all') === communityScope);
          });
          closeCommunitySidePanel();
          renderCommunity({ immediate: true, skipFeedFetch: true, forceRepaint: true });
          toast('社区精选正在开发中，敬请期待');
          return;
        }
        communityScope = nextScope;
        invalidateCommunityFeedRender();
        const grid = document.getElementById('communityGrid');
        if (grid) delete grid.dataset.feedSig;
        document.querySelectorAll('[data-community-scope]').forEach(b => {
          b.classList.toggle('active', b === btn);
        });
        document.querySelectorAll('[data-imagegen-community-scope]').forEach(b => {
          b.classList.toggle('active', (b.dataset.imagegenCommunityScope || 'all') === communityScope);
        });
        closeCommunitySidePanel();
        if (communityScope === 'following' && follows.size === 0) {
          toast('暂无关注作者，点击作品上的作者名可关注');
        }
        renderCommunity({ skipFeedFetch: true, forceRepaint: true });
        if (document.getElementById('pageImageGen')?.classList.contains('active')) renderImageGenFeed({ preserveScroll: true });
      });
    });
    document.getElementById('communityNotifyBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleNotifyPanel();
    });
    document.getElementById('communityNotifyMarkRead')?.addEventListener('click', markAllNotificationsRead);
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('communityNotifyPanel');
      if (!panel || panel.classList.contains('hidden')) return;
      if (e.target.closest('#communityNotifyPanel, #communityNotifyBtn')) return;
      closeNotifyPanel();
    });
    document.getElementById('communitySideClose')?.addEventListener('click', closeCommunitySidePanel);
    document.getElementById('creationsSideClose')?.addEventListener('click', closeCreationsSidePanel);
    bindPublishToggle();
    const onCardPromptInput = () => syncCardPublishFromPrompt(getCardFormPromptText());
    document.getElementById('cardPrompt')?.addEventListener('input', onCardPromptInput);
    document.getElementById('floatingPromptText')?.addEventListener('input', onCardPromptInput);
    document.getElementById('imageGenPrompt')?.addEventListener('input', syncImageGenGenPublicFromPrompt);
    document.getElementById('userProfileClose')?.addEventListener('click', closeUserProfile);
    document.getElementById('userProfileBack')?.addEventListener('click', closeUserProfile);
    document.getElementById('userProfileOverlay')?.addEventListener('click', e => {
      if (e.target.id === 'userProfileOverlay') closeUserProfile();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.getElementById('userProfileOverlay')?.classList.contains('active')) {
        closeUserProfile();
      }
    });
    document.getElementById('imageGenSubmit')?.addEventListener('click', () => {
      void runImageGenDemo().catch((e) => {
        console.error('[imagegen] submit click failed', e);
        const msg = String(e?.message || '');
        const hint = /store is not defined/i.test(msg)
          ? '页面脚本版本不一致，请强刷（Ctrl+Shift+R）'
          : '生图提交异常，请刷新页面后重试';
        toast(hint);
        resetImageGenSubmitState();
      });
    });
    document.getElementById('imageGenResolution')?.addEventListener('change', () => {
      syncImageGenModelToResolution();
      updateImageGenResolutionSelect();
      updateImageGenPricingUI();
    });
    document.querySelectorAll('[data-feed-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        imageGenFeedTab = btn.dataset.feedTab;
        document.querySelectorAll('[data-feed-tab]').forEach(b => b.classList.toggle('active', b === btn));
        closeImageGenPreview();
        updateImageGenFeedHint();
        syncImageGenWarehouseFiltersUI();
        syncImageGenCommunityFiltersUI();
        imageGenFeedPagedStore = null;
        renderImageGenFeed({ scrollToTop: true, force: true });
      });
    });
    document.querySelectorAll('[data-imagegen-community-sort]').forEach(btn => {
      btn.addEventListener('click', () => {
        applyCommunitySort(btn.dataset.imagegenCommunitySort);
        document.querySelectorAll('[data-imagegen-community-sort]').forEach(b => b.classList.toggle('active', b === btn));
        renderImageGenFeed({ scrollToTop: true, force: true });
        if (document.getElementById('pageCommunity')?.classList.contains('active')) {
          renderCommunity({ skipFeedFetch: true, forceRepaint: true });
        }
      });
    });
    document.querySelectorAll('[data-imagegen-community-scope]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nextScope = btn.dataset.imagegenCommunityScope || 'all';
        if (nextScope === 'curated') {
          communityScope = 'curated';
          invalidateCommunityFeedRender();
          document.querySelectorAll('[data-imagegen-community-scope]').forEach(b => b.classList.toggle('active', b === btn));
          document.querySelectorAll('[data-community-scope]').forEach(b => {
            b.classList.toggle('active', (b.dataset.communityScope || 'all') === communityScope);
          });
          renderImageGenFeed({ scrollToTop: true, force: true });
          if (document.getElementById('pageCommunity')?.classList.contains('active')) {
            renderCommunity({ immediate: true, skipFeedFetch: true, forceRepaint: true });
          }
          toast('社区精选正在开发中，敬请期待');
          return;
        }
        communityScope = nextScope;
        invalidateCommunityFeedRender();
        document.querySelectorAll('[data-imagegen-community-scope]').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('[data-community-scope]').forEach(b => {
          b.classList.toggle('active', (b.dataset.communityScope || 'all') === communityScope);
        });
        renderImageGenFeed({ scrollToTop: true, force: true });
        if (document.getElementById('pageCommunity')?.classList.contains('active')) {
          renderCommunity({ immediate: true, skipFeedFetch: true, forceRepaint: true });
        }
      });
    });
    document.getElementById('imageGenPreviewClose')?.addEventListener('click', closeImageGenPreview);
    bindImageGenPreviewActions();
    bindImageGenPreviewWheelScroll();
    bindImageGenFeedPagedScroll();
    bindImageGenFeedResizeRelayout?.();
    document.getElementById('appreciateViewerFavBtn')?.addEventListener('click', () => {
      if (!appreciateViewerPostId) return;
      const post = findPost(appreciateViewerPostId);
      if (!post) return;
      favoritePost(appreciateViewerPostId, post);
      window.markQuickPreviewTask?.({ communityFavorited: true });
      const btn = document.getElementById('appreciateViewerFavBtn');
      if (btn && favIds.has(appreciateViewerPostId)) {
        const label = btn.querySelector('span');
        if (label) label.textContent = '已收藏';
        else btn.textContent = '已收藏';
        btn.disabled = true;
      }
    });
    document.getElementById('lightboxCollectBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const postId = window.__lightboxCommunityPostId;
      if (!postId) return;
      const post = findPost(postId);
      if (!post) return;
      favoritePost(postId, post);
      window.markQuickPreviewTask?.({ communityFavorited: true });
      window.syncLightboxActions?.({ community: true, postId });
    });
    document.getElementById('imageGenWhGroup')?.addEventListener('change', e => {
      imageGenWhGroup = e.target.value || 'all';
      renderImageGenFeed({ scrollToTop: true, force: true });
    });
    document.getElementById('imageGenWhTag')?.addEventListener('change', e => {
      imageGenWhTag = e.target.value || 'all';
      renderImageGenFeed({ scrollToTop: true, force: true });
    });
    bindImageGenWarehouseFilterMobileUI();
    bindImageGenUpload();
    bindImageGenPromptTools();
    document.getElementById('imageGenRecoverBtn')?.remove();
    bindImageGenCountPicker();
    document.getElementById('imageGenBatchSplit')?.addEventListener('change', updateImageGenCostHint);
    document.getElementById('imageGenModel')?.addEventListener('change', scheduleImageGenModelUiRefresh);
    document.querySelectorAll('[data-mj-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mjMode;
        if (!mode) return;
        setImageGenMjMode(mode);
      });
    });
    bindImageGenModelFamilyTabs();
    document.getElementById('imageGenMjSpeedSelect')?.addEventListener('change', () => {
      persistImageGenMjPrefs();
      updateImageGenCostHint();
    });
    document.getElementById('imageGenMjSpeedSelect')?.addEventListener('change', persistImageGenMjPrefs);
    bindImageGenMjExtras();
    bindImageGenCardTitle();
    document.getElementById('imageGenMjSaveAllTiles')?.addEventListener('change', () => {
      syncImageGenMjToggleCheckedClasses();
      persistImageGenMjPrefs();
    });
    document.getElementById('imageGenResolution')?.addEventListener('change', updateImageGenCostHint);
    document.getElementById('imageGenQuality')?.addEventListener('change', updateImageGenCostHint);
    document.getElementById('imageGenSize')?.addEventListener('change', updateImageGenCostHint);
    bindImageGenMjRange('imageGenMjStylize', 'imageGenMjStylizeVal');
    bindImageGenMjRange('imageGenMjChaos', 'imageGenMjChaosVal');
    bindImageGenMjRange('imageGenMjWeird', 'imageGenMjWeirdVal');
    bindImageGenMjRange('imageGenMjIw', 'imageGenMjIwVal');
    window.addEventListener('resize', () => {
      ensureFeatureSidePanelDocked('communitySidePanel');
      if (!document.getElementById('creationsSidePanel')?.classList.contains('hidden')) {
        syncCreationsSidePanelMount();
      } else {
        unmountFeatureSidePanel('creationsSidePanel');
        ensureFeatureSidePanelDocked('creationsSidePanel');
      }
      syncCommunityPanelOpenClass();
      if (document.getElementById('pageCommunity')?.classList.contains('active')) {
        scheduleCommunityLayout('communityGrid');
      }
      if (document.getElementById('pageCreations')?.classList.contains('active')) {
        scheduleCommunityLayout('creationsGrid');
      }
      if (document.getElementById('pageImageGen')?.classList.contains('active')) {
        scheduleImageGenFeedLayout();
      }
      if (document.getElementById('userProfileOverlay')?.classList.contains('active')) {
        scheduleCommunityLayout('userProfileGrid');
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (document.getElementById('userProfileOverlay')?.classList.contains('active')) closeUserProfile();
      else if (imageGenPreviewId) closeImageGenPreview();
      else if (communitySidePostId && document.getElementById('pageCreations')?.classList.contains('active')) closeCreationsSidePanel();
      else if (!document.getElementById('communitySidePanel')?.classList.contains('hidden')) closeCommunitySidePanel();
    });
  }

  let communityOnActivateTimer = null;
  let communityOnActivateSeq = 0;

  function cancelCommunityPageWork() {
    communityFeedRenderGen += 1;
    clearTimeout(renderCommunityTimer);
    clearTimeout(communityOnActivateTimer);
    communityOnActivateSeq += 1;
  }

  function deferCommunityIdle(fn, timeoutMs = 2500) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(fn, { timeout: timeoutMs });
    } else {
      setTimeout(fn, 400);
    }
  }

  function activateCommunityPage() {
    const seq = ++communityOnActivateSeq;
    clearTimeout(communityOnActivateTimer);
    communityOnActivateTimer = setTimeout(() => {
      if (seq !== communityOnActivateSeq) return;
      if (!document.getElementById('pageCommunity')?.classList.contains('active')) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (seq !== communityOnActivateSeq) return;
          if (!document.getElementById('pageCommunity')?.classList.contains('active')) return;
          const grid = document.getElementById('communityGrid');
          window.FeedLayout?.repairCommunityMasonry?.('communityGrid');
          hydratePublicFeedFromCache();
          const hasRealCards = grid?.querySelector('.community-post-card:not(.community-feed-skeleton)');
          const feedFresh = !publicFeedNeedsFullRefresh() && publicFeedState.posts.length > 0;
          const sorted = filterAndSortPosts(getCommunityFeedForDisplay());
          const sig = feedListSignature(sorted, 'communityGrid');
          if (hasRealCards && grid?.dataset.feedSig === sig && feedFresh) {
            patchFeedLikeLabels(grid, sorted);
            settleCommunityFeedLayout('communityGrid', { recalcCols: true });
          } else {
            renderCommunity({
              immediate: true,
              skipFeedFetch: feedFresh,
              syncFromCards: false
            });
          }
          if (isMobileViewport()) {
            requestAnimationFrame(() => {
              if (seq !== communityOnActivateSeq) return;
              bindFeedPagedScroll('communityGrid');
              reconnectFeedPageObserver('communityGrid');
            });
          }
          deferCommunityIdle(() => {
            if (seq !== communityOnActivateSeq) return;
            if (!document.getElementById('pageCommunity')?.classList.contains('active')) return;
            ensureCommunityFromCardsThrottled(false);
            if (publicFeedNeedsFullRefresh() && !publicFeedState.loading) {
              if (grid && !hasRealCards) showCommunityFeedSkeleton(grid, 8);
              void refreshPublicCommunityFeed({ force: true, timeoutMs: 20000 }).then(async () => {
                if (seq !== communityOnActivateSeq) return;
                const sortedOnActivate = filterAndSortPosts(getCommunityFeedForDisplay());
                if (shouldPreserveCommunityFeedDom('communityGrid', sortedOnActivate) && grid?.querySelector('.community-post-card:not(.community-feed-skeleton)')) {
                  await growCommunityFeedAfterPublicRefresh('communityGrid');
                  return;
                }
                renderCommunity({ immediate: true, skipFeedFetch: true, forceRepaint: true });
                await growCommunityFeedAfterPublicRefresh('communityGrid');
              });
            } else if (!publicFeedState.loading) {
              void refreshPublicCommunityFeed({ force: false }).then(async (changed) => {
                if (seq !== communityOnActivateSeq) return;
                if (!changed) return;
                patchFeedLikeLabels(grid, filterAndSortPosts(getCommunityFeedForDisplay()));
                await growCommunityFeedAfterPublicRefresh('communityGrid');
              });
            }
            const warmPosts = filterAndSortPosts(getCommunityFeedForDisplay()).slice(0, 12);
            const warmCards = warmPosts.map((p) => ({
              id: p.sourceCardId || p.id,
              image: canonicalCommunityImageRef(p) || p.image,
              sourceCardId: p.sourceCardId,
              authorId: p.authorId
            })).filter((c) => c.image);
            if (warmCards.length && window.SupabaseSync?.prefetchCommunityDisplayUrls) {
              void window.SupabaseSync.prefetchCommunityDisplayUrls(warmCards, 3000);
            } else if (warmCards.length && window.SupabaseSync?.prefetchCardsImages) {
              void window.SupabaseSync.prefetchCardsImages(warmCards, 3000);
            }
            window.CommunityGacha?.init?.();
            window.CommunityGacha?.refreshEntryButton?.();
          });
        });
      });
    }, 50);
  }

  function feedHasRenderedContent(containerId, itemSelector) {
    const el = document.getElementById(containerId);
    if (!el) return false;
    return !!(el.querySelector(itemSelector) || el.querySelector('.feature-empty'));
  }

  function onAppChange(app) {
    const fab = document.getElementById('fabNewBtn');
    if (fab) fab.classList.toggle('hidden-by-app', app !== 'warehouse');
    window.FeatureAssets?.onAppChange?.(app);
    if (app !== 'community') {
      cancelCommunityPageWork();
      if (communityAppreciateActive) {
        window.closeAppreciateViewer?.();
        exitCommunityAppreciate(true);
      }
    }
    if (app === 'community') {
      window.closeAppreciateViewer?.();
      if (communityAppreciateActive) exitCommunityAppreciate(true);
      document.body.classList.remove('global-view', 'appreciate-viewing');
      if (!document.getElementById('pageCommunity')?.classList.contains('active')) return;
      activateCommunityPage();
    }
    if (app === 'creations') {
      if (!document.getElementById('pageCreations')?.classList.contains('active')) return;
      requestAnimationFrame(() => {
        repairCreationsFeedLayout(true);
        syncCommunityFeedColumnCount('creationsGrid');
      });
      renderMyHomeProfile();
      const activeTab = document.querySelector('#myHomeTabs .my-home-tab.active')?.dataset?.homeTab || 'posts';
      if (activeTab === 'owned-packages') {
        window.FeatureAssets?.renderMyHomePackages?.(document.getElementById('myHomeOwnedPackages'), 'owned');
      } else if (activeTab === 'published-packages') {
        window.FeatureAssets?.renderMyHomePackages?.(document.getElementById('myHomePublishedPackages'), 'published');
      } else {
        void renderCreations();
      }
    }
    if (app !== 'community') closeCommunitySidePanel();
    if (app !== 'creations') closeCreationsSidePanel();
    if (app !== 'imagegen') {
      closeImageGenPreview();
      if (imageGenPendingJobs.length > 0 || getActivePollJobIds().size > 0) {
        scheduleGenJobsSync(400);
      }
    }
    if (app === 'imagegen') {
      void prefetchImageGenModelCatalog();
      if (!document.getElementById('pageImageGen')?.classList.contains('active')) return;
      if (window.__PROMPT_HUB_AUTH_RESOLVED__ !== true) {
        const submit = document.getElementById('imageGenSubmit');
        if (submit) {
          submit.disabled = true;
          submit.setAttribute('aria-busy', 'true');
        }
        return;
      }
      imageGenGenPublicSession = null;
      syncImageGenGenPublicUI();
      window.MobileUI?.initImageGenMobileView?.();
      pruneCreations();
      initImageGenForm();
      updateImageGenFeedHint();
      scheduleImageGenBootSync({
        urgent: imageGenPendingJobs.length > 0 || getActivePollJobIds().size > 0,
        forceJobs: imageGenPendingJobs.length > 0 || getActivePollJobIds().size > 0,
        forceRecent: true
      });
      scheduleRecentCreationsServerSync({
        force: true,
        render: !isImageGenMobileFormActive()
      }, 250);
      if (!isImageGenMobileFormActive()) {
        renderImageGenFeed({ preserveScroll: true });
      }
      renderImageGenMobileResult();
      if (window.__phCreditsSyncedThisSession) {
        window.PointsSystem?.updateCreditsUI?.();
      } else {
        window.__phCreditsSyncedThisSession = true;
        void window.PointsSystem?.refreshCreditsFromServer?.();
      }
    }
  }

  function bindCommunityFeedMediaScrub() {
    if (bindCommunityFeedMediaScrub._done) return;
    bindCommunityFeedMediaScrub._done = true;
    const orig = window.finishCardMediaShine;
    if (typeof orig !== 'function') return;
    window.finishCardMediaShine = function patchedFinishCardMediaShine(media) {
      orig.call(this, media);
      const feedGrid = media?.closest?.('#communityGrid, #creationsGrid');
      if (feedGrid && !useCommunityCssGrid(feedGrid.id) && !window.FeedLayout?.schedule) {
        scheduleFeedMasonryRelayout(feedGrid.id);
      }
    };
  }

  function init() {
    loadStores();
    warmImageGenModelCatalog();
    hydratePublicFeedFromCache();
    bindUI();
    bindPublishToggle();
    initMyHomeTabs();
    bindCommunityFeedMediaScrub();
    bindCommunityGridImageRelayout();
    bindCommunityFeedResizeRelayout('communityGrid');
    bindCommunityFeedResizeRelayout('creationsGrid');
    startGenJobsBackgroundSync();
    onAppChange(localStorage.getItem('promptrepo_app_page') || 'landing');
  }

  function refreshImageGenCost() {
    updateImageGenCostHint();
  }


  let imageGenFormActivated = false;

  function initImageGenForm() {
    resetImageGenSubmitState();
    if (imageGenFormActivated) {
      scheduleImageGenModelUiRefresh();
      updateImageGenSaveTargetSelects();
      syncImageGenGenPublicUI();
      updateImageGenFeedHint();
      if (!isImageGenMobileFormActive()) {
        if (!feedHasRenderedContent('imageGenFeed', '.imagegen-feed-card')) {
          renderImageGenFeed();
        } else {
          scheduleImageGenFeedLayout();
        }
      }
      renderImageGenMobileResult();
      return;
    }
    imageGenFormActivated = true;
    bindImageGenModelFamilyTabs();
    if (!imageGenModelCatalog.length) {
      const cached = loadCachedImageGenModels();
      if (cached?.length) {
        applyImageGenModelCatalog(cached, { forceRender: true, source: 'cache' });
      } else {
        applyImageGenModelCatalog(IMAGE_GEN_MODEL_FALLBACK, { forceRender: true, source: 'fallback' });
      }
    } else {
      setImageGenModelSelectLoading(false);
      rebuildImageGenModelFamilyTabs();
      renderImageGenModelSelect({ skipUiRefresh: true });
      flushImageGenModelUiRefresh();
    }
    void prefetchImageGenModelCatalog().then(() => {
      syncImageGenModelToResolution();
      scheduleImageGenModelUiRefresh();
    });
    const draft = loadJson(LS_IMAGEGEN, null);
    if (draft) {
      // Version 1 used two images as the implicit default. Migrate that legacy
      // draft once, while preserving explicit choices made after this version.
      if (draft.countPreferenceVersion !== IMAGE_GEN_COUNT_PREFERENCE_VERSION) {
        draft.count = 1;
        draft.countPreferenceVersion = IMAGE_GEN_COUNT_PREFERENCE_VERSION;
        saveJson(LS_IMAGEGEN, draft);
      }
      const promptEl = document.getElementById('imageGenPrompt');
      if (promptEl && draft.prompt) promptEl.value = draft.prompt;
      if (draft.refImages?.length) setImageGenRefs(draft.refImages, { referenceAssets: draft.referenceAssets });
      else if (draft.refImage) setImageGenRefs([draft.refImage], { referenceAssets: draft.referenceAssets });
      else clearImageGenRef();
      const resEl = document.getElementById('imageGenResolution');
      if (resEl && draft.resolution) resEl.value = draft.resolution;
      const qEl = document.getElementById('imageGenQuality');
      if (qEl && draft.quality) qEl.value = draft.quality;
      if (draft.model) {
        imageGenModelFamily = resolveImageGenModelFamily(draft.modelFamily, draft.model);
      }
      const szEl = document.getElementById('imageGenSize');
      if (szEl && draft.size) szEl.value = draft.size;
      const countEl = document.getElementById('imageGenCount');
      if (countEl && draft.count) {
        const c = Math.min(5, Math.max(1, Math.floor(Number(draft.count)) || 1));
        setImageGenBatchCount(c);
      }
      const titleEl = document.getElementById('imageGenCardTitle');
      if (titleEl && typeof draft.cardTitle === 'string') titleEl.value = draft.cardTitle.slice(0, 80);
      const splitEl = document.getElementById('imageGenBatchSplit');
      if (splitEl) splitEl.checked = !!draft.batchSplit;
      if (draft.mjMode === 'blend' || draft.mjMode === 'imagine') {
        imageGenMjMode = draft.mjMode;
      }
      const saveAllEl = document.getElementById('imageGenMjSaveAllTiles');
      if (saveAllEl && draft.mjSaveAllTiles) saveAllEl.checked = true;
      const speedSelect = document.getElementById('imageGenMjSpeedSelect');
      if (speedSelect) {
        const speedVal = draft.mjSpeed;
        if (speedVal === 'fast' || speedVal === 'turbo') speedSelect.value = speedVal;
        else speedSelect.value = 'relax';
      }
      if (typeof draft.mjExtras === 'string') setImageGenMjExtrasValue(draft.mjExtras);
    }
    bindImageGenUpload();
    bindImageGenPromptTools();
    window.ImageGenPromptTools?.init?.();
    bindImageGenGenPublic();
    bindImageGenSaveTarget();
    updateImageGenSaveTargetSelects();
    syncImageGenGenPublicUI();
    applyImageGenPrefill();
    updateImageGenFeedHint();
    syncImageGenGenPublicFromPrompt();
    syncImageGenModelParamsUI();
    setImageGenMjMode(imageGenMjMode);
    syncImageGenBatchSplitUi();
    if (!isImageGenMobileFormActive()) {
      if (!feedHasRenderedContent('imageGenFeed', '.imagegen-feed-card')) {
        renderImageGenFeed();
      } else {
        scheduleImageGenFeedLayout();
      }
    }
    window.PointsSystem?.updateCreditsUI?.();
  }

  let quietSyncImageGenInflight = null;

  /** 静默拉云端 + 恢复生图任务；首屏不阻塞 await 全量 pull */
  async function quietSyncImageGenFromCloud() {
    if (quietSyncImageGenInflight) return quietSyncImageGenInflight;
    quietSyncImageGenInflight = (async () => {
      try {
        const pending = imageGenPendingJobs.length > 0;
        const mobileForm = isImageGenMobileFormActive();
        if (pending) {
          await resumePendingGenerationJobs();
          if (!mobileForm) renderImageGenFeed({ preserveScroll: true });
          renderImageGenMobileResult();
        }
        void syncRecentCreationsFromServer({
          render: !mobileForm,
          force: pending
        });
        const last = window.__phLastBgCloudSyncAt || 0;
        if (Date.now() - last < 120000) return;
        if (mobileForm && !pending && (window.__promptHubCards || []).length > 0) {
          window.scheduleDeferredCloudPull?.({ silent: true, light: true });
          return;
        }
        if (typeof window.runDeferredCloudPull === 'function') {
          void window.runDeferredCloudPull({ silent: true, light: true });
        } else {
          window.scheduleDeferredCloudPull?.({ silent: true, light: true });
        }
      } catch (e) {
        console.warn('[imagegen] quiet cloud sync', e);
      } finally {
        quietSyncImageGenInflight = null;
      }
    })();
    return quietSyncImageGenInflight;
  }

  function getImageGenQuality() {
    return document.getElementById('imageGenQuality')?.value || 'standard';
  }

  function getImageGenModel() {
    const raw = document.getElementById('imageGenModel')?.value || '';
    if (!raw || !imageGenModelCatalogReady) {
      const draft = loadJson(LS_IMAGEGEN, null);
      if (draft?.model) return normalizeImageGenModelId(draft.model);
    }
    return normalizeImageGenModelId(raw || 'image2');
  }

  let imageGenModelCatalog = [];
  let imageGenModelCatalogReady = false;
  let imageGenModelsByFamilyCache = null;
  let imageGenFamilyTabsBound = false;
  let imageGenModelUiRefreshRaf = 0;

  function invalidateImageGenFamilyCache() {
    imageGenModelsByFamilyCache = null;
  }

  function flushImageGenModelUiRefresh() {
    syncImageGenModelParamsUI();
    syncImageGenModelHint();
    updateImageGenResolutionSelect();
    syncImageGenQualityUI();
    updateImageGenCostHint();
  }

  function scheduleImageGenModelUiRefresh() {
    if (imageGenModelUiRefreshRaf) return;
    imageGenModelUiRefreshRaf = requestAnimationFrame(() => {
      imageGenModelUiRefreshRaf = 0;
      flushImageGenModelUiRefresh();
    });
  }
  let imageGenModelFamily = 'gim2';
  let imageGenMjMode = 'imagine';

  function setImageGenModelSelectLoading(loading) {
    const sel = document.getElementById('imageGenModel');
    const resSel = document.getElementById('imageGenResolution');
    const tabs = document.getElementById('imageGenModelFamilyTabs');
    imageGenModelCatalogReady = !loading;
    window.__IMAGE_GEN_CATALOG_READY__ = imageGenModelCatalogReady;
    if (sel) {
      sel.disabled = !!loading;
      sel.setAttribute('aria-busy', loading ? 'true' : 'false');
      if (loading) {
        sel.innerHTML = '';
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '加载模型列表…';
        sel.appendChild(opt);
        sel.value = '';
      }
    }
    if (resSel && loading) {
      resSel.disabled = true;
      resSel.innerHTML = '';
      const ro = document.createElement('option');
      ro.value = '';
      ro.textContent = '—';
      resSel.appendChild(ro);
      resSel.value = '';
    }
    if (resSel && !loading) resSel.disabled = false;
    if (tabs) tabs.hidden = !!loading;
  }

  const IMAGE_GEN_MODEL_FAMILIES = [
    { key: 'gim2', label: '全能模型2' },
    { key: 'banana', label: '香蕉' },
    { key: 'midjourney', label: 'MJ' }
  ];

  const IMAGE_GEN_MODEL_FALLBACK = [
    { id: 'image2-economy', label: '全能模型2 · 特价 1K', provider: 'newapi', uiFamily: 'gim2', sortOrder: 89, selectable: true, status: 'active', refundOnViolation: true, creditsPerCall: 2.2, creditsBase: 2.2, creditsFinal: 2.2, resolutions: ['1k'], aspectRatios: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '16:9', '9:16'] },
    { id: 'image2', label: '全能模型2 · 1K', provider: 'newapi', uiFamily: 'gim2', sortOrder: 90, selectable: true, status: 'active', refundOnViolation: true, creditsPerCall: 0, creditsBase: 0, creditsFinal: 0, listPrice: 0, promoPrice: 0, resolutions: ['1k'], aspectRatios: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9'] },
    { id: 'image2-4k-fast', label: '全能模型2 · 极速 4K', provider: 'newapi', uiFamily: 'gim2', sortOrder: 91, selectable: true, status: 'active', refundOnViolation: true, creditsPerCall: 6.5, creditsBase: 6.5, creditsFinal: 6.5, resolutions: ['4k'], aspectRatios: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'], fixedQualityLow: true, maxReferenceImages: 0 },
    { id: 'image2-pro', label: '全能模型2 · 高质量 1K/2K/4K', provider: 'newapi', uiFamily: 'gim2', sortOrder: 92, selectable: true, status: 'active', refundOnViolation: true, pricingByResolution: true, creditsByResolution: { '1k': 7, '2k': 15, '4k': 20 }, resolutions: ['1k', '2k', '4k'], aspectRatios: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'] },
    { id: 'image2-hd', label: '全能模型2 · 经济 2K/4K', provider: 'newapi', uiFamily: 'gim2', sortOrder: 93, selectable: true, status: 'active', refundOnViolation: true, fixedQualityLow: true, pricingByResolution: true, creditsByResolution: { '2k': 5.5, '4k': 9 }, resolutions: ['2k', '4k'], aspectRatios: ['3:1', '1:3', '21:9', '9:21', '2:1', '1:2', '16:9', '9:16'] },
    { id: 'lingtu-fast', label: '香蕉 · Fast 1K', provider: 'newapi', uiFamily: 'banana', sortOrder: 93, selectable: true, status: 'active', refundOnViolation: true, creditsPerCall: 3.2, creditsBase: 3.2, creditsFinal: 3.2, resolutions: ['1k'] },
    { id: 'lingtu-2', label: '香蕉 · 2 1K/2K/4K', provider: 'newapi', uiFamily: 'banana', sortOrder: 94, selectable: true, status: 'active', refundOnViolation: true, creditsPerCall: 6, creditsBase: 6, creditsFinal: 6, resolutions: ['1k', '2k', '4k'] },
    { id: 'lingtu-pro', label: '香蕉 · Pro 1K/2K/4K', provider: 'newapi', uiFamily: 'banana', sortOrder: 95, selectable: true, status: 'active', refundOnViolation: true, creditsPerCall: 6, creditsBase: 6, creditsFinal: 6, resolutions: ['1k', '2k', '4k'] },
    { id: 'lingtu', label: '香蕉 · Standard 1K/2K/4K', provider: 'newapi', uiFamily: 'banana', sortOrder: 96, selectable: true, status: 'active', refundOnViolation: true, creditsPerCall: 6, creditsBase: 6, creditsFinal: 6, resolutions: ['1k', '2k', '4k'] },
    { id: 'apimart-mj-v81', label: 'MJ v8.1', description: '最新主版本 · 写实/概念通用 · 细节与光影最佳', provider: 'apimart', uiFamily: 'midjourney', sortOrder: 110, selectable: true, status: 'active', refundOnViolation: true, resolutions: ['1k'], aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'] },
    { id: 'apimart-mj-v7', label: 'MJ v7', description: '上一代主力 · 复杂构图稳定 · 风格均衡', provider: 'apimart', uiFamily: 'midjourney', sortOrder: 111, selectable: true, status: 'active', refundOnViolation: true, resolutions: ['1k'], aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'] },
    { id: 'apimart-mj-v61', label: 'MJ v6.1', description: '经典 v6 · 风格稳定 · 适合批量出图', provider: 'apimart', uiFamily: 'midjourney', sortOrder: 112, selectable: true, status: 'active', refundOnViolation: true, resolutions: ['1k'], aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'] },
    { id: 'apimart-mj-niji7', label: 'MJ Niji 7', description: '动漫/二次元专版 · 角色与插画表现力强', provider: 'apimart', uiFamily: 'midjourney', sortOrder: 113, selectable: true, status: 'active', refundOnViolation: true, resolutions: ['1k'], aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'] }
  ];

  const IMAGE_GEN_MJ_MODEL_DESCRIPTIONS = {
    'apimart-mj-v81': '最新主版本 · 写实/概念通用 · 细节与光影最佳',
    'apimart-mj-v7': '上一代主力 · 复杂构图稳定 · 风格均衡',
    'apimart-mj-v61': '经典 v6 · 风格稳定 · 适合批量出图',
    'apimart-mj-niji7': '动漫/二次元专版 · 角色与插画表现力强'
  };

  function loadCachedImageGenModels() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_IMAGEGEN_MODELS) || 'null');
      if (!raw?.models?.length) return null;
      if (Number(raw.version) < IMAGE_GEN_CATALOG_CACHE_VERSION) return null;
      if (raw.ts < Date.now() - 7 * 24 * 3600 * 1000) return null;
      return raw.models;
    } catch (e) { /* ignore */ }
    return null;
  }

  function persistCachedImageGenModels(models) {
    try {
      localStorage.setItem(
        LS_IMAGEGEN_MODELS,
        JSON.stringify({ ts: Date.now(), version: IMAGE_GEN_CATALOG_CACHE_VERSION, models })
      );
    } catch (e) { /* ignore */ }
  }

  function sanitizeImageGenModelDescription(description) {
    if (!description) return null;
    let s = String(description).trim();
    s = s.replace(/^(Apimart|GrsAI|ThinkAI|Mooko|木瓜|OpenAI|Gemini|备用线路)\s*[·•]\s*/gi, '');
    s = s.replace(/\b(Apimart|OpenAI|Gemini|gpt-image-2|official|备用线路)\b\s*[·•]?\s*/gi, '');
    s = s.replace(/\s*[·•]\s*出图速度可选\s*relax\s*\/\s*fast\s*\/\s*turbo/gi, '');
    s = s.replace(/\s*[·•]\s*$/g, '').trim();
    if (!s || /^(OpenAI|Gemini|gpt-image|备用线路)/i.test(s)) return null;
    return s;
  }

  function normalizeImageGenModelEntry(m) {
    if (!m?.id) return null;
    const catalogLabel = m.catalogLabel || m.label || m.id;
    const label = String(m.displayLabel || m.label || catalogLabel).trim() || catalogLabel;
    const mjDesc = IMAGE_GEN_MJ_MODEL_DESCRIPTIONS[m.id];
    const rawDesc = m.description || mjDesc || null;
    const description = sanitizeImageGenModelDescription(rawDesc);
    return { ...m, label, catalogLabel, description };
  }

  function imageGenModelDisplayName(m) {
    if (!m) return '模型';
    return m.label || m.displayLabel || m.catalogLabel || m.id || '模型';
  }

  function isImageGenPageVisible() {
    return document.getElementById('pageImageGen')?.classList.contains('active');
  }

  function applyImageGenModelCatalog(models, opts = {}) {
    if (!Array.isArray(models) || !models.length) return false;
    const source = opts.source || 'api';
    invalidateImageGenFamilyCache();
    imageGenModelCatalog = models
      .map(normalizeImageGenModelEntry)
      .filter(Boolean)
      .filter((m) => m.status !== 'offline');
    window.__IMAGE_GEN_MODELS__ = imageGenModelCatalog;
    if (source === 'api' || source === 'cache') {
      persistCachedImageGenModels(imageGenModelCatalog);
    }
    imageGenModelCatalogReady = true;
    window.__IMAGE_GEN_CATALOG_READY__ = true;
    const shouldRender = opts.renderUi !== false && (opts.forceRender || isImageGenPageVisible());
    if (shouldRender) {
      setImageGenModelSelectLoading(false);
      rebuildImageGenModelFamilyTabs();
      renderImageGenModelSelect({ skipUiRefresh: true });
      flushImageGenModelUiRefresh();
    }
    return true;
  }

  function warmImageGenModelCatalog() {
    if (imageGenModelCatalog.length) return true;
    const cached = loadCachedImageGenModels();
    if (cached?.length) {
      return applyImageGenModelCatalog(cached, { renderUi: false, source: 'cache' });
    }
    return applyImageGenModelCatalog(IMAGE_GEN_MODEL_FALLBACK, { renderUi: false, source: 'fallback' });
  }

  let imageGenModelCatalogFetchPromise = null;
  let imageGenModelCatalogDeferredTimer = null;

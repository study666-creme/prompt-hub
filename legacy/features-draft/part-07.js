    ).name;
    const overlay = document.getElementById('userProfileOverlay');
    const titleEl = document.getElementById('userProfileTitle');
    const subEl = document.getElementById('userProfileSub');
    const avatarEl = document.getElementById('userProfileAvatar');
    if (titleEl) titleEl.textContent = newestName || '用户';
    if (subEl) subEl.textContent = `已发布 ${posts.length} 个提示词`;
    if (avatarEl) avatarEl.textContent = ((newestName || '?')[0] || '?').toUpperCase();
    const followBtn = document.getElementById('userProfileFollowBtn');
    const me = getActiveUser();
    if (followBtn) {
      if (me.id === 'guest' || String(authorId) === String(me.id)) {
        followBtn.classList.add('hidden');
      } else {
        followBtn.classList.remove('hidden');
        syncFollowUI(authorId);
        followBtn.onclick = (e) => {
          e.stopPropagation();
          toggleFollow(authorId, authorName);
        };
      }
    }
    closeCommunityDetail();
    renderUserProfileGrid();
    if (window.AppModalHub?.open) window.AppModalHub.open('userProfileOverlay');
    else overlay?.classList.add('active');
  }

  function closeUserProfile() {
    if (window.AppModalHub?.close) window.AppModalHub.close('userProfileOverlay');
    else document.getElementById('userProfileOverlay')?.classList.remove('active');
    openProfileAuthorId = null;
    window.FeedLayout?.destroyLayout?.('userProfileGrid');
  }
  window.closeUserProfile = closeUserProfile;

  async function syncCardToCommunity(card, publish, opts = {}) {
    if (!card?.id) return;
    if (publish && isCommunityCollectCard(card)) {
      if (!opts.silent) toast('社区收藏卡片不可发布到社区');
      card.publishedToCommunity = false;
      return;
    }
    const silent = opts.silent === true;
    const keepPublishFlag = opts.keepPublishFlag === true;
    let idx = card.communityPostId
      ? communityPosts.findIndex(p => p.id === card.communityPostId)
      : -1;
    if (idx < 0) {
      idx = communityPosts.findIndex(p => p.sourceCardId === card.id);
    }
    if (!publish) {
      const postIds = new Set();
      if (idx >= 0) postIds.add(String(communityPosts[idx].id));
      if (card.communityPostId) postIds.add(String(card.communityPostId));
      for (const p of publicFeedState.posts) {
        if (p && String(p.sourceCardId) === String(card.id)) postIds.add(String(p.id));
      }
      for (const p of communityPosts) {
        if (p && String(p.sourceCardId) === String(card.id)) postIds.add(String(p.id));
      }
      if (idx >= 0) communityPosts.splice(idx, 1);
      else communityPosts = communityPosts.filter((p) => String(p.sourceCardId) !== String(card.id));
      publicFeedState.posts = publicFeedState.posts.filter((p) => String(p.sourceCardId) !== String(card.id));
      savePublicFeedCache(publicFeedState.posts);
      card.publishedToCommunity = false;
      card.communityPostId = null;
      persistCommunity();
      if (postIds.size) {
        await Promise.all([...postIds].map((postId) =>
          removePostFromPublicFeed(postId, { sourceCardId: card.id })
        ));
      }
      rebuildOwnPostFilterCache();
      invalidateCommunityReconcileCache();
      if (!silent && opts.skipRender !== true) {
        void refreshPublicCommunityFeed({ force: true }).then(() => {
          renderCommunity({ skipFeedFetch: true, forceRepaint: true });
        });
        if (document.getElementById('pageCreations')?.classList.contains('active')) {
          void renderCreations();
        }
        if (communitySidePostId) {
          const sidePost = findPost(communitySidePostId);
          if (!sidePost || !ownPostAllowedInFeed(sidePost)) closeCommunitySidePanel();
        }
      }
      return;
    }
    const promptTrim = (card.prompt || '').trim();
    if (!promptTrim) {
      if (!silent) toast('发布到社区需要填写提示词');
      if (!keepPublishFlag) {
        card.publishedToCommunity = false;
        card.communityPostId = null;
      }
      return;
    }
    if (promptTrim.length < MIN_COMMUNITY_PROMPT_LEN) {
      if (!silent) toast(`发布到社区需要提示词至少 ${MIN_COMMUNITY_PROMPT_LEN} 字`);
      if (!keepPublishFlag) {
        card.publishedToCommunity = false;
        card.communityPostId = null;
      }
      return;
    }
    if (!cardHasCommunityImage(card)) {
      if (!silent) toast('发布到社区需要配图（请先生图或上传图片），纯文字不可发布');
      if (!keepPublishFlag) {
        card.publishedToCommunity = false;
        card.communityPostId = null;
      }
      return;
    }
    const user = getActiveUser();
    const post = {
      id: card.communityPostId || genId('cp'),
      sourceCardId: card.id,
      authorId: user.id,
      authorName: user.name,
      title: (card.title || '').trim() || '',
      prompt: card.prompt || '',
      image: card.image || null,
      likes: idx >= 0 ? (communityPosts[idx].likes || 0) : 0,
      createdAt: idx >= 0 ? communityPosts[idx].createdAt : Date.now(),
      updatedAt: Date.now()
    };
    if (idx >= 0) communityPosts[idx] = post;
    else communityPosts.push(post);
    card.publishedToCommunity = true;
    window.TrialTasksUI?.syncTaskProgress?.();
    card.communityPostId = post.id;
    if (opts.skipPersist !== true) {
      persistCommunity();
      rebuildOwnPostFilterCache();
      invalidateCommunityReconcileCache();
      await pushPostToPublicFeed(post);
      void syncMyPostsToPublicFeed().then(() =>
        refreshPublicCommunityFeed({ force: true, timeoutMs: 15000 })
      );
    }
    if (!silent && opts.skipRender !== true) {
      renderCommunity({ skipFeedFetch: true });
      if (openProfileAuthorId === user.id) renderUserProfileGrid();
      checkOwnPostMilestones(post.id);
    }
  }

  async function unpublishCommunityByCardId(cardId, opts = {}) {
    const cid = String(cardId || '');
    if (!cid) return;
    const card = (window.__promptHubCards || []).find((c) => String(c.id) === cid);
    const postIds = new Set();
    if (card?.communityPostId) postIds.add(String(card.communityPostId));
    for (const p of [...communityPosts, ...publicFeedState.posts, ...getAllCommunityPosts()]) {
      if (p && String(p.sourceCardId) === cid) postIds.add(String(p.id));
    }
    for (const postId of postIds) {
      if (typeof window.recordCommunityPostDeletion === 'function') {
        window.recordCommunityPostDeletion(postId);
      }
      await removePostFromPublicFeed(postId, { sourceCardId: cid });
    }
    communityPosts = communityPosts.filter((p) => String(p.sourceCardId) !== cid);
    publicFeedState.posts = publicFeedState.posts.filter((p) => String(p.sourceCardId) !== cid);
    savePublicFeedCache(publicFeedState.posts);
    if (card) {
      card.publishedToCommunity = false;
      card.communityPostId = null;
    }
    persistCommunity();
    rebuildOwnPostFilterCache();
    invalidateCommunityReconcileCache();
    if (!opts.silent) {
      renderCommunity({ skipFeedFetch: true, forceRepaint: true });
    }
  }

  function removeCommunityByCardId(cardId) {
    const i = communityPosts.findIndex(p => p.sourceCardId === cardId);
    if (i >= 0) {
      const postId = communityPosts[i].id;
      performCommunityPostRemoval(postId, { silent: true });
    }
  }

  function confirmDeleteCommunityPost(id) {
    toast('社区作品与其他人一视同仁。请到卡片库关闭「发布到社区」或删除对应卡片');
  }

  function performCommunityPostRemoval(id, opts = {}) {
    const post = findPost(id);
    if (!post) return;
    void removePostFromPublicFeed(id);
    if (typeof window.recordCommunityPostDeletion === 'function') {
      window.recordCommunityPostDeletion(id);
    }
    const authorId = post.authorId;
    if (post.sourceCardId) {
      const card = window.__promptHubCards?.find(c => c.id === post.sourceCardId);
      if (card) {
        syncCardToCommunity(card, false);
        if (typeof window.persistPromptHubCards === 'function') void window.persistPromptHubCards();
      } else {
        communityPosts = communityPosts.filter(p => p.id !== id);
        persistCommunity();
      }
    } else {
      communityPosts = communityPosts.filter(p => p.id !== id);
      persistCommunity();
    }
    const cIdx = creations.findIndex(c => c.communityPostId === id);
    if (cIdx >= 0) {
      creations[cIdx].visibility = 'private';
      creations[cIdx].communityPostId = null;
      creations[cIdx].permanent = false;
      persistCreations();
    }
    likedIds.delete(id);
    favIds.delete(id);
    persistLikes();
    if (communitySidePostId === id) closeCommunitySidePanel();
    renderCommunity();
    if (openProfileAuthorId === authorId) renderUserProfileGrid();
    if (document.getElementById('pageImageGen')?.classList.contains('active')) renderImageGenFeed({ preserveScroll: true });
    if (!opts.silent) toast('已从社区删除');
  }

  function setPublishCheckbox(card) {
    if (!document.getElementById('cardPublishToggle')) return;
    applyPublishToggleUi(getCardPublishIntent(card));
  }

  function readPublishCheckbox() {
    const editing = window.__promptHubGetEditingCard?.();
    if (editing) return getCardPublishIntent(editing);
    if (typeof window.__promptHubIsNewCard === 'function' && window.__promptHubIsNewCard()) {
      return getCardPublishIntent(null);
    }
    return false;
  }

  function bindPublishToggle() {
    const btn = document.getElementById('cardPublishToggle');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const editing = window.__promptHubGetEditingCard?.();
      const isNew = typeof window.__promptHubIsNewCard === 'function' && window.__promptHubIsNewCard();
      const card = editing || (isNew ? null : null);
      const willOn = !getCardPublishIntent(card);
      setCardPublishIntent(card, willOn);
    });
  }

  function findPost(id, hint) {
    const sid = hint?.sourceCardId ? String(hint.sourceCardId) : '';
    const matchIn = (list) => {
      if (!Array.isArray(list)) return null;
      let p = list.find((x) => x.id === id);
      if (p) return p;
      if (sid) p = list.find((x) => String(x.sourceCardId || '') === sid);
      return p || null;
    };
    return matchIn(getCommunityFeedForDisplay())
      || matchIn(getAllCommunityPosts())
      || null;
  }

  function setPostLikes(id, likes) {
    const n = Math.max(0, Math.floor(Number(likes) || 0));
    for (const list of [publicFeedState.posts, communityPosts]) {
      const p = list.find((x) => x.id === id);
      if (p) p.likes = n;
    }
    savePublicFeedCache(publicFeedState.posts);
  }

  function bumpPostLikes(id, delta = 1) {
    const post = findPost(id);
    const next = Math.max(0, (post?.likes || 0) + delta);
    setPostLikes(id, next);
    if (post) post.likes = next;
    return next;
  }

  /** 点赞（仅增加一次），返回是否为新点赞 */
  function ensureLike(id) {
    if (!window.AuthGate?.requireAuth?.('community')) return false;
    const post = findPost(id);
    if (!post) return false;
    const user = getActiveUser();
    if (user.id !== 'guest' && post.authorId === user.id) {
      toast('不能给自己的作品点赞');
      return false;
    }
    if (likedIds.has(id)) return false;
    likedIds.add(id);
    const likes = bumpPostLikes(id, 1);
    persistLikes();
    persistCommunity();
    if (post.authorId !== user.id) {
      pushCommunityEvent({
        type: 'like',
        targetUserId: post.authorId,
        actorId: user.id,
        actorName: user.name,
        postId: id,
        postTitle: post.title || (post.prompt || '').slice(0, 24),
        likes,
        message: `${user.name} 赞了你的作品`
      });
    }
    window.PointsSystem?.onPostLikesUpdated?.(post, getActiveUser);
    patchCommunityLikeUI(id);
    patchCommunitySidePanelUI(id);
    if (document.getElementById('pageImageGen')?.classList.contains('active')) {
      document.querySelectorAll(`.imagegen-feed-like[data-like-id="${id}"]`).forEach(btn => {
        btn.textContent = communityLikeCountText(likes);
        btn.classList.add('liked');
      });
    }
    if (window.PromptHubApi?.likeCommunityPost) {
      void window.PromptHubApi.likeCommunityPost(id).then((r) => {
        if (r?.ok && typeof r.data?.likes === 'number') {
          setPostLikes(id, r.data.likes);
          const synced = findPost(id);
          if (synced) synced.likes = r.data.likes;
          persistCommunity();
          patchCommunityLikeUI(id);
          patchCommunitySidePanelUI(id);
        }
      }).catch(() => {});
    }
    return true;
  }

  function checkOwnPostMilestones(postId) {
    const post = findPost(postId);
    if (post) window.PointsSystem?.onPostLikesUpdated?.(post, getActiveUser);
  }

  function highlightCommunityCard(id) {
    document.querySelectorAll('#communityGrid .community-post-card').forEach(el => {
      el.classList.toggle('selected', el.dataset.postId === id);
    });
  }

  function highlightCreationsPost(id) {
    document.querySelectorAll('#creationsGrid .community-post-card').forEach(el => {
      el.classList.toggle('selected', el.dataset.postId === id);
    });
  }

  async function toggleMyPublishedPostVisibility(postId) {
    const post = findPost(postId);
    if (!post?.sourceCardId) {
      toast('该作品未关联卡片库，请到卡片库操作');
      return;
    }
    const card = (window.__promptHubCards || []).find((c) => String(c.id) === String(post.sourceCardId));
    if (!card) {
      toast('卡片库中未找到该作品，请先从社区恢复或打开卡片库');
      return;
    }
    const wantOn = card.publishedToCommunity !== true;
    card.publishedToCommunity = wantOn;
    await applyCardPublishState(card, wantOn);
    if (typeof window.persistPromptHubCards === 'function') {
      await window.persistPromptHubCards({ skipCloud: true });
    }
    if (window.SupabaseSync?.isLoggedIn?.()) {
      queueUrgentCardsSync();
    }
    maybeReconcileCommunityWithCards(window.__promptHubCards || [], { force: true });
    toast(wantOn ? '已公开到社区' : '已从社区下架');
    void renderCreations();
    void renderCommunitySidePanel(postId, {
      bodyId: 'creationsSideBody',
      titleId: 'creationsSideTitle',
      mode: 'creations'
    });
  }

  function communityPostZoomUrlSync(post, sideRef, body) {
    const postId = post?.id || '';
    const assetId = post?.sourceCardId || postId;
    const authorId = post?.authorId || '';
    const fromSide = loadedCommunitySideImgSrc(body);
    if (fromSide) {
      const path = window.SupabaseSync?.storagePathFromDisplayUrl?.(fromSide) || '';
      if (!path || !/_grid\.(jpe?g|webp|png)$/i.test(path)) return fromSide;
    }
    const cached = window.SupabaseSync?.getCachedDisplayUrl?.(sideRef, {
      assetId,
      authorId: authorId || undefined,
      variant: 'full'
    }) || '';
    if (cached && cached.startsWith('http') && !cached.includes('data:image/svg')) return cached;
    return '';
  }

  function loadedCommunitySideImgSrc(body) {
    const imgEl = body?.querySelector?.('.community-side-img');
    const cur = imgEl?.currentSrc || imgEl?.src || '';
    if (!cur || cur.includes('data:image/svg') || !cur.startsWith('http')) return '';
    if (window.SupabaseSync?.isResolvableDisplayUrl?.(cur)) return cur;
    if (window.SupabaseSync?.isValidSignedDisplayUrl?.(cur)) return cur;
    return '';
  }

  async function resolveCommunityZoomUrl(body, post, sideRef, postId, extra = {}) {
    const sync = communityPostZoomUrlSync(post, sideRef, body);
    if (sync) return sync;
    const signOpts = communitySideZoomSignOpts(post, sideRef, postId);
    const assetId = post?.sourceCardId || postId;
    const gridFallbackUrl = window.MediaPipeline?.gridUrlFromImgEl?.(body?.querySelector?.('img'))
      || window.MediaPipeline?.gridUrlFromImgEl?.(extra.imgEl) || '';
    const previewOpts = {
      assetId,
      authorId: signOpts.authorId || undefined,
      cardId: signOpts.cardId || undefined,
      communityFeed: signOpts.fromPublicFeed === true,
      jobId: extra.jobId || null,
      gridFallbackUrl,
      allowGridFallback: true
    };
    if (window.MediaPipeline?.resolvePreviewUrl && sideRef) {
      try {
        const full = await window.MediaPipeline.resolvePreviewUrl(sideRef, previewOpts);
        if (full) return full;
      } catch (e) { /* ignore */ }
    }
    if (window.SupabaseSync?.resolvePreviewFullUrl && sideRef) {
      try {
        const full = await window.SupabaseSync.resolvePreviewFullUrl(sideRef, previewOpts);
        if (full) return full;
      } catch (e) { /* ignore */ }
    }
    return resolveImageDisplayUrl(sideRef, extra.jobId || null, assetId, {
      ...signOpts,
      preferFull: true,
      listOnly: false,
      allowFullFallback: true,
      bypassSignBudget: true
    });
  }

  function upgradeCommunityZoomToFull(post, sideRef, postId, currentUrl) {
    if (!sideRef) return;
    const signOpts = communitySideZoomSignOpts(post, sideRef, postId);
    const assetId = post?.sourceCardId || postId;
    const previewOpts = {
      assetId,
      authorId: signOpts.authorId || undefined,
      cardId: signOpts.cardId || undefined,
      communityFeed: signOpts.fromPublicFeed === true
    };
    const resolveFull = async () => {
      if (window.MediaPipeline?.resolvePreviewUrl) {
        return window.MediaPipeline.resolvePreviewUrl(sideRef, previewOpts);
      }
      if (window.SupabaseSync?.resolvePreviewFullUrl) {
        return window.SupabaseSync.resolvePreviewFullUrl(sideRef, previewOpts);
      }
      return '';
    };
    void resolveFull().then((full) => {
      if (!full || full === currentUrl) return;
      const lbImg = document.getElementById('lightboxImage');
      const lb = document.getElementById('imageLightbox');
      if (lb?.classList.contains('active') && lbImg?.src === currentUrl) {
        window.setLightboxSrc?.(full);
      }
    });
  }

  function communitySideZoomSignOpts(post, sideRef, postId) {
    const guest = !window.SupabaseSync?.isLoggedIn?.();
    const uid = window.SupabaseSync?.getUserId?.();
    const path = window.SupabaseSync?.storagePathFromRef?.(sideRef) || '';
    const own = !!(path && uid && path.replace(/^\//, '').startsWith(`${uid}/`));
    return {
      fromPublicFeed: guest || !own,
      authorId: post?.authorId || '',
      cardId: post?.sourceCardId || postId
    };
  }

  function syncLightboxCommunityMode(isCommunity, postId) {
    window.syncLightboxActions?.({ community: !!isCommunity, postId: postId || null });
  }

  function isPostFavorited(postId) {
    return favIds.has(postId);
  }

  async function openCommunityPostImageZoom(post, sideRef, extra = {}) {
    if (!post || !sideRef) return;
    const postId = post.id;
    syncLightboxCommunityMode(true, postId);
    const syncUrl = communityPostZoomUrlSync(post, sideRef, null);
    if (syncUrl && typeof window.openLightbox === 'function') {
      window.openLightbox(syncUrl, { community: true, postId });
      upgradeCommunityZoomToFull(post, sideRef, postId, syncUrl);
      return;
    }
    if (typeof window.openLightbox === 'function') window.openLightbox('', { pending: true, community: true, postId });
    const url = await resolveCommunityZoomUrl(null, post, sideRef, postId, extra);
    if (url && typeof window.setLightboxSrc === 'function') {
      window.setLightboxSrc(url);
      upgradeCommunityZoomToFull(post, sideRef, postId, url);
      return;
    }
    if (typeof window.closeLightbox === 'function') window.closeLightbox();
    toast('图片加载中，请稍候再试', 2500);
  }

  async function openCommunitySideImageZoom(body, post, sideRef, postId, extra = {}) {
    syncLightboxCommunityMode(true, postId);
    const syncUrl = communityPostZoomUrlSync(post, sideRef, body);
    if (syncUrl && typeof window.openLightbox === 'function') {
      window.openLightbox(syncUrl, { community: true, postId });
      upgradeCommunityZoomToFull(post, sideRef, postId, syncUrl);
      return;
    }
    if (typeof window.openLightbox === 'function') window.openLightbox('', { pending: true, community: true, postId });
    const url = await resolveCommunityZoomUrl(body, post, sideRef, postId, extra);
    if (url && typeof window.setLightboxSrc === 'function') {
      window.setLightboxSrc(url);
      upgradeCommunityZoomToFull(post, sideRef, postId, url);
      return;
    }
    if (typeof window.closeLightbox === 'function') window.closeLightbox();
    toast('图片加载中，请稍候再试', 2500);
  }

  function bindCommunitySideImageZoom(body, post, sideRef, postId, extra = {}) {
    const btn = body?.querySelector?.('[data-side-zoom]');
    if (!btn || btn.dataset.sideZoomBound === '1') return;
    btn.dataset.sideZoomBound = '1';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      void openCommunitySideImageZoom(body, post, sideRef, postId, extra);
    });
  }

  async function renderCommunitySidePanel(id, opts = {}) {
    const post = opts.post || findPost(id);
    const bodyId = opts.bodyId || 'communitySideBody';
    const titleId = opts.titleId || 'communitySideTitle';
    const isCreationsMode = opts.mode === 'creations';
    const body = document.getElementById(bodyId);
    const titleEl = document.getElementById(titleId);
    if (!post || !body) return;
    if (titleEl) titleEl.textContent = getPostSideTitle(post);
    const sideRef = communityPostDisplayImageRef(post);
    const storageAttr = feedImgStorageAttr(sideRef);
    const showSideImg = sideRef && isDisplayableImage(sideRef);
    const sideImgOpts = {
      assetId: post.sourceCardId || post.id,
      authorId: post.authorId,
      sourceCardId: post.sourceCardId
    };
    const sideInitial = showSideImg ? communityImgInitialSrc(sideRef, sideImgOpts) : '';
    const sideImgLoading = showSideImg && (!sideInitial || sideInitial.includes('data:image/svg'));
    const imgBlock = showSideImg
      ? `<button type="button" class="community-side-img-btn${sideImgLoading ? ' is-loading' : ''}" data-side-zoom data-author-id="${esc(post.authorId || '')}" data-post-id="${esc(post.id)}" data-source-card-id="${esc(post.sourceCardId || '')}" title="点击放大"><img class="community-side-img" src="${esc(sideInitial)}" data-image-ref="${esc(sideRef)}" data-author-id="${esc(post.authorId || '')}" data-post-id="${esc(post.id)}" data-source-card-id="${esc(post.sourceCardId || '')}"${storageAttr} alt="" decoding="async" onload="if(typeof finishCardMediaShine==='function')finishCardMediaShine(this.closest('.community-side-img-btn'))"></button>`
      : '';
    if (isCreationsMode) {
      const card = post.sourceCardId
        ? (window.__promptHubCards || []).find((c) => String(c.id) === String(post.sourceCardId))
        : null;
      const pubOn = card?.publishedToCommunity === true;
      body.innerHTML = `
      ${imgBlock}
      <p class="community-side-author">我的发布 · ${esc(formatTime(post.createdAt))}</p>
      <div class="community-side-prompt">${esc(post.prompt)}</div>
      <div class="panel-publish-row creations-publish-row">
        <div class="panel-publish-copy">
          <span class="panel-publish-title">公开到提示词社区</span>
          <p class="panel-hint">关闭并保存后立即从社区下架；开启后他人可见</p>
        </div>
        <button type="button" class="publish-circle-btn${pubOn ? ' is-on' : ''}" id="creationsPublishToggle" aria-pressed="${pubOn ? 'true' : 'false'}" aria-label="公开到提示词社区"></button>
      </div>
      <div class="community-side-actions">
        <button type="button" class="btn btn-secondary" data-action="copy">复制提示词</button>
        ${card ? '<button type="button" class="btn btn-secondary" data-action="edit-card">在卡片库编辑</button>' : ''}
      </div>`;
      body.querySelector('#creationsPublishToggle')?.addEventListener('click', (e) => {
        e.preventDefault();
        void toggleMyPublishedPostVisibility(id);
      });
      body.querySelector('[data-action="copy"]')?.addEventListener('click', () => copyPostPromptOnly(post));
      body.querySelector('[data-action="edit-card"]')?.addEventListener('click', () => {
        if (!card?.id) return;
        closeCreationsSidePanel();
        if (typeof switchAppPage === 'function') switchAppPage('warehouse');
        if (typeof window.editCardById === 'function') window.editCardById(card.id);
      });
      bindCommunitySideImageZoom(body, post, sideRef, id);
      highlightCreationsPost(id);
      if (showSideImg) {
        window.MediaPipeline?.patchContainerFromCache?.(body);
        void hydrateFeedImages(body);
      }
      return;
    }
    const faved = favIds.has(id);
    const liked = likedIds.has(id);
    body.innerHTML = `
      ${imgBlock}
      <p class="community-side-author">
        <button type="button" class="community-detail-author-btn" data-author-id="${esc(post.authorId)}" data-author-name="${esc(post.authorName)}">${esc(post.authorName)}</button>
        · ${esc(formatTime(post.createdAt))}
      </p>
      <div class="community-side-prompt">${esc(post.prompt)}</div>
      <div class="community-side-stats">
        <span>${communityLikeCountText(post.likes)}</span>
        <span>${faved ? '已收藏' : '未收藏'}</span>
      </div>
      <div class="community-side-actions">
        <button type="button" class="btn btn-secondary" data-action="like">${liked ? '已点赞' : '点赞'}</button>
        <button type="button" class="btn btn-secondary" data-action="copy">复制</button>
        <button type="button" class="btn btn-secondary" data-action="fav">${faved ? '已收藏' : '收藏'}</button>
        <button type="button" class="btn btn-primary" data-action="remix">制作同款</button>
      </div>
      <p class="panel-hint">复制、收藏、制作同款会默认为作者点赞（每个作品仅计一次）</p>`;
    body.querySelector('[data-action="like"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      likeCommunityPostOnly(id);
    });
    body.querySelector('[data-action="copy"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      copyPostPrompt(post);
    });
    body.querySelector('[data-action="fav"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      favoritePost(id, post);
    });
    body.querySelector('[data-action="remix"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      remixToImageGen(post);
    });
    bindCommunitySideImageZoom(body, post, sideRef, id);
    const authorBtn = body.querySelector('.community-detail-author-btn');
    if (authorBtn) bindAuthorLink(authorBtn, post.authorId, post.authorName);
    highlightCommunityCard(id);
    if (showSideImg) {
      window.MediaPipeline?.patchContainerFromCache?.(body);
      void hydrateFeedImages(body);
    }
    const timeEl = document.querySelector(`#communityGrid .card[data-post-id="${id}"] .card-time`);
    if (timeEl) {
      timeEl.textContent = communityLikeCountText(post.likes);
      if (likedIds.has(id)) timeEl.classList.add('liked');
    }
  }

  function getFeatureSidePanelWorkspace(panelId) {
    if (panelId === 'creationsSidePanel') {
      return document.querySelector('#pageCreations .community-workspace');
    }
    return document.querySelector('#pageCommunity .community-workspace');
  }

  function getFeatureSidePanelMountRoot() {
    if (isMobileViewport()) return document.body;
    return document.querySelector('.app-chrome') || document.body;
  }

  /** 桌面「我的主页」侧栏挂到 app-chrome，避免 my-home-shell 滚动链裁切 */
  function shouldMountCreationsPanelOnRoot() {
    if (isMobileViewport()) return true;
    return document.getElementById('pageCreations')?.classList.contains('active');
  }

  function shouldMountFeatureSidePanelOnRoot(panelId) {
    if (panelId === 'creationsSidePanel') return shouldMountCreationsPanelOnRoot();
    return isMobileViewport();
  }

  function ensureFeatureSidePanelDocked(panelId) {
    if (shouldMountFeatureSidePanelOnRoot(panelId)) return;
    if (isMobileViewport()) return;
    unmountFeatureSidePanel(panelId);
    const panel = document.getElementById(panelId);
    const home = getFeatureSidePanelWorkspace(panelId);
    if (!panel || !home) return;
    if (panel.parentElement !== home) {
      home.appendChild(panel);
    }
  }

  function syncCommunityPanelOpenClass() {
    const panelOpen =
      !document.getElementById('communitySidePanel')?.classList.contains('hidden')
      || !document.getElementById('creationsSidePanel')?.classList.contains('hidden');
    const onFeedPage =
      document.getElementById('pageCommunity')?.classList.contains('active')
      || document.getElementById('pageCreations')?.classList.contains('active');
    document.body.classList.toggle(
      'community-panel-open',
      panelOpen && (isMobileViewport() || onFeedPage)
    );
  }

  function mountFeatureSidePanel(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel || !shouldMountFeatureSidePanelOnRoot(panelId)) return;
    if (panel.dataset.mountedOnBody === '1') return;
    panel._phOriginalParent = panel.parentElement;
    panel._phOriginalNext = panel.nextSibling;
    getFeatureSidePanelMountRoot().appendChild(panel);
    panel.dataset.mountedOnBody = '1';
  }

  function syncCreationsSidePanelMount() {
    const panel = document.getElementById('creationsSidePanel');
    if (!panel) return;
    unmountFeatureSidePanel('creationsSidePanel');
    ensureFeatureSidePanelDocked('creationsSidePanel');
    if (!panel.classList.contains('hidden')) {
      mountFeatureSidePanel('creationsSidePanel');
    }
  }

  function unmountFeatureSidePanel(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel || panel.dataset.mountedOnBody !== '1') return;
    const parent = panel._phOriginalParent;
    if (parent) {
      if (panel._phOriginalNext && panel._phOriginalNext.parentNode === parent) {
        parent.insertBefore(panel, panel._phOriginalNext);
      } else {
        parent.appendChild(panel);
      }
    }
    delete panel.dataset.mountedOnBody;
  }

  function isCommunityQuickPreviewActive() {
    return communityAppreciateActive || document.body.classList.contains('community-appreciate');
  }

  function relayoutFeedGridAfterSidePanel(containerId) {
    if (isMobileViewport()) return;
    if (containerId === 'communityGrid') {
      scheduleCommunityLayout(containerId, { force: true, immediate: true, recalcCols: true });
      return;
    }
    if (containerId === 'creationsGrid') {
      scheduleCommunityLayout(containerId, { force: true, immediate: true, recalcCols: true });
    }
  }

  function openPostSidePanel(id, ctx, opts = {}) {
    if (ctx === 'community' && isCommunityQuickPreviewActive()) {
      const post = opts.post || findPost(id, { sourceCardId: opts.sourceCardId });
      if (post) {
        void openCommunityAppreciateViewer(post);
        return;
      }
    }
    window.closeAppreciateViewer?.();
    if (communityAppreciateActive) exitCommunityAppreciate(true);
    if (typeof window.setViewerNav === 'function') window.setViewerNav([], '');
    const post = opts.post || findPost(id, {
      sourceCardId: opts.sourceCardId
    });
    if (!post) {
      console.warn('[community] post not found for side panel', id);
      return;
    }
    id = post.id;
    const isCreations = ctx === 'creations';
    communitySidePostId = id;
    openPostId = id;
    const gridId = isCreations ? 'creationsGrid' : 'communityGrid';
    const grid = document.getElementById(gridId);
    releaseFeedScrollLock();
    const panelId = isCreations ? 'creationsSidePanel' : 'communitySidePanel';
    ensureFeatureSidePanelDocked(panelId);
    mountFeatureSidePanel(panelId);
    document.getElementById(panelId)?.classList.remove('hidden');
    syncCommunityPanelOpenClass();
    const panel = document.getElementById(panelId);
    if (panel) {
      panel.classList.remove('community-side-panel--closing');
      panel.classList.add('community-side-panel--open');
    }
    if (isMobileViewport()) {
      window.MobileUI?.closeDrawers?.();
    }
    document.querySelectorAll(`#${gridId} .community-post-card.selected`).forEach((el) => el.classList.remove('selected'));
    document.querySelector(`#${gridId} .community-post-card[data-post-id="${id}"]`)?.classList.add('selected');
    void renderCommunitySidePanel(id, {
      post,
      bodyId: isCreations ? 'creationsSideBody' : 'communitySideBody',
      titleId: isCreations ? 'creationsSideTitle' : 'communitySideTitle',
      mode: isCreations ? 'creations' : 'community'
    });
  }

  function openCommunitySidePanel(id, opts = {}) {
    openPostSidePanel(id, 'community', opts);
  }

  function openCommunityAppreciateById(postId) {
    if (!postId) return;
    const post = findPost(String(postId));
    if (post) void openCommunityAppreciateViewer(post);
  }

  function exitCommunityAppreciate(skipLayout) {
    communityAppreciateActive = false;
    appreciateViewerPostId = null;
    window.closeAppreciateViewer?.();
    if (typeof window.setViewerNav === 'function') window.setViewerNav([], '');
    document.getElementById('communityAppreciateBtn')?.classList.remove('active');
    document.body.classList.remove('community-appreciate', 'global-view', 'global-view-entering', 'global-view-exiting', 'appreciate-viewing');
    if (!skipLayout) scheduleCommunityLayout('communityGrid');
  }

  function onAppreciateViewerClose() {
    appreciateViewerPostId = null;
  }

  function bumpAppreciateViewerGen() {
    appreciateViewerGen += 1;
  }

  function toggleCommunityAppreciate() {
    if (communityAppreciateActive) {
      window.closeAppreciateViewer?.();
      exitCommunityAppreciate();
      return;
    }
    window.markQuickPreviewTask?.({ communityUsed: true });
    communityAppreciateActive = true;
    closeCommunitySidePanel();
    document.getElementById('communityAppreciateBtn')?.classList.add('active');
    document.body.classList.add('community-appreciate', 'global-view-entering');
    setTimeout(() => {
      document.body.classList.add('global-view');
      document.body.classList.remove('global-view-entering');
      scheduleCommunityLayout('communityGrid', { force: true, immediate: true });
    }, 480);
  }

  async function openCommunityAppreciateViewer(post) {
    if (!post) return;
    window.markQuickPreviewTask?.({ communityUsed: true });
    window.syncAppreciateViewerActions?.('community');
    const list = filterAndSortPosts(getCommunityFeedForDisplay()).filter(isFeedRenderablePost);
    const navItems = list.map((p) => ({ type: 'post', id: p.id, key: `post:${p.id}` }));
    if (typeof window.setViewerNav === 'function') {
      window.setViewerNav(navItems, `post:${post.id}`);
    }
    const gen = ++appreciateViewerGen;
    const viewer = document.getElementById('appreciateViewer');
    const img = document.getElementById('appreciateViewerImg');
    const caption = document.getElementById('appreciateViewerCaption');
    const hint = document.querySelector('.appreciate-viewer-hint');
    const actions = document.getElementById('appreciateViewerActions');
    const favBtn = document.getElementById('appreciateViewerFavBtn');
    if (!viewer || !img) return;
    appreciateViewerPostId = post.id;
    const alreadyOpen = viewer.classList.contains('active');
    if (!alreadyOpen) {
      viewer.classList.remove('active');
      document.body.classList.remove('appreciate-viewing');
    }
    if (typeof window.resetImageZoom === 'function') window.resetImageZoom(img);
    const title = getPostTitle(post);
    const prompt = (post.prompt || '').trim();
    if (caption) {
      caption.textContent = title || (prompt ? prompt.slice(0, 120) + (prompt.length > 120 ? '…' : '') : '');
      caption.style.display = caption.textContent ? 'block' : 'none';
    }
    if (favBtn) {
      const label = favBtn.querySelector('span');
      const text = favIds.has(post.id) ? '已收藏' : '收藏到卡片库';
      if (label) label.textContent = text;
      else favBtn.textContent = text;
      favBtn.disabled = favIds.has(post.id);
    }
    actions?.classList.remove('hidden');
    const imageRef = communityPostDisplayImageRef(post);
    const signOpts = {
      assetId: post.sourceCardId || post.id,
      authorId: post.authorId || undefined,
      cardId: post.sourceCardId || undefined,
      communityFeed: true,
      tryAllPaths: true,
      variant: 'full'
    };
    const isPlaceholderSrc = (src) => !src || String(src).includes('data:image/svg');

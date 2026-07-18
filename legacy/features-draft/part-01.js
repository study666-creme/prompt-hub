/**
 * 提示词社区 / 我的创作 / 图片生成 — 功能草案
 */
(function () {
  const LS_COMMUNITY = 'promptrepo_community_posts';
  const LS_CREATIONS = 'promptrepo_creations';
  const LS_LIKES = 'promptrepo_community_likes';
  const LS_FAVS = 'promptrepo_community_favorites';
  const LS_IMAGEGEN = 'promptrepo_imagegen_draft';
  const LS_IMAGEGEN_MODELS = 'promptrepo_imagegen_models_cache_v3';
  const IMAGE_GEN_CATALOG_CACHE_VERSION = 9;
  const LS_SESSION_GEN_JOBS = 'promptrepo_session_gen_jobs';
  const LS_PENDING_GEN_JOBS = 'promptrepo_pending_gen_jobs';
  const LS_FAILED_GEN_JOBS = 'promptrepo_failed_gen_jobs';
  /** 手机切后台/重载后 sessionStorage 易丢，localStorage 备份 pending + session 任务 */
  const LS_GEN_JOBS_STATE = 'promptrepo_gen_jobs_state_v1';
  const PREFILL_KEY = 'promptrepo_imagegen_prefill';

  const GEN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
  const MIN_COMMUNITY_PROMPT_LEN = 15;
  /** 与 server syncBodySchema.posts.max(80) 一致 */
  const COMMUNITY_SYNC_BATCH_MAX = 80;
  /** 首屏 DOM 卡片数（列数×行数） */
  const IMAGEGEN_FEED_PER_PAGE = 12;
  const IMAGEGEN_FEED_PENDING_CAP = 6;
  const IMAGEGEN_FEED_FAILED_CAP = 4;

  /** @see MobileUI.isMobileViewport — 全站手机断点唯一入口 */
  function isMobileViewport() {
    return window.MobileUI?.isMobileViewport?.() ?? window.matchMedia('(max-width: 900px)').matches;
  }

  /** 手机生图「生成」tab：首屏只需表单，不必拉作品 feed / 全量云同步 */
  function isImageGenMobileFormActive() {
    return !!document.getElementById('pageImageGen')?.classList.contains('active')
      && isMobileViewport()
      && document.body.classList.contains('imagegen-mobile-view-form');
  }

  let imageGenBootSyncToken = 0;

  function scheduleImageGenBootSync(opts = {}) {
    const token = ++imageGenBootSyncToken;
    const pending = imageGenPendingJobs.length > 0 || getActivePollJobIds().size > 0;
    const mobileForm = isImageGenMobileFormActive();
    const delay = pending ? (opts.urgent ? 400 : 900) : (mobileForm ? 8000 : 2800);

    if (pending || opts.forceJobs) {
      scheduleGenJobsSync(delay);
    }

    const runQuiet = () => {
      if (token !== imageGenBootSyncToken) return;
      void quietSyncImageGenFromCloud();
      scheduleRecentCreationsServerSync({
        force: !!opts.forceRecent,
        render: !isImageGenMobileFormActive()
      }, pending ? 1200 : 2200);
    };
    if (mobileForm && !pending) {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(runQuiet, { timeout: 20000 });
      } else {
        setTimeout(runQuiet, 10000);
      }
    } else if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(runQuiet, { timeout: pending ? 6000 : 12000 });
    } else {
      setTimeout(runQuiet, pending ? 2500 : 6000);
    }
  }

  /** 云同步统一入口（优先 SyncOrchestrator） */
  function queueCloudPush(opts = {}) {
    if (!window.SupabaseSync?.isLoggedIn?.()) return;
    if (window.SyncOrchestrator?.schedulePush) {
      window.SyncOrchestrator.schedulePush(opts);
      return;
    }
    window.scheduleCloudPush?.(opts);
  }

  function queueUrgentCardsSync() {
    if (!window.SupabaseSync?.isLoggedIn?.()) return;
    if (window.SyncOrchestrator?.notifyCardsChanged) {
      window.SyncOrchestrator.notifyCardsChanged({ urgent: true });
      return;
    }
    window.scheduleCloudPush?.({ urgent: true });
  }

  /** 列表图加载占位（与 feed-images.js 同值；须在 wire* 之前可用） */
  const IMG_LOADING_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect fill="%2318181c" width="16" height="16"/></svg>'
  );

  function genRetentionMs() {
    return GEN_RETENTION_MS;
  }

  function normalizeGenJobBaseId(jobId) {
    if (!jobId) return '';
    return String(jobId).replace(/#\d+$/, '');
  }

  function isGenerationJobDeleted(jobId) {
    if (!jobId) return false;
    const t = window.getDeletedGenerationJobTombstones?.() || {};
    const key = String(jobId);
    if (t[key]) return true;
    const base = normalizeGenJobBaseId(key);
    return base && t[base];
  }

  function dedupeCreationsByJobId(list) {
    const noJob = [];
    const byJob = new Map();
    for (const c of list || []) {
      if (!c?.id) continue;
      const j = c.jobId;
      if (!j) {
        noJob.push(c);
        continue;
      }
      const prev = byJob.get(j);
      if (!prev || (c.createdAt || 0) >= (prev.createdAt || 0)) byJob.set(j, c);
    }
    const merged = [...noJob, ...byJob.values()];
    merged.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return merged;
  }

  let communityPosts = [];
  /** 全站 API Feed，不被 reconcile 裁剪（解决「库里有帖、登录却看不到」） */
  const publicFeedState = window.CommunityPublicFeed?.createState?.() || {
    posts: [], at: 0, apiOffset: 0, nextApiOffset: 0,
    remoteHasMore: true, loading: false, refreshPromise: null, moreInflight: false
  };
  let creations = [];
  let likedIds = new Set();
  let favIds = new Set();
  let creationsTab = 'private';
  let communitySort = 'random';
  let communityRandomSig = '';
  let communityRandomOrder = new Map();
  let communityRandomEpoch = 0;
  let communityMediaFilter = 'all';
  let communityScope = 'all';
  let follows = new Set();
  let notifications = [];
  let communityEvents = [];
  let imageGenGenPublicSession = null;
  /** 未保存前的单卡发布草稿（cardId → boolean；新建卡用 __new__） */
  const publishDrafts = new Map();
  let openPostId = null;
  let openProfileAuthorId = null;
  const REF_TARGET_MAX_BYTES = 8 * 1024 * 1024;
  const REF_MAX_SIDE = 2560;
  let imageGenLastResult = null;
  let imageGenActiveHistoryId = null;
  let imageGenFeedTab = 'recent';
  /** @type {Array<{id:string,prompt:string,model:string,modelLabel:string,resolution:string,quality:string,size:string,cost:number,startedAt:number,jobId?:string,batchIndex?:number,batchTotal?:number,batchId?:string}>} */
  let imageGenPendingJobs = [];
  /** @type {Array<{id:string,prompt:string,errorMessage:string,failedAt:number,modelLabel?:string,batchIndex?:number,batchTotal?:number,batchId?:string}>} */
  let imageGenFailedJobs = [];
  /** null = 本次进入生图页尚未手动改过；离开后再进会重置 */
  let imageGenAutoPublishSession = null;
  let imageGenAutoSaveSession = null; /* legacy — 自动入库已移除 */
  let imageGenMasonry = null;
  let imageGenWhGroup = 'all';
  let imageGenWhTag = 'all';
  /* Masonry 实例在 feed-layout.js */
  let communitySidePostId = null;
  let creationsSideId = null;
  let communityAppreciateActive = false;
  let appreciateViewerPostId = null;
  let appreciateViewerGen = 0;
  let imageGenPreviewId = null;
  let imageGenPreviewKind = null;
  let imageGenPreviewRenderSeq = 0;
  let imageGenFeedPagedStore = null;
  let imageGenFeedScrollLoading = false;
  let layoutCommunityTimer = null;
  let communityFeedRenderGen = 0;
  const FEED_PER_PAGE = 24;
  const MOBILE_FEED_PER_PAGE = 12;

  function feedPageSize(containerId = 'communityGrid') {
    if (
      isMobileViewport()
      && (containerId === 'communityGrid' || containerId === 'creationsGrid')
    ) {
      return MOBILE_FEED_PER_PAGE;
    }
    return FEED_PER_PAGE;
  }
  const feedPagedStore = {};
  const feedPagedScrollBound = {};
  const feedScrollIntent = {};
  let feedScrollLockUntil = 0;
  let feedScrollLockAnchor = null;
  let feedScrollLockClearTimer = null;
  let feedUserScrollUntil = 0;
  let imageGenLayoutTimer = null;
  const displayUrlCache = new Map();
  let communityPostsSyncInflight = null;
  let lastCommunityPostsSyncAt = 0;
  let communitySyncTransientWarned = false;
  const COMMUNITY_POSTS_SYNC_GAP_MS = 120000;
  /** 首屏可渲染的最少帖数（一页）；其余后台拉完再增量追加 */
  const PUBLIC_FEED_MIN_READY = FEED_PER_PAGE;
  let publicFeedRefreshPromise = null;

  let progressiveCommunityRenderTimer = null;
  function scheduleProgressiveCommunityRender(forceRepaint = false) {
    clearTimeout(progressiveCommunityRenderTimer);
    progressiveCommunityRenderTimer = setTimeout(() => {
      if (!document.getElementById('pageCommunity')?.classList.contains('active')) return;
      if (communityScope === 'curated') return;
      if (publicFeedState.posts.length < PUBLIC_FEED_MIN_READY) return;
      const grid = document.getElementById('communityGrid');
      if (!grid) return;
      const hasReal = grid.querySelector('.community-post-card:not(.community-feed-skeleton)');
      const sorted = filterAndSortPosts(getCommunityFeedForDisplay());
      if (hasReal && !forceRepaint && shouldPreserveCommunityFeedDom('communityGrid', sorted)) {
        void growCommunityFeedAfterPublicRefresh('communityGrid');
        return;
      }
      renderCommunityNow({ skipFeedFetch: true, forceRepaint: forceRepaint || !hasReal });
    }, 48);
  }

  /** 卡片库已勾选「发布到社区」但尚未写入 communityPosts 的条目 */
  function buildPostsFromPublishedCards() {
    const user = getActiveUser();
    if (user.id === 'guest') return [];
    const out = [];
    for (const c of window.__promptHubCards || []) {
      if (!c?.id) continue;
      if (!cardPublishedToCommunity(c)) continue;
      if (!isCommunityPromptEligible(c.prompt)) continue;
      const existing = communityPosts.find((p) => p.sourceCardId === c.id);
      out.push({
        id: c.communityPostId || existing?.id || `cp_${c.id}`,
        sourceCardId: c.id,
        authorId: user.id,
        authorName: user.name,
        title: (c.title || '').trim() || '',
        prompt: c.prompt || '',
        image: c.image ?? existing?.image ?? null,
        likes: existing?.likes || 0,
        createdAt: existing?.createdAt || c.createdAt || c.updatedAt || Date.now(),
        updatedAt: Math.max(existing?.updatedAt || 0, c.updatedAt || 0) || existing?.createdAt || c.createdAt || 0
      });
    }
    return out;
  }

  function collectMyCommunityPostsForSync() {
    const user = getActiveUser();
    if (user.id === 'guest') return [];
    const merged = buildPostsFromPublishedCards();
    for (const p of merged) {
      const cardImg = cardImageForPost(p);
      if (cardImg) p.image = cardImg;
    }
    return merged;
  }

  function isUsableCommunityImage(image, opts = {}) {
    if (!image || !isDisplayableImage(image)) return false;
    if (window.SupabaseSync?.isInvalidMediaUrl?.(image)) return false;
    const path = window.SupabaseSync?.storagePathFromRef?.(image);
    if (path && window.SupabaseSync?.isPathKnownMissing?.(path)) return false;
    return true;
  }

  /** 卡片库是否应展示图片区（无有效图时不占位） */
  function isUsableWarehouseImage(card) {
    if (!card) return false;
    if (window.SupabaseSync?.shouldShowCardInWarehouse?.(card) === false) return false;
    const image = window.PromptHubCardGallery?.getCardCoverImage?.(card) || card.image;
    if (!image || !isDisplayableImage(image)) return false;
    if (window.SupabaseSync?.isInvalidMediaUrl?.(image)) return false;
    if (/^https?:\/\//i.test(image)) return true;
    if (window.SupabaseSync?.isDataUrl?.(image) && !/^data:image\/svg/i.test(image)) return true;
    if (window.SupabaseSync?.isStorageRef?.(image)) {
      const path = window.SupabaseSync.storagePathFromRef?.(image);
      if (path && window.SupabaseSync?.isPathKnownMissing?.(path)) return false;
      const primary = window.SupabaseSync?.primaryImagePath?.(image, card.id);
      if (primary && window.SupabaseSync?.isPathKnownMissing?.(primary)) return false;
      if (window.SupabaseSync?.cardImageStillResolvable?.(image, card.id) === false) return false;
      return true;
    }
    return false;
  }

  function getWarehouseCardKind(card) {
    return isUsableWarehouseImage(card) ? 'visual' : 'text';
  }

  function isGeneratedWarehouseCard(card) {
    if (!card) return false;
    const tags = Array.isArray(card.tags) ? card.tags : [];
    if (tags.includes('图片生成')) return true;
    const inspireTag = window.INSPIRE_DRAW_TAG || '灵感抽卡';
    if (tags.includes(inspireTag)) return true;
    return !!(card.genJobId || card.genSourceId);
  }

  /** 公开社区图：优先卡片库真实路径，忽略无效的 api 域名直链 */
  function canonicalCommunityImageRef(post, opts = {}) {
    if (!post) return null;
    const cardImg = cardImageForPost(post);
    let image = (cardImg && isUsableCommunityImage(cardImg, opts)) ? cardImg : (post.image || null);
    if (image && window.SupabaseSync?.normalizeImageRef) {
      image = window.SupabaseSync.normalizeImageRef(image) || image;
    }
    if (image && !isUsableCommunityImage(image, opts)) return null;
    return image;
  }

  function communityFeedCardImageRef(post) {
    const fromDisplay = communityPostDisplayImageRef(post, { feedList: true });
    if (fromDisplay) return fromDisplay;
    const cardImg = cardImageForPost(post);
    if (cardImg && isDisplayableImage(cardImg)) return cardImg;
    const raw = post?.image;
    if (!raw || !isDisplayableImage(raw)) return null;
    if (window.SupabaseSync?.isInvalidMediaUrl?.(raw)) return null;
    return window.SupabaseSync?.normalizeImageRef?.(raw) || raw;
  }

  /** 社区展示用图：与 isFeedRenderablePost / 渲染卡片保持一致，避免「有图却显示无配图」 */
  function communityPostDisplayImageRef(post, opts = {}) {
    const feedList = !!opts.feedList;
    const usableOpts = feedList ? { feedList: true } : {};
    const canonical = canonicalCommunityImageRef(post, usableOpts);
    if (canonical && isDisplayableImage(canonical)) return canonical;
    const raw = post?.image;
    if (!raw || !isDisplayableImage(raw)) return null;
    if (window.SupabaseSync?.isInvalidMediaUrl?.(raw)) return null;
    if (!feedList) {
      const path = window.SupabaseSync?.storagePathFromRef?.(raw);
      if (path && window.SupabaseSync?.isPathKnownMissing?.(path)) return null;
    }
    if (window.SupabaseSync?.normalizeImageRef) {
      return window.SupabaseSync.normalizeImageRef(raw) || raw;
    }
    return raw;
  }


  function postForPublicApi(post) {
    const card = post.sourceCardId
      ? (window.__promptHubCards || []).find((c) => c.id === post.sourceCardId)
      : null;
    let image = post.image || null;
    if (card?.image && isDisplayableImage(card.image)) image = card.image;
    if (image && window.SupabaseSync?.normalizeImageRef) {
      image = window.SupabaseSync.normalizeImageRef(image) || image;
    }
    return {
      id: post.id,
      sourceCardId: post.sourceCardId || null,
      authorName: post.authorName,
      title: post.title || '',
      prompt: post.prompt || '',
      image,
      likes: post.likes || 0,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt
    };
  }

  async function pushPostToPublicFeed(post) {
    if (!post?.id || !window.PromptHubApi?.publishCommunityPost) return;
    if (!window.SupabaseSync?.isLoggedIn?.()) return;
    if (!communityPromptPassesLocalModeration(post.prompt)) {
      toast('内容不符合社区规范，无法发布');
      return;
    }
    try {
      const r = await window.PromptHubApi.publishCommunityPost(postForPublicApi(post));
      if (!r?.ok) {
        const msg = r?.error?.message || r?.message || '';
        if (r?.error?.code === 'CONTENT_REJECTED' || /CONTENT_REJECTED|社区规范/.test(msg)) {
          toast(msg || '配图或提示词不符合社区规范');
        } else {
          console.warn('[community] publish public failed', r);
        }
      } else publicFeedState.at = 0;
    } catch (e) {
      console.warn('[community] publish public error', e);
    }
  }

  function communityPromptPassesLocalModeration(prompt) {
    const text = String(prompt || '').trim();
    if (!text) return false;
    const blocked = [
      /儿童色情|幼女|萝莉控|恋童|未成年.{0,6}(裸|裸体)/i,
      /强奸|轮奸|乱伦|兽交/i,
      /制毒|贩毒|吸毒|冰毒|海洛因/i
    ];
    return !blocked.some((re) => re.test(text));
  }

  function ownPostAllowedInFeed(post) {
    if (!post || !isCurrentUserPost(post)) return true;
    if (!post.sourceCardId) return false;
    const card = (window.__promptHubCards || []).find((c) => c.id === post.sourceCardId);
    return card?.publishedToCommunity === true;
  }

  function filterFeedPostsForPublishFlags(posts) {
    return (posts || []).filter(ownPostAllowedInFeed);
  }

  /** 仅从全站 Feed 恢复「库中无卡」的发布标记（仅手动「从社区恢复」时调用） */
  function restorePublishedFlagsFromFeed() {
    const uid = window.SupabaseSync?.getUserId?.();
    if (!uid || !publicFeedState.posts.length) return false;
    const cards = window.__promptHubCards || [];
    if (!cards.length) return false;
    let dirty = false;
    for (const p of publicFeedState.posts) {
      if (!p?.sourceCardId) continue;
      const owner = authorIdFromPostImage(p) || String(p.authorId || '');
      if (owner !== String(uid)) continue;
      const card = cards.find((c) => String(c.id) === String(p.sourceCardId));
      if (!card) continue;
      if (card.publishedToCommunity !== true) {
        card.publishedToCommunity = true;
        dirty = true;
      }
      if (p.id && String(card.communityPostId || '') !== String(p.id)) {
        card.communityPostId = p.id;
        dirty = true;
      }
    }
    if (dirty && typeof window.persistPromptHubCards === 'function') {
      void window.persistPromptHubCards({ skipCloud: true });
    }
    return dirty;
  }

  const COMMUNITY_COLLECT_TAG = '社区收藏';

  function isCommunityCollectCard(card) {
    return !!(card && (card.tags || []).includes(COMMUNITY_COLLECT_TAG));
  }

  function applyPublishToggleUi(on) {
    const editing = window.__promptHubGetEditingCard?.();
    const blocked = isCommunityCollectCard(editing);
    const btn = document.getElementById('cardPublishToggle');
    if (!btn) return;
    if (blocked) {
      btn.classList.remove('is-on');
      btn.setAttribute('aria-pressed', 'false');
      btn.disabled = true;
      btn.title = '社区收藏卡片不可发布到社区';
      return;
    }
    btn.disabled = false;
    btn.removeAttribute('title');
    btn.classList.toggle('is-on', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function resolvePublishCard(card) {
    if (card) return card;
    return window.__promptHubGetEditingCard?.() || null;
  }

  function publishDraftKey(card) {
    const resolved = resolvePublishCard(card);
    if (resolved?.id) return String(resolved.id);
    if (typeof window.__promptHubIsNewCard === 'function' && window.__promptHubIsNewCard()) return '__new__';
    return null;
  }

  function getCardPublishIntent(card) {
    const resolved = resolvePublishCard(card);
    if (isCommunityCollectCard(resolved)) return false;
    const key = resolved?.id ? String(resolved.id) : '__new__';
    if (publishDrafts.has(key)) return publishDrafts.get(key) === true;
    if (resolved) return resolved.publishedToCommunity === true;
    const prompt = getCardFormPromptText();
    return computeAutoCommunityToggle(prompt, getDefaultPublishChecked(), null);
  }

  function setCardPublishIntent(card, on) {
    if (on === true && isCommunityCollectCard(card)) {
      toast('社区收藏卡片不可发布到社区');
      return;
    }
    const key = publishDraftKey(card);
    if (!key) return;
    publishDrafts.set(key, on === true);
    applyPublishToggleUi(on === true);
  }

  function clearPublishDraft(cardId) {
    if (cardId) publishDrafts.delete(String(cardId));
    else publishDrafts.delete('__new__');
  }

  function syncPublishToggleForOpenCard() {
    const editing = window.__promptHubGetEditingCard?.();
    if (editing) setPublishCheckbox(editing);
    else if (typeof window.__promptHubIsNewCard === 'function' && window.__promptHubIsNewCard()) {
      setPublishCheckbox(null);
    }
  }

  async function applyCardPublishState(card, publish) {
    if (!card?.id) return;
    await syncCardToCommunity(card, publish === true, { silent: true, skipRender: true });
  }

  async function removePostFromPublicFeed(postId, opts = {}) {
    if (!postId) return;
    const sourceCardId = opts.sourceCardId ? String(opts.sourceCardId) : '';
    publicFeedState.posts = publicFeedState.posts.filter((p) => {
      if (p.id === postId) return false;
      if (sourceCardId && String(p.sourceCardId) === sourceCardId) return false;
      return true;
    });
    communityPosts = communityPosts.filter((p) => {
      if (p.id === postId) return false;
      if (sourceCardId && String(p.sourceCardId) === sourceCardId) return false;
      return true;
    });
    publicFeedState.at = 0;
    savePublicFeedCache(publicFeedState.posts);
    if (!window.PromptHubApi?.unpublishCommunityPost) return;
    if (!window.SupabaseSync?.isLoggedIn?.()) return;
    try {
      await window.PromptHubApi.unpublishCommunityPost(postId);
    } catch (e) {
      console.warn('[community] unpublish public error', e);
    }
  }

  function getCommunityFeedRenderedPostIds(containerId = 'communityGrid') {
    const grid = document.getElementById(containerId);
    if (!grid) return new Set();
    return new Set(
      [...grid.querySelectorAll('.card[data-post-id]')]
        .map((c) => String(c.dataset.postId || ''))
        .filter(Boolean)
    );
  }

  /** 真实 Feed 卡（排除骨架占位），用于避免 feedSig 命中后误跳过整页渲染 */
  function hasRealCommunityFeedCards(container) {
    if (!container) return false;
    return !!container.querySelector('.community-post-card:not(.community-feed-skeleton)[data-post-id]');
  }

  function communityFeedDomHasDuplicates(containerId = 'communityGrid') {
    const grid = document.getElementById(containerId);
    if (!grid) return false;
    const cards = grid.querySelectorAll('.card[data-post-id]').length;
    const unique = getCommunityFeedRenderedPostIds(containerId).size;
    return cards > 0 && unique > 0 && unique < cards;
  }

  function inferFeedStorePageFromDom(containerId = 'communityGrid') {
    const rendered = getCommunityFeedRenderedPostIds(containerId).size;
    if (!rendered) return 1;
    return Math.max(1, Math.ceil(rendered / feedPageSize(containerId)));
  }

  function resetCommunityFeedGrid(containerId = 'communityGrid') {
    const container = document.getElementById(containerId);
    if (!container) return;
    window.FeedLayout?.destroyLayout?.(containerId);
    container.innerHTML = '';
    delete container.dataset.feedSig;
    delete container.dataset.feedFinalized;
    delete container.dataset.feedLayoutReady;
    delete container.dataset.feedDistributed;
    delete container.dataset.feedDistributedCols;
    delete container.dataset.feedLayoutCols;
    delete feedPagedStore[containerId];
    feedScrollIntent[containerId] = false;
    delete container.dataset.feedPageDone;
    container.scrollTop = 0;
  }

  function syncFeedPagedStoreFromDisplay(containerId = 'communityGrid') {
    let next = filterAndSortPosts(getCommunityFeedForDisplay()).filter(isFeedRenderablePost);
    if (containerId === 'communityGrid') {
      const seen = new Set();
      next = next.filter((p) => {
        const key = p.sourceCardId ? `c:${p.sourceCardId}` : `p:${p.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    const sig = feedListSignature(next, containerId);
    const store = feedPagedStore[containerId];
    if (!store) {
      feedPagedStore[containerId] = {
        sig,
        posts: next,
        page: inferFeedStorePageFromDom(containerId),
        remoteExhausted: false
      };
      return next.length;
    }
    const prevLen = store.posts.length;
    store.posts = next;
    store.sig = sig;
    const domPage = inferFeedStorePageFromDom(containerId);
    if (domPage > store.page) store.page = domPage;
    if (next.length > prevLen) {
      store.remoteExhausted = false;
      const grid = document.getElementById(containerId);
      if (grid) delete grid.dataset.feedPageDone;
    }
    return Math.max(0, next.length - prevLen);
  }

  let communityFeedPageLoading = false;
  let feedPageScrollThrottle = 0;

  function feedPageDebugEnabled() {
    try {
      return localStorage.getItem('promptrepo_feed_page_debug') === '1'
        || window.__PH_FEED_PAGE_DEBUG__ === true;
    } catch (e) {
      return window.__PH_FEED_PAGE_DEBUG__ === true;
    }
  }

  function logFeedPageDebug(containerId, label, extra = {}) {
    if (!feedPageDebugEnabled()) return;
    const store = feedPagedStore[containerId];
    const g = document.getElementById(containerId);
    const scrollEl = g ? (getFeedScrollRoot(g) || g) : null;
    const domUnique = getCommunityFeedRenderedPostIds(containerId).size;
    const localEnd = store ? store.page * feedPageSize(containerId) >= store.posts.length : true;
    console.log('[feed-page]', label, {
      containerId,
      page: store?.page,
      storeTotal: store?.posts?.length,
      domUnique,
      localEnd,
      remoteExhausted: store?.remoteExhausted,
      publicFeedRemoteHasMore: publicFeedState.remoteHasMore,
      apiNextOffset: publicFeedState.nextApiOffset,
      publicPosts: publicFeedState.posts.length,
      nearBottom: scrollEl
        ? scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 140
        : null,
      ...extra
    });
  }

  function getPendingFeedPosts(store, containerId, limit) {
    if (!store?.posts?.length) return [];
    const cap = Number.isFinite(limit) && limit > 0 ? limit : feedPageSize(containerId);
    const seen = getCommunityFeedRenderedPostIds(containerId);
    return store.posts.filter((p) => !seen.has(String(p.id))).slice(0, cap);
  }

  function countFeedDomUnique(containerId = 'communityGrid') {
    return getCommunityFeedRenderedPostIds(containerId).size;
  }

  function canLoadMoreFeedPages(containerId = 'communityGrid') {
    return !feedDrainComplete(containerId);
  }

  function markFeedPageScrollDone(containerId) {
    const container = document.getElementById(containerId);
    if (container?.__feedPageIo) {
      container.__feedPageIo.disconnect();
      container.__feedPageIo = null;
    }
    container && (container.dataset.feedPageDone = '1');
  }

  function feedDrainComplete(containerId = 'communityGrid') {
    const store = feedPagedStore[containerId];
    if (!store?.posts?.length) return true;
    const domUnique = countFeedDomUnique(containerId);
    if (domUnique >= store.posts.length) return true;
    if (getPendingFeedPosts(store, containerId, 1).length) return false;
    if (!store.remoteExhausted && publicFeedState.remoteHasMore) return false;
    return true;
  }

  async function drainCommunityFeedPagesUntilDone(containerId = 'communityGrid', maxRounds = 96) {
    window.__PH_FEED_BULK_DRAIN__ = true;
    try {
      for (let round = 0; round < maxRounds; round += 1) {
        if (feedDrainComplete(containerId)) break;
        const before = countFeedDomUnique(containerId);
        await drainCommunityFeedPages(containerId, 6);
        await new Promise((r) => requestAnimationFrame(r));
        if (feedDrainComplete(containerId)) break;
        if (countFeedDomUnique(containerId) === before) break;
      }
    } finally {
      window.__PH_FEED_BULK_DRAIN__ = false;
      finishCommunityFeedLayoutAfterBatch(containerId);
    }
  }

  /** 已出图的 Feed 卡：清 is-loading + 内联高度，避免 4/5 骨架盒残留造成列内「假大间距」 */
  function scrubCommunityFeedCardMediaHeights(container) {
    if (!container?.querySelectorAll) return;
    container.querySelectorAll('.community-feed-col .card .card-media').forEach((media) => {
      const img = media.querySelector('img.card-img');
      if (!img) return;
      const src = img.currentSrc || img.src || '';
      const loaded = img.complete
        && img.naturalWidth > 8
        && /^https?:\/\//i.test(src)
        && !src.includes('data:image/svg');
      if (!loaded) return;
      if (media.classList.contains('is-loading') || media.classList.contains('card-media--await')) {
        releaseFeedMediaLoading(media);
      }
      media.style.removeProperty('min-height');
      media.style.removeProperty('height');
      media.style.removeProperty('max-height');
      media.style.removeProperty('aspect-ratio');
      img.style.removeProperty('position');
      img.style.removeProperty('inset');
      img.style.removeProperty('height');
      img.style.removeProperty('max-height');
      img.style.removeProperty('visibility');
      img.style.removeProperty('opacity');
    });
  }

  function scrubCommunityFeedFlexCards(container) {
    window.FeedLayout?.scrubFlexCards?.(container);
  }

  function syncCommunityFeedColumnCount(containerId) {
    window.FeedLayout?.syncColumnCount?.(containerId);
  }

  function ensureCommunityFeedColumnLayout(containerId) {
    window.FeedLayout?.ensureColumnLayout?.(containerId);
  }

  function isCreationsFeedLayoutStale(container) {
    return window.FeedLayout?.isCreationsStale?.(container) ?? false;
  }

  function isCommunityFeedLayoutReady(container, containerId) {
    return window.FeedLayout?.isLayoutReady?.(container, containerId) ?? false;
  }

  function repairCommunityFeedLayout(containerId) {
    if (containerId === 'communityGrid' && window.FeedLayout?.repairCommunityMasonry?.(containerId)) {
      return true;
    }
    return window.FeedLayout?.repairFlex?.(containerId) ?? false;
  }

  function repairCreationsFeedLayout(force = false) {
    return window.FeedLayout?.repairCreations?.(force) ?? false;
  }

  function scheduleCommunityFeedHeightBalance(_containerId) {
    /* flex 多列：禁止按图片加载全墙 DOM 重分；间距靠 CSS */
  }

  function appendFeedCardsLayout(containerId, appendedCards) {
    window.FeedLayout?.appendCards?.(containerId, appendedCards);
  }

  async function loadNextCommunityFeedPage(containerId = 'communityGrid') {
    if (communityFeedPageLoading) return false;
    const store = feedPagedStore[containerId];
    if (!store?.posts?.length) {
      logFeedPageDebug(containerId, 'skip_no_store');
      return false;
    }
    communityFeedPageLoading = true;
    try {
      const beforeDom = countFeedDomUnique(containerId);
      let batch = getPendingFeedPosts(store, containerId);
      if (!batch.length) {
        const hasMore = await ensureFeedStoreHasMore(containerId);
        logFeedPageDebug(containerId, 'ensure_remote', { hasMore, pending: 0 });
        if (!hasMore) return false;
        batch = getPendingFeedPosts(store, containerId);
        if (!batch.length) return false;
      }
      store.page = Math.max(
        store.page || 1,
        Math.ceil((beforeDom + batch.length) / feedPageSize(containerId))
      );
      await renderPostsIntoContainer(store.posts, containerId, {
        feedAppend: true,
        feedAppendPosts: batch
      });
      const afterDom = countFeedDomUnique(containerId);
      logFeedPageDebug(containerId, 'appended', {
        batch: batch.length,
        beforeDom,
        afterDom,
        pendingAfter: getPendingFeedPosts(store, containerId, 1).length
      });
      return afterDom > beforeDom;
    } finally {
      communityFeedPageLoading = false;
      const container = document.getElementById(containerId);
      if (container) {
        ensureFeedPageSentinel(container);
        reconnectFeedPageObserver(containerId);
        finishCommunityFeedLayoutAfterBatch(containerId);
      }
      feedScrollIntent[containerId] = false;
    }
  }

  async function drainCommunityFeedPages(containerId = 'communityGrid', maxPages = 12) {
    if (feedDrainComplete(containerId)) {
      markFeedPageScrollDone(containerId);
      return;
    }
    for (let i = 0; i < maxPages; i += 1) {
      if (feedDrainComplete(containerId)) {
        logFeedPageDebug(containerId, 'drain_complete', { round: i });
        markFeedPageScrollDone(containerId);
        break;
      }
      const beforeDom = countFeedDomUnique(containerId);
      const loaded = await loadNextCommunityFeedPage(containerId);
      const afterDom = countFeedDomUnique(containerId);
      if (!loaded && afterDom === beforeDom) {
        logFeedPageDebug(containerId, 'drain_stuck', { round: i, beforeDom, afterDom });
        markFeedPageScrollDone(containerId);
        break;
      }
    }
    if (feedDrainComplete(containerId)) {
      markFeedPageScrollDone(containerId);
    }
    finishCommunityFeedLayoutAfterBatch(containerId);
    if (containerId === 'creationsGrid' || containerId === 'communityGrid') {
      requestAnimationFrame(() => ensureCommunityFeedColumnLayout(containerId));
    }
  }

  async function growCommunityFeedAfterPublicRefresh(containerId = 'communityGrid') {
    if (communityScope === 'curated') return;
    if (communityFeedDomHasDuplicates(containerId)) {
      resetCommunityFeedGrid(containerId);
    }
    const grid = document.getElementById(containerId);
    scrubStaleCommunityFeedEmpty(grid);
    const added = syncFeedPagedStoreFromDisplay(containerId);
    const store = feedPagedStore[containerId];
    if (!store || !store.posts.length) return;
    const rendered = getCommunityFeedRenderedPostIds(containerId).size;
    if (!rendered) {
      await renderPostsIntoContainer(store.posts, containerId);
    }
    if (added > 0) delete grid?.dataset?.feedPageDone;
    ensureFeedPageSentinel(grid);
    reconnectFeedPageObserver(containerId);
  }

  function shouldPreserveCommunityFeedDom(containerId = 'communityGrid', list) {
    const store = feedPagedStore[containerId];
    const grid = document.getElementById(containerId);
    if (!grid || !store?.posts?.length) return false;
    if (!hasRealCommunityFeedCards(grid)) return false;
    if (communityFeedDomHasDuplicates(containerId)) return false;
    const posts = list || filterAndSortPosts(getCommunityFeedForDisplay());
    const sig = feedListSignature(posts, containerId);
    if (grid.dataset.feedSig !== sig) return false;
    const rendered = getCommunityFeedRenderedPostIds(containerId).size;
    const firstPageTarget = Math.min(feedPageSize(containerId), store.posts.length);
    return rendered >= firstPageTarget;
  }

  function scheduleCommunityFeedInitialDrain(containerId = 'communityGrid') {
    if (!useFeedPagedRender(containerId)) return;
    requestAnimationFrame(() => reconnectFeedPageObserver(containerId));
  }

  function appendRenderableToFeedStore(containerId, rawPosts) {
    const store = feedPagedStore[containerId];
    if (!store || !rawPosts?.length) return 0;
    const seen = new Set(store.posts.map((p) => String(p.id)));
    let incoming = rawPosts.filter(isFeedRenderablePost).filter((p) => !seen.has(String(p.id)));
    if (!incoming.length) return 0;
    if (communitySort === 'new') {
      incoming.sort(comparePostsByActivityDesc);
    } else if (communitySort === 'hot') {
      incoming.sort(comparePostsByLikesDesc);
    } else {

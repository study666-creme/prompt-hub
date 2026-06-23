/**
 * 提示词社区 / 我的创作 / 图片生成 — 功能草案
 */
(function () {
  const LS_COMMUNITY = 'promptrepo_community_posts';
  const LS_CREATIONS = 'promptrepo_creations';
  const LS_LIKES = 'promptrepo_community_likes';
  const LS_FAVS = 'promptrepo_community_favorites';
  const LS_IMAGEGEN = 'promptrepo_imagegen_draft';
  const LS_IMAGEGEN_MODELS = 'promptrepo_imagegen_models_cache_v2';
  const LS_SESSION_GEN_JOBS = 'promptrepo_session_gen_jobs';
  const LS_PENDING_GEN_JOBS = 'promptrepo_pending_gen_jobs';
  const LS_FAILED_GEN_JOBS = 'promptrepo_failed_gen_jobs';
  /** 手机切后台/重载后 sessionStorage 易丢，localStorage 备份 pending + session 任务 */
  const LS_GEN_JOBS_STATE = 'promptrepo_gen_jobs_state_v1';
  const PREFILL_KEY = 'promptrepo_imagegen_prefill';

  const GEN_RETENTION_MIN_MS = 1 * 24 * 60 * 60 * 1000;
  const GEN_RETENTION_MAX_MS = 3 * 24 * 60 * 60 * 1000;
  const MIN_COMMUNITY_PROMPT_LEN = 15;
  /** 与 server syncBodySchema.posts.max(80) 一致 */
  const COMMUNITY_SYNC_BATCH_MAX = 80;
  /** 首屏 DOM 卡片数（列数×行数） */
  const IMAGEGEN_FEED_PER_PAGE = 24;
  const IMAGEGEN_FEED_PENDING_CAP = 6;
  const IMAGEGEN_FEED_FAILED_CAP = 4;

  /** @see MobileUI.isMobileViewport — 全站手机断点唯一入口 */
  function isMobileViewport() {
    return window.MobileUI?.isMobileViewport?.() ?? window.matchMedia('(max-width: 900px)').matches;
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

  function randomGenRetentionMs() {
    return GEN_RETENTION_MIN_MS + Math.floor(Math.random() * (GEN_RETENTION_MAX_MS - GEN_RETENTION_MIN_MS + 1));
  }

  const finishingJobIds = new Set();

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
  let publicFeedPosts = [];
  let creations = [];
  let likedIds = new Set();
  let favIds = new Set();
  let creationsTab = 'private';
  let communitySort = 'random';
  let communityRandomSig = '';
  let communityRandomOrder = new Map();
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
  const MAX_REF_IMAGES = 16;
  /** 参考图展示解析时附带卡片 id（从仓库填入时提高 storage:// 命中率） */
  let imageGenRefResolveAssetId = '';
  const REF_INPUT_MAX_BYTES = 50 * 1024 * 1024;
  const REF_AUTO_COMPRESS_BYTES = 12 * 1024 * 1024;
  const REF_TARGET_MAX_BYTES = 8 * 1024 * 1024;
  const REF_MAX_SIDE = 2560;
  const REF_THUMB_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect fill="#2a2a2e" width="100%" height="100%" rx="6"/></svg>'
  );
  let imageGenRefImages = [];
  let imageGenLastResult = null;
  let imageGenActiveHistoryId = null;
  let imageGenFeedTab = 'warehouse';
  /** @type {Array<{id:string,prompt:string,model:string,modelLabel:string,resolution:string,quality:string,size:string,cost:number,startedAt:number,jobId?:string,batchIndex?:number,batchTotal?:number,batchId?:string}>} */
  let imageGenPendingJobs = [];
  /** @type {Array<{id:string,prompt:string,errorMessage:string,failedAt:number,modelLabel?:string,batchIndex?:number,batchTotal?:number,batchId?:string}>} */
  let imageGenFailedJobs = [];
  /** null = 本次进入生图页尚未手动改过；离开后再进会重置 */
  let imageGenAutoPublishSession = null;
  let imageGenAutoSaveSession = null;
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
  const feedPagedStore = {};
  const feedPagedScrollBound = {};
  const feedScrollIntent = {};
  let imageGenLayoutTimer = null;
  const displayUrlCache = new Map();
  let publicFeedAt = 0;
  let publicFeedApiOffset = 0;
  /** 下次向 API 請求的 offset（與 publicFeedPosts.length 脫鉤，避免去重後偏移錯位） */
  let publicFeedNextApiOffset = 0;
  let publicFeedRemoteHasMore = true;
  let publicFeedLoading = false;
  let communityPostsSyncInflight = null;
  let lastCommunityPostsSyncAt = 0;
  const COMMUNITY_POSTS_SYNC_GAP_MS = 120000;
  const PUBLIC_FEED_TTL_MS = 120_000;
  const PUBLIC_FEED_CACHE_VERSION = 7;
  /** 首屏可渲染的最少帖数（一页）；其余后台拉完再增量追加 */
  const PUBLIC_FEED_MIN_READY = FEED_PER_PAGE;
  const LS_PUBLIC_FEED_CACHE = 'promptrepo_public_feed_cache';
  let publicFeedRefreshPromise = null;

  function loadPublicFeedCache() {
    try {
      const raw = localStorage.getItem(LS_PUBLIC_FEED_CACHE);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.posts)) return null;
      if (data.v !== PUBLIC_FEED_CACHE_VERSION) {
        localStorage.removeItem(LS_PUBLIC_FEED_CACHE);
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  function hydratePublicFeedFromCache() {
    if (publicFeedAt > 0) return true;
    const cached = loadPublicFeedCache();
    if (!cached?.posts?.length) return false;
    if (cached.posts.length < PUBLIC_FEED_MIN_READY) {
      localStorage.removeItem(LS_PUBLIC_FEED_CACHE);
      return false;
    }
    publicFeedPosts = cached.posts.map(normalizeFeedPost).filter(Boolean);
    publicFeedAt = cached.cachedAt || Date.now();
    publicFeedApiOffset = publicFeedPosts.length;
    publicFeedNextApiOffset = publicFeedPosts.length;
    publicFeedRemoteHasMore = true;
    return publicFeedPosts.length > 0;
  }

  function publicFeedNeedsFullRefresh() {
    return publicFeedAt === 0
      || publicFeedPosts.length < PUBLIC_FEED_MIN_READY
      || Date.now() - publicFeedAt >= PUBLIC_FEED_TTL_MS;
  }

  let progressiveCommunityRenderTimer = null;
  function scheduleProgressiveCommunityRender(forceRepaint = false) {
    clearTimeout(progressiveCommunityRenderTimer);
    progressiveCommunityRenderTimer = setTimeout(() => {
      if (!document.getElementById('pageCommunity')?.classList.contains('active')) return;
      if (communityScope === 'curated') return;
      if (publicFeedPosts.length < PUBLIC_FEED_MIN_READY) return;
      const grid = document.getElementById('communityGrid');
      if (!grid) return;
      const hasReal = grid.querySelector('.community-post-card:not(.community-feed-skeleton)');
      if (hasReal && !forceRepaint && shouldPreserveCommunityFeedDom('communityGrid')) {
        void growCommunityFeedAfterPublicRefresh('communityGrid');
        return;
      }
      renderCommunityNow({ skipFeedFetch: true, forceRepaint: forceRepaint || !hasReal });
    }, 48);
  }

  function savePublicFeedCache(posts) {
    try {
      const list = (posts || []).filter((p) => p && !p.isMock);
      if (!list.length) {
        localStorage.removeItem(LS_PUBLIC_FEED_CACHE);
        return;
      }
      localStorage.setItem(
        LS_PUBLIC_FEED_CACHE,
        JSON.stringify({ v: PUBLIC_FEED_CACHE_VERSION, posts: list, cachedAt: Date.now() })
      );
    } catch (e) { /* ignore */ }
  }

  function normalizeFeedPost(p) {
    if (!p || p.isMock) return null;
    return {
      id: String(p.id || ''),
      sourceCardId: p.sourceCardId ?? p.source_card_id ?? null,
      authorId: String(p.authorId ?? p.author_id ?? ''),
      authorName: String(p.authorName ?? p.author_name ?? '用户'),
      title: String(p.title || ''),
      prompt: String(p.prompt || ''),
      image: p.image ?? null,
      likes: Math.max(0, Number(p.likes) || 0),
      createdAt: Number(p.createdAt ?? p.created_at) || Date.now(),
      updatedAt: Number(p.updatedAt ?? p.updated_at) || Date.now()
    };
  }

  function authorIdFromPostImage(post) {
    const image = post?.image;
    if (!image || !window.SupabaseSync?.storagePathFromRef) return '';
    const path = window.SupabaseSync.storagePathFromRef(image) || '';
    const head = path.replace(/^\//, '').split('/')[0] || '';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(head)) {
      return head;
    }
    return '';
  }

  function communityPostDisplayKey(p) {
    if (!p) return '';
    if (p.sourceCardId) return `card:${p.sourceCardId}`;
    const owner = authorIdFromPostImage(p) || String(p.authorId || '');
    const prompt = String(p.prompt || '').trim().slice(0, 160).toLowerCase();
    if (prompt && owner) return `prompt:${owner}:${prompt}`;
    return p.id ? `id:${p.id}` : '';
  }

  function mergePostsLists(...lists) {
    const map = new Map();
    for (const list of lists) {
      for (const p of list || []) {
        if (!p || p.isMock) continue;
        const key = communityPostDisplayKey(p);
        if (!key) continue;
        const prev = map.get(key);
        const ts = p.updatedAt || p.createdAt || 0;
        const prevTs = prev ? (prev.updatedAt || prev.createdAt || 0) : -1;
        if (!prev || ts >= prevTs) map.set(key, p);
      }
    }
    return [...map.values()];
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
    const image = card.image;
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
      } else publicFeedAt = 0;
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
    if (!uid || !publicFeedPosts.length) return false;
    const cards = window.__promptHubCards || [];
    if (!cards.length) return false;
    let dirty = false;
    for (const p of publicFeedPosts) {
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
    publicFeedPosts = publicFeedPosts.filter((p) => {
      if (p.id === postId) return false;
      if (sourceCardId && String(p.sourceCardId) === sourceCardId) return false;
      return true;
    });
    communityPosts = communityPosts.filter((p) => {
      if (p.id === postId) return false;
      if (sourceCardId && String(p.sourceCardId) === sourceCardId) return false;
      return true;
    });
    publicFeedAt = 0;
    savePublicFeedCache(publicFeedPosts);
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
    return Math.max(1, Math.ceil(rendered / FEED_PER_PAGE));
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
    container.scrollTop = 0;
  }

  function syncFeedPagedStoreFromDisplay(containerId = 'communityGrid') {
    const next = filterAndSortPosts(getCommunityFeedForDisplay()).filter(isFeedRenderablePost);
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
    if (next.length > prevLen) store.remoteExhausted = false;
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
    const localEnd = store ? store.page * FEED_PER_PAGE >= store.posts.length : true;
    console.log('[feed-page]', label, {
      containerId,
      page: store?.page,
      storeTotal: store?.posts?.length,
      domUnique,
      localEnd,
      remoteExhausted: store?.remoteExhausted,
      publicFeedRemoteHasMore,
      apiNextOffset: publicFeedNextApiOffset,
      publicPosts: publicFeedPosts.length,
      nearBottom: scrollEl
        ? scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 140
        : null,
      ...extra
    });
  }

  function getPendingFeedPosts(store, containerId, limit = FEED_PER_PAGE) {
    if (!store?.posts?.length) return [];
    const seen = getCommunityFeedRenderedPostIds(containerId);
    return store.posts.filter((p) => !seen.has(String(p.id))).slice(0, limit);
  }

  function countFeedDomUnique(containerId = 'communityGrid') {
    return getCommunityFeedRenderedPostIds(containerId).size;
  }

  function feedDrainComplete(containerId = 'communityGrid') {
    const store = feedPagedStore[containerId];
    if (!store?.posts?.length) return true;
    const domUnique = countFeedDomUnique(containerId);
    if (domUnique >= store.posts.length) return true;
    if (getPendingFeedPosts(store, containerId, 1).length) return false;
    if (!store.remoteExhausted && publicFeedRemoteHasMore) return false;
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
    feedScrollIntent[containerId] = true;
    try {
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
        Math.ceil((countFeedDomUnique(containerId) + batch.length) / FEED_PER_PAGE)
      );
      await renderPostsIntoContainer(store.posts, containerId, {
        feedAppend: true,
        feedAppendPosts: batch
      });
      logFeedPageDebug(containerId, 'appended', { batch: batch.length, pendingAfter: getPendingFeedPosts(store, containerId, 1).length });
      return true;
    } finally {
      communityFeedPageLoading = false;
      const container = document.getElementById(containerId);
      if (container) {
        ensureFeedPageSentinel(container);
        reconnectFeedPageObserver(containerId);
        finishCommunityFeedLayoutAfterBatch(containerId);
      }
    }
  }

  async function drainCommunityFeedPages(containerId = 'communityGrid', maxPages = 12) {
    for (let i = 0; i < maxPages; i += 1) {
      if (feedDrainComplete(containerId)) {
        logFeedPageDebug(containerId, 'drain_complete', { round: i });
        break;
      }
      const beforeDom = countFeedDomUnique(containerId);
      const loaded = await loadNextCommunityFeedPage(containerId);
      const afterDom = countFeedDomUnique(containerId);
      if (!loaded && afterDom === beforeDom) {
        logFeedPageDebug(containerId, 'drain_stuck', { round: i, beforeDom, afterDom });
        break;
      }
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
    const target = store.posts.length;
    if (!rendered) {
      await renderPostsIntoContainer(store.posts, containerId);
    }
    if (added > 0 || rendered < target) {
      await drainCommunityFeedPages(containerId, 3);
    }
  }

  function shouldPreserveCommunityFeedDom(containerId = 'communityGrid') {
    const store = feedPagedStore[containerId];
    const grid = document.getElementById(containerId);
    if (!grid || !store?.posts?.length) return false;
    if (!hasRealCommunityFeedCards(grid)) return false;
    if (communityFeedDomHasDuplicates(containerId)) return false;
    const rendered = getCommunityFeedRenderedPostIds(containerId).size;
    const domCards = grid.querySelectorAll('.card[data-post-id]').length;
    const firstPageTarget = Math.min(FEED_PER_PAGE, store.posts.length);
    if (rendered > 0 && rendered < firstPageTarget) return false;
    if (rendered > 0 && rendered < domCards) return false;
    if (domCards > store.page * FEED_PER_PAGE + FEED_PER_PAGE) return false;
    return domCards > FEED_PER_PAGE || (store.page || 0) > 1 || !!feedScrollIntent[containerId];
  }

  function scheduleCommunityFeedInitialDrain(containerId = 'communityGrid') {
    if (!useFeedPagedRender(containerId)) return;
    void drainCommunityFeedPages(containerId, 6);
  }

  function mergePublicFeedHead(incoming) {
    const next = (incoming || []).map(normalizeFeedPost).filter(Boolean);
    if (!next.length) return false;
    if (!publicFeedPosts.length || publicFeedPosts.length <= next.length) {
      publicFeedPosts = next;
      publicFeedApiOffset = Math.max(publicFeedApiOffset, next.length);
      return true;
    }
    const upd = new Map(next.map((p) => [String(p.id), p]));
    publicFeedPosts = publicFeedPosts.map((p) => upd.get(String(p.id)) || p);
    const seen = new Set(publicFeedPosts.map((p) => String(p.id)));
    const fresh = next.filter((p) => !seen.has(String(p.id)));
    if (fresh.length) publicFeedPosts = [...fresh, ...publicFeedPosts];
    return true;
  }

  async function fetchAllPublicCommunityFeedPages(timeoutMs = 22000) {
    if (!window.PromptHubApi?.getCommunityFeed) return null;
    if (window.PromptHubApi?.prepareApiCall) await window.PromptHubApi.prepareApiCall();
    else window.__PH_API_DOWN_UNTIL__ = 0;
    const merged = new Map();
    let offset = 0;
    const pageSize = 100;
    let lastFeedRes = null;
    for (let round = 0; round < 60; round += 1) {
      let batch = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const r = await window.PromptHubApi.getCommunityFeed({
          limit: pageSize,
          offset,
          timeoutMs,
          skipUnreachableMark: true
        });
        if (r?.ok && Array.isArray(r.data?.posts)) {
          batch = r.data.posts;
          lastFeedRes = r;
          break;
        }
        if (attempt < 2) await new Promise((res) => setTimeout(res, 700 + attempt * 900));
      }
      if (!batch) return merged.size ? [...merged.values()] : null;
      if (!batch.length) break;
      for (const raw of batch) {
        const p = normalizeFeedPost(raw);
        if (p) merged.set(String(p.id), p);
      }
      publicFeedPosts = sortPostsByActivity([...merged.values()]);
      const nextOff = Number(lastFeedRes?.data?.nextOffset);
      offset = Number.isFinite(nextOff) && nextOff > offset ? nextOff : offset + batch.length;
      publicFeedApiOffset = offset;
      publicFeedNextApiOffset = offset;
      publicFeedRemoteHasMore = lastFeedRes?.data?.hasMore === true
        || (lastFeedRes?.data?.hasMore !== false && batch.length >= pageSize);
      savePublicFeedCache(publicFeedPosts);
      if (merged.size >= PUBLIC_FEED_MIN_READY) scheduleProgressiveCommunityRender();
      if (!publicFeedRemoteHasMore || batch.length < pageSize) break;
    }
    if (merged.size) publicFeedRemoteHasMore = false;
    return sortPostsByActivity([...merged.values()]);
  }

  async function refreshPublicCommunityFeed(opts = {}) {
    if (!window.PromptHubApi?.getCommunityFeed) return false;
    if (publicFeedLoading) return false;
    const loggedIn = window.SupabaseSync?.isLoggedIn?.();
    if (!opts.force && !publicFeedNeedsFullRefresh() && publicFeedPosts.length > 0) {
      return false;
    }
    publicFeedLoading = true;
    const prevPubSig = publicFeedPosts.map((p) => `${p.id}:${p.updatedAt || 0}`).join('|');
    try {
      const fetched = await fetchAllPublicCommunityFeedPages(opts.timeoutMs || 20000);
      if (!fetched?.length) {
        const cached = loadPublicFeedCache();
        if (cached?.posts?.length && publicFeedAt === 0) {
          const cachedSig = cached.posts.map((p) => `${p.id}:${p.updatedAt || 0}`).join('|');
          if (cachedSig !== prevPubSig) {
            publicFeedPosts = cached.posts.map(normalizeFeedPost).filter(Boolean);
            publicFeedAt = cached.cachedAt || Date.now();
            publicFeedApiOffset = Math.max(publicFeedApiOffset, publicFeedPosts.length);
            return true;
          }
          return false;
        }
        return false;
      }
      publicFeedPosts = fetched;
      publicFeedAt = Date.now();
      publicFeedApiOffset = publicFeedNextApiOffset;
      publicFeedRemoteHasMore = false;
      savePublicFeedCache(publicFeedPosts);
      if (loggedIn) {
        if (window.CloudSyncSafety?.mergeCommunityPostsList) {
          const pubForLocal = filterFeedPostsForPublishFlags(publicFeedPosts);
          communityPosts = mergePostsLists(
            window.CloudSyncSafety.mergeCommunityPostsList(communityPosts, pubForLocal),
            buildPostsFromPublishedCards()
          );
          saveJson(LS_COMMUNITY, communityPosts.filter((p) => !p.isMock));
        }
      }
      rebuildOwnPostFilterCache();
      invalidateCommunityReconcileCache();
      pruneLocalCommunityNotOnServer();
      const nextPubSig = publicFeedPosts.map((p) => `${p.id}:${p.updatedAt || 0}`).join('|');
      return nextPubSig !== prevPubSig;
    } catch (e) {
      console.warn('[community] public feed failed', e);
      if (publicFeedAt > 0 && Date.now() - publicFeedAt < 5 * 60 * 1000) return false;
      const cached = loadPublicFeedCache();
      if (cached?.posts?.length && !publicFeedPosts.length) {
        publicFeedPosts = cached.posts.map(normalizeFeedPost).filter(Boolean);
        publicFeedAt = cached.cachedAt || Date.now();
        publicFeedApiOffset = Math.max(publicFeedApiOffset, publicFeedPosts.length);
        return true;
      }
      return false;
    } finally {
      publicFeedLoading = false;
    }
  }

  let communityFeedMoreInflight = false;

  /** 滚动分页见底后，按 offset 向 API 拉下一批。返回 null=网络失败（勿标记耗尽），[]=已无更多。 */
  async function fetchMorePublicCommunityFeed() {
    if (!window.PromptHubApi?.getCommunityFeed || communityFeedMoreInflight || publicFeedLoading) return null;
    if (!publicFeedRemoteHasMore) return [];
    communityFeedMoreInflight = true;
    try {
      const offset = publicFeedNextApiOffset;
      const limit = 100;
      const r = await window.PromptHubApi.getCommunityFeed({ limit, offset, timeoutMs: 20000 });
      if (!r?.ok || !Array.isArray(r.data?.posts)) {
        logFeedPageDebug('communityGrid', 'api_fetch_fail', { offset, code: r?.code });
        return null;
      }
      const batch = r.data.posts;
      const nextOff = Number(r.data?.nextOffset);
      const hasMore = r.data?.hasMore === true
        || (r.data?.hasMore !== false && batch.length >= limit);
      publicFeedNextApiOffset = Number.isFinite(nextOff) && nextOff > offset
        ? nextOff
        : offset + batch.length;
      publicFeedApiOffset = publicFeedNextApiOffset;
      publicFeedRemoteHasMore = hasMore && batch.length > 0;
      if (!batch.length) {
        publicFeedRemoteHasMore = false;
        logFeedPageDebug('communityGrid', 'api_exhausted', { offset });
        return [];
      }
      const seen = new Set(publicFeedPosts.map((p) => String(p.id)));
      const added = [];
      for (const raw of batch) {
        const p = normalizeFeedPost(raw);
        if (!p || seen.has(String(p.id))) continue;
        seen.add(String(p.id));
        publicFeedPosts.push(p);
        added.push(p);
      }
      if (added.length) {
        publicFeedAt = Date.now();
        savePublicFeedCache(publicFeedPosts);
      }
      logFeedPageDebug('communityGrid', 'api_batch', {
        offset,
        batch: batch.length,
        added: added.length,
        nextOffset: publicFeedNextApiOffset,
        hasMore: publicFeedRemoteHasMore
      });
      return added.length ? added : batch.map(normalizeFeedPost).filter(Boolean);
    } catch (e) {
      console.warn('[community] fetch more feed failed', e);
      return null;
    } finally {
      communityFeedMoreInflight = false;
    }
  }

  function appendRenderableToFeedStore(containerId, rawPosts) {
    const store = feedPagedStore[containerId];
    if (!store || !rawPosts?.length) return 0;
    const seen = new Set(store.posts.map((p) => String(p.id)));
    let incoming = rawPosts.filter(isFeedRenderablePost).filter((p) => !seen.has(String(p.id)));
    if (!incoming.length) return 0;
    if (communitySort === 'new') {
      incoming.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } else if (communitySort === 'hot') {
      incoming.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    } else {
      incoming = shuffleCommunityPosts(incoming);
    }
    store.posts.push(...incoming);
    return incoming.length;
  }

  async function ensureFeedStoreHasMore(containerId) {
    const store = feedPagedStore[containerId];
    if (!store) return false;
    if (store.page * FEED_PER_PAGE < store.posts.length) return true;
    if (store.remoteExhausted && !publicFeedRemoteHasMore) {
      logFeedPageDebug(containerId, 'remote_exhausted_local_end');
      return false;
    }
    let attempts = 0;
    while (attempts < 12) {
      attempts += 1;
      if (!publicFeedRemoteHasMore) {
        store.remoteExhausted = true;
        logFeedPageDebug(containerId, 'no_more_api', { attempts });
        return false;
      }
      const batch = await fetchMorePublicCommunityFeed();
      if (batch === null) {
        logFeedPageDebug(containerId, 'api_null_keep_local', { attempts });
        return store.page * FEED_PER_PAGE < store.posts.length;
      }
      if (!batch.length) {
        store.remoteExhausted = true;
        publicFeedRemoteHasMore = false;
        logFeedPageDebug(containerId, 'api_empty_done', { attempts });
        return false;
      }
      const added = appendRenderableToFeedStore(containerId, batch);
      if (added > 0) {
        store.remoteExhausted = !publicFeedRemoteHasMore;
        return true;
      }
      if (!publicFeedRemoteHasMore) {
        store.remoteExhausted = true;
        logFeedPageDebug(containerId, 'api_dupes_done', { attempts });
        return false;
      }
      // 满页但均已存在 store：offset 已推进，继续尝试下一批
    }
    return store.page * FEED_PER_PAGE < store.posts.length;
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
          if (r?.status === 429 || r?.code === 'RATE_LIMITED') {
            lastCommunityPostsSyncAt = Date.now() - COMMUNITY_POSTS_SYNC_GAP_MS + 300000;
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
      mjMode: meta.mjMode,
      mjSaveAllTiles: meta.mjSaveAllTiles
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
    const pubIds = new Set(publicFeedPosts.map((p) => String(p.id)));
    const pubCards = new Set(
      publicFeedPosts.map((p) => String(p.sourceCardId)).filter(Boolean)
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
    if (user.id === 'guest' || !publicFeedAt) return false;
    const pubIds = new Set(publicFeedPosts.map((p) => String(p.id)));
    const pubCards = new Set(
      publicFeedPosts.map((p) => String(p.sourceCardId)).filter(Boolean)
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

  function clearAllLocalFeatureData() {
    communityPosts = [];
    publicFeedPosts = [];
    creations = [];
    likedIds = new Set();
    favIds = new Set();
    communityEvents = [];
    notifications = [];
    publicFeedAt = 0;
    publicFeedRefreshPromise = null;
    try {
      localStorage.removeItem(LS_COMMUNITY);
      localStorage.removeItem(LS_CREATIONS);
      localStorage.removeItem(LS_LIKES);
      localStorage.removeItem(LS_FAVS);
      localStorage.removeItem(LS_PUBLIC_FEED_CACHE);
      sessionStorage.removeItem('promptrepo_guest_session');
      sessionStorage.removeItem('promptrepo_pending_guest_migrate');
      sessionStorage.removeItem(LS_PENDING_GEN_JOBS);
      sessionStorage.removeItem(LS_FAILED_GEN_JOBS);
      sessionStorage.removeItem(LS_SESSION_GEN_JOBS);
      localStorage.removeItem(LS_GEN_JOBS_STATE);
    } catch (e) { /* ignore */ }
    imageGenPendingJobs = [];
    imageGenFailedJobs = [];
    activePollJobIds.clear();
    resetFeatureFeedDom();
    updateNotifyBadge();
    closeCommunitySidePanel();
    closeCreationsSidePanel();
    closeUserProfile();
  }

  function clearSensitiveLocalStateOnSignOut() {
    clearAllLocalFeatureData();
    renderCommunity({ immediate: true, skipFeedFetch: true });
    void renderCreations();
    if (document.getElementById('pageImageGen')?.classList.contains('active')) renderImageGenFeed();
  }

  function reloadStores() {
    loadStores();
  }

  function loadStores() {
    const loggedInBoot = window.SupabaseSync?.isLoggedIn?.();
    communityPosts = filterCommunityPostsForDisplay(loadJson(LS_COMMUNITY, []));
    if (!loggedInBoot) {
      communityPosts = [];
      publicFeedPosts = [];
      publicFeedAt = 0;
    }
    creations = dedupeCreationsByJobId(filterCreationsForCloud(loadJson(LS_CREATIONS, [])));
    likedIds = new Set(loadJson(LS_LIKES, []));
    favIds = new Set(loadJson(LS_FAVS, []));
    loadFollows();
    loadNotifications();
    updateNotifyBadge();
    stripDemoCreations();
    pruneCreations();
    migrateCommunityAuthorIds();
    pruneOrphanFeatureData();
    loadPendingGenJobs();
    loadFailedGenJobs();
    if (imageGenPendingJobs.length > 0) {
      requestAnimationFrame(() => {
        renderImageGenFeed({ preserveScroll: true });
        renderImageGenMobileResult();
      });
    }
    scheduleGenJobsSync(0);
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
      publicFeedAt = 0;
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

  function pruneCreations() {
    const now = Date.now();
    const before = creations.length;
    creations = creations.filter(c =>
      c.visibility === 'published' || c.permanent || !c.expiresAt || c.expiresAt > now
    );
    if (creations.length !== before) persistCreations();
  }

  function getDefaultPublishChecked() {
    if (typeof window.getDefaultPublishCommunity === 'function') {
      return window.getDefaultPublishCommunity();
    }
    return true;
  }

  function isCommunityPromptEligible(prompt) {
    return String(prompt || '').trim().length >= MIN_COMMUNITY_PROMPT_LEN;
  }

  function cardHasCommunityImage(cardOrImage) {
    const image = typeof cardOrImage === 'object' ? cardOrImage?.image : cardOrImage;
    if (!image || !isDisplayableImage(image)) return false;
    if (window.SupabaseSync?.isInvalidMediaUrl?.(image)) return false;
    const path = window.SupabaseSync?.storagePathFromRef?.(image);
    if (path && window.SupabaseSync?.isPathKnownMissing?.(path)) return false;
    if (!path && /^https?:\/\//i.test(image)) return false;
    return true;
  }

  function isCommunityPublishEligible(card) {
    if (!card) return false;
    if (!isCommunityPromptEligible(card.prompt)) return false;
    return cardHasCommunityImage(card);
  }

  /** globalDefaultOn：设置里是否开启默认；sessionOverride：用户手动切换 null=跟随规则 */
  function computeAutoCommunityToggle(prompt, globalDefaultOn, sessionOverride) {
    if (sessionOverride === true) return true;
    if (sessionOverride === false) return false;
    if (!globalDefaultOn) return false;
    return isCommunityPromptEligible(prompt);
  }

  function getCardFormPromptText() {
    return (
      document.getElementById('cardPrompt')?.value
      || document.getElementById('floatingPromptText')?.value
      || ''
    );
  }

  function syncCardPublishFromPrompt(prompt) {
    const editing = window.__promptHubGetEditingCard?.();
    if (editing) {
      applyPublishToggleUi(getCardPublishIntent(editing));
      return;
    }
    if (typeof window.__promptHubIsNewCard === 'function' && window.__promptHubIsNewCard()) {
      if (publishDrafts.has('__new__')) {
        applyPublishToggleUi(publishDrafts.get('__new__') === true);
        return;
      }
      const on = computeAutoCommunityToggle(
        prompt,
        getDefaultPublishChecked(),
        null
      );
      applyPublishToggleUi(on);
    }
  }

  function persistCommunity() {
    dedupeCommunityPosts({ persist: false });
    saveJson(LS_COMMUNITY, communityPosts.filter(p => !p.isMock));
    if (window.SupabaseSync?.isLoggedIn?.()) {
      queueCloudPush();
    }
  }

  function persistCreations() {
    saveJson(LS_CREATIONS, creations);
    if (window.SupabaseSync?.isLoggedIn?.()) {
      queueCloudPush();
    }
  }

  function persistLikes() {
    saveJson(LS_LIKES, [...likedIds]);
  }

  function persistFavs() {
    saveJson(LS_FAVS, [...favIds]);
  }

  let ownPostFilterCache = null;
  let lastReconcileSig = '';

  function rebuildOwnPostFilterCache() {
    const user = getActiveUser();
    const cards = window.__promptHubCards || [];
    ownPostFilterCache = {
      userId: user.id,
      cardIds: new Set(cards.map((c) => c.id)),
      linkedIds: new Set(cards.map((c) => c.communityPostId).filter(Boolean))
    };
  }

  function computeCardsCommunitySig(list) {
    let h = 0;
    for (const c of list) {
      h = ((h << 5) - h + String(c.id).length) | 0;
      h = ((h << 5) - h + (c.updatedAt || 0)) | 0;
      h = ((h << 5) - h + String(c.communityPostId || '').length) | 0;
      h = ((h << 5) - h + (c.publishedToCommunity ? 1 : 0)) | 0;
    }
    return `${list.length}:${h >>> 0}`;
  }

  function invalidateCommunityReconcileCache() {
    lastReconcileSig = '';
    ownPostFilterCache = null;
  }

  function maybeReconcileCommunityWithCards(cardList, opts = {}) {
    const list = Array.isArray(cardList) ? cardList : [];
    const user = getActiveUser();
    if (user.id === 'guest') return list;
    if (opts.force) lastReconcileSig = '';
    const sig = computeCardsCommunitySig(list);
    if (!opts.force && sig === lastReconcileSig) return list;
    lastReconcileSig = sig;
    return reconcileCommunityWithCards(list, opts);
  }

  function postActivityTs(p) {
    return Math.max(p?.updatedAt || 0, p?.createdAt || 0);
  }

  function sortPostsByActivity(list) {
    return [...(list || [])].sort((a, b) => postActivityTs(b) - postActivityTs(a));
  }

  function enrichPostsWithLocalTimestamps(posts) {
    const localByCard = new Map();
    for (const p of buildPostsFromPublishedCards()) {
      if (p?.sourceCardId) localByCard.set(String(p.sourceCardId), p);
    }
    for (const p of communityPosts) {
      if (!p?.sourceCardId) continue;
      const key = String(p.sourceCardId);
      const prev = localByCard.get(key);
      const ts = postActivityTs(p);
      if (!prev || ts >= postActivityTs(prev)) localByCard.set(key, p);
    }
    return (posts || []).map((p) => {
      if (!p?.sourceCardId) return p;
      const local = localByCard.get(String(p.sourceCardId));
      if (!local) return p;
      const next = {
        ...p,
        updatedAt: Math.max(p.updatedAt || 0, local.updatedAt || 0, local.createdAt || 0)
      };
      if (local.image && isUsableCommunityImage(local.image)) next.image = local.image;
      return next;
    });
  }
  function enrichPostsWithPublicFeedImages(posts) {
    const pubById = new Map();
    const pubByCard = new Map();
    for (const p of publicFeedPosts) {
      if (p?.id) pubById.set(String(p.id), p);
      if (p?.sourceCardId) pubByCard.set(String(p.sourceCardId), p);
    }
    return (posts || []).map((p) => {
      if (!p) return p;
      const pub = (p.sourceCardId && pubByCard.get(String(p.sourceCardId)))
        || (p.id && pubById.get(String(p.id)))
        || null;
      if (pub?.image && isUsableCommunityImage(pub.image)) {
        return { ...p, image: pub.image };
      }
      const cardImg = cardImageForPost(p);
      if (cardImg && isUsableCommunityImage(cardImg)) {
        return { ...p, image: cardImg };
      }
      return p;
    });
  }

  function getAllCommunityPosts() {
    const user = getActiveUser();
    const pub = filterCommunityPostsForDisplay(publicFeedPosts, {
      skipCardTombstones: true,
      skipPostTombstones: true
    });
    if (user.id === 'guest') {
      return publicFeedAt > 0 ? pub : [];
    }
    const local = filterCommunityPostsForDisplay(communityPosts);
    return enrichPostsWithPublicFeedImages(
      filterCommunityPostsForDisplay(
        mergePostsLists(pub, local, buildPostsFromPublishedCards()),
        { skipCardTombstones: true, skipPostTombstones: true }
      )
    );
  }

  function isFeedRenderablePost(p) {
    if (!p || p.isMock) return false;
    if (window.SupabaseSync?.shouldShowPostInCommunityFeed?.(p) === false) return false;
    const ref = communityPostDisplayImageRef(p, { feedList: true });
    if (ref && isDisplayableImage(ref)) return true;
    return isCommunityPromptEligible(p.prompt);
  }

  /** 社区 Grid：全站 API 帖为准（服务器已发布即展示）；本地 pending 仅补尚未入库的自己的帖 */
  function getCommunityFeedForDisplay() {
    const user = getActiveUser();
    const pub = filterCommunityPostsForDisplay(publicFeedPosts, {
      skipCardTombstones: true,
      skipPostTombstones: true
    }).filter(isFeedRenderablePost);
    if (user.id === 'guest') {
      return publicFeedAt > 0 ? pub : [];
    }
    if (!publicFeedPosts.length && !publicFeedAt) return [];
    const pubIds = new Set(pub.map((p) => String(p.id)));
    const pubCards = new Set(pub.map((p) => String(p.sourceCardId)).filter(Boolean));
    const pending = buildPostsFromPublishedCards().filter((p) => {
      if (!isFeedRenderablePost(p)) return false;
      if (pubIds.has(String(p.id))) return false;
      if (p.sourceCardId && pubCards.has(String(p.sourceCardId))) return false;
      return true;
    });
    return enrichPostsWithLocalTimestamps(
      enrichPostsWithPublicFeedImages(
        filterCommunityPostsForDisplay(
          mergePostsLists(pub, pending),
          { skipCardTombstones: true, skipPostTombstones: true }
        )
      )
    );
  }

  function pruneOwnOrphanCommunityPosts(cardList, opts = {}) {
    const user = getActiveUser();
    if (user.id === 'guest') return false;
    const list = Array.isArray(cardList) ? cardList : [];
    if (!list.length) return false;
    const cardIds = new Set(list.map((c) => c.id));
    const linkedIds = new Set(list.map((c) => c.communityPostId).filter(Boolean));
    const publicCardIds = new Set(publicFeedPosts.map((p) => p.sourceCardId).filter(Boolean));
    const publicPostIds = new Set(publicFeedPosts.map((p) => p.id));
    const before = communityPosts.length;
    communityPosts = communityPosts.filter((p) => {
      if (!p || p.isMock) return false;
      if (!isCurrentUserPost(p)) return true;
      if (p.sourceCardId) {
        if (publicCardIds.has(p.sourceCardId)) return true;
        const card = list.find((c) => c.id === p.sourceCardId);
        return !!(card && card.publishedToCommunity);
      }
      return linkedIds.has(p.id) || publicPostIds.has(p.id);
    });
    if (communityPosts.length !== before) {
      if (opts.persist !== false) {
        persistCommunity();
        rebuildOwnPostFilterCache();
        invalidateCommunityReconcileCache();
      }
      return true;
    }
    return false;
  }

  function communityPostDedupeKey(p, userId) {
    if (!p) return '';
    if (p.sourceCardId) return `card:${p.sourceCardId}`;
    if (p.sourceCreationId) return `cre:${p.sourceCreationId}`;
    if (String(p.authorId) === String(userId)) {
      const prompt = String(p.prompt || p.title || '').trim().slice(0, 200).toLowerCase();
      if (prompt) return `prompt:${prompt}`;
    }
    return `id:${p.id}`;
  }

  function dedupeCommunityPosts(opts = {}) {
    const persist = opts.persist !== false;
    const user = getActiveUser();
    const cardTomb = window.getDeletedCardTombstones?.() || {};
    const keptOthers = [];
    const ownByKey = new Map();
    const before = communityPosts.length;

    for (const p of communityPosts) {
      if (!p || p.isMock) continue;
      if (!isCurrentUserPost(p)) {
        keptOthers.push(p);
        continue;
      }
      if (p.sourceCardId && cardTomb[String(p.sourceCardId)]) continue;
      const key = communityPostDedupeKey(p, user.id);
      const prev = ownByKey.get(key);
      const ts = p.updatedAt || p.createdAt || 0;
      const prevTs = prev ? (prev.updatedAt || prev.createdAt || 0) : -1;
      if (!prev || ts >= prevTs) ownByKey.set(key, p);
    }

    communityPosts = [...keptOthers, ...ownByKey.values()];
    if (communityPosts.length !== before && persist) {
      saveJson(LS_COMMUNITY, communityPosts.filter((p) => !p.isMock));
      if (window.SupabaseSync?.isLoggedIn?.()) queueCloudPush();
    }
    return communityPosts;
  }

  /** 与卡片库对齐：去掉演示帖、孤儿帖、同一卡片的重复社区帖；对齐 communityPostId */
  function reconcileCommunityWithCards(cardList, opts = {}) {
    const list = Array.isArray(cardList) ? cardList : [];
    const user = getActiveUser();
    if (opts.force) invalidateCommunityReconcileCache();
    migrateCommunityAuthorIds();
    dedupeCommunityPosts({ persist: false });
    if (user.id === 'guest') {
      pruneOrphanFeatureData();
      return list;
    }
    let communityDirty = pruneOwnOrphanCommunityPosts(list, { persist: false });
    if (list.length === 0) {
      if (communityDirty) persistCommunity();
      rebuildOwnPostFilterCache();
      return list;
    }
    const cardIds = new Set(list.map(c => c.id));
    const ownBySource = new Map();
    const kept = [];
    for (const p of communityPosts) {
      if (p.isMock) continue;
      if (!isCurrentUserPost(p)) {
        kept.push(p);
        continue;
      }
      if (!p.sourceCardId) {
        const linked = list.some((c) => String(c.communityPostId) === String(p.id));
        if (!linked) continue;
        kept.push(p);
        continue;
      }
      const tomb = window.getDeletedCardTombstones?.() || {};
      if (tomb[String(p.sourceCardId)]) continue;
      if (!cardIds.has(p.sourceCardId)) {
        const uid = window.SupabaseSync?.getUserId?.();
        if (uid && String(p.authorId) === String(uid)) {
          const key = p.sourceCardId || p.id;
          const prev = ownBySource.get(key);
          const ts = p.updatedAt || p.createdAt || 0;
          const prevTs = prev ? (prev.updatedAt || prev.createdAt || 0) : -1;
          if (!prev || ts >= prevTs) ownBySource.set(key, p);
        }
        continue;
      }
      const card = list.find((c) => c.id === p.sourceCardId);
      if (card && !card.publishedToCommunity) continue;
      const prev = ownBySource.get(p.sourceCardId);
      const ts = p.updatedAt || p.createdAt || 0;
      const prevTs = prev ? (prev.updatedAt || prev.createdAt || 0) : -1;
      if (!prev || ts >= prevTs) ownBySource.set(p.sourceCardId, p);
    }
    const beforeMerge = communityPosts.length;
    communityPosts = [...kept, ...ownBySource.values()];
    dedupeCommunityPosts({ persist: false });
    if (communityPosts.length !== beforeMerge) communityDirty = true;
    for (const c of list) {
      if (!c.publishedToCommunity) {
        const hadPost = communityPosts.some((p) => p.sourceCardId === c.id);
        if (hadPost) {
          communityPosts = communityPosts.filter((p) => p.sourceCardId !== c.id);
          communityDirty = true;
        }
        if (c.communityPostId) c.communityPostId = null;
        continue;
      }
      const post = communityPosts.find((p) => p.sourceCardId === c.id);
      if (post) {
        c.communityPostId = post.id;
      } else if (c.communityPostId && !communityPosts.some((p) => p.id === c.communityPostId)) {
        c.communityPostId = null;
      }
    }
    const mat = materializeCommunityFromCards(list);
    if (communityDirty || mat.dirty) persistCommunity();
    rebuildOwnPostFilterCache();
    pruneOrphanFeatureData();
    return list;
  }

  /** 将已标记「发布到社区」的卡片补成社区帖（修复仅有卡片、无 communityPosts 的情况） */
  function materializeCommunityFromCards(cardList) {
    const list = Array.isArray(cardList) ? cardList : [];
    const user = getActiveUser();
    if (user.id === 'guest') return { added: 0, dirty: false };
    let added = 0;
    let dirty = false;
    for (const c of list) {
      if (!c?.id) continue;
      if (!c.publishedToCommunity) continue;
      if (!isCommunityPromptEligible(c.prompt)) continue;
      const post = communityPosts.find((p) => p.sourceCardId === c.id);
      if (post) {
        const title = (c.title || '').trim() || '';
        if (
          post.prompt !== (c.prompt || '')
          || normalizeImageRefForCompare(post.image) !== normalizeImageRefForCompare(c.image ?? null)
          || post.title !== title
        ) {
          post.prompt = c.prompt || '';
          post.image = c.image ?? null;
          post.title = title;
          post.updatedAt = Date.now();
          dirty = true;
        }
        continue;
      }
      const before = communityPosts.length;
      syncCardToCommunity(c, true, { silent: true, keepPublishFlag: true, skipPersist: true, skipRender: true });
      if (communityPosts.length > before) added += 1;
      dirty = true;
    }
    return { added, dirty };
  }

  function syncEligibleCardsToCommunity(opts = {}) {
    const list = window.__promptHubCards || [];
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
    const mine = publicFeedPosts.filter((p) => {
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
        prunePendingJobsWithWarehouseCards();
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
        void refreshPublicCommunityFeed({ force: publicFeedAt === 0 }).then(afterFeed);
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
    if (useCommunityCssGrid(containerId) && container.dataset.feedDistributed === '1') {
      ensureFeedPageSentinel(container);
      reconnectFeedPageObserver(containerId);
      setFeedLayoutPending(containerId, false);
      return;
    }
    scheduleCommunityLayout(containerId, { force: true, immediate: true });
    layoutCommunityWhenImagesReady(containerId);
    if (isMobileViewport() && (containerId === 'communityGrid' || containerId === 'creationsGrid')) {
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
      return container.closest('.my-home-shell') || container.closest('.feature-shell') || container;
    }
    if (
      !isMobileViewport()
      && container.id === 'communityGrid'
      && container.classList?.contains('community-feed-columns')
    ) {
      return container;
    }
    if (isMobileViewport() && (container.id === 'communityGrid' || container.id === 'creationsGrid' || container.id === 'imageGenFeed')) {
      if (container.id === 'imageGenFeed' && document.body.classList.contains('imagegen-mobile-view-feed')) {
        return container.closest('.feature-shell') || container;
      }
      if (container.id !== 'imageGenFeed') {
        return container.closest('.feature-shell') || container;
      }
    }
    if (container.id === 'imageGenFeed') {
      return container;
    }
    return container;
  }

  function collectFeedScrollTargets(containerId, container) {
    const targets = new Set();
    const primary = getFeedScrollRoot(container) || container;
    if (primary) targets.add(primary);
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

  function restoreFeedScrollAnchor(container, anchor) {
    if (!container || !anchor) return;
    const scrollEl = anchor.scrollEl || getFeedScrollRoot(container) || container;
    if (anchor.postId) {
      const card = container.querySelector(`.card[data-post-id="${CSS.escape(anchor.postId)}"]`);
      if (card) {
        const rect = scrollEl.getBoundingClientRect();
        const r = card.getBoundingClientRect();
        scrollEl.scrollTop += (r.top - rect.top) - anchor.offset;
        return;
      }
    }
    if (Number.isFinite(anchor.scrollTop)) scrollEl.scrollTop = anchor.scrollTop;
  }

  function preserveFeedScroll(container, fn) {
    const anchor = captureFeedScrollAnchor(container);
    fn();
    requestAnimationFrame(() => {
      restoreFeedScrollAnchor(container, anchor);
      requestAnimationFrame(() => restoreFeedScrollAnchor(container, anchor));
    });
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
    const run = () => scheduleCommunityLayout(containerId);
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
  let scheduleCommunityLayout;
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
  let bindImageGenFeedResizeRelayout;
  let renderImageGenFeed;
  let imageGenFeedIsNearTop;
  let bindImageGenFeedCardEvents;
  let captureImageGenFeedCardPositions;

  function wireImageGenFeed() {
    if (window.__imageGenFeedWired) return;
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
      prunePendingJobsWithWarehouseCards,
      scrubImageGenFeedCards: (wrap) => scrubImageGenFeedCards?.(wrap),
      getCommunityScope: () => communityScope,
      getCommunitySort: () => communitySort,
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
      copyFeedPromptText,
      getActiveImageGenMode,
      likeCommunityPostOnly,
      removeFailedGenJob,
      removePendingJob,
      clearSessionGenJob,
      getActivePollJobIds: () => activePollJobIds,
      IMAGEGEN_FEED_PENDING_CAP,
      IMAGEGEN_FEED_FAILED_CAP,
      addImageGenRefFromFeed
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
    bindImageGenFeedResizeRelayout = IG.bindImageGenFeedResizeRelayout;
    renderImageGenFeed = IG.renderImageGenFeed;
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
    const FL = window.FeedLayout.init({
      getCommunityColumns,
      getCreationsFeedColumns,
      getCardColumns,
      getMasonryGap,
      getCommunityFeedGaps,
      getFeedScrollRoot,
      setFeedLayoutPending,
      ensureFeedPageSentinel,
      revealCommunityFeedImages,
      scrubStaleCommunityFeedEmpty,
      scrubCommunityFeedCardMediaHeights
    });
    layoutCommunityMasonry = (id, o) => FL.layout(id, o);
    layoutFeedFlexColumns = (id, o) => FL.layoutFlex(id, o);
    scheduleCommunityLayout = (id, o) => FL.schedule(id, o);
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
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
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
    const displayRef = communityPostDisplayImageRef(post);
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
    const scrollTargets = collectFeedScrollTargets(containerId, container);
    const scrollEl = scrollTargets[0] || container;

    async function drainFeedPages(maxPages = 8) {
      logFeedPageDebug(containerId, 'drain_start', { maxPages });
      await drainCommunityFeedPages(containerId, maxPages);
      logFeedPageDebug(containerId, 'drain_end');
    }

    function onFeedScroll(target) {
      if (target.scrollTop > 32) feedScrollIntent[containerId] = true;
      if (communityFeedPageLoading) return;
      const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 240;
      if (!nearBottom) return;
      const now = Date.now();
      if (now - feedPageScrollThrottle < 180) return;
      feedPageScrollThrottle = now;
      void drainFeedPages(6);
    }

    if (!feedPagedScrollBound[containerId]) {
      feedPagedScrollBound[containerId] = true;
      container.__feedScrollTargets = container.__feedScrollTargets || new Set();
      scrollTargets.forEach((target) => {
        if (!target || container.__feedScrollTargets.has(target)) return;
        container.__feedScrollTargets.add(target);
        target.addEventListener('scroll', () => onFeedScroll(target), { passive: true });
      });
    }

    ensureFeedPageSentinel(container);
    const sentinel = container.querySelector(':scope > .feed-page-sentinel');
    if (!sentinel) return;
    if (container.__feedPageIo) {
      container.__feedPageIo.disconnect();
      container.__feedPageIo = null;
    }
    const ioRoot = scrollEl && scrollEl !== document.documentElement && scrollEl.scrollHeight > scrollEl.clientHeight + 8
      ? scrollEl
      : null;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      const now = Date.now();
      if (now - feedPageScrollThrottle < 180) return;
      feedPageScrollThrottle = now;
      void drainFeedPages(4);
    }, { root: ioRoot, rootMargin: '720px 0px', threshold: 0 });
    io.observe(sentinel);
    container.__feedPageIo = io;
    container.__feedPageIoRoot = ioRoot;
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
    if (!feedAppend) container.dataset.feedSig = sig;
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
    postsToRender.forEach((post, idx) => {
      fragment.appendChild(createCommunityFeedCard(post, containerId, { eagerImage: idx < eagerCap }));
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
        scrollEl.scrollTop = prevScrollTop;
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
        if (store?.posts?.length > FEED_PER_PAGE && !window.__PH_FEED_BULK_DRAIN__) {
          const initialPages = isMobileViewport() ? 2 : 5;
          await drainCommunityFeedPages(containerId, initialPages);
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
    const sig = list.map((p) => String(p.id)).sort().join('|');
    if (communityRandomSig !== sig) {
      communityRandomSig = sig;
      const ids = list.map((p) => p.id);
      for (let i = ids.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      communityRandomOrder = new Map(ids.map((id, idx) => [id, idx]));
    }
    return [...list].sort((a, b) => {
      const ai = communityRandomOrder.get(a.id) ?? 0;
      const bi = communityRandomOrder.get(b.id) ?? 0;
      return ai - bi;
    });
  }

  function applyCommunitySort(mode) {
    const next = mode || 'random';
    if (next === 'random' && communitySort !== 'random') communityRandomSig = '';
    if (next === 'random' && communitySort === 'random') communityRandomSig = '';
    if (next !== communitySort) {
      delete feedPagedStore.communityGrid;
      delete feedPagedStore.creationsGrid;
      const grid = document.getElementById('communityGrid');
      if (grid) delete grid.dataset.feedSig;
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
      filtered.sort((a, b) => postActivityTs(b) - postActivityTs(a));
    } else if (communitySort === 'hot') {
      filtered.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    } else {
      filtered = shuffleCommunityPosts(filtered);
    }
    return filtered;
  }

  let renderCommunityTimer = null;
  function renderCommunity(opts = {}) {
    if (opts.skipFeedFetch === undefined && publicFeedAt > 0 && Date.now() - publicFeedAt < PUBLIC_FEED_TTL_MS) {
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
      if ((publicFeedAt === 0 || publicFeedPosts.length < PUBLIC_FEED_MIN_READY) && !publicFeedLoading) {
        showCommunityFeedSkeleton(container, 8);
        void refreshPublicCommunityFeed({ force: true, timeoutMs: 15000 }).then(async () => {
          if (gen !== communityFeedRenderGen) return;
          if (communityScope === 'curated') return;
          if (publicFeedAt === 0) {
            setFeedGridEmpty(
              container,
              '<div class="feature-empty community-feed-empty"><p>社区加载失败</p><button type="button" class="btn btn-ghost btn-sm" onclick="renderCommunity({ immediate: true, forceRepaint: true })">重试</button></div>'
            );
            return;
          }
          if (shouldPreserveCommunityFeedDom('communityGrid')) {
            await growCommunityFeedAfterPublicRefresh('communityGrid');
            return;
          }
          renderCommunityNow({ skipFeedFetch: true, forceRepaint: true });
        });
        return;
      }
      if (feedStale && !publicFeedLoading) {
        void refreshPublicCommunityFeed({ force: true, timeoutMs: 15000 }).then(async (changed) => {
          if (gen !== communityFeedRenderGen) return;
          if (communityScope === 'curated') return;
          if (!changed) return;
          const grid = document.getElementById('communityGrid');
          patchFeedLikeLabels(grid, filterAndSortPosts(getCommunityFeedForDisplay()));
          if (shouldPreserveCommunityFeedDom('communityGrid')) {
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
        scheduleCommunityLayout('communityGrid', { force: true, immediate: true });
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
    if (!list.length && (guestUser || loggedInUser) && (publicFeedLoading || !publicFeedAt)) {
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
      const rateHint = publicFeedLoading
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
        scheduleCommunityLayout('communityGrid', { force: true, immediate: true });
      }
      return;
    }
    if (
      !opts.forceRepaint
      && shouldPreserveCommunityFeedDom('communityGrid')
      && container.querySelector('.community-post-card')
    ) {
      scrubStaleCommunityFeedEmpty(container);
      patchFeedLikeLabels(container, list);
      void growCommunityFeedAfterPublicRefresh('communityGrid');
      if (window.SupabaseSync?.isLoggedIn?.()) void refreshRemoteNotifications();
      return;
    }
    void renderPostsIntoContainer(list, 'communityGrid').then(() => {
      void drainCommunityFeedPagesUntilDone('communityGrid', isMobileViewport() ? 10 : 20);
    });
  }

  function renderUserProfileGrid() {
    if (!openProfileAuthorId) return;
    const posts = getPostsByAuthor(openProfileAuthorId);
    posts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
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
      for (const p of publicFeedPosts) {
        if (p && String(p.sourceCardId) === String(card.id)) postIds.add(String(p.id));
      }
      for (const p of communityPosts) {
        if (p && String(p.sourceCardId) === String(card.id)) postIds.add(String(p.id));
      }
      if (idx >= 0) communityPosts.splice(idx, 1);
      else communityPosts = communityPosts.filter((p) => String(p.sourceCardId) !== String(card.id));
      publicFeedPosts = publicFeedPosts.filter((p) => String(p.sourceCardId) !== String(card.id));
      savePublicFeedCache(publicFeedPosts);
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
    for (const p of [...communityPosts, ...publicFeedPosts, ...getAllCommunityPosts()]) {
      if (p && String(p.sourceCardId) === cid) postIds.add(String(p.id));
    }
    for (const postId of postIds) {
      if (typeof window.recordCommunityPostDeletion === 'function') {
        window.recordCommunityPostDeletion(postId);
      }
      await removePostFromPublicFeed(postId, { sourceCardId: cid });
    }
    communityPosts = communityPosts.filter((p) => String(p.sourceCardId) !== cid);
    publicFeedPosts = publicFeedPosts.filter((p) => String(p.sourceCardId) !== cid);
    savePublicFeedCache(publicFeedPosts);
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
    if (document.getElementById('pageImageGen')?.classList.contains('active')) renderImageGenFeed();
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
    for (const list of [publicFeedPosts, communityPosts]) {
      const p = list.find((x) => x.id === id);
      if (p) p.likes = n;
    }
    savePublicFeedCache(publicFeedPosts);
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
      syncCommunityFeedColumnCount(containerId);
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
    const gridId = isCreations ? 'creationsGrid' : 'communityGrid';
    const grid = document.getElementById(gridId);
    const scrollEl = grid ? (getFeedScrollRoot(grid) || grid) : null;
    const savedScrollTop = scrollEl ? scrollEl.scrollTop : 0;
    document.querySelectorAll(`#${gridId} .community-post-card.selected`).forEach((el) => el.classList.remove('selected'));
    document.querySelector(`#${gridId} .community-post-card[data-post-id="${id}"]`)?.classList.add('selected');
    void renderCommunitySidePanel(id, {
      post,
      bodyId: isCreations ? 'creationsSideBody' : 'communitySideBody',
      titleId: isCreations ? 'creationsSideTitle' : 'communitySideTitle',
      mode: isCreations ? 'creations' : 'community'
    });
    if (!isMobileViewport()) {
      relayoutFeedGridAfterSidePanel(gridId);
      requestAnimationFrame(() => relayoutFeedGridAfterSidePanel(gridId));
    }
    if (scrollEl && savedScrollTop > 0) {
      requestAnimationFrame(() => {
        scrollEl.scrollTop = savedScrollTop;
      });
    }
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
    let instantSrc = '';
    if (imageRef && isDisplayableImage(imageRef)) {
      instantSrc = window.SupabaseSync?.getCachedDisplayUrl?.(imageRef, {
        assetId: post.sourceCardId || post.id,
        authorId: post.authorId || undefined,
        variant: 'grid'
      }) || '';
      const gridImg = document.querySelector(`#communityGrid .community-post-card[data-post-id="${post.id}"] img.card-img`);
      const gridSrc = gridImg?.currentSrc || gridImg?.src || '';
      if (isPlaceholderSrc(instantSrc) && !isPlaceholderSrc(gridSrc)) instantSrc = gridSrc;
    }
    const hasInstant = !isPlaceholderSrc(instantSrc);
    window.setAppreciateViewerLoading?.(!hasInstant);
    const reveal = () => {
      if (gen !== appreciateViewerGen) return;
      viewer.classList.add('active');
      document.body.classList.add('appreciate-viewing');
    };
    reveal();
    if (imageRef && isDisplayableImage(imageRef)) {
      img.style.display = 'block';
      if (hint) hint.style.display = 'block';
      img.onload = null;
      img.onerror = null;
      let revealed = false;
      const onReady = () => {
        if (gen !== appreciateViewerGen || revealed) return;
        revealed = true;
        img.onload = null;
        img.onerror = null;
        img.style.maxWidth = '';
        img.style.maxHeight = '';
        img.style.objectFit = '';
        if (typeof window.resetImageZoom === 'function') window.resetImageZoom(img);
        if (typeof window.attachImageZoom === 'function') window.attachImageZoom(img);
        window.finishAppreciateViewerReveal?.();
        reveal();
      };
      img.onerror = () => {
        if (gen !== appreciateViewerGen) return;
        img.onload = null;
        img.onerror = null;
        window.setAppreciateViewerLoading?.(false);
        img.style.display = 'none';
        if (hint) hint.style.display = 'none';
        reveal();
      };
      if (hasInstant) {
        img.src = instantSrc;
        if (img.complete && img.naturalWidth > 0) onReady();
        else img.onload = onReady;
      } else {
        img.removeAttribute('src');
        img.onload = onReady;
      }
      void (async () => {
        let displaySrc = imageRef;
        try {
          if (window.MediaPipeline?.resolvePreviewUrl) {
            displaySrc = await window.MediaPipeline.resolvePreviewUrl(imageRef, {
              assetId: signOpts.assetId,
              cardId: signOpts.cardId,
              authorId: signOpts.authorId,
              communityFeed: true,
              gridFallbackUrl: instantSrc || ''
            });
          } else if (window.SupabaseSync?.resolveDisplayUrl) {
            displaySrc = await window.SupabaseSync.resolveDisplayUrl(imageRef, signOpts);
          }
        } catch (e) { /* ignore */ }
        if (gen !== appreciateViewerGen) return;
        if (!displaySrc || isPlaceholderSrc(displaySrc)) {
          if (!hasInstant) img.onerror?.();
          return;
        }
        if (displaySrc === img.src) {
          if (img.complete && img.naturalWidth > 0 && !revealed) onReady();
          return;
        }
        if (hasInstant && revealed) {
          img.onload = () => {
            if (gen !== appreciateViewerGen) return;
            img.onload = null;
            if (typeof window.resetImageZoom === 'function') window.resetImageZoom(img);
          };
          img.src = displaySrc;
          return;
        }
        img.src = displaySrc;
        if (img.complete && img.naturalWidth > 0) onReady();
      })();
    } else {
      img.src = '';
      img.style.display = 'none';
      if (hint) hint.style.display = 'none';
      window.setAppreciateViewerLoading?.(false);
      reveal();
    }
  }

  function closeCommunitySidePanel() {
    const panel = document.getElementById('communitySidePanel');
    if (panel) {
      panel.classList.remove('community-side-panel--open');
      panel.classList.add('community-side-panel--closing');
    }
    document.getElementById('communitySidePanel')?.classList.add('hidden');
    unmountFeatureSidePanel('communitySidePanel');
    panel?.classList.remove('community-side-panel--closing');
    syncCommunityPanelOpenClass();
    communitySidePostId = null;
    openPostId = null;
    document.querySelectorAll('#communityGrid .community-post-card.selected').forEach(el => el.classList.remove('selected'));
    if (!isMobileViewport()) {
      requestAnimationFrame(() => {
        scheduleCommunityLayout('communityGrid', { force: true, immediate: true, recalcCols: true });
      });
    }
  }

  function openCommunityDetail(id) {
    if (document.getElementById('pageCommunity')?.classList.contains('active')) {
      openCommunitySidePanel(id);
      return;
    }
    openCommunitySidePanel(id);
  }

  function closeCommunityDetail() {
    closeCommunitySidePanel();
  }

  function copyPostPromptOnly(post) {
    if (!window.AuthGate?.requireAuth?.('copy')) return;
    const text = post?.prompt || '';
    if (!text) { toast('暂无提示词'); return; }
    navigator.clipboard.writeText(text).then(() => toast('已复制提示词'));
  }

  function copyPostPrompt(post) {
    if (!post) return;
    if (!window.AuthGate?.requireAuth?.('copy')) return;
    const wasNew = ensureLike(post.id);
    const text = post?.prompt || '';
    if (!text) { toast('暂无提示词'); return; }
    navigator.clipboard.writeText(text).then(() => {
      toast(wasNew ? '已复制，已为作者点赞' : '已复制提示词');
    });
  }

  function favoritePost(id, post) {
    if (!window.AuthGate?.requireAuth?.('community')) return;
    ensureLike(id);
    if (favIds.has(id)) {
      toast('已在卡片库中');
      if (communitySidePostId === id) patchCommunitySidePanelUI(id);
      return;
    }
    favIds.add(id);
    persistFavs();
    const user = getActiveUser();
    if (post?.authorId && user.id !== 'guest' && String(post.authorId) !== String(user.id)) {
      pushCommunityEvent({
        type: 'favorite',
        targetUserId: post.authorId,
        actorId: user.id,
        actorName: user.name,
        postId: id,
        postTitle: post.title || (post.prompt || '').slice(0, 24),
        message: `${user.name} 收藏了你的作品`
      });
    }
    void (async () => {
      const r = await addCardFromPost(post);
      if (r?.duplicate) {
        toast('已在卡片库中');
      } else if (r?.ok) {
        toast(r?.imageCopied
          ? '已复制到你的卡片库（独立副本，不受原作者删帖影响）'
          : '已复制提示词；配图复制失败，可重新收藏或手动上传图片');
      } else {
        toast('已记录收藏，图片复制失败时可稍后重试');
      }
      if (communitySidePostId === id) patchCommunitySidePanelUI(id);
    })();
  }

  function addCardFromPost(post) {
    if (typeof window.addCardFromCommunity === 'function') {
      return window.addCardFromCommunity(post);
    }
    return Promise.resolve({ ok: false });
  }

  function remixToImageGen(post) {
    closeCommunitySidePanel();
    if (typeof switchAppPage === 'function') switchAppPage('imagegen');
    imageGenFeedTab = 'community';
    document.querySelectorAll('[data-feed-tab]').forEach(b => {
      b.classList.toggle('active', b.dataset.feedTab === 'community');
    });
    updateImageGenFeedHint();
    fillFromCommunityPost(post, true);
  }

  function saveGeneratedToWarehouse(opts) {
    if (!opts?.image && !(opts?.prompt || '').trim()) {
      toast('暂无内容可保存');
      return Promise.resolve(false);
    }
    return Promise.resolve(window.addCardFromGenerated?.({
      prompt: opts.prompt,
      image: opts.image,
      sourceId: opts.sourceId,
      jobId: opts.jobId || null,
      title: opts.title,
      resolution: opts.resolution || null,
      model: opts.model || null,
      quality: opts.quality || null,
      size: opts.size || null,
      targetGroup: opts.targetGroup || null,
      targetTags: opts.targetTags || null,
      publishToCommunity: !!opts.publishToCommunity,
      fromInspirationDraw: !!opts.fromInspirationDraw,
      silentToast: !!opts.silentToast,
      isMidjourney: !!opts.isMidjourney,
      mjGridUrls: Array.isArray(opts.mjGridUrls) ? opts.mjGridUrls : null,
      mjCompositeUrl: opts.mjCompositeUrl || null,
      mjButtons: Array.isArray(opts.mjButtons) ? opts.mjButtons : null,
      deferCloudPush: !!opts.deferCloudPush
    })).then((r) => r?.ok ?? false);
  }

  /** GrsAI 临时链约 2 小时失效，恢复窗口与之对齐 */
  const RECENT_GEN_RECOVER_MS = 2 * 3600 * 1000;
  /** 后台恢复超过此时间仍无图 → 标失败并清占位 */
  const RECOVERY_GIVE_UP_MS = 25 * 60 * 1000;
  /** 已进入「恢复中」占位后再等多久强制结案（慢速线用 genRecoveringDeferGiveUpMs） */
  const RECOVERING_DEFER_GIVE_UP_MS = 22 * 60 * 1000;
  const SERVER_RECOVER_AFTER_MS = 8 * 60 * 1000;
  /** API 已 failed 时，非明确可恢复错误最多再等 12 分钟 */
  const FAILED_JOB_RECOVER_MAX_MS = 12 * 60 * 1000;
  const activePollJobIds = new Set();
  let resumeGenJobsInflight = null;
  let genJobsSyncTimer = null;
  let genJobsSyncInterval = null;
  let genJobsSyncRetry = 0;
  let imageGenFeedRenderTimer = null;
  let lastGenJobsListAt = 0;
  const GEN_JOBS_LIST_MIN_MS = 8000;

  function imageGenFeedScrollEl() {
    return document.getElementById('imageGenFeed');
  }

  function scheduleImageGenFeedRenderFromJobs(delayMs) {
    if (!document.getElementById('pageImageGen')?.classList.contains('active')) return;
    clearTimeout(imageGenFeedRenderTimer);
    imageGenFeedRenderTimer = setTimeout(() => {
      imageGenFeedRenderTimer = null;
      renderImageGenFeed({ preserveScroll: true });
      renderImageGenMobileResult();
    }, delayMs == null ? 1800 : delayMs);
  }

  function getGenJobStateUid() {
    return window.SupabaseSync?.getUserId?.() || localStorage.getItem('promptrepo_last_uid') || 'guest';
  }

  function loadGenJobStateFromLocal() {
    try {
      const raw = localStorage.getItem(LS_GEN_JOBS_STATE);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const uid = getGenJobStateUid();
      if (data?.uid && data.uid !== uid && uid !== 'guest') return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function mergePendingGenJobLists(...lists) {
    const byKey = new Map();
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const p of list) {
        if (!p?.id) continue;
        const key = p.jobId ? String(p.jobId) : String(p.id);
        const prev = byKey.get(key);
        if (!prev || (p.startedAt || 0) >= (prev.startedAt || 0)) byKey.set(key, p);
      }
    }
    return [...byKey.values()].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }

  function persistGenJobStateToLocal() {
    try {
      localStorage.setItem(LS_GEN_JOBS_STATE, JSON.stringify({
        uid: getGenJobStateUid(),
        updatedAt: Date.now(),
        pending: imageGenPendingJobs.slice(0, 32),
        session: getSessionGenJobIdsRaw()
      }));
    } catch (e) { /* ignore */ }
  }

  function filterPendingGenJobsByAge(list) {
    const now = Date.now();
    return (list || []).filter((p) => {
      const age = now - (p.startedAt || 0);
      if (p.recovering) {
        return p.jobId ? age < RECENT_GEN_RECOVER_MS : age < 30 * 60 * 1000;
      }
      if (p.jobId) return age < RECENT_GEN_RECOVER_MS;
      return age < 15 * 60 * 1000;
    });
  }

  function getSessionGenJobIdsRaw() {
    try {
      const raw = sessionStorage.getItem(LS_SESSION_GEN_JOBS);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.map(String) : [];
    } catch (e) {
      return [];
    }
  }

  function writeSessionGenJobIds(list) {
    const ids = [...new Set((list || []).map(String).filter(Boolean))];
    while (ids.length > 40) ids.shift();
    try {
      sessionStorage.setItem(LS_SESSION_GEN_JOBS, JSON.stringify(ids));
    } catch (e) { /* ignore */ }
    persistGenJobStateToLocal();
  }

  function afterGenJobsResume(changed) {
    if (!changed) return;
    if (document.getElementById('pageImageGen')?.classList.contains('active')) {
      renderImageGenFeed({ preserveScroll: true, force: true });
      renderImageGenMobileResult();
    } else {
      window.refreshWarehouseUI?.();
    }
  }

  function scheduleImageGenPendingUiRefresh() {
    if (!document.getElementById('pageImageGen')?.classList.contains('active')) return;
    if (!imageGenPendingJobs.length && !imageGenFailedJobs.length) return;
    clearTimeout(scheduleImageGenPendingUiRefresh._t);
    scheduleImageGenPendingUiRefresh._t = setTimeout(() => {
      renderImageGenFeed({ preserveScroll: true, force: true });
    }, 400);
  }

  function persistPendingGenJobs() {
    try {
      sessionStorage.setItem(LS_PENDING_GEN_JOBS, JSON.stringify(imageGenPendingJobs.slice(0, 32)));
    } catch (e) { /* ignore */ }
    persistGenJobStateToLocal();
  }

  function loadPendingGenJobs() {
    try {
      const raw = sessionStorage.getItem(LS_PENDING_GEN_JOBS);
      const sessionList = raw ? JSON.parse(raw) : [];
      const localPending = loadGenJobStateFromLocal()?.pending;
      imageGenPendingJobs = mergePendingGenJobLists(
        Array.isArray(sessionList) ? sessionList : [],
        Array.isArray(localPending) ? localPending : [],
        imageGenPendingJobs
      );
      const before = imageGenPendingJobs.length;
      imageGenPendingJobs = filterPendingGenJobsByAge(imageGenPendingJobs);
      if (imageGenPendingJobs.length !== before) persistPendingGenJobs();
      purgeExpiredGenPendingJobs();
      prunePendingJobsWithWarehouseCards();
      const localSession = loadGenJobStateFromLocal()?.session;
      if (Array.isArray(localSession) && localSession.length) {
        const merged = [...new Set([...getSessionGenJobIdsRaw(), ...localSession.map(String)])];
        writeSessionGenJobIds(merged);
      }
    } catch (e) {
      imageGenPendingJobs = [];
    }
  }

  function persistFailedGenJobs() {
    try {
      sessionStorage.setItem(LS_FAILED_GEN_JOBS, JSON.stringify(imageGenFailedJobs.slice(0, 24)));
    } catch (e) { /* ignore */ }
  }

  function loadFailedGenJobs() {
    try {
      const raw = sessionStorage.getItem(LS_FAILED_GEN_JOBS);
      const list = raw ? JSON.parse(raw) : [];
      imageGenFailedJobs = Array.isArray(list) ? list : [];
      let stale = false;
      imageGenFailedJobs = imageGenFailedJobs.map((f) => {
        if (isStaleConfigError(f?.errorMessage)) {
          stale = true;
          return {
            ...f,
            needsRecovery: true,
            errorMessage: friendlyGenErrorMessage(f.errorMessage)
          };
        }
        return f;
      });
      if (stale) persistFailedGenJobs();
    } catch (e) {
      imageGenFailedJobs = [];
    }
  }

  function batchIndexLabel(index, total) {
    if (index && total && total > 1) return `第 ${index}/${total} 张`;
    return '';
  }

  /** 将上游/接口原始错误转为用户可读说明（批量失败卡片与 toast 共用） */
  function stringifyGenErrorRaw(errRaw) {
    if (errRaw == null) return '';
    if (typeof errRaw === 'string') return errRaw.trim();
    if (typeof errRaw === 'object') {
      const o = errRaw;
      if (typeof o.message === 'string') return o.message.trim();
      if (o.message != null) return String(o.message).trim();
      if (typeof o.error === 'string') return o.error.trim();
      try {
        return JSON.stringify(o);
      } catch (e) {
        return String(o);
      }
    }
    return String(errRaw).trim();
  }

  function isStaleConfigError(msg) {
    return /积分小数|apply_credit_delta|SQL 编辑器|扣费函数|SERVER_CONFIG|decimal/i.test(String(msg || ''));
  }

  function isSlowUpstreamGenModel(modelId) {
    const m = String(modelId || '').toLowerCase();
    return m.includes('nano-banana') || m.includes('banana') || m.includes('gpt-image') || m.includes('jimeng');
  }

  /** 上游可能仍出图 / 服务端可恢复：此时不要立刻标红「生成失败」 */
  function isLikelyRecoverableGenFailure(errRaw, ctx, opts = {}) {
    const s = stringifyGenErrorRaw(errRaw);
    if (!s) return opts.confirmedFailed !== true;
    const model = String(ctx?.model || '').toLowerCase();
    if (model.includes('ithink') && /UPSTREAM_FAILED|upstream_failed|502|ThinkAI|无效.*令牌/i.test(s)) {
      return false;
    }
    if (/upstream_content_violation|违规不返还|violation/i.test(s)) return false;
    if (/prohibited words or images|prohibited|flagged as containing/i.test(s)) return false;
    if (isStaleConfigError(s)) return true;
    if (/error code:\s*524|\b524\b|请求失败 \(524\)/i.test(s)) return true;
    if (/debit_failed|upstream_no_image|missing_task_id|upstream_submit/i.test(s)) return true;
    if (/upstream_failed/i.test(s)) {
      const id = normalizeImageGenModelId(ctx?.model);
      if (id.startsWith('apimart-')) return false;
      if (/timeout|524|upstream_timeout|排队/i.test(s)) return isLongRunningGenJob(ctx);
      return isLongRunningGenJob(ctx);
    }
    if (/不存在该模型|model.*not.*exist|GrsAI 未返回任务 ID/i.test(s)) return true;
    if (/upstream_timeout/i.test(s) && isLongRunningGenJob(ctx)) return true;
    if (/NETWORK_ERROR|API_UNREACHABLE|无法连接 api\.prompt-hub|连接.*超时|Failed to fetch/i.test(s)) {
      return true;
    }
    return false;
  }

  function shouldDeferFailedPendingRecovery(pending, apiJob, ctx) {
    const age = Date.now() - (pending.startedAt || 0);
    const errRaw = apiJob?.errorMessage || apiJob?.message || '';
    if (isDefinitiveGenFailure(errRaw, apiJob)) return false;
    if (age >= pendingRecoveryGiveUpMs(pending)) return false;
    if (age >= FAILED_JOB_RECOVER_MAX_MS && !isLikelyRecoverableGenFailure(errRaw, ctx, { confirmedFailed: true })) {
      return false;
    }
    if (pending.recovering || isLikelyRecoverableGenFailure(errRaw, ctx)) {
      return age < pendingRecoveryGiveUpMs(pending);
    }
    return false;
  }

  function purgeExpiredGenPendingJobs() {
    const now = Date.now();
    const before = imageGenPendingJobs.length;
    imageGenPendingJobs = imageGenPendingJobs.filter((p) => {
      const age = now - (p.startedAt || 0);
      if (!p.jobId) return age < 15 * 60 * 1000;
      return age < RECENT_GEN_RECOVER_MS;
    });
    if (imageGenPendingJobs.length !== before) persistPendingGenJobs();
  }

  function abandonUnrecoverablePendingJob(pending, reason, opts = {}) {
    if (!pending) return;
    if (pending.jobId) {
      window.recordGenerationJobDeletion?.(pending.jobId);
      clearSessionGenJob(pending.jobId);
    }
    removePendingJob(pending.id);
    persistPendingGenJobs();
    if (opts.toast !== false && reason) toast(reason, 5000);
    renderImageGenFeed({ preserveScroll: true, force: true });
  }

  function deferPendingJobRecovery(pendingId, ctx, note) {
    const job = imageGenPendingJobs.find((j) => j.id === pendingId);
    if (!job) return;
    const age = Date.now() - (job.startedAt || 0);
    if (age >= RECENT_GEN_RECOVER_MS) {
      abandonUnrecoverablePendingJob(
        job,
        '上游临时链接约 2 小时有效，该任务已过期，无法恢复（积分若已扣请查消费记录）'
      );
      return;
    }
    if (isSlowGenProviderModel(job.model)) {
      job.recovering = false;
      job.recoverNote = '';
      job.pendingNote = formatPendingRecoveryNote(job, note || '仍在后台生成中（请勿重复提交）');
    } else {
      job.recovering = true;
      job.recoverNote = formatPendingRecoveryNote(job, note || '上游可能仍在出图，后台继续恢复…');
    }
    persistPendingGenJobs();
    if (job.jobId && age >= SERVER_RECOVER_AFTER_MS) {
      void tryRecoverPendingJobDirect(job);
    }
    void resumePendingGenerationJobs();
    scheduleImageGenPendingUiRefresh();
  }

  function friendlyGenErrorMessage(msg) {
    const s = stringifyGenErrorRaw(msg);
    if (!s || s === '[object Object]') return '生图失败，积分已全额退回';
    if (isStaleConfigError(s)) {
      return '扣费曾异常，正在从服务器恢复已完成任务；若仍未出图请点「重试」';
    }
    if (/登录已过期|请先登录|UNAUTHORIZED/i.test(s)) {
      return '登录状态已失效，请退出后重新登录';
    }
    if (/upstream_auth_failed|无效.*令牌|invalid.*token/i.test(s)) {
      return '生图令牌无效或已过期，请联系站长在 thinkai.tv 重新创建令牌；您的积分已全额退回';
    }
    if (/upstream_submit_not_configured/i.test(s)) {
      return '生图服务未配置，请联系站长；您的积分已全额退回';
    }
    if (/upstream_model_rejected/i.test(s)) {
      return '当前模型暂不可用，请换其他模型；您的积分已全额退回';
    }
    if (/insufficient balance|insufficient credits/i.test(s)) {
      return '生图服务商账户余额不足（不是您的站内积分），请联系站长；您的积分已全额退回';
    }
    if (/apikey|api.key|invalid.*api.*key|无效.*令牌|invalid.*token|unauthorized/i.test(s)) {
      return '生图服务认证失败，请联系站长；您的积分已全额退回';
    }
    if (/error code:\s*524|\b524\b/.test(s)) {
      return '连接超时（524），任务可能已提交；请强刷页面查看是否在生成中';
    }
    if (/upstream_timeout|timeout/i.test(s)) {
      return '生图排队超时（约 12 分钟），积分已全额退回，可点「重试」';
    }
    if (/images\[\]\.image_url is required/i.test(s)) {
      return '参考图格式不兼容，请去掉参考图后重试；积分已全额退回';
    }
    if (/upstream_image_archive_failed|atob\(\)|invalid base64|invalid_data_url/i.test(s)) {
      return '图片入库失败，积分已全额退回，请重试';
    }
    if (/upstream_no_image|no_image/i.test(s)) {
      return '上游未返回图片，积分已全额退回，可点「重试」';
    }
    if (/upstream_submit_not_started/i.test(s)) {
      return '未能连接生图服务，积分已退回，请重试或换其他模型';
    }
    if (/upstream_submit_interrupted/i.test(s)) {
      return '提交被中断，积分已退回；请等 1 分钟后重试，勿重复连点';
    }
    if (/upstream_submit_stale/i.test(s)) {
      return '生图长时间无响应，积分已退回；请稍后再试或换其他模型';
    }
    if (/missing_task_id/i.test(s)) {
      return '任务提交异常，积分已全额退回，请重试';
    }
    if (/upstream_content_violation|prohibited words or images|prohibited|flagged as containing/i.test(s)) {
      return '提示词触发内容审核（含禁用词/图），请改描述后重试；积分已全额退回';
    }
    if (/upstream_content_violation/i.test(s)) {
      return '提示词触发内容审核，积分已全额退回，请调整描述后重试';
    }
    if (/违规不返还|violation.*no.*refund/i.test(s)) {
      return s.includes('违规不返还') ? s : '提示词触发内容审核，该模型违规不返还积分，请调整描述后重试';
    }
    if (/content.*policy|safety|moderation|blocked|违规|敏感/i.test(s)) {
      return '提示词可能触发内容审核，请改描述后重试；积分已全额退回';
    }
    if (/RATE_LIMITED|过于频繁|rate limit|429/i.test(s)) {
      return '提交过快，请稍等几秒再批量生成；积分已全额退回';
    }
    if (/不存在该模型|model.*not.*exist|unknown model|invalid model/i.test(s)) {
      return '模型相关提示，任务可能仍在排队；请强刷页面查看进度';
    }
    if (/GrsAI 未返回任务 ID/i.test(s)) {
      return '可能已接单但响应异常，请强刷页面查看是否在生成中';
    }
    if (s.length > 120) return s.slice(0, 120) + '…';
    return s;
  }

  function addFailedGenJob(job) {
    const entry = {
      id: job.id || genId('fail'),
      jobId: job.jobId || null,
      prompt: String(job.prompt || '').trim(),
      errorMessage: friendlyGenErrorMessage(job.errorMessage || '生图失败'),
      failedAt: job.failedAt || Date.now(),
      model: job.model ? normalizeImageGenModelId(job.model) : '',
      modelLabel: job.modelLabel || (job.model ? imageGenModelLabel(job.model) : ''),
      batchIndex: job.batchIndex || null,
      batchTotal: job.batchTotal || null,
      batchId: job.batchId || null,
      fromInspirationDraw: !!job.fromInspirationDraw,
      needsRecovery: !!job.needsRecovery || isStaleConfigError(job.errorMessage)
    };
    if (!entry.prompt) return;
    imageGenFailedJobs = [entry, ...imageGenFailedJobs.filter((f) => f.id !== entry.id)].slice(0, 24);
    persistFailedGenJobs();
  }

  function removeFailedGenJob(failId) {
    imageGenFailedJobs = imageGenFailedJobs.filter((f) => f.id !== failId);
    persistFailedGenJobs();
  }

  function clearFailedGenJobsForRecovery({ prompt, model, jobId } = {}) {
    const p = String(prompt || '').trim();
    const m = model ? normalizeImageGenModelId(model) : '';
    const before = imageGenFailedJobs.length;
    imageGenFailedJobs = imageGenFailedJobs.filter((f) => {
      if (jobId && f.jobId === jobId) return false;
      if (!p || !m) return true;
      if (String(f.prompt || '').trim() !== p) return true;
      if (f.model && normalizeImageGenModelId(f.model) !== m) return true;
      return false;
    });
    if (imageGenFailedJobs.length !== before) persistFailedGenJobs();
  }

  /** 提交请求网络中断时，从 API 找回刚创建的 processing 任务 */
  async function tryRecoverOrphanGenJobAfterSubmitError(payload, pendingId, pendingJob) {
    if (!window.PromptHubApi?.listRecentGenerationJobs) return false;
    const usedJobIds = new Set(
      imageGenPendingJobs.map((p) => p.jobId).filter(Boolean)
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 + attempt * 1200));
      const r = await window.PromptHubApi.listRecentGenerationJobs();
      if (!r?.ok || !Array.isArray(r.data?.jobs)) continue;
      const prompt = String(payload.prompt || '').trim();
      const model = normalizeImageGenModelId(payload.model || 'gpt-image-2');
      const job = findBestApiJobForPrompt(r.data.jobs, prompt, model, {
        minCreatedAt: pendingJob.startedAt || Date.now(),
        usedJobIds,
        preferProcessing: true,
        resolution: pendingJob.resolution
      });
      if (job?.id) {
        const t = Date.parse(job.createdAt);
        const now = Date.now();
        if (Number.isFinite(t) && now - t <= 300_000) {
          pendingJob.jobId = job.id;
          trackSessionGenJob(job.id);
          persistPendingGenJobs();
          clearFailedGenJobsForRecovery({ prompt, model, jobId: job.id });
          toast('网络波动，已找回刚提交的任务，正在恢复进度…');
          void pollGenerationJobUntilDone(job.id, pendingId, pendingJobToPollCtx(pendingJob));
          return true;
        }
      }
    }
    return false;
  }

  function failPendingJob(pendingId, errorMessage) {
    const job = imageGenPendingJobs.find((j) => j.id === pendingId);
    if (job) {
      addFailedGenJob({
        prompt: job.prompt,
        model: job.model,
        modelLabel: job.modelLabel || imageGenModelLabel(job.model),
        batchIndex: job.batchIndex,
        batchTotal: job.batchTotal,
        batchId: job.batchId,
        fromInspirationDraw: !!job.fromInspirationDraw,
        errorMessage: stringifyGenErrorRaw(errorMessage)
      });
    }
    removePendingJob(pendingId);
  }

  function toastGenFailure(ctx, message) {
    const label = batchIndexLabel(ctx?.batchIndex, ctx?.batchTotal);
    const msg = String(message || '生图失败，积分已全额退回');
    toast(label ? `${label} ${msg}` : msg);
  }

  function pendingJobToPollCtx(job) {
    return {
      prompt: job.prompt || '',
      model: job.model || 'gpt-image-2',
      resolution: job.resolution || '1k',
      quality: job.quality || 'standard',
      size: job.size || '1:1',
      cost: job.cost || 0,
      jobId: job.jobId,
      targetGroup: job.targetGroup || null,
      targetTags: job.targetTags || null,
      fromInspirationDraw: !!job.fromInspirationDraw,
      batchIndex: job.batchIndex || null,
      batchTotal: job.batchTotal || null,
      batchId: job.batchId || null,
      silentToast: !!job.silentToast,
      startedAt: job.startedAt || Date.now()
    };
  }

  function isRecentGenJob(job) {
    const t = Date.parse(job?.createdAt || '');
    return Number.isFinite(t) && Date.now() - t < RECENT_GEN_RECOVER_MS;
  }

  function shouldAutoRecoverCompletedJob(job) {
    if (isGenerationJobDeleted(job.id)) return false;
    if (!job?.imageUrl) return false;
    if (!isRecentGenJob(job)) return false;
    if (!needsApiImageRecovery(job.id, job.imageUrl)) return false;
    if (isSessionGenJob(job.id)) return true;
    if (imageGenPendingJobs.some((p) => p.jobId === job.id)) return true;
    return false;
  }

  function warehouseCardImageNeedsRecovery(card, apiImageUrl) {
    if (!apiImageUrl) return false;
    if (!card?.image || !isDisplayableImage(card.image)) return true;
    if (/^https?:\/\//i.test(card.image)) return true;
    if (window.SupabaseSync?.isDataUrl?.(card.image)) return true;
    if (window.SupabaseSync?.isStorageRef?.(card.image)) {
      const path = window.SupabaseSync.storagePathFromRef?.(card.image);
      if (path && window.SupabaseSync.isPathKnownMissing?.(path)) return true;
    }
    return false;
  }

  function findWarehouseCardForJob(jobId) {
    if (!jobId) return null;
    const key = String(jobId).replace(/#\d+$/, '');
    return (window.__promptHubCards || []).find((c) => {
      if (!c?.genJobId) return false;
      const cardKey = String(c.genJobId).replace(/#\d+$/, '');
      return c.genJobId === jobId || cardKey === key;
    }) || null;
  }

  function needsApiImageRecovery(jobId, apiImageUrl, force = false) {
    if (!jobId || !apiImageUrl) return false;
    if (isGenerationJobDeleted(jobId) && !force) return false;
    const card = findWarehouseCardForJob(jobId);
    if (!card) return true;
    return warehouseCardImageNeedsRecovery(card, apiImageUrl);
  }

  function jobNeedsRecovery(job) {
    if (!job?.id || isGenerationJobDeleted(job.id)) return false;
    if (job.status === 'processing' || job.status === 'failed') return true;
    if (job.status === 'completed' && job.imageUrl) {
      return needsApiImageRecovery(job.id, job.imageUrl);
    }
    if (job.status === 'completed' && !job.imageUrl) return true;
    return false;
  }

  async function refreshGenerationJobFromServer(job, opts = {}) {
    if (!job?.id || !window.PromptHubApi?.getGenerationJob) return job;
    try {
      const retry = await window.PromptHubApi.getGenerationJob(job.id, {
        settle: opts.settle === true
      });
      if (!retry.ok) return job;
      return {
        ...job,
        status: retry.data.status || job.status,
        imageUrl: retry.data.imageUrl || job.imageUrl || null,
        extraImageUrls: retry.data.extraImageUrls || job.extraImageUrls,
        isMidjourney: retry.data.isMidjourney || job.isMidjourney,
        mjGridUrls: retry.data.mjGridUrls || job.mjGridUrls,
        mjCompositeUrl: retry.data.mjCompositeUrl || job.mjCompositeUrl,
        mjButtons: retry.data.mjButtons || job.mjButtons,
        errorMessage: retry.data.errorMessage || retry.data.message || job.errorMessage,
        prompt: job.prompt,
        model: job.model,
        resolution: job.resolution,
        quality: job.quality,
        size: job.size,
        creditsCharged: job.creditsCharged,
        createdAt: job.createdAt
      };
    } catch (e) {
      return job;
    }
  }

  function recoveryJobPriority(job) {
    const t = Date.parse(job?.createdAt || '') || 0;
    const hasCard = hasWarehouseCardForJob(job?.id);
    if (job?.status === 'completed' && job?.imageUrl && !hasCard) return 1e15 + t;
    if (job?.status === 'completed' && !job?.imageUrl) return 5e14 + t;
    if (job?.status === 'processing') return 1e14 + t;
    if (job?.status === 'failed') return 1e13 + t;
    return t;
  }

  async function collectJobsNeedingRecovery(opts = {}) {
    if (!window.PromptHubApi?.listRecentGenerationJobs) return [];
    const r = await window.PromptHubApi.listRecentGenerationJobs();
    if (!r?.ok || !Array.isArray(r.data?.jobs)) return [];
    const maxCount = Math.max(1, opts.maxCount ?? 12);
    const ignoreTombstones = opts.ignoreTombstones === true;
    const candidates = [];
    for (const job of r.data.jobs) {
      if (!job?.id) continue;
      if (!ignoreTombstones && isGenerationJobDeleted(job.id)) continue;
      const mightNeed = job.status === 'processing'
        || job.status === 'failed'
        || (job.status === 'completed' && (!job.imageUrl || needsApiImageRecovery(job.id, job.imageUrl, opts.force === true)));
      if (!mightNeed) continue;
      candidates.push(job);
    }
    candidates.sort((a, b) => recoveryJobPriority(b) - recoveryJobPriority(a));
    const out = [];
    for (const job of candidates.slice(0, maxCount)) {
      const needRefresh = job.status === 'processing'
        || job.status === 'failed'
        || !job.imageUrl;
      const live = needRefresh ? await refreshGenerationJobFromServer(job) : job;
      if (jobNeedsRecovery(live)) out.push(live);
    }
    return out;
  }

  /** 延迟/重试同步：登录尚未就绪时也会再次拉取 */
  function scheduleGenJobsSync(delayMs) {
    clearTimeout(genJobsSyncTimer);
    genJobsSyncTimer = setTimeout(() => {
      void resumePendingGenerationJobs().then((ok) => {
        if (!ok && genJobsSyncRetry < 6) {
          genJobsSyncRetry += 1;
          scheduleGenJobsSync(Math.min(12000, 3000 + genJobsSyncRetry * 1500));
        } else if (ok) {
          genJobsSyncRetry = 0;
        }
      });
    }, delayMs == null ? 400 : delayMs);
  }

  function shouldRunGenJobsBackgroundSync() {
    if (imageGenPendingJobs.length > 0 || activePollJobIds.size > 0) return true;
    const onImageGen = document.getElementById('pageImageGen')?.classList.contains('active');
    if (!onImageGen) return false;
    return getSessionGenJobIds().length > 0;
  }

  function startGenJobsBackgroundSync() {
    if (genJobsSyncInterval) return;
    const hasActiveRecover = imageGenPendingJobs.some(
      (p) => p.recovering || isSlowGenProviderModel(p.model)
    );
    const syncIntervalMs = hasActiveRecover
      ? (isMobileViewport() ? 8000 : 7000)
      : imageGenPendingJobs.length > 0
        ? (isMobileViewport() ? 12000 : 12000)
        : (isMobileViewport() ? 45000 : 30000);
    genJobsSyncInterval = setInterval(() => {
      if (!window.PointsSystem?.useApiForAccount?.()) return;
      if (!shouldRunGenJobsBackgroundSync()) return;
      void resumePendingGenerationJobs().then(afterGenJobsResume);
      if (document.getElementById('pageImageGen')?.classList.contains('active') && imageGenPendingJobs.length) {
        scheduleImageGenPendingUiRefresh();
      }
    }, syncIntervalMs);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        persistPendingGenJobs();
        return;
      }
      loadPendingGenJobs();
      scheduleGenJobsSync(300);
      void resumePendingGenerationJobs({ force: true }).then(afterGenJobsResume);
    });
    window.addEventListener('pagehide', () => {
      persistPendingGenJobs();
    });
    window.addEventListener('pageshow', () => {
      loadPendingGenJobs();
      if (imageGenPendingJobs.length > 0) {
        renderImageGenFeed({ preserveScroll: true });
        renderImageGenMobileResult();
      }
      scheduleGenJobsSync(200);
      void resumePendingGenerationJobs({ force: true }).then(afterGenJobsResume);
    });
  }

  function getSessionGenJobIds() {
    const ids = new Set(getSessionGenJobIdsRaw());
    const localSession = loadGenJobStateFromLocal()?.session;
    if (Array.isArray(localSession)) {
      localSession.forEach((x) => ids.add(String(x)));
    }
    return [...ids];
  }

  function trackSessionGenJob(jobId) {
    if (!jobId) return;
    const id = String(jobId);
    const list = getSessionGenJobIds().filter((x) => x !== id);
    list.push(id);
    writeSessionGenJobIds(list);
  }

  function clearSessionGenJob(jobId) {
    if (!jobId) return;
    const id = String(jobId);
    writeSessionGenJobIds(getSessionGenJobIds().filter((x) => x !== id));
  }

  function isSessionGenJob(jobId) {
    return jobId && getSessionGenJobIds().includes(String(jobId));
  }

  /** 同提示词多任务时选最新/进行中，避免误绑旧 job 覆盖已有卡片图 */
  function findBestApiJobForPrompt(jobs, prompt, model, opts = {}) {
    const p = String(prompt || '').trim();
    const m = normalizeImageGenModelId(model || 'gpt-image-2');
    if (!p || !Array.isArray(jobs)) return null;
    const minCreated = Number(opts.minCreatedAt) || 0;
    const used = opts.usedJobIds;
    const preferProcessing = opts.preferProcessing === true;
    let best = null;
    let bestScore = -Infinity;
    for (const j of jobs) {
      if (!j?.id || isGenerationJobDeleted(j.id)) continue;
      if (used?.has?.(j.id)) continue;
      if (String(j.prompt || '').trim() !== p) continue;
      if (normalizeImageGenModelId(j.model || 'gpt-image-2') !== m) continue;
      if (opts.resolution && j.resolution && j.resolution !== opts.resolution) continue;
      const created = Date.parse(j.createdAt) || 0;
      if (minCreated && created < minCreated - 120000) continue;
      let score = created;
      if (j.status === 'processing') score += 2e15;
      else if (preferProcessing) score -= 1e15;
      else if (j.status === 'completed') score += 1e12;
      if (score > bestScore) {
        bestScore = score;
        best = j;
      }
    }
    return best;
  }

  function hasWarehouseCardForJob(jobId) {
    if (!jobId) return false;
    const key = String(jobId).replace(/#\d+$/, '');
    const card = (window.__promptHubCards || []).find((c) => {
      if (!c?.genJobId) return false;
      const cardKey = String(c.genJobId).replace(/#\d+$/, '');
      return c.genJobId === jobId || cardKey === key;
    });
    if (!card?.image) return false;
    if (!isDisplayableImage(card.image)) return false;
    return true;
  }

  function normalizePendingPromptKey(prompt) {
    return String(prompt || '')
      .replace(/（同任务附赠图\s*\d+）/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
  }

  function pendingPromptsMatch(a, b) {
    const ka = normalizePendingPromptKey(a);
    const kb = normalizePendingPromptKey(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    const head = Math.min(ka.length, kb.length, 56);
    if (head >= 28 && ka.slice(0, head) === kb.slice(0, head)) return true;
    return ka.includes(kb.slice(0, 48)) || kb.includes(ka.slice(0, 48));
  }

  function isGeneratedWarehouseCard(card) {
    if (!card) return false;
    const tags = Array.isArray(card.tags) ? card.tags : [];
    if (tags.includes('图片生成')) return true;
    const inspireTag = window.INSPIRE_DRAW_TAG || '灵感抽卡';
    if (tags.includes(inspireTag)) return true;
    return !!(card.genJobId || card.genSourceId);
  }

  function findWarehouseCardForPending(pending) {
    if (!pending) return null;
    const cards = window.__promptHubCards || [];
    if (pending.jobId) {
      const key = String(pending.jobId).replace(/#\d+$/, '');
      const byJob = cards.find((c) => {
        if (!c?.genJobId) return false;
        const cardKey = String(c.genJobId).replace(/#\d+$/, '');
        return c.genJobId === pending.jobId || cardKey === key;
      });
      if (byJob?.image && isDisplayableImage(byJob.image)) return byJob;
    }
    if (pending.jobId) {
      const cre = creations.find((c) => {
        if (!c?.jobId) return false;
        const cj = String(c.jobId).replace(/#\d+$/, '');
        const pj = String(pending.jobId).replace(/#\d+$/, '');
        return cj === pj;
      });
      if (cre?.id) {
        const bySource = cards.find((c) => c.genSourceId === cre.id);
        if (bySource?.image && isDisplayableImage(bySource.image)) return bySource;
      }
      return null;
    }
    const started = pending.startedAt || 0;
    if (!pending.prompt || !started) return null;
    const windowMs = 45 * 60 * 1000;
    const candidates = cards.filter((c) => {
      if (!c?.image || !isDisplayableImage(c.image)) return false;
      if (!isGeneratedWarehouseCard(c)) return false;
      const tags = Array.isArray(c.tags) ? c.tags : [];
      if (tags.includes('自动恢复') && c.genJobId && pending.jobId) {
        const pj = String(pending.jobId).replace(/#\d+$/, '');
        const cj = String(c.genJobId).replace(/#\d+$/, '');
        if (pj !== cj) return false;
      }
      if (!pendingPromptsMatch(c.prompt, pending.prompt)) return false;
      if (pending.resolution) {
        if (!c.resolution || c.resolution !== pending.resolution) return false;
      }
      if (pending.model && c.model && normalizeImageGenModelId(c.model) !== normalizeImageGenModelId(pending.model)) {
        return false;
      }
      const created = c.createdAt || c.updatedAt || 0;
      if (created && created < started - 120000) return false;
      if (created && created > started + windowMs) return false;
      return true;
    });
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const da = Math.abs((a.createdAt || a.updatedAt || 0) - started);
      const db = Math.abs((b.createdAt || b.updatedAt || 0) - started);
      return da - db;
    });
    return candidates[0];
  }

  function pendingHasWarehouseCard(pending) {
    return !!findWarehouseCardForPending(pending);
  }

  /** 卡片库已有对应生图卡片时，清掉生图区「生成中/恢复中」占位 */
  function prunePendingJobsWithWarehouseCards() {
    let changed = false;
    const next = [];
    for (const p of imageGenPendingJobs) {
      if (!pendingHasWarehouseCard(p)) {
        next.push(p);
        continue;
      }
      if (p?.jobId) clearSessionGenJob(p.jobId);
      changed = true;
    }
    if (!changed) return;
    imageGenPendingJobs = next;
    persistPendingGenJobs();
    scheduleImageGenPendingUiRefresh();
  }

  function getImageGenPendingJobsForFeed() {
    prunePendingJobsWithWarehouseCards();
    return imageGenPendingJobs;
  }

  function hasWarehouseCardRecordForJob(jobId) {
    if (!jobId) return false;
    return !!(window.__promptHubCards || []).find((c) => c.genJobId === jobId);
  }

  async function tryRecoverPendingJobDirect(pending) {
    if (!pending?.jobId || !window.PromptHubApi?.getGenerationJob) return false;
    const jobId = pending.jobId;
    try {
      if (window.PromptHubApi.recoverWarehouseFromJobs) {
        await window.PromptHubApi.recoverWarehouseFromJobs({
          mode: 'settle',
          jobIds: [jobId],
          max: 1,
          days: 7
        });
      }
    } catch (e) {
      console.warn('[imagegen] server settle recover failed', jobId, e);
    }
    if (hasWarehouseCardForJob(jobId)) {
      removePendingJob(pending.id);
      clearSessionGenJob(jobId);
      renderImageGenFeed({ preserveScroll: true });
      return true;
    }
    try {
      const poll = await window.PromptHubApi.getGenerationJob(jobId, { settle: true });
      if (poll.ok && poll.data?.status === 'completed' && poll.data.imageUrl) {
        await resolvePendingFromApiJob(pending, {
          id: jobId,
          status: 'completed',
          imageUrl: poll.data.imageUrl,
          extraImageUrls: poll.data.extraImageUrls,
          prompt: pending.prompt,
          model: pending.model
        }, { silent: true });
        return hasWarehouseCardForJob(jobId) || !imageGenPendingJobs.some((p) => p.id === pending.id);
      }
    } catch (e) {
      console.warn('[imagegen] direct job settle failed', jobId, e);
    }
    return hasWarehouseCardForJob(jobId);
  }

  async function tryServerRecoverPending(pending) {
    return tryRecoverPendingJobDirect(pending);
  }

  async function resolvePendingFromApiJob(pending, apiJob, opts = {}) {
    if (!pending || !apiJob?.id) return false;
    if (isGenerationJobDeleted(apiJob.id)) {
      removePendingJob(pending.id);
      clearSessionGenJob(apiJob.id);
      return true;
    }
    const ctx = pendingJobToPollCtx(pending);
    ctx.silentToast = opts.silent !== false;

    if (apiJob.status === 'completed' && apiJob.imageUrl) {
      pending.recovering = false;
      pending.recoverNote = '';
      pending.pendingNote = '';
      const existingCard = findWarehouseCardForJob(apiJob.id);
      if (existingCard && hasWarehouseCardForJob(apiJob.id)) {
        if (warehouseCardImageNeedsRecovery(existingCard, apiJob.imageUrl)) {
          await repairWarehouseCardImageFromJob(existingCard, apiJob.imageUrl, apiJob.id);
          renderImageGenFeed({ preserveScroll: true });
        }
        removePendingJob(pending.id);
        clearSessionGenJob(apiJob.id);
        return true;
      }
      if (existingCard && !existingCard.image) {
        await repairWarehouseCardImageFromJob(existingCard, apiJob.imageUrl, apiJob.id);
        removePendingJob(pending.id);
        clearSessionGenJob(apiJob.id);
        return true;
      }
      await ensureGenJobCreationsFromPoll(
        {
          data: {
            status: 'completed',
            imageUrl: apiJob.imageUrl,
            extraImageUrls: apiJob.extraImageUrls
          }
        },
        { ...ctx, jobId: apiJob.id, isRecovery: true },
        pending.id
      );
      clearSessionGenJob(apiJob.id);
      return true;
    }

    if (apiJob.status === 'failed') {
      const refreshed = await refreshGenerationJobFromServer(apiJob);
      if (refreshed.status === 'completed' && refreshed.imageUrl) {
        return resolvePendingFromApiJob(pending, refreshed, opts);
      }
      if (shouldDeferFailedPendingRecovery(pending, refreshed, ctx)) {
        if (await tryServerRecoverPending(pending)) return true;
        pending.recovering = true;
        pending.recoverNote = formatPendingRecoveryNote(pending, '上游可能仍在出图，后台继续恢复…');
        persistPendingGenJobs();
        if (pending.jobId && Date.now() - (pending.startedAt || 0) >= SERVER_RECOVER_AFTER_MS) {
          void tryRecoverPendingJobDirect(pending);
        }
        if (!activePollJobIds.has(pending.jobId)) {
          void pollGenerationJobUntilDone(pending.jobId, pending.id, ctx);
        }
        scheduleImageGenPendingUiRefresh();
        return false;
      }
      await failPendingJobImmediately(
        pending.id,
        ctx,
        refreshed.errorMessage || apiJob.errorMessage || apiJob.message || '生图失败'
      );
      clearSessionGenJob(apiJob.id);
      return true;
    }

    if (
      pending.recovering
      && Date.now() - (pending.startedAt || 0) >= pendingRecoveryGiveUpMs(pending)
    ) {
      if (await tryServerRecoverPending(pending)) return true;
      if (apiJob.status === 'processing') {
        if (!activePollJobIds.has(apiJob.id)) {
          void pollGenerationJobUntilDone(apiJob.id, pending.id, ctx);
        }
        return false;
      }
      const retry = await window.PromptHubApi.getGenerationJob(apiJob.id);
      if (retry.ok && retry.data.status === 'completed' && retry.data.imageUrl) {
        return resolvePendingFromApiJob(pending, {
          id: apiJob.id,
          status: 'completed',
          imageUrl: retry.data.imageUrl,
          extraImageUrls: retry.data.extraImageUrls,
          prompt: pending.prompt,
          model: pending.model
        }, opts);
      }
      if (retry.ok && retry.data.status === 'processing') {
        if (!activePollJobIds.has(apiJob.id)) {
          void pollGenerationJobUntilDone(apiJob.id, pending.id, ctx);
        }
        return false;
      }
      if (retry.ok && retry.data.status === 'failed') {
        const failSnap = {
          id: apiJob.id,
          status: 'failed',
          errorMessage: retry.data.errorMessage || retry.data.message,
          prompt: pending.prompt,
          model: pending.model
        };
        if (shouldDeferFailedPendingRecovery(pending, failSnap, ctx)) {
          if (await tryServerRecoverPending(pending)) return true;
          return false;
        }
        await failPendingJobImmediately(
          pending.id,
          ctx,
          failSnap.errorMessage || '生图失败'
        );
        clearSessionGenJob(apiJob.id);
        return true;
      }
      if (await tryServerRecoverPending(pending)) return true;
      if (Date.now() - (pending.startedAt || 0) < RECENT_GEN_RECOVER_MS) return false;
      await failPendingJobImmediately(pending.id, ctx, '生图超时或上游无结果，积分已全额退回');
      clearSessionGenJob(apiJob.id);
      return true;
    }

    return false;
  }

  async function repairMjWarehouseCardFields(card, fields) {
    if (!card?.id) return false;
    let changed = false;
    const gridUrls = Array.isArray(fields.mjGridUrls) ? fields.mjGridUrls.filter(Boolean) : [];
    if (gridUrls.length && (!Array.isArray(card.mjGridUrls) || card.mjGridUrls.length < gridUrls.length)) {
      card.mjGridUrls = gridUrls;
      changed = true;
    }
    if (fields.mjCompositeUrl && !card.mjCompositeUrl) {
      card.mjCompositeUrl = fields.mjCompositeUrl;
      changed = true;
    }
    if (Array.isArray(fields.mjButtons) && fields.mjButtons.length
      && (!Array.isArray(card.mjButtons) || !card.mjButtons.length)) {
      card.mjButtons = fields.mjButtons;
      changed = true;
    }
    if (!card.isMidjourney && gridUrls.length) {
      card.isMidjourney = true;
      changed = true;
    }
    if (!changed) return false;
    card.updatedAt = Date.now();
    const cre = creations.find(
      (c) => c.jobId === card.genJobId || c.id === card.genSourceId
    );
    if (cre) {
      if (gridUrls.length) cre.mjGridUrls = gridUrls;
      if (fields.mjCompositeUrl) cre.mjCompositeUrl = fields.mjCompositeUrl;
      if (fields.mjButtons?.length) cre.mjButtons = fields.mjButtons;
      cre.isMidjourney = true;
      persistCreations();
    }
    if (typeof window.persistPromptHubCards === 'function') await window.persistPromptHubCards();
    return true;
  }

  async function repairWarehouseCardImageFromJob(card, imageUrl, jobId) {
    if (!card?.id || !imageUrl) return false;
    const tombKey = jobId || card.genJobId;
    if (tombKey && isGenerationJobDeleted(tombKey)) return false;
    if (jobId && card.genJobId && String(card.genJobId) !== String(jobId)) {
      console.warn('[imagegen] 跳过修复：卡片 genJobId 与任务不一致', card.id, card.genJobId, jobId);
      return false;
    }
    let stored = imageUrl;
    if (window.SupabaseSync?.persistGenerationImage) {
      try {
        stored = await window.SupabaseSync.persistGenerationImage(card.id, imageUrl, {
          jobId: jobId || card.genJobId || null
        });
      } catch (e) {
        console.warn('恢复生图：归档到 Storage 失败，使用任务链接', e);
      }
    }
    card.image = stored || imageUrl;
    card.updatedAt = Date.now();
    if (typeof window.persistPromptHubCards === 'function') await window.persistPromptHubCards();
    return true;
  }

  /** 用户删卡片时：标记 job 已删，避免 API 恢复把它拉回来 */
  function onCardDeletedForGen(card) {
    if (!card) return;
    const jobId = card.genJobId;
    if (jobId) {
      const baseJobId = normalizeGenJobBaseId(jobId);
      window.recordGenerationJobDeletion?.(jobId);
      if (baseJobId && baseJobId !== String(jobId)) {
        window.recordGenerationJobDeletion?.(baseJobId);
      }
      clearSessionGenJob(jobId);
      if (baseJobId && baseJobId !== String(jobId)) clearSessionGenJob(baseJobId);
      const relatedCreations = creations.filter((c) => {
        if (!c?.jobId) return false;
        const cBase = normalizeGenJobBaseId(c.jobId);
        return c.jobId === jobId || cBase === baseJobId;
      });
      for (const cre of relatedCreations) {
        recordCreationDeletion(cre.id, cre.jobId);
      }
      if (relatedCreations.length) {
        const tombIds = new Set(relatedCreations.map((c) => String(c.id)));
        creations = creations.filter((c) => !tombIds.has(String(c.id)));
        persistCreations();
      }
    }
  }

  async function listRecoverableOrphanJobs(opts = {}) {
    return collectJobsNeedingRecovery(opts);
  }

  async function settleStuckGenerationJob(job, opts = {}) {
    const maxMs = Math.max(8000, opts.maxMs ?? 18000);
    const stepMs = opts.stepMs ?? 2200;
    let live = { ...job };
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      live = await refreshGenerationJobFromServer(live);
      if (live.status === 'completed' && live.imageUrl) return live;
      if (live.status === 'failed') return live;
      if (live.status !== 'processing') break;
      await new Promise((r) => setTimeout(r, stepMs));
    }
    return live;
  }

  async function recoverSingleJobFromApi(job, opts = {}) {
    if (!job?.id) return false;
    if (isGenerationJobDeleted(job.id)) return false;
    const force = opts.force === true;
    const awaitSettle = opts.awaitSettle === true;
    let live = await refreshGenerationJobFromServer(job);

    if (awaitSettle && (live.status === 'processing' || !live.imageUrl)) {
      live = await settleStuckGenerationJob(live, {
        maxMs: opts.settleMaxMs ?? (awaitSettle ? 16000 : 18000),
        stepMs: 2200
      });
    } else if (live.status === 'processing' || live.status === 'failed' || !live.imageUrl) {
      live = await refreshGenerationJobFromServer(live);
    }

    if (live.status === 'failed') {
      const settled = await refreshGenerationJobFromServer(live);
      if (settled.status === 'completed' && settled.imageUrl) {
        live = settled;
      } else {
        const pending = imageGenPendingJobs.find((p) => p.jobId === live.id);
        if (pending && (force || pending.recovering)) {
          if (await tryServerRecoverPending(pending)) return true;
          if (!force && Date.now() - (pending.startedAt || 0) < pendingRecoveryGiveUpMs(pending)) {
            pending.recovering = true;
            persistPendingGenJobs();
            return false;
          }
        }
        if (pending) {
          await resolvePendingFromApiJob(pending, {
            id: live.id,
            status: 'failed',
            errorMessage: live.errorMessage || live.message || '生图失败',
            prompt: live.prompt,
            model: live.model
          }, opts);
        }
        return false;
      }
    }

    if (live.status !== 'completed' || !live.imageUrl) {
      if (awaitSettle) return false;
      const existing = imageGenPendingJobs.find((p) => p.jobId === live.id);
      const pendingId = existing?.id || genId('pending');
      if (!existing) {
        imageGenPendingJobs.unshift({
          id: pendingId,
          jobId: live.id,
          prompt: live.prompt || '',
          model: live.model || 'gpt-image-2',
          modelLabel: live.modelLabel || imageGenModelLabel(live.model),
          resolution: live.resolution || '1k',
          quality: live.quality || 'standard',
          size: live.size || '1:1',
          cost: live.creditsCharged || 0,
          startedAt: Date.parse(live.createdAt) || Date.now()
        });
        persistPendingGenJobs();
      }
      if (!activePollJobIds.has(live.id)) {
        void pollGenerationJobUntilDone(live.id, pendingId, {
          prompt: live.prompt || '',
          model: live.model || 'gpt-image-2',
          resolution: live.resolution || '1k',
          quality: live.quality || 'standard',
          size: live.size || '1:1',
          cost: live.creditsCharged || 0,
          jobId: live.id,
          silentToast: opts.silentToast !== false,
          startedAt: Date.parse(live.createdAt) || Date.now()
        });
      }
      return false;
    }
    if (live.status !== 'completed' || !live.imageUrl) return false;
    if (!needsApiImageRecovery(live.id, live.imageUrl, force)) return false;
    const existingCard = (window.__promptHubCards || []).find((c) => c.genJobId === live.id);
    if (existingCard) {
      await repairWarehouseCardImageFromJob(existingCard, live.imageUrl, live.id);
      imageGenPendingJobs = imageGenPendingJobs.filter((p) => p.jobId !== live.id);
      clearSessionGenJob(live.id);
      return true;
    }
    const extras = Array.isArray(live.extraImageUrls)
      ? live.extraImageUrls.filter((u) => u && u !== live.imageUrl)
      : [];
    await ensureGenJobCreationsFromPoll(
      { data: { status: 'completed', imageUrl: live.imageUrl, extraImageUrls: extras } },
      {
        prompt: live.prompt || '',
        model: live.model || 'gpt-image-2',
        resolution: live.resolution || '1k',
        quality: live.quality || 'standard',
        size: live.size || '1:1',
        cost: live.creditsCharged || 0,
        jobId: live.id,
        silentToast: opts.silentToast !== false,
        isRecovery: true
      },
      imageGenPendingJobs.find((p) => p.jobId === live.id)?.id || null
    );
    return true;
  }

  async function recoverLostGenerationsFromApi() {
    return { ok: true, recovered: 0 };
  }

  let missingGenCardRepairInflight = null;

  /** 卡片有 genJobId 但无有效图：从 API 任务链或本地备份恢复 */
  async function repairMissingGenCardImagesQuiet() {
    if (!window.PromptHubApi?.getGenerationJob || !window.SupabaseSync?.isLoggedIn?.()) return false;
    if (missingGenCardRepairInflight) return missingGenCardRepairInflight;
    const list = window.__promptHubCards || [];
    const tomb = window.getDeletedGenerationJobTombstones?.() || {};
    const targets = list.filter((c) => {
      if (!c?.id || !c?.genJobId) return false;
      const jobKey = String(c.genJobId);
      const base = jobKey.replace(/#\d+$/, '');
      if (tomb[jobKey] || (base && tomb[base])) return false;
      if (!c.image) return true;
      return !isUsableWarehouseImage(c);
    }).slice(0, 8);
    if (!targets.length) return false;
    missingGenCardRepairInflight = (async () => {
      let changed = false;
      for (const card of targets) {
        try {
          let src = null;
          const jobId = String(card.genJobId);
          const baseJobId = jobId.replace(/#\d+$/, '');
          const r = await window.PromptHubApi.getGenerationJob(baseJobId);
          if (r?.ok && r.data?.imageUrl) src = r.data.imageUrl;
          if (!src && typeof window.getCardImageBackup === 'function') {
            const backup = await window.getCardImageBackup(card.id);
            if (backup && isDisplayableImage(backup)) src = backup;
          }
          if (!src) continue;
          const ok = await repairWarehouseCardImageFromJob(card, src, jobId);
          if (ok) {
            changed = true;
            window.SupabaseSync?.clearPathMissingForCard?.(card.id, card.image);
            if (typeof window.saveCardImageBackup === 'function') {
              void window.saveCardImageBackup(card.id, src).catch(() => {});
            }
          }
        } catch (e) {
          console.warn('[repairMissingGenCardImages]', card.id, e);
        }
        await new Promise((res) => setTimeout(res, 160));
      }
      if (changed) {
        if (typeof window.persistPromptHubCards === 'function') await window.persistPromptHubCards();
        window.refreshWarehouseUI?.({ softCards: true });
        if (document.getElementById('pageImageGen')?.classList.contains('active')) {
          renderImageGenFeed({ preserveScroll: true });
        }
        queueUrgentCardsSync();
      }
      return changed;
    })().finally(() => { missingGenCardRepairInflight = null; });
    return missingGenCardRepairInflight;
  }

  /** 刷新/登录后：恢复进行中的卡片、续轮询、静默补全已完成任务 */
  async function resumePendingGenerationJobs(opts = {}) {
    if (!window.PromptHubApi?.listRecentGenerationJobs) return false;
    if (!window.PointsSystem?.useApiForAccount?.()) return false;
    purgeExpiredGenPendingJobs();
    const now = Date.now();
    if (!opts.force && now - lastGenJobsListAt < (imageGenPendingJobs.length > 0 ? 4000 : GEN_JOBS_LIST_MIN_MS)) return false;
    if (resumeGenJobsInflight) return resumeGenJobsInflight;

    resumeGenJobsInflight = (async () => {
      lastGenJobsListAt = Date.now();
      const r = await window.PromptHubApi.listRecentGenerationJobs();
      if (!r?.ok || !Array.isArray(r.data?.jobs)) return false;

      let changed = false;
      const apiById = new Map();
      const attachedJobIds = new Set();

      for (const job of r.data.jobs) {
        if (job?.id) apiById.set(job.id, job);
      }

      /** 所有 pending 任务强制拉最新状态（不受 list 轮询预算限制） */
      const pendingJobIds = [...new Set(
        imageGenPendingJobs.map((p) => p.jobId).filter(Boolean)
      )];
      for (const jobId of pendingJobIds) {
        const pending = imageGenPendingJobs.find((p) => p.jobId === jobId);
        if (!pending) continue;
        const pendingAge = Date.now() - (pending.startedAt || 0);
        const ctx = pendingJobToPollCtx(pending);
        try {
          const retry = await window.PromptHubApi.getGenerationJob(jobId, {
            settle: isLongRunningGenJob(ctx) && pendingAge > 60_000
          });
          if (!retry.ok) continue;
          const aj = {
            id: jobId,
            status: retry.data.status,
            imageUrl: retry.data.imageUrl,
            extraImageUrls: retry.data.extraImageUrls,
            errorMessage: retry.data.errorMessage || retry.data.message,
            prompt: pending.prompt,
            model: pending.model,
            resolution: pending.resolution,
            quality: pending.quality,
            size: pending.size
          };
          apiById.set(jobId, aj);
          if (aj.status === 'completed' && aj.imageUrl) {
            pending.recovering = false;
            pending.recoverNote = '';
            if (await resolvePendingFromApiJob(pending, aj, { silent: true })) changed = true;
          } else if (
            aj.status === 'failed'
            && !isLikelyRecoverableGenFailure(aj.errorMessage, ctx)
          ) {
            if (await resolvePendingFromApiJob(pending, aj, { silent: true })) changed = true;
          }
        } catch (e) { /* ignore */ }
      }

      const refreshTargets = r.data.jobs.filter((j) => {
        if (!j?.id || isGenerationJobDeleted(j.id)) return false;
        if (j.status !== 'processing' && !(j.status === 'completed' && !j.imageUrl)) return false;
        const age = Date.now() - (Date.parse(j.createdAt) || 0);
        return imageGenPendingJobs.some((p) => p.jobId === j.id)
          || isSessionGenJob(j.id)
          || age > 4 * 60 * 1000;
      }).slice(0, 6);
      for (const job of refreshTargets) {
        const live = await refreshGenerationJobFromServer(job);
        apiById.set(job.id, live);
      }

      /** 按提示词+模型匹配 API 任务（无 jobId 的旧占位；取最新/进行中） */
      function matchApiJobForPending(p) {
        if (p.jobId && apiById.has(p.jobId)) return apiById.get(p.jobId);
        return findBestApiJobForPrompt(r.data.jobs, p.prompt, p.model, {
          minCreatedAt: p.startedAt || Date.now(),
          preferProcessing: true,
          resolution: p.resolution
        });
      }

      for (const pending of imageGenPendingJobs.slice()) {
        if (pendingHasWarehouseCard(pending)) {
          removePendingJob(pending.id);
          if (pending.jobId) clearSessionGenJob(pending.jobId);
          changed = true;
          continue;
        }
        if (!pending.jobId) {
          const matched = matchApiJobForPending(pending);
          if (matched?.id) {
            pending.jobId = matched.id;
            trackSessionGenJob(matched.id);
            persistPendingGenJobs();
          }
        }
        if (!pending.jobId) {
          if (Date.now() - (pending.startedAt || 0) > 20 * 60 * 1000) {
            failPendingJob(pending.id, '未找到对应任务，积分已全额退回');
            changed = true;
          }
          continue;
        }
        let aj = apiById.get(pending.jobId);
        const pendingAge = Date.now() - (pending.startedAt || 0);
        const pollCtx = pendingJobToPollCtx(pending);
        if (pending.jobId && (!aj || aj.status === 'processing' || pendingAge > 20_000)) {
          try {
            const retry = await window.PromptHubApi.getGenerationJob(pending.jobId, {
              settle: isLongRunningGenJob(pollCtx) && pendingAge > 60_000
            });
            if (retry.ok) {
              aj = {
                id: pending.jobId,
                status: retry.data.status,
                imageUrl: retry.data.imageUrl,
                extraImageUrls: retry.data.extraImageUrls,
                errorMessage: retry.data.errorMessage || retry.data.message,
                prompt: pending.prompt,
                model: pending.model
              };
              apiById.set(pending.jobId, aj);
            }
          } catch (e) { /* ignore */ }
        }
        if (aj && aj.status !== 'processing') {
          if (await resolvePendingFromApiJob(pending, aj)) changed = true;
          continue;
        }
        const deferAge = Date.now() - (pending.startedAt || 0);
        if (pending.recovering && deferAge >= pendingRecoveryGiveUpMs(pending) && aj?.status === 'processing') {
          if (!activePollJobIds.has(pending.jobId)) {
            void pollGenerationJobUntilDone(pending.jobId, pending.id, pendingJobToPollCtx(pending));
          }
          continue;
        }
        if (pending.recovering && pending.jobId && !activePollJobIds.has(pending.jobId)) {
          const retry = await window.PromptHubApi.getGenerationJob(pending.jobId, {
            settle: isLongRunningGenJob(pendingJobToPollCtx(pending)) && pendingAge > 60_000
          });
          if (retry.ok) {
            const snap = {
              id: pending.jobId,
              status: retry.data.status,
              imageUrl: retry.data.imageUrl,
              extraImageUrls: retry.data.extraImageUrls,
              errorMessage: retry.data.errorMessage || retry.data.message,
              prompt: pending.prompt,
              model: pending.model
            };
            apiById.set(pending.jobId, snap);
            if (await resolvePendingFromApiJob(pending, snap)) {
              changed = true;
              continue;
            }
            if (retry.data.status === 'processing' && !activePollJobIds.has(pending.jobId)) {
              void pollGenerationJobUntilDone(pending.jobId, pending.id, pendingJobToPollCtx(pending));
            }
          }
        }
      }

      for (const job of imageGenPendingJobs.slice()) {
        if (!job.jobId || activePollJobIds.has(job.jobId)) continue;
        if (Date.now() - (job.startedAt || 0) >= RECENT_GEN_RECOVER_MS) {
          abandonUnrecoverablePendingJob(
            job,
            '该任务已超过 2 小时恢复窗口，已关闭占位',
            { toast: true }
          );
          if (job.jobId) window.recordGenerationJobDeletion?.(job.jobId);
          changed = true;
          continue;
        }
        const aj = apiById.get(job.jobId);
        if (aj?.status === 'processing') {
          void pollGenerationJobUntilDone(job.jobId, job.id, pendingJobToPollCtx(job));
        }
      }

      for (const job of r.data.jobs) {
        if (!job?.id || job.status !== 'failed') continue;
        const pending = imageGenPendingJobs.find((p) => p.jobId === job.id);
        if (!pending) continue;
        if (await resolvePendingFromApiJob(pending, job, { silent: true })) changed = true;
      }

      for (const job of r.data.jobs) {
        if (!job?.id || job.status !== 'failed') continue;
        if (!isSessionGenJob(job.id)) continue;
        if (imageGenPendingJobs.some((p) => p.jobId === job.id)) continue;
        if (imageGenFailedJobs.some((f) => f.jobId === job.id)) continue;
        if (hasWarehouseCardForJob(job.id)) continue;
        const live = apiById.get(job.id) || job;
        const failCtx = {
          model: live.model || job.model,
          resolution: live.resolution || job.resolution
        };
        if (isLikelyRecoverableGenFailure(live.errorMessage || job.errorMessage, failCtx)) continue;
        addFailedGenJob({
          jobId: job.id,
          prompt: job.prompt || live.prompt,
          model: job.model || live.model,
          modelLabel: job.modelLabel || live.modelLabel,
          errorMessage: live.errorMessage || job.errorMessage || '生图失败'
        });
        changed = true;
      }

      for (const job of r.data.jobs) {
        if (!job?.id) continue;
        if (isGenerationJobDeleted(job.id)) continue;

        if (job.status === 'processing') {
          if (hasWarehouseCardForJob(job.id)) {
            const stale = imageGenPendingJobs.find((j) => j.jobId === job.id);
            if (stale) {
              removePendingJob(stale.id);
              clearSessionGenJob(job.id);
              changed = true;
            }
            continue;
          }
          const jobAge = Date.now() - (Date.parse(job.createdAt) || 0);
          if (jobAge >= RECENT_GEN_RECOVER_MS) {
            if (job.status === 'processing' && !hasWarehouseCardForJob(job.id)) {
              window.recordGenerationJobDeletion?.(job.id);
            }
            continue;
          }
          if (jobAge > 12 * 60 * 1000) {
            const settled = await settleStuckGenerationJob(apiById.get(job.id) || job, { maxMs: 12000 });
            if (settled.status === 'completed' && settled.imageUrl) {
              if (await recoverSingleJobFromApi(settled, { silentToast: true, force: true })) {
                changed = true;
                continue;
              }
            }
          }
          const existingCard = (window.__promptHubCards || []).find((c) => c.genJobId === job.id);
          if (existingCard && !existingCard.image && job.imageUrl) {
            await repairWarehouseCardImageFromJob(existingCard, job.imageUrl, job.id);
            imageGenPendingJobs = imageGenPendingJobs.filter((p) => p.jobId !== job.id);
            clearSessionGenJob(job.id);
            changed = true;
            continue;
          }
          const hasCreation = creations.some((c) => c.jobId === job.id);
          if (hasCreation) continue;
          let pending = imageGenPendingJobs.find((j) => j.jobId === job.id);
          if (!pending) {
            const pendingId = genId('pending');
            pending = {
              id: pendingId,
              jobId: job.id,
              prompt: job.prompt || '',
              model: job.model || 'gpt-image-2',
              modelLabel: job.modelLabel || imageGenModelLabel(job.model),
              resolution: job.resolution || '1k',
              quality: job.quality || 'standard',
              size: job.size || '1:1',
              cost: job.creditsCharged || 0,
              startedAt: Date.parse(job.createdAt) || Date.now()
            };
            imageGenPendingJobs.unshift(pending);
            trackSessionGenJob(job.id);
            changed = true;
          }
          if (Date.now() - (pending.startedAt || 0) >= RECENT_GEN_RECOVER_MS) {
            abandonUnrecoverablePendingJob(pending, null, { toast: false });
            window.recordGenerationJobDeletion?.(job.id);
            changed = true;
            continue;
          }
          attachedJobIds.add(job.id);
          clearFailedGenJobsForRecovery({
            prompt: job.prompt,
            model: job.model,
            jobId: job.id
          });
          if (!activePollJobIds.has(job.id)) {
            void pollGenerationJobUntilDone(job.id, pending.id, pendingJobToPollCtx(pending));
          }
          continue;
        }

        let recoverJob = job;
        if (job.status === 'failed') {
          const pending = imageGenPendingJobs.find((j) => j.jobId === job.id);
          const retry = await window.PromptHubApi.getGenerationJob(job.id);
          if (retry.ok && retry.data.status === 'processing') {
            if (!pending) {
              const pendingId = genId('pending');
              const newPending = {
                id: pendingId,
                jobId: job.id,
                prompt: job.prompt || '',
                model: job.model || 'gpt-image-2',
                modelLabel: job.modelLabel || imageGenModelLabel(job.model),
                resolution: job.resolution || '1k',
                quality: job.quality || 'standard',
                size: job.size || '1:1',
                cost: job.creditsCharged || 0,
                startedAt: Date.parse(job.createdAt) || Date.now()
              };
              imageGenPendingJobs.unshift(newPending);
              trackSessionGenJob(job.id);
              pending = newPending;
              changed = true;
            }
            attachedJobIds.add(job.id);
            clearFailedGenJobsForRecovery({
              prompt: job.prompt,
              model: job.model,
              jobId: job.id
            });
            if (!activePollJobIds.has(job.id)) {
              void pollGenerationJobUntilDone(job.id, pending.id, pendingJobToPollCtx(pending));
            }
            continue;
          }
          if (retry.ok && retry.data.status === 'completed' && retry.data.imageUrl) {
            recoverJob = {
              ...job,
              status: 'completed',
              imageUrl: retry.data.imageUrl,
              extraImageUrls: retry.data.extraImageUrls
            };
          } else if (pending) {
            if (await resolvePendingFromApiJob(pending, {
              id: job.id,
              status: 'failed',
              errorMessage: retry.ok
                ? (retry.data.errorMessage || retry.data.message)
                : (job.errorMessage || '生图失败'),
              prompt: job.prompt,
              model: job.model
            })) {
              changed = true;
            }
            continue;
          } else {
            continue;
          }
        }
        if (recoverJob.status !== 'completed' || !recoverJob.imageUrl) continue;

        const recoverCtx = {
          prompt: recoverJob.prompt || '',
          model: recoverJob.model || 'gpt-image-2',
          resolution: recoverJob.resolution || '1k',
          quality: recoverJob.quality || 'standard',
          size: recoverJob.size || '1:1',
          cost: recoverJob.creditsCharged || 0
        };
        if (await syncMissingBonusImagesForJob(recoverJob, recoverCtx, { silentToast: false })) {
          changed = true;
          attachedJobIds.add(recoverJob.id);
          continue;
        }

        if (!shouldAutoRecoverCompletedJob(recoverJob)) continue;

        const existingCard = (window.__promptHubCards || []).find((c) => c.genJobId === recoverJob.id);
        if (existingCard && hasWarehouseCardForJob(recoverJob.id)) continue;
        const recoverExtrasEarly = Array.isArray(recoverJob.extraImageUrls)
          ? recoverJob.extraImageUrls.filter((u) => u && u !== recoverJob.imageUrl)
          : [];
        if (
          !existingCard
          && creations.some(
            (c) => c.jobId === recoverJob.id || String(c.jobId || '').startsWith(`${recoverJob.id}#`)
          )
        ) {
          if (!hasWarehouseCardForJob(recoverJob.id)) {
            changed = true;
            attachedJobIds.add(recoverJob.id);
            imageGenPendingJobs = imageGenPendingJobs.filter((p) => p.jobId !== recoverJob.id);
            await ensureGenJobCreationsFromPoll(
              { data: { status: 'completed', imageUrl: recoverJob.imageUrl, extraImageUrls: recoverExtrasEarly } },
              {
                prompt: recoverJob.prompt || '',
                model: recoverJob.model || 'gpt-image-2',
                resolution: recoverJob.resolution || '1k',
                quality: recoverJob.quality || 'standard',
                size: recoverJob.size || '1:1',
                cost: recoverJob.creditsCharged || 0,
                jobId: recoverJob.id,
                silentToast: true,
                isRecovery: true
              },
              null
            );
          } else if (!allGenCreationSlotsSaved(recoverJob.id, recoverExtrasEarly.length)) {
            changed = true;
            attachedJobIds.add(recoverJob.id);
            imageGenPendingJobs = imageGenPendingJobs.filter((p) => p.jobId !== recoverJob.id);
            await ensureGenJobCreationsFromPoll(
              { data: { status: 'completed', imageUrl: recoverJob.imageUrl, extraImageUrls: recoverExtrasEarly } },
              {
                prompt: recoverJob.prompt || '',
                model: recoverJob.model || 'gpt-image-2',
                resolution: recoverJob.resolution || '1k',
                quality: recoverJob.quality || 'standard',
                size: recoverJob.size || '1:1',
                cost: recoverJob.creditsCharged || 0,
                jobId: recoverJob.id,
                silentToast: true,
                isRecovery: true
              },
              null
            );
          }
          continue;
        }

        changed = true;
        attachedJobIds.add(recoverJob.id);
        imageGenPendingJobs = imageGenPendingJobs.filter((p) => p.jobId !== recoverJob.id);
        if (existingCard && !existingCard.image) {
          await repairWarehouseCardImageFromJob(existingCard, recoverJob.imageUrl, recoverJob.id);
          continue;
        }
        const recoverExtras = Array.isArray(recoverJob.extraImageUrls)
          ? recoverJob.extraImageUrls.filter((u) => u && u !== recoverJob.imageUrl)
          : [];
        await finishImageGenRun({
          prompt: recoverJob.prompt || '',
          model: recoverJob.model || 'gpt-image-2',
          resolution: recoverJob.resolution || '1k',
          quality: recoverJob.quality || 'standard',
          size: recoverJob.size || '1:1',
          cost: recoverJob.creditsCharged || 0,
          jobId: recoverJob.id,
          image: recoverJob.imageUrl,
          extraImages: recoverExtras,
          silentToast: true,
          isRecovery: true
        });
      }

      // 无 jobId 的占位（提交中）：尝试按提示词匹配 API 进行中任务
      const processingOnApi = r.data.jobs.filter(
        (j) => j?.id && j.status === 'processing' && !attachedJobIds.has(j.id) && !isGenerationJobDeleted(j.id)
      );
      for (const p of imageGenPendingJobs.filter((x) => !x.jobId)) {
        if (Date.now() - (p.startedAt || 0) > 15 * 60 * 1000) continue;
        const match = findBestApiJobForPrompt(processingOnApi, p.prompt, p.model, {
          minCreatedAt: p.startedAt || Date.now(),
          usedJobIds: attachedJobIds,
          preferProcessing: true,
          resolution: p.resolution
        });
        if (!match || attachedJobIds.has(match.id)) continue;
        p.jobId = match.id;
        trackSessionGenJob(match.id);
        attachedJobIds.add(match.id);
        changed = true;
        if (!activePollJobIds.has(match.id)) {
          void pollGenerationJobUntilDone(match.id, p.id, pendingJobToPollCtx(p));
        }
      }

      const before = imageGenPendingJobs.length;
      for (const p of imageGenPendingJobs.slice()) {
        if (!p.jobId) continue;
        const aj = apiById.get(p.jobId);
        if (aj && aj.status !== 'processing') {
          await resolvePendingFromApiJob(p, aj);
        }
      }
      imageGenPendingJobs = imageGenPendingJobs.filter((p) => {
        if (p.recovering) {
          if (p.jobId) return Date.now() - (p.startedAt || 0) < RECENT_GEN_RECOVER_MS;
          return Date.now() - (p.startedAt || 0) < 30 * 60 * 1000;
        }
        if (!p.jobId) {
          return Date.now() - (p.startedAt || 0) < 15 * 60 * 1000;
        }
        const aj = apiById.get(p.jobId);
        if (!aj) {
          return Date.now() - (p.startedAt || 0) < RECENT_GEN_RECOVER_MS;
        }
        if (aj.status === 'failed') {
          return false;
        }
        if (aj.status === 'completed') return false;
        return aj.status === 'processing';
      });
      if (imageGenPendingJobs.length !== before) {
        persistPendingGenJobs();
        changed = true;
      } else if (changed) {
        persistPendingGenJobs();
      }

      if (changed) {
        afterGenJobsResume(true);
      }

      for (const p of imageGenPendingJobs.slice()) {
        if (!p.jobId) continue;
        const age = Date.now() - (p.startedAt || 0);
        const slowPending = isSlowGenProviderModel(p.model);
        const needsServerRecover = (p.recovering || slowPending) && age >= SERVER_RECOVER_AFTER_MS;
        if (needsServerRecover) {
          if (p.recovering) {
            p.recoverNote = formatPendingRecoveryNote(p, p.recoverNote || '后台恢复中');
          } else if (slowPending) {
            p.pendingNote = formatPendingRecoveryNote(p, p.pendingNote || '后台生成中');
          }
          persistPendingGenJobs();
          if (!p._serverRecoverAt || Date.now() - p._serverRecoverAt > 5 * 60 * 1000) {
            p._serverRecoverAt = Date.now();
            if (await tryRecoverPendingJobDirect(p)) {
              changed = true;
              continue;
            }
          }
        }
        if (!p.recovering && !slowPending) continue;
        if (age < pendingRecoveryGiveUpMs(p)) continue;
        try {
          const retry = await window.PromptHubApi.getGenerationJob(p.jobId);
          if (retry.ok && retry.data.status === 'completed' && retry.data.imageUrl) {
            if (await resolvePendingFromApiJob(p, {
              id: p.jobId,
              status: 'completed',
              imageUrl: retry.data.imageUrl,
              extraImageUrls: retry.data.extraImageUrls,
              prompt: p.prompt,
              model: p.model
            }, { silent: true })) {
              changed = true;
              continue;
            }
            if (await tryServerRecoverPending(p)) {
              changed = true;
              continue;
            }
          }
          if (retry.ok && retry.data.status === 'processing') {
            if (!activePollJobIds.has(p.jobId)) {
              void pollGenerationJobUntilDone(p.jobId, p.id, pendingJobToPollCtx(p));
            }
            continue;
          }
          if (await recoverSingleJobFromApi({ id: p.jobId, prompt: p.prompt, model: p.model }, { silentToast: true, force: true })) {
            changed = true;
            continue;
          }
          if (await tryServerRecoverPending(p)) {
            changed = true;
            continue;
          }
        } catch (e) { /* ignore */ }
        if (age >= RECENT_GEN_RECOVER_MS) {
          abandonUnrecoverablePendingJob(
            p,
            '上游临时链接约 2 小时有效，该任务已过期，无法恢复（可点 × 关闭占位）',
            { toast: true }
          );
          if (p.jobId) window.recordGenerationJobDeletion?.(p.jobId);
          changed = true;
        }
      }
      if (changed) {
        persistPendingGenJobs();
        renderImageGenFeed({ preserveScroll: true, force: true });
      }

      return changed;
    })().finally(() => {
      resumeGenJobsInflight = null;
    });

    return resumeGenJobsInflight;
  }

  function highlightCreationCard(id) {
    document.querySelectorAll('#creationsGrid .creation-post-card').forEach(el => {
      el.classList.toggle('selected', el.dataset.creationId === id);
    });
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
      <p class="panel-hint">生成记录保留 1～3 天。发布到社区请打开卡片库对应卡片并开启「发布到提示词社区」</p>`;
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
    if (!isMobileViewport()) {
      relayoutFeedGridAfterSidePanel('creationsGrid');
      requestAnimationFrame(() => relayoutFeedGridAfterSidePanel('creationsGrid'));
    }
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
    const msg = '确定删除该生成记录？无回收站，删除后不可恢复。';
    const doDel = () => deleteCreation(id);
    if (typeof window.customConfirm === 'function') {
      window.customConfirm(msg, doDel, null, { danger: true, confirmLabel: '删除' });
    } else if (confirm(msg)) doDel();
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

  function deleteCreation(id) {
    if (creationsSideId === id) closeCreationsSidePanel();
    if (imageGenPreviewId === id) closeImageGenPreview();
    const removed = creations.find(c => c.id === id);
    if (removed?.communityPostId) {
      const post = findPost(removed.communityPostId);
      if (post?.sourceCreationId === id && !post?.sourceCardId) {
        performCommunityPostRemoval(removed.communityPostId, { silent: true });
      }
    }
    recordCreationDeletion(id, removed?.jobId);
    const baseJobId = normalizeGenJobBaseId(removed?.jobId);
    if (baseJobId) {
      window.recordGenerationJobDeletion?.(baseJobId);
      if (removed?.jobId && String(removed.jobId) !== baseJobId) {
        window.recordGenerationJobDeletion?.(removed.jobId);
      }
      const whCards = (window.__promptHubCards || []).filter((c) => {
        if (!c?.genJobId) return false;
        const cBase = normalizeGenJobBaseId(c.genJobId);
        return c.genJobId === removed.jobId || cBase === baseJobId;
      });
      for (const wh of whCards) {
        if (typeof window.deleteCardPermanently === 'function') {
          void window.deleteCardPermanently(wh.id, false, { skipRender: true, silent: true });
        }
      }
    }
    creations = creations.filter(c => c.id !== id);
    persistCreations();
    renderCreations();
    if (document.getElementById('pageImageGen')?.classList.contains('active')) {
      renderImageGenFeed();
    }
    toast('已删除');
  }

  function remixCreation(id) {
    const c = creations.find(x => x.id === id);
    if (!c) return;
    if (typeof switchAppPage === 'function') switchAppPage('imagegen');
    imageGenFeedTab = 'warehouse';
    document.querySelectorAll('[data-feed-tab]').forEach(b => {
      b.classList.toggle('active', b.dataset.feedTab === 'warehouse');
    });
    updateImageGenFeedHint();
    applyHistoryToForm(c);
  }

  let imageGenFormActivated = false;

  function initImageGenForm() {
    resetImageGenSubmitState();
    if (imageGenFormActivated) {
      syncImageGenModelParamsUI();
      updateImageGenSaveTargetSelects();
      syncImageGenGenPublicUI();
      updateImageGenFeedHint();
      updateImageGenCostHint();
      if (!feedHasRenderedContent('imageGenFeed', '.imagegen-feed-card')) {
        renderImageGenFeed();
      } else {
        scheduleImageGenFeedLayout();
        renderImageGenMobileResult();
      }
      return;
    }
    imageGenFormActivated = true;
    const cached = loadCachedImageGenModels();
    if (cached?.length) {
      applyImageGenModelCatalog(cached, { forceRender: true, source: 'cache' });
    } else {
      warmImageGenModelCatalog();
      applyImageGenModelCatalog(IMAGE_GEN_MODEL_FALLBACK, { forceRender: true, source: 'fallback' });
    }
    void prefetchImageGenModelCatalog().then(() => {
      syncImageGenModelToResolution();
      updateImageGenResolutionSelect();
      updateImageGenPricingUI();
    });
    const draft = loadJson(LS_IMAGEGEN, null);
    if (draft) {
      const promptEl = document.getElementById('imageGenPrompt');
      if (promptEl && draft.prompt) promptEl.value = draft.prompt;
      if (draft.refImages?.length) setImageGenRefs(draft.refImages);
      else if (draft.refImage) setImageGenRefs([draft.refImage]);
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
      if (countEl) countEl.value = '1';
      if (draft.mjMode === 'blend' || draft.mjMode === 'imagine') {
        imageGenMjMode = draft.mjMode;
      }
      const saveAllEl = document.getElementById('imageGenMjSaveAllTiles');
      if (saveAllEl && draft.mjSaveAllTiles) saveAllEl.checked = true;
      const speedVal = draft.mjSpeed;
      if (speedVal === 'draft' || speedVal === 'hd' || speedVal === '') {
        const speedInput = document.querySelector(`input[name="imageGenMjSpeed"][value="${speedVal}"]`);
        if (speedInput) speedInput.checked = true;
      }
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
    if (!feedHasRenderedContent('imageGenFeed', '.imagegen-feed-card')) {
      renderImageGenFeed();
    } else {
      scheduleImageGenFeedLayout();
    }
    window.PointsSystem?.updateCreditsUI?.();
    const mobileInit = isMobileViewport();
    if (window.SupabaseSync?.isLoggedIn?.()) {
      scheduleGenJobsSync(mobileInit ? 2500 : 1200);
      setTimeout(() => void quietSyncImageGenFromCloud(), mobileInit ? 600 : 1500);
    }
  }

  /** 静默拉云端 + 恢复生图任务，仅用侧栏 authCloudStatus，不弹 Toast */
  async function quietSyncImageGenFromCloud() {
    const doPull = async () => {
      if (typeof window.runDeferredCloudPull === 'function') {
        await window.runDeferredCloudPull({ silent: true, light: true });
      }
      await resumePendingGenerationJobs();
      renderImageGenFeed({ preserveScroll: true });
      renderImageGenMobileResult();
    };
    try {
      await resumePendingGenerationJobs();
      renderImageGenFeed({ preserveScroll: true });
      renderImageGenMobileResult();
      void (async () => {
        try {
          if (typeof window.waitForCloudSyncIdle === 'function') {
            await window.waitForCloudSyncIdle(8000);
          }
          await doPull();
        } catch (e) {
          console.warn('[imagegen] quiet cloud sync', e);
        }
      })();
    } catch (e) {
      console.warn('[imagegen] quiet cloud sync', e);
    }
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
    return normalizeImageGenModelId(raw || 'gpt-image-2');
  }

  let imageGenModelCatalog = [];
  let imageGenModelCatalogReady = false;
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
    { key: 'gim2', label: 'G-im2' },
    { key: 'banana', label: '香蕉' },
    { key: 'jimeng', label: '即梦' },
    { key: 'midjourney', label: 'MJ' }
  ];

  const IMAGE_GEN_MODEL_FALLBACK = [
    { id: 'gpt-image-2', label: 'GPT Image 2', provider: 'grsai', uiFamily: 'gim2', sortOrder: 2, selectable: true, status: 'active', refundOnViolation: true, aspectRatios: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'] },
    { id: 'gpt-image-2-vip', label: 'GPT Image 2 VIP', provider: 'grsai', uiFamily: 'gim2', sortOrder: 1, selectable: true, status: 'active', refundOnViolation: true, aspectRatios: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'] },
    { id: 'nano-banana-pro', label: 'Nano Banana Pro', provider: 'grsai', uiFamily: 'banana', sortOrder: 3, selectable: true, status: 'active', refundOnViolation: true },
    { id: 'nano-banana-2', label: 'Nano Banana 2', provider: 'grsai', uiFamily: 'banana', sortOrder: 4, selectable: true, status: 'active', refundOnViolation: true },
    { id: 'nano-banana-fast', label: 'Nano Banana Fast', provider: 'grsai', uiFamily: 'banana', sortOrder: 6, selectable: true, status: 'active', refundOnViolation: true },
    { id: 'apimart-gpt-image-2', label: 'GPT Image 2 · 备用', provider: 'apimart', uiFamily: 'gim2', sortOrder: 103, selectable: true, status: 'active', refundOnViolation: true, aspectRatios: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'], resolutions: ['1k', '2k', '4k'] },
    { id: 'apimart-gpt-image-2-official-budget', label: 'GPT Image 2 · 特价', provider: 'apimart', uiFamily: 'gim2', sortOrder: 100, selectable: true, status: 'active', refundOnViolation: true, fixedQualityLow: true, pricingByResolution: true, resolutions: ['1k', '2k', '4k'], aspectRatios: ['16:9', '9:16', '4:3', '3:4'] },
    { id: 'ithink-gpt-image-2-slow', label: 'GPT Image 2 · 经济', provider: 'ithink', uiFamily: 'gim2', sortOrder: 102, selectable: true, status: 'active', refundOnViolation: true, fixedQualityLow: true, resolutions: ['1k'], aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
    { id: 'apimart-seedream-5-lite', label: 'Seedream 5 Lite · 备用', provider: 'apimart', uiFamily: 'jimeng', sortOrder: 104, selectable: true, status: 'active', refundOnViolation: true },
    { id: 'mooko-gpt-image-2-pro', label: 'GPT Image 2 Pro · 慢速', provider: 'mooko', uiFamily: 'gim2', sortOrder: 101, selectable: true, status: 'active', refundOnViolation: true, resolutions: ['2k', '4k'], aspectRatios: ['auto', '1:1', '16:9', '9:16', '4:3', '3:4'] },
    { id: 'apimart-mj-v61', label: 'imagine-v6.1', provider: 'apimart', uiFamily: 'midjourney', sortOrder: 110, selectable: true, status: 'active', refundOnViolation: true, resolutions: ['1k'], aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] },
    { id: 'apimart-mj-v81', label: 'imagine-v8.1', provider: 'apimart', uiFamily: 'midjourney', sortOrder: 111, selectable: true, status: 'active', refundOnViolation: true, resolutions: ['1k'], aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] },
    { id: 'apimart-mj-v7', label: 'imagine-v7', provider: 'apimart', uiFamily: 'midjourney', sortOrder: 112, selectable: true, status: 'active', refundOnViolation: true, resolutions: ['1k'], aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] },
    { id: 'apimart-mj-niji7', label: 'imagine-niji7', provider: 'apimart', uiFamily: 'midjourney', sortOrder: 113, selectable: true, status: 'active', refundOnViolation: true, resolutions: ['1k'], aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] },
    { id: 'apimart-mj-niji6', label: 'imagine-niji6', provider: 'apimart', uiFamily: 'midjourney', sortOrder: 114, selectable: true, status: 'active', refundOnViolation: true, resolutions: ['1k'], aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] },
    { id: 'apimart-mj-v52', label: 'imagine-v5.2', provider: 'apimart', uiFamily: 'midjourney', sortOrder: 115, selectable: true, status: 'active', refundOnViolation: true, resolutions: ['1k'], aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] }
  ];

  function loadCachedImageGenModels() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_IMAGEGEN_MODELS) || 'null');
      if (raw?.models?.length && raw.ts > Date.now() - 24 * 3600 * 1000) return raw.models;
    } catch (e) { /* ignore */ }
    return null;
  }

  function persistCachedImageGenModels(models) {
    try {
      localStorage.setItem(LS_IMAGEGEN_MODELS, JSON.stringify({ ts: Date.now(), models }));
    } catch (e) { /* ignore */ }
  }

  function normalizeImageGenModelEntry(m) {
    if (!m?.id) return null;
    const catalogLabel = m.catalogLabel || m.label || m.id;
    const label = String(m.displayLabel || m.label || catalogLabel).trim() || catalogLabel;
    return { ...m, label, catalogLabel };
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
    imageGenModelCatalog = models.map(normalizeImageGenModelEntry).filter(Boolean);
    window.__IMAGE_GEN_MODELS__ = imageGenModelCatalog;
    if (source === 'api' || source === 'cache') {
      persistCachedImageGenModels(imageGenModelCatalog);
    }
    imageGenModelCatalogReady = true;
    window.__IMAGE_GEN_CATALOG_READY__ = true;
    const shouldRender = opts.renderUi !== false && (opts.forceRender || isImageGenPageVisible());
    if (shouldRender) {
      setImageGenModelSelectLoading(false);
      renderImageGenModelSelect();
      syncImageGenModelHint();
      updateImageGenResolutionSelect();
      updateImageGenCostHint();
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

  async function fetchImageGenModelCatalogFromNetwork() {
    if (!window.PromptHubApi?.getGenerationModels) return false;
    try {
      const r = await window.PromptHubApi.getGenerationModels();
      if (r?.ok && Array.isArray(r.data?.models) && r.data.models.length) {
        applyImageGenModelCatalog(r.data.models, {
          forceRender: isImageGenPageVisible(),
          source: 'api'
        });
        return true;
      }
    } catch (e) {
      console.warn('[imagegen] load models failed', e);
    }
    return false;
  }

  function prefetchImageGenModelCatalog() {
    if (imageGenModelCatalogFetchPromise) return imageGenModelCatalogFetchPromise;
    imageGenModelCatalogFetchPromise = fetchImageGenModelCatalogFromNetwork().finally(() => {
      imageGenModelCatalogFetchPromise = null;
    });
    return imageGenModelCatalogFetchPromise;
  }

  function scheduleDeferredImageGenModelCatalogRefresh() {
    clearTimeout(imageGenModelCatalogDeferredTimer);
    const runLater = () => prefetchImageGenModelCatalog();
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(runLater, { timeout: 4000 });
    } else {
      imageGenModelCatalogDeferredTimer = setTimeout(runLater, 1500);
    }
  }

  function normalizeImageGenModelId(modelId) {
    const id = String(modelId || '')
      .trim()
      .toLowerCase();
    if (!id) return 'gpt-image-2';
    if (id === 'quanneng2') return 'gpt-image-2';
    if (id === 'jimeng') return 'nano-banana-pro';
    return id;
  }

  function imageGenModelLabel(modelId) {
    const id = normalizeImageGenModelId(modelId);
    const hit = imageGenModelCatalog.find((m) => m.id === id);
    if (hit) return imageGenModelDisplayName(hit);
    return id === 'gpt-image-2' ? 'GPT Image 2' : id;
  }

  async function refreshImageGenModelCatalog(opts = {}) {
    warmImageGenModelCatalog();
    if (opts.force !== true && !isImageGenPageVisible()) {
      scheduleDeferredImageGenModelCatalogRefresh();
      return;
    }
    return prefetchImageGenModelCatalog();
  }

  function imageGenModelUiFamily(m) {
    if (m?.uiFamily === 'banana' || m?.uiFamily === 'gim2' || m?.uiFamily === 'jimeng' || m?.uiFamily === 'midjourney') return m.uiFamily;
    const id = String(m?.id || '').toLowerCase();
    if (id.startsWith('apimart-mj-')) return 'midjourney';
    if (id.includes('seedream') || id === 'jimeng') return 'jimeng';
    if (id.includes('nano-banana')) return 'banana';
    return 'gim2';
  }

  function isImageGenMidjourneyModel(modelId) {
    return imageGenModelUiFamily({ id: normalizeImageGenModelId(modelId) }) === 'midjourney';
  }

  function normalizeMjParentJobId(jobId) {
    return String(jobId || '').replace(/#\d+$/, '').trim();
  }

  /** APImart MJ：第 1 张常为四宫格合成图，后 4 张为单图；也可能只返回 3～4 张 */
  function parseMjImagineUrls(imageUrl, extras) {
    const all = [...new Set([imageUrl, ...(extras || [])].filter((u) => u && /^https?:\/\//i.test(String(u))))];
    if (!all.length) return { composite: null, tiles: [], primary: null };
    if (all.length >= 5) {
      return { composite: all[0], tiles: all.slice(1, 5), primary: all[1] || all[0] };
    }
    if (all.length === 4) {
      return { composite: null, tiles: all, primary: all[0] };
    }
    return { composite: all[0], tiles: all, primary: all[0] };
  }

  function resolveMjPollImages(poll) {
    const imageUrl = poll?.data?.imageUrl || '';
    const extras = getPollExtraImageUrls(poll, imageUrl);
    if (Array.isArray(poll?.data?.mjGridUrls) && poll.data.mjGridUrls.length) {
      return {
        composite: poll.data.mjCompositeUrl || null,
        tiles: poll.data.mjGridUrls.filter(Boolean),
        primary: poll.data.mjGridUrls[0] || imageUrl
      };
    }
    return parseMjImagineUrls(imageUrl, extras);
  }

  function buildMjFilmstripHtml(urls, activeIdx = 0) {
    const list = (urls || []).filter((u) => u).slice(0, 4);
    if (!list.length) return '';
    const idx = Math.max(0, Math.min(Number(activeIdx) || 0, list.length - 1));
    const main = esc(list[idx]);
    const thumbs = list
      .map(
        (u, i) =>
          `<button type="button" class="imagegen-mj-strip-thumb${i === idx ? ' active' : ''}" data-mj-strip-idx="${i}" aria-label="第 ${i + 1} 张">
            <img src="${esc(u)}" alt="" loading="lazy" decoding="async">
          </button>`
      )
      .join('');
    const prevDisabled = idx <= 0 ? ' disabled' : '';
    const nextDisabled = idx >= list.length - 1 ? ' disabled' : '';
    return `<div class="imagegen-mj-filmstrip" data-mj-strip-active="${idx}" data-mj-strip-count="${list.length}">
      <div class="imagegen-mj-filmstrip-stage">
        <button type="button" class="imagegen-mj-filmstrip-nav imagegen-mj-filmstrip-prev" data-mj-strip-nav="-1"${prevDisabled} aria-label="上一张">‹</button>
        <button type="button" class="imagegen-mj-filmstrip-main" data-mj-strip-main title="点击全屏查看">
          <img src="${main}" alt="" decoding="async">
        </button>
        <button type="button" class="imagegen-mj-filmstrip-nav imagegen-mj-filmstrip-next" data-mj-strip-nav="1"${nextDisabled} aria-label="下一张">›</button>
      </div>
      <div class="imagegen-mj-filmstrip-meta">
        <span class="imagegen-mj-filmstrip-counter">${idx + 1} / ${list.length}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-mj-strip-dl>下载当前</button>
      </div>
      <div class="imagegen-mj-filmstrip-thumbs" role="tablist" aria-label="切换单图">${thumbs}</div>
    </div>`;
  }

  function bindMjFilmstripPreview(body, urls, previewCtx) {
    const list = (urls || []).filter(Boolean).slice(0, 4);
    if (!body || !list.length) return;
    const strip = body.querySelector('.imagegen-mj-filmstrip');
    if (!strip) return;

    const renderAt = (nextIdx) => {
      const idx = Math.max(0, Math.min(nextIdx, list.length - 1));
      strip.dataset.mjStripActive = String(idx);
      const mainImg = strip.querySelector('.imagegen-mj-filmstrip-main img');
      if (mainImg) mainImg.src = list[idx];
      const counter = strip.querySelector('.imagegen-mj-filmstrip-counter');
      if (counter) counter.textContent = `${idx + 1} / ${list.length}`;
      strip.querySelectorAll('.imagegen-mj-strip-thumb').forEach((btn, i) => {
        btn.classList.toggle('active', i === idx);
      });
      const prev = strip.querySelector('.imagegen-mj-filmstrip-prev');
      const next = strip.querySelector('.imagegen-mj-filmstrip-next');
      if (prev) prev.disabled = idx <= 0;
      if (next) next.disabled = idx >= list.length - 1;
      body.dataset.previewImageUrl = list[idx];
      body.dataset.previewImageReady = '1';
    };

    strip.querySelectorAll('[data-mj-strip-nav]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = Number(btn.dataset.mjStripNav) || 0;
        const cur = Number(strip.dataset.mjStripActive) || 0;
        renderAt(cur + delta);
      });
    });
    strip.querySelectorAll('[data-mj-strip-idx]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        renderAt(Number(btn.dataset.mjStripIdx) || 0);
      });
    });
    strip.querySelector('[data-mj-strip-main]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(strip.dataset.mjStripActive) || 0;
      const src = list[idx];
      if (!src || typeof window.openLightbox !== 'function') return;
      window.openLightbox(src, {
        imageGen: true,
        feedKey: previewCtx?.feedKey || '',
        cardId: previewCtx?.cardId || ''
      });
    });
    strip.querySelector('[data-mj-strip-dl]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(strip.dataset.mjStripActive) || 0;
      const src = list[idx];
      if (!src) return;
      const a = document.createElement('a');
      a.href = src;
      a.download = `mj-${idx + 1}.png`;
      a.rel = 'noopener';
      a.target = '_blank';
      a.click();
    });
    renderAt(Number(strip.dataset.mjStripActive) || 0);
  }

  /** @deprecated 保留供旧预览路径；新预览用 buildMjFilmstripHtml */
  function buildMjGridPreviewHtml(urls) {
    return buildMjFilmstripHtml(urls, 0);
  }

  function imageGenModelsInFamily(family) {
    return [...imageGenModelCatalog]
      .sort((a, b) => imageGenModelSortKey(a) - imageGenModelSortKey(b))
      .filter((m) => imageGenModelUiFamily(m) === family);
  }

  function resolveImageGenModelFamily(preferredFamily, modelId) {
    const families = IMAGE_GEN_MODEL_FAMILIES.filter((f) => imageGenModelsInFamily(f.key).length);
    const keys = families.map((f) => f.key);
    if (preferredFamily && keys.includes(preferredFamily)) return preferredFamily;
    const fromModel = imageGenModelCatalog.find((m) => m.id === modelId);
    if (fromModel) {
      const fam = imageGenModelUiFamily(fromModel);
      if (keys.includes(fam)) return fam;
    }
    return keys.includes('gim2') ? 'gim2' : keys[0] || 'gim2';
  }

  function renderImageGenModelFamilyTabs() {
    const host = document.getElementById('imageGenModelFamilyTabs');
    if (!host) return;
    host.innerHTML = '';
    const families = IMAGE_GEN_MODEL_FAMILIES.filter((f) => imageGenModelsInFamily(f.key).length);
    if (!families.length) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    imageGenModelFamily = resolveImageGenModelFamily(imageGenModelFamily);
    families.forEach((f) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'imagegen-model-family-tab' + (imageGenModelFamily === f.key ? ' active' : '');
      btn.dataset.family = f.key;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', imageGenModelFamily === f.key ? 'true' : 'false');
      btn.textContent = f.label;
      btn.addEventListener('click', () => {
        if (imageGenModelFamily === f.key) return;
        imageGenModelFamily = f.key;
        syncImageGenModelParamsUI({ family: f.key });
        renderImageGenModelSelect({ keepModel: false, family: f.key });
      });
      host.appendChild(btn);
    });
  }

  function imageGenModelSortKey(m) {
    const n = Number(m?.sortOrder);
    return Number.isFinite(n) ? n : 9999;
  }

  function renderImageGenModelSelect(opts = {}) {
    const sel = document.getElementById('imageGenModel');
    if (!sel || !imageGenModelCatalog.length) return;
    sel.disabled = false;
    sel.setAttribute('aria-busy', 'false');
    const draft = loadJson(LS_IMAGEGEN, null);
    const current = opts.modelId || sel.value || draft?.model || 'gpt-image-2';
    imageGenModelFamily = resolveImageGenModelFamily(
      opts.family ?? imageGenModelFamily ?? draft?.modelFamily,
      current
    );
    renderImageGenModelFamilyTabs();
    const list = imageGenModelsInFamily(imageGenModelFamily);
    sel.innerHTML = '';
    list.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      const name = imageGenModelDisplayName(m);
      let text = m.refundOnViolation ? name : `${name} · 违规不返还`;
      if (m.status === 'maintenance' || m.selectable === false) {
        opt.disabled = true;
        text = `${name}（维护中）`;
      }
      opt.textContent = text;
      sel.appendChild(opt);
    });
    const selectable = list.filter((m) => m.selectable !== false && m.status !== 'maintenance');
    const keepModel = opts.keepModel !== false;
    const pick =
      keepModel && [...sel.options].some((o) => o.value === current && !o.disabled)
        ? current
        : selectable[0]?.id || list[0]?.id || 'gpt-image-2';
    sel.value = pick;
    syncImageGenModelParamsUI();
    syncImageGenModelHint();
    updateImageGenResolutionSelect();
    updateImageGenCostHint();
  }

  function syncImageGenModelHint() {
    const hint = document.getElementById('imageGenModelHint');
    const sel = document.getElementById('imageGenModel');
    if (!hint || !sel) return;
    const m = imageGenModelCatalog.find((x) => x.id === sel.value);
    if (m?.status === 'maintenance' || m?.selectable === false) {
      hint.textContent = m.statusNotice || '该模型维护中，请换用其他模型';
      hint.hidden = false;
    } else if (m?.violationNotice) {
      hint.textContent = m.violationNotice;
      hint.hidden = false;
    } else {
      hint.hidden = true;
      hint.textContent = '';
    }
  }

  function normalizeImageGenResolution(res) {
    const r = String(res || '1k').toLowerCase();
    return ['1k', '2k', '4k'].includes(r) ? r : '1k';
  }

  /** 木瓜等分档模型：切分辨率时自动换到支持该档的 model id */
  function resolveImageGenModelForResolution(modelId, resolution) {
    const res = normalizeImageGenResolution(resolution);
    const id = normalizeImageGenModelId(modelId);
    const entry = imageGenModelCatalog.find((m) => m.id === id);
    if (!entry) return id;
    const supported = entry.resolutions?.length ? entry.resolutions : ['1k', '2k', '4k'];
    if (supported.includes(res)) return id;
    if (id === 'mooko-gpt-image-2-pro' && res === '1k') return 'mooko-gpt-image-2-pro';
    if (id === 'mooko-gpt-image-2') return 'mooko-gpt-image-2-pro';
    const family = imageGenModelUiFamily(entry);
    const provider = entry.provider;
    const hit = imageGenModelCatalog.find(
      (m) =>
        imageGenModelUiFamily(m) === family
        && m.provider === provider
        && (m.resolutions || []).includes(res)
        && m.selectable !== false
        && m.status !== 'maintenance'
    );
    return hit?.id || id;
  }

  function syncImageGenModelToResolution() {
    const resSel = document.getElementById('imageGenResolution');
    const modelSel = document.getElementById('imageGenModel');
    if (!resSel || !modelSel) return;
    const res = normalizeImageGenResolution(resSel.value);
    const nextModel = resolveImageGenModelForResolution(modelSel.value, res);
    if (nextModel && nextModel !== modelSel.value) {
      modelSel.value = nextModel;
      syncImageGenModelHint();
    }
  }

  function getImageGenFormMeta() {
    const rawRes = document.getElementById('imageGenResolution')?.value || '1k';
    const mjParams = getImageGenMjParams();
    return {
      model: getImageGenModel(),
      resolution: normalizeImageGenResolution(rawRes),
      quality: getImageGenQuality(),
      size: document.getElementById('imageGenSize')?.value || '1:1',
      ...(mjParams ? { mjParams } : {})
    };
  }

  function getImageGenPrimaryRef() {
    return imageGenRefImages[0] || null;
  }

  const IMAGE_GEN_SIZE_LABELS = {
    auto: '自动',
    '1:1': '正方形 1∶1',
    '16:9': '横屏 16∶9',
    '9:16': '竖屏 9∶16',
    '4:3': '横屏 4∶3',
    '3:4': '竖屏 3∶4',
    '3:2': '横屏 3∶2',
    '2:3': '竖屏 2∶3',
    '5:4': '横屏 5∶4',
    '4:5': '竖屏 4∶5',
    '21:9': '超宽 21∶9',
    '9:21': '超高 9∶21',
    '2:1': '横屏 2∶1',
    '1:2': '竖屏 1∶2',
    '3:1': '超宽 3∶1',
    '1:3': '超高 1∶3',
    '1:4': '超高 1∶4',
    '4:1': '超宽 4∶1',
    '1:8': '超高 1∶8',
    '8:1': '超宽 8∶1'
  };
  const IMAGE_GEN_SIZE_BASIC = ['1:1', '16:9', '9:16', '4:3', '3:4'];
  const IMAGE_GEN_SIZE_BANANA = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
  const IMAGE_GEN_SIZE_BANANA2_EXTRA = ['1:4', '4:1', '1:8', '8:1'];
  const IMAGE_GEN_SIZE_GIM2 = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'];
  /** 离线兜底：与 server aspectRatiosForModel 一致 */
  const IMAGE_GEN_SIZE_MJ = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
  const IMAGE_GEN_ASPECT_FALLBACK = {
    'apimart-gpt-image-2-official-budget': ['16:9', '9:16', '4:3', '3:4'],
    'mooko-gpt-image-2-pro': ['auto', '1:1', '16:9', '9:16', '4:3', '3:4'],
    'apimart-gpt-image-2': IMAGE_GEN_SIZE_BASIC,
    'ithink-gpt-image-2-slow': IMAGE_GEN_SIZE_BASIC,
    'gpt-image-2-vip': IMAGE_GEN_SIZE_GIM2,
    'gpt-image-2': IMAGE_GEN_SIZE_GIM2,
    'apimart-gpt-image-2': IMAGE_GEN_SIZE_GIM2,
    'apimart-mj-v61': IMAGE_GEN_SIZE_MJ,
    'apimart-mj-v81': IMAGE_GEN_SIZE_MJ,
    'apimart-mj-v7': IMAGE_GEN_SIZE_MJ,
    'apimart-mj-niji7': IMAGE_GEN_SIZE_MJ,
    'apimart-mj-niji6': IMAGE_GEN_SIZE_MJ,
    'apimart-mj-v52': IMAGE_GEN_SIZE_MJ
  };
  const BANANA2_EXTENDED_MODELS = new Set(['nano-banana-2', 'nano-banana-2-cl', 'nano-banana-2-4k-cl']);
  const IMAGE_GEN_SAVE_TARGET_LS = 'promptHub.imageGenSaveTarget.v1';

  function imageGenSizeOptionLabel(value) {
    return IMAGE_GEN_SIZE_LABELS[value] || String(value || '1:1');
  }

  function imageGenModelHidesQuality(modelId) {
    const id = normalizeImageGenModelId(modelId);
    if (isImageGenMidjourneyModel(id)) return true;
    const entry = imageGenModelCatalog.find((m) => m.id === id);
    return !!entry?.fixedQualityLow;
  }

  function isImageGenMjSaveAllTiles() {
    return !!document.getElementById('imageGenMjSaveAllTiles')?.checked;
  }

  function getImageGenMjSpeed() {
    const v = document.querySelector('input[name="imageGenMjSpeed"]:checked')?.value;
    return v === 'draft' || v === 'hd' ? v : '';
  }

  function persistImageGenMjPrefs() {
    const draft = loadJson(LS_IMAGEGEN, null) || {};
    saveImageGenDraft({
      ...draft,
      mjMode: imageGenMjMode,
      mjSaveAllTiles: isImageGenMjSaveAllTiles(),
      mjSpeed: getImageGenMjSpeed()
    });
  }

  function getImageGenMjMode() {
    return imageGenMjMode === 'blend' ? 'blend' : 'imagine';
  }

  function setImageGenMjMode(mode) {
    imageGenMjMode = mode === 'blend' ? 'blend' : 'imagine';
    document.querySelectorAll('[data-mj-mode]').forEach((btn) => {
      const active = btn.dataset.mjMode === imageGenMjMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    syncImageGenMjModeUI();
    persistImageGenMjPrefs();
  }

  function syncImageGenMjModeUI() {
    const blend = getImageGenMjMode() === 'blend';
    const blendHint = document.getElementById('imageGenMjBlendHint');
    const imagineFields = document.getElementById('imageGenMjImagineFields');
    if (blendHint) blendHint.classList.toggle('hidden', !blend);
    if (imagineFields) imagineFields.classList.toggle('hidden', blend);
    const submitBtn = document.getElementById('imageGenSubmit');
    if (submitBtn && !imageGenBatchRunning) {
      submitBtn.textContent = blend ? '开始混图' : (submitBtn.dataset.defaultLabel || '开始生成');
    }
  }

  function syncImageGenModelParamsUI(opts = {}) {
    const modelId = normalizeImageGenModelId(opts.modelId || getImageGenModel());
    const family = opts.family || imageGenModelFamily || imageGenModelUiFamily({ id: modelId });
    const isMj = family === 'midjourney';
    const shell = document.getElementById('imageGenSharedParams') || document.querySelector('.imagegen-shared-params');
    if (shell) {
      shell.classList.toggle('imagegen-params--mj', isMj);
      shell.dataset.modelFamily = family;
    }
    const panel = document.getElementById('imageGenMjParams');
    if (panel) {
      if (isMj) {
        panel.classList.remove('hidden');
        panel.hidden = false;
      } else {
        panel.classList.add('hidden');
        panel.hidden = true;
      }
    }
    const resParam = document.querySelector('.imagegen-param[data-param="resolution"]');
    const resLabel = document.querySelector('label[for="imageGenResolution"]');
    for (const el of [resParam, resLabel]) {
      if (el) el.hidden = isMj;
    }
    const sizeRow = document.querySelector('.imagegen-params-row--size');
    if (sizeRow) sizeRow.classList.toggle('imagegen-params-row--mj-size', isMj);
    const sizeLabel = document.querySelector('label[for="imageGenSize"]');
    if (sizeLabel) sizeLabel.textContent = isMj ? '宽高比' : '画面尺寸';
    const hideQuality = isMj || imageGenModelHidesQuality(modelId);
    const qEl = document.getElementById('imageGenQuality');
    const qLabel = document.querySelector('label[for="imageGenQuality"]');
    const qNote = document.querySelector('.imagegen-quality-note');
    for (const el of [qLabel, qEl, qNote]) {
      if (el) el.hidden = hideQuality;
    }
    if (isMj) {
      updateImageGenSizeSelect();
      syncImageGenMjModeUI();
    }
  }

  function syncImageGenMjParamsUI() {
    syncImageGenModelParamsUI();
  }

  function bindImageGenMjRange(id, valId) {
    const input = document.getElementById(id);
    const valEl = document.getElementById(valId);
    if (!input || !valEl) return;
    const sync = () => {
      valEl.textContent = input.value;
    };
    input.addEventListener('input', sync);
    sync();
  }

  function getImageGenMjParams() {
    if (!isImageGenMidjourneyModel(getImageGenModel())) return undefined;
    const stylize = Number(document.getElementById('imageGenMjStylize')?.value);
    const chaos = Number(document.getElementById('imageGenMjChaos')?.value);
    const weird = Number(document.getElementById('imageGenMjWeird')?.value);
    const iw = Number(document.getElementById('imageGenMjIw')?.value);
    const quality = document.getElementById('imageGenMjQuality')?.value || '';
    const style = document.getElementById('imageGenMjStyle')?.value || '';
    const negativePrompt = String(document.getElementById('imageGenMjNegative')?.value || '').trim();
    const out = {};
    if (Number.isFinite(stylize) && stylize !== 100) out.stylize = stylize;
    if (Number.isFinite(chaos) && chaos > 0) out.chaos = chaos;
    if (Number.isFinite(weird) && weird > 0) out.weird = weird;
    if (Number.isFinite(iw) && iw !== 1) out.iw = iw;
    if (quality) out.quality = quality;
    if (style) out.style = style;
    if (negativePrompt) out.negativePrompt = negativePrompt;
    if (document.getElementById('imageGenMjTile')?.checked) out.tile = true;
    if (document.getElementById('imageGenMjRaw')?.checked) out.raw = true;
    const speed = getImageGenMjSpeed();
    if (speed === 'draft') out.draft = true;
    if (speed === 'hd') out.hd = true;
    return Object.keys(out).length ? out : undefined;
  }

  function buildMjActionsHtml(buttons, parentJobId) {
    const parent = normalizeMjParentJobId(parentJobId);
    if (!Array.isArray(buttons) || !buttons.length || !parent) return '';
    const items = buttons
      .map((b, i) => {
        const action = esc(String(b.action || 'custom'));
        const label = esc(String(b.label || '操作'));
        const index = b.index != null ? Number(b.index) : '';
        const customId = b.customId ? esc(String(b.customId)) : '';
        return `<button type="button" class="btn btn-secondary btn-sm imagegen-mj-action-btn" data-mj-action="${action}" data-mj-parent="${esc(parent)}" data-mj-index="${index}" data-mj-custom="${customId}" data-mj-idx="${i}">${label}</button>`;
      })
      .join('');
    return `<div class="imagegen-mj-actions" role="group" aria-label="Midjourney 操作">${items}</div>`;
  }

  async function runImageGenMjAction(btn) {
    if (!btn || btn.disabled) return;
    if (!window.AuthGate?.requireAuth?.('imagegen')) return;
    const parentJobId = normalizeMjParentJobId(btn.dataset.mjParent);
    const action = btn.dataset.mjAction;
    if (!parentJobId || !action || action === 'custom') {
      toast('该操作暂不支持，请换其他按钮');
      return;
    }
    const payload = {
      parentJobId,
      action,
      index: btn.dataset.mjIndex ? Number(btn.dataset.mjIndex) : undefined,
      customId: btn.dataset.mjCustom || undefined
    };
    if (!payload.index && !payload.customId && (action === 'upscale' || action === 'variation')) {
      toast('请选择具体序号');
      return;
    }
    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '提交中…';
    try {
      const res = await window.PromptHubApi.mjAction(payload);
      if (!res.ok) {
        toast(friendlyGenErrorMessage(res.message) || '操作失败');
        return;
      }
      if (typeof res.data?.creditsRemaining === 'number') {
        window.PointsSystem?.setCreditsFromServer?.(res.data.creditsRemaining);
        window.PointsSystem?.updateCreditsUI?.();
      }
      toast('已提交，请在作品中查看进度');
      scheduleGenJobsSync(400);
      void resumePendingGenerationJobs();
    } catch (e) {
      toast('操作失败，请稍后重试');
      console.warn('[mj-action]', e);
    } finally {
      btn.disabled = false;
      btn.textContent = prevText;
    }
  }

  function syncImageGenQualityUI() {
    syncImageGenModelParamsUI();
  }

  function imageGenSizeOptionsForModel(modelId) {
    const id = normalizeImageGenModelId(modelId);
    const entry = imageGenModelCatalog.find((m) => m.id === id);
    if (Array.isArray(entry?.aspectRatios) && entry.aspectRatios.length) {
      return [...entry.aspectRatios];
    }
    if (IMAGE_GEN_ASPECT_FALLBACK[id]) {
      return [...IMAGE_GEN_ASPECT_FALLBACK[id]];
    }
    if (id === 'apimart-gpt-image-2-official-budget') {
      return ['16:9', '9:16', '4:3', '3:4'];
    }
    if (entry?.uiFamily === 'banana' || id.includes('nano-banana')) {
      const list = [...IMAGE_GEN_SIZE_BANANA];
      if (BANANA2_EXTENDED_MODELS.has(id)) list.push(...IMAGE_GEN_SIZE_BANANA2_EXTRA);
      return list;
    }
    if (id.startsWith('mooko-')) {
      return IMAGE_GEN_ASPECT_FALLBACK['mooko-gpt-image-2-pro'];
    }
    if (id.startsWith('apimart-mj-') || entry?.uiFamily === 'midjourney') {
      return IMAGE_GEN_SIZE_MJ;
    }
    if (
      id === 'gpt-image-2-vip'
      || id === 'gpt-image-2'
      || id === 'apimart-gpt-image-2'
      || entry?.provider === 'apimart'
      || entry?.uiFamily === 'gim2'
      || id.includes('gpt-image-2')
    ) {
      return IMAGE_GEN_SIZE_GIM2;
    }
    if (entry?.provider === 'ithink') return IMAGE_GEN_SIZE_BASIC;
    return IMAGE_GEN_SIZE_BASIC;
  }

  function updateImageGenSizeSelect() {
    const sel = document.getElementById('imageGenSize');
    const modelSel = document.getElementById('imageGenModel');
    if (!sel) return;
    const current = sel.value || '1:1';
    const options = imageGenSizeOptionsForModel(modelSel?.value || getImageGenModel());
    sel.innerHTML = '';
    options.forEach((value) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = imageGenSizeOptionLabel(value);
      sel.appendChild(opt);
    });
    if (options.includes(current)) sel.value = current;
    else sel.value = options.includes('16:9') ? '16:9' : options.includes('1:1') ? '1:1' : options[0];
  }

  function readImageGenSaveTargetPrefs() {
    try {
      const raw = localStorage.getItem(IMAGE_GEN_SAVE_TARGET_LS);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function writeImageGenSaveTargetPrefs(prefs) {
    try {
      localStorage.setItem(IMAGE_GEN_SAVE_TARGET_LS, JSON.stringify(prefs || {}));
    } catch (e) { /* ignore */ }
  }

  let imageGenSelectedTargetTags = [];

  function syncImageGenTagPickerValueLabel() {
    const valEl = document.getElementById('imageGenTagPickerValue');
    if (!valEl) return;
    const tags = imageGenSelectedTargetTags.filter(Boolean);
    if (!tags.length) {
      valEl.textContent = '未选择';
      valEl.classList.remove('has-tags');
      return;
    }
    valEl.classList.add('has-tags');
    valEl.textContent = tags.length <= 2 ? tags.join('、') : `${tags.slice(0, 2).join('、')} 等 ${tags.length} 个`;
  }

  function closeImageGenTagPickerPanel() {
    const panel = document.getElementById('imageGenTagPickerPanel');
    const trigger = document.getElementById('imageGenTagPickerTrigger');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function persistImageGenSaveTargetPrefs() {
    const groupSel = document.getElementById('imageGenTargetGroup');
    writeImageGenSaveTargetPrefs({
      group: groupSel?.value || '',
      tags: [...imageGenSelectedTargetTags]
    });
  }

  function toggleImageGenTargetTag(tag) {
    const name = window.normalizeCardTagName?.(tag) || String(tag || '').trim();
    if (!name || window.isSystemCardTag?.(name)) return;
    const i = imageGenSelectedTargetTags.findIndex((t) => (window.normalizeCardTagName?.(t) || t) === name);
    if (i >= 0) imageGenSelectedTargetTags.splice(i, 1);
    else imageGenSelectedTargetTags.push(name);
    syncImageGenTagPickerValueLabel();
    persistImageGenSaveTargetPrefs();
    renderImageGenTagPickerOptions();
  }

  function renderImageGenTagPickerOptions() {
    const panel = document.getElementById('imageGenTagPickerPanel');
    if (!panel) return;
    const tags = window.getUserCreatedCardTags?.() || [];
    const selected = new Set(imageGenSelectedTargetTags.map((t) => window.normalizeCardTagName?.(t) || t));
    panel.innerHTML = '';
    if (!tags.length) {
      panel.innerHTML = '<p class="imagegen-tag-picker-empty">暂无自定义标签</p>';
      return;
    }
    tags.forEach((tag) => {
      const name = window.normalizeCardTagName?.(tag) || tag;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'imagegen-tag-picker-option';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', selected.has(name) ? 'true' : 'false');
      row.dataset.tag = name;
      const check = document.createElement('span');
      check.className = 'imagegen-tag-picker-check';
      check.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'imagegen-tag-picker-label';
      label.textContent = name;
      row.append(check, label);
      row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleImageGenTargetTag(name);
      });
      panel.appendChild(row);
    });
  }

  function updateImageGenSaveTargetSelects() {
    const groupSel = document.getElementById('imageGenTargetGroup');
    const prefs = readImageGenSaveTargetPrefs();
    if (groupSel) {
      const prev = groupSel.value || prefs.group || '';
      const groups = window.getCustomGroupsList?.() || [];
      groupSel.innerHTML = '<option value="">未分类（默认）</option>';
      groups.forEach((g) => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        groupSel.appendChild(opt);
      });
      if (prev && (prev === '' || groups.includes(prev))) groupSel.value = prev;
      else groupSel.value = '';
    }
    const prefTags = Array.isArray(prefs.tags)
      ? prefs.tags
        .map((t) => window.normalizeCardTagName?.(t) || t)
        .filter((t) => t && !window.isSystemCardTag?.(t))
      : [];
    const available = new Set(
      (window.getUserCreatedCardTags?.() || []).map((t) => window.normalizeCardTagName?.(t) || t)
    );
    imageGenSelectedTargetTags = prefTags.filter((t) => available.has(t));
    renderImageGenTagPickerOptions();
    syncImageGenTagPickerValueLabel();
  }

  function getImageGenSaveTarget() {
    const group = document.getElementById('imageGenTargetGroup')?.value?.trim() || '';
    const tags = imageGenSelectedTargetTags.filter((t) => t && !window.isSystemCardTag?.(t));
    return {
      targetGroup: group || null,
      targetTags: tags
    };
  }

  function bindImageGenSaveTarget() {
    const groupSel = document.getElementById('imageGenTargetGroup');
    const picker = document.getElementById('imageGenTagPicker');
    const trigger = document.getElementById('imageGenTagPickerTrigger');
    const panel = document.getElementById('imageGenTagPickerPanel');
    if (groupSel && !groupSel.dataset.bound) {
      groupSel.dataset.bound = '1';
      groupSel.addEventListener('change', persistImageGenSaveTargetPrefs);
    }
    if (!picker || !trigger || !panel || picker.dataset.bound) return;
    picker.dataset.bound = '1';
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = panel.hidden;
      if (open) {
        renderImageGenTagPickerOptions();
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
      } else {
        closeImageGenTagPickerPanel();
      }
    });
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const row = e.target.closest('.imagegen-tag-picker-option');
        if (row?.dataset?.tag) {
          e.preventDefault();
          toggleImageGenTargetTag(row.dataset.tag);
        }
      }
    });
    document.addEventListener('click', (e) => {
      if (!picker.contains(e.target)) closeImageGenTagPickerPanel();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeImageGenTagPickerPanel();
    });
  }

  function updateImageGenResolutionSelect() {
    const sel = document.getElementById('imageGenResolution');
    const modelSel = document.getElementById('imageGenModel');
    if (!sel) return;
    const current = sel.value || '1k';
    const model = imageGenModelCatalog.find((x) => x.id === modelSel?.value);
    const resolutions = model?.resolutions?.length ? model.resolutions : ['1k', '2k', '4k'];
    sel.innerHTML = '';
    resolutions.forEach((res) => {
      const opt = document.createElement('option');
      opt.value = res;
      opt.textContent = res.toUpperCase();
      sel.appendChild(opt);
    });
    if (resolutions.includes(current)) sel.value = current;
    else sel.value = resolutions[0];
    updateImageGenSizeSelect();
  }

  function getImageGenAutoPublishDefault() {
    return window.getDefaultImageGenAutoPublish?.() !== false;
  }

  function syncImageGenAutoPublishUI() {
    const btn = document.getElementById('imageGenAutoPublishBtn');
    if (!btn) return;
    const globalOn = getImageGenAutoPublishDefault();
    const on = imageGenAutoPublishSession === null ? globalOn : imageGenAutoPublishSession;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function isImageGenAutoPublishChecked() {
    return document.getElementById('imageGenAutoPublishBtn')?.classList.contains('is-on') === true;
  }

  function bindImageGenAutoPublish() {
    const btn = document.getElementById('imageGenAutoPublishBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const on = !btn.classList.contains('is-on');
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      imageGenAutoPublishSession = on;
    });
  }

  function getImageGenAutoSaveDefault() {
    return window.getDefaultImageGenAutoSaveWarehouse?.() !== false;
  }

  function syncImageGenAutoSaveUI() {
    const btn = document.getElementById('imageGenAutoSaveBtn');
    if (!btn) return;
    const globalOn = getImageGenAutoSaveDefault();
    const on = imageGenAutoSaveSession === null ? globalOn : imageGenAutoSaveSession;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function isImageGenAutoSaveChecked() {
    return document.getElementById('imageGenAutoSaveBtn')?.classList.contains('is-on') === true;
  }

  function bindImageGenAutoSave() {
    const btn = document.getElementById('imageGenAutoSaveBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const on = !btn.classList.contains('is-on');
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      imageGenAutoSaveSession = on;
    });
  }

  function getImageGenGenPublicDefault() {
    return window.getDefaultImageGenAutoPublish?.() !== false;
  }

  function syncImageGenGenPublicFromPrompt() {
    const btn = document.getElementById('imageGenGenPublicBtn');
    if (!btn) return;
    if (imageGenGenPublicSession !== null) {
      btn.classList.toggle('is-on', imageGenGenPublicSession);
      btn.setAttribute('aria-pressed', imageGenGenPublicSession ? 'true' : 'false');
      return;
    }
    const prompt = document.getElementById('imageGenPrompt')?.value || '';
    const on = computeAutoCommunityToggle(prompt, getImageGenGenPublicDefault(), null);
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function syncImageGenGenPublicUI() {
    syncImageGenGenPublicFromPrompt();
  }

  function isImageGenGenPublicChecked() {
    const btn = document.getElementById('imageGenGenPublicBtn');
    if (!btn) return getImageGenGenPublicDefault();
    return btn.classList.contains('is-on');
  }

  function bindImageGenGenPublic() {
    const btn = document.getElementById('imageGenGenPublicBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const willOn = !btn.classList.contains('is-on');
      imageGenGenPublicSession = willOn;
      btn.classList.toggle('is-on', willOn);
      btn.setAttribute('aria-pressed', willOn ? 'true' : 'false');
    });
  }

  function restoreImageGenSubmitLabel() {
    updateImageGenCostHint();
  }

  let imageGenCostHintSeq = 0;
  let imageGenCostDebounceTimer = null;
  let imageGenBatchRunning = false;

  function getImageGenBatchCount() {
    const n = Number(document.getElementById('imageGenCount')?.value || 1);
    return Math.min(5, Math.max(1, Math.floor(n) || 1));
  }

  function roundCreditsSafe(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.round(v * 10) / 10;
  }

  function formatImageGenUnitPrice(detail, final, fmt) {
    if (window.PointsSystem?.formatImageGenUnitPrice) {
      return window.PointsSystem.formatImageGenUnitPrice(detail, final);
    }
    const unitLabel = (fmt || ((n) => String(n)))(final);
    return `${unitLabel} 积分/张`;
  }

  function syncImageGenPromoNotice(detail, final) {
    const msg = window.PointsSystem?.formatImageGenPromoNotice?.(detail, final) || '';
    ['imageGenPromoNotice', 'imageGenInspirePromoNotice'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (msg) {
        el.textContent = msg;
        el.classList.remove('hidden');
      } else {
        el.textContent = '';
        el.classList.add('hidden');
      }
    });
  }

  function applyImageGenCostDisplay(detail, final, quality, size) {
    const hint = document.getElementById('imageGenCostHint');
    const btn = document.getElementById('imageGenSubmit');
    const count = getImageGenBatchCount();
    const fmt = window.PointsSystem?.formatCredits || ((n) => String(n));
    const unitPerSheet = `${fmt(final)} 积分/张`;
    const total = roundCreditsSafe(final * count);
    const totalLabel = fmt(total);
    const submitLabel = count > 1
      ? `生成 ${count} 张 · ${totalLabel} 积分`
      : `生成图片 · ${unitPerSheet}`;
    if (btn && !btn.disabled && !imageGenBatchRunning) btn.textContent = submitLabel;
    if (!hint) return;
    const modelLabel =
      detail?.modelLabel
      || imageGenModelCatalog.find((m) => m.id === getImageGenModel())?.label
      || imageGenModelLabel(detail?.modelId || getImageGenModel());
    const sizeLabel =
      document.getElementById('imageGenSize')?.selectedOptions?.[0]?.textContent?.trim() || size;
    const qualLabel =
      { standard: '低', high: '中', ultra: '高' }[quality] || quality;
    const parts = [modelLabel, qualLabel, sizeLabel];
    if (count > 1) {
      parts.push(`${count} 张 · 共 ${totalLabel} 积分（${unitPerSheet}）`);
    } else {
      parts.push(unitPerSheet);
    }
    if (imageGenRefImages.length) {
      parts.push(`参考图 ${imageGenRefImages.length} 张`);
    }
    hint.textContent = parts.join(' · ');
    syncImageGenPromoNotice(detail, final);
  }

  function catalogHasPricingFor(modelId, resolution) {
    const m = imageGenModelCatalog.find((x) => x.id === modelId);
    if (!m) return false;
    const res = normalizeImageGenResolution(resolution);
    if (m.costByResolution?.[res] && Number.isFinite(Number(m.costByResolution[res].final))) return true;
    if (m.pricingByResolution && m.creditsByResolution?.[res] != null) return true;
    if (Number.isFinite(Number(m.creditsFinal))) return true;
    return false;
  }

  function updateImageGenCostHint() {
    const btn = document.getElementById('imageGenSubmit');
    const hint = document.getElementById('imageGenCostHint');
    if (!imageGenModelCatalogReady) {
      if (btn && !btn.disabled && !imageGenBatchRunning) btn.textContent = '生成图片 · 加载中…';
      if (hint) hint.textContent = '模型与计价加载中…';
      return;
    }
    const { model, resolution, quality, size } = getImageGenFormMeta();
    const detail = window.PointsSystem?.getImageGenCostDetail?.(model, resolution);
    const final = detail?.final;
    if (final == null || !Number.isFinite(Number(final))) {
      if (btn && !btn.disabled && !imageGenBatchRunning) btn.textContent = '生成图片 · — 积分';
      if (hint) hint.textContent = '计价加载中…';
      return;
    }
    applyImageGenCostDisplay(detail, final, quality, size);
    window.ImageGenPromptTools?.updateBatchCostLabel?.();
    if (catalogHasPricingFor(model, resolution)) return;
    clearTimeout(imageGenCostDebounceTimer);
    imageGenCostDebounceTimer = setTimeout(() => {
      void refreshImageGenCostFromApi(model, resolution, quality, size);
    }, 800);
  }

  const GEN_COST_QUOTE_TIMEOUT_MS = window.matchMedia?.('(max-width: 900px)')?.matches ? 1200 : 1800;
  const REF_URL_RESOLVE_TIMEOUT_MS = 8000;

  async function quoteGenerationCost(resolution, quality, model, localFallback) {
    const fallback = Number(localFallback) || 10;
    if (!window.PointsSystem?.useApiForAccount?.()) {
      return { cost: fallback, fromApi: false };
    }
    try {
      const quote = await Promise.race([
        window.PromptHubApi.getGenerationCost(resolution, quality, model),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('cost quote timeout')), GEN_COST_QUOTE_TIMEOUT_MS);
        })
      ]);
      if (quote.ok && quote.data?.final != null) {
        return { cost: quote.data.final, fromApi: true };
      }
    } catch (e) {
      console.warn('[imagegen] cost quote fallback', e);
    }
    return { cost: fallback, fromApi: false };
  }

  function resetImageGenSubmitState() {
    imageGenBatchRunning = false;
    window.ImageGenPromptTools?.resetBatchState?.();
    const btn = document.getElementById('imageGenSubmit');
    if (btn) {
      btn.disabled = false;
      restoreImageGenSubmitLabel();
    }
  }

  async function refreshImageGenCostFromApi(model, resolution, quality, size) {
    if (!window.PointsSystem?.useApiForAccount?.()) return;
    const seq = ++imageGenCostHintSeq;
    try {
      const quote = await Promise.race([
        window.PromptHubApi.getGenerationCost(resolution, quality, model),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('cost quote timeout')), GEN_COST_QUOTE_TIMEOUT_MS);
        })
      ]);
      if (seq !== imageGenCostHintSeq) return;
      if (!quote.ok || quote.data?.final == null) return;

      const local = window.PointsSystem?.getImageGenCostDetail?.(model, resolution);

      const detail = Object.assign({}, local || {}, {
        base: quote.data.listPrice ?? quote.data.base ?? local?.listPrice,
        final: quote.data.final,
        listPrice: quote.data.listPrice ?? local?.listPrice,
        promoPrice: quote.data.promoPrice ?? local?.promoPrice,
        appliedDiscount: quote.data.appliedDiscount ?? local?.appliedDiscount,
        modelDiscountLabel: quote.data.appliedDiscount === 'model'
          ? (quote.data.modelDiscountLabel ?? local?.modelDiscountLabel)
          : null,
        saved:
          quote.data.listPrice != null && quote.data.listPrice > quote.data.final
            ? quote.data.listPrice - quote.data.final
            : local?.saved,
        label: quote.data.appliedDiscount === 'member'
          ? (quote.data.discountLabel || local?.label)
          : null,
        modelLabel: quote.data.modelLabel || local?.modelLabel,
        fixed: quote.data.appliedDiscount === 'fixed'
      });
      applyImageGenCostDisplay(detail, quote.data.final, quality, size);
    } catch (e) { /* 保持本地估价 */ }
  }

  function updateImageGenPricingUI() {
    if (!imageGenModelCatalogReady) return;
    updateImageGenResolutionSelect();
    syncImageGenQualityUI();
    updateImageGenCostHint();
  }

  window.updateImageGenPricingUI = updateImageGenPricingUI;
  window.syncImageGenPromoNotice = syncImageGenPromoNotice;

  function getGenHistoryItems() {
    pruneCreations();
    const seen = new Set();
    const list = [];
    for (const c of creations) {
      if (!(c.prompt || '').trim()) continue;
      const key = c.jobId ? `job:${c.jobId}` : `id:${String(c.id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(c);
    }
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return list;
  }

  function fillFormFromData({ prompt, refImage, refImages, model, resolution, quality, size, sourceId, sourceType, refAssetId }) {
    const promptEl = document.getElementById('imageGenPrompt');
    if (promptEl) promptEl.value = prompt || '';
    imageGenRefResolveAssetId = refAssetId ? String(refAssetId) : '';
    const refs = (refImages || []).filter(r => isDisplayableImage(r));
    const singleRef = refImage && isDisplayableImage(refImage) ? refImage : null;
    if (refs.length) setImageGenRefs(refs);
    else if (singleRef) setImageGenRefs([singleRef]);
    else clearImageGenRef();
    const modelEl = document.getElementById('imageGenModel');
    if (modelEl && model) modelEl.value = model;
    const resEl = document.getElementById('imageGenResolution');
    if (resEl && resolution) resEl.value = resolution;
    const qEl = document.getElementById('imageGenQuality');
    if (qEl && quality) qEl.value = quality;
    const szEl = document.getElementById('imageGenSize');
    if (szEl && size) szEl.value = size;
    updateImageGenPricingUI();
    if (sourceType === 'personal' && sourceId) imageGenActiveHistoryId = sourceId;
    syncImageGenGenPublicFromPrompt();
    renderImageGenFeed();
    toast('已填入生图框');
  }

  function fillFormPromptOnly(prompt) {
    const promptEl = document.getElementById('imageGenPrompt');
    if (promptEl) promptEl.value = prompt || '';
    syncImageGenGenPublicFromPrompt();
    toast('已填入提示词');
  }

  function fillFormRefOnly(refImage, refImages, opts) {
    imageGenRefResolveAssetId = opts?.assetId ? String(opts.assetId) : '';
    const refs = (refImages || []).filter(r => isDisplayableImage(r));
    const single = refImage && isDisplayableImage(refImage) ? refImage : null;
    if (refs.length) setImageGenRefs(refs);
    else if (single) setImageGenRefs([single]);
    else {
      toast('当前作品没有可填入的参考图');
      return;
    }
    toast('已填入参考图');
  }

  function applyHistoryToForm(item) {
    if (!item) return;
    const payload = {
      prompt: item.prompt,
      model: item.model,
      resolution: item.resolution,
      quality: item.quality,
      size: item.size,
      sourceId: item.id,
      sourceType: 'personal'
    };
    if (item.hasRefImage) {
      if (item.refImages?.length) payload.refImages = item.refImages;
      else if (item.refImage) payload.refImage = item.refImage;
    }
    fillFormFromData(payload);
  }

  function fillFromCommunityPost(post, autoLike) {
    if (!post) return;
    if (autoLike) ensureLike(post.id);
    fillFormFromData({ prompt: post.prompt });
  }

  function likeCommunityPostOnly(postId) {
    const wasNew = ensureLike(postId);
    toast(wasNew ? '已点赞' : '你已经点过赞了');
  }

  function applyImageGenPrefill() {
    const raw = sessionStorage.getItem(PREFILL_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PREFILL_KEY);
    try {
      const data = JSON.parse(raw);
      fillFormFromData({
        prompt: data.prompt,
        refImages: data.refImages,
        refImage: data.refImage,
        resolution: data.resolution
      });
    } catch (e) { /* ignore */ }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('read failed'));
      r.readAsDataURL(file);
    });
  }

  function refDataUrlByteSize(dataUrl) {
    const base64 = String(dataUrl || '').split(',')[1] || '';
    return Math.ceil((base64.length * 3) / 4);
  }

  function loadRefImageElement(src, opts = {}) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (opts.crossOrigin) img.crossOrigin = opts.crossOrigin;
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = src;
    });
  }

  async function fetchRefImageBlob(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (res.ok) return await res.blob();
    } catch (e) { /* proxy */ }
    if (window.PromptHubApi?.fetchMediaAsBlobUrl && /^https?:\/\//i.test(url)) {
      const tmp = await window.PromptHubApi.fetchMediaAsBlobUrl(url);
      if (tmp) {
        try {
          const blob = await (await fetch(tmp)).blob();
          URL.revokeObjectURL(tmp);
          return blob;
        } catch (e) {
          URL.revokeObjectURL(tmp);
        }
      }
    }
    return null;
  }

  /** 标注合成用：避免跨域图污染 canvas 导致无法导出 */
  async function resolveRefImageForEdit(ref) {
    if (!ref || typeof ref !== 'string') return '';
    if (/^data:image\//i.test(ref) || ref.startsWith('blob:')) return ref;
    const normalized = window.SupabaseSync?.normalizeImageRef?.(ref) || ref;
    if (window.SupabaseSync?.isStorageRef?.(normalized) && window.SupabaseSync?.isLoggedIn?.()) {
      const assetId = imageGenRefResolveAssetId || undefined;
      try {
        const blob = await window.SupabaseSync.downloadCardStorageBlob(normalized, assetId, {
          preferLargest: false
        });
        if (blob?.size) return URL.createObjectURL(blob);
      } catch (e) {
        console.warn('参考图本地读取失败', e);
      }
    }
    const displayUrl = await resolveRefDisplayUrl(ref);
    if (displayUrl) {
      const blob = await fetchRefImageBlob(displayUrl);
      if (blob?.size) return URL.createObjectURL(blob);
      if (/^data:image\//i.test(displayUrl) || displayUrl.startsWith('blob:')) return displayUrl;
    }
    return '';
  }

  function canvasToJpegDataUrl(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('图片压缩失败'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(blob);
      }, 'image/jpeg', quality);
    });
  }

  async function compressRefImageFromSource(source, maxSide) {
    const img = await loadRefImageElement(source);
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('图片尺寸无效');
    const side = maxSide || REF_MAX_SIDE;
    const scale = Math.min(1, side / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法处理图片');
    ctx.drawImage(img, 0, 0, w, h);
    let quality = 0.88;
    let dataUrl = await canvasToJpegDataUrl(canvas, quality);
    while (refDataUrlByteSize(dataUrl) > REF_TARGET_MAX_BYTES && quality > 0.52) {
      quality -= 0.08;
      dataUrl = await canvasToJpegDataUrl(canvas, quality);
    }
    if (refDataUrlByteSize(dataUrl) > REF_TARGET_MAX_BYTES) {
      throw new Error('图片压缩后仍过大，请换一张较小的图');
    }
    return dataUrl;
  }

  async function prepareRefImageFromFile(file) {
    if (file.size > REF_INPUT_MAX_BYTES) {
      throw new Error(`单张参考图不能超过 ${Math.round(REF_INPUT_MAX_BYTES / 1024 / 1024)}MB`);
    }
    if (file.size <= REF_AUTO_COMPRESS_BYTES) {
      return { dataUrl: await readFileAsDataUrl(file), compressed: false };
    }
    const blobUrl = URL.createObjectURL(file);
    try {
      return { dataUrl: await compressRefImageFromSource(blobUrl, REF_MAX_SIDE), compressed: true };
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  async function resolveRefDisplayUrl(ref, opts) {
    if (!ref || typeof ref !== 'string') return '';
    if (/^data:image\//i.test(ref) || ref.startsWith('blob:')) return ref;
    if (/^https?:\/\//i.test(ref)) {
      if (window.SupabaseSync?.isInvalidMediaUrl?.(ref)) {
        const fixed = window.SupabaseSync?.normalizeImageRef?.(ref);
        if (fixed && fixed !== ref) return resolveRefDisplayUrl(fixed, opts);
        return '';
      }
      return ref;
    }
    const normalized = window.SupabaseSync?.normalizeImageRef?.(ref) || ref;
    const isStorageLike = window.SupabaseSync?.isStorageRef?.(normalized)
      || (normalized.startsWith('storage://') && !/^https?:/i.test(normalized));
    if (!isStorageLike) return '';
    const assetId = opts?.assetId || imageGenRefResolveAssetId || undefined;
    const cached = window.MediaPipeline?.getPreviewCached?.(normalized, assetId)
      || window.MediaPipeline?.getListCached?.(normalized, assetId)
      || window.SupabaseSync?.getCachedDisplayUrl?.(normalized, { assetId, variant: 'full' })
      || window.SupabaseSync?.getCachedDisplayUrl?.(normalized, { assetId, variant: 'grid' });
    if (cached && /^https?:\/\//i.test(cached) && !cached.startsWith('storage://')) return cached;
    try {
      if (window.MediaPipeline?.resolvePreviewUrl) {
        const url = await window.MediaPipeline.resolvePreviewUrl(normalized, { assetId, tryAllPaths: true });
        return url && /^https?:\/\//i.test(url) && !url.startsWith('storage://') ? url : '';
      }
      const url = await window.SupabaseSync.resolveDisplayUrl(normalized, {
        assetId,
        variant: 'full',
        tryAllPaths: true
      });
      return url && /^https?:\/\//i.test(url) && !url.startsWith('storage://') ? url : '';
    } catch (e) {
      console.warn('参考图展示解析失败', e);
      return '';
    }
  }

  const IMAGEGEN_REF_DROP_MIME = 'application/x-prompt-hub-image-ref';

  function parseImageGenRefDropPayload(dt) {
    if (!dt) return null;
    const raw = dt.getData(IMAGEGEN_REF_DROP_MIME);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.imageRef) return parsed;
    } catch (e) { /* ignore */ }
    return null;
  }

  function addImageGenRefFromFeed(payload) {
    const imageRef = String(payload?.imageRef || payload || '').trim();
    if (!imageRef || !isDisplayableImage(imageRef)) {
      toast('该缩略图无法作为参考图');
      return false;
    }
    if (imageGenRefImages.length >= MAX_REF_IMAGES) {
      toast(`最多 ${MAX_REF_IMAGES} 张参考图`);
      return false;
    }
    if (imageGenRefImages.some((r) => r === imageRef)) {
      toast('该图已在参考图列表中');
      return false;
    }
    imageGenRefImages.push(imageRef);
    const assetId = String(payload?.sourceCardId || '').trim();
    if (assetId && imageGenRefImages.length === 1) {
      imageGenRefResolveAssetId = assetId;
    }
    renderImageGenRefGallery();
    toast('已加入参考图');
    return true;
  }

  async function addImageGenRefFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => f.type && f.type.startsWith('image/'));
    if (!files.length) return;
    let added = 0;
    let compressedCount = 0;
    for (const f of files) {
      if (imageGenRefImages.length >= MAX_REF_IMAGES) {
        toast(`最多 ${MAX_REF_IMAGES} 张参考图`);
        break;
      }
      try {
        const { dataUrl, compressed } = await prepareRefImageFromFile(f);
        imageGenRefImages.push(dataUrl);
        added++;
        if (compressed) compressedCount++;
      } catch (e) {
        toast(e?.message || `「${f.name || '图片'}」无法添加`);
      }
    }
    if (added) {
      renderImageGenRefGallery();
      if (compressedCount && added === compressedCount) {
        toast(added > 1 ? `已添加 ${added} 张参考图（均已自动压缩）` : '大图已自动压缩，可正常用于生图');
      } else if (added > 1) {
        toast(`已添加 ${added} 张参考图${compressedCount ? `（${compressedCount} 张已压缩）` : ''}`);
      } else {
        toast('已添加参考图');
      }
    }
  }

  function removeImageGenRefAt(idx) {
    imageGenRefImages.splice(idx, 1);
    renderImageGenRefGallery();
  }

  let refAnnotatorIdx = -1;
  let refAnnotatorStrokes = [];
  let refAnnotatorDraft = null;
  let refAnnotatorColor = '#ef4444';
  let refAnnotatorTool = 'circle';
  let refAnnotatorBrushSize = 14;
  let refAnnotatorDrawing = false;
  let refAnnotatorBound = false;
  let refAnnotatorResizeObs = null;

  function refAnnotatorLineWidth(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const base = Math.min(canvas.width, canvas.height) / dpr;
    return Math.max(3, Math.round(base * 0.006));
  }

  function drawRefAnnotatorBrush(ctx, stroke) {
    const pts = stroke.points || [];
    const size = stroke.size || 14;
    if (!pts.length) return;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, size / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const mx = (prev.x + cur.x) / 2;
      const my = (prev.y + cur.y) / 2;
      if (i === 1) ctx.lineTo(cur.x, cur.y);
      else ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    ctx.stroke();
  }

  function drawRefAnnotatorCircle(ctx, stroke) {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = refAnnotatorLineWidth(ctx.canvas);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(stroke.cx, stroke.cy, stroke.rx, stroke.ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  function redrawRefAnnotatorCanvas() {
    const canvas = document.getElementById('refAnnotatorCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const all = refAnnotatorDraft ? [...refAnnotatorStrokes, refAnnotatorDraft] : refAnnotatorStrokes;
    for (const s of all) {
      if (!s) continue;
      if (s.type === 'brush') drawRefAnnotatorBrush(ctx, s);
      else drawRefAnnotatorCircle(ctx, s);
    }
  }

  function closeRefImageAnnotator() {
    const overlay = document.getElementById('refAnnotatorOverlay');
    if (overlay) overlay.hidden = true;
    refAnnotatorIdx = -1;
    refAnnotatorStrokes = [];
    refAnnotatorDraft = null;
    refAnnotatorDrawing = false;
    refAnnotatorResizeObs?.disconnect();
    refAnnotatorResizeObs = null;
  }

  function paintRefAnnotatorStrokesToCtx(ctx, strokes, scaleX, scaleY) {
    const scale = (scaleX + scaleY) / 2;
    for (const s of strokes) {
      if (!s) continue;
      if (s.type === 'brush') {
        const pts = (s.points || []).map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
        drawRefAnnotatorBrush(ctx, {
          color: s.color,
          points: pts,
          size: (s.size || 14) * scale
        });
      } else {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = Math.max(3, Math.round(Math.min(
          ctx.canvas.width,
          ctx.canvas.height
        ) * 0.006));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.ellipse(
          s.cx * scaleX,
          s.cy * scaleY,
          s.rx * scaleX,
          s.ry * scaleY,
          0,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }
    }
  }

  function bindRefImageAnnotatorOnce() {
    if (refAnnotatorBound) return;
    refAnnotatorBound = true;
    const overlay = document.getElementById('refAnnotatorOverlay');
    const canvas = document.getElementById('refAnnotatorCanvas');
    const frame = document.getElementById('refAnnotatorFrame');
    if (!overlay || !canvas || !frame) return;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeRefImageAnnotator();
    });
    document.getElementById('refAnnotatorClose')?.addEventListener('click', closeRefImageAnnotator);
    document.getElementById('refAnnotatorCancel')?.addEventListener('click', closeRefImageAnnotator);
    document.getElementById('refAnnotatorUndo')?.addEventListener('click', () => {
      refAnnotatorStrokes.pop();
      refAnnotatorDraft = null;
      redrawRefAnnotatorCanvas();
    });
    document.getElementById('refAnnotatorClear')?.addEventListener('click', () => {
      refAnnotatorStrokes = [];
      refAnnotatorDraft = null;
      redrawRefAnnotatorCanvas();
    });
    document.getElementById('refAnnotatorDone')?.addEventListener('click', () => {
      void (async () => {
        if (refAnnotatorIdx < 0) {
          closeRefImageAnnotator();
          return;
        }
        const ref = imageGenRefImages[refAnnotatorIdx];
        const canvas = document.getElementById('refAnnotatorCanvas');
        if (!canvas?.width || !canvas?.height) {
          toast('画布尚未就绪');
          closeRefImageAnnotator();
          return;
        }
        let canvasSource = '';
        let revokeAfter = false;
        try {
          canvasSource = await resolveRefImageForEdit(ref);
          if (!canvasSource) {
            toast('参考图尚未加载');
            return;
          }
          if (canvasSource.startsWith('blob:')) revokeAfter = true;
          const baseImg = await loadRefImageElement(canvasSource);
          const out = document.createElement('canvas');
          out.width = baseImg.naturalWidth || baseImg.width;
          out.height = baseImg.naturalHeight || baseImg.height;
          if (!out.width || !out.height) {
            toast('图片尺寸无效');
            return;
          }
          const ctx = out.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(baseImg, 0, 0, out.width, out.height);
          const scaleX = out.width / canvas.width;
          const scaleY = out.height / canvas.height;
          paintRefAnnotatorStrokesToCtx(ctx, refAnnotatorStrokes, scaleX, scaleY);
          const dataUrl = await canvasToJpegDataUrl(out, 0.92);
          imageGenRefImages[refAnnotatorIdx] = dataUrl;
          renderImageGenRefGallery();
          toast('标注已保存，生图时会带上标记区域');
        } catch (e) {
          console.warn('保存参考图标注失败', e);
          toast('保存标注失败');
        } finally {
          if (revokeAfter && canvasSource.startsWith('blob:')) URL.revokeObjectURL(canvasSource);
          closeRefImageAnnotator();
        }
      })();
    });
    document.querySelectorAll('#refAnnotatorColors .ref-annotator__color').forEach((btn) => {
      btn.addEventListener('click', () => {
        refAnnotatorColor = btn.getAttribute('data-color') || '#ef4444';
        document.querySelectorAll('#refAnnotatorColors .ref-annotator__color').forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });
      });
    });
    document.querySelectorAll('#refAnnotatorModes .ref-annotator__mode').forEach((btn) => {
      btn.addEventListener('click', () => {
        refAnnotatorTool = btn.getAttribute('data-tool') === 'brush' ? 'brush' : 'circle';
        document.querySelectorAll('#refAnnotatorModes .ref-annotator__mode').forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });
        const brushWrap = document.getElementById('refAnnotatorBrushSizeWrap');
        if (brushWrap) brushWrap.hidden = refAnnotatorTool !== 'brush';
        canvas.style.cursor = refAnnotatorTool === 'brush' ? 'pointer' : 'crosshair';
        refAnnotatorDraft = null;
        redrawRefAnnotatorCanvas();
      });
    });
    document.getElementById('refAnnotatorBrushSize')?.addEventListener('input', (e) => {
      refAnnotatorBrushSize = Math.max(4, Number(e.target.value) || 14);
    });

    function pointerPos(e) {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / Math.max(1, rect.width);
      const sy = canvas.height / Math.max(1, rect.height);
      return {
        x: (e.clientX - rect.left) * sx,
        y: (e.clientY - rect.top) * sy
      };
    }

    function onPointerDown(e) {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      refAnnotatorDrawing = true;
      const p = pointerPos(e);
      if (refAnnotatorTool === 'brush') {
        const size = refAnnotatorBrushSize * (window.devicePixelRatio || 1);
        refAnnotatorDraft = { type: 'brush', color: refAnnotatorColor, points: [p], size };
      } else {
        refAnnotatorDraft = {
          type: 'circle',
          color: refAnnotatorColor,
          cx: p.x,
          cy: p.y,
          rx: 1,
          ry: 1,
          x0: p.x,
          y0: p.y
        };
      }
      canvas.setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e) {
      if (!refAnnotatorDrawing || !refAnnotatorDraft) return;
      e.preventDefault();
      const p = pointerPos(e);
      const d = refAnnotatorDraft;
      if (d.type === 'brush') {
        const last = d.points[d.points.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 1.5) {
          d.points.push(p);
        }
      } else {
        d.cx = (p.x + d.x0) / 2;
        d.cy = (p.y + d.y0) / 2;
        d.rx = Math.max(4, Math.abs(p.x - d.x0) / 2);
        d.ry = Math.max(4, Math.abs(p.y - d.y0) / 2);
      }
      redrawRefAnnotatorCanvas();
    }

    function onPointerUp(e) {
      if (!refAnnotatorDrawing || !refAnnotatorDraft) return;
      refAnnotatorDrawing = false;
      const d = refAnnotatorDraft;
      if (d.type === 'brush') {
        if (d.points.length >= 1) refAnnotatorStrokes.push({ ...d, points: d.points.slice() });
      } else if (d.rx > 6 || d.ry > 6) {
        refAnnotatorStrokes.push({ ...d });
      }
      refAnnotatorDraft = null;
      redrawRefAnnotatorCanvas();
      try { canvas.releasePointerCapture?.(e.pointerId); } catch (err) { /* ignore */ }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
  }

  function layoutRefAnnotatorCanvas() {
    const img = document.getElementById('refAnnotatorImg');
    const canvas = document.getElementById('refAnnotatorCanvas');
    if (!img || !canvas || !img.naturalWidth) return;
    const rect = img.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    redrawRefAnnotatorCanvas();
  }

  async function openRefImageAnnotator(idx) {
    bindRefImageAnnotatorOnce();
    const ref = imageGenRefImages[idx];
    if (!ref) return;
    const url = await resolveRefDisplayUrl(ref);
    if (!url) {
      toast('参考图尚未加载完成');
      return;
    }
    const overlay = document.getElementById('refAnnotatorOverlay');
    const img = document.getElementById('refAnnotatorImg');
    const frame = document.getElementById('refAnnotatorFrame');
    if (!overlay || !img || !frame) return;
    refAnnotatorIdx = idx;
    refAnnotatorStrokes = [];
    refAnnotatorDraft = null;
    refAnnotatorTool = 'circle';
    document.querySelectorAll('#refAnnotatorModes .ref-annotator__mode').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-tool') === 'circle');
    });
    const brushWrap = document.getElementById('refAnnotatorBrushSizeWrap');
    if (brushWrap) brushWrap.hidden = true;
    overlay.hidden = false;
    const relayout = () => requestAnimationFrame(() => layoutRefAnnotatorCanvas());
    img.onload = relayout;
    img.onerror = () => toast('参考图加载失败，请换一张或重新上传');
    if (/^https?:\/\//i.test(url)) img.crossOrigin = 'anonymous';
    else img.removeAttribute('crossorigin');
    img.src = url;
    if (img.complete && img.naturalWidth) relayout();
    refAnnotatorResizeObs?.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      refAnnotatorResizeObs = new ResizeObserver(relayout);
      refAnnotatorResizeObs.observe(frame);
    }
  }

  function renderImageGenRefGallery() {
    const gallery = document.getElementById('imageGenRefGallery');
    const box = document.getElementById('imageGenRefBox');
    if (!gallery || !box) return;
    if (!imageGenRefImages.length) {
      gallery.hidden = true;
      gallery.innerHTML = '';
      box.classList.remove('has-refs');
      window.ImageGenPromptTools?.updateRefToolState?.();
      return;
    }
    gallery.hidden = false;
    box.classList.add('has-refs');
    gallery.innerHTML = imageGenRefImages.map((src, i) => `
      <div class="imagegen-ref-thumb">
        <button type="button" class="imagegen-ref-preview-btn" data-ref-idx="${i}" title="点击标注 / 放大">
          <img src="${REF_THUMB_PLACEHOLDER}" data-ref-idx="${i}" alt="参考图 ${i + 1}">
        </button>
        <button type="button" class="imagegen-ref-rm" data-ref-idx="${i}" aria-label="移除">×</button>
      </div>
    `).join('');
    imageGenRefImages.forEach((src, i) => {
      void resolveRefDisplayUrl(src).then((url) => {
        const img = gallery.querySelector(`img[data-ref-idx="${i}"]`);
        if (!img || imageGenRefImages[i] !== src) return;
        if (url) img.src = url;
        else {
          img.alt = '参考图加载失败';
          img.classList.add('imagegen-ref-thumb--failed');
        }
      });
    });
    gallery.querySelectorAll('.imagegen-ref-preview-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = Number(btn.dataset.refIdx);
        if (!Number.isFinite(idx) || !imageGenRefImages[idx]) return;
        void openRefImageAnnotator(idx);
      });
    });
    gallery.querySelectorAll('.imagegen-ref-rm').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        removeImageGenRefAt(Number(btn.dataset.refIdx));
      });
    });
    updateImageGenCostHint();
    window.ImageGenPromptTools?.updateRefToolState?.();
  }

  function setImageGenRefs(urls) {
    if (typeof urls === 'string' && urls) {
      imageGenRefImages = [urls];
    } else {
      imageGenRefImages = Array.isArray(urls) ? urls.filter(Boolean).slice(0, MAX_REF_IMAGES) : [];
    }
    renderImageGenRefGallery();
  }

  function clearImageGenRef() {
    imageGenRefImages = [];
    imageGenRefResolveAssetId = '';
    renderImageGenRefGallery();
  }

  function bindImageGenPromptTools() {
    const pasteBtn = document.getElementById('imageGenPromptPaste');
    const clearBtn = document.getElementById('imageGenPromptClear');
    const promptEl = document.getElementById('imageGenPrompt');
    if (!pasteBtn || !clearBtn || !promptEl) return;
    if (pasteBtn.dataset.bound === '1') return;
    pasteBtn.dataset.bound = '1';
    clearBtn.dataset.bound = '1';

    pasteBtn.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard?.readText) {
          toast('当前浏览器不支持剪贴板粘贴');
          return;
        }
        const text = await navigator.clipboard.readText();
        if (!text?.trim()) {
          toast('剪贴板为空');
          return;
        }
        promptEl.value = text.trim();
        promptEl.dispatchEvent(new Event('input', { bubbles: true }));
        promptEl.focus();
      } catch (e) {
        toast('无法读取剪贴板，请检查浏览器权限');
      }
    });

    clearBtn.addEventListener('click', () => {
      if (!promptEl.value.trim()) return;
      promptEl.value = '';
      promptEl.dispatchEvent(new Event('input', { bubbles: true }));
      promptEl.focus();
    });
  }

  function bindImageGenUpload() {
    const drop = document.getElementById('imageGenRefDrop');
    const box = document.getElementById('imageGenRefBox');
    const input = document.getElementById('imageGenRefInput');
    if (!drop || !input || !box) return;
    if (drop.dataset.bound === '1') return;
    drop.dataset.bound = '1';

    const bindDragZone = (el) => {
      ['dragenter', 'dragover'].forEach(ev => {
        el.addEventListener(ev, e => {
          if (!document.getElementById('pageImageGen')?.classList.contains('active')) return;
          e.preventDefault();
          e.stopPropagation();
          box.classList.add('drag-over');
        });
      });
      el.addEventListener('dragleave', e => {
        if (!box.contains(e.relatedTarget)) box.classList.remove('drag-over');
      });
      el.addEventListener('drop', e => {
        if (!document.getElementById('pageImageGen')?.classList.contains('active')) return;
        e.preventDefault();
        e.stopPropagation();
        box.classList.remove('drag-over');
        const feedRef = parseImageGenRefDropPayload(e.dataTransfer);
        if (feedRef) {
          addImageGenRefFromFeed(feedRef);
          return;
        }
        if (e.dataTransfer?.files?.length) addImageGenRefFiles(e.dataTransfer.files);
      });
    };

    drop.addEventListener('click', e => {
      if (e.target.closest('.imagegen-ref-rm') || e.target.closest('.imagegen-ref-preview-btn')) return;
      input.click();
    });
    input.addEventListener('change', () => {
      if (input.files?.length) addImageGenRefFiles(input.files);
      input.value = '';
    });
    bindDragZone(drop);
    bindDragZone(box);

    if (!document.body.dataset.imageGenPasteBound) {
      document.body.dataset.imageGenPasteBound = '1';
      document.addEventListener('paste', e => {
        if (!document.getElementById('pageImageGen')?.classList.contains('active')) return;
        const items = e.clipboardData?.items;
        if (!items) return;
        const files = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
        if (files.length) {
          e.preventDefault();
          addImageGenRefFiles(files);
        }
      });
    }
  }

  function isUsableGenRefUrl(url) {
    if (window.MediaPipeline?.isUsableGenRefUrl) return window.MediaPipeline.isUsableGenRefUrl(url);
    if (!url || typeof url !== 'string') return false;
    if (/^https?:\/\//i.test(url)) return true;
    if (window.SupabaseSync?.isDataUrl?.(url)) return true;
    if (window.SupabaseSync?.isStorageRef?.(url) || url.startsWith('storage://')) return true;
    return false;
  }

  async function resolveRefUrlsFromList(sources) {
    const list = Array.isArray(sources) ? sources.filter(Boolean) : [];
    if (!list.length) return [];
    const urls = [];
    for (let i = 0; i < list.length; i++) {
      const src = list[i];
      try {
        let apiUrl = null;
        const resolveOne = (async () => {
          if (/^https?:\/\//i.test(src)) {
            if (window.SupabaseSync?.isInvalidMediaUrl?.(src) && window.SupabaseSync?.normalizeImageRef) {
              const fixed = window.SupabaseSync.normalizeImageRef(src);
              if (fixed && fixed !== src) {
                const signed = await window.SupabaseSync.resolveDisplayUrl(fixed, {
                  variant: 'full',
                  preferFull: true,
                  bypassSignBudget: true
                });
                if (signed && /^https?:\/\//i.test(signed)) return signed;
              }
            }
            return src;
          }
          if (window.SupabaseSync?.isStorageRef?.(src) || String(src).startsWith('storage://')) {
            return window.SupabaseSync?.normalizeImageRef?.(src) || src;
          }
          if (window.SupabaseSync?.isDataUrl?.(src) || String(src).startsWith('blob:')) {
            if (window.SupabaseSync?.isLoggedIn?.() && window.SupabaseSync?.uploadImageGenRef) {
              try {
                const stored = await window.SupabaseSync.uploadImageGenRef(genId('ref'), src);
                if (stored) return stored;
              } catch (uploadErr) {
                console.warn('参考图上传失败，改由服务端处理', uploadErr);
              }
            }
            if (window.SupabaseSync?.isDataUrl?.(src)) return src;
            if (String(src).startsWith('blob:')) {
              return compressRefImageFromSource(src, REF_MAX_SIDE);
            }
          }
          return window.SupabaseSync?.isDataUrl?.(src) ? src : null;
        })();
        apiUrl = await Promise.race([
          resolveOne,
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('ref resolve timeout')), REF_URL_RESOLVE_TIMEOUT_MS);
          })
        ]);
        if (isUsableGenRefUrl(apiUrl)) {
          urls.push(apiUrl);
        }
      } catch (e) {
        console.warn('参考图解析失败', e);
        if (isUsableGenRefUrl(src)) urls.push(src);
        else if (window.SupabaseSync?.isDataUrl?.(src)) urls.push(src);
      }
    }
    return urls;
  }

  async function resolveRefUrlsForApi() {
    return resolveRefUrlsFromList(imageGenRefImages);
  }

  function removePendingJob(pendingId) {
    imageGenPendingJobs = imageGenPendingJobs.filter(j => j.id !== pendingId);
    persistPendingGenJobs();
  }

  function getPollExtraImageUrls(poll, primaryUrl) {
    const main = primaryUrl || poll?.data?.imageUrl;
    if (!main) return [];
    const raw = Array.isArray(poll?.data?.extraImageUrls) ? poll.data.extraImageUrls : [];
    return raw.filter((u) => u && u !== main);
  }

  async function syncMissingBonusImagesForJob(recoverJob, ctx = {}, opts = {}) {
    if (!recoverJob?.id || !recoverJob.imageUrl) return false;
    if (recoverJob.isMidjourney || isImageGenMidjourneyModel(recoverJob.model || ctx.model)) return false;
    const extras = Array.isArray(recoverJob.extraImageUrls)
      ? recoverJob.extraImageUrls.filter((u) => u && u !== recoverJob.imageUrl)
      : [];
    if (!extras.length) return false;
    if (allGenCreationSlotsSaved(recoverJob.id, extras.length)) return false;
    await ensureGenJobCreationsFromPoll(
      { data: { status: 'completed', imageUrl: recoverJob.imageUrl, extraImageUrls: extras } },
      {
        prompt: recoverJob.prompt || ctx.prompt || '',
        model: recoverJob.model || ctx.model || 'gpt-image-2',
        resolution: recoverJob.resolution || ctx.resolution || '1k',
        quality: recoverJob.quality || ctx.quality || 'standard',
        size: recoverJob.size || ctx.size || '1:1',
        cost: recoverJob.creditsCharged || ctx.cost || 0,
        jobId: recoverJob.id,
        silentToast: opts.silentToast !== false,
        isRecovery: true
      },
      null
    );
    if (opts.silentToast === false) {
      toast(`已补全同任务附赠图 ${extras.length} 张（不重复扣积分）`);
    }
    return true;
  }

  function isGenCreationSlotSaved(baseJobId, slotIndex) {
    if (!baseJobId) return false;
    const slotId = slotIndex <= 1 ? String(baseJobId) : `${baseJobId}#${slotIndex}`;
    return hasWarehouseCardForJob(slotId);
  }

  function allGenCreationSlotsSaved(baseJobId, extraCount) {
    if (!baseJobId || !isGenCreationSlotSaved(baseJobId, 1)) return false;
    for (let i = 0; i < extraCount; i += 1) {
      if (!isGenCreationSlotSaved(baseJobId, i + 2)) return false;
    }
    return true;
  }

  /** Midjourney 入库：可选四张各存一张卡片 */
  async function saveMjToWarehouse({
    prompt,
    model,
    resolution,
    quality,
    size,
    cost,
    jobId,
    silentToast,
    isRecovery,
    fromInspirationDraw,
    pendingId,
    targetGroup,
    targetTags,
    primary,
    gridUrls,
    composite,
    buttons
  }) {
    const tiles = (gridUrls || []).filter(Boolean).slice(0, 4);
    const mainImage = primary || tiles[0];
    if (!mainImage) return false;
    const saveAll = isImageGenMjSaveAllTiles() && tiles.length > 1;
    const base = {
      prompt,
      model,
      resolution,
      quality,
      size,
      cost,
      jobId,
      isRecovery,
      fromInspirationDraw,
      pendingId,
      targetGroup,
      targetTags,
      isMidjourney: true
    };

    if (saveAll) {
      for (let i = 0; i < tiles.length; i += 1) {
        await finishImageGenRun({
          ...base,
          image: tiles[i],
          imageIndex: i + 1,
          silentToast: true,
          mjGridUrls: i === 0 ? tiles : null,
          mjCompositeUrl: i === 0 ? composite : null,
          mjButtons: i === 0 ? buttons : null,
          mjSplitSave: true
        });
      }
      if (!silentToast) {
        toast(`Midjourney ${tiles.length} 张已分别存入仓库，点预览可对首张放大/变体`);
      }
      return true;
    }

    await finishImageGenRun({
      ...base,
      image: mainImage,
      imageIndex: 1,
      silentToast: true,
      extraImages: [],
      mjGridUrls: tiles.length ? tiles : [mainImage],
      mjCompositeUrl: composite,
      mjButtons: buttons
    });
    if (!silentToast) {
      const n = tiles.length;
      toast(
        n >= 4
          ? 'Midjourney 已入库（预览可切换四张），勾选「四张分别存入」可各存一张'
          : `Midjourney 已入库 ${n} 张图，点预览继续操作`
      );
    }
    return true;
  }

  /** 入库主图 + 同任务附赠图；已有主图时只补缺失的附赠槽位 */
  async function ensureGenJobCreationsFromPoll(poll, ctx, pendingId) {
    if (poll?.data?.status !== 'completed' || !poll.data.imageUrl) return false;
    const baseJobId = ctx?.jobId || poll.data.jobId;
    const imageUrl = poll.data.imageUrl;
    const extras = getPollExtraImageUrls(poll, imageUrl);
    const isMj = poll.data.isMidjourney || isImageGenMidjourneyModel(ctx?.model);

    if (isMj) {
      const parsed = resolveMjPollImages(poll);
      const gridUrls = parsed.tiles.length ? parsed.tiles : parsed.primary ? [parsed.primary] : [];
      const primary = parsed.primary || imageUrl;
      if (!primary) return false;
      if (baseJobId && hasWarehouseCardForJob(baseJobId)) {
        const card = findWarehouseCardForJob(baseJobId);
        if (card && gridUrls.length > 1
          && (!Array.isArray(card.mjGridUrls) || card.mjGridUrls.length < gridUrls.length)) {
          await repairMjWarehouseCardFields(card, {
            mjGridUrls: gridUrls,
            mjCompositeUrl: parsed.composite,
            mjButtons: poll.data.mjButtons
          });
        }
        if (isImageGenMjSaveAllTiles() && gridUrls.length > 1) {
          for (let i = 2; i <= gridUrls.length; i += 1) {
            const slotId = `${baseJobId}#${i}`;
            if (!hasWarehouseCardForJob(slotId)) {
              await finishImageGenRun({
                ...ctx,
                image: gridUrls[i - 1],
                imageIndex: i,
                cost: ctx.cost,
                jobId: baseJobId,
                silentToast: true,
                isRecovery: !!ctx.isRecovery,
                isMidjourney: true,
                mjSplitSave: true
              });
            }
          }
        }
        if (pendingId) removePendingJob(pendingId);
        clearSessionGenJob(baseJobId);
        renderImageGenFeed({ preserveScroll: true });
        return true;
      }
      if (baseJobId && findWarehouseCardForJob(baseJobId) && !hasWarehouseCardForJob(baseJobId)) {
        await repairWarehouseCardImageFromJob(findWarehouseCardForJob(baseJobId), primary, baseJobId);
      }
      await saveMjToWarehouse({
        ...ctx,
        primary,
        gridUrls,
        composite: parsed.composite,
        buttons: poll.data.mjButtons,
        jobId: baseJobId,
        silentToast: !!ctx.silentToast,
        isRecovery: !!ctx.isRecovery,
        pendingId
      });
      return true;
    }

    if (baseJobId && allGenCreationSlotsSaved(baseJobId, extras.length)) {
      const mainCard = findWarehouseCardForJob(baseJobId);
      if (mainCard && warehouseCardImageNeedsRecovery(mainCard, imageUrl)) {
        await repairWarehouseCardImageFromJob(mainCard, imageUrl, baseJobId);
      }
      for (let ei = 0; ei < extras.length; ei += 1) {
        const slotId = `${baseJobId}#${ei + 2}`;
        const slotCard = findWarehouseCardForJob(slotId);
        if (slotCard && warehouseCardImageNeedsRecovery(slotCard, extras[ei])) {
          await repairWarehouseCardImageFromJob(slotCard, extras[ei], slotId);
        }
      }
      if (pendingId) removePendingJob(pendingId);
      clearSessionGenJob(baseJobId);
      renderImageGenFeed({ preserveScroll: true });
      return true;
    }

    if (!baseJobId || !isGenCreationSlotSaved(baseJobId, 1)) {
      await finishImageGenRun({
        ...ctx,
        image: imageUrl,
        extraImages: extras,
        cost: ctx.cost,
        jobId: baseJobId,
        silentToast: !!ctx.silentToast,
        isRecovery: !!ctx.isRecovery,
        pendingId
      });
      if (extras.length && !ctx.silentToast) {
        toast(`本次上游共 ${extras.length + 1} 张图，已全部存入仓库（仅扣 1 次积分）`);
      }
      return true;
    }

    for (let i = 0; i < extras.length; i += 1) {
      if (!isGenCreationSlotSaved(baseJobId, i + 2)) {
        await finishImageGenRun({
          ...ctx,
          image: extras[i],
          extraImages: [],
          cost: ctx.cost,
          jobId: baseJobId,
          silentToast: true,
          isRecovery: !!ctx.isRecovery,
          pendingId: null,
          imageIndex: i + 2
        });
      }
    }
    if (pendingId) removePendingJob(pendingId);
    renderImageGenFeed({ preserveScroll: true });
    if (extras.length && !ctx.silentToast) {
      toast(`已补全同任务附赠图 ${extras.length} 张`);
    }
    return true;
  }

  function isSlowGenProviderModel(modelId) {
    const id = normalizeImageGenModelId(modelId);
    return id.startsWith('mooko-') || id.startsWith('ithink-');
  }

  /** 2K/4K/VIP/慢速线：上游常需 10 分钟级，勿按 5 分钟判死 */
  function isLongRunningGenJob(ctx) {
    if (isSlowGenProviderModel(ctx?.model)) return true;
    const res = normalizeImageGenResolution(ctx?.resolution);
    if (res === '2k' || res === '4k') return true;
    const id = normalizeImageGenModelId(ctx?.model);
    if (id.includes('vip') || id.includes('-pro')) return true;
    return false;
  }

  function genActivePollMaxMs(ctx) {
    return isLongRunningGenJob(ctx) ? 15 * 60 * 1000 : 5 * 60 * 1000;
  }

  function genRecoveringDeferGiveUpMs(ctx) {
    return isLongRunningGenJob(ctx) ? 45 * 60 * 1000 : 22 * 60 * 1000;
  }

  function pendingRecoveryGiveUpMs(pending) {
    return genRecoveringDeferGiveUpMs(pendingJobToPollCtx(pending || {}));
  }

  function formatPendingRecoveryNote(pending, fallback) {
    const age = Date.now() - (pending?.startedAt || 0);
    const mins = Math.max(1, Math.floor(age / 60000));
    const base = fallback || pending?.recoverNote || '后台恢复中';
    return `${base} · 已等 ${mins} 分钟`;
  }

  function slowGenDeferNote(ctx) {
    return isSlowGenProviderModel(ctx?.model)
      ? '约 2–12 分钟，后台继续等待（请勿重复提交）'
      : isLongRunningGenJob(ctx)
        ? '2K/4K 约 5–15 分钟，后台继续等待（请勿重复提交）'
        : '可能已出图，正在后台恢复（请勿重复提交）';
  }

  /** 快线路 5 分钟；木瓜/ThinkAI 慢速线 12 分钟 */
  const ACTIVE_POLL_MAX_MS = 5 * 60 * 1000;

  function isDefinitiveGenFailure(errRaw, pollData) {
    const s = String(errRaw || pollData?.message || pollData?.errorMessage || '');
    if (/upstream_content_violation|prohibited words or images|prohibited|flagged as containing|违规不返还|violation/i.test(s)) return true;
    if (/content.*policy|safety|moderation|blocked|违规|敏感/i.test(s)) return true;
    if (/insufficient balance|insufficient credits/i.test(s)) return true;
    if (/apikey|invalid.*api.*key|unauthorized/i.test(s)) return true;
    if (/This content may violate|content may violate/i.test(s)) return true;
    return false;
  }

  async function failPendingJobImmediately(pendingId, ctx, errRaw) {
    const msg = friendlyGenErrorMessage(errRaw);
    failPendingJob(pendingId, msg);
    await window.PointsSystem?.refreshCreditsFromServer?.();
    renderImageGenFeed({ preserveScroll: true, force: true });
    if (!ctx?.silentToast) toastGenFailure(ctx, msg);
  }

  /** 5 分钟内快轮询；超时后交给后台恢复 */
  function genJobPollDelayMs(ctx, attemptIndex) {
    const elapsed = Math.max(0, Date.now() - (ctx?.startedAt || Date.now()));
    const activeMax = genActivePollMaxMs(ctx);
    if (elapsed >= activeMax) return isLongRunningGenJob(ctx) ? 9000 : 7000;
    if (attemptIndex <= 1) return 1500;
    if (attemptIndex <= 4) return 2200;
    if (isLongRunningGenJob(ctx)) {
      if (elapsed < 120_000) return 4000;
      if (elapsed < 360_000) return 6000;
      if (elapsed < 720_000) return 8000;
      return 10000;
    }
    if (elapsed < 60_000) return 3200;
    if (elapsed < 180_000) return 4500;
    return 5500;
  }

  function applyGenPollProgressNote(pendingId, pollData) {
    const note = pollData?.progressNote;
    if (!note || !pendingId) return;
    const job = imageGenPendingJobs.find((j) => j.id === pendingId);
    if (!job) return;
    if (job.pendingNote === note) return;
    job.pendingNote = note;
    if (pollData?.status === 'processing' && isLongRunningGenJob({ model: job.model, resolution: job.resolution })) {
      job.recovering = false;
      job.recoverNote = '';
    }
    persistPendingGenJobs();
    if (document.getElementById('pageImageGen')?.classList.contains('active')) {
      scheduleImageGenPendingUiRefresh();
      return;
    }
    renderImageGenFeed({ preserveScroll: true, force: true });
  }

  async function pollGenerationJobUntilDone(jobId, pendingId, ctx) {
    if (activePollJobIds.has(jobId)) return;
    activePollJobIds.add(jobId);
    try {
    const maxAttempts = 90;
    const finishFromPoll = async (poll) => {
      if (poll.data.status === 'failed') {
        const errRaw = poll.data.errorMessage || poll.data.message || '';
        if (isDefinitiveGenFailure(errRaw, poll.data)) {
          await failPendingJobImmediately(pendingId, ctx, errRaw);
          return true;
        }
        return false;
      }
      if (poll.data.status === 'completed') {
        return ensureGenJobCreationsFromPoll(poll, { ...ctx, jobId: ctx.jobId || jobId }, pendingId);
      }
      return false;
    };

    const failAfterGrace = async () => {
      for (let g = 0; g < 12; g += 1) {
        await new Promise((r) => setTimeout(r, g === 0 ? 2500 : g < 4 ? 4000 : 6000));
        const retry = await window.PromptHubApi.getGenerationJob(jobId);
        if (retry.ok && await finishFromPoll(retry)) return true;
        if (retry.ok && (retry.data.status === 'processing' || (retry.data.status === 'completed' && !retry.data.imageUrl))) {
          continue;
        }
        if (retry.ok && retry.data.status === 'failed' && isLikelyRecoverableGenFailure(retry.data.errorMessage, ctx)) {
          continue;
        }
      }
      const last = await window.PromptHubApi.getGenerationJob(jobId);
      if (last.ok && await finishFromPoll(last)) return true;
      const errRaw = last.ok && last.data.status === 'failed'
        ? (last.data.errorMessage || last.data.message)
        : '生图超时或上游无结果';
        if (isLikelyRecoverableGenFailure(errRaw, ctx)) {
        deferPendingJobRecovery(pendingId, ctx, slowGenDeferNote(ctx));
        return true;
      }
      const msg = friendlyGenErrorMessage(errRaw);
      failPendingJob(pendingId, msg);
      await window.PointsSystem?.refreshCreditsFromServer?.();
      renderImageGenFeed({ preserveScroll: true });
      toastGenFailure(ctx, msg);
      return true;
    };

    for (let i = 0; i < maxAttempts; i++) {
      const elapsed = Date.now() - (ctx?.startedAt || Date.now());
      const activeMax = genActivePollMaxMs(ctx);
      if (elapsed >= activeMax) {
        deferPendingJobRecovery(
          pendingId,
          ctx,
          isSlowGenProviderModel(ctx?.model)
            ? '前台已等 15 分钟，仍在后台生成（请勿重复提交）'
            : isLongRunningGenJob(ctx)
              ? '前台已等 15 分钟，2K/4K 仍在后台等待（请勿重复提交）'
              : '前台已等 5 分钟，仍在后台恢复（请勿重复提交）'
        );
        void resumePendingGenerationJobs();
        return;
      }
      if (i > 0) await new Promise((r) => setTimeout(r, genJobPollDelayMs(ctx, i)));
      const elapsedNow = Date.now() - (ctx?.startedAt || Date.now());
      const useSettle = isSlowGenProviderModel(ctx?.model)
        ? elapsedNow > 20_000
        : isLongRunningGenJob(ctx) && elapsedNow > 60_000;
      const poll = await window.PromptHubApi.getGenerationJob(jobId, { settle: useSettle });
      if (poll.ok) applyGenPollProgressNote(pendingId, poll.data);
      if (!poll.ok) {
        const recoverableNet =
          poll.code === 'NETWORK_ERROR'
          || poll.code === 'API_UNREACHABLE'
          || poll.status === 524
          || /524|timeout|超时/i.test(String(poll.message || ''));
        if (i < maxAttempts - 1) {
          const backoff = poll.code === 'RATE_LIMITED'
            ? 4500
            : recoverableNet
              ? 2800
              : 2200;
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        if (recoverableNet || poll.code === 'RATE_LIMITED') {
          deferPendingJobRecovery(pendingId, ctx, slowGenDeferNote(ctx));
          void resumePendingGenerationJobs();
          return;
        }
        toast(poll.message || '查询生图进度失败，正在尝试恢复…');
        void resumePendingGenerationJobs();
        return;
      }

      if (typeof poll.data.creditsRemaining === 'number') {
        window.PointsSystem?.setCreditsFromServer?.(poll.data.creditsRemaining);
        window.PointsSystem?.updateCreditsUI?.();
      }

      if (poll.data.status === 'processing') {
        continue;
      }

      if (poll.data.status === 'completed' && !poll.data.imageUrl) {
        continue;
      }

      if (poll.data.status === 'failed') {
        const errRaw = poll.data.errorMessage || poll.data.message || '';
        if (isDefinitiveGenFailure(errRaw, poll.data)) {
          await failPendingJobImmediately(pendingId, ctx, errRaw);
          return;
        }
        if (isLikelyRecoverableGenFailure(errRaw, ctx) && elapsed < ACTIVE_POLL_MAX_MS) {
          continue;
        }
        if (await failAfterGrace()) return;
        continue;
      }

      if (await finishFromPoll(poll)) return;
    }

    const last = await window.PromptHubApi.getGenerationJob(jobId);
    if (last.ok && await finishFromPoll(last)) return;
    if (await failAfterGrace()) return;

    toast('生图时间较长，正在恢复本次任务…');
    void resumePendingGenerationJobs();
    renderImageGenFeed({ preserveScroll: true });
    } finally {
      activePollJobIds.delete(jobId);
    }
  }

  /**
   * 从 API 恢复生图结果。
   * - sessionOnly：仅恢复「本会话提交」的任务（轮询失败时用）
   * - manual：用户点「恢复丢失的生图」并确认后
   * 永不自动恢复：用户已删除（job 墓碑）或已有仓库卡片
   */
  async function recoverRecentGenerationJobs(opts = {}) {
    if (opts.manual === true) return { ok: true, recovered: 0 };
    if (!opts.sessionOnly) return;

    const r = await window.PromptHubApi.listRecentGenerationJobs();
    if (!r?.ok || !Array.isArray(r.data?.jobs)) return;

    let changed = false;
    let recovered = 0;
    for (const job of r.data.jobs) {
      if (!job?.id) continue;
      if (isGenerationJobDeleted(job.id)) continue;

      const meta = {
        prompt: job.prompt || '',
        model: job.model || 'gpt-image-2',
        resolution: job.resolution || '1k',
        quality: job.quality || 'standard',
        size: job.size || '1:1',
        cost: job.creditsCharged || 0,
        jobId: job.id
      };
      const inSession = isSessionGenJob(job.id);

      if (job.status === 'processing') {
        if (!inSession) continue;
        const alreadyPending = imageGenPendingJobs.some((j) => j.jobId === job.id);
        if (!alreadyPending) {
          const pendingId = genId('pending');
          imageGenPendingJobs.unshift({
            id: pendingId,
            jobId: job.id,
            prompt: meta.prompt,
            model: meta.model,
            modelLabel: job.modelLabel || imageGenModelLabel(job.model),
            resolution: meta.resolution,
            quality: meta.quality,
            size: meta.size,
            cost: meta.cost,
            startedAt: Date.parse(job.createdAt) || Date.now()
          });
          changed = true;
          void pollGenerationJobUntilDone(job.id, pendingId, meta);
        }
        continue;
      }

      if (job.status !== 'completed' || !job.imageUrl) continue;
      if (!inSession) continue;
      if (!needsApiImageRecovery(job.id, job.imageUrl)) continue;
      const matchesActivePending = imageGenPendingJobs.some(
        (p) => p.jobId === job.id
          || (pendingPromptsMatch(p.prompt, job.prompt)
            && normalizeImageGenModelId(p.model) === normalizeImageGenModelId(job.model)
            && (!p.resolution || !job.resolution || p.resolution === job.resolution))
      );
      if (imageGenPendingJobs.length && !matchesActivePending) continue;

      const recoverExtrasList = Array.isArray(job.extraImageUrls)
        ? job.extraImageUrls.filter((u) => u && u !== job.imageUrl)
        : [];
      if (await syncMissingBonusImagesForJob(job, meta, { silentToast: true })) {
        changed = true;
        recovered += 1;
        continue;
      }

      const existingCard = (window.__promptHubCards || []).find((c) => c.genJobId === job.id);

      changed = true;
      if (existingCard && !existingCard.image) {
        const ok = await repairWarehouseCardImageFromJob(existingCard, job.imageUrl, job.id);
        if (ok) {
          recovered += 1;
          continue;
        }
      }

      recovered += 1;
      await ensureGenJobCreationsFromPoll(
        { data: { status: 'completed', imageUrl: job.imageUrl, extraImageUrls: recoverExtrasList } },
        { ...meta, silentToast: true, isRecovery: true },
        null
      );
    }

    if (changed) renderImageGenFeed({ preserveScroll: true });
  }

  async function runImageGenWithPrompt(promptOverride, opts) {
    const batchOpts = opts && typeof opts === 'object' ? opts : {};
    if (!window.AuthGate?.requireAuth?.('imagegen')) return { ok: false };
    const metaEarly = getImageGenFormMeta();
    const mjBlendMode = isImageGenMidjourneyModel(metaEarly.model) && getImageGenMjMode() === 'blend';
    const prompt = String(
      promptOverride ?? document.getElementById('imageGenPrompt')?.value ?? ''
    ).trim();
    if (!prompt && !mjBlendMode) {
      toast('请先填写提示词');
      return { ok: false };
    }
    if (mjBlendMode && !batchOpts.batch) {
      const refCount = imageGenRefImages.filter(Boolean).length;
      if (refCount < 2) {
        toast('混图需要参考图框内 2～5 张图');
        return { ok: false };
      }
    }
    if (!imageGenModelCatalogReady || !document.getElementById('imageGenModel')?.value) {
      toast('模型列表加载中，请稍候再点生成');
      return { ok: false };
    }

    const btn = document.getElementById(batchOpts.submitBtnId || 'imageGenSubmit');
    const singleRun = !batchOpts.batch;
    if (singleRun && btn?.disabled && !imageGenBatchRunning) {
      btn.disabled = false;
    }
    if (singleRun && btn) {
      btn.disabled = true;
      btn.textContent = '准备中…';
    }

    let pendingId = null;
    let submitUiReleased = false;
    const releaseSubmitUi = () => {
      if (!singleRun || submitUiReleased) return;
      submitUiReleased = true;
      if (btn) {
        btn.disabled = false;
        restoreImageGenSubmitLabel();
      }
    };
    try {
      const meta = getImageGenFormMeta();
      const { model, resolution, quality, size } = meta;
      let cost = window.PointsSystem?.getImageGenCost?.(model, resolution) ?? 10;
      let balance = window.PointsSystem?.getCredits?.() ?? 0;
      const useApi = window.PointsSystem?.useApiForAccount?.();

      if (balance < cost) {
        toast(`积分不足（需要 ${cost}，当前 ${balance}）。请使用激活码兑换`);
        return { ok: false, reason: 'credits' };
      }

      saveImageGenDraft({
        prompt,
        model,
        refImages: imageGenRefImages,
        refImage: getImageGenPrimaryRef(),
        resolution,
        quality,
        size,
        count: getImageGenBatchCount()
      });

      const modelLabel = window.PointsSystem?.getImageGenModel?.(model)?.label || model;
      pendingId = genId('pending');
      const saveTarget = getImageGenSaveTarget();
      const pendingJob = {
        id: pendingId,
        prompt,
        model,
        modelLabel,
        resolution,
        quality,
        size,
        cost,
        targetGroup: saveTarget.targetGroup,
        targetTags: saveTarget.targetTags,
        fromInspirationDraw: !!batchOpts.fromInspirationDraw,
        batchIndex: batchOpts.batchIndex || null,
        batchTotal: batchOpts.batchTotal || null,
        batchId: batchOpts.batchId || null,
        silentToast: !!batchOpts.silentToast,
        startedAt: Date.now()
      };
      imageGenPendingJobs.unshift(pendingJob);
      persistPendingGenJobs();
      imageGenFeedTab = 'warehouse';
      document.querySelectorAll('[data-feed-tab]').forEach(b => {
        b.classList.toggle('active', b.dataset.feedTab === 'warehouse');
      });
      updateImageGenFeedHint();
      renderImageGenFeed({ preserveScroll: true });
      if (singleRun && isMobileViewport() && window.MobileUI?.setImageGenView) {
        window.MobileUI.setImageGenView('feed', { scrollToTop: false });
      }
      releaseSubmitUi();

      if (useApi) {
        const localCost = cost;
        const quoted = await Promise.race([
          quoteGenerationCost(resolution, quality, model, cost),
          new Promise((resolve) => {
            setTimeout(() => resolve({ cost: localCost, fromApi: false }), GEN_COST_QUOTE_TIMEOUT_MS);
          })
        ]);
        cost = quoted.cost;
        pendingJob.cost = cost;
        persistPendingGenJobs();
        balance = window.PointsSystem?.getCredits?.() ?? 0;
      }

      if (balance < cost) {
        removePendingJob(pendingId);
        renderImageGenFeed({ preserveScroll: true });
        toast(`积分不足（需要 ${cost}，当前 ${balance}）。请使用激活码兑换`);
        return { ok: false, reason: 'credits' };
      }

      if (!useApi && !window.PointsSystem?.deductCredits?.(cost)) {
        removePendingJob(pendingId);
        renderImageGenFeed({ preserveScroll: true });
        toast('积分扣除失败');
        return { ok: false };
      }

      if (useApi) {
        const refSources = batchOpts.skipRefImages
          ? []
          : Array.isArray(batchOpts.refImages) && batchOpts.refImages.length
            ? batchOpts.refImages
            : imageGenRefImages;
        const refUrls = await resolveRefUrlsFromList(refSources);
        if (refSources.length && refUrls.length < refSources.length && !batchOpts.silentToast) {
          toast(`已使用 ${refUrls.length}/${refSources.length} 张参考图继续生成`);
        }
        const genPayload = {
          prompt: prompt || '[MJ 混图]',
          model,
          resolution,
          quality,
          size,
          refImageUrls: refUrls.length ? refUrls : undefined,
          ...(meta.mjParams ? { mjParams: meta.mjParams } : {})
        };
        let gen;
        if (mjBlendMode) {
          gen = await window.PromptHubApi.mjBlend({
            refImageUrls: refUrls.slice(0, 5),
            model
          });
        } else {
          gen = await window.PromptHubApi.generateImage(genPayload);
        }
        if (!gen.ok && batchOpts.batch && !mjBlendMode) {
          const retryable = gen.code === 'RATE_LIMITED'
            || gen.status === 429
            || /过于频繁|upstream|502|503|429|rate limit/i.test(String(gen.message || ''));
          for (let attempt = 0; attempt < 2 && !gen.ok && retryable; attempt += 1) {
            await new Promise((r) => setTimeout(r, 2000 + attempt * 2500));
            gen = await window.PromptHubApi.generateImage(genPayload);
          }
        }
        if (!gen.ok) {
          const networkLike =
            gen.code === 'NETWORK_ERROR'
            || gen.code === 'API_UNREACHABLE'
            || gen.status === 524
            || /524|无法连接 api\.prompt-hub|连接.*超时|Failed to fetch|请求失败 \(524\)/i.test(String(gen.message || ''));
          if (networkLike) {
            const recovered = await tryRecoverOrphanGenJobAfterSubmitError(genPayload, pendingId, pendingJob);
            if (recovered) {
              renderImageGenFeed({ preserveScroll: true });
              return { ok: true, recovered: true, batchIndex: batchOpts.batchIndex, batchTotal: batchOpts.batchTotal };
            }
            deferPendingJobRecovery(
              pendingId,
              pendingJobToPollCtx(pendingJob),
              gen.status === 524 || /524/.test(String(gen.message || ''))
                ? '连接超时（524），任务可能已提交，后台继续等待…'
                : slowGenDeferNote(pendingJobToPollCtx(pendingJob))
            );
            renderImageGenFeed({ preserveScroll: true });
            return { ok: true, recovered: true, batchIndex: batchOpts.batchIndex, batchTotal: batchOpts.batchTotal };
          }
          const errMsg = friendlyGenErrorMessage(gen.message);
          if (/524|请求失败 \(524\)/i.test(errMsg) || /524/i.test(String(gen.message || ''))) {
            deferPendingJobRecovery(
              pendingId,
              pendingJobToPollCtx(pendingJob),
              '连接超时（524），任务可能已提交，后台继续等待…'
            );
            renderImageGenFeed({ preserveScroll: true });
            return { ok: true, recovered: true, batchIndex: batchOpts.batchIndex, batchTotal: batchOpts.batchTotal };
          }
          failPendingJob(pendingId, errMsg);
          renderImageGenFeed({ preserveScroll: true });
          await window.PointsSystem?.refreshCreditsFromServer?.();
          if (!batchOpts.silentToast) toast(errMsg);
          return { ok: false, message: errMsg, batchIndex: batchOpts.batchIndex, batchTotal: batchOpts.batchTotal };
        }
        if (typeof gen.data.creditsRemaining === 'number') {
          window.PointsSystem?.setCreditsFromServer?.(gen.data.creditsRemaining);
          window.PointsSystem?.updateCreditsUI?.();
        }
        cost = gen.data.creditsCharged ?? cost;
        pendingJob.cost = cost;

        if (gen.data.status === 'completed' && gen.data.imageUrl) {
          if (gen.data.jobId) trackSessionGenJob(gen.data.jobId);
          const mjParsed = gen.data.isMidjourney || mjBlendMode
            ? resolveMjPollImages({ data: gen.data })
            : null;
          if (gen.data.isMidjourney || mjBlendMode) {
            await saveMjToWarehouse({
              prompt: prompt || '[MJ 混图]',
              model,
              resolution,
              quality,
              size,
              cost,
              jobId: gen.data.jobId,
              targetGroup: pendingJob.targetGroup,
              targetTags: pendingJob.targetTags,
              silentToast: batchOpts.silentToast,
              fromInspirationDraw: !!batchOpts.fromInspirationDraw,
              pendingId,
              primary: mjParsed?.primary || gen.data.imageUrl,
              gridUrls: mjParsed?.tiles?.length ? mjParsed.tiles : [gen.data.imageUrl],
              composite: mjParsed?.composite,
              buttons: gen.data.mjButtons
            });
          } else {
            await finishImageGenRun({
              prompt,
              model,
              resolution,
              quality,
              size,
              image: gen.data.imageUrl,
              cost,
              jobId: gen.data.jobId,
              targetGroup: pendingJob.targetGroup,
              targetTags: pendingJob.targetTags,
              silentToast: batchOpts.silentToast,
              fromInspirationDraw: !!batchOpts.fromInspirationDraw,
              pendingId
            });
          }
          return { ok: true, creditsCharged: cost };
        }

        const jobId = gen.data.jobId;
        if (!jobId) {
          failPendingJob(pendingId, '未收到任务编号');
          renderImageGenFeed();
          if (!batchOpts.silentToast) toast('未收到任务编号，请重试');
          return { ok: false, message: '未收到任务编号', batchIndex: batchOpts.batchIndex, batchTotal: batchOpts.batchTotal };
        }
        pendingJob.jobId = jobId;
        pendingJob.slowProvider = isSlowGenProviderModel(model);
        if (gen.data.progressNote) pendingJob.pendingNote = gen.data.progressNote;
        trackSessionGenJob(jobId);
        persistPendingGenJobs();
        if (!batchOpts.silentToast) {
          toast(
            pendingJob.slowProvider
              ? '已提交，约 1–12 分钟出图，下方可看进度'
              : '已提交生图，下方可查看进度，可继续点击生成'
          );
        }
        void pollGenerationJobUntilDone(jobId, pendingId, {
          prompt,
          model,
          resolution,
          quality,
          size,
          cost,
          jobId,
          targetGroup: pendingJob.targetGroup,
          targetTags: pendingJob.targetTags,
          startedAt: pendingJob.startedAt,
          fromInspirationDraw: !!batchOpts.fromInspirationDraw,
          silentToast: !!batchOpts.silentToast,
          batchIndex: batchOpts.batchIndex || null,
          batchTotal: batchOpts.batchTotal || null,
          batchId: batchOpts.batchId || null
        });
        return { ok: true, creditsCharged: cost };
      }

      removePendingJob(pendingId);
      renderImageGenFeed();
      if (!batchOpts.silentToast) toast('请登录并连接后端 API 后使用真实生图（演示占位已关闭）');
      return { ok: false };
    } catch (e) {
      console.error('[imagegen] runImageGenWithPrompt failed', e);
      if (typeof pendingId === 'string' && pendingId) {
        failPendingJob(pendingId, String(e?.message || '生图提交失败'));
        renderImageGenFeed();
      }
      if (!batchOpts.silentToast) {
        const msg = String(e?.message || '');
        let hint = msg || '请刷新页面后重试';
        if (/quota|exceeded/i.test(msg)) {
          hint = '浏览器存储已满，已跳过草稿保存；请清除站点数据或减少参考图后重试';
        } else if (/please wait|too many|rate limit|busy/i.test(msg)) {
          hint = '生图服务繁忙，请稍等 1～2 分钟再试';
        } else if (/apikey|api.key|invalid.*api.*key|unauthorized|401|upstream_auth/i.test(msg)) {
          hint = '生图服务认证失败，请联系站长';
        }
        toast('生图提交失败：' + hint);
      }
      return { ok: false, message: e?.message || 'submit failed' };
    } finally {
      releaseSubmitUi();
    }
  }

  async function runImageGenDemo() {
    if (imageGenBatchRunning) {
      toast('生图任务提交中，请稍候');
      return;
    }
    const count = getImageGenBatchCount();
    if (count <= 1) {
      await runImageGenWithPrompt();
      return;
    }

    const prompt = String(document.getElementById('imageGenPrompt')?.value || '').trim();
    if (!prompt) {
      toast('请先填写提示词');
      return;
    }
    if (!window.AuthGate?.requireAuth?.('imagegen')) return;

    const meta = getImageGenFormMeta();
    let unit = window.PointsSystem?.getImageGenCost?.(meta.model, meta.resolution) ?? 10;
    if (window.PointsSystem?.useApiForAccount?.()) {
      const quoted = await quoteGenerationCost(meta.resolution, meta.quality, meta.model, unit);
      unit = quoted.cost;
    }
    unit = window.PointsSystem?.roundCredits?.(unit) ?? unit;
    const fmt = window.PointsSystem?.formatCredits || ((n) => String(n));
    const balance = window.PointsSystem?.getCredits?.() ?? 0;
    const totalNeed = window.PointsSystem?.roundCredits?.(unit * count) ?? unit * count;
    if (balance < unit) {
      toast(`积分不足（每张 ${fmt(unit)}，当前 ${fmt(balance)}）`);
      return;
    }
    if (balance < totalNeed) {
      toast(`积分约够 ${Math.floor(balance / unit)} 张，将按顺序提交直到不足（${fmt(unit)} 积分/张）`);
    }

    imageGenBatchRunning = true;
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const btn = document.getElementById('imageGenSubmit');
    if (btn) btn.disabled = true;
    try {
      let ok = 0;
      let charged = 0;
      for (let i = 0; i < count; i += 1) {
        const curBalance = window.PointsSystem?.getCredits?.() ?? 0;
        if (curBalance < unit && i > 0) break;
        if (btn) btn.textContent = `提交中 ${i + 1}/${count}…`;
        const res = await runImageGenWithPrompt(undefined, {
          silentToast: true,
          batch: true,
          batchId,
          batchIndex: i + 1,
          batchTotal: count
        });
        if (res?.ok) {
          ok += 1;
          charged += res.creditsCharged || unit;
        } else if (res?.reason === 'credits') {
          break;
        } else if (i === 0) {
          break;
        }
        if (i < count - 1) await new Promise((r) => setTimeout(r, 2200 + Math.floor(Math.random() * 800)));
      }
      await window.PointsSystem?.refreshCreditsFromServer?.();
      window.PointsSystem?.updateCreditsUI?.();
      if (ok > 0) {
        toast(`已提交 ${ok}/${count} 张生图，已扣约 ${fmt(charged)} 积分（${fmt(unit)} 积分/张）`);
        if (isMobileViewport() && window.MobileUI?.setImageGenView) {
          window.MobileUI.setImageGenView('feed', { scrollToTop: false });
        }
      }
    } catch (e) {
      console.error('[imagegen] batch submit failed', e);
      toast('批量生图提交失败，请刷新页面后重试');
    } finally {
      imageGenBatchRunning = false;
      if (btn) {
        btn.disabled = false;
        restoreImageGenSubmitLabel();
      }
    }
  }

  async function finishImageGenRun({
    prompt,
    model,
    resolution,
    quality,
    size,
    image,
    extraImages,
    cost,
    btn,
    jobId,
    silentToast,
    isRecovery,
    fromInspirationDraw,
    pendingId,
    imageIndex,
    targetGroup,
    targetTags,
    isMidjourney,
    mjGridUrls,
    mjCompositeUrl,
    mjButtons,
    mjSplitSave
  }) {
    if (!image) {
      toast('图片地址无效，请重试');
      return;
    }
    const baseJobId = jobId ? String(jobId).replace(/#\d+$/, '') : null;
    const idx = Math.max(1, Number(imageIndex) || 1);
    const slotJobId = baseJobId ? (idx === 1 ? baseJobId : `${baseJobId}#${idx}`) : null;
    if (slotJobId) {
      if (isGenerationJobDeleted(slotJobId) || isGenerationJobDeleted(baseJobId)) return;
      const existingCard = findWarehouseCardForJob(slotJobId);
      if (existingCard && hasWarehouseCardForJob(slotJobId)) {
        if (isMidjourney && Array.isArray(mjGridUrls) && mjGridUrls.length > 1
          && (!Array.isArray(existingCard.mjGridUrls) || existingCard.mjGridUrls.length < mjGridUrls.length)) {
          await repairMjWarehouseCardFields(existingCard, {
            mjGridUrls,
            mjCompositeUrl,
            mjButtons
          });
          renderImageGenFeed({ preserveScroll: true });
        }
        if (warehouseCardImageNeedsRecovery(existingCard, image)) {
          await repairWarehouseCardImageFromJob(existingCard, image, slotJobId);
          renderImageGenFeed({ preserveScroll: true });
        }
        if (idx === 1) {
          clearSessionGenJob(baseJobId);
          if (pendingId) removePendingJob(pendingId);
          prunePendingJobsWithWarehouseCards();
          renderImageGenFeed({ preserveScroll: true });
        }
        return;
      }
      if (finishingJobIds.has(slotJobId)) return;
      finishingJobIds.add(slotJobId);
    }
    try {
      const existingCre = slotJobId ? creations.find((c) => c.jobId === slotJobId) : null;
      const creationId = existingCre?.id || genId('cr');
      let storedImage = image;
      if (window.SupabaseSync?.persistGenerationImage && slotJobId) {
        try {
          const ref = await window.SupabaseSync.persistGenerationImage(creationId, image, {
            jobId: slotJobId
          });
          if (ref && ref !== image) storedImage = ref;
        } catch (e) {
          console.warn('生成图原图归档失败，将用任务链接入库后重试', e);
        }
      }
      if (idx === 1) imageGenLastResult = storedImage;
      const primaryRef = getImageGenPrimaryRef();
      const modelId = model || 'gpt-image-2';
      const modelLabel = window.PointsSystem?.getImageGenModel?.(modelId)?.label || modelId;
      const promptNote = idx > 1
        ? (isMidjourney && (mjSplitSave || isImageGenMjSaveAllTiles()) ? `${prompt}（MJ 图 ${idx}）` : `${prompt}（同任务附赠图 ${idx}）`)
        : prompt;
      const cardMjGridUrls = isMidjourney && Array.isArray(mjGridUrls) && idx === 1 && !mjSplitSave
        ? mjGridUrls
        : (isMidjourney && mjSplitSave ? null : (isMidjourney && Array.isArray(mjGridUrls) ? mjGridUrls : null));
      const creation = {
        id: creationId,
        jobId: slotJobId,
        prompt: promptNote,
        image: storedImage,
        refImage: primaryRef,
        refImages: imageGenRefImages.length ? [...imageGenRefImages] : null,
        model: modelId,
        modelLabel,
        resolution,
        quality: quality || 'standard',
        size: size || '1:1',
        hasRefImage: imageGenRefImages.length > 0,
        visibility: 'private',
        createdAt: Date.now() + idx,
        expiresAt: Date.now() + randomGenRetentionMs(),
        isMidjourney: !!isMidjourney,
        mjGridUrls: cardMjGridUrls,
        mjCompositeUrl: isMidjourney && mjCompositeUrl && idx === 1 ? mjCompositeUrl : null,
        mjButtons: isMidjourney && Array.isArray(mjButtons) && idx === 1 ? mjButtons : null
      };
      creations = dedupeCreationsByJobId([creation, ...creations]);
      if (idx === 1) imageGenActiveHistoryId = creation.id;
      persistCreations();
      imageGenFeedTab = 'warehouse';
      document.querySelectorAll('[data-feed-tab]').forEach((b) => {
        b.classList.toggle('active', b.dataset.feedTab === 'warehouse');
      });
      updateImageGenFeedHint();
      window.PointsSystem?.updateCreditsUI?.();
      if (btn) {
        btn.disabled = false;
        restoreImageGenSubmitLabel();
      }
      const publish = idx === 1 && isImageGenGenPublicChecked();
      const saved = await saveGeneratedToWarehouse({
        prompt: creation.prompt,
        image: storedImage || image,
        sourceId: creation.id,
        jobId: slotJobId,
        title: idx > 1
          ? (isMidjourney && (mjSplitSave || isImageGenMjSaveAllTiles()) ? `MJ 图 ${idx}` : `附赠图 ${idx}`)
          : (isMidjourney ? (mjSplitSave || isImageGenMjSaveAllTiles() ? 'MJ 图 1' : 'MJ 四宫格') : ''),
        resolution,
        model: modelId,
        quality: quality || 'standard',
        size: size || '1:1',
        targetGroup: targetGroup || null,
        targetTags: targetTags || null,
        publishToCommunity: publish,
        fromInspirationDraw: !!fromInspirationDraw,
        silentToast: !!silentToast,
        isMidjourney: !!isMidjourney,
        mjGridUrls: cardMjGridUrls,
        mjCompositeUrl: isMidjourney && mjCompositeUrl && idx === 1 ? mjCompositeUrl : null,
        mjButtons: isMidjourney && Array.isArray(mjButtons) && idx === 1 ? mjButtons : null,
        deferCloudPush: !!isMidjourney
      });
      if (pendingId && idx === 1) removePendingJob(pendingId);
      prunePendingJobsWithWarehouseCards();
      renderImageGenFeed({ preserveScroll: true, force: true });
      renderImageGenMobileResult();
      if (saved && window.SupabaseSync?.isLoggedIn?.() && !isMidjourney) {
        queueUrgentCardsSync();
      }
      const whCard = slotJobId
        ? (window.__promptHubCards || []).find((c) => c.genJobId === slotJobId)
        : null;
      if (whCard && warehouseCardImageNeedsRecovery(whCard, image || storedImage)) {
        await repairWarehouseCardImageFromJob(whCard, image || storedImage, slotJobId);
      }
      const backupRef = image || storedImage;
      if (whCard?.id && backupRef && typeof window.saveCardImageBackup === 'function') {
        void window.getCardImageBackup?.(whCard.id).then((existing) => {
          if (!existing) void window.saveCardImageBackup(whCard.id, backupRef);
        });
      }
      if (isRecovery) {
        /* 恢复流程在 recoverRecentGenerationJobs 末尾统一提示 */
      } else if (!silentToast && idx === 1) {
        if (saved) {
          const published = publish && whCard && isCommunityPublishEligible(whCard);
          toast(published
            ? `已生成并保存到仓库（已公开到社区，-${cost} 积分）`
            : `已生成并保存到仓库（-${cost} 积分）`);
        } else {
          toast(`已生成（-${cost} 积分）`);
        }
      }
      const extras = Array.isArray(extraImages)
        ? extraImages.filter((u) => u && u !== image)
        : [];
      if (!isMidjourney) {
        for (let i = 0; i < extras.length; i += 1) {
          await finishImageGenRun({
            prompt,
            model,
            resolution,
            quality,
            size,
            image: extras[i],
            cost,
            btn,
            jobId: baseJobId,
            targetGroup,
            targetTags,
            silentToast: true,
            isRecovery,
            fromInspirationDraw,
            pendingId: null,
            imageIndex: i + 2
          });
        }
      }
      if (baseJobId && idx === 1) clearSessionGenJob(baseJobId);
    } finally {
      if (slotJobId) finishingJobIds.delete(slotJobId);
    }
  }

  function updateImageGenFeedHint() {
    const el = document.getElementById('imageGenFeedHint');
    if (!el) return;
    const mobile = isMobileViewport();
    const warehouse = imageGenFeedTab === 'warehouse';
    if (warehouse) {
      el.textContent = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (imageGenFeedTab === 'community') {
      el.textContent = mobile
        ? '获取 · 点图放大 · 按钮复制或填入生图'
        : '获取 · 点击图片放大 · 点击卡片查看详情';
    }
  }

  function copyFeedPromptText(prompt) {
    const text = (prompt || '').trim();
    if (!text) {
      toast('暂无提示词');
      return;
    }
    navigator.clipboard.writeText(text).then(() => toast('已复制提示词'));
  }

  function getActiveImageGenMode() {
    const fold = document.getElementById('imageGenInspireFold');
    if (fold?.open) return 'inspire';
    return document.body?.dataset?.imagegenMode === 'inspire' ? 'inspire' : 'gen';
  }

  function fillFeedPromptToActiveMode(prompt, opts = {}) {
    const text = String(prompt || '');
    const openInspire = opts.inspire === true;
    fillFormPromptOnly(text);
    if (openInspire) {
      window.ImageGenPromptTools?.openInspireFold?.();
      toast('已填入提示词；已展开灵感抽卡');
    } else {
      toast('已填入提示词');
    }
    if (isMobileViewport()) window.MobileUI?.setImageGenView?.('form');
  }

  function fillFeedPromptToImageGen(prompt) {
    fillFeedPromptToActiveMode(prompt);
  }

  async function fillCardToImageGen(card) {
    if (!card) return;
    if (typeof switchAppPage === 'function') switchAppPage('imagegen');
    fillFormPromptOnly(card.prompt || '');
    const ref = card.image;
    if (ref && isDisplayableImage(ref)) {
      let url = ref;
      try {
        if (window.MediaPipeline?.resolvePreviewUrl) {
          const resolved = await window.MediaPipeline.resolvePreviewUrl(ref, {
            assetId: card.id,
            cardId: card.id,
            jobId: card.genJobId || null
          });
          if (resolved && !String(resolved).includes('data:image/svg')) url = resolved;
        } else if (window.SupabaseSync?.resolveDisplayUrl) {
          const resolved = await window.SupabaseSync.resolveDisplayUrl(ref, { assetId: card.id });
          if (resolved && !String(resolved).includes('data:image/svg')) url = resolved;
        }
      } catch (e) { /* ignore */ }
      fillFormRefOnly(url, [url]);
    }
    if (isMobileViewport()) window.MobileUI?.setImageGenView?.('form');
    toast('已填入生图（提示词与参考图）');
  }



  function failedJobModelLabel(job) {
    if (job.model) return imageGenModelLabel(job.model);
    const lbl = String(job.modelLabel || '').trim();
    if (lbl === '全能模型2' || lbl === 'quanneng2') return 'GPT Image 2';
    return lbl || 'GPT Image 2';
  }

  function renderImageGenMobileResult() {
    /* 手机「最近生成」横条已移除，作品在「作品」Tab 按最近生成排序展示 */
  }



  function clearImageGenFeedSelection() {
    document.querySelectorAll('#imageGenFeed .imagegen-feed-card').forEach((el) => {
      el.classList.remove('active-preview', 'card-selected-bloom', 'card-press-pop');
      el.style.removeProperty('transform');
      el.style.removeProperty('transition');
    });
  }

  function primeImageGenPreviewShell(kind, id) {
    const body = document.getElementById('imageGenPreviewBody');
    if (!body) return;
    const feedKey = kind === 'warehouse' ? 'wh_' + id : id;
    const cardEl = document.querySelector(`#imageGenFeed .imagegen-feed-card[data-feed-id="${feedKey}"]`);
    let prompt = cardEl?.dataset.feedPrompt || '';
    let image = '';
    let instantSrc = '';
    const feedImg = cardEl?.querySelector('.imagegen-feed-media img');
    if (feedImg) {
      image = feedImg.getAttribute('data-image-ref') || '';
      const src = feedImg.currentSrc || feedImg.src || '';
      const path = window.SupabaseSync?.storagePathFromDisplayUrl?.(src) || '';
      const isGridThumb = path && /_grid\.(jpe?g|webp|png)$/i.test(path);
      if (/^https?:\/\//i.test(src) && !src.includes('data:image/svg') && feedImg.naturalWidth > 8 && !isGridThumb) {
        instantSrc = src;
      }
    }
    if (kind === 'warehouse') {
      const c = (window.getWarehouseCardsForImageGen?.() || []).find((x) => x.id === id);
      if (c) {
        prompt = c.prompt || prompt;
        image = c.image || image;
      }
    } else if (kind === 'community') {
      const post = findPost(id);
      if (post) {
        prompt = post.prompt || prompt;
        image = post.image || image;
      }
    }
    const hasRef = !!(image && isDisplayableImage(image));
    const fillHtml = buildPreviewFillActions(hasRef, '');
    const imgHtml = isDisplayableImage(image)
      ? `<div class="imagegen-preview-img-wrap">
          <button type="button" class="imagegen-preview-img-btn" data-preview-zoom title="点击全屏查看大图">
            ${instantSrc
              ? `<img src="${esc(instantSrc)}" alt="" draggable="false" style="cursor:zoom-in">`
              : '<span class="media-skeleton"></span>'}
          </button>
          <button type="button" class="imagegen-preview-dl-btn" data-preview-download title="下载到电脑"${instantSrc ? '' : ' disabled'} aria-label="下载图片">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12m0 0l4-4m-4 4l-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
            <span>下载</span>
          </button>
        </div>`
      : '';
    body.innerHTML = `${imgHtml}<div class="imagegen-preview-prompt">${esc(prompt)}</div>${fillHtml}`;
    body.dataset.previewPrompt = prompt;
    if (instantSrc) {
      body.dataset.previewImageUrl = instantSrc;
      body.dataset.previewImageReady = '1';
    } else {
      delete body.dataset.previewImageUrl;
      delete body.dataset.previewImageReady;
    }
  }

  function closeImageGenPreview() {
    imageGenPreviewRenderSeq += 1;
    imageGenPreviewId = null;
    imageGenPreviewKind = null;
    document.getElementById('imageGenPreviewPanel')?.classList.add('hidden');
    document.querySelector('.imagegen-side')?.classList.remove('imagegen-preview-open');
    clearImageGenFeedSelection();
    if (isMobileViewport()) enforceMobileImageGenFeed();
    else scheduleImageGenFeedLayout({ immediate: true });
  }

  async function downloadImageGenPreviewImage(body, previewKind, previewAssetId, triggerBtn) {
    if (!body || body.dataset.previewImageReady !== '1') {
      toast('图片加载中，请稍后再下载');
      return;
    }
    const url = body.dataset.previewImageUrl || '';
    const img = body.querySelector('.imagegen-preview-img-btn img');
    const dlBtn = triggerBtn || body.querySelector('[data-preview-download]');
    try {
      if (previewKind === 'warehouse' && previewAssetId && typeof window.downloadCardImageFile === 'function') {
        const c = (window.getWarehouseCardsForImageGen?.() || []).find((x) => x.id === previewAssetId);
        if (c?.image) {
          await window.downloadCardImageFile(c.image, c.id, null, {
            triggerBtn: dlBtn
          });
          return;
        }
      }
      if (typeof window.promptHubSaveImage === 'function') {
        await window.promptHubSaveImage(url, `prompt-hub-gen-${Date.now()}.png`, img);
      } else {
        await downloadImageFromUrl(url, `prompt-hub-gen-${Date.now()}.png`);
        return;
      }
      toast('下载完成');
    } catch (e) {
      toast('下载失败，请稍后重试');
      console.warn('[download] preview image failed', e);
    }
  }

  async function downloadImageGenFeedItem(kind, itemId, imgEl, triggerBtn) {
    try {
      if (kind === 'warehouse') {
        const c = (window.getWarehouseCardsForImageGen?.() || []).find((x) => x.id === itemId);
        if (c?.image && typeof window.downloadCardImageFile === 'function') {
          await window.downloadCardImageFile(c.image, c.id, null, {
            triggerBtn
          });
          return;
        }
      } else if (kind === 'community') {
        const post = findPost(itemId);
        if (post?.image) {
          toast('正在准备下载…', 2500);
          const url = await resolveImageDisplayUrl(
            post.image,
            post.jobId || '',
            post.sourceCardId || post.id,
            { fromPublicFeed: true, authorId: post.authorId, preferFull: true }
          );
          if (url) {
            await window.promptHubSaveImage?.(url, `prompt-hub-${itemId}.png`, imgEl);
            toast('下载完成');
            return;
          }
        }
      }
      toast('暂无可下载的图片');
    } catch (e) {
      toast('下载失败，请稍后重试');
      console.warn('[download] feed item failed', e);
    }
  }

  async function downloadImageFromUrl(url, filename) {
    if (!url) {
      toast('图片尚未加载完成');
      return;
    }
    try {
      if (typeof window.promptHubSaveImage === 'function') {
        await window.promptHubSaveImage(url, filename);
      } else {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename || `prompt-hub-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      toast('图片已开始下载');
    } catch (e) {
      toast('下载失败，请稍后重试');
      console.warn('[download] preview image failed', e);
    }
  }

  function buildPreviewFillActions(hasRef, extraActionsHtml) {
    const refDisabled = hasRef ? '' : ' disabled title="暂无参考图"';
    return `
      <div class="imagegen-preview-copy-row">
        <button type="button" class="btn btn-secondary btn-sm" data-preview-copy-prompt>复制提示词</button>
      </div>
      <div class="imagegen-preview-fill">
        <span class="imagegen-preview-fill-label">填入生图框</span>
        <div class="imagegen-preview-fill-btns">
          <button type="button" class="btn btn-primary btn-sm" data-preview-fill-all>全部</button>
          <button type="button" class="btn btn-secondary btn-sm" data-preview-fill-prompt>仅提示词</button>
          <button type="button" class="btn btn-secondary btn-sm" data-preview-fill-ref${refDisabled}>仅参考图</button>
        </div>
      </div>
      ${extraActionsHtml ? `<div class="imagegen-preview-actions-secondary">${extraActionsHtml}</div>` : ''}`;
  }

  /** Feed 卡 data-feed-id 为 wh_ + 卡片 id；恢复卡 id 本身也可能以 wh_ 开头，勿二次 strip */
  function warehouseCardIdFromFeedKey(feedKey) {
    const k = String(feedKey || '');
    return k.startsWith('wh_') ? k.slice(3) : k;
  }

  function findWarehouseCardById(cardId) {
    const id = String(cardId || '').trim();
    if (!id) return null;
    let c = (window.getWarehouseCardsForImageGen?.() || []).find((x) => x.id === id);
    if (c) return c;
    const full = (window.__promptHubCards || []).find((x) => x.id === id);
    if (!full) return null;
    return {
      id: full.id,
      title: (full.title || '').trim(),
      prompt: (full.prompt || '').trim() || (full.title || '').trim(),
      image: full.image || null,
      tags: full.tags || [],
      group: full.group || null,
      genJobId: full.genJobId || null,
      isMidjourney: !!full.isMidjourney,
      mjGridUrls: Array.isArray(full.mjGridUrls) ? full.mjGridUrls : null,
      mjCompositeUrl: full.mjCompositeUrl || null,
      mjButtons: Array.isArray(full.mjButtons) ? full.mjButtons : null
    };
  }

  function fullUrlFromImgEl(imgEl) {
    if (!imgEl) return '';
    const cached = String(imgEl.dataset?.previewFullUrl || imgEl.dataset?.fullUrl || '').trim();
    if (cached && !cached.includes('data:image/svg')) return cached;
    const src = String(imgEl.currentSrc || imgEl.src || '').trim();
    if (!src || src.includes('data:image/svg') || !/^https?:\/\//i.test(src)) return '';
    const path = window.SupabaseSync?.storagePathFromDisplayUrl?.(src) || '';
    if (path && /_grid\.(jpe?g|webp|png)$/i.test(path)) return '';
    if (window.SupabaseSync?.isInvalidMediaUrl?.(src)) return '';
    if (window.SupabaseSync?.isValidSignedDisplayUrl?.(src)) return src;
    if (window.SupabaseSync?.isFreshSignedDisplayUrl?.(src, 120000)) return src;
    return '';
  }

  /** 生图 Feed / 灯箱 / 侧栏：统一拉 full 原图 URL（禁止落 grid 缩略） */
  async function resolveImageGenFullUrl(kind, id, feedKey, imgEl) {
    const instant = fullUrlFromImgEl(imgEl);
    if (instant) return instant;
    const fk = feedKey || (kind === 'warehouse' ? 'wh_' + id : id);
    const assetId = kind === 'warehouse' ? warehouseCardIdFromFeedKey(fk) : id;
    let rawRef = imgEl?.getAttribute?.('data-image-ref') || '';
    let jobId = imgEl?.getAttribute?.('data-job-id') || '';
    let resolveOpts = {};
    if (kind === 'warehouse') {
      const c = findWarehouseCardById(assetId);
      if (c) {
        rawRef = c.image || rawRef;
        jobId = String(c.genJobId || jobId).replace(/#\d+$/, '');
        resolveOpts = window.getCommunityCollectImageResolveOpts?.(c) || {};
      }
    } else {
      const post = findPost(id);
      if (post) {
        rawRef = post.image || rawRef;
        jobId = post.jobId || jobId;
        resolveOpts = {
          fromPublicFeed: true,
          authorId: post.authorId,
          cardId: post.sourceCardId || post.id
        };
      }
    }
    if (!rawRef || !isDisplayableImage(rawRef)) return '';
    const gridFallbackUrl = window.MediaPipeline?.gridUrlFromImgEl?.(imgEl) || '';
    if (window.MediaPipeline?.resolvePreviewUrl) {
      return window.MediaPipeline.resolvePreviewUrl(rawRef, {
        assetId,
        cardId: resolveOpts.cardId || assetId,
        authorId: resolveOpts.authorId,
        communityFeed: resolveOpts.fromPublicFeed === true,
        jobId: jobId || undefined,
        gridFallbackUrl,
        allowGridFallback: true
      });
    }
    if (window.SupabaseSync?.resolvePreviewFullUrl) {
      return window.SupabaseSync.resolvePreviewFullUrl(rawRef, {
        assetId,
        cardId: resolveOpts.cardId || assetId,
        authorId: resolveOpts.authorId,
        communityFeed: resolveOpts.fromPublicFeed === true,
        jobId: jobId || undefined,
        gridFallbackUrl,
        allowGridFallback: true
      });
    }
    return resolveImageDisplayUrl(rawRef, jobId, assetId, {
      ...resolveOpts,
      preferFull: true,
      listOnly: false,
      allowFullFallback: true,
      bypassSignBudget: true,
      cardId: resolveOpts.cardId || assetId
    });
  }

  async function renderImageGenPreview() {
    const body = document.getElementById('imageGenPreviewBody');
    if (!body || !imageGenPreviewId || !imageGenPreviewKind) return;
    const seq = ++imageGenPreviewRenderSeq;
    const previewId = imageGenPreviewId;
    const previewKind = imageGenPreviewKind;
    const previewStale = () =>
      seq !== imageGenPreviewRenderSeq
      || previewId !== imageGenPreviewId
      || previewKind !== imageGenPreviewKind;
    delete body.dataset.previewImageUrl;
    delete body.dataset.previewImageReady;
    let prompt = '';
    let image = '';
    let jobId = '';
    let refImages = null;
    let refImage = null;
    let extraActions = '';
    if (imageGenPreviewKind === 'personal') {
      closeImageGenPreview();
      return;
    } else if (imageGenPreviewKind === 'community') {
      const post = findPost(imageGenPreviewId);
      if (!post) { closeImageGenPreview(); return; }
      prompt = post.prompt || '';
      image = post.image || '';
      const liked = likedIds.has(post.id);
      extraActions = `
        <button type="button" class="btn btn-secondary btn-sm" data-preview-like>${liked ? '已赞' : '点赞'}</button>`;
    } else {
      const c = findWarehouseCardById(imageGenPreviewId);
      if (!c) {
        toast('找不到该卡藏卡片，请强刷页面');
        closeImageGenPreview();
        return;
      }
      prompt = c.prompt || '';
      image = c.image || '';
      jobId = normalizeMjParentJobId(c.genJobId || '');
      if (isDisplayableImage(c.image)) refImage = c.image;
    }
    const previewCard = imageGenPreviewKind === 'warehouse'
      ? ((window.__promptHubCards || []).find((x) => x.id === imageGenPreviewId) || findWarehouseCardById(imageGenPreviewId))
      : null;
    let mjGridUrls = Array.isArray(previewCard?.mjGridUrls) && previewCard.mjGridUrls.length
      ? previewCard.mjGridUrls.filter(Boolean)
      : null;
    const mjParentJobId = normalizeMjParentJobId(jobId || previewCard?.genJobId || '');
    if (!mjGridUrls?.length && mjParentJobId && previewCard?.isMidjourney && window.PromptHubApi?.getGenerationJob) {
      try {
        const poll = await window.PromptHubApi.getGenerationJob(mjParentJobId);
        if (!previewStale() && poll?.ok) {
          const parsed = resolveMjPollImages(poll);
          if (parsed.tiles.length) {
            mjGridUrls = parsed.tiles;
            if (previewCard) {
              await repairMjWarehouseCardFields(previewCard, {
                mjGridUrls: parsed.tiles,
                mjCompositeUrl: parsed.composite,
                mjButtons: poll.data.mjButtons
              });
            }
          }
        }
      } catch (e) {
        console.warn('[imagegen] mj grid fetch failed', mjParentJobId, e);
      }
    }
    if (previewStale()) return;
    const cachedMjButtons = Array.isArray(previewCard?.mjButtons) ? previewCard.mjButtons : null;
    const hasRef = !!(refImages?.length || (refImage && isDisplayableImage(refImage)));
    const fillHtml = buildPreviewFillActions(hasRef, extraActions);
    const mjActionsHtml = cachedMjButtons?.length
      ? buildMjActionsHtml(cachedMjButtons, mjParentJobId)
      : (mjParentJobId ? '<div class="imagegen-mj-actions-host" data-mj-actions-host></div>' : '');
    let imgHtml = '';
    if (mjGridUrls?.length) {
      imgHtml = buildMjGridPreviewHtml(mjGridUrls);
    } else if (isDisplayableImage(image)) {
      imgHtml = `<div class="imagegen-preview-img-wrap">
          <button type="button" class="imagegen-preview-img-btn" data-preview-zoom title="点击全屏查看大图"><span class="media-skeleton"></span></button>
          <button type="button" class="imagegen-preview-dl-btn" data-preview-download title="下载到电脑" disabled aria-label="下载图片">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12m0 0l4-4m-4 4l-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
            <span>下载</span>
          </button>
        </div>`;
    }
    body.innerHTML = `${imgHtml}<div class="imagegen-preview-prompt">${esc(prompt)}</div>${mjActionsHtml}${fillHtml}`;
    body.dataset.previewPrompt = prompt;
    body.dataset.previewJobId = mjParentJobId || '';
    body.dataset.previewRef = refImage || '';
    if (refImages?.length) body.dataset.previewRefs = JSON.stringify(refImages);
    else delete body.dataset.previewRefs;
    const dlPending = body.querySelector('[data-preview-download]');
    if (dlPending) dlPending.disabled = true;
    const zoomBtn = body.querySelector('[data-preview-zoom]');
    if (mjGridUrls?.length) {
      bindMjFilmstripPreview(body, mjGridUrls, {
        feedKey: 'wh_' + previewId,
        cardId: previewId
      });
    } else if (zoomBtn && isDisplayableImage(image)) {
      const previewAssetId = imageGenPreviewKind === 'warehouse' ? imageGenPreviewId : imageGenPreviewId;
      const previewOpts = previewCard ? (window.getCommunityCollectImageResolveOpts?.(previewCard) || {}) : (
        imageGenPreviewKind === 'community' ? (() => {
          const post = findPost(imageGenPreviewId);
          return post ? { fromPublicFeed: true, authorId: post.authorId, cardId: post.sourceCardId || post.id } : {};
        })() : {}
      );

      const mountPreviewImage = (url, { isFull } = {}) => {
        if (previewStale() || !url) return;
        body.dataset.previewImageUrl = url;
        body.dataset.previewImageReady = '1';
        const dlReady = body.querySelector('[data-preview-download]');
        if (dlReady) dlReady.disabled = false;
        let img = zoomBtn.querySelector('img');
        if (!img) {
          img = document.createElement('img');
          img.alt = '';
          img.draggable = false;
          img.style.cursor = 'zoom-in';
          zoomBtn.replaceChildren(img);
        }
        if (img.src !== url) img.src = url;
        if (isFull) img.dataset.previewFullUrl = url;
        else delete img.dataset.previewFullUrl;
        const openPreviewLightbox = () => {
          if (typeof window.openLightbox !== 'function') return;
          const feedKey = previewKind === 'warehouse' ? 'wh_' + previewId : previewId;
          const lbOpts = {
            imageGen: true,
            feedKey,
            community: previewKind === 'community',
            postId: previewKind === 'community' ? previewId : null,
            cardId: previewKind === 'warehouse' ? previewAssetId : null,
            preferFull: true
          };
          const previewImg = zoomBtn.querySelector('img');
          const instant = fullUrlFromImgEl(previewImg);
          if (instant) {
            window.openLightbox(instant, lbOpts);
            return;
          }
          window.openLightbox('', { ...lbOpts, pending: true });
          void resolveImageGenFullUrl(
            previewKind,
            previewId,
            feedKey,
            previewImg
          ).then((fullUrl) => {
            if (!fullUrl || String(fullUrl).startsWith('data:image/svg')) {
              window.closeLightbox?.();
              toast('原图加载中，请稍后再试');
              return;
            }
            window.setLightboxSrc?.(fullUrl, {
              imageGen: true,
              feedKey,
              community: previewKind === 'community',
              postId: previewKind === 'community' ? previewId : null,
              cardId: previewKind === 'warehouse' ? previewAssetId : null,
              preferFull: true
            });
          });
        };
        if (!zoomBtn.dataset.previewZoomBound) {
          zoomBtn.dataset.previewZoomBound = '1';
          zoomBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openPreviewLightbox();
          });
        }
        if (!img.dataset.previewZoomBound) {
          img.dataset.previewZoomBound = '1';
          img.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openPreviewLightbox();
          });
        }
        img.onload = () => {
          if (previewStale()) return;
          if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(zoomBtn);
          if (isFull) {
            if (typeof window.resetImageZoom === 'function') window.resetImageZoom(img);
            if (typeof window.attachImageZoom === 'function') window.attachImageZoom(img);
          }
        };
        if (img.complete && img.naturalWidth > 0) img.onload?.();
      };

      void resolveImageGenFullUrl(
        previewKind,
        previewId,
        previewKind === 'warehouse' ? 'wh_' + previewId : previewId,
        null
      ).then((url) => {
        if (previewStale()) return;
        if (!url) {
          zoomBtn.remove();
          body.querySelector('[data-preview-download]')?.remove();
          return;
        }
        mountPreviewImage(url, { isFull: true });
      });
    } else {
      body.querySelector('[data-preview-download]')?.remove();
    }
    const getPreviewRefs = () => {
      let refs = [];
      try {
        if (body.dataset.previewRefs) refs = JSON.parse(body.dataset.previewRefs) || [];
      } catch (e) { /* ignore */ }
      return { refImages: refs, refImage: body.dataset.previewRef || '' };
    };
    body.querySelector('[data-preview-fill-all]')?.addEventListener('click', () => {
      const { refImages: ri, refImage: r1 } = getPreviewRefs();
      const assetId = imageGenPreviewKind === 'warehouse' ? imageGenPreviewId : '';
      fillFormFromData({
        prompt: body.dataset.previewPrompt || '',
        refImages: ri.length ? ri : undefined,
        refImage: ri.length ? undefined : r1,
        refAssetId: assetId || undefined
      });
    });
    body.querySelector('[data-preview-fill-prompt]')?.addEventListener('click', () => {
      fillFormPromptOnly(body.dataset.previewPrompt || '');
    });
    body.querySelector('[data-preview-fill-ref]')?.addEventListener('click', () => {
      const { refImages: ri, refImage: r1 } = getPreviewRefs();
      const assetId = imageGenPreviewKind === 'warehouse' ? imageGenPreviewId : '';
      fillFormRefOnly(r1, ri, { assetId: assetId || undefined });
    });
    body.querySelector('[data-preview-like]')?.addEventListener('click', () => {
      likeCommunityPostOnly(imageGenPreviewId);
      renderImageGenPreview();
    });
    body.querySelector('[data-preview-copy-prompt]')?.addEventListener('click', () => {
      const text = body.dataset.previewPrompt || '';
      if (!text) return;
      navigator.clipboard?.writeText(text).then(
        () => { if (typeof showToast === 'function') showToast('提示词已复制'); },
        () => { if (typeof showToast === 'function') showToast('复制失败'); }
      );
    });
    body.querySelector('[data-preview-download]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (previewStale()) return;
      const assetId = previewKind === 'warehouse' ? previewId : previewId;
      void downloadImageGenPreviewImage(body, previewKind, assetId, e.currentTarget);
    });
    body.querySelectorAll('[data-mj-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void runImageGenMjAction(btn);
      });
    });
    if (mjParentJobId && !cachedMjButtons?.length) {
      void window.PromptHubApi.getGenerationJob(mjParentJobId).then((r) => {
        if (previewStale() || !r.ok || !Array.isArray(r.data?.mjButtons) || !r.data.mjButtons.length) return;
        const host = body.querySelector('[data-mj-actions-host]');
        if (!host) return;
        host.outerHTML = buildMjActionsHtml(r.data.mjButtons, mjParentJobId);
        if (previewCard) {
          previewCard.mjButtons = r.data.mjButtons;
        }
        body.querySelectorAll('[data-mj-action]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            void runImageGenMjAction(btn);
          });
        });
      });
    }
  }

  function isImageGenFormWheelContext(e) {
    const t = e.target;
    if (t?.closest?.('.imagegen-form, .imagegen-form-scroll, #imageGenPromptBlock, #imageGenInspireFold')) return true;
    const tag = t?.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'INPUT') return true;
    const ae = document.activeElement;
    if (ae?.closest?.('.imagegen-form, .imagegen-form-scroll')) return true;
    return false;
  }

  function isScrollableAtWheel(el, deltaY) {
    if (!el || el.nodeType !== 1) return false;
    const oy = window.getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return false;
    if (el.scrollHeight <= el.clientHeight + 1) return false;
    if (deltaY < 0 && el.scrollTop > 0) return true;
    if (deltaY > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
    return false;
  }

  /** 滚轮应留给表单/可滚动区，勿触发侧栏换图或抢滚动 */
  function shouldBlockImageGenWheelNav(e) {
    if (isImageGenFormWheelContext(e)) return true;
    let node = e.target;
    while (node && node !== document.body) {
      if (isScrollableAtWheel(node, e.deltaY)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function bindImageGenPreviewWheelScroll() {
    const formScroll = document.querySelector('.imagegen-form-scroll');
    if (formScroll && formScroll.dataset.wheelBound !== '1') {
      formScroll.dataset.wheelBound = '1';
      formScroll.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    }

    const side = document.querySelector('.imagegen-side');
    if (!side || side.dataset.previewWheelBound === '1') return;
    side.dataset.previewWheelBound = '1';
    side.addEventListener('wheel', (e) => {
      if (!side.classList.contains('imagegen-preview-open')) return;
      if (shouldBlockImageGenWheelNav(e)) return;
      if (!e.target.closest('#imageGenFeed')) return;
      const feed = document.getElementById('imageGenFeed');
      if (!feed) return;
      const maxScroll = feed.scrollHeight - feed.clientHeight;
      if (maxScroll <= 2) return;
      const next = feed.scrollTop + e.deltaY;
      if (next < 0 || next > maxScroll) return;
      feed.scrollTop = next;
      e.preventDefault();
    }, { passive: false });
  }

  function openImageGenPreview(kind, id) {
    imageGenPreviewKind = kind;
    imageGenPreviewId = id;
    document.getElementById('imageGenPreviewPanel')?.classList.remove('hidden');
    document.querySelector('.imagegen-side')?.classList.add('imagegen-preview-open');
    clearImageGenFeedSelection();
    const feedKey = kind === 'warehouse' ? 'wh_' + id : id;
    document.querySelector(`#imageGenFeed .imagegen-feed-card[data-feed-id="${feedKey}"]`)
      ?.classList.add('active-preview');
    primeImageGenPreviewShell(kind, id);
    if (!isMobileViewport()) scheduleImageGenFeedLayout({ immediate: true });
    void renderImageGenPreview();
  }

  function closeImageGenFilterSheet() {
    const overlay = document.getElementById('imageGenFilterSheetOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.hidden = true;
  }

  function openImageGenFilterSheet(kind) {
    if (!isMobileViewport()) return;
    const opts = window.getImageGenWarehouseFilterOptions?.() || { groups: [], tags: [] };
    const list = kind === 'group' ? opts.groups : opts.tags;
    const current = kind === 'group' ? imageGenWhGroup : imageGenWhTag;
    const titleEl = document.getElementById('imageGenFilterSheetTitle');
    const listEl = document.getElementById('imageGenFilterSheetList');
    const overlay = document.getElementById('imageGenFilterSheetOverlay');
    if (!titleEl || !listEl || !overlay) return;
    titleEl.textContent = kind === 'group' ? '选择分组' : '选择标签';
    listEl.innerHTML = list.map((o) =>
      `<button type="button" class="filter-sheet-row${o.value === current ? ' selected' : ''}" data-value="${esc(o.value)}">
        <span class="filter-sheet-name">${esc(o.label)}</span>
        <span class="filter-sheet-check" aria-hidden="true"></span>
      </button>`
    ).join('');
    listEl.querySelectorAll('.filter-sheet-row').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-value') || 'all';
        if (kind === 'group') imageGenWhGroup = v;
        else imageGenWhTag = v;
        closeImageGenFilterSheet();
        syncImageGenWarehouseFiltersUI();
        renderImageGenFeed();
      });
    });
    overlay.hidden = false;
    overlay.style.removeProperty('display');
    overlay.style.pointerEvents = '';
    overlay.classList.add('open');
  }

  function bindImageGenWarehouseFilterMobileUI() {
    document.getElementById('imageGenWhGroupBtn')?.addEventListener('click', () => openImageGenFilterSheet('group'));
    document.getElementById('imageGenWhTagBtn')?.addEventListener('click', () => openImageGenFilterSheet('tag'));
  }

  function syncImageGenCommunityFiltersUI() {
    const bar = document.getElementById('imageGenCommunityFilters');
    if (!bar) return;
    const show = imageGenFeedTab === 'community';
    bar.classList.toggle('hidden', !show);
    if (!show) return;
    document.querySelectorAll('[data-imagegen-community-sort]').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.imagegenCommunitySort || 'random') === communitySort);
    });
    document.querySelectorAll('[data-imagegen-community-scope]').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.imagegenCommunityScope || 'all') === communityScope);
    });
  }

  function syncImageGenWarehouseFiltersUI() {
    const bar = document.getElementById('imageGenWarehouseFilters');
    const commBar = document.getElementById('imageGenCommunityFilters');
    if (commBar) commBar.classList.toggle('hidden', imageGenFeedTab !== 'community');
    const groupEl = document.getElementById('imageGenWhGroup');
    const tagEl = document.getElementById('imageGenWhTag');
    if (!bar || !groupEl || !tagEl) return;
    const show = imageGenFeedTab === 'warehouse';
    bar.classList.toggle('hidden', !show);
    if (!show) return;
    const opts = window.getImageGenWarehouseFilterOptions?.() || { groups: [], tags: [] };
    const mkOpts = (list, current) => list.map(o =>
      `<option value="${esc(o.value)}"${o.value === current ? ' selected' : ''}>${esc(o.label)}</option>`
    ).join('');
    groupEl.innerHTML = mkOpts(opts.groups, imageGenWhGroup);
    tagEl.innerHTML = mkOpts(opts.tags, imageGenWhTag);
    if (!opts.groups.some(o => o.value === imageGenWhGroup)) imageGenWhGroup = 'all';
    if (!opts.tags.some(o => o.value === imageGenWhTag)) imageGenWhTag = 'all';
    groupEl.value = imageGenWhGroup;
    tagEl.value = imageGenWhTag;
    const gLabel = opts.groups.find((o) => o.value === imageGenWhGroup)?.label || '全部分组';
    const tLabel = opts.tags.find((o) => o.value === imageGenWhTag)?.label || '全部标签';
    const gLabelEl = document.getElementById('imageGenWhGroupLabel');
    const tLabelEl = document.getElementById('imageGenWhTagLabel');
    if (gLabelEl) gLabelEl.textContent = gLabel;
    if (tLabelEl) tLabelEl.textContent = tLabel;
  }


  let imageGenPreviewWheelAt = 0;
  const IMAGEGEN_PREVIEW_WHEEL_GAP_MS = 420;

  function navigateImageGenPreviewByWheel(deltaY) {
    if (!imageGenPreviewId || !imageGenPreviewKind) return false;
    const now = performance.now();
    if (now - imageGenPreviewWheelAt < IMAGEGEN_PREVIEW_WHEEL_GAP_MS) return false;
    const items = getImageGenFeedNavItems();
    if (items.length < 2) return false;
    const currentKey = imageGenPreviewKind === 'warehouse'
      ? 'wh_' + imageGenPreviewId
      : imageGenPreviewId;
    const idx = items.findIndex((it) => it.key === currentKey);
    if (idx < 0) return false;
    const nextIdx = idx + (deltaY > 0 ? 1 : -1);
    if (nextIdx < 0 || nextIdx >= items.length) return false;
    const item = items[nextIdx];
    openImageGenPreview(item.kind, item.id);
    imageGenPreviewWheelAt = now;
    return true;
  }

  async function openImageGenLightboxAt(kind, id, key) {
    const feedKey = key || (kind === 'warehouse' ? 'wh_' + id : id);
    const card = document.querySelector(`.imagegen-feed-card[data-feed-id="${CSS.escape(feedKey)}"]`);
    const imgEl = card?.querySelector('.imagegen-feed-thumb-btn img');
    const assetId = kind === 'warehouse' ? warehouseCardIdFromFeedKey(feedKey) : feedKey;
    let mjGalleryUrls = null;
    if (kind === 'warehouse' && assetId) {
      const full = (window.__promptHubCards || []).find((c) => c.id === assetId);
      if (full?.isMidjourney && Array.isArray(full.mjGridUrls) && full.mjGridUrls.length > 1) {
        mjGalleryUrls = full.mjGridUrls.filter(Boolean).slice(0, 4);
      }
      if (!mjGalleryUrls?.length && full?.genJobId && window.PromptHubApi?.getGenerationJob) {
        try {
          const poll = await window.PromptHubApi.getGenerationJob(normalizeMjParentJobId(full.genJobId));
          if (poll?.ok) {
            const parsed = resolveMjPollImages(poll);
            if (parsed.tiles.length > 1) {
              mjGalleryUrls = parsed.tiles;
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
      cardId: kind === 'warehouse' ? assetId : null,
      preferFull: true,
      mjGalleryUrls: mjGalleryUrls || undefined,
      mjGalleryIndex: startIdx,
      fallbackSrc: window.MediaPipeline?.gridUrlFromImgEl?.(imgEl) || ''
    };
    if (typeof window.openLightbox !== 'function') return;
    if (mjGalleryUrls?.length) {
      window.openLightbox(mjGalleryUrls[startIdx], lbOpts);
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
    if (h < 24) return `约 ${h} 小时后清理`;
    return `约 ${Math.ceil(h / 24)} 天后清理`;
  }

  function bindUI() {
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
        if (document.getElementById('pageImageGen')?.classList.contains('active')) renderImageGenFeed();
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
        if (document.getElementById('pageImageGen')?.classList.contains('active')) renderImageGenFeed();
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
        toast('生图提交异常，请刷新页面后重试');
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
        renderImageGenFeed({ scrollToTop: true });
      });
    });
    document.querySelectorAll('[data-imagegen-community-sort]').forEach(btn => {
      btn.addEventListener('click', () => {
        applyCommunitySort(btn.dataset.imagegenCommunitySort);
        document.querySelectorAll('[data-imagegen-community-sort]').forEach(b => b.classList.toggle('active', b === btn));
        renderImageGenFeed();
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
          renderImageGenFeed();
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
        renderImageGenFeed();
        if (document.getElementById('pageCommunity')?.classList.contains('active')) {
          renderCommunity({ immediate: true, skipFeedFetch: true, forceRepaint: true });
        }
      });
    });
    document.getElementById('imageGenPreviewClose')?.addEventListener('click', closeImageGenPreview);
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
      renderImageGenFeed();
    });
    document.getElementById('imageGenWhTag')?.addEventListener('change', e => {
      imageGenWhTag = e.target.value || 'all';
      renderImageGenFeed();
    });
    bindImageGenWarehouseFilterMobileUI();
    bindImageGenUpload();
    bindImageGenPromptTools();
    document.getElementById('imageGenRecoverBtn')?.remove();
    document.getElementById('imageGenCount')?.addEventListener('change', updateImageGenCostHint);
    document.getElementById('imageGenModel')?.addEventListener('change', () => {
      syncImageGenModelParamsUI();
      syncImageGenModelHint();
      updateImageGenResolutionSelect();
      updateImageGenSizeSelect();
      updateImageGenPricingUI();
    });
    document.querySelectorAll('[data-mj-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mjMode;
        if (!mode) return;
        setImageGenMjMode(mode);
      });
    });
    document.getElementById('imageGenMjSaveAllTiles')?.addEventListener('change', persistImageGenMjPrefs);
    document.querySelectorAll('input[name="imageGenMjSpeed"]').forEach((input) => {
      input.addEventListener('change', persistImageGenMjPrefs);
    });
    document.getElementById('imageGenResolution')?.addEventListener('input', updateImageGenCostHint);
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
          const feedFresh = !publicFeedNeedsFullRefresh() && publicFeedPosts.length > 0;
          if (hasRealCards && grid?.dataset.feedSig && feedFresh) {
            patchFeedLikeLabels(grid, filterAndSortPosts(getCommunityFeedForDisplay()));
            scheduleCommunityLayout('communityGrid', { force: true, immediate: true, recalcCols: true });
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
            if (publicFeedNeedsFullRefresh() && !publicFeedLoading) {
              if (grid && !hasRealCards) showCommunityFeedSkeleton(grid, 8);
              void refreshPublicCommunityFeed({ force: true, timeoutMs: 20000 }).then(async () => {
                if (seq !== communityOnActivateSeq) return;
                if (shouldPreserveCommunityFeedDom('communityGrid') && grid?.querySelector('.community-post-card:not(.community-feed-skeleton)')) {
                  await growCommunityFeedAfterPublicRefresh('communityGrid');
                  return;
                }
                renderCommunity({ immediate: true, skipFeedFetch: true, forceRepaint: true });
                await growCommunityFeedAfterPublicRefresh('communityGrid');
              });
            } else if (!publicFeedLoading) {
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
      if (imageGenPendingJobs.length > 0 || activePollJobIds.size > 0) {
        scheduleGenJobsSync(400);
      }
    }
    if (app === 'imagegen') {
      void prefetchImageGenModelCatalog();
      if (!document.getElementById('pageImageGen')?.classList.contains('active')) return;
      imageGenGenPublicSession = null;
      syncImageGenGenPublicUI();
      window.MobileUI?.initImageGenMobileView?.();
      pruneCreations();
      initImageGenForm();
      updateImageGenFeedHint();
      setTimeout(() => void resumePendingGenerationJobs({ force: true }), 400);
      scheduleGenJobsSync(1500);
      renderImageGenFeed({ preserveScroll: true, force: true });
      renderImageGenMobileResult();
      void window.PointsSystem?.refreshCreditsFromServer?.();
      window.PointsSystem?.updateCreditsUI?.();
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
      if (feedGrid && !useCommunityCssGrid(feedGrid.id)) {
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
    onAppChange(localStorage.getItem('promptrepo_app_page') || 'community');
  }

  function refreshImageGenCost() {
    updateImageGenCostHint();
  }

  function getCloudSlice() {
    return {
      communityPosts: communityPosts.filter(p => !p.isMock),
      creations: filterCreationsForCloud(creations),
      communityLikes: [...likedIds],
      communityFavorites: [...favIds],
      follows: [...follows],
      communityEvents,
      notifications
    };
  }

  function applyCloudSlice(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (Array.isArray(payload.communityPosts)) {
      const normalizePost = (p) => {
        if (!p?.image || !window.SupabaseSync?.normalizeImageRef) return p;
        return { ...p, image: window.SupabaseSync.normalizeImageRef(p.image) };
      };
      const cloudPosts = payload.communityPosts.filter((p) => !p.isMock).map(normalizePost);
      const localPosts = communityPosts.filter((p) => !p.isMock);
      communityPosts = window.CloudSyncSafety?.mergeCommunityPostsList
        ? window.CloudSyncSafety.mergeCommunityPostsList(localPosts, cloudPosts)
        : (cloudPosts.length ? cloudPosts : localPosts);
      dedupeCommunityPosts({ persist: false });
      migrateCommunityAuthorIds();
      pruneOrphanFeatureData();
      if (window.__promptHubCards?.length) {
        reconcileCommunityWithCards(window.__promptHubCards);
      }
      pruneOwnStaleCommunityPostsFromCloud();
      pruneLocalCommunityNotOnServer();
      pruneOrphanFeatureData();
      saveJson(LS_COMMUNITY, communityPosts);
    }
    if (Array.isArray(payload.creations)) {
      const tomb = window.getDeletedCreationTombstones?.() || {};
      const normalizeCre = (c) => {
        if (!c?.image || !window.SupabaseSync?.normalizeImageRef) return c;
        return { ...c, image: window.SupabaseSync.normalizeImageRef(c.image) };
      };
      const cloudCreations = payload.creations
        .filter((c) => c && c.id != null && !tomb[String(c.id)])
        .filter((c) => !c.jobId || !isGenerationJobDeleted(c.jobId))
        .map(normalizeCre);
      const localCreations = filterCreationsForCloud(creations);
      const mergedCreations = window.CloudSyncSafety?.mergeCreationsList
        ? window.CloudSyncSafety.mergeCreationsList(localCreations, cloudCreations, tomb)
        : (cloudCreations.length ? cloudCreations : localCreations);
      creations = dedupeCreationsByJobId(mergedCreations);
      pruneCreations();
      saveJson(LS_CREATIONS, creations);
    }
    if (Array.isArray(payload.communityLikes)) {
      likedIds = new Set(payload.communityLikes);
      saveJson(LS_LIKES, [...likedIds]);
    }
    if (Array.isArray(payload.communityFavorites)) {
      favIds = new Set(payload.communityFavorites);
      saveJson(LS_FAVS, [...favIds]);
    }
    if (Array.isArray(payload.follows)) {
      follows = new Set(payload.follows.map(String));
      persistFollows();
    }
    if (Array.isArray(payload.communityEvents)) {
      communityEvents = payload.communityEvents.slice(-200);
      ingestCommunityEvents(communityEvents);
    }
    if (Array.isArray(payload.notifications)) {
      mergeNotifications(payload.notifications);
    }
    if (document.getElementById('pageCommunity')?.classList.contains('active')) {
      if (communityFeedNeedsRerender('communityGrid')) {
        renderCommunity({ skipFeedFetch: true });
      } else {
        const container = document.getElementById('communityGrid');
        const list = filterAndSortPosts(getCommunityFeedForDisplay());
        if (container) patchFeedLikeLabels(container, list);
      }
    }
    if (document.getElementById('pageCreations')?.classList.contains('active')) {
      const container = document.getElementById('creationsGrid');
      const list = getMyPublishedPosts();
      const sig = feedListSignature(list, 'creationsGrid');
      if (container?.dataset.feedSig === sig && container.querySelector('.community-post-card')) {
        patchFeedLikeLabels(container, list);
      } else if (communityFeedNeedsRerender('creationsGrid')) {
        renderCreations();
      }
    }
    updateNotifyBadge();
  }

  async function rebuildCommunityFeedFromApi() {
    try { localStorage.removeItem(LS_PUBLIC_FEED_CACHE); } catch (e) { /* ignore */ }
    if (window.PromptHubApi?.prepareApiCall) await window.PromptHubApi.prepareApiCall();
    else window.__PH_API_DOWN_UNTIL__ = 0;
    publicFeedAt = 0;
    publicFeedPosts = [];
    publicFeedApiOffset = 0;
    publicFeedNextApiOffset = 0;
    publicFeedRemoteHasMore = true;
    resetCommunityFeedGrid('communityGrid');
    const fetched = await fetchAllPublicCommunityFeedPages(28000);
    if (!fetched?.length) {
      return { ok: false, reason: 'feed_fetch_empty', ...getCommunityFeedPagedDebug('communityGrid') };
    }
    publicFeedPosts = fetched;
    publicFeedAt = Date.now();
    publicFeedApiOffset = publicFeedNextApiOffset;
    publicFeedRemoteHasMore = false;
    savePublicFeedCache(publicFeedPosts);
    const list = filterAndSortPosts(getCommunityFeedForDisplay()).filter(isFeedRenderablePost);
    await renderPostsIntoContainer(list, 'communityGrid');
    await drainCommunityFeedPagesUntilDone('communityGrid');
    finishCommunityFeedLayoutAfterBatch('communityGrid');
    const grid = document.getElementById('communityGrid');
    if (grid) {
      window.__PH_FEED_BULK_DRAIN__ = true;
      try {
        await softHydrateFeedContainer(grid);
      } finally {
        window.__PH_FEED_BULK_DRAIN__ = false;
      }
      finishCommunityFeedLayoutAfterBatch('communityGrid');
    }
    return { ok: true, ...getCommunityFeedPagedDebug('communityGrid') };
  }

  function getCommunityFeedPagedDebug(containerId = 'communityGrid') {
    const store = feedPagedStore[containerId];
    const g = document.getElementById(containerId);
    const scrollEl = g ? (getFeedScrollRoot(g) || g) : null;
    return {
      build: window.__APP_BUILD__,
      cards: g?.querySelectorAll('.card').length || 0,
      uniqueDomPosts: getCommunityFeedRenderedPostIds(containerId).size,
      dupDomPosts: Math.max(0, (g?.querySelectorAll('.card[data-post-id]').length || 0) - getCommunityFeedRenderedPostIds(containerId).size),
      zeroCards: g ? [...g.querySelectorAll('.card')].filter((c) => c.offsetHeight < 8).length : 0,
      storeTotal: store?.posts?.length || 0,
      page: store?.page || 0,
      apiOffset: publicFeedApiOffset,
      apiNextOffset: publicFeedNextApiOffset,
      publicRemoteHasMore: publicFeedRemoteHasMore,
      publicPosts: publicFeedPosts.length,
      renderableTotal: filterAndSortPosts(getCommunityFeedForDisplay()).filter(isFeedRenderablePost).length,
      remoteExhausted: !!store?.remoteExhausted,
      canLoadMoreLocal: store ? getPendingFeedPosts(store, containerId, 1).length > 0 : false,
      pendingDom: store ? Math.max(0, store.posts.length - getCommunityFeedRenderedPostIds(containerId).size) : 0,
      drainComplete: feedDrainComplete(containerId),
      scrollTop: scrollEl?.scrollTop,
      scrollHeight: scrollEl?.scrollHeight,
      clientHeight: scrollEl?.clientHeight
    };
  }

  function forceRefreshAllImages() {
    const box = document.getElementById('cardsContainer');
    if (box && window.CardImageLoader) {
      window.CardImageLoader.patchVisibleFromCache(box);
    }
    ['communityGrid', 'creationsGrid', 'userProfileGrid', 'imageGenFeed'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      window.MediaPipeline?.patchContainerFromCache?.(el);
      if (id === 'imageGenFeed') scheduleImageGenFeedLayout();
      else if (id === 'communityGrid' || id === 'creationsGrid') {
        if (isMobileViewport()) enforceMobileCommunityFeedGrid(id);
        else {
          scrubCommunityFeedFlexCards(el);
          if (id === 'communityGrid') window.FeedLayout?.repairCommunityMasonry?.(id);
          repairCommunityFeedLayout(id);
        }
      } else layoutCommunityMasonry(id);
    });
  }

  wireFeedImages();
  wireImageGenFeed();
  wireFeedLayout();

  window.FeatureDraft = {
    init,
    onAppChange,
    cancelCommunityPageWork,
    activateCommunityPage,
    clearSensitiveLocalStateOnSignOut,
    clearAllLocalFeatureData,
    reloadStores,
    refreshImageGenCost,
    refreshImageGenModelCatalog,
    warmImageGenModelCatalog,
    prefetchImageGenModelCatalog,
    scheduleDeferredImageGenModelCatalogRefresh,
    syncCardToCommunity,
    removeCommunityByCardId,
    unpublishCommunityByCardId,
    isCommunityPublishEligible,
    isGeneratedWarehouseCard,
    readPublishCheckbox,
    setPublishCheckbox,
    syncCardPublishFromPrompt,
    getCloudSlice,
    applyCloudSlice,
    reconcileCommunityWithCards,
    maybeReconcileCommunityWithCards,
    invalidateCommunityReconcileCache,
    materializeCommunityFromCards,
    syncEligibleCardsToCommunity,
    runSyncCardLibraryToCommunity,
    inspectCardLibraryPublishGap,
    markAllEligibleCardsPublished,
    restoreCardsFromCommunityFeed,
    refreshFeedsAfterCardsSync,
    ensureCommunityFromCards,
    refreshPublicCommunityFeed,
    restorePublishedFlagsFromFeed,
    applyCardPublishState,
    clearPublishDraft,
    toggleMyPublishedPostVisibility,
    syncPublishToggleForOpenCard,
    syncMyPostsToPublicFeed,
    renderCommunity,
    getCommunityFeedForDisplay,
    getCommunityFeedPagedDebug,
    rebuildCommunityFeedFromApi,
    drainCommunityFeedPagesUntilDone,
    findPost,
    toggleCommunityAppreciate,
    exitCommunityAppreciate,
    isCommunityQuickPreviewActive,
    onAppreciateViewerClose,
    bumpAppreciateViewerGen,
    openCommunityAppreciateViewer,
    openCommunityAppreciateById,
    openCommunitySidePanel,
    isPostFavorited,
    pruneOrphanFeatureData,
    purgeGhostCommunityData,
    imageGenFeedSignOpts,
    hydrateFeedImages,
    resetMobileFeedGridStyles,
    enforceMobileImageGenFeed,
    enforceMobileCommunityFeedGrid,
    closeImageGenFilterSheet,
    renderImageGenFeed,
    renderImageGenMobileResult,
    prunePendingGenJobsFromWarehouse: () => {
      prunePendingJobsWithWarehouseCards();
      if (document.getElementById('pageImageGen')?.classList.contains('active')) {
        renderImageGenFeed({ preserveScroll: true });
      }
    },
    canonicalCommunityImageRef,
    communityPostDisplayImageRef,
    isCommunityCollectCard,
    COMMUNITY_COLLECT_TAG,
    isDisplayableImage,
    isUsableWarehouseImage,
    getWarehouseCardKind,
    removeBrokenCommunityFeedCard,
    pruneEmptyCommunityFeedCards,
    scheduleLayout: scheduleCommunityLayout,
    scheduleCommunityLayout,
    repairCreationsFeedLayout,
    repairCommunityFeedLayout,
    syncCommunityFeedColumnCount,
    scrubCommunityFeedFlexCards,
    scheduleCommunityFeedHeightBalance,
    scheduleCommunityMasonryRelayout,
    scheduleFeedMasonryRelayout,
    layoutCommunityMasonry,
    layoutFeedFlexColumns,
    getFeedLayoutMode,
    relayoutCommunityFeeds,
    onCardDeletedForGen,
    recoverRecentGenerationJobs,
    recoverLostGenerationsFromApi,
    repairMissingGenCardImagesQuiet,
    resumePendingGenerationJobs,
    scheduleGenJobsSync,
    renderCreations,
    renderMyHomeProfile,
    onDisplayNameChanged,
    scheduleCreationsLayout: () => scheduleCommunityLayout('creationsGrid'),
    fillFormPromptOnly,
    copyFeedPromptText,
    fillFeedPromptToImageGen,
    fillFeedPromptToActiveMode,
    getActiveImageGenMode,
    fillCardToImageGen,
    getImageGenFeedNavItems,
    openImageGenLightboxAt,
    resolveImageGenFullUrl,
    runImageGenWithPrompt,
    recordImageGenFailure: addFailedGenJob,
    getImageGenRefImages: () => [...imageGenRefImages],
    refreshImageGenSaveTargetSelects: updateImageGenSaveTargetSelects,
    resolveRefDisplayUrl,
    updateNotifyBadge,
    getCommunityPostsForTasks() {
      return communityPosts
        .filter(p => !p.isMock)
        .map(p => ({
          prompt: p.prompt || '',
          title: p.title || '',
          image: p.image || null
        }));
    }
  };

  window.recoverLostGenerationsFromApi = recoverLostGenerationsFromApi;
  window.forceRefreshAllImages = forceRefreshAllImages;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

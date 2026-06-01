/**
 * 提示词社区 / 我的创作 / 图片生成 — 功能草案
 */
(function () {
  const LS_COMMUNITY = 'promptrepo_community_posts';
  const LS_CREATIONS = 'promptrepo_creations';
  const LS_LIKES = 'promptrepo_community_likes';
  const LS_FAVS = 'promptrepo_community_favorites';
  const LS_IMAGEGEN = 'promptrepo_imagegen_draft';
  const LS_SESSION_GEN_JOBS = 'promptrepo_session_gen_jobs';
  const LS_PENDING_GEN_JOBS = 'promptrepo_pending_gen_jobs';
  const LS_FAILED_GEN_JOBS = 'promptrepo_failed_gen_jobs';
  const PREFILL_KEY = 'promptrepo_imagegen_prefill';

  const GEN_RETENTION_MIN_MS = 1 * 24 * 60 * 60 * 1000;
  const GEN_RETENTION_MAX_MS = 3 * 24 * 60 * 60 * 1000;
  const MIN_COMMUNITY_PROMPT_LEN = 15;
  const IMAGEGEN_WH_FEED_MAX = 48;

  function randomGenRetentionMs() {
    return GEN_RETENTION_MIN_MS + Math.floor(Math.random() * (GEN_RETENTION_MAX_MS - GEN_RETENTION_MIN_MS + 1));
  }

  const finishingJobIds = new Set();

  function isGenerationJobDeleted(jobId) {
    if (!jobId) return false;
    const t = window.getDeletedGenerationJobTombstones?.() || {};
    return !!t[String(jobId)];
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
  let communityMasonry = null;
  let profileMasonry = null;
  let creationsMasonry = null;
  let communitySidePostId = null;
  let creationsSideId = null;
  let communityAppreciateActive = false;
  let appreciateViewerPostId = null;
  let appreciateViewerGen = 0;
  let imageGenPreviewId = null;
  let imageGenPreviewKind = null;
  let layoutCommunityTimer = null;
  let communityFeedRenderGen = 0;
  let imageGenLayoutTimer = null;
  const displayUrlCache = new Map();
  let publicFeedAt = 0;
  let publicFeedLoading = false;
  let communityPostsSyncInflight = null;
  let lastCommunityPostsSyncAt = 0;
  const COMMUNITY_POSTS_SYNC_GAP_MS = 120000;
  const PUBLIC_FEED_TTL_MS = 120_000;
  const PUBLIC_FEED_CACHE_VERSION = 2;
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

  function isUsableCommunityImage(image) {
    if (!image || !isDisplayableImage(image)) return false;
    if (window.SupabaseSync?.isInvalidMediaUrl?.(image)) return false;
    const path = window.SupabaseSync?.storagePathFromRef?.(image);
    if (path && window.SupabaseSync?.isPathKnownMissing?.(path)) return false;
    return true;
  }

  /** 公开社区图：优先卡片库真实路径，忽略无效的 api 域名直链 */
  function canonicalCommunityImageRef(post) {
    if (!post) return null;
    const cardImg = cardImageForPost(post);
    let image = (cardImg && isUsableCommunityImage(cardImg)) ? cardImg : (post.image || null);
    if (image && window.SupabaseSync?.normalizeImageRef) {
      image = window.SupabaseSync.normalizeImageRef(image) || image;
    }
    if (image && !isUsableCommunityImage(image)) return null;
    return image;
  }

  /** 社区展示用图：与 isFeedRenderablePost / 渲染卡片保持一致，避免「有图却显示无配图」 */
  function communityPostDisplayImageRef(post) {
    const canonical = canonicalCommunityImageRef(post);
    if (canonical && isDisplayableImage(canonical)) return canonical;
    const raw = post?.image;
    if (!raw || !isDisplayableImage(raw)) return null;
    if (window.SupabaseSync?.isInvalidMediaUrl?.(raw)) return null;
    if (window.SupabaseSync?.normalizeImageRef) {
      return window.SupabaseSync.normalizeImageRef(raw) || raw;
    }
    return raw;
  }

  function feedAssetIdFromImg(img) {
    const card = img?.closest?.('.card');
    if (!card) return undefined;
    return card.dataset?.sourceCardId
      || card.dataset?.id
      || card.dataset?.postId
      || card.dataset?.creationId
      || card.closest('[data-feed-id]')?.dataset?.feedId?.replace(/^wh_/, '')
      || undefined;
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

  async function refreshPublicCommunityFeed(opts = {}) {
    if (!window.PromptHubApi?.getCommunityFeed) return false;
    if (publicFeedLoading) return false;
    const loggedIn = window.SupabaseSync?.isLoggedIn?.();
    if (
      !opts.force
      && loggedIn
      && publicFeedAt > 0
      && Date.now() - publicFeedAt < PUBLIC_FEED_TTL_MS
      && publicFeedPosts.length > 0
    ) {
      return false;
    }
    publicFeedLoading = true;
    const prevPubSig = publicFeedPosts.map((p) => `${p.id}:${p.updatedAt || 0}`).join('|');
    try {
      const r = await window.PromptHubApi.getCommunityFeed({ limit: 200, timeoutMs: opts.timeoutMs || 15000 });
      if (!r?.ok || !Array.isArray(r.data?.posts)) {
        const cached = loadPublicFeedCache();
        if (cached?.posts?.length) {
          const cachedSig = cached.posts.map((p) => `${p.id}:${p.updatedAt || 0}`).join('|');
          if (cachedSig !== prevPubSig) {
            publicFeedPosts = cached.posts.map(normalizeFeedPost).filter(Boolean);
            publicFeedAt = cached.cachedAt || Date.now();
            return true;
          }
          return false;
        }
        return false;
      }
      publicFeedPosts = r.data.posts.map(normalizeFeedPost).filter(Boolean);
      publicFeedAt = Date.now();
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
      const cached = loadPublicFeedCache();
      if (cached?.posts?.length) {
        const cachedSig = cached.posts.map((p) => `${p.id}:${p.updatedAt || 0}`).join('|');
        if (cachedSig === prevPubSig) return false;
        publicFeedPosts = cached.posts.map(normalizeFeedPost).filter(Boolean);
        publicFeedAt = cached.cachedAt || Date.now();
        return true;
      }
      return false;
    } finally {
      publicFeedLoading = false;
    }
  }

  async function syncMyPostsToPublicFeed() {
    if (!window.SupabaseSync?.isLoggedIn?.() || !window.PromptHubApi?.syncCommunityPostsBatch) return 0;
    if (window.PromptHubApi?.isApiUnreachable?.() || window.PromptHubApi?.isApiRateLimited?.()) return 0;
    if (Date.now() - lastCommunityPostsSyncAt < COMMUNITY_POSTS_SYNC_GAP_MS) return 0;
    if (communityPostsSyncInflight) return communityPostsSyncInflight;
    communityPostsSyncInflight = (async () => {
      const mine = collectMyCommunityPostsForSync();
      for (const p of mine) {
        if (p.sourceCardId && window.SupabaseSync?.repairCardImageIfMissing) {
          try {
            const repaired = await window.SupabaseSync.repairCardImageIfMissing(p.sourceCardId, p.image);
            if (repaired) p.image = repaired;
          } catch (e) { /* ignore */ }
        }
      }
      if (mine.length) {
        communityPosts = mergePostsLists(communityPosts, mine);
        persistCommunity();
      }
      try {
        const r = await window.PromptHubApi.syncCommunityPostsBatch(mine.map(postForPublicApi));
        if (r?.ok) {
          lastCommunityPostsSyncAt = Date.now();
          return mine.length;
        }
        if (r?.status === 429 || r?.code === 'RATE_LIMITED') {
          lastCommunityPostsSyncAt = Date.now() - COMMUNITY_POSTS_SYNC_GAP_MS + 300000;
        }
        console.warn('[community] sync public posts failed', r);
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
    if (typeof showToast === 'function') showToast(msg, durationMs);
    else alert(msg);
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
      refImages: compactRefsForDraft(meta.refImages),
      refImage: compactRefsForDraft([meta.refImage])[0] || null,
      resolution: meta.resolution,
      quality: meta.quality,
      size: meta.size,
      count: meta.count
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
    return Math.min(5, Math.max(1, Number(getComputedStyle(document.documentElement).getPropertyValue('--card-columns')) || 4));
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

  /** 社区/我发布 Masonry：与卡片库同一套列宽与间距算法 */
  function getCommunityFeedGaps() {
    const gap = getMasonryGap();
    const rowRaw = getComputedStyle(document.documentElement).getPropertyValue('--card-row-gap').trim();
    const rowGap = Number.parseFloat(rowRaw) || gap;
    return { colGap: gap, rowGap };
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
    if (communityMasonry) {
      communityMasonry.destroy();
      communityMasonry = null;
    }
    if (creationsMasonry) {
      creationsMasonry.destroy();
      creationsMasonry = null;
    }
    if (profileMasonry) {
      profileMasonry.destroy();
      profileMasonry = null;
    }
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
    scheduleGenJobsSync(600);
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
      window.scheduleCloudPush?.();
    }
  }

  function persistCreations() {
    saveJson(LS_CREATIONS, creations);
    if (window.SupabaseSync?.isLoggedIn?.()) {
      window.scheduleCloudPush?.();
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
    const ref = communityPostDisplayImageRef(p);
    return !!(ref && isDisplayableImage(ref));
  }

  /** 社区 Grid / 生图侧栏展示：以全站 API 为准；自己的帖须卡片仍勾选「发布到社区」 */
  function getCommunityFeedForDisplay() {
    const user = getActiveUser();
    const pub = filterFeedPostsForPublishFlags(
      filterCommunityPostsForDisplay(publicFeedPosts, {
        skipCardTombstones: true,
        skipPostTombstones: true
      })
    ).filter(isFeedRenderablePost);
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
    return enrichPostsWithPublicFeedImages(
      filterCommunityPostsForDisplay(
        mergePostsLists(pub, pending),
        { skipCardTombstones: true, skipPostTombstones: true }
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
      if (window.SupabaseSync?.isLoggedIn?.()) window.scheduleCloudPush?.();
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
      if (window.__promptHubCards?.length) {
        ensureCommunityFromCards();
      }
      const onCommunity = document.getElementById('pageCommunity')?.classList.contains('active');
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
    }, 800);
  }

  function featureImgSrc(image) {
    if (!image) return '';
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

  async function resolveImageDisplayUrl(image, jobId, assetId, opts = {}) {
    if (!image) return '';
    if (window.SupabaseSync?.normalizeImageRef) {
      image = window.SupabaseSync.normalizeImageRef(image) || image;
    }
    const publicFeed = opts.fromPublicFeed === true;
    const authorId = opts.authorId || '';
    const cardId = opts.cardId || assetId || '';
    const cacheKey = (publicFeed ? 'pub:' : '') + (jobId ? `job:${jobId}` : (assetId ? `${assetId}:${image}` : image));
    if (!publicFeed) {
      const hit = displayUrlCache.get(cacheKey);
      if (hit) return hit;
    }
    let url = '';
    if (!publicFeed) {
      const cached = window.SupabaseSync?.getCachedDisplayUrl?.(image, { assetId, variant: 'grid' });
      if (cached && /^https?:\/\//i.test(cached) && !cached.includes('/object/public/')) url = cached;
    }
    const isStorageLike = window.SupabaseSync?.isStorageRef?.(image) || String(image).startsWith('storage://');
    if (!url && window.SupabaseSync?.resolveDisplayUrl && isStorageLike) {
      try {
        const communityFeed = opts.fromPublicFeed === true;
        url = await window.SupabaseSync.resolveDisplayUrl(image, {
          assetId,
          authorId: authorId || undefined,
          cardId: cardId || undefined,
          variant: 'grid',
          communityFeed,
          tryAllPaths: communityFeed
        });
      } catch (e) {
        console.warn('resolve image failed', e);
      }
    }
    if (!url && jobId && window.PromptHubApi?.getGenerationImageUrl) {
      const r = await window.PromptHubApi.getGenerationImageUrl(jobId);
      if (r.ok && r.data?.url) url = r.data.url;
    }
    if (!url && window.SupabaseSync?.resolveDisplayUrl) {
      try {
        url = await window.SupabaseSync.resolveDisplayUrl(image, {
          assetId,
          authorId: authorId || undefined,
          cardId: cardId || undefined,
          communityFeed: opts.fromPublicFeed === true,
          tryAllPaths: opts.fromPublicFeed === true
        });
      } catch (e) {
        console.warn('resolve image failed', e);
      }
    }
    if (!url && typeof image === 'string' && /^https?:\/\//i.test(image)) {
      const isPrivateBucket = /\/storage\/v1\/object\/(public|sign|authenticated)\/card-images\//i.test(image);
      if (!isPrivateBucket) url = image;
    }
    if (url && !url.startsWith('storage://') && !url.startsWith('data:image/svg')
      && (!window.SupabaseSync?.isValidSignedDisplayUrl || window.SupabaseSync.isValidSignedDisplayUrl(url))) {
      displayUrlCache.set(cacheKey, url);
    }
    return url || '';
  }

  const IMG_LOADING_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect fill="%2318181c" width="16" height="16"/></svg>'
  );

  function bindFeedImgErrorFallback(img) {
    if (!img || img.dataset.feedImgErrBound) return;
    img.dataset.feedImgErrBound = '1';
    img.addEventListener('error', () => {
      if (img.dataset.feedImgRetry === '1') return;
      img.dataset.feedImgRetry = '1';
      const ref = img.getAttribute('data-image-ref');
      const jobId = img.getAttribute('data-job-id') || '';
      if (!ref) return;
      void resolveImageDisplayUrl(ref, jobId || null, feedAssetIdFromImg(img), communityImageSignOpts(img)).then((url) => {
        if (url && !url.startsWith('storage://')) {
          img.src = url;
          img.classList.remove('img-load-failed');
          return;
        }
        img.src = IMG_LOADING_PLACEHOLDER;
      });
    });
  }

  async function applyFeedImageSrc(img, ref, jobId) {
    const feedMedia = img.closest('.imagegen-feed-media');
    const cardMedia = img.closest('.card-media');
    if (!ref || !isDisplayableImage(ref)) return false;
    bindFeedImgErrorFallback(img);
    const assetId = feedAssetIdFromImg(img);
    const signOpts = communityImageSignOpts(img);
    const fromPublicFeed = signOpts.fromPublicFeed;
    let url = fromPublicFeed
      ? ''
      : (displayUrlCache.get(jobId ? `job:${jobId}` : (assetId ? `${assetId}:${ref}` : ref)) || '');
    if (!url && !fromPublicFeed) {
      const cached = window.SupabaseSync?.getCachedDisplayUrl?.(ref, { assetId, variant: 'grid' });
      if (cached && typeof cached === 'string' && !cached.startsWith('storage://') && !cached.startsWith('data:image/svg') && !cached.includes('/object/public/')) {
        url = cached;
      }
    }
    if (!url) url = await resolveImageDisplayUrl(ref, jobId || null, assetId, {
      ...signOpts,
      cardId: signOpts.cardId || assetId
    });
    if (!url || url.startsWith('storage://') || url.startsWith('data:image/svg')) {
      feedMedia?.classList.add('is-loading');
      feedMedia?.classList.remove('card-media--missing', 'card-media--load-failed');
      return false;
    }
    const endLoad = () => {
      const media = img.closest('.imagegen-feed-media, .card-media');
      if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(media);
      else media?.classList.remove('is-loading');
    };
    const tryFullFallback = () => {
      if (img.dataset.imgFallback === '1' || !window.SupabaseSync?.resolveDisplayUrl) {
        cardMedia?.classList.add('card-media--load-failed');
        endLoad();
        return;
      }
      img.dataset.imgFallback = '1';
      const signOpts = communityImageSignOpts(img);
      void window.SupabaseSync.resolveDisplayUrl(ref, {
        assetId,
        authorId: signOpts.authorId || undefined,
        cardId: signOpts.cardId || assetId || undefined,
        variant: 'full',
        communityFeed: signOpts.fromPublicFeed,
        tryAllPaths: signOpts.fromPublicFeed
      }).then((full) => {
        if (full && /^https?:\/\//i.test(full) && !full.startsWith('storage://')) {
          img.addEventListener('load', endLoad, { once: true });
          img.src = full;
          if (img.complete && img.naturalWidth > 0) endLoad();
        } else {
          cardMedia?.classList.add('card-media--load-failed');
          endLoad();
        }
      });
    };
    if (img.complete && img.src === url && img.naturalWidth > 0) {
      endLoad();
      return true;
    }
    img.addEventListener('load', endLoad, { once: true });
    img.addEventListener('error', tryFullFallback, { once: true });
    img.src = url;
    img.classList.remove('img-load-failed');
    if (img.complete && img.naturalWidth > 0) endLoad();
    return true;
  }

  function feedImgStorageAttr(image) {
    if (!image || typeof image !== 'string') return '';
    if (window.SupabaseSync?.isStorageRef?.(image)) {
      return ` data-storage-ref="${esc(image)}"`;
    }
    return '';
  }

  function stripFailedFeedMedia(scope) {
    scope.querySelectorAll('.imagegen-feed-media img.img-load-failed').forEach(img => {
      const media = img.closest('.imagegen-feed-media');
      media?.remove();
      const card = img.closest('.imagegen-feed-card');
      if (card) card.classList.add('imagegen-feed-card--no-media');
    });
    scope.querySelectorAll(
      '#communityGrid .card-media--load-failed, #userProfileGrid .card-media--load-failed'
    ).forEach((media) => {
      media.remove();
    });
  }

  async function hydrateFeedImages(root) {
    const scope = root || document;
    if (window.SupabaseSync?.hydrateImageElements) {
      window.SupabaseSync.patchImageSrcFromCache?.(scope);
      await window.SupabaseSync.hydrateImageElements(scope, { onlyMissing: true });
      stripFailedFeedMedia(scope);
      if (isMobileFeedViewport()) resetMobileFeedGridStyles();
      else layoutImageGenFeedMasonry();
      return;
    }
    const imgs = scope.querySelectorAll(
      '.imagegen-feed img[data-image-ref], #imageGenFeed img[data-image-ref], #creationsSideBody img[data-image-ref], #communitySideBody img[data-image-ref], #creationsGrid img[data-image-ref], #communityGrid img[data-image-ref], #userProfileGrid img[data-image-ref]'
    );
    const list = [...imgs];
    const concurrency = window.matchMedia('(max-width: 900px)').matches ? 4 : 6;
    let cursor = 0;
    async function worker() {
      while (cursor < list.length) {
        const img = list[cursor++];
        await hydrateFeedImageOne(img);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length || 1) }, () => worker()));
    stripFailedFeedMedia(scope);
    if (isMobileFeedViewport()) resetMobileFeedGridStyles();
    else layoutImageGenFeedMasonry();
  }

  function releaseFeedMediaLoading(media) {
    if (!media) return;
    if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(media);
    else media.classList.remove('is-loading', 'card-media--await', 'media-shine-reveal');
  }

  async function hydrateFeedImageOne(img) {
    const ref = img.getAttribute('data-image-ref');
    const jobId = img.getAttribute('data-job-id') || '';
    const media = img.closest('.imagegen-feed-media') || img.closest('.card-media');
    const sideBtn = img.closest('.community-side-img-btn');
    if (!ref || !isDisplayableImage(ref)) {
      media?.remove();
      img.closest('.imagegen-feed-card')?.classList.add('imagegen-feed-card--no-media');
      return;
    }
    if (media?.classList.contains('imagegen-gen-pending')) return;
    try {
      const cur = img.currentSrc || img.src || '';
      if (cur.startsWith('http') && !cur.includes('data:image/svg') && img.complete && img.naturalWidth > 0) {
        releaseFeedMediaLoading(media);
        return;
      }
      if (media) {
        if (!media.dataset.shineAt) media.dataset.shineAt = String(Date.now());
        media.classList.add('is-loading');
      }
      if (!cur.startsWith('http') || cur.includes('data:image/svg')) {
        img.src = IMG_LOADING_PLACEHOLDER;
      }
      img.classList.remove('img-load-failed');
      const ok = await applyFeedImageSrc(img, ref, jobId || null);
      if (!ok) {
        const feedCard = img.closest('.imagegen-feed-card');
        if (feedCard) {
          media?.classList.add('card-media--load-failed');
        } else if (media?.classList.contains('card-media')) {
          media.classList.add('card-media--load-failed');
        } else if (sideBtn) {
          img.src = IMG_LOADING_PLACEHOLDER;
          releaseFeedMediaLoading(media);
        }
      }
    } catch (e) {
      releaseFeedMediaLoading(media);
    }
  }

  function finalizeFeedContainer(container, containerId) {
    if (!container) return;
    if (container.dataset.feedFinalized === '1') return;
    container.dataset.feedFinalized = '1';
    container.dataset.feedLayoutReady = '1';
    container.querySelectorAll('.card-media.is-loading').forEach((m) => releaseFeedMediaLoading(m));
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
  function resolveFeedCardDisplay(title, prompt) {
    const t = (title || '').trim();
    const p = (prompt || '').trim();
    let showTitle = '';
    if (t && !isGenericFeedTitle(t) && t !== p) {
      if (!(p && p.startsWith(t) && t.length >= 6)) showTitle = t;
    }
    const showPrompt = p || '';
    return { showTitle, showPrompt };
  }

  /** 首屏 HTML 只用占位图，避免缓存 URL 在 Masonry/网格就位前以原尺寸闪现 */
  function feedImgInitialSrc(image, jobId) {
    if (!image || !isDisplayableImage(image)) return '';
    return IMG_LOADING_PLACEHOLDER;
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
    const ids = posts.map((p) => String(p.id)).sort().join('|');
    return `${containerId}:${posts.length}:${ids}`;
  }

  function patchFeedLikeLabels(container, posts) {
    posts.forEach((post) => {
      const label = `♥ ${post.likes || 0}`;
      const liked = likedIds.has(post.id);
      container.querySelectorAll(`.card[data-post-id="${post.id}"] .card-time`).forEach((el) => {
        el.textContent = label;
        el.classList.toggle('liked', liked);
      });
    });
  }

  async function softHydrateFeedContainer(container) {
    if (!container) return;
    window.SupabaseSync?.patchImageSrcFromCache?.(container);
    await hydrateFeedImages(container);
    window.SupabaseSync?.patchImageSrcFromCache?.(container);
    window.CardImageLoader?.observeContainer?.(container);
  }

  function communityImgInitialSrc(image) {
    return feedImgInitialSrc(image, null);
  }

  function patchCommunityLikeUI(id) {
    const post = findPost(id);
    if (!post) return;
    const label = `♥ ${post.likes || 0}`;
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
      stats.innerHTML = `<span>♥ ${post.likes || 0} 点赞</span><span>${faved ? '已收藏' : '未收藏'}</span>`;
    }
    const likeBtn = body.querySelector('[data-action="like"]');
    if (likeBtn) likeBtn.textContent = `♥ ${liked ? '已点赞' : '点赞'}`;
    const favBtn = body.querySelector('[data-action="fav"]');
    if (favBtn) favBtn.textContent = faved ? '已收藏' : '收藏';
  }

  function isMobileFeedViewport() {
    return window.MobileUI?.isMobile?.() || window.matchMedia('(max-width: 900px)').matches;
  }

  function bindImageGenFeedImageRelayout() {
    const wrap = document.getElementById('imageGenFeed');
    if (!wrap) return;
    wrap.querySelectorAll('.imagegen-feed-media img, .imagegen-feed-thumb-btn img').forEach(img => {
      if (img.dataset.masonryRelayoutBound) return;
      img.dataset.masonryRelayoutBound = '1';
      const relayout = () => scheduleImageGenFeedLayout();
      img.addEventListener('load', relayout, { once: true });
      img.addEventListener('error', relayout, { once: true });
    });
  }

  function scheduleImageGenFeedLayout() {
    clearTimeout(imageGenLayoutTimer);
    imageGenLayoutTimer = setTimeout(() => {
      if (isMobileFeedViewport()) enforceMobileImageGenFeed();
      else layoutImageGenFeedMasonry();
    }, 160);
  }

  function resetImageGenFeedCardLayout() {
    const wrap = document.getElementById('imageGenFeed');
    if (!wrap) return;
    if (imageGenMasonry) {
      try { imageGenMasonry.destroy(); } catch (e) { /* ignore */ }
      imageGenMasonry = null;
    }
    wrap.style.height = '';
    wrap.querySelectorAll('.grid-sizer').forEach((el) => el.remove());
    wrap.querySelectorAll('.imagegen-feed-card').forEach((card) => {
      card.removeAttribute('style');
    });
  }

  function layoutImageGenFeedMasonry() {
    if (isMobileFeedViewport()) {
      enforceMobileImageGenFeed();
      return;
    }
    const wrap = document.getElementById('imageGenFeed');
    if (!wrap) return;
    wrap.classList.remove('imagegen-feed--tiles', 'imagegen-feed--desktop-grid', 'mobile-feed-grid');
    wrap.classList.add('imagegen-feed--masonry');

    const runLayout = () => {
      if (typeof Masonry === 'undefined') return;
      const cards = wrap.querySelectorAll('.imagegen-feed-card');
      if (!cards.length) {
        resetImageGenFeedCardLayout();
        setFeedLayoutPending(wrap, false);
        return;
      }
      const gap = getMasonryGap();
      const style = getComputedStyle(wrap);
      const innerW = wrap.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (innerW < 80) {
        scheduleImageGenFeedLayout();
        return;
      }
      const cols = getImageGenFeedColumns(innerW);
      const colWidth = Math.max(140, Math.floor((innerW - gap * (cols - 1)) / cols));
      let sizer = wrap.querySelector('.grid-sizer');
      if (!sizer) {
        sizer = document.createElement('div');
        sizer.className = 'grid-sizer';
        wrap.insertBefore(sizer, wrap.firstChild);
      }
      sizer.style.width = colWidth + 'px';
      cards.forEach((card) => { card.style.width = colWidth + 'px'; });
      const opts = {
        itemSelector: '.imagegen-feed-card',
        columnWidth: '.grid-sizer',
        gutter: gap,
        percentPosition: false,
        horizontalOrder: false,
        transitionDuration: 0
      };
      const scrollTop = wrap.scrollTop;
      if (imageGenMasonry) {
        imageGenMasonry.option(opts);
        imageGenMasonry.reloadItems();
        imageGenMasonry.layout();
      } else {
        cards.forEach((card) => {
          card.style.left = '';
          card.style.top = '';
          card.style.position = '';
        });
        imageGenMasonry = new Masonry(wrap, opts);
        imageGenMasonry.layout();
      }
      requestAnimationFrame(() => {
        imageGenMasonry?.layout();
        wrap.scrollTop = scrollTop;
        setFeedLayoutPending(wrap, false);
      });
      wrap.scrollTop = scrollTop;
      bindImageGenFeedImageRelayout();
    };

    if (typeof Masonry !== 'undefined') runLayout();
    else if (typeof window.ensureMasonryScript === 'function') {
      void window.ensureMasonryScript().then(runLayout);
    } else runLayout();
  }

  function feedImgStillPending(img) {
    const src = img?.currentSrc || img?.src || '';
    if (!src || src.includes('data:image/svg')) return true;
    return !(img.complete && img.naturalWidth > 8);
  }

  function layoutCommunityWhenImagesReady(containerId) {
    if (useCssGridForCommunityFeed(containerId)) {
      layoutCommunityMasonry(containerId);
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

  function getCommunityFeedColumnWidth(container) {
    if (!container) return 0;
    const style = getComputedStyle(container);
    const innerW = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (innerW < 80) return 0;
    const gap = getCommunityFeedGaps().colGap;
    const cols = getCardColumns();
    return Math.max(120, Math.floor((innerW - gap * (cols - 1)) / cols));
  }

  function primeCommunityFeedColumnWidths(container, containerId) {
    if (!container || useCssGridForCommunityFeed(containerId)) return 0;
    const colWidth = getCommunityFeedColumnWidth(container);
    if (!colWidth) return 0;
    container.style.removeProperty('max-width');
    container.style.removeProperty('margin-left');
    container.style.removeProperty('margin-right');
    const sizer = container.querySelector('.grid-sizer');
    if (sizer) sizer.style.width = colWidth + 'px';
    container.querySelectorAll('.card').forEach((card) => {
      card.style.width = colWidth + 'px';
      card.style.maxWidth = colWidth + 'px';
      card.style.marginBottom = getCommunityFeedGaps().rowGap + 'px';
    });
    container.style.setProperty('--feed-col-width', `${colWidth}px`);
    return colWidth;
  }

  function runCommunityFeedLayoutPass(containerId, opts = {}) {
    const container = document.getElementById(containerId);
    if (!container) return false;
    if (useCssGridForCommunityFeed(containerId)) {
      layoutCommunityMasonry(containerId);
      return true;
    }
    if (!primeCommunityFeedColumnWidths(container, containerId) && !opts.allowNarrow) {
      return false;
    }
    layoutCommunityMasonry(containerId);
    return true;
  }

  let layoutCommunityDebounce = {};
  const layoutCommunityCooldown = {};
  function scheduleCommunityLayout(containerId, opts = {}) {
    if (useCssGridForCommunityFeed(containerId)) {
      layoutCommunityMasonry(containerId);
      return;
    }
    if (!opts.force && layoutCommunityCooldown[containerId]) return;
    clearTimeout(layoutCommunityDebounce[containerId]);
    layoutCommunityDebounce[containerId] = setTimeout(() => {
      layoutCommunityMasonry(containerId);
      layoutCommunityCooldown[containerId] = true;
      setTimeout(() => {
        layoutCommunityCooldown[containerId] = false;
      }, 1200);
    }, opts.immediate ? 0 : 60);
  }

  function bindCommunityGridImageRelayout(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('img.card-img, .card-media img').forEach(img => {
      if (img.dataset.masonryRelayoutBound) return;
      img.dataset.masonryRelayoutBound = '1';
      img.addEventListener('load', () => {
        const src = img.currentSrc || img.src || '';
        if (src.includes('data:image/svg') || !(img.complete && img.naturalWidth > 8)) return;
        if (container.dataset.feedLayoutReady === '1') return;
        scheduleCommunityLayout(containerId);
      }, { once: true });
    });
  }

  function scheduleLayoutAfterImages(containerId) {
    scheduleCommunityLayout(containerId);
    bindCommunityGridImageRelayout(containerId);
  }

  function isMobileFeedLayout() {
    return window.MobileUI?.isMobile?.() || window.matchMedia('(max-width: 900px)').matches;
  }

  function useCssGridForCommunityFeed(containerId) {
    if (containerId === 'userProfileGrid') return true;
    if (containerId !== 'communityGrid' && containerId !== 'creationsGrid') return false;
    // 效率模式 / 手机端用 CSS Grid；桌面端仍走 Masonry，才能调列数
    if (!isMobileFeedLayout()) return false;
    return true;
  }

  function relayoutCommunityFeeds() {
    if (isMobileFeedLayout()) {
      enforceMobileCommunityFeedGrid('communityGrid');
      enforceMobileCommunityFeedGrid('creationsGrid');
    }
    ['communityGrid', 'creationsGrid', 'userProfileGrid'].forEach((id) => {
      layoutCommunityMasonry(id);
    });
  }

  function communityImageSignOpts(img) {
    const inFeed = !!img?.closest?.(
      '#communityGrid, #creationsGrid, #userProfileGrid, #communitySideBody, #creationsSideBody, .community-side-img-btn'
    );
    if (!inFeed) return { fromPublicFeed: false, authorId: '', cardId: '' };
    const authorId = img.closest('.card')?.dataset?.authorId || '';
    const ref = img.getAttribute('data-image-ref') || '';
    const path = window.SupabaseSync?.storagePathFromRef?.(ref) || '';
    const uid = window.SupabaseSync?.getUserId?.();
    const own = !!(path && uid && path.replace(/^\//, '').startsWith(`${uid}/`));
    const guest = !window.SupabaseSync?.isLoggedIn?.();
    const sidePanel = !!img?.closest?.('#communitySideBody, #creationsSideBody, .community-side-img-btn');
    return {
      fromPublicFeed: guest || !own || sidePanel,
      authorId:
        img.dataset?.authorId
        || authorId
        || img.closest('.card')?.dataset?.authorId
        || img.closest('[data-author-id]')?.dataset?.authorId
        || '',
      cardId:
        img.dataset?.sourceCardId
        || img.closest('.card')?.dataset?.sourceCardId
        || img.closest('.card')?.dataset?.postId
        || img.dataset?.postId
        || ''
    };
  }

  function isPublicCommunityFeedContainer(el) {
    return communityImageSignOpts(el).fromPublicFeed;
  }

  function resetCommunityGridCardLayout(container, containerId) {
    if (containerId === 'creationsGrid' && creationsMasonry) {
      creationsMasonry.destroy();
      creationsMasonry = null;
    } else if (containerId === 'userProfileGrid' && profileMasonry) {
      profileMasonry.destroy();
      profileMasonry = null;
    } else if (communityMasonry) {
      communityMasonry.destroy();
      communityMasonry = null;
    }
    container.style.removeProperty('height');
    container.querySelectorAll('.grid-sizer').forEach((el) => el.remove());
    container.querySelectorAll('.card').forEach((card) => {
      card.classList.remove('is-masonry-positioned');
      card.style.removeProperty('position');
      card.style.removeProperty('left');
      card.style.removeProperty('top');
      card.style.removeProperty('right');
      card.style.removeProperty('bottom');
      card.style.removeProperty('width');
      card.style.removeProperty('max-width');
      card.style.removeProperty('margin-bottom');
      card.style.removeProperty('transform');
    });
  }

  /** 手机社区/创作：销毁 Masonry、清 inline 定位，强制 CSS Grid 两列 */
  function enforceMobileCommunityFeedGrid(containerId) {
    if (!isMobileFeedLayout()) return;
    if (containerId !== 'communityGrid' && containerId !== 'creationsGrid') return;
    const container = document.getElementById(containerId);
    if (!container || !container.querySelector('.card')) return;
    resetCommunityGridCardLayout(container, containerId);
    container.classList.add('community-mobile-feed');
    container.classList.remove('masonry-ready');
    setFeedLayoutPending(containerId, false);
  }

  function layoutCommunityMasonry(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!useCssGridForCommunityFeed(containerId)) {
      container.classList.remove('community-mobile-feed');
    }
    if (useCssGridForCommunityFeed(containerId)) {
      if (containerId === 'communityGrid' || containerId === 'creationsGrid') {
        enforceMobileCommunityFeedGrid(containerId);
        if (window.CardImageLoader?.observeContainer) window.CardImageLoader.observeContainer(container);
      } else {
        resetCommunityGridCardLayout(container, containerId);
        container.classList.remove('community-mobile-feed');
        requestAnimationFrame(() => setFeedLayoutPending(containerId, false));
        if (window.CardImageLoader?.observeContainer) window.CardImageLoader.observeContainer(container);
      }
      return;
    }
    container?.classList.remove('community-mobile-feed');
    const runMasonryLayout = () => {
    if (isMobileFeedLayout() && (containerId === 'communityGrid' || containerId === 'creationsGrid')) {
      enforceMobileCommunityFeedGrid(containerId);
      return;
    }
    if (typeof Masonry === 'undefined') return;
    const cardEls = container.querySelectorAll('.card');
    const isProfile = containerId === 'userProfileGrid';
    const isCreations = containerId === 'creationsGrid';
    let instance = isProfile ? profileMasonry : (isCreations ? creationsMasonry : communityMasonry);

    if (!cardEls.length) {
      if (instance) {
        instance.destroy();
        if (isProfile) profileMasonry = null;
        else if (isCreations) creationsMasonry = null;
        else communityMasonry = null;
      }
      setFeedLayoutPending(containerId, false);
      return;
    }

    const { colGap: gap, rowGap } = getCommunityFeedGaps();
    const cols = getCardColumns();
    const style = getComputedStyle(container);
    const innerW = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (innerW < 80) {
      scheduleCommunityLayout(containerId, { force: true });
      return;
    }
    let colWidth = Math.max(120, Math.floor((innerW - gap * (cols - 1)) / cols));
    container.style.removeProperty('max-width');
    container.style.removeProperty('margin-left');
    container.style.removeProperty('margin-right');
    let sizer = container.querySelector('.grid-sizer');
    if (!sizer) {
      sizer = document.createElement('div');
      sizer.className = 'grid-sizer';
      container.insertBefore(sizer, container.firstChild);
    }
    sizer.style.width = colWidth + 'px';
    cardEls.forEach(card => {
      card.style.width = colWidth + 'px';
      card.style.maxWidth = colWidth + 'px';
      card.style.marginBottom = rowGap + 'px';
    });
    const opts = {
      itemSelector: '.card',
      columnWidth: '.grid-sizer',
      gutter: gap,
      percentPosition: false,
      horizontalOrder: false,
      transitionDuration: '0s'
    };
    const scrollTop = container.scrollTop;
    if (instance) {
      instance.option(opts);
      instance.reloadItems();
      instance.layout();
    } else {
      cardEls.forEach(card => {
        card.style.left = '';
        card.style.top = '';
        card.style.position = '';
      });
      instance = new Masonry(container, opts);
      if (isProfile) profileMasonry = instance;
      else if (isCreations) creationsMasonry = instance;
      else communityMasonry = instance;
    }
    requestAnimationFrame(() => {
      instance?.layout();
      container.scrollTop = scrollTop;
      setFeedLayoutPending(containerId, false);
    });
    container.scrollTop = scrollTop;
    bindCommunityGridImageRelayout(containerId);
    };
    if (typeof Masonry !== 'undefined') runMasonryLayout();
    else if (typeof window.ensureMasonryScript === 'function') {
      void window.ensureMasonryScript().then(runMasonryLayout);
    } else runMasonryLayout();
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
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
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
    if (window.SupabaseSync?.isLoggedIn?.()) window.scheduleCloudPush?.();
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
    if (window.SupabaseSync?.isLoggedIn?.()) window.scheduleCloudPush?.();
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

  function mergeNotifications(list) {
    if (!Array.isArray(list)) return;
    const map = new Map(notifications.map(n => [n.id, n]));
    for (const n of list) {
      if (!n?.id) continue;
      const prev = map.get(n.id);
      map.set(n.id, prev ? { ...n, ...prev, read: !!(prev.read && n.read) } : n);
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
    if (window.SupabaseSync?.isLoggedIn?.()) window.scheduleCloudPush?.();
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
        const n = notifications.find(x => x.id === id);
        if (n) n.read = true;
        persistNotifications();
        updateNotifyBadge();
        renderNotifyPanel();
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

  async function renderPostsIntoContainer(posts, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const sig = feedListSignature(posts, containerId);
    if (
      container.dataset.feedSig === sig
      && container.querySelector('.community-post-card')
    ) {
      patchFeedLikeLabels(container, posts);
      if (container.classList.contains('feed-layout-pending')) {
        void softHydrateFeedContainer(container).then(() => {
          setFeedLayoutPending(containerId, false);
          scheduleCommunityLayout(containerId);
        });
      }
      return;
    }
    container.dataset.feedSig = sig;
    delete container.dataset.feedFinalized;
    const isProfile = containerId === 'userProfileGrid';
    const isCommunityFeed = containerId === 'communityGrid' || containerId === 'userProfileGrid';
    const renderPosts = isCommunityFeed ? posts.filter(isFeedRenderablePost) : posts;
    if (containerId === 'communityGrid' && communitySidePostId) {
      const stillThere = renderPosts.some((p) => p.id === communitySidePostId);
      if (!stillThere) closeCommunitySidePanel();
    }
    if (isProfile && profileMasonry) {
      profileMasonry.destroy();
      profileMasonry = null;
    } else if (containerId === 'creationsGrid' && creationsMasonry) {
      creationsMasonry.destroy();
      creationsMasonry = null;
    } else if (!isProfile && communityMasonry) {
      communityMasonry.destroy();
      communityMasonry = null;
    }

    if (!renderPosts.length) {
      container.innerHTML = '<div class="feature-empty" style="grid-column:1/-1;padding:40px"><p>暂无已发布作品</p></div>';
      return;
    }

    const imageRefs = renderPosts.map((p) => canonicalCommunityImageRef(p) || p.image).filter(Boolean);

    const fragment = document.createDocumentFragment();
    const useGrid = useCssGridForCommunityFeed(containerId);
    if (!useGrid) {
      const sizer = document.createElement('div');
      sizer.className = 'grid-sizer';
      fragment.appendChild(sizer);
    }

    renderPosts.forEach((post, idx) => {
      const displayRef = communityPostDisplayImageRef(post);
      const showImage = !!(displayRef && isDisplayableImage(displayRef));
      const div = document.createElement('div');
      const visualOnly = containerId === 'communityGrid';
      div.className = visualOnly
        ? 'card community-post-card community-post-card--visual'
        : 'card community-post-card';
      div.dataset.postId = post.id;
      if (post.sourceCardId) div.dataset.sourceCardId = post.sourceCardId;
      if (post.authorId) div.dataset.authorId = post.authorId;
      const liked = likedIds.has(post.id);
      const titleTrim = (post.title || '').trim();
      const hasRealTitle = titleTrim && !isGenericPostTitle(titleTrim);
      const storageAttr = feedImgStorageAttr(displayRef);
      const authorAttrs = ` data-author-id="${esc(post.authorId || '')}" data-source-card-id="${esc(post.sourceCardId || '')}"`;
      const imgSrc = showImage ? feedImgInitialSrc(displayRef) : '';
      const imgLoading = showImage;
      const mediaHtml = showImage
        ? `<div class="card-media${imgLoading ? ' is-loading' : ''}"${imgLoading ? ` data-shine-at="${Date.now()}"` : ''}><img class="card-img" src="${esc(imgSrc)}" data-image-ref="${esc(displayRef)}"${storageAttr}${authorAttrs} loading="lazy" decoding="async" draggable="false" alt="" onload="if(typeof finishCardMediaShine==='function')finishCardMediaShine(this.closest('.card-media'))"></div>`
        : '';
      const timeLabel = `♥ ${post.likes || 0}`;
      const promptTrim = (post.prompt || '').trim();
      if (visualOnly) {
        const overlay = showImage
          ? `<div class="community-card-visual-meta"><span class="card-time ${liked ? 'liked' : ''}">${esc(timeLabel)}</span></div>`
          : '';
        div.innerHTML = showImage ? `${mediaHtml}${overlay}` : '<div class="community-card-no-media">无配图</div>';
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
          if (communityAppreciateActive && showImage) {
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
      fragment.appendChild(div);
    });

    container.innerHTML = '';
    delete container.dataset.feedFinalized;
    delete container.dataset.feedLayoutReady;
    setFeedLayoutPending(containerId, true);
    container.appendChild(fragment);
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
      if (!runCommunityFeedLayoutPass(containerId)) {
        scheduleCommunityLayout(containerId, { force: true, immediate: true });
      }
      await new Promise((r) => requestAnimationFrame(r));
      if (renderGen !== communityFeedRenderGen) return;
      window.SupabaseSync?.patchImageSrcFromCache?.(container);
      window.CardImageLoader?.observeContainer?.(container);
      const mobile = isMobileFeedLayout();
      const prefetchCap = mobile ? 28 : 48;
      const cardLike = posts.map((p) => ({
        id: p.sourceCardId || p.id,
        image: canonicalCommunityImageRef(p) || p.image,
        sourceCardId: p.sourceCardId,
        authorId: p.authorId
      }));
      const inCommunityFeed =
        containerId === 'communityGrid' || containerId === 'creationsGrid' || containerId === 'userProfileGrid';
      const uid = window.SupabaseSync?.getUserId?.();
      const loggedIn = window.SupabaseSync?.isLoggedIn?.();
      const ownCards = [];
      const publicPosts = [];
      if (inCommunityFeed && loggedIn && uid) {
        for (const p of posts.slice(0, prefetchCap)) {
          const ref = canonicalCommunityImageRef(p) || p.image;
          const path = window.SupabaseSync?.storagePathFromRef?.(ref) || '';
          const item = {
            id: p.sourceCardId || p.id,
            image: ref,
            sourceCardId: p.sourceCardId,
            authorId: p.authorId
          };
          if (path && path.replace(/^\//, '').startsWith(`${uid}/`)) ownCards.push(item);
          else publicPosts.push(item);
        }
      }
      const prefetchP = inCommunityFeed && !loggedIn && imageRefs.length && window.SupabaseSync?.prefetchCommunityDisplayUrls
        ? window.SupabaseSync.prefetchCommunityDisplayUrls(cardLike.slice(0, prefetchCap), mobile ? 5000 : 7000)
        : inCommunityFeed && loggedIn
          ? Promise.all([
              ownCards.length && window.SupabaseSync?.prefetchCardsImages
                ? window.SupabaseSync.prefetchCardsImages(ownCards, mobile ? 5000 : 6500)
                : Promise.resolve(),
              publicPosts.length && window.SupabaseSync?.prefetchCommunityDisplayUrls
                ? window.SupabaseSync.prefetchCommunityDisplayUrls(publicPosts, mobile ? 5000 : 6500)
                : Promise.resolve()
            ])
          : imageRefs.length && window.SupabaseSync?.prefetchDisplayUrlsWithCap
            ? window.SupabaseSync.prefetchDisplayUrlsWithCap(imageRefs.slice(0, prefetchCap), mobile ? 5000 : 7000)
            : Promise.resolve();
      const hydrateP = hydrateFeedImages(container);
      void prefetchP.catch(() => {});
      await Promise.race([
        Promise.all([hydrateP, prefetchP]),
        new Promise((r) => setTimeout(r, mobile ? 2200 : 2800))
      ]);
      if (renderGen !== communityFeedRenderGen) return;
      window.SupabaseSync?.patchImageSrcFromCache?.(container);
      window.CardImageLoader?.observeContainer?.(container);
      finalizeFeedContainer(container, containerId);
      finishLayout();
      void hydrateP.then(() => {
        if (renderGen !== communityFeedRenderGen) return;
        window.SupabaseSync?.patchImageSrcFromCache?.(container);
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
    communitySort = next;
    document.querySelectorAll('[data-community-sort]').forEach((b) => {
      b.classList.toggle('active', (b.dataset.communitySort || 'random') === communitySort);
    });
    document.querySelectorAll('[data-imagegen-community-sort]').forEach((b) => {
      b.classList.toggle('active', (b.dataset.imagegenCommunitySort || 'random') === communitySort);
    });
  }

  function filterAndSortPosts(list) {
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
      filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
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
      let added = false;
      for (const n of r.data.items) {
        if (!n?.id) continue;
        if (notifications.some((x) => x.id === n.id)) continue;
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
        added = true;
      }
      if (added) {
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
    const gen = ++communityFeedRenderGen;
    if (!opts.skipFeedFetch && publicFeedAt === 0 && !publicFeedLoading) {
      if (communityMasonry) { communityMasonry.destroy(); communityMasonry = null; }
      container.innerHTML =
        '<div class="feature-empty"><p>正在加载全站社区…</p><p class="panel-hint">从服务器拉取最新列表</p></div>';
      void refreshPublicCommunityFeed({ force: true }).then((ok) => {
        if (gen !== communityFeedRenderGen) return;
        if (!ok) {
          container.innerHTML =
            '<div class="feature-empty"><p>社区加载失败</p><p class="panel-hint">请检查网络或稍后再试</p><button type="button" class="btn btn-primary" onclick="renderCommunity({ immediate: true, forceRepaint: true })">重试</button></div>';
          return;
        }
        renderCommunityNow({ skipFeedFetch: true, forceRepaint: true });
      });
      return;
    }
    let list = filterAndSortPosts(getCommunityFeedForDisplay());
    const earlySig = feedListSignature(list, 'communityGrid');
    if (
      !opts.forceRepaint
      && container.dataset.feedSig === earlySig
      && container.querySelector('.community-post-card')
    ) {
      patchFeedLikeLabels(container, list);
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
      if (communityMasonry) { communityMasonry.destroy(); communityMasonry = null; }
      container.innerHTML =
        '<div class="feature-empty"><p>正在加载全站社区…</p><p class="panel-hint">从服务器拉取最新列表</p></div>';
      return;
    }
    if (!list.length) {
      if (communityMasonry) { communityMasonry.destroy(); communityMasonry = null; }
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
      container.innerHTML = `<div class="feature-empty"><p>${emptyMsg}</p>${rateHint}${cardHint}<button type="button" class="btn btn-primary" onclick="switchAppPage('warehouse')">去卡片库</button>${restoreCardsBtn}</div>`;
      return;
    }
    const sig = feedListSignature(list, 'communityGrid');
    if (
      !opts.forceRepaint
      && container.dataset.feedSig === sig
      && container.querySelector('.community-post-card')
    ) {
      patchFeedLikeLabels(container, list);
      return;
    }
    void renderPostsIntoContainer(list, 'communityGrid');
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
    if (profileMasonry) {
      profileMasonry.destroy();
      profileMasonry = null;
    }
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
        btn.textContent = `♥ ${likes}`;
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
      window.scheduleCloudPush?.();
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

  function loadedCommunitySideImgSrc(body) {
    const imgEl = body?.querySelector?.('.community-side-img');
    const cur = imgEl?.currentSrc || imgEl?.src || '';
    if (!imgEl || !cur || cur.includes('data:image/svg')) return '';
    if (!cur.startsWith('http')) return '';
    if (!imgEl.complete || imgEl.naturalWidth < 1) return '';
    if (window.SupabaseSync?.isValidSignedDisplayUrl && !window.SupabaseSync.isValidSignedDisplayUrl(cur)) return '';
    return cur;
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

  async function openCommunitySideImageZoom(body, post, sideRef, postId, extra = {}) {
    if (post && typeof openCommunityAppreciateViewer === 'function') {
      void openCommunityAppreciateViewer(post);
      return;
    }
    const ready = loadedCommunitySideImgSrc(body);
    if (ready && typeof window.openLightbox === 'function') {
      window.openLightbox(ready);
      return;
    }
    const signOpts = communitySideZoomSignOpts(post, sideRef, postId);
    let url = await resolveImageDisplayUrl(sideRef, extra.jobId || null, post?.sourceCardId || postId, signOpts);
    if (!url && window.SupabaseSync?.resolveDisplayUrl && sideRef) {
      try {
        url = await window.SupabaseSync.resolveDisplayUrl(sideRef, {
          assetId: post?.sourceCardId || postId,
          authorId: signOpts.authorId || undefined,
          cardId: signOpts.cardId || undefined,
          variant: 'full',
          communityFeed: signOpts.fromPublicFeed === true,
          tryAllPaths: signOpts.fromPublicFeed === true
        });
      } catch (e) { /* ignore */ }
    }
    if (url && typeof window.openLightbox === 'function') {
      window.openLightbox(url);
      return;
    }
    if (post && typeof openCommunityAppreciateViewer === 'function') {
      void openCommunityAppreciateViewer(post);
      return;
    }
    toast('图片尚未加载完成，请稍候再试');
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
    const post = findPost(id);
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
    const sideInitial = showSideImg ? communityImgInitialSrc(sideRef) : '';
    const imgBlock = showSideImg
      ? `<button type="button" class="community-side-img-btn" data-side-zoom data-author-id="${esc(post.authorId || '')}" data-post-id="${esc(post.id)}" data-source-card-id="${esc(post.sourceCardId || '')}" title="点击放大"><img class="community-side-img" src="${esc(sideInitial)}" data-image-ref="${esc(sideRef)}" data-author-id="${esc(post.authorId || '')}" data-post-id="${esc(post.id)}" data-source-card-id="${esc(post.sourceCardId || '')}"${storageAttr} alt=""></button>`
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
      if (showSideImg) await hydrateFeedImages(body);
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
        <span>♥ ${post.likes || 0} 点赞</span>
        <span>${faved ? '已收藏' : '未收藏'}</span>
      </div>
      <div class="community-side-actions">
        <button type="button" class="btn btn-secondary" data-action="like">♥ ${liked ? '已点赞' : '点赞'}</button>
        <button type="button" class="btn btn-secondary" data-action="copy">复制</button>
        <button type="button" class="btn btn-secondary" data-action="fav">${faved ? '已收藏' : '收藏'}</button>
        <button type="button" class="btn btn-primary" data-action="remix">制作同款</button>
      </div>
      <p class="panel-hint">点赞、收藏、制作同款、复制提示词时会自动点赞；自己的作品请到卡片库下架或删除</p>`;
    body.querySelector('[data-action="like"]')?.addEventListener('click', () => likeCommunityPostOnly(id));
    body.querySelector('[data-action="copy"]')?.addEventListener('click', () => copyPostPrompt(post));
    body.querySelector('[data-action="fav"]')?.addEventListener('click', () => favoritePost(id, post));
    body.querySelector('[data-action="remix"]')?.addEventListener('click', () => remixToImageGen(post));
    bindCommunitySideImageZoom(body, post, sideRef, id);
    const authorBtn = body.querySelector('.community-detail-author-btn');
    if (authorBtn) bindAuthorLink(authorBtn, post.authorId, post.authorName);
    highlightCommunityCard(id);
    if (showSideImg) await hydrateFeedImages(body);
    const timeEl = document.querySelector(`#communityGrid .card[data-post-id="${id}"] .card-time`);
    if (timeEl) {
      timeEl.textContent = `♥ ${post.likes || 0}`;
      if (likedIds.has(id)) timeEl.classList.add('liked');
    }
  }

  function isMobileFeaturePanel() {
    return window.MobileUI?.isMobile?.() || window.matchMedia('(max-width: 900px)').matches;
  }

  function mountFeatureSidePanel(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel || !isMobileFeaturePanel()) return;
    if (panel.dataset.mountedOnBody === '1') return;
    panel._phOriginalParent = panel.parentElement;
    panel._phOriginalNext = panel.nextSibling;
    document.body.appendChild(panel);
    panel.dataset.mountedOnBody = '1';
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

  function openPostSidePanel(id, ctx, opts = {}) {
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
    mountFeatureSidePanel(panelId);
    document.getElementById(panelId)?.classList.remove('hidden');
    document.body.classList.add('community-panel-open');
    const panel = document.getElementById(panelId);
    if (panel) {
      panel.classList.remove('community-side-panel--closing');
      panel.classList.add('community-side-panel--open');
    }
    if (isMobileFeaturePanel()) {
      window.MobileUI?.closeDrawers?.();
    }
    void renderCommunitySidePanel(id, {
      bodyId: isCreations ? 'creationsSideBody' : 'communitySideBody',
      titleId: isCreations ? 'creationsSideTitle' : 'communitySideTitle',
      mode: isCreations ? 'creations' : 'community'
    });
    requestAnimationFrame(() => {
      scheduleCommunityLayout(isCreations ? 'creationsGrid' : 'communityGrid', { force: true, immediate: true });
    });
  }

  function openCommunitySidePanel(id, opts = {}) {
    openPostSidePanel(id, 'community', opts);
  }

  function openCommunityAppreciateById(postId) {
    const post = findPost(postId);
    if (post) return openCommunityAppreciateViewer(post);
  }

  function exitCommunityAppreciate(skipLayout) {
    communityAppreciateActive = false;
    appreciateViewerPostId = null;
    document.getElementById('communityAppreciateBtn')?.classList.remove('active');
    document.body.classList.remove('community-appreciate', 'global-view', 'global-view-entering', 'global-view-exiting');
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
      favBtn.textContent = favIds.has(post.id) ? '已收藏' : '收藏到卡片库';
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
          if (window.SupabaseSync?.resolveDisplayUrl) {
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
    const creationsOpen = !document.getElementById('creationsSidePanel')?.classList.contains('hidden');
    if (!creationsOpen) document.body.classList.remove('community-panel-open');
    communitySidePostId = null;
    openPostId = null;
    document.querySelectorAll('#communityGrid .community-post-card.selected').forEach(el => el.classList.remove('selected'));
    requestAnimationFrame(() => {
      scheduleCommunityLayout('communityGrid', { force: true, immediate: true });
    });
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
    if (post?.id) ensureLike(post.id);
    navigator.clipboard.writeText(text).then(() => toast('已复制提示词'));
  }

  function copyPostPrompt(post) {
    copyPostPromptOnly(post);
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
    if (post?.id) ensureLike(post.id);
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
      publishToCommunity: !!opts.publishToCommunity,
      fromInspirationDraw: !!opts.fromInspirationDraw,
      silentToast: !!opts.silentToast
    })).then((r) => r?.ok ?? false);
  }

  const RECENT_GEN_RECOVER_MS = 72 * 3600 * 1000;
  const activePollJobIds = new Set();
  let resumeGenJobsInflight = null;
  let genJobsSyncTimer = null;
  let genJobsSyncInterval = null;
  let genJobsSyncRetry = 0;

  function persistPendingGenJobs() {
    try {
      sessionStorage.setItem(LS_PENDING_GEN_JOBS, JSON.stringify(imageGenPendingJobs.slice(0, 32)));
    } catch (e) { /* ignore */ }
  }

  function loadPendingGenJobs() {
    try {
      const raw = sessionStorage.getItem(LS_PENDING_GEN_JOBS);
      const list = raw ? JSON.parse(raw) : [];
      imageGenPendingJobs = Array.isArray(list) ? list : [];
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
    } catch (e) {
      imageGenFailedJobs = [];
    }
  }

  function batchIndexLabel(index, total) {
    if (index && total && total > 1) return `第 ${index}/${total} 张`;
    return '';
  }

  function addFailedGenJob(job) {
    const entry = {
      id: job.id || genId('fail'),
      prompt: String(job.prompt || '').trim(),
      errorMessage: String(job.errorMessage || '生图失败').slice(0, 200),
      failedAt: job.failedAt || Date.now(),
      modelLabel: job.modelLabel || '',
      batchIndex: job.batchIndex || null,
      batchTotal: job.batchTotal || null,
      batchId: job.batchId || null
    };
    if (!entry.prompt) return;
    imageGenFailedJobs = [entry, ...imageGenFailedJobs.filter((f) => f.id !== entry.id)].slice(0, 24);
    persistFailedGenJobs();
  }

  function removeFailedGenJob(failId) {
    imageGenFailedJobs = imageGenFailedJobs.filter((f) => f.id !== failId);
    persistFailedGenJobs();
  }

  function failPendingJob(pendingId, errorMessage) {
    const job = imageGenPendingJobs.find((j) => j.id === pendingId);
    if (job) {
      addFailedGenJob({
        prompt: job.prompt,
        modelLabel: job.modelLabel,
        batchIndex: job.batchIndex,
        batchTotal: job.batchTotal,
        batchId: job.batchId,
        errorMessage
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
      model: job.model || 'quanneng2',
      resolution: job.resolution || '1k',
      quality: job.quality || 'standard',
      size: job.size || '1:1',
      cost: job.cost || 0,
      jobId: job.jobId,
      fromInspirationDraw: !!job.fromInspirationDraw,
      batchIndex: job.batchIndex || null,
      batchTotal: job.batchTotal || null,
      batchId: job.batchId || null,
      silentToast: !!job.silentToast
    };
  }

  function isRecentGenJob(job) {
    const t = Date.parse(job?.createdAt || '');
    return Number.isFinite(t) && Date.now() - t < RECENT_GEN_RECOVER_MS;
  }

  function shouldAutoRecoverCompletedJob(job) {
    if (isGenerationJobDeleted(job.id)) return false;
    if (hasWarehouseCardForJob(job.id)) return false;
    if (creations.some((c) => c.jobId === job.id)) return false;
    return isSessionGenJob(job.id) || isRecentGenJob(job);
  }

  /** 延迟/重试同步：登录尚未就绪时也会再次拉取 */
  function scheduleGenJobsSync(delayMs) {
    clearTimeout(genJobsSyncTimer);
    genJobsSyncTimer = setTimeout(() => {
      void resumePendingGenerationJobs().then((ok) => {
        if (!ok && genJobsSyncRetry < 6) {
          genJobsSyncRetry += 1;
          scheduleGenJobsSync(Math.min(8000, 800 + genJobsSyncRetry * 1200));
        } else if (ok) {
          genJobsSyncRetry = 0;
        }
      });
    }, delayMs == null ? 400 : delayMs);
  }

  function startGenJobsBackgroundSync() {
    if (genJobsSyncInterval) return;
    genJobsSyncInterval = setInterval(() => {
      if (!window.PointsSystem?.useApiForAccount?.()) return;
      if (imageGenPendingJobs.length || getSessionGenJobIds().length) {
        void resumePendingGenerationJobs();
      }
    }, 18000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleGenJobsSync(300);
    });
  }

  function getSessionGenJobIds() {
    try {
      const raw = sessionStorage.getItem(LS_SESSION_GEN_JOBS);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.map(String) : [];
    } catch (e) {
      return [];
    }
  }

  function trackSessionGenJob(jobId) {
    if (!jobId) return;
    const id = String(jobId);
    const list = getSessionGenJobIds().filter((x) => x !== id);
    list.push(id);
    while (list.length > 40) list.shift();
    try {
      sessionStorage.setItem(LS_SESSION_GEN_JOBS, JSON.stringify(list));
    } catch (e) { /* ignore */ }
  }

  function clearSessionGenJob(jobId) {
    if (!jobId) return;
    const id = String(jobId);
    const list = getSessionGenJobIds().filter((x) => x !== id);
    try {
      sessionStorage.setItem(LS_SESSION_GEN_JOBS, JSON.stringify(list));
    } catch (e) { /* ignore */ }
  }

  function isSessionGenJob(jobId) {
    return jobId && getSessionGenJobIds().includes(String(jobId));
  }

  function hasWarehouseCardForJob(jobId) {
    if (!jobId) return false;
    const card = (window.__promptHubCards || []).find((c) => c.genJobId === jobId);
    if (!card?.image) return false;
    if (!isDisplayableImage(card.image)) return false;
    return true;
  }

  async function repairWarehouseCardImageFromJob(card, imageUrl, jobId) {
    if (!card?.id || !imageUrl) return false;
    let stored = imageUrl;
    if (window.SupabaseSync?.persistGenerationImage) {
      try {
        stored = await window.SupabaseSync.persistGenerationImage(card.id, imageUrl);
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
      window.recordGenerationJobDeletion?.(jobId);
      clearSessionGenJob(jobId);
      const cre = creations.find((c) => c.jobId === jobId);
      if (cre) recordCreationDeletion(cre.id, jobId);
    }
  }

  async function listRecoverableOrphanJobs() {
    if (!window.PromptHubApi?.listRecentGenerationJobs) return [];
    const r = await window.PromptHubApi.listRecentGenerationJobs();
    if (!r?.ok || !Array.isArray(r.data?.jobs)) return [];
    return r.data.jobs.filter((job) => {
      if (!job?.id || job.status !== 'completed' || !job.imageUrl) return false;
      if (isGenerationJobDeleted(job.id)) return false;
      if (hasWarehouseCardForJob(job.id)) return false;
      if (creations.some((c) => c.jobId === job.id)) return false;
      return true;
    });
  }

  /** 刷新/登录后：恢复进行中的卡片、续轮询、静默补全已完成任务 */
  async function resumePendingGenerationJobs() {
    if (!window.PromptHubApi?.listRecentGenerationJobs) return false;
    if (!window.PointsSystem?.useApiForAccount?.()) return false;
    if (resumeGenJobsInflight) return resumeGenJobsInflight;

    resumeGenJobsInflight = (async () => {
      for (const job of imageGenPendingJobs.slice()) {
        if (!job.jobId || activePollJobIds.has(job.jobId)) continue;
        void pollGenerationJobUntilDone(job.jobId, job.id, pendingJobToPollCtx(job));
      }

      const r = await window.PromptHubApi.listRecentGenerationJobs();
      if (!r?.ok || !Array.isArray(r.data?.jobs)) return false;

      let changed = false;
      const apiById = new Map();
      const attachedJobIds = new Set();

      for (const job of r.data.jobs) {
        if (!job?.id) continue;
        apiById.set(job.id, job);
        if (isGenerationJobDeleted(job.id)) continue;

        if (job.status === 'processing') {
          const hasCreation = creations.some((c) => c.jobId === job.id);
          if (hasCreation || hasWarehouseCardForJob(job.id)) continue;
          let pending = imageGenPendingJobs.find((j) => j.jobId === job.id);
          if (!pending) {
            const pendingId = genId('pending');
            pending = {
              id: pendingId,
              jobId: job.id,
              prompt: job.prompt || '',
              model: job.model || 'quanneng2',
              modelLabel: job.modelLabel || '全能模型2',
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
          attachedJobIds.add(job.id);
          if (!activePollJobIds.has(job.id)) {
            void pollGenerationJobUntilDone(job.id, pending.id, pendingJobToPollCtx(pending));
          }
          continue;
        }

        if (job.status !== 'completed' || !job.imageUrl) continue;
        if (!shouldAutoRecoverCompletedJob(job)) continue;

        const existingCard = (window.__promptHubCards || []).find((c) => c.genJobId === job.id);
        if (existingCard && hasWarehouseCardForJob(job.id)) continue;
        if (!existingCard && creations.some((c) => c.jobId === job.id)) continue;

        changed = true;
        attachedJobIds.add(job.id);
        imageGenPendingJobs = imageGenPendingJobs.filter((p) => p.jobId !== job.id);
        if (existingCard && !existingCard.image) {
          await repairWarehouseCardImageFromJob(existingCard, job.imageUrl, job.id);
          continue;
        }
        await finishImageGenRun({
          prompt: job.prompt || '',
          model: job.model || 'quanneng2',
          resolution: job.resolution || '1k',
          quality: job.quality || 'standard',
          size: job.size || '1:1',
          cost: job.creditsCharged || 0,
          jobId: job.id,
          image: job.imageUrl,
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
        const match = processingOnApi.find(
          (j) => !attachedJobIds.has(j.id) && (j.prompt || '').trim() === (p.prompt || '').trim()
        );
        if (!match) continue;
        p.jobId = match.id;
        trackSessionGenJob(match.id);
        attachedJobIds.add(match.id);
        changed = true;
        if (!activePollJobIds.has(match.id)) {
          void pollGenerationJobUntilDone(match.id, p.id, pendingJobToPollCtx(p));
        }
      }

      const before = imageGenPendingJobs.length;
      imageGenPendingJobs = imageGenPendingJobs.filter((p) => {
        if (!p.jobId) {
          return Date.now() - (p.startedAt || 0) < 15 * 60 * 1000;
        }
        const aj = apiById.get(p.jobId);
        if (!aj) return true;
        return aj.status === 'processing';
      });
      if (imageGenPendingJobs.length !== before) {
        persistPendingGenJobs();
        changed = true;
      } else if (changed) {
        persistPendingGenJobs();
      }

      if (changed) {
        renderImageGenFeed({ preserveScroll: true });
      }
      return true;
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
    mountFeatureSidePanel('creationsSidePanel');
    document.getElementById('creationsSidePanel')?.classList.remove('hidden');
    document.body.classList.add('community-panel-open');
    if (isMobileFeaturePanel()) window.MobileUI?.closeDrawers?.();
    void renderCreationsSidePanel(id);
    scheduleCommunityLayout('creationsGrid');
  }

  function closeCreationsSidePanel() {
    document.getElementById('creationsSidePanel')?.classList.add('hidden');
    unmountFeatureSidePanel('creationsSidePanel');
    document.body.classList.remove('community-panel-open');
    creationsSideId = null;
    communitySidePostId = null;
    openPostId = null;
    document.querySelectorAll('#creationsGrid .community-post-card.selected').forEach(el => el.classList.remove('selected'));
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
        : '你在卡片库公开到社区的作品 · 点击卡片查看详情与点赞数';
    }
    if (user.id === 'guest') {
      if (creationsMasonry) {
        creationsMasonry.destroy();
        creationsMasonry = null;
      }
      closeCreationsSidePanel();
      container.innerHTML = '<div class="feature-empty"><p>请先登录后查看发布作品</p><button type="button" class="btn btn-primary" onclick="openAuthModal()">登录</button></div>';
      return;
    }
    const list = getMyPublishedPosts();
    const sig = feedListSignature(list, 'creationsGrid');
    if (container.dataset.feedSig === sig && container.querySelector('.community-post-card')) {
      patchFeedLikeLabels(container, list);
      return;
    }
    renderLikeRewardRules();
    if (creationsMasonry) {
      creationsMasonry.destroy();
      creationsMasonry = null;
    }
    if (!list.length) {
      closeCreationsSidePanel();
      container.innerHTML = '<div class="feature-empty"><p>暂无发布作品</p><p class="panel-hint">在卡片库保存作品并开启「发布到提示词社区」，或在生图页开启「生成后公开」</p><button type="button" class="btn btn-primary" onclick="switchAppPage(\'warehouse\')">去卡片库</button></div>';
      return;
    }
    void renderPostsIntoContainer(list, 'creationsGrid');
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
    creations = creations.filter(c => c.id !== id);
    persistCreations();
    if (window.SupabaseSync?.isLoggedIn?.() && typeof window.pushToCloud === 'function') {
      void window.pushToCloud({ skipSafety: true }).catch(() => {
        if (typeof window.scheduleCloudPush === 'function') window.scheduleCloudPush();
      });
    }
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

  function initImageGenForm() {
    resetImageGenSubmitState();
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
      const modelEl = document.getElementById('imageGenModel');
      if (modelEl && draft.model) modelEl.value = draft.model;
      const szEl = document.getElementById('imageGenSize');
      if (szEl && draft.size) szEl.value = draft.size;
      const countEl = document.getElementById('imageGenCount');
      if (countEl && draft.count) {
        const c = Math.min(5, Math.max(1, Number(draft.count) || 1));
        countEl.value = String(c);
      }
    }
    bindImageGenUpload();
    bindImageGenPromptTools();
    window.ImageGenPromptTools?.init?.();
    bindImageGenGenPublic();
    syncImageGenGenPublicUI();
    updateImageGenPricingUI();
    applyImageGenPrefill();
    updateImageGenFeedHint();
    syncImageGenGenPublicFromPrompt();
    renderImageGenFeed();
    window.PointsSystem?.updateCreditsUI?.();
  }

  function getImageGenQuality() {
    return document.getElementById('imageGenQuality')?.value || 'standard';
  }

  function getImageGenModel() {
    return document.getElementById('imageGenModel')?.value || 'quanneng2';
  }

  function normalizeImageGenResolution(res) {
    const r = String(res || '1k').toLowerCase();
    return ['1k', '2k', '4k'].includes(r) ? r : '1k';
  }

  function getImageGenFormMeta() {
    const rawRes = document.getElementById('imageGenResolution')?.value || '1k';
    return {
      model: getImageGenModel(),
      resolution: normalizeImageGenResolution(rawRes),
      quality: getImageGenQuality(),
      size: document.getElementById('imageGenSize')?.value || '1:1'
    };
  }

  function getImageGenPrimaryRef() {
    return imageGenRefImages[0] || null;
  }

  function updateImageGenResolutionSelect() {
    const sel = document.getElementById('imageGenResolution');
    if (!sel) return;
    const current = sel.value || '1k';
    const resolutions = ['1k', '2k', '4k'];
    sel.innerHTML = '';
    resolutions.forEach(res => {
      const opt = document.createElement('option');
      opt.value = res;
      opt.textContent = res.toUpperCase();
      sel.appendChild(opt);
    });
    if (resolutions.includes(current)) sel.value = current;
    else sel.value = '1k';
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

  function applyImageGenCostDisplay(detail, final, quality, size) {
    const hint = document.getElementById('imageGenCostHint');
    const btn = document.getElementById('imageGenSubmit');
    const inspireBtn = document.getElementById('imageGenInspireSubmit');
    const count = getImageGenBatchCount();
    const total = final * count;
    const submitLabel = count > 1
      ? `生成 ${count} 张 · ${total} 积分`
      : `生成图片 · ${final} 积分`;
    if (btn && !btn.disabled && !imageGenBatchRunning) btn.textContent = submitLabel;
    if (inspireBtn && !inspireBtn.disabled && !imageGenBatchRunning) {
      inspireBtn.textContent = `生成图片 · ${final} 积分`;
    }
    if (!hint) return;
    const modelLabel = detail?.modelLabel || '全能模型2';
    const sizeLabel =
      document.getElementById('imageGenSize')?.selectedOptions?.[0]?.textContent?.trim() || size;
    const qualLabel =
      { standard: '标准', high: '高清', ultra: '超清' }[quality] || quality;
    const parts = [modelLabel, qualLabel, sizeLabel];
    if (count > 1) parts.push(`${count} 张 · 共 ${total} 积分（${final}/张）`);
    if (detail?.saved > 0 && detail.label) {
      parts.push(`会员${detail.label} 省 ${detail.saved}/张`);
    } else if (detail?.fixed) {
      parts.push('固定价');
    }
    if (imageGenRefImages.length) {
      parts.push(`参考图 ${imageGenRefImages.length} 张`);
    }
    hint.textContent = parts.join(' · ');
  }

  function updateImageGenCostHint() {
    const { model, resolution, quality, size } = getImageGenFormMeta();
    const detail = window.PointsSystem?.getImageGenCostDetail?.(model, resolution);
    const final = detail?.final ?? 10;
    applyImageGenCostDisplay(detail, final, quality, size);
    window.ImageGenPromptTools?.updateBatchCostLabel?.();
    clearTimeout(imageGenCostDebounceTimer);
    imageGenCostDebounceTimer = setTimeout(() => {
      void refreshImageGenCostFromApi(model, resolution, quality, size);
    }, 800);
  }

  const GEN_COST_QUOTE_TIMEOUT_MS = 6000;
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
      const expectedBase = local?.base;
      if (quote.data.base != null && expectedBase != null && quote.data.base !== expectedBase) {
        return;
      }

      const detail = Object.assign({}, local || {}, {
        base: quote.data.base ?? local?.base,
        final: quote.data.final,
        saved:
          quote.data.base != null && quote.data.base > quote.data.final
            ? quote.data.base - quote.data.final
            : local?.saved,
        label: quote.data.discountLabel || local?.label,
        modelLabel: quote.data.modelLabel || local?.modelLabel
      });
      applyImageGenCostDisplay(detail, quote.data.final, quality, size);
    } catch (e) { /* 保持本地估价 */ }
  }

  function updateImageGenPricingUI() {
    updateImageGenResolutionSelect();
    updateImageGenCostHint();
  }

  window.updateImageGenPricingUI = updateImageGenPricingUI;

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

  function fillFormFromData({ prompt, refImage, refImages, model, resolution, quality, size, sourceId, sourceType }) {
    const promptEl = document.getElementById('imageGenPrompt');
    if (promptEl) promptEl.value = prompt || '';
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

  function fillFormRefOnly(refImage, refImages) {
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

  async function addImageGenRefFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => f.type && f.type.startsWith('image/'));
    if (!files.length) return;
    let added = 0;
    for (const f of files) {
      if (imageGenRefImages.length >= MAX_REF_IMAGES) {
        toast(`最多 ${MAX_REF_IMAGES} 张参考图`);
        break;
      }
      if (f.size > 12 * 1024 * 1024) {
        toast(`「${f.name || '图片'}」超过 12MB，已跳过`);
        continue;
      }
      try {
        const url = await readFileAsDataUrl(f);
        imageGenRefImages.push(url);
        added++;
      } catch (e) { /* ignore */ }
    }
    if (added) {
      renderImageGenRefGallery();
      if (added > 1) toast(`已添加 ${added} 张参考图`);
    }
  }

  function removeImageGenRefAt(idx) {
    imageGenRefImages.splice(idx, 1);
    renderImageGenRefGallery();
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
        <button type="button" class="imagegen-ref-preview-btn" data-ref-idx="${i}" title="点击放大">
          <img src="${esc(src)}" alt="参考图 ${i + 1}">
        </button>
        <button type="button" class="imagegen-ref-rm" data-ref-idx="${i}" aria-label="移除">×</button>
      </div>
    `).join('');
    gallery.querySelectorAll('.imagegen-ref-preview-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const src = imageGenRefImages[Number(btn.dataset.refIdx)];
        if (src && typeof window.openLightbox === 'function') window.openLightbox(src);
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
                return window.SupabaseSync.resolveDisplayUrl(fixed);
              }
            }
            return src;
          }
          if (window.SupabaseSync?.isStorageRef?.(src)) {
            return window.SupabaseSync.resolveDisplayUrl(src);
          }
          if (window.SupabaseSync?.isDataUrl?.(src)) {
            if (window.SupabaseSync?.isLoggedIn?.() && window.SupabaseSync?.uploadImageGenRef) {
              const stored = await window.SupabaseSync.uploadImageGenRef(genId('ref'), src);
              return window.SupabaseSync.resolveDisplayUrl(stored);
            }
            return src;
          }
          if (String(src).startsWith('blob:')) {
            if (window.SupabaseSync?.isLoggedIn?.() && window.SupabaseSync?.uploadImageGenRef) {
              const stored = await window.SupabaseSync.uploadImageGenRef(genId('ref'), src);
              return window.SupabaseSync.resolveDisplayUrl(stored);
            }
          }
          return null;
        })();
        apiUrl = await Promise.race([
          resolveOne,
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('ref resolve timeout')), REF_URL_RESOLVE_TIMEOUT_MS);
          })
        ]);
        if (apiUrl && /^https?:\/\//i.test(apiUrl)) urls.push(apiUrl);
        else if (apiUrl && window.SupabaseSync?.isDataUrl?.(apiUrl)) urls.push(apiUrl);
      } catch (e) {
        console.warn('参考图解析失败', e);
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

  async function pollGenerationJobUntilDone(jobId, pendingId, ctx) {
    if (activePollJobIds.has(jobId)) return;
    activePollJobIds.add(jobId);
    try {
    const maxAttempts = 80;
    const finishFromPoll = async (poll) => {
      if (poll.data.status === 'failed') {
        const msg = poll.data.message || poll.data.errorMessage || '生图失败，积分已全额退回';
        failPendingJob(pendingId, msg);
        await window.PointsSystem?.refreshCreditsFromServer?.();
        renderImageGenFeed({ preserveScroll: true });
        toastGenFailure(ctx, msg);
        return true;
      }
      if (poll.data.status === 'completed') {
        const imageUrl = poll.data.imageUrl;
        if (!imageUrl) {
          failPendingJob(pendingId, '生图未返回图片');
          await window.PointsSystem?.refreshCreditsFromServer?.();
          renderImageGenFeed({ preserveScroll: true });
          toastGenFailure(ctx, '生图未返回图片，若积分未退回请点同步或联系客服');
          return true;
        }
        if (ctx.jobId && creations.some(c => c.jobId === ctx.jobId)) {
          removePendingJob(pendingId);
          renderImageGenFeed({ preserveScroll: true });
          return true;
        }
        await finishImageGenRun({
          ...ctx,
          image: imageUrl,
          cost: ctx.cost,
          jobId: ctx.jobId || jobId,
          silentToast: !!ctx.silentToast,
          isRecovery: !!ctx.isRecovery,
          pendingId
        });
        return true;
      }
      return false;
    };

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 1500 : 3000));
      const poll = await window.PromptHubApi.getGenerationJob(jobId);
      if (!poll.ok) {
        if ((poll.code === 'NETWORK_ERROR' || poll.code === 'RATE_LIMITED') && i < maxAttempts - 1) {
          await new Promise(r => setTimeout(r, poll.code === 'RATE_LIMITED' ? 5000 : 2000));
          continue;
        }
        if (poll.code === 'RATE_LIMITED') {
          toast('查询进度稍慢（服务器繁忙），正在后台恢复结果…');
        } else {
          toast(poll.message || '查询生图进度失败，正在尝试恢复…');
        }
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

      if (await finishFromPoll(poll)) return;
    }

    const last = await window.PromptHubApi.getGenerationJob(jobId);
    if (last.ok && await finishFromPoll(last)) return;

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
    if (!window.PromptHubApi?.listRecentGenerationJobs) return;
    const sessionOnly = opts.sessionOnly === true;
    const manual = opts.manual === true;
    if (!sessionOnly && !manual) return;

    const r = await window.PromptHubApi.listRecentGenerationJobs();
    if (!r?.ok || !Array.isArray(r.data?.jobs)) return;

    let changed = false;
    let recovered = 0;
    for (const job of r.data.jobs) {
      if (!job?.id) continue;
      if (isGenerationJobDeleted(job.id)) continue;

      const meta = {
        prompt: job.prompt || '',
        model: job.model || 'quanneng2',
        resolution: job.resolution || '1k',
        quality: job.quality || 'standard',
        size: job.size || '1:1',
        cost: job.creditsCharged || 0,
        jobId: job.id
      };
      const inSession = isSessionGenJob(job.id);

      if (job.status === 'processing') {
        if (sessionOnly && !inSession) continue;
        if (manual) continue;
        const hasCreation = creations.some((c) => c.jobId === job.id);
        const alreadyPending = imageGenPendingJobs.some((j) => j.jobId === job.id);
        if (!alreadyPending && !hasCreation) {
          const pendingId = genId('pending');
          imageGenPendingJobs.unshift({
            id: pendingId,
            jobId: job.id,
            prompt: meta.prompt,
            model: meta.model,
            modelLabel: job.modelLabel || '全能模型2',
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

      const existingCard = (window.__promptHubCards || []).find((c) => c.genJobId === job.id);
      if (existingCard && hasWarehouseCardForJob(job.id)) continue;
      if (!existingCard && creations.some((c) => c.jobId === job.id)) continue;

      if (manual) {
        /* 用户确认后的孤儿恢复 */
      } else if (sessionOnly && inSession) {
        /* 本会话提交、轮询失败 */
      } else {
        continue;
      }

      changed = true;
      if (existingCard && !existingCard.image) {
        const ok = await repairWarehouseCardImageFromJob(existingCard, job.imageUrl, job.id);
        if (ok) {
          recovered += 1;
          continue;
        }
      }

      recovered += 1;
      await finishImageGenRun({
        ...meta,
        image: job.imageUrl,
        cost: meta.cost,
        silentToast: true,
        isRecovery: true
      });
    }

    if (changed) renderImageGenFeed();
    if (manual && recovered > 0) {
      toast(`已恢复 ${recovered} 张生图到卡片仓库（不重复扣积分）`);
    } else if (manual && recovered === 0 && changed) {
      toast('已更新进行中的生图任务');
    }
  }

  async function runImageGenWithPrompt(promptOverride, opts) {
    const batchOpts = opts && typeof opts === 'object' ? opts : {};
    if (!window.AuthGate?.requireAuth?.('imagegen')) return { ok: false };
    const prompt = String(
      promptOverride ?? document.getElementById('imageGenPrompt')?.value ?? ''
    ).trim();
    if (!prompt) {
      toast('请先填写提示词');
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

    try {
      const meta = getImageGenFormMeta();
      const { model, resolution, quality, size } = meta;
      let cost = window.PointsSystem?.getImageGenCost?.(model, resolution) ?? 10;
      let balance = window.PointsSystem?.getCredits?.() ?? 0;
      const useApi = window.PointsSystem?.useApiForAccount?.();

      if (useApi) {
        const quoted = await quoteGenerationCost(resolution, quality, model, cost);
        cost = quoted.cost;
        balance = window.PointsSystem?.getCredits?.() ?? 0;
      }

      if (balance < cost) {
        toast(`积分不足（需要 ${cost}，当前 ${balance}）。请使用激活码兑换`);
        return { ok: false, reason: 'credits' };
      }

      if (!useApi && !window.PointsSystem?.deductCredits?.(cost)) {
        toast('积分扣除失败');
        return { ok: false };
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
      const pendingId = genId('pending');
      const pendingJob = {
        id: pendingId,
        prompt,
        model,
        modelLabel,
        resolution,
        quality,
        size,
        cost,
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
      renderImageGenFeed();
      if (singleRun && window.MobileUI?.isMobile?.() && window.MobileUI?.setImageGenView) {
        window.MobileUI.setImageGenView('feed', { scrollToTop: true });
      }

      if (singleRun && btn) {
        btn.textContent = '提交中…';
      }

      // 先展示占位卡，API 请求放后台，避免阻塞界面
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      function friendlyGenErrorMessage(msg) {
        const s = String(msg || '');
        if (/登录已过期|请先登录|UNAUTHORIZED/i.test(s)) {
          return '登录状态已失效，请点侧栏「退出」后重新登录，或直接关闭页面再打开';
        }
        if (/insufficient balance/i.test(s) || (/insufficient/i.test(s) && /balance/i.test(s))) {
          return '生图服务商账户余额不足，请联系站长充值；您的积分已全额退回';
        }
        if (/invalid.*api.*key/i.test(s)) {
          return '生图接口密钥无效或已过期，请联系站长检查配置；您的积分已全额退回';
        }
        if (s.length > 120) return s.slice(0, 120) + '…';
        return s || '生图失败，您的积分已全额退回';
      }

      if (useApi) {
        const refSources = batchOpts.skipRefImages
          ? []
          : Array.isArray(batchOpts.refImages) && batchOpts.refImages.length
            ? batchOpts.refImages
            : imageGenRefImages;
        const refUrls = await resolveRefUrlsFromList(refSources);
        if (refSources.length && !refUrls.length) {
          failPendingJob(pendingId, '参考图无法用于生图');
          renderImageGenFeed();
          toast('参考图无法用于生图（须为网络图片），请去掉参考图或重新上传后再试');
          return { ok: false, message: '参考图无法用于生图' };
        }
        if (refSources.length && refUrls.length < refSources.length && !batchOpts.silentToast) {
          toast(`已使用 ${refUrls.length}/${refSources.length} 张参考图继续生成`);
        }
        const genPayload = {
          prompt,
          model,
          resolution,
          quality,
          size,
          refImageUrls: refUrls.length ? refUrls : undefined
        };
        let gen = await window.PromptHubApi.generateImage(genPayload);
        if (!gen.ok && batchOpts.batch) {
          const retryable = gen.code === 'RATE_LIMITED'
            || gen.status === 429
            || /过于频繁|upstream|502|503|429|rate limit/i.test(String(gen.message || ''));
          for (let attempt = 0; attempt < 2 && !gen.ok && retryable; attempt += 1) {
            await new Promise((r) => setTimeout(r, 2000 + attempt * 2500));
            gen = await window.PromptHubApi.generateImage(genPayload);
          }
        }
        if (!gen.ok) {
          const errMsg = friendlyGenErrorMessage(gen.message);
          failPendingJob(pendingId, errMsg);
          renderImageGenFeed();
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
          await finishImageGenRun({
            prompt,
            model,
            resolution,
            quality,
            size,
            image: gen.data.imageUrl,
            cost,
            jobId: gen.data.jobId,
            silentToast: batchOpts.silentToast,
            fromInspirationDraw: !!batchOpts.fromInspirationDraw,
            pendingId
          });
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
        trackSessionGenJob(jobId);
        persistPendingGenJobs();
        if (!batchOpts.silentToast) toast('已提交生图，右侧可查看进度，可继续点击生成');
        void pollGenerationJobUntilDone(jobId, pendingId, {
          prompt,
          model,
          resolution,
          quality,
          size,
          cost,
          jobId,
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
      if (!batchOpts.silentToast) {
        const msg = String(e?.message || '');
        const hint = /quota|exceeded/i.test(msg)
          ? '浏览器存储已满，已跳过草稿保存；请清除站点数据或减少参考图后重试'
          : msg || '请刷新页面后重试';
        toast('生图提交失败：' + hint);
      }
      return { ok: false, message: e?.message || 'submit failed' };
    } finally {
      if (singleRun && btn) {
        btn.disabled = false;
        restoreImageGenSubmitLabel();
      }
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
    const balance = window.PointsSystem?.getCredits?.() ?? 0;
    const totalNeed = unit * count;
    if (balance < unit) {
      toast(`积分不足（每张 ${unit}，当前 ${balance}）`);
      return;
    }
    if (balance < totalNeed) {
      toast(`积分约够 ${Math.floor(balance / unit)} 张，将按顺序提交直到不足（${unit} 积分/张）`);
    }

    imageGenBatchRunning = true;
    const btn = document.getElementById('imageGenSubmit');
    if (btn) btn.disabled = true;
    try {
      let ok = 0;
      let charged = 0;
      for (let i = 0; i < count; i += 1) {
        const curBalance = window.PointsSystem?.getCredits?.() ?? 0;
        if (curBalance < unit && i > 0) break;
        if (btn) btn.textContent = `提交中 ${i + 1}/${count}…`;
        const res = await runImageGenWithPrompt(undefined, { silentToast: true, batch: true });
        if (res?.ok) {
          ok += 1;
          charged += res.creditsCharged || unit;
        } else if (res?.reason === 'credits') {
          break;
        } else if (i === 0) {
          break;
        }
        if (i < count - 1) await new Promise((r) => setTimeout(r, 1000 + Math.floor(Math.random() * 600)));
      }
      await window.PointsSystem?.refreshCreditsFromServer?.();
      window.PointsSystem?.updateCreditsUI?.();
      if (ok > 0) {
        toast(`已提交 ${ok}/${count} 张生图，已扣约 ${charged} 积分（${unit} 积分/张）`);
        if (window.MobileUI?.isMobile?.() && window.MobileUI?.setImageGenView) {
          window.MobileUI.setImageGenView('feed', { scrollToTop: true });
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

  async function finishImageGenRun({ prompt, model, resolution, quality, size, image, cost, btn, jobId, silentToast, isRecovery, fromInspirationDraw, pendingId }) {
    if (!image) {
      toast('图片地址无效，请重试');
      return;
    }
    const jid = jobId || null;
    if (jid) {
      if (isGenerationJobDeleted(jid)) return;
      if (creations.some(c => c.jobId === jid)) {
        clearSessionGenJob(jid);
        imageGenFeedTab = 'warehouse';
        renderImageGenFeed({ preserveScroll: true });
        return;
      }
      if (finishingJobIds.has(jid)) return;
      finishingJobIds.add(jid);
    }
    try {
    const creationId = genId('cr');
    let storedImage = image;
    if (window.SupabaseSync?.persistGenerationImage) {
      try {
        storedImage = await window.SupabaseSync.persistGenerationImage(creationId, image);
      } catch (e) {
        console.warn('生成图客户端归档跳过，使用服务端/临时链接', e);
        if (window.SupabaseSync?.isStorageRef?.(image)) storedImage = image;
        else if (/^https?:\/\//i.test(image)) storedImage = image;
      }
    }
    imageGenLastResult = storedImage;
    const primaryRef = getImageGenPrimaryRef();
    const modelId = model || 'quanneng2';
    const modelLabel = window.PointsSystem?.getImageGenModel?.(modelId)?.label || modelId;
    const creation = {
      id: creationId,
      jobId: jobId || null,
      prompt,
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
      createdAt: Date.now(),
      expiresAt: Date.now() + randomGenRetentionMs()
    };
    creations = dedupeCreationsByJobId([creation, ...creations]);
    imageGenActiveHistoryId = creation.id;
    persistCreations();
    imageGenFeedTab = 'warehouse';
    document.querySelectorAll('[data-feed-tab]').forEach(b => {
      b.classList.toggle('active', b.dataset.feedTab === 'warehouse');
    });
    updateImageGenFeedHint();
    window.PointsSystem?.updateCreditsUI?.();
    if (btn) { btn.disabled = false; restoreImageGenSubmitLabel(); }
    const publish = isImageGenGenPublicChecked();
    const saved = await saveGeneratedToWarehouse({
      prompt: creation.prompt,
      image: storedImage || image,
      sourceId: creation.id,
      jobId: jid,
      title: '',
      publishToCommunity: publish,
      fromInspirationDraw: !!fromInspirationDraw,
      silentToast: !!silentToast
    });
    if (pendingId) removePendingJob(pendingId);
    renderImageGenFeed({ preserveScroll: true });
    if (isRecovery) {
      /* 恢复流程在 recoverRecentGenerationJobs 末尾统一提示 */
    } else if (!silentToast) {
      if (saved) {
        toast(publish
          ? `已生成并保存到仓库（已公开到社区，-${cost} 积分）`
          : `已生成并保存到仓库（-${cost} 积分）`);
      } else {
        toast(`已生成（-${cost} 积分）`);
      }
    }
    if (jid) clearSessionGenJob(jid);
    } finally {
      if (jid) finishingJobIds.delete(jid);
    }
  }

  function updateImageGenFeedHint() {
    const el = document.getElementById('imageGenFeedHint');
    if (!el) return;
    const mobile = window.MobileUI?.isMobile?.();
    const warehouse = imageGenFeedTab === 'warehouse';
    if (warehouse) {
      const pendingN = imageGenPendingJobs.length;
      const failedN = imageGenFailedJobs.length;
      const extra = failedN ? ` · 失败 ${failedN} 张可重试` : '';
      el.textContent = mobile
        ? `两列浏览 · 进行中 ${pendingN} 张${extra}`
        : `卡片仓库 · 进行中 ${pendingN} 张显示在顶部${extra} · 失败项带序号与提示词`;
    } else if (imageGenFeedTab === 'community') {
      el.textContent = mobile
        ? '社区作品 · 点图放大 · 按钮复制或填入生图'
        : '社区作品 · 点击图片放大 · 点击卡片查看详情';
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

  function fillFeedPromptToImageGen(prompt) {
    fillFormPromptOnly(prompt || '');
    if (window.MobileUI?.isMobile?.()) window.MobileUI?.setImageGenView?.('form');
  }

  async function fillCardToImageGen(card) {
    if (!card) return;
    if (typeof switchAppPage === 'function') switchAppPage('imagegen');
    fillFormPromptOnly(card.prompt || '');
    const ref = card.image;
    if (ref && isDisplayableImage(ref)) {
      let url = ref;
      if (window.SupabaseSync?.resolveDisplayUrl) {
        try {
          const resolved = await window.SupabaseSync.resolveDisplayUrl(ref, { assetId: card.id });
          if (resolved && !String(resolved).includes('data:image/svg')) url = resolved;
        } catch (e) { /* ignore */ }
      }
      fillFormRefOnly(url, [url]);
    }
    if (window.MobileUI?.isMobile?.()) window.MobileUI?.setImageGenView?.('form');
    toast('已填入生图（提示词与参考图）');
  }


  function buildFeedPendingCardHtml(job) {
    const badges = [job.modelLabel || '生图中', (job.resolution || '1k').toUpperCase()];
    const batchTag = batchIndexLabel(job.batchIndex, job.batchTotal);
    if (batchTag) badges.unshift(batchTag);
    const badgeHtml = badges.map(b => `<span class="imagegen-feed-badge">${esc(b)}</span>`).join('');
    const pendingLabel = batchTag ? `${batchTag} · 生成中` : '生成中';
    return `<article class="imagegen-feed-card imagegen-feed-card-tile imagegen-feed-card--pending" data-feed-id="${esc(job.id)}" data-pending="1">
      <div class="imagegen-feed-media imagegen-gen-pending" aria-busy="true">
        <span class="imagegen-gen-pending-label">${esc(pendingLabel)}</span>
      </div>
      <div class="imagegen-feed-content">
        <p class="imagegen-feed-prompt">${esc((job.prompt || '').slice(0, 120))}</p>
        <div class="imagegen-feed-tags">${badgeHtml}</div>
        <div class="imagegen-feed-foot">
          <span class="imagegen-feed-meta">预计 1–3 分钟 · 可继续提交</span>
        </div>
      </div>
    </article>`;
  }

  function buildFeedFailedCardHtml(job) {
    const batchTag = batchIndexLabel(job.batchIndex, job.batchTotal);
    const badges = [];
    if (batchTag) badges.push(batchTag);
    if (job.modelLabel) badges.push(job.modelLabel);
    badges.push('失败');
    const badgeHtml = badges.map(b => `<span class="imagegen-feed-badge imagegen-feed-badge--fail">${esc(b)}</span>`).join('');
    const err = (job.errorMessage || '生图失败').slice(0, 100);
    const failLabel = batchTag ? `${batchTag} · 失败` : '生成失败';
    return `<article class="imagegen-feed-card imagegen-feed-card-tile imagegen-feed-card--failed" data-feed-id="${esc(job.id)}" data-failed="1" data-feed-prompt="${esc(job.prompt || '')}"${job.batchIndex ? ` data-batch-index="${job.batchIndex}"` : ''}${job.batchTotal ? ` data-batch-total="${job.batchTotal}"` : ''}>
      <div class="imagegen-feed-media imagegen-gen-failed">
        <span class="imagegen-gen-failed-label">${esc(failLabel)}</span>
      </div>
      <div class="imagegen-feed-content">
        <p class="imagegen-feed-prompt">${esc((job.prompt || '').slice(0, 120))}</p>
        <p class="imagegen-gen-failed-error" title="${esc(job.errorMessage || '')}">${esc(err)}</p>
        <div class="imagegen-feed-tags">${badgeHtml}</div>
        <div class="imagegen-feed-foot imagegen-feed-foot--failed">
          <button type="button" class="btn btn-primary btn-sm" data-failed-retry>重试</button>
          <button type="button" class="btn btn-ghost btn-sm" data-failed-copy>复制提示词</button>
          <button type="button" class="btn btn-ghost btn-sm imagegen-feed-del" data-failed-dismiss title="关闭">×</button>
        </div>
      </div>
    </article>`;
  }

  function resetMobileFeedGridStyles() {
    enforceMobileImageGenFeed();
  }

  function enforceMobileImageGenFeed() {
    if (!isMobileFeedViewport()) return;
    if (imageGenMasonry) {
      imageGenMasonry.destroy();
      imageGenMasonry = null;
    }
    const wrap = document.getElementById('imageGenFeed');
    if (!wrap) return;
    wrap.classList.remove('imagegen-feed--masonry');
    wrap.classList.add('imagegen-feed--tiles', 'mobile-feed-grid');
    wrap.removeAttribute('style');
    wrap.querySelectorAll('.grid-sizer').forEach((el) => el.remove());
    wrap.querySelectorAll('.imagegen-feed-card').forEach((el) => el.removeAttribute('style'));
  }

  function buildFeedCardHtml(opts) {
    const {
      id, prompt, image, jobId, title, badges = [], metaLine = '', meta = '', active = false,
      showLike = false, liked = false, likeCount = 0, showSave = false, showDel = false
    } = opts;
    const { showTitle, showPrompt } = resolveFeedCardDisplay(title, prompt);
    const storageAttr = feedImgStorageAttr(image);
    const jobAttr = jobId ? ` data-job-id="${esc(jobId)}"` : '';
    const imgSrc = isDisplayableImage(image) ? IMG_LOADING_PLACEHOLDER : '';
    const loadingCls = isDisplayableImage(image) ? ' is-loading' : '';
    const shineAt = loadingCls ? ` data-shine-at="${Date.now()}"` : '';
    const imgBlock = isDisplayableImage(image)
      ? `<div class="imagegen-feed-media${loadingCls}"${shineAt}><button type="button" class="imagegen-feed-thumb-btn" title="放大预览"><img src="${esc(imgSrc || IMG_LOADING_PLACEHOLDER)}" data-image-ref="${esc(image)}"${storageAttr}${jobAttr} alt="" decoding="async" loading="lazy" onload="if(typeof finishCardMediaShine==='function')finishCardMediaShine(this.closest('.imagegen-feed-media'));else this.closest('.imagegen-feed-media')?.classList.remove('is-loading')"></button></div>`
      : '';
    const badgeHtml = badges.map(b => `<span class="imagegen-feed-badge">${esc(b)}</span>`).join('');
    const metaRowHtml = (metaLine || '').trim()
      ? `<p class="imagegen-feed-meta-row">${esc(metaLine.trim())}</p>`
      : (badgeHtml ? `<div class="imagegen-feed-tags">${badgeHtml}</div>` : '');
    const metaTrim = (meta || '').trim();
    const metaRedundant = !metaTrim || badges.some(b => b === metaTrim) || metaTrim === showTitle;
    const metaHtml = metaTrim && !metaRedundant
      ? `<span class="imagegen-feed-meta">${esc(metaTrim)}</span>`
      : '';
    const likeBtn = showLike
      ? `<button type="button" class="imagegen-feed-like ${liked ? 'liked' : ''}" data-like-id="${esc(id)}" title="点赞">♥ ${likeCount}</button>`
      : '';
    const saveBtn = showSave
      ? '<button type="button" class="btn btn-ghost btn-sm imagegen-feed-save-btn" data-save-feed="1">存仓库</button>'
      : '';
    const delBtn = showDel
      ? '<button type="button" class="imagegen-feed-del" data-delete-feed="1" title="删除" aria-label="删除">×</button>'
      : '';
    const titleHtml = showTitle
      ? `<p class="imagegen-feed-title">${esc(showTitle)}</p>`
      : '';
    const promptHtml = showPrompt
      ? `<p class="imagegen-feed-prompt">${esc(showPrompt)}</p>`
      : '<p class="imagegen-feed-prompt imagegen-feed-prompt--empty">暂无提示词</p>';
    const noMedia = !imgBlock ? ' imagegen-feed-card--no-media' : '';
    const mobileActs = window.MobileUI?.isMobile?.()
      ? `<div class="imagegen-feed-mobile-actions mobile-only">
          <button type="button" class="imagegen-feed-mobile-btn" data-feed-copy>复制</button>
          <button type="button" class="imagegen-feed-mobile-btn" data-feed-fill-prompt>填入生图</button>
        </div>`
      : '';
    const fillHint = window.MobileUI?.isMobile?.()
      ? ''
      : '<span class="imagegen-feed-fill-hint">点击查看详情 · 在侧栏填入或复制</span>';
    return `<article class="imagegen-feed-card imagegen-feed-card-tile${noMedia}${active ? ' active' : ''}" data-feed-id="${esc(id)}" data-feed-prompt="${esc(prompt || '')}" tabindex="0">
      ${imgBlock}
      <div class="imagegen-feed-content">
        ${titleHtml}
        ${promptHtml}
        ${metaRowHtml}
        <div class="imagegen-feed-foot">
          ${metaHtml}
          <div class="imagegen-feed-actions">${likeBtn}${saveBtn}${delBtn}</div>
        </div>
        ${mobileActs}
        ${fillHint}
      </div>
    </article>`;
  }

  function closeImageGenPreview() {
    imageGenPreviewId = null;
    imageGenPreviewKind = null;
    document.getElementById('imageGenPreviewPanel')?.classList.add('hidden');
    document.querySelector('.imagegen-side')?.classList.remove('imagegen-preview-open');
    document.querySelectorAll('.imagegen-feed-card.active-preview').forEach(el => el.classList.remove('active-preview'));
    if (isMobileFeedViewport()) enforceMobileImageGenFeed();
    else requestAnimationFrame(() => scheduleImageGenFeedLayout());
  }

  async function downloadImageFromUrl(url, filename) {
    if (!url) return;
    try {
      const res = await fetch(url, { mode: 'cors' });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || `prompt-hub-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      if (typeof showToast === 'function') showToast('图片已开始下载');
    } catch (e) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.download = filename || `prompt-hub-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (typeof showToast === 'function') showToast('若未自动下载，请在新标签页右键保存');
    }
  }

  function buildPreviewFillActions(hasRef, extraActionsHtml) {
    const refDisabled = hasRef ? '' : ' disabled title="暂无参考图"';
    return `
      <div class="imagegen-preview-copy-row">
        <button type="button" class="btn btn-secondary btn-sm" data-preview-copy-prompt>复制提示词</button>
        <button type="button" class="btn btn-ghost btn-sm" data-preview-download>下载图片</button>
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

  async function renderImageGenPreview() {
    const body = document.getElementById('imageGenPreviewBody');
    if (!body || !imageGenPreviewId || !imageGenPreviewKind) return;
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
        <button type="button" class="btn btn-secondary btn-sm" data-preview-like>♥ ${liked ? '已赞' : '点赞'}</button>`;
    } else {
      const rawId = imageGenPreviewId.replace(/^wh_/, '');
      const c = (window.getWarehouseCardsForImageGen?.() || []).find(x => x.id === rawId);
      if (!c) { closeImageGenPreview(); return; }
      prompt = c.prompt || '';
      image = c.image || '';
      if (isDisplayableImage(c.image)) refImage = c.image;
    }
    const hasRef = !!(refImages?.length || (refImage && isDisplayableImage(refImage)));
    const fillHtml = buildPreviewFillActions(hasRef, extraActions);
    const imgHtml = isDisplayableImage(image)
      ? `<button type="button" class="imagegen-preview-img-btn" data-preview-zoom title="点击放大"><span class="media-skeleton"></span></button>`
      : '';
    body.innerHTML = `${imgHtml}<div class="imagegen-preview-prompt">${esc(prompt)}</div>${fillHtml}`;
    body.dataset.previewPrompt = prompt;
    body.dataset.previewRef = refImage || '';
    if (refImages?.length) body.dataset.previewRefs = JSON.stringify(refImages);
    else delete body.dataset.previewRefs;
    const zoomBtn = body.querySelector('[data-preview-zoom]');
    if (zoomBtn && isDisplayableImage(image)) {
      void resolveImageDisplayUrl(image, jobId, imageGenPreviewId).then(url => {
        if (!url) {
          zoomBtn.remove();
          body.querySelector('[data-preview-download]')?.remove();
          return;
        }
        body.dataset.previewImageUrl = url;
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        zoomBtn.replaceChildren(img);
        zoomBtn.addEventListener('click', () => {
          if (typeof window.openLightbox === 'function') window.openLightbox(url);
        });
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
      fillFormFromData({
        prompt: body.dataset.previewPrompt || '',
        refImages: ri.length ? ri : undefined,
        refImage: ri.length ? undefined : r1
      });
    });
    body.querySelector('[data-preview-fill-prompt]')?.addEventListener('click', () => {
      fillFormPromptOnly(body.dataset.previewPrompt || '');
    });
    body.querySelector('[data-preview-fill-ref]')?.addEventListener('click', () => {
      const { refImages: ri, refImage: r1 } = getPreviewRefs();
      fillFormRefOnly(r1, ri);
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
    body.querySelector('[data-preview-download]')?.addEventListener('click', () => {
      const url = body.dataset.previewImageUrl || zoomBtn?.querySelector('img')?.src || '';
      void downloadImageFromUrl(url, `prompt-hub-gen-${Date.now()}.png`);
    });
  }

  function bindImageGenPreviewWheelScroll() {
    const side = document.querySelector('.imagegen-side');
    if (!side || side.dataset.previewWheelBound === '1') return;
    side.dataset.previewWheelBound = '1';
    side.addEventListener('wheel', (e) => {
      if (!side.classList.contains('imagegen-preview-open')) return;
      if (e.target.closest('.imagegen-preview-panel')) return;
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
    document.querySelectorAll('.imagegen-feed-card').forEach(el => {
      const fid = el.dataset.feedId;
      el.classList.toggle('active-preview', kind === 'warehouse' ? fid === 'wh_' + id : fid === id);
    });
    void renderImageGenPreview();
    if (!isMobileFeedViewport()) {
      requestAnimationFrame(() => scheduleImageGenFeedLayout());
      setTimeout(() => scheduleImageGenFeedLayout(), 120);
      setTimeout(() => scheduleImageGenFeedLayout(), 400);
    }
  }

  function closeImageGenFilterSheet() {
    const overlay = document.getElementById('imageGenFilterSheetOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.hidden = true;
  }

  function openImageGenFilterSheet(kind) {
    if (!isMobileFeedViewport()) return;
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

  async function renderImageGenFeed(opts = {}) {
    const preserveScroll = opts.preserveScroll !== false;
    const wrap = document.getElementById('imageGenFeed');
    if (!wrap) return;
    const scrollTop = preserveScroll ? wrap.scrollTop : 0;
    syncImageGenWarehouseFiltersUI();
    syncImageGenCommunityFiltersUI();
    let html = '';
    if (imageGenFeedTab === 'warehouse') {
      const pending = imageGenPendingJobs.slice(0, 16);
      const failed = imageGenFailedJobs.slice(0, 12);
      const list = typeof window.getWarehouseCardsForImageGen === 'function'
        ? window.getWarehouseCardsForImageGen({ group: imageGenWhGroup, tag: imageGenWhTag }).slice(0, IMAGEGEN_WH_FEED_MAX) : [];
      if (!pending.length && !failed.length && !list.length) {
        html = '<p class="imagegen-feed-empty">仓库暂无卡片<br><button type="button" class="btn btn-primary btn-sm" onclick="createNewCard({forceOpenPanel:true})">新建卡片</button></p>';
      } else {
        html = pending.map(j => buildFeedPendingCardHtml(j)).join('')
          + failed.map(j => buildFeedFailedCardHtml(j)).join('')
          + list.map(c => {
          const groupLabel = c.group || '未分类';
          const titleTrim = (c.title || '').trim();
          const tagPart = (c.tags || []).slice(0, 2).join(' · ');
          const whMeta = tagPart ? `${groupLabel} · ${tagPart}` : groupLabel;
          return buildFeedCardHtml({
            id: 'wh_' + c.id,
            prompt: c.prompt,
            image: c.image,
            title: titleTrim,
            metaLine: whMeta,
            meta: ''
          });
        }).join('');
      }
    } else if (imageGenFeedTab === 'community') {
      const list = filterAndSortPosts(getCommunityFeedForDisplay()).slice(0, 40);
      if (!list.length) {
        const emptyMsg = communityScope === 'following'
          ? '暂无关注作者的作品'
          : '社区暂无内容';
        html = `<p class="imagegen-feed-empty">${esc(emptyMsg)}</p>`;
      } else {
        html = list.map(p => {
          const postTitle = (p.title || '').trim();
          const useTitle = postTitle && !isGenericPostTitle(postTitle) ? postTitle : '';
          const author = (p.authorName || '').trim() || '用户';
          const model = (p.modelLabel || '全能模型2').trim();
          return buildFeedCardHtml({
            id: p.id,
            prompt: p.prompt,
            image: p.image,
            title: useTitle,
            metaLine: `${author} · ${model}`,
            meta: `♥ ${p.likes || 0} · ${formatTime(p.createdAt)}`,
            showLike: true,
            liked: likedIds.has(p.id),
            likeCount: p.likes || 0
          });
        }).join('');
      }
    }
    const refsToPrefetch = [];
    if (imageGenFeedTab === 'warehouse') {
      (typeof window.getWarehouseCardsForImageGen === 'function'
        ? window.getWarehouseCardsForImageGen({ group: imageGenWhGroup, tag: imageGenWhTag }) : []
      ).forEach(c => { if (c.image) refsToPrefetch.push(c.image); });
    } else if (imageGenFeedTab === 'community') {
      filterAndSortPosts(getCommunityFeedForDisplay()).slice(0, 40).forEach(p => { if (p.image) refsToPrefetch.push(p.image); });
    }
    const mobileFeed = isMobileFeedViewport();
    const prefetchLimit = imageGenBatchRunning ? 16 : mobileFeed ? 24 : 32;
    const refsSlice = refsToPrefetch.slice(0, prefetchLimit);

    resetImageGenFeedCardLayout();
    setFeedLayoutPending(wrap, true);
    wrap.className = mobileFeed
      ? 'imagegen-feed imagegen-feed--tiles mobile-feed-grid feed-layout-pending'
      : 'imagegen-feed imagegen-feed--masonry feed-layout-pending';

    wrap.innerHTML = html;
    resetMobileFeedGridStyles();
    bindImageGenFeedCardEvents(wrap);
    bindImageGenFeedImageRelayout();
    if (mobileFeed) {
      enforceMobileImageGenFeed();
      setFeedLayoutPending(wrap, false);
    } else {
      layoutImageGenFeedMasonry();
    }
    wrap.scrollTop = scrollTop;

    void (async () => {
      const prefetchPromise = refsSlice.length && window.SupabaseSync?.prefetchDisplayUrlsWithCap
        ? window.SupabaseSync.prefetchDisplayUrlsWithCap(refsSlice, mobileFeed ? 8000 : 3500)
        : refsSlice.length && window.SupabaseSync?.prefetchDisplayUrls
          ? window.SupabaseSync.prefetchDisplayUrls(refsSlice)
          : Promise.resolve();
      const hydrateP = hydrateFeedImages(wrap);
      await Promise.race([
        prefetchPromise,
        new Promise((r) => setTimeout(r, mobileFeed ? 280 : 1200))
      ]);
      window.SupabaseSync?.patchImageSrcFromCache?.(wrap);
      await hydrateP;
      bindImageGenFeedImageRelayout();
      if (mobileFeed) {
        enforceMobileImageGenFeed();
        setFeedLayoutPending(wrap, false);
      } else {
        layoutImageGenFeedMasonry();
      }
      wrap.scrollTop = scrollTop;
      window.SupabaseSync?.patchImageSrcFromCache?.(wrap);
    })();
  }

  function bindImageGenFeedCardEvents(wrap) {
    if (!wrap) return;
    wrap.querySelectorAll('.imagegen-feed-card[data-failed="1"]').forEach(card => {
      const failId = card.dataset.feedId;
      const prompt = card.dataset.feedPrompt || '';
      card.querySelector('[data-failed-retry]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        fillFeedPromptToImageGen(prompt);
        const label = batchIndexLabel(
          Number(card.dataset.batchIndex) || null,
          Number(card.dataset.batchTotal) || null
        );
        toast(label ? `${label} 已填入提示词，可再次生图` : '已填入提示词，可再次生图');
      });
      card.querySelector('[data-failed-copy]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        copyFeedPromptText(prompt);
      });
      card.querySelector('[data-failed-dismiss]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFailedGenJob(failId);
        renderImageGenFeed({ preserveScroll: true });
      });
    });
    wrap.querySelectorAll('.imagegen-feed-card').forEach(card => {
      if (card.dataset.pending === '1' || card.dataset.failed === '1') return;
      const feedId = card.dataset.feedId;
      card.querySelector('.imagegen-feed-thumb-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        const btnEl = e.currentTarget;
        const imgEl = btnEl.querySelector('img');
        const rawRef = imgEl?.getAttribute('data-image-ref');
        const jobId = imgEl?.getAttribute('data-job-id');
        const src = imgEl?.src && !imgEl.src.startsWith('data:image/svg') ? imgEl.src : '';
        void (async () => {
          let url = src;
          if (rawRef) url = await resolveImageDisplayUrl(rawRef, jobId, card.dataset.feedId?.replace(/^wh_/, ''));
          if (url && typeof window.openLightbox === 'function') window.openLightbox(url);
        })();
      });
      card.querySelector('[data-feed-copy]')?.addEventListener('click', e => {
        e.stopPropagation();
        copyFeedPromptText(card.dataset.feedPrompt || '');
      });
      card.querySelector('[data-feed-fill-prompt]')?.addEventListener('click', e => {
        e.stopPropagation();
        fillFeedPromptToImageGen(card.dataset.feedPrompt || '');
      });
      card.addEventListener('click', e => {
        if (e.target.closest('.imagegen-feed-like')) return;
        if (e.target.closest('.imagegen-feed-thumb-btn')) return;
        if (e.target.closest('.imagegen-feed-save-btn')) return;
        if (e.target.closest('[data-delete-feed]')) return;
        if (e.target.closest('.imagegen-feed-mobile-actions')) return;
        if (window.MobileUI?.isMobile?.()) return;
        if (imageGenFeedTab === 'warehouse') {
          openImageGenPreview('warehouse', feedId.replace(/^wh_/, ''));
        } else if (imageGenFeedTab === 'community') {
          openImageGenPreview('community', feedId);
        }
      });
      card.querySelector('.imagegen-feed-like')?.addEventListener('click', e => {
        e.stopPropagation();
        likeCommunityPostOnly(feedId);
      });
    });
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
    document.querySelectorAll('[data-community-sort]').forEach(btn => {
      btn.addEventListener('click', () => {
        applyCommunitySort(btn.dataset.communitySort);
        renderCommunity({ skipFeedFetch: true });
        if (document.getElementById('pageImageGen')?.classList.contains('active')) renderImageGenFeed();
      });
    });
    document.querySelectorAll('[data-community-scope]').forEach(btn => {
      btn.addEventListener('click', () => {
        communityScope = btn.dataset.communityScope || 'all';
        document.querySelectorAll('[data-community-scope]').forEach(b => {
          b.classList.toggle('active', b === btn);
        });
        document.querySelectorAll('[data-imagegen-community-scope]').forEach(b => {
          b.classList.toggle('active', (b.dataset.imagegenCommunityScope || 'all') === communityScope);
        });
        closeCommunitySidePanel();
        renderCommunity({ skipFeedFetch: true });
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
    document.getElementById('imageGenResolution')?.addEventListener('change', updateImageGenPricingUI);
    document.querySelectorAll('[data-feed-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        imageGenFeedTab = btn.dataset.feedTab;
        document.querySelectorAll('[data-feed-tab]').forEach(b => b.classList.toggle('active', b === btn));
        closeImageGenPreview();
        updateImageGenFeedHint();
        renderImageGenFeed();
      });
    });
    document.querySelectorAll('[data-imagegen-community-sort]').forEach(btn => {
      btn.addEventListener('click', () => {
        applyCommunitySort(btn.dataset.imagegenCommunitySort);
        document.querySelectorAll('[data-imagegen-community-sort]').forEach(b => b.classList.toggle('active', b === btn));
        renderImageGenFeed();
        if (document.getElementById('pageCommunity')?.classList.contains('active')) renderCommunity();
      });
    });
    document.querySelectorAll('[data-imagegen-community-scope]').forEach(btn => {
      btn.addEventListener('click', () => {
        communityScope = btn.dataset.imagegenCommunityScope || 'all';
        document.querySelectorAll('[data-imagegen-community-scope]').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('[data-community-scope]').forEach(b => {
          b.classList.toggle('active', (b.dataset.communityScope || 'all') === communityScope);
        });
        renderImageGenFeed();
        if (document.getElementById('pageCommunity')?.classList.contains('active')) renderCommunity();
      });
    });
    document.getElementById('imageGenPreviewClose')?.addEventListener('click', closeImageGenPreview);
    bindImageGenPreviewWheelScroll();
    document.getElementById('appreciateViewerFavBtn')?.addEventListener('click', () => {
      if (!appreciateViewerPostId) return;
      const post = findPost(appreciateViewerPostId);
      if (!post) return;
      favoritePost(appreciateViewerPostId, post);
      window.markQuickPreviewTask?.({ communityFavorited: true });
      const btn = document.getElementById('appreciateViewerFavBtn');
      if (btn && favIds.has(appreciateViewerPostId)) {
        btn.textContent = '已收藏';
        btn.disabled = true;
      }
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
    document.getElementById('imageGenModel')?.addEventListener('change', updateImageGenPricingUI);
    document.getElementById('imageGenResolution')?.addEventListener('input', updateImageGenCostHint);
    document.getElementById('imageGenQuality')?.addEventListener('change', updateImageGenCostHint);
    document.getElementById('imageGenSize')?.addEventListener('change', updateImageGenCostHint);
    window.addEventListener('resize', () => {
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
      else if (document.body.classList.contains('community-panel-open')) closeCommunitySidePanel();
    });
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
    if (app !== 'community' && communityAppreciateActive) {
      window.closeAppreciateViewer?.();
      exitCommunityAppreciate(true);
    }
    if (app === 'community') {
      if (!document.getElementById('pageCommunity')?.classList.contains('active')) return;
      ensureCommunityFromCards();
      renderCommunity({ immediate: true, skipFeedFetch: true, syncFromCards: true });
      void refreshPublicCommunityFeed({ force: false }).then((changed) => {
        if (changed) renderCommunity({ skipFeedFetch: true });
      });
      const warmPosts = filterAndSortPosts(getCommunityFeedForDisplay()).slice(0, 24);
      const warmCards = warmPosts.map((p) => ({
        id: p.sourceCardId || p.id,
        image: canonicalCommunityImageRef(p) || p.image,
        sourceCardId: p.sourceCardId,
        authorId: p.authorId
      })).filter((c) => c.image);
      if (warmCards.length && window.SupabaseSync?.prefetchCommunityDisplayUrls) {
        void window.SupabaseSync.prefetchCommunityDisplayUrls(warmCards, 4000);
      } else if (warmCards.length && window.SupabaseSync?.prefetchCardsImages) {
        void window.SupabaseSync.prefetchCardsImages(warmCards, 4000);
      }
      window.CommunityGacha?.init?.();
      window.CommunityGacha?.refreshEntryButton?.();
    }
    if (app === 'creations') {
      if (!document.getElementById('pageCreations')?.classList.contains('active')) return;
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
    if (app !== 'imagegen') closeImageGenPreview();
    if (app === 'imagegen') {
      if (!document.getElementById('pageImageGen')?.classList.contains('active')) return;
      imageGenGenPublicSession = null;
      syncImageGenGenPublicUI();
      window.MobileUI?.initImageGenMobileView?.();
      pruneCreations();
      initImageGenForm();
      updateImageGenFeedHint();
      void resumePendingGenerationJobs();
      scheduleGenJobsSync(800);
      if (!feedHasRenderedContent('imageGenFeed', '.imagegen-feed-card')) {
        renderImageGenFeed();
      } else {
        scheduleImageGenFeedLayout();
      }
      void window.PointsSystem?.refreshCreditsFromServer?.();
      window.PointsSystem?.updateCreditsUI?.();
    }
  }

  function init() {
    loadStores();
    bindUI();
    bindPublishToggle();
    initMyHomeTabs();
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

  window.FeatureDraft = {
    init,
    onAppChange,
    clearSensitiveLocalStateOnSignOut,
    clearAllLocalFeatureData,
    reloadStores,
    refreshImageGenCost,
    syncCardToCommunity,
    removeCommunityByCardId,
    unpublishCommunityByCardId,
    isCommunityPublishEligible,
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
    toggleCommunityAppreciate,
    exitCommunityAppreciate,
    onAppreciateViewerClose,
    bumpAppreciateViewerGen,
    openCommunityAppreciateViewer,
    openCommunityAppreciateById,
    pruneOrphanFeatureData,
    purgeGhostCommunityData,
    hydrateFeedImages,
    resetMobileFeedGridStyles,
    enforceMobileImageGenFeed,
    enforceMobileCommunityFeedGrid,
    closeImageGenFilterSheet,
    renderImageGenFeed,
    canonicalCommunityImageRef,
    communityPostDisplayImageRef,
    isCommunityCollectCard,
    COMMUNITY_COLLECT_TAG,
    isDisplayableImage,
    scheduleImageGenFeedLayout: scheduleImageGenFeedLayout,
    scheduleLayout: scheduleCommunityLayout,
    layoutCommunityMasonry,
    relayoutCommunityFeeds,
    onCardDeletedForGen,
    recoverRecentGenerationJobs,
    resumePendingGenerationJobs,
    scheduleGenJobsSync,
    renderCreations,
    renderMyHomeProfile,
    onDisplayNameChanged,
    scheduleCreationsLayout: () => scheduleCommunityLayout('creationsGrid'),
    fillFormPromptOnly,
    copyFeedPromptText,
    fillFeedPromptToImageGen,
    fillCardToImageGen,
    runImageGenWithPrompt,
    recordImageGenFailure: addFailedGenJob,
    getImageGenRefImages: () => [...imageGenRefImages],
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

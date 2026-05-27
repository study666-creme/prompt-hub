/**
 * 提示词社区 / 我的创作 / 图片生成 — 功能草案
 */
(function () {
  const LS_COMMUNITY = 'promptrepo_community_posts';
  const LS_CREATIONS = 'promptrepo_creations';
  const LS_LIKES = 'promptrepo_community_likes';
  const LS_FAVS = 'promptrepo_community_favorites';
  const LS_IMAGEGEN = 'promptrepo_imagegen_draft';
  const PREFILL_KEY = 'promptrepo_imagegen_prefill';

  const GEN_RETENTION_MIN_MS = 1 * 24 * 60 * 60 * 1000;
  const GEN_RETENTION_MAX_MS = 3 * 24 * 60 * 60 * 1000;

  function randomGenRetentionMs() {
    return GEN_RETENTION_MIN_MS + Math.floor(Math.random() * (GEN_RETENTION_MAX_MS - GEN_RETENTION_MIN_MS + 1));
  }

  let communityPosts = [];
  let creations = [];
  let likedIds = new Set();
  let favIds = new Set();
  let creationsTab = 'private';
  let communitySort = 'hot';
  let communityMediaFilter = 'all';
  let openPostId = null;
  let openProfileAuthorId = null;
  const MAX_REF_IMAGES = 16;
  let imageGenRefImages = [];
  let imageGenLastResult = null;
  let imageGenActiveHistoryId = null;
  let imageGenFeedTab = 'personal';
  /** @type {Array<{id:string,prompt:string,model:string,modelLabel:string,resolution:string,quality:string,size:string,cost:number,startedAt:number,jobId?:string}>} */
  let imageGenPendingJobs = [];
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
  let imageGenPreviewId = null;
  let imageGenPreviewKind = null;
  let layoutCommunityTimer = null;
  let imageGenLayoutTimer = null;
  const displayUrlCache = new Map();

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function toast(msg) {
    if (typeof showToast === 'function') showToast(msg);
    else alert(msg);
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
    localStorage.setItem(key, JSON.stringify(val));
  }

  function genId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function getActiveUser() {
    const email = document.getElementById('authUserEmail')?.textContent?.trim();
    if (email) return { id: 'local_' + email, name: email.split('@')[0] || '用户' };
    return { id: 'guest', name: '访客' };
  }

  function getCardColumns() {
    return Math.min(5, Math.max(1, Number(getComputedStyle(document.documentElement).getPropertyValue('--card-columns')) || 4));
  }

  function getMasonryGap() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--card-row-gap').trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 16;
  }

  function filterCreationsForCloud(list) {
    const tomb = window.getDeletedCreationTombstones?.() || {};
    return (list || []).filter((c) => c && c.id != null && !tomb[String(c.id)]);
  }

  function loadStores() {
    communityPosts = loadJson(LS_COMMUNITY, []).filter(p => !p.isMock);
    creations = filterCreationsForCloud(loadJson(LS_CREATIONS, []));
    likedIds = new Set(loadJson(LS_LIKES, []));
    favIds = new Set(loadJson(LS_FAVS, []));
    stripDemoCreations();
    pruneCreations();
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

  function persistCommunity() {
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

  function getAllCommunityPosts() {
    return communityPosts.filter(p => !p.isMock);
  }

  /** 与卡片库对齐：去掉演示帖、孤儿帖、同一卡片的重复社区帖 */
  function reconcileCommunityWithCards(cardList) {
    const cardIds = new Set((cardList || []).map(c => c.id));
    const hasCards = cardIds.size > 0;
    const user = getActiveUser();
    const ownBySource = new Map();
    const kept = [];
    for (const p of communityPosts) {
      if (p.isMock) continue;
      if (p.authorId !== user.id) {
        kept.push(p);
        continue;
      }
      if (!p.sourceCardId) {
        kept.push(p);
        continue;
      }
      if (hasCards && !cardIds.has(p.sourceCardId)) continue;
      const prev = ownBySource.get(p.sourceCardId);
      const ts = p.updatedAt || p.createdAt || 0;
      const prevTs = prev ? (prev.updatedAt || prev.createdAt || 0) : -1;
      if (!prev || ts >= prevTs) ownBySource.set(p.sourceCardId, p);
    }
    communityPosts = [...kept, ...ownBySource.values()];
    if (hasCards) {
      for (const c of cardList) {
        if (c.communityPostId && !communityPosts.some(p => p.id === c.communityPostId)) {
          c.publishedToCommunity = false;
          c.communityPostId = null;
        }
      }
    }
    persistCommunity();
  }

  function featureImgSrc(image) {
    if (!image) return '';
    if (window.SupabaseSync?.safeImgSrc) return window.SupabaseSync.safeImgSrc(image);
    if (window.SupabaseSync?.isStorageRef?.(image)) {
      const c = window.SupabaseSync.getCachedDisplayUrl?.(image);
      return c && !c.startsWith('storage://') ? c : '';
    }
    return image;
  }

  function isDemoPlaceholderImage(image) {
    if (typeof image !== 'string' || !image.startsWith('data:image/')) return false;
    if (image.length < 120000) return true;
    return image.includes('演示生成');
  }

  function isDisplayableImage(image) {
    if (!image || typeof image !== 'string') return false;
    if (isDemoPlaceholderImage(image)) return false;
    return true;
  }

  async function resolveImageDisplayUrl(image, jobId) {
    if (!image) return '';
    const cacheKey = jobId ? `job:${jobId}` : image;
    const hit = displayUrlCache.get(cacheKey);
    if (hit) return hit;
    let url = '';
    const cached = window.SupabaseSync?.getCachedDisplayUrl?.(image);
    if (cached && /^https?:\/\//i.test(cached)) url = cached;
    if (!url && window.SupabaseSync?.resolveDisplayUrl
      && (window.SupabaseSync.isStorageRef?.(image) || String(image).startsWith('storage://'))) {
      try {
        url = await window.SupabaseSync.resolveDisplayUrl(image);
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
        url = await window.SupabaseSync.resolveDisplayUrl(image);
      } catch (e) {
        console.warn('resolve image failed', e);
      }
    }
    if (!url && typeof image === 'string' && /^https?:\/\//i.test(image)) url = image;
    if (url && !url.startsWith('storage://')) displayUrlCache.set(cacheKey, url);
    return url || '';
  }

  const IMG_LOADING_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect fill="#e4e4ea" width="16" height="16"/></svg>'
  );

  function bindFeedImgErrorFallback(img) {
    if (!img || img.dataset.feedImgErrBound) return;
    img.dataset.feedImgErrBound = '1';
    img.addEventListener('error', () => {
      const cur = img.getAttribute('src') || '';
      if (!cur.startsWith('data:image/svg')) {
        img.src = IMG_LOADING_PLACEHOLDER;
        img.classList.remove('img-load-failed');
      }
    });
  }

  async function applyFeedImageSrc(img, ref, jobId) {
    const feedMedia = img.closest('.imagegen-feed-media');
    if (!ref || !isDisplayableImage(ref)) return false;
    bindFeedImgErrorFallback(img);
    let url = displayUrlCache.get(jobId ? `job:${jobId}` : ref) || '';
    if (!url) {
      const cached = window.SupabaseSync?.getCachedDisplayUrl?.(ref);
      if (cached && typeof cached === 'string' && !cached.startsWith('storage://') && !cached.startsWith('data:image/svg')) {
        url = cached;
      }
    }
    if (!url) url = await resolveImageDisplayUrl(ref, jobId || null);
    if (!url || url.startsWith('storage://')) return false;
    const endLoad = () => {
      if (feedMedia) {
        if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(feedMedia);
        else feedMedia.classList.remove('is-loading');
      }
    };
    if (img.complete && img.src === url && img.naturalWidth > 0) {
      endLoad();
      return true;
    }
    img.addEventListener('load', endLoad, { once: true });
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
  }

  async function hydrateFeedImages(root) {
    const scope = root || document;
    const imgs = scope.querySelectorAll(
      '.imagegen-feed img[data-image-ref], #imageGenFeed img[data-image-ref], #creationsSideBody img[data-image-ref], #creationsGrid img[data-image-ref], #communityGrid img[data-image-ref], #userProfileGrid img[data-image-ref]'
    );
    await Promise.all([...imgs].map(async img => {
      const ref = img.getAttribute('data-image-ref');
      const jobId = img.getAttribute('data-job-id') || '';
      const media = img.closest('.imagegen-feed-media');
      const sideBtn = img.closest('.community-side-img-btn');
      if (!ref || !isDisplayableImage(ref)) {
        media?.remove();
        img.closest('.imagegen-feed-card')?.classList.add('imagegen-feed-card--no-media');
        return;
      }
      if (media?.classList.contains('imagegen-gen-pending')) return;
      if (media) {
        if (!media.dataset.shineAt) media.dataset.shineAt = String(Date.now());
        media.classList.add('is-loading');
      }
      if (!img.getAttribute('src') || !img.getAttribute('src').startsWith('data:image/svg')) {
        img.src = IMG_LOADING_PLACEHOLDER;
      }
      img.classList.remove('img-load-failed');
      const ok = await applyFeedImageSrc(img, ref, jobId || null);
      if (!ok) {
        media?.classList.remove('is-loading');
        if (media) {
          media.remove();
          img.closest('.imagegen-feed-card')?.classList.add('imagegen-feed-card--no-media');
        } else if (sideBtn) {
          img.src = IMG_LOADING_PLACEHOLDER;
        }
      }
    }));
    stripFailedFeedMedia(scope);
    if (isMobileFeedViewport()) resetMobileFeedGridStyles();
    else scheduleImageGenFeedLayout();
  }

  function getPostsByAuthor(authorId) {
    return getAllCommunityPosts().filter(p => p.authorId === authorId);
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

  function feedImgInitialSrc(image, jobId) {
    if (!image || !isDisplayableImage(image)) return '';
    const cached = window.SupabaseSync?.getCachedDisplayUrl?.(image);
    if (cached && typeof cached === 'string' && !cached.startsWith('storage://') && !cached.startsWith('data:image/svg')) {
      return cached;
    }
    if (jobId) {
      const jobCached = displayUrlCache.get(`job:${jobId}`);
      if (jobCached && !jobCached.startsWith('storage://')) return jobCached;
    }
    return IMG_LOADING_PLACEHOLDER;
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
    }, 80);
  }

  function layoutImageGenFeedMasonry() {
    if (isMobileFeedViewport()) {
      enforceMobileImageGenFeed();
      return;
    }
    const wrap = document.getElementById('imageGenFeed');
    if (!wrap || typeof Masonry === 'undefined') return;
    const cardEls = wrap.querySelectorAll('.imagegen-feed-card');
    if (!cardEls.length) {
      if (imageGenMasonry) {
        imageGenMasonry.destroy();
        imageGenMasonry = null;
      }
      return;
    }
    const gap = getMasonryGap();
    const style = getComputedStyle(wrap);
    const innerW = wrap.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (innerW < 80) {
      scheduleImageGenFeedLayout();
      return;
    }
    const minCol = 148;
    const cols = Math.max(2, Math.min(6, Math.floor((innerW + gap) / (minCol + gap))));
    const colWidth = Math.max(120, Math.floor((innerW - gap * (cols - 1)) / cols));
    let sizer = wrap.querySelector('.grid-sizer');
    if (!sizer) {
      sizer = document.createElement('div');
      sizer.className = 'grid-sizer';
      wrap.insertBefore(sizer, wrap.firstChild);
    }
    sizer.style.width = colWidth + 'px';
    cardEls.forEach(card => { card.style.width = colWidth + 'px'; });
    const opts = {
      itemSelector: '.imagegen-feed-card',
      columnWidth: '.grid-sizer',
      gutter: gap,
      percentPosition: false,
      transitionDuration: '0.35s'
    };
    if (imageGenMasonry) {
      imageGenMasonry.option(opts);
      imageGenMasonry.reloadItems();
      imageGenMasonry.layout();
    } else {
      cardEls.forEach(card => {
        card.style.left = '';
        card.style.top = '';
        card.style.position = '';
      });
      imageGenMasonry = new Masonry(wrap, opts);
    }
    requestAnimationFrame(() => imageGenMasonry?.layout());
  }

  function scheduleCommunityLayout(containerId) {
    clearTimeout(layoutCommunityTimer);
    layoutCommunityTimer = setTimeout(() => layoutCommunityMasonry(containerId), 80);
  }

  function bindCommunityGridImageRelayout(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('img.card-img, .card-media img').forEach(img => {
      if (img.dataset.masonryRelayoutBound) return;
      img.dataset.masonryRelayoutBound = '1';
      const relayout = () => scheduleCommunityLayout(containerId);
      img.addEventListener('load', relayout, { once: true });
      img.addEventListener('error', relayout, { once: true });
    });
  }

  function scheduleLayoutAfterImages(containerId) {
    scheduleCommunityLayout(containerId);
    bindCommunityGridImageRelayout(containerId);
  }

  function useCssGridForCommunityFeed(containerId) {
    return (
      containerId === 'communityGrid' ||
      containerId === 'creationsGrid' ||
      window.MobileUI?.isMobile?.()
    );
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
    container.querySelectorAll('.card').forEach((card) => {
      card.style.width = '';
      card.style.left = '';
      card.style.top = '';
      card.style.position = '';
    });
  }

  function layoutCommunityMasonry(containerId) {
    const container = document.getElementById(containerId);
    if (!container || typeof Masonry === 'undefined') return;
    if (useCssGridForCommunityFeed(containerId)) {
      resetCommunityGridCardLayout(container, containerId);
      return;
    }
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
      return;
    }

    const gap = getMasonryGap();
    const style = getComputedStyle(container);
    const innerW = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (innerW < 80) {
      scheduleCommunityLayout(containerId);
      return;
    }
    const cols = getCardColumns();
    const colWidth = Math.max(120, Math.floor((innerW - gap * (cols - 1)) / cols));
    let sizer = container.querySelector('.grid-sizer');
    if (!sizer) {
      sizer = document.createElement('div');
      sizer.className = 'grid-sizer';
      container.insertBefore(sizer, container.firstChild);
    }
    sizer.style.width = colWidth + 'px';
    cardEls.forEach(card => { card.style.width = colWidth + 'px'; });
    const opts = {
      itemSelector: '.card',
      columnWidth: '.grid-sizer',
      gutter: gap,
      percentPosition: false,
      transitionDuration: '0.42s'
    };
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
    requestAnimationFrame(() => instance?.layout());
    bindCommunityGridImageRelayout(containerId);
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
    const isProfile = containerId === 'userProfileGrid';
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

    if (!posts.length) {
      container.innerHTML = '<div class="feature-empty" style="grid-column:1/-1;padding:40px"><p>暂无已发布作品</p></div>';
      return;
    }

    if (window.SupabaseSync?.prefetchDisplayUrls) {
      await window.SupabaseSync.prefetchDisplayUrls(posts.map(p => p.image).filter(Boolean));
    }

    const fragment = document.createDocumentFragment();
    const sizer = document.createElement('div');
    sizer.className = 'grid-sizer';
    fragment.appendChild(sizer);

    posts.forEach((post, idx) => {
      const div = document.createElement('div');
      div.className = 'card card-enter community-post-card';
      div.style.animationDelay = `${Math.min(idx * 0.045, 0.36)}s`;
      div.dataset.postId = post.id;
      const liked = likedIds.has(post.id);
      const showImage = isDisplayableImage(post.image);
      const titleTrim = (post.title || '').trim();
      const hasRealTitle = titleTrim && !isGenericPostTitle(titleTrim);
      const storageAttr = feedImgStorageAttr(post.image);
      const imgSrc = showImage ? communityImgInitialSrc(post.image) : '';
      const imgLoading = showImage && imgSrc === IMG_LOADING_PLACEHOLDER;
      const mediaHtml = showImage
        ? `<div class="card-media${imgLoading ? ' is-loading' : ''}"${imgLoading ? ` data-shine-at="${Date.now()}"` : ''}><img class="card-img" src="${esc(imgSrc)}" data-image-ref="${esc(post.image)}"${storageAttr} loading="lazy" draggable="false" alt="" onload="if(typeof finishCardMediaShine==='function')finishCardMediaShine(this.closest('.card-media'));if(typeof FeatureDraft!=='undefined')FeatureDraft.scheduleLayout('${containerId}')"></div>`
        : '';
      const timeLabel = `♥ ${post.likes || 0}`;
      const promptTrim = (post.prompt || '').trim();
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
      div.addEventListener('click', () => openCommunitySidePanel(post.id));
      const user = getActiveUser();
      if (user.id !== 'guest' && post.authorId === user.id) {
        div.addEventListener('contextmenu', e => {
          e.preventDefault();
          e.stopPropagation();
          const menuFn = window.showContextMenu;
          if (typeof menuFn !== 'function') return;
          menuFn(e.clientX, e.clientY, [
            { label: '从社区删除', danger: true, action: () => confirmDeleteCommunityPost(post.id) }
          ]);
        });
      }
      const authorBtn = div.querySelector('.community-author-link');
      if (authorBtn) bindAuthorLink(authorBtn, post.authorId, post.authorName);
      fragment.appendChild(div);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
    container.classList.add('cards-grid-primed');
    scheduleLayoutAfterImages(containerId);
    void hydrateFeedImages(container).then(() => scheduleLayoutAfterImages(containerId));
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
    if (communityMediaFilter === 'image') {
      filtered = filtered.filter(p => isDisplayableImage(p.image));
    } else if (communityMediaFilter === 'text') {
      filtered = filtered.filter(p => !isDisplayableImage(p.image));
    }
    if (communitySort === 'new') {
      filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } else {
      filtered.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    }
    return filtered;
  }

  function renderCommunity() {
    const container = document.getElementById('communityGrid');
    if (!container) return;
    let list = filterAndSortPosts(getAllCommunityPosts());
    if (!list.length) {
      if (communityMasonry) { communityMasonry.destroy(); communityMasonry = null; }
      const syncHint = window.SupabaseSync?.isLoggedIn?.()
        ? '<button type="button" class="btn btn-secondary" onclick="syncCloudNow()">从云端同步</button>'
        : '';
      container.innerHTML = `<div class="feature-empty"><p>暂无社区内容</p><button type="button" class="btn btn-primary" onclick="switchAppPage('warehouse')">去卡片库发布</button>${syncHint}</div>`;
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
    const overlay = document.getElementById('userProfileOverlay');
    const titleEl = document.getElementById('userProfileTitle');
    const subEl = document.getElementById('userProfileSub');
    const avatarEl = document.getElementById('userProfileAvatar');
    if (titleEl) titleEl.textContent = authorName || '用户';
    if (subEl) subEl.textContent = `已发布 ${posts.length} 个提示词`;
    if (avatarEl) avatarEl.textContent = ((authorName || '?')[0] || '?').toUpperCase();
    closeCommunityDetail();
    renderUserProfileGrid();
    overlay?.classList.add('active');
  }

  function closeUserProfile() {
    document.getElementById('userProfileOverlay')?.classList.remove('active');
    openProfileAuthorId = null;
    if (profileMasonry) {
      profileMasonry.destroy();
      profileMasonry = null;
    }
  }

  function syncCardToCommunity(card, publish) {
    if (!card?.id) return;
    const idx = communityPosts.findIndex(p => p.sourceCardId === card.id);
    if (!publish) {
      if (idx >= 0) {
        communityPosts.splice(idx, 1);
        persistCommunity();
      }
      card.publishedToCommunity = false;
      card.communityPostId = null;
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
    persistCommunity();
    renderCommunity();
    if (openProfileAuthorId === user.id) renderUserProfileGrid();
    checkOwnPostMilestones(post.id);
  }

  function removeCommunityByCardId(cardId) {
    const i = communityPosts.findIndex(p => p.sourceCardId === cardId);
    if (i >= 0) {
      const postId = communityPosts[i].id;
      performCommunityPostRemoval(postId, { silent: true });
    }
  }

  function confirmDeleteCommunityPost(id) {
    const post = findPost(id);
    if (!post) return;
    const user = getActiveUser();
    if (user.id === 'guest') {
      window.AuthGate?.requireAuth?.('community');
      return;
    }
    if (post.authorId !== user.id) {
      toast('只能删除自己的作品');
      return;
    }
    const msg = '确定从社区永久删除该作品？无回收站，删除后不可恢复。';
    const doDel = () => performCommunityPostRemoval(id);
    if (typeof window.customConfirm === 'function') window.customConfirm(msg, doDel);
    else if (confirm(msg)) doDel();
  }

  function performCommunityPostRemoval(id, opts = {}) {
    const post = findPost(id);
    if (!post) return;
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
    const btn = document.getElementById('cardPublishToggle');
    if (!btn) return;
    const on = card ? !!card.publishedToCommunity : getDefaultPublishChecked();
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function readPublishCheckbox() {
    return document.getElementById('cardPublishToggle')?.classList.contains('is-on');
  }

  function bindPublishToggle() {
    const btn = document.getElementById('cardPublishToggle');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const on = !btn.classList.contains('is-on');
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function findPost(id) {
    return getAllCommunityPosts().find(p => p.id === id);
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
    if (!post.isMock) {
      const p = communityPosts.find(x => x.id === id);
      if (p) p.likes = (p.likes || 0) + 1;
    } else {
      post.likes = (post.likes || 0) + 1;
    }
    persistLikes();
    persistCommunity();
    window.PointsSystem?.onPostLikesUpdated?.(post, getActiveUser);
    patchCommunityLikeUI(id);
    patchCommunitySidePanelUI(id);
    if (document.getElementById('pageImageGen')?.classList.contains('active')) {
      document.querySelectorAll(`.imagegen-feed-like[data-like-id="${id}"]`).forEach(btn => {
        btn.textContent = `♥ ${post.likes || 0}`;
        btn.classList.add('liked');
      });
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

  async function renderCommunitySidePanel(id) {
    const post = findPost(id);
    const body = document.getElementById('communitySideBody');
    const titleEl = document.getElementById('communitySideTitle');
    if (!post || !body) return;
    if (titleEl) titleEl.textContent = getPostSideTitle(post);
    const faved = favIds.has(id);
    const liked = likedIds.has(id);
    const storageAttr = feedImgStorageAttr(post.image);
    const showSideImg = post.image && isDisplayableImage(post.image);
    const sideInitial = showSideImg ? communityImgInitialSrc(post.image) : '';
    const imgBlock = showSideImg
      ? `<button type="button" class="community-side-img-btn" data-side-zoom title="点击放大"><img class="community-side-img" src="${esc(sideInitial)}" data-image-ref="${esc(post.image)}"${storageAttr} alt=""></button>`
      : '';
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
        ${getActiveUser().id !== 'guest' && post.authorId === getActiveUser().id ? '<button type="button" class="btn btn-secondary community-side-del" data-action="del-post">删除作品</button>' : ''}
      </div>
      <p class="panel-hint">点赞、收藏、制作同款需单独点击；「复制」仅复制提示词${getActiveUser().id !== 'guest' && post.authorId === getActiveUser().id ? '；删除后不可恢复' : ''}</p>`;
    body.querySelector('[data-action="like"]')?.addEventListener('click', () => likeCommunityPostOnly(id));
    body.querySelector('[data-action="copy"]')?.addEventListener('click', () => copyPostPrompt(post));
    body.querySelector('[data-action="fav"]')?.addEventListener('click', () => favoritePost(id, post));
    body.querySelector('[data-action="remix"]')?.addEventListener('click', () => remixToImageGen(post));
    body.querySelector('[data-action="del-post"]')?.addEventListener('click', () => confirmDeleteCommunityPost(id));
    body.querySelector('[data-side-zoom]')?.addEventListener('click', () => {
      void (async () => {
        const url = await resolveImageDisplayUrl(post.image, null);
        if (url && typeof window.openLightbox === 'function') window.openLightbox(url);
        else toast('图片尚未加载完成，请稍候再试');
      })();
    });
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

  function openCommunitySidePanel(id) {
    const post = findPost(id);
    if (!post) return;
    communitySidePostId = id;
    openPostId = id;
    const panel = document.getElementById('communitySidePanel');
    panel?.classList.remove('hidden');
    document.body.classList.add('community-panel-open');
    void renderCommunitySidePanel(id);
    requestAnimationFrame(() => scheduleCommunityLayout('communityGrid'));
  }

  function closeCommunitySidePanel() {
    document.getElementById('communitySidePanel')?.classList.add('hidden');
    if (!creationsSideId) document.body.classList.remove('community-panel-open');
    communitySidePostId = null;
    openPostId = null;
    document.querySelectorAll('#communityGrid .community-post-card.selected').forEach(el => el.classList.remove('selected'));
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
    addCardFromPost(post);
    persistFavs();
    toast('已收藏到卡片库，已为作者点赞');
    if (communitySidePostId === id) patchCommunitySidePanelUI(id);
  }

  function addCardFromPost(post) {
    if (typeof window.addCardFromCommunity === 'function') {
      window.addCardFromCommunity(post);
    }
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

  function saveGeneratedToWarehouse({ prompt, image, sourceId, title }) {
    if (!image) {
      toast('暂无图片可保存');
      return false;
    }
    return window.addCardFromGenerated?.({ prompt, image, sourceId, title })?.ok ?? false;
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
        <button type="button" class="btn btn-primary" data-action="save">保存到仓库</button>
        ${c.visibility === 'private' ? '<button type="button" class="btn btn-secondary" data-action="publish">发布到社区</button>' : ''}
        <button type="button" class="btn btn-secondary" data-action="remix">再生成</button>
        <button type="button" class="btn btn-secondary" data-action="del">删除</button>
      </div>
      <p class="panel-hint">点击图片可放大查看；使用「保存到仓库」将作品写入卡片库</p>`;
    body.querySelector('[data-side-zoom]')?.addEventListener('click', () => {
      void (async () => {
        const url = await resolveImageDisplayUrl(c.image, c.jobId || null);
        if (url && typeof window.openLightbox === 'function') window.openLightbox(url);
        else toast('图片尚未加载完成，请稍候再试');
      })();
    });
    body.querySelector('[data-action="save"]')?.addEventListener('click', () => {
      saveGeneratedToWarehouse({ prompt: c.prompt, image: c.image, sourceId: c.id });
    });
    body.querySelector('[data-action="publish"]')?.addEventListener('click', () => publishCreation(id));
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
    document.getElementById('creationsSidePanel')?.classList.remove('hidden');
    document.body.classList.add('community-panel-open');
    void renderCreationsSidePanel(id);
    scheduleCommunityLayout('creationsGrid');
  }

  function closeCreationsSidePanel() {
    document.getElementById('creationsSidePanel')?.classList.add('hidden');
    if (!communitySidePostId) document.body.classList.remove('community-panel-open');
    creationsSideId = null;
    document.querySelectorAll('#creationsGrid .creation-post-card.selected').forEach(el => el.classList.remove('selected'));
  }

  async function renderCreations() {
    const container = document.getElementById('creationsGrid');
    const hintEl = document.getElementById('creationsHint');
    if (!container) return;
    if (hintEl) {
      hintEl.textContent = creationsTab === 'private'
        ? '点击卡片在右侧查看详情 · 生成图保留 1～3 天，请及时存仓库'
        : '点击卡片在右侧查看详情 · 已发布作品永久保留';
    }
    if (creationsMasonry) {
      creationsMasonry.destroy();
      creationsMasonry = null;
    }
    pruneCreations();
    const privCount = creations.filter(c => c.visibility === 'private' && (c.prompt || '').trim()).length;
    const pubCount = creations.filter(c => c.visibility === 'published' && (c.prompt || '').trim()).length;
    if (creationsTab === 'private' && !privCount && pubCount) {
      creationsTab = 'published';
      document.querySelectorAll('[data-creations-tab]').forEach((b) => {
        b.classList.toggle('active', b.dataset.creationsTab === 'published');
      });
    }
    const list = creations
      .filter(c => c.visibility === creationsTab && (c.prompt || '').trim())
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!list.length) {
      closeCreationsSidePanel();
      const emptyMsg = creationsTab === 'private'
        ? '暂无私密作品（若已开启自动发布，请到「已发布」查看）'
        : '暂无已发布作品';
      container.innerHTML = `<div class="feature-empty"><p>${emptyMsg}</p><button type="button" class="btn btn-primary" onclick="switchAppPage('imagegen')">去图片生成</button></div>`;
      return;
    }
    if (window.SupabaseSync?.prefetchDisplayUrls) {
      await window.SupabaseSync.prefetchDisplayUrls(list.map(c => c.image).filter(Boolean));
    }
    const fragment = document.createDocumentFragment();
    const sizer = document.createElement('div');
    sizer.className = 'grid-sizer';
    fragment.appendChild(sizer);
    list.forEach((c, idx) => {
      const div = document.createElement('div');
      div.className = 'card card-enter creation-post-card';
      div.style.animationDelay = `${Math.min(idx * 0.045, 0.36)}s`;
      div.dataset.creationId = c.id;
      const badge = c.visibility === 'published' ? '已发布' : '私密';
      const showImage = isDisplayableImage(c.image);
      const promptTrim = (c.prompt || '').trim();
      const storageAttr = feedImgStorageAttr(c.image);
      const jobAttr = c.jobId ? ` data-job-id="${esc(c.jobId)}"` : '';
      const imgSrc = showImage ? communityImgInitialSrc(c.image) : '';
      const imgLoading = showImage && imgSrc === IMG_LOADING_PLACEHOLDER;
      const mediaHtml = showImage
        ? `<div class="card-media${imgLoading ? ' is-loading' : ''}"${imgLoading ? ` data-shine-at="${Date.now()}"` : ''}><img class="card-img" src="${esc(imgSrc)}" data-image-ref="${esc(c.image)}"${storageAttr}${jobAttr} loading="lazy" alt="" onload="if(typeof finishCardMediaShine==='function')finishCardMediaShine(this.closest('.card-media'));if(typeof FeatureDraft!=='undefined')FeatureDraft.scheduleCreationsLayout()"></div>`
        : '';
      const descHtml = promptTrim
        ? `<div class="card-desc">${esc(promptTrim.length > 120 ? promptTrim.slice(0, 120) + '…' : promptTrim)}</div>`
        : '';
      div.innerHTML = `
        ${mediaHtml}
        <div class="card-body">
          <div class="card-head card-head--meta-only"><time class="card-time">${esc(formatExpiryLabel(c))}</time></div>
          ${descHtml}
          <div class="card-tags"><span class="tag">${esc(badge)}</span><span class="tag">${esc((c.resolution || '1k').toUpperCase())}</span></div>
        </div>`;
      div.addEventListener('click', () => openCreationsSidePanel(c.id));
      fragment.appendChild(div);
    });
    container.innerHTML = '';
    container.appendChild(fragment);
    container.classList.add('cards-grid-primed');
    scheduleLayoutAfterImages('creationsGrid');
    void hydrateFeedImages(container).then(() => scheduleLayoutAfterImages('creationsGrid'));
    if (creationsSideId && list.some(c => c.id === creationsSideId)) {
      void renderCreationsSidePanel(creationsSideId);
    } else if (creationsSideId) {
      closeCreationsSidePanel();
    }
  }

  function publishCreation(id, opts) {
    const c = creations.find(x => x.id === id);
    if (!c || c.visibility === 'published') return;
    const user = getActiveUser();
    const post = {
      id: genId('cp'),
      sourceCreationId: id,
      authorId: user.id,
      authorName: user.name,
      title: (c.prompt || '').slice(0, 24) || '我的作品',
      prompt: c.prompt || '',
      image: c.image,
      likes: 0,
      createdAt: Date.now()
    };
    communityPosts.push(post);
    c.visibility = 'published';
    c.communityPostId = post.id;
    c.expiresAt = null;
    c.permanent = true;
    persistCommunity();
    persistCreations();
    if (!opts?.silent) toast('已发布到社区');
    renderCreations();
    renderCommunity();
    if (document.getElementById('pageImageGen')?.classList.contains('active')) {
      renderImageGenFeed();
    }
    if (creationsSideId === id) renderCreationsSidePanel(id);
  }

  function confirmDeleteCreation(id) {
    const msg = '确定删除该生成记录？无回收站，删除后不可恢复。';
    const doDel = () => deleteCreation(id);
    if (typeof window.customConfirm === 'function') window.customConfirm(msg, doDel);
    else if (confirm(msg)) doDel();
  }

  function recordCreationDeletion(id) {
    if (id == null) return;
    try {
      const key = 'promptrepo_deleted_creations';
      const raw = localStorage.getItem(key);
      const map = raw ? JSON.parse(raw) : {};
      map[String(id)] = Date.now();
      localStorage.setItem(key, JSON.stringify(map));
    } catch (e) { /* ignore */ }
    if (typeof window.recordCreationDeletionGlobal === 'function') {
      window.recordCreationDeletionGlobal(id);
    }
  }

  function deleteCreation(id) {
    if (creationsSideId === id) closeCreationsSidePanel();
    if (imageGenPreviewId === id) closeImageGenPreview();
    const removed = creations.find(c => c.id === id);
    if (removed?.communityPostId) performCommunityPostRemoval(removed.communityPostId, { silent: true });
    recordCreationDeletion(id);
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
    imageGenFeedTab = 'personal';
    document.querySelectorAll('[data-feed-tab]').forEach(b => {
      b.classList.toggle('active', b.dataset.feedTab === 'personal');
    });
    updateImageGenFeedHint();
    applyHistoryToForm(c);
  }

  function initImageGenForm() {
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
    }
    bindImageGenUpload();
    syncImageGenAutoPublishUI();
    syncImageGenAutoSaveUI();
    updateImageGenPricingUI();
    applyImageGenPrefill();
    updateImageGenFeedHint();
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

  function restoreImageGenSubmitLabel() {
    updateImageGenCostHint();
  }

  let imageGenCostHintSeq = 0;

  function applyImageGenCostDisplay(detail, final, quality, size) {
    const hint = document.getElementById('imageGenCostHint');
    const btn = document.getElementById('imageGenSubmit');
    if (btn && !btn.disabled) {
      btn.textContent = `生成图片 · ${final} 积分`;
    }
    if (!hint) return;
    const modelLabel = detail?.modelLabel || '全能模型2';
    const sizeLabel =
      document.getElementById('imageGenSize')?.selectedOptions?.[0]?.textContent?.trim() || size;
    const qualLabel =
      { standard: '标准', high: '高清', ultra: '超清' }[quality] || quality;
    const parts = [modelLabel, qualLabel, sizeLabel];
    if (detail?.saved > 0 && detail.label) {
      parts.push(`会员${detail.label} 省 ${detail.saved}`);
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
    refreshImageGenCostFromApi(model, resolution, quality, size);
  }

  async function refreshImageGenCostFromApi(model, resolution, quality, size) {
    if (!window.PointsSystem?.useApiForAccount?.()) return;
    const seq = ++imageGenCostHintSeq;
    try {
      const quote = await window.PromptHubApi.getGenerationCost(resolution, quality, model);
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
    renderImageGenFeed();
    toast('已填入生图框');
  }

  function fillFormPromptOnly(prompt) {
    const promptEl = document.getElementById('imageGenPrompt');
    if (promptEl) promptEl.value = prompt || '';
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

  async function resolveRefUrlsForApi() {
    if (!imageGenRefImages.length) return [];
    const urls = [];
    for (let i = 0; i < imageGenRefImages.length; i++) {
      const src = imageGenRefImages[i];
      if (window.SupabaseSync?.isStorageRef?.(src)) {
        try {
          const url = await window.SupabaseSync.resolveDisplayUrl(src);
          if (url && !url.startsWith('storage://')) urls.push(url);
        } catch (e) { /* ignore */ }
        continue;
      }
      if (
        window.SupabaseSync?.isLoggedIn?.() &&
        window.SupabaseSync?.uploadImageGenRef &&
        (window.SupabaseSync?.isDataUrl?.(src) || String(src).startsWith('blob:'))
      ) {
        try {
          const url = await window.SupabaseSync.uploadImageGenRef(genId('ref'), src);
          urls.push(url);
        } catch (e) {
          console.warn('参考图上传失败', e);
        }
      }
    }
    return urls;
  }

  function removePendingJob(pendingId) {
    imageGenPendingJobs = imageGenPendingJobs.filter(j => j.id !== pendingId);
  }

  async function pollGenerationJobUntilDone(jobId, pendingId, ctx) {
    const maxAttempts = 80;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 1500 : 3000));
      const still = imageGenPendingJobs.some(j => j.id === pendingId);
      if (!still) return;

      const poll = await window.PromptHubApi.getGenerationJob(jobId);
      if (!poll.ok) {
        if (poll.code === 'NETWORK_ERROR' && i < maxAttempts - 1) continue;
        removePendingJob(pendingId);
        await window.PointsSystem?.refreshCreditsFromServer?.();
        renderImageGenFeed();
        toast(poll.message || '查询生图进度失败，请稍后在「个人」查看或联系客服');
        return;
      }

      if (typeof poll.data.creditsRemaining === 'number') {
        window.PointsSystem?.setCreditsFromServer?.(poll.data.creditsRemaining);
        window.PointsSystem?.updateCreditsUI?.();
      }

      if (poll.data.status === 'processing') {
        if (imageGenFeedTab === 'personal') renderImageGenFeed();
        continue;
      }

      removePendingJob(pendingId);

      if (poll.data.status === 'failed') {
        await window.PointsSystem?.refreshCreditsFromServer?.();
        renderImageGenFeed();
        toast(poll.data.message || poll.data.errorMessage || '生图失败，积分已全额退回');
        return;
      }

      if (poll.data.status === 'completed') {
        const imageUrl = poll.data.imageUrl;
        if (!imageUrl) {
          await window.PointsSystem?.refreshCreditsFromServer?.();
          renderImageGenFeed();
          toast('生图未返回图片，若积分未退回请点同步或联系客服');
          return;
        }
        void finishImageGenRun({
          ...ctx,
          image: imageUrl,
          cost: ctx.cost,
          jobId
        });
        return;
      }
    }
    removePendingJob(pendingId);
    toast('生图时间较长，请稍后在「个人」刷新页面查看；若失败积分会自动退回');
    renderImageGenFeed();
  }

  async function runImageGenDemo() {
    if (!window.AuthGate?.requireAuth?.('imagegen')) return;
    const prompt = document.getElementById('imageGenPrompt')?.value?.trim();
    if (!prompt) {
      toast('请先填写提示词');
      return;
    }
    const meta = getImageGenFormMeta();
    const { model, resolution, quality, size } = meta;
    let cost = window.PointsSystem?.getImageGenCost?.(model, resolution) ?? 10;
    let balance = window.PointsSystem?.getCredits?.() ?? 0;

    const btn = document.getElementById('imageGenSubmit');
    const useApi = window.PointsSystem?.useApiForAccount?.();

    if (useApi) {
      const quote = await window.PromptHubApi.getGenerationCost(resolution, quality, model);
      if (quote.ok && quote.data?.final != null) cost = quote.data.final;
      balance = window.PointsSystem?.getCredits?.() ?? 0;
    }

    if (balance < cost) {
      toast(`积分不足（需要 ${cost}，当前 ${balance}）。请使用激活码兑换`);
      return;
    }

    if (!useApi && !window.PointsSystem?.deductCredits?.(cost)) {
      toast('积分扣除失败');
      return;
    }

    saveJson(LS_IMAGEGEN, {
      prompt,
      model,
      refImages: imageGenRefImages,
      refImage: getImageGenPrimaryRef(),
      resolution,
      quality,
      size
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
      startedAt: Date.now()
    };
    imageGenPendingJobs.unshift(pendingJob);
    imageGenFeedTab = 'personal';
    document.querySelectorAll('[data-feed-tab]').forEach(b => {
      b.classList.toggle('active', b.dataset.feedTab === 'personal');
    });
    updateImageGenFeedHint();
    renderImageGenFeed();
    if (window.MobileUI?.isMobile?.() && window.MobileUI?.setImageGenView) {
      window.MobileUI.setImageGenView('feed');
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = '提交中…';
    }

    function friendlyGenErrorMessage(msg) {
      const s = String(msg || '');
      if (/insufficient balance/i.test(s) || (/insufficient/i.test(s) && /balance/i.test(s))) {
        return '生图服务商账户余额不足，请联系站长充值；您的积分已全额退回';
      }
      if (/invalid.*api.*key|unauthorized|401/i.test(s)) {
        return '生图接口密钥无效或已过期，请联系站长检查配置；您的积分已全额退回';
      }
      if (s.length > 120) return s.slice(0, 120) + '…';
      return s || '生图失败，您的积分已全额退回';
    }

    if (useApi) {
      const refUrls = await resolveRefUrlsForApi();
      const gen = await window.PromptHubApi.generateImage({
        prompt,
        model,
        resolution,
        quality,
        size,
        refImageUrls: refUrls.length ? refUrls : undefined
      });
      if (btn) {
        btn.disabled = false;
        restoreImageGenSubmitLabel();
      }
      if (!gen.ok) {
        removePendingJob(pendingId);
        renderImageGenFeed();
        await window.PointsSystem?.refreshCreditsFromServer?.();
        toast(friendlyGenErrorMessage(gen.message));
        return;
      }
      if (typeof gen.data.creditsRemaining === 'number') {
        window.PointsSystem?.setCreditsFromServer?.(gen.data.creditsRemaining);
        window.PointsSystem?.updateCreditsUI?.();
      }
      cost = gen.data.creditsCharged ?? cost;
      pendingJob.cost = cost;

      if (gen.data.status === 'completed' && gen.data.imageUrl) {
        removePendingJob(pendingId);
        void finishImageGenRun({
          prompt,
          model,
          resolution,
          quality,
          size,
          image: gen.data.imageUrl,
          cost,
          jobId: gen.data.jobId
        });
        return;
      }

      const jobId = gen.data.jobId;
      if (!jobId) {
        removePendingJob(pendingId);
        renderImageGenFeed();
        toast('未收到任务编号，请重试');
        return;
      }
      pendingJob.jobId = jobId;
      toast('已提交生图，右侧可查看进度，可继续点击生成');
      void pollGenerationJobUntilDone(jobId, pendingId, {
        prompt,
        model,
        resolution,
        quality,
        size,
        cost,
        jobId
      });
      return;
    }

    removePendingJob(pendingId);
    renderImageGenFeed();
    if (btn) {
      btn.disabled = false;
      restoreImageGenSubmitLabel();
    }
    toast('请登录并连接后端 API 后使用真实生图（演示占位已关闭）');
  }

  async function finishImageGenRun({ prompt, model, resolution, quality, size, image, cost, btn, jobId }) {
    if (!image) {
      toast('图片地址无效，请重试');
      return;
    }
    const creationId = genId('cr');
    let storedImage = image;
    if (window.SupabaseSync?.persistGenerationImage) {
      try {
        storedImage = await window.SupabaseSync.persistGenerationImage(creationId, image);
      } catch (e) {
        console.warn('生成图归档失败', e);
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
    creations.unshift(creation);
    imageGenActiveHistoryId = creation.id;
    persistCreations();
    imageGenFeedTab = 'personal';
    document.querySelectorAll('[data-feed-tab]').forEach(b => {
      b.classList.toggle('active', b.dataset.feedTab === 'personal');
    });
    updateImageGenFeedHint();
    renderImageGenFeed();
    window.PointsSystem?.updateCreditsUI?.();
    if (btn) { btn.disabled = false; restoreImageGenSubmitLabel(); }
    if (isImageGenAutoPublishChecked()) {
      publishCreation(creation.id, { silent: true });
      toast(`已生成并发布（-${cost} 积分）· 可在「我的创作」→「已发布」查看`);
    } else {
      toast(`已生成（-${cost} 积分，保留 1～3 天，请及时存仓库；发布到社区可永久保留）`);
    }
    if (isImageGenAutoSaveChecked() && storedImage) {
      saveGeneratedToWarehouse({
        prompt: creation.prompt,
        image: storedImage,
        sourceId: creation.id,
        title: ''
      });
    }
    if (window.MobileUI?.isMobile?.() && window.MobileUI?.setImageGenView) {
      window.MobileUI.setImageGenView('feed');
    }
  }

  function updateImageGenFeedHint() {
    const el = document.getElementById('imageGenFeedHint');
    if (!el) return;
    const mobile = window.MobileUI?.isMobile?.();
    if (imageGenFeedTab === 'warehouse') {
      el.textContent = mobile
        ? '两列浏览 · 点图放大 · 用卡片上按钮复制或填入生图'
        : '按分组或标签筛选 · 点击图片放大 · 点击卡片打开右侧详情';
    } else if (imageGenFeedTab === 'community') {
      el.textContent = mobile
        ? '社区作品 · 点图放大 · 按钮复制或填入生图'
        : '社区作品 · 点击图片放大 · 点击卡片查看详情';
    } else {
      const n = imageGenPendingJobs.length;
      el.textContent = mobile
        ? (n ? `生成中 ${n} 项 · 点图放大 · 按钮复制/填入/存仓库` : '点图放大 · 按钮复制或填入生图 · 保留 1～3 天，请及时存仓库')
        : (n
          ? `我的生成 · ${n} 个任务进行中（右侧显示）· 可连续提交`
          : '我的生成记录 · 点击图片放大 · 可存仓库 · 保留 1～3 天，请及时存仓库');
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


  function buildFeedPendingCardHtml(job) {
    const badges = [job.modelLabel || '生图中', (job.resolution || '1k').toUpperCase()];
    const badgeHtml = badges.map(b => `<span class="imagegen-feed-badge">${esc(b)}</span>`).join('');
    return `<article class="imagegen-feed-card imagegen-feed-card-tile imagegen-feed-card--pending" data-feed-id="${esc(job.id)}" data-pending="1">
      <div class="imagegen-feed-media imagegen-gen-pending" aria-busy="true">
        <div class="imagegen-gen-grid" aria-hidden="true">
          <div class="imagegen-gen-grid-layer imagegen-gen-grid-layer--base"></div>
        </div>
        <span class="imagegen-gen-pending-label">生成中</span>
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
    const imgSrc = isDisplayableImage(image) ? feedImgInitialSrc(image, jobId) : '';
    const loadingCls = imgSrc && imgSrc === IMG_LOADING_PLACEHOLDER ? ' is-loading' : (isDisplayableImage(image) ? ' is-loading' : '');
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
      const c = creations.find(x => x.id === imageGenPreviewId);
      if (!c) { closeImageGenPreview(); return; }
      prompt = c.prompt || '';
      image = c.image || '';
      jobId = c.jobId || '';
      if (c.hasRefImage) {
        refImages = c.refImages;
        refImage = c.refImage;
      }
      extraActions = `
        <button type="button" class="btn btn-secondary btn-sm" data-preview-save>存仓库</button>
        <button type="button" class="btn btn-secondary btn-sm" data-preview-del>删除</button>`;
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
      void resolveImageDisplayUrl(image, jobId).then(url => {
        if (!url) { zoomBtn.remove(); return; }
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        zoomBtn.replaceChildren(img);
        zoomBtn.addEventListener('click', () => {
          if (typeof window.openLightbox === 'function') window.openLightbox(url);
        });
      });
    }
    const getPreviewRefs = () => {
      let refs = [];
      try {
        if (body.dataset.previewRefs) refs = JSON.parse(body.dataset.previewRefs) || [];
      } catch (e) { /* ignore */ }
      return { refImages: refs, refImage: body.dataset.previewRef || '' };
    };
    body.querySelector('[data-preview-fill-all]')?.addEventListener('click', () => {
      if (imageGenPreviewKind === 'personal') {
        const c = creations.find(x => x.id === imageGenPreviewId);
        if (c) applyHistoryToForm(c);
        return;
      }
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
      if (!text) { toast('暂无提示词'); return; }
      navigator.clipboard.writeText(text).then(() => toast('已复制提示词'));
    });
    body.querySelector('[data-preview-save]')?.addEventListener('click', () => {
      const c = creations.find(x => x.id === imageGenPreviewId);
      if (c?.image) saveGeneratedToWarehouse({ prompt: c.prompt, image: c.image, sourceId: c.id });
    });
    body.querySelector('[data-preview-del]')?.addEventListener('click', () => {
      const doDel = () => deleteCreation(imageGenPreviewId);
      if (typeof window.customConfirm === 'function') window.customConfirm('删除这条生成记录？', doDel);
      else if (confirm('删除这条生成记录？')) doDel();
    });
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

  function syncImageGenWarehouseFiltersUI() {
    const bar = document.getElementById('imageGenWarehouseFilters');
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

  async function renderImageGenFeed() {
    const wrap = document.getElementById('imageGenFeed');
    if (!wrap) return;
    syncImageGenWarehouseFiltersUI();
    let html = '';
    if (imageGenFeedTab === 'warehouse') {
      const list = typeof window.getWarehouseCardsForImageGen === 'function'
        ? window.getWarehouseCardsForImageGen({ group: imageGenWhGroup, tag: imageGenWhTag }) : [];
      if (!list.length) {
        html = '<p class="imagegen-feed-empty">没有符合条件的卡片<br><button type="button" class="btn btn-primary btn-sm" onclick="switchAppPage(\'warehouse\')">去卡片库添加</button></p>';
      } else {
        html = list.map(c => {
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
      const list = filterAndSortPosts(getAllCommunityPosts()).slice(0, 40);
      if (!list.length) {
        html = '<p class="imagegen-feed-empty">社区暂无内容</p>';
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
    } else {
      const pending = imageGenPendingJobs.slice(0, 8);
      const seenFeed = new Set();
      const list = getGenHistoryItems().filter((c) => {
        const key = c.jobId ? `job:${c.jobId}` : `id:${String(c.id)}`;
        if (seenFeed.has(key)) return false;
        seenFeed.add(key);
        return true;
      }).slice(0, 40);
      if (!pending.length && !list.length) {
        html = '<p class="imagegen-feed-empty">暂无生成记录，点击下方按钮开始创作</p>';
      } else {
        html = pending.map(j => buildFeedPendingCardHtml(j)).join('') + list.map(c => buildFeedCardHtml({
          id: c.id,
          prompt: c.prompt,
          image: c.image,
          jobId: c.jobId,
          metaLine: `${c.modelLabel || '全能模型2'} · ${(c.resolution || '1k').toUpperCase()}`,
          meta: formatExpiryLabel(c),
          active: c.id === imageGenActiveHistoryId,
          showSave: true,
          showDel: true
        })).join('');
      }
    }
    const refsToPrefetch = [];
    if (imageGenFeedTab === 'personal') {
      getGenHistoryItems().slice(0, 40).forEach(c => { if (c.image) refsToPrefetch.push(c.image); });
    } else if (imageGenFeedTab === 'warehouse') {
      (typeof window.getWarehouseCardsForImageGen === 'function'
        ? window.getWarehouseCardsForImageGen({ group: imageGenWhGroup, tag: imageGenWhTag }) : []
      ).forEach(c => { if (c.image) refsToPrefetch.push(c.image); });
    } else if (imageGenFeedTab === 'community') {
      filterAndSortPosts(getAllCommunityPosts()).slice(0, 40).forEach(p => { if (p.image) refsToPrefetch.push(p.image); });
    }
    const mobileFeed = isMobileFeedViewport();
    const prefetchLimit = mobileFeed ? 12 : 32;
    const refsSlice = refsToPrefetch.slice(0, prefetchLimit);

    if (imageGenMasonry) {
      imageGenMasonry.destroy();
      imageGenMasonry = null;
    }
    wrap.className = mobileFeed ? 'imagegen-feed imagegen-feed--tiles mobile-feed-grid' : 'imagegen-feed imagegen-feed--masonry';
    if (!mobileFeed && html.includes('imagegen-feed-card')) {
      wrap.innerHTML = '<div class="grid-sizer"></div>' + html;
    } else {
      wrap.innerHTML = html;
    }
    resetMobileFeedGridStyles();
    bindImageGenFeedCardEvents(wrap);
    bindImageGenFeedImageRelayout();
    if (mobileFeed) enforceMobileImageGenFeed();
    else scheduleImageGenFeedLayout();

    void (async () => {
      if (window.SupabaseSync?.prefetchDisplayUrls && refsSlice.length) {
        await window.SupabaseSync.prefetchDisplayUrls(refsSlice);
      }
      await hydrateFeedImages(wrap);
      bindImageGenFeedImageRelayout();
      if (mobileFeed) enforceMobileImageGenFeed();
      else scheduleImageGenFeedLayout();
    })();
  }

  function bindImageGenFeedCardEvents(wrap) {
    if (!wrap) return;
    wrap.querySelectorAll('.imagegen-feed-card').forEach(card => {
      if (card.dataset.pending === '1') return;
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
          if (rawRef) url = await resolveImageDisplayUrl(rawRef, jobId);
          if (url && typeof window.openLightbox === 'function') window.openLightbox(url);
        })();
      });
      card.querySelector('.imagegen-feed-save-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        if (imageGenFeedTab !== 'personal') return;
        const item = creations.find(x => x.id === feedId);
        if (!item?.image) return;
        saveGeneratedToWarehouse({ prompt: item.prompt, image: item.image, sourceId: item.id });
      });
      card.querySelector('[data-delete-feed]')?.addEventListener('click', e => {
        e.stopPropagation();
        if (imageGenFeedTab !== 'personal') return;
        const doDel = () => deleteCreation(feedId);
        if (typeof window.customConfirm === 'function') window.customConfirm('删除这条生成记录？', doDel);
        else if (confirm('删除这条生成记录？')) doDel();
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
        } else {
          openImageGenPreview('personal', feedId);
        }
      });
      if (imageGenFeedTab === 'personal' && feedId && !feedId.startsWith('wh_')) {
        card.addEventListener('contextmenu', e => {
          e.preventDefault();
          e.stopPropagation();
          const menuFn = window.showContextMenu;
          if (typeof menuFn !== 'function') return;
          menuFn(e.clientX, e.clientY, [
            { label: '删除记录', danger: true, action: () => confirmDeleteCreation(feedId) }
          ]);
        });
      }
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
        communitySort = btn.dataset.communitySort;
        document.querySelectorAll('[data-community-sort]').forEach(b => b.classList.toggle('active', b === btn));
        renderCommunity();
      });
    });
    document.querySelectorAll('[data-community-media]').forEach(btn => {
      btn.addEventListener('click', () => {
        communityMediaFilter = btn.dataset.communityMedia || 'all';
        document.querySelectorAll('[data-community-media]').forEach(b => {
          b.classList.toggle('active', b === btn);
        });
        closeCommunitySidePanel();
        renderCommunity();
      });
    });
    document.querySelectorAll('[data-creations-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        creationsTab = btn.dataset.creationsTab;
        document.querySelectorAll('[data-creations-tab]').forEach(b => b.classList.toggle('active', b === btn));
        closeCreationsSidePanel();
        renderCreations();
      });
    });
    document.getElementById('communitySideClose')?.addEventListener('click', closeCommunitySidePanel);
    document.getElementById('creationsSideClose')?.addEventListener('click', closeCreationsSidePanel);
    bindPublishToggle();
    document.getElementById('userProfileClose')?.addEventListener('click', closeUserProfile);
    document.getElementById('userProfileBack')?.addEventListener('click', closeUserProfile);
    document.getElementById('userProfileOverlay')?.addEventListener('click', e => {
      if (e.target.id === 'userProfileOverlay') closeUserProfile();
    });
    document.getElementById('imageGenSubmit')?.addEventListener('click', runImageGenDemo);
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
    document.getElementById('imageGenPreviewClose')?.addEventListener('click', closeImageGenPreview);
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
    bindImageGenAutoPublish();
    bindImageGenAutoSave();
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
      else if (creationsSideId) closeCreationsSidePanel();
      else if (document.body.classList.contains('community-panel-open')) closeCommunitySidePanel();
    });
  }

  function onAppChange(app) {
    const fab = document.getElementById('fabNewBtn');
    if (fab) fab.classList.toggle('hidden-by-app', app !== 'warehouse');
    if (app === 'community') {
      renderCommunity();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scheduleCommunityLayout('communityGrid'));
      });
    }
    if (app === 'creations') {
      const priv = creations.filter(c => c.visibility === 'private' && (c.prompt || '').trim()).length;
      const pub = creations.filter(c => c.visibility === 'published' && (c.prompt || '').trim()).length;
      if (creationsTab === 'private' && !priv && pub) {
        creationsTab = 'published';
        document.querySelectorAll('[data-creations-tab]').forEach(b => {
          b.classList.toggle('active', b.dataset.creationsTab === 'published');
        });
      }
      void renderCreations();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scheduleCommunityLayout('creationsGrid'));
      });
    }
    if (app !== 'community') closeCommunitySidePanel();
    if (app !== 'creations') closeCreationsSidePanel();
    if (app !== 'imagegen') closeImageGenPreview();
    if (app === 'imagegen') {
      imageGenAutoPublishSession = null;
      imageGenAutoSaveSession = null;
      window.MobileUI?.initImageGenMobileView?.();
      pruneCreations();
      initImageGenForm();
      updateImageGenFeedHint();
      renderImageGenFeed();
      void window.PointsSystem?.refreshCreditsFromServer?.();
      window.PointsSystem?.updateCreditsUI?.();
    }
  }

  function init() {
    loadStores();
    bindUI();
    bindPublishToggle();
    onAppChange(localStorage.getItem('promptrepo_app_page') || 'warehouse');
  }

  function refreshImageGenCost() {
    updateImageGenCostHint();
  }

  function getCloudSlice() {
    return {
      communityPosts: communityPosts.filter(p => !p.isMock),
      creations: filterCreationsForCloud(creations),
      communityLikes: [...likedIds],
      communityFavorites: [...favIds]
    };
  }

  function applyCloudSlice(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (Array.isArray(payload.communityPosts)) {
      communityPosts = payload.communityPosts.filter(p => !p.isMock).map(p => {
        if (!p?.image || !window.SupabaseSync?.normalizeImageRef) return p;
        return { ...p, image: window.SupabaseSync.normalizeImageRef(p.image) };
      });
      saveJson(LS_COMMUNITY, communityPosts);
    }
    if (Array.isArray(payload.creations)) {
      const tomb = window.getDeletedCreationTombstones?.() || {};
      creations = payload.creations
        .filter((c) => c && c.id != null && !tomb[String(c.id)])
        .map((c) => {
          if (!c?.image || !window.SupabaseSync?.normalizeImageRef) return c;
          return { ...c, image: window.SupabaseSync.normalizeImageRef(c.image) };
        });
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
    if (document.getElementById('pageCommunity')?.classList.contains('active')) {
      renderCommunity();
    }
    if (document.getElementById('pageCreations')?.classList.contains('active')) {
      renderCreations();
    }
  }

  window.FeatureDraft = {
    init,
    onAppChange,
    refreshImageGenCost,
    syncCardToCommunity,
    removeCommunityByCardId,
    setPublishCheckbox,
    readPublishCheckbox,
    getCloudSlice,
    applyCloudSlice,
    reconcileCommunityWithCards,
    hydrateFeedImages,
    resetMobileFeedGridStyles,
    enforceMobileImageGenFeed,
    closeImageGenFilterSheet,
    renderImageGenFeed,
    isDisplayableImage,
    scheduleImageGenFeedLayout: scheduleImageGenFeedLayout,
    scheduleLayout: scheduleCommunityLayout,
    scheduleCreationsLayout: () => scheduleCommunityLayout('creationsGrid'),
    fillFormPromptOnly,
    copyFeedPromptText,
    fillFeedPromptToImageGen,
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

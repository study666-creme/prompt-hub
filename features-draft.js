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

  const GEN_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

  let communityPosts = [];
  let creations = [];
  let likedIds = new Set();
  let favIds = new Set();
  let creationsTab = 'private';
  let communitySort = 'hot';
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
  let imageGenWhGroup = 'all';
  let imageGenWhTag = 'all';
  let communityMasonry = null;
  let profileMasonry = null;
  let creationsMasonry = null;
  let communitySidePostId = null;
  let creationsSideId = null;
  let layoutCommunityTimer = null;

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

  function loadStores() {
    communityPosts = loadJson(LS_COMMUNITY, []).filter(p => !p.isMock);
    creations = loadJson(LS_CREATIONS, []);
    likedIds = new Set(loadJson(LS_LIKES, []));
    favIds = new Set(loadJson(LS_FAVS, []));
    pruneCreations();
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
      if (hasCards && (!p.sourceCardId || !cardIds.has(p.sourceCardId))) continue;
      if (!p.sourceCardId) continue;
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
    return window.SupabaseSync?.getCachedDisplayUrl?.(image) || image;
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

  function scheduleCommunityLayout(containerId) {
    clearTimeout(layoutCommunityTimer);
    layoutCommunityTimer = setTimeout(() => layoutCommunityMasonry(containerId), 100);
  }

  function layoutCommunityMasonry(containerId) {
    const container = document.getElementById(containerId);
    if (!container || typeof Masonry === 'undefined') return;
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
      const imgRefAttr = window.SupabaseSync?.isStorageRef?.(post.image)
        ? ` data-storage-ref="${esc(post.image)}"`
        : '';
      const mediaInner = post.image
        ? `<img class="card-img" src="${esc(featureImgSrc(post.image))}"${imgRefAttr} loading="lazy" draggable="false" alt="" onload="if(typeof FeatureDraft!=='undefined')FeatureDraft.scheduleLayout('${containerId}')">`
        : '<div class="card-media-placeholder" aria-hidden="true"></div>';
      const timeLabel = `♥ ${post.likes || 0}`;
      const desc = getPostDesc(post);
      const descHtml = desc ? `<div class="card-desc">${esc(desc)}</div>` : '';
      div.innerHTML = `
        <div class="card-media">${mediaInner}</div>
        <div class="card-body">
          <div class="card-head">
            <div class="card-title card-title-prompt">${esc(getPostTitle(post))}</div>
            <time class="card-time ${liked ? 'liked' : ''}">${esc(timeLabel)}</time>
          </div>
          ${descHtml}
          <div class="card-tags">
            <button type="button" class="tag community-author-link" data-author-id="${esc(post.authorId)}" data-author-name="${esc(post.authorName)}">${esc(post.authorName)}</button>
          </div>
        </div>`;
      div.addEventListener('click', () => openCommunitySidePanel(post.id));
      const authorBtn = div.querySelector('.community-author-link');
      if (authorBtn) bindAuthorLink(authorBtn, post.authorId, post.authorName);
      fragment.appendChild(div);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
    if (window.SupabaseSync?.hydrateImageElements) {
      void window.SupabaseSync.hydrateImageElements(container).then(() => scheduleCommunityLayout(containerId));
    } else {
      scheduleCommunityLayout(containerId);
    }
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
    if (window.__promptHubCards?.length) {
      reconcileCommunityWithCards(window.__promptHubCards);
    }
    let list = filterAndSortPosts(getAllCommunityPosts());
    if (!list.length) {
      if (communityMasonry) { communityMasonry.destroy(); communityMasonry = null; }
      container.innerHTML = '<div class="feature-empty"><p>暂无社区内容</p><button type="button" class="btn btn-primary" onclick="switchAppPage(\'warehouse\')">去卡片库发布</button></div>';
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
    card.communityPostId = post.id;
    persistCommunity();
    renderCommunity();
    if (openProfileAuthorId === user.id) renderUserProfileGrid();
    checkOwnPostMilestones(post.id);
  }

  function removeCommunityByCardId(cardId) {
    const i = communityPosts.findIndex(p => p.sourceCardId === cardId);
    if (i >= 0) {
      const authorId = communityPosts[i].authorId;
      communityPosts.splice(i, 1);
      persistCommunity();
      renderCommunity();
      if (openProfileAuthorId === authorId) renderUserProfileGrid();
    }
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
    renderCommunity();
    if (openProfileAuthorId) renderUserProfileGrid();
    if (communitySidePostId === id) renderCommunitySidePanel(id);
    if (document.getElementById('pageImageGen')?.classList.contains('active')) {
      renderImageGenFeed();
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
    if (titleEl) titleEl.textContent = getPostTitle(post);
    const faved = favIds.has(id);
    const liked = likedIds.has(id);
    let sideImgSrc = post.image || '';
    if (sideImgSrc && window.SupabaseSync?.resolveDisplayUrl) {
      sideImgSrc = await window.SupabaseSync.resolveDisplayUrl(sideImgSrc);
    }
    const imgBlock = sideImgSrc
      ? `<img class="community-side-img" src="${esc(sideImgSrc)}" alt="">`
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
      </div>
      <p class="panel-hint">复制、收藏、制作同款会自动点赞</p>`;
    body.querySelector('[data-action="like"]')?.addEventListener('click', () => likeCommunityPostOnly(id));
    body.querySelector('[data-action="copy"]')?.addEventListener('click', () => copyPostPrompt(post));
    body.querySelector('[data-action="fav"]')?.addEventListener('click', () => favoritePost(id, post));
    body.querySelector('[data-action="remix"]')?.addEventListener('click', () => remixToImageGen(post));
    const authorBtn = body.querySelector('.community-detail-author-btn');
    if (authorBtn) bindAuthorLink(authorBtn, post.authorId, post.authorName);
    highlightCommunityCard(id);
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
    renderCommunitySidePanel(id);
    scheduleCommunityLayout('communityGrid');
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

  function copyPostPrompt(post) {
    if (!window.AuthGate?.requireAuth?.('copy')) return;
    ensureLike(post.id);
    navigator.clipboard.writeText(post.prompt || '').then(() => toast('已复制，已为作者点赞'));
  }

  function favoritePost(id, post) {
    if (!window.AuthGate?.requireAuth?.('community')) return;
    ensureLike(id);
    if (favIds.has(id)) {
      toast('已在卡片库中');
      if (communitySidePostId === id) renderCommunitySidePanel(id);
      return;
    }
    favIds.add(id);
    addCardFromPost(post);
    persistFavs();
    toast('已收藏到卡片库，已为作者点赞');
    if (communitySidePostId === id) renderCommunitySidePanel(id);
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

  function renderCreationsSidePanel(id) {
    const body = document.getElementById('creationsSideBody');
    const c = creations.find(x => x.id === id);
    if (!body || !c) return;
    const badge = c.visibility === 'published' ? '已发布' : '私密';
    const imgHtml = c.image
      ? `<button type="button" class="community-side-img-btn" data-save-img title="点击保存到卡片仓库"><img class="community-side-img" src="${esc(c.image)}" alt=""><span class="community-side-img-hint">点击保存到卡片仓库</span></button>`
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
      <p class="panel-hint">点击图片或「保存到仓库」可将提示词与图片写入卡片库</p>`;
    body.querySelector('[data-save-img]')?.addEventListener('click', () => {
      saveGeneratedToWarehouse({ prompt: c.prompt, image: c.image, sourceId: c.id });
    });
    body.querySelector('[data-action="save"]')?.addEventListener('click', () => {
      saveGeneratedToWarehouse({ prompt: c.prompt, image: c.image, sourceId: c.id });
    });
    body.querySelector('[data-action="publish"]')?.addEventListener('click', () => publishCreation(id));
    body.querySelector('[data-action="remix"]')?.addEventListener('click', () => remixCreation(id));
    body.querySelector('[data-action="del"]')?.addEventListener('click', () => {
      deleteCreation(id);
      closeCreationsSidePanel();
    });
    highlightCreationCard(id);
  }

  function openCreationsSidePanel(id) {
    const c = creations.find(x => x.id === id);
    if (!c) return;
    creationsSideId = id;
    document.getElementById('creationsSidePanel')?.classList.remove('hidden');
    document.body.classList.add('community-panel-open');
    renderCreationsSidePanel(id);
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
        ? '点击卡片在右侧查看详情 · 生成图保留 3 天'
        : '点击卡片在右侧查看详情 · 已发布作品永久保留';
    }
    if (creationsMasonry) {
      creationsMasonry.destroy();
      creationsMasonry = null;
    }
    pruneCreations();
    const list = creations
      .filter(c => c.visibility === creationsTab && c.image)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!list.length) {
      closeCreationsSidePanel();
      container.innerHTML = `<div class="feature-empty"><p>${creationsTab === 'private' ? '暂无私密作品' : '暂无已发布作品'}</p><button type="button" class="btn btn-primary" onclick="switchAppPage('imagegen')">去图片生成</button></div>`;
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
      div.innerHTML = `
        <div class="card-media"><img class="card-img" src="${esc(featureImgSrc(c.image))}" loading="lazy" alt="" onload="if(typeof FeatureDraft!=='undefined')FeatureDraft.scheduleCreationsLayout()"></div>
        <div class="card-body">
          <div class="card-head">
            <div class="card-title">${esc((c.prompt || '').slice(0, 28) || '无标题')}</div>
            <time class="card-time">${esc(formatExpiryLabel(c))}</time>
          </div>
          <div class="card-desc">${esc((c.prompt || '').slice(0, 80))}</div>
          <div class="card-tags"><span class="tag">${esc(badge)}</span><span class="tag">${esc((c.resolution || '1k').toUpperCase())}</span></div>
        </div>`;
      div.addEventListener('click', () => openCreationsSidePanel(c.id));
      fragment.appendChild(div);
    });
    container.innerHTML = '';
    container.appendChild(fragment);
    scheduleCommunityLayout('creationsGrid');
    if (creationsSideId && list.some(c => c.id === creationsSideId)) {
      renderCreationsSidePanel(creationsSideId);
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
    if (creationsSideId === id) renderCreationsSidePanel(id);
  }

  function deleteCreation(id) {
    if (creationsSideId === id) closeCreationsSidePanel();
    creations = creations.filter(c => c.id !== id);
    persistCreations();
    renderCreations();
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
    return creations.filter(c => c.prompt && c.image);
  }

  function fillFormFromData({ prompt, refImage, refImages, model, resolution, quality, size, sourceId, sourceType }) {
    const promptEl = document.getElementById('imageGenPrompt');
    if (promptEl) promptEl.value = prompt || '';
    if (refImages?.length) setImageGenRefs(refImages);
    else if (refImage) setImageGenRefs(Array.isArray(refImage) ? refImage : [refImage]);
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

  function applyHistoryToForm(item) {
    if (!item) return;
    fillFormFromData({
      prompt: item.prompt,
      refImages: item.refImages,
      refImage: item.refImage || item.image,
      model: item.model,
      resolution: item.resolution,
      quality: item.quality,
      size: item.size,
      sourceId: item.id,
      sourceType: 'personal'
    });
  }

  function fillFromCommunityPost(post, autoLike) {
    if (!post) return;
    if (autoLike) ensureLike(post.id);
    fillFormFromData({
      prompt: post.prompt,
      refImage: post.image || null
    });
  }

  function likeCommunityPostOnly(postId) {
    const wasNew = ensureLike(postId);
    renderImageGenFeed();
    if (communitySidePostId === postId) renderCommunitySidePanel(postId);
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
        refImage: data.image || null,
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
        <img src="${esc(src)}" alt="参考图 ${i + 1}">
        <button type="button" class="imagegen-ref-rm" data-ref-idx="${i}" aria-label="移除">×</button>
      </div>
    `).join('');
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
    const input = document.getElementById('imageGenRefInput');
    if (!drop || !input) return;
    if (drop.dataset.bound === '1') return;
    drop.dataset.bound = '1';

    drop.addEventListener('click', e => {
      if (e.target.closest('.imagegen-ref-rm')) return;
      input.click();
    });
    input.addEventListener('change', () => {
      if (input.files?.length) addImageGenRefFiles(input.files);
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach(ev => {
      drop.addEventListener(ev, e => {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.add('drag-over');
      });
    });
    drop.addEventListener('dragleave', e => {
      e.preventDefault();
      drop.classList.remove('drag-over');
    });
    drop.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.remove('drag-over');
      if (e.dataTransfer?.files?.length) addImageGenRefFiles(e.dataTransfer.files);
    });

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
      await new Promise(r => setTimeout(r, 3000));
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
        finishImageGenRun({
          ...ctx,
          image: imageUrl,
          cost: ctx.cost
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
        toast(gen.message || '生图失败');
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
        finishImageGenRun({
          prompt,
          model,
          resolution,
          quality,
          size,
          image: gen.data.imageUrl,
          cost
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
        cost
      });
      return;
    }

    if (!window.PointsSystem?.deductCredits?.(cost)) {
      removePendingJob(pendingId);
      renderImageGenFeed();
      toast('积分扣除失败');
      return;
    }
    if (btn) {
      btn.disabled = false;
      restoreImageGenSubmitLabel();
    }
    setTimeout(() => {
      removePendingJob(pendingId);
      finishImageGenRun({
        prompt,
        model,
        resolution,
        quality,
        size,
        image: makePlaceholderDataUrl(prompt + resolution, creations.length),
        cost
      });
    }, 900);
  }

  function finishImageGenRun({ prompt, model, resolution, quality, size, image, cost, btn }) {
    if (!image || (typeof image === 'string' && image.startsWith('storage://'))) {
      toast('图片地址无效，请重试');
      return;
    }
    imageGenLastResult = image;
    const primaryRef = getImageGenPrimaryRef();
    const modelId = model || 'quanneng2';
    const modelLabel = window.PointsSystem?.getImageGenModel?.(modelId)?.label || modelId;
    const creation = {
      id: genId('cr'),
      prompt,
      image,
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
      expiresAt: Date.now() + GEN_RETENTION_MS
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
      toast(`已生成并发布到社区（-${cost} 积分）`);
    } else {
      toast(`已生成（-${cost} 积分，保留 3 天；发布到社区可永久保留）`);
    }
    if (window.MobileUI?.isMobile?.() && window.MobileUI?.setImageGenView) {
      window.MobileUI.setImageGenView('feed');
    }
  }

  function updateImageGenFeedHint() {
    const el = document.getElementById('imageGenFeedHint');
    if (!el) return;
    if (imageGenFeedTab === 'warehouse') {
      el.textContent = '按分组或标签筛选 · 点击图片放大 · 点击卡片填入生图框';
    } else if (imageGenFeedTab === 'community') {
      el.textContent = '社区作品 · 点击图片放大 · 点击卡片填入并点赞';
    } else {
      const n = imageGenPendingJobs.length;
      el.textContent = n
        ? `我的生成 · ${n} 个任务进行中（右侧显示）· 可连续提交`
        : '我的生成记录 · 点击图片放大 · 可存仓库 · 保留 3 天';
    }
  }

  function feedImageAttrs(image) {
    if (!image) return { src: '', refAttr: '' };
    const src = featureImgSrc(image);
    const refAttr = window.SupabaseSync?.isStorageRef?.(image)
      ? ` data-storage-ref="${esc(image)}"`
      : '';
    return { src: esc(src), refAttr };
  }

  function buildFeedPendingCardHtml(job) {
    const badges = [job.modelLabel || '生图中', (job.resolution || '1k').toUpperCase()];
    const badgeHtml = badges.map(b => `<span class="imagegen-feed-badge">${esc(b)}</span>`).join('');
    return `<article class="imagegen-feed-card imagegen-feed-card-tile imagegen-feed-card--pending" data-feed-id="${esc(job.id)}" data-pending="1">
      <div class="imagegen-feed-media imagegen-gen-pending" aria-busy="true">
        <div class="imagegen-gen-pending-inner">
          <div class="imagegen-gen-pending-orb"></div>
          <div class="imagegen-gen-pending-orb imagegen-gen-pending-orb--delay"></div>
          <span class="imagegen-gen-pending-label">生成中</span>
        </div>
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

  function buildFeedCardHtml(opts) {
    const {
      id, prompt, image, title, badges = [], meta = '', active = false,
      showLike = false, liked = false, likeCount = 0, showSave = false
    } = opts;
    const { src: imgSrc, refAttr: imgRefAttr } = feedImageAttrs(image);
    const previewSrc = image && !imgSrc.startsWith('storage://') ? image : imgSrc;
    const imgBlock = image
      ? `<button type="button" class="imagegen-feed-thumb-btn" data-preview-src="${esc(previewSrc)}" title="放大预览"><img src="${imgSrc}"${imgRefAttr} alt="" loading="lazy"></button>`
      : '<div class="imagegen-feed-img-empty">无图</div>';
    const badgeHtml = badges.map(b => `<span class="imagegen-feed-badge">${esc(b)}</span>`).join('');
    const likeBtn = showLike
      ? `<button type="button" class="imagegen-feed-like ${liked ? 'liked' : ''}" data-like-id="${esc(id)}" title="点赞">♥ ${likeCount}</button>`
      : '';
    const saveBtn = showSave
      ? '<button type="button" class="btn btn-ghost btn-sm imagegen-feed-save-btn" data-save-feed="1">存仓库</button>'
      : '';
    return `<article class="imagegen-feed-card imagegen-feed-card-tile${active ? ' active' : ''}" data-feed-id="${esc(id)}" tabindex="0">
      <div class="imagegen-feed-media">${imgBlock}</div>
      <div class="imagegen-feed-content">
        <p class="imagegen-feed-prompt">${esc(prompt || title || '无提示词')}</p>
        <div class="imagegen-feed-tags">${badgeHtml}</div>
        <div class="imagegen-feed-foot">
          <span class="imagegen-feed-meta">${esc(meta)}</span>
          <div class="imagegen-feed-actions">${likeBtn}${saveBtn}</div>
        </div>
        <span class="imagegen-feed-fill-hint">点击卡片填入生图框</span>
      </div>
    </article>`;
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
  }

  function renderImageGenFeed() {
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
          const titleLine = (c.title || '').trim() || (c.prompt || '').slice(0, 24);
          return buildFeedCardHtml({
            id: 'wh_' + c.id,
            prompt: c.prompt,
            image: c.image,
            title: c.title,
            badges: [groupLabel, ...(c.tags || []).slice(0, 2)],
            meta: titleLine || groupLabel
          });
        }).join('');
      }
    } else if (imageGenFeedTab === 'community') {
      const list = filterAndSortPosts(getAllCommunityPosts()).slice(0, 40);
      if (!list.length) {
        html = '<p class="imagegen-feed-empty">社区暂无内容</p>';
      } else {
        html = list.map(p => buildFeedCardHtml({
          id: p.id,
          prompt: p.prompt,
          image: p.image,
          title: p.title,
          badges: [p.authorName, p.modelLabel || '全能模型2'],
          meta: `♥ ${p.likes || 0} · ${formatTime(p.createdAt)}`,
          showLike: true,
          liked: likedIds.has(p.id),
          likeCount: p.likes || 0
        })).join('');
      }
    } else {
      const pending = imageGenPendingJobs.slice(0, 8);
      const list = getGenHistoryItems().slice(0, 40);
      if (!pending.length && !list.length) {
        html = '<p class="imagegen-feed-empty">暂无生成记录，点击下方按钮开始创作</p>';
      } else {
        html = pending.map(j => buildFeedPendingCardHtml(j)).join('') + list.map(c => buildFeedCardHtml({
          id: c.id,
          prompt: c.prompt,
          image: c.image,
          badges: [c.modelLabel || '全能模型2', (c.resolution || '1k').toUpperCase()],
          meta: formatExpiryLabel(c),
          active: c.id === imageGenActiveHistoryId,
          showSave: true
        })).join('');
      }
    }
    wrap.className = 'imagegen-feed imagegen-feed--tiles';
    wrap.innerHTML = html;
    const allImages = [];
    wrap.querySelectorAll('img[data-storage-ref]').forEach(img => {
      allImages.push(img.getAttribute('data-storage-ref'));
    });
    if (window.SupabaseSync?.prefetchDisplayUrls && allImages.length) {
      void window.SupabaseSync.prefetchDisplayUrls(allImages).then(() => {
        if (window.SupabaseSync.hydrateImageElements) {
          void window.SupabaseSync.hydrateImageElements(wrap);
        }
      });
    } else if (window.SupabaseSync?.hydrateImageElements) {
      void window.SupabaseSync.hydrateImageElements(wrap);
    }
    wrap.querySelectorAll('.imagegen-feed-card').forEach(card => {
      if (card.dataset.pending === '1') return;
      const feedId = card.dataset.feedId;
      card.querySelector('.imagegen-feed-thumb-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        const btnEl = e.currentTarget;
        const rawRef = btnEl.querySelector('img')?.getAttribute('data-storage-ref');
        const src = btnEl.dataset.previewSrc;
        if (rawRef && window.SupabaseSync?.resolveDisplayUrl) {
          void window.SupabaseSync.resolveDisplayUrl(rawRef).then(url => {
            if (url && typeof window.openLightbox === 'function') window.openLightbox(url);
          });
        } else if (src && typeof window.openLightbox === 'function') {
          window.openLightbox(src);
        }
      });
      card.querySelector('.imagegen-feed-save-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        if (imageGenFeedTab !== 'personal') return;
        const item = creations.find(x => x.id === feedId);
        if (!item?.image) return;
        saveGeneratedToWarehouse({ prompt: item.prompt, image: item.image, sourceId: item.id });
      });
      card.addEventListener('click', e => {
        if (e.target.closest('.imagegen-feed-like')) return;
        if (e.target.closest('.imagegen-feed-thumb-btn')) return;
        if (e.target.closest('.imagegen-feed-save-btn')) return;
        if (imageGenFeedTab === 'warehouse') {
          const rawId = feedId.replace(/^wh_/, '');
          const list = window.getWarehouseCardsForImageGen?.() || [];
          const c = list.find(x => x.id === rawId);
          if (c) fillFormFromData({ prompt: c.prompt, refImage: c.image });
        } else if (imageGenFeedTab === 'community') {
          const post = findPost(feedId);
          if (post) fillFromCommunityPost(post, true);
        } else {
          const item = creations.find(x => x.id === feedId);
          if (item) applyHistoryToForm(item);
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
        communitySort = btn.dataset.communitySort;
        document.querySelectorAll('[data-community-sort]').forEach(b => b.classList.toggle('active', b === btn));
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
        updateImageGenFeedHint();
        renderImageGenFeed();
      });
    });
    document.getElementById('imageGenWhGroup')?.addEventListener('change', e => {
      imageGenWhGroup = e.target.value || 'all';
      renderImageGenFeed();
    });
    document.getElementById('imageGenWhTag')?.addEventListener('change', e => {
      imageGenWhTag = e.target.value || 'all';
      renderImageGenFeed();
    });
    bindImageGenUpload();
    bindImageGenAutoPublish();
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
      if (document.getElementById('userProfileOverlay')?.classList.contains('active')) {
        scheduleCommunityLayout('userProfileGrid');
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (document.getElementById('userProfileOverlay')?.classList.contains('active')) closeUserProfile();
      else if (creationsSideId) closeCreationsSidePanel();
      else if (document.body.classList.contains('community-panel-open')) closeCommunitySidePanel();
    });
  }

  function onAppChange(app) {
    const fab = document.getElementById('fabNewBtn');
    if (fab) fab.classList.toggle('hidden-by-app', app !== 'warehouse');
    if (app === 'community') {
      renderCommunity();
      requestAnimationFrame(() => scheduleCommunityLayout('communityGrid'));
    }
    if (app === 'creations') {
      renderCreations();
      requestAnimationFrame(() => scheduleCommunityLayout('creationsGrid'));
    }
    if (app !== 'community') closeCommunitySidePanel();
    if (app !== 'creations') closeCreationsSidePanel();
    if (app === 'imagegen') {
      imageGenAutoPublishSession = null;
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
      creations,
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
      creations = payload.creations.map(c => {
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
    scheduleLayout: scheduleCommunityLayout,
    scheduleCreationsLayout: () => scheduleCommunityLayout('creationsGrid')
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/**
 * 社区 · 随心一抽：从已加载作品池抽卡，SSR 光效 + 翻转 + 收藏入仓库
 */
(function () {
  const LS_PREFIX = 'ph_community_gacha_';
  const GACHA_DAILY_LIMIT = 10;

  function $(id) {
    return document.getElementById(id);
  }

  function toast(msg) {
    window.toast?.(msg);
  }

  function chinaDateKey() {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    return new Date(utc + 8 * 3600000).toISOString().slice(0, 10);
  }

  function storageKey() {
    const uid = window.SupabaseSync?.getUserId?.() || 'guest';
    return `${LS_PREFIX}${uid}_${chinaDateKey()}`;
  }

  function readTodayState() {
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return { count: 0, date: chinaDateKey() };
      const data = JSON.parse(raw);
      if (data?.date !== chinaDateKey()) return { count: 0, date: chinaDateKey() };
      return { count: Math.max(0, Number(data.count) || 0), date: data.date };
    } catch (e) {
      return { count: 0, date: chinaDateKey() };
    }
  }

  function remainingDraws() {
    return Math.max(0, GACHA_DAILY_LIMIT - readTodayState().count);
  }

  function canDrawToday() {
    return remainingDraws() > 0;
  }

  function recordDraw() {
    const state = readTodayState();
    const count = state.count + 1;
    try {
      localStorage.setItem(storageKey(), JSON.stringify({ count, date: chinaDateKey() }));
    } catch (e) { /* ignore */ }
    return count;
  }

  function cachedPostImageUrl(post) {
    const ref = window.FeatureDraft?.communityPostDisplayImageRef?.(post)
      || window.FeatureDraft?.canonicalCommunityImageRef?.(post)
      || post.image;
    if (!ref) return '';
    if (window.SupabaseSync?.isDataUrl?.(ref) || /^https?:\/\//i.test(ref)) return ref;
    const cardId = post.sourceCardId || post.id;
    const hit = window.SupabaseSync?.getCachedDisplayUrl?.(ref, {
      assetId: cardId,
      authorId: post.authorId || undefined,
      cardId: post.sourceCardId || undefined,
      variant: 'full'
    }) || window.SupabaseSync?.getCachedDisplayUrl?.(ref, {
      assetId: cardId,
      variant: 'grid'
    });
    if (hit && /^https?:\/\//i.test(hit) && !hit.includes('data:image/svg')) return hit;
    const domUrl = findDomLoadedImageUrl(post);
    return domUrl || '';
  }

  function findDomLoadedImageUrl(post) {
    const grid = $('communityGrid');
    if (!grid) return '';
    const pid = String(post.id || '');
    const sid = String(post.sourceCardId || '');
    const imgs = grid.querySelectorAll('img[data-image-ref], .card-media img');
    for (const img of imgs) {
      const card = img.closest('.card');
      if (!card) continue;
      const postId = String(card.dataset?.postId || card.dataset?.feedId?.replace(/^wh_/, '') || '');
      const cardId = String(card.dataset?.sourceCardId || card.dataset?.id || '');
      const match = (pid && postId === pid) || (sid && cardId === sid);
      if (!match) continue;
      if (img.complete && img.naturalWidth > 0 && img.src && !img.src.includes('data:image/svg')) {
        return img.src;
      }
    }
    return '';
  }

  function isOwnPost(post) {
    if (!post) return false;
    const uid = window.SupabaseSync?.getUserId?.();
    if (!uid) return false;
    if (String(post.authorId) === String(uid)) return true;
    if (post.sourceCardId) {
      const cards = window.__promptHubCards || [];
      if (cards.some((c) => String(c.id) === String(post.sourceCardId))) return true;
    }
    return false;
  }

  function getPoolPosts() {
    const posts = window.FeatureDraft?.getCommunityFeedForDisplay?.() || [];
    return posts.filter((p) => {
      if (!p || p.isMock || isOwnPost(p)) return false;
      const ref = window.FeatureDraft?.communityPostDisplayImageRef?.(p)
        || window.FeatureDraft?.canonicalCommunityImageRef?.(p)
        || p.image;
      return !!(ref && window.FeatureDraft?.isDisplayableImage?.(ref));
    });
  }

  function getDrawablePosts(excludePostId) {
    const posts = getPoolPosts().filter((p) => !excludePostId || String(p.id) !== String(excludePostId));
    const ready = posts.filter((p) => !!cachedPostImageUrl(p));
    return ready.length ? ready : posts;
  }

  function pickRarityTier() {
    const r = Math.random();
    if (r < 0.1) return 'ssr';
    if (r < 0.35) return 'sr';
    return 'r';
  }

  function poolForTier(posts, tier) {
    const sorted = [...posts].sort((a, b) => (Number(b.likes) || 0) - (Number(a.likes) || 0));
    const n = sorted.length;
    if (tier === 'ssr') return sorted.slice(0, Math.max(1, Math.ceil(n * 0.12)));
    if (tier === 'sr') return sorted.slice(0, Math.max(2, Math.ceil(n * 0.4)));
    return sorted;
  }

  function drawFromPool(posts) {
    const tier = pickRarityTier();
    const pool = poolForTier(posts, tier);
    const post = pool[Math.floor(Math.random() * pool.length)] || posts[0];
    return { post, tier };
  }

  function tierLabel(tier) {
    if (tier === 'ssr') return 'SSR';
    if (tier === 'sr') return 'SR';
    return 'R';
  }

  function isPostCollected(post) {
    if (!post) return false;
    const tag = window.COMMUNITY_COLLECT_TAG || '社区收藏';
    const cards = window.__promptHubCards || [];
    return cards.some((c) => {
      if (!(c.tags || []).includes(tag)) return false;
      if (c.favoritedFromPostId === post.id || c.communitySourceId === post.id) return true;
      if (post.sourceCardId && String(c.id) === String(post.sourceCardId)) return true;
      return false;
    });
  }

  function preloadImage(url) {
    return new Promise((resolve, reject) => {
      if (!url) {
        reject(new Error('empty'));
        return;
      }
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(url);
      img.onerror = () => reject(new Error('load failed'));
      img.src = url;
    });
  }

  let overlayEl = null;
  let cardEl = null;
  let frontImg = null;
  let metaEl = null;
  let rarityEl = null;
  let promptEl = null;
  let collectBtn = null;
  let redrawBtn = null;
  let statusEl = null;
  let currentDraw = null;
  let animating = false;
  let revealGen = 0;
  let bound = false;

  function ensureOverlay() {
    if (overlayEl) return;
    overlayEl = document.createElement('div');
    overlayEl.id = 'communityGachaOverlay';
    overlayEl.className = 'community-gacha-overlay hidden';
    overlayEl.innerHTML =
      '<div class="community-gacha-backdrop"></div>' +
      '<div class="community-gacha-stage" role="dialog" aria-modal="true" aria-label="随心一抽">' +
      '<button type="button" class="community-gacha-close" aria-label="关闭">×</button>' +
      '<p class="community-gacha-kicker">随心一抽</p>' +
      '<p class="community-gacha-status hidden" id="communityGachaStatus">正在揭示…</p>' +
      '<div class="community-gacha-card-scene">' +
      '<div class="community-gacha-ssr-fx" aria-hidden="true"></div>' +
      '<div class="community-gacha-card">' +
      '<div class="community-gacha-face community-gacha-back">' +
      '<div class="community-gacha-back-foil" aria-hidden="true"></div>' +
      '<div class="community-gacha-back-border">' +
      '<div class="community-gacha-back-inner">' +
      '<div class="community-gacha-back-pattern" aria-hidden="true"></div>' +
      '<div class="community-gacha-back-orbit" aria-hidden="true"><span></span><span></span><span></span><span></span></div>' +
      '<div class="community-gacha-back-sigil" aria-hidden="true">' +
      '<div class="community-gacha-back-star"></div>' +
      '<span class="community-gacha-back-mark">PH</span>' +
      '</div>' +
      '<p class="community-gacha-back-brand">PROMPT HUB</p>' +
      '<p class="community-gacha-back-sub">INSPIRE · DRAW</p>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="community-gacha-face community-gacha-front">' +
      '<img alt="" class="community-gacha-front-img">' +
      '<div class="community-gacha-shine" aria-hidden="true"></div>' +
      '<div class="community-gacha-front-loading hidden" aria-hidden="true"><span></span></div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="community-gacha-meta hidden">' +
      '<span class="community-gacha-rarity"></span>' +
      '<p class="community-gacha-prompt"></p>' +
      '<div class="community-gacha-actions">' +
      '<button type="button" class="btn btn-primary btn-sm community-gacha-collect">收藏入仓库</button>' +
      '<button type="button" class="btn btn-secondary btn-sm community-gacha-redraw">再抽一次</button>' +
      '<button type="button" class="btn btn-ghost btn-sm community-gacha-view">查看详情</button>' +
      '</div>' +
      '</div>' +
      '<p class="community-gacha-foot hidden" id="communityGachaFoot"></p>' +
      '</div>';
    document.body.appendChild(overlayEl);

    cardEl = overlayEl.querySelector('.community-gacha-card');
    frontImg = overlayEl.querySelector('.community-gacha-front-img');
    metaEl = overlayEl.querySelector('.community-gacha-meta');
    rarityEl = overlayEl.querySelector('.community-gacha-rarity');
    promptEl = overlayEl.querySelector('.community-gacha-prompt');
    collectBtn = overlayEl.querySelector('.community-gacha-collect');
    redrawBtn = overlayEl.querySelector('.community-gacha-redraw');
    statusEl = overlayEl.querySelector('#communityGachaStatus');

    overlayEl.querySelector('.community-gacha-close')?.addEventListener('click', close);
    overlayEl.querySelector('.community-gacha-backdrop')?.addEventListener('click', close);
    overlayEl.querySelector('.community-gacha-view')?.addEventListener('click', () => {
      const post = currentDraw?.post;
      if (!post) return;
      close();
      window.FeatureDraft?.openCommunityAppreciateById?.(post.id);
    });
    collectBtn?.addEventListener('click', () => void onCollect());
    redrawBtn?.addEventListener('click', () => void drawAgain());
  }

  async function resolvePostImage(post) {
    const cached = cachedPostImageUrl(post);
    if (cached) return cached;
    const ref = window.FeatureDraft?.communityPostDisplayImageRef?.(post)
      || window.FeatureDraft?.canonicalCommunityImageRef?.(post)
      || post.image;
    if (!ref) return '';
    if (window.SupabaseSync?.isDataUrl?.(ref) || /^https?:\/\//i.test(ref)) return ref;
    try {
      return await window.SupabaseSync?.resolveDisplayUrl?.(ref, {
        assetId: post.sourceCardId || post.id,
        authorId: post.authorId || undefined,
        cardId: post.sourceCardId || undefined,
        communityFeed: true,
        tryAllPaths: true,
        variant: 'full'
      }) || '';
    } catch (e) {
      return '';
    }
  }

  function refreshCollectButton(post) {
    if (!collectBtn) return;
    const collected = isPostCollected(post);
    collectBtn.classList.toggle('is-collected', collected);
    collectBtn.textContent = collected ? '已在仓库' : '收藏入仓库';
    collectBtn.disabled = collected;
  }

  function refreshFootAndRedraw() {
    const left = remainingDraws();
    const foot = $('communityGachaFoot');
    if (foot) {
      foot.textContent = left > 0
        ? `今日还可抽 ${left} 次（每日 ${GACHA_DAILY_LIMIT} 次）`
        : `今日次数已用完，明日 0 点刷新`;
      foot.classList.remove('hidden');
    }
    if (redrawBtn) {
      redrawBtn.disabled = animating || left <= 0;
      redrawBtn.textContent = left > 0 ? '再抽一次' : '今日已抽满';
    }
  }

  function resetCardVisual() {
    cardEl?.classList.remove('is-flipped', 'is-ssr', 'is-preloading', 'is-revealing');
    metaEl?.classList.add('hidden');
    statusEl?.classList.add('hidden');
    overlayEl?.querySelector('.community-gacha-front-loading')?.classList.add('hidden');
    collectBtn?.classList.remove('is-collected', 'is-bounce', 'is-loading');
    if (collectBtn) {
      collectBtn.disabled = false;
      collectBtn.textContent = '收藏入仓库';
    }
    if (frontImg) frontImg.src = '';
  }

  function close() {
    revealGen += 1;
    animating = false;
    overlayEl?.classList.add('hidden');
    document.body.classList.remove('community-gacha-open');
    resetCardVisual();
    refreshEntryButton();
  }

  function revealCancelled(gen) {
    return gen !== revealGen;
  }

  async function playReveal(draw) {
    ensureOverlay();
    const gen = ++revealGen;
    currentDraw = draw;
    animating = true;
    resetCardVisual();
    overlayEl.classList.remove('hidden');
    document.body.classList.add('community-gacha-open');
    cardEl?.classList.add('is-preloading');
    refreshFootAndRedraw();

    rarityEl.textContent = tierLabel(draw.tier);
    rarityEl.dataset.tier = draw.tier;
    promptEl.textContent = (draw.post.prompt || draw.post.title || '').slice(0, 160);
    refreshCollectButton(draw.post);

    if (draw.tier === 'ssr') cardEl?.classList.add('is-ssr');

    statusEl?.classList.remove('hidden');
    if (statusEl) statusEl.textContent = '正在揭示…';

    let imgUrl = cachedPostImageUrl(draw.post);
    if (!imgUrl) imgUrl = await resolvePostImage(draw.post);
    if (revealCancelled(gen)) return;
    if (!imgUrl) {
      toast('图片尚未加载，请稍后再试');
      close();
      return;
    }

    try {
      await preloadImage(imgUrl);
    } catch (e) {
      if (revealCancelled(gen)) return;
      toast('图片加载失败，请换一张再试');
      close();
      return;
    }

    if (revealCancelled(gen)) return;
    if (frontImg) frontImg.src = imgUrl;
    cardEl?.classList.remove('is-preloading');
    cardEl?.classList.add('is-revealing');
    if (statusEl) statusEl.textContent = draw.tier === 'ssr' ? 'SSR 降临！' : '翻开命运之卡…';

    const flipDelay = draw.tier === 'ssr' ? 1500 : 950;
    await sleep(draw.tier === 'ssr' ? 520 : 380);
    if (revealCancelled(gen)) return;
    cardEl?.classList.add('is-flipped');
    await sleep(flipDelay);
    if (revealCancelled(gen)) return;
    statusEl?.classList.add('hidden');
    metaEl?.classList.remove('hidden');
    cardEl?.classList.remove('is-revealing');
    animating = false;
    refreshFootAndRedraw();
    refreshEntryButton();
  }

  async function onCollect() {
    const post = currentDraw?.post;
    if (!post) return;
    if (!window.AuthGate?.requireAuth?.('collect')) {
      toast('登录后可收藏入仓库');
      return;
    }
    if (collectBtn?.classList.contains('is-collected') || isPostCollected(post)) {
      collectBtn?.classList.add('is-collected', 'is-bounce');
      toast('已在仓库中');
      setTimeout(() => collectBtn?.classList.remove('is-bounce'), 600);
      return;
    }
    const prevText = collectBtn?.textContent || '收藏入仓库';
    if (collectBtn) {
      collectBtn.disabled = true;
      collectBtn.textContent = '收藏中…';
      collectBtn.classList.add('is-loading');
    }
    const r = await window.addCardFromCommunity?.(post);
    collectBtn?.classList.remove('is-loading');
    if (r?.duplicate) {
      collectBtn?.classList.add('is-collected', 'is-bounce');
      if (collectBtn) {
        collectBtn.textContent = '已在仓库';
        collectBtn.disabled = true;
      }
      toast('已在仓库中');
      setTimeout(() => collectBtn?.classList.remove('is-bounce'), 600);
      return;
    }
    if (r?.ok) {
      collectBtn?.classList.add('is-collected', 'is-bounce');
      if (collectBtn) {
        collectBtn.textContent = '已收藏 ✓';
        collectBtn.disabled = true;
      }
      toast('已收藏入卡片仓库');
      overlayEl?.querySelector('.community-gacha-card-scene')?.classList.add('collect-sparkle');
      setTimeout(() => {
        collectBtn?.classList.remove('is-bounce');
        overlayEl?.querySelector('.community-gacha-card-scene')?.classList.remove('collect-sparkle');
      }, 700);
      return;
    }
    if (collectBtn) {
      collectBtn.disabled = false;
      collectBtn.textContent = prevText;
    }
    toast('收藏失败，请稍后再试');
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function performDraw(excludePostId) {
    const posts = getDrawablePosts(excludePostId);
    if (!posts.length) {
      const pool = getPoolPosts();
      toast(pool.length ? '暂无可抽的他人作品' : '社区作品还不够，稍后再来抽吧');
      return null;
    }
    if (!canDrawToday()) {
      toast(`今日已抽满 ${GACHA_DAILY_LIMIT} 次，明日再来`);
      refreshFootAndRedraw();
      refreshEntryButton();
      return null;
    }
    recordDraw();
    return drawFromPool(posts);
  }

  async function openGacha() {
    if (animating) return;
    if (!canDrawToday()) {
      toast(`今日已抽满 ${GACHA_DAILY_LIMIT} 次，明日 0 点刷新`);
      return;
    }
    const draw = await performDraw();
    if (!draw) return;
    await playReveal(draw);
  }

  async function drawAgain() {
    if (animating) return;
    const excludeId = currentDraw?.post?.id;
    const draw = await performDraw(excludeId);
    if (!draw) return;
    await playReveal(draw);
  }

  function refreshEntryButton() {
    const btn = $('communityGachaBtn');
    if (!btn) return;
    const left = remainingDraws();
    if (left >= GACHA_DAILY_LIMIT) {
      btn.textContent = '随心一抽';
      btn.classList.remove('community-gacha-done');
      return;
    }
    btn.textContent = left > 0 ? `随心一抽 · 剩 ${left} 次` : '今日已抽满';
    btn.classList.toggle('community-gacha-done', left <= 0);
  }

  function bindEntry() {
    if (bound) return;
    bound = true;
    $('communityGachaBtn')?.addEventListener('click', () => void openGacha());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlayEl && !overlayEl.classList.contains('hidden')) close();
    });
  }

  function init() {
    ensureOverlay();
    bindEntry();
    refreshEntryButton();
  }

  window.CommunityGacha = {
    init,
    open: openGacha,
    refreshEntryButton
  };
})();

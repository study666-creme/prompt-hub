/**
 * 生图仓库 Feed：桌面 CSS Grid、渲染、分页（与 features-draft 业务解耦）
 */
(function (global) {
  'use strict';

  const IMAGEGEN_FEED_PER_PAGE = 12;
  /** 生图页右侧「最近生成」列表（7 天内，与卡片库解耦） */
  const IMAGEGEN_RECENT_FEED_MAX = 200;
  /** 自动滚动/哨兵最多追加页数（12×4=48 张） */
  const IMAGEGEN_FEED_MAX_AUTO_PAGES = 4;
/** 卡片媒体区低于此高度视为布局未就绪，禁止自动翻页 */
const IMAGEGEN_FEED_MIN_CARD_PX = 72;

  /** @type {Record<string, any>} */
  let deps = {};
  /** @type {import('masonry-layout')|null} */
  let imageGenMasonry = null;
  let imageGenLayoutTimer = null;
  /** @type {{ sig: string, page: number, whCards: any[], commPosts: any[] }|null} */
  let imageGenFeedPagedStore = null;
  let imageGenFeedScrollLoading = false;
  let imageGenFeedScrollIntent = false;
  let imageGenFeedUserScrollingUntil = 0;
  let imageGenFeedDeferredRenderTimer = null;
  let imageGenFeedScrollGuardBound = false;

  function imageGenFeedCardsLookLaidOut(wrap) {
    if (!wrap) return false;
    const sample = wrap.querySelector(
      '.imagegen-feed-card:not([data-pending="1"]):not([data-failed="1"]) .imagegen-feed-media'
    );
    if (!sample) return true;
    return sample.getBoundingClientRect().height >= IMAGEGEN_FEED_MIN_CARD_PX;
  }

  function canAutoLoadMoreImageGenFeedPages(wrap, store) {
    if (!wrap || !store) return false;
    if ((store.page || 1) >= IMAGEGEN_FEED_MAX_AUTO_PAGES) return false;
    if (!imageGenFeedHasMorePages()) return false;
    if (!imageGenFeedCardsLookLaidOut(wrap)) return false;
    const scrollEl = resolveImageGenFeedScrollRoot(wrap) || wrap;
    if (!scrollEl) return false;
    if (scrollEl.scrollHeight <= scrollEl.clientHeight + 40) return false;
    return true;
  }

  function markImageGenFeedUserScrolling() {
    imageGenFeedUserScrollingUntil = Date.now() + 3500;
    imageGenFeedScrollIntent = true;
    const wrap = document.getElementById('imageGenFeed');
    if (wrap) delete wrap.__phIgPendingScrollState;
  }

  function shouldSkipImageGenFeedScrollRestore(wrap, state) {
    if (!state) return true;
    if (shouldDeferImageGenFeedRender()) return true;
    const scrollEl = resolveImageGenFeedScrollRoot(wrap) || wrap;
    const current = scrollEl?.scrollTop ?? 0;
    /* 用户已离开顶部：禁止用旧 snapshot（常为 0）拉回 */
    if (current > 24) {
      const captured = Number(state.anchor?.scrollTop);
      if (Number.isFinite(captured) && current > captured + 8) return true;
    }
    const captured = Number(state.anchor?.scrollTop);
    if (Number.isFinite(captured) && current > captured + 16) return true;
    return false;
  }

  function shouldDeferImageGenFeedRender() {
    return Date.now() < imageGenFeedUserScrollingUntil;
  }

  function bindImageGenFeedScrollGuard(wrap, scrollEl) {
    if (!wrap || !scrollEl || scrollEl.dataset.phIgScrollGuard === '1') return;
    scrollEl.dataset.phIgScrollGuard = '1';
    scrollEl.addEventListener('scroll', () => markImageGenFeedUserScrolling(), { passive: true });
    scrollEl.addEventListener('wheel', () => markImageGenFeedUserScrolling(), { passive: true });
    scrollEl.addEventListener('touchmove', () => markImageGenFeedUserScrolling(), { passive: true });
  }

  function captureImageGenFeedScrollAnchor(wrap, scrollEl) {
    if (!wrap || !scrollEl) return null;
    const top = scrollEl.scrollTop;
    if (top < 4) return { scrollTop: top, scrollEl };
    const rootRect = scrollEl.getBoundingClientRect();
    for (const card of wrap.querySelectorAll('.imagegen-feed-card[data-feed-id]')) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom <= rootRect.top + 8) continue;
      if (rect.top >= rootRect.bottom - 8) break;
      return {
        feedId: card.dataset.feedId || '',
        offset: rect.top - rootRect.top,
        scrollTop: top,
        scrollEl
      };
    }
    return { scrollTop: top, scrollEl };
  }

  function applyImageGenFeedScrollTop(scrollEl, top, opts) {
    if (!scrollEl) return;
    const want = Math.max(0, Number(top) || 0);
    if (opts?.force) {
      scrollEl.scrollTop = want;
      return;
    }
    const cur = scrollEl.scrollTop;
    if (cur > want + 8) return;
    if (cur > 24 && want < cur - 16) return;
    scrollEl.scrollTop = want;
  }

  function restoreImageGenFeedScrollAnchor(anchor) {
    if (!anchor?.scrollEl) return;
    const wrap = document.getElementById('imageGenFeed');
    if (wrap && shouldSkipImageGenFeedScrollRestore(wrap, { anchor })) return;
    const { scrollEl } = anchor;
    if (anchor.feedId) {
      const card = document.querySelector(`#imageGenFeed .imagegen-feed-card[data-feed-id="${CSS.escape(anchor.feedId)}"]`);
      if (card) {
        const rootRect = scrollEl.getBoundingClientRect();
        const rect = card.getBoundingClientRect();
        const want = anchor.scrollTop + (rect.top - rootRect.top) - anchor.offset;
        if (scrollEl.scrollTop > want + 8) return;
        applyImageGenFeedScrollTop(scrollEl, want);
        return;
      }
    }
    applyImageGenFeedScrollTop(scrollEl, anchor.scrollTop);
  }

  function collectImageGenFeedScrollTargets(wrap) {
    const targets = new Set();
    const primary = resolveImageGenFeedScrollRoot(wrap) || wrap;
    if (primary) targets.add(primary);
    if (wrap) targets.add(wrap);
    if (document.body.classList.contains('imagegen-mobile-view-feed')) {
      const main = document.querySelector('.app-main');
      if (main) targets.add(main);
      if (document.scrollingElement) targets.add(document.scrollingElement);
    }
    return [...targets];
  }

  function captureImageGenFeedScrollState(wrap) {
    const scrollEl = resolveImageGenFeedScrollRoot(wrap) || wrap;
    const anchor = captureImageGenFeedScrollAnchor(wrap, scrollEl);
    const tops = new Map();
    collectImageGenFeedScrollTargets(wrap).forEach((el) => {
      tops.set(el, el.scrollTop);
    });
    return { anchor, tops };
  }

  function restoreImageGenFeedScrollState(wrap, state) {
    if (!state || shouldSkipImageGenFeedScrollRestore(wrap, state)) return;
    if (state.anchor) restoreImageGenFeedScrollAnchor(state.anchor);
    state.tops?.forEach((top, el) => {
      if (!el?.isConnected) return;
      const cur = el.scrollTop;
      if (cur > 24 && top < cur - 16) return;
      el.scrollTop = top;
    });
  }

  function scheduleImageGenFeedScrollRestore(wrap, state) {
    if (shouldSkipImageGenFeedScrollRestore(wrap, state)) return;
    restoreImageGenFeedScrollState(wrap, state);
  }

  function imageGenFeedIsNearTop() {
    const wrap = document.getElementById('imageGenFeed');
    if (!wrap) return true;
    const targets = collectImageGenFeedScrollTargets(wrap);
    if (!targets.length) return true;
    return !targets.some((el) => (el?.scrollTop ?? 0) >= 64);
  }

  function warehousePrependedOneCard(prev, next) {
    if (!Array.isArray(prev) || !Array.isArray(next) || next.length !== prev.length + 1) return null;
    if (prev.length && String(next[0].id) === String(prev[0].id)) return null;
    for (let i = 0; i < prev.length; i += 1) {
      if (String(prev[i].id) !== String(next[i + 1].id)) return null;
    }
    return next[0];
  }

  function warehouseCardsListUnchanged(prev, next) {
    if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i += 1) {
      const a = prev[i];
      const b = next[i];
      if (!a || !b || String(a.id) !== String(b.id)) return false;
      if (String(a.image || '') !== String(b.image || '')) return false;
    }
    return true;
  }

  function warehouseRemovedOneCard(prev, next) {
    if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length + 1) return null;
    const nextIds = new Set(next.map((c) => String(c.id)));
    const removed = prev.filter((c) => !nextIds.has(String(c.id)));
    return removed.length === 1 ? removed[0].id : null;
  }

  function warehouseSingleCoverChange(prev, next) {
    if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return null;
    let changed = null;
    for (let i = 0; i < prev.length; i += 1) {
      if (String(prev[i].id) !== String(next[i].id)) return null;
      if (String(prev[i].image || '') === String(next[i].image || '')) continue;
      if (changed) return null;
      changed = next[i];
    }
    return changed;
  }

  function removeWarehouseFeedCardFromDom(wrap, cardId) {
    if (!wrap || cardId == null) return false;
    const el = wrap.querySelector(
      `.imagegen-feed-card[data-feed-id="wh_${CSS.escape(String(cardId))}"]`
    );
    if (!el) return false;
    el.remove();
    bindImageGenFeedImageRelayout();
    if (d().isMobileFeedViewport?.()) enforceMobileImageGenFeed();
    else scheduleImageGenFeedLayout();
    return true;
  }

  function patchWarehouseFeedCardCover(wrap, card) {
    if (!wrap || !card?.id || !card.image) return false;
    const el = wrap.querySelector(
      `.imagegen-feed-card[data-feed-id="wh_${CSS.escape(String(card.id))}"]`
    );
    if (!el) return false;
    const media = el.querySelector('.imagegen-feed-media');
    const img = media?.querySelector('img');
    if (!img) return false;
    const jobId = card.feedCoverJobId || (card.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : '');
    img.setAttribute('data-image-ref', card.image);
    if (jobId) img.setAttribute('data-job-id', jobId);
    else img.removeAttribute('data-job-id');
    delete img.dataset.feedLoadDone;
    delete img.dataset.igenRetry;
    img.classList.remove('img-load-failed');
    media?.classList.add('is-loading');
    media?.classList.remove('card-media--load-failed');
    el.classList.remove('imagegen-feed-card--no-media');
    void d().hydrateFeedImageOne?.(img);
    bindImageGenFeedImageRelayout();
    if (!d().isMobileFeedViewport?.()) scheduleImageGenFeedLayout();
    return true;
  }

  function finishWarehouseFeedIncrementalPatch(wrap, scrollState, scrollAnchor, scrollEl, scrollTop, preserveScroll) {
    if (scrollState) scheduleImageGenFeedScrollRestore(wrap, scrollState);
    else if (scrollAnchor) restoreImageGenFeedScrollAnchor(scrollAnchor);
    else if (scrollEl && preserveScroll) applyImageGenFeedScrollTop(scrollEl, scrollTop);
    syncImageGenFeedLoadMoreBtn();
    bindImageGenFeedPagedScroll();
  }

  function imageGenFeedRenderedCount(store) {
    if (!store) return IMAGEGEN_FEED_PER_PAGE;
    const total = d().getImageGenFeedTab?.() === 'recent'
      ? (store.whCards?.length || 0)
      : (store.commPosts?.length || 0);
    return Math.min(total, Math.max(1, store.page || 1) * IMAGEGEN_FEED_PER_PAGE);
  }

  function patchImageGenFeedPendingSection(wrap, pending, failed) {
    if (!wrap) return;
    const scrollState = captureImageGenFeedScrollState(wrap);
    wrap.querySelectorAll('.imagegen-feed-card[data-pending="1"], .imagegen-feed-card[data-failed="1"]').forEach((el) => el.remove());
    const html = pending.map((j) => buildFeedPendingCardHtml(j)).join('')
      + failed.map((j) => buildFeedFailedCardHtml(j)).join('');
    if (!html) {
      scheduleImageGenFeedScrollRestore(wrap, scrollState);
      return;
    }
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const newCards = [...temp.children];
    const anchor = wrap.querySelector('.grid-sizer') || wrap.firstChild;
    newCards.forEach((card) => {
      wrap.insertBefore(card, anchor);
    });
    bindImageGenFeedCardEvents(wrap, newCards);
    scheduleImageGenFeedScrollRestore(wrap, scrollState);
  }

  function d() {
    return deps;
  }

  function resolveImageGenFeedScrollRoot(wrap) {
    if (!wrap) return null;
    if (deps.getFeedScrollRoot) return deps.getFeedScrollRoot(wrap) || wrap;
    if (document.body.classList.contains('imagegen-mobile-view-feed')) {
      return document.querySelector('.app-main') || wrap;
    }
    return wrap;
  }

    function feedImgStorageAttr(image) {
      if (!image || typeof image !== 'string') return '';
      if (window.SupabaseSync?.isStorageRef?.(image)) {
        return ` data-storage-ref="${d().esc?.(image)}"`;
      }
      return '';
    }

    function resolveFeedCardDisplay(title, prompt) {
      const t = (title || '').trim();
      const p = (prompt || '').trim();
      let showTitle = '';
      if (t && !d().isGenericFeedTitle?.(t) && t !== p) {
        if (!(p && p.startsWith(t) && t.length >= 6)) showTitle = t;
      }
      const showPrompt = p || '';
      return { showTitle, showPrompt };
    }

    let imageGenFeedRelayoutTimer = null;
    function bindImageGenFeedImageRelayout() {
      const wrap = document.getElementById('imageGenFeed');
      if (!wrap) return;
      const relayout = () => {
        if (shouldDeferImageGenFeedRender()) return;
        clearTimeout(imageGenFeedRelayoutTimer);
        imageGenFeedRelayoutTimer = setTimeout(() => {
          if (shouldDeferImageGenFeedRender()) return;
          if (d().isMobileFeedViewport?.()) scheduleImageGenFeedLayout();
          else scrubImageGenFeedAbsoluteStyles(wrap);
        }, 120);
      };
      wrap.querySelectorAll('.imagegen-feed-media img, .imagegen-feed-thumb-btn img').forEach(img => {
        if (img.dataset.masonryRelayoutBound) return;
        img.dataset.masonryRelayoutBound = '1';
        img.addEventListener('load', relayout, { once: true });
        img.addEventListener('error', relayout, { once: true });
      });
    }
  
    function captureImageGenFeedCardPositions(wrap) {
      if (!wrap) return null;
      const map = new Map();
      wrap.querySelectorAll('.imagegen-feed-card').forEach((card) => {
        const rect = card.getBoundingClientRect();
        map.set(card, { left: rect.left, top: rect.top });
      });
      return map.size ? map : null;
    }

    function applyImageGenFeedCardFlip(wrap, before) {
      if (!wrap || !before?.size) return;
      wrap.querySelectorAll('.imagegen-feed-card').forEach((card) => {
        const prev = before.get(card);
        if (!prev) return;
        const rect = card.getBoundingClientRect();
        const dx = prev.left - rect.left;
        const dy = prev.top - rect.top;
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
        card.style.transition = 'none';
        card.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            card.style.transition = 'transform 0.42s var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1))';
            card.style.transform = '';
            const cleanup = () => {
              card.style.transition = '';
              card.removeEventListener('transitionend', cleanup);
            };
            card.addEventListener('transitionend', cleanup);
          });
        });
      });
    }

    function scheduleImageGenFeedLayout(opts) {
      const immediate = opts === true || opts?.immediate === true;
      if (!immediate && shouldDeferImageGenFeedRender()) {
        clearTimeout(imageGenLayoutTimer);
        imageGenLayoutTimer = setTimeout(
          () => scheduleImageGenFeedLayout({ immediate: opts?.immediate, force: true }),
          Math.max(160, imageGenFeedUserScrollingUntil - Date.now())
        );
        return;
      }
      clearTimeout(imageGenLayoutTimer);
      const run = () => {
        if (d().isMobileFeedViewport?.()) enforceMobileImageGenFeed();
        else repairImageGenFeedLayoutImmediate();
      };
      if (immediate) {
        run();
        return;
      }
      imageGenLayoutTimer = setTimeout(run, 120);
    }

    function bindImageGenFeedResizeRelayout() {
      if (window.__imageGenFeedResizeBound) return;
      const watch = document.querySelector('.imagegen-side') || document.getElementById('imageGenFeed');
      if (!watch || typeof ResizeObserver === 'undefined') return;
      window.__imageGenFeedResizeBound = true;
      let timer = null;
      let lastW = 0;
      const obs = new ResizeObserver((entries) => {
        if (!d().isMobileFeedViewport?.()) return;
        const w = entries[0]?.contentRect?.width ?? watch.clientWidth;
        if (w < 80) return;
        const delta = Math.abs(w - lastW);
        lastW = w;
        if (delta < 24) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (shouldDeferImageGenFeedRender()) return;
          scheduleImageGenFeedLayout({ immediate: true });
        }, 320);
      });
      obs.observe(watch);
    }
  
    function destroyImageGenFeedMasonry() {
      if (imageGenMasonry) {
        try { imageGenMasonry.destroy(); } catch (e) { /* ignore */ }
        imageGenMasonry = null;
      }
    }

    function scrubImageGenFeedAbsoluteStyles(wrap) {
      if (!wrap) return;
      destroyImageGenFeedMasonry();
      wrap.style.removeProperty('height');
      wrap.style.removeProperty('max-height');
      wrap.style.removeProperty('min-height');
      wrap.querySelectorAll('.grid-sizer').forEach((el) => el.remove());
      wrap.querySelectorAll('.imagegen-feed-card').forEach((card) => {
        const cs = getComputedStyle(card);
        const pos = card.style.position;
        const hasAbsPos = pos === 'absolute' || pos === 'fixed'
          || cs.position === 'absolute' || cs.position === 'fixed';
        const hasMasonryOffsets = card.style.top || card.style.left || card.style.width;
        if (hasAbsPos || hasMasonryOffsets || card.style.transform) {
          card.removeAttribute('style');
        }
      });
    }

    function ensureImageGenFeedScrollLayout(wrap) {
      if (!wrap || d().isMobileFeedViewport?.()) return;
      scrubImageGenFeedAbsoluteStyles(wrap);
      wrap.classList.remove('imagegen-feed--masonry', 'imagegen-feed--tiles', 'mobile-feed-grid');
      wrap.classList.add('imagegen-feed--desktop-grid');
      wrap.style.removeProperty('height');
      wrap.style.removeProperty('max-height');
      const side = wrap.closest('.imagegen-side');
      if (side && !side.classList.contains('imagegen-preview-open')) {
        wrap.style.flex = '1 1 0';
        wrap.style.minHeight = '0';
        wrap.style.overflowY = 'auto';
      }
    }

    let whServerRepairInflight = null;
    let whPrefetchInflight = null;

    function primeWarehouseFeedCardsFast(cards) {
      /* creations 无需仓库 cover 回填 */
    }

    function refreshWarehouseListFromCache(store) {
      const fresh = getRecentCreationsFeedList();
      if (!fresh?.length) return null;
      if (store) store.whCards = fresh;
      return fresh;
    }

    async function prefetchWarehouseFeedCardsBackground(cards, wrap) {
      const list = (cards || []).filter((c) => c?.id);
      if (!list.length) return;
      if (whPrefetchInflight) return whPrefetchInflight;
      whPrefetchInflight = (async () => {
        const isRecent = d().getImageGenFeedTab?.() === 'recent';
        if (!isRecent) {
          const prefetchItems = list.map((c) => ({ id: c.id, image: c.image })).filter((c) => c?.image);
          if (prefetchItems.length) {
            try {
              if (global.PromptHubMedia?.prefetchWarehouseCards) {
                await global.PromptHubMedia.prefetchWarehouseCards(
                  prefetchItems.slice(0, 12),
                  { capMs: 3200, maxCards: 12 }
                );
              } else if (global.SupabaseSync?.prefetchCardsImages) {
                await global.SupabaseSync.prefetchCardsImages(
                  prefetchItems.slice(0, 12),
                  3200,
                  { maxCards: 12 }
                );
              }
            } catch (e) {
              console.warn('[imageGenFeed] prefetch failed', e);
            }
          }
        }
        if (wrap) {
          window.MediaPipeline?.patchContainerFromCache?.(wrap, { visibleFirst: true, max: 12 });
          window.CardImageLoader?.boostImageGenRecentImages?.(wrap, 16);
          void boostImageGenFeedThumbs(wrap, list, 16);
        }
      })().finally(() => {
        whPrefetchInflight = null;
      });
      return whPrefetchInflight;
    }

    function maybeServerRepairWarehouseImages(wrap) {
      /* 最近生成与卡片库解耦，不再做仓库 server repair */
      return;
    }

    function bindImageGenFeedGridGuard(wrap) {
      if (!wrap || wrap.dataset.phIgGridGuard === '1') return;
      wrap.dataset.phIgGridGuard = '1';
      if (typeof MutationObserver === 'undefined') return;
      let guardTimer = null;
      const runGuard = () => {
        if (d().isMobileFeedViewport?.()) return;
        scrubImageGenFeedAbsoluteStyles(wrap);
      };
      const obs = new MutationObserver(() => {
        clearTimeout(guardTimer);
        guardTimer = setTimeout(runGuard, 16);
      });
      obs.observe(wrap, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    }

    function resetImageGenFeedCardLayout() {
      const wrap = document.getElementById('imageGenFeed');
      if (!wrap) return;
      scrubImageGenFeedAbsoluteStyles(wrap);
    }
  
    function layoutImageGenFeedMasonry() {
      if (d().isMobileFeedViewport?.()) {
        enforceMobileImageGenFeed();
        return;
      }
      const wrap = document.getElementById('imageGenFeed');
      if (!wrap) return;
      ensureImageGenFeedScrollLayout(wrap);
      d().setFeedLayoutPending?.(wrap, false);
      wrap.dataset.masonryLaidOut = '1';
      bindImageGenFeedGridGuard(wrap);
      bindImageGenFeedImageRelayout();
    }

    function diagnoseImageGenFeedLayout() {
      const wrap = document.getElementById('imageGenFeed');
      if (!wrap) return { error: 'imageGenFeed missing' };
      const cards = [...wrap.querySelectorAll('.imagegen-feed-card')];
      const sample = cards.slice(0, 8).map((card, i) => {
        const cs = getComputedStyle(card);
        const rect = card.getBoundingClientRect();
        return {
          i,
          feedId: card.dataset.feedId || '',
          position: cs.position,
          top: card.style.top || null,
          left: card.style.left || null,
          height: Math.round(rect.height),
          gapBelow: i < cards.length - 1
            ? Math.round(cards[i + 1].getBoundingClientRect().top - rect.bottom)
            : null
        };
      });
      return {
        build: global.__APP_BUILD__,
        packRev: global.__PH_FEED_PACK_REV__,
        classes: wrap.className,
        display: getComputedStyle(wrap).display,
        gap: getComputedStyle(wrap).gap,
        cardCount: cards.length,
        absoluteCards: cards.filter((c) => getComputedStyle(c).position === 'absolute').length,
        masonryInstance: !!imageGenMasonry,
        sample
      };
    }

    function repairImageGenFeedLayoutImmediate() {
      layoutImageGenFeedMasonry();
    }

    async function boostImageGenFeedThumbs(wrap, cards, cap) {
      if (!wrap || !cards?.length) return;
      const limit = Math.min(cap || 16, cards.length);
      for (let i = 0; i < limit; i += 1) {
        const slim = cards[i];
        const creation = d().findCreationById?.(slim.id)
          || (d().getCreations?.() || []).find((c) => c.id === slim.id);
        const isRecent = !!creation;
        const feedId = isRecent ? `cr_${slim.id}` : `wh_${slim.id}`;
        const feedEl = wrap.querySelector(
          `.imagegen-feed-card[data-feed-id="${CSS.escape(feedId)}"]`
        );
        const img = feedEl?.querySelector('.imagegen-feed-media img');
        if (!img || img.dataset.feedLoadDone === '1') continue;

        if (isRecent && creation?.jobId && global.PromptHubApi?.getGenerationImageUrl) {
          try {
            const jobId = String(creation.jobId).replace(/#\d+$/, '');
            const r = await global.PromptHubApi.getGenerationImageUrl(jobId);
            if (r?.ok && r.data?.url && window.CardImageLoader?.applyUrlToImg?.(img, r.data.url)) {
              continue;
            }
          } catch (e) { /* ignore */ }
        }

        if (isRecent && creation) {
          const altRefs = global.FeatureDraft?.creationFeedImageCandidates?.(creation) || [];
          let altFixed = false;
          for (const altRef of altRefs) {
            if (!altRef || altRef === img.getAttribute('data-image-ref')) continue;
            img.setAttribute('data-image-ref', altRef);
            global.SupabaseSync?.clearPathMissingForCard?.(creation.id, altRef);
            if (global.MediaPipeline?.resolveListUrl) {
              try {
                const jobId = creation.jobId ? String(creation.jobId).replace(/#\d+$/, '') : '';
                const url = await global.MediaPipeline.resolveListUrl(altRef, {
                  assetId: creation.id,
                  cardId: creation.id,
                  jobId: jobId || undefined,
                  tryAllPaths: true
                });
                if (url && window.CardImageLoader?.applyUrlToImg?.(img, url)) {
                  altFixed = true;
                  break;
                }
              } catch (e) { /* ignore */ }
            }
          }
          if (altFixed) continue;
        }

        if (!isRecent) {
          const full = (global.__promptHubCards || []).find((x) => x.id === slim.id) || slim;
          const meta = global.PromptHubCardGallery?.getWarehouseListThumbMeta?.(full);
          if (!meta?.hasImage) continue;
          if (meta.cachedUrl && window.CardImageLoader?.applyUrlToImg?.(img, meta.cachedUrl)) {
            continue;
          }
          const hit = window.SupabaseSync?.getListDisplayImageSrc?.(meta.ref || full.image, full.id, {
            jobId: meta.jobId,
            allowFullFallback: false
          });
          if (hit && window.CardImageLoader?.applyUrlToImg?.(img, hit)) {
            continue;
          }
          if (feedEl) collapseWarehouseFeedCardNoThumb(feedEl);
          continue;
        }

        const ref = creation.image || img.getAttribute('data-image-ref') || '';
        const jobId = creation.jobId ? String(creation.jobId).replace(/#\d+$/, '') : '';
        if (global.MediaPipeline?.resolveListUrl && ref) {
          try {
            const url = await global.MediaPipeline.resolveListUrl(ref, {
              assetId: creation.id,
              cardId: creation.id,
              jobId: jobId || undefined,
              tryAllPaths: true
            });
            if (url && window.CardImageLoader?.applyUrlToImg?.(img, url)) continue;
          } catch (e) { /* ignore */ }
        }
        window.CardImageLoader?.loadImg?.(img);
      }
    }

    function collapseWarehouseFeedCardNoThumb(feedEl) {
      if (!feedEl?.dataset?.feedId?.startsWith?.('wh_')) return;
      feedEl.querySelector('.imagegen-feed-media')?.remove();
      feedEl.classList.add('imagegen-feed-card--no-media');
      bindImageGenFeedImageRelayout();
      if (!d().isMobileFeedViewport?.()) scheduleImageGenFeedLayout();
    }

    function primeImageGenFeedImages(wrap, feedItems) {
      if (!wrap) return;
      const patchMax = IMAGEGEN_FEED_PER_PAGE;
      const boostMax = IMAGEGEN_FEED_PER_PAGE;
      const isRecentTab = d().getImageGenFeedTab?.() === 'recent';
      if (!isRecentTab) {
        const fullCards = (feedItems || []).map((slim) => (
          (global.__promptHubCards || []).find((x) => x.id === slim.id) || slim
        ));
        if (fullCards.length && global.MediaPipeline?.prefetchList) {
          void global.MediaPipeline.prefetchList(fullCards, 4200, { maxCards: fullCards.length });
        }
      }
      window.MediaPipeline?.patchContainerFromCache?.(wrap, { visibleFirst: true, max: patchMax });
      window.CardImageLoader?.boostImageGenWarehouseImages?.(wrap, boostMax);
      window.CardImageLoader?.boostImageGenRecentImages?.(wrap, boostMax);
      if (wrap.dataset.feedObserverPrimed !== '1') {
        wrap.dataset.feedObserverPrimed = '1';
        window.CardImageLoader?.observeContainer?.(wrap);
      }
      if (isRecentTab && feedItems?.length) {
        void boostImageGenFeedThumbs(wrap, feedItems, boostMax);
      }
    }

    function buildFeedPendingCardHtml(job) {
      const badges = [job.modelLabel || '生图中', (job.resolution || '1k').toUpperCase()];
      const batchTag = d().batchIndexLabel?.(job.batchIndex, job.batchTotal);
      if (batchTag) badges.unshift(batchTag);
      const badgeHtml = badges.map(b => `<span class="imagegen-feed-badge">${d().esc?.(b)}</span>`).join('');
      const slow = d().isSlowGenProviderModel?.(job.model);
      const recovering = job.recovering === true && !(slow && job.pendingNote);
      const pendingLabel = recovering ? '恢复中' : '生成中';
      const meta = job.pendingNote
        ? String(job.pendingNote).slice(0, 56)
        : recovering
          ? (job.recoverNote || '上游可能已出图，后台同步中…').slice(0, 56)
          : slow
            ? '约 1–12 分钟 · 已提交'
            : '预计 1–3 分钟 · 可继续提交';
      const dismissBtn = '<button type="button" class="btn btn-ghost btn-sm imagegen-feed-del" data-pending-dismiss title="关闭生成占位（不删已入库的图）">×</button>';
      return `<article class="imagegen-feed-card imagegen-feed-card-tile imagegen-feed-card--pending${recovering ? ' imagegen-feed-card--recovering' : ''}" data-feed-id="${d().esc?.(job.id)}" data-pending="1"${job.jobId ? ` data-job-id="${d().esc?.(job.jobId)}"` : ''}>
        <div class="imagegen-feed-media imagegen-gen-pending" aria-busy="true" aria-label="${d().esc?.(pendingLabel)}">
          <span class="imagegen-gen-pending-label">${d().esc?.(pendingLabel)}</span>
        </div>
        <div class="imagegen-feed-content">
          <p class="imagegen-feed-prompt">${d().esc?.((job.prompt || '').slice(0, 120))}</p>
          <div class="imagegen-feed-tags">${badgeHtml}</div>
          <div class="imagegen-feed-foot imagegen-feed-foot--pending">
            <span class="imagegen-feed-meta">${d().esc?.(meta)}</span>
            ${dismissBtn}
          </div>
        </div>
      </article>`;
    }

    function buildFeedFailedCardHtml(job) {
      const batchTag = d().batchIndexLabel?.(job.batchIndex, job.batchTotal);
      const badges = [];
      if (batchTag) badges.push(batchTag);
      badges.push(d().failedJobModelLabel?.(job));
      badges.push('失败');
      const badgeHtml = badges.map(b => `<span class="imagegen-feed-badge imagegen-feed-badge--fail">${d().esc?.(b)}</span>`).join('');
      const err = d().friendlyGenErrorMessage?.(job.errorMessage || '生图失败').slice(0, 120);
      const failLabel = batchTag ? `${batchTag} · 失败` : '生成失败';
      return `<article class="imagegen-feed-card imagegen-feed-card-tile imagegen-feed-card--failed" data-feed-id="${d().esc?.(job.id)}" data-failed="1" data-feed-prompt="${d().esc?.(job.prompt || '')}"${job.fromInspirationDraw ? ' data-from-inspire="1"' : ''}${job.batchIndex ? ` data-batch-index="${job.batchIndex}"` : ''}${job.batchTotal ? ` data-batch-total="${job.batchTotal}"` : ''}>
        <div class="imagegen-feed-media imagegen-gen-failed">
          <span class="imagegen-gen-failed-label">${d().esc?.(failLabel)}</span>
        </div>
        <div class="imagegen-feed-content">
          <p class="imagegen-feed-prompt">${d().esc?.((job.prompt || '').slice(0, 120))}</p>
          <p class="imagegen-gen-failed-error" title="${d().esc?.(job.errorMessage || '')}">${d().esc?.(err)}</p>
          <div class="imagegen-feed-tags">${badgeHtml}</div>
          <div class="imagegen-feed-foot imagegen-feed-foot--failed">
            <button type="button" class="btn btn-primary btn-sm" data-failed-retry>重试</button>
            <button type="button" class="btn btn-ghost btn-sm" data-failed-copy>复制提示词</button>
            <button type="button" class="btn btn-ghost btn-sm imagegen-feed-del" data-failed-dismiss title="关闭">×</button>
          </div>
        </div>
      </article>`;
    }

    function enforceMobileImageGenFeed() {
      if (!d().isMobileFeedViewport?.()) return;
      destroyImageGenFeedMasonry();
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
        showLike = false, liked = false, likeCount = 0, showSave = false, showDel = false,
        sourceCardId = '', thumbCachedUrl = ''
      } = opts;
      const { showTitle, showPrompt } = resolveFeedCardDisplay(title, prompt);
      const storageAttr = feedImgStorageAttr(image);
      const jobAttr = jobId ? ` data-job-id="${d().esc?.(jobId)}"` : '';
      const cardIdAttr = sourceCardId ? ` data-source-card-id="${d().esc?.(sourceCardId)}"` : '';
      const listJobId = jobId ? String(jobId).replace(/#\d+$/, '') : '';
      const isRecentFeed = String(id || '').startsWith('cr_');
      let resolvedThumb = thumbCachedUrl;
      const listUrl = resolvedThumb
        || ((sourceCardId && d().isDisplayableImage?.(image) && window.SupabaseSync?.getListDisplayImageSrc)
        ? window.SupabaseSync.getListDisplayImageSrc(image, sourceCardId, listJobId
          ? { jobId: listJobId, allowFullFallback: isRecentFeed }
          : { allowFullFallback: isRecentFeed })
          : '');
      if (!listUrl && isRecentFeed && sourceCardId && window.SupabaseSync?.getCachedDisplayUrl) {
        const fullCached = window.SupabaseSync.getCachedDisplayUrl(image, {
          assetId: sourceCardId,
          jobId: listJobId || undefined,
          variant: 'full'
        });
        if (fullCached && !fullCached.startsWith('storage://')) {
          resolvedThumb = fullCached;
        }
      }
      const resolvedListUrl = resolvedThumb || listUrl;
      const hasDisplayableRef = d().isDisplayableImage?.(image);
      const imgSrc = resolvedListUrl
        || (hasDisplayableRef ? d().IMG_LOADING_PLACEHOLDER : '');
      const imgPending = hasDisplayableRef && (!resolvedListUrl || imgSrc.includes('data:image/svg'));
      const loadingCls = imgPending ? ' is-loading' : '';
      const shineAt = imgPending ? ` data-shine-at="${Date.now()}"` : '';
      const imgBlock = hasDisplayableRef
        ? `<div class="imagegen-feed-media${loadingCls}"${shineAt}><button type="button" class="imagegen-feed-thumb-btn" title="放大预览"><img class="card-img" src="${d().esc?.(imgSrc || d().IMG_LOADING_PLACEHOLDER)}" data-image-ref="${d().esc?.(image)}"${storageAttr}${jobAttr}${cardIdAttr} alt="" decoding="async" loading="lazy" onload="if(typeof finishCardMediaShine==='function')finishCardMediaShine(this.closest('.imagegen-feed-media'));else this.closest('.imagegen-feed-media')?.classList.remove('is-loading')"></button><button type="button" class="imagegen-feed-media-dl desktop-only" data-feed-download title="下载图片" aria-label="下载图片"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12m0 0l4-4m-4 4l-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg><span>下载</span></button></div>`
        : '';
      const badgeHtml = badges.map(b => `<span class="imagegen-feed-badge">${d().esc?.(b)}</span>`).join('');
      const metaRowHtml = (metaLine || '').trim()
        ? `<p class="imagegen-feed-meta-row">${d().esc?.(metaLine.trim())}</p>`
        : (badgeHtml ? `<div class="imagegen-feed-tags">${badgeHtml}</div>` : '');
      const metaTrim = (meta || '').trim();
      const metaRedundant = !metaTrim || badges.some(b => b === metaTrim) || metaTrim === showTitle;
      const metaHtml = metaTrim && !metaRedundant
        ? `<span class="imagegen-feed-meta">${d().esc?.(metaTrim)}</span>`
        : '';
      const likeBtn = showLike
        ? `<button type="button" class="imagegen-feed-like ${liked ? 'liked' : ''}" data-like-id="${d().esc?.(id)}" title="点赞">♥ ${likeCount}</button>`
        : '';
      const saveBtn = showSave
        ? '<button type="button" class="btn btn-ghost btn-sm imagegen-feed-save-btn" data-save-feed="1">存入库</button>'
        : '';
      const delBtn = showDel
        ? '<button type="button" class="imagegen-feed-del" data-delete-feed="1" title="删除" aria-label="删除">×</button>'
        : '';
      const titleHtml = showTitle
        ? `<p class="imagegen-feed-title">${d().esc?.(showTitle)}</p>`
        : '';
      const promptHtml = showPrompt
        ? `<p class="imagegen-feed-prompt">${d().esc?.(showPrompt)}</p>`
        : '<p class="imagegen-feed-prompt imagegen-feed-prompt--empty">暂无提示词</p>';
      const noMedia = !imgBlock ? ' imagegen-feed-card--no-media' : '';
      const quickActions = `<div class="imagegen-feed-quick-actions" aria-label="生图快捷操作">
            <button type="button" class="imagegen-feed-quick-btn" data-feed-fill-prompt>填提示词</button>
            ${imgBlock ? '<button type="button" class="imagegen-feed-quick-btn" data-feed-fill-ref>填参考图</button>' : ''}
            <button type="button" class="imagegen-feed-quick-btn imagegen-feed-quick-btn--primary" data-feed-regenerate>再次生成</button>
          </div>`;
      const mobileActs = `<div class="imagegen-feed-mobile-actions mobile-only">
            <button type="button" class="imagegen-feed-mobile-btn" data-feed-copy>复制</button>
            <button type="button" class="imagegen-feed-mobile-btn" data-feed-fill-prompt>填入生图</button>
            ${imgBlock ? '<button type="button" class="imagegen-feed-mobile-btn" data-feed-fill-ref>填参考图</button>' : ''}
            <button type="button" class="imagegen-feed-mobile-btn" data-feed-regenerate>再次生成</button>
            ${imgBlock ? '<button type="button" class="imagegen-feed-mobile-btn" data-feed-download>下载</button>' : ''}
          </div>`;
      const fillHint = '';
      return `<article class="imagegen-feed-card imagegen-feed-card-tile${noMedia}${active ? ' active' : ''}" data-feed-id="${d().esc?.(id)}" data-feed-prompt="${d().esc?.(prompt || '')}" tabindex="0">
        ${imgBlock}
        <div class="imagegen-feed-content">
          ${quickActions}
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

    function getRecentCreationsFeedList() {
      try {
        const full = typeof d().getRecentCreationsForFeed === 'function'
          ? d().getRecentCreationsForFeed()
          : [];
        window.__imageGenRecentFeedTotal = full.length;
        return full.slice(0, IMAGEGEN_RECENT_FEED_MAX);
      } catch (e) {
        console.error('[imageGenFeed] getRecentCreationsFeedList failed', e);
        return [];
      }
    }

    function getImageGenWarehouseFeedList() {
      return getRecentCreationsFeedList();
    }

    function buildRecentLibraryCtaHtml() {
      return `<div class="imagegen-feed-library-cta" role="note">
        <p class="imagegen-feed-library-cta-text">最近生成有条数上限 · 点卡片下方 × 可删除 · 喜欢请「存入库」</p>
        <a href="/prompts" class="btn btn-secondary btn-sm imagegen-feed-library-link" data-open-warehouse="1">打开卡片库</a>
      </div>`;
    }

    function buildImageGenWarehouseLibraryCtaHtml() {
      return buildRecentLibraryCtaHtml();
    }
  
    function getImageGenCommunityFeedList() {
      return d().filterAndSortPosts?.(d().getCommunityFeedForDisplay?.());
    }
  
    function imageGenFeedListSignature() {
      if (d().getImageGenFeedTab?.() === 'recent') {
        const recentCount = Number(window.__imageGenRecentFeedTotal) || getRecentCreationsFeedList().length;
        const pendingSig = (d().getImageGenPendingJobs?.() ?? [])
          .map((j) => `${j.id}:${j.recovering ? 1 : 0}:${j.jobId || ''}`)
          .join(',');
        const failedSig = (d().getImageGenFailedJobs?.() ?? [])
          .map((j) => j.id)
          .join(',');
        const head = getRecentCreationsFeedList().slice(0, 6).map((c) => c.id).join(',');
        return `rc:recent:p${pendingSig}:f${failedSig}:n${recentCount}:h${head}`;
      }
      const posts = getImageGenCommunityFeedList();
      const head = posts.slice(0, 12).map((p) => String(p.id)).join(',');
      const tailId = posts.length > 12 ? String(posts[posts.length - 1]?.id || '') : '';
      const randomEpoch = d().getCommunitySort?.() === 'random' ? (d().getCommunityRandomEpoch?.() || 0) : 0;
      return `cm:${d().getCommunityScope?.()}:${d().getCommunitySort?.()}:r${randomEpoch}:${posts.length}:${head}:${tailId}`;
    }
  
    function creationToFeedHtml(c) {
      const titleTrim = (c.title || '').trim();
      const model = (c.modelLabel || d().imageGenModelLabel?.(c.model) || c.model || '').trim();
      const galleryN = Array.isArray(c.cardImages) ? c.cardImages.length
        : (Array.isArray(c.mjGridUrls) ? c.mjGridUrls.length : 0);
      const mjBadge = c.isMidjourney && galleryN > 1 ? `MJ·${galleryN}` : '';
      const linked = d().isCreationLinkedToWarehouse?.(c) || !!c.savedToWarehouse;
      const expiry = typeof d().formatExpiryLabel === 'function' ? d().formatExpiryLabel(c) : '';
      const metaLine = [model, mjBadge, expiry].filter(Boolean).join(' · ');
      const image = d().pickCreationFeedImage?.(c)
        || c.image
        || (Array.isArray(c.cardImages) ? c.cardImages[0] : '')
        || c.mjCompositeUrl
        || '';
      const jobId = c.jobId ? String(c.jobId).replace(/#\d+$/, '') : '';
      return buildFeedCardHtml({
        id: 'cr_' + c.id,
        sourceCardId: c.id,
        jobId,
        prompt: c.prompt,
        image,
        title: titleTrim,
        metaLine,
        meta: '',
        showDel: true,
        showSave: !linked
      });
    }

    function warehouseCardToFeedHtml(c) {
      return creationToFeedHtml(c);
    }
  
    function communityPostToFeedHtml(p) {
      const postTitle = (p.title || '').trim();
      const useTitle = postTitle && !d().isGenericPostTitle?.(postTitle) ? postTitle : '';
      const author = (p.authorName || '').trim() || '用户';
      const model = (p.modelLabel || d().imageGenModelLabel?.(p.model)).trim();
      return buildFeedCardHtml({
        id: p.id,
        prompt: p.prompt,
        image: p.image,
        title: useTitle,
        metaLine: `${author} · ${model}`,
        meta: `♥ ${p.likes || 0} · ${d().formatTime?.(p.createdAt)}`,
        showLike: true,
        liked: d().getLikedIds?.()?.has(p.id),
        likeCount: p.likes || 0
      });
    }
  
    function getImageGenFeedNavItems() {
      const wrap = document.getElementById('imageGenFeed');
      if (!wrap) return [];
      return [...wrap.querySelectorAll('.imagegen-feed-card[data-feed-id]')]
        .filter((card) => !card.dataset.pending && !card.dataset.failed)
        .map((card) => {
          const feedId = card.dataset.feedId;
          const recent = feedId.startsWith('cr_');
          const warehouse = feedId.startsWith('wh_');
          return {
            key: feedId,
            kind: recent ? 'recent' : (warehouse ? 'warehouse' : 'community'),
            id: recent ? feedId.slice(3) : (warehouse ? feedId.slice(3) : feedId)
          };
        });
    }

    function imageGenFeedHasMorePages() {
      const store = imageGenFeedPagedStore;
      if (!store) return false;
      const total = d().getImageGenFeedTab?.() === 'recent' ? store.whCards.length : store.commPosts.length;
      return store.page * IMAGEGEN_FEED_PER_PAGE < total;
    }

    let imageGenFeedScrollEl = null;
    let imageGenFeedScrollHandler = null;
    let imageGenFeedPageIo = null;

    function ensureImageGenFeedSentinel(wrap) {
      if (!wrap) return null;
      let sentinel = wrap.querySelector(':scope > .feed-page-sentinel');
      if (!sentinel) {
        sentinel = document.createElement('div');
        sentinel.className = 'feed-page-sentinel';
        sentinel.setAttribute('aria-hidden', 'true');
        wrap.appendChild(sentinel);
      }
      return sentinel;
    }

    function loadNextImageGenFeedPage() {
      if (imageGenFeedScrollLoading || !imageGenFeedHasMorePages()) return;
      const wrap = document.getElementById('imageGenFeed');
      const store = imageGenFeedPagedStore;
      if (!canAutoLoadMoreImageGenFeedPages(wrap, store)) return;
      const scrollEl = imageGenFeedScrollEl || resolveImageGenFeedScrollRoot(wrap) || wrap;
      if (!store) return;
      if ((scrollEl?.scrollTop ?? 0) < 48 && !imageGenFeedScrollIntent) return;
      imageGenFeedScrollLoading = true;
      const anchorTop = scrollEl?.scrollTop ?? 0;
      store.page += 1;
      void renderImageGenFeed({ preserveScroll: true, feedAppend: true, scrollTop: anchorTop }).finally(() => {
        imageGenFeedScrollLoading = false;
        syncImageGenFeedLoadMoreBtn();
        reconnectImageGenFeedPageObserver();
      });
    }

    function reconnectImageGenFeedPageObserver() {
      if (imageGenFeedPageIo) {
        imageGenFeedPageIo.disconnect();
        imageGenFeedPageIo = null;
      }
      if (!d().isMobileFeedViewport?.() || !('IntersectionObserver' in window)) return;
      const wrap = document.getElementById('imageGenFeed');
      const store = imageGenFeedPagedStore;
      if (!wrap || !store || !imageGenFeedHasMorePages()) return;
      const scrollRoot = resolveImageGenFeedScrollRoot(wrap) || wrap;
      const sentinel = ensureImageGenFeedSentinel(wrap);
      if (!sentinel) return;
      imageGenFeedPageIo = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        loadNextImageGenFeedPage();
      }, {
        root: scrollRoot === document.documentElement ? null : scrollRoot,
        rootMargin: '320px 0px',
        threshold: 0.01
      });
      imageGenFeedPageIo.observe(sentinel);
    }

    function fillImageGenFeedUntilScrollable(wrap, store) {
      if (!d().isMobileFeedViewport?.() || !wrap || !store) return;
      const scrollEl = resolveImageGenFeedScrollRoot(wrap) || wrap;
      if (!scrollEl || imageGenFeedScrollLoading) return;
      if (!imageGenFeedHasMorePages()) return;
      if (scrollEl.scrollHeight > scrollEl.clientHeight + 120) return;
      loadNextImageGenFeedPage();
    }
  
    function syncImageGenFeedLoadMoreBtn() {
      d().updateImageGenFeedHint?.();
      document.getElementById('imageGenFeed')?.querySelector('.imagegen-feed-load-more')?.remove();
    }
  
    function bindImageGenFeedPagedScroll() {
      const wrap = document.getElementById('imageGenFeed');
      if (!wrap) return;
      const scrollEl = resolveImageGenFeedScrollRoot(wrap) || wrap;
      const scrollKey = scrollEl.id || scrollEl.className?.slice(0, 48) || 'root';
      if (wrap.dataset.phIgScrollRoot !== scrollKey) {
        if (imageGenFeedScrollEl && imageGenFeedScrollHandler) {
          imageGenFeedScrollEl.removeEventListener('scroll', imageGenFeedScrollHandler);
        }
        wrap.dataset.pagedScrollBound = '';
        wrap.dataset.phIgScrollRoot = scrollKey;
      }
      imageGenFeedScrollEl = scrollEl;
      if (!imageGenFeedScrollHandler) {
        imageGenFeedScrollHandler = () => {
          if (imageGenFeedScrollLoading || !imageGenFeedHasMorePages()) return;
          const el = imageGenFeedScrollEl;
          const store = imageGenFeedPagedStore;
          const feedWrap = document.getElementById('imageGenFeed');
          if (!el || !store || !feedWrap || !canAutoLoadMoreImageGenFeedPages(feedWrap, store)) return;
          if (el.scrollTop < 80) return;
          if (el.scrollTop + el.clientHeight < el.scrollHeight - 180) return;
          loadNextImageGenFeedPage();
        };
      }
      if (wrap.dataset.pagedScrollBound !== '1') {
        wrap.dataset.pagedScrollBound = '1';
        scrollEl.addEventListener('scroll', imageGenFeedScrollHandler, { passive: true });
      }
      reconnectImageGenFeedPageObserver();
    }
  
    async function renderImageGenFeed(opts = {}) {
      const feedAppend = !!opts.feedAppend;
      const wrap = document.getElementById('imageGenFeed');
      if (!wrap) return;
      const tabSwitch = opts.scrollToTop === true || opts.force === true;
      if (!feedAppend && !tabSwitch && shouldDeferImageGenFeedRender()) {
        clearTimeout(imageGenFeedDeferredRenderTimer);
        imageGenFeedDeferredRenderTimer = setTimeout(() => {
          imageGenFeedDeferredRenderTimer = null;
          void renderImageGenFeed({ ...opts });
        }, Math.max(160, imageGenFeedUserScrollingUntil - Date.now()));
        return;
      }
      const scrollEl = resolveImageGenFeedScrollRoot(wrap) || wrap;
      bindImageGenFeedScrollGuard(wrap, scrollEl);
      const preserveScroll = opts.scrollToTop === true
        ? false
        : (opts.preserveScroll !== false);
      const scrollState = (!feedAppend && preserveScroll) ? captureImageGenFeedScrollState(wrap) : null;
      const scrollAnchor = feedAppend ? null : scrollState?.anchor ?? captureImageGenFeedScrollAnchor(wrap, scrollEl);
      const scrollTopBefore = scrollEl?.scrollTop ?? 0;
      const scrollTop = feedAppend
        ? (opts.scrollTop ?? scrollTopBefore)
        : (preserveScroll ? scrollTopBefore : 0);
      d().syncImageGenWarehouseFiltersUI?.();
      d().syncImageGenCommunityFiltersUI?.();

      if (!feedAppend) {
        d().prunePendingJobsWithCreations?.();
      }
      const sig = imageGenFeedListSignature();
      const prevStore = imageGenFeedPagedStore;
      if (!feedAppend && prevStore?.sig === sig && !opts.force) {
        repairImageGenFeedLayoutImmediate();
        return;
      }
      if (!feedAppend) {
        if (opts.scrollToTop === true) imageGenFeedScrollIntent = false;
        const whCards = d().getImageGenFeedTab?.() === 'recent' ? getRecentCreationsFeedList() : [];
        const commPosts = d().getImageGenFeedTab?.() === 'community' ? getImageGenCommunityFeedList() : [];
        const pending = (d().getImageGenPendingJobs?.() ?? []).slice(0, d().IMAGEGEN_FEED_PENDING_CAP ?? 6);
        const failed = (d().getImageGenFailedJobs?.() ?? []).slice(0, d().IMAGEGEN_FEED_FAILED_CAP ?? 4);
        if (
          prevStore
          && prevStore.sig !== sig
          && !tabSwitch
          && String(prevStore.sig).startsWith('rc:')
          && d().getImageGenFeedTab?.() === 'recent'
          && warehouseCardsListUnchanged(prevStore.whCards, whCards)
        ) {
          imageGenFeedPagedStore = { ...prevStore, sig, whCards, commPosts };
          patchImageGenFeedPendingSection(wrap, pending, failed);
          if (d().isMobileFeedViewport?.()) enforceMobileImageGenFeed();
          else repairImageGenFeedLayoutImmediate();
          if (scrollState) scheduleImageGenFeedScrollRestore(wrap, scrollState);
          else if (scrollAnchor) restoreImageGenFeedScrollAnchor(scrollAnchor);
          else if (scrollEl && preserveScroll) applyImageGenFeedScrollTop(scrollEl, scrollTop);
          syncImageGenFeedLoadMoreBtn();
          bindImageGenFeedPagedScroll();
          return;
        }
        const removedCardId = warehouseRemovedOneCard(prevStore?.whCards, whCards);
        if (
          prevStore
          && removedCardId
          && !tabSwitch
          && !opts.force
          && String(prevStore.sig).startsWith('rc:')
          && d().getImageGenFeedTab?.() === 'recent'
        ) {
          imageGenFeedPagedStore = { ...prevStore, sig, whCards, commPosts };
          patchImageGenFeedPendingSection(wrap, pending, failed);
          removeWarehouseFeedCardFromDom(wrap, removedCardId);
          finishWarehouseFeedIncrementalPatch(wrap, scrollState, scrollAnchor, scrollEl, scrollTop, preserveScroll);
          return;
        }
        const coverPatchCard = warehouseSingleCoverChange(prevStore?.whCards, whCards);
        if (
          prevStore
          && coverPatchCard
          && !tabSwitch
          && !opts.force
          && String(prevStore.sig).startsWith('rc:')
          && d().getImageGenFeedTab?.() === 'recent'
        ) {
          imageGenFeedPagedStore = { ...prevStore, sig, whCards, commPosts };
          patchImageGenFeedPendingSection(wrap, pending, failed);
          patchWarehouseFeedCardCover(wrap, coverPatchCard);
          finishWarehouseFeedIncrementalPatch(wrap, scrollState, scrollAnchor, scrollEl, scrollTop, preserveScroll);
          return;
        }
        const prependedCard = warehousePrependedOneCard(prevStore?.whCards, whCards);
        if (prevStore && prependedCard && !tabSwitch && String(prevStore.sig).startsWith('rc:') && d().getImageGenFeedTab?.() === 'recent' && !opts.force) {
          imageGenFeedPagedStore = { ...prevStore, sig, whCards, commPosts };
          patchImageGenFeedPendingSection(wrap, pending, failed);
          const temp = document.createElement('div');
          temp.innerHTML = creationToFeedHtml(prependedCard);
          const newCard = temp.firstElementChild;
          if (newCard) {
            const firstWh = wrap.querySelector('.imagegen-feed-card[data-feed-id^="cr_"]');
            wrap.insertBefore(newCard, firstWh || wrap.querySelector('.grid-sizer') || wrap.firstChild);
            bindImageGenFeedCardEvents(wrap, [newCard]);
          }
          bindImageGenFeedImageRelayout();
          if (scrollState) wrap.__phIgPendingScrollState = scrollState;
          if (d().isMobileFeedViewport?.()) enforceMobileImageGenFeed();
          else repairImageGenFeedLayoutImmediate();
          if (scrollState) scheduleImageGenFeedScrollRestore(wrap, scrollState);
          syncImageGenFeedLoadMoreBtn();
          bindImageGenFeedPagedScroll();
          void (async () => {
            window.MediaPipeline?.patchContainerFromCache?.(wrap, { visibleFirst: true, max: 4 });
            if (window.CardImageLoader?.bindFeed) {
              await window.CardImageLoader.bindFeed(wrap, [{ id: prependedCard.id, image: prependedCard.image }]);
            } else {
              window.CardImageLoader?.observeContainer?.(wrap);
            }
            if (scrollState) scheduleImageGenFeedScrollRestore(wrap, scrollState);
            delete wrap.__phIgPendingScrollState;
            window.invalidateWarehouseCardsForImageGenCache?.();
            window.CardImageLoader?.boostImageGenWarehouseImages?.(wrap, 8);
          })();
          return;
        }
        const keepPage = preserveScroll && opts.scrollToTop !== true && (prevStore?.page || 1) > 1;
        imageGenFeedPagedStore = {
          sig,
          page: keepPage ? prevStore.page : 1,
          whCards,
          commPosts
        };
      } else if (!imageGenFeedPagedStore || imageGenFeedPagedStore.sig !== sig) {
        return;
      }
      const store = imageGenFeedPagedStore;
  
      let html = '';
      let appendHtml = '';
      if (d().getImageGenFeedTab?.() === 'recent') {
        if (!feedAppend) {
          const pending = (d().getImageGenPendingJobs?.() ?? []).slice(0, d().IMAGEGEN_FEED_PENDING_CAP ?? 6);
          const failed = (d().getImageGenFailedJobs?.() ?? []).slice(0, d().IMAGEGEN_FEED_FAILED_CAP ?? 4);
          let list = store.whCards.slice(0, imageGenFeedRenderedCount(store));
          if (list.length) {
            primeWarehouseFeedCardsFast(list);
            const fresh = refreshWarehouseListFromCache(store);
            if (fresh) list = fresh.slice(0, imageGenFeedRenderedCount(store));
          }
          if (!pending.length && !failed.length && !list.length) {
            html = `<div class="imagegen-feed-empty-wrap"><p class="imagegen-feed-empty">暂无最近生成<span class="imagegen-feed-empty-hint">生图成功后会出现在这里 · 保留 7 天 · 仅未存入库的到期自动清理</span></p></div>`;
          } else {
            html = pending.map((j) => buildFeedPendingCardHtml(j)).join('')
              + failed.map((j) => buildFeedFailedCardHtml(j)).join('')
              + list.map((c) => creationToFeedHtml(c)).join('')
              + buildImageGenWarehouseLibraryCtaHtml();
          }
        } else {
          const start = (store.page - 1) * IMAGEGEN_FEED_PER_PAGE;
          const slice = store.whCards.slice(start, start + IMAGEGEN_FEED_PER_PAGE);
          if (!slice.length) return;
          primeWarehouseFeedCardsFast(slice);
          appendHtml = slice.map((c) => creationToFeedHtml(c)).join('');
        }
      } else if (d().getImageGenFeedTab?.() === 'community') {
        if (!feedAppend) {
          const list = store.commPosts.slice(0, imageGenFeedRenderedCount(store));
          if (!list.length) {
            const emptyMsg = d().getCommunityScope?.() === 'curated'
              ? '社区精选正在开发中'
              : d().getCommunityScope?.() === 'following'
                ? '暂无关注作者的作品'
                : '社区暂无内容';
            html = `<p class="imagegen-feed-empty">${d().esc?.(emptyMsg)}</p>`;
          } else {
            html = list.map((p) => communityPostToFeedHtml(p)).join('');
          }
        } else {
          const start = (store.page - 1) * IMAGEGEN_FEED_PER_PAGE;
          const slice = store.commPosts.slice(start, start + IMAGEGEN_FEED_PER_PAGE);
          if (!slice.length) return;
          appendHtml = slice.map((p) => communityPostToFeedHtml(p)).join('');
        }
      }
  
      const mobileFeed = d().isMobileFeedViewport?.();
  
      if (feedAppend) {
        const temp = document.createElement('div');
        temp.innerHTML = appendHtml;
        const newCards = [...temp.children];
        if (!newCards.length) return;
        newCards.forEach((el) => wrap.appendChild(el));
        bindImageGenFeedCardEvents(wrap, newCards);
        bindImageGenFeedImageRelayout();
        if (mobileFeed) enforceMobileImageGenFeed();
        else {
          layoutImageGenFeedMasonry();
          ensureImageGenFeedScrollLayout(wrap);
        }
        if (scrollState) {
          if (!feedAppend) wrap.__phIgPendingScrollState = scrollState;
          scheduleImageGenFeedScrollRestore(wrap, scrollState);
        } else if (scrollEl) {
          if (scrollAnchor) restoreImageGenFeedScrollAnchor(scrollAnchor);
          else applyImageGenFeedScrollTop(scrollEl, scrollTop);
        }
      } else {
        resetImageGenFeedCardLayout();
        d().setFeedLayoutPending?.(wrap, true);
        window.CardImageLoader?.disconnect?.();
        delete wrap.dataset.feedObserverPrimed;
        delete wrap.dataset.masonryLaidOut;
        delete wrap.dataset.feedImageBindKey;
        wrap.className = mobileFeed
          ? 'imagegen-feed imagegen-feed--tiles mobile-feed-grid feed-layout-pending'
          : 'imagegen-feed imagegen-feed--desktop-grid feed-layout-pending';
        try {
          wrap.innerHTML = html;
        } catch (e) {
          console.error('[imageGenFeed] render failed', e);
          wrap.innerHTML = '<p class="imagegen-feed-empty">仓库加载失败，请强刷页面（Ctrl+Shift+R）</p>';
        }
        bindImageGenFeedCardEvents(wrap);
        bindImageGenFeedImageRelayout();
        if (mobileFeed) {
          enforceMobileImageGenFeed();
        } else {
          layoutImageGenFeedMasonry();
          ensureImageGenFeedScrollLayout(wrap);
        }
        d().setFeedLayoutPending?.(wrap, false);
        if (mobileFeed && scrollState) scheduleImageGenFeedScrollRestore(wrap, scrollState);
        else if (!mobileFeed && scrollEl && preserveScroll && !scrollState) {
          applyImageGenFeedScrollTop(scrollEl, scrollTop);
        } else if (scrollState) {
          wrap.__phIgPendingScrollState = scrollState;
        } else if (mobileFeed && scrollEl) {
          if (scrollAnchor) restoreImageGenFeedScrollAnchor(scrollAnchor);
          else applyImageGenFeedScrollTop(scrollEl, scrollTop);
        } else if (!preserveScroll && scrollEl) {
          applyImageGenFeedScrollTop(scrollEl, 0, { force: true });
        }
        d().renderImageGenMobileResult?.();
      }

      const pageStart = feedAppend ? (store.page - 1) * IMAGEGEN_FEED_PER_PAGE : 0;
      const pageEnd = feedAppend
        ? store.page * IMAGEGEN_FEED_PER_PAGE
        : imageGenFeedRenderedCount(store);
      const feedItems = d().getImageGenFeedTab?.() === 'recent'
        ? store.whCards.slice(pageStart, pageEnd)
        : store.commPosts.slice(pageStart, pageEnd).map((p) => ({
          id: p.id,
          image: p.image,
          authorId: p.authorId
        }));
      const feedPrefetchItems = feedItems;
      const feedImageBindKey = feedItems.map((x) => `${x.id}:${x.image || ''}`).join('|');
      const didPrimeWarehouse = !feedAppend && d().getImageGenFeedTab?.() === 'recent' && feedPrefetchItems.length;

      if (didPrimeWarehouse) {
        primeImageGenFeedImages(wrap, feedPrefetchItems);
      }

      syncImageGenFeedLoadMoreBtn();
      bindImageGenFeedPagedScroll();

      void (async () => {
        const skipImageBind = !feedAppend && wrap.dataset.feedImageBindKey === feedImageBindKey;
        if (!skipImageBind) {
          wrap.dataset.feedImageBindKey = feedImageBindKey;
          if (window.CardImageLoader?.bindFeed) {
            void window.CardImageLoader.bindFeed(wrap, feedPrefetchItems);
          } else if (!didPrimeWarehouse && window.FeatureDraft?.hydrateFeedImages) {
            void window.FeatureDraft.hydrateFeedImages(wrap);
          }
        }
        bindImageGenFeedImageRelayout();
        if (mobileFeed) {
          enforceMobileImageGenFeed();
          d().setFeedLayoutPending?.(wrap, false);
          if (scrollState) scheduleImageGenFeedScrollRestore(wrap, scrollState);
          if (d().getImageGenFeedTab?.() === 'recent') {
            window.CardImageLoader?.boostImageGenWarehouseImages?.(wrap, d().isMobileFeedViewport?.() ? 24 : 10);
          }
        }
        if (!didPrimeWarehouse) {
          window.MediaPipeline?.patchContainerFromCache?.(wrap, { visibleFirst: true, max: d().isMobileFeedViewport?.() ? 24 : 8 });
          if (d().getImageGenFeedTab?.() === 'recent') {
            window.CardImageLoader?.boostImageGenWarehouseImages?.(wrap, d().isMobileFeedViewport?.() ? 24 : 10);
          }
        }
        delete wrap.__phIgPendingScrollState;
        d().scrubImageGenFeedCards?.(wrap);
        if (!d().isMobileFeedViewport?.()) {
          ensureImageGenFeedScrollLayout(wrap);
          repairImageGenFeedLayoutImmediate();
        }
        maybeServerRepairWarehouseImages(wrap);
        if (d().getImageGenFeedTab?.() === 'recent' && feedItems.length) {
          void d().repairRecentCreationImagesQuiet?.({ max: 12, skipThumbCheck: true });
          void prefetchWarehouseFeedCardsBackground(feedItems, wrap);
        }
        syncImageGenFeedLoadMoreBtn();
        reconnectImageGenFeedPageObserver();
        if (mobileFeed && !feedAppend) {
          requestAnimationFrame(() => {
            fillImageGenFeedUntilScrollable(wrap, store);
            reconnectImageGenFeedPageObserver();
          });
        }
        /* 生图 /generated/ 由 CDN 现场缩略，勿 backfillGridThumbs（会批量拉原图 2MB+） */
      })();
    }
  
    function bindImageGenFeedCardEvents(wrap, cardsOnly) {
      if (!wrap) return;
      if (!wrap.dataset.whCtaBound) {
        wrap.dataset.whCtaBound = '1';
        wrap.addEventListener('click', (e) => {
          const link = e.target.closest('[data-open-warehouse]');
          if (!link) return;
          e.preventDefault();
          if (typeof switchAppPage === 'function') switchAppPage('warehouse');
        });
      }
      const cardList = cardsOnly?.length
        ? cardsOnly
        : [...wrap.querySelectorAll('.imagegen-feed-card')];
      cardList.filter((card) => card.dataset.failed === '1').forEach((card) => {
        const failId = card.dataset.feedId;
        const prompt = card.dataset.feedPrompt || '';
        card.querySelector('[data-failed-retry]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          d().fillFeedPromptToActiveMode?.(prompt, {
            inspire: card.dataset.fromInspire === '1' || d().getActiveImageGenMode?.() === 'inspire'
          });
        });
        card.querySelector('[data-failed-copy]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          d().copyFeedPromptText?.(prompt);
        });
        card.querySelector('[data-failed-dismiss]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          d().removeFailedGenJob?.(failId);
          renderImageGenFeed({ preserveScroll: true });
        });
      });
      cardList.filter((card) => card.dataset.pending === '1').forEach((card) => {
        card.querySelector('[data-pending-dismiss]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const pendingId = card.dataset.feedId;
          const pending = (d().getImageGenPendingJobs?.() ?? []).find((j) => j.id === pendingId);
          if (pending?.jobId) {
            d().clearSessionGenJob?.(pending.jobId);
            d().getActivePollJobIds?.()?.delete(pending.jobId);
          }
          d().removePendingJob?.(pendingId);
          renderImageGenFeed({ preserveScroll: true });
        });
      });
      cardList.filter((card) => !card.dataset.pending && !card.dataset.failed).forEach((card) => {
        if (card.dataset.feedBound === '1') return;
        card.dataset.feedBound = '1';
        const feedId = card.dataset.feedId;
        const feedKind = d().getImageGenFeedTab?.() === 'recent' ? 'recent' : 'community';
        const feedItemId = feedKind === 'recent'
          ? (feedId.startsWith('cr_') ? feedId.slice(3) : feedId)
          : feedId;
        const getFeedImageRef = () => {
          const img = card.querySelector('.imagegen-feed-media img[data-image-ref]');
          return img?.getAttribute('data-image-ref') || '';
        };
        const openFeedPreview = () => {
          if (feedKind === 'recent') d().openImageGenPreview?.('recent', feedItemId);
          else d().openImageGenPreview?.('community', feedId);
        };
        card.querySelector('.imagegen-feed-thumb-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          void d().openImageGenLightboxAt?.(feedKind, feedItemId, feedId);
        });
        card.querySelector('.imagegen-feed-media')?.addEventListener('click', (e) => {
          if (e.target.closest('.imagegen-feed-thumb-btn')) return;
          if (e.target.closest('.imagegen-feed-save-btn')) return;
          if (e.target.closest('[data-feed-download]')) return;
          e.stopPropagation();
          void d().openImageGenLightboxAt?.(feedKind, feedItemId, feedId);
        });
        const feedDragImg = card.querySelector('.imagegen-feed-media img[data-image-ref]');
        if (feedDragImg && !window.MobileUI?.isMobile?.()) {
          feedDragImg.draggable = true;
          feedDragImg.addEventListener('dragstart', (e) => {
            const imageRef = feedDragImg.getAttribute('data-image-ref') || '';
            if (!imageRef || !d().isDisplayableImage?.(imageRef)) {
              e.preventDefault();
              return;
            }
            e.stopPropagation();
            const payload = {
              imageRef,
              sourceCardId: feedDragImg.getAttribute('data-source-card-id') || ''
            };
            e.dataTransfer.setData('application/x-prompt-hub-image-ref', JSON.stringify(payload));
            e.dataTransfer.setData('text/plain', imageRef.slice(0, 240));
            e.dataTransfer.effectAllowed = 'copy';
            card.classList.add('is-feed-drag-source');
          });
          feedDragImg.addEventListener('dragend', () => {
            card.classList.remove('is-feed-drag-source');
          });
        }
        card.querySelector('[data-feed-copy]')?.addEventListener('click', e => {
          e.stopPropagation();
          d().copyFeedPromptText?.(card.dataset.feedPrompt || '');
        });
        card.querySelector('[data-feed-fill-prompt]')?.addEventListener('click', e => {
          e.stopPropagation();
          d().fillFeedPromptToActiveMode?.(card.dataset.feedPrompt || '');
        });
        card.querySelector('[data-feed-fill-ref]')?.addEventListener('click', e => {
          e.stopPropagation();
          d().fillFeedRefToActiveMode?.(getFeedImageRef(), {
            assetId: feedItemId
          });
        });
        card.querySelector('[data-feed-regenerate]')?.addEventListener('click', e => {
          e.stopPropagation();
          void d().regenerateFeedItem?.(card.dataset.feedPrompt || '', getFeedImageRef(), {
            assetId: feedItemId
          });
        });
        card.querySelectorAll('[data-feed-download]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const img = card.querySelector('.imagegen-feed-media img');
            void d().downloadImageGenFeedItem?.(feedKind, feedItemId, img, btn);
          });
        });
        card.querySelector('[data-save-feed]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (feedKind === 'recent') {
            void d().saveCreationToWarehouse?.(feedItemId);
          }
        });
        card.querySelector('[data-delete-feed]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (feedKind === 'recent') {
            if (typeof d().confirmDeleteCreation === 'function') {
              d().confirmDeleteCreation(feedItemId);
            } else if (typeof confirm === 'function' && confirm('确定删除该条最近生成？')) {
              d().deleteCreation?.(feedItemId);
            }
          } else if (feedKind === 'warehouse' && typeof window.deleteCardPermanently === 'function') {
            window.deleteCardPermanently(feedItemId, true);
          }
        });
        card.addEventListener('click', e => {
          if (e.target.closest('.imagegen-feed-like')) return;
          if (e.target.closest('.imagegen-feed-thumb-btn')) return;
          if (e.target.closest('.imagegen-feed-save-btn')) return;
          if (e.target.closest('[data-delete-feed]')) return;
          if (e.target.closest('[data-feed-download]')) return;
          if (e.target.closest('.imagegen-feed-quick-actions')) return;
          if (e.target.closest('.imagegen-feed-mobile-actions')) return;
          if (e.target.closest('.imagegen-feed-media')) return;
          if (window.MobileUI?.isMobile?.()) return;
          openFeedPreview();
        });
        card.querySelector('.imagegen-feed-like')?.addEventListener('click', e => {
          e.stopPropagation();
          d().likeCommunityPostOnly?.(feedId);
        });
      });
    }

    /** 仅更新 pending/failed 占位，避免 force 全量重绘导致卡顿与滚动回顶 */
    function patchImageGenFeedPendingOnly() {
      const wrap = document.getElementById('imageGenFeed');
      if (!wrap || !imageGenFeedPagedStore) return false;
      const sig = imageGenFeedListSignature();
      if (imageGenFeedPagedStore.sig === sig) return true;
      const pending = (d().getImageGenPendingJobs?.() ?? []).slice(0, d().IMAGEGEN_FEED_PENDING_CAP ?? 6);
      const failed = (d().getImageGenFailedJobs?.() ?? []).slice(0, d().IMAGEGEN_FEED_FAILED_CAP ?? 4);
      if (d().getImageGenFeedTab?.() === 'recent') {
        const whCards = getRecentCreationsFeedList();
        const commPosts = imageGenFeedPagedStore.commPosts || [];
        imageGenFeedPagedStore = { ...imageGenFeedPagedStore, sig, whCards, commPosts };
        patchImageGenFeedPendingSection(wrap, pending, failed);
        if (!d().isMobileFeedViewport?.()) scheduleImageGenFeedLayout();
        else enforceMobileImageGenFeed();
        return true;
      }
      if (d().getImageGenFeedTab?.() === 'community') {
        imageGenFeedPagedStore = {
          ...imageGenFeedPagedStore,
          sig,
          commPosts: getImageGenCommunityFeedList()
        };
        return false;
      }
      return false;
    }

  function init(injected) {
    deps = injected || {};
    return {
      IMAGEGEN_FEED_PER_PAGE,
      layoutImageGenFeedMasonry,
      repairImageGenFeedLayoutImmediate,
      scheduleImageGenFeedLayout,
      resetImageGenFeedCardLayout,
      bindImageGenFeedImageRelayout,
      enforceMobileImageGenFeed,
      resetMobileFeedGridStyles: enforceMobileImageGenFeed,
      buildFeedCardHtml,
      buildFeedPendingCardHtml,
      buildFeedFailedCardHtml,
      feedImgStorageAttr,
      getRecentCreationsFeedList,
      getImageGenWarehouseFeedList: getRecentCreationsFeedList,
      creationToFeedHtml,
      getImageGenCommunityFeedList,
      imageGenFeedListSignature,
      warehouseCardToFeedHtml,
      communityPostToFeedHtml,
      getImageGenFeedNavItems,
      imageGenFeedHasMorePages,
      syncImageGenFeedLoadMoreBtn,
      bindImageGenFeedPagedScroll,
      reconnectImageGenFeedPageObserver,
      renderImageGenFeed,
      bindImageGenFeedCardEvents,
      bindImageGenFeedResizeRelayout,
      captureImageGenFeedCardPositions,
      diagnoseImageGenFeedLayout,
      patchImageGenFeedPendingOnly,
      imageGenFeedIsNearTop
    };
  }

  global.__PH_FEED_PACK_REV__ = 'grid-guard-v6';
  global.ImageGenFeed = { init };
})(typeof window !== 'undefined' ? window : globalThis);

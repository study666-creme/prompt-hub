/**
 * 社区 / 我的主页 Feed 排版模块（与 features-draft 业务解耦）
 *
 * 模式（见 FEED_LAYOUT_MODE）：
 * - communityGrid 桌面：Masonry（列间距 gutter；**上下间距靠 CSS margin-bottom**，gutter 不含纵向）
 * - creationsGrid 桌面：flex 多列（.community-feed-col，文档流）
 * - 手机：mobile-grid
 *
 * 调试：FeedLayout.diagnose('communityGrid') / FeedLayout.diagnose('creationsGrid')
 */
(function (global) {
  'use strict';

  const FEED_LAYOUT_MODE = {
    communityGrid: 'masonry',
    creationsGrid: 'flex-columns',
    userProfileGrid: 'masonry'
  };

  /** @type {Record<string, any>} */
  let deps = {};
  /** @type {import('masonry-layout')|null} */
  let communityMasonry = null;
  /** @type {import('masonry-layout')|null} */
  let profileMasonry = null;

  const layoutDebounce = {};
  const layoutImageBatch = {};
  const layoutCooldown = {};
  const flexRebalanceTimers = {};
  const feedGridImageRelayoutBound = {};
  const resizeRelayoutBound = {};
  const visibilityWaitTimers = {};
  const widthRetryCounts = {};
  let masonryRelayoutTimer = null;
  let masonryRelayoutPending = 0;

  function d() {
    return deps;
  }

  function applyScrollAfterLayout(scrollRoot, capturedTop, containerId) {
    if (!scrollRoot || !Number.isFinite(capturedTop)) return;
    const cid = containerId || '';
    if (cid && d().feedScrollIntentActive?.(cid)) return;
    const cur = scrollRoot.scrollTop;
    if (cur > capturedTop + 12) return;
    const safe = d().safeApplyFeedScrollTop;
    if (typeof safe === 'function') safe(scrollRoot, capturedTop);
    else scrollRoot.scrollTop = capturedTop;
  }

  function isMobile() {
    return global.MobileUI?.isMobileViewport?.() ?? global.matchMedia('(max-width: 900px)').matches;
  }

  function getMode(containerId) {
    if (containerId === 'creationsGrid' && isMobile()) return 'mobile-grid';
    if (containerId === 'communityGrid' && isMobile()) return 'mobile-grid';
    return FEED_LAYOUT_MODE[containerId] || 'masonry';
  }

  function useFlexColumns(containerId) {
    return getMode(containerId) === 'flex-columns';
  }

  function useMobileGrid(containerId) {
    if (containerId === 'userProfileGrid') return true;
    if (containerId !== 'communityGrid' && containerId !== 'creationsGrid') return false;
    return isMobile();
  }

  function getGaps() {
    const fromDeps = d().getCommunityFeedGaps?.();
    if (fromDeps) return fromDeps;
    const gap = d().getMasonryGap?.() ?? 16;
    return { colGap: gap, rowGap: gap };
  }

  function getMeasureEl(container) {
    return container?.closest?.('.community-page-main')
      || container?.closest?.('.feature-body-cards')
      || container?.parentElement
      || container;
  }

  function getFeedPageEl(container) {
    return container?.closest?.('.app-page') || null;
  }

  function isFeedPageVisible(container) {
    const page = getFeedPageEl(container);
    return !page || page.classList.contains('active');
  }

  function deferLayoutUntilVisible(containerId, opts = {}, attempt = 0) {
    clearTimeout(visibilityWaitTimers[containerId]);
    if (attempt > 48) return;
    visibilityWaitTimers[containerId] = setTimeout(() => {
      const container = document.getElementById(containerId);
      if (!container) return;
      if (!isFeedPageVisible(container)) {
        deferLayoutUntilVisible(containerId, opts, attempt + 1);
        return;
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!document.getElementById(containerId)) return;
          schedule(containerId, { ...opts, force: true, immediate: true, recalcCols: true });
        });
      });
    }, attempt === 0 ? 0 : 90);
  }

  function getMeasureInnerWidth(container) {
    if (!isFeedPageVisible(container)) return 0;
    const measure = getMeasureEl(container);
    if (!measure) return 0;
    const style = getComputedStyle(measure);
    let innerW = measure.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const shell = container?.closest?.('.feature-shell') || container?.closest?.('.app-page-feature');
    if (shell) {
      const ss = getComputedStyle(shell);
      const shellW = shell.clientWidth - parseFloat(ss.paddingLeft) - parseFloat(ss.paddingRight);
      if (shellW > 80 && innerW > shellW + 4) innerW = shellW;
    }
    const layoutMax = Math.max(280, global.innerWidth - 240);
    if (innerW > layoutMax) innerW = layoutMax;
    return Math.max(0, innerW);
  }

  function getLayoutWidth(container) {
    if (!container) return 0;
    if (!isFeedPageVisible(container)) return 0;
    const st = getComputedStyle(container);
    const w = container.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
    if (w > 80) return w;
    return getMeasureInnerWidth(container);
  }

  function isCommunityMasonryStale(container) {
    if (!container || container.id !== 'communityGrid') return false;
    if (!container.classList.contains('masonry-ready')) return false;
    const cards = [...container.querySelectorAll(':scope > .card')];
    if (cards.length < 3) return false;
    const cw = getLayoutWidth(container);
    if (cw < 280) return false;
    const cols = getColumnCount(container);
    const gap = getGaps().colGap;
    const expectedMinW = Math.max(100, Math.floor((cw - gap * (cols - 1)) / cols) - 8);
    const sample = cards.slice(0, Math.min(12, cards.length));
    let narrow = 0;
    let sameLeft = 0;
    const firstLeft = parseFloat(sample[0]?.style?.left) || 0;
    for (const card of sample) {
      const w = card.offsetWidth || parseFloat(card.style.width) || 0;
      if (w > 0 && w < expectedMinW * 0.65) narrow += 1;
      const left = parseFloat(card.style.left) || 0;
      if (Math.abs(left - firstLeft) < 6) sameLeft += 1;
    }
    return narrow >= 3 || (sameLeft >= 4 && sample.length >= 4);
  }

  function repairCommunityMasonry(containerId = 'communityGrid') {
    const container = document.getElementById(containerId);
    if (!container || !isCommunityMasonryStale(container)) return false;
    resetMasonryCardStyles(container, containerId);
    container.classList.remove('masonry-ready', 'cards-grid-primed');
    schedule(containerId, { force: true, immediate: true, recalcCols: true });
    return true;
  }

  function getColumnCount(container) {
    if (!container) return d().getCommunityColumns?.() ?? 4;
    if (container.id === 'creationsGrid') return d().getCreationsFeedColumns?.(container) ?? 3;
    const innerW = getLayoutWidth(container);
    const gap = getGaps().colGap;
    const userCols = d().getCommunityColumns?.() ?? 4;
    if (innerW < 80) return userCols;
    const minCol = 156;
    const fit = Math.floor((innerW + gap) / (minCol + gap));
    return Math.min(userCols, Math.max(2, fit));
  }

  function clearCardInline(card) {
    if (!card) return;
    card.classList.remove('is-masonry-positioned');
    card.removeAttribute('style');
    card.querySelectorAll('.card-media').forEach((media) => {
      media.classList.remove('is-masonry-positioned');
      media.removeAttribute('style');
    });
    card.querySelectorAll('.card-img, .card-media img').forEach((img) => {
      img.removeAttribute('style');
      img.removeAttribute('width');
      img.removeAttribute('height');
    });
  }

  function collectCards(container) {
    if (!container) return [];
    const cards = [];
    container.querySelectorAll('.community-feed-col .card').forEach((c) => cards.push(c));
    container.querySelectorAll(':scope > .card').forEach((c) => {
      if (!cards.includes(c)) cards.push(c);
    });
    return cards;
  }

  function resetGridClasses(container) {
    if (!container) return;
    container.classList.remove(
      'community-feed-columns',
      'community-feed-grid',
      'community-mobile-feed',
      'masonry-ready',
      'feed-layout-pending'
    );
    delete container.dataset.feedDistributed;
    delete container.dataset.feedDistributedCols;
    delete container.dataset.feedLayoutCols;
    delete container.dataset.feedCols;
  }

  function ensureColEls(container, cols) {
    let colEls = [...container.querySelectorAll(':scope > .community-feed-col')];
    while (colEls.length < cols) {
      const col = document.createElement('div');
      col.className = 'community-feed-col';
      col.setAttribute('aria-hidden', 'true');
      container.appendChild(col);
      colEls.push(col);
    }
    while (colEls.length > cols) {
      const extra = colEls.pop();
      if (extra) {
        while (extra.firstChild) colEls[0]?.appendChild(extra.firstChild);
        extra.remove();
      }
    }
    return colEls;
  }

  function applyColumnCss(container, cols) {
    if (!container || cols < 1) return;
    const { colGap: gap, rowGap } = getGaps();
    container.dataset.feedLayoutCols = String(cols);
    container.style.setProperty('--feed-columns', String(cols));
    container.style.setProperty('--feed-column-gap', `${gap}px`);
    container.style.setProperty('--feed-row-gap', `${rowGap}px`);
    container.style.width = '100%';
    container.style.maxWidth = '100%';
    container.style.boxSizing = 'border-box';
    container.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    const gridW = container.clientWidth || getMeasureInnerWidth(container);
    if (gridW > 80 && cols > 0) {
      const colPx = Math.max(120, Math.floor((gridW - gap * (cols - 1)) / cols));
      container.style.setProperty('--feed-col-width', `${colPx}px`);
    }
  }

  function redistributeByHeight(container, cols) {
    if (!container || cols < 1) return;
    container.classList.add('community-feed-rebalancing');
    d().scrubStaleCommunityFeedEmpty?.(container);
    container.querySelectorAll(':scope > .grid-sizer').forEach((el) => el.remove());
    const colEls = ensureColEls(container, cols);
    const cards = collectCards(container).sort(compareFeedCardsForDistribution);
    const scrollRoot = d().getFeedScrollRoot?.(container) || container;
    const scrollTop = scrollRoot.scrollTop;
    colEls.forEach((col) => { col.innerHTML = ''; });
    cards.forEach((card) => {
      clearCardInline(card);
      let target = 0;
      let minH = Infinity;
      colEls.forEach((col, i) => {
        const h = col.offsetHeight;
        if (h < minH) {
          minH = h;
          target = i;
        }
      });
      colEls[target].appendChild(card);
      card.dataset.feedCol = String(target);
    });
    container.dataset.feedDistributed = '1';
    container.dataset.feedDistributedCols = String(cols);
    container.dataset.feedCols = String(cols);
    d().ensureFeedPageSentinel?.(container);
    requestAnimationFrame(() => {
      applyScrollAfterLayout(scrollRoot, scrollTop, container.id);
      setTimeout(() => container.classList.remove('community-feed-rebalancing'), 320);
    });
  }

  function feedCardStableKey(card) {
    return String(card?.dataset?.feedOrder
      || card?.dataset?.postId
      || card?.dataset?.sourceCardId
      || card?.dataset?.id
      || '');
  }

  function compareFeedCardsForDistribution(a, b) {
    const ao = Number(a?.dataset?.feedOrder);
    const bo = Number(b?.dataset?.feedOrder);
    const hasA = Number.isFinite(ao);
    const hasB = Number.isFinite(bo);
    if (hasA && hasB && ao !== bo) return ao - bo;
    if (hasA !== hasB) return hasA ? -1 : 1;
    return feedCardStableKey(a).localeCompare(feedCardStableKey(b));
  }

  function scheduleFlexColumnRebalance(containerId, opts = {}) {
    if (!useFlexColumns(containerId)) return;
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!isFeedPageVisible(container)) {
      deferLayoutUntilVisible(containerId, { force: true, recalcCols: true });
      return;
    }
    const delay = Number.isFinite(Number(opts.delay)) ? Number(opts.delay) : 90;
    clearTimeout(flexRebalanceTimers[containerId]);
    flexRebalanceTimers[containerId] = setTimeout(() => {
      const grid = document.getElementById(containerId);
      if (!grid || !useFlexColumns(containerId) || !isFeedPageVisible(grid)) return;
      const cols = Math.max(2, getColumnCount(grid));
      const prevCols = Number(grid.dataset.feedDistributedCols || grid.dataset.feedLayoutCols) || 0;
      const hasColumns = !!grid.querySelector(':scope > .community-feed-col');
      const orphanCards = [...grid.querySelectorAll(':scope > .card')];
      const stableColumns = grid.dataset.feedDistributed === '1'
        && hasColumns
        && prevCols === cols
        && orphanCards.length === 0;
      applyColumnCss(grid, cols);
      if (stableColumns && !opts.force && !opts.recalcCols && !opts.allowRebalance) {
        grid.classList.add('community-feed-grid', 'community-feed-columns');
        grid.classList.remove('masonry-ready', 'community-mobile-feed', 'cards-grid-priming');
        grid.style.removeProperty('height');
        grid.style.removeProperty('max-height');
        grid.style.overflow = 'visible';
        d().scrubStaleCommunityFeedEmpty?.(grid);
        d().ensureFeedPageSentinel?.(grid);
      } else if (
        grid.dataset.feedDistributed === '1'
        && hasColumns
        && orphanCards.length
        && !opts.force
        && !opts.recalcCols
        && !opts.allowRebalance
      ) {
        distributeColumns(grid, cols, { newCards: orphanCards });
      } else if (grid.dataset.feedDistributed === '1' && hasColumns) {
        redistributeByHeight(grid, cols);
      } else {
        layoutFlex(containerId, { force: true, forceReflow: true, recalcCols: true });
      }
      d().revealCommunityFeedImages?.(grid);
      d().setFeedLayoutPending?.(containerId, false);
    }, Math.max(0, delay));
  }

  function settleLayoutAfterAppend(containerId) {
    if (useFlexColumns(containerId)) {
      [120, 420, 900].forEach((delay) => {
        setTimeout(() => scheduleFlexColumnRebalance(containerId, { delay: 0 }), delay);
      });
      return;
    }
    if (useMobileGrid(containerId)) return;
    [140, 460, 960].forEach((delay) => {
      setTimeout(() => scheduleMasonryRelayout(containerId), delay);
    });
  }

  function distributeColumns(container, cols, opts = {}) {
    if (!container || cols < 1) return;
    d().scrubStaleCommunityFeedEmpty?.(container);
    container.querySelectorAll(':scope > .grid-sizer').forEach((el) => el.remove());
    const colEls = ensureColEls(container, cols);
    container.dataset.feedCols = String(cols);

    const newCards = opts.newCards?.length ? [...opts.newCards] : null;
    const orphanCards = [...container.querySelectorAll(':scope > .card')];
    if (newCards?.length && orphanCards.length > 0) {
      const newSet = new Set(newCards);
      const broken = orphanCards.some((c) => !newSet.has(c));
      if (broken) {
        redistributeByHeight(container, cols);
        return;
      }
    }
    if (newCards?.length) {
      const scrollRoot = d().getFeedScrollRoot?.(container) || container;
      const scrollTop = scrollRoot.scrollTop;
      newCards.forEach((card) => {
        clearCardInline(card);
        let target = 0;
        let minH = Infinity;
        colEls.forEach((col, i) => {
          const h = col.offsetHeight;
          if (h < minH) {
            minH = h;
            target = i;
          }
        });
        colEls[target].appendChild(card);
        card.dataset.feedCol = String(target);
      });
      d().ensureFeedPageSentinel?.(container);
      requestAnimationFrame(() => {
        applyScrollAfterLayout(scrollRoot, scrollTop, container.id);
      });
      return;
    }

    const orphans = [...container.querySelectorAll(':scope > .card')];
    if (orphans.length && container.dataset.feedDistributed === '1' && !opts.forceReflow) {
      orphans.forEach((card, i) => {
        clearCardInline(card);
        const colIdx = Number(card.dataset.feedCol);
        const target = Number.isFinite(colIdx) && colEls[colIdx] ? colIdx : (i % cols);
        colEls[target].appendChild(card);
        card.dataset.feedCol = String(target);
      });
      return;
    }

    if (container.dataset.feedDistributed === '1' && !opts.forceReflow) return;

    redistributeByHeight(container, cols);
  }

  function flattenColumns(container) {
    if (!container) return;
    const cards = collectCards(container);
    container.querySelectorAll(':scope > .community-feed-col').forEach((col) => col.remove());
    cards.forEach((card) => container.appendChild(card));
    resetGridClasses(container);
  }

  function scrubFlexCards(container) {
    if (!container) return;
    container.style.removeProperty('height');
    container.style.removeProperty('max-width');
    container.querySelectorAll(':scope > .grid-sizer').forEach((el) => el.remove());
    collectCards(container).forEach(clearCardInline);
    d().scrubCommunityFeedCardMediaHeights?.(container);
    applyColumnCss(container, getColumnCount(container));
  }

  function destroyMasonry(containerId) {
    if (containerId === 'communityGrid' && communityMasonry) {
      communityMasonry.destroy();
      communityMasonry = null;
    } else if (containerId === 'userProfileGrid' && profileMasonry) {
      profileMasonry.destroy();
      profileMasonry = null;
    }
  }

  function resetMasonryCardStyles(container, containerId) {
    destroyMasonry(containerId);
    container.style.removeProperty('height');
    container.classList.remove('community-feed-grid');
    container.querySelectorAll('.grid-sizer').forEach((el) => el.remove());
    container.querySelectorAll('.card').forEach((card) => {
      card.classList.remove('is-masonry-positioned');
      card.style.removeProperty('position');
      card.style.removeProperty('left');
      card.style.removeProperty('top');
      card.style.removeProperty('width');
      card.style.removeProperty('max-width');
      card.style.removeProperty('margin-bottom');
      card.style.removeProperty('transform');
    });
  }

  function enforceMobileGrid(containerId) {
    if (!isMobile()) return;
    if (containerId !== 'communityGrid' && containerId !== 'creationsGrid') return;
    const container = document.getElementById(containerId);
    if (!container || !container.querySelector('.card')) return;
    flattenColumns(container);
    resetMasonryCardStyles(container, containerId);
    container.classList.add('community-mobile-feed');
    container.classList.remove('masonry-ready');
    d().setFeedLayoutPending?.(containerId, false);
  }

  function isCreationsStale(container) {
    if (!container || container.id !== 'creationsGrid' || !useFlexColumns('creationsGrid')) return false;
    const n = container.querySelectorAll('.community-post-card').length;
    if (!n) return false;
    if (container.classList.contains('masonry-ready')) return true;
    if (container.querySelectorAll(':scope > .card').length > 0) return true;
    if (!container.classList.contains('community-feed-columns')) return true;
    if (container.querySelectorAll(':scope > .community-feed-col').length < 2) return true;
    const inlineH = parseFloat(container.style.height);
    if (Number.isFinite(inlineH) && inlineH > 0 && inlineH < 160 && n > 2) return true;
    const st = getComputedStyle(container);
    if (
      (st.overflowY === 'auto' || st.overflowY === 'scroll')
      && container.clientHeight < 160
      && container.scrollHeight > container.clientHeight + 48
    ) return true;
    return false;
  }

  function isLayoutReady(container, containerId) {
    if (!container?.querySelector?.('.community-post-card')) return false;
    if (useFlexColumns(containerId)) {
      return !isCreationsStale(container)
        && container.classList.contains('community-feed-columns')
        && !!container.querySelector(':scope > .community-feed-col');
    }
    return container.classList.contains('masonry-ready')
      || !!container.querySelector(':scope > .community-feed-col');
  }

  function layoutFlex(containerId, opts = {}) {
    const container = document.getElementById(containerId);
    if (!container || getMode(containerId) !== 'flex-columns') return;
    const hasFeedCols = !!container.querySelector(':scope > .community-feed-col');
    const feedStable = container.dataset.feedDistributed === '1';
    const mustFlatten = opts.recalcCols === true || opts.forceReflow === true || opts.force === true || !feedStable;
    if (hasFeedCols && feedStable && !mustFlatten && !opts.newCards?.length) {
      scrubFlexCards(container);
      d().ensureFeedPageSentinel?.(container);
      d().setFeedLayoutPending?.(containerId, false);
      return;
    }
    if (hasFeedCols && mustFlatten) flattenColumns(container);
    destroyMasonry(containerId);
    d().scrubStaleCommunityFeedEmpty?.(container);
    container.classList.remove('community-mobile-feed', 'masonry-ready', 'cards-grid-priming');
    container.classList.add('community-feed-grid', 'community-feed-columns');
    container.style.removeProperty('height');
    container.style.removeProperty('max-height');
    container.style.overflow = 'visible';
    const measuredCols = getColumnCount(container);
    const prevCols = Number(container.dataset.feedDistributedCols || container.dataset.feedLayoutCols) || 0;
    const measuredColsChanged = prevCols > 0 && prevCols !== measuredCols;
    if (opts.recalcCols === true && measuredColsChanged) {
      delete container.dataset.feedLayoutCols;
      delete container.dataset.feedDistributed;
      delete container.dataset.feedDistributedCols;
    } else if (opts.recalcCols === true && container.dataset.feedDistributed === '1') {
      const scrollRoot = d().getFeedScrollRoot?.(container) || container;
      const scrollTop = scrollRoot.scrollTop;
      applyColumnCss(container, measuredCols);
      d().ensureFeedPageSentinel?.(container);
      requestAnimationFrame(() => {
        applyScrollAfterLayout(scrollRoot, scrollTop, container.id);
      });
      d().setFeedLayoutPending?.(containerId, false);
      return;
    }
    const cols = measuredCols;
    applyColumnCss(container, cols);
    container.querySelectorAll('.grid-sizer').forEach((el) => el.remove());
    collectCards(container).forEach(clearCardInline);
    const colsChanged = Number(container.dataset.feedDistributedCols || 0) !== cols;
    distributeColumns(container, cols, {
      forceReflow: opts.force === true || opts.forceReflow === true
        || container.dataset.feedDistributed !== '1'
        || (opts.recalcCols === true && colsChanged),
      newCards: opts.newCards
    });
    d().ensureFeedPageSentinel?.(container);
    d().revealCommunityFeedImages?.(container);
    d().setFeedLayoutPending?.(containerId, false);
    global.CardImageLoader?.observeContainer?.(container);
  }

  function runMasonry(containerId, opts = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!isFeedPageVisible(container)) {
      deferLayoutUntilVisible(containerId, opts);
      return;
    }
    if (containerId === 'communityGrid' && isCommunityMasonryStale(container)) {
      resetMasonryCardStyles(container, containerId);
      container.classList.remove('masonry-ready', 'cards-grid-primed');
    }
    if (containerId === 'creationsGrid') {
      layoutFlex('creationsGrid', { force: true, forceReflow: true });
      return;
    }
    if (isMobile() && containerId === 'communityGrid') {
      enforceMobileGrid(containerId);
      return;
    }
    if (typeof Masonry === 'undefined') return;

    const cardEls = [...container.querySelectorAll('.card')];
    const isProfile = containerId === 'userProfileGrid';
    let instance = isProfile ? profileMasonry : communityMasonry;

    if (!cardEls.length) {
      if (instance) {
        instance.destroy();
        if (isProfile) profileMasonry = null;
        else communityMasonry = null;
      }
      d().setFeedLayoutPending?.(containerId, false);
      return;
    }

    const feedGaps = getGaps();
    const gap = containerId === 'communityGrid' ? feedGaps.colGap : (d().getMasonryGap?.() ?? 16);
    const style = getComputedStyle(container);
    const innerW = containerId === 'communityGrid'
      ? getLayoutWidth(container)
      : container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (innerW < 200) {
      const key = containerId + ':w';
      widthRetryCounts[key] = (widthRetryCounts[key] || 0) + 1;
      if (widthRetryCounts[key] > 28) return;
      deferLayoutUntilVisible(containerId, opts);
      return;
    }
    widthRetryCounts[containerId + ':w'] = 0;
    const cols = isProfile
      ? Math.min(4, d().getCardColumns?.() ?? 3)
      : getColumnCount(container);
    const colWidth = Math.max(120, Math.floor((innerW - gap * (cols - 1)) / cols));
    let sizer = container.querySelector('.grid-sizer');
    if (!sizer) {
      sizer = document.createElement('div');
      sizer.className = 'grid-sizer';
      container.insertBefore(sizer, container.firstChild);
    }
    sizer.style.width = colWidth + 'px';
    cardEls.forEach((card) => {
      card.style.width = colWidth + 'px';
    });
    container.style.removeProperty('height');
    const mOpts = {
      itemSelector: '.card',
      columnWidth: '.grid-sizer',
      gutter: gap,
      percentPosition: false,
      horizontalOrder: false,
      transitionDuration: 0
    };
    const scrollRoot = d().getFeedScrollRoot?.(container) || container;
    const scrollTop = scrollRoot.scrollTop;
    if (instance) {
      instance.option(mOpts);
      instance.reloadItems();
      instance.layout();
    } else {
      cardEls.forEach((card) => {
        card.style.left = '';
        card.style.top = '';
        card.style.position = '';
      });
      instance = new Masonry(container, mOpts);
      if (isProfile) profileMasonry = instance;
      else communityMasonry = instance;
    }
    applyScrollAfterLayout(scrollRoot, scrollTop, containerId);
    container.classList.add('masonry-ready', 'cards-grid-primed');
    const { rowGap } = getGaps();
    if (rowGap) container.style.setProperty('--feed-row-gap', `${rowGap}px`);
    if (colWidth) container.style.setProperty('--feed-col-width', `${colWidth}px`);
    d().setFeedLayoutPending?.(containerId, false);
    requestAnimationFrame(() => {
      const m = isProfile ? profileMasonry : communityMasonry;
      if (typeof m?.reloadItems === 'function') m.reloadItems();
      m?.layout?.();
      d().revealCommunityFeedImages?.(container);
      scheduleMasonryRelayout(containerId);
    });
  }

  function layout(containerId, opts = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const mode = getMode(containerId);
    if (mode === 'flex-columns') {
      layoutFlex(containerId, opts);
      return;
    }
    if (mode === 'mobile-grid') {
      enforceMobileGrid(containerId);
      global.CardImageLoader?.observeContainer?.(container);
      return;
    }
    const hasFeedCols = !!container.querySelector(':scope > .community-feed-col');
    const feedStable = container.dataset.feedDistributed === '1';
    const mustFlatten = opts.recalcCols === true || opts.forceReflow === true || opts.force === true || !feedStable;
    if (hasFeedCols && (mustFlatten || containerId === 'communityGrid')) {
      flattenColumns(container);
    }
    container.classList.remove('community-feed-grid', 'community-feed-columns', 'community-mobile-feed');
    const run = () => runMasonry(containerId, opts);
    if (typeof Masonry !== 'undefined') run();
    else if (typeof global.ensureMasonryScript === 'function') void global.ensureMasonryScript().then(run);
    else run();
  }

  function schedule(containerId, opts = {}) {
    const container = document.getElementById(containerId);
    if (container && !isFeedPageVisible(container)) {
      deferLayoutUntilVisible(containerId, opts);
      return;
    }
    if (useFlexColumns(containerId)) {
      if (opts.fromImage) {
        scheduleFlexColumnRebalance(containerId, { delay: opts.immediate ? 0 : 80 });
        return;
      }
      const container = document.getElementById(containerId);
      if (
        container?.dataset.feedDistributed === '1'
        && !opts.recalcCols
        && !opts.force
        && !opts.newCards?.length
      ) {
        scrubFlexCards(container);
        d().ensureFeedPageSentinel?.(container);
        d().setFeedLayoutPending?.(containerId, false);
        return;
      }
      const runFlex = () => {
        layoutFlex(containerId, {
          newCards: opts.newCards,
          recalcCols: opts.recalcCols === true,
          force: opts.force === true,
          forceReflow: opts.recalcCols === true || opts.force === true
        });
      };
      clearTimeout(layoutDebounce[containerId]);
      layoutDebounce[containerId] = setTimeout(runFlex, opts.immediate ? 0 : 80);
      return;
    }
    if (useMobileGrid(containerId)) {
      if (opts.fromImage) return;
      layout(containerId);
      return;
    }
    const run = () => {
      layout(containerId, opts);
      if (!opts.fromImage) {
        layoutCooldown[containerId] = true;
        setTimeout(() => {
          layoutCooldown[containerId] = false;
        }, 800);
      }
    };
    if (opts.fromImage) {
      clearTimeout(layoutImageBatch[containerId]);
      layoutImageBatch[containerId] = setTimeout(run, opts.immediate ? 0 : 60);
      return;
    }
    if (!opts.force && layoutCooldown[containerId]) return;
    clearTimeout(layoutDebounce[containerId]);
    layoutDebounce[containerId] = setTimeout(run, opts.immediate ? 0 : 80);
  }

  function scheduleMasonryRelayout(containerId = 'communityGrid') {
    if (isMobile()) return;
    if (useFlexColumns(containerId)) {
      scheduleFlexColumnRebalance(containerId, { delay: 90 });
      return;
    }
    const container = document.getElementById(containerId);
    if (!container) return;
    const inst = containerId === 'userProfileGrid' ? profileMasonry : communityMasonry;
    masonryRelayoutPending += 1;
    clearTimeout(masonryRelayoutTimer);
    masonryRelayoutTimer = setTimeout(() => {
      masonryRelayoutPending = 0;
      if (inst && typeof inst.layout === 'function') {
        const scrollRoot = d().getFeedScrollRoot?.(container) || container;
        const scrollTop = scrollRoot.scrollTop;
        if (typeof inst.reloadItems === 'function') inst.reloadItems();
        inst.layout();
        applyScrollAfterLayout(scrollRoot, scrollTop, containerId);
      } else {
        layout(containerId, { force: true });
      }
    }, masonryRelayoutPending > 4 ? 220 : 80);
  }

  function relayoutAll() {
    if (isMobile()) {
      enforceMobileGrid('communityGrid');
      enforceMobileGrid('creationsGrid');
    }
    ['communityGrid', 'creationsGrid', 'userProfileGrid'].forEach((id) => layout(id));
  }

  function repairCreations(force = false) {
    const container = document.getElementById('creationsGrid');
    if (!container) return false;
    if (!force && !isCreationsStale(container)) return false;
    container.classList.remove('masonry-ready', 'community-mobile-feed', 'cards-grid-priming');
    container.style.removeProperty('height');
    container.style.removeProperty('max-height');
    container.style.overflow = 'visible';
    if (container.querySelectorAll('.community-post-card').length) {
      delete container.dataset.feedDistributed;
      delete container.dataset.feedDistributedCols;
      layoutFlex('creationsGrid', { force: true, forceReflow: true, recalcCols: true });
      return true;
    }
    return repairFlex('creationsGrid');
  }

  function repairFlex(containerId) {
    const container = document.getElementById(containerId);
    if (!container || !useFlexColumns(containerId)) return false;
    const orphans = [...container.querySelectorAll(':scope > .card')];
    if (orphans.length) {
      const cols = Number(container.dataset.feedDistributedCols || container.dataset.feedLayoutCols)
        || getColumnCount(container);
      orphans.forEach(clearCardInline);
      distributeColumns(container, cols, { newCards: orphans });
      container.classList.add('community-feed-grid', 'community-feed-columns');
      d().setFeedLayoutPending?.(containerId, false);
      return true;
    }
    if (!container.querySelectorAll(':scope > .community-feed-col').length) {
      layout(containerId, { forceReflow: true, recalcCols: true });
      return true;
    }
    return false;
  }

  function syncColumnCount(containerId) {
    const container = document.getElementById(containerId);
    if (!container || !useFlexColumns(containerId)) return;
    const desired = getColumnCount(container);
    const colEls = container.querySelectorAll(':scope > .community-feed-col');
    const prev = Number(container.dataset.feedDistributedCols || container.dataset.feedLayoutCols) || 0;
    const orphans = container.querySelectorAll(':scope > .card').length;
    if (
      container.dataset.feedDistributed === '1'
      && colEls.length === desired
      && prev === desired
      && !orphans
    ) {
      scrubFlexCards(container);
      if (containerId === 'creationsGrid' && isCreationsStale(container)) repairCreations(true);
      return;
    }
    if (container.dataset.feedDistributed === '1' && colEls.length) {
      redistributeByHeight(container, desired);
    } else {
      layout(containerId, { forceReflow: true, recalcCols: true });
    }
    applyColumnCss(container, desired);
    d().setFeedLayoutPending?.(containerId, false);
    if (containerId === 'creationsGrid' && isCreationsStale(container)) repairCreations(true);
  }

  function ensureColumnLayout(containerId) {
    const container = document.getElementById(containerId);
    if (!container || !useFlexColumns(containerId)) return;
    const colEls = container.querySelectorAll(':scope > .community-feed-col');
    const orphanCards = [...container.querySelectorAll(':scope > .card')];
    if (colEls.length && !orphanCards.length) {
      syncColumnCount(containerId);
      return;
    }
    if (colEls.length) scrubFlexCards(container);
    if (colEls.length && orphanCards.length) {
      const cols = Number(container.dataset.feedDistributedCols || container.dataset.feedLayoutCols)
        || getColumnCount(container);
      distributeColumns(container, cols, { newCards: orphanCards });
      container.classList.add('community-feed-grid', 'community-feed-columns');
      d().setFeedLayoutPending?.(containerId, false);
      return;
    }
    layout(containerId, { forceReflow: true });
  }

  function appendCards(containerId, appendedCards) {
    const container = document.getElementById(containerId);
    if (!container || !appendedCards?.length) return;
    if (useFlexColumns(containerId)) {
      ensureColumnLayout(containerId);
      const cols = Math.max(
        2,
        Number(container.dataset.feedDistributedCols || container.dataset.feedLayoutCols)
          || getColumnCount(container)
      );
      distributeColumns(container, cols, { newCards: appendedCards });
      d().setFeedLayoutPending?.(containerId, false);
      settleLayoutAfterAppend(containerId);
      return;
    }
    if (container.querySelector(':scope > .community-feed-col')) {
      const cols = Math.max(2, Number(container.dataset.feedLayoutCols) || getColumnCount(container));
      distributeColumns(container, cols, { newCards: appendedCards });
      return;
    }
    const inst = containerId === 'userProfileGrid' ? profileMasonry : communityMasonry;
    if (inst && typeof inst.appended === 'function') {
      inst.appended(appendedCards);
      inst.layout();
      settleLayoutAfterAppend(containerId);
      return;
    }
    layout(containerId);
    settleLayoutAfterAppend(containerId);
  }

  function bindImageRelayout(containerId) {
    if (feedGridImageRelayoutBound[containerId]) return;
    const container = document.getElementById(containerId);
    if (!container || isMobile()) return;
    feedGridImageRelayoutBound[containerId] = true;
    container.addEventListener('load', (e) => {
      if (!e.target?.classList?.contains('card-img')) return;
      if (typeof global.isPlaceholderCardImg === 'function' && global.isPlaceholderCardImg(e.target)) return;
      if (useFlexColumns(containerId)) scheduleFlexColumnRebalance(containerId, { delay: 80 });
      else scheduleMasonryRelayout(containerId);
    }, true);
    container.addEventListener('error', (e) => {
      if (!e.target?.classList?.contains('card-img')) return;
      if (useFlexColumns(containerId)) scheduleFlexColumnRebalance(containerId, { delay: 80 });
      else scheduleMasonryRelayout(containerId);
    }, true);
  }

  function bindResizeRelayout(containerId) {
    if (resizeRelayoutBound[containerId]) return;
    const container = document.getElementById(containerId);
    if (!container || typeof ResizeObserver === 'undefined') return;
    const watchEl = container.closest('.community-page-layout') || container.parentElement;
    if (!watchEl) return;
    resizeRelayoutBound[containerId] = true;
    let timer = null;
    let lastW = 0;
    const obs = new ResizeObserver((entries) => {
      const grid = document.getElementById(containerId);
      if (!grid || !isFeedPageVisible(grid)) return;
      const w = entries[0]?.contentRect?.width ?? watchEl.clientWidth;
      if (w < 80 || Math.abs(w - lastW) < 4) return;
      const delta = Math.abs(w - lastW);
      lastW = w;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const grid = document.getElementById(containerId);
        if (!grid) return;
        if (useFlexColumns(containerId)) {
          const measured = getColumnCount(grid);
          const prev = Number(grid.dataset.feedDistributedCols || grid.dataset.feedLayoutCols) || 0;
          if (grid.dataset.feedDistributed === '1' && prev === measured) {
            applyColumnCss(grid, measured);
            scrubFlexCards(grid);
            return;
          }
          if (grid.dataset.feedDistributed === '1' && prev !== measured) {
            syncColumnCount(containerId);
            return;
          }
        }
        schedule(containerId, { recalcCols: true, force: true, immediate: delta > 100 });
      }, delta > 100 ? 0 : 80);
    });
    obs.observe(watchEl);
  }

  function diagnose(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return { error: 'container missing', containerId };
    const mode = getMode(containerId);
    const directCards = el.querySelectorAll(':scope > .card').length;
    const gaps = getGaps();
    const out = {
      build: global.__APP_BUILD__,
      containerId,
      mode,
      gaps,
      masonryReady: el.classList.contains('masonry-ready'),
      feedColumnsClass: el.classList.contains('community-feed-columns'),
      feedCols: el.querySelectorAll(':scope > .community-feed-col').length,
      directCards,
      orphanCards: directCards,
      feedDistributed: el.dataset.feedDistributed,
      inlineHeight: el.style.height || null,
      clientH: el.clientHeight,
      scrollH: el.scrollHeight,
      overflowY: getComputedStyle(el).overflowY
    };
    if (mode === 'masonry' && directCards > 0) {
      out.note = 'Masonry：directCards/orphanCards 为直挂 .card 数量，非 flex 孤儿';
    } else if (mode === 'flex-columns' && directCards > 0) {
      out.note = 'flex 多列：directCards>0 表示有卡未进列，需 repair';
    }
    return out;
  }

  function destroyLayout(containerId) {
    destroyMasonry(containerId);
  }

  function destroyAllLayouts() {
    destroyMasonry('communityGrid');
    destroyMasonry('userProfileGrid');
  }

  function init(injectedDeps) {
    deps = injectedDeps || {};
    return api;
  }

  const api = {
    FEED_LAYOUT_MODE,
    init,
    getMode,
    useFlexColumns,
    useMobileGrid,
    getLayoutWidth,
    isLayoutReady,
    isCreationsStale,
    layout,
    layoutFlex,
    schedule,
    scheduleMasonryRelayout,
    scheduleFlexColumnRebalance,
    relayoutAll,
    repairCreations,
    repairCommunityMasonry,
    isCommunityMasonryStale,
    isFeedPageVisible,
    repairFlex,
    syncColumnCount,
    ensureColumnLayout,
    appendCards,
    distributeColumns,
    scrubFlexCards,
    flattenColumns,
    resetGridClasses,
    getColumnCount,
    destroyLayout,
    destroyAllLayouts,
    bindImageRelayout,
    bindResizeRelayout,
    diagnose
  };

  global.FeedLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);

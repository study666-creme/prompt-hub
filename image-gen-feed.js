/**
 * 生图仓库 Feed：Masonry 排版、渲染、分页（与 features-draft 业务解耦）
 */
(function (global) {
  'use strict';

  const IMAGEGEN_FEED_PER_PAGE = 24;

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

  function markImageGenFeedUserScrolling() {
    imageGenFeedUserScrollingUntil = Date.now() + 1400;
    imageGenFeedScrollIntent = true;
  }

  function shouldDeferImageGenFeedRender() {
    return Date.now() < imageGenFeedUserScrollingUntil;
  }

  function bindImageGenFeedScrollGuard(wrap, scrollEl) {
    if (!wrap || !scrollEl || scrollEl.dataset.phIgScrollGuard === '1') return;
    scrollEl.dataset.phIgScrollGuard = '1';
    scrollEl.addEventListener('scroll', () => markImageGenFeedUserScrolling(), { passive: true });
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

  function restoreImageGenFeedScrollAnchor(anchor) {
    if (!anchor?.scrollEl) return;
    const { scrollEl } = anchor;
    if (anchor.feedId) {
      const card = document.querySelector(`#imageGenFeed .imagegen-feed-card[data-feed-id="${CSS.escape(anchor.feedId)}"]`);
      if (card) {
        const rootRect = scrollEl.getBoundingClientRect();
        const rect = card.getBoundingClientRect();
        scrollEl.scrollTop = Math.max(0, anchor.scrollTop + (rect.top - rootRect.top) - anchor.offset);
        return;
      }
    }
    scrollEl.scrollTop = anchor.scrollTop;
  }

  function collectImageGenFeedScrollTargets(wrap) {
    const targets = new Set();
    const primary = resolveImageGenFeedScrollRoot(wrap) || wrap;
    if (primary) targets.add(primary);
    if (wrap) targets.add(wrap);
    if (document.body.classList.contains('imagegen-mobile-view-feed')) {
      const shell = wrap?.closest?.('.feature-shell');
      if (shell) targets.add(shell);
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
    if (!state) return;
    if (state.anchor) restoreImageGenFeedScrollAnchor(state.anchor);
    state.tops?.forEach((top, el) => {
      if (el?.isConnected) el.scrollTop = top;
    });
  }

  function scheduleImageGenFeedScrollRestore(wrap, state) {
    if (!state) return;
    const run = () => restoreImageGenFeedScrollState(wrap, state);
    run();
    requestAnimationFrame(() => {
      run();
      requestAnimationFrame(run);
    });
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
      if (String(a.updatedAt || '') !== String(b.updatedAt || '')) return false;
    }
    return true;
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
      return wrap.closest('.feature-shell') || wrap;
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
      clearTimeout(imageGenLayoutTimer);
      const run = () => {
        if (d().isMobileFeedViewport?.()) enforceMobileImageGenFeed();
        else layoutImageGenFeedMasonry();
      };
      if (immediate) {
        run();
        requestAnimationFrame(run);
        return;
      }
      imageGenLayoutTimer = setTimeout(run, 160);
    }

    function bindImageGenFeedResizeRelayout() {
      if (window.__imageGenFeedResizeBound) return;
      const watch = document.querySelector('.imagegen-side') || document.getElementById('imageGenFeed');
      if (!watch || typeof ResizeObserver === 'undefined') return;
      window.__imageGenFeedResizeBound = true;
      let timer = null;
      let lastW = 0;
      const obs = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect?.width ?? watch.clientWidth;
        if (w < 80) return;
        const delta = Math.abs(w - lastW);
        lastW = w;
        clearTimeout(timer);
        timer = setTimeout(() => scheduleImageGenFeedLayout({ immediate: true }), delta > 100 ? 0 : 60);
      });
      obs.observe(watch);
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
      if (d().isMobileFeedViewport?.()) {
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
          d().setFeedLayoutPending?.(wrap, false);
          return;
        }
        const gap = d().getMasonryGap?.();
        const style = getComputedStyle(wrap);
        const innerW = wrap.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        if (innerW < 80) {
          scheduleImageGenFeedLayout();
          return;
        }
        const cols = d().getImageGenFeedColumns?.(innerW);
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
        const scrollState = wrap.__phIgPendingScrollState || captureImageGenFeedScrollState(wrap);
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
          restoreImageGenFeedScrollState(wrap, scrollState);
          d().setFeedLayoutPending?.(wrap, false);
          window.CardImageLoader?.observeContainer?.(wrap);
          d().scrubImageGenFeedCards?.(wrap);
        });
        const scrollElSync = resolveImageGenFeedScrollRoot(wrap) || wrap;
        scrollElSync.scrollTop = scrollTop;
        bindImageGenFeedImageRelayout();
      };

      if (typeof Masonry !== 'undefined') runLayout();
      else if (typeof window.ensureMasonryScript === 'function') {
        void window.ensureMasonryScript().then(runLayout);
      } else runLayout();
    }

    function primeImageGenFeedImages(wrap, feedItems) {
      if (!wrap) return;
      window.MediaPipeline?.patchContainerFromCache?.(wrap, { visibleFirst: true, max: 28 });
      window.CardImageLoader?.boostImageGenWarehouseImages?.(wrap, 32);
      window.CardImageLoader?.observeContainer?.(wrap);
      if (feedItems?.length && window.CardImageLoader?.bindFeed) {
        void window.CardImageLoader.bindFeed(wrap, feedItems.slice(0, Math.min(feedItems.length, 16)));
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
        showLike = false, liked = false, likeCount = 0, showSave = false, showDel = false,
        sourceCardId = ''
      } = opts;
      const { showTitle, showPrompt } = resolveFeedCardDisplay(title, prompt);
      const storageAttr = feedImgStorageAttr(image);
      const jobAttr = jobId ? ` data-job-id="${d().esc?.(jobId)}"` : '';
      const cardIdAttr = sourceCardId ? ` data-source-card-id="${d().esc?.(sourceCardId)}"` : '';
      const listUrl = (sourceCardId && d().isDisplayableImage?.(image) && window.SupabaseSync?.getListDisplayImageSrc)
        ? window.SupabaseSync.getListDisplayImageSrc(image, sourceCardId)
        : '';
      const imgSrc = listUrl || (d().isDisplayableImage?.(image) ? d().IMG_LOADING_PLACEHOLDER : '');
      const imgPending = d().isDisplayableImage?.(image) && (!listUrl || imgSrc.includes('data:image/svg'));
      const loadingCls = imgPending ? ' is-loading' : '';
      const shineAt = imgPending ? ` data-shine-at="${Date.now()}"` : '';
      const imgBlock = d().isDisplayableImage?.(image)
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
        ? '<button type="button" class="btn btn-ghost btn-sm imagegen-feed-save-btn" data-save-feed="1">存仓库</button>'
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
      const mobileActs = `<div class="imagegen-feed-mobile-actions mobile-only">
            <button type="button" class="imagegen-feed-mobile-btn" data-feed-copy>复制</button>
            <button type="button" class="imagegen-feed-mobile-btn" data-feed-fill-prompt>填入生图</button>
            ${imgBlock ? '<button type="button" class="imagegen-feed-mobile-btn" data-feed-download>下载</button>' : ''}
          </div>`;
      const fillHint = '';
      return `<article class="imagegen-feed-card imagegen-feed-card-tile${noMedia}${active ? ' active' : ''}" data-feed-id="${d().esc?.(id)}" data-feed-prompt="${d().esc?.(prompt || '')}" tabindex="0">
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

    function getImageGenWarehouseFeedList() {
      return typeof window.getWarehouseCardsForImageGen === 'function'
        ? window.getWarehouseCardsForImageGen({ group: d().getImageGenWhGroup?.(), tag: d().getImageGenWhTag?.() })
        : [];
    }
  
    function getImageGenCommunityFeedList() {
      return d().filterAndSortPosts?.(d().getCommunityFeedForDisplay?.());
    }
  
    function imageGenFeedListSignature() {
      if (d().getImageGenFeedTab?.() === 'warehouse') {
        const whCount = typeof window.getWarehouseCardsForImageGen === 'function'
          ? window.getWarehouseCardsForImageGen({
            group: d().getImageGenWhGroup?.(),
            tag: d().getImageGenWhTag?.()
          }).length
          : 0;
        const pendingSig = (d().getImageGenPendingJobs?.() ?? [])
          .map((j) => `${j.id}:${j.recovering ? 1 : 0}:${j.jobId || ''}:${(j.pendingNote || '').slice(0, 12)}`)
          .join(',');
        const failedSig = (d().getImageGenFailedJobs?.() ?? [])
          .map((j) => j.id)
          .join(',');
        return `wh:${d().getImageGenWhGroup?.()}:${d().getImageGenWhTag?.()}:p${pendingSig}:f${failedSig}:n${whCount}`;
      }
      const posts = getImageGenCommunityFeedList();
      const ids = posts.map((p) => String(p.id)).join('|');
      return `cm:${d().getCommunityScope?.()}:${d().getCommunitySort?.()}:${posts.length}:${ids}`;
    }
  
    function warehouseCardToFeedHtml(c) {
      const groupLabel = c.group || '未分类';
      const titleTrim = (c.title || '').trim();
      const tagPart = (c.tags || []).slice(0, 2).join(' · ');
      const mjBadge = c.isMidjourney && Array.isArray(c.mjGridUrls) && c.mjGridUrls.length > 1 ? 'MJ·4' : '';
      const whMeta = [groupLabel, tagPart, mjBadge].filter(Boolean).join(' · ');
      return buildFeedCardHtml({
        id: 'wh_' + c.id,
        sourceCardId: c.id,
        jobId: c.genJobId ? String(c.genJobId).replace(/#\d+$/, '') : null,
        prompt: c.prompt,
        image: c.image,
        title: titleTrim,
        metaLine: whMeta,
        meta: '',
        showDel: true
      });
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
          const warehouse = feedId.startsWith('wh_');
          return {
            key: feedId,
            kind: warehouse ? 'warehouse' : 'community',
            id: warehouse ? feedId.slice(3) : feedId
          };
        });
    }

    function imageGenFeedHasMorePages() {
      const store = imageGenFeedPagedStore;
      if (!store) return false;
      const total = d().getImageGenFeedTab?.() === 'warehouse' ? store.whCards.length : store.commPosts.length;
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
      const scrollEl = imageGenFeedScrollEl || resolveImageGenFeedScrollRoot(wrap) || wrap;
      const store = imageGenFeedPagedStore;
      if (!store) return;
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
      const wrap = document.getElementById('imageGenFeed');
      if (!wrap || !imageGenFeedHasMorePages()) {
        if (imageGenFeedPageIo) {
          imageGenFeedPageIo.disconnect();
          imageGenFeedPageIo = null;
        }
        return;
      }
      const scrollEl = resolveImageGenFeedScrollRoot(wrap) || wrap;
      imageGenFeedScrollEl = scrollEl;
      const sentinel = ensureImageGenFeedSentinel(wrap);
      if (!sentinel) return;
      if (imageGenFeedPageIo) imageGenFeedPageIo.disconnect();
      const root = scrollEl === wrap ? null : scrollEl;
      imageGenFeedPageIo = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        loadNextImageGenFeedPage();
      }, { root, rootMargin: '520px 0px', threshold: 0 });
      imageGenFeedPageIo.observe(sentinel);
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
          if (!el || el.scrollTop < 48) return;
          if (el.scrollTop + el.clientHeight < el.scrollHeight - 150) return;
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
      if (!feedAppend && !opts.force && shouldDeferImageGenFeedRender()) {
        clearTimeout(imageGenFeedDeferredRenderTimer);
        imageGenFeedDeferredRenderTimer = setTimeout(() => {
          imageGenFeedDeferredRenderTimer = null;
          void renderImageGenFeed({ ...opts, force: true });
        }, Math.max(120, imageGenFeedUserScrollingUntil - Date.now()));
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
        d().prunePendingJobsWithWarehouseCards?.();
      }
      const sig = imageGenFeedListSignature();
      const prevStore = imageGenFeedPagedStore;
      if (!feedAppend && prevStore?.sig === sig && !opts.force) {
        return;
      }
      if (!feedAppend) {
        if (opts.scrollToTop === true) imageGenFeedScrollIntent = false;
        const whCards = d().getImageGenFeedTab?.() === 'warehouse' ? getImageGenWarehouseFeedList() : [];
        const commPosts = d().getImageGenFeedTab?.() === 'community' ? getImageGenCommunityFeedList() : [];
        const pending = (d().getImageGenPendingJobs?.() ?? []).slice(0, d().IMAGEGEN_FEED_PENDING_CAP ?? 6);
        const failed = (d().getImageGenFailedJobs?.() ?? []).slice(0, d().IMAGEGEN_FEED_FAILED_CAP ?? 4);
        if (
          prevStore
          && prevStore.sig !== sig
          && d().getImageGenFeedTab?.() === 'warehouse'
          && warehouseCardsListUnchanged(prevStore.whCards, whCards)
        ) {
          imageGenFeedPagedStore = { ...prevStore, sig, whCards, commPosts };
          patchImageGenFeedPendingSection(wrap, pending, failed);
          bindImageGenFeedImageRelayout();
          if (d().isMobileFeedViewport?.()) enforceMobileImageGenFeed();
          else scheduleImageGenFeedLayout();
          const pageItems = store.whCards.slice(0, IMAGEGEN_FEED_PER_PAGE);
          primeImageGenFeedImages(wrap, pageItems);
          if (scrollState) scheduleImageGenFeedScrollRestore(wrap, scrollState);
          else if (scrollAnchor) restoreImageGenFeedScrollAnchor(scrollAnchor);
          else if (scrollEl && preserveScroll) scrollEl.scrollTop = scrollTop;
          syncImageGenFeedLoadMoreBtn();
          bindImageGenFeedPagedScroll();
          return;
        }
        const prependedCard = warehousePrependedOneCard(prevStore?.whCards, whCards);
        if (prevStore && prependedCard && d().getImageGenFeedTab?.() === 'warehouse' && !opts.force) {
          imageGenFeedPagedStore = { ...prevStore, sig, whCards, commPosts };
          patchImageGenFeedPendingSection(wrap, pending, failed);
          const temp = document.createElement('div');
          temp.innerHTML = warehouseCardToFeedHtml(prependedCard);
          const newCard = temp.firstElementChild;
          if (newCard) {
            const firstWh = wrap.querySelector('.imagegen-feed-card[data-feed-id^="wh_"]');
            wrap.insertBefore(newCard, firstWh || wrap.querySelector('.grid-sizer') || wrap.firstChild);
            bindImageGenFeedCardEvents(wrap, [newCard]);
          }
          bindImageGenFeedImageRelayout();
          if (scrollState) wrap.__phIgPendingScrollState = scrollState;
          if (d().isMobileFeedViewport?.()) enforceMobileImageGenFeed();
          else scheduleImageGenFeedLayout();
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
          })();
          return;
        }
        imageGenFeedPagedStore = {
          sig,
          page: 1,
          whCards,
          commPosts
        };
      } else if (!imageGenFeedPagedStore || imageGenFeedPagedStore.sig !== sig) {
        return;
      }
      const store = imageGenFeedPagedStore;
  
      let html = '';
      let appendHtml = '';
      if (d().getImageGenFeedTab?.() === 'warehouse') {
        if (!feedAppend) {
          const pending = (d().getImageGenPendingJobs?.() ?? []).slice(0, d().IMAGEGEN_FEED_PENDING_CAP ?? 6);
          const failed = (d().getImageGenFailedJobs?.() ?? []).slice(0, d().IMAGEGEN_FEED_FAILED_CAP ?? 4);
          const list = store.whCards.slice(0, IMAGEGEN_FEED_PER_PAGE);
          if (!pending.length && !failed.length && !list.length) {
            html = '<p class="imagegen-feed-empty">卡藏暂无卡片<br><button type="button" class="btn btn-primary btn-sm" onclick="createNewCard({forceOpenPanel:true})">新建卡片</button></p>';
          } else {
            html = pending.map((j) => buildFeedPendingCardHtml(j)).join('')
              + failed.map((j) => buildFeedFailedCardHtml(j)).join('')
              + list.map((c) => warehouseCardToFeedHtml(c)).join('');
          }
        } else {
          const start = (store.page - 1) * IMAGEGEN_FEED_PER_PAGE;
          const slice = store.whCards.slice(start, start + IMAGEGEN_FEED_PER_PAGE);
          if (!slice.length) return;
          appendHtml = slice.map((c) => warehouseCardToFeedHtml(c)).join('');
        }
      } else if (d().getImageGenFeedTab?.() === 'community') {
        if (!feedAppend) {
          const list = store.commPosts.slice(0, IMAGEGEN_FEED_PER_PAGE);
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
        else layoutImageGenFeedMasonry();
        if (scrollState) {
          if (!feedAppend) wrap.__phIgPendingScrollState = scrollState;
          scheduleImageGenFeedScrollRestore(wrap, scrollState);
        } else if (scrollEl) {
          if (scrollAnchor) restoreImageGenFeedScrollAnchor(scrollAnchor);
          else scrollEl.scrollTop = scrollTop;
        }
      } else {
        resetImageGenFeedCardLayout();
        d().setFeedLayoutPending?.(wrap, true);
        wrap.className = mobileFeed
          ? 'imagegen-feed imagegen-feed--tiles mobile-feed-grid feed-layout-pending'
          : 'imagegen-feed imagegen-feed--masonry feed-layout-pending';
        wrap.innerHTML = html;
        bindImageGenFeedCardEvents(wrap);
        bindImageGenFeedImageRelayout();
        if (mobileFeed) {
          enforceMobileImageGenFeed();
          d().setFeedLayoutPending?.(wrap, false);
        } else {
          if (scrollState) wrap.__phIgPendingScrollState = scrollState;
          layoutImageGenFeedMasonry();
        }
        if (scrollState) scheduleImageGenFeedScrollRestore(wrap, scrollState);
        else if (scrollEl) {
          if (scrollAnchor) restoreImageGenFeedScrollAnchor(scrollAnchor);
          else scrollEl.scrollTop = scrollTop;
        }
        d().renderImageGenMobileResult?.();
      }

      const pageStart = feedAppend ? (store.page - 1) * IMAGEGEN_FEED_PER_PAGE : 0;
      const pageEnd = feedAppend ? store.page * IMAGEGEN_FEED_PER_PAGE : IMAGEGEN_FEED_PER_PAGE;
      const feedItems = d().getImageGenFeedTab?.() === 'warehouse'
        ? store.whCards.slice(pageStart, pageEnd)
        : store.commPosts.slice(pageStart, pageEnd).map((p) => ({
          id: p.id,
          image: p.image,
          authorId: p.authorId
        }));
      const feedPrefetchItems = feedItems.slice(0, Math.min(feedItems.length, 16));
      const feedImageBindKey = feedItems.map((x) => `${x.id}:${x.image || ''}`).join('|');

      if (!feedAppend && d().getImageGenFeedTab?.() === 'warehouse' && feedPrefetchItems.length) {
        primeImageGenFeedImages(wrap, feedPrefetchItems);
      }

      syncImageGenFeedLoadMoreBtn();
      bindImageGenFeedPagedScroll();

      void (async () => {
        const skipImageBind = !feedAppend && wrap.dataset.feedImageBindKey === feedImageBindKey;
        if (!skipImageBind) {
          wrap.dataset.feedImageBindKey = feedImageBindKey;
          const prefetchP = d().getImageGenFeedTab?.() === 'warehouse' && feedPrefetchItems.length && window.MediaPipeline?.prefetchList
            ? window.MediaPipeline.prefetchList(feedPrefetchItems, 1800)
            : Promise.resolve();
          void prefetchP.catch(() => {});
          if (window.CardImageLoader?.bindFeed) {
            void window.CardImageLoader.bindFeed(wrap, feedPrefetchItems);
          }
        }
        bindImageGenFeedImageRelayout();
        if (mobileFeed) {
          enforceMobileImageGenFeed();
          d().setFeedLayoutPending?.(wrap, false);
        } else {
          layoutImageGenFeedMasonry();
        }
        window.MediaPipeline?.patchContainerFromCache?.(wrap, { visibleFirst: true, max: 28 });
        window.CardImageLoader?.boostImageGenWarehouseImages?.(wrap, 32);
        if (scrollState) scheduleImageGenFeedScrollRestore(wrap, scrollState);
        else {
          const anchorAfter = scrollAnchor || { scrollTop, scrollEl };
          restoreImageGenFeedScrollAnchor(anchorAfter);
        }
        delete wrap.__phIgPendingScrollState;
        d().scrubImageGenFeedCards?.(wrap);
        syncImageGenFeedLoadMoreBtn();
        if (d().getImageGenFeedTab?.() === 'warehouse' && store.whCards.length && window.SupabaseSync?.backfillGridThumbsForCards) {
          const visibleIds = new Set(
            [...wrap.querySelectorAll('.imagegen-feed-card[data-feed-id^="wh_"]')]
              .slice(0, 14)
              .map((el) => el.dataset.feedId?.replace(/^wh_/, ''))
              .filter(Boolean)
          );
          const backfillCards = store.whCards.filter((c) => visibleIds.has(String(c.id)));
          if (backfillCards.length) {
            void window.SupabaseSync.backfillGridThumbsForCards(backfillCards, {
              max: 12,
              force: false,
              quiet: true,
              awaitDrain: false
            }).then(() => {
              window.MediaPipeline?.patchContainerFromCache?.(wrap, { visibleFirst: true, max: 28 });
              window.CardImageLoader?.boostImageGenWarehouseImages?.(wrap, 32);
              d().updateImageGenFeedHint?.();
            });
          }
        }
      })();
    }
  
    function bindImageGenFeedCardEvents(wrap, cardsOnly) {
      if (!wrap) return;
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
        const feedKind = d().getImageGenFeedTab?.() === 'warehouse' ? 'warehouse' : 'community';
        const feedItemId = feedKind === 'warehouse'
          ? (feedId.startsWith('wh_') ? feedId.slice(3) : feedId)
          : feedId;
        card.querySelector('.imagegen-feed-thumb-btn')?.addEventListener('click', (e) => {
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
        card.querySelectorAll('[data-feed-download]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const img = card.querySelector('.imagegen-feed-media img');
            void d().downloadImageGenFeedItem?.(feedKind, feedItemId, img, btn);
          });
        });
        card.querySelector('[data-delete-feed]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (feedKind === 'warehouse' && typeof window.deleteCardPermanently === 'function') {
            window.deleteCardPermanently(feedItemId, true);
          }
        });
        card.addEventListener('click', e => {
          if (e.target.closest('.imagegen-feed-like')) return;
          if (e.target.closest('.imagegen-feed-thumb-btn')) return;
          if (e.target.closest('.imagegen-feed-save-btn')) return;
          if (e.target.closest('[data-delete-feed]')) return;
          if (e.target.closest('[data-feed-download]')) return;
          if (e.target.closest('.imagegen-feed-mobile-actions')) return;
          if (e.target.closest('.imagegen-feed-media')) {
            void d().openImageGenLightboxAt?.(feedKind, feedItemId, feedId);
            return;
          }
          if (window.MobileUI?.isMobile?.()) return;
          if (d().getImageGenFeedTab?.() === 'warehouse') {
            d().openImageGenPreview?.('warehouse', feedItemId);
          } else if (d().getImageGenFeedTab?.() === 'community') {
            d().openImageGenPreview?.('community', feedId);
          }
        });
        card.querySelector('.imagegen-feed-like')?.addEventListener('click', e => {
          e.stopPropagation();
          d().likeCommunityPostOnly?.(feedId);
        });
      });
    }

  function init(injected) {
    deps = injected || {};
    return {
      IMAGEGEN_FEED_PER_PAGE,
      layoutImageGenFeedMasonry,
      scheduleImageGenFeedLayout,
      resetImageGenFeedCardLayout,
      bindImageGenFeedImageRelayout,
      enforceMobileImageGenFeed,
      resetMobileFeedGridStyles: enforceMobileImageGenFeed,
      buildFeedCardHtml,
      buildFeedPendingCardHtml,
      buildFeedFailedCardHtml,
      feedImgStorageAttr,
      getImageGenWarehouseFeedList,
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
      imageGenFeedIsNearTop
    };
  }

  global.ImageGenFeed = { init };
})(typeof window !== 'undefined' ? window : globalThis);

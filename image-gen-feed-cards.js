/**
 * Card HTML builders for the image generation feed.
 */
(function (global) {
  'use strict';

  function create(options) {
    const getDeps = options?.getDeps || (() => ({}));
    const feedImgStorageAttr = options?.feedImgStorageAttr || (() => '');
    const resolveFeedCardDisplay = options?.resolveFeedCardDisplay || ((title, prompt) => ({
      showTitle: (title || '').trim(),
      showPrompt: (prompt || '').trim()
    }));

    function d() { return getDeps() || {}; }

    function feedEsc(value) {
      return typeof d().esc === 'function'
        ? d().esc(value)
        : String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
    }

    function normalizeFeedRefImages(refImage, refImages) {
      const refs = [];
      const add = (ref) => {
        const value = String(ref || '').trim();
        if (!value || !d().isDisplayableImage?.(value) || refs.includes(value)) return;
        refs.push(value);
      };
      if (Array.isArray(refImages)) refImages.forEach(add);
      add(refImage);
      return refs;
    }

    function feedRefAttrs(refs) {
      if (!refs?.length) return '';
      return ` data-feed-ref="${feedEsc(refs[0])}" data-feed-refs="${feedEsc(JSON.stringify(refs))}"`;
    }

    function readFeedCardRefImages(card) {
      const refs = [];
      const add = (ref) => {
        const value = String(ref || '').trim();
        if (!value || !d().isDisplayableImage?.(value) || refs.includes(value)) return;
        refs.push(value);
      };
      try {
        const parsed = card?.dataset.feedRefs ? JSON.parse(card.dataset.feedRefs) : null;
        if (Array.isArray(parsed)) parsed.forEach(add);
      } catch (e) { /* ignore malformed dataset */ }
      add(card?.dataset.feedRef);
      return refs;
    }

    function buildFeedCardHtml(opts) {
      const {
        id, prompt, image, jobId, title, badges = [], metaLine = '', meta = '', active = false,
        showLike = false, liked = false, likeCount = 0, showSave = false, showDel = false,
        sourceCardId = '', thumbCachedUrl = '', refImage = '', refImages = null
      } = opts;
      const { showTitle, showPrompt } = resolveFeedCardDisplay(title, prompt);
      const storageAttr = feedImgStorageAttr(image);
      const jobAttr = jobId ? ` data-job-id="${d().esc?.(jobId)}"` : '';
      const cardIdAttr = sourceCardId ? ` data-source-card-id="${d().esc?.(sourceCardId)}"` : '';
      const listJobId = jobId ? String(jobId).replace(/#\d+$/, '') : '';
      const isRecentFeed = String(id || '').startsWith('cr_');
      let resolvedThumb = thumbCachedUrl;
      const listUrl = resolvedThumb
        || ((sourceCardId && d().isDisplayableImage?.(image) && global.SupabaseSync?.getListDisplayImageSrc)
          ? global.SupabaseSync.getListDisplayImageSrc(image, sourceCardId, listJobId
            ? { jobId: listJobId, allowFullFallback: isRecentFeed }
            : { allowFullFallback: isRecentFeed })
          : '');
      if (!listUrl && isRecentFeed && sourceCardId && global.SupabaseSync?.getCachedDisplayUrl) {
        const fullCached = global.SupabaseSync.getCachedDisplayUrl(image, {
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
      const feedRefs = normalizeFeedRefImages(refImage || (hasDisplayableRef ? image : ''), refImages);
      const ephemeralRecentRef = isRecentFeed
        && global.SupabaseSync?.isEphemeralUpstreamImageUrl?.(image);
      const imgSrc = ephemeralRecentRef
        ? d().IMG_LOADING_PLACEHOLDER
        : resolvedListUrl || (hasDisplayableRef ? d().IMG_LOADING_PLACEHOLDER : '');
      const imgPending = hasDisplayableRef
        && (ephemeralRecentRef || !resolvedListUrl || imgSrc.includes('data:image/svg'));
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
      const saveBtn = showSave
        ? '<button type="button" class="imagegen-feed-quick-btn imagegen-feed-save-btn" data-save-feed="1">存入库</button>'
        : '';
      const delBtn = showDel
        ? '<button type="button" class="imagegen-feed-del imagegen-feed-card-del" data-delete-feed="1" title="删除" aria-label="删除">×</button>'
        : '';
      const titleHtml = showTitle
        ? `<p class="imagegen-feed-title">${d().esc?.(showTitle)}</p>`
        : '';
      const promptHtml = showPrompt
        ? `<p class="imagegen-feed-prompt">${d().esc?.(showPrompt)}</p>`
        : '<p class="imagegen-feed-prompt imagegen-feed-prompt--empty">暂无提示词</p>';
      const noMedia = !imgBlock ? ' imagegen-feed-card--no-media' : '';
      const quickActions = `<div class="imagegen-feed-quick-actions imagegen-feed-action-grid" aria-label="生图快捷操作">
            <button type="button" class="imagegen-feed-quick-btn imagegen-feed-quick-btn--primary" data-feed-fill-gen>填入生图</button>
            ${saveBtn}
          </div>`;
      const footHtml = metaHtml
        ? `<div class="imagegen-feed-foot">
            ${metaHtml}
          </div>`
        : '';
      const actionStack = `<div class="imagegen-feed-action-stack">
          ${quickActions}
          ${footHtml}
        </div>`;
      return `<article class="imagegen-feed-card imagegen-feed-card-tile${noMedia}${active ? ' active' : ''}" data-feed-id="${d().esc?.(id)}" data-feed-prompt="${d().esc?.(prompt || '')}"${feedRefAttrs(feedRefs)} tabindex="0">
        ${delBtn}
        ${imgBlock}
        <div class="imagegen-feed-content">
          ${titleHtml}
          ${promptHtml}
          ${metaRowHtml}
          ${actionStack}
        </div>
      </article>`;
    }

    function creationToFeedHtml(c) {
      const titleTrim = (c.title || '').trim();
      const model = (c.modelLabel || d().imageGenModelLabel?.(c.model) || c.model || '').trim();
      const galleryN = Array.isArray(c.cardImages) ? c.cardImages.length
        : (Array.isArray(c.mjGridUrls) ? c.mjGridUrls.length : 0);
      const mjBadge = c.isMidjourney && galleryN > 1 ? `MJ·${galleryN}` : '';
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
        refImage: image,
        refImages: image ? [image] : null,
        title: titleTrim,
        metaLine,
        meta: '',
        showDel: true,
        showSave: true
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
        refImage: p.refImage,
        refImages: p.refImages,
        title: useTitle,
        metaLine: `${author} · ${model}`,
        meta: `♥ ${p.likes || 0} · ${d().formatTime?.(p.createdAt)}`,
        showSave: true,
        showLike: false,
        liked: d().getLikedIds?.()?.has(p.id),
        likeCount: p.likes || 0
      });
    }

    return {
      buildFeedCardHtml,
      communityPostToFeedHtml,
      creationToFeedHtml,
      normalizeFeedRefImages,
      readFeedCardRefImages,
      warehouseCardToFeedHtml
    };
  }

  global.ImageGenFeedCards = { create };
})(typeof window !== 'undefined' ? window : globalThis);

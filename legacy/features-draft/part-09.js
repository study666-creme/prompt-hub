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
      if (kind === 'recent') {
        const c = findCreationById(itemId);
        if (c?.image) {
          toast('正在准备下载…', 2500);
          const url = await resolveImageDisplayUrl(
            c.image,
            c.jobId || '',
            c.id,
            { preferFull: true }
          );
          if (url) {
            await window.promptHubSaveImage?.(url, `prompt-hub-recent-${itemId}.png`, imgEl);
            toast('下载完成');
            return;
          }
        }
      } else if (kind === 'warehouse') {
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
          <button type="button" class="btn btn-secondary btn-sm" data-preview-fill-ref${refDisabled}>填入参考图</button>
          <button type="button" class="btn btn-secondary btn-sm" data-preview-regenerate>再次生成</button>
        </div>
      </div>
      ${extraActionsHtml ? `<div class="imagegen-preview-actions-secondary">${extraActionsHtml}</div>` : ''}`;
  }

  /** Feed 卡 data-feed-id 为 wh_ + 卡片 id；恢复卡 id 本身也可能以 wh_ 开头，勿二次 strip */
  function warehouseCardIdFromFeedKey(feedKey) {
    const k = String(feedKey || '');
    return k.startsWith('wh_') ? k.slice(3) : k;
  }

  function findCreationById(creationId) {
    const id = String(creationId || '').trim();
    if (!id) return null;
    return creations.find((c) => c.id === id) || null;
  }

  function findWarehouseCardById(cardId) {
    const id = String(cardId || '').trim();
    if (!id) return null;
    let c = (window.getWarehouseCardsForImageGen?.() || []).find((x) => x.id === id);
    if (c) return c;
    const full = (window.__promptHubCards || []).find((x) => x.id === id);
    if (!full) return null;
    const cover = window.PromptHubCardGallery?.getCardFeedCoverMeta?.(full)
      || { ref: window.PromptHubCardGallery?.getCardFeedCoverImage?.(full) || full.image };
    return {
      id: full.id,
      title: (full.title || '').trim(),
      prompt: (full.prompt || '').trim() || (full.title || '').trim(),
      image: cover.ref || full.image || null,
      feedCoverIndex: cover.galleryIndex ?? 0,
      feedCoverJobId: cover.slotJobId || (full.genJobId ? String(full.genJobId).replace(/#\d+$/, '') : null),
      cardImages: window.PromptHubCardGallery?.normalizeCardGallery?.(full) || null,
      tags: full.tags || [],
      group: full.group || null,
      genJobId: full.genJobId || window.PromptHubCardGallery?.resolveGenJobIdFromCard?.(full) || null,
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
    const fk = feedKey || (kind === 'warehouse' ? 'wh_' + id : (kind === 'recent' ? 'cr_' + id : id));
    const assetId = kind === 'warehouse'
      ? warehouseCardIdFromFeedKey(fk)
      : (kind === 'recent' ? id : id);
    let rawRef = imgEl?.getAttribute?.('data-image-ref') || '';
    let jobId = imgEl?.getAttribute?.('data-job-id') || '';
    let resolveOpts = {};
    if (kind === 'recent') {
      const c = findCreationById(assetId);
      if (c) {
        rawRef = c.image || rawRef;
        jobId = String(c.jobId || jobId).replace(/#\d+$/, '');
      }
      const baseJob = jobId.replace(/#\d+$/, '');
      if (baseJob && window.PromptHubApi?.getGenerationImageUrl) {
        try {
          const r = await window.PromptHubApi.getGenerationImageUrl(baseJob);
          if (r?.ok && r.data?.url) return r.data.url;
        } catch (e) { /* ignore */ }
      }
      if (/^https?:\/\//i.test(rawRef) && !window.SupabaseSync?.isInvalidMediaUrl?.(rawRef)) {
        if (window.PromptHubApi?.fetchMediaAsBlobUrl) {
          try {
            const blobUrl = await window.PromptHubApi.fetchMediaAsBlobUrl(rawRef);
            if (blobUrl) return blobUrl;
          } catch (e) { /* ignore */ }
        }
        return rawRef;
      }
    } else if (kind === 'warehouse') {
      const c = findWarehouseCardById(assetId);
      if (c) {
        rawRef = c.image || rawRef;
        jobId = String(c.feedCoverJobId || c.genJobId || jobId).replace(/#\d+$/, '');
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
    const galleryIndex = kind === 'warehouse'
      ? (findWarehouseCardById(assetId)?.feedCoverIndex ?? 0)
      : null;
    const gridFallbackUrl = window.MediaPipeline?.gridUrlFromImgEl?.(imgEl) || '';
    if (window.MediaPipeline?.resolvePreviewUrl) {
      return window.MediaPipeline.resolvePreviewUrl(rawRef, {
        assetId,
        cardId: resolveOpts.cardId || assetId,
        authorId: resolveOpts.authorId,
        communityFeed: resolveOpts.fromPublicFeed === true,
        jobId: jobId || undefined,
        galleryIndex: galleryIndex != null ? galleryIndex : undefined,
        useJobImageApi: galleryIndex == null || galleryIndex <= 0,
        gridFallbackUrl,
        allowGridFallback: galleryIndex == null || galleryIndex <= 0
      });
    }
    if (window.SupabaseSync?.resolvePreviewFullUrl) {
      return window.SupabaseSync.resolvePreviewFullUrl(rawRef, {
        assetId,
        cardId: resolveOpts.cardId || assetId,
        authorId: resolveOpts.authorId,
        communityFeed: resolveOpts.fromPublicFeed === true,
        jobId: jobId || undefined,
        galleryIndex: galleryIndex != null ? galleryIndex : undefined,
        useJobImageApi: galleryIndex == null || galleryIndex <= 0,
        gridFallbackUrl,
        allowGridFallback: galleryIndex == null || galleryIndex <= 0
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

  function scheduleMjPreviewEnrichment(ctx) {
    const run = () => { void enrichImageGenPreviewMj(ctx); };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 2800 });
    } else {
      setTimeout(run, 160);
    }
  }

  function applyImageGenPreviewMjGrid(body, mjGridUrls, previewCtx) {
    if (!body || !mjGridUrls?.length) return;
    const promptEl = body.querySelector('.imagegen-preview-prompt');
    if (body.querySelector('.imagegen-mj-filmstrip')) {
      bindMjFilmstripPreview(body, mjGridUrls, previewCtx);
      return;
    }
    body.querySelector('.imagegen-preview-img-wrap')?.remove();
    const html = buildMjGridPreviewHtml(mjGridUrls);
    if (promptEl) promptEl.insertAdjacentHTML('beforebegin', html);
    else body.insertAdjacentHTML('afterbegin', html);
    bindMjFilmstripPreview(body, mjGridUrls, previewCtx);
  }

  async function enrichImageGenPreviewMj(ctx) {
    const {
      previewStale, previewCard, mjParentJobId, body, previewId, previewKind
    } = ctx;
    if (previewStale() || !previewCard?.isMidjourney || !mjParentJobId || !body) return;
    let mjGridUrls = window.PromptHubCardGallery?.normalizeCardGallery?.(previewCard)?.filter(Boolean);
    const cachedCount = mjGridUrls?.length || 0;
    if (cachedCount < 2 && window.PromptHubApi?.getGenerationJob) {
      try {
        const poll = await window.PromptHubApi.getGenerationJob(mjParentJobId);
        if (previewStale()) return;
        if (poll?.ok) {
          const parsed = resolveMjPollImages(poll);
          if (parsed.gallery?.length || parsed.tiles.length) {
            mjGridUrls = parsed.gallery?.length ? parsed.gallery : parsed.tiles;
            await repairMjWarehouseCardFields(previewCard, {
              mjGridUrls: parsed.tiles,
              mjCompositeUrl: parsed.composite,
              mjButtons: poll.data.mjButtons
            });
          }
        }
      } catch (e) {
        console.warn('[imagegen] mj grid fetch failed', mjParentJobId, e);
      }
    }
    if (previewStale()) return;
    if (cachedCount < 2) {
      await repairMjGalleryFromJob(previewCard);
      if (previewStale()) return;
      mjGridUrls = window.PromptHubCardGallery?.normalizeCardGallery?.(previewCard)?.filter(Boolean);
    }
    if (!mjGridUrls?.length || mjGridUrls.length < 2) return;
    if (body.querySelector('.imagegen-mj-filmstrip')) {
      bindMjFilmstripPreview(body, mjGridUrls, {
        feedKey: 'wh_' + previewId,
        cardId: previewId,
        parentJobId: mjParentJobId,
        model: previewCard?.model,
        size: previewCard?.size,
        resolution: previewCard?.resolution || '1k'
      });
      return;
    }
    applyImageGenPreviewMjGrid(body, mjGridUrls, {
      feedKey: 'wh_' + previewId,
      cardId: previewId,
      parentJobId: mjParentJobId,
      model: previewCard?.model,
      size: previewCard?.size,
      resolution: previewCard?.resolution || '1k'
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
    } else if (imageGenPreviewKind === 'recent') {
      const c = findCreationById(imageGenPreviewId);
      if (!c) {
        toast('记录不存在或已过期');
        closeImageGenPreview();
        return;
      }
      prompt = c.prompt || '';
      image = c.image || '';
      jobId = normalizeMjParentJobId(c.jobId || '');
      refImages = Array.isArray(c.refImages) ? c.refImages.filter((ref) => isDisplayableImage(ref)) : null;
      refImage = refImages?.[0] || (isDisplayableImage(c.refImage) ? c.refImage : null);
      if (!isCreationLinkedToWarehouse(c)) {
        extraActions = '<button type="button" class="btn btn-primary btn-sm" data-preview-save-warehouse>存入库</button>';
      }
      extraActions += '<button type="button" class="btn btn-ghost btn-sm" data-preview-delete-recent>从最近移除</button>';
    } else {
      const c = findWarehouseCardById(imageGenPreviewId);
      if (!c) {
        toast('找不到该卡藏卡片，请强刷页面');
        closeImageGenPreview();
        return;
      }
      prompt = c.prompt || '';
      image = c.image || '';
      jobId = c.feedCoverJobId || normalizeMjParentJobId(c.genJobId || '')
        || window.PromptHubCardGallery?.resolveGenJobIdFromCard?.(c) || '';
      refImages = Array.isArray(c.refImages) ? c.refImages.filter((ref) => isDisplayableImage(ref)) : null;
      refImage = refImages?.[0] || (isDisplayableImage(c.refImage) ? c.refImage : null);
    }
    const previewCard = imageGenPreviewKind === 'recent'
      ? findCreationById(imageGenPreviewId)
      : (imageGenPreviewKind === 'warehouse'
        ? ((window.__promptHubCards || []).find((x) => x.id === imageGenPreviewId) || findWarehouseCardById(imageGenPreviewId))
        : null);
    let mjGridUrls = imageGenPreviewKind === 'recent' && previewCard
      ? (buildCreationGallery(previewCard).length > 1 ? buildCreationGallery(previewCard) : null)
      : (window.PromptHubCardGallery?.normalizeCardGallery?.(previewCard)?.length
        ? window.PromptHubCardGallery.normalizeCardGallery(previewCard)
        : (Array.isArray(previewCard?.mjGridUrls) && previewCard.mjGridUrls.length
          ? previewCard.mjGridUrls.filter(Boolean)
          : null));
    const mjParentJobId = normalizeMjParentJobId(jobId || previewCard?.genJobId || '');
    const cachedMjButtons = Array.isArray(previewCard?.mjButtons) ? previewCard.mjButtons : null;
    if (!(refImages?.length) && !refImage && isDisplayableImage(image)) {
      refImage = image;
      refImages = [image];
    }
    const hasRef = !!(refImages?.length || (refImage && isDisplayableImage(refImage)));
    const fillHtml = buildPreviewFillActions(hasRef, extraActions);
    const mjActionsHtml = cachedMjButtons?.length
      ? buildMjActionsBlock(cachedMjButtons, mjParentJobId, previewCard)
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
        cardId: previewId,
        parentJobId: mjParentJobId,
        model: previewCard?.model,
        size: previewCard?.size,
        resolution: previewCard?.resolution || '1k'
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

      void (async () => {
        let previewUrl = '';
        if (previewCard && window.MediaPipeline?.resolveCardListThumb) {
          previewUrl = await window.MediaPipeline.resolveCardListThumb(previewCard);
        }
        if (previewStale()) return;
        if (previewUrl) {
          mountPreviewImage(previewUrl, { isFull: false });
          return;
        }
        const url = await resolveImageGenFullUrl(
          previewKind,
          previewId,
          previewKind === 'warehouse' ? 'wh_' + previewId : previewId,
          null
        );
        if (previewStale()) return;
        if (!url) {
          zoomBtn.remove();
          body.querySelector('[data-preview-download]')?.remove();
          return;
        }
        mountPreviewImage(url, { isFull: true });
      })();
    } else {
      body.querySelector('[data-preview-download]')?.remove();
    }
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
      const loadMjButtons = () => {
        void window.PromptHubApi.getGenerationJob(mjParentJobId).then((r) => {
          if (previewStale() || !r.ok || !Array.isArray(r.data?.mjButtons) || !r.data.mjButtons.length) return;
          const host = body.querySelector('[data-mj-actions-host]');
          if (!host) return;
          host.outerHTML = buildMjActionsBlock(r.data.mjButtons, mjParentJobId, previewCard);
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
      };
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(loadMjButtons, { timeout: 3200 });
      } else {
        setTimeout(loadMjButtons, 200);
      }
    }
    if (previewKind === 'warehouse' && previewCard?.isMidjourney && mjParentJobId) {
      const galleryN = mjGridUrls?.length || 0;
      if (galleryN < 2 || !cachedMjButtons?.length) {
        scheduleMjPreviewEnrichment({
          previewStale,
          previewCard,
          mjParentJobId,
          body,
          previewId,
          previewKind
        });
      }
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
    const feedKey = kind === 'warehouse' ? 'wh_' + id : (kind === 'recent' ? 'cr_' + id : id);
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
        renderImageGenFeed({ scrollToTop: true, force: true });
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
    /* 生图页右侧为轻量「最近作品」流，分组/标签筛选仅在 /prompts 完整卡片库 */
    if (bar) bar.classList.add('hidden');
    scheduleImageGenSegmentGliders();
  }

  let imageGenSegmentGliderRaf = 0;
  let imageGenSegmentResizeObserver = null;
  let imageGenSegmentMutationObserver = null;
  let imageGenSegmentWindowBound = false;
  const imageGenSegmentObserved = new WeakSet();
  const IMAGEGEN_SEGMENT_RAILS = '.imagegen-feed-tabs, .imagegen-side .imagegen-community-tabs';

  function getImageGenSegmentGlider(rail) {
    if (!rail) return null;
    let glider = Array.from(rail.children || []).find((el) => el.classList?.contains('imagegen-segment-glider'));
    if (!glider) {
      glider = document.createElement('span');
      glider.className = 'imagegen-segment-glider';
      glider.setAttribute('aria-hidden', 'true');
      rail.insertBefore(glider, rail.firstChild);
    }
    return glider;
  }

  function syncImageGenSegmentRail(rail) {
    const glider = getImageGenSegmentGlider(rail);
    if (!rail || !glider) return;
    const active = rail.querySelector('.imagegen-feed-tab.active, .feature-tab.active');
    if (!active) {
      glider.style.opacity = '0';
      return;
    }
    const railRect = rail.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (railRect.width < 1 || activeRect.width < 1 || activeRect.height < 1) {
      glider.style.opacity = '0';
      return;
    }
    if (rail.classList.contains('imagegen-feed-tabs')) {
      const tabs = Array.from(rail.querySelectorAll('.imagegen-feed-tab'));
      const idx = tabs.indexOf(active);
      if (tabs.length > 0 && idx >= 0) {
        const style = getComputedStyle(rail);
        const padLeft = parseFloat(style.paddingLeft) || 0;
        const padRight = parseFloat(style.paddingRight) || 0;
        const padTop = parseFloat(style.paddingTop) || 0;
        const padBottom = parseFloat(style.paddingBottom) || 0;
        const gap = parseFloat(style.columnGap || style.gap) || 0;
        const contentWidth = Math.max(0, rail.clientWidth - padLeft - padRight);
        const slotWidth = Math.max(0, (contentWidth - gap * Math.max(0, tabs.length - 1)) / tabs.length);
        const slotHeight = Math.max(0, rail.clientHeight - padTop - padBottom);
        const left = padLeft + idx * (slotWidth + gap) + rail.scrollLeft;
        const top = padTop + rail.scrollTop;
        glider.style.opacity = '1';
        glider.style.width = `${slotWidth}px`;
        glider.style.height = `${slotHeight}px`;
        glider.style.transform = `translate3d(${left}px, ${top}px, 0)`;
        return;
      }
    }
    const left = activeRect.left - railRect.left + rail.scrollLeft;
    const top = activeRect.top - railRect.top + rail.scrollTop;
    glider.style.opacity = '1';
    glider.style.width = `${activeRect.width}px`;
    glider.style.height = `${activeRect.height}px`;
    glider.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }

  function syncImageGenSegmentGliders() {
    document.querySelectorAll(IMAGEGEN_SEGMENT_RAILS).forEach(syncImageGenSegmentRail);
  }

  function scheduleImageGenSegmentGliders() {
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn) => setTimeout(fn, 0);
    const caf = typeof cancelAnimationFrame === 'function'
      ? cancelAnimationFrame
      : clearTimeout;
    if (imageGenSegmentGliderRaf) caf(imageGenSegmentGliderRaf);
    imageGenSegmentGliderRaf = raf(() => {
      imageGenSegmentGliderRaf = 0;
      syncImageGenSegmentGliders();
    });
  }

  function initImageGenSegmentGliders() {
    const rails = document.querySelectorAll(IMAGEGEN_SEGMENT_RAILS);
    if (!rails.length) return;
    if (!imageGenSegmentResizeObserver && window.ResizeObserver) {
      imageGenSegmentResizeObserver = new ResizeObserver(scheduleImageGenSegmentGliders);
    }
    if (!imageGenSegmentMutationObserver && window.MutationObserver) {
      imageGenSegmentMutationObserver = new MutationObserver(scheduleImageGenSegmentGliders);
    }
    rails.forEach((rail) => {
      getImageGenSegmentGlider(rail);
      if (!imageGenSegmentObserved.has(rail)) {
        imageGenSegmentObserved.add(rail);
        rail.addEventListener('scroll', scheduleImageGenSegmentGliders, { passive: true });
        rail.addEventListener('click', scheduleImageGenSegmentGliders);
        imageGenSegmentResizeObserver?.observe(rail);
        imageGenSegmentMutationObserver?.observe(rail, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
        const wrapper = rail.closest('.imagegen-community-filters, .imagegen-side');
        if (wrapper && !imageGenSegmentObserved.has(wrapper)) {
          imageGenSegmentObserved.add(wrapper);
          imageGenSegmentMutationObserver?.observe(wrapper, { attributes: true, attributeFilter: ['class'] });
        }
      }
      Array.from(rail.children || []).forEach((child) => {
        if (child.classList?.contains('imagegen-segment-glider')) return;
        imageGenSegmentResizeObserver?.observe(child);
      });
    });
    if (!imageGenSegmentWindowBound) {
      imageGenSegmentWindowBound = true;
      window.addEventListener('resize', scheduleImageGenSegmentGliders);
    }
    scheduleImageGenSegmentGliders();
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
      : (imageGenPreviewKind === 'recent' ? 'cr_' + imageGenPreviewId : imageGenPreviewId);
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
    const feedKey = key || (kind === 'warehouse' ? 'wh_' + id : (kind === 'recent' ? 'cr_' + id : id));
    const card = document.querySelector(`.imagegen-feed-card[data-feed-id="${CSS.escape(feedKey)}"]`);
    const imgEl = card?.querySelector('.imagegen-feed-thumb-btn img');
    const assetId = kind === 'warehouse'
      ? warehouseCardIdFromFeedKey(feedKey)
      : (kind === 'recent' ? id : feedKey);
    let mjGalleryUrls = null;
    let galleryJobId = null;
    if (kind === 'recent' && assetId) {
      const cre = findCreationById(assetId);

        if (url && window.CardImageLoader?.applyUrlToImg?.(img, url)) {
          media?.classList.remove('card-media--load-failed', 'card-media--await');
          card.image = ref;
          window.PromptHubCardGallery?.syncCardGalleryFields?.(card);
          return true;
        }
      }
      return false;
    }

    function markCardImageLoadFailed(img) {
      const media = img?.closest('.card-media');
      if (!media) return;
      if (img?.dataset?.feedLoadDone === '1' && img.complete && img.naturalWidth > 0) return;
      const card = img.closest('.card[data-id]');
      const inWarehouse = !!card?.closest('#cardsContainer');
      if (inWarehouse) {
        const cardId = card?.dataset?.id;
        const cardModel = cardId ? cards.find((c) => c.id === cardId) : null;
        const collectOpts = cardModel ? getCommunityCollectImageResolveOpts(cardModel) : null;
        if (!collectOpts) {
          if (cardModel) {
            const tryGenRecover = async () => {
              if (cardModel.genJobId && window.WarehouseThumb?.resolveForCardModel) {
                window.SupabaseSync?.clearPathMissingForCard?.(cardModel.id, cardModel.image);
                const wh = await window.WarehouseThumb.resolveForCardModel(cardModel);
                if (wh && window.CardImageLoader?.applyUrlToImg?.(img, wh)) return true;
              }
              return tryWarehouseGalleryListCover(img, cardModel, media);
            };
            void tryGenRecover().then((ok) => {
              if (!ok) finalizeWarehouseCardMediaFailure(media, img);
            });
            return;
          }
          finalizeWarehouseCardMediaFailure(media, img);
          return;
        }
        if (img.dataset.warehouseFinalFail === '1') {
          finalizeWarehouseCardMediaFailure(media, img);
          return;
        }
        img.dataset.warehouseFinalFail = '1';
        const ref = img.getAttribute('data-image-ref');
        void (async () => {
          if (!ref) {
            finalizeWarehouseCardMediaFailure(media, img);
            return;
          }
          try {
            window.SupabaseSync.invalidateSignedCacheForRef?.(ref, cardId);
            const url = window.MediaPipeline?.resolveListUrl
              ? await window.MediaPipeline.resolveListUrl(ref, {
                assetId: cardId,
                cardId,
                authorId: collectOpts.authorId,
                communityFeed: collectOpts.communityFeed === true,
                tryAllPaths: true
              })
              : await window.SupabaseSync.resolveDisplayUrl(ref, {
                ...collectOpts,
                variant: window.SupabaseSync.VARIANT_GRID || 'grid',
                tryAllPaths: true,
                listOnly: true,
                allowFullFallback: false,
                degradedListFull: false
              });
            if (url && window.CardImageLoader?.applyUrlToImg?.(img, url)) {
              delete img.dataset.warehouseFinalFail;
              media.classList.remove('card-media--load-failed', 'card-media--await');
              scheduleWarehouseMasonryForCard(cardId);
              return;
            }
          } catch (e) { /* ignore */ }
          finalizeWarehouseCardMediaFailure(media, img);
        })();
        return;
      }
      media.classList.remove('is-loading');
      media.remove();
      scheduleMasonryForMedia(card || media);
    }

    async function handleCardImageError(img) {
      if (!img) {
        return;
      }
      const cardId = img.closest('.card[data-id]')?.dataset?.id;
      const ref = img.getAttribute('data-image-ref');
      if (ref && img.dataset.resignTried !== '1') {
        img.dataset.resignTried = '1';
        window.SupabaseSync?.invalidateSignedCacheForRef?.(ref, cardId);
        const cardModel = cards.find((c) => c.id === cardId);
        const collectOpts = cardModel ? getCommunityCollectImageResolveOpts(cardModel) : null;
        try {
          const url = window.MediaPipeline?.resolveListUrl
            ? await window.MediaPipeline.resolveListUrl(ref, collectOpts ? {
              assetId: cardId,
              cardId,
              authorId: collectOpts.authorId,
              communityFeed: collectOpts.communityFeed === true,
              tryAllPaths: true
            } : {
              assetId: cardId,
              cardId,
              tryAllPaths: false
            })
            : await window.SupabaseSync?.resolveDisplayUrl?.(ref, collectOpts ? {
              ...collectOpts,
              variant: window.SupabaseSync.VARIANT_GRID || 'grid',
              tryAllPaths: true,
              listOnly: true,
              allowFullFallback: false,
              degradedListFull: false
            } : {
              assetId: cardId,
              variant: window.SupabaseSync.VARIANT_GRID || 'grid',
              tryAllPaths: false,
              listOnly: true,
              allowFullFallback: false,
              degradedListFull: window.SupabaseSync?.needsDegradedListPreview?.(ref, cardId) === true
            });
          if (url && /^https?:\/\//i.test(url) && !String(url).includes('data:image/svg')) {
            const safeUrl = window.SupabaseSync?.safeListImgUrl?.(url, img) || '';
            const media = img.closest('.card-media');
            if (media) media.classList.remove('card-media--load-failed');
            if (safeUrl && window.CardImageLoader?.applyUrlToImg?.(img, safeUrl)) return;
            if (safeUrl && img.closest('#cardsContainer')) {
              img.onerror = () => markCardImageLoadFailed(img);
              img.src = safeUrl;
              return;
            }
            if (!safeUrl && img.closest('#cardsContainer, #imageGenFeed')) {
              markCardImageLoadFailed(img);
              return;
            }
          }
          if (!collectOpts && cardModel && img.closest('#cardsContainer')) {
            markCardImageLoadFailed(img);
            return;
          }
        } catch (e) { /* ignore */ }
      }
      if (img.dataset.repairTried === '1') {
        markCardImageLoadFailed(img);
        return;
      }
      if (!cardId) {
        markCardImageLoadFailed(img);
        return;
      }
      img.dataset.repairTried = '1';
      try {
        const backup = await getCardImageBackup(cardId);
        if (backup && String(backup).startsWith('data:')) {
          img.onerror = () => markCardImageLoadFailed(img);
          img.src = backup;
          return;
        }
        const card = cards.find((c) => c.id === cardId);
        if (card?.image && window.SupabaseSync?.repairCardImageIfMissing) {
          const fixed = await window.SupabaseSync.repairCardImageIfMissing(cardId, card.image);
          if (fixed && fixed !== card.image) {
            card.image = fixed;
            await saveAllData({ skipCloud: true });
            scheduleCloudPush();
            const url = await window.SupabaseSync.resolveDisplayUrl?.(fixed, {
              assetId: cardId,
              variant: window.SupabaseSync.VARIANT_GRID || 'grid',
              listOnly: true,
              allowFullFallback: false
            });
            const safeUrl = window.SupabaseSync?.safeListImgUrl?.(url, img) || '';
            if (safeUrl && !String(safeUrl).includes('data:image/svg')) {
              if (window.CardImageLoader?.applyUrlToImg?.(img, safeUrl)) return;
            }
          }
        }
      } catch (e) {
        console.warn('[cards] image repair failed', cardId, e);
      }
      markCardImageLoadFailed(img);
    }

    function bindCardGridImageErrors(root) {
      root?.querySelectorAll('.card-img').forEach((img) => {
        if (img.dataset.errBound) return;
        img.dataset.errBound = '1';
        img.addEventListener('error', () => { void handleCardImageError(img); });
      });
    }

    function isPlaceholderCardImg(img) {
      const src = img?.currentSrc || img?.src || '';
      return !src || (typeof src === 'string' && src.includes('data:image/svg'));
    }

    function clearMediaShineWatchdog(media) {
      if (!media?.__shineWatch) return;
      clearTimeout(media.__shineWatch);
      media.__shineWatch = null;
    }

    function armMediaShineWatchdog(media, timeoutMs) {
      if (!media) return;
      clearMediaShineWatchdog(media);
      const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : 14000;
      media.__shineWatch = setTimeout(() => {
        media.__shineWatch = null;
        const inWhList = !!media.closest('#cardsContainer:not(.list-view) .card.card--visual');
        const awaiting = media.classList.contains('is-loading')
          || (inWhList && media.classList.contains('card-media--await') && !media.classList.contains('media-revealed'));
        if (!awaiting) return;
        const im = media.querySelector('img');
        const loaded = im && im.complete && im.naturalWidth > 0 && !isPlaceholderCardImg(im);
        if (loaded || im?.dataset?.feedLoadDone === '1') {
          finishCardMediaShine(media);
          return;
        }
        const whCard = media.closest('#cardsContainer .card.card--visual');
        if (whCard) {
          finalizeWarehouseCardMediaFailure(media, im);
          return;
        }
        const visualCard = media.closest('#communityGrid .community-post-card--visual');
        if (visualCard) {
          visualCard.remove();
          return;
        }
        media.classList.remove('is-loading', 'media-shine-reveal');
        media.classList.add('media-revealed');
        if (im) {
          im.style.visibility = 'visible';
          im.style.opacity = '1';
        }
      }, ms);
    }

    function finishCardMediaShine(media) {
      if (!media) return;
      const igMedia = media.classList?.contains('imagegen-feed-media')
        ? media
        : media.closest?.('.imagegen-feed-media');
      if (igMedia?.closest('#imageGenFeed')) {
        clearMediaShineWatchdog(igMedia);
        igMedia.classList.remove('is-loading', 'card-media--await', 'media-shine-reveal');
        const igImg = igMedia.querySelector('img');
        if (igImg) {
          igImg.style.removeProperty('opacity');
          igImg.style.removeProperty('visibility');
        }
        if (!isMobileViewport()) {
          window.repairImageGenFeedLayout?.()
            || window.FeatureDraft?.scheduleImageGenFeedLayout?.({ immediate: true });
        } else {
          window.FeatureDraft?.resetMobileFeedGridStyles?.();
        }
        return;
      }
      const mobile = isMobileViewport();
      const sideBtn = media.classList?.contains('community-side-img-btn')
        ? media
        : media.closest?.('.community-side-img-btn');
      const shineTarget = sideBtn || media;
      const img = shineTarget.querySelector('img');
      const loaded = img && img.complete && img.naturalWidth > 0 && !isPlaceholderCardImg(img);
      if (!loaded) {
        const inWarehouse = media.closest('#cardsContainer');
        if (inWarehouse && isPlaceholderCardImg(img)) {
          armMediaShineWatchdog(shineTarget, 22000);
          window.CardImageLoader?.loadImg?.(img);
          return;
        }
        armMediaShineWatchdog(shineTarget);
        return;
      }
      clearMediaShineWatchdog(shineTarget);
      const cardEl = media.closest('.card[data-id], .card[data-post-id]');
      const revealKey = img ? (img.currentSrc || img.src || img.dataset.imageRef || '') : '';
      const alreadyRevealed = !sideBtn
        && revealKey
        && media.classList.contains('media-revealed')
        && media.dataset.mediaRevealKey === revealKey;
      shineTarget.classList.remove('is-loading', 'card-media--await');
      if (sideBtn) {
        if (img) {
          img.style.removeProperty('opacity');
          img.style.removeProperty('visibility');
        }
      } else {
        media.classList.remove('is-loading', 'card-media--await');
        media.classList.add('media-revealed');
        if (revealKey) media.dataset.mediaRevealKey = revealKey;
        if (!alreadyRevealed) {
          media.classList.remove('media-shine-reveal');
          void media.offsetWidth;
        }
        if (!alreadyRevealed && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          const cardId = cardEl?.dataset?.id || cardEl?.dataset?.postId || '';
          let stagger = 0;
          for (let i = 0; i < cardId.length; i++) stagger = (stagger + cardId.charCodeAt(i) * 13) % 200;
          setTimeout(() => {
            media.classList.add('media-shine-reveal');
            setTimeout(() => media.classList.remove('media-shine-reveal'), 1250);
          }, stagger);
        }
        media.style.removeProperty('min-height');
      }
      if (cardEl?.dataset?.id && !alreadyRevealed) {
        try { sessionStorage.setItem('ph_card_shine_' + cardEl.dataset.id, '1'); } catch (e) { /* ignore */ }
      }
      if (!mobile && !alreadyRevealed) {
        if (sideBtn) { /* 侧栏不参与 Masonry */ }
        else if (media.closest('#creationsGrid')) {
          window.FeatureDraft?.scheduleCommunityLayout?.('creationsGrid', { fromImage: true });
        }
        else if (media.closest('#communityGrid')) {
          window.FeatureDraft?.scheduleFeedMasonryRelayout?.('communityGrid');
        }
        else if (media.closest('#cardsContainer')) {
          if (cardMediaAffectsViewport(media) && !shouldSkipWarehouseImageLayout(img, 1100)) {
            const cid = cardEl?.dataset?.id;
            if (cardEl?.dataset?.communityCollect === '1') scheduleWarehouseMasonryForCard(cid);
            else scheduleWarehouseMasonryLayout();
          }
        }
        else scheduleMasonryForMedia(media);
      } else if (media.closest('#imageGenFeed')) window.FeatureDraft?.resetMobileFeedGridStyles?.();
      else if (media.closest('#cardsContainer')) enforceMobileCardGrid();
    }
    window.finishCardMediaShine = finishCardMediaShine;

    let masonryScriptPromise = null;
    function ensureMasonryScript() {
      if (typeof Masonry !== 'undefined') return Promise.resolve();
      if (masonryScriptPromise) return masonryScriptPromise;
      const urls = [
        'vendor/masonry.pkgd.min.js',
        'https://cdn.jsdelivr.net/npm/masonry-layout@4.2.2/dist/masonry.pkgd.min.js',
        'https://unpkg.com/masonry-layout@4.2.2/dist/masonry.pkgd.min.js'
      ];
      masonryScriptPromise = new Promise((resolve, reject) => {
        let i = 0;
        const tryNext = () => {
          if (typeof Masonry !== 'undefined') {
            resolve();
            return;
          }
          if (i >= urls.length) {
            reject(new Error('Masonry load failed'));
            return;
          }
          const s = document.createElement('script');
          s.src = urls[i++];
          s.async = true;
          s.onload = () => resolve();
          s.onerror = tryNext;
          document.head.appendChild(s);
        };
        tryNext();
      });
      return masonryScriptPromise;
    }

    let tesseractScriptPromise = null;
    function ensureTesseractScript() {
      if (typeof Tesseract !== 'undefined') return Promise.resolve();
      if (tesseractScriptPromise) return tesseractScriptPromise;
      tesseractScriptPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Tesseract load failed'));
        document.head.appendChild(s);
      });
      return tesseractScriptPromise;
    }

    function previewFullUrlFromImg(img) {
      if (!img) return '';
      const cached = String(img.dataset?.previewFullUrl || '').trim();
      if (cached && !cached.includes('data:image/svg')) return cached;
      const src = String(img.currentSrc || img.src || '').trim();
      if (!src || src.includes('data:image/svg') || !/^https?:\/\//i.test(src)) return '';
      const path = window.SupabaseSync?.storagePathFromDisplayUrl?.(src) || '';
      if (path && /_grid\.(jpe?g|webp|png)$/i.test(path)) return '';
      if (window.SupabaseSync?.isInvalidMediaUrl?.(src)) return '';
      if (window.SupabaseSync?.isValidSignedDisplayUrl?.(src)) return src;
      if (window.SupabaseSync?.isFreshSignedDisplayUrl?.(src, 120000)) return src;
      return '';
    }

    function listGridUrlForCard(card) {
      if (!card?.id) return '';
      const img = document.querySelector(
        `#cardsContainer .card[data-id="${CSS.escape(card.id)}"] .card-img`
      );
      const src = String(img?.currentSrc || img?.src || '').trim();
      if (!src || src.includes('data:image/svg') || !/^https?:\/\//i.test(src)) return '';
      return src;
    }

    async function openCardImageLightbox(card) {
      window.MobileUI?.markUserInteracting?.(640);
      const full = cards.find((c) => c.id === card?.id) || card;
      const draftGallery = panelDraftGallery.filter(Boolean);
      const gallery = draftGallery.length > 1
        ? draftGallery
        : getEditPanelCardGallery(full);
      if (!full?.image && !gallery.length && !imageData) return;
      if (full.id && full.id !== 'draft') window.syncLightboxActions?.({ cardId: full.id });
      const domGrid = listGridUrlForCard(full);
      const mobileInstant = isMobileViewport() && domGrid && typeof window.openLightbox === 'function';
      const lbBase = { cardId: full.id, preferFull: true, fallbackSrc: domGrid || '' };
      if (gallery.length > 1 && typeof window.openLightbox === 'function') {
        const idx = selectedCardId === full.id ? panelGalleryIndex : 0;
        const ref = gallery[idx] || full.image;
        const lightboxJobId = getEditPanelCardJobId(full);
        const resolve = window.PromptHubCardGallery?.resolveMediaUrl;
        const refIsEphemeral = /^https?:\/\//i.test(ref || '')
          && window.SupabaseSync?.isEphemeralUpstreamImageUrl?.(ref);
        const fallbackRef = isPanelDisplayableImageUrl(ref) && !refIsEphemeral ? ref : '';
        const openWith = (src) => {
          window.openLightbox(src || fallbackRef || '', {
            ...lbBase,
            fallbackSrc: fallbackRef,
            cardGalleryUrls: gallery,
            mjGalleryUrls: gallery,
            cardGalleryIndex: idx,
            mjGalleryIndex: idx,
            cardJobId: lightboxJobId || undefined,
            mjJobId: lightboxJobId || undefined,
            feedKey: `card:${full.id}`
          });
        };
        if (resolve) {
          void resolve(ref, { cardId: full.id, jobId: lightboxJobId || undefined, galleryIndex: idx, preferFull: true }).then(openWith);
        } else {
          openWith(ref);
        }
        return;
      }
      if (!full.image && !imageData) return;
      const primaryImage = full.image || imageData || gallery[0];
      const previewImg = document.getElementById('previewImage');
      const gridFallback = domGrid
        || listGridUrlForCard(full)
        || (previewImg && selectedCardId === full.id ? (previewImg.currentSrc || previewImg.src || '') : '');
      const gridOk = gridFallback && !gridFallback.includes('data:image/svg') && /^https?:\/\//i.test(gridFallback);
      const reuse = previewImg && selectedCardId === full.id ? previewFullUrlFromImg(previewImg) : '';
      if (reuse && typeof window.openLightbox === 'function') {
        window.openLightbox(reuse, {
          cardId: full.id,
          preferFull: true,
          fallbackSrc: gridOk && gridFallback !== reuse ? gridFallback : ''
        });
        return;
      }
      if (mobileInstant) {
        window.openLightbox(domGrid, lbBase);
        void (async () => {
          let url = '';
          try {
            if (window.MediaPipeline?.resolvePreviewUrl) {
              url = await window.MediaPipeline.resolvePreviewUrl(primaryImage, {
                assetId: full.id,
                cardId: full.id,
                jobId: getEditPanelCardJobId(full) || null,
                useJobImageApi: true,
                gridFallbackUrl: domGrid,
                allowGridFallback: true
              });
            }
          } catch (e) { /* ignore */ }
          if (url && url !== domGrid && typeof window.setLightboxSrc === 'function') {
            window.setLightboxSrc(url, { cardId: full.id, preferFull: true, fallbackSrc: domGrid });
          }
        })();
        return;
      }
      if (typeof window.openLightbox === 'function') {
        window.openLightbox('', { pending: true, cardId: full.id, preferFull: true, fallbackSrc: gridOk ? gridFallback : '' });
      }
      let url = '';
      let usedGridFallback = false;
      try {
        if (window.MediaPipeline?.resolvePreviewUrl) {
          url = await window.MediaPipeline.resolvePreviewUrl(primaryImage, {
            assetId: full.id,
            cardId: full.id,
            jobId: getEditPanelCardJobId(full) || null,
            useJobImageApi: true,
            gridFallbackUrl: gridOk ? gridFallback : '',
            allowGridFallback: true
          });
          usedGridFallback = !!(gridOk && url && url === gridFallback);
        } else if (window.SupabaseSync?.resolvePreviewFullUrl) {
          url = await window.SupabaseSync.resolvePreviewFullUrl(primaryImage, {
            assetId: full.id,
            jobId: getEditPanelCardJobId(full) || null,
            useJobImageApi: true,
            gridFallbackUrl: gridOk ? gridFallback : ''
          });
          usedGridFallback = !!(gridOk && url && url === gridFallback);
        } else if (window.SupabaseSync?.resolveCardDownloadUrl) {
          url = await window.SupabaseSync.resolveCardDownloadUrl(primaryImage, {
            assetId: full.id,
            jobId: getEditPanelCardJobId(full) || null
          });
        }
      } catch (e) { /* ignore */ }
      if (!url && gridOk) {
        url = gridFallback;
        usedGridFallback = true;
      }
      if (url && typeof window.setLightboxSrc === 'function') {
        window.setLightboxSrc(url, {
          cardId: full.id,
          preferFull: !usedGridFallback,
          fallbackSrc: gridOk && !usedGridFallback ? gridFallback : ''
        });
        if (usedGridFallback) showToast('原图暂不可用，已显示预览图', 4000);
        return;
      }
      if (typeof window.closeLightbox === 'function') window.closeLightbox();
      showToast('原图加载中，请稍候再试');
    }

    async function hydrateWarehouseBackupsFromIdb(container, list) {
      if (!container || typeof getCardImageBackup !== 'function') return;
      for (const card of (list || []).slice(0, warehousePageSize())) {
        if (!card?.id || !card?.image) continue;
        const img = container.querySelector(`.card[data-id="${card.id}"] .card-img`);
        if (!img) continue;
        const cur = img.currentSrc || img.src || '';
        if (window.SupabaseSync?.isFreshSignedDisplayUrl?.(cur, 60000)) continue;
        try {
          const backup = await getCardImageBackup(card.id);
          if (backup && String(backup).startsWith('data:') && window.CardImageLoader?.applyUrlToImg) {
            window.CardImageLoader.applyUrlToImg(img, backup);
          }
        } catch (e) { /* ignore */ }
      }
    }

    function cardImgInitialSrc(image, cardId, extraOpts) {
      const placeholder = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#25272f"/><stop offset=".55" stop-color="#343740"/><stop offset="1" stop-color="#25272f"/></linearGradient></defs><rect fill="#25272f" width="160" height="120"/><rect fill="url(#g)" width="160" height="120" opacity=".9"/></svg>');
      const jobId = extraOpts?.jobId ? String(extraOpts.jobId).replace(/#\d+$/, '') : undefined;
      const cardModel = cardId ? (window.__promptHubCards || []).find((c) => c.id === cardId) : null;
      const allowFull = !!(extraOpts?.allowFullFallback || jobId || cardModel?.genJobId);
      if (image && cardId && window.SupabaseSync?.getListDisplayImageSrc) {
        const cached = window.SupabaseSync.getListDisplayImageSrc(image, cardId, {
          allowFullFallback: allowFull,
          jobId: jobId || (cardModel?.genJobId ? String(cardModel.genJobId).replace(/#\d+$/, '') : undefined)
        });
        if (cached && cached.startsWith('http') && !cached.includes('data:image/svg')
          && !window.SupabaseSync?.isInvalidMediaUrl?.(cached)
          && (window.SupabaseSync?.isGridDisplayUrl?.(cached) || allowFull)) {
          return cached;
        }
      }
      if (!image || !cardHasDisplayImage({ image })) return placeholder;
      if (typeof image === 'string' && image.startsWith('data:image/')) return image;
      if (typeof image === 'string' && /^https?:\/\//i.test(image) && !window.SupabaseSync?.isInvalidMediaUrl?.(image)) {
        if (window.SupabaseSync?.isEphemeralUpstreamImageUrl?.(image)) return placeholder;
        if (window.SupabaseSync?.isCdnMediaUrl?.(image)) {
          if (window.SupabaseSync?.isGridDisplayUrl?.(image)) return image;
          return placeholder;
        }
        if (window.SupabaseSync?.isValidSignedDisplayUrl?.(image)) {
          if (window.SupabaseSync?.isGridDisplayUrl?.(image)) return image;
          return placeholder;
        }
        return placeholder;
      }
      return placeholder;
    }

    function getCommunityCollectImageResolveOpts(card) {
      if (!card || !window.isCommunityCollectCard?.(card)) return null;
      let authorId = String(card.communitySourceAuthorId || '');
      let sourceCardId = String(card.communitySourceCardId || card.communitySourceId || '');
      if ((!authorId || !sourceCardId) && card.favoritedFromPostId) {
        const post = window.FeatureDraft?.findPost?.(card.favoritedFromPostId);
        if (post) {
          if (!authorId) authorId = String(post.authorId || '');
          if (!sourceCardId) sourceCardId = String(post.sourceCardId || '');
        }
      }
      const ref = card.image;
      const uid = window.SupabaseSync?.getUserId?.();
      if (ref && window.SupabaseSync?.storagePathFromRef && uid) {
        const path = window.SupabaseSync.storagePathFromRef(ref) || '';
        const owner = path.replace(/^\//, '').split('/')[0] || '';
        if (owner === uid) {
          return null;
        }
        if (!authorId && owner) authorId = owner;
      }
      if (!authorId) return null;
      return {
        communityFeed: true,
        authorId,
        assetId: sourceCardId || card.id,
        cardId: sourceCardId || undefined,
        tryAllPaths: true,
        variant: window.SupabaseSync?.VARIANT_FULL || 'full'
      };
    }
    window.getCommunityCollectImageResolveOpts = getCommunityCollectImageResolveOpts;

    function migrateCommunityCollectCards() {
      const tag = window.COMMUNITY_COLLECT_TAG || '社区收藏';
      let changed = false;
      cards.forEach((c) => {
        if (!c || typeof c !== 'object') return;
        if (c.communitySourceId) {
          if (!(c.tags || []).includes(tag)) {
            c.tags = [...(c.tags || []), tag];
            changed = true;
          }
          if (!c.communitySourceCardId) {
            c.communitySourceCardId = String(c.communitySourceId);
            changed = true;
          }
          delete c.communitySourceId;
          changed = true;
        }
        if ((c.tags || []).includes(tag)) {
          if (c.publishedToCommunity) {
            c.publishedToCommunity = false;
            changed = true;
          }
          if (!c.tags.includes(tag)) {
            c.tags = [tag, ...(c.tags || []).filter(t => t !== tag)];
            changed = true;
          }
          if (!c.communitySourceAuthorId && c.favoritedFromPostId) {
            const post = window.FeatureDraft?.findPost?.(c.favoritedFromPostId);
            if (post?.authorId) {
              c.communitySourceAuthorId = String(post.authorId);
              changed = true;
            }
            if (!c.communitySourceCardId && post?.sourceCardId) {
              c.communitySourceCardId = String(post.sourceCardId);
              changed = true;
            }
          }
        }
      });
      return changed;
    }

    function applyDataPayload(payload) {
      if (!payload || typeof payload !== 'object') return;
      const prevTombstones = { ...(settings.deletedCardTombstones || {}) };
      const prevCreTombstones = { ...(settings.deletedCreationTombstones || {}) };
      const prevJobTombstones = { ...(settings.deletedGenerationJobTombstones || {}) };
      if (Array.isArray(payload.cards)) {
        cards = filterTombstonedCards(normalizeCardImages(payload.cards));
        cards = sanitizeCardGroupsAgainstTombstones(cards);
      }
      if (Array.isArray(payload.customGroups)) customGroups = payload.customGroups;
      if (Array.isArray(payload.globalFields)) globalFields = payload.globalFields;
      if (payload.settings && typeof payload.settings === 'object') {
        settings = Object.assign({ engine: 'tesseract', apiKey: '', imageClickZoom: false, floatingPrompt: false, defaultPublishCommunity: true, defaultImageGenAutoPublish: true, autoDayNight: false, themeManualOverride: false }, payload.settings);
        settings.deletedCardTombstones = mergeDeletedCardTombstones(
          prevTombstones,
          payload.settings.deletedCardTombstones
        );
        settings.deletedCreationTombstones = mergeDeletedCreationTombstones(
          prevCreTombstones,
          payload.settings.deletedCreationTombstones
        );
        settings.deletedGenerationJobTombstones = mergeDeletedGenerationJobTombstones(
          prevJobTombstones,
          payload.settings.deletedGenerationJobTombstones
        );
      } else {
        if (Object.keys(prevTombstones).length) settings.deletedCardTombstones = prevTombstones;
        if (Object.keys(prevCreTombstones).length) settings.deletedCreationTombstones = prevCreTombstones;
        if (Object.keys(prevJobTombstones).length) settings.deletedGenerationJobTombstones = prevJobTombstones;
      }
      if (Array.isArray(payload.creations)) {
        payload.creations = filterTombstonedCreations(payload.creations);
      }
      cards = filterTombstonedCards(cards);
      migrateCommunityCollectCards();
      window.Membership?.syncFromPayload?.(payload.account);
      window.FeatureDraft?.applyCloudSlice?.(payload);
      const wid = getActiveWarehouseId();
      if (Array.isArray(payload.customGroups)) {
        customGroups = window.CloudSyncSafety?.mergeCustomGroupsList
          ? window.CloudSyncSafety.mergeCustomGroupsList(
            [],
            payload.customGroups,
            cards,
            settings.deletedCustomGroupTombstones
          )
          : payload.customGroups.slice();
        persistWarehouseGroups(wid);
      } else {
        loadWarehouseGroups(wid);
      }
      reconcileCustomGroupsFromCards();
      normalizeCardPins();
      floatingPromptActive = false;
      settings.floatingPrompt = false;
      document.getElementById('imageClickZoomToggle').checked = settings.imageClickZoom;
      applyEfficiencyMode();
      if (settings.autoDayNight === true) {
        settings.themeManualOverride = false;
        window.ThemeSchedule?.applyAutoThemeIfNeeded?.();
      } else if (settings.theme && typeof window.applyAppTheme === 'function') {
        window.applyAppTheme(settings.theme);
      }
    }

    function setCloudSyncPhase(phase, detail) {
      cloudSyncPhase = phase || 'idle';
      cloudSyncPhaseAt = Date.now();
      cloudSyncPhaseDetail = detail ? String(detail) : '';
      updateCloudSyncStatusUI();
    }
    window.setCloudSyncPhase = setCloudSyncPhase;

    function updateCloudSyncStatusUI() {
      const el = document.getElementById('authCloudStatus');
      const loggedIn = window.SupabaseSync?.isLoggedIn?.();
      if (!el) return;
      if (!loggedIn || cloudSyncPhase === 'idle') {
        el.classList.add('hidden');
        el.classList.remove('is-syncing', 'is-error');
        return;
      }
      el.classList.remove('hidden');
      el.classList.remove('is-syncing', 'is-error');
      let text = '正在保存到云端…';
      if (cloudSyncPhase === 'pending') text = cloudSyncPhaseDetail || '即将保存到云端…';
      else if (cloudSyncPhase === 'syncing') text = cloudSyncPhaseDetail || '正在保存到云端…';
      else if (cloudSyncPhase === 'saved') text = '已保存到云端';
      else if (cloudSyncPhase === 'error') {
        text = cloudSyncPhaseDetail ? `保存异常：${cloudSyncPhaseDetail}` : '保存异常，请稍后重试或重新登录';
        el.classList.add('is-error');
      }
      if (cloudSyncPhase === 'syncing' || cloudSyncPhase === 'pending') el.classList.add('is-syncing');
      el.textContent = text;
      if (cloudSyncPhase === 'saved') scheduleCloudSyncStatusHide(2500);
      else if (cloudSyncPhase === 'error') scheduleCloudSyncStatusHide(6000);
      else clearCloudSyncStatusHideTimer();
    }

    function refreshAppBuildLabel() {
      const build = window.__APP_BUILD__ || '未知';
      const el = document.getElementById('appBuildLabel');
      if (el) el.textContent = '版本 ' + build;
      updateCloudSyncStatusUI();
    }
    window.refreshAppBuildLabel = refreshAppBuildLabel;

    function updateAuthUI(session) {
      const openBtn = document.getElementById('authOpenBtn');
      const userBar = document.getElementById('authUserBar');
      const emailEl = document.getElementById('authUserEmail');
      const configured = window.SupabaseSync?.isConfigured?.();
      const signedIn = !!(session?.user && window.SupabaseSync?.isLoggedIn?.());
      if (!openBtn) return;
      if (!configured) {
        openBtn.textContent = '云同步未配置';
        openBtn.disabled = true;
        userBar?.classList.add('hidden');
        updateCloudSyncStatusUI();
        return;
      }
      openBtn.disabled = false;
      if (signedIn) {
        openBtn.classList.add('hidden');
        userBar?.classList.remove('hidden');
        const label = session.user.email || session.user.phone || '已登录';
        if (emailEl) {
          emailEl.textContent = label;
          emailEl.title = label;
        }
        updateCloudSyncStatusUI();
      } else {
        openBtn.classList.remove('hidden');
        openBtn.textContent = '登录 / 注册';
        userBar?.classList.add('hidden');
        cloudSyncPhase = 'idle';
        updateCloudSyncStatusUI();
      }
      updateGuestLimitUI();
      const syncBtn = document.getElementById('communitySyncLibraryBtn');
      if (syncBtn) syncBtn.classList.toggle('hidden', !signedIn);
    }

    function reconcileAuthUI() {
      const session = window.SupabaseSync?.isLoggedIn?.()
        ? window.SupabaseSync?.getSession?.()
        : null;
      updateAuthUI(session);
    }
    window.reconcileAuthUI = reconcileAuthUI;

    let loginFlowPromise = null;

    function isPostLogoutBlocked() {
      return localStorage.getItem('promptrepo_post_logout') === '1';
    }

    async function completeAuthSession(opts = {}) {
      const session = window.SupabaseSync?.isLoggedIn?.()
        ? window.SupabaseSync?.getSession?.()
        : null;
      if (!session?.user) {
        if (isPostLogoutBlocked()) {
          updateAuthUI(null);
          try {
            await window.SupabaseSync?.signOut?.();
          } catch (e) { /* ignore */ }
        } else {
          updateAuthUI(null);
        }
        return;
      }
      localStorage.removeItem('promptrepo_post_logout');
      updateAuthUI(session);
      window.MediaPipeline?.resetOnLogin?.({ clearMissing: true });
      window.SupabaseSync?.resetMediaSignEnvironment?.({ clearMissing: true });
      if (loginFlowPromise) {
        await loginFlowPromise;
        return;
      }
      loginFlowPromise = handleCloudAfterLogin(opts).finally(() => {
        loginFlowPromise = null;
      });
      await loginFlowPromise;
    }

    let authExpiredHandledAt = 0;
    let authExpiredRenderTimer = null;

    function scheduleAuthExpiredWarehouseRefresh() {
      clearTimeout(authExpiredRenderTimer);
      authExpiredRenderTimer = setTimeout(() => {
        authExpiredRenderTimer = null;
        try {
          if (typeof warehousePageActive === 'function' && warehousePageActive()) {
            renderCards(true);
          }
        } catch (e) {
          console.warn('[auth] refresh warehouse after expired session failed', e);
        }
      }, 120);
    }

    function handleApiUnauthorized(event) {
      const now = Date.now();
      if (now - authExpiredHandledAt < 5000) return;
      authExpiredHandledAt = now;
      const detail = event?.detail || {};
      try {
        window.SupabaseSync?.markSessionExpired?.({
          source: detail.source || 'script',
          reason: detail.reason || 'api-unauthorized',
          message: detail.message || '登录已过期，请重新登录',
          emit: false
        });
      } catch (e) { /* ignore */ }
      updateAuthUI(null);
      setCloudSyncPhase('error', '登录已过期，请重新登录');
      window.SyncOrchestrator?.cancelPending?.();
      if (typeof showToast === 'function') {
        showToast('登录已过期，请重新登录后加载云端图片', 7000);
      }
      scheduleAuthExpiredWarehouseRefresh();
    }

    window.addEventListener('ph-api-unauthorized', handleApiUnauthorized);

    let authMode = 'login';
    let authChannel = 'email';
    let authBusy = false;
    let otpCooldownTimer = null;

    function isValidEmail(email) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function setAuthBusy(busy) {
      authBusy = busy;
      const btn = document.getElementById('authSubmitBtn');
      const otpBtn = document.getElementById('authSendOtpBtn');
      if (btn) btn.disabled = busy;
      if (otpBtn && !otpCooldownTimer) otpBtn.disabled = busy;
    }

    function refreshAuthMethodUI() {
      const phoneEnabled = window.SupabaseSync?.isPhoneAuthEnabled?.();
      const phoneTab = document.getElementById('authPhoneMethodTab');
      const methodTabs = document.getElementById('authMethodTabs');
      if (phoneTab) phoneTab.classList.toggle('hidden', !phoneEnabled);
      if (methodTabs && !phoneEnabled) methodTabs.classList.add('hidden');
      const wechatBtn = document.getElementById('authWeChatBtn');
      const social = document.getElementById('authSocial');
      if (wechatBtn) {
        wechatBtn.disabled = !window.SupabaseSync?.isWeChatAuthEnabled?.();
        wechatBtn.title = wechatBtn.disabled ? '需先在 supabase-config.js 配置微信 OAuth' : '使用微信登录';
      }
    }

    function switchAuthChannel(channel) {
      if (channel === 'phone' && !window.SupabaseSync?.isPhoneAuthEnabled?.()) {
        setAuthStatus('手机登录暂未开放，请使用邮箱登录', 'error');
        return;
      }
      authChannel = channel;
      document.querySelectorAll('.auth-method-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.authChannel === channel);
      });
      document.getElementById('authEmailPanel')?.classList.toggle('hidden', channel !== 'email');
      document.getElementById('authPhonePanel')?.classList.toggle('hidden', channel !== 'phone');
      document.getElementById('authTabs')?.classList.toggle('hidden', channel !== 'email' || authMode === 'forgot' || authMode === 'reset');
      document.getElementById('authEmailLinks')?.classList.toggle('hidden', channel !== 'email');
      document.getElementById('authSocial')?.classList.toggle('hidden', authMode === 'forgot' || authMode === 'reset');
      const submitBtn = document.getElementById('authSubmitBtn');
      if (channel === 'phone') {
        document.getElementById('authTitle').textContent = '手机验证码登录';
        document.getElementById('authDesc').textContent = '输入手机号获取验证码，未注册将自动创建账号。';
        if (submitBtn) submitBtn.textContent = '登录 / 注册';
        document.getElementById('authPhone')?.focus();
      } else {
        switchAuthMode(authMode || 'login');
      }
      setAuthStatus('');
    }
    window.switchAuthChannel = switchAuthChannel;

    function switchAuthMode(mode) {
      authMode = mode;
      if (authChannel === 'phone' && mode !== 'reset') return;
      const tabs = document.getElementById('authTabs');
      const confirmWrap = document.getElementById('authConfirmWrap');
      const displayNameWrap = document.getElementById('authDisplayNameWrap');
      const newPwdWrap = document.getElementById('authNewPwdWrap');
      const pwdField = document.querySelector('.auth-field-password');
      const rememberWrap = document.getElementById('authRememberWrap');
      const forgotLink = document.getElementById('authForgotLink');
      const backLink = document.getElementById('authBackLoginLink');
      const title = document.getElementById('authTitle');
      const desc = document.getElementById('authDesc');

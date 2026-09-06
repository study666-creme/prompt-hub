      const inCommunityGrid = !!img.closest('#communityGrid, #creationsGrid, #userProfileGrid');
      if (inWarehouse || inSide || inImageGenWh || inCommunityGrid || !assetId) {
        url = getListDisplayImageSrc(ref, assetId, {
          assetId,
          authorId: img.dataset?.authorId || img.closest('.card')?.dataset?.authorId,
          allowFullFallback: false
        });
      }
      if (url && isInvalidMediaUrl(url)) url = '';
      if (url && isWarehouseBlockedFullUrl(url, img)) url = '';
      if (url && /^https?:\/\//i.test(url) && isValidSignedDisplayUrl(url)) {
        const media = img.closest('.card-media, .imagegen-feed-media');
        const whOwnList = inWarehouse && !img.closest('.card[data-community-collect="1"]');
        const alreadyVisible = img.complete && img.naturalWidth > 8 && isUsableLoadedImgSrc(cur, img);
        if (whOwnList && !isGridDisplayUrl(url)) url = '';
        if (!url) return;
        if (whOwnList) {
          if (media && !alreadyVisible) media.classList.add('card-media--await');
        } else {
          media?.classList.remove('card-media--await');
          if (media && !alreadyVisible) {
            if (!media.dataset.shineAt) media.dataset.shineAt = String(Date.now());
            if (!media.classList.contains('is-loading')) media.classList.add('is-loading');
          }
        }
        const currentNow = img.currentSrc || img.src || '';
        const currentPath = storagePathFromDisplayUrl(currentNow);
        const targetPath = storagePathFromDisplayUrl(url);
        const targetKey = targetPath ? String(targetPath).replace(/^\//, '') : url;
        const sameDisplayResource = currentNow === url
          || (currentPath && targetPath && String(currentPath).replace(/^\//, '') === String(targetPath).replace(/^\//, ''));
        if (!img.complete && (
          img.dataset.feedLoadingUrl === url
          || (targetKey && img.dataset.feedLoadingKey === targetKey)
          || sameDisplayResource
        )) {
          return;
        }
        const done = () => {
          if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(media);
          else media?.classList.remove('is-loading');
        };
        if (img.complete && img.naturalWidth > 0 && (img.src === url || isUsableLoadedImgSrc(cur, img))) done();
        else {
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', () => {
            const failedPath = storagePathFromDisplayUrl(img.src || '');
            if (failedPath && /_grid\.(jpe?g|webp|png)$/i.test(failedPath)) {
              markGridFetchFailed(failedPath);
            }
            if (inWarehouse && !img.closest('.card[data-community-collect="1"]')) {
              if (img.dataset.feedLoadDone !== '1') {
                window.finalizeWarehouseCardMediaFailure?.(media, img);
              }
              done();
              return;
            }
            if (img.dataset.patchRetry === '1') {
              media?.classList.add('card-media--load-failed');
              done();
              return;
            }
            img.dataset.patchRetry = '1';
            void resolveDisplayUrl(ref, {
              assetId,
              authorId: img.dataset?.authorId || img.closest('.card')?.dataset?.authorId,
              communityFeed: inCommunityGrid,
              variant: VARIANT_GRID,
              listOnly: true,
              allowFullFallback: false,
              degradedListFull: false
            }).then((retryUrl) => {
              const safeRetry = window.SupabaseSync?.safeListImgUrl?.(retryUrl, img) || '';
              if (safeRetry && window.CardImageLoader?.applyUrlToImg?.(img, safeRetry)) {
                return;
              }
              media?.classList.add('card-media--load-failed');
              done();
            });
          }, { once: true });
          if (!window.CardImageLoader?.applyUrlToImg?.(img, url)) {
            media?.classList.add('card-media--load-failed');
            done();
          }
        }
      }
    });
  }

  async function prefetchDisplayUrlsWithCap(images, capMs, opts) {
    const limit = Math.max(800, Number(capMs) || 5000);
    await Promise.race([
      prefetchDisplayUrls(images, opts),
      new Promise((r) => setTimeout(r, limit))
    ]);
  }

  async function hydrateImageElements(root, opts) {
    const onlyMissing = opts?.onlyMissing === true;
    const scope = root || document;
    const imgs = [...scope.querySelectorAll('img[data-storage-ref], img[data-image-ref]')];
    imgs.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const aVis = ar.top < window.innerHeight && ar.bottom > 0;
      const bVis = br.top < window.innerHeight && br.bottom > 0;
      if (aVis !== bVis) return aVis ? -1 : 1;
      return ar.top - br.top;
    });
    const concurrency = opts?.warehouseBoost
      ? (window.matchMedia('(max-width: 900px)').matches ? 10 : 18)
      : opts?.communityBoost
        ? (window.matchMedia('(max-width: 900px)').matches ? 8 : 14)
        : (window.matchMedia('(max-width: 900px)').matches ? 5 : 8);
    let idx = 0;
    async function hydrateOne(img) {
      if (img.closest('#cardsContainer')) return;
      if (img.closest('#imageGenFeed')) return;
      const ref = img.getAttribute('data-storage-ref') || img.getAttribute('data-image-ref');
      if (!ref) return;
      const media = img.closest('.card-media, .imagegen-feed-media');
      if (media?.classList.contains('imagegen-gen-pending')) return;
      const cur = img.currentSrc || img.src || '';
      if (onlyMissing && isUsableLoadedImgSrc(cur, img)) {
        media?.classList.remove('is-loading');
        return;
      }
      const inWarehouse = !!img.closest('#cardsContainer');
      const inCommunityFeed = !!img.closest('#communityGrid, #creationsGrid, #userProfileGrid');
      const inFeed = inCommunityFeed;
      const authorId = img.dataset?.authorId
        || img.closest('.card')?.dataset?.authorId
        || '';
      const refPath = storagePathFromRef(ref) || '';
      const uid = getUserId();
      const ownFeedPath = !!(refPath && uid && refPath.replace(/^\//, '').startsWith(`${uid}/`));
      const inSide = !!img.closest('#communitySideBody, #creationsSideBody, .community-side-img-btn');
      const communityFeed = (inFeed && (!isLoggedIn() || !ownFeedPath)) || inSide;
      const listVariant = inSide ? VARIANT_FULL : ((inCommunityFeed || inWarehouse) ? VARIANT_GRID : VARIANT_GRID);
      const assetId = img.dataset?.sourceCardId
        || img.closest('.card[data-source-card-id]')?.dataset?.sourceCardId
        || img.closest('.card[data-id]')?.dataset?.id
        || img.closest('.card[data-post-id]')?.dataset?.postId
        || img.closest('.card[data-creation-id]')?.dataset?.creationId
        || img.closest('[data-feed-id]')?.dataset?.feedId?.replace(/^wh_/, '')
        || undefined;
      let resolveOpts = {
        assetId,
        authorId: authorId || undefined,
        cardId: assetId,
        variant: listVariant,
        communityFeed,
        tryAllPaths: false,
        allowFullFallback: inSide ? true : false,
        listOnly: inWarehouse || (inCommunityFeed && !inSide) ? true : undefined
      };
      if (inWarehouse && assetId && typeof window.getCommunityCollectImageResolveOpts === 'function') {
        const cardModel = (window.__promptHubCards || []).find((c) => c.id === assetId);
        const collectOpts = window.getCommunityCollectImageResolveOpts(cardModel);
        if (collectOpts) {
          resolveOpts = {
            ...resolveOpts,
            authorId: collectOpts.authorId,
            cardId: collectOpts.cardId || collectOpts.assetId,
            communityFeed: true,
            tryAllPaths: false,
            variant: VARIANT_GRID,
            listOnly: true,
            allowFullFallback: false
          };
        }
      }
      const cached = getCachedDisplayUrl(ref, { assetId, authorId: authorId || undefined, variant: listVariant });
      if (cached && isResolvableDisplayUrl(cached)) {
        const mediaWrapCached = media || img.closest('.community-side-img-btn');
        if (cur !== cached) {
          if (mediaWrapCached && !mediaWrapCached.dataset.shineAt) {
            mediaWrapCached.dataset.shineAt = String(Date.now());
          }
          setCardMediaLoadState(mediaWrapCached, 'loading');
          img.src = cached;
          if (img.complete && img.naturalWidth > 0) {
            if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(mediaWrapCached);
            else mediaWrapCached?.classList.remove('is-loading');
          }
        } else if (!isPlaceholderImgSrc(cur)) {
          mediaWrapCached?.classList.remove('is-loading');
        }
        return;
      }
      const mediaWrap = media || img.closest('.community-side-img-btn');
      if (mediaWrap) {
        if (!mediaWrap.dataset.shineAt) mediaWrap.dataset.shineAt = String(Date.now());
        setCardMediaLoadState(mediaWrap, 'loading');
      }
      if (!img.getAttribute('src') || isPlaceholderImgSrc(img.getAttribute('src'))) {
        img.src = imgPlaceholderSrc();
      }
      const endShine = () => {
        if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(mediaWrap);
        else mediaWrap?.classList.remove('is-loading');
      };
      try {
        let url = await resolveDisplayUrl(ref, resolveOpts);
        if (isResolvableDisplayUrl(url) && !isWarehouseBlockedFullUrl(url, img)) {
          const onFail = () => {
            if (media?.classList.contains('is-loading')) return;
            img.src = imgPlaceholderSrc();
            img.classList.remove('img-load-failed');
            setCardMediaLoadState(media, 'failed');
            endShine();
          };
          if (img.complete && img.src === url && img.naturalWidth > 0) endShine();
          else {
            img.addEventListener('load', () => {
              setCardMediaLoadState(media, 'loading');
              media?.classList.remove('card-media--load-failed');
              endShine();
            }, { once: true });
            img.addEventListener('error', onFail, { once: true });
            img.src = url;
          }
          img.classList.remove('img-load-failed');
          if (img.complete && img.naturalWidth > 0) endShine();
        } else if (!isPlaceholderImgSrc(cur) && cur.startsWith('http')) {
          endShine();
        } else {
          setCardMediaLoadState(media, 'loading');
        }
      } catch (e) {
        console.warn('[SupabaseSync] hydrate failed', ref, e);
        setCardMediaLoadState(media, 'loading');
      }
      if (!img.dataset.hydrateBound) {
        img.dataset.hydrateBound = '1';
        img.addEventListener('error', () => {
          if (media?.classList.contains('is-loading')) return;
          if (img.dataset.retryHydrate === '1') {
            setCardMediaLoadState(media, 'failed');
            return;
          }
          img.dataset.retryHydrate = '1';
          invalidateSignedCacheForRef(ref, assetId);
          setCardMediaLoadState(media, 'loading');
          void resolveDisplayUrl(ref, {
            ...resolveOpts,
            tryAllPaths: inWarehouse ? false : true,
            listOnly: inWarehouse ? true : resolveOpts.listOnly,
            allowFullFallback: false,
            degradedListFull: false
          }).then((url) => {
            if (isResolvableDisplayUrl(url) && !isWarehouseBlockedFullUrl(url, img)) {
              img.src = url;
              img.classList.remove('img-load-failed');
              media?.classList.remove('card-media--load-failed');
            } else {
              setCardMediaLoadState(media, 'failed');
            }
          });
        });
      }
    }
    async function worker() {
      while (idx < imgs.length) {
        const i = idx++;
        await hydrateOne(imgs[i]);
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, imgs.length) }, () => worker());
    await Promise.all(workers);
  }

  async function verifyStorageRef(ref, assetId, opts = {}) {
    if (!ref || !isStorageRef(ref)) return false;
    if (opts.quick && opts.noDownload === true) {
      const primary = primaryImagePath(ref, assetId);
      if (!primary || isPathKnownMissing(primary)) return false;
      const pkey = primary.replace(/^\//, '');
      const cached = signedUrlCache.get(signedCacheKey(pkey, VARIANT_FULL));
      if (cached?.url && cached.expiresAt > Date.now() + 120000) return true;
      const url = await resolvePathToUrl(pkey, VARIANT_FULL, { bypassSignBudget: true });
      return !!url;
    }
    const attempts = opts.quick ? 1 : 2;
    const all = listImagePathCandidates(normalizeImageRef(ref), assetId);
    const candidates = (opts.quick ? [primaryImagePath(ref, assetId)].filter(Boolean) : all)
      .filter((p) => !isPathKnownMissing(p));
    for (let round = 0; round < attempts; round++) {
      for (const path of candidates) {
        try {
          const url = await resolvePathToUrl(path.replace(/^\//, ''), VARIANT_FULL, { bypassSignBudget: true });
          if (url && (opts.noDownload === true || await verifyImageUrl(url))) return true;
        } catch (e) {
          if (!isStorageNotFoundError(e)) {
            console.warn('[SupabaseSync] verifyStorageRef', path, e);
          }
        }
      }
      if (round < attempts - 1) {
        await new Promise((r) => setTimeout(r, opts.quick ? 80 : 300));
      }
    }
    return false;
  }

  async function uploadStorageBlobViaApi(path, blob, opts = {}) {
    if (!window.PromptHubApi?.isConfigured?.() || !window.PromptHubApi?.uploadStorageBlob) {
      return null;
    }
    const ref = await window.PromptHubApi.uploadStorageBlob(path, blob, opts);
    const cleanPath = String(path || '').replace(/^\//, '');
    if (cleanPath) missingPathCache.delete(normalizePathKey(cleanPath));
    return ref;
  }

  async function uploadStorageBlobXHR(path, blob, opts = {}) {
    if (window.PromptHubApi?.isConfigured?.() && window.PromptHubApi?.uploadStorageBlob) {
      return uploadStorageBlobViaApi(path, blob, opts);
    }
    await ensureSession();
    const sb = getClient();
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('未登录');
    const base = String(window.SUPABASE_URL || '').replace(/\/$/, '');
    const cleanPath = String(path || '').replace(/^\//, '');
    if (!cleanPath) throw new Error('图片路径无效');
    const pathEnc = cleanPath.split('/').map(encodeURIComponent).join('/');
    const uploadUrl = `${base}/storage/v1/object/${BUCKET}/${pathEnc}`;
    const contentType = (blob.type && blob.type.startsWith('image/')) ? blob.type : 'image/jpeg';
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', uploadUrl);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', window.SUPABASE_ANON_KEY);
      xhr.setRequestHeader('x-upsert', 'true');
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.setRequestHeader('cache-control', '3600');
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && typeof opts.onProgress === 'function') {
          opts.onProgress(ev.loaded / ev.total, ev.loaded, ev.total);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(toStorageRef(cleanPath));
          return;
        }
        let errMsg = xhr.responseText || `HTTP ${xhr.status}`;
        try {
          const parsed = JSON.parse(xhr.responseText);
          errMsg = parsed.message || parsed.error || errMsg;
        } catch (e) { /* ignore */ }
        reject(new Error(errMsg));
      };
      xhr.onerror = () => reject(new Error('网络错误，图片上传失败'));
      xhr.send(blob);
    });
  }

  async function uploadStorageBlob(path, blob, opts = {}) {
    if (!blob || (blob.size || 0) < MIN_VALID_IMAGE_BYTES) {
      throw new Error('图片数据无效（文件过小），请重新选择或重新生成');
    }
    if (window.PromptHubApi?.isConfigured?.() && window.PromptHubApi?.uploadStorageBlob) {
      try {
        const ref = await uploadStorageBlobViaApi(path, blob, opts);
        if (ref) return ref;
      } catch (e) {
        if ((blob.size || 0) > STORAGE_BUCKET_LIMIT_BYTES) throw e;
        console.warn('[SupabaseSync] Worker 上传失败，改走 Storage 直传', e);
      }
    }
    if (typeof opts.onProgress === 'function') {
      return uploadStorageBlobXHR(path, blob, opts);
    }
    const maxAttempts = Math.max(1, opts.maxAttempts || 3);
    await ensureSession();
    const sb = getClient();
    if (!sb) throw new Error('未登录');
    const cleanPath = String(path || '').replace(/^\//, '');
    if (!cleanPath) throw new Error('图片路径无效');
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { error } = await sb.storage.from(BUCKET).upload(cleanPath, blob, {
        contentType: (blob.type && blob.type.startsWith('image/')) ? blob.type : 'image/jpeg',
        upsert: true,
        cacheControl: '3600'
      });
      if (error) {
        lastErr = error;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 350 * attempt));
          continue;
        }
        break;
      }
      if (opts.skipVerify) {
        missingPathCache.delete(normalizePathKey(cleanPath));
        return toStorageRef(cleanPath);
      }
      const url = await resolvePathToUrl(cleanPath);
      if (url) {
        if (await verifyImageUrl(url)) return toStorageRef(cleanPath);
      }
      await new Promise((r) => setTimeout(r, 450));
      const retryUrl = await resolvePathToUrl(cleanPath);
      if (retryUrl && (await verifyImageUrl(retryUrl))) return toStorageRef(cleanPath);
      lastErr = new Error('上传后校验失败');
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 350 * attempt));
    }
    throw lastErr || new Error('图片上传失败，请检查网络后重试');
  }

  /** 生图入库：原字节写入 generated/{jobId}，列表另存 _grid 缩略 */
  async function archiveGeneratedCardImage(cardId, image, opts = {}) {
    if (!cardId || !image) return image || null;
    if (isStorageRef(image) && !opts.copyToOwnPath) {
      const normalized = normalizeImageRef(image);
      if (await verifyStorageRef(normalized, cardId, { quick: true })) return normalized;
      return normalized;
    }
    if (isStorageRef(image) && opts.copyToOwnPath) {
      const path = storagePathFromRef(image);
      if (path) {
        const url = await resolvePathToUrl(path.replace(/^\//, ''), VARIANT_FULL, { bypassSignBudget: true });
        if (url) {
          return persistGenerationImage(cardId, url, {
            ...(opts?.jobId ? { jobId: opts.jobId } : {}),
            allowRemoteArchive: true
          });
        }
      }
    }
    if (
      /^https?:\/\//i.test(image)
      && isEphemeralUpstreamImageUrl(image)
      && opts.allowRemoteArchive !== true
      && !opts?.jobId
    ) {
      const jobId = opts?.jobId || null;
      if (jobId && window.WarehouseThumb?.resolveForCard) {
        void window.WarehouseThumb.resolveForCard(image, { jobId, assetId: cardId, cardId });
      }
      return image;
    }
    if (!isLoggedIn()) return image;
    const persistOpts = {
      ...(opts?.jobId ? { jobId: opts.jobId } : {}),
      allowRemoteArchive: opts.allowRemoteArchive === true
    };
    let ref = image;
    try {
      ref = await persistGenerationImage(cardId, image, persistOpts);
    } catch (e) {
      console.warn('[SupabaseSync] persistGenerationImage failed', cardId, e);
    }
    if (ref && isStorageRef(ref) && await verifyStorageRef(ref, cardId, { quick: true })) {
      return ref;
    }
    if (/^https?:\/\//i.test(image) || isDataUrl(image) || String(image).startsWith('blob:')) {
      try {
        return await persistGenerationImage(cardId, image, persistOpts);
      } catch (e) {
        console.warn('[SupabaseSync] archiveGeneratedCardImage fallback failed', cardId, e);
      }
    }
    return ref || image;
  }

  async function persistGenerationImage(assetId, image, opts = {}) {
    if (!image || typeof image !== 'string') return image;
    if (!isLoggedIn()) return image;
    if (isStorageRef(image)) {
      const normalized = normalizeImageRef(image);
      if (await verifyStorageRef(normalized, assetId)) return normalized;
      return normalized;
    }
    await ensureSession();
    const storeId = generationStorageAssetId(opts?.jobId, assetId);
    if (isDataUrl(image) || image.startsWith('blob:')) {
      return uploadGeneratedImage(storeId, image);
    }
    if (/^https?:\/\//i.test(image)) {
      if (opts.allowRemoteArchive !== true && !opts?.jobId) {
        if (isEphemeralUpstreamImageUrl(image)) return image;
        if (window.WarehouseThumb?.needsServerThumb?.(image, opts?.jobId)) return image;
      }
      let blob = null;
      if (window.PromptHubApi?.fetchMediaAsBlobUrl) {
        const tmp = await window.PromptHubApi.fetchMediaAsBlobUrl(image);
        if (tmp) {
          try {
            const res = await fetch(tmp);
            if (res.ok) blob = await res.blob();
          } finally {
            try { URL.revokeObjectURL(tmp); } catch (e) { /* ignore */ }
          }
        }
      }
      if (!blob) {
        try {
          const res = await fetch(image, { mode: 'cors' });
          if (res.ok) blob = await res.blob();
        } catch (e) {
          console.warn('[SupabaseSync] 生成图 CORS 拉取失败', e);
        }
      }
      if (blob && (await blobLooksLikeUsableImage(blob))) {
        return uploadGeneratedImage(storeId, blob, { cardId: assetId, jobId: opts?.jobId || null });
      }
      console.warn('[SupabaseSync] 生成图远程地址无效或已过期', storeId);
      return image;
    }
    return image;
  }

  async function uploadGeneratedImage(assetId, source, opts = {}) {
    await ensureSession();
    const uid = getUserId();
    if (!uid || !assetId) throw new Error('未登录');
    const blob = await sourceToBlob(source);
    if (!(await blobLooksLikeUsableImage(blob))) {
      throw new Error('生成图无效（全黑或无法解码），已拒绝上传');
    }
    if ((blob.size || 0) > STORAGE_BUCKET_LIMIT_BYTES) {
      const mb = ((blob.size || 0) / (1024 * 1024)).toFixed(1);
      throw new Error(`生成图约 ${mb}MB，超过云存储单文件 50MB 上限`);
    }
    const ext = extensionFromMime(blob.type);
    const path = `${uid}/generated/${assetId}.${ext}`;
    const gridPath = gridPathFromPrimary(path);
    const ref = await uploadStorageBlob(path, blob, {
      skipVerify: true,
      contentType: blob.type || `image/${ext}`
    });
    if (gridPath) {
      try {
        const gridBlob = await compressImageToGrid(source);
        if ((gridBlob.size || 0) >= GRID_MIN_VALID_BYTES) {
          await uploadStorageBlob(gridPath, gridBlob, { skipVerify: true });
          const readyId = opts?.cardId || opts?.jobId || assetId;
          markGridThumbReady(String(readyId));
          clearSignedCacheForPaths([gridPath, path]);
        }
      } catch (e) {
        console.warn('[SupabaseSync] generated grid thumb failed', assetId, e);
      }
    }
    return ref;
  }

  async function loadImageFromSource(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片无法读取'));
      if (typeof source === 'string') img.src = source;
      else if (source instanceof Blob) img.src = URL.createObjectURL(source);
      else reject(new Error('不支持的图片格式'));
    });
  }

  /** 拒绝全黑/无法解码的 blob，避免 upsert 覆盖 Storage 里仍有效的原图 */
  async function blobLooksLikeUsableImage(blob) {
    if (!blob || (blob.size || 0) < MIN_VALID_IMAGE_BYTES) return false;
    let objectUrl = null;
    try {
      const img = await loadImageFromSource(blob);
      if (typeof blob !== 'string' && blob instanceof Blob) {
        objectUrl = img.src;
      }
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      if (w < 16 || h < 16) return false;
      const canvas = document.createElement('canvas');
      const sw = Math.min(48, w);
      const sh = Math.min(48, h);
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, sw, sh);
      const data = ctx.getImageData(0, 0, sw, sh).data;
      let sum = 0;
      let sumSq = 0;
      const n = sw * sh;
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        sum += lum;
        sumSq += lum * lum;
      }
      const mean = sum / n;
      const variance = sumSq / n - mean * mean;
      if (variance < 6 && mean < 14) return false;
      return true;
    } catch (e) {
      return false;
    } finally {
      if (objectUrl) {
        try { URL.revokeObjectURL(objectUrl); } catch (e) { /* ignore */ }
      }
    }
  }

  async function compressImage(source, opts) {
    const maxSide = opts?.maxSide || MAX_SIDE;
    const quality = opts?.quality != null ? opts.quality : JPEG_QUALITY;
    const normalized = await coerceImageUploadSource(source);
    const img = await loadImageFromSource(normalized);
    if (typeof source !== 'string' && source instanceof Blob) {
      try { URL.revokeObjectURL(img.src); } catch (e) { /* ignore */ }
    }
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (!w || !h) throw new Error('图片尺寸无效');
    const scale = Math.min(1, maxSide / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('图片压缩失败'))), 'image/jpeg', quality);
    });
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new Error('图片过大，请换一张较小的图（建议小于 5MB）');
    }
    return blob;
  }

  async function compressImageToGrid(source) {
    return compressImage(source, { maxSide: GRID_MAX_SIDE, quality: GRID_JPEG_QUALITY });
  }

  async function uploadImageGenRef(refId, source) {
    await ensureSession();
    const uid = getUserId();
    if (!uid || !refId) throw new Error('未登录或参考图无效');
    const blob = await compressImage(source);
    const path = `${uid}/imagegen/${refId}.jpg`;
    return uploadStorageBlob(path, blob, { skipVerify: true });
  }

  async function uploadCardImage(cardId, source, opts = {}) {
    await ensureSession();
    const original = opts.original != null ? !!opts.original : cardUploadOriginalEnabled();
    const fullBlob = await prepareCardFullUploadBlob(source, { original });
    if (!(await blobLooksLikeUsableImage(fullBlob))) {
      throw new Error('图片无效（全黑或无法解码），已拒绝上传以免覆盖云端原图');
    }
    const encodeMode = fullBlob.__uploadEncodeMode || 'raw';
    const ext = original
      ? (encodeMode === 'full_res_jpeg' ? 'jpg' : extFromImageMime(fullBlob.type))
      : 'jpg';
    const path = cardImageStoragePath(cardId, null, ext);
    if (!path) throw new Error('未登录或卡片无效');
    const gridPath = gridImageStoragePath(cardId);
    clearSignedCacheForPaths([path, gridPath, ...listImagePathCandidates(toStorageRef(path), cardId)]);
    await uploadStorageBlob(path, fullBlob, { skipVerify: true, onProgress: opts.onProgress });
    let gridBytes = 0;
    if (gridPath) {
      try {
        const gridBlob = await compressImageToGrid(source);
        gridBytes = gridBlob.size || 0;
        if (gridBytes >= GRID_MIN_VALID_BYTES && await blobLooksLikeUsableImage(gridBlob)) {
          await uploadStorageBlob(gridPath, gridBlob, { skipVerify: true });
          markGridThumbReady(cardId);
        }
      } catch (e) {
        console.warn('[SupabaseSync] grid thumb upload failed', cardId, e);
      }
    }
    const totalBytes = (fullBlob.size || 0) + gridBytes;
    window.__lastCardUploadMeta = {
      cardId: String(cardId),
      bytes: fullBlob.size,
      gridBytes,
      totalBytes,
      original,
      encodeMode
    };
    if (totalBytes > 0 && window.PromptHubApi?.reportStorageDelta) {
      void window.PromptHubApi.reportStorageDelta(totalBytes).then((r) => {
        if (!r?.ok && r?.message && typeof showToast === 'function') {
          showToast(r.message);
        }
      });
    }
    return toStorageRef(path);
  }

  async function resolveCardDownloadUrl(image, opts = {}) {
    if (!image || typeof image !== 'string') return image || null;
    if (isDataUrl(image) || image.startsWith('blob:')) return image;
    const assetId = opts?.assetId;
    const normalized = normalizeImageRef(image);
    const jobId = opts?.jobId ? generationStorageAssetId(opts.jobId, '') : '';
    const candidates = pathsForVariant(normalized, assetId, opts?.authorId, VARIANT_FULL, opts?.jobId || jobId)
      .filter((p) => !isGridStoragePath(p));
    for (const raw of candidates) {
      const key = raw.replace(/^\//, '');
      if (isPathKnownMissing(key)) continue;
      if (opts.forceRefresh === true) {
        signedUrlCache.delete(signedCacheKey(key, VARIANT_FULL));
        signedUrlCache.delete(signedCacheKey(key, VARIANT_GRID));
      }
      const url = await resolvePathToUrl(raw, VARIANT_FULL, {
        cardId: assetId,
        authorId: opts?.authorId,
        communityFeed: opts?.communityFeed === true,
        bypassSignBudget: true
      });
      if (!url) continue;
      if (await verifyMediaUrlReachable(url)) return url;
      invalidateSignedCache(key);
    }
    return null;
  }

  /** 侧栏/编辑面板/灯箱：优先 full 原图；原图不存在时回退可用 grid 预览 */
  async function resolvePreviewFullUrl(image, opts = {}) {
    if (!image || typeof image !== 'string') return '';
    if (isDataUrl(image) || image.startsWith('blob:')) return image;
    if (/^https?:\/\//i.test(image) && !isInvalidMediaUrl(image)) {
      if (await verifyMediaUrlReachable(image)) return image;
    }
    const assetId = opts.assetId || opts.cardId;
    const slotJobId = opts?.jobId ? String(opts.jobId) : '';
    const storageJobKey = slotJobId ? generationStorageAssetId(slotJobId, '') : '';
    const galleryIndex = Number.isFinite(opts.galleryIndex) ? opts.galleryIndex : null;
    const cached = getCachedDisplayUrl(image, {
      assetId,
      authorId: opts.authorId,
      variant: VARIANT_FULL
    });
    if (cached && isValidSignedDisplayUrl(cached) && !isInvalidMediaUrl(cached)
      && await verifyMediaUrlReachable(cached)) return cached;
    const useJobApi = opts.useJobImageApi === true
      && (galleryIndex == null || galleryIndex <= 0);
    const baseJobId = slotJobId.replace(/#\d+$/, '');
    if (useJobApi && baseJobId && window.PromptHubApi?.getGenerationImageUrl) {
      try {
        const r = await window.PromptHubApi.getGenerationImageUrl(baseJobId);
        if (r?.ok && r.data?.url) return r.data.url;
      } catch (e) { /* ignore */ }
    }
    const dl = await resolveCardDownloadUrl(image, {
      assetId,
      authorId: opts.authorId,
      communityFeed: opts.communityFeed === true,
      jobId: slotJobId || storageJobKey
    });
    if (dl) return dl;
    const resolved = await resolveDisplayUrl(image, {
      assetId,
      authorId: opts.authorId,
      cardId: opts.cardId || assetId,
      jobId: slotJobId || storageJobKey || undefined,
      variant: VARIANT_FULL,
      tryAllPaths: true,
      preferFull: true,
      listOnly: false,
      allowFullFallback: true,
      bypassSignBudget: true,
      communityFeed: opts.communityFeed === true
    });
    if (resolved && typeof resolved === 'string' && await verifyMediaUrlReachable(resolved)) return resolved;
    if (opts.allowGridFallback !== false) {
      const gridHint = opts.gridFallbackUrl || opts.fallbackGridUrl;
      if (gridHint && /^https?:\/\//i.test(gridHint) && await verifyMediaUrlReachable(gridHint)) {
        return gridHint;
      }
      const grid = await resolveListGridFallbackUrl(image, {
        assetId,
        authorId: opts.authorId,
        cardId: opts.cardId || assetId,
        communityFeed: opts.communityFeed === true
      });
      if (grid) return grid;
    }
    return '';
  }

  async function deleteCardImageByUrl(url, opts = {}) {
    if (!url || !isStorageRef(url)) return;
    const path = storagePathFromRef(url);
    if (!path) return;
    if (isGeneratedArchivePath(path) && opts.allowGenerated !== true) return;

    if (window.PromptHubApi?.isConfigured?.() && window.PromptHubApi.deleteOwnedCardImage) {
      try {
        const r = await window.PromptHubApi.deleteOwnedCardImage(url, {
          excludeCardId: opts.excludeCardId,
          allowGenerated: opts.allowGenerated === true,
          force: opts.force === true,
          genJobId: opts.genJobId
        });
        if (r?.ok) return;

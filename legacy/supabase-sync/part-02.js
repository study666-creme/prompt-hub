    return (
      str.startsWith(`${base}/storage/v1/object/public/${BUCKET}/`) ||
      str.startsWith(`${base}/storage/v1/object/sign/${BUCKET}/`) ||
      str.startsWith(`${base}/storage/v1/object/authenticated/${BUCKET}/`)
    );
  }

  function storagePathFromUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const cdnPath = storagePathFromCdnUrl(url);
    if (cdnPath) return cdnPath;
    if (url.startsWith(STORAGE_PREFIX)) return url.slice(STORAGE_PREFIX.length).split('?')[0];
    const bare = url.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[^/?#]+\.(jpe?g|png|webp|gif)$/i.test(bare)) {
      return bare;
    }
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const p = u.pathname.replace(/^\//, '');
      if (
        (host === 'api.prompt-hub.cn' || host.endsWith('.prompt-hub.cn')) &&
        /^[^/]+\/.+\.(jpe?g|png|webp|gif)$/i.test(p)
      ) {
        return p;
      }
    } catch (e) { /* ignore */ }
    const markers = [
      `/storage/v1/object/public/${BUCKET}/`,
      `/storage/v1/object/sign/${BUCKET}/`,
      `/storage/v1/object/authenticated/${BUCKET}/`
    ];
    for (const marker of markers) {
      const i = url.indexOf(marker);
      if (i !== -1) return url.slice(i + marker.length).split('?')[0];
    }
    return null;
  }

  function storagePathFromRef(value) {
    return storagePathFromUrl(value);
  }

  function toStorageRef(path) {
    return STORAGE_PREFIX + path.replace(/^\//, '');
  }

  function publicUrlFromPath(path) {
    if (!path || !window.SUPABASE_URL) return null;
    const base = window.SUPABASE_URL.replace(/\/$/, '');
    return `${base}/storage/v1/object/public/${BUCKET}/${path.replace(/^\//, '')}`;
  }

  function isResolvableStorageRef(value) {
    return !!value && typeof value === 'string' && value.startsWith(STORAGE_PREFIX);
  }

  function normalizeImageRef(value) {
    if (!value || typeof value !== 'string') return value;
    if (isCdnMediaUrl(value)) {
      const fromCdn = storagePathFromDisplayUrl(value);
      if (fromCdn) return toStorageRef(fromCdn);
    }
    const path = storagePathFromRef(value);
    if (path) return toStorageRef(path);
    const bare = value.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[^/?#]+\.(jpe?g|png|webp|gif)$/i.test(bare)) {
      return toStorageRef(bare);
    }
    if (/^https?:\/\//i.test(bare) && isInvalidMediaUrl(bare)) {
      try {
        const p = new URL(bare).pathname.replace(/^\//, '');
        if (/^[^/]+\/.+\.(jpe?g|png|webp|gif)$/i.test(p)) return toStorageRef(p);
      } catch (e) { /* ignore */ }
    }
    return value;
  }

  function clearListImageMissMarks() {
    missingPathCache.clear();
    gridFetchFailedPaths.clear();
    persistSessionSignCache();
  }

  function clearSignedUrlCache() {
    signedUrlCache.clear();
    missingPathCache.clear();
    imageUploadSkipUntil.clear();
  }

  try {
    if (localStorage.getItem('promptrepo_sign_v') !== '9') {
      clearSignedUrlCache();
      missingPathCache.clear();
      gridFetchFailedPaths.clear();
      try { localStorage.removeItem(LS_MISSING_PATHS); } catch (e) { /* ignore */ }
      localStorage.setItem('promptrepo_sign_v', '9');
    }
  } catch (e) { /* ignore */ }

  function shouldSkipImageUploadAttempt(cardId) {
    if (!cardId) return false;
    const until = imageUploadSkipUntil.get(String(cardId));
    if (!until) return false;
    if (until > Date.now()) return true;
    imageUploadSkipUntil.delete(String(cardId));
    return false;
  }

  function markImageUploadSkip(cardId) {
    if (cardId) imageUploadSkipUntil.set(String(cardId), Date.now() + IMAGE_UPLOAD_SKIP_MS);
  }

  function payloadNeedsImageUpload(cards, opts = {}) {
    const includeRemoteHttp = opts.includeRemoteHttp === true;
    return (cards || []).some((c) => {
      if (!c?.id || !c?.image) return false;
      if (isDataUrl(c.image) || (typeof c.image === 'string' && c.image.startsWith('blob:'))) {
        return true;
      }
      if (includeRemoteHttp && typeof c.image === 'string' && /^https?:\/\//i.test(c.image)) {
        return true;
      }
      if (!isStorageRef(c.image)) return false;
      const primary = primaryImagePath(c.image, c.id);
      return !!(primary && isPathKnownMissing(primary));
    });
  }

  function cardNeedsCloudImageUpload(card) {
    if (!card?.id || !card.image) return false;
    if (isDataUrl(card.image) || (typeof card.image === 'string' && card.image.startsWith('blob:'))) {
      return true;
    }
    if (typeof card.image === 'string' && /^https?:\/\//i.test(card.image)) {
      if (isCdnMediaUrl(card.image) || /supabase\.co\/storage\/v1\/object/i.test(card.image)) {
        return false;
      }
      if (/aitohumanize|filesystem\.site|apimart\.ai|grsai\.com/i.test(card.image)) {
        return false;
      }
      return true;
    }
    if (!isStorageRef(card.image)) return false;
    const primary = primaryImagePath(card.image, card.id);
    return !!(primary && isPathKnownMissing(primary));
  }

  function normalizePathKey(path) {
    return String(path || '').replace(/^\//, '').split('@')[0];
  }

  function isPathKnownMissing(path) {
    const key = normalizePathKey(path);
    if (!key) return false;
    const exp = missingPathCache.get(key);
    if (!exp) return false;
    if (exp > Date.now()) return true;
    missingPathCache.delete(key);
    return false;
  }

  function markPathMissing(path) {
    const key = normalizePathKey(path);
    if (!key) return;
    const exp = Date.now() + MISSING_PATH_PERSIST_TTL_MS;
    missingPathCache.set(key, exp);
    persistMissingPathCache();
  }

  function isStorageNotFoundError(e) {
    const msg = String(e?.message || e?.error || e?.error_description || '').toLowerCase();
    const code = e?.statusCode ?? e?.status;
    return code === 404 || code === 400 || /not found|object not found|does not exist/.test(msg);
  }

  function isInvalidMediaUrl(url) {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const path = u.pathname || '/';
      if (host === 'api.prompt-hub.cn' && !path.startsWith('/api/')) return true;
      if ((host === 'prompt-hub.cn' || host === 'www.prompt-hub.cn') && /\.(jpe?g|png|webp|gif)$/i.test(path)) {
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function stripGridSuffixFromPath(path) {
    let p = String(path || '').replace(/^\//, '');
    if (!/_grid\./i.test(p)) return p;
    if (/_grid\.webp$/i.test(p)) return p.replace(/_grid\.webp$/i, '.webp');
    if (/_grid\.png$/i.test(p)) return p.replace(/_grid\.png$/i, '.png');
    return p.replace(/_grid\.jpe?g$/i, '.jpg');
  }

  function primaryImagePath(image, assetId) {
    if (image != null && typeof image !== 'string') return null;
    const fromRef = storagePathFromRef(image);
    if (fromRef) return stripGridSuffixFromPath(fromRef);
    const canonical = cardImageStoragePath(assetId);
    return canonical ? canonical.replace(/^\//, '') : null;
  }

  function gridPathFromPrimary(path) {
    if (!path || /_grid\.(jpe?g|webp|png)$/i.test(path)) return null;
    const m = String(path).replace(/^\//, '').match(/^(.+\/)([^/]+)\.(jpe?g|webp|png)$/i);
    if (!m) return null;
    return `${m[1]}${m[2]}_grid.jpg`;
  }

  function gridImageStoragePath(cardId, ownerId) {
    const primary = cardImageStoragePath(cardId, ownerId);
    return primary ? gridPathFromPrimary(primary) : null;
  }

  function pathsForVariant(image, assetId, ownerId, variant, jobId) {
    const all = listImagePathCandidates(image, assetId, ownerId, jobId);
    const skipMissing = (paths) => paths.filter((p) => !isPathKnownMissing(String(p || '').replace(/^\//, '')));
    if (variant === VARIANT_FULL) {
      return skipMissing(all.filter((p) => !/_grid\.(jpe?g|webp|png)$/i.test(p)));
    }
    const gridFirst = [];
    const seen = new Set();
    const add = (p) => {
      const key = (p || '').replace(/^\//, '');
      if (key && !seen.has(key)) {
        seen.add(key);
        gridFirst.push(key);
      }
    };
    for (const p of all) {
      if (/_grid\.(jpe?g|webp|png)$/i.test(p)) add(p);
    }
    const primary = primaryImagePath(image, assetId);
    if (primary) {
      const grid = gridPathFromPrimary(primary.replace(/^\//, ''));
      if (grid) add(grid);
    }
    return skipMissing(gridFirst);
  }

  function isGridThumbReady(cardId) {
    if (!cardId) return false;
    const id = String(cardId);
    try {
      const rawLocal = localStorage.getItem(LS_GRID_DONE);
      const mapLocal = rawLocal ? JSON.parse(rawLocal) : {};
      if (mapLocal[id]) return true;
    } catch (e) { /* ignore */ }
    try {
      const raw = sessionStorage.getItem(SS_GRID_DONE);
      const map = raw ? JSON.parse(raw) : {};
      return !!map[id];
    } catch (e) {
      return false;
    }
  }

  function markGridThumbReady(cardId) {
    if (!cardId) return;
    const id = String(cardId);
    const stamp = Date.now();
    try {
      const rawLocal = localStorage.getItem(LS_GRID_DONE);
      const mapLocal = rawLocal ? JSON.parse(rawLocal) : {};
      mapLocal[id] = stamp;
      localStorage.setItem(LS_GRID_DONE, JSON.stringify(mapLocal));
    } catch (e) { /* ignore */ }
    try {
      const raw = sessionStorage.getItem(SS_GRID_DONE);
      const map = raw ? JSON.parse(raw) : {};
      map[id] = stamp;
      sessionStorage.setItem(SS_GRID_DONE, JSON.stringify(map));
    } catch (e) { /* ignore */ }
  }

  function isGridBackfillSkipped(cardId) {
    if (!cardId) return false;
    try {
      const raw = sessionStorage.getItem(SS_GRID_SKIP);
      const map = raw ? JSON.parse(raw) : {};
      return !!map[String(cardId)];
    } catch (e) {
      return false;
    }
  }

  function clearGridBackfillSkipped(cardId) {
    if (!cardId) return;
    try {
      const raw = sessionStorage.getItem(SS_GRID_SKIP);
      const map = raw ? JSON.parse(raw) : {};
      if (map[String(cardId)]) {
        delete map[String(cardId)];
        sessionStorage.setItem(SS_GRID_SKIP, JSON.stringify(map));
      }
    } catch (e) { /* ignore */ }
  }

  function markGridBackfillSkipped(cardId, reason) {
    if (!cardId) return;
    try {
      const raw = sessionStorage.getItem(SS_GRID_SKIP);
      const map = raw ? JSON.parse(raw) : {};
      map[String(cardId)] = { at: Date.now(), reason: String(reason || 'no_source') };
      sessionStorage.setItem(SS_GRID_SKIP, JSON.stringify(map));
    } catch (e) { /* ignore */ }
  }

  async function downloadOriginalForBackfill(card) {
    const cardId = card?.id;
    const image = card?.image;
    if (!cardId || !image) return null;
    const dlOpts = { ignoreMissingCache: true, markMissing: false, cardId };
    const primary = primaryImagePath(image, cardId);
    if (primary) {
      const blob = await downloadOwnedStorageBlob(primary.replace(/^\//, ''), dlOpts);
      if (blob) return { blob, path: primary.replace(/^\//, '') };
    }
    const uid = getUserId();
    if (uid) {
      const cid = String(cardId).replace(/^wh_/, '');
      const genJobId = resolveJobIdForAsset({ cardId }, cardId);
      if (genJobId) {
        const genKey = generationStorageAssetId(genJobId, '');
        for (const ext of ['png', 'jpg', 'webp']) {
          const genPath = `${uid}/generated/${genKey}.${ext}`;
          if (!primary || genPath !== primary.replace(/^\//, '')) {
            const blob = await downloadOwnedStorageBlob(genPath, dlOpts);
            if (blob) return { blob, path: genPath };
          }
        }
      }
      const genPath = `${uid}/generated/${cid}.jpg`;
      if (!primary || genPath !== primary.replace(/^\//, '')) {
        const blob = await downloadOwnedStorageBlob(genPath, dlOpts);
        if (blob) return { blob, path: genPath };
      }
    }
    return null;
  }

  function refreshCardGridImages(cardId) {
    const id = String(cardId || '');
    if (!id) return;
    const roots = [
      document.getElementById('cardsContainer'),
      document.getElementById('imageGenFeed')
    ].filter(Boolean);
    for (const root of roots) {
      root.querySelectorAll('img[data-image-ref]').forEach((img) => {
        const cid = img.dataset?.sourceCardId
          || img.closest('.card[data-id]')?.dataset?.id
          || img.closest('.imagegen-feed-card[data-feed-id]')?.dataset?.feedId?.replace(/^wh_/, '');
        if (cid !== id) return;
        const ref = img.getAttribute('data-image-ref');
        if (!ref) return;
        const url = getCachedDisplayUrl(ref, { assetId: id, variant: VARIANT_GRID });
        if (url && window.CardImageLoader?.applyUrlToImg) {
          window.CardImageLoader.applyUrlToImg(img, url);
          return;
        }
        void resolveDisplayUrl(ref, {
          assetId: id,
          variant: VARIANT_GRID,
          listOnly: true,
          allowFullFallback: false,
          degradedListFull: false
        }).then((u) => {
          if (u && window.CardImageLoader?.applyUrlToImg) window.CardImageLoader.applyUrlToImg(img, u);
        });
      });
    }
  }

  /** 生图卡：经 warehouse-thumbs 确保 _grid（禁止再走 resolveDisplayUrl，避免递归） */
  async function warmGeneratedGridThumb(card) {
    const cardId = card?.id ? String(card.id) : '';
    if (!cardId || warmGenThumbInflight.has(cardId)) return;
    warmGenThumbInflight.add(cardId);
    try {
      if (window.WarehouseThumb?.resolveForCardModel) {
        await window.WarehouseThumb.resolveForCardModel(card);
        return;
      }
      const path = primaryImagePath(card?.image, cardId);
      if (!path || !storagePathOwnedByCurrentUser(path)) return;
      if (!String(path).replace(/^\//, '').includes('/generated/')) return;
      const jobId = card?.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : null;
      if (jobId && window.WarehouseThumb?.resolveForCard) {
        await window.WarehouseThumb.resolveForCard(card.image, { jobId, assetId: cardId, cardId });
      }
    } finally {
      warmGenThumbInflight.delete(cardId);
    }
  }

  function queueGridBackfill(card, opts) {
    if (!AUTO_GRID_BACKFILL) return;
    if (!card?.id || !card?.image || !isLoggedIn()) return;
    const cardKey = String(card.id);
    const force = opts?.force === true;
    const path = primaryImagePath(card.image, card.id);
    if (!path || !storagePathOwnedByCurrentUser(path)) return;
    if (String(path).replace(/^\//, '').includes('/generated/')) {
      if (!force && !queueGridBackfillInflight.has(cardKey)) {
        queueGridBackfillInflight.add(cardKey);
        void warmGeneratedGridThumb(card).finally(() => {
          queueGridBackfillInflight.delete(cardKey);
        });
      }
      return;
    }
    if (force && isGridBackfillSkipped(card.id)) clearGridBackfillSkipped(card.id);
    if (!force && gridBackfillSessionCount >= GRID_BACKFILL_SESSION_CAP) return;
    if (!force && isGridBackfillSkipped(card.id)) return;
    if (!force && isGridThumbReady(card.id)) return;
    const grid = gridPathFromPrimary(path);
    if (!grid) return;
    const key = String(card.id);
    if (gridBackfillQueue.some((c) => String(c.id) === key)) return;
    gridBackfillQueue.push(card);
    void drainGridBackfillQueue();
  }

  function invalidateCorruptGrid(gridKey, cardId) {
    const key = normalizePathKey(gridKey);
    if (!key) return;
    markGridFetchFailed(key);
    markPathMissing(key);
    if (cardId) unmarkGridThumbReady(cardId);
  }

  function isValidGridBlob(blob) {
    const n = blob?.size || 0;
    return n >= GRID_MIN_VALID_BYTES && n <= GRID_MAX_VALID_BYTES;
  }

  function isValidImageBlob(blob, opts) {
    const min = opts?.grid ? GRID_MIN_VALID_BYTES : MIN_VALID_IMAGE_BYTES;
    return !!(blob && (blob.size || 0) >= min);
  }

  async function verifyMediaUrlReachable(url) {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    if (url.includes('data:image/svg')) return false;
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 9000) : null;
      const res = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-2047' },
        mode: 'cors',
        credentials: 'omit',
        signal: controller?.signal
      });
      if (timer) clearTimeout(timer);
      if (!(res.ok || res.status === 206)) return false;
      const ct = String(res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('json') || ct.includes('html')) return false;
      const buf = await res.arrayBuffer();
      if ((buf.byteLength || 0) < 128) return false;
      const head = new Uint8Array(buf.slice(0, 12));
      const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
      const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
      const webp = head.length >= 12 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
        && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
      return jpeg || png || webp;
    } catch (e) {
      return false;
    }
  }

  async function resolveListGridFallbackUrl(image, opts = {}) {
    if (!image) return '';
    const assetId = opts.assetId || opts.cardId;
    const url = await resolveDisplayUrl(image, {
      assetId,
      authorId: opts.authorId,
      cardId: opts.cardId || assetId,
      variant: VARIANT_GRID,
      listOnly: true,
      allowFullFallback: false,
      bypassSignBudget: true,
      tryAllPaths: true,
      communityFeed: opts.communityFeed === true
    });
    if (url && await verifyMediaUrlReachable(url)) return url;
    return '';
  }

  async function downloadBlobFromSignedPath(pathKey, opts = {}) {
    const key = String(pathKey || '').replace(/^\//, '');
    if (!key) return null;
    const variant = /_grid\.(jpe?g|webp|png)$/i.test(key) ? VARIANT_GRID : VARIANT_FULL;
    let url = await signPathViaApi(key, variant, {
      bypassSignBudget: true,
      cardId: opts.cardId
    });
    if (!url) {
      url = await resolvePathToUrl(key, variant, {
        bypassSignBudget: true,
        listOnly: variant === VARIANT_GRID,
        cardId: opts.cardId
      });
    }
    if (!url) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404 && opts.markMissing !== false) markPathMissing(key);
        return null;
      }
      return await res.blob();
    } catch (e) {
      return null;
    }
  }

  async function downloadOwnedStorageBlob(path, opts = {}) {
    const key = String(path || '').replace(/^\//, '');
    if (!key || !storagePathOwnedByCurrentUser(key)) return null;
    if (!opts.ignoreMissingCache && isPathKnownMissing(key)) return null;
    await ensureSession();
    const isGrid = /_grid\.(jpe?g|webp|png)$/i.test(key);
    const blob = await downloadBlobFromSignedPath(key, opts);
    if (!blob) return null;
    if (!isValidImageBlob(blob, { grid: isGrid })) {
      if (isGrid) {
        const card = findCardForGridPath(key);
        invalidateCorruptGrid(key, card?.id || opts.cardId);
      }
      return null;
    }
    if (isGrid && (blob.size || 0) > GRID_MAX_VALID_BYTES) {
      const card = findCardForGridPath(key);
      invalidateCorruptGrid(key, card?.id || opts.cardId);
      return null;
    }
    return blob;
  }

  async function backfillOneGridThumb(card) {
    const cardId = card?.id;
    const path = primaryImagePath(card?.image, cardId);
    const grid = gridPathFromPrimary(path);
    if (!cardId || !path || !grid || !storagePathOwnedByCurrentUser(path)) {
      if (cardId) markGridBackfillSkipped(cardId, 'invalid_path');
      return { ok: false, skip: true, reason: 'invalid_path' };
    }
    if (String(path).replace(/^\//, '').includes('/generated/')) {
      void warmGeneratedGridThumb(card);
      return { ok: false, skip: true, reason: 'generated_server_grid' };
    }
    const gridKey = grid.replace(/^\//, '');
    const probeOpts = { ignoreMissingCache: true, markMissing: false };
    if (isGridThumbReady(cardId)) {
      try {
        const existingGrid = await downloadOwnedStorageBlob(grid, probeOpts);
        if (existingGrid && isValidGridBlob(existingGrid)) {
          missingPathCache.delete(normalizePathKey(grid));
          void batchSignPaths([gridKey], VARIANT_GRID).then(() => refreshCardGridImages(cardId));
          return { ok: true, skip: true };
        }
        unmarkGridThumbReady(cardId);
        invalidateCorruptGrid(gridKey, cardId);
      } catch (e) {
        unmarkGridThumbReady(cardId);
        invalidateCorruptGrid(gridKey, cardId);
      }
    }
    const cached = signedUrlCache.get(signedCacheKey(gridKey, VARIANT_GRID));
    if (cached?.url && cached.expiresAt > Date.now() + 120000) {
      try {
        const probeCached = await downloadOwnedStorageBlob(grid, probeOpts);
        if (probeCached && isValidGridBlob(probeCached)) {
          markGridThumbReady(cardId);
          return { ok: true, skip: true };
        }
        invalidateSignedCache(gridKey);
        unmarkGridThumbReady(cardId);
      } catch (e) {
        invalidateSignedCache(gridKey);
        unmarkGridThumbReady(cardId);
      }
    }
    try {
      const existingGrid = await downloadOwnedStorageBlob(grid, probeOpts);
      if (existingGrid && isValidGridBlob(existingGrid)) {
        markGridThumbReady(cardId);
        missingPathCache.delete(normalizePathKey(grid));
        void batchSignPaths([gridKey], VARIANT_GRID).then(() => refreshCardGridImages(cardId));
        return { ok: true, skip: true };
      }
    } catch (e) { /* need backfill */ }
    let source = null;
    if (typeof window.getCardImageBackup === 'function') {
      try {
        const backup = await window.getCardImageBackup(cardId);
        if (backup && (String(backup).startsWith('data:') || String(backup).startsWith('blob:'))) {
          source = backup;
        }
      } catch (e) { /* ignore */ }
    }
    if (!source) {
      try {
        const found = await downloadOriginalForBackfill(card);
        if (found?.blob) source = found.blob;
      } catch (e) { /* ignore */ }
    }
    if (!source) {
      markGridBackfillSkipped(cardId, 'no_original');
      return { ok: false, skip: true, reason: 'no_original' };
    }
    try {
      const gridBlob = await compressImageToGrid(source);
      if (!isValidGridBlob(gridBlob) || !(await blobLooksLikeUsableImage(gridBlob))) {
        markGridBackfillSkipped(cardId, 'grid_too_small');
        return { ok: false, skip: true, reason: 'grid_too_small' };
      }
      await uploadStorageBlob(grid, gridBlob, { skipVerify: true });
      clearSignedCacheForPaths([grid, path]);
      missingPathCache.delete(normalizePathKey(grid));
      markGridThumbReady(cardId);
      gridBackfillSessionCount += 1;
      void batchSignPaths([gridKey], VARIANT_GRID).then(() => {
        refreshCardGridImages(cardId);
      });
      return { ok: true };
    } catch (e) {
      console.warn('[SupabaseSync] grid backfill failed', cardId, e);
      return { ok: false };
    }
  }

  async function drainGridBackfillQueue() {
    if (gridBackfillRunning || !gridBackfillQueue.length) return;
    gridBackfillRunning = true;
    try {
      while (gridBackfillQueue.length) {
        const batch = gridBackfillQueue.splice(0, 1);
        await Promise.all(batch.map((c) => backfillOneGridThumb(c)));
        await new Promise((r) => setTimeout(r, 280));
      }
    } finally {
      gridBackfillRunning = false;
    }
  }

  async function diagnoseGridBackfillPending(cards, opts = {}) {
    const max = Math.min(Math.max(1, Number(opts.max) || 24), 120);
    const all = (cards || []).filter((c) => c?.id && c?.image && isStorageRef(c.image));
    const pending = all.filter((c) => !isGridThumbReady(c.id) && !isGridBackfillSkipped(c.id));
    const skipped = all.filter((c) => isGridBackfillSkipped(c.id));
    const sample = [];
    const probeOpts = { ignoreMissingCache: true, markMissing: false };
    for (const c of pending.slice(0, max)) {
      const path = primaryImagePath(c.image, c.id);
      const grid = gridPathFromPrimary(path);
      let gridOk = false;
      let originalOk = false;
      let backupOk = false;
      try {
        const g = grid ? await downloadOwnedStorageBlob(grid, probeOpts) : null;
        gridOk = !!(g && isValidGridBlob(g));
      } catch (e) { /* ignore */ }
      try {
        const o = await downloadOriginalForBackfill(c);
        originalOk = !!o?.blob;
      } catch (e) { /* ignore */ }
      if (typeof window.getCardImageBackup === 'function') {
        try {
          const backup = await window.getCardImageBackup(c.id);
          backupOk = !!(backup && (String(backup).startsWith('data:') || String(backup).startsWith('blob:')));
        } catch (e) { /* ignore */ }
      }
      sample.push({
        id: c.id,
        path,
        grid,
        gridOk,
        originalOk,
        backupOk,
        canBackfill: gridOk || originalOk || backupOk
      });
    }
    return {
      total: all.length,
      done: all.filter((c) => isGridThumbReady(c.id)).length,
      skipped: skipped.length,
      pending: pending.length,
      sampleCanBackfill: sample.filter((s) => s.canBackfill).length,
      sampleGhost: sample.filter((s) => !s.canBackfill).length,
      sample
    };
  }

  async function backfillGridThumbsForCards(cards, opts = {}) {
    if (!isLoggedIn()) return { done: 0, queued: 0, pending: 0, skipped: 0 };
    if (opts.quiet !== false && opts.awaitDrain) window.CardImageLoader?.disconnect?.();
    const force = opts.force === true;
    const max = Math.min(Math.max(1, Number(opts.max) || 24), force ? 80 : 48);
    const all = (cards || []).filter((c) => c?.id && c?.image && isStorageRef(c.image));
    const pendingBefore = force
      ? all.filter((c) => !isGridThumbReady(c.id))
      : all.filter((c) => !isGridThumbReady(c.id) && !isGridBackfillSkipped(c.id));
    const list = pendingBefore.slice(0, max);
    for (const c of list) {
      if (force && isGridBackfillSkipped(c.id)) clearGridBackfillSkipped(c.id);
      queueGridBackfill(c, { force });
    }
    if (opts.awaitDrain) {
      while (gridBackfillRunning || gridBackfillQueue.length) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    const pendingAfter = all.filter((c) => !isGridThumbReady(c.id) && !isGridBackfillSkipped(c.id));
    const skipped = all.filter((c) => isGridBackfillSkipped(c.id)).length;
    return {
      done: all.filter((c) => isGridThumbReady(c.id)).length,
      queued: list.length,
      pending: pendingAfter.length,
      skipped,
      total: all.length,
      finished: pendingAfter.length < pendingBefore.length || skipped > 0
    };
  }

  function signedCacheKey(path, variant) {
    const p = String(path || '').replace(/^\//, '');
    return variant === VARIANT_FULL ? p : `${p}@g640`;
  }

  function displayVariantFromOpts(opts) {
    if (!opts || typeof opts !== 'object') return VARIANT_GRID;
    return opts.variant === VARIANT_FULL ? VARIANT_FULL : VARIANT_GRID;
  }

  async function getSignedUrlForPath(path, opts) {
    const variant = displayVariantFromOpts(opts);
    let fileKey = path.replace(/^\//, '');
    if (variant === VARIANT_GRID && !/_grid\.(jpe?g|webp|png)$/i.test(fileKey)) {
      const grid = gridPathFromPrimary(fileKey);
      if (grid && !isPathKnownMissing(grid.replace(/^\//, ''))) fileKey = grid.replace(/^\//, '');
    }
    if (isPathKnownMissing(fileKey)) return null;
    const cacheKey = signedCacheKey(fileKey, variant);
    const cached = signedUrlCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 120000) return cached.url;
    await ensureSession();
    const sb = getClient();
    const signOpts =
      USE_STORAGE_TRANSFORM && variant !== VARIANT_FULL
        ? { transform: { width: 640, quality: 78, resize: 'contain' } }
        : undefined;
    try {
      const signWork = sb.storage.from(BUCKET).createSignedUrl(fileKey, SIGNED_TTL_SEC, signOpts);
      const { data, error } = await Promise.race([
        signWork,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('sign_timeout')), SIGN_REQUEST_TIMEOUT_MS);
        })
      ]);
      if (error) throw error;
      if (!data?.signedUrl || isIncompleteSignedStorageUrl(data.signedUrl)) {
        throw new Error('invalid_signed_url');
      }
      signedUrlCache.set(cacheKey, {
        url: data.signedUrl,
        expiresAt: Date.now() + (SIGNED_TTL_SEC - 120) * 1000
      });
      return data.signedUrl;
    } catch (e) {
      if (isStorageNotFoundError(e)) {
        if (variant === VARIANT_GRID) {
          if (/_grid\.(jpe?g|webp|png)$/i.test(fileKey)) {
            markPathMissing(fileKey);
          } else {
            const expectedGrid = gridPathFromPrimary(fileKey);
            if (expectedGrid) markPathMissing(expectedGrid);
          }
          return null;
        }
        markPathMissing(fileKey);
        return null;
      }
      if (variant === VARIANT_GRID) {
        return null;
      }
      throw e;
    }
  }

  function isLegacyOffshoreStorageImage(image) {
    if (!image || typeof image !== 'string') return false;
    if (isStorageRef(image)) return true;
    return /supabase\.co\/storage\/v1\/object/i.test(image);

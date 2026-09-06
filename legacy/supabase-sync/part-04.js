      variant === VARIANT_GRID && (o.listOnly === true || o.allowFullFallback === false);
    if (
      listOnlyGridEarly
      && jobId
      && assetId
      && isLoggedIn()
      && bucketPathEarly
      && !storagePathOwnedByCurrentUser(bucketPathEarly)
    ) {
      const card = (window.__promptHubCards || []).find((c) => c.id === assetId);
      const stored = card ? cardListThumbStorageRef(card) : null;
      if (stored?.ref && stored.ref !== normalizedEarly) {
        return resolveDisplayUrl(stored.ref, nextOpts({
          jobId: stored.thumb?.slotJobId || jobId,
          galleryIndex: stored.thumb?.galleryIndex ?? o.galleryIndex
        }));
      }
    }
    if (
      listOnlyGridEarly
      && jobId
      && isLoggedIn()
      && window.WarehouseThumb?.resolveForCard
    ) {
      const ownedStorage = bucketPathEarly && storagePathOwnedByCurrentUser(bucketPathEarly);
      if (!ownedStorage) {
        const wh = await window.WarehouseThumb.resolveForCard(image, {
          jobId: storageJobId || jobId,
          assetId,
          cardId: o.cardId || assetId,
          galleryIndex: o.galleryIndex || 0
        });
        if (wh && isGridDisplayUrl(wh)) {
          if (assetId) markGridThumbReady(assetId);
          return wh;
        }
      }
    }
    let communityFeed = isCommunityFeedOpts(o);
    if (
      communityFeed
      && bucketPathEarly
      && isLoggedIn()
      && storagePathOwnedByCurrentUser(bucketPathEarly)
    ) {
      communityFeed = false;
    }
    const assetIdEarly = o.assetId;
    if (
      variant === VARIANT_GRID
      && assetIdEarly
      && !isGridThumbReady(assetIdEarly)
      && !communityFeed
      && o.allowFullFallback !== false
      && o.listOnly !== true
      && o.preferFull === true
    ) {
      return resolveDisplayUrl(image, nextOpts({
        variant: VARIANT_FULL,
        allowFullFallback: false,
        preferFull: false
      }));
    }
    const normalized = normalizeImageRef(image);
    const bucketPath = storagePathFromRef(normalized);
    if (bucketPath && (isLoggedIn() || communityFeed)) {
      const primary = primaryImagePath(normalized, assetId);
      const fromRef = bucketPath.replace(/^\//, '');
      const all = listImagePathCandidates(normalized, assetId, authorId, storageJobId).filter(
        (p) => !isPathKnownMissing(p)
      );
      const variantPaths = pathsForVariant(normalized, assetId, authorId, variant, storageJobId);
      let candidates;
      const listOnlyGrid = variant === VARIANT_GRID && (o.listOnly === true || o.allowFullFallback === false);
      if (
        listOnlyGrid
        && o.degradedListFull === true
        && primary
        && !communityFeed
        && isLoggedIn()
        && storagePathOwnedByCurrentUser(primary)
      ) {
        const degraded = await resolveListPrimaryFallback(primary, assetId, o);
        if (degraded) return degraded;
      }
      if (communityFeed && listOnlyGrid) {
        const one = fromRef ? fromRef.replace(/^\//, '') : (primary ? primary.replace(/^\//, '') : '');
        candidates = one ? [one] : [];
      } else if (o.tryAllPaths === true) {
        candidates = variantPaths.length ? variantPaths : (listOnlyGrid ? [] : all);
      } else if (fromRef) {
        candidates = variantPaths.length
          ? variantPaths
          : (listOnlyGrid ? [] : (assetId && all.length ? all : [fromRef]));
      } else if (primary) {
        candidates = variantPaths.length ? variantPaths.slice(0, variant === VARIANT_GRID ? 3 : 1) : [primary];
      } else if (communityFeed) {
        candidates = variantPaths.slice(0, 3);
      } else {
        candidates = variantPaths.slice(0, 1);
      }
      if (o.listOnly === true && candidates.length > 1) {
        candidates = candidates.slice(0, 1);
      }
      for (const path of candidates) {
        const pkey = path.replace(/^\//, '');
        const cached = signedUrlCache.get(signedCacheKey(pkey, variant));
        if (cached?.url && cached.expiresAt > Date.now() + 120000) {
          const out = filterGridVariantUrl(cached.url, variant);
          if (out) return out;
        }
      }
      for (const path of candidates) {
        const url = await resolvePathToUrl(path, variant, {
          communityFeed,
          authorId,
          cardId: assetId,
          listOnly: o.listOnly === true
        });
        if (url) return url;
      }
      /* 列表/grid 缺缩略图：只排队 backfill，禁止签 full 原图进 feed（单张 2MB+ 会卡死首屏） */
      if (
        listOnlyGrid
        && primary
        && !communityFeed
        && isLoggedIn()
        && storagePathOwnedByCurrentUser(primary)
      ) {
        /* 列表 resolve 热路径不排队 backfill，避免与 WarehouseThumb 并发打满 */
      }
      if (
        variant === VARIANT_GRID
        && !communityFeed
        && o.allowFullFallback !== false
        && o.listOnly !== true
        && o.preferFull === true
        && assetId
        && isLoggedIn()
      ) {
        const own = bucketPath && storagePathOwnedByCurrentUser(bucketPath);
        if (own) {
          return resolveDisplayUrl(image, nextOpts({
            variant: VARIANT_FULL,
            allowFullFallback: false,
            preferFull: false
          }));
        }
      }
      return null;
    }
    if (/^https?:\/\//i.test(image)) {
      if (isInvalidMediaUrl(image)) return null;
      if (o.listOnly === true && isEphemeralUpstreamImageUrl(image)) return null;
      const legacyPath = storagePathFromRef(image);
      if (legacyPath) {
        const uid = getUserId();
        const own = !!(uid && legacyPath.replace(/^\//, '').startsWith(`${uid}/`));
        const useCommunity = communityFeed || (isLoggedIn() && !own);
        const storageRef = toStorageRef(legacyPath);
        if (o._fromStorageRef === storageRef) return null;
        return resolveDisplayUrl(storageRef, nextOpts({
          communityFeed: useCommunity,
          tryAllPaths: useCommunity || o.tryAllPaths === true,
          _fromStorageRef: storageRef
        }));
      }
      if (isEphemeralUpstreamImageUrl(image)) return null;
      if (window.PromptHubApi?.fetchMediaAsBlobUrl && o.allowRemoteFetch === true) {
        const blobUrl = await window.PromptHubApi.fetchMediaAsBlobUrl(image);
        if (blobUrl) return blobUrl;
      }
      return null;
    }
    return image;
  }

  function communityPrefetchPaths(imagesOrPosts) {
    const paths = new Set();
    const list = Array.isArray(imagesOrPosts)
      ? imagesOrPosts
      : imagesOrPosts == null
        ? []
        : typeof imagesOrPosts === 'string'
          ? [imagesOrPosts]
          : [imagesOrPosts];
    for (const item of list) {
      if (typeof item === 'string') {
        const p = storagePathFromRef(item);
        if (p) {
          const pk = p.replace(/^\//, '');
          if (isGridStoragePath(pk)) paths.add(pk);
          else {
            const grid = gridPathFromPrimary(pk);
            if (grid && !isPathKnownMissing(grid)) paths.add(grid.replace(/^\//, ''));
          }
        }
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const ref = item.image;
      if (ref) {
        if (isInvalidMediaUrl(ref)) continue;
        const p = storagePathFromRef(ref);
        if (p) {
          const pk = p.replace(/^\//, '');
          if (isGridStoragePath(pk)) paths.add(pk);
          else {
            const grid = gridPathFromPrimary(pk);
            if (grid && !isPathKnownMissing(grid)) paths.add(grid.replace(/^\//, ''));
          }
          continue;
        }
      }
      const authorId = item.authorId && String(item.authorId) !== 'guest' ? String(item.authorId) : '';
      const cardId = item.sourceCardId ? String(item.sourceCardId) : '';
      if (authorId && cardId) {
        const base = String(cardId).replace(/[^a-zA-Z0-9_-]/g, '_');
        const grid = `${authorId}/${base}_grid.jpg`;
        if (!isPathKnownMissing(grid)) paths.add(grid);
      }
    }
    return [...paths];
  }

  async function runCommunitySignBatchQueued(items, capMs) {
    const list = (items || []).filter((item) => item && String(item.ref || '').trim());
    if (!list.length) return { ok: true, data: { urls: {}, refMap: {} } };
    if (Date.now() < communitySignBatchCooldownUntil) return null;
    if (window.PromptHubApi?.isApiRateLimited?.()) return null;
    if (!window.PromptHubApi?.signCommunityMediaRefsBatch) return null;

    const chunks = [];
    for (let i = 0; i < list.length; i += COMMUNITY_SIGN_BATCH_CHUNK) {
      chunks.push(list.slice(i, i + COMMUNITY_SIGN_BATCH_CHUNK));
    }

    communitySignBatchChain = communitySignBatchChain.then(async () => {
      let last = null;
      for (const chunk of chunks) {
        if (Date.now() < communitySignBatchCooldownUntil) break;
        if (window.PromptHubApi?.isApiRateLimited?.()) break;
        const gap = COMMUNITY_SIGN_BATCH_MIN_GAP_MS - (Date.now() - communitySignBatchLastAt);
        if (gap > 0) await new Promise((r) => setTimeout(r, gap));
        communitySignBatchLastAt = Date.now();
        const r = await window.PromptHubApi.signCommunityMediaRefsBatch(chunk, {
          timeoutMs: Math.max(2500, Number(capMs) || 5000)
        });
        last = r;
        if (r?.ok) {
          applyCommunityBatchSignResult(r.data);
          continue;
        }
        if (r?.status === 429 || r?.status === 503 || r?.code === 'RATE_LIMITED') {
          communitySignBatchCooldownUntil = Date.now() + (r?.status === 503 ? 120000 : 75000);
          window.PromptHubApi?.markApiRateLimited?.(communitySignBatchCooldownUntil - Date.now());
          break;
        }
      }
      return last;
    }).catch(() => null);

    return communitySignBatchChain;
  }

  async function prefetchCommunityDisplayUrlsLegacy(images, capMs) {
    if (!window.PromptHubApi?.signCommunityMediaRefsBatch) return;
    const items = (images || []).slice(0, 24).map((raw) => {
      if (typeof raw === 'string') return { ref: raw };
      if (!raw || typeof raw !== 'object') return null;
      return {
        ref: raw.image || raw.ref || '',
        authorId: raw.authorId,
        cardId: raw.sourceCardId || raw.id
      };
    }).filter((x) => x?.ref);
    if (!items.length) return;
    await runCommunitySignBatchQueued(items, capMs);
  }

  function applyCommunityBatchSignResult(data) {
    if (!data) return 0;
    let n = 0;
    const urls = data.urls && typeof data.urls === 'object' ? data.urls : {};
    const refMap = data.refMap && typeof data.refMap === 'object' ? data.refMap : {};
    const cacheGridUrl = (pathOrRef, url) => {
      if (!url || isIncompleteSignedStorageUrl(url)) return;
      if (!isCdnMediaUrl(url)) return;
      const cdnPath = storagePathFromDisplayUrl(url);
      if (cdnPath && !isGridStoragePath(cdnPath)) return;
      const fromRef = storagePathFromRef(
        typeof pathOrRef === 'string' && pathOrRef.startsWith(STORAGE_PREFIX) ? pathOrRef : ''
      );
      const keys = new Set();
      const raw = String(fromRef || pathOrRef || '').replace(/^\//, '');
      if (raw) keys.add(raw);
      if (raw && isGridStoragePath(raw)) {
        const stem = raw.replace(/_grid\.(jpe?g|webp|png)$/i, '');
        ['.jpg', '.jpeg', '.webp', '.png'].forEach((ext) => keys.add(`${stem}${ext}`));
      } else if (raw) {
        const grid = gridPathFromPrimary(raw);
        if (grid) keys.add(grid.replace(/^\//, ''));
      }
      for (const key of keys) {
        cacheSignedPath(key, url, VARIANT_GRID);
        n += 1;
      }
    };
    for (const [path, url] of Object.entries(urls)) cacheGridUrl(path, url);
    for (const [ref, url] of Object.entries(refMap)) cacheGridUrl(ref, url);
    if (n) persistSessionSignCache();
    return n;
  }

  async function prefetchCommunityDisplayUrls(images, capMs) {
    const list = (images || []).slice(0, 100);
    if (!list.length) return;

    const batchItems = [];
    const ownBatch = [];
    const seen = new Set();
    const uid = getUserId();
    for (const raw of list) {
      let ref = '';
      let authorId = '';
      let cardId = '';
      if (typeof raw === 'string') {
        ref = raw;
      } else if (raw && typeof raw === 'object') {
        ref = raw.image || raw.ref || '';
        authorId = raw.authorId && String(raw.authorId) !== 'guest' ? String(raw.authorId) : '';
        cardId = raw.sourceCardId ? String(raw.sourceCardId) : (raw.id ? String(raw.id) : '');
      }
      if (!ref || isInvalidMediaUrl(ref)) continue;
      const signRef = ref;
      const path = storagePathFromRef(signRef);
      if (path && uid && storagePathOwnedByCurrentUser(path)) {
        ownBatch.push(typeof raw === 'object' ? raw : { image: ref, id: cardId || undefined });
        continue;
      }
      const key = `${ref}|${authorId}|${cardId}`;
      if (seen.has(key)) continue;
      if (path) {
        const fileKey = path.replace(/^\//, '');
        const cached = signedUrlCache.get(signedCacheKey(fileKey, VARIANT_GRID));
        if (cached?.expiresAt > Date.now() + 120000) continue;
      }
      seen.add(key);
      batchItems.push({
        ref: signRef,
        authorId: authorId || undefined,
        cardId: cardId || undefined
      });
    }

    if (!batchItems.length && !ownBatch.length) return;

    if (ownBatch.length) {
      await prefetchCardsImages(ownBatch, Math.max(2500, Number(capMs) || 5000), {
        maxCards: Math.min(ownBatch.length, 24)
      });
    }

    if (!batchItems.length) return;

    await runCommunitySignBatchQueued(batchItems.slice(0, COMMUNITY_SIGN_BATCH_CHUNK), capMs);
  }

  function collectPrefetchItemForRef(ref) {
    if (!ref) return null;
    const cards = window.__promptHubCards || [];
    const norm = normalizeImageRef(ref);
    const card = cards.find((c) => {
      if (!c?.image) return false;
      const ci = normalizeImageRef(c.image);
      return ci === norm || c.image === ref;
    });
    const collect = card && typeof window.getCommunityCollectImageResolveOpts === 'function'
      ? window.getCommunityCollectImageResolveOpts(card)
      : null;
    if (!collect?.authorId) return null;
    return {
      ref,
      authorId: collect.authorId,
      cardId: collect.cardId || collect.assetId || undefined
    };
  }

  function findCardForStoragePath(pathKey) {
    const key = String(pathKey || '').replace(/^\//, '');
    if (!key) return null;
    const cards = window.__promptHubCards || [];
    return cards.find((c) => {
      if (!c?.image) return false;
      const p = primaryImagePath(c.image, c.id);
      return p === key;
    }) || null;
  }

  async function prefetchDisplayUrls(images, opts) {
    if (!isLoggedIn()) return;
    const gridOnly = opts?.gridOnly === true;
    const communityBatch = [];
    const seenCommunity = new Set();
    const ownedGridPaths = [];
    const ownedFullPaths = [];
    for (const raw of images || []) {
      const ref = typeof raw === 'string' ? raw : (raw?.image || raw?.ref || '');
      if (!ref) continue;
      const path = storagePathFromRef(ref);
      if (!path) continue;
      const key = path.replace(/^\//, '');
      if (storagePathOwnedByCurrentUser(path)) {
        const card = findCardForStoragePath(key);
        const plan = ownedListSignTargets(key, card?.id, { gridOnly });
        if (plan.grid) ownedGridPaths.push(plan.grid);
        /* backfill 由视口触发，不在 prefetchDisplayUrls 批量排队 */
        continue;
      }
      const item = collectPrefetchItemForRef(ref);
      if (!item) continue;
      const ck = `${item.ref}|${item.authorId}|${item.cardId || ''}`;
      if (seenCommunity.has(ck)) continue;
      seenCommunity.add(ck);
      communityBatch.push(item);
    }
    if (communityBatch.length) {
      await prefetchCommunityDisplayUrls(communityBatch, 5000);
    }
    async function signOwnedBatch(paths, variant) {
      const list = [...new Set(paths)];
      if (!list.length) return;
      const pending = list.filter((p) => {
        if (isPathKnownMissing(p)) return false;
        const cached = signedUrlCache.get(signedCacheKey(p, variant));
        return !(cached?.url && cached.expiresAt > Date.now() + 120000);
      });
      if (!pending.length) return;
      await ensureSession();
      await batchSignPaths(pending, variant);
    }
    await signOwnedBatch(ownedGridPaths, VARIANT_GRID);
    await signOwnedBatch(ownedFullPaths, VARIANT_FULL);
  }

  function getCachedDisplayUrl(image, assetIdOrOpts) {
    if (!image || typeof image !== 'string') return image;
    if (isDataUrl(image) || image.startsWith('blob:')) return image;
    const opts = typeof assetIdOrOpts === 'object' ? assetIdOrOpts : { assetId: assetIdOrOpts };
    const assetId = opts?.assetId;
    const storageJobId = resolveStorageJobIdForAsset(opts, assetId)
      || resolveJobIdForAsset(opts, assetId);
    const variant = displayVariantFromOpts(opts);
    const primary = primaryImagePath(image, assetId);
    const pathFromImage = storagePathFromRef(image);
    const canLookup = !!(pathFromImage || assetId || primary);
    if (canLookup) {
      if (primary) {
        const pkey = primary.replace(/^\//, '');
        if (variant === VARIANT_GRID && gridListNeedsPrimaryFallback(primary, assetId)) {
          /* 列表 grid 缺失时不回退 full（侧栏/灯箱单独 resolve full） */
        } else {
          const hit = signedUrlCache.get(signedCacheKey(pkey, variant));
          if (
            hit?.url
            && hit.expiresAt > Date.now() + 120000
            && !(variant === VARIANT_GRID && gridListNeedsPrimaryFallback(primary, assetId))
          ) {
            const out = filterGridVariantUrl(hit.url, variant);
            if (out) return out;
          }
        }
      }
      for (const path of pathsForVariant(image, assetId, opts?.authorId, variant, storageJobId)) {
        const key = path.replace(/^\//, '');
        if (variant === VARIANT_FULL && isGridStoragePath(key)) continue;
        if (variant === VARIANT_GRID && primary && gridListNeedsPrimaryFallback(primary, assetId)) continue;
        const cached = signedUrlCache.get(signedCacheKey(key, variant));
        if (cached?.url && cached.expiresAt > Date.now() + 120000) {
          const cdnPath = storagePathFromDisplayUrl(cached.url);
          if (
            variant === VARIANT_GRID
            && primary
            && cdnPath
            && isGridStoragePath(cdnPath)
            && gridListNeedsPrimaryFallback(primary, assetId)
          ) {
            continue;
          }
          const out = filterGridVariantUrl(cached.url, variant);
          if (out) return out;
        }
      }
    }
    const path = pathFromImage || (primary ? primary.replace(/^\//, '') : null);
    if (!path) {
      if (/^https?:\/\//i.test(image) && isValidSignedDisplayUrl(image)) return image;
      return '';
    }
    const cached = signedUrlCache.get(signedCacheKey(path.replace(/^\//, ''), variant));
    if (cached?.url && cached.expiresAt > Date.now() + 120000 && !isIncompleteSignedStorageUrl(cached.url)) {
      return filterGridVariantUrl(cached.url, variant);
    }
    if (variant === VARIANT_GRID) {
      return '';
    }
    if (/^https?:\/\//i.test(image) && isValidSignedDisplayUrl(image)) return image;
    return '';
  }

  /** 列表 DOM 首屏 src：仅 grid；禁止默认降级 full（单张 2MB+ 会撑爆首屏） */
  function getListDisplayImageSrc(image, assetId, extraOpts) {
    if (!image || typeof image !== 'string') return '';
    const o = extraOpts && typeof extraOpts === 'object' ? extraOpts : {};
    const id = o.assetId || assetId;
    const storageJobId = resolveStorageJobIdForAsset(o, id);
    const primary = id ? primaryImagePath(normalizeImageRef(image), id) : null;
    const pkey = primary ? primary.replace(/^\//, '') : '';
    if (pkey && isPathKnownMissing(pkey)) return '';
    const gridKey = pkey ? (gridPathFromPrimary(pkey) || '').replace(/^\//, '') : '';
    const grid = getCachedDisplayUrl(image, {
      assetId: id,
      authorId: o.authorId,
      jobId: storageJobId || o.jobId,
      variant: VARIANT_GRID
    });
    if (grid && isValidSignedDisplayUrl(grid) && !isInvalidMediaUrl(grid) && isGridDisplayUrl(grid)) {
      return grid;
    }
    if (gridKey && (isPathKnownMissing(gridKey) || isGridFetchFailed(gridKey))) return '';
    if (o.allowFullFallback === true && isLoggedIn() && id) {
      const normalized = normalizeImageRef(image);
      const primary = primaryImagePath(normalized, id);
      const pkey = primary ? primary.replace(/^\//, '') : '';
      if (primary && storagePathOwnedByCurrentUser(primary) && pkey && !isPathKnownMissing(pkey)) {
        const full = getCachedDisplayUrl(normalized, {
          assetId: id,
          authorId: o.authorId,
          jobId: storageJobId || o.jobId,
          variant: VARIANT_FULL
        });
        if (full && isValidSignedDisplayUrl(full) && !isInvalidMediaUrl(full)) return full;
      }
    }
    return '';
  }

  /** 列表缩略图 ref 已是自有 storage:// → 与普通卡同走 batch 签 grid */
  function cardListThumbStorageRef(card) {
    if (!card?.id) return null;
    const thumb = window.PromptHubCardGallery?.pickWarehouseListThumb?.(card);
    const ref = thumb?.ref || (isStorageRef(card.image) ? card.image : null);
    if (!ref || !isStorageRef(ref)) return null;
    const path = storagePathFromRef(ref);
    if (!path || !storagePathOwnedByCurrentUser(path)) return null;
    const pkey = path.replace(/^\//, '');
    if (isPathKnownMissing(pkey)) return null;
    return { ref, thumb };
  }

  /** 收集卡片 gallery 内所有可 batch 签名的 grid 路径（含 MJ 多槽） */
  function collectCardOwnedListSignPaths(card) {
    const paths = new Set();
    if (!card?.id) return paths;
    const addRef = (ref) => {
      if (!ref || !isStorageRef(ref)) return;
      const path = storagePathFromRef(ref);
      if (!path || !storagePathOwnedByCurrentUser(path)) return;
      const pkey = path.replace(/^\//, '');
      if (isPathKnownMissing(pkey)) return;
      const plan = ownedListSignTargets(pkey, card.id);
      if (plan.grid) paths.add(plan.grid);
      else if (!plan.primary) {
        const gk = (gridPathFromPrimary(pkey) || '').replace(/^\//, '');
        if (gk && !isPathKnownMissing(gk)) paths.add(gk);
      }
    };
    const thumb = window.PromptHubCardGallery?.pickWarehouseListThumb?.(card);
    if (thumb?.ref) addRef(thumb.ref);
    const gallery = window.PromptHubCardGallery?.normalizeCardGallery?.(card) || [];
    for (const u of gallery) addRef(u);
    if (isStorageRef(card.image)) addRef(card.image);
    return paths;
  }

  function cardHasOwnedGalleryStorage(card) {
    return collectCardOwnedListSignPaths(card).size > 0;
  }

  function isGeneratedStoragePath(pathOrRef) {
    const raw = String(pathOrRef || '').trim();
    if (!raw) return false;
    const path = storagePathFromRef(raw) || raw.replace(/^\//, '');
    return path.includes('/generated/');
  }

  /** 生图卡常带 storage://…/generated/…，R2 可能尚未归档；不能走 sign-batch */
  function cardUsesGeneratedStorage(card) {
    const jobId = card?.genJobId
      || window.PromptHubCardGallery?.resolveGenJobIdFromCard?.(card);
    if (!jobId) return false;
    const thumb = window.PromptHubCardGallery?.pickWarehouseListThumb?.(card);
    const ref = thumb?.ref || card.image;
    return isGeneratedStoragePath(ref);
  }

  function cardHasGeneratedGalleryStorage(card) {
    const gallery = window.PromptHubCardGallery?.normalizeCardGallery?.(card) || [];
    for (const u of gallery) {
      if (u && isGeneratedStoragePath(u)) return true;
    }
    return false;
  }

  /** 生图 /generated/ 路径：优先 sign-batch（服务端 ensureGrid 会现场出 grid）；仅无 storage 引用时才走 warehouse-thumbs */
  function cardNeedsWarehouseThumbServer(card) {
    if (cardListThumbStorageRef(card)) return false;
    const ownedPaths = collectCardOwnedListSignPaths(card);
    if (ownedPaths.size) return false;
    if (cardHasOwnedGalleryStorage(card)) return false;
    const jobId = card?.genJobId
      || window.PromptHubCardGallery?.resolveGenJobIdFromCard?.(card);
    return !!jobId;
  }

  /** 按卡片 id 收集 canonical 路径，一次 batch 签名（避免列表每张图多次试探） */
  async function prefetchCardsImages(cards, capMs, opts) {
    if (!isLoggedIn()) return;
    const maxCards = Math.min(
      warehousePrefetchCardCap(),
      Math.max(1, Number(opts?.maxCards) || warehousePrefetchCardCap())
    );
    const limit = capMs != null ? Math.min(Math.max(800, capMs), 8000) : 2800;
    const pathSet = new Set();
    const communityBatch = [];
    const seenCommunity = new Set();
    const list = (cards || []).slice(0, maxCards);
    const genCards = [];
    for (const c of list) {
      if (!c?.id) continue;
      if (cardNeedsWarehouseThumbServer(c)) {
        genCards.push(c);
        continue;
      }
      const ownedPaths = collectCardOwnedListSignPaths(c);
      if (ownedPaths.size) {
        if (!isGridBackfillSkipped(c.id)) {
          ownedPaths.forEach((p) => pathSet.add(p));
        }
        continue;
      }
      if (isGridBackfillSkipped(c.id)) continue;
      const collectOpts = typeof window.getCommunityCollectImageResolveOpts === 'function'
        ? window.getCommunityCollectImageResolveOpts(c)
        : null;
      if (collectOpts?.authorId) {
        const ck = `${c.image}|${collectOpts.authorId}|${collectOpts.cardId || collectOpts.assetId || ''}`;
        if (!seenCommunity.has(ck)) {
          seenCommunity.add(ck);
          communityBatch.push({
            ref: c.image,
            authorId: collectOpts.authorId,
            cardId: collectOpts.cardId || collectOpts.assetId
          });
        }
        continue;
      }
      const p = primaryImagePath(c.image, c.id);
      if (!p || isPathKnownMissing(p)) continue;
      if (!storagePathOwnedByCurrentUser(p)) continue;
      const plan = ownedListSignTargets(p, c.id);
      if (plan.grid) pathSet.add(plan.grid);
      else if (!plan.primary) {
        const gk = (gridPathFromPrimary(p) || '').replace(/^\//, '');
        if (gk && !isPathKnownMissing(gk)) pathSet.add(gk);
      }
      /* backfill 仅由视口 prefetchOneCardImg 触发，避免刷新时批量拉原图 */
    }
    if (genCards.length && window.WarehouseThumb?.prefetchForCards) {
      await window.WarehouseThumb.prefetchForCards(genCards, {
        max: Math.min(genCards.length, maxCards)
      });
    }
    if (communityBatch.length) {
      await prefetchCommunityDisplayUrls(communityBatch, limit);
    }
    /* 列表 prefetch 只签 grid，不批量签 full（否则首屏 24 张 × 2MB ≈ 48MB） */
    if (pathSet.size) {
      await batchSignPaths([...pathSet], VARIANT_GRID);
    }
    /* 列表 prefetch 禁止 batch 签 full（legacy 缺 grid 时等 CDN/侧栏，勿首屏拉原图） */
  }

  /** 卡片库首屏：签当前页可见卡（默认最多 24 张） */
  async function prefetchWarehousePage(cards, capMs, opts) {
    if (!isLoggedIn()) return;
    const mobile = typeof window !== 'undefined' && window.MobileUI?.isMobileViewport?.();
    const cap = Number(opts?.maxCards) > 0
      ? Number(opts.maxCards)
      : warehousePrefetchCardCap();
    const maxCards = Math.min(cap, Math.max(1, (cards || []).length));
    const list = (cards || []).slice(0, maxCards);
    if (!list.length) return;
    const budget = capMs == null ? (mobile ? 4200 : 2800) : Math.min(capMs, mobile ? 4800 : 4000);
    await prefetchCardsImages(list, budget, { maxCards });
  }

  function imgPlaceholderSrc() {
    return 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect fill="#18181c" width="4" height="3"/></svg>'
    );
  }

  function isPlaceholderImgSrc(src) {
    return !src || (typeof src === 'string' && src.includes('data:image/svg'));
  }

  function isResolvableDisplayUrl(url) {
    return !!(
      url &&
      typeof url === 'string' &&
      !url.startsWith(STORAGE_PREFIX) &&
      !isPlaceholderImgSrc(url) &&
      !isInvalidMediaUrl(url) &&
      !isIncompleteSignedStorageUrl(url) &&
      (isCdnMediaUrl(url) || isValidSignedDisplayUrl(url))
    );
  }

  function setCardMediaLoadState(media, state) {
    if (!media) return;
    media.classList.remove('card-media--missing', 'card-media--load-failed');
    if (state === 'loading') {
      media.classList.add('is-loading');
      return;
    }
    media.classList.remove('is-loading');
    if (state === 'failed') {
      if (media.closest('#communityGrid, #creationsGrid, #userProfileGrid')) {
        media.classList.add('card-media--load-failed');
        return;
      }
      media.classList.add('card-media--load-failed');
    }
  }

  function safeImgSrc(image) {
    if (!image) return '';
    if (isDataUrl(image) || image.startsWith('blob:')) return image;
    if (/^https?:\/\//i.test(image)) {
      if (isInvalidMediaUrl(image) || isIncompleteSignedStorageUrl(image)) return imgPlaceholderSrc();
      if (isEphemeralUpstreamImageUrl(image)) return imgPlaceholderSrc();
      const path = storagePathFromRef(image);
      if (path) {
        const cached = filterGridVariantUrl(
          getCachedDisplayUrl(toStorageRef(path), { variant: VARIANT_GRID }),
          VARIANT_GRID
        );
        if (cached && !cached.startsWith(STORAGE_PREFIX)) return cached;
        return imgPlaceholderSrc();
      }
      return image;
    }
    if (isStorageRef(image)) {
      const cached = filterGridVariantUrl(getCachedDisplayUrl(image, { variant: VARIANT_GRID }), VARIANT_GRID);
      if (cached && !cached.startsWith(STORAGE_PREFIX)) return cached;
      return imgPlaceholderSrc();
    }
    return image;
  }

  function patchImageSrcFromCache(root, opts) {
    const scope = root || document;
    let imgs = [...scope.querySelectorAll('img[data-image-ref], img[data-storage-ref]')];
    if (opts?.visibleFirst) {
      imgs.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const aVis = ar.top < window.innerHeight + 120 && ar.bottom > -80;
        const bVis = br.top < window.innerHeight + 120 && br.bottom > -80;
        if (aVis !== bVis) return aVis ? -1 : 1;
        return ar.top - br.top;
      });
      if (opts.max > 0) imgs = imgs.slice(0, opts.max);
    }
    imgs.forEach((img) => {
      const ref = img.getAttribute('data-image-ref') || img.getAttribute('data-storage-ref');
      if (!ref) return;
      const cur = img.currentSrc || img.src || '';
      if (isUsableLoadedImgSrc(cur, img)) return;
      const assetId = img.dataset?.sourceCardId
        || img.closest('.card[data-source-card-id]')?.dataset?.sourceCardId
        || img.closest('.card[data-id]')?.dataset?.id
        || img.closest('.card[data-post-id]')?.dataset?.postId
        || img.closest('.imagegen-feed-card[data-feed-id]')?.dataset?.feedId?.replace(/^wh_/, '')
        || undefined;
      const inWarehouse = !!img.closest('#cardsContainer');
      const inImageGenWh = !!img.closest('#imageGenFeed .imagegen-feed-card[data-feed-id^="wh_"]');
      const inSide = !!img.closest('#communitySideBody, #creationsSideBody, .community-side-img-btn, #appreciateViewer, #imageLightbox');
      let url = '';

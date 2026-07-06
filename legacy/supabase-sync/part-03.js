  }

  function cardImageStillResolvable(image, assetId) {
    if (!image || typeof image !== 'string') return false;
    if (isDataUrl(image) || image.startsWith('blob:')) return true;
    if (/^https?:\/\//i.test(image)) {
      if (/supabase\.co\/storage\/v1\/object/i.test(image)) {
        const path = storagePathFromRef(image);
        if (!path) return false;
        const candidates = listImagePathCandidates(normalizeImageRef(toStorageRef(path)), assetId);
        if (!candidates.length) return false;
        return candidates.some((p) => !isPathKnownMissing(p));
      }
      return !isInvalidMediaUrl(image);
    }
    if (!isStorageRef(image)) return true;
    const candidates = listImagePathCandidates(normalizeImageRef(image), assetId);
    if (!candidates.length) return true;
    return candidates.some((p) => !isPathKnownMissing(p));
  }

  function isLegacyImageRestorePhase() {
    return Date.now() < LEGACY_IMAGE_RESTORE_UNTIL_MS;
  }

  function isLegacyStoredCardImage(card) {
    if (!card || !isLegacyImageRestorePhase()) return false;
    const image = card.image;
    if (!image || typeof image !== 'string') return false;
    if (/supabase\.co\/storage\/v1\/object/i.test(image)) return true;
    if (!isStorageRef(image)) return false;
    const created = Number(card.createdAt) || 0;
    return created > 0 && created < LEGACY_STORAGE_HIDE_BEFORE_MS;
  }

  /** 卡片库是否展示（过渡期隐藏旧 Supabase storage 无图卡，不删库） */
  function shouldShowCardInWarehouse(card) {
    if (!card) return false;
    if (isLegacyStoredCardImage(card)) return false;
    const image = card.image;
    if (!image || typeof image !== 'string') return true;
    if (isDataUrl(image) || image.startsWith('blob:')) return true;
    if (!isLegacyImageRestorePhase()) return true;
    /** 境外 Supabase 直链：egress 已断，6/25 前直接不展示 */
    if (/supabase\.co\/storage\/v1\/object/i.test(image)) return false;
    if (!isLegacyOffshoreStorageImage(image)) return true;
    return cardImageStillResolvable(image, card.id);
  }

  /** 社区 Feed 是否展示（与卡片库同一套旧图隐藏规则） */
  function shouldShowPostInCommunityFeed(post) {
    if (!post) return false;
    if (post.sourceCardId) {
      const cards = window.__promptHubCards;
      if (Array.isArray(cards)) {
        const card = cards.find((c) => String(c.id) === String(post.sourceCardId));
        if (card && shouldShowCardInWarehouse(card) === false) return false;
      }
    }
    const image = post.image;
    if (!image || typeof image !== 'string') return true;
    return shouldShowCardInWarehouse({
      id: post.sourceCardId || post.id,
      image: post.image,
      createdAt: post.createdAt
    }) !== false;
  }

  function cardImageStoragePath(cardId, ownerId, ext) {
    const uid = ownerId || getUserId();
    if (!uid || !cardId) return null;
    const base = String(cardId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeExt = String(ext || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
    return `${uid}/${base}.${safeExt}`;
  }

  /** 从 storage 路径提取 UUID（legacy card_* id 与 generated/uuid 不一致时用） */
  function storageAssetIdFromPath(path, fallbackId) {
    const key = String(path || '').replace(/^\//, '');
    const m = key.match(/\/generated\/([0-9a-f-]{36})\./i)
      || key.match(/\/([0-9a-f-]{36})(?:_grid)?\./i);
    if (m) return m[1];
    return fallbackId;
  }

  function signCardIdForPath(path, fallbackId) {
    const fb = String(fallbackId || '');
    if (/^card_\d/i.test(fb)) {
      return storageAssetIdFromPath(path, fb) || fb;
    }
    return fb || storageAssetIdFromPath(path, fb);
  }

  function extFromImageMime(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('png')) return 'png';
    if (m.includes('webp')) return 'webp';
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
    return 'jpg';
  }

  function preserveOriginalCardImageFromSettings() {
    try {
      const raw = localStorage.getItem('promptrepo_settings');
      if (!raw) return false;
      const s = JSON.parse(raw);
      return s.preserveOriginalCardImage === true;
    } catch (e) {
      return false;
    }
  }

  function cardUploadOriginalEnabled() {
    if (typeof window.__cardUploadOriginal === 'boolean') return window.__cardUploadOriginal;
    return preserveOriginalCardImageFromSettings();
  }

  function preserveOriginalCardImageEnabled() {
    return cardUploadOriginalEnabled();
  }

  async function sourceToBlob(source) {
    if (source instanceof Blob) return source;
    if (typeof source === 'string') {
      if (isDataUrl(source) || source.startsWith('blob:')) {
        const res = await fetch(source);
        if (!res.ok) throw new Error('无法读取图片');
        return res.blob();
      }
      if (/^https?:\/\//i.test(source)) {
        return fetchRemoteImageBlob(source);
      }
    }
    throw new Error('不支持的图片格式');
  }

  /** 跨域生图 URL 经 Worker 代理拉 blob，避免 canvas 污染导致 toBlob 失败 */
  async function fetchRemoteImageBlob(url, opts = {}) {
    const raw = String(url || '').trim();
    if (!raw) throw new Error('远程图片地址无效');
    if (opts.allowRemoteArchive !== true && isEphemeralUpstreamImageUrl(raw)) {
      throw new Error('临时生图链禁止浏览器拉原图，请用服务端归档');
    }
    const timeoutMs = 12000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (window.PromptHubApi?.fetchMediaAsBlobUrl) {
        const tmp = await window.PromptHubApi.fetchMediaAsBlobUrl(raw);
        if (tmp) {
          try {
            const res = await fetch(tmp, { signal: controller.signal });
            if (res.ok) return await res.blob();
          } finally {
            try { URL.revokeObjectURL(tmp); } catch (e) { /* ignore */ }
          }
        }
      }
      try {
        const res = await fetch(raw, { mode: 'cors', credentials: 'omit', signal: controller.signal });
        if (res.ok) return await res.blob();
      } catch (e) { /* fall through */ }
    } finally {
      clearTimeout(timer);
    }
    throw new Error('远程图片下载失败，请换一张本地图片重试');
  }

  async function coerceImageUploadSource(source) {
    if (source instanceof Blob) return source;
    if (typeof source === 'string' && /^https?:\/\//i.test(source)) {
      return fetchRemoteImageBlob(source);
    }
    return source;
  }

  function isGridStoragePath(path) {
    return /_grid\.(jpe?g|webp|png)$/i.test(String(path || '').replace(/^\//, ''));
  }

  function isGridDisplayUrl(url) {
    const p = storagePathFromDisplayUrl(url);
    return !!(p && isGridStoragePath(p));
  }

  /** 列表区 img.src：禁止自有卡/生图 feed 写入 full 原图 URL */
  function safeListImgUrl(url, img) {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return '';
    if (url.includes('data:image/svg') || isInvalidMediaUrl(url)) return '';
    const inList = img?.closest?.('#cardsContainer, #imageGenFeed');
    if (inList && !isGridDisplayUrl(url)) return '';
    if (isWarehouseBlockedFullUrl(url, img)) return '';
    return url;
  }

  function filterGridVariantUrl(url, variant) {
    if (!url || variant !== VARIANT_GRID) return url || '';
    if (!isValidSignedDisplayUrl(url) || isInvalidMediaUrl(url)) return '';
    return isGridDisplayUrl(url) ? url : '';
  }

  /** 插件/旧版上传：card_{timestamp}_{rand}.jpg，常无对应 _grid */
  function isLegacyUploadCardPath(pathKey) {
    return /\/card_\d{10,}_[a-z0-9]+\.(jpe?g|webp|png)$/i.test(String(pathKey || '').replace(/^\//, ''));
  }

  function storagePathFromCdnUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const m = url.match(/\/api\/v1\/media\/[ci]\/([^?]+)/i);
    if (!m) return null;
    try {
      let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes).replace(/^\//, '');
    } catch (e) {
      return null;
    }
  }

  function storagePathFromDisplayUrl(url) {
    const cdn = storagePathFromCdnUrl(url);
    if (cdn) return cdn;
    try {
      const u = new URL(url);
      const m = (u.pathname || '').match(
        /\/storage\/v1\/object\/(?:sign|public|authenticated)\/card-images\/(.+)$/i
      );
      if (m) return decodeURIComponent(m[1]).replace(/^\/+/, '');
    } catch (e) { /* ignore */ }
    return null;
  }

  /** 列表区默认只显示 grid；最近生成（cr_）与生图入库卡 grid 未就绪时允许 full 缩略 */
  function isWarehouseBlockedFullUrl(url, img) {
    const listRoot = img?.closest?.('#cardsContainer, #imageGenFeed, #communityGrid, #creationsGrid, #userProfileGrid');
    if (!listRoot) return false;
    const feedId = img?.closest?.('.imagegen-feed-card[data-feed-id]')?.dataset?.feedId || '';
    if (feedId.startsWith('cr_')) return false;
    if (isEphemeralUpstreamImageUrl(url)) return true;
    const path = storagePathFromDisplayUrl(url);
    if (!path || isGridStoragePath(path)) return false;
    if (!/\.(jpe?g|webp|png|gif)$/i.test(path)) return false;
    if (img?.dataset?.listPrimaryRetried === '1') return false;
    const cardId = img?.dataset?.sourceCardId
      || img?.closest?.('.card[data-id]')?.dataset?.id
      || img?.closest?.('.imagegen-feed-card[data-feed-id^="wh_"]')?.dataset?.feedId?.replace(/^wh_/, '')
      || undefined;
    const ref = img?.getAttribute?.('data-image-ref');
    if (cardId && ref && (listRoot.id === 'cardsContainer' || listRoot.id === 'imageGenFeed')) {
      const primary = primaryImagePath(ref, cardId);
      if (primary) {
        const pk = String(primary).replace(/^\//, '');
        /* 自有生图卡：grid 未签好时允许 full，避免卡片库整片灰块 */
        if (pk.includes('/generated/')) {
          const card = (window.__promptHubCards || []).find((c) => c.id === cardId);
          if (card?.genJobId) return false;
          return true;
        }
        if (!gridListNeedsPrimaryFallback(primary, cardId)) return true;
      }
      if (primary && gridListNeedsPrimaryFallback(primary, cardId)) return false;
    }
    return true;
  }

  function needsDegradedListPreview(image, cardId) {
    const primary = primaryImagePath(image, cardId);
    return !!(primary && gridListNeedsPrimaryFallback(primary, cardId));
  }

  /** 社区列表 prefetch / DOM：优先 grid 路径 ref */
  function communityListGridRef(image, assetId) {
    if (!image) return null;
    const primary = primaryImagePath(image, assetId);
    if (!primary) return null;
    const grid = gridPathFromPrimary(primary.replace(/^\//, ''));
    return grid ? toStorageRef(grid) : null;
  }

  function clearSignedCacheForPaths(paths) {
    for (const raw of paths || []) {
      const key = String(raw || '').replace(/^\//, '');
      if (!key) continue;
      signedUrlCache.delete(signedCacheKey(key, VARIANT_GRID));
      signedUrlCache.delete(signedCacheKey(key, VARIANT_FULL));
    }
  }

  async function encodeFullResolutionJpeg(source, quality) {
    const normalized = await coerceImageUploadSource(source);
    const img = await loadImageFromSource(normalized);
    if (typeof source !== 'string' && source instanceof Blob) {
      try { URL.revokeObjectURL(img.src); } catch (e) { /* ignore */ }
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error('图片尺寸无效');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('JPEG 编码失败'))),
        'image/jpeg',
        quality
      );
    });
  }

  function isStorageSizeError(err) {
    const msg = String(err?.message || err?.error || err || '').toLowerCase();
    return /maximum allowed size|entity too large|payload too large|413/.test(msg);
  }

  async function fitBlobToStorageLimit(source, blob) {
    const limit = STORAGE_BUCKET_LIMIT_BYTES;
    if (!blob || blob.size <= limit) {
      return { blob, mode: 'raw' };
    }
    let quality = 0.95;
    let jpeg = await encodeFullResolutionJpeg(source, quality);
    while (jpeg.size > limit && quality > 0.72) {
      quality -= 0.04;
      jpeg = await encodeFullResolutionJpeg(source, quality);
    }
    if (jpeg.size <= limit) {
      return { blob: jpeg, mode: 'full_res_jpeg', quality };
    }
    const mb = (blob.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `图片约 ${mb}MB，超过云存储单文件 50MB 上限；已尝试原尺寸 JPEG 仍超限，请换较小文件。`
    );
  }

  async function prepareCardFullUploadBlob(source, opts = {}) {
    const original = opts.original != null ? !!opts.original : cardUploadOriginalEnabled();
    if (original) {
      const blob = await sourceToBlob(source);
      if (!blob.type || !blob.type.startsWith('image/')) {
        throw new Error('请选择有效的图片文件');
      }
      if (blob.size > CARD_ORIGINAL_MAX_BYTES) {
        const mb = (blob.size / (1024 * 1024)).toFixed(1);
        const cap = Math.round(CARD_ORIGINAL_MAX_BYTES / (1024 * 1024));
        throw new Error(`原图约 ${mb}MB，超过 ${cap}MB 上限。可关闭「保存原图」后自动压缩，或换较小文件`);
      }
      const fitted = await fitBlobToStorageLimit(source, blob);
      fitted.blob.__uploadEncodeMode = fitted.mode;
      if (fitted.mode === 'full_res_jpeg') {
        fitted.blob.__uploadJpegQuality = fitted.quality;
      }
      return fitted.blob;
    }
    return compressImage(source, {
      maxSide: CARD_UPLOAD_MAX_SIDE,
      quality: CARD_UPLOAD_JPEG_QUALITY
    });
  }

  function isGeneratedWarehouseCard(card) {
    if (!card) return false;
    if (card.genJobId) return true;
    return Array.isArray(card.tags) && card.tags.includes('图片生成');
  }

  function expectedMinFullImageBytes(resolution) {
    const r = String(resolution || '1k').toLowerCase();
    /** 4K JPEG 通常 10MB+；低于此多为 card_xxx 压缩副本，应继续找 generated 或触发修复 */
    if (r === '4k') return Math.floor(10 * 1024 * 1024);
    if (r === '2k') return Math.floor(1.2 * 1024 * 1024);
    return Math.floor(80 * 1024);
  }

  function isGeneratedArchivePath(pathOrRef) {
    const path = storagePathFromRef(pathOrRef) || String(pathOrRef || '').replace(/^\//, '');
    return /\/generated\/[^/]+\.(jpe?g|png|webp)$/i.test(path);
  }

  /** 生图多图槽位：jobId#2 → uuid-2，避免各槽位覆盖同一路径 */
  function generationStorageAssetId(jobId, fallbackAssetId) {
    if (jobId) return String(jobId).replace(/#/g, '-');
    return String(fallbackAssetId || Date.now());
  }

  /** 生图 storage 路径：保留 #N 槽位（MJ 多图） */
  function resolveStorageJobIdForAsset(opts, assetId) {
    const raw = opts?.jobId || opts?.genJobId || null;
    if (raw) return String(raw);
    const id = assetId || opts?.cardId;
    if (!id) return null;
    const card = (window.__promptHubCards || []).find((c) => c.id === id);
    if (card) {
      const thumb = window.PromptHubCardGallery?.pickWarehouseListThumb?.(card);
      if (thumb?.slotJobId) return String(thumb.slotJobId);
    }
    if (card?.genJobId) return String(card.genJobId);
    if (window.PromptHubCardGallery?.resolveGenJobIdFromCard) {
      return window.PromptHubCardGallery.resolveGenJobIdFromCard(card);
    }
    return null;
  }

  /** 列表/预览签名：opts 或卡片 genJobId → 生图 storage 路径 */
  function resolveJobIdForAsset(opts, assetId) {
    const full = resolveStorageJobIdForAsset(opts, assetId);
    if (full) return String(full).replace(/#\d+$/, '');
    return null;
  }

  function listImagePathCandidates(image, assetId, ownerId, jobId) {
    const paths = [];
    const add = (p) => {
      const key = (p || '').replace(/^\//, '');
      if (key && !paths.includes(key)) paths.push(key);
    };
    const uid = ownerId || getUserId();
    const genJobKey = jobId ? generationStorageAssetId(jobId, '') : '';
    if (uid && genJobKey) {
      add(`${uid}/generated/${genJobKey}.jpg`);
      add(`${uid}/generated/${genJobKey}.png`);
      add(`${uid}/generated/${genJobKey}.webp`);
    }
    add(storagePathFromRef(image));
    const canonical = cardImageStoragePath(assetId, ownerId);
    if (canonical) add(canonical);
    if (uid && assetId) {
      const base = String(assetId).replace(/[^a-zA-Z0-9_-]/g, '_');
      add(`${uid}/${base}.jpg`);
      add(`${uid}/${assetId}.jpg`);
      add(`${uid}/${base}.webp`);
      add(`${uid}/${base}.png`);
      add(`${uid}/generated/${base}.jpg`);
      add(`${uid}/generated/${assetId}.jpg`);
      const stripped = String(assetId).replace(/^wh_/, '');
      if (stripped !== String(assetId)) {
        add(`${uid}/${stripped}.jpg`);
        add(`${uid}/generated/${stripped}.jpg`);
      }
    }
    return paths;
  }

  async function signPathViaCommunityApi(path, variant, signOpts = {}) {
    if (!window.PromptHubApi?.isConfigured?.() || !window.PromptHubApi.signCommunityMediaRef) return null;
    const fileKey = String(path || '').replace(/^\//, '');
    const ownPath = storagePathOwnedByCurrentUser(fileKey);
    if (!ownPath && isPathKnownMissing(fileKey)) {
      /* 他人社区图：不因本地 missing 缓存放弃签名（CDN 可现场生成 grid） */
    } else if (isPathKnownMissing(fileKey)) {
      return null;
    }
    /* 自有路径不走 community/sign（card_* 与 generated/uuid 会 404） */
    if (storagePathOwnedByCurrentUser(fileKey)) {
      return signPathViaApi(path, variant, {
        ...signOpts,
        cardId: signCardIdForPath(fileKey, signOpts?.cardId || signOpts?.assetId),
        bypassSignBudget: true
      });
    }
    const v = variant || VARIANT_GRID;
    const inflightKey = `community:${fileKey}:${v}:${signOpts.authorId || ''}:${signOpts.cardId || ''}`;
    if (signInflight.has(inflightKey)) return signInflight.get(inflightKey);
    const apiPathKey = (() => {
      if (/_grid\.(jpe?g|webp|png)$/i.test(fileKey)) {
        return fileKey.replace(/_grid\.(jpe?g|webp|png)$/i, '.jpg');
      }
      return fileKey;
    })();
    const task = (async () => {
      try {
        const r = await window.PromptHubApi.signCommunityMediaRef(toStorageRef(apiPathKey), {
          variant: v === VARIANT_FULL ? 'full' : 'grid',
          authorId: signOpts.authorId,
          cardId: signOpts.cardId
        });
        if (r.ok && r.data?.url && !isIncompleteSignedStorageUrl(r.data.url)) {
          const url = r.data.url;
          const cdnPath = storagePathFromDisplayUrl(url);
          if (v === VARIANT_GRID && cdnPath && !isGridStoragePath(cdnPath)) {
            return null;
          }
          if (v === VARIANT_GRID && !cdnPath && !isCdnMediaUrl(url)) {
            return null;
          }
          const ttlSec = Math.max(3600, Number(r.data.expiresIn) || SIGNED_TTL_SEC) - 120;
          const cacheKeys = new Set([fileKey]);
          if (/_grid\.(jpe?g|webp|png)$/i.test(fileKey)) {
            const stem = fileKey.replace(/_grid\.(jpe?g|webp|png)$/i, '');
            ['.jpg', '.jpeg', '.webp', '.png'].forEach((ext) => cacheKeys.add(`${stem}${ext}`));
          } else {
            const grid = gridPathFromPrimary(fileKey);
            if (grid) cacheKeys.add(grid.replace(/^\//, ''));
          }
          for (const ck of cacheKeys) {
            signedUrlCache.set(signedCacheKey(ck, v), {
              url,
              expiresAt: Date.now() + ttlSec * 1000
            });
          }
          return url;
        }
        if (r?.status === 404 || r?.code === 'NOT_FOUND') {
          const missKey = apiPathKey.replace(/^\//, '');
          if (storagePathOwnedByCurrentUser(fileKey)) {
            invalidateSignedCache(fileKey);
          } else if (missKey) {
            markPathMissing(missKey);
          } else if (/_grid\.(jpe?g|webp|png)$/i.test(fileKey) && storagePathOwnedByCurrentUser(fileKey)) {
            markGridFetchFailed(fileKey);
          }
        }
      } catch (e) {
        console.warn('[SupabaseSync] community api sign failed', path, e);
      }
      return null;
    })();
    signInflight.set(inflightKey, task);
    try {
      return await task;
    } finally {
      signInflight.delete(inflightKey);
    }
  }

  function resetMediaSignEnvironment(opts) {
    try { window.__PH_API_DOWN_UNTIL__ = 0; } catch (e) { /* ignore */ }
    try { window.__PH_AUTH_SIGN_PAUSE_UNTIL__ = 0; } catch (e) { /* ignore */ }
    try { window.__PH_API_RATE_LIMITED_UNTIL__ = 0; } catch (e) { /* ignore */ }
    gridFetchFailedPaths.clear();
    signBudgetUsed = 0;
    signBudgetResetAt = 0;
    if (opts?.clearMissing !== false) {
      missingPathCache.clear();
      try { localStorage.removeItem(LS_MISSING_PATHS); } catch (e) { /* ignore */ }
    }
    persistSessionSignCache();
  }

  function apiSignAllowed(opts) {
    if (window.__PH_AUTH_SIGN_PAUSE_UNTIL__ && Date.now() < window.__PH_AUTH_SIGN_PAUSE_UNTIL__) return false;
    if (window.PromptHubApi?.isApiRateLimited?.()) return false;
    if (isLoggedIn() && !isCommunityFeedOpts(opts)) {
      return !!(window.PromptHubApi?.isConfigured?.() && window.PromptHubApi.signMediaRef);
    }
    return !!(window.PromptHubApi?.isConfigured?.() && window.PromptHubApi.signMediaRef);
  }

  async function signPathViaApi(path, variant, opts) {
    if (!storagePathOwnedByCurrentUser(path)) return null;
    if (!apiSignAllowed(opts)) return null;
    const bypassBudget = opts?.bypassSignBudget === true;
    if (!bypassBudget && !signBudgetAvailable()) return null;
    const v = variant || VARIANT_GRID;
    let fileKey = String(path || '').replace(/^\//, '');
    if (v === VARIANT_GRID && !/_grid\.(jpe?g|webp|png)$/i.test(fileKey)) {
      const grid = gridPathFromPrimary(fileKey);
      const gridKey = grid ? grid.replace(/^\//, '') : '';
      if (gridKey && shouldSignGridPath(gridKey, opts?.cardId || opts?.assetId)) {
        fileKey = gridKey;
      } else if (v === VARIANT_GRID) {
        return null;
      }
    }
    if (v === VARIANT_GRID && !shouldSignGridPath(fileKey, opts?.cardId || opts?.assetId)) {
      if (!(opts?.bypassSignBudget === true && storagePathOwnedByCurrentUser(fileKey))) {
        return null;
      }
    }
    const inflightKey = `api:${fileKey}:${v}`;
    if (signInflight.has(inflightKey)) return signInflight.get(inflightKey);
    const task = (async () => {
      try {
        let r = await window.PromptHubApi.signMediaRef(toStorageRef(fileKey), { variant: v });
        if (!r?.ok && (r?.status === 401 || r?.code === 'UNAUTHORIZED')) {
          await healSessionOnResume();
          r = await window.PromptHubApi.signMediaRef(toStorageRef(fileKey), { variant: v });
        }
        if (r.ok && r.data?.url && !isIncompleteSignedStorageUrl(r.data.url)
          && mediaUrlMatchesCurrentApi(r.data.url)) {
          consumeSignBudget(1);
          const ttlSec = Math.max(3600, Number(r.data.expiresIn) || SIGNED_TTL_SEC) - 120;
          signedUrlCache.set(signedCacheKey(fileKey, v), {
            url: r.data.url,
            expiresAt: Date.now() + ttlSec * 1000
          });
          return r.data.url;
        }
        if (r?.status === 404 || r?.code === 'NOT_FOUND') {
          if (/_grid\.(jpe?g|webp|png)$/i.test(fileKey)) markGridFetchFailed(fileKey);
          else invalidateSignedCache(fileKey);
        } else if (r?.status === 429 || r?.code === 'RATE_LIMITED') {
          window.PromptHubApi?.markApiRateLimited?.(90000);
        }
      } catch (e) {
        console.warn('[SupabaseSync] api sign failed', path, e);
      }
      return null;
    })();
    signInflight.set(inflightKey, task);
    try {
      return await task;
    } finally {
      signInflight.delete(inflightKey);
    }
  }

  function storagePathOwnedByCurrentUser(path) {
    const uid = getUserId();
    const key = String(path || '').replace(/^\//, '');
    if (!uid || !key) return false;
    return key.startsWith(`${uid}/`);
  }

  function cacheSignedPath(path, url, variant) {
    if (!path || !url || isInvalidMediaUrl(url)) return;
    const fileKey = String(path).replace(/^\//, '');
    const v = variant || VARIANT_GRID;
    signedUrlCache.set(signedCacheKey(fileKey, v), {
      url,
      expiresAt: Date.now() + (SIGNED_TTL_SEC - 120) * 1000
    });
  }

  async function batchSignPaths(paths, variant) {
    const v = variant || VARIANT_GRID;
    const pending = [...new Set((paths || []).map((p) => String(p || '').replace(/^\//, '')).filter(Boolean))].filter((p) => {
      if (isPathKnownMissing(p)) return false;
      if (v === VARIANT_GRID && !shouldSignGridPath(p)) return false;
      if (!storagePathOwnedByCurrentUser(p)) return false;
      const cached = signedUrlCache.get(signedCacheKey(p, v));
      return !(cached?.url && cached.expiresAt > Date.now() + 120000);
    });
    if (!pending.length) return 0;
    if (!signBudgetAvailable()) {
      signBudgetUsed = 0;
      signBudgetResetAt = 0;
    }
    if (!window.PromptHubApi?.signMediaRefsBatch) return 0;
    await ensureSession();
    try {
      const refs = pending.map((p) => toStorageRef(p));
      let r = await window.PromptHubApi.signMediaRefsBatch(refs, { timeoutMs: 8000 });
      if (!r?.ok && (r?.status === 401 || r?.code === 'UNAUTHORIZED')) {
        await healSessionOnResume();
        r = await window.PromptHubApi.signMediaRefsBatch(refs, { timeoutMs: 8000 });
      }
      if (!r?.ok || !r.data?.urls) return 0;
      let n = 0;
      for (const [path, url] of Object.entries(r.data.urls)) {
        if (!url || isIncompleteSignedStorageUrl(url)) continue;
        cacheSignedPath(path, url, v);
        n += 1;
      }
      if (n) {
        consumeSignBudget(n);
        persistSessionSignCache();
        try {
          window.PromptHubMedia?.ingestSignedBatch?.(r.data.urls, v);
        } catch (_) { /* ignore */ }
      }
      return n;
    } catch (e) {
      console.warn('[SupabaseSync] batch sign failed', e);
      return 0;
    }
  }

  async function resolvePathToUrl(path, variant, opts) {
    const fileKey = String(path || '').replace(/^\//, '');
    const v = variant || VARIANT_GRID;
    const listOnly = opts?.listOnly === true;
    const communityFeed = opts?.communityFeed === true;
    const ownPath = storagePathOwnedByCurrentUser(fileKey);
    if (isPathKnownMissing(fileKey) && !(communityFeed && !ownPath)) return null;
    const signMeta = {
      authorId: opts?.authorId,
      cardId: opts?.cardId
    };
    if (communityFeed && !storagePathOwnedByCurrentUser(fileKey)) {
      const publicUrl = await signPathViaCommunityApi(path, v, signMeta);
      if (publicUrl) return publicUrl;
      if (!isLoggedIn()) return null;
    }
    if (isLoggedIn() && storagePathOwnedByCurrentUser(path)) {
      const signOpts = {
        ...opts,
        cardId: signCardIdForPath(fileKey, opts?.cardId || opts?.assetId)
      };
      if (apiSignAllowed(signOpts)) {
        const bypassBudget = listOnly || v === VARIANT_FULL || signOpts.bypassSignBudget === true;
        const apiUrl = await signPathViaApi(path, v, {
          ...signOpts,
          bypassSignBudget: bypassBudget
        });
        if (apiUrl) return apiUrl;
      }
      if (listOnly) {
        const cachedOnly = signedUrlCache.get(signedCacheKey(fileKey, v));
        if (cachedOnly?.url && cachedOnly.expiresAt > Date.now() + 120000) return cachedOnly.url;
        return null;
      }
      if (!listOnly) {
        if (USE_DIRECT_SUPABASE_SIGN) {
          try {
            const ownUrl = await getSignedUrlForPath(path, { variant: v });
            if (ownUrl) return ownUrl;
          } catch (e) {
            if (!isStorageNotFoundError(e) && String(e?.message || e) !== 'sign_timeout') {
              console.warn('[SupabaseSync] own signed url failed', path, e);
            }
          }
        }
      }
    }
    if (isPathKnownMissing(fileKey)) return null;
    if (communityFeed) return null;
    if (!storagePathOwnedByCurrentUser(path)) return null;
    if (!apiSignAllowed(opts)) return null;
    const bypassBudget = listOnly || v === VARIANT_FULL || opts.bypassSignBudget === true;
    return signPathViaApi(path, v, {
      ...opts,
      cardId: signCardIdForPath(fileKey, opts?.cardId || opts?.assetId),
      bypassSignBudget: bypassBudget
    });
  }

  async function verifyImageUrl(url) {
    if (!url || url.startsWith('data:image/svg')) return false;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 0);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  async function findCardImageInStorage(cardId) {
    if (!isLoggedIn() || !cardId) return null;
    await ensureSession();
    const uid = getUserId();
    const sb = getClient();
    if (!sb || !uid) return null;
    const cid = String(cardId).replace(/^wh_/, '');
    try {
      const { data, error } = await sb.storage.from(BUCKET).list(uid, {
        limit: 200,
        sortBy: { column: 'name', order: 'asc' }
      });
      if (error || !data?.length) return null;
      const matches = data.filter((f) => {
        const name = f?.name || '';
        return name === `${cid}.jpg` || name.startsWith(`${cid}.`) || name.includes(cid);
      });
      for (const file of matches) {
        const path = `${uid}/${file.name}`;
        const ref = toStorageRef(path);
        const url = await resolveDisplayUrl(ref, { assetId: cardId });
        if (url && await verifyImageUrl(url)) return ref;
      }
    } catch (e) {
      console.warn('[SupabaseSync] list storage failed', e);
    }
    return null;
  }

  async function repairCardImageIfMissing(cardId, currentRef, opts = {}) {
    if (currentRef && isStorageRef(currentRef)) {
      const ok = await verifyStorageRef(currentRef, cardId, { quick: true, noDownload: true });
      if (ok) return normalizeImageRef(currentRef);
    }
    if (opts.allowStorageList === true) {
      const found = await findCardImageInStorage(cardId);
      if (found && found !== currentRef) return found;
    }
    return null;
  }

  function isCommunityFeedOpts(opts) {
    return !!(opts && typeof opts === 'object' && opts.communityFeed === true);
  }

  async function resolveDisplayUrl(image, opts) {
    if (!image || typeof image !== 'string') return image;
    if (isDataUrl(image) || image.startsWith('blob:')) return image;
    const o = opts && typeof opts === 'object' ? opts : {};
    const depth = Number(o._depth) || 0;
    if (depth > 5) return null;
    const nextOpts = (patch) => ({ ...o, ...patch, _depth: depth + 1 });
    const assetId = o.assetId;
    const authorId = o.authorId;
    const jobId = resolveJobIdForAsset(o, assetId);
    const storageJobId = resolveStorageJobIdForAsset(o, assetId) || jobId;
    const variant = displayVariantFromOpts(opts);
    const normalizedEarly = normalizeImageRef(image);
    const bucketPathEarly = storagePathFromRef(normalizedEarly);
    const listOnlyGridEarly =

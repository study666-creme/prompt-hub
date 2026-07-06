    const cardImages = gallery.length > 1
      ? gallery
      : (existingGallery.length > 1 ? existingGallery : null);
    return {
      ...(existing || {}),
      id: existing?.id || `cr_${baseJob}`,
      jobId: baseJob,
      prompt: job.prompt || existing?.prompt || '',
      image: mainImage,
      model: job.model || existing?.model || 'gpt-image-2',
      modelLabel: job.modelLabel || existing?.modelLabel || imageGenModelLabel(job.model),
      resolution: job.resolution || existing?.resolution || '1k',
      quality: job.quality || existing?.quality || 'standard',
      size: job.size || existing?.size || '1:1',
      visibility: existing?.visibility || 'private',
      createdAt: existing?.createdAt || createdAt,
      updatedAt: Math.max(existing?.updatedAt || 0, Date.now()),
      expiresAt: existing?.permanent ? existing.expiresAt : expiresAt,
      isMidjourney: !!(job.isMidjourney || existing?.isMidjourney),
      mjGridUrls: job.isMidjourney
        ? uniqueImageRefs([
          ...(Array.isArray(job.mjGridUrls) ? job.mjGridUrls : []),
          ...gallery.slice(1, 5)
        ]).filter(isUsableCreationImageRef).slice(0, 4)
        : (existing?.mjGridUrls || null),
      mjCompositeUrl: job.mjCompositeUrl || existing?.mjCompositeUrl || null,
      mjButtons: Array.isArray(job.mjButtons) ? job.mjButtons : (existing?.mjButtons || null),
      cardImages,
      savedToWarehouse: !!existing?.savedToWarehouse,
      warehouseCardId: existing?.warehouseCardId || null,
      serverRecent: true
    };
  }

  function mergeRecentCreationsFromServer(jobs) {
    const tomb = window.getDeletedCreationTombstones?.() || {};
    const maxAgeCutoff = Date.now() - GEN_RETENTION_MS;
    const byJob = new Map();
    creations.forEach((c) => {
      const base = creationBaseJobId(c);
      if (base && !byJob.has(base)) byJob.set(base, c);
    });
    const incoming = [];
    const incomingJobs = new Set();
    for (const job of jobs || []) {
      if (!job?.id || job.status !== 'completed') continue;
      const base = normalizeGenJobBaseId(job.id);
      if (!base || isGenerationJobDeleted(base)) continue;
      const existing = byJob.get(base);
      const id = existing?.id || `cr_${base}`;
      if (tomb[String(id)]) continue;
      const creation = serverRecentJobToCreation(job, existing);
      if (!creation || (creation.createdAt || 0) < maxAgeCutoff) continue;
      incoming.push(creation);
      incomingJobs.add(base);
    }
    if (!incoming.length && !creations.some((c) => c?.serverRecent)) return false;
    const kept = creations.filter((c) => {
      if (!c?.id || tomb[String(c.id)]) return false;
      const base = creationBaseJobId(c);
      if (base && incomingJobs.has(base)) return false;
      return true;
    });
    const next = dedupeCreationsByJobId([...incoming, ...kept])
      .filter((c) => !c.expiresAt || c.expiresAt > Date.now())
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const sig = (list) => list
      .map((c) => `${c.id}:${c.jobId || ''}:${c.image || ''}:${c.expiresAt || ''}`)
      .join('|');
    if (sig(next) === sig(creations)) return false;
    creations = next;
    saveJson(LS_CREATIONS, creations);
    reconcileCreationsWarehouseLinks();
    return true;
  }

  async function syncRecentCreationsFromServer(opts = {}) {
    if (!window.SupabaseSync?.isLoggedIn?.()) return { ok: false, reason: 'not_logged_in' };
    if (!window.PromptHubApi?.listRecentGeneratedCreations) return { ok: false, reason: 'api_missing' };
    if (recentServerSyncInflight) return recentServerSyncInflight;
    const now = Date.now();
    if (!opts.force && now - recentServerSyncLastAt < 90000) {
      return { ok: true, skipped: true };
    }
    recentServerSyncLastAt = now;
    recentServerSyncInflight = (async () => {
      const res = await window.PromptHubApi.listRecentGeneratedCreations({
        days: 7,
        limit: Math.max(80, Math.min(400, getRecentCreationsLimit() * 2))
      });
      if (!res?.ok) return { ok: false, code: res?.code, message: res?.message };
      const changed = mergeRecentCreationsFromServer(res.data?.jobs || []);
      pruneCreations();
      if (changed && opts.render !== false && document.getElementById('pageImageGen')?.classList.contains('active')) {
        renderImageGenFeed({ preserveScroll: true, force: true });
        updateImageGenFeedHint();
      }
      return { ok: true, changed };
    })().catch((e) => {
      console.warn('[recent-server] sync failed', e);
      return { ok: false, error: e };
    }).finally(() => {
      recentServerSyncInflight = null;
    });
    return recentServerSyncInflight;
  }

  function scheduleRecentCreationsServerSync(opts = {}, delayMs = 1200) {
    if (!window.SupabaseSync?.isLoggedIn?.()) return;
    clearTimeout(recentServerSyncTimer);
    recentServerSyncTimer = setTimeout(() => {
      recentServerSyncTimer = null;
      void syncRecentCreationsFromServer(opts);
    }, Math.max(0, Number(delayMs) || 0));
  }

  let recentCreationRepairInflight = null;
  let recentCreationRepairLastAt = 0;

  /** 修复「最近生成」仍指向上游临时链的记录 → 归档到 Storage */
  async function repairRecentCreationImagesQuiet(opts = {}) {
    if (!window.SupabaseSync?.isLoggedIn?.()) return { ok: false, reason: 'not_logged_in' };
    if (recentCreationRepairInflight) return recentCreationRepairInflight;
    const now = Date.now();
    if (!opts.force && now - recentCreationRepairLastAt < 120000) return { ok: true, skipped: true };
    recentCreationRepairLastAt = now;
    recentCreationRepairInflight = (async () => {
      const max = Math.min(12, Math.max(1, Number(opts.max) || 8));
      const list = getRecentCreationsForFeed().slice(0, max);
      let repaired = 0;
      for (const c of list) {
        if (!c?.id || !c.jobId) continue;
        const ref = c.image || '';
        const ephemeral = /^https?:\/\//i.test(ref)
          && window.SupabaseSync?.isEphemeralUpstreamImageUrl?.(ref);
        const storageRef = window.SupabaseSync?.isStorageRef?.(ref);
        const storageKey = storageRef
          ? String(window.SupabaseSync.storagePathFromRef?.(ref) || '').replace(/^\//, '')
          : '';
        const storageMissing = !!(storageKey && window.SupabaseSync?.isPathKnownMissing?.(storageKey));
        const thumbCached = ref && window.SupabaseSync?.getListDisplayImageSrc?.(ref, c.id, {
          jobId: String(c.jobId).replace(/#\d+$/, ''),
          allowFullFallback: true
        });
        const needsArchive = ephemeral
          || !storageRef
          || storageMissing
          || (!thumbCached && !opts.skipThumbCheck);
        if (!needsArchive && storageRef && !storageMissing) continue;
        const baseJob = String(c.jobId).replace(/#\d+$/, '');
        try {
          let nextRef = ref;
          const archiveSources = creationFeedImageCandidates(c).filter((u) =>
            /^https?:\/\//i.test(u) || window.SupabaseSync?.isStorageRef?.(u)
          );
          if (ephemeral || /^https?:\/\//i.test(ref) || storageMissing || !storageRef) {
            for (const src of archiveSources.length ? archiveSources : [ref]) {
              if (!src) continue;
              const archived = await window.SupabaseSync.archiveGeneratedCardImage(c.id, src, {
                jobId: baseJob,
                allowRemoteArchive: true
              });
              if (archived) {
                nextRef = archived;
                break;
              }
            }
          }
          if ((!nextRef || nextRef === ref || storageMissing) && baseJob && window.PromptHubApi?.getGenerationImageUrl) {
            const r = await window.PromptHubApi.getGenerationImageUrl(baseJob);
            if (r?.ok && r.data?.url && window.SupabaseSync?.archiveGeneratedCardImage) {
              const archived = await window.SupabaseSync.archiveGeneratedCardImage(c.id, r.data.url, {
                jobId: baseJob,
                allowRemoteArchive: true
              });
              if (archived) nextRef = archived;
            }
          }
          if (nextRef && nextRef !== ref) {
            c.image = nextRef;
            if (storageKey && window.SupabaseSync?.clearPathMissingForCard) {
              window.SupabaseSync.clearPathMissingForCard(c.id, ref);
            }
            repaired += 1;
          }
        } catch (e) {
          console.warn('[recent-repair] failed', c.id, e);
        }
      }
      if (repaired > 0) {
        persistCreations();
        renderImageGenFeed({ preserveScroll: true, force: true });
      }
      return { ok: true, repaired };
    })().finally(() => { recentCreationRepairInflight = null; });
    return recentCreationRepairInflight;
  }

  /** 诊断「最近」Tab 缩略图：区分加载失败 vs 图片真丢 */
  async function diagnoseRecentFeedThumbs(n = 8) {
    const limit = Math.min(16, Math.max(1, Number(n) || 8));
    const list = getRecentCreationsForFeed().slice(0, limit);
    const rows = [];
    for (const c of list) {
      const baseJob = String(c.jobId || '').replace(/#\d+$/, '');
      let apiOk = '—';
      if (baseJob && window.PromptHubApi?.getGenerationImageUrl) {
        try {
          const r = await window.PromptHubApi.getGenerationImageUrl(baseJob);
          apiOk = r?.ok && r.data?.url ? '有' : (r?.code || '无');
        } catch (e) {
          apiOk = 'err';
        }
      }
      const feedImg = pickCreationFeedImage(c) || c.image || '';
      let imgKind = '空';
      if (feedImg && window.SupabaseSync?.isStorageRef?.(feedImg)) imgKind = 'storage';
      else if (/^https?:\/\//i.test(feedImg)) {
        imgKind = window.SupabaseSync?.isEphemeralUpstreamImageUrl?.(feedImg) ? '临时链' : 'https';
      }
      rows.push({
        时间: new Date(c.createdAt || 0).toLocaleDateString(),
        MJ: c.isMidjourney ? '是' : '',
        jobId: baseJob ? '有' : '无',
        列表图: imgKind,
        云端API: apiOk
      });
    }
    console.table(rows);
    console.info('[recent-diagnose] 云端API=有 → 可 repairRecentCreationImagesQuiet({ force:true })');
    return { rows };
  }

  function warehouseReferencesCreation(creation) {
    if (!creation) return false;
    const cards = window.__promptHubCards || [];
    if (creation.warehouseCardId && cards.some((c) => c.id === creation.warehouseCardId)) return true;
    if (creation.id && cards.some((c) => c.genSourceId === creation.id)) return true;
    const base = normalizeGenJobBaseId(creation.jobId);
    if (!base) return false;
    return cards.some((c) => {
      const cBase = normalizeGenJobBaseId(c.genJobId);
      if (cBase !== base) return false;
      return !!(c.image && isDisplayableImage(c.image));
    });
  }

  /**
   * 检查云端卡片库是否仍引用此 creation
   * 防止多设备场景下误删 Storage 图片
   */
  async function checkCloudCardReferences(creation) {
    if (!window.SupabaseSync?.user) {
      return { hasReferences: true, reason: 'not_logged_in' };
    }
    const base = normalizeGenJobBaseId(creation.jobId);
    if (!base) return { hasReferences: false };
    try {
      const cloudData = await window.SupabaseSync.pullCloudData();
      const cards = cloudData?.cards || [];
      const referenced = cards.some((c) => {
        const cBase = normalizeGenJobBaseId(c.genJobId);
        if (cBase !== base) return false;
        return !!(c.image && isDisplayableImage(c.image));
      });
      if (referenced) {
        return {
          hasReferences: true,
          reason: 'cloud_card_exists',
          details: { jobId: base }
        };
      }
      const refs = new Set();
      [creation.image, creation.mjCompositeUrl, ...(creation.mjGridUrls || [])]
        .forEach((u) => { if (u && isDisplayableImage(u)) refs.add(u); });
      for (const ref of refs) {
        const storageReferenced = cards.some((c) =>
          c.image === ref
          || (c.cardImages || []).some((img) => img.url === ref || img.path === ref)
        );
        if (storageReferenced) {
          return {
            hasReferences: true,
            reason: 'cloud_storage_path',
            details: { ref }
          };
        }
      }
      return { hasReferences: false };
    } catch (error) {
      console.error('[purge] Cloud check failed:', error);
      return { hasReferences: true, reason: 'check_failed', error };
    }
  }

  function isCreationLinkedToWarehouse(c) {
    return !!(c?.savedToWarehouse && c?.warehouseCardId) || warehouseReferencesCreation(c);
  }

  function reconcileCreationsWarehouseLinks() {
    const cards = window.__promptHubCards || [];
    if (!cards.length || !creations.length) return;
    let changed = false;
    for (const c of creations) {
      if (c.savedToWarehouse && c.warehouseCardId) continue;
      const wh = cards.find((w) =>
        w.genSourceId === c.id
        || (c.jobId && normalizeGenJobBaseId(w.genJobId) === normalizeGenJobBaseId(c.jobId))
      );
      if (!wh?.id) continue;
      c.savedToWarehouse = true;
      c.warehouseCardId = wh.id;
      c.updatedAt = Date.now();
      changed = true;
    }
    if (changed) persistCreations();
  }

  async function purgeCreationMedia(creation) {
      if (!creation) return;
    
      // 1. 本地检查
      if (warehouseReferencesCreation(creation)) {
        console.log('[purge] Skipped: local reference exists', creation.id);
        return;
      }
    
      // 2. 云端检查（Phase 0 新增）
      const cloudCheck = await checkCloudCardReferences(creation);
      if (cloudCheck.hasReferences) {
        console.log('[purge] Skipped: cloud reference exists', {
          creationId: creation.id,
          reason: cloudCheck.reason,
          details: cloudCheck.details
        });
        return;
      }
    
      // 3. Dry-run 模式支持
      if (window.__PURGE_DRY_RUN) {
        console.log('[purge] DRY RUN - Would delete:', {
          creationId: creation.id,
          refs: [creation.image, creation.mjCompositeUrl, ...(creation.mjGridUrls || [])]
        });
        return;
      }
    
      // 4. 执行删除（原有逻辑）
      const refs = new Set();
    const add = (u) => { if (u && isDisplayableImage(u)) refs.add(u); };
    add(creation.image);
    add(creation.mjCompositeUrl);
    (creation.mjGridUrls || []).forEach(add);
    buildCreationGallery(creation).forEach(add);
    if (!refs.size || !window.SupabaseSync?.deleteCardImageByUrl) return;
    const base = normalizeGenJobBaseId(creation.jobId);
    for (const ref of refs) {
      try {
        await window.SupabaseSync.deleteCardImageByUrl(ref, {
          allowGenerated: true,
          excludeCardId: creation.warehouseCardId || undefined,
          genJobId: base || undefined
        });
      } catch (e) {
        console.warn('[creation] purge media failed', e);
      }
    }
    if (base && !warehouseReferencesCreation(creation)) {
      window.recordGenerationJobDeletion?.(base);
    }
  }

  async function saveCreationToWarehouse(creationId) {
    const c = creations.find((x) => x.id === creationId);
    if (!c) {
      toast('记录不存在或已过期');
      return false;
    }
    if (c.savedToWarehouse && c.warehouseCardId) {
      toast('已在卡片库中');
      if (typeof switchAppPage === 'function') switchAppPage('warehouse');
      return true;
    }
    const gallery = buildCreationGallery(c);
    const mainImage = gallery[0] || c.image;
    if (!mainImage) {
      toast('暂无图片可保存');
      return false;
    }
    const baseJob = normalizeGenJobBaseId(c.jobId);
    const saved = await window.addCardFromGenerated?.({
      prompt: c.prompt,
      image: mainImage,
      sourceId: c.id,
      jobId: baseJob || null,
      title: (c.title || '').trim() || (c.isMidjourney ? 'MJ 四宫格' : ''),
      resolution: c.resolution,
      model: c.model,
      quality: c.quality,
      size: c.size,
      publishToCommunity: false,
      fromInspirationDraw: !!c.fromInspirationDraw,
      copyStorage: true,
      silentToast: true,
      isMidjourney: !!c.isMidjourney,
      mjGridUrls: c.mjGridUrls,
      mjCompositeUrl: c.mjCompositeUrl,
      mjButtons: c.mjButtons,
      cardImages: gallery.length > 1 ? gallery : null,
      genBatchId: c.genBatchId || null
    });
    if (!saved?.ok) {
      if (saved?.duplicate) toast('该图已在卡片库中');
      else toast('保存失败，请重试');
      return false;
    }
    c.savedToWarehouse = true;
    c.warehouseCardId = saved.cardId || null;
    reconcileCreationsWarehouseLinks();
    c.updatedAt = Date.now();
    persistCreations();
    toast('已存入卡片库');
    if (document.getElementById('pageImageGen')?.classList.contains('active')) {
      renderImageGenFeed({ preserveScroll: true, force: true });
    }
    return true;
  }

  function pruneCreations() {
    const now = Date.now();
    const expiring = creations.filter((c) =>
      !c.permanent
      && c.expiresAt
      && c.expiresAt <= now
    );
    if (expiring.length) {
      void Promise.all(
        expiring
          .filter((c) => !warehouseReferencesCreation(c))
          .map((c) => purgeCreationMedia(c))
      );
    }
    const before = creations.length;
    creations = creations.filter((c) =>
      c.permanent || !c.expiresAt || c.expiresAt > now
    );
    if (creations.length !== before) persistCreations();
    pruneCreationsByCountLimit();
  }

  function getDefaultPublishChecked() {
    if (typeof window.getDefaultPublishCommunity === 'function') {
      return window.getDefaultPublishCommunity();
    }
    return true;
  }

  function isCommunityPromptEligible(prompt) {
    return String(prompt || '').trim().length >= MIN_COMMUNITY_PROMPT_LEN;
  }

  function cardHasCommunityImage(cardOrImage) {
    const image = typeof cardOrImage === 'object' ? cardOrImage?.image : cardOrImage;
    if (!image || !isDisplayableImage(image)) return false;
    if (window.SupabaseSync?.isInvalidMediaUrl?.(image)) return false;
    const path = window.SupabaseSync?.storagePathFromRef?.(image);
    if (path && window.SupabaseSync?.isPathKnownMissing?.(path)) return false;
    if (!path && /^https?:\/\//i.test(image)) return false;
    return true;
  }

  function isCommunityPublishEligible(card) {
    if (!card) return false;
    if (!isCommunityPromptEligible(card.prompt)) return false;
    return cardHasCommunityImage(card);
  }

  /** globalDefaultOn：设置里是否开启默认；sessionOverride：用户手动切换 null=跟随规则 */
  function computeAutoCommunityToggle(prompt, globalDefaultOn, sessionOverride) {
    if (sessionOverride === true) return true;
    if (sessionOverride === false) return false;
    if (!globalDefaultOn) return false;
    return isCommunityPromptEligible(prompt);
  }

  function getCardFormPromptText() {
    return (
      document.getElementById('cardPrompt')?.value
      || document.getElementById('floatingPromptText')?.value
      || ''
    );
  }

  function syncCardPublishFromPrompt(prompt) {
    const editing = window.__promptHubGetEditingCard?.();
    if (editing) {
      applyPublishToggleUi(getCardPublishIntent(editing));
      return;
    }
    if (typeof window.__promptHubIsNewCard === 'function' && window.__promptHubIsNewCard()) {
      if (publishDrafts.has('__new__')) {
        applyPublishToggleUi(publishDrafts.get('__new__') === true);
        return;
      }
      const on = computeAutoCommunityToggle(
        prompt,
        getDefaultPublishChecked(),
        null
      );
      applyPublishToggleUi(on);
    }
  }

  function persistCommunity() {
    dedupeCommunityPosts({ persist: false });
    saveJson(LS_COMMUNITY, communityPosts.filter(p => !p.isMock));
    if (window.SupabaseSync?.isLoggedIn?.()) {
      queueCloudPush();
    }
  }

  function persistCreations() {
    saveJson(LS_CREATIONS, creations);
    if (window.SupabaseSync?.isLoggedIn?.()) {
      queueCloudPush();
    }
  }

  function persistLikes() {
    saveJson(LS_LIKES, [...likedIds]);
  }

  function persistFavs() {
    saveJson(LS_FAVS, [...favIds]);
  }

  let ownPostFilterCache = null;
  let lastReconcileSig = '';

  function rebuildOwnPostFilterCache() {
    const user = getActiveUser();
    const cards = window.__promptHubCards || [];
    ownPostFilterCache = {
      userId: user.id,
      cardIds: new Set(cards.map((c) => c.id)),
      linkedIds: new Set(cards.map((c) => c.communityPostId).filter(Boolean))
    };
  }

  function computeCardsCommunitySig(list) {
    let h = 0;
    for (const c of list) {
      h = ((h << 5) - h + String(c.id).length) | 0;
      h = ((h << 5) - h + (c.updatedAt || 0)) | 0;
      h = ((h << 5) - h + String(c.communityPostId || '').length) | 0;
      h = ((h << 5) - h + (c.publishedToCommunity ? 1 : 0)) | 0;
    }
    return `${list.length}:${h >>> 0}`;
  }

  function invalidateCommunityReconcileCache() {
    lastReconcileSig = '';
    ownPostFilterCache = null;
  }

  function maybeReconcileCommunityWithCards(cardList, opts = {}) {
    const list = Array.isArray(cardList) ? cardList : [];
    const user = getActiveUser();
    if (user.id === 'guest') return list;
    if (opts.force) lastReconcileSig = '';
    const sig = computeCardsCommunitySig(list);
    if (!opts.force && sig === lastReconcileSig) return list;
    lastReconcileSig = sig;
    return reconcileCommunityWithCards(list, opts);
  }

  function postActivityTs(p) {
    return Math.max(p?.updatedAt || 0, p?.createdAt || 0);
  }

  function stablePostSortKey(p) {
    return String(p?.sourceCardId || p?.sourceCreationId || p?.id || p?.image || p?.title || '');
  }

  function compareStablePostKey(a, b) {
    return stablePostSortKey(a).localeCompare(stablePostSortKey(b));
  }

  function comparePostsByCreatedDesc(a, b) {
    return ((b?.createdAt || 0) - (a?.createdAt || 0))
      || ((b?.updatedAt || 0) - (a?.updatedAt || 0))
      || compareStablePostKey(a, b);
  }

  function comparePostsByActivityDesc(a, b) {
    return (postActivityTs(b) - postActivityTs(a))
      || ((b?.createdAt || 0) - (a?.createdAt || 0))
      || compareStablePostKey(a, b);
  }

  function comparePostsByLikesDesc(a, b) {
    return ((b?.likes || 0) - (a?.likes || 0))
      || comparePostsByActivityDesc(a, b);
  }

  function sortPostsByActivity(list) {
    return [...(list || [])].sort(comparePostsByActivityDesc);
  }

  function enrichPostsWithLocalTimestamps(posts) {
    const localByCard = new Map();
    for (const p of buildPostsFromPublishedCards()) {
      if (p?.sourceCardId) localByCard.set(String(p.sourceCardId), p);
    }
    for (const p of communityPosts) {
      if (!p?.sourceCardId) continue;
      const key = String(p.sourceCardId);
      const prev = localByCard.get(key);
      const ts = postActivityTs(p);
      if (!prev || ts >= postActivityTs(prev)) localByCard.set(key, p);
    }
    return (posts || []).map((p) => {
      if (!p?.sourceCardId) return p;
      const local = localByCard.get(String(p.sourceCardId));
      if (!local) return p;
      const next = {
        ...p,
        updatedAt: Math.max(p.updatedAt || 0, local.updatedAt || 0, local.createdAt || 0)
      };
      if (local.image && isUsableCommunityImage(local.image)) next.image = local.image;
      return next;
    });
  }
  function enrichPostsWithPublicFeedImages(posts) {
    const pubById = new Map();
    const pubByCard = new Map();
    for (const p of publicFeedState.posts) {
      if (p?.id) pubById.set(String(p.id), p);
      if (p?.sourceCardId) pubByCard.set(String(p.sourceCardId), p);
    }
    return (posts || []).map((p) => {
      if (!p) return p;
      const pub = (p.sourceCardId && pubByCard.get(String(p.sourceCardId)))
        || (p.id && pubById.get(String(p.id)))
        || null;
      if (pub?.image && isUsableCommunityImage(pub.image)) {
        return { ...p, image: pub.image };
      }
      const cardImg = cardImageForPost(p);
      if (cardImg && isUsableCommunityImage(cardImg)) {
        return { ...p, image: cardImg };
      }
      return p;
    });
  }

  function getAllCommunityPosts() {
    const user = getActiveUser();
    const pub = filterCommunityPostsForDisplay(publicFeedState.posts, {
      skipCardTombstones: true,
      skipPostTombstones: true
    });
    if (user.id === 'guest') {
      return publicFeedState.at > 0 ? pub : [];
    }
    const local = filterCommunityPostsForDisplay(communityPosts);
    return enrichPostsWithPublicFeedImages(
      filterCommunityPostsForDisplay(
        mergePostsLists(pub, local, buildPostsFromPublishedCards()),
        { skipCardTombstones: true, skipPostTombstones: true }
      )
    );
  }

  function isFeedRenderablePost(p) {
    if (!p || p.isMock) return false;
    if (window.SupabaseSync?.shouldShowPostInCommunityFeed?.(p) === false) return false;
    const ref = communityPostDisplayImageRef(p, { feedList: true });
    if (ref && isDisplayableImage(ref)) return true;
    return isCommunityPromptEligible(p.prompt);
  }

  /** 社区 Grid：全站 API 帖为准（服务器已发布即展示）；本地 pending 仅补尚未入库的自己的帖 */
  function getCommunityFeedForDisplay() {
    const user = getActiveUser();
    const pub = filterCommunityPostsForDisplay(publicFeedState.posts, {
      skipCardTombstones: true,
      skipPostTombstones: true
    }).filter(isFeedRenderablePost);
    if (user.id === 'guest') {
      return publicFeedState.at > 0 ? pub : [];
    }
    if (!publicFeedState.posts.length && !publicFeedState.at) return [];
    const pubIds = new Set(pub.map((p) => String(p.id)));
    const pubCards = new Set(pub.map((p) => String(p.sourceCardId)).filter(Boolean));
    const pending = buildPostsFromPublishedCards().filter((p) => {
      if (!isFeedRenderablePost(p)) return false;
      if (pubIds.has(String(p.id))) return false;
      if (p.sourceCardId && pubCards.has(String(p.sourceCardId))) return false;
      return true;
    });
    return enrichPostsWithLocalTimestamps(
      enrichPostsWithPublicFeedImages(
        filterCommunityPostsForDisplay(
          mergePostsLists(pub, pending),
          { skipCardTombstones: true, skipPostTombstones: true }
        )
      )
    );
  }

  function pruneOwnOrphanCommunityPosts(cardList, opts = {}) {
    const user = getActiveUser();
    if (user.id === 'guest') return false;
    const list = Array.isArray(cardList) ? cardList : [];
    if (!list.length) return false;
    const cardIds = new Set(list.map((c) => c.id));
    const linkedIds = new Set(list.map((c) => c.communityPostId).filter(Boolean));
    const publicCardIds = new Set(publicFeedState.posts.map((p) => p.sourceCardId).filter(Boolean));
    const publicPostIds = new Set(publicFeedState.posts.map((p) => p.id));
    const before = communityPosts.length;
    communityPosts = communityPosts.filter((p) => {
      if (!p || p.isMock) return false;
      if (!isCurrentUserPost(p)) return true;
      if (p.sourceCardId) {
        if (publicCardIds.has(p.sourceCardId)) return true;
        const card = list.find((c) => c.id === p.sourceCardId);
        return !!(card && card.publishedToCommunity);
      }
      return linkedIds.has(p.id) || publicPostIds.has(p.id);
    });
    if (communityPosts.length !== before) {
      if (opts.persist !== false) {
        persistCommunity();
        rebuildOwnPostFilterCache();
        invalidateCommunityReconcileCache();
      }
      return true;
    }
    return false;
  }

  function communityPostDedupeKey(p, userId) {
    if (!p) return '';
    if (p.sourceCardId) return `card:${p.sourceCardId}`;
    if (p.sourceCreationId) return `cre:${p.sourceCreationId}`;
    if (String(p.authorId) === String(userId)) {
      const prompt = String(p.prompt || p.title || '').trim().slice(0, 200).toLowerCase();
      if (prompt) return `prompt:${prompt}`;
    }
    return `id:${p.id}`;
  }

  function dedupeCommunityPosts(opts = {}) {
    const persist = opts.persist !== false;
    const user = getActiveUser();
    const cardTomb = window.getDeletedCardTombstones?.() || {};
    const keptOthers = [];
    const ownByKey = new Map();
    const before = communityPosts.length;

    for (const p of communityPosts) {
      if (!p || p.isMock) continue;
      if (!isCurrentUserPost(p)) {
        keptOthers.push(p);
        continue;
      }
      if (p.sourceCardId && cardTomb[String(p.sourceCardId)]) continue;
      const key = communityPostDedupeKey(p, user.id);
      const prev = ownByKey.get(key);
      const ts = p.updatedAt || p.createdAt || 0;
      const prevTs = prev ? (prev.updatedAt || prev.createdAt || 0) : -1;
      if (!prev || ts >= prevTs) ownByKey.set(key, p);
    }

    communityPosts = [...keptOthers, ...ownByKey.values()];
    if (communityPosts.length !== before && persist) {
      saveJson(LS_COMMUNITY, communityPosts.filter((p) => !p.isMock));
      if (window.SupabaseSync?.isLoggedIn?.()) queueCloudPush();
    }
    return communityPosts;
  }

  /** 与卡片库对齐：去掉演示帖、孤儿帖、同一卡片的重复社区帖；对齐 communityPostId */
  function reconcileCommunityWithCards(cardList, opts = {}) {
    const list = Array.isArray(cardList) ? cardList : [];
    const user = getActiveUser();
    if (opts.force) invalidateCommunityReconcileCache();
    migrateCommunityAuthorIds();
    dedupeCommunityPosts({ persist: false });
    if (user.id === 'guest') {
      pruneOrphanFeatureData();
      return list;
    }
    let communityDirty = pruneOwnOrphanCommunityPosts(list, { persist: false });
    if (list.length === 0) {
      if (communityDirty) persistCommunity();
      rebuildOwnPostFilterCache();
      return list;
    }
    const cardIds = new Set(list.map(c => c.id));
    const ownBySource = new Map();
    const kept = [];
    for (const p of communityPosts) {
      if (p.isMock) continue;
      if (!isCurrentUserPost(p)) {
        kept.push(p);
        continue;
      }
      if (!p.sourceCardId) {
        const linked = list.some((c) => String(c.communityPostId) === String(p.id));
        if (!linked) continue;
        kept.push(p);
        continue;
      }
      const tomb = window.getDeletedCardTombstones?.() || {};
      if (tomb[String(p.sourceCardId)]) continue;
      if (!cardIds.has(p.sourceCardId)) {
        const uid = window.SupabaseSync?.getUserId?.();
        if (uid && String(p.authorId) === String(uid)) {
          const key = p.sourceCardId || p.id;
          const prev = ownBySource.get(key);
          const ts = p.updatedAt || p.createdAt || 0;
          const prevTs = prev ? (prev.updatedAt || prev.createdAt || 0) : -1;
          if (!prev || ts >= prevTs) ownBySource.set(key, p);
        }
        continue;
      }
      const card = list.find((c) => c.id === p.sourceCardId);
      if (card && !card.publishedToCommunity) continue;
      const prev = ownBySource.get(p.sourceCardId);
      const ts = p.updatedAt || p.createdAt || 0;
      const prevTs = prev ? (prev.updatedAt || prev.createdAt || 0) : -1;
      if (!prev || ts >= prevTs) ownBySource.set(p.sourceCardId, p);
    }
    const beforeMerge = communityPosts.length;
    communityPosts = [...kept, ...ownBySource.values()];
    dedupeCommunityPosts({ persist: false });
    if (communityPosts.length !== beforeMerge) communityDirty = true;
    for (const c of list) {
      if (!c.publishedToCommunity) {
        const hadPost = communityPosts.some((p) => p.sourceCardId === c.id);
        if (hadPost) {
          communityPosts = communityPosts.filter((p) => p.sourceCardId !== c.id);
          communityDirty = true;
        }
        if (c.communityPostId) c.communityPostId = null;
        continue;
      }
      const post = communityPosts.find((p) => p.sourceCardId === c.id);
      if (post) {
        c.communityPostId = post.id;
      } else if (c.communityPostId && !communityPosts.some((p) => p.id === c.communityPostId)) {
        c.communityPostId = null;
      }
    }
    const mat = materializeCommunityFromCards(list);
    if (communityDirty || mat.dirty) persistCommunity();
    rebuildOwnPostFilterCache();
    pruneOrphanFeatureData();
    return list;
  }

  /** 将已标记「发布到社区」的卡片补成社区帖（修复仅有卡片、无 communityPosts 的情况） */
  function materializeCommunityFromCards(cardList) {
    const list = Array.isArray(cardList) ? cardList : [];
    const user = getActiveUser();
    if (user.id === 'guest') return { added: 0, dirty: false };
    let added = 0;
    let dirty = false;
    for (const c of list) {
      if (!c?.id) continue;
      if (!c.publishedToCommunity) continue;
      if (!isCommunityPromptEligible(c.prompt)) continue;
      const post = communityPosts.find((p) => p.sourceCardId === c.id);
      if (post) {
        const title = (c.title || '').trim() || '';
        if (
          post.prompt !== (c.prompt || '')
          || normalizeImageRefForCompare(post.image) !== normalizeImageRefForCompare(c.image ?? null)
          || post.title !== title
        ) {
          post.prompt = c.prompt || '';
          post.image = c.image ?? null;
          post.title = title;
          post.updatedAt = Date.now();
          dirty = true;
        }
        continue;
      }
      const before = communityPosts.length;
      syncCardToCommunity(c, true, { silent: true, keepPublishFlag: true, skipPersist: true, skipRender: true });
      if (communityPosts.length > before) added += 1;
      dirty = true;
    }
    return { added, dirty };
  }

  function syncEligibleCardsToCommunity(opts = {}) {
    const list = window.__promptHubCards || [];

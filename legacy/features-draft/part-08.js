    let instantSrc = '';
    if (imageRef && isDisplayableImage(imageRef)) {
      instantSrc = window.SupabaseSync?.getCachedDisplayUrl?.(imageRef, {
        assetId: post.sourceCardId || post.id,
        authorId: post.authorId || undefined,
        variant: 'grid'
      }) || '';
      const gridImg = document.querySelector(`#communityGrid .community-post-card[data-post-id="${post.id}"] img.card-img`);
      const gridSrc = gridImg?.currentSrc || gridImg?.src || '';
      if (isPlaceholderSrc(instantSrc) && !isPlaceholderSrc(gridSrc)) instantSrc = gridSrc;
    }
    const hasInstant = !isPlaceholderSrc(instantSrc);
    window.setAppreciateViewerLoading?.(!hasInstant);
    const reveal = () => {
      if (gen !== appreciateViewerGen) return;
      viewer.classList.add('active');
      document.body.classList.add('appreciate-viewing');
    };
    reveal();
    if (imageRef && isDisplayableImage(imageRef)) {
      img.style.display = 'block';
      if (hint) hint.style.display = 'block';
      img.onload = null;
      img.onerror = null;
      let revealed = false;
      const onReady = () => {
        if (gen !== appreciateViewerGen || revealed) return;
        revealed = true;
        img.onload = null;
        img.onerror = null;
        img.style.maxWidth = '';
        img.style.maxHeight = '';
        img.style.objectFit = '';
        if (typeof window.resetImageZoom === 'function') window.resetImageZoom(img);
        if (typeof window.attachImageZoom === 'function') window.attachImageZoom(img);
        window.finishAppreciateViewerReveal?.();
        reveal();
      };
      img.onerror = () => {
        if (gen !== appreciateViewerGen) return;
        img.onload = null;
        img.onerror = null;
        window.setAppreciateViewerLoading?.(false);
        img.style.display = 'none';
        if (hint) hint.style.display = 'none';
        reveal();
      };
      if (hasInstant) {
        img.src = instantSrc;
        if (img.complete && img.naturalWidth > 0) onReady();
        else img.onload = onReady;
      } else {
        img.removeAttribute('src');
        img.onload = onReady;
      }
      void (async () => {
        let displaySrc = imageRef;
        try {
          if (window.MediaPipeline?.resolvePreviewUrl) {
            displaySrc = await window.MediaPipeline.resolvePreviewUrl(imageRef, {
              assetId: signOpts.assetId,
              cardId: signOpts.cardId,
              authorId: signOpts.authorId,
              communityFeed: true,
              gridFallbackUrl: instantSrc || ''
            });
          } else if (window.SupabaseSync?.resolveDisplayUrl) {
            displaySrc = await window.SupabaseSync.resolveDisplayUrl(imageRef, signOpts);
          }
        } catch (e) { /* ignore */ }
        if (gen !== appreciateViewerGen) return;
        if (!displaySrc || isPlaceholderSrc(displaySrc)) {
          if (!hasInstant) img.onerror?.();
          return;
        }
        if (displaySrc === img.src) {
          if (img.complete && img.naturalWidth > 0 && !revealed) onReady();
          return;
        }
        if (hasInstant && revealed) {
          img.onload = () => {
            if (gen !== appreciateViewerGen) return;
            img.onload = null;
            if (typeof window.resetImageZoom === 'function') window.resetImageZoom(img);
          };
          img.src = displaySrc;
          return;
        }
        img.src = displaySrc;
        if (img.complete && img.naturalWidth > 0) onReady();
      })();
    } else {
      img.src = '';
      img.style.display = 'none';
      if (hint) hint.style.display = 'none';
      window.setAppreciateViewerLoading?.(false);
      reveal();
    }
  }

  function closeCommunitySidePanel() {
    const panel = document.getElementById('communitySidePanel');
    if (panel) {
      panel.classList.remove('community-side-panel--open');
      panel.classList.add('community-side-panel--closing');
    }
    document.getElementById('communitySidePanel')?.classList.add('hidden');
    unmountFeatureSidePanel('communitySidePanel');
    panel?.classList.remove('community-side-panel--closing');
    syncCommunityPanelOpenClass();
    communitySidePostId = null;
    openPostId = null;
    document.querySelectorAll('#communityGrid .community-post-card.selected').forEach(el => el.classList.remove('selected'));
    if (!isMobileViewport()) {
      requestAnimationFrame(() => {
        scheduleCommunityLayout('communityGrid', { force: true, immediate: true, recalcCols: true });
      });
    }
  }

  function openCommunityDetail(id) {
    if (document.getElementById('pageCommunity')?.classList.contains('active')) {
      openCommunitySidePanel(id);
      return;
    }
    openCommunitySidePanel(id);
  }

  function closeCommunityDetail() {
    closeCommunitySidePanel();
  }

  function copyPostPromptOnly(post) {
    if (!window.AuthGate?.requireAuth?.('copy')) return;
    const text = post?.prompt || '';
    if (!text) { toast('暂无提示词'); return; }
    navigator.clipboard.writeText(text).then(() => toast('已复制提示词'));
  }

  function copyPostPrompt(post) {
    if (!post) return;
    if (!window.AuthGate?.requireAuth?.('copy')) return;
    const wasNew = ensureLike(post.id);
    const text = post?.prompt || '';
    if (!text) { toast('暂无提示词'); return; }
    navigator.clipboard.writeText(text).then(() => {
      toast(wasNew ? '已复制，已为作者点赞' : '已复制提示词');
    });
  }

  function favoritePost(id, post) {
    if (!window.AuthGate?.requireAuth?.('community')) return;
    ensureLike(id);
    if (favIds.has(id)) {
      toast('已在卡片库中');
      if (communitySidePostId === id) patchCommunitySidePanelUI(id);
      return;
    }
    favIds.add(id);
    persistFavs();
    const user = getActiveUser();
    if (post?.authorId && user.id !== 'guest' && String(post.authorId) !== String(user.id)) {
      pushCommunityEvent({
        type: 'favorite',
        targetUserId: post.authorId,
        actorId: user.id,
        actorName: user.name,
        postId: id,
        postTitle: post.title || (post.prompt || '').slice(0, 24),
        message: `${user.name} 收藏了你的作品`
      });
    }
    void (async () => {
      const r = await addCardFromPost(post);
      if (r?.duplicate) {
        toast('已在卡片库中');
      } else if (r?.ok) {
        toast(r?.imageCopied
          ? '已复制到你的卡片库（独立副本，不受原作者删帖影响）'
          : '已复制提示词；配图复制失败，可重新收藏或手动上传图片');
      } else {
        toast('已记录收藏，图片复制失败时可稍后重试');
      }
      if (communitySidePostId === id) patchCommunitySidePanelUI(id);
    })();
  }

  function addCardFromPost(post) {
    if (typeof window.addCardFromCommunity === 'function') {
      return window.addCardFromCommunity(post);
    }
    return Promise.resolve({ ok: false });
  }

  function remixToImageGen(post) {
    closeCommunitySidePanel();
    if (typeof switchAppPage === 'function') switchAppPage('imagegen');
    imageGenFeedTab = 'community';
    document.querySelectorAll('[data-feed-tab]').forEach(b => {
      b.classList.toggle('active', b.dataset.feedTab === 'community');
    });
    updateImageGenFeedHint();
    fillFromCommunityPost(post, true);
  }

  function saveGeneratedToWarehouse(opts) {
    return ws('saveGeneratedToWarehouse', opts);
  }

  /** GrsAI 临时链约 2 小时失效，恢复窗口与之对齐 */
  const RECENT_GEN_RECOVER_MS = 2 * 3600 * 1000;
  /** 后台恢复超过此时间仍无图 → 标失败并清占位 */
  const RECOVERY_GIVE_UP_MS = 25 * 60 * 1000;
  /** 已进入「恢复中」占位后再等多久强制结案（慢速线用 genRecoveringDeferGiveUpMs） */
  const RECOVERING_DEFER_GIVE_UP_MS = 22 * 60 * 1000;
  const SERVER_RECOVER_AFTER_MS = 8 * 60 * 1000;
  /** API 已 failed 时，非明确可恢复错误最多再等 12 分钟 */
  const FAILED_JOB_RECOVER_MAX_MS = 12 * 60 * 1000;
  let genJobsSyncTimer = null;
  let genJobsSyncInterval = null;
  let genJobsSyncRetry = 0;
  let imageGenFeedRenderTimer = null;

  function imageGenFeedScrollEl() {
    return document.getElementById('imageGenFeed');
  }

  function scheduleImageGenFeedRenderFromJobs(delayMs) {
    if (!document.getElementById('pageImageGen')?.classList.contains('active')) return;
    clearTimeout(imageGenFeedRenderTimer);
    imageGenFeedRenderTimer = setTimeout(() => {
      imageGenFeedRenderTimer = null;
      renderImageGenFeed({ preserveScroll: true });
      renderImageGenMobileResult();
    }, delayMs == null ? 1800 : delayMs);
  }

  function getGenJobStateUid() {
    return window.SupabaseSync?.getUserId?.() || localStorage.getItem('promptrepo_last_uid') || 'guest';
  }

  function loadGenJobStateFromLocal() {
    try {
      const raw = localStorage.getItem(LS_GEN_JOBS_STATE);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const uid = getGenJobStateUid();
      if (data?.uid && data.uid !== uid && uid !== 'guest') return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function mergePendingGenJobLists(...lists) {
    const byKey = new Map();
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const p of list) {
        if (!p?.id) continue;
        const key = p.jobId ? String(p.jobId) : String(p.id);
        const prev = byKey.get(key);
        if (!prev || (p.startedAt || 0) >= (prev.startedAt || 0)) byKey.set(key, p);
      }
    }
    return [...byKey.values()].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }

  function persistGenJobStateToLocal() {
    try {
      localStorage.setItem(LS_GEN_JOBS_STATE, JSON.stringify({
        uid: getGenJobStateUid(),
        updatedAt: Date.now(),
        pending: imageGenPendingJobs.slice(0, 32),
        session: getSessionGenJobIdsRaw()
      }));
    } catch (e) { /* ignore */ }
  }

  function filterPendingGenJobsByAge(list) {
    const now = Date.now();
    return (list || []).filter((p) => {
      const age = now - (p.startedAt || 0);
      if (p.recovering) {
        return p.jobId ? age < RECENT_GEN_RECOVER_MS : age < 30 * 60 * 1000;
      }
      if (p.jobId) return age < RECENT_GEN_RECOVER_MS;
      return age < 15 * 60 * 1000;
    });
  }

  function getSessionGenJobIdsRaw() {
    try {
      const raw = sessionStorage.getItem(LS_SESSION_GEN_JOBS);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.map(String) : [];
    } catch (e) {
      return [];
    }
  }

  function writeSessionGenJobIds(list) {
    const ids = [...new Set((list || []).map(String).filter(Boolean))];
    while (ids.length > 40) ids.shift();
    try {
      sessionStorage.setItem(LS_SESSION_GEN_JOBS, JSON.stringify(ids));
    } catch (e) { /* ignore */ }
    persistGenJobStateToLocal();
  }

  function afterGenJobsResume(changed) { return jr('afterGenJobsResume', changed); }

  function scheduleImageGenPendingUiRefresh() { return jr('scheduleImageGenPendingUiRefresh'); }

  function persistPendingGenJobs() { return jr('persistPendingGenJobs'); }

  function loadPendingGenJobs() { return jr('loadPendingGenJobs'); }

  function persistFailedGenJobs() { return jr('persistFailedGenJobs'); }

  function loadFailedGenJobs() { return jr('loadFailedGenJobs'); }

  function batchIndexLabel(index, total) {
    if (index && total && total > 1) return `第 ${index}/${total} 张`;
    return '';
  }

  function stringifyGenErrorRaw(errRaw) { return ge('stringifyGenErrorRaw', errRaw) ?? ''; }
  function isStaleConfigError(msg) { return !!ge('isStaleConfigError', msg); }
  function isLikelyRecoverableGenFailure(errRaw, ctx, opts) { return !!ge('isLikelyRecoverableGenFailure', errRaw, ctx, opts); }
  function friendlyGenErrorMessage(msg) { return ge('friendlyGenErrorMessage', msg) ?? '生图失败，积分已全额退回'; }

  function addFailedGenJob(job) { return jr('addFailedGenJob', job); }

  function removeFailedGenJob(failId) { return jr('removeFailedGenJob', failId); }

  function clearFailedGenJobsForRecovery(opts) { return jr('clearFailedGenJobsForRecovery', opts); }

  /** 提交请求网络中断时，从 API 找回刚创建的 processing 任务 */
  async function tryRecoverOrphanGenJobAfterSubmitError(payload, pendingId, pendingJob) { return jr('tryRecoverOrphanGenJobAfterSubmitError', payload, pendingId, pendingJob); }

  function failPendingJob(pendingId, errorMessage) { return jr('failPendingJob', pendingId, errorMessage); }

  function toastGenFailure(ctx, message) {
    const label = batchIndexLabel(ctx?.batchIndex, ctx?.batchTotal);
    const msg = String(message || '生图失败，积分已全额退回');
    toast(label ? `${label} ${msg}` : msg);
  }

  function pendingJobToPollCtx(job) { return jr('pendingJobToPollCtx', job) || {}; }

  function isRecentGenJob(job) { return !!jr('isRecentGenJob', job); }

  function shouldAutoRecoverCompletedJob(job) { return !!jr('shouldAutoRecoverCompletedJob', job); }

  function warehouseCardImageNeedsRecovery(card, apiImageUrl) {
    return wr('warehouseCardImageNeedsRecovery', card, apiImageUrl);
  }

  async function repairMjWarehouseCardFields(card, fields) {
    return wr('repairMjWarehouseCardFields', card, fields);
  }

  async function repairMjGalleryFromJob(card) {
    return wr('repairMjGalleryFromJob', card);
  }

  async function repairWarehouseCardImageFromJob(card, imageUrl, jobId) {
    return wr('repairWarehouseCardImageFromJob', card, imageUrl, jobId);
  }

  /** 用户删卡片时：标记 job 已删，避免 API 恢复把它拉回来 */
  function onCardDeletedForGen(card) {
    if (!card) return;
    const jobId = card.genJobId;
    if (jobId) {
      const baseJobId = normalizeGenJobBaseId(jobId);
      window.recordGenerationJobDeletion?.(jobId);
      if (baseJobId && baseJobId !== String(jobId)) {
        window.recordGenerationJobDeletion?.(baseJobId);
      }
      clearSessionGenJob(jobId);
      if (baseJobId && baseJobId !== String(jobId)) clearSessionGenJob(baseJobId);
      const relatedCreations = creations.filter((c) => {
        if (!c?.jobId) return false;
        const cBase = normalizeGenJobBaseId(c.jobId);
        return c.jobId === jobId || cBase === baseJobId;
      });
      for (const cre of relatedCreations) {
        recordCreationDeletion(cre.id, cre.jobId);
      }
      if (relatedCreations.length) {
        const tombIds = new Set(relatedCreations.map((c) => String(c.id)));
        creations = creations.filter((c) => !tombIds.has(String(c.id)));
        persistCreations();
      }
    }
  }

  async function listRecoverableOrphanJobs(opts) { return jr('listRecoverableOrphanJobs', opts) || []; }

  async function settleStuckGenerationJob(job, opts) { return jr('settleStuckGenerationJob', job, opts); }

  async function recoverSingleJobFromApi(job, opts) { return jr('recoverSingleJobFromApi', job, opts); }

  async function recoverLostGenerationsFromApi() {
    return { ok: true, recovered: 0 };
  }

  async function repairMissingGenCardImagesQuiet() {
    return wr('repairMissingGenCardImagesQuiet');
  }

  async function repairMjWarehousePreviewsQuiet() {
    return wr('repairMjWarehousePreviewsQuiet');
  }

  async function recoverRecentGenerationJobs(opts) { return jr('recoverRecentGenerationJobs', opts); }

  function getSessionGenJobIds() { return jr('getSessionGenJobIds') || []; }
  function trackSessionGenJob(jobId) { return jr('trackSessionGenJob', jobId); }
  function clearSessionGenJob(jobId) { return jr('clearSessionGenJob', jobId); }
  function isSessionGenJob(jobId) { return !!jr('isSessionGenJob', jobId); }
  function deferPendingJobRecovery(pendingId, ctx, note) { return jr('deferPendingJobRecovery', pendingId, ctx, note); }
  function scheduleGenJobsSync(delayMs) { return jr('scheduleGenJobsSync', delayMs); }
  function startGenJobsBackgroundSync() { return jr('startGenJobsBackgroundSync'); }
  function purgeExpiredGenPendingJobs() { return jr('purgeExpiredGenPendingJobs'); }
  function shouldDeferFailedPendingRecovery(pending, apiJob, ctx) { return !!jr('shouldDeferFailedPendingRecovery', pending, apiJob, ctx); }
  function abandonUnrecoverablePendingJob(pending, reason, opts) { return jr('abandonUnrecoverablePendingJob', pending, reason, opts); }
  async function resumePendingGenerationJobs(opts) { return jr('resumePendingGenerationJobs', opts); }
  async function resolvePendingFromApiJob(pending, apiJob, opts) { return jr('resolvePendingFromApiJob', pending, apiJob, opts); }
  async function tryRecoverPendingJobDirect(pending) { return jr('tryRecoverPendingJobDirect', pending); }
  async function tryServerRecoverPending(pending) { return jr('tryServerRecoverPending', pending); }
  async function refreshGenerationJobFromServer(job, opts) { return jr('refreshGenerationJobFromServer', job, opts); }
  async function collectJobsNeedingRecovery(opts) { return jr('collectJobsNeedingRecovery', opts) || []; }
  function needsApiImageRecovery(jobId, apiImageUrl, force) { return !!jr('needsApiImageRecovery', jobId, apiImageUrl, force); }
  function findWarehouseCardForJob(jobId) { return jr('findWarehouseCardForJob', jobId); }
  function hasWarehouseCardForJob(jobId) { return !!jr('hasWarehouseCardForJob', jobId); }
  function pendingHasWarehouseCard(pending) { return !!jr('pendingHasWarehouseCard', pending); }
  function findWarehouseCardForPending(pending) { return jr('findWarehouseCardForPending', pending); }
  function prunePendingJobsWithCreations() { return jr('prunePendingJobsWithCreations'); }
  function prunePendingJobsWithWarehouseCards() { return prunePendingJobsWithCreations(); }
  function findBestApiJobForPrompt(jobs, prompt, model, opts) { return jr('findBestApiJobForPrompt', jobs, prompt, model, opts); }
  function pendingPromptsMatch(a, b) { return !!jr('pendingPromptsMatch', a, b); }
  function getImageGenPendingJobsForFeed() { return jr('getImageGenPendingJobsForFeed') || imageGenPendingJobs; }

  async function runImageGenWithPrompt(promptOverride, opts) {
    return ig('runImageGenWithPrompt', promptOverride, opts);
  }

  async function runImageGenDemo() {
    if (imageGenBatchRunning) {
      toast('生图任务提交中，请稍候');
      return;
    }
    const count = getImageGenBatchCount();
    if (count <= 1) {
      await runImageGenWithPrompt();
      return;
    }

    const prompt = String(document.getElementById('imageGenPrompt')?.value || '').trim();
    if (!prompt) {
      toast('请先填写提示词');
      return;
    }
    if (!window.AuthGate?.requireAuth?.('imagegen')) return;

    const meta = getImageGenFormMeta();
    let unit = window.PointsSystem?.getImageGenCost?.(meta.model, meta.resolution) ?? 10;
    if (window.PointsSystem?.useApiForAccount?.()) {
      const quoted = await quoteGenerationCost(meta.resolution, meta.quality, meta.model, unit);
      unit = quoted.cost;
    }
    unit = window.PointsSystem?.roundCredits?.(unit) ?? unit;
    const fmt = window.PointsSystem?.formatCredits || ((n) => String(n));
    const balance = window.PointsSystem?.getCredits?.() ?? 0;
    const totalNeed = window.PointsSystem?.roundCredits?.(unit * count) ?? unit * count;
    if (balance < unit) {
      toast(`积分不足（每张 ${fmt(unit)}，当前 ${fmt(balance)}）`);
      return;
    }
    if (balance < totalNeed) {
      toast(`积分约够 ${Math.floor(balance / unit)} 张，将按顺序提交直到不足（${fmt(unit)} 积分/张）`);
    }

    imageGenBatchRunning = true;
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const btn = document.getElementById('imageGenSubmit');
    if (btn) btn.disabled = true;
    try {
      let ok = 0;
      let charged = 0;
      for (let i = 0; i < count; i += 1) {
        const curBalance = window.PointsSystem?.getCredits?.() ?? 0;
        if (curBalance < unit && i > 0) break;
        if (btn) btn.textContent = `提交中 ${i + 1}/${count}…`;
        const res = await runImageGenWithPrompt(undefined, {
          silentToast: true,
          batch: true,
          batchId,
          batchIndex: i + 1,
          batchTotal: count,
          batchMergeCards: shouldImageGenBatchMergeCards(),
          cardTitle: getImageGenCardTitle()
        });
        if (res?.ok) {
          ok += 1;
          charged += res.creditsCharged || unit;
        } else if (res?.reason === 'credits') {
          break;
        } else if (i === 0) {
          break;
        }
        if (i < count - 1) await new Promise((r) => setTimeout(r, 2200 + Math.floor(Math.random() * 800)));
      }
      await window.PointsSystem?.refreshCreditsFromServer?.();
      window.PointsSystem?.updateCreditsUI?.();
      if (ok > 0) {
        const split = isImageGenBatchSplitCards();
        const isMj = isImageGenMidjourneyModel(getImageGenModel());
        toast(
          isMj
            ? `已提交 ${ok}/${count} 个 MJ 任务，每张完成后单独建卡（约 ${fmt(charged)} 积分）`
            : split
              ? `已提交 ${ok}/${count} 张生图，已扣约 ${fmt(charged)} 积分（${fmt(unit)} 积分/张）`
              : `已提交 ${ok}/${count} 张，完成后合并存入同一卡片（最多 5 张，约 ${fmt(charged)} 积分）`
        );
        if (isMobileViewport() && window.MobileUI?.setImageGenView) {
          window.MobileUI.setImageGenView('feed', { scrollToTop: false });
        }
      }
    } catch (e) {
      console.error('[imagegen] batch submit failed', e);
      toast('批量生图提交失败，请刷新页面后重试');
    } finally {
      imageGenBatchRunning = false;
      if (btn) {
        btn.disabled = false;
        restoreImageGenSubmitLabel();
      }
    }
  }

  async function finishImageGenRun(opts) {
    const out = await fr('finishImageGenRun', opts);
    if (opts?.jobId && !opts?.isRecovery) {
      scheduleRecentCreationsServerSync({
        force: true,
        render: !isImageGenMobileFormActive()
      }, 1800);
    }
    return out;
  }

  function updateImageGenFeedHint() {
    const el = document.getElementById('imageGenFeedHint');
    if (!el) return;
    const mobile = isMobileViewport();
    if (imageGenFeedTab === 'recent') {
      const list = getRecentCreationsForFeed();
      const n = list.length;
      const max = getRecentCreationsLimit();
      const tier = window.Membership?.getMemberTier?.();
      const tierHint = tier === 'pro' ? '专业版'
        : tier === 'standard' ? '标准版'
          : tier === 'basic' ? '基础版'
            : tier === 'lite' ? '轻量版' : '免费';
      if (!n) {
        el.textContent = `最近生成保留 7 天 · 最多 ${max} 条（${tierHint}）· 喜欢请点「存入库」`;
        el.hidden = false;
        return;
      }
      el.hidden = false;
      el.textContent = mobile
        ? `最近 ${n}/${max} 条 · 7 天 · 点 × 可删除`
        : `最近 ${n}/${max} 条（${tierHint}）· 7 天内有效 · 超出条数或到期未存入库将自动删除`;
      return;
    }
    el.hidden = false;
    if (imageGenFeedTab === 'community') {
      el.textContent = mobile
        ? '获取 · 点图放大 · 按钮复制或填入生图'
        : '获取 · 点击图片放大 · 点击卡片查看详情';
    }
  }

  function copyFeedPromptText(prompt) {
    const text = (prompt || '').trim();
    if (!text) {
      toast('暂无提示词');
      return;
    }
    navigator.clipboard.writeText(text).then(() => toast('已复制提示词'));
  }

  function getActiveImageGenMode() {
    const fold = document.getElementById('imageGenInspireFold');
    if (fold?.open) return 'inspire';
    return document.body?.dataset?.imagegenMode === 'inspire' ? 'inspire' : 'gen';
  }

  function fillFeedPromptToActiveMode(prompt, opts = {}) {
    const text = String(prompt || '');
    const openInspire = opts.inspire === true;
    fillFormPromptOnly(text);
    if (openInspire) {
      window.ImageGenPromptTools?.openInspireFold?.();
      toast('已填入提示词；已展开灵感抽卡');
    } else {
      toast('已填入提示词');
    }
    if (isMobileViewport()) window.MobileUI?.setImageGenView?.('form');
  }

  function fillFeedRefToActiveMode(refImage, opts = {}) {
    const refs = Array.isArray(opts.refImages) ? opts.refImages : (refImage ? [refImage] : []);
    const cleanRefs = refs.filter((ref) => isDisplayableImage(ref));
    if (!cleanRefs.length) {
      toast('当前作品没有可填入的参考图');
      return false;
    }
    fillFormRefOnly(cleanRefs[0], cleanRefs, { assetId: opts.assetId });
    if (isMobileViewport()) window.MobileUI?.setImageGenView?.('form');
    return true;
  }

  function fillFeedAllToActiveMode(prompt, refImage, opts = {}) {
    const refs = (Array.isArray(opts.refImages) ? opts.refImages : (refImage ? [refImage] : []))
      .filter((ref) => isDisplayableImage(ref));
    fillFormFromData({
      prompt: String(prompt || ''),
      refImages: refs.length ? refs : undefined,
      refAssetId: opts.assetId
    });
    toast(refs.length ? '已填入提示词和参考图' : '已填入提示词');
    if (isMobileViewport()) window.MobileUI?.setImageGenView?.('form');
    return true;
  }

  async function regenerateFeedItem(prompt, refImage, opts = {}) {
    const text = String(prompt || '').trim();
    const refs = (Array.isArray(opts.refImages) ? opts.refImages : (refImage ? [refImage] : []))
      .filter((ref) => isDisplayableImage(ref));
    if (!text && !refs.length) {
      toast('当前作品缺少可再次生成的内容');
      return { ok: false };
    }
    if (typeof switchAppPage === 'function') switchAppPage('imagegen');
    fillFormFromData({
      prompt: text,
      refImages: refs.length ? refs : undefined,
      refAssetId: opts.assetId
    });
    return runImageGenWithPrompt(text, {
      refImages: refs.length ? refs : undefined
    });
  }

  function fillFeedPromptToImageGen(prompt) {
    fillFeedPromptToActiveMode(prompt);
  }

  async function fillCardToImageGen(card) {
    if (!card) return;
    if (typeof switchAppPage === 'function') switchAppPage('imagegen');
    fillFormPromptOnly(card.prompt || '');
    const ref = card.image;
    if (ref && isDisplayableImage(ref)) {
      let url = ref;
      try {
        if (window.MediaPipeline?.resolvePreviewUrl) {
          const resolved = await window.MediaPipeline.resolvePreviewUrl(ref, {
            assetId: card.id,
            cardId: card.id,
            jobId: card.genJobId || null
          });
          if (resolved && !String(resolved).includes('data:image/svg')) url = resolved;
        } else if (window.SupabaseSync?.resolveDisplayUrl) {
          const resolved = await window.SupabaseSync.resolveDisplayUrl(ref, { assetId: card.id });
          if (resolved && !String(resolved).includes('data:image/svg')) url = resolved;
        }
      } catch (e) { /* ignore */ }
      fillFormRefOnly(url, [url]);
    }
    if (isMobileViewport()) window.MobileUI?.setImageGenView?.('form');
    toast('已填入生图（提示词与参考图）');
  }



  function failedJobModelLabel(job) {
    if (job.model) return imageGenModelLabel(job.model);
    const lbl = String(job.modelLabel || '').trim();
    if (lbl === '全能模型2' || lbl === 'quanneng2') return 'GPT Image 2';
    return lbl || 'GPT Image 2';
  }

  function renderImageGenMobileResult() {
    /* 手机「最近生成」横条已移除，作品在「作品」Tab 按最近生成排序展示 */
  }



  function clearImageGenFeedSelection() {
    document.querySelectorAll('#imageGenFeed .imagegen-feed-card').forEach((el) => {
      el.classList.remove('active-preview', 'card-selected-bloom', 'card-press-pop');
      el.style.removeProperty('transform');
      el.style.removeProperty('transition');
    });
  }

  function bindImageGenPreviewActions() {
    const body = document.getElementById('imageGenPreviewBody');
    if (!body || body.dataset.previewActionsBound === '1') return;
    body.dataset.previewActionsBound = '1';
    const getPreviewRefs = () => {
      let refs = [];
      try {
        if (body.dataset.previewRefs) refs = JSON.parse(body.dataset.previewRefs) || [];
      } catch (e) { /* ignore */ }
      return { refImages: refs, refImage: body.dataset.previewRef || '' };
    };
    body.addEventListener('click', (e) => {
      if (!imageGenPreviewId || !imageGenPreviewKind) return;
      const copyBtn = e.target.closest('[data-preview-copy-prompt]');
      if (copyBtn) {
        e.preventDefault();
        e.stopPropagation();
        const text = body.dataset.previewPrompt || '';
        if (!text) return;
        navigator.clipboard?.writeText(text).then(
          () => toast('提示词已复制'),
          () => toast('复制失败')
        );
        return;
      }
      const fillAll = e.target.closest('[data-preview-fill-all]');
      if (fillAll) {
        e.preventDefault();
        e.stopPropagation();
        const { refImages: ri, refImage: r1 } = getPreviewRefs();
        const assetId = imageGenPreviewKind === 'warehouse' ? imageGenPreviewId : '';
        fillFormFromData({
          prompt: body.dataset.previewPrompt || '',
          refImages: ri.length ? ri : undefined,
          refImage: ri.length ? undefined : r1,
          refAssetId: assetId || undefined
        });
        return;
      }
      const regenerateBtn = e.target.closest('[data-preview-regenerate]');
      if (regenerateBtn) {
        e.preventDefault();
        e.stopPropagation();
        const { refImages: ri, refImage: r1 } = getPreviewRefs();
        const refs = (ri.length ? ri : (r1 ? [r1] : [])).filter((ref) => isDisplayableImage(ref));
        fillFormFromData({
          prompt: body.dataset.previewPrompt || '',
          refImages: refs.length ? refs : undefined,
          refAssetId: imageGenPreviewKind === 'warehouse' ? imageGenPreviewId : undefined
        });
        void runImageGenWithPrompt(body.dataset.previewPrompt || '', {
          refImages: refs.length ? refs : undefined
        });
        return;
      }
      const fillPrompt = e.target.closest('[data-preview-fill-prompt]');
      if (fillPrompt) {
        e.preventDefault();
        e.stopPropagation();
        fillFormPromptOnly(body.dataset.previewPrompt || '');
        return;
      }
      const fillRef = e.target.closest('[data-preview-fill-ref]');
      if (fillRef) {
        e.preventDefault();
        e.stopPropagation();
        if (fillRef.disabled) return;
        const { refImages: ri, refImage: r1 } = getPreviewRefs();
        const assetId = imageGenPreviewKind === 'warehouse' ? imageGenPreviewId : '';
        fillFormRefOnly(r1, ri, { assetId: assetId || undefined });
        return;
      }
      const saveWhBtn = e.target.closest('[data-preview-save-warehouse]');
      if (saveWhBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (imageGenPreviewKind === 'recent' && imageGenPreviewId) {
          void saveCreationToWarehouse(imageGenPreviewId);
        }
        return;
      }
      const delRecentBtn = e.target.closest('[data-preview-delete-recent]');
      if (delRecentBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (imageGenPreviewKind === 'recent' && imageGenPreviewId) {
          confirmDeleteCreation(imageGenPreviewId);
        }
        return;
      }
      const likeBtn = e.target.closest('[data-preview-like]');
      if (likeBtn) {
        e.preventDefault();
        e.stopPropagation();
        likeCommunityPostOnly(imageGenPreviewId);
        renderImageGenPreview();
      }
    });
  }

  function primeImageGenPreviewShell(kind, id) {
    const body = document.getElementById('imageGenPreviewBody');
    if (!body) return;
    const feedKey = kind === 'warehouse' ? 'wh_' + id : (kind === 'recent' ? 'cr_' + id : id);
    const cardEl = document.querySelector(`#imageGenFeed .imagegen-feed-card[data-feed-id="${feedKey}"]`);
    let prompt = cardEl?.dataset.feedPrompt || '';
    let image = '';
    let instantSrc = '';
    const refImages = [];
    const addPrimeRef = (ref) => {
      const value = String(ref || '').trim();
      if (!value || !isDisplayableImage(value) || refImages.includes(value)) return;
      refImages.push(value);
    };
    const applyPrimeRefs = (item) => {
      if (!item) return;
      if (Array.isArray(item.refImages)) item.refImages.forEach(addPrimeRef);
      addPrimeRef(item.refImage);
    };
    try {
      const parsedRefs = cardEl?.dataset.feedRefs ? JSON.parse(cardEl.dataset.feedRefs) : null;
      if (Array.isArray(parsedRefs)) parsedRefs.forEach(addPrimeRef);
    } catch (e) { /* ignore malformed dataset */ }
    addPrimeRef(cardEl?.dataset.feedRef);
    const feedImg = cardEl?.querySelector('.imagegen-feed-media img');
    if (feedImg) {
      image = feedImg.getAttribute('data-image-ref') || '';
      const src = feedImg.currentSrc || feedImg.src || '';
      const path = window.SupabaseSync?.storagePathFromDisplayUrl?.(src) || '';
      const isGridThumb = path && /_grid\.(jpe?g|webp|png)$/i.test(path);
      if (/^https?:\/\//i.test(src) && !src.includes('data:image/svg') && feedImg.naturalWidth > 8 && !isGridThumb) {
        instantSrc = src;
      }
    }
    if (kind === 'recent') {
      const c = findCreationById(id);
      if (c) {
        prompt = c.prompt || prompt;
        image = c.image || image;
        applyPrimeRefs(c);
      }
    } else if (kind === 'warehouse') {
      const c = (window.getWarehouseCardsForImageGen?.() || []).find((x) => x.id === id);
      if (c) {
        prompt = c.prompt || prompt;
        image = c.image || image;
        applyPrimeRefs(c);
      }
    } else if (kind === 'community') {
      const post = findPost(id);
      if (post) {
        prompt = post.prompt || prompt;
        image = post.image || image;
        applyPrimeRefs(post);
      }
    }
    if (!refImages.length && isDisplayableImage(image)) addPrimeRef(image);
    const hasRef = refImages.length > 0;
    const fillHtml = buildPreviewFillActions(hasRef, '');
    const imgHtml = isDisplayableImage(image)
      ? `<div class="imagegen-preview-img-wrap">
          <button type="button" class="imagegen-preview-img-btn" data-preview-zoom title="点击全屏查看大图">
            ${instantSrc
              ? `<img src="${esc(instantSrc)}" alt="" draggable="false" style="cursor:zoom-in">`
              : '<span class="media-skeleton"></span>'}
          </button>
          <button type="button" class="imagegen-preview-dl-btn" data-preview-download title="下载到电脑"${instantSrc ? '' : ' disabled'} aria-label="下载图片">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12m0 0l4-4m-4 4l-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
            <span>下载</span>
          </button>
        </div>`
      : '';
    body.innerHTML = `${imgHtml}<div class="imagegen-preview-prompt">${esc(prompt)}</div>${fillHtml}`;
    body.dataset.previewPrompt = prompt;
    if (hasRef) {
      body.dataset.previewRef = refImages[0];
      body.dataset.previewRefs = JSON.stringify(refImages);
    } else {
      delete body.dataset.previewRef;
      delete body.dataset.previewRefs;
    }
    if (instantSrc) {
      body.dataset.previewImageUrl = instantSrc;
      body.dataset.previewImageReady = '1';
    } else {
      delete body.dataset.previewImageUrl;
      delete body.dataset.previewImageReady;
    }
  }

  function closeImageGenPreview() {
    imageGenPreviewRenderSeq += 1;
    imageGenPreviewId = null;
    imageGenPreviewKind = null;
    document.getElementById('imageGenPreviewPanel')?.classList.add('hidden');
    document.querySelector('.imagegen-side')?.classList.remove('imagegen-preview-open');
    clearImageGenFeedSelection();
    if (isMobileViewport()) enforceMobileImageGenFeed();
    else scheduleImageGenFeedLayout({ immediate: true });
  }

  async function downloadImageGenPreviewImage(body, previewKind, previewAssetId, triggerBtn) {
    if (!body || body.dataset.previewImageReady !== '1') {
      toast('图片加载中，请稍后再下载');
      return;
    }
    const url = body.dataset.previewImageUrl || '';
    const img = body.querySelector('.imagegen-preview-img-btn img');
    const dlBtn = triggerBtn || body.querySelector('[data-preview-download]');
    try {
      if (previewKind === 'warehouse' && previewAssetId && typeof window.downloadCardImageFile === 'function') {
        const c = (window.getWarehouseCardsForImageGen?.() || []).find((x) => x.id === previewAssetId);
        if (c?.image) {
          await window.downloadCardImageFile(c.image, c.id, null, {

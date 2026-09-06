        throw new Error(r?.message || 'delete-owned failed');
      } catch (e) {
        console.warn('[SupabaseSync] delete-owned API failed, fallback storage.remove', e);
      }
    }

    const sb = getClient();
    if (!sb) return;
    const grid = gridPathFromPrimary(path);
    const removeList = grid ? [path, grid] : [path];
    await sb.storage.from(BUCKET).remove(removeList);
  }

  function clearPathMissingForCard(cardId, image) {
    for (const p of listImagePathCandidates(image, cardId)) {
      const nk = normalizePathKey(p);
      missingPathCache.delete(nk);
      if (/_grid\.(jpe?g|webp|png)$/i.test(nk)) gridFetchFailedPaths.delete(nk);
      else {
        const grid = gridPathFromPrimary(p);
        if (grid) gridFetchFailedPaths.delete(normalizePathKey(grid));
      }
    }
    persistMissingPathCache();
  }

  /** 清除误标的「无图」缓存（网速慢时 audit 曾误判，导致黑块） */
  function resetMissingPathCache() {
    missingPathCache.clear();
    gridFetchFailedPaths.clear();
    try { localStorage.removeItem(LS_MISSING_PATHS); } catch (e) { /* ignore */ }
  }

  function healMissingPathCacheForCards(cards) {
    if (!Array.isArray(cards)) return 0;
    let n = 0;
    for (const c of cards) {
      if (!c?.id || !c?.image) continue;
      clearPathMissingForCard(c.id, c.image);
      n += 1;
    }
    return n;
  }

  function uploadOptsForCard(card) {
    const forceOriginal = isGeneratedWarehouseCard(card);
    return {
      original: forceOriginal || card?.imageUploadOriginal === true || cardUploadOriginalEnabled()
    };
  }

  async function fetchBlobFromCdnPath(path, assetId) {
    const key = String(path || '').replace(/^\//, '');
    if (!key || isGridStoragePath(key)) return null;
    try {
      const url = await resolvePathToUrl(toStorageRef(key), VARIANT_FULL, {
        cardId: assetId,
        bypassSignBudget: true
      });
      if (!url) return null;
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) return null;
      const ct = String(res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('json')) return null;
      const blob = await res.blob();
      if ((blob.size || 0) < MIN_VALID_IMAGE_BYTES) return null;
      if (blob.type && blob.type.includes('json')) return null;
      return blob;
    } catch (e) {
      return null;
    }
  }

  async function downloadCardStorageBlob(image, assetId, opts = {}) {
    if (!image || typeof image !== 'string' || !isLoggedIn()) return null;
    await ensureSession();
    const sb = getClient();
    if (!sb) return null;
    const normalized = normalizeImageRef(image);
    const minBytes = Math.max(0, Number(opts?.minBytes) || 0);
    const jobId = opts?.jobId || null;
    const preferLargest = opts.preferLargest !== false && !!jobId;
    const candidates = pathsForVariant(normalized, assetId, null, VARIANT_FULL, jobId)
      .filter((p) => !isGridStoragePath(p));
    let bestSmall = null;
    let bestBlob = null;
    let bestAboveMin = null;
    for (const raw of candidates) {
      const key = String(raw || '').replace(/^\//, '');
      if (!key || isGridStoragePath(key)) continue;
      let blob = null;
      try {
        const { data, error } = await sb.storage.from(BUCKET).download(key);
        if (!error && data && data.size > 0) blob = data;
      } catch (e) {
        console.warn('[SupabaseSync] storage download failed', key, e);
      }
      if (!blob) {
        blob = await fetchBlobFromCdnPath(key, assetId);
      }
      if (blob && blob.size > 0) {
        if (preferLargest) {
          if (!bestBlob || blob.size > bestBlob.size) bestBlob = blob;
          if (minBytes > 0 && blob.size >= minBytes) {
            if (!bestAboveMin || blob.size > bestAboveMin.size) bestAboveMin = blob;
          }
          continue;
        }
        if (minBytes > 0 && blob.size < minBytes) {
          if (!bestSmall || blob.size > bestSmall.size) bestSmall = blob;
          continue;
        }
        return blob;
      }
    }
    if (preferLargest) return bestAboveMin || bestBlob;
    return bestSmall;
  }

  async function rearchiveGeneratedCardFromJob(card) {
    if (!card?.genJobId || !window.PromptHubApi?.recoverWarehouseFromJobs) return false;
    const jobId = String(card.genJobId).replace(/#\d+$/, '');
    try {
      const r = await window.PromptHubApi.recoverWarehouseFromJobs({
        mode: 'repair',
        jobIds: [jobId],
        max: 1,
        days: 7
      });
      if (r?.ok && (r.data?.repaired > 0 || (r.data?.cardIds || []).length)) return true;
    } catch (e) {
      console.warn('[SupabaseSync] server repair gen image failed', jobId, e);
    }
    if (!window.PromptHubApi?.getGenerationImageUrl) return false;
    try {
      if (window.WarehouseThumb?.resolveForCard) {
        await window.WarehouseThumb.resolveForCard(card.image, {
          jobId,
          assetId: card.id,
          cardId: card.id
        });
      }
      return !!(card.image && isStorageRef(card.image));
    } catch (e) {
      console.warn('[SupabaseSync] rearchive from job url failed', jobId, e);
      return false;
    }
  }

  /** 生图下载：多路径取最大体积；体积不达标时从上游任务重新归档 */
  async function downloadCardFullResBlob(card, opts = {}) {
    if (!card?.image) return null;
    const skipRepair = opts.skipRepair === true;
    const resKey = opts.resolution || card.resolution || '1k';
    const minBytes = expectedMinFullImageBytes(resKey);
    const jobId = card.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : null;
    const dlOpts = { jobId, minBytes, preferLargest: !!jobId };
    let blob = await downloadCardStorageBlob(card.image, card.id, dlOpts);
    const usableFloor = Math.min(minBytes || 0, 80 * 1024);
    const tooSmall = minBytes > 0 && blob && blob.size < usableFloor;
    if (blob && !tooSmall) return blob;
    if (skipRepair && !tooSmall) return blob;
    if (isGeneratedWarehouseCard(card) && jobId) {
      await rearchiveGeneratedCardFromJob(card);
      blob = await downloadCardStorageBlob(card.image, card.id, dlOpts);
      if (blob && (!minBytes || blob.size >= minBytes)) return blob;
    }
    return blob;
  }

  /** 登录态：保证卡片图在 Storage（可上传则上传，已有则校验） */
  async function ensureCardImageOnCloud(card) {
    const cardId = card?.id;
    if (!cardId || !isLoggedIn()) {
      return { ok: true, image: card?.image ?? null };
    }
    const image = card?.image;
    if (!image) return { ok: true, image: null };

    if (isDataUrl(image) || (typeof image === 'string' && image.startsWith('blob:'))) {
      try {
        const url = await uploadCardImage(cardId, image, uploadOptsForCard(card));
        if (typeof window.clearCardImageBackup === 'function') {
          await window.clearCardImageBackup(cardId);
        }
        clearPathMissingForCard(cardId, url);
        return { ok: true, image: url, uploaded: true };
      } catch (e) {
        return { ok: false, image, error: formatError(e) };
      }
    }

    if (typeof image === 'string' && /^https?:\/\//i.test(image)) {
      if (isCdnMediaUrl(image) || /supabase\.co\/storage\/v1\/object/i.test(image)) {
        return { ok: true, image: normalizeImageRef(image) || image };
      }
      if (/aitohumanize|filesystem\.site|apimart\.ai|grsai\.com/i.test(image)) {
        markImageUploadSkip(cardId);
        return { ok: true, image };
      }
      try {
        const url = await resolveCardImageForSave(cardId, image, null, uploadOptsForCard(card));
        if (typeof window.clearCardImageBackup === 'function') {
          await window.clearCardImageBackup(cardId);
        }
        clearPathMissingForCard(cardId, url);
        return { ok: true, image: url, uploaded: true };
      } catch (e) {
        return { ok: false, image, error: formatError(e) };
      }
    }

    if (!isStorageRef(image)) {
      return { ok: true, image };
    }

    const normalized = normalizeImageRef(image);
    clearPathMissingForCard(cardId, normalized);
    if (await verifyStorageRef(normalized, cardId, { quick: false })) {
      return { ok: true, image: normalized };
    }
    const existing = await downloadCardStorageBlob(normalized, cardId);
    if (existing && isValidImageBlob(existing) && await blobLooksLikeUsableImage(existing)) {
      clearPathMissingForCard(cardId, normalized);
      return { ok: true, image: normalized };
    }

    if (isGeneratedWarehouseCard(card) && card.genJobId) {
      const repaired = await rearchiveGeneratedCardFromJob(card);
      if (repaired) {
        const fresh = card.image || normalized;
        if (await verifyStorageRef(fresh, cardId, { quick: false })) {
          return { ok: true, image: fresh, repaired: true };
        }
      }
      markImageUploadSkip(cardId);
      return {
        ok: false,
        image: normalized,
        error: '生图原图归档中，请稍后在仓库点下载重试（勿用列表缩略图覆盖原图）'
      };
    }

    const fallback = await resolveLocalImageFallback(cardId, image);
    if (!fallback) {
      markImageUploadSkip(cardId);
      markPathMissing(primaryImagePath(image, cardId) || normalized);
      return { ok: false, image: normalized, error: '云端无图且本机无备份，请重新添加图片' };
    }
    try {
      if (!(await blobLooksLikeUsableImage(fallback))) {
        markImageUploadSkip(cardId);
        return { ok: false, image: normalized, error: '本地备份无效（全黑或损坏），已拒绝覆盖云端' };
      }
      const url = await uploadCardImage(cardId, fallback, uploadOptsForCard(card));
      if (typeof window.clearCardImageBackup === 'function') {
        await window.clearCardImageBackup(cardId);
      }
      clearPathMissingForCard(cardId, url);
      return { ok: true, image: url, uploaded: true, repaired: true };
    } catch (e) {
      return { ok: false, image: normalized, error: formatError(e) };
    }
  }

  async function repairMissingCardImages(cards, opts = {}) {
    if (!isLoggedIn() || !Array.isArray(cards) || !cards.length) {
      return { fixed: 0, skipped: 0, failed: [] };
    }
    const capMs = Math.max(5000, Number(opts.capMs) || 120000);
    const deadline = Date.now() + capMs;
    let fixed = 0;
    let skipped = 0;
    const failed = [];

    for (const card of cards) {
      if (Date.now() > deadline) {
        failed.push({ id: '_timeout', title: '补传超时', error: '请稍后重试或分批保存' });
        break;
      }
      if (!card?.id || !card.image) {
        skipped += 1;
        continue;
      }
      if (shouldSkipImageUploadAttempt(card.id)) {
        skipped += 1;
        continue;
      }

      const needsUpload = cardNeedsCloudImageUpload(card)
        || (opts.fullCheck === true && isStorageRef(card.image)
          && !(await verifyStorageRef(card.image, card.id, { quick: false })));

      if (!needsUpload) {
        skipped += 1;
        continue;
      }

      const before = card.image;
      const r = await ensureCardImageOnCloud(card);
      if (r.ok && r.image) {
        card.image = r.image;
        if (r.uploaded || r.repaired || r.image !== before) fixed += 1;
        else skipped += 1;
      } else {
        failed.push({
          id: card.id,
          title: (card.title || card.prompt || card.id || '').toString().slice(0, 40),
          error: r.error || '无法上传'
        });
      }
    }
    return { fixed, skipped, failed };
  }

  async function resolveCardImageForSave(cardId, imageValue, previousUrl, opts = {}) {
    if (!imageValue) {
      if (previousUrl && isStorageRef(previousUrl)) {
        await deleteCardImageByUrl(previousUrl, { allowGenerated: true, excludeCardId: cardId, force: true });
      }
      return null;
    }
    if (!isLoggedIn()) return imageValue;
    const uploadOpts = { original: opts.original };
    if (isStorageRef(imageValue)) {
      const normalized = normalizeImageRef(imageValue);
      if (previousUrl && normalizeImageRef(previousUrl) === normalized) return normalized;
      if (await verifyStorageRef(normalized, cardId, { quick: true })) return normalized;
      const fallback = await resolveLocalImageFallback(cardId, imageValue);
      if (fallback) {
        const url = await uploadCardImage(cardId, fallback, uploadOpts);
        clearPathMissingForCard(cardId, url);
        if (previousUrl && previousUrl !== url && isStorageRef(previousUrl)) {
          await deleteCardImageByUrl(previousUrl, { excludeCardId: cardId, force: true });
        }
        if (typeof window.clearCardImageBackup === 'function') {
          await window.clearCardImageBackup(cardId);
        }
        return url;
      }
      throw new Error('图片在云端已丢失，请重新选择图片后再保存');
    }
    if (imageValue instanceof Blob) {
      const url = await uploadCardImage(cardId, imageValue, uploadOpts);
      if (previousUrl && previousUrl !== url && isStorageRef(previousUrl)) {
        await deleteCardImageByUrl(previousUrl, { excludeCardId: cardId, force: true });
      }
      return url;
    }
    if (isDataUrl(imageValue) || (typeof imageValue === 'string' && imageValue.startsWith('blob:'))) {
      const url = await uploadCardImage(cardId, imageValue, uploadOpts);
      if (previousUrl && previousUrl !== url && isStorageRef(previousUrl)) {
        await deleteCardImageByUrl(previousUrl, { excludeCardId: cardId, force: true });
      }
      return url;
    }
    if (/^https?:\/\//i.test(imageValue)) {
      try {
        const blob = await fetchRemoteImageBlob(imageValue);
        const url = await uploadCardImage(cardId, blob, uploadOpts);
        if (previousUrl && previousUrl !== url && isStorageRef(previousUrl)) {
          await deleteCardImageByUrl(previousUrl, { excludeCardId: cardId, force: true });
        }
        return url;
      } catch (e) {
        console.warn('[SupabaseSync] card image fetch failed', e);
        throw new Error(String(e?.message || '远程图片下载失败，请换一张本地图片重试'));
      }
    }
    return imageValue;
  }

  async function resolveLocalImageFallback(cardId, currentImage) {
    if (currentImage && isDataUrl(currentImage)) return currentImage;
    if (currentImage && typeof currentImage === 'string' && currentImage.startsWith('blob:')) {
      return currentImage;
    }
    if (typeof window.getCardImageBackup === 'function') {
      const backup = await window.getCardImageBackup(cardId);
      if (backup && isDataUrl(backup)) return backup;
    }
    const sel = cardId ? `.card[data-id="${CSS.escape(String(cardId))}"] .card-img` : null;
    const img = sel ? document.querySelector(sel) : null;
    if (img?.src && isDataUrl(img.src)) return img.src;
    if (img?.src && /^https?:\/\//i.test(img.src) && img.naturalWidth > 8) {
      try {
        const res = await fetch(img.src, { mode: 'cors' });
        if (res.ok) return await res.blob();
      } catch (e) {
        console.warn('[SupabaseSync] fallback fetch card img failed', cardId, e);
      }
    }
    return null;
  }

  async function repairAllCardImagesBeforeSync(cards, opts = {}) {
    const r = await repairMissingCardImages(cards, { capMs: opts.capMs || 8000 });
    const warnings = r.failed
      .filter((f) => f.id !== '_timeout')
      .map((f) => `「${f.title}」${f.error}`);
    if (r.failed.some((f) => f.id === '_timeout')) {
      warnings.unshift('图片补传超时，已继续同步文字数据');
    }
    return { fixed: r.fixed, warnings: [...new Set(warnings)] };
  }

  async function prepareCardsForCloud(cards, opts = {}) {
    if (!isLoggedIn() || !Array.isArray(cards)) return { cards: cards || [], warnings: [] };
    const strict = opts.strict === true;
    const warnings = [];
    const warnedOnce = new Set();
    const list = Array.isArray(cards) ? cards : [];
    const concurrency = Math.max(
      1,
      Number(opts.concurrency)
        || (window.matchMedia?.('(max-width: 900px)')?.matches ? 2 : 4)
    );
    const out = new Array(list.length);

    async function prepareOne(card, index) {
      const copy = { ...card };
      if (!copy?.id || !copy.image) {
        out[index] = copy;
        return;
      }
      const mustUpload = cardNeedsCloudImageUpload(copy)
        || (strict && isStorageRef(copy.image) && !shouldSkipImageUploadAttempt(copy.id));
      if (!mustUpload || shouldSkipImageUploadAttempt(copy.id)) {
        out[index] = copy;
        return;
      }
      const r = await ensureCardImageOnCloud(copy);
      if (r.image) copy.image = r.image;
      if (!r.ok) {
        const label = (copy.title || copy.prompt || copy.id || '').toString().slice(0, 24);
        const msg = `「${label}」${r.error || '图片未上传'}`;
        if (!warnedOnce.has(copy.id)) {
          warnedOnce.add(copy.id);
          warnings.push(msg);
        }
      }
      out[index] = copy;
    }

    let cursor = 0;
    async function worker() {
      while (cursor < list.length) {
        const i = cursor++;
        await prepareOne(list[i], i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length || 1) }, () => worker()));
    return { cards: out, warnings: [...new Set(warnings)] };
  }

  async function auditBrokenCardImages(cards, opts = {}) {
    if (!isLoggedIn() || !Array.isArray(cards)) return { broken: [], repaired: [] };
    const capMs = Math.max(2000, Number(opts.capMs) || 6000);
    const deadline = Date.now() + capMs;
    const skipStorageList = opts.skipStorageList !== false;
    const maxScan = Math.max(8, Math.min(24, Number(opts.maxScan) || 16));
    const broken = [];
    const repaired = [];
    let scanned = 0;
    for (const card of cards) {
      if (Date.now() > deadline || scanned >= maxScan) break;
      if (!card?.image) continue;
      if (isDataUrl(card.image) || card.image.startsWith('blob:')) continue;
      if (!isStorageRef(card.image) && !/supabase\.co\/storage\/v1\/object/i.test(card.image)) continue;
      scanned += 1;
      const ok = await verifyStorageRef(card.image, card.id, { quick: true, noDownload: true });
      if (ok) continue;
      let fixed = skipStorageList ? null : await findCardImageInStorage(card.id);
      if (!fixed && typeof window.getCardImageBackup === 'function') {
        const backup = await window.getCardImageBackup(card.id);
        if (backup && isDataUrl(backup)) {
          try {
            fixed = await uploadCardImage(card.id, backup, uploadOptsForCard(card));
            if (typeof window.clearCardImageBackup === 'function') {
              await window.clearCardImageBackup(card.id);
            }
          } catch (e) {
            console.warn('[SupabaseSync] backup re-upload failed', card.id, e);
          }
        }
      }
      if (fixed) {
        repaired.push({
          id: card.id,
          title: card.title || card.prompt || card.id,
          from: card.image,
          to: fixed
        });
        card.image = fixed;
        clearPathMissingForCard(card.id, fixed);
      } else {
        /** 仅记录；不在 audit 里 markPathMissing（网速慢/签超时会被误判，曾导致数百张黑块） */
        broken.push({
          id: card.id,
          title: (card.title || card.prompt || card.id || '').toString().slice(0, 40),
          inconclusive: true
        });
      }
    }
    return { broken, repaired };
  }

  async function init(callback) {
    onAuthChange = callback;
    const sb = getClient();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    session = data.session;
    if (session?.access_token) markSessionActive();
    if (session?.user) resetMediaSignEnvironment({ clearMissing: true });
    let initialHandled = false;
    sb.auth.onAuthStateChange((event, newSession) => {
      session = newSession;
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && newSession?.access_token) {
        session = newSession;
        markSessionActive();
      }
      if (event === 'SIGNED_OUT') sessionExpiredLocally = false;
      if (event === 'INITIAL_SESSION') {
        if (initialHandled) return;
        initialHandled = true;
      }
      if (typeof onAuthChange === 'function') onAuthChange(newSession, event);
    });
    if (!initialHandled && typeof onAuthChange === 'function') {
      initialHandled = true;
      onAuthChange(session, 'INITIAL_SESSION');
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && session?.user) {
        void healSessionOnResume();
      }
    });
    if (session?.user && !isAccessTokenFresh(session, 60)) {
      void healSessionOnResume();
    }
    return session;
  }

  function formatAuthError(err) {
    if (!err) return '操作失败，请稍后重试';
    if (typeof err === 'string') {
      const s = err.trim();
      if (!s || s === '{}') return '操作失败，请稍后重试';
      if (/[\u4e00-\u9fa5]/.test(s)) return s;
      return '操作失败，请稍后重试';
    }
    const status = Number(err.status ?? err.statusCode ?? err.code);
    if (status === 503 || status === 502 || status === 504) {
      return '登录服务暂时繁忙，请 30～60 秒后再试';
    }
    if (status === 429) {
      return '登录尝试过于频繁，请 1 分钟后再试';
    }
    const rawMsg = String(
      err.message || err.error_description || err.msg || err.error || ''
    ).trim();
    const msg = rawMsg.toLowerCase();
    if (/503|502|504|service unavailable|temporarily unavailable|overloaded/.test(msg)) {
      return '登录服务暂时繁忙，请稍后再试';
    }
    if (
      /invalid login|invalid credentials|invalid email or password|invalid authentication credentials|invalid_grant/.test(
        msg
      )
    ) {
      return '邮箱或密码不正确，请核对后重试。仍无法登录？请联系管理员协助重置';
    }
    if (/email not confirmed|confirm your email/.test(msg)) {
      return '账号暂不可用，请尝试重新注册或联系管理员';
    }
    if (/user already registered|already been registered|already exists/.test(msg)) {
      return '该邮箱已注册，请直接登录';
    }
    if (/password should be at least|weak password|too short/.test(msg)) {
      return '密码至少 6 位，建议使用字母与数字组合';
    }
    if (/unable to validate email|invalid email/.test(msg)) {
      return '邮箱格式不正确';
    }
    if (/rate limit|too many requests/.test(msg)) {
      return '操作过于频繁，请稍后再试';
    }
    if (/network|fetch failed|failed to fetch/.test(msg)) {
      return '网络连接失败，请检查网络后重试';
    }
    if (/signup is disabled/.test(msg)) {
      return '注册功能暂未开放，请联系管理员';
    }
    if (/phone|sms|otp|invalid token|token has expired/.test(msg)) {
      if (/invalid token|token has expired|expired/.test(msg)) return '验证码错误或已过期';
      if (/phone provider|sms provider|phone auth/.test(msg)) {
        return '手机登录暂未开放，请使用邮箱登录';
      }
      if (/invalid phone/.test(msg)) return '手机号格式不正确';
    }
    if (Number.isFinite(status) && status >= 400) {
      return '操作失败，请稍后重试';
    }
    return '操作失败，请稍后重试';
  }

  function normalizePhone(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (s.startsWith('+')) {
      const digits = s.replace(/\D/g, '');
      return digits.length >= 10 ? '+' + digits : null;
    }
    const digits = s.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) return '+86' + digits;
    if (digits.length === 13 && digits.startsWith('86')) return '+' + digits;
    return null;
  }

  function isPhoneAuthEnabled() {
    return window.AUTH_PHONE_ENABLED === true;
  }

  function isWeChatAuthEnabled() {
    return window.WECHAT_OAUTH_ENABLED === true && !!window.WECHAT_OAUTH_URL;
  }

  async function sendPhoneOtp(phone) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase 未配置');
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error('请输入正确的 11 位中国大陆手机号');
    const { error } = await sb.auth.signInWithOtp({ phone: normalized });
    if (error) throw new Error(formatAuthError(error));
  }

  async function verifyPhoneOtp(phone, token) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase 未配置');
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error('请输入正确的手机号');
    const code = String(token || '').trim();
    if (!/^\d{6}$/.test(code)) throw new Error('请输入 6 位数字验证码');
    const { data, error } = await sb.auth.verifyOtp({
      phone: normalized,
      token: code,
      type: 'sms'
    });
    if (error) throw new Error(formatAuthError(error));
    session = data.session;
    if (session?.access_token) markSessionActive();
    return data;
  }

  /** 已登录账号在任务中心绑定/验证手机号 */
  async function sendPhoneOtpForBind(phone) {
    await ensureSession();
    const sb = getClient();
    if (!sb || !session?.user) throw new Error('请先登录');
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error('请输入正确的 11 位中国大陆手机号');
    const { error } = await sb.auth.updateUser({ phone: normalized });
    if (error) throw new Error(formatAuthError(error));
  }

  async function verifyPhoneOtpForBind(phone, token) {
    await ensureSession();
    const sb = getClient();
    if (!sb || !session?.user) throw new Error('请先登录');
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error('请输入正确的手机号');
    const code = String(token || '').trim();
    if (!/^\d{6}$/.test(code)) throw new Error('请输入 6 位数字验证码');
    const { data, error } = await sb.auth.verifyOtp({
      phone: normalized,
      token: code,
      type: 'phone_change'
    });
    if (error) throw new Error(formatAuthError(error));
    session = data.session;
    if (session?.access_token) markSessionActive();
    return data;
  }

  async function signUp(email, password) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase 未配置');
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin + window.location.pathname }
    });
    if (error) throw new Error(formatAuthError(error));
    if (data.session) {
      session = data.session;
      markSessionActive();
    }
    return data;
  }

  async function signIn(email, password) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase 未配置');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(formatAuthError(error));
    session = data.session;
    if (!session) {
      const { data: fresh } = await sb.auth.getSession();
      session = fresh.session;
    }
    if (session?.access_token) markSessionActive();
    return { ...data, session: session || data.session };
  }

  async function resetPassword(email) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase 未配置');
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });
    if (error) throw new Error(formatAuthError(error));
  }

  async function updatePassword(newPassword) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase 未配置');
    await ensureSession();
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw new Error(formatAuthError(error));
  }

  async function signOut() {
    const sb = getClient();
    if (!sb) return;
    await sb.auth.signOut();
    session = null;
    sessionExpiredLocally = false;
    try { window.__PH_AUTH_SESSION_EXPIRED__ = false; } catch (e) { /* ignore */ }
    clearSignedUrlCache();
  }

  async function pullCloudMeta() {
    await ensureSession();
    const sb = getClient();
    const uid = getUserId();
    if (!sb || !uid) return null;
    const { data, error } = await sb.from('user_data').select('updated_at').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    return data?.updated_at || null;
  }

  async function pullCloudData(opts = {}) {
    const force = opts?.force === true;
    const ifStale = opts?.ifStale !== false;
    const uid = getUserId();
    if (pullCloudInflight && !force) return pullCloudInflight;
    lastCloudPullSkipped = false;

    pullCloudInflight = (async () => {
      await ensureSession();
      const sb = getClient();
      if (!sb || !uid) return null;

      if (ifStale && !force) {
        const remoteUpdated = await pullCloudMeta();
        const localUpdated = getLocalCloudUpdatedAt(uid);
        if (remoteUpdated && localUpdated && remoteUpdated === localUpdated) {
          lastCloudPullSkipped = true;
          return null;
        }
      }

      const { data, error } = await sb.from('user_data').select('data, updated_at').eq('user_id', uid).maybeSingle();
      if (error) throw error;
      if (data?.updated_at) setLocalCloudUpdatedAt(uid, data.updated_at);
      return data?.data || null;
    })();

    try {
      return await pullCloudInflight;
    } finally {
      pullCloudInflight = null;
    }
  }

  async function pushCloudData(payload, opts = {}) {
    await ensureSession();
    const sb = getClient();
    const uid = getUserId();
    if (!sb || !uid) return { warnings: [] };

    let cloudPayload = null;
    if (!opts.skipSafety && window.CloudSyncSafety?.validatePush) {
      try {
        const remoteUpdated = await pullCloudMeta();
        const localUpdated = getLocalCloudUpdatedAt(uid);
        const canSkipFullCloud = !!(remoteUpdated && localUpdated && remoteUpdated === localUpdated);
        if (!canSkipFullCloud) {
          const { data, error: pullErr } = await sb
            .from('user_data')
            .select('data')
            .eq('user_id', uid)
            .maybeSingle();
          if (pullErr) throw pullErr;
          cloudPayload = data?.data || null;
        }
        const check = window.CloudSyncSafety.validatePush(payload, cloudPayload || {});
        if (!check.allow) {
          throw new Error(check.reason || '为保护云端数据，已取消同步');
        }

(function () {
  const PLACEHOLDER = /YOUR_/;
  const BUCKET = 'card-images';
  const STORAGE_PREFIX = `storage://${BUCKET}/`;
  const SIGNED_TTL_SEC = 3600;
  const signedUrlCache = new Map();
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const MAX_SIDE = 1600;
  const JPEG_QUALITY = 0.82;

  function configured() {
    return !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY
      && !PLACEHOLDER.test(window.SUPABASE_URL)
      && !PLACEHOLDER.test(window.SUPABASE_ANON_KEY)
      && window.supabase?.createClient);
  }

  let client = null;
  let session = null;
  let onAuthChange = null;

  function getClient() {
    if (!configured()) return null;
    if (!client) {
      client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
    }
    return client;
  }

  function getUserId() {
    return session?.user?.id || null;
  }

  async function ensureSession() {
    const sb = getClient();
    if (!sb) throw new Error('Supabase 未配置');
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    if (!data.session?.user) throw new Error('登录已过期，请重新登录');
    session = data.session;
    return session;
  }

  function isConfigured() { return configured(); }
  function isLoggedIn() { return !!session?.user; }
  function getSession() { return session; }

  /** 在 access_token 将过期时刷新，避免 UI 仍显示已登录但 API 返回「登录已过期」 */
  async function getValidAccessToken() {
    const sb = getClient();
    if (!sb) return null;
    if (!session?.access_token) {
      try {
        const { data } = await sb.auth.getSession();
        session = data?.session ?? null;
      } catch (e) {
        return null;
      }
    }
    if (!session?.access_token) return null;
    const exp = session.expires_at;
    const now = Math.floor(Date.now() / 1000);
    if (exp != null && exp - now < 120) {
      try {
        const { data, error } = await sb.auth.refreshSession();
        if (!error && data?.session) {
          session = data.session;
        }
      } catch (e) { /* 仍尝试用旧 token */ }
    }
    return session?.access_token || null;
  }
  function getUserEmail() { return session?.user?.email || ''; }

  function isDataUrl(str) {
    return typeof str === 'string' && str.startsWith('data:image/');
  }

  function formatError(err) {
    if (!err) return '未知错误';
    if (typeof err === 'string') return err;
    const msg = String(err.message || err.error_description || err.msg || err.error || '').trim();
    if (/bucket not found/i.test(msg)) {
      return msg + '（请在 Supabase 运行 supabase/storage.sql）';
    }
    if (/relation.*user_data|user_data.*does not exist/i.test(msg)) {
      return msg + '（请在 Supabase 运行 supabase/schema.sql）';
    }
    if (/row-level security|violates.*policy|permission denied/i.test(msg)) {
      return msg + '（若已运行过 SQL，请再运行 supabase/fix-policies.sql 后退出并重新登录）';
    }
    if (msg) return msg;
    if (err.error && typeof err.error !== 'string') return formatError(err.error);
    try { return JSON.stringify(err); } catch (e) { return '同步失败'; }
  }

  function isStorageUrl(str) {
    return isStorageRef(str);
  }

  function isStorageRef(str) {
    if (!str || typeof str !== 'string') return false;
    if (str.startsWith(STORAGE_PREFIX)) return true;
    if (!window.SUPABASE_URL) return false;
    const base = window.SUPABASE_URL.replace(/\/$/, '');
    return (
      str.startsWith(`${base}/storage/v1/object/public/${BUCKET}/`) ||
      str.startsWith(`${base}/storage/v1/object/sign/${BUCKET}/`) ||
      str.startsWith(`${base}/storage/v1/object/authenticated/${BUCKET}/`)
    );
  }

  function storagePathFromUrl(url) {
    if (!url || typeof url !== 'string') return null;
    if (url.startsWith(STORAGE_PREFIX)) return url.slice(STORAGE_PREFIX.length).split('?')[0];
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
    const path = storagePathFromRef(value);
    if (path) return toStorageRef(path);
    return value;
  }

  function clearSignedUrlCache() {
    signedUrlCache.clear();
  }

  async function getSignedUrlForPath(path) {
    const key = path.replace(/^\//, '');
    const cached = signedUrlCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 120000) return cached.url;
    await ensureSession();
    const sb = getClient();
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(key, SIGNED_TTL_SEC);
    if (error) throw error;
    signedUrlCache.set(key, {
      url: data.signedUrl,
      expiresAt: Date.now() + (SIGNED_TTL_SEC - 120) * 1000
    });
    return data.signedUrl;
  }

  async function resolveDisplayUrl(image) {
    if (!image || typeof image !== 'string') return image;
    if (isDataUrl(image) || image.startsWith('blob:')) return image;
    const path = storagePathFromRef(image);
    if (path && isLoggedIn()) {
      if (window.PromptHubApi?.isConfigured?.() && window.PromptHubApi.signMediaRef) {
        try {
          const r = await window.PromptHubApi.signMediaRef(image);
          if (r.ok && r.data?.url) return r.data.url;
        } catch (e) {
          console.warn('[SupabaseSync] api sign failed', e);
        }
      }
      try {
        return await getSignedUrlForPath(path);
      } catch (e) {
        console.warn('[SupabaseSync] signed url failed', path, e);
        return publicUrlFromPath(path) || image;
      }
    }
    if (/^https?:\/\//i.test(image)) {
      if (window.PromptHubApi?.fetchMediaAsBlobUrl) {
        const blobUrl = await window.PromptHubApi.fetchMediaAsBlobUrl(image);
        if (blobUrl) return blobUrl;
      }
      return image;
    }
    return image;
  }

  async function prefetchDisplayUrls(images) {
    if (!isLoggedIn()) return;
    const paths = [...new Set(
      (images || []).map(storagePathFromRef).filter(Boolean)
    )];
    const batchSize = 6;
    for (let i = 0; i < paths.length; i += batchSize) {
      const batch = paths.slice(i, i + batchSize);
      await Promise.all(batch.map(p => getSignedUrlForPath(p).catch(() => {})));
    }
  }

  function getCachedDisplayUrl(image) {
    if (!image || typeof image !== 'string') return image;
    if (isDataUrl(image) || image.startsWith('blob:')) return image;
    const path = storagePathFromRef(image);
    if (!path) return image;
    const cached = signedUrlCache.get(path.replace(/^\//, ''));
    if (cached?.url) return cached.url;
    if (isResolvableStorageRef(image)) return publicUrlFromPath(path) || '';
    return image;
  }

  function imgPlaceholderSrc() {
    return 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect fill="#e4e4ea" width="4" height="3"/></svg>'
    );
  }

  function safeImgSrc(image) {
    if (!image) return '';
    if (isDataUrl(image) || image.startsWith('blob:') || /^https?:\/\//i.test(image)) {
      return image;
    }
    if (isStorageRef(image)) {
      const cached = getCachedDisplayUrl(image);
      if (cached && !cached.startsWith(STORAGE_PREFIX)) return cached;
      return imgPlaceholderSrc();
    }
    return image;
  }

  async function hydrateImageElements(root) {
    const scope = root || document;
    const imgs = scope.querySelectorAll('img[data-storage-ref], img[data-image-ref]');
    await Promise.all([...imgs].map(async (img) => {
      const ref = img.getAttribute('data-storage-ref') || img.getAttribute('data-image-ref');
      if (!ref) return;
      const media = img.closest('.card-media, .imagegen-feed-media');
      if (media?.classList.contains('imagegen-gen-pending')) return;
      if (!media?.dataset.shineAt) media.dataset.shineAt = String(Date.now());
      media?.classList.add('is-loading');
      if (!img.getAttribute('src') || img.getAttribute('src')?.startsWith('data:image/svg')) {
        img.src = imgPlaceholderSrc();
      }
      const endShine = () => {
        if (typeof window.finishCardMediaShine === 'function') window.finishCardMediaShine(media);
        else media?.classList.remove('is-loading');
      };
      try {
        const url = await resolveDisplayUrl(ref);
        if (url && !url.startsWith(STORAGE_PREFIX)) {
          const onFail = () => {
            img.src = imgPlaceholderSrc();
            img.classList.remove('img-load-failed');
            endShine();
          };
          if (img.complete && img.src === url && img.naturalWidth > 0) endShine();
          else {
            img.addEventListener('load', endShine, { once: true });
            img.addEventListener('error', onFail, { once: true });
            img.src = url;
          }
          img.classList.remove('img-load-failed');
          if (img.complete && img.naturalWidth > 0) endShine();
        } else {
          endShine();
        }
      } catch (e) {
        console.warn('[SupabaseSync] hydrate failed', ref, e);
        endShine();
      }
      if (!img.dataset.hydrateBound) {
        img.dataset.hydrateBound = '1';
        img.addEventListener('error', () => {
          if (img.dataset.retryHydrate === '1') {
            img.src = imgPlaceholderSrc();
            img.classList.remove('img-load-failed');
            return;
          }
          img.dataset.retryHydrate = '1';
          void resolveDisplayUrl(ref).then(url => {
            if (url && !url.startsWith(STORAGE_PREFIX)) {
              img.src = url;
              img.classList.remove('img-load-failed');
            } else {
              img.src = imgPlaceholderSrc();
              img.classList.remove('img-load-failed');
            }
          });
        });
      }
    }));
  }

  async function persistGenerationImage(assetId, image) {
    if (!image || typeof image !== 'string') return image;
    if (!isLoggedIn()) return image;
    if (isStorageRef(image)) return normalizeImageRef(image);
    await ensureSession();
    const id = String(assetId || Date.now());
    if (isDataUrl(image) || image.startsWith('blob:')) {
      return uploadGeneratedImage(id, image);
    }
    if (/^https?:\/\//i.test(image)) {
      try {
        const res = await fetch(image, { mode: 'cors' });
        if (!res.ok) throw new Error('fetch_failed');
        const blob = await res.blob();
        return uploadGeneratedImage(id, blob);
      } catch (e) {
        console.warn('[SupabaseSync] remote persist failed, keep url', e);
        return image;
      }
    }
    return image;
  }

  async function uploadGeneratedImage(assetId, source) {
    await ensureSession();
    const sb = getClient();
    const uid = getUserId();
    if (!sb || !uid || !assetId) throw new Error('未登录');
    const blob = await compressImage(source);
    const path = `${uid}/generated/${assetId}.jpg`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '3600'
    });
    if (error) throw error;
    return toStorageRef(path);
  }

  function loadImageFromSource(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片无法读取'));
      if (typeof source === 'string') img.src = source;
      else if (source instanceof Blob) img.src = URL.createObjectURL(source);
      else reject(new Error('不支持的图片格式'));
    });
  }

  async function compressImage(source) {
    const img = await loadImageFromSource(source);
    if (typeof source !== 'string' && source instanceof Blob) {
      try { URL.revokeObjectURL(img.src); } catch (e) { /* ignore */ }
    }
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (!w || !h) throw new Error('图片尺寸无效');
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('图片压缩失败'))), 'image/jpeg', JPEG_QUALITY);
    });
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new Error('图片过大，请换一张较小的图（建议小于 5MB）');
    }
    return blob;
  }

  async function uploadImageGenRef(refId, source) {
    await ensureSession();
    const sb = getClient();
    const uid = getUserId();
    if (!sb || !uid || !refId) throw new Error('未登录或参考图无效');
    const blob = await compressImage(source);
    const path = `${uid}/imagegen/${refId}.jpg`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '3600'
    });
    if (error) throw error;
    return toStorageRef(path);
  }

  async function uploadCardImage(cardId, source) {
    await ensureSession();
    const sb = getClient();
    const uid = getUserId();
    if (!sb || !uid || !cardId) throw new Error('未登录或卡片无效');
    const blob = await compressImage(source);
    const path = `${uid}/${cardId}.jpg`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '3600'
    });
    if (error) throw error;
    return toStorageRef(path);
  }

  async function deleteCardImageByUrl(url) {
    if (!url || !isStorageRef(url)) return;
    const sb = getClient();
    const path = storagePathFromRef(url);
    if (!sb || !path) return;
    await sb.storage.from(BUCKET).remove([path]);
  }

  async function resolveCardImageForSave(cardId, imageValue, previousUrl) {
    if (!imageValue) {
      if (previousUrl && isStorageRef(previousUrl)) await deleteCardImageByUrl(previousUrl);
      return null;
    }
    if (!isLoggedIn()) return imageValue;
    if (isStorageRef(imageValue)) return normalizeImageRef(imageValue);
    if (isDataUrl(imageValue) || imageValue.startsWith('blob:')) {
      const url = await uploadCardImage(cardId, imageValue);
      if (previousUrl && previousUrl !== url) await deleteCardImageByUrl(previousUrl);
      return url;
    }
    if (/^https?:\/\//i.test(imageValue)) {
      try {
        const res = await fetch(imageValue, { mode: 'cors' });
        if (res.ok) {
          const blob = await res.blob();
          const url = await uploadCardImage(cardId, blob);
          if (previousUrl && previousUrl !== url) await deleteCardImageByUrl(previousUrl);
          return url;
        }
      } catch (e) {
        console.warn('[SupabaseSync] card image fetch failed', e);
      }
    }
    return imageValue;
  }

  async function prepareCardsForCloud(cards) {
    if (!isLoggedIn() || !Array.isArray(cards)) return { cards: cards || [], warnings: [] };
    const out = [];
    const warnings = [];
    for (const card of cards) {
      const copy = { ...card };
      if (copy.image && isStorageRef(copy.image)) {
        copy.image = normalizeImageRef(copy.image);
      } else if (copy.image && isDataUrl(copy.image)) {
        try {
          copy.image = await uploadCardImage(copy.id, copy.image);
        } catch (e) {
          const msg = formatError(e);
          warnings.push(msg);
          delete copy.image;
        }
      }
      out.push(copy);
    }
    return { cards: out, warnings: [...new Set(warnings)] };
  }

  async function init(callback) {
    onAuthChange = callback;
    const sb = getClient();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    session = data.session;
    let initialHandled = false;
    sb.auth.onAuthStateChange((event, newSession) => {
      session = newSession;
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
    return session;
  }

  function formatAuthError(err) {
    if (!err) return '操作失败';
    const msg = String(err.message || err.error_description || err.msg || '').toLowerCase();
    if (/invalid login|invalid credentials|invalid email or password/.test(msg)) {
      return '邮箱或密码错误，请检查后重试';
    }
    if (/email not confirmed|confirm your email/.test(msg)) {
      return '邮箱尚未验证，请查收邮件中的确认链接（或在 Supabase 关闭邮箱验证）';
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
      return '注册功能未开启，请联系管理员';
    }
    if (/phone|sms|otp|invalid token|token has expired/.test(msg)) {
      if (/invalid token|token has expired|expired/.test(msg)) return '验证码错误或已过期';
      if (/phone provider|sms provider|phone auth/.test(msg)) {
        return '手机登录未在 Supabase 配置，请先在控制台开启 Phone 并配置短信服务';
      }
      if (/invalid phone/.test(msg)) return '手机号格式不正确';
    }
    return err.message || '操作失败，请稍后重试';
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
    if (data.session) session = data.session;
    return data;
  }

  async function signIn(email, password) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase 未配置');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(formatAuthError(error));
    session = data.session;
    return data;
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
    clearSignedUrlCache();
  }

  async function pullCloudData() {
    await ensureSession();
    const sb = getClient();
    const uid = getUserId();
    if (!sb || !uid) return null;
    const { data, error } = await sb.from('user_data').select('data, updated_at').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    return data?.data || null;
  }

  async function pushCloudData(payload, opts = {}) {
    await ensureSession();
    const sb = getClient();
    const uid = getUserId();
    if (!sb || !uid) return { warnings: [] };

    let cloudPayload = null;
    if (!opts.skipSafety && window.CloudSyncSafety?.validatePush) {
      try {
        const { data, error: pullErr } = await sb
          .from('user_data')
          .select('data')
          .eq('user_id', uid)
          .maybeSingle();
        if (pullErr) throw pullErr;
        cloudPayload = data?.data || null;
        const check = window.CloudSyncSafety.validatePush(payload, cloudPayload);
        if (!check.allow) {
          throw new Error(check.reason || '为保护云端数据，已取消同步');
        }
        if (check.merged) payload = check.merged;
      } catch (e) {
        if (e.message && e.message.includes('已阻止')) throw e;
        if (!opts.allowWithoutCloudCheck) {
          throw new Error('无法校验云端数据，已取消上传：' + formatError(e));
        }
      }
    }

    const { cards: preparedCards, warnings } = await prepareCardsForCloud(payload.cards || []);
    const prepared = {
      ...payload,
      cards: preparedCards,
      schemaVersion: window.CloudSyncSafety?.SCHEMA_VERSION || 2
    };
    const { error } = await sb.from('user_data').upsert({
      user_id: uid,
      data: prepared,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) throw new Error(formatError(error));
    if (Array.isArray(prepared.cards)) payload.cards = prepared.cards;
    return { warnings };
  }

  window.SupabaseSync = {
    isConfigured,
    isLoggedIn,
    getUserId,
    getSession,
    getValidAccessToken,
    getUserEmail,
    isDataUrl,
    isStorageUrl,
    isStorageRef,
    storagePathFromRef,
    normalizeImageRef,
    resolveDisplayUrl,
    prefetchDisplayUrls,
    getCachedDisplayUrl,
    safeImgSrc,
    publicUrlFromPath,
    hydrateImageElements,
    persistGenerationImage,
    uploadGeneratedImage,
    clearSignedUrlCache,
    init,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    sendPhoneOtp,
    verifyPhoneOtp,
    normalizePhone,
    isPhoneAuthEnabled,
    isWeChatAuthEnabled,
    formatAuthError,
    pullCloudData,
    pushCloudData,
    uploadCardImage,
    uploadImageGenRef,
    deleteCardImageByUrl,
    resolveCardImageForSave,
    prepareCardsForCloud,
    formatError
  };
})();

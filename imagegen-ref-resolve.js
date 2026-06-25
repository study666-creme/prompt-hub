/**
 * 生图参考图：解析为 API 可用 URL（含上传、压缩、storage 签名）
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};

  function d() { return deps; }

  function isUsableGenRefUrl(url) {
    if (global.MediaPipeline?.isUsableGenRefUrl) return global.MediaPipeline.isUsableGenRefUrl(url);
    if (!url || typeof url !== 'string') return false;
    if (/^https?:\/\//i.test(url)) return true;
    if (global.SupabaseSync?.isDataUrl?.(url)) return true;
    if (global.SupabaseSync?.isStorageRef?.(url) || url.startsWith('storage://')) return true;
    return false;
  }

  async function resolveRefUrlsFromList(sources) {
    const list = Array.isArray(sources) ? sources.filter(Boolean) : [];
    if (!list.length) return [];
    const timeoutMs = d().getRefResolveTimeoutMs?.() ?? 8000;
    const maxSide = d().getRefMaxSide?.() ?? 2560;
    const urls = [];
    for (let i = 0; i < list.length; i += 1) {
      const src = list[i];
      try {
        let apiUrl = null;
        const resolveOne = (async () => {
          if (/^https?:\/\//i.test(src)) {
            if (global.SupabaseSync?.isInvalidMediaUrl?.(src) && global.SupabaseSync?.normalizeImageRef) {
              const fixed = global.SupabaseSync.normalizeImageRef(src);
              if (fixed && fixed !== src) {
                const signed = await global.SupabaseSync.resolveDisplayUrl(fixed, {
                  variant: 'full',
                  preferFull: true,
                  bypassSignBudget: true
                });
                if (signed && /^https?:\/\//i.test(signed)) return signed;
              }
            }
            return src;
          }
          if (global.SupabaseSync?.isStorageRef?.(src) || String(src).startsWith('storage://')) {
            return global.SupabaseSync?.normalizeImageRef?.(src) || src;
          }
          if (global.SupabaseSync?.isDataUrl?.(src) || String(src).startsWith('blob:')) {
            if (global.SupabaseSync?.isLoggedIn?.() && global.SupabaseSync?.uploadImageGenRef) {
              try {
                const stored = await global.SupabaseSync.uploadImageGenRef(d().genId('ref'), src);
                if (stored) return stored;
              } catch (uploadErr) {
                console.warn('参考图上传失败，改由服务端处理', uploadErr);
              }
            }
            if (global.SupabaseSync?.isDataUrl?.(src)) return src;
            if (String(src).startsWith('blob:')) {
              return d().compressRefImageFromSource(src, maxSide);
            }
          }
          return global.SupabaseSync?.isDataUrl?.(src) ? src : null;
        })();
        apiUrl = await Promise.race([
          resolveOne,
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('ref resolve timeout')), timeoutMs);
          })
        ]);
        if (isUsableGenRefUrl(apiUrl)) {
          urls.push(apiUrl);
        }
      } catch (e) {
        console.warn('参考图解析失败', e);
        if (isUsableGenRefUrl(src)) urls.push(src);
        else if (global.SupabaseSync?.isDataUrl?.(src)) urls.push(src);
      }
    }
    return urls;
  }

  function init(injected) {
    deps = injected || {};
    return { isUsableGenRefUrl, resolveRefUrlsFromList };
  }

  global.ImageGenRefResolve = { init };
})(typeof window !== 'undefined' ? window : globalThis);

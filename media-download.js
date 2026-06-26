/**
 * 媒体下载（阶段 5）：URL / Blob / 卡片原图下载。
 * script.js 启动时 MediaDownload.init(deps) 注入 toast、查卡等依赖。
 */
(function () {
  'use strict';

  /** @type {{ showToast?: Function, formatFileSize?: Function, getCardById?: Function }} */
  let deps = {};
  const cardDownloadInflight = new Set();

  function init(hooks) {
    deps = hooks && typeof hooks === 'object' ? hooks : {};
  }

  function showToast(msg, ms) {
    if (typeof deps.showToast === 'function') deps.showToast(msg, ms);
    else if (typeof window.showToast === 'function') window.showToast(msg, ms);
  }

  function formatFileSize(bytes) {
    if (typeof deps.formatFileSize === 'function') return deps.formatFileSize(bytes);
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getCard(cardId) {
    if (typeof deps.getCardById === 'function') return deps.getCardById(cardId);
    return null;
  }

  function saveBlob(blob, filename) {
    const name = filename || `prompt-hub-${Date.now()}.png`;
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
  }

  async function saveImageUrl(url, filename, imgEl) {
    const name = filename || `prompt-hub-${Date.now()}.png`;
    if (!url || String(url).includes('data:image/svg')) {
      throw new Error('no_url');
    }
    if (String(url).startsWith('blob:')) {
      saveBlob(await (await fetch(url)).blob(), name);
      return;
    }
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(String(res.status));
      saveBlob(await res.blob(), name);
      return;
    } catch (e) { /* try canvas / proxy */ }
    const img = imgEl || document.getElementById('lightboxImage');
    if (img?.complete && img.naturalWidth > 0 && !String(img.src).includes('data:image/svg')) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d')?.drawImage(img, 0, 0);
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png', 0.92);
        });
        saveBlob(blob, name);
        return;
      } catch (e) { /* fall through */ }
    }
    if (window.PromptHubApi?.fetchMediaAsBlobUrl && /^https?:\/\//i.test(url)) {
      const blobUrl = await window.PromptHubApi.fetchMediaAsBlobUrl(url);
      if (blobUrl) {
        try {
          saveBlob(await (await fetch(blobUrl)).blob(), name);
          URL.revokeObjectURL(blobUrl);
          return;
        } catch (e) {
          URL.revokeObjectURL(blobUrl);
        }
      }
    }
    throw new Error('download_fetch_failed');
  }

  function extensionFromBlob(blob) {
    const t = String(blob?.type || '').toLowerCase();
    if (t.includes('png')) return 'png';
    if (t.includes('webp')) return 'webp';
    if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
    return 'png';
  }

  function downloadFilenameForCard(card, blob, filename, galleryIndex) {
    if (filename && /\.\w{3,4}$/i.test(filename)) {
      const ext = extensionFromBlob(blob);
      return filename.replace(/\.\w{3,4}$/i, `.${ext}`);
    }
    const id = card?.id || Date.now();
    const slot = Number.isFinite(galleryIndex) && galleryIndex > 0 ? `-${galleryIndex + 1}` : '';
    return `prompt-hub-${id}${slot}.${extensionFromBlob(blob)}`;
  }

  function isCoverImageDownload(card, imageRef, galleryIndex) {
    if (Number.isFinite(galleryIndex)) return galleryIndex <= 0;
    if (!imageRef || !card?.image) return true;
    return String(imageRef) === String(card.image);
  }

  function resolveDownloadJobId(card, galleryIndex, imageRef) {
    const base = card?.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : null;
    if (!base) return null;
    const CG = window.PromptHubCardGallery;
    if (Number.isFinite(galleryIndex) && galleryIndex > 0 && CG?.gallerySlotJobId) {
      return CG.gallerySlotJobId(base, galleryIndex);
    }
    if (imageRef && card?.image && String(imageRef) !== String(card.image) && CG?.normalizeCardGallery) {
      const gallery = CG.normalizeCardGallery(card);
      const idx = gallery.findIndex((u) => String(u || '') === String(imageRef));
      if (idx > 0 && CG.gallerySlotJobId) return CG.gallerySlotJobId(base, idx);
    }
    return base;
  }

  async function tryDownloadViaPreviewUrl(card, filename, opts = {}) {
    const previewImg = opts.previewImg || null;
    const previewUrl = previewImg?.dataset?.previewFullUrl
      || previewImg?.currentSrc
      || previewImg?.src
      || '';
    if (!previewUrl || previewUrl.includes('data:image/svg')) return false;
    const name = filename || downloadFilenameForCard(
      card,
      { type: 'image/png' },
      null,
      opts.galleryIndex
    );
    await saveImageUrl(previewUrl, name, previewImg);
    showToast('下载完成');
    return true;
  }

  async function fetchBlobFromUrl(url) {
    if (!url) return null;
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (res.ok) return await res.blob();
    } catch (e) { /* proxy */ }
    if (window.PromptHubApi?.fetchMediaAsBlobUrl && /^https?:\/\//i.test(url)) {
      const tmp = await window.PromptHubApi.fetchMediaAsBlobUrl(url);
      if (tmp) {
        try {
          const blob = await (await fetch(tmp)).blob();
          URL.revokeObjectURL(tmp);
          return blob;
        } catch (e) {
          URL.revokeObjectURL(tmp);
        }
      }
    }
    return null;
  }

  async function tryFastGenJobDownloadBlob(card) {
    const jobId = String(card?.genJobId || '').replace(/#\d+$/, '');
    if (!jobId || !window.PromptHubApi?.getGenerationImageUrl) return null;
    try {
      const r = await window.PromptHubApi.getGenerationImageUrl(jobId);
      if (!r?.ok || !r.data?.url) return null;
      return await fetchBlobFromUrl(r.data.url);
    } catch (e) {
      console.warn('[download] fast gen job url failed', jobId, e);
      return null;
    }
  }

  async function resolveCardDownloadResolution(card) {
    const jobId = String(card?.genJobId || '').replace(/#\d+$/, '');
    if (jobId && window.PromptHubApi?.getGenerationJob) {
      try {
        const r = await window.PromptHubApi.getGenerationJob(jobId);
        if (r.ok && r.data?.resolution) {
          return String(r.data.resolution).toLowerCase();
        }
      } catch (e) {
        console.warn('[download] job resolution lookup failed', jobId, e);
      }
    }
    return String(card?.resolution || '1k').toLowerCase();
  }

  function downloadPrepToastForResolution(res) {
    const r = String(res || '1k').toLowerCase();
    if (r === '4k') {
      showToast('正在拉取 4K 原图…（文件较大，约 10–40 秒，可继续浏览其他图）', 5000);
    } else if (r === '2k') {
      showToast('正在拉取 2K 原图…（约几秒，可继续浏览其他图）', 3500);
    } else {
      showToast('正在准备原图下载…', 2500);
    }
  }

  async function downloadPrepToast(card) {
    const res = await resolveCardDownloadResolution(card);
    downloadPrepToastForResolution(res);
    return res;
  }

  function setDownloadTriggerBusy(btn, busy) {
    if (!btn) return;
    const label = btn.querySelector('span');
    if (busy) {
      if (!btn.dataset.prevLabel) {
        btn.dataset.prevLabel = label?.textContent || btn.textContent || '下载';
      }
      btn.classList.add('is-downloading');
      btn.setAttribute('aria-busy', 'true');
      if (label) label.textContent = '下载中…';
      else btn.textContent = '下载中…';
    } else {
      btn.classList.remove('is-downloading');
      btn.removeAttribute('aria-busy');
      const prev = btn.dataset.prevLabel || '下载';
      if (label) label.textContent = prev;
      else btn.textContent = prev;
      delete btn.dataset.prevLabel;
    }
  }

  async function downloadCardImageFile(imageRef, cardId, filename, opts = {}) {
    const card = cardId ? getCard(cardId) : null;
    const galleryIndex = Number.isFinite(opts.galleryIndex) ? opts.galleryIndex : null;
    const imageRefStr = imageRef != null ? String(imageRef) : '';
    const inflightKey = `${cardId || imageRefStr || 'anon'}:${galleryIndex ?? 'cover'}`;
    const triggerBtn = opts.triggerBtn || null;
    const coverDownload = isCoverImageDownload(card, imageRef, galleryIndex);
    const slotJobId = opts.jobId || resolveDownloadJobId(card, galleryIndex, imageRef);

    if (cardDownloadInflight.has(inflightKey)) {
      showToast('该图正在下载中，请稍候…');
      return;
    }

    cardDownloadInflight.add(inflightKey);
    setDownloadTriggerBusy(triggerBtn, true);

    try {
      const dlRes = card ? await resolveCardDownloadResolution(card) : '1k';
      const minBytes = card && window.SupabaseSync?.expectedMinFullImageBytes
        ? window.SupabaseSync.expectedMinFullImageBytes(dlRes)
        : 0;

      if (coverDownload && card) {
        let blob = await tryFastGenJobDownloadBlob(card);
        const fastOk = blob && blob.size >= Math.min(minBytes || 0, 80 * 1024);
        if (blob && minBytes > 0 && blob.size < minBytes && !fastOk) blob = null;
        if (blob) {
          const name = downloadFilenameForCard(card, blob, filename, galleryIndex);
          saveBlob(blob, name);
          showToast(`下载完成 · ${formatFileSize(blob.size)}`);
          return;
        }
        if (window.SupabaseSync?.downloadCardFullResBlob) {
          await downloadPrepToast(card);
          const fullBlob = await window.SupabaseSync.downloadCardFullResBlob(card, { resolution: dlRes });
          if (fullBlob) {
            const name = downloadFilenameForCard(card, fullBlob, filename, galleryIndex);
            saveBlob(fullBlob, name);
            if (minBytes > 0 && fullBlob.size < minBytes) {
              showToast(`已下载 · ${formatFileSize(fullBlob.size)}（体积偏小，请稍后再试或重新生成）`, 6000);
            } else {
              showToast(`下载完成 · ${formatFileSize(fullBlob.size)}`);
            }
            return;
          }
        }
      }

      if (typeof imageRef === 'string' && imageRef.startsWith('data:image/')) {
        const dataBlob = await (await fetch(imageRef)).blob();
        const name = downloadFilenameForCard(card, dataBlob, filename, galleryIndex);
        saveBlob(dataBlob, name);
        showToast('下载完成');
        return;
      }

      if (window.SupabaseSync?.downloadCardStorageBlob && imageRef) {
        if (card) downloadPrepToast(card);
        const storageBlob = await window.SupabaseSync.downloadCardStorageBlob(imageRef, cardId, {
          jobId: slotJobId
        });
        if (storageBlob) {
          const name = downloadFilenameForCard(card, storageBlob, filename, galleryIndex);
          saveBlob(storageBlob, name);
          showToast(`下载完成 · ${formatFileSize(storageBlob.size)}`);
          return;
        }
      }

      if (typeof imageRef === 'string' && /^https?:\/\//i.test(imageRef)) {
        const blob = await fetchBlobFromUrl(imageRef);
        if (blob) {
          const name = downloadFilenameForCard(card, blob, filename, galleryIndex);
          saveBlob(blob, name);
          showToast(`下载完成 · ${formatFileSize(blob.size)}`);
          return;
        }
      }

      if (coverDownload && card?.genJobId && window.SupabaseSync?.rearchiveGeneratedCardFromJob) {
        downloadPrepToast(card);
        await window.SupabaseSync.rearchiveGeneratedCardFromJob(card);
        const retry = await window.SupabaseSync.downloadCardFullResBlob(card, { skipRepair: true });
        if (retry) {
          const name = downloadFilenameForCard(card, retry, filename, galleryIndex);
          saveBlob(retry, name);
          showToast(`下载完成 · ${formatFileSize(retry.size)}`);
          return;
        }
      }

      if (await tryDownloadViaPreviewUrl(card, filename, { ...opts, galleryIndex })) return;

      showToast('原图暂不可用，请稍后重试或重新生成');
    } catch (e) {
      try {
        if (await tryDownloadViaPreviewUrl(card, filename, { ...opts, galleryIndex })) return;
      } catch (e2) { /* fall through */ }
      showToast('下载失败，请稍后重试');
      console.warn('[download] card image failed', e);
    } finally {
      cardDownloadInflight.delete(inflightKey);
      setDownloadTriggerBusy(triggerBtn, false);
    }
  }

  function isCardDownloadInflight(id) {
    return cardDownloadInflight.has(String(id || ''));
  }

  window.MediaDownload = {
    init,
    saveBlob,
    saveImageUrl,
    downloadCardImageFile,
    setDownloadTriggerBusy,
    isCardDownloadInflight
  };
  window.promptHubSaveImage = saveImageUrl;
  window.downloadCardImageFile = downloadCardImageFile;
  window.isCardDownloadInflight = isCardDownloadInflight;
})();

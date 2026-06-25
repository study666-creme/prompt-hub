/**
 * 媒体下载（阶段 5）：URL / Blob 保存，供 script.js、灯箱、生图 Feed 共用。
 */
(function () {
  'use strict';

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

  window.MediaDownload = {
    saveBlob,
    saveImageUrl
  };
  window.promptHubSaveImage = saveImageUrl;
})();

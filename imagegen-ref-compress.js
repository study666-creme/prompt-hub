/**
 * 生图参考图本地压缩（blob/dataUrl → JPEG dataUrl）
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};

  function d() { return deps; }

  function refDataUrlByteSize(dataUrl) {
    const base64 = String(dataUrl || '').split(',')[1] || '';
    return Math.ceil((base64.length * 3) / 4);
  }

  function loadRefImageElement(src, opts = {}) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (opts.crossOrigin) img.crossOrigin = opts.crossOrigin;
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = src;
    });
  }

  function canvasToJpegDataUrl(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('图片压缩失败'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(blob);
      }, 'image/jpeg', quality);
    });
  }

  async function compressRefImageFromSource(source, maxSide) {
    const img = await loadRefImageElement(source);
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('图片尺寸无效');
    const side = maxSide || d().getRefMaxSide?.() || 2560;
    const targetMax = d().getRefTargetMaxBytes?.() || 8 * 1024 * 1024;
    const scale = Math.min(1, side / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const canvas = global.document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法处理图片');
    ctx.drawImage(img, 0, 0, w, h);
    let quality = 0.88;
    let dataUrl = await canvasToJpegDataUrl(canvas, quality);
    while (refDataUrlByteSize(dataUrl) > targetMax && quality > 0.52) {
      quality -= 0.08;
      dataUrl = await canvasToJpegDataUrl(canvas, quality);
    }
    if (refDataUrlByteSize(dataUrl) > targetMax) {
      throw new Error('图片压缩后仍过大，请换一张较小的图');
    }
    return dataUrl;
  }

  function init(injected) {
    deps = injected || {};
    return { compressRefImageFromSource };
  }

  global.ImageGenRefCompress = { init };
})(typeof window !== 'undefined' ? window : globalThis);
